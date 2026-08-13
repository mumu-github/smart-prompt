## 2026-06-13 p25 browser-like 阻塞诊断补强

- 只在 `scripts/check-p25-composer-candidate-diagnostics.ps1` 与 `scripts/check-p25-real-overlay-click-fill.ps1` 增加了只读诊断信号，不改变 safe 选取条件与 Fill guard。
- 主要新增：`browserLikeDeficitSummary`（缺失信号计数）并透传至 real-overlay report 的 `safeCandidateDiagnostics.browserLikeDeficitSummary`，用于不放宽写入的前提下明确阻塞原因。
- 校验方式：PowerShell parser、只读 composer diagnostics、只读 real-overlay（未带 `-AllowRealOverlayClick`）。
- 未执行：`-AllowRealOverlayClick`，未启动/停止/替换桌面壳或 sidecar，未进行真实 fill。
# 当前进度

## 2026-06-16 小人随真实工具出现/最小化快速显隐

- 已把桌面小人的显隐绑定从单纯前端轮询加强为“双层守卫”：
  - `apps/desktop-shell/src-tauri/src/main.rs` 新增原生前台窗口 watcher，每 `80ms` 读取 Win32 前台窗口元数据；前台不是 Codex/WorkBuddy/Trae、窗口最小化、不可见或 cloaked 时，原生层直接 `SW_HIDE` overlay。
  - `apps/desktop-shell/src/app.js` 将 fast poll 从 `180ms` 收紧到 `100ms`，并监听 `smart-prompt-foreground-window-state` 原生事件；恢复可见时先过 fast gate，再补慢快照。
  - 为 fast poll / slow snapshot 增加 pending 补跑，避免“正在请求中”的显隐变化被丢掉。
- 已补 `apps/desktop-shell/tests/desktop-shell-interaction.test.js`：覆盖原生前台事件触发显示、未知/最小化隐藏、隐藏后旧慢快照不能复活小人、恢复可见后重新显示。
- 验证通过：`node --check apps/desktop-shell/src/app.js`、`npm.cmd test --prefix apps/desktop-shell`、`cargo check --manifest-path apps/desktop-shell/src-tauri/Cargo.toml --target-dir apps/desktop-shell/src-tauri/target-p25-check`、`npm.cmd test --prefix apps/local-service`、`node scripts/check-p25-overlay-chat-visual.js`、`npm.cmd run build --prefix apps/desktop-shell`。
- 已停止旧 `smart-prompt-desktop.exe` 并启动新版 canonical 生产包：PID `140332`，SHA256 前缀 `befc0c1a8851e6be`。
- 真实运行态复验：
  - Codex 严格前台：只读 target probe 显示 `strictForegroundDetected=true`、`targetSafeCandidateCount=1`、`writeAttempted=false`。
  - Codex 前台后 overlay 自动出现：`visible=true`、`rect=72x72`、`noActivate=true`、`topmost=true`。
  - 受控最小化真实 Codex 窗口后：`check-p25-overlay-background-hide.ps1` 通过，`completionImpact=overlay_hidden_when_target_backgrounded`；随后恢复 Codex，overlay 再次自动出现。
- 本轮没有执行真实 overlay click，没有写真实 composer，没有读取 `/desktop/fill/latest`。

## 2026-06-14 展开小人面板降密度与中文默认收口

- 已简化 `apps/desktop-shell/src/overlay.css` 的 expanded 空状态：隐藏 evidence/debug 行、对话行、重复动作行和快捷词行；空状态只保留顶部状态、模式/语言、输入区和主按钮，输入框高度增加。
- 已把中文默认态的语言按钮改为“中文 / 英文”，并把 overlay 输入占位词从“写给 Smart Prompt”改为“写下要处理的内容”，减少默认中文界面里的英文混杂。
- 已更新 `scripts/check-p25-overlay-chat-visual.js`：新增中文 waiting 截图 `research/p25-overlay-chat-waiting-zh.png` 与 `zhWaitingPass=true`；断言空状态快捷词隐藏、无 evidence 行、无溢出/裁切/白块。
- 验证通过：`node scripts/check-p25-overlay-chat-visual.js`、`npm test --prefix apps/desktop-shell`。
- 已重建并启动 canonical 生产包 `apps/desktop-shell/src-tauri/target/release/smart-prompt-desktop.exe`，PID `31448`，SHA256 前缀 `bc00d4117f0ca69b`。
- 只读真实视觉 attach 通过：`visualRuntimeReady=true`、overlay `72x72`、`noActivateStyle=true`、`largeWhiteBlockAbsent=true`；本轮未执行真实 overlay click、未写真实 composer、未读 `/desktop/fill/latest`。

## 2026-06-13 真实工具退后台时同步隐藏小人

- 已修 `apps/desktop-shell/src/app.js`：sticky overlay 只允许在仍属于支持工具的 overlay-eligible 快照里短暂保留；当前台切到未知/不支持窗口（例如工具退后台）时立即走 `hide_mascot_overlay`，不再保留小人。
- 已补 `apps/desktop-shell/tests/desktop-shell-interaction.test.js`：用 unknown/LockApp 快照覆盖退后台场景，断言最后一条 overlay 命令为 `hide_mascot_overlay`。
- 验证通过：`node --check apps/desktop-shell/src/app.js`、`node --check apps/desktop-shell/tests/desktop-shell-interaction.test.js`、`npm test --prefix apps/desktop-shell`、`node scripts/check-p25-overlay-chat-visual.js`。
- 已重建并启动最新生产桌面壳：`apps/desktop-shell/src-tauri/target/release/smart-prompt-desktop.exe`，SHA256 前缀 `a653941572f14530`；视觉运行态仍为 `72x72`、no-activate、无大白块。
- 未执行：真实 overlay click、真实 composer 填入、`/desktop/fill/latest`。

## 2026-06-14 退后台隐藏节奏与专用验证

- 已把桌面 overlay 自动探测节奏从 `1400ms` 收紧到 `500ms`，减少 Codex/WorkBuddy/Trae 退后台后小人滞留体感。
- 已补测试断言：auto interval 为 `500ms`，且 unknown/LockApp 退后台快照后最后一条 overlay 命令为 `hide_mascot_overlay`。
- 已补聚合静态证据：`autoDetectPollsSnapshot=true` 现在匹配 `500ms`；新增 `overlayTransientKeepRequiresEligibleProfile=true`，确认 sticky keep 必须仍属于支持工具。
- 新增 `scripts/check-p25-overlay-background-hide.ps1`：只 attach 当前 overlay 元数据，验证“进程在、overlay 窗口存在但不可见、no-activate、未点击/未写入/未截图保存”。
- 已重建并启动最新生产包 `apps/desktop-shell/src-tauri/target/release/smart-prompt-desktop.exe`，SHA256 前缀 `1ced659ab2893db6`，进程 PID `43256`。
- 退后台专用验证通过：`research/p25-overlay-background-hide.latest.json` 显示 `pass=true`、`completionImpact=overlay_hidden_when_target_backgrounded`、`windowHidden=true`、`noActivateStyle=true`。
- 仍未执行：真实 overlay click、真实 composer 填入、`/desktop/fill/latest`。

## 2026-06-13 真实工具小人避开提交按钮复验

