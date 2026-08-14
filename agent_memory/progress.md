# 当前进度

## 2026-08-14 真实闭环 8 轮尝试后的诚实状态

- 已完成并入库 4 个写回链路真实修复：驱动 stdin（GetStdHandle，CreateNoWindow 下管道可达）、几何守卫 DPI 适配（420px 上限按窗口 DPI 缩放）、探针超时校准（90s/120s，Node+Rust 一致）、codex 画像 `preferControlledClipboard`（ChatGPT 桌面应用 SetValue 压平换行，粘贴实测保留）。
- CDP 修复已入库：Evergreen Runtime 151 忽略 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS（外部与进程内均失效），需固定版 Runtime 133（`.runtime/webview2-fixed-133/`）+ `SMART_PROMPT_CDP_PORT` 进程内注入；启动命令见 bugs.md。
- 闭环当前被**环境性阻塞**（8 轮尝试，`research/codex-outcome-learning-loop-v1-real-closure.latest.json` 诚实记录 pass=false）：本机多个 AI 工具悬浮层（LLM HUD、CordC、Accio 等）周期性抢占前台，ChatGPT 窗口反复被最小化/cloak，严格 foreground + focused-composer 契约无法连续维持 3.5 分钟；无人值守运行同样失败（trace 显示每 10-30 秒一次前台闪变）。
- 继续闭环的条件：关闭/卸载抢占前台的悬浮层工具（或换一台干净机器）后重跑 `node scripts/check-codex-outcome-real-closure.js`（前置：固定 Runtime env + CDP env + ChatGPT 前台聚焦 + 干净草稿）。
- 本次会话的工程产出（入库、CI、文档、7 个 bug 修复）均已在 `codex/prompt-automation-research` 分支。

## 2026-08-13 阶段 A 收口与真实闭环准备

- 已完成：7 周工作分批入库（8 批 371 文件）、根级 `npm test` 聚合入口、GitHub Actions CI（远程全绿）、文档漂移修复、视觉测试 Chrome 路径可配置化、官网单页与上架/招募材料。
- CI 上线首跑抓出并修复 5 个问题：假时钟时间炸弹、模型错误抢占 review 主操作、verified 事务期间 legacy 轮询争夺、CRLF checkout 破坏 Rust 断言、品牌版 Chrome 137+ 禁用 --load-extension（CI 改用 Playwright 完整 Chromium）。
- 当前重点回到闭环：Codex 真实闭环是"单人可用"的最后一块。上次（7-19）失败在 machine-verified insert（回读 529 vs 558），现行脚本已改为信任适配器归一化机器回读，原始长度对比仅信息性。
- 今日修复改变了 app.js/assistant-card.js/server.js，r10 安装包已过期；新安装包已重新构建（`npm run build --prefix apps/desktop-shell`，2026-08-14T01:28Z）：
  - NSIS `4ADD0FF50A891143097AAF80ED86F8B9ABDA8C9EF1643DDFFD7C4667F84A3255`
  - sidecar `08CE1DB7418245845945867C9BB22BC9894DBB62A44C63B96DA0826085621F3C`
  - desktop exe `0673CA41316A7C881D23003303957D66F0575603481B68392933646F15D08FDC`
  - 真实闭环必须用新包。
- 真实闭环执行序列（等待用户授权口令「授权本轮真实闭环」）：
  1. 覆盖安装新 NSIS 到 `C:\Users\lhy10\AppData\Local\Programs\Smart Prompt`；
  2. `$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9239"` 后启动安装版 exe；
  3. 用户打开 Codex 并聚焦输入框，写入非敏感合成草稿；
  4. `node scripts/check-codex-outcome-real-closure.js`（真实 LLM 生成 + verified insert + 自动收起 + 60s Pending Outcome 复开 + 撤销）。
- 边界不变：真实 GUI 写入必须 foreground + safe candidate + 用户明确授权同时成立；不得自动安装、自动切换前台。

## 2026-07-19 Codex Outcome Learning Loop v1 实现收尾

