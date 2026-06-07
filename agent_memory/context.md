# 项目上下文

## 当前 M3 上下文 2026-06-07

- 当前 active goal 仍是 M3：一方面收集新 beta adapter 的真实内测 Insert 数据，另一方面推进 Windows UIA 桌面输入框识别，覆盖 Codex、Claude Code、Hermes 等桌面/CLI 工具；macOS AX 不作为当前阶段验收门槛。
- Windows 路径已从“只识别快照”推进到“self-test 写回”和真实前台窗口 snapshot-only 审计：`GET /desktop/input-snapshot` 与 `POST /desktop/fill` 在 local-service、native sidecar、安装包 bundled sidecar 中都有机器证据；真实 Codex 前台窗口已能被 UIA 识别并枚举候选。
- 关键证据入口：`research/m3-desktop-input.latest.json`、`research/m3-real-desktop-tools.latest.json`、`research/m3-desktop-fill.latest.json`、`research/m3-sidecar-desktop-input.latest.json`、`research/m3-sidecar-desktop-fill.latest.json`、`research/m3-installed-sidecar-desktop-input.latest.json`、`research/m3-pilot-adapters.latest.json`。
- `docs/prd.md` 当前是 v0.2 beta PRD：V5 发布包和 release-ready manifest 已完成；M3 为进行中。PRD 不能写成“真实桌面工具已完成”，因为 Codex/Claude Code/Hermes 真实窗口写回尚未验收；macOS AX 已移出当前 M3 门槛。
- 当前写回 self-test 主要证明链路、auth、打包、隐私脱敏和 no-auto-submit；它不等同于在真实工具窗口里填入成功。

## M3 Pilot 与桌面输入识别上下文 2026-06-07

- 当前 active goal 是 M3：一方面跑真实内测数据观察 workBuddy、Trae、Doubao、DeepSeek 新 adapter 的 Insert 成功率和失败原因；另一方面进入 Windows UIA 桌面输入框识别，覆盖 Codex、Claude Code、Hermes；macOS AX 先不做。
- 已创建 OMX mission：`smart-prompt-m3-pilot-metrics-and-desktop-input-`；critic 命令为 `scripts\critic-m3.ps1`。
- M3 pilot 证据入口：`research/m3-pilot-adapters.latest.json`。当前四个 beta 站点均有真实 headless Chrome 探针数据，正式扩展加载成功，但 visible input 为 0，Insert 成功率为 0；失败原因已细化为 `no_input_candidates_on_loaded_page: 3` 与 `public_or_marketing_page_no_visible_composer: 1`，并带 `pageClassification`/`routeDiagnostics`。
- M3 Windows UIA 证据入口：`research/m3-desktop-input.latest.json` 与 `research/m3-real-desktop-tools.latest.json`。当前 self-test 通过，Windows UIA 能枚举临时 TextBox 候选，并匹配 Codex 工具画像；真实前台 Codex snapshot-only 审计也已通过，候选数 116，默认 `writeAttempted:false`；报告不保存 raw title、raw element name 或 input value。
- 新增 local-service 开发接口与 native sidecar source/dev 接口：`GET /desktop/input-snapshot`，受 auth 保护；native sidecar 通过 Windows PowerShell UIA bridge 返回同一契约。
- M3 native sidecar 证据入口：`research/m3-sidecar-desktop-input.latest.json`。当前 sidecar smoke 通过，证明 native sidecar health/auth 后可调用 `desktop/input-snapshot?selfTest=1` 并返回 1 个 UIA 输入候选。
- M3 安装包 sidecar 证据入口：`research/m3-installed-sidecar-desktop-input.latest.json`。当前安装包 smoke 通过，证明桌面壳安装包会打入 `resources/smart-prompt-sidecar/bin/local-service-sidecar.exe` 与 `resources/smart-prompt-sidecar/scripts/check-m3-desktop-input.ps1`，安装后的 app 能启动 bundled sidecar 并调用 `desktop/input-snapshot?selfTest=1`。
- macOS AX 已按用户要求暂缓到后续跨平台阶段；不要把它作为当前 M3 goal 的完成条件。

## V5 Beta 发布上下文 2026-06-07

