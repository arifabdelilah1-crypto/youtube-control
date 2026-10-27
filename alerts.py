"""Alert rules (hourly). Opens an alert when a rule fires, resolves it when the rule clears."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from common import DAILY_UNIT_CAP, DB, job_run, now_iso, require_env

JOBS_EXPECTED = {"research": 26, "trends": 26, "channel_stats": 7}   # max hours between successful runs


def evaluate(db: DB) -> list[dict]:
    fired: list[dict] = []
    now = datetime.now(timezone.utc)

    # 1) Channels with nothing scheduled on Blotato in the next 48 h (only once Blotato sync has data)
    if db.select("blotato_posts", {"select": "id", "limit": "1"}):
        horizon = (now + timedelta(hours=48)).isoformat()
        for ch in db.select("channels", {"select": "id,title"}):
            upcoming = db.select("blotato_posts", {
                "select": "id", "channel_id": f"eq.{ch['id']}", "status": "eq.scheduled",
                "scheduled_at": f"lte.{horizon}", "limit": "1"})
            if not upcoming:
                fired.append({"severity": "critical", "title": f"{ch['title']} has nothing scheduled",
                              "detail": "No Blotato post in the next 48 h", "channel_id": ch["id"],
                              "dedupe_key": f"no_schedule:{ch['id']}"})

    # 2) Jobs that failed or stopped running
    for job, max_h in JOBS_EXPECTED.items():
        last = db.select("job_runs", {"select": "status,started_at", "job": f"like.{job}*",
                                      "order": "started_at.desc", "limit": "1"})
        if not last:
            continue
        started = datetime.fromisoformat(last[0]["started_at"].replace("Z", "+00:00"))
        if last[0]["status"] == "failed":
            fired.append({"severity": "warning", "title": f"Job {job} failed", "detail": "See Settings → Scheduled jobs",
                          "dedupe_key": f"job_failed:{job}"})
        elif now - started > timedelta(hours=max_h):
            fired.append({"severity": "warning", "title": f"Job {job} has not run for {int((now - started).total_seconds() // 3600)} h",
                          "detail": "Check the GitHub Actions schedule", "dedupe_key": f"job_stale:{job}"})

    # 3) Quota close to the cap
    used = db.rpc("quota_used_today", {"p_api": "youtube_data"}) or 0
    if used >= DAILY_UNIT_CAP * 0.9:
        fired.append({"severity": "info", "title": f"YouTube API quota {round(used / 100)}% used today",
                      "detail": f"{used:,} of 10,000 units", "dedupe_key": f"quota:{now.date()}"})
    return fired


def main() -> None:
    require_env("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
    db = DB()
    with job_run(db, "alerts") as state:
        fired = evaluate(db)
        keys = {a["dedupe_key"] for a in fired}
        open_alerts = db.select("alerts", {"select": "id,dedupe_key", "resolved_at": "is.null"})
        open_keys = {a["dedupe_key"] for a in open_alerts}
        new = [a for a in fired if a["dedupe_key"] not in open_keys]
        if new:
            db.insert("alerts", new, returning=False)
        cleared = [a["id"] for a in open_alerts if a["dedupe_key"] and a["dedupe_key"] not in keys]
        for aid in cleared:
            db.update("alerts", {"id": f"eq.{aid}"}, {"resolved_at": now_iso()})
        state["details"] = {"open": len(fired), "new": len(new), "resolved": len(cleared)}


if __name__ == "__main__":
    main()
