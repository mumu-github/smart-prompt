# 产物索引

更新时间：2026-06-26

## 任务

- 用户目标：为 Smart Prompt 建立标准产物索引，下一次继续时不用在 `research/`、`docs/`、`apps/`、`prototypes/` 中重新摸索。
- 本轮范围：只读整理现有文档、beta 包目录、代码目录和 `research/*.latest.json` 证据索引；不运行构建、测试、GUI 或真实 Fill。
- 关键假设：`research/*.latest.json` 只能作为历史证据索引；明确 `pass:true` 的历史结果不等于本轮复验，也不等于真实目标应用写入闭环。

## 已产出

| 产物 | 位置 | 用途 | 验证状态 |
| --- | --- | --- | --- |
| 项目入口 | `PROJECT.md`、`README.md` | 快速了解目标、边界和继续任务前的 gate | 本轮只读确认存在 |
| 产品与发布文档 | `docs/prd.md`、`docs/research-report.md`、`docs/m3-desktop-input.md`、`docs/releases/v0.2.0-beta.1.md` | 记录产品定义、研究结论、桌面输入方案和 beta 发布说明 | 文档索引；本轮未复验文档中的历史命令 |
| Windows beta 安装包目录 | `apps/desktop-shell/src-tauri/target/release/bundle/{msi,nsis}/` | 存放可安装桌面壳候选包 | 本轮只读确认目录存在；`research/v5-beta-manifest.latest.json` 记录历史 `pass:true`、`releaseReady:true` |
| 浏览器扩展 MV3 | `prototypes/browser-extension/` | 网页输入框小人、Prompt Card、Insert 不发送 | 版本与历史证据可登记；本轮未重新加载扩展 |
| 本地服务与 LLM gateway | `apps/local-service/`、`packages/shared/llm-gateway.js` | settings、skills、prompts、`/generate` 和多 provider 接入 | `research/v2-real-llm.latest.json` 记录历史 `pass:true`；本轮未启动服务 |
| 共享 prompt core / quality | `packages/shared/` | prompt core、质量评分、工具画像配置、证据脱敏 | `research/v6-prompt-quality.latest.json` 记录历史 `pass:true`；本轮未重跑测试 |
| Tauri 桌面壳与 overlay | `apps/desktop-shell/` | 托盘、设置页、透明小人 overlay 和桌面壳逻辑 | `research/p25-overlay-chat-visual.latest.json` 记录离线视觉 `pass:true`；真实点击链未完成 |
| Native sidecar 与探针 | `apps/local-service-sidecar/`、`scripts/check-m3-*` | 发布版 sidecar、desktop snapshot / fill self-test | `research/m3-installed-sidecar-desktop-input.latest.json` 记录历史 `pass:true`；不等于真实目标应用写入已闭环 |
| 证据索引 | `research/*.latest.json` | 汇总 beta、LLM、prompt quality、overlay、sidecar 等历史验证证据 | 可作为继续任务前的 gate；大体积原始证据不在本 manifest 展开 |

## 重要结论

- 当前可登记为“v0.2 beta 产物清单 + 证据索引”，不要写成真实 Fill 已闭环。
- `research/p25-overlay-click-chain.latest.json` 当前为 `pass:false`、`completionReady:false`，失败原因指向 `runtime_readiness_missing`。
- WorkBuddy 相关 `write.attempted=true` 不能写成 verified；离线视觉、候选包、旧审计乐观结论也不能替代真实目标输入框写入。
- 真实 Fill 前必须重新确认前台窗口、safe candidate、用户明确授权和可回滚路径。

## 修改范围

- 新增 `outputs/manifest.md`。
- 本轮未修改项目源码、构建产物、research 证据、应用配置或凭据。

## 验证状态

- `命令已验证`：只读确认 `outputs/` 已创建，关键文档、代码目录、beta 包目录和核心 `research/*.latest.json` 路径存在。
- `命令已验证`：只读子代理复核 manifest 候选项，明确 P25 聚合链仍未完成，不能登记真实 Fill 闭环。
- `GUI 未验证`：本轮未验证。
- `线上闭环不适用`：本轮不涉及线上闭环。
- `未验证`：本轮未运行构建、测试、脚本、桌面 GUI、真实输入框操作或联网验证。

## 下一步

- 若继续真实 Fill，先读 `PROJECT.md`、`research/p25-overlay-click-chain.latest.json` 和 `research/m3-installed-sidecar-desktop-input.latest.json`，再按 gate 做前台窗口与 safe candidate 检查。
- 若继续发布，先重跑 release/build/安装包验证，不直接复用历史 `pass:true` 结论。
- 不把 `.smart-prompt-real-fill-data/`、原始窗口截图、UIA/raw title/text 或敏感 payload 纳入公开产物索引。
