# 问题与风险

## P25 桌面壳准备状态证据风险 2026-06-09

- 已缓解：真实 overlay 点击验证过去依赖人工 `-DesktopPromptPrepared`，不能证明桌面壳内确实有可填入内容。现在改为读取 `/desktop/prompt-state` 的脱敏状态，并要求 `prepared=true`、`activeTextLength>0`、hash 存在和 no-auto-submit 元数据。
- 已缓解：只在 Node local-service 增加证据会导致 release 桌面包缺能力；当前 Rust native sidecar 也已实现同一端点，并在 release 构建中编译通过。
- 仍需注意：`/desktop/prompt-state` 证明的是 Smart Prompt 桌面壳有准备好的内容，不证明目标 Codex/WorkBuddy/Trae composer 可写；完整完成仍必须同时满足 strict foreground、safe composer candidate、真实 overlay click 和 latest-fill verified。
- 仍需注意：不要为了让 prompt-state ready 而把 prompt 正文写入报告、agent_memory 或 research JSON；只允许长度/hash/布尔 readiness/白名单来源 token。

## P25 composer 候选误判风险 2026-06-09

- 已缓解：过去只看到 `safeCandidateCount=0` 时缺少机器可读原因，容易诱导放宽到整窗 `Document` 或按钮。现在 `p25-composer-candidate-diagnostics@1` 会列出候选拒绝原因，帮助判断是按钮、静态文本、整窗 Document、几何越界、离屏还是缺安全写入信号。
- 当前证据：Codex 当前候选主要为 `button_or_hyperlink` 与 `static_text`，且 snapshot 是 cursor fallback，不是 strict foreground；因此仍不能作为真实 composer 写入目标。
- 仍需注意：该诊断只解释候选，不证明小人可显示或填入完成；完成仍需要目标 strict foreground、safe composer candidate、overlay 自动显示和点击后 latest-fill verified。

## P25 latest-fill 与 no-activate 验证风险 2026-06-09

- 已解决：真实 overlay 点击以前缺少机器可读的点击后填入证据，只能依赖 UI/静态测试。现在 Node local-service 与 Rust sidecar 都记录脱敏 `m3-desktop-fill-latest@1`，`check-p25-real-overlay-click-fill.ps1` 可通过 `/desktop/fill/latest` 验证真实点击是否触发守卫填入。
- 已解决：`check-p25-mascot-overlay-noactivate.ps1` 曾在 overlay 窗口刚创建时立即读取 `exStyle`，可能早于 Rust `keep_overlay_non_activating()` 设置 `WS_EX_NOACTIVATE`，导致一次 `exStyleHex=0x40118` 的竞态误报。现在脚本会等待 no-activate style 出现或超时后再判定。
- 仍未完成：当前真实桌面目标缺 strict foreground 与 safe composer candidate，真实点击验证器不会也不应点击 overlay；不要为通过验证而放宽到 cursor fallback、整窗 `Document`、普通 `Button`、非底部候选或 raw title/input。

## P25 overlay 点击 payload 守卫风险 2026-06-09

- 已解决：`isMascotOverlayPayloadAligned()` 原先在缺少 overlay payload 时返回 true，理论上可能让异常/空 `smart-prompt-overlay-click` 事件复用当前 ready snapshot 触发 `/desktop/fill`。现在缺 payload 会返回 false，并进入 blocked 路径。
- 已解决：交互测试已覆盖 `payload:null` 不会调用 `/desktop/fill`，会隐藏 overlay、标记 `overlayClickGuard=blocked`，并保持 `noAutoSubmit=true`。
- 已新增：`scripts/check-p25-overlay-click-chain.ps1` 把该守卫纳入 P25 聚合审计；当前 `research/p25-overlay-click-chain.latest.json` 为 `pass:true` 但 `completionReady:false`，缺真实目标 strict foreground、safe candidate、write verified 和 real overlay click fill report。
- 仍需注意：`pass:true` 的 overlay click chain 报告是安全链路通过，不是端到端目标完成；不要把 fake service 交互测试或静态链路检查当作真实 Codex/WorkBuddy/Trae composer 填入证据。

## P25 严格前台与 fallback 误判风险 2026-06-09

- 已解决：P25 聚合矩阵原先会把 `cursor_known_tool_window_fallback` 识别到的 Codex 也计入 `foregroundDetected`，容易让后续报告误以为真实 Codex composer 已经严格前台。现在新增 `selectionSource`、`strictForegroundDetected` 和 `strictForegroundDetectedCount`，`completionReady` 也要求严格前台。
- 已解决：真实窗口前台化失败时只看到 `setForeground:false`，难以判断卡在 Windows 前台锁、线程附加还是 Alt 解锁。现在 `foregroundActivation` 会记录每一步尝试结果。
- 当前仍未完成：最新只读矩阵显示 Codex 仅通过 cursor fallback 识别，`strictForegroundDetectedCount=0`、`targetSafeCandidateCount=0`；WorkBuddy/Trae 窗口缺失。写入守卫矩阵打开写入开关后仍未写入，说明守卫正确，但还没有真实 overlay 点击填入通过证据。
- 后续不要为了通过验证而把 cursor fallback、整窗 `Document`、普通 `Button`、非底部区域或未聚焦元素放宽为 safe composer，因为会导致误写目标工具或绕过 no-auto-submit/隐私守卫。

## P25 真实端到端剩余风险更新 2026-06-09

- 已解决：`check-m3-real-desktop-tools.ps1` 的 profile 数组如果用 `powershell -File ... -Profiles codex workbuddy trae` 容易错位解析，导致报告只覆盖 `codex` 且把 `workbuddy` 误作 attach profile；当前已加 `PositionalBinding = $false`，并新增 P25 矩阵脚本逐个 profile 调用。
- 当前证据：`research/p25-real-desktop-targets.latest.json` 显示 `codex` 窗口存在但没有成为前台，`workbuddy/trae` 窗口不存在；因此没有真实目标 composer 可用于写入验证。
- 当前守卫：`research/p25-real-desktop-targets-write-guard.latest.json` 显示即使显式允许真实写入，目标没有前台时仍不写入，`writeAttemptedCount=0`、`noAutoSubmit=true`、`privacyOk=true`。
- 仍需复验：不要把当前 `pass:true` 矩阵误读为端到端完成；它只证明当前环境下守卫正确。完整完成仍需要目标 composer 前台、safe candidate 存在、overlay 自动显示、点击小人后真实填入并验证。

## P25 本轮风险更新 2026-06-09

- 已解决：release 运行时真实 `Smart Prompt Mascot` 顶层窗口最初虽为 topmost，但缺少 `WS_EX_NOACTIVATE`。根因是只处理了 Tauri `window.hwnd()`，没有覆盖带标题的顶层 HWND；当前通过 `GetAncestor(..., GA_ROOT)` 同步设置后，`research/p25-mascot-overlay-noactivate.latest.json` 显示 `noActivateStyle=true`。
- 仍需复验：该证据只证明 overlay 不抢焦点，不等价于真实 Codex/WorkBuddy/Trae composer 端到端填入已完成；后续仍必须在目标 composer 可见且安全候选存在时验证自动显示与点击填入。

## P25 真实桌面悬浮小人剩余风险 2026-06-09

