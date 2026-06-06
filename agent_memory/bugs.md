# 问题与风险

## 当前问题

- 当前无阻塞当前目标完成的问题。用户已确认不需要严格 `gpt-image-2` API 产物。

## 已知风险

- “全网深度调研”无法证明穷尽全网；当前采用多源、多社区、多关键词检索并保留来源链接。
- SkillHub/ClawHub 命名和生态边界不唯一；文档已标注不确定性。
- 自动识别并写入任意桌面/网页输入框涉及权限、隐私和平台安全限制；PRD 已限定 MVP 从 allowlist 网页输入框开始。

## 失败尝试

- 初始 critic 脚本包含中文字符串，Windows PowerShell 以非 UTF-8 解析时报错；已改为 ASCII-only 检查。
- 初始 critic 在文档未填充时失败；后续补齐来源与文档。
- 第二次 critic 在 UI/UX 图未生成时失败；后续生成图片并通过。
- 调严 critic 后曾失败在缺少显式 `gpt-image-2` API 输出图：`assets/ui-ux/prompt-copilot-uiux-gpt-image-2.png`；用户后来确认不需要严格 `gpt-image-2`，该项已从完成门槛移除。
- 本次按用户要求再次 dry-run 通过；随后在 User 级 `OPENAI_API_KEY` 生效后真实调用 `gpt-image-2`，但被 billing hard limit 拦截。
- 用户配置 User 级 `OPENAI_API_KEY` 后再次真实调用；`uv run --with openai` 成功安装临时 SDK 并调用 Image API，但 OpenAI 返回 billing hard limit，未生成输出图。
- Goal 续跑中再次真实调用 `gpt-image-2`；API 仍返回 billing hard limit。更新后的 critic 仍失败在缺少 `assets/ui-ux/prompt-copilot-uiux-gpt-image-2.png`。

## 待回顾

- 是否继续进入原型开发阶段。

## 已解决

- 已补齐项目记忆文件。
- 已完成研究文档、PRD、UI/UX 概念图。
- 已完成一版不依赖 API billing 的内置 `image_gen` UI/UX 图，并本地贴入原始小人以避免模型重绘角色。
- 已完成六种小人状态动作资产并抠成透明 PNG：normal、resting、thinking、suggesting、success、clapping。
- 已完成 Remotion 轻量动画原型和两个 MP4 渲染资产。
- 本地 critic 已按更新目标通过，OMX 已记录 pass verdict。
