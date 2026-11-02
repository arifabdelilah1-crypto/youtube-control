// Final videos on the VDS (vds/media.php), outside Supabase's 1 GB and 50 MB limits.
// A render_jobs.output_path of "vds:videos/<id>.mp4" means the file is there; any other path is in Supabase Storage.
// MEDIA_URL and MEDIA_SECRET are GitHub repo secrets. Without them renders stay on Supabase.
import crypto from "node:crypto";
import fs from "node:fs";

const BASE = (process.env.MEDIA_URL || "").replace(/\/$/, "");
const SECRET = process.env.MEDIA_SECRET || "";
const CHUNK = 16 * 1024 * 1024;

export const mediaReady = () => !!(BASE && SECRET);
export const isVds = (outputPath) => String(outputPath || "").startsWith("vds:");
export const vdsPath = (outputPath) => String(outputPath).replace(/^vds:/, "");

export function mediaLink(method, objectPath, seconds = 3600) {
  const e = Math.floor(Date.now() / 1000) + seconds;
  const s = crypto.createHmac("sha256", SECRET).update(`${method}\n${objectPath}\n${e}`).digest("hex");
  return `${BASE}?${new URLSearchParams({ p: objectPath, e: String(e), s })}`;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Chunked and resumable. The VDS keeps the file only if its size and checksum match. */
export async function uploadToVds(file, objectPath) {
  const data = fs.readFileSync(file);
  const sha256 = crypto.createHash("sha256").update(data).digest("hex");
  const link = mediaLink("PUT", objectPath, 6 * 3600);
  let offset = 0;
  let failures = 0;
  while (true) {
    const chunk = data.subarray(offset, offset + CHUNK);
    const last = offset + chunk.length >= data.length;
    const extra = new URLSearchParams({ offset: String(offset) });
    if (offset === 0 && failures === 0) extra.set("reset", "1");
    if (last) { extra.set("final", "1"); extra.set("size", String(data.length)); extra.set("sha256", sha256); }
    let r = null;
    try {
      r = await fetch(`${link}&${extra}`, { method: "PUT", body: chunk, headers: { "Content-Type": "application/octet-stream" }, signal: AbortSignal.timeout(300000) });
    } catch (e) {
      if (++failures > 6) throw new Error(`VDS upload failed: ${e.message}`);
    }
    if (r?.ok) {
      if (last) return data.length;
      offset = Number(r.headers.get("x-offset"));
      failures = 0;
    } else if (r?.status === 409) {
      offset = Number(r.headers.get("x-offset") ?? 0);  // an earlier try got through: carry on from what the VDS has
      if (++failures > 6) throw new Error("VDS upload failed: offsets keep disagreeing");
    } else if (r) {
      const text = (await r.text()).slice(0, 200);
      if (r.status < 500 || ++failures > 6) throw new Error(`VDS upload failed ${r.status}: ${text}`);
    }
    if (failures) await wait(2000 * failures);
  }
}

export async function downloadFromVds(objectPath, dest) {
  const r = await fetch(mediaLink("GET", objectPath));
  if (!r.ok) throw new Error(`download ${r.status}: the video isn't on the VDS. Render it again.`);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}
