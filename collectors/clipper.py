"""Long video -> Shorts (the "Long to Shorts" workflow).

    python collectors/clipper.py analyze <clip_sources.id>
        get the video (browser upload on the VDS, or a Google Drive / Dropbox / direct file link), keep it on the VDS with a
        360p preview, transcribe it with faster-whisper (word times), find the scene changes, ask DeepSeek (clipper
        function, "pick") for 1-3 Shorts, snap them to words and scenes, and save them as clips with one frame per scene.
    python collectors/clipper.py render <clips.id>
        cut the reviewed scenes from the original, crop each to 9:16 (face, centre, left, right, or the whole frame on a
        blurred background), join them, burn word-by-word captions and the hook, put the Short on the VDS, and file it as an
        idea + a finished render job so it shows on the Review page.

Files on the VDS (vds/media.php only takes these names): videos/<uuid>.mp4 and thumbs/<uuid>-<8 hex>.jpg.
Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MEDIA_URL, MEDIA_SECRET, RUN_URL (optional).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import math
import os
import re
import secrets
import shutil
import subprocess
import sys
import time
import traceback
import uuid
from pathlib import Path
from urllib.parse import urlencode, urlparse

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import DB, log, now_iso, require_env  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "clip-work"
FONTS = WORK / "fonts"
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
MEDIA_URL = os.environ.get("MEDIA_URL", "").rstrip("/")
MEDIA_SECRET = os.environ.get("MEDIA_SECRET", "")
RUN_URL = os.environ.get("RUN_URL") or None
CHUNK = 16 * 1024 * 1024
MAX_BYTES = 5 * 1024 ** 3
MAX_SECONDS = 3 * 3600
OUT_W, OUT_H = 1080, 1920
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
BLOCKED = re.compile(r"(^|\.)(youtube\.com|youtu\.be|tiktok\.com|twitch\.tv|kick\.com|instagram\.com|facebook\.com|fb\.watch|x\.com|twitter\.com|vimeo\.com|dailymotion\.com)$", re.I)
ARABIC = re.compile(r"[؀-ۿݐ-ݿ]")

db = DB()


# ------------------------------------------------------------------ shell + media helpers
def run(cmd: list[str], timeout: int | None = None, cwd: Path | None = None) -> str:
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=cwd)
    if p.returncode != 0:
        raise RuntimeError(f"{Path(cmd[0]).name} failed: {(p.stderr or p.stdout)[-1500:]}")
    return p.stdout + p.stderr


def probe(path: Path) -> dict:
    out = json.loads(run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)]))
    v = next((s for s in out.get("streams", []) if s.get("codec_type") == "video"), None)
    if not v:
        raise RuntimeError("This file has no video in it.")
    w, h = int(v.get("width") or 0), int(v.get("height") or 0)
    rot = 0
    for sd in v.get("side_data_list", []) or []:
        if "rotation" in sd:
            rot = abs(int(float(sd["rotation"]))) % 180
    if rot == 90 or str(v.get("tags", {}).get("rotate", "0")) in ("90", "270"):
        w, h = h, w
    dur = float(out.get("format", {}).get("duration") or v.get("duration") or 0)
    has_audio = any(s.get("codec_type") == "audio" for s in out.get("streams", []))
    return {"width": w, "height": h, "duration": dur, "audio": has_audio}


def vds_link(method: str, path: str, seconds: int = 6 * 3600) -> str:
    e = int(time.time()) + seconds
    s = hmac.new(MEDIA_SECRET.encode(), f"{method}\n{path}\n{e}".encode(), hashlib.sha256).hexdigest()
    return f"{MEDIA_URL}?{urlencode({'p': path, 'e': e, 's': s})}"


def vds_upload(file: Path, path: str) -> None:
    """Chunked and resumable, like render/media.mjs: the VDS keeps the file only if its size and checksum match."""
    size = file.stat().st_size
    h = hashlib.sha256()
    with open(file, "rb") as f:
        for block in iter(lambda: f.read(8 * 1024 * 1024), b""):
            h.update(block)
    digest = h.hexdigest()
    link = vds_link("PUT", path, 8 * 3600)
    offset, failures, first = 0, 0, True
    with open(file, "rb") as f:
        while True:
            f.seek(offset)
            chunk = f.read(CHUNK)
            last = offset + len(chunk) >= size
            extra = {"offset": offset}
            if first:
                extra["reset"] = 1
            if last:
                extra.update({"final": 1, "size": size, "sha256": digest})
            try:
                r = requests.put(f"{link}&{urlencode(extra)}", data=chunk, headers={"Content-Type": "application/octet-stream"}, timeout=300)
            except requests.RequestException as e:
                failures += 1
                if failures > 6:
                    raise RuntimeError(f"VDS upload failed: {e}")
                time.sleep(2 * failures)
                continue
            if r.ok:
                first = False
                if last:
                    return
                offset = int(r.headers.get("x-offset") or offset + len(chunk))
                failures = 0
            elif r.status_code == 409:
                first = False
                offset = int(r.headers.get("x-offset") or 0)
                failures += 1
            else:
                failures += 1
                if r.status_code < 500 or failures > 6:
                    raise RuntimeError(f"VDS upload failed {r.status_code}: {r.text[:200]}")
            if failures > 6:
                raise RuntimeError("VDS upload failed: offsets keep disagreeing")
            if failures:
                time.sleep(2 * failures)


def stream_to(url: str, dest: Path, headers: dict | None = None) -> None:
    with requests.get(url, headers={"User-Agent": UA, **(headers or {})}, stream=True, timeout=60, allow_redirects=True) as r:
        if r.status_code >= 400:
            raise RuntimeError(f"Download failed ({r.status_code}). Check the link opens the file for anyone who has it.")
        kind = r.headers.get("content-type", "").split(";")[0].lower()
        if kind.startswith("text/html"):
            raise RuntimeError("The link opens a web page, not the video file. Use a direct file link (Dropbox: dl=1; Google Drive: 'Anyone with the link').")
        got = 0
        with open(dest, "wb") as f:
            for block in r.iter_content(4 * 1024 * 1024):
                got += len(block)
                if got > MAX_BYTES:
                    raise RuntimeError("Files up to 5 GB.")
                f.write(block)


def vds_download(path: str, dest: Path) -> None:
    stream_to(vds_link("GET", path), dest)


def cron_secret() -> str:
    return db.rpc("get_cron_secret", {})


def call_clipper(body: dict) -> dict:
    r = requests.post(f"{SUPABASE_URL}/functions/v1/clipper", json=body, headers={"x-cron-secret": cron_secret()}, timeout=180)
    try:
        data = r.json()
    except ValueError:
        data = {}
    if r.status_code >= 400 or data.get("error"):
        raise RuntimeError(data.get("error") or f"clipper function {r.status_code}")
    return data


# ------------------------------------------------------------------ analyze
def set_source(sid: str, **values) -> None:
    db.update("clip_sources", {"id": f"eq.{sid}"}, values)


def fetch_original(src: dict, dest: Path) -> None:
    if src.get("file_path", "") and src["file_path"].startswith("vds:"):
        vds_download(src["file_path"][4:], dest)
        return
    url = src.get("source_url") or ""
    host = urlparse(url).hostname or ""
    if not url.startswith("https://") or BLOCKED.search(host):
        raise RuntimeError("Use a link to the original file (Google Drive, Dropbox or a direct .mp4 link), or upload it.")
    if host.endswith("drive.google.com") or host.endswith("docs.google.com"):
        import gdown  # handles the "can't scan this file for viruses" page of big files
        if not gdown.download(url, str(dest), quiet=True, fuzzy=True):
            raise RuntimeError("Google Drive didn't give the file. Share it as 'Anyone with the link' and try again.")
        return
    if host.endswith("dropbox.com"):
        url = re.sub(r"([?&])dl=0", r"\1dl=1", url)
        if "dl=1" not in url and "raw=1" not in url:
            url += ("&" if "?" in url else "?") + "dl=1"
    stream_to(url, dest)


def make_proxy(src: Path, dest: Path) -> None:
    run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-vf", "scale='if(gt(iw,ih),-2,360)':'if(gt(iw,ih),360,-2)'", "-r", "25",
         "-c:v", "libx264", "-preset", "ultrafast", "-crf", "31", "-c:a", "aac", "-b:a", "64k", "-ac", "1", "-movflags", "+faststart", str(dest)])


def transcribe(src: Path, sid: str, duration: float, language: str | None) -> tuple[list, list, str]:
    from faster_whisper import WhisperModel
    wav = WORK / "audio.wav"
    run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000", str(wav)])
    if not language:  # find the language on the first minute first: the model size depends on it
        head = WORK / "head.wav"
        run(["ffmpeg", "-y", "-v", "error", "-ss", str(min(60, duration / 4)), "-t", "45", "-i", str(wav), str(head)])
        _, probe_info = WhisperModel("base", device="cpu", compute_type="int8").transcribe(str(head), beam_size=1)
        language = probe_info.language if probe_info.language_probability > 0.5 else None
        log(f"Language: {probe_info.language} ({probe_info.language_probability:.0%})")
    # bigger models hear accents and dialects (Darija, Gulf, Latin American Spanish) much better; they're slower on the free machine
    hard = (language or "") in ("ar",)
    model_name = ("medium" if duration <= (35 if hard else 15) * 60 else "small" if duration <= 60 * 60 else "base")
    log(f"Transcribing {duration / 60:.0f} min with whisper {model_name}")
    model = WhisperModel(model_name, device="cpu", compute_type="int8", cpu_threads=os.cpu_count() or 4)
    segments, info = model.transcribe(str(wav), language=language, word_timestamps=True, vad_filter=True, beam_size=1,
                                      condition_on_previous_text=False)
    words, lines, last_report = [], [], time.time()
    for seg in segments:
        ws = [w for w in (seg.words or []) if w.word.strip()]
        for w in ws:
            words.append([round(w.start, 2), round(w.end, 2), w.word.strip()])
        if ws:
            lines.append([round(ws[0].start, 2), round(ws[-1].end, 2), seg.text.strip()])
        if time.time() - last_report > 20:
            last_report = time.time()
            pct = min(95, int(seg.end / max(duration, 1) * 100))
            set_source(sid, progress=pct, step=f"Transcribing: {pct}%")
    return words, lines, info.language


def scene_cuts(proxy: Path) -> list[float]:
    out = subprocess.run(["ffmpeg", "-v", "info", "-i", str(proxy), "-vf", "select='gt(scene,0.32)',showinfo", "-an", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    cuts = sorted(float(m) for m in re.findall(r"pts_time:([0-9.]+)", out))
    kept: list[float] = []
    for t in cuts:
        if not kept or t - kept[-1] >= 1.0:
            kept.append(round(t, 2))
    return kept


def snap(seg: dict, words: list, cuts: list[float], duration: float) -> tuple[float, float] | None:
    a, b = float(seg["start"]), float(seg["end"])
    inside = [w for w in words if w[1] > a - 0.4 and w[0] < b + 0.4]
    if not inside:
        return None
    first, last = inside[0], inside[-1]
    prev_end = max([w[1] for w in words if w[1] <= first[0]] or [0.0])
    next_start = min([w[0] for w in words if w[0] >= last[1]] or [duration])
    start = max(prev_end, first[0] - 0.15, 0.0)
    end = min(next_start - 0.05, last[1] + 0.3, duration)
    near = [c for c in cuts if start - 0.6 <= c <= start + 0.3 and not any(start <= w[0] < c for w in words)]
    if near:
        start = near[-1]
    near = [c for c in cuts if end - 0.3 <= c <= end + 0.6 and not any(c > w[0] >= end - 0.05 for w in words)]
    if near:
        end = near[0]
    return (round(start, 2), round(end, 2)) if end - start >= 1.5 else None


def split_scenes(start: float, end: float, cuts: list[float]) -> list[tuple[float, float]]:
    marks = [start] + [c for c in cuts if start + 1.2 < c < end - 1.2] + [end]
    pieces = [(marks[i], marks[i + 1]) for i in range(len(marks) - 1)]
    merged: list[tuple[float, float]] = []
    for p in pieces:
        if merged and p[1] - p[0] < 1.2:
            merged[-1] = (merged[-1][0], p[1])
        else:
            merged.append(p)
    while len(merged) > 15:  # keep the review list readable: join the shortest neighbours
        i = min(range(len(merged) - 1), key=lambda k: (merged[k][1] - merged[k][0]) + (merged[k + 1][1] - merged[k + 1][0]))
        merged[i:i + 2] = [(merged[i][0], merged[i + 1][1])]
    return merged


_face = None


def faces_in(img) -> list[tuple[int, int, int, int]]:
    global _face
    import cv2
    if _face is None:
        _face = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    if _face.empty():  # no face model in this OpenCV build: centre crops instead of failing
        return []
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    min_side = max(24, int(min(gray.shape[:2]) * 0.08))
    found = _face.detectMultiScale(gray, scaleFactor=1.12, minNeighbors=6, minSize=(min_side, min_side))
    return [tuple(int(v) for v in f) for f in found]


def frame_at(video: Path, t: float, width: int | None = None):
    import cv2
    import numpy as np
    vf = ["-vf", f"scale={width}:-2"] if width else []
    p = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{max(t, 0):.2f}", "-i", str(video), "-frames:v", "1", *vf, "-f", "image2pipe", "-vcodec", "png", "-"],
                       capture_output=True)
    if p.returncode != 0 or not p.stdout:
        return None
    return cv2.imdecode(np.frombuffer(p.stdout, np.uint8), cv2.IMREAD_COLOR)


def analyze(sid: str) -> None:
    src = db.select("clip_sources", {"id": f"eq.{sid}", "select": "*"})[0]
    settings = src.get("settings") or {}
    set_source(sid, status="downloading", progress=0, step="Getting the video", error=None, run_url=RUN_URL)
    original = WORK / "original.mp4"
    fetch_original(src, original)
    info = probe(original)
    if info["duration"] > MAX_SECONDS:
        raise RuntimeError("Videos up to 3 hours.")
    if not info["audio"]:
        raise RuntimeError("This video has no sound, so there's nothing to transcribe.")
    file_path = src.get("file_path")
    if not file_path:
        set_source(sid, step="Storing the video on your server")
        vds_upload(original, f"videos/{sid}.mp4")
        file_path = f"vds:videos/{sid}.mp4"
    set_source(sid, step="Making a small preview", file_path=file_path, duration_s=round(info["duration"], 2), width=info["width"], height=info["height"])
    proxy = WORK / "proxy.mp4"
    make_proxy(original, proxy)
    proxy_path = f"videos/{uuid.uuid4()}.mp4"
    vds_upload(proxy, proxy_path)
    set_source(sid, proxy_path=f"vds:{proxy_path}", status="transcribing", progress=0, step="Transcribing")

    lang = settings.get("language") if settings.get("language") not in (None, "", "auto") else None
    words, lines, detected = transcribe(original, sid, info["duration"], lang)
    if len(words) < 20:
        raise RuntimeError("Almost no speech was found in this video. Shorts are picked from what's said, so it needs talking.")
    set_source(sid, status="finding", progress=100, step="Finding scene changes", language=detected)
    cuts = scene_cuts(proxy)
    set_source(sid, words=words, scene_cuts=cuts, step="Choosing the best moments")

    transcript = "\n".join(f"[{s:.1f}-{e:.1f}] {t}" for s, e, t in lines)
    shorts = call_clipper({"action": "pick", "source_id": sid, "title": src.get("title"), "transcript": transcript, "duration": info["duration"],
                           "language": detected, "settings": settings, "scenes": cuts})["shorts"]

    set_source(sid, step="Preparing the scenes")
    # a new analysis replaces the Shorts not rendered yet
    for old in db.select("clips", {"source_id": f"eq.{sid}", "status": "in.(draft,failed)", "select": "id"}):
        requests.delete(f"{db.base}/clips", headers=db.h, params={"id": f"eq.{old['id']}"}, timeout=60)
    rows = []
    for n, s in enumerate(shorts):
        scenes = []
        spans: list[tuple[float, float]] = []
        for seg in s["segments"]:
            snapped = snap(seg, words, cuts, info["duration"])
            if not snapped:
                continue
            a, b = snapped
            for pa, pb in spans:  # never play the same second twice: trim what overlaps a span already taken
                if a < pb and b > pa:
                    if a >= pa:
                        a = pb
                    elif b <= pb:
                        b = pa
            if b - a < 1.5:
                continue
            if spans and abs(a - spans[-1][1]) < 0.05:  # touching the previous span: one continuous span
                spans[-1] = (spans[-1][0], b)
            else:
                spans.append((a, b))
        for span in spans:
            for a, b in split_scenes(*span, cuts):
                mid = (a + b) / 2
                img = frame_at(proxy, mid)
                crop = "center"
                if img is not None:
                    if info["width"] <= info["height"] * 0.6:
                        crop = "fit"
                    elif faces_in(img):
                        crop = "face"
                thumb = None
                if img is not None:
                    import cv2
                    jpg = WORK / f"t-{n}-{len(scenes)}.jpg"
                    cv2.imwrite(str(jpg), img, [cv2.IMWRITE_JPEG_QUALITY, 80])
                    thumb = f"thumbs/{sid}-{secrets.token_hex(4)}.jpg"
                    vds_upload(jpg, thumb)
                    thumb = f"vds:{thumb}"
                scenes.append({"start": round(a, 2), "end": round(b, 2), "crop": crop, "thumb": thumb})
        if not scenes:
            continue
        rows.append({"source_id": sid, "idx": n, "score": s["score"], "reason": s["reason"], "hook": s["hook"], "title": s["title"],
                     "description": s["description"], "tags": s["tags"], "scenes": scenes, "ai_scenes": scenes,
                     "channel_id": settings.get("channel_id"), "status": "draft"})
    if not rows:
        raise RuntimeError("DeepSeek's moments didn't match the transcript. Press Try again.")
    db.insert("clips", rows, returning=False)
    set_source(sid, status="ready", progress=100, step=f"{len(rows)} Short{'s' if len(rows) > 1 else ''} ready to review")
    log(f"Done: {len(rows)} Shorts")


# ------------------------------------------------------------------ render
def setup_fonts() -> None:
    """The dashboard's caption fonts (Montserrat 800, Noto Sans Arabic 800) as TTF for libass."""
    from fontTools.ttLib import TTFont
    FONTS.mkdir(parents=True, exist_ok=True)
    for f in (ROOT / "web" / "fonts").glob("*.woff2"):
        out = FONTS / (f.stem + ".ttf")
        if not out.exists():
            font = TTFont(str(f))
            font.flavor = None
            font.save(str(out))


