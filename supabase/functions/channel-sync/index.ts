// Channel stats sync, server-side (no GitHub needed).
// Called: right after a channel is connected, by the dashboard's "Refresh stats" button,
// and every 6 h by pg_cron. Body: {channel_id?} — omit to sync every channel.
// Auth: an allow-listed dashboard user's JWT, or the x-cron-secret header (value kept in Vault).
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const YT_KEY = Deno.env.get("YOUTUBE_API_KEY")!;
const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const db = createClient(URL_, SERVICE);
const day = (d: Date) => d.toISOString().slice(0, 10);

function isoSeconds(d?: string): number | null {
  const m = d?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  return (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+(m[3] || 0)) * 60 + (+(m[4] || 0));
}
async function yt(endpoint: string, params: Record<string, string>) {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${endpoint}?${new URLSearchParams({ ...params, key: YT_KEY })}`);
  if (!r.ok) throw new Error(`YouTube ${endpoint} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  await db.rpc("add_quota", { p_api: "youtube_data", p_bucket: "channel_stats", p_niche_key: "all", p_units: 1 });
  return r.json();
}
async function accessToken(channelId: string): Promise<string | null> {
  const { data: refresh } = await db.rpc("get_channel_refresh_token", { p_channel_id: channelId });
  if (!refresh || !CLIENT_ID) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  const t = await r.json();
  if (!r.ok) throw new Error(`token refresh failed: ${t.error_description || t.error}`);
  return t.access_token;
}
async function report(token: string, params: Record<string, string | number>) {
  const p = new URLSearchParams({ ids: "channel==MINE", ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  const r = await fetch(`https://youtubeanalytics.googleapis.com/v2/reports?${p}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await r.json();
  if (!r.ok) throw new Error(`analytics ${params.dimensions}: ${data.error?.message || r.status}`);
  const cols = (data.columnHeaders || []).map((h: any) => h.name);
  return (data.rows || []).map((row: any[]) => Object.fromEntries(cols.map((c: string, i: number) => [c, row[i]])));
}

async function syncChannel(ch: any) {
  const info: Record<string, unknown> = {};
  // Public stats (API key)
  const c = (await yt("channels", { part: "snippet,statistics,contentDetails", id: ch.youtube_channel_id })).items?.[0];
  if (c) {
    const st = c.statistics || {}, thumbs = c.snippet?.thumbnails || {};
    await db.from("channel_snapshots").insert({ channel_id: ch.id, subscribers: st.subscriberCount ? +st.subscriberCount : null,
      total_views: +(st.viewCount || 0), video_count: +(st.videoCount || 0) });
    await db.from("channels").update({ title: c.snippet?.title || ch.title, handle: c.snippet?.customUrl ?? ch.handle,
      thumbnail_url: (thumbs.medium || thumbs.default)?.url ?? null }).eq("id", ch.id);
    info.subscribers = st.subscriberCount;
  }
  // Latest 50 uploads with current totals
  const uploads = c?.contentDetails?.relatedPlaylists?.uploads || "UU" + ch.youtube_channel_id.slice(2);
  const items = (await yt("playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: "50" }).catch(() => ({ items: [] }))).items || [];
  const ids = items.map((i: any) => i.contentDetails.videoId);
  if (ids.length) {
    const vids = (await yt("videos", { part: "snippet,statistics,contentDetails", id: ids.join(",") })).items || [];
    const today = day(new Date());
    await db.from("own_videos").upsert(vids.map((v: any) => {
      const dur = isoSeconds(v.contentDetails?.duration), th = v.snippet?.thumbnails || {};
      return { youtube_video_id: v.id, channel_id: ch.id, title: v.snippet?.title, published_at: v.snippet?.publishedAt, duration_s: dur,
        is_short: dur !== null && dur <= 180, thumbnail_url: (th.medium || th.default)?.url ?? null, updated_at: new Date().toISOString() };
    }), { onConflict: "youtube_video_id" });
    await db.from("own_video_daily").upsert(vids.map((v: any) => ({ youtube_video_id: v.id, day: today, views: +(v.statistics?.viewCount || 0),
      likes: v.statistics?.likeCount ? +v.statistics.likeCount : null, comments: v.statistics?.commentCount ? +v.statistics.commentCount : null })),
      { onConflict: "youtube_video_id,day" });
    info.videos = vids.length;
  }

  // Private analytics (only connected channels)
  const token = ch.connected ? await accessToken(ch.id) : null;
  if (!token) return { ...info, analytics: "not connected" };
  const end = new Date(Date.now() - 864e5), start = new Date(end.getTime() - 90 * 864e5), s28 = new Date(end.getTime() - 27 * 864e5);
  const rng = { startDate: day(start), endDate: day(end) };
  const daily = await report(token, { ...rng, dimensions: "day", metrics: "views,estimatedMinutesWatched,subscribersGained,subscribersLost,averageViewDuration" });
  const rows: Record<string, any> = {};
  for (const r of daily) rows[r.day] = { channel_id: ch.id, day: r.day, views: r.views, watch_minutes: r.estimatedMinutesWatched,
    subs_gained: r.subscribersGained, subs_lost: r.subscribersLost, avg_view_duration_s: r.averageViewDuration };
  try {
    for (const r of await report(token, { ...rng, dimensions: "day,creatorContentType", metrics: "views" }))
      if (r.creatorContentType === "SHORTS" && rows[r.day]) rows[r.day].shorts_views = r.views;
  } catch (e) { info.shorts = String((e as Error).message); }
  if (Object.keys(rows).length) await db.from("channel_daily_stats").upsert(Object.values(rows), { onConflict: "channel_id,day" });
  info.days = Object.keys(rows).length;

  const r28 = { startDate: day(s28), endDate: day(end) };
  const terms = await report(token, { ...r28, dimensions: "insightTrafficSourceDetail", filters: "insightTrafficSourceType==YT_SEARCH", metrics: "views", sort: "-views", maxResults: 25 }).catch(() => []);
  if (terms.length) await db.from("channel_search_terms").upsert(terms.map((t: any) => ({ channel_id: ch.id, period_end: day(end), term: t.insightTrafficSourceDetail, views: t.views })),
    { onConflict: "channel_id,period_end,term" });
  const bd: any[] = [];
  for (const [kind, dim, extra] of [["traffic_source", "insightTrafficSourceType", {}], ["country", "country", { sort: "-views", maxResults: 10 }]] as const) {
    for (const r of await report(token, { ...r28, dimensions: dim, metrics: "views", ...extra }).catch(() => []))
      bd.push({ channel_id: ch.id, period_end: day(end), kind, key: r[dim], views: r.views });
  }
  if (bd.length) await db.from("channel_breakdowns").upsert(bd, { onConflict: "channel_id,period_end,kind,key" });
  if (ch.niche_id && terms.length) {
    const market = ch.markets?.[0] || "GLOBAL";
    await db.from("keywords").upsert(terms.map((t: any) => ({ niche_id: ch.niche_id, market, term: String(t.insightTrafficSourceDetail).toLowerCase(), source: "channel_search" })),
      { onConflict: "niche_id,market,term", ignoreDuplicates: true });
  }
  return { ...info, search_terms: terms.length, breakdowns: bd.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  // Auth
  const cronHeader = req.headers.get("x-cron-secret");
  let ok = false;
  if (cronHeader) {
    const { data } = await db.rpc("get_cron_secret");
    ok = !!data && data === cronHeader;
  } else {
    const user = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    ok = !!(await user.rpc("am_i_allowed")).data;
  }
  if (!ok) return json({ error: "not allowed" }, 403);

  const body = await req.json().catch(() => ({}));
  let q = db.from("channels").select("*").not("youtube_channel_id", "is", null);
  if (body.channel_id) q = q.eq("id", body.channel_id);
  const { data: channels } = await q;
  const { data: run } = await db.from("job_runs").insert({ job: "channel_sync", status: "running" }).select().single();
  const details: Record<string, unknown> = {};
  let status = "ok";
  for (const ch of channels || []) {
    try { details[ch.title] = await syncChannel(ch); }
    catch (e) { details[ch.title] = { error: String((e as Error).message) }; status = "warning"; }
  }
  await db.from("job_runs").update({ status, finished_at: new Date().toISOString(), details }).eq("id", run.id);
  return json({ status, details });
});
