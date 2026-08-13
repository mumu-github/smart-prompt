# 提笔（Tibi）：收缩、命名与 30 天启动路线图

- 日期：2026-08-13
- 状态：已与用户确认的执行依据（命名已锁定「提笔 / Tibi」）
- 上游：`docs/smart-prompt-first-principles-product-plan-2026-07-17.md`、`workflows/codex-outcome-learning-loop-v1.md`、2026 年 7 月网络竞品调研
- 结论级别：基于全仓代码/文档/证据核查与三份并行子代理报告的产品与运营决策

## 0. 决策摘要

1. **产品对外名**：中文「提笔」，英文「Tibi」。仓库名 `smart-prompt` 与 GitHub 地址保持不变（改名成本高且无收益）。
2. **叙事换旗**：对外不再使用"prompt 优化器"，改用 **context engineering 的就地增强层**（"Prompt 已死"是 2026 主流叙事，PromptPerfect 2026-09 关停是品类退场信号）。
3. **收缩是分层收缩**：收"实现面、验证面、功能面"，不收"核"（学习闭环 + 诚实证据文化）。
4. **时间预期**：单人可用 2-4 周；小圈子好用 3-4 个月；可推广 6-9 个月。
5. **推广主线**：把验证文化变成内容，去 skills 作者与 vibe coding 社区找第一批 50 个内测，数据回来前不做新功能。

## 1. 命名与品牌

### 1.1 使用规则

| 场景 | 用名 |
| --- | --- |
| 产品对外名 | 提笔 / Tibi |
| 副标题（中文） | 写清楚，你决定发送。 |
| 副标题（英文） | Write it clear. You decide to send. |
| 定位语（英文） | The context editor for the input moment. |
| 仓库/代码 | `smart-prompt` 不变；包名、manifest 名暂不迁移，避免破坏验证资产 |

### 1.2 三条信任承诺（所有页面第一屏只讲这三句）

1. **你控制**：永不自动发送（no-auto-submit 是代码强制，非承诺）。
2. **你拥有**：BYOK + 本地存储，无云端账号。
3. **会学习**：从你的真实任务结果学习，不是套模板。

### 1.3 品牌资产更新清单（后续小任务，不阻塞启动）

- [ ] 官网/README 首屏文案替换为 1.1/1.2。
- [ ] `docs/prd.md` 一句话定位改用「提笔」口径。
- [ ] 小人形象沿用 `assets/ui-ux/mascot-token-run.png`，可加"提笔"动作梗，不重新设计角色。

## 2. 分层收缩方案

### 2.1 产品表面：收尾（已基本完成）

- [x] 控制中心四页 + 托盘化（阶段 3 已交付）。
- [ ] 删除 legacy 隐藏兼容层（`apps/desktop-shell/index.html` 的 `legacy-shell` 与旧 `app.js` overlay 初始化），先迁移 overlay/interaction 回归覆盖再删。
- [ ] 修文档漂移：`docs/assistant-state-spec.md` 补 clarification/outcome/collapse 命令；local-service README 版本号 0.3.0 → 0.2.0。

### 2.2 工程面：重点收缩（省约一半维护成本）

- [ ] **Node/Rust 双实现收敛**：Rust sidecar 退化为薄代理（凭证 DPAPI、写回事务、隐私守卫、健康接口）；学习/策略逻辑只保留 Node 一份。消除 `main.rs`（6765 行）与 `learning_policy.rs`（5394 行）的业务逻辑重复，并消除 phase3 契约只测 sidecar 的行为漂移风险。
- [ ] **验证脚本收敛**：165k 行 PowerShell 从"每次人肉跑 30 个"收敛为 5-8 个 key critics（critic-v2、critic-m3、phase3、privacy、installer、visual），其余归档为历史；新增根级 `npm test` 聚合入口。
- [x] **补 CI**：GitHub Actions 聚合测试入口（根 `npm test`，`.github/workflows/ci.yml`）。
- [x] 视觉测试 `chrome-headless-shell` 路径可配置化：全部视觉入口统一 `CHROME_PATH` → Playwright → 系统 Chrome 回退链。
- [ ] key critics 接入 CI（缓行）：critic-m3/phase3 等探测真实桌面应用与已安装二进制，CI runner 无 GUI 环境，需先为 critics 设计 headless 子集或保留人工运行。
- [ ] **同步机制收口**：`smart-prompt-core` 无 sync 脚本，要么补 sync，要么合并进 `packages/prompt-session`，禁止第三份裸奔拷贝。
- [ ] 拆分 God files（`app.js` 3761 行、`server.js`、`store.js`），小步提交，以 phase3 契约测试为安全网。