- 已解决：原先只验证了桌面壳内按钮，不等价于用户要的 composer 附近真实小人；当前已改为 Tauri 子窗口 overlay，脱离主窗口面板。
- 已解决：overlay 点击后可能把小人窗口自身变成前台并污染快照；当前点击时优先复用已锁定快照，只有没有 ready 快照时才补抓。
- 已解决：UIA 坐标与 Tauri 逻辑坐标不一致导致小人落到屏幕外；当前 show 使用 `PhysicalPosition`。
- 已解决：透明 WebView2 子窗口在截图/合成中可能呈现空窗或被目标工具盖住；当前改为非透明无边框小卡片，并在 show 时重新 `set_always_on_top(true)`。
- 已解决：overlay PNG 在 WebView2/DPI 下被裁切；当前使用固定 190px 画布、绝对定位和缩放，句柄截图可见完整小人。
- 已解决：系统壳窗口通过相关进程名字被误判为工具 profile 的风险；当前 `explorer`、`LockApp`、`ShellExperienceHost` 等不会因为子进程/祖先进程里出现工具名而变成 Codex/Hermes/WorkBuddy/Trae。
- 已解决：`WindowFromPoint` 返回 `explorer / Backstop Window` 时会挡住真实工具窗口的问题；当前只在系统壳没有安全候选时，用鼠标所在的可见顶层已知工具窗口重试 snapshot。
- 已解决：`AutomationElement.FromHandle` 对抖动/失效窗口抛异常会打断自动检测的问题；当前返回 `uia_root_unavailable` 快照并保持隐私字段，不再崩溃。
- 已解决：Codex 等 profile 的整窗 `Document` 可能被当成 safe/best 写入候选的问题；当前 broad Document 不再算安全写入候选，缺少真实 Edit/focus/caret 时不会自动激活或填入。
- 已解决：桌面小人自动悬浮可能跑到 Hermes 的目标偏移；当前 overlay 自动显示只允许 Codex/WorkBuddy/Trae，Hermes 仍可用于底层诊断但不会触发目标小人。
- 已解决：诊断 ready 与 overlay ready 混在一起会让“可诊断工具”看起来像“可显示小人工具”；当前已拆出 `overlayEligible/overlayReady/overlayReadinessReason`，Hermes 会显示为 `unsupported-overlay-profile`，不触发小人。
- 已解决：sticky 防闪烁可能把上一轮小人保留到已识别但不安全的 Codex 窗口；当前 sticky 仅允许 unknown、snapshot-not-passing、missing-summary 或 no-candidates 这类瞬时 miss，Codex `no-safe-candidate` 会立即隐藏。
- 已解决：启动时自动检测和 `loadServiceState()` 并发时，后者可能用空 snapshot 把已锁定的前台 composer 状态覆盖成 missing；当前只在没有现有 snapshot 时初始化 missing，并用受控定时器测试覆盖自动 show 与候选移动后的 reposition。
- 已解决：overlay 点击事件忽略自身 payload 时，旧 overlay 或错窗口点击可能复用当前 ready snapshot 触发填入；当前点击前必须校验 `profile/titleHash/candidateIndex/noAutoSubmit` 一致，stale payload 会被 UI 标记为 blocked 且不调用填入。
- 已解决：仅用 `focused(false)` 创建 overlay 不能保证点击时不激活窗口，可能让 foreground guard 看到小人窗口而不是目标 composer；当前 Windows 原生层给 overlay 加 `WS_EX_NOACTIVATE`，并用 `SWP_NOACTIVATE` 显示/置顶。
- 已解决：fallback 可能选择进程存在但桌面不可见/被 cloaking 的窗口；当前用 DWM cloaked 属性过滤。
- 仍需注意：当前机器的 Win32 foreground 有时返回 `LockApp`，或前台停在 Hermes；这时隐藏 overlay 或只对真实可写 Edit ready 是正确守卫行为，但不能作为“Codex/WorkBuddy/Trae composer 端到端完成”的结论。
- 仍需复验：本轮可控 Windows 应用列表没有 WorkBuddy/Trae；Codex UI 不可用 Computer Use 自动化。不要为通过验证放宽到整窗 `Document`、按钮、非底部候选或保存 raw title/input。

## P24 桌面小人与输入融合剩余风险 2026-06-09

- 已解决：桌面壳里的小人不再只是 hero 预览或诊断装饰；现在可作为桌面输入伴随入口，驱动前台识别、prompt 生成和显式填入。
- 已解决：真实前台填入不会绕过 M3 守卫；缺少 safe candidate、title hash、tool profile 或 prompt 文本时会被 UI/服务路径拦截。
- 已解决：融合证据只展示 tool profile、title hash、candidate/safe count、best index 和 no-submit 等元数据，不展示目标工具 raw title、UIA 名称、输入值或正文。
- 仍需真实窗口复验：本轮 UI/逻辑通过 fake service、critic 和 Playwright 静态截图；还没有在用户当前真实 Codex/WorkBuddy/Trae composer 中执行新的桌面壳前台填入按钮端到端验证。
- 仍需注意：WorkBuddy/Trae 的 safe candidate 依赖 UIA/语义 composer 信号；后续如果工具 UI 改版，不能为追求通过率放宽到整窗 `Document` 或保存 raw input/title。

## 托盘图标第三次修复剩余注意事项 2026-06-09

- 已解决：托盘运行时不再加载 512px 透明大图，而是加载 `src-tauri/icons/tray.png` 32px 专用图；最新资产裁掉透明留白，可见小人本体约 `23x30`，避免看起来比其它托盘图标小一圈。
- 已解决：`TrayIcon` 不再只停留在 setup 局部变量中，当前通过 `app.manage(tray)` 显式持有，避免生命周期边界导致托盘项异常。
- 已验证：图标矩阵检查、桌面壳测试、Rust 编译检查、release 构建和 diff 检查均通过。
- 仍需注意：Windows 隐藏托盘可能保留旧进程或旧安装包的托盘项；若用户仍看到空白，优先关闭所有旧 Smart Prompt 进程并运行新 exe/重装新 NSIS 或 MSI，必要时重启 Explorer 刷新托盘缓存。

## M3 WorkBuddy/Trae 桌面输入剩余风险 2026-06-09

- 已解决：WorkBuddy/Trae 真实 composer 可手动安全填入并清空，证明不是工具自身不可输入。
- 已解决：候选定位不再只依赖焦点、caret 或鼠标；新增 `semanticComposerHint` 后，空 composer 且焦点停在 WebView 根节点时也有安全辅助信号。
- 已解决：PowerShell 5 编码会读坏中文匹配词的问题；脚本中中文占位符匹配已改成 ASCII `[char]0x...` 组合，避免字符串解析失败。
- 仍需验证：本轮未跑真实 `check-m3-desktop-fill.ps1` 写入报告，所以下一轮还需要在 WorkBuddy/Trae 前台 composer 中用机器脚本确认 `safeCandidateCount > 0`、`writeAttempted:true`、`verified:true`、`autoSubmit:false`。
- 仍需谨慎：语义提示只能作为辅助信号，不能放宽到整窗 `Document`、非底部区域或任意文本匹配；后续新增工具 profile 时也不要保存 raw input/value/title。

## 托盘图标二次修复剩余注意事项 2026-06-09

- 已解决：tray runtime 现在优先使用内嵌 PNG，不再依赖默认窗口图标解析；这降低了 Windows 隐藏托盘出现空白占位的概率。
- 已验证：品牌图标矩阵、桌面壳测试、Rust 编译检查、release 构建和 exe 关联图标提取均通过。
- 仍需注意：Windows 的隐藏托盘区域可能保留旧安装项或旧进程缓存；如果用户运行新版后仍看到空白，需要关闭所有 Smart Prompt 旧进程、重新安装最新 NSIS/MSI，必要时重启 Explorer 或重启系统刷新托盘缓存。
- 当前未发现正在运行的 Smart Prompt 进程；用户截图里的空白项不能直接证明新包仍有运行时图标失败。

## 托盘图标剩余注意事项 2026-06-09

- 已解决：Tauri tray 未显式指定图标导致 Windows 托盘可能显示空白的问题。当前 `main.rs` 已把 `default_window_icon()` 传给 `TrayIconBuilder.icon(...)`，并已重新打包。
- 已验证：品牌图标矩阵检查通过；完整 M3 critic 通过；新 exe 可提取非空关联图标。
- 仍需注意：Windows 托盘区域可能保留旧进程、旧安装包或系统缓存中的空白占位；如果用户仍看到空白图标，先关闭旧 Smart Prompt 进程并运行新 exe/重新安装新 NSIS 包，再观察托盘。
- 仍未完成：WorkBuddy 真实安全填入还缺少在真实 prompt composer 页面里的通过证据；当前非 composer 页面被安全拦截是正确行为，不应为了通过验收而放宽 guard。

## 品牌图标资产剩余注意事项 2026-06-09

- 已解决：浏览器扩展缺少正式 `manifest.icons` / `action.default_icon` 的问题。现在扩展使用 `prototypes/browser-extension/assets/icons/icon-{16,32,48,128}.png`。
- 已解决：桌面壳只有单个 `icon.ico`、缺少明确多尺寸 PNG 渠道资产的问题。现在 Tauri `bundle.icon` 包含 32/128/256/512 PNG 与多 entry ICO。
- 仍需注意：当前没有单独的官网 favicon/OG 页面入口；若后续新增官网、文档站或发布页，应从 `assets/brand/` 复用或生成，不要另画一套。
- 已解决：Tauri tray 现在已显式沿用应用图标；如果后续要做深浅色托盘适配，应从同一品牌图标源派生独立 tray 变体。

## M3 WorkBuddy/Trae 真实桌面输入剩余风险 2026-06-08

- 已解决：Trae 最小化窗口被当成真实前台窗口继续探测的问题。现在 attach/fill 会 restore 目标窗口后再读取 UIA 与坐标。
- 已解决：WorkBuddy/Trae WebView 视觉兜底被当成可写输入框的风险。现在视觉兜底只表示“可能区域”，不进入安全写入候选；没有安全 composer 时不会调用剪贴板 fallback。
- 已解决：Trae UIA `ValuePattern` 假阳性可能导致误写 URL/任务面板的问题。现在 Trae/WorkBuddy 必须通过 profile composer guard，且没有 safe candidate 时返回 `foreground_fill_requires_safe_candidate`。
- 仍未完成：当前用户打开的 WorkBuddy 与 Trae 窗口都不是可输入 prompt 的 composer 状态，因此尚未形成“真实写入并机器验证成功”的通过报告；当前结果是安全拦截通过，不是填入成功。
- 后续验证条件：用户把 WorkBuddy/Trae 切到真实 prompt 输入框可见且可聚焦后，再运行 real desktop fill；若仍 `safeCandidateCount=0`，需要继续补对应工具的 composer 几何/焦点规则。

