# M3 Desktop Input Recognition

## 2026-06-08 真实桌面工具端更新

- M3 验收不再把“新开 Windows Terminal/PowerShell 命令行窗口跑 Codex/Claude/Hermes”当作真实工具端证据；这类受控 CLI smoke 只能说明终端宿主机制，不能替代真实桌面工具端。
- `scripts/check-m3-real-desktop-tools.ps1` 现在支持 `-AttachExistingWindow -AttachProfile <profile>`，只会 attach 到已经打开的真实桌面窗口，不会启动命令行窗口；报告只保存标题长度/hash、进程名、工具画像和候选数量，不保存标题原文、元素名称原文、输入值或 prompt 正文。
- 最新真实桌面填入矩阵 `research/m3-real-desktop-tools-fill-matrix.latest.json` 已在用户打开的真实 Codex、Claude Code、Hermes 桌面窗口上通过：3/3 前景识别、3/3 写入尝试、3/3 回读验证、`noAutoSubmit:true`。Codex 使用 `clipboard_paste_fallback` 并恢复剪贴板；Claude Code 与 Hermes 使用 `uia_value_pattern`。三者都只保存长度/hash，不保存写入原文。
- 真实桌面填入仍必须显式开启 `-AllowForegroundWrite`，并且需要 attach/snapshot 后的 title hash 与 tool profile 匹配；对当前用户正在使用的工具窗口，默认不执行填入，因为会改动真实输入框。本轮三工具测试是在用户明确允许并打开真实桌面窗口后执行，不得用新开的命令行窗口替代。

日期：2026-06-07

## 当前范围

M3 的目标是把 Smart Prompt 从网页输入框推进到桌面/CLI 工具输入框。当前可验证竖切只做 Windows UI Automation；macOS AXUIElement 暂缓，不作为当前 M3 验收门槛。

## Windows UIA

2026-06-08 更新：

- 很多桌面/CLI 工具会把输入区渲染在 Terminal、WebView 或自绘容器里。Windows UIA 可能只能看到宿主容器，看不到标准 `ValuePattern` 或原生 Edit 控件，所以会出现“能识别工具窗口，但识别不到可写输入框”的情况。
- 输入识别现在会额外记录跟输入强关联的信号：Win32 caret 是否可见、caret 是否落在候选区域、候选是否拥有键盘焦点、是否匹配 UIA focused element、是否靠近窗口底部、是否是过大的宿主 `Document`，并输出 `inputSignals`、`bestCandidateIndex` 和 `bestCandidateScore`。这些信号可以帮助排序候选，但不能单独作为写入许可；真实 Codex WebView 已证明 caret 可能完全不暴露，focus 也可能只落在整窗 `Document` 上。
- `scripts/check-m3-desktop-fill.ps1` 已新增显式 `-AllowClipboardFallback`：使用临时剪贴板文本加 `Ctrl+V` 写入，随后恢复原剪贴板；报告只保存长度/hash，不保存原文，也不会发送 Enter 或 submit 信号。
- 真实前台窗口使用仍必须同时满足 `-ConfirmForeground`、`-ExpectedTitleHash`、`-ExpectedToolProfile` 和 `-AllowClipboardFallback`。缺少确认字段或窗口身份不匹配时，必须返回 `writeAttempted:false`。
- `POST /desktop/fill` 和 native sidecar 也支持 `allowClipboardFallback:true`，用于 Codex、Claude Code、Hermes 这类 UIA 写入 pattern 不可用的终端/WebView 输入区。
- 对真实前台窗口，脚本会阻止对超大 `ControlType.Document` 候选直接 `SetValue` 或 `SetWindowText`；这类候选通常是整个 App/WebView，而不是输入框。报告会标记 `directWriteBlocked:true` 并返回 `foreground_candidate_requires_clipboard_fallback`。

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

这证明 Windows 安装包内 sidecar snapshot/fill self-test 路径可用，并且前台窗口写回已有受控确认协议。真实 Codex、Claude Code、Hermes 工具窗口填入矩阵也已补齐，当前桌面工具端验收以 `research/m3-real-desktop-tools-fill-matrix.latest.json` 为准。

## 工具画像

当前 M3 首批桌面/CLI 工具画像：

- Codex：匹配窗口标题中的 `codex` 或进程名 `codex`。
- Claude Code：匹配窗口标题中的 `Claude Code`/`claude-code` 或进程名 `claude`。
- Hermes：匹配窗口标题中的 `Hermes` 或进程名 `hermes`。

VS Code、Windows Terminal、PowerShell、cmd 这类宿主进程不会单独触发工具画像，必须结合窗口标题或工具进程名，避免误报。

## 暂缓项

macOS AXUIElement 仍是后续跨平台方向，但本轮先不做识别实现，也不把 macOS 作为当前 M3 完成门槛。当前非 Windows 平台仍返回 guarded unsupported 状态。

## Pilot 数据

新增 `scripts/check-m3-pilot-adapters.ps1` 用于当前 beta 网页 adapter：

- Doubao

它生成 `research/m3-pilot-adapters.latest.json`，记录 Insert attempts、Insert success rate、失败原因、no-auto-send 状态、route matrix 和红线隐私检查。登录、地区限制、selector 失败都应记录为真实失败原因，而不是从报告里筛掉。

用户已明确 workBuddy、Trae 是本地工具路径，不作为网页 adapter 验收；DeepSeek 本轮不跑。

当前 pilot 报告已新增 `pageClassification` 与 `routeDiagnostics`，用于区分：

- `no_input_candidates_on_loaded_page`
- `public_or_marketing_page_no_visible_composer`
- `login_or_auth_gate_no_visible_composer`
- `region_or_security_gate_no_visible_composer`
- `input_candidates_hidden_or_offscreen`

最新结果是豆包登录态网页 1 次 Insert attempt、1 次成功，Insert success rate 为 1.0。证据来自用户已登录的现有 Chrome tab，验证了 `https://www.doubao.com/chat/` 上可见 composer、真实填入回读和 no-auto-send；测试文本已在取证后清空。该报告明确标记当前普通 Chrome tab 未加载 Smart Prompt 内容脚本，因此这是登录态 composer/adapter 写入验证，不伪装成 CDP 正式扩展加载。
