// Outlier -> blueprint -> script, with DeepSeek.
// POST {action:"capture",   idea_id}                       -> snapshot of the outlier video (YouTube API, ~3 units)
// POST {action:"blueprint", idea_id}                       -> format analysis (DeepSeek)
// POST {action:"script",    idea_id, channel_id?, angle?, aspect?, length?, draft?} -> new or improved script in TITLE/VO/FOOTAGE/CARD format,
//      title, description, tags. Uses the research tables (keyword numbers, ranking titles, niche outliers, the channel's best videos).
//      length: short45 | short60 | long3 (default from the aspect). draft: the script to improve. ideas.ai.previous keeps the version it replaced.
// Secrets: DEEPSEEK_API_KEY (required), DEEPSEEK_MODEL (optional, default deepseek-chat), YOUTUBE_API_KEY
import { createClient } from "npm:@supabase/supabase-js@2";
import { BLUEPRINT_SYSTEM, LENGTHS, type LengthKey, SCRIPT_SYSTEM, blueprintUser, scriptUser } from "./prompts.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const YT_KEY = Deno.env.get("YOUTUBE_API_KEY") ?? "";
const DS_KEY = Deno.env.get("DEEPSEEK_API_KEY") ?? "";
const DS_MODEL = Deno.env.get("DEEPSEEK_MODEL") || "deepseek-chat";
const DAILY_RUNS = 200;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f-]{36}$/;

function isoSeconds(d?: string): number | null {
  const m = d?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  return (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+(m[3] || 0)) * 60 + (+(m[4] || 0));
}

