// Recipe videos (the Recipes page): a recipe article of our own blog becomes a Short made from its own photos.
//   POST {action:"parse", url}  (team member) -> reads the article (WordPress API first, else the page), copies its photos (up to 12) to
//        Storage renders/materials/recipes/<idea_id>/, and saves an idea with ai.recipe {url, site, title, text, images: [{path, alt, heading, src}]}.
//        Returns {idea_id, recipe, previews: [signed links]}. The same link again updates the same idea.
//   POST {action:"start", idea_id, channel_id, images?: [indexes kept, 0-based], options: {length, look, publish, ai_model, angle}}
//        (team member) -> starts "Generate video" as a Mix (options.video_style "mix", options.recipe true): the explainer function sees
//        ai.recipe and plans the video on the article's photos. Returns {run_id}.
// Only for articles of our own sites: the photos are ours to use. Secrets: GITHUB_TOKEN, GITHUB_REPO.
import { createClient } from "npm:@supabase/supabase-js@2";
import { DOMParser } from "jsr:@b-fuze/deno-dom@0.1.48";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const GH_TOKEN = Deno.env.get("GITHUB_TOKEN") ?? "";
const GH_REPO = Deno.env.get("GITHUB_REPO") ?? "";
const UA = "Mozilla/5.0 (compatible; YouTubeControl/1.0; +recipe-videos)";
const LOOKS = new Set(["clean", "sunset", "notes", "glow", "minimal", "whiteboard", "vintage", "badges"]);
const MODELS = new Set(["claude-opus-5-5", "claude-fable-5-2", "claude-sonnet-5-5"]);
const MAX_PHOTOS = 12;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f-]{36}$/;
const clean = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const db = createClient(URL_, SERVICE);

/** The page's text in reading order (headings marked), and its photos with the heading each sits under. */
function readArticle(html: string, base: string) {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, "text/html")!;
  const root = doc.getElementById("root")!;
  const lines: string[] = [];
  const images: { src: string; alt: string; heading: string }[] = [];
  let heading = "";
  const seen = new Set<string>();
  const srcOf = (img: any) => {
    const set = String(img.getAttribute("data-srcset") || img.getAttribute("srcset") || "");
    const best = set.split(",").map((x) => x.trim().split(/\s+/)).filter((x) => x[0]).sort((a, b) => (parseInt(b[1]) || 0) - (parseInt(a[1]) || 0))[0]?.[0];
    const raw = best || img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || img.getAttribute("src") || "";
    try { return new URL(raw, base).href; } catch { return ""; }
  };
  const walk = (el: any) => {
    for (const node of Array.from(el.children || []) as any[]) {
      const tag = node.tagName?.toLowerCase();
      if (["script", "style", "noscript", "nav", "footer", "aside", "form", "button"].includes(tag)) continue;
      if (/^h[1-4]$/.test(tag)) { heading = clean(node.textContent, 200); if (heading) lines.push(`\n## ${heading}`); continue; }
      if (tag === "img") {
        const src = srcOf(node);
        const w = parseInt(node.getAttribute("width") || "0");
        if (src && !src.startsWith("data:") && !/\.svg(\?|$)|gravatar|emoji|logo|icon|avatar/i.test(src) && !(w && w < 300) && !seen.has(src)) {
          seen.add(src);
          images.push({ src, alt: clean(node.getAttribute("alt"), 300), heading });
        }
        continue;
      }
      if (["p", "li", "figcaption", "td", "th", "blockquote"].includes(tag)) {
        const t = clean(node.textContent, 1200);
        if (t) lines.push(tag === "li" ? `- ${t}` : t);
        for (const img of Array.from(node.querySelectorAll("img")) as any[]) walk({ children: [img] });
        continue;
      }
      walk(node);
    }
  };
  walk(root);
  return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), images };
}

async function get(url: string, accept = "text/html,application/json") {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: accept }, redirect: "follow", signal: AbortSignal.timeout(20000) });
  return r;
}

