"""The short samples behind the Listen button: every voice of the dashboard in every voice style.

    python collectors/make_voice_samples.py <output folder> <voices.json>

voices.json is {language: [voice id, ...]}. The files go on the VDS in public_html/voice-samples, not in the repo.
"""
from __future__ import annotations

import asyncio
import json
import re
import sys
from pathlib import Path

import edge_tts

from supertonic_voice import is_supertonic, speak
from voice_fx import PRESETS, apply_fx, has_fx

LINES = {
    "en": "They never yell. They just stop talking to you. And slowly, you start to believe it's your fault.",
    "fr": "Ils ne crient jamais. Ils cessent simplement de vous parler. Et peu à peu, vous croyez que tout est de votre faute.",
    "es": "Nunca gritan. Simplemente dejan de hablarte. Y poco a poco, empiezas a creer que todo es culpa tuya.",
    "de": "Sie schreien nie. Sie hören einfach auf, mit dir zu reden. Und langsam glaubst du, dass alles deine Schuld ist.",
    "ar": "لا يصرخون أبدا. يتوقفون فقط عن الكلام معك. وشيئا فشيئا تبدأ في تصديق أن كل شيء خطؤك.",
}


async def spoken(text: str, voice: str, rate: float, lang: str) -> bytes:
    if is_supertonic(voice):
        return (await asyncio.to_thread(speak, text, voice, rate, lang))[0]
    name = re.sub(r"-(Male|Female)$", "", voice)
    pct = f"{round((rate - 1) * 100):+d}%"
    for attempt in range(4):
        try:
            audio = bytearray()
            async for chunk in edge_tts.Communicate(text, name, rate=pct).stream():
                if chunk["type"] == "audio":
                    audio.extend(chunk["data"])
            if audio:
                return bytes(audio)
            raise RuntimeError("no audio returned")
        except Exception as e:  # noqa: BLE001 — Edge TTS drops connections now and then
            print(f"retry {voice}: {e}", flush=True)
            await asyncio.sleep(3 * (attempt + 1))
    raise RuntimeError(f"no audio for {voice}")


async def main() -> int:
    out = Path(sys.argv[1])
    voices = json.loads(Path(sys.argv[2]).read_text())
    failed = 0
    for lang, names in voices.items():
        (out / lang).mkdir(parents=True, exist_ok=True)
        for voice in names:
            for style, p in PRESETS.items():
                try:
                    audio = await spoken(LINES[lang], voice, p["rate"], lang)
                    if has_fx(p):
                        audio = apply_fx(audio, p)[0]
                    (out / lang / f"{voice}__{style}.mp3").write_bytes(audio)
                    print(lang, voice, style, len(audio), flush=True)
                except Exception as e:  # noqa: BLE001 — one voice shouldn't stop the others
                    failed += 1
                    print(f"FAILED {lang} {voice} {style}: {e}", flush=True)
    print(f"failed: {failed}", flush=True)
    voices_info = await edge_tts.list_voices()
    traits = {v["ShortName"]: v.get("VoiceTag", {}).get("VoicePersonalities", []) for v in voices_info}
    (out / "traits.json").write_text(json.dumps(traits, ensure_ascii=False, indent=0))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
