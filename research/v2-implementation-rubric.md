# V2 Implementation Rubric

This rubric verifies the Smart Prompt V2 objective:

- Real LLM generation replaces template-only generation for the three modes.
- Site adapters are strengthened for ChatGPT, Claude, Gemini, Perplexity, Lovable, Bolt, v0, and Replit.
- Local prompt/skill library management supports folder import and recommends 1-3 skills.
- A Tauri desktop shell exists with tray, global shortcut, settings, and a local service path.
- Browser extension and desktop shell communicate with a local service.
- Insert fills input boxes but never auto-sends.
- The implementation does not upload whole pages by default.

Passing evidence must include:

1. Code artifacts for browser extension, shared prompt engine, local service, and desktop shell.
2. A local-service API contract and tests covering:
   - settings
   - skill folder scanning
   - skill recommendation
   - three-mode prompt generation through a real LLM gateway path or a test double of that path
3. Browser extension tests covering:
   - at least five site adapter declarations
   - ChatGPT, Claude, and Gemini insert strategies
   - no automatic submit behavior
   - local-service communication fallback behavior
4. Desktop shell verification covering:
   - startup/build command or static validation
   - API key settings UI
   - skill management UI
   - global shortcut configuration
5. A V2 critic script returning PASS only when the above artifacts and tests pass.

Non-passing evidence:

- A written plan without implementation.
- Template-only generation with no LLM gateway path.
- A desktop shell placeholder without settings or shortcut code.
- Insert code that submits messages automatically.
- Tests that do not inspect the V2 acceptance requirements.
