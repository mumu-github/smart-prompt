# Smart Prompt Codex Outcome Learning Loop v1 Goal 提示词

日期：2026-07-19  
工作流规格：`workflows/codex-outcome-learning-loop-v1.md`  
产品基线：`docs/smart-prompt-first-principles-product-plan-2026-07-17.md`

## 使用方式

在新的 Codex Goal 任务中粘贴下方提示词。该提示词只在用户明确启动 Goal 后执行；阅读本文件本身不授权真实 GUI 写入、付费基准运行、安装或发布。

若同时使用 `oh-my-codex:autoresearch-goal`，必须遵循该 skill 的 `get_goal` 快照、professor-critic verdict、完成对账和 Goal 生命周期，不得让 hook 或 shell 命令伪造 Codex Goal 状态。

## 可直接粘贴的 Goal 提示词

```text
目标：在 C:\Users\lhy10\Documents\Smart Prompt 中完成“Codex Outcome Learning Loop v1”。以 workflows/codex-outcome-learning-loop-v1.md 为本 Goal 的产品与行为事实源，以 docs/smart-prompt-first-principles-product-plan-2026-07-17.md、docs/product-contract.md 和 docs/assistant-state-spec.md 为现有产品契约。若旧阶段文档与本 Goal 冲突，以已经确认的 workflow 规格为准，并把必要的契约变化明确记录为新版本，不要静默改写旧语义。

第一性原理目标：Smart Prompt 不再只优化 Prompt 的表面结构，而是持续提高用户通过 Codex 完成任务的成功率；在任务质量与安全不下降的前提下，降低每次成功任务所需的 Token、时间、Retry、Undo 和返工。Prompt、Memory、Rule、Skill 与 Generation Policy 都是服务任务结果的中间产物。

P0 唯一真实目标：Codex 桌面端。ChatGPT 仅保留回归验证；Trae、WorkBuddy、更多桌面工具和更多站点不在本 Goal 范围内。

开始前必须确认的当前事实：
- 工作区有大量用户与历史未提交改动。先读 git status、PROJECT.md、agent_memory/context.md、agent_memory/progress.md、agent_memory/bugs.md、workflow 规格和相关代码；不得覆盖、回退、清理或重排无关改动。
- 阶段 0/1/2 已建立 packages/prompt-session/ 和 packages/assistant-ui/ 两个共享源码源；浏览器与桌面不得重新分叉。
- 当前生产 native build ID 为 phase3-native-sidecar-20260719-r18；Node local service 和 Rust native sidecar 都存在公开运行时契约，不能只实现 Node 测试路径。
- 当前 Activation 仍以旧版 ChatGPT first loop 为中心，需要版本化迁移为 Codex Outcome Loop，不得删除或伪造旧激活记录。
- 当前 Provider 设置已支持 Agnes、OpenAI-compatible、Anthropic、Gemini 和 Custom Provider。必须保留用户现有 Provider、Custom Provider、模型和加密凭证；测试默认使用临时数据目录和假凭证，不得覆盖真实配置。
- packages/shared/prompt-quality/ 已包含评分、反馈、策略、质量提升、失败原因、自反省和进化候选。现有 evolution candidate 是 manual_review_required、mutationAllowed=false、requiresCritic=true。复用这些能力，但不要继续把完整报告文本全部注入每次模型请求。
- 旧 Codex、WorkBuddy 或其他桌面写回报告可能过期。任何真实能力结论必须来自本 Goal 同轮、新鲜、可追踪证据。

必须交付以下纵向切片：

一、版本化产品与学习契约
1. 为 Codex Outcome Learning Loop 定义版本化 JSON/JS 契约，至少覆盖：Prompt Session 扩展事件、Codex Target Adapter 结果、pending outcome、Learning Observation、四类 learning artifact、Generation Policy、policy rollout、benchmark result 和 runtime evidence。
2. Node 与 Rust 必须消费同一组 schema fixture 或通过同一组契约测试，禁止再次形成字段同名但语义不同的双实现。
3. 所有公开状态使用有限枚举和用户原因映射，不向 UI 暴露内部 failure token、candidate score 或 evidence 原文。
4. 更新 product/state 文档并记录兼容版本；不得破坏 prompt-session@1 已有正常、阻断、copy-only、人工确认和撤销行为。

二、Codex 专用 Target Adapter 与安全写回事务
1. 只有 Codex 输入框获得焦点，且能确认前台窗口、目标身份和安全能力时才显示小人。
2. 无可靠目标时不显示小人；全局快捷键只能进入 copy-only Assistant Card。
3. 打开卡片只读取 Codex 当前输入框文字，不读取聊天历史、屏幕、项目文件、剪贴板或附件。
4. 打开卡片不得调用模型；用户点击“生成提示词”后才允许请求。
5. 生成结果必须是可直接交给 Codex coding agent 的任务说明；保留用户原意和语言，按需补齐目标、背景、约束、输出和验收，禁止冗长元解释和固定大模板。
6. 普通缺失信息使用明确假设继续生成。只有歧义可能改错项目、扩大范围、破坏数据或触发高风险操作时，才暂停并提出一个最关键的澄清问题。
7. Fill 完整替换当前草稿。写入前保存原草稿快照，并重新验证窗口、焦点、目标、payload 新鲜度和草稿未被外部修改。
8. 优先直接可验证写入。直接写入不可用时，允许用户点击 Fill 后使用受控剪贴板粘贴：保存原剪贴板、再次确认前台/焦点、粘贴、机器回读、恢复原剪贴板。任一步失败都必须降级或报错，不得计成功。
9. 只有机器回读与目标文本完全一致时才返回 verified insert。无法回读时只能复制，人工目测不能完成 P0 闭环。
10. 永远不触发 Enter、发送按钮、快捷发送或任何提交行为。
11. verified insert 后先显示“已填入，未发送”，再自动收回为小人。目标内容未变化时允许精确撤销；内容、窗口、目标或 Session 变化后立即撤销失效。

三、Codex Activation v2 与迁移
1. 新版激活必须包含模型真实连通性测试，以及一次 Codex 安全写入、机器回读一致和 no-auto-submit。
2. copy、人工确认和 ChatGPT 成功都不能完成 Codex Activation v2。
3. 保留旧激活记录并标记为 legacy；升级后允许同时表达“旧版激活已完成”和“Codex 尚未验证”。
4. 完成 Codex 真实闭环后才升级到 Codex v2 activated。
5. 迁移必须幂等、可回滚，不得覆盖 Provider、Custom Provider、模型、Key 或旧证据。
6. 激活状态与瞬时运行健康继续分离，短暂故障不得抹掉已完成的历史激活。

四、Pending Outcome 与任务结果回流
1. 每次 verified insert 创建脱敏 pendingOutcome，只保存 generation/session/strategy/version/target/project-scope/model-family/time/status/privacy token。
2. Retry、Undo、重新生成和写入失败作为隐式行为信号，不额外打扰用户。
3. verified insert 至少 60 秒后，用户在同一 target 与同一 projectScopeToken 下再次打开小人时最多询问一次“上次是否帮助你完成任务？”，不得跨项目归因。
4. “完成了”一步结束；“还没有”再展示白名单原因，包括 missing_context、wrong_format、not_actionable、too_long、token_waste、tool_mismatch、low_quality 和 insert_failed。
5. 用户不回答时保持 unknown。24 小时后改为 expired_unknown，不能计入成功或失败。
6. 同一 outcome 事件必须幂等，不能因重复打开、重启或 IPC 重试重复计数。
7. 多条 pending outcome 不得互相覆盖；每次只询问最近一条已到时且未过期的记录，其余继续排队。
8. 公开 outcome API 不接受 verified_insert；只有完成目标复核、机器回读与 no-auto-submit 检查的服务端写回事务可以创建。

五、Learning Observation 与隐私存储
1. 每轮结束后可自动生成脱敏 LearningObservation，字段按 workflow 规格实现。
2. 原始输入、生成 Prompt、聊天正文、剪贴板正文、窗口标题和项目绝对路径默认只存在于 Session 内存，不长期持久化。
3. 指纹只能从脱敏特征生成并限定在本地项目作用域。精确查重优先使用项目级密钥 HMAC；确需语义向量时必须本地加密、禁止导出并标记 fingerprintKind。不得宣称向量绝对不可逆，必须测试正文反演与 membership inference 风险；不达隐私门槛时只保留 keyed feature hash。
4. Token 来源必须区分 provider、estimated、unavailable，不得伪造精确统计。
5. 清除项目数据时，必须让 Observation、指纹、候选、Policy 证据和 pending outcome 一并失效。不得永久删除文件；使用项目现有可恢复归档或已验证 Windows 回收站机制。
6. 未来真实样本保存需要独立授权和过期时间，本 Goal 不默认启用。
7. 生成 Prompt 与最终写入文本只在 Session 内比较，长期仅保存编辑特征摘要；备份恢复必须清除 verified insert、Session 绑定和编辑摘要等服务端信任标记。
8. 清除项目数据时还必须归档并使生成历史绑定失效，不能让恢复或清除后的旧证据继续参与学习。

六、四类学习对象与候选管线
1. 实现 Memory、Rule、Skill 和 Generation Policy 四类对象及有限状态。
2. 至少跨 2 个 Session、3 次成功任务结果且没有同类明确负反馈时，系统可以自动创建项目级待审核候选。
3. 候选自动创建不弹窗、不生效、不包含项目路径、密钥、原始正文或隐私信息。
4. 下次匹配任务时，Card 建议区只显示一行轻量提醒；用户可以忽略并直接生成，未审核时继续使用稳定基线。
5. 审核详情必须显示内容、类型、项目作用域、产生原因、成功样本数、预计 Token 影响、权限范围和撤销方式，并允许接受、编辑、改类型、缩小范围或拒绝。
6. 连续忽略 3 次后停止 Card 提醒，候选仍进入控制中心待审核列表。
7. Skill 候选必须有触发条件、步骤、验证方式、资源清单、权限声明和失败恢复；脚本默认不可执行，必须经过权限检查、隔离测试和对抗审查。

七、作用域与全局晋升
1. 临时信息属于 Session；自动 Memory/Rule/Skill 默认属于当前 Git 项目；系统不得静默全局化。
2. Generation Policy 按项目、Codex、任务类型和模型族分组。
3. 系统可以自动归纳跨项目同义经验、去除项目专属内容、检查冲突并生成全局晋升提案。
4. Memory/Rule 全局提案门槛：至少 3 个项目、累计至少 5 次成功、没有明确负反馈。
5. Skill 全局提案门槛：至少 3 个项目各有独立成功证据，并通过权限、测试和对抗审查。
6. 全局提案必须展示学到了什么、为何可迁移、影响范围、证据、冲突、Token 影响和回滚方式。
7. 只有用户最终确认后才创建全局生效版本。安全规则、上下文权限和脚本执行永远不能因样本门槛自动生效。
8. 全局晋升证据只能由服务端从已验证结果派生；公开 API 不接受调用方直接提交项目、Session、Outcome、成功标记、payload 或 Skill gate 作为证据。

八、Generation Policy Compiler、灰度与回滚
1. 新增 Policy Compiler，把现有 strategy/quality/failure/self-improvement/evolution 信号编译为短小、版本化、可追踪的 GenerationPolicy。
2. 每次生成只消费一个适用的 stable 或 canary Policy；不得继续把多份完整学习报告作为长文本全部注入 LLM。
3. Policy 至少有 draft、benchmarked、canary、stable、rolled_back 状态，并记录 scope、taskScenario、modelFamily、directives、contextBudget、evidence summary、baseline 和版本。
4. 允许项目内低风险 Policy 自动灰度：结构顺序、详细程度、重复说明压缩、任务策略和上下文预算。
5. 默认 canary 份额 10%。自动稳定晋升前，每个实验臂至少 10 个可归因结果；任务完成率不得低于基线，Retry/Undo 不得明显恶化，Token、耗时或返工至少一项改善，Token 改善目标默认不少于 5%。
6. 每臂 10 条与 5% 只是工程试点下限，不等于统计显著。预先声明最小效应与置信要求；证据不足时只能继续收集或保持 canary，不得自动标记 stable。
7. 任何安全、误写、no-auto-submit、隐私或权限异常立即自动回滚。提供用户可见的停用学习和回滚入口。
8. Memory、Rule、Skill、权限和跨项目作用域不属于低风险 Policy，不能自动生效。
9. 只有 verified insert、Session、项目与 Policy 绑定一致且被服务端标记为 rollout eligible 的 Observation 才能进入灰度统计；用户实质编辑按返工计入比较。

九、Token、成本和预算
1. 分别统计 Smart Prompt 输入/输出 Token、插入 Codex 的 Prompt Token，以及可获得的 Codex 输入/输出/推理/缓存 Token；统计 Retry 和返工的额外消耗。
2. 计算 tokensPerSuccessfulOutcome、costPerSuccessfulOutcome、timePerSuccessfulOutcome、retriesPerSuccessfulOutcome，以及候选相对基线的变化。
3. 质量和安全是晋升硬门槛；Token 不能单独驱动晋升。
4. 后台学习不得自动发起付费模型实验，项目灰度只能分配正常用户请求。
5. 手动基准运行前必须展示模型、请求数、Token 上限、最大 Agent 轮次、最大 Retry 和可能成本。预算耗尽使用 budget_exhausted，不得记为策略失败。

十、隔离 Codex 基准集
1. 建立一次性 fixture 仓库和 benchmark harness，不得在 Smart Prompt 主项目或用户真实项目上运行策略实验。
2. 最低包含 12 个可验收任务，功能开发、Bug 修复、重构、测试补齐、代码审查、文档各至少 2 个。
3. 每个任务包含 raw-input baseline、optimized-input candidate、相同代码起点和确定性验收。
4. 同一对照使用相同 Codex 模型、权限、起点和预算。先比较任务完成和安全，再比较返工、Token、耗时与工具调用。
5. harness 必须有 fake executor，保证 CI/常规测试不调用付费模型。
6. 真实 Codex executor 只能在用户对本轮明确授权并确认预算后运行；不得后台启动。
7. 真实项目样本只有在单独授权、脱敏和设置保留期后才能进入评测集。

十一、控制中心与 Assistant Card
1. 控制中心固定五页：概览、模型、学习、隐私、诊断。
2. 学习页管理 Memory、Rule、Skill、待审核候选、全局晋升、Policy 版本、canary 和回滚。
3. 学习页使用普通用户语言，不显示 Learning/Pilot/Quality/Segments 原始研究面板、算法评分或 evidence token。
4. 日常 Card 不展示 Provider、模型、API Key、策略分数或实验详情。模型失败只显示原因和“打开模型设置”。
5. Card 保持一个主操作，候选提醒不阻塞生成。中文和英文、键盘、焦点、reduced motion、Windows 125%/150%/200% 缩放均要验证。
6. 不能新增营销 Hero、主窗口 Prompt 工作台、Service 启停或 Self-Test 给普通用户。

十二、ContextSource 扩展契约
1. 只定义 ContextSource 的来源、信任等级、权限、预览、Token 估算和 collect 结果契约，不实现聊天历史、屏幕、文件、剪贴板或附件读取器。
2. 每个未来来源默认关闭、独立授权、调用模型前可预览和移除、视为不可信数据，并有独立 Token 预算。
3. 上下文内容不能扩大执行权限，必须防御 Prompt Injection。
4. “优化提示词”和“生成 Skill”保持两个独立工作流，不把 Skill Builder 塞进日常 Card。

十三、模块边界
1. packages/prompt-session/ 与 packages/assistant-ui/ 仍是唯一共享源，端侧副本只能通过现有同步脚本生成。
2. 为 outcome、learning artifacts、policy registry/compiler、benchmark 和 context source 建立清晰模块；HTTP 路由只做解析、认证和响应，不继续扩张 server.js 的业务编排。
3. 复用 packages/shared/prompt-quality/ 的现有纯函数；必要时进一步拆分，但不得进行与 Goal 无关的全仓重构。
4. Node local service 和 Rust native sidecar 必须实现生产需要的同等契约；安装包使用 native sidecar，因此 Node-only pass 不算完成。
5. 所有迁移先复制/验证再切换，保留恢复点，不永久删除旧数据。

隐私与安全硬约束：
- no-auto-submit 始终为 100%。
- 非前台、目标变化、目标不安全、草稿变化或回读不可用时，真实写入必须为 0。
- 不保存或导出 Key、Prompt、草稿、聊天正文、剪贴板正文、raw title、raw UIA/DOM 文本或项目绝对路径。
- 受控剪贴板兜底必须恢复原剪贴板，且有竞态和失败测试。
- keyed feature hash 不可导出；可选语义向量必须通过反演与 membership inference 风险测试，并能随项目清除而失效。
- 不得永久删除任何文件或目录；所有移除使用已验证可恢复机制。
- 真实 GUI 只使用预先定义的非敏感合成草稿；截图不得泄露正文。
- 不得通过放宽 safe candidate、foreground、readback 或 privacy guard 获取绿色报告。

明确非目标：
- Trae、WorkBuddy、更多桌面工具和更多网站。
- 实现聊天历史、屏幕、项目文件、剪贴板或附件读取。
- 团队同步、远程遥测、云端账号、Prompt Marketplace、macOS。
- 新 Provider；现有 Custom Provider 只做兼容回归。
- 自动执行生成 Skill 的脚本。
- 大型前端框架迁移、品牌重做和无关依赖升级。
- 用更多研究面板代替真实任务闭环。

实施纪律：
- 先建立失败测试和当前基线，再实现最小纵向切片。
- 每个切片完成后更新计划并运行最小必要验证，不在最后一次性补测试。
- 不修改或回退无关用户改动；触及已有脏文件时先理解当前差异。
- 普通单元/视觉测试使用 fake executor 和临时数据目录，不得消耗真实模型额度。
- 任何真实 Codex GUI 读取、写入、剪贴板操作、付费 benchmark、安装或前台切换，都必须先获得用户对本轮的明确授权。
- 命令验证、静态视觉、安装包 smoke、真实 Codex 写回和真实 benchmark 必须分开报告。

最低测试矩阵：
1. Prompt Session：正常生成、用户编辑、高风险澄清、copy-only、目标丢失、完整替换、verified insert、自动收起和撤销失效。
2. Codex Adapter：前台/后台、焦点变化、草稿变化、错误目标、direct write、剪贴板兜底、剪贴板恢复、精确回读、回读失败和 no-auto-submit。
3. Activation v2：新用户、旧版 activated、Codex 未验证、Codex 完成、幂等迁移、运行故障不抹除激活、Provider/Custom Provider 不丢失。
4. Outcome：pending 创建、60 秒前不询问、同项目下次打开询问一次、多 pending 排队、跨项目隔离、Retry/Undo 信号、重复事件、unknown、24 小时过期和重启恢复。
5. Privacy：文件、API、日志、诊断、research、semantic fingerprint 和候选扫描无正文、Key、绝对路径和可逆信息。
6. Learning artifacts：四类分类、2 Session/3 success 门槛、负反馈阻断、自动创建不生效、首次匹配提醒、忽略 3 次、接受/编辑/拒绝/改类型。
7. Promotion：3 项目门槛、查重、冲突、项目专属信息剥离、最终确认前不生效、确认后版本化、拒绝和回滚。
8. Policy：编译结果短小、版本选择、10% canary、每臂样本门槛、质量硬门、Token 次级目标、安全自动回滚和手动停用。
9. Token：provider/estimated/unavailable、缓存和推理 Token、Retry 成本、per-success 指标、无 Token 数据时不伪造。
10. Budget：后台零付费请求、基准预估、硬预算、最大轮次、最大 Retry、budget_exhausted 不污染策略失败率。
11. Benchmark：12 个 fixture、raw/optimized 两臂、相同起点、验收脚本、fake executor 和真实 executor 授权门。
12. ContextSource：默认关闭、独立权限、预览/移除、Token 预算、信任等级和 Prompt Injection 夹具；没有真实读取器。
13. UI：五页控制中心、学习页候选与回滚、Card 不暴露内部术语、候选提醒不阻塞、无旧研发面板、缩放/键盘/语言无溢出。
14. Native parity：Rust sidecar 与 Node 的 schema、迁移、outcome、policy 和隐私响应一致。
15. 打包：prepare-dist、prepare-sidecar、Tauri build、安装包资源和 installed runtime smoke。
16. 获得授权后的真实 GUI：Codex 聚焦后小人出现，生成、编辑、完整替换、机器回读、未发送、自动收起和安全撤销；随后验证 pending outcome 的下一次打开反馈。

开发后必须执行独立对抗审查：
- 产品价值审查：同一任务原始输入是否已经足够，Smart Prompt 是否增加无效摩擦或冗长 Prompt。
- 写回安全审查：窗口/焦点/剪贴板竞态、错误目标、stale payload、撤销、自动收起和 no-auto-submit。
- 学习有效性审查：reward hacking、把 Insert 当任务成功、错误归因、低样本晋升、baseline 污染、模型/项目串组、策略振荡和沉默样本误判。
- 隐私审查：正文残留、语义指纹可逆、候选泄密、诊断/日志泄露、清除不完整和旧迁移残留。
- 数据投毒审查：恶意上下文、伪造反馈、候选诱导扩大权限、Prompt Injection、跨项目污染和生成 Skill 供应链风险。
- Token 审查：学习报告是否继续膨胀请求、评测成本是否超过节省、缓存和估算是否被误报。
- UX 审查：反馈时机、候选提醒疲劳、学习页理解成本、错误恢复和控制中心职责。
- 生产一致性审查：Node 测试绿但 Rust/native/安装包缺能力、运行时加载旧资源、Provider/Custom Provider 迁移丢失。

每个发现必须包含严重级别、文件与行号、复现步骤、证据、用户影响、修复建议和验证方式。
- P0：自动发送、误写、凭证/正文泄露、不可恢复数据破坏、未授权全局/权限晋升、策略绕过安全门。
- P1：Codex 核心闭环失败、错误成功状态、Outcome 错误归因、Policy 无法回滚、迁移丢失、后台产生未授权费用、安装版缺能力。
- P2：不阻断核心闭环的可用性、文案或维护问题。

P0/P1 必须修复并重跑相关测试与完整审查。最多三轮；三轮后仍有 P0/P1 时将 Goal 标记 blocked，禁止完成。生成：
- docs/reviews/codex-outcome-learning-loop-v1-adversarial-review.md
- research/codex-outcome-learning-loop-v1-acceptance.latest.json
- research/codex-outcome-learning-loop-v1-benchmark.latest.json

完成条件：
- workflow 范围内的契约、实现、迁移、UI、测试和文档全部完成。
- Node、Rust、桌面、共享 Card、隐私和安装包验证通过。
- 不存在未解决 P0/P1。
- 用户本轮授权后的真实 Codex verified insert、精确回读、no-auto-submit、自动收起和撤销通过。
- pending outcome 能在下一次打开时正确反馈并保持幂等。
- benchmark harness 和 fake executor 通过；真实 benchmark 只有在用户授权预算后运行，未授权时必须明确标记未运行，不能伪造结果。
- 对抗审查最终 verdict=pass。
- 交付时分别报告：修改文件、架构决策、迁移、命令验证、GUI 验证、真实 Codex 闭环、benchmark 状态、Token/成本证据、对抗审查 verdict、未解决 P2 和外部风险。

如果使用 autoresearch-goal：开始时记录 get_goal 快照；完成前再次调用 get_goal，并把刷新后的 Codex Goal JSON 传给 `omx autoresearch-goal complete --slug smart-prompt-codex-outcome-learning-loop-v1 --codex-goal-json ...` 做快照对账。若目标不匹配，刷新快照后只重试一次；仍不匹配则走明确 blocked 路径，不得盲目重复。只有所有完成条件满足后才能调用 update_goal(status=complete)，任何 hook 不得修改 Codex Goal 状态。
```

## 推荐 Goal 标题

```text
Smart Prompt: Codex Outcome Learning Loop v1
```

## 推荐 Autoresearch Slug

```text
smart-prompt-codex-outcome-learning-loop-v1
```
