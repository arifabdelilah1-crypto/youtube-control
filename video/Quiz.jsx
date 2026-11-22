// The Quiz style's scenes (settings.mix.quiz = true, render/quiz.mjs writes them): coded, nothing painted or downloaded.
//   intro   the quiz's title, big, with question marks floating around
//   ask     "QUESTION 2/4", the question, an optional picture (a real map or an icon), the answers popping in as they're read,
//           then a countdown ring over the picture (the scene's silent hold) with a soft tick each second
//   reveal  the same card: the right answer turns green with a check, the others grey out, a one-line fact below
//   outro   "How many did you get?" and the comment call to action
import React from "react";
import { AbsoluteFill, Html5Audio, Sequence, interpolate, staticFile } from "remotion";
import { ICONS } from "./explainer-icons.js";
import { MapView, THEMES, ThemeContext } from "./story/kit.js";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
const LETTERS = ["A", "B", "C", "D"];
const C = { bg1: "#1b1446", bg2: "#3a1d7a", card: "#ffffff", ink: "#17123a", gold: "#ffd23f", good: "#2ecc71", bad: "#9aa0b4", pink: "#ff5d8f" };
const MAP = { ...THEMES.paper, sea: "#8fb6d9", land: "#f1e9cf", border: "#3d3358", ink: "#17123a", line: 5 };
const norm = (w) => String(w || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]/gu, "");
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const pop = (frame, at, len = 9) => { const t = Math.min(1, Math.max(0, (frame - at) / len)); return t < 1 ? 1.12 * ease(t) - 0.12 * t * t : 1; };

export const sfxUrl = (base, name) => (base ? new URL(`sfx/${name}`, base).href : staticFile(`sfx/${name}`));

/** The frame each answer appears: when its first word is heard (after the question), else spread over the voice. */
function answerFrames(options, words, voiceFrames, fps) {
  const out = [];
  let k = Math.floor(words.length * 0.3);
  options.forEach((o, j) => {
    const want = norm(String(o).split(/\s+/)[0]);
    let hit = -1;
    for (let x = k; want && x < words.length; x++) if (norm(words[x].w) === want || (want.length > 3 && norm(words[x].w).startsWith(want))) { hit = x; break; }
    if (hit >= 0) k = hit + 1;
    out.push(hit >= 0 ? Math.max(4, Math.round(words[hit].s * fps) - 3) : Math.round(voiceFrames * (0.45 + (0.5 * j) / Math.max(1, options.length))));
  });
  return out;
}