- V5 当前已进入 beta 发布闭环：本地 native sidecar、诊断导出、删除全部本地数据、key 迁移状态、崩溃重启/端口恢复、release notes、checksum、pilot-loop 证据均已落地。
- `v0.2.0-beta.1` 已作为 Git tag 推送到 GitHub private repo，且 GitHub Release 页面已创建并上传 MSI、NSIS exe、checksum assets。
- 当前 beta release 证据入口是 `research/v5-beta-manifest.latest.json`，该 manifest 为 `pass:true`、`releaseReady:true`。
- `docs/prd.md` 已更新为 v0.2 beta PRD，并明确纳入 workBuddy、Trae、Doubao、DeepSeek、Hermes；这是当前 V5 PRD 收尾目标的一部分，可以随本轮提交。
- 浏览器扩展和 shared core 已新增 workBuddy、Trae、Doubao、DeepSeek beta adapter；Codex、Claude Code、Hermes 当前只作为工具画像，真实桌面输入框识别仍属于 M3。
- 当前 metrics 闭环已覆盖 `card_ready`、`insert`、`save`、`retry`、`undo`，并在 local-service/native sidecar 汇总 Insert 成功率、保存率、Undo/Retry 使用率和失败原因。

## V4 可安装内测版完成上下文 2026-06-07

- V4 当前 release manifest 已为 `pass:true`、`releaseReady:true`；证据入口是 `research/v4-release-manifest.latest.json`，所有验收门 `INSTALLER_PASS`、`SIDECAR_SERVICE_PASS`、`FIRST_RUN_PASS`、`KEYCHAIN_PASS`、`LIVE_SITE_STABILITY_PASS`、`PROMPT_CARD_UX_PASS`、`LOCAL_DATA_PASS`、`V4_RELEASE_MANIFEST_PASS` 均为 PASS。
- 安装包链路已收紧：`apps/desktop-shell/scripts/prepare-sidecar.js` 会把 local-service、`packages/shared` 和当前 Node runtime 打进 `src-tauri/resources/smart-prompt-sidecar/`；Tauri 配置通过 `bundle.resources` 打包该目录。
- Tauri `start_local_service` 现在优先从包内 `resources/smart-prompt-sidecar` 启动 `apps/local-service/src/server.js`，优先使用包内 `bin/node.exe`，并把 `SMART_PROMPT_DATA_DIR` 固定到 app local data dir 或显式环境变量。
- 安装后 smoke 已从“能打开窗口”升级为 runtime 验收：`scripts/check-v4-installer-smoke.ps1` 调用 `scripts/check-v4-installed-app-runtime.js`，证明安装后的 app 能用包内 sidecar 启动/停止 local-service，并通过 `/health`。

## V4 首启向导更新 2026-06-07

- `FIRST_RUN_PASS` 已从 PARTIAL 提升为 PASS：local-service 新增受保护的 `POST /llm/test`，桌面壳新增 `first-run-panel`、provider test、首启进度与隐私边界展示，交互测试覆盖保存 key、测试 provider、导入 skill 与 ready 状态。
- 当前 V4 manifest 仍非 release-ready：`SIDECAR_SERVICE_PASS`、`FIRST_RUN_PASS`、`KEYCHAIN_PASS`、`PROMPT_CARD_UX_PASS`、`LOCAL_DATA_PASS` 为 PASS；`INSTALLER_PASS` 为 FAIL；`LIVE_SITE_STABILITY_PASS`、`V4_RELEASE_MANIFEST_PASS` 为 PARTIAL。
- 最新 OMX verdict 仍为阶段性 `fail`，证据为 `research/v4-release-manifest.latest.json`；这是因为 V4 还有安装包和 8 站连续稳定性未完成，不是当前首启或 Prompt Card 改动失败。

## V4 Prompt Card UX 更新 2026-06-07

