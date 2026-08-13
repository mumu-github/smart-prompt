#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    fs,
    io::{Read, Write},
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    window::Color,
    Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
#[cfg(windows)]
use windows::core::PWSTR;
#[cfg(windows)]
use windows::Win32::Foundation::{CloseHandle, HWND, RECT};
#[cfg(windows)]
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
#[cfg(windows)]
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
#[cfg(windows)]
use windows::Win32::UI::Accessibility::SetWinEventHook;
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    GetAncestor, GetForegroundWindow, GetWindowLongPtrW, GetWindowRect, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetWindowLongPtrW, SetWindowPos,
    ShowWindow, EVENT_OBJECT_CLOAKED, EVENT_OBJECT_HIDE, EVENT_SYSTEM_FOREGROUND,
    EVENT_SYSTEM_MINIMIZEEND, EVENT_SYSTEM_MINIMIZESTART, GA_ROOT, GWL_EXSTYLE, HWND_TOPMOST,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_SHOWWINDOW, SW_HIDE,
    WINEVENT_OUTOFCONTEXT, WS_EX_NOACTIVATE,
};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const LOCAL_SERVICE_PORT: u16 = 17371;
const LOCAL_SERVICE_NAME: &str = "smart-prompt-local-service";
const ACTIVATION_CONTRACT: &str = "phase3-activation@1";
const NATIVE_SERVICE_VERSION: &str = "0.5.0-native";
const NATIVE_RUNTIME_CONTRACT: &str = "phase3-native-runtime@1";
const NATIVE_BUILD_ID: &str = "phase3-native-sidecar-20260719-r18";

const MASCOT_OVERLAY_CARD_WIDTH: f64 = 320.0;
const MASCOT_OVERLAY_CARD_HEIGHT: f64 = 360.0;
const MASCOT_OVERLAY_COMPACT_WIDTH: f64 = 72.0;
const MASCOT_OVERLAY_COMPACT_HEIGHT: f64 = 72.0;
const MASCOT_OVERLAY_TRANSPARENT_COLOR: Color = Color(0, 0, 0, 0);
#[cfg(windows)]
const FOREGROUND_OVERLAY_WATCH_MS: u64 = 80;
#[cfg(windows)]
static FOREGROUND_OVERLAY_APP: OnceLock<tauri::AppHandle> = OnceLock::new();

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WindowRectPayload {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ForegroundWindowState {
    schema_version: String,
    created_at: String,
    platform: String,
    hwnd: String,
    process_id: u32,
    process_name: String,
    title_length: usize,
    title_hash: String,
    detected_tool_profile: String,
    overlay_supported_profile: bool,
    is_visible: bool,
    is_minimized: bool,
    is_cloaked: bool,
    is_usable: bool,
    bounding_rect: WindowRectPayload,
}

#[cfg(windows)]
fn overlay_window_handles(window: &tauri::WebviewWindow) -> Result<Vec<HWND>, String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let mut handles = vec![hwnd];
    // SAFETY: `hwnd` is provided by Tauri for this live WebView window. `GetAncestor`
    // only reads the window relationship and returns null on failure.
    let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
    if !root.0.is_null() && root != hwnd {
        handles.push(root);
    }
    Ok(handles)
}

#[cfg(windows)]
fn apply_overlay_no_activate(hwnd: HWND, show: bool) -> Result<(), String> {
    // SAFETY: The caller passes HWNDs obtained from the live overlay window. The calls
    // only update extended window styles and z-order flags for that window; Win32
    // errors from `SetWindowPos` are converted into `Result`.
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style | WS_EX_NOACTIVATE.0 as isize);
        let flags = if show {
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOOWNERZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW
        } else {
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOOWNERZORDER | SWP_NOACTIVATE
        };
        SetWindowPos(hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0, flags)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(windows)]
fn keep_overlay_non_activating(window: &tauri::WebviewWindow) -> Result<(), String> {
    for hwnd in overlay_window_handles(window)? {
        apply_overlay_no_activate(hwnd, false)?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn keep_overlay_non_activating(_window: &tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn show_overlay_without_activation(window: &tauri::WebviewWindow) -> Result<(), String> {
    for hwnd in overlay_window_handles(window)? {
        apply_overlay_no_activate(hwnd, true)?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn show_overlay_without_activation(window: &tauri::WebviewWindow) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())
}

#[cfg(windows)]
fn hide_overlay_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    for hwnd in overlay_window_handles(window)? {
        // SAFETY: HWNDs come from the live overlay window/root pair. `ShowWindow`
        // is best-effort and does not transfer ownership or invalidate Rust memory.
        unsafe {
            let _ = ShowWindow(hwnd, SW_HIDE);
        }
    }
    window.hide().map_err(|error| error.to_string())
}

#[cfg(not(windows))]
fn hide_overlay_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

fn unix_timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn runtime_timestamp_string() -> String {
    unix_timestamp_millis().to_string()
}

fn hash_text(value: &str) -> String {
    if value.is_empty() {
        return String::new();
    }
    let mut hash = 2166136261u32;
    for unit in value.encode_utf16() {
        hash ^= unit as u32;
        hash = hash.wrapping_mul(16777619);
    }
    format!("{hash:08x}")
}

fn normalize_tool_text(value: &str) -> String {
    let mut normalized = String::new();
    let mut last_was_space = true;
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            normalized.push(ch.to_ascii_lowercase());
            last_was_space = false;
        } else if !last_was_space {
            normalized.push(' ');
            last_was_space = true;
        }
    }
    normalized.trim().to_string()
}

