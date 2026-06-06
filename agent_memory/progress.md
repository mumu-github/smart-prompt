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
- 已新增 V2 本地服务：`apps/local-service/`，含 settings、skill 文件夹扫描、skill 推荐、LLM gateway、`/generate` API 和测试。
- 已强化浏览器扩展：新增 `site-adapters.js`、`local-service-client.js`，manifest 允许本地服务，content script 优先调用本地服务，服务离线时回退模板。
- 已新增 Tauri 桌面壳 scaffold：`apps/desktop-shell/`，含设置页、skill 管理 UI、服务启动入口、tray/global-shortcut Rust 代码和静态测试。
- 已新增 V2 critic：`scripts/critic-v2.ps1`；默认自动化检查 PASS，`-RequireRuntimeEvidence` 会严格要求真实站点和 Tauri runtime evidence。

## 正在进行

- 正在推进 V2 runtime 验收；当前自动化代码路径、本地服务桥接 demo、Tauri 运行态启动、Tauri 启动本地服务和全局快捷键触发已通过，但真实站点小人显示和真实站点 Insert 尚未验证。

## 下一步

- 在至少 5 个真实网页 AI 输入框手测小人稳定出现。
- 在 ChatGPT、Claude、Gemini 手测 Insert 成功且不自动发送。
- 将通过证据写入 `research/v2-verification.md`，再运行 `scripts/critic-v2.ps1 -RequireRuntimeEvidence`。

## 验证状态

- 已验证：`scripts/critic-v2.ps1` 默认自动化检查 PASS；local-service、browser-extension、desktop-shell 静态测试 PASS；Node 语法检查 PASS；本地服务可启动并响应 `/health` 和 `/generate` fallback；Chrome headless demo 能显示小人和 prompt card，并确认 Insert 只写入不提交；Rust/Cargo 已安装，Tauri `cargo check` PASS；`scripts/check-v2-tauri-runtime.ps1` 已验证 Tauri app 启动、Tauri command、从 Tauri 启动本地服务、全局快捷键触发计数。
- 未验证：真实加载 Chrome/Edge 扩展后在 5 个生产站点逐站点手测；ChatGPT/Claude/Gemini Insert 生产站点成功；真实 LLM 三模式因当前 OpenAI quota/billing 429 未证明。
- 验证命令或方式：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v2.ps1` 已 PASS；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-v2-tauri-runtime.ps1` 已 PASS；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-v2-real-llm.ps1` 当前返回 OpenAI 429 quota/billing。

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
