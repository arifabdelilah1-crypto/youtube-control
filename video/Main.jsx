// The video itself. Same component in the browser preview (Remotion Player) and the final render.
import React from "react";
import { AbsoluteFill, Easing, Html5Audio, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { ARABIC, LATIN, useFonts } from "./fonts.js";
import { COVER_FRAMES, MUSIC_UNDER_VOICE } from "./layout.js";
import { Thumbnail } from "./Thumbnail.jsx";

// "static:sfx/x.mp3" = file shipped with the renderer bundle; anything else is a normal URL.
const src = (u) => (u && u.startsWith("static:") ? staticFile(u.slice(7)) : u);


const CARD_GRADIENTS = [
  ["#0F2027", "#2C5364"], ["#232526", "#414345"], ["#1F1C2C", "#928DAB"], ["#141E30", "#243B55"], ["#3A1C71", "#D76D77"],
];

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };

function rgb(hex) {
  let h = String(hex || "").replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return /^[0-9a-f]{6}$/i.test(h) ? [n >> 16, (n >> 8) & 255, n & 255] : null;
}
const luma = (hex) => { const c = rgb(hex); return c ? 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] : 0; };
const inkOn = (hex) => (luma(hex) > 150 ? "#111" : "#fff");

// Ken Burns moves for photos, a different one each scene: [scale from, to], [x % from, to], [y % from, to]
const MOVES = [
  [[1.0, 1.16], [0, 0], [0, 0]],        // push in
  [[1.16, 1.02], [0, 0], [0, 0]],       // pull out
  [[1.12, 1.12], [-3.5, 3.5], [0, 0]],  // pan right
  [[1.12, 1.12], [3.5, -3.5], [0, 0]],  // pan left
  [[1.04, 1.18], [0, 0], [2.5, -2.5]],  // push in, drift up
  [[1.18, 1.05], [-2, 2], [-2, 2]],     // pull out, diagonal
];
const EASE = Easing.bezier(0.45, 0, 0.55, 1);

function Photo({ clip, dur, index, width, height }) {
  const frame = useCurrentFrame();
  const [[s0, s1], [x0, x1], [y0, y1]] = MOVES[index % MOVES.length];
  const p = interpolate(frame, [0, Math.max(dur - 1, 1)], [0, 1], { easing: EASE, ...clamp });
  const ar = clip.width && clip.height ? clip.width / clip.height : null;
  const frameAr = width / height;
  // much wider (or taller) than the frame: show the whole photo over a blurred copy instead of cropping faces off
  const fit = ar && (ar > frameAr * 1.3 || ar < frameAr / 1.3);
  const k = fit ? 0.5 : 1;   // gentler move when the whole photo is on screen
  const at = (a, b) => (a + (b - a) * p) * k;
  const move = `translate(${at(x0, x1)}%, ${at(y0, y1)}%) scale(${1 + at(s0 - 1, s1 - 1)})`;
  if (!fit) return <Img src={clip.url} style={{ width: "100%", height: "100%", objectFit: "cover", transform: move }} />;
  return (
    <AbsoluteFill>
      <Img src={clip.url} style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scale(1.3)", filter: "blur(32px) brightness(.5) saturate(1.2)" }} />
      <AbsoluteFill style={{ transform: move }}>
        <Img src={clip.url} style={{ width: "100%", height: "100%", objectFit: "contain", filter: "drop-shadow(0 24px 48px rgba(0,0,0,.55))" }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function Clip({ clip, dur, index, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // punch-in at the cut, then a slow push
  const pop = spring({ frame, fps, config: { damping: 200, stiffness: 180 }, durationInFrames: 10 });
  const scale = interpolate(pop, [0, 1], [1.12, 1]) * interpolate(frame, [0, dur], [1, 1.07], { extrapolateRight: "clamp" });
  const fill = { width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})` };

  if (clip.type === "video" && clip.url) {
    const sceneSecs = dur / fps;
    const available = clip.duration ? Math.max(clip.duration - clip.trim, 0.5) : null;
    const rate = available && available < sceneSecs ? Math.max(0.5, available / sceneSecs) : 1;
    return <OffthreadVideo src={clip.url} muted trimBefore={Math.round(clip.trim * fps)} playbackRate={rate} style={fill} />;
  }
  if (clip.type === "image" && clip.url) return <Photo clip={clip} dur={dur} index={index} width={width} height={height} />;

  const [a, b] = CARD_GRADIENTS[index % CARD_GRADIENTS.length];
  const glow = interpolate(frame, [0, dur], [30, 70]);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at ${glow}% 35%, rgba(255,255,255,.18), rgba(255,255,255,0) 45%), linear-gradient(160deg, ${a}, ${b})`, transform: `scale(${scale})` }} />
  );
}