fn is_trusted_packaged_codex_executable(executable_path: &str) -> bool {
    let normalized = executable_path.replace('/', "\\").to_ascii_lowercase();
    let bytes = normalized.as_bytes();
    if bytes.len() < 3 || !bytes[0].is_ascii_alphabetic() || bytes[1] != b':' || bytes[2] != b'\\' {
        return false;
    }
    let rooted = &normalized[3..];
    let package_path = rooted
        .strip_prefix("program files\\windowsapps\\")
        .or_else(|| rooted.strip_prefix("windowsapps\\"));
    let suffix = "\\app\\chatgpt.exe";
    let Some(package_path) = package_path else {
        return false;
    };
    let Some(package_identity) = package_path.strip_suffix(suffix) else {
        return false;
    };
    !package_identity.contains('\\')
        && package_identity.starts_with("openai.codex_")
        && package_identity.ends_with("__2p2nqsd0c76g0")
}

fn detect_tool_profile(process_name: &str, title: &str, executable_path: &str) -> &'static str {
    let process = normalize_tool_text(process_name);
    let title = normalize_tool_text(title);
    let haystack = format!("{process} {title}");
    if haystack.contains("codex")
        || haystack.contains("openai codex")
        || is_trusted_packaged_codex_executable(executable_path)
    {
        return "codex";
    }
    if haystack.contains("claude code") || process == "claude" {
        return "claude-code";
    }
    if haystack.contains("hermes") {
        return "hermes";
    }
    if haystack.contains("work buddy")
        || haystack.contains("workbuddy")
        || haystack.contains("work buddy")
    {
        return "workbuddy";
    }
    if haystack.contains("trae") {
        return "trae";
    }
    "unknown"
}

#[cfg(test)]
mod foreground_profile_tests {
    use super::detect_tool_profile;

    #[test]
    fn recognizes_only_the_trusted_codex_packaged_chatgpt_executable() {
        let codex_path = r"C:\Program Files\WindowsApps\OpenAI.Codex_26.715.4045.0_x64__2p2nqsd0c76g0\app\ChatGPT.exe";
        let chatgpt_path = r"C:\Program Files\WindowsApps\OpenAI.ChatGPT_26.715.4045.0_x64__2p2nqsd0c76g0\app\ChatGPT.exe";
        let fake_path = r"C:\tmp\OpenAI.Codex_fake__2p2nqsd0c76g0\app\ChatGPT.exe";
        let prefixed_fake_path = r"C:\tmp\Program Files\WindowsApps\OpenAI.Codex_26.715.4045.0_x64__2p2nqsd0c76g0\app\ChatGPT.exe";

        assert_eq!(
            detect_tool_profile("ChatGPT", "ChatGPT", codex_path),
            "codex"
        );
        assert_eq!(
            detect_tool_profile("ChatGPT", "ChatGPT", chatgpt_path),
            "unknown"
        );
        assert_eq!(
            detect_tool_profile("ChatGPT", "ChatGPT", fake_path),
            "unknown"
        );
        assert_eq!(
            detect_tool_profile("ChatGPT", "ChatGPT", prefixed_fake_path),
            "unknown"
        );
    }
}

fn overlay_profile_supported(profile: &str) -> bool {
    matches!(profile, "codex" | "workbuddy" | "trae")
}

#[cfg(windows)]
fn get_window_title(hwnd: HWND) -> String {
    let mut buffer = vec![0u16; 512];
    // SAFETY: `buffer` is a valid writable UTF-16 buffer and the Win32 API receives
    // its exact capacity through the slice wrapper.
    let length = unsafe { GetWindowTextW(hwnd, &mut buffer) };
    if length <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buffer[..length as usize])
}

#[cfg(windows)]
fn get_process_image_path(process_id: u32) -> String {
    if process_id == 0 {
        return String::new();
    }
    // SAFETY: The process id comes from Win32 foreground/window APIs. `OpenProcess`
    // returns an owned handle on success, which is closed below before returning.
    let handle = match unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) }
    {
        Ok(handle) => handle,
        Err(_) => return String::new(),
    };
    let mut buffer = vec![0u16; 32768];
    let mut size = buffer.len() as u32;
    // SAFETY: `buffer` is a valid mutable UTF-16 buffer and `size` is initialized to
    // the buffer capacity. The API writes at most that capacity and updates `size`.
    let path = match unsafe {
        QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut size,
        )
    } {
        Ok(_) => String::from_utf16_lossy(&buffer[..size as usize]),
        Err(_) => String::new(),
    };
    // SAFETY: `handle` is the owned process handle returned by `OpenProcess` above.
    let _ = unsafe { CloseHandle(handle) };
    path
}

