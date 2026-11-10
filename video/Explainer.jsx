// The Animation styles (settings.style = "explainer", settings.explainer.look), drawn for 9:16 Shorts and 16:9 YouTube
// videos (G: the layout of each), no stock footage and no sound effects. Each element appears when its cue word is spoken (times from video/layout.js explainerScene).
//   glow        white glowing line-art pictograms on black, a camera sliding right from scene to scene, labels in pills
//   whiteboard  the same scenes drawn in marker on paper, in a hand-written face
//   kinetic     kinetic typography: the narration itself, a few words at a time, big, on colour blocks that change per scene
//   and ten more themes of the same scenes (THEMES): blueprint, chalkboard, neon, comic, terminal, vintage, clean, sunset,
//   badges (icons on flat colour discs), notes (sticky notes on a cork board)
import React from "react";
import { AbsoluteFill, Easing, Html5Audio, Sequence, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ARABIC, COMIC, HAND, LATIN, MONO, SERIF, useFonts } from "./fonts.js";
import { ICONS } from "./explainer-icons.js";
import { EXPLAINER_LOOKS, MUSIC_UNDER_VOICE } from "./layout.js";

const MOVE = 20;      // frames of camera travel between scenes

// Where things go, for a vertical Short and for a horizontal YouTube video. `ground` is where figures stand (no line
// is drawn: each one gets a soft shadow).
const GEO = {
  portrait: { W: 1080, H: 1920, ground: 1250, head: 470, side: 70, capY: 1590, capSize: 50, capSide: 70,
    title: { y: 560, yAlone: 760, size: 96, item: 300 },
    journey: { head: 400, ax: 210, bx: 870, ay: 980, ctrl: 440, lift: 120, size: 190, mover: 150 },
    compare: { lineTop: 700, lineBelow: 140, vsY: 900, ax: 265, bx: 815, size: 210 },
    checklist: { head: 470, top: 650, topAlone: 600, gap: 150, left: 120, right: 90 },
    year: { y: 560, size: 210, head: 790, item: 170 },
    stat: { head: 420, y: 600, size: 150, cols: 10, gap: 66, gy: 780 },
    quote: { markY: 380, markX: 90, y: 760, side: 110, item: 180 },
    row: [220, 220, 180, 150],
    kin: { tag: 250, num: 520, numSize: 200, icon: 430, iconSize: 260, words: 1120, side: 70, width: 900, max: 230 },
  },
  landscape: { W: 1920, H: 1080, ground: 770, head: 190, side: 230, capY: 935, capSize: 44, capSide: 340,
    title: { y: 300, yAlone: 470, size: 90, item: 250 },
    journey: { head: 150, ax: 420, bx: 1500, ay: 540, ctrl: 230, lift: 100, size: 170, mover: 130 },
    compare: { lineTop: 300, lineBelow: 80, vsY: 520, ax: 620, bx: 1300, size: 190 },
    checklist: { head: 170, top: 300, topAlone: 250, gap: 125, left: 560, right: 380 },
    year: { y: 300, size: 190, head: 480, item: 150 },
    stat: { head: 140, y: 270, size: 130, cols: 20, gap: 54, gy: 440 },
    quote: { markY: 140, markX: 260, y: 420, side: 300, item: 160 },
    row: [200, 200, 170, 150],
    kin: { tag: 44, num: 150, numSize: 170, icon: 130, iconSize: 180, words: 650, side: 160, width: 1500, max: 210, row: true },
  },
};
let G = GEO.portrait;

