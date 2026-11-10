// "Explainer" style (settings.style = "explainer"): white glow line-art pictograms on black, a camera sliding right
// from scene to scene, short labels in pills, no stock footage and no sound effects. Each element appears when its
// cue word is spoken (times from video/layout.js explainerScene). Drawn for 9:16.
import React from "react";
import { AbsoluteFill, Easing, Html5Audio, Sequence, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ARABIC, LATIN, useFonts } from "./fonts.js";
import { ICONS } from "./explainer-icons.js";
import { MUSIC_UNDER_VOICE } from "./layout.js";

const W = 1080;
const GROUND = 1250;
let FONT = `"${LATIN}", "${ARABIC}", sans-serif`;
const WHITE = "#F4F7FF";
const ACCENT = "#FFC46B";
const GLOW = "drop-shadow(0 0 3px rgba(255,255,255,.95)) drop-shadow(0 0 12px rgba(150,195,255,.55))";
const GLOW_ACCENT = "drop-shadow(0 0 3px rgba(255,220,160,.95)) drop-shadow(0 0 14px rgba(255,170,60,.6))";
const MOVE = 20; // frames of camera travel between scenes


const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
const ease = Easing.bezier(0.65, 0, 0.35, 1);

// 0 → 1 over `secs` after time `at` (seconds, scene-relative).
function progress(t, at, secs = 0.7) {
  return interpolate(t, [at, at + secs], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
}
function pop(frame, fps, at) {
  return spring({ frame: frame - Math.round(at * fps), fps, config: { damping: 14, stiffness: 160, mass: 0.6 } });
}

// ---------- drawing primitives ----------
function Draw({ nodes, size, p, color = WHITE, width = 1.6, viewBox = "0 0 24 24", glow = GLOW }) {
  return (
    <svg width={size} height={size} viewBox={viewBox} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round"
      style={{ filter: glow, overflow: "visible" }}>
      {nodes.map(([tag, attrs], i) => React.createElement(tag, { key: i, ...attrs, pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - p }))}
    </svg>
  );
}

const PERSON = [
  ["circle", { cx: 30, cy: 15, r: 10 }],
  ["path", { d: "M16 66 V44 a12 12 0 0 1 12 -12 h4 a12 12 0 0 1 12 12 v22" }],
  ["path", { d: "M24 60 V114" }],
  ["path", { d: "M36 60 V114" }],
];
const HAT = [["path", { d: "M15 5 H45" }], ["path", { d: "M21 5 V-9 H39 V5" }]];

function Person({ kind, height, p, bob }) {
  const nodes = kind === "person_hat" ? [...PERSON, ...HAT] : PERSON;
  const h = kind === "child" ? height * 0.66 : height;
  return (
    <div style={{ transform: `translateY(${bob}px)`, height: h, width: h * 0.5, display: "flex", alignItems: "flex-end" }}>
      <svg width={h * 0.5} height={h} viewBox="0 -12 60 128" fill="none" stroke={WHITE} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round"
        style={{ filter: GLOW, overflow: "visible" }}>
        {nodes.map(([tag, attrs], i) => React.createElement(tag, { key: i, ...attrs, pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - p }))}
      </svg>
    </div>
  );
}

function Pill({ text, s, accent }) {
  if (!text) return null;
  const c = accent ? ACCENT : WHITE;
  return (
    <div style={{ transform: `scale(${interpolate(s, [0, 1], [0.6, 1])})`, opacity: Math.min(1, s * 1.5), border: `3px solid ${c}`, borderRadius: 999,
      padding: "10px 26px", color: c, fontFamily: FONT, fontSize: 30, letterSpacing: 2.5, textTransform: "uppercase", whiteSpace: "nowrap",
      filter: accent ? GLOW_ACCENT : GLOW, background: "rgba(5,6,8,.85)" }}>{text}</div>
  );
}

// One item standing on the ground: a figure (or group) or an icon, with its pill.
function Thing({ item, t, frame, fps, icons, size = 230, accent }) {
  const p = progress(t, item.at, 0.8);
  const s = pop(frame, fps, item.at + 0.25);
  const lift = interpolate(p, [0, 1], [30, 0]);
  let body;
  if (item.kind === "icon") {
    body = <Draw nodes={icons[item.icon] || icons.sparkles} size={size} p={p} width={1.4} color={accent ? ACCENT : WHITE} glow={accent ? GLOW_ACCENT : GLOW} />;
  } else {
    const n = Math.max(1, Math.min(6, item.count || 1));
    const h = n > 1 ? size * 1.0 : size * 1.15;
    body = (
      <div style={{ display: "flex", alignItems: "flex-end" }}>
        {Array.from({ length: n }, (_, i) => (
          <div key={i} style={{ marginLeft: i ? -h * 0.16 : 0, opacity: n > 1 && i % 2 ? 0.75 : 1 }}>
            <Person kind={item.kind} height={h} p={progress(t, item.at + i * 0.12, 0.8)} bob={Math.sin((frame + i * 9) / 11) * 2.5} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 34, opacity: Math.min(1, p * 3) }}>
      <div style={{ transform: `translateY(${lift}px)` }}>{body}</div>
      <Pill text={item.label} s={s} accent={accent} />
    </div>
  );
}

// Places a node so that its bottom (the figure's feet / icon base) rests on the ground line, centred on x.
function OnGround({ x, children, y = GROUND }) {
  return <div style={{ position: "absolute", left: x, top: y, transform: "translate(-50%, -100%)" }}>{children}</div>;
}
// Same, but the pill hangs below the ground line: the item column is split at the ground.
function Standing({ x, item, ...rest }) {
  return (
    <div style={{ position: "absolute", left: x, top: GROUND - 2, transform: "translateX(-50%)" }}>
      <div style={{ position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)" }}>
        <ThingBody item={item} {...rest} />
      </div>
      <div style={{ position: "absolute", top: 40, left: "50%", transform: "translateX(-50%)" }}>
        <Pill text={item.label} s={pop(rest.frame, rest.fps, item.at + 0.25)} accent={rest.accent} />
      </div>
    </div>
  );
}
function ThingBody(props) {
  return <Thing {...props} item={{ ...props.item, label: "" }} />;
}

function Heading({ text, t, at = 0.15, y = 470, size = 74, accent = false }) {
  if (!text) return null;
  const words = text.split(/\s+/);
  return (
    <div style={{ position: "absolute", left: 70, right: 70, top: y, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: `0 ${size * 0.28}px`,
      fontFamily: FONT, fontSize: size, lineHeight: 1.12, color: accent ? ACCENT : WHITE, textAlign: "center", textTransform: "uppercase",
      filter: accent ? GLOW_ACCENT : GLOW, transform: "translateY(-50%)" }}>
      {words.map((w, i) => {
        const p = progress(t, at + i * 0.09, 0.45);
        return <span key={i} style={{ opacity: p, transform: `translateY(${(1 - p) * 26}px)`, display: "inline-block" }}>{w}</span>;
      })}
    </div>
  );
}

function Counter({ value, prefix, suffix, t, from, y, size, label }) {
  const p = progress(t, 0.2, 1.4);
  const n = Math.round(interpolate(p, [0, 1], [from, value]));
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: y, transform: "translateY(-50%)", textAlign: "center", fontFamily: FONT, fontSize: size,
      color: ACCENT, filter: GLOW_ACCENT, letterSpacing: 4, fontVariantNumeric: "tabular-nums" }}>
      {prefix}{n}{suffix}
      {label ? <div style={{ fontSize: 34, color: WHITE, filter: GLOW, letterSpacing: 3, marginTop: 6, textTransform: "uppercase" }}>{label}</div> : null}
    </div>
  );
}

// ---------- layouts ----------
function SceneBody({ s, t, frame, fps, icons }) {
  const its = s.items;
  const P = { t, frame, fps, icons };
  switch (s.layout) {
    case "title": {
      const it = its[0];
      return (
        <>
          <Heading text={s.heading} t={t} y={it ? 560 : 760} size={96} />
          {it ? <Standing x={W / 2} item={it} {...P} size={300} accent /> : null}
        </>
      );
    }
    case "journey": {
      const [a, b, mover] = its;
      const ax = 210, bx = 870, ay = 980, top = 560;
      const arcStart = a ? a.at + 0.3 : 0.3;
      const arcEnd = b ? Math.max(arcStart + 0.8, b.at) : arcStart + 1.5;
      const ap = progress(t, arcStart, arcEnd - arcStart);
      const d = `M ${ax} ${ay} Q ${W / 2} ${top - 120} ${bx} ${ay}`;
      const go = mover ? Math.min(mover.at, (a ? a.at : 0) + 0.5) : 0;
      const end = Math.max(go + 1.2, s.dur / fps - 0.2);
      const mp = mover ? interpolate(t, [go, end], [0, 1], { ...clamp, easing: ease }) : 0;
      const qx = (u) => (1 - u) ** 2 * ax + 2 * (1 - u) * u * (W / 2) + u ** 2 * bx;
      const qy = (u) => (1 - u) ** 2 * ay + 2 * (1 - u) * u * (top - 120) + u ** 2 * ay;
      return (
        <>
          <Heading text={s.heading} t={t} y={400} />
          <svg width={W} height={1920} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", filter: GLOW }}>
            <path d={d} fill="none" stroke={WHITE} strokeWidth={4} strokeDasharray="4 22" strokeLinecap="round" pathLength={1000} mask={`url(#m${s.i})`} />
            <defs>
              <mask id={`m${s.i}`} maskUnits="userSpaceOnUse">
                <path d={d} fill="none" stroke="#fff" strokeWidth={14} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - ap} />
              </mask>
            </defs>
          </svg>
          {a ? <Standing x={ax} item={a} {...P} size={190} /> : null}
          {b ? <Standing x={bx} item={b} {...P} size={190} accent /> : null}
          {mover ? (
            <div style={{ position: "absolute", left: qx(mp), top: qy(mp) - 120, transform: "translate(-50%, -50%)", opacity: progress(t, go, 0.3) }}>
              <Thing item={{ ...mover, label: "", at: go }} {...P} size={150} />
              <div style={{ position: "absolute", top: "105%", left: "50%", transform: "translateX(-50%)" }}>
                <Pill text={mover.label} s={pop(frame, fps, mover.at + 0.25)} />
              </div>
            </div>
          ) : null}
        </>
      );
    }
    case "compare": {
      const [a, b] = its;
      const lp = progress(t, b ? b.at - 0.3 : 0.5, 0.6);
      return (
        <>
          <Heading text={s.heading} t={t} />
          <div style={{ position: "absolute", left: W / 2 - 2, top: 700, width: 4, height: (GROUND - 700 + 140) * lp, background: `repeating-linear-gradient(${WHITE} 0 8px, transparent 8px 26px)`, filter: GLOW }} />
          <div style={{ position: "absolute", left: W / 2, top: 900, transform: `translate(-50%,-50%) scale(${lp})`, width: 96, height: 96, borderRadius: 99,
            border: `3px solid ${ACCENT}`, background: "#050608", color: ACCENT, fontFamily: FONT, fontSize: 34, display: "flex", alignItems: "center", justifyContent: "center", filter: GLOW_ACCENT }}>VS</div>
          {a ? <Standing x={265} item={a} {...P} size={210} /> : null}
          {b ? <Standing x={815} item={b} {...P} size={210} accent /> : null}
        </>
      );
    }
    case "checklist": {
      const top = s.heading ? 650 : 600;
      return (
        <>
          <Heading text={s.heading} t={t} y={470} />
          {its.slice(0, 4).map((it, i) => {
            const p = progress(t, it.at, 0.5);
            const c = progress(t, it.at + 0.35, 0.45);
            return (
              <div key={i} style={{ position: "absolute", left: 120, right: 90, top: top + i * 150, display: "flex", alignItems: "center", gap: 34, opacity: p,
                transform: `translateX(${(1 - p) * 60}px)` }}>
                <svg width={78} height={78} viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ filter: c > 0 ? GLOW_ACCENT : GLOW, flex: "none" }}>
                  <rect x={2} y={2} width={20} height={20} rx={5} stroke={c > 0.99 ? ACCENT : WHITE} strokeWidth={1.6} />
                  <path d="M6.5 12.5 L10.5 16.5 L17.5 8" stroke={ACCENT} strokeWidth={2.4} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - c} />
                </svg>
                {it.kind === "icon" ? <Draw nodes={icons[it.icon] || icons.sparkles} size={86} p={p} /> : <Person kind={it.kind} height={110} p={p} bob={0} />}
                <div style={{ fontFamily: FONT, fontSize: 50, color: WHITE, filter: GLOW, textTransform: "uppercase", letterSpacing: 1.5, lineHeight: 1.1 }}>{it.label}</div>
              </div>
            );
          })}
        </>
      );
    }
    case "year": {
      return (
        <>
          <Counter value={s.number} prefix={s.number_prefix} suffix={s.number_suffix} t={t} from={Math.max(0, s.number - 60)} y={560} size={210} />
          <Heading text={s.heading} t={t} at={0.9} y={790} size={60} />
          {its.slice(0, 3).map((it, i, arr) => <Standing key={i} x={(W / (arr.length + 1)) * (i + 1)} item={it} {...P} size={170} />)}
        </>
      );
    }
    case "stat": {
      const pct = String(s.number_suffix).includes("%"); const n = pct ? 100 : Math.max(1, Math.min(100, s.number)); const hl = s.highlight || (pct ? s.number : 0);
      const cols = 10, gap = 66, gx = (W - (cols - 1) * gap) / 2, gy = 780;
      return (
        <>
          <Heading text={s.heading} t={t} y={420} size={58} />
          <Counter value={s.number} prefix={s.number_prefix} suffix={s.number_suffix} t={t} from={0} y={600} size={150} />
          {Array.from({ length: n }, (_, i) => {
            const at = 0.6 + i * (1.6 / n);
            const p = progress(t, at, 0.25);
            const hi = i < hl && t > 2.4 + (i / Math.max(1, hl)) * 0.8;
            return <div key={i} style={{ position: "absolute", left: gx + (i % cols) * gap, top: gy + Math.floor(i / cols) * gap, width: 30, height: 30, borderRadius: 99,
              transform: `translate(-50%,-50%) scale(${p})`, border: `3px solid ${hi ? ACCENT : WHITE}`, background: hi ? ACCENT : "transparent",
              opacity: hi ? 1 : 0.8, filter: hi ? GLOW_ACCENT : GLOW }} />;
          })}
        </>
      );
    }
    case "quote": {
      const it = its[0];
      const words = (s.heading || "").split(/\s+/).filter(Boolean);
      return (
        <>
          <div style={{ position: "absolute", left: 90, top: 380, fontFamily: FONT, fontSize: 200, color: ACCENT, filter: GLOW_ACCENT, opacity: progress(t, 0.1, 0.4), lineHeight: 1 }}>“</div>
          <div style={{ position: "absolute", left: 110, right: 110, top: 760, transform: "translateY(-50%)", display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0 18px",
            fontFamily: FONT, fontSize: 64, lineHeight: 1.2, color: WHITE, filter: GLOW, textAlign: "center" }}>
            {words.map((w, i) => {
              const p = progress(t, 0.3 + i * 0.16, 0.35);
              return <span key={i} style={{ opacity: p, transform: `translateY(${(1 - p) * 18}px)`, display: "inline-block" }}>{w}</span>;
            })}
          </div>
          {it ? <Standing x={W / 2} item={it} {...P} size={180} /> : null}
        </>
      );
    }
    default: { // row
      const list = its.slice(0, 4);
      const size = list.length >= 4 ? 150 : list.length === 3 ? 180 : 220;
      return (
        <>
          <Heading text={s.heading} t={t} />
          {list.map((it, i) => <Standing key={i} x={(W / (list.length + 1)) * (i + 1)} item={it} {...P} size={size} />)}
        </>
      );
    }
  }
}

