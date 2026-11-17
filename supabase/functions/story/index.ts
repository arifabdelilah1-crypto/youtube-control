// Story stick videos (render/story.mjs): Claude writes a second-person story and draws its film in code.
//   POST {action:"start", idea_id, channel_id?, options}  (team member, or x-cron-secret) -> starts "Generate video" with options.video_style = "story",
//        options.look (noir | paper | pop), options.ai_model, options.aspect (9:16 | 16:9), options.length (short30 | short45 | short60, or long5 |
//        long8: a 16:9 episode in chapters), options.film_model (long: the model drawing the chapters), options.mascot (yassine | karim | sami).
//        Returns {run_id}.
//   POST {action:"key"}                                    ("Generate video" job, x-cron-secret) -> {key}: the Claude key for the film,
//        which takes longer to write than a function may run.
// Secrets: ANTHROPIC_API_KEY, GITHUB_TOKEN, GITHUB_REPO.
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GH_TOKEN = Deno.env.get("GITHUB_TOKEN") ?? "";
const GH_REPO = Deno.env.get("GITHUB_REPO") ?? "";
const LOOKS = new Set(["noir", "paper", "pop"]);
const MODELS = new Set(["claude-opus-5-5", "claude-fable-5-2", "claude-sonnet-5-5"]);
const LENGTHS = new Set(["short30", "short45", "short60", "long5", "long8"]);
const MASCOTS = new Set(["yassine", "karim", "sami"]);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f-]{36}$/;
const clean = (s: unknown, n: number) => String(s ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
const db = createClient(URL_, SERVICE);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const cron = req.headers.get("x-cron-secret");
    const isService = !!cron && cron === (await db.rpc("get_cron_secret")).data;

    if (body.action === "key") {
      if (!isService) return json({ error: "not allowed" }, 403);
      if (!KEY) return json({ error: "Claude isn't set up yet: add ANTHROPIC_API_KEY in Supabase Edge Function secrets." }, 503);
      return json({ key: KEY });
    }

    // a team member, or Claude's own jobs and tests with the cron secret
    let user: any = null;
    if (!isService) {
      const userDb = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
      const [{ data: allowed }, { data: u }] = await Promise.all([userDb.rpc("am_i_allowed"), userDb.auth.getUser()]);
      if (!allowed || !u?.user) return json({ error: "not allowed" }, 403);
      user = u.user;
    }

    if (body.action === "start") {
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
      const options = {
        // a long video (long5 | long8) is a 16:9 YouTube video, written in chapters (render/story.mjs)
        language: /^[a-z]{2}$/.test(o.language || "") ? o.language : null, aspect: o.aspect === "16:9" || String(o.length || "").startsWith("long") ? "16:9" : "9:16",
        length: LENGTHS.has(o.length) ? o.length : "short45", angle: o.angle ? clean(o.angle, 300) : null,
        film_model: MODELS.has(o.film_model) ? o.film_model : null, mascot: MASCOTS.has(o.mascot) ? o.mascot : null,
        voice: o.voice ? clean(o.voice, 60) : null, voice_style: ["natural", "dark", "deep"].includes(o.voice_style) ? o.voice_style : null,
        music: o.music === true, sounds: false, keep_script: !!o.keep_script && !!idea.script?.trim(), publish: o.publish === "next" ? "next" : "ask",
        video_style: "story", ai_model: MODELS.has(o.ai_model) ? o.ai_model : "claude-opus-5-5", look: LOOKS.has(o.look) ? o.look : "noir",
      };
      await db.from("ideas").update({ channel_id: channelId }).eq("id", id);
      const { data: run, error } = await db.from("video_runs").insert({ idea_id: id, channel_id: channelId, options, owner_id: user?.id ?? null }).select().single();
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
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
