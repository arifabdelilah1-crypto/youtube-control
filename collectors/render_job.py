"""Render one Studio job with MoneyPrinterTurbo (runs inside the GitHub Actions 'render' workflow).

    python collectors/render_job.py <job_id>

Reads the job from Supabase, renders voice + captions + footage into an MP4 with
MoneyPrinterTurbo's CLI (script is supplied, so no LLM is needed), uploads the video to the
private 'renders' bucket and marks the job done (or failed with the error).
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

from common import DB, HTTP, SUPABASE_KEY, SUPABASE_URL, log, now_iso, require_env

MPT_DIR = Path(os.environ.get("MPT_DIR", "mpt")).resolve()
MAX_UPLOAD_BYTES = 48 * 1024 * 1024          # Supabase free plan: 50 MB per file
VOICE_RE = re.compile(r"^(no-voice|[a-z]{2,3}-[A-Z]{2}-[A-Za-z]+Neural-(Male|Female))$")
HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
FONTS = {"ar": "NotoSansArabic-Bold.ttf"}
DEFAULT_FONT = "BeVietnamPro-Bold.ttf"


def choice(value, allowed, default):
    return value if value in allowed else default


def build_args(p: dict, materials: list[str]) -> list[str]:
    script = (p.get("script") or "").strip()
    if len(script) < 20:
        raise ValueError("script is empty or too short")
    terms = [t.strip() for t in (p.get("terms") or []) if isinstance(t, str) and t.strip()][:12]
    source = choice(p.get("source"), ("pexels", "pixabay", "local"), "pexels")
    if source != "local" and not terms:
        raise ValueError("search terms are required for stock footage")
    if source == "local" and not materials:
        raise ValueError("source is 'local' but no materials were uploaded")
    lang = p.get("language") if re.fullmatch(r"[a-z]{2}", str(p.get("language") or "")) else "en"
    voice = p.get("voice") if VOICE_RE.match(str(p.get("voice") or "")) else "en-US-AndrewNeural-Male"
    sub = p.get("captions") or {}

    args = [
        sys.executable, "cli.py",
        "--video-script", script,
        "--video-language", lang,
        "--video-source", source,
        "--video-aspect", choice(p.get("aspect"), ("9:16", "16:9", "1:1"), "9:16"),
        "--video-concat-mode", choice(p.get("concat"), ("random", "sequential"), "sequential"),
        "--voice-name", voice,
        "--voice-rate", str(min(max(float(p.get("voice_rate") or 1.0), 0.5), 2.0)),
        "--bgm-type", choice(p.get("bgm"), ("random", "none"), "random"),
        "--bgm-volume", str(min(max(float(p.get("bgm_volume") or 0.2), 0.0), 1.0)),
        "--video-clip-duration", str(int(min(max(int(p.get("clip_duration") or 4), 2), 10))),
        "--font-name", FONTS.get(lang, DEFAULT_FONT),
        "--subtitle-position", choice(sub.get("position"), ("top", "center", "bottom"), "bottom"),
        "--subtitle-display-mode", choice(sub.get("mode"), ("sentence", "word_by_word"), "word_by_word"),
        "--subtitle-animation", choice(sub.get("animation"), ("none", "pop_spring"), "pop_spring"),
        "--font-size", str(int(min(max(int(sub.get("font_size") or 70), 30), 140))),
        "--text-fore-color", sub.get("color") if HEX_RE.match(str(sub.get("color") or "")) else "#FFFFFF",
        "--stroke-color", sub.get("stroke_color") if HEX_RE.match(str(sub.get("stroke_color") or "")) else "#000000",
        "--stroke-width", str(min(max(float(sub.get("stroke_width") or 2.0), 0.0), 8.0)),
        "--subtitle-enabled" if sub.get("enabled", True) else "--no-subtitle-enabled",
    ]
    if terms:
        args += ["--video-terms", ",".join(terms)]
    if source == "local":
        args += ["--video-materials", ",".join(materials), "--image-motion", "zoom"]
    return args


def write_config() -> None:
    """config.toml from the example, with stock-footage keys and edge subtitles (no Whisper download)."""
    import toml  # installed with MoneyPrinterTurbo's requirements

    with open(MPT_DIR / "config.example.toml", "rb") as f:
        cfg = tomllib.load(f)
    app = cfg.setdefault("app", {})
    app["pexels_api_keys"] = [k for k in [os.environ.get("PEXELS_API_KEY")] if k]
    app["pixabay_api_keys"] = [k for k in [os.environ.get("PIXABAY_API_KEY")] if k]
    app["subtitle_provider"] = "edge"
    (MPT_DIR / "config.toml").write_text(toml.dumps(cfg), encoding="utf-8")


def download_materials(paths: list[str], dest: Path) -> list[str]:
    dest.mkdir(parents=True, exist_ok=True)
    out = []
    for i, path in enumerate(paths[:40]):
        if not path.startswith("materials/") or ".." in path:
            raise ValueError(f"invalid material path: {path}")
        r = HTTP.get(f"{SUPABASE_URL}/storage/v1/object/renders/{path}",
                     headers={"Authorization": f"Bearer {SUPABASE_KEY}", "apikey": SUPABASE_KEY}, timeout=120)
        r.raise_for_status()
        file = dest / f"{i:03d}{Path(path).suffix.lower() or '.jpg'}"
        file.write_bytes(r.content)
        out.append(str(file))
    return out


def probe_duration(path: str) -> float | None:
    try:
        out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                             capture_output=True, text=True, timeout=60).stdout.strip()
        return round(float(out), 2)
    except (ValueError, subprocess.SubprocessError):
        return None


def fit_size(path: str, duration: float | None) -> str:
    """Re-encode when the file is over the storage limit, aiming just under it."""
    if os.path.getsize(path) <= MAX_UPLOAD_BYTES or not duration:
        return path
    kbps = int(MAX_UPLOAD_BYTES * 8 / duration / 1000 * 0.92) - 128
    out = str(Path(path).with_name("compressed.mp4"))
    subprocess.run(["ffmpeg", "-y", "-i", path, "-c:v", "libx264", "-preset", "veryfast", "-b:v", f"{max(kbps, 300)}k",
                    "-maxrate", f"{max(kbps, 300)}k", "-bufsize", f"{2 * max(kbps, 300)}k", "-c:a", "aac", "-b:a", "128k",
                    "-movflags", "+faststart", out], check=True, capture_output=True, timeout=1800)
    return out


def upload(path: str, object_path: str) -> None:
    with open(path, "rb") as f:
        r = HTTP.post(f"{SUPABASE_URL}/storage/v1/object/renders/{object_path}", data=f,
                      headers={"Authorization": f"Bearer {SUPABASE_KEY}", "apikey": SUPABASE_KEY,
                               "Content-Type": "video/mp4", "x-upsert": "true"}, timeout=600)
    if r.status_code >= 400:
        raise RuntimeError(f"upload failed {r.status_code}: {r.text[:300]}")


def main() -> int:
    require_env("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
    job_id = sys.argv[1]
    if not re.fullmatch(r"[0-9a-f-]{36}", job_id):
        sys.exit("invalid job id")
    db = DB()
    job = db.select("render_jobs", {"select": "*", "id": f"eq.{job_id}"})[0]
    run_url = None
    if os.environ.get("GITHUB_RUN_ID"):
        run_url = f"{os.environ.get('GITHUB_SERVER_URL')}/{os.environ.get('GITHUB_REPOSITORY')}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
    db.update("render_jobs", {"id": f"eq.{job_id}"}, {"status": "running", "started_at": now_iso(), "run_url": run_url, "error": None})

    log_tail = ""
    try:
        p = job["params"] or {}
        materials = download_materials(p.get("materials") or [], MPT_DIR / "storage" / "job_materials") if p.get("source") == "local" else []
        write_config()
        args = build_args(p, materials)
        log(f"Rendering job {job_id}: aspect={p.get('aspect')}, source={p.get('source')}, voice={p.get('voice')}")
        proc = subprocess.run(args, cwd=MPT_DIR, capture_output=True, text=True, timeout=3 * 3600,
                              env={**os.environ, "PYTHONIOENCODING": "utf-8"})
        log_tail = (proc.stderr or "")[-3000:]
        print(log_tail)
        result = None
        for line in reversed((proc.stdout or "").splitlines()):
            if line.startswith("{") and '"task_id"' in line:
                result = json.loads(line)["result"]
                break
        if proc.returncode != 0 or not result or not result.get("videos"):
            raise RuntimeError(f"MoneyPrinterTurbo failed (exit {proc.returncode})")

        video = result["videos"][0]
        if not os.path.isabs(video):
            video = str(MPT_DIR / video)
        duration = probe_duration(video)
        video = fit_size(video, duration)
        object_path = f"videos/{job_id}.mp4"
        upload(video, object_path)
        db.update("render_jobs", {"id": f"eq.{job_id}"},
                  {"status": "done", "output_path": object_path, "duration_s": duration, "finished_at": now_iso()})
        if job.get("idea_id"):
            db.update("ideas", {"id": f"eq.{job['idea_id']}", "stage": "in.(assigned,scripted)"}, {"stage": "produced"})
        log(f"Done: {object_path} ({duration}s)")
        return 0
    except Exception as e:  # noqa: BLE001 — report every failure on the job
        msg = f"{type(e).__name__}: {e}"
        tail = "\n".join([ln for ln in log_tail.splitlines() if "ERROR" in ln or "Error" in ln][-8:])
        db.update("render_jobs", {"id": f"eq.{job_id}"},
                  {"status": "failed", "error": (msg + ("\n" + tail if tail else ""))[:4000], "finished_at": now_iso()})
        log(f"Failed: {msg}")
        return 1
    finally:
        shutil.rmtree(MPT_DIR / "storage" / "job_materials", ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
