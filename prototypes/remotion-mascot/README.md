# Prompt Copilot mascot Remotion prototype

This Remotion prototype renders lightweight animation concepts for the Prompt Copilot floating mascot.

## Integration status

This is an archived, non-integrated animation prototype. The desktop shell does not load this Remotion project or the rendered MP4 previews at runtime; production UI currently uses the checked-in mascot image assets directly.

## Compositions

- `MascotStateLoop`: cycles through normal, resting, thinking, suggesting, success, and clapping states.
- `FloatingPromptAssistant`: shows the mascot floating beside an active input box and opening a prompt card.

## Source assets

The prototype reads transparent PNGs from `public/mascot-states/`, copied from:

```text
../../assets/ui-ux/mascot-states/
```

## Commands

```powershell
npm install
npm run lint
npx remotion still src\index.ts MascotStateLoop ..\..\assets\ui-ux\mascot-animations\mascot-state-loop-frame.png --frame=45 --scale=0.5
npx remotion still src\index.ts FloatingPromptAssistant ..\..\assets\ui-ux\mascot-animations\floating-assistant-frame.png --frame=75 --scale=0.5
npx remotion render src\index.ts MascotStateLoop ..\..\assets\ui-ux\mascot-animations\mascot-state-loop.mp4 --codec=h264 --crf=28
npx remotion render src\index.ts FloatingPromptAssistant ..\..\assets\ui-ux\mascot-animations\floating-prompt-assistant.mp4 --codec=h264 --crf=28
```

## Rendered outputs

Rendered files live in:

```text
../../assets/ui-ux/mascot-animations/
```

The checked-in MP4 outputs are lightweight preview artifacts, not production animation exports.
