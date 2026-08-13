# 问题与风险

## 2026-08-13 CI 与回归修复记录

- 已修复：`assistant-card` 模型错误在 `review` 态抢占主操作，堵死离线模板回退的填入路径。现在仅在没有可用提示词时（error 等态）用 diagnostics 抢占；`packages/assistant-ui` 源 + 同步副本 + 单测（fixture 改为 error 态）已更新。
- 已修复：桌面快速前台切换在存在 verified Codex 事务时仍触发 legacy `/desktop/input-snapshot` 跟进轮询（会与受保护事务争夺 overlay）；现在事务存活期间抑制该轮询，undo/事务结束后恢复。
- 已修复：`preserveVerifiedCodexTransaction` 原把 `pendingOutcome` 计入保护，导致 undo 后重新打开卡片 re-claim 的 pending 问题使切工具时不清理旧草稿；现在只保护真实事务（undoToken/transactionId），pendingOutcome 是服务端队列的客户端缓存，目标切换丢弃后可重新 claim。
- 已修复：`codex-target-routes-v1.test.js` 假时钟冻结在 2026-07-19，与服务端真实 `Date.now()` lease 清理冲突（时间炸弹）；现在锚定 `Date.now()`。同类冻结时钟测试仅在该文件失败，其余经运行确认。
- 新增：根 `package.json` 聚合入口（`npm test` = 5 个 Node 包 + sidecar cargo test）与 `.github/workflows/ci.yml`（windows-latest，Node 22 + stable Rust，含 phase3 真二进制契约与桌面 Rust check）。
- 待办（路线图阶段 A 剩余）：key critics 接入 CI（需 headless 子集，缓行）；文档漂移已修复（assistant-state-spec 补齐 clarification/outcome/collapse 命令与 View Model 实际形状，local-service /health 版本 0.3.0 对齐 0.2.0）。

## 2026-07-19 Codex Outcome Learning Loop v1 当前风险

- Outcome 只能在同一 Codex target 与同一项目作用域中归因；多条 pending 必须排队且幂等，不能因后一次填入、重启或跨项目打开而覆盖或误计成功。
- Retry、Undo 和重新生成只是隐式负向信号，不等同于任务失败；模型自评不得替代真实结果，否则会形成 reward hacking 和自我强化偏差。
- Token 只能在质量与安全过门后优化。不得为了减少 Token 牺牲任务完成率、验收覆盖、必要上下文或可执行性。
- 语义向量不是绝对不可逆。默认应使用项目级 keyed feature hash；可选向量必须本地加密、禁止导出并通过正文反演与 membership inference 风险测试。
- 每臂 10 条与 5% 改善只是试点下限，不代表统计显著；证据不足时不得自动稳定晋升。
- Codex direct write 与剪贴板兜底都存在前台、焦点、草稿和剪贴板竞态；任一检查失败必须降级为 copy-only，不能显示 verified success。
- 已收敛：Node 与 Rust 的 Learning Candidate Seed、编辑摘要和缺省任务场景现由同一 fixtures 校验；后续改场景规则必须同时更新 Node/Rust parity。
- 已收敛：旧隐私扫描器已支持严格规范化的 `learningCandidateSeed` 与受限 `llm_fallback.errorCode`；新鲜隔离扫描的原始输入、明文凭证、禁止字段和绝对路径计数均为 0。
- 仍开放：r10 尚未在本轮安装和执行真实 Codex GUI 事务。静态、fake adapter、冷启动和视觉通过不能替代前台读取、写回、机器回读、未发送、撤销与 60 秒 Pending Outcome 证据。
- 只读审计已确认稳定安装目录中的 desktop/sidecar 哈希与最终 r10 不一致；不得把旧 installed runtime 的历史 Agnes/GUI 证据当作 r10 运行证据。
- 仍开放：真实模型 benchmark 未获预算授权；不得用 fake benchmark 宣称真实质量、Token 或成本门槛通过。
- 外部阻塞：连续三次 Goal 轮次未获得本轮真实闭环授权，已达到 blocked 门槛。不要自动安装、启动、切换前台、读取/写入 Codex、触碰剪贴板或调用真实 Provider；收到精确授权后按新一轮阻塞审计恢复。
- 旧 ChatGPT 激活迁移不能伪装成 Codex 验证成功，也不能覆盖 Provider、Custom Provider、模型、加密凭证或旧证据。
- 后台学习不得自动发起付费实验；Policy 必须可停用、可追踪、可自动回滚，权限、脚本与跨项目变更永远需要用户确认。

