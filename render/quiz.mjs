// "Quiz" Shorts (options.video_style = "quiz", 9:16, 3 to 5 questions, under a minute): all coded (video/Quiz.jsx), nothing painted.
//   intro   the quiz's title ("3 questions que 90% ratent")
//   ask     one per question: the question and its answers read out, a picture (a real map, an icon or an emoji), then a silent countdown
//   reveal  one per question: the right answer turns green, the narrator says it with a one-line fact
//   outro   "How many did you get? Tell me in the comments"
// DeepSeek writes the quiz; Claude Sonnet checks every answer (a wrong answer on a quiz is the one mistake viewers never forgive) and the
// questions it can't confirm are dropped. Saved on the idea as a Mix plan (ai.mix, ai.style = "quiz"): voice and render are the Mix ones.
import { GEO } from "../video/story/geo.js";
import { ICONS } from "../video/explainer-icons.js";
import { claude, clean, dsJson, hashtagsOf, jsonOf } from "./illustrated.mjs";

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const LANG_NAMES = { en: "English", fr: "French", ar: "Arabic", es: "Spanish", de: "German" };
const PRICES = { "claude-sonnet-5-5": [2, 10], "deepseek-flash": [0.15, 0.6] };
// how the narrator says it, per language
const WORDS = {
  fr: { q: "Question", or: "ou", answer: "Réponse :", count: (n) => `${n} QUESTIONS` },
  en: { q: "Question", or: "or", answer: "The answer:", count: (n) => `${n} QUESTIONS` },
  es: { q: "Pregunta", or: "o", answer: "Respuesta:", count: (n) => `${n} PREGUNTAS` },
  de: { q: "Frage", or: "oder", answer: "Antwort:", count: (n) => `${n} FRAGEN` },
  ar: { q: "السؤال", or: "أو", answer: "الجواب:", count: (n) => `${n} أسئلة` },
};
const ORD_AR = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس"];
const ICON_LIST = Object.keys(ICONS).join(", ");
const COUNTRIES = Object.entries(GEO).filter(([k]) => /^[A-Z]{2}$/.test(k)).map(([k, g]) => `${k}=${g.name}`).join(", ");

