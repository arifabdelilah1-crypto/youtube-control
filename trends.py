"""Daily Google Trends job (YouTube Search property).

For each niche it takes the top keywords (seeds first, then best-scored discovered ones)
and stores, per keyword:
  trends_avg_7d / trends_avg_30d  -> momentum (rising or fading)
  trends_interest                 -> demand, scaled against one anchor term per niche
                                     so keywords from different batches are comparable.
It also saves "rising" related queries of seed terms as new keywords.

Google Trends has no free official API; this uses pytrends, runs slowly and backs off on 429s.
"""
from __future__ import annotations

import random
import sys
import time
from datetime import datetime, timezone

from common import DB, job_run, log, require_env

KEYWORDS_PER_NICHE = 30
BATCH = 4                      # + 1 anchor = Google's 5-term limit
PAUSE_S = (12, 25)


def trends_client():
    from pytrends.request import TrendReq  # imported here so other jobs don't need it
    return TrendReq(hl="en-US", tz=0, timeout=(10, 30), retries=2, backoff_factor=1.5)


def fetch(pt, terms: list[str], geo: str):
    for attempt in range(4):
        try:
            pt.build_payload(terms, timeframe="today 3-m", geo="" if geo == "GLOBAL" else geo, gprop="youtube")
            return pt.interest_over_time()
        except Exception as e:  # noqa: BLE001 — pytrends raises generic errors on 429
            wait = 60 * (attempt + 1)
            log(f"    trends error ({e.__class__.__name__}), waiting {wait}s")
            time.sleep(wait)
    return None


def run_niche(db: DB, niche: dict, state: dict) -> None:
    pt = trends_client()
    market = (niche.get("markets") or ["GLOBAL"])[0]
    anchor = niche.get("trends_anchor") or niche["name"].lower()
    today = datetime.now(timezone.utc).date().isoformat()

    seeds = [r["term"] for r in db.select("seed_terms", {
        "select": "term", "niche_id": f"eq.{niche['id']}", "active": "is.true"})]
    scored = [r["term"] for r in db.select("v_keyword_scores", {
        "select": "term", "niche_id": f"eq.{niche['id']}", "market": f"eq.{market}",
        "order": "score.desc", "limit": str(KEYWORDS_PER_NICHE)})]
    terms = list(dict.fromkeys(seeds + scored))[:KEYWORDS_PER_NICHE]
    terms = [t for t in terms if t != anchor]

    keyword_ids = {r["term"]: r["id"] for r in db.select("keywords", {
        "select": "id,term", "niche_id": f"eq.{niche['id']}", "market": f"eq.{market}"})}

    ok, failed = 0, 0
    for i in range(0, len(terms), BATCH):
        batch = terms[i : i + BATCH]
        df = fetch(pt, batch + [anchor], market)
        if df is None or df.empty:
            failed += len(batch)
            continue
        anchor_7 = float(df[anchor].tail(7).mean()) or 1.0
        rows = []
        for term in batch:
            if term not in df.columns:
                continue
            s = df[term]
            avg7, avg30 = float(s.tail(7).mean()), float(s.tail(30).mean())
            kid = keyword_ids.get(term)
            if not kid:
                kid = db.upsert("keywords", {"niche_id": niche["id"], "market": market, "term": term, "source": "seed"},
                                on_conflict="niche_id,market,term", returning=True)[0]["id"]
            rows.append({
                "keyword_id": kid, "captured_on": today,
                "trends_interest": round(min(100.0, avg7 / anchor_7 * 50), 1),
                "trends_avg_7d": round(avg7, 2), "trends_avg_30d": round(avg30, 2),
            })
        db.upsert("keyword_snapshots", rows, on_conflict="keyword_id,captured_on")
        ok += len(rows)
        time.sleep(random.uniform(*PAUSE_S))

    # Rising related queries for a few seeds become new keywords.
    discovered = 0
    for seed in seeds[:5]:
        try:
            pt.build_payload([seed], timeframe="today 1-m", geo="" if market == "GLOBAL" else market, gprop="youtube")
            rel = pt.related_queries().get(seed, {}).get("rising")
            if rel is not None:
                for q in rel["query"].head(10):
                    db.upsert("keywords", {"niche_id": niche["id"], "market": market, "term": str(q).lower(), "source": "trends"},
                              on_conflict="niche_id,market,term")
                    discovered += 1
        except Exception as e:  # noqa: BLE001
            log(f"    related queries failed for {seed!r}: {e}")
        time.sleep(random.uniform(*PAUSE_S))

    state["details"][niche["slug"]] = {"keywords": ok, "failed": failed, "discovered": discovered}
    if failed and not ok:
        state["status"] = "failed"
    elif failed:
        state["status"] = "warning"
    log(f"  {niche['name']}: {ok} keywords, {failed} failed, {discovered} rising queries")


def main() -> None:
    require_env("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
    db = DB()
    only = sys.argv[1] if len(sys.argv) > 1 else None
    params = {"select": "*", "active": "is.true"}
    if only:
        params["slug"] = f"eq.{only}"
    with job_run(db, "trends") as state:
        for niche in db.select("niches", params):
            run_niche(db, niche, state)


if __name__ == "__main__":
    main()
