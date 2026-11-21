// The Mix style (settings.style = "mix"): real footage and drawn Explainer scenes in one video, one kind per scene
// (settings.mix.scenes[i].kind, planned by Claude: supabase/functions/explainer "plan" with style "mix"):
//   footage  the stock clip or photo (Clip from Main.jsx, Ken Burns on photos) with its name card, under a light tint of the look
//   drawn    the Explainer drawing (SceneBody) in the look picked, drawn on from left to right in 10 frames
//   overlay  the clip dimmed to 45% and blurred, with a light drawing on top (no background, light ink)
//   map      (Illustrated style) a real map: countries lit and named, a year badge, a ship along a dashed route
//   icons    (Illustrated style) a big word and up to 4 icons popping in on warm paper
// One caption style on every scene (the classic captions, a little lower so they clear the drawings); the captions' highlight,
// the drawings and the name cards share the look's accent. Scenes cross-fade over 6 frames. No transition sound.
import React from "react";
import { AbsoluteFill, Easing, Html5Audio, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { ARABIC, LATIN, useFonts } from "./fonts.js";
import { ICONS } from "./explainer-icons.js";
import { MUSIC_UNDER_VOICE } from "./layout.js";
import { Overlay, SceneBody, explainerTheme, setExplainerTheme } from "./Explainer.jsx";
import { Captions, Clip, NameCard, slots } from "./Main.jsx";
import { MapView, THEMES, ThemeContext, mapPoint } from "./story/kit.js";

const XFADE = 6;     // frames of cross-fade between two scenes
const DRAW_ON = 10;  // frames a drawn scene takes to be drawn on
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };

