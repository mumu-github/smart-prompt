# 项目上下文

## 2026-07-19 Codex Outcome Learning Loop v1 当前事实

- Goal 的代码、共享契约、native Rust、Node fallback、桌面 Card、生产候选派生和 r10 安装包已实现；规范事实源仍为 `workflows/codex-outcome-learning-loop-v1.md`。
- 核心闭环保持：读取当前 Codex 草稿、用户主动生成、审核编辑、安全完整替换、机器精确回读、绝不自动发送，再以真实 Outcome、Token、时间和返工成本学习。
- Memory、Rule、Skill、Generation Policy 四类候选均从服务端 verified outcome 生产链路派生。原始输入只在 Session 内映射为固定 `learning-candidate-seed@1`；Card 打开通过本地 resolver 零模型匹配提醒。
- Node 与 native Rust 对缺省任务场景使用 `task-scenario-inference-fixtures@1` 的同一有序规则；显式场景优先，长期数据只保存有限 token。
- P0 仍不读取聊天历史、屏幕、项目文件、剪贴板或附件；`ContextSource` 只预留授权、预览、移除和不可信输入契约。受控剪贴板仅是用户点击填入后的写回兜底。
- 四轮对抗审查最终 `PASS`，当前已知 P0/P1/P2 代码项均为 0。native r10、Phase 3 生产契约、隔离隐私扫描、Control Center 与 Assistant Card 视觉证据均通过。
- r10 只是已构建候选，尚未在本轮安装或执行真实 Codex GUI 闭环。安装、前台切换、读取/写回、受控剪贴板、模型连通性均需本轮精确授权；真实付费 benchmark 另需预算授权。
- 实现必须保留现有 Agnes、OpenAI-compatible、Anthropic、Gemini、Custom Provider、模型和加密凭证，不得覆盖用户当前配置。

## 2026-07-19 模型配置与错误语义

- 此前 Agnes 修复轮次的稳定安装目录为 `C:\Users\lhy10\AppData\Local\Programs\Smart Prompt`，当时 installed sidecar SHA-256 为 `541A0895156FD4B138DB7A7A692C41D6361E78050AE099F73B7A250441C945ED`；该证据早于当前 r10，不能当作 r10 已安装证明。
- 用户现有 Agnes 设置仍是 `agnes-2.0-flash`，凭证状态只公开为 `configured`。安装版真实 `/llm/test` 与 `/generate` 均由 `llm` 成功返回，因此当前 Key 没有失效；此前截图是前端把 `provider_error` 泛化成“模型暂不可用”。
- 控制中心模型页现在把模型作为主字段：每个 Provider 提供一个推荐模型和“自定义模型 ID”；未知历史模型自动保留为自定义值，Key 留空不会覆盖已保存凭证。
- 模型 ID 契约为 trim 后 1-200 字符且不能含空白；Web、Node 与 native 三层都校验。无效模型必须在写凭证前拒绝，不能污染现有设置。
- “保存并测试”是原子流程：候选 Provider/Base URL/模型/Key 先在内存中执行真实测试，只有成功后才持久化；失败候选不得覆盖旧 Key。native `auto` 的执行顺序、默认端点和 `/llm/providers` 状态上报都复用 Agnes -> Anthropic -> Gemini -> OpenAI-compatible 同一契约。
- Prompt Session 现在区分 `credential-invalid`、`model-unavailable`、`network-unavailable`、`provider-error`；裸 404 不再自动归因于模型，只有响应明确提及 model/deployment 且不可用时才映射模型错误。
- 浏览器扩展源文件已更新，但用户当前 Chrome 的 unpacked extension 仍需在 `chrome://extensions` 执行一次“重新加载”，再刷新目标页才能确保新 content script 生效。

## 2026-07-17 第一性原理产品结论

- 当前产品应收敛为“输入框旁的上下文提示词编辑器”，核心循环只有：读取当前草稿、生成/优化、用户审核、填入原输入框、用户自行发送。
- 推荐形态是“一个核心任务、两个用户界面、三个技术层”：网页与桌面共用上下文 Assistant Card；桌面主窗口只做低频控制中心；Prompt Session、Target Adapter、Local Runtime 分层。
- 桌面主窗口当前把首次配置、日常生成、服务控制、研发自测、实验指标、诊断和资料管理放在同一层，应移除营销 Hero、Service 启停、Self-Test、Learning/Pilot/Quality 等普通用户不需要的内容。
- 网页 `content.js` 与桌面 `overlay.js` 曾各自维护状态、文案和 UI，是体验分叉的主要根因；阶段 0 至 2 已用共享 Prompt Session、View Model 和 Assistant UI 收敛该问题。
- 详细方案与逐文件迁移计划见 `docs/smart-prompt-first-principles-product-plan-2026-07-17.md`。

