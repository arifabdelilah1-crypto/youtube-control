// "Generate video": one idea, by itself, through script, review, scenes, clips, voice, music, sounds, thumbnail, render and final checks.
//   node render/autovideo.mjs <video_runs id>      runs in the "Generate video" workflow
//   node render/autovideo.mjs --stopped <id>       says so when the machine stopped the run
// Whatever needs a key (DeepSeek, stock sites, YouTube) stays in the Supabase functions: this job only orders the steps and checks the results.
// Each step reports on video_runs, and the video never goes out unless all the checks pass and that was the choice.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { creditsText, foundMusic, hasThumbnail, preRenderCheck, sceneSeconds, withCredits } from "../video/layout.js";
import { PRESETS, presetFx } from "../web/voicefx.js";
import { applyPicks, checkVideo, chooseVoice, libraryTrack, pickTrack, placeSounds, usable, voiceCoverage } from "./autolib.mjs";
import { downloadFromVds, isVds, mediaReady, vdsPath } from "./media.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const URL_ = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const FN = { ai: process.env.AI_FUNCTION || "ai", studio: process.env.STUDIO_FUNCTION || "studio", publish: "publish", explainer: "explainer" };
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const STEPS = ["script", "review", "scenes", "clips", "voice", "music", "sounds", "thumbnail", "render", "check"];

