# 当前进度

## P25 桌面壳准备状态证据 2026-06-09

- 已新增 Node local-service 与 Rust native sidecar 的 `POST/GET /desktop/prompt-state`；桌面壳在 Draft/Prompt 输入、生成完成、填入前同步脱敏准备状态，字段只包含长度、hash、来源、readiness 与 no-auto-submit 元数据。
- 填入前的同步使用强制模式：若已有定时同步正在进行，会短暂等待后再写一次最新状态，避免用户刚输入完立刻点击小人时验证器读到旧的 prompt-state。
- 已更新真实 overlay 点击验证器：`scripts/check-p25-real-overlay-click-fill.ps1` 不再把人工 `-DesktopPromptPrepared` 当作完成前置，真实点击前必须读到 `/desktop/prompt-state` 且 `desktopPromptStateReady=true`。
- 已更新 P25 总审计：`scripts/check-p25-overlay-click-chain.ps1` 检查桌面壳同步、Node 服务存储、sidecar 存储和真实点击验证器读取 prompt-state 的静态链路。
- 已验证：`node -c` 相关 JS PASS；PowerShell AST parse PASS；`npm test --prefix apps/local-service` PASS；`npm test --prefix apps/desktop-shell` PASS；`cargo check --manifest-path apps/local-service-sidecar/Cargo.toml` PASS；`scripts/check-p25-real-overlay-click-fill.ps1` PASS；`scripts/check-p25-overlay-click-chain.ps1` PASS；`npm run build --prefix apps/desktop-shell` PASS，并重新生成 release exe/MSI/NSIS。
- 当前 goal 仍未完成：最新真实点击报告 `completionReady:false`，主要缺 `strict_target_foreground_missing`、safe composer candidate、真实写入验证、desktop prompt state ready 和 real overlay click fill verified。

## P25 composer 候选诊断补强 2026-06-09

- 已新增 `scripts/check-p25-composer-candidate-diagnostics.ps1`，默认读取现有 `research/m3-desktop-input.latest.json` 与 P25 目标矩阵，生成 `research/p25-composer-candidate-diagnostics.latest.json`；可选 `-RefreshSnapshot` 才刷新 UIA snapshot。
- 诊断报告只输出候选 index、controlType、boundingRect、布尔输入信号、hash 和拒绝 reason，不读取/保存目标输入正文、raw title、raw element name 或 prompt 正文。
- 当前诊断结果：`completionImpact:"safe_composer_candidate_missing"`；当前 Codex snapshot 来源为 `cursor_known_tool_window_fallback`，`candidateCount=183`、`safeCandidateCount=0`、`semanticCandidateCount=0`、`focusedCandidateCount=0`、`caretCandidateCount=0`，拒绝原因主要是 `button_or_hyperlink=79`、`static_text=92`、`broad_document=1`。
- 已把该诊断纳入 `scripts/check-p25-overlay-click-chain.ps1`：总审计现在包含 `composerDiagnosticsVerifierPresent`、`composerDiagnosticsOnlyUsesSanitizedSignals`、`composerDiagnosticsReportPresent` 和 `composerDiagnosticsPrivacyOk`，但它不替代真实 overlay click fill 通过证据。
- 已验证：PowerShell 解析检查 PASS，`scripts/check-p25-composer-candidate-diagnostics.ps1` PASS，`scripts/check-p25-overlay-click-chain.ps1` PASS，`npm test --prefix apps/desktop-shell` PASS，`git diff --check` 仅 LF/CRLF warning。

## P25 真实 overlay 点击填入验证入口 2026-06-09

- 已新增 Node local-service 与 Rust sidecar 的 `GET /desktop/fill/latest`，只返回最近一次 `/desktop/fill` 的脱敏摘要：`confirmForeground`、profile/title hash 匹配、candidate index、verified、no-auto-submit、长度/hash 等元数据；不保存 prompt 正文、写入文本、剪贴板文本或 raw title/input。
- 已新增 `scripts/check-p25-real-overlay-click-fill.ps1`：默认只读、不点击；只有显式传入 `-AllowRealOverlayClick -DesktopPromptPrepared` 且目标矩阵满足 strict foreground 与 safe composer candidate 时，才会点击真实 `Smart Prompt Mascot` overlay，并通过 `/desktop/fill/latest` 验证点击触发的真实填入。
- 已更新 `scripts/check-p25-overlay-click-chain.ps1`，总审计现在检查真实点击验证器存在、必须显式允许点击、必须声明桌面壳草稿已准备、Node/sidecar 都能记录 latest fill，以及真实点击报告是否 verified。
- 最新 `research/p25-real-overlay-click-fill.latest.json`：`pass:true`、`completionReady:false`、`completionImpact:"strict_target_foreground_missing"`；它没有点击任何窗口，因为当前 Codex/WorkBuddy/Trae 仍缺 strict foreground 与 safe candidate。
- 最新 `research/p25-overlay-click-chain.latest.json`：`pass:true`、`completionReady:false`；安全链路、no-activate overlay、latest-fill 证据口均存在，但仍缺真实目标 composer 前台、safe candidate、真实写入验证和真实 overlay click fill verified。
- 已重新构建 release：`npm run build --prefix apps/desktop-shell` PASS，生成新的 `smart-prompt-desktop.exe`、MSI、NSIS；构建前曾因旧 sidecar 占用 exe 出现 Windows `os error 32`，已仅停止仓库内占用构建产物的 sidecar 后重跑通过。
- 已验证：`npm test --prefix apps/local-service` PASS，`npm test --prefix apps/desktop-shell` PASS，`cargo check --manifest-path apps/local-service-sidecar/Cargo.toml` PASS，`npm run build --prefix apps/desktop-shell` PASS，`scripts/check-p25-mascot-overlay-noactivate.ps1` PASS，`scripts/check-p25-real-overlay-click-fill.ps1` PASS，`scripts/check-p25-overlay-click-chain.ps1` PASS，`git diff --check` 仅 LF/CRLF warning。

## P25 overlay 点击链路守卫与审计补强 2026-06-09

- 已修复 `apps/desktop-shell/src/app.js` 中 overlay 点击 payload 守卫：`isMascotOverlayPayloadAligned()` 现在缺少 payload 时返回 false，避免异常/空 payload 的 `smart-prompt-overlay-click` 复用当前 ready snapshot 触发 `/desktop/fill`。
- 已补 `apps/desktop-shell/tests/desktop-shell-interaction.test.js`：覆盖 `payload:null` 的 overlay 点击不会调用 `/desktop/fill`，会隐藏 overlay 并把 `desktop-fusion-evidence` 标为 `blocked`，同时保留 `noAutoSubmit=true`。
- 已新增 `scripts/check-p25-overlay-click-chain.ps1`，生成 `research/p25-overlay-click-chain.latest.json`，聚合静态链路、非激活 overlay 报告、真实目标矩阵和写入守卫矩阵，明确区分 safety pass 与 completionReady。
- 最新 `research/p25-overlay-click-chain.latest.json`：`pass:true`，`completionReady:false`，`completionImpact:"real_overlay_click_fill_missing"`；静态检查确认 auto-detect、payload 守卫、no-auto-submit、foreground fill guard、非激活原生 overlay 与交互测试覆盖均存在。
- 当前缺失证据被机器列为：`strict target foreground for codex/workbuddy/trae`、`safe composer candidate for every requested target`、`verified real target writes`、`real overlay click fill report`。这仍不是完整 goal 完成。
- 已验证：`node -c apps/desktop-shell/src/app.js` PASS；`node -c apps/desktop-shell/tests/desktop-shell-interaction.test.js` PASS；`npm test --prefix apps/desktop-shell` PASS；`scripts/check-p25-overlay-click-chain.ps1` PASS；`git diff --check` 仅 LF/CRLF warning。

## P25 前台激活与严格矩阵补强 2026-06-09

- 已补强 `scripts/check-m3-real-desktop-tools.ps1` 的真实窗口前台激活审计：在 `ShowWindowAsync` 后依次尝试 `SetForegroundWindow`、`AttachThreadInput` + `BringWindowToTop`/`SetActiveWindow`、轻量 Alt 解锁重试和 `SwitchToThisWindow`，并把每一步写入 `attach.foregroundActivation`。
- 已补强 `scripts/check-p25-real-desktop-targets.ps1` 聚合口径：新增 `selectionSource`、`strictForegroundDetected`、`strictForegroundDetectedCount`，并把 `completionReady` 收紧为所有目标都严格前台且写入验证通过才为 true；`cursor_known_tool_window_fallback` 不再被当作完整前台完成证据。
- 当前最新只读矩阵 `research/p25-real-desktop-targets.latest.json`：`pass:true`，`completionReady:false`，`completionImpact:"target_windows_detected_by_cursor_fallback"`，Codex 窗口可找到但仅通过 cursor fallback 识别，`strictForegroundDetectedCount=0`，`targetSafeCandidateCount=0`；WorkBuddy/Trae 仍无可附加窗口。
- 当前最新写入守卫矩阵 `research/p25-real-desktop-targets-write-guard.latest.json`：即使开启 `-AllowForegroundWrite -AllowClipboardFallback -AllowTextPatternVerification`，仍 `writeAttemptedCount=0`、`writeVerifiedCount=0`、`noAutoSubmit=true`、`privacyOk=true`，没有误写 Hermes 或其它窗口。
- 已验证：两个 PowerShell 脚本解析通过；`npm test --prefix apps/desktop-shell` PASS；`git diff --check` PASS，仅 LF/CRLF warning。完整 goal 仍未完成，缺真实 Codex/WorkBuddy/Trae composer 严格前台、safe candidate、overlay 自动显示和点击后真实写入验证。

## P25 真实目标矩阵补充 2026-06-09

- 已新增 `scripts/check-p25-real-desktop-targets.ps1`，逐个探测 `codex/workbuddy/trae`，避免 PowerShell `-File` 下数组参数错位；同时把 `scripts/check-m3-real-desktop-tools.ps1` 改为 `PositionalBinding = $false`，防止 profile 被误解析成 attach 参数。
- 已生成 `research/p25-real-desktop-targets.latest.json`：`pass:true`，`completionReady:false`，`completionImpact:"target_windows_not_foreground"`，`windowFoundCount=1`，`foregroundDetectedCount=0`，`writeAttemptedCount=0`，`writeVerifiedCount=0`，`noAutoSubmit=true`，`privacyOk=true`。当前只找到 Codex 窗口，但未能成为前台；WorkBuddy/Trae 当前没有可附加窗口。
- 已生成写入守卫版 `research/p25-real-desktop-targets-write-guard.latest.json`：即使显式开启 `-AllowForegroundWrite -AllowClipboardFallback -AllowTextPatternVerification`，由于目标 composer 没有成为前台，仍 `writeAttemptedCount=0`，证明不会误写当前 Hermes/其它窗口。
- 已验证：`scripts/check-p25-real-desktop-targets.ps1` 默认矩阵 PASS；写入守卫矩阵 PASS；`npm test --prefix apps/desktop-shell` PASS；两个 PowerShell 脚本解析检查 PASS；`git diff --check` 仅 LF/CRLF warning。
- 仍未完成整个 goal：还缺真实 Codex/WorkBuddy/Trae composer 前台且 `safeCandidateCount > 0` 时，桌面小人自动显示并点击后完成真实填入的通过证据。

## P25 本轮补充 2026-06-09

