# 当前进度

## V5 PRD 与发布资产收尾 2026-06-07

- 已把 `docs/prd.md` 从 `v0.1` 草案更新为 `v0.2 beta` PRD，补入 V5 已完成项、验收证据、安装包路径、native sidecar、真实 LLM/provider、pilot 指标、里程碑状态和后续 M3 范围。
- 已确认并纳入用户的工具范围修改：目标用户行包含 workBuddy、Trae、Doubao、DeepSeek、Hermes，并把 Codex/Claude Code/Hermes 作为桌面/CLI 工具画像进入 M3。
- 已创建 GitHub Release：`https://github.com/mumu-github/smart-prompt/releases/tag/v0.2.0-beta.1`，并上传 MSI、NSIS exe、`v5-beta-checksums.sha256` 三个 assets。
- 已补 beta 站点适配：浏览器扩展和 shared core 新增 workBuddy、Trae、Doubao、DeepSeek；manifest 与测试已同步。Codex/Claude Code/Hermes 已补工具画像，不冒充网页 adapter。
- 已补真实内测 metrics 链路：扩展把 `card_ready`、`insert`、`save`、`retry`、`undo` 等 privacy-safe feedback 上报到 `/metrics`；local-service 和 native sidecar 汇总 Insert 成功率、保存率、Undo/Retry 使用率、adapter 失败率、失败原因。
- 已验证：`npm test` in `prototypes/browser-extension` PASS；`npm test` in `apps/local-service` PASS；`C:\Users\lhy10\.cargo\bin\cargo.exe check` in `apps/local-service-sidecar` PASS；`git diff --check` 无空白错误。
- 待提交：当前 PRD、adapter、metrics、release 收尾改动尚未提交。
- 仍待真实内测：workBuddy、Trae、Doubao、DeepSeek selector 需要在真实登录态页面采集 Insert 成功率和失败原因后继续修正。

## V5 Beta 发布与真实内测闭环完成进度 2026-06-07

- 已完成分组提交链路，且显式排除 `docs/prd.md`：V3/V4 evidence、desktop shell、local-service、extension、release scripts 已先行分组提交，V5 最终新增 `Ship V5 beta native sidecar release` 与 `Record V5 beta release pass manifest` 两个提交。
- 已完成 beta release 包证据：`docs/releases/v0.2.0-beta.1.md`、`research/v5-beta-checksums.sha256`、MSI/NSIS installer artifact、`v0.2.0-beta.1` tag。
- 已完成 V5 技术加固：`apps/local-service-sidecar/` Rust native sidecar、desktop shell native sidecar 启动/重启/端口恢复、local-service 诊断导出与删除全部本地数据、key 迁移状态、桌面壳诊断/清空数据 UX。
- 已完成内测产品闭环文档：`research/v5-pilot-loop.md` 覆盖 5 个真实使用场景、Insert 成功率、保存率、Undo/Retry 使用情况和 adapter 更新记录。
- 已验证：`scripts/critic-v5.ps1` PASS；`npm test` in `apps/local-service` PASS；`npm test` in `apps/desktop-shell` PASS；`npm test` in `prototypes/browser-extension` PASS；`npm run build` in `apps/desktop-shell` PASS；`scripts/check-v4-installer-smoke.ps1` PASS。
- 已推送：远程分支 `codex/prompt-automation-research` 和远程 tag `v0.2.0-beta.1` 均已推送到 `origin`。
- 已记录 OMX professor-critic verdict `pass`，证据为 `research/v5-beta-manifest.latest.json`；Codex goal 已通过 `update_goal(status=complete)` 完成。
- 未写入 OMX `completion.json`：`omx autoresearch-goal complete` 因 mission handoff 英文 objective 与用户直接创建的中文 Codex goal objective 不一致而拒绝；这是对账文本不匹配，不是 V5 验收失败。

## V4 可安装内测版完成进度 2026-06-07

- 已补强发布链路：新增 `apps/desktop-shell/scripts/prepare-sidecar.js`，并把 Tauri `beforeBuildCommand` 改为 `npm run prepare-release`；build 会同时准备 frontend dist 和包内 local-service sidecar resources。
- 已补强 Tauri local-service 启动：`apps/desktop-shell/src-tauri/src/main.rs` 新增 `get_local_service_source`，`start_local_service` 优先使用包内 `server.js` 与 `node.exe`，并注入 local data dir。
- 已补强 installer smoke：`scripts/check-v4-installer-smoke.ps1` 现在会静默安装 NSIS 包，启动安装后的 `smart-prompt-desktop.exe`，通过 CDP 调 Tauri command 启停 local-service，确认包内 sidecar/Node/health，再关闭和卸载。
- 已刷新 `research/v4-installer-smoke.latest.json`：`pass:true`，其中 `bundledSidecarResource`、`bundledNodeRuntime`、`sourceCommandBundled`、`localServiceStartedFromInstalledApp`、`serviceHealthFromInstalledApp`、`localServiceStoppedFromInstalledApp` 均为 true。
- 已刷新 `research/v4-release-manifest.latest.json`：`pass:true`、`releaseReady:true`，所有 V4 验收门均为 PASS。
- 已验证：`cargo check` PASS；`npm run build` in `apps/desktop-shell` PASS；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-v4-installer-smoke.ps1` PASS；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v4.ps1` PASS；`git diff --check` 无空白错误。
- 已记录 OMX autoresearch-goal verdict `pass`，并通过 Codex `update_goal(status=complete)` 完成 V4 goal；`omx autoresearch-goal complete` 因 mission handoff objective 与用户直接创建的中文 Codex goal objective 文本不一致被拒绝，未写 `completion.json`。