const THEMES = {
  glow: {
    background: "radial-gradient(ellipse at 50% 42%, #0d1220 0%, #050608 62%)", base: "#050608",
    ink: "#F4F7FF", accent: "#FFC46B", dim: "rgba(244,247,255,.35)", pillBg: "rgba(5,6,8,.85)",
    glow: "drop-shadow(0 0 3px rgba(255,255,255,.95)) drop-shadow(0 0 12px rgba(150,195,255,.55))",
    glowAccent: "drop-shadow(0 0 3px rgba(255,220,160,.95)) drop-shadow(0 0 14px rgba(255,170,60,.6))",
    shadow: "radial-gradient(closest-side, rgba(150,195,255,.32), rgba(150,195,255,0))",
    iconW: 1.4, personW: 3.2, hand: false, dust: "#9fb8ff", upper: true,
  },
  whiteboard: {
    background: "radial-gradient(ellipse at 50% 40%, #FFFFFF 0%, #F3F1EA 70%, #E9E6DC 100%)", base: "#F6F4EE",
    ink: "#1E2229", accent: "#D93B3B", dim: "rgba(30,34,41,.32)", pillBg: "rgba(255,255,255,.9)",
    glow: "none", glowAccent: "none",
    shadow: "radial-gradient(closest-side, rgba(30,34,41,.16), rgba(30,34,41,0))",
    iconW: 1.7, personW: 3.6, hand: true, dust: null, upper: false,
  },
};
// every theme starts from these and changes what makes it itself
const BASE = { font: "sans", upper: true, pill: "round", heading: "rise", underline: false, overlay: null, badges: null, tilt: 0 };
const hardShadow = "drop-shadow(5px 5px 0 #111)";
Object.assign(THEMES, {
  blueprint: { background: "linear-gradient(180deg, #123F7C 0%, #0C2F60 100%)", base: "#0C2F60", ink: "#EAF2FF", accent: "#FFD166", dim: "rgba(234,242,255,.4)",
    pillBg: "rgba(12,47,96,.9)", glow: "drop-shadow(0 0 2px rgba(234,242,255,.5))", glowAccent: "drop-shadow(0 0 3px rgba(255,209,102,.6))",
    shadow: "radial-gradient(closest-side, rgba(234,242,255,.18), rgba(234,242,255,0))", iconW: 1.2, personW: 2.8, dust: null, font: "mono", pill: "box", overlay: "grid" },
  chalkboard: { background: "radial-gradient(ellipse at 50% 45%, #355C47 0%, #22402F 70%, #1A3125 100%)", base: "#22402F", ink: "#F3F1E7", accent: "#FFE27A",
    dim: "rgba(243,241,231,.35)", pillBg: "rgba(34,64,47,.9)", glow: "drop-shadow(0 0 1.5px rgba(243,241,231,.7))", glowAccent: "drop-shadow(0 0 2px rgba(255,226,122,.7))",
    shadow: "radial-gradient(closest-side, rgba(243,241,231,.14), rgba(243,241,231,0))", iconW: 1.8, personW: 3.8, dust: null, font: "hand", upper: false, hand: true,
    underline: true, pill: "chalk", overlay: "grain", tilt: -1.5 },
  neon: { background: "radial-gradient(ellipse at 50% 40%, #2A0650 0%, #12002B 60%, #07000F 100%)", base: "#12002B", ink: "#FF5FD9", accent: "#3CF5FF",
    dim: "rgba(255,95,217,.35)", pillBg: "rgba(18,0,43,.85)",
    glow: "drop-shadow(0 0 4px rgba(255,95,217,1)) drop-shadow(0 0 18px rgba(255,60,200,.8))", glowAccent: "drop-shadow(0 0 4px rgba(60,245,255,1)) drop-shadow(0 0 18px rgba(60,245,255,.8))",
    shadow: "radial-gradient(closest-side, rgba(255,95,217,.35), rgba(255,95,217,0))", iconW: 1.5, personW: 3.4, dust: "#FF8BE5" },
  comic: { background: "radial-gradient(ellipse at 50% 45%, #FFE766 0%, #FFD21F 75%, #F5B700 100%)", base: "#FFD21F", ink: "#111111", accent: "#E63946",
    dim: "rgba(17,17,17,.35)", pillBg: "#FFFFFF", glow: hardShadow, glowAccent: hardShadow,
    shadow: "radial-gradient(closest-side, rgba(17,17,17,.25), rgba(17,17,17,0))", iconW: 2.2, personW: 4.6, dust: null, font: "comic", pill: "hard", overlay: "halftone", tilt: -2 },
  terminal: { background: "radial-gradient(ellipse at 50% 45%, #06170B 0%, #020804 75%)", base: "#020804", ink: "#43FF7A", accent: "#E8FFE0",
    dim: "rgba(67,255,122,.3)", pillBg: "rgba(2,8,4,.9)", glow: "drop-shadow(0 0 3px rgba(67,255,122,.9))", glowAccent: "drop-shadow(0 0 3px rgba(232,255,224,.9))",
    shadow: "radial-gradient(closest-side, rgba(67,255,122,.2), rgba(67,255,122,0))", iconW: 1.3, personW: 3, dust: null, font: "mono", upper: false, pill: "tag",
    heading: "type", overlay: "scan" },
  vintage: { background: "radial-gradient(ellipse at 50% 45%, #F4EAD2 0%, #E9DAB8 70%, #D9C59B 100%)", base: "#EFE3C8", ink: "#3B2A1A", accent: "#9C2F1F",
    dim: "rgba(59,42,26,.35)", pillBg: "rgba(244,234,210,.92)", glow: "none", glowAccent: "none",
    shadow: "radial-gradient(closest-side, rgba(59,42,26,.18), rgba(59,42,26,0))", iconW: 1.5, personW: 3.4, dust: null, font: "serif", upper: false, pill: "frame", overlay: "grain" },
  clean: { background: "#FFFFFF", base: "#FFFFFF", ink: "#111827", accent: "#2563EB", dim: "rgba(17,24,39,.3)", pillBg: "#F1F3F7", glow: "none", glowAccent: "none",
    shadow: "radial-gradient(closest-side, rgba(17,24,39,.12), rgba(17,24,39,0))", iconW: 1.4, personW: 3.2, dust: null, upper: false, pill: "soft" },
  sunset: { background: "linear-gradient(180deg, #2B1055 0%, #6E2B8C 42%, #D7566F 75%, #FF9A62 100%)", base: "#6E2B8C", ink: "#FFF4EA", accent: "#FFD36E",
    dim: "rgba(255,244,234,.4)", pillBg: "rgba(43,16,85,.55)", glow: "drop-shadow(0 0 3px rgba(255,244,234,.8)) drop-shadow(0 0 14px rgba(255,170,120,.45))",
    glowAccent: "drop-shadow(0 0 3px rgba(255,211,110,.9)) drop-shadow(0 0 14px rgba(255,180,80,.55))",
    shadow: "radial-gradient(closest-side, rgba(255,244,234,.25), rgba(255,244,234,0))", iconW: 1.4, personW: 3.2, dust: "#FFE1C4" },
  badges: { background: "#F2F6F5", base: "#F2F6F5", ink: "#1D3557", accent: "#E76F51", dim: "rgba(29,53,87,.3)", pillBg: "#1D3557", glow: "none", glowAccent: "none",
    shadow: "radial-gradient(closest-side, rgba(29,53,87,.14), rgba(29,53,87,0))", iconW: 1.6, personW: 3.4, dust: null, upper: false, pill: "solid",
    badges: ["#F4A261", "#2A9D8F", "#E9C46A", "#8ECAE6", "#E76F51"] },
  notes: { background: "#B98A57", base: "#B98A57", ink: "#2B2B2B", accent: "#C1121F", dim: "rgba(43,43,43,.35)", pillBg: "#FFF27A",
    glow: "drop-shadow(0 2px 0 rgba(0,0,0,.12))", glowAccent: "drop-shadow(0 2px 0 rgba(0,0,0,.12))",
    shadow: "radial-gradient(closest-side, rgba(0,0,0,.22), rgba(0,0,0,0))", iconW: 1.7, personW: 3.6, dust: null, font: "hand", upper: false, hand: true,
    pill: "note", overlay: "cork", tilt: -2 },
});
for (const k of Object.keys(THEMES)) THEMES[k] = { ...BASE, ...(k === "whiteboard" ? { font: "hand", upper: false, underline: true, tilt: -1.5, pill: "marker" } : {}), ...THEMES[k] };
let T = THEMES.glow;
const TS = () => ({ hand: 1.12, comic: 1.3, mono: 0.9, serif: 1.04 }[T.font] || 1);
let FONT = `"${LATIN}", "${ARABIC}", sans-serif`;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
const ease = Easing.bezier(0.65, 0, 0.35, 1);