#[cfg(windows)]
fn is_window_cloaked(hwnd: HWND) -> bool {
    let mut cloaked = 0u32;
    // SAFETY: `cloaked` is a properly aligned u32 out-parameter and the buffer size
    // matches the value passed to DWM.
    unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked as *mut u32 as *mut core::ffi::c_void,
            std::mem::size_of::<u32>() as u32,
        )
        .is_ok()
            && cloaked != 0
    }
}

#[cfg(windows)]
fn window_state_from_hwnd(hwnd: HWND) -> ForegroundWindowState {
    let mut process_id = 0u32;
    if !hwnd.0.is_null() {
        // SAFETY: `process_id` is a valid out-parameter and null HWNDs are excluded.
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut process_id));
        }
    }
    let title = if hwnd.0.is_null() {
        String::new()
    } else {
        get_window_title(hwnd)
    };
    let process_path = get_process_image_path(process_id);
    let process_name = Path::new(&process_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_string();
    let profile = detect_tool_profile(&process_name, &title, &process_path).to_string();
    // SAFETY: These Win32 predicates read state for a non-null HWND and do not mutate memory.
    let is_visible = !hwnd.0.is_null() && unsafe { IsWindowVisible(hwnd).as_bool() };
    // SAFETY: These Win32 predicates read state for a non-null HWND and do not mutate memory.
    let is_minimized = !hwnd.0.is_null() && unsafe { IsIconic(hwnd).as_bool() };
    let is_cloaked = !hwnd.0.is_null() && is_window_cloaked(hwnd);
    let mut rect = RECT::default();
    // SAFETY: `rect` is a valid out-parameter and null HWNDs are excluded.
    let has_rect = !hwnd.0.is_null() && unsafe { GetWindowRect(hwnd, &mut rect).is_ok() };
    let width = if has_rect { rect.right - rect.left } else { 0 };
    let height = if has_rect { rect.bottom - rect.top } else { 0 };
    let is_usable = is_visible && !is_minimized && !is_cloaked && width > 0 && height > 0;
    ForegroundWindowState {
        schema_version: "p25-foreground-window-state@1".to_string(),
        created_at: runtime_timestamp_string(),
        platform: "win32".to_string(),
        hwnd: if hwnd.0.is_null() {
            String::new()
        } else {
            format!("0x{:x}", hwnd.0 as usize)
        },
        process_id,
        process_name,
        title_length: title.chars().count(),
        title_hash: hash_text(&title),
        detected_tool_profile: profile.clone(),
        overlay_supported_profile: overlay_profile_supported(&profile),
        is_visible,
        is_minimized,
        is_cloaked,
        is_usable,
        bounding_rect: WindowRectPayload {
            x: if has_rect { rect.left } else { 0 },
            y: if has_rect { rect.top } else { 0 },
            width,
            height,
        },
    }
}

#[cfg(windows)]
fn current_foreground_window_state() -> ForegroundWindowState {
    // SAFETY: `GetForegroundWindow` returns a borrowed HWND or null; downstream code
    // treats null as an unavailable foreground window.
    window_state_from_hwnd(unsafe { GetForegroundWindow() })
}

#[cfg(not(windows))]
fn current_foreground_window_state() -> ForegroundWindowState {
    ForegroundWindowState {
        schema_version: "p25-foreground-window-state@1".to_string(),
        created_at: runtime_timestamp_string(),
        platform: std::env::consts::OS.to_string(),
        hwnd: String::new(),
        process_id: 0,
        process_name: String::new(),
        title_length: 0,
        title_hash: String::new(),
        detected_tool_profile: "unknown".to_string(),
        overlay_supported_profile: false,
        is_visible: false,
        is_minimized: false,
        is_cloaked: false,
        is_usable: false,
        bounding_rect: WindowRectPayload {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
        },
    }
}

#[tauri::command]
fn get_foreground_window_state() -> Result<ForegroundWindowState, String> {
    Ok(current_foreground_window_state())
}

#[cfg(windows)]
fn is_foreground_overlay_supported(state: &ForegroundWindowState) -> bool {
    state.overlay_supported_profile
        && state.is_usable
        && state.is_visible
        && !state.is_minimized
        && !state.is_cloaked
}

