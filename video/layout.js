// Shared by the browser editor and the final renderer: turns a project + its scenes into
// the props of the <Main> composition (frame positions, captions groups, audio, style).

export const FPS = 30;
export const SIZES = { "9:16": [1080, 1920], "16:9": [1920, 1080], "1:1": [1080, 1080] };
export const SCENE_GAP = 0.12;   // seconds of breath between two voice lines
export const TAIL = 0.7;         // seconds after the last line
export const WORDS_PER_SECOND = 2.6;

export const MUSIC_UNDER_VOICE = 0.55;

export const THUMBNAIL_STYLES = {
  dark: { label: "Dark psycho", color: "#FFFFFF", accent: "#E10600" },
  horror: { label: "Horror", color: "#F2F2F2", accent: "#D00000" },
  love: { label: "Love", color: "#FFFFFF", accent: "#FF7AA8" },
  funny: { label: "Funny", color: "#FFE600", accent: "#FFFFFF" },
  clean: { label: "Clean", color: "#111111", accent: "#E10600" },
};

export const DEFAULT_SETTINGS = {
  captions: { enabled: true, style: "classic", position: "bottom", color: "#FFFFFF", highlight: "#FFE600", size: 84, uppercase: true, words: 3 },
  hook: { enabled: true, text: "" },
  titles: { enabled: true },
  progress: { enabled: true, color: "#FFE600" },
  sfx: { enabled: true, volume: 0.5 },
  music: { mood: "none", track_id: null, volume: 0.22, start: 0 },
};

export function mergeSettings(s = {}) {
  const d = DEFAULT_SETTINGS;
  return {
    captions: { ...d.captions, ...(s.captions || {}) },
    hook: { ...d.hook, ...(s.hook || {}) },
    titles: { ...d.titles, ...(s.titles || {}) },
    progress: { ...d.progress, ...(s.progress || {}) },
    sfx: { ...d.sfx, ...(s.sfx || {}) },
    music: { ...d.music, ...(s.music || {}) },
  };
}

/**
 * "€180M market value" -> {pre: "€", value: 180, decimals: 0, grouped: false, suf: "M", label: "market value"}.
 * value is null when the stat doesn't start with a number (then it is shown as plain text).
 */
export function parseStat(stat = "") {
  const m = String(stat).trim().match(/^([^\d\s]{0,2})\s?(\d[\d,.]*)([^\s\d]{0,3})\s*(.*)$/);
  if (!m) return { pre: "", value: null, decimals: 0, grouped: false, suf: "", label: String(stat).trim() };
  const [, pre, digits, suf, label] = m;
  const grouped = /^\d{1,3}(,\d{3})+$/.test(digits);   // "2,000"; "1,5" is a decimal comma
  const clean = grouped ? digits.replace(/,/g, "") : digits.replace(/,/g, ".");
  const decimals = clean.includes(".") ? clean.split(".").pop().length : 0;
  const value = Number(clean);
  return Number.isFinite(value) ? { pre, value, decimals, grouped, suf, label } : { pre: "", value: null, decimals: 0, grouped: false, suf: "", label: String(stat).trim() };
}

/**
 * Who a scene's footage credits: a Wikimedia photo or video (the licence requires it), a Pexels or Unsplash one (their
 * API terms ask for it), or an uploaded file that replaced a YouTube Creative Commons pick (the pick itself has no file
 * yet, so it isn't in the video and isn't credited).
 */
export function creditOf(c) {
  if (!c) return null;
  if (c.source === "wikimedia") return { tags: c.tags, author: c.author, license: c.license, page: c.page, via: "Wikimedia Commons" };
  if (c.source === "pexels") return { tags: c.tags, author: c.author, license: c.license, page: c.page, via: "Pexels" };
  if (c.source === "unsplash") return { tags: c.tags, author: c.author, license: c.license, page: c.page, via: "Unsplash" };
  return c.credit?.page ? c.credit : null;
}

/** The music found by search, if it's on and really from Jamendo (settings can be edited from the browser). */
export function foundMusic(music) {
  const t = music?.found;
  if (!t || music.mood === "none") return null;
  try {
    const u = new URL(t.url);
    return u.protocol === "https:" && u.hostname.endsWith(".jamendo.com") ? t : null;
  } catch { return null; }
}

export const SOUND_BASE = "https://control.homerecipe.casa/sfx-library/";
export const MAX_SCENE_SOUNDS = 4;

/** A scene's sound effects, only from our library on the VDS (scenes can be edited from the browser). */
export function sceneSounds(scene) {
  const list = Array.isArray(scene?.sounds) ? scene.sounds : [];
  return list.filter((x) => String(x?.url || "").startsWith(SOUND_BASE) && /^[\w-]+\.mp3$/.test(String(x.url).slice(SOUND_BASE.length))).slice(0, MAX_SCENE_SOUNDS);
}