- `PROMPT_CARD_UX_PASS` 已从 PARTIAL 提升为 PASS：浏览器扩展 Prompt Card 现在支持手动 `idea/continue/polish` 模式选择、生成状态、Retry、LLM/template source badge、Insert 成功/失败状态、Undo toast 和反馈记录。
- `prototypes/browser-extension/tests/runtime-demo.test.js` 已用真实 headless Chrome 覆盖模式切换、Retry、Insert、不自动发送、Undo 恢复原输入、Save 在线/离线路径；`scripts/critic-v4.ps1` 现在会跑 local-service、desktop-shell 和 browser-extension 三套测试后再写 V4 manifest。
- 当前 V4 manifest 仍非 release-ready：`SIDECAR_SERVICE_PASS`、`FIRST_RUN_PASS`、`KEYCHAIN_PASS`、`PROMPT_CARD_UX_PASS`、`LOCAL_DATA_PASS` 为 PASS；`INSTALLER_PASS` 为 FAIL；`LIVE_SITE_STABILITY_PASS`、`V4_RELEASE_MANIFEST_PASS` 为 PARTIAL。

## V4 可安装内测版上下文 2026-06-07

- V4 目标：把 V3 验收通过原型变成可安装、可配置、稳定运行、可诊断的 Beta 包；验收门包括 INSTALLER、SIDECAR_SERVICE、FIRST_RUN、KEYCHAIN、LIVE_SITE_STABILITY、PROMPT_CARD_UX、LOCAL_DATA、V4_RELEASE_MANIFEST。
- 已创建 OMX autoresearch-goal mission：`smart-prompt-v4-installable-beta-turn-v3-validat`；critic 命令为 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v4.ps1`。
- V4 当前证据入口：`scripts/check-v4-sidecar-service.ps1` 生成 `research/v4-sidecar-service.latest.json`；`scripts/write-v4-release-manifest.js` 生成 `research/v4-release-manifest.latest.json`；`scripts/critic-v4.ps1` 汇总 professor-critic 状态。
- 当前 V4 manifest 不是 release-ready：`SIDECAR_SERVICE_PASS`、`FIRST_RUN_PASS`、`KEYCHAIN_PASS`、`PROMPT_CARD_UX_PASS`、`LOCAL_DATA_PASS` 已 PASS；`INSTALLER_PASS` 为 FAIL；`LIVE_SITE_STABILITY_PASS`、`V4_RELEASE_MANIFEST_PASS` 为 PARTIAL。

## V3 release-ready 上下文 2026-06-07

- V3 正式 live-site 证据已经通过：`research/v3-live-site-formal.latest.json` 为 `pass: true`，8/8 display 覆盖 ChatGPT、Claude、Gemini、Perplexity、Bolt、v0、Lovable、Replit；ChatGPT/Claude/Gemini 的 Insert 与 no-auto-send 均通过。
- Replit formal 入口改为 `https://replit.com/agent4`，因为 `/ai` 无可见 AI composer，根页虽可见 textarea 但更像营销入口；`/agent4` 单站预检和完整 8 站 formal 均证明正式扩展加载、`injectedProbe:false`、可见 textarea focus 成功、小人可见。
- 完整 8 站 formal 需要复用 `.runtime/v2-live-chrome-profile` 持久 profile 才能保留 Claude 登录态；fresh profile 会导致 Claude display/insert/no-auto-send 缺失。
- `research/v3-release-manifest.latest.json` 当前 `pass: true` 且 `releaseReady: true`；`scripts/critic-v3-security.ps1` 已通过。

## V3 live-site formal 上下文 2026-06-07

- V3 live-site formal 已拆成独立证据入口：`scripts/check-v3-live-sites.ps1` 强制 `SMART_PROMPT_LIVE_INJECT_FALLBACK=0` 和 `SMART_PROMPT_LIVE_SCHEMA_VERSION=v3-live-site-formal@1`，默认覆盖 ChatGPT、Claude、Gemini、Perplexity、Lovable、Bolt、v0、Replit。
- `research/v3-live-site-formal.latest.json` 是 V3 正式站点验收报告；只保存 redacted URL/path/title/text/profile 摘要、长度、布尔状态和 hash，不保存完整 URL、页面标题、prompt 正文、输入框正文或 profile 路径。
- `scripts/assert-v3-live-formal-evidence.js` 是严格验收断言：8 站 display、3 站 insert、3 站 no-auto-send、正式扩展加载、`injectedProbe:false`、redaction leak 为 0 才 PASS。
- `scripts/write-v3-release-manifest.js` 现在只会在 V3 formal evidence 满足严格断言等价条件时把 `LIVE_SITE_FORMAL_PASS` 置为 PASS；legacy V2 evidence 只能作为 partial/历史参考。
- live-site Insert 证据通过内容脚本写入 `documentElement.dataset.smartPromptInsert*` 暴露给页面主世界，只保存 `ok/verified/kind/strategy/reason/valueLength/createdAt`，不保存正文；这是为了解决 Chrome isolated world 下 CDP 读不到 `__smartPromptDebug` 的问题。
- 最新正式 V3 formal 报告已证明 8 站 display，以及 ChatGPT、Claude、Gemini 的 Insert + no-auto-send；Replit 通过 `/agent4` 验收。