## V4 Prompt Card UX 进度 2026-06-07

- 已实现浏览器扩展 Prompt Card 完整体验：卡片内新增 `spc-mode-selector` 手动切换 `idea/continue/polish`，保留生成中/失败/ready 状态，新增 `Retry`，新增 LLM/template `spc-source-badge`，Insert 失败时留在卡片并标记失败，Insert 成功后显示 `smart-prompt-undo` toast。
- 已实现 Undo：Insert 前保存原输入，Undo 只把原输入写回当前输入框，不发送消息；同时写入 `smartPromptUndo*` DOM evidence 并记录 `undo` feedback。
- 已补 runtime evidence：`prototypes/browser-extension/tests/runtime-demo.test.js` 在 headless Chrome 中覆盖手动模式切换到 polish、Retry、Insert 不自动发送、Undo 恢复原输入、在线 Save 和离线 fallback。
- 已强化 V4 critic：`scripts/critic-v4.ps1` 现在依次跑 local-service、desktop-shell、browser-extension 三套测试，再生成 V4 manifest。
- 已刷新 `research/v4-release-manifest.latest.json`：`PROMPT_CARD_UX_PASS` 现在为 PASS；整体仍 `releaseReady:false`，剩余缺口是 `INSTALLER_PASS` 和 `LIVE_SITE_STABILITY_PASS`。
- 已验证：`npm test` in `prototypes/browser-extension` PASS；`scripts/critic-v4.ps1` 中三套测试均 PASS，最终按预期失败在 release-ready 未满足。

## V4 首启向导进度 2026-06-07

- 已新增 local-service `POST /llm/test`：该接口受 auth 保护，调用现有真实 LLM provider gateway，只返回 provider、model、mode、generatedBy、promptLength、skillCount、隐私固定项和 testedAt，不返回 prompt/card 正文。
- 已新增桌面壳首启面板：`first-run-panel`、`first-run-progress`、`privacy-boundary`、`test-provider`、`provider-test-status`；首启进度会跟踪 provider 配置、provider key、provider test、skill import 和 privacy visibility。
- 已补测试：`apps/local-service/tests/local-service.test.js` 覆盖 `/llm/test` auth/gateway/无正文泄露；`apps/desktop-shell/tests/desktop-shell-interaction.test.js` 覆盖保存 provider key、导入 skill、测试 provider 和 first-run ready 状态；`apps/desktop-shell/tests/desktop-shell.test.js` 覆盖静态 token。
- 已刷新 `research/v4-release-manifest.latest.json`：`FIRST_RUN_PASS` 现在为 PASS；后续 Prompt Card UX 也已提升为 PASS；整体 `releaseReady:false`，剩余缺口是 `INSTALLER_PASS`、`LIVE_SITE_STABILITY_PASS`。
- 已记录 OMX autoresearch-goal verdict `fail`，证据为最新 V4 manifest；该 fail 是阶段性验收结果，Codex goal 仍保持 active。
- 已验证：`npm test` in `apps/local-service` PASS；`npm test` in `apps/desktop-shell` PASS；`scripts/critic-v4.ps1` 按预期失败在 release-ready 未满足。

## V4 进度 2026-06-07

- 已按 V4 目标创建 OMX autoresearch-goal mission：`smart-prompt-v4-installable-beta-turn-v3-validat`。
- 已补 V4 sidecar 生命周期：Tauri 新增 `get_local_service_status`、`start_local_service`、`stop_local_service`；desktop shell 增加 Stop Service；退出托盘菜单会尝试停止本地服务。
- 已更新桌面壳测试：静态/交互测试覆盖 start/stop/status Tauri command；runtime test 覆盖 Tauri WebView、快捷键、本地服务启动和停止。
- 已新增 V4 证据脚本：`scripts/check-v4-sidecar-service.ps1`、`scripts/write-v4-release-manifest.js`、`scripts/critic-v4.ps1`。
- 已验证：`npm test` in `apps/desktop-shell` PASS；`cargo check` in `apps/desktop-shell/src-tauri` PASS；`scripts/check-v4-sidecar-service.ps1` PASS，生成 `research/v4-sidecar-service.latest.json`。
- 已补 V4 本地数据闭环：local-service/store 新增 `schemaVersion` metadata、prompt body hash 去重、prompt/skill 搜索、`/data/backup`、`/data/restore`、`/metrics`，指标不保存 prompt 正文。
- 已验证：`npm test` in `apps/local-service` PASS；`research/v4-release-manifest.latest.json` 现在 `LOCAL_DATA_PASS: PASS`。
- 已生成 `research/v4-release-manifest.latest.json`：当前 `releaseReady:false`；`SIDECAR_SERVICE_PASS: PASS`、`FIRST_RUN_PASS: PASS`、`KEYCHAIN_PASS: PASS`、`PROMPT_CARD_UX_PASS: PASS`、`LOCAL_DATA_PASS: PASS`，其余门仍未全部满足。
- 已记录 OMX professor-critic verdict `fail`，证据为当前 V4 manifest；这是正常的阶段性 fail，不是 blocked。