## 2026-07-19 模型链路风险收口

- 已解除：Agnes Key 并未失效；安装版真实测试和真实生成均成功。不要再用通用“模型暂不可用”文案推断 Key、模型或网络中的任一具体根因。
- 已解除：激活轮询不再重绘 Provider 表单，用户正在输入的 Key 和自定义模型不会每 1.2 秒被清空。
- 已解除：错误候选 Key 不再先覆盖旧 Key；候选配置只在真实测试成功后持久化。最终安装版已用失败候选后再次调用真实 Agnes 测试验证旧凭证仍可用。
- 已解除：`provider_error` 有独立 `provider-error/degraded` 语义；裸 404 归为 Provider 异常，除非响应明确指出 model/deployment 不存在或不支持。
- 已解除：native `auto` 的真实执行、Provider 默认 Base URL/模型和 `/llm/providers.auto.provider` 状态上报现在使用同一优先级；不会再出现界面显示 OpenAI-compatible、实际调用 Anthropic/Gemini 的分叉。
- 必须保留：后端模型校验要先于凭证写入，否则一次无效模型保存可能覆盖有效 Key；Node 与 native 都有回归测试守护。
- 仍需用户动作：Chrome 不会因为桌面安装包升级而自动重载 unpacked extension。未重新加载并刷新页面前，浏览器中可能仍运行旧 content script；这不影响已安装桌面 sidecar 的 Agnes 连通性。
- 发布风险未变：本机 NSIS/MSI 仍未做 Authenticode 签名，适合本机开发安装，不适合直接作为正式外部分发包。

## 阶段 3 仍需闭环的风险

- 已解除：用户手动重载正确 unpacked 扩展后，新建 ChatGPT 页观测到 r5/ready，真实 LLM 生成、编辑、verified insert、稳定回读和 activation complete 均通过，且无 Send/Enter。
- 新桌面主窗口使用新的 `control-center-app.js`，旧 `app.js` 和旧 HTML 仍以隐藏兼容层存在；若后续删除旧兼容层，必须先迁移 overlay/interaction 回归覆盖，不能直接批量清理。
- 已解除：最终 release 使用真实 activated 数据重启后，两个 `Tauri Window` 顶层窗口均为隐藏；tray/global-hotkey 基础设施和 native r6 均存在。
- 阶段 3 代码、真实 GUI、隐私、视觉、三轮对抗审查和 professor critic 均已通过，Codex goal 已标记 `complete`。流程性残留是 OMX 对账：终态 `get_goal` 返回 `goal=null`，严格 completion 拒绝该快照；已记录显式 `blocked` verdict。不要把产品验收通过误写成 OMX 对账通过，也不要在本任务里重复相同 complete 命令。
- `/data/all` 的恢复目录包含凭证归档，UI只展示本地恢复位置；后续对抗审查要确认恢复目录权限、不会出现在诊断导出中，且重启后不会重复迁移旧数据。

## 阶段 3 设计风险 2026-07-17

