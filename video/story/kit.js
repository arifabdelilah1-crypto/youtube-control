// Story stick kit: everything a code-drawn stick-figure story needs. Our own drawing (no outside code).
// Pure React + SVG, no Remotion import, so a film can be tested in Node before it is rendered (render/story_check.mjs).
// A film (written by Claude for each video) draws with these pieces; colours come from the look's theme T, so one film
// works in every look: noir (cinematic night), paper (storybook), pop (bright comic), atlas (talking maps).
import React from "react";
import { GEO } from "./geo.js";

const h = React.createElement;

// ---------- maths and motion ----------
export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const ramp = (f, a, b) => (b === a ? (f >= b ? 1 : 0) : clamp01((f - a) / (b - a)));
export const eio = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const eout = (t) => 1 - Math.pow(1 - t, 3);
export const ein = (t) => t * t * t;
export const eback = (t) => { const c1 = 1.70158, c3 = c1 + 1; return t >= 1 ? 1 : 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
/** Seeded random in [0, 1): the same seed gives the same number in every frame. */
export const rnd = (seed) => {
  let x = 2166136261;
  for (const ch of String(seed)) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619); }
  x = Math.imul(x ^ (x >>> 15), 2246822507); x = Math.imul(x ^ (x >>> 13), 3266489909);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};
/** Eased keyframes: keys(f, [[frame, value], ...]). */
export const keys = (f, K) => {
  if (!K.length) return 0;
  if (f <= K[0][0]) return K[0][1];
  for (let k = 0; k < K.length - 1; k++) if (f <= K[k + 1][0]) return lerp(K[k][1], K[k + 1][1], eio(ramp(f, K[k][0], K[k + 1][0])));
  return K[K.length - 1][1];
};
/** 0 → 1 with a small overshoot, starting at frame `at`. */
export const pop = (f, at, dur = 10) => eback(ramp(f, at, at + dur));
/** A soft back-and-forth, for breathing, swaying, floating. */
export const wave = (f, speed = 0.08, amp = 1, phase = 0) => Math.sin(f * speed + phase) * amp;
const hex = (c) => { const s = String(c).replace("#", ""); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) || 0); };
/** Mixes two #rrggbb colours. */
export const mix = (a, b, t) => "#" + hex(a).map((v, i) => Math.round(lerp(v, hex(b)[i], clamp01(t))).toString(16).padStart(2, "0")).join("");
export const alpha = (c, a) => { const [r, g, b] = hex(c); return `rgba(${r},${g},${b},${clamp01(a)})`; };

// ---------- theme ----------
/** The three looks. A film uses T.* for every colour, so it can be rendered in any of them. */
export const THEMES = {
  noir: {
    name: "noir", bg: "#0b0d12", sky: ["#0d1220", "#1b2236"], wall: "#1d212b", wall2: "#161a22", floor: "#12141b", floor2: "#0d0f14",
    ink: "#0a0a0f", head: "#f3f0e8", line: 7, shoe: "#f3f0e8", glass: "#2b3550", wood: "#3a2e26", metal: "#4a4f5c", plant: "#2f4a3a",
    light: "#ffd8a0", glow: "#ffe6b8", cast: ["#e4572e", "#3a86ff", "#ffbe0b", "#8ac926", "#ff4d6d", "#b388eb"],
    money: "#6fbf73", danger: "#ff3b3b", good: "#7bdc8a", screen: "#9fd3ff", paper: "#e8e2d4",
    shadow: 0.55, vignette: 0.75, grain: 0.07, wobble: 0, halftone: 0, caption: { color: "#ffffff", stroke: "rgba(0,0,0,0.85)", weight: 800 },
    sea: "#0e1a2b", land: "#2a3242", border: "#4a5468",
  },
  paper: {
    name: "paper", bg: "#f2e8d3", sky: ["#cfe3e8", "#f3e5c8"], wall: "#eadbb9", wall2: "#e1cfa7", floor: "#d6bf93", floor2: "#c9ae7c",
    ink: "#2a2018", head: "#fffaf0", line: 6, shoe: "#fffaf0", glass: "#bcd7dc", wood: "#a5774f", metal: "#9a948a", plant: "#7a9a62",
    light: "#fff1c2", glow: "#fff6d8", cast: ["#c8553d", "#2f6690", "#e0a458", "#588157", "#9a6fb0", "#d17a97"],
    money: "#5c9a5a", danger: "#c0392b", good: "#4f8a4b", screen: "#cfe8f2", paper: "#fffdf6",
    shadow: 0.25, vignette: 0.25, grain: 0.05, wobble: 1, halftone: 0, caption: { color: "#2a2018", stroke: "rgba(255,250,240,0.95)", weight: 800 },
    sea: "#bcd7dc", land: "#efe2c4", border: "#a89070",
  },
  pop: {
    name: "pop", bg: "#ffd23f", sky: ["#3ec1ff", "#a6e8ff"], wall: "#ffd23f", wall2: "#ffb703", floor: "#ff5d8f", floor2: "#e63e72",
    ink: "#111111", head: "#ffffff", line: 9, shoe: "#ffffff", glass: "#8fe3ff", wood: "#c76b29", metal: "#8d99ae", plant: "#21c46b",
    light: "#ffffff", glow: "#fff7c2", cast: ["#ff3d3d", "#2d6cff", "#11b85c", "#9b5cff", "#ff8a00", "#00b3b3"],
    money: "#11b85c", danger: "#ff2d2d", good: "#11b85c", screen: "#bff4ff", paper: "#ffffff",
    shadow: 0.2, vignette: 0, grain: 0, wobble: 0, halftone: 1, caption: { color: "#ffffff", stroke: "#111111", weight: 900 },
    sea: "#3ec1ff", land: "#fff3c4", border: "#111111",
  },
  // talking maps: an atlas at dusk, countries as characters (Country, MapView)
  atlas: {
    name: "atlas", bg: "#0f2740", sky: ["#0f2740", "#1d4a6e"], wall: "#16324d", wall2: "#122a42", floor: "#0f2238", floor2: "#0b1a2c",
    ink: "#102030", head: "#fff8ec", line: 6, shoe: "#fff8ec", glass: "#9fd3ff", wood: "#8a6a4a", metal: "#7c8a9a", plant: "#4f8a5b",
    light: "#ffe2a8", glow: "#fff0c8", cast: ["#e85d4a", "#2fa36b", "#f2b134", "#4d8fe0", "#b46fd0", "#f07fa0"],
    money: "#5cc27a", danger: "#ff4b4b", good: "#5cc27a", screen: "#bfe6ff", paper: "#fbf3e2",
    shadow: 0.35, vignette: 0.45, grain: 0.04, wobble: 0, halftone: 0, caption: { color: "#ffffff", stroke: "rgba(8,20,32,0.9)", weight: 800 },
    sea: "#123b5c", land: "#e9dcbf", border: "#7d6b52",
  },
};
export const ThemeContext = React.createContext(THEMES.noir);
export const useTheme = () => React.useContext(ThemeContext);

// ---------- the stick figure ----------
// Origin: the ground between the feet. Height ~430 at s = 1. Poses are named; armL/armR/legL/legR override them
// (degrees from straight down, positive = towards where the figure faces). bendL/bendR bend the elbows.
const POSES = {
  stand:   { aL: [8, 10], aR: [8, 10], lL: -4, lR: 4 },
  idle:    { aL: [6, 14], aR: [6, 14], lL: -4, lR: 4 },
  point:   { aL: [6, 12], aR: [95, 0], lL: -4, lR: 6 },
  wave:    { aL: [6, 12], aR: [160, 30], lL: -4, lR: 4 },
  think:   { aL: [20, 110], aR: [30, 140], lL: -3, lR: 3 },
  shrug:   { aL: [-60, -90], aR: [60, 90], lL: -5, lR: 5 },
  cheer:   { aL: [-160, -20], aR: [160, 20], lL: -10, lR: 10 },
  scared:  { aL: [-120, -110], aR: [120, 110], lL: -14, lR: 12 },
  sad:     { aL: [4, 6], aR: [4, 6], lL: -2, lR: 2, slump: 1 },
  hold:    { aL: [30, 70], aR: [40, 70], lL: -4, lR: 4 },
  phone:   { aL: [8, 10], aR: [30, 130], lL: -4, lR: 4 },
  reach:   { aL: [10, 12], aR: [75, 10], lL: -10, lR: 14 },
  facepalm:{ aL: [8, 10], aR: [40, 150], lL: -4, lR: 4, slump: 0.6 },
  sit:     { aL: [30, 50], aR: [30, 50], lL: 85, lR: 80, sit: 1 },
  run:     { aL: [0, 80], aR: [0, 80], lL: 0, lR: 0, run: 1 },
  walk:    { aL: [0, 20], aR: [0, 20], lL: 0, lR: 0, walk: 1 },
  fall:    { aL: [-130, -10], aR: [140, 10], lL: -30, lR: 40, tilt: 70 },
};
export const MOODS = ["neutral", "happy", "sad", "worried", "surprised", "angry", "sly", "scared", "sleepy"];