## 2026-07-17 阶段 3 实现事实

- 当前浏览器契约版本为 `phase3-extension-20260717-r5`（扩展 `0.2.6`），native sidecar/控制中心契约版本为 `phase3-native-sidecar-20260717-r6`；服务端拒绝旧扩展完成激活。
- 扩展 complete bridge 已端到端保留 `extensionBuildId` 与 `stableReadback`；ChatGPT 打开后控制中心立即调用 `hide_main_window`。Node 与 native 诊断 API 均只返回 `dataDirConfigured`，不返回绝对数据目录。
- `scripts/check-phase3-privacy.js` 只读检查本地持久化、API、日志和 Phase 3 research JSON，当前结果为 pass，禁止字段和绝对路径计数均为 0。
- 真实 ChatGPT 验收已完成：r5/ready、Agnes 真实 LLM 生成、用户态编辑、`verified_insert`、精确稳定回读、消息数和路径不变、无 Send/Enter；单次观测耗时 `144446 ms`。最终 release 在 activated 数据上重启后两个 Tauri 窗口均隐藏，托盘与快捷键基础设施存在。
- `apps/local-service/src/modules/activation/activation-store.js` 是唯一激活状态事实源；持久化只保留进度、健康、Provider/模型元数据、事件 ID、时间和隐私布尔，不保留 Prompt、输入、剪贴板、标题或 DOM 字段。
- `apps/local-service/src/store.js` 在保存设置时推进 `configuring`，启动时对旧设置/metrics 做一次迁移；`clearAllLocalData()` 只把数据移动到 `.recovery/reset-*`，不要恢复 `fs.rmSync` 永久删除路径。
- `apps/local-service/src/server.js` 已新增 `/activation/status`、`/activation/browser-seen`、`/activation/complete`、`/activation/reset`、`/activation/runtime-health`，Provider 连接错误对外归一为 `credential_invalid`、`model_unavailable`、`network_unavailable`、`provider_error`。
- `prototypes/browser-extension/src/activation-evidence.js` 与 `content.js` 只允许 ChatGPT verified insert/copy 结束激活；复制只有在 `navigator.clipboard.writeText` 成功后才计为 copy completion。
- `prototypes/browser-extension/src/background.js` 是 Chrome/Edge MV3 的本地服务桥接边界：令牌只在 worker 内存中，服务端固定接受生成的扩展 Origin，ChatGPT 页面不能直接拿令牌或伪造激活；桥接服务端口固定为 `17371`，`/auth/bootstrap` 不作为 content-script route 暴露。
- ChatGPT 写回候选已收窄到 `prompt-textarea` 精确语义，`verified_insert` 必须携带 `targetKind=chatgpt-composer`；当前实现范围只宣称 Chrome/Edge MV3，Firefox/Safari 为后续适配。
- `apps/desktop-shell/src/control-center-app.js` 是新的主窗口入口；`index.html` 标记 `data-phase3-control-center=true` 并隐藏旧 `legacy-shell`，旧 `src/app.js` 的 overlay 初始化在该模式停用，避免重复服务请求和旧 UI 露出。
- Tauri `main.rs` 现在会把主窗口 CloseRequested 转为 hide，并提供 `hide_main_window`、`open_chatgpt`；首次未激活启动才唤起主窗口，激活后默认保持隐藏。

## 2026-07-17 阶段 3 已确认设计

- 下一阶段采用“纵向激活闭环”，目标不是单纯重做五页 UI，而是让已安装桌面应用和扩展、已登录 ChatGPT、持有有效 Key 的内测用户在 3 分钟内完成首次真实核心循环。
- 模型采用 BYOK；向导允许选择 Agnes、OpenAI-compatible、Anthropic、Gemini，只显示当前 Provider 所需字段，并执行真实模型连通性测试。
- 连通性测试只推进到 `model_ready`；首次激活必须在 ChatGPT Assistant Card 中完成 verified insert 或成功 copy，且始终 `no-auto-submit`。
- 激活进度与运行健康分离：激活为 `not_started/configuring/model_ready/awaiting_first_loop/activated`，健康为 `healthy/repairing/needs_repair`；瞬时故障不得抹掉已完成激活。
- 首次流程完成后收起到托盘，后续启动默认隐藏；控制中心只保留概览、模型、隐私、诊断四页。
- 本阶段不包含扩展安装/商店发布、桌面真实写回重新认证、WorkBuddy 攻坚、资料/历史/收藏/反馈、新 Provider/站点或大型框架迁移。
- 设计规格见 `docs/superpowers/specs/2026-07-17-desktop-activation-control-center-design.md`；可执行 Goal 提示词见 `docs/goals/smart-prompt-phase3-activation-goal-prompt.md`。