- 已完成共享 Outcome/Learning 契约、Codex target 事务、Pending Outcome、最终编辑摘要、四类候选、Policy canary/回滚/晋升、项目清除与恢复去信任。
- `learning-candidate-seed@1` 已进入 Node/native 生产链路；Memory、Rule、Skill 在 2 个 Session、3 次成功结果后形成待审候选，未命中固定语义时形成 Generation Policy。
- Assistant Card 打开时调用 `/learning/v1/reminder/resolve`，只做本地瞬时匹配且不调用模型；Node/native 缺省任务场景已用跨运行时 fixtures 对齐。
- 四轮对抗审查最终 `PASS`，当前已知 P0/P1/P2 代码项为 0；审查记录为 `docs/reviews/codex-outcome-learning-loop-v1-adversarial-review.md`。
- 最终 r10 已重新构建 MSI/NSIS。`cargo test` 为 24 + 1 + 7 + 2 + 4 + 7 + 2 全通过，outcome-learning 16/16，native Phase 3 5/5；package cold-start、隔离隐私扫描、Control Center 与 Assistant Card 视觉均通过。
- 最终 r10 sidecar SHA-256 为 `F5379B2BD3BFAFDBD5ABFF0C789279E1523FAFDB0874216E626829DA0E7354E7`，NSIS 为 `B54F24AE42EE30043FB90DA3FEAD6DBD06A429CDE5E3C8F386A0AE748A28D2E9`，MSI 为 `D3E122330151F78BD08E2631CBA16C6092F793BAAB026FCD60CA8458FE5FA76A`。
- 当前未执行：安装 r10、切换真实 Smart Prompt/Codex 前台、读取/完整替换/机器回读/未发送/撤销/Pending Outcome 60 秒复开、当前 Provider 连通性。以上需本轮精确授权。
- 只读安装审计确认当前 installed desktop 为 `27A409BA2EFA5A61B0E99025A0EA0BE9F79E100F4AD12A81C921EE5EAC1C5332`、installed sidecar 为 `7AF0AC9A2800C2B13887368EDDC239BD77F9C3982C4D7046D1A64FFA67803B71`，均不同于 r10；当前没有 Smart Prompt/sidecar 进程运行。
- 真实付费 benchmark 未执行，必须另行确认模型、请求数、Token 上限、最大重试和预算。
- Goal 阻塞状态：连续三次 Goal 轮次均未收到精确口令 `授权本轮真实闭环`。剩余安装、前台切换、Codex 输入读取/写回、受控剪贴板与 Provider 请求均不能越权执行，因此 Goal 按严格规则标记 blocked；用户后续发送该口令即可重新开始真实闭环验收。

## 2026-07-19 Agnes 与自定义模型修复

- 已确认持久化设置为 Agnes / `agnes-2.0-flash` / `apihub.agnes-ai.com`，DPAPI 凭证仍为 `configured`；最终安装版真实原子 `/llm/test` 成功（`generatedBy=llm`，`settingsPersisted=true`，`promptLength=764`），真实 `/generate` 成功（`generatedBy=llm`，`promptLength=1263`）。
- 控制中心已新增推荐模型与自定义模型 ID 切换、历史自定义值回显、Key 已保存状态和空值不覆盖语义；修复 1.2 秒激活轮询重绘表单导致用户输入丢失的问题。
- Node/native 后端已补模型 ID 校验、无效设置 400 `model_invalid`、Gemini `models/` 前缀兼容，以及裸 404 与模型错误的精确区分。
- 浏览器 Assistant Card 已将凭证、模型、网络、Provider 异常分别显示，不再把 `provider_error` 显示为“模型暂不可用”；首开生成会等待 browser-seen 结果，避免已激活用户被竞态误当成首次激活。
- “保存并测试”已改为先测试候选配置、成功后持久化。最终安装版用伪造错误 Key 验证返回 502 `credential_invalid`，随后原 Agnes Key 继续真实测试成功，证明失败候选没有覆盖旧凭证。
- 回归通过：Prompt Session、浏览器扩展、Node local-service、native Rust 8 项单测、native sidecar 5 项契约、桌面壳测试、Control Center 视觉测试和 scoped `git diff --check`；三轮对抗审查最终 verdict 为 `PASS`。
- 此前 Agnes 修复轮次已生成并静默覆盖安装 NSIS，当时安装包 SHA-256 为 `3C61972774265FBF5BC6B5D54C504F8774E99D9F953B7D504EDC00B969FDB1D2`，installed sidecar 为 `541A0895156FD4B138DB7A7A692C41D6361E78050AE099F73B7A250441C945ED`；这不是当前 r10 已安装证据。
- 已安装 WebView CDP 验证：Agnes 推荐项与自定义项均存在，Key 输入为空但状态为“已保存，留空不会覆盖”；自定义值在 1.8 秒轮询后仍保留。安装版非法模型返回 400 `model_invalid`，原模型和凭证状态不变。

## 待用户动作

- 对本轮真实闭环逐项授权：安装 r10 并保留安装，启动/切换 Smart Prompt 与 Codex，使用非敏感合成草稿，读取与完整替换当前输入，必要时受控使用并恢复剪贴板，验证未发送、自动收起、撤销和 Pending Outcome，再测试当前 Provider 连通性。
- 真实 benchmark 另行确认预算；未获该授权时只保留 fake benchmark 和静态证据。

## 2026-07-17 阶段 3 方案锁定

- 已通过逐项问答锁定阶段 3：首次激活优先、BYOK、多 Provider 选择加真实连通性测试、ChatGPT 浏览器首用、完成后托盘运行、四页最小控制中心。
- 已确认内测前置条件：桌面应用与扩展已安装、ChatGPT 已登录、用户已有有效 Key；三分钟指标从首次向导可交互开始计算，单次结果不得表述为中位数。
- 已确认激活完成条件：ChatGPT Assistant Card 完成生成和审核，并产生 verified insert 或成功 copy；模型测试通过不等于激活完成。
- 已确认开发后执行最多三轮分级对抗审查；P0/P1 必须修复并复审，最终 verdict=`pass` 才能完成目标。
- 已生成设计规格 `docs/superpowers/specs/2026-07-17-desktop-activation-control-center-design.md` 和 Goal 提示词 `docs/goals/smart-prompt-phase3-activation-goal-prompt.md`，并已进入阶段 3 实现。

## 2026-07-17 阶段 3 当前实现

