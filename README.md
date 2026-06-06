# Smart Prompt

这是一个跨平台提示词自动化生成小工具的研究与 PRD 项目。

## 交付物

- `docs/research-report.md`：用户痛点、社区证据、技术可行性和 MVP 判断。
- `docs/competitive-analysis.md`：竞品、相邻产品、差异化与市场判断。
- `docs/open-source-skills-analysis.md`：GitHub、SkillHub、ClawHub 与 agent skills 实现方式分析。
- `docs/prd.md`：产品需求文档 v0.1。
- `assets/ui-ux/prompt-copilot-uiux-v1.png`：第一版 UI/UX 概念图。
- `assets/ui-ux/README.md`：图像生成说明与提示词。
- `research/autoresearch-rubric.md`：autoresearch-goal 验收 rubric。
- `scripts/critic-autoresearch.ps1`：本地完成门槛检查脚本。

## 验证

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-autoresearch.ps1
```

通过时输出：

```text
PASS: autoresearch artifacts meet local critic checks.
```
