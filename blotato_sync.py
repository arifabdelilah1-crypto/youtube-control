"""Blotato sync (hourly) — mirrors scheduled/published posts into `blotato_posts`.

The request/response mapping is reused from the Réseau DE Blotato sync, which already
works in production. Until that adapter is copied in, this job exits cleanly and the
dashboard simply shows no publishing data (no false alerts: the alert rule waits for data).
"""
from __future__ import annotations

import os
import sys

from common import DB, job_run, log, require_env


def fetch_posts() -> list[dict]:
    """Return rows shaped like the `blotato_posts` table:
    {id, channel_id, platform, status, title, scheduled_at, published_at, post_url, error}
    TODO: port the request + field mapping from the Réseau DE Blotato sync.
    """
    raise NotImplementedError


def main() -> None:
    require_env("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
    if not os.environ.get("BLOTATO_API_KEY"):
        log("BLOTATO_API_KEY not set — skipping")
        return
    db = DB()
    with job_run(db, "blotato_sync") as state:
        try:
            rows = fetch_posts()
        except NotImplementedError:
            state["status"] = "warning"
            state["details"]["note"] = "Blotato adapter not installed yet"
            log("Blotato adapter not installed yet — skipping")
            return
        db.upsert("blotato_posts", rows, on_conflict="id")
        state["details"]["posts"] = len(rows)


if __name__ == "__main__":
    sys.exit(main())