/** The article: WordPress's own API when the site has it (clean text, the featured photo first), else the page. */
async function fetchArticle(link: string) {
  const u = new URL(link);
  const slug = u.pathname.split("/").filter(Boolean).pop() || "";
  let title = "", html = "", featured: { src: string; alt: string } | null = null;
  if (slug) {
    for (const type of ["posts", "pages"]) {
      const r = await get(`${u.origin}/wp-json/wp/v2/${type}?slug=${encodeURIComponent(slug)}&_fields=id,title,content,featured_media,link`, "application/json").catch(() => null);
      if (!r?.ok) continue;
      const list = await r.json().catch(() => []);
      if (!Array.isArray(list) || !list.length) continue;
      const post = list[0];
      title = new DOMParser().parseFromString(`<p>${post.title?.rendered || ""}</p>`, "text/html")!.body.textContent.trim();
      html = post.content?.rendered || "";
      if (post.featured_media) {
        const m = await get(`${u.origin}/wp-json/wp/v2/media/${post.featured_media}?_fields=source_url,alt_text`, "application/json").catch(() => null);
        const media = m?.ok ? await m.json().catch(() => null) : null;
        if (media?.source_url) featured = { src: media.source_url, alt: clean(media.alt_text, 300) };
      }
      break;
    }
  }
  if (!html) {
    const r = await get(link);
    if (!r.ok) throw new Error(`The page answered ${r.status}`);
    const page = await r.text();
    const doc = new DOMParser().parseFromString(page, "text/html")!;
    title = clean(doc.querySelector("h1")?.textContent || doc.querySelector("title")?.textContent, 200);
    const body = doc.querySelector(".entry-content") || doc.querySelector("article") || doc.querySelector("main") || doc.body;
    html = body?.innerHTML || "";
    const og = doc.querySelector('meta[property="og:image"]')?.getAttribute("content");
    if (og) featured = { src: new URL(og, link).href, alt: "" };
  }
  const { text, images } = readArticle(html, link);
  // the featured photo first (unless it's already in the text, maybe in another size)
  const stem = (s: string) => s.replace(/-\d+x\d+(?=\.\w+($|\?))/, "").replace(/\?.*$/, "");
  if (featured && !images.some((i) => stem(i.src) === stem(featured!.src))) images.unshift({ src: featured.src, alt: featured.alt || images[0]?.alt || "", heading: title });
  return { title, text, images, site: u.hostname.replace(/^www\./, "") };
}