### 2.3 功能面：冻结（缓行，不删除）

| 冻结项 | 解冻条件 |
| --- | --- |
| Policy 自动灰度/晋升 | ≥20 真实用户的 outcome 数据 |
| 付费 benchmark（真实 Codex 执行） | 同上 + 预算授权 |
| WorkBuddy 攻坚、新桌面工具写回 | Codex 单目标闭环 + 浏览器内测数据 |
| 新站点适配 | 现有 allowlist 失败率数据出来后再排期 |
| 团队同步 / Marketplace / 远程遥测 | 个人版价值被内测证明后另立决策 |

### 2.4 绝不收缩的核

- 核心循环：读草稿 → 生成 → 审核编辑 → 填入不发送 → 撤销。
- 学习闭环：Outcome 回流 + 四类候选 + 卡片内一行提醒（轻量版先行）。
- 诚实证据文化：证据分层、evidence freshness、禁止"放宽守卫换绿"。

## 3. 时间表与退出标准

### 阶段 A：入库与基线（第 1 周）

- [x] 分批 git commit + push（当前 75 modified + 209 untracked，7 周工作未入库；详见第 6 节提交方案）。
- [x] 根级测试聚合入口 + CI 骨架（根 `package.json` 的 `npm test` + `.github/workflows/ci.yml`）。
- [ ] 修文档漂移与版本号。
- **退出标准**：`git status` 干净（或仅剩明确忽略项）；CI 绿灯；README 与界面一致。

### 阶段 B：单人可用（第 2-4 周）

- [ ] 执行 Codex 真实闭环授权清单（`agent_memory/progress.md` 已备好：r10 安装、前台切换、读取/写回、未发送、撤销、Pending Outcome、Provider 连通性）。
- [ ] 浏览器扩展优先打磨：首次向导、错误恢复、Copy-only 兜底。
- [ ] 上架 Chrome Web Store（先提交审核，审核周期不可控）。
- **退出标准**：Codex + ChatGPT 双真实闭环证据新鲜；一位外部用户（非开发者本人）完成首次激活闭环。

### 阶段 C：小圈子好用（第 3-4 个月）

- [ ] 20-50 名真实内测用户（skills 作者 + vibe coding 用户）。
- [ ] 数据驱动迭代 2-3 轮，只改这四个指标：verified insert 成功率、生成后填入率、撤销率、失败原因分布。
- [ ] 解冻学习候选轻量版（Memory/Rule/Skill 提醒），仍冻结 Policy 灰度。
- **退出标准**：周留存稳定；≥80% 失败可两步内恢复；内测用户愿意推荐。

### 阶段 D：可推广的好用（第 6-9 个月）

- [ ] Authenticode 签名安装包；公开商店双端可用。
- [ ] 付费意愿验证 → 定价（BYOK 买断 vs 订阅，参照 Monica $9.9/月 与 PromptBase 均价 $8.5 的差异化区间）。
- [ ] 教程与内容资产成套。
- **退出标准**：可收费、可公开宣传、指标达标。

## 4. 30 天推广计划（冷启动）

### 4.1 内容策略：把验证文化变成内容