// ---- the Illustrated style's coded scenes ----
// an old-atlas map: pale land, slate-blue sea, dark borders
const ATLAS = { ...THEMES.paper, sea: "#7f9bb3", land: "#e9e1c3", border: "#4b3d2e", ink: "#2b2118", line: 6 };
/** A real map (kit MapView): the focus countries lit, their names, an optional year badge and a dashed route a ship sails along. */
export function MapScene({ d, frame, dur, width: W, height: H, font }) {
  const focus = (Array.isArray(d.focus) && d.focus.length ? d.focus : ["FR"]).slice(0, 8);
  const p = Math.min(1, frame / Math.max(1, dur));
  const view = { W, H, focus, pad: Number(d.pad) > 0 ? Number(d.pad) : 0.3, zoom: 1 + 0.08 * p };
  const highlight = {};
  for (const c of [].concat(d.highlight || [])) highlight[c] = "#c9a66b";
  const route = Array.isArray(d.route) && d.route.length === 2 ? d.route.map((c) => mapPoint(view, c)) : null;
  const go = Math.min(1, Math.max(0, (frame - 15) / Math.max(20, dur * 0.7)));
  const shipAt = route ? [route[0][0] + (route[1][0] - route[0][0]) * go, route[0][1] + (route[1][1] - route[0][1]) * go] : null;
  return (
    <ThemeContext.Provider value={ATLAS}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0 }}>
        <MapView {...view} highlight={highlight} labels={d.labels && typeof d.labels === "object" ? d.labels : false} />
        {route ? <line x1={route[0][0]} y1={route[0][1]} x2={shipAt[0]} y2={shipAt[1]} stroke="#8b2c22" strokeWidth={6} strokeDasharray="18 14" strokeLinecap="round" /> : null}
        {route ? <g transform={`translate(${shipAt[0]} ${shipAt[1] - 10})`}>
          <path d="M -46 0 Q 0 30 46 0 L 34 14 Q 0 26 -34 14 Z" fill="#7a4a2a" stroke="#2b2118" strokeWidth={4} />
          <line x1={0} y1={0} x2={0} y2={-62} stroke="#2b2118" strokeWidth={5} />
          <rect x={-24} y={-58} width={48} height={44} fill="#f4efe2" stroke="#2b2118" strokeWidth={4} />
          {[-14, 0, 14].map((x) => <rect key={x} x={x - 4} y={-58} width={8} height={44} fill="#b33a2e" />)}
        </g> : null}
        {d.year ? <g transform={`translate(${W * 0.06} ${H * 0.08})`}>
          <rect x={0} y={0} width={Math.max(150, String(d.year).length * 34 + 60)} height={92} rx={14} fill="#efe7d2" stroke="#2b2118" strokeWidth={5} />
          <text x={Math.max(150, String(d.year).length * 34 + 60) / 2} y={64} textAnchor="middle" fontSize={56} fontWeight={800} fill="#2b2118" fontFamily={font}>{String(d.year).slice(0, 12)}</text>
        </g> : null}
        <rect x={0} y={0} width={W} height={H} fill="url(#vig)" />
        <defs><radialGradient id="vig" cx="50%" cy="50%" r="75%"><stop offset="60%" stopColor="#000" stopOpacity="0" /><stop offset="100%" stopColor="#000" stopOpacity="0.35" /></radialGradient></defs>
      </svg>
    </ThemeContext.Provider>
  );
}
/** A big word with up to 4 icons that pop in one after the other (a crossed icon gets a red X), on warm paper. */
export function IconsScene({ d, frame, dur, width: W, height: H, font }) {
  const items = (Array.isArray(d.items) ? d.items : []).slice(0, 4);
  const n = Math.max(items.length, 1);
  const size = Math.min(W / (n + 1.2), H * 0.32);
  const pop = (k) => { const a = 8 + k * Math.min(18, dur / (n + 2)); const t = Math.min(1, Math.max(0, (frame - a) / 10)); return t < 1 ? 1 - Math.pow(1 - t, 3) * (1 - 0.0) : 1; };
  const title = String(d.word || "").slice(0, 40);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0, background: "#f1ece1" }}>
      <defs><radialGradient id="ppr" cx="50%" cy="45%" r="70%"><stop offset="0%" stopColor="#fbf8f1" /><stop offset="100%" stopColor="#e2dccd" /></radialGradient></defs>
      <rect width={W} height={H} fill="url(#ppr)" />
      {title ? <text x={W / 2} y={H * (items.length ? 0.2 : 0.5)} textAnchor="middle" dominantBaseline="middle" fontSize={items.length ? H * 0.1 : H * 0.14} fontWeight={800} fill="#241a12" fontFamily={font}
        opacity={Math.min(1, frame / 8)}>{title}</text> : null}
      {items.map((it, k) => {
        const cx = W * (k + 1) / (n + 1), cy = H * 0.55, t = pop(k);
        const icon = ICONS[it.icon] || ICONS.circle || [];
        return (
          <g key={k} opacity={t} transform={`translate(${cx} ${cy}) scale(${0.6 + 0.4 * t})`}>
            <circle r={size * 0.62} fill={["#f2c14e", "#9cc7a4", "#e9967a", "#9db7d6"][k % 4]} opacity={0.55} />
            <g transform={`translate(${-size * 0.42} ${-size * 0.42}) scale(${(size * 0.84) / 24})`} fill="none" stroke="#241a12" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              {icon.map(([tag, attrs], j) => React.createElement(tag, { key: j, ...attrs }))}
            </g>
            {it.cross ? <g stroke="#c0392b" strokeWidth={size * 0.09} strokeLinecap="round"><line x1={-size * 0.55} y1={-size * 0.55} x2={size * 0.55} y2={size * 0.55} /><line x1={size * 0.55} y1={-size * 0.55} x2={-size * 0.55} y2={size * 0.55} /></g> : null}
            {it.label ? <text y={size * 0.95} textAnchor="middle" fontSize={H * 0.05} fontWeight={800} fill="#241a12" fontFamily={font}>{String(it.label).slice(0, 24)}</text> : null}
          </g>
        );
      })}
    </svg>
  );
}

function MixScene({ s, i, look, rtl, width, height, captions, font, accent, illustrated }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const fade = i === 0 ? 1 : interpolate(frame, [0, XFADE], [0, 1], clamp);
  const theme = explainerTheme(look);
  const drawing = s.kind !== "footage" && s.x ? { ...s.x, i, dur: s.dur } : null;
  const dir = { direction: rtl ? "rtl" : "ltr" };
  if (s.kind === "map" || s.kind === "icons") {
    const Scene = s.kind === "map" ? MapScene : IconsScene;
    return <AbsoluteFill style={{ opacity: fade, ...dir }}><Scene d={s.data || {}} frame={frame} dur={s.dur} width={width} height={height} font={font} /></AbsoluteFill>;
  }
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
      {/* a light grade toward the look, so the cuts between real and drawn don't jump (not on the Illustrated style's paintings) */}
      {illustrated ? null : <AbsoluteFill style={{ background: theme.base, opacity: overlay ? 0.18 : 0.1, mixBlendMode: overlay ? "multiply" : "color" }} />}
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
          <MixScene s={s} i={i} look={look} rtl={rtl} width={width} height={height} captions={captions} font={font} accent={accent} illustrated={!!props.illustrated} />
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