function Captions({ groups, cfg, rtl, font, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const group = groups.find((g, i) => t >= g.s && (t < (groups[i + 1]?.s ?? Infinity))) || null;
  if (!group) return null;
  const startF = Math.round(group.s * fps);
  const pop = spring({ frame: frame - startF, fps, config: { damping: 14, stiffness: 220 }, durationInFrames: 8 });
  const top = { top: "16%", center: "42%", bottom: "64%" }[cfg.position] || "64%";
  const look = cfg.style || "classic";
  const clean = look === "clean";
  const size = Math.round((cfg.size || 84) * (height / 1920) * (look === "classic" ? 1 : 0.86));
  const outline = { WebkitTextStroke: `${Math.max(2, Math.round(size / 14))}px #000`, paintOrder: "stroke fill", textShadow: "0 6px 18px rgba(0,0,0,.55)" };
  const words = (
    <>
      {group.words.map((w, i) => {
        const active = t >= w.s && t < (group.words[i + 1]?.s ?? group.e + 0.4);
        const base = { fontFamily: font, fontWeight: 800, fontSize: size, lineHeight: 1.15, display: "inline-block", textTransform: cfg.uppercase && !rtl && !clean ? "uppercase" : "none" };
        const looks = {
          classic: { ...outline, color: active ? cfg.highlight : cfg.color, transform: active ? "scale(1.08)" : "none" },
          box: { color: active ? cfg.highlight : cfg.color },
          pill: { ...(active ? { color: "#000", background: cfg.highlight } : { ...outline, color: cfg.color }), borderRadius: size * 0.22, padding: `0 ${Math.round(size * 0.16)}px` },
          clean: { color: active ? cfg.highlight : cfg.color, textShadow: "0 2px 4px rgba(0,0,0,.9), 0 4px 22px rgba(0,0,0,.85)" },
        };
        return <span key={i} style={{ ...base, ...(looks[look] || looks.classic) }}>{w.w}</span>;
      })}
    </>
  );
  const gap = `0 ${Math.round(size * (look === "pill" ? 0.12 : 0.28))}px`;
  return (
    <div style={{ position: "absolute", left: "6%", right: "6%", top, display: "flex", justifyContent: "center", direction: rtl ? "rtl" : "ltr", transform: `scale(${interpolate(pop, [0, 1], [0.82, 1])})` }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap,
        ...(look === "box" ? { background: "rgba(0,0,0,.82)", borderRadius: size * 0.3, padding: `${Math.round(size * 0.14)}px ${Math.round(size * 0.34)}px` } : {}) }}>
        {words}
      </div>
    </div>
  );
}

