// Shared by the browser editor and the final renderer: turns a project + its scenes into
// the props of the <Main> composition (frame positions, captions groups, audio, style).

export const FPS = 30;
export const SIZES = { "9:16": [1080, 1920], "16:9": [1920, 1080], "1:1": [1080, 1080] };
export const SCENE_GAP = 0.12;   // seconds of breath between two voice lines
export const TAIL = 0.7;         // seconds after the last line
export const WORDS_PER_SECOND = 2.6;

export const DEFAULT_SETTINGS = {
  captions: { enabled: true, position: "bottom", color: "#FFFFFF", highlight: "#FFE600", size: 84, uppercase: true, words: 3 },
  hook: { enabled: true, text: "" },
  progress: { enabled: true, color: "#FFE600" },
  sfx: { enabled: true, volume: 0.5 },
  music: { mood: "none", track_id: null, volume: 0.22, start: 0 },
};

export function mergeSettings(s = {}) {
  const d = DEFAULT_SETTINGS;
  return {
    captions: { ...d.captions, ...(s.captions || {}) },
    hook: { ...d.hook, ...(s.hook || {}) },
    progress: { ...d.progress, ...(s.progress || {}) },
    sfx: { ...d.sfx, ...(s.sfx || {}) },
    music: { ...d.music, ...(s.music || {}) },
  };
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
    const scene = {
      id: s.id, from, dur, text: s.text,
      voiceUrl: voiceOk ? urls.voice[s.id] : null,
      groups: captionGroups(words, settings.captions.words || 3),
      clip: {
        type: clip.type || "card",
        url: clip.path ? urls.media?.[clip.path] || null : clip.url || null,
        trim: Number(clip.trim || 0),
        duration: clip.duration ? Number(clip.duration) : null,
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
  const total = ordered.reduce((t, s) => t + sceneSeconds(s) + SCENE_GAP, 0) + TAIL;
  if (project.aspect === "9:16" && total > 180) issues.push({ level: "block", text: `Video is ${Math.round(total)} s. Shorts can be 3 minutes at most.` });
  else if (project.aspect === "9:16" && total > 60) issues.push({ level: "warn", text: `Video is ${Math.round(total)} s. Allowed, but Shorts under 60 s usually keep viewers better.` });
  if (!project.title || project.title === "Untitled video") issues.push({ level: "warn", text: "No title yet." });
  return issues;
}