## P23 重新打包剩余注意事项 2026-06-08

- 已解决：最新桌面壳 UI/i18n 已重新打入 release exe、MSI 与 NSIS 安装包，裸 exe 验证为 `Windows GUI` subsystem。
- 仍需注意：如果用户机器上旧 Smart Prompt 桌面端或旧 sidecar 仍在运行，新包不会自动替换正在运行的进程；需要关闭旧进程后运行新 exe，或用新安装包重新安装。

## P23 桌面壳 UI/i18n 与桌面工具融合剩余风险 2026-06-08

- 已解决：桌面壳视觉过于工具页、按钮不成体系的问题。当前首屏和面板已改为克制的产品叙事风格，并统一主/次/危险按钮。
- 已解决：桌面壳离线初始态中英混杂的问题。当前静态文案、空状态、placeholder、aria 和小人状态标签均走 `zh-CN/en` 语言表。
- 已解决：390px 移动视口截图横向裁切的问题。根因是 Chrome CLI 截图受 Windows 缩放影响；已改用 CDP 强制设备指标验证，`docScrollWidth=390`。
- 仍需真实窗口验证：workBuddy/Trae 当前已有 profile 与本地 self-test，但尚未在用户真实打开的 workBuddy/Trae 窗口中跑完整前台识别和安全填入 pilot。
- 仍需 Tauri 视觉实机复验：安装包 smoke 已验证应用可启动、sidecar 可用；但窗口视觉和 Windows 托盘缓存显示仍需在用户当前桌面上观察确认。
- 隐私边界：桌面伴随面板仍应只展示 hash、profile、候选计数、进程名等元数据；不要为了优化输入框识别而默认采集目标工具输入正文或窗口完整标题。

## V6 P17 Outcome 补标队列剩余风险 2026-06-08

- 已解决：卡片或 toast 消失后无法补标 outcome，导致真实样本长期不足的问题。现在桌面端可从 `Outcome Follow-up` 面板补标最近 generation/insert。
- 已解决：补标入口可能需要保存 prompt 正文才能定位样本的风险。当前队列只用 generationId、策略、场景、工具、host、实验组、cohort、长度和 lastAction 等元数据，不保存或展示 prompt 正文、用户输入正文、页面正文或完整 URL。
- 已解决：已补标条目继续停留在待办队列的问题。`GET /outcomes/pending` 会排除已经有 outcomeLabel 的 generation，测试覆盖补标后移除。
- 仍需真实内测：补标队列降低了采样摩擦，但不会自动产生高质量样本；仍需要用户实际使用后点选 `success/needs-work/failed`，Quality Lift 才能从 collecting 进入可比较状态。
- 产品风险：当前补标按钮只有三档结果，没有记录失败原因；后续如果要收失败原因，应继续只收短 token 或用户显式填写的可见字段，不要默认采集正文。

## V6 P16 Quality Lift 桌面面板剩余风险 2026-06-08

- 已解决：P15 的质量提升报告只能通过 JSON/diagnostics 查看，不利于真实内测判断下一步策略的问题。现在桌面端可直接查看 readiness、cohort、lift delta 和 recommendations。
- 已解决：Quality Lift UI 可能被后续改动删掉但 critic 不感知的问题。当前 `apps/desktop-shell` 静态和交互测试已覆盖面板入口、endpoint、诊断导出刷新和手动刷新。
- 隐私边界：面板只应继续展示 aggregate-only 数据；后续不要为了“解释失败样本”而默认显示 prompt 正文、用户输入正文、页面正文或完整 URL。
- 仍需真实内测：`v6-quality-lift@1` 是聚合比较，不是统计显著性证明；当 outcome-weighted 样本不足时必须保持 collecting，不要把少量成功样本宣传成长期质量提升。
- 产品风险：如果用户很少标注 `success/needs-work/failed`，桌面面板会长期显示 collecting；后续应优先优化 outcome 采样入口或待补标列表，而不是扩大默认数据采集范围。

## V6 P13 延迟 outcome 标注剩余风险 2026-06-08

- 已解决：Prompt Card Insert 成功后关闭，用户必须提前标注 outcome 的问题。现在 Insert 后的 Undo toast 可以继续记录 outcome。
- 已解决：延迟 outcome 可能误触发提交或写入目标输入框的风险。runtime demo 验证点击 toast outcome 后 `submitCount` 仍为 0，目标输入仍保持已插入 prompt。
- 已解决：延迟 outcome 可能丢 generation/strategy/taskScenario 元数据的问题。runtime demo 验证 extension feedback 和 local-service metric 都保留这些字段。
- 仍需谨慎：Toast 只能在当前页面会话里短暂存在；如果用户跳页、刷新或 toast 消失，仍无法补标 outcome。后续可考虑在 prompt history 或桌面面板提供更持久的延迟标注入口。
- 隐私边界：延迟标注仍只应记录 outcome 元数据；不要因为要解释 `needs-work` 或 `failed` 而默认收集 prompt 正文、用户输入正文、页面正文或完整 URL。

## V6 P12 pilot outcome 面板剩余风险 2026-06-08

- 已解决：P11 readiness 报告只能看 JSON、不利于内测决策的问题。现在桌面壳可以直接看到 outcome readiness、胜出/风险策略和还缺哪些采样。
- 已解决：桌面壳 UI 没有被 V6 critic 覆盖的问题。当前 V6 critic 会运行 desktop-shell 静态/交互测试，避免面板入口或渲染函数被改坏。
- 隐私边界：面板只渲染 P11 的聚合报告；后续不要为了更好解释策略风险而在桌面壳里显示 prompt 正文、用户输入正文、页面正文或完整 URL。
- 未完成项：本轮尝试用 Playwright 做视觉截图 smoke，但当前工作区没有安装 Playwright，Browser 截图工具也未暴露；因此视觉验证来自 DOM 交互测试和 CSS/布局静态检查，而不是截图。
- 仍需真实内测：面板能显示采样缺口，但完整目标仍需要真实使用 outcome 数据填满 collecting/empty cohort，再观察策略调权是否真的提升成功率和均分。

## V6 P11 pilot outcome readiness 剩余风险 2026-06-08

- 已解决：真实内测 outcome 数据缺少汇总入口的问题。现在可以通过 `/metrics/pilot-outcomes` 和 diagnostics export 查看 taskScenario/tool/site/mode/strategy/experiment arm 的 readiness、成功率、均分和采样缺口。
- 已解决：内测报告可能泄露 URL 路径、prompt、输入或页面正文的问题。当前报告只输出 aggregate-only 数据，site 收敛到 host，probe 会用 SECRET 哨兵文本做硬性泄露检查。
- 已解决：critic 只验证 prompt 生成质量、不验证 pilot outcome 报告的问题。当前 V6 critic 会校验 P11 报告的 ready/collecting/empty cohort、winner/risk strategy、collection target 和隐私边界。
- 仍需真实内测：P11 的通过证明“报告能力和隐私边界可用”，不证明真实 prompt 质量已经提升；完整目标仍需要在 ChatGPT/Claude/Gemini/Doubao/Codex 等真实使用中积累 outcome 样本。
- 后续风险：如果每个 taskScenario/tool/site 的 outcome 数量长期不足，策略学习会停在 collecting 状态；下一步应做一个内测采样计划或面板，明确每类场景还差多少条有效 outcome。

## V6 P10 outcome 标注 UI 剩余风险 2026-06-08

- 已解决：P9 outcome 字段只能由调用方或脚本显式传入、没有真实用户入口的问题。现在 Prompt Card 上有轻量 outcome 标注 UI，可开始收真实内测结果样本。
- 已解决：失败 outcome 可能因为 `outcomeVerified:true` 被误算成成功的问题。当前 `needs-work` / `failed` label 会优先判为非成功 outcome。
- 已解决：outcome UI 可能触发目标站点提交的风险。runtime demo 验证点击 outcome 后 `submitCount` 保持 0，且不会写目标输入框。
- 仍需谨慎：Prompt Card 在 Insert 成功后仍会关闭，因此用户需要在卡片关闭前标注 outcome；后续如果想收“使用后结果”，可能需要在 Undo toast 或历史面板补一个延迟标注入口。
- 仍需真实内测：P10 证明了采样入口和指标回流，不证明真实 prompt 质量已经提升；下一步应跑真实场景 pilot，按 taskScenario/tool/site 统计 outcomeSuccessRate、avgOutcomeScore、Retry/Undo 变化和低分失败原因。
- 隐私边界：outcome 事件仍只应保留 label/score/metadata/promptLength；不要因为要解释失败原因而默认收集 prompt 正文、用户输入正文、页面正文或完整 URL。

## V6 P9 任务 outcome 反馈闭环剩余风险 2026-06-08

