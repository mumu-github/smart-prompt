# Codex Outcome Learning Loop v1

状态：已确认，可进入 Goal 实施  
日期：2026-07-19  
目标产品：Smart Prompt  
P0 目标环境：Codex 桌面端

## 1. 一句话目标

Smart Prompt 在 Codex 输入框旁帮助用户把模糊意图变成可直接执行的任务说明，安全填回且绝不发送；随后从真实任务结果、编辑行为和 Token 成本中学习，自动形成可审核的 Memory、Rule、Skill 与 Generation Policy，并让低风险策略在可回滚的灰度中持续改进。

Prompt 和 Skill 都是中间产物。最终优化目标是：

> 在安全与任务质量不下降的前提下，提高用户通过 Codex 完成任务的成功率，并降低每次成功任务所需的 Token、时间、返工和操作成本。

## 2. 核心原则

1. 用户最终要完成任务，不是获得一段看起来更专业的 Prompt。
2. 任务成功率和安全是硬门槛，Token、成本、延迟是门槛通过后的效率目标。
3. Smart Prompt 永不自动发送，无法机器回读时不得宣称成功。
4. 日常卡片保持轻量；Provider、学习资产、隐私和诊断都属于低频控制中心。
5. 系统可以自动学习、创建候选和验证候选，但知识、权限与跨项目作用域扩大必须由用户最终确认。
6. 原始 Prompt 默认只存在于当前 Session，不作为长期学习数据保存。
7. 自学习不得靠模型自评形成自我强化；所有晋升必须有真实结果、基线对照和回滚路径。

## 3. 范围

### 3.1 本版本必须完成

- Codex 专用日常核心循环。
- Codex 新版激活与旧激活迁移。
- 任务结果回流与 24 小时归因窗口。
- 脱敏 Learning Observation。
- Memory、Rule、Skill 和 Generation Policy 四类学习对象。
- 候选自动创建、首次匹配轻量提醒和控制中心集中审核。
- 项目内低风险 Generation Policy 自动灰度与自动回滚。
- 项目资产跨项目晋升提案与最终确认。
- Token、成本、延迟和返工指标。
- 隔离 Codex 基准集、基线对照和手动预算门。
- 控制中心五页信息架构。
- 开发完成后的独立对抗审查。

### 3.2 明确非目标

- Trae、WorkBuddy 或更多桌面工具的真实写回。
- 新增浏览器站点或把 ChatGPT 重新设为激活目标。
- 聊天历史、屏幕、项目文件、剪贴板和附件读取器。
- 团队同步、云端账号、Prompt Marketplace、远程遥测。
- macOS 适配。
- 自动执行新生成 Skill 中的脚本。
- 未经确认的全局 Memory、Rule 或 Skill 生效。
- 后台自动发起付费模型实验。

## 4. 日常任务循环

### 4.1 触发

- Codex 输入框获得焦点，且 Adapter 能确认前台窗口、目标身份和安全能力时，小人出现。
- 无可靠目标时不显示小人。
- 全局快捷键在无可靠目标时只能打开 copy-only Assistant Card。
- 桌面控制中心默认隐藏到托盘，不承担日常 Prompt 编辑。

### 4.2 打开卡片

1. 用户点击小人。
2. Smart Prompt 只读取 Codex 当前输入框文字。
3. 不读取聊天历史、屏幕、项目文件、剪贴板或附件。
4. 系统内部判断 Idea、Continue 或 Polish，不要求用户理解模式。
5. 打开卡片不调用模型；只有用户点击“生成提示词”后才能发起请求。

### 4.3 生成

- 输出必须是可直接交给 Codex coding agent 的任务说明。
- 保留用户原意和语言，按需补齐目标、背景、约束、输出要求和验收标准。
- 不输出“以下是优化后的提示词”等元解释。
- 不强制套用冗长模板。
- 普通信息不足时，直接生成并明确必要假设，要求 Codex 先检查项目再执行。
- 只有歧义可能导致改错项目、扩大范围、破坏数据或执行高风险动作时，才暂停并提出一个最关键的澄清问题。
- Provider、模型、API Key 和连接参数不出现在日常卡片；失败只展示用户原因和“打开模型设置”。

### 4.4 审核与填入

