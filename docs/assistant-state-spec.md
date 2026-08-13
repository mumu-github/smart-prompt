# Assistant 状态与 Prompt Session 契约

版本：`prompt-session@1`  
实现：`packages/prompt-session/index.js`  
运行时副本：`prototypes/browser-extension/src/prompt-session.js`、`apps/desktop-shell/src/prompt-session.js`

## 设计目标

浏览器和桌面只提供平台事实与能力，不各自组合产品状态和核心文案。同样的命令与事实必须产生同样的 Assistant View Model。

## 状态

| 状态 | 标题 | 主操作 | 允许进入条件 |
| --- | --- | --- | --- |
| `idle` | 需要我帮你整理吗 | 生成提示词 | 会话打开，尚无生成结果 |
| `drafting` | 正在整理你的需求 | 取消 | 生成请求进行中 |
| `review` | 提示词已生成 | 填入输入框 | 结果可审核，目标可尝试写入 |
| `target_missing` | 请先点击目标输入框 | 重新检测 | 目标不存在或未聚焦 |
| `copy_only` | 当前工具暂不支持自动填入 | 复制提示词 | 目标不支持安全自动写入 |
| `inserting` | 正在填入 | 取消 | 写入与验证进行中 |
| `inserted` | 已填入，未发送 | 完成 | 机器验证成功，或已尝试且明确要求人工确认 |
| `blocked` | 为避免填错，已暂停 | 重新检测 | 目标不安全、不可见或安全契约不成立 |
| `error` | 本次没有完成 | 重试 | 生成、写入或撤销发生非目标类失败 |

状态只能来自以上枚举。`resting`、`thinking`、`suggesting`、`success` 仅是旧端侧视觉状态，不得作为产品状态继续传播。

## 命令

### 用户与编排命令

- `OPEN`
- `SET_DRAFT`
- `GENERATE` / `REGENERATE`
- `INSERT`
- `COPY`
- `UNDO`
- `RETRY`
- `CANCEL`
- `RESET`
- `TARGET_UPDATED`

### 渐进迁移事件

- `GENERATION_STARTED`
- `GENERATION_SUCCEEDED`
- `GENERATION_FAILED`
- `INSERT_STARTED`
- `INSERT_SUCCEEDED`
- `INSERT_FAILED`
- `UNDO_SUCCEEDED`
- `UNDO_FAILED`
- `SYNC`

端侧现有生成或写回编排尚未全部迁入 Session 时，使用这些事件同步事实。`SYNC` 只接受白名单字段，平台 debug 数据不会进入 View Model。共享 UI 完成后，应逐步由 `GENERATE`、`INSERT` 和 `UNDO` 直接编排 Adapter。

## 关键转换

| 当前状态 | 命令/结果 | 下一状态 |
| --- | --- | --- |
| `idle` / `review` / `error` | `GENERATE` | `drafting` |
| `drafting` | 生成成功 | `review` |
| `drafting` | Provider 或生成失败 | `error` |
| `review` | `INSERT` | `inserting` |
| `inserting` | 机器验证成功 | `inserted` + `verification=machine` |
| `inserting` | 已尝试但不可回读 | `inserted` + `verification=manual-required` |
| `inserting` | 目标丢失/未聚焦 | `target_missing` |
| `inserting` | 不支持安全写入 | `copy_only` |
| `inserting` | 目标不安全/不可见 | `blocked` |
| `inserting` | 其他写入失败 | `error` |
| `inserted` | 撤销成功 | `review` |
| 任意 | `noAutoSubmit=false` | `blocked` + `safety-contract-violated` |

异步生成、写入和撤销使用 operation id；取消或新操作开始后，旧结果不得覆盖当前 View Model。

## Target Capability

工具能力等级只有四种：

| level | 语义 | 可调用 `insert` |
| --- | --- | --- |
| `verified-write` | 可写且可机器回读 | 是 |
| `manual-confirmation-required` | 可尝试写入但不可机器回读 | 是，结果必须人工确认 |
| `copy-only` | 不能安全自动写入 | 否 |
| `unsupported` | 当前平台或工具未支持 | 否 |

目标即时状态独立为：`ready`、`missing`、`blocked`、`unknown`。能力等级不能覆盖即时安全状态，例如已认证工具的窗口最小化后仍必须是 `blocked`。

## 有限用户原因

View Model 只允许以下 reason：