- 已解决：交互反馈只能说明用户点了 Insert/Save/Retry/Undo，不能说明任务真的完成。现在可以记录隐私安全的 `outcome` / `task_outcome` 事件，并按任务场景和 prompt strategy 聚合成功率与评分。
- 已解决：task outcome 只在报告中出现、不会影响下一次生成的问题。现在 `taskOutcomePolicy` 会进入 `buildPromptStrategyPlan`，并通过 `Local task outcomes` 进入 template/LLM 上下文。
- 已解决：`Number(null)` 误把无 outcomeScore 的事件计为 0 分的问题。当前用显式数值判断过滤 null/undefined/空字符串，避免稀释 `avgOutcomeScore`。
- 已解决：critic 没有硬性检查 task outcome probe 的问题。`scripts/critic-v6-prompt-quality.ps1` 现在会校验 winner/risk、readiness、strategy selection、prompt injection 和 redaction。
- 仍需谨慎：P9 的通过证明代码闭环和合成 probe，不证明真实用户任务质量已经提升；完整目标仍需要真实内测 outcome 样本、按场景/工具/站点拆分的可比数据，以及失败样本回灌。
- 仍需产品决策：当前 outcome 字段需要调用方或后续 UI 显式记录，尚未实现卡片上的“任务成功/还需修改/无效”反馈入口；如果要收真实内测数据，下一步应先做轻量 outcome 标注 UI 或诊断导出流程。
- 隐私边界：当前报告只用聚合 token、hash/长度和策略 id；后续不要为了分析失败样本默认上传 prompt 正文、用户输入正文、页面正文或完整 URL。

## V6 P8 场景感知学习剩余风险 2026-06-08

- 已解决：历史反馈只能按 mode/tool/adapter/site 学习、无法区分任务类型的问题。现在同一工具和站点下会保留 `taskScenario`，并能按场景聚合 strategy 与 experiment arm。
- 已解决：真实 LLM 只看到泛化策略指标、不了解当前任务场景的问题。现在 template 和 LLM message 都包含 `Local task scenario`，策略/洞察/outcome 文本也带 scenario cohort。
- 已解决：场景聚合可能泄露输入正文的问题。当前只保存短 token、hash/长度/聚合指标，不保存 prompt 正文、用户输入正文或页面正文；P8 probe 验证 `scenarioTextRedacted:true`。
- 仍需谨慎：场景推断是规则型 taxonomy，能覆盖常见 code/security/test/ui/release/data/prompt/product 场景，但真实中文/混合输入可能需要继续根据内测样本扩充规则。
- 仍需验证：P8 证明了场景感知闭环和合成样本策略选择，不证明真实用户任务质量已经提升；完整目标还需要真实内测里的 Insert/Save/Retry/Undo 与人工 outcome 样本。
- 仍需产品决策：是否允许用户在卡片上看到或手动切换任务场景、是否让场景规则可配置、是否按场景展示学习强度，目前尚未实现。

## V6 P7 outcome 反哺剩余风险 2026-06-08

- 已解决：实验 outcome 只出现在报告里、不会影响下一次生成的问题。现在 prompt strategy plan 会读取 comparable outcome，并把 outcome decision 传入 template/LLM 上下文。
- 已解决：策略组变差仍可能继续被沿用的问题。当前 `prefer_baseline_until_reviewed` 会在无插入/重试 guardrail 冲突时把 selected strategy 退回 `baseline_structure`。
- 已解决：策略版本无法区分 P6/P7 行为的问题。当前策略版本为 `v6-strategy-policy@3`，历史 `@2` 样本仍可作为旧策略版本被 metrics 区分。
- 仍需谨慎：P7 的胜出/退回判断来自聚合指标规则和合成 probe；它证明链路和决策行为，不证明真实用户任务质量已经提升。
- 仍需内测：完整目标还需要按真实站点、工具、模式和任务类型收集足够 comparable samples，再验证 Insert 成功率、Save 率、Retry/Undo 变化和失败原因。
- 仍需产品决策：是否让用户可见或可配置实验/学习强度、固定实验周期、跨设备一致性，目前尚未纳入实现，不要默认扩大数据采集范围。

## V6 P6 实验闭环剩余风险 2026-06-08

- 已解决：提示词策略只有洞察、缺少对照实验元数据的问题。现在生成卡片和反馈事件都有 experiment arm、bucket、comparisonKey 与策略版本，metrics 可按 `byExperimentArm` 汇总。
- 已解决：本地模板/服务离线路径缺少实验字段的问题。扩展端会给客户端模板生成 `client-template` baseline 兜底元数据，避免 Insert 反馈掉出实验闭环。
- 已解决：诊断导出只能看 strategy insights 的问题。现在 `GET /metrics/experiment-outcomes` 和 `/diagnostics/export` 都能输出聚合 outcome report。
- 仍需谨慎：当前 P6 证明的是链路和聚合能力，不是统计意义上的真实提升；如果 baseline 和 strategy_guided 样本不足，report 会保持 `collecting`。
- 仍需验证：真实内测里需要按站点、工具、模式和任务类型收集足够样本，再看 Insert 成功率、保存率、Retry/Undo 使用率和失败原因，不能只凭 probe 的合成数据宣称提示词能力已提升。
- 仍需产品决策：实验分组目前是本地 deterministic bucket；后续如果要做用户可控开关、固定实验周期或跨设备一致性，需要单独设计，不要默认扩大数据采集范围。

## V6 P5 策略洞察剩余风险 2026-06-08

- 已解决：`byStrategy` 缺少可解释分析层的问题。现在有 `strategyInsights`、服务端查询接口、诊断导出和生成上下文回灌。
- 已解决：洞察文本泄露用户输入或 prompt 正文的风险。当前洞察只使用聚合计数、比率、策略 id、cohort token 和推荐动作；`site` 会收窄到 host。
- 仍需谨慎：`strategyInsights` 是规则化解释和推荐，不是统计意义上的 A/B 胜出证明；它能指导生成，但不能单独证明某策略真实优于另一策略。
- 仍需验证：真实内测样本量、按工具/站点/模式的长期采纳率、保存率、Retry/Undo 变化和失败原因回灌还没形成闭环，因此 active goal 不能标记 complete。

## V6 P2 剩余风险 2026-06-08

- 已解决：生成结果和后续反馈事件无法关联的问题。现在 card、prompt history、metrics event 都能携带 `generationId`/`strategyId`，local-service 可按 `byStrategy` 聚合。
- 已解决：V6 evidence 缺少实验链路验证的问题。`qualityExperimentProbe` 已纳入 `scripts/check-v6-prompt-quality.js` 和 `scripts/critic-v6-prompt-quality.ps1`。
- 仍需注意：浏览器扩展本地模板路径没有服务端 rubric 评分时会写入保守基线分 0.72；该值只用于让事件可聚合，不代表真实质量优于旧版。
- 仍需注意：当前策略学习仍是规则与聚合指标驱动，不是统计意义上的 A/B 胜出。后续要用真实 byStrategy 指标、保存率、重试率、撤销率和失败原因来验证。
- 工具记录注意：第一次创建 V6 P2 OMX mission 时长 topic 产生了尾部连字符 slug，verdict 工具无法按规范化 slug 找到目录；已改用短 slug `smart-prompt-v6-p2-quality-experiment-metrics` 并记录 pass verdict。该残留 `.omx` 目录未进入 git dirty。

## V6 提示词质量剩余风险 2026-06-08

- 已解决：真实/模板生成缺少机器可评估结构的问题。当前 LLM gateway 支持结构化 JSON 解析、raw text fallback 和质量评分。
- 已解决：手动选择 `idea/continue/polish` 后扩展模板仍按自动识别模式生成的问题。当前浏览器扩展会尊重 `context.mode`，卡片渲染也不会让服务返回的 mode 覆盖用户选择。
- 已解决：browser runtime demo 可能误连 17371 上真实桌面服务，导致真实 LLM 输出影响测试稳定性的问题。当前测试使用随机端口隔离 local-service。
- 已解决一部分：feedback summary 已升级为 `feedbackProfile`，能从 retry/undo/save/adapter failure/failureReason 推导自适应 directives，并进入 template 与 LLM 生成上下文。
- 仍需注意：当前质量评分和 feedbackProfile 都是规则型 rubric，只能保证 prompt 结构、边界、可执行性和基于历史指标的显式调权，不等于真实任务效果优于旧版本；下一步需要真实任务 A/B 或人工采纳率/保存率数据验证。
- 仍需注意：feedbackProfile 当前来自本地 metrics 聚合，尚未做到按站点、工具、用户意图长期学习权重；不能宣称已经完成“自学习提示词系统”。
- 仍需注意：structured LLM 输出依赖 provider 遵守 JSON 指令；虽然已有 fallback，但真实 provider 偶发返回非 JSON 时仍可能只得到 raw text 质量评分。
- 仍需注意：`research/v6-prompt-quality.latest.json` 有隐私脱敏约束，只保存 hash/length/score；后续排查具体低分样本时需要回到 fixture id，而不是从报告还原正文。

## M3 收口后剩余风险 2026-06-08