/** One photo copied to Storage: the full size first (WordPress adds -768x768 to its smaller copies), else the size in the page. */
async function copyPhoto(src: string, path: string) {
  const tries = [...new Set([src.replace(/-\d+x\d+(?=\.\w+($|\?))/, ""), src])];
  for (const t of tries) {
    const r = await get(t, "image/avif,image/webp,image/jpeg,image/png,*/*").catch(() => null);
    if (!r?.ok) continue;
    const type = r.headers.get("content-type") || "";
    if (!/^image\/(jpeg|png|webp)/.test(type)) continue;
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length < 8000 || bytes.length > 15e6) continue;
    const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
    const full = `${path}.${ext}`;
    const { error } = await db.storage.from("renders").upload(full, bytes, { contentType: type, upsert: true });
    if (error) throw new Error(`Storage: ${error.message}`);
    return full;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const userDb = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const cron = req.headers.get("x-cron-secret");
    const isService = !!cron && cron === (await db.rpc("get_cron_secret")).data;
    let user: any = null;
    if (!isService) {
      const [{ data: allowed }, { data: u }] = await Promise.all([userDb.rpc("am_i_allowed"), userDb.auth.getUser()]);
      if (!allowed || !u?.user) return json({ error: "not allowed" }, 403);
      user = u.user;
    }
    const body = await req.json().catch(() => ({}));

    if (body.action === "parse") {
      let link: URL;
      try { link = new URL(String(body.url || "").trim()); } catch { return json({ error: "Paste the article's full link (https://…)" }, 400); }
      if (link.protocol !== "https:") return json({ error: "Only https links" }, 400);
      link.hash = "";
      const url = link.href;
      const art = await fetchArticle(url);
      if (!art.images.length) return json({ error: "No photo found in this article. Recipe videos are made from the article's own photos." }, 422);
      if (art.text.length < 200) return json({ error: "The article's text couldn't be read." }, 422);
      // the same link again: the same idea
      const { data: old } = await db.from("ideas").select("id,channel_id").contains("sources", [{ type: "article", ref: url }]).limit(1);
      let ideaId = old?.[0]?.id;
      if (!ideaId) {
        const { data: made, error } = await db.from("ideas").insert({ title: clean(art.title, 200) || url, video_title: clean(art.title, 100) || null, stage: "new",
          notes: `Recipe video from ${url}`, sources: [{ type: "article", ref: url, site: art.site }], channel_id: UUID.test(body.channel_id || "") ? body.channel_id : null }).select("id").single();
        if (error) throw error;
        ideaId = made.id;
      }
      const images = [];
      for (const [i, im] of art.images.slice(0, MAX_PHOTOS).entries()) {
        const path = await copyPhoto(im.src, `materials/recipes/${ideaId}/${i + 1}`).catch(() => null);
        if (path) images.push({ path, alt: im.alt, heading: clean(im.heading, 200), src: im.src });
      }
      if (!images.length) return json({ error: "The article's photos couldn't be downloaded." }, 422);
      const recipe = { url, site: art.site, title: clean(art.title, 200), text: art.text.slice(0, 20000), images, read_at: new Date().toISOString() };
      const { data: cur } = await db.from("ideas").select("ai").eq("id", ideaId).single();
      await db.from("ideas").update({ ai: { ...(cur?.ai || {}), recipe }, title: clean(art.title, 200) || url }).eq("id", ideaId);
      const { data: signed } = await db.storage.from("renders").createSignedUrls(images.map((i) => i.path), 6 * 3600);
      return json({ idea_id: ideaId, recipe: { ...recipe, text: recipe.text.slice(0, 1500) }, previews: (signed || []).map((s: any) => s.signedUrl || null) });
    }

    if (body.action === "start") {
      const id = UUID.test(body.idea_id || "") ? body.idea_id : "";
      const { data: idea } = id ? await db.from("ideas").select("id,channel_id,ai").eq("id", id).single() : { data: null };
      if (!idea?.ai?.recipe?.images?.length) return json({ error: "Read the article first." }, 404);
      const channelId = UUID.test(body.channel_id || "") ? body.channel_id : idea.channel_id;
      if (!channelId) return json({ error: "Pick the network the video is for." }, 400);
      const { data: active } = await db.from("video_runs").select("id").eq("idea_id", id).in("status", ["queued", "running"]).limit(1);
      if (active?.length) return json({ run_id: active[0].id, already: true });
      if (!GH_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(GH_REPO)) return json({ error: "Add GITHUB_TOKEN and GITHUB_REPO in Supabase Edge Function secrets." }, 503);
      // the photos kept (the page can leave some out)
      const all = idea.ai.recipe.all_images || idea.ai.recipe.images;
      const keep = Array.isArray(body.images) ? body.images.map(Number).filter((n: number) => Number.isInteger(n) && n >= 0 && n < all.length) : null;
      const images = keep?.length ? [...new Set<number>(keep)].sort((a, b) => a - b).map((n) => all[n]) : all;
      await db.from("ideas").update({ channel_id: channelId, ai: { ...idea.ai, recipe: { ...idea.ai.recipe, all_images: all, images } } }).eq("id", id);
      const o = body.options && typeof body.options === "object" ? body.options : {};
      const options = {
        language: null, aspect: "9:16", length: ["short45", "short60"].includes(o.length) ? o.length : "short45",
        angle: o.angle ? clean(o.angle, 300).replace(/[<>]/g, "") : null, voice: null, voice_style: null,
        music: false, sounds: false, keep_script: false, publish: o.publish === "next" ? "next" : "ask",
        video_style: "mix", recipe: true, ai_model: MODELS.has(o.ai_model) ? o.ai_model : "claude-opus-5-5", look: LOOKS.has(o.look) ? o.look : "clean",
      };
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
    return json({ error: String((e as Error).message || e).slice(0, 500) }, 500);
  }
});