- 不要把激活进度与运行健康合并。已经 `activated` 的用户发生瞬时网络或服务故障时，只能改变 `healthy/repairing/needs_repair`，不得回退激活并重新打开首次向导。
- 不要让客户端直接宣称 `model_ready`；必须由本地服务在真实 `/llm/test` 成功后推进状态。
- `browser-seen` 和 activation complete 必须复用本地服务认证并做严格 schema 校验，任意网页不能伪造激活完成。
- 现有 `clearAllLocalData()` 使用 `fs.rmSync` 永久删除数据；阶段 3 隐私页不得直接暴露该路径。数据重置必须先进入可恢复归档或经过验证的 Windows 回收站机制。
- ChatGPT 真实 GUI 证据只能使用非敏感合成草稿；截图必须遮挡或裁切，不能通过截图间接保存输入正文。
- 三分钟口径只适用于应用与扩展已安装、ChatGPT 已登录、用户已有有效 Key 的单次内测流程；没有真实样本时不得声称“中位数小于三分钟”。
- ChatGPT verified insert 与 copy 是两种不同证据：copy 可完成本阶段激活，但不得显示为 DOM 机器写回成功。

## 产品形态与体验分叉风险 2026-07-17

- 阶段 2 已统一网页 Prompt Card 与桌面 expanded Overlay 的 DOM/CSS、文案、动作和键盘行为；不要再在两端分别添加用户控件，改动必须先进入 `packages/assistant-ui/` 再同步。
- 桌面主窗口仍是第三套、且职责过载的界面；Assistant Card 统一不等于控制中心已经完成。下一步应进入阶段 3，将主窗口收敛为托盘运行时加低频控制中心。
- 桌面主窗口当前同时承担营销、首次配置、日常生成、服务管理、研发指标、诊断和资料管理；普通用户无法判断启动后该做什么。后续应把它收敛为托盘运行时加低频控制中心。
- Learning、Pilot、Quality、Segments、Service 启停和 Desktop Self-Test 对研发有价值，但不应继续出现在普通用户主界面。
- 不要把技术状态直接暴露成 `payload_guard`、`visualOnly`、`safeCandidate` 或 evidence token；产品 UI 只应显示“可填入、需聚焦、仅复制、人工确认、已阻止”等用户结果和恢复动作。
- WorkBuddy 仍可能只能人工确认或 copy-only。共享体验重构不能通过放宽 foreground、safe target、readback 或 no-auto-submit 守卫来制造一致性。
- `scripts/check-p25-overlay-chat-visual.js` 已迁移为 `p25-overlay-chat-visual@2` 入口，旧英文/quick-reply 断言仅在显式 `SMART_PROMPT_USE_LEGACY_P25_VISUAL=1` 时运行；默认报告必须验证共享 Card、guarded fill、regenerate、mode routing 和 compact 透明度。
- 浏览器和桌面 Headless Chrome 测试在本轮用保留临时产物模式运行，以避免永久删除；测试 profile 留在系统临时目录，不要用永久删除命令清理。
- Windows 测试环境中的 Playwright `chrome-headless-shell` 需要本地静态页专用 `--no-sandbox`，否则 GPU 子进程崩溃并让 CDP `Runtime.enable` 超时；该参数只属于离线测试启动器，不得复制到产品 Tauri/Chrome 运行参数。
- 阶段 2 没有执行真实 foreground write。`guardedFillRouting.pass=true` 只证明共享 Card 把 `insert` 映射到既有 `mascot_overlay_clicked + overlayAction=fill + noAutoSubmit=true` 通道，不证明目标工具实际写入或回读成功。
- 目标方案见 `docs/smart-prompt-first-principles-product-plan-2026-07-17.md`。

## 当前关键风险 2026-06-13

- 不要把用户截图中的大白块解释成小人 PNG 问题；它已按旧桌面 overlay/WebView 白底或旧运行包暴露处理。目标 compact 态必须是透明 `72x72` 窗口，`60x60` 小人入口 + 小状态点，且视觉报告必须同时有 DOM 透明与 PNG alpha 证据。
- 不要把源码/dist/视觉 smoke 通过解释为用户前台真实桌面壳已经更新；当前只证明候选包和本地渲染输入是新的，真实前台运行包仍需单独验证。
- 不要把 `visualOnly=true` 当作 safe composer candidate。它只是视觉锚点/引导入口，必须保持 `candidateIndex=-1` 或不可写语义，不得通过 `isMascotOverlayPayloadAligned()`，也不得触发 `/desktop/fill`。
- 不要为了通过复验把 broad Document、按钮、静态文本、cursor fallback、非底部候选、未聚焦元素或 visualOnly 锚点升级为 safe candidate，因为会导致误写或绕过前台/隐私守卫。
- 不要在 `safeCandidatesReady=false` 时添加 `-AllowRealOverlayClick`。最新只读 gate 已明确 `click.attempted=false`，这是正确状态。

