# 问题与风险

## 当前问题

- 当前无阻塞 V2 自动化代码路径推进的问题；完整验收缺少 Claude Insert 验证和真实 LLM quota 可用性。

## 已知风险

- “全网深度调研”无法证明穷尽全网；当前采用多源、多社区、多关键词检索并保留来源链接。
- SkillHub/ClawHub 命名和生态边界不唯一；文档已标注不确定性。
- 自动识别并写入任意桌面/网页输入框涉及权限、隐私和平台安全限制；PRD 已限定 MVP 从 allowlist 网页输入框开始。
- 当前浏览器 MVP 使用 DOM 写入；复杂 contenteditable/富文本编辑器可能需要站点适配器，否则一键填入可能不稳定。
- 真实 LLM gateway 代码路径已接入；但当前 key/billing 不可用时仍会回退本地模板，生成质量会受模板限制。
- 真实 LLM 生成需要 API key 和可用 billing；没有 key 时本地服务只会按调用方允许返回 template fallback。
- 真实站点验证可能需要浏览器登录态和平台页面稳定性；当前不能用本地 demo 代替生产站点证据。
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

- 真实 Chrome/Edge 扩展在 ChatGPT、Claude、Gemini 等站点的逐站点兼容性。
- V2 runtime evidence：Claude Insert。
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
- 已安装 Rustup/Cargo，并通过 Tauri `cargo check`；当前剩余的是运行态 app 启动和全局快捷键验证，不是 Rust 编译环境缺失。
- 已通过 `scripts/check-v2-tauri-runtime.ps1` 验证 Tauri 运行态启动、Tauri command、从 Tauri 启动本地服务和全局快捷键触发；Tauri runtime 不再是当前缺口。
