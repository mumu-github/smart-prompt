# 项目上下文

## P25 桌面壳准备状态证据上下文 2026-06-09

- 真实 overlay 点击验证现在不应再依赖人工 `-DesktopPromptPrepared` 作为完成证据；桌面壳会向 local-service 上报 `/desktop/prompt-state`，验证器只读取 `prepared`、`activeTextKind`、长度、hash、生成来源和 readiness/noAutoSubmit 元数据。
- Node local-service 与 Rust native sidecar 都支持 `POST/GET /desktop/prompt-state`，schema 为 `p25-desktop-prompt-state@1`；不保存 draft/prompt 正文、目标输入正文、raw title 或剪贴板正文。
- `scripts/check-p25-real-overlay-click-fill.ps1` 的点击前置条件现在要求 `desktopPromptStateReady=true`；当前机器该项为 false，因为没有正在运行的桌面壳服务状态可读，同时仍缺 strict foreground 与 safe composer candidate。
- `scripts/check-p25-overlay-click-chain.ps1` 已把 `desktopShellSyncsPromptState`、`localServiceStoresPromptState`、`sidecarStoresPromptState` 纳入静态审计；这仍只是安全链路证据，不等于真实 Codex/WorkBuddy/Trae 端到端完成。

## P25 composer 候选诊断上下文 2026-06-09

- `scripts/check-p25-composer-candidate-diagnostics.ps1` 用于解释 `safeCandidateCount=0` 的原因；它只输出 hash、几何、布尔信号和拒绝 reason，不能读取 raw title、raw element name、目标输入正文或 prompt 正文。
- 当前 Codex 候选诊断显示：snapshot 仍来自 `cursor_known_tool_window_fallback`，183 个候选中主要是按钮和静态文本，缺 focus/caret/semantic composer 信号，因此 `safe_composer_candidate_missing` 是正确结果，不应显示小人或写入。
- 总审计 `scripts/check-p25-overlay-click-chain.ps1` 已纳入 composer diagnostics 的存在性与隐私检查；该诊断只帮助定位规则缺口，不是端到端完成证据。

## P25 真实 overlay 点击填入验证上下文 2026-06-09

- 真实桌面小人目标仍是 Codex/WorkBuddy/Trae composer 附近的 `mascot-overlay`，检测到安全可写输入候选后自动显示；点击小人不能绕过 `profile/titleHash/candidateIndex/noAutoSubmit` payload 对齐、foreground guard 或隐私边界。
- 现在 local-service 与 native sidecar 都会在 `/desktop/fill` 后维护一个脱敏的 latest fill 摘要，并通过 `GET /desktop/fill/latest` 暴露给本机验收；该摘要只用于验证真实 overlay 点击是否触发了守卫填入，不保存 prompt 正文、目标输入正文、剪贴板正文或 raw title。
- `scripts/check-p25-real-overlay-click-fill.ps1` 是真实小人点击填入的机器验收入口：默认只读；只有 `-AllowRealOverlayClick -DesktopPromptPrepared`、目标矩阵 strict foreground、安全候选、overlay no-activate 都满足时才点击真实 overlay；点击后轮询 `/desktop/fill/latest`，要求 fill `confirmForeground=true`、profile/title 匹配、safe candidate 存在、verified=true、no-auto-submit。
- 当前环境仍不能完成端到端：`research/p25-real-desktop-targets.latest.json` 中 Codex 未成为 strict foreground，WorkBuddy/Trae 不存在可附加窗口，safe candidate 计数为 0；因此真实点击验证器保持 `completionReady:false` 是正确结果。

## P25 overlay 点击链路审计上下文 2026-06-09

- `scripts/check-p25-overlay-click-chain.ps1` 是当前 overlay 自动检测/点击/填入守卫链路的聚合审计入口，输出 `research/p25-overlay-click-chain.latest.json`；该报告的 `pass:true` 只代表安全链路具备，不代表目标完成。
- 当前报告 `completionReady:false`，`completionImpact:"real_overlay_click_fill_missing"`；它要求真实目标严格前台、safe composer 候选、真实写入验证和真实 overlay click fill report 都存在后才可能完成。
- `apps/desktop-shell/src/app.js` 的 `isMascotOverlayPayloadAligned()` 现在缺 payload 返回 false；overlay 点击必须带 `profile/titleHash/candidateIndex/noAutoSubmit` 并与当前 locked snapshot 一致，缺 payload 或 stale payload 都应 blocked，不允许触发 `/desktop/fill`。
- 后续若新增真实 overlay 点击填入验证，应写入 `research/p25-real-overlay-click-fill.latest.json` 或更新审计脚本的对应输入；不要用静态测试、fake service 或 cursor fallback 替代真实 Codex/WorkBuddy/Trae composer 证据。

## P25 前台激活与矩阵口径上下文 2026-06-09

- `scripts/check-m3-real-desktop-tools.ps1` 现在会记录 `attach.foregroundActivation`，包含初次 `SetForegroundWindow`、`AttachThreadInput` 路径、Alt 解锁路径和最终切换路径；这只是让真实目标窗口更容易被检测，不代表允许写入。
- `scripts/check-p25-real-desktop-targets.ps1` 现在区分 `foregroundDetected` 与 `strictForegroundDetected`：`cursor_known_tool_window_fallback` 只能说明鼠标所在窗口像目标工具，不能作为完整端到端完成证据。
- 当前环境下 Codex 可被找到，但最新矩阵显示 Codex 只通过 cursor fallback 识别，`strictForegroundDetectedCount=0`，且 safe composer 候选为 0；写入守卫矩阵打开写入开关也没有实际写入。
- 后续若用户把 Codex/WorkBuddy/Trae 真实 composer 切到前台，先跑 `scripts/check-p25-real-desktop-targets.ps1` 确认 `strictForegroundDetected=true`、`targetSafeCandidateCount>0`、`targetBestCandidateIndex>=0`，再跑写入守卫/真实写入验证。不要把 fallback、broad Document、按钮或非底部元素当作 safe composer。

## P25 真实目标矩阵上下文 2026-06-09

- 当前真实目标状态入口为 `scripts/check-p25-real-desktop-targets.ps1`，默认只读探测 `codex/workbuddy/trae`；需要真实写入守卫验证时显式加 `-AllowForegroundWrite -AllowClipboardFallback -AllowTextPatternVerification`。
- 最新只读矩阵 `research/p25-real-desktop-targets.latest.json`：3 个目标中仅 Codex 窗口存在，但脚本没有把 Codex 设为前台；WorkBuddy/Trae 没有可附加窗口。矩阵 `completionReady=false` 是正确结论。
- 最新写入守卫矩阵 `research/p25-real-desktop-targets-write-guard.latest.json`：允许写入开关已打开，但因目标未前台，写入未尝试；这证明 no-auto-submit 和 foreground/title/profile 守卫没有被绕过。
- 后续若用户把 Codex/WorkBuddy/Trae 切到真实 composer 前台，应先跑只读矩阵确认 `foregroundDetectedCount`、`targetSafeCandidateCount` 和 `targetBestCandidateIndex`，再跑写入守卫/真实写入矩阵；不要在 targetSnapshotApplies=false 时把 Hermes 或其它前台候选当作目标候选。

## P25 本轮上下文补充 2026-06-09

- `Smart Prompt Mascot` overlay 的真实 Win32 顶层窗口样式已通过 `scripts/check-p25-mascot-overlay-noactivate.ps1` 验证：报告 `research/p25-mascot-overlay-noactivate.latest.json` 中 `overlayWindow.exStyleHex=0x8040118`，`noActivate=true`，`topmost=true`。
- Tauri no-activate 逻辑必须同时作用于 WebView HWND 和 `GetAncestor(..., GA_ROOT)` 顶层 HWND；不要只依赖 `focused(false)` 或只给 `window.hwnd()` 设置样式，因为实测顶层窗口可能仍缺少 `WS_EX_NOACTIVATE`。
- 后续验收必须继续区分三类证据：overlay 自身渲染/窗口样式、目标工具 snapshot/profile/readiness、真实 composer 写入验证。本轮只补齐了 overlay 非激活运行时证据，完整目标仍需要 Codex/WorkBuddy/Trae composer 端到端通过。

## 当前 P25 真实桌面悬浮小人与输入融合上下文 2026-06-09