// 0 → 1 over `secs` after time `at` (seconds, scene-relative).
function progress(t, at, secs = 0.7) {
  return interpolate(t, [at, at + secs], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
}
function pop(frame, fps, at) {
  return spring({ frame: frame - Math.round(at * fps), fps, config: { damping: 14, stiffness: 160, mass: 0.6 } });
}
const norm = (w) => String(w || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]/gu, "");

// ---------- drawing primitives ----------
function Draw({ nodes, size, p, color, width, glow }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || T.ink} strokeWidth={width || T.iconW} strokeLinecap="round" strokeLinejoin="round"
      style={{ filter: glow || T.glow, overflow: "visible" }}>
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

function Person({ kind, height, p, bob, color }) {
  const nodes = kind === "person_hat" ? [...PERSON, ...HAT] : PERSON;
  const h = kind === "child" ? height * 0.66 : height;
  return (
    <div style={{ transform: `translateY(${bob}px)`, height: h, width: h * 0.5, display: "flex", alignItems: "flex-end" }}>
      <svg width={h * 0.5} height={h} viewBox="0 -12 60 128" fill="none" stroke={color || T.ink} strokeWidth={T.personW} strokeLinecap="round" strokeLinejoin="round"
        style={{ filter: T.glow, overflow: "visible" }}>
        {nodes.map(([tag, attrs], i) => React.createElement(tag, { key: i, ...attrs, pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - p }))}
      </svg>
    </div>
  );
}

// a label: each theme has its own shape (pill, marker, box, comic panel, code tag, frame, sticky note...)
const PILLS = {
  round: (c) => ({ border: `3px solid ${c}`, borderRadius: 999 }),
  marker: (c) => ({ border: `3px solid ${c}`, borderRadius: "18px 26px 20px 24px" }),
  chalk: (c) => ({ border: `3px dashed ${c}`, borderRadius: "16px 24px 18px 22px" }),
  box: (c) => ({ border: `2px solid ${c}`, borderRadius: 4 }),
  hard: () => ({ border: "4px solid #111", borderRadius: 6, boxShadow: "6px 6px 0 #111", color: "#111" }),
  tag: () => ({ border: "none", padding: "6px 8px" }),
  frame: (c) => ({ border: `4px double ${c}`, borderRadius: 2 }),
  soft: () => ({ border: "none", borderRadius: 999 }),
  solid: () => ({ border: "none", borderRadius: 999, color: "#FFFFFF" }),
  note: () => ({ border: "none", borderRadius: 2, boxShadow: "0 8px 14px rgba(0,0,0,.28)", color: "#2B2B2B", padding: "16px 26px 18px" }),
};
function Pill({ text, s, accent, room }) {
  if (!text) return null;
  const c = accent ? T.accent : T.ink;
  const shape = (PILLS[T.pill] || PILLS.round)(c);
  const tight = room && room < 300;
  return (
    <div style={{ transform: `scale(${interpolate(s, [0, 1], [0.6, 1])}) rotate(${T.tilt}deg)`, opacity: Math.min(1, s * 1.5), padding: tight ? "8px 14px" : "10px 26px", color: c,
      fontFamily: FONT, fontSize: (tight ? 24 : 30) * TS(), letterSpacing: T.upper ? (tight ? 1 : 2.5) : 0.5, textTransform: T.upper ? "uppercase" : "none",
      whiteSpace: tight ? "normal" : "nowrap", maxWidth: room ? room - 16 : undefined, textAlign: "center", lineHeight: 1.15,
      filter: T.pill === "hard" || T.pill === "note" ? "none" : accent ? T.glowAccent : T.glow, background: T.pill === "note" && accent ? "#FFB3C1" : T.pillBg, ...shape }}>
      {T.pill === "tag" ? `[ ${text} ]` : text}
    </div>
  );
}