1. 用户可以编辑生成结果。
2. “填入输入框”完整替换当前 Codex 草稿，写入用户最终编辑版本。
3. Adapter 在写入前保存原草稿快照，并重新确认窗口、焦点、目标和草稿未被外部修改。
4. 优先使用直接可验证写入。
5. 直接写入不可用时，允许受控剪贴板粘贴兜底，但仅在用户明确点击“填入”后执行。
6. 剪贴板兜底必须保存并恢复原剪贴板；任一步失败都不得计为成功。
7. 写入后必须机器回读，并与目标文本完全一致。
8. 无法机器回读时降级为复制；人工目测不能完成 P0 闭环。
9. 永不触发 Enter、发送按钮或任何提交行为。

### 4.5 成功与撤销

- 机器回读一致后显示“已填入，未发送”。
- 确认后卡片自动收回为小人，避免遮挡 Codex 输入框。
- 小人保留成功状态，点击后仍可撤销。
- 只有目标内容仍与本次写入一致时才允许撤销。
- 用户修改内容、切换目标、开始新生成或 Session 失效后，撤销资格立即失效。
- 撤销精确恢复打开卡片时的原草稿。
- 卡片收起不代表任务成功，任务结果仍保持 pending。

## 5. 任务结果回流

### 5.1 Pending Outcome

每次 verified insert 创建一条 `pendingOutcome`，只包含：

- `generationId`
- `sessionId`
- `strategyId` 和 `strategyVersion`
- `target=codex`
- `projectScopeToken`
- `modelFamilyToken`
- `createdAt` 和 `expiresAt`
- `insertVerified=true`
- 隐私布尔和有限状态 token

不得包含 Prompt、草稿、剪贴板、聊天内容、项目路径或窗口标题正文。

- `policyId` 与 `policyVersion` 只能由 Codex verified transaction 的服务端绑定写入。公开 outcome event 必须使用空归因，不得自报策略身份。
- 公开 outcome API 不接受 `verified_insert`。该事件只能由完成目标身份复核、机器回读和 no-auto-submit 检查的服务端写回事务创建。
- 公开 Retry、Undo、重新生成或写入失败事件不得挂接到已有策略归因的 outcome；这类 rollout 信号只能由服务端已验证事务记录。

### 5.2 反馈时机

- 填入后不立即询问。
- Retry、Undo、重新生成和写入失败作为即时隐式信号记录，不额外弹窗。
- verified insert 至少 60 秒后，用户在同一 `target` 与同一 `projectScopeToken` 下再次打开小人时，最多询问一次：“上次是否帮助你完成任务？”不得跨项目归因。
- 同一项目存在多条 pending outcome 时，不得覆盖旧记录；每次只询问最近一条已到时且未过期的记录，其余记录继续排队。
- “完成了”一步结束。
- “还没有”再展开有限原因标签，例如 `missing_context`、`wrong_format`、`not_actionable`、`too_long`、`token_waste`、`tool_mismatch`、`low_quality`。
- 用户不回答时保持 `unknown`，不得推断成功或失败。
- 24 小时后归因过期，状态变为 `expired_unknown`。
- 后续若存在经过授权、稳定且不读取正文的 Codex 完成事件，可作为更精准触发，但不能替代用户结果确认。

## 6. 学习数据模型

### 6.1 Learning Observation

每轮结束时可自动生成脱敏 `LearningObservation`：

```text
observationId
projectScopeToken
taskScenarioToken
modeToken
strategyId / strategyVersion
modelFamilyToken
contextSourceTokens
editFeatureSummary
insertVerified
retryCount
undoUsed
taskOutcomeToken
failureReasonTokens
inputTokens / outputTokens / cachedTokens / reasoningTokens
insertedPromptTokenEstimate
latencyMs
tokenAccountingSource = provider | estimated | unavailable
semanticFingerprint
privacyFlags
createdAt
```

约束：