- 已直接修正真实 Codex/WorkBuddy/Trae 小人的 compact 定位：按钮锚点时放到按钮左侧；输入容器锚点时放到输入框上方并预留右侧提交按钮区域。
- 已重建真正生产包 `apps/desktop-shell/src-tauri/target/release/smart-prompt-desktop.exe`，候选 hash 前缀 `36a2eb894d975b69`，并启动最新进程做视觉复验。
- 复验通过：`visualRuntimeReady=true`、真实 overlay 窗口 `72x72`、`noActivateStyle=true`、`largeWhiteBlockAbsent=true`、未保存截图、未执行真实点击/填入/latest-fill。
- 几何核算通过：当前 Codex visual anchor 为 `bottom-container`；按 2x 保守尺寸计算，小人与底部按钮候选重叠数为 `0`。
- 仍未放行真实填入：Codex 只读诊断仍为 `safeCandidateCount=0`、`browserLikeComposerCandidateCount=1`，所以没有运行 `-AllowRealOverlayClick`。

## 2026-06-13 真实窗口 attach 证据接入聚合

- 已固化视觉总控的“只验小人窗口，不做真实点击/填入”边界：
  - `scripts/check-p25-desktop-shell-visual-runtime.ps1` 新增 `foregroundFillAttempted=false`、`fillLatestReadAttempted=false`、`doesNotPollLatestFill=true`、`visualRunDoesNotAttemptRealClickOrFill=true`。
  - `scripts/check-p25-overlay-click-chain.ps1` 新增静态检查 `desktopShellVisualRuntimeVerifierPresent=true`、`desktopShellVisualRuntimeNoRealClickOrFill=true`，确认视觉总控不含 `-AllowRealOverlayClick`、`/desktop/fill` 或 `/desktop/fill/latest` 路径。
- 已补 `scripts/start-p25-desktop-shell-candidate.ps1` 的 `diagnostics`：区分 `start_not_allowed`、已有进程阻塞、candidate ready、runtime process match，并给出 `nextAction`；仍不停止、不 kill、不替换已有进程。
- 已补 `scripts/check-p25-desktop-shell-visual-runtime.ps1` 的 `diagnostics`：汇总 candidate、start gate、runtime match、auto-detect 静态证据、overlay window missing/geometry/white-block/no-activate、safe candidate 和下一步动作。
- 已补聚合 `scripts/check-p25-overlay-click-chain.ps1`：静态检查新增 `desktopShellStartDiagnosticsPresent=true`，runtime/evidence 输出 `desktopShellStartExistingProcessBlocksStart`、`desktopShellStartSafeToStartWithoutStoppingExisting`、`desktopShellStartNextAction`。
- 已补前端 auto-detect 显式证据：`autoDetectBootstrapsOnAppLoad=true`、`autoDetectStartsLocalService=true`、`autoDetectPollsSnapshot=true`、`autoDetectDoesInitialRefresh=true`、`interactionTestCoversAutoShow=true`；桌面运行时总控新增 `frontendAutoDetect.readyForAuthorizedStart=true`。
- 已补截图式白块回归探针：`scripts/check-p25-overlay-chat-visual.js` 新增 `whiteBlockRegressionProbe`，使用 `384x380` 大视口渲染 `compact + thinking`，要求 body/card/button 仍为 `72x72`、chat 隐藏、透明背景、`largeWhiteBlockAbsent=true`；聚合与桌面视觉总控新增 `overlayChatVisualWhiteBlockRegressionOk=true`。
- 已为 `scripts/check-p25-overlay-window-visual-attach.ps1` 增加 `-TimeoutSeconds` 和 `wait.pollCount`：授权启动后可等待 auto-detect 让真实 overlay 窗口出现；默认仍只 attach，不启动、不点击、不写入。
- 已优化 `scripts/check-p25-desktop-shell-visual-runtime.ps1`：未授权且无桌面壳进程时 attach 等待上限收敛到 3 秒；授权启动或已有进程时使用完整 `-TimeoutSeconds` 等待真实 overlay。
- 已更新 `scripts/check-p25-overlay-click-chain.ps1`：新增 `-OverlayVisualAttachReport`，聚合报告现在直接读取 `p25-overlay-window-visual-attach@1`。
- 聚合静态检查新增 `overlayWindowVisualAttachVerifierPresent=true` 与 `overlayWindowVisualAttachVerifierNoStartOrClick=true`，确认该 verifier 默认只 attach，不启动、不点击、不写入。
- 聚合 runtimeChecks 新增真实窗口字段：`overlayVisualAttachReportPresent`、`overlayVisualAttachPass`、`overlayVisualAttachWindowFound`、`overlayVisualAttachWindowCount`、`overlayVisualAttachGeometryOk`、`overlayVisualAttachLargeWhiteBlockAbsent`、`overlayVisualAttachSafetyOk`、`overlayVisualAttachPrivacyOk`。
- 已更新 `scripts/check-p25-desktop-shell-visual-runtime.ps1`：默认也会运行 attach-only 真实窗口检查；即使没有 `smart-prompt-desktop.exe` 进程，也生成 fresh `overlay_window_missing` 报告，而不是 `ran=false`。
- 本轮默认只读验证结果：
  - `scripts/check-p25-desktop-shell-visual-runtime.ps1 -AllowFailure`：`startAttempted=false`、`processCount=0`、`overlayWindowCount=0`、`overlayVisualAttach.ran=true`、`overlayVisualAttach.timeoutSeconds=3`、`overlayVisualAttach.completionImpact=overlay_window_missing`、`realOverlayClickAttempted=false`、`rawDesktopPixelsPersisted=false`。
  - 同轮安全边界：`foregroundFillAttempted=false`、`fillLatestReadAttempted=false`、`doesNotPollLatestFill=true`、`desktopShellVisualRuntimeNoRealClickOrFill=true`。
  - 最新 `diagnostics`：`candidateReady=true`、`frontendAutoDetect.readyForAuthorizedStart=true`、`overlayAutoDetectStaticEvidence=true`、`runtimeProcessMissing=true`、`overlayWindowMissing=true`、`targetSafeCandidatesReady=false`、`nextAction=explicitly_allow_start_to_verify_real_overlay_window`。
  - `research/p25-overlay-click-chain.latest.json`：`overlayVisualAttachReportFresh=true`、`overlayVisualAttachWindowFound=false`、`overlayVisualAttachWindowCount=0`、`overlayVisualAttachSafetyOk=true`、`overlayVisualAttachPrivacyOk=true`。
  - `research/p25-overlay-chat-visual.latest.json`：`pass=true`、`whiteBlockRegressionProbe.viewport=384x380`、`whiteBlockRegressionProbe.state=thinking`、`whiteBlockRegressionProbe.largeWhiteBlockAbsent=true`、`whiteBlockRegressionProbe.screenshotTransparency.opaqueRatio=0.0045`。
- 当前结论更明确：工具里没有新版小人，是因为真实桌面壳/真实 overlay 窗口不存在；不是 Draft/Prompt 同步问题，也不是离线 overlay UI 没改。
- 仍未执行：`-AllowStartDesktopShell`、`-AllowRealOverlayClick`、真实 composer 写入/latest-fill。

## 2026-06-13 真实桌面 overlay attach 取证

- 已新增 `scripts/check-p25-overlay-window-visual-attach.ps1`：只枚举现有 `Smart Prompt Mascot` 窗口并读取窗口尺寸/样式/屏幕像素比例；默认不启动进程、不点击、不写目标输入框、不保存截图。
- 该脚本默认只写元数据：title 仅写 hash/length，不保存 prompt/target input/clipboard/raw UIA；真实桌面像素只用于比例计算，未带 `-AllowScreenshot` 时不落盘 PNG。
- 已接入 `scripts/check-p25-desktop-shell-visual-runtime.ps1`：只有 runtime process 存在时才运行 attach 视觉取证；无进程时 `overlayVisualAttach.ran=false`，不读取旧报告误判。
- 本轮验证通过：
  - PowerShell parser：`check-p25-overlay-window-visual-attach.ps1`、`check-p25-desktop-shell-visual-runtime.ps1`。
  - `scripts/check-p25-overlay-window-visual-attach.ps1 -AllowFailure`：`completionImpact=overlay_window_missing`、`windowCount=0`、`processStartAttempted=false`、`realOverlayClickAttempted=false`、`targetWriteAttempted=false`、`screenshotWriteAttempted=false`。
  - `scripts/check-p25-desktop-shell-visual-runtime.ps1 -AllowFailure`：`completionImpact=start_not_allowed`、`runtimeReadiness.processCount=0`、`runtimeReadiness.overlayWindowCount=0`、`overlayVisualAttach.ran=false`、`startAttempted=false`。
