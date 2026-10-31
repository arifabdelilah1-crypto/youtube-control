// Script assistant: idea + its keyword data in, a ready Studio script out (TITLE / VO / FOOTAGE / CARD blocks),
// plus alternative hooks and titles, description, tags and the facts to verify.
// POST {idea_id, channel_id?, language?, length?: "short45"|"short60"|"long3", notes?, draft?}
// Secrets: ANTHROPIC_API_KEY (required); SCRIPT_MODEL (default claude-opus-5-5), SCRIPT_DAILY_LIMIT (default 40).
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { type Context, type LengthKey, LENGTHS, ScriptError, readMessage, requestParams } from "./assistant.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = Deno.env.get("SCRIPT_MODEL") || "claude-opus-5-5";
const DAILY_LIMIT = Number(Deno.env.get("SCRIPT_DAILY_LIMIT") || 40);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f-]{36}$/;
// Edge functions stop at 150 s: give up on Claude a little before that, and retry at most once.
const client = new Anthropic({ apiKey: API_KEY, maxRetries: 1, timeout: 135_000 });

// deno-lint-ignore no-explicit-any
async function loadContext(db: any, body: any): Promise<Context> {
  const { data: idea } = await db.from("ideas").select("*").eq("id", body.idea_id).maybeSingle();
  if (!idea) throw Object.assign(new Error("Idea not found."), { status: 404 });
  const channelId = UUID.test(body.channel_id || "") ? body.channel_id : idea.channel_id;
  const channel = channelId ? (await db.from("channels").select("id,title,markets,niche_id,language").eq("id", channelId).maybeSingle()).data : null;
  const nicheId = channel?.niche_id || idea.niche_id;
  const niche = nicheId ? (await db.from("niches").select("id,name").eq("id", nicheId).maybeSingle()).data : null;
  const length: LengthKey = body.length in LENGTHS ? body.length : "short45";
  const ctx: Context = {
    idea: { title: idea.title, video_title: idea.video_title }, channel, niche, length,
    language: /^[a-z]{2}$/.test(body.language || "") ? body.language : channel?.language || "en",
    notes: String(body.notes || "").slice(0, 600), draft: String(body.draft || "").slice(0, 6000),
  };

  // The keyword the idea was saved from: its metrics, related searches and the titles ranking for it.
  // deno-lint-ignore no-explicit-any
  const sources: any[] = Array.isArray(idea.sources) ? idea.sources : [];
  const kw = sources.find((s) => s?.type === "keyword" && s.ref);
  const term = String(kw?.ref || (idea.title || "")).toLowerCase().trim();
  let q = db.from("v_keyword_metrics").select("keyword_id,term,market,volume_index,difficulty,kw_score,views_per_day,median_subs_top,outlier_count").eq("term", term);
  if (kw?.market) q = q.eq("market", kw.market);
  const keyword = (await q.order("captured_on", { ascending: false }).limit(1)).data?.[0] || null;
  if (keyword) {
    ctx.keyword = keyword;
    const [rel, links] = await Promise.all([
      db.from("keyword_related").select("term,source,rank").eq("keyword_id", keyword.keyword_id).order("rank").limit(40),
      db.from("video_keywords").select("youtube_video_id,rank").eq("keyword_id", keyword.keyword_id).order("rank").limit(8),
    ]);
    ctx.related = [...new Set((rel.data || []).map((r: { term: string }) => r.term))] as string[];
    const ids = (links.data || []).map((l: { youtube_video_id: string }) => l.youtube_video_id);
    if (ids.length) ctx.page1 = ((await db.from("v_video_latest").select("youtube_video_id,title,views,subscribers").in("youtube_video_id", ids)).data || [])
      // deno-lint-ignore no-explicit-any
      .sort((a: any, b: any) => ids.indexOf(a.youtube_video_id) - ids.indexOf(b.youtube_video_id));
  }
  const outlier = sources.find((s) => s?.type === "outlier" && s.ref);
  if (outlier) ctx.inspiration = (await db.from("v_video_latest").select("title,views,subscribers").eq("youtube_video_id", outlier.ref).maybeSingle()).data;
  if (niche) ctx.nicheOutliers = (await db.from("v_video_latest").select("title,outlier_score,is_short").eq("niche_id", niche.id)
    .gte("outlier_score", 3).lte("subscribers", 100000).order("outlier_score", { ascending: false }).limit(8)).data || [];
  if (channel) ctx.channelHits = (await db.from("v_own_video_latest").select("title,views,vs_baseline").eq("channel_id", channel.id)
    .order("vs_baseline", { ascending: false, nullsFirst: false }).limit(5)).data || [];
  return ctx;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(URL_, SERVICE);
    const userDb = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    if (!(await userDb.rpc("am_i_allowed")).data) return json({ error: "not allowed" }, 403);
    if (!API_KEY) return json({ error: "The script assistant isn't set up: add ANTHROPIC_API_KEY in Supabase → Edge Functions → Secrets." }, 503);
    const body = await req.json();
    if (!UUID.test(body.idea_id || "")) return json({ error: "idea_id required" }, 400);

    const today = new Date().toISOString().slice(0, 10);
    const { data: used } = await db.from("api_quota_daily").select("units").eq("day", today).eq("api", "anthropic").eq("bucket", "script_runs");
    const runs = (used || []).reduce((a: number, r: { units: number }) => a + Number(r.units || 0), 0);
    if (runs >= DAILY_LIMIT) return json({ error: `Daily limit reached (${DAILY_LIMIT} scripts). It resets at midnight UTC; change SCRIPT_DAILY_LIMIT to allow more.` }, 429);

    const ctx = await loadContext(db, body);
    // deno-lint-ignore no-explicit-any
    const msg = await client.beta.messages.stream(requestParams(ctx, MODEL) as any).finalMessage();
    await db.rpc("add_quota", { p_api: "anthropic", p_bucket: "script_runs", p_niche_key: "all", p_units: 1 });
    await db.rpc("add_quota", { p_api: "anthropic", p_bucket: "script_tokens", p_niche_key: "all", p_units: (msg.usage.input_tokens || 0) + (msg.usage.output_tokens || 0) });
    // deno-lint-ignore no-explicit-any
    return json(readMessage(msg as any));
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err instanceof ScriptError) return json({ error: err.message }, err.status);
    if (err instanceof Anthropic.AuthenticationError) return json({ error: "ANTHROPIC_API_KEY was rejected. Check the key in Supabase → Edge Functions → Secrets." }, 503);
    if (err instanceof Anthropic.RateLimitError) return json({ error: "Claude's rate limit was hit. Try again in a minute." }, 429);
    if (err instanceof Anthropic.APIConnectionTimeoutError) return json({ error: "Claude took too long. Try again, or choose a shorter length." }, 504);
    if (err instanceof Anthropic.APIError) return json({ error: `Claude API error ${err.status ?? ""}: ${err.message}`.slice(0, 400) }, 502);
    return json({ error: String(err.message || e) }, err.status || 500);
  }
});