## 运行包风险

- 默认 release 目录仍可能被旧 `local-service-sidecar.exe` 锁住；未获用户明确许可，不要停止/重启/替换桌面壳或 sidecar。
- `target-p25-transparent-release` 是绕开默认 release 锁的备用 target，已被 `.gitignore` 忽略；它是候选包，不是当前前台运行包。
- 透明 release candidate 证据只证明候选 exe 存在、较新、大小/hash 可追踪，并且晚于 dist/source 输入；它不能替代 fresh no-activate runtime evidence，也不能替代真实 latest-fill。
- 最新候选 hash 前缀为 `bcaf87d8d6d8afd6`，但当前前台没有匹配的 `smart-prompt-desktop.exe` 进程；不要把该候选包当成已在用户真实桌面生效。

## 验证解读风险

- `scripts/check-p25-overlay-click-chain.ps1` 的 `pass=false` 目前是预期：它要求 fresh no-activate、target safe candidate、真实写入和真实 overlay click evidence；不要为了让它变绿而放宽守卫。
- `overlayChatVisualPass=true`、`compactBackdropTransparent=true`、`compactScreenshotTransparent=true`、`desktopDistHasTransparentCompactOverlay=true` 只证明视觉输入和离线候选包证据，不证明真实桌面进程已加载新版 WebView。
- `/desktop/prompt-state` ready 只证明 Smart Prompt 有可填入内容，不能证明目标 composer 可写；真实点击前仍必须满足 strict foreground 与 safe candidate。
- Codex 目前能看到 1 个 browser-like blocked candidate，但 `safeCandidateCount=0`；这只能解释为什么小人应可视觉贴近输入区，不能作为真实写入依据。

## 隐私边界

- 报告、记忆和 research JSON 只允许保存长度、hash、profile、candidate index、布尔 readiness、时间戳、文件大小/hash 前缀等元数据。
- 不要保存 prompt 正文、目标输入正文、剪贴板正文、raw title 或 raw UIA name。

## Runtime verification gap notes
- New: `p25-runtime-readiness@1` verifier now checks running `smart-prompt-desktop` only.
- Open risk: no matching process currently running, so `completionReady` false; this is environmental, not script logic.
- No residual PII risks: output includes process metadata and file metadata only, with explicit privacy false-positive flags set true.
- Residual gap: if process path is inaccessible (`ExecutablePath` empty/denied), matching is marked as unknown/failed unless privilege allows path read.

## 2026-06-13 当前未授权边界

- 不要运行 `scripts/check-p25-visual.ps1 -Mode MascotOverlayNoActivate` 来刷新 no-activate 证据，除非用户明确允许启动/切换桌面壳；该模式默认会启动传入的 exe 做窗口样式检查。
- 不要把 `overlayChatVisualPass=true` 解释成真实桌面壳已经更新；当前真实 runtime readiness 仍为 `no_smart_prompt_process_running`。
- 不要在 `safeCandidatesReady=false` 时加 `-AllowRealOverlayClick`；本轮没有真实点击、没有真实写入、没有 latest-fill verified。

## 2026-06-13 白块/旧 overlay 风险补记

- 不要把截图中的大白块判断为小人 PNG 问题；新版目标态必须由 `initialCompactProbe.largeWhiteBlockAbsent=true` 和 compact alpha 证据共同证明。
- 当前离线候选已证明启动默认态不会露大白块，但真实前台是否已加载新候选仍需 runtime readiness 证明；在没有用户明确许可前，不要启动、停止、替换桌面壳或 sidecar。