// One item: a figure (or group) or an icon, with its pill.
function Thing({ item, t, frame, fps, icons, size = 230, accent }) {
  const p = progress(t, item.at, 0.8);
  const s = pop(frame, fps, item.at + 0.25);
  const lift = interpolate(p, [0, 1], [30, 0]);
  let body;
  if (item.kind === "icon" && T.badges) {
    const fill = T.badges[Math.abs([...String(item.label || item.icon)].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7)) % T.badges.length];
    body = (
      <div style={{ width: size * 1.15, height: size * 1.15, borderRadius: "50%", background: fill, display: "flex", alignItems: "center", justifyContent: "center",
        transform: `scale(${interpolate(p, [0, 1], [0.4, 1])})`, boxShadow: "0 10px 0 rgba(29,53,87,.12)" }}>
        <Draw nodes={icons[item.icon] || icons.sparkles} size={size * 0.62} p={p} color="#FFFFFF" width={2} glow="none" />
      </div>
    );
  } else if (item.kind === "icon") {
    body = <Draw nodes={icons[item.icon] || icons.sparkles} size={size} p={p} color={accent ? T.accent : T.ink} glow={accent ? T.glowAccent : T.glow} />;
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

// An item standing at the ground height, its soft shadow under it and its pill below.
function Standing({ x, item, room, ...rest }) {
  const p = progress(rest.t, item.at, 0.8);
  const wide = (rest.size || 230) * (item.kind === "icon" ? 0.9 : Math.min(2.4, 0.55 + 0.32 * (item.count || 1)));
  return (
    <div style={{ position: "absolute", left: x, top: G.ground - 2, transform: "translateX(-50%)" }}>
      <div style={{ position: "absolute", top: -14, left: "50%", width: wide, height: 28, transform: `translateX(-50%) scaleX(${p})`, background: T.shadow }} />
      <div style={{ position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)" }}>
        <Thing {...rest} item={{ ...item, label: "" }} />
      </div>
      <div style={{ position: "absolute", top: 40, left: "50%", transform: "translateX(-50%)" }}>
        <Pill text={item.label} s={pop(rest.frame, rest.fps, item.at + 0.25)} accent={rest.accent} room={room} />
      </div>
    </div>
  );
}

function Heading({ text, t, at = 0.15, y = G.head, size = 74, accent = false }) {
  if (!text) return null;
  const words = text.split(/\s+/);
  const fs = size * (T.font === "mono" ? 0.82 : TS());
  if (T.heading === "type") {
    const shown = Math.floor(interpolate(t, [at, at + text.length * 0.035], [0, text.length], clamp));
    const blink = Math.floor(t * 2.5) % 2 === 0 || shown < text.length;
    return (
      <div style={{ position: "absolute", left: G.side, right: G.side, top: y, transform: "translateY(-50%)", textAlign: "center", fontFamily: FONT, fontSize: fs,
        lineHeight: 1.15, color: accent ? T.accent : T.ink, filter: accent ? T.glowAccent : T.glow }}>
        <span style={{ opacity: 0.6 }}>{"> "}</span>{text.slice(0, shown)}<span style={{ opacity: blink ? 1 : 0 }}>▍</span>
      </div>
    );
  }
  return (
    <div style={{ position: "absolute", left: G.side, right: G.side, top: y, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: `0 ${fs * 0.28}px`,
      fontFamily: FONT, fontSize: fs, lineHeight: 1.12, color: accent ? T.accent : T.ink, textAlign: "center", textTransform: T.upper ? "uppercase" : "none",
      filter: accent ? T.glowAccent : T.glow, transform: "translateY(-50%)" }}>
      {words.map((w, i) => {
        const p = progress(t, at + i * 0.09, 0.45);
        return <span key={i} style={{ opacity: p, transform: `translateY(${(1 - p) * 26}px)`, display: "inline-block" }}>{w}</span>;
      })}
      {T.underline ? <Underline t={t} at={at + words.length * 0.09} /> : null}
    </div>
  );
}
// the marker line under a whiteboard heading
function Underline({ t, at }) {
  const p = progress(t, at, 0.5);
  return (
    <svg width="100%" height={26} viewBox="0 0 600 26" preserveAspectRatio="none" style={{ display: "block", flexBasis: "100%", marginTop: 4 }}>
      <path d="M 120 16 C 240 6, 380 22, 480 10" fill="none" stroke={T.accent} strokeWidth={7} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
    </svg>
  );
}

function Counter({ value, prefix, suffix, t, from, y, size }) {
  const p = progress(t, 0.2, 1.4);
  const n = Math.round(interpolate(p, [0, 1], [from, value]));
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: y, transform: "translateY(-50%)", textAlign: "center", fontFamily: FONT, fontSize: size * TS(),
      color: T.accent, filter: T.glowAccent, letterSpacing: 4, fontVariantNumeric: "tabular-nums" }}>
      {prefix}{n}{suffix}
    </div>
  );
}

