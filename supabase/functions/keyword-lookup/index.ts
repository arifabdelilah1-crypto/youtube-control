// Keyword analysis for the dashboard (vidIQ-style keyword page).
// POST {term, market?, language?, niche_id?, force?}
//   niche_id omitted or "global" -> free exploration scope.
// Does ONE YouTube search (page 1 by relevance, ~102 units), then scores volume/difficulty,
// stores page-1 videos, and collects related keywords from autocomplete (free).
// Cached per keyword per day unless force=true.
import { createClient } from "npm:@supabase/supabase-js@2";
import { scorePage, topTags } from "./metrics.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const YT_KEY = Deno.env.get("YOUTUBE_API_KEY")!;
const CAP = 9500;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function isoSeconds(d?: string): number | null {
  const m = d?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  return (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+(m[3] || 0)) * 60 + (+(m[4] || 0));
}
async function suggest(q: string, yt: boolean, hl: string, gl?: string): Promise<string[]> {
  const p = new URLSearchParams({ client: "firefox", q, hl });
  if (yt) p.set("ds", "yt");
  if (gl && gl !== "GLOBAL") p.set("gl", gl);
  try {
    const r = await fetch(`https://suggestqueries.google.com/complete/search?${p}`);
    const data = JSON.parse(new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(await r.arrayBuffer())));
    return (data[1] as string[]).map((s) => s.trim().toLowerCase()).slice(0, 10);
  } catch { return []; }
}
const prefixOf = (t: string) => {
  const w = t.split(" ");
  return w.length === 1 ? t.slice(0, Math.max(3, Math.floor(t.length / 2))) : `${w.slice(0, -1).join(" ")} ${w.at(-1)![0]}`;
};
const QUESTIONS: Record<string, string[]> = {
  en: ["how", "why", "what", "is", "can", "best"],
  fr: ["comment", "pourquoi", "quel", "est ce que", "meilleur"],
  es: ["como", "por que", "que", "mejor"],
  de: ["wie", "warum", "was", "beste"],
  ar: ["كيف", "لماذا", "ما هو", "افضل"],
  it: ["come", "perche", "cosa", "migliore"],
  pt: ["como", "por que", "o que", "melhor"],
  nl: ["hoe", "waarom", "wat", "beste"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(URL_, SERVICE);
    // Allowed: a dashboard user, or a server job / Claude connector holding the cron secret
    const cron = req.headers.get("x-cron-secret");
    const allowed = cron
      ? cron === (await db.rpc("get_cron_secret")).data
      : !!(await createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }).rpc("am_i_allowed")).data;
    if (!allowed) return json({ error: "not allowed" }, 403);

    const body = await req.json();
    const term = String(body.term || "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 120);
    const market = /^[A-Z]{2}$|^GLOBAL$/.test(body.market || "") ? body.market : "GLOBAL";
    if (!term) return json({ error: "term is required" }, 400);

    const nq = !body.niche_id || body.niche_id === "global"
      ? db.from("niches").select("*").eq("is_explore", true).limit(1).single()
      : db.from("niches").select("*").eq("id", body.niche_id).single();
    const { data: niche } = await nq;
    if (!niche) return json({ error: "unknown scope" }, 404);
    const lang = typeof body.language === "string" && /^[a-z]{2}$/.test(body.language) ? body.language : (niche.languages?.[0] || "en");
    const today = new Date().toISOString().slice(0, 10);

    let { data: kw } = await db.from("keywords").select("*").eq("niche_id", niche.id).eq("market", market).eq("term", term).maybeSingle();
    if (!kw) {
      const ins = await db.from("keywords").insert({ niche_id: niche.id, market, term, source: "manual" }).select().single();
      if (ins.error) throw ins.error;
      kw = ins.data;
    }

    // Cache: analyzed today already -> just report it
    if (!body.force) {
      const { data: cached } = await db.from("keyword_snapshots").select("keyword_id").eq("keyword_id", kw.id)
        .eq("captured_on", today).not("difficulty", "is", null).maybeSingle();
      if (cached) return json({ keyword_id: kw.id, cached: true });
    }

    const used = (await db.rpc("quota_used_today", { p_api: "youtube_data" })).data ?? 0;
    if (used + 102 > CAP) return json({ error: "Daily YouTube quota reached. Try again tomorrow (resets at midnight Pacific)." }, 429);
    const yt = async (endpoint: string, params: Record<string, string>, cost: number) => {
      const r = await fetch(`https://www.googleapis.com/youtube/v3/${endpoint}?${new URLSearchParams({ ...params, key: YT_KEY })}`);
      if (!r.ok) throw new Error(`YouTube ${endpoint} ${r.status}: ${(await r.text()).slice(0, 200)}`);
      await db.rpc("add_quota", { p_api: "youtube_data", p_bucket: "lookup", p_niche_key: niche.slug, p_units: cost });
      return r.json();
    };

    // 1) Page 1 as a viewer sees it (relevance, no date filter)
    const sp: Record<string, string> = { part: "snippet", type: "video", q: term, order: "relevance", maxResults: "20", relevanceLanguage: lang, safeSearch: "none" };
    if (market !== "GLOBAL") sp.regionCode = market;
    const search = await yt("search", sp, 100);
    const ids: string[] = (search.items || []).map((i: any) => i.id?.videoId).filter(Boolean);
    const videos: any[] = ids.length ? (await yt("videos", { part: "snippet,statistics,contentDetails", id: ids.join(",") }, 1)).items || [] : [];
    const byId = new Map(videos.map((v) => [v.id, v]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean);

    const chanIds = [...new Set(ordered.map((v: any) => v.snippet.channelId))] as string[];
    const channels: Record<string, any> = {};
    if (chanIds.length) {
      for (const c of (await yt("channels", { part: "snippet,statistics", id: chanIds.join(",") }, 1)).items || []) {
        const st = c.statistics || {};
        channels[c.id] = { youtube_channel_id: c.id, title: c.snippet?.title, subscribers: st.subscriberCount ? +st.subscriberCount : null,
          hidden_subscribers: !!st.hiddenSubscriberCount, video_count: +(st.videoCount || 0), updated_at: new Date().toISOString() };
      }
      await db.from("ext_channels").upsert(Object.values(channels), { onConflict: "youtube_channel_id" });
    }

    const vrows = ordered.map((v: any) => {
      const sn = v.snippet, dur = isoSeconds(v.contentDetails?.duration);
      return { youtube_video_id: v.id, youtube_channel_id: sn.channelId, niche_id: niche.id, title: sn.title,
        description: (sn.description || "").slice(0, 2000), tags: sn.tags || [], published_at: sn.publishedAt, duration_s: dur,
        is_short: dur !== null && dur <= 180, thumbnail_url: (sn.thumbnails?.high || sn.thumbnails?.medium || sn.thumbnails?.default)?.url };
    });
    if (vrows.length) {
      // keep a video's original niche if another scope found it first
      await db.from("videos").upsert(vrows, { onConflict: "youtube_video_id", ignoreDuplicates: true });
      await db.from("video_snapshots").insert(ordered.map((v: any) => ({ youtube_video_id: v.id, views: +(v.statistics?.viewCount || 0),
        likes: v.statistics?.likeCount ? +v.statistics.likeCount : null, comments: v.statistics?.commentCount ? +v.statistics.commentCount : null })));
      await db.from("video_keywords").delete().eq("keyword_id", kw.id);
      await db.from("video_keywords").insert(vrows.map((v, i) => ({ youtube_video_id: v.youtube_video_id, keyword_id: kw.id, rank: i + 1 })));
    }

    const m = scorePage(term, ordered.map((v: any) => ({
      title: v.snippet.title, views: +(v.statistics?.viewCount || 0), publishedAt: v.snippet.publishedAt,
      channelSubs: channels[v.snippet.channelId]?.subscribers ?? null,
    })));

    // 2) Related keywords (free): autocomplete, A-Z, questions, + tags of page-1 videos
    const gl = market === "GLOBAL" ? undefined : market;
    const letters = "abcdefghijklmnopqrstuvwxyz".split("");
    const qs = QUESTIONS[lang] || QUESTIONS.en;
    const [ytPrefix, gPrefix, children, ...rest] = await Promise.all([
      suggest(prefixOf(term), true, lang, gl), suggest(prefixOf(term), false, lang, gl), suggest(term + " ", true, lang, gl),
      ...letters.map((l) => suggest(`${term} ${l}`, true, lang, gl)),
      ...qs.map((w) => suggest(`${w} ${term}`, true, lang, gl)),
    ]);
    const az = rest.slice(0, letters.length).map((l) => l[0]).filter(Boolean);
    const questions = rest.slice(letters.length).flatMap((l) => l.slice(0, 3));
    const rank = (list: string[]) => { const i = list.indexOf(term); return i >= 0 ? i + 1 : null; };

    const related = new Map<string, { term: string; source: string; rank: number }>();
    const add = (t: string, source: string, r: number) => {
      if (!t || t === term || related.has(`${t}|${source}`)) return;
      related.set(`${t}|${source}`, { term: t, source, rank: r });
    };
    children.forEach((t, i) => add(t, "autocomplete", i + 1));
    az.forEach((t, i) => add(t, "az", i + 1));
    questions.forEach((t, i) => add(t, "question", i + 1));
    topTags(ordered.map((v: any) => v.snippet.tags || []), term).forEach((t) => add(t.term, "tag", t.count));

    await db.from("keyword_related").delete().eq("keyword_id", kw.id);
    if (related.size) await db.from("keyword_related").insert([...related.values()].map((r) => ({ keyword_id: kw.id, ...r, captured_on: today })));

    await db.from("keyword_snapshots").upsert({
      keyword_id: kw.id, captured_on: today, ...m,
      yt_autocomplete_rank: rank(ytPrefix), google_autocomplete_rank: rank(gPrefix),
      recent_uploads: vrows.length, big_channel_uploads: Math.round(m.big_share * Math.min(vrows.length, 10)),
      top_views_median: null, results_total: search.pageInfo?.totalResults ?? null,
    }, { onConflict: "keyword_id,captured_on" });

    return json({ keyword_id: kw.id, cached: false, ...m, related: related.size });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