// ---------- captions ----------
function chunks(words) {
  const out = [];
  let cur = [];
  words.forEach((w, i) => {
    cur.push(w);
    if (cur.length >= 5 || w.p || /[.,!?;:]$/.test(w.w) || i === words.length - 1) { out.push(cur); cur = []; }
  });
  return out;
}
function Captions({ words, t }) {
  const groups = React.useMemo(() => chunks(words), [words]);
  const g = groups.find((c, i) => t >= c[0].s - 0.05 && (i === groups.length - 1 || t < groups[i + 1][0].s - 0.05));
  if (!g || t > g[g.length - 1].e + 0.6) return null;
  return (
    <div style={{ position: "absolute", left: 70, right: 70, top: 1590, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0 16px",
      fontFamily: FONT, fontSize: 50, lineHeight: 1.2, textAlign: "center" }}>
      {g.map((w, i) => {
        const on = t >= w.s - 0.03;
        return <span key={i} style={{ color: on ? WHITE : "rgba(244,247,255,.35)", filter: on ? GLOW : "none" }}>{w.w}</span>;
      })}
    </div>
  );
}

// ---------- background ----------
function Dust({ camX, total }) {
  const dots = React.useMemo(() => Array.from({ length: 90 }, (_, i) => ({ x: random(`x${i}`) * total, y: random(`y${i}`) * 1920, r: 1 + random(`r${i}`) * 2.2, o: 0.15 + random(`o${i}`) * 0.35 })), [total]);
  return (
    <AbsoluteFill style={{ transform: `translateX(${-camX * 0.3}px)` }}>
      {dots.map((d, i) => <div key={i} style={{ position: "absolute", left: d.x, top: d.y, width: d.r * 2, height: d.r * 2, borderRadius: 99, background: "#9fb8ff", opacity: d.o }} />)}
    </AbsoluteFill>
  );
}

