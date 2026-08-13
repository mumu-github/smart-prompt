# Codex Outcome Learning Loop v1 对抗审查

- 最终 verdict：**PASS**
- 最终严重度：**P0=0，P1=0，P2=0（代码项）**
- 审查轮次：4
- 最终独立审查：Codex `code-reviewer`，只读，agent `019f7946-40f8-7d13-b13b-ce46f9293327`
- 事实源：`workflows/codex-outcome-learning-loop-v1.md`

## 审查范围

覆盖 Codex 写回事务、撤销、Pending Outcome、Learning Observation、四类候选、Generation Policy、灰度/回滚、全局晋升、benchmark evidence、备份恢复、项目清除、Node/Rust 一致性、隐私和生产安装语义。

## 第一轮

Verdict：**FAIL**。发现并修复 3 个 P1：

1. **撤销没有以已写入正文作为原子前置条件。**
   - 风险：用户在 Fill 后继续编辑时，旧撤销可能覆盖新内容。
   - 修复：撤销以 written text hash 重新执行原子目标校验；目标、内容或 Session 变化即失效。
   - 证据：`apps/local-service-sidecar/src/target_adapter.rs:977`，Node/Rust target adapter fixtures。
2. **Policy evaluate 接受调用方提供的 rollout/arms/confidence。**
   - 风险：公开 API 可用伪造统计推动策略状态变化。
   - 修复：evaluate 只接受 `rolloutId`，全部统计从持久化、可归因 Observation 重算。
   - 证据：`apps/local-service/src/server.js:1625`，`apps/local-service-sidecar/src/main.rs:1016`。
3. **release 运行态可回退到仓库脚本路径。**
   - 风险：源码测试通过不能证明安装包具备同一写回能力。
   - 修复：release 只使用打包资源；资源契约测试和冷启动 smoke 验证 bundled driver/native sidecar。
   - 证据：`apps/local-service-sidecar/tests/native_resource_contract.rs`，`apps/desktop-shell/scripts/prepare-sidecar.js`。

## 第二轮

Verdict：**FAIL**。独立审查与本地找茬发现以下问题，均已修复：

1. **P1：公开 global promotion evidence 信任调用方的项目、Session、Outcome、成功标记、payload 和 Skill gates。**
   - 复现：直接 POST `/learning/v1/promotion-evidence` 可制造跨项目全局提案。
   - 修复：Node/Rust 公开路由固定拒绝 `promotion_evidence_server_derivation_required`；证据只能由服务端从已验证结果派生。
   - 证据：`apps/local-service/src/server.js:1541`，`apps/local-service-sidecar/src/main.rs:931`。
2. **P1：最终用户编辑被固定记为未编辑。**
   - 影响：高返工候选可获得虚假质量收益并自动晋升。
   - 修复：生成正文仅留在 Session 内存，服务端比较最终写入文本并只持久化编辑摘要；`userEdited=true` 按一次返工计入 rollout。
   - 证据：`packages/outcome-learning/index.js:1625`，`apps/local-service/src/server.js:1804`，`apps/local-service-sidecar/src/main.rs:2493`。
3. **P2：公开 outcome API 可直接创建 policyless `verified_insert`。**
   - 修复：只有服务端 Codex 写回事务可创建；公开路由返回 `verified_insert_server_transaction_required`。
   - 证据：`apps/local-service/src/store.js:709`，`apps/local-service-sidecar/src/main.rs:824`。
4. **P2：备份恢复可带回服务端信任标记。**
   - 修复：restore 清除 verified insert、verified Session 和 edit summary 信任字段，恢复数据不能成为 rollout evidence。
   - 证据：`apps/local-service/src/store.js:563`、`apps/local-service/src/store.js:1565`，`apps/local-service-sidecar/src/main.rs:4129`。
5. **P2：项目清除未同时处理生成历史绑定。**
   - 修复：项目清除将 prompt history 移入同一可恢复归档并使内存 target/generation transaction 失效。
   - 证据：`apps/local-service/src/store.js:629`，`apps/local-service-sidecar/src/main.rs:1671`、`apps/local-service-sidecar/src/main.rs:4741`。

## 第三轮

独立 reviewer verdict：**PASS，无未解决 P0/P1**。

Reviewer 发现一个 P2 Node/Rust 差异：Node `/policies/v1/canary` 会忽略额外 caller evidence 字段，而 Rust 会拒绝。已在第三轮收尾中修复：Node 现在只接受 `policyId`、`version`、`canaryShareBps`，额外 `rollout`/`gates` 返回 `unexpected_policy_canary_field`；对应回归测试通过。

Reviewer 另确认真实 GUI 和真实付费 benchmark 必须分别获得本轮授权。它们不构成代码缺陷，但不能被静态证据冒充为真实闭环。

## 第四轮

独立 reviewer verdict：**PASS，无未解决 P0/P1**。

本轮先补齐 Memory、Rule、Skill 的生产派生：输入只在当前 Session 内映射为固定 `learning-candidate-seed@1`，候选仍必须经过服务端 verified insert、最终编辑摘要和成功 Outcome 门槛；Assistant Card 打开时通过 `/learning/v1/reminder/resolve` 零模型匹配下一条提醒。恢复备份会移除 seed 和服务端信任标记。

Reviewer 发现一个 P2：调用方省略任务场景时，Node 会推断而 Rust 默认为 `general`，可能使 Skill seed 与 reminder feature token 分叉。已修复为 Node/Rust 共用 `task-scenario-inference-fixtures@1` 的有序语义，生成与打开 Card 两条 native 路径均推断同一有限 token；跨运行时 fixtures 和路由回归测试通过。

同一独立 reviewer 对修复做了最终只读复核，结论为 `PASS`，未解决项为 P0=0、P1=0、P2=0。

本地找茬还发现旧隐私扫描器没有识别 `learningCandidateSeed`，也未允许规范化的 `llm_fallback.errorCode`。扫描器现仅接受共享核心可严格规范化的 seed 和受限错误码，并通过新鲜 packaged-sidecar 隔离运行验证非空历史、DPAPI 凭证、日志、API 与 research artifacts。

## 验证证据

- `npm.cmd test`（local service）：全部通过。
- `cargo test`（native sidecar）：24 + 1 + 7 + 2 + 4 + 7 + 2 项通过。
- `node --test packages/outcome-learning/tests/outcome-learning.test.js`：16/16 通过，含编辑摘要、Learning Candidate Seed 与任务场景 Node/Rust fixtures。
- `npm.cmd test`（desktop shell）：通过。
- Control Center 与 Assistant Card 新鲜视觉报告均为 pass，无溢出或大白块回归。
- native r10 package cold-start smoke：build ID、auth、打开 Card 零模型提醒、verified-insert/promotion-evidence 伪造拒绝均通过。
- native Phase 3 生产契约：5/5 通过。
- 隐私扫描：`research/phase3-privacy.latest.json`，`pass=true`；非空历史 seed 合法，原始输入、明文凭证、禁止字段和绝对路径发现数为 0。

## 最终结论

当前代码与打包 native r10 运行态不存在已知未解决 P0/P1/P2 代码项。对抗审查结论为 `PASS`。真实 Codex GUI 闭环和真实 benchmark 仍按授权门槛单独验收，未执行前不得宣称相应层级已经通过。
