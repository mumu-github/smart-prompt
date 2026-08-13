# Smart Prompt 阶段 3 Goal 模式提示词

日期：2026-07-17  
设计规格：`docs/superpowers/specs/2026-07-17-desktop-activation-control-center-design.md`

## 使用方式

在新的 Codex 目标任务中粘贴下方提示词。若使用 OMX durable professor-critic 流程，同时显式调用 `oh-my-codex:autoresearch-goal`，并严格遵循该 skill 的 `get_goal`、verdict、完成快照对账和 `/goal clear` 生命周期。

## 可直接粘贴的 Goal 提示词

```text
目标：在 C:\Users\lhy10\Documents\Smart Prompt 中完成“阶段 3：桌面激活闭环与最小控制中心”。严格依据 docs/superpowers/specs/2026-07-17-desktop-activation-control-center-design.md 和 docs/smart-prompt-first-principles-product-plan-2026-07-17.md；若二者冲突，以已确认的阶段 3 设计规格为准。

第一性原理目标：让已经安装桌面应用和浏览器扩展、已经登录 ChatGPT、并持有有效 API Key 的内测用户，从桌面应用首次启动开始，在 3 分钟内完成 Provider 配置、真实模型连通性测试，以及一次真实 ChatGPT Assistant Card 核心循环。核心循环必须包含生成、审核，以及 verified insert 或成功 copy；Smart Prompt 永不自动发送。完成后桌面主窗口收起到托盘，后续启动默认不显示主窗口。

当前事实与基线：
- 阶段 0/1/2 已完成；packages/prompt-session/ 和 packages/assistant-ui/ 是共享会话与共享 Card 的唯一源。
- 浏览器与桌面 Overlay 已共享 Prompt Session View Model 和 Assistant Card，不得重新分叉。
- 现有桌面主窗口职责过载；app.js 仍包含大量控制中心、运行时和旧研发界面逻辑。
- 浏览器真实 DOM 写回比桌面 UIA 路径更稳定，因此首次激活固定以 ChatGPT 浏览器路径验收。
- WorkBuddy 真实写回尚未机器验证，本阶段不得重新开启或放宽弱信号写回。
- 工作区存在大量未提交变更。先读 git status、PROJECT.md、agent_memory/context.md、agent_memory/progress.md、agent_memory/bugs.md 和目标设计文档；不得覆盖、回退或整理无关用户改动。

必须实现：
1. 建立本地服务统一 Activation 状态契约与持久化。激活进度仅允许 not_started、configuring、model_ready、awaiting_first_loop、activated；运行健康独立使用 healthy、repairing、needs_repair。校验合法迁移，且瞬时故障不得抹掉已完成的激活。
2. 提供最小激活接口：GET /activation/status、POST /activation/browser-seen、POST /activation/complete、POST /activation/reset。真实 /llm/test 成功后由服务端在同一受信路径内推进 model_ready，客户端不能自行宣称连通。尽量复用现有 createAppRoutes、store、metrics 和隐私工具，不复制生成或写回实现。
3. 首次启动只显示独立向导。Tauri 自动启动本地服务，失败时自动修复一次；不要向普通用户暴露 Service 启动、停止、重启。
4. 向导允许选择 Agnes、OpenAI-compatible、Anthropic、Gemini。选择后只显示该 Provider 所需字段；Base URL、模型等非必要字段放入高级设置。继续使用现有本地加密凭证存储。
5. Provider 保存后必须调用真实 /llm/test。错误至少归一为 credential_invalid、model_unavailable、network_unavailable、provider_error，并给出可执行恢复动作。模型测试通过只推进到 model_ready，不能直接 activated。
6. 检测已安装扩展的脱敏心跳。模型就绪后，引导用户打开 chatgpt.com，并立即将桌面主窗口收起到托盘；后台进入 awaiting_first_loop。
7. 浏览器扩展仅在 ChatGPT verified insert 或成功 copy 后提交 activation complete。copy 只能表达复制成功，不能伪装为 DOM 机器写回成功。browser-seen 和 complete 必须沿用现有本地服务认证并经过严格 schema 校验；事件必须幂等。
8. 完成激活后持久化 activated。后续启动保持主窗口隐藏；控制中心只能从托盘、设置或明确故障恢复入口打开。
9. 将普通桌面界面收敛为四页：概览、模型、隐私、诊断。新增或整理 apps/desktop-shell/src/control-center/ 边界，采用渐进迁移，不做一次性全仓重写。
10. 从普通界面移除营销 Hero、主窗口 Prompt 工作台、Service 启停、Desktop Self-Test、Learning、Pilot、Quality、Segments、Outcome Follow-up、资料、历史、收藏和反馈。底层能力可以保留，但不得继续出现在普通用户导航或首屏。
11. 实现旧用户迁移：有效 Provider 加历史浏览器 verified insert/copy -> activated；有效 Provider 但无核心循环证据 -> awaiting_first_loop；无有效 Provider -> configuring。不得依据旧顶层 pass、write.attempted、离线截图或桌面视觉 smoke 自动激活。
12. 更新诊断、README/相关契约和项目记忆，只记录隐私安全元数据。
13. 隐私页的数据重置必须可恢复。不得调用现有永久删除路径；先移动到带时间戳的恢复归档，或使用已验证的 Windows 回收站机制，再初始化默认数据，并向用户说明恢复位置。

视觉与交互要求：
- 延续现有 Smart Prompt 品牌资产和组件语言，不重做品牌体系，不引入大型前端框架。
- 控制中心必须是安静、紧凑、任务导向的工具界面，不做营销落地页，不使用超大 Hero、嵌套卡片或研发术语。
- 向导每一步只有一个主操作，显示当前进度、错误原因和恢复动作。
- 使用适合任务的选择控件、标签页、开关和图标；保持键盘可达、可见焦点和正确标签。
- 在默认和最小支持窗口尺寸下不得有文字溢出、控件重叠、关键操作遮挡或布局跳动。

隐私与安全硬约束：
- 永远保持 no-auto-submit；真实 ChatGPT 验收不得点击发送。
- 不得保存或导出 API Key、Prompt 正文、草稿正文、目标输入正文、剪贴板正文、raw title 或 raw DOM/UIA 文本。
- 激活记录只允许站点 token、完成方式、机器验证布尔值、Provider token、版本、时间戳和有限 reason token。
- 不得放宽浏览器 DOM 目标验证、桌面 foreground/safe candidate/readback 守卫，也不得把 visual-only、attempted 或 copy 表达成机器写回成功。
- 不得永久删除任何文件或目录。需要移除时使用已验证的 Windows 回收站机制；测试临时目录使用保留产物模式，禁止用永久删除清理。
- 真实 GUI 验收只使用预先定义的非敏感合成草稿；截图必须遮挡或裁切到无法还原输入正文。

明确非目标：
- 浏览器扩展商店发布、自动安装、开发者模式安装向导。
- Codex、Trae、WorkBuddy 桌面写回重新认证或 WorkBuddy UIA 攻坚。
- Skill 资料页、Prompt 库、历史、收藏、反馈。
- 新 Provider、新站点、新模式、新 Overlay 控件。
- 云端账号、免费额度、计费、远程遥测、团队同步。
- 与激活闭环无关的全仓重构或依赖升级。

实施纪律：
- 先补失败测试，再做最小实现；复用现有模式和接口。
- 每完成一个纵向切片就更新计划状态并运行最小必要验证，不要等到最后一次性验证。
- Prompt Session 和 Assistant UI 的共享源码只能从 packages/prompt-session/ 与 packages/assistant-ui/ 修改，再用现有同步脚本生成端侧副本；不得直接编辑副本制造分叉。
- 任何真实 GUI 操作、ChatGPT 输入框读取或写入都必须先获得用户对本轮的明确授权。
- 命令通过、GUI 通过、真实 ChatGPT 闭环通过必须分别报告。

最低测试矩阵：
1. Activation 契约：五个激活进度、三个运行健康状态、合法/非法迁移、幂等 complete、reset 不删除凭证、已激活用户的瞬时故障不回退激活。
2. Provider：四个 Provider 的字段隔离、真实测试路由、四类错误映射、切换 Provider 不串 Key。
3. 迁移：三条旧用户路径，且旧桌面 attempted/pass 不得误激活。
4. 隐私：激活文件、API 响应、诊断、日志和 research 产物扫描无正文与凭证。
5. 桌面静态/交互：全新首次向导、activated 二次启动隐藏、关闭到托盘、四页导航、被移除内容不可见。
6. 运行时：本地服务自动启动和一次自动修复，失败时运行健康进入 needs_repair，但已激活用户仍保持 activated。
7. 浏览器自动化 Demo：草稿 -> 生成 -> 审核/编辑 -> verified insert 或 copy -> activation complete，且 no-auto-submit。
8. 浏览器异常：扩展未连接、ChatGPT 目标丢失、DOM 写回失败降级 copy、重复事件、激活接口暂时失败。
9. 新鲜视觉证据：首次向导和四页控制中心在桌面常用及最小窗口尺寸下无重叠、溢出和旧研发界面残留。
10. 获得授权后的真实 GUI：已登录 ChatGPT 中完成真实 Provider 生成、审核、DOM 填入与回读，确认未发送；然后重启桌面应用确认保持托盘隐藏。若安全写回不可用，可用成功 copy 完成激活，但必须明确其证据等级。
11. 时间证据：在既定内测前置条件下，从向导可交互到 activated 的一次真实运行不超过 3 分钟。单次结果不得表述为中位数。

开发后必须执行独立对抗审查：
- 从新手理解、运行时故障、Provider 错误、ChatGPT DOM/目标错误、隐私与 no-auto-submit、旧用户迁移与托盘、键盘/焦点/窗口尺寸/范围膨胀七个方向审查。
- 每个发现写明严重级别、文件与行号、复现步骤、证据、用户影响和修复建议。
- P0 包括自动发送、误写、Key/正文泄露、安全守卫绕过；P1 包括首次激活失败、错误成功状态、迁移丢失、真实 ChatGPT 闭环失败；P2 为可延后问题。
- P0/P1 必须修复并重跑相关测试和完整审查。最多三轮；三轮后仍有 P0/P1 时明确 blocked，禁止完成目标。
- 生成 docs/reviews/phase3-activation-adversarial-review.md 和 research/phase3-activation-acceptance.latest.json，最终 verdict 必须为 pass。

完成条件：
- 所有范围内实现、迁移、文档和项目记忆已更新。
- 契约、桌面、浏览器、运行时和隐私测试通过。
- 用户授权后的 ChatGPT 真实 GUI 核心循环通过并确认 no-auto-submit。
- 全新用户、已配置旧用户和已激活用户的启动行为均通过。
- 时间证据符合本阶段口径。
- 独立对抗审查最终 verdict=pass，且不存在未解决 P0/P1。
- 若使用 autoresearch-goal，必须记录 professor-critic pass verdict；之后通过 update_goal 标记 Codex goal complete，刷新 get_goal 快照，并按 skill 要求完成 OMX 快照对账。任何 hook 或 shell 命令不得伪造或修改 Codex goal 状态。

交付时列出：修改文件、关键架构决策、迁移行为、命令验证、GUI 验证、真实闭环验证、对抗审查 verdict、未解决 P2 和仍未覆盖的外部风险。不要把候选包、离线截图或单个命令成功描述成完整用户闭环。
```

## 推荐的 Goal 标题

```text
Smart Prompt Phase 3: desktop activation loop and minimal control center
```

## 推荐的 Autoresearch Slug

```text
smart-prompt-phase3-desktop-activation
```
