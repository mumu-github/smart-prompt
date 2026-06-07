# 问题与风险

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
