// Turns a film written by Claude (JSX using the Story stick kit) into a React component.
// Used by the renderer (video/story/StoryFilm.jsx, in the browser) and by the check before rendering (render/story_check.mjs, in a
// locked-down Node process): the same code path, so a film that passes the check renders.
import React from "react";
import { transform } from "sucrase";
import * as K from "./kit.js";

const NAMES = Object.keys(K).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n));
const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();

/**
 * The timing helpers a film uses, from the narration's real word times.
 * words: [{w, f, e}] (absolute frames), scenes: [{from, dur}], total: frames.
 *   cue("three doors")      -> the frame where that phrase starts being said (the 1st time; cue(p, 2) = the 2nd time)
 *   cueEnd("three doors")   -> the frame where it ends
 *   at(i, k = 0)            -> the frame k (0..1) of the way through narration line i
 * A phrase that isn't heard (the voice said it differently) falls back to where it should be, never to NaN.
 */
export function timing(words, scenes, total) {
  const toks = words.map((w) => ({ ...w, n: norm(w.w).replace(/'/g, "") })).filter((w) => w.n);
  const find = (phrase, nth = 1) => {
    const want = norm(phrase).replace(/'/g, "").split(" ").filter(Boolean);
    if (!want.length) return null;
    let seen = 0;
    for (let i = 0; i < toks.length; i++) {
      let ok = true;
      for (let k = 0; k < want.length; k++) { const t = toks[i + k]; if (!t || !(t.n === want[k] || (want[k].length > 3 && t.n.startsWith(want[k].slice(0, -1))))) { ok = false; break; } }
      if (ok && ++seen >= nth) return [toks[i], toks[i + want.length - 1]];
    }
    // only the first word: still a better guess than nothing
    const first = toks.filter((t) => t.n === want[0]);
    if (first.length) { const t = first[Math.min(nth, first.length) - 1]; return [t, t]; }
    return null;
  };
  const all = norm(words.map((w) => w.w).join(" "));
  const guess = (phrase) => {
    const i = all.indexOf(norm(phrase).split(" ")[0] || "@@");
    return Math.round(i >= 0 ? (i / Math.max(all.length, 1)) * total : total / 2);
  };
  const safe = (v, d) => (Number.isFinite(v) ? Math.max(0, Math.round(v)) : d);
  const cue = (phrase, nth = 1) => { const m = find(phrase, nth); return safe(m ? m[0].f : guess(phrase), 0); };
  const cueEnd = (phrase, nth = 1) => { const m = find(phrase, nth); return safe(m ? m[1].e : guess(phrase) + 20, 0); };
  const at = (i, k = 0) => { const s = scenes[Math.max(0, Math.min(scenes.length - 1, Math.round(i) || 0))]; return s ? safe(s.from + s.dur * k, 0) : 0; };
  return { cue, cueEnd, at };
}

/** Strips what a model sometimes adds around the code: fences, imports, exports. */
export function cleanCode(code) {
  return String(code || "")
    .replace(/^\s*```[a-z]*\s*$/gim, "")
    .replace(/^\s*import\s[^\n]*$/gm, "")
    .replace(/^\s*export\s+default\s+/gm, "")
    .replace(/^\s*export\s+(?=(function|const|let|class)\b)/gm, "");
}

/** Returns the film component. Throws with a readable message when the code doesn't compile or define Film. */
export function compileFilm(code, env) {
  let js;
  try {
    js = transform(cleanCode(code), { transforms: ["jsx"], jsxPragma: "React.createElement", jsxFragmentPragma: "React.Fragment", production: true }).code;
  } catch (e) {
    throw new Error(`The film code doesn't compile: ${String(e.message || e).slice(0, 600)}`);
  }
  const { T, W, H, FPS, TOTAL, words = [], scenes = [] } = env;
  const { cue, cueEnd, at } = timing(words, scenes, TOTAL);
  // eslint-disable-next-line no-new-func
  const make = new Function("React", "K", "T", "W", "H", "FPS", "TOTAL", "cue", "cueEnd", "at", "SCENES",
    `"use strict";\nconst { ${NAMES.join(", ")} } = K;\n${js}\n;if (typeof Film !== "function") throw new Error("The film code must define: function Film({ f })");\nreturn Film;`);
  return make(React, K, T, W, H, FPS, TOTAL, cue, cueEnd, at, scenes);
}

/** Absolute word times from the renderer's scenes (each scene's caption groups hold its words, in seconds from the scene start). */
export function wordsOf(scenes, fps) {
  return scenes.flatMap((s) => (s.groups || []).flatMap((g) => g.words.map((w) => ({ w: w.w, f: s.from + Math.round(Number(w.s) * fps), e: s.from + Math.round(Number(w.e) * fps) }))));
}