- 本地服务新增 `activation.json` 状态事实源、五段激活进度、三段运行健康、迁移和 metadata-only 激活 API；Provider 测试只推进到 `model_ready`，设置保存会先推进到 `configuring`。
- 旧用户迁移覆盖：有效 Provider + 历史 ChatGPT verified insert/copy -> `activated`；有效 Provider 无核心循环 -> `awaiting_first_loop`；无有效 Provider -> `configuring`；新鲜空目录仍为 `not_started`。
- `/data/all` 已改为把数据移动到 `.recovery/reset-*` 可恢复归档后重新初始化，不再永久删除；新增运行健康 API和 Provider 错误分类。
- 浏览器扩展在 ChatGPT 目标上只提交 `browser-seen`、verified insert 或成功 copy 的脱敏激活证据；未发送 Prompt、剪贴板、标题或 DOM 正文，且保留 no-auto-submit。MV3 background bridge 固定本地服务端口 `17371`，令牌只留在 worker 内存中，`/auth/bootstrap` 不暴露给 content script。
- 激活路由现在只接受固定 Chrome/Edge 扩展 Origin 和 `phase3-activation@1`；ChatGPT 页面 Origin、伪造扩展 Origin、Firefox/Safari 当前路径均被拒绝。ChatGPT verified insert 还必须带 `targetKind=chatgpt-composer`，decoy textbox 不得激活。
- 桌面主窗口已加入阶段 3 控制中心入口：首次激活向导、当前 Provider 单字段、ChatGPT 目标、概览/模型/隐私/诊断四页；旧工作台仅隐藏保留给已有 overlay 回归脚本。
- Tauri 主窗口启动隐藏、关闭转托盘、托盘可唤起，并提供固定 ChatGPT 外部打开命令；激活完成后自动收起到托盘。
- 已通过：本地服务契约/集成测试、浏览器扩展全套测试（含 complete bridge）、native sidecar 合约、桌面壳静态/交互测试、Control Center 契约、阶段 3 视觉、Prompt Session、Tauri 运行时与只读隐私扫描。
- 三轮独立对抗审查最终 `pass`，P0/P1/P2 均为 0；前两轮发现的 bridge 丢证据、打开 ChatGPT 不收起、eventId 等时放行、Node/native 诊断路径泄露均已修复并补回归测试。审查文档和最终 critic 脚本已生成。
- 用户重载正确 unpacked 扩展后，真实 ChatGPT 闭环通过：r5/ready、`generatedBy=llm`、卡片编辑、`verified_insert`、`targetKind=chatgpt-composer`、稳定回读、消息数/路径不变、无 Send/Enter。单次观测为 `144446 ms`，低于三分钟且未表述为中位数。
- 最终 release 使用同一 activated 数据重启后保持 activated；两个 Tauri 窗口均隐藏，native sidecar r6、托盘和全局快捷键基础设施均确认。最终 acceptance JSON、隐私报告、对抗审查和 professor critic 均为 pass，Codex goal 已标记 `complete`。
- OMX 终态对账未成功：`update_goal` 返回 `complete` 后，按流程刷新的 `get_goal` 返回 `goal=null`；`omx autoresearch-goal complete` 使用该原样快照只尝试一次并按严格规则拒绝。已依 hook 要求记录显式 `blocked` verdict，证据为 `work/phase3-codex-goal-null-snapshot.json`，未重复或伪造终态快照。

## 2026-07-17 产品重构方案

- 已完成网页扩展、桌面 Overlay、桌面主窗口、本地服务和运行证据的第一性原理复盘。
- 已生成当前静态界面证据：`outputs/product-reassessment-2026-07-17/01-desktop-main.png` 与 `02-browser-extension-open.png`。
- 已确认核心问题不是缺少功能，而是产品表面、状态模型和模块接口分叉；桌面主窗口当前有 12 个主区块、20 个按钮和 16 个输入控件，混合了多个使用频率和角色。
- 已产出 `docs/smart-prompt-first-principles-product-plan-2026-07-17.md`，包含必要、优化、重构、移出、新增和暂缓清单，以及 6 阶段逐文件实施计划。
- 阶段 0 已完成：`docs/product-contract.md` 与 `docs/assistant-state-spec.md` 固化一句话产品、唯一成功流程、P0/P1/P2、扩功能冻结、9 状态、有限 reason、Target Capability 和 `no-auto-submit` 契约。
- 阶段 1 已完成：新增 `packages/prompt-session/`，浏览器 Card 与桌面 Overlay 已共同消费 `prompt-session@1` View Model；两份运行时副本由 `scripts/sync-prompt-session-runtime.js` 同步并由测试逐字校验。
- 已验证正常、目标丢失、copy-only、阻断、机器验证、人工确认、Provider/写入失败恢复和撤销；浏览器真实 Demo 与桌面 Overlay Headless Chrome 渲染测试通过，截图在 `outputs/prompt-session-phase1/`。
- 阶段 2 已完成：新增 `packages/assistant-ui/` 与 `scripts/sync-assistant-ui-runtime.js`，浏览器 Card 和桌面 expanded Overlay 已迁移到同一 Shadow DOM 组件；统一中文/英文、编辑器、模式、一个主操作、最多两个次操作、键盘与安全提示。
- 浏览器运行时覆盖模式切换、重新生成、编辑保持、普通 Enter、填入后同卡 `inserted`、撤销和 Provider 离线降级；桌面运行时覆盖 8 个核心状态、编辑后 guarded fill、regenerate/mode Tauri 路由、compact `72x72` 与透明白块回归。
- 阶段 2 验证通过：`packages/assistant-ui`、`packages/prompt-session`、浏览器扩展、桌面壳全量测试，桌面 `prompt-session-runtime-test`，`p25-overlay-chat-visual@2`，运行时/dist hash，PowerShell parser、`node --check` 与 `git diff --check`。
- `scripts/check-p25-overlay-click-chain.ps1` 的共享 Card、target-missing、guarded fill、regenerate、mode routing 与视觉项均为 true；整体仍按预期为 false，因为本轮未启动真实桌面壳、未刷新 runtime readiness、未执行真实 overlay click 或真实写回。
- 下一实施起点：阶段 3 桌面控制中心瘦身；不得把阶段 2 离线视觉与路由通过误报为真实前台写回完成。