## 2026-06-13 状态条风险补记

- 新增 `data-mascot-mood`/状态条只表示 overlay UI 情绪状态，不要把它解释为 safe candidate、真实 Fill readiness 或目标输入框可写证据。
- `scan` mood 尤其只表示 visual-only/需要重新聚焦目标，不得升级为 `/desktop/fill` 资格；真实 Fill 仍必须通过 payload/readiness 对齐和只读 gate。

## 2026-06-13 覆盖式桌面小人 UI 增强

- 结果：`scripts/check-p25-overlay-chat-visual.js` PASS（含新加 `mascotMood` 校验）。
- 无代码层面的安全/隐私回归：未存储 prompt 文本、clipboard 或 raw 标识，仅保留长度/哈希元数据。
- 未完成（环境限制）：未进行真实 overlay click 与 real-fill 认证；`safeCandidatesReady` 未变更，不影响本次交付范围。
## 2026-06-13 小改风险收口（追加）

- `readiness hint` 增加了阻塞类文案，但当时未给 `scripts/check-p25-overlay-chat-visual.js` 补 no-safe-candidate / unsupported-profile 专门状态断言。
- 风险：当前离线视觉脚本若未覆盖该文案分支，后续提示文案可见性变化可能缺少回归保护。

## 2026-06-13 白块截图风险更新
- 不要把“备用 release 构建命令成功”直接等同于 exe 已刷新；本轮曾出现 cargo 未重新链接，runtime verifier 正确报 `candidate_exe_older_than_source_or_dist`。
- 已通过 `build.rs` 追踪 overlay/dist 文件缓解该风险；后续仍应以 runtime readiness 的 `candidate.fresh=true` 和 hash/mtime 为准。
- 当前真实桌面壳仍未运行匹配新版候选，不能声称用户前台已看到新透明入口；需要用户明确允许启动/切换桌面壳后才能做真实视觉复验。
## 2026-06-13 仍需注意（本次交付）
- 风险：未做真实桌面进程与 safe candidate 的 end-to-end；当前 gate 显示完成度仍受 `safeCandidatesReady`、`runtimeReady` 等外部运行时条件影响。
- 风险：离线脚本仍为展示层验证，未覆盖真实填充链路（按你要求本次不触发）。
## 2026-06-13 已收敛风险与仍需守住的边界

- 不要再把普通 `cargo build --release` 的 exe 当作真实生产壳验证候选；该产物会加载 `127.0.0.1:17372` devUrl，dev server 不在时主页面是 Chrome error page，前端自动贴附不会运行。
- 不要让 Smart Prompt 主窗口启动即显示，因为会抢走 Codex/WorkBuddy/Trae 前台，导致 `/desktop/input-snapshot` 返回 `profile=unknown` 并隐藏小人。
- 不要把 200% DPI 下的 overlay 尺寸当作图片缩放问题；本次根因是原生窗口尺寸使用 physical size 导致 WebView CSS viewport 只有 `36x36`。当前已改为 logical size，最终真实窗口为 `72x72`。
- 视觉 ready 不等于真实 fill ready。当前真实点击/填充仍缺 safe composer candidate 与 latest-fill verified；在 `safeCandidatesReady=false` 时不要运行 `-AllowRealOverlayClick`。
- 视觉/trace 报告只能保留几何、计数、hash、布尔和状态 token；不要保存 prompt 正文、目标输入正文、剪贴板文本、raw title 或 raw UIA name。

## 2026-06-13 当前真实点击边界

- 真实视觉已通过，但不要因此运行 `-AllowRealOverlayClick`；当前 Codex 只读诊断仍是 `safeCandidateCount=0`，真实写入和 latest-fill 仍缺证据。
- 小人遮挡提交按钮的当前风险已收敛：新定位和 2x 保守几何核算均显示小人与底部按钮候选不重叠；若用户继续看到遮挡，优先刷新 Codex 前台状态并复跑只读几何/视觉 attach，而不是放宽写入 gate。

