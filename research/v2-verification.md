# V2 Verification Status

Status: in progress

## Automated Evidence

- Local service tests: `apps/local-service npm test` passed in the latest automated V2 critic run.
- Browser extension tests: `prototypes/browser-extension npm test` passed in the latest automated V2 critic run.
- Desktop shell static tests: `apps/desktop-shell npm test` passed in the latest automated V2 critic run.
- `LOCAL_SERVICE_BRIDGE_PASS`: `prototypes/browser-extension/tests/runtime-demo.test.js` starts or reuses the local service, launches Chrome headless through CDP, opens the demo page, confirms mascot + prompt card render, confirms the card is replaced by local-service output (`llm` or `template-fallback`), and confirms Insert writes back without submitting.
- `TAURI_BUILD_CHECK_PASS`: Rustup was installed through winget, `npx tauri info` reports WebView2/MSVC/rustc/cargo available, and `cargo check --manifest-path apps/desktop-shell/src-tauri/Cargo.toml` passes.

## Runtime Evidence Attempted But Not Passing

- Real LLM: `scripts/check-v2-real-llm.ps1` reaches the OpenAI-compatible gateway but current `OPENAI_API_KEY` returns HTTP 429 quota/billing failure on the first `idea` mode request, so the three-mode real LLM acceptance is not proven.

## Manual / Runtime Evidence Still Required

- At least 5 live web AI pages show the mascot reliably.
- Insert succeeds on ChatGPT, Claude, and Gemini without auto-send.
- Tauri shell starts as a running app, not only `cargo check`.
- Global shortcut is verified in the running Tauri app.

Do not mark V2 complete until these runtime checks are replaced with concrete pass evidence.

Latest strict check: `scripts/critic-v2.ps1 -RequireRuntimeEvidence` still fails only on `LIVE_5_SITES_PASS`, `INSERT_CHATGPT_PASS`, `INSERT_CLAUDE_PASS`, `INSERT_GEMINI_PASS`, `TAURI_START_PASS`, and `GLOBAL_SHORTCUT_PASS`.