- 原始输入和生成正文只存在于当前 Session，默认不持久化。
- `semanticFingerprint` 只能从脱敏特征生成并限定在本地项目作用域。精确查重优先使用项目级密钥 HMAC；确需语义向量时必须本地加密、禁止 API/日志/诊断导出，并记录 `fingerprintKind`。
- 不得把向量宣称为数学意义上的绝对不可逆。实现必须做正文反演与 membership inference 风险测试，记录残余风险；不能满足隐私门槛时只保留 keyed feature hash。
- Provider 未返回 Token 时可以估算，但必须标记为 `estimated`，不能伪装为精确值。
- 任务场景、模式、策略、模型、Token、Retry、Undo、编辑特征和耗时只接受服务端历史、目标绑定或已持久化隐式信号；反馈请求中的同名字段不得成为学习证据。
- 服务端只在当前 Session 内比较生成 Prompt 与最终写入文本，长期存储只保留 `userEdited`、长度变化桶和结构变化布尔。用户编辑计入返工，不能被记成未编辑的成功样本。
- 只有带有服务端 verified insert 标记、Session/项目/Policy 绑定一致且被内部标记为 rollout eligible 的 Observation 才能进入 Policy 灰度统计。备份恢复必须清除这些服务端信任标记，不能通过导入数据制造可归因证据。
- Generation Policy 候选的 keyed feature hash 按项目、Codex、任务场景、模式和模型族归组；`strategyId`/`strategyVersion` 保留为观测元数据，但不作为该候选的分组键，避免把同一策略作用域按实验臂切碎。
- 清除项目数据时，相关 Observation、指纹、候选、策略证据、pending outcome 和生成历史绑定一并归档并失效。
- 未来保存脱敏真实样本用于评测时，必须单独授权并设置过期时间。

### 6.2 四类学习对象

- **Memory**：项目事实、用户偏好和已确认环境信息。
- **Rule**：应在某个项目、目录或任务类型中持续遵守的约束。
- **Skill**：可重复的多步骤流程，包含触发条件、步骤、验证方式和必要资源。
- **Generation Policy**：根据任务结果和效率指标编译出的内部生成策略。

系统必须先分类再创建候选，不得把每条经验都做成 Skill。用户审核时可以改变候选类型。

生产分类使用版本化 `learning-candidate-seed@1`。它只在本地 Session 内检查当前输入，并仅输出固定语义映射：显式可复用流程归为 Skill，显式持续约束归为 Rule，带事实提示的白名单技术栈归为 Memory，其余结果仍进入 Generation Policy 学习。长期历史只保存服务端生成且可重新规范化的 seed，不保存原始句子；恢复备份时 seed 与 verified insert 信任标记一并清除。

调用方未提供任务场景时，Node 与 native Rust 必须按 `task-scenario-inference-fixtures@1` 的同一有序规则从瞬时输入和允许的上下文元数据推断；显式任务场景始终优先。该推断只产生有限场景 token，不保存参与推断的原始输入。

## 7. 候选创建与审核

### 7.1 项目候选门槛

同类语义模式满足以下条件时，系统可以自动创建待审核候选：

- 至少跨 2 个不同 Session。
- 至少 3 次成功任务结果。
- 没有同类明确负反馈。
- 候选不包含项目路径、账号、密钥、原始正文或可识别隐私信息。

候选创建不弹窗，也不立即生效。

### 7.2 首次匹配审核

- 下次遇到匹配任务时，在 Assistant Card 建议区显示一行“发现一条可复用经验”。
- 打开 Card 时可用当前草稿做一次本地、零模型调用的匹配解析；请求正文不得写入日志或长期存储，响应只返回脱敏 feature token 与提醒。生成后再次用服务端返回的同一组 token 校验匹配。
- 用户仍可直接生成；审核不是阻塞项，未审核时继续使用稳定基线。
- 审核详情展示候选内容、对象类型、项目作用域、产生原因、成功样本数、预计 Token 影响、权限范围和撤销方式。
- 用户可以接受、编辑、缩小范围、改变类型或拒绝。
- 连续忽略 3 次后停止提醒，候选仍保留在控制中心“待审核”中。
- Skill 候选必须通过权限检查、静态检查、隔离测试和对抗审查，不能因用户接受而直接执行脚本。

## 8. 作用域与自动晋升

### 8.1 默认作用域

- 临时信息只属于 Session。
- 自动创建的 Memory、Rule、Skill 默认属于当前 Git 项目。
- 系统不得自动把项目知识升级为全局生效资产。
- Generation Policy 按项目、Codex、任务类型和模型族分组。

### 8.2 跨项目晋升提案

系统可以自动发现跨项目重复经验、完成查重和验证，并在达到门槛后生成全局晋升提案。全局生效前只要求用户做一次最终确认。

