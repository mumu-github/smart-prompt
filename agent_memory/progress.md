# 当前进度

## 当前任务

- 任务目标：实现 V2：真实 LLM 生成、强化站点适配、本地 prompt/skill 库、Tauri 桌面壳、本地服务桥接，并保持只填入不自动发送。
- 成功标准：至少 5 个网页 AI 输入框稳定出现小人；三模式调用真实 LLM；ChatGPT/Claude/Gemini Insert 成功；可导入 skill 文件夹并推荐 1-3 个 skill；桌面壳可启动、配置 API key、管理 skill、触发全局快捷键；不自动发送、不默认上传整页。
- 范围边界：当前先实现可自动验证的代码路径；真实站点与 Tauri runtime 需要后续手测/环境验证后才能完成 goal。

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
- 已新增本地 prompt 库管理：local-service 支持 `GET /prompts`、`POST /prompts`、`DELETE /prompts/:id`，桌面壳新增 Prompt Library 区块并连接 `/prompts`。
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

- 正在推进 V2 runtime 验收；当前自动化代码路径、本地服务桥接 demo、Tauri 运行态启动、Tauri 启动本地服务、全局快捷键触发、5 个真实站点正式扩展显示、ChatGPT/Gemini Insert 已通过，Claude CDP 登录准备脚本与真实 LLM DryRun/参数化验收脚本已补齐，但 Claude Insert 报告和真实 LLM quota 尚未验证。

## 下一步

- 运行 `scripts/start-v2-claude-cdp.ps1`，在打开的 Claude 窗口登录并保持开启，然后运行打印出的 `check-v2-claude-insert.ps1 -AttachCdp` 命令补充 `INSERT_CLAUDE_PASS` 证据。
- 使用 `scripts/check-v2-real-llm.ps1 -DryRun` 预检 provider settings；提供可用 LLM billing/key 后复跑三模式真实 LLM 验收。

## 验证状态

- 已验证：`scripts/start-v2-claude-cdp.ps1` 语法解析和 `-DryRun` PASS；`scripts/check-v2-real-llm.ps1` 语法解析、默认 `-DryRun`、`-Provider gemini -DryRun` PASS，真实复跑写入新版 `research/v2-real-llm.latest.json` 且仍返回 OpenAI 429；`scripts/critic-v2.ps1` 默认自动化检查 PASS；local-service、browser-extension、desktop-shell 静态测试 PASS；Node 语法检查 PASS；本地服务可启动并响应 `/health` 和 `/generate` fallback；Chrome headless demo 能显示小人和 prompt card，并确认 Insert 只写入不提交；8 站点适配器与共享核心同步测试 PASS；live-site probe 已静态验证使用适配器 selector；Rust/Cargo 已安装，Tauri `cargo check` PASS；`scripts/check-v2-tauri-runtime.ps1` 已验证 Tauri app 启动、Tauri command、从 Tauri 启动本地服务、全局快捷键触发计数；`scripts/check-v2-live-sites.ps1` 已通过 CDP `Extensions.loadUnpacked` 证明 ChatGPT/Gemini/Bolt/v0.app/Lovable 5 站点正式扩展显示，且 ChatGPT/Gemini Insert 成功。
- 未验证：Claude Insert 生产站点成功；真实 LLM 三模式因当前 OpenAI quota/billing 429 未证明。
- 验证命令或方式：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-v2-claude-cdp.ps1 -DryRun` PASS；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-v2-real-llm.ps1 -DryRun -Report .runtime\v2-real-llm-dryrun.json` PASS；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-v2-real-llm.ps1 -DryRun -Provider gemini -Report .runtime\v2-real-llm-gemini-dryrun.json` PASS；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-v2-real-llm.ps1` 返回 OpenAI 429 并写入新版失败报告；`npm test` 已在 `prototypes/browser-extension` PASS；`npm test` 已在 `apps/local-service` PASS；`node -c packages\shared\smart-prompt-core.js`、`node -c prototypes\browser-extension\src\site-adapters.js`、`node -c prototypes\browser-extension\src\content.js`、`node -c prototypes\browser-extension\tests\site-adapters.test.js`、`node -c prototypes\browser-extension\tests\live-site-probe.test.js` PASS；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v2.ps1` PASS；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v2.ps1 -RequireRuntimeEvidence` 失败在缺少 `REAL_LLM_3_MODES_PASS`、`INSERT_CLAUDE_PASS`、`research/v2-claude-insert.latest.json`，以及当前 `research/v2-real-llm.latest.json` 非 pass；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-v2-tauri-runtime.ps1` 已 PASS。

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
- 本轮 OMX `smart-prompt-v2` verdict 继续记为 `fail`：真实 LLM 验收脚本已支持桌面 settings、参数化和 DryRun，默认 V2 critic PASS；严格 runtime critic 现在要求 Claude Insert JSON 报告与真实 LLM 三模式 JSON 报告，当前仍缺 Claude 通过证据且真实 LLM 复核为 OpenAI 429 quota/billing。