async function rest(method, table, query = "", body) {
  const r = await fetch(`${URL_}/rest/v1/${table}${query}`, {
    method, headers: { ...H, "Content-Type": "application/json", Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${table} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.status === 204 ? null : r.json();
}
const one = async (table, id) => (await rest("GET", table, `?id=eq.${id}&select=*`))[0];

let secret = null;
async function call(fn, body, seconds = 170) {
  if (!secret) {
    const r = await fetch(`${URL_}/rest/v1/rpc/get_cron_secret`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: "{}" });
    if (!r.ok) throw new Error(`get_cron_secret ${r.status}`);
    secret = await r.json();
  }
  const r = await fetch(`${URL_}/functions/v1/${FN[fn]}`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": secret }, body: JSON.stringify(body), signal: AbortSignal.timeout(seconds * 1000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `${FN[fn]} ${r.status}`);
  return data;
}

// ---------- reporting ----------
let run;
class Stopped extends Error {}
const warnings = [];
async function report(values) {
  run = { ...run, ...values };
  await rest("PATCH", "video_runs", `?id=eq.${run.id}`, values);
}
async function step(key, work) {
  const fresh = await one("video_runs", run.id);
  if (fresh?.status === "cancelled") throw new Stopped();
  const set = (status, detail = "") => report({ steps: run.steps.map((s) => (s.key === key ? { ...s, status, detail: String(detail || s.detail || "").slice(0, 300) } : s)) });
  log(`-- ${key}`);
  await set("running");
  try {
    const detail = await work((text) => set("running", text));
    await set("done", detail);
  } catch (e) {
    if (!(e instanceof Stopped)) await set("failed", e.message);
    throw e;
  }
}
const warn = async (text) => { log(`warning: ${text}`); warnings.push(text); await report({ warnings }); };

// ---------- the steps ----------
async function writeScript(idea, channel, options) {
  const channel_id = channel.id;
  const isOutlier = (idea.sources || []).some((s) => s.type === "outlier");
  if (isOutlier && !idea.source_video) await call("ai", { action: "capture", idea_id: idea.id });
  if (isOutlier && !idea.blueprint) await call("ai", { action: "blueprint", idea_id: idea.id });
  const body = { action: "script", idea_id: idea.id, channel_id, language: options.language, angle: options.angle, aspect: options.aspect, length: options.length };
  // less and less thinking if the model is too slow for one call
  for (const extra of [{}, { effort: "low" }, { fast: true }]) {
    try {
      await call("ai", { ...body, ...extra });
      if (extra.fast) await warn("The thinking model was too slow, so the everyday model wrote this script.");
      return extra.fast ? "Written by the everyday model" : `Written with ${extra.effort === "low" ? "less" : "full"} thinking`;
    } catch (e) {
      log(`script ${JSON.stringify(extra)} failed: ${e.message}`);
      if (extra.fast) throw e;
    }
  }
  return "";
}

/** Explainer style: Claude writes the voice-over and the drawing of each scene in one go (supabase/functions/explainer). */
const MODEL_LABELS = { "claude-opus-5-5": "Claude Opus 5.5", "claude-fable-5-2": "Claude Fable 5.2", "claude-sonnet-5-5": "Claude Sonnet 5.5" };
async function planExplainer(idea, channel, options, note) {
  const model = MODEL_LABELS[options.ai_model] ? options.ai_model : "claude-opus-5-5";
  const body = { action: "plan", idea_id: idea.id, channel_id: channel.id, language: options.language, angle: options.angle, length: options.length, model, look: options.look || "glow",
    aspect: options.aspect === "16:9" ? "16:9" : "9:16" };
  // a function gets about 150 s: less thinking, then the faster model, if the first answer takes too long
  const tries = [{}, { effort: "low" }, ...(model === "claude-sonnet-5-5" ? [] : [{ model: "claude-sonnet-5-5", effort: "low" }])];
  let lastError = "";
  for (const extra of tries) {
    try {
      if (extra.model || extra.effort) await note(`Trying again with ${extra.model ? MODEL_LABELS[extra.model] : "less thinking"}`);
      const out = await call("explainer", { ...body, ...extra }, 160);
      if (extra.model) await warn(`${MODEL_LABELS[model]} was too slow, so ${MODEL_LABELS[extra.model]} planned this video.`);
      return `${out.scenes} scenes by ${MODEL_LABELS[out.model] || out.model}, $${Number(out.cost_usd || 0).toFixed(3)}`;
    } catch (e) {
      lastError = e.message;
      log(`explainer ${JSON.stringify(extra)} failed: ${e.message}`);
      if (/not allowed|limit reached|not set up|required|not found|Pick a network/i.test(e.message)) break;  // trying again would not help
    }
  }
  throw new Error(lastError || "The explainer plan failed");
}

async function reviewScript(ideaId) {
  for (const extra of [{}, { fast: true }]) {
    const out = await call("ai", { action: "review", idea_id: ideaId, ...extra }).catch((e) => ({ ok: false, error: e.message }));
    if (out.ok) {
      const n = out.ai?.review?.problems?.length ?? 0;
      return n ? `${n} problem${n === 1 ? "" : "s"} fixed` : "Nothing to fix";
    }
    log(`review ${JSON.stringify(extra)} failed: ${out.error}`);
  }
  await warn("The script couldn't be reviewed, so it's the first draft. Read it before publishing.");
  return "First draft kept";
}

async function buildScenes(idea, channel, options, project) {
  const style = channel.video_style || {};
  const ai = idea.ai || {};
  const drawn = options.video_style === "explainer";
  const brief = ai.brief || {};
  const language = options.language || ai.language || style.language || channel.language || "en";
  const voiceStyle = options.voice_style || brief.voice_style || "natural";
  const voice = chooseVoice({ language, picked: options.voice, networkVoice: project?.voice || style.voice, gender: brief.voice_gender });
  const rate = voiceStyle === "natural" ? Number(style.voice_rate) || 1.1 : PRESETS[voiceStyle].rate;
  const base = JSON.parse(JSON.stringify(project?.settings || style.editor || {}));
  const settings = { ...base,
    hook: { enabled: true, ...(base.hook || {}), text: ai.hook_text || base.hook?.text || "" },
    voice_fx: presetFx(voiceStyle),
    // the voice carries these videos: no whoosh on the cuts, no hit on the hook
    sfx: { ...(base.sfx || {}), enabled: false },
    // nothing goes out by itself before the final checks
    publish: { ...(base.publish || {}), mode: "ask" },
    // the Explainer style draws its scenes (video/Explainer.jsx): the plan without the narration, which is the script
    ...(drawn ? { style: "explainer", explainer: { scenes: (ai.explainer?.scenes || []).map(({ narration: _n, ...rest }) => rest), model: ai.explainer?.model || null, look: options.look || "glow" },
      hook: { ...(base.hook || {}), enabled: false } } : { style: "classic" }),
  };
  const out = await call("studio", {
    action: "build", project_id: project?.id || null, idea_id: idea.id, channel_id: channel.id, title: idea.video_title || idea.title, script: idea.script,
    language, voice, voice_rate: rate, aspect: drawn ? (options.aspect === "16:9" ? "16:9" : "9:16") : options.aspect || ai.aspect || style.aspect || "9:16", settings, default_terms: drawn ? [] : idea.search_terms || [],
  });
  if (!out.project_id) throw new Error(out.error || "The scenes couldn't be built");
  if (out.status === "failed") throw new Error(out.error || "The voice job couldn't start");
  await report({ project_id: out.project_id });
  return out.project_id;
}

const sceneRows = (projectId) => rest("GET", "project_scenes", `?project_id=eq.${projectId}&select=*&order=idx`);
const clipLine = (c, n) => ({ n, type: c.type, seconds: c.duration ?? null, tags: String(c.tags || "").slice(0, 160) });

/** An editor chooses from the tags, searches again where nothing fits, then looks at the pictures. */
async function chooseClips(projectId, subject, aspect, note) {
  const scenes = (await sceneRows(projectId)).map((s) => ({ ...s, candidates: (s.candidates || []).filter(usable) }));
  const ask = async (list) => (await call("ai", { action: "pick_clips", idea_id: run.idea_id, subject,
    scenes: list.map(({ i, s }) => ({ i, says: s.text, seconds: Math.round(sceneSeconds(s)), clips: s.candidates.map(clipLine) })) })).picks || [];
  const indexed = scenes.map((s, i) => ({ i, s }));
  let chosen = {};
  const batches = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, k) => list.slice(k * n, k * n + n));
  const picksFor = async (list) => {
    const missing = [];
    for (const part of batches(list, 12)) {
      const picks = await ask(part);
      chosen = applyPicks(scenes, picks, chosen);
      for (const p of picks) if (!chosen[p.i] && p.search) missing.push(p);
    }
    return missing;
  };
  await note("Reading the clips found");
  const missing = await picksFor(indexed);
  // search again where nothing fit
  if (missing.length) {
    await note(`Searching again for ${missing.length} scene${missing.length === 1 ? "" : "s"}`);
    for (const p of missing.slice(0, 20)) {
      const out = await call("studio", { action: "search", q: String(p.search).slice(0, 80), kind: p.kind === "image" ? "image" : "video", aspect }).catch(() => ({ results: [] }));
      const known = new Set(scenes[p.i].candidates.map((c) => `${c.source}-${c.id}`));
      scenes[p.i].candidates.push(...(out.results || []).filter(usable).filter((c) => !known.has(`${c.source}-${c.id}`)).slice(0, 8));
    }
    await picksFor(indexed.filter(({ i }) => !chosen[i]));
  }
  // look at the pictures: a rejected clip gets one more chance from what's left
  await note("Looking at the pictures");
  for (let round = 0; round < 2; round++) {
    const toSee = indexed.filter(({ i }) => chosen[i]?.thumb || chosen[i]?.preview).filter(({ i }) => !chosen[i].seen);
    const rejected = [];
    let looked = false;
    for (const part of batches(toSee, 10)) {
      const out = await call("ai", { action: "check_clips", idea_id: run.idea_id, subject, items: part.map(({ i, s }) => ({ i, text: s.text, url: chosen[i].type === "image" ? chosen[i].preview || chosen[i].thumb : chosen[i].thumb })) }).catch((e) => ({ error: e.message }));
      if (out.error) { log(`picture check failed: ${out.error}`); continue; }
      looked ||= out.seen > 0;
      for (const c of out.checks || []) if (c?.fits === false && chosen[c.i]) rejected.push(c);
      for (const { i } of part) if (chosen[i]) chosen[i] = { ...chosen[i], seen: true };
    }
    if (!looked && round === 0 && toSee.length) await warn("The pictures couldn't be checked by eye this time, only from their descriptions.");
    if (!rejected.length) break;
    for (const c of rejected) {
      const bad = chosen[c.i];
      log(`scene ${c.i}: rejected ${bad.source}-${bad.id} (${c.why})`);
      scenes[c.i].candidates = scenes[c.i].candidates.filter((x) => !(x.id === bad.id && x.source === bad.source));
      delete chosen[c.i];
    }
    await picksFor(indexed.filter(({ i }) => rejected.some((c) => Number(c.i) === i)));
  }
  // what's left: the first clip no other scene uses, said out loud
  const taken = new Set(Object.values(chosen).filter(Boolean).map((c) => `${c.source}-${c.id}`));
  const weak = [];
  for (const { i, s } of indexed) {
    if (chosen[i]) continue;
    const fallback = s.candidates.find((c) => !taken.has(`${c.source}-${c.id}`));
    weak.push(i + 1);
    if (fallback) { chosen[i] = fallback; taken.add(`${fallback.source}-${fallback.id}`); }
  }
  for (const { i, s } of indexed) {
    const { seen: _seen, ...pick } = chosen[i] || {};
    await rest("PATCH", "project_scenes", `?id=eq.${s.id}`, { clip: chosen[i] ? { ...pick, trim: 0 } : { type: "card" }, candidates: s.candidates.slice(0, 16) });
  }
  if (weak.length) await warn(`Scene${weak.length === 1 ? "" : "s"} ${weak.join(", ")}: no clip really fits. Choose another one.`);
  return weak.length ? `${scenes.length - weak.length} of ${scenes.length} fit` : `All ${scenes.length} scenes fit`;
}

async function waitForVoice(projectId) {
  const deadline = Date.now() + 25 * 60e3;
  let retried = false;
  while (Date.now() < deadline) {
    const project = await one("video_projects", projectId);
    if (project.status === "ready") return "Voice ready";
    if (project.status === "failed") {
      if (retried) throw new Error(`The voice failed: ${project.error || "unknown error"}`);
      retried = true;
      log(`voice failed, once more: ${project.error}`);
      await call("studio", { action: "voice", project_id: projectId });
    }
    await sleep(10000);
  }
  throw new Error("The voice took more than 25 minutes.");
}

async function saveSettings(projectId, change) {
  const project = await one("video_projects", projectId);
  await rest("PATCH", "video_projects", `?id=eq.${projectId}`, { settings: { ...project.settings, ...change } });
}

async function findMusic(projectId, brief, channelId, seconds) {
  const mood = brief.music_mood;
  if (mood === "none") return "This video goes without music";
  const words = (brief.music_words || [])[0];
  const others = await rest("GET", "video_projects", `?channel_id=eq.${channelId}&id=neq.${projectId}&select=settings&order=created_at.desc&limit=30`);
  const usedIds = others.map((p) => p.settings?.music?.found?.id).filter(Boolean);
  // the team's list comes first: its kept tracks for this mood, and its banned ones never come back
  const library = await rest("GET", "music_library", "?select=*").catch((e) => { log(`music list: ${e.message}`); return []; });
  const banned = new Set(library.filter((x) => x.status === "banned").map((x) => x.track_id));
  const kept = library.filter((x) => x.status === "saved" && x.mood === mood && !usedIds.includes(x.track_id)).map(libraryTrack);
  const mine = pickTrack(kept, { seconds, usedIds });
  if (mine) {
    await saveSettings(projectId, { music: { mood: "found", track_id: null, found: mine, volume: 0.22, start: 0 } });
    return `“${mine.title}”, from your music list`;
  }
  const searches = [mood ? { mood } : null, words ? { q: words } : null, { mood: "calm" }].filter(Boolean);
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const search of searches) {
      const out = await call("studio", { action: "music_search", ...search, page: attempt + 1 }, 60).catch((e) => ({ error: e.message, results: [] }));
      const track = pickTrack((out.results || []).filter((t) => !banned.has(t.id)), { seconds, usedIds });
      if (track) {
        await saveSettings(projectId, { music: { mood: "found", track_id: null, found: track, volume: 0.22, start: 0 } });
        return `“${track.title}”, ${search.mood || search.q}`;
      }
      log(`music ${JSON.stringify(search)}: ${out.error || "no results"}`);
    }
    await sleep(20000);
  }
  await warn("No music found: the music search isn't responding. Add a track in the Music tab, then render again.");
  return "None found";
}