def ass_time(t: float) -> str:
    t = max(t, 0)
    return f"{int(t // 3600)}:{int(t % 3600 // 60):02d}:{t % 60:05.2f}"


def ass_escape(s: str) -> str:
    return s.replace("\\", "").replace("{", "(").replace("}", ")").replace("\n", " ")


def captions_ass(clip: dict, timed: list) -> str:
    """timed: [[start, end, word, scene index], ...] on the Short's own timeline."""
    arabic = any(ARABIC.search(w[2]) for w in timed[:40]) or (clip.get("narrator_lang") == "ar")
    font = "Noto Sans Arabic" if arabic else "Montserrat"
    groups: list[list] = []
    for w in timed:
        g = groups[-1] if groups else None
        text_len = sum(len(x[2]) + 1 for x in g) if g else 0
        new = (not g or len(g) >= 3 or text_len + len(w[2]) > 18 or w[0] - g[-1][1] > 0.5 or g[-1][3] != w[3]
               or re.search(r"[.!?…،؟,]$", g[-1][2]))
        if new:
            groups.append([w])
        else:
            g.append(w)
    events = []
    for gi, g in enumerate(groups):
        next_start = groups[gi + 1][0][0] if gi + 1 < len(groups) else 1e9
        for i, w in enumerate(g):
            start = w[0]
            end = g[i + 1][0] if i + 1 < len(g) else min(w[1] + 0.12, next_start)
            parts = []
            for j, x in enumerate(g):
                word = ass_escape(x[2] if arabic else x[2].upper())
                parts.append(r"{\1c&H00E5FF&\fscx112\fscy112}" + word + r"{\r}" if j == i else word)
            events.append(f"Dialogue: 0,{ass_time(start)},{ass_time(max(end, start + 0.05))},Cap,,0,0,0,,{' '.join(parts)}")
    hook = ass_escape(clip.get("hook") or "")
    if hook:
        events.insert(0, f"Dialogue: 1,{ass_time(0)},{ass_time(3.2)},Hook,,0,0,0,,{{\\fad(120,200)}}{hook if arabic else hook.upper()}")
    return "\n".join([
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {OUT_W}", f"PlayResY: {OUT_H}", "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        f"Style: Cap,{font},84,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,1,0,1,6,2,2,90,90,430,1",
        f"Style: Hook,{font},70,&H00FFFFFF,&H00FFFFFF,&H1A000000,&H1A000000,-1,0,0,0,100,100,0,0,3,18,0,8,110,110,250,1",
        "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text", *events, ""])