#[cfg(windows)]
fn foreground_window_state_signature(state: &ForegroundWindowState) -> String {
    format!(
        "{}:{}:{}:{}:{}:{}:{}:{}:{}:{}",
        state.hwnd,
        state.process_id,
        state.detected_tool_profile,
        state.title_hash,
        state.title_length,
        state.bounding_rect.x,
        state.bounding_rect.y,
        state.bounding_rect.width,
        state.bounding_rect.height,
        state.is_usable
    )
}

#[cfg(windows)]
fn hide_mascot_overlay_for_app(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("mascot-overlay") {
        let _ = hide_overlay_window(&window);
    }
}

#[cfg(windows)]
fn is_supported_tool_window(hwnd: HWND) -> bool {
    if hwnd.0.is_null() {
        return false;
    }
    overlay_profile_supported(&window_state_from_hwnd(hwnd).detected_tool_profile)
}

#[cfg(windows)]
// SAFETY: This function is only registered as a WinEvent callback by
// `SetWinEventHook`. It does not dereference raw pointers from the OS callback and
// only forwards sanitized foreground metadata or hides the overlay.
unsafe extern "system" fn foreground_overlay_event_proc(
    _hook: windows::Win32::UI::Accessibility::HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    id_object: i32,
    id_child: i32,
    _event_thread: u32,
    _event_time: u32,
) {
    if id_object != 0 || id_child != 0 {
        return;
    }
    let Some(app) = FOREGROUND_OVERLAY_APP.get() else {
        return;
    };
    let foreground_state = current_foreground_window_state();
    let foreground_supported = is_foreground_overlay_supported(&foreground_state);
    let should_hide = match event {
        EVENT_SYSTEM_FOREGROUND | EVENT_SYSTEM_MINIMIZEEND => !foreground_supported,
        EVENT_SYSTEM_MINIMIZESTART | EVENT_OBJECT_HIDE | EVENT_OBJECT_CLOAKED => {
            is_supported_tool_window(hwnd) || !foreground_supported
        }
        _ => false,
    };
    let _ = app.emit("smart-prompt-foreground-window-state", foreground_state);
    if should_hide {
        hide_mascot_overlay_for_app(app);
    }
}

#[cfg(windows)]
fn start_foreground_overlay_event_hook(app: tauri::AppHandle) {
    let _ = FOREGROUND_OVERLAY_APP.set(app);
    for (event_min, event_max) in [
        (EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND),
        (EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND),
        (EVENT_OBJECT_HIDE, EVENT_OBJECT_HIDE),
        (EVENT_OBJECT_CLOAKED, EVENT_OBJECT_CLOAKED),
    ] {
        // SAFETY: The callback has the required `extern "system"` ABI and static
        // lifetime. Hooks are out-of-context and do not capture Rust stack references.
        unsafe {
            let _ = SetWinEventHook(
                event_min,
                event_max,
                None,
                Some(foreground_overlay_event_proc),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            );
        }
    }
}

#[cfg(windows)]
fn start_foreground_overlay_watcher(app: tauri::AppHandle) {
    start_foreground_overlay_event_hook(app.clone());
    std::thread::spawn(move || {
        let mut last_signature = String::new();
        loop {
            let state = current_foreground_window_state();
            let supported = is_foreground_overlay_supported(&state);
            let signature = foreground_window_state_signature(&state);
            if signature != last_signature {
                last_signature = signature;
                let _ = app.emit("smart-prompt-foreground-window-state", state.clone());
            }
            if !supported {
                hide_mascot_overlay_for_app(&app);
            }
            std::thread::sleep(Duration::from_millis(FOREGROUND_OVERLAY_WATCH_MS));
        }
    });
}

#[cfg(not(windows))]
fn start_foreground_overlay_watcher(_app: tauri::AppHandle) {}

#[derive(Default)]
struct ShortcutRuntimeState {
    hits: Mutex<u32>,
}

#[derive(Default)]
struct LocalServiceRuntimeState {
    child: Mutex<Option<Child>>,
}

