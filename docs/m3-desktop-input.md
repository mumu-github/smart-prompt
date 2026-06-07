# M3 Desktop Input Recognition

日期：2026-06-07

## 当前范围

M3 的目标是把 Smart Prompt 从网页输入框推进到桌面/CLI 工具输入框。当前可验证竖切只做 Windows UI Automation；macOS AXUIElement 暂缓，不作为当前 M3 验收门槛。

## Windows UIA

2026-06-08 更新：

- 很多桌面/CLI 工具会把输入区渲染在 Terminal、WebView 或自绘容器里。Windows UIA 可能只能看到宿主容器，看不到标准 `ValuePattern` 或原生 Edit 控件，所以会出现“能识别工具窗口，但识别不到可写输入框”的情况。
- `scripts/check-m3-desktop-fill.ps1` 已新增显式 `-AllowClipboardFallback`：使用临时剪贴板文本加 `Ctrl+V` 写入，随后恢复原剪贴板；报告只保存长度/hash，不保存原文，也不会发送 Enter 或 submit 信号。
- 真实前台窗口使用仍必须同时满足 `-ConfirmForeground`、`-ExpectedTitleHash`、`-ExpectedToolProfile` 和 `-AllowClipboardFallback`。缺少确认字段或窗口身份不匹配时，必须返回 `writeAttempted:false`。
- `POST /desktop/fill` 和 native sidecar 也支持 `allowClipboardFallback:true`，用于 Codex、Claude Code、Hermes 这类 UIA 写入 pattern 不可用的终端/WebView 输入区。

已新增 `scripts/check-m3-desktop-input.ps1`：

- `-SelfTest` 会创建临时 WinForms TextBox，并用 UI Automation 枚举输入候选。
- `-SelfTestProfile codex|claude-code|hermes` 会用对应工具画像标题跑 self-test。
- 默认模式会扫描当前前台窗口。
- 输出 `research/m3-desktop-input.latest.json`。
- 报告不保存窗口标题原文、元素名称原文或输入值，只保存长度、hash、候选数量和 UIA pattern 能力。

已新增 `scripts/check-m3-desktop-tool-profiles.ps1`：

- 依次验证 Codex、Claude Code、Hermes 三个 Windows UIA self-test 窗口。
- 输出 `research/m3-desktop-tool-profiles.latest.json`。
- 每个工具画像都必须检测到正确 `detectedToolProfile`、至少 1 个 UIA 输入候选，并且不能保存 raw title 或 raw input。

已新增 `scripts/check-m3-real-desktop-tools.ps1`：

- 默认扫描真实前台窗口，但不写入任何文本。
- 输出 `research/m3-real-desktop-tools.latest.json`。
- 报告只记录前台窗口的 processName、title 长度/hash、工具画像、候选数量和隐私检查，不保存窗口标题原文、元素名称原文或输入值。
- 当前实机审计已在 Codex 前台窗口通过 snapshot-only 检测：`detectedToolProfile:"codex"`、候选数 116、`writeAttempted:false`。
- 如需真实写入，必须显式传入 `-AllowForegroundWrite`、`-ExpectedTitleHash` 和 `-ExpectedToolProfile`，再复用受控前台写回协议。

已新增 `scripts/check-m3-desktop-fill.ps1`：

- `-SelfTest` 会创建临时 WinForms TextBox，并优先使用 UIA `ValuePattern.SetValue` 写入文本。
- 如果 UIA value pattern 不可用，会使用 Win32 `SetWindowText` 作为 self-test fallback。
- 非 self-test 写前台窗口必须显式传入 `-ConfirmForeground`、`-ExpectedTitleHash` 和 `-ExpectedToolProfile`；窗口 hash 或工具画像不匹配时只返回失败报告，不写入。
- 输出 `research/m3-desktop-fill.latest.json`。
- 报告只保存写入文本长度、hash、写入策略和校验结果，不保存 prompt 原文，不触发提交信号。

已新增 local-service 受保护接口：

- `GET /desktop/input-snapshot`
- `GET /desktop/input-snapshot?selfTest=1`
- `POST /desktop/fill`
- `POST /desktop/fill?selfTest=1`

这些接口返回当前桌面输入快照或写回校验结果，仍需要 per-install auth token。

`POST /desktop/fill` 的真实前台窗口写回协议：

- `confirmForeground: true`
- `expectedTitleHash: <来自 /desktop/input-snapshot 的 foreground.titleHash>`
- `expectedToolProfile: codex | claude-code | hermes`
- `candidateIndex: 0` 或调用方选择的输入候选
- `text` 或 `prompt`

缺少确认字段、窗口 hash 不匹配或工具画像不匹配时，接口必须返回 `writeAttempted:false`。

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

这证明 Windows 安装包内 sidecar snapshot/fill self-test 路径可用，并且前台窗口写回已有受控确认协议；真实 Codex 前台窗口 snapshot-only 审计也已通过。M3 仍未完成，因为还缺 Codex/Claude Code/Hermes 真实工具窗口写回验收报告。

## 工具画像

当前 M3 首批桌面/CLI 工具画像：

- Codex：匹配窗口标题中的 `codex` 或进程名 `codex`。
- Claude Code：匹配窗口标题中的 `Claude Code`/`claude-code` 或进程名 `claude`。
- Hermes：匹配窗口标题中的 `Hermes` 或进程名 `hermes`。

VS Code、Windows Terminal、PowerShell、cmd 这类宿主进程不会单独触发工具画像，必须结合窗口标题或工具进程名，避免误报。

## 暂缓项

macOS AXUIElement 仍是后续跨平台方向，但本轮先不做识别实现，也不把 macOS 作为当前 M3 完成门槛。当前非 Windows 平台仍返回 guarded unsupported 状态。

## Pilot 数据

新增 `scripts/check-m3-pilot-adapters.ps1` 用于四个 beta 网页 adapter：

- workBuddy
- Trae
- Doubao
- DeepSeek

它生成 `research/m3-pilot-adapters.latest.json`，记录 Insert attempts、Insert success rate、失败原因、no-auto-send 状态、route matrix 和红线隐私检查。登录、地区限制、selector 失败都应记录为真实失败原因，而不是从报告里筛掉。

当前 pilot 报告已新增 `pageClassification` 与 `routeDiagnostics`，用于区分：

- `no_input_candidates_on_loaded_page`
- `public_or_marketing_page_no_visible_composer`
- `login_or_auth_gate_no_visible_composer`
- `input_candidates_hidden_or_offscreen`

最新结果仍是 4 次 Insert attempts、0 次成功；每站已探测 5 个候选入口。失败原因已从单一 `no visible input candidate` 细化为 `no_input_candidates_on_loaded_page: 2`、`public_or_marketing_page_no_visible_composer: 1` 与 `login_or_auth_gate_no_visible_composer: 1`。当前 route matrix 显示 workBuddy、Trae、Doubao 候选入口都没有可见 composer；DeepSeek 有可见输入，但被识别为登录/认证页，探针不会再把登录框当作 composer 写入。
