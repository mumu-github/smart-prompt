use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
use std::process::Command;

#[tauri::command]
fn set_global_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<String, String> {
    let parsed = parse_shortcut(&shortcut).ok_or_else(|| format!("Unsupported shortcut: {shortcut}"))?;
    let _ = app.global_shortcut().unregister_all();
    app.global_shortcut()
        .register(parsed)
        .map_err(|error| error.to_string())?;
    Ok(shortcut)
}

#[tauri::command]
fn start_local_service() -> Result<String, String> {
    let candidates = [
        "../local-service/src/server.js",
        "../../apps/local-service/src/server.js",
        "apps/local-service/src/server.js",
    ];
    let script = candidates
        .iter()
        .find(|candidate| std::path::Path::new(candidate).exists())
        .ok_or_else(|| "local service script not found".to_string())?;
    Command::new("node")
        .arg(script)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok("started".to_string())
}

fn parse_shortcut(value: &str) -> Option<Shortcut> {
    let normalized = value.to_lowercase();
    if normalized == "cmdorctrl+shift+space" || normalized == "ctrl+shift+space" {
        return Some(Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space));
    }
    if normalized == "alt+space" {
        return Some(Shortcut::new(Some(Modifiers::ALT), Code::Space));
    }
    None
}

fn main() {
    tauri::Builder::default()
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
        .invoke_handler(tauri::generate_handler![set_global_shortcut, start_local_service])
        .run(tauri::generate_context!())
        .expect("error while running Smart Prompt desktop shell");
}
