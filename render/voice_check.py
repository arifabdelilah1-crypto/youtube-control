# What can be heard in a video: its speech as text, for the final checks of "Generate video".
#   python render/voice_check.py <video> <language>  -> prints the words heard
import sys

from faster_whisper import WhisperModel

model = WhisperModel("base", device="cpu", compute_type="int8")
segments, _ = model.transcribe(sys.argv[1], language=sys.argv[2], beam_size=1, vad_filter=False)
print(" ".join(s.text.strip() for s in segments))
