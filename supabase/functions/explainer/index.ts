// Explainer style: Claude writes the voice-over AND the drawing of every scene (layout, pictograms, labels, cue words).
// POST {action:"plan", idea_id, channel_id?, language?, length?, angle?, model?, effort?, look?, aspect?}
//   -> up to 3 minutes: saves ideas.script (one "VO:" line per scene), title, description, tags, and ideas.ai.explainer
//      {scenes} + the cost.
//   model: claude-opus-5-5 (default) | claude-fable-5-2 | claude-sonnet-5-5. effort: low | medium | high (default: the model's own).
// Longer YouTube videos (length long5 | long8 | long10), chapter by chapter so every call stays inside a function's time:
//   POST {action:"outline", ...same}                         -> {outline: {title, description, ..., chapters}, cost_usd}
//   POST {action:"chapter", ...same, outline, index}          -> {scenes, cost_usd} (chapters only see the outline: run them together)
//   POST {action:"assemble", ...same, outline, chapters, cost_usd} -> saves the idea like "plan" (the job only)
// POST {action:"start", idea_id, channel_id?, options} -> starts "Generate video" (render/autovideo.mjs) as an Explainer video,
//   like ai's auto_start, with options.video_style = "explainer", options.ai_model, options.look (glow | whiteboard | kinetic),
//   options.aspect 9:16 (Short, the default) or 16:9 (YouTube video), and no sound effects. Returns {run_id}. Started from the
//   Animation page.
// "plan", "outline" and "chapter" are called by the "Generate video" job (x-cron-secret) or a signed-in team member; "start" by a
// team member; "assemble" by the job.
// Secrets: ANTHROPIC_API_KEY, GITHUB_TOKEN, GITHUB_REPO.
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@1.8.0/helpers/zod";
import { ICON_NAMES } from "./icons.ts";
import { Chapter, LENGTHS, LOOKS, MODELS, Outline, Plan, chapterSystem, chapterUser, clean, outlineSystem, system, userPrompt } from "./plan.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GH_TOKEN = Deno.env.get("GITHUB_TOKEN") ?? "";
const GH_REPO = Deno.env.get("GITHUB_REPO") ?? "";
const VOICE_STYLES = new Set(["natural", "dark", "deep", "horror"]);
const DAILY_RUNS = 200;  // shared with the other AI calls (ai_runs)
const LIMIT_MS = 135_000;  // a function gets about 150 seconds: past this the job tries again with less thinking

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f-]{36}$/;
class Fail extends Error {
  status: number;
  extra: Record<string, unknown>;
  constructor(msg: string, status = 500, extra: Record<string, unknown> = {}) { super(msg); this.status = status; this.extra = extra; }
}

const priceOf = (model: string, u: any) => Math.round((((u?.input_tokens || 0) * MODELS[model].price[0] + (u?.output_tokens || 0) * MODELS[model].price[1]) / 1e6) * 10000) / 10000;

/** One Claude call with a typed answer. Logs the run; a slow answer says so, so the job can try again with less thinking. */
async function ask(db: any, ctx: any, kind: string, schema: any, sys: string, user: string, ownerId: string | null) {
  const since = new Date(Date.now() - 864e5).toISOString();
  const { count } = await db.from("ai_runs").select("id", { count: "exact", head: true }).gte("created_at", since);
  if ((count ?? 0) >= DAILY_RUNS) throw new Fail(`Daily AI limit reached (${DAILY_RUNS} runs in 24 h).`, 429);
  const client = new Anthropic({ apiKey: KEY, maxRetries: 1, timeout: LIMIT_MS });
  const started = Date.now();
  let res;
  try {
    res = await client.messages.parse({
      model: ctx.model, max_tokens: 16000, system: sys, messages: [{ role: "user", content: user }],
      output_config: { format: zodOutputFormat(schema), ...(ctx.effort ? { effort: ctx.effort } : {}) },
    });
  } catch (e) {
    const slow = Date.now() - started > LIMIT_MS - 5000 || /timed? ?out/i.test(String((e as Error).message));
    throw new Fail(slow ? `${MODELS[ctx.model].label} took too long` : `Claude: ${String((e as Error).message || e).slice(0, 300)}`, slow ? 504 : 502, { slow });
  }
  await db.from("ai_runs").insert({ idea_id: ctx.idea.id, kind, model: ctx.model, owner_id: ownerId,
    prompt_tokens: res.usage.input_tokens, completion_tokens: res.usage.output_tokens, ok: !!res.parsed_output });
  if (!res.parsed_output) throw new Fail(res.stop_reason === "max_tokens" ? "Claude ran out of room before finishing" : "Claude returned no answer", 502);
  return { out: res.parsed_output as any, usage: res.usage, cost: priceOf(ctx.model, res.usage), seconds: Math.round((Date.now() - started) / 1000) };
}