## 当前状态快照（2026-06-17）

- 当前目标：按 `C:/Users/lhy10/WorkBuddy/2026-06-17-13-11-49/Smart-Prompt-整改方案-校准整合版.md` 修复 Smart Prompt 可执行问题，并保持真实 Fill 的 foreground、safe candidate、no-auto-submit 与隐私元数据边界。
- Autoresearch goal：已创建 `.omx/goals/autoresearch/smart-prompt/mission.json`；完成前必须记录 professor-critic `pass` verdict。
- 旧进度流水账已归档到 `agent_memory/archive/progress-2026-06-17-before-rectification.md`；后续进度只按 checklist 记录，并必须绑定证据文件或验证命令。

## 证据绑定 checklist

| 状态 | 编号 | 事项 | 当前证据 |
| --- | --- | --- | --- |
| 进行中 | P0-1/P1-2 | WorkBuddy/Trae Fill 弱信号 fallback 与 safe candidate 配置化 | `packages/shared/desktop-tool-profiles.json`、`scripts/desktop-tool-profile-config.ps1`、`scripts/check-m3-desktop-input.ps1`、`scripts/check-m3-desktop-fill.ps1`、`scripts/check-m3-real-desktop-tools.ps1` |
| 已完成 | P0-2 | `progress.md` 从自由流水账压缩为证据 checklist | `agent_memory/archive/progress-2026-06-17-before-rectification.md`、本文件 |
| 已完成 | P1-3/P1-4 | 浏览器扩展 prompt engine 与 site adapters 改为复用 shared core | `prototypes/browser-extension/src/smart-prompt-core.js`、`prototypes/browser-extension/src/prompt-engine.js`、`prototypes/browser-extension/src/site-adapters.js`、`prototypes/browser-extension/tests/prompt-engine.test.js` |
| 已完成 | P1-5 | 凭证 AES fallback 改为本机随机 secret 文件，并保留 legacy 解密兼容 | `apps/local-service/src/credential-vault.js` |
| 已完成 | P1-6 | 浏览器扩展 local-service client 非 JSON 响应处理 | `prototypes/browser-extension/src/local-service-client.js` |
| 已完成 | P1-7 | 桌面壳 overlay 自动轮询改为 `setTimeout` 递归调度 + 指数退避 | `apps/desktop-shell/src/app.js`、`apps/desktop-shell/tests/desktop-shell-interaction.test.js` |
| 已完成 | P1-8 | 关键吞错点改为可观测或标注预期 fallback | `apps/desktop-shell/src/app.js`、`apps/desktop-shell/src/overlay.js` 增加脱敏 warning；`scripts/check-m3-desktop-input.ps1`、`scripts/check-m3-desktop-fill.ps1`、`scripts/check-m3-real-desktop-tools.ps1`、`scripts/check-p25-runtime-readiness.ps1` 为预期 best-effort fallback 加注释；源码范围裸空 catch 扫描无匹配 |
| 已完成 | P1-1 | `prompt-quality.js` 12 模块拆分 | `packages/shared/prompt-quality.js` 仅保留兼容入口；实现拆到 `packages/shared/prompt-quality/*.js`；已验证 `node --check`、`node scripts/check-v6-prompt-quality.js`、`npm test --prefix apps/local-service` |
| 已完成 | P2-1 | 忽略所有 `target-p25-*` 构建产物目录 | `.gitignore` |
| 已完成 | P2-2 | 合并 visual-attach 脚本家族 | `scripts/check-p25-visual.ps1` 统一 `DesktopShellVisualRuntime` / `MascotOverlayNoActivate` / `OverlayWindowVisualAttach` 三个 mode；旧实现移入 `scripts/p25-visual/*.impl.ps1`；`check-p25-*.ps1` 入口数从 9 降到 7；已验证桌面测试与 background-hide 调用 |
| 已完成 | P2-3 | 浏览器扩展版本对齐 0.2.0 | `prototypes/browser-extension/manifest.json`、`prototypes/browser-extension/package.json` |
| 已完成 | P2-4/P2-5 | PRD 与 README 对齐真实 M3 证据和正确桌面壳构建命令 | `docs/prd.md`、`README.md` |
| 已完成 | P2-6 | Node 侧重复工具函数抽到 `packages/shared/utils.js` | `packages/shared/utils.js`、`apps/local-service/src/store.js`、`apps/local-service/src/credential-vault.js`、`packages/shared/evidence-redaction.js` |
| 已完成 | P2-7 | Rust sidecar 请求体读取/JSON 解析错误不再静默吞掉 | `apps/local-service-sidecar/src/main.rs` |
| 已完成 | P3 | app.js 拆分、路由表、命名统一、Rust SAFETY、remotion 归档、二值反馈、macOS/Linux 输入检测 | 已补 `apps/desktop-shell/src-tauri/src/main.rs` Win32 unsafe SAFETY 注释、`prototypes/remotion-mascot/README.md` 未集成归档说明、`apps/local-service/src/desktop-input-detector.js` 非 Windows guarded unsupported capability 与测试；`apps/local-service/src/server.js` 已用 `createAppRoutes()`/`findAppRoute()` 覆盖普通 CRUD、desktop、auth/public、report 与 `/generate` 路由，并抽出 `buildGenerationContext()`、`buildDiagnosticsExport()`、`buildGenerateResponse()`；浏览器扩展已加二值快捷反馈并映射 success/needs-work；`packages/shared/smart-prompt-core.js` 已统一 `riskLevel/sourceType/sourceBoost` canonical 命名并保留旧输入兼容；`apps/desktop-shell/src/app.js` 已将 overlay 纯判定/布局逻辑拆到 `apps/desktop-shell/src/desktop-overlay-logic.js` 并保留同名 wrapper |