- 已新增并通过 `scripts/check-p25-mascot-overlay-noactivate.ps1`：脚本启动 release 版 `smart-prompt-desktop.exe`，枚举真实 `Smart Prompt Mascot` 顶层窗口，确认 `exStyleHex=0x8040118` 且包含 `WS_EX_NOACTIVATE`，报告写入 `research/p25-mascot-overlay-noactivate.latest.json`。
- 已修复 Tauri overlay no-activate 落点：`apps/desktop-shell/src-tauri/src/main.rs` 现在同时处理 `window.hwnd()` 与 `GetAncestor(..., GA_ROOT)` 顶层 HWND，避免只给 WebView 子句柄设置样式而真实顶层窗口仍会激活。
- 已验证：`node -c apps/desktop-shell/tests/desktop-shell.test.js` PASS，`npm test --prefix apps/desktop-shell` PASS，`cargo check --manifest-path apps/desktop-shell/src-tauri/Cargo.toml` PASS，`npm run build --prefix apps/desktop-shell` PASS，`scripts/check-p25-mascot-overlay-noactivate.ps1` PASS，`git diff --check` 仅 LF/CRLF warning。
- 仍未把整个 goal 标记完成：当前新增证据证明小人 overlay 真实存在且不抢焦点，但还缺真实 Codex/WorkBuddy/Trae composer 中“检测输入自动显示 -> 点击小人 -> 填入真实 composer”的端到端通过证据。

## P25 真实桌面输入框旁悬浮小人进度 2026-06-09

- 已把需求从“桌面壳内按钮/面板”纠偏为“真实 Codex/WorkBuddy/Trae composer 附近的小人悬浮入口”：新增 Tauri `mascot-overlay` 子窗口，窗口内容使用现有小人 PNG 状态图，作为桌面级无边框置顶小卡片显示。
- 已接入自动检测：桌面壳启动后会启动/复用 local-service，按节流轮询 `/desktop/input-snapshot`；只有快照满足 profile、title hash、安全候选和可定位 composer-like 候选时才 `show_mascot_overlay`，否则隐藏。
- 已加固点击链路：overlay 点击发送 `smart-prompt-overlay-click` 回主窗口；主窗口优先使用点击前锁定的快照，避免点击小人后把 overlay 自己误识别为前台；填入仍走 `/desktop/fill`，带 `confirmForeground`、`expectedTitleHash`、`expectedToolProfile`、`candidateIndex`、`allowClipboardFallback`、`allowTextPatternVerification`，不自动提交。
- 已修复真实桌面可见性问题：Tauri 使用物理坐标定位、每次 show 重新设置 topmost；overlay 取消透明窗口依赖，使用固定 `190x190` 画布与内联关键样式，避免 WebView2/DPI 裁切 PNG；短暂前台 miss 会在 4200ms 内保持 resting 状态，避免 `LockApp` 抖动导致闪烁。
- 已补前台误判守卫：`scripts/check-m3-desktop-input.ps1`、`scripts/check-m3-desktop-fill.ps1`、`scripts/check-m3-real-desktop-tools.ps1` 不再让 `explorer`、`LockApp`、`ShellExperienceHost` 等系统壳通过子进程/祖先进程名字误判成 Codex/Hermes/WorkBuddy/Trae。
- 已补真实窗口 fallback：当 `GetForegroundWindow()` 返回 `LockApp`/`explorer Backstop Window` 且没有安全候选时，输入探测会枚举鼠标所在的可见顶层工具窗口，只有直接匹配到已知工具 profile 时才用该窗口重试 UIA snapshot；`AutomationElement.FromHandle` 失效时会降级为 `uia_root_unavailable`，不再让自动检测崩溃。
- 已收紧安全写入候选：Codex/Claude/Hermes 等 profile 不再把整窗 `broadDocument` 当成 safe candidate；必须存在真实 `Edit`、焦点、caret 或非 broad 可写候选才会产生 `safeCandidateCount > 0`。填入脚本同步拒绝 `foreground_no_safe_input_candidate`，避免小人点击误写整窗。
- 已补目标 profile 限制：桌面诊断仍支持 `codex/claude-code/hermes/workbuddy/trae`，但 `mascot-overlay` 自动显示只允许 `codex/workbuddy/trae`，Hermes ready snapshot 会立即隐藏 overlay，不走 sticky。
- 已把“诊断 ready”和“小人 overlay ready”拆开：`getDesktopSnapshotReadiness()` 现在输出 `readinessReason`、`overlayEligible`、`overlayReady`、`overlayReadinessReason`；WorkBuddy/Codex/Trae 只有同时满足安全写入候选与目标 profile 时才会让小人显示，Codex 被识别但 `safeCandidateCount=0` 时会记录 `no-safe-candidate` 并立即隐藏 overlay。
- 已收紧 sticky 规则：短暂 `LockApp`、unknown 或 0 candidate 的前台 miss 仍可让小人短暂 resting 防闪烁；但已明确识别到目标工具且没有安全 composer 候选时不再沿用旧 overlay，避免把上一轮 ready 状态错带到当前窗口。
- 已补自动激活回归：桌面壳交互测试现在提供受控 `setInterval`，验证启动后自动开启 local-service、注册 1400ms 轮询、自动请求 `/desktop/input-snapshot` 并在 WorkBuddy ready snapshot 下调用 `show_mascot_overlay`；再次触发定时器时，如果 composer boundingRect 移动，小人坐标会随 snapshot 更新。
- 已修复自动检测竞态：`loadServiceState()` 不再无条件调用空 `renderDesktopSnapshot()` 覆盖已经由自动检测锁定的真实前台 snapshot，避免“小人已显示但主 UI 又回到 missing”的状态脱节。
- 已加固 overlay 点击守卫：`smart-prompt-overlay-click` 现在把 overlay payload 传回主窗口，主窗口会校验 `profile/titleHash/candidateIndex/noAutoSubmit` 与当前锁定 snapshot 一致；stale payload 会隐藏 overlay、标记融合证据为 `blocked`，不会调用 `/desktop/fill`。`show_mascot_overlay` payload 的 `candidateIndex` 现在明确代表安全写入候选，而不是仅用于定位的小人候选。
- 已补 Windows 原生非激活 overlay：`mascot-overlay` 创建后会给 HWND 加 `WS_EX_NOACTIVATE`，显示/置顶时使用 `SetWindowPos(... SWP_NOACTIVATE ...)`；这比仅靠创建时 `focused(false)` 更接近真实体验，点击小人时尽量不把前台从目标 composer 抢走。
- 已补 stale-click 回归：桌面壳交互测试覆盖旧 `titleHash` overlay 点击不会触发 foreground fill，随后恢复到有效 snapshot 后正确 overlay 点击仍能走 `/desktop/fill`，且继续带 `confirmForeground`、`expectedTitleHash`、`expectedToolProfile`、`candidateIndex` 与 no-auto-submit 证据。
- 已补 DWM 可见性过滤：`cursor_known_tool_window_fallback` 会跳过 DWM cloaked 窗口，减少进程存在但桌面不可见时的误选。
- 已补回归测试：桌面壳交互测试覆盖自动轮询 show/reposition、WorkBuddy `overlayReady=true`、Hermes `unsupported-overlay-profile` 不显示小人、Codex `no-safe-candidate` 立即 guarded/hide 且不走 resting sticky。
- 已验证：`node -c apps/desktop-shell/src/app.js` PASS；`node -c apps/desktop-shell/tests/desktop-shell-interaction.test.js` PASS；`npm test --prefix apps/desktop-shell` PASS；`npm test --prefix apps/local-service` PASS；`scripts/check-m3-desktop-tool-profiles.ps1 -JsonOnly` PASS；`cargo check --manifest-path apps/desktop-shell/src-tauri/Cargo.toml` PASS；`npm run build --prefix apps/desktop-shell` PASS，release exe/MSI/NSIS 已重建；本轮新增自动轮询、stale-click 和 Windows no-activate overlay 覆盖后再次 `npm run build --prefix apps/desktop-shell` PASS。
- 实机证据：release 版创建了 `Smart Prompt Mascot` 子窗口，默认隐藏；短暂显示并 `PrintWindow` 后的截图 `research/p25-release-mascot-overlay-print.png` 显示真实小人渲染。当前机器只看到 Codex 与 Hermes 进程，没有 WorkBuddy/Trae 窗口；Codex 可被恢复并识别为 `profile=codex`，但当前 composer 未暴露安全 `Edit/focus/caret` 候选，快照保持 `safeCandidateCount=0`、`bestCandidateIndex=-1`，因此不会误激活/误填入。Codex/WorkBuddy/Trae 仍需在真实前台 composer 聚焦状态下复验端到端写入。
- 本轮 Computer Use 只读应用列表显示当前可控窗口有 Hermes/Chrome/Explorer/CordC/Edge/微信等，没有 WorkBuddy/Trae；Codex UI 按 Computer Use skill 边界不能自动化。因此真实端到端写入仍未形成新的通过证据。

## P24 桌面小人与输入融合进度 2026-06-09

- 已创建并绑定 autoresearch-goal：`smart-prompt-desktop-mascot-input-fusion-parity`。
- 已在 `apps/desktop-shell/index.html`、`src/app.js`、`src/styles.css` 增加桌面输入融合控制台：真实小人按钮、草稿、生成 prompt、显式前台填入、融合证据行。
- 已补测试：`apps/desktop-shell/tests/desktop-shell.test.js` 和 `desktop-shell-interaction.test.js` 覆盖小人点击识别前台、`/generate` 桌面上下文、前台填入守卫参数、no-auto-submit dataset。
- 已同步 `apps/desktop-shell/dist`，并更新 `docs/m3-desktop-input.md`。
- 已新增并通过 `scripts/critic-p24-desktop-mascot-input-fusion.ps1`；OMX verdict 已记录 pass。
- 已验证：`npm test --prefix apps/desktop-shell` PASS；`git diff --check` 无 whitespace error，仅 LF/CRLF warning；Playwright CLI 截图 smoke 已生成桌面和移动截图。

## 托盘图标第三次修复进度 2026-06-09

- 已确认用户截图中的问题不是安装包/exe 关联图标，而是 Windows 托盘运行时图标链路仍可能显示为空白或不稳定。
- 已新增并放大托盘专用图标 `assets/brand/smart-prompt-tray-32.png` 与 `apps/desktop-shell/src-tauri/icons/tray.png`：保持原小人角色不变，裁掉透明留白后把可见小人本体放大到约 `23x30`，使视觉尺寸接近其它 Windows 托盘图标。
- 已将 `apps/desktop-shell/src-tauri/src/main.rs` 改为优先加载 `../icons/tray.png`，并在 setup 中用 `app.manage(tray)` 显式持有 `TrayIcon`，避免 tray 实例生命周期不稳。
- 已更新 `scripts/check-brand-icons.js`、`apps/desktop-shell/tests/desktop-shell.test.js` 和 `docs/brand-icons.md`，把 tray 专用资产、运行时绑定、防空白文件大小断言和可见区域断言纳入验收。
- 已验证：`node scripts/check-brand-icons.js` PASS；`npm run test --prefix apps/desktop-shell` PASS；`cargo check --manifest-path apps/desktop-shell/src-tauri/Cargo.toml` PASS；`npm run build --prefix apps/desktop-shell` PASS；`git diff --check` 无 whitespace error，仅 LF/CRLF warning。
- 已重新生成 release exe/MSI/NSIS：`apps/desktop-shell/src-tauri/target/release/smart-prompt-desktop.exe`、`apps/desktop-shell/src-tauri/target/release/bundle/msi/Smart Prompt_0.2.0_x64_en-US.msi`、`apps/desktop-shell/src-tauri/target/release/bundle/nsis/Smart Prompt_0.2.0_x64-setup.exe`。

