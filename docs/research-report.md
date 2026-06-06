# 提示词自动化生成小工具研究报告

检索日期：2026-06-06。本文用于支撑一个 Windows/macOS 通用的输入框旁提示词助手产品方案。

## 结论摘要

可行，但不应做成“又一个提示词库”。市场上已经有提示词库、提示词优化器、AI 命令、prompt marketplace 和 agent skills 目录。本产品更有机会的定位是：**输入框旁的上下文感知 Prompt Copilot**。

核心差异化应落在四点：

- 自动识别用户正在 ChatGPT/Claude/Gemini/Perplexity/Cursor/Codex/Claude Code/Windsurf/Lovable/Bolt/v0 等环境里输入什么。
- 根据输入状态自动分成三种模式：空输入求思路、半成品续写、完整输入梳理优化。
- 把 prompts/skills 的选择从“用户记得去找”变成“工具在输入框旁提醒和推荐”。
- 最后一步是一键填入，而不是只给用户复制一段内容。

## 用户痛点证据

### 1. 不知道怎么写提示词

社区里反复出现“提示词不是随便写一句话”的讨论。Reddit 上有用户把 system prompt 写作类比为需要练习和评估的技能，并指出 ambiguity、边界条件和评价方式都很难处理：[Writing system prompts is weirdly hard](https://www.reddit.com/r/ChatGPT/comments/1shauup/writing_system_prompts_is_weirdly_hard_would/)。

OpenAI 的官方 prompting 基础教程也把 prompt engineering 定义为“设计和打磨输入以得到更好回答”的过程，并强调明确任务、背景、受众和目标：[OpenAI Prompting fundamentals](https://openai.com/academy/prompting/)；OpenAI API 最佳实践进一步强调清晰指令、分隔上下文、指定格式和减少模糊词：[OpenAI prompt engineering best practices](https://help.openai.com/en/articles/6654000-how-to-prompt-chatgpt)。

这说明“不会写提示词”不是纯新手问题，而是一个需要结构化指导的通用问题。

### 2. 有逻辑但没有清晰提示习惯

Reddit 上有讨论把普通 prompt 和产品/系统里的 dynamic pipeline 区分开：真实 prompt engineering 往往需要把变量、规则、历史上下文、工具和业务状态动态组装，而不是一次性写长段话：[What actually is Prompt Engineering?](https://www.reddit.com/r/artificial/comments/1tt03d8/what_actually_is_prompt_engineering/)。

Hacker News 的 Ask HN 讨论也反映了另一个问题：prompt 资源太多，难以测试和沉淀，尤其是编程场景下想要减少幻觉时：[Ask HN: GPT prompt crafters](https://news.ycombinator.com/item?id=36097380)。

推论：用户真正缺的不是“更多模板”，而是把已有想法变成结构化输入的习惯化流程。

### 3. 缺少好的 skills 和快捷操作路径

vibe coding 社区已有明确观点：AI coding 不能总从头解释项目结构、API 风格、认证、部署和生产标准；下一步应该是 reusable skills，而不是一次性 prompts：[Vibe coding needs skills, not just prompts](https://www.reddit.com/r/vibecoding/comments/1ttscim/vibe_coding_needs_skills_not_just_prompts/)。

Anthropic 的 Claude Code skills 文档也说明 skills 的价值在于把重复粘贴的指令、清单或多步骤流程封装成 `SKILL.md`，按需加载，减少上下文浪费：[Extend Claude with skills](https://code.claude.com/docs/en/skills)。OpenAI Help Center 对 Skills 的说明同样强调 reusable/shareable workflows，且可包含 instructions、examples 和 code，并可在有帮助时自动使用：[OpenAI Skills in ChatGPT](https://help.openai.com/en/articles/20001066-skills-in-chatgpt)。

推论：本产品应把“提示词优化”和“skill 推荐/调用提醒”合并，否则会停留在旧一代 prompt library 形态。

### 4. 有好 prompts/skills 但忘记使用

Reddit 上有用户抱怨 `CLAUDE.md` 已经写了完整流程，但长 session 中仍会忘记或偏离：[My CLAUDE.md spells out the workflow. Claude Code still forgets it](https://www.reddit.com/r/ClaudeCode/comments/1th0ngx/my_claudemd_spells_out_the_workflow_claude_code/)。

另一个社区讨论描述了多工具环境里的 `CLAUDE.md`、`AGENTS.md`、`.cursorrules`、随机 markdown prompt 文件管理混乱：重复、冲突、跨项目复制、忘记哪个版本有效：[Managing CLAUDE.md / AGENTS.md / .cursorrules](https://www.reddit.com/r/ClaudeAI/comments/1rq1o1p/is_anyone_else_struggling_to_manage_claudemd/)。

还有用户指出，即使把 context 文件、风格指南、规则文件准备好，仍然要记得在正确时间附上或调用：[Everyone's Obsessed with Prompts. But Prompts Are Step 2](https://www.reddit.com/r/ClaudeAI/comments/1nbkhxv/everyones_obsessed_with_prompts_but_prompts_are/)。

推论：浮在输入框旁的小人入口有真实价值，前提是它不是装饰，而是“提醒该用哪个模式/skill”的低干扰触发器。

## 市场信号

Product Hunt 上已有多个产品验证了 prompt library、快捷调用、优化和浏览器内应用的需求：

- [Prompt Library](https://www.producthunt.com/products/prompt-library)：Mac 快捷键打开 prompt 库并插入任意 app。
- [PromptPaste](https://www.producthunt.com/products/promptpaste)：Mac/iPhone/iPad 私有 prompt 库，强调 menu bar 快捷访问和本地隐私。
- [Promptacore](https://www.producthunt.com/products/promptacore)：浏览器内创建、管理、优化并应用 prompts。
- [PromptCraft](https://www.producthunt.com/products/promptcraft-2)：把模糊 idea 转成 v0、Lovable、Bolt 等 AI 构建工具可用 prompts。
- [PromptForge](https://test-webhooks.producthunt.com/products/promptforge?comment=2986536)：在 ChatGPT/Bard/Claude 内加载 one-click prompts。

这些产品证明需求存在，但也说明竞争拥挤。我们的机会不是“本地 prompt 库”本身，而是更贴近用户输入瞬间的：识别环境、识别输入成熟度、推荐 skill、填回原输入框。

## 技术可行性

### 网页 LLM 输入框

Chrome extension 的 content scripts 可以读取和修改页面 DOM，并通过 `chrome.scripting` 动态注入；但需要 host permissions：[Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts?authuser=1)、[chrome.scripting API](https://developer.chrome.com/docs/extensions/reference/scripting/)。

可行路径：

- 针对主流站点维护 selector/role/ARIA 规则。
- 用 MutationObserver 监测 SPA 输入框变化。
- 对 `textarea`、`input`、`contenteditable` 做统一抽象。
- 通过 DOM value/input event 插入，失败时回退剪贴板。

### 桌面输入框

Windows 可用 Microsoft UI Automation 读取 UI 树并对控件发送输入；官方文档说明 UI Automation 是 Windows accessibility framework，client API 可获取 UI 信息并向控件发送输入：[Microsoft UI Automation Overview](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-uiautomationoverview)。

macOS 可用 AXUIElement 与 Accessibility API 读取和控制可访问应用；Apple 文档说明 assistive apps 可通过 AXUIElement 与可访问应用通信和控制：[Apple AXUIElement](https://developer.apple.com/documentation/applicationservices/axuielement_h?changes=_10&language=objc)。

限制：

- 需要用户授权 Accessibility/Input Monitoring。
- Electron、canvas、自绘控件、WebGL、终端和某些 IDE 可能暴露不完整 accessibility tree。
- 一键填入应采用分层策略：DOM 插入优先，accessibility set value 次之，剪贴板粘贴兜底，并保留用户确认。

### 跨平台壳与悬浮入口

Tauri 和 Electron 都可作为桌面壳。Tauri v2 有 global shortcut 插件，且支持 Windows/macOS/Linux：[Tauri global shortcut](https://v2.tauri.app/plugin/global-shortcut/)。Electron 的 BrowserWindow 支持 always-on-top、frameless 等悬浮窗口能力：[Electron BrowserWindow](https://www.electronjs.org/docs/api/browser-window)。

建议 MVP 使用 Tauri 或 Electron + 浏览器扩展双通道：

- 浏览器扩展：优先覆盖网页 LLM/Agent 输入框，识别更可靠。
- 桌面 app：负责悬浮小人、全局快捷键、prompt/skill 库、本地设置、跨平台权限。
- 桌面 app 与扩展通过本地 native messaging 或本地服务通信。

### 图像与动画资产

OpenAI 图像 API 官方文档说明 Image API 可从文本生成或编辑图像，并支持 GPT Image 系列模型：[OpenAI Image generation guide](https://platform.openai.com/docs/guides/image-generation?lang=curl)。本次检索看到官方文档公开列出的 GPT Image 模型与第三方页面对 `gpt-image-2` 的描述不完全一致，因此产品实现应把模型 ID 配置化：首选用户指定的 `gpt-image-2`，不可用时回退到官方可用 GPT Image 模型。

Remotion 官方定位是用 React 生成真实 MP4/WebM/GIF 等视频，适合参数化轻量动画：[Remotion](https://www.remotion.dev/)。

## 推荐 MVP

P0 先做“网页 + 局部桌面”的可验证版本：

- 覆盖 ChatGPT、Claude、Gemini、Perplexity、Cursor web/AI chat、Lovable、Bolt、v0 等网页输入框。
- 输入框旁显示低干扰小人按钮。
- 自动判断三种状态：空、半成品、完整。
- 输出一张 prompt card：目标、上下文、约束、输出格式、下一步问题。
- 支持刷新、编辑、复制、一键填入。
- 本地保存用户常用 prompts/skills，并按环境推荐。

P1 再扩展：

- Windows/macOS accessibility 识别和输入。
- 针对 Cursor、Codex、Claude Code、Windsurf 的 agent workflow 模板。
- skill 自动推荐：从本地 `AGENTS.md`、`CLAUDE.md`、`SKILL.md`、`.cursorrules` 或用户导入库中匹配。

P2 再考虑：

- 团队 prompt/skill 库同步。
- prompt 质量评分和小型 eval。
- 生成多动作小人 sprite/Remotion 动画。
- 结合 Promptfoo/DSPy 做自动评估和优化闭环。

## 风险

- 权限风险：桌面输入框识别和填入需要高权限，必须明确展示权限用途。
- 隐私风险：输入框内容可能包含代码、API key、合同、个人数据。默认应本地判断状态，上传前让用户确认。
- 可靠性风险：任意输入框识别不可能 100% 覆盖，应从站点/应用 allowlist 开始。
- 体验风险：悬浮小人如果过度活跃，会变成干扰。默认应安静，只在输入框聚焦且用户暂停时轻提示。
- 成本风险：图像和 LLM 生成会产生成本。MVP 可先用静态小人 + CSS/Lottie/Remotion 轻动画，动作资产按需生成。

## 最终可行性判断

值得做 MVP。痛点真实、竞品验证需求、技术路径存在，但市场拥挤。产品成败取决于是否能把“提示词库/优化器”推进到“输入瞬间的上下文感知助手”。第一版不要追求全平台全输入框，而要在少数高频 AI 输入环境里做到明显省心。
