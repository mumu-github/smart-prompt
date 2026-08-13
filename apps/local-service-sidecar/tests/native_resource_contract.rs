use std::path::{Path, PathBuf};

const PREPARE_SIDECAR: &str = include_str!("../../desktop-shell/scripts/prepare-sidecar.js");
const TAURI_CONFIG: &str = include_str!("../../desktop-shell/src-tauri/tauri.conf.json");
const DRIVER: &str = include_str!("../../../scripts/codex-target-adapter-driver.ps1");
const TARGET_ADAPTER: &str = include_str!("../src/target_adapter.rs");
const SIDECAR_MAIN: &str = include_str!("../src/main.rs");
const PREPARE_SIDECAR_SOURCE: &str = include_str!("../../desktop-shell/scripts/prepare-sidecar.js");

// 源码级多行断言对行尾免疫：不同 checkout 可能给出 CRLF，先归一为 LF。
fn lf(source: &str) -> String {
    source.replace("\r\n", "\n")
}

#[test]
fn installed_native_sidecar_bundles_the_codex_driver_without_a_repository_dependency() {
    let target_adapter = lf(TARGET_ADAPTER);
    let sidecar_main = lf(SIDECAR_MAIN);
    assert!(PREPARE_SIDECAR.contains("codex-target-adapter-driver.ps1"));
    assert!(PREPARE_SIDECAR.contains("path.join(resourcesRoot, \"scripts\""));
    assert!(TAURI_CONFIG.contains("resources/smart-prompt-sidecar/"));

    let installed_executable = Path::new("C:/Program Files/Smart Prompt/resources/smart-prompt-sidecar/bin/local-service-sidecar.exe");
    let expected = PathBuf::from(
        "C:/Program Files/Smart Prompt/resources/smart-prompt-sidecar/scripts/codex-target-adapter-driver.ps1",
    );
    assert_eq!(
        installed_executable
            .parent()
            .and_then(Path::parent)
            .unwrap()
            .join("scripts")
            .join("codex-target-adapter-driver.ps1"),
        expected
    );
    assert!(target_adapter.contains("bundled_driver_path_for_executable"));
    assert!(target_adapter.contains("#[cfg(debug_assertions)]"));
    assert!(target_adapter.contains(
        "#[cfg(debug_assertions)]\n            if let Some(configured) = std::env::var_os(\"SMART_PROMPT_CODEX_TARGET_DRIVER\")"
    ));
    assert!(!target_adapter.contains("C:\\Users\\lhy10\\Documents\\Smart Prompt"));
    assert!(sidecar_main.contains("#[cfg(debug_assertions)]\nfn extend_dev_m3_script_roots"));
    assert!(PREPARE_SIDECAR_SOURCE.contains("assertNoEmbeddedRepoPath"));
}

#[test]
fn bundled_driver_is_fail_closed_and_never_submits() {
    for required in [
        "$script:DriverSchemaVersion = \"codex-target-adapter-driver@1\"",
        "$script:AllowedKinds = @(",
        "\"inspect\"",
        "\"read_exact\"",
        "\"replace_all_atomic\"",
        "prohibitedActions",
        "submitCount = 0",
    ] {
        assert!(DRIVER.contains(required), "driver is missing {required}");
    }
    assert!(DRIVER.contains("[Console]::In.ReadToEnd()"));
    assert!(DRIVER.contains("Write-DriverJson"));
}