- 当前真实根因已收敛：工具里用不了新版小人，是因为没有运行中的 `smart-prompt-desktop.exe`/真实 `Smart Prompt Mascot` overlay 窗口，不是 Draft/Prompt 同步问题。
- 仍未执行：`-AllowStartDesktopShell`、`-AllowRealOverlayClick`、真实 composer 写入/latest-fill。

## 2026-06-13 授权后真实视觉运行态总控脚本

- 已为 `scripts/check-p25-mascot-overlay-noactivate.ps1` 增加 `-AttachOnly`：只检查已存在 overlay 窗口；没有窗口时报告 `attach_only_no_existing_overlay_window`，不启动新进程。
- 新增 `scripts/check-p25-desktop-shell-visual-runtime.ps1`：默认不启动；授权后才通过 `start-p25-desktop-shell-candidate.ps1 -AllowStartDesktopShell` 启动候选桌面壳，然后刷新 runtime readiness，用 no-activate `-AttachOnly -KeepRunning` 检查已存在 overlay，再跑聚合链路。
- 默认只读验证通过：`startAllowed=false`、`startAttempted=false`、`runtimeReadiness.processCount=0`、`overlayNoActivate.ran=false`、`realOverlayClickAttempted=false`、`writeAttempted=false`。
- 本轮 parser 验证通过：`check-p25-mascot-overlay-noactivate.ps1`、`check-p25-desktop-shell-visual-runtime.ps1`。
- 默认总控报告：`research/p25-desktop-shell-visual-runtime.latest.json`，当前 `completionImpact=start_not_allowed`。这不是产品失败，而是说明尚未获得启动新版桌面壳的明确授权。
- 仍未执行：`-AllowStartDesktopShell`、`-AllowRealOverlayClick`、真实 composer 写入/latest-fill。

## 2026-06-13 新版桌面壳启动门控脚本

- 新增 `scripts/start-p25-desktop-shell-candidate.ps1`，用于把最新 `target-p25-transparent-release` 候选桌面壳变成可审计的真实运行入口。
- 默认只读：不带 `-AllowStartDesktopShell` 时只生成 `research/p25-desktop-shell-start.latest.json`，并刷新只读 runtime readiness；本轮默认运行结果为 `status=start_not_allowed`、`startAllowed=false`、`startAttempted=false`、`beforeCount=0`、`afterCount=0`。
- 显式授权后才会 `Start-Process` 候选 exe；脚本不停止、不 kill、不替换已有桌面壳，不执行真实 overlay click，不写目标 composer。
- 已接入 `scripts/check-p25-overlay-click-chain.ps1`：新增 `desktopShellStartVerifierPresent=true`、`desktopShellStartVerifierNoStopOrKill=true`、`desktopShellStartReportPresent=true`、`desktopShellStartSafetyOk=true`、`desktopShellStartPrivacyOk=true`；聚合 `runtimeEvidence` 现在显示 `desktopShellStartStatus=start_not_allowed`。
- 验证通过：`start-p25` 与 `overlay-click-chain` PowerShell parser；`powershell -File scripts/start-p25-desktop-shell-candidate.ps1 -AllowFailure`；`powershell -File scripts/check-p25-overlay-click-chain.ps1` 预期 exit 1。
- 当前真实缺口仍是未授权启动/运行态未匹配：`runtimeReadinessProcessCount=0`、`completionImpact=runtime_readiness_missing`。未运行 `-AllowStartDesktopShell`，未运行 `-AllowRealOverlayClick`。

## 2026-06-13 Retry 证据接入聚合审计

- 已补 `scripts/check-p25-overlay-click-chain.ps1`：静态检查新增 `interactionTestCoversOverlayRetry=true`，视觉 verifier 要求包含 `retryThinking` 与 `retryActionProbe`。
- 聚合运行检查新增 `overlayChatVisualRetryWorks`，要求 `Retry` 标签、`mascot_overlay_clicked` + `overlayAction=generate`、`promptKind=generated`、预览长度匹配、`fillCommandCount=0`、`submittedTextCount=0`、`textNotStored=true`。
- 聚合摘要现在显式输出 `actionTurnProbe.retryThinking` 与 `retryActionProbe`，便于最终审计直接看到桌面小人卡片内再生成证据。
- 本轮验证通过：PowerShell parser、`node --check scripts/check-p25-overlay-chat-visual.js`、`node scripts/check-p25-overlay-chat-visual.js`（`pass=true`）、`npm test --prefix apps/desktop-shell`。
- 最新聚合仍预期为红：`completionImpact=runtime_readiness_missing`，但新增项为真：`overlayChatVisualRetryWorks=true`、`interactionTestCoversOverlayRetry=true`。只读 runtime 仍显示 `processCount=0`，未启动/停止/替换真实桌面壳，未运行 `-AllowRealOverlayClick`。

## 2026-06-13 桌面小人 Retry 交互闭环

- 已把桌面 overlay 的 generated prompt 二级动作改为 `Retry`：空白/草稿仍显示 `Make`，已有生成结果时显示 `Retry`。
- 已修 `apps/desktop-shell/src/app.js` 的 overlay generate 分支：当 payload 是 generated prompt 时，用当前 overlay 预览文本作为新的草稿输入再调用 `/generate`；不打开主窗口，不触发 `/desktop/fill`。
- 已补 `apps/desktop-shell/tests/desktop-shell-interaction.test.js`：覆盖 overlay Retry 重新生成，断言不会调用 `show_main_window`，不会产生 foreground fill。
- 已补 `scripts/check-p25-overlay-chat-visual.js`：离线视觉/点击探针覆盖 `Retry` 标签、retry thinking 文案、预览编辑后点击 Retry 仍只发 `mascot_overlay_clicked` + `overlayAction=generate`。
- 验证通过：`node --check apps/desktop-shell/src/overlay.js`、`node --check apps/desktop-shell/src/app.js`、`node --check scripts/check-p25-overlay-chat-visual.js`、`node --check apps/desktop-shell/tests/desktop-shell-interaction.test.js`、`npm test --prefix apps/desktop-shell`、`node scripts/check-p25-overlay-chat-visual.js`、`npm run prepare-dist --prefix apps/desktop-shell`、`cargo build --release --manifest-path apps/desktop-shell/src-tauri/Cargo.toml --target-dir apps/desktop-shell/src-tauri/target-p25-transparent-release`。
- 最新备用候选 exe：`apps/desktop-shell/src-tauri/target-p25-transparent-release/release/smart-prompt-desktop.exe`，SHA256 前缀 `8da2afc3a9e4a3b3`，`fresh=true` / `ready=true`。
- 只读 runtime readiness 仍为红：`runtimeReady=false`、`completionImpact=no_smart_prompt_process_running`、`processCount=0`。本轮未启动、停止、替换真实桌面壳，未运行 `-AllowRealOverlayClick`，未写真实 composer。

## 2026-06-13 离线桌面小人体验增强（本次落点）

