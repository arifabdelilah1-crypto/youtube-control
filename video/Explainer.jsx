// The Animation styles (settings.style = "explainer", settings.explainer.look), drawn for 9:16, no stock footage and
// no sound effects. Each element appears when its cue word is spoken (times from video/layout.js explainerScene).
//   glow        white glowing line-art pictograms on black, a camera sliding right from scene to scene, labels in pills
//   whiteboard  the same scenes drawn in marker on paper, in a hand-written face
//   kinetic     kinetic typography: the narration itself, a few words at a time, big, on colour blocks that change per scene
import React from "react";
import { AbsoluteFill, Easing, Html5Audio, Sequence, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ARABIC, HAND, LATIN, useFonts } from "./fonts.js";
import { ICONS } from "./explainer-icons.js";
import { EXPLAINER_LOOKS, MUSIC_UNDER_VOICE } from "./layout.js";

const W = 1080;
const GROUND = 1250;  // where figures stand (no line is drawn: each one gets a soft shadow)
const MOVE = 20;      // frames of camera travel between scenes

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
let T = THEMES.glow;
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

function Pill({ text, s, accent }) {
  if (!text) return null;
  const c = accent ? T.accent : T.ink;
  return (
    <div style={{ transform: `scale(${interpolate(s, [0, 1], [0.6, 1])}) rotate(${T.hand ? -1.5 : 0}deg)`, opacity: Math.min(1, s * 1.5), border: `3px solid ${c}`,
      borderRadius: T.hand ? "18px 26px 20px 24px" : 999, padding: "10px 26px", color: c, fontFamily: FONT, fontSize: T.hand ? 36 : 30,
      letterSpacing: T.upper ? 2.5 : 0.5, textTransform: T.upper ? "uppercase" : "none", whiteSpace: "nowrap",
      filter: accent ? T.glowAccent : T.glow, background: T.pillBg }}>{text}</div>
  );
}

// One item: a figure (or group) or an icon, with its pill.
function Thing({ item, t, frame, fps, icons, size = 230, accent }) {
  const p = progress(t, item.at, 0.8);
  const s = pop(frame, fps, item.at + 0.25);
  const lift = interpolate(p, [0, 1], [30, 0]);
  let body;
  if (item.kind === "icon") {
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
function Standing({ x, item, ...rest }) {
  const p = progress(rest.t, item.at, 0.8);
  const wide = (rest.size || 230) * (item.kind === "icon" ? 0.9 : Math.min(2.4, 0.55 + 0.32 * (item.count || 1)));
  return (
    <div style={{ position: "absolute", left: x, top: GROUND - 2, transform: "translateX(-50%)" }}>
      <div style={{ position: "absolute", top: -14, left: "50%", width: wide, height: 28, transform: `translateX(-50%) scaleX(${p})`, background: T.shadow }} />
      <div style={{ position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)" }}>
        <Thing {...rest} item={{ ...item, label: "" }} />
      </div>
      <div style={{ position: "absolute", top: 40, left: "50%", transform: "translateX(-50%)" }}>
        <Pill text={item.label} s={pop(rest.frame, rest.fps, item.at + 0.25)} accent={rest.accent} />
      </div>
    </div>
  );
}

function Heading({ text, t, at = 0.15, y = 470, size = 74, accent = false }) {
  if (!text) return null;
  const words = text.split(/\s+/);
  const fs = T.hand ? size * 1.12 : size;
  return (
    <div style={{ position: "absolute", left: 70, right: 70, top: y, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: `0 ${fs * 0.28}px`,
      fontFamily: FONT, fontSize: fs, lineHeight: 1.12, color: accent ? T.accent : T.ink, textAlign: "center", textTransform: T.upper ? "uppercase" : "none",
      filter: accent ? T.glowAccent : T.glow, transform: "translateY(-50%)" }}>
      {words.map((w, i) => {
        const p = progress(t, at + i * 0.09, 0.45);
        return <span key={i} style={{ opacity: p, transform: `translateY(${(1 - p) * 26}px)`, display: "inline-block" }}>{w}</span>;
      })}
      {T.hand ? <Underline t={t} at={at + words.length * 0.09} /> : null}
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
    <div style={{ position: "absolute", left: 0, right: 0, top: y, transform: "translateY(-50%)", textAlign: "center", fontFamily: FONT, fontSize: T.hand ? size * 1.1 : size,
      color: T.accent, filter: T.glowAccent, letterSpacing: 4, fontVariantNumeric: "tabular-nums" }}>
      {prefix}{n}{suffix}
    </div>
  );
}

// ---------- scene layouts (glow and whiteboard) ----------
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
          <svg width={W} height={1920} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", filter: T.glow }}>
            <path d={d} fill="none" stroke={T.ink} strokeWidth={4} strokeDasharray="4 22" strokeLinecap="round" pathLength={1000} mask={`url(#m${s.i})`} />
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
          <div style={{ position: "absolute", left: W / 2 - 2, top: 700, width: 4, height: (GROUND - 700 + 140) * lp, background: `repeating-linear-gradient(${T.ink} 0 8px, transparent 8px 26px)`, filter: T.glow }} />
          <div style={{ position: "absolute", left: W / 2, top: 900, transform: `translate(-50%,-50%) scale(${lp})`, width: 96, height: 96, borderRadius: 99,
            border: `3px solid ${T.accent}`, background: T.base, color: T.accent, fontFamily: FONT, fontSize: 34, display: "flex", alignItems: "center", justifyContent: "center", filter: T.glowAccent }}>VS</div>
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
                <svg width={78} height={78} viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ filter: c > 0 ? T.glowAccent : T.glow, flex: "none" }}>
                  <rect x={2} y={2} width={20} height={20} rx={5} stroke={c > 0.99 ? T.accent : T.ink} strokeWidth={1.6} />
                  <path d="M6.5 12.5 L10.5 16.5 L17.5 8" stroke={T.accent} strokeWidth={2.4} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - c} />
                </svg>
                {it.kind === "icon" ? <Draw nodes={icons[it.icon] || icons.sparkles} size={86} p={p} /> : <Person kind={it.kind} height={110} p={p} bob={0} />}
                <div style={{ fontFamily: FONT, fontSize: T.hand ? 58 : 50, color: T.ink, filter: T.glow, textTransform: T.upper ? "uppercase" : "none", letterSpacing: T.upper ? 1.5 : 0, lineHeight: 1.1 }}>{it.label}</div>
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
              transform: `translate(-50%,-50%) scale(${p})`, border: `3px solid ${hi ? T.accent : T.ink}`, background: hi ? T.accent : "transparent",
              opacity: hi ? 1 : 0.8, filter: hi ? T.glowAccent : T.glow }} />;
          })}
        </>
      );
    }
    case "quote": {
      const it = its[0];
      const words = (s.heading || "").split(/\s+/).filter(Boolean);
      return (
        <>
          <div style={{ position: "absolute", left: 90, top: 380, fontFamily: FONT, fontSize: 200, color: T.accent, filter: T.glowAccent, opacity: progress(t, 0.1, 0.4), lineHeight: 1 }}>“</div>
          <div style={{ position: "absolute", left: 110, right: 110, top: 760, transform: "translateY(-50%)", display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0 18px",
            fontFamily: FONT, fontSize: T.hand ? 72 : 64, lineHeight: 1.2, color: T.ink, filter: T.glow, textAlign: "center" }}>
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
    <div style={{ position: "absolute", left: 70, right: 70, top: 1590, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0 16px",
      fontFamily: FONT, fontSize: T.hand ? 58 : 50, lineHeight: 1.2, textAlign: "center" }}>
      {g.map((w, i) => {
        const on = t >= w.s - 0.03;
        return <span key={i} style={{ color: on ? T.ink : T.dim, filter: on ? T.glow : "none" }}>{w.w}</span>;
      })}
    </div>
  );
}

