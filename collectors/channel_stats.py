"""Channel stats job (every 6 h).

Public part (API key, no login needed): subscribers, total views, video count for every channel.
Private part (only channels connected with Google): daily views, watch time, subscribers,
Shorts views, the YouTube search terms that brought viewers, and current stats of recent uploads.
"""
from __future__ import annotations

import os
from datetime import date, timedelta

from common import DB, HTTP, YouTube, iso_duration_seconds, job_run, log, now_iso, require_env

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
ANALYTICS = "https://youtubeanalytics.googleapis.com/v2/reports"


def public_snapshots(db: DB, yt: YouTube, channels: list[dict]) -> int:
    ids = [c["youtube_channel_id"] for c in channels if c.get("youtube_channel_id")]
    by_yt = {c["youtube_channel_id"]: c for c in channels}
    n = 0
    for i in range(0, len(ids), 50):
        res = yt.call("channels", {"part": "snippet,statistics", "id": ",".join(ids[i:i + 50])}, bucket="channel_stats")
        for item in res.get("items", []):
            ch, st, sn = by_yt[item["id"]], item.get("statistics", {}), item.get("snippet", {})
            db.insert("channel_snapshots", {
                "channel_id": ch["id"],
                "subscribers": int(st["subscriberCount"]) if st.get("subscriberCount") else None,
                "total_views": int(st.get("viewCount", 0)),
                "video_count": int(st.get("videoCount", 0)),
            }, returning=False)
            thumbs = sn.get("thumbnails", {})
            db.update("channels", {"id": f"eq.{ch['id']}"}, {
                "title": sn.get("title") or ch["title"],
                "handle": sn.get("customUrl") or ch.get("handle"),
                "thumbnail_url": (thumbs.get("medium") or thumbs.get("default") or {}).get("url"),
            })
            n += 1
    return n


def access_token(db: DB, channel_id: str) -> str | None:
    refresh = db.rpc("get_channel_refresh_token", {"p_channel_id": channel_id})
    if not refresh:
        return None
    r = HTTP.post("https://oauth2.googleapis.com/token", data={
        "client_id": GOOGLE_CLIENT_ID, "client_secret": GOOGLE_CLIENT_SECRET,
        "refresh_token": refresh, "grant_type": "refresh_token",
    }, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"token refresh failed: {r.text[:200]}")
    return r.json()["access_token"]


def report(token: str, params: dict) -> list[list]:
    r = HTTP.get(ANALYTICS, headers={"Authorization": f"Bearer {token}"}, params={"ids": "channel==MINE", **params}, timeout=60)
    if r.status_code != 200:
        raise RuntimeError(f"analytics {params.get('dimensions')}: {r.status_code} {r.text[:200]}")
    data = r.json()
    cols = [h["name"] for h in data.get("columnHeaders", [])]
    return [dict(zip(cols, row)) for row in data.get("rows", [])]


