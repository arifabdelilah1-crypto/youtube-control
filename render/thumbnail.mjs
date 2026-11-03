// The video's thumbnail as a JPEG on the VDS (runs in the "Create thumbnail" workflow, and with the final render).
//   node render/thumbnail.mjs <project_id>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { thumbnailKey, thumbnailProps } from "../video/layout.js";
import { mediaReady, uploadToVds } from "./media.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const URL_ = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const MAX_BYTES = 2 * 1024 * 1024;  // YouTube's limit
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function rest(method, query, body) {
  const r = await fetch(`${URL_}/rest/v1/video_projects${query}`, { method, headers: { ...H, "Content-Type": "application/json", Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${method} video_projects ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

async function signed(objectPath) {
  const r = await fetch(`${URL_}/storage/v1/object/sign/renders/${objectPath}`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 3600 }) });
  if (!r.ok) throw new Error(`sign ${r.status}`);
  return `${URL_}/storage/v1${(await r.json()).signedURL}`;
}

/** Only the thumbnail's result fields change, on the settings as they are now: the editor may have saved meanwhile. */
async function saveResult(projectId, result) {
  const [p] = await rest("GET", `?id=eq.${projectId}&select=settings`);
  const settings = p?.settings || {};
  await rest("PATCH", `?id=eq.${projectId}`, { settings: { ...settings, thumbnail: { ...(settings.thumbnail || {}), ...result } } });
}

/** Renders and stores it. serveUrl: the bundle the final render already made. */
export async function makeThumbnail(project, serveUrl) {
  if (!mediaReady()) throw new Error("The video store isn't set up: add MEDIA_URL and MEDIA_SECRET in GitHub secrets.");
  const t = project.settings?.thumbnail || {};
  const key = thumbnailKey(t);
  const image = t.image?.path ? { ...t.image, url: await signed(t.image.path) } : t.image;
  const inputProps = thumbnailProps({ ...t, image }, project.language);
  const bundled = serveUrl || await bundle({ entryPoint: path.join(ROOT, "video/root.jsx"), publicDir: path.join(ROOT, "web") });
  const composition = await selectComposition({ serveUrl: bundled, id: "Thumbnail", inputProps });
  const out = path.join(ROOT, "thumbnail-output.jpg");
  for (const jpegQuality of [90, 80, 70, 55]) {
    await renderStill({ composition, serveUrl: bundled, output: out, inputProps, imageFormat: "jpeg", jpegQuality, overwrite: true });
    if (fs.statSync(out).size <= MAX_BYTES) break;
  }
  const size = fs.statSync(out).size;
  if (size > MAX_BYTES) throw new Error(`The thumbnail is ${(size / 1048576).toFixed(1)} MB; YouTube takes 2 MB at most. Pick a simpler image.`);
  const objectPath = `thumbs/${project.id}-${key}.jpg`;
  await uploadToVds(out, objectPath);
  log(`Thumbnail ${(size / 1024).toFixed(0)} KB: ${objectPath}`);
  await saveResult(project.id, { file: { path: `vds:${objectPath}`, key, at: new Date().toISOString() }, error: null });
  return objectPath;
}

async function main() {
  const projectId = process.argv[2];
  if (!/^[0-9a-f-]{36}$/.test(projectId || "")) throw new Error("invalid project id");
  const [project] = await rest("GET", `?id=eq.${projectId}&select=*`);
  if (!project) throw new Error("project not found");
  try {
    await ensureBrowser();
    await makeThumbnail(project);
  } catch (e) {
    await saveResult(projectId, { error: String(e?.message || e).slice(0, 500) });
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1); });