- 当前目标是桌面工具内的网页版同款体验：小人必须出现在真实 Codex/WorkBuddy/Trae composer 输入区域附近，检测到可输入状态后自动激活，而不是只在 Smart Prompt 主窗口里显示按钮或面板。
- 桌面壳新增 `mascot-overlay` Tauri 子窗口，加载 `overlay.html`、`src/overlay.js`、`src/overlay.css` 和现有 `src/assets/mascot-states/*.png`；`src-tauri/capabilities/default.json` 已允许 `main` 与 `mascot-overlay`。
- overlay 定位来自脱敏 UIA snapshot 的候选 boundingRect；定位候选跳过整窗 `Document`、按钮、过大/过小矩形，优先 bottom/composer-like/focus/caret/semantic 信号。填入守卫仍由 M3 foreground fill 的 title hash/profile/candidate index 决定。
- overlay 点击只触发主窗口处理，不直接读写目标输入框；主窗口填入仍走 local-service `/desktop/fill` 守卫链路，保持 no-auto-submit 和隐私边界。
- 系统壳前台需要保守处理：`explorer`、`LockApp`、`ShellExperienceHost` 等不能通过相关进程名字推断成工具 profile；当前检测/填入/smoke 脚本均有该 guard。
- 当前输入检测有两层 fallback：普通 foreground snapshot 优先；如果系统壳/Backstop 没有安全候选，可以用鼠标所在的可见顶层已知工具窗口重试 snapshot。该 fallback 只用于识别 profile/hash/候选矩形，不读取 raw title/input。
- 定位候选和写入候选要分开理解：overlay 可以贴到底部 composer 容器附近，但 `/desktop/fill` 必须使用安全写入候选；Codex/Claude/Hermes 等不能把整窗 broad `Document` 算作 safe candidate，缺少真实 `Edit`/focus/caret 时应保持 guarded。
- 目标小人自动悬浮 profile 与底层诊断 profile 不完全相同：底层仍支持五类工具，但 `mascot-overlay` 自动显示只允许 Codex/WorkBuddy/Trae，避免偏离用户明确要求。
- 桌面壳现在区分 `ready` 与 `overlayReady`：`ready` 代表可走守卫填入链路，`overlayReady` 还必须满足目标 profile 白名单；Codex 等目标 profile 如果只有 broad Document 或 `safeCandidateCount=0`，应显示/记录 `no-safe-candidate` 并隐藏 overlay，不应依赖 sticky 保留旧小人。
- 自动检测是目标体验的一部分：桌面壳启动后会注册 1400ms 轮询并立即探测一次；服务状态加载不能清空已锁定的桌面 snapshot，否则会出现 overlay 已显示但主 UI 显示 missing 的脱节。
- overlay 点击必须校验自身 payload 与当前 locked snapshot 一致：`profile/titleHash/candidateIndex/noAutoSubmit` 不匹配时不允许填入，并应隐藏旧 overlay/标记 blocked。`candidateIndex` 表示安全写入候选，定位小人可以使用另一个候选矩形，但不能把定位候选当写入候选。
- Windows 上 overlay 需要是非激活窗口：创建后设置 `WS_EX_NOACTIVATE`，show/reposition 时使用 `SWP_NOACTIVATE`，否则点击小人会把前台从真实 composer 抢走，导致 foreground guard 正确拦截但体验上无法填入。
- 真实桌面验证时需区分三类证据：overlay 子窗口自身渲染证据、前台工具 profile/snapshot 证据、真实写入验证证据。当前已具备 release overlay 渲染证据和系统壳不误激活证据；Codex/WorkBuddy/Trae 仍需要在用户真实前台 composer 稳定可聚焦时复验自动显示与点击填入。

## 当前 P24 桌面小人与输入融合上下文 2026-06-09

- 新 autoresearch-goal mission：`smart-prompt-desktop-mascot-input-fusion-parity`，目标是让本地 Codex/WorkBuddy/Trae 等桌面工具里的体验接近网页扩展：有真实小人，小人交互直接进入工具输入流，而不是停留在诊断面板。
- 桌面壳 `Desktop Companion` 现在新增 `desktop-fusion-console`：可点击小人、草稿输入、生成后可编辑 prompt、显式前台填入按钮和 metadata-only 证据行。
- 前台填入继续复用 M3 守卫协议：必须有 snapshot readiness、safe candidate、title hash、tool profile、candidate index；调用 `/desktop/fill` 时发送 `confirmForeground:true`、`expectedTitleHash`、`expectedToolProfile`、`candidateIndex`、`allowClipboardFallback:true`，仍不自动提交。
- 新增 critic：`scripts/critic-p24-desktop-mascot-input-fusion.ps1`；证据报告：`research/p24-desktop-mascot-input-fusion.latest.json`，当前 pass。
- 视觉 smoke 截图：`research/p24-desktop-fusion-preview.png` 与 `research/p24-desktop-fusion-preview-mobile.png`。

## 当前托盘图标第三次修复上下文 2026-06-09

- 用户最新截图显示 Windows 隐藏托盘里仍没有对应 Smart Prompt 小人图标；这次按运行时 tray 链路处理，而不是只看 exe 关联图标。
- Smart Prompt 当前新增托盘专用资产：`assets/brand/smart-prompt-tray-32.png` 和 `apps/desktop-shell/src-tauri/icons/tray.png`。它仍然使用现有 `normal` 小人，不重新设计角色；最新版本裁掉透明留白并把小人本体放大到接近满格，避免托盘视觉尺寸偏小。
- `apps/desktop-shell/src-tauri/src/main.rs` 的 `smart_prompt_tray_icon()` 现在内嵌 `../icons/tray.png`；setup 构建出的 `TrayIcon` 通过 `app.manage(tray)` 持有，避免只依赖局部变量生命周期。
- 图标验收脚本 `scripts/check-brand-icons.js` 现在检查 tray PNG 尺寸、可见区域至少 `22x29`、最小字节数、Tauri runtime 绑定和 `app.manage(tray)`；桌面壳静态测试也覆盖 `src-tauri/icons/tray.png`。
- 新 release 产物已重新生成；若用户仍看到旧空白，需要优先确认是否运行了旧进程/旧安装包，或 Windows 托盘缓存尚未刷新。

## 当前 M3 WorkBuddy/Trae 真实桌面输入融合上下文 2026-06-09

- 已用真实桌面控制检查用户已打开的 WorkBuddy 与 Trae 窗口：两者在真实 composer 状态下都能输入测试文本，并已在取证后清空；没有按发送键。
- WorkBuddy 的 UIA 焦点会停在根 `Document`，但 composer 附近有固定占位符“今天帮你做些什么 / 引用对话文件 / 调用技能与指令”；Trae composer 附近有 `chat-input`、`agent-entry`、`SOLO Agent`、`/plan`、`/spec` 等固定标记。
- `scripts/check-m3-desktop-input.ps1` 与 `scripts/check-m3-desktop-fill.ps1` 现在为 WorkBuddy/Trae 增加 `semanticComposerHint`：只匹配固定 UI 占位符、AutomationId 或 className，并仍要求候选是底部 composer 几何范围、不是整窗 `Document`。
- local-service 脱敏输出会保留 `semanticComposerHint` 与 `semanticCandidateCount` 布尔/计数字段；仍不保存输入框值、用户 prompt、占位符原文或完整窗口标题。

## 当前托盘图标二次修复上下文 2026-06-09

- 用户截图显示 Windows 隐藏托盘里仍有空白占位；本轮确认当前没有正在运行的 Smart Prompt 进程，因此该截图很可能来自旧实例、旧安装项或 Windows 托盘缓存。
- 已将 Tauri tray 图标从“只依赖 `default_window_icon()`”升级为优先使用编译期内嵌的 `src-tauri/icons/icon.png`：`smart_prompt_tray_icon()` 通过 `Image::from_bytes(include_bytes!("../icons/icon.png"))` 构造运行时 tray image，失败时才回退到默认窗口图标。
- `tauri` 依赖已显式开启 `image-png` feature；tray builder 使用稳定 id `smart-prompt`，并继续使用同一套小人 normal 品牌图标资产，不改角色形象。
- 新发行包已重新构建：`apps/desktop-shell/src-tauri/target/release/smart-prompt-desktop.exe`、`apps/desktop-shell/src-tauri/target/release/bundle/msi/Smart Prompt_0.2.0_x64_en-US.msi`、`apps/desktop-shell/src-tauri/target/release/bundle/nsis/Smart Prompt_0.2.0_x64-setup.exe`。
- Windows 关联图标已再次提取为 `research/smart-prompt-exe-associated-icon.png`，显示 32x32 小人图标非空；若用户仍看到空白，下一步优先要求关闭旧托盘项/重装新版/必要时重启 Explorer 清理托盘缓存。

## 当前托盘图标修复上下文 2026-06-09

- Windows 托盘空白图标根因已定位为 Tauri tray 没有显式设置图标；`apps/desktop-shell/src-tauri/src/main.rs` 现在会从 `app.default_window_icon()` 取应用图标并传给 `TrayIconBuilder.icon(icon.clone())`。
- Smart Prompt 桌面端、安装包和托盘图标继续共用 `assets/brand/` 派生的小人 normal 品牌图标，不改角色形象。
- 新 release 产物已重新生成：`apps/desktop-shell/src-tauri/target/release/smart-prompt-desktop.exe`、`apps/desktop-shell/src-tauri/target/release/bundle/msi/Smart Prompt_0.2.0_x64_en-US.msi`、`apps/desktop-shell/src-tauri/target/release/bundle/nsis/Smart Prompt_0.2.0_x64-setup.exe`。
- Windows 资源层已确认新 exe 可提取非空关联图标，提取预览为 `research/smart-prompt-exe-associated-icon.png`；若用户托盘仍显示空白，优先怀疑旧进程、旧安装包或 Windows 托盘缓存残留。

## 当前品牌图标资产上下文 2026-06-09

- Smart Prompt 各渠道图标已确定为现有小人 `normal` 状态，不重新设计角色；交互小人状态仍独立用于网页/桌面内的动作与表情。
- 品牌图标源为 `assets/brand/smart-prompt-icon-source.png`，通用尺寸为 `assets/brand/smart-prompt-icon-{16,32,48,64,128,256,512,1024}.png`。
- Chrome/Edge 扩展图标已落到 `prototypes/browser-extension/assets/icons/icon-{16,32,48,128}.png`，并接入 `manifest.icons` 与 `action.default_icon`。
- Tauri 桌面壳图标已落到 `apps/desktop-shell/src-tauri/icons/32x32.png`、`128x128.png`、`128x128@2x.png`、`icon.png` 和多 entry `icon.ico`，并接入 `tauri.conf.json` 的 `bundle.icon`。
- 图标生成与验收脚本为 `node scripts/generate-brand-icons.js` 和 `node scripts/check-brand-icons.js`；渠道矩阵文档为 `docs/brand-icons.md`。

## 当前 M3 桌面输入真实窗口上下文 2026-06-08

