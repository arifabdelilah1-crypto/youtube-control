// Live keyword lookup for the dashboard's "Analyze now" button.
// Searches YouTube for recent videos on one term, stores videos/channels/snapshots,
// measures competition + outliers + autocomplete rank, returns a short summary.
import { createClient } from "npm:@supabase/supabase-js@2";

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
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}
async function suggest(q: string, yt: boolean, hl: string, gl?: string): Promise<string[]> {
  const p = new URLSearchParams({ client: "firefox", q, hl });
  if (yt) p.set("ds", "yt");
  if (gl && gl !== "GLOBAL") p.set("gl", gl);
  try {
    const r = await fetch(`https://suggestqueries.google.com/complete/search?${p}`);
    const buf = new Uint8Array(await r.arrayBuffer());
    const data = JSON.parse(new TextDecoder("utf-8", { fatal: false }).decode(buf));
    return (data[1] as string[]).map((s) => s.trim().toLowerCase()).slice(0, 10);
  } catch { return []; }
}
const prefixOf = (t: string) => {
  const w = t.split(" ");
  return w.length === 1 ? t.slice(0, Math.max(3, Math.floor(t.length / 2))) : `${w.slice(0, -1).join(" ")} ${w.at(-1)![0]}`;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // Only allow-listed dashboard users
    const user = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: allowed } = await user.rpc("am_i_allowed");
    if (!allowed) return json({ error: "not allowed" }, 403);

    const { niche_id, market = "GLOBAL", term: rawTerm } = await req.json();
    const term = String(rawTerm || "").trim().toLowerCase().slice(0, 120);
    if (!niche_id || !term) return json({ error: "niche_id and term are required" }, 400);

    const db = createClient(URL_, SERVICE);
    const { data: niche } = await db.from("niches").select("*").eq("id", niche_id).single();
    if (!niche) return json({ error: "unknown niche" }, 404);
    const used = (await db.rpc("quota_used_today", { p_api: "youtube_data" })).data ?? 0;
    if (used + 102 > CAP) return json({ error: "daily YouTube quota reached" }, 429);

    const lang = (niche.languages?.[0]) || "en";
    const yt = async (endpoint: string, params: Record<string, string>, cost: number, bucket: string) => {
      const r = await fetch(`https://www.googleapis.com/youtube/v3/${endpoint}?${new URLSearchParams({ ...params, key: YT_KEY })}`);
      if (!r.ok) throw new Error(`YouTube ${endpoint} ${r.status}: ${(await r.text()).slice(0, 200)}`);
      await db.rpc("add_quota", { p_api: "youtube_data", p_bucket: bucket, p_niche_key: niche.slug, p_units: cost });
      return r.json();
    };

    const after = new Date(Date.now() - 14 * 864e5).toISOString().replace(/\.\d+Z$/, "Z");
    const sp: Record<string, string> = { part: "snippet", type: "video", q: term, order: "viewCount", publishedAfter: after, maxResults: "50", relevanceLanguage: lang };
    if (market !== "GLOBAL") sp.regionCode = market;
    const search = await yt("search", sp, 100, "lookup");
    const ids: string[] = (search.items || []).map((i: any) => i.id?.videoId).filter(Boolean);

    const videos = ids.length ? (await yt("videos", { part: "snippet,statistics,contentDetails", id: ids.join(",") }, 1, "lookup")).items || [] : [];
    const chanIds = [...new Set(videos.map((v: any) => v.snippet.channelId))] as string[];
    const channels: Record<string, any> = {};
    if (chanIds.length) {
      const cres = await yt("channels", { part: "snippet,statistics", id: chanIds.join(",") }, 1, "lookup");
      for (const c of cres.items || []) {
        const st = c.statistics || {};
        channels[c.id] = { youtube_channel_id: c.id, title: c.snippet?.title, subscribers: st.subscriberCount ? +st.subscriberCount : null,
          hidden_subscribers: !!st.hiddenSubscriberCount, video_count: +(st.videoCount || 0), updated_at: new Date().toISOString() };
      }
      await db.from("ext_channels").upsert(Object.values(channels), { onConflict: "youtube_channel_id" });
    }

    const vrows: any[] = [], snaps: any[] = [], views: number[] = [];
    let outliers = 0, big = 0;
    for (const v of videos) {
      const sn = v.snippet, st = v.statistics || {}, dur = isoSeconds(v.contentDetails?.duration);
      const vv = +(st.viewCount || 0), subs = channels[sn.channelId]?.subscribers || 0;
      vrows.push({ youtube_video_id: v.id, youtube_channel_id: sn.channelId, niche_id, title: sn.title, description: (sn.description || "").slice(0, 2000),
        tags: sn.tags || [], published_at: sn.publishedAt, duration_s: dur, is_short: dur !== null && dur <= 180,
        thumbnail_url: (sn.thumbnails?.high || sn.thumbnails?.medium || sn.thumbnails?.default)?.url });
      snaps.push({ youtube_video_id: v.id, views: vv, likes: st.likeCount ? +st.likeCount : null, comments: st.commentCount ? +st.commentCount : null });
      views.push(vv);
      if (subs > 100_000) big++;
      if (vv / Math.max(subs, 100) >= 3) outliers++;
    }
    if (vrows.length) {
      await db.from("videos").upsert(vrows, { onConflict: "youtube_video_id" });
      await db.from("video_snapshots").insert(snaps);
    }
    const { data: kw } = await db.from("keywords").upsert({ niche_id, market, term, source: "manual" }, { onConflict: "niche_id,market,term" }).select().single();
    if (vrows.length) await db.from("video_keywords").upsert(vrows.map((v) => ({ youtube_video_id: v.youtube_video_id, keyword_id: kw.id })), { onConflict: "youtube_video_id,keyword_id" });

    const gl = market === "GLOBAL" ? undefined : market;
    const [ytS, gS, kids] = await Promise.all([suggest(prefixOf(term), true, lang, gl), suggest(prefixOf(term), false, lang, gl), suggest(term + " ", true, lang, gl)]);
    const rank = (list: string[]) => { const i = list.indexOf(term); return i >= 0 ? i + 1 : null; };
    const today = new Date().toISOString().slice(0, 10);
    await db.from("keyword_snapshots").upsert({ keyword_id: kw.id, captured_on: today, yt_autocomplete_rank: rank(ytS), google_autocomplete_rank: rank(gS),
      recent_uploads: vrows.length, big_channel_uploads: big, outlier_count: outliers, top_views_median: median(views) }, { onConflict: "keyword_id,captured_on" });

    let pos = 0;
    for (const child of kids.filter((k) => k !== term)) {
      pos++;
      const { data: ck } = await db.from("keywords").upsert({ niche_id, market, term: child, source: "autocomplete" }, { onConflict: "niche_id,market,term" }).select().single();
      if (ck) await db.from("keyword_snapshots").upsert({ keyword_id: ck.id, captured_on: today, yt_autocomplete_rank: pos }, { onConflict: "keyword_id,captured_on" });
    }
    return json({ term, videos: vrows.length, outliers, big_channel_uploads: big, yt_rank: rank(ytS), suggestions: pos });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
