verdict=pass

P0=0，P1=0，P2=0。

本轮按只读静态审查完成，未修改文件，未运行真实 GUI，未输出 Prompt、草稿或凭证正文。真实 ChatGPT GUI 外部验收仍是未覆盖项，但按你的边界不计为代码缺陷。

**此前 P1 复核**
- 扩展 `complete` 桥接已保留 `extensionBuildId` 与 `stableReadback`：`prototypes/browser-extension/src/activation-evidence.js:44`、`prototypes/browser-extension/src/local-service-client.js:151`、`prototypes/browser-extension/src/background.js:75`。
- 打开 ChatGPT 后立即隐藏主窗口：`apps/desktop-shell/src/control-center-app.js:381` 调用 `open_chatgpt` 后紧接 `hide_main_window`，native hide 实现在 `apps/desktop-shell/src-tauri/src/main.rs:638`。
- Node/native `/diagnostics/export` 对外不返回 `dataDir`：Node 在 `apps/local-service/src/server.js:599` 剥离 `dataDir` 并只返回 `dataDirConfigured`；native 在 `apps/local-service-sidecar/src/main.rs:2105` 只返回 `dataDirConfigured`。内部 `store.exportDiagnostics()` 仍含 `dataDir`，但对外路由已过滤，未计缺陷。

**关键一致性**
- `eventId` 严格晚于 `modelTestedAt`：Node 为 `>` 判断，见 `apps/local-service/src/modules/activation/activation-store.js:75`；native 同样为严格晚于，见 `apps/local-service-sidecar/src/activation.rs:156`。等时拒绝测试覆盖在 `apps/local-service/tests/activation.test.js:47` 与 `apps/local-service-sidecar/tests/phase3-contract.test.js:330`。
- r5/r6 一致：扩展与 activation 服务使用 `phase3-extension-20260717-r5`，见 `prototypes/browser-extension/src/activation-evidence.js:2`、`apps/local-service/src/modules/activation/activation-store.js:6`、`apps/local-service-sidecar/src/activation.rs:7`；desktop/native diagnostics 使用 r6，见 `apps/desktop-shell/src/control-center-app.js:3`、`apps/desktop-shell/src-tauri/src/main.rs:48`。
- `no-auto-submit` 与 DOM 目标校验未放松：ChatGPT 仅接受 composer 目标并要求稳定回读，见 `prototypes/browser-extension/src/site-adapters.js:30`、`:165`、`:194`；插入路径不提交且失败也保持 `noAutoSubmit: true`，见 `prototypes/browser-extension/src/content.js:1080`、`:1115`、`:1124`。静态测试禁止 submit/Enter 注入，见 `prototypes/browser-extension/tests/site-adapters.test.js:218`。

**七方向审查结论**
- 新手理解：Control Center 状态、repair/activated 分支清楚，未见误导性自动提交或隐式授权。
- 运行时故障：健康检查、repair 窗口、激活后隐藏主窗路径存在，未见阻断性状态回退。
- Provider 错误：错误归一化不泄露原始 provider 文本，测试覆盖 `apps/local-service/tests/activation.test.js:326`、`apps/desktop-shell/tests/control-center.test.js:103`。
- ChatGPT DOM/目标错误：decoy composer 被拒，稳定回读失败不激活，覆盖在 `prototypes/browser-extension/tests/site-adapters.test.js:143`。
- 隐私与 no-auto-submit：证据只记录元数据与长度，不记录正文；诊断出口不返回 `dataDir`。
- 旧用户迁移与托盘：迁移只接受 browser-extension + ChatGPT verified insert/copy，见 `apps/local-service/src/modules/activation/activation-store.js:331`；托盘关闭隐藏、显式 quit 停服务，见 `apps/desktop-shell/src-tauri/src/main.rs:1175`、`:1224`。
- 键盘/焦点/窗口尺寸/范围膨胀：未见 submit/Enter 注入；ChatGPT 后主窗隐藏；未发现超出阶段3控制中心规范的新增运行时范围。

限制：本轮没有执行测试命令或真实 GUI，因为用户明确要求只读且不运行真实 GUI。结论基于当前源码与现有测试覆盖的静态复核。