// ---------- scene layouts (glow and whiteboard) ----------
function SceneBody({ s, t, frame, fps, icons }) {
  const its = s.items;
  const P = { t, frame, fps, icons };
  const W = G.W;
  switch (s.layout) {
    case "title": {
      const it = its[0], L = G.title;
      return (
        <>
          <Heading text={s.heading} t={t} y={it ? L.y : L.yAlone} size={L.size} />
          {it ? <Standing x={W / 2} item={it} {...P} size={L.item} accent /> : null}
        </>
      );
    }
    case "journey": {
      const [a, b, mover] = its;
      const L = G.journey, ax = L.ax, bx = L.bx, ay = L.ay, cy = L.ctrl;
      const arcStart = a ? a.at + 0.3 : 0.3;
      const arcEnd = b ? Math.max(arcStart + 0.8, b.at) : arcStart + 1.5;
      const ap = progress(t, arcStart, arcEnd - arcStart);
      const d = `M ${ax} ${ay} Q ${W / 2} ${cy} ${bx} ${ay}`;
      const go = mover ? Math.min(mover.at, (a ? a.at : 0) + 0.5) : 0;
      const end = Math.max(go + 1.2, s.dur / fps - 0.2);
      const mp = mover ? interpolate(t, [go, end], [0, 1], { ...clamp, easing: ease }) : 0;
      const qx = (u) => (1 - u) ** 2 * ax + 2 * (1 - u) * u * (W / 2) + u ** 2 * bx;
      const qy = (u) => (1 - u) ** 2 * ay + 2 * (1 - u) * u * cy + u ** 2 * ay;
      return (
        <>
          <Heading text={s.heading} t={t} y={L.head} />
          <svg width={W} height={G.H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", filter: T.glow }}>
            <path d={d} fill="none" stroke={T.ink} strokeWidth={4} strokeDasharray="4 22" strokeLinecap="round" pathLength={1000} mask={`url(#m${s.i})`} />
            <defs>
              <mask id={`m${s.i}`} maskUnits="userSpaceOnUse">
                <path d={d} fill="none" stroke="#fff" strokeWidth={14} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - ap} />
              </mask>
            </defs>
          </svg>
          {a ? <Standing x={ax} item={a} {...P} size={L.size} /> : null}
          {b ? <Standing x={bx} item={b} {...P} size={L.size} accent /> : null}
          {mover ? (
            <div style={{ position: "absolute", left: qx(mp), top: qy(mp) - L.lift, transform: "translate(-50%, -50%)", opacity: progress(t, go, 0.3) }}>
              <Thing item={{ ...mover, label: "", at: go }} {...P} size={L.mover} />
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
      const L = G.compare;
      const lp = progress(t, b ? b.at - 0.3 : 0.5, 0.6);
      return (
        <>
          <Heading text={s.heading} t={t} />
          <div style={{ position: "absolute", left: W / 2 - 2, top: L.lineTop, width: 4, height: (G.ground - L.lineTop + L.lineBelow) * lp, background: `repeating-linear-gradient(${T.ink} 0 8px, transparent 8px 26px)`, filter: T.glow }} />
          <div style={{ position: "absolute", left: W / 2, top: L.vsY, transform: `translate(-50%,-50%) scale(${lp})`, width: 96, height: 96, borderRadius: 99,
            border: `3px solid ${T.accent}`, background: T.base, color: T.accent, fontFamily: FONT, fontSize: 34, display: "flex", alignItems: "center", justifyContent: "center", filter: T.glowAccent }}>VS</div>
          {a ? <Standing x={L.ax} item={a} {...P} size={L.size} /> : null}
          {b ? <Standing x={L.bx} item={b} {...P} size={L.size} accent /> : null}
        </>
      );
    }
    case "checklist": {
      const L = G.checklist;
      const top = s.heading ? L.top : L.topAlone;
      return (
        <>
          <Heading text={s.heading} t={t} y={L.head} />
          {its.slice(0, 4).map((it, i) => {
            const p = progress(t, it.at, 0.5);
            const c = progress(t, it.at + 0.35, 0.45);
            return (
              <div key={i} style={{ position: "absolute", left: L.left, right: L.right, top: top + i * L.gap, display: "flex", alignItems: "center", gap: 34, opacity: p,
                transform: `translateX(${(1 - p) * 60}px)` }}>
                <svg width={78} height={78} viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ filter: c > 0 ? T.glowAccent : T.glow, flex: "none" }}>
                  <rect x={2} y={2} width={20} height={20} rx={5} stroke={c > 0.99 ? T.accent : T.ink} strokeWidth={1.6} />
                  <path d="M6.5 12.5 L10.5 16.5 L17.5 8" stroke={T.accent} strokeWidth={2.4} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - c} />
                </svg>
                {it.kind === "icon" ? <Draw nodes={icons[it.icon] || icons.sparkles} size={86} p={p} /> : <Person kind={it.kind} height={110} p={p} bob={0} />}
                <div style={{ fontFamily: FONT, fontSize: 50 * TS(), color: T.ink, filter: T.glow, textTransform: T.upper ? "uppercase" : "none", letterSpacing: T.upper ? 1.5 : 0, lineHeight: 1.1 }}>{it.label}</div>
              </div>
            );
          })}
        </>
      );
    }
    case "year": {
      return (
        <>
          <Counter value={s.number} prefix={s.number_prefix} suffix={s.number_suffix} t={t} from={Math.max(0, s.number - 60)} y={G.year.y} size={G.year.size} />
          <Heading text={s.heading} t={t} at={0.9} y={G.year.head} size={60} />
          {its.slice(0, 3).map((it, i, arr) => <Standing key={i} x={(W / (arr.length + 1)) * (i + 1)} item={it} {...P} size={G.year.item} room={W / (arr.length + 1)} />)}
        </>
      );
    }
    case "stat": {
      const pct = String(s.number_suffix).includes("%"); const n = pct ? 100 : Math.max(1, Math.min(100, s.number)); const hl = s.highlight || (pct ? s.number : 0);
      const L = G.stat, cols = L.cols, gap = L.gap, gx = (W - (cols - 1) * gap) / 2, gy = L.gy;
      return (
        <>
          <Heading text={s.heading} t={t} y={L.head} size={58} />
          <Counter value={s.number} prefix={s.number_prefix} suffix={s.number_suffix} t={t} from={0} y={L.y} size={L.size} />
          {Array.from({ length: n }, (_, i) => {
            const at = 0.6 + i * (1.6 / n);
            const p = progress(t, at, 0.25);
            const hi = i < hl && t > 2.4 + (i / Math.max(1, hl)) * 0.8;
            return <div key={i} style={{ position: "absolute", left: gx + (i % cols) * gap, top: gy + Math.floor(i / cols) * gap, width: 30, height: 30, borderRadius: 99,
              transform: `translate(-50%,-50%) scale(${p})`, border: `3px solid ${hi ? T.accent : T.ink}`, background: hi ? T.accent : "transparent",
              opacity: hi ? 1 : 0.8, filter: hi ? T.glowAccent : T.glow }} />;
          })}
        </>
      );
    }
    case "quote": {
      const it = its[0], L = G.quote;
      const words = (s.heading || "").split(/\s+/).filter(Boolean);
      return (
        <>
          <div style={{ position: "absolute", left: L.markX, top: L.markY, fontFamily: FONT, fontSize: 200, color: T.accent, filter: T.glowAccent, opacity: progress(t, 0.1, 0.4), lineHeight: 1 }}>“</div>
          <div style={{ position: "absolute", left: L.side, right: L.side, top: L.y, transform: "translateY(-50%)", display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0 18px",
            fontFamily: FONT, fontSize: 64 * TS(), lineHeight: 1.2, color: T.ink, filter: T.glow, textAlign: "center" }}>
            {words.map((w, i) => {
              const p = progress(t, 0.3 + i * 0.16, 0.35);
              return <span key={i} style={{ opacity: p, transform: `translateY(${(1 - p) * 18}px)`, display: "inline-block" }}>{w}</span>;
            })}
          </div>
          {it ? <Standing x={W / 2} item={it} {...P} size={L.item} /> : null}
        </>
      );
    }
    default: { // row
      const list = its.slice(0, 4);
      const size = G.row[Math.min(3, Math.max(0, list.length - 1))];
      return (
        <>
          <Heading text={s.heading} t={t} />
          {list.map((it, i) => <Standing key={i} x={(W / (list.length + 1)) * (i + 1)} item={it} {...P} size={size} room={W / (list.length + 1)} />)}
        </>
      );
    }
  }
}