/** Credit lines for footage and music that get one. Empty string when none. */
export function creditsText(scenes, music, thumbnail) {
  const seen = new Set();
  const lines = [];
  const track = foundMusic(music);
  if (track) lines.push(`- Music: "${track.title}" by ${track.author}, ${track.license}, via Jamendo: ${track.page}`);
  const pictured = thumbnail?.image && creditOf(thumbnail.image);
  if (pictured) {
    seen.add(pictured.page);
    lines.push(`- Thumbnail: "${pictured.tags || "Photo"}" by ${pictured.author || "unknown author"}, ${pictured.license || "see source"}, via ${pictured.via}: ${pictured.page}`);
  }
  for (const s of [...scenes].sort((a, b) => a.idx - b.idx)) {
    const c = creditOf(s.clip);
    if (!c || seen.has(c.page)) continue;
    seen.add(c.page);
    lines.push(`- "${c.tags || "Footage"}" by ${c.author || "unknown author"}, ${c.license || "see source"}, via ${c.via}: ${c.page}`);
  }
  return lines.length ? `Credits:\n${lines.join("\n")}` : "";
}

const THUMBNAIL_FIELDS = ["image", "text", "style", "color", "accent", "size", "position"];

/** Is there anything to make a thumbnail from? */
export const hasThumbnail = (t) => !!(t && (String(t.text || "").trim() || t.image?.url || t.image?.path));

const THUMBNAIL_SIZES = { "9:16": [1080, 1920], "16:9": [1280, 720], "1:1": [1080, 1080] };
export const thumbnailSize = (aspect) => THUMBNAIL_SIZES[aspect] || THUMBNAIL_SIZES["16:9"];

