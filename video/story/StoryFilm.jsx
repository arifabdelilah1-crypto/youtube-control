// The "Story stick" style (settings.style = "story"): a film drawn in code by Claude for this video (settings.story.code),
// with our kit (video/story/kit.js), in one of three looks (settings.story.look):
//   noir   cinematic night: dark sets, one warm light per shot, white-headed figures, film grain and vignette
//   paper  storybook: warm paper, muted colours, hand-drawn lines that gently "boil", paper grain
//   pop    bright comic: flat saturated colours, thick outlines, halftone dots, bold outlined subtitles
// Plain subtitles (one line, no karaoke), the narration per scene, no music unless the project asks for it.
import React from "react";
import { AbsoluteFill, Html5Audio, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { ARABIC, LATIN, useFonts } from "../fonts.js";
import { THEMES, ThemeContext } from "./kit.js";
import { compileFilm, wordsOf } from "./compile.js";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };

export function StoryFilm(props) {
  const { scenes, width: W, height: H, totalFrames, rtl, music } = props;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  useFonts(props.assetBase);
  const look = THEMES[props.story?.look] ? props.story.look : "noir";
  const T = THEMES[look];
  const words = React.useMemo(() => wordsOf(scenes, fps), [scenes, fps]);
  // a broken film must fail the render, never go out as a black video: compileFilm throws
  const Film = React.useMemo(() => compileFilm(props.story?.code || "", { T, W, H, FPS: fps, TOTAL: totalFrames, words, scenes: scenes.map((s) => ({ from: s.from, dur: s.dur })) }),
    [props.story?.code, look, W, H, fps, totalFrames, words, scenes]);

  // the subtitle on screen: the caption group being said (plain, one line)
  let caption = "";
  for (const s of scenes) for (const g of s.groups || []) {
    const a = s.from + Math.round(g.s * fps), b = s.from + Math.round(g.e * fps) + 6;
    if (frame >= a && frame < b) caption = g.words.map((w) => w.w).join(" ");
  }
  const portrait = H > W;
  const font = rtl ? `"${ARABIC}", "${LATIN}", sans-serif` : `"${LATIN}", "${ARABIC}", sans-serif`;
  const capSize = portrait ? 58 : 50;
  const seed = Math.floor(frame / 4) % 6;  // paper look: the lines move a little every 4 frames
  const voiceEnd = scenes.length ? scenes[scenes.length - 1].from + scenes[scenes.length - 1].dur : totalFrames;
  const musicVolume = (f) => Number(music?.volume ?? 0.2) * (f < voiceEnd ? 0.45 : 1) * interpolate(f, [totalFrames - 24, totalFrames - 1], [1, 0], clamp);

  return (
    <AbsoluteFill style={{ background: T.bg }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id="boil" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed={seed} />
            <feDisplacementMap in="SourceGraphic" scale="5" />
          </filter>
          <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={frame % 9} /><feColorMatrix type="saturate" values="0" /></filter>
          <radialGradient id="vig" cx="50%" cy="48%" r="75%"><stop offset="55%" stopColor="#000" stopOpacity="0" /><stop offset="100%" stopColor="#000" stopOpacity={T.vignette} /></radialGradient>
          <pattern id="dots" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="7" cy="7" r="2.4" fill="#000" /></pattern>
        </defs>
        <ThemeContext.Provider value={T}>
          <g filter={T.wobble ? "url(#boil)" : undefined}><Film f={frame} /></g>
        </ThemeContext.Provider>
        {T.halftone ? <rect x={0} y={0} width={W} height={H} fill="url(#dots)" opacity={0.07} /> : null}
        {T.grain ? <rect x={0} y={0} width={W} height={H} filter="url(#grain)" opacity={T.grain} style={{ mixBlendMode: look === "paper" ? "multiply" : "overlay" }} /> : null}
        {T.vignette ? <rect x={0} y={0} width={W} height={H} fill="url(#vig)" /> : null}
        <rect x={0} y={0} width={W} height={H} fill="#000" opacity={interpolate(frame, [0, 8], [1, 0], clamp) + interpolate(frame, [totalFrames - 14, totalFrames - 1], [0, 1], clamp)} />
      </svg>
      {caption ? (
        <div style={{ position: "absolute", left: portrait ? 60 : 200, right: portrait ? 60 : 200, bottom: portrait ? H * 0.17 : H * 0.07, textAlign: "center",
          fontFamily: font, fontWeight: T.caption.weight, fontSize: capSize, lineHeight: 1.2, color: T.caption.color, direction: rtl ? "rtl" : "ltr",
          // pop: a thick comic outline (8 shadows around the letters); the others: a soft dark (or light) halo
          textShadow: look === "pop" ? [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]].map(([x, y]) => `${x * 5}px ${y * 5}px 0 ${T.caption.stroke}`).join(", ") + `, 0 8px 0 ${T.caption.stroke}`
            : `0 0 12px ${T.caption.stroke}, 0 2px 4px ${T.caption.stroke}` }}>{caption}</div>
      ) : null}
      {scenes.map((s, i) => (s.voiceUrl ? (
        <Sequence key={`v${s.id || i}`} from={s.from} durationInFrames={s.dur} name={`Voice ${i + 1}`}><Html5Audio src={s.voiceUrl} /></Sequence>
      ) : null))}
      {music?.url ? <Html5Audio src={music.url} loop volume={musicVolume} /> : null}
    </AbsoluteFill>
  );
}
