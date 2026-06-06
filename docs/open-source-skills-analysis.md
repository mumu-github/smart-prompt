# GitHub / SkillHub / ClawHub 实现方式分析

检索日期：2026-06-06。本文关注可复用实现方式，而不是只列项目名称。

## 代表项目与实现方式

### linshenkx/prompt-optimizer

来源：[GitHub - linshenkx/prompt-optimizer](https://github.com/linshenkx/prompt-optimizer)、[GitHub prompt-optimizer topic](https://github.com/topics/prompt-optimizer)。

实现要点：

- 支持 web app、desktop app、Chrome extension、Docker 多种部署形态。
- 从手写、模板、本地导入或 Prompt Garden 等来源开始，再做优化、测试、评估、保存。
- TypeScript 前端/应用形态，适合验证 prompt optimizer 的 UI 结构和多端打包路线。

可复用：

- “原 prompt / 优化 prompt / 测试结果 / 保存为资产”的工作流。
- 多模型、多模板优化策略。
- Chrome extension + desktop app 并行路线。

不建议照搬：

- 它以“优化已有 prompt”为核心，不解决输入框环境识别和三状态模式判断。

### prompts.chat / Awesome ChatGPT Prompts

来源：[GitHub - f/prompts.chat](https://github.com/f/prompts.chat)、[prompts.chat](https://prompts.chat/)。

实现要点：

- 大型开源 prompt library，可浏览、贡献、自托管。
- 支持 CSV/Markdown/Hugging Face dataset 等多种数据格式。
- 自托管流程可配置品牌、认证和功能。

可复用：

- prompt 条目的结构化存储：标题、角色、正文、类别、标签、来源、版本。
- 自托管/团队私有库思路。

不建议照搬：

- 大库会增加选择成本；本产品应只在输入场景中召回少量高相关 prompt/skill。

### promptfoo

来源：[GitHub - promptfoo/promptfoo](https://github.com/promptfoo/promptfoo)、[promptfoo organization](https://github.com/promptfoo)。

实现要点：

- CLI/library，用于测试 prompts、agents、RAG，支持模型比较、自动 eval、red teaming、CI/CD。
- MIT 开源，支持本地运行，强调数据驱动而不是凭感觉改 prompt。

可复用：

- P2 版本可把 prompt 质量从“LLM 自评”升级到小型测试集和断言。
- 对高价值 prompt/skill 建议做 regression eval。

不建议 P0 使用：

- 配置成本较高，不适合第一版面向普通用户的轻量输入框助手。

### Latitude

来源：[Latitude Docs](https://docs.latitude.so/)、[Latitude GitHub](https://github.com/latitude-dev/latitude-llm)。

实现要点：

- 开源 prompt engineering/deployment/evaluation 平台。
- 支持 prompt 版本、变量、条件、循环、playground、production traces 和持续改进。

可复用：

- prompt 版本管理、变量化模板和多人协作。
- 将 prompt 从“文本片段”提升为可追踪资产。

不建议 P0 使用：

- 偏团队 AI feature engineering，复杂度高于单人输入框助手。

### DSPy

来源：[DSPy official](https://dspy.ai/)、[GitHub - stanfordnlp/dspy](https://github.com/stanfordnlp/dspy)、[DSPy optimizers](https://github.com/stanfordnlp/dspy/blob/main/docs/docs/learn/optimization/optimizers.md)。

实现要点：

- 用“programming, not prompting”的方式描述 LLM pipeline。
- optimizer 可以根据数据和 traces 生成/优化 prompt instructions 和 few-shot examples。

可复用：

- P2/P3 可用于高频场景的自动 prompt 优化。
- 对企业版 prompt/skill 库，可按实际任务数据持续优化。

不建议 P0 使用：

- 需要数据集、指标和开发者配置，不适合首版低摩擦体验。

### ClawHub

来源：[GitHub - openclaw/clawhub](https://github.com/openclaw/clawhub)、[OpenClaw skills docs](https://docs.openclaw.ai/cli/skills)、[ClawHub Skill Auto-Injection](https://clawhub.ai/plugins/skill-ai-inject)。

实现要点：

- ClawHub 是 OpenClaw 的公开 skill/plugin registry，用 `SKILL.md` 和支持文件发布、版本化、搜索 skills。
- 技术栈包含 TanStack Start、Convex、GitHub OAuth、OpenAI embeddings、Convex vector search。
- `skill-ai-inject` 插件展示了自动匹配 skills 的可行路径：L1 关键词匹配 + L2 embedding fallback + task intent gate + session suppression。

可复用：

- skills 目录/registry 模型。
- skill 搜索、版本、验证、pin local installs。
- 自动注入思路：关键词先行，embedding 兜底，控制最大注入数量。

风险：

- 第三方 skills 是供应链风险。本产品如果支持外部 skills，必须有来源标记、权限说明、签名/校验、禁用执行脚本的安全模式。

### Skills Hub / SkillHub

来源：[skills-hub.ai](https://skills-hub.ai/)、[skills-hub MCP skills](https://skills-hub.ai/mcp-skills)、[SkillHub guide](https://www.skillhub.pm/guide)。

实现要点：

- skills-hub.ai 提供大量可搜索 AI skills，并支持一条命令安装到 Claude Code/Cursor/Codex/Windsurf/GitHub Copilot/MCP 等生态。
- SkillHub 聚合 Claude skills、MCP servers 和官方/社区资源。

可复用：

- skill 发现层：按角色、任务、工具、质量、安全等级组织。
- 安装命令/复制 prompt 的低摩擦入口。

不确定性：

- “SkillHub”有多个站点和社区命名，权威边界不唯一。产品 PRD 中应把它们作为“可集成来源/竞品生态”，不把单一 SkillHub 当事实标准。

### Claude / OpenAI Skills 标准

来源：[Claude Code skills](https://code.claude.com/docs/en/skills)、[Claude Skills overview](https://claude.com/docs/skills/overview)、[OpenAI Skills Help](https://help.openai.com/en/articles/20001066-skills-in-chatgpt)。

实现要点：

- `SKILL.md` + 支持文件是核心形态。
- Progressive disclosure：启动时只加载名称/描述，命中任务后再加载完整 skill 和资源。
- Skills 可由模型自动判断何时使用，也可由用户显式调用。

可复用：

- 本产品的 skill 推荐应只把最相关 1-3 个候选展示给用户，不应把完整 skill 全量塞给模型。
- skill 描述必须写得像触发条件，而不是营销文案。

## 输入框识别与填入实现

### 浏览器侧

来源：[Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts?authuser=1)、[chrome.scripting](https://developer.chrome.com/docs/extensions/reference/scripting/)。

实现建议：

- `content-script` 注入网页，寻找可编辑元素。
- 维护站点适配器：ChatGPT、Claude、Gemini、Perplexity、Lovable、Bolt、v0 等。
- 通用识别：`textarea`、`input[type=text]`、`contenteditable=true`、ARIA textbox。
- 使用 MutationObserver 处理 SPA 动态 DOM。
- 填入时同时设置 DOM value 和触发 input/change/composition 事件，必要时模拟粘贴。

### Windows 桌面侧

来源：[Microsoft UI Automation Overview](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-uiautomationoverview)、[UI Automation and MSAA](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-msaa)。

实现建议：

- 通过 UIA 获取当前前台窗口、焦点控件、控件类型、可编辑状态和边界。
- 对支持 ValuePattern/TextPattern 的控件读取/设置文本。
- 对不支持的控件，回退剪贴板粘贴。

### macOS 桌面侧

来源：[Apple AXUIElement](https://developer.apple.com/documentation/applicationservices/axuielement_h?changes=_10&language=objc)。

实现建议：

- 用 AXUIElement 获取系统级焦点元素、role、value、selected text range、bounds。
- 需要 Accessibility 权限；部分输入监控还需要 Input Monitoring。
- 对可设置 value 的控件直接写入；否则使用剪贴板/键盘事件兜底。

## 最终整合方案

### 架构

1. Desktop Shell：Tauri/Electron，负责悬浮小人、全局快捷键、本地设置、prompt/skill 库。
2. Browser Extension：负责网页 LLM/Agent 输入框识别、插入和输入框附近定位。
3. Context Detector：根据 host/app、输入框内容长度、结构、光标状态判断三种模式。
4. Prompt Orchestrator：把用户输入、环境、目标模式、已选 skill 组装成最终提示词。
5. Skill Router：扫描本地/导入的 `SKILL.md`、`AGENTS.md`、`CLAUDE.md`、`.cursorrules`，用关键词 + embedding 匹配候选。
6. LLM Gateway：支持用户自带 API key 或本地模型，默认只发送必要上下文。
7. Fill Engine：网页 DOM 插入优先；桌面 accessibility 写入次之；剪贴板粘贴兜底。
8. Asset Pipeline：GPT Image 系列生成小人状态图；Remotion 生成轻量动画。

### 三种模式

- Idea Mode：输入为空，输出“提问引导 + 可直接发送的结构化 prompt”。
- Continue Mode：输入半成品，补齐目标、约束、上下文、输出格式和下一步。
- Polish Mode：输入完整，重排结构、去模糊、加边界、补测试/验收标准。

### Skill 推荐策略

- L1：当前工具 + 输入关键词 + 用户历史选择。
- L2：embedding 相似度匹配 skill 描述。
- L3：如果多个 skill 冲突，只展示候选，不自动注入。
- 安全默认：第三方 skill 不执行脚本，只读取描述和正文；执行脚本需单独授权。

### 不建议做的事

- 不要第一版就承诺识别所有桌面输入框。
- 不要默认读取整屏、整文件或聊天历史。
- 不要自动发送 prompt 给目标 LLM；只填入，让用户最终确认。
- 不要把小人动画做成主功能；它是入口和反馈，不是价值本体。