| reason | 用户含义 | 默认恢复动作 |
| --- | --- | --- |
| `none` | 无异常 | 当前主操作 |
| `target-missing` | 未找到输入框 | 重新检测 |
| `target-not-focused` | 输入框未聚焦 | 聚焦后重新检测 |
| `target-hidden` | 窗口不可见/最小化/cloaked | 恢复并前置窗口 |
| `target-unsafe` | 无法确认安全写入位置 | 重新检测或复制 |
| `target-unsupported` | 当前工具不支持 | 复制 |
| `readback-unavailable` | 无机器回读能力 | 人工确认或复制 |
| `credential-invalid` | API Key 缺失、失效或权限不足 | 在控制中心更新凭证并测试 |
| `model-unavailable` | Provider 不支持当前模型 ID | 选择推荐模型或填写可用的自定义模型 ID |
| `network-unavailable` | Provider 网络或 Base URL 不可达 | 检查网络和 Base URL 后重试 |
| `provider-error` | Provider 返回异常或限流 | 稍后重试，持续失败时打开诊断 |
| `provider-unavailable` | 模型或本地服务不可用 | 检查配置后重试 |
| `generation-failed` | 生成失败 | 重试 |
| `insert-failed` | 写入未完成 | 重新检测或复制 |
| `undo-failed` | 撤销未完成 | 人工检查目标内容 |
| `safety-contract-violated` | 检测到自动提交风险 | 停止写入 |
| `unknown` | 新内部原因尚未归类 | 重试或诊断 |

原始 token 只用于诊断。典型映射：

- `missing_input`、`no-candidates` -> `target-missing`
- `target_tool_not_foreground`、`manual_composer_focus` -> `target-not-focused`
- `foreground-window-hidden`、`minimized`、`cloaked` -> `target-hidden`
- `payload_guard`、`no-safe-candidate`、`requires-safe-candidate` -> `target-unsafe`
- `missing_adapter_writer`、`unsupported-overlay-profile` -> `target-unsupported`
- `readback_unavailable` -> `readback-unavailable`
- `credential_invalid`、`missing_api_key` -> `credential-invalid`
- `model_unavailable`、`model_not_found` -> `model-unavailable`
- `network_unavailable`、`connection_refused` -> `network-unavailable`
- `provider_error` -> `provider-error`
- 未识别 token -> `unknown`

## View Model

```js
{
  contractVersion: "prompt-session@1",
  state: "review",
  locale: "zh-CN",
  title: "提示词已生成",
  description: "可先编辑；填入后也不会自动发送。",
  primaryAction: { id: "insert", label: "填入输入框", enabled: true },
  secondaryActions: [
    { id: "regenerate", label: "重新生成", enabled: true },
    { id: "copy", label: "复制", enabled: true }
  ],
  busy: false,
  draft: "...",
  prompt: "...",
  mode: "idea",
  reason: { code: "none", label: "", message: "" },
  target: {
    status: "ready",
    level: "verified-write",
    canInsert: true,
    manualConfirmationRequired: false,
    reason: "none"
  },
  verification: "none",
  manualConfirmationRequired: false,
  noAutoSubmit: true,
  canUndo: false
}
```

禁止加入 HWND、DOM 节点、selector、candidate、evidence、Provider key、原始错误文本或 Prompt 之外的目标正文。

## 外部接口

```js
const session = SmartPromptSession.createPromptSession({
  generator,
  target,
  evidence,
  settings: { locale: "zh-CN" }
});

session.open({ draft, targetCapability });
await session.dispatch({ type: SmartPromptSession.COMMANDS.GENERATE });
await session.dispatch({ type: SmartPromptSession.COMMANDS.INSERT });
await session.dispatch({ type: SmartPromptSession.COMMANDS.UNDO });
session.subscribe((viewModel) => render(viewModel));
```

## 单一来源与同步

`packages/prompt-session/index.js` 是唯一源码。运行：

```powershell
node scripts/sync-prompt-session-runtime.js
```

端侧测试会逐字比较运行时文件与共享源码，防止浏览器和桌面再次分叉。

## 验证

```powershell
cd packages\prompt-session
npm.cmd test
```

契约测试只通过公开 Session 接口观察正常、目标丢失、copy-only、阻断、人工确认、撤销、Provider 失败恢复和双端相同 View Model。

## 兼容扩展：Outcome Learning 事件层

