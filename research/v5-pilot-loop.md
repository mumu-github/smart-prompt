# Smart Prompt V5 Pilot Loop

## Scope

V5 beta pilot uses real AI web workflows plus the local desktop shell. The extension still must not auto-send and must not upload full page content by default.

## Scenarios

Scenario 1: ChatGPT prompt drafting

- Target: `chatgpt.com`
- Workflow: focus composer, open mascot card, generate `idea`, Insert into composer, verify no auto-send.
- Current baseline: V3 formal live-site evidence reports ChatGPT display, Insert, and no-auto-send as pass.
- Metric: Insert success rate, Retry count, Undo count, save adoption.

Scenario 2: Claude prompt refinement

- Target: `claude.ai`
- Workflow: reuse logged-in Chrome profile, open Claude composer, generate `polish`, Insert, verify no auto-send.
- Current baseline: Claude requires login/profile recovery; adapter remains in the 8-site matrix and Insert pass is recorded with the persistent profile.
- Metric: Insert success rate by adapter, login recovery hit, Undo count.

Scenario 3: Gemini continuation prompt

- Target: `gemini.google.com`
- Workflow: focus Gemini composer, generate `continue`, Insert, verify no auto-send.
- Current baseline: V3 formal live-site evidence records Gemini Insert and no-auto-send pass.
- Metric: Insert success rate, accepted prompt length, generatedBy source.

Scenario 4: Desktop first-run and local library

- Target: Tauri desktop shell plus local service.
- Workflow: start service, save provider key, test provider, import local skill folder, save a reusable prompt, export diagnostics.
- Current baseline: desktop interaction tests cover key save, provider test, skill import/delete, prompt save/delete, diagnostics export, and clear local data.
- Metric: provider-test pass rate, skill import count, save rate, diagnostics export success.

Scenario 5: Replit/Bolt/v0 adapter drift watch

- Target: `replit.com/agent4`, `bolt.new`, `v0.app`.
- Workflow: verify mascot display on each site, keep Insert off unless the site is in the strict Insert acceptance list, update adapter selectors when composer routes change.
- Current baseline: Replit adapter was updated from `/ai` to `/agent4`; v0 host coverage includes `v0.app`; Bolt remains in display matrix.
- Metric: adapter display success rate, failed selector reason, route recovery note.

## Metrics

- Insert success rate: successful verified Insert events divided by attempted Insert events, grouped by adapter id and site.
- Save rate: saved prompts divided by ready prompt cards shown.
- Undo usage rate: Undo actions divided by successful Insert events.
- Retry usage rate: Retry actions divided by prompt card generations.
- Adapter failure rate: failed display or write attempts divided by scenario runs for each adapter.

The browser extension records `insert`, `retry`, `undo`, and `favorite/save` feedback locally. The local service exposes `/metrics` and `/diagnostics/export` for pilot summaries without storing full page text, page title, provider keys, or full prompt evidence in release reports.

## Current Beta Baseline

- Live-site display baseline: 8/8 sites in the V3 formal matrix.
- Strict live-site Insert baseline: 3/3 required Insert sites, covering ChatGPT, Claude, and Gemini.
- Strict no-auto-send baseline: 3/3 required Insert sites.
- Runtime prompt-card baseline: Retry, Insert, Undo, online Save, and offline Save are covered by the extension runtime demo.
- Desktop baseline: first-run, provider test, skill import, prompt library, diagnostics export, restart, and clear local data are covered by desktop interaction tests.

## Adapter Updates From Failures

- Claude: use persistent login profile recovery before formal Insert validation.
- Replit: use `/agent4` as the formal agent composer route; reject root marketing textareas and `/ai` when no real agent composer is visible.
- v0: include `v0.app` host coverage in manifest and adapter checks.
- All sites: live-site probe evidence is redacted and records adapter id, selector usage, and failure reason without storing full URL, title, prompt body, or input value.

## Stop Conditions

- Beta can ship when the release package has checksums and tag, native sidecar starts from the installed app, diagnostics export works, and no pilot scenario requires auto-send or full-page upload.
- Any adapter failure that affects ChatGPT, Claude, or Gemini Insert blocks release until selector or route recovery is updated and revalidated.
