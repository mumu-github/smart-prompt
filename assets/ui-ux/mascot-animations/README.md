# Mascot Remotion animations

## Rendered assets

- `mascot-state-loop.mp4`: 12s, 1920x1080, 30fps. Cycles through normal, resting, thinking, suggesting, success, and clapping states.
- `floating-prompt-assistant.mp4`: 12s, 1280x720, 30fps. Shows the mascot floating near an active prompt input and opening a prompt card.
- `mascot-state-loop-frame.png`: still-frame check for `MascotStateLoop`.
- `floating-assistant-frame.png`: still-frame check for `FloatingPromptAssistant`.

## Source

- Remotion source project: `../../../prototypes/remotion-mascot`.
- The animations use the transparent PNG sprites from `../mascot-states/`.
- These files are preview artifacts from an archived prototype, not assets wired into the desktop shell runtime.

## Verification

- `npm run lint` was run inside the Remotion prototype.
- Both videos were rendered with `npx remotion render`.
- `ffprobe` verified both MP4 files are 12s h264 videos at 30fps.