版本：`prompt-session@2` 事件信封  
实现：`packages/outcome-learning/index.js`  
兼容基线：本文件前述 `prompt-session@1` View Model 和命令语义保持不变

`prompt-session@2` 不是新的 Card 状态机。它只记录已经发生且可归因的结果事件，使 Codex Target Adapter、Pending Outcome、Learning Observation 和 Generation Policy 可以通过稳定 id 关联，而不会把内部 evidence 或长期学习状态塞回 UI View Model。

### 事件类型

| eventType | 产生条件 | 对 `prompt-session@1` 的影响 |
| --- | --- | --- |
| `verified_insert` | 写入后机器精确回读一致且 `noAutoSubmit=true` | Card 可进入 `inserted`，并创建 Pending Outcome |
| `insert_failed` | 写入、回读、剪贴板恢复或安全检查失败 | 按有限公开原因进入 `blocked`、`copy_only` 或 `error` |
| `retry` | 用户重新生成或重试 | 只记录隐式行为信号，不直接判定任务失败 |
| `undo` | 精确撤销成功 | Card 回到 `review`，Outcome 记录撤销信号 |
| `regenerated` | 新 generation 取代旧 generation | 旧异步结果不得覆盖当前 Session |
| `outcome_feedback` | 用户完成一次结果反馈 | 更新对应 Pending Outcome；事件必须幂等 |
| `outcome_expired` | 到期仍未反馈 | 进入 `expired_unknown`，不计成功或失败 |
| `policy_selected` | 生成前选择一个 stable 或 canary Policy | 绑定 policy id/version，Card 不展示内部实验信息 |

### 关联与幂等

- `sessionId`、`generationId`、`transactionId`、`outcomeId`、`feedbackId` 和事件 id 各自承担单一关联职责；重复 IPC、重启或重复打开不得重复计数。
- verified insert 必须保留当次 `policyId` 与 `policyVersion` 的成对归因；缺一时两者都视为未归因，旧数据可迁移为 `null` 对。
- 多条 Pending Outcome 独立排队。每次只 claim 最近一条已到时、未过期且 target/project scope 匹配的记录，其余不得被覆盖。
- “完成了”一步结束；“还没有”先记录 `not_completed`，再用独立 feedback id 提交白名单原因。
- 清除项目数据会使该项目的 Outcome、Observation、fingerprint、候选、Policy evidence 和 receipt 一并失效；已失效记录不得因重启复活。

### 公开状态映射

Outcome Learning 层只允许有限下划线原因：`none`、`target_unavailable`、`target_not_ready`、`target_changed`、`readback_unavailable`、`write_not_verified`、`safety_blocked`、`model_unavailable`、`budget_exhausted`、`privacy_blocked`、`permission_required`、`benchmark_incomplete`、`unknown`。

这些 token 是服务边界，不得直接显示给用户。端侧必须映射到上文 `prompt-session@1` 的标题、说明和恢复动作；内部 driver reason、候选分数、路径、标题、正文和 evidence 不得进入 View Model。

### 写入、撤销与激活状态

- `verification=machine` 是 Outcome Learning 认可的唯一成功写入。`manual-required` 仍可保留在 `prompt-session@1` 兼容 UI 中，但不能创建 verified insert、完成 Codex Activation v2 或计入策略成功。
- 写入事务必须绑定目标租约、原草稿快照、payload hash 和 freshness。窗口、焦点、目标、草稿或 Session 任一变化都使事务失败。
- controlled clipboard 仅在用户点击 Fill 后可用；必须保存、粘贴、精确回读并恢复原剪贴板。任一步失败都不能返回成功。
- 撤销仅对同一窗口、目标、Session 和未被外部修改的已写入文本有效；否则撤销入口立即失效。
- `codex-activation@2` 只有在真实模型连通性测试、Codex verified insert、机器回读一致和 no-auto-submit 全部通过后才为 activated。legacy `phase3-activation@1` 只读保留，短暂运行时故障不得抹除历史激活。

### ContextSource 占位状态

`context-source@1` 只有 `not_requested`、`not_implemented`、`collected`、`blocked`、`removed` 等有限 collect 状态。当前版本没有真实读取器；默认权限为 `not_granted`、信任等级为 `untrusted`。只有用户独立授权、可预览、独立 Token 预算且 Prompt Injection 风险为 `low` 时，未来实现才可返回 `collected`。