- 按浏览器端风格补齐桌面 overlay 展示交互（不改 fill/guard 路径）：
  - `apps/desktop-shell/src/overlay.js`：补齐 `data-overlay-action` 回写，便于状态动作提示样式挂钩。
  - `apps/desktop-shell/src/overlay.css`：补充展开/收起过渡、思考点与输入待发送的脉冲反馈，继续维持 `72x72` 透明 compact 与 `320x360` expanded 体验。
  - `scripts/check-p25-overlay-chat-visual.js`：离线视觉脚本在本轮验证结果 `pass=true`。
- 本次最小验证已全通过：
  - `node --check apps/desktop-shell/src/overlay.js`
  - `node --check scripts/check-p25-overlay-chat-visual.js`
  - `npm test --prefix apps/desktop-shell`
  - `node scripts/check-p25-overlay-chat-visual.js`


## 2026-06-13 用户截图白块问题直接收口

- 用户截图中的问题不是小人 PNG 本身，而是旧/未匹配桌面 overlay 以大 WebView 白底显示了旧 `thinking` 小卡片；当前目标仍是未点击时只显示透明 `72x72` 小人入口。
- 已在 `scripts/check-p25-overlay-chat-visual.js` 新增 `compactThinkingProbe`：在 `320x360` 大视口中强制渲染 `state=thinking + overlayMode=compact`，要求 body/card/button 仍为 `72x72`、badge 为小圆点、chat 隐藏、透明背景、`largeWhiteBlockAbsent=true`。
- 已修 `apps/desktop-shell/src/overlay.js` 的 readiness meta：只有 payload 明确提供 candidate/safe candidate count 时才显示 `s:x/y` 或 `guard:x/y`，避免普通离线状态出现 `s:0/0` 调试噪声。
- 已修 `apps/desktop-shell/src-tauri/build.rs`：显式追踪 overlay 源文件和 dist overlay 文件变化，避免前端 UI 更新后 cargo 不重新链接 exe。
  - `node scripts/check-p25-overlay-chat-visual.js`
- 最新备用候选 exe 已 fresh/ready：`apps/desktop-shell/src-tauri/target-p25-transparent-release/release/smart-prompt-desktop.exe`，SHA256 前缀 `6ca03c55304643e4`。
- 只读 runtime readiness 仍预期为红：`runtimeReady=false`、`completionImpact=no_smart_prompt_process_running`；未启动/停止/替换真实桌面壳，未运行 `-AllowRealOverlayClick`。

## 本轮状态恢复与证据补强 2026-06-13

- 已重新按用户目标拉起两个子 agent：
  - 5.5-xhigh 审核 agent：只读审核，结论是真实 overlay click 仍不安全，因为 `safeCandidatesReady=false`；建议只在用户许可后做运行时 readiness/no-activate 验证。
  - 5.3 Codex Spark worker：在不改 runtime 行为的前提下增强 `scripts/check-p25-overlay-click-chain.ps1`，加入透明 release 候选包离线证据。
- 主线程复核 worker 改动后追加了 dist 输入校验：聚合脚本现在检查 `apps/desktop-shell/dist` 中也含透明 compact overlay 约束，并要求候选 exe 晚于 dist/source 输入。
- 已修复 worker 写入记忆时造成的乱码/空文件问题，重建 `agent_memory/context.md`、`progress.md`、`bugs.md` 为当前有效事实；旧长上下文仍在 `agent_memory/archive/`。

## 本轮代码改动 2026-06-13

- 在 `packages/shared/desktop-tool-profiles.js`、`apps/local-service/src/desktop-input-detector.js`、`scripts/check-p25-composer-candidate-diagnostics.ps1` 完成安全候选判定诊断补丁：
  - 新增 `isCodexBrowserLikeComposerCandidate` 标记逻辑（Codex + Document + broadDocument + nearWindowBottom + 相关输入信号），不放宽 `safeCandidate` 边界。
  - 诊断输出新增 `isBrowserLikeComposerCandidate` 字段与 `browserLikeComposerCandidateCount`，并将命中理由写为 `browser_like_composer_blocked`。
  - 当 `safeCandidateCount == 0` 且存在浏览器式候选时，`completionImpact` 输出 `safe_candidates_missing_but_browser_like_composer_exists`。

## 本轮验证结果 2026-06-13

- `scripts/check-p25-overlay-click-chain.ps1` 已复跑，预期 exit 1：`pass=false`、`completionReady=false`、`completionImpact="real_overlay_click_fill_missing"`。
- 聚合审计新增项为真：`desktopDistHasTransparentCompactOverlay=true`、`transparentReleaseCandidatePresent=true`、`transparentReleaseCandidateFresh=true`、`transparentReleaseCandidateRecent=true`、`transparentReleaseCandidateReady=true`。
- 聚合审计仍显示缺口：`overlayNoActivateReportFresh=false`、`targetsStrictForegroundReady=false`、`targetsSafeCandidatesReady=false`、`targetsWritesVerified=false`、`realOverlayClickVerified=false`。
  - `node scripts/check-p25-overlay-chat-visual.js`
- `npm test --prefix apps/desktop-shell` 通过。
- `scripts/check-p25-real-overlay-click-fill.ps1 -Profiles codex` 通过只读执行但 `completionReady=false`：`desktopPromptStateReady=true`、`strictForegroundReady=true`、`safeCandidatesReady=false`、`click.attempted=false`。

## 未执行事项

- 未运行 `-AllowRealOverlayClick`。
- 未写入真实 Codex/WorkBuddy/Trae composer。
- 未停止、重启、替换当前桌面壳或 sidecar。
- 未启动 `target-p25-transparent-release` 候选 exe。

## 下一步候选

- 需要真实视觉闭环时，必须先获得用户明确许可启动/切换到最新候选桌面壳，再生成 fresh no-activate/runtime evidence。
- 真实填入闭环仍必须等待只读 gate 同时显示 `desktopPromptStateReady=true` 与 `safeCandidatesReady=true`，随后才可显式进入真实 overlay click/latest-fill 验证。

## P25 runtime-readiness verifier
- Implemented a read-only runtime verifier: `scripts/check-p25-runtime-readiness.ps1`.
- No process control/actions performed; it only reads process metadata and writes sanitized JSON.
- Integrated chain script with optional report input and evidence fields; chain remains no-process-touching and no-real-clicking.
- Current state: scripts parse and execute in read-only mode; gate pass remains false in current env due no running desktop process.
- Next: run once when runtime process is expected to be running to get positive `completionReady`.

## P25 mascot white-block fix 2026-06-13

- User screenshot showed old real-window behavior: a large white WebView/background with the old `thinking` pill card. Root cause is not mascot PNG; it is old/unmatched desktop overlay runtime or old compact design leaking in a non-transparent window.
- Patched `apps/desktop-shell/src/overlay.css`: compact mascot image is now `60x60` inside the `72x72` transparent window, matching the browser extension feel more closely.
- Patched `apps/desktop-shell/src-tauri/src/main.rs`: after geometry changes, transparent background is applied again; `show_mascot_overlay` emits state before showing the hidden overlay and once after showing, reducing stale compact/expanded flash.
- Patched `scripts/check-p25-overlay-chat-visual.js`: CDP screenshots now use transparent background override and parse PNG alpha; compact pass requires alpha evidence, not just CSS declarations.
- Patched `scripts/check-p25-overlay-click-chain.ps1`: aggregate report now surfaces `compactScreenshotTransparent` and screenshot alpha stats.
- Rebuilt latest offline release candidate only; did not start/stop/replace any desktop process. New candidate: size `9,290,240`, SHA256 prefix `b8768a5daf3d196b`, time `2026-06-13 18:23:04`.
  - `node scripts/check-p25-overlay-chat-visual.js`
