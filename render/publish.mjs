// Publishing (GitHub Actions).
//   node render/publish.mjs --auto <render_job_id>   after a final render: queue it if the channel's auto-publish is on
//   node render/publish.mjs <queue_id>               upload one queued video to YouTube, a Facebook Page (direct), or send it to Blotato
// YouTube: resumable upload with the channel's own Google connection; a future slot is sent as status.publishAt
// (the video stays private until then and YouTube publishes it at that time).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blotatoPost, createPost, uploadToBlotato, waitForPost } from "./blotato.mjs";
import { downloadFromVds, isVds, mediaLink, vdsPath } from "./media.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const URL_ = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BLOTATO = process.env.BLOTATO_API_KEY || "";
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function rest(method, table, query = "", body) {
  const r = await fetch(`${URL_}/rest/v1/${table}${query}`, {
    method, headers: { ...H, "Content-Type": "application/json", Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${table} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.status === 204 ? null : r.json();
}
async function cronSecret() {
  const r = await fetch(`${URL_}/rest/v1/rpc/get_cron_secret`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: "{}" });
  if (!r.ok) throw new Error(`get_cron_secret ${r.status}`);
  return r.json();
}
async function fn(name, body) {
  const r = await fetch(`${URL_}/functions/v1/${name}`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": await cronSecret() }, body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `${name} ${r.status}`);
  return data;
}

async function videoFile(job) {
  const local = path.join(ROOT, "render-output.mp4");   // downloaded artifact (long videos) or the render that just finished
  if (fs.existsSync(local)) return local;
  if (!job.output_path) throw new Error("The video file is gone: it isn't in Storage and no GitHub artifact was found (artifacts are kept 7 days). Render it again.");
  if (isVds(job.output_path)) { await downloadFromVds(vdsPath(job.output_path), local); return local; }
  const r = await fetch(`${URL_}/storage/v1/object/renders/${job.output_path}`, { headers: H });
  if (!r.ok) throw new Error(`download ${r.status}: the rendered file may have been deleted. Render it again.`);
  fs.writeFileSync(local, Buffer.from(await r.arrayBuffer()));
  return local;
}

async function signedUrl(objectPath) {
  if (isVds(objectPath)) return mediaLink("GET", vdsPath(objectPath), 7 * 86400);
  const r = await fetch(`${URL_}/storage/v1/object/sign/renders/${objectPath}`, {
    method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 7 * 86400 }),
  });
  if (!r.ok) throw new Error(`sign ${r.status}`);
  return `${URL_}/storage/v1${(await r.json()).signedURL}`;
}

/** The project's thumbnail goes up after the video. A refusal never undoes the upload: it's reported on the queue row. */
async function setThumbnail(row, job, videoId, token) {
  if (!job.project_id) return null;
  const [project] = await rest("GET", "video_projects", `?id=eq.${job.project_id}&select=settings`);
  const objectPath = project?.settings?.thumbnail?.file?.path;
  if (!isVds(objectPath)) return null;
  try {
    const image = await fetch(mediaLink("GET", vdsPath(objectPath)));
    if (!image.ok) throw new Error(`the image isn't on the VDS (${image.status})`);
    const body = Buffer.from(await image.arrayBuffer());
    const r = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg", "Content-Length": String(body.length) }, body,
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      const reason = data.error?.errors?.[0]?.reason || data.error?.message || r.status;
      throw new Error(reason === "forbidden" ? "this channel can't use custom thumbnails yet: verify it by phone in YouTube Studio" : String(reason));
    }
    log("Thumbnail set");
    return null;
  } catch (e) {
    log(`Thumbnail not set: ${e.message}`);
    return `The video went up, but its thumbnail didn't: ${e.message}`.slice(0, 500);
  }
}