## M3 WorkBuddy/Trae 真实桌面输入融合进度 2026-06-09

- 已完成真实窗口手动 pilot：WorkBuddy composer 写入 `Smart Prompt desktop fill probe` 后清空；Trae composer 写入 `Smart Prompt Trae fill probe` 后清空；均未自动发送。
- 已补 WorkBuddy/Trae WebView 输入候选定位：新增 `semanticComposerHint`、`semanticCandidateCount`，并把 profile composer guard 改成“底部 composer 几何 + 强输入信号或语义提示 + 排除整窗 Document”。
- 已更新 `apps/local-service/src/desktop-input-detector.js` 与 `apps/local-service/tests/local-service.test.js`，确保新信号经过脱敏接口返回并被测试覆盖。
- 已更新 `docs/m3-desktop-input.md`，说明语义提示只记录布尔信号，不读取或保存用户输入原文。
- 已验证：`node -c apps/local-service/src/desktop-input-detector.js` PASS；`node -c apps/local-service/tests/local-service.test.js` PASS；PowerShell 脚本解析检查 PASS；`npm test --prefix apps/local-service` PASS；`npm test --prefix apps/desktop-shell` PASS；`git diff --check` 无 whitespace error，仅 LF/CRLF warning。
- 本轮未运行真实 UIA 填入脚本，因为同一轮已经使用 Computer Use 控制真实窗口；下一轮可在不混用桌面自动化方式的前提下跑 `check-m3-desktop-fill.ps1` 生成机器验证报告。

## 托盘图标二次修复进度 2026-06-09

- 已修复用户截图中的“隐藏托盘仍显示空白占位”风险：`apps/desktop-shell/src-tauri/src/main.rs` 现在优先用编译期内嵌 PNG 生成 tray 图标，不再只依赖默认窗口图标。
- 已更新 `apps/desktop-shell/src-tauri/Cargo.toml`，为 Tauri 显式开启 `image-png`；`Cargo.lock` 随之新增/更新 `image/png` 相关依赖。
- 已补测试断言：`apps/desktop-shell/tests/desktop-shell.test.js` 检查 `smart_prompt_tray_icon`、`Image::from_bytes(...)`、稳定 tray id；`scripts/check-brand-icons.js` 同步检查桌面 tray 绑定。
- 已完成验证：`node scripts/check-brand-icons.js` PASS；`npm test --prefix apps/desktop-shell` PASS；`cargo check --manifest-path apps/desktop-shell/src-tauri/Cargo.toml` PASS；`npm run build --prefix apps/desktop-shell` PASS；`git diff --check` 无 whitespace error，仅 LF/CRLF warning。
- 已重新生成 release exe/MSI/NSIS，并提取新 exe 关联图标确认非空：`research/smart-prompt-exe-associated-icon.png`。

## 托盘图标与 M3 critic 修复进度 2026-06-09

- 已修复 Windows 托盘空白图标问题：Tauri tray 现在显式使用 `default_window_icon()`，并通过桌面壳静态测试覆盖 `default_window_icon` 与 `tray_builder.icon(icon.clone())`。
- 已重新打包桌面端：`npm run build --prefix apps/desktop-shell` 由 M3 installed sidecar smoke 和完整 M3 critic 触发并通过，release exe、MSI、NSIS 均已更新。
- 已验证图标资源：`node scripts/check-brand-icons.js` PASS；Windows `ExtractAssociatedIcon` 可从新 exe 提取 32x32 小人图标，预览输出 `research/smart-prompt-exe-associated-icon.png`。
- 已修复 M3 sidecar 自测误超时：`check-m3-sidecar-desktop-input.ps1` 与 `check-m3-sidecar-desktop-fill.ps1` 对 UIA snapshot/fill 请求使用 20 秒超时，health/bootstrap 仍保持短超时。
- 已完成验证：`npm test --prefix apps/desktop-shell` PASS；`check-m3-sidecar-desktop-input.ps1` PASS；`check-m3-sidecar-desktop-fill.ps1` PASS；`check-m3-installed-sidecar-desktop-input.ps1` PASS；完整 `scripts/critic-m3.ps1` PASS。
- 真实桌面填入补充：Trae 真实前台安全填入已验证通过并已清空测试文本；WorkBuddy 已能识别真实窗口，但当前停留在非 prompt composer 页面，因此安全拦截，不写入。

## 品牌图标资产确定进度 2026-06-09

- 已确定 Smart Prompt 各渠道正式图标使用现有小人 `normal` 状态，不重新设计角色；交互状态小人继续用于 Prompt Card/桌面壳内的动作反馈。
- 已新增 `assets/brand/` 品牌图标源与 16/32/48/64/128/256/512/1024 多尺寸 PNG。
- 已新增浏览器扩展图标 `prototypes/browser-extension/assets/icons/icon-{16,32,48,128}.png`，并接入 `manifest.icons` 与 `action.default_icon`。
- 已补齐 Tauri 桌面壳 icon PNG 与多 entry ICO，并把 `bundle.icon` 更新为 32/128/256/512/ICO 五项。
- 已新增 `docs/brand-icons.md` 渠道矩阵、`scripts/generate-brand-icons.js` 生成脚本和 `scripts/check-brand-icons.js` 验收脚本。
- 已验证：`node scripts/check-brand-icons.js` PASS；`npm test --prefix prototypes/browser-extension` PASS；`npm test --prefix apps/desktop-shell` PASS；`npm run build --prefix apps/desktop-shell` PASS；`git diff --check` 无 whitespace error，仅 LF/CRLF warning。

## M3 WorkBuddy/Trae 真实桌面输入 pilot 进度 2026-06-08

- 已补真实窗口 attach 稳定性：`check-m3-real-desktop-tools.ps1` 在 attach WorkBuddy/Trae 后先 restore 窗口，再 set foreground 与设置 cursor，避免最小化窗口 `-16000,-16000` 坐标导致候选和点击漂移。
- 已补 WorkBuddy/Trae WebView 安全候选逻辑：输入探测报告新增 `safeCandidateCount`；WorkBuddy/Trae 的视觉 fallback 不再算可写候选，只有符合工具 profile composer guard 的候选才会成为 best candidate。
- 已补填入后验证链路：`check-m3-desktop-fill.ps1` 增加 ValuePattern 验证、邻近文本验证、UIA 写入验证失败后的显式 clipboard fallback；所有验证只记录长度/hash/source，不存正文。
- 已完成真实窗口回归：`research/m3-real-desktop-workbuddy-fill.latest.json` 与 `research/m3-real-desktop-trae-fill.latest.json` 均显示真实窗口识别通过、隐私检查通过、no auto-submit；当前两者 `safeCandidateCount=0`，所以写入被 `foreground_fill_requires_safe_candidate` 安全拦截。
- 已验证：`check-m3-desktop-input.ps1` WorkBuddy/Trae self-test PASS；`check-m3-desktop-fill.ps1 -SelfTest` PASS；`node -c apps/local-service/src/desktop-input-detector.js` PASS；`git diff --check` 仅 LF/CRLF warning。

## P23 桌面壳重新打包进度 2026-06-08

- 已重新打包桌面端：`npm run build` in `apps/desktop-shell` PASS；构建过程自动执行 `prepare-dist` 与 `prepare-sidecar`，已把最新桌面 UI/i18n 与 native sidecar 打入 release。
- 首次构建失败原因是旧 `local-service-sidecar` 进程占用 `resources/smart-prompt-sidecar/bin/local-service-sidecar.exe`；已仅停止该 Smart Prompt sidecar 进程后重跑成功。
- 新产物：`apps/desktop-shell/src-tauri/target/release/smart-prompt-desktop.exe`、`apps/desktop-shell/src-tauri/target/release/bundle/msi/Smart Prompt_0.2.0_x64_en-US.msi`、`apps/desktop-shell/src-tauri/target/release/bundle/nsis/Smart Prompt_0.2.0_x64-setup.exe`。
- 已验证裸 exe PE subsystem 为 `2 Windows GUI`，用于避免双击时额外弹出控制台窗口。

## P23 桌面壳 UI/i18n 与桌面工具融合进度 2026-06-08

- 已完成桌面壳视觉重构：`apps/desktop-shell/index.html` 与 `apps/desktop-shell/src/styles.css` 改为极简产品叙事布局，首屏突出 Smart Prompt 本体和小人状态，后续面板按首次启动、桌面伴随、学习闭环、证据、质量、诊断、设置、本地库和快捷键组织。
- 已完成桌面壳国际化：`apps/desktop-shell/src/app.js` 新增 `zh-CN/en` 文案表、语言选择、静态/placeholder/aria 应用、离线初始态本地化和小人状态标签本地化；`index.html` 补齐初始空状态 `data-i18n`。
- 已完成按钮体系化：主操作、次级操作、危险操作和行内操作统一为可复用按钮类，移动端按钮栅格化并避免文本溢出。
- 已完成真实桌面工具融合增强：桌面伴随面板可展示前台识别摘要、安全填入自测和支持 profile；Tauri 全局快捷键不再抢焦点；profile/self-test 已加入 workBuddy 与 Trae。
- 已补桌面壳小人资产：`apps/desktop-shell/src/assets/mascot-states/` 包含 normal/resting/thinking/suggesting/success/clapping 六种透明 PNG。
- 已验证：`node -c apps/desktop-shell/src/app.js` PASS；`npm test --prefix apps/desktop-shell` PASS；`npm test --prefix apps/local-service` PASS；`node -c packages/shared/desktop-tool-profiles.js` PASS；`git diff --check` PASS，仅 LF/CRLF warning。
- 已完成视觉验证：通过 Chrome CDP 生成 `research/p23-desktop-shell-visual.png` 与 `research/p23-desktop-shell-visual-mobile.png`；移动端指标为 `innerWidth=390`、`docScrollWidth=390`。

## V6 P17 Outcome 补标队列进度 2026-06-08

- 已完成 local-service 补标队列：`store.getOutcomeFollowups()` 从 prompt history 和 metrics 构造 metadata-only 待补标候选，并排除已存在 outcome 的 generation。
- 已完成 local-service 补标写入：`store.recordOutcomeFollowup()` 标准化 `success/needs-work/failed`，写入 `manual_followup` outcome metric，并返回更新后的 pending 队列。
- 已完成服务路由：新增 `GET /outcomes/pending` 与 `POST /outcomes/follow-up`，错误分支覆盖 invalid label 和 missing candidate。
- 已完成桌面壳 `Outcome Follow-up` 面板：显示 pending count 和候选元数据，支持三按钮补标，补标后刷新 Pilot Outcomes 与 Quality Lift。
- 已完成测试：local-service 测试覆盖 pending 队列、metadata-only 隐私边界、manual follow-up 写入和队列移除；desktop-shell 交互测试覆盖初始加载、刷新和点击 `Needs work`。
- 已同步 `apps/desktop-shell/dist`：运行 `npm run prepare-dist`。
- 已验证：`node -c` 相关文件 PASS；`npm test` in `apps/local-service` PASS；`npm test` in `apps/desktop-shell` PASS；完整 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v6-prompt-quality.ps1` PASS；`git diff --check` exit 0，仅 LF/CRLF warning。
- 已记录 OMX verdict：`smart-prompt-v6-p17-outcome-followup-queue -> pass`。

## V6 P16 Quality Lift 桌面面板进度 2026-06-08

- 已完成桌面壳 `Quality Lift` 面板：新增状态条、摘要指标、cohorts、lift deltas 和 recommendations 区域，复用紧凑 outcome 布局。
- 已完成前端逻辑：`renderQualityLiftDashboard`、`refreshQualityLift`、`/metrics/prompt-quality-lift` 初始加载、诊断导出同步刷新和手动刷新。
- 已完成桌面测试：静态测试覆盖 HTML/CSS/app 入口；交互测试用 fake service 覆盖 `v6-quality-lift@1` ready 报告、positive lift、cohort count、recommendation count、diagnostics export 和 refresh。
- 已同步 `apps/desktop-shell/dist`：运行 `npm run prepare-dist`。
- 已验证：`node -c apps\desktop-shell\src\app.js` PASS；`node -c apps\desktop-shell\tests\desktop-shell-interaction.test.js` PASS；`node -c apps\desktop-shell\tests\desktop-shell.test.js` PASS；`npm test` in `apps/desktop-shell` PASS；完整 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v6-prompt-quality.ps1` PASS；`git diff --check` exit 0，仅 LF/CRLF warning。
- 已记录 OMX verdict：`smart-prompt-v6-p16-quality-lift-dashboard -> pass`。