function Hook({ text, font, rtl, width }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inn = spring({ frame, fps, config: { damping: 12, stiffness: 160 }, durationInFrames: 12 });
  const out = interpolate(frame, [fps * 2.1, fps * 2.5], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const size = Math.round(width * 0.062);
  return (
    <div style={{ position: "absolute", top: "7%", left: "6%", right: "6%", display: "flex", justifyContent: "center", opacity: out,
      transform: `translateY(${interpolate(inn, [0, 1], [-40, 0])}px) scale(${interpolate(inn, [0, 1], [0.9, 1])})` }}>
      <div style={{ background: "#fff", color: "#111", fontFamily: font, fontWeight: 800, fontSize: size, lineHeight: 1.2, padding: `${size * 0.35}px ${size * 0.6}px`,
        borderRadius: size * 0.35, textAlign: "center", direction: rtl ? "rtl" : "ltr", boxShadow: "0 10px 40px rgba(0,0,0,.35)" }}>{text}</div>
    </div>
  );
}

// Title and card positions that stay clear of the captions (and of the hook during the first seconds).
function slots(captions, firstWithHook) {
  const pos = captions.enabled ? captions.position : "bottom";
  return {
    title: pos === "top" ? "30%" : firstWithHook ? "21%" : "13%",
    card: pos === "center" ? "62%" : pos === "top" ? "50%" : "40%",
  };
}

function SceneTitle({ text, font, rtl, width, top, color, dur }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inn = spring({ frame: frame - 2, fps, config: { damping: 13, stiffness: 170 }, durationInFrames: 14 });
  const out = interpolate(frame, [dur - 7, dur - 1], [1, 0], clamp);
  const size = Math.round(width * (text.length > 24 ? 0.062 : 0.08));
  return (
    <div style={{ position: "absolute", top, left: "6%", right: "6%", display: "flex", justifyContent: "center", opacity: out * Math.min(1, inn * 2) }}>
      <div style={{ fontFamily: font, fontWeight: 800, fontSize: size, lineHeight: 1.08, textAlign: "center", direction: rtl ? "rtl" : "ltr",
        textTransform: rtl ? "none" : "uppercase", color: inkOn(color), background: color, padding: `${size * 0.16}px ${size * 0.36}px`, borderRadius: size * 0.12,
        boxShadow: "0 14px 40px rgba(0,0,0,.45)",
        transform: `translateY(${interpolate(inn, [0, 1], [70, 0])}px) rotate(${interpolate(inn, [0, 1], [-6, -2])}deg) scale(${interpolate(inn, [0, 1], [0.7, 1])})` }}>
        {text}
      </div>
    </div>
  );
}

function NameCard({ card, font, rtl, width, top, accent }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inn = spring({ frame: frame - 6, fps, config: { damping: 15, stiffness: 140 }, durationInFrames: 18 });
  const count = interpolate(frame, [8, 8 + fps * 0.9], [0, 1], { easing: Easing.out(Easing.cubic), ...clamp });
  const [c1, c2] = [card.colors[0] || accent, card.colors[1] || card.colors[0] || "#111111"];
  // the number takes the brighter club colour so it stays readable on the dark panel
  const numColor = [c1, c2].sort((a, b) => luma(b) - luma(a)).find((c) => luma(c) > 70) || accent;
  const s = card.stat;
  const num = s.value === null ? null : (s.value * count).toLocaleString("en-US", { minimumFractionDigits: s.decimals, maximumFractionDigits: s.decimals, useGrouping: s.grouped });
  const nameSize = Math.round(width * 0.058);
  return (
    <div style={{ position: "absolute", top, [rtl ? "right" : "left"]: "6%", width: "76%", direction: rtl ? "rtl" : "ltr",
      transform: `translateX(${interpolate(inn, [0, 1], [rtl ? 120 : -120, 0])}%)`, opacity: Math.min(1, inn * 1.5) }}>
      <div style={{ display: "flex", background: "rgba(12,12,16,.86)", borderRadius: nameSize * 0.3, overflow: "hidden", boxShadow: "0 18px 50px rgba(0,0,0,.5)" }}>
        <div style={{ width: nameSize * 0.34, flex: "none", background: `linear-gradient(180deg, ${c1} 0 50%, ${c2} 50% 100%)` }} />
        <div style={{ padding: `${nameSize * 0.4}px ${nameSize * 0.5}px`, display: "flex", flexDirection: "column", gap: nameSize * 0.12, minWidth: 0 }}>
          <div style={{ fontFamily: font, fontWeight: 800, fontSize: nameSize, lineHeight: 1.1, color: "#fff", textTransform: rtl ? "none" : "uppercase" }}>{card.name}</div>
          {num !== null || s.label ? (
            <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: `0 ${nameSize * 0.3}px` }}>
              {num !== null ? <span style={{ fontFamily: font, fontWeight: 800, fontSize: Math.round(nameSize * 1.7), lineHeight: 1.05, color: numColor }}>{s.pre}{num}{s.suf}</span> : null}
              {s.label ? <span style={{ fontFamily: font, fontWeight: 800, fontSize: Math.round(nameSize * 0.62), color: "rgba(255,255,255,.78)", textTransform: rtl ? "none" : "uppercase" }}>{s.label}</span> : null}
            </div>
          ) : null}
        </div>
      </div>
      <div style={{ height: Math.round(nameSize * 0.12), marginTop: Math.round(nameSize * 0.14), width: `${count * 100}%`, borderRadius: 99, background: `linear-gradient(90deg, ${c1}, ${c2})` }} />
    </div>
  );
}

