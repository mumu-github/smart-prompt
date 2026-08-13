# 提笔（Tibi）

提笔是**输入框旁的上下文提示词编辑器**：把当前输入框里的模糊草稿，整理成你看得懂、改得动、敢于提交的提示词，填回原输入框——但**永不替你发送**。

它不是 prompt 库，不是 prompt 市场，也不是单纯的改写工具；它是输入瞬间的 context engineering 就地增强层。

## 三条信任承诺

- **你控制**：只填入、不发送。`no-auto-submit` 由状态机代码强制，违反即进入阻断状态。
- **你拥有**：BYOK（自带 API Key），数据默认本地存储，无云端账号。
- **会学习**：从你的真实任务结果（Outcome、Token、时间、返工）中学习，形成可审核的 Memory / Rule / Skill / Generation Policy，而不是套模板。

## 能力

- 三模式自动判定：空输入求思路（idea）、半成品续写（continue）、完整输入优化（polish）
- 多 provider LLM gateway：`agnes`、`openai-compatible`、`anthropic`、`gemini`（BYOK，凭证本机加密）
- 网页与桌面共享同一张 Assistant Card：`prompt-session@2` 状态机 + Shadow DOM 单源 UI，hash 校验防分叉
- 站点适配：ChatGPT、Claude、Gemini、Perplexity、Lovable、Bolt、v0、Replit、DeepSeek、豆包等
- 桌面壳：透明小人入口（72×72）、托盘运行、四页控制中心、Windows UIA 写回守卫
- Codex Outcome Learning Loop v1：verified insert → 脱敏 Outcome 回流 → 四类学习候选 → 用户审核；Policy 灰度与回滚
- 隐私边界：不默认上传整页内容、正文不入长期存储、证据只留元数据、数据重置可恢复

## 真实闭环状态（诚实记录）

| 项 | 状态 |
| --- | --- |
| ChatGPT 浏览器 verified insert | ✅ 真实闭环通过（单次观测 144s，`research/phase3-activation-acceptance.latest.json`） |
| Codex 桌面真实闭环 | ⏳ 差最后一步 machine-verified insert（`research/codex-outcome-learning-loop-v1-real-closure.latest.json`） |
| 真实付费 benchmark | ⏳ 未运行（需预算授权） |
| 分发 | 本机 NSIS/MSI 未签名；扩展为 unpacked 加载，未上架商店 |

## 目录

- `prototypes/browser-extension/`：Chrome/Edge MV3 浏览器扩展
- `apps/local-service/`：Node 本地服务（activation、outcomes、learning、policies 模块）
- `apps/local-service-sidecar/`：Rust native sidecar（写回事务、学习契约、DPAPI 凭证）
- `apps/desktop-shell/`：Tauri 桌面壳（控制中心、透明 overlay、托盘）
- `packages/prompt-session/`：共享状态机、reason、文案与 Assistant View Model
- `packages/assistant-ui/`：共享 Shadow DOM Assistant Card（唯一 UI 源码）
- `packages/outcome-learning/`：学习契约与 Node/Rust 共享 fixtures
- `packages/shared/`：prompt core、prompt quality、LLM gateway、证据脱敏
- `benchmarks/codex-outcome-v1/`：隔离基准 harness
- `docs/`：PRD、产品契约、第一性原理复盘、对抗审查、`roadmap-2026-08-13-shrink-and-launch.md`
- `research/`：runtime evidence（只读证据，过期报告不代表当前状态）
- `scripts/`：生成、探针、critic 和 runtime 验收脚本

## 快速验证

各包测试：

```powershell
npm test --prefix packages/prompt-session
npm test --prefix packages/assistant-ui
npm test --prefix apps/local-service
npm test --prefix prototypes/browser-extension
npm test --prefix apps/desktop-shell
cargo test --manifest-path apps/local-service-sidecar/Cargo.toml
```

关键 critic 入口：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-m3.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-phase3-activation.ps1
node scripts/check-codex-outcome-learning-loop-v1.js
```

真实 GUI 写入、真实 benchmark 均需单独授权，未授权前不得执行。

## 真实 LLM

```powershell
$env:AGNES_API_KEY="你的 Agnes API key"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-v2-real-llm.ps1 -Provider agnes
```

## 本地服务

```powershell
cd apps\local-service
npm test
npm start
```

默认地址 `http://127.0.0.1:17371`，API 说明见 `apps/local-service/README.md`。

## 浏览器扩展

`prototypes/browser-extension/` 可作为 unpacked extension 加载（`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序）。

## 桌面壳

```powershell
npm test --prefix apps/desktop-shell
npm run build --prefix apps/desktop-shell
```

不要把普通 `cargo build --release` 直产物用于真实桌面验收（会加载 devUrl）；安装包在 `apps/desktop-shell/src-tauri/target/release/bundle/`。

## 原则

- Insert 只填入输入框，绝不自动发送
- 默认不读取或上传整页/整屏/聊天历史
- API key 只用于本地服务和显式配置的 provider，本机加密保存
- 无法机器回读时不宣称成功，只降级为复制或人工确认
- 证据分层：单元、视觉、安装包 smoke、真实检测、真实写入、机器回读、no-auto-submit 分开报告，不互相冒充
- 小人角色以 `assets/ui-ux/mascot-token-run.png` 为原型，不重新设计角色

## 路线图

收缩、命名与 30 天启动计划见 `docs/roadmap-2026-08-13-shrink-and-launch.md`；继续任务前请先读 `PROJECT.md` 与 `agent_memory/` 三件套。