export function Explainer(props) {
  const { scenes: list, music, rtl, totalFrames } = props;
  useFonts(props.assetBase);
  FONT = rtl ? `"${ARABIC}", "${LATIN}", sans-serif` : `"${LATIN}", "${ARABIC}", sans-serif`;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const icons = ICONS;
  const scenes = React.useMemo(() => list.map((s, i) => ({ ...(s.x || { layout: "title", heading: "", items: [] }), i, from: s.from, dur: s.dur, voiceUrl: s.voiceUrl, id: s.id,
    words: (s.groups || []).flatMap((g) => g.words.map((w, k) => ({ ...w, p: k === g.words.length - 1 }))) })), [list]);
  if (!scenes.length) return <AbsoluteFill style={{ background: "#050608" }} />;
  let idx = 0;
  for (let i = 0; i < scenes.length; i++) if (frame >= scenes[i].from) idx = i;
  const cur = scenes[idx];
  const mp = idx === 0 ? 1 : interpolate(frame - cur.from, [0, MOVE], [0, 1], { ...clamp, easing: ease });
  const camX = (idx - 1 + mp) * W;
  const worldW = (scenes.length + 1) * W;
  const last = scenes[scenes.length - 1];
  const voiceEnd = last.from + last.dur - Math.round(0.7 * fps);
  const musicVolume = (f) => Number(music?.volume ?? 0.22) * (f < voiceEnd ? MUSIC_UNDER_VOICE : 1)
    * interpolate(f, [0, 8], [0, 1], clamp) * interpolate(f, [totalFrames - 24, totalFrames - 1], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 42%, #0d1220 0%, #050608 62%)", direction: "ltr" }}>
      <Dust camX={camX} total={worldW} />
      <AbsoluteFill style={{ transform: `translateX(${-camX}px)` }}>
        <div style={{ position: "absolute", left: -W, top: GROUND, width: worldW + 2 * W, height: 6,
          background: "radial-gradient(circle, rgba(244,247,255,.85) 2.6px, transparent 3.2px) 0 0 / 30px 6px repeat-x", filter: GLOW }} />
        {scenes.map((s, i) => {
          if (Math.abs(i - idx) > 1) return null;
          const t = (frame - s.from) / fps;
          return (
            <div key={s.id || i} style={{ position: "absolute", left: i * W, top: 0, width: W, height: 1920, direction: rtl ? "rtl" : "ltr" }}>
              {t >= -0.05 || i <= idx ? <SceneBody s={s} t={t} frame={frame - s.from} fps={fps} icons={icons} /> : null}
            </div>
          );
        })}
      </AbsoluteFill>
      <div style={{ direction: rtl ? "rtl" : "ltr" }}><Captions words={cur.words} t={(frame - cur.from) / fps} /></div>
      {scenes.map((s, i) => (s.voiceUrl ? (
        <Sequence key={`v${s.id || i}`} from={s.from} durationInFrames={s.dur} name={`Voice ${i + 1}`}>
          <Html5Audio src={s.voiceUrl} />
        </Sequence>
      ) : null))}
      {music?.url ? <Html5Audio src={music.url} loop volume={musicVolume} trimBefore={Math.round(Number(music.start || 0) * fps)} /> : null}
    </AbsoluteFill>
  );
}
