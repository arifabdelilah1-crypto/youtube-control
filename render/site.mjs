// Pinterest & sites: a finished recipe video goes into its WordPress article and onto the site's Pinterest board.
// Called by render/autovideo.mjs when the run has options.site_article_id and every final check passed. Each part is saved as it
// is done (the media file, the embed, the pin), so trying again never uploads, embeds or pins twice.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const basic = (u, p) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");

/** The video block put in the article, after its first paragraph (a vertical video, not wider than a phone). */
function videoBlock(id, url, title) {
  const safe = String(title || "").replace(/[<>"]/g, "");
  return `\n<!-- wp:video {"id":${Number(id) || 0}} -->\n<figure class="wp-block-video" style="max-width:420px;margin:28px auto"><video controls playsinline preload="metadata" src="${url}" title="${safe}"></video></figure>\n<!-- /wp:video -->\n`;
}

export async function deliverToSite({ articleId, job, idea, call, rest, log, downloadFromVds, vdsPath }) {
  const set = (v) => rest("PATCH", "site_articles", `?id=eq.${articleId}`, v);
  const [article] = await rest("GET", "site_articles", `?id=eq.${articleId}&select=*`);
  if (!article) throw new Error("The article isn't in Pinterest & sites any more.");
  const site = await call("sites", { action: "wp_auth", site_id: article.site_id });
  if (!site.user || !site.password) throw new Error("This site has no WordPress login yet (Pinterest & sites → the site → WordPress).");
  const A = { Authorization: basic(site.user, site.password), "User-Agent": "YouTubeControl/1.0" };
  await set({ status: "embedding", error: null });

  // 1. the video in the site's media library (its address is public: the pin uses it too)
  let mediaUrl = article.video_url, mediaId = article.wp_media_id;
  if (!mediaUrl) {
    const file = path.join(os.tmpdir(), `${job.id}-site.mp4`);
    await downloadFromVds(vdsPath(job.output_path), file);
    const slug = (article.url.split("/").filter(Boolean).pop() || "rezept").replace(/[^a-z0-9-]/gi, "").slice(0, 60) || "rezept";
    const r = await fetch(`${site.base_url}/wp-json/wp/v2/media`, { method: "POST", headers: { ...A, "Content-Type": "video/mp4", "Content-Disposition": `attachment; filename="${slug}-video.mp4"` }, body: fs.readFileSync(file) });
    const media = await r.json().catch(() => ({}));
    fs.rmSync(file, { force: true });
    if (!r.ok || !media.source_url) throw new Error(`WordPress didn't take the video (${r.status}): ${String(media.message || "").slice(0, 200)}`);
    mediaUrl = media.source_url; mediaId = media.id;
    await fetch(`${site.base_url}/wp-json/wp/v2/media/${mediaId}`, { method: "POST", headers: { ...A, "Content-Type": "application/json" }, body: JSON.stringify({ title: article.title, alt_text: article.title }) }).catch(() => null);
    await set({ wp_media_id: mediaId, video_url: mediaUrl });
    log(`video uploaded to ${site.base_url}: ${mediaUrl}`);
  }

  // 2. the video in the article, once
  if (site.embed && !article.embedded_at) {
    const r = await fetch(`${site.base_url}/wp-json/wp/v2/posts/${article.wp_id}?context=edit&_fields=id,content`, { headers: A });
    const post = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`WordPress didn't give the article (${r.status}): ${String(post.message || "").slice(0, 200)}`);
    const raw = String(post.content?.raw || "");
    if (!raw.includes(mediaUrl)) {
      const block = videoBlock(mediaId, mediaUrl, article.title);
      const marks = ["<!-- /wp:paragraph -->", "</p>"];
      const at = marks.map((m) => { const i = raw.indexOf(m); return i >= 0 ? i + m.length : -1; }).find((i) => i >= 0);
      const content = at !== undefined && at >= 0 ? raw.slice(0, at) + block + raw.slice(at) : block + raw;
      const u = await fetch(`${site.base_url}/wp-json/wp/v2/posts/${article.wp_id}`, { method: "POST", headers: { ...A, "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
      if (!u.ok) throw new Error(`WordPress didn't save the article (${u.status}): ${(await u.text()).slice(0, 200)}`);
    }
    await set({ embedded_at: new Date().toISOString() });
    log("video put in the article");
  }

  // 3. the pin, once, with the article's link
  if (site.pin && !article.pinned_at) {
    const out = await call("sites", { action: "pin", article_id: articleId, media_url: mediaUrl, title: idea.video_title || article.title, description: idea.video_description || article.title }, 140);
    log(`pinned: ${out.status || "sent"} ${out.url || ""}`);
  }
  // 4. the site's TikTok, once (a product account: its call to action ends the caption)
  if (site.tiktok && !article.tiktok_at) {
    const out = await call("sites", { action: "tiktok", article_id: articleId, media_url: mediaUrl, description: idea.video_description || article.title }, 140);
    log(`TikTok: ${out.status || "sent"} ${out.url || ""}`);
  }
  await set({ status: "done" });
  return mediaUrl;
}