- 已解决：豆包登录态网页当前有真实 composer 填入证据，1 次 Insert attempt、1 次回读验证成功、no-auto-send 通过，测试文本已清空。
- 已解决：地区或安全拦截不再被误记为普通 selector 失败；报告支持 `region_or_security_gate_no_visible_composer`。
- 范围更正：workBuddy、Trae 是本地工具，不作为网页 adapter 跑；DeepSeek 本轮不跑。
- 仍需后续产品优化：如果要覆盖 workBuddy、Trae，需要走本地桌面工具识别/填入路径，而不是把公开网页当 composer。
- 运行环境风险：`scripts/critic-m3.ps1` 会刷新 `research/m3-real-desktop-tools.latest.json` 为当前前台 snapshot-only 报告；真实三工具写入完成状态应看 `research/m3-real-desktop-tools-fill-matrix.latest.json`。

## M3 真实桌面工具输入风险更新 2026-06-08

- 已解决：Claude Code 真实窗口曾因 UIA 元素 `BoundingRectangle` 出现 Infinity/无效坐标导致 snapshot 崩溃；`check-m3-desktop-input.ps1` 与 `check-m3-desktop-fill.ps1` 已改为安全转换 bounds，避免单个坏元素拖垮整次验证。
- 已解决：真实桌面写入默认候选 0 容易指向整窗 `Document`；`check-m3-real-desktop-tools.ps1` 已改为默认使用 snapshot 的 `bestCandidateIndex`，除非调用方显式传入候选。
- 已解决：三工具真实桌面输入均已验证 no-auto-submit；但测试文本会留在真实工具输入框中，后续真实内测前应由用户手动清空或覆盖，避免误发送测试标记。
- 仍需关注：真实 beta adapter 网页内测 Insert 成功率仍为 M3 另一条线，不能因为桌面工具输入通过就标记整个 active goal 完成。

## M3 caret/focus 输入信号风险 2026-06-08

- 已解决一项观测缺口：输入候选现在会记录 caret/focus/底部位置/超大 Document 等强信号，便于解释为什么某个候选更像输入区。
- 仍需谨慎：Codex 真实前台已证明 WebView/终端类工具可能不暴露 Win32 caret；`caretVisible:false` 不等于没有输入框，只能说明 OS 层拿不到真实光标。
- 仍需谨慎：UIA focus 可能落在整窗 `ControlType.Document` 上；这说明用户正在工具容器内输入，但不能证明已经定位到安全可直写的 composer。直接写入仍必须受超大 Document guard 和显式 clipboard fallback 控制。

## M3 剪贴板 fallback 风险 2026-06-08

- 已解决一项：当 UIA 只能识别 Terminal/WebView/自绘宿主容器、拿不到可写 `ValuePattern` 时，新增显式 `allowClipboardFallback` 作为受控降级路径；报告不保存剪贴板/写入原文，且会恢复原剪贴板。
- 安全边界：真实窗口 fallback 仍必须有 `confirmForeground`、`expectedTitleHash`、`expectedToolProfile` 和 `allowClipboardFallback`；缺任一项或 hash/profile 不匹配时必须 `writeAttempted:false`。
- 已解决一项误写风险：真实 Codex 前台的候选 0 是全窗口 `ControlType.Document`，现在会被 `directWriteBlocked:true` 阻断，返回 `foreground_candidate_requires_clipboard_fallback`，不再直接 `SetValue` 或 `SetWindowText`。
- 已解决一项真实前台 fallback guard：`research/m3-real-desktop-clipboard-guard.latest.json` 证明即使显式开启真实写入和 clipboard fallback，title hash 不匹配时仍不会尝试粘贴。
- 仍需验证：当前剪贴板 fallback 只有临时 TextBox self-test 和服务契约证据；尚未在真实 Codex/Claude Code/Hermes 前台窗口里记录成功写入与回读结果。
- 运行环境风险：隐藏 sidecar 进程创建临时窗口时，Windows 前台抢占策略会让 `SendKeys` self-test 不稳定；因此 sidecar smoke 继续验证直接写回链路，剪贴板 fallback 由前台 self-test 和接口契约验证。
- 运行环境风险：安装后 app smoke 曾出现一次“启动 5 秒内退出”的偶发失败，已在 `scripts/check-v4-installer-smoke.ps1` 增加一次启动重试；完整 M3 critic 后续已 PASS。

## 当前 M3/V5 剩余风险 2026-06-07

- 已解决：Windows snapshot/fill self-test、Codex/Claude Code/Hermes 三工具画像 self-test、真实 Codex 前台窗口 snapshot-only 审计、受控前台窗口写回 guard、local-service 接口、native sidecar 接口、安装包 bundled sidecar smoke 均已通过 M3 critic；报告只保留长度、hash、策略和布尔校验，不保存 raw prompt、窗口标题原文或写入文本。
- 已解决一项安全边界：真实前台窗口写回现在必须显式确认前台窗口，并匹配 title hash 与工具画像；hash/profile 不匹配时不会写入，避免误填当前 Codex/Claude/Hermes 以外的窗口。
- 仍需验证：Codex、Claude Code、Hermes 真实工具窗口写回尚未通过实机验收；当前真实 Codex 证据只证明前台窗口 snapshot 和候选枚举，fill 证据仍来自临时 WinForms TextBox self-test，写入策略实际为 `win32_set_window_text_fallback`，不是目标工具的真实输入框成功。
- 当前不做：用户已明确先不做 macOS AX；不要把 macOS AX 作为当前 M3 完成门槛。
- 最新范围已更正：网页 pilot 只跑豆包登录态；workBuddy、Trae 走本地工具路径，DeepSeek 本轮不跑。
- 运行环境注意：本轮完整 M3 critic 曾在 beta adapter pilot 处出现一次 Chrome/CDP 崩溃码 `-1073740791`，单独复跑和第二次完整 critic 均通过；不要把这次 transient crash 当作 adapter 成功或失败结论。
- 发布注意：本轮改动已重新构建本地安装包用于 M3 smoke，但不代表 GitHub 上 `v0.2.0-beta.1` release assets 已随之更新；若要对外发布这些 M3 fill 改动，应新建后续 beta tag/release 或显式替换 release assets。

## M3 Pilot 与桌面输入识别风险 2026-06-07

- 仍需内测修复：`research/m3-pilot-adapters.latest.json` 当前证明 workBuddy、Trae、Doubao、DeepSeek 四站正式扩展加载成功，但 Insert 成功率为 0；每站已探测 5 个候选入口，失败原因细化为 `no_input_candidates_on_loaded_page: 2`、`public_or_marketing_page_no_visible_composer: 1` 与 `login_or_auth_gate_no_visible_composer: 1`，需要用登录态/正确 composer 路由继续定位。
- 已解决一项：Windows UIA 目前已有 self-test、JS local-service 开发路径接口，以及 native sidecar source/dev 等价 `/desktop/input-snapshot`；`research/m3-sidecar-desktop-input.latest.json` 为 `pass:true`。
- 已解决一项：安装包内 native sidecar 已重新打包复验 M3 `/desktop/input-snapshot`；`research/m3-installed-sidecar-desktop-input.latest.json` 为 `pass:true`，且证明 bundled UIA probe 已进入 `resources/smart-prompt-sidecar/scripts/`。
- 仍需产品化：当前只证明安装包 self-test snapshot，可识别 UIA 输入候选；真实 Codex/Claude Code/Hermes 桌面输入框写回和剪贴板 fallback 仍未验收。
- 当前平台范围：macOS AX 暂缓，当前只推进 Windows UIA。
- 仍需工具实测：Codex、Claude Code、Hermes 已有工具画像和 synthetic/self-test 覆盖，但还没有在真实这些工具窗口中做 UIA Insert 或填入验证。
- 隐私约束：UIA 报告不得保存窗口标题原文、元素名称原文、输入值、prompt 正文或整屏内容；当前 self-test 报告只保存长度/hash/候选能力。

## V5 Beta 发布后剩余风险 2026-06-07

- 已解决：V5 不再依赖“Node + JS resources”作为发布 sidecar；当前 beta 包使用 `apps/local-service-sidecar` 编译出的 native executable，并由 Tauri 资源打包。
- 已解决：V5 release-ready manifest 已通过，`v0.2.0-beta.1` tag 已推送到 GitHub；安装包 checksum、release notes、GitHub Release 页面和 installer assets 均已生成/上传。
- 已解决：`docs/prd.md` 的 workBuddy/Trae/Doubao/DeepSeek 目标用户修改已被当前 V5 PRD 收尾目标确认，不再是“不要默认纳入”的未确认改动。
- 仍需内测观察：`research/v5-pilot-loop.md` 是 beta pilot 计划与记录入口，后续真实用户使用后需要继续补 Insert 成功率、保存率、Undo/Retry 使用和失败站点 adapter 修复。
- 仍需谨慎处理：workBuddy、Trae、Doubao、DeepSeek 新 adapter 是 beta allowlist，尚未用真实登录态页面完成连续成功率验收；不要把它们写成已稳定通过。
- 工具对账风险：V5 OMX mission 的 handoff objective 是英文生成文本，但实际 Codex goal objective 是用户中文 V5 目标全文；`omx autoresearch-goal complete` 会严格比对 objective，因此拒绝写 `completion.json`。不要为通过对账伪造 Codex goal objective。

