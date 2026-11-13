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
  const warning = await setThumbnail(row, job, data.id, access_token);
  return { youtube_video_id: data.id, status: meta.status.publishAt ? "scheduled" : "published", warning };
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
async function fbPost(url, form) {
  const r = await fetch(url, { method: "POST", body: form });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(`Facebook: ${data.error?.error_user_msg || data.error?.message || r.status}`);
  return data;
}
const formOf = (fields) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null && v !== "") f.append(k, String(v)); return f; };

/** A vertical Short of 90 s or less goes up as a Reel; anything else as a Page video. A future slot is scheduled by Facebook itself. */
async function toFacebook(row, sched, job) {
  const saved = (Array.isArray(sched.targets) ? sched.targets : []).find((x) => x.platform === "facebook") || {};
  const pageId = String(saved.page_id || "");
  if (!/^\d+$/.test(pageId)) throw new Error("Pick the Facebook Page for this network (Connect Facebook on its page).");
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
    if (!up.ok || upData.success === false) throw new Error(`Facebook upload: ${upData.debug_info?.message || upData.error?.message || up.status}`);
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
      : row.method === "meta" ? await toFacebook(row, settings, job)
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
