"""Google Trends: what people are searching right now, turned into ideas for the networks they suit.

Reads Google's "Trending now" page for each network's countries: every trend of the past 24 hours still rising
(hundreds a country, not the 10 of the RSS feed), with its volume, categories and related searches. The biggest get
their news headlines (Google News, through the trending function), then DeepSeek, through the ai function, keeps the ones that really fit a network
and writes them as ideas, each keeping its headlines as the only facts a script may rely on. To pick trends by hand,
with Google's filters, use the Trending page (trending function).
No YouTube quota. The page isn't an official API: if Google changes it, read_trending logs it and finds nothing.

Run:  python collectors/trends.py
      DRY_RUN=1 python collectors/trends.py    prints the picks, saves nothing
"""
from __future__ import annotations

import json
import math
import os
import re
from datetime import datetime, timedelta, timezone

from common import HTTP, SUPABASE_URL, DB, job_run, log, require_env

PAGE = "https://trends.google.com/trending"
BROWSER = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
           "Accept-Language": "en-US,en;q=0.9"}
# Google's categories on the "Trending now" page (same numbers as the site's category filter)
CATEGORIES = {1: "Autos and Vehicles", 2: "Beauty and Fashion", 3: "Business and Finance", 20: "Climate", 4: "Entertainment",
              5: "Food and Drink", 6: "Games", 7: "Health", 8: "Hobbies and Leisure", 9: "Jobs and Education", 10: "Law and Government",
              11: "Other", 13: "Pets and Animals", 14: "Politics", 15: "Science", 16: "Shopping", 17: "Sports", 18: "Technology",
              19: "Travel and Transportation"}
PERIODS = (4, 24, 48, 168)
GEO_LANG = {"FR": "fr", "BE": "fr", "MA": "fr", "DZ": "fr", "TN": "fr", "DE": "de", "AT": "de", "CH": "de", "ES": "es", "MX": "es",
            "IT": "it", "PT": "pt", "BR": "pt", "NL": "nl", "EG": "ar", "SA": "ar", "AE": "ar"}
MARKETS_PER_NETWORK = 3
CANDIDATES_PER_NETWORK = 40   # the biggest trends after the filters; each costs one Google News read
IDEAS_PER_NETWORK = 5
AI_FUNCTION = os.environ.get("AI_FUNCTION", "ai")


def traffic_label(volume: int) -> str:
    """2000 -> '2K+', 1000000 -> '1M+', the way the site writes it."""
    if volume >= 1_000_000:
        return f"{volume // 1_000_000}M+"
    if volume >= 1_000:
        return f"{volume // 1_000}K+"
    return f"{volume}+"


def traffic_number(text: str) -> int:
    """'2,000+' or '2K+' -> 2000; '1M+' -> 1000000."""
    m = re.match(r"([\d.,]+)\s*([KkMm]?)", text or "")
    if not m:
        return 0
    number = float(m.group(1).replace(",", ""))
    return int(number * {"": 1, "k": 1_000, "m": 1_000_000}[m.group(2).lower()])


def parse_trending(html: str, geo: str) -> list[dict]:
    """The trends sit in the page as the data of AF_initDataCallback 'ds:0'."""
    m = re.search(r"AF_initDataCallback\(\{key: 'ds:0'.*?data:(.*?), sideChannel", html, re.S)
    if not m:
        raise RuntimeError("the page has no trends block (Google changed it?)")
    rows = (json.loads(m.group(1)) or [None, []])[1] or []
    items = []
    for r in rows:
        try:
            title = str(r[0] or "").strip()
            if not title:
                continue
            news_ids = r[11] if len(r) > 11 and isinstance(r[11], list) else []
            lang = next((n[1] for n in news_ids if isinstance(n, list) and len(n) > 1 and n[1]), GEO_LANG.get(geo, "en"))
            items.append({
                "title": title[:200], "geo": geo, "volume": int(r[6] or 0), "traffic": traffic_label(int(r[6] or 0)),
                "growth": int(r[8] or 0), "started": int((r[3] or [0])[0]), "active": r[4] is None,
                "categories": [int(c) for c in (r[10] or [])], "related": [str(x) for x in (r[9] or []) if str(x).lower() != title.lower()][:8],
                "lang": str(lang)[:5], "news": [],
            })
        except (IndexError, TypeError, ValueError):
            continue
    return items


def read_trending(geo: str, hours: int, cache: dict) -> list[dict]:
    key = (geo, hours)
    if key not in cache:
        try:
            r = HTTP.get(PAGE, params={"geo": geo, "hours": hours, "hl": "en-US"}, headers=BROWSER, timeout=30)
            r.raise_for_status()
            cache[key] = parse_trending(r.text, geo)
            log(f"  trending {geo} {hours}h: {len(cache[key])} trends")
        except Exception as e:  # noqa: BLE001 — one country failing shouldn't stop the others
            log(f"  trending {geo} {hours}h failed: {e}")
            cache[key] = []
    return cache[key]


def read_news(item: dict, secret: str, cache: dict) -> list[dict]:
    """Up to 3 recent headlines about a trend, through the trending function (Google News, read by the VDS)."""
    key = (item["title"].lower(), item["geo"])
    if key not in cache:
        try:
            r = HTTP.post(f"{SUPABASE_URL}/functions/v1/trending", headers={"x-cron-secret": secret, "Content-Type": "application/json"}, timeout=40,
                          json={"action": "news", "title": item["title"], "geo": item["geo"], "lang": item["lang"]})
            r.raise_for_status()
            cache[key] = [{"title": str(n.get("title") or "")[:200], "source": str(n.get("source") or "")[:80], "url": str(n.get("url") or "")[:500]}
                          for n in (r.json().get("news") or [])[:3]]
        except Exception as e:  # noqa: BLE001 — a trend without headlines is skipped by the AI
            log(f"  news for {item['title']} failed: {e}")
            cache[key] = []
    return cache[key]