const ICON_SET = new Set(ICON_NAMES);
/** Scenes as the renderer expects them, whoever wrote them (Claude, or the job passing chapters back). */
function cleanScenes(list: any[]) {
  return (Array.isArray(list) ? list : []).map((s) => ({
    narration: clean(s?.narration, 600).replace(/^(TITLE|VO|VOICE|FOOTAGE|CARD)\s*:\s*/i, ""),
    layout: ["title", "row", "journey", "compare", "checklist", "year", "stat", "quote"].includes(s?.layout) ? s.layout : "title",
    heading: clean(s?.heading, 80), number: Math.round(Number(s?.number) || 0), number_prefix: clean(s?.number_prefix, 4), number_suffix: clean(s?.number_suffix, 6),
    highlight: Math.max(0, Math.min(100, Math.round(Number(s?.highlight) || 0))),
    items: (Array.isArray(s?.items) ? s.items : []).slice(0, 4).map((it: any) => {
      const kind = ["icon", "person", "person_hat", "child"].includes(it?.kind) ? it.kind : "icon";
      return { kind, label: clean(it?.label, 40), cue: clean(it?.cue, 40), icon: kind === "icon" ? (ICON_SET.has(it?.icon) ? it.icon : "sparkles") : "",
        count: Math.max(1, Math.min(6, Math.round(Number(it?.count) || 1))) };
    }),
  })).filter((s) => s.narration);
}

