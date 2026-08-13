# 提笔（Tibi）内测招募文案

- 日期：2026-08-13
- 用途：30 天冷启动第 2 周的渠道发帖素材；目标是 20-50 名内测用户（免费、自带 API Key）
- 原则：不吹"prompt 魔法棒"，主打信任承诺 + 诚实工程故事；数据回来前不做新功能

## 1. 中文帖（V2EX / 即刻 / 知乎）

标题：**"Prompt 已死"之后：我做了一个只填入、不发送的输入框旁提示词编辑器**

正文：

```text
2026 年了，"提示词优化器"这个品类基本退场了（PromptPerfect 下个月关停）。
但我在日常用 ChatGPT / Codex 的时候，痛点还在：

- 脑子里有模糊想法，不知道怎么写清楚；
- 写了一半，缺目标、约束、验收标准；
- CLAUDE.md / SKILL.md 写了一堆，用的时候想不起来。

所以做了一个小工具「提笔（Tibi）」：输入框旁的小人，点击后把你当前
草稿整理成可审核、可填入的提示词，填回原输入框——但永不替你发送。

三个卖点：
1. 你控制：填入不发送是代码强制的，不是承诺；填入后可撤销。
2. 你拥有：BYOK（自带 Key，支持 OpenAI 兼容 / Anthropic / Gemini / Agnes），
   凭证本机加密，无云端账号。
3. 会学习：从你的真实任务结果（Outcome / Token / 返工）沉淀可审核的
   Memory / Rule / Skill，不是套模板库。

目前状态：ChatGPT 浏览器闭环已真实跑通（verified insert + 稳定回读），
Codex 桌面闭环差最后一步。全部本地优先。

找 20-50 名内测用户：免费，自带 API Key，Windows + Chrome/Edge。
有意愿的回帖或私信，我拉群。
GitHub（内测中）：https://github.com/mumu-github/smart-prompt
```

## 2. 英文帖（X / Show HN / Product Hunt 首版文案）

标题：**Tibi — the context editor for the input moment. Inserts, never sends.**

```text
Prompt optimizers are dead; context engineering is the game.

Tibi sits beside the AI input box, reads only your current draft, and
turns it into a clear, reviewable prompt for the tool you're using.

- You control: insert-only is enforced in code. Undo in one click.
  Never auto-sends.
- You own: BYOK (OpenAI-compatible / Anthropic / Gemini). Credentials
  encrypted locally. No cloud account.
- It learns: from your real task outcomes, it proposes reviewable
  Memory / Rule / Skill candidates over time.

Current status, honestly: ChatGPT browser loop verified end-to-end;
Codex desktop loop one step away. Windows + Chrome/Edge. Local-first.

Looking for 20-50 beta users (bring your own key, free).
Repo (in closed beta): https://github.com/mumu-github/smart-prompt
```

## 3. 社区痛点帖（Reddit r/vibecoding / r/ClaudeCode）

标题：**Your CLAUDE.md spells out the workflow, but you forget it at input time — Tibi reminds you there**

```text
There was a thread here a while ago: "My CLAUDE.md spells out the
workflow. Claude Code still forgets it." And another about CLAUDE.md /
AGENTS.md / .cursorrules sprawl.

I built a small tool for exactly that moment: Tibi. It sits beside the
input box, reads only the current draft, and (a) shapes the draft into
a reviewable task prompt, (b) surfaces a one-line reminder when one of
your local skills matches. Insert-only, never auto-submits, BYOK,
local-first. Windows + Chrome/Edge for now.

Not a prompt marketplace. Not a wrapper. Happy to share access with a
small beta group — reply if interested.
```

## 4. Skills 作者定向话术（私信 / 评论区，转化率最高的渠道）

```text
你的 skill 写得再好，用户想不起来用也白搭。提笔（Tibi）在输入瞬间
做一行轻提醒：匹配本地 SKILL.md / 规则文件，用户点开就能审核回填，
不自动注入、不自动发送。想请你试用并给反馈——BYOK、本地优先、免费。
```

## 5. 招募信息收集模板（入群后第一问）

```text
1. 你主要用哪些 AI 工具（网页 / 桌面）？
2. 有现成的 prompts/skills 散落在哪里（Notion / CLAUDE.md / 笔记）？
3. 你愿意用哪个 Provider（自带 Key）？
4. 最想解决的问题：写不清 / 忘用 skill / 多工具 prompt 不一致？
```

## 6. 反馈渠道与指标

- 渠道：微信群（主）/ 飞书群（备）
- 只盯四个数：verified insert 成功率、生成后填入率、撤销率、失败原因分布
- 数据回来前不做任何新功能（路线图冻结清单仍然有效）
