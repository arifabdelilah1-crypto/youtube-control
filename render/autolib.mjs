// The choices "Generate video" makes, with no network: voice, clips, music track, sound effects, final checks.
import { VOICES } from "../web/voices.js";
import { MAX_SCENE_SOUNDS, SOUND_BASE } from "../video/layout.js";

const genderOf = (voice) => (/-Female$|^supertonic-F/.test(voice) ? "female" : /-Male$|^supertonic-M/.test(voice) ? "male" : "any");

/** What the person picked, else the network's voice unless the subject calls for the other gender, else the language's first voice of that gender. */
export function chooseVoice({ language, picked, networkVoice, gender = "any" }) {
  const list = (VOICES[language] || VOICES.en).map(([v]) => v);
  if (picked && list.includes(picked)) return picked;
  const usable = networkVoice && list.includes(networkVoice) ? networkVoice : null;
  if (usable && (gender === "any" || genderOf(usable) === gender)) return usable;
  const edge = list.filter((v) => !v.startsWith("supertonic-"));
  return edge.find((v) => gender !== "any" && genderOf(v) === gender) || usable || edge[0] || list[0];
}

const clipKey = (c) => `${c.source}-${c.id}`;
// green-screen clips are raw material: they look broken in a video
export const usable = (c) => !!(c?.url && c.source !== "youtube" && !/green.?screen|chroma.?key|\bchroma\b/i.test(c.tags || ""));

/** The clip each scene gets from the editor's picks: valid, and never the same one twice. Returns {i: candidate} for those decided. */
export function applyPicks(scenes, picks, chosen = {}) {
  const taken = new Set(Object.values(chosen).filter(Boolean).map(clipKey));
  const out = { ...chosen };
  for (const p of picks) {
    const scene = scenes[Number(p?.i)];
    if (!scene || out[p.i] || p.n === null || p.n === undefined) continue;
    const c = scene.candidates?.[Number(p.n)];
    if (!usable(c) || taken.has(clipKey(c))) continue;
    out[p.i] = c;
    taken.add(clipKey(c));
  }
  return out;
}

/** A track long enough if possible, that this network hasn't just used. */
export function pickTrack(tracks, { seconds = 0, usedIds = [], random = Math.random } = {}) {
  const fresh = tracks.filter((t) => !usedIds.includes(t.id));
  const pool = fresh.length ? fresh : tracks;
  const long = pool.filter((t) => t.duration >= seconds);
  const list = (long.length ? long : pool).slice(0, 8);
  return list.length ? list[Math.floor(random() * list.length)] : null;
}

/** A row of the team's music list, in the shape the render and the credits expect. */
export const libraryTrack = (x) => ({ id: x.track_id, source: "jamendo", title: x.title, author: x.author, url: x.url, duration: x.duration, license: x.license, license_url: x.license_url, page: x.page });

/** The sounds that are really in the library, on real scenes, within the limit. Returns {scene index: [sounds]}. */
export function placeSounds(picked, library, sceneSeconds, maxSounds) {
  const byId = new Map(library.map((x) => [x.id, x]));
  const out = {};
  let n = 0;
  for (const p of picked) {
    const sound = byId.get(p?.id);
    const i = Number(p?.i);
    if (!sound || !Number.isInteger(i) || i < 0 || i >= sceneSeconds.length || n >= maxSounds) continue;
    if ((out[i] || []).length >= MAX_SCENE_SOUNDS) continue;
    const at = Math.min(Math.max(0, Number(p.at) || 0), Math.max(0, sceneSeconds[i] - 0.5));
    (out[i] ||= []).push({ id: sound.id, title: sound.title, url: `${SOUND_BASE}${sound.id}.mp3`, duration: sound.duration, volume: 0.5, at: Math.round(at * 10) / 10, cut: true });
    n++;
  }
  return out;
}

const SIZES = { "9:16": [1080, 1920], "16:9": [1920, 1080], "1:1": [1080, 1080] };

/** The final checks, from what ffprobe and ffmpeg measured on the finished file. */
export function checkVideo({ aspect, expectedSeconds, width, height, duration, hasAudio, meanVolume, blackSeconds }) {
  const [w, h] = SIZES[aspect] || SIZES["9:16"];
  const rows = [
    { name: "Format", ok: width === w && height === h, detail: `${width}×${height}, expected ${w}×${h}` },
    { name: "Length", ok: Math.abs(duration - expectedSeconds) <= 2, detail: `${Math.round(duration)} s, expected ${Math.round(expectedSeconds)} s` },
    { name: "Sound", ok: !!hasAudio && meanVolume > -40, detail: hasAudio ? `average level ${Math.round(meanVolume)} dB` : "no sound in the file" },
    { name: "Picture", ok: blackSeconds <= 2, detail: blackSeconds > 0.05 ? `${blackSeconds.toFixed(1)} s of black screen` : "no black screen" },
  ];
  if (aspect === "9:16") rows.push({ name: "Short", ok: duration <= 180, detail: duration <= 180 ? "under 3 minutes" : "over 3 minutes: YouTube won't make it a Short" });
  return rows;
}

const words = (text) => String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);

// Arabic: Whisper often spells a word differently from the script (hamza and alef forms, ta marbuta, final ya, short vowels,
// the article). Both sides are brought to one spelling, and they're compared on letter trigrams, so a spelling difference
// costs a few trigrams instead of the whole word.
export function normalizeArabic(text) {
  return String(text || "")
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")   // short vowels, shadda, sukun, Quranic marks
    .replace(/\u0640/g, "")                                                   // tatweel
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")                     // آ أ إ ٱ → ا
    .replace(/\u0649/g, "\u064A")                                            // ى → ي
    .replace(/\u0629/g, "\u0647")                                            // ة → ه
    .replace(/\u0624/g, "\u0648").replace(/\u0626/g, "\u064A")             // ؤ → و, ئ → ي
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x660))     // Arabic-Indic digits
    .toLowerCase();
}
// "ال" (and و/ب/ف/ك/ل + "ال") is left out for matching: Whisper and the script don't always agree on it
const arWords = (text) => normalizeArabic(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  .map((w) => w.replace(/^[\u0648\u0628\u0641\u0643\u0644]?\u0627\u0644(?=.{2,})/u, "")).filter((w) => w.length > 1);
const trigrams = (w) => { const s = `_${w}_`, out = []; for (let i = 0; i + 3 <= s.length; i++) out.push(s.slice(i, i + 3)); return out; };

/** The share the voice check needs: Arabic transcripts drift more in spelling, so less is enough there. */
export const voiceThreshold = (language) => (/^ar/i.test(language || "") ? 0.45 : 0.6);

/** How much of the script can be heard: 0 to 1, from the transcript of the finished video. */
export function voiceCoverage(script, heard, language = "") {
  if (/^ar/i.test(language || "")) {
    const said = new Set(arWords(heard).flatMap(trigrams));
    const expected = arWords(script).flatMap(trigrams);
    return expected.length ? expected.filter((g) => said.has(g)).length / expected.length : 0;
  }
  const said = new Set(words(heard));
  const expected = words(script);
  return expected.length ? expected.filter((w) => said.has(w)).length / expected.length : 0;
}
