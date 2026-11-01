"""Voice-over with Supertonic-3, made on the GitHub machine itself (no server, no API key).

The 'Prepare voice' workflow installs the engine and faster-whisper only when a project uses one of these voices.
faster-whisper listens to the result to time each word for the captions; the words shown stay the script's own.
"""
from __future__ import annotations

import difflib
import re
import subprocess
import tempfile
import unicodedata
from pathlib import Path

from common import log

VOICE_RE = re.compile(r"^supertonic-([MF][1-5])$")
MIN_MATCH = 0.5  # below this share of matched letters the timings aren't worth trusting
# Supertonic-3 leaves about 0.5 s of silence before and 0.65 s after every line, which makes a video drag.
# Trimmed to about what Edge TTS leaves (0.1 s and 0.3 s).
TRIM = ("silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.1,areverse,"
        "silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.3,areverse")

_tts = None
_whisper = None


def is_supertonic(voice: str | None) -> bool:
    return bool(VOICE_RE.match(voice or ""))


def letters(word: str) -> list[str]:
    """Lowercase letters and digits without accents, so "20.000" and "20 .000", or "aún" and "aun", compare equal."""
    return [c for c in unicodedata.normalize("NFKD", word.casefold()) if c.isalnum()]


def script_words(text: str) -> list[str]:
    """The script's words; a lone punctuation mark (the French " ?") stays with the word before it."""
    words: list[str] = []
    for token in text.split():
        if words and not letters(token):
            words[-1] += f" {token}"
        else:
            words.append(token)
    return words


def align_words(text: str, heard: list[tuple[str, float, float]], duration: float) -> list[dict]:
    """Times the script's own words from what the transcriber heard: [(word, start, end)] -> [{w, s, e}].

    Words it missed or heard differently ("3 von 4" heard as "drei, vier") share the time between their neighbours.
    Returns [] when the two barely match; the video then spaces the words evenly.
    """
    words = script_words(text)
    chars: list[str] = []
    owner: list[int] = []
    for i, word in enumerate(words):
        for c in letters(word):
            chars.append(c)
            owner.append(i)
    heard_chars: list[str] = []
    heard_times: list[tuple[float, float]] = []
    for word, start, end in heard:
        cs = letters(word)
        step = (end - start) / max(len(cs), 1)
        for k, c in enumerate(cs):
            heard_chars.append(c)
            heard_times.append((start + k * step, start + (k + 1) * step))

    times: list[tuple[float, float] | None] = [None] * len(words)
    matched = 0
    for a, b, size in difflib.SequenceMatcher(None, chars, heard_chars, autojunk=False).get_matching_blocks():
        matched += size
        for k in range(size):
            i, (s, e) = owner[a + k], heard_times[b + k]
            old = times[i] or (s, e)
            times[i] = (min(old[0], s), max(old[1], e))
    if not chars or matched < MIN_MATCH * len(chars):
        return []

    # Words without a match share the gap between their neighbours, by length.
    i = 0
    while i < len(words):
        if times[i] is not None:
            i += 1
            continue
        j = i
        while j < len(words) and times[j] is None:
            j += 1
        left = times[i - 1][1] if i > 0 else 0.0
        right = max(left, times[j][0] if j < len(words) else duration)
        sizes = [max(len(letters(words[k])), 1) for k in range(i, j)]
        pos = left
        for k, size in zip(range(i, j), sizes):
            share = (right - left) * size / sum(sizes)
            times[k] = (pos, pos + share)
            pos += share
        i = j

    out: list[dict] = []
    last = 0.0
    for word, (s, e) in zip(words, times):
        s = min(max(s, last), duration)
        e = min(max(e, s), duration)
        out.append({"w": word, "s": round(s, 3), "e": round(e, 3)})
        last = e
    return out


def _load_tts():
    global _tts
    if _tts is None:
        from supertonic import TTS
        _tts = TTS(auto_download=True)
    return _tts


def _load_whisper():
    global _whisper
    if _whisper is None:
        from faster_whisper import WhisperModel
        _whisper = WhisperModel("base", device="cpu", compute_type="int8")
    return _whisper


def word_timings(text: str, audio_path: Path, lang: str, duration: float) -> list[dict]:
    try:
        segments, _ = _load_whisper().transcribe(str(audio_path), language=lang, word_timestamps=True)
        heard = [(w.word, w.start, w.end) for seg in segments for w in seg.words]
        return align_words(text, heard, duration)
    except Exception as e:  # noqa: BLE001 — not worth losing the voice: without timings the video spaces the words evenly
        log(f"Word timing failed: {e}")
        return []


def speak(text: str, voice: str, rate, lang: str) -> tuple[bytes, list[dict], float]:
    """Returns (mp3 bytes, [{w, s, e}] in seconds, duration in seconds)."""
    tts = _load_tts()
    style = tts.get_voice_style(voice_name=VOICE_RE.match(voice).group(1))
    speed = max(0.7, min(2.0, float(rate or 1)))
    wav, _ = tts.synthesize(text=text, voice_style=style, speed=speed, lang=lang)
    with tempfile.TemporaryDirectory() as folder:
        wav_path, mp3_path = Path(folder) / "voice.wav", Path(folder) / "voice.mp3"
        tts.save_audio(wav, str(wav_path))
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(wav_path), "-af", TRIM, "-b:a", "128k", str(mp3_path)], check=True)
        duration = float(subprocess.check_output(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(mp3_path)]))
        return mp3_path.read_bytes(), word_timings(text, mp3_path, lang, duration), round(duration, 3)
