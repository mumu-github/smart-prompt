import "./index.css";
import { Composition } from "remotion";
import { FloatingPromptAssistant, MascotStateLoop } from "./Composition";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="MascotStateLoop"
        component={MascotStateLoop}
        durationInFrames={360}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="FloatingPromptAssistant"
        component={FloatingPromptAssistant}
        durationInFrames={360}
        fps={30}
        width={1280}
        height={720}
      />
    </>
  );
};
