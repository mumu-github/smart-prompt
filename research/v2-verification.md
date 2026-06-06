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
- Live-site probe harness: `scripts/check-v2-live-sites.ps1` launches a temporary browser profile, checks live web AI pages, and writes `research/v2-live-site-probe.latest.json`. Because current Chrome/Edge builds in this environment do not accept command-line unpacked extension loading, the probe records `injectedProbe: true` when it falls back to DevTools injection of the same extension source; those injected results are compatibility evidence, not formal extension-load pass markers.

## Runtime Evidence Attempted But Not Passing

- Real LLM: `scripts/check-v2-real-llm.ps1` reaches the OpenAI-compatible gateway but current `OPENAI_API_KEY` returns HTTP 429 quota/billing failure on the first `idea` mode request, so the three-mode real LLM acceptance is not proven.
- Live sites: the latest injected probe shows display compatibility on ChatGPT, Bolt, v0.app, and Lovable, plus ChatGPT Insert compatibility. Formal live-site acceptance is still not proven because command-line extension loading is blocked in the available Chrome/Edge builds, Claude redirects to sign-in/logout, Gemini shadow input is detected but still does not trigger the mascot, Perplexity is behind a challenge page, and Replit/DeepSeek/Doubao are login/region limited in this environment.

## Manual / Runtime Evidence Still Required

- At least 5 live web AI pages show the mascot reliably.
- Insert succeeds on ChatGPT, Claude, and Gemini without auto-send.

Do not mark V2 complete until these runtime checks are replaced with concrete pass evidence.

Latest strict check after the Tauri runtime smoke still fails only on the formal live-site mascot and ChatGPT/Claude/Gemini Insert evidence. Default `scripts/critic-v2.ps1` still passes, and `scripts/check-v2-real-llm.ps1` still reaches the gateway but returns OpenAI HTTP 429 quota/billing failure.
