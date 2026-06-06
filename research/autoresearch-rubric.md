# Autoresearch 验收 Rubric

## 必须通过的交付物

- `docs/research-report.md`：覆盖用户痛点、社区证据、可行性判断、风险和 MVP 建议；必须引用可访问来源。
- `docs/competitive-analysis.md`：覆盖直接/相邻竞品，说明定位、能力、限制和与本产品的差异化。
- `docs/open-source-skills-analysis.md`：覆盖 GitHub 与可检索的 skillhub/clawhub/skills 相关项目或仓库，分析实现方式、可复用点和限制。
- `docs/prd.md`：形成可执行 PRD，包含目标用户、问题、范围、功能、非功能、技术可行性、隐私安全、指标、里程碑和开放问题。
- `assets/ui-ux/`：至少包含一版基于 PRD 的 UI/UX 概念图和生成说明。
- Git：仓库必须能够追踪上述交付物；`.omx/` 等本地状态不得进入源码控制。

## 研究质量门槛

- 用户痛点必须来自多源证据，至少覆盖 Reddit/Hacker News/Product Hunt/开发者社区或类似社区中的若干来源。
- 竞品分析必须区分“提示词生成/优化”“AI 写作辅助”“桌面/浏览器输入框增强”“coding agent workflow/skills”几类相邻产品。
- GitHub/skills 分析必须说明实现方式，不只列名字；至少分析 prompt library、prompt optimizer、agent skills/commands、browser/desktop automation 相关方向。
- 对 `skillhub` 与 `clawhub` 若无法确认权威站点，必须记录检索路径和不确定性，不可编造结论。
- 技术方案必须明确跨平台输入框识别、一键填入、权限/隐私、LLM 调用、图像/动画资产的可行路径与风险。

## 通过标准

- 所有显式用户需求均映射到 PRD 或研究结论。
- 每个重要判断都有来源、推理链或明确标注为假设。
- 最终方案能说明为什么相对竞品有市场差异化。
- 完成前必须记录 `omx autoresearch-goal verdict --verdict pass`。