struct ResolvedLocalPath {
    path: PathBuf,
    source: &'static str,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MascotOverlayPayload {
    x: f64,
    y: f64,
    compact_x: Option<f64>,
    compact_y: Option<f64>,
    profile: String,
    state: String,
    overlay_mode: Option<String>,
    overlay_action: Option<String>,
    title_hash: String,
    candidate_index: i32,
    no_auto_submit: bool,
    prompt_ready: Option<bool>,
    prompt_kind: Option<String>,
    prompt_mode: Option<String>,
    prompt_text: Option<String>,
    prompt_text_length: Option<usize>,
    prompt_text_hash: Option<String>,
    locale: Option<String>,
    guard_reason: Option<String>,
    visual_only: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MascotOverlayDraftSubmission {
    text: String,
    payload: MascotOverlayPayload,
}

#[tauri::command]
fn set_global_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<String, String> {
    let parsed =
        parse_shortcut(&shortcut).ok_or_else(|| format!("Unsupported shortcut: {shortcut}"))?;
    let _ = app.global_shortcut().unregister_all();
    app.global_shortcut()
        .on_shortcut(parsed, |app, shortcut, event| {
            if event.state == ShortcutState::Pressed {
                if let Ok(mut hits) = app.state::<ShortcutRuntimeState>().hits.lock() {
                    *hits += 1;
                }
                let _ = app.emit("smart-prompt-shortcut", shortcut.into_string());
            }
        })
        .map_err(|error| error.to_string())?;
    Ok(shortcut)
}

#[tauri::command]
fn get_shortcut_hits(state: tauri::State<ShortcutRuntimeState>) -> Result<u32, String> {
    state
        .hits
        .lock()
        .map(|hits| *hits)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_local_service_status(
    state: tauri::State<LocalServiceRuntimeState>,
) -> Result<String, String> {
    let mut child = state.child.lock().map_err(|error| error.to_string())?;
    if let Some(process) = child.as_mut() {
        match process.try_wait().map_err(|error| error.to_string())? {
            Some(status) => {
                *child = None;
                Ok(format!("exited:{}", status.code().unwrap_or(-1)))
            }
            None => Ok("running".to_string()),
        }
    } else {
        Ok(if is_expected_local_service() {
            "running".to_string()
        } else {
            "stopped".to_string()
        })
    }
}

#[tauri::command]
fn get_local_service_source(app: tauri::AppHandle) -> Result<String, String> {
    let sidecar = find_local_service_sidecar(&app)
        .ok_or_else(|| "local-service-sidecar executable not found".to_string())?;
    Ok(format!(
        "local-service-sidecar={};binary={}",
        sidecar.source,
        sidecar.path.display()
    ))
}

fn focus_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    focus_main_window(&app)
}

#[tauri::command]
fn hide_main_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn open_chatgpt() -> Result<(), String> {
    #[cfg(windows)]
    {
        Command::new("explorer.exe")
            .arg("https://chatgpt.com")
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("https://chatgpt.com")
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg("https://chatgpt.com")
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Err("opening ChatGPT is unsupported on this platform".to_string())
}

fn mascot_overlay_geometry(payload: &MascotOverlayPayload) -> (i32, i32, u32, u32) {
    if payload.overlay_mode.as_deref() == Some("expanded") {
        return (
            payload.x.round() as i32,
            payload.y.round() as i32,
            MASCOT_OVERLAY_CARD_WIDTH.round() as u32,
            MASCOT_OVERLAY_CARD_HEIGHT.round() as u32,
        );
    }
    (
        payload.compact_x.unwrap_or(payload.x).round() as i32,
        payload.compact_y.unwrap_or(payload.y).round() as i32,
        MASCOT_OVERLAY_COMPACT_WIDTH.round() as u32,
        MASCOT_OVERLAY_COMPACT_HEIGHT.round() as u32,
    )
}

fn keep_mascot_overlay_transparent(window: &tauri::WebviewWindow) -> Result<(), String> {
    window
        .set_background_color(Some(MASCOT_OVERLAY_TRANSPARENT_COLOR))
        .map_err(|error| error.to_string())
}

fn apply_mascot_overlay_geometry(
    window: &tauri::WebviewWindow,
    payload: &MascotOverlayPayload,
) -> Result<(), String> {
    let (x, y, width, height) = mascot_overlay_geometry(payload);
    keep_mascot_overlay_transparent(window)?;
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    keep_mascot_overlay_transparent(window)
}

fn emit_mascot_overlay_state(
    window: &tauri::WebviewWindow,
    payload: MascotOverlayPayload,
) -> Result<(), String> {
    window
        .emit("smart-prompt-overlay-state", payload)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn show_mascot_overlay(app: tauri::AppHandle, payload: MascotOverlayPayload) -> Result<(), String> {
    let window = app
        .get_webview_window("mascot-overlay")
        .ok_or_else(|| "mascot overlay window not found".to_string())?;
    keep_mascot_overlay_transparent(&window)?;
    emit_mascot_overlay_state(&window, payload.clone())?;
    std::thread::sleep(Duration::from_millis(24));
    apply_mascot_overlay_geometry(&window, &payload)?;
    keep_overlay_non_activating(&window)?;
    window
        .set_always_on_top(true)
        .map_err(|error| error.to_string())?;
    show_overlay_without_activation(&window)?;
    emit_mascot_overlay_state(&window, payload)
}

#[tauri::command]
fn hide_mascot_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("mascot-overlay") {
        hide_overlay_window(&window)?;
    }
    Ok(())
}

#[tauri::command]
fn set_mascot_overlay_state(
    app: tauri::AppHandle,
    payload: MascotOverlayPayload,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("mascot-overlay") {
        apply_mascot_overlay_geometry(&window, &payload)?;
        keep_overlay_non_activating(&window)?;
        emit_mascot_overlay_state(&window, payload)?;
    }
    Ok(())
}

#[tauri::command]
fn mascot_overlay_clicked(
    app: tauri::AppHandle,
    payload: MascotOverlayPayload,
) -> Result<(), String> {
    app.emit_to("main", "smart-prompt-overlay-click", payload)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn mascot_overlay_draft_submitted(
    app: tauri::AppHandle,
    text: String,
    payload: MascotOverlayPayload,
) -> Result<(), String> {
    app.emit_to(
        "main",
        "smart-prompt-overlay-draft",
        MascotOverlayDraftSubmission { text, payload },
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn trace_runtime_event(
    app: tauri::AppHandle,
    event: String,
    payload: serde_json::Value,
) -> Result<(), String> {
    write_runtime_trace_event(&app, &event, payload)
}

fn write_runtime_trace_event(
    app: &tauri::AppHandle,
    event: &str,
    payload: serde_json::Value,
) -> Result<(), String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = dir.join("smart-prompt-runtime-trace.jsonl");
    let timestamp_ms = unix_timestamp_millis();
    let event = event.chars().take(80).collect::<String>();
    let row = serde_json::json!({
        "timestampMs": timestamp_ms,
        "event": event,
        "payload": payload
    });
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    writeln!(file, "{row}").map_err(|error| error.to_string())
}

#[tauri::command]
fn start_local_service(
    app: tauri::AppHandle,
    state: tauri::State<LocalServiceRuntimeState>,
) -> Result<String, String> {
    {
        let mut child = state.child.lock().map_err(|error| error.to_string())?;
        if let Some(process) = child.as_mut() {
            if process
                .try_wait()
                .map_err(|error| error.to_string())?
                .is_none()
            {
                return Ok("running".to_string());
            }
            *child = None;
        }
    }

    if is_local_service_port_in_use() {
        return if is_expected_local_service() {
            Ok("running".to_string())
        } else {
            Err(format!(
                "Smart Prompt fixed local-service port {} is occupied by an incompatible process.",
                local_service_port()
            ))
        };
    }

    let sidecar = find_local_service_sidecar(&app)
        .ok_or_else(|| "local-service-sidecar executable not found".to_string())?;
    let sidecar = prepare_local_service_sidecar_for_execution(&app, sidecar)?;
    let sidecar = sidecar.path.canonicalize().unwrap_or(sidecar.path);
    let data_dir = local_service_data_dir(&app)?;
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    let mut command = Command::new(sidecar);
    command
        .env("SMART_PROMPT_DATA_DIR", data_dir)
        .env("SMART_PROMPT_PORT", local_service_port().to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let child_process = command.spawn().map_err(|error| error.to_string())?;
    let mut child = state.child.lock().map_err(|error| error.to_string())?;
    *child = Some(child_process);
    Ok("started".to_string())
}

#[tauri::command]
fn stop_local_service(state: tauri::State<LocalServiceRuntimeState>) -> Result<String, String> {
    let mut child = state.child.lock().map_err(|error| error.to_string())?;
    if let Some(mut process) = child.take() {
        if process
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_none()
        {
            process.kill().map_err(|error| error.to_string())?;
        }
        let _ = process.wait();
    }
    Ok("stopped".to_string())
}

#[tauri::command]
fn restart_local_service(
    app: tauri::AppHandle,
    state: tauri::State<LocalServiceRuntimeState>,
) -> Result<String, String> {
    let _ = stop_local_service(state.clone());
    start_local_service(app, state)
}

fn sidecar_executable_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "local-service-sidecar.exe"
    } else {
        "local-service-sidecar"
    }
}

fn copy_file_if_changed(source: &Path, target: &Path) -> Result<(), String> {
    let changed = match fs::read(target) {
        Ok(existing) => fs::read(source)
            .map(|incoming| incoming != existing)
            .map_err(|error| error.to_string())?,
        Err(_) => true,
    };
    if !changed {
        return Ok(());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::copy(source, target)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn copy_dir_if_changed(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_dir() {
            copy_dir_if_changed(&source_path, &target_path)?;
        } else if file_type.is_file() {
            copy_file_if_changed(&source_path, &target_path)?;
        }
    }
    Ok(())
}

fn sidecar_runtime_fingerprint(path: &Path) -> String {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => return "unknown".to_string(),
    };
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    format!("{}-{}", metadata.len(), modified)
}

fn prepare_local_service_sidecar_for_execution(
    app: &tauri::AppHandle,
    sidecar: ResolvedLocalPath,
) -> Result<ResolvedLocalPath, String> {
    if sidecar.source != "bundled" {
        return Ok(sidecar);
    }
    let source_root = sidecar
        .path
        .parent()
        .and_then(|bin_dir| bin_dir.parent())
        .ok_or_else(|| "bundled local-service-sidecar root not found".to_string())?;
    let runtime_root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("sidecar-runtime")
        .join(sidecar_runtime_fingerprint(&sidecar.path));
    copy_dir_if_changed(source_root, &runtime_root)?;
    Ok(ResolvedLocalPath {
        path: runtime_root.join("bin").join(sidecar_executable_name()),
        source: "bundled-runtime",
    })
}

fn find_local_service_sidecar(app: &tauri::AppHandle) -> Option<ResolvedLocalPath> {
    let mut candidates: Vec<(PathBuf, &'static str)> = Vec::new();
    if !cfg!(debug_assertions) {
        for root in bundled_sidecar_roots(app) {
            candidates.push((root.join("bin").join(sidecar_executable_name()), "bundled"));
        }
    }

    #[cfg(debug_assertions)]
    {
        let mut push_source_root = |root: PathBuf| {
            for profile in ["debug", "release"] {
                candidates.push((
                    root.join("target")
                        .join(profile)
                        .join(sidecar_executable_name()),
                    "source",
                ));
            }
        };
        if let Ok(current_dir) = std::env::current_dir() {
            push_source_root(current_dir.join("../local-service-sidecar"));
            push_source_root(current_dir.join("../../apps/local-service-sidecar"));
            push_source_root(current_dir.join("apps/local-service-sidecar"));
        }
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        if let Some(apps_dir) = manifest_dir
            .parent()
            .and_then(|desktop_dir| desktop_dir.parent())
        {
            push_source_root(apps_dir.join("local-service-sidecar"));
        }
    }

    #[cfg(debug_assertions)]
    {
        for root in bundled_sidecar_roots(app) {
            candidates.push((root.join("bin").join(sidecar_executable_name()), "bundled"));
        }
    }

    candidates
        .into_iter()
        .find(|(candidate, _)| candidate.exists())
        .map(|(path, source)| ResolvedLocalPath { path, source })
}

fn bundled_sidecar_roots(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        roots.push(resource_dir.join("resources/smart-prompt-sidecar"));
        roots.push(resource_dir.join("smart-prompt-sidecar"));
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(executable_dir) = executable.parent() {
            roots.push(executable_dir.join("resources/smart-prompt-sidecar"));
            roots.push(executable_dir.join("smart-prompt-sidecar"));
        }
    }
    roots
}

fn local_service_port() -> u16 {
    LOCAL_SERVICE_PORT
}

fn is_local_service_port_in_use() -> bool {
    let address = format!("127.0.0.1:{}", local_service_port());
    match address.parse() {
        Ok(address) => TcpStream::connect_timeout(&address, Duration::from_millis(150)).is_ok(),
        Err(_) => false,
    }
}

fn local_service_health() -> Option<serde_json::Value> {
    let address = format!("127.0.0.1:{}", local_service_port());
    let address = address.parse().ok()?;
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(250)).ok()?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
    stream
        .write_all(
            format!(
                "GET /health HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
                local_service_port()
            )
            .as_bytes(),
        )
        .ok()?;
    let mut response = String::new();
    stream.read_to_string(&mut response).ok()?;
    let (head, body) = response.split_once("\r\n\r\n")?;
    if !head
        .lines()
        .next()
        .is_some_and(|line| line.contains(" 200 "))
    {
        return None;
    }
    serde_json::from_str(body.trim()).ok()
}

fn is_expected_local_service() -> bool {
    local_service_health().is_some_and(|health| matches_expected_local_service_health(&health))
}

fn matches_expected_local_service_health(health: &serde_json::Value) -> bool {
    health.get("ok").and_then(serde_json::Value::as_bool) == Some(true)
        && health.get("service").and_then(serde_json::Value::as_str) == Some(LOCAL_SERVICE_NAME)
        && health.get("sidecar").and_then(serde_json::Value::as_str) == Some("native")
        && health.get("version").and_then(serde_json::Value::as_str) == Some(NATIVE_SERVICE_VERSION)
        && health
            .get("activationContract")
            .and_then(serde_json::Value::as_str)
            == Some(ACTIVATION_CONTRACT)
        && health
            .get("runtimeContract")
            .and_then(serde_json::Value::as_str)
            == Some(NATIVE_RUNTIME_CONTRACT)
        && health.get("buildId").and_then(serde_json::Value::as_str) == Some(NATIVE_BUILD_ID)
}

#[cfg(test)]
mod phase3_runtime_identity_tests {
    use super::*;
    use serde_json::json;

    fn expected_health() -> serde_json::Value {
        json!({
            "ok": true,
            "service": LOCAL_SERVICE_NAME,
            "sidecar": "native",
            "version": NATIVE_SERVICE_VERSION,
            "activationContract": ACTIVATION_CONTRACT,
            "runtimeContract": NATIVE_RUNTIME_CONTRACT,
            "buildId": NATIVE_BUILD_ID
        })
    }

    #[test]
    fn accepts_only_the_expected_native_runtime_identity() {
        assert!(matches_expected_local_service_health(&expected_health()));

        for (field, value) in [
            ("sidecar", json!("node")),
            ("version", json!("0.4.0-native")),
            ("runtimeContract", json!("phase3-native-runtime@0")),
            ("buildId", json!("stale-native-build")),
        ] {
            let mut health = expected_health();
            health[field] = value;
            assert!(!matches_expected_local_service_health(&health));
        }

        let mut missing_build = expected_health();
        missing_build.as_object_mut().unwrap().remove("buildId");
        assert!(!matches_expected_local_service_health(&missing_build));
    }
}

fn smart_prompt_tray_icon() -> Option<Image<'static>> {
    Image::from_bytes(include_bytes!("../icons/tray.png")).ok()
}

fn local_service_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(value) = std::env::var_os("SMART_PROMPT_DATA_DIR") {
        return Ok(PathBuf::from(value));
    }
    app.path()
        .app_local_data_dir()
        .map(|dir| dir.join("local-service"))
        .map_err(|error| error.to_string())
}