function Face({ mood, blink, r, ink, lookX = 0, brows = 0.09 }) {
  const eyeY = -r * 0.08, ex = r * 0.34, er = r * 0.11;
  const shut = blink ? 0.12 : 1;
  const dx = lookX * r * 0.14;
  // brows: [inner end lift, outer end lift] in fractions of r (positive = up). Worried lifts the inner ends, angry drops them.
  const brow = {
    neutral: [0, 0], happy: [0.05, 0.05], sad: [0.14, -0.04], worried: [0.18, -0.04], surprised: [0.16, 0.16], angry: [-0.14, 0.06],
    sly: [-0.02, 0.12], scared: [0.2, 0.02], sleepy: [-0.04, -0.04],
  }[mood] || [0, 0];
  const mouth = {
    neutral: `M ${-r * 0.2} ${r * 0.42} L ${r * 0.2} ${r * 0.42}`,
    happy: `M ${-r * 0.3} ${r * 0.32} Q 0 ${r * 0.62} ${r * 0.3} ${r * 0.32}`,
    sad: `M ${-r * 0.26} ${r * 0.52} Q 0 ${r * 0.3} ${r * 0.26} ${r * 0.52}`,
    worried: `M ${-r * 0.24} ${r * 0.48} Q ${-r * 0.08} ${r * 0.38} 0 ${r * 0.46} T ${r * 0.24} ${r * 0.44}`,
    surprised: null, scared: null,
    angry: `M ${-r * 0.24} ${r * 0.5} L ${r * 0.24} ${r * 0.44}`,
    sly: `M ${-r * 0.22} ${r * 0.44} Q ${r * 0.1} ${r * 0.56} ${r * 0.3} ${r * 0.34}`,
    sleepy: `M ${-r * 0.14} ${r * 0.46} L ${r * 0.14} ${r * 0.46}`,
  }[mood];
  const eyeH = mood === "sleepy" ? 0.2 : mood === "surprised" || mood === "scared" ? 1.35 : 1;
  return h("g", null,
    [-1, 1].map((side) => h("ellipse", { key: `e${side}`, cx: side * ex + dx, cy: eyeY, rx: er, ry: er * shut * eyeH, fill: ink })),
    [-1, 1].map((side) => {
      const by = eyeY - r * 0.3, sly = mood === "sly" && side < 0 ? 0.6 : 1;
      return h("line", { key: `b${side}`, x1: side * ex + side * er * 1.7 + dx, y1: by - brow[1] * r * sly, x2: side * ex - side * er * 1.4 + dx, y2: by - brow[0] * r * sly,
        stroke: ink, strokeWidth: r * brows, strokeLinecap: "round" });
    }),
    mouth ? h("path", { d: mouth, fill: "none", stroke: ink, strokeWidth: r * 0.09, strokeLinecap: "round", strokeLinejoin: "round" })
      : h("ellipse", { cx: 0, cy: r * 0.46, rx: r * 0.14, ry: r * 0.18, fill: ink }));
}

const limb = (x, y, ang, len, facing) => { const a = (ang * Math.PI) / 180; return [x + Math.sin(a) * len * facing, y + Math.cos(a) * len]; };

/**
 * <Figure x y s facing coat mood pose f ... />
 *  coat: costume colour (use T.cast[i]); pose: one of POSES; f: the frame, for walking, breathing and blinking;
 *  hat: "none" | "cap" | "beanie" | "top" | "bow"; hair: "none" | "tuft" | "bun" | "long"; tie: true; bag: true;
 *  holding: a React element drawn at the right hand (e.g. <Phone s={0.5}/>); lookX: -1..1 (eyes); speed: walk speed.
 *  char: a network's mascot (CHARACTERS[name], e.g. char={CHARACTERS.yassine}): a bigger head with skin, hair, beard, headwear
 *        and a hoodie; it overrides coat, hat and hair, so the mascot looks the same in every film.
 */
