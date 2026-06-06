# Mascot state assets

## Files

- `normal.png`: default ready-to-help state.
- `resting.png`: idle/off-work resting state.
- `thinking.png`: thinking state with thought bubble.
- `suggesting.png`: suggestion state with sparkle bubble.
- `success.png`: success state with checkmark bubble.
- `clapping.png`: encouragement/clapping state.
- `assistant-states-board-builtin-v1.png`: earlier three-state presentation board.
- `assistant-states-six-board-builtin-v2.png`: six-state presentation board.

## Notes

- These assets were generated with Codex built-in `image_gen`, then chroma-keyed locally to transparent PNGs.
- The character style follows `../mascot-token-run.png`, but these state variants are model-generated action redraws rather than pixel-preserved edits of the original file.
- Each standalone state PNG is `1254x1254` with transparent corners and no visible chroma-key background.
- Strict `gpt-image-2` API generation remains blocked by the OpenAI API billing hard limit.