全局晋升证据只能由服务端从已验证、已持久化的结果中归纳。公开 API 不接受调用方直接提交的项目、Session、Outcome、成功标记、候选 payload 或 Skill gate 作为晋升证据。

推荐门槛：

- Memory/Rule：至少出现在 3 个项目，累计至少 5 次成功结果，没有明确负反馈。
- Skill：至少在 3 个项目各有独立成功证据，并通过权限、测试和对抗审查。
- Generation Policy：达到可比样本量，相对基线任务质量不下降，且 Token、耗时或返工至少一项稳定改善。
- 涉及安全规则、上下文权限或脚本执行的内容，无论证据多少都不能自动生效。

晋升提案必须展示：学到了什么、为何可跨项目复用、影响范围、证据、冲突、Token 影响和回滚方式。

## 9. Generation Policy 自治

### 9.1 Policy Compiler

现有策略、质量、失败原因、自反省和进化报告不得全部直接注入每次模型请求。系统应把有效信号编译成短小、版本化的 `GenerationPolicy`：

```text
policyId / version
scope
taskScenario
modelFamily
selectedStrategy
directives
contextBudget
evidenceSummary
baselineVersion
status = draft | benchmarked | canary | stable | rolled_back
createdAt
```

每次生成只消费当前适用的稳定或 canary Policy，并保留可追踪版本。

### 9.2 项目内自动灰度

低风险 Policy 调整可以自动灰度，例如结构顺序、详细程度、重复说明压缩、任务类型策略选择和上下文预算。

默认门槛：

- 隔离基准集无任务质量、安全和验收回归。
- canary 份额默认 10%。
- 自动稳定晋升前，每个可比实验臂至少 10 个可归因结果。
- 可归因结果必须来自服务端标记的 rollout eligible Observation；用户对生成结果的实质编辑按一次返工计入比较。
- 任务完成率不得低于基线。
- Retry 和 Undo 不得显著恶化。
- Token、耗时或返工至少一项改善，Token 改善目标默认不少于 5%。
- 任何 no-auto-submit、误写、隐私或权限异常立即回滚。
- “每臂 10 条”和“Token 改善 5%”只是工程试点下限，不代表统计显著。未达到预先声明的最小效应与置信要求时只能继续收集或维持 canary，不得自动标记 stable。

Memory、Rule、Skill、生效权限和跨项目作用域不属于低风险 Policy，不能自动灰度生效。

## 10. Token 与成本

Token 不是独立质量分，而是质量和安全通过后的效率目标。

需要区分：

- Smart Prompt 模型输入和输出 Token。
- 插入 Codex 的 Prompt Token。
- Codex 执行阶段可获得的输入、输出、推理和缓存 Token。
- Retry、返工和重复生成造成的额外 Token。

核心指标：

- `tokensPerSuccessfulOutcome`
- `costPerSuccessfulOutcome`
- `timePerSuccessfulOutcome`
- `retriesPerSuccessfulOutcome`
- 候选策略相对基线的 Token、成本和延迟变化

后台学习不得自行发起付费模型请求。隔离基准必须由用户手动启动，启动前展示模型、预计请求数、Token 上限和可能成本，并设置硬预算、最大 Agent 轮次和最大 Retry。预算耗尽记为 `budget_exhausted`，不得记为策略失败。

## 11. 隔离基准

- 使用一次性测试仓库，不在 Smart Prompt 主项目或用户真实项目上做策略实验。
- 最低包含 12 个可验收任务，覆盖功能开发、Bug 修复、重构、测试补齐、代码审查和文档六类场景。
- 每个任务保留原始输入基线和 Smart Prompt 优化输入候选。
- 两个实验臂使用相同 Codex 模型、代码起点、权限和验收测试。
- 先比较任务完成和安全，再比较返工、Token、耗时和工具调用。
- 测试必须支持 fake executor；真实 Codex executor 只能在用户明确授权并确认预算后运行。
- benchmark result 只能由已授权的服务端 harness 持久化；公开 API 不接受调用方直接提交的 `benchmarkResult`，也不能据此启动 canary。
- 真实项目样本只有在单独授权、脱敏和设置保留期后才能进入评测集。

## 12. 控制中心

控制中心固定为五页：