/** Saves a finished plan on the idea: the script (one VO line per scene), title, description, tags, and the drawing. */
async function savePlan(db: any, ctx: any, meta: any, scenes: any[], extra: { cost: number; usage?: unknown; seconds?: number; chapters?: number }) {
  const { idea } = ctx;
  if (!scenes.length) throw new Fail("Claude returned no scenes", 502);
  const script = scenes.map((s) => `VO: ${s.narration}`).join("\n\n");
  const hashtags = (meta.hashtags || []).map((t: string) => "#" + clean(t, 40).replace(/^#/, "").replace(/\s+/g, "")).filter((t: string) => t.length > 1).slice(0, 3);
  const ai = {
    style: "explainer", language: ctx.language, length: ctx.length, aspect: ctx.aspect, model: ctx.model, generated_at: new Date().toISOString(),
    explainer: { scenes, model: ctx.model, look: ctx.look, usage: extra.usage || null, cost_usd: extra.cost, seconds: extra.seconds ?? null, chapters: extra.chapters ?? null },
    hook_text: clean(scenes[0]?.heading, 40),
    brief: { subject: clean(idea.video_title || idea.title, 200), kind: "explainer", feeling: "", voice_style: "natural", voice_gender: "any",
      music_mood: ["calm", "dark", "epic", "sad", "happy", "funny", "love", "horror", "none"].includes(meta.music_mood) ? meta.music_mood : "calm", music_words: [], thumbnail_style: "dark" },
    previous: idea.script?.trim() ? { script: idea.script, video_title: idea.video_title, video_description: idea.video_description, video_tags: idea.video_tags,
      search_terms: idea.search_terms, ai: idea.ai ? { ...idea.ai, previous: undefined } : null } : null,
  };
  const stage = ["new", "shortlisted", "assigned"].includes(idea.stage) ? "scripted" : idea.stage;
  const { error } = await db.from("ideas").update({
    script, video_title: clean(meta.title, 100) || idea.title,
    video_description: [clean(meta.description, 2000), hashtags.join(" ")].filter(Boolean).join("\n\n"),
    video_tags: (meta.tags || []).map((t: string) => clean(t, 60)).filter(Boolean).slice(0, 15), search_terms: [],
    ai, ai_status: "ready", ai_error: null, stage,
  }).eq("id", idea.id);
  if (error) throw error;
  return { ok: true, scenes: scenes.length, words: script.split(/\s+/).length - scenes.length, model: ctx.model, cost_usd: extra.cost };
}

/** The idea, its network and the choices, read the same way by every action. */
async function context(db: any, body: any) {
  const ideaId = UUID.test(body.idea_id || "") ? body.idea_id : "";
  if (!ideaId) throw new Fail("idea_id required", 400);
  const { data: idea } = await db.from("ideas").select("*").eq("id", ideaId).single();
  if (!idea) throw new Fail("idea not found", 404);
  const channelId = UUID.test(body.channel_id || "") ? body.channel_id : idea.channel_id;
  if (!channelId) throw new Fail("Pick a network first, so the video uses the right language.", 400);
  const { data: channel } = await db.from("channels").select("*").eq("id", channelId).single();
  const { data: niche } = channel?.niche_id ? await db.from("niches").select("*").eq("id", channel.niche_id).single() : { data: null };
  const aspect = body.aspect === "16:9" ? "16:9" : "9:16";
  let length = Object.hasOwn(LENGTHS, body.length || "") ? body.length : "short45";
  // a Short stays a Short: 3 minutes at most, so the long lengths are for 16:9 only
  if (aspect === "9:16" && !length.startsWith("short")) length = "short120";
  return {
    idea, channel, niche, channelId, aspect, length,
    language: /^[a-z]{2}$/.test(body.language || "") ? body.language : String(channel?.video_style?.language || channel?.language || "en").toLowerCase(),
    model: Object.hasOwn(MODELS, body.model || "") ? body.model : "claude-opus-5-5",
    effort: ["low", "medium", "high"].includes(body.effort) ? body.effort : null,
    look: Object.hasOwn(LOOKS, body.look || "") ? body.look : "glow",
    angle: body.angle ? clean(body.angle, 300) : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(URL_, SERVICE);
  let ideaId = "";
  try {
    const cron = req.headers.get("x-cron-secret");
    const isService = !!cron && cron === (await db.rpc("get_cron_secret")).data;
    const userDb = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    if (!isService && !(await userDb.rpc("am_i_allowed")).data) return json({ error: "not allowed" }, 403);
    const user = isService ? null : (await userDb.auth.getUser()).data.user;
    const ownerId = user?.id ?? null;
    const body = await req.json();

    if (body.action === "start") {
      if (isService) return json({ error: "not allowed" }, 403);
      const id = UUID.test(body.idea_id || "") ? body.idea_id : "";
      const { data: idea } = id ? await db.from("ideas").select("id,channel_id,script").eq("id", id).single() : { data: null };
      if (!idea) return json({ error: "idea not found" }, 404);
      const channelId = UUID.test(body.channel_id || "") ? body.channel_id : idea.channel_id;
      if (!channelId) return json({ error: "Pick a network first, so the video uses the right language and accounts." }, 400);
      const { data: active } = await db.from("video_runs").select("id").eq("idea_id", id).in("status", ["queued", "running"]).limit(1);
      if (active?.length) return json({ run_id: active[0].id, already: true });
      if (!KEY) return json({ error: "Claude isn't set up yet: add ANTHROPIC_API_KEY in Supabase Edge Function secrets." }, 503);
      if (!GH_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(GH_REPO)) return json({ error: "Add GITHUB_TOKEN and GITHUB_REPO in Supabase Edge Function secrets." }, 503);
      const o = body.options && typeof body.options === "object" ? body.options : {};
      const aspect = o.aspect === "16:9" ? "16:9" : "9:16";
      let length = Object.hasOwn(LENGTHS, o.length || "") ? o.length : null;
      if (length && aspect === "9:16" && !length.startsWith("short")) length = "short120";
      // same options as ai's auto_start, plus the style and the model
      const options = {
        language: /^[a-z]{2}$/.test(o.language || "") ? o.language : null, aspect, length,
        angle: o.angle ? clean(o.angle, 300) : null,
        voice: o.voice ? clean(o.voice, 60) : null, voice_style: VOICE_STYLES.has(o.voice_style) ? o.voice_style : null,
        music: o.music !== false, sounds: false, keep_script: !!o.keep_script && !!idea.script?.trim(),
        publish: o.publish === "next" ? "next" : "ask",
        video_style: "explainer", ai_model: Object.hasOwn(MODELS, o.ai_model || "") ? o.ai_model : "claude-opus-5-5",
        look: Object.hasOwn(LOOKS, o.look || "") ? o.look : "glow",
      };
      await db.from("ideas").update({ channel_id: channelId }).eq("id", id);
      const { data: run, error } = await db.from("video_runs").insert({ idea_id: id, channel_id: channelId, options, owner_id: ownerId }).select().single();
      if (error) throw error;
      const r = await fetch(`https://api.github.com/repos/${GH_REPO}/actions/workflows/autovideo.yml/dispatches`, {
        method: "POST",
        headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "youtube-control" },
        body: JSON.stringify({ ref: "main", inputs: { run_id: run.id } }),
      });
      if (!r.ok) {
        const msg = `GitHub dispatch failed (${r.status}): ${(await r.text()).slice(0, 300)}`;
        await db.from("video_runs").update({ status: "failed", error: msg }).eq("id", run.id);
        return json({ error: msg }, 503);
      }
      return json({ run_id: run.id });
    }

    if (!["plan", "outline", "chapter", "assemble"].includes(body.action)) return json({ error: "unknown action" }, 400);
    if (body.action === "assemble" && !isService) return json({ error: "not allowed" }, 403);
    if (!KEY) return json({ error: "Claude isn't set up yet: add ANTHROPIC_API_KEY in Supabase Edge Function secrets." }, 503);
    const ctx = await context(db, body);
    ideaId = ctx.idea.id;
    const base = userPrompt(ctx.idea, ctx.channel, ctx.niche, ctx.angle);

    if (body.action === "plan") {
      await db.from("ideas").update({ ai_status: "writing", ai_error: null, channel_id: ctx.channelId }).eq("id", ideaId);
      const r = await ask(db, ctx, "explainer", Plan, system(ctx.language, ctx.length, ctx.look, ctx.aspect), base, ownerId);
      return json(await savePlan(db, ctx, r.out, cleanScenes(r.out.scenes), { cost: r.cost, usage: r.usage, seconds: r.seconds }));
    }
    if (!LENGTHS[ctx.length].chapters) return json({ error: `${ctx.length} is written in one go: use "plan".` }, 400);
    if (body.action === "outline") {
      await db.from("ideas").update({ ai_status: "writing", ai_error: null, channel_id: ctx.channelId }).eq("id", ideaId);
      const r = await ask(db, ctx, "explainer_outline", Outline, outlineSystem(ctx.language, ctx.length, ctx.aspect), base, ownerId);
      const chapters = (r.out.chapters || []).slice(0, LENGTHS[ctx.length].chapters! + 1);
      if (!chapters.length) throw new Fail("Claude returned no chapters", 502);
      return json({ outline: { ...r.out, chapters }, cost_usd: r.cost, usage: r.usage, seconds: r.seconds });
    }
    const outline = body.outline && typeof body.outline === "object" && Array.isArray(body.outline.chapters) ? body.outline : null;
    if (!outline) return json({ error: "outline required" }, 400);
    if (body.action === "chapter") {
      const index = Math.round(Number(body.index));
      if (!(index >= 0 && index < outline.chapters.length)) return json({ error: "index out of range" }, 400);
      const r = await ask(db, ctx, "explainer_chapter", Chapter, chapterSystem(ctx.language, ctx.length, ctx.look, ctx.aspect, index, outline.chapters.length),
        chapterUser(base, outline, index), ownerId);
      return json({ scenes: cleanScenes(r.out.scenes), cost_usd: r.cost, usage: r.usage, seconds: r.seconds });
    }
    // assemble: the chapters in order, as one video
    const scenes = cleanScenes((Array.isArray(body.chapters) ? body.chapters : []).flat());
    return json(await savePlan(db, ctx, outline, scenes, { cost: Math.round((Number(body.cost_usd) || 0) * 10000) / 10000, chapters: outline.chapters.length }));
  } catch (e) {
    const f = e instanceof Fail ? e : null;
    const msg = String((e as Error).message || e).slice(0, 500);
    if (ideaId && (!f || f.status >= 500)) await db.from("ideas").update({ ai_status: "error", ai_error: msg }).eq("id", ideaId);
    return json({ error: msg, ...(f?.extra || {}) }, f?.status || 500);
  }
});
