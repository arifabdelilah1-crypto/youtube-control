// Publishing queue.
// POST {action:"queue",  render_job_id, when: "next" | "now" | ISO date}  (dashboard user) -> queue + start the upload job
// POST {action:"auto",   render_job_id}                                   (render job, x-cron-secret) -> queue if the channel's auto-publish is on
// POST {action:"cancel", queue_id}                                       (dashboard user) -> cancel a post that isn't uploaded yet
// POST {action:"token",  channel_id}                                     (publish job, x-cron-secret) -> short-lived YouTube access token
// GitHub jobs read the cron secret from the database with their service key, then send it as x-cron-secret.
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GITHUB_TOKEN, GITHUB_REPO
import { createClient } from "npm:@supabase/supabase-js@2";
import { nextFreeSlot } from "./slots.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const GH_TOKEN = Deno.env.get("GITHUB_TOKEN") ?? "";
const GH_REPO = Deno.env.get("GITHUB_REPO") ?? "";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f-]{36}$/;
const db = createClient(URL_, SERVICE);
const DEFAULT_SCHEDULE = { enabled: false, method: "youtube", days: [0, 1, 2, 3, 4, 5, 6], times: ["18:00"], timezone: "Europe/Madrid" };

async function dispatch(inputs: Record<string, string>): Promise<string | null> {
  if (!GH_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(GH_REPO)) return "Publishing isn't set up: add GITHUB_TOKEN and GITHUB_REPO in Supabase Edge Function secrets.";
  const r = await fetch(`https://api.github.com/repos/${GH_REPO}/actions/workflows/publish.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "youtube-control" },
    body: JSON.stringify({ ref: "main", inputs }),
  });
  return r.ok ? null : `GitHub dispatch failed (${r.status}): ${(await r.text()).slice(0, 300)}`;
}

/** Long videos aren't in Storage: the publish job then downloads the render's GitHub artifact. */
function artifactInputs(job: any): Record<string, string> {
  if (job.output_path) return {};
  const runId = String(job.run_url || "").match(/\/runs\/(\d+)/)?.[1];
  return runId ? { run_id: runId, artifact: `video-${job.id}` } : {};
}

async function queue(jobId: string, when: string, onlyIfAuto: boolean) {
  const { data: job } = await db.from("render_jobs").select("*").eq("id", jobId).single();
  if (!job) return { error: "render not found", status: 404 };
  if (job.status !== "done") return { error: "This render isn't finished yet.", status: 400 };
  const { data: project } = job.project_id ? await db.from("video_projects").select("*").eq("id", job.project_id).single() : { data: null };
  const channelId = job.channel_id || project?.channel_id;
  if (!channelId) return { error: "This video has no channel. Set the channel on its Studio page first.", status: 400 };
  const { data: sched } = await db.from("publish_schedules").select("*").eq("channel_id", channelId).maybeSingle();
  const schedule = sched || DEFAULT_SCHEDULE;
  if (onlyIfAuto && !schedule.enabled) return { skipped: "auto-publish is off for this channel" };
  if (schedule.method === "blotato" && !schedule.blotato_account_id) return { error: "Add the Blotato account ID for this channel in Automation.", status: 400 };
  if (schedule.method === "youtube") {
    const { count } = await db.from("channel_tokens").select("channel_id", { count: "exact", head: true }).eq("channel_id", channelId);
    if (!count) return { error: "This channel isn't connected with Google. Connect it in Channels first.", status: 400 };
  }
  const { data: existing } = await db.from("publish_queue").select("*").eq("render_job_id", jobId).maybeSingle();
  if (existing && ["uploading", "scheduled", "published"].includes(existing.status)) return { row: existing, already: true };

  let slot: string | null = null;
  if (when === "now") slot = null;
  else if (when && when !== "next") {
    const t = Date.parse(when);
    if (!Number.isFinite(t) || t < Date.now() + 15 * 60e3) return { error: "Pick a time at least 15 minutes from now.", status: 400 };
    slot = new Date(t).toISOString();
  } else {
    const { data: taken } = await db.from("publish_queue").select("slot_at").eq("channel_id", channelId)
      .in("status", ["queued", "uploading", "scheduled"]).not("slot_at", "is", null).neq("render_job_id", jobId);
    const t = nextFreeSlot(schedule, (taken || []).map((r: any) => Date.parse(r.slot_at)));
    if (!t) return { error: "No free slot in the next 120 days. Add posting days or times.", status: 400 };
    slot = new Date(t).toISOString();
  }

  const { data: idea } = job.idea_id ? await db.from("ideas").select("*").eq("id", job.idea_id).single() : { data: null };
  const title = String(idea?.video_title || project?.title || job.params?.title || "New video").replace(/[<>]/g, "").slice(0, 100);
  const row = {
    render_job_id: jobId, channel_id: channelId, idea_id: job.idea_id || project?.idea_id || null, method: schedule.method,
    title, description: String(idea?.video_description || "").slice(0, 4900), tags: (idea?.video_tags || []).slice(0, 30),
    slot_at: slot, status: "queued", error: null, youtube_video_id: null, blotato_post_id: null,
  };
  const { data: saved, error } = await db.from("publish_queue").upsert(row, { onConflict: "render_job_id" }).select().single();
  if (error) throw error;
  const err = await dispatch({ queue_id: saved.id, ...artifactInputs(job) });
  if (err) await db.from("publish_queue").update({ status: "failed", error: err }).eq("id", saved.id);
  return { row: { ...saved, status: err ? "failed" : "queued", error: err } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const auth = req.headers.get("Authorization") ?? "";
    const cron = req.headers.get("x-cron-secret");
    const isService = !!cron && cron === (await db.rpc("get_cron_secret")).data;

    if (body.action === "token" || body.action === "auto") {
      if (!isService) return json({ error: "not allowed" }, 403);
      if (body.action === "auto") {
        if (!UUID.test(body.render_job_id || "")) return json({ error: "render_job_id required" }, 400);
        const out: any = await queue(body.render_job_id, "next", true);
        return json(out, out.status || 200);
      }
      if (!UUID.test(body.channel_id || "")) return json({ error: "channel_id required" }, 400);
      const { data: refresh } = await db.rpc("get_channel_refresh_token", { p_channel_id: body.channel_id });
      if (!refresh || !CLIENT_ID) return json({ error: "This channel isn't connected with Google (no refresh token)." }, 400);
      const r = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: refresh, grant_type: "refresh_token" }),
      });
      const t = await r.json();
      if (!r.ok) return json({ error: `Google token refresh failed: ${t.error_description || t.error}. Reconnect the channel in Channels.` }, 400);
      return json({ access_token: t.access_token, expires_in: t.expires_in });
    }

    const userDb = createClient(URL_, ANON, { global: { headers: { Authorization: auth } } });
    if (!(await userDb.rpc("am_i_allowed")).data) return json({ error: "not allowed" }, 403);

    if (body.action === "queue") {
      if (!UUID.test(body.render_job_id || "")) return json({ error: "render_job_id required" }, 400);
      const out: any = await queue(body.render_job_id, String(body.when || "next"), false);
      return json(out, out.status || 200);
    }
    if (body.action === "cancel") {
      if (!UUID.test(body.queue_id || "")) return json({ error: "queue_id required" }, 400);
      const { data: row } = await db.from("publish_queue").select("*").eq("id", body.queue_id).single();
      if (!row) return json({ error: "not found" }, 404);
      if (!["queued", "failed"].includes(row.status)) return json({ error: "Already uploaded. Delete or reschedule it in YouTube Studio." }, 400);
      await db.from("publish_queue").update({ status: "cancelled" }).eq("id", row.id);
      return json({ ok: true });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
