// Thumbnail impressions + CTR from the YouTube Reporting API (bulk report channel_reach_basic_a1).
// The Analytics API has no impressions metric, so: one reporting job per channel (created on its first sync),
// then YouTube posts one CSV per day, about 2 days behind (first files ~48 h after the job, plus a 30-day backfill).
// Needs the "YouTube Reporting API" enabled in the Google Cloud project; until then the error is saved on the channel.
export const REACH_REPORT = "channel_reach_basic_a1";
const API = "https://youtubereporting.googleapis.com/v1";
const PER_RUN = 20;   // reports imported per channel per run; the 30-day backfill finishes over a couple of runs

export type ReachRow = { youtube_video_id: string; day: string; impressions: number; ctr: number | null };

const isoDay = (d: string) => (/^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d.slice(0, 10));

/** Sum impressions and weight the CTR by impressions when several rows share a key. */
function combine<K extends string>(rows: ReachRow[], key: (r: ReachRow) => K): Map<K, ReachRow> {
  const out = new Map<K, ReachRow & { clicks: number; withCtr: number }>();
  for (const r of rows) {
    const cur = out.get(key(r)) || { ...r, impressions: 0, ctr: null, clicks: 0, withCtr: 0 };
    cur.impressions += r.impressions;
    if (r.ctr !== null) { cur.clicks += r.impressions * r.ctr; cur.withCtr += r.impressions; }
    cur.ctr = cur.withCtr ? cur.clicks / cur.withCtr : null;
    out.set(key(r), cur);
  }
  return new Map([...out].map(([k, { clicks: _c, withCtr: _w, ...r }]) => [k, r]));
}

/** CSV -> one row per video and day. Column order is read from the header. */
export function parseReachCsv(csv: string): ReachRow[] {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const cells = (l: string) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const head = cells(lines[0]);
  const [d, v, imp, ctr] = ["date", "video_id", "video_thumbnail_impressions", "video_thumbnail_impressions_ctr"].map((n) => head.indexOf(n));
  if (d < 0 || v < 0 || imp < 0) throw new Error(`unexpected impressions report columns: ${head.join(", ")}`);
  const rows = lines.slice(1).map(cells).filter((c) => c[v]).map((c) => {
    const raw = ctr >= 0 && c[ctr] !== "" ? Number(c[ctr]) : NaN;
    return { youtube_video_id: c[v], day: isoDay(c[d]), impressions: Number(c[imp]) || 0, ctr: Number.isFinite(raw) ? raw : null };
  });
  // The docs don't say whether CTR is a fraction or a percentage: a file with any value above 1 is in percent.
  const percent = rows.some((r) => (r.ctr ?? 0) > 1);
  const scaled = rows.map((r) => ({ ...r, ctr: r.ctr === null ? null : percent ? r.ctr / 100 : r.ctr }));
  return [...combine(scaled, (r) => `${r.youtube_video_id}|${r.day}`).values()];
}

/** Channel totals per day. */
export function dailyTotals(rows: ReachRow[]): { day: string; impressions: number; ctr: number | null }[] {
  return [...combine(rows, (r) => r.day).values()].map(({ day, impressions, ctr }) => ({ day, impressions, ctr }));
}

async function gapi(url: string, token: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error?.message || `HTTP ${r.status}`), { status: r.status });
  return data;
}

// deno-lint-ignore no-explicit-any
export async function syncReach(db: any, ch: any, token: string): Promise<Record<string, unknown>> {
  try {
    let job = ch.reach_job_id as string | null;
    if (!job) {
      const jobs = await gapi(`${API}/jobs`, token);
      job = (jobs.jobs || []).find((j: { reportTypeId: string }) => j.reportTypeId === REACH_REPORT)?.id
        || (await gapi(`${API}/jobs`, token, { method: "POST", body: JSON.stringify({ reportTypeId: REACH_REPORT, name: "YouTube Control impressions" }) })).id;
      await db.from("channels").update({ reach_job_id: job }).eq("id", ch.id);
    }
    const reports: { createTime: string; downloadUrl: string }[] = [];
    let page = "";
    do {
      const p = new URLSearchParams();
      if (ch.reach_report_after) p.set("createdAfter", new Date(ch.reach_report_after).toISOString());
      if (page) p.set("pageToken", page);
      const res = await gapi(`${API}/jobs/${job}/reports?${p}`, token);
      reports.push(...(res.reports || []));
      page = res.nextPageToken || "";
    } while (page && reports.length < 200);
    reports.sort((a, b) => a.createTime.localeCompare(b.createTime));

    let after: string | null = ch.reach_report_after, imported = 0;
    for (const rep of reports.slice(0, PER_RUN)) {
      const r = await fetch(rep.downloadUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`impressions report download failed (${r.status})`);
      const rows = parseReachCsv(await r.text());
      if (rows.length) {
        const { error } = await db.from("own_video_impressions").upsert(rows.map((x) => ({ ...x, channel_id: ch.id })), { onConflict: "youtube_video_id,day" });
        if (error) throw new Error(error.message);
        // only the impressions columns: the analytics part of the sync owns the others
        await db.from("channel_daily_stats").upsert(dailyTotals(rows).map((t) => ({ channel_id: ch.id, day: t.day, impressions: t.impressions, impressions_ctr: t.ctr })),
          { onConflict: "channel_id,day" });
      }
      // +1 ms so createdAfter skips this report next time (createTime has nanoseconds, the column keeps microseconds)
      after = new Date(Date.parse(rep.createTime.replace(/(\.\d{3})\d+/, "$1")) + 1).toISOString();
      imported++;
    }
    await db.from("channels").update({ reach_report_after: after, reach_error: null }).eq("id", ch.id);
    return { impressions_reports: imported, impressions_pending: Math.max(reports.length - PER_RUN, 0) };
  } catch (e) {
    const err = e as Error & { status?: number };
    // a job deleted on YouTube's side: forget it so the next sync creates a new one
    await db.from("channels").update({ reach_error: err.message.slice(0, 400), ...(err.status === 404 ? { reach_job_id: null, reach_report_after: null } : {}) }).eq("id", ch.id);
    return { impressions_error: err.message };
  }
}