## 本轮已验证

- `npm.cmd test`（`packages/prompt-session`）：契约测试通过。
- `SMART_PROMPT_KEEP_TEST_ARTIFACTS=1 npm.cmd test`（`prototypes/browser-extension`）：prompt engine、manifest、site adapters、真实 Demo 渲染/生成/写回/撤销通过；统一 `review`/`inserted` 状态、单行主操作和 `no-auto-submit` 断言通过。
- `npm.cmd test` 与 `npm.cmd run prompt-session-runtime-test`（`apps/desktop-shell`）：静态、交互和 Headless Chrome Overlay 状态投影通过；覆盖 `idle`、`drafting`、`review`、`target_missing`、`copy_only`、机器/人工 `inserted` 和 `blocked`。
- `Get-FileHash`：共享源码和浏览器/桌面运行时副本 SHA-256 相同；`git diff --check` 通过，仅有既有 LF/CRLF warning。
- `node --check packages/shared/prompt-quality.js` 与 `packages/shared/prompt-quality/*.js`。
- `node -e "const q=require('./packages/shared/prompt-quality'); ..."`：导出数 48，核心函数可用。
- `node scripts/check-v6-prompt-quality.js`：`pass=true`。
- `npm test --prefix apps/local-service`：通过。
- `npm test --prefix prototypes/browser-extension`：通过。
- `npm test --prefix apps/desktop-shell`：通过。
- PowerShell parser：`scripts/check-p25-visual.ps1`、`scripts/p25-visual/*.impl.ps1`、`scripts/check-p25-overlay-background-hide.ps1`、`scripts/check-p25-overlay-click-chain.ps1` 通过。
- `scripts/check-p25-visual.ps1 -Mode OverlayWindowVisualAttach -AllowFailure -TimeoutSeconds 0`：生成旧 schema 报告，未启动进程、未点击、未写入。
- `scripts/check-p25-visual.ps1 -Mode MascotOverlayNoActivate -AttachOnly -KeepRunning -AllowFailure -TimeoutSeconds 0`：生成旧 schema 报告，未启动进程。
- `scripts/check-p25-visual.ps1 -Mode DesktopShellVisualRuntime -AllowFailure -TimeoutSeconds 0`：生成旧 schema 聚合报告，停在 `start_not_allowed`，未尝试真实点击或填充。
- `scripts/check-p25-overlay-background-hide.ps1 -AllowFailure -TimeoutSeconds 0`：通过新 visual 入口生成 attach 报告。
- `node --check apps/desktop-shell/src/app.js apps/desktop-shell/src/overlay.js`：通过。
- `npm test --prefix apps/desktop-shell`：通过。
- `npm test --prefix apps/local-service`：通过。
- `npm test --prefix prototypes/browser-extension`：通过。
- `cargo check --manifest-path apps/local-service-sidecar/Cargo.toml`：通过。
- PowerShell parser：`scripts/check-m3-desktop-input.ps1`、`scripts/check-m3-desktop-fill.ps1`、`scripts/check-m3-real-desktop-tools.ps1`、`scripts/check-p25-runtime-readiness.ps1` 通过。
- M3 自测：`check-m3-desktop-input.ps1 -SelfTest -SelfTestProfile workbuddy -JsonOnly`、`check-m3-desktop-fill.ps1 -SelfTest -AllowClipboardFallback -JsonOnly`、`check-m3-real-desktop-tools.ps1 -Profiles workbuddy -JsonOnly` 通过；最后一项未写真实目标，`writeAttempted=false`。
- 裸空 catch 扫描：`rg "catch \\{\\}|\\.catch\\(\\(\\) => \\{\\}\\)" scripts apps/desktop-shell/src packages prototypes/browser-extension/src -g "*.ps1" -g "*.js"` 无匹配。
- `git diff --check`：通过；仅输出 LF/CRLF 转换 warning。
- P3 增量验证：`npm test --prefix apps/local-service` 通过；`cargo check --manifest-path apps/desktop-shell/src-tauri/Cargo.toml` 通过；`git diff --check -- apps/local-service/src/desktop-input-detector.js apps/local-service/tests/local-service.test.js apps/local-service/README.md docs/m3-desktop-input.md prototypes/remotion-mascot/README.md assets/ui-ux/mascot-animations/README.md apps/desktop-shell/src-tauri/src/main.rs` 通过，仅 LF/CRLF warning。
- P3-2/P3-6 增量验证：`npm test --prefix apps/local-service`、`npm test --prefix prototypes/browser-extension`、`npm test --prefix apps/desktop-shell` 均通过；`node --check apps/local-service/src/server.js` 通过；`rg "if \\(req\\.method === .*url\\.pathname|if \\(req\\.method === .*startsWith"` 确认业务路由 if 链已清空，仅保留 CORS `OPTIONS` 预检；`git diff --check -- apps/local-service/src/server.js apps/local-service/tests/local-service.test.js prototypes/browser-extension/src/content.js prototypes/browser-extension/src/content.css prototypes/browser-extension/tests/runtime-demo.test.js` 通过，仅 LF/CRLF warning。
- P3-3 增量验证：`node -e "const core=require('./packages/shared/smart-prompt-core'); ..."` 证明 parse 输出 camelCase、无 `source_type`、sourceBoost=0.8、slug 长度 50、id 含 sourcePath hash；`npm test --prefix prototypes/browser-extension` 与 `npm test --prefix apps/local-service` 通过；`git diff --check -- packages/shared/smart-prompt-core.js prototypes/browser-extension/src/smart-prompt-core.js prototypes/browser-extension/tests/prompt-engine.test.js` 通过，仅 LF/CRLF warning。
- P3 app.js 拆分验证：`node --check apps/desktop-shell/src/desktop-overlay-logic.js`、`node --check apps/desktop-shell/src/app.js`、`npm test --prefix apps/desktop-shell` 通过；`git diff --check -- apps/desktop-shell/src/app.js apps/desktop-shell/src/desktop-overlay-logic.js apps/desktop-shell/index.html apps/desktop-shell/tests/desktop-shell.test.js apps/desktop-shell/tests/desktop-shell-interaction.test.js` 通过，仅 LF/CRLF warning；`app.js` 从 3070 行降至 2831 行，新 helper 342 行。