async function toYouTube(row, sched, file, job) {
  const { access_token } = await fn("publish", { action: "token", channel_id: row.channel_id });
  const future = row.slot_at && Date.parse(row.slot_at) > Date.now() + 5 * 60e3;
  const privacy = row.options?.privacy || sched?.privacy || "public";
  const meta = {
    snippet: {
      title: row.title.replace(/[<>]/g, "").slice(0, 100), description: (row.description || "").replace(/[<>]/g, ""),
      tags: (row.tags || []).slice(0, 30), categoryId: sched?.category_id || "22",
    },
    status: {
      privacyStatus: future && privacy === "public" ? "private" : privacy,
      ...(future && privacy === "public" ? { publishAt: new Date(row.slot_at).toISOString() } : {}),
      selfDeclaredMadeForKids: false, containsSyntheticMedia: !!sched?.synthetic_media,
    },
  };
  const size = fs.statSync(file).size;
  const notify = sched?.notify_subscribers === false ? "false" : "true";
  const init = await fetch(`https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=${notify}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Length": String(size), "X-Upload-Content-Type": "video/mp4" },
    body: JSON.stringify(meta),
  });
  if (!init.ok) throw new Error(`YouTube upload start ${init.status}: ${(await init.text()).slice(0, 400)}`);
  const location = init.headers.get("location");
  log(`Uploading ${(size / 1048576).toFixed(1)} MB to YouTube…`);
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(location, { method: "PUT", headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "video/mp4", "Content-Length": String(size) }, body: fs.readFileSync(file) });
    if (res.ok || (res.status < 500 && res.status !== 429)) break;
    log(`upload attempt ${attempt + 1} failed (${res.status}), retrying`);
    await new Promise((r) => setTimeout(r, 10000 * (attempt + 1)));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) throw new Error(`YouTube upload ${res.status}: ${JSON.stringify(data.error || data).slice(0, 400)}`);
  const warnings = [await setThumbnail(row, job, data.id, access_token), await markPaidPromotion(job, data.id, access_token)].filter(Boolean);
  return { youtube_video_id: data.id, status: meta.status.publishAt ? "scheduled" : "published", warning: warnings.join(" ") || null };
}

/** A video made for a paid campaign (Campaigns page) gets YouTube's "Includes paid promotion" label, as YouTube and the brands require. */
async function markPaidPromotion(job, videoId, token) {
  try {
    const posts = await rest("GET", "campaign_posts", `?render_job_id=eq.${job.id}&select=id&limit=1`);
    if (!posts?.length) return null;
    const r = await fetch("https://www.googleapis.com/youtube/v3/videos?part=paidProductPlacementDetails", {
      method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: videoId, paidProductPlacementDetails: { hasPaidProductPlacement: true } }),
    });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
    log("Marked as paid promotion");
    return null;
  } catch (e) {
    log(`Paid promotion label not set: ${e.message}`);
    return `Turn on "Includes paid promotion" for this video in YouTube Studio: it couldn't be set automatically (${e.message}).`.slice(0, 400);
  }
}

/** The project's thumbnail as a local file, when there is one. */
async function thumbnailFile(job) {
  if (!job.project_id) return null;
  const [project] = await rest("GET", "video_projects", `?id=eq.${job.project_id}&select=settings`);
  const objectPath = project?.settings?.thumbnail?.file?.path;
  if (!isVds(objectPath)) return null;
  const local = path.join(ROOT, "thumbnail.jpg");
  const r = await fetch(mediaLink("GET", vdsPath(objectPath)));
  if (!r.ok) throw new Error(`the image isn't on the VDS (${r.status})`);
  fs.writeFileSync(local, Buffer.from(await r.arrayBuffer()));
  return local;
}

async function toBlotato(row, sched, job) {
  if (!BLOTATO) throw new Error("Add BLOTATO_API_KEY to the GitHub repo secrets.");
  const saved = (Array.isArray(sched.targets) ? sched.targets : []).find((x) => x.platform === row.platform) || {};
  // YouTube's visibility and labels are set with the channel's schedule in Publish
  const target = { ...(row.platform === "youtube" ? { ...saved, privacy: sched.privacy, notify: sched.notify_subscribers, synthetic: sched.synthetic_media } : saved), ...(row.options || {}) };
  if (row.platform === "facebook" && !target.page_id) throw new Error("Pick the Facebook Page for this network.");
  const future = row.slot_at && Date.parse(row.slot_at) > Date.now() + 5 * 60e3;
  const mediaUrl = await uploadToBlotato(BLOTATO, await videoFile(job), "video.mp4", "video/mp4");
  // TikTok takes its cover from the video's first frame; the others take the image. A failed cover never stops the post.
  let coverUrl = null;
  let warning = null;
  if (row.platform === "instagram" || row.platform === "youtube") {
    try {
      const cover = await thumbnailFile(job);
      if (cover) coverUrl = await uploadToBlotato(BLOTATO, cover, "cover.jpg", "image/jpeg");
    } catch (e) { warning = `The video went up, but its cover didn't: ${e.message}`.slice(0, 500); log(warning); }
  }
  const id = await createPost(BLOTATO, blotatoPost({ row, target, mediaUrl, coverUrl, scheduledTime: future ? new Date(row.slot_at).toISOString() : null }));
  log(`Sent to Blotato for ${row.platform}: ${id}`);
  // saved before waiting, so the post can still be followed if this job stops
  await rest("PATCH", "publish_queue", `?id=eq.${row.id}`, { blotato_post_id: id });
  if (future) return { blotato_post_id: id, status: "scheduled", warning };
  return { blotato_post_id: id, ...(await waitForPost(BLOTATO, id)), warning };
}

