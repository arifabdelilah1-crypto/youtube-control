// Final render of an editor project (runs in the GitHub Actions "Render final video" workflow).
//   node render/render.mjs <render_job_id>
// Reads the project + scenes, signs the private audio/media URLs, renders <Main> with Remotion,
// uploads the MP4 to the private 'renders' bucket (resumable, 6 MB chunks) and marks the job done.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { buildProps } from "../video/layout.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const URL_ = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const MAX_BYTES = 48 * 1024 * 1024;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function rest(method, table, query = "", body) {
  const r = await fetch(`${URL_}/rest/v1/${table}${query}`, {
    method, headers: { ...H, "Content-Type": "application/json", Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${table} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.status === 204 ? null : r.json();
}
const update = (table, id, values) => rest("PATCH", table, `?id=eq.${id}`, values);

async function signMany(paths) {
  if (!paths.length) return {};
  const r = await fetch(`${URL_}/storage/v1/object/sign/renders`, {
    method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 4 * 3600, paths }),
  });
  if (!r.ok) throw new Error(`sign ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const out = {};
  for (const item of await r.json()) if (item.signedURL) out[item.path] = `${URL_}/storage/v1${item.signedURL}`;
  return out;
}

async function withRetry(what, fn) {
  let err;
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fn();
      if (r.status < 500 && r.status !== 429) return r;
      err = `${r.status}: ${(await r.text()).slice(0, 200)}`;
    } catch (e) { err = String(e); }
    log(`${what} attempt ${i + 1} failed (${err}); retrying`);
    await new Promise((res) => setTimeout(res, 5000 * (i + 1)));
  }
  throw new Error(`${what} failed after 5 attempts: ${err}`);
}

// Supabase resumable (TUS) upload, 6 MB chunks.
async function upload(file, objectPath) {
  const data = fs.readFileSync(file);
  if (data.length > MAX_BYTES + 2 * 1024 * 1024) throw new Error(`video is ${(data.length / 1048576).toFixed(1)} MB, over the 50 MB storage limit`);
  const b64 = (s) => Buffer.from(s).toString("base64");
  const tus = { ...H, "Tus-Resumable": "1.0.0" };
  const start = await withRetry("upload start", () => fetch(`${URL_}/storage/v1/upload/resumable`, {
    method: "POST",
    headers: { ...tus, "Upload-Length": String(data.length), "x-upsert": "true",
      "Upload-Metadata": `bucketName ${b64("renders")},objectName ${b64(objectPath)},contentType ${b64("video/mp4")},cacheControl ${b64("3600")}` },
  }));
  let loc = start.headers.get("location");
  if (start.status >= 400 || !loc) throw new Error(`upload start failed ${start.status}: ${(await start.text()).slice(0, 300)}`);
  if (loc.startsWith("/")) loc = URL_ + loc;
  const CHUNK = 6 * 1024 * 1024;
  let offset = 0;
  while (offset < data.length) {
    const chunk = data.subarray(offset, offset + CHUNK);
    const r = await withRetry(`chunk at ${Math.floor(offset / 1048576)} MB`, () => fetch(loc, {
      method: "PATCH", headers: { ...tus, "Upload-Offset": String(offset), "Content-Type": "application/offset+octet-stream" }, body: chunk,
    }));
    if (r.status === 409) {
      const head = await fetch(loc, { method: "HEAD", headers: tus });
      offset = Number(head.headers.get("upload-offset") ?? offset);
      continue;
    }
    if (r.status >= 400) throw new Error(`chunk failed ${r.status}: ${(await r.text()).slice(0, 300)}`);
    offset = Number(r.headers.get("upload-offset") ?? offset + chunk.length);
  }
  log(`Uploaded ${(data.length / 1048576).toFixed(1)} MB to renders/${objectPath}`);
}

async function main() {
  const jobId = process.argv[2] || "";
  if (!/^[0-9a-f-]{36}$/.test(jobId)) throw new Error("invalid job id");
  if (!URL_ || !KEY) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const runUrl = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
  const [job] = await rest("GET", "render_jobs", `?id=eq.${jobId}&select=*`);
  if (!job) throw new Error("job not found");
  await update("render_jobs", jobId, { status: "running", started_at: new Date().toISOString(), run_url: runUrl, error: null });

  try {
    const projectId = job.project_id || job.params?.project_id;
    const [project] = await rest("GET", "video_projects", `?id=eq.${projectId}&select=*`);
    if (!project) throw new Error("project not found");
    const scenes = await rest("GET", "project_scenes", `?project_id=eq.${projectId}&select=*&order=idx`);
    const stale = scenes.filter((s) => !s.voice_path || s.voice_text !== s.text);
    if (stale.length) throw new Error(`${stale.length} scene(s) have no up-to-date voice. Press “Update voice” in the editor first.`);

    // Private files -> signed URLs
    const music = project.settings?.music || {};
    let track = null;
    if (music.track_id) [track] = await rest("GET", "music_tracks", `?id=eq.${music.track_id}&select=*`);
    else if (music.mood && music.mood !== "none") {
      const tracks = await rest("GET", "music_tracks", `?mood=eq.${encodeURIComponent(music.mood)}&select=*`);
      track = tracks.length ? tracks[Math.floor(Math.random() * tracks.length)] : null;
    }
    const mediaPaths = scenes.map((s) => s.clip?.path).filter(Boolean);
    const signed = await signMany([...scenes.map((s) => s.voice_path), ...mediaPaths, ...(track ? [track.path] : [])]);
    const urls = {
      voice: Object.fromEntries(scenes.map((s) => [s.id, signed[s.voice_path]])),
      media: Object.fromEntries(mediaPaths.map((p) => [p, signed[p]])),
      music: track ? signed[track.path] : null,
      sfx: { whoosh: "static:sfx/whoosh.mp3", hit: "static:sfx/hit.mp3" },
    };
    const inputProps = buildProps(project, scenes, urls);
    log(`Project "${project.title}": ${scenes.length} scenes, ${(inputProps.totalFrames / inputProps.fps).toFixed(1)} s, ${inputProps.width}x${inputProps.height}${track ? `, music "${track.title}"` : ""}`);

    await ensureBrowser();
    const serveUrl = await bundle({ entryPoint: path.join(ROOT, "video/root.jsx"), publicDir: path.join(ROOT, "web") });
    const composition = await selectComposition({ serveUrl, id: "Main", inputProps });
    const out = path.join(ROOT, "render-output.mp4");
    let last = -1;
    await renderMedia({
      composition, serveUrl, codec: "h264", outputLocation: out, inputProps,
      concurrency: os.cpus().length, crf: 23, encodingMaxRate: "5M", encodingBufferSize: "10M", x264Preset: "veryfast", audioBitrate: "128k", timeoutInMilliseconds: 120000,
      onProgress: ({ progress }) => { const p = Math.floor(progress * 10); if (p !== last) { last = p; log(`render ${p * 10}%`); } },
    });
    const duration = inputProps.totalFrames / inputProps.fps;
    const size = fs.statSync(out).size;
    if (size > MAX_BYTES) {
      // Too big for the free Storage plan (50 MB per file): the video stays downloadable from the GitHub run (Artifacts, 7 days).
      log(`Video is ${(size / 1048576).toFixed(0)} MB: kept as a GitHub artifact only`);
      await update("render_jobs", jobId, { status: "done", output_path: null, duration_s: Number(duration.toFixed(2)), finished_at: new Date().toISOString(),
        error: `Long video (${(size / 1048576).toFixed(0)} MB) is too big for storage. Download it from the run: Log → Artifacts (kept 7 days).` });
    } else {
      const objectPath = `videos/${jobId}.mp4`;
      await upload(out, objectPath);
      await update("render_jobs", jobId, { status: "done", output_path: objectPath, duration_s: Number(duration.toFixed(2)), finished_at: new Date().toISOString() });
    }
    if (project.idea_id) await rest("PATCH", "ideas", `?id=eq.${project.idea_id}&stage=in.(assigned,scripted)`, { stage: "produced" });
    log(`Done: ${objectPath}`);
  } catch (e) {
    await update("render_jobs", jobId, { status: "failed", error: String(e?.message || e).slice(0, 4000), finished_at: new Date().toISOString() });
    throw e;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
