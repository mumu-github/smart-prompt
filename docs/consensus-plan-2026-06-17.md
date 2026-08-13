# Smart Prompt 项目问题闭环整改方案（共识版）

> 日期：2026-06-17
> 锚定仓库：`C:\Users\lhy10\Documents\Smart Prompt`（Tauri monorepo, v0.2.0-beta.1）
> 整合来源：xm（运行态/工程审计）、agnes（架构/代码审计，已产出 `docs/audit-2026-06-17.md`）、codex（结构确认）、claude（汇总编辑）

---

## 背景说明

本方案基于 **真实仓库代码逐文件审查** 得出。xm 与 agnes 使用 `search_files`、`os.walk`、`read_file` 等工具直接读取了项目源码、配置、进度记录和研究证据；codex 确认了仓库结构；claude 负责汇总编辑。

早前 claude/codex 曾基于错误缓存分析了一套"简单 Chrome 扩展"（`service-worker.js`、`constants.js`、`background/index.js` 等），该分析与实际仓库不符，**已从共识中剔除**，不纳入本文档。

---

## P0 — 致命 / 阻断核心价值

### P0-1　桌面端真实 Fill 链路始终不通【双源确认：xm + agnes】

| 维度 | 内容 |
|------|------|
| **问题** | 桌面小人能显示，但无法把生成的 prompt 一键填入 Codex / WorkBuddy / Trae。 |
| **出现原因** | `safeCandidateCount=0`；这些工具的输入区是 WebView 内的 contenteditable，被 `desktop-input-detector.js` 判为 `browser_like_composer_blocked`，UIA 无法将其识别为 safe writable candidate。唯一通过的是 Codex 的 clipboard fallback。 |
| **解决方案** | 引入「受信任工具白名单」——当 `strict foreground + 工具 profile 匹配 + title hash 匹配` 同时成立时，允许 `clipboard_paste_fallback` 作为受控写入路径，保留 `no-auto-submit` 与回读校验。 |
| **预期结果** | Codex / WorkBuddy / Trae 至少 2 个工具端到端 Fill 跑通。 |
| **验收标准** | `research/p25-real-overlay-click-fill.latest.json` → `pass=true`、`completionReady=true`、`fill.verified=true`、`noAutoSubmit=true`、`submitSignalCount=0`。 |
| **闭环** | 真实运行态 → 只读 gate 显示 `safeCandidatesReady=true` → 授权 `-AllowRealOverlayClick` → `/desktop/fill/latest` verified → 写入 progress 真实证据。 |

### P0-2　重复构建/验证循环，核心功能零推进【单源·xm，agnes 佐证仓库噪音】

| 维度 | 内容 |
|------|------|
| **问题** | `progress.md` 437 行，80%+ 是「构建候选 → 离线验证 → 未启动 → 未真实点击」的空转循环。 |
| **出现原因** | 行动惯性——用离线视觉验证替代真实运行态推进，规避 P0-1 的真正阻塞点。 |
| **解决方案** | 用**里程碑 checklist** 取代自由文本流水账；每一轮进展必须绑定一条**真实运行态证据**，否则不计入进展。 |
| **预期结果** | 工作重心从"再构建一个候选"转向"解决 safe candidate 阻塞"。 |
| **验收标准** | `progress.md` 压缩为「当前状态快照 + checklist」；checklist 每项状态变化都引用 `research/*.latest.json`。 |
| **闭环** | checklist 勾选 ⇔ 真实证据文件，二者不一致即视为未完成。 |

---

## P1 — 严重技术债 / 可用性

### P1-1　`prompt-quality.js` 过度膨胀（173KB / 3523 行）【单源·agnes】

