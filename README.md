# Smart Prompt

这是一个跨平台提示词自动化生成小工具的研究与 PRD 项目。

## 交付物

- `docs/research-report.md`：用户痛点、社区证据、技术可行性和 MVP 判断。
- `docs/competitive-analysis.md`：竞品、相邻产品、差异化与市场判断。
- `docs/open-source-skills-analysis.md`：GitHub、SkillHub、ClawHub 与 agent skills 实现方式分析。
- `docs/prd.md`：产品需求文档 v0.1。
- `assets/ui-ux/prompt-copilot-uiux-v1.png`：第一版 UI/UX 概念图。
- `assets/ui-ux/prompt-copilot-uiux-builtin-exact-mascot-v2.png`：内置生成并贴入原始小人的当前 UI/UX 概念图。
- `assets/ui-ux/mascot-states/`：normal、resting、thinking、suggesting、success、clapping 六种小人状态透明 PNG。
- `assets/ui-ux/mascot-animations/`：Remotion 渲染的轻量小人状态动画。
- `prototypes/remotion-mascot/`：Remotion 动画原型源码。
- `assets/ui-ux/README.md`：图像生成说明与提示词。
- `research/autoresearch-rubric.md`：autoresearch-goal 验收 rubric。
- `scripts/critic-autoresearch.ps1`：本地完成门槛检查脚本。

## 验证

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-autoresearch.ps1
```

完整通过时输出：

```text
PASS: autoresearch artifacts meet local critic checks.
```

当前说明：用户已确认不需要严格 `gpt-image-2` API 输出图；完整 critic 以当前内置 `image_gen` UI/UX 图、状态动作、Remotion 动画、研究文档和 git 管理为门槛。显式 `gpt-image-2` 路径仍保留为可选复跑工具；若只检查调用参数，可 dry-run：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\generate-uiux-gpt-image-2.ps1 -DryRun
```
