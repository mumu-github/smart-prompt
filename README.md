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

当前说明：完整 critic 还要求存在通过显式 `gpt-image-2` CLI/API 路径生成的 `assets/ui-ux/prompt-copilot-uiux-gpt-image-2.png`。该路径使用用户指定的小人原型 `assets/ui-ux/mascot-token-run.png` 作为 edit 输入图，要求保留原型小人，不重新设计角色。若本地未配置 `OPENAI_API_KEY`，可先 dry-run 验证调用参数：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\generate-uiux-gpt-image-2.ps1 -DryRun
```
