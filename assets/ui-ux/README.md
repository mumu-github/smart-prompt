# UI/UX 概念图

## 产物

- `prompt-copilot-uiux-v1.png`：基于 PRD v0.1 生成的第一版 UI/UX 概念图。
- `mascot-token-run.png`：用户指定的小人原型，来自 `C:/Users/lhy10/Documents/谁在吃token/src/assets/delight/roaming/token-run.png`。后续 UI/UX 图必须保留这个小人，不重新设计角色。
- `gpt-image-2-uiux.prompt.txt`：显式 `gpt-image-2` CLI/API 复跑使用的提示词。
- `prompt-copilot-uiux-gpt-image-2.png`：显式 `gpt-image-2` CLI/API 复跑后的目标输出；当前尚未生成，因为 shell 环境缺少 `OPENAI_API_KEY`。

## 说明

- 生成方式：Codex 内置 `image_gen` 工具。
- 模型/API 状态：当前 shell 环境未配置 `OPENAI_API_KEY`，因此没有走项目内 fallback CLI 的显式 `gpt-image-2` API 调用；如需严格复现 `gpt-image-2` API 路径，应配置 key 后用同一提示词复跑。
- 小人形象：用户已指定 `mascot-token-run.png` 作为唯一原型；后续生成必须保留这个小人本体、动作比例、表情、颜色和线条风格。
- 覆盖要素：输入框旁悬浮入口、三种模式、prompt card、skills 推荐、刷新/编辑/插入操作、Windows/macOS 兼容信号。
- 后续迭代：用户提供小人原型图后，应基于原型重生成动作与表情；再用 Remotion 制作待机、思考、建议、成功等轻量动画。

## gpt-image-2 复跑

Dry-run 验证参数：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\generate-uiux-gpt-image-2.ps1 -DryRun
```

真实生成需要先配置 `OPENAI_API_KEY`。脚本会调用 `gpt-image-2` 的 image edit 路径，并把 `mascot-token-run.png` 作为输入图：

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
