// Checks a Story stick film before it is rendered: it compiles, defines Film, and draws every 6th frame in each look
// without throwing and without NaN in the drawing. The film is AI-written code, so this runs in its own Node process with
// no environment (no keys) and the permission model on: it can only read the kit and React (see runCheck in render/story.mjs).
// usage: node story_check.mjs <input.json>   input: {code, lines: [text], aspect: "9:16" | "16:9"}
// prints: {"ok": true, "frames": n} or {"ok": false, "error": "..."}
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { THEMES, ThemeContext } from "../video/story/kit.js";
import { compileFilm } from "../video/story/compile.js";

const FPS = 30;
const out = (o) => { process.stdout.write(JSON.stringify(o)); process.exit(0); };

try {
  const input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const [W, H] = input.aspect === "16:9" ? [1920, 1080] : [1080, 1920];
  // the voice isn't made yet: words timed at ~2.6 words a second, scenes one after the other
  const scenes = [], words = [];
  let from = 0;
  for (const line of input.lines || []) {
    const ws = String(line).split(/\s+/).filter(Boolean);
    const dur = Math.max(30, Math.round((ws.length / 2.6 + 0.3) * FPS));
    ws.forEach((w, i) => words.push({ w, f: from + Math.round((i / ws.length) * dur), e: from + Math.round(((i + 1) / ws.length) * dur) }));
    scenes.push({ from, dur });
    from += dur;
  }
  const TOTAL = from + 20;
  let frames = 0;
  for (const look of Object.keys(THEMES)) {
    const T = THEMES[look];
    const Film = compileFilm(input.code, { T, W, H, FPS, TOTAL, words, scenes });
    const step = Number(input.step) > 0 ? (look === "noir" ? Number(input.step) : Number(input.step) * 5) : look === "noir" ? 6 : 30;
    for (let f = 0; f < TOTAL; f += step) {
      let html;
      try {
        html = renderToStaticMarkup(React.createElement(ThemeContext.Provider, { value: T }, React.createElement("svg", null, React.createElement(Film, { f }))));
      } catch (e) {
        out({ ok: false, error: `Frame ${f} (${look} look) throws: ${String(e?.message || e).slice(0, 500)}` });
      }
      const bad = html.match(/="[^"]*(NaN|undefined|Infinity)[^"]*"/);
      if (bad) out({ ok: false, error: `Frame ${f} (${look} look) draws an invalid value: ${bad[0].slice(0, 200)}. Some number is NaN or undefined.` });
      if (html.length < 200) out({ ok: false, error: `Frame ${f} (${look} look) draws almost nothing.` });
      frames++;
    }
  }
  out({ ok: true, frames, seconds: Math.round(TOTAL / FPS) });
} catch (e) {
  out({ ok: false, error: String(e?.message || e).slice(0, 800) });
}
