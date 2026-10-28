"""Voice-over for the video editor (runs in the GitHub Actions 'Prepare voice' workflow).

    python collectors/prepare_job.py <project_id> [scene_id,scene_id,...]

For each scene (all, or only the listed ones) it generates the voice with Microsoft Edge TTS,
records the timing of every word (for word-by-word captions), uploads the MP3 to the private
'renders' bucket and stores path, duration and word timings on the scene.
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import re
import sys

import edge_tts

from common import DB, HTTP, SUPABASE_KEY, SUPABASE_URL, log, require_env

BYTES_PER_SECOND = 48_000 / 8  # Edge TTS default output: 24 kHz, 48 kbit/s mono MP3 (constant bitrate)
VOICE_RE = re.compile(r"^([a-z]{2,3}-[A-Z]{2}-[A-Za-z]+Neural)(-(Male|Female))?$")


def tts_voice(name: str) -> str:
    m = VOICE_RE.match(name or "")
    return m.group(1) if m else "en-US-AndrewNeural"


def tts_rate(rate) -> str:
    try:
        pct = round((float(rate) - 1.0) * 100)
    except (TypeError, ValueError):
        pct = 0
    pct = max(-50, min(100, pct))
    return f"{pct:+d}%"


async def synthesize(text: str, voice: str, rate: str) -> tuple[bytes, list[dict]]:
    """Returns (mp3 bytes, [{w, s, e}] in seconds)."""
    last_err = None
    for attempt in range(4):
        try:
            comm = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
            audio = bytearray()
            words = []
            async for chunk in comm.stream():
                if chunk["type"] == "audio":
                    audio.extend(chunk["data"])
                elif chunk["type"] == "WordBoundary":
                    s = chunk["offset"] / 1e7
                    words.append({"w": chunk["text"], "s": round(s, 3), "e": round(s + chunk["duration"] / 1e7, 3)})
            if not audio:
                raise RuntimeError("no audio returned")
            return bytes(audio), words
        except Exception as e:  # noqa: BLE001 — Edge TTS drops connections now and then
            last_err = e
            log(f"TTS attempt {attempt + 1} failed: {e}")
            await asyncio.sleep(2 * (attempt + 1))
    raise RuntimeError(f"voice generation failed: {last_err}")


def upload(path: str, data: bytes) -> None:
    for attempt in range(4):
        try:
            r = HTTP.post(f"{SUPABASE_URL}/storage/v1/object/renders/{path}", data=data, timeout=(20, 120),
                          headers={"Authorization": f"Bearer {SUPABASE_KEY}", "apikey": SUPABASE_KEY,
                                   "Content-Type": "audio/mpeg", "x-upsert": "true"})
            if r.status_code < 400:
                return
            err = f"{r.status_code}: {r.text[:200]}"
        except Exception as e:  # noqa: BLE001
            err = str(e)
        log(f"upload attempt {attempt + 1} failed ({err})")
    raise RuntimeError(f"voice upload failed: {err}")


async def main() -> int:
    require_env("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
    project_id = sys.argv[1]
    only = {s for s in (sys.argv[2] if len(sys.argv) > 2 else "").split(",") if s}
    if not re.fullmatch(r"[0-9a-f-]{36}", project_id) or any(not re.fullmatch(r"[0-9a-f-]{36}", s) for s in only):
        sys.exit("invalid id")
    db = DB()
    run_url = None
    if os.environ.get("GITHUB_RUN_ID"):
        run_url = f"{os.environ.get('GITHUB_SERVER_URL')}/{os.environ.get('GITHUB_REPOSITORY')}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
    project = db.select("video_projects", {"select": "*", "id": f"eq.{project_id}"})[0]
    db.update("video_projects", {"id": f"eq.{project_id}"}, {"status": "preparing", "run_url": run_url, "error": None})
    scenes = db.select("project_scenes", {"select": "*", "project_id": f"eq.{project_id}", "order": "idx"})
    todo = [s for s in scenes if s["id"] in only] if only else scenes
    voice, rate = tts_voice(project["voice"]), tts_rate(project.get("voice_rate"))
    log(f"Project {project_id}: {len(todo)} of {len(scenes)} scenes, voice {voice} {rate}")

    sem = asyncio.Semaphore(4)

    async def one(scene: dict) -> None:
        text = re.sub(r"\s+", " ", scene["text"]).strip()
        if not text:
            return
        async with sem:
            audio, words = await synthesize(text, voice, rate)
        key = hashlib.sha1(f"{text}|{voice}|{rate}".encode()).hexdigest()[:10]
        path = f"projects/{project_id}/voice/{scene['id']}-{key}.mp3"
        await asyncio.to_thread(upload, path, audio)
        duration = round(len(audio) / BYTES_PER_SECOND, 3)
        if words:
            duration = max(duration, words[-1]["e"])
        db.update("project_scenes", {"id": f"eq.{scene['id']}"},
                  {"voice_path": path, "voice_text": scene["text"], "voice_duration": duration, "words": words})
        log(f"  scene {scene['idx'] + 1}: {duration:.2f}s, {len(words)} words")

    try:
        results = await asyncio.gather(*(one(s) for s in todo), return_exceptions=True)
        errors = [r for r in results if isinstance(r, Exception)]
        if errors:
            raise errors[0]
        db.update("video_projects", {"id": f"eq.{project_id}"}, {"status": "ready", "error": None})
        log("Done")
        return 0
    except Exception as e:  # noqa: BLE001 — report every failure on the project
        db.update("video_projects", {"id": f"eq.{project_id}"}, {"status": "failed", "error": f"{type(e).__name__}: {e}"[:2000]})
        log(f"Failed: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