function Background({ frame, W, H }) {
  const dots = Array.from({ length: 14 }, (_, i) => ({ x: ((i * 397) % 100) / 100, y: ((i * 211) % 100) / 100, r: 6 + (i % 4) * 5, c: [C.gold, C.pink, "#5ad1ff", "#ffffff"][i % 4] }));
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 30%, ${C.bg2} 0%, ${C.bg1} 70%)` }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        {dots.map((d, i) => <circle key={i} cx={d.x * W} cy={(d.y * H + frame * (0.6 + (i % 3) * 0.4)) % H} r={d.r} fill={d.c} opacity={0.18} />)}
      </svg>
    </AbsoluteFill>
  );
}

function Picture({ v, frame, w, h }) {
  if (!v || typeof v !== "object") return null;
  if (v.type === "map" && Array.isArray(v.focus) && v.focus.length) {
    const highlight = {};
    for (const c of [].concat(v.highlight || [])) highlight[c] = C.gold;
    return (
      <ThemeContext.Provider value={MAP}>
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ borderRadius: 36, background: MAP.sea }}>
          <MapView W={w} H={h} focus={v.focus.slice(0, 6)} pad={Number(v.pad) > 0 ? Number(v.pad) : 0.6} zoom={1 + 0.0015 * frame} highlight={highlight} labels={false} />
        </svg>
      </ThemeContext.Provider>
    );
  }
  const icon = ICONS[v.icon];
  if (v.type === "icon" && icon) {
    const s = Math.min(w, h) * 0.8;
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <circle cx={w / 2} cy={h / 2} r={s / 2} fill={C.gold} opacity={0.9} />
        <g transform={`translate(${w / 2 - s * 0.32} ${h / 2 - s * 0.32 + Math.sin(frame / 12) * 6}) scale(${(s * 0.64) / 24})`} fill="none" stroke={C.ink} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
          {icon.map(([tag, attrs], j) => React.createElement(tag, { key: j, ...attrs }))}
        </g>
      </svg>
    );
  }
  if (v.type === "emoji" && v.emoji) return <div style={{ width: w, height: h, display: "flex", alignItems: "center", justifyContent: "center", fontSize: Math.min(w, h) * 0.7 }}>{String(v.emoji).slice(0, 8)}</div>;
  return null;
}

function Countdown({ frame, start, frames, fps, size, font }) {
  const t = frame - start;
  if (t < 0) return null;
  const secs = Math.max(1, Math.round(frames / fps));
  const left = Math.max(1, secs - Math.floor(t / fps));
  const p = Math.min(1, t / frames);
  const r = size * 0.42, len = 2 * Math.PI * r;
  const beat = 1 + 0.08 * Math.max(0, 1 - (t % fps) / 8);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: `scale(${beat})`, filter: "drop-shadow(0 10px 24px rgba(0,0,0,.45))" }}>
      <circle cx={size / 2} cy={size / 2} r={r + 18} fill={C.bg1} opacity={0.92} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#ffffff22" strokeWidth={22} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={left <= 2 ? C.pink : C.gold} strokeWidth={22} strokeLinecap="round"
        strokeDasharray={len} strokeDashoffset={len * p} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central" fontSize={size * 0.42} fontWeight={800} fill="#fff" fontFamily={font}>{left}</text>
    </svg>
  );
}

export function QuizScene({ s, frame, fps, width: W, height: H, font, rtl, assetBase }) {
  const d = s.data || {};
  const phase = ["intro", "ask", "reveal", "outro"].includes(d.phase) ? d.phase : "ask";
  const wide = W > H;
  const u = Math.min(W, H) / 1080;   // 1 at 1080 px
  const dir = rtl ? "rtl" : "ltr";
  const base = { position: "absolute", left: 0, right: 0, fontFamily: font, direction: dir, textAlign: "center", color: "#fff" };

  if (phase === "intro" || phase === "outro") {
    const big = String((phase === "intro" ? d.title : d.line) || "").slice(0, 90);
    const small = String((phase === "intro" ? d.subtitle : d.cta) || "").slice(0, 90);
    const a = pop(frame, 2, 12);
    return (
      <AbsoluteFill>
        <Background frame={frame} W={W} H={H} />
        {["?", "?", "?", "?"].map((q, i) => (
          <div key={i} style={{ ...base, left: undefined, right: undefined, top: H * [0.1, 0.18, 0.72, 0.8][i], [i % 2 ? "right" : "left"]: W * 0.08, fontSize: 170 * u, fontWeight: 800,
            color: [C.gold, C.pink, "#5ad1ff", C.gold][i], opacity: 0.85, transform: `rotate(${(i % 2 ? 1 : -1) * 14 + Math.sin((frame + i * 9) / 10) * 8}deg)` }}>{q}</div>
        ))}
        <div style={{ ...base, top: H * 0.3, padding: `0 ${70 * u}px`, transform: `scale(${a})` }}>
          {phase === "intro" && d.count ? <div style={{ display: "inline-block", background: C.gold, color: C.ink, borderRadius: 999, padding: `${12 * u}px ${40 * u}px`, fontSize: 54 * u, fontWeight: 800, marginBottom: 40 * u }}>
            {d.count_label || `${d.count} QUESTIONS`}</div> : null}
          <div style={{ fontSize: (big.length > 40 ? 92 : 112) * u, fontWeight: 800, lineHeight: 1.08, textShadow: "0 8px 0 rgba(0,0,0,.35)", textTransform: "uppercase" }}>{big}</div>
          {small ? <div style={{ marginTop: 44 * u, fontSize: 56 * u, fontWeight: 800, color: C.gold, opacity: interpolate(frame, [10, 20], [0, 1], clamp) }}>{small}</div> : null}
        </div>
        {phase === "outro" && d.total ? (
          <div style={{ ...base, top: H * 0.62, display: "flex", justifyContent: "center", gap: 22 * u }}>
            {Array.from({ length: d.total }, (_, k) => <div key={k} style={{ width: 110 * u, height: 110 * u, borderRadius: 999, background: C.gold, color: C.ink, fontSize: 60 * u, fontWeight: 800,
              display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${pop(frame, 14 + k * 5)})` }}>{k + 1}</div>)}
          </div>) : null}
      </AbsoluteFill>
    );
  }

  const options = (Array.isArray(d.options) ? d.options : []).slice(0, 4).map((o) => String(o).slice(0, 60));
  const answer = Math.max(0, Math.min(options.length - 1, Number(d.answer) || 0));
  const reveal = phase === "reveal";
  const at = reveal ? options.map(() => -100) : answerFrames(options, s.words || [], s.voiceFrames || s.dur, fps);
  const hold = Math.max(0, s.dur - (s.voiceFrames || s.dur));
  const hasPic = !!(d.visual && (d.visual.type === "map" ? d.visual.focus?.length : d.visual.type === "icon" ? ICONS[d.visual.icon] : d.visual.emoji));
  const qLen = String(d.question || "").length;
  // 9:16: header, question, picture, answers, fact; 16:9: question on top, picture left, answers right
  const L = wide
    ? { head: H * 0.05, q: H * 0.15, picX: W * 0.05, picY: H * 0.36, picW: W * 0.36, picH: H * 0.5, optX: W * 0.45, optY: H * 0.36, optW: W * 0.5, optH: H * 0.11, gap: H * 0.025 }
    : { head: H * 0.065, q: H * 0.11, picX: W * 0.1, picY: H * 0.275, picW: W * 0.8, picH: H * 0.2, optX: W * 0.07, optY: H * (hasPic ? 0.495 : 0.4), optW: W * 0.86, optH: H * 0.068, gap: H * 0.014 };
  const ringSize = Math.min(L.picW, L.picH, 360 * u) * (hasPic ? 1 : 0.9);
  const revealT = reveal ? ease(frame / 10) : 0;
  return (
    <AbsoluteFill>
      <Background frame={frame} W={W} H={H} />
      <div style={{ ...base, top: L.head, display: "flex", justifyContent: "center", gap: 14 * u, alignItems: "center" }}>
        <div style={{ background: C.gold, color: C.ink, borderRadius: 999, padding: `${8 * u}px ${30 * u}px`, fontSize: 40 * u, fontWeight: 800 }}>{d.label || `QUESTION ${d.n || 1}/${d.total || 1}`}</div>
      </div>
      <div style={{ ...base, top: L.q, padding: `0 ${60 * u}px`, fontSize: (qLen > 90 ? 58 : qLen > 55 ? 66 : 76) * u, fontWeight: 800, lineHeight: 1.15, textShadow: "0 5px 0 rgba(0,0,0,.3)",
        opacity: interpolate(frame, [0, 6], [reveal ? 1 : 0, 1], clamp) }}>{String(d.question || "").slice(0, 160)}</div>
      {hasPic ? (
        <div style={{ position: "absolute", left: L.picX, top: L.picY, width: L.picW, height: L.picH, display: "flex", alignItems: "center", justifyContent: "center",
          transform: `scale(${reveal ? 1 : pop(frame, 3, 12)})`, opacity: reveal ? 1 - 0.8 * revealT : 1 }}>
          <Picture v={d.visual} frame={frame} w={L.picW} h={L.picH} />
        </div>) : null}
      {options.map((o, k) => {
        const p = reveal ? 1 : pop(frame, at[k]);
        const right = k === answer;
        const bg = reveal ? (right ? C.good : "#ffffff") : "#ffffff";
        const y = L.optY + k * (L.optH + L.gap);
        return (
          <div key={k} style={{ position: "absolute", left: L.optX, top: y, width: L.optW, height: L.optH, borderRadius: L.optH / 2, background: bg, direction: dir,
            display: "flex", alignItems: "center", gap: 24 * u, padding: `0 ${18 * u}px`, boxSizing: "border-box", fontFamily: font,
            opacity: reveal && !right ? 1 - 0.55 * revealT : p > 0 ? 1 : 0,
            transform: `scale(${reveal && right ? 1 + 0.06 * Math.sin(Math.min(1, frame / 12) * Math.PI) : Math.max(0, p)})`, boxShadow: "0 8px 0 rgba(0,0,0,.25)" }}>
            <div style={{ width: L.optH * 0.74, height: L.optH * 0.74, borderRadius: 999, flex: "none", background: reveal && right ? "#fff" : C.bg1, color: reveal && right ? C.good : "#fff",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: L.optH * 0.4, fontWeight: 800 }}>{reveal && right ? "✓" : LETTERS[k]}</div>
            <div style={{ flex: 1, color: reveal && right ? "#fff" : C.ink, fontSize: (o.length > 28 ? 42 : 50) * u, fontWeight: 800, lineHeight: 1.05, textAlign: rtl ? "right" : "left" }}>{o}</div>
          </div>
        );
      })}
      {!reveal && hold > fps * 0.8 ? (
        <div style={{ position: "absolute", left: hasPic ? L.picX + L.picW / 2 - ringSize / 2 : W / 2 - ringSize / 2, top: hasPic ? L.picY + L.picH / 2 - ringSize / 2 : L.optY + 4 * (L.optH + L.gap) + 10 * u,
          width: ringSize, height: ringSize }}>
          <Countdown frame={frame} start={s.voiceFrames} frames={hold} fps={fps} size={ringSize} font={font} />
        </div>) : null}
      {reveal && d.fact ? (
        // the fact goes where the picture was (the bottom of a Short is under YouTube's own title and buttons)
        <div style={{ position: "absolute", left: L.picX, top: hasPic ? L.picY : L.optY - 40 * u - 230 * u, width: L.picW, height: hasPic ? L.picH : 230 * u, display: "flex", alignItems: "center", justifyContent: "center",
          boxSizing: "border-box", padding: `${20 * u}px ${36 * u}px`, borderRadius: 36 * u, background: "rgba(23,18,58,.92)", border: `${5 * u}px solid ${C.gold}`,
          fontFamily: font, direction: dir, textAlign: "center", fontSize: (String(d.fact).length > 90 ? 46 : 56) * u, fontWeight: 800, color: "#fff", lineHeight: 1.2,
          opacity: interpolate(frame, [6, 14], [0, 1], clamp), transform: `scale(${pop(frame, 6, 10)})` }}>{String(d.fact).slice(0, 160)}</div>) : null}
      {/* a soft tick each second of the countdown, a ding on the answer */}
      {!reveal && hold > fps * 0.8 ? Array.from({ length: Math.round(hold / fps) }, (_, k) => (
        <Sequence key={k} from={s.voiceFrames + k * fps} durationInFrames={Math.round(fps * 0.3)} layout="none"><Html5Audio src={sfxUrl(assetBase, "tick.mp3")} volume={0.5} /></Sequence>
      )) : null}
      {reveal ? <Sequence from={0} durationInFrames={Math.round(fps * 0.5)} layout="none"><Html5Audio src={sfxUrl(assetBase, "ding.mp3")} volume={0.45} /></Sequence> : null}
    </AbsoluteFill>
  );
}