## 2026-07-17 阶段 0/1/2 实现事实

- `docs/product-contract.md` 已冻结扩功能边界；`docs/assistant-state-spec.md` 是 `prompt-session@1` 的状态、命令、reason、能力和 View Model 规范。
- `packages/prompt-session/index.js` 是唯一源码，端侧副本为 `prototypes/browser-extension/src/prompt-session.js` 与 `apps/desktop-shell/src/prompt-session.js`；只能用 `scripts/sync-prompt-session-runtime.js` 同步，不要直接修改副本。
- `packages/assistant-ui/` 是共享 Assistant Card 的唯一 UI 源码；`scripts/sync-assistant-ui-runtime.js` 同步到浏览器与桌面运行时，hash 测试防止分叉。
- 浏览器 `content.js` 与桌面 `overlay.js` 已同时消费 `prompt-session@1` View Model 和共享 Shadow DOM Card；标题、说明、编辑器、模式、主/次操作、键盘行为与安全提示一致。
- 桌面仍保留原有 UIA/foreground/safe candidate/Tauri IPC 守卫；本轮没有运行真实目标写入，也没有放宽 WorkBuddy、Codex 或 Trae 写回资格。
- 阶段 2 已完成；下一步是阶段 3 桌面控制中心瘦身，不要再在网页 Card 与桌面 Overlay 分别加普通用户功能。
- 阶段 2 视觉证据：`outputs/assistant-card-phase2/browser-review.png`、`browser-inserted.png`、`desktop-review.png`、`desktop-target-missing.png`、`desktop-compact.png`。

## 当前目标

- 桌面真实输入框附近的透明小人入口必须与浏览器网页端共用同一 Assistant Card；核心动作是生成、编辑、重新生成、复制、填入和撤销，不再暴露 Draft/Make/Scan/evidence 等旧组合控件。
- 当前桌面 compact 目标形态是透明 `72x72` 小人入口 + 小状态点；展开后是 `320x360` 共享 Assistant Card。用户截图中的“大白块 + thinking pill”不是目标体验，已确认为旧桌面 overlay/WebView 白底或旧运行包露出，不是小人 PNG 问题。

## 当前实现事实

- `apps/desktop-shell/overlay.html`、`overlay.css`、`overlay.js` 在 expanded 模式挂载共享 Card；旧 quick draft/replies/preview DOM 仅保留兼容与 compact 小人承载，expanded 模式不可见。
- 浏览器扩展通过 manifest 注入同一 `assistant-card.js`，CSS 作为 web-accessible resource 加载；成功填入后仍停留在同一 Card 的 `inserted` 状态并提供撤销。
- `apps/desktop-shell/src/app.js` 已把 overlay placement 绑定 `readiness.bestCandidateIndex`，并把 `visualOnly=true` 作为视觉锚点而非写入候选；`candidateIndex=-1` 且 `payload.visualOnly !== true` 才可进入真实对齐。
- Codex 真实 UIA 暂时没有 safe writable candidate 时，底部宽按钮式区域只允许作为 visual-only 锚点，让小人视觉贴近 composer；该路径不提升为 safe candidate，也不能触发真实 Fill。
- `handleMascotOverlayClick()` 只有在 payload/readiness 对齐且 `overlayAction === "fill"` 时才允许进入 `fillForegroundInput()`；`visualOnly + fill`、缺 payload、stale payload 或非 fill action 都不得触发 `/desktop/fill`。
- `apps/desktop-shell/src-tauri/src/main.rs` 已硬化 overlay 透明背景：`transparent(true)`、透明 `background_color`、运行时 `set_background_color`，显示前先向隐藏窗口发送 overlay 状态，显示后再发送一次，避免窗口先变大但 DOM 仍停在旧 compact/旧状态；保留 no-activate/topmost 处理。
- bundled sidecar 启动前会复制整个 `smart-prompt-sidecar` 到 app local data 的 `sidecar-runtime/<fingerprint>/` 再运行，避免默认 release resources 中的 sidecar exe 被运行进程长期锁住。