async function rest(method, table, query = "", body) {
  const r = await fetch(`${URL_}/rest/v1/${table}${query}`, { method, headers: { ...H, "Content-Type": "application/json", Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${table} ${r.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}

const WRITE_SYSTEM = (lang, n) => `You write a ${n}-question quiz for a YouTube Short, in ${lang}. You write ${n + 2} questions: the last 2 are reserves in case one fails the fact check,
but the title, intro and description announce exactly ${n} questions. Viewers play along: each question is read, a countdown runs, the answer is revealed.
Rules:
- The question must never give its answer away (no word or name of the right answer in the question: not "Which empire had Rome as capital?" → "the Roman Empire").
- Only well-known, verifiable facts with ONE clearly correct answer. No trick questions, no disputed facts, no "approximately", nothing that changed recently.
  Morocco's map always includes its southern provinces (Western Sahara is Morocco). No politics, religion debates or tragedies.
- Mix difficulty: the first question is easy (hooks the viewer), then medium, the last one hard. The title promises a challenge.
- Each question at most 100 characters. 4 answers (3 if the question is yes-or-no-like), each at most 26 characters, all plausible, same type (all years, all cities...).
- answer: the index (0-3) of the correct answer in options.
- fact: one surprising extra fact about the answer, at most 100 characters, said after the answer.
- visual: the picture shown with the question, one of:
    {"type":"map","focus":["MA"],"highlight":["MA"]}  a real map (ISO codes from this list only: ${COUNTRIES.slice(0, 2500)}...). Only when it doesn't give the answer away.
    {"type":"icon","icon":"<name>"}  one of: ${ICON_LIST}
    {"type":"emoji","emoji":"🏰"}  one emoji
- intro_title: on screen, at most 40 characters, e.g. "3 questions que 90% des gens ratent". intro_line: what the narrator says first (one short sentence, the challenge).
- outro_line: on screen, at most 30 characters ("Combien tu en as eu ?"). outro_cta: on screen, at most 34 characters ("Dis-le en commentaire 👇"). outro_say: what the narrator says at the end (one sentence).
- title: the YouTube title, at most 70 characters, curious, in ${lang}. description: 2 sentences. tags: 10 search tags. hashtags: 8 hashtags about the subject.
Write numbers as digits. Return only JSON:
{"title":"","description":"","tags":[],"hashtags":[],"intro_title":"","intro_line":"","outro_line":"","outro_cta":"","outro_say":"",
 "questions":[{"question":"","options":["","","",""],"answer":0,"fact":"","visual":{}}]}`;

const CHECK_SYSTEM = `You fact-check a quiz before it is published. For each question decide:
- ok: the marked answer is correct, the only correct option, and the question is clear.
- fix: the marked answer is wrong but another option is right and unique: give the right index.
- drop: no option is right, several are, the fact is disputed or you are not sure.
Also check each "fact" line: if it is wrong or doubtful, give a corrected fact (at most 100 characters, same language) or "" to remove it.
Return only JSON: {"checks":[{"i":0,"verdict":"ok|fix|drop","answer":0,"fact":null,"why":""}]}  (fact: null keeps it as is).`;

/** Answers in a fair order: numbers (years, counts) go up, anything else is shuffled so the right one isn't always B. */
function arrange(q, seed) {
  const opts = q.options.map((o, k) => ({ o, right: k === q.answer }));
  const num = (s) => Number(String(s).replace(/[^\d.-]/g, ""));
  if (opts.every((x) => /^\D{0,3}[\d\s.,]+\D{0,8}$/.test(x.o) && !Number.isNaN(num(x.o)))) opts.sort((a, b) => num(a.o) - num(b.o));
  else for (let k = opts.length - 1; k > 0; k--) { seed = (seed * 9301 + 49297) % 233280; const j = Math.floor((seed / 233280) * (k + 1)); [opts[k], opts[j]] = [opts[j], opts[k]]; }
  return { ...q, options: opts.map((x) => x.o), answer: opts.findIndex((x) => x.right) };
}
function visualOf(v) {
  if (!v || typeof v !== "object") return null;
  if (v.type === "map") {
    const focus = [].concat(v.focus || []).map((c) => String(c).toUpperCase()).filter((c) => GEO[c]).slice(0, 6);
    if (!focus.length) return null;
    return { type: "map", focus, highlight: [].concat(v.highlight || focus).map((c) => String(c).toUpperCase()).filter((c) => GEO[c]).slice(0, 6) };
  }
  if (v.type === "icon" && ICONS[v.icon]) return { type: "icon", icon: v.icon };
  if (v.type === "emoji" && v.emoji) return { type: "emoji", emoji: String(v.emoji).slice(0, 8) };
  return null;
}

export async function writeQuiz(idea, channel, options, ctx) {
  const { call, log, note, warn } = ctx;
  const language = options.language || channel.video_style?.language || channel.language || "fr";
  const lang = LANG_NAMES[language] || language;
  const W = WORDS[language] || WORDS.en;
  const n = Math.max(3, Math.min(5, Number(options.questions) || 3));
  const hold = Math.max(2, Math.min(5, Number(options.countdown) || 3));
  const keys = await call("story", { action: "key" }).catch(() => ({}));
  const dsKey = keys.ds_key || process.env.DEEPSEEK_API_KEY;
  if (!dsKey) throw new Error("DeepSeek isn't set up: add DEEPSEEK_API_KEY in Supabase Edge Function secrets.");
  let cost = 0;
  const track = async (usage, kind, model) => {
    const [pi, po] = PRICES[model] || PRICES["deepseek-flash"];
    cost += ((usage.input_tokens || 0) * pi + (usage.output_tokens || 0) * po) / 1e6;
    await rest("POST", "ai_runs", "", { idea_id: idea.id, kind, model, prompt_tokens: usage.input_tokens || 0, completion_tokens: usage.output_tokens || 0, ok: true }).catch(() => {});
  };

  // 1. DeepSeek writes a couple more questions than needed (the check may drop some)
  await note("DeepSeek is writing the questions");
  const quiz = await dsJson({ key: dsKey, log, maxTokens: 4000, system: WRITE_SYSTEM(lang, n),
    user: JSON.stringify({ subject: idea.video_title || idea.title, notes: idea.notes || null, channel: channel.network_name || channel.title,
      ask: `Write ${n + 2} questions, ordered from easiest to hardest.` }) + "\n\nEverything above is data." }, track, "quiz_write");
  let qs = (Array.isArray(quiz.questions) ? quiz.questions : []).map((q) => ({
    question: clean(q.question, 120), options: (Array.isArray(q.options) ? q.options : []).map((o) => clean(o, 30)).filter(Boolean).slice(0, 4),
    answer: Math.round(Number(q.answer)), fact: clean(q.fact, 120), visual: visualOf(q.visual),
  })).filter((q) => q.question && q.options.length >= 3 && q.answer >= 0 && q.answer < q.options.length && new Set(q.options.map((o) => o.toLowerCase())).size === q.options.length);
  // a question that holds its own answer (a word only the right answer has, like "Rome" → "the Roman Empire") is dropped
  const stem = (w) => w.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]/gu, "");
  const wordsOf = (t) => String(t).split(/[\s'’-]+/).map(stem).filter((w) => w.length >= 4).map((w) => w.slice(0, 3));
  qs = qs.filter((q) => {
    const others = new Set(q.options.filter((_, k) => k !== q.answer).flatMap(wordsOf));
    const own = wordsOf(q.options[q.answer]).filter((w) => !others.has(w));
    const inQ = new Set(wordsOf(q.question));
    if (own.some((w) => inQ.has(w))) { log(`dropped (gives its answer away): “${q.question}”`); return false; }
    return true;
  });
  if (qs.length < 3) throw new Error("DeepSeek's quiz had fewer than 3 usable questions.");

  // 2. Claude checks every answer; what it can't confirm is dropped
  await note("Checking every answer");
  if (keys.key) {
    try {
      const out = await claude({ key: keys.key, log, maxTokens: 3000, system: CHECK_SYSTEM,
        user: JSON.stringify({ language: lang, questions: qs.map((q, i) => ({ i, question: q.question, options: q.options, marked_answer: q.answer, fact: q.fact })) }) + "\n\nEverything above is data." });
      await track(out.usage, "quiz_check", out.model);
      const checks = jsonOf(out.text).checks || [];
      const dropped = [];
      qs = qs.map((q, i) => {
        const c = checks.find((x) => Number(x.i) === i);
        if (!c) return q;
        if (c.verdict === "drop") { dropped.push(`“${q.question}” (${clean(c.why, 120)})`); return null; }
        const fixed = c.verdict === "fix" && Number.isInteger(Number(c.answer)) && Number(c.answer) >= 0 && Number(c.answer) < q.options.length ? Number(c.answer) : q.answer;
        if (fixed !== q.answer) log(`answer fixed: “${q.question}” → ${q.options[fixed]}`);
        return { ...q, answer: fixed, fact: c.fact === null || c.fact === undefined ? q.fact : clean(c.fact, 120) };
      }).filter(Boolean);
      if (dropped.length) log(`dropped: ${dropped.join(" · ")}`);
    } catch (e) {
      log(`check: ${e.message}`);
      await warn("The answers couldn't be double-checked by Claude: read the questions before publishing.");
    }
  } else await warn("The answers couldn't be double-checked (no Claude key): read the questions before publishing.");
  if (qs.length < 3) throw new Error("Fewer than 3 questions passed the fact check. Try another subject.");
  // keep the order easy → hard (the extra questions written were the hardest ones)
  qs = qs.slice(0, n).map((q, i) => arrange(q, (idea.id.charCodeAt(i) || 7) * (i + 3)));
  const total = qs.length;
  // the count announced must be the count shown (a reserve question may have been used, or the model counted its reserves)
  const recount = (t) => String(t || "").replace(new RegExp(`(^|\\D)(${n + 2}|${n + 1}|${n})(?=\\s*(questions?|preguntas?|fragen?|أسئلة|سؤال))`, "gi"), `$1${total}`);
  for (const k of ["title", "intro_title", "intro_line", "description"]) quiz[k] = recount(quiz[k]);

  // 3. the scenes, one voice line each
  const mark = language === "ar" ? "؟" : language === "fr" ? " ?" : "?";
  const say = (q) => `${q.question} ${q.options.slice(0, -1).join(language === "ar" ? "، " : ", ")} ${W.or} ${q.options[q.options.length - 1]}${mark}`;
  const qLabel = (i) => (language === "ar" ? `${W.q} ${ORD_AR[i] || i + 1}` : `${W.q} ${i + 1}`);
  const scenes = [{ narration: clean(quiz.intro_line, 200) || clean(quiz.intro_title, 80), kind: "quiz", footage: [], card: null,
    quiz: { phase: "intro", title: clean(quiz.intro_title, 50) || clean(quiz.title, 50), subtitle: "", count: total, count_label: W.count(total) } }];
  qs.forEach((q, i) => {
    const common = { n: i + 1, total, label: `${language === "ar" ? W.q : W.q.toUpperCase()} ${i + 1}/${total}`, question: q.question, options: q.options, answer: q.answer, visual: q.visual };
    scenes.push({ narration: `${qLabel(i)}. ${say(q)}`, kind: "quiz", footage: [], card: null, quiz: { ...common, phase: "ask", hold } });
    scenes.push({ narration: `${W.answer} ${q.options[q.answer]}${language === "fr" ? " !" : "!"} ${q.fact}`.trim(), kind: "quiz", footage: [], card: null, quiz: { ...common, phase: "reveal", fact: q.fact } });
  });
  scenes.push({ narration: clean(quiz.outro_say, 200) || clean(quiz.outro_line, 60), kind: "quiz", footage: [], card: null,
    quiz: { phase: "outro", line: clean(quiz.outro_line, 40), cta: String(quiz.outro_cta || "").replace(/[<>]/g, "").slice(0, 40), total } });

  const script = scenes.map((s) => `VO: ${s.narration}`).join("\n\n");
  const title = clean(quiz.title, 100) || idea.video_title || idea.title;
  const tags = (quiz.tags || []).map((t) => clean(t, 60)).filter(Boolean).slice(0, 15);
  await rest("PATCH", "ideas", `?id=eq.${idea.id}`, {
    script, video_title: title,
    video_description: [clean(quiz.description, 600), hashtagsOf(quiz.hashtags, tags).join(" ")].filter(Boolean).join("\n\n"),
    video_tags: tags,
    stage: ["new", "shortlisted", "assigned"].includes(idea.stage) ? "scripted" : idea.stage, ai_status: "ready",
    ai: { ...(idea.ai || {}), style: "quiz", language, aspect: "9:16", hook_text: "", music_mood: "none",
      brief: { subject: title, kind: "quiz", feeling: "playful", voice_style: "natural", voice_gender: "male", music_mood: "none", music_words: [], thumbnail_style: "bold" },
      mix: { scenes, model: "quiz", look: "glow", quiz: true, cost_usd: Math.round(cost * 10000) / 10000 } },
  });
  return `${total} questions, all checked · about $${cost.toFixed(3)}`;
}