def crop_x(original: Path, sc: dict, w: int, h: int, cw: int, start: float, dur: float) -> int:
    if sc["crop"] == "left":
        return 0
    if sc["crop"] == "right":
        return w - cw
    centre = (w - cw) // 2
    if sc["crop"] != "face":
        return centre
    xs = []
    n = min(12, max(3, int(dur / 0.5)))
    for k in range(n):
        img = frame_at(original, start + dur * (k + 0.5) / n, 640)
        if img is None:
            continue
        found = faces_in(img)
        if found:
            fx, fy, fw, fh = max(found, key=lambda f: f[2] * f[3])
            xs.append((fx + fw / 2) * w / img.shape[1])
    if not xs:
        return centre
    xs.sort()
    return int(min(max(xs[len(xs) // 2] - cw / 2, 0), w - cw))


# ---- narrator voice (Microsoft Edge TTS, like the Studio's voice job)
VOICE_RE = re.compile(r"^([a-z]{2,3}-[A-Z]{2}-[A-Za-z]+Neural)(-(Male|Female))?$")
DEFAULT_VOICES = {"en": "en-US-AndrewNeural", "ar": "ar-MA-JamalNeural", "es": "es-ES-AlvaroNeural", "fr": "fr-FR-HenriNeural", "de": "de-DE-ConradNeural"}


def speak(text: str, voice: str, rate: float, dest: Path) -> list:
    """Writes the MP3 and returns [[start, end, word], ...] in seconds."""
    import asyncio
    import edge_tts
    pct = max(-50, min(100, round((float(rate or 1) - 1) * 100)))

    async def go():
        last = None
        for attempt in range(4):
            try:
                comm = edge_tts.Communicate(text, voice, rate=f"{pct:+d}%", boundary="WordBoundary")
                audio, words = bytearray(), []
                async for chunk in comm.stream():
                    if chunk["type"] == "audio":
                        audio.extend(chunk["data"])
                    elif chunk["type"] == "WordBoundary":
                        st = chunk["offset"] / 1e7
                        words.append([round(st, 3), round(st + chunk["duration"] / 1e7, 3), chunk["text"]])
                if not audio:
                    raise RuntimeError("no audio returned")
                dest.write_bytes(bytes(audio))
                return words
            except Exception as e:  # noqa: BLE001 - Edge TTS drops connections now and then
                last = e
                await asyncio.sleep(2 * (attempt + 1))
        raise RuntimeError(f"The narrator voice failed: {last}")
    return asyncio.run(go())


def fetch_footage(fo: dict, i: int) -> Path:
    url = fo.get("url") or ""
    if not url.startswith("https://"):
        raise RuntimeError(f"Scene {i + 1}: the footage link is broken. Pick it again.")
    ext = ".jpg" if fo.get("type") == "image" else ".mp4"
    dest = WORK / f"stock-{i:02d}{ext}"
    stream_to(url, dest)
    return dest


def visual_filter(label: str, sc: dict, info: dict | None, original: Path | None, start: float, dur: float) -> str:
    """A filter turning input `label` into 1080x1920, 30 fps, called [v]."""
    tail = f"setsar=1,fps=30,format=yuv420p,trim=duration={dur:.3f},setpts=PTS-STARTPTS[v]"
    w, h = (info or {}).get("width", 0), (info or {}).get("height", 1)
    if info and sc["crop"] != "fit" and w / h > OUT_W / OUT_H + 0.02:
        cw = int(h * OUT_W / OUT_H) // 2 * 2
        x = crop_x(original, sc, w, h, cw, start, dur)
        return f"[{label}]crop={cw}:{h}:{x}:0,scale={OUT_W}:{OUT_H}:flags=lanczos,{tail}"
    if info is None and sc.get("_stock_type") != "image":  # stock clips fill the frame
        return f"[{label}]scale={OUT_W}:{OUT_H}:force_original_aspect_ratio=increase,crop={OUT_W}:{OUT_H},{tail}"
    if sc.get("_stock_type") == "image":  # a slow push-in on photos
        frames = max(int(dur * 30), 1)
        return (f"[{label}]scale={OUT_W * 2}:{OUT_H * 2}:force_original_aspect_ratio=increase,crop={OUT_W * 2}:{OUT_H * 2},"
                f"zoompan=z='min(1+0.10*on/{frames},1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s={OUT_W}x{OUT_H}:fps=30,{tail}")
    return (f"[{label}]split=2[a][b];[a]scale={OUT_W}:{OUT_H}:force_original_aspect_ratio=increase,crop={OUT_W}:{OUT_H},boxblur=28:2,eq=brightness=-0.08[bg];"
            f"[b]scale={OUT_W}:{OUT_H}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,{tail}")


def render_scene(i: int, sc: dict, original: Path, info: dict, clip: dict, out: Path) -> tuple[float, list]:
    """Renders one scene to `out`; returns (seconds, caption words on the scene's own timeline)."""
    narrator = sc.get("kind") == "narrator" and (sc.get("text") or "").strip()
    words_here: list = []
    if narrator:
        voice_mp3 = WORK / f"voice-{i:02d}.mp3"
        lang = (clip.get("narrator_lang") or "en")[:2]
        m = VOICE_RE.match(clip.get("voice") or "")
        voice = m.group(1) if m else DEFAULT_VOICES.get(lang, DEFAULT_VOICES["en"])
        words_here = speak(sc["text"].strip(), voice, clip.get("voice_rate") or 1.0, voice_mp3)
        dur = round(probe_audio(voice_mp3) + 0.25, 3)
    else:
        dur = round(sc["end"] - sc["start"], 3)
    start = sc["start"]
    if narrator:  # the picture runs as long as the voice: keep it inside the long video
        start = max(0.0, min(start, info["duration"] - dur))
    args = ["ffmpeg", "-y", "-v", "error"]
    fo = sc.get("footage") if isinstance(sc.get("footage"), dict) and sc["footage"].get("url") else None
    inputs, filters = 0, []
    need_source_audio = not narrator or float(sc.get("under") or 0) > 0
    if fo:
        stock = fetch_footage(fo, i)
        sc["_stock_type"] = "image" if fo.get("type") == "image" else "video"
        args += (["-i", str(stock)] if sc["_stock_type"] == "image" else ["-stream_loop", "-1", "-t", f"{dur + 0.5:.3f}", "-i", str(stock)])
        filters.append(visual_filter("0:v", sc, None, None, start, dur))
        inputs = 1
        if need_source_audio:
            args += ["-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", str(original)]
            src_a = f"{inputs}:a"
            inputs += 1
    else:
        args += ["-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", str(original)]
        filters.append(visual_filter("0:v", sc, info, original, start, dur))
        src_a = "0:a"
        inputs = 1
    fade = f"afade=t=in:st=0:d=0.03,afade=t=out:st={max(dur - 0.06, 0):.3f}:d=0.06"
    if narrator:
        args += ["-i", str(voice_mp3)]
        v_a = f"{inputs}:a"
        if need_source_audio:
            vol = min(max(float(sc.get("under") or 0), 0), 0.4)
            filters.append(f"[{src_a}]aresample=48000,volume={vol:.2f}[bed];[{v_a}]aresample=48000,apad[vo];[vo][bed]amix=inputs=2:duration=first:normalize=0,"
                           f"atrim=duration={dur:.3f},{fade}[a]")
        else:
            filters.append(f"[{v_a}]aresample=48000,apad,atrim=duration={dur:.3f},{fade}[a]")
    else:
        filters.append(f"[{src_a}]aresample=48000,apad,atrim=duration={dur:.3f},{fade}[a]")
    run(args + ["-filter_complex", ";".join(filters), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
                "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", str(out)])
    return dur, words_here


def probe_audio(path: Path) -> float:
    return float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)]).strip() or 0)