## 当前证据

- `node scripts/check-p25-overlay-chat-visual.js` 已迁移到 `p25-overlay-chat-visual@2` 并通过：共享 Card 契约、target-missing、guarded fill、regenerate、mode routing 均为 true；compact `384x380` 截图的 `nonOpaqueRatio=0.9916`、`opaqueRatio=0.0084`，无大白块。
- `npm.cmd test` 已分别在 `packages/assistant-ui`、`packages/prompt-session`、浏览器扩展和桌面壳通过；桌面 `prompt-session-runtime-test`、`prepare-dist`、同步 hash、PowerShell parser、`node --check` 与 `git diff --check` 通过。
- `scripts/check-p25-overlay-click-chain.ps1` 已新增离线候选包证据：`desktopDistHasTransparentCompactOverlay=true`、`transparentReleaseCandidateReady=true`、`transparentReleaseCandidateFresh=true`，并记录 exe hash 前缀、大小、dist/source 时间戳。最新聚合审计仍为预期失败：`completionImpact="runtime_readiness_missing"`。
- 2026-07-17 聚合审计中的阶段 2 静态与运行项均为 true，但整体仍应为 `pass=false`、`completionReady=false`：缺 fresh no-activate/runtime、真实运行包、verified target write 和真实 overlay click 证据。
- 最新只读 `scripts/check-p25-real-overlay-click-fill.ps1 -Profiles codex`：`desktopPromptStateReady=true`、`strictForegroundReady=true`、`safeCandidatesReady=false`、`click.attempted=false`，所以不能运行 `-AllowRealOverlayClick`。

## 当前运行状态

- 最新只读进程检查未发现 `smart-prompt-desktop.exe` 正在运行，只看到旧 `local-service-sidecar.exe` 从默认 `apps/desktop-shell/src-tauri/target/release/resources/...` 路径运行。
- 因此“备用 release 已构建并离线验证通过”不等于“用户前台真实桌面壳已加载新版透明 overlay”。真实视觉验收仍需在用户明确许可后启动/切换到最新候选包并刷新 no-activate/runtime evidence。

## 当前验证入口

- 视觉 smoke：`node scripts/check-p25-overlay-chat-visual.js`。
- P25 visual 聚合入口：`scripts/check-p25-visual.ps1`，通过 `-Mode DesktopShellVisualRuntime|MascotOverlayNoActivate|OverlayWindowVisualAttach` 覆盖原 3 个 visual-attach 入口；旧实现已移入 `scripts/p25-visual/*.impl.ps1`。
- 聚合审计：`scripts/check-p25-overlay-click-chain.ps1`；它的 `pass=false` 目前是诚实缺口，不代表视觉修复回退。
- 真实点击只读 gate：`scripts/check-p25-real-overlay-click-fill.ps1 -Profiles codex`。
- 目标矩阵：`scripts/check-p25-real-desktop-targets.ps1`；真实写入矩阵必须显式授权，并且仅在 strict foreground + safe candidate 成立时使用。

## 2026-06-17 整改事实

- P0/P1/P2 代码整改已覆盖：桌面工具 profile 配置化、WorkBuddy/Trae 弱信号 clipboard fallback、浏览器扩展 shared core 复用、凭证随机 fallback、非 JSON 响应处理、overlay 退避轮询、prompt-quality 拆分、visual 入口合并、空 catch 可观测/注释、Rust sidecar 错误返回。
- 当前仍不能声称 WorkBuddy/Trae 真实写回已验收：最新 `scripts/check-m3-real-desktop-tools.ps1 -Profiles workbuddy -JsonOnly` 只读通过，但 `writeAttempted=false`，真实写回仍需要同轮 foreground/title/profile/candidate/no-auto-submit 证据和明确写入许可。

## 下一步

- 若用户明确允许启动/切换桌面壳：启动最新 `target-p25-transparent-release` 候选，刷新 no-activate/runtime 证据，再跑只读 overlay gate。
- 若只继续只读：让 Codex composer 重新聚焦到能暴露 safe candidate 的状态后，先跑 `scripts/check-p25-real-overlay-click-fill.ps1 -Profiles codex`；只有同一轮显示 `desktopPromptStateReady=true` 且 `safeCandidatesReady=true`，才允许进入真实点击复验。

