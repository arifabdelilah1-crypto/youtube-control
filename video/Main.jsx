// The video itself. Same component in the browser preview (Remotion Player) and the final render.
import React from "react";
import { AbsoluteFill, Html5Audio, Img, OffthreadVideo, Sequence, continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

// "static:sfx/x.mp3" = file shipped with the renderer bundle; anything else is a normal URL.
const src = (u) => (u && u.startsWith("static:") ? staticFile(u.slice(7)) : u);

// Self-hosted fonts (SIL Open Font License), same files for preview and render.
const LATIN = "YTC Montserrat";
const ARABIC = "YTC Noto Sans Arabic";
const FONT_FILES = [
  [LATIN, "fonts/montserrat-latin-800-normal.woff2", "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"],
  [LATIN, "fonts/montserrat-latin-ext-800-normal.woff2", "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF"],
  [ARABIC, "fonts/noto-sans-arabic-arabic-800-normal.woff2", "U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC,U+102E0-102FB,U+10E60-10E7E,U+10EC2-10EC4,U+10EFC-10EFF,U+1EE00-1EEF1"],
];
const fontsLoaded = new Map();
function useFonts(base) {
  const key = base || "static:";
  const [handle] = React.useState(() => (fontsLoaded.has(key) ? null : delayRender("Loading fonts")));
  React.useEffect(() => {
    if (handle === null) return;
    const p = fontsLoaded.get(key) || Promise.all(FONT_FILES.map(([family, file, range]) => {
      const url = key === "static:" ? staticFile(file) : new URL(file, key).href;
      return new FontFace(family, `url(${url}) format("woff2")`, { weight: "800", unicodeRange: range }).load().then((f) => document.fonts.add(f));
    })).catch((e) => console.warn("font load failed", e));
    fontsLoaded.set(key, p);
    p.finally(() => continueRender(handle));
  }, [handle, key]);
}

const CARD_GRADIENTS = [
  ["#0F2027", "#2C5364"], ["#232526", "#414345"], ["#1F1C2C", "#928DAB"], ["#141E30", "#243B55"], ["#3A1C71", "#D76D77"],
];

function Clip({ clip, dur, index }) {
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
  if (clip.type === "image" && clip.url) return <Img src={clip.url} style={fill} />;

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
  const size = Math.round((cfg.size || 84) * (height / 1920));
  return (
    <div style={{ position: "absolute", left: "6%", right: "6%", top, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: `0 ${Math.round(size * 0.28)}px`,
      direction: rtl ? "rtl" : "ltr", transform: `scale(${interpolate(pop, [0, 1], [0.82, 1])})` }}>
      {group.words.map((w, i) => {
        const active = t >= w.s && t < (group.words[i + 1]?.s ?? group.e + 0.4);
        return (
          <span key={i} style={{
            fontFamily: font, fontWeight: 800, fontSize: size, lineHeight: 1.15,
            color: active ? cfg.highlight : cfg.color,
            textTransform: cfg.uppercase && !rtl ? "uppercase" : "none",
            WebkitTextStroke: `${Math.max(2, Math.round(size / 14))}px #000`, paintOrder: "stroke fill",
            textShadow: "0 6px 18px rgba(0,0,0,.55)",
            transform: active ? "scale(1.08)" : "none", display: "inline-block",
          }}>{w.w}</span>
        );
      })}
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

function Progress({ total, color }) {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", left: 0, bottom: 0, height: 12, width: `${(frame / Math.max(total - 1, 1)) * 100}%`, background: color, boxShadow: "0 0 12px rgba(0,0,0,.4)" }} />
  );
}

export function Main(props) {
  const { scenes, captions, hook, progress, sfx, music, rtl, width, height, totalFrames } = props;
  const { fps } = useVideoConfig();
  useFonts(props.assetBase);
  const font = rtl ? `"${ARABIC}", "${LATIN}", sans-serif` : `"${LATIN}", "${ARABIC}", sans-serif`;
  const voiceEnd = scenes.length ? scenes[scenes.length - 1].from + scenes[scenes.length - 1].dur - Math.round(0.7 * fps) : 0;
  const musicVolume = (f) => {
    const base = Number(music.volume ?? 0.22);
    const duck = f < voiceEnd ? 0.55 : 1;
    const fadeIn = interpolate(f, [0, 8], [0, 1], { extrapolateRight: "clamp" });
    const fadeOut = interpolate(f, [totalFrames - 24, totalFrames - 1], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return base * duck * fadeIn * fadeOut;
  };
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {scenes.map((s, i) => (
        <Sequence key={s.id} from={s.from} durationInFrames={s.dur} name={`Scene ${i + 1}`}>
          <AbsoluteFill style={{ overflow: "hidden" }}>
            <Clip clip={s.clip} dur={s.dur} index={i} />
            <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,.25) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 55%, rgba(0,0,0,.45) 100%)" }} />
          </AbsoluteFill>
          {captions.enabled ? <Captions groups={s.groups} cfg={captions} rtl={rtl} font={font} height={height} /> : null}
          {s.voiceUrl ? <Html5Audio src={s.voiceUrl} /> : null}
        </Sequence>
      ))}
      {sfx.enabled && sfx.whoosh ? scenes.slice(1).map((s) => (
        <Sequence key={`w${s.id}`} from={Math.max(0, s.from - 4)} durationInFrames={Math.round(fps * 1.2)}>
          <Html5Audio src={src(sfx.whoosh)} volume={Number(sfx.volume ?? 0.5)} />
        </Sequence>
      )) : null}
      {sfx.enabled && sfx.hit && hook.enabled ? (
        <Sequence from={0} durationInFrames={Math.round(fps * 1.5)}><Html5Audio src={src(sfx.hit)} volume={Number(sfx.volume ?? 0.5)} /></Sequence>
      ) : null}
      {music.url ? <Html5Audio src={music.url} loop volume={musicVolume} trimBefore={Math.round(Number(music.start || 0) * fps)} /> : null}
      {hook.enabled && hook.text ? (
        <Sequence from={0} durationInFrames={Math.round(fps * 2.5)}><Hook text={hook.text} font={font} rtl={rtl} width={width} /></Sequence>
      ) : null}
      {progress.enabled ? <Progress total={totalFrames} color={progress.color} /> : null}
    </AbsoluteFill>
  );
}