## V3 release-ready 更新 2026-06-07

- 按用户要求继续调用 multi-agent 执行 V3；Boole 作为只读验收/探查 agent 指出 Replit `/agent4` 比根页更适合作为 formal evidence，且不能放宽断言或使用 fallback。
- 已将 `prototypes/browser-extension/tests/live-site-probe.test.js` 中 Replit formal URL 从 `/ai` 改为 `/agent4`。
- 已验证 Replit 单站底层 formal probe PASS：正式扩展加载、`injectFallback:false`、`injectedProbe:false`、`focus.ok:true`、`visibleInputCount:1`、mascot 可见。
- 已用 `.runtime/v2-live-chrome-profile` 跑通完整 V3 formal：8/8 display；ChatGPT/Claude/Gemini insert 与 no-auto-send 全通过；无 injected probe failures；无 redaction leaks。
- 已更新 `research/v3-release-manifest.latest.json`：`pass:true`、`releaseReady:true`、`LIVE_SITE_FORMAL_PASS: PASS`。
- 已验证：`npm test` in `prototypes/browser-extension` PASS；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v3-security.ps1` PASS。

## V3 live-site formal 更新 2026-06-07

- 本轮按用户要求调用 multi-agent 执行 V3；Pascal 作为专门验收 agent 做只读审查，结论是 `LIVE_SITE_FORMAL_PASS` 不能用 V2 5 站证据和 Claude 单站证据拼成 PASS。
- 已新增/收紧 V3 live-site formal 证据链：`scripts/check-v3-live-sites.ps1`、`scripts/assert-v3-live-formal-evidence.js`、`prototypes/browser-extension/tests/live-site-probe.test.js` 的 `schemaVersion=v3-live-site-formal@1`、`formalExtensionOnly`、`injectFallback:false`、`noAutoSend`、`sites[]`、`summary` 字段。
- `scripts/write-v3-release-manifest.js` 现在优先读取 `research/v3-live-site-formal.latest.json`；没有 V3 formal 报告或断言不通过时，`LIVE_SITE_FORMAL_PASS` 只能是 `PARTIAL`，不能从 legacy V2 evidence 升级为 PASS。
- 已按验收 agent Dirac 的审查修掉过宽 Insert 依据：内容脚本现在通过 `documentElement.dataset.smartPromptInsert*` 发布只含状态/长度/策略的 DOM evidence；assertion 不再接受 `card-close` 作为 after-write 依据，只接受 `content-debug` 或 `dom-evidence`。
- 最新 V3 formal 探针已生成 `research/v3-live-site-formal.latest.json`：正式扩展加载成功、`injectedProbe:false`、无 redaction leaks；8/8 display 通过；ChatGPT/Claude/Gemini 三站 insert 和 no-auto-send 均通过。
- 已验证：`npm test` in `prototypes/browser-extension` PASS；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v3-security.ps1` PASS；release manifest 为 `releaseReady:true`。

## 当前 V3 快照

- 任务目标：按用户 V3 goal 调用多 agent 执行“高频 AI 输入工作流 Beta”，继续推进 P0/P1 验收链路。
- 本轮多 agent 分工：Dewey 只读审查 Tauri 发布安全；Cicero 只读审查站点矩阵/Insert 加固；Sartre 作为专门验收 agent 输出 V3 acceptance matrix。
- 已完成：provider keys 迁出 `settings.json` 到 credential vault；Tauri 配置 CSP、main-window capability 并移除未用 shell plugin；浏览器扩展收敛 8 站 Beta 矩阵；Insert 新增 `ok/verified/strategy/kind/reason` after-write 校验、`composed:true` 事件、失败不关卡片；Prompt Card 展示 skill basis 和 privacy summary；Insert/Save/Copy 记录反馈事件；新增 V3 skill routing 20 fixture 和 release manifest。
- 验证通过：`scripts/critic-v3-security.ps1` PASS；`scripts/critic-v2.ps1 -RequireRuntimeEvidence` PASS；`cargo check` PASS；`scripts/check-v2-tauri-runtime.ps1` PASS。
- 当前 reports：`research/v3-security-privacy.latest.json` PASS；`research/v3-tauri-security.latest.json` PASS；`research/v3-skill-routing.latest.json` PASS，20 fixtures hit rate = 1.0；`research/v3-live-site-formal.latest.json` PASS；`research/v3-release-manifest.latest.json` PASS 且 `releaseReady:true`。
- 当前首要缺口已清空：`LIVE_SITE_FORMAL_PASS` 为 PASS；后续复验需注意 Claude 登录态和 Replit `/agent4` route 稳定性。
- 边界：`docs/prd.md` 是用户已有未确认改动，本轮继续不触碰/不纳入提交范围。

