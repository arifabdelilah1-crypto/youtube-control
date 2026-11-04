// The voices of each language. Plain ES module with no dependencies: used by the dashboard and the "Generate video" job.
export const VOICES = {
  en: [["en-US-AndrewNeural-Male", "Andrew (US, male) · warm, confident"], ["en-US-BrianNeural-Male", "Brian (US, male) · casual, sincere"], ["en-US-ChristopherNeural-Male", "Christopher (US, male) · reliable, authority"],
       ["en-US-GuyNeural-Male", "Guy (US, male) · passion"], ["en-US-AvaNeural-Female", "Ava (US, female) · expressive, caring"], ["en-US-JennyNeural-Female", "Jenny (US, female) · friendly, comforting"],
       ["en-GB-RyanNeural-Male", "Ryan (UK, male)"], ["en-GB-SoniaNeural-Female", "Sonia (UK, female)"]],
  fr: [["fr-FR-HenriNeural-Male", "Henri (male)"], ["fr-FR-RemyMultilingualNeural-Male", "Rémy (male)"], ["fr-FR-DeniseNeural-Female", "Denise (female)"],
       ["fr-FR-VivienneMultilingualNeural-Female", "Vivienne (female)"]],
  ar: [["ar-MA-JamalNeural-Male", "Jamal (Morocco, male)"], ["ar-MA-MounaNeural-Female", "Mouna (Morocco, female)"], ["ar-SA-HamedNeural-Male", "Hamed (Saudi, male)"],
       ["ar-SA-ZariyahNeural-Female", "Zariyah (Saudi, female)"], ["ar-EG-ShakirNeural-Male", "Shakir (Egypt, male)"], ["ar-EG-SalmaNeural-Female", "Salma (Egypt, female)"]],
  es: [["es-ES-AlvaroNeural-Male", "Álvaro (male)"], ["es-ES-ElviraNeural-Female", "Elvira (female)"]],
  de: [["de-DE-ConradNeural-Male", "Conrad (male)"], ["de-DE-FlorianMultilingualNeural-Male", "Florian (male)"], ["de-DE-KatjaNeural-Female", "Katja (female)"]],
};
// Supertonic-3: the same ten voices in every language, made on the GitHub machine (collectors/supertonic_voice.py).
const SUPERTONIC_VOICES = [["M", "male"], ["F", "female"]].flatMap(([k, g]) => [1, 2, 3, 4, 5].map((n) => [`supertonic-${k}${n}`, `Supertonic ${k}${n} (${g})`]));
for (const lang of ["en", "fr", "es", "de"]) VOICES[lang].push(...SUPERTONIC_VOICES);
