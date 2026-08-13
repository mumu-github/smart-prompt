# Phase 3 Activation Adversarial Review

- Verdict: **pass**
- Final severity counts: **P0=0, P1=0, P2=0**
- Review rounds: 3
- Independent reviewer: Codex GPT-5.5, xhigh reasoning, read-only sandbox
- Highest-priority specification: `docs/superpowers/specs/2026-07-17-desktop-activation-control-center-design.md`

## Scope

The review covered new-user comprehension, runtime recovery, Provider failures, ChatGPT target and DOM failures, privacy and no-auto-submit, legacy migration and tray behavior, keyboard/focus/window sizing, and scope control. Real ChatGPT GUI execution was intentionally excluded from the independent read-only reviewer and is tracked separately in the acceptance report.

## Review History

### Round 1

Verdict: fail, P0=0, P1=2, P2=2.

1. **P1: activation evidence was dropped by the extension bridge.**
   - Reproduction: complete a verified insert after a model-backed generation.
   - Evidence: `extensionBuildId` and `stableReadback` were created in `activation-evidence.js` but omitted by `local-service-client.js` and `background.js`.
   - Impact: the service rejected the first real loop as `invalid_activation_completion_evidence`.
   - Fix: preserve and normalize both fields through the complete bridge; add direct and bridged request-body tests.

2. **P1: opening ChatGPT did not immediately hide the control center.**
   - Reproduction: select the wizard action to open ChatGPT.
   - Evidence: `open_chatgpt` ran without `hide_main_window`; hiding happened only after activation.
   - Impact: the first-run window behavior contradicted the Phase 3 activation flow and could interfere with focus.
   - Fix: invoke `hide_main_window` immediately after `open_chatgpt`; add an invocation-order contract assertion.

3. **P2: activation event time accepted equality with the model test time.**
   - Fix: require a strict later-than comparison in Node and Rust; add equality rejection tests.

4. **P2: Node diagnostics returned the absolute data directory.**
   - Fix: remove `dataDir` from the public response and expose only `dataDirConfigured`.

### Round 2

Verdict: fail, P0=0, P1=1, P2=0.

1. **P1: native diagnostics still returned the absolute data directory.**
   - Reproduction: request `GET /diagnostics/export` from the native sidecar.
   - Evidence: native `export_diagnostics` included `dataDir`, unlike the corrected Node response.
   - Impact: diagnostics could disclose local usernames and directory structure.
   - Fix: expose only `dataDirConfigured`; add a native route contract test.

### Round 3

Verdict: pass, P0=0, P1=0, P2=0.

The reviewer confirmed all earlier findings were fixed and found no new P0, P1, or P2 issue.

## Final Directional Audit

| Direction | Result | Evidence |
| --- | --- | --- |
| New-user comprehension | Pass | Provider and browser steps expose one primary action, status, reason, and recovery path. |
| Runtime failures | Pass | Native identity checks, bounded repair, and `needs_repair` handling preserve activated state. |
| Provider errors | Pass | Four normalized error classes and per-Provider key isolation are covered. |
| ChatGPT DOM/target errors | Pass | Composer-only targeting, decoy rejection, structured write, and stable readback are enforced. |
| Privacy and no-auto-submit | Pass | Local/API/research privacy scan passes; no submit or Enter path is present. |
| Legacy migration and tray | Pass | Three legacy paths are covered; desktop attempt/copy cannot activate; close hides to tray. |
| Keyboard, focus, window sizing, scope | Pass | Keyboard focus and responsive visual suites pass; no Phase 3 scope expansion was found. |

## Verification Evidence

- `apps/local-service`: full test suite passed.
- `apps/local-service-sidecar`: native Phase 3 contract suite and `cargo fmt -- --check` passed.
- `prototypes/browser-extension`: full extension suite passed.
- `apps/desktop-shell`: control-center, static, runtime, visual, and Prompt Session runtime suites passed.
- `scripts/check-phase3-privacy.js`: local files, public API responses, logs, and Phase 3 research artifacts passed with zero forbidden keys and zero absolute paths.
- Independent round-three source report: `work/phase3-adversarial-codex-review-round3-gpt55-xhigh.md`.

## External Gate Evidence

- A fresh logged-in ChatGPT tab observed extension build `phase3-extension-20260717-r5` in runtime state `ready`.
- The authorized real loop used a non-sensitive synthetic draft, returned `generatedBy=llm`, allowed an editor change, and completed a `verified_insert` into `chatgpt-composer` with exact stable readback.
- The page path and message count were unchanged, no stop button appeared, and no Send click or Enter key was issued.
- The single observed activation run took `144446 ms`, below three minutes; it is explicitly not reported as a median.
- Restarting the final release against the activated data retained `activated`, started native build r6, exposed tray/global-hotkey infrastructure, and kept both Tauri windows hidden.
