// Campaigns: paid "content rewards" campaigns (Whop and similar).
//   POST {action:"parse", text?, url?}      -> reads the campaign (pasted text, or a Google Doc / web page link), DeepSeek turns it into
//                                              a campaign card (pay, platforms, audience, must-include, banned, content type) with a
//                                              risk level, and saves it as a draft. Returns {campaign}.
//   POST {action:"match", campaign_id}      -> scores every network for this campaign (niche fit, language, audience countries from
//                                              YouTube Analytics, followers, platforms, recent views) with an estimated payout per post,
//                                              plus a suggested new account when nothing fits. Returns {campaign}.
// Dashboard users (JWT + am_i_allowed), or jobs with x-cron-secret. Secrets: DEEPSEEK_API_KEY, optional DEEPSEEK_MODEL.
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const DS_KEY = Deno.env.get("DEEPSEEK_API_KEY") ?? "";
const DS_MODEL = Deno.env.get("DEEPSEEK_MODEL") || "deepseek-chat";
const DAILY_RUNS = 200;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const db = createClient(URL_, SERVICE);
const UUID = /^[0-9a-f-]{36}$/;
const PLATFORMS = ["youtube", "tiktok", "instagram", "facebook", "x"];
const clean = (s: unknown, n = 300) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(n) && String(v ?? "").trim() !== "" && v !== null ? n : null; };
const list = (v: unknown, n = 20, len = 200) => (Array.isArray(v) ? v : []).map((x) => clean(x, len)).filter(Boolean).slice(0, n);

