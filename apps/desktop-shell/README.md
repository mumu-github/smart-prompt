# Smart Prompt Desktop Shell

Tauri V2 desktop shell scaffold for Smart Prompt.

## What It Contains

- Settings UI for OpenAI-compatible base URL, model, and API key.
- Skill folder import UI backed by the local service.
- Local service status and start-service command.
- Global shortcut setting UI.
- Tauri Rust code for tray and global shortcut registration.

## Current Runtime Note

This machine currently does not have Rust/Cargo installed, so `tauri dev` cannot be verified here yet. Static shell checks pass with:

```powershell
npm test
```

After installing Rust and Tauri prerequisites, run:

```powershell
npm install
npm run dev
```
