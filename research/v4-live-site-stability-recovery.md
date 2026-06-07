# V4 Live-Site Stability Recovery

V4 accepts this recovery strategy when three consecutive 8-site formal runs are not practical in the current browser state. The strategy is valid only when the latest `research/v3-live-site-formal.latest.json` is already a strict 8-site formal pass.

## Baseline

- Use `scripts/check-v3-live-sites.ps1` for all formal runs.
- Keep `SMART_PROMPT_LIVE_INJECT_FALLBACK=0`.
- Keep `SMART_PROMPT_LIVE_SCHEMA_VERSION=v3-live-site-formal@1`.
- Do not count a run as passing if `injectedProbe` is true, if any redaction leak is present, or if ChatGPT, Claude, or Gemini Insert/no-auto-send fails.
- Use `.runtime/v2-live-chrome-profile` when a stable logged-in browser profile is needed.

## Claude Recovery

If Claude opens a login, logout, or empty composer state:

1. Open a persistent CDP Chrome session:
   `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-v2-claude-cdp.ps1 -ProfileDir .runtime\v2-live-chrome-profile -Url https://claude.ai/new`
2. Complete Claude login in that Chrome window.
3. Re-run Claude formal verification without DevTools fallback:
   `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-v3-live-sites.ps1 -ProfileDir .runtime\v2-live-chrome-profile -SiteIds claude -LoginWaitSeconds 180`
4. Re-run the full 8-site matrix with the same profile:
   `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-v3-live-sites.ps1 -ProfileDir .runtime\v2-live-chrome-profile -LoginWaitSeconds 180`

## Replit Recovery

If Replit has no visible Agent composer:

1. Use `https://replit.com/agent4` as the formal Replit route.
2. Do not use `https://replit.com/ai` or a root-page marketing textarea as pass evidence.
3. If login is required, complete login in `.runtime/v2-live-chrome-profile`.
4. Re-run:
   `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-v3-live-sites.ps1 -ProfileDir .runtime\v2-live-chrome-profile -SiteIds replit -LoginWaitSeconds 180`
5. Re-run the full 8-site matrix after the Replit single-site pass.

## Stability Interpretation

- A single latest strict formal pass plus this recovery strategy is V4 acceptable evidence for `LIVE_SITE_STABILITY_PASS` when three consecutive full runs cannot be made reliable without user login state.
- Any future run that fails because of login, challenge, route change, `injectedProbe`, or redaction leak must be treated as a recovery-required run, not as a pass.
- A true three-run pass can supersede this recovery evidence when available.