fn parse_shortcut(value: &str) -> Option<Shortcut> {
    let normalized = value.to_lowercase();
    if normalized == "cmdorctrl+shift+space" || normalized == "ctrl+shift+space" {
        return Some(Shortcut::new(
            Some(Modifiers::CONTROL | Modifiers::SHIFT),
            Code::Space,
        ));
    }
    if normalized == "alt+space" {
        return Some(Shortcut::new(Some(Modifiers::ALT), Code::Space));
    }
    if normalized == "ctrl+alt+p" || normalized == "cmdorctrl+alt+p" {
        return Some(Shortcut::new(
            Some(Modifiers::CONTROL | Modifiers::ALT),
            Code::KeyP,
        ));
    }
    None
}

fn main() {
    // CDP 调试端口：WebView2 需要在应用进程内、首次创建环境前设置
    // WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS。生产默认不设置；
    // 仅 SMART_PROMPT_CDP_PORT 存在时注入。
    // 注意：Evergreen Runtime 147+ 已忽略该 env（且 additionalBrowserArgs
    // 会导致环境创建失败），需要配合固定版本 Runtime 133 + 环境变量
    // WEBVIEW2_BROWSER_EXECUTABLE_FOLDER 使用，见 agent_memory。
    if let Some(port) = std::env::var_os("SMART_PROMPT_CDP_PORT") {
        let value = port.to_string_lossy();
        if !value.trim().is_empty() {
            std::env::set_var(
                "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                format!("--remote-debugging-port={}", value.trim()),
            );
        }
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = focus_main_window(app);
        }))
        .manage(ShortcutRuntimeState::default())
        .manage(LocalServiceRuntimeState::default())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "打开控制中心", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出 Smart Prompt", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray_builder = TrayIconBuilder::with_id("smart-prompt")
                .menu(&menu)
                .tooltip("Smart Prompt");
            if let Some(icon) = smart_prompt_tray_icon() {
                tray_builder = tray_builder.icon(icon);
            } else if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            let _overlay = WebviewWindowBuilder::new(
                app,
                "mascot-overlay",
                WebviewUrl::App("overlay.html".into()),
            )
            .title("Smart Prompt Mascot")
            .inner_size(MASCOT_OVERLAY_COMPACT_WIDTH, MASCOT_OVERLAY_COMPACT_HEIGHT)
            .position(0.0, 0.0)
            .decorations(false)
            .transparent(true)
            .background_color(MASCOT_OVERLAY_TRANSPARENT_COLOR)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .visible(false)
            .shadow(false)
            .build()?;
            keep_overlay_non_activating(&_overlay)?;
            let _ = write_runtime_trace_event(
                &app.handle(),
                "setup-overlay-created",
                serde_json::json!({
                    "mainWindowFound": app.get_webview_window("main").is_some(),
                    "overlayWindowFound": true,
                    "overlayVisible": _overlay.is_visible().unwrap_or(false),
                    "compactWidth": MASCOT_OVERLAY_COMPACT_WIDTH,
                    "compactHeight": MASCOT_OVERLAY_COMPACT_HEIGHT
                }),
            );
            start_foreground_overlay_watcher(app.handle().clone());
            let tray = tray_builder
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        let _ = focus_main_window(app);
                    }
                    "quit" => {
                        let _ = stop_local_service(app.state::<LocalServiceRuntimeState>());
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;
            app.manage(tray);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_global_shortcut,
            get_shortcut_hits,
            get_local_service_status,
            get_local_service_source,
            show_main_window,
            hide_main_window,
            open_chatgpt,
            show_mascot_overlay,
            hide_mascot_overlay,
            set_mascot_overlay_state,
            get_foreground_window_state,
            mascot_overlay_clicked,
            mascot_overlay_draft_submitted,
            trace_runtime_event,
            start_local_service,
            stop_local_service,
            restart_local_service
        ])
        .run(tauri::generate_context!())
        .expect("error while running Smart Prompt desktop shell");
}