async function addSounds(projectId, brief, seconds) {
  const library = JSON.parse(fs.readFileSync(path.join(ROOT, "web/sfx-library.json"), "utf8")).sounds;
  const scenes = await sceneRows(projectId);
  const max = Math.max(1, Math.floor(scenes.length / 3));
  const out = await call("ai", { action: "pick_sounds", idea_id: run.idea_id, subject: brief.subject || "", max_sounds: max,
    scenes: scenes.map((s, i) => ({ i, says: s.text, seconds: Math.round(sceneSeconds(s)) })),
    library: library.map((x) => ({ id: x.id, name: x.title, type: x.category, seconds: x.duration })) });
  if (out.error) { await warn("The sound effects couldn't be chosen, so this video has only its usual cuts."); return "Skipped"; }
  const placed = placeSounds(out.sounds || [], library, scenes.map((s) => sceneSeconds(s)), max);
  for (const [i, sounds] of Object.entries(placed)) await rest("PATCH", "project_scenes", `?id=eq.${scenes[i].id}`, { sounds });
  void seconds;
  const n = Object.values(placed).flat().length;
  return n ? `${n} sound${n === 1 ? "" : "s"} added` : "None needed";
}

async function makeThumbnailChoice(projectId, idea, brief, aspect) {
  const project = await one("video_projects", projectId);
  if (hasThumbnail(project.settings?.thumbnail)) return "Keeping the one already there";
  const scenes = await sceneRows(projectId);
  const out = await call("ai", { action: "thumbnail_text", idea_id: idea.id, language: project.language, title: idea.video_title || idea.title }).catch(() => ({}));
  const text = out.options?.[0] || idea.ai?.hook_text || idea.video_title || idea.title;
  let image = scenes.map((s) => s.clip).find((c) => c?.type === "image" && c.url);
  if (!image) {
    const found = await call("studio", { action: "search", q: (idea.search_terms || [])[0] || brief.subject || idea.title, kind: "image", aspect }).catch(() => ({ results: [] }));
    image = (found.results || []).find(usable);
  }
  const pick = image ? { type: image.type, source: image.source, id: image.id, url: image.url, preview: image.preview, thumb: image.thumb, trim: 0, tags: image.tags, author: image.author, license: image.license, page: image.page, download_location: image.download_location } : null;
  await saveSettings(projectId, { thumbnail: { text: String(text).slice(0, 60), style: brief.thumbnail_style || "dark", image: pick } });
  return `“${String(text).slice(0, 40)}”`;
}