- 直接复用：`docs/competitive-analysis.md`、第一性原理复盘、对抗审查报告（脱敏后）。
- 主打故事："我们四轮对抗审查真实抓出并修复 3 个 P1 级安全漏洞"——诚实工程故事在开发者圈吸粉。
- 高频素材：ChatGPT 真实闭环 144 秒全过程、撤销/不发送的对比演示 GIF（用 `outputs/` 现成截图资产）。

### 4.2 渠道优先级

| 渠道 | 打法 |
| --- | --- |
| 国内：V2EX / 即刻 / 知乎 | 发"prompt 已死？输入瞬间的 context 增强"观点文 |
| 国内：小红书/B 站 AI 测评博主 | 投喂免费 license，重点找 vibe coding 教程博主 |
| 海外：Product Hunt / Show HN | Chrome Web Store 上线后首打 |
| 海外：X `#contextengineering` `#claudecode` `#skills`；Reddit `r/vibecoding` `r/ClaudeCode` | 项目调研引用的痛点来自这些社区，回去引用原文发帖 |
| 生态借力（最省力） | 兼容 agentskills.io / SKILL.md；对 skills 作者说："你的技能写得再好，用户想不起来用也白搭；提笔在输入瞬间提醒他。" skills 作者是最易转化的种子用户 |

### 4.3 周动作清单

- **第 1 周**：git 入库；官网单页（三句话 + 3 步 GIF）；提交 Chrome Web Store 审核。
- **第 2 周**：从上述渠道招募 20-50 名内测（免费、自带 Key）；建反馈群（飞书/微信/Discord 选一）。
- **第 3-4 周**：只收集四个指标；不开发任何新功能；记录付费意愿问法结果。

## 5. 核心指标（数据回来前不扩张）

| 指标 | 含义 |
| --- | --- |
| verified insert 成功率 | 是否稳定回到正确输入框 |
| 生成后填入率 | 产品实际价值 |
| 撤销率 | 识别误填与质量问题 |
| 失败原因分布 | 决定下一轮改什么 |

## 6. git 分批提交方案（阶段 A 第一步，待确认后执行）

按目录分批，每批一条中文 commit message，建议顺序：

1. `docs: 记录第一性原理复盘、阶段 0-2 契约与对抗审查`（docs/、outputs/、workflows/）
2. `feat: 共享 prompt-session 与 assistant-ui 单源 + sync 机制`（packages/prompt-session、packages/assistant-ui、scripts/sync-*）
3. `feat: 阶段 3 激活闭环与控制中心`（apps/local-service/src/modules/activation、apps/desktop-shell/src/control-center-*）
4. `feat: Codex Outcome Learning Loop v1`（packages/outcome-learning、apps/local-service/src/modules/{learning,outcomes,policies}、benchmarks/）
5. `feat: native sidecar 与桌面写回守卫加固`（apps/local-service-sidecar/、packages/shared/desktop-tool-profiles*）
6. `test: 验证脚本与 evidence 收口`（scripts/、research/）
7. `chore: 构建产物、安装包与记忆文件`（agent_memory/、其余杂项）

注意：提交前先 `git add` 干跑 + 确认 `.gitignore` 覆盖 `target-*` 与 `.runtime`；push 到 `origin`（GitHub private repo）需要一次确认。

## 7. 明确不做（本轮冻结，防止范围漂移）

- 不新增站点、桌面工具、Provider、分析面板。
- 不重启 WorkBuddy UIA 攻坚、macOS 适配、Remotion 动画深化。
- 不做云端账号、团队同步、Marketplace、远程遥测。
- 不自动运行真实 GUI 写入、真实付费 benchmark（分别等授权）。
- 不在数据回来前做任何新功能。

## 8. 风险与守卫

- 一切真实写回仍守三条件：foreground + safe candidate + 用户明确授权。
- 不因改品牌名破坏验证资产：manifest 名、包名、脚本路径暂不动。
- 收缩 Node/Rust 双实现时以 `phase3-contract.test.js` 与 `cargo test` 为回滚安全网，小步提交。
- 若第 2 周内测招募 <10 人，先回渠道补内容，不继续做工程。