def credits_of(scenes: list[dict]) -> str:
    lines = []
    for sc in scenes:
        fo = sc.get("footage") if isinstance(sc.get("footage"), dict) else None
        if fo and fo.get("url"):
            who = fo.get("author") or fo.get("source") or "stock"
            lic = f", {fo['license']}" if fo.get("license") else ""
            line = f"{who}{lic} via {str(fo.get('source') or 'stock').capitalize()}"
            if line not in lines:
                lines.append(line)
    return ("\n\nFootage: " + "; ".join(lines)) if lines else ""


def render(cid: str) -> None:
    clip = db.select("clips", {"id": f"eq.{cid}", "select": "*"})[0]
    src = db.select("clip_sources", {"id": f"eq.{clip['source_id']}", "select": "*"})[0]
    db.update("clips", {"id": f"eq.{cid}"}, {"status": "rendering", "error": None, "run_url": RUN_URL})
    scenes = []
    for s in clip["scenes"]:
        s["start"], s["end"] = float(s.get("start") or 0), float(s.get("end") or 0)
        s["crop"] = s.get("crop") if s.get("crop") in ("face", "center", "left", "right", "fit") else "center"
        if (s.get("kind") == "narrator" and (s.get("text") or "").strip()) or s["end"] - s["start"] >= 0.3:
            scenes.append(s)
    if not scenes:
        raise RuntimeError("This Short has no scenes left.")
    log("Getting the long video")
    original = WORK / "original.mp4"
    vds_download(src["file_path"][4:], original)
    info = probe(original)
    pieces, timed, offset = [], [], 0.0
    src_words = src.get("words") or []
    for i, sc in enumerate(scenes):
        out = WORK / f"piece-{i:02d}.mp4"
        dur, vo_words = render_scene(i, sc, original, info, clip, out)
        if sc.get("kind") == "narrator":
            timed += [[offset + w[0], min(offset + w[1], offset + dur), w[2], i] for w in vo_words]
        else:
            a, b = sc["start"], sc["end"]
            timed += [[offset + w[0] - a, min(offset + w[1] - a, offset + dur), w[2], i] for w in src_words if w[0] >= a - 0.05 and w[1] <= b + 0.15 and w[0] < b]
        offset += dur
        pieces.append(out)
        log(f"Scene {i + 1}/{len(scenes)} done ({sc.get('kind') or 'original'}, {dur:.1f} s)")
    listing = WORK / "pieces.txt"
    listing.write_text("".join(f"file '{p.name}'\n" for p in pieces))
    joined = WORK / "joined.mp4"
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", str(joined)])
    setup_fonts()
    subs = WORK / "subs.ass"
    subs.write_text(captions_ass(clip, timed), encoding="utf-8")
    final = WORK / "short.mp4"
    # relative names: the ass filter's own option syntax trips over full paths
    run(["ffmpeg", "-y", "-v", "error", "-i", joined.name, "-vf", f"ass={subs.name}:fontsdir={FONTS.name}", "-c:v", "libx264", "-preset", "veryfast",
         "-crf", "20", "-c:a", "copy", "-movflags", "+faststart", final.name], cwd=WORK)
    duration = probe(final)["duration"]
    thumb = WORK / "thumb.jpg"
    run(["ffmpeg", "-y", "-v", "error", "-ss", "1.0", "-i", str(final), "-frames:v", "1", "-q:v", "3", str(thumb)])
    vds_upload(final, f"videos/{cid}.mp4")
    thumb_path = f"thumbs/{cid}-{secrets.token_hex(4)}.jpg"
    vds_upload(thumb, thumb_path)

    channel = db.select("channels", {"id": f"eq.{clip['channel_id']}", "select": "id,niche_id"})[0] if clip.get("channel_id") else {}
    description = (clip.get("description") or "") + credits_of(scenes)
    fields = {"title": clip.get("title") or src["title"], "video_title": clip.get("title") or src["title"], "video_description": description[:4900],
              "video_tags": clip.get("tags") or [], "channel_id": clip.get("channel_id"), "niche_id": channel.get("niche_id"), "stage": "produced"}
    if clip.get("idea_id"):
        db.update("ideas", {"id": f"eq.{clip['idea_id']}"}, fields)
        idea_id = clip["idea_id"]
    else:
        idea_id = db.insert("ideas", {**fields, "sources": {"clipper": {"source_id": src["id"], "clip_id": cid}},
                                      "ai": {"aspect": "9:16", "language": clip.get("narrator_lang") or src.get("language") or "en"}})[0]["id"]
    job = db.insert("render_jobs", {"idea_id": idea_id, "channel_id": clip.get("channel_id"), "status": "done", "output_path": f"vds:videos/{cid}.mp4",
                                    "duration_s": round(duration, 2), "started_at": now_iso(), "finished_at": now_iso(), "run_url": RUN_URL,
                                    "params": {"title": fields["title"], "aspect": "9:16", "source": "clipper", "clip_id": cid}})[0]
    db.update("clips", {"id": f"eq.{cid}"}, {"status": "done", "output_path": f"vds:videos/{cid}.mp4", "thumb_path": f"vds:{thumb_path}",
                                             "duration_s": round(duration, 2), "idea_id": idea_id, "render_job_id": job["id"], "error": None})
    log(f"Done: {duration:.1f} s, on the Review page")


def main() -> int:
    require_env("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "MEDIA_URL", "MEDIA_SECRET")
    mode, rid = (sys.argv[1:3] + ["", ""])[:2]
    if mode not in ("analyze", "render") or not re.fullmatch(r"[0-9a-f-]{36}", rid):
        sys.exit("usage: clipper.py analyze|render <id>")
    shutil.rmtree(WORK, ignore_errors=True)
    WORK.mkdir(parents=True)
    try:
        analyze(rid) if mode == "analyze" else render(rid)
        return 0
    except Exception as e:  # noqa: BLE001 - every failure is shown on the page
        traceback.print_exc()
        msg = str(e)
        msg = msg[:1500]
        if mode == "analyze":
            set_source(rid, status="failed", error=msg)
        else:
            db.update("clips", {"id": f"eq.{rid}"}, {"status": "failed", "error": msg})
        return 1


if __name__ == "__main__":
    sys.exit(main())
