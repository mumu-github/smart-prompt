verdict=fail

P0=0、P1=1、P2=0。  
本轮为静态只读审查；未修改文件、未运行真实 GUI、未输出 Prompt/草稿/凭证正文。真实 GUI 待外部验收未作为缺陷列入。

**发现**

- 严重级别：P1
- 文件行号：[apps/local-service-sidecar/src/main.rs](</C:/Users/lhy10/Documents/Smart Prompt/apps/local-service-sidecar/src/main.rs:2105>) 2105-2125，尤其 2113；[apps/desktop-shell/src/control-center-app.js](</C:/Users/lhy10/Documents/Smart Prompt/apps/desktop-shell/src/control-center-app.js:563>) 563-567
- 复现：启动 native sidecar 后，请求 `GET /diagnostics/export`；响应体会包含 `diagnostics.dataDir`，值为本机绝对数据目录路径。
- 证据：native `export_diagnostics` 直接写入 `dataDir: data_dir.to_string_lossy()`；桌面端 `loadDiagnostics()` 将服务端 `response.diagnostics` 接入状态。相对地，Node 服务在 [apps/local-service/src/server.js](</C:/Users/lhy10/Documents/Smart Prompt/apps/local-service/src/server.js:599>) 599-602 已剔除 `dataDir` 并只暴露 `dataDirConfigured`，说明 native r6 路径与隐私口径不一致。
- 用户影响：诊断响应会暴露用户本机目录结构和用户名等路径信息，违反“诊断响应不泄露 dataDir”和隐私安全诊断摘要要求；若用户导出或转发诊断材料，可能泄露本地环境信息。
- 修复建议：native `export_diagnostics` 不返回 `dataDir`，改为返回 `dataDirConfigured: true` 或等价布尔状态；补 native sidecar 合约测试，断言 `/diagnostics/export` 不含 `dataDir`，且包含安全的配置状态字段。

**上一轮 P1 复核**

- 扩展 `complete` 激活桥接：通过。`extensionBuildId` 与 `stableReadback` 从证据构造、service client、background normalize 到 Node/native activation store 均被保留并校验；相关位置包括 [activation-evidence.js](</C:/Users/lhy10/Documents/Smart Prompt/prototypes/browser-extension/src/activation-evidence.js:44>)、[local-service-client.js](</C:/Users/lhy10/Documents/Smart Prompt/prototypes/browser-extension/src/local-service-client.js:151>)、[background.js](</C:/Users/lhy10/Documents/Smart Prompt/prototypes/browser-extension/src/background.js:84>)、[activation-store.js](</C:/Users/lhy10/Documents/Smart Prompt/apps/local-service/src/modules/activation/activation-store.js:283>)、[activation.rs](</C:/Users/lhy10/Documents/Smart Prompt/apps/local-service-sidecar/src/activation.rs:468>)。
- 打开 ChatGPT 后立即收起主窗口：通过。`openChatgpt()` 在 `open_chatgpt` 成功后调用 `hide_main_window`；激活完成后也有延迟收起兜底，Tauri close handler 也改为隐藏到托盘。见 [control-center-app.js](</C:/Users/lhy10/Documents/Smart Prompt/apps/desktop-shell/src/control-center-app.js:381>) 与 [main.rs](</C:/Users/lhy10/Documents/Smart Prompt/apps/desktop-shell/src-tauri/src/main.rs:638>)。

**专项检查**

- 严格 `eventId` 晚于 `modelTestedAt`：通过。Node 与 native 都使用严格 `>` 比较；相等或更早会拒绝，见 [activation-store.js](</C:/Users/lhy10/Documents/Smart Prompt/apps/local-service/src/modules/activation/activation-store.js:75>)、[activation.rs](</C:/Users/lhy10/Documents/Smart Prompt/apps/local-service-sidecar/src/activation.rs:156>)。
- r5/r6 版本一致性：通过。扩展激活证据统一要求 `phase3-extension-20260717-r5`；native sidecar/desktop 构建健康标识统一为 `phase3-native-sidecar-20260717-r6`，未发现 r5/r6 混用导致的激活拒绝。
- 七方向新增缺陷：除上述隐私方向 P1 外，新手理解、运行时故障、Provider 错误、ChatGPT DOM/目标错误、no-auto-submit、旧用户迁移与托盘、键盘/焦点/窗口尺寸/范围膨胀方向未发现新的 P0/P1/P2。