- WorkBuddy 与 Trae 真实窗口 pilot 已从“只看 profile/self-test”推进到真实前台识别：`scripts/check-m3-real-desktop-tools.ps1` 可 attach 已打开窗口，先 restore 最小化窗口，再 set foreground，并把鼠标放回目标窗口内，避免 cursor/foreground 被 Codex 或其它窗口污染。
- `scripts/check-m3-desktop-input.ps1` 与 `scripts/check-m3-desktop-fill.ps1` 现在区分泛输入候选与 `safeCandidateCount`：WorkBuddy/Trae 的 WebView 视觉兜底只用于定位提示，不再默认作为可写 prompt composer。
- 当前用户打开的 WorkBuddy 与 Trae 窗口均可被识别为目标 profile，但都不是安全 prompt 输入态：WorkBuddy 当前窗口只有视觉兜底候选，Trae 当前窗口有多个泛输入候选但 0 个安全 composer 候选；填入会被 `foreground_fill_requires_safe_candidate` 拦截，不会误写 URL、任务列表或侧边栏。
- Trae 曾暴露 UIA 假阳性：`ValuePattern.SetValue()` 对高分 Edit 候选返回可调用，但 TextPattern/ValuePattern 读回只有换行，且视觉截图显示该候选不是 prompt composer；因此后续不要仅靠 ValuePattern/焦点分数判断 Trae 可填。
- 真实可写验证的下一条件：用户需要把 WorkBuddy/Trae 切到真正可输入 prompt 的 composer 状态；届时再跑 real desktop fill，应看到 `safeCandidateCount > 0`、`bestCandidateIndex >= 0`，再允许写入。

## 当前 P23 桌面壳 UI/i18n 与桌面工具融合上下文 2026-06-08

- 桌面壳已按“苹果式极简高端产品叙事风格”重做首屏和主面板：黑色产品 hero、大字号短文案、真实小人资产、克制黑白灰/青绿色点亮、8px 卡片、清晰分区和体系化按钮类 `button-primary` / `button-secondary` / `button-danger`。
- 桌面壳 UI 已支持 `auto` / `zh-CN` / `en`：静态文案、占位符、aria、离线初始态、桌面伴随空状态、学习面板空状态和小人状态标签都会走 `UI_MESSAGES`；小人内部状态码仍保留 `normal/resting/thinking/suggesting/success/clapping`。
- 新增 `Desktop Companion` 面板，用于真实桌面工具前台识别、候选输入框摘要、安全填入自测和支持工具 profile 展示；全局快捷键现在不会先把桌面壳抢到前台，避免破坏 Codex/workBuddy/Trae 等真实前台窗口识别。
- 桌面工具 profile 已扩展到 `codex`、`claude-code`、`hermes`、`workbuddy`、`trae`；workBuddy/Trae 当前已有本地 profile 与 self-test 覆盖，真实窗口矩阵仍需用户打开对应工具后继续跑 pilot。
- 当前视觉证据为 `research/p23-desktop-shell-visual.png` 与 `research/p23-desktop-shell-visual-mobile.png`；CDP 验证移动端 `innerWidth=390` 且 `docScrollWidth=390`，无横向溢出。

## 当前 V6 P17 Outcome 补标队列上下文 2026-06-08

- V6 P17 已新增隐私安全的延迟 outcome 补标队列：local-service 提供 `GET /outcomes/pending`，从 `prompt-history` 和 metrics 中生成待补标 generation/insert 候选；已标注 outcome 的 generation 会自动从队列排除。
- local-service 提供 `POST /outcomes/follow-up`，支持 `success`、`needs-work`、`failed` 三种补标，并写入标准 `outcome` metric，`outcomeSource` 为 `manual_followup`，同时继承 generationId、strategyId、taskScenario、experiment/strategy weight/quality lift 等元数据。
- 桌面壳新增 `Outcome Follow-up` 面板，展示待补标数量和 metadata-only 候选，用户可稍后点击三种结果按钮；补标后会刷新 Pilot Outcomes 和 Quality Lift 面板。
- 补标队列只展示和传输元数据：generationId、策略、模式、工具、host、场景、实验组、cohort、promptLength、lastAction 等；不展示 prompt 正文、用户输入正文、页面正文或完整 URL。
- OMX mission `smart-prompt-v6-p17-outcome-followup-queue` 已记录 pass；完整 V6 critic 仍输出 `V6_PROMPT_QUALITY_PASS`。active Codex goal 仍保持 active，因为还需要真实内测样本证明长期质量提升。

## 当前 V6 P16 Quality Lift 桌面面板上下文 2026-06-08

- V6 P16 已把 P15 的 `v6-quality-lift@1` 聚合报告落到桌面壳 UI：`Quality Lift` 面板会展示 readiness、primary decision、baseline/strategy-guided/outcome-weighted cohort 计数、success/score/retry/undo lift delta 和 recommendations。
- 桌面壳现在会在 `loadServiceState()` 中读取 `GET /metrics/prompt-quality-lift`；`Export Diagnostics` 若带 `promptQualityLiftReport` 也会同步刷新面板；用户也可点 `Refresh` 手动刷新。
- 面板只渲染 local-service 已脱敏的 aggregate-only 报告，不显示 prompt 正文、用户输入正文、页面正文或完整 URL；测试覆盖 ready/positive lift 数据和诊断导出刷新路径。
- OMX mission `smart-prompt-v6-p16-quality-lift-dashboard` 已记录 pass；完整 V6 critic 仍输出 `V6_PROMPT_QUALITY_PASS`。active Codex goal 仍保持 active，因为还需要真实内测样本长期证明 lift 稳定。

## 当前 V6 P13 延迟 outcome 标注上下文 2026-06-08

- V6 P13 已把 outcome 标注入口从 Prompt Card 扩展到 Insert 后的 Undo toast：用户填入 prompt 后，即使卡片关闭，也能在 toast 上标记 `success`、`needs-work`、`failed`。
- 延迟标注复用 `recordFeedbackEvent("outcome")` 安全链路，`outcomeSource` 为 `manual_toast`，仍只记录 outcome label/score/verified、generation/strategy/taskScenario 等元数据，不记录 prompt 正文、输入正文、页面正文或完整 URL。
- Toast outcome 点击不会写目标输入框、不会关闭 Undo toast、不会自动发送；用户仍可继续点 Undo。
- runtime demo 已覆盖 Insert 后点击 toast 的 `needs-work`，并验证扩展本地 feedback 与 local-service metrics 都收到 `manual_toast` outcome，且带 generationId、strategyId、taskScenario。
- active Codex goal 仍保持 active：P13 让真实 outcome 更容易被采样，但还需要实际内测数据累积后才能证明提示词质量提升。

## 当前 V6 P12 pilot outcome 面板上下文 2026-06-08

- V6 P12 已把 P11 的 JSON readiness 报告落到桌面壳 UI：`apps/desktop-shell/index.html` 新增 `Pilot Outcomes` 面板，展示 readiness、outcome 总数、成功率、均分、winning/risk strategies 和 collection targets。
- 桌面壳 `loadServiceState()` 会读取 `GET /metrics/pilot-outcomes` 并渲染面板；`Export Diagnostics` 如果带 `pilotOutcomeReadinessReport`，也会同步刷新面板；用户可用 `Refresh` 手动刷新。
- 面板只渲染 local-service 已脱敏的聚合报告，不展示 prompt 正文、用户输入正文、页面正文或完整 URL；`site` 仍由 P11 报告收敛为 host。
- V6 critic 现在会额外运行 `apps/desktop-shell` 的静态/交互测试，因此桌面 outcome 面板成为提示词质量闭环的硬门槛之一。
- active Codex goal 仍保持 active：P12 让用户能看到采样缺口和策略风险，但仍需要真实内测 outcome 样本来证明提示词质量实际提升。

## 当前 V6 P11 pilot outcome readiness 上下文 2026-06-08

- V6 P11 已把真实内测 outcome 从“有事件可回流”推进到“可导出 readiness 报告”：`buildPilotOutcomeReadinessReport` / `formatPilotOutcomeReadinessReport` 输出 `v6-pilot-outcome-readiness@1`，按 taskScenario、tool、site、mode、strategyId、experimentArm 聚合 outcome 样本。
- local-service 现在提供 `GET /metrics/pilot-outcomes`，`/diagnostics/export` 也会包含 `pilotOutcomeReadinessReport` 和 `pilotOutcomeReadinessText`；报告只保留聚合计数、成功率、均分、winning/risk strategy、collectionTargets 和隐私标记。
- pilot outcome 报告会把 site 收敛到 host，不保留完整 URL、prompt 正文、用户输入正文或页面正文；`scripts/check-v6-pilot-outcomes.js` 用敏感哨兵文本验证不泄露。
- V6 critic 已把 P11 纳入硬门槛：`scripts/critic-v6-prompt-quality.ps1` 会运行 pilot outcome probe，并校验 ready/collecting/empty cohort、winner/risk strategy、collection target、隐私标记和 redaction。
- active Codex goal 仍保持 active：P11 证明了“如何判断内测数据是否足够”和“下一批该收哪些样本”，但真实 prompt 质量提升还需要实际内测样本累积后再判断。

## 当前 V6 P10 outcome 标注 UI 上下文 2026-06-08

- V6 P10 已把 P9 的 outcome 学习链路做成真实卡片入口：Prompt Card 现在有紧凑的 `结果/Outcome` 控件，支持 `success`、`needs-work`、`failed` 三种用户标注。
- outcome 标注只记录隐私安全元数据：`generationId`、`strategyId`、`promptStrategyId`、`experimentVersion/arm/comparisonKey`、`taskScenario`、`outcomeLabel`、`outcomeScore`、`outcomeVerified`、`outcomeSource` 和 `promptLength`；不发送 prompt 正文、用户输入正文、页面正文或完整 URL。
- outcome UI 点击不会写入目标输入框、不会关闭卡片、不会自动发送消息；runtime demo 已验证点击 `success` 后 `submitCount` 仍为 0。
- local-service outcome 成功判断已修正：`failed` / `needs-work` label 优先于 `outcomeVerified`，因此“用户确认这次无效/待改”不会被误算成成功。
- `prototypes/browser-extension/tests/runtime-demo.test.js` 现在会在真实 headless 页面点击 outcome 按钮，验证扩展本地反馈与 local-service `/metrics` 都收到 outcome 事件，并确认事件不含 prompt 正文。
- OMX mission `smart-prompt-v6-p10-outcome-label-ui` 已记录 pass；最新完整验收仍通过 `scripts/critic-v6-prompt-quality.ps1`，输出 `V6_PROMPT_QUALITY_PASS`。
- active Codex goal 仍保持 active：P10 已提供真实内测采样入口，但还需要真实使用一段时间后用 outcome 样本证明提示词质量实际提升。