## 2026-06-15 overlay 隐藏残留风险

- 如果用户看到 Codex/WorkBuddy/Trae 退出、最小化或切到不支持窗口后小人仍留在桌面，先查 runtime trace 是否已有 `overlay-hide-requested`；若已有，问题在原生 overlay 窗口没有真正隐藏，而不是 prompt-state/Draft 是否为空。
- Windows no-activate/topmost 透明 overlay 不要只依赖 Tauri `window.hide()`；应保留 `hide_overlay_window()` 的 `ShowWindow(SW_HIDE)` 硬隐藏，否则 `check-p25-overlay-background-hide.ps1` 会回到 `overlay_window_still_visible`。
- `foreground.isUsable=false`、`isMinimized=true`、`isCloaked=true` 或 `isVisible=false` 时不得使用 cursor/known-tool fallback 重新点亮 overlay，因为会让已退后台/最小化的真实工具继续被当作可贴靠目标。

## 2026-06-15 快速前台窗口绑定风险

- 不要再只依赖慢速 `/desktop/input-snapshot` 判断小人是否应该显示，因为 UIA 快照可能耗时数秒到数十秒；目标工具退后台或最小化后，旧快照可能把小人重新点亮。
- 当前应以 `get_foreground_window_state` 的快速 Win32 前台状态作为显示/隐藏第一守卫：非 Codex/WorkBuddy/Trae、`isUsable=false`、`isMinimized=true`、`isCloaked=true` 或 `isVisible=false` 时必须隐藏 overlay。
- 快速 show 不要每 180ms 重发；只在首次支持工具前台或窗口签名变化时重发，否则会造成抖动和日志噪声。

## 2026-06-16 原生 watcher 显隐边界
- 不要只依赖 `/desktop/input-snapshot` 慢快照来隐藏小人，因为最小化/退后台时旧 UIA 快照可能晚到或复活 overlay；必须保留 `start_foreground_overlay_watcher` 的 80ms Win32 前台 watcher，且前台不支持、不可见、最小化或 cloaked 时由原生层直接 `SW_HIDE`。
- 不要在 fast poll 或 slow snapshot in-flight 时丢弃新的显隐请求；当前 `pollPending` / `fastPollPending` 是为了保证工具出现、恢复、最小化这些状态变化会在当前请求结束后补跑。

## 2026-06-17 整改边界风险

- WorkBuddy/Trae 的 weak signal fallback 只能走 `VisualWebViewComposer` + `allowClipboardFallback` + foreground/title/profile 校验；不要把它解释成普通 UIA value pattern 直写资格。
- 桌面 overlay 自动轮询已改为 `setTimeout` 递归调度；如果测试或脚本仍检查 `setInterval` 字符串，应同步改成检查 backoff 调度函数，否则会产生过期静态断言。
- 非 Windows 凭证 fallback 改为本机随机 secret 文件；旧 `local-install-fallback` vault 仅用于兼容解密，不要继续用可预测字符串加密新凭证。

## 2026-06-17 P3 收口风险

