# Smart Prompt V3 Verification

## Scope

Current V3 coverage includes local-service auth, narrowed CORS, evidence redaction, Tauri CSP/capability hardening, and encrypted provider-key persistence.

## Evidence

- `LOCAL_SERVICE_AUTH_PASS`: protected local-service APIs require a per-install auth token.
- `CORS_NARROWED_PASS`: protected APIs do not emit `Access-Control-Allow-Origin: *`; disallowed origins are rejected.
- `CLIENT_AUTH_PASS`: browser extension and desktop shell bootstrap the local auth token and send `Authorization: Bearer <token>`.
- `EVIDENCE_REDACTION_PASS`: V2/V3 runtime evidence is redacted and V3 reports do not retain API keys, tokens, full URLs, profile paths, or prompt/value bodies.
- `TAURI_SECURITY_PARTIAL_PASS`: desktop shell has CSP, a main-window-only capability, removed shell plugin, explicit Rust invoke handler, and provider keys are no longer persisted in plaintext `settings.json`. `withGlobalTauri` remains enabled but narrowed by capability because the shell is still a static app without an API bundler.
- `V3_SECURITY_CRITIC_PASS`: `scripts/critic-v3-security.ps1` passes.

## Reports

- `research/v3-security-privacy.latest.json`
- `research/v3-tauri-security.latest.json`
- `research/v2-live-site-probe.latest.json`
- `research/v2-claude-insert.latest.json`
- `research/v2-real-llm.latest.json`
- `research/v2-tauri-runtime.latest.json`

## Verification Commands

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v3-security.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v2.ps1 -RequireRuntimeEvidence
```

The V3 critic covers local-service security/privacy, evidence redaction, Tauri CSP/capability checks, credential-vault plaintext checks, and local package tests.

Note: one parallel run of V2 strict critic and V3 security critic timed out because both suites use local browser/runtime tests and can contend for the same local-service port. Running each critic independently passed.