| 维度 | 内容 |
|------|------|
| **问题** | 单文件承载质量评分、反馈闭环、策略实验、失败原因策略、自我改进、进化候选等 10+ 子系统。 |
| **出现原因** | 职责蔓延；`buildPrompt()` 被 13 个 `*Guidance` 参数膨胀，LLM system prompt 过长浪费 token。 |
| **解决方案** | 拆分为 `quality-score` / `feedback-loop` / `strategy-experiment` / `failure-policy` / `self-improvement` 等子模块，主文件只留编排。 |
| **预期结果** | 单文件 < 500 行，职责单一，可独立测试。 |
| **验收标准** | 拆分后 `npm test`（local-service + 各包）全绿，无行为回归。 |
| **闭环** | 每拆一个模块跑一次完整测试套件，回归即回退。 |

### P1-2　safe candidate 判定不可配置【双源确认（P0-1 的代码层根因）】

| 维度 | 内容 |
|------|------|
| **问题** | 判定条件硬编码在 `desktop-input-detector.js`，新增工具必须改核心逻辑。 |
| **出现原因** | 缺少工具画像配置层。 |
| **解决方案** | 抽出 `trusted-tool-profile` 配置（`packages/shared/desktop-tool-profiles.js` 扩展），把判定阈值/信号外置。 |
| **预期结果** | 新增工具适配只改配置，不动核心判定。 |
| **验收标准** | 新增一个工具 profile 后，`check-m3-desktop-tool-profiles.ps1` self-test 通过。 |
| **闭环** | profile 变更 → self-test → 真实窗口验证 → 回写 profile 证据。 |

### P1-3　缺少用户反馈采集入口【单源·agnes】

| 维度 | 内容 |
|------|------|
| **问题** | PRD 定义 6 项内测指标，但 Prompt Card 无 👍/👎 入口；现有"反馈闭环"是系统自学习，非用户直评。 |
| **出现原因** | UI 层从未暴露显式反馈控件。 |
| **解决方案** | Card 底部增加好评/差评 + 失败原因选择，写入 `PilotMetric`。 |
| **预期结果** | `insert/save/undo/retry` 之外补齐显式满意度信号。 |
| **验收标准** | 反馈事件进入 metrics 且 `GET /diagnostics/export` 可导出聚合值。 |
| **闭环** | 用户反馈 → metrics → strategy weight 调整 → 下次生成体现。 |

---

## P2 — 清理 / 规范

### P2-1　构建产物污染仓库【双源确认：xm + agnes】

| 维度 | 内容 |
|------|------|
| **问题** | 多个 `target-p25-*` 构建目录、`.runtime/`（4282 文件）、`.omx/`（187 文件）混入仓库。 |
| **出现原因** | 临时构建目录与运行时缓存未忽略。 |
| **解决方案** | `.gitignore` 增加 `target-p25-*`、`.runtime/`、`.omx/`，清理历史冗余。 |
| **预期结果** | 仓库只含源码 + 必要资产。 |
| **验收标准** | `git status` 干净；仓库体积显著下降。 |
| **闭环** | 加一条 CI / pre-commit 检查，拦截意外大文件。 |

### P2-2　验证脚本过度膨胀（30+ PowerShell）【单源·xm】

| 维度 | 内容 |
|------|------|
| **问题** | `check-p25-*.ps1` 之间职责严重重叠。 |
| **出现原因** | 每个验证场景新建一个脚本。 |
| **解决方案** | 合并为 3 个核心脚本：`check-visual`（视觉 smoke）/ `check-runtime`（进程+窗口+前台）/ `check-fill`（真实填入链路）。 |
| **预期结果** | 验证链路简化、易维护。 |
| **验收标准** | 3 个脚本覆盖原有全部关键断言，结果一致。 |
| **闭环** | 合并后跑一轮全回归对照旧断言。 |

### P2-3　浏览器扩展版本滞后（0.1.0）【单源·xm】

| 维度 | 内容 |
|------|------|
| **问题** | 桌面壳 0.2.0，扩展 `manifest.json` 仍 0.1.0；Doubao / DeepSeek 已声明未验证。 |
| **出现原因** | 扩展未随主线同步迭代。 |
| **解决方案** | 版本对齐 0.2.0；补 Doubao / DeepSeek selector 真实登录态验证。 |
| **预期结果** | 版本一致、站点适配有证据。 |
| **验收标准** | `manifest.version=0.2.0`；新增站点适配验证 JSON。 |
| **闭环** | 版本号 + 适配验证同批提交。 |