## 当前 V6 P9 任务 outcome 反馈闭环上下文 2026-06-08

- V6 P9 已把提示词优化从 Insert/Save/Retry/Undo 交互指标推进到“任务结果 outcome”指标：metrics 现在支持 `outcomeLabel`、`outcomeScore`、`outcomeVerified`、`outcomeSource`，并聚合 `outcomes`、`successfulOutcomes`、`failedOutcomes`、`outcomeSuccessRate`、`avgOutcomeScore` 和 outcome labels。
- 新增 `buildTaskOutcomeReport` / `formatTaskOutcomeReport`，按 mode/tool/adapter/site/taskScenario cohort 输出 `v6-task-outcome@1` 报告；报告只包含策略 id、成功率、平均分、样本量、建议和隐私标记，不保存 prompt 正文、用户输入正文或页面正文。
- `buildPromptStrategyPlan` 现在会读取 task outcome policy：当同场景下某个 prompt structure 有足够且高成功率的用户验证 outcome 时，策略会选择 `prefer_task_outcome_winner`；低成功率策略会进入风险建议。
- local-service `/generate` 会把 `taskOutcomeReport` / `taskOutcomeText` 注入 template 与真实 LLM 上下文，生成卡片和 prompt history 也会保留 outcome 状态/决策/推荐/计数等安全元数据。
- 浏览器扩展反馈事件现在可回传 outcome 字段；`/metrics/task-outcomes` 与 `/diagnostics/export` 可导出聚合报告，用于内测分析。
- 最新 V6 证据入口仍是 `research/v6-prompt-quality.latest.json`；`taskOutcomeProbe` 已通过，显示 9 个 outcome 样本可识别 winner/risk、选择 outcome winner、注入 task outcome guidance，并保持 redaction/aggregate-only。
- active Codex goal 仍不应标记 complete：P9 证明了真实任务结果反馈的代码闭环和合成 probe，但完整目标还需要真实内测样本证明实际 prompt 质量持续提升。

## 当前 V6 P8 场景感知提示词学习上下文 2026-06-08

- V6 P8 已把“根据场景、工具和历史反馈”里的“场景”落到隐私安全 token：`inferTaskScenario(input, context)` 会输出 `security-review`、`test-plan`、`code-review`、`ui-ux`、`release-ops`、`data-analysis`、`prompt-engineering`、`product-idea` 或 `general`，不保存用户输入正文。
- local-service `/generate` 现在会在生成链路开始时推断 `taskScenario`，并把它传给 feedback profile、strategy insights、prompt strategy plan、experiment assignment、experiment outcome、template fallback、真实 LLM message、card 和 prompt history。
- metrics 现在新增 `byScenario`、`byScenarioStrategy`、`byScenarioExperimentArm` 聚合；有场景上下文时，策略洞察和实验 outcome 会优先读取同场景 cohort，避免不同任务类型互相污染。
- 浏览器扩展反馈事件现在会回传 `taskScenario`，因此 card_ready/insert/save/retry/undo 都能进入同场景策略闭环；该字段只是短 token，不含 prompt、输入正文或页面正文。
- 最新 V6 证据入口仍为 `research/v6-prompt-quality.latest.json`，其中 `scenarioLearningProbe` 已证明 security-review 场景可推断、可聚合、可影响策略选择和实验 comparisonKey，且元数据报告不泄露输入正文。
- active Codex goal 仍不应标记 complete：P8 证明了场景感知学习链路，但完整目标还需要真实内测样本和真实任务 outcome 证明提示词质量实际提升。

## 当前 V6 P7 outcome 反哺上下文 2026-06-08

- V6 P7 已把实验 outcome 从“诊断报告”推进到“生成策略调权”：`buildPromptStrategyPlan` 现在接受 `experimentOutcomeReport`，生成 `outcomePolicy`，并把策略政策版本提升为 `v6-strategy-policy@3`。
- 决策优先级：插入风险和高 retry guardrail 仍然最高；只有在 baseline 与 strategy_guided 达到可比样本后，outcome 才会推动 `prefer_strategy_guided` 或 `prefer_baseline_until_reviewed`。
- local-service `/generate` 现在会先构建 `experimentOutcomeReport/Text`，再传给 prompt strategy、template fallback 和真实 LLM message；生成 card 和 prompt history 会保留隐私安全的 outcome 状态/决策/推荐 key，不保存 prompt 正文、输入正文或页面正文。
- shared core 的 template 与 LLM message 已加入 `Local experiment outcomes`，因此真实生成会看到 aggregate outcome 指导，而不是只把 outcome 留在诊断 API。
- 最新证据入口仍为 `research/v6-prompt-quality.latest.json`；新增 `outcomeFeedbackProbe` 证明 strategy-guided 胜出时会加强策略组，strategy-guided 变差时会回退 baseline，且只记录 hash/长度/聚合指标。
- OMX 阶段 mission `smart-prompt-v6-p7-outcome-feedback-policy` 已记录 pass verdict；active Codex goal 仍不能标记 complete，因为完整目标还缺真实内测长期样本和真实任务 outcome 验证。

## 当前 V6 实验闭环上下文 2026-06-08

- V6 P6 已把提示词优化从“策略洞察”推进到“可对照实验闭环”：新增 `v6-prompt-experiment@1`，每次生成可获得隐私安全的 `experimentAssignment`，包含 arm、bucket、comparisonKey、selected/assigned strategy 与 readiness。
- local-service `/generate` 现在会先做实验分组；`baseline_structure` arm 会留出本地策略洞察，只使用默认结构，`strategy_guided`、`explore_candidate` 和 `insert_safety_guardrail` arm 会按对应策略生成，因此后续 outcome 不只是空标签。
- metrics 现在新增 `byExperimentArm` 聚合，覆盖 events、cardReady、insertAttempts、verifiedInserts、save/retry/undo、avgQualityScore、promptStrategyIds、experimentVersions、comparisonKeys 和 readiness。
- 新增 `GET /metrics/experiment-outcomes`，`/diagnostics/export` 也会包含 `experimentOutcomeReport` 与 `experimentOutcomeText`；报告只使用聚合指标和 token 化字段，不保存 prompt 正文、输入正文或页面正文。
- 浏览器扩展反馈事件会携带 promptStrategyId/version、experimentVersion/arm/bucket/comparisonKey、strategyInsightsVersion/readiness；服务离线或本地模板路径也有 `client-template` baseline 兜底元数据。
- 最新证据入口仍是 `research/v6-prompt-quality.latest.json` 和 `scripts/critic-v6-prompt-quality.ps1`；报告新增 `experimentOutcomeProbe`，OMX 阶段 mission `smart-prompt-v6-p6-experiment-outcome-loop` 已记录 pass。
- active goal 仍不能标记 complete：P6 证明了实验链路和聚合能力，但还没有真实长期内测样本、真实站点 A/B 统计显著性或按用户任务类型持续调权结果。

## 当前 V6 策略洞察上下文 2026-06-08

- V6 P5 已把 `byStrategy` 从“只用于选策略”升级为“可解释的策略洞察”：`buildStrategyInsights` 会按 mode/tool/adapter/site cohort 输出 readiness、topStrategies、riskSignals、lowSampleCandidates、recommendations 和隐私标记。
- 策略洞察版本为 `v6-strategy-insights@1`，策略政策仍为 `v6-strategy-policy@2`；低样本策略只建议 explore，不会被当成可靠胜出策略。
- local-service 新增 `GET /metrics/strategy-insights`，`/diagnostics/export` 包含 `strategyInsights` 和 `strategyInsightsText`；`/generate` 会把洞察传给 template/LLM，并在卡片上返回。
- `smart-prompt-core` 的 template fallback 和 LLM messages 已接入 `Local strategy insights`，但这些文本只来自聚合指标，不包含用户输入、prompt 正文或页面正文。
- 最新 V6 证据入口仍是 `research/v6-prompt-quality.latest.json` 和 `scripts/critic-v6-prompt-quality.ps1`；报告现在包含 `strategyInsightsProbe`。
- 后续要继续优化提示词能力，应转向真实内测闭环：持续收集 byStrategy 真实样本、按策略版本比较 Insert/Save/Retry/Undo、再做轻量 A/B 或策略版本对照。
## 当前 V6 提示词质量上下文 2026-06-08

