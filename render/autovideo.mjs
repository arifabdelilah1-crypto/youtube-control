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
import { SCENE_GAP, TAIL, creditsText, foundMusic, hasThumbnail, mixKind, preRenderCheck, sceneSeconds, withCredits } from "../video/layout.js";
import { PRESETS, presetFx } from "../web/voicefx.js";
import { applyPicks, checkVideo, chooseVoice, libraryTrack, pickTrack, placeSounds, usable, voiceCoverage, voiceThreshold } from "./autolib.mjs";
import { downloadFromVds, isVds, mediaReady, vdsPath } from "./media.mjs";
import { writeStoryFilm } from "./story.mjs";
import { illustratedThumbnail, writeIllustrated } from "./illustrated.mjs";
import { deliverToSite } from "./site.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const URL_ = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const FN = { ai: process.env.AI_FUNCTION || "ai", studio: process.env.STUDIO_FUNCTION || "studio", publish: "publish", explainer: "explainer", story: "story", sites: "sites" };
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
// A function at the AI safety cap answers "Daily AI limit reached": the video waits for room and tries again.
async function call(fn, body, seconds = 170) {
  for (;;) {
    try { return await callOnce(fn, body, seconds); }
    catch (e) {
      if (!/Daily AI limit reached/i.test(e.message || "")) throw e;
      await waitForAiRoom(1);
    }
  }
}
async function callOnce(fn, body, seconds) {
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
let stepNote = null;  // writes a line on the running step (set by step())
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
  stepNote = (text) => set("running", text);
  try {
    const detail = await work(stepNote);
    await set("done", detail);
  } catch (e) {
    if (!(e instanceof Stopped)) await set("failed", e.message);
    throw e;
  } finally { stepNote = null; }
}

