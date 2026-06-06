# 问题与风险

## 当前问题

- 小人形象原型已提供：`assets/ui-ux/mascot-token-run.png`。当前已有 UI/UX 图仍是旧概念小人版本；需要在配置 `OPENAI_API_KEY` 后用 `gpt-image-2` 基于原型图重生成。
- `gpt-image-2` 的实际 API 可用性尚未在本环境通过 CLI/API 实测；Process/User/Machine 三层环境变量均缺少 `OPENAI_API_KEY`。已补齐 prompt 文件、原型图和复跑脚本，dry-run 通过，但真实 API 图尚未生成。

## 已知风险

- “全网深度调研”无法证明穷尽全网；当前采用多源、多社区、多关键词检索并保留来源链接。
- SkillHub/ClawHub 命名和生态边界不唯一；文档已标注不确定性。
- 自动识别并写入任意桌面/网页输入框涉及权限、隐私和平台安全限制；PRD 已限定 MVP 从 allowlist 网页输入框开始。

## 失败尝试

- 初始 critic 脚本包含中文字符串，Windows PowerShell 以非 UTF-8 解析时报错；已改为 ASCII-only 检查。
- 初始 critic 在文档未填充时失败；后续补齐来源与文档。
- 第二次 critic 在 UI/UX 图未生成时失败；后续生成图片并通过。
- 调严 critic 后，当前失败在缺少显式 `gpt-image-2` API 输出图：`assets/ui-ux/prompt-copilot-uiux-gpt-image-2.png`。

## 待回顾

- 用户提供小人原型图后是否需要重生成 UI/UX 图和动作资产。
- 是否继续进入原型开发阶段。

## 已解决

- 已补齐项目记忆文件。
- 已完成研究文档、PRD、UI/UX 概念图。
- 研究/PRD/内置图像资产已通过旧本地 critic 并记录过 OMX pass verdict；现已调严门槛，需真实 `gpt-image-2` API 输出图后才能重新记录 pass。
