use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter,
    Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use std::{
    fs,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
};

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

#[tauri::command]
fn set_global_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<String, String> {
    let parsed = parse_shortcut(&shortcut).ok_or_else(|| format!("Unsupported shortcut: {shortcut}"))?;
    let _ = app.global_shortcut().unregister_all();
    app.global_shortcut()
        .on_shortcut(parsed, |app, shortcut, event| {
            if event.state == ShortcutState::Pressed {
                if let Ok(mut hits) = app.state::<ShortcutRuntimeState>().hits.lock() {
                    *hits += 1;
                }
                let _ = app.emit("smart-prompt-shortcut", shortcut.into_string());
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
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
fn get_local_service_status(state: tauri::State<LocalServiceRuntimeState>) -> Result<String, String> {
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
        Ok("stopped".to_string())
    }
}

#[tauri::command]
fn get_local_service_source(app: tauri::AppHandle) -> Result<String, String> {
    let script = find_local_service_script(&app)
        .ok_or_else(|| "local service script not found".to_string())?;
    let node_runtime = find_node_runtime(&app);
    Ok(format!("script={};node={}", script.source, node_runtime.source))
}

#[tauri::command]
fn start_local_service(
    app: tauri::AppHandle,
    state: tauri::State<LocalServiceRuntimeState>
) -> Result<String, String> {
    {
        let mut child = state.child.lock().map_err(|error| error.to_string())?;
        if let Some(process) = child.as_mut() {
            if process.try_wait().map_err(|error| error.to_string())?.is_none() {
                return Ok("running".to_string());
            }
            *child = None;
        }
    }

    let script = find_local_service_script(&app)
        .ok_or_else(|| "local service script not found".to_string())?;
    let script = script.path.canonicalize().unwrap_or(script.path);
    let script_dir = script
        .parent()
        .ok_or_else(|| "local service script parent not found".to_string())?;
    let script_name = script
        .file_name()
        .ok_or_else(|| "local service script name not found".to_string())?;
    let node_runtime = find_node_runtime(&app);
    let node = node_runtime.path.canonicalize().unwrap_or(node_runtime.path);
    let data_dir = local_service_data_dir(&app)?;
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    let child_process = Command::new(node)
        .current_dir(script_dir)
        .arg(script_name)
        .env("SMART_PROMPT_DATA_DIR", data_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| error.to_string())?;
    let mut child = state.child.lock().map_err(|error| error.to_string())?;
    *child = Some(child_process);
    Ok("started".to_string())
}

#[tauri::command]
fn stop_local_service(state: tauri::State<LocalServiceRuntimeState>) -> Result<String, String> {
    let mut child = state.child.lock().map_err(|error| error.to_string())?;
    if let Some(mut process) = child.take() {
        if process.try_wait().map_err(|error| error.to_string())?.is_none() {
            process.kill().map_err(|error| error.to_string())?;
        }
        let _ = process.wait();
    }
    Ok("stopped".to_string())
}

fn find_local_service_script(app: &tauri::AppHandle) -> Option<ResolvedLocalPath> {
    let mut candidates: Vec<(PathBuf, &'static str)> = Vec::new();
    for root in bundled_sidecar_roots(app) {
        candidates.push((root.join("apps/local-service/src/server.js"), "bundled"));
    }

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push((current_dir.join("../local-service/src/server.js"), "source"));
        candidates.push((current_dir.join("../../apps/local-service/src/server.js"), "source"));
        candidates.push((current_dir.join("apps/local-service/src/server.js"), "source"));
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(apps_dir) = manifest_dir.parent().and_then(|desktop_dir| desktop_dir.parent()) {
        candidates.push((apps_dir.join("local-service/src/server.js"), "source"));
    }

    candidates
        .into_iter()
        .find(|(candidate, _)| candidate.exists())
        .map(|(path, source)| ResolvedLocalPath { path, source })
}

fn find_node_runtime(app: &tauri::AppHandle) -> ResolvedLocalPath {
    let executable = if cfg!(target_os = "windows") { "node.exe" } else { "node" };
    for root in bundled_sidecar_roots(app) {
        let candidate = root.join("bin").join(executable);
        if candidate.exists() {
            return ResolvedLocalPath {
                path: candidate,
                source: "bundled",
            };
        }
    }
    ResolvedLocalPath {
        path: PathBuf::from("node"),
        source: "path",
    }
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
        return Some(Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space));
    }
    if normalized == "alt+space" {
        return Some(Shortcut::new(Some(Modifiers::ALT), Code::Space));
    }
    if normalized == "ctrl+alt+p" || normalized == "cmdorctrl+alt+p" {
        return Some(Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyP));
    }
    None
}

fn main() {
    tauri::Builder::default()
        .manage(ShortcutRuntimeState::default())
        .manage(LocalServiceRuntimeState::default())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Smart Prompt")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        let _ = stop_local_service(app.state::<LocalServiceRuntimeState>());
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_global_shortcut,
            get_shortcut_hits,
            get_local_service_status,
            get_local_service_source,
            start_local_service,
            stop_local_service
        ])
        .run(tauri::generate_context!())
        .expect("error while running Smart Prompt desktop shell");
}