// ---------- the AI safety cap ----------
// Settings → AI safety cap (app_settings.ai_daily_runs, migration 0037) counts every AI call of the last 24 h. Near it,
// the video waits for room (the oldest calls leave the 24 h window) instead of failing; the step says why.
const CAP_POLL_MS = 5 * 60e3;
const CAP_WAIT_MS = 75 * 60e3;  // the whole run's waiting, inside the job's 180 minutes
let capWaited = 0;
async function aiRunsStatus() {
  const r = await fetch(`${URL_}/rest/v1/rpc/ai_runs_status`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: "{}" }).catch(() => null);
  if (!r?.ok) return null;  // no setting yet: the functions still guard the cap
  const row = (await r.json().catch(() => []))[0];
  return row ? { used: Number(row.used) || 0, cap: Number(row.cap) || 400 } : null;
}
async function waitForAiRoom(need) {
  for (;;) {
    const s = await aiRunsStatus();
    if (!s || s.used + need <= s.cap) return;
    if (capWaited >= CAP_WAIT_MS) throw new Error(`Daily AI limit reached (${s.used} of ${s.cap} AI runs in 24 h), still full after ${Math.round(capWaited / 60e3)} minutes of waiting. Raise it in Settings → AI safety cap, or start the video again later.`);
    if (run?.id && (await one("video_runs", run.id))?.status === "cancelled") throw new Stopped();
    const text = `Waiting for the AI safety cap: ${s.used} of ${s.cap} AI runs in the last 24 h. Trying again in 5 minutes.`;
    log(text);
    if (stepNote) await stepNote(text).catch(() => {});
    await sleep(CAP_POLL_MS);
    capWaited += CAP_POLL_MS;
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
// lengths Claude writes chapter by chapter (supabase/functions/explainer/plan.ts LENGTHS)
const CHAPTERED = { long5: 3, long8: 4, long10: 5 };
async function planExplainer(idea, channel, options, note) {
  const model = MODEL_LABELS[options.ai_model] ? options.ai_model : "claude-opus-5-5";
  const aspect = options.aspect === "16:9" ? "16:9" : "9:16";
  const mix = options.video_style === "mix";
  const body = { idea_id: idea.id, channel_id: channel.id, language: options.language, angle: options.angle, length: options.length, model, look: options.look || "glow", aspect,
    ...(mix ? { style: "mix" } : {}) };
  // a function gets about 150 s: less thinking, then the faster model, if an answer takes too long
  const tries = [{}, { effort: "low" }, ...(model === "claude-sonnet-5-5" ? [] : [{ model: "claude-sonnet-5-5", effort: "low" }])];
  const fallbacks = [];
  const ask = async (extraBody, what) => {
    let lastError = "";
    for (const extra of tries) {
      try {
        if (extra.model || extra.effort) await note(`${what}: trying again with ${extra.model ? MODEL_LABELS[extra.model] : "less thinking"}`);
        const out = await call("explainer", { ...body, ...extraBody, ...extra }, 160);
        if (extra.model) fallbacks.push(what);
        return out;
      } catch (e) {
        lastError = e.message;
        log(`explainer ${extraBody.action} ${JSON.stringify(extra)} failed: ${e.message}`);
        if (/not allowed|limit reached|not set up|required|not found|Pick a network|out of range/i.test(e.message)) break;  // trying again would not help
      }
    }
    throw new Error(`${what}: ${lastError || "failed"}`);
  };
  const tell = async () => { if (fallbacks.length) await warn(`${MODEL_LABELS[model]} was too slow for ${fallbacks.join(", ")}, so ${MODEL_LABELS["claude-sonnet-5-5"]} wrote ${fallbacks.length === 1 ? "it" : "them"}.`); };

  if (mix || !(aspect === "16:9" && CHAPTERED[options.length])) {
    const out = await ask({ action: "plan" }, "The plan");
    await tell();
    return `${out.scenes} scenes${mix ? ` (${out.real ?? "?"} real)` : ""} by ${MODEL_LABELS[out.model] || out.model}, $${Number(out.cost_usd || 0).toFixed(3)}`;
  }
  // a long YouTube video: the outline, then the chapters three at a time (each one only reads the outline), then the whole
  await note("Planning the chapters");
  const { outline, cost_usd: outlineCost } = await ask({ action: "outline" }, "The outline");
  const parts = new Array(outline.chapters.length);
  let done = 0, cost = Number(outlineCost) || 0;
  const queue = outline.chapters.map((_, i) => i);
  await note(`Writing ${outline.chapters.length} chapters`);
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) {
      const i = queue.shift();
      const out = await ask({ action: "chapter", outline, index: i }, `Chapter ${i + 1}`);
      parts[i] = out.scenes;
      cost += Number(out.cost_usd) || 0;
      await note(`${++done} of ${outline.chapters.length} chapters written`);
    }
  }));
  const saved = await call("explainer", { ...body, action: "assemble", outline, chapters: parts, cost_usd: cost }, 60);
  await tell();
  return `${saved.scenes} scenes in ${outline.chapters.length} chapters by ${MODEL_LABELS[model]}, $${cost.toFixed(3)}`;
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
  const story = options.video_style === "story" && ai.story?.code;
  const mix = (options.video_style === "mix" || options.video_style === "illustrated") && ai.mix?.scenes?.length;
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
      hook: { ...(base.hook || {}), enabled: false } } : story ? {
      // the Story style: Claude's film, in the look picked; its own plain subtitles, no hook text on top
      style: "story", story: { code: ai.story.code, look: options.look || ai.story.look || "noir" }, hook: { ...(base.hook || {}), enabled: false },
      captions: { ...(base.captions || {}), enabled: false } } : mix ? {
      // the Mix style (video/Mix.jsx): each scene's kind and drawing, without the narration (the script) or the footage searches (FOOTAGE lines)
      style: "mix", mix: { look: options.look || "glow", model: ai.mix.model || null, scenes: ai.mix.scenes.map(({ narration: _n, footage: _f, ...rest }) => rest),
        ...(options.video_style === "illustrated" ? { illustrated: true } : {}) },
      hook: { ...(base.hook || {}), enabled: false } } : { style: "classic" }),
  };
  const out = await call("studio", {
    action: "build", project_id: project?.id || null, idea_id: idea.id, channel_id: channel.id, title: idea.video_title || idea.title, script: idea.script,
    language, voice, voice_rate: rate, aspect: drawn || story || mix ? (options.aspect === "16:9" ? "16:9" : "9:16") : options.aspect || ai.aspect || style.aspect || "9:16", settings, default_terms: drawn || story || mix ? [] : idea.search_terms || [],
  });
  if (!out.project_id) throw new Error(out.error || "The scenes couldn't be built");
  if (out.status === "failed") throw new Error(out.error || "The voice job couldn't start");
  await report({ project_id: out.project_id });
  return out.project_id;
}