## V4 完成后剩余风险 2026-06-07

- 已解决：`INSTALLER_PASS` 现在有安装包 artifact 和安装后 runtime smoke 证据；安装后的桌面壳能从包内 `resources/smart-prompt-sidecar` 使用包内 `node.exe` 启动/停止 local-service，并通过 `/health`。
- 已解决：旧 smoke 曾误把包内 `node.exe` 当成安装后的 app 启动；`scripts/check-v4-installer-smoke.ps1` 已改为优先选择 `smart-prompt-desktop.exe` 并排除 `node.exe`。
- 已解决：V4 release manifest 已为 `releaseReady:true`，当前不再因安装包或 sidecar 源码路径阻塞。
- 仍需作为后续 Beta 风险关注：`LIVE_SITE_STABILITY_PASS` 的 V4 通过方式是 `LOGIN_ROUTE_RECOVERY_PASS`，不是三次连续 full run；Claude 依赖 `.runtime/v2-live-chrome-profile` 登录态，Replit formal route 固定为 `https://replit.com/agent4`，站点改版时要重跑 formal evidence。
- 仍需作为后续发布风险关注：当前 sidecar 打包了 Node runtime 和 JS service resources，已满足本机安装 smoke；后续若要更专业的发行形态，可再把 local-service 编成独立原生 sidecar executable。
- 工具对账风险：OMX mission 和 ledger 已 `passed`，Codex goal 已 `complete`；但 `omx autoresearch-goal complete` 无 allow-mismatch 参数，因英文 handoff objective 与用户中文 Codex goal objective 不一致拒绝写 `completion.json`。这不是 V4 代码或证据门失败。

## V4 剩余风险更新 2026-06-07

- 已解决：`FIRST_RUN_PASS` 现在有机器证据，桌面壳能完成 provider key 保存、provider 测试、skill 导入、隐私边界展示与首启 ready 状态。
- 已解决：`PROMPT_CARD_UX_PASS` 现在有机器证据，浏览器扩展 runtime demo 覆盖手动三模式、Retry、Insert、Copy/Save 既有路径、Undo 和反馈记录。
- 仍未完成：`INSTALLER_PASS` 为 FAIL，因为没有 installer artifact，也没有安装/启动/退出/卸载 smoke evidence。
- 仍未完成：`LIVE_SITE_STABILITY_PASS` 为 PARTIAL，目前只有 V3 单次 8 站 formal PASS，还缺连续 3 次或明确的登录态/route 恢复策略证据。
- 当前不要标记 V4 Codex goal complete，因为 `research/v4-release-manifest.latest.json` 仍是 `releaseReady:false`。

## V4 风险 2026-06-07

- 当前 V4 未完成，不能标记 Codex goal complete：`research/v4-release-manifest.latest.json` 为 `releaseReady:false`。
- 已解决一项：`SIDECAR_SERVICE_PASS` 已有机器证据，Tauri runtime 能启动并停止 local-service；后续仍需把该服务做成真正可发布 sidecar/安装包内资源，而不仅是 dev profile 中通过 `node` 启动脚本。
- 主要缺口：`INSTALLER_PASS` 仍为 FAIL，当前没有 installer artifact，也没有安装/启动/退出/卸载 smoke evidence。
- `FIRST_RUN_PASS` 仍为 PARTIAL：已有 provider key、provider status、skill import 和真实 LLM 报告证据，但缺完整首次启动向导、真实 provider 测试按钮和隐私边界验收。
- `LIVE_SITE_STABILITY_PASS` 仍为 PARTIAL：已有 V3 单次 8 站 formal PASS，缺连续 3 次或登录态恢复策略证据。
- 已解决：`PROMPT_CARD_UX_PASS` 已为 PASS；Prompt Card 具备手动三模式、Retry、Undo、LLM/template badge、Insert 状态和 feedback runtime evidence。
- 已解决：`LOCAL_DATA_PASS` 已为 PASS；local-service 具备搜索、去重、备份、恢复、versioned metadata 和本地 metrics，且测试覆盖指标不保存 prompt 正文。

## V3 release-ready 风险 2026-06-07

- 已解决：`LIVE_SITE_FORMAL_PASS` 不再是 `PARTIAL`；当前 `research/v3-live-site-formal.latest.json` 为 `pass:true`，`research/v3-release-manifest.latest.json` 为 `releaseReady:true`。
- 已解决：Replit `/ai` 无 visible input/display 的缺口；正式矩阵改用 `/agent4` 后 Replit display PASS，且没有放宽 required list、assertion、fallback 或 injected probe 规则。
- 剩余运行环境风险：完整 formal 对 Claude 登录态有依赖；fresh profile 会失败在 Claude，复验时应使用 `.runtime/v2-live-chrome-profile` 或先完成 Claude 登录。
- 剩余稳定性风险：`/agent4` route 的长期稳定性未长期观察；如果 Replit 改版，需要重新只读探查真实 Agent composer，而不是把普通营销输入框算作 PASS。

## V3 live-site formal 风险 2026-06-07

- 历史风险已解决：`LIVE_SITE_FORMAL_PASS` 曾为 `PARTIAL`，缺口是 Replit visible input/display；当前已通过 `/agent4` 和持久 Claude profile 跑到 PASS。
- Insert strict evidence 已从 `card-close` 代理改为 DOM evidence；ChatGPT/Claude/Gemini 已进入 `insertPasses` 和 `noAutoSendPasses`。后续不要回退到“卡片关闭即 verified”的宽松口径。
- 第三次 formal 探针出现 Windows 进程码 `-1073740791`，疑似 Chrome/CDP/profile 锁或浏览器崩溃；未覆盖上一份有效 partial report。不要把这次崩溃当产品 PASS/FAIL，只作为运行环境风险。
- 机器上存在多个 Chrome 进程；后续跑 `-AttachCdp` 前需要确认 9232 CDP 可用，或使用干净 profile，避免 profile/port 冲突。
- Replit `/ai` 页面在持久 profile 下仍无 visible input candidate；当前正式验收不要回退到 `/ai`，使用已验证的 `/agent4`。

## 当前 V3 风险快照

- 主要缺口已解决：`LIVE_SITE_FORMAL_PASS` 为 PASS，release manifest 已记录 8 站 display 和 3 站 insert/no-auto-send。
- Tauri 风险：`withGlobalTauri` 仍为 `true`，但已用 main window capability 和 CSP 收窄；完全关闭需要引入 `@tauri-apps/api` bundler/import 路径。`start_local_service` 当前仍是 Rust custom command 调 Node 脚本，发布版建议改 sidecar 或安装路径服务。
- 凭据风险：provider keys 已不再明文写入 `settings.json`，Windows 优先 DPAPI；非 Windows 或 DPAPI 不可用时走 AES-256-GCM fallback。未配置 `SMART_PROMPT_KEY_ENCRYPTION_SECRET` 时，fallback 仍弱于真正 OS keychain。
- 浏览器 Insert 风险：已新增 strategy-based write、after-write verification、composed input/change events、失败不关卡片和反馈记录；生产站点 composer 仍可能变化，需要持续复跑 live-site formal。
- 已解决：V3 Tauri/security 当前 critic 通过；V3 skill routing 20 fixtures hit rate = 1.0；V3 release manifest 已生成并为 `releaseReady:true`。

## 当前问题

- V3 发布化前仍可继续收紧 Tauri：`withGlobalTauri` 仍为 `true`，但当前已有 CSP、main-window capability allowlist 和 IPC 命令最小化证据。
- V3 发布化前仍可继续强化凭据：provider keys 已迁出明文 settings JSON，Windows 走 DPAPI；非 Windows fallback 仍弱于真正 OS keychain。

- 当前无阻塞 V2 自动化代码路径推进的问题；完整 runtime 验收已经具备机器证据。
- 本地 prompt/skill 库已支持导入、推荐、保存、列表和删除；当前不再是主要缺口。
- 浏览器扩展 Prompt Card 的 Save 已接入本地 prompt 库；当前不再只保存到扩展本地收藏。
- 浏览器扩展本地服务离线 fallback 已有 headless runtime 覆盖；当前不再只靠静态检查证明。

## 已知风险