- 当前 active goal 已切到 V6：把 Smart Prompt 从“能帮用户填 prompt”升级成“能根据场景、工具和历史反馈，生成可验证的高质量 prompt”。
- V6 已新增结构化 LLM 输出协议：真实 LLM 现在被要求返回 JSON，包含 `finalPrompt`、`whyThisWorks`、`suggestedSkills`、`missingInfo`、`privacyNotes`；本地 gateway 会解析结构化结果，无法解析时保留 raw text fallback。
- V6 已新增质量评分模块 `packages/shared/prompt-quality.js`，覆盖三模式 prompt 的目标、上下文、任务、约束、输出格式、验收标准、缺失信息和隐私边界等维度；生成结果会带 `quality` 和 `feedbackSummary`。
- local-service `/generate` 已接入历史 feedback 摘要，会把本地 metrics 转成隐私安全的反馈摘要传给 LLM/template，并把 `qualityScore` 记录到 prompt history。
- V6 P1 已新增 `feedbackProfile`：根据本地聚合 metrics 的 retry/undo/save/adapter failure/failureReason 推导 `confidence`、rates 和可执行 directives，例如 `reduce_retry`、`reduce_undo`、`adapter_insert_risk`、`after_write_mismatch`。profile 只来自计数、比例、失败类型和长度，不保存 prompt 正文或输入正文。
- shared core 的 template fallback 与真实 LLM message 现在都会接收 `feedbackProfileText`；生成时会显式应用反馈画像，但不把 raw telemetry 暴露给下游 prompt。
- V6 评测入口为 `scripts/check-v6-prompt-quality.js` 和 `scripts/critic-v6-prompt-quality.ps1`；评测集为 `research/v6-prompt-quality-fixtures.json`，最新报告为 `research/v6-prompt-quality.latest.json`，只保存长度/hash/分数，不保存输入或 prompt 正文。
- 最新 V6 报告包含 `feedbackProfileProbe`，要求 profile 能生成自适应 directives、prompt 内包含反馈指导且 profile 文本不泄露 fixture 正文。
- 浏览器扩展已修复手动模式选择问题：`context.mode` 现在会驱动 `prompt-engine` 和卡片渲染，runtime demo 测试改用独立随机端口 local-service，避免误连真实桌面服务或真实 LLM 造成不稳定。
- 当前 V6 critic 已 PASS：30 条 fixture 全部通过，平均分 0.963，structured JSON probe 通过，feedbackProfileProbe 通过，local-service 与 browser-extension 测试通过。


## 当前 M3 收口上下文 2026-06-08

- M3 active goal 的两条验收线都有当前机器证据：`research/m3-pilot-adapters.latest.json` 记录 beta adapter 真实内测数据；`research/m3-real-desktop-tools-fill-matrix.latest.json` 记录 Codex、Claude Code、Hermes 真实桌面工具填入矩阵。
- 用户已澄清：workBuddy、Trae 是本地工具，不作为网页 adapter 跑；DeepSeek 本轮不跑；网页 pilot 只验证已登录的豆包 `https://www.doubao.com/chat/`。
- beta adapter pilot 最新结果为豆包登录态网页 1 次 Insert attempt、1 次成功，Insert success rate 1.0。证据来自用户已登录的现有 Chrome tab，验证可见 composer、真实填入回读和 no-auto-send；测试文本已在取证后清空。报告明确标记普通 Chrome tab 未加载 Smart Prompt 内容脚本，因此这是登录态 composer/adapter 写入验证，不伪装成 CDP 正式扩展加载。
- `scripts/check-m3-pilot-adapters.ps1` 默认 SiteIds 已收窄为 `doubao`；pilot 报告已新增 `region_or_security_gate_no_visible_composer` 分类，避免把地区或安全拦截误判为普通 selector 失败。
- M3 桌面工具端仍以真实桌面窗口矩阵为准：Codex、Claude Code、Hermes 均 `writeAttempted:true`、`writeVerified:true`、`noAutoSubmit:true`。不要再用 `research/m3-real-desktop-tools.latest.json` 的 snapshot-only 字段推翻矩阵结论，因为 critic 会刷新该 snapshot 报告。

## 当前 M3 真实桌面工具输入上下文 2026-06-08

- 用户明确要求真实桌面工具端验收，不接受新开 Windows Terminal/PowerShell 命令行窗口作为 Codex/Claude Code/Hermes 的替代证据。
- `scripts/check-m3-real-desktop-tools.ps1` 支持 `-AttachExistingWindow -AttachProfile <profile>`，只 attach 已打开的真实桌面窗口；真实写入必须显式 `-AllowForegroundWrite`，并匹配 title hash 与 tool profile。
- `research/m3-real-desktop-tools-fill-matrix.latest.json` 是三工具真实桌面填入矩阵证据：Codex、Claude Code、Hermes 均已在真实桌面窗口完成写入和回读验证，且不自动发送。报告只保存长度/hash/布尔状态/策略，不保存标题原文、输入原文或 prompt 正文。
- 当前 M3 桌面工具部分可认为已取得实机写入证据；beta adapter pilot 已取得真实成功率和失败原因证据，剩余站点属于后续 adapter 继续优化项。

## 当前 M3 caret/focus 输入信号上下文 2026-06-08

- M3 输入识别已新增跟输入强关联的候选信号：Win32 caret 可见性、caret 是否落在候选区域、UIA focused element 匹配、键盘焦点、窗口底部接近度、超大 `ControlType.Document` 标记，以及 `inputSignals`/`bestCandidateIndex`/`bestCandidateScore`。
- 临时 TextBox self-test 证明这些信号有效：即使 UIA 把控件暴露成 `ControlType.Pane` 而不是 `Edit`，caret/focus 命中仍能把它排成最佳候选。
- 真实 Codex 前台 snapshot 证明限制也存在：Win32 caret API 可调用但 `caretVisible:false`、`caretWindowPresent:false`，UIA 焦点落在整窗 `ControlType.Document`；因此 cursor/focus 只能作为强信号，不能单独授权真实写入。
- 后续真实 Codex/Claude Code/Hermes 写回仍需受 `confirmForeground`、title hash、tool profile 和显式 fallback 控制；不要把 focused/best candidate 视为完成真实填入验收。

## 当前 M3 fallback 上下文 2026-06-08

- M3 Windows 桌面写回现在同时有直接写回 self-test 和显式剪贴板 fallback self-test。剪贴板 fallback 用于 UIA 无法暴露标准输入控件的桌面/CLI 工具，但必须由调用方显式传 `allowClipboardFallback:true`。
- 真实前台写入仍受四重门控：`confirmForeground:true`、`expectedTitleHash`、`expectedToolProfile`、`allowClipboardFallback:true`。这些字段不满足时不得写入，不得自动发送。
- 关键新增证据入口：`research/m3-desktop-fill-clipboard.latest.json`；完整 critic 入口仍是 `scripts/critic-m3.ps1`，本轮已 PASS 并记录 OMX pass verdict。
- 后续新增证据入口：`research/m3-real-desktop-clipboard-guard.latest.json` 验证真实前台 clipboard fallback 仍受 title hash guard 保护；`research/m3-desktop-fill-direct-guard.latest.json` 验证真实 Codex 全窗口 `Document` 候选不会被直接写入。
- 真实 Codex/Claude Code/Hermes 工具窗口写回仍是 M3 未完成项；当前 fallback 只证明受控降级链路，不代表真实工具窗口已经填入成功。

## 当前 M3 上下文 2026-06-07

- 当前 active goal 仍是 M3：一方面收集新 beta adapter 的真实内测 Insert 数据，另一方面推进 Windows UIA 桌面输入框识别，覆盖 Codex、Claude Code、Hermes 等桌面/CLI 工具；macOS AX 不作为当前阶段验收门槛。
- Windows 路径已从“只识别快照”推进到“self-test 写回”和真实前台窗口 snapshot-only 审计：`GET /desktop/input-snapshot` 与 `POST /desktop/fill` 在 local-service、native sidecar、安装包 bundled sidecar 中都有机器证据；真实 Codex 前台窗口已能被 UIA 识别并枚举候选。
- 关键证据入口：`research/m3-desktop-input.latest.json`、`research/m3-real-desktop-tools.latest.json`、`research/m3-desktop-fill.latest.json`、`research/m3-sidecar-desktop-input.latest.json`、`research/m3-sidecar-desktop-fill.latest.json`、`research/m3-installed-sidecar-desktop-input.latest.json`、`research/m3-pilot-adapters.latest.json`。
- `docs/prd.md` 当前是 v0.2 beta PRD：V5 发布包和 release-ready manifest 已完成；M3 为进行中。PRD 不能写成“真实桌面工具已完成”，因为 Codex/Claude Code/Hermes 真实窗口写回尚未验收；macOS AX 已移出当前 M3 门槛。
- 当前写回 self-test 主要证明链路、auth、打包、隐私脱敏和 no-auto-submit；它不等同于在真实工具窗口里填入成功。

## M3 Pilot 与桌面输入识别上下文 2026-06-07

- 当前 active goal 是 M3：一方面跑真实内测数据观察 workBuddy、Trae、Doubao、DeepSeek 新 adapter 的 Insert 成功率和失败原因；另一方面进入 Windows UIA 桌面输入框识别，覆盖 Codex、Claude Code、Hermes；macOS AX 先不做。
- 已创建 OMX mission：`smart-prompt-m3-pilot-metrics-and-desktop-input-`；critic 命令为 `scripts\critic-m3.ps1`。
- M3 pilot 证据入口：`research/m3-pilot-adapters.latest.json`。当前四个 beta 站点均有真实 headless Chrome 探针数据，正式扩展加载成功，但 Insert 成功率为 0；已新增每站 5 个候选入口的 route matrix，失败原因细化为 `no_input_candidates_on_loaded_page: 2`、`public_or_marketing_page_no_visible_composer: 1` 与 `login_or_auth_gate_no_visible_composer: 1`，并带 `pageClassification`/`routeDiagnostics`/`routeMatrix`。
- M3 Windows UIA 证据入口：`research/m3-desktop-input.latest.json` 与 `research/m3-real-desktop-tools.latest.json`。当前 self-test 通过，Windows UIA 能枚举临时 TextBox 候选，并匹配 Codex 工具画像；真实前台 Codex snapshot-only 审计也已通过，候选数 116，默认 `writeAttempted:false`；报告不保存 raw title、raw element name 或 input value。
- 新增 local-service 开发接口与 native sidecar source/dev 接口：`GET /desktop/input-snapshot`，受 auth 保护；native sidecar 通过 Windows PowerShell UIA bridge 返回同一契约。
- M3 native sidecar 证据入口：`research/m3-sidecar-desktop-input.latest.json`。当前 sidecar smoke 通过，证明 native sidecar health/auth 后可调用 `desktop/input-snapshot?selfTest=1` 并返回 1 个 UIA 输入候选。
- M3 安装包 sidecar 证据入口：`research/m3-installed-sidecar-desktop-input.latest.json`。当前安装包 smoke 通过，证明桌面壳安装包会打入 `resources/smart-prompt-sidecar/bin/local-service-sidecar.exe` 与 `resources/smart-prompt-sidecar/scripts/check-m3-desktop-input.ps1`，安装后的 app 能启动 bundled sidecar 并调用 `desktop/input-snapshot?selfTest=1`。
- macOS AX 已按用户要求暂缓到后续跨平台阶段；不要把它作为当前 M3 goal 的完成条件。

