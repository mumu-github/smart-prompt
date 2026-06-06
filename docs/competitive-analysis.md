# 竞品与差异化分析

检索日期：2026-06-06。本文区分直接竞品、相邻竞品和可借鉴能力。

## 竞品地图

| 类别 | 代表 | 主要价值 | 对本产品的启示 |
| --- | --- | --- | --- |
| Prompt optimizer | PromptPerfect、linshenkx/prompt-optimizer、Promptaa、Promptomizer | 把已有 prompt 改写得更清晰 | 只能解决第三种模式的一部分，缺少输入环境识别和 skill 提醒 |
| Prompt library / marketplace | PromptBase、prompts.chat、FlowGPT、AIPRM | 提供大量可复制 prompt | 供给丰富但选择成本高，容易变成“用户记得去找” |
| 快捷 prompt manager | Prompt Library、PromptPaste、PromptForge | 快捷键或浏览器内插入 prompts | 证明“一键取用”有需求，但多数不理解当前输入状态 |
| AI command / OS-level assistant | Raycast AI、Pieces Copilot | 快捷命令、跨工具上下文、开发者工作流 | 可以借鉴快捷命令和上下文策略，但它们不是专门的 prompt 生成/skill 入口 |
| Agent skills / workflow | Claude Skills、OpenAI Skills、ClawHub、Skills Hub | 把重复流程封装成可复用能力 | 本产品应做“自动发现该用哪个 skill”的前置提醒层 |

## 直接与相邻竞品

### AIPRM