async function deepseek(db: any, ideaId: string, kind: string, system: string, user: string, ownerId: string | null) {
  if (!DS_KEY) throw new Error("DeepSeek isn't set up yet: add DEEPSEEK_API_KEY in Supabase Edge Function secrets.");
  const since = new Date(Date.now() - 864e5).toISOString();
  const { count } = await db.from("ai_runs").select("id", { count: "exact", head: true }).gte("created_at", since);
  if ((count ?? 0) >= DAILY_RUNS) throw new Error(`Daily AI limit reached (${DAILY_RUNS} runs in 24 h).`);
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120_000);
    try {
      const r = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST", signal: ctrl.signal,
        headers: { Authorization: `Bearer ${DS_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: DS_MODEL, temperature: kind === "script" ? 0.9 : 0.4, max_tokens: 6000,
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
        }),
      });
      if (!r.ok) { lastErr = `DeepSeek ${r.status}: ${(await r.text()).slice(0, 300)}`; if (r.status < 500 && r.status !== 429) break; continue; }
      const data = await r.json();
      const text = data.choices?.[0]?.message?.content || "";
      await db.from("ai_runs").insert({ idea_id: ideaId, kind, model: data.model || DS_MODEL, owner_id: ownerId,
        prompt_tokens: data.usage?.prompt_tokens ?? null, completion_tokens: data.usage?.completion_tokens ?? null, ok: !!text });
      if (!text.trim()) { lastErr = "DeepSeek returned an empty answer"; continue; }
      return JSON.parse(text);
    } catch (e) {
      lastErr = (e as Error).name === "AbortError" ? "DeepSeek took too long (2 min)" : String((e as Error).message || e);
    } finally { clearTimeout(timer); }
  }
  throw new Error(lastErr || "DeepSeek failed");
}

// ---------- script JSON -> editor script text ----------
const clean = (s: unknown, n = 200) => String(s ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, n);
const term = (s: unknown) => clean(s, 80).replace(/[|;,[\]]/g, " ").replace(/\s+/g, " ").trim();
const HEX = /^#[0-9A-Fa-f]{6}$/;
// a voice line never keeps a block label or [footage words]: they would be read aloud (likelier when improving a draft that has them)
const voice = (s: unknown) => clean(s, 600).replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").replace(/\s+([.,!?…])/g, "$1")
  .replace(/^(TITLE|VO|VOICE|FOOTAGE|CARD)\s*:\s*/i, "").trim();
export const voWords = (script: string) => script.split("\n").filter((l) => l.startsWith("VO: ")).map((l) => l.slice(4)).join(" ").split(/\s+/).filter(Boolean).length;
export function toScript(scenes: any[]): string {
  return (scenes || []).map((s) => {
    const lines: string[] = [];
    const title = clean(s.title, 40).replace(/^(TITLE|VO|FOOTAGE|CARD)\s*:/i, "");
    if (title) lines.push(`TITLE: ${title}`);
    lines.push(`VO: ${voice(s.vo)}`);
    const foot = (Array.isArray(s.footage) ? s.footage : []).slice(0, 3)
      .map((f: any) => ({ kind: f?.kind === "image" ? "image" : "video", q: term(f?.q) })).filter((f: any) => f.q);
    if (foot.length) lines.push(`FOOTAGE: ${foot.map((f: any) => `${f.kind}: ${f.q}`).join(" | ")}`);
    if (s.card?.name) {
      const colors = (Array.isArray(s.card.colors) ? s.card.colors : []).filter((c: string) => HEX.test(c)).slice(0, 2);
      lines.push(`CARD: ${clean(s.card.name, 40).replace(/[|#]/g, "")} | ${clean(s.card.stat, 30).replace(/[|#]/g, "")}${colors.length ? " | " + colors.join(" ") : ""}`);
    }
    return lines.join("\n");
  }).filter((b) => /VO: \S/.test(b)).join("\n\n");
}

// ---------- what the research tables know about this idea ----------
async function researchFor(db: any, idea: any, channel: any) {
  const out: any = {};
  const src = (idea.sources || []).find((s: any) => s.type === "keyword" && s.ref);
  const mainTerm = String(src?.ref || idea.source_video?.keyword || "").toLowerCase().trim();
  if (mainTerm) {
    let q = db.from("v_keyword_metrics").select("keyword_id,term,market,volume_index,difficulty,kw_score,views_per_day,median_subs_top,outlier_count").eq("term", mainTerm);
    if (src?.market) q = q.eq("market", src.market);
    const k = (await q.order("captured_on", { ascending: false }).limit(1)).data?.[0];
    if (k) {
      out.main_keyword = { term: k.term, market: k.market, demand_out_of_100: k.volume_index, difficulty_out_of_100: k.difficulty, score_out_of_100: k.kw_score,
        page1_views_per_day: k.views_per_day, typical_page1_channel_subs: k.median_subs_top, small_channels_beating_their_size: k.outlier_count };
      const [rel, links] = await Promise.all([
        db.from("keyword_related").select("term").eq("keyword_id", k.keyword_id).order("rank").limit(40),
        db.from("video_keywords").select("youtube_video_id").eq("keyword_id", k.keyword_id).order("rank").limit(8),
      ]);
      out.related_searches = [...new Set((rel.data || []).map((r: any) => r.term))].slice(0, 25);
      const ids = (links.data || []).map((l: any) => l.youtube_video_id);
      if (ids.length) {
        const { data: videos } = await db.from("v_video_latest").select("youtube_video_id,title,views,subscribers").in("youtube_video_id", ids);
        out.ranking_titles = (videos || []).sort((a: any, b: any) => ids.indexOf(a.youtube_video_id) - ids.indexOf(b.youtube_video_id))
          .map((v: any) => ({ title: clean(v.title, 140), views: v.views, channel_subs: v.subscribers }));
      }
    }
  }
  const nicheId = channel?.niche_id || idea.niche_id;
  if (nicheId) {
    const { data } = await db.from("v_video_latest").select("title,outlier_score,is_short").eq("niche_id", nicheId)
      .gte("outlier_score", 3).lte("subscribers", 100000).order("outlier_score", { ascending: false }).limit(8);
    if (data?.length) out.what_works_in_niche = data.map((v: any) => ({ title: clean(v.title, 140), times_its_channel_size: v.outlier_score, is_short: v.is_short }));
  }
  if (channel?.id) {
    const { data } = await db.from("v_own_video_latest").select("title,views,vs_baseline").eq("channel_id", channel.id).order("vs_baseline", { ascending: false, nullsFirst: false }).limit(5);
    if (data?.length) out.channel_best_videos = data.map((v: any) => ({ title: clean(v.title, 140), views: v.views, times_channel_usual: v.vs_baseline }));
  }
  return Object.keys(out).length ? out : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(URL_, SERVICE);
  let ideaId = "";
  try {
    const userDb = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    if (!(await userDb.rpc("am_i_allowed")).data) return json({ error: "not allowed" }, 403);
    const { data: { user } } = await userDb.auth.getUser();
    const body = await req.json();
    ideaId = UUID.test(body.idea_id || "") ? body.idea_id : "";
    if (!ideaId) return json({ error: "idea_id required" }, 400);
    const { data: idea } = await db.from("ideas").select("*").eq("id", ideaId).single();
    if (!idea) return json({ error: "idea not found" }, 404);

    // ---------- capture ----------
    if (body.action === "capture") {
      const ref = (idea.sources || []).find((s: any) => s.type === "outlier")?.ref;
      if (!ref) return json({ ok: true, skipped: "not an outlier idea" });
      if (!YT_KEY) throw new Error("YOUTUBE_API_KEY is missing in Supabase secrets");
      await db.from("ideas").update({ ai_status: "capturing", ai_error: null }).eq("id", ideaId);
      const yt = async (endpoint: string, params: Record<string, string>) => {
        const r = await fetch(`https://www.googleapis.com/youtube/v3/${endpoint}?${new URLSearchParams({ ...params, key: YT_KEY })}`);
        await db.rpc("add_quota", { p_api: "youtube_data", p_bucket: "ai", p_niche_key: "ai", p_units: 1 });
        return r.ok ? r.json() : null;
      };
      const vid = (await yt("videos", { part: "snippet,contentDetails,statistics", id: ref }))?.items?.[0];
      if (!vid) throw new Error("The outlier video is no longer available on YouTube");
      const [comments, chan, latest, kw] = await Promise.all([
        yt("commentThreads", { part: "snippet", videoId: ref, order: "relevance", maxResults: "20", textFormat: "plainText" }),
        yt("channels", { part: "statistics", id: vid.snippet.channelId }),
        db.from("v_video_latest").select("outlier_score,views_per_hour,niche_id").eq("youtube_video_id", ref).maybeSingle(),
        db.from("video_keywords").select("rank, keywords(term)").eq("youtube_video_id", ref).order("rank").limit(1),
      ]);
      const duration = isoSeconds(vid.contentDetails?.duration);
      const views = Number(vid.statistics?.viewCount || 0);
      const ageDays = Math.max((Date.now() - new Date(vid.snippet.publishedAt).getTime()) / 864e5, 1);
      const source = {
        id: ref, url: `https://www.youtube.com/watch?v=${ref}`, title: vid.snippet.title, description: (vid.snippet.description || "").slice(0, 3000),
        tags: vid.snippet.tags || [], published_at: vid.snippet.publishedAt, channel_title: vid.snippet.channelTitle,
        channel_subscribers: Number(chan?.items?.[0]?.statistics?.subscriberCount || 0) || null,
        thumbnail: vid.snippet.thumbnails?.high?.url || vid.snippet.thumbnails?.default?.url || null,
        duration_s: duration, is_short: duration !== null && duration <= 180,
        views, likes: Number(vid.statistics?.likeCount || 0), comment_count: Number(vid.statistics?.commentCount || 0),
        views_per_day: Math.round(views / ageDays), outlier_score: latest.data?.outlier_score ?? null,
        keyword: (kw.data?.[0] as any)?.keywords?.term ?? null,
        top_comments: (comments?.items || []).map((c: any) => ({
          text: String(c.snippet?.topLevelComment?.snippet?.textDisplay || "").slice(0, 400),
          likes: c.snippet?.topLevelComment?.snippet?.likeCount || 0,
        })),
        captured_at: new Date().toISOString(),
      };
      await db.from("ideas").update({ source_video: source, ai_status: null }).eq("id", ideaId);
      return json({ ok: true, source });
    }

    // ---------- blueprint ----------
    if (body.action === "blueprint") {
      await db.from("ideas").update({ ai_status: "analyzing", ai_error: null }).eq("id", ideaId);
      const bp = await deepseek(db, ideaId, "blueprint", BLUEPRINT_SYSTEM, blueprintUser(idea.source_video || { title: idea.title }, idea.transcript), user?.id ?? null);
      await db.from("ideas").update({ blueprint: bp, ai_status: null }).eq("id", ideaId);
      return json({ ok: true, blueprint: bp });
    }

    // ---------- script ----------
    if (body.action === "script") {
      const channelId = UUID.test(body.channel_id || "") ? body.channel_id : idea.channel_id;
      if (!channelId) return json({ error: "Pick a channel first, so the script uses the right language and audience." }, 400);
      const { data: channel } = await db.from("channels").select("*").eq("id", channelId).single();
      const { data: niche } = channel?.niche_id ? await db.from("niches").select("*").eq("id", channel.niche_id).single() : { data: null };
      const language = channel?.video_style?.language || channel?.language || "en";
      const aspect = ["9:16", "16:9", "1:1"].includes(body.aspect) ? body.aspect : (idea.source_video?.is_short === false ? "16:9" : (channel?.video_style?.aspect || "9:16"));
      const length: LengthKey = Object.hasOwn(LENGTHS, body.length || "") ? body.length : (aspect === "16:9" ? "long3" : "short45");
      const draft = String(body.draft || "").trim().slice(0, 12000);
      // keywords: the outlier's keyword + its related searches + the idea's keyword sources
      const kwTerms: string[] = [];
      const kwRefs = (idea.sources || []).filter((s: any) => s.type === "keyword").map((s: any) => s.ref).filter(Boolean);
      if (idea.source_video?.keyword) kwTerms.push(idea.source_video.keyword);
      kwTerms.push(...kwRefs);
      if (kwTerms.length) {
        const { data: kws } = await db.from("keywords").select("id").in("term", kwTerms.slice(0, 5));
        if (kws?.length) {
          const { data: rel } = await db.from("keyword_related").select("term").in("keyword_id", kws.map((k: any) => k.id)).in("source", ["autocomplete", "question"]).limit(15);
          kwTerms.push(...(rel || []).map((r: any) => r.term));
        }
      }
      await db.from("ideas").update({ ai_status: "writing", ai_error: null, channel_id: channelId }).eq("id", ideaId);
      const research = await researchFor(db, idea, channel).catch(() => null); // useful, not essential: never blocks the script
      const prompt = scriptUser({ idea, blueprint: idea.blueprint, channel, niche, language, aspect, length, draft, research,
        angle: body.angle ? clean(body.angle, 300) : null, keywords: [...new Set(kwTerms)] });
      let out = await deepseek(db, ideaId, "script", SCRIPT_SYSTEM, prompt, user?.id ?? null);
      let script = toScript(out.scenes);
      if (!script) throw new Error("DeepSeek returned no scenes. Try again.");
      // Models tend to stop well short of a long target: ask once more, saying how far off it was, and keep the longer answer.
      const L = LENGTHS[length];
      if (voWords(script) < L.min * 0.75) {
        const again = await deepseek(db, ideaId, "script", SCRIPT_SYSTEM,
          `${prompt}\n\nYour last attempt had only ${voWords(script)} words of voice-over. That is far too short: write the full ${L.words} words in ${L.scenes} scenes.`,
          user?.id ?? null).catch(() => null);
        const longer = again ? toScript(again.scenes) : "";
        if (voWords(longer) > voWords(script)) { out = again; script = longer; }
      }
      const hashtags = (Array.isArray(out.hashtags) ? out.hashtags : []).map((t: string) => "#" + String(t).replace(/^#/, "").replace(/\s+/g, "")).slice(0, 3);
      const description = [clean(out.description, 4000).replace(/ {2,}/g, " "), hashtags.join(" ")].filter(Boolean).join("\n\n");
      const ai = {
        title_options: (out.title_options || []).map((t: string) => clean(t, 100)).slice(0, 3),
        hook_text: clean(out.hook_text, 40), music_mood: clean(out.music_mood, 20).toLowerCase(),
        verify: (out.verify || []).map((v: string) => clean(v, 240)).slice(0, 15), notes: clean(out.notes, 400),
        aspect, language, length, model: DS_MODEL, generated_at: new Date().toISOString(),
        // the version this replaces, so the Studio page can go back to it
        previous: idea.script?.trim() ? { script: idea.script, video_title: idea.video_title, video_description: idea.video_description, video_tags: idea.video_tags, search_terms: idea.search_terms,
          ai: idea.ai ? { ...idea.ai, previous: undefined } : null } : null,
      };
      const stage = ["new", "shortlisted", "assigned"].includes(idea.stage) ? "scripted" : idea.stage;
      await db.from("ideas").update({
        script, video_title: clean(out.title, 100) || idea.title, video_description: description,
        video_tags: (out.tags || []).map((t: string) => clean(t, 60)).filter(Boolean).slice(0, 20),
        search_terms: (out.default_terms || []).map((t: string) => term(t)).filter(Boolean).slice(0, 6),
        ai, ai_status: "ready", ai_error: null, stage,
      }).eq("id", ideaId);
      return json({ ok: true, script, ai });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    const msg = String((e as Error).message || e);
    if (ideaId) await db.from("ideas").update({ ai_status: "failed", ai_error: msg.slice(0, 1000) }).eq("id", ideaId);
    return json({ error: msg }, 500);
  }
});
