# 项目入口

更新时间：2026-07-17

## 目标

- 本项目要解决什么问题：Smart Prompt 是输入框旁的上下文提示词编辑器，把当前草稿整理成可审核的提示词，填回原输入框，但永不替用户发送。
- 核心价值：网页和桌面共享“读取草稿、生成或优化、用户审核、填入但不发送”的唯一流程，并在真实 Fill 中坚持 foreground、safe candidate、机器/人工验证和隐私边界。
- 本轮成功标准：阶段 0/1/2 已完成；浏览器 Card 与桌面 Overlay 共同消费 `prompt-session@1` View Model 和 `packages/assistant-ui/`，并通过契约、端侧装配、交互路由和无头浏览器视觉验证。

## 范围

- 做：统一 Prompt Session、浏览器扩展、本地服务、Tauri 桌面壳、native sidecar、真实 LLM gateway、桌面 Overlay、小人交互和受保护 Fill。
- 当前冻结：新增站点、桌面工具、Provider、分析面板、Overlay 控件、macOS AX、团队同步、Prompt Marketplace 和远程运营能力。
- 不做：完整 OS-level copilot、自动发送机器人、默认上传整页/整屏/完整文件、把 Remotion mascot 原型当生产动画资源。
- 需要用户确认：启动/切换桌面壳、真实 overlay click、真实前台写入、WorkBuddy 人工视觉确认、任何需要读取或写入目标工具输入框的操作。

## 当前状态

- 进行中：阶段 2 已完成收口，下一批为阶段 3 桌面控制中心瘦身；M3/P25 仍有真实 runtime 和真实写入闭环缺口，WorkBuddy real fill 不能标为机器验证完成。
- 已完成：共享 Prompt Session、共享 Assistant Card、浏览器 Card 迁移、桌面 Overlay 迁移、双端视觉回归，以及既有 `noAutoSubmit` 写回守卫路由复用。
- 卡点：`research/p25-overlay-click-chain.latest.json` 记录 `pass:false`、`completionReady:false`，缺 runtime readiness、真实 overlay click、verified real target writes。
- 下一步：执行阶段 3，将桌面主窗口收敛为低频控制中心并默认托盘运行；真实 Fill 仍只在 foreground + safe candidate + 明确授权同时成立时执行。

## 关键路径

- 桌面壳：`apps/desktop-shell/`
- 本地服务：`apps/local-service/`
- native sidecar：`apps/local-service-sidecar/`
- 浏览器扩展：`prototypes/browser-extension/`
- 共享核心：`packages/shared/`
- 共享会话：`packages/prompt-session/`
- 共享助手界面：`packages/assistant-ui/`
- 验证脚本：`scripts/`
- 运行证据：`research/`
- 产品与研究文档：`docs/`
- 当前记忆：`agent_memory/context.md`、`agent_memory/progress.md`、`agent_memory/bugs.md`

## 验证

- 命令已验证：共享 UI/Session 契约测试、浏览器扩展全量测试、桌面静态与交互测试、桌面 Session 运行时测试、共享视觉报告、运行时同步 hash、`prepare-dist`、PowerShell parser、`node --check` 和 `git diff --check` 均通过。
- 建议命令：先看 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-m3.ps1`、`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-p25-overlay-click-chain.ps1`、`node scripts/check-p25-overlay-chat-visual.js`。
- GUI 已验证：浏览器 Demo 与桌面离线 Overlay 已通过无头浏览器截图检查；未启动真实 Tauri 前台窗口，也未对真实工具输入框执行写入。
- 线上闭环已验证：不适用；真实 LLM/API provider 可用性需按配置和授权单独验证。
- 未验证及原因：P25 runtime readiness、真实 overlay click、WorkBuddy 机器读回或人工确认、macOS/Linux 桌面输入；阶段 2 不重跑真实前台写回。

## 交接提示

- 继续任务前先读：本文件、`agent_memory/` 三个当前摘要、目标相关 `research/*.latest.json`。
- 不要重复讨论：离线视觉通过、候选包存在或历史报告通过，不等于当前真实桌面闭环已完成。
- 风险：不要在 `safeCandidateReady=false`、目标工具未前台、窗口不可见/最小化、或用户未明确授权时执行真实写入。
