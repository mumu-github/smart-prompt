# M3 Desktop Input Recognition

日期：2026-06-07

## 当前范围

M3 的目标是把 Smart Prompt 从网页输入框推进到桌面/CLI 工具输入框。当前第一条可验证竖切是 Windows UI Automation；macOS AXUIElement 仍是后续平台实现，不在 Windows 本机验收中伪装通过。

## Windows UIA

已新增 `scripts/check-m3-desktop-input.ps1`：

- `-SelfTest` 会创建临时 WinForms TextBox，并用 UI Automation 枚举输入候选。
- 默认模式会扫描当前前台窗口。
- 输出 `research/m3-desktop-input.latest.json`。
- 报告不保存窗口标题原文、元素名称原文或输入值，只保存长度、hash、候选数量和 UIA pattern 能力。

已新增 `scripts/check-m3-desktop-fill.ps1`：

- `-SelfTest` 会创建临时 WinForms TextBox，并优先使用 UIA `ValuePattern.SetValue` 写入文本。
- 如果 UIA value pattern 不可用，会使用 Win32 `SetWindowText` 作为 self-test fallback。
- 输出 `research/m3-desktop-fill.latest.json`。
- 报告只保存写入文本长度、hash、写入策略和校验结果，不保存 prompt 原文，不触发提交信号。

已新增 local-service 受保护接口：

- `GET /desktop/input-snapshot`
- `GET /desktop/input-snapshot?selfTest=1`
- `POST /desktop/fill`
- `POST /desktop/fill?selfTest=1`

这些接口返回当前桌面输入快照或写回校验结果，仍需要 per-install auth token。

已新增 native sidecar 受保护接口：

- `GET /desktop/input-snapshot`
- `GET /desktop/input-snapshot?selfTest=1`
- `POST /desktop/fill`
- `POST /desktop/fill?selfTest=1`

当前 Windows source/dev 路径通过 PowerShell UIA bridge 调用 `scripts/check-m3-desktop-input.ps1` 和 `scripts/check-m3-desktop-fill.ps1`，并由 `scripts/check-m3-sidecar-desktop-input.ps1`、`scripts/check-m3-sidecar-desktop-fill.ps1` 启动 native sidecar 做端到端 smoke。

安装包路径也已新增 M3 smoke：

- `apps/desktop-shell/scripts/prepare-sidecar.js` 会把 `check-m3-desktop-input.ps1` 和 `check-m3-desktop-fill.ps1` 打入 `resources/smart-prompt-sidecar/scripts/`。
- `scripts/check-m3-installed-sidecar-desktop-input.ps1` 会构建桌面壳、静默安装 NSIS 包、从安装后的 app 启动 bundled native sidecar，再调用 `GET /desktop/input-snapshot?selfTest=1` 与 `POST /desktop/fill?selfTest=1`。
- 证据文件：`research/m3-installed-sidecar-desktop-input.latest.json`，当前 `pass:true`。

这证明 Windows 安装包内 sidecar snapshot/fill self-test 路径可用；M3 仍未完成，因为还缺 macOS AX 和 Codex/Claude Code/Hermes 真实工具窗口写回。

## 工具画像

当前 M3 首批桌面/CLI 工具画像：

- Codex：匹配窗口标题中的 `codex` 或进程名 `codex`。
- Claude Code：匹配窗口标题中的 `Claude Code`/`claude-code` 或进程名 `claude`。
- Hermes：匹配窗口标题中的 `Hermes` 或进程名 `hermes`。

VS Code、Windows Terminal、PowerShell、cmd 这类宿主进程不会单独触发工具画像，必须结合窗口标题或工具进程名，避免误报。

## macOS AX

后续实现应复用同一数据契约：

- `schemaVersion`
- `platform`
- `foreground`
- `supportedToolProfiles`
- `candidates`
- `summary`
- `privacy`

macOS 侧需要通过 AXUIElement 获取当前前台应用、窗口和可编辑元素。未完成前，非 Windows 平台返回 guarded unsupported 状态，不作为 M3 完成证据。

## Pilot 数据

新增 `scripts/check-m3-pilot-adapters.ps1` 用于四个 beta 网页 adapter：

- workBuddy
- Trae
- Doubao
- DeepSeek

它生成 `research/m3-pilot-adapters.latest.json`，记录 Insert attempts、Insert success rate、失败原因、no-auto-send 状态和红线隐私检查。登录、地区限制、selector 失败都应记录为真实失败原因，而不是从报告里筛掉。

当前 pilot 报告已新增 `pageClassification` 与 `routeDiagnostics`，用于区分：

- `no_input_candidates_on_loaded_page`
- `public_or_marketing_page_no_visible_composer`
- `login_or_auth_gate_no_visible_composer`
- `input_candidates_hidden_or_offscreen`

最新结果仍是 4 次 Insert attempts、0 次成功；失败原因已从单一 `no visible input candidate` 细化为 `no_input_candidates_on_loaded_page: 3` 与 `public_or_marketing_page_no_visible_composer: 1`。
