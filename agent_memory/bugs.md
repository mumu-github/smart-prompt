# 问题与风险

## 当前问题

- 当前无阻塞 V2 自动化代码路径推进的问题；完整验收缺少 Claude Insert 验证和真实 LLM quota 可用性。

## 已知风险

- “全网深度调研”无法证明穷尽全网；当前采用多源、多社区、多关键词检索并保留来源链接。
- SkillHub/ClawHub 命名和生态边界不唯一；文档已标注不确定性。
- 自动识别并写入任意桌面/网页输入框涉及权限、隐私和平台安全限制；PRD 已限定 MVP 从 allowlist 网页输入框开始。
- 当前浏览器 MVP 使用 DOM 写入；复杂 contenteditable/富文本编辑器可能仍可能受站点 UI 变更影响。本轮已补强 8 站点 selector、同步共享核心，并让 live-site probe 使用适配器 selector，但生产站点仍需持续 runtime 证据。
- 真实 LLM gateway 代码路径已接入并支持 auto、OpenAI-compatible、Anthropic、Gemini provider，且有三模式 test double 覆盖；provider-specific saved keys、provider 默认模型和 auto provider 失败转移已支持，但当前可用 key/billing 不足时仍会回退本地模板，生成质量会受模板限制。
- 真实 LLM 生成需要 API key 和可用 billing；没有 key 时本地服务只会按调用方允许返回 template fallback。
- 当前 User 环境只发现 `OPENAI_API_KEY`，未发现 `ANTHROPIC_API_KEY`、`GEMINI_API_KEY` 或 `GOOGLE_API_KEY`；本地服务和验收脚本现在也支持读取桌面壳保存的 provider-specific keys，但尚未拿到 Anthropic/Gemini 真实联网通过证据。
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

- 已补齐项目记忆文件。
- 已完成研究文档、PRD、UI/UX 概念图。
- 已完成一版不依赖 API billing 的内置 `image_gen` UI/UX 图，并本地贴入原始小人以避免模型重绘角色。
- 已完成六种小人状态动作资产并抠成透明 PNG：normal、resting、thinking、suggesting、success、clapping。
- 已完成 Remotion 轻量动画原型和两个 MP4 渲染资产。
- 本地 critic 已按更新目标通过，OMX 已记录 pass verdict。
- 已开始第一版实现：新增 Chrome/Edge MV3 浏览器扩展 MVP 原型和基础验证脚本。
- 已接入 V2 本地服务、LLM gateway 代码路径、站点适配器、Tauri scaffold 和 V2 critic 自动化检查。
- 已接入本地 prompt/skill 库：skill 文件夹导入/推荐与 prompt 保存/列表/删除 API，并在桌面壳暴露管理 UI。
- 已安装 Rustup/Cargo，并通过 Tauri `cargo check`；当前剩余的是运行态 app 启动和全局快捷键验证，不是 Rust 编译环境缺失。
- 已通过 `scripts/check-v2-tauri-runtime.ps1` 验证 Tauri 运行态启动、Tauri command、从 Tauri 启动本地服务和全局快捷键触发；Tauri runtime 不再是当前缺口。
