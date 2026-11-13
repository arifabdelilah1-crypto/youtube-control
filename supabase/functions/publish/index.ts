// Publishing queue.
// POST {action:"queue",  render_job_id, when: "next" | "now" | ISO date, platform?}  (dashboard user) -> queue + start the upload job
//      The project's settings.publish applies: {mode: "ask" | "next" | "now" | "date", at, exclude: [platform], text: {platform: {title, description}}, options: {platform: {privacy}}}
// POST {action:"auto",   render_job_id}                                   (render job, x-cron-secret) -> queue if the channel's auto-publish is on
// POST {action:"cancel", queue_id}                                       (dashboard user) -> cancel a post that isn't uploaded yet
// POST {action:"blotato_accounts"}                                       (dashboard user) -> connected accounts, and each Facebook account's Pages
// POST {action:"blotato_sync"}                                           (dashboard user) -> asks Blotato how its pending posts ended
// POST {action:"token",  channel_id}                                     (publish job, x-cron-secret) -> short-lived YouTube access token
// GitHub jobs read the cron secret from the database with their service key, then send it as x-cron-secret.
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GITHUB_TOKEN, GITHUB_REPO, BLOTATO_API_KEY
import { createClient } from "npm:@supabase/supabase-js@2";
import { nextFreeSlot } from "./slots.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const GH_TOKEN = Deno.env.get("GITHUB_TOKEN") ?? "";
const GH_REPO = Deno.env.get("GITHUB_REPO") ?? "";
const BLOTATO = Deno.env.get("BLOTATO_API_KEY") ?? "";
const BLOTATO_API = "https://backend.blotato.com/v2";
const PLATFORMS = new Set(["youtube", "tiktok", "instagram", "twitter", "facebook"]);
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

/** Where a channel posts. A schedule saved before targets existed posts to YouTube with its one method. */
function targetsOf(schedule: any): { platform: string; method: string; account_id: string | null; page_id?: string | null }[] {
  if (!Array.isArray(schedule.targets)) return [{ platform: "youtube", method: schedule.method, account_id: schedule.blotato_account_id || null }];
  return schedule.targets.filter((x: any) => PLATFORMS.has(x?.platform))
    .map((x: any) => ({
      platform: x.platform,
      // "meta": a Facebook Page connected directly (Connect Facebook), posted by the publish job with the Page's own token
      method: x.platform === "youtube" ? (x.method !== "blotato" ? "youtube" : "blotato") : x.platform === "facebook" && x.method === "meta" ? "meta" : "blotato",
      account_id: x.account_id ? String(x.account_id) : null, page_id: x.page_id ? String(x.page_id) : null,
    }));
}

async function queue(jobId: string, when: string, onlyIfAuto: boolean, onlyPlatform?: string) {
  const { data: job } = await db.from("render_jobs").select("*").eq("id", jobId).single();
  if (!job) return { error: "render not found", status: 404 };
  if (job.status !== "done") return { error: "This render isn't finished yet.", status: 400 };
  const { data: project } = job.project_id ? await db.from("video_projects").select("*").eq("id", job.project_id).single() : { data: null };
  const channelId = job.channel_id || project?.channel_id;
  if (!channelId) return { error: "This video has no network. Set the network on its Studio page first.", status: 400 };
  const { data: sched } = await db.from("publish_schedules").select("*").eq("channel_id", channelId).maybeSingle();
  const schedule = sched || DEFAULT_SCHEDULE;
  // what was chosen for this video wins over the network's schedule
  const plan = project?.settings?.publish || {};
  if (onlyIfAuto) {
    if (plan.mode === "ask") return { skipped: "this video waits for you to publish it" };
    if (plan.mode === "now" || plan.mode === "date") when = plan.mode === "now" ? "now" : (Date.parse(plan.at) > Date.now() + 15 * 60e3 ? plan.at : "next");
    else if (plan.mode !== "next" && !schedule.enabled) return { skipped: "auto-publish is off for this channel" };
  }
  const excluded = new Set(Array.isArray(plan.exclude) ? plan.exclude : []);
  const targets = targetsOf(schedule).filter((x) => !excluded.has(x.platform));
  if (!targets.length) return { error: excluded.size ? "Every account is switched off for this video. Turn one on in its Publish tab." : "This network posts nowhere yet. Pick its accounts on its Networks page.", status: 400 };
  if (targets.some((x) => x.method === "blotato" && !x.account_id)) return { error: "Pick the Blotato account on this network's page.", status: 400 };
  if (targets.some((x) => x.method === "meta" && !x.page_id)) return { error: "Pick the Facebook Page on this network's page.", status: 400 };
  if (targets.some((x) => x.method === "youtube")) {
    const { count } = await db.from("channel_tokens").select("channel_id", { count: "exact", head: true }).eq("channel_id", channelId);
    if (!count) return { error: "This network's YouTube channel isn't connected. Connect it on its Networks page first.", status: 400 };
  }
  const { data: existing } = await db.from("publish_queue").select("*").eq("render_job_id", jobId);
  const isActive = (r: any) => ["queued", "uploading", "scheduled", "published"].includes(r.status);
  const done = (existing || []).filter(isActive);
  // a new render of a video that already went out doesn't go out again by itself: its Publish tab can still send it
  let earlier: any[] = [];
  if (onlyIfAuto && job.project_id) {
    const { data: others } = await db.from("render_jobs").select("id").eq("project_id", job.project_id).neq("id", jobId);
    const ids = (others || []).map((j: any) => j.id);
    if (ids.length) earlier = (await db.from("publish_queue").select("platform").in("render_job_id", ids).in("status", ["queued", "uploading", "scheduled", "published"])).data || [];
  }
  // a retry touches its own platform only: a post cancelled on another one stays cancelled
  const todo = targets.filter((x) => !done.some((r: any) => r.platform === x.platform) && !earlier.some((r: any) => r.platform === x.platform) && (!onlyPlatform || x.platform === onlyPlatform));
  if (!todo.length && earlier.length && !done.length) return { skipped: "an earlier render of this video already went out. Publish this one from its Publish tab if you want both." };
  if (!todo.length) return done.length ? { row: done[0], rows: done, already: true } : { error: "This network doesn't post there any more. Check its Networks page.", status: 400 };

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
  const rows: any[] = [];
  for (const target of todo) {
    const row = {
      render_job_id: jobId, channel_id: channelId, idea_id: job.idea_id || project?.idea_id || null, method: target.method, platform: target.platform,
      blotato_account_id: target.account_id || null, public_url: null,
      title: String(plan.text?.[target.platform]?.title ?? plan.text?.all?.title ?? title).replace(/[<>]/g, "").slice(0, target.platform === "twitter" ? 280 : 100) || title,
      description: String(plan.text?.[target.platform]?.description ?? plan.text?.all?.description ?? idea?.video_description ?? "").slice(0, 4900),
      tags: (idea?.video_tags || []).slice(0, 30), options: plan.options?.[target.platform] || {},
      slot_at: slot, status: "queued", error: null, youtube_video_id: null, blotato_post_id: null,
    };
    const { data: saved, error } = await db.from("publish_queue").upsert(row, { onConflict: "render_job_id,platform" }).select().single();
    if (error) throw error;
    const err = await dispatch({ queue_id: saved.id, ...artifactInputs(job) });
    if (err) await db.from("publish_queue").update({ status: "failed", error: err }).eq("id", saved.id);
    rows.push({ ...saved, status: err ? "failed" : "queued", error: err });
  }
  return { row: rows[0], rows };
}

