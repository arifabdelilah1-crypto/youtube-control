"""Shared helpers: Supabase REST client, YouTube API client with quota tracking, job logging."""
from __future__ import annotations

import json
import os
import statistics
import sys
import time
import traceback
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterable

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
YOUTUBE_API_KEY = os.environ.get("YOUTUBE_API_KEY", "")

# Hard ceiling for the whole project per day (Google's default is 10,000).
DAILY_UNIT_CAP = int(os.environ.get("YT_DAILY_UNIT_CAP", "9500"))

HTTP = requests.Session()
HTTP.headers.update({"User-Agent": "youtube-control/1.0"})


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc):%H:%M:%S}] {msg}", flush=True)


def require_env(*names: str) -> None:
    missing = [n for n in names if not os.environ.get(n)]
    if missing:
        sys.exit(f"Missing environment variables: {', '.join(missing)}")


# ------------------------------------------------------------------
# Supabase (PostgREST) — service role, bypasses RLS
# ------------------------------------------------------------------
class DB:
    def __init__(self, url: str = SUPABASE_URL, key: str = SUPABASE_KEY):
        self.base = f"{url}/rest/v1"
        self.h = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    def select(self, table: str, params: dict[str, str] | None = None) -> list[dict]:
        r = HTTP.get(f"{self.base}/{table}", headers=self.h, params=params or {}, timeout=60)
        r.raise_for_status()
        return r.json()

    def upsert(self, table: str, rows: list[dict] | dict, on_conflict: str, returning: bool = False) -> list[dict]:
        rows = rows if isinstance(rows, list) else [rows]
        if not rows:
            return []
        prefer = "resolution=merge-duplicates," + ("return=representation" if returning else "return=minimal")
        out: list[dict] = []
        for chunk in _chunks(rows, 500):
            r = HTTP.post(
                f"{self.base}/{table}",
                headers={**self.h, "Prefer": prefer},
                params={"on_conflict": on_conflict},
                data=json.dumps(chunk, default=str),
                timeout=60,
            )
            if r.status_code >= 400:
                raise RuntimeError(f"upsert {table} failed {r.status_code}: {r.text[:400]}")
            if returning:
                out.extend(r.json())
        return out

    def insert(self, table: str, rows: list[dict] | dict, returning: bool = True) -> list[dict]:
        rows = rows if isinstance(rows, list) else [rows]
        r = HTTP.post(
            f"{self.base}/{table}",
            headers={**self.h, "Prefer": "return=representation" if returning else "return=minimal"},
            data=json.dumps(rows, default=str),
            timeout=60,
        )
        if r.status_code >= 400:
            raise RuntimeError(f"insert {table} failed {r.status_code}: {r.text[:400]}")
        return r.json() if returning else []

    def update(self, table: str, match: dict[str, str], values: dict) -> None:
        r = HTTP.patch(
            f"{self.base}/{table}",
            headers={**self.h, "Prefer": "return=minimal"},
            params=match,
            data=json.dumps(values, default=str),
            timeout=60,
        )
        if r.status_code >= 400:
            raise RuntimeError(f"update {table} failed {r.status_code}: {r.text[:400]}")

    def rpc(self, fn: str, args: dict) -> Any:
        r = HTTP.post(f"{self.base}/rpc/{fn}", headers=self.h, data=json.dumps(args, default=str), timeout=60)
        if r.status_code >= 400:
            raise RuntimeError(f"rpc {fn} failed {r.status_code}: {r.text[:400]}")
        return r.json() if r.text else None


def _chunks(seq: list, n: int) -> Iterable[list]:
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


# ------------------------------------------------------------------
# Job logging
# ------------------------------------------------------------------
@contextmanager
def job_run(db: DB, job: str):
    row = db.insert("job_runs", {"job": job, "status": "running"})[0]
    state = {"status": "ok", "units": 0, "details": {}}
    try:
        yield state
    except Exception as e:  # noqa: BLE001 — record any failure, then re-raise
        state["status"] = "failed"
        state["details"]["error"] = f"{type(e).__name__}: {e}"
        state["details"]["trace"] = traceback.format_exc()[-1500:]
        raise
    finally:
        db.update(
            "job_runs",
            {"id": f"eq.{row['id']}"},
            {
                "status": state["status"],
                "finished_at": now_iso(),
                "units_used": state["units"],
                "details": state["details"],
            },
        )


# ------------------------------------------------------------------
# YouTube Data API v3 with unit accounting
# ------------------------------------------------------------------
class QuotaExhausted(Exception):
    pass


UNIT_COST = {"search": 100, "videos": 1, "channels": 1, "playlistItems": 1}


class YouTube:
    def __init__(self, db: DB, api_key: str = YOUTUBE_API_KEY):
        self.db = db
        self.key = api_key
        self.used_this_run = 0
        self.used_today = db.rpc("quota_used_today", {"p_api": "youtube_data"}) or 0

    def remaining(self) -> int:
        return DAILY_UNIT_CAP - self.used_today - self.used_this_run

    def call(self, endpoint: str, params: dict, bucket: str, niche_key: str = "all") -> dict:
        cost = UNIT_COST.get(endpoint, 1)
        if self.remaining() < cost:
            raise QuotaExhausted(f"daily cap reached ({DAILY_UNIT_CAP})")
        for attempt in range(3):
            r = HTTP.get(
                f"https://www.googleapis.com/youtube/v3/{endpoint}",
                params={**params, "key": self.key},
                timeout=30,
            )
            if r.status_code == 200:
                break
            if r.status_code == 403 and "quota" in r.text.lower():
                raise QuotaExhausted(r.text[:200])
            if r.status_code >= 500:
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError(f"YouTube {endpoint} {r.status_code}: {r.text[:300]}")
        self.used_this_run += cost
        self.db.rpc("add_quota", {"p_api": "youtube_data", "p_bucket": bucket, "p_niche_key": niche_key, "p_units": cost})
        return r.json()


def iso_duration_seconds(d: str | None) -> int | None:
    """PT1H2M3S -> 3723."""
    if not d or not d.startswith("P"):
        return None
    total, num, in_time = 0, "", False
    for ch in d[1:]:
        if ch == "T":
            in_time = True
        elif ch.isdigit():
            num += ch
        else:
            n = int(num or 0)
            num = ""
            if ch == "D":
                total += n * 86400
            elif ch == "H" and in_time:
                total += n * 3600
            elif ch == "M" and in_time:
                total += n * 60
            elif ch == "S":
                total += n
    return total


def median(values: list[int]) -> int | None:
    return int(statistics.median(values)) if values else None


# ------------------------------------------------------------------
# Autocomplete (YouTube and Google) — unofficial, free
# ------------------------------------------------------------------
def autocomplete(query: str, youtube: bool, hl: str = "en", gl: str | None = None) -> list[str]:
    params = {"client": "firefox", "q": query, "hl": hl}
    if youtube:
        params["ds"] = "yt"
    if gl and gl != "GLOBAL":
        params["gl"] = gl
    try:
        r = HTTP.get("https://suggestqueries.google.com/complete/search", params=params, timeout=15)
        r.raise_for_status()
        data = json.loads(r.content.decode(r.encoding or "utf-8", errors="replace"))
        return [s.strip().lower() for s in data[1]][:10]
    except Exception as e:  # noqa: BLE001
        log(f"autocomplete failed for {query!r}: {e}")
        return []


def rank_in(term: str, suggestions: list[str]) -> int | None:
    t = term.strip().lower()
    for i, s in enumerate(suggestions, start=1):
        if s == t:
            return i
    return None