function Dust({ camX, total }) {
  const dots = React.useMemo(() => Array.from({ length: 90 }, (_, i) => ({ x: random(`x${i}`) * total, y: random(`y${i}`) * 1920, r: 1 + random(`r${i}`) * 2.2, o: 0.15 + random(`o${i}`) * 0.35 })), [total]);
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
  const fit = (w) => Math.max(96, Math.min(230, 900 / Math.max(3, String(w).length * 0.68)));
  return (
    <AbsoluteFill style={{ clipPath: `inset(${(1 - wipe) * 100}% 0 0 0)`, background: block.bg, direction: rtl ? "rtl" : "ltr" }}>
      {s.heading ? (
        <div style={{ position: "absolute", top: 250, left: 0, right: 0, display: "flex", justifyContent: "center", opacity: progress(t, 0.1, 0.3) }}>
          <div style={{ background: block.fg, color: block.bg, fontFamily: FONT, fontSize: 36, letterSpacing: 3, textTransform: "uppercase", padding: "10px 24px", borderRadius: 8 }}>{s.heading}</div>
        </div>
      ) : null}
      {hasNumber ? (
        <div style={{ position: "absolute", top: 520, left: 0, right: 0, textAlign: "center", fontFamily: FONT, fontSize: 200, color: block.hi, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
          {s.number_prefix}{n}{s.number_suffix}
        </div>
      ) : item ? (
        <div style={{ position: "absolute", top: 430, left: 0, right: 0, display: "flex", justifyContent: "center", transform: `scale(${interpolate(pop(frame, fps, item.at), [0, 1], [0.7, 1])})` }}>
          {item.kind === "icon"
            ? <Draw nodes={icons[item.icon] || icons.sparkles} size={260} p={progress(t, item.at, 0.6)} color={block.fg} width={1.6} glow="none" />
            : <div style={{ display: "flex" }}>{Array.from({ length: Math.min(4, item.count || 1) }, (_, k) => <Person key={k} kind={item.kind} height={260} p={progress(t, item.at + k * 0.1, 0.6)} bob={0} color={block.fg} />)}</div>}
        </div>
      ) : null}
      <div style={{ position: "absolute", top: 1120, left: 70, right: 70, transform: "translateY(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        {g.map((w, k) => {
          const sp = pop(frame, fps, w.s - 0.04);
          const key = keys.has(norm(w.w)) || /\d/.test(w.w);
          return (
            <div key={`${w.s}-${k}`} style={{ fontFamily: FONT, fontSize: fit(w.w), lineHeight: 1.02, textTransform: "uppercase", color: key ? block.hi : block.fg,
              opacity: Math.min(1, sp * 2), transform: `scale(${interpolate(sp, [0, 1], [1.35, 1])}) rotate(${(1 - sp) * (k % 2 ? 4 : -4)}deg)`, whiteSpace: "nowrap" }}>
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
  useFonts(props.assetBase);
  FONT = look === "whiteboard" ? `"${HAND}", "${LATIN}", "${ARABIC}", cursive` : rtl ? `"${ARABIC}", "${LATIN}", sans-serif` : `"${LATIN}", "${ARABIC}", sans-serif`;
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
  const camX = (idx - 1 + mp) * W;
  const worldW = (scenes.length + 1) * W;
  return (
    <AbsoluteFill style={{ background: T.background, direction: "ltr" }}>
      <Dust camX={camX} total={worldW} />
      <AbsoluteFill style={{ transform: `translateX(${-camX}px)` }}>
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
      {audio}
    </AbsoluteFill>
  );
}
