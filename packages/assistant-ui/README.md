# Assistant UI

网页扩展与桌面 Overlay 共用的无框架 Assistant Card。组件使用 Shadow DOM 隔离宿主样式，只消费 `prompt-session@1` View Model，不读取浏览器 DOM、Windows UIA 或 Tauri IPC。

```js
const card = SmartPromptAssistantUI.mountAssistantCard(host, {
  stylesheetUrl: "src/assistant-card.css",
  mascotUrl: "src/assets/mascot-states/suggesting.png",
  onAction: ({ id, value, editorValue, mode, outcomeId, candidateId }) => {
    handleAction({ id, value, editorValue, mode, outcomeId, candidateId });
  }
});

card.render(viewModel, { value: editedPrompt, mode: "polish" });
```

Card 可选消费 `pendingOutcome` 与 `learningCandidate`。Outcome 优先于候选提醒；候选的 `ignoredCount >= 3` 时不显示。

稳定动作契约：

- `outcome-completed`：`value="completed"`，同时提供 `outcomeId`。
- `outcome-not-completed`：`value="not_completed"`，同时提供 `outcomeId`，随后在卡片内展开原因。
- `outcome-reason`：`value` 只能是 `missing_context`、`wrong_format`、`not_actionable`、`too_long`、`token_waste`、`tool_mismatch`、`low_quality`、`insert_failed` 之一，同时提供 `outcomeId`。
- `candidate-review` / `candidate-ignore`：`value` 与 `candidateId` 都是候选 ID。

注意区动作使用自己的 `value`；原编辑器内容始终单独放在 `editorValue`。普通生成、复制和填入动作继续把编辑器内容放在 `value`，保持现有调用方兼容。

不要直接编辑端侧 `src/assistant-card.js` 与 `src/assistant-card.css`；它们由 `scripts/sync-assistant-ui-runtime.js` 从本目录同步。