async function renderVideo(projectId, ideaId) {
  const project = await one("video_projects", projectId);
  const scenes = await sceneRows(projectId);
  const blocks = preRenderCheck(project, scenes).filter((x) => x.level === "block");
  if (blocks.length) throw new Error(blocks.map((b) => b.text).join(" "));
  // the licences need these lines in the description
  const idea = await one("ideas", ideaId);
  await rest("PATCH", "ideas", `?id=eq.${ideaId}`, { video_description: withCredits(idea.video_description || "", creditsText(scenes, project.settings?.music, project.settings?.thumbnail)) });
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = await call("studio", { action: "render", project_id: projectId });
    if (!started.job_id || started.status === "failed") throw new Error(started.error || "The render couldn't start");
    await report({ render_job_id: started.job_id });
    const deadline = Date.now() + 50 * 60e3;
    while (Date.now() < deadline) {
      await sleep(15000);
      const job = await one("render_jobs", started.job_id);
      if (job.status === "done") return job;
      if (job.status === "failed") { lastError = job.error || "unknown error"; log(`render failed: ${lastError}`); break; }
    }
    lastError ||= "The render took more than 50 minutes.";
  }
  throw new Error(`The render failed: ${String(lastError).slice(0, 400)}`);
}

/** Measures the finished file. Reports what it finds; a failed check keeps the video from going out. */
async function finalChecks(job, project) {
  const drawn = project.settings?.style === "explainer";
  if (!isVds(job.output_path) || !mediaReady()) return [{ name: "File", ok: false, detail: "The video isn't on the VDS, so it couldn't be measured." }];
  const file = path.join(os.tmpdir(), `${job.id}.mp4`);
  await downloadFromVds(vdsPath(job.output_path), file);
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", file], { encoding: "utf8" }));
  const video = probe.streams.find((s) => s.codec_type === "video") || {};
  const hasAudio = probe.streams.some((s) => s.codec_type === "audio");
  const volume = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "volumedetect", "-vn", "-f", "null", "-"], { encoding: "utf8" }).stderr || "";
  const black = drawn ? "" : spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vf", "blackdetect=d=0.5:pix_th=0.05", "-an", "-f", "null", "-"], { encoding: "utf8" }).stderr || "";
  // (the Explainer style draws white lines on black: the black-screen check would flag every frame)
  const blackSeconds = [...black.matchAll(/black_duration:([\d.]+)/g)].reduce((t, m) => t + Number(m[1]), 0);
  // is the narrator really heard over the music? What a listener would catch, against the script
  const scenes = await sceneRows(project.id);
  const listen = spawnSync("python", [path.join(ROOT, "render/voice_check.py"), file, project.language], { encoding: "utf8", timeout: 15 * 60e3 });
  const voice = listen.status === 0
    ? (() => { const share = voiceCoverage(scenes.map((s) => s.text).join(" "), listen.stdout); log(`Heard: ${listen.stdout.slice(0, 300)}`); return { name: "Voice", ok: share >= 0.6, detail: `${Math.round(share * 100)}% of the script is heard` }; })()
    : { name: "Voice", ok: false, detail: "The voice couldn't be checked by listening. Listen to the video." };
  if (listen.status !== 0) log(`voice check: ${String(listen.stderr).slice(-400)}`);
  fs.rmSync(file, { force: true });
  return [voice, ...checkVideo({ aspect: project.aspect, expectedSeconds: Number(job.duration_s) || 0, width: video.width, height: video.height, duration: Number(probe.format?.duration) || 0, hasAudio,
    meanVolume: Number(volume.match(/mean_volume: (-?[\d.]+)/)?.[1] ?? -91), blackSeconds })];
}

