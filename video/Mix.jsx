// The Mix style (settings.style = "mix"): real footage and drawn Explainer scenes in one video, one kind per scene
// (settings.mix.scenes[i].kind, planned by Claude: supabase/functions/explainer "plan" with style "mix"):
//   footage  the stock clip or photo (Clip from Main.jsx, Ken Burns on photos) with its name card, under a light tint of the look
//   drawn    the Explainer drawing (SceneBody) in the look picked, drawn on from left to right in 10 frames
//   overlay  the clip dimmed to 45% and blurred, with a light drawing on top (no background, light ink)
// One caption style on every scene (the classic captions, a little lower so they clear the drawings); the captions' highlight,
// the drawings and the name cards share the look's accent. Scenes cross-fade over 6 frames. No transition sound.
import React from "react";
import { AbsoluteFill, Easing, Html5Audio, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { ARABIC, LATIN, useFonts } from "./fonts.js";
import { ICONS } from "./explainer-icons.js";
import { MUSIC_UNDER_VOICE } from "./layout.js";
import { Overlay, SceneBody, explainerTheme, setExplainerTheme } from "./Explainer.jsx";
import { Captions, Clip, NameCard, slots } from "./Main.jsx";

const XFADE = 6;     // frames of cross-fade between two scenes
const DRAW_ON = 10;  // frames a drawn scene takes to be drawn on
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };

function MixScene({ s, i, look, rtl, width, height, captions, font, accent }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const fade = i === 0 ? 1 : interpolate(frame, [0, XFADE], [0, 1], clamp);
  const theme = explainerTheme(look);
  const drawing = s.kind !== "footage" && s.x ? { ...s.x, i, dur: s.dur } : null;
  const dir = { direction: rtl ? "rtl" : "ltr" };
  if (s.kind === "drawn") {
    setExplainerTheme(look, width, height, rtl);
    const p = i === 0 ? 1 : interpolate(frame, [0, DRAW_ON], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
    return (
      <AbsoluteFill style={{ opacity: fade, background: theme.background }}>
        <Overlay camX={0} />
        <AbsoluteFill style={{ ...dir, clipPath: `inset(0 ${((1 - p) * 100).toFixed(2)}% 0 0)` }}>
          {drawing ? <SceneBody s={drawing} t={t} frame={frame} fps={fps} icons={ICONS} /> : null}
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }
  const overlay = s.kind === "overlay";
  if (overlay) setExplainerTheme(look, width, height, rtl, true);
  return (
    <AbsoluteFill style={{ opacity: fade, overflow: "hidden", background: "#000" }}>
      <AbsoluteFill style={overlay ? { filter: "brightness(.45) blur(7px)", transform: "scale(1.04)" } : null}>
        <Clip clip={s.clip} dur={s.dur} index={i} width={width} height={height} />
      </AbsoluteFill>
      {/* a light grade toward the look, so the cuts between real and drawn don't jump */}
      <AbsoluteFill style={{ background: theme.base, opacity: overlay ? 0.18 : 0.1, mixBlendMode: overlay ? "multiply" : "color" }} />
      {overlay ? null : <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,.25) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 55%, rgba(0,0,0,.45) 100%)" }} />}
      {overlay && drawing ? <AbsoluteFill style={dir}><SceneBody s={drawing} t={t} frame={frame} fps={fps} icons={ICONS} /></AbsoluteFill> : null}
      {!overlay && s.card ? <NameCard card={s.card} font={font} rtl={rtl} width={width} top={slots(captions, false).card} accent={accent} /> : null}
    </AbsoluteFill>
  );
}

export function Mix(props) {
  const { scenes, captions, rtl, width, height, totalFrames, music } = props;
  const look = props.look || "glow";
  const { fps } = useVideoConfig();
  useFonts(props.assetBase);
  const font = rtl ? `"${ARABIC}", "${LATIN}", sans-serif` : `"${LATIN}", "${ARABIC}", sans-serif`;
  const accent = explainerTheme(look).accent;
  const cap = { ...captions, highlight: accent };
  const capTop = width > height ? "83%" : "79%";  // below the drawings' labels, the same on every scene
  const last = scenes[scenes.length - 1];
  const voiceEnd = last ? last.from + last.dur - Math.round(0.7 * fps) : 0;
  const musicVolume = (f) => Number(music?.volume ?? 0.22) * (f < voiceEnd ? MUSIC_UNDER_VOICE : 1)
    * interpolate(f, [0, 8], [0, 1], clamp) * interpolate(f, [totalFrames - 24, totalFrames - 1], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {scenes.map((s, i) => (
        // each scene stays XFADE frames longer, under the next one fading in
        <Sequence key={s.id || i} from={s.from} durationInFrames={s.dur + (i < scenes.length - 1 ? XFADE : 0)} name={`Scene ${i + 1} (${s.kind || "footage"})`}>
          <MixScene s={s} i={i} look={look} rtl={rtl} width={width} height={height} captions={captions} font={font} accent={accent} />
          {captions.enabled ? (
            <Sequence from={0} durationInFrames={s.dur} layout="none">
              <Captions groups={s.groups} cfg={cap} rtl={rtl} font={font} height={height} top={capTop} />
            </Sequence>
          ) : null}
        </Sequence>
      ))}
      {scenes.map((s, i) => (s.voiceUrl ? (
        <Sequence key={`v${s.id || i}`} from={s.from} durationInFrames={s.dur} name={`Voice ${i + 1}`}><Html5Audio src={s.voiceUrl} /></Sequence>
      ) : null))}
      {music?.url ? <Html5Audio src={music.url} loop volume={musicVolume} trimBefore={Math.round(Number(music.start || 0) * fps)} /> : null}
    </AbsoluteFill>
  );
}