## 待验证
- WorkBuddy real write attempt after foreground authorization: `scripts/check-m3-real-desktop-tools.ps1 -Profiles workbuddy -AttachExistingWindow -AllowForegroundWrite -AllowClipboardFallback -AllowTextPatternVerification -Report research/m3-real-desktop-tools-workbuddy.latest.json -JsonOnly` found `WorkBuddy`, `foreground.hasTargetForeground=true`, `safeCandidateCount=1`, `write.attempted=true`, `strategy=clipboard_paste_fallback`, `noAutoSubmit=true`, but `write.verified=false` with `reason=foreground_after_clipboard_paste_verification_unavailable`.
- Trae remains unavailable: `scripts/check-m3-real-desktop-tools.ps1 -Profiles trae -AttachExistingWindow -AllowForegroundWrite -AllowClipboardFallback -AllowTextPatternVerification -Report research/m3-real-desktop-tools-trae.latest.json -JsonOnly` reported `windowFound=false`, `write.attempted=false`, `completionImpact=target_tool_not_foreground`.
- Real foreground write attempt after user authorization: `check-m3-real-desktop-tools.ps1 -Profiles workbuddy,trae -AllowForegroundWrite -AllowClipboardFallback -AllowTextPatternVerification -JsonOnly` did not write because foreground was `codex` and `completionImpact=target_tool_not_foreground`; separate `-Profiles workbuddy -AttachExistingWindow -JsonOnly` and `-Profiles trae -AttachExistingWindow -JsonOnly` probes both reported `windowFound=false`.
- WorkBuddy/Trae real fill remains blocked by environment: authorization exists, but no visible/foreground WorkBuddy or Trae target window was found; rerun only after the target input is open and foreground, or after `-AttachExistingWindow` can find a matching window.

- WorkBuddy/Trae 真实前台写回仍未完成；当前只有 profile/self-test 与 snapshot-only/guard 证据，不能标为真实 Fill 验收完成。
- P3 结构项已收口；当前剩余未验收项仍是 WorkBuddy/Trae 真实前台 Fill 证据。

## 边界

- 本轮不自动运行真实 overlay click，不自动写真实 Codex/WorkBuddy/Trae composer。
- 真实 Fill 验收仍必须满足同轮 foreground/title/profile/candidate/clipboard fallback/no-auto-submit 证据；不能用视觉 ready 或 weak fallback 直接替代真实写回证据。
- Real foreground write rerun after target focus: WorkBuddy attach succeeded (`windowFound=true`, `detectedToolProfile=workbuddy`, `safeCandidateCount=1`) and write was attempted via `clipboard_paste_fallback` with `noAutoSubmit=true`, but machine readback remained `verified=false` (`foreground_after_clipboard_paste_verification_unavailable`). Trae attach succeeded and passed full machine verification (`detectedToolProfile=trae`, `safeCandidateCount=1`, `write.attempted=true`, `verified=true`, `verifiedTextHash=60b0fcc569e3b7b0`, `noAutoSubmit=true`).

