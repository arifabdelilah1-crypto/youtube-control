// Voice styles: the same voice made darker after it's spoken (collectors/voice_fx.py applies them; keep PRESETS in step).
// Plain ES module with no dependencies: used by the dashboard and the editor.

export const PRESETS = {
  natural: { label: "Natural", rate: 1, pitch: 0, bass: 0, bright: 0, echo: 0 },
  dark: { label: "Dark", rate: 0.92, pitch: -2, bass: 5, bright: -3, echo: 15 },
  deep: { label: "Deep narrator", rate: 0.9, pitch: -4, bass: 8, bright: -3, echo: 0 },
  horror: { label: "Horror", rate: 0.86, pitch: -3, bass: 5, bright: -6, echo: 40 },
};

/** A project's voice effects; none set means the natural voice. */
export function voiceFx(settings) {
  const f = settings?.voice_fx || {};
  return { style: PRESETS[f.style] || f.style === "custom" ? f.style : "natural", pitch: Number(f.pitch) || 0, bass: Number(f.bass) || 0, bright: Number(f.bright) || 0, echo: Number(f.echo) || 0 };
}

export function presetFx(style) {
  const { pitch, bass, bright, echo } = PRESETS[style];
  return { style, pitch, bass, bright, echo };
}

// Heard on the VDS, not kept in the repo: 4 styles of about 60 voices (collectors/make_voice_samples.py).
const SAMPLES = "https://control.homerecipe.casa/voice-samples";

/** The sample of a voice in a style. Custom settings have none: they're heard after "Update voice". */
export function sampleUrl(language, voice, style) {
  return `${SAMPLES}/${language}/${voice}__${PRESETS[style] ? style : "natural"}.mp3`;
}

let playing = null;
/** Plays a sample, or stops it when it's the one playing. Returns a promise of whether it's playing now. */
export async function playSample(url) {
  if (playing) {
    const same = playing.src === url;
    playing.pause();
    playing = null;
    if (same) return false;
  }
  const audio = new Audio(url);
  playing = audio;
  audio.addEventListener("ended", () => { if (playing === audio) playing = null; });
  await audio.play();
  return true;
}
