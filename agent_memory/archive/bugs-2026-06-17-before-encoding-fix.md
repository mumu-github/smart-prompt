# 问题与风险

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

- 不要运行 `scripts/check-p25-mascot-overlay-noactivate.ps1` 来刷新 no-activate 证据，除非用户明确允许启动/切换桌面壳；该脚本默认会启动传入的 exe 做窗口样式检查。
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
# 2026-06-13 С�Ĳ�������գ����ӣ�
- ���������� readiness hint ����չʾ���İ�����δ�� `scripts/check-p25-overlay-chat-visual.js` ���Ӷ�Ӧ no-safe-candidate/unsupported-profile ��ר��״̬�ű����ԡ�
- ���գ���ǰ�����Ӿ��ű�û�и��Ǹ����İ���֧�������ʾ�ɼ�������Ϊ�仯��δ�γɻع�������

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