## 当前任务

- 任务目标：实现 V3 P0-1：本地服务鉴权、CORS 收窄、evidence 脱敏和 V3 security critic。
- 成功标准：受保护本地 API 需要 per-install token；恶意 Origin 不能访问；浏览器扩展和桌面壳能 bootstrap token 并带 auth 调用；V2/V3 evidence 文件脱敏；`scripts/critic-v3-security.ps1` 通过；V2 严格 critic 仍通过。
- 范围边界：不处理 Tauri CSP/keychain/sidecar 发布化；不创建 PR；不纳入 `docs/prd.md` 当前未确认改动。

## 已完成

- 读取并使用了 `oh-my-codex:autoresearch-goal` skill。
- 创建了 OMX mission：`prompt-automation-tool`。
- 创建并更新了 `agent_memory/`。
- 建立了研究/PRD/视觉资产文档结构。
- 完成 `docs/research-report.md`。
- 完成 `docs/competitive-analysis.md`。
- 完成 `docs/open-source-skills-analysis.md`。
- 完成 `docs/prd.md`。
- 生成并保存 UI/UX 概念图：`assets/ui-ux/prompt-copilot-uiux-v1.png`。
- 新增可选显式 `gpt-image-2` 复跑提示词：`assets/ui-ux/gpt-image-2-uiux.prompt.txt`。
- 复制用户指定小人原型到项目：`assets/ui-ux/mascot-token-run.png`；后续生成必须保留这个小人，不重新设计。
- 新增显式 `gpt-image-2` 复跑脚本：`scripts/generate-uiux-gpt-image-2.ps1`。
- 已 dry-run 验证复跑参数：endpoint `/v1/images/edits`，input image `assets/ui-ux/mascot-token-run.png`，model `gpt-image-2`，quality `high`，size `2048x1152`，目标输出 `assets/ui-ux/prompt-copilot-uiux-gpt-image-2.png`。
- 按用户要求用内置 `image_gen` 生成一版当前项目 UI/UX 图，并通过本地合成贴入原始小人 PNG：`assets/ui-ux/prompt-copilot-uiux-builtin-exact-mascot-v2.png`。
- 按用户要求补齐小人状态动作资产：`normal`、`resting`、`thinking`、`suggesting`、`success`、`clapping`，并保存为 `assets/ui-ux/mascot-states/*.png` 透明图。
- 按原始目标补齐 Remotion 轻量动画原型：`prototypes/remotion-mascot`，并渲染 `assets/ui-ux/mascot-animations/mascot-state-loop.mp4` 与 `assets/ui-ux/mascot-animations/floating-prompt-assistant.mp4`。
- 补充 `README.md` 与 `assets/ui-ux/README.md`。
- 当前本地 critic 已按更新目标通过：`PASS: autoresearch artifacts meet local critic checks.`
- OMX 已记录 professor-critic `pass` verdict。
- 已创建 git 分支：`codex/prompt-automation-research`。
- 已新增 `prototypes/browser-extension/` MV3 原型：manifest、content script、prompt engine、options 页、popup、demo 页、六态小人资产副本和无依赖测试。
- 已新增 `scripts/critic-browser-extension.ps1` 浏览器 MVP 验收脚本。
- 已创建 V2 OMX mission：`smart-prompt-v2`，并创建 Codex goal。
- 已新增 V2 共享核心：`packages/shared/smart-prompt-core.js` 和 `packages/shared/llm-gateway.js`。
- 已将真实 LLM gateway 从单一 OpenAI-compatible 扩展为 `auto`、`openai-compatible`、`anthropic`、`gemini` provider 路径，并补了 provider readiness、auto-provider selection、request/response test double。
- 已新增 V2 本地服务：`apps/local-service/`，含 settings、skill 文件夹扫描、skill 推荐、LLM gateway、`/generate` API 和测试。
- 已强化浏览器扩展：新增 `site-adapters.js`、`local-service-client.js`，manifest 允许本地服务，content script 优先调用本地服务，服务离线时回退模板。
- 已新增 Tauri 桌面壳 scaffold：`apps/desktop-shell/`，含设置页、skill 管理 UI、服务启动入口、tray/global-shortcut Rust 代码和静态测试。
- 已新增 V2 critic：`scripts/critic-v2.ps1`；默认自动化检查 PASS，`-RequireRuntimeEvidence` 会严格要求真实站点和 Tauri runtime evidence。
- 已新增 Claude 登录态验证辅助脚本：`scripts/check-v2-claude-insert.ps1`，使用持久 Chrome profile、只跑 Claude、并提供登录等待窗口。
- 已增强 Claude 登录态验证辅助脚本：默认写入 `research/v2-claude-insert.latest.json`，避免覆盖 `research/v2-live-site-probe.latest.json` 的 5 站点证据。
- 已将 `apps/local-service/README.md` 补强为本地服务 API contract，并让 V2 critic 检查 settings、skill import/recommend、generate 和隐私 invariant。
- 已新增本地 prompt/skill 库管理：local-service 支持 `GET /prompts`、`POST /prompts`、`DELETE /prompts/:id`、`DELETE /skills/:id`，桌面壳新增 Skill/Prompt Library 删除按钮并连接本地服务。
- 已补强浏览器扩展到本地 prompt 库的桥接：Prompt Card 的 Save 优先调用 local-service `POST /prompts`，服务离线时回退 `chrome.storage.local`。
- 已补强浏览器扩展本地服务离线 fallback 运行时证据：demo 可通过 `serviceUrl` 注入不可达服务地址，runtime demo 验证生成回退模板、Save 回退 `chrome.storage.local`、Insert 仍不提交。
- 已补强本地服务 V2 测试：通过注入 `generateWithLlm` test double，经由 `/generate` 覆盖 `idea`、`continue`、`polish` 三模式且 `allowTemplateFallback: false`。
- 已补强浏览器扩展测试：显式检查 ChatGPT、Claude、Gemini insert strategy，并扩大“不自动发送”静态禁区到 `submit`、`requestSubmit`、form submit path 和 Enter key。
- 已补强默认隐私上下文：浏览器扩展不再把完整 `location.href` 或页面标题传给本地服务，改为 host/origin/tool/inputKind/pathKind；critic 检查不默认上传整页文本。
- 已补强 8 站点适配器：ChatGPT、Claude、Gemini、Perplexity、Lovable、Bolt、v0、Replit 的选择器更具体，扩展适配器与共享核心 `SITE_ADAPTERS` 保持同步，`v0.app` 已进入共享核心。
- 已补强 live-site probe 与适配器一致性：真实站点探针现在按 `site-adapters.js` 的站点 selector 聚焦输入框，并在报告中记录使用的 `inputSelectors`；内容脚本 debug 暴露 `lastAdapterId`。
- 已补强 provider-specific API key 管理：local-service 与桌面壳可分别保存 OpenAI-compatible、Anthropic、Gemini key，`auto` 可选择已保存的 Anthropic/Gemini key。
- 已补强 auto LLM provider：auto 模式现在按实际 provider 使用各自默认 baseUrl/model，且一个 provider 请求失败时可继续尝试下一个已配置 provider。
- 已补强 settings 持久化一致性：local-service 默认数据目录固定为 `apps/local-service/.smart-prompt-data`，真实 LLM 验收脚本会读取同一份桌面壳保存的 provider settings。
- 已补强真实 LLM 验收脚本：`scripts/check-v2-real-llm.ps1` 不再只依赖环境变量预检，支持读取桌面壳保存的 provider keys，并新增 `-Provider`、`-Model`、`-BaseUrl`、`-DataDir`、`-DryRun`。
- 已补强 Claude 登录态验证路径：live-site probe 支持 `-AttachCdp` 附着到已开启远程调试端口的 Chrome，并用新标签复用现有 Claude 登录态跑 Insert 证据。
- 已新增 Claude CDP 登录准备脚本：`scripts/start-v2-claude-cdp.ps1` 可打开持久 Chrome profile 到 Claude，并输出后续 `check-v2-claude-insert.ps1 -AttachCdp` 验证命令；`-DryRun` 已验证。
- 已补强 runtime evidence 严格门：`critic-v2.ps1 -RequireRuntimeEvidence` 现在会读取 Claude Insert 和真实 LLM JSON 报告，避免只靠手写 marker 误判完成。
- 已补强 live-site/Tauri 机器证据门：strict critic 现在会读取 5 站点正式扩展报告和 Tauri runtime JSON 报告。