- Validation expected-fail: `scripts/check-p25-runtime-readiness.ps1 -AllowFailure` and `scripts/check-p25-overlay-click-chain.ps1` remain `pass=false` because no `smart-prompt-desktop.exe` process is running and real target safe candidate/click evidence is still absent.

## 2026-06-13 进展补记（桌面 composer 安全检测）

- 在 `packages/shared/desktop-tool-profiles.js`、`apps/local-service/src/desktop-input-detector.js`、`scripts/check-p25-composer-candidate-diagnostics.ps1` 做安全候选诊断补丁：
  - 新增 `isCodexBrowserLikeComposerCandidate`，用于标记“浏览器式”候选（Codex + Document + broadDocument + nearWindowBottom + 输入信号），不放宽 safe 判断边界。
  - 诊断脚本新增 `isBrowserLikeComposerCandidate` 字段与 `browserLikeComposerCandidateCount`，并将命中项理由标记为 `browser_like_composer_blocked`。
  - 当 `safeCandidateCount == 0` 且 `browserLikeComposerCandidateCount > 0` 时，`completionImpact` 输出 `safe_candidates_missing_but_browser_like_composer_exists`，以保留失败状态同时给出明确阻塞证据。

## 2026-06-13 收口验证（白块与视觉入口）

- 已确认用户截图里的大白块不是小人图片问题，而是旧/非透明 overlay WebView 或旧运行包露出的白底；目标 compact 态是透明 `72x72` 窗口中的 `60x60` 小人入口。
- 已在 `apps/desktop-shell/src/app.js` 增加 Codex 底部宽按钮式区域的 visual-only 锚点判断：只用于让小人贴近 composer，不改变 safe candidate 和 Fill 守卫。
- 已重新 `prepare-dist` 并清理后重建备用候选：`target-p25-transparent-release` exe 时间 `2026-06-13 18:32:27`，SHA256 前缀 `bcaf87d8d6d8afd6`。
  - `node scripts/check-p25-overlay-chat-visual.js`
- 已复跑只读 gate：`desktopPromptStateReady=true`、`strictForegroundReady=true`、`safeCandidatesReady=false`、`click.attempted=false`；未运行 `-AllowRealOverlayClick`。
- 聚合审计仍预期为红：`completionImpact="runtime_readiness_missing"`，因为没有运行中的 `smart-prompt-desktop.exe` 匹配最新候选，也没有真实 safe composer/latest-fill 证据。

## 2026-06-13 白块问题再收口（初始态防露白）

- 用户截图显示的小人旁大白块，判定为旧/未匹配 overlay WebView 窗口或初始化残影，不是小人 PNG 本身。
- 已加固 `apps/desktop-shell/overlay.html` 的内联 compact 启动样式：默认即为 `72x72` 透明入口、`60x60` 小人、状态点，外部 CSS 尚未加载时也隐藏 chat/actions/preview。
- 已扩展 `scripts/check-p25-overlay-chat-visual.js`：新增 `initialCompactProbe`，在 `render()` 前用 `260x320` 视口截图验证默认 compact 不露大白块；本轮结果 `largeWhiteBlockAbsent=true`、`opaqueRatio=0.0074`。
- 已扩展 `scripts/check-p25-overlay-click-chain.ps1`：聚合新增 `overlayChatVisualInitialCompactOk=true`。
- 已重新 `prepare-dist` 并构建备用候选：`apps/desktop-shell/src-tauri/target-p25-transparent-release/release/smart-prompt-desktop.exe`，SHA256 前缀 `9dfeae238772eabe`。
  - `node scripts/check-p25-overlay-chat-visual.js`
- 只读 runtime/聚合仍预期为红：`completionImpact="runtime_readiness_missing"`，因为未启动/切换真实桌面壳，`smart-prompt-desktop.exe` 运行进程数为 0；未运行 `-AllowRealOverlayClick`，未写真实 composer。

## 2026-06-13 桌面小人交互增强（状态条）

- 按目标新建两个子 agent：
  - `gpt-5.5` + `xhigh` 只读规划/审核：确认真实 Fill 仍不能放行，建议优先做 expanded 卡片体验同构、success 反馈、安全 evidence chips。
  - `gpt-5.3-codex-spark` + `high` scoped worker：实现 overlay presentation 小改动并更新视觉 verifier。
- 已在桌面 overlay 增加 expanded-only 的三段小状态条/情绪条，不改变 Fill 守卫、不改变 safe candidate 逻辑：
  - `idle`、`ready`、`scan`、`thinking`、`success`、`guard`。
  - compact 状态仍隐藏状态条，保持透明 `72x72` 小人入口。
- 已更新 `scripts/check-p25-overlay-chat-visual.js`：
  - 初始 compact 检查新增 `compactMoodStripHidden=true`。
  - 8 个状态新增 `mascotMood`、`moodStripMatches`、无 overflow/clip 验证。
- 已补 `scripts/check-p25-overlay-click-chain.ps1` 的 `overlayChatVisualSummary.initialCompactProbe`，聚合报告可直接看到初始白块与透明度证据。
  - `node scripts/check-p25-overlay-chat-visual.js`
- 已重新 `prepare-dist`，清理并重建备用 release 候选：`apps/desktop-shell/src-tauri/target-p25-transparent-release/release/smart-prompt-desktop.exe`，SHA256 前缀 `33206616a41635ec`，`transparentReleaseCandidateFresh=true`。
- 只读 runtime/聚合仍预期为红：`completionImpact="runtime_readiness_missing"`，因为未启动/切换真实桌面壳，`processCount=0`；`safeCandidatesReady=false`；未运行 `-AllowRealOverlayClick`，未写真实 composer。

## 2026-06-13 覆盖式桌面小人 UI 增强（本次任务）

- 已完成 overlay presentation/interaction 增强：compact 维持小体积 `72x72`，expanded 新增状态条。
- 状态映射：guard/idle/ready/scan/thinking/success（不改现有填充行为）。
- 交付验收命令执行：
  - `node scripts/check-p25-overlay-chat-visual.js`
  - `npm test --prefix apps/desktop-shell`（PASS）
- 未执行：真实桌面壳启动、真实 overlay click/full-fill。

## 2026-06-13 桌面小人 evidence 行增强（本次追加）

- 已在 `apps/desktop-shell/overlay.html`、`apps/desktop-shell/src/overlay.css`、`apps/desktop-shell/src/overlay.js` 按最小改动完成 expanded 态 evidence/status 行：
  - 三段 `mascot-overlay-evidence-row`（tool/action/policy）显示仅在 expanded 显示，compact 下完全隐藏。
  - 采用受限 token 文案（safe/visual-only/draft-ready/filled/guarded/waiting + fill/scan/checking/make/done/review + no-submit/blocked）；
  - 仅改展示层，不改 Fill/readiness/guard 逻辑。
- 已更新 `scripts/check-p25-overlay-chat-visual.js`：
  - 在 8 个状态里加入 evidence tokens 与 evidence 行显示断言；
  - 使用 `dataset.evidence*` 做核验，补齐 `compact-ready` 及 expanded 等状态的可见性和 sanitization 断言；
  - report 已写入 `research/p25-overlay-chat-visual.latest.json`。
- 验证命令：
  - `node --check scripts/check-p25-overlay-chat-visual.js`
  - `node scripts/check-p25-overlay-chat-visual.js`
    结果：`pass=false`（原因：多状态中既有 `mascot-overlay-primary`，也有 preview 控件的既有 overflow 断言未满足；与本次 evidence 行改动无直接关系）