/** Rewrites the "m:ss Title" lines of the description with each chapter's real start (scene durations from the voice). */
async function chapterTimes(idea, projectId, chapters = idea.ai?.story?.chapters || idea.ai?.chapters || []) {
  if (chapters.length < 2) return;
  const rows = await sceneRows(projectId);
  const starts = [];
  let t = 0, k = 0;
  for (const c of chapters) { starts.push(t); for (let j = 0; j < c.lines && k < rows.length; j++, k++) t += sceneSeconds(rows[k]) + SCENE_GAP; }
  const fmt = (x) => { const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), sec = String(Math.floor(x % 60)).padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`; };
  // YouTube makes chapters from these lines: the first at 0:00, each at least 10 s long
  const marks = chapters.map((c, i) => `${fmt(starts[i])} ${c.title}`).filter((_, i) => i === 0 || starts[i] - starts[i - 1] >= 10).join("\n");
  const desc = String(idea.video_description || "");
  const block = desc.match(/(^|\n)0:00 [^\n]*(\n\d+:\d\d(:\d\d)? [^\n]*)*/);
  // no block yet: the chapters go after the first paragraph
  const next = block ? desc.replace(block[0], `${block[1]}${marks}`) : desc.replace(/^([^\n]*(\n[^\n]+)*)/, `$1\n\n${marks}`);
  await rest("PATCH", "ideas", `?id=eq.${idea.id}`, { video_description: next });
}
const sceneRows = (projectId) => rest("GET", "project_scenes", `?project_id=eq.${projectId}&select=*&order=idx`);
const clipLine = (c, n) => ({ n, type: c.type, seconds: c.duration ?? null, tags: String(c.tags || "").slice(0, 160) });

/** An editor chooses from the tags, searches again where nothing fits, then looks at the pictures.
 *  mix: the Mix style's plan (settings.mix.scenes): only its footage and overlay scenes get a clip; a drawn scene keeps
 *  {type: "drawn"}, and a real scene where nothing fits becomes a drawing (a warning, not a failure). */
async function chooseClips(projectId, subject, aspect, note, mix = null) {
  const all = (await sceneRows(projectId)).map((s) => ({ ...s, candidates: (s.candidates || []).filter(usable) }));
  // a recipe video: a scene planned on one of the article's own photos shows that photo, with no search and no credit line
  const given = (i) => (mix && mix[i]?.image?.path && mixKind(mix[i], { type: "image" }) !== "drawn" ? mix[i].image : null);
  const real = (i) => (!mix || ["footage", "overlay"].includes(mixKind(mix[i], { type: "video" }))) && !given(i);
  if (mix) for (const [i, s] of all.entries()) {
    const photo = given(i);
    if (photo) await rest("PATCH", "project_scenes", `?id=eq.${s.id}`, { clip: { type: "image", path: photo.path, source: "article", id: `article-${photo.n}`, tags: photo.alt || "", trim: 0 }, candidates: [] });
    else if (!real(i)) await rest("PATCH", "project_scenes", `?id=eq.${s.id}`, { clip: { type: "drawn" }, candidates: [] });
  }
  const photos = mix ? all.filter((_, i) => given(i)).length : 0;
  if (photos) await note(`${photos} scene${photos === 1 ? "" : "s"} on the article's own photos`);
  const scenes = all;
  const ask = async (list) => (await call("ai", { action: "pick_clips", idea_id: run.idea_id, subject,
    scenes: list.map(({ i, s }) => ({ i, says: s.text, seconds: Math.round(sceneSeconds(s)), clips: s.candidates.map(clipLine) })) })).picks || [];
  const indexed = scenes.map((s, i) => ({ i, s })).filter(({ i }) => real(i));
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
  // what's left: the first clip no other scene uses, said out loud. In a Mix, a drawing instead.
  const taken = new Set(Object.values(chosen).filter(Boolean).map((c) => `${c.source}-${c.id}`));
  const weak = [];
  for (const { i, s } of indexed) {
    if (chosen[i]) continue;
    weak.push(i + 1);
    if (mix) continue;
    const fallback = s.candidates.find((c) => !taken.has(`${c.source}-${c.id}`));
    if (fallback) { chosen[i] = fallback; taken.add(`${fallback.source}-${fallback.id}`); }
  }
  for (const { i, s } of indexed) {
    const { seen: _seen, ...pick } = chosen[i] || {};
    // a Mix's name card stays only on a picture of that very person or thing (not a fan in their jersey)
    const dropCard = mix && s.card?.name && (!chosen[i] || !namedIn(chosen[i], s.card.name));
    if (dropCard) log(`scene ${i + 1}: name card "${s.card.name}" dropped, the picture isn't of them`);
    await rest("PATCH", "project_scenes", `?id=eq.${s.id}`, { clip: chosen[i] ? { ...pick, trim: 0 } : { type: mix ? "drawn" : "card" }, candidates: s.candidates.slice(0, 16),
      ...(dropCard ? { card: null } : {}) });
  }
  if (mix && weak.length) {
    // its plan when Claude drew one (an overlay), else its key phrase as a title
    const project = await one("video_projects", projectId);
    const plan = (project.settings?.mix?.scenes || []).map((p, i) => (!weak.includes(i + 1) ? p
      : { ...p, kind: "drawn", ...(p.heading || (p.items || []).length || p.number ? {} : { layout: "title", heading: keyPhrase(scenes[i].text), items: [] }) }));
    await saveSettings(projectId, { mix: { ...project.settings.mix, scenes: plan } });
    await warn(`Scene${weak.length === 1 ? "" : "s"} ${weak.join(", ")}: no real clip fit, so ${weak.length === 1 ? "it is" : "they are"} drawn instead.`);
    return `${indexed.length - weak.length} of ${indexed.length} real scenes found a clip; ${weak.length} drawn instead`;
  }
  if (weak.length) await warn(`Scene${weak.length === 1 ? "" : "s"} ${weak.join(", ")}: no clip really fits. Choose another one.`);
  const n = indexed.length;
  const own = photos ? `${photos} article photo${photos === 1 ? "" : "s"}${n ? ", " : ""}` : "";
  if (!n && photos) return `${photos} article photo${photos === 1 ? "" : "s"}, no stock clip needed`;
  return own + (weak.length ? `${n - weak.length} of ${n} fit` : mix ? `all ${n} stock scene${n === 1 ? "" : "s"} fit` : `All ${n} scenes fit`);
}
/** Is the clip a picture of that name? Every word of the name (3+ letters) in its tags, title or page. */
function namedIn(clip, name) {
  const norm = (x) => String(x || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ");
  const hay = ` ${norm([clip.tags, clip.title, clip.page].join(" "))} `;
  const words = norm(name).split(" ").filter((w) => w.length > 2);
  return words.length > 0 && words.every((w) => hay.includes(` ${w} `) || hay.includes(` ${w}`));
}
/** A scene's few key words, for a drawn title when nothing else was planned. */
function keyPhrase(text) {
  const words = String(text || "").replace(/[“”"«»]/g, "").split(/\s+/).filter(Boolean);
  const long = words.filter((w) => w.replace(/[^\p{L}\p{N}]/gu, "").length > 3);
  return (long.length >= 2 ? long : words).slice(0, 4).join(" ").replace(/[.,!?;:…]+$/u, "").slice(0, 40);
}

async function waitForVoice(projectId) {
  const deadline = Date.now() + 60 * 60e3;   // the voice job may wait for a free GitHub machine when many videos run
  let retried = false;
  while (Date.now() < deadline) {
    // a stopped video frees its GitHub slot at once: the voice job may be waiting for that slot
    if ((await one("video_runs", run.id))?.status === "cancelled") throw new Stopped();
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
  throw new Error("The voice took more than 60 minutes.");
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
  // the licences need these lines in the description (a drawn Explainer shows no footage or photo: only the music is credited)
  const drawnOnly = ["explainer", "story"].includes(project.settings?.style);
  const idea = await one("ideas", ideaId);
  await rest("PATCH", "ideas", `?id=eq.${ideaId}`, { video_description: withCredits(idea.video_description || "", creditsText(drawnOnly ? [] : scenes, project.settings?.music, drawnOnly ? null : project.settings?.thumbnail)) });
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
/** Six frames of a drawn film on one picture (3 × 2), so the Animation page shows the film without opening it. In Storage: renders/contact/<run>.jpg */
async function contactSheet(file, seconds) {
  if (!run?.id || !seconds) return;
  const out = path.join(os.tmpdir(), `${run.id}-sheet.jpg`);
  const made = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", "0.5", "-i", file,
    "-vf", `fps=6/${Math.max(1, seconds - 0.5).toFixed(2)},scale=320:-2,tile=3x2:padding=6:color=black`, "-frames:v", "1", "-q:v", "4", out], { encoding: "utf8" });
  if (made.status !== 0 || !fs.existsSync(out)) throw new Error(String(made.stderr || "ffmpeg failed").slice(-200));
  const objectPath = `contact/${run.id}.jpg`;
  const r = await fetch(`${URL_}/storage/v1/object/renders/${objectPath}`, { method: "POST", headers: { ...H, "Content-Type": "image/jpeg", "x-upsert": "true" }, body: fs.readFileSync(out) });
  fs.rmSync(out, { force: true });
  if (!r.ok) throw new Error(`upload ${r.status}: ${(await r.text()).slice(0, 200)}`);
  await report({ contact_sheet: objectPath });
}

async function finalChecks(job, project) {
  const drawn = ["explainer", "story"].includes(project.settings?.style);
  const mix = project.settings?.style === "mix" ? project.settings.mix?.scenes || [] : null;
  if (!isVds(job.output_path) || !mediaReady()) return [{ name: "File", ok: false, detail: "The video isn't on the VDS, so it couldn't be measured." }];
  const file = path.join(os.tmpdir(), `${job.id}.mp4`);
  await downloadFromVds(vdsPath(job.output_path), file);
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", file], { encoding: "utf8" }));
  const video = probe.streams.find((s) => s.codec_type === "video") || {};
  const hasAudio = probe.streams.some((s) => s.codec_type === "audio");
  const volume = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "volumedetect", "-vn", "-f", "null", "-"], { encoding: "utf8" }).stderr || "";
  const black = drawn ? "" : spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vf", "blackdetect=d=0.5:pix_th=0.05", "-an", "-f", "null", "-"], { encoding: "utf8" }).stderr || "";
  // (the Explainer style draws white lines on black: the black-screen check would flag every frame)
  const scenes = await sceneRows(project.id);
  let blackSeconds = [...black.matchAll(/black_duration:([\d.]+)/g)].reduce((t, m) => t + Number(m[1]), 0);
  if (mix) {
    // a Mix: only black inside its real scenes counts (its drawn scenes may be dark on purpose)
    let at = 0;
    const realSpans = scenes.map((s, i) => { const from = at; at += sceneSeconds(s) + SCENE_GAP + (i === scenes.length - 1 ? TAIL : 0); return [from, at, ["footage", "overlay"].includes(mixKind(mix[i], s.clip))]; })
      .filter(([, , isReal]) => isReal);
    blackSeconds = [...black.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].reduce((t, m) => t + realSpans.reduce((u, [a, b]) =>
      u + Math.max(0, Math.min(b, Number(m[2])) - Math.max(a, Number(m[1]))), 0), 0);
  }
  // is the narrator really heard over the music? What a listener would catch, against the script
  const listen = spawnSync("python", [path.join(ROOT, "render/voice_check.py"), file, project.language], { encoding: "utf8", timeout: 15 * 60e3 });
  const voice = listen.status === 0
    ? (() => { const share = voiceCoverage(scenes.map((s) => s.text).join(" "), listen.stdout, project.language); log(`Heard: ${listen.stdout.slice(0, 300)}`); return { name: "Voice", ok: share >= voiceThreshold(project.language), detail: `${Math.round(share * 100)}% of the script is heard` }; })()
    : { name: "Voice", ok: false, detail: "The voice couldn't be checked by listening. Listen to the video." };
  if (listen.status !== 0) log(`voice check: ${String(listen.stderr).slice(-400)}`);
  if (drawn || mix) await contactSheet(file, Number(probe.format?.duration) || 0).catch((e) => log(`contact sheet: ${e.message}`));
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
  // a site's video already made (ready, or waiting on a soft warning) that didn't reach its site: started again, it only delivers
  if (options.site_article_id && run.render_job_id && ["ready", "review"].includes(run.status)) {
    const job = await one("render_jobs", run.render_job_id);
    if (job?.status === "done") {
      log("Already made: delivering to the site only");
      const set = (v) => rest("PATCH", "site_articles", `?id=eq.${options.site_article_id}`, v).catch(() => null);
      try {
        const url = await deliverToSite({ articleId: options.site_article_id, job, idea: await one("ideas", run.idea_id), call, rest, log, downloadFromVds, vdsPath });
        log(`On the site: ${url}`);
        if (run.status === "review") await report({ status: "ready" });
      } catch (e) { log(`site: ${e.message}`); await set({ status: "failed", error: String(e.message).slice(0, 480) }); throw e; }
      return;
    }
  }
  await report({ status: "running", run_url: process.env.RUN_URL || null, steps: STEPS.map((key) => ({ key, status: "waiting", detail: "" })), warnings: [], checks: [], error: null });
  const channel = await one("channels", run.channel_id);
  if (!channel) throw new Error("The network no longer exists.");
  const skip = async (key, why) => { await report({ steps: run.steps.map((s) => (s.key === key ? { ...s, status: "skipped", detail: why } : s)) }); };
  // a video makes about 15 AI calls: near the cap it waits for room before it starts (the first step shows why)
  stepNote = (text) => report({ steps: run.steps.map((s, i) => (i === 0 ? { ...s, status: "waiting", detail: text } : s)) });
  await waitForAiRoom(15);
  stepNote = null;

  // the network may have a script to keep, or none yet
  let idea = await one("ideas", run.idea_id);
  const storyStyle = options.video_style === "story";
  // Illustrated: painted scenes (Alibaba), coded maps and icon scenes, real photos; rendered by the Mix renderer
  const illustrated = options.video_style === "illustrated";
  const mixStyle = options.video_style === "mix" || illustrated;
  const drawn = options.video_style === "explainer" || storyStyle;
  if (storyStyle) {
    // the film belongs to its words: a kept script keeps its film only if that film was made for it
    const lines = (idea.ai?.story?.lines || []).map((l) => `VO: ${l}`).join("\n\n");
    // ...and only in its own language (a German voice must never read an English film)
    const lang = options.language || channel.video_style?.language || channel.language || "en";
    if (options.keep_script && idea.ai?.story?.code && lines === String(idea.script || "").trim() && (idea.ai?.language || "en") === lang) await skip("script", "Keeping the film already drawn");
    else await step("script", (note) => writeStoryFilm(idea, channel, options, { ROOT, rest, call, log, note, warn }));
    await skip("review", "The story and its film go together");
  } else if (illustrated) {
    const said = String(idea.script || "").split("\n").filter((l) => l.startsWith("VO: ")).map((l) => l.slice(4).trim()).join("\n");
    const ready = idea.ai?.style === "illustrated" && idea.ai?.mix?.scenes?.length && idea.ai.mix.scenes.map((x) => String(x.narration).trim()).join("\n") === said
      && idea.ai.mix.scenes.every((x) => x.kind !== "footage" || x.image?.path || x.footage?.length);
    if (options.keep_script && ready) await skip("script", "Keeping the illustrated plan and its paintings");
    else await step("script", (note) => writeIllustrated(idea, channel, options, { ROOT, rest, call, log, note, warn }));
    await skip("review", "The plan keeps its own words");
  } else if (drawn || mixStyle) {
    // the drawing belongs to its words: a kept script keeps its plan only if that plan was made for it
    const key = mixStyle ? "mix" : "explainer";
    const plan = idea.ai?.[key];
    const said = String(idea.script || "").split("\n").filter((l) => l.startsWith("VO: ")).map((l) => l.slice(4).trim()).join("\n");
    const planned = idea.ai?.style === key && plan?.scenes?.length && (plan.look || "glow") === (options.look || "glow")
      && plan.scenes.map((x) => String(x.narration).trim()).join("\n") === said;
    if (options.keep_script && planned) await skip("script", mixStyle ? "Keeping the Mix already planned" : "Keeping the explainer already planned");
    else await step("script", (note) => planExplainer(idea, channel, options, note));
    await skip("review", "The plan keeps its own words");
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
  else await step("clips", (note) => chooseClips(projectId, brief.subject || idea.video_title || idea.title, project.aspect, note, mixStyle ? project.settings?.mix?.scenes || [] : null));
  await step("voice", () => waitForVoice(projectId));
  // a long episode's YouTube chapters: the real start of each chapter, from the voice
  if (storyStyle && idea.ai?.story?.chapters?.length > 1) await chapterTimes(idea, projectId).catch((e) => log(`chapter times: ${e.message}`));
  if (illustrated) await chapterTimes(await one("ideas", idea.id), projectId, (await one("ideas", idea.id)).ai?.chapters || []).catch((e) => log(`chapter times: ${e.message}`));
  const total = (await sceneRows(projectId)).reduce((t, s) => t + sceneSeconds(s), 0);
  if (options.music === false) await skip("music", "You chose no music");
  else await step("music", () => findMusic(projectId, brief, channel.id, total));
  if (options.sounds && !drawn && !mixStyle) await step("sounds", () => addSounds(projectId, brief, total));
  else {
    await rest("PATCH", "project_scenes", `?project_id=eq.${projectId}`, { sounds: [] });
    await skip("sounds", "No sound effects");
  }
  if (illustrated) {
    // a long documentary gets its own painted thumbnail with a big title; it goes up with the video
    await step("thumbnail", async () => {
      const t = await illustratedThumbnail(await one("ideas", idea.id), log);
      if (!t) return "No thumbnail: the painting couldn't be made";
      await saveSettings(projectId, { thumbnail: { text: t.text, style: "bold", position: "top", size: 130, image: { type: "image", path: t.path } } });
      return `“${t.text}” on its own painting`;
    });
  } else if (drawn || mixStyle) await skip("thumbnail", "The drawn frames are the cover");
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
  // a site's daily video doesn't wait for a soft warning (a drawn scene, say): only a failed check stops it
  // a scene drawn because no real clip fit is a fallback, not a fault: it never holds a video back. A site's daily video doesn't
  // wait for any soft warning. Only a failed check (voice, black screen…) stops it.
  const hard = warnings.filter((w) => !/drawn instead/i.test(w));
  const clean = checks.every((c) => c.ok) && (!hard.length || !!options.site_article_id);
  if (clean && warnings.length) log(`Going on despite: ${warnings.join(" · ")}`);
  await report({ status: clean ? "ready" : "review" });
  if (clean && options.publish === "next") {
    // only_platforms (e.g. a site's video: YouTube only, the site posts its own pin and TikTok): the others are left out
    const only = Array.isArray(options.only_platforms) && options.only_platforms.length ? options.only_platforms : null;
    await saveSettings(projectId, { publish: { ...(final.settings?.publish || {}), mode: "next",
      ...(only ? { exclude: ["youtube", "tiktok", "facebook", "instagram", "twitter", "pinterest"].filter((x) => !only.includes(x)) } : {}) } });
    const out = await call("publish", { action: "auto", render_job_id: job.id }).catch((e) => ({ error: e.message }));
    log(out.skipped ? `Not queued: ${out.skipped}` : out.error ? `Not queued: ${out.error}` : `Queued for ${out.row?.slot_at || "now"}`);
    if (out.error || out.skipped) await warn(`It didn't go out: ${out.error || out.skipped}`);
  }
  // Pinterest & sites: the video goes into its article and onto the site's board, only when every check passed
  if (options.site_article_id) {
    const set = (v) => rest("PATCH", "site_articles", `?id=eq.${options.site_article_id}`, v).catch(() => null);
    if (!clean) await set({ status: "review", error: `Waiting for you: ${[...checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`), ...warnings].join(" · ").slice(0, 480) || "to check"}` });
    else {
      try { const url = await deliverToSite({ articleId: options.site_article_id, job, idea: await one("ideas", idea.id), call, rest, log, downloadFromVds, vdsPath }); log(`On the site: ${url}`); }
      catch (e) { log(`site: ${e.message}`); await warn(`It didn't reach the site: ${e.message}`); await set({ status: "failed", error: String(e.message).slice(0, 480) }); }
    }
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
