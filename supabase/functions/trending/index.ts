// The Trending page: Google Trends' "Trending now" list, without a keyword search, plus turning trends into ideas.
//   list   {geo, hours}                      every trend of that country and period (4, 24, 48 or 168 hours), kept 10 minutes
//   news   {title, geo, lang}                up to 5 headlines about one trend (Google News, through the VDS: news.php)
//   assign {channel_id, trends: [...]}       each trend becomes an idea for that network, with its headlines as its facts
// Signed-in users on the allow-list only (jobs with the cron secret may list and read news). The "Trending now" page isn't an official API: if Google changes it, list says so.
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const MEDIA_URL = Deno.env.get("MEDIA_URL") ?? "";
const MEDIA_SECRET = Deno.env.get("MEDIA_SECRET") ?? "";
const NEWS_URL = MEDIA_URL.replace(/media\.php$/, "news.php");
const CACHE_MINUTES = 10;
const PERIODS = [4, 24, 48, 168];
const MAX_ASSIGN = 20;
const BROWSER = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};
const GEO_LANG: Record<string, string> = { FR: "fr", BE: "fr", MA: "fr", DZ: "fr", TN: "fr", DE: "de", AT: "de", CH: "de", ES: "es", MX: "es",
  IT: "it", PT: "pt", BR: "pt", NL: "nl", EG: "ar", SA: "ar", AE: "ar" };
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f-]{36}$/;
const db = createClient(URL_, SERVICE);
const clean = (v: unknown, max: number) => String(v ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const geoOf = (v: unknown) => (/^[A-Z]{2}$/.test(String(v || "").toUpperCase()) ? String(v).toUpperCase() : "US");

function traffic(volume: number): string {
  if (volume >= 1_000_000) return `${Math.floor(volume / 1_000_000)}M+`;
  if (volume >= 1_000) return `${Math.floor(volume / 1_000)}K+`;
  return `${volume}+`;
}

/** The trends sit in the page as the data of AF_initDataCallback 'ds:0'. */
function parse(html: string, geo: string) {
  const m = html.match(/AF_initDataCallback\(\{key: 'ds:0'[\s\S]*?data:([\s\S]*?), sideChannel/);
  if (!m) throw new Error("Google Trends changed its page: the trends can't be read right now.");
  const rows: any[] = JSON.parse(m[1])?.[1] || [];
  const out = [];
  for (const r of rows) {
    const title = clean(r?.[0], 200);
    if (!title) continue;
    const news = Array.isArray(r[11]) ? r[11] : [];
    const lang = news.find((n: any) => Array.isArray(n) && n[1])?.[1] || GEO_LANG[geo] || "en";
    out.push({
      title, geo, volume: Number(r[6]) || 0, growth: Number(r[8]) || 0,
      started: Number(r[3]?.[0]) || 0, ended: Number(r[4]?.[0]) || 0, active: r[4] == null,
      categories: (Array.isArray(r[10]) ? r[10] : []).map(Number),
      related: (Array.isArray(r[9]) ? r[9] : []).map((x: unknown) => clean(x, 120)).filter((x: string) => x && x.toLowerCase() !== title.toLowerCase()),
      lang: String(lang).slice(0, 5),
    });
  }
  return out;
}

async function list(geo: string, hours: number) {
  const { data: cached } = await db.from("trend_cache").select("fetched_at, rows").eq("geo", geo).eq("hours", hours).maybeSingle();
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_MINUTES * 60_000) return { rows: cached.rows, fetched_at: cached.fetched_at };
  const r = await fetch(`https://trends.google.com/trending?${new URLSearchParams({ geo, hours: String(hours), hl: "en-US" })}`, { headers: BROWSER });
  if (!r.ok) {
    if (cached) return { rows: cached.rows, fetched_at: cached.fetched_at, stale: true };
    throw new Error(`Google Trends didn't answer (${r.status}). Try again in a minute.`);
  }
  const rows = parse(await r.text(), geo);
  const fetched_at = new Date().toISOString();
  await db.from("trend_cache").upsert({ geo, hours, fetched_at, rows });
  return { rows, fetched_at };
}

async function news(title: string, geo: string, lang: string) {
  if (!NEWS_URL || MEDIA_SECRET.length < 32) return [];
  const hl = (lang || GEO_LANG[geo] || "en").split("-")[0].toLowerCase().slice(0, 2);
  const q = clean(title, 200);
  const e = Math.floor(Date.now() / 1000) + 300;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(MEDIA_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`GET\nnews:${q}|${geo}|${hl}\n${e}`));
  const s = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  try {
    const r = await fetch(`${NEWS_URL}?${new URLSearchParams({ q, gl: geo, hl, e: String(e), s })}`, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return [];
    const body = await r.json();
    return Array.isArray(body.news) ? body.news.slice(0, 5) : [];
  } catch {
    return [];
  }
}

async function assign(body: any) {
  const channelId = UUID.test(body.channel_id || "") ? body.channel_id : "";
  if (!channelId) throw new Error("Pick a network.");
  const { data: channel } = await db.from("channels").select("id, niche_id, title").eq("id", channelId).single();
  if (!channel) throw new Error("Network not found.");
  const trends = (Array.isArray(body.trends) ? body.trends : []).slice(0, MAX_ASSIGN);
  if (!trends.length) throw new Error("Select at least one trend.");
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const { data: recent } = await db.from("ideas").select("sources").eq("channel_id", channelId).gte("created_at", since).contains("sources", [{ type: "trend" }]);
  const known = new Set((recent || []).flatMap((r: any) => (Array.isArray(r.sources) ? r.sources : []).map((s: any) => String(s?.ref || "").toLowerCase())));
  let added = 0, skipped = 0;
  const ideas: string[] = [];
  for (const t of trends) {
    const ref = clean(t.title, 200);
    if (!ref || known.has(ref.toLowerCase())) { skipped++; continue; }
    known.add(ref.toLowerCase());
    const geo = geoOf(t.geo);
    const volume = Number(t.volume) || 0;
    const headlines = await news(ref, geo, clean(t.lang, 5));
    const title = ref.charAt(0).toUpperCase() + ref.slice(1);
    const { data: row, error } = await db.from("ideas").insert({
      title: title.slice(0, 120), channel_id: channelId, niche_id: channel.niche_id,
      score: Math.min(90, 30 + Math.round(10 * Math.log10(Math.max(volume, 1)))),
      sources: [{
        type: "trend", ref, geo, traffic: traffic(volume), why: "Picked on the Trending page",
        news: headlines.slice(0, 3).map((n: any) => ({ title: clean(n.title, 200), source: clean(n.source, 80), url: String(n.url || "").slice(0, 500) })),
        related: (Array.isArray(t.related) ? t.related : []).slice(0, 10).map((x: unknown) => clean(x, 120)),
        categories: (Array.isArray(t.categories) ? t.categories : []).map(Number).filter(Number.isFinite),
        started: Number(t.started) ? new Date(Number(t.started) * 1000).toISOString() : null,
      }],
    }).select("id").single();
    if (error) throw error;
    ideas.push(row.id);
    added++;
  }
  return { added, skipped, ideas };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const cron = req.headers.get("x-cron-secret");
    const isService = !!cron && cron === (await db.rpc("get_cron_secret")).data;  // jobs may read the list and the news
    const userDb = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    if (!(isService && body.action !== "assign") && !(await userDb.rpc("am_i_allowed")).data) return json({ error: "not allowed" }, 403);
    if (body.action === "list") {
      const hours = PERIODS.includes(Number(body.hours)) ? Number(body.hours) : 24;
      return json(await list(geoOf(body.geo), hours));
    }
    if (body.action === "news") return json({ news: await news(clean(body.title, 200), geoOf(body.geo), clean(body.lang, 5)) });
    if (body.action === "assign") return json(await assign(body));
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
