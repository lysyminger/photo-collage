import { Composition } from "remotion";
import { CollageDemo } from "./CollageDemo";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="CollageDemo"
      component={CollageDemo}
      durationInFrames={150}
      fps={30}
      width={640}
      height={400}
    />
  );
};