### P2-4　agent_memory 乱码 + 文档失真【双源确认：xm + agnes】

| 维度 | 内容 |
|------|------|
| **问题** | `bugs.md` 57–59 行 CRLF/UTF-8 乱码；PRD 把 M3"真实窗口写回"等描述为高于实际的完成度。 |
| **出现原因** | 写入编码冲突；文档未随真实状态更新。 |
| **解决方案** | 修复编码；PRD 中 M3、真实 Fill 等状态如实标为「进行中 / 部分」。 |
| **预期结果** | 文档与代码现状一致。 |
| **验收标准** | 无乱码；PRD 状态与 `research/*.latest.json` 对得上。 |
| **闭环** | 文档审计纳入每次 release 前检查项。 |

### P2-5　构建方式混淆【单源·xm】

| 维度 | 内容 |
|------|------|
| **问题** | `cargo build --release` 产物加载 devUrl 不可用于真实验证，必须用 `npm run build --prefix apps/desktop-shell`。 |
| **出现原因** | 两条构建路径并存且无文档约束。 |
| **解决方案** | 在 README / CONTRIBUTING 固化唯一正确构建命令，标注 cargo 直产物的限制。 |
| **预期结果** | 不再误用 cargo 产物做真实结论。 |
| **验收标准** | 构建文档明确；新成员按文档可一次跑通。 |
| **闭环** | 构建文档 + 一次干净环境验证。 |

---

## 共识优先级总览

| 级别 | 编号 | 问题 | 确认度 |
|------|------|------|--------|
| P0 | P0-1 | 桌面端真实 Fill 不通 | 双源 |
| P0 | P0-2 | 重复构建空转、零推进 | 单源 + 佐证 |
| P1 | P1-1 | prompt-quality.js 膨胀 | 单源 |
| P1 | P1-2 | safe candidate 不可配置 | 双源 |
| P1 | P1-3 | 缺用户反馈入口 | 单源 |
| P2 | P2-1 | 构建产物污染仓库 | 双源 |
| P2 | P2-2 | 验证脚本膨胀 | 单源 |
| P2 | P2-3 | 扩展版本滞后 | 单源 |
| P2 | P2-4 | 记忆乱码 + 文档失真 | 双源 |
| P2 | P2-5 | 构建方式混淆 | 单源 |

---

## 落地建议顺序

1. **P0-2**（停止空转、立规矩）— 改 progress.md 为 checklist 格式，建立证据绑定机制
2. **P0-1 + P1-2**（一起解决 Fill 核心价值）— trusted-tool-profile 配置化 + clipboard fallback 受控放行
3. **P1-1**（拆分 prompt-quality.js）— 按子系统逐步抽取，每步全测试
4. **P1-3**（补用户反馈入口）— Card 底部 👍/👎 + 失败原因选择
5. **P2 批量清理**（P2-1 ~ P2-2 ~ P2-3 ~ P2-4 ~ P2-5）— 可并行，一次性清理

---

## 参考文件

- `docs/prd.md` — 产品需求文档
- `docs/audit-2026-06-17.md` — agnes 架构审计报告
- `agent_memory/progress.md` — 进展记录（需压缩）
- `agent_memory/bugs.md` — 问题与风险记录（需修复乱码）
- `agent_memory/context.md` — 当前项目上下文
- `research/p25-real-overlay-click-fill.latest.json` — 真实 Fill 验证证据
- `research/p25-overlay-click-chain.latest.json` — 聚合审计链路
- `packages/shared/desktop-tool-profiles.js` — 桌面工具画像
- `apps/local-service/src/desktop-input-detector.js` — 输入框检测与 safe candidate 判定
- `packages/shared/prompt-quality.js` — 提示词质量系统（待拆分）
