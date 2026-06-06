# V2 Verification Status

Status: in progress

## Automated Evidence

- Local service tests: `apps/local-service npm test` passed in the latest automated V2 critic run.
- Browser extension tests: `prototypes/browser-extension npm test` passed in the latest automated V2 critic run.
- Desktop shell static tests: `apps/desktop-shell npm test` passed in the latest automated V2 critic run.
- `LOCAL_SERVICE_BRIDGE_PASS`: `prototypes/browser-extension/tests/runtime-demo.test.js` starts or reuses the local service, launches Chrome headless through CDP, opens the demo page, confirms mascot + prompt card render, confirms the card is replaced by local-service output (`llm` or `template-fallback`), and confirms Insert writes back without submitting.
- `TAURI_BUILD_CHECK_PASS`: Rustup was installed through winget, `npx tauri info` reports WebView2/MSVC/rustc/cargo available, and `cargo check --manifest-path apps/desktop-shell/src-tauri/Cargo.toml` passes.
- `TAURI_START_PASS`: `scripts/check-v2-tauri-runtime.ps1` starts `npm run dev`, observes the running Tauri WebView through WebView2 CDP, confirms `window.__TAURI__` is available, and then cleans up the process tree.
- `GLOBAL_SHORTCUT_PASS`: `scripts/check-v2-tauri-runtime.ps1` invokes the runtime `set_global_shortcut` command, sends the registered `Ctrl+Alt+P` hotkey through Win32 keyboard events, and confirms the Rust shortcut hit counter increments through `get_shortcut_hits`.
- Tauri local service start: `scripts/check-v2-tauri-runtime.ps1` invokes `start_local_service` from the running Tauri app with a test port and confirms `/health` responds from `smart-prompt-local-service`.

## Runtime Evidence Attempted But Not Passing

- Real LLM: `scripts/check-v2-real-llm.ps1` reaches the OpenAI-compatible gateway but current `OPENAI_API_KEY` returns HTTP 429 quota/billing failure on the first `idea` mode request, so the three-mode real LLM acceptance is not proven.

## Manual / Runtime Evidence Still Required

- At least 5 live web AI pages show the mascot reliably.
- Insert succeeds on ChatGPT, Claude, and Gemini without auto-send.

Do not mark V2 complete until these runtime checks are replaced with concrete pass evidence.

Latest strict check after the Tauri runtime smoke now fails only on the live-site mascot and ChatGPT/Claude/Gemini Insert evidence. Default `scripts/critic-v2.ps1` still passes, and `scripts/check-v2-real-llm.ps1` still reaches the gateway but returns OpenAI HTTP 429 quota/billing failure.