- `prototypes/remotion-mascot/` 已标为未集成动画原型；不要把其中 MP4/PNG 预览解释为桌面壳 runtime 正在使用的生产动画资源。
- 非 Windows 桌面输入现在返回 `capability.supported=false` 与 `reason=desktop_input_requires_windows_uia`；`pendingBackends` 只表示未来方向，不代表 macOS/Linux 当前可识别或可写入。
- Rust Win32 unsafe 已补 SAFETY 注释并通过 `cargo check`；后续新增 Win32 unsafe 调用必须同步写明 HWND/指针/回调生命周期边界。
- `server.js` 已把普通 CRUD、desktop、auth/public、report 与 `/generate` 路由迁入 `createAppRoutes()`/`findAppRoute()` 表驱动；业务路由 if 链已清空，当前仅保留 CORS `OPTIONS` 预检分支。后续新增 local-service 路由不要绕回散落 if 链，因为会重新制造 P3-2 的可维护性问题。
- `apps/desktop-shell/src/desktop-overlay-logic.js` 必须先于 `src/app.js` 作为 classic script 加载；后续新增 overlay 纯判定/布局逻辑应继续放 helper，DOM、状态同步与 Tauri 调用仍留在 `app.js`，否则会重新把拆分边界粘回主文件。
- 用户已经授权真实前台写回测试，但 2026-06-17T16:48Z 的探测显示前台仍是 `codex`，WorkBuddy/Trae 均 `windowFound=false`；不要把这次 `pass=true` 解读成真实写回通过，因为 `write.attempted=false`、`completionImpact=target_tool_not_foreground`。
- 2026-06-17T17:24Z WorkBuddy 真实写回已进入更深一层：窗口可找到、前台/title/profile/safe candidate gate 通过，`write.attempted=true` 且 `noAutoSubmit=true`，但 UIA 读回验证不可用，`write.verified=false`；不要把该结果标成验收完成，除非后续获得脚本可验证读回或用户明确视觉确认并记录为人工确认。Trae 同轮仍 `windowFound=false`。
- 浏览器扩展二值快捷反馈已加 `quick-outcome`/`quick-toast-outcome` 独立 action，避免抢旧 `outcome`/`toast-outcome` 按钮选择器；快捷 `needs-work` 本地事件不强制 failure reason，但 local-service 聚合指标仍会按既有规则归一为 `low_quality`。
- shared core 已把技能数据 canonical 字段统一为 `riskLevel/sourceType`，rankSkills 内部变量统一为 `sourceBoost`；保留 `risk_level/source_type` 只用于读入旧数据兼容，不要再把 snake_case 写成新数据主字段。
- WorkBuddy real write is now attempted but not machine-verified: `clipboard_paste_fallback` ran with foreground/profile/title match and no auto-submit, yet UIA/value/text/nearby readback did not expose the pasted text. Do not mark WorkBuddy as fully verified unless a later machine-readable signal or explicit manual visual confirmation is recorded.
- User later confirmed the WorkBuddy paste was not visible. Treat the earlier WorkBuddy `clipboard_paste_fallback` attempt as failed, not partial acceptance.
- WorkBuddy weak-signal `VisualWebViewComposer` fallback is now disabled. Do not re-enable it to force green reports; WorkBuddy real fill must have a strong safe candidate before writing.
- Invisible/minimized/cloaked/unusable foreground windows are now blocked in both the orchestration script and the fill script. Do not bypass this with clipboard fallback, because it can paste into an unseen or wrong target.
- Current WorkBuddy evidence is intentionally blocked: `candidateCount=0`, `safeCandidateCount=0`, `write.attempted=false`, reason `foreground_fill_requires_safe_candidate`.
- Latest WorkBuddy blocker after `继续`: the attach target can regress to a minimized/offscreen WorkBuddy HWND (`x=-16000,y=-16000,width=157,height=25`). Treat this as environment/window-state blocked; do not paste, move cursor, or claim validation while `isUsable=false`.
- WorkBuddy exposes only root window/pane UIA nodes in the current environment, so machine-readable WorkBuddy verification may remain unavailable unless the app exposes a real Edit/Document/TextPattern/ValuePattern candidate or a later readable signal. Manual visibility confirmation is still separate from machine verification and must be recorded explicitly.
- Visual fallback coordinate math for WorkBuddy/Trae now uses Win32 bounds to avoid UIA root DPI mismatch. Do not mix UIA-root coordinates with Win32 cursor coordinates for WebView-only visual candidates.
- Latest WorkBuddy visible-window blocker: even when the window is visible/usable, the process may block or redirect automatic cursor placement away from the predicted composer region. In that case reports must use `foreground_fill_requires_manual_composer_focus` and must keep `write.attempted=false`; do not re-enable weak clipboard fallback.
- Trae real write is machine-verified: foreground/profile/title match, safe candidate, `write.attempted=true`, `verified=true`, and `noAutoSubmit=true`.
- WorkBuddy focused rerun can now find a cursor-anchored visual safe candidate, but writeback remains not machine-verified because WorkBuddy exposes no readable Edit/Document/TextPattern/ValuePattern candidate. Treat `clipboard_paste_fallback` + `noAutoSubmit=true` as an attempted write only until either machine readback or explicit user visual confirmation is recorded.
- Do not rely on the older top-level `pass=true` value in any WorkBuddy real-write report created before the 2026-06-18 pass-semantics fix. The authoritative fields for those reports are `write.attempted`, `write.verified`, `write.reason`, `checks.writeValidated`, and `completionImpact`.
- Installed sidecar smoke can be polluted by a stale `local-service-sidecar.exe` already listening on the smoke test service port. The smoke script now stops only Smart Prompt sidecar-runtime processes on that exact port before/after the run; do not broaden this cleanup to arbitrary processes or default user service ports.
- Any future M3 PowerShell probe dependency must be copied into `apps/desktop-shell/src-tauri/resources/smart-prompt-sidecar/` by `prepare-sidecar.js`. The installed app cannot use repo-local scripts/config after packaging; missing dependencies appear as `/desktop/input-snapshot` 500s.