## 正在进行

- V3 P0-1 已实现并验证：local-service 生成并保存 per-install token，`/auth/bootstrap` 只对可信 origin 暴露；`/settings`、`/generate`、`/prompts`、`/skills/*` 等受保护 API 需要 `Authorization: Bearer <token>` 或 `X-Smart-Prompt-Token`；CORS 不再 wildcard；浏览器扩展和桌面壳都会先 bootstrap token；新增 evidence redaction 模块、V3 security runtime check、V3 critic 和 `research/v3-security-privacy.latest.json`。
- 已对现有 `research/v2-*.latest.json` runtime evidence 做机械脱敏，并确认 V2 strict critic 仍可读取通过。
- 当前仍有用户本地改动 `docs/prd.md` 未提交，本轮继续保留不动。

## 下一步

- V3 下一步建议做 P0-2：Tauri CSP/capability 收窄、provider key 从 JSON 迁移到 OS keychain 或加密存储，并补对应 security critic。

## 验证状态

- 本轮 V3 P0-1 验证通过：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v3-security.ps1` PASS；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v2.ps1 -RequireRuntimeEvidence` PASS。
- 本轮 V3 security report：`research/v3-security-privacy.latest.json` 为 `pass: true`，checks 包含 `healthPublic`、`unauthSettingsBlocked`、`evilOriginBlocked`、`trustedBootstrap`、`protectedBearerAccepted`、`protectedTokenHeaderAccepted`、`corsNoWildcard`、`redactionNoLeaks` 全部为 true。
- 本轮 OMX autoresearch-goal `smart-prompt-v3-p0-1-local-service-auth-narrowed` 已记录 professor-critic `pass` verdict；`complete` reconciliation 因 active Codex goal 是用户直接创建的短 objective、不是 handoff 生成的长 objective 而拒绝 objective mismatch。未伪造快照；Codex goal 已通过 `update_goal(status=complete)` 完成。
- 本轮有一次并行运行 V2 strict critic 和 V3 security critic 超时；原因是两个套件都包含浏览器 runtime/local-service 测试并争用本地端口。分开运行后两者均 PASS，不作为产品失败。
- 本轮新版 Agnes 报告已通过：`research/v2-real-llm.latest.json` 为 `pass: true`，`dryRun: false`，provider/model 为 `agnes`/`agnes-2.0-flash`，`idea`、`continue`、`polish` 三项均 `ok: true`、`generatedBy: "llm"`、`mode` 与样本名一致，promptLength 分别大于 40。
- 本轮校验用户 Agnes 报告时发现：用户运行的旧报告 `pass: true` 且三项均 `generatedBy: "llm"`，但 `polish` 样本返回的 `mode` 为 `continue`，不足以证明严格三模式。已补严 `check-v2-real-llm.ps1` 和 `critic-v2.ps1`，默认 `scripts/critic-v2.ps1` PASS；当前 Codex 进程没有 `AGNES_API_KEY`，无法代跑新版真实报告，需用户在有 key 的 PowerShell 中重新运行。
- 本轮新增 Agnes provider：共享 LLM gateway 支持 `agnes`、`AGNES_API_KEY`、默认 `https://apihub.agnes-ai.com/v1` 和 `agnes-2.0-flash`；桌面壳暴露 Agnes Key；local-service/desktop-shell 测试和默认 `scripts/critic-v2.ps1` PASS；`scripts/check-v2-real-llm.ps1 -DryRun -Provider agnes` PASS；新版真实 Agnes 三模式报告已通过。
- 本轮绝对路径复跑：`powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\lhy10\Documents\Smart Prompt\scripts\check-v2-real-llm.ps1" -DryRun` 证明脚本路径可达，但仍只发现 `OPENAI_API_KEY`；真实运行同一绝对路径脚本仍在 `idea` 模式收到 OpenAI HTTP 429 quota/billing。该条件已多轮重复，当前无法在没有可用 API key/billing 或 Anthropic/Gemini 替代 key 的情况下继续证明 `REAL_LLM_3_MODES_PASS`。
- 本轮复跑：`scripts/check-v2-real-llm.ps1 -DryRun` 只发现 `OPENAI_API_KEY`，未发现 Anthropic/Gemini 环境变量或桌面壳保存的 provider key；真实运行 `scripts/check-v2-real-llm.ps1` 仍在 `idea` 模式收到 OpenAI HTTP 429 quota/billing；`scripts/critic-v2.ps1 -RequireRuntimeEvidence` 当前只失败在缺少 `REAL_LLM_3_MODES_PASS` 和三模式真实 LLM 机器证据。
- 本轮新增并验证桌面壳交互测试：`apps/desktop-shell/tests/desktop-shell-interaction.test.js` 通过 fake DOM/fetch/Tauri 执行真实 `src/app.js`，覆盖 provider/API key 保存、skill 导入/删除、prompt 保存/删除、本地服务启动和全局快捷键事件；`npm test` in `apps/desktop-shell` PASS，`scripts/critic-v2.ps1` 默认 PASS。
- 严格 runtime evidence critic 仍未通过：`INSERT_CLAUDE_PASS` 已补齐，当前缺口只剩 `REAL_LLM_3_MODES_PASS`；真实 LLM 报告仍是 OpenAI quota/billing 429。