def filters_of(niche: dict) -> dict:
    """The same view as the Trending page's default: past 24 hours, active trends, all categories."""
    return {"categories": [], "hours": 24, "active_only": True}


def score_of(traffic: str) -> int:
    """Between 30 and 90, from the search volume: 200+ is 53, 20,000+ is 73."""
    return min(90, 30 + round(10 * math.log10(max(traffic_number(traffic), 1))))


def pick(db: DB, secret: str, channel: dict, niche: dict, seeds: list[str], items: list[dict]) -> list[dict]:
    r = HTTP.post(f"{SUPABASE_URL}/functions/v1/{AI_FUNCTION}", headers={"x-cron-secret": secret, "Content-Type": "application/json"}, timeout=170, json={
        "action": "pick_trends",
        "channel": {"name": channel.get("network_name") or channel.get("title"), "niche": niche.get("name"), "language": (channel.get("language") or "en").lower(), "topics": seeds[:15]},
        "items": [{"i": i, "search": x["title"], "country": x["geo"], "volume": x["traffic"], "news": [n["title"] for n in x["news"]]}
                  for i, x in enumerate(items) if x["news"]],
    })
    r.raise_for_status()
    data = r.json()
    if data.get("error"):
        raise RuntimeError(data["error"])
    picked = []
    for p in data.get("picks", []):
        try:
            item = items[int(p.get("i"))]
        except (TypeError, ValueError, IndexError):
            continue
        title = str(p.get("title") or "").strip()[:120]
        if title:
            picked.append({"item": item, "title": title, "why": str(p.get("why") or "").strip()[:160]})
    return picked[:IDEAS_PER_NETWORK]


def run_channel(db: DB, secret: str, channel: dict, cache: dict, news_cache: dict, state: dict, dry: bool) -> None:
    niche = (db.select("niches", {"select": "*", "id": f"eq.{channel['niche_id']}"}) or [{}])[0]
    if not niche or niche.get("is_explore") or not niche.get("active"):
        return
    name = channel.get("network_name") or channel.get("title")
    f = filters_of(niche)
    markets = (channel.get("markets") or niche.get("markets") or ["GLOBAL"])[:MARKETS_PER_NETWORK]
    geos = list(dict.fromkeys("US" if m == "GLOBAL" else m for m in markets))
    items = [x for g in geos for x in read_trending(g, f["hours"], cache)]
    if f["categories"]:
        items = [x for x in items if set(x["categories"]) & set(f["categories"])]
    if f["active_only"]:
        items = [x for x in items if x["active"]]
    seeds = [r["term"] for r in db.select("seed_terms", {"select": "term", "niche_id": f"eq.{niche['id']}", "active": "is.true"})]
    since = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
    known = {s.get("ref", "").lower() for row in db.select("ideas", {
        "select": "sources", "channel_id": f"eq.{channel['id']}", "created_at": f"gte.{since}", "sources": 'cs.[{"type":"trend"}]',
    }) for s in row["sources"]}
    seen: set = set()
    fresh = []
    for x in sorted(items, key=lambda x: (x["volume"], x["growth"]), reverse=True):
        if x["title"].lower() in known or x["title"].lower() in seen:
            continue
        seen.add(x["title"].lower())
        fresh.append(x)
    fresh = fresh[:CANDIDATES_PER_NETWORK]
    detail = {"searches": len(items), "filters": f}
    if not fresh:
        state["details"][name] = {**detail, "ideas": 0}
        return
    fresh = [{**x, "news": read_news(x, secret, news_cache)} for x in fresh]
    picked = pick(db, secret, channel, niche, seeds, fresh)
    for p in picked:
        item = p["item"]
        log(f"  {name}: [{item['geo']} {item['traffic']}] {item['title']} -> {p['title']}" + (f" ({p['why']})" if p["why"] else ""))
        if dry:
            continue
        db.insert("ideas", {
            "title": p["title"], "channel_id": channel["id"], "niche_id": niche["id"], "score": score_of(item["traffic"]),
            "sources": [{"type": "trend", "ref": item["title"], "geo": item["geo"], "traffic": item["traffic"], "why": p["why"], "news": item["news"],
                         "related": item["related"][:5], "categories": [CATEGORIES.get(c, "Other") for c in item["categories"]],
                         "started": datetime.fromtimestamp(item["started"], timezone.utc).isoformat() if item["started"] else None}],
        }, returning=False)
    state["details"][name] = {**detail, "ideas": len(picked)}
    log(f"  {name}: {len(picked)} of {len(fresh)} biggest trends fit ({len(items)} passed the filters)")


def main() -> None:
    require_env("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
    db = DB()
    dry = bool(os.environ.get("DRY_RUN"))
    secret = db.rpc("get_cron_secret", {})
    cache: dict = {}
    news_cache: dict = {}
    with job_run(db, "trends") as state:
        failures = 0
        channels = [c for c in db.select("channels", {"select": "*", "order": "created_at.asc"}) if c.get("niche_id")]
        for channel in channels:
            try:
                run_channel(db, secret, channel, cache, news_cache, state, dry)
            except Exception as e:  # noqa: BLE001 — the next network may still work
                failures += 1
                log(f"  {channel.get('title')}: {e}")
                state["details"][str(channel.get("title"))] = {"error": str(e)[:300]}
        if failures:
            state["status"] = "failed" if failures == len(channels) else "warning"


if __name__ == "__main__":
    main()