// ---------- the run ----------
async function main(id) {
  run = await one("video_runs", id);
  if (!run) throw new Error("run not found");
  if (run.status === "cancelled") return;
  const options = run.options || {};
  await report({ status: "running", run_url: process.env.RUN_URL || null, steps: STEPS.map((key) => ({ key, status: "waiting", detail: "" })), warnings: [], checks: [], error: null });
  const channel = await one("channels", run.channel_id);
  if (!channel) throw new Error("The network no longer exists.");
  const skip = async (key, why) => { await report({ steps: run.steps.map((s) => (s.key === key ? { ...s, status: "skipped", detail: why } : s)) }); };

  // the network may have a script to keep, or none yet
  let idea = await one("ideas", run.idea_id);
  const drawn = options.video_style === "explainer";
  if (drawn) {
    // the drawing belongs to its words: a kept script keeps its plan only if that plan was made for it
    const planned = idea.ai?.style === "explainer" && idea.ai?.explainer?.scenes?.length && (idea.ai.explainer.look || "glow") === (options.look || "glow")
      && idea.ai.explainer.scenes.map((x) => `VO: ${x.narration}`).join("\n\n") === String(idea.script || "").trim();
    if (options.keep_script && planned) await skip("script", "Keeping the explainer already planned");
    else await step("script", (note) => planExplainer(idea, channel, options, note));
    await skip("review", "The explainer plan keeps its own words");
  } else if (options.keep_script && idea.script?.trim()) {
    await skip("script", "Keeping your script");
    await skip("review", "Keeping your script");
    if (!idea.ai?.brief) await call("ai", { action: "brief", idea_id: idea.id }).catch((e) => log(`brief: ${e.message}`));
  } else {
    await step("script", () => writeScript(idea, channel, options));
    await step("review", () => reviewScript(idea.id));
  }
  idea = await one("ideas", run.idea_id);
  if (!idea.script?.trim()) throw new Error("The idea has no script.");
  const brief = idea.ai?.brief || {};

  const earlier = (await rest("GET", "video_projects", `?idea_id=eq.${idea.id}&select=*&order=created_at.desc&limit=1`))[0];
  let projectId;
  await step("scenes", async () => { projectId = await buildScenes(idea, channel, options, earlier); return `Voice style: ${options.voice_style || brief.voice_style || "natural"}`; });
  const project = await one("video_projects", projectId);
  if (drawn) await skip("clips", "Drawn scenes, no clips");
  else await step("clips", (note) => chooseClips(projectId, brief.subject || idea.video_title || idea.title, project.aspect, note));
  await step("voice", () => waitForVoice(projectId));
  const total = (await sceneRows(projectId)).reduce((t, s) => t + sceneSeconds(s), 0);
  if (options.music === false) await skip("music", "You chose no music");
  else await step("music", () => findMusic(projectId, brief, channel.id, total));
  if (options.sounds && !drawn) await step("sounds", () => addSounds(projectId, brief, total));
  else {
    await rest("PATCH", "project_scenes", `?project_id=eq.${projectId}`, { sounds: [] });
    await skip("sounds", "No sound effects");
  }
  if (drawn) await skip("thumbnail", "The drawn frames are the cover");
  else await step("thumbnail", () => makeThumbnailChoice(projectId, idea, brief, project.aspect));
  let job;
  await step("render", async () => { job = await renderVideo(projectId, idea.id); return `${Math.round(job.duration_s)} s`; });
  let checks = [];
  await step("check", async () => {
    checks = await finalChecks(job, await one("video_projects", projectId));
    await report({ checks });
    const failed = checks.filter((c) => !c.ok).length;
    return failed ? `${failed} check${failed === 1 ? "" : "s"} failed` : "All checks passed";
  });

  const final = await one("video_projects", projectId);
  if (options.music !== false && brief.music_mood !== "none" && !foundMusic(final.settings?.music)) log("no music on this video");
  const clean = checks.every((c) => c.ok) && !warnings.length;
  await report({ status: clean ? "ready" : "review" });
  if (clean && options.publish === "next") {
    await saveSettings(projectId, { publish: { ...(final.settings?.publish || {}), mode: "next" } });
    const out = await call("publish", { action: "auto", render_job_id: job.id }).catch((e) => ({ error: e.message }));
    log(out.skipped ? `Not queued: ${out.skipped}` : out.error ? `Not queued: ${out.error}` : `Queued for ${out.row?.slot_at || "now"}`);
    if (out.error || out.skipped) await warn(`It didn't go out: ${out.error || out.skipped}`);
  }
  log(`Finished: ${run.status}`);
}

async function fail(e) {
  if (e instanceof Stopped) { log("Stopped by the creator"); return; }
  console.error(e);
  if (run?.id) await report({ status: "failed", error: String(e?.message || e).slice(0, 2000) }).catch(() => {});
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv[2] === "--stopped") {
    const id = process.argv[3];
    const row = await one("video_runs", id);
    if (row && ["queued", "running"].includes(row.status)) await rest("PATCH", "video_runs", `?id=eq.${id}`, { status: "failed", error: "The machine stopped this run before it finished. Try again." });
  } else if (!/^[0-9a-f-]{36}$/.test(process.argv[2] || "")) {
    console.error("usage: node render/autovideo.mjs <run id>");
    process.exit(1);
  } else {
    await main(process.argv[2]).catch(fail);
  }
}
