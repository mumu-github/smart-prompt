verdict=fail（存在 P1；未发现 P0）。本次只读审查，未修改文件。真实 GUI 尚待重载按外部验收缺口处理，未计为代码缺陷。

**P0**
未发现。

**P1**
1. 扩展完成激活时丢失 `extensionBuildId` / `stableReadback`，真实 ChatGPT 闭环无法激活  
文件行号：[content.js](<C:/Users/lhy10/Documents/Smart Prompt/prototypes/browser-extension/src/content.js:221>)、[local-service-client.js](<C:/Users/lhy10/Documents/Smart Prompt/prototypes/browser-extension/src/local-service-client.js:151>)、[background.js](<C:/Users/lhy10/Documents/Smart Prompt/prototypes/browser-extension/src/background.js:83>)、[server.js](<C:/Users/lhy10/Documents/Smart Prompt/apps/local-service/src/server.js:951>)、[activation-store.js](<C:/Users/lhy10/Documents/Smart Prompt/apps/local-service/src/modules/activation/activation-store.js:283>)、[activation.rs](<C:/Users/lhy10/Documents/Smart Prompt/apps/local-service-sidecar/src/activation.rs:468>)  
复现：`model_ready` 后在 ChatGPT 执行 verified insert/copy；content 侧构造了含 r5 build 与 stable readback 的 payload，但 `completeActivation()` 和 background bridge 重新组包时丢弃这两个字段。  
证据：local service/native 都要求 `extensionBuildId == phase3-extension-20260717-r5`；verified insert 还要求 `stableReadback === true`。字段被丢弃后服务端会看到空 build/false readback，并拒绝为 `invalid_activation_completion_evidence`。  
影响：首次真实激活不能进入 `activated`，属于阶段3首激活/真实 ChatGPT loop 阻断。  
建议：在 `local-service-client.completeActivation()` 和 background `normalizeActivationPayload("complete")` 中保留 `extensionBuildId`、`stableReadback`；增加断言实际 `/activation/complete` 请求体含 r5/stableReadback 的测试。

2. 首次打开 ChatGPT 后没有按规格收起主窗口到托盘  
文件行号：[spec](<C:/Users/lhy10/Documents/Smart Prompt/docs/superpowers/specs/2026-07-17-desktop-activation-control-center-design.md:49>)、[control-center-app.js](<C:/Users/lhy10/Documents/Smart Prompt/apps/desktop-shell/src/control-center-app.js:381>)、[main.rs](<C:/Users/lhy10/Documents/Smart Prompt/apps/desktop-shell/src-tauri/src/main.rs:647>)、[control-center-app.js](<C:/Users/lhy10/Documents/Smart Prompt/apps/desktop-shell/src/control-center-app.js:517>)  
复现：控制中心点击打开 ChatGPT，前端只调用 `open_chatgpt` 并开始轮询；Tauri 命令只打开 URL；`hide_main_window` 只在激活成功后延迟调用。  
证据：规格要求“打开 ChatGPT 并收起到托盘”，验收也要求主窗口 shrink to tray；当前实现把收起放在 activated 之后。  
影响：首次激活流程窗口行为不符合阶段3最高规格，可能干扰焦点/窗口验收。  
建议：在首次激活路径 `open_chatgpt` 成功后显式调用 `hide_main_window`，或提供单一 Tauri 命令 `open_chatgpt_and_hide_main_window`；补控制中心 invoke 顺序测试。

**P2**
1. `eventId` 与 `modelTestedAt` 的时间关系允许相等，不是严格晚于  
文件行号：[activation-store.js](<C:/Users/lhy10/Documents/Smart Prompt/apps/local-service/src/modules/activation/activation-store.js:75>)、[activation.rs](<C:/Users/lhy10/Documents/Smart Prompt/apps/local-service-sidecar/src/activation.rs:156>)、[phase3-contract.test.js](<C:/Users/lhy10/Documents/Smart Prompt/apps/local-service-sidecar/tests/phase3-contract.test.js:288>)  
复现：构造 `activationEventId` 时间戳等于 `modelTestedAt`，且 `completionKind` 匹配；JS/Rust 当前用 `>=` 会放行。  
证据：测试覆盖了 `+1ms` 成功和 `-1ms` 拒绝，没有 equality case。  
影响：边界 replay 防护弱于“eventId 晚于 modelTestedAt”的要求。  
建议：JS/Rust 改为 `>`，新增 equality rejection 测试。

2. 服务器诊断导出仍包含完整 `dataDir` 路径  
文件行号：[store.js](<C:/Users/lhy10/Documents/Smart Prompt/apps/local-service/src/store.js:973>)、[server.js](<C:/Users/lhy10/Documents/Smart Prompt/apps/local-service/src/server.js:599>)、[control-center-app.js](<C:/Users/lhy10/Documents/Smart Prompt/apps/desktop-shell/src/control-center-app.js:573>)  
复现：调用 `/diagnostics/export` 返回 store 的完整 diagnostics；Phase3 UI 下载时裁剪为安全子集，但服务端响应对象本身仍含本机路径。  
证据：UI 导出只写 `version/service/sidecar/health/activation` 等字段，说明前端已意识到需要最小化；服务端原始 diagnostics 仍暴露 `dataDir`。  
影响：本机用户名/目录结构可能出现在诊断响应中，隐私边界不够紧。  
建议：服务端也 redaction，或仅返回 `dataDirConfigured: true` / 路径 hash，不返回完整路径。

**已核对未列缺陷**
扩展版本为 `0.2.6`，build id 为 r5；native build id 为 r6。`browser-seen` 早期拒绝已在 JS/native 实现。pending activation 替换逻辑存在。no-auto-submit 与 ChatGPT DOM 目标未发现 P0/P1 级问题。迁移逻辑未见把 desktop attempt 误升级为 activated 的问题。