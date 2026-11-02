// Script -> scenes. Two formats, mixable in one script:
//   one line = one scene, optional "[term, term]" at the end
//   blocks:  TITLE: / VO: / FOOTAGE: / CARD: lines. A VO (or a TITLE after a VO) starts the next scene.
//     TITLE: YAMAL TO MADRID?
//     VO: What if Lamine Yamal signed for Real Madrid?
//     FOOTAGE: image: Lamine Yamal | video: football stadium night
//     CARD: Lamine Yamal | 19 goals | #A50044 #004D98
// A field the script doesn't mention is left undefined, so a rebuild keeps what was set in the editor.
export type Footage = "video" | "image" | "both";
export type Card = { name: string; stat: string; colors: string[] };
export type ParsedScene = { text: string; terms: string[]; title?: string | null; footage?: Footage; card?: Card | null };

const KEY = /^(TITLE|VO|VOICE|FOOTAGE|CARD)\s*:\s*(.*)$/i;
const KIND = /^(images?|photos?|pictures?|videos?|clips?)\s*:\s*(.+)$/i;
const HEX = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi;
const MAX_TERMS = 4;

/** "image: Lamine Yamal" -> {kind: "image", q: "Lamine Yamal"}; no prefix -> the scene's footage type. */
export function parseTerm(term: string, fallback: Footage): { kind: Footage; q: string } {
  const t = term.trim();
  const m = t.match(KIND);
  if (!m) return { kind: fallback, q: t };
  return { kind: /^(video|clip)/i.test(m[1]) ? "video" : "image", q: m[2].trim() };
}

/** A search from the editor: its Photos or Videos menu wins over a prefix in the term; "both" follows the prefixes. */
export function searchTerm(term: string, picked: Footage): { kind: Footage; q: string } {
  const parsed = parseTerm(term, picked);
  return picked === "both" ? parsed : { kind: picked, q: parsed.q };
}

function splitTerms(s: string): string[] {
  return s.split(/\s*[|;,]\s*/).map((t) => t.trim()).filter(Boolean).slice(0, MAX_TERMS);
}

/** Footage type implied by prefixed terms; undefined when no term says. */
function footageOf(terms: string[]): Footage | undefined {
  const kinds = new Set(terms.filter((t) => KIND.test(t)).map((t) => parseTerm(t, "both").kind));
  if (!kinds.size) return undefined;
  return kinds.size === 1 ? [...kinds][0] : "both";
}

export function parseCard(s: string): Card | null {
  const colors = (s.match(HEX) || []).slice(0, 2).map((c) => c.toUpperCase());
  const [name = "", stat = ""] = s.replace(HEX, " ").split("|").map((p) => p.replace(/[,\s]+$/, "").trim());
  if (!name) return null;
  return { name: name.slice(0, 40), stat: stat.slice(0, 30), colors };
}

/** "Voice text [term, term]" -> text + terms. */
function voiceLine(line: string): { text: string; terms: string[] } {
  const m = line.match(/^(.*?)\s*\[([^\]]*)\]\s*$/);
  return { text: (m ? m[1] : line).trim(), terms: m ? splitTerms(m[2]) : [] };
}

function push(out: ParsedScene[], scene: ParsedScene) {
  if (!scene.text) return;
  if (scene.text.split(/\s+/).length <= 60) { out.push(scene); return; }
  // long paragraph: one scene per sentence; title and card stay on the first one
  const parts = scene.text.match(/[^.!?…؟]+[.!?…؟]*/g)?.map((p) => p.trim()).filter(Boolean) ?? [scene.text];
  parts.forEach((p, i) => out.push(i === 0 ? { ...scene, text: p } : { text: p, terms: scene.terms, footage: scene.footage }));
}

export function parseScript(script: string): ParsedScene[] {
  const lines = script.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const out: ParsedScene[] = [];
  let cur: ParsedScene = { text: "", terms: [] };
  const next = () => { push(out, cur); cur = { text: "", terms: [] }; };
  const setTerms = (terms: string[]) => {
    if (!terms.length) return;
    cur.terms = terms;
    const f = footageOf(terms);
    if (f) cur.footage = f;
  };

  for (const line of lines) {
    const m = line.match(KEY);
    const key = m?.[1].toUpperCase();
    const val = m?.[2].trim() ?? "";
    if (!m) {
      if (cur.text) next();
      const v = voiceLine(line);
      cur.text = v.text;
      setTerms(v.terms);
    } else if (key === "TITLE") {
      if (cur.text) next();
      cur.title = val.slice(0, 80) || null;
    } else if (key === "VO" || key === "VOICE") {
      if (cur.text) next();
      const v = voiceLine(val);
      cur.text = v.text;
      setTerms(v.terms);
    } else if (key === "FOOTAGE") {
      setTerms(splitTerms(val));
    } else if (key === "CARD") {
      cur.card = parseCard(val);
    }
  }
  push(out, cur);
  return out.slice(0, 120);   // long videos: ~120 scenes ≈ 25 min
}
