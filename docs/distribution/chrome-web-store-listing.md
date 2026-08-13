# 提笔（Tibi）Chrome Web Store 上架材料

- 日期：2026-08-13
- 用途：Chrome Web Store 开发者控制台上架所需的文案与信息（扩展代码 `prototypes/browser-extension/`，version 0.2.6，MV3）
- 注意：上架前需在 `chrome://extensions` 打包正式 zip；商店审核要求单用途、隐私披露与截图，以下材料逐项对应

## 1. 商店名称

- 主名称：提笔 Tibi —— 输入框旁的提示词编辑器
- 英文：Tibi — Context editor for the input moment

## 2. 一句话描述（132 字符内，用于搜索结果）

```
Tibi 在 AI 输入框旁把你的模糊想法整理成可审核的提示词，填入但不发送。
```

英文：

```
Tibi turns a rough draft into a clear, reviewable prompt right beside the AI input box. Inserts, never sends.
```

## 3. 详细描述（英文，Chrome Web Store 主要语言建议英文）

```text
Tibi is a context editor for the input moment. It lives beside the AI
input box, reads only the current draft, and turns it into a clear,
reviewable prompt for the tool you are using.

How it works:
1. Write a rough idea, half-finished request, or full draft.
2. Click the Tibi mascot beside the input box.
3. Review and edit the generated prompt.
4. Insert it back into the same input box — Tibi never sends for you.

Three promises:
- You control: insert only. No auto-submit is enforced in code, not
  just promised. Undo is one click.
- You own: bring your own API key (Agnes / OpenAI-compatible /
  Anthropic / Gemini). Credentials are encrypted locally. No cloud
  account, no analytics.
- It learns: from your real task outcomes — not from template
  libraries — Tibi proposes reviewable Memory, Rule, Skill and
  Generation Policy candidates over time.

Supported sites include ChatGPT, Claude, Gemini, Perplexity,
DeepSeek, Doubao, Lovable, Bolt, v0 and Replit.

Privacy: Tibi does not read or upload the whole page, chat history,
screen, clipboard or attachments by default. Only the current draft
in the input box is used when you explicitly generate.
```

中文补充描述（可选，供中文区商店页）：

```text
提笔（Tibi）是输入框旁的上下文提示词编辑器。只读取当前草稿，
把它整理成可直接交给当前 AI 工具的任务说明；填入但不发送，
发送权永远在你手里。BYOK 自带密钥、凭证本机加密、无云端账号。
```

## 4. 权限用途说明（商店审核要求逐项披露）

| 权限 | 用途 | 最小化说明 |
| --- | --- | --- |
| `storage` | 本地保存设置、provider 选择与脱敏统计 | 不包含任何账户或云端数据 |
| `activeTab` | 仅在用户点击小人时访问当前标签页的输入框 | 不常驻读取页面 |
| 站点 host 权限（allowlist） | 仅在列出的 AI 站点注入小人入口并读写其输入框 | 白名单式，无 `<all_urls>` |
| `http://127.0.0.1:17371/*` / `localhost` | 与本地服务通信（生成请求、激活证据） | 仅本机回环地址 |

单用途声明：**在 AI 输入框旁生成、审核并填入提示词（不自动发送）。**

## 5. 截图清单（1280×800 或 640×400，至少 1 张，建议 3-5 张）

- 扩展在 ChatGPT 输入框旁的小人入口（合成草稿，无真实会话内容）
- Assistant Card 展开：生成结果可编辑、主操作「填入输入框」
- 填入成功状态：「已填入，未发送」+ 撤销
- 控制中心（桌面端，可选）

提示：截图必须使用非敏感合成草稿；现有证据截图（`outputs/`、`research/`）仅供内部验收，上架截图需重新截取干净环境。

## 6. 隐私披露（商店隐私做法表单）

- 用途：单一用途（见上）。
- 数据收集：不收集、不传输、不共享任何个人数据。草稿与生成内容默认仅存在于当前会话内存；脱敏统计（长度、hash、状态 token）仅存本地。
- 数据使用：本地自学习候选（Memory/Rule/Skill/Policy）仅用于本机生成质量，用户可随时审核、拒绝或在隐私页清除。
- 认证信息：用户 API Key 通过 Windows DPAPI（或本机随机密钥）加密后存于本机，绝不上传。

## 7. 上架前检查清单

- [ ] `manifest.json` version 提升为 1.0.0（当前 0.2.6 为内测版本号）
- [ ] 打包 zip 并在全新 Chrome profile 安装验证
- [ ] 截图与描述一致，无内部证据术语（`safeCandidate`、`evidence` 等不得出现）
- [ ] 隐私表单与第 4/6 节一致
- [ ] 商店类别：生产工具 > 开发者工具
- [ ] 官网链接就绪（`web/landing/index.html` 部署后填入）

## 8. 审核常见退回原因（提前规避）

1. 权限过宽：本扩展无 `tabs`/`cookies`/`webRequest`，host 权限为白名单，可顺利通过。
2. 单用途不清：描述第一句即声明单用途。
3. 缺隐私披露：按第 6 节填写。
4. 截图与功能不符：用干净合成草稿重截。
