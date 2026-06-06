# UI/UX 概念图

## 产物

- `prompt-copilot-uiux-v1.png`：基于 PRD v0.1 生成的第一版 UI/UX 概念图。
- `prompt-copilot-uiux-builtin-exact-mascot-v2.png`：内置 `image_gen` 生成 UI 底图后，本地贴入原始 `mascot-token-run.png` 的当前 UI/UX 概念图；小人未由模型重绘。
- `mascot-token-run.png`：用户指定的小人原型，来自 `C:/Users/lhy10/Documents/谁在吃token/src/assets/delight/roaming/token-run.png`。后续 UI/UX 图必须保留这个小人，不重新设计角色。
- `mascot-states/`：小人状态动作资产，包括 `normal`、`resting`、`thinking`、`suggesting`、`success`、`clapping` 六种透明 PNG 和总览板。
- `gpt-image-2-uiux.prompt.txt`：显式 `gpt-image-2` CLI/API 复跑使用的提示词。
- `prompt-copilot-uiux-gpt-image-2.png`：显式 `gpt-image-2` CLI/API 复跑后的目标输出；当前尚未生成，因为 OpenAI API 返回 `Billing hard limit has been reached`。

## 说明

- 生成方式：`prompt-copilot-uiux-builtin-exact-mascot-v2.png` 使用 Codex 内置 `image_gen` 生成 UI 底图，并通过本地合成把原始小人 PNG 放入界面。
- 模型/API 状态：User 级 `OPENAI_API_KEY` 已生效，显式 `gpt-image-2` CLI/API 调用可到达 OpenAI，但当前 API 项目/账户触发 billing hard limit，尚未成功产出 `prompt-copilot-uiux-gpt-image-2.png`。
- 小人形象：用户已指定 `mascot-token-run.png` 作为唯一原型；后续生成必须保留这个小人本体、动作比例、表情、颜色和线条风格。
- 状态动作：`mascot-states/*.png` 是基于原型风格生成的动作变体，已经本地抠成透明 PNG，可用于悬浮入口、状态切换或后续动画。
- 覆盖要素：输入框旁悬浮入口、三种模式、prompt card、skills 推荐、刷新/编辑/插入操作、Windows/macOS 兼容信号。
- 后续迭代：用户提供小人原型图后，应基于原型重生成动作与表情；再用 Remotion 制作待机、思考、建议、成功等轻量动画。

## gpt-image-2 复跑

Dry-run 验证参数：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\generate-uiux-gpt-image-2.ps1 -DryRun
```

真实生成需要 API billing/额度可用。脚本会调用 `gpt-image-2` 的 image edit 路径，并把 `mascot-token-run.png` 作为输入图：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\generate-uiux-gpt-image-2.ps1 -Force
```

## 生成提示词

```text
Use case: ui-mockup
Asset type: product PRD UI/UX concept board for a Windows/macOS prompt automation assistant
Primary request: Create a polished high-fidelity UI/UX concept image for a cross-platform desktop + browser extension tool that floats a small friendly humanoid prompt assistant beside AI input boxes. The product helps vibe coding and LLM users in three modes: empty input idea mode, partial prompt continuation mode, and full prompt polish mode.
Scene/backdrop: A clean desktop workspace showing a browser AI chat input on the left and a coding agent/editor input on the right, with a compact floating assistant character near each input field.
Subject: A small friendly humanoid digital assistant, not a robot, soft expressive face, tiny body, approachable product mascot. Show three small state thumbnails: thinking, suggesting, success.
Style/medium: premium SaaS product UI mockup, crisp modern desktop interface, realistic but clean design system, no marketing hero, no decorative blobs.
Composition/framing: 16:9 product concept board. Main center shows the floating assistant opening a prompt card beside an input box. Side panels show the three modes as segmented controls: Idea, Continue, Polish. Include compact controls for Refresh, Edit, Insert. Show a local Skills suggestion row with 2-3 chips.
Lighting/mood: calm, focused, professional, subtle depth, light theme with restrained accent colors.
Color palette: off-white surfaces, charcoal text, muted teal accent, small amber highlight, soft slate borders.
Text (verbatim): "Prompt Copilot", "Idea", "Continue", "Polish", "Skills", "Insert". Keep text minimal and legible.
Constraints: UI must feel like an actual usable app, not a landing page. The assistant must not block the input text. Show Windows/macOS compatibility subtly using tiny platform badges. No brand names from real AI products. No logos, no watermark, no unreadable paragraphs.
```
