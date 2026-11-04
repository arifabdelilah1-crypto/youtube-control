"""Google Trends: today's trending searches, turned into ideas for the networks they suit.

Reads Google's public feed of what's trending in each network's countries (10 searches a country, with an approximate
volume and the news behind them). DeepSeek, through the ai function, keeps the ones that really fit a network and writes
them as ideas, each keeping its news headlines as the only facts a script may rely on. No YouTube quota.

Run:  python collectors/trends.py
      DRY_RUN=1 python collectors/trends.py    prints the picks, saves nothing
"""
from __future__ import annotations

import math
import os
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

from common import HTTP, SUPABASE_URL, DB, job_run, log, require_env

FEED = "https://trends.google.com/trending/rss"
NS = {"ht": "https://trends.google.com/trending/rss"}
MARKETS_PER_NETWORK = 2
IDEAS_PER_NETWORK = 5
AI_FUNCTION = os.environ.get("AI_FUNCTION", "ai")


def traffic_number(text: str) -> int:
    """'2,000+' -> 2000; '1M+' -> 1000000."""
    m = re.match(r"([\d.,]+)\s*([KkMm]?)", text or "")
    if not m:
        return 0
    number = float(m.group(1).replace(",", ""))
    return int(number * {"": 1, "k": 1_000, "m": 1_000_000}[m.group(2).lower()])


def parse_feed(xml: bytes, geo: str) -> list[dict]:
    items = []
    for item in ET.fromstring(xml).iter("item"):
        news = [{
            "title": (n.findtext("ht:news_item_title", "", NS) or "").strip()[:200],
            "source": (n.findtext("ht:news_item_source", "", NS) or "").strip()[:80],
            "url": (n.findtext("ht:news_item_url", "", NS) or "").strip()[:500],
        } for n in item.findall("ht:news_item", NS)][:3]
        title = (item.findtext("title") or "").strip()
        if title:
            items.append({"title": title, "geo": geo, "traffic": (item.findtext("ht:approx_traffic", "", NS) or "").strip(), "news": news})
    return items


def read_feed(geo: str, cache: dict) -> list[dict]:
    if geo not in cache:
        try:
            r = HTTP.get(FEED, params={"geo": geo}, timeout=20)
            r.raise_for_status()
            cache[geo] = parse_feed(r.content, geo)
        except Exception as e:  # noqa: BLE001 — one country failing shouldn't stop the others
            log(f"  feed {geo} failed: {e}")
            cache[geo] = []
    return cache[geo]


def score_of(traffic: str) -> int:
    """Between 30 and 90, from the search volume: 200+ is 53, 20,000+ is 73."""
    return min(90, 30 + round(10 * math.log10(max(traffic_number(traffic), 1))))


def pick(db: DB, secret: str, channel: dict, niche: dict, seeds: list[str], items: list[dict]) -> list[dict]:
    r = HTTP.post(f"{SUPABASE_URL}/functions/v1/{AI_FUNCTION}", headers={"x-cron-secret": secret, "Content-Type": "application/json"}, timeout=170, json={
        "action": "pick_trends",
        "channel": {"name": channel.get("network_name") or channel.get("title"), "niche": niche.get("name"), "language": (channel.get("language") or "en").lower(), "topics": seeds[:15]},
        "items": [{"i": i, "search": x["title"], "country": x["geo"], "volume": x["traffic"], "news": [n["title"] for n in x["news"]]} for i, x in enumerate(items)],
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


def run_channel(db: DB, secret: str, channel: dict, cache: dict, state: dict, dry: bool) -> None:
    niche = (db.select("niches", {"select": "*", "id": f"eq.{channel['niche_id']}"}) or [{}])[0]
    if not niche or niche.get("is_explore") or not niche.get("active"):
        return
    name = channel.get("network_name") or channel.get("title")
    markets = (channel.get("markets") or niche.get("markets") or ["GLOBAL"])[:MARKETS_PER_NETWORK]
    geos = list(dict.fromkeys("US" if m == "GLOBAL" else m for m in markets))
    items = [x for g in geos for x in read_feed(g, cache)]
    seeds = [r["term"] for r in db.select("seed_terms", {"select": "term", "niche_id": f"eq.{niche['id']}", "active": "is.true"})]
    since = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
    known = {s.get("ref", "").lower() for row in db.select("ideas", {
        "select": "sources", "channel_id": f"eq.{channel['id']}", "created_at": f"gte.{since}", "sources": 'cs.[{"type":"trend"}]',
    }) for s in row["sources"]}
    fresh = [x for x in items if x["title"].lower() not in known]
    if not fresh:
        state["details"][name] = {"searches": len(items), "ideas": 0}
        return
    picked = pick(db, secret, channel, niche, seeds, fresh)
    for p in picked:
        item = p["item"]
        log(f"  {name}: [{item['geo']} {item['traffic']}] {item['title']} -> {p['title']}" + (f" ({p['why']})" if p["why"] else ""))
        if dry:
            continue
        db.insert("ideas", {
            "title": p["title"], "channel_id": channel["id"], "niche_id": niche["id"], "score": score_of(item["traffic"]),
            "sources": [{"type": "trend", "ref": item["title"], "geo": item["geo"], "traffic": item["traffic"], "why": p["why"], "news": item["news"]}],
        }, returning=False)
    state["details"][name] = {"searches": len(items), "ideas": len(picked)}
    log(f"  {name}: {len(picked)} of {len(fresh)} new searches fit")


def main() -> None:
    require_env("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
    db = DB()
    dry = bool(os.environ.get("DRY_RUN"))
    secret = db.rpc("get_cron_secret", {})
    cache: dict = {}
    with job_run(db, "trends") as state:
        failures = 0
        channels = [c for c in db.select("channels", {"select": "*", "order": "created_at.asc"}) if c.get("niche_id")]
        for channel in channels:
            try:
                run_channel(db, secret, channel, cache, state, dry)
            except Exception as e:  # noqa: BLE001 — the next network may still work
                failures += 1
                log(f"  {channel.get('title')}: {e}")
                state["details"][str(channel.get("title"))] = {"error": str(e)[:300]}
        if failures:
            state["status"] = "failed" if failures == len(channels) else "warning"


if __name__ == "__main__":
    main()
