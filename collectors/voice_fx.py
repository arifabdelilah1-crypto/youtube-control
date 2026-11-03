"""Voice styles: pitch, bass, brightness and echo applied to a spoken line with ffmpeg.

The length stays the same apart from the echo's tail, so word timings stay right. Speed isn't here: the voice
engine itself speaks slower. The natural voice isn't touched at all. web/voicefx.js has the same PRESETS.
"""
from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

PRESETS = {
    "natural": {"rate": 1, "pitch": 0, "bass": 0, "bright": 0, "echo": 0},
    "dark": {"rate": 0.92, "pitch": -2, "bass": 5, "bright": -3, "echo": 15},
    "deep": {"rate": 0.9, "pitch": -4, "bass": 8, "bright": -3, "echo": 0},
    "horror": {"rate": 0.86, "pitch": -3, "bass": 5, "bright": -6, "echo": 40},
}


def _number(value, low: float, high: float) -> float:
    try:
        return max(low, min(high, float(value)))
    except (TypeError, ValueError):
        return 0.0


def clean_fx(fx) -> dict:
    """Settings can be edited from the browser: only numbers in range ever reach ffmpeg."""
    fx = fx if isinstance(fx, dict) else {}
    return {"pitch": _number(fx.get("pitch"), -6, 3), "bass": _number(fx.get("bass"), 0, 10),
            "bright": _number(fx.get("bright"), -8, 4), "echo": _number(fx.get("echo"), 0, 100)}


def has_fx(fx) -> bool:
    return any(clean_fx(fx).values())


def chain(fx) -> str:
    f = clean_fx(fx)
    parts = []
    if f["pitch"]:
        parts.append(f"rubberband=pitch={2 ** (f['pitch'] / 12):.4f}")
    parts.append("highpass=f=60")
    if f["bass"]:
        parts.append(f"equalizer=f=120:t=q:w=1:g={f['bass']:g}")
    if f["bright"]:
        parts.append(f"equalizer=f=4500:t=q:w=1.5:g={f['bright']:g}")
    if f["echo"]:
        e = f["echo"] / 100
        first = round(60 + e * 300)
        parts.append(f"aecho=0.8:0.6:{first}|{first * 2}:{e * 0.7:.3f}|{e * 0.4:.3f}")
    parts.append("acompressor=threshold=-20dB:ratio=3:attack=10:release=200")
    parts.append("alimiter=limit=0.95")
    return ",".join(parts)


def duration_of(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         check=True, capture_output=True, text=True).stdout
    return float(out.strip())


def apply_fx(audio: bytes, fx) -> tuple[bytes, float]:
    """Returns (mp3 bytes, seconds)."""
    with tempfile.TemporaryDirectory() as tmp:
        src, dest = Path(tmp) / "in.mp3", Path(tmp) / "out.mp3"
        src.write_bytes(audio)
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-af", chain(fx), "-ar", "44100", "-b:a", "128k", str(dest)],
                       check=True, capture_output=True, text=True)
        return dest.read_bytes(), round(duration_of(dest), 3)