## Runtime readiness verifier
- Added `scripts/check-p25-runtime-readiness.ps1` (new script).
- Adds read-only process-to-candidate matching checks and writes `research/p25-runtime-readiness.latest.json` with sanitized fields only.
- Integrated into `scripts/check-p25-overlay-click-chain.ps1` via `-RuntimeReadinessReport`, plus `runtimeChecks` + `runtimeEvidence` fields for process match/status.
- Validation: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-p25-runtime-readiness.ps1 -AllowFailure -Report research/p25-runtime-readiness.latest.json` (report generated).
- Validation: parser checks for both scripts passed.

## 2026-06-13 当前桌面 overlay 事实修正

- 当前 compact 目标仍是透明 `72x72` 窗口中的 `60x60` 小人入口；用户截图中的大白块不是小人图片本身，而是旧/非透明 overlay WebView 或旧运行包表现。
- 当前 expanded 目标尺寸已从旧 `260x320` 改为 `320x360`，用于容纳 mood strip、evidence/status 行、quick draft、preview 编辑区和底部动作区；这不是 Fill/readiness 逻辑改动。
- 最新 `research/p25-overlay-chat-visual.latest.json`：`pass=true`、`initialCompactProbe.largeWhiteBlockAbsent=true`、`overlayViewports.compact=72x72`、`overlayViewports.expanded=320x360`。
- 最新备用 release 候选为 `apps/desktop-shell/src-tauri/target-p25-transparent-release/release/smart-prompt-desktop.exe`，SHA256 前缀 `5854ae029ad65fdd`；它只证明候选包已构建，不能证明用户前台真实桌面壳已加载该版本。
- 当前只读 runtime readiness 仍显示没有运行中的 `smart-prompt-desktop.exe`；聚合链路红灯是预期状态，不代表视觉白块修复回退。

## 2026-06-13 当前视觉事实

- 用户截图里的大白块对应旧/未匹配 overlay WebView 或初始化露白；目标态不是卡片白板，而是透明 `72x72` compact 小人入口。
- `overlay.html` 内联 compact 样式已加固：默认 `72x72`、小人 `60x60`、状态点、隐藏文字胶囊和面板，避免 CSS/状态加载前先露白。
- `scripts/check-p25-overlay-chat-visual.js` 已新增 `initialCompactProbe`：在 `render()` 前用 `260x320` 视口验证默认 compact 不出现大白块；最新 `largeWhiteBlockAbsent=true`、`opaqueRatio=0.0074`。
- 最新备用候选 exe hash 前缀为 `9dfeae238772eabe`，但当前没有运行中的 `smart-prompt-desktop.exe` 匹配它；真实桌面是否加载新版仍未验证。

## 2026-06-13 当前交互事实

- 桌面 overlay expanded 现在有三段小状态条，按 `data-mascot-mood` 显示 `idle/ready/scan/thinking/success/guard`，用于增强“小人正在回应”的聊天感。
- 状态条仅为 UI/动画层，不参与 `mascot_overlay_clicked`、`/desktop/fill`、safe candidate 或 runtime readiness 决策。
- 最新视觉报告：`pass=true`、8 个状态 `moodStripMatches=true`、`initialCompactProbe.compactMoodStripHidden=true`、compact 白块探针仍为 `largeWhiteBlockAbsent=true`。
- 最新备用候选 exe hash 前缀为 `33206616a41635ec` 且 `fresh=true`；真实桌面进程仍未运行/未匹配该候选。

## 2026-06-13 覆盖式桌面小人 UI 增强（本次任务）

- 已为 `apps/desktop-shell/overlay.html` / `overlay.css` / `overlay.js` 增加 compact/expanded 轻量“情绪状态条”体验：compact 保持 `72x72` 透明入口、expanded 显示 3 段状态条。
- `scripts/check-p25-overlay-chat-visual.js` 增加状态条可见性与状态标签匹配校验，并保留 `initialCompactProbe.compactMoodStripHidden` 与 `largeWhiteBlockAbsent` 约束。
- 本轮验收通过：`node scripts/check-p25-overlay-chat-visual.js`（`pass: true`）、`npm test --prefix apps/desktop-shell`（通过）。
- 实施未改 Fill 守卫与真实流程；未运行 `-AllowRealOverlayClick`；未写真实 prompt 文本/clipboard/UIA raw。
## 2026-06-13 最新真实视觉状态

- 用户目标是 Codex / WorkBuddy / Trae 这类真实桌面工具里的输入框旁边出现网页端同款小人体验；Smart Prompt 桌面壳只作为透明 overlay 承载层，不是目标工具本身。
- 当前有效生产候选为 `apps/desktop-shell/src-tauri/target/release/smart-prompt-desktop.exe`，必须通过 `npm run build --prefix apps/desktop-shell` 构建；不要再用普通 `cargo build --release` 产物做真实视觉结论，因为它会加载 devUrl。
- 桌面壳主窗口默认隐藏，避免启动壳时抢前台；需要主窗口时通过托盘或 overlay action 显示。
- overlay compact 真实视觉复验已通过：真实 Codex 严格前台后，小人窗口显示为 `72x72`，no-activate 正常，无大白块；报告为 `research/p25-desktop-shell-visual-runtime.latest.json`。
- 当前只完成视觉 runtime ready；未进行真实 overlay click、未写入真实 composer、未读取 `/desktop/fill/latest`。真实 fill 仍必须等待同轮只读 gate 显示 safe candidate。

## 2026-06-13 当前真实小人视觉上下文

- 目标不是 Smart Prompt 主窗口本身，而是 Codex/WorkBuddy/Trae 真实输入框附近的小人入口；承载进程只负责显示透明 overlay。
- 最新生产包 `apps/desktop-shell/src-tauri/target/release/smart-prompt-desktop.exe` 已构建并运行，hash 前缀 `36a2eb894d975b69`；真实视觉复验显示 `72x72`、不抢焦点、无大白块。
- 小人定位已避开提交按钮：输入容器锚点会预留右侧提交按钮区域，按钮锚点会放到按钮左侧；当前 Codex 2x 保守几何核算无底部按钮重叠。
- 视觉 ready 不等于真实 fill ready；当前 Codex `safeCandidateCount=0`，不得进入 `-AllowRealOverlayClick`。
- 2026-06-17 WorkBuddy real-fill 最新边界：用户确认先前 WorkBuddy paste 不可见，该结果无效；现在已禁用 WorkBuddy weak-signal clipboard fallback，只有强 safe candidate 才允许真实写入。最新 WorkBuddy 报告为 `candidateCount=0`、`safeCandidateCount=0`、`write.attempted=false`、reason `foreground_fill_requires_safe_candidate`。
- 2026-06-17 继续排查后新增事实：WorkBuddy 当前 UIA 只暴露根窗口和 Pane，缺少可机器写入/回读的 Edit/Document 候选；已新增脱敏 UIA 元素诊断脚本，并把 WorkBuddy/Trae 视觉候选改用 Win32 窗口矩形。当前 WorkBuddy 窗口状态又变为 minimized/offscreen，真实写入必须等待用户恢复可见 composer。
- 2026-06-18 继续排查后新增事实：WorkBuddy 可见/可用时仍可能阻止自动鼠标定位到 composer；最新受保护复验返回 `foreground_fill_requires_manual_composer_focus`，没有写入。下一次 WorkBuddy 真实复验需要用户手动把光标/焦点放在 WorkBuddy composer 内，再运行同一 gate。
- 2026-06-18 用户手动聚焦 WorkBuddy 后新增事实：只读 gate 通过，光标锚定 visual candidate index `0`，随后真实前台写回已尝试且未自动提交，但 WorkBuddy UIA 仍无法机器读回验证。当前等待用户视觉确认或后续机器可读信号，不能仅凭 attempted 写回完成验收。
- 2026-06-18 安装包 sidecar 事实更新：M3 PowerShell probes 已依赖 profile config 脚本和 JSON，`prepare-sidecar.js` 必须把 `desktop-tool-profile-config.ps1` 与 `packages/shared/desktop-tool-profiles.json` 一起打进 `smart-prompt-sidecar`。最新 `research/m3-installed-sidecar-desktop-input.latest.json` 与完整 `scripts/critic-m3.ps1` 已通过。

## 2026-07-18 正式安装状态

- 最新 NSIS 已安装到 `C:\Users\lhy10\AppData\Local\Programs\Smart Prompt`，开始菜单与桌面快捷方式均存在，注册表卸载入口已从旧临时 smoke 目录切换到稳定安装目录。
- 当前真实安装版只运行一个 `smart-prompt-desktop.exe`，bundled native sidecar 在固定端口 `17371` 提供健康服务；桌面主窗口、单实例、隐藏唤起和最小化恢复均已用安装目录 exe 验证。
- Windows UIA PowerShell 可能在 JSON 前输出 warning；native sidecar 现在只接受精确的 `m3-windows-uia@1` / `m3-windows-fill@1`、布尔 `pass` 和对象 `privacy`，input/fill 均使用该解析器，不保存或返回警告原文。
