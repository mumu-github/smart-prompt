# Smart Prompt

Smart Prompt 是一个面向网页 AI / Agent 工具的提示词协作助手。它在输入框附近显示一个小人入口，帮助用户把模糊想法生成、补全或润色成可直接插入的 prompt。

当前仓库包含研究文档、UI/UX 资产、Chrome/Edge MV3 浏览器扩展原型、本地服务、共享 prompt/LLM gateway，以及 Tauri 桌面壳 scaffold。

## V2 能力

- 真实 LLM 三模式生成：`idea`、`continue`、`polish`
- 多 provider LLM gateway：`agnes`、`openai-compatible`、`anthropic`、`gemini`
- 站点适配：ChatGPT、Claude、Gemini、Perplexity、Lovable、Bolt、v0、Replit
- 浏览器扩展：输入框附近小人入口、prompt card、Insert 只填入不发送、本地服务 fallback
- 本地服务：settings、skill 文件夹导入、skill 推荐、prompt library、`/generate`
- Tauri 桌面壳：设置页、API key 管理、skill/prompt 管理、托盘、全局快捷键、本地服务启动
- 隐私边界：不默认上传整页内容，不自动发送消息

## 目录

- `prototypes/browser-extension/`：Chrome/Edge MV3 浏览器扩展原型
- `apps/local-service/`：Node 本地服务和 API contract
- `apps/desktop-shell/`：Tauri 桌面壳 scaffold
- `packages/shared/`：共享 prompt core、站点配置和 LLM gateway
- `packages/prompt-session/`：网页与桌面共用的状态机、reason、核心文案和 Assistant View Model
- `assets/ui-ux/`：UI/UX 概念图、小人状态图、动画资产
- `prototypes/remotion-mascot/`：小人动画 Remotion 原型
- `docs/`：研究、竞品、开源 skills 分析和 PRD
- `research/`：V2 rubric、验证报告和 runtime evidence
- `scripts/`：生成、探针、critic 和 runtime 验收脚本

## 快速验证

默认 V2 自动化检查：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v2.ps1
```

严格 runtime evidence 检查：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\critic-v2.ps1 -RequireRuntimeEvidence
```

当前严格验收已通过，证据见：

- `research/v2-verification.md`
- `research/v2-real-llm.latest.json`
- `research/v2-live-site-probe.latest.json`
- `research/v2-claude-insert.latest.json`
- `research/v2-tauri-runtime.latest.json`

## 真实 LLM

Agnes provider 已接入，可用以下方式验证三模式真实生成：

```powershell
$env:AGNES_API_KEY="你的 Agnes API key"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-v2-real-llm.ps1 -Provider agnes
```

通过标准：

- `pass: true`
- `idea`、`continue`、`polish` 都是 `ok: true`
- 三项均为 `generatedBy: "llm"`
- 三项 `mode` 与样本名严格一致

## 本地服务

```powershell
cd apps\local-service
npm test
npm start
```

默认地址：

```text
http://127.0.0.1:17371
```

API 说明见 `apps/local-service/README.md`。

## 浏览器扩展

```powershell
cd prototypes\browser-extension
npm test
```

扩展原型在 `prototypes/browser-extension/`，可作为 unpacked extension 加载。

## 桌面壳

```powershell
cd apps\desktop-shell
npm test
cargo check --manifest-path src-tauri\Cargo.toml
```

生产桌面壳请使用仓库约定的 Tauri 构建入口：

```powershell
npm run build --prefix apps/desktop-shell
```

不要把 `cargo build --release --manifest-path apps/desktop-shell/src-tauri/Cargo.toml` 的直产物用于真实桌面验收，因为该路径会加载 `tauri.conf.json` 中的 `devUrl`，在 dev server 未运行时可能只得到 WebView 错误页。

Tauri runtime 验收脚本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-v2-tauri-runtime.ps1
```

## 原则

- Insert 只填入输入框，不自动发送
- 默认不读取或上传整页文本
- API key 只用于本地服务和显式配置的 provider
- 小人角色以 `assets/ui-ux/mascot-token-run.png` 为原型，不重新设计角色