- 已验证：`scripts/start-v2-claude-cdp.ps1` 语法解析和 `-DryRun` PASS；`scripts/check-v2-real-llm.ps1` 语法解析、默认 `-DryRun`、`-Provider gemini -DryRun` PASS，真实复跑写入新版 `research/v2-real-llm.latest.json` 且仍返回 OpenAI 429；`scripts/critic-v2.ps1` 默认自动化检查 PASS；local-service、browser-extension、desktop-shell 静态测试 PASS；local-service 测试已覆盖 `DELETE /skills/:id`、`DELETE /prompts/:id` 和 CORS `DELETE`；desktop-shell 静态测试已覆盖 skill/prompt 删除 UI；Node 语法检查 PASS；本地服务可启动并响应 `/health`、`/generate` fallback 和 `/prompts` 保存；Chrome headless demo 能显示小人和 prompt card，已确认在线 Save 写入本地 prompt 库、离线 Save 回退 `chrome.storage.local`，且 Insert 只写入不提交；8 站点适配器与共享核心同步测试 PASS；live-site probe 已静态验证使用适配器 selector；Rust/Cargo 已安装，Tauri `cargo check` PASS；`scripts/check-v2-tauri-runtime.ps1` 已验证 Tauri app 启动、Tauri command、从 Tauri 启动本地服务、全局快捷键触发计数；`scripts/check-v2-live-sites.ps1` 已通过 CDP `Extensions.loadUnpacked` 证明 ChatGPT/Gemini/Bolt/v0.app/Lovable 5 站点正式扩展显示，且 ChatGPT/Gemini Insert 成功。
- 未验证：无当前 V2 完成门阻塞项；Perplexity/Replit 等额外站点仍受 challenge/login/region 限制，不影响当前 5 站点正式扩展验收。
- 验证命令或方式：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-v2-claude-cdp.ps1 -DryRun` PASS；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-v2-real-llm.ps1 -DryRun -Report .runtime\v2-real-llm-dryrun.json` PASS；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-v2-real-llm.ps1 -DryRun -Provider gemini -Report .runtime\v2-real-llm-gemini-dryrun.json` PASS；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-v2-real-llm.ps1` 返回 OpenAI 429 并写入新版失败报告；`npm test` 已在 `prototypes/browser-extension` PASS；`npm test` 已在 `apps/local-service` PASS；`npm test` 已在 `apps/desktop-shell` PASS；`node -c apps\local-service\src\server.js`、`node -c apps\local-service\src\store.js`、`node -c apps\desktop-shell\src\app.js` PASS；`node -c packages\shared\smart-prompt-core.js`、`node -c prototypes\browser-extension\src\site-adapters.js`、`node -c prototypes\browser-extension\src\content.js`、`node -c prototypes\browser-extension\tests\site-adapters.test.js`、`node -c prototypes\browser-extension\tests\live-site-probe.test.js` PASS；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v2.ps1` PASS；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v2.ps1 -RequireRuntimeEvidence` 当前只失败在缺少 `REAL_LLM_3_MODES_PASS` 且 `research/v2-real-llm.latest.json` 非 pass；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-v2-tauri-runtime.ps1` 已 PASS；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-v2-claude-insert.ps1 -AttachCdp -CdpPort 9232 -LoginWaitSeconds 30` 已 PASS。

