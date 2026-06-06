# PRD：跨平台提示词自动化生成小工具

版本：v0.1  
日期：2026-06-06  
状态：研究支撑版草案

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

- 高频使用 Cursor、Codex、Claude Code、Windsurf、Lovable、Bolt、v0、Replit 等 vibe coding/AI 构建工具的人。
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

### P0 必做

- 浏览器扩展识别主流网页 LLM/Agent 输入框。
- 桌面小工具提供悬浮小人、全局快捷键、本地设置。
- 三种模式自动判断：空输入、半成品、完整输入。
- 生成 prompt card，支持刷新、编辑、复制、一键填入。
- 本地 prompt/skill 库：用户可导入 Markdown、`SKILL.md`、`AGENTS.md`、`CLAUDE.md`、`.cursorrules`。
- 简单 skill 推荐：关键词 + 工具环境 + 用户历史选择。
- 小人静态状态图：待机、思考、建议、成功、错误。

### P1

- Windows UI Automation 与 macOS AXUIElement 桌面输入框识别。
- skill embedding 匹配。
- 针对 Cursor/Codex/Claude Code/Windsurf 的专用 prompt 模板。
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
- 对 ChatGPT、Claude、Gemini、Perplexity、Lovable、Bolt、v0 维护站点适配器。
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

### 7.7 图像与动画

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
- Local Service：负责本地库、skill 扫描、设置、LLM gateway。
- Context Detector：输入框识别、状态判断、站点/app 画像。
- Prompt Orchestrator：生成最终 prompt 请求。
- Fill Engine：浏览器 DOM、UIA、AXUIElement、剪贴板 fallback。
- Asset Pipeline：GPT Image 系列 + Remotion。

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
10. 用户确认后自行发送。

## 13. 成功指标

- 激活率：安装后 24 小时内至少使用一次 >= 50%。
- 填入率：生成 card 后点击填入 >= 45%。
- 保留率：7 日留存 >= 25%。
- 节省感：用户自评“比自己写更快” >= 70%。
- skill 触发：导入 skill 的用户中，每周至少一次 skill 推荐被采用 >= 30%。
- 安全：无默认自动发送；权限相关投诉率 < 3%。

## 14. 里程碑

### M0：研究与设计

- 完成研究报告、竞品分析、开源实现分析、PRD、UI/UX 概念图。

### M1：浏览器 MVP

- Chrome/Edge 扩展。
- 覆盖 5 个网页 LLM/Agent 输入框。
- 三模式 prompt card。
- 一键填入。

### M2：桌面壳

- Tauri/Electron 悬浮小人。
- 全局快捷键。
- 本地 prompt/skill 库。

### M3：桌面输入框

- Windows UIA 与 macOS AX 初步支持。
- Cursor/Codex/Claude Code/Windsurf 专用模板。

### M4：评估与团队

- prompt 版本和反馈。
- 小型 eval。
- 团队库/共享。

## 15. 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 任意输入框识别不稳定 | 用户体验差 | P0 只承诺 allowlist 网页，未知场景提示降级 |
| 权限吓人 | 用户不敢安装 | 分阶段授权，解释用途，浏览器 MVP 可先不要求桌面高权限 |
| prompt 生成泛泛而谈 | 产品价值弱 | 使用三模式模板 + skill 匹配 + 用户反馈调优 |
| 小人过度干扰 | 用户关闭 | 默认安静、可调触发条件、支持站点级关闭 |
| 第三方 skill 安全风险 | 供应链问题 | 默认文本只读、风险标记、执行脚本需显式授权 |
| 竞品快速跟进 | 差异化变弱 | 把环境识别、skill routing 和填入路径做成核心能力 |

## 16. 开放问题

- 用户是否会提供小人原型图；若没有，第一版使用概念小人。
- `gpt-image-2` 在用户实际 API 环境中的可用性需要实测。
- 桌面版本优先 Tauri 还是 Electron，需要用悬浮窗和 accessibility POC 验证。
- 是否允许团队同步 prompts/skills，需要后续商业模式判断。
