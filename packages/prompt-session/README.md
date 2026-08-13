# Prompt Session

Smart Prompt 的共享产品状态模块。它负责状态机、命令、有限 reason、双语核心文案和 Assistant View Model，不负责 DOM、Windows UIA 或 Tauri IPC。

## 使用

```js
const session = SmartPromptSession.createPromptSession({ generator, target, settings });
session.subscribe(render);
session.open({ draft, targetCapability });
await session.dispatch({ type: SmartPromptSession.COMMANDS.GENERATE });
```

完整契约见 `docs/assistant-state-spec.md`。

## 验证与同步

```powershell
npm.cmd test
node ..\..\scripts\sync-prompt-session-runtime.js
```

不要直接编辑端侧 `src/prompt-session.js`，它们是从本目录 `index.js` 同步的运行时副本。