## V6 P13 延迟 outcome 标注进度 2026-06-08

- 已完成 Undo toast 延迟 outcome 入口：Insert 成功后 toast 显示 `Outcome` 三按钮，支持 `success`、`needs-work`、`failed`。
- 已抽出 `recordManualOutcome`，卡片内标注和 toast 标注共用隐私安全反馈路径；卡片来源为 `manual_card`，toast 来源为 `manual_toast`。
- 已补 toast 状态数据集：点击延迟 outcome 后写入 `smartPromptDelayedOutcome` 与 `smartPromptDelayedOutcomeSource`，便于 runtime 验证。
- 已补样式：toast 内 outcome 按钮保持次级按钮视觉，不和 Undo 主按钮混淆。
- 已补 runtime demo：Insert 后点击 toast 的 `needs-work`，验证 input 未变、submitCount 为 0、本地 feedback 和 local-service metric 都记录 `manual_toast` outcome，并且不泄露 prompt 正文。
- 已验证：`node -c prototypes\browser-extension\src\content.js` PASS；`node -c prototypes\browser-extension\tests\runtime-demo.test.js` PASS；`npm test` in `prototypes/browser-extension` PASS；`npm test` in `apps/local-service` PASS；`npm test` in `apps/desktop-shell` PASS；完整 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v6-prompt-quality.ps1` PASS；`git diff --check` 无 whitespace error，仅 LF/CRLF 提示。
- 已记录 OMX verdict：`smart-prompt-v6-p13-delayed-outcome-toast -> pass`。

## V6 P12 pilot outcome 面板进度 2026-06-08

- 已完成桌面壳 `Pilot Outcomes` 面板：新增 readiness 状态、outcome 总数、成功率、均分、Strategies 和 Collection Targets 区域。
- 已完成前端逻辑：`renderPilotOutcomeDashboard`、`refreshPilotOutcomes`、`/metrics/pilot-outcomes` 加载、diagnostics export 同步渲染，以及安全 HTML escape。
- 已完成桌面壳测试：静态测试检查 HTML/CSS/app 入口，交互测试用 fake service 覆盖初始加载、Refresh、diagnostics export、winner/risk strategy 与 collection target 渲染。
- 已更新 V6 critic：`scripts/critic-v6-prompt-quality.ps1` 现在会运行 `apps/desktop-shell` 的 `npm test`，把 P12 面板纳入硬门槛。
- 已同步 `apps/desktop-shell/dist`：运行 `npm run prepare-dist`。
- 已验证：`npm test` in `apps/desktop-shell` PASS；`npm test` in `apps/local-service` PASS；`npm test` in `prototypes/browser-extension` PASS；完整 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v6-prompt-quality.ps1` PASS；`git diff --check` 无 whitespace error，仅 LF/CRLF 提示。
- 已记录 OMX verdict：`smart-prompt-v6-p12-pilot-outcome-dashboard -> pass`。

## V6 P11 pilot outcome readiness 进度 2026-06-08

- 已完成 `packages/shared/prompt-quality.js` 的 pilot outcome readiness 报告：输出 `v6-pilot-outcome-readiness@1`，可识别 ready、collecting、empty cohort，并给出 winningStrategies、riskStrategies、collectionTargets 和 recommendations。
- 已完成 local-service 接入：新增 `GET /metrics/pilot-outcomes`，`/diagnostics/export` 增加 `pilotOutcomeReadinessReport` / `pilotOutcomeReadinessText`；`apps/local-service/tests/local-service.test.js` 覆盖接口、诊断导出、host-only site 聚合和不泄露 prompt 正文。
- 已新增 `scripts/check-v6-pilot-outcomes.js`：使用 7 个合成 outcome 事件覆盖 security-review winner、ui-ux risk、data-analysis collecting、general empty，并验证 SECRET 哨兵文本和私有路径不会进入报告。
- 已把 P11 纳入 `scripts/critic-v6-prompt-quality.ps1` 硬门槛，校验 pilot 报告版本、readiness、cohort、策略 winner/risk、collection target、隐私标记和 redaction。
- 已验证：`node -c` 相关文件 PASS；`node scripts\check-v6-pilot-outcomes.js` PASS；`node scripts\check-v6-prompt-quality.js` PASS；`npm test` in `apps/local-service` PASS；`npm test` in `prototypes/browser-extension` PASS；完整 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v6-prompt-quality.ps1` PASS；`git diff --check` 无 whitespace error，仅 LF/CRLF 提示。
- 已记录 OMX verdict：`smart-prompt-v6-p11-pilot-outcome-readiness-repo -> pass`。

## V6 P10 outcome 标注 UI 进度 2026-06-08

- 已完成 Prompt Card outcome 标注入口：`prototypes/browser-extension/src/content.js` 新增 `结果/Outcome` 控件，包含 `success`、`needs-work`、`failed` 三个紧凑按钮，渲染时会随 locale 更新文案并在新生成时重置选择。
- 已完成 outcome 事件回传：点击按钮会调用 `recordFeedbackEvent("outcome", ...)`，携带 `outcomeLabel`、`outcomeScore`、`outcomeVerified:true`、`outcomeSource:"manual_card"`，同时保留 generation/strategy/taskScenario 元数据。
- 已完成紧凑样式：`prototypes/browser-extension/src/content.css` 收紧 output/evidence 区域并增加 `.spc-outcome` 样式，runtime demo 仍验证卡片宽高不超过紧凑阈值。
- 已修正 outcome 成功判定：`apps/local-service/src/store.js` 现在先判断失败 label，再判断成功 label 和 verified/ok/adopted，避免 `needs-work` 或 `failed` 被 `outcomeVerified:true` 误算为成功。
- 已补 local-service 测试：`apps/local-service/tests/local-service.test.js` 覆盖 `needs-work + outcomeVerified:true + ok:false` 时 `outcomeSuccessRate` 仍为 0。
- 已补 runtime demo：`prototypes/browser-extension/tests/runtime-demo.test.js` 点击 success outcome，验证扩展本地 feedback、local-service `/metrics`、no-auto-submit、generation/strategy/taskScenario 元数据和 prompt 正文不泄露。
- 已验证：`node -c` 语法检查 PASS；`npm test` in `apps/local-service` PASS；`npm test` in `prototypes/browser-extension` PASS；`node scripts\check-v6-prompt-quality.js` PASS；完整 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v6-prompt-quality.ps1` PASS；`git diff --check` 无 whitespace error，仅 LF/CRLF 提示。
- 已记录 OMX verdict：`smart-prompt-v6-p10-outcome-label-ui -> pass`。

## V6 P9 任务 outcome 反馈闭环进度 2026-06-08

- 已完成 outcome 元数据落库：`apps/local-service/src/store.js` 的 `recordMetric` 支持 outcome label/score/verified/source，`getMetrics()` 支持全局、byStrategy、byScenario、byScenarioStrategy、byExperimentArm、byScenarioExperimentArm 的 outcome 聚合。
- 已修复 outcome 平均分聚合 bug：避免 `Number(null) === 0` 把无 outcomeScore 的事件错误计入平均分分母；local-service 测试已覆盖 `avgOutcomeScore === 0.92`。
- 已完成 task outcome 报告与策略接入：`packages/shared/prompt-quality.js` 新增 `buildTaskOutcomeReport` / `formatTaskOutcomeReport`，并让 `buildPromptStrategyPlan` 根据 `prefer_task_outcome_winner` 或低 outcome 风险调整策略。
- 已完成生成链路接入：`apps/local-service/src/server.js` 新增 `/metrics/task-outcomes`，`/diagnostics/export` 与 `/generate` 会返回并注入 `taskOutcomeReport` / `taskOutcomeText`；prompt history 保存 outcome 状态/决策/推荐/计数。
- 已完成 shared core 接入：`packages/shared/smart-prompt-core.js` 的 template fallback 与真实 LLM messages 会包含 `Local task outcomes`，但只使用聚合文本。
- 已完成浏览器扩展回传：`prototypes/browser-extension/src/content.js` 的反馈事件可携带 outcome 字段。
- 已完成机器证据：`scripts/check-v6-prompt-quality.js` 新增 `taskOutcomeProbe`，`scripts/critic-v6-prompt-quality.ps1` 已把该 probe 纳入硬门槛；OMX mission `smart-prompt-v6-p9-task-outcome-feedback-loop` 已记录 pass verdict。
- 已验证：语法检查 PASS；`node scripts\check-v6-prompt-quality.js` PASS；`npm test` in `apps/local-service` PASS；`npm test` in `prototypes/browser-extension` PASS；完整 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v6-prompt-quality.ps1` PASS 并输出 `V6_PROMPT_QUALITY_PASS`；`git diff --check` 无 whitespace error，仅 LF/CRLF 提示。

## V6 P8 场景感知提示词学习进度 2026-06-08

- 已完成 `inferTaskScenario`：共享策略模块能从输入与上下文推断隐私安全任务场景 token，并允许调用方显式覆盖 `taskScenario`。
- 已完成场景聚合：`apps/local-service/src/store.js` 的 metrics 新增 `taskScenario`、`byScenario`、`byScenarioStrategy`、`byScenarioExperimentArm`，并在聚合中记录场景计数。
- 已完成生成链路接入：`apps/local-service/src/server.js` 在 `/generate` 中推断场景，并将场景传入 feedback、strategy、experiment、LLM context、card、qualityExperiment 和 prompt history。
- 已完成 shared core 接入：template prompt 与真实 LLM messages 均包含 `Local task scenario`，策略文本和洞察文本会输出 scenario cohort。
- 已完成浏览器扩展反馈接入：`prototypes/browser-extension/src/content.js` 会从服务端卡片/实验元数据中保留 `taskScenario`，并随反馈事件回传。
- 已完成机器证据：`scripts/check-v6-prompt-quality.js` 新增 `scenarioLearningProbe`，`scripts/critic-v6-prompt-quality.ps1` 已把它纳入硬门。
- 已验证：`node scripts\check-v6-prompt-quality.js` PASS；`npm test` in `apps/local-service` PASS；`npm test` in `prototypes/browser-extension` PASS；完整 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v6-prompt-quality.ps1` PASS，输出 `V6_PROMPT_QUALITY_PASS`。
- `git diff --check` 仅报告既有 LF/CRLF 工作区提示，无 whitespace error。

