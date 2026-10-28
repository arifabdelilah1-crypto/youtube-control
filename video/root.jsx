// Entry point for the final render (bundled by @remotion/bundler in GitHub Actions).
import React from "react";
import { Composition, registerRoot } from "remotion";
import { Main } from "./Main.jsx";

const fallback = {
  width: 1080, height: 1920, fps: 30, totalFrames: 90, rtl: false, language: "en", title: "", scenes: [],
  captions: { enabled: false }, hook: { enabled: false }, progress: { enabled: false }, sfx: { enabled: false }, music: {},
};

function Root() {
  return (
    <Composition
      id="Main"
      component={Main}
      defaultProps={fallback}
      durationInFrames={90}
      fps={30}
      width={1080}
      height={1920}
      calculateMetadata={({ props }) => ({ durationInFrames: props.totalFrames, fps: props.fps, width: props.width, height: props.height })}
    />
  );
}

registerRoot(Root);