## 当前 V3 上下文

- 当前阶段：V3 高频 AI 输入工作流 Beta。
- 核心链路：聚焦输入框 -> 小人出现 -> 判断 idea/continue/polish -> 调真实 LLM -> 推荐 skill -> 展示依据和隐私摘要 -> Insert 填入但不发送 -> 记录反馈和采用情况。
- 技术栈：Chrome/Edge MV3、Node 本地服务、共享 JS core、LLM gateway、Tauri desktop shell scaffold；V3 已新增本地鉴权、证据脱敏、credential vault、Tauri CSP/capability、skill routing fixture 和 release manifest。
- 当前验收汇总以 `research/v3-release-manifest.latest.json` 为准；它会汇总 evidence hash、commit、acceptance 状态和风险。
- 当前 8 站 Beta 矩阵：ChatGPT、Claude、Gemini、Perplexity、Lovable、Bolt、v0、Replit。Doubao/DeepSeek 不在 V3 Beta allowlist。

## 项目目标

- 当前项目要解决的问题：为 Windows 和 macOS 通用的“提示词自动化生成小工具”做深度调研、竞品/开源实现分析、可行性方案、PRD 和 UI/UX 概念图。
- 主要用户或使用场景：vibe coding 工具用户、网页 LLM/Agent 对话用户；用户可能不会写提示词、缺少提示习惯、缺少可复用 skills 或经常忘记调用已有 skills。
- 不应偏离的边界：当前进入 V2；要实现真实 LLM、本地服务、浏览器强化和 Tauri 桌面壳，但仍不自动发送消息、不默认上传整页内容。

## 系统概览

- 技术栈：V1 为 Chrome/Edge MV3；V2 新增 Node 本地服务、共享 JS core、OpenAI-compatible LLM gateway 和 Tauri desktop shell scaffold。
- 关键入口：扩展 `prototypes/browser-extension/manifest.json`；本地服务 `apps/local-service/src/server.js`；桌面壳 `apps/desktop-shell/index.html` 与 `apps/desktop-shell/src-tauri/src/main.rs`。
- 关键模块：环境识别、站点适配器、三种提示词模式、悬浮小人入口、本地服务 LLM 生成、prompt/skill 库、刷新/编辑/复制/收藏/填入、Tauri 托盘和全局快捷键。
- 外部依赖或服务：可能包括 OpenAI 图像生成 API、LLM API、Remotion 或类似动画渲染方案、浏览器/桌面自动化能力。

## 重要约定

- 代码风格：暂无代码；后续遵循所选框架约定。
- 数据或接口约定：待 PRD 明确。
- UI/交互约定：悬浮在输入框附近的小人形象是核心入口；用户已指定 `assets/ui-ux/mascot-token-run.png` 为小人原型，后续不得重新设计角色；需要适配 vibe coding 工具与常见网页 LLM 输入框。
- 测试与验证约定：研究结论必须带来源；产品方案需能映射到用户痛点和竞品差异。

## 决策记录

- 尚在生效的关键决策：使用 `oh-my-codex:autoresearch-goal` 工作流推进；V2 mission slug 为 `smart-prompt-v2`。
- 已确认的用户偏好：默认中文沟通；信息按需提供；最小改动；先读再改；非简单任务维护 `agent_memory/`。
- 需要避免重复讨论的结论：仓库已在 `codex/prompt-automation-research` 分支提交研究/PRD/视觉资产；当前新增 `prototypes/browser-extension/` 作为第一版应用原型。

## 待澄清

- 小人原型图片已提供并复制到项目：`assets/ui-ux/mascot-token-run.png`。
- “skillhub/clawhub” 的具体站点范围可能存在歧义，需要通过网络搜索确认可检索来源。