## V6 outcome 反哺策略 P7 进度 2026-06-08

- 已完成 outcome-aware prompt strategy policy：`packages/shared/prompt-quality.js` 新增 `outcomePolicy`，`buildPromptStrategyPlan(metrics, context, feedbackProfile, experimentOutcomeReport)` 会在可比实验结果足够明确时选择 `prefer_strategy_guided` 或 `baseline_structure`，策略版本提升为 `v6-strategy-policy@3`。
- 已接入生成链路：local-service `/generate` 现在把 `experimentOutcomeReport/Text` 传入 prompt strategy、template fallback、真实 LLM message 和生成 card；prompt history 只保存 outcome status/decision/recommendation/comparable 等安全元数据。
- 已接入 shared core：template prompt 和 LLM messages 都包含 `Local experiment outcomes`，让 aggregate outcome 真正影响下一次 prompt，而不只停留在诊断报告。
- 已补机器证据：`scripts/check-v6-prompt-quality.js` 新增 `outcomeFeedbackProbe`，覆盖 strategy-guided 胜出和 strategy-guided 变差回退 baseline 两条分支；`scripts/critic-v6-prompt-quality.ps1` 已把该 probe 纳入 gate。
- 已验证：语法检查 PASS；`node scripts\check-v6-prompt-quality.js` PASS；`npm test` in `apps/local-service` PASS；`npm test` in `prototypes/browser-extension` PASS；完整 `scripts\critic-v6-prompt-quality.ps1` PASS；`git diff --check` 仅有 LF/CRLF 提示。
- 已记录 OMX verdict：`smart-prompt-v6-p7-outcome-feedback-policy -> pass`。active goal 仍保持 active，因为完整目标还需要真实内测样本和真实任务 outcome 证明。

## V6 提示词实验闭环 P6 进度 2026-06-08

- 已完成 `v6-prompt-experiment@1`：`packages/shared/prompt-quality.js` 新增确定性 bucket 分组、`buildStrategyExperimentAssignment`、`buildExperimentOutcomeReport` 和 `formatExperimentOutcomeReport`。
- 已接入生成链路：local-service `/generate` 会生成 `experimentAssignment`；baseline arm 会留出策略洞察，其他 arm 使用策略指导；生成卡片、`qualityExperiment` 和 prompt history 都会记录实验元数据。
- 已接入反馈与聚合：browser extension 会把 promptStrategy、experiment arm、comparisonKey、strategy insight readiness 随 Insert/Save/Retry/Undo 回传；local-service metrics 新增 `byExperimentArm`。
- 已接入诊断：新增 `GET /metrics/experiment-outcomes`，`/diagnostics/export` 包含 `experimentOutcomeReport` 和 `experimentOutcomeText`。
- 已补机器证据：`scripts/check-v6-prompt-quality.js` 新增 `experimentOutcomeProbe`，`scripts/critic-v6-prompt-quality.ps1` 将其纳入 gate；OMX 阶段 mission `smart-prompt-v6-p6-experiment-outcome-loop` 已记录 pass verdict。
- 已验证：语法检查 PASS；`node scripts\check-v6-prompt-quality.js` PASS；`npm test` in `apps/local-service` PASS；`npm test` in `prototypes/browser-extension` PASS；完整 `scripts\critic-v6-prompt-quality.ps1` PASS；`git diff --check` 只有 LF/CRLF 提示。
- 当前 active goal 仍不标记 complete：还需要真实内测样本和真实任务 outcome，对照组数据达到可比较样本量后才能判断提示词能力是否实际提升。

## V6 提示词策略洞察 P5 进度 2026-06-08

- 已完成隐私安全的 `strategyInsights` 层：`packages/shared/prompt-quality.js` 新增 `buildStrategyInsights` / `formatStrategyInsights`，基于本地 `byStrategy` 聚合输出可靠样本、低样本探索、风险策略、mode/tool/adapter/site cohort、推荐动作和隐私边界。
- 已接入生成链路：local-service `/generate` 会把 `strategyInsights` 与 `strategyInsightsText` 传给 template 和真实 LLM，上游 prompt 里出现 `Local strategy insights`，生成卡片也返回同一份洞察。
- 已接入服务接口和诊断：新增 `GET /metrics/strategy-insights`，`/diagnostics/export` 也包含 `strategyInsights` 与格式化文本；指标里的 `site` 会收窄到 host，避免误传完整 URL 路径。
- 已补齐机器证据：`scripts/check-v6-prompt-quality.js` 新增 `strategyInsightsProbe`，`scripts/critic-v6-prompt-quality.ps1` 已把该 probe 纳入 gate；OMX 阶段 mission `smart-prompt-v6-p5-strategy-insights` 已记录 pass verdict。
- 已验证：`node scripts\check-v6-prompt-quality.js` PASS；`npm test` in `apps/local-service` PASS；`npm test` in `prototypes/browser-extension` PASS；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v6-prompt-quality.ps1` PASS；`git diff --check` 仅有 LF/CRLF 提示。
- 当前 active goal 仍不能标记 complete：P5 证明了本地策略洞察和回灌链路，但还没有真实长期内测样本、A/B 或策略版本效果对照。

## V6 提示词质量能力 P2 进度 2026-06-08

- 已完成生成-反馈实验链路：`packages/shared/prompt-quality.js` 新增 `buildQualityExperiment`，每次生成会派生 `generationId`、`strategyId`、`qualityScore`、`feedbackConfidence` 和 directive keys；该结构只保存元数据，不保存 prompt 正文或用户输入正文。
- 已接入 local-service `/generate`：返回的 card 现在带 `generationId`、`strategyId`、`qualityExperiment`，prompt history 也保存同一组 ID、质量分、promptLength 和反馈置信度，方便后续按生成策略追踪效果。
- 已接入本地 metrics 聚合：`apps/local-service/src/store.js` 的 `recordMetric` 会保存生成元数据，`getMetrics()` 新增 `byStrategy`，可按策略统计 events、cardReady、insertAttempts、verifiedInserts、saves、retries、undos、avgQualityScore、avgPromptLength、insertSuccessRate、saveRate、retryUsageRate、undoUsageRate。
- 已接入浏览器扩展反馈：`prototypes/browser-extension/src/content.js` 会把当前卡片的 generation meta 附加到 `card_ready`、`insert`、`save`、`retry`、`undo` 等反馈事件；本地模板无服务端评分时使用保守基线分 0.72，仅用于聚合，不作为真实 LLM 质量证明。
- 已补充机器证据：`scripts/check-v6-prompt-quality.js` 新增 `qualityExperimentProbe`，验证 generationId/strategyId/qualityScore/directive link/redaction；`scripts/critic-v6-prompt-quality.ps1` 已把该 probe 纳入验收。
- 已验证：`node scripts\check-v6-prompt-quality.js` PASS；`npm test` in `apps/local-service` PASS；`npm test` in `prototypes/browser-extension` PASS；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v6-prompt-quality.ps1` PASS；`git diff --check` 仅有 LF/CRLF 提示。
- 已记录 OMX 阶段 verdict：`smart-prompt-v6-p2-quality-experiment-metrics` 为 `pass`，证据为 `research/v6-prompt-quality.latest.json` 与完整 V6 critic。
- 当前状态：V6 P0/P1/P2 已完成到“可生成、可评分、可按反馈策略追踪”的程度；active goal 仍不能标记 complete，因为还缺真实用户/真实站点长期采纳率、A/B 对比、按工具/场景持续学习权重和失败样本回灌验证。

## V6 提示词质量能力 P0 进度 2026-06-08

- 已完成结构化真实 LLM 生成协议：`packages/shared/smart-prompt-core.js` 的 `buildLlmMessages` 会要求 LLM 输出 JSON，并强调三模式输出边界、可直接复制、验收标准、缺失信息和隐私备注。
- 已完成 LLM 结果解析与质量评分：`packages/shared/llm-gateway.js` 会使用 `parseStructuredLlmResponse` 抽取 `finalPrompt`，并给生成卡片附加 `structuredOutput` 与 `quality`。
- 已完成本地反馈摘要接入：`apps/local-service/src/server.js` 会从 metrics 生成 `feedbackSummary`，传入 LLM/template，并把 `qualityScore` 写入 prompt history；`apps/local-service/src/store.js` 已支持保存该字段。
- 已完成 V6 P1 反馈画像：`packages/shared/prompt-quality.js` 新增 `buildFeedbackProfile` 和 `formatFeedbackProfile`，把本地聚合 metrics 转成 `confidence`、rates、directives 和 privacy 标记；directives 覆盖 retry 偏高、undo 偏高、保存率偏低/偏高、adapter 插入失败、`after_write_mismatch`、`insert_failed`、`user_retry_requested` 等情况。
- 已把反馈画像接入生成：`apps/local-service/src/server.js` 会把 `feedbackProfile`/`feedbackProfileText` 传给 LLM/template，并把 `card.feedbackProfile` 返回；prompt history 会记录 `feedbackConfidence`，不记录 raw prompt/input。
- 已把反馈画像接入 shared core：`packages/shared/smart-prompt-core.js` 的 template fallback 会附加 `Local feedback guidance`，真实 LLM messages 会附加 `Local feedback profile`，并要求应用 directives 但不暴露 raw telemetry。
- 已完成 30 条 V6 质量评测集与脚本：`research/v6-prompt-quality-fixtures.json` 覆盖 idea/continue/polish、ChatGPT/Claude/Gemini/Lovable/Codex、代码、安全、UI、测试、发布、隐私、adapter 等场景；`scripts/check-v6-prompt-quality.js` 会输出隐私脱敏报告。
- 已修复浏览器扩展手动模式切换：`prototypes/browser-extension/src/prompt-engine.js` 现在尊重 `context.mode`，`content.js` 渲染时不会让旧服务响应或返回 card mode 重置用户选择。
- 已修复 runtime demo 测试环境污染：`prototypes/browser-extension/tests/runtime-demo.test.js` 现在用随机端口启动隔离 local-service，并通过 demo query 注入 `serviceUrl`，不再误连真实桌面服务。
- 已验证：`node scripts\check-v6-prompt-quality.js` PASS，报告包含 `feedbackProfileProbe.hasAdaptiveDirectives:true`、`promptIncludesGuidance:true`、`profileTextRedacted:true`；`npm test` in `apps/local-service` PASS；`npm test` in `prototypes/browser-extension` PASS；语法检查 PASS；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v6-prompt-quality.ps1` PASS，输出 `V6_PROMPT_QUALITY_PASS`。
- 已记录 OMX 阶段性 mission：`smart-prompt-v6-p0-prompt-quality`，verdict 为 `pass`，artifact 为 `research/v6-prompt-quality.latest.json`。
- 已记录 OMX 阶段性 mission：`smart-prompt-v6-p1-feedback-profile`，verdict 为 `pass`，artifact 为 `research/v6-prompt-quality.latest.json`。
- 当前状态：V6 P0/P1 基础已完成，但 active goal 还不能标记 complete，因为还没做真实使用 A/B 对比、长期个性化权重学习、真实用户失败样本回灌和线上采纳效果验证。

## M3 beta adapter 与桌面输入收口更新 2026-06-08

- 用户已更正范围：workBuddy、Trae 是本地工具，不作为网页 adapter 跑；DeepSeek 本轮不跑；网页 beta pilot 只验证已登录豆包。
- 已用用户现有 Chrome 登录态验证 `https://www.doubao.com/chat/`：页面有可见 textarea composer，完成 1 次真实填入回读和 no-auto-send 检查，测试文本已在取证后清空。
- 已刷新 `research/m3-pilot-adapters.latest.json`：当前 `pass:true`，siteIds 只有 `doubao`，1 次 Insert attempt、1 次成功、success rate 1.0；报告只保存 redacted URL、长度/hash、候选数量和布尔状态，不保存 prompt 正文或输入框正文。
- `scripts/critic-m3.ps1` 已改为审计豆包登录态报告，不再自动用 headless 覆盖登录态证据，也不再要求 workBuddy/Trae/DeepSeek 出现在网页矩阵里。
- 当前 active goal 两条要求均有机器证据：真实 beta adapter 数据已跑出成功率，当前豆包无失败；Codex、Claude Code、Hermes 真实桌面输入矩阵已 3/3 写入验证并 no-auto-submit。