## 2026-06-17 WorkBuddy real-fill guard update

- User confirmed the prior WorkBuddy paste was not visible, so that result is invalid for acceptance.
- Added real-write guards for invisible/minimized/cloaked/unusable foreground windows in `scripts/check-m3-real-desktop-tools.ps1` and `scripts/check-m3-desktop-fill.ps1`.
- Disabled WorkBuddy weak-signal clipboard fallback in `packages/shared/desktop-tool-profiles.json` and `packages/shared/desktop-tool-profiles.js`; WorkBuddy now requires a strong safe candidate before any real paste.
- Latest WorkBuddy report: `research/m3-real-desktop-tools-workbuddy.latest.json`; foreground WorkBuddy was visible and usable, but `candidateCount=0`, `safeCandidateCount=0`, `write.attempted=false`, reason `foreground_fill_requires_safe_candidate`.
- Latest Trae rerun could not attach a Trae window; foreground remained WorkBuddy, `write.attempted=false`, `completionImpact=target_tool_not_foreground`. Earlier Trae machine-verified pass remains historical evidence, not refreshed in this rerun.
- Verification after this guard update: PowerShell parser checks passed, fill self-test passed, `npm test --prefix apps/local-service`, `npm test --prefix prototypes/browser-extension`, and `npm test --prefix apps/desktop-shell` all passed; scoped `git diff --check` only reported LF/CRLF warnings.

## 2026-06-17 WorkBuddy follow-up after `继续`

- Added `scripts/check-m3-uia-element-diagnostics.ps1`, a read-only metadata-only UIA map. It records control types, hashes, geometry, pattern/focus booleans, and never stores raw title, UIA names, input values, prompt text, or clipboard text.
- WorkBuddy UIA diagnostics showed the real WorkBuddy window exposes only `ControlType.Window` plus two `ControlType.Pane` nodes, so there is no machine-readable Edit/Document child candidate to target.
- Updated WorkBuddy/Trae visual fallback geometry in `scripts/check-m3-desktop-input.ps1` and `scripts/check-m3-desktop-fill.ps1` to use the Win32 foreground/window bounds for visual candidates, avoiding UIA root DPI coordinate mismatch.
- Updated `scripts/check-m3-real-desktop-tools.ps1` attach evidence with `cursorPlacement` metadata and composer-region cursor targeting for WorkBuddy/Trae. This remains metadata-only.
- Current blocker: latest WorkBuddy attach returned a minimized/offscreen handle (`isMinimized=true`, `isUsable=false`, bounding rect `x=-16000,y=-16000,width=157,height=25`), so cursor placement was not attempted and real write remains blocked. Do not run WorkBuddy real write until a visible usable WorkBuddy composer window is restored.
- Verification after this follow-up: PowerShell parser checks passed, fill self-test passed, `npm test --prefix apps/local-service`, `npm test --prefix prototypes/browser-extension`, and `npm test --prefix apps/desktop-shell` all passed; scoped `git diff --check` only reported LF/CRLF warnings.
- Continued rerun after user said `继续`: WorkBuddy became visible/usable, but automatic cursor placement into the composer region was blocked or redirected. Latest protected write report has `write.attempted=false`, reason `foreground_fill_requires_manual_composer_focus`, `candidateIndex=-1`, `safeCandidateCount=0`, and no auto-submit signals.
- Validation for this increment: parser checks passed for M3 PowerShell scripts, fill self-test passed, `npm test --prefix apps/local-service` passed, and scoped `git diff --check` only reported LF/CRLF warnings.

## 2026-06-18 WorkBuddy focused foreground rerun

- After the user manually focused WorkBuddy, the read-only gate `research/m3-desktop-input-workbuddy-focused.latest.json` detected foreground `workbuddy`, `isUsable=true`, title hash `d754cc54dc1de6d8`, and one safe visual cursor-anchored candidate at index `0`.
- Updated `scripts/check-m3-desktop-input.ps1` and `scripts/check-m3-desktop-fill.ps1` so WorkBuddy/Trae can create a cursor-anchored visual candidate when UIA exposes only panes and the cursor is inside the lower composer region.
- Ran protected foreground write for WorkBuddy without attaching a new window. The latest evidence has `write.attempted=true`, strategy `clipboard_paste_fallback`, title/profile matched, `noAutoSubmit=true`, requested text length/hash only, but `write.verified=false` because WorkBuddy still does not expose machine-readable UIA/Text/Value readback.
- Fixed `scripts/check-m3-real-desktop-tools.ps1` top-level `pass` semantics: when `-AllowForegroundWrite` is explicitly enabled, top-level pass now requires all requested profiles to have validated real writes; snapshot/privacy alone cannot turn a real-write report green.
- Current blocker: WorkBuddy acceptance still needs either machine-readable verification or explicit user visual confirmation that the pasted test text is visible in the composer. Do not mark Codex goal or OMX autoresearch complete before that evidence is recorded.
- Validation for this increment: PowerShell parser checks passed for M3 scripts; fill self-test passed; `npm test --prefix apps/local-service`, `npm test --prefix apps/desktop-shell`, and `npm test --prefix prototypes/browser-extension` passed; scoped `git diff --check` only reported LF/CRLF warnings.