// ---------- Facebook Pages, directly (Connect Facebook on a network's page; no Blotato) ----------
const FB_GRAPH = "https://graph.facebook.com/v27.0";
class MetaError extends Error { constructor(message, meta) { super(message); this.meta = meta || {}; } }
async function fbPost(url, form) {
  const r = await fetch(url, { method: "POST", body: form });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new MetaError(`Facebook: ${data.error?.error_user_msg || data.error?.message || r.status}`, data.error);
  return data;
}
/** Meta refused the Page's token: that needs a reconnect, not a retry. 190 = token invalid or expired, 102 = session,
 *  10 and 200-299 = permission; and the app/user pair Meta stopped accepting ("Cannot call API for app … on behalf of user …"). */
function metaAuthProblem(e) {
  const m = e?.meta || {};
  const code = Number(m.code);
  return code === 190 || code === 102 || code === 10 || (code >= 200 && code < 300)
    || /cannot call api for app .* on behalf of user|session has expired|session has been invalidated|error validating access token|has not authorized application/i.test(`${m.message || ""} ${e?.message || ""}`);
}
async function markPageBroken(pageId, error) {
  const r = await fetch(`${URL_}/rest/v1/rpc/mark_meta_page_broken`, { method: "POST", headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ p_page_id: pageId, p_error: String(error || "").slice(0, 500) }) }).catch((e) => ({ ok: false, statusText: e.message }));
  log(r.ok ? `Facebook Page ${pageId} marked: reconnect needed` : `Couldn't mark the Page for a reconnect: ${r.status || ""} ${r.statusText || ""}`);
}
const formOf = (fields) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null && v !== "") f.append(k, String(v)); return f; };

/** A vertical Short of 90 s or less goes up as a Reel; anything else as a Page video. A future slot is scheduled by Facebook itself. */
async function toFacebook(row, sched, job) {
  const saved = (Array.isArray(sched.targets) ? sched.targets : []).find((x) => x.platform === "facebook") || {};
  const pageId = String(saved.page_id || "");
  if (!/^\d+$/.test(pageId)) throw new Error("Pick the Facebook Page for this network (Connect Facebook on its page).");
  try {
    return await facebookUpload(row, job, pageId);
  } catch (e) {
    if (!metaAuthProblem(e)) throw e;
    await markPageBroken(pageId, e.message);
    throw new Error(`Meta stopped accepting this Page's connection: click Reconnect Facebook on the network's page, then Send again. (${e.message})`);
  }
}

async function facebookUpload(row, job, pageId) {
  const tr = await fetch(`${URL_}/rest/v1/rpc/get_meta_page_token`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ p_page_id: pageId }) });
  const token = tr.ok ? await tr.json() : null;
  if (!token) throw new Error("This Facebook Page isn't connected any more. Click Connect Facebook on the network's page.");
  const file = await videoFile(job);
  const size = fs.statSync(file).size;
  // Facebook schedules from 10 minutes ahead; a slot closer than that goes out now
  const at = row.slot_at ? Math.floor(Date.parse(row.slot_at) / 1000) : 0;
  const future = at > Date.now() / 1000 + 11 * 60;
  const caption = [row.title, row.description].filter(Boolean).join("\n\n").slice(0, 5000);
  const vertical = (job.params?.aspect || "9:16") === "9:16";
  if (vertical && Number(job.duration_s || 0) <= 90) {
    const start = await fbPost(`${FB_GRAPH}/${pageId}/video_reels`, formOf({ upload_phase: "start", access_token: token }));
    const up = await fetch(`https://rupload.facebook.com/video-upload/v27.0/${start.video_id}`, {
      method: "POST", headers: { Authorization: `OAuth ${token}`, offset: "0", file_size: String(size) }, body: fs.readFileSync(file),
    });
    const upData = await up.json().catch(() => ({}));
    if (!up.ok || upData.success === false) throw new MetaError(`Facebook upload: ${upData.debug_info?.message || upData.error?.message || up.status}`, upData.error || upData.debug_info);
    await fbPost(`${FB_GRAPH}/${pageId}/video_reels`, formOf({
      upload_phase: "finish", video_id: start.video_id, access_token: token, description: caption, title: row.title,
      video_state: future ? "SCHEDULED" : "PUBLISHED", scheduled_publish_time: future ? at : null,
    }));
    log(`Facebook Reel ${future ? `scheduled for ${row.slot_at}` : "published"}: ${start.video_id}`);
    return { status: future ? "scheduled" : "published", public_url: `https://www.facebook.com/reel/${start.video_id}` };
  }
  const form = formOf({ access_token: token, title: row.title, description: caption, published: future ? "false" : "true", scheduled_publish_time: future ? at : null });
  form.append("source", new Blob([fs.readFileSync(file)], { type: "video/mp4" }), "video.mp4");
  const out = await fbPost(`https://graph-video.facebook.com/v27.0/${pageId}/videos`, form);
  log(`Facebook video ${future ? `scheduled for ${row.slot_at}` : "published"}: ${out.id}`);
  return { status: future ? "scheduled" : "published", public_url: `https://www.facebook.com/${pageId}/videos/${out.id}` };
}