## 最近变化

- 用户重新要求用该小人原型生成 UI/UX 图后，复查确认 User 级环境变量已有 `OPENAI_API_KEY`。使用 `uv run --with openai` 临时环境调用 `gpt-image-2` edit，API 返回 `Billing hard limit has been reached`，输出文件 `assets/ui-ux/prompt-copilot-uiux-gpt-image-2.png` 仍不存在。
- 随后用户要求先用内置 `image_gen` 生成一版；已生成不含小人的 UI 底图，并把原始 `mascot-token-run.png` 贴入界面，最终图为 `assets/ui-ux/prompt-copilot-uiux-builtin-exact-mascot-v2.png`。
- 用户追问缺少 thinking/suggesting/success 状态后，已生成三态板与单独透明 PNG；随后补齐 normal、resting、clapping，生成六态总览板 `assets/ui-ux/mascot-states/assistant-states-six-board-builtin-v2.png`。
- Goal 续跑审计发现 Remotion 动画未形成项目资产；已新增 Remotion 原型并渲染两个轻量 MP4。
- OMX autoresearch-goal verdict 已更新为 blocked，证据改为当前准确的 OpenAI API billing hard limit；当前不调用 Codex `update_goal(blocked)`，因为这是 resumed run 的首次 blocked audit。
- 用户更新目标，明确“不需要严格 gpt-image-2”；已移除显式 API 输出图作为 critic 门槛，critic 和 OMX verdict 均已 PASS。
- 用户新目标为“根据这个 prd.md 文档开始实现第一版”；当前已按 PRD M1 开始实现浏览器扩展 MVP。
- 用户新目标为 V2；当前已实现主要代码路径，但未达到完整 runtime 验收。
- V2 续跑新增 Chrome headless runtime demo 测试，覆盖本地服务桥接、卡片刷新、Insert 不提交；已安装 Rustup 并让 Tauri `cargo check` 进入默认 critic。
- V2 继续补强 Tauri：开启 `withGlobalTauri`，修复带空格路径下的本地服务启动，新增 runtime smoke，验证真实 app 启动、Tauri command、本地服务启动和全局快捷键触发。
- V2 继续补强真实站点探针：改用 browser-level CDP `Extensions.loadUnpacked` 正式加载扩展，补 `v0.app` 域名，扩展输入扫描支持 open shadow DOM。当前正式扩展证据达到 ChatGPT/Gemini/Bolt/v0.app/Lovable 5 个显示和 ChatGPT/Gemini Insert；Claude 仍因登录页未过。
- V2 继续补强 Claude 验证路径：`check-v2-live-sites.ps1` 现支持 `-Report`、`-ProfileDir`、`-SiteIds`、`-LoginWaitSeconds`，可用持久 profile 复用 Claude 登录态后跑正式扩展 Insert 验收，并可独立保存 Claude 报告。
- V2 继续补强本地 rubric 证据：local-service API 现在有三模式 LLM gateway test double 覆盖；browser-extension 测试显式覆盖 ChatGPT/Claude/Gemini insert strategy 与更严禁自动发送检查。
- V2 继续补强本地 prompt/skill 库：本轮增加 prompt library API、桌面壳 Prompt Library UI、local-service/desktop-shell 测试和 critic 检查。
- V2 继续补强本地 prompt/skill 库：本轮新增 `DELETE /skills/:id`、桌面壳 skill/prompt 删除按钮，并补 CORS `DELETE` 方法，local-service/desktop-shell 测试和 critic 均已覆盖。
- V2 继续补强真实 LLM 可用性：本轮新增 `GET /llm/providers` readiness、`auto` provider、桌面壳 provider 状态显示与自动默认值；当前 User 环境只发现 `OPENAI_API_KEY`，auto 仍落到 OpenAI-compatible，复核仍为 429。
- V2 继续补强真实 LLM 可用性：本轮新增 provider-specific saved keys，避免桌面壳只能保存单个 OpenAI-compatible key；仍需可用 billing/key 才能证明三模式真实 LLM。
- V2 继续补强真实 LLM 可用性：本轮修正 auto provider 的模型/端点选择，并增加 provider 失败转移测试；当前环境仍只有 OpenAI key 且 429。
- V2 继续补强真实 LLM 可用性：本轮统一 local-service/Tauri/验收脚本的默认 settings 数据目录；用户通过桌面壳保存的 provider keys 可被 `check-v2-real-llm.ps1` 复用。
- V2 继续补强真实 LLM 验收路径：本轮让 `check-v2-real-llm.ps1` 支持 `-Provider`、`-Model`、`-BaseUrl`、`-DataDir`、`-DryRun`，移除“未读桌面 settings 前先要求环境变量 key”的硬拦截，并让报告输出 providerStatus/configuredProviders/settingsSummary。
- V2 继续补强隐私边界：本轮移除扩展默认 context 中的完整 URL 和页面标题，并用测试/critic 固化不读取整页文本。
- V2 继续补强站点适配：本轮将扩展适配器和共享核心的 8 站点 `SITE_ADAPTERS` 对齐，加入更具体的 Perplexity/Lovable/Bolt/v0/Replit 输入框 selector，并让 critic 检查这些 selector token。
- V2 继续补强真实站点探针：本轮让 `live-site-probe.test.js` 从 `site-adapters.js` 读取每个站点的 selector，再追加泛 selector 兜底；报告会记录 `inputSelectors`，内容脚本 debug 会记录 `lastAdapterId`。
- V2 继续补强测试稳定性：本轮放宽 `runtime-demo.test.js` 在 Windows 上清理临时 Chrome profile 的等待与重试，避免 EPERM 锁文件导致默认 critic 偶发失败。
- V2 继续补强验收报告保全：Claude 单站点验证默认写入独立 `research/v2-claude-insert.latest.json`，不覆盖已有 5 站点 live probe 报告。
- V2 继续补强 Claude runtime 验证：本轮新增 CDP attach 模式，可复用已登录 Chrome 会话而不杀掉用户浏览器，只关闭探针新标签。
- V2 继续补强 Claude runtime 验证：本轮新增 `scripts/start-v2-claude-cdp.ps1`，一键打开持久 Chrome profile 到 Claude 并打印 attach 验证命令；`-DryRun` 已确认本机 Chrome 路径和 profile 路径。
- V2 继续补强完成门：本轮新增 `research/v2-real-llm.latest.json` 输出和 strict critic 报告解析；当前严格门会同时卡住 Claude 报告与真实 LLM 429 报告。
- V2 继续补强完成门：本轮让 `research/v2-live-site-probe.latest.json` 和 `research/v2-tauri-runtime.latest.json` 成为 strict critic 的机器证据来源。
- 本轮 OMX `smart-prompt-v2` verdict 继续记为 `fail`：本地 prompt/skill 库删除管理已补强，默认 V2 critic PASS；严格 runtime critic 现在要求 Claude Insert JSON 报告与真实 LLM 三模式 JSON 报告，当前仍缺 Claude 通过证据且真实 LLM 复核为 OpenAI 429 quota/billing。
- 本轮 V2 继续补强浏览器扩展与本地 prompt 库桥接：扩展 Save 现在优先 `POST /prompts`，离线回退本地收藏；runtime demo 和 critic 已覆盖该路径，默认 V2 critic PASS；严格 runtime critic 仍只失败在 Claude Insert 报告与真实 LLM 三模式机器证据。
- 本轮 V2 继续补强浏览器扩展 local-service fallback：runtime demo 新增不可达 serviceUrl 场景，验证服务离线时仍能模板生成、保存到 `smartPromptFavorites`，且 Insert 不提交；默认 V2 critic PASS，严格 runtime critic 仍只失败在 Claude Insert 报告与真实 LLM 三模式机器证据。