## 2026-06-13 桌面小人大白块与 expanded 布局最终收口

- 已把 expanded overlay 从旧 `260x320` 调整为 `320x360`，给 evidence/status 行与 prompt preview 留出空间；compact 仍保持透明 `72x72` 小人入口。
- 已同步 Tauri native overlay 尺寸、桌面壳 JS placement 尺寸、视觉 verifier 视口，以及 `desktop-shell-interaction.test.js` 中的坐标预期，避免旧尺寸断言误报。
  - `node scripts/check-p25-overlay-chat-visual.js`
- 已验证通过：
  - `npm test --prefix apps/desktop-shell`
  - `npm test --prefix apps/local-service`
  - `node --check apps/desktop-shell/tests/desktop-shell-interaction.test.js`
  - `cargo check --manifest-path apps/desktop-shell/src-tauri/Cargo.toml --target-dir apps/desktop-shell/src-tauri/target-p25-check`
  - `npm run prepare-dist --prefix apps/desktop-shell`
  - `cargo build --release --manifest-path apps/desktop-shell/src-tauri/Cargo.toml --target-dir apps/desktop-shell/src-tauri/target-p25-transparent-release`
- 最新备用 release 候选：`apps/desktop-shell/src-tauri/target-p25-transparent-release/release/smart-prompt-desktop.exe`，大小 `9,336,832` bytes，SHA256 前缀 `5854ae029ad65fdd`。
- 只读 runtime readiness：candidate present/recent/fresh/ready 均为 true，但 `runtimeReady=false`、`completionImpact=no_smart_prompt_process_running`，因为当前没有运行中的 `smart-prompt-desktop.exe`。
- 只读聚合链路仍预期为红：`overlayChatVisualPass=true`、`overlayChatVisualInitialCompactOk=true`、`transparentReleaseCandidateFresh=true`；失败原因是 fresh no-activate runtime evidence 缺失、真实桌面壳未运行匹配候选、safe composer candidate 缺失、真实写入/latest-fill 未验证。
- 未运行 `-AllowRealOverlayClick`；未启动/停止/替换真实桌面壳或 sidecar。
# 2026-06-13 小改记（Overlay readiness hint）
## 当前进展
- 已追加一处 overlay 只读体验改动：`apps/desktop-shell/src/overlay.js` 的 `getOverlayHint()` 仅在非 `thinking` 且 `overlayReadinessReason` 为阻塞类时（`no-safe-candidate` / `unsupported-overlay-profile` / 其他非 ready）返回更明确的可读提示（如 “Need safer target first” / “Switch to supported tool” / “Re-scan target”）。
- 该改动不触达 `/desktop/fill`、`/desktop/` 真实交互链路；不依赖或触发真实点击；不变更 Fill guard 条件。
  - `node scripts/check-p25-overlay-chat-visual.js`

## 下一步
- 后续可选：补一个小型可视化场景，用 `overlayReadinessReason=no-safe-candidate` 渲染一条快照/状态断言，直接绑定本次提示文案的离线可见性。

## 2026-06-13 交付确认（本次子任务）
- 已完成本次要求范围内桌面 overlay 展示层增强：对齐网页端小人体验（compact透明入口 + expanded 聊天框体验 + 展开/折叠 + quick draft + 预览+状态/证据），未改动 Fill guard/真实点击链路。
- 已在以下文件内完成更新：
  - `C:/Users/lhy10/Documents/Smart Prompt/apps/desktop-shell/overlay.html`
  - `C:/Users/lhy10/Documents/Smart Prompt/apps/desktop-shell/src/overlay.css`
  - `C:/Users/lhy10/Documents/Smart Prompt/apps/desktop-shell/src/overlay.js`
  - `C:/Users/lhy10/Documents/Smart Prompt/scripts/check-p25-overlay-chat-visual.js`
- 本轮最小验证通过：
  - `node --check apps/desktop-shell/src/overlay.js`
  - `node --check scripts/check-p25-overlay-chat-visual.js`
  - `node scripts/check-p25-overlay-chat-visual.js`（pass=true）
  - `npm test --prefix apps/desktop-shell`
- 未执行/未涉及：启动或替换真实桌面壳，真实 overlay click/full-fill，真实填充/guard 触发。

## 2026-06-13 真实点击 gate 阻塞原因收窄

- 已复查 `research/p25-composer-candidate-diagnostics.latest.json`：当前 Codex 前台有 1 个 `browser_like_composer_blocked`，但 `safeCandidateCount=0`、`bestCandidateIndex=-1`。
- 已补 `scripts/check-p25-real-overlay-click-fill.ps1` 的只读报告字段：新增 `safeCandidateDiagnostics` 与 `prerequisites.browserLikeComposerBlocked`，直接显示 “有 browser-like composer，但未升级为 safe candidate”。
- 已验证只读 gate：`scripts/check-p25-real-overlay-click-fill.ps1 -Profiles codex` exit 0，`pass=true`、`completionReady=false`、`completionImpact=safe_composer_candidate_missing`、`desktopPromptStateReady=true`、`safeCandidatesReady=false`、`browserLikeComposerBlocked=true`、`click.attempted=false`。
- 本轮没有运行 `-AllowRealOverlayClick`，没有启动/停止/替换桌面壳或 sidecar，没有写真实 composer。

## 2026-06-13 visual-only 输入区贴近体验补强

- 已在桌面壳只读 readiness 中补 `browserLikeComposerCandidateCount`，并透传到 overlay payload、prompt state 与 UI dataset；该字段只用于提示/验证，不参与 `ready`、`candidateIndex` 或 `/desktop/fill` 判定。
- 已给 visual-only overlay payload 增加 `visualAnchor`、`visualAnchorIndex`、`visualAnchorReason`，仅含 index、controlType、reason 和 bounds 几何；不含 prompt 正文、目标输入正文、剪贴板或 raw title/UIA name。
- 已调整 visual-only 锚点排序：优先有强输入信号、输入容器形态和底部区域，降低普通底部按钮抢占小人位置的概率；仍保持 `visualOnly=true`、`candidateIndex=-1`。
- 已更新 overlay 文案：当 Codex 有 browser-like composer 但无 safe candidate 时，小人提示 `Focus input, then Scan`，而不是泛化的 guarded；真实 Fill 守卫不变。
- 验证通过：`node --check`（app/overlay/test/visual verifier）、`npm test --prefix apps/desktop-shell`、`node scripts/check-p25-overlay-chat-visual.js`、`scripts/check-p25-composer-candidate-diagnostics.ps1 -Profiles codex`、`scripts/check-p25-real-overlay-click-fill.ps1 -Profiles codex`。真实点击仍为 `click.attempted=false`。

## 2026-06-13 最新候选与真实工具不可用原因

- 已重新 `npm run prepare-dist --prefix apps/desktop-shell` 并构建 release 候选：`apps/desktop-shell/src-tauri/target-p25-transparent-release/release/smart-prompt-desktop.exe`，大小 `9,336,832` bytes，SHA256 前缀 `e12e4547bf988707`。
- 离线/只读验证仍通过：`node scripts/check-p25-overlay-chat-visual.js` 为 `pass=true`，`npm test --prefix apps/desktop-shell` 通过，`scripts/check-p25-overlay-click-chain.ps1` 中 `overlayChatVisualPass=true` 且 visual anchor metadata 检查为 true。
- `scripts/check-p25-desktop-shell-visual-runtime.ps1 -AllowFailure` 的最新报告为 `completionImpact=start_not_allowed`、`visualRuntimeReady=false`、`processCount=0`、`overlayWindowCount=0`，因为本轮未获得显式授权启动/替换真实桌面壳。
- 当前真实工具里仍看不到新版小人体验的直接原因：没有运行中的最新 `smart-prompt-desktop.exe` 可挂载；这不是 Draft/Prompt 内容为空导致。
- 真实点击/真实填充仍未执行：`realOverlayClickAttempted=false`、`foregroundFillAttempted=false`；Codex composer 只读 gate 仍是 `safeCandidatesReady=false`、`browserLikeComposerBlocked=true`，不得进入 `-AllowRealOverlayClick`。