def private_stats(db: DB, ch: dict) -> dict:
    token = access_token(db, ch["id"])
    if not token:
        return {"skipped": "not connected"}
    end = date.today() - timedelta(days=1)   # Analytics lags ~1-2 days
    start = end - timedelta(days=35)
    rng = {"startDate": start.isoformat(), "endDate": end.isoformat()}

    daily = report(token, {**rng, "dimensions": "day",
                           "metrics": "views,estimatedMinutesWatched,subscribersGained,subscribersLost,averageViewDuration"})
    rows = {r["day"]: {
        "channel_id": ch["id"], "day": r["day"], "views": r["views"],
        "watch_minutes": r["estimatedMinutesWatched"], "subs_gained": r["subscribersGained"],
        "subs_lost": r["subscribersLost"], "avg_view_duration_s": r["averageViewDuration"],
    } for r in daily}

    try:  # Shorts split; skipped quietly if the channel/API doesn't return it
        for r in report(token, {**rng, "dimensions": "day,creatorContentType", "metrics": "views"}):
            if r.get("creatorContentType") == "SHORTS" and r["day"] in rows:
                rows[r["day"]]["shorts_views"] = r["views"]
    except RuntimeError as e:
        log(f"    shorts split unavailable: {e}")
    db.upsert("channel_daily_stats", list(rows.values()), on_conflict="channel_id,day")

    s28 = (end - timedelta(days=27)).isoformat()
    terms = report(token, {"startDate": s28, "endDate": end.isoformat(), "dimensions": "insightTrafficSourceDetail",
                           "filters": "insightTrafficSourceType==YT_SEARCH", "metrics": "views",
                           "sort": "-views", "maxResults": 25})
    db.upsert("channel_search_terms", [{
        "channel_id": ch["id"], "period_end": end.isoformat(), "term": t["insightTrafficSourceDetail"], "views": t["views"],
    } for t in terms], on_conflict="channel_id,period_end,term")

    breakdowns = []
    for kind, dim, extra in (("traffic_source", "insightTrafficSourceType", {}),
                             ("country", "country", {"sort": "-views", "maxResults": 10})):
        for r in report(token, {"startDate": s28, "endDate": end.isoformat(), "dimensions": dim, "metrics": "views", **extra}):
            breakdowns.append({"channel_id": ch["id"], "period_end": end.isoformat(), "kind": kind, "key": r[dim], "views": r["views"]})
    db.upsert("channel_breakdowns", breakdowns, on_conflict="channel_id,period_end,kind,key")

    # Feed the channel's real search terms into research as keywords of its niche.
    if ch.get("niche_id"):
        market = (ch.get("markets") or ["GLOBAL"])[0]
        db.upsert("keywords", [{"niche_id": ch["niche_id"], "market": market, "term": t["insightTrafficSourceDetail"].lower(),
                                "source": "channel_search"} for t in terms], on_conflict="niche_id,market,term")
    return {"days": len(rows), "search_terms": len(terms)}


def own_videos(db: DB, yt: YouTube, ch: dict) -> int:
    """Latest 50 uploads with current stats (2 units per channel)."""
    if not ch.get("youtube_channel_id"):
        return 0
    uploads = "UU" + ch["youtube_channel_id"][2:]
    items = yt.call("playlistItems", {"part": "contentDetails", "playlistId": uploads, "maxResults": 50},
                    bucket="channel_stats").get("items", [])
    ids = [i["contentDetails"]["videoId"] for i in items]
    if not ids:
        return 0
    vids = yt.call("videos", {"part": "snippet,statistics,contentDetails", "id": ",".join(ids)}, bucket="channel_stats")
    today = date.today().isoformat()
    meta, stats = [], []
    for v in vids.get("items", []):
        sn, st = v["snippet"], v.get("statistics", {})
        dur = iso_duration_seconds(v.get("contentDetails", {}).get("duration"))
        thumbs = sn.get("thumbnails", {})
        meta.append({"youtube_video_id": v["id"], "channel_id": ch["id"], "title": sn.get("title"),
                     "published_at": sn.get("publishedAt"), "duration_s": dur,
                     "is_short": bool(dur is not None and dur <= 180),
                     "thumbnail_url": (thumbs.get("medium") or thumbs.get("default") or {}).get("url"),
                     "updated_at": now_iso()})
        # own_video_daily holds the cumulative totals as of that day
        stats.append({"youtube_video_id": v["id"], "day": today, "views": int(st.get("viewCount", 0)),
                      "likes": int(st["likeCount"]) if st.get("likeCount") else None,
                      "comments": int(st["commentCount"]) if st.get("commentCount") else None})
    db.upsert("own_videos", meta, on_conflict="youtube_video_id")
    db.upsert("own_video_daily", stats, on_conflict="youtube_video_id,day")
    return len(meta)


def main() -> None:
    require_env("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "YOUTUBE_API_KEY")
    db = DB()
    channels = db.select("channels", {"select": "*"})
    with job_run(db, "channel_stats") as state:
        yt = YouTube(db)
        state["details"]["public"] = public_snapshots(db, yt, channels)
        for ch in channels:
            info = {"videos": own_videos(db, yt, ch)}
            if ch.get("connected") and GOOGLE_CLIENT_ID:
                try:
                    info.update(private_stats(db, ch))
                except RuntimeError as e:
                    info["error"] = str(e)
                    state["status"] = "warning"
            state["details"][ch["title"]] = info
            log(f"  {ch['title']}: {info}")
        state["units"] = yt.used_this_run


if __name__ == "__main__":
    main()
