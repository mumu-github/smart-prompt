# PRD：跨平台提示词自动化生成小工具

版本：v0.2 beta
日期：2026-06-07
状态：Beta 发布与真实内测闭环版

## 0. 当前 Beta 状态

v0.2 beta 的目标是从“研究支撑原型”推进到“可安装、可配置、可诊断、可内测”的版本。当前已完成浏览器扩展、本地服务、Tauri 桌面壳、native sidecar、真实 LLM/provider 接入、安装包与 V5 验收证据；M3 已进入 Windows UIA/source-dev 竖切验证阶段，下一阶段重点是真实内测数据闭环、桌面输入框实机写回和更多工具适配。

### 已完成证据

- Beta 版本：`v0.2.0-beta.1`。
- Release notes：`docs/releases/v0.2.0-beta.1.md`。
- Release manifest：`research/v5-beta-manifest.latest.json`，当前 `pass:true`、`releaseReady:true`。
- 安装包：`apps/desktop-shell/src-tauri/target/release/bundle/msi/Smart Prompt_0.2.0_x64_en-US.msi` 与 `apps/desktop-shell/src-tauri/target/release/bundle/nsis/Smart Prompt_0.2.0_x64-setup.exe`。
- Checksum：`research/v5-beta-checksums.sha256`。
- Native sidecar：`apps/local-service-sidecar/`。
- V5 critic：`scripts/critic-v5.ps1` 已通过。
- Git tag：`v0.2.0-beta.1` 已推送到 GitHub private repo。
- GitHub Release：`https://github.com/mumu-github/smart-prompt/releases/tag/v0.2.0-beta.1`，已上传 MSI、NSIS exe 和 checksum assets。

### 下一阶段收口

- 收集真实内测指标：Insert 成功率、保存率、Undo/Retry 使用情况、失败站点原因。
- 补 workBuddy、Trae、Doubao、DeepSeek 等新网页站点适配。
- 继续补 Codex、Claude Code、Hermes 等桌面/CLI 工具画像与 M3 桌面输入框识别方案；当前 Windows UIA self-test 与 native sidecar snapshot 已通过，macOS AX 和真实桌面写回仍待完成。

## 1. 背景

很多 vibe coding 与 LLM/Agent 用户在输入阶段遇到四类问题：不会写提示词、有想法但缺少提示习惯、知道要优化但缺少 skills 与快捷路径、有好 skills 却忘记使用。现有市场已有 prompt library、prompt optimizer、prompt marketplace、AI command palette 和 agent skills registry，但多数要求用户主动搜索、复制、粘贴和记忆。

本产品要做的是一个 Windows/macOS 通用的小工具，在 AI 输入框旁提供上下文感知的 prompt/skill 助手。