## 2026-06-13 截图白块与小人尺寸再修正

- 针对用户截图中“大片空白 + 小人缩在角落”的问题，继续收口两点：
  - compact 小人入口从 `60px` 放大到 `78px` 并轻微偏移，抵消 PNG 原图透明边距导致的小人过小问题；仍保留 `72x72` 透明窗口与状态点。
  - Tauri `show_mascot_overlay` 改为先向 WebView 发送 overlay state，再短暂等待并应用窗口几何/显示，降低原生窗口先变大但 DOM 仍停在 compact 时露出白底的概率。
- 已同步 `overlay.html` 的内联启动样式、`overlay.css`、`scripts/check-p25-overlay-chat-visual.js`，视觉 verifier 允许 compact 小人图片被 `72x72` 入口裁切，但仍要求其他元素不溢出。
- 验证通过：`node --check scripts/check-p25-overlay-chat-visual.js`、`node scripts/check-p25-overlay-chat-visual.js`（`pass=true`，`initialCompactProbe.largeWhiteBlockAbsent=true`，`whiteBlockRegressionProbe.largeWhiteBlockAbsent=true`）、`npm test --prefix apps/desktop-shell`、`cargo check --manifest-path apps/desktop-shell/src-tauri/Cargo.toml --target-dir apps/desktop-shell/src-tauri/target-p25-check`。
- 已重新 `prepare-dist` 并构建 release 候选：`apps/desktop-shell/src-tauri/target-p25-transparent-release/release/smart-prompt-desktop.exe`，大小 `9,319,936` bytes，SHA256 前缀 `0c369550a2f3474b`。
- 只读 runtime/聚合仍按预期为红：`completionImpact=start_not_allowed` / `runtime_readiness_missing`，`processCount=0`、`overlayWindowCount=0`；本轮未启动/停止/替换桌面壳，未运行 `-AllowRealOverlayClick`，未写真实 composer。

## 2026-06-13 授权启动前的视觉复验脚本加固

- 已给 `scripts/check-p25-mascot-overlay-noactivate.ps1` 增加 `-AllowFailure`，失败时仍写报告并输出 `P25_MASCOT_OVERLAY_NOACTIVATE_INCOMPLETE`，不再只能抛错中断。
- 已让 `scripts/check-p25-desktop-shell-visual-runtime.ps1` 在 attach-only no-activate 步骤调用 `-AllowFailure`；后续即使真实 overlay 样式/窗口异常，也能继续生成完整 visual runtime 报告。
- 验证通过：PowerShell parser 检查通过；`check-p25-mascot-overlay-noactivate.ps1 -AttachOnly -KeepRunning -AllowFailure` 在无真实 overlay 时写出报告，`launchedProcessId=null`、`startError=attach_only_no_existing_overlay_window`；`check-p25-desktop-shell-visual-runtime.ps1 -AllowFailure` 完整收口，仍为 `completionImpact=start_not_allowed`、`startAttempted=false`、`realOverlayClickAttempted=false`。
## 2026-06-13 真实工具小人视觉复验收口

- 已按用户要求清理旧子 agent：6 个历史子 agent 均已关闭，后续不再自动分派子 agent。
- 已确认 `cargo build --release` 直接产出的候选会加载 `127.0.0.1:17372` devUrl；该路径会导致主页面为 Chrome error page，前端 auto-detect 不执行，不能作为真实视觉复验候选。
- 已改用 `npm run build --prefix apps/desktop-shell` 产出真正 Tauri 生产包：`apps/desktop-shell/src-tauri/target/release/smart-prompt-desktop.exe`。
- 已修两个真实视觉问题：
  - `apps/desktop-shell/src-tauri/src/main.rs`：overlay 尺寸从 physical 改为 logical size，解决 200% DPI 下 `72x72` 被显示成 `36x36` 的问题。
  - `apps/desktop-shell/src-tauri/tauri.conf.json`：主窗口默认 `visible=false`，避免桌面壳启动后抢走 Codex/WorkBuddy 前台，导致 auto-detect 识别为 `unknown` 后隐藏小人。
- 已补 `trace_runtime_event` 与 runtime trace，仅记录事件名和布尔/几何/计数元数据，不记录 prompt 正文、目标输入正文、剪贴板、raw title 或 raw UIA name。
- 最终视觉复验通过：`scripts/check-p25-desktop-shell-visual-runtime.ps1 -TransparentReleaseExe apps/desktop-shell/src-tauri/target/release/smart-prompt-desktop.exe -AllowFailure -TimeoutSeconds 20`。
  - `visualRuntimeReady=true`
  - overlay window visible=true
  - geometry=`72x72`
  - noActivateStyle=true
  - largeWhiteBlockAbsent=true
  - realOverlayClickAttempted=false
  - foregroundFillAttempted=false
  - fillLatestReadAttempted=false
- 真实点击/填充仍未执行；当前链路仍因 `safeCandidatesReady=false` 缺真实 fill/latest-fill 证据，不能进入 `-AllowRealOverlayClick`。
## 2026-06-14 真实点击、真实 composer 填入与 latest-fill 验证

- 已按用户授权执行真实 overlay 点击与真实 composer 填入；本轮没有启动子 agent。
- `research/p25-real-overlay-click-fill.latest.json`：`pass=true`、`completionReady=true`、`completionImpact=real_overlay_click_fill_verified`、`click.sent=true`。
- `/desktop/fill/latest`：`fill.pass=true`、`fill.verified=true`、`writeAttempted=true`、`strategy=clipboard_paste_fallback`、`target.controlType=VisualWebViewComposer`、`confirmForeground=true`、`expectedTitleHashMatched=true`、`expectedToolProfileMatched=true`、`noAutoSubmit=true`、`submitSignalCount=0`。
- 隐私边界保持：未保存 prompt 正文、目标输入正文、clipboard 正文、raw title 或 raw UIA name；验证仅记录长度和 hash。
## 2026-06-14 小人输入国际化与默认中文

- 已实现桌面 overlay 输入国际化：默认 `zh-CN`，quick draft、preview 输入框、placeholder、按钮、提示、快捷回复、对话 turn 文案均走 overlay 字典。
- 小人展开态新增语言切换按钮：`中文` / `EN`；点击只同步 locale，不触发真实 fill，也不绕过 no-auto-submit/foreground guard。
- 主窗口默认 locale 从 `auto` 改为 `zh-CN`；所有 `input` / `textarea` 在 `applyLocale()` 时设置 `lang=currentLocale` 与 `dir=auto`。
- overlay payload 会携带 locale；主进程处理 `locale` action，并在 overlay quick draft / generate / fill 前同步语言设置。
- 验证通过：`node --check`（`src/overlay.js`、`src/app.js`、`scripts/check-p25-overlay-chat-visual.js`）、`npm test --prefix apps/desktop-shell`、`node scripts/check-p25-overlay-chat-visual.js`、`node apps/desktop-shell/tests/desktop-shell-interaction.test.js`。
- 已 `prepare-dist` 并重建 canonical 生产包；新 `smart-prompt-desktop.exe` 已启动，PID `37124`，SHA256 前缀 `774a1297010c89e8`。
- 只读视觉运行态复验通过：`visualRuntimeReady=true`、overlay `72x72`、`noActivateStyle=true`、`largeWhiteBlockAbsent=true`；本轮未做真实点击/填充。