// ---------- captions (glow and whiteboard) ----------
function chunks(words, n) {
  const out = [];
  let cur = [];
  words.forEach((w, i) => {
    cur.push(w);
    if (cur.length >= n || w.p || /[.,!?;:]$/.test(w.w) || i === words.length - 1) { out.push(cur); cur = []; }
  });
  return out;
}
const groupAt = (groups, t) => groups.find((c, i) => t >= c[0].s - 0.05 && (i === groups.length - 1 || t < groups[i + 1][0].s - 0.05));
function Captions({ words, t }) {
  const groups = React.useMemo(() => chunks(words, 5), [words]);
  const g = groupAt(groups, t);
  if (!g || t > g[g.length - 1].e + 0.6) return null;
  return (
    <div style={{ position: "absolute", left: G.capSide, right: G.capSide, top: G.capY, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0 16px",
      fontFamily: FONT, fontSize: G.capSize * TS(), lineHeight: 1.2, textAlign: "center" }}>
      {g.map((w, i) => {
        const on = t >= w.s - 0.03;
        return <span key={i} style={{ color: on ? T.ink : T.dim, filter: on ? T.glow : "none" }}>{w.w}</span>;
      })}
    </div>
  );
}

function Overlay({ camX }) {
  switch (T.overlay) {
    case "grid":
      return <AbsoluteFill style={{ backgroundImage: "linear-gradient(rgba(234,242,255,.16) 2px, transparent 2px), linear-gradient(90deg, rgba(234,242,255,.16) 2px, transparent 2px), linear-gradient(rgba(234,242,255,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(234,242,255,.07) 1px, transparent 1px)",
        backgroundSize: "200px 200px, 200px 200px, 40px 40px, 40px 40px", backgroundPosition: `${-camX}px 0, ${-camX}px 0, ${-camX}px 0, ${-camX}px 0` }} />;
    case "scan":
      return <AbsoluteFill style={{ background: "repeating-linear-gradient(0deg, rgba(0,0,0,.28) 0 2px, transparent 2px 5px), radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,.55) 100%)" }} />;
    case "halftone":
      return <AbsoluteFill style={{ backgroundImage: "radial-gradient(rgba(17,17,17,.13) 2.4px, transparent 2.8px)", backgroundSize: "18px 18px", backgroundPosition: `${-camX * 0.5}px 0` }} />;
    case "grain":
    case "cork": {
      const cork = T.overlay === "cork";
      return (
        <AbsoluteFill style={{ opacity: cork ? 0.55 : 0.22, mixBlendMode: "multiply" }}>
          <svg width="100%" height="100%">
            <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency={cork ? 0.55 : 0.9} numOctaves={cork ? 3 : 2} seed={4} /><feColorMatrix values={cork ? "0 0 0 0 .35 0 0 0 0 .2 0 0 0 0 .08 0 0 0 1.4 -.3" : "0 0 0 0 .2 0 0 0 0 .15 0 0 0 0 .1 0 0 0 1 0"} /></filter>
            <rect width="100%" height="100%" filter="url(#grain)" />
          </svg>
        </AbsoluteFill>
      );
    }
    default:
      return null;
  }
}

