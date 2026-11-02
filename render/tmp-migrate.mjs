// One-time, temporary branch only. MODE=copy copies every Supabase video to the VDS. MODE=switch re-checks each copy
// byte for byte, points the job at the VDS, and only then removes the Supabase file.
import crypto from "node:crypto"; import fs from "node:fs";
import { mediaReady, uploadToVds, mediaLink } from "./media.mjs";
const URL_ = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY, MODE = process.env.MODE;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
if (!mediaReady() || !["copy", "switch"].includes(MODE)) throw new Error("not set up");
const rest = async (path, opts = {}) => { const r = await fetch(`${URL_}/rest/v1/${path}`, { ...opts, headers: { ...H, "Content-Type": "application/json", ...(opts.headers || {}) } }); if (!r.ok) throw new Error(`${path} ${r.status}: ${(await r.text()).slice(0, 200)}`); return r.status === 204 ? null : r.json(); };
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const fromSupabase = async (p) => { const r = await fetch(`${URL_}/storage/v1/object/renders/${p}`, { headers: H }); if (!r.ok) throw new Error(`supabase ${r.status}`); return Buffer.from(await r.arrayBuffer()); };
const fromVds = async (p) => { const r = await fetch(mediaLink("GET", p)); if (!r.ok) throw new Error(`vds ${r.status}`); return Buffer.from(await r.arrayBuffer()); };
const jobs = await rest("render_jobs?output_path=like.videos/*&select=id,output_path");
const queue = await rest("publish_queue?select=render_job_id,status,slot_at,blotato_post_id");
const now = Date.now();
// a post Blotato may still fetch from its Supabase link: the file stays there until after the post goes out
const keep = new Set(queue.filter((q) => q.status === "uploading" || (q.blotato_post_id && q.slot_at && new Date(q.slot_at).getTime() > now)).map((q) => q.render_job_id));
const tally = { total: jobs.length, ok: 0, failed: 0, kept: 0, bytes: 0 };
for (const j of jobs) {
  const p = j.output_path;
  if (!/^videos\/[0-9a-f-]{36}\.mp4$/.test(p)) { console.log(`skip ${p}`); tally.failed++; continue; }
  try {
    const original = await fromSupabase(p);
    if (MODE === "copy") {
      fs.writeFileSync("tmp.mp4", original);
      await uploadToVds("tmp.mp4", p);
    } else {
      if (sha(await fromVds(p)) !== sha(original)) throw new Error("copy differs");
      await rest(`render_jobs?id=eq.${j.id}&output_path=eq.${encodeURIComponent(p)}`, { method: "PATCH", body: JSON.stringify({ output_path: `vds:${p}` }) });
      if (keep.has(j.id)) tally.kept++;
      else { const r = await fetch(`${URL_}/storage/v1/object/renders/${p}`, { method: "DELETE", headers: H }); if (!r.ok) throw new Error(`delete ${r.status}`); }
    }
    tally.ok++; tally.bytes += original.length;
    console.log(`ok ${j.id} ${(original.length / 1048576).toFixed(1)} MB`);
  } catch (e) { tally.failed++; console.log(`FAILED ${j.id}: ${e.message}`); }
}
console.log(JSON.stringify(tally));
if (tally.failed) process.exit(1);
