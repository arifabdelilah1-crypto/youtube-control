"""Daily research job.

For every active niche and market it:
  1. searches YouTube for recent videos on each seed term (and on promising autocomplete keywords),
  2. stores videos, their channels and a view snapshot,
  3. measures competition and outliers per keyword,
  4. records YouTube and Google autocomplete ranks and discovers new keywords,
  5. refreshes view counts of recent outliers so velocity is measured, not guessed,
  6. auto-adds channels that keep producing outliers to the competitor watchlist.

Run:  python collectors/research.py            (all niches)
      python collectors/research.py football   (one niche by slug)
"""
from __future__ import annotations

import sys
from collections import Counter
from datetime import datetime, timedelta, timezone

from common import (
    DB, QuotaExhausted, YouTube, autocomplete, iso_duration_seconds, job_run, log, median,
    now_iso, rank_in, require_env,
)

LOOKBACK_DAYS = 14
OUTLIER_MIN = 3.0            # views >= 3x channel size counts as an outlier
BIG_CHANNEL_SUBS = 100_000
SEARCH_COST = 102            # search (100) + videos (1) + channels (1)
MAX_DISCOVERED_PER_RUN = 8   # extra autocomplete keywords researched per niche per day


def popularity_prefix(term: str) -> str:
    """'lamine yamal' -> 'lamine y' : what a viewer types before the term is suggested."""
    words = term.split()
    if len(words) == 1:
        return term[: max(3, len(term) // 2)]
    return " ".join(words[:-1]) + " " + words[-1][0]


def research_term(db: DB, yt: YouTube, niche: dict, market: str, term: str, source: str) -> dict:
    lang = (niche.get("languages") or ["en"])[0]
    after = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")

    params = {
        "part": "snippet", "type": "video", "q": term, "order": "viewCount",
        "publishedAfter": after, "maxResults": 50, "relevanceLanguage": lang,
    }
    if market != "GLOBAL":
        params["regionCode"] = market
    search = yt.call("search", params, bucket="research", niche_key=niche["slug"])
    ids = [it["id"]["videoId"] for it in search.get("items", []) if it.get("id", {}).get("videoId")]

    videos = []
    if ids:
        vres = yt.call("videos", {"part": "snippet,statistics,contentDetails", "id": ",".join(ids)},
                       bucket="details", niche_key=niche["slug"])
        videos = vres.get("items", [])

    chan_ids = sorted({v["snippet"]["channelId"] for v in videos})
    channels = {}
    if chan_ids:
        cres = yt.call("channels", {"part": "snippet,statistics", "id": ",".join(chan_ids)},
                       bucket="details", niche_key=niche["slug"])
        for c in cres.get("items", []):
            st = c.get("statistics", {})
            channels[c["id"]] = {
                "youtube_channel_id": c["id"],
                "title": c["snippet"].get("title"),
                "subscribers": int(st["subscriberCount"]) if st.get("subscriberCount") else None,
                "hidden_subscribers": bool(st.get("hiddenSubscriberCount")),
                "video_count": int(st.get("videoCount", 0)),
                "updated_at": now_iso(),
            }
    db.upsert("ext_channels", list(channels.values()), on_conflict="youtube_channel_id")

    video_rows, snaps, outliers, views_list, big = [], [], [], [], 0
    for v in videos:
        sn, st, cd = v["snippet"], v.get("statistics", {}), v.get("contentDetails", {})
        dur = iso_duration_seconds(cd.get("duration"))
        views = int(st.get("viewCount", 0))
        subs = (channels.get(sn["channelId"]) or {}).get("subscribers") or 0
        thumbs = sn.get("thumbnails", {})
        video_rows.append({
            "youtube_video_id": v["id"],
            "youtube_channel_id": sn["channelId"],
            "niche_id": niche["id"],
            "title": sn.get("title"),
            "description": (sn.get("description") or "")[:2000],
            "tags": sn.get("tags") or [],
            "published_at": sn.get("publishedAt"),
            "duration_s": dur,
            "is_short": bool(dur is not None and dur <= 180),
            "thumbnail_url": (thumbs.get("high") or thumbs.get("medium") or thumbs.get("default") or {}).get("url"),
        })
        snaps.append({
            "youtube_video_id": v["id"],
            "views": views,
            "likes": int(st["likeCount"]) if st.get("likeCount") else None,
            "comments": int(st["commentCount"]) if st.get("commentCount") else None,
        })
        views_list.append(views)
        if subs > BIG_CHANNEL_SUBS:
            big += 1
        if views / max(subs, 100) >= OUTLIER_MIN:
            outliers.append(sn["channelId"])

    db.upsert("videos", video_rows, on_conflict="youtube_video_id")
    db.insert("video_snapshots", snaps, returning=False) if snaps else None

    kw = db.upsert("keywords", {"niche_id": niche["id"], "market": market, "term": term, "source": source},
                   on_conflict="niche_id,market,term", returning=True)[0]
    db.upsert("video_keywords", [{"youtube_video_id": v["youtube_video_id"], "keyword_id": kw["id"]} for v in video_rows],
              on_conflict="youtube_video_id,keyword_id")

    # Autocomplete: how high the term ranks while being typed, and what people type next.
    gl = None if market == "GLOBAL" else market
    prefix = popularity_prefix(term)
    yt_rank = rank_in(term, autocomplete(prefix, youtube=True, hl=lang, gl=gl))
    g_rank = rank_in(term, autocomplete(prefix, youtube=False, hl=lang, gl=gl))
    children = [s for s in autocomplete(term + " ", youtube=True, hl=lang, gl=gl) if s != term]

    db.upsert("keyword_snapshots", {
        "keyword_id": kw["id"],
        "captured_on": datetime.now(timezone.utc).date().isoformat(),
        "yt_autocomplete_rank": yt_rank,
        "google_autocomplete_rank": g_rank,
        "recent_uploads": len(video_rows),
        "big_channel_uploads": big,
        "outlier_count": len(outliers),
        "top_views_median": median(views_list),
    }, on_conflict="keyword_id,captured_on")

    # Children inherit their position in the parent's suggestion list as their YouTube rank.
    for pos, child in enumerate(children, start=1):
        ck = db.upsert("keywords", {"niche_id": niche["id"], "market": market, "term": child, "source": "autocomplete"},
                       on_conflict="niche_id,market,term", returning=True)[0]
        db.upsert("keyword_snapshots", {
            "keyword_id": ck["id"],
            "captured_on": datetime.now(timezone.utc).date().isoformat(),
            "yt_autocomplete_rank": pos,
        }, on_conflict="keyword_id,captured_on")

    log(f"  {market:6} {term!r}: {len(video_rows)} videos, {len(outliers)} outliers, {big} big-channel, yt#{yt_rank}")
    return {"outlier_channels": outliers, "videos": len(video_rows)}


def refresh_outliers(db: DB, yt: YouTube, niche: dict) -> int:
    """Re-snapshot recent outlier videos (1 unit per 50) so views/hour is measured over time."""
    since = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).isoformat()
    rows = db.select("v_video_latest", {
        "select": "youtube_video_id",
        "niche_id": f"eq.{niche['id']}",
        "published_at": f"gte.{since}",
        "outlier_score": f"gte.{OUTLIER_MIN}",
        "order": "outlier_score.desc",
        "limit": "200",
    })
    ids = [r["youtube_video_id"] for r in rows]
    n = 0
    for i in range(0, len(ids), 50):
        batch = ids[i : i + 50]
        res = yt.call("videos", {"part": "statistics", "id": ",".join(batch)}, bucket="details", niche_key=niche["slug"])
        snaps = [{
            "youtube_video_id": v["id"],
            "views": int(v["statistics"].get("viewCount", 0)),
            "likes": int(v["statistics"]["likeCount"]) if v["statistics"].get("likeCount") else None,
            "comments": int(v["statistics"]["commentCount"]) if v["statistics"].get("commentCount") else None,
        } for v in res.get("items", [])]
        if snaps:
            db.insert("video_snapshots", snaps, returning=False)
            n += len(snaps)
    return n


def niche_units_today(db: DB, slug: str) -> int:
    rows = db.select("api_quota_daily", {
        "select": "units", "day": f"eq.{datetime.now(timezone.utc).date().isoformat()}",
        "api": "eq.youtube_data", "niche_key": f"eq.{slug}",
    })
    return sum(r["units"] for r in rows)


def run_niche(db: DB, yt: YouTube, niche: dict, state: dict) -> None:
    log(f"Niche {niche['name']}")
    budget = niche["daily_unit_budget"] - niche_units_today(db, niche["slug"])
    markets = niche.get("markets") or ["GLOBAL"]
    seeds = db.select("seed_terms", {
        "select": "id,term", "niche_id": f"eq.{niche['id']}", "active": "is.true",
        "order": "last_researched_at.asc.nullsfirst",
    })
    outlier_channels: Counter = Counter()
    done = 0

    # 1) seeds, least recently researched first, every market
    for seed in seeds:
        if budget < SEARCH_COST * len(markets) or yt.remaining() < SEARCH_COST:
            break
        for market in markets:
            res = research_term(db, yt, niche, market, seed["term"], "seed")
            outlier_channels.update(res["outlier_channels"])
            budget -= SEARCH_COST
            done += 1
        db.update("seed_terms", {"id": f"eq.{seed['id']}"}, {"last_researched_at": now_iso()})

    # 2) best discovered keywords not researched in the last 7 days, first market only
    if budget >= SEARCH_COST and yt.remaining() >= SEARCH_COST:
        week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).date().isoformat()
        researched = {r["keyword_id"] for r in db.select("keyword_snapshots", {
            "select": "keyword_id", "captured_on": f"gte.{week_ago}", "recent_uploads": "not.is.null",
        })}
        candidates = db.select("v_keyword_latest", {
            "select": "keyword_id,term,market",
            "niche_id": f"eq.{niche['id']}", "source": "eq.autocomplete", "market": f"eq.{markets[0]}",
            "order": "yt_autocomplete_rank.asc.nullslast", "limit": "100",
        })
        picked = 0
        for c in candidates:
            if picked >= MAX_DISCOVERED_PER_RUN or budget < SEARCH_COST or yt.remaining() < SEARCH_COST:
                break
            if c["keyword_id"] in researched:
                continue
            res = research_term(db, yt, niche, c["market"], c["term"], "autocomplete")
            outlier_channels.update(res["outlier_channels"])
            budget -= SEARCH_COST
            picked += 1
            done += 1

    # 3) refresh outliers for velocity
    refreshed = refresh_outliers(db, yt, niche) if yt.remaining() > 10 else 0

    # 4) channels with 2+ outliers in this run join the watchlist
    comps = [{"niche_id": niche["id"], "youtube_channel_id": ch, "source": "auto"}
             for ch, n in outlier_channels.items() if n >= 2]
    db.upsert("competitors", comps, on_conflict="niche_id,youtube_channel_id")

    state["details"][niche["slug"]] = {"terms": done, "refreshed": refreshed, "new_competitors": len(comps)}


def main() -> None:
    require_env("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "YOUTUBE_API_KEY")
    db = DB()
    only = sys.argv[1] if len(sys.argv) > 1 else None
    params = {"select": "*", "active": "is.true", "order": "created_at.asc"}
    if only:
        params["slug"] = f"eq.{only}"
    niches = db.select("niches", params)
    with job_run(db, "research" + (f":{only}" if only else "")) as state:
        yt = YouTube(db)
        for niche in niches:
            try:
                run_niche(db, yt, niche, state)
            except QuotaExhausted as e:
                log(f"Quota exhausted: {e}")
                state["status"] = "warning"
                state["details"]["quota"] = str(e)
                break
        state["units"] = yt.used_this_run
    log(f"Done. Units used: {yt.used_this_run}")


if __name__ == "__main__":
    main()