## 2026-07-18 options / 多实例风险收口

- 根因 1：`options/options.html` 曾直接加载 `prompt-engine.js`，但未先加载其浏览器全局依赖 `smart-prompt-core.js`。以后新增独立 extension page 时必须显式遵守 shared core 加载顺序，并由页面级 runtime test 覆盖。
- 根因 2：桌面壳此前没有 OS 级单实例守卫，重复启动会产生真实的多个 `smart-prompt-desktop.exe` 和任务栏图标。不要用前端 DOM 去重掩盖该问题；单实例插件必须保持为第一个注册的 Tauri 插件。
- 单实例不能只验证第二进程退出：还必须验证主窗口由隐藏态显示/聚焦、由最小化态恢复/聚焦。Windows 探针不要使用 `Process.MainWindowHandle`，因为它可能选中 Tauri 的 `com.smartprompt.desktop-siw` 内部窗口；应按 PID + 精确标题 `Smart Prompt` 枚举顶层窗口。
- Chrome 的 `chrome://extensions` 错误列表会保留历史错误。自动化安全策略不允许直接控制该内部页，因此本轮只证明新运行时不再产生错误，不能声称用户 Chrome 中旧条目已经自动清空；用户重载扩展后可手动清空历史记录再观察。
- 当前运行的是隔离构建的修正版 release，不等于正式安装目录已被升级。后续发布/安装包构建必须包含更新后的 `Cargo.lock` 和单实例插件，安装升级后再做一次 installed-runtime 双启动验收。

## 2026-07-18 安装验收风险收口

- Windows UIA PowerShell 的 warning 可能写入 stdout 并位于 JSON 前；不要再对 probe stdout 整段执行 `serde_json::from_str`。当前解析器要求精确 input/fill schema、布尔 `pass` 和对象 `privacy`，并有 clean/noisy/unrelated/wrong-schema-first 四类测试。
- 桌面壳固定使用 `17371`；installer smoke 与 installed-runtime probe 不得继续默认 `17391`，否则会把健康的安装版误报为 sidecar 未启动。
- 当前 NSIS/MSI 与安装后的 exe 均未做 Authenticode 签名。它们适合本机开发安装，但正式分发前仍必须补代码签名与发布版本升级。
- 旧 `C:\Users\lhy10\AppData\Local\Temp\smart-prompt-v4-installer-smoke\install` 目录仍作为可恢复历史产物保留，但卸载注册表、快捷方式和当前进程均已指向稳定安装目录；不要把旧目录重新当正式安装来源。
- Windows 不保证每次 `set_focus()` 都能抢占当前前台；单实例验收应硬校验进程唯一、隐藏窗口可显示、最小化窗口可恢复，并保留 `set_focus()` 静态契约。测试主动最小化使用同步 `ShowWindow`，且启动前等待旧进程/互斥量稳定。