## V5 Beta 发布上下文 2026-06-07

- V5 当前已进入 beta 发布闭环：本地 native sidecar、诊断导出、删除全部本地数据、key 迁移状态、崩溃重启/端口恢复、release notes、checksum、pilot-loop 证据均已落地。
- `v0.2.0-beta.1` 已作为 Git tag 推送到 GitHub private repo，且 GitHub Release 页面已创建并上传 MSI、NSIS exe、checksum assets。
- 当前 beta release 证据入口是 `research/v5-beta-manifest.latest.json`，该 manifest 为 `pass:true`、`releaseReady:true`。
- `docs/prd.md` 已更新为 v0.2 beta PRD，并明确纳入 workBuddy、Trae、Doubao、DeepSeek、Hermes；这是当前 V5 PRD 收尾目标的一部分，可以随本轮提交。
- 浏览器扩展和 shared core 已新增 workBuddy、Trae、Doubao、DeepSeek beta adapter；Codex、Claude Code、Hermes 当前只作为工具画像，真实桌面输入框识别仍属于 M3。
- 当前 metrics 闭环已覆盖 `card_ready`、`insert`、`save`、`retry`、`undo`，并在 local-service/native sidecar 汇总 Insert 成功率、保存率、Undo/Retry 使用率和失败原因。

## V4 可安装内测版完成上下文 2026-06-07

- V4 当前 release manifest 已为 `pass:true`、`releaseReady:true`；证据入口是 `research/v4-release-manifest.latest.json`，所有验收门 `INSTALLER_PASS`、`SIDECAR_SERVICE_PASS`、`FIRST_RUN_PASS`、`KEYCHAIN_PASS`、`LIVE_SITE_STABILITY_PASS`、`PROMPT_CARD_UX_PASS`、`LOCAL_DATA_PASS`、`V4_RELEASE_MANIFEST_PASS` 均为 PASS。
- 安装包链路已收紧：`apps/desktop-shell/scripts/prepare-sidecar.js` 会把 local-service、`packages/shared` 和当前 Node runtime 打进 `src-tauri/resources/smart-prompt-sidecar/`；Tauri 配置通过 `bundle.resources` 打包该目录。
- Tauri `start_local_service` 现在优先从包内 `resources/smart-prompt-sidecar` 启动 `apps/local-service/src/server.js`，优先使用包内 `bin/node.exe`，并把 `SMART_PROMPT_DATA_DIR` 固定到 app local data dir 或显式环境变量。
- 安装后 smoke 已从“能打开窗口”升级为 runtime 验收：`scripts/check-v4-installer-smoke.ps1` 调用 `scripts/check-v4-installed-app-runtime.js`，证明安装后的 app 能用包内 sidecar 启动/停止 local-service，并通过 `/health`。

## V4 首启向导更新 2026-06-07

- `FIRST_RUN_PASS` 已从 PARTIAL 提升为 PASS：local-service 新增受保护的 `POST /llm/test`，桌面壳新增 `first-run-panel`、provider test、首启进度与隐私边界展示，交互测试覆盖保存 key、测试 provider、导入 skill 与 ready 状态。
- 当前 V4 manifest 仍非 release-ready：`SIDECAR_SERVICE_PASS`、`FIRST_RUN_PASS`、`KEYCHAIN_PASS`、`PROMPT_CARD_UX_PASS`、`LOCAL_DATA_PASS` 为 PASS；`INSTALLER_PASS` 为 FAIL；`LIVE_SITE_STABILITY_PASS`、`V4_RELEASE_MANIFEST_PASS` 为 PARTIAL。
- 最新 OMX verdict 仍为阶段性 `fail`，证据为 `research/v4-release-manifest.latest.json`；这是因为 V4 还有安装包和 8 站连续稳定性未完成，不是当前首启或 Prompt Card 改动失败。

## V4 Prompt Card UX 更新 2026-06-07

- `PROMPT_CARD_UX_PASS` 已从 PARTIAL 提升为 PASS：浏览器扩展 Prompt Card 现在支持手动 `idea/continue/polish` 模式选择、生成状态、Retry、LLM/template source badge、Insert 成功/失败状态、Undo toast 和反馈记录。
- `prototypes/browser-extension/tests/runtime-demo.test.js` 已用真实 headless Chrome 覆盖模式切换、Retry、Insert、不自动发送、Undo 恢复原输入、Save 在线/离线路径；`scripts/critic-v4.ps1` 现在会跑 local-service、desktop-shell 和 browser-extension 三套测试后再写 V4 manifest。
- 当前 V4 manifest 仍非 release-ready：`SIDECAR_SERVICE_PASS`、`FIRST_RUN_PASS`、`KEYCHAIN_PASS`、`PROMPT_CARD_UX_PASS`、`LOCAL_DATA_PASS` 为 PASS；`INSTALLER_PASS` 为 FAIL；`LIVE_SITE_STABILITY_PASS`、`V4_RELEASE_MANIFEST_PASS` 为 PARTIAL。

## V4 可安装内测版上下文 2026-06-07

- V4 目标：把 V3 验收通过原型变成可安装、可配置、稳定运行、可诊断的 Beta 包；验收门包括 INSTALLER、SIDECAR_SERVICE、FIRST_RUN、KEYCHAIN、LIVE_SITE_STABILITY、PROMPT_CARD_UX、LOCAL_DATA、V4_RELEASE_MANIFEST。
- 已创建 OMX autoresearch-goal mission：`smart-prompt-v4-installable-beta-turn-v3-validat`；critic 命令为 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v4.ps1`。
- V4 当前证据入口：`scripts/check-v4-sidecar-service.ps1` 生成 `research/v4-sidecar-service.latest.json`；`scripts/write-v4-release-manifest.js` 生成 `research/v4-release-manifest.latest.json`；`scripts/critic-v4.ps1` 汇总 professor-critic 状态。
- 当前 V4 manifest 不是 release-ready：`SIDECAR_SERVICE_PASS`、`FIRST_RUN_PASS`、`KEYCHAIN_PASS`、`PROMPT_CARD_UX_PASS`、`LOCAL_DATA_PASS` 已 PASS；`INSTALLER_PASS` 为 FAIL；`LIVE_SITE_STABILITY_PASS`、`V4_RELEASE_MANIFEST_PASS` 为 PARTIAL。

## V3 release-ready 上下文 2026-06-07

- V3 正式 live-site 证据已经通过：`research/v3-live-site-formal.latest.json` 为 `pass: true`，8/8 display 覆盖 ChatGPT、Claude、Gemini、Perplexity、Bolt、v0、Lovable、Replit；ChatGPT/Claude/Gemini 的 Insert 与 no-auto-send 均通过。
- Replit formal 入口改为 `https://replit.com/agent4`，因为 `/ai` 无可见 AI composer，根页虽可见 textarea 但更像营销入口；`/agent4` 单站预检和完整 8 站 formal 均证明正式扩展加载、`injectedProbe:false`、可见 textarea focus 成功、小人可见。
- 完整 8 站 formal 需要复用 `.runtime/v2-live-chrome-profile` 持久 profile 才能保留 Claude 登录态；fresh profile 会导致 Claude display/insert/no-auto-send 缺失。
- `research/v3-release-manifest.latest.json` 当前 `pass: true` 且 `releaseReady: true`；`scripts/critic-v3-security.ps1` 已通过。

## V3 live-site formal 上下文 2026-06-07

- V3 live-site formal 已拆成独立证据入口：`scripts/check-v3-live-sites.ps1` 强制 `SMART_PROMPT_LIVE_INJECT_FALLBACK=0` 和 `SMART_PROMPT_LIVE_SCHEMA_VERSION=v3-live-site-formal@1`，默认覆盖 ChatGPT、Claude、Gemini、Perplexity、Lovable、Bolt、v0、Replit。
- `research/v3-live-site-formal.latest.json` 是 V3 正式站点验收报告；只保存 redacted URL/path/title/text/profile 摘要、长度、布尔状态和 hash，不保存完整 URL、页面标题、prompt 正文、输入框正文或 profile 路径。
- `scripts/assert-v3-live-formal-evidence.js` 是严格验收断言：8 站 display、3 站 insert、3 站 no-auto-send、正式扩展加载、`injectedProbe:false`、redaction leak 为 0 才 PASS。
- `scripts/write-v3-release-manifest.js` 现在只会在 V3 formal evidence 满足严格断言等价条件时把 `LIVE_SITE_FORMAL_PASS` 置为 PASS；legacy V2 evidence 只能作为 partial/历史参考。
- live-site Insert 证据通过内容脚本写入 `documentElement.dataset.smartPromptInsert*` 暴露给页面主世界，只保存 `ok/verified/kind/strategy/reason/valueLength/createdAt`，不保存正文；这是为了解决 Chrome isolated world 下 CDP 读不到 `__smartPromptDebug` 的问题。
- 最新正式 V3 formal 报告已证明 8 站 display，以及 ChatGPT、Claude、Gemini 的 Insert + no-auto-send；Replit 通过 `/agent4` 验收。

## 当前 V3 上下文

