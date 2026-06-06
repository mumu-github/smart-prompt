import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

type MascotState = {
  label: string;
  file: string;
  note: string;
};

const states: MascotState[] = [
  { label: "Normal", file: "normal.png", note: "Ready beside the input" },
  { label: "Resting", file: "resting.png", note: "Idle when no context is active" },
  { label: "Thinking", file: "thinking.png", note: "Reading the prompt context" },
  { label: "Suggesting", file: "suggesting.png", note: "Offering a next step" },
  { label: "Success", file: "success.png", note: "Prompt inserted cleanly" },
  { label: "Clapping", file: "clapping.png", note: "Encouraging completion" },
];

const palette = {
  bg: "#f6f8f8",
  card: "#ffffff",
  border: "#d7e0e5",
  text: "#182230",
  muted: "#667085",
  teal: "#15928d",
  amber: "#f5a524",
  slate: "#e8edf0",
};

const stateAtFrame = (frame: number, fps: number) => {
  const segment = 2 * fps;
  const index = Math.min(states.length - 1, Math.floor(frame / segment) % states.length);
  return {
    state: states[index],
    index,
    localFrame: frame - index * segment,
    segment,
  };
};

const stateImage = (file: string) => staticFile(`mascot-states/${file}`);

export const MascotStateLoop = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { state, index, localFrame } = stateAtFrame(frame, fps);
  const pop = spring({
    frame: localFrame,
    fps,
    config: { damping: 14, stiffness: 110, mass: 0.65 },
  });
  const breathe = Math.sin((frame / fps) * Math.PI * 2) * 7;
  const chipProgress = interpolate(localFrame, [0, fps * 0.35], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  return (
    <AbsoluteFill
      style={{
        background: palette.bg,
        fontFamily: "Segoe UI, Arial, sans-serif",
        color: palette.text,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 48,
          borderRadius: 36,
          background: palette.card,
          border: `2px solid ${palette.border}`,
          boxShadow: "0 18px 60px rgba(22, 34, 51, 0.10)",
          overflow: "hidden",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 92,
          top: 92,
          width: 72,
          height: 10,
          borderRadius: 999,
          background: palette.teal,
        }}
      />
      <div style={{ position: "absolute", left: 92, top: 150 }}>
        <div style={{ fontSize: 58, fontWeight: 800 }}>Assistant states</div>
        <div style={{ marginTop: 12, fontSize: 26, color: palette.muted }}>
          Prompt Copilot mascot motion loop
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 130,
          bottom: 110,
          width: 520,
          padding: "28px 32px",
          borderRadius: 28,
          background: "#f9fbfb",
          border: `1px solid ${palette.border}`,
        }}
      >
        <div style={{ fontSize: 26, color: palette.muted }}>Current state</div>
        <div style={{ marginTop: 8, fontSize: 54, fontWeight: 800 }}>{state.label}</div>
        <div style={{ marginTop: 10, fontSize: 24, color: palette.muted }}>{state.note}</div>
      </div>

      <Img
        src={stateImage(state.file)}
        style={{
          position: "absolute",
          right: 300,
          top: 125 + breathe,
          width: 560,
          height: 560,
          objectFit: "contain",
          transform: `scale(${0.86 + pop * 0.14}) rotate(${Math.sin(frame / 12) * 1.8}deg)`,
          transformOrigin: "50% 82%",
          filter: "drop-shadow(0 20px 24px rgba(20, 27, 36, 0.13))",
        }}
      />

      <div
        style={{
          position: "absolute",
          right: 128,
          bottom: 92,
          display: "flex",
          gap: 14,
        }}
      >
        {states.map((item, itemIndex) => {
          const active = itemIndex === index;
          return (
            <div
              key={item.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "14px 18px",
                borderRadius: 999,
                background: active ? "rgba(21, 146, 141, 0.12)" : "#f4f6f7",
                border: `1px solid ${active ? palette.teal : palette.slate}`,
                transform: active ? `scale(${0.96 + chipProgress * 0.04})` : "scale(1)",
              }}
            >
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  background: active ? palette.teal : "#bac5cc",
                }}
              />
              <span
                style={{
                  fontSize: 22,
                  fontWeight: active ? 800 : 650,
                  color: active ? palette.text : palette.muted,
                }}
              >
                {item.label}
              </span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const FloatingPromptAssistant = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { state, localFrame } = stateAtFrame(frame, fps);
  const entrance = spring({
    frame: localFrame,
    fps,
    config: { damping: 12, stiffness: 100, mass: 0.7 },
  });
  const float = Math.sin((frame / fps) * Math.PI * 2) * 9;
  const cardOpacity = interpolate(localFrame, [0, fps * 0.35], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const sendPulse = interpolate(Math.sin((frame / fps) * Math.PI * 2), [-1, 1], [0.96, 1.04]);

  return (
    <AbsoluteFill
      style={{
        background: palette.bg,
        fontFamily: "Segoe UI, Arial, sans-serif",
        color: palette.text,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 70,
          top: 62,
          width: 1140,
          height: 600,
          borderRadius: 30,
          background: palette.card,
          border: `2px solid ${palette.border}`,
          boxShadow: "0 18px 60px rgba(22, 34, 51, 0.10)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: 72,
            borderBottom: `1px solid ${palette.slate}`,
            display: "flex",
            alignItems: "center",
            paddingLeft: 34,
            gap: 14,
            fontSize: 24,
            fontWeight: 800,
          }}
        >
          <span style={{ color: palette.teal }}>Prompt Copilot</span>
          <span style={{ color: palette.muted, fontWeight: 500 }}>floating near the active input</span>
        </div>
        <div
          style={{
            position: "absolute",
            left: 58,
            top: 128,
            width: 520,
            height: 92,
            borderRadius: 24,
            background: "#f4f6f7",
            padding: "24px 28px",
            fontSize: 24,
            lineHeight: 1.35,
          }}
        >
          Help me turn this rough idea into a sharper prompt...
        </div>
        <div
          style={{
            position: "absolute",
            left: 58,
            bottom: 54,
            width: 640,
            height: 96,
            borderRadius: 24,
            border: `3px solid ${palette.teal}`,
            background: "#ffffff",
            color: palette.muted,
            fontSize: 24,
            display: "flex",
            alignItems: "center",
            paddingLeft: 28,
          }}
        >
          Type or paste your prompt here...
          <div
            style={{
              position: "absolute",
              right: 22,
              top: 24,
              width: 48,
              height: 48,
              borderRadius: 14,
              background: palette.teal,
              transform: `scale(${sendPulse})`,
            }}
          />
        </div>
        <div
          style={{
            position: "absolute",
            right: 82,
            top: 132,
            width: 350,
            padding: 24,
            borderRadius: 26,
            background: "#ffffff",
            border: `1px solid ${palette.border}`,
            boxShadow: "0 12px 35px rgba(22, 34, 51, 0.11)",
            opacity: cardOpacity,
            transform: `translateY(${(1 - entrance) * 18}px)`,
          }}
        >
          <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
            {["Idea", "Continue", "Polish"].map((label, i) => (
              <div
                key={label}
                style={{
                  borderRadius: 14,
                  padding: "10px 14px",
                  fontSize: 18,
                  fontWeight: 750,
                  color: i === 0 ? "#ffffff" : palette.text,
                  background: i === 0 ? palette.teal : "#f4f6f7",
                }}
              >
                {label}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 22, lineHeight: 1.35 }}>
            {state.label === "Resting"
              ? "Waiting for the next input context."
              : state.label === "Thinking"
                ? "Reading the surrounding task context."
                : state.label === "Suggesting"
                  ? "Drafting a clearer prompt direction."
                  : state.label === "Success"
                    ? "Prompt inserted into the active box."
                    : state.label === "Clapping"
                      ? "Nice, the workflow is ready to ship."
                      : "Ready to help shape the next prompt."}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            {["Refresh", "Edit", "Insert"].map((label, i) => (
              <div
                key={label}
                style={{
                  borderRadius: 14,
                  padding: "10px 14px",
                  fontSize: 17,
                  fontWeight: 750,
                  color: i === 2 ? "#ffffff" : palette.text,
                  background: i === 2 ? palette.teal : "#f4f6f7",
                }}
              >
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
      <Img
        src={stateImage(state.file)}
        style={{
          position: "absolute",
          left: 510,
          bottom: 108 + float,
          width: 240,
          height: 240,
          objectFit: "contain",
          transform: `scale(${0.9 + entrance * 0.1})`,
          transformOrigin: "50% 84%",
          filter: "drop-shadow(0 16px 16px rgba(20, 27, 36, 0.14))",
        }}
      />
    </AbsoluteFill>
  );
};
