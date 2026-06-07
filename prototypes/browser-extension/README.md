# Smart Prompt Browser Extension Prototype

第一版实现目标：按 `docs/prd.md` 的 M1 里程碑先交付 Chrome/Edge MV3 浏览器 MVP。

## 已实现

- allowlist 网页 LLM/Agent 输入框检测：ChatGPT、Claude、Gemini、Perplexity、Lovable、Bolt、v0、Replit。
- 悬浮小人入口：使用项目内既有小人六态 PNG，不重新设计角色。
- 三模式判断：空输入求思路、半成品续写、完整输入优化。
- Prompt card：Refresh、Edit、Copy、Save、Insert。
- 一键填入：DOM 写入并触发 `input` / `change`，不自动发送。
- 本地 skill 导入：options 页支持粘贴或选择 Markdown / rules 文本，默认只作为文本建议引用。
- V3 本地服务桥接：先向可信本地服务执行 `/auth/bootstrap`，再带 `Authorization: Bearer <token>` 请求 `http://127.0.0.1:17371/generate`；服务不可用时回退本地模板。
- 站点适配器：ChatGPT、Claude、Gemini、Perplexity、Lovable、Bolt、v0、Replit。
- 无依赖测试：prompt engine 和 manifest 结构校验。

## 本地加载

1. 打开 Chrome/Edge 扩展管理页。
2. 开启开发者模式。
3. 选择“加载已解压的扩展程序”。
4. 选择本目录：`prototypes/browser-extension`。

## 验证

```powershell
npm test
```

也可以打开 `demo/demo.html` 做本地视觉检查；它会用同一套 content script 模拟扩展运行。

## V2 本地服务

先启动：

```powershell
cd ..\..\apps\local-service
npm start
```

再加载扩展。Prompt Card 会优先走真实 LLM gateway；若未配置 API key，则本地服务会按 `allowTemplateFallback` 返回模板结果。

V3 bridge behavior:
- Generate calls `POST /generate` first and falls back to the extension template when the desktop/local service is unavailable.
- Save calls `POST /prompts` first so saved prompts enter the local prompt library; if the service is offline, it falls back to `chrome.storage.local`.
- Insert only writes into the active input box. It does not submit, press Enter, or upload whole-page text by default.
- The local bridge bootstraps a per-install auth token and does not rely on wildcard CORS.
- Insert records an after-write verification result with strategy, input kind, and reason. A failed verification leaves the card open.
- Prompt cards show a skill basis line and a privacy summary based on origin/pathKind only, without page title or page body.

## 当前边界

- 这是浏览器 MVP，不包含 Tauri/Electron 桌面壳。
- 未实现 Windows UI Automation / macOS AXUIElement。
- prompt 生成先使用本地模板与 skill routing，不调用 LLM。
- contenteditable 编辑器的一键填入使用 DOM 写入，复杂编辑器后续需要站点适配器增强。
