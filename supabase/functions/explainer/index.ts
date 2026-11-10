// Explainer style: Claude writes the voice-over AND the drawing of every scene (layout, pictograms, labels, cue words).
// POST {action:"plan", idea_id, channel_id?, language?, length?, angle?, model?, effort?, look?}
//   -> saves ideas.script (one "VO:" line per scene), title, description, tags, and ideas.ai.explainer {scenes} + the cost.
//   model: claude-opus-5-5 (default) | claude-fable-5-2 | claude-sonnet-5-5. effort: low | medium | high (default: the model's own).
// POST {action:"start", idea_id, channel_id?, options} -> starts "Generate video" (render/autovideo.mjs) as an Explainer video,
//   like ai's auto_start, with options.video_style = "explainer", options.ai_model, options.look (glow | whiteboard | kinetic),
//   options.aspect 9:16 (Short, the default) or 16:9 (YouTube video), and no sound effects. Returns {run_id}. Started from the
//   Animation page. "plan" takes the same aspect.
// "plan" is called by the "Generate video" job (x-cron-secret) or by a signed-in team member; "start" by a team member.
// Secrets: ANTHROPIC_API_KEY, GITHUB_TOKEN, GITHUB_REPO.
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@1.8.0/helpers/zod";
import { ICON_NAMES } from "./icons.ts";
import { LENGTHS, LOOKS, MODELS, Plan, clean, system, userPrompt } from "./plan.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(URL_, SERVICE);
  try {
    const cron = req.headers.get("x-cron-secret");
    const isService = !!cron && cron === (await db.rpc("get_cron_secret")).data;
    const userDb = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    if (!isService && !(await userDb.rpc("am_i_allowed")).data) return json({ error: "not allowed" }, 403);
    const user = isService ? null : (await userDb.auth.getUser()).data.user;
    const body = await req.json();
    if (body.action === "start") {
      if (isService) return json({ error: "not allowed" }, 403);
      const ideaId = UUID.test(body.idea_id || "") ? body.idea_id : "";
      const { data: idea } = ideaId ? await db.from("ideas").select("id,channel_id,script").eq("id", ideaId).single() : { data: null };
      if (!idea) return json({ error: "idea not found" }, 404);
      const channelId = UUID.test(body.channel_id || "") ? body.channel_id : idea.channel_id;
      if (!channelId) return json({ error: "Pick a network first, so the video uses the right language and accounts." }, 400);
      const { data: active } = await db.from("video_runs").select("id").eq("idea_id", ideaId).in("status", ["queued", "running"]).limit(1);
      if (active?.length) return json({ run_id: active[0].id, already: true });
      if (!KEY) return json({ error: "Claude isn't set up yet: add ANTHROPIC_API_KEY in Supabase Edge Function secrets." }, 503);
      if (!GH_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(GH_REPO)) return json({ error: "Add GITHUB_TOKEN and GITHUB_REPO in Supabase Edge Function secrets." }, 503);
      const o = body.options && typeof body.options === "object" ? body.options : {};
      // same options as ai's auto_start, plus the style and the model
      const options = {
        language: /^[a-z]{2}$/.test(o.language || "") ? o.language : null, aspect: o.aspect === "16:9" ? "16:9" : "9:16",
        length: Object.hasOwn(LENGTHS, o.length || "") ? o.length : null,
        angle: o.angle ? clean(o.angle, 300) : null,
        voice: o.voice ? clean(o.voice, 60) : null, voice_style: VOICE_STYLES.has(o.voice_style) ? o.voice_style : null,
        music: o.music !== false, sounds: false, keep_script: !!o.keep_script && !!idea.script?.trim(),
        publish: o.publish === "next" ? "next" : "ask",
        video_style: "explainer", ai_model: Object.hasOwn(MODELS, o.ai_model || "") ? o.ai_model : "claude-opus-5-5",
        look: Object.hasOwn(LOOKS, o.look || "") ? o.look : "glow",
      };
      await db.from("ideas").update({ channel_id: channelId }).eq("id", ideaId);
      const { data: run, error } = await db.from("video_runs").insert({ idea_id: ideaId, channel_id: channelId, options, owner_id: user?.id ?? null }).select().single();
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
    if (body.action !== "plan") return json({ error: "unknown action" }, 400);
    if (!KEY) return json({ error: "Claude isn't set up yet: add ANTHROPIC_API_KEY in Supabase Edge Function secrets." }, 503);
    const ideaId = UUID.test(body.idea_id || "") ? body.idea_id : "";
    if (!ideaId) return json({ error: "idea_id required" }, 400);
    const { data: idea } = await db.from("ideas").select("*").eq("id", ideaId).single();
    if (!idea) return json({ error: "idea not found" }, 404);
    const channelId = UUID.test(body.channel_id || "") ? body.channel_id : idea.channel_id;
    if (!channelId) return json({ error: "Pick a network first, so the video uses the right language." }, 400);
    const { data: channel } = await db.from("channels").select("*").eq("id", channelId).single();
    const { data: niche } = channel?.niche_id ? await db.from("niches").select("*").eq("id", channel.niche_id).single() : { data: null };
    const language = /^[a-z]{2}$/.test(body.language || "") ? body.language : String(channel?.video_style?.language || channel?.language || "en").toLowerCase();
    const length = Object.hasOwn(LENGTHS, body.length || "") ? body.length : "short45";
    const model = Object.hasOwn(MODELS, body.model || "") ? body.model : "claude-opus-5-5";
    const effort = ["low", "medium", "high"].includes(body.effort) ? body.effort : null;
    const look = Object.hasOwn(LOOKS, body.look || "") ? body.look : "glow";
    const aspect = body.aspect === "16:9" ? "16:9" : "9:16";

    const since = new Date(Date.now() - 864e5).toISOString();
    const { count } = await db.from("ai_runs").select("id", { count: "exact", head: true }).gte("created_at", since);
    if ((count ?? 0) >= DAILY_RUNS) return json({ error: `Daily AI limit reached (${DAILY_RUNS} runs in 24 h).` }, 429);

    await db.from("ideas").update({ ai_status: "writing", ai_error: null, channel_id: channelId }).eq("id", ideaId);
    const client = new Anthropic({ apiKey: KEY, maxRetries: 1, timeout: LIMIT_MS });
    const started = Date.now();
    let res;
    try {
      res = await client.messages.parse({
        model, max_tokens: 16000,
        system: system(language, length, look, aspect),
        messages: [{ role: "user", content: userPrompt(idea, channel, niche, body.angle ? clean(body.angle, 300) : null) }],
        output_config: { format: zodOutputFormat(Plan), ...(effort ? { effort } : {}) },
      });
    } catch (e) {
      const slow = Date.now() - started > LIMIT_MS - 5000 || /timed? ?out/i.test(String((e as Error).message));
      const msg = slow ? `${MODELS[model].label} took too long` : `Claude: ${String((e as Error).message || e).slice(0, 300)}`;
      await db.from("ideas").update({ ai_status: "error", ai_error: msg }).eq("id", ideaId);
      return json({ error: msg, slow }, slow ? 504 : 502);
    }
    const u = res.usage;
    const [pin, pout] = MODELS[model].price;
    const cost = Math.round(((u.input_tokens * pin + u.output_tokens * pout) / 1e6) * 10000) / 10000;
    await db.from("ai_runs").insert({ idea_id: ideaId, kind: "explainer", model, owner_id: user?.id ?? null,
      prompt_tokens: u.input_tokens, completion_tokens: u.output_tokens, ok: !!res.parsed_output });
    const plan = res.parsed_output;
    if (!plan?.scenes?.length) {
      const msg = res.stop_reason === "max_tokens" ? "Claude ran out of room before finishing the plan" : "Claude returned no scenes";
      await db.from("ideas").update({ ai_status: "error", ai_error: msg }).eq("id", ideaId);
      return json({ error: msg }, 502);
    }

    const icons = new Set(ICON_NAMES);
    const scenes = plan.scenes.map((s) => ({
      ...s,
      narration: clean(s.narration, 600).replace(/^(TITLE|VO|VOICE|FOOTAGE|CARD)\s*:\s*/i, ""),
      heading: clean(s.heading, 80), number_prefix: clean(s.number_prefix, 4), number_suffix: clean(s.number_suffix, 6),
      items: s.items.slice(0, 4).map((it) => ({ ...it, label: clean(it.label, 40), cue: clean(it.cue, 40),
        icon: it.kind === "icon" ? (icons.has(it.icon) ? it.icon : "sparkles") : "", count: Math.max(1, Math.min(6, it.count || 1)) })),
    })).filter((s) => s.narration);
    const script = scenes.map((s) => `VO: ${s.narration}`).join("\n\n");
    const hashtags = plan.hashtags.map((t) => "#" + clean(t, 40).replace(/^#/, "").replace(/\s+/g, "")).filter((t) => t.length > 1).slice(0, 3);
    const ai = {
      style: "explainer", language, length, aspect, model, generated_at: new Date().toISOString(),
      explainer: { scenes, model, look, usage: u, cost_usd: cost, seconds: Math.round((Date.now() - started) / 1000) },
      hook_text: clean(scenes[0]?.heading, 40),
      brief: { subject: clean(idea.video_title || idea.title, 200), kind: "explainer", feeling: "", voice_style: "natural", voice_gender: "any",
        music_mood: plan.music_mood, music_words: [], thumbnail_style: "dark" },
      previous: idea.script?.trim() ? { script: idea.script, video_title: idea.video_title, video_description: idea.video_description, video_tags: idea.video_tags,
        search_terms: idea.search_terms, ai: idea.ai ? { ...idea.ai, previous: undefined } : null } : null,
    };
    const stage = ["new", "shortlisted", "assigned"].includes(idea.stage) ? "scripted" : idea.stage;
    const { error } = await db.from("ideas").update({
      script, video_title: clean(plan.title, 100) || idea.title,
      video_description: [clean(plan.description, 2000), hashtags.join(" ")].filter(Boolean).join("\n\n"),
      video_tags: plan.tags.map((t) => clean(t, 60)).filter(Boolean).slice(0, 15), search_terms: [],
      ai, ai_status: "ready", ai_error: null, stage,
    }).eq("id", ideaId);
    if (error) throw error;
    return json({ ok: true, scenes: scenes.length, words: script.split(/\s+/).length - scenes.length, model, cost_usd: cost, usage: u });
  } catch (e) {
    return json({ error: String((e as Error).message || e).slice(0, 500) }, 500);
  }
});