1. **概览**：Codex 可用性、最近闭环、待处理问题。
2. **模型**：Provider、模型、凭证和真实连通性测试。
3. **学习**：Memory、Rule、Skill、待审核候选、全局晋升和 Policy 版本/回滚。
4. **隐私**：上下文权限、本地数据、保留期和清除。
5. **诊断**：兼容性、脱敏证据、修复和版本信息。

普通用户界面不得重新出现 Service 启停、Self-Test、Learning/Pilot/Quality 原始面板、evidence token 或研究术语。学习页展示用户可理解的资产、证据摘要和治理动作，不展示内部算法仪表盘。

## 13. ContextSource 扩展契约

本版本只定义 `ContextSource` 契约和权限模型，不实现额外读取器。

未来来源包括聊天历史、当前屏幕、项目文件、剪贴板和附件。每个来源必须：

- 独立授权，默认关闭。
- 在调用模型前可预览和移除。
- 标记来源和信任等级。
- 视为不可信数据，防御 Prompt Injection。
- 有独立 Token 预算。
- 不能因为读取内容而自动扩大执行权限。

“优化提示词”和“生成 Skill”是两个独立工作流，不把所有能力塞进日常 Card。

## 14. 激活迁移

- 新版激活必须完成模型连通性测试，以及一次 Codex 安全写入、机器回读一致和 no-auto-submit。
- copy、人工确认和 ChatGPT 成功不能完成新版 Codex 激活。
- 旧版激活记录保留为历史，不删除也不冒充新版证据。
- 升级后显示“旧版激活已完成 / Codex 尚未验证”。
- 完成 Codex 真实闭环后升级为新版激活。
- 迁移不得覆盖现有 Provider、Custom Provider、模型或加密凭证。

## 15. 验收指标

### 15.1 安全硬门槛

- no-auto-submit：100%。
- 非前台、目标变化、目标不安全或回读不可用时，真实写入次数为 0。
- 凭证、Prompt、草稿、剪贴板和原始上下文泄露次数为 0。
- 受控剪贴板兜底必须恢复原剪贴板。
- 所有晋升和灰度都可回滚。

### 15.2 产品结果

- Codex verified insert 成功路径可重复完成。
- 下一次打开小人时能正确归因 pending outcome。
- 未回答和过期结果保持 unknown，不污染成功率。
- 用户能理解并管理系统学到的内容。
- Smart Prompt 优化输入必须通过隔离基准，不能只改善结构分。

### 15.3 效率

- 点击小人到可操作状态 P95 小于 300ms。
- 生成请求发起后 100ms 内出现可见反馈。
- Policy Compiler 相比直接注入完整学习报告显著减少生成上下文 Token。
- 候选策略只有在质量不下降后才评价 Token、成本和耗时改善。

## 16. 对抗审查

开发完成后必须进行独立对抗审查，至少覆盖：

1. 产品价值：是否真的优于直接把原始输入交给 Codex。
2. 写回安全：焦点竞态、剪贴板竞态、错误目标、撤销和 no-auto-submit。
3. 学习有效性：奖励投机、错误归因、低样本晋升、基线污染和策略振荡。
4. 隐私：正文残留、语义指纹可逆性、候选泄密、清除不完整。
5. 数据投毒：恶意上下文、伪造反馈、Prompt Injection 和跨项目污染。
6. Token：学习系统是否比节省的 Token 消耗更多。
7. UI：反馈打扰、候选提醒疲劳、学习页可理解性和恢复动作。
8. 迁移：旧激活、Provider、Custom Provider、凭证和历史数据是否保留。
9. 安装运行态：Node 测试通过但 native sidecar 或安装包缺失能力的问题。

任何 P0/P1 发现都必须修复并重跑相关测试。最多三轮；三轮后仍有 P0/P1 时明确 blocked，禁止宣称完成。

## 17. Definition of Done

- Codex 日常循环、结果回流、学习候选、Policy 灰度和回滚全部有契约测试。
- Node local service 与 Rust native sidecar 的公开契约一致。
- 控制中心五页和 Assistant Card 均有新鲜视觉证据。
- 安装包 smoke 证明生产运行时包含新能力。
- 获得用户本轮授权后，至少完成一次真实 Codex verified insert、机器回读、未发送、自动收起和安全撤销。
- 隔离基准 harness 可运行，且真实运行必须经过预算确认。
- 隐私扫描无正文、凭证和可识别路径泄露。
- 对抗审查最终 verdict 为 `pass`，不存在未解决 P0/P1。