## M3 真实桌面 Codex 填入验证更新 2026-06-08

- 用户明确要求不要把新开的命令行窗口当作真实桌面工具端验收；本轮已移除刚生成的 CLI-window smoke 脚本与证据，不把 Windows Terminal/PowerShell 受控窗口计入 M3 完成。
- `scripts/check-m3-real-desktop-tools.ps1` 已改为支持 `-AttachExistingWindow -AttachProfile <profile>`，只 attach 到已经打开的真实桌面窗口；不会启动命令行窗口，报告只保存标题长度/hash、工具画像、候选数量和写入验证摘要。
- 已在真实 `Codex.exe` 桌面窗口上跑通受控填入：`research/m3-real-desktop-tools.latest.json` 为 `pass:true`，`write.attempted:true`，`write.verified:true`，`strategy:"clipboard_paste_fallback"`，`textPatternVerificationMatched:true`，`clipboardRestored:true`，`autoSubmit:false`，`submitSignalCount:0`。
- 为了验证 Codex WebView/Document 类输入区，将 TextPattern 验证读取上限从 8192 提升到 65536；仍只做匹配判断并保存长度/hash，不保存验证文本原文。
- 已继续完成 Claude Code 与 Hermes：`research/m3-real-desktop-tools-fill-matrix.latest.json` 为 `pass:true`，Codex/Claude Code/Hermes 均 `writeAttempted:true`、`writeVerified:true`、`textPatternVerificationMatched:true`、`noAutoSubmit:true`。Codex 使用 `clipboard_paste_fallback`，Claude Code/Hermes 使用 `uia_value_pattern`。

## M3 caret/focus 输入信号更新 2026-06-08

- 已回答“能否通过光标或输入强关联指标识别”的问题：可以作为候选排序强信号，但不能单独作为真实工具写入许可。
- 已为 `scripts/check-m3-desktop-input.ps1` 新增 `inputSignals`、`caret`、`bestCandidateIndex`、`bestCandidateScore`、`focusedCandidateCount`、`caretCandidateCount` 等字段；报告仍不读取输入值或 prompt 正文。
- 已把同类信号穿过 local-service sanitizer，并在 `apps/local-service/tests/local-service.test.js` 与 `scripts/critic-m3.ps1` 中加断言，防止 cursor/focus 证据回归丢失。
- 已验证最小链路：`check-m3-desktop-input.ps1 -SelfTest -JsonOnly` PASS；`check-m3-desktop-fill.ps1 -SelfTest -JsonOnly` PASS；`node -c apps/local-service/src/desktop-input-detector.js` PASS。
- 已复跑完整 `scripts/critic-m3.ps1` PASS，并记录 OMX verdict pass；Codex goal 仍保持 active，因为真实三工具写回尚未完成。
- 真实 Codex 前台 snapshot 显示：候选数 116，`focusedCandidateCount:1`，`caretCandidateCount:0`，`caretVisible:false`，`bestCandidateIndex:0` 仍是超大 `ControlType.Document`；这解释了为什么仍不能直接把它当输入框写入。
- 仍未完成：Codex/Claude Code/Hermes 真实工具窗口的安全填入成功率和失败原因还没有最终验收。

## M3 剪贴板 fallback 更新 2026-06-08

- 已解释并修复“工具内输入框一直识别不到”的主要技术缺口：桌面/CLI 工具常把输入区放在 Terminal、WebView 或自绘容器中，Windows UIA 可能只能看到宿主容器，无法暴露标准 `ValuePattern` 或原生 Edit 控件。
- 已为 `scripts/check-m3-desktop-fill.ps1` 新增显式 `-AllowClipboardFallback`；该路径使用临时剪贴板文本粘贴，随后恢复原剪贴板，报告只保存长度/hash，不保存写入原文，也不发送 Enter/submit。
- 已将 `allowClipboardFallback` 接入 local-service `POST /desktop/fill`、native sidecar `/desktop/fill`、sanitizer 和本地服务测试；真实前台窗口仍必须匹配 `confirmForeground`、`expectedTitleHash` 与 `expectedToolProfile` 才会尝试写入。
- 新增证据 `research/m3-desktop-fill-clipboard.latest.json`，当前 `pass:true`、`strategy:"clipboard_paste_fallback"`、`clipboardFallbackTried:true`、`clipboardRestored:true`；`research/m3-desktop-fill.latest.json`、`research/m3-sidecar-desktop-fill.latest.json`、`research/m3-installed-sidecar-desktop-input.latest.json` 已同步新增隐私字段。
- 已为 `scripts/check-v4-installer-smoke.ps1` 加一次启动重试，解决安装后 app 偶发 5 秒内退出导致 smoke 误失败的问题；完整 `scripts/critic-m3.ps1` 已复跑并 PASS，OMX verdict 已记录 pass。
- 仍未完成：Codex/Claude Code/Hermes 真实工具窗口内写回成功率和剪贴板 fallback 成功率尚未验收；本轮没有对真实前台工具窗口执行写入，只做 self-test 和受控接口链路。
- 本轮继续推进：`scripts/check-m3-real-desktop-tools.ps1` 现在会把 `-AllowClipboardFallback` 传入真实前台写入桥；新增 `research/m3-real-desktop-clipboard-guard.latest.json`，证明即使开启真实写入与 clipboard fallback，只要 title hash 不匹配，也不会尝试写入或粘贴。
- 已新增超大 `ControlType.Document` 候选直写阻断：真实 Codex 前台候选 0 是全窗口 Document，`research/m3-desktop-fill-direct-guard.latest.json` 证明 hash/profile 匹配时也会返回 `foreground_candidate_requires_clipboard_fallback`、`directWriteBlocked:true`、`writeAttempted:false`，避免把整页/整窗候选当输入框覆盖。
- 已验证：`npm test` in `apps/local-service` PASS；`scripts/check-m3-desktop-fill.ps1 -SelfTest` PASS；`scripts/check-m3-desktop-fill.ps1 -SelfTest -AllowClipboardFallback` PASS；真实 Codex 前台 direct guard PASS；真实前台 clipboard mismatch guard PASS；完整 `scripts/critic-m3.ps1` PASS；OMX verdict 已记录 pass。

## M3 桌面写回与 PRD 状态 2026-06-07

- 用户已更新当前 M3 范围：先不做 macOS AX，本阶段只追 Windows UIA 桌面输入框识别与真实 adapter pilot 数据。
- 本轮已新增真实前台工具窗口 snapshot-only 审计：`scripts/check-m3-real-desktop-tools.ps1` 生成 `research/m3-real-desktop-tools.latest.json`，当前 `pass:true`，真实前台窗口检测为 `codex`，UIA 候选数 116，`writeAttempted:false`，`completionImpact:"real_tool_write_still_pending"`；报告只保存 title hash/length、候选数量和隐私布尔项，不保存 raw title/input/prompt。
- 本轮已新增三工具画像 self-test：`scripts/check-m3-desktop-input.ps1` 支持 `-SelfTestProfile codex|claude-code|hermes`；`scripts/check-m3-desktop-tool-profiles.ps1` 生成 `research/m3-desktop-tool-profiles.latest.json`，当前 `pass:true`，Codex/Claude Code/Hermes 三项均检测到正确工具画像、至少 1 个 UIA 候选，且不保存 raw title/raw input。
- 本轮已补齐受控前台窗口写回协议：真实窗口写入必须显式传 `confirmForeground:true`，并同时匹配 `expectedTitleHash` 与 `expectedToolProfile`；不满足时返回 `writeAttempted:false`，避免误写当前前台窗口。
- 已新增 guard evidence：`research/m3-desktop-fill-guard.latest.json` 当前按预期 `pass:false`、`reason:"foreground_title_hash_mismatch"`、`writeAttempted:false`，证明 title hash 不匹配时不会写入，也不会保存 raw text。
- 本轮已补齐 Windows 桌面写回 self-test：`scripts/check-m3-desktop-fill.ps1` 生成 `research/m3-desktop-fill.latest.json`，当前 `pass:true`；写入策略为 `win32_set_window_text_fallback`，已验证写入和回读 hash/length，不保存写入文本原文，不自动提交。
- 已补齐 local-service `POST /desktop/fill`，并在 `apps/local-service/tests/local-service.test.js` 覆盖 auth、工具画像、隐私脱敏和“不泄露 raw text”。
- 已补齐 native sidecar `POST /desktop/fill`，并新增 `scripts/check-m3-sidecar-desktop-fill.ps1`；`research/m3-sidecar-desktop-fill.latest.json` 当前 `pass:true`。
- 已补齐安装包 bundled sidecar fill smoke：`prepare-sidecar.js` 会打包 `check-m3-desktop-fill.ps1`，`research/m3-installed-sidecar-desktop-input.latest.json` 当前 `pass:true`，包含 `desktopFillFromInstalledSidecar`、`desktopFillSelfTestPass`、`desktopFillPrivacyRedacted`。
- 已同步 `docs/prd.md` 与 `docs/m3-desktop-input.md`：PRD 当前是 v0.2 beta 收口版；M3 标记为进行中，Windows self-test/snapshot/fill、三工具画像 self-test、真实 Codex 前台 snapshot-only 审计、受控前台写回 guard 和 sidecar 链路已通过；真实 Codex/Claude Code/Hermes 工具窗口写回仍待完成，macOS AX 暂缓到后续跨平台阶段。
- 已验证：`scripts/check-m3-real-desktop-tools.ps1` PASS；`npm test` in `apps/local-service` PASS；`npm test` in `apps/desktop-shell` PASS；`cargo check` in `apps/local-service-sidecar` PASS；`scripts/check-m3-desktop-fill.ps1 -SelfTest` PASS；`scripts/check-m3-sidecar-desktop-fill.ps1` PASS；`scripts/check-m3-installed-sidecar-desktop-input.ps1` PASS；`scripts/critic-m3.ps1` PASS；`git diff --check` PASS。
- 历史四站网页矩阵已被最新用户范围取代：workBuddy、Trae 走本地工具路径，DeepSeek 本轮不跑，网页 pilot 只保留豆包登录态证据。

## M3 Pilot 与桌面输入识别进度 2026-06-07