// ---------- DeepSeek ----------
function parseJson(text: string) {
  try { return JSON.parse(text); } catch { /* below */ }
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("DeepSeek's answer wasn't valid JSON");
  return JSON.parse(text.slice(a, b + 1));
}
async function deepseek(kind: string, system: string, user: string, ownerId: string | null) {
  if (!DS_KEY) throw new Error("DeepSeek isn't set up yet: add DEEPSEEK_API_KEY in Supabase Edge Function secrets.");
  const { count } = await db.from("ai_runs").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 864e5).toISOString());
  if ((count ?? 0) >= DAILY_RUNS) throw new Error(`Daily AI limit reached (${DAILY_RUNS} runs in 24 h).`);
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST", signal: AbortSignal.timeout(110_000),
        headers: { Authorization: `Bearer ${DS_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: DS_MODEL, response_format: { type: "json_object" }, temperature: 0.2, max_tokens: 6000,
          thinking: { type: "disabled" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      });
      if (!r.ok) { last = `DeepSeek ${r.status}: ${(await r.text()).slice(0, 300)}`; if (r.status < 500 && r.status !== 429) break; continue; }
      const data = await r.json();
      const text = data.choices?.[0]?.message?.content || "";
      await db.from("ai_runs").insert({ idea_id: null, kind, model: data.model || DS_MODEL, owner_id: ownerId,
        prompt_tokens: data.usage?.prompt_tokens ?? null, completion_tokens: data.usage?.completion_tokens ?? null, ok: !!text });
      if (text.trim()) return parseJson(text);
      last = "DeepSeek returned an empty answer";
    } catch (e) { last = (e as Error).name === "TimeoutError" ? "DeepSeek took too long" : String((e as Error).message || e); }
  }
  throw new Error(last || "DeepSeek failed");
}

// ---------- reading a link ----------
const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
function pageText(html: string) {
  // a Next.js page (Whop) keeps its content in JSON inside script tags: keep the readable strings from it
  const jsonBits = [...html.matchAll(/<script[^>]*(?:application\/json|__NEXT_DATA__)[^>]*>([\s\S]*?)<\/script>/gi)]
    .flatMap((m) => [...m[1].matchAll(/"((?:[^"\\]|\\.){25,})"/g)].map((x) => { try { return JSON.parse(`"${x[1]}"`); } catch { return ""; } }))
    .filter((s: string) => /\s/.test(s) && !/^(https?:|\/|data:)/.test(s));
  const meta = [...html.matchAll(/<meta[^>]+(?:name|property)="(?:description|og:description|og:title)"[^>]+content="([^"]*)"/gi)].map((m) => m[1]);
  const body = html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decode([...meta, body, ...jsonBits].join("\n")).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
async function readLink(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("That link isn't valid."); }
  if (url.protocol !== "https:") throw new Error("Use an https link.");
  const doc = url.hostname === "docs.google.com" && url.pathname.match(/\/document\/(?:u\/\d+\/)?d\/([\w-]+)/);
  const target = doc ? `https://docs.google.com/document/d/${doc[1]}/export?format=txt` : url.toString();
  const r = await fetch(target, { redirect: "follow", signal: AbortSignal.timeout(20_000),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; YouTubeControl/1.0)", Accept: "text/html,text/plain,*/*" } });
  const type = r.headers.get("content-type") || "";
  if (!r.ok) throw new Error(doc ? "This Google Doc isn't public. Share it as \"Anyone with the link\", or paste its text." : `The page answered ${r.status}. Paste the campaign text instead.`);
  const raw2 = (await r.text()).slice(0, 2_000_000);
  if (doc && /<html/i.test(raw2.slice(0, 500))) throw new Error("This Google Doc isn't public. Share it as \"Anyone with the link\", or paste its text.");
  const text = /html/.test(type) ? pageText(raw2) : raw2;
  if (text.replace(/\s/g, "").length < 300) throw new Error("This page loads its content with JavaScript, so it can't be read from here. Copy the campaign text from the page and paste it.");
  return text.slice(0, 40_000);
}

// ---------- 1) parse ----------
const PARSE_SYSTEM = `You read the brief of a paid "content rewards" / clipping campaign (Whop and similar: creators are paid per 1,000 views
for short videos that promote a brand) and return its rules as json. Only use what the text says; null or [] when it isn't there.
Never invent numbers. Convert money to USD numbers (no symbols).
Return json with exactly these keys:
{"title": "short campaign name", "brand": "", "product": "what is promoted, one line", "summary": "2-3 plain sentences: what they want",
 "rate_per_1k": number|null, "cap_per_post": number|null, "budget": number|null, "min_views_to_pay": number|null,
 "deadline": "YYYY-MM-DD"|null, "platforms": ["youtube"|"tiktok"|"instagram"|"facebook"|"x"],
 "content_type": "promo" (we make our own videos about the product) | "clipping" (they give long videos/streams/podcasts to cut into shorts) | "assets" (they give clips, logos or a song that must be used),
 "languages": ["en", ...] (ISO 639-1; [] if any language), "audience": {"countries": [{"codes": ["US"], "min_pct": 40}], "min_age": number|null, "notes": ""},
 "min_followers": number|null, "page_type": "kind of page/account they want, e.g. student life, gaming, finance" ,
 "niche_keywords": ["5-10 words describing the topics that fit"],
 "must_include": ["every required element: brand mention, demo, CTA, on-screen text, tag..."], "hashtags": ["#..."], "tags_mentions": ["@..."],
 "bio_link": "link they want in the bio"|null, "links": ["links to include"], "assets": ["links to their files / drive folders"],
 "banned": ["everything that gets a video rejected"], "ai_content": "allowed"|"banned"|"unclear", "length": {"min_s": number|null, "max_s": number|null},
 "submission": "how and when to submit posts", "risk": {"level": "green"|"orange"|"red", "notes": ["why, short"]}}
Risk: red when the product or the required claims break YouTube/Google ad and community rules or could get a channel struck: gambling,
betting or casinos, academic cheating or proctoring evasion, adult content, weapons, drugs, get-rich-quick or guaranteed returns,
unlicensed financial products, health cures, required fake reviews or staged results. orange when it is allowed but needs care
(crypto, trading, supplements, dating, loans, AI voice banned while our videos use AI voices, very strict audience rules). green otherwise.`;
const RED_WORDS = /\b(casino|betting|sportsbook|bet365|gambl\w*|slots?\b|cheat\w*|proctor\w*|undetectable|onlyfans|nsfw|adult content|guaranteed (?:returns?|profits?)|forex signals?)\b/i;
const ORANGE_WORDS = /\b(crypto\w*|bitcoin|memecoin|token presale|trading|supplement\w*|dating|payday loan|no ai|ai[- ]generated content (?:is )?(?:not allowed|banned))\b/i;

function cleanCard(c: any) {
  const plats = list(c.platforms, 5, 20).map((p) => p.toLowerCase().replace(/^yt$|youtube shorts|shorts/, "youtube").replace(/^ig$|instagram reels|reels/, "instagram").replace(/^twitter$/, "x"))
    .filter((p) => PLATFORMS.includes(p));
  const countries = (Array.isArray(c.audience?.countries) ? c.audience.countries : []).map((x: any) => ({
    codes: list(x?.codes, 10, 2).map((s) => s.toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s)), min_pct: num(x?.min_pct),
  })).filter((x: any) => x.codes.length).slice(0, 5);
  const level = ["green", "orange", "red"].includes(c.risk?.level) ? c.risk.level : "green";
  return {
    title: clean(c.title, 120) || clean(c.brand, 80) || "Campaign", brand: clean(c.brand, 80), product: clean(c.product, 200), summary: clean(c.summary, 800),
    rate_per_1k: num(c.rate_per_1k), cap_per_post: num(c.cap_per_post), budget: num(c.budget), min_views_to_pay: num(c.min_views_to_pay),
    deadline: /^\d{4}-\d{2}-\d{2}$/.test(c.deadline || "") ? c.deadline : null, platforms: [...new Set(plats)],
    content_type: ["promo", "clipping", "assets"].includes(c.content_type) ? c.content_type : "promo",
    languages: list(c.languages, 8, 5).map((s) => s.toLowerCase().slice(0, 2)),
    audience: { countries, min_age: num(c.audience?.min_age), notes: clean(c.audience?.notes, 300) },
    min_followers: num(c.min_followers), page_type: clean(c.page_type, 200), niche_keywords: list(c.niche_keywords, 12, 40),
    must_include: list(c.must_include, 20), hashtags: list(c.hashtags, 20, 60), tags_mentions: list(c.tags_mentions, 10, 60),
    bio_link: clean(c.bio_link, 200) || null, links: list(c.links, 10), assets: list(c.assets, 10),
    banned: list(c.banned, 25), ai_content: ["allowed", "banned", "unclear"].includes(c.ai_content) ? c.ai_content : "unclear",
    length: { min_s: num(c.length?.min_s), max_s: num(c.length?.max_s) }, submission: clean(c.submission, 400),
    risk: { level, notes: list(c.risk?.notes, 8) },
  };
}
const RANK = { green: 0, orange: 1, red: 2 } as const;

async function parse(body: any, userId: string | null) {
  const url = clean(body.url, 1000);
  let text = String(body.text ?? "").trim().slice(0, 40_000);
  if (!text && !url) throw new Error("Paste the campaign text or a link.");
  if (!text) text = await readLink(url);
  if (text.length < 80) throw new Error("That's too short to be a campaign brief. Paste the whole page text.");
  const card = cleanCard(await deepseek("campaign_parse", PARSE_SYSTEM, text, userId));
  // a fixed word list backs up the model: it can only raise the risk, never lower it
  let risk: "green" | "orange" | "red" = card.risk.level;
  const notes = [...card.risk.notes];
  const red = text.match(RED_WORDS), orange = text.match(ORANGE_WORDS);
  if (red && RANK[risk] < 2) { risk = "red"; notes.push(`The brief mentions "${red[0]}".`); }
  else if (orange && RANK[risk] < 1) { risk = "orange"; notes.push(`The brief mentions "${orange[0]}".`); }
  if (card.ai_content === "banned" && RANK[risk] < 1) { risk = "orange"; notes.push("AI-made content seems banned: our videos use AI voices and visuals."); }
  card.risk = { level: risk, notes };
  const { data, error } = await db.from("campaigns").insert({
    owner_id: userId, title: card.title, brand: card.brand || null, source_url: url || null, source_text: text, card,
    rate_per_1k: card.rate_per_1k, cap_per_post: card.cap_per_post, budget: card.budget, deadline: card.deadline,
    platforms: card.platforms, content_type: card.content_type, risk, risk_notes: notes,
  }).select().single();
  if (error) throw error;
  return { campaign: data };
}

// ---------- 2) match ----------
const MATCH_SYSTEM = `You match a paid short-video campaign to a creator's networks (channels). For each network, judge only the topic
fit: would this campaign's product feel natural to that channel's audience, given its niche, language and recent video titles?
fit 90-100 = same topic; 60-89 = close, the audience would care; 30-59 = a stretch; 0-29 = off-topic (posting it would confuse
the audience and hurt the channel). Then design one NEW account made for this campaign (in case no network fits): a short brandable
name, a handle, a bio (max 150 chars, with a place for the bio link), the niche, the language, the platforms to open first, and 3
content angles that fit the campaign rules. Plain English. Return json:
{"fits": [{"channel_id": "...", "fit": 0-100, "why": "one short sentence"}],
 "new_account": {"name": "", "handle": "@...", "bio": "", "niche": "", "language": "en", "platforms": ["tiktok","instagram","youtube"], "angles": ["", "", ""], "why": ""}}`;

async function match(body: any, userId: string | null) {
  if (!UUID.test(body.campaign_id || "")) throw new Error("campaign_id missing");
  const { data: camp } = await db.from("campaigns").select("*").eq("id", body.campaign_id).single();
  if (!camp) throw new Error("Campaign not found.");
  const card = camp.card || {};
  const since28 = new Date(Date.now() - 28 * 864e5).toISOString();
  const [{ data: chans }, { data: niches }, { data: scheds }, { data: snaps }, { data: daily }, { data: vids }, { data: bds }] = await Promise.all([
    db.from("channels").select("id,title,network_name,handle,language,markets,niche_id,connected"),
    db.from("niches").select("id,name"),
    db.from("publish_schedules").select("channel_id,targets,method"),
    db.from("channel_snapshots").select("channel_id,subscribers,captured_at").gte("captured_at", new Date(Date.now() - 10 * 864e5).toISOString()).order("captured_at", { ascending: false }),
    db.from("channel_daily_stats").select("channel_id,views,day").gte("day", since28.slice(0, 10)),
    db.from("own_videos").select("channel_id,title,published_at").order("published_at", { ascending: false }).limit(800),
    db.from("channel_breakdowns").select("channel_id,period_end,kind,key,views").gte("period_end", new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10)),
  ]);
  const channels = (chans || []).map((c: any) => {
    const subs = (snaps || []).find((s: any) => s.channel_id === c.id)?.subscribers ?? null;
    const views28 = (daily || []).filter((d: any) => d.channel_id === c.id).reduce((a: number, d: any) => a + Number(d.views || 0), 0);
    const mine = (vids || []).filter((v: any) => v.channel_id === c.id);
    const uploads28 = mine.filter((v: any) => v.published_at && v.published_at >= since28).length;
    // audience: the latest 28-day country split, as a share of all views (the traffic-source rows add up to all views)
    const rows = (bds || []).filter((b: any) => b.channel_id === c.id);
    const last = rows.reduce((m: string, b: any) => (b.period_end > m ? b.period_end : m), "");
    const total = rows.filter((b: any) => b.period_end === last && b.kind === "traffic_source").reduce((a: number, b: any) => a + Number(b.views || 0), 0);
    const countries: Record<string, number> = {};
    for (const b of rows) if (b.period_end === last && b.kind === "country" && total) countries[b.key] = Math.round((Number(b.views) / total) * 1000) / 10;
    const sched = (scheds || []).find((s: any) => s.channel_id === c.id);
    const plats = new Set<string>();
    if (c.connected) plats.add("youtube");
    for (const t of Array.isArray(sched?.targets) ? sched.targets : []) if (PLATFORMS.includes(t?.platform)) plats.add(t.platform);
    return { id: c.id, title: c.network_name || c.title, language: c.language, markets: c.markets || [], niche: (niches || []).find((n: any) => n.id === c.niche_id)?.name || "",
      subs, views28, uploads28, countries, has_audience: !!total, platforms: [...plats], recent: mine.slice(0, 8).map((v: any) => v.title) };
  });
  const ai = await deepseek("campaign_match", MATCH_SYSTEM, JSON.stringify({
    campaign: { brand: card.brand, product: card.product, summary: card.summary, page_type: card.page_type, niche_keywords: card.niche_keywords,
      languages: card.languages, audience: card.audience, platforms: card.platforms, content_type: card.content_type, must_include: card.must_include, banned: card.banned },
    networks: channels.map((c) => ({ channel_id: c.id, name: c.title, niche: c.niche, language: c.language, markets: c.markets, recent_titles: c.recent })),
  }), userId);
  const fits = new Map<string, any>((Array.isArray(ai.fits) ? ai.fits : []).map((f: any) => [String(f.channel_id), f]));
  const rate = Number(camp.rate_per_1k || 0), cap = camp.cap_per_post != null ? Number(camp.cap_per_post) : Infinity;
  const wantPlats: string[] = camp.platforms?.length ? camp.platforms : PLATFORMS;
  const langs: string[] = card.languages || [];
  const geo: { codes: string[]; min_pct: number | null }[] = card.audience?.countries || [];
  const matches = channels.map((c) => {
    const reasons: string[] = [], blockers: string[] = [], todo: string[] = [];
    const f = fits.get(c.id);
    const fit = Math.max(0, Math.min(100, Number(f?.fit) || 0));
    if (f?.why) (fit < 30 ? blockers : reasons).push(fit < 30 ? `Off-topic for this audience: ${clean(f.why, 200)}` : clean(f.why, 200));
    let score = fit * 0.4;
    // language
    if (!langs.length || langs.includes(c.language)) score += 15;
    else blockers.push(`Wants ${langs.map((l) => l.toUpperCase()).join("/")} content; this network is ${String(c.language || "?").toUpperCase()}.`);
    // audience countries
    if (!geo.length) score += 20;
    else if (!c.has_audience) { score += 10; todo.push("No audience data yet: check the countries in YouTube Studio."); }
    else {
      let factor = 1;
      for (const g of geo) {
        const share = g.codes.reduce((a, k) => a + (c.countries[k] || 0), 0);
        const min = g.min_pct || 0;
        factor *= min ? Math.min(1, share / min) : 1;
        const line = `${g.codes.join("+")} audience: ${share.toFixed(0)}%${min ? ` (needs ${min}%)` : ""}`;
        if (min && share < min) blockers.push(line); else reasons.push(line);
      }
      score += 20 * factor;
    }
    // followers
    const minF = Number(card.min_followers || 0);
    if (minF && c.subs != null && c.subs < minF) blockers.push(`Needs ${minF.toLocaleString("en")} followers; has ${Number(c.subs).toLocaleString("en")}.`);
    // platforms
    const ready = wantPlats.filter((p) => c.platforms.includes(p));
    if (ready.length) { score += 10; reasons.push(`Can post on: ${ready.join(", ")}`); }
    else todo.push(`Campaign platforms (${wantPlats.join(", ")}) aren't connected on this network yet.`);
    const missing = wantPlats.filter((p) => !c.platforms.includes(p));
    if (ready.length && missing.length) todo.push(`Not connected yet: ${missing.join(", ")}`);
    // reach
    const avg = c.uploads28 ? Math.round(c.views28 / c.uploads28) : 0;
    score += Math.max(0, Math.min(1, Math.log10(Math.max(avg, 1)) / 4)) * 15;
    const est = rate ? Math.min(cap, (avg / 1000) * rate) : null;
    return { channel_id: c.id, title: c.title, score: Math.round(score), fit, eligible: !blockers.length, reasons, blockers, todo,
      avg_views: avg, subs: c.subs, top_countries: Object.entries(c.countries).sort((a, b) => b[1] - a[1]).slice(0, 4), est_payout: est == null ? null : Math.round(est * 100) / 100 };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score);
  const na = ai.new_account && typeof ai.new_account === "object" ? {
    name: clean(ai.new_account.name, 60), handle: clean(ai.new_account.handle, 40), bio: clean(ai.new_account.bio, 200), niche: clean(ai.new_account.niche, 100),
    language: clean(ai.new_account.language, 5), platforms: list(ai.new_account.platforms, 5, 20), angles: list(ai.new_account.angles, 5), why: clean(ai.new_account.why, 300),
  } : null;
  const { data, error } = await db.from("campaigns").update({ matches, new_account: na, matched_at: new Date().toISOString() }).eq("id", camp.id).select().single();
  if (error) throw error;
  return { campaign: data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const cron = req.headers.get("x-cron-secret");
    let uid: string | null = null;
    if (cron) {
      if (cron !== (await db.rpc("get_cron_secret")).data) return json({ error: "not allowed" }, 403);
    } else {
      const user = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
      const [{ data: allowed }, { data: { user: u } }] = await Promise.all([user.rpc("am_i_allowed"), user.auth.getUser()]);
      if (!allowed || !u) return json({ error: "not allowed" }, 403);
      uid = u.id;
    }
    const body = await req.json().catch(() => ({}));
    if (body.action === "parse") return json(await parse(body, uid));
    if (body.action === "match") return json(await match(body, uid));
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 400);
  }
});