- “全网深度调研”无法证明穷尽全网；当前采用多源、多社区、多关键词检索并保留来源链接。
- SkillHub/ClawHub 命名和生态边界不唯一；文档已标注不确定性。
- 自动识别并写入任意桌面/网页输入框涉及权限、隐私和平台安全限制；PRD 已限定 MVP 从 allowlist 网页输入框开始。
- 当前浏览器 MVP 使用 DOM 写入；复杂 contenteditable/富文本编辑器可能仍可能受站点 UI 变更影响。本轮已补强 8 站点 selector、同步共享核心，并让 live-site probe 使用适配器 selector，但生产站点仍需持续 runtime 证据。
- 真实 LLM gateway 代码路径已接入并支持 auto、OpenAI-compatible、Anthropic、Gemini provider，且有三模式 test double 覆盖；provider-specific saved keys、provider 默认模型和 auto provider 失败转移已支持，但当前可用 key/billing 不足时仍会回退本地模板，生成质量会受模板限制。
- 真实 LLM 生成需要 API key 和可用 billing；没有 key 时本地服务只会按调用方允许返回 template fallback。
- 当前 User 环境只发现 `OPENAI_API_KEY`，未发现 `ANTHROPIC_API_KEY`、`GEMINI_API_KEY` 或 `GOOGLE_API_KEY`；本地服务和验收脚本现在也支持读取桌面壳保存的 provider-specific keys，`check-v2-real-llm.ps1 -DryRun` 可预检配置，但尚未拿到 Anthropic/Gemini 真实联网通过证据。
- strict runtime critic 现在会读取 `research/v2-real-llm.latest.json`，当前 OpenAI 429 报告会明确阻止 V2 完成。
- 真实站点验证可能需要浏览器登录态和平台页面稳定性；当前不能用本地 demo 代替生产站点证据。Claude 可通过 `scripts/start-v2-claude-cdp.ps1` 打开持久 Chrome profile，再用 `-AttachCdp` 模式复用已登录 Chrome 会话，但仍需要真实登录态报告。
- 默认隐私上下文已收窄到 host/origin/tool/inputKind/pathKind；后续如果要上传 URL、页面标题或页面内容，必须做成显式用户开关和可见范围提示。
- 当前 Chrome/Edge 环境未接受命令行 unpacked extension 加载；已改用 browser-level CDP `Extensions.loadUnpacked` 获取正式扩展加载证据。

## 失败尝试

- 初始 critic 脚本包含中文字符串，Windows PowerShell 以非 UTF-8 解析时报错；已改为 ASCII-only 检查。
- 初始 critic 在文档未填充时失败；后续补齐来源与文档。
- 第二次 critic 在 UI/UX 图未生成时失败；后续生成图片并通过。
- 调严 critic 后曾失败在缺少显式 `gpt-image-2` API 输出图：`assets/ui-ux/prompt-copilot-uiux-gpt-image-2.png`；用户后来确认不需要严格 `gpt-image-2`，该项已从完成门槛移除。
- 本次按用户要求再次 dry-run 通过；随后在 User 级 `OPENAI_API_KEY` 生效后真实调用 `gpt-image-2`，但被 billing hard limit 拦截。
- 用户配置 User 级 `OPENAI_API_KEY` 后再次真实调用；`uv run --with openai` 成功安装临时 SDK 并调用 Image API，但 OpenAI 返回 billing hard limit，未生成输出图。
- Goal 续跑中再次真实调用 `gpt-image-2`；API 仍返回 billing hard limit。更新后的 critic 仍失败在缺少 `assets/ui-ux/prompt-copilot-uiux-gpt-image-2.png`。

## 待回顾

- 真实 Chrome/Edge 扩展在 ChatGPT、Claude、Gemini、Perplexity、Lovable、Bolt、v0、Replit 等站点的逐站点兼容性。
- V2 runtime evidence：Claude Insert 和真实 LLM 三模式；当前已提供 Claude CDP 登录准备脚本、CDP attach 模式、独立 Claude 报告路径和真实 LLM 报告路径，但还需要登录态/可用 billing 通过报告作为证据。
- live-site probe 当前失败原因：Claude 跳到登录/登出页；Perplexity challenge；Replit/DeepSeek/Doubao 登录或区域限制。

## 已解决

- V3 P0-1 已解决：本地服务不再使用 wildcard CORS 暴露受保护 API，受保护 API 需要 per-install auth token；浏览器扩展和桌面壳会 bootstrap token 并带 auth 调用；V3 security critic 已覆盖恶意 origin、无 token、Bearer token、`X-Smart-Prompt-Token` 和 no-wildcard CORS。
- V3 P0-1 已解决：新增 evidence redaction 模块与 runtime check，V2/V3 runtime evidence 已机械脱敏，`research/v3-security-privacy.latest.json` 不保存 API key、token、完整 URL、profile path 或 prompt/value 正文。
- 已补齐项目记忆文件。
- 已完成研究文档、PRD、UI/UX 概念图。
- 已完成一版不依赖 API billing 的内置 `image_gen` UI/UX 图，并本地贴入原始小人以避免模型重绘角色。
- 已完成六种小人状态动作资产并抠成透明 PNG：normal、resting、thinking、suggesting、success、clapping。
- 已完成 Remotion 轻量动画原型和两个 MP4 渲染资产。
- 本地 critic 已按更新目标通过，OMX 已记录 pass verdict。
- 已开始第一版实现：新增 Chrome/Edge MV3 浏览器扩展 MVP 原型和基础验证脚本。
- 已接入 V2 本地服务、LLM gateway 代码路径、站点适配器、Tauri scaffold 和 V2 critic 自动化检查。
- 已接入本地 prompt/skill 库：skill 文件夹导入/推荐与 prompt 保存/列表/删除 API，并在桌面壳暴露管理 UI。
- 已接入浏览器扩展 Save 到 local-service `POST /prompts`，并保留 `chrome.storage.local` 离线回退。
- 已补浏览器扩展离线 fallback runtime demo：不可达 `serviceUrl` 时生成回退模板、Save 写入 `smartPromptFavorites`、Insert 不提交。
- 已安装 Rustup/Cargo，并通过 Tauri `cargo check`；当前剩余的是运行态 app 启动和全局快捷键验证，不是 Rust 编译环境缺失。
- 已通过 `scripts/check-v2-tauri-runtime.ps1` 验证 Tauri 运行态启动、Tauri command、从 Tauri 启动本地服务和全局快捷键触发；Tauri runtime 不再是当前缺口。
- 已通过 `scripts/check-v2-claude-insert.ps1 -AttachCdp -CdpPort 9232` 验证 Claude 生产站点正式扩展显示和 Insert：`research/v2-claude-insert.latest.json` 包含 `extensionLoad.ok: true`、`insertPasses: ["claude"]`、`passedDisplay: true`、`passedInsert: true`、`injectedProbe: false`。
# 当前风险 2026-06-08

- 已解决：输入文字后删除会让 `.spc-context` 反复追加 `service offline`；根因是多个异步 LLM 请求失败分支没有校验最新 request，且用字符串追加离线状态。
- 已解决：Smart Prompt 卡片内部 textarea 可能被 focus/input 监听误当成目标输入框；已增加扩展 UI 内事件忽略。
- 已部分解决：豆包 selector 已补当前真实 composer 特征；但用户现有 Chrome tab 未加载 Smart Prompt 内容脚本时，小人仍不会出现，需要重新加载扩展并刷新页面。
- 已解决：Prompt Card 视觉尺寸过大、遮挡输入区域的问题；当前 demo smoke 约 380x366，但真实站点仍需观察是否被站点自己的浮层或 composer 布局挤压。
- 已解决：Prompt Card 文案硬编码英文/中文混杂；当前 UI 与模板有 `zh-CN/en` 双语路径。
- 剩余风险：options/popup 页面只补了语言设置与 manifest i18n，尚未做完整静态页面全量文案国际化；后续若把设置页作为正式用户入口，应继续补齐。
# 当前风险 2026-06-08

- 已解决：Smart Prompt 桌面端 release exe 缺少 Windows GUI subsystem，导致双击桌面端时 Windows 额外打开黑色 Terminal/控制台窗口。当前 release 构建已验证为 `Windows GUI` subsystem。
- 已解决：桌面端启动本地 sidecar 时可能继承控制台窗口行为；当前 Windows 启动参数已加 `CREATE_NO_WINDOW`。
- 剩余注意：用户当前已安装的旧 exe/旧安装包不会自动改变，需要关闭旧进程后运行新构建的 exe，或重新安装新生成的 MSI/NSIS 安装包。
# 当前风险 2026-06-08

- V6 P3 已解决“byStrategy 只统计、不反哺生成”的问题：现在会生成隐私安全的 `promptStrategyPlan` 并进入 template/LLM 上下文。
- 仍需谨慎：当前策略选择是规则加聚合指标驱动，不是统计意义上的 A/B 胜出；不能宣称系统已经学会“自动优化所有提示词”，只能说它会根据本地采纳、重试、撤销和失败原因调整生成策略。
- 后续风险：`byStrategy` 样本量不足时可能过早偏向某个策略；下一步应加入最小样本阈值、冷启动探索比例和策略版本对照，避免早期偶然成功固化成默认策略。
# 当前风险 2026-06-08

- V6 P4 已解决一项关键风险：低样本高分策略不会直接覆盖默认策略；现在需要达到可靠样本阈值才会进入 `preserve_winning_strategy` exploitation。
- 仍需谨慎：当前 exploration 是策略规划和证据记录，不是完整随机化 A/B 实验；它能防止过早固化，并为后续真实对照收集元数据，但不能单独证明某策略真实优于另一策略。
- 下一步风险：如果真实使用中每个站点/工具样本很少，策略学习仍会长期停留在低置信度；后续需要做内测数据采集面板或诊断导出里的 byStrategy 分析视图。
# V6 P14 策略调权剩余风险 2026-06-08

