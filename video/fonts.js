// Self-hosted fonts (SIL Open Font License), used by the video and its thumbnail, same files for preview and render.
import React from "react";
import { continueRender, delayRender, staticFile } from "remotion";

export const LATIN = "YTC Montserrat";
export const ARABIC = "YTC Noto Sans Arabic";
const FONT_FILES = [
  [LATIN, "fonts/montserrat-latin-800-normal.woff2", "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"],
  [LATIN, "fonts/montserrat-latin-ext-800-normal.woff2", "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF"],
  [ARABIC, "fonts/noto-sans-arabic-arabic-800-normal.woff2", "U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC,U+102E0-102FB,U+10E60-10E7E,U+10EC2-10EC4,U+10EFC-10EFF,U+1EE00-1EEF1"],
];
const fontsLoaded = new Map();
export function useFonts(base) {
  const key = base || "static:";
  const [handle] = React.useState(() => (fontsLoaded.has(key) ? null : delayRender("Loading fonts")));
  React.useEffect(() => {
    if (handle === null) return;
    const p = fontsLoaded.get(key) || Promise.all(FONT_FILES.map(([family, file, range]) => {
      const url = key === "static:" ? staticFile(file) : new URL(file, key).href;
      return new FontFace(family, `url(${url}) format("woff2")`, { weight: "800", unicodeRange: range }).load().then((f) => document.fonts.add(f));
    })).catch((e) => console.warn("font load failed", e));
    fontsLoaded.set(key, p);
    p.finally(() => continueRender(handle));
  }, [handle, key]);
}