export function Figure({ x = 0, y = 0, s = 1, facing = 1, coat, mood = "neutral", pose = "stand", f = 0, seed = "a",
  armL, armR, bendL, bendR, legL, legR, hat = "none", hair = "none", tie = false, bag = false, holding = null, lookX = 0, speed = 1, opacity = 1, tilt = 0, char = null }) {
  const T = useTheme();
  const P = POSES[pose] || POSES.stand;
  const ink = T.ink, L = T.line;
  const C = char && typeof char === "object" ? char : null;
  if (C) { coat = C.hoodie || coat; hat = "none"; hair = "none"; }
  const r = C ? 84 : 56;
  const skin = C ? C.skin : T.head;
  const walkPh = (P.walk || P.run) ? f * 0.32 * speed * (P.run ? 1.5 : 1) : 0;
  const swing = P.walk ? 28 : P.run ? 50 : 0;
  const breathe = P.walk || P.run ? Math.abs(Math.sin(walkPh)) * -8 : wave(f, 0.07, 2.5, rnd(seed) * 6);
  const slump = (P.slump || 0) * 18;
  const sitDrop = P.sit ? 95 : 0;
  const hipY = -190 + sitDrop * 1.0, shoulderY = -330 + sitDrop + slump * 0.6 + breathe, neckY = shoulderY - 14;
  const headY = neckY - r + 4 + slump * 0.4;
  const aL = [armL ?? P.aL[0] + (swing ? Math.sin(walkPh) * swing : 0), bendL ?? P.aL[1]];
  const aR = [armR ?? P.aR[0] - (swing ? Math.sin(walkPh) * swing : 0), bendR ?? P.aR[1]];
  const lL = legL ?? P.lL - (swing ? Math.sin(walkPh) * swing * 0.9 : 0);
  const lR = legR ?? P.lR + (swing ? Math.sin(walkPh) * swing * 0.9 : 0);
  const blink = (Math.floor(f + rnd(seed) * 97) % 97) < 3;
  // a mascot's big head: raised arms open outwards instead of crossing the face, from wider shoulders
  const open = (a) => (C && Math.abs(a) > 90 ? Math.sign(a) * (90 + (Math.abs(a) - 90) * 0.45) : a);
  const arm = (side, [ang0, bend]) => {
    // raised arms always open towards their own side, whichever way the mascot faces
    const ang = C && Math.abs(ang0) > 90 ? side * facing * Math.abs(open(ang0)) : open(ang0);
    if (C && Math.abs(ang0) > 90) bend = bend * 0.35;
    const sx = side * (C ? 46 : 36), [ex, ey] = limb(sx, shoulderY + 12, ang, 80, facing), [hx, hy] = limb(ex, ey, ang + bend * (side > 0 ? 1 : 1), 74, facing);
    return { d: `M ${sx} ${shoulderY + 12} L ${ex} ${ey} L ${hx} ${hy}`, hx, hy };
  };
  const leg = (side, ang) => {
    const hx = side * 22;
    if (P.sit) { const [kx, ky] = [hx + 92 * facing, hipY]; return { d: `M ${hx} ${hipY} L ${kx} ${ky} L ${kx} ${ky + 95}`, fx: kx, fy: ky + 95 }; }
    const knee = P.walk || P.run ? Math.max(0, -Math.sin(walkPh + (side > 0 ? Math.PI : 0))) * (P.run ? 40 : 18) : 0;
    const [kx, ky] = limb(hx, hipY, ang, 96, facing), [fx, fy] = limb(kx, ky, ang - knee, 96, facing);
    return { d: `M ${hx} ${hipY} L ${kx} ${ky} L ${fx} ${Math.min(fy, -4)}`, fx, fy: Math.min(fy, -4) };
  };
  const A = [arm(-1, aL), arm(1, aR)], G = [leg(-1, lL), leg(1, lR)];
  const stroke = { stroke: ink, strokeWidth: L * 1.55, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" };
  // a shirt with some weight: wide shoulders, slightly narrower hips, the far side in shade
  const torso = `M ${-48} ${shoulderY + 8} Q 0 ${shoulderY - 14} ${48} ${shoulderY + 8} L ${40} ${hipY + 8} Q 0 ${hipY + 20} ${-40} ${hipY + 8} Z`;
  const shade = `M ${12 * facing} ${shoulderY - 2} Q ${48 * facing} ${shoulderY + 2} ${48 * facing} ${shoulderY + 8} L ${40 * facing} ${hipY + 8} Q ${26 * facing} ${hipY + 15} ${12 * facing} ${hipY + 16} Z`;
  const hatEl = {
    cap: h("g", null, h("path", { d: `M ${-r} ${headY - 8} Q 0 ${headY - r * 1.45} ${r} ${headY - 8} Z`, fill: coat, stroke: ink, strokeWidth: L }),
      h("path", { d: `M ${r * 0.2} ${headY - 10} L ${r * 1.45} ${headY - 2}`, stroke: ink, strokeWidth: L * 1.6, strokeLinecap: "round" })),
    beanie: h("path", { d: `M ${-r * 0.98} ${headY - 14} Q 0 ${headY - r * 1.6} ${r * 0.98} ${headY - 14} Z`, fill: coat, stroke: ink, strokeWidth: L }),
    top: h("g", null, h("rect", { x: -r * 0.62, y: headY - r * 2.1, width: r * 1.24, height: r * 1.3, fill: ink }), h("rect", { x: -r * 1.05, y: headY - r * 0.85, width: r * 2.1, height: L * 2.2, rx: L, fill: ink })),
    bow: h("g", { transform: `translate(${r * 0.55} ${headY - r * 0.82}) rotate(20)` }, h("path", { d: "M 0 0 L -26 -16 L -26 16 Z M 0 0 L 26 -16 L 26 16 Z", fill: coat, stroke: ink, strokeWidth: L * 0.8, strokeLinejoin: "round" })),
  }[hat] || null;
  const hairEl = {
    tuft: h("path", { d: `M ${-14} ${headY - r + 2} q 8 -26 18 -4 q 6 -22 16 2`, ...stroke, strokeWidth: L }),
    bun: h("circle", { cx: -r * 0.55, cy: headY - r * 0.8, r: r * 0.36, fill: ink }),
    long: h("path", { d: `M ${-r * 0.95} ${headY - r * 0.3} Q ${-r * 1.15} ${headY + r * 1.1} ${-r * 0.55} ${headY + r * 1.15} M ${r * 0.95} ${headY - r * 0.3} Q ${r * 1.15} ${headY + r * 1.1} ${r * 0.55} ${headY + r * 1.15}`, ...stroke, strokeWidth: L * 2.2 }),
  }[hair] || null;
  const tiltDeg = (P.tilt || 0) + tilt;
  return h("g", { transform: `translate(${x} ${y}) scale(${s}) rotate(${tiltDeg * facing})`, opacity },
    h("ellipse", { cx: 0, cy: 0, rx: 70, ry: 12, fill: "#000", opacity: T.shadow * 0.6 }),
    G.map((g, i) => h("path", { key: `l${i}`, d: g.d, ...stroke })),
    G.map((g, i) => h("ellipse", { key: `f${i}`, cx: g.fx + 10 * facing, cy: g.fy - 4, rx: 22, ry: 11, fill: T.shoe, stroke: ink, strokeWidth: L * 0.85 })),
    bag ? h("rect", { x: -54 * facing - 18, y: shoulderY + 30, width: 36, height: 70, rx: 10, fill: mix(coat, "#000000", 0.35), stroke: ink, strokeWidth: L * 0.8 }) : null,
    h("path", { d: torso, fill: coat }),
    h("path", { d: shade, fill: "#000", opacity: 0.18 }),
    h("path", { d: torso, fill: "none", stroke: ink, strokeWidth: L, strokeLinejoin: "round" }),
    tie ? h("path", { d: `M 0 ${shoulderY + 2} l -8 14 l 8 50 l 8 -50 z`, fill: T.ink }) : null,
    h("line", { x1: 0, y1: neckY, x2: 0, y2: shoulderY + 2, stroke: ink, strokeWidth: L * 1.3, strokeLinecap: "round" }),
    C ? null : A.map((a, i) => h("path", { key: `a${i}`, d: a.d, ...stroke })),
    C?.hood ? h("g", null, [-1, 1].map((sd) => h("path", { key: `ds${sd}`, d: `M ${sd * 12} ${shoulderY + 4} l ${sd * 3} 54`, stroke: C.strings || "#f5f5f5", strokeWidth: L * 0.9, strokeLinecap: "round" })),
      h("path", { d: `M -30 ${hipY - 34} L 30 ${hipY - 34} L 38 ${hipY + 4} L -38 ${hipY + 4} Z`, fill: "#000", opacity: 0.12, stroke: ink, strokeWidth: L * 0.6, strokeLinejoin: "round" })) : null,
    C?.badge ? h("g", { transform: `translate(${-22 * facing} ${shoulderY + 44}) scale(0.9)` }, h("path", { d: STAR8, fill: C.badge, stroke: ink, strokeWidth: L * 0.5, strokeLinejoin: "round" })) : null,
    C ? null : A.map((a, i) => h("circle", { key: `h${i}`, cx: a.hx, cy: a.hy, r: 15, fill: skin, stroke: ink, strokeWidth: L * 0.85 })),
    C || !holding ? null : h("g", { transform: `translate(${A[1].hx} ${A[1].hy})` }, holding),
    hair === "long" ? hairEl : null,
    h("g", { transform: `translate(0 ${headY})` },
      C ? h(CharBack, { C, r, ink, L, facing }) : null,
      h("circle", { cx: 0, cy: 0, r, fill: skin, stroke: ink, strokeWidth: L }),
      C ? h(CharFront, { C, r, ink, L, facing }) : null,
      h("g", { transform: `scale(${facing} 1)` }, h(Face, { mood, blink, r, ink, lookX: lookX * facing, brows: C ? 0.12 : 0.09 })),
      C?.mustache ? h("path", { d: `M ${-r * 0.26} ${r * 0.33} Q 0 ${r * 0.2} ${r * 0.26} ${r * 0.33} Q 0 ${r * 0.27} ${-r * 0.26} ${r * 0.33} Z`, fill: C.hairColor, stroke: C.hairColor, strokeWidth: L * 0.6, strokeLinejoin: "round" }) : null,
      C ? h(CharTop, { C, r, ink, L, facing }) : null),
    hair !== "long" ? hairEl : null,
    hatEl,
    // a mascot's big head would hide raised arms: its arms come last, sleeves in the hoodie's colour
    C ? A.map((a, i) => h("path", { key: `a${i}`, d: a.d, ...stroke })) : null,
    C ? A.map((a, i) => h("circle", { key: `h${i}`, cx: a.hx, cy: a.hy, r: 17, fill: skin, stroke: ink, strokeWidth: L * 0.85 })) : null,
    C && holding ? h("g", { transform: `translate(${A[1].hx} ${A[1].hy})` }, holding) : null);
}

// ---------- mascots: one per network, the same in every film ----------
const STAR8 = (() => { const p = []; for (let i = 0; i < 16; i++) { const a = (i * Math.PI) / 8, rr = i % 2 ? 9 : 20; p.push(`${(Math.sin(a) * rr).toFixed(1)} ${(-Math.cos(a) * rr).toFixed(1)}`); } return `M ${p.join(" L ")} Z`; })();
/**
 * The mascots. skin/hairColor/hoodie: colours that stay the same in every look. hair: "curly" | "wavy" | "fade";
 * beard: "stubble" | "short" | null; mustache; headwear: "shemagh" (white or red-checked scarf with a black agal cord) | null;
 * hood: a hood behind the head and drawstrings; badge: a small eight-point star (zellige) on the chest.
 */
export const CHARACTERS = {
  yassine: { name: "Yassine", skin: "#c98d5e", hairColor: "#1d1410", hair: "curly", beard: "stubble", mustache: false, hoodie: "#1f3b73", strings: "#f2f2f2", hood: true, badge: "#d6a531" },
  karim:   { name: "Karim", skin: "#b9784a", hairColor: "#15100d", hair: "wavy", beard: "short", mustache: true, hoodie: "#8c1c2b", strings: "#f2f2f2", hood: true, badge: "#1f8a5b" },
  sami:    { name: "Sami", skin: "#d39a6a", hairColor: "#1a1210", hair: "fade", beard: "short", mustache: true, hoodie: "#f1ede4", strings: "#2a2a2a", hood: false, badge: null, headwear: "shemagh", cloth: "#ffffff", check: "#c0392b" },
};
/** Behind the head: the hood, the ears, the back of a head scarf. */
function CharBack({ C, r, ink, L }) {
  return h("g", null,
    C.hood ? h("path", { d: `M ${-r * 1.18} ${r * 0.55} Q ${-r * 1.3} ${-r * 0.6} 0 ${-r * 0.95} Q ${r * 1.3} ${-r * 0.6} ${r * 1.18} ${r * 0.55} Q 0 ${r * 1.45} ${-r * 1.18} ${r * 0.55} Z`,
      fill: mix(C.hoodie, "#000000", 0.18), stroke: ink, strokeWidth: L, strokeLinejoin: "round" }) : null,
    C.headwear === "shemagh" ? h("path", { d: `M ${-r * 1.08} ${-r * 0.2} Q ${-r * 1.3} ${r * 0.7} ${-r * 1.0} ${r * 1.28} Q ${-r * 0.5} ${r * 1.12} 0 ${r * 1.2} Q ${r * 0.5} ${r * 1.12} ${r * 1.0} ${r * 1.28} Q ${r * 1.3} ${r * 0.7} ${r * 1.08} ${-r * 0.2} Z`,
      fill: C.cloth, stroke: ink, strokeWidth: L, strokeLinejoin: "round" }) : null,
    C.headwear ? null : [-1, 1].map((sd) => h("circle", { key: `ear${sd}`, cx: sd * r * 0.98, cy: r * 0.06, r: r * 0.2, fill: C.skin, stroke: ink, strokeWidth: L * 0.85 })));
}
/** On the face, under the features: the beard. */
function CharFront({ C, r, ink, L }) {
  if (!C.beard) return null;
  const d = `M ${-r * 0.9} ${r * 0.02} Q ${-r * 0.82} ${r * 0.98} 0 ${r * 1.0} Q ${r * 0.82} ${r * 0.98} ${r * 0.9} ${r * 0.02} Q ${r * 0.62} ${r * 0.5} ${r * 0.34} ${r * 0.58} Q 0 ${r * 0.72} ${-r * 0.34} ${r * 0.58} Q ${-r * 0.62} ${r * 0.5} ${-r * 0.9} ${r * 0.02} Z`;
  return h("path", { d, fill: C.hairColor, opacity: C.beard === "stubble" ? 0.32 : 0.92, stroke: C.beard === "stubble" ? "none" : ink, strokeWidth: L * 0.5, strokeLinejoin: "round" });
}
/** On top: the hair, or the scarf and its cord. */
function CharTop({ C, r, ink, L, facing }) {
  if (C.headwear === "shemagh") {
    const top = `M ${-r * 1.1} ${-r * 0.18} Q ${-r * 1.15} ${-r * 1.28} 0 ${-r * 1.3} Q ${r * 1.15} ${-r * 1.28} ${r * 1.1} ${-r * 0.18} Q ${r * 0.9} ${-r * 0.5} 0 ${-r * 0.56} Q ${-r * 0.9} ${-r * 0.5} ${-r * 1.1} ${-r * 0.18} Z`;
    const checks = [];
    for (let i = -4; i <= 4; i++) checks.push(h("path", { key: `c${i}`, d: `M ${i * r * 0.24} ${-r * 1.3} L ${i * r * 0.24 + r * 0.25} ${-r * 0.3}`, stroke: C.check, strokeWidth: L * 0.55, opacity: 0.8 }));
    for (let j = 0; j < 3; j++) checks.push(h("path", { key: `d${j}`, d: `M ${-r * 1.1} ${-r * (1.05 - j * 0.24)} L ${r * 1.1} ${-r * (1.05 - j * 0.24)}`, stroke: C.check, strokeWidth: L * 0.45, opacity: 0.55 }));
    return h("g", null,
      h("defs", null, h("clipPath", { id: "shemaghTop" }, h("path", { d: top }))),
      h("path", { d: top, fill: C.cloth }),
      C.check ? h("g", { clipPath: "url(#shemaghTop)" }, checks) : null,
      h("path", { d: top, fill: "none", stroke: ink, strokeWidth: L, strokeLinejoin: "round" }),
      // the agal: two black cords around the head
      h("path", { d: `M ${-r * 0.96} ${-r * 0.82} Q 0 ${-r * 1.08} ${r * 0.96} ${-r * 0.82}`, fill: "none", stroke: "#111111", strokeWidth: L * 1.7, strokeLinecap: "round" }),
      h("path", { d: `M ${-r * 1.0} ${-r * 0.68} Q 0 ${-r * 0.94} ${r * 1.0} ${-r * 0.68}`, fill: "none", stroke: "#111111", strokeWidth: L * 1.3, strokeLinecap: "round" }));
  }
  const hc = C.hairColor;
  if (C.hair === "curly") {
    const curls = [];
    for (let i = 0; i <= 8; i++) { const a = Math.PI * (1.08 + (i / 8) * 0.84); curls.push(h("circle", { key: `k${i}`, cx: Math.cos(a) * r * 0.86, cy: Math.sin(a) * r * 0.86 - r * 0.06, r: r * 0.27, fill: hc, stroke: ink, strokeWidth: L * 0.7 })); }
    return h("g", null, h("path", { d: `M ${-r * 0.98} ${-r * 0.1} Q ${-r * 0.95} ${-r * 1.18} 0 ${-r * 1.15} Q ${r * 0.95} ${-r * 1.18} ${r * 0.98} ${-r * 0.1} Q ${r * 0.6} ${-r * 0.62} 0 ${-r * 0.6} Q ${-r * 0.6} ${-r * 0.62} ${-r * 0.98} ${-r * 0.1} Z`, fill: hc }), curls);
  }
  if (C.hair === "wavy") {
    return h("path", { d: `M ${-r * 1.0} ${-r * 0.05} Q ${-r * 1.08} ${-r * 1.2} ${-r * 0.1} ${-r * 1.22} Q ${r * 0.9} ${-r * 1.25} ${r * 1.02} ${-r * 0.3} Q ${r * 0.7} ${-r * 0.7} ${r * 0.25} ${-r * 0.55} Q ${r * 0.05} ${-r * 0.85} ${-r * 0.35} ${-r * 0.62} Q ${-r * 0.75} ${-r * 0.55} ${-r * 1.0} ${-r * 0.05} Z`,
      fill: hc, stroke: ink, strokeWidth: L * 0.8, strokeLinejoin: "round", transform: `scale(${facing} 1)` });
  }
  // fade: short on the sides, a flat top
  return h("path", { d: `M ${-r * 0.97} ${-r * 0.25} Q ${-r * 0.92} ${-r * 1.1} 0 ${-r * 1.08} Q ${r * 0.92} ${-r * 1.1} ${r * 0.97} ${-r * 0.25} Q ${r * 0.8} ${-r * 0.62} 0 ${-r * 0.66} Q ${-r * 0.8} ${-r * 0.62} ${-r * 0.97} ${-r * 0.25} Z`,
    fill: hc, stroke: ink, strokeWidth: L * 0.8, strokeLinejoin: "round" });
}

// ---------- props (all sized around s = 1; x, y = where they stand or their centre) ----------
const ink = (T) => ({ stroke: T.ink, strokeWidth: T.line, strokeLinejoin: "round", strokeLinecap: "round" });
const G_ = (x, y, s, rot, kids) => h("g", { transform: `translate(${x} ${y}) rotate(${rot || 0}) scale(${s})` }, ...[kids].flat());
export function Door({ x = 0, y = 0, s = 1, open = 0, color, sign = null, glow = 0 }) {
  const T = useTheme(), c = color || T.wood;
  return G_(x, y, s, 0, [
    h("rect", { key: 1, x: -110, y: -470, width: 220, height: 470, fill: T.ink }),
    glow ? h("rect", { key: 2, x: -100, y: -460, width: 200, height: 460, fill: T.glow, opacity: glow }) : null,
    h("g", { key: 3, transform: `translate(-100 0) scale(${1 - open * 0.85} 1)` },
      h("rect", { x: 0, y: -460, width: 200, height: 460, fill: c, ...ink(T) }),
      h("circle", { cx: 170, cy: -230, r: 11, fill: T.paper, ...ink(T), strokeWidth: T.line * 0.6 })),
    sign ? h("g", { key: 4, transform: "translate(0 -540)" }, h("rect", { x: -90, y: -46, width: 180, height: 92, rx: 14, fill: T.paper, ...ink(T) }),
      h("text", { y: 18, textAnchor: "middle", fontSize: 54, fontWeight: 900, fill: T.ink, fontFamily: "Inter, sans-serif" }, sign)) : null]);
}
export function Window({ x = 0, y = 0, w = 300, hgt = 380, night = true, glow = 0.4 }) {
  const T = useTheme();
  return h("g", { transform: `translate(${x} ${y})` },
    h("rect", { x: -w / 2, y: -hgt / 2, width: w, height: hgt, fill: night ? T.sky[0] : T.sky[1], ...ink(T) }),
    h("rect", { x: -w / 2, y: -hgt / 2, width: w, height: hgt, fill: T.glow, opacity: night ? 0 : glow * 0.5 }),
    h("line", { x1: 0, y1: -hgt / 2, x2: 0, y2: hgt / 2, ...ink(T) }), h("line", { x1: -w / 2, y1: 0, x2: w / 2, y2: 0, ...ink(T) }),
    night ? h("circle", { cx: w * 0.22, cy: -hgt * 0.25, r: 26, fill: T.paper, opacity: 0.9 }) : null);
}
export function Table({ x = 0, y = 0, s = 1, w = 420, color }) {
  const T = useTheme();
  return G_(x, y, s, 0, [h("rect", { key: 1, x: -w / 2, y: -190, width: w, height: 26, rx: 6, fill: color || T.wood, ...ink(T) }),
    h("line", { key: 2, x1: -w / 2 + 30, y1: -164, x2: -w / 2 + 30, y2: 0, ...ink(T), strokeWidth: T.line * 1.4 }),
    h("line", { key: 3, x1: w / 2 - 30, y1: -164, x2: w / 2 - 30, y2: 0, ...ink(T), strokeWidth: T.line * 1.4 })]);
}
export function Chair({ x = 0, y = 0, s = 1, facing = 1, color }) {
  const T = useTheme();
  return G_(x, y, s, 0, [h("g", { key: 1, transform: `scale(${facing} 1)` },
    h("path", { d: "M -60 -110 L 60 -110 M -55 -110 L -55 0 M 55 -110 L 55 0 M -60 -110 L -70 -300", fill: "none", ...ink(T), strokeWidth: T.line * 1.5 }),
    h("rect", { x: -65, y: -125, width: 130, height: 22, rx: 6, fill: color || T.wood, ...ink(T) }))]);
}
export function Lamp({ x = 0, y = 0, s = 1, on = 1 }) {
  const T = useTheme();
  return G_(x, y, s, 0, [h("line", { key: 1, x1: 0, y1: 0, x2: 0, y2: -300, ...ink(T), strokeWidth: T.line * 1.3 }),
    h("path", { key: 2, d: "M -70 -300 L 70 -300 L 40 -380 L -40 -380 Z", fill: on ? T.light : T.metal, ...ink(T) }),
    h("ellipse", { key: 3, cx: 0, cy: -2, rx: 60, ry: 12, fill: T.ink })]);
}
/** A phone; `screen` is a small React element or text shown on it (in-scene text is allowed on a prop). */
export function Phone({ x = 0, y = 0, s = 1, rot = 0, on = 1, screen = null, buzz = 0 }) {
  const T = useTheme();
  const shake = buzz ? Math.sin(buzz * 3) * 4 : 0;
  return G_(x + shake, y, s, rot, [h("rect", { key: 1, x: -60, y: -110, width: 120, height: 220, rx: 18, fill: T.ink }),
    h("rect", { key: 2, x: -50, y: -98, width: 100, height: 196, rx: 10, fill: on ? T.screen : T.metal, opacity: on ? 1 : 0.6 }),
    typeof screen === "string" ? h("text", { key: 3, y: 10, textAnchor: "middle", fontSize: 30, fontWeight: 800, fill: T.ink, fontFamily: "Inter, sans-serif" }, screen) : screen]);
}
export function Laptop({ x = 0, y = 0, s = 1, on = 1 }) {
  const T = useTheme();
  return G_(x, y, s, 0, [h("rect", { key: 1, x: -130, y: -170, width: 260, height: 160, rx: 10, fill: T.ink }),
    h("rect", { key: 2, x: -118, y: -158, width: 236, height: 136, rx: 4, fill: on ? T.screen : T.metal }),
    h("path", { key: 3, d: "M -160 -10 L 160 -10 L 180 10 L -180 10 Z", fill: T.metal, ...ink(T) })]);
}
export function Bed({ x = 0, y = 0, s = 1 }) {
  const T = useTheme();
  return G_(x, y, s, 0, [h("rect", { key: 1, x: -260, y: -150, width: 520, height: 110, rx: 14, fill: T.paper, ...ink(T) }),
    h("rect", { key: 2, x: -260, y: -260, width: 40, height: 260, fill: T.wood, ...ink(T) }), h("rect", { key: 3, x: -210, y: -190, width: 140, height: 50, rx: 20, fill: T.head, ...ink(T) }),
    h("rect", { key: 4, x: -120, y: -170, width: 380, height: 60, rx: 18, fill: T.cast[1], ...ink(T) })]);
}
export function Car({ x = 0, y = 0, s = 1, color, lights = 0, facing = 1, wheel = 0 }) {
  const T = useTheme();
  return G_(x, y, s, 0, [h("g", { key: 1, transform: `scale(${facing} 1)` },
    lights ? h("path", { d: "M 250 -90 L 700 -170 L 700 20 Z", fill: T.light, opacity: 0.25 * lights }) : null,
    h("path", { d: "M -260 -60 L -230 -130 L -120 -140 L -60 -220 L 120 -220 L 190 -140 L 260 -120 L 270 -60 Z", fill: color || T.cast[0], ...ink(T) }),
    h("path", { d: "M -40 -200 L 100 -200 L 150 -140 L -100 -140 Z", fill: T.glass, ...ink(T), strokeWidth: T.line * 0.8 }),
    [-150, 160].map((wx) => h("g", { key: wx, transform: `translate(${wx} -50) rotate(${wheel})` }, h("circle", { r: 50, fill: T.ink }), h("circle", { r: 20, fill: T.metal }), h("line", { x1: -20, x2: 20, stroke: T.ink, strokeWidth: 6 }))))]);
}
export function Tree({ x = 0, y = 0, s = 1, f = 0 }) {
  const T = useTheme();
  return G_(x, y, s, wave(f, 0.03, 1.5), [h("rect", { key: 1, x: -18, y: -260, width: 36, height: 260, fill: T.wood, ...ink(T) }),
    h("circle", { key: 2, cx: 0, cy: -330, r: 130, fill: T.plant, ...ink(T) }), h("circle", { key: 3, cx: -90, cy: -260, r: 80, fill: T.plant, ...ink(T) }), h("circle", { key: 4, cx: 90, cy: -260, r: 80, fill: T.plant, ...ink(T) })]);
}
/** A row of buildings for a city background; lit windows flicker slowly. */
export function City({ y = 0, w = 1920, f = 0, seed = "c", lit = 0.5 }) {
  const T = useTheme();
  const kids = [];
  let x = -40, i = 0;
  while (x < w + 40) {
    const bw = 140 + rnd(`${seed}w${i}`) * 160, bh = 260 + rnd(`${seed}h${i}`) * 520;
    kids.push(h("rect", { key: `b${i}`, x, y: y - bh, width: bw, height: bh, fill: mix(T.wall2, T.ink, 0.25 + rnd(`${seed}c${i}`) * 0.3) }));
    for (let wy = y - bh + 40; wy < y - 40; wy += 70) for (let wx = x + 24; wx < x + bw - 40; wx += 56) {
      const on = rnd(`${seed}${wx}:${wy}`) < lit && rnd(`${seed}${wx}:${wy}:${Math.floor(f / 90)}`) > 0.08;
      if (on) kids.push(h("rect", { key: `w${wx}:${wy}`, x: wx, y: wy, width: 26, height: 34, fill: T.light, opacity: 0.75 }));
    }
    x += bw + 6; i++;
  }
  return h("g", null, ...kids);
}
export function Coin({ x = 0, y = 0, s = 1, spin = 0 }) {
  const T = useTheme();
  return G_(x, y, s, 0, [h("ellipse", { key: 1, rx: 40 * Math.max(0.15, Math.abs(Math.cos(spin))), ry: 40, fill: "#f2c94c", ...ink(T) }),
    h("text", { key: 2, y: 14, textAnchor: "middle", fontSize: 40, fontWeight: 900, fill: T.ink, opacity: Math.abs(Math.cos(spin)) > 0.5 ? 1 : 0, fontFamily: "Inter, sans-serif" }, "$")]);
}
export function Cash({ x = 0, y = 0, s = 1, rot = 0, n = 1 }) {
  const T = useTheme();
  return G_(x, y, s, rot, Array.from({ length: n }, (_, i) => h("g", { key: i, transform: `translate(${i * 8} ${-i * 10})` },
    h("rect", { x: -90, y: -45, width: 180, height: 90, rx: 8, fill: T.money, ...ink(T) }), h("circle", { r: 24, fill: "none", ...ink(T), strokeWidth: T.line * 0.6 }))));
}
export function Box({ x = 0, y = 0, s = 1, color, open = 0, ribbon = false }) {
  const T = useTheme();
  return G_(x, y, s, 0, [h("rect", { key: 1, x: -100, y: -160, width: 200, height: 160, fill: color || T.wood, ...ink(T) }),
    h("g", { key: 2, transform: `translate(-110 -160) rotate(${-open * 110})` }, h("rect", { x: 0, y: -34, width: 220, height: 34, fill: mix(color || T.wood, "#ffffff", 0.15), ...ink(T) })),
    ribbon ? h("rect", { key: 3, x: -14, y: -160, width: 28, height: 160, fill: T.cast[4] }) : null]);
}
export function Bag({ x = 0, y = 0, s = 1, color }) {
  const T = useTheme();
  return G_(x, y, s, 0, [h("rect", { key: 1, x: -110, y: -150, width: 220, height: 150, rx: 16, fill: color || T.ink, ...ink(T) }),
    h("path", { key: 2, d: "M -50 -150 Q -50 -200 0 -200 Q 50 -200 50 -150", fill: "none", ...ink(T), strokeWidth: T.line * 1.6 })]);
}
export function Clock({ x = 0, y = 0, s = 1, t = 0 }) {
  const T = useTheme();
  const a = t * 6;
  return G_(x, y, s, 0, [h("circle", { key: 1, r: 90, fill: T.paper, ...ink(T) }),
    h("line", { key: 2, x1: 0, y1: 0, x2: Math.sin((a * Math.PI) / 180) * 70, y2: -Math.cos((a * Math.PI) / 180) * 70, ...ink(T) }),
    h("line", { key: 3, x1: 0, y1: 0, x2: Math.sin((a / 12 * Math.PI) / 180) * 45, y2: -Math.cos((a / 12 * Math.PI) / 180) * 45, ...ink(T), strokeWidth: T.line * 1.4 })]);
}
export function Cup({ x = 0, y = 0, s = 1, steam = 0, f = 0 }) {
  const T = useTheme();
  return G_(x, y, s, 0, [h("path", { key: 1, d: "M -40 -90 L 40 -90 L 32 0 L -32 0 Z", fill: T.paper, ...ink(T) }),
    h("path", { key: 2, d: "M 40 -70 q 30 0 30 25 q 0 25 -34 25", fill: "none", ...ink(T) }),
    steam ? [0, 1].map((i) => h("path", { key: `s${i}`, d: `M ${-14 + i * 24} -110 q -12 -20 0 -40 q 12 -20 0 -40`, fill: "none", stroke: T.paper, strokeWidth: 5, opacity: 0.5 * steam * (0.6 + wave(f + i * 20, 0.1, 0.4)) })) : null]);
}
/** A sign or label on the set: the only text a film may show besides subtitles (one short piece at a time). */
export function Sign({ x = 0, y = 0, s = 1, text = "", color, rot = 0, size = 64 }) {
  const T = useTheme();
  const w = Math.max(160, String(text).length * size * 0.62 + 60);
  return G_(x, y, s, rot, [h("rect", { key: 1, x: -w / 2, y: -size, width: w, height: size * 2, rx: 14, fill: color || T.paper, ...ink(T) }),
    h("text", { key: 2, y: size * 0.36, textAnchor: "middle", fontSize: size, fontWeight: 900, fill: T.ink, fontFamily: "Inter, sans-serif" }, text)]);
}
/** A thought or speech bubble holding a small drawing (never a sentence). */
export function Bubble({ x = 0, y = 0, s = 1, think = true, children = null, w = 300, hgt = 220, tail = -1 }) {
  const T = useTheme();
  return G_(x, y, s, 0, [h("ellipse", { key: 1, rx: w / 2, ry: hgt / 2, fill: T.paper, ...ink(T) }),
    think ? [0, 1].map((i) => h("circle", { key: `t${i}`, cx: tail * (w * 0.3 + i * 40), cy: hgt / 2 + 30 + i * 46, r: 22 - i * 8, fill: T.paper, ...ink(T) }))
      : h("path", { key: 2, d: `M ${tail * 30} ${hgt / 2 - 6} L ${tail * 90} ${hgt / 2 + 70} L ${tail * 80} ${hgt / 2 - 10}`, fill: T.paper, ...ink(T) }),
    h("g", { key: 3 }, children)]);
}
/** A heart, a star, a question or exclamation mark, a check or cross: small symbols for bubbles and reactions. */
export function Symbol({ x = 0, y = 0, s = 1, kind = "heart", color }) {
  const T = useTheme();
  const c = color || T.danger;
  const d = {
    heart: "M 0 30 C -60 -10 -40 -60 0 -30 C 40 -60 60 -10 0 30 Z",
    star: "M 0 -50 L 14 -16 L 50 -16 L 22 6 L 32 42 L 0 20 L -32 42 L -22 6 L -50 -16 L -14 -16 Z",
    check: "M -40 0 L -10 30 L 45 -35", cross: "M -35 -35 L 35 35 M 35 -35 L -35 35",
    bolt: "M 10 -60 L -30 10 L 0 10 L -10 60 L 30 -10 L 0 -10 Z",
  }[kind];
  if (kind === "question" || kind === "exclaim") return G_(x, y, s, 0, h("text", { y: 30, textAnchor: "middle", fontSize: 110, fontWeight: 900, fill: color || T.ink, fontFamily: "Inter, sans-serif" }, kind === "question" ? "?" : "!"));
  const line = kind === "check" || kind === "cross";
  return G_(x, y, s, 0, h("path", { d, fill: line ? "none" : c, stroke: line ? (color || (kind === "check" ? T.good : T.danger)) : T.ink, strokeWidth: line ? T.line * 2 : T.line * 0.8, strokeLinecap: "round", strokeLinejoin: "round" }));
}

// ---------- sets ----------
/** An inside room: back wall, floor, a skirting line. horizon = the floor's top edge (y). */
export function Room({ W, H, horizon, wall, floor }) {
  const T = useTheme();
  const hz = horizon ?? H * 0.68;
  return h("g", null, h("rect", { x: -W, y: -H, width: W * 3, height: hz + H, fill: wall || T.wall }),
    h("rect", { x: -W, y: hz, width: W * 3, height: H * 2, fill: floor || T.floor }),
    h("rect", { x: -W, y: hz - 14, width: W * 3, height: 14, fill: mix(wall || T.wall, T.ink, 0.35) }),
    h("rect", { x: -W, y: hz, width: W * 3, height: 30, fill: "#000", opacity: T.shadow * 0.35 }));
}
/** Outside: sky gradient, ground, optional city or hills. time: "day" | "dusk" | "night". */
export function Outside({ W, H, horizon, time = "night", city = true, hills = false, f = 0, seed = "o" }) {
  const T = useTheme();
  const hz = horizon ?? H * 0.68;
  const id = `sky-${seed}`;
  const top = time === "day" ? T.sky[1] : time === "dusk" ? mix(T.sky[1], "#ff8a5c", 0.55) : T.sky[0];
  const bottom = time === "day" ? mix(T.sky[1], "#ffffff", 0.4) : time === "dusk" ? mix("#ffb36b", T.sky[1], 0.3) : T.sky[1];
  return h("g", null,
    h("defs", null, h("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 }, h("stop", { offset: "0", stopColor: top }), h("stop", { offset: "1", stopColor: bottom }))),
    h("rect", { x: -W, y: -H, width: W * 3, height: hz + H, fill: `url(#${id})` }),
    time === "night" ? Array.from({ length: 40 }, (_, i) => h("circle", { key: i, cx: rnd(`${seed}sx${i}`) * W, cy: rnd(`${seed}sy${i}`) * hz * 0.6, r: 2 + rnd(`${seed}sr${i}`) * 2.5, fill: "#fff", opacity: 0.4 + 0.4 * Math.abs(Math.sin(f * 0.05 + i)) })) : null,
    hills ? h("path", { d: `M ${-W} ${hz} Q ${W * 0.25} ${hz - 220} ${W * 0.5} ${hz - 60} T ${W * 2} ${hz} Z`, fill: mix(T.plant, T.ink, time === "night" ? 0.6 : 0.1) }) : null,
    city ? h(City, { y: hz, w: W, f, seed, lit: time === "night" ? 0.45 : 0 }) : null,
    h("rect", { x: -W, y: hz, width: W * 3, height: H * 2, fill: T.floor2 }));
}
/** An empty stage: dark around one pool of light. */
export function Stage({ W, H, horizon, x }) {
  const T = useTheme();
  const hz = horizon ?? H * 0.7;
  return h("g", null, h("rect", { x: -W, y: -H, width: W * 3, height: H * 3, fill: T.bg }),
    h("rect", { x: -W, y: hz, width: W * 3, height: H * 2, fill: mix(T.floor2, T.bg, 0.5) }),
    h(Spot, { x: x ?? W / 2, top: -40, bottom: hz + 40, w: W * 0.5 }));
}

// ---------- light, air, camera ----------
/** A cone of light from (x, top) to an ellipse on the floor at `bottom`. */
export function Spot({ x, top = 0, bottom, w = 600, color, power = 1 }) {
  const T = useTheme();
  const c = color || T.light;
  const id = `spot${Math.round(x)}${Math.round(bottom)}`;
  return h("g", null,
    h("defs", null, h("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 }, h("stop", { offset: "0", stopColor: c, stopOpacity: 0.55 * power }), h("stop", { offset: "1", stopColor: c, stopOpacity: 0.12 * power }))),
    h("path", { d: `M ${x - 40} ${top} L ${x + 40} ${top} L ${x + w / 2} ${bottom} L ${x - w / 2} ${bottom} Z`, fill: `url(#${id})`, style: { mixBlendMode: "screen" } }),
    h("ellipse", { cx: x, cy: bottom, rx: w / 2, ry: w / 9, fill: c, opacity: 0.22 * power }));
}
/** A soft round glow (a screen, a candle, a street light). */
export function Glow({ x, y, r = 220, color, power = 1 }) {
  const T = useTheme();
  const id = `glow${Math.round(x)}${Math.round(y)}${Math.round(r)}`;
  return h("g", null, h("defs", null, h("radialGradient", { id }, h("stop", { offset: "0", stopColor: color || T.glow, stopOpacity: 0.7 * power }), h("stop", { offset: "1", stopColor: color || T.glow, stopOpacity: 0 }))),
    h("circle", { cx: x, cy: y, r, fill: `url(#${id})`, style: { mixBlendMode: "screen" } }));
}
/** Something always moving in the air: rain, dust, snow, confetti or sparks. */
export function Air({ W, H, f, kind = "dust", n = 60, seed = "air", color }) {
  const T = useTheme();
  const items = [];
  for (let i = 0; i < n; i++) {
    const r0 = rnd(`${seed}${i}`), r1 = rnd(`${seed}y${i}`), r2 = rnd(`${seed}z${i}`);
    if (kind === "rain") {
      const y = ((r1 * H + f * (38 + r2 * 18)) % (H + 200)) - 100, x = (r0 * W * 1.2 - f * 6) % (W * 1.2);
      items.push(h("line", { key: i, x1: x, y1: y, x2: x - 10, y2: y + 50, stroke: color || T.screen, strokeWidth: 3, opacity: 0.35 }));
    } else if (kind === "snow" || kind === "dust") {
      const y = ((r1 * H + f * (kind === "snow" ? 3 + r2 * 3 : 0.6 + r2)) % H), x = r0 * W + wave(f + i * 13, 0.03, kind === "snow" ? 30 : 12);
      items.push(h("circle", { key: i, cx: x, cy: y, r: kind === "snow" ? 4 + r2 * 5 : 2 + r2 * 3, fill: color || (kind === "snow" ? "#fff" : T.glow), opacity: kind === "snow" ? 0.8 : 0.25 + r2 * 0.3 }));
    } else if (kind === "confetti" || kind === "sparks") {
      const y = ((r1 * H + f * (8 + r2 * 10)) % (H + 100)) - 50, x = r0 * W + wave(f + i * 7, 0.08, 20);
      items.push(h("rect", { key: i, x, y, width: kind === "sparks" ? 6 : 16, height: kind === "sparks" ? 6 : 26, fill: color || T.cast[i % T.cast.length], transform: `rotate(${f * 6 + i * 40} ${x} ${y})`, opacity: 0.9 }));
    }
  }
  return h("g", null, ...items);
}
/** Lines of motion behind something moving fast, or around an impact. */
export function Speed({ x, y, len = 300, n = 5, dir = -1, opacity = 0.6 }) {
  const T = useTheme();
  return h("g", { opacity }, Array.from({ length: n }, (_, i) => h("line", { key: i, x1: x, y1: y + (i - n / 2) * 30, x2: x + dir * (len - i * 30), y2: y + (i - n / 2) * 30, stroke: T.ink, strokeWidth: T.line, strokeLinecap: "round" })));
}
export function Impact({ x, y, f, at, r = 160 }) {
  const T = useTheme();
  const p = ramp(f, at, at + 8), o = 1 - ramp(f, at + 6, at + 16);
  if (f < at || o <= 0) return null;
  return h("g", { opacity: o }, Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2, r0 = r * 0.5 * p + 20, r1 = r * p + 30;
    return h("line", { key: i, x1: x + Math.cos(a) * r0, y1: y + Math.sin(a) * r0, x2: x + Math.cos(a) * r1, y2: y + Math.sin(a) * r1, stroke: T.ink, strokeWidth: T.line * 1.2, strokeLinecap: "round" });
  }));
}

/** A small random shake that dies down after frame `at` (an impact, a slammed door). */
export const shake = (f, at, amp = 14, dur = 12) => (f < at || f > at + dur ? [0, 0] : [(rnd(`sx${f}`) - 0.5) * 2 * amp * (1 - (f - at) / dur), (rnd(`sy${f}`) - 0.5) * 2 * amp * (1 - (f - at) / dur)]);

/**
 * The film as a list of shots. Each shot starts at its frame `at` and lasts until the next one.
 *   { at, zoom: [from, to], focus: [x, y], hand: 0..1 (handheld drift), shake: [frame, amp], dip: true (2 black frames before it),
 *     render: (lf, p) => elements }   lf = frames since the shot started, p = 0..1 through the shot.
 */
export function Shots({ f, shots, W, H }) {
  const list = [...shots].filter((s) => Number.isFinite(s.at)).sort((a, b) => a.at - b.at);
  if (!list.length) return null;
  let i = 0;
  for (let k = 0; k < list.length; k++) if (f >= list[k].at) i = k;
  const s = list[i], next = list[i + 1];
  const end = next ? next.at : s.at + 150;
  const p = ramp(f, s.at, end);
  const [z0, z1] = s.zoom || [1, 1.06];
  const z = lerp(z0, z1, eio(p));
  const [fx, fy] = s.focus || [W / 2, H / 2];
  const hand = s.hand ?? 0.4;
  const dx = wave(f, 0.031, 6 * hand) + wave(f, 0.017, 4 * hand, 2), dy = wave(f, 0.027, 5 * hand, 1);
  const [sx, sy] = s.shake ? shake(f, s.shake[0], s.shake[1] ?? 14) : [0, 0];
  const dipped = next?.dip && f >= next.at - 2;
  return h("g", null,
    h("g", { transform: `translate(${fx + dx + sx} ${fy + dy + sy}) scale(${z}) translate(${-fx} ${-fy})` }, s.render(f - s.at, p)),
    dipped || (s.dip && f < s.at + 1) ? h("rect", { x: 0, y: 0, width: W, height: H, fill: "#000" }) : null);
}

// ---------- talking maps: countries as characters ----------
const geoOf = (c) => {
  const k = String(c || "").trim();
  return GEO[k.toUpperCase()] || Object.values(GEO).find((g) => g.name.toLowerCase() === k.toLowerCase()) || null;
};
/** Is this a country the kit can draw? (ISO alpha-2 code like "MA", or the English name like "Morocco") */
export const hasCountry = (c) => !!geoOf(c);

/**
 * <Country c="MA" x y size={600} s color mood talk f facing lookX hop opacity face label />
 *  A country's real outline as a character. x, y = the centre of the shape; size = its longest side in pixels (× s).
 *  color: its fill (use T.cast[i]); mood: like Figure; talk: 0..1, its mouth moves while it "speaks" (e.g. talk={ramp(f, cue("Morocco"), cueEnd(...))});
 *  hop: 0..1 a little jump (pop(f, at)); lookX: -1..1 its eyes; label: its name under it (in the video's language).
 *  map={view}: put it ON a MapView drawn with the same props (view = { W, H, focus, pad, zoom, pan }): exact place and scale, no x/y/size needed.
 */
export function Country({ c, x = 0, y = 0, size = 600, s = 1, color, mood = "neutral", talk = 0, f = 0, lookX = 0, hop = 0, opacity = 1, face = true, label = null, tilt = 0, map = null }) {
  const T = useTheme();
  const g = geoOf(c);
  if (!g) return h("g", { opacity }, h("circle", { cx: x, cy: y, r: size * s * 0.3, fill: color || T.cast[0], stroke: T.ink, strokeWidth: T.line }));
  const [x0, y0, x1, y1] = g.box;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let k = (size * s) / Math.max(x1 - x0, y1 - y0, 1);
  // map: the same props as the MapView under it: the character sits exactly on its place on that map, at the map's scale
  if (map && map.W) {
    const m = mapFrame(map);
    k = m.k * s;
    x = map.W / 2 + (cx - m.cx) * m.k; y = map.H / 2 + (cy - m.cy) * m.k;
    size = Math.max(x1 - x0, y1 - y0) * m.k; s = 1;
  }
  const breathe = 1 + wave(f, 0.07, 0.012, (g.name.length || 1) * 0.7);
  const jump = -Math.sin(clamp01(hop) * Math.PI) * size * s * 0.12;
  const fill = color || T.cast[0];
  // the face sits on the largest part, sized to the shape's smaller side
  const fx = (g.c[0] - cx) * k, fy = (g.c[1] - cy) * k;
  const r = Math.max(18, Math.min((x1 - x0) * k, (y1 - y0) * k) * 0.2);
  const blink = (f + g.name.length * 13) % 117 < 4;
  const open = clamp01(talk) * (0.35 + 0.65 * Math.abs(Math.sin(f * 0.62 + g.name.length)));
  const ink = T.ink;
  return h("g", { opacity, transform: `translate(${x} ${y + jump}) rotate(${tilt}) scale(${breathe})` },
    map ? null : h("ellipse", { cx: 0, cy: (y1 - cy) * k + size * s * 0.05 - jump, rx: (x1 - x0) * k * 0.45, ry: size * s * 0.04, fill: alpha(ink, T.shadow * 0.6) }),
    h("path", { d: g.shape || g.full, transform: `scale(${k}) translate(${-cx} ${-cy})`, fill, stroke: ink, strokeWidth: (T.line * 1.1) / k, strokeLinejoin: "round" }),
    face ? h("g", { transform: `translate(${fx} ${fy})` },
      h("circle", { cx: -r * 0.34, cy: -r * 0.08, r: r * 0.24, fill: T.head, opacity: 0.95 }),
      h("circle", { cx: r * 0.34, cy: -r * 0.08, r: r * 0.24, fill: T.head, opacity: 0.95 }),
      open > 0.02
        ? h("g", null, h(Face, { mood: mood === "happy" || mood === "sad" || mood === "angry" || mood === "worried" ? mood : "neutral", blink, r, ink, lookX }),
          h("rect", { x: -r * 0.32, y: r * 0.3, width: r * 0.64, height: r * 0.34, fill: fill }),
          h("ellipse", { cx: 0, cy: r * 0.44, rx: r * 0.2, ry: r * (0.05 + 0.2 * open), fill: ink }))
        : h(Face, { mood, blink, r, ink, lookX })) : null,
    label ? h("text", { x: 0, y: (y1 - cy) * k + size * s * 0.16, textAnchor: "middle", fontSize: Math.max(28, size * s * 0.09), fontWeight: 800,
      fill: T.caption.color, stroke: T.caption.stroke, strokeWidth: 6, paintOrder: "stroke", fontFamily: "Inter, Noto Sans Arabic, sans-serif" }, label) : null);
}

/**
 * <MapView W={W} H={H} focus={["MA", "DZ"]} pad={0.25} highlight={{ MA: T.cast[0], DZ: T.cast[1] }} dim={0.4} zoom={1} pan={[0, 0]} />
 *  A real map of the region around the focus countries (the sea, every country, borders), framed to fit them. highlight colours some
 *  countries; dim (0..1) fades the others; zoom > 1 pushes in; pan moves the framing (fractions of W, H). Draw it first, as the set.
 *  labels: true (English names of the highlighted ones) or { MA: "المغرب", DZ: "الجزائر" } (your own words, in the video's language).
 *  mapPoint(...) (same props + the country) gives the screen x, y of a country's centre on that map, to put a Country, a pin or an arrow there.
 */
function mapFrame({ W, H, focus = [], pad = 0.25, zoom = 1, pan = [0, 0] }) {
  const gs = [].concat(focus).map(geoOf).filter(Boolean);
  let [x0, y0, x1, y1] = gs.length ? gs.reduce((b, g) => [Math.min(b[0], g.box[0]), Math.min(b[1], g.box[1]), Math.max(b[2], g.box[2]), Math.max(b[3], g.box[3])], [Infinity, Infinity, -Infinity, -Infinity]) : [0, 300, 4000, 3300];
  const w = Math.max(x1 - x0, 20), hgt = Math.max(y1 - y0, 20);
  const k = Math.min(W / (w * (1 + 2 * pad)), H / (hgt * (1 + 2 * pad))) * (zoom || 1);
  const cx = (x0 + x1) / 2 - (pan[0] || 0) * W / k, cy = (y0 + y1) / 2 - (pan[1] || 0) * H / k;
  return { k, cx, cy, view: [cx - W / 2 / k, cy - H / 2 / k, cx + W / 2 / k, cy + H / 2 / k] };
}
export function mapPoint({ W, H, focus, pad, zoom, pan }, c) {
  const g = geoOf(c);
  const m = mapFrame({ W, H, focus, pad, zoom, pan });
  if (!g) return [W / 2, H / 2];
  return [W / 2 + (g.c[0] - m.cx) * m.k, H / 2 + (g.c[1] - m.cy) * m.k];
}
export function MapView({ W, H, focus = [], pad = 0.25, zoom = 1, pan = [0, 0], highlight = {}, dim = 0, labels = false }) {
  const T = useTheme();
  const m = mapFrame({ W, H, focus, pad, zoom, pan });
  const [vx0, vy0, vx1, vy1] = m.view;
  const hl = {};
  for (const [key, col] of Object.entries(highlight || {})) { const g = geoOf(key); if (g) hl[g.name] = col; }
  const shown = Object.values(GEO).filter((g) => {
    const [a, b, c2, d] = g.box[0] !== undefined ? g.box : [0, 0, 0, 0];
    return !(c2 < vx0 || a > vx1 || d < vy0 || b > vy1) || hl[g.name];
  });
  const sw = Math.max(0.6, T.line * 0.35) / m.k;
  return h("g", null,
    h("rect", { x: 0, y: 0, width: W, height: H, fill: T.sea }),
    h("g", { transform: `translate(${W / 2} ${H / 2}) scale(${m.k}) translate(${-m.cx} ${-m.cy})` },
      shown.map((g) => h("path", { key: g.name, d: g.full, fill: hl[g.name] || T.land, opacity: hl[g.name] ? 1 : 1 - clamp01(dim) * 0.6,
        stroke: hl[g.name] ? T.ink : T.border, strokeWidth: hl[g.name] ? sw * 2.2 : sw, strokeLinejoin: "round" }))),
    labels ? Object.entries(labels === true ? Object.fromEntries(Object.keys(hl).map((n) => [n, n])) : labels).map(([key, text]) => {
      const g = geoOf(key);
      if (!g) return null;
      const name = text;
      const px = W / 2 + (g.c[0] - m.cx) * m.k, py = H / 2 + (g.c[1] - m.cy) * m.k;
      return h("text", { key: `l${key}`, x: px, y: py, textAnchor: "middle", fontSize: Math.max(26, W * 0.03), fontWeight: 800, fill: T.caption.color,
        stroke: T.caption.stroke, strokeWidth: 6, paintOrder: "stroke", fontFamily: "Inter, Noto Sans Arabic, sans-serif" }, name);
    }) : null);
}