// ---------- Instagram Reels, directly (the professional account linked to a Facebook Page connected with Connect Facebook) ----------
// The API can't schedule: the publish function's dispatcher (pg_cron "instagram-dispatch", every 5 minutes) starts this job
// when the slot comes, and the Reel goes out at once. Meta fetches the video itself from a signed link to the video store.
const IG_DAILY_LIMIT = 50;  // Instagram: 50 API posts per account in 24 h
async function igGet(pathAndQuery) {
  const r = await fetch(`${FB_GRAPH}/${pathAndQuery}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new MetaError(`Instagram: ${data.error?.error_user_msg || data.error?.message || r.status}`, data.error);
  return data;
}
async function toInstagram(row, sched, job) {
  const saved = (Array.isArray(sched.targets) ? sched.targets : []).find((x) => x.platform === "instagram") || {};
  const pageId = String(saved.page_id || "");
  if (!/^\d+$/.test(pageId)) throw new Error("Pick the Instagram account for this network (on its page, under Accounts).");
  try {
    return await instagramUpload(row, job, pageId);
  } catch (e) {
    if (!metaAuthProblem(e)) throw e;
    await markPageBroken(pageId, e.message);
    throw new Error(`Meta stopped accepting this Page's connection: click Reconnect Facebook on the network's page, then retry. (${e.message})`);
  }
}
async function instagramUpload(row, job, pageId) {
  const [page] = await rest("GET", "meta_pages", `?page_id=eq.${pageId}&select=page_id,name,ig_user_id,ig_username`);
  if (!page?.ig_user_id) throw new Error("This Facebook Page has no Instagram professional account linked. Link one in Instagram's settings, then click Reconnect Facebook.");
  const tr = await fetch(`${URL_}/rest/v1/rpc/get_meta_page_token`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ p_page_id: pageId }) });
  const token = tr.ok ? await tr.json() : null;
  if (!token) throw new Error("This Facebook Page isn't connected any more. Click Connect Facebook on the network's page.");
  const seconds = Number(job.duration_s || 0);
  if ((job.params?.aspect || "9:16") !== "9:16") throw new Error("Instagram Reels must be vertical (9:16). Render a 9:16 version, or turn Instagram off for this video.");
  if (seconds && (seconds < 3 || seconds > 90)) throw new Error(`Instagram Reels last 3 to 90 seconds; this video lasts ${Math.round(seconds)} s.`);
  if (!job.output_path) throw new Error("Instagram fetches the video from a link, and this render has no stored file (only a GitHub artifact). Render it again.");
  const ig = page.ig_user_id;
  // 50 posts in 24 h per account: past that, the Reel waits an hour in the queue
  const limit = await igGet(`${ig}/content_publishing_limit?${new URLSearchParams({ fields: "quota_usage,config", access_token: token })}`).catch(() => null);
  const used = Number(limit?.data?.[0]?.quota_usage ?? 0), cap = Number(limit?.data?.[0]?.config?.quota_total ?? IG_DAILY_LIMIT);
  if (used >= cap) {
    const later = new Date(Date.now() + 60 * 60e3).toISOString();
    log(`Instagram limit reached (${used}/${cap} in 24 h): waiting until ${later}`);
    return { status: "queued", slot_at: later, warning: `Instagram allows ${cap} posts in 24 hours for @${page.ig_username || ig}: this Reel waits and tries again at ${later.slice(11, 16)} UTC.` };
  }
  const tags = (row.tags || []).slice(0, 30).map((t) => `#${String(t).replace(/[^\p{L}\p{N}_]/gu, "")}`).filter((t) => t.length > 1);
  const caption = [row.title, row.description, tags.length && !/#\w/.test(row.description || "") ? tags.join(" ") : ""].filter(Boolean).join("\n\n").slice(0, 2200);
  const videoUrl = await signedUrl(job.output_path);
  const container = await fbPost(`${FB_GRAPH}/${ig}/media`, formOf({ media_type: "REELS", video_url: videoUrl, caption, share_to_feed: "true", access_token: token }));
  log(`Instagram container ${container.id}: Meta is fetching the video`);
  // Meta downloads and processes the video: usually under a minute, up to a few
  let state = "";
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const st = await igGet(`${container.id}?${new URLSearchParams({ fields: "status_code,status", access_token: token })}`);
    state = st.status_code;
    if (state === "FINISHED") break;
    if (state === "ERROR" || state === "EXPIRED") throw new Error(`Instagram couldn't process the video: ${st.status || state}`);
  }
  if (state !== "FINISHED") throw new Error("Instagram was still processing the video after 15 minutes. Retry it on the Publish page.");
  const published = await fbPost(`${FB_GRAPH}/${ig}/media_publish`, formOf({ creation_id: container.id, access_token: token }));
  const info = await igGet(`${published.id}?${new URLSearchParams({ fields: "permalink", access_token: token })}`).catch(() => ({}));
  log(`Instagram Reel published: ${info.permalink || published.id}`);
  return { status: "published", public_url: info.permalink || null, platform_post_id: published.id };
}

async function main() {
  if (!URL_ || !KEY) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  if (process.argv[2] === "--auto") {
    const jobId = process.argv[3] || "";
    if (!/^[0-9a-f-]{36}$/.test(jobId)) throw new Error("invalid job id");
    const out = await fn("publish", { action: "auto", render_job_id: jobId }).catch((e) => ({ error: e.message }));
    log(out.skipped ? `Not queued: ${out.skipped}` : out.error ? `Not queued: ${out.error}` : `Queued for ${out.row?.slot_at || "now"}`);
    return;
  }
  const queueId = process.argv[2] || "";
  if (!/^[0-9a-f-]{36}$/.test(queueId)) throw new Error("invalid queue id");
  const [row] = await rest("GET", "publish_queue", `?id=eq.${queueId}&select=*`);
  if (!row) throw new Error("queue item not found");
  if (["scheduled", "published", "cancelled"].includes(row.status)) { log(`Nothing to do: ${row.status}`); return; }
  const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
  await rest("PATCH", "publish_queue", `?id=eq.${queueId}`, { status: "uploading", error: null, run_url: runUrl });
  try {
    const [job] = await rest("GET", "render_jobs", `?id=eq.${row.render_job_id}&select=*`);
    const [sched] = await rest("GET", "publish_schedules", `?channel_id=eq.${row.channel_id}&select=*`);
    const settings = sched || { method: "youtube", privacy: "public", notify_subscribers: true, category_id: "22" };
    const result = row.method === "blotato" ? await toBlotato(row, settings, job)
      : row.method === "meta" ? (row.platform === "instagram" ? await toInstagram(row, settings, job) : await toFacebook(row, settings, job))
      : await toYouTube(row, settings, await videoFile(job), job);
    const { warning, ...saved } = result;
    await rest("PATCH", "publish_queue", `?id=eq.${queueId}`, { ...saved, error: warning || null });
    if (row.idea_id) await rest("PATCH", "ideas", `?id=eq.${row.idea_id}`, { stage: result.status === "published" ? "published" : "scheduled" });
    log(`${result.status === "published" ? "Published" : result.status === "uploading" ? "Still processing at Blotato" : `Scheduled for ${row.slot_at}`}${result.youtube_video_id ? `: https://youtu.be/${result.youtube_video_id}` : ""}`);
  } catch (e) {
    await rest("PATCH", "publish_queue", `?id=eq.${queueId}`, { status: "failed", error: String(e?.message || e).slice(0, 2000) });
    throw e;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