function Dust({ camX, total }) {
  const dots = React.useMemo(() => Array.from({ length: 90 }, (_, i) => ({ x: random(`x${i}`) * total, y: random(`y${i}`) * G.H, r: 1 + random(`r${i}`) * 2.2, o: 0.15 + random(`o${i}`) * 0.35 })), [total]);
  if (!T.dust) return null;
  return (
    <AbsoluteFill style={{ transform: `translateX(${-camX * 0.3}px)` }}>
      {dots.map((d, i) => <div key={i} style={{ position: "absolute", left: d.x, top: d.y, width: d.r * 2, height: d.r * 2, borderRadius: 99, background: T.dust, opacity: d.o }} />)}
    </AbsoluteFill>
  );
}

// ---------- kinetic typography ----------
const BLOCKS = [
  { bg: "#0E0E12", fg: "#FFFFFF", hi: "#FFD60A" },
  { bg: "#FFD60A", fg: "#0E0E12", hi: "#FFFFFF" },
  { bg: "#F4F3EE", fg: "#0E0E12", hi: "#2F5BFF" },
  { bg: "#2F5BFF", fg: "#FFFFFF", hi: "#FFD60A" },
];

/** The words that matter in a scene: its heading, its labels and its numbers get the highlight colour. */
function keyWords(s) {
  const set = new Set();
  for (const w of `${s.heading} ${s.items.map((it) => `${it.label} ${it.cue}`).join(" ")}`.split(/\s+/)) { const n = norm(w); if (n.length > 3) set.add(n); }
  return set;
}

