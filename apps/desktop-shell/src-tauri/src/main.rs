use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter,
    Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use std::{path::PathBuf, process::Command, sync::Mutex};

#[derive(Default)]
struct ShortcutRuntimeState {
    hits: Mutex<u32>,
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
fn start_local_service() -> Result<String, String> {
    let script = find_local_service_script()
        .ok_or_else(|| "local service script not found".to_string())?;
    let script = script.canonicalize().unwrap_or(script);
    let script_dir = script
        .parent()
        .ok_or_else(|| "local service script parent not found".to_string())?;
    let script_name = script
        .file_name()
        .ok_or_else(|| "local service script name not found".to_string())?;
    Command::new("node")
        .current_dir(script_dir)
        .arg(script_name)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok("started".to_string())
}

fn find_local_service_script() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join("../local-service/src/server.js"));
        candidates.push(current_dir.join("../../apps/local-service/src/server.js"));
        candidates.push(current_dir.join("apps/local-service/src/server.js"));
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(apps_dir) = manifest_dir.parent().and_then(|desktop_dir| desktop_dir.parent()) {
        candidates.push(apps_dir.join("local-service/src/server.js"));
    }

    candidates.into_iter().find(|candidate| candidate.exists())
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
        .plugin(tauri_plugin_shell::init())
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
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![set_global_shortcut, get_shortcut_hits, start_local_service])
        .run(tauri::generate_context!())
        .expect("error while running Smart Prompt desktop shell");
}
