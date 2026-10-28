// Queue a video render and start the GitHub Actions "Render video" workflow.
// POST {idea_id?, channel_id?, params}  -> {job_id, status}
// POST {retry: job_id}                   -> re-dispatches a failed/queued job
// Secrets: GITHUB_TOKEN (fine-grained, Actions: read & write on the repo), GITHUB_REPO ("owner/name").
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const GH_TOKEN = Deno.env.get("GITHUB_TOKEN") ?? "";
const GH_REPO = Deno.env.get("GITHUB_REPO") ?? "";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function dispatch(jobId: string): Promise<string | null> {
  if (!GH_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(GH_REPO)) return "Render isn't set up yet: add GITHUB_TOKEN and GITHUB_REPO in Supabase Edge Function secrets.";
  const r = await fetch(`https://api.github.com/repos/${GH_REPO}/actions/workflows/render.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "youtube-control" },
    body: JSON.stringify({ ref: "main", inputs: { job_id: jobId } }),
  });
  return r.ok ? null : `GitHub dispatch failed (${r.status}): ${(await r.text()).slice(0, 300)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(URL_, SERVICE);
    const cron = req.headers.get("x-cron-secret");
    const allowed = cron
      ? cron === (await db.rpc("get_cron_secret")).data
      : !!(await createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }).rpc("am_i_allowed")).data;
    if (!allowed) return json({ error: "not allowed" }, 403);

    const body = await req.json();
    let jobId: string;
    if (body.retry) {
      const { data: job } = await db.from("render_jobs").select("id,status").eq("id", body.retry).single();
      if (!job) return json({ error: "job not found" }, 404);
      jobId = job.id;
    } else {
      const p = body.params || {};
      if (typeof p.script !== "string" || p.script.trim().length < 20) return json({ error: "Write a script first (at least a couple of sentences)." }, 400);
      if (p.source !== "local" && !(Array.isArray(p.terms) && p.terms.length)) return json({ error: "Add at least one footage search term." }, 400);
      const { data: job, error } = await db.from("render_jobs")
        .insert({ idea_id: body.idea_id ?? null, channel_id: body.channel_id ?? null, params: p }).select().single();
      if (error) throw error;
      jobId = job.id;
    }
    const err = await dispatch(jobId);
    await db.from("render_jobs").update(err ? { status: "failed", error: err } : { status: "dispatched", error: null }).eq("id", jobId);
    return json({ job_id: jobId, status: err ? "failed" : "dispatched", error: err }, err ? 503 : 200);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