来源：[AIPRM Help](https://help.aiprm.com/hc/en-us/articles/18682422724497-How-can-I-use-AIPRM-for-ChatGPT)、[AIPRM app](https://app.aiprm.com/)、[Chrome Web Store](https://chromewebstore.google.com/detail/aiprm-for-chatgpt/ojnbohmppadfgpejeebfnmnknjdlckgj?hl=en)。

产品形态：浏览器扩展 + prompt 模板库，主要服务 ChatGPT/Claude。

优势：

- 已验证浏览器扩展 + ChatGPT 内嵌 prompt 库的需求。
- 社区模板和团队管理能力成熟。

不足：

- 更像“模板库增强 ChatGPT UI”，不是任意输入框旁的上下文助手。
- 依赖用户搜索、选择模板，不天然解决“忘记用 skill”。

### PromptBase

来源：[PromptBase Marketplace](https://promptbase.com/marketplace)。

产品形态：prompt marketplace，覆盖文本、图像、视频、agent skills 等。

优势：

- 证明 prompt/agent skill 已经有交易市场。
- 类目覆盖广，适合作为素材/模板来源参考。

不足：

- 市场和发现平台，不是工作流工具。
- 用户仍需主动搜索、购买、复制和适配。

### FlowGPT

来源：[FlowGPT](https://flowgpt.ai/)。

产品形态：prompt 分享和可视化聊天界面。

优势：

- 社区发现和 prompt 体验入口强。

不足：

- 不贴近用户正在使用的其他 AI 工具输入框。
- 对 coding agent 的项目规则、skills、环境识别支持有限。

### PromptPerfect

来源：[PromptPerfect](https://promptperfect.jina.ai/)、[PromptPerfect API](https://promptperfect.jina.ai/api)、[Jina AI about](https://jina.ai/en-US/about-us/)。

产品形态：AI prompt optimizer，支持文本与图像模型 prompt 优化。

优势：

- “输入 prompt -> 自动优化”是被市场接受的直接能力。
- API 形态说明 prompt 优化可以嵌入其他产品。

不足：

- 核心是 prompt 优化，不是输入框环境识别。
- 更适合完整/半完整 prompt，不适合空输入时引导用户形成思路。

### Prompt Library

来源：[Product Hunt - Prompt Library](https://www.producthunt.com/products/prompt-library)。

产品形态：Mac 本地 prompt 库，快捷键搜索并插入任意 app。

优势：

- 和本产品最接近的一点是“任意 app 插入”和本地 prompt 管理。
- 低价、离线、本地优先，符合隐私诉求。

不足：

- 核心是存储和插入，不是生成、续写、优化。
- 没有明确的输入状态判断和 agent skill 推荐。

### PromptPaste

来源：[Product Hunt - PromptPaste](https://www.producthunt.com/products/promptpaste)。

产品形态：Apple 生态私有 prompt 库，menu bar 快捷访问，iCloud 同步。

优势：

- 强调 prompt 分散在 Notion/Notes/chat history 的真实痛点。
- 无账号、本地/iCloud 同步是重要隐私卖点。

不足：

- Apple-only，不覆盖 Windows。
- 主要是 prompt library，不是上下文识别助手。

### Promptacore

来源：[Product Hunt - Promptacore](https://www.producthunt.com/products/promptacore)。

产品形态：浏览器内 prompt workspace，可创建、组织、优化和应用 prompts。

优势：

- “直接在任意网站应用 prompt”接近本产品的浏览器侧方向。
- 动态 prompt/smart forms 可借鉴。

不足：

- 未看到针对 vibe coding 工具/agent skills 的明确定位。
- 更偏 prompt workspace，不是输入框旁的轻量人格化入口。

### PromptCraft

来源：[Product Hunt - PromptCraft](https://www.producthunt.com/products/promptcraft-2)。

产品形态：把 idea 转成 v0/Lovable/Bolt 等 AI 构建工具 prompts。

优势：

- 明确抓住“我不知道该怎么 prompt AI 构建工具”的痛点。
- 和 vibe coding 场景高度相关。

不足：

- 更像独立 prompt 生成器，而不是通用输入框旁助手。
- 不覆盖已有半成品 prompt 续写、完整 prompt 优化、skills 调用。

### Raycast AI

来源：[Raycast AI Commands](https://manual.raycast.com/ai/ai-commands)、[Raycast AI for Windows](https://manual.raycast.com/windows/raycast-ai)、[Raycast AI Extensions](https://manual.raycast.com/ai/ai-extensions)。

产品形态：OS command palette + reusable AI commands。

优势：

- AI Commands 把常用 prompt 变成一键命令，符合“不要重复写”的方向。
- Windows 版本说明跨平台 command palette 正在成为标准体验。

不足：

- 入口是 command palette，不是贴着输入框的情境助手。
- 对网页/agent 输入框的三状态识别不是核心。

### Pieces Copilot

来源：[Pieces Copilot](https://pieces.app/features/copilot)、[Pieces Docs](https://docs.pieces.app/features/pieces-copilot)。

产品形态：面向开发者的 OS-level context copilot。

优势：

- 强调跨浏览器、编辑器、聊天等工具捕获上下文，是本产品技术方向的强参考。
- 本地/云模型选择有隐私启发。

不足：

- 主要是开发者记忆和上下文 copilot，不是 prompt/skill 生成器。
- 产品复杂度远高于本项目 MVP。

## 我们的优势与差异化

### 差异化定位

**不是 prompt library、不是 prompt marketplace、不是纯 optimizer，而是输入框旁的 prompt/skill 触发器。**

竞品大多要求用户完成以下动作：想起来要优化、打开工具、搜索模板、复制、回到原工具、粘贴、再改。本产品要把路径压缩成：

1. 用户聚焦输入框。
2. 小人识别输入状态和当前工具。
3. 用户点一下或按快捷键。
4. 自动给出合适 prompt/skill 建议。
5. 一键填入。

### 可防御点

- 跨工具输入环境识别：需要维护 selector、accessibility、应用画像和 fallback，不是简单 prompt 库可复制。
- 三状态模式判断：把用户意图成熟度作为产品核心，而不是只做“优化”按钮。
- skills 自动提醒：结合本地 `AGENTS.md`、`CLAUDE.md`、`SKILL.md`、`.cursorrules` 与用户自建库，解决“有好东西但忘记用”。
- 人格化小人：作为记忆触发器和微交互入口，但不依赖它承载核心价值。

### 市场判断

有市场，但 MVP 必须避开红海：

- 不要和 PromptBase/FlowGPT 比“prompt 数量”。
- 不要和 PromptPerfect/linshenkx 只比“优化质量”。
- 不要和 Raycast/Pieces 比完整 OS copilot。
- 第一阶段只证明一个窄场景：AI 输入框旁，用户少写 70% 结构化提示词，并更常调用正确 skills。

## 建议竞品监控指标

- 是否开始支持网页内自动插入。
- 是否支持 agent skills 或 `SKILL.md` 生态。
- 是否支持本地 prompt/skill 库和隐私模式。
- 是否支持从当前输入自动判断“生成/续写/优化”。
- 是否支持 Windows + macOS 双平台。
