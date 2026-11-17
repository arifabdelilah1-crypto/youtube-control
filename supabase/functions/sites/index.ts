// Pinterest & sites: our WordPress sites, their Pinterest boards (through Blotato) and one recipe video a day per site.
//   POST {action:"pinterest_accounts"}                 (team) -> the Pinterest accounts connected in Blotato, each with its boards
//   POST {action:"test", site_id}                      (team) -> checks the WordPress login (application password) and saves the result
//   POST {action:"sync", site_id}                      (team or cron) -> reads the site's published posts into site_articles
//   POST {action:"make", article_id}                   (team or cron) -> reads the article and starts its recipe video (recipe function)
//   POST {action:"daily"}                              (cron) -> one article per site with "daily" on, at most 4 sites per call
//   POST {action:"wp_auth", site_id}                   (cron: the video job) -> {base_url, user, password}
//   POST {action:"pin", article_id, media_url, title, description} (cron: the video job) -> pins the video with the article's link
//   POST {action:"tiktok", article_id, media_url, description}      (cron: the video job) -> posts it on the site's TikTok, with its call to action
// Secrets: BLOTATO_API_KEY (as the publish function).
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const BLOTATO = Deno.env.get("BLOTATO_API_KEY") ?? "";
const BLOTATO_API = "https://backend.blotato.com/v2";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f-]{36}$/;
const db = createClient(URL_, SERVICE);
const strip = (s: unknown) => String(s ?? "").replace(/<[^>]*>/g, "").replace(/&#8211;/g, "–").replace(/&#8217;/g, "’").replace(/&amp;/g, "&").replace(/&#8220;|&#8221;|&quot;/g, "\"").replace(/\s+/g, " ").trim();

async function blotato(path: string, init: RequestInit = {}) {
  if (!BLOTATO) throw new Error("Blotato isn't set up: add BLOTATO_API_KEY in Supabase Edge Function secrets.");
  const r = await fetch(`${BLOTATO_API}${path}`, { ...init, headers: { "blotato-api-key": BLOTATO, "Content-Type": "application/json", ...(init.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`Blotato ${r.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : {};
}

async function auth(siteId: string) {
  const { data: site } = await db.from("sites").select("*").eq("id", siteId).single();
  if (!site) throw new Error("site not found");
  const { data: password } = await db.rpc("site_wp_password", { p_site: siteId });
  return { site, user: site.wp_user || "", password: String(password || "") };
}
const basic = (u: string, p: string) => "Basic " + btoa(unescape(encodeURIComponent(`${u}:${p}`)));

async function callFn(name: string, body: unknown, secret: string) {
  const r = await fetch(`${URL_}/functions/v1/${name}`, { method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": secret }, body: JSON.stringify(body), signal: AbortSignal.timeout(140000) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok || out.error) throw new Error(out.error || `${name} ${r.status}`);
  return out;
}

async function sync(siteId: string) {
  const { data: site } = await db.from("sites").select("*").eq("id", siteId).single();
  if (!site) throw new Error("site not found");
  let page = 1, pages = 1, n = 0;
  while (page <= pages && page <= 20) {
    const r = await fetch(`${site.base_url}/wp-json/wp/v2/posts?status=publish&per_page=100&page=${page}&_fields=id,link,title,date_gmt`, { headers: { "User-Agent": "YouTubeControl/1.0" }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) { if (page === 1) throw new Error(`${site.base_url} answered ${r.status} for its posts`); break; }
    pages = Number(r.headers.get("x-wp-totalpages") || 1);
    const posts = await r.json();
    if (!Array.isArray(posts) || !posts.length) break;
    const rows = posts.map((p: any) => ({ site_id: site.id, wp_id: p.id, url: String(p.link || ""), title: strip(p.title?.rendered) || String(p.link || ""), published_at: p.date_gmt ? `${p.date_gmt}Z` : null }))
      .filter((x: any) => /^https:\/\//.test(x.url));
    const { error } = await db.from("site_articles").upsert(rows, { onConflict: "site_id,wp_id", ignoreDuplicates: false });
    if (error) throw error;
    n += rows.length; page++;
  }
  const { count } = await db.from("site_articles").select("id", { count: "exact", head: true }).eq("site_id", site.id);
  await db.from("sites").update({ synced_at: new Date().toISOString(), articles_count: count || 0 }).eq("id", site.id);
  return { read: n, articles: count || 0 };
}

async function make(articleId: string, secret: string) {
  const { data: a } = await db.from("site_articles").select("*, sites(*)").eq("id", articleId).single();
  if (!a) throw new Error("article not found");
  const site = a.sites;
  if (!site.channel_id) throw new Error(`Pick the network (voice and language) for ${site.name} first.`);
  if (["making", "embedding"].includes(a.status)) return { already: true };
  await db.from("site_articles").update({ status: "making", error: null }).eq("id", a.id);
  try {
    const parsed = await callFn("recipe", { action: "parse", url: a.url, channel_id: site.channel_id }, secret);
    const started = await callFn("recipe", { action: "start", idea_id: parsed.idea_id, channel_id: site.channel_id,
      options: { length: "short45", look: site.look || "clean", publish: "ask", ai_model: site.ai_model || "claude-sonnet-5-5", site_article_id: a.id } }, secret);
    await db.from("site_articles").update({ idea_id: parsed.idea_id, video_run_id: started.run_id }).eq("id", a.id);
    return { run_id: started.run_id };
  } catch (e) {
    await db.from("site_articles").update({ status: "failed", error: String((e as Error).message || e).slice(0, 500) }).eq("id", a.id);
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const secret = (await db.rpc("get_cron_secret")).data as string;
    const isService = !!req.headers.get("x-cron-secret") && req.headers.get("x-cron-secret") === secret;
    if (!isService) {
      const userDb = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
      if (!(await userDb.rpc("am_i_allowed")).data) return json({ error: "not allowed" }, 403);
      if (["daily", "wp_auth", "pin", "tiktok"].includes(body.action)) return json({ error: "not allowed" }, 403);
    }

    if (body.action === "pinterest_accounts") {
      const all = await blotato("/users/me/accounts");
      const list = (Array.isArray(all) ? all : all.items || all.accounts || []).filter((x: any) => String(x.platform || "").toLowerCase() === "pinterest");
      const out = [];
      for (const acc of list) {
        const boards = await blotato(`/social/pinterest/boards?accountId=${encodeURIComponent(acc.id)}`).catch(() => ({ items: [] }));
        out.push({ id: String(acc.id), name: acc.fullname || acc.name || acc.username || String(acc.id), username: acc.username || null,
          boards: (Array.isArray(boards) ? boards : boards.items || boards.boards || []).map((b: any) => ({ id: String(b.id), name: b.name || String(b.id) })) });
      }
      return json({ accounts: out });
    }

    // every account connected in Blotato (any platform), to link new ones to networks
    if (body.action === "blotato_all") {
      const all = await blotato("/users/me/accounts");
      return json({ accounts: (Array.isArray(all) ? all : all.items || all.accounts || []).map((x: any) => ({ id: String(x.id), platform: x.platform, name: x.username || x.fullname || x.name || null })) });
    }

    // is the Blotato key good for uploads? (the publish job uses its own copy, in the GitHub repo secrets)
    if (body.action === "blotato_check") {
      const r = await fetch(`${BLOTATO_API}/media/uploads`, { method: "POST", headers: { "blotato-api-key": BLOTATO, "Content-Type": "application/json" }, body: JSON.stringify({ filename: "check.mp4" }) });
      return json({ status: r.status, ok: r.ok });
    }

    if (body.action === "test") {
      const { site, user, password } = await auth(body.site_id);
      if (!user || !password) return json({ ok: false, error: "Add the WordPress user and application password first." });
      const r = await fetch(`${site.base_url}/wp-json/wp/v2/users/me?context=edit&_fields=id,name,capabilities`, { headers: { Authorization: basic(user, password) }, signal: AbortSignal.timeout(20000) });
      const me = await r.json().catch(() => ({}));
      const ok = r.ok && !!(me?.capabilities?.upload_files && (me?.capabilities?.edit_published_posts || me?.capabilities?.edit_others_posts));
      await db.from("sites").update({ wp_ok: ok, wp_checked_at: new Date().toISOString() }).eq("id", site.id);
      return json(ok ? { ok, name: me.name } : { ok: false, error: r.ok ? "Logged in, but this user can't upload files or edit published posts." : `WordPress answered ${r.status}: ${String(me?.message || "").slice(0, 200)}` });
    }

    if (body.action === "sync") return json(await sync(body.site_id));
    if (body.action === "make") return json(await make(body.article_id, secret));

    if (body.action === "daily") {
      const today = new Date().toISOString().slice(0, 10);
      const { count: active } = await db.from("video_runs").select("id", { count: "exact", head: true }).in("status", ["queued", "running"]);
      let room = Math.max(0, 8 - (active || 0));
      const { data: sites } = await db.from("sites").select("*").eq("daily", true).not("channel_id", "is", null).or(`last_daily_on.is.null,last_daily_on.lt.${today}`).limit(4);
      const done = [];
      for (const site of sites || []) {
        if (room <= 0) break;
        if (!site.synced_at || Date.now() - Date.parse(site.synced_at) > 20 * 3600e3) await sync(site.id).catch(() => null);
        const { data: next } = await db.from("site_articles").select("id,title").eq("site_id", site.id).eq("status", "new").order("published_at", { ascending: false }).limit(1);
        await db.from("sites").update({ last_daily_on: today }).eq("id", site.id);
        if (!next?.length) { done.push({ site: site.name, skipped: "every article has its video" }); continue; }
        try { const out = await make(next[0].id, secret); done.push({ site: site.name, article: next[0].title, ...out }); room--; }
        catch (e) { done.push({ site: site.name, error: String((e as Error).message || e) }); }
      }
      return json({ done });
    }

    if (body.action === "wp_auth") {
      const { site, user, password } = await auth(body.site_id);
      return json({ base_url: site.base_url, user, password, embed: site.embed, pin: site.pin, tiktok: !!site.tiktok_account_id });
    }

    if (body.action === "pin") {
      const { data: a } = await db.from("site_articles").select("*, sites(*)").eq("id", body.article_id).single();
      if (!a) return json({ error: "article not found" }, 404);
      const site = a.sites;
      if (!site.pinterest_account_id || !site.pinterest_board_id) return json({ error: `Pick the Pinterest account and board for ${site.name}.` }, 400);
      const title = String(body.title || a.title).slice(0, 100);
      const text = String(body.description || a.title).replace(/(^|\n)Credits:[\s\S]*$/, "").slice(0, 480);
      const post = await blotato("/posts", { method: "POST", body: JSON.stringify({ post: {
        accountId: site.pinterest_account_id,
        content: { platform: "pinterest", text, mediaUrls: [String(body.media_url)] },
        target: { targetType: "pinterest", boardId: site.pinterest_board_id, title, link: a.url, altText: title },
      } }) });
      const id = String(post.postSubmissionId || post.id || "");
      await db.from("site_articles").update({ blotato_post_id: id, pinned_at: new Date().toISOString() }).eq("id", a.id);
      // a little wait for the link to the pin (Blotato publishes in the background)
      let state = null;
      for (let i = 0; i < 6 && id; i++) {
        await new Promise((r) => setTimeout(r, 8000));
        state = await blotato(`/posts/${encodeURIComponent(id)}`).catch(() => null);
        if (state?.status === "published" || state?.status === "failed") break;
      }
      if (state?.status === "failed") {
        const err = String(state.errorMessage || state.error || "Blotato couldn't publish the pin").slice(0, 300);
        await db.from("site_articles").update({ error: `Pin: ${err}` }).eq("id", a.id);
        return json({ error: err }, 502);
      }
      if (state?.publicUrl) await db.from("site_articles").update({ pin_url: state.publicUrl }).eq("id", a.id);
      return json({ ok: true, id, status: state?.status || "sent", url: state?.publicUrl || null });
    }
    if (body.action === "tiktok") {
      const { data: a } = await db.from("site_articles").select("*, sites(*)").eq("id", body.article_id).single();
      if (!a) return json({ error: "article not found" }, 404);
      const site = a.sites;
      if (!site.tiktok_account_id) return json({ error: `${site.name} has no TikTok account.` }, 400);
      const desc = String(body.description || a.title).replace(/(^|\n)Credits:[\s\S]*$/, "").replace(/(^|\n)(Zum Rezept|Full recipe)[^\n]*/g, "").trim();
      const text = [desc, site.tiktok_cta || ""].filter(Boolean).join("\n\n").slice(0, 2100);
      const post = await blotato("/posts", { method: "POST", body: JSON.stringify({ post: {
        accountId: site.tiktok_account_id,
        content: { platform: "tiktok", text, mediaUrls: [String(body.media_url)] },
        target: { targetType: "tiktok", privacyLevel: "PUBLIC_TO_EVERYONE", disabledComments: false, disabledDuet: false, disabledStitch: false,
          isBrandedContent: false, isYourBrand: site.tiktok_your_brand !== false, isAiGenerated: true },
      } }) });
      const id = String(post.postSubmissionId || post.id || "");
      await db.from("site_articles").update({ tiktok_post_id: id, tiktok_at: new Date().toISOString() }).eq("id", a.id);
      let state = null;
      for (let i = 0; i < 8 && id; i++) {
        await new Promise((r) => setTimeout(r, 8000));
        state = await blotato(`/posts/${encodeURIComponent(id)}`).catch(() => null);
        if (state?.status === "published" || state?.status === "failed") break;
      }
      if (state?.status === "failed") {
        const err = String(state.errorMessage || state.error || "Blotato couldn't publish it").slice(0, 300);
        await db.from("site_articles").update({ error: `TikTok: ${err}` }).eq("id", a.id);
        return json({ error: err }, 502);
      }
      if (state?.publicUrl) await db.from("site_articles").update({ tiktok_url: state.publicUrl }).eq("id", a.id);
      return json({ ok: true, id, status: state?.status || "sent", url: state?.publicUrl || null });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e).slice(0, 500) }, 500);
  }
});
