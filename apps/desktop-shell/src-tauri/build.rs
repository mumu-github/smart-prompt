fn main() {
    println!("cargo:rerun-if-changed=../overlay.html");
    println!("cargo:rerun-if-changed=../src/overlay.css");
    println!("cargo:rerun-if-changed=../src/overlay.js");
    println!("cargo:rerun-if-changed=../dist/overlay.html");
    println!("cargo:rerun-if-changed=../dist/src/overlay.css");
    println!("cargo:rerun-if-changed=../dist/src/overlay.js");
    let app_manifest = tauri_build::AppManifest::new().commands(&[
        "set_global_shortcut",
        "get_shortcut_hits",
        "get_local_service_status",
        "get_local_service_source",
        "show_main_window",
        "hide_main_window",
        "open_chatgpt",
        "show_mascot_overlay",
        "hide_mascot_overlay",
        "set_mascot_overlay_state",
        "mascot_overlay_clicked",
        "mascot_overlay_draft_submitted",
        "trace_runtime_event",
        "start_local_service",
        "stop_local_service",
        "restart_local_service",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(app_manifest))
        .expect("failed to run Tauri build");
}