- 已创建 OMX autoresearch-goal mission：`smart-prompt-m3-pilot-metrics-and-desktop-input-`，critic 命令为 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-m3.ps1`。
- 已新增 M3 beta adapter pilot 入口：`scripts/check-m3-pilot-adapters.ps1`，它会生成 `research/m3-pilot-adapters.latest.json`；最新默认范围已收窄为豆包登录态网页，记录 Insert attempts、成功率、失败原因和 redaction 检查。
- 已跑真实 beta pilot：正式扩展加载成功，4 个新站点均尝试 Insert；当前 Insert 成功率为 0。失败原因已从单一 `no visible input candidate` 细化为 `no_input_candidates_on_loaded_page: 2`、`public_or_marketing_page_no_visible_composer: 1` 与 `login_or_auth_gate_no_visible_composer: 1`，每站带 `pageClassification`、`routeDiagnostics` 与 `routeMatrix`。这不是 M3 完成，只是明确了下一步需要登录态/正确 composer 路由/selector 修复。
- 已新增 Windows UIA 桌面输入识别 self-test：`scripts/check-m3-desktop-input.ps1 -SelfTest` 会创建临时 TextBox 并用 UIA 枚举候选，生成 `research/m3-desktop-input.latest.json`；当前报告 `pass:true`，候选数 1，检测到 Codex 工具画像。
- 已新增开发路径 local-service 接口：`GET /desktop/input-snapshot` 和 `?selfTest=1`，受 auth 保护；返回窗口 title hash/length、UIA 候选和工具画像，不返回标题原文、元素原文或输入值。
- 已新增 native sidecar 等价接口：`GET /desktop/input-snapshot` 和 `?selfTest=1`；Windows source/dev 路径通过 PowerShell UIA bridge 调用 `scripts/check-m3-desktop-input.ps1`，非 Windows 返回 guarded pending。
- 已新增 sidecar smoke：`scripts/check-m3-sidecar-desktop-input.ps1`，生成 `research/m3-sidecar-desktop-input.latest.json`；当前报告 `pass:true`，证明 native sidecar health/auth/snapshot 全链路可用且 dataDir 已脱敏。
- 已补安装包内 M3 sidecar 复验：`apps/desktop-shell/scripts/prepare-sidecar.js` 会把 `check-m3-desktop-input.ps1` 打入 sidecar resources；`scripts/check-m3-installed-sidecar-desktop-input.ps1` 生成 `research/m3-installed-sidecar-desktop-input.latest.json`，当前 `pass:true`，证明安装后 app 能启动 bundled native sidecar 并调用 `desktop/input-snapshot?selfTest=1`。
- 已同步 `docs/prd.md` 的 M3 状态：从“下一阶段”改为“进行中”，明确 Windows UIA/source-dev、native sidecar snapshot、安装包 bundled sidecar snapshot 和三工具画像 self-test 已通过；真实桌面写回仍待完成，macOS AX 暂缓。
- 已新增 `packages/shared/desktop-tool-profiles.js`，覆盖 Codex、Claude Code、Hermes；VS Code/Windows Terminal/PowerShell/cmd 仅作为宿主，不会单独误报。
- 已新增文档：`docs/m3-desktop-input.md`，明确 Windows UIA 已有可运行竖切，macOS AX 仍是 guarded/pending，不伪装完成。
- 已验证：`npm test` in `prototypes/browser-extension` PASS；`npm test` in `apps/local-service` PASS；`npm test` in `apps/desktop-shell` PASS；`scripts/check-m3-desktop-input.ps1 -SelfTest` PASS；`scripts/check-m3-desktop-tool-profiles.ps1` PASS；`scripts/check-m3-sidecar-desktop-input.ps1` PASS；`scripts/check-m3-installed-sidecar-desktop-input.ps1` PASS；`scripts/check-m3-pilot-adapters.ps1 -Headless` PASS；`scripts/critic-m3.ps1` PASS。
- 已记录 OMX professor-critic verdict `pass`，证据为 `research/m3-pilot-adapters.latest.json`、`research/m3-desktop-input.latest.json`、`research/m3-sidecar-desktop-input.latest.json`、`research/m3-installed-sidecar-desktop-input.latest.json`；Codex goal 仍保持 active，因为 M3 总目标尚未完成。
- 本批收口范围：安装包内 M3 desktop snapshot resource 打包、installed sidecar smoke、M3 critic/report、M3 文档与 PRD 状态同步。
- 仍未完成：Codex/Claude Code/Hermes 真实桌面输入框写回未验收；新 beta 站点尚未在登录态/真实 composer 中拿到成功 Insert；macOS AX 已按用户要求移出当前阶段。

## V5 PRD 与发布资产收尾 2026-06-07

- 已把 `docs/prd.md` 从 `v0.1` 草案更新为 `v0.2 beta` PRD，补入 V5 已完成项、验收证据、安装包路径、native sidecar、真实 LLM/provider、pilot 指标、里程碑状态和后续 M3 范围。
- 已确认并纳入用户的工具范围修改：目标用户行包含 workBuddy、Trae、Doubao、DeepSeek、Hermes，并把 Codex/Claude Code/Hermes 作为桌面/CLI 工具画像进入 M3。
- 已创建 GitHub Release：`https://github.com/mumu-github/smart-prompt/releases/tag/v0.2.0-beta.1`，并上传 MSI、NSIS exe、`v5-beta-checksums.sha256` 三个 assets。
- 已补 beta 站点适配：浏览器扩展和 shared core 新增 workBuddy、Trae、Doubao、DeepSeek；manifest 与测试已同步。Codex/Claude Code/Hermes 已补工具画像，不冒充网页 adapter。
- 已补真实内测 metrics 链路：扩展把 `card_ready`、`insert`、`save`、`retry`、`undo` 等 privacy-safe feedback 上报到 `/metrics`；local-service 和 native sidecar 汇总 Insert 成功率、保存率、Undo/Retry 使用率、adapter 失败率、失败原因。
- 已验证：`npm test` in `prototypes/browser-extension` PASS；`npm test` in `apps/local-service` PASS；`C:\Users\lhy10\.cargo\bin\cargo.exe check` in `apps/local-service-sidecar` PASS；`git diff --check` 无空白错误。
- 已提交并推送：`b93e227 Close V5 beta PRD and pilot metrics`。
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
# 当前任务进度 2026-06-08

- 已修复 Prompt Card 离线状态重复追加：`localService.generate` 的失败分支现在校验 `requestId` 与当前输入文本，旧请求失败不会再改当前卡片；离线 context 采用覆盖式渲染，不再用字符串追加。
- 已修复扩展自身输入框误识别：content script 现在忽略 `#smart-prompt-card`、`#smart-prompt-mascot`、`#smart-prompt-undo` 内的 focus/input，避免编辑卡片输出时把扩展自己的 textarea 当目标输入框。
- 已增强豆包 adapter：新增 `textarea.semi-input-textarea`、`发消息`、`按住空格`、`消息` placeholder selector，同步到 browser extension 与 shared core。
- 已用用户现有 Chrome 豆包 tab 只读确认：`https://www.doubao.com/chat/` 当前有可见 `textarea` composer，但该 tab 中 `smartPromptLoaded:false`、`mascotPresent:false`，说明问题不是没有输入框，而是当前 Chrome tab 未加载 Smart Prompt 内容脚本；需要重新加载 unpacked extension 并刷新豆包页面。
- 已验证：`npm test` in `prototypes/browser-extension` PASS；`npm test` in `apps/local-service` PASS。

- 已收敛浏览器扩展 Prompt Card 尺寸：卡片最大宽度从 460px 收到 380px，最大高度收到 430px，输出区、按钮、evidence、chip 和 mascot 同步压缩；本地 demo 视觉 smoke 记录卡片约 380x366。
- 已补 Prompt Card 国际化：内容脚本支持 `zh-CN` 与 `en`，标题、模式、状态、按钮、依据/隐私/来源、Undo toast 都走语言表；新增选项页 `uiLocale` 设置，支持自动、中文、English。
- 已补扩展 manifest 标准 `_locales/en` 与 `_locales/zh_CN`；扩展名称和描述可随浏览器 locale 展示。
- 已补模板国际化：浏览器本地 `prompt-engine` 和 shared core 均支持 `context.locale`，英文 locale 会生成英文 prompt 模板，中文保留原有中文输出。
- 已验证：`npm test` in `prototypes/browser-extension` PASS；`npm test` in `apps/local-service` PASS；中文/英文本地 demo 视觉 smoke 均通过。
# 当前任务进度 2026-06-08

- 已修复 Smart Prompt 桌面端双窗口问题：`apps/desktop-shell/src-tauri/src/main.rs` 增加 Windows GUI 子系统声明，release 版不再按控制台程序启动。
- 已加固本地 sidecar 启动：Windows 下使用 `CREATE_NO_WINDOW` 创建本地服务进程，避免点击 Start Service 后再弹控制台窗口。
- 已补 `apps/desktop-shell/tests/desktop-shell.test.js` 静态回归断言，覆盖 `windows_subsystem`、`CREATE_NO_WINDOW` 和 `creation_flags(CREATE_NO_WINDOW)`。
- 已验证：`npm test` in `apps/desktop-shell` PASS；`cargo check --manifest-path apps\desktop-shell\src-tauri\Cargo.toml` PASS；`npm run build` in `apps/desktop-shell` PASS；新 release exe 的 PE Subsystem 为 `2 Windows GUI`。
# 当前任务进度 2026-06-08

- V6 P3 已完成提示词策略规划闭环：`packages/shared/prompt-quality.js` 新增 `buildPromptStrategyPlan` / `formatPromptStrategyPlan`，会从 `metrics.byStrategy` 中按模式、成功率、保存率、重试/撤销/失败原因选择 `insert_safe_compact`、`acceptance_heavy`、`preserve_winning_strategy` 或 `cold_start_structure`。
- 策略规划已进入生成链路：local-service `/generate` 会把 `promptStrategyPlan` 和 `promptStrategyText` 传给 template 与真实 LLM，并把 `promptStrategyId` 写入 `qualityExperiment` 和 prompt history；浏览器扩展后续反馈可继续回流到同一策略。
- 机器证据已补齐：`scripts/check-v6-prompt-quality.js` 的 `promptStrategyProbe` 通过，最新 `research/v6-prompt-quality.latest.json` 为 `pass:true`；`scripts/critic-v6-prompt-quality.ps1` 输出 `V6_PROMPT_QUALITY_PASS`。
- OMX 阶段 verdict 已记录为 pass：`smart-prompt-v6-p3-prompt-strategy-planning`。
- 当前 V6 仍不应标记总 goal complete：还缺真实内测的 byStrategy 样本量、A/B 或策略版本对比、按工具/站点/任务场景的长期采纳率验证。
# 当前任务进度 2026-06-08

- V6 P4 已完成策略探索保护：`buildPromptStrategyPlan` 现在带 `v6-strategy-policy@2`，包含最小候选样本数、可靠样本阈值、探索率、低样本策略保护和 selectedStrategy decision。
- 低样本高分策略不再直接成为默认胜出策略；当样本不足时会保留 `cold_start_structure`，开启 exploration，并加入 `collect_more_samples` directive，避免早期偶然成功被固化。
- 策略聚合已补充 cohort 维度：local-service `byStrategy` 会记录 modes/tools/adapters/sites 计数；策略候选会标记是否匹配当前 mode/tool/adapter。
- `qualityExperiment` 和 prompt history 已记录 `promptStrategyVersion`，后续可以比较不同策略版本的 Insert/Save/Retry/Undo 表现。
- 机器证据已通过：`node scripts\check-v6-prompt-quality.js` PASS；`npm test` in `apps/local-service` PASS；`npm test` in `prototypes/browser-extension` PASS；`scripts/critic-v6-prompt-quality.ps1` PASS 并输出 `V6_PROMPT_QUALITY_PASS`；`git diff --check` 只有 LF/CRLF 警告。
- OMX 阶段 verdict 已记录为 pass：`smart-prompt-v6-p4-strategy-exploration-guard`。
# V6 P14 策略调权进度 2026-06-08