- 当前阶段：V3 高频 AI 输入工作流 Beta。
- 核心链路：聚焦输入框 -> 小人出现 -> 判断 idea/continue/polish -> 调真实 LLM -> 推荐 skill -> 展示依据和隐私摘要 -> Insert 填入但不发送 -> 记录反馈和采用情况。
- 技术栈：Chrome/Edge MV3、Node 本地服务、共享 JS core、LLM gateway、Tauri desktop shell scaffold；V3 已新增本地鉴权、证据脱敏、credential vault、Tauri CSP/capability、skill routing fixture 和 release manifest。
- 当前验收汇总以 `research/v3-release-manifest.latest.json` 为准；它会汇总 evidence hash、commit、acceptance 状态和风险。
- 当前 8 站 Beta 矩阵：ChatGPT、Claude、Gemini、Perplexity、Lovable、Bolt、v0、Replit。Doubao/DeepSeek 不在 V3 Beta allowlist。

## 项目目标

- 当前项目要解决的问题：为 Windows 和 macOS 通用的“提示词自动化生成小工具”做深度调研、竞品/开源实现分析、可行性方案、PRD 和 UI/UX 概念图。
- 主要用户或使用场景：vibe coding 工具用户、网页 LLM/Agent 对话用户；用户可能不会写提示词、缺少提示习惯、缺少可复用 skills 或经常忘记调用已有 skills。
- 不应偏离的边界：当前进入 V2；要实现真实 LLM、本地服务、浏览器强化和 Tauri 桌面壳，但仍不自动发送消息、不默认上传整页内容。

## 系统概览

- 技术栈：V1 为 Chrome/Edge MV3；V2 新增 Node 本地服务、共享 JS core、OpenAI-compatible LLM gateway 和 Tauri desktop shell scaffold。
- 关键入口：扩展 `prototypes/browser-extension/manifest.json`；本地服务 `apps/local-service/src/server.js`；桌面壳 `apps/desktop-shell/index.html` 与 `apps/desktop-shell/src-tauri/src/main.rs`。
- 关键模块：环境识别、站点适配器、三种提示词模式、悬浮小人入口、本地服务 LLM 生成、prompt/skill 库、刷新/编辑/复制/收藏/填入、Tauri 托盘和全局快捷键。
- 外部依赖或服务：可能包括 OpenAI 图像生成 API、LLM API、Remotion 或类似动画渲染方案、浏览器/桌面自动化能力。

## 重要约定

- 代码风格：暂无代码；后续遵循所选框架约定。
- 数据或接口约定：待 PRD 明确。
- UI/交互约定：悬浮在输入框附近的小人形象是核心入口；用户已指定 `assets/ui-ux/mascot-token-run.png` 为小人原型，后续不得重新设计角色；需要适配 vibe coding 工具与常见网页 LLM 输入框。
- 测试与验证约定：研究结论必须带来源；产品方案需能映射到用户痛点和竞品差异。

## 决策记录

- 尚在生效的关键决策：使用 `oh-my-codex:autoresearch-goal` 工作流推进；V2 mission slug 为 `smart-prompt-v2`。
- 已确认的用户偏好：默认中文沟通；信息按需提供；最小改动；先读再改；非简单任务维护 `agent_memory/`。
- 需要避免重复讨论的结论：仓库已在 `codex/prompt-automation-research` 分支提交研究/PRD/视觉资产；当前新增 `prototypes/browser-extension/` 作为第一版应用原型。

## 待澄清

- 小人原型图片已提供并复制到项目：`assets/ui-ux/mascot-token-run.png`。
- “skillhub/clawhub” 的具体站点范围可能存在歧义，需要通过网络搜索确认可检索来源。
# 当前 UI/i18n 上下文 2026-06-08

- 当前 Chrome 豆包 tab 曾出现 `smartPromptLoaded:false`、`mascotPresent:false`，但页面有可见 `textarea.semi-input-textarea`，placeholder 为“发消息或按住空格说话...”。判断豆包“小人不出现”时先区分：扩展内容脚本是否加载；如果未加载，需要重新加载 unpacked extension 并刷新页面，不要直接归因到 selector。
- Prompt Card 离线状态必须覆盖渲染，不能继续在 `.spc-context` 上追加 `service offline`；失败分支需要校验最新 `generationRequestId`，避免输入/删除产生的旧请求失败污染当前卡片。
- content script 必须忽略 Smart Prompt 自己 UI 内的 focus/input，否则编辑 `.spc-output` 会把扩展自己的 textarea 当成目标输入框。
- 浏览器扩展 Prompt Card 已改为紧凑版：目标宽度 300-380px，最大高度约 430px；不要再回退到 V4/V5 验收时的大卡片布局。
- Prompt Card UI 支持 `zh-CN` 与 `en`；语言优先级为扩展设置 `smartPromptSettings.uiLocale`，`auto` 时跟随 `chrome.i18n.getUILanguage()`、页面 lang 或 `navigator.language`。
- 选项页已提供 `自动 / 中文 / English` 语言选择；content script 会使用该设置渲染标题、按钮、状态、证据标签和 Undo toast。
- 浏览器本地模板与 shared core 都支持 `context.locale`；中文默认保持原模板，英文 locale 生成英文 prompt 模板。
# 当前桌面端窗口上下文 2026-06-08

- Smart Prompt 桌面端双窗口根因是 Windows release 程序未声明 GUI subsystem，系统会把它当 console app 启动并弹出 Terminal/黑窗。
- `apps/desktop-shell/src-tauri/src/main.rs` 现在使用 `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` 隐藏 release 控制台窗口；debug/dev 仍保留调试行为。
- 本地服务 sidecar 由 Tauri 启动时在 Windows 下使用 `CREATE_NO_WINDOW`，避免 Start Service 后出现额外控制台。
- 新构建产物位于 `apps/desktop-shell/src-tauri/target/release/smart-prompt-desktop.exe`，安装包位于 `apps/desktop-shell/src-tauri/target/release/bundle/`。
# 当前 V6 提示词质量闭环上下文 2026-06-08

- V6 现在已经从“结构化生成 + 规则评分 + 反馈画像”推进到“生成-反馈实验链路”：每张生成卡片会带 `generationId`、`strategyId` 和 `qualityExperiment`，后续 `Insert/Save/Retry/Undo` 能回流到同一策略。
- `qualityExperiment` 是隐私安全元数据：包含 schemaVersion、generationId、strategyId、mode、generatedBy、qualityScore、feedbackConfidence、directiveKeys、promptLength 和 privacy 标记；不保存 prompt 正文、输入正文或页面正文。
- local-service metrics 新增 `byStrategy` 聚合，可用于观察某个策略的插入成功率、保存率、重试率、撤销率、平均质量分和平均长度。后续优化提示词时应优先看 `byStrategy`，而不是只看全局 insertSuccessRate。
- 浏览器扩展反馈事件已经带 generation meta；本地模板离线生成没有服务端评分时会用 0.72 作为保守基线分，只用于聚合，不要把它解释为真实质量提升证据。
- 最新 V6 证据入口为 `research/v6-prompt-quality.latest.json`，其中 `qualityExperimentProbe` 已通过；完整 critic 入口为 `scripts/critic-v6-prompt-quality.ps1`。
- 当前 V6 后续重点：真实内测采集 byStrategy 指标、按工具/站点/模式拆分策略表现、引入轻量 A/B 或策略版本对比、把高 retry/undo/失败原因回灌到 prompt 结构权重。
# 当前 V6 提示词优化上下文 2026-06-08

- V6 现在已经具备四层闭环：结构化 LLM 输出、规则质量评分、反馈画像、基于 `byStrategy` 的提示词策略规划。
- 最新新增的策略规划会从本地聚合指标中选择生成方向，并以 `Local strategy plan` 的形式进入 template 与真实 LLM 消息；`qualityExperiment.promptStrategyId` 用来把后续 Insert/Save/Retry/Undo 回流到同一策略。
- 当前可验证入口：`research/v6-prompt-quality.latest.json`、`scripts/check-v6-prompt-quality.js`、`scripts/critic-v6-prompt-quality.ps1`；OMX P3 verdict 为 `smart-prompt-v6-p3-prompt-strategy-planning -> pass`。
- 下一步优化提示词能力时，优先做真实内测策略对照：按工具、站点、模式、任务场景拆分 `byStrategy`，观察采纳率、保存率、重试率、撤销率和失败原因，再决定策略权重。
# 当前 V6 提示词优化上下文 2026-06-08

- V6 P4 已把策略学习从“选一个看起来最好的策略”推进到“有策略版本、可靠样本阈值、低样本探索保护和 cohort 匹配”的阶段。
- 当前策略政策版本为 `v6-strategy-policy@2`；`qualityExperiment.promptStrategyVersion` 在报告中会被安全 token 化为 `v6-strategy-policy-2`。
- 最新 V6 报告新增 `strategyExplorationProbe`：它证明低样本高分策略会触发 exploration 和 `collect_more_samples`，但不会直接成为 `preserve_winning_strategy`。
- 当前可验证入口：`research/v6-prompt-quality.latest.json`、`scripts/check-v6-prompt-quality.js`、`scripts/critic-v6-prompt-quality.ps1`；OMX P4 verdict 为 `smart-prompt-v6-p4-strategy-exploration-guard -> pass`。
- 后续优化提示词能力时，优先做真实内测 byStrategy 面板或导出分析：按 mode/tool/adapter/site 查看策略版本的采纳率、保存率、重试率、撤销率和失败原因。
# 当前 V6 P14 策略调权上下文 2026-06-08