function KineticScene({ s, t, frame, fps, icons, rtl }) {
  const block = BLOCKS[s.i % BLOCKS.length];
  const groups = React.useMemo(() => chunks(s.words, 3), [s.words]);
  const keys = React.useMemo(() => keyWords(s), [s]);
  const g = groupAt(groups, t) || groups[0] || [];
  // a new colour block wipes up over the last one
  const wipe = s.i === 0 ? 1 : interpolate(frame, [0, 9], [0, 1], { ...clamp, easing: ease });
  const item = [...s.items].reverse().find((it) => t >= it.at) || null;
  const hasNumber = (s.layout === "year" || s.layout === "stat") && s.number;
  const n = hasNumber ? Math.round(interpolate(progress(t, 0.2, 1.2), [0, 1], [s.layout === "year" ? Math.max(0, s.number - 60) : 0, s.number])) : 0;
  const K = G.kin;
  // a Short stacks the words, one per line; a 16:9 video sets them on one line when they fit
  const chars = g.reduce((n, w) => n + String(w.w).length + 1, 0);
  const fit = (w) => Math.max(90, Math.min(K.max, K.width / Math.max(3, (K.row ? chars : String(w).length) * 0.68)));
  return (
    <AbsoluteFill style={{ clipPath: `inset(${(1 - wipe) * 100}% 0 0 0)`, background: block.bg, direction: rtl ? "rtl" : "ltr" }}>
      {s.heading ? (
        <div style={{ position: "absolute", top: K.tag, left: 0, right: 0, display: "flex", justifyContent: "center", opacity: progress(t, 0.1, 0.3) }}>
          <div style={{ background: block.fg, color: block.bg, fontFamily: FONT, fontSize: 36, letterSpacing: 3, textTransform: "uppercase", padding: "10px 24px", borderRadius: 8 }}>{s.heading}</div>
        </div>
      ) : null}
      {hasNumber ? (
        <div style={{ position: "absolute", top: K.num, left: 0, right: 0, textAlign: "center", fontFamily: FONT, fontSize: K.numSize, color: block.hi, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
          {s.number_prefix}{n}{s.number_suffix}
        </div>
      ) : item ? (
        <div style={{ position: "absolute", top: K.icon, left: 0, right: 0, display: "flex", justifyContent: "center", transform: `scale(${interpolate(pop(frame, fps, item.at), [0, 1], [0.7, 1])})` }}>
          {item.kind === "icon"
            ? <Draw nodes={icons[item.icon] || icons.sparkles} size={K.iconSize} p={progress(t, item.at, 0.6)} color={block.fg} width={1.6} glow="none" />
            : <div style={{ display: "flex" }}>{Array.from({ length: Math.min(4, item.count || 1) }, (_, k) => <Person key={k} kind={item.kind} height={K.iconSize} p={progress(t, item.at + k * 0.1, 0.6)} bob={0} color={block.fg} />)}</div>}
        </div>
      ) : null}
      <div style={{ position: "absolute", top: K.words, left: K.side, right: K.side, transform: "translateY(-50%)", display: "flex", flexDirection: K.row ? "row" : "column",
        flexWrap: K.row ? "wrap" : "nowrap", justifyContent: "center", alignItems: K.row ? "baseline" : "center", gap: K.row ? "0 0.38em" : 6, fontSize: fit("") }}>
        {g.map((w, k) => {
          const sp = pop(frame, fps, w.s - 0.04);
          const key = keys.has(norm(w.w)) || /\d/.test(w.w);
          return (
            <div key={`${w.s}-${k}`} style={{ fontFamily: FONT, fontSize: fit(w.w), lineHeight: 1.02, textTransform: "uppercase", color: key ? block.hi : block.fg,
              opacity: Math.min(1, sp * 2), whiteSpace: "nowrap",
              // stacked words punch in; words on one line rise, so they never cover their neighbour
              transform: K.row ? `translateY(${(1 - sp) * 60}px) scale(${interpolate(sp, [0, 1], [1.08, 1])})` : `scale(${interpolate(sp, [0, 1], [1.35, 1])}) rotate(${(1 - sp) * (k % 2 ? 4 : -4)}deg)` }}>
              {w.w}
              {key ? <div style={{ height: 14, marginTop: 4, background: block.hi, transformOrigin: "left", transform: `scaleX(${progress(t, w.s + 0.1, 0.3)})` }} /> : null}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

export function Explainer(props) {
  const { scenes: list, music, rtl, totalFrames } = props;
  const look = EXPLAINER_LOOKS.includes(props.look) ? props.look : "glow";
  T = THEMES[look] || THEMES.glow;
  G = Number(props.width) > Number(props.height) ? GEO.landscape : GEO.portrait;
  useFonts(props.assetBase);
  const face = { hand: HAND, mono: MONO, serif: SERIF, comic: COMIC }[T.font];
  FONT = rtl ? `"${ARABIC}", "${face || LATIN}", sans-serif` : face ? `"${face}", "${LATIN}", "${ARABIC}", sans-serif` : `"${LATIN}", "${ARABIC}", sans-serif`;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const icons = ICONS;
  const scenes = React.useMemo(() => list.map((s, i) => ({ ...(s.x || { layout: "title", heading: "", items: [] }), i, from: s.from, dur: s.dur, voiceUrl: s.voiceUrl, id: s.id,
    words: (s.groups || []).flatMap((g) => g.words.map((w, k) => ({ ...w, p: k === g.words.length - 1 }))) })), [list]);
  if (!scenes.length) return <AbsoluteFill style={{ background: T.base }} />;
  let idx = 0;
  for (let i = 0; i < scenes.length; i++) if (frame >= scenes[i].from) idx = i;
  const cur = scenes[idx];
  const last = scenes[scenes.length - 1];
  const voiceEnd = last.from + last.dur - Math.round(0.7 * fps);
  const musicVolume = (f) => Number(music?.volume ?? 0.22) * (f < voiceEnd ? MUSIC_UNDER_VOICE : 1)
    * interpolate(f, [0, 8], [0, 1], clamp) * interpolate(f, [totalFrames - 24, totalFrames - 1], [1, 0], clamp);
  const audio = (
    <>
      {scenes.map((s, i) => (s.voiceUrl ? (
        <Sequence key={`v${s.id || i}`} from={s.from} durationInFrames={s.dur} name={`Voice ${i + 1}`}>
          <Html5Audio src={s.voiceUrl} />
        </Sequence>
      ) : null))}
      {music?.url ? <Html5Audio src={music.url} loop volume={musicVolume} trimBefore={Math.round(Number(music.start || 0) * fps)} /> : null}
    </>
  );

  if (look === "kinetic") {
    const prev = idx > 0 ? scenes[idx - 1] : null;
    return (
      <AbsoluteFill style={{ background: BLOCKS[0].bg }}>
        {prev ? <KineticScene s={prev} t={(frame - prev.from) / fps} frame={frame - prev.from} fps={fps} icons={icons} rtl={rtl} /> : null}
        <KineticScene s={cur} t={(frame - cur.from) / fps} frame={frame - cur.from} fps={fps} icons={icons} rtl={rtl} />
        {audio}
      </AbsoluteFill>
    );
  }

  const mp = idx === 0 ? 1 : interpolate(frame - cur.from, [0, MOVE], [0, 1], { ...clamp, easing: ease });
  const W = G.W;
  const camX = (idx - 1 + mp) * W;
  const worldW = (scenes.length + 1) * W;
  return (
    <AbsoluteFill style={{ background: T.background, direction: "ltr" }}>
      <Overlay camX={camX} />
      <Dust camX={camX} total={worldW} />
      <AbsoluteFill style={{ transform: `translateX(${-camX}px)` }}>
        {scenes.map((s, i) => {
          if (Math.abs(i - idx) > 1) return null;
          const t = (frame - s.from) / fps;
          return (
            <div key={s.id || i} style={{ position: "absolute", left: i * W, top: 0, width: W, height: G.H, direction: rtl ? "rtl" : "ltr" }}>
              {t >= -0.05 || i <= idx ? <SceneBody s={s} t={t} frame={frame - s.from} fps={fps} icons={icons} /> : null}
            </div>
          );
        })}
      </AbsoluteFill>
      <div style={{ direction: rtl ? "rtl" : "ltr" }}><Captions words={cur.words} t={(frame - cur.from) / fps} /></div>
      {audio}
    </AbsoluteFill>
  );
}