## 2026-06-14 中文可见文案、展开保态与退出隐藏修复

- 已修 `apps/desktop-shell/src/overlay.js`：中文 locale 下 meta/evidence 可见文案不再显示 `waiting`、`draft-ready`、`no-submit`、`guard:`、`s:` 等内部 token；内部 dataset 仍保留英文稳定 token 供测试和守卫使用。
- 已修 `apps/desktop-shell/src/app.js`：自动轮询刷新会继承已展开的 overlayMode，避免用户点击小人后被 500ms 轮询自动收回 compact。
- 已收紧 transient sticky：只在同一支持工具且仅缺 `missing-summary` 时短暂保留；工具退出、候选消失、snapshot 不通过或切到不支持窗口时直接 `hide_mascot_overlay`。
- 已补验证：`scripts/check-p25-overlay-chat-visual.js` 新增 `zhVisibleProbe`，确认中文态显示 `Codex 输入#185 草稿 守卫0/207 不提交`、`草稿就绪/生成/不提交`；交互测试新增支持工具无候选隐藏与 expanded 自动轮询保态断言。
- 验证通过：`node --check`（overlay/app/visual/test）、`npm test --prefix apps/desktop-shell`、`node apps/desktop-shell/tests/desktop-shell-interaction.test.js`、`node scripts/check-p25-overlay-chat-visual.js`。
- 已重建并启动 canonical 生产包：`apps/desktop-shell/src-tauri/target/release/smart-prompt-desktop.exe`，PID `23836`，SHA256 前缀 `f67d7b91f726d050`。
- 只读真实视觉 attach 通过：`visualRuntimeReady=true`、overlay `72x72`、`noActivateStyle=true`、`largeWhiteBlockAbsent=true`；本轮未做真实点击、未写真实 composer、未读 `/desktop/fill/latest`。

## 2026-06-15 目标退后台/最小化后小人残留修复

- 针对用户截图“小人工具最小化后仍留在桌面”的问题，已补两层守卫：
  - `scripts/check-m3-desktop-input.ps1` 暴露 foreground `isVisible/isMinimized/isCloaked/isUsable/boundingRect`，并禁止 cursor/known-tool fallback 选择不可用、最小化或 cloaked 的工具窗口。
  - `apps/desktop-shell/src/app.js` 将不可用 foreground 判为 `foreground-window-hidden`，直接隐藏 overlay；同时补 `visibilitychange/pagehide` 守卫。
- 关键根因收窄：运行时 trace 显示前端已经反复发出 `overlay-hide-requested`，但 Tauri `window.hide()` 没有真正隐藏 no-activate/topmost overlay 的 Win32 窗口。
- 已修原生隐藏：`apps/desktop-shell/src-tauri/src/main.rs` 新增 `hide_overlay_window()`，Windows 下对 overlay/root HWND 执行 `ShowWindow(SW_HIDE)` 后再调用 Tauri hide。
- 验证通过：
  - `node --check apps/desktop-shell/src/app.js`
  - `node --check apps/desktop-shell/tests/desktop-shell-interaction.test.js`
  - PowerShell parser：`scripts/check-m3-desktop-input.ps1`
  - `npm test --prefix apps/desktop-shell`
  - `npm test --prefix apps/local-service`
  - `cargo check --manifest-path apps/desktop-shell/src-tauri/Cargo.toml`
  - `npm run build --prefix apps/desktop-shell`
  - `scripts/check-p25-overlay-background-hide.ps1 -AllowFailure -TimeoutSeconds 4`：`pass=true`、`completionImpact=overlay_hidden_when_target_backgrounded`、`windowHidden=true`。
- 当前 canonical 生产包已启动：`apps/desktop-shell/src-tauri/target/release/smart-prompt-desktop.exe`，PID `6888`，SHA256 前缀 `353829b44b0a2d9b`。
- 当前前台快照为 `profile=unknown` / `processName=chrome`，因此 overlay 应保持隐藏；`check-p25-desktop-shell-visual-runtime.ps1` 最新失败是预期的 `overlay_window_not_visible/start_not_allowed`，不是白块回归。
- 本轮未做真实 overlay 点击，未写真实 composer，未读 `/desktop/fill/latest`。

## 2026-06-15 真实工具前台/后台/最小化快速绑定

- 已新增 Tauri 原生快速前台窗口探针 `get_foreground_window_state`，只返回 profile、进程名、窗口可见/最小化/cloaked/usable、几何与 title hash/length 元数据，不读取 prompt 正文、目标输入正文或 raw title。
- `apps/desktop-shell/src/app.js` 现在每 `180ms` 跑快速探针：Codex/WorkBuddy/Trae 可用前台时先显示 visual-only 小人；前台变成非支持窗口、不可见、最小化或 cloaked 时立即隐藏；慢速 UIA 快照仍用于后续精确 safe candidate/refine。
- 已加 stale snapshot guard：如果快速前台状态显示当前不是支持工具，旧 UIA 快照不能重新点亮小人，避免工具退后台后被慢快照“复活”。
- 已收敛快速 show 抖动：仅首次显示或窗口签名变化时发送 `show_mascot_overlay`，不再每 180ms 重发。
- 真实窗口态复验通过：
  - Codex 严格前台：`foregroundDetected=true`、`strictForegroundDetected=true`、`safeCandidateCount=1`、`writeAttempted=false`。
  - Codex 前台后：`Smart Prompt Mascot` 可见，`noActivate=true`、`topmost=true`。
  - 切到 Explorer 后：同一 overlay 窗口存在但 `visible=false`。
  - Codex 最小化期间：`codexMinimizedDuringCheck=true`，overlay `visible=false`，随后已恢复 Codex。
- 验证通过：`node --check apps/desktop-shell/src/app.js`、`npm test --prefix apps/desktop-shell`、`cargo check --manifest-path apps/desktop-shell/src-tauri/Cargo.toml`、`npm run build --prefix apps/desktop-shell`、`git diff --check`（仅 CRLF 提示）。
- 当前 canonical 生产包已启动：`apps/desktop-shell/src-tauri/target/release/smart-prompt-desktop.exe`，PID `35408`，SHA256 前缀 `1558ffbff416f33b`。
- 本轮未做真实 overlay 点击，未写真实 composer，未读 `/desktop/fill/latest`。

## 2026-06-16 小人输入到提示词再填入的测试闭环补强

- 已补 `apps/desktop-shell/tests/desktop-shell-interaction.test.js` 的连续链路断言：小人 overlay 草稿输入提交后，经 overlay `generate` 生成的 prompt，继续由 overlay `fill` 直接进入 guarded `/desktop/fill`。
- 新断言覆盖：`/desktop/fill` 的 `text` 等于 overlay 生成的 prompt，`expectedToolProfile=workbuddy`、`expectedTitleHash=desktop-title-hash`、`candidateIndex=0`，且不触发 `show_main_window`、保持 `noAutoSubmit=true`。
- 验证通过：`node --check apps/desktop-shell/tests/desktop-shell-interaction.test.js`、`npm.cmd test --prefix apps/desktop-shell`、`node scripts/check-p25-overlay-chat-visual.js`、`git diff --check`（仅 CRLF 提示）。
- 当前环境未读到正在运行的 `smart-prompt-desktop` 进程，本轮没有新增真实窗口端到端点击/填入/latest-fill 证据；目标仍需真实运行态复验才能声称完成。