- V6 P14 已把 pilot/task outcome 从“报表和面板”推进到“生成策略权重”：新增 `v6-strategy-weighting@1`，根据隐私安全的聚合 outcome 把 ready 高成功策略标为 promoted、ready 低成功策略标为 suppressed、collecting 策略只用于 exploration。
- `buildPromptStrategyPlan` 现在接收 `strategyWeightPolicy`，并把 `strategyWeightVersion`、promoted/suppressed/exploring 计数、`promote_outcome_winner`、`suppress_outcome_risk`、`continue_outcome_exploration` directive 纳入策略计划。无显式 guardrail/实验回退时，promoted strategy 可以驱动 `outcome_weight` 决策。
- local-service `/generate` 会构建 `strategyWeightPolicy` 并注入 template fallback、真实 LLM context、返回 card 和 prompt history；`/metrics/strategy-weights` 与 `/diagnostics/export` 也会输出 aggregate-only 权重摘要。
- shared core 的本地模板和 LLM messages 现在都有 `Local strategy weights`，但只包含策略 id、样本量、成功率、权重和隐私标记，不包含 prompt 正文、用户输入、页面正文或完整 URL。
- 最新 P14 证据入口为 `research/v6-prompt-quality.latest.json` 的 `strategyWeightProbe`：`weightVersion=v6-strategy-weighting@1`、`planDecision=outcome_weight`、promoted/suppressed/exploring 均存在、template/LLM context 均注入权重、redaction 通过。
- active Codex goal 仍保持 active：P14 证明“系统能用 outcome 改变下一次策略”，但还不能证明真实长期内测中 prompt 质量已经持续提升；完整目标仍需要真实样本的 outcomeSuccessRate、avgOutcomeScore、Retry/Undo 变化来验证。
# 当前 V6 P15 质量提升验证上下文 2026-06-08

- V6 P15 已新增 `v6-quality-lift@1`，把提示词能力从“能根据 outcome 调权”推进到“能验证 outcome 加权是否带来质量提升”。
- `buildPromptQualityLiftReport` / `formatPromptQualityLiftReport` 会比较 `baseline_structure`、`strategy_guided`、`outcome_weighted` 三组，按 mode/tool/site/taskScenario 过滤，输出 outcomeSuccessRate、avgOutcomeScore、Insert/Save/Retry/Undo 变化，并区分 `ready`、`collecting`、`regression`。
- 浏览器扩展和 local-service metrics 现在会回传 `strategyWeightVersion/status/promoted/suppressed/decision` 与 `qualityLiftCohort` 元数据；这些字段只用于聚合，不记录 prompt 正文、用户输入正文、页面正文或完整 URL。
- local-service 新增 `GET /metrics/prompt-quality-lift`，`/diagnostics/export` 与 `/generate` 会返回 `promptQualityLiftReport/Text`；shared core template 和真实 LLM messages 会包含 `Local quality lift` 聚合指导。
- 最新证据入口仍是 `research/v6-prompt-quality.latest.json`，其中 `qualityLiftProbe` 证明正向提升、退化告警、样本不足 collecting 和 redaction 均通过；完整 critic 输出 `V6_PROMPT_QUALITY_PASS`。
- active Codex goal 仍保持 active：P15 证明质量提升“可验证”，但完整产品目标还需要真实内测样本持续积累后，观察不同工具/站点/场景下的长期 lift 是否稳定。
# 当前 V6 P18 Quality Lift 分段归因上下文 2026-06-08

- V6 P18 已新增 `v6-quality-lift-segments@1`：在现有 `v6-quality-lift@1` 口径上，按 `tool`、`site`、`taskScenario`、`mode` 拆分质量提升，输出 top improving、top regressing、collecting segments。
- 分段报告只使用 aggregate metadata：host/token 化 site、模式、工具、任务场景、cohort、outcome 计数和 lift delta；不保存或展示 prompt 正文、用户输入正文、页面正文或完整 URL。
- local-service 新增 `GET /metrics/prompt-quality-lift-segments`，`/diagnostics/export` 同步包含 `promptQualityLiftSegmentsReport` 和 `promptQualityLiftSegmentsText`。
- 桌面壳新增 `Quality Segments` 面板，展示 improving/regressing/collecting 三类 segment；Outcome Follow-up 补标后会同步刷新 Pilot Outcomes、Quality Lift 和 Quality Segments。
- 最新完整 V6 critic 通过，`research/v6-prompt-quality.latest.json` 包含 `qualityLiftSegmentsProbe`，`scripts/critic-v6-prompt-quality.ps1` 输出 `V6_PROMPT_QUALITY_PASS`。
## 当前 V6 P19 Segment-aware 策略策略上下文 2026-06-08

- V6 P19 已新增 `v6-quality-lift-segment-policy@1`：系统现在不只展示 `Quality Segments`，还会把当前 `tool/site/taskScenario/mode` 对应 segment 的 improving/regressing/collecting 结果转成生成策略约束。
- `buildQualityLiftSegmentPolicy` / `formatQualityLiftSegmentPolicy` 只使用 aggregate segment metadata：dimension、key、readiness、cohort outcome counts、lift delta、decision 和 directive；不保存或输出 prompt 正文、用户输入正文、页面正文或完整 URL。
- `buildPromptStrategyPlan` 现在接收 `qualityLiftSegmentsReport`，并把 `qualityLiftSegmentPolicy` 纳入 `strategyPolicy`、`telemetry`、`directives` 和格式化文本：regressing segment 会触发 `segment_regression_guardrail` 并压回 `baseline_structure`，improving segment 保留 outcome-weight，collecting segment 开启继续采样。
- local-service `/generate` 会构建并注入 `promptQualityLiftSegmentsReport/Text` 与 `qualityLiftSegmentPolicy/Text`，真实 LLM/template/card/prompt history/diagnostics 都能看到同一份 aggregate-only 指导；baseline experiment holdout 会显示 segment policy held out，避免污染对照组。
- 最新 V6 evidence `research/v6-prompt-quality.latest.json` 包含 `qualityLiftSegmentPolicyProbe`，证明 ChatGPT/security-review 正向 segment 保留 outcome-weight、Claude/ui-ux 退化 segment 抑制 outcome-weight、Doubao/test-plan collecting segment 继续探索采样。
- OMX mission `smart-prompt-v6-p19-segment-aware-strategy-polic` 已记录 pass；active Codex goal 仍保持 active，因为完整目标还需要真实内测样本证明长期质量提升稳定。
## 当前 V6 P20 失败原因策略上下文 2026-06-08

- V6 P20 已新增 `v6-failure-reasons@1` 与 `v6-failure-reason-policy@1`：系统会把 failed/needs-work、retry/undo、insert failed 等反馈里的失败原因归一化为白名单短 token，而不是长期保存 raw reason。
- 当前失败原因 token 白名单为 `too_long`、`wrong_format`、`not_actionable`、`missing_context`、`too_vague`、`unsafe_or_privacy`、`insert_failed`、`tool_mismatch`、`low_quality`、`other`。
- `buildPromptStrategyPlan` 现在会读取 `failureReasonPolicy` 并把它转成生成 directive：`wrong_format` 会触发 `strengthen_output_format`，`missing_context` 触发 `add_missing_context_questions`，`not_actionable` 触发 `make_prompt_actionable`，`too_long` 触发 `shorten_prompt`，`insert_failed` 触发 `reduce_insert_fragility` 并可切到 `insert_safe_compact`。
- local-service `/generate` 会构建并注入 `failureReasonReport/Text` 与 `failureReasonPolicy/Text`，真实 LLM/template/card/prompt history/diagnostics 都能看到同一份 aggregate-only 指导；baseline experiment holdout 会显示 failure reason policy held out，避免污染对照组。
- 最新 V6 evidence `research/v6-prompt-quality.latest.json` 包含 `failureReasonPolicyProbe`，证明 raw reason 会归一化到 token、`wrong_format` 会强化输出格式、`insert_failed` 会触发插入安全 guardrail，且 `SECRET_PROMPT_TEXT`/`SECRET_INPUT_TEXT`/完整路径不会泄露。
## 当前 V6 P21 失败原因短标签 UI 上下文 2026-06-08

- V6 P21 已把 P20 后端 failure reason policy 产品化到浏览器扩展：Prompt Card 与 Insert 后 Undo toast 在用户选择 `needs-work` 或 `failed` 后，会展开紧凑原因短标签。
- 当前前端原因标签仅发送白名单 token：`too_long`、`wrong_format`、`not_actionable`、`missing_context`、`insert_failed`、`low_quality`；不会发送 prompt 正文、用户输入正文、页面正文或完整 URL。
- 成功 outcome 不再写入 failure reason；负向 outcome 只有在用户选择原因标签后才记录，避免“先点失败再选原因”产生重复 outcome 指标。
- UI 支持 `zh-CN/en` 文案，默认原因是 `low_quality`，用户可显式选择 `wrong_format`、`insert_failed` 等更可行动原因；这些 token 会进入 local-service metrics 并继续影响后续 `failureReasonPolicy`。
- P21 OMX mission `smart-prompt-v6-p21-feedback-reason-chips` 已记录 pass；最新完整 critic 仍输出 `V6_PROMPT_QUALITY_PASS`。

## 当前 V6 P22 自学习/自反省/自进化上下文 2026-06-08

- V6 P22 已新增 `v6-self-improvement@1` 与 `v6-evolution-candidates@1`：系统会从现有 byStrategy、task outcome、strategy weight、quality lift、quality segments、failure reason token 等聚合指标中生成反省记录和进化候选。
- 自反省报告会区分 `positive`、`regression`、`collecting` 三类信号，说明哪些策略可保留、哪些策略应压制/修复、哪些只是样本不足；它不保存 prompt 正文、用户输入正文、页面正文、完整 URL 或 raw failure reason。
- 自进化候选只输出 `promote_prompt_strategy`、`suppress_or_repair_strategy`、`strengthen_output_format`、`collect_more_samples` 等候选动作，并强制 `manual_review_required`、`mutationAllowed:false`、`requiresCritic:true`；不会自动改代码、自动改默认策略或自动发送。
- local-service 新增 `GET /learning/reflections` 与 `GET /learning/evolution-candidates`；`/diagnostics/export` 与 `/generate` 也会带上 self-improvement/evolution 报告。baseline experiment holdout 会显示学习指导被保留作对照，避免污染 A/B。
- 最新证据入口：`research/v6-prompt-quality.latest.json` 的 `selfImprovementProbe`；完整 critic `scripts/critic-v6-prompt-quality.ps1` 已输出 `V6_PROMPT_QUALITY_PASS`。