function Progress({ total, color }) {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", left: 0, bottom: 0, height: 12, width: `${(frame / Math.max(total - 1, 1)) * 100}%`, background: color, boxShadow: "0 0 12px rgba(0,0,0,.4)" }} />
  );
}

export function Main(props) {
  const { scenes, captions, hook, progress, sfx, music, cover, rtl, width, height, totalFrames } = props;
  const { fps } = useVideoConfig();
  useFonts(props.assetBase);
  const font = rtl ? `"${ARABIC}", "${LATIN}", sans-serif` : `"${LATIN}", "${ARABIC}", sans-serif`;
  const voiceEnd = scenes.length ? scenes[scenes.length - 1].from + scenes[scenes.length - 1].dur - Math.round(0.7 * fps) : 0;
  const musicVolume = (f) => {
    const base = Number(music.volume ?? 0.22);
    const duck = f < voiceEnd ? MUSIC_UNDER_VOICE : 1;
    const fadeIn = interpolate(f, [0, 8], [0, 1], { extrapolateRight: "clamp" });
    const fadeOut = interpolate(f, [totalFrames - 24, totalFrames - 1], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return base * duck * fadeIn * fadeOut;
  };
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {scenes.map((s, i) => {
        const at = slots(captions, i === 0 && hook.enabled && hook.text);
        return (
          <Sequence key={s.id} from={s.from} durationInFrames={s.dur} name={`Scene ${i + 1}`}>
            <AbsoluteFill style={{ overflow: "hidden" }}>
              <Clip clip={s.clip} dur={s.dur} index={i} width={width} height={height} />
              <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,.25) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 55%, rgba(0,0,0,.45) 100%)" }} />
            </AbsoluteFill>
            {s.title ? <SceneTitle text={s.title} font={font} rtl={rtl} width={width} top={at.title} color={captions.highlight} dur={s.dur} /> : null}
            {s.card ? <NameCard card={s.card} font={font} rtl={rtl} width={width} top={at.card} accent={captions.highlight} /> : null}
            {captions.enabled ? <Captions groups={s.groups} cfg={captions} rtl={rtl} font={font} height={height} /> : null}
            {s.voiceUrl ? <Html5Audio src={s.voiceUrl} /> : null}
          </Sequence>
        );
      })}
      {sfx.enabled && sfx.whoosh ? scenes.slice(1).map((s) => (
        <Sequence key={`w${s.id}`} from={Math.max(0, s.from - 4)} durationInFrames={Math.round(fps * 1.2)}>
          <Html5Audio src={src(sfx.whoosh)} volume={Number(sfx.volume ?? 0.5)} />
        </Sequence>
      )) : null}
      {sfx.enabled && sfx.hit && hook.enabled ? (
        <Sequence from={0} durationInFrames={Math.round(fps * 1.5)}><Html5Audio src={src(sfx.hit)} volume={Number(sfx.volume ?? 0.5)} /></Sequence>
      ) : null}
      {scenes.flatMap((s) => s.sounds.map((x, i) => (
        <Sequence key={`s${s.id}${i}`} from={s.from + x.start} durationInFrames={x.frames} name="Sound">
          <Html5Audio src={x.url} volume={(f) => x.volume * (x.fade ? interpolate(f, [x.frames - 8, x.frames - 1], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1)} />
        </Sequence>
      )))}
      {music.url ? <Html5Audio src={music.url} loop volume={musicVolume} trimBefore={Math.round(Number(music.start || 0) * fps)} /> : null}
      {hook.enabled && hook.text ? (
        <Sequence from={0} durationInFrames={Math.round(fps * 2.5)}><Hook text={hook.text} font={font} rtl={rtl} width={width} /></Sequence>
      ) : null}
      {progress.enabled ? <Progress total={totalFrames} color={progress.color} /> : null}
      {cover ? <Sequence from={0} durationInFrames={COVER_FRAMES} name="Cover"><Thumbnail {...cover} /></Sequence> : null}
    </AbsoluteFill>
  );
}