- 已完成 `packages/shared/prompt-quality.js` 的 `buildStrategyWeightPolicy` / `formatStrategyWeightPolicy`，版本为 `v6-strategy-weighting@1`，可从 pilot outcome readiness 聚合报告生成 promoted、suppressed、exploring 三类策略权重。
- 已完成策略计划接入：`buildPromptStrategyPlan` 会读取权重政策，优先提升 ready 高成功 outcome winner，压低 ready 低成功 outcome risk，并对 collecting 策略保持探索采样。
- 已完成生成链路接入：`apps/local-service/src/server.js` 在 `/generate` 中生成并传递 `strategyWeightPolicy/strategyWeightText`，返回 card、诊断导出、prompt history 也保留权重元数据；新增 `GET /metrics/strategy-weights`。
- 已完成 shared core 接入：`packages/shared/smart-prompt-core.js` 的 template fallback 与 `buildLlmMessages` 均包含 `Local strategy weights` 聚合指导。
- 已完成机器证据：`scripts/check-v6-prompt-quality.js` 新增 `strategyWeightProbe`；`scripts/critic-v6-prompt-quality.ps1` 将该 probe 纳入硬门槛。
- 已验证：`node -c` 相关文件 PASS；`node scripts\check-v6-prompt-quality.js` PASS；`npm test` in `apps/local-service` PASS；完整 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v6-prompt-quality.ps1` PASS，输出 `V6_PROMPT_QUALITY_PASS`；`git diff --check` exit 0，仅 LF/CRLF warning。
- 已记录 OMX verdict：`smart-prompt-v6-p14-outcome-driven-strategy-weig -> pass`。
# V6 P15 质量提升验证进度 2026-06-08

- 已完成 `packages/shared/prompt-quality.js` 的 `buildPromptQualityLiftReport` / `formatPromptQualityLiftReport`，版本为 `v6-quality-lift@1`。
- 已完成 feedback 元数据回流：`qualityExperiment`、浏览器扩展 `recordFeedbackEvent`、local-service `recordMetric/getMetrics` 均支持 strategy weight metadata 和 `qualityLiftCohort`，并新增 `byQualityLiftCohort` 聚合。
- 已完成 local-service 接入：新增 `GET /metrics/prompt-quality-lift`，诊断导出与 `/generate` 注入 `promptQualityLiftReport/Text`，生成卡片与 prompt history 记录质量提升状态。
- 已完成 shared core 接入：本地模板和真实 LLM messages 都会包含 `Local quality lift`，用于指导继续采样、保留 outcome 加权或回退审查。
- 已完成机器证据：`qualityLiftProbe` 覆盖 positive lift、regression、collecting、template/LLM 注入和敏感文本不泄露；OMX mission `smart-prompt-v6-p15-quality-lift-report` 已记录 pass verdict。
- 已验证：`node -c` 相关文件 PASS；`node scripts\check-v6-prompt-quality.js` PASS；`npm test` in `apps/local-service` PASS；完整 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v6-prompt-quality.ps1` PASS；`git diff --check` exit 0，仅 LF/CRLF warning。
# V6 P18 Quality Lift 分段归因进度 2026-06-08

- 已完成 shared 聚合：`packages/shared/prompt-quality.js` 新增 `PROMPT_QUALITY_LIFT_SEGMENTS_REPORT_VERSION`、`buildPromptQualityLiftSegmentsReport` 和 `formatPromptQualityLiftSegmentsReport`，复用 P15 的 baseline/strategy-guided/outcome-weighted 比较规则。
- 已完成 local-service 接入：`GET /metrics/prompt-quality-lift-segments` 返回分段报告，`/diagnostics/export` 导出分段报告与格式化文本；local-service 测试覆盖 endpoint、diagnostics、四维度和隐私边界。
- 已完成桌面壳面板：`Quality Segments` 展示 improving、regressing、collecting segment；初始加载、诊断导出、手动刷新和 outcome 补标后刷新均已接入。
- 已完成 critic 加固：`scripts/check-v6-prompt-quality.js` 新增 `qualityLiftSegmentsProbe`，`scripts/critic-v6-prompt-quality.ps1` 将 P18 纳入硬门槛。
- 已验证：`node -c` 相关文件 PASS；`node scripts\check-v6-prompt-quality.js` PASS；`npm test` in `apps/local-service` PASS；`npm test` in `apps/desktop-shell` PASS；`npm run prepare-dist` PASS；完整 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v6-prompt-quality.ps1` PASS；`git diff --check` 无 whitespace error，仅 LF/CRLF warning。
- 已记录 OMX verdict：`smart-prompt-v6-p18-quality-lift-segments -> pass`。
## V6 P19 Segment-aware 策略策略进度 2026-06-08

- 已完成 shared policy：`packages/shared/prompt-quality.js` 新增 `QUALITY_LIFT_SEGMENT_POLICY_VERSION`、`buildQualityLiftSegmentPolicy`、`formatQualityLiftSegmentPolicy`，根据 P18 segment report 匹配当前 tool/site/taskScenario/mode。
- 已完成策略接入：`buildPromptStrategyPlan` 新增 `qualityLiftSegmentsReportInput` 参数，把 segment policy 写入 `strategyPolicy`、`qualityLiftSegmentPolicy`、`telemetry`、`directives`；regressing segment 会把非硬保护策略压回 `baseline_structure` / `segment_regression_guardrail`。
- 已完成生成链路接入：`apps/local-service/src/server.js` 在 `/generate` 中构建 `promptQualityLiftSegmentsReport/Text` 与 `qualityLiftSegmentPolicy/Text`，传给 template/LLM/card，并写入 prompt history；`/diagnostics/export` 同步导出 policy。
- 已完成 shared core 注入：`packages/shared/smart-prompt-core.js` 的 template fallback 与 `buildLlmMessages` 都会包含 `Local quality lift segment policy`。
- 已完成证据与测试：`scripts/check-v6-prompt-quality.js` 新增 `qualityLiftSegmentPolicyProbe`，`scripts/critic-v6-prompt-quality.ps1` 增加硬门槛；`apps/local-service/tests/local-service.test.js` 覆盖生成/诊断/history/LLM 上下文。
- 已验证：`node -c` 相关文件 PASS；`node scripts\check-v6-prompt-quality.js` PASS；`npm test` in `apps/local-service` PASS；`npm test` in `prototypes/browser-extension` PASS；完整 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v6-prompt-quality.ps1` PASS 并输出 `V6_PROMPT_QUALITY_PASS`；`git diff --check` exit 0，仅 LF/CRLF warning。
- 已记录 OMX verdict：`smart-prompt-v6-p19-segment-aware-strategy-polic -> pass`。
## V6 P20 失败原因 token 策略进度 2026-06-08

- 已完成 shared taxonomy/report/policy：`packages/shared/prompt-quality.js` 新增 `normalizeFailureReasonToken`、`buildFailureReasonReport`、`buildFailureReasonPolicy`、`formatFailureReasonReport`、`formatFailureReasonPolicy`，版本为 `v6-failure-reasons@1` / `v6-failure-reason-policy@1`。
- 已完成策略接入：`buildPromptStrategyPlan` 新增 `failureReasonReportInput` 参数，把 `failureReasonPolicy` 写入 `strategyPolicy`、`telemetry`、`directives` 和格式化策略文本；`insert_failed` 可触发 `insert_safe_compact` guardrail。
- 已完成生成链路接入：`apps/local-service/src/server.js` 在 `/generate` 中构建并传递 `failureReasonReport/Text` 与 `failureReasonPolicy/Text`，返回 card，写入 prompt history，并在 `/diagnostics/export` 导出 aggregate-only policy。
- 已完成存储收窄：`apps/local-service/src/store.js` 会把 raw failure reason 归一化为 canonical `failureReasonToken`，保留少量 legacy 短 token 兼容，但不长期保存用户写入的敏感 raw reason。
- 已完成证据与测试：`scripts/check-v6-prompt-quality.js` 新增 `failureReasonPolicyProbe`，`scripts/critic-v6-prompt-quality.ps1` 增加硬门槛；`apps/local-service/tests/local-service.test.js` 覆盖 metrics、diagnostics、generate、history 和 manual follow-up redaction。
- 已验证：`node scripts\check-v6-prompt-quality.js` PASS，`npm test` in `apps/local-service` PASS，`npm test` in `prototypes/browser-extension` PASS，完整 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v6-prompt-quality.ps1` PASS 并输出 `V6_PROMPT_QUALITY_PASS`，`git diff --check` 只有 LF/CRLF warning。
- 已记录 OMX verdict：`smart-prompt-v6-p20-failure-reason-token-policy -> pass`。
## V6 P21 失败原因短标签 UI 进度 2026-06-08

- 已完成浏览器扩展 Prompt Card 的负向 outcome 原因短标签：点 `failed` 或 `needs-work` 后展开原因行，默认 `low_quality`，点原因后才写入 outcome。
- 已完成 Insert 后 Undo toast 的负向原因短标签：点 `needs-work` 后进入 pending 状态，点 `insert_failed` 等原因后写入 `manual_toast` outcome。
- 已修正成功 outcome 的污染风险：`success` 不再带 `manual_card_success` 这类 failure reason。
- 已补 runtime demo 验收：验证原因行默认隐藏、中文标签存在、成功不带 `failureReasonToken`、`wrong_format`/`insert_failed` 可写入 extension feedback 与 local-service metrics，并且不自动提交、不泄露 prompt 正文。
- 已验证：`npm test` in `prototypes/browser-extension` PASS；`npm test` in `apps/local-service` PASS；`node scripts/check-v6-prompt-quality.js` PASS；`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v6-prompt-quality.ps1` PASS；`git diff --check` 仅 LF/CRLF warning。
- 已记录 OMX verdict：`smart-prompt-v6-p21-feedback-reason-chips -> pass`。

## V6 P22 自学习闭环进度 2026-06-08

- 已完成 shared 聚合能力：`packages/shared/prompt-quality.js` 新增 `buildSelfImprovementReport` / `formatSelfImprovementReport` 与 `buildEvolutionCandidateReport` / `formatEvolutionCandidateReport`，版本分别为 `v6-self-improvement@1` 与 `v6-evolution-candidates@1`。
- 已完成生成链路接入：`packages/shared/smart-prompt-core.js` 的 template fallback 与真实 LLM messages 均包含 `Local self-improvement reflection` 和 `Local evolution candidates`，但只作为 aggregate-only 指导。
- 已完成 local-service 接入：新增 `GET /learning/reflections`、`GET /learning/evolution-candidates`；`/diagnostics/export`、`/generate`、card 与 prompt history 均带上学习报告/候选版本和门控元数据。
- 已完成 critic 加固：`scripts/check-v6-prompt-quality.js` 新增 `selfImprovementProbe`，覆盖 positive/regression/collecting、promote/suppress/failure-repair/collect candidates、redaction、manual review gate 与 no automatic mutation；`scripts/critic-v6-prompt-quality.ps1` 已纳入硬门槛。
- 已验证：`node -c` 相关 JS PASS；`node scripts\check-v6-prompt-quality.js` PASS；`npm test` in `apps/local-service` PASS；`npm test` in `prototypes/browser-extension` PASS；`npm test` in `apps/desktop-shell` PASS；完整 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v6-prompt-quality.ps1` PASS 并输出 `V6_PROMPT_QUALITY_PASS`；`git diff --check` 仅 LF/CRLF warning。