/** Changes whenever the picture would change: tells a saved thumbnail from an outdated one. 8 hex characters. */
export function thumbnailKey(t = {}, aspect = "16:9") {
  const image = t.image ? { url: t.image.url, path: t.image.path, trim: t.image.trim } : null;
  const text = JSON.stringify([aspect, ...THUMBNAIL_FIELDS.map((k) => (k === "image" ? image : t[k] ?? null))]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function thumbnailProps(t = {}, aspect = "16:9", assetBase = null) {
  const { image, text, style, color, accent, size, position } = t;
  return { image: image || null, text: text || "", style: style || "dark", color: color || null, accent: accent || null, size: Number(size) || 110, position: position || (aspect === "9:16" ? "center" : "bottom"), aspect, assetBase };
}

/** TikTok uses a video's first frame as its cover, and phones pick a cover from the frames: the thumbnail goes first, too short to notice. */
export const COVER_FRAMES = 3;
export const coverOn = (t) => hasThumbnail(t) && t.first_frame !== false;

/** Description with its "Credits:" block replaced (or added at the end, or removed when there are no credits). */
export function withCredits(description = "", credits = "") {
  const i = description.search(/(^|\n)Credits:\n/);
  const base = (i >= 0 ? description.slice(0, i) : description).replace(/\s+$/, "");
  if (!credits) return base;
  return base ? `${base}\n\n${credits}` : credits;
}

const RTL_LANGS = new Set(["ar", "he", "fa", "ur"]);

/** Seconds a scene lasts: its voice, or an estimate from the word count while the voice is missing. */
export function sceneSeconds(scene) {
  if (scene.voice_duration && scene.voice_text === scene.text) return Number(scene.voice_duration);
  const words = (scene.text || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1.2, words / WORDS_PER_SECOND);
}

/** Split words into caption groups of up to n words, never across a sentence end. */
export function captionGroups(words, n) {
  const groups = [];
  let cur = [];
  for (const w of words) {
    cur.push(w);
    if (cur.length >= n || /[.!?…،؟]$/.test(w.w)) { groups.push(cur); cur = []; }
  }
  if (cur.length) groups.push(cur);
  return groups.map((g) => ({ s: g[0].s, e: g[g.length - 1].e, words: g }));
}

/** Evenly timed words when real timings are not available yet. */
function estimatedWords(text, seconds) {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  const step = seconds / Math.max(parts.length, 1);
  return parts.map((w, i) => ({ w, s: i * step, e: (i + 1) * step }));
}

/**
 * @param project  video_projects row
 * @param scenes   project_scenes rows (any order)
 * @param urls     { voice: {scene_id: url}, music: url|null, sfx: {whoosh, hit}, media: {path: url} }
 */
export function buildProps(project, scenes, urls = {}) {
  const settings = mergeSettings(project.settings);
  const [width, height] = SIZES[project.aspect] || SIZES["9:16"];
  const ordered = [...scenes].sort((a, b) => a.idx - b.idx);
  let from = 0;
  const out = ordered.map((s, i) => {
    const voiceOk = !!(s.voice_path && s.voice_text === s.text && urls.voice?.[s.id]);
    const secs = sceneSeconds(s) + SCENE_GAP + (i === ordered.length - 1 ? TAIL : 0);
    const dur = Math.max(1, Math.round(secs * FPS));
    const words = voiceOk && Array.isArray(s.words) && s.words.length ? s.words : estimatedWords(s.text, sceneSeconds(s));
    const clip = s.clip || { type: "card" };
    const card = s.card?.name ? { name: s.card.name, stat: parseStat(s.card.stat), colors: (s.card.colors || []).filter(Boolean).slice(0, 2) } : null;
    const scene = {
      id: s.id, from, dur, text: s.text,
      title: settings.titles.enabled && s.title ? s.title : null,
      card,
      voiceUrl: voiceOk ? urls.voice[s.id] : null,
      sounds: sceneSounds(s).map((x) => {
        const start = Math.min(Math.max(0, Math.round(Number(x.at || 0) * FPS)), dur - 1);
        const whole = Math.max(1, Math.ceil(Number(x.duration || 1) * FPS));
        return { url: x.url, volume: Math.min(Math.max(0, Number(x.volume ?? 0.6)), 1), start, frames: x.cut === false ? whole : Math.min(whole, dur - start), fade: x.cut !== false && whole > dur - start };
      }),
      groups: captionGroups(words, settings.captions.words || 3),
      clip: {
        type: clip.type || "card",
        url: clip.path ? urls.media?.[clip.path] || null : clip.url || null,
        trim: Number(clip.trim || 0),
        duration: clip.duration ? Number(clip.duration) : null,
        width: Number(clip.width) || null,
        height: Number(clip.height) || null,
      },
    };
    from += dur;
    return scene;
  });
  return {
    width, height, fps: FPS, totalFrames: Math.max(from, FPS),
    rtl: RTL_LANGS.has(project.language),
    language: project.language,
    title: project.title || "",
    scenes: out,
    captions: settings.captions,
    hook: { ...settings.hook, text: settings.hook.text || project.title || "" },
    progress: settings.progress,
    sfx: { ...settings.sfx, whoosh: urls.sfx?.whoosh || null, hit: urls.sfx?.hit || null },
    music: { ...settings.music, url: urls.music || null },
    cover: coverOn(project.settings?.thumbnail) ? thumbnailProps({ ...project.settings.thumbnail, image: urls.coverImage ? { ...project.settings.thumbnail.image, url: urls.coverImage } : project.settings.thumbnail.image }, project.aspect, urls.assetBase || null) : null,
    assetBase: urls.assetBase || null,   // where fonts/ and sfx/ live; null = shipped with the renderer
  };
}

/** Problems to fix (block) or know about (warn) before the final render. */
export function preRenderCheck(project, scenes) {
  const issues = [];
  const ordered = [...scenes].sort((a, b) => a.idx - b.idx);
  if (!ordered.length) issues.push({ level: "block", text: "No scenes yet." });
  const noVoice = ordered.filter((s) => !s.voice_path).length;
  const outdated = ordered.filter((s) => s.voice_path && s.voice_text !== s.text).length;
  if (noVoice) issues.push({ level: "block", text: `${noVoice} scene(s) have no voice yet. Press “Update voice”.` });
  if (outdated) issues.push({ level: "block", text: `${outdated} scene(s) were edited after their voice was made. Press “Update voice”.` });
  const cards = ordered.filter((s) => !s.clip || s.clip.type === "card").length;
  if (cards) issues.push({ level: "warn", text: `${cards} scene(s) have no clip and will show a text card.` });
  const credited = ordered.filter((s) => creditOf(s.clip)).length;
  if (credited) issues.push({ level: "warn", text: `${credited} scene(s) use footage that gets a credit. The credit lines below go in the video description.` });
  if (foundMusic(project.settings?.music)) issues.push({ level: "warn", text: "The music gets a credit too. On a monetized channel, YouTube can still claim a track if its artist registered it." });
  const noFile = ordered.filter((s) => s.clip?.source === "youtube").length;
  if (noFile) issues.push({ level: "warn", text: `${noFile} scene(s) have a YouTube clip picked but no file uploaded. They show a text card until you upload the clip.` });
  if (project.aspect === "16:9") issues.push({ level: "warn", text: "This video is 16:9, so YouTube publishes it as a normal video, not a Short. For a Short, choose 9:16 on its Studio page." });
  const total = ordered.reduce((t, s) => t + sceneSeconds(s) + SCENE_GAP, 0) + TAIL;
  if (project.aspect === "9:16" && total > 180) issues.push({ level: "block", text: `Video is ${Math.round(total)} s. Shorts can be 3 minutes at most.` });
  else if (project.aspect === "9:16" && total > 60) issues.push({ level: "warn", text: `Video is ${Math.round(total)} s. Allowed, but Shorts under 60 s usually keep viewers better.` });
  if (!project.title || project.title === "Untitled video") issues.push({ level: "warn", text: "No title yet." });
  return issues;
}