关键来源包括：[OpenAI prompting fundamentals](https://openai.com/academy/prompting/)、[Claude Code skills](https://code.claude.com/docs/en/skills)、[Prompt Library Product Hunt](https://www.producthunt.com/products/prompt-library)、[PromptCraft Product Hunt](https://www.producthunt.com/products/promptcraft-2)、[Vibe coding needs skills](https://www.reddit.com/r/vibecoding/comments/1ttscim/vibe_coding_needs_skills_not_just_prompts/)。

## 2. 产品定位

一句话：**输入框旁的 Prompt Copilot，把模糊想法、半成品提示词和完整输入自动转成适合当前 AI 工具的高质量 prompt，并提醒用户使用相关 skills。**

不是：

- 不是单纯 prompt 库。
- 不是 prompt marketplace。
- 不是完整 OS-level AI copilot。
- 不是自动替用户发送消息的机器人。

## 3. 目标用户

### 核心用户

- 高频使用 Cursor、Codex、Claude Code、Windsurf、Lovable、Bolt、v0、Replit、workBuddy、Trae、Doubao、DeepSeek、Hermes 等 vibe coding/AI 构建工具的人。
- 高频使用 ChatGPT、Claude、Gemini、Perplexity 等网页 LLM 的产品、运营、设计、研发用户。

### 次级用户

- 已经沉淀 prompts/skills，但散落在 Notion、Notes、Markdown、AGENTS.md、CLAUDE.md、.cursorrules 中的用户。
- 团队内希望统一 prompt/skill 标准但暂时不想引入复杂平台的人。

## 4. 用户痛点

- 不知道怎么写提示词：需要从“空白输入框”获得提问思路。
- 有自己的逻辑但不清晰：需要把半成品想法补成完整结构。
- 知道要优化但缺少路径：需要低成本变成可发送 prompt。
- 有好 skills 但忘记用：需要输入时提醒，而不是事后搜索。
- 多工具 prompt 文件混乱：`CLAUDE.md`、`AGENTS.md`、`.cursorrules`、`SKILL.md` 之间重复、冲突和版本不明。

## 5. 用户故事

- 作为新手用户，我在 ChatGPT 输入框还没写内容时，点击小人就能得到 3 个可选提示词思路。
- 作为 vibe coding 用户，我写了半句“帮我做一个 CRM 后台”，小人能自动补齐目标、页面、数据、权限、验收标准。
- 作为熟练用户，我贴了一段完整需求，小人能帮我重排成适合 Codex/Claude Code 的执行 prompt。
- 作为有 skills 的用户，我在写“重构登录模块”时，工具能提醒我使用 code-review、security-review、test-plan 等相关 skills。
- 作为隐私敏感用户，我希望默认本地判断，只在我确认后才把输入内容发送给模型。

## 6. MVP 范围

### v0.2 beta 已完成

- 浏览器扩展已覆盖 ChatGPT、Claude、Gemini、Perplexity、Lovable、Bolt、v0、Replit 的 P0 allowlist，并保留未知网页输入框兜底检测。
- 三模式 prompt card 已接入真实 LLM：Idea、Continue、Polish 都可通过 provider gateway 生成。
- Local Service 已支持 prompt/skill 库、provider 设置、API key 状态、诊断导出、指标接口和删除全部本地数据。
- Tauri 桌面壳已支持设置页、本地服务控制、托盘、全局快捷键、provider key 配置、skill 管理和诊断 UX。
- 发布版 sidecar 已从“Node + JS resources”升级为 Rust native executable，并具备崩溃重启和端口占用恢复。
- Beta 安装包、checksum、release notes 和验收 manifest 已生成。

### P0 必做

- 浏览器扩展识别主流网页 LLM/Agent 输入框。
- 桌面小工具提供悬浮小人、全局快捷键、本地设置。
- 三种模式自动判断：空输入、半成品、完整输入。
- 生成 prompt card，支持刷新、编辑、复制、一键填入。
- 本地 prompt/skill 库：用户可导入 Markdown、`SKILL.md`、`AGENTS.md`、`CLAUDE.md`、`.cursorrules`。
- 简单 skill 推荐：关键词 + 工具环境 + 用户历史选择。
- 小人静态状态图：待机、思考、建议、成功、错误。
- 内测指标：Insert 成功率、保存率、Undo/Retry 使用情况、失败站点原因。

### P1

- Windows UI Automation 与 macOS AXUIElement 桌面输入框识别。
- skill embedding 匹配。
- 针对 Cursor/Codex/Claude Code/Windsurf/Hermes 的专用 prompt 模板。
- prompt 版本历史与收藏。
- Remotion 轻量动画：呼吸、挥手、思考、填入成功。

### P2

- 团队库同步。
- Promptfoo/DSPy 小型评估闭环。
- 多模型 prompt 输出对比。
- 外部 SkillHub/ClawHub/skills-hub 导入与安全校验。

## 7. 功能需求

### 7.1 输入环境识别

- 识别当前浏览器 tab host、页面标题、输入框类型和位置。
- 正式 allowlist：ChatGPT、Claude、Gemini、Perplexity、Lovable、Bolt、v0、Replit。
- Beta 扩展 allowlist：workBuddy、Trae、Doubao、DeepSeek；进入真实内测后按失败原因调整 selector 和写入策略。
- 桌面/CLI 工具画像：Codex、Claude Code、Hermes；M3 通过 Windows UIA/macOS AX 接入真实输入框。
- 对未知网页回退通用 `textarea/input/contenteditable/role=textbox` 检测。
- 在桌面 app 中记录当前前台应用名称和窗口标题。

### 7.2 三模式判断

- Idea Mode：输入为空或只有极短关键词。
- Continue Mode：输入有想法但缺少结构，例如没有目标/约束/输出格式。
- Polish Mode：输入已成段，包含任务、背景和要求，需要重排优化。

### 7.3 悬浮小人入口

- 默认贴近输入框右下或右侧，不遮挡输入内容。
- 状态：安静待机、可帮助、生成中、已生成、错误。
- 支持点击、快捷键和右键菜单。
- 支持关闭当前站点/当前 app/全局关闭。

### 7.4 Prompt Card

每次点击生成一个卡片：

- 模式标签：求思路 / 续写 / 优化。
- 推荐 prompt。
- 推荐使用的 skill 或模板。
- 说明本次使用了哪些上下文。
- 操作：刷新、编辑、复制、填入、收藏。

### 7.5 Skill 推荐

- 扫描用户导入的 `SKILL.md` frontmatter name/description。
- 支持导入 `AGENTS.md`、`CLAUDE.md`、`.cursorrules` 作为规则型资料。
- 根据当前工具、输入关键词和历史选择推荐 1-3 个候选。
- 默认只展示和引用，不自动执行第三方脚本。

### 7.6 一键填入

- 浏览器：DOM 写入 + 触发 input/change 事件。
- 桌面：accessibility set value；失败时剪贴板粘贴兜底。
- 填入后不自动发送，用户保留最终确认权。
- 记录隐私安全的填入结果：adapter、写入策略、是否通过回读校验、失败原因；不记录完整 prompt 正文、整页内容或用户账号信息。

### 7.7 真实 LLM 与 provider

- 支持 OpenAI-compatible、Anthropic、Gemini 三类 provider。
- 支持用户自带 API key；桌面壳只展示 key 是否配置，不在 UI 中回显密钥。
- OpenAI-compatible 可配置 base URL 与 model，用于 Agnes、小米或其他兼容接口。
- provider gateway 必须支持 Idea、Continue、Polish 三模式。
- 未配置 key 时保留 dry-run/local-template 降级，不伪装成真实 LLM 通过。

### 7.8 图像与动画

- 小人形象：如果用户提供原型图，按原型生成；未提供时使用“友好、轻量、像桌面助手的提示词小人”概念。
- 生成动作：待机、思考、展示建议、填入成功、错误提醒。
- 图像模型：模型 ID 配置化，优先使用用户要求的 `gpt-image-2`；若当前官方 API 不可用，则回退到可用 GPT Image 模型并记录。
- 动画：Remotion 生成短循环 MP4/WebM/GIF 或 Lottie-like 轻资产。

## 8. 非功能需求

- 低干扰：小人默认不弹大窗，不自动打断输入。
- 低延迟：本地状态判断 < 100ms；生成首 token/首卡片目标 < 3s。
- 隐私优先：默认不上传整页、整屏、整文件。
- 可解释：卡片展示“基于当前输入 + 当前工具 + 选中 skill”。
- 可回滚：填入前保留原文本，支持撤销。
- 跨平台：Windows 10/11、macOS 13+。

## 9. 技术方案

### 推荐架构

- Desktop Shell：Tauri 优先，Electron 备选。
- Browser Extension：Chrome/Edge MV3，后续适配 Firefox/Safari。
- Local Service：负责本地库、skill 扫描、设置、LLM gateway、metrics、diagnostics。
- Native Sidecar：发布版使用 Rust executable 承载本地服务能力，负责启动恢复、端口占用恢复、健康检查和诊断出口。
- Context Detector：输入框识别、状态判断、站点/app 画像。
- Prompt Orchestrator：生成最终 prompt 请求。
- Fill Engine：浏览器 DOM、UIA、AXUIElement、剪贴板 fallback。
- Asset Pipeline：GPT Image 系列 + Remotion。

### v0.2 beta 运行链路

1. 浏览器扩展在网页输入框旁注入小人和 prompt card。
2. 扩展只读取当前聚焦输入框文本和必要 host/title 信息。
3. 扩展通过本地服务调用 provider gateway 生成三模式 prompt。
4. 用户点击 Insert 后，扩展写回输入框并做回读校验。
5. 扩展记录 privacy-safe feedback event，用于统计 Insert、Save、Undo、Retry。
6. 桌面壳通过 native sidecar 启停本地服务，并提供 key、skill、诊断、清空数据 UX。

### 发布与诊断

- 安装包需包含桌面壳、native sidecar、必要资源和版本信息。
- 诊断导出应包含 provider 配置状态、sidecar 健康状态、端口、版本、最近错误摘要和 metrics summary。
- 删除全部本地数据必须清理 prompts、skills、settings、metrics 和非敏感缓存；provider key 清理由 key 管理 UX 单独确认。
- key 迁移 UX 应提示旧设置中是否存在明文 key，并引导迁入 provider key 存储。

### 技术来源

- Chrome content scripts 可读取和修改 DOM：[Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts?authuser=1)。
- Tauri 支持跨平台 global shortcut：[Tauri global shortcut](https://v2.tauri.app/plugin/global-shortcut/)。
- Windows UI Automation 可获取 UI 信息并发送输入：[Microsoft UI Automation](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-uiautomationoverview)。
- macOS AXUIElement 可与可访问应用通信和控制：[Apple AXUIElement](https://developer.apple.com/documentation/applicationservices/axuielement_h?changes=_10&language=objc)。
- Remotion 可用 React 生成真实视频：[Remotion](https://www.remotion.dev/)。

## 10. 隐私与安全

- 默认只读取当前聚焦输入框，不读取整页隐私内容。
- 上传给 LLM 前弹出“将发送的内容摘要”。
- 支持本地模型或用户自带 API key。
- 对第三方 skills 做来源、版本、权限和风险标记。
- 第三方 skills 默认不可执行脚本，只可作为文本建议。
- 剪贴板填入需要提示用户，避免覆盖敏感剪贴板内容。
- 不自动按 Enter，不自动提交表单。

## 11. 数据结构

### PromptAsset

- id
- title
- body
- tags
- target_tools
- mode
- source
- version
- last_used_at
- success_feedback

### SkillAsset

- id
- name
- description
- body_path
- source_type
- source_url
- allowed_tools
- risk_level
- last_matched_at

### ContextSnapshot

- app_or_host
- page_title_or_window_title
- input_kind
- input_text_sample
- selection_range
- mode_guess
- timestamp

### PilotMetric

- id
- action：`card_ready` / `insert` / `save` / `undo` / `retry` / `copy`
- mode：Idea / Continue / Polish
- tool
- adapter_id
- insert_strategy
- ok
- adopted
- verified
- failure_reason
- prompt_length
- timestamp

## 12. 关键交互流程

1. 用户聚焦 AI 输入框。
2. 小人以低透明度出现在输入框旁。
3. 用户点击或按快捷键。
4. 工具读取当前输入框文本和环境。
5. 判断模式并匹配 skills。
6. 生成 prompt card。
7. 用户刷新/编辑。
8. 用户点击填入。
9. 工具写回输入框但不自动发送。
10. 工具记录填入校验结果和失败原因。
11. 用户确认后自行发送。

## 13. 成功指标

### v0.2 beta 内测指标

- Insert 成功率：`verified insert / insert attempts`，按 adapter、provider、mode 分组。
- 保存率：`save / card_ready`，用于判断生成内容是否值得沉淀。
- Undo 使用率：`undo / insert attempts`，用于识别误填或不满意场景。
- Retry 使用率：`retry / card_ready`，用于识别生成质量不足或模式判断错误。
- 失败站点原因：至少记录 selector 未命中、写入失败、回读校验失败、权限/登录态、站点改版、provider 失败。
- Prompt 采用率：生成 card 后 `insert` 或 `save` 任一发生的比例。
- 安全边界：无自动发送事件；无默认上传整页内容。

### 长期产品指标

- 激活率：安装后 24 小时内至少使用一次 >= 50%。
- 填入率：生成 card 后点击填入 >= 45%。
- 保留率：7 日留存 >= 25%。
- 节省感：用户自评“比自己写更快” >= 70%。
- skill 触发：导入 skill 的用户中，每周至少一次 skill 推荐被采用 >= 30%。
- 安全：无默认自动发送；权限相关投诉率 < 3%。

## 14. 里程碑

### M0：研究与设计

- 状态：已完成。
- 产出：研究报告、竞品分析、开源实现分析、PRD、UI/UX 概念图、小人状态图方向。

### M1：浏览器 MVP

- 状态：已完成 beta baseline。
- 产出：Chrome/Edge MV3 扩展、8 站正式 allowlist、三模式 prompt card、一键填入、Insert 回读校验、反馈事件。

### M2：桌面壳

- 状态：已完成 v0.2 beta。
- 产出：Tauri 桌面壳、托盘、全局快捷键、设置页、本地 prompt/skill 库、provider key 配置、native sidecar、安装包、checksum、诊断导出。

### M3：桌面输入框

- 状态：进行中。
- 已完成：Windows UIA self-test、开发路径 `GET /desktop/input-snapshot`、native sidecar `GET /desktop/input-snapshot`、Codex/Claude Code/Hermes 首批工具画像与隐私脱敏报告。
- 待完成：安装包内 native sidecar 重新打包复验、macOS AX 初步支持、Codex/Claude Code/Hermes 真实桌面输入框写回、剪贴板 fallback 的安全提示。
- 范围：Windows UIA 与 macOS AX 初步支持；Codex、Claude Code、Hermes、Cursor、Windsurf 专用工具画像和 prompt 模板；剪贴板 fallback 的安全提示。

### M4：评估与团队

- 状态：后续。
- 范围：prompt 版本和反馈、小型 eval、团队库/共享、跨设备同步和更完整的 skill 安全策略。

### M5：Beta 发布与真实内测闭环

- 状态：发布包、Release 页面与基础证据已完成，真实用户数据待收集。
- 已完成：V5 release notes、checksum、installer artifact、native sidecar、GitHub Release assets、release-ready manifest、V5 critic。
- 待完成：真实内测 Insert/Save/Undo/Retry 数据、失败站点 adapter 修复记录。

## 15. 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 任意输入框识别不稳定 | 用户体验差 | P0 只承诺 allowlist 网页，未知场景提示降级 |
| 权限吓人 | 用户不敢安装 | 分阶段授权，解释用途，浏览器 MVP 可先不要求桌面高权限 |
| prompt 生成泛泛而谈 | 产品价值弱 | 使用三模式模板 + skill 匹配 + 用户反馈调优 |
| 小人过度干扰 | 用户关闭 | 默认安静、可调触发条件、支持站点级关闭 |
| 第三方 skill 安全风险 | 供应链问题 | 默认文本只读、风险标记、执行脚本需显式授权 |
| 竞品快速跟进 | 差异化变弱 | 把环境识别、skill routing 和填入路径做成核心能力 |
| 新增站点改版频繁 | Insert 失败率上升 | 用 adapter 级 metrics 记录失败原因，优先修复高频失败 selector |
| provider key 配置失败 | 三模式无法调用真实 LLM | 设置页明确 key 状态，保留 dry-run 降级但不计入真实 LLM 验收 |
| 桌面输入框权限复杂 | M3 验收延迟 | 先做 Windows UIA/macOS AX POC，再按工具画像逐个收敛 |
| 发布资产分发不完整 | 内测用户安装成本高 | GitHub Release 上传 MSI/NSIS/checksum，并在 release notes 写清安装与诊断方式 |

## 16. 开放问题

- workBuddy、Trae、Doubao、DeepSeek 的真实输入框 selector 需要通过内测验证，不能只靠静态假设。
- Codex、Claude Code、Hermes 已进入 M3 首批桌面/CLI 工具画像；仍需真实桌面输入框写回和 macOS AX 验收。
- `gpt-image-2` 在用户实际 API 环境中的可用性仍受 billing/key 限制；项目内小人资产已可先用内置 image_gen 版本推进 UI。
- 是否允许团队同步 prompts/skills，需要后续商业模式判断。