/** Blotato's answer for the posts it hasn't finished telling us about. */
async function blotatoSync() {
  if (!BLOTATO) return { checked: 0 };
  const { data: pending } = await db.from("publish_queue").select("id,blotato_post_id,status,slot_at").eq("method", "blotato").not("blotato_post_id", "is", null)
    .in("status", ["uploading", "scheduled"]).lte("slot_at", new Date().toISOString()).limit(25);
  const { data: immediate } = await db.from("publish_queue").select("id,blotato_post_id,status,slot_at").eq("method", "blotato").not("blotato_post_id", "is", null)
    .eq("status", "uploading").is("slot_at", null).limit(25);
  const rows = [...(pending || []), ...(immediate || [])];
  for (const row of rows) {
    const r = await fetch(`${BLOTATO_API}/posts/${encodeURIComponent(row.blotato_post_id)}`, { headers: { "blotato-api-key": BLOTATO } });
    if (!r.ok) continue;
    const data = await r.json();
    if (data.status === "published") await db.from("publish_queue").update({ status: "published", public_url: data.publicUrl || null }).eq("id", row.id);
    else if (data.status === "failed") await db.from("publish_queue").update({ status: "failed", error: String(data.errorMessage || "Blotato couldn't publish this post.").slice(0, 2000) }).eq("id", row.id);
  }
  return { checked: rows.length };
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
      const out: any = await queue(body.render_job_id, String(body.when || "next"), false, PLATFORMS.has(body.platform) ? body.platform : undefined);
      return json(out, out.status || 200);
    }
    if (body.action === "blotato_accounts") {
      if (!BLOTATO) return json({ error: "Add BLOTATO_API_KEY in Supabase Edge Function secrets.", accounts: [] }, 503);
      const r = await fetch(`${BLOTATO_API}/users/me/accounts`, { headers: { "blotato-api-key": BLOTATO } });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return json({ error: `Blotato ${r.status}: ${JSON.stringify(data).slice(0, 200)}`, accounts: [] }, 502);
      const list = Array.isArray(data) ? data : data.items || data.accounts || [];
      const accounts: any[] = [];
      for (const x of list.filter((a: any) => PLATFORMS.has(a.platform))) {
        const name = x.username || x.fullname || String(x.id);
        if (x.platform !== "facebook") { accounts.push({ id: String(x.id), platform: x.platform, name }); continue; }
        // Blotato posts to a Page, never to a personal profile
        const pages = await fetch(`${BLOTATO_API}/users/me/accounts/${encodeURIComponent(x.id)}/subaccounts`, { headers: { "blotato-api-key": BLOTATO } });
        const items = pages.ok ? ((await pages.json().catch(() => ({}))).items || []) : [];
        for (const page of items) accounts.push({ id: String(x.id), page_id: String(page.id), platform: "facebook", name: page.name || name });
      }
      return json({ accounts });
    }
    if (body.action === "blotato_sync") return json(await blotatoSync());
    if (body.action === "cancel") {
      if (!UUID.test(body.queue_id || "")) return json({ error: "queue_id required" }, 400);
      const { data: row } = await db.from("publish_queue").select("*").eq("id", body.queue_id).single();
      if (!row) return json({ error: "not found" }, 404);
      if (!["queued", "failed"].includes(row.status)) return json({ error: row.method === "blotato" ? "Already sent. Cancel or change it in Blotato." : "Already uploaded. Delete or reschedule it in YouTube Studio." }, 400);
      await db.from("publish_queue").update({ status: "cancelled" }).eq("id", row.id);
      return json({ ok: true });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