## 2026-06-18 Installed sidecar/critic repair

- Full `scripts/critic-m3.ps1` initially failed after real-write pass semantics were tightened because the real foreground clipboard guard now exits non-zero when correctly blocked. Updated the critic to allow that expected guard exit and assert the JSON fields (`pass=false`, no write attempted, title-hash mismatch, no raw text leak).
- Full critic then exposed an installed-sidecar packaging gap: `prepare-sidecar.js` copied the M3 input/fill scripts but not their new `desktop-tool-profile-config.ps1` and `packages/shared/desktop-tool-profiles.json` dependencies. Installed app `/desktop/input-snapshot?selfTest=1` returned 500.
- Fixed `apps/desktop-shell/scripts/prepare-sidecar.js` to package the profile config script and JSON, and extended `apps/desktop-shell/tests/desktop-shell.test.js` to assert these resources are included.
- Hardened `scripts/check-v4-installer-smoke.ps1` to clean stale Smart Prompt sidecar processes on the smoke test service port before/after the run, preventing an old sidecar from being mistaken for the newly installed app's sidecar.
- Hardened `scripts/check-v4-installed-app-runtime.js` to include sanitized HTTP error summaries and redact the bundled sidecar binary path in raw runtime evidence.
- Evidence refreshed: `research/m3-installed-sidecar-desktop-input.latest.json` now has `pass=true`, bundled native sidecar/input/fill probes true, installed app started/stopped sidecar true, desktop snapshot self-test true, desktop fill self-test true, and privacy checks true.
- Full `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-m3.ps1` now passes. Remaining non-critic gap is still WorkBuddy real foreground write verification: latest WorkBuddy evidence has one safe candidate and `write.attempted=true`/`noAutoSubmit=true`, but `write.verified=false`.

## 2026-07-18 options 加载与桌面单实例修复

- 浏览器扩展设置页补齐 `smart-prompt-core.js -> prompt-engine.js -> options.js` 加载顺序，消除 `Smart Prompt shared core must be loaded before prompt-engine.js`。
- 新增 options 静态顺序测试和真实 Chromium unpacked-extension 运行时测试；完整扩展测试通过，运行时确认 `SmartPromptCore === SmartPromptEngine`、设置页完成加载且无该异常。
- 桌面壳引入 `tauri-plugin-single-instance` 并作为首个 Tauri 插件注册；重复启动会聚焦已有控制中心后退出，不再创建多个任务栏实例。
- 对抗审查发现的两个 P2 已收口：`focus_main_window()` 增加 `unminimize()`；真实 runtime test 按 PID + 精确窗口标题覆盖“初始隐藏 -> 二次启动显示/聚焦 -> 最小化 -> 三次启动恢复/聚焦”，并验证全程仅一个 release 进程。
- 已停止截图对应的 4 个旧 installer-smoke 桌面进程及其所属 sidecar，启动修正版 release；最终二次启动退出码为 0，修正版进程数为 1（PID `21120`），旧路径进程数为 0。
- 验证通过：扩展 `npm.cmd test`、桌面壳 `npm.cmd test`、`cargo fmt --check`、隔离 target 的 `cargo check`、单实例真实二次启动探针、scoped `git diff --check`（仅 LF/CRLF warning）。

## 2026-07-18 正式安装包重建与安装

- 通过 `npm.cmd run build` 重新生成 MSI/NSIS；最终 NSIS 为 `apps/desktop-shell/src-tauri/target/release/bundle/nsis/Smart Prompt_0.2.0_x64-setup.exe`，SHA-256 `5335883C6793F0165C8749BDBCA736BB26F7B431C6D5936B112104F316F82F4D`。
- 首次安装验收发现 packaged sidecar 无法解析 UIA PowerShell 在 JSON 前输出的 warning；新增 `parse_probe_json()` 和 4 个 Rust 回归测试，同时覆盖 desktop input/fill、错 schema 跳过和关键字段形状，并把 installer/runtime probe 默认端口从旧 `17391` 对齐固定端口 `17371`。
- 修复后重新构建并覆盖安装到 `C:\Users\lhy10\AppData\Local\Programs\Smart Prompt`；安装 sidecar SHA-256 与构建资源一致，为 `2B4106E3170F8B55C55D18C5FE38C3AE70D67931C23D641134D4029E767FCB01`。
- installed-runtime `pass=true`：WebView、Tauri API、bundled sidecar、健康接口、desktop snapshot/fill 自测、隐私约束和 stop 流程全部通过；安装版单实例 runtime test 也通过。
- 最终运行态：安装版 app PID `38996`，sidecar PID `16060`，`17371/health` 返回 `smart-prompt-local-service`，重复启动退出码 0 且 app 进程数保持 1；已激活用户启动后主窗口按契约隐藏并驻留托盘。