- 已解决：pilot outcome winner/risk/collecting 只能出现在 readiness 报表里、不能影响下一次生成的问题。现在 `strategyWeightPolicy` 会进入 prompt strategy、template fallback、LLM messages、card、diagnostics 和 prompt history。
- 已解决：策略权重可能泄露正文的问题。P14 probe 使用 `SECRET_PROMPT_TEXT`、`SECRET_INPUT_TEXT`、`SECRET_PAGE_BODY`、`SECRET_URL_TOKEN`、`private/path` 哨兵，验证权重报告、权重文本、template 和 LLM context 均不泄露这些正文或完整路径。
- 仍需谨慎：`v6-strategy-weighting@1` 的权重来自聚合规则，不是统计显著性证明；样本量不足时必须保持 collecting/exploring，不能把单次成功策略固化成默认。
- 仍需真实内测：P14 证明代码链路能用 outcome 调权，但完整目标仍需要真实 ChatGPT/Claude/Gemini/Doubao/桌面工具等使用场景中的 outcomeSuccessRate、avgOutcomeScore、Retry/Undo 变化来证明 prompt 质量持续提升。
- 产品风险：如果用户很少点击 success/needs-work/failed，权重会长期停留在 collecting；后续需要更顺手的 outcome 采样入口或桌面端待补标列表，但仍不要默认采集 prompt 正文、用户输入、页面正文或完整 URL。
# V6 P15 质量提升验证剩余风险 2026-06-08

- 已解决：P14 只能证明 outcome 会改变下一次策略，不能证明策略改变是否提升质量。P15 增加 `v6-quality-lift@1`，可比较 baseline、strategy-guided、outcome-weighted 的 outcome 和交互指标。
- 已解决：strategy weight metadata 没有完整进入反馈事件，导致后续无法区分普通 strategy-guided 与 outcome-weighted。现在 feedback/metrics 会携带 `strategyWeightDecision` 和 `qualityLiftCohort`。
- 已解决：质量提升报告可能泄露失败样本正文或完整 URL 的风险。P15 probe 使用 `SECRET_PROMPT_TEXT`、`SECRET_INPUT_TEXT`、`SECRET_PAGE_BODY`、`SECRET_URL_TOKEN`、`private/path` 验证报告、模板和 LLM context 均不泄露。
- 仍需谨慎：`v6-quality-lift@1` 是聚合比较，不是统计显著性检验；样本不足时必须保持 `collecting`，不要把少量成功样本宣传为长期提升。
- 仍需真实内测：如果用户很少标注 success/needs-work/failed，outcome-weighted cohort 会长期样本不足；后续需要更顺手的 outcome 采样入口或桌面端待补标列表，但仍不能默认采集 prompt 正文、输入正文、页面正文或完整 URL。
# V6 P18 Quality Lift 分段归因剩余风险 2026-06-08

- 已解决：全局 `Quality Lift` 只能说明整体是否提升，无法解释具体是哪个工具、站点、任务场景或模式在变好/退化。现在 `Quality Segments` 能按 `tool/site/taskScenario/mode` 分段展示 improving、regressing、collecting。
- 已解决：分段归因可能泄露完整 URL 或样本文本的风险。当前报告只保留 host/token、cohort、计数、delta 和推荐 key；probe 使用 `SECRET_PROMPT_TEXT`、`SECRET_INPUT_TEXT`、`SECRET_PAGE_BODY`、`SECRET_URL_TOKEN` 和 `private/path` 验证不泄露。
- 仍需谨慎：`v6-quality-lift-segments@1` 是 aggregate 对比，不是统计显著性证明；样本不足时必须保持 collecting，不要把单个工具或场景的少量成功解释为长期质量提升。
- 仍需真实内测：下一阶段应继续收集 ChatGPT/Claude/Gemini/Doubao/Codex 等真实使用 outcome，观察各 segment 的 outcomeSuccessRate、avgOutcomeScore、Retry/Undo 变化是否稳定。
## V6 P19 Segment-aware 策略策略剩余风险 2026-06-08

- 已解决：P18 segment report 只能解释哪些工具/站点/场景/模式变好或变差，但不会影响下一次生成。现在 `qualityLiftSegmentPolicy` 会进入 `buildPromptStrategyPlan`，并影响真实 LLM/template/card/history/diagnostics。
- 已解决：全局 outcome-weight 可能掩盖局部退化 segment 的风险。现在匹配到 regressing segment 时，会添加 `avoid_regressing_segment`，并在非硬保护策略下把 selected strategy 压回 `baseline_structure` / `segment_regression_guardrail`。
- 已解决：改善 segment 可能被全局 collecting 或其它噪声稀释。现在匹配到 improving segment 时，会添加 `preserve_improving_segment` 并保留 outcome-weight guidance。
- 已解决：样本不足 segment 容易被过早解释成好/坏。现在 collecting segment 只触发 `collect_quality_lift_segment_samples` 和 balanced exploration，不会被宣传成质量提升。
- 隐私边界：segment policy 仍只允许 aggregate-only metadata，不要为了分析单个失败样本而默认采集 prompt 正文、用户输入正文、页面正文或完整 URL。
- 仍需真实内测：P19 证明了策略链路会被 segment evidence 影响，但完整目标还需要真实 ChatGPT/Claude/Gemini/Doubao/桌面工具等场景的 outcome 样本，观察 segment-level outcomeSuccessRate、avgOutcomeScore、Retry/Undo 是否长期稳定改善。
## V6 P20 失败原因策略剩余风险 2026-06-08

- 已解决：失败原因原来主要是插入失败的原始 reason 聚合，粒度不稳定，也可能混入过长或敏感文本。现在 raw reason 只用于瞬时归类，长期记录和诊断导出使用白名单短 token 与 aggregate-only policy。
- 已解决：failed/needs-work、retry/undo、insert failed 的原因以前不能直接影响下一次生成。现在 `failureReasonPolicy` 会进入 `buildPromptStrategyPlan`、template、LLM context、card、history 和 diagnostics。
- 仍需产品化：当前用户可见的补标入口仍主要是 success/needs-work/failed；若要让真实用户更准确提供失败原因，应在后续 UI 中加入短标签选择，例如“太长”“格式错”“缺上下文”“插入失败”，但仍不要默认采集 prompt 正文、用户输入正文、页面正文或完整 URL。
- 仍需真实内测：P20 证明了失败原因 token 能影响生成策略，但完整目标还需要真实 ChatGPT/Claude/Gemini/Doubao/桌面工具等场景积累 outcome 样本，观察 `wrong_format`、`missing_context`、`insert_failed` 等 token 对下一次采纳率、保存率、Retry/Undo 的改善是否稳定。
## V6 P21 剩余风险 2026-06-08

- 已解决：负向 outcome 只有三档结果、无法提供可行动失败原因的问题。现在浏览器扩展能收集 `wrong_format`、`missing_context`、`insert_failed` 等短 token，并让后续生成策略读取这些聚合原因。
- 已解决：成功 outcome 可能把 `manual_card_success` 归入 failure reason 的污染风险。现在成功样本不发送 `failureReasonToken`。
- 仍需真实内测：原因标签 UI 能提高反馈粒度，但完整目标仍需要真实使用样本证明这些 token 能稳定降低 Retry/Undo、提高 Save/Insert/outcome 分数。
- 仍需产品判断：当前原因标签是固定白名单，后续若要自学习新增原因，必须先走聚类、审查和白名单升级，不要直接把用户自由文本原因长期保存或注入 LLM。

## V6 P22 自学习闭环剩余风险 2026-06-08

- 已解决：长期能力缺少“反省/进化候选”机器产物的问题。现在系统会把聚合指标转成 `selfImprovementReport` 与 `evolutionCandidateReport`，并通过端点、诊断、生成上下文和 critic 暴露。
- 已解决：自动进化可能越权的问题。所有进化候选都强制 `manual_review_required`、`mutationAllowed:false`、`automaticPromotion:false`、`requiresCritic:true`，不会自动改代码、自动改默认策略或自动发送。
- 仍需谨慎：P22 证明的是聚合学习闭环可运行，不是统计意义上已经证明长期质量稳定提升；完整目标仍需要真实内测样本按工具/站点/场景持续观察 outcomeSuccessRate、avgOutcomeScore、Save/Retry/Undo 变化。
- 仍需产品化：桌面端目前可以通过 diagnostics JSON 看到学习报告，尚未做独立的 Learning 面板；后续若要让用户直接理解“系统学到了什么”，应增加可视化但仍保持 aggregate-only。
- 隐私边界：后续如果要支持“自学习新增失败原因/策略”，必须先聚类、审查、白名单升级，不要把用户自由文本原因、prompt 正文、输入正文、页面正文或完整 URL 直接长期保存或注入 LLM。
