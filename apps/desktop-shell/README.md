# Smart Prompt Desktop Shell

Tauri desktop shell scaffold for Smart Prompt V3.

## What It Contains

- Settings UI for provider, base URL, model, and provider API keys.
- Skill folder import UI backed by the local service.
- Local service status and start-service command.
- Global shortcut setting UI.
- Tauri Rust code for tray and global shortcut registration.
- V3 release hardening: CSP is configured, IPC is limited to explicit Rust commands, the main window has a dedicated capability, and provider keys are persisted by the local service credential vault instead of plaintext `settings.json`.

## Security Notes

The current static shell still uses `withGlobalTauri: true` because there is no frontend bundler yet for `@tauri-apps/api` imports. V3 narrows that surface with a single labeled `main` window, a main-window-only capability, strict CSP, and removal of the unused shell plugin.

The desktop shell never stores API keys by itself. It sends them once to the protected local service over `Authorization: Bearer <per-install-token>`; the local service handles encrypted credential persistence.

## Test

```powershell
npm test
```

With Rust and Tauri prerequisites installed, run:

```powershell
npm install
npm run dev
```
