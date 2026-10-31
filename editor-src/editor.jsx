// Video editor: scene list + live preview (Remotion Player) + style + music + final render.
// Bundled with esbuild into web/editor.bundle.js; mounted by app.js on #/edit/<project_id>.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Player } from "@remotion/player";
import { Main } from "../video/Main.jsx";
import { DEFAULT_SETTINGS, buildProps, creditsText, mergeSettings, preRenderCheck, sceneSeconds, withCredits } from "../video/layout.js";

export const MOODS = [
  ["epic", "Epic / cinematic"], ["suspense", "Suspense / dark"], ["phonk", "Phonk"], ["trap", "Trap / hip-hop"], ["upbeat", "Upbeat / energetic"],
  ["emotional", "Emotional / piano"], ["lofi", "Lo-fi / chill"], ["oriental", "Oriental / Arabic"], ["latin", "Latin / Spanish guitar"], ["other", "Other"],
];
const moodName = (m) => (MOODS.find(([k]) => k === m) || [m, m])[1];
const fmtS = (s) => `${Math.round(s * 10) / 10} s`;

async function invoke(sb, body) {
  const { data, error } = await sb.functions.invoke("studio", { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* keep */ }
    throw new Error(msg);
  }
  return data;
}

// ------------------------------------------------------------------
function useSigned(sb) {
  const cache = useRef(new Map());
  const [, bump] = useState(0);
  const sign = useCallback(async (paths) => {
    const missing = [...new Set(paths.filter((p) => p && !cache.current.has(p)))];
    if (!missing.length) return;
    const { data } = await sb.storage.from("renders").createSignedUrls(missing, 6 * 3600);
    for (const item of data || []) if (item.signedUrl) cache.current.set(item.path, item.signedUrl);
    bump((n) => n + 1);
  }, [sb]);
  return [cache.current, sign];
}

function Field({ label, children, hint }) {
  return (
    <label className="field-wrap">
      <span className="ed-label">{label}</span>
      {children}
      {hint ? <span className="muted small">{hint}</span> : null}
    </label>
  );
}

// ------------------------------------------------------------------
const FOOTAGE = [["video", "Videos"], ["image", "Photos"], ["both", "Videos + photos"]];
const hex6 = (c, fallback) => {
  const h = String(c || "").replace("#", "");
  if (/^[0-9a-f]{6}$/i.test(h)) return `#${h}`;
  return /^[0-9a-f]{3}$/i.test(h) ? `#${h.split("").map((x) => x + x).join("")}` : fallback;
};

// Animated name / stat card shown over the scene, e.g. "Lamine Yamal · 19 goals" in club colours.
function CardEditor({ card, index, onChange }) {
  const [name, setName] = useState(card?.name || "");
  const [stat, setStat] = useState(card?.stat || "");
  useEffect(() => { setName(card?.name || ""); setStat(card?.stat || ""); }, [card?.name, card?.stat]);
  const c1 = hex6(card?.colors?.[0], "#FFE600");
  const c2 = hex6(card?.colors?.[1], "#111111");
  const save = (patch = {}) => {
    const next = { name: name.trim().slice(0, 40), stat: stat.trim().slice(0, 30), colors: card?.colors || [], ...patch };
    if (next.name && JSON.stringify(next) !== JSON.stringify(card)) onChange(next);
  };
  return (
    <details className="ed-more" open={!!card}>
      <summary>Name / stat card{card ? `: ${card.name}` : ""}</summary>
      <div className="form-grid">
        <Field label="Name"><input className="field" dir="auto" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onBlur={() => save()} placeholder="Lamine Yamal" aria-label={`Scene ${index + 1} card name`} /></Field>
        <Field label="Stat (optional)" hint="Starts with a number? It counts up."><input className="field" dir="auto" value={stat} maxLength={30} onChange={(e) => setStat(e.target.value)} onBlur={() => save()} placeholder="19 goals · €180M" aria-label={`Scene ${index + 1} card stat`} /></Field>
        <Field label="Colour 1"><input type="color" className="color" value={c1} onChange={(e) => save({ colors: [e.target.value.toUpperCase(), c2.toUpperCase()] })} aria-label={`Scene ${index + 1} card colour 1`} /></Field>
        <Field label="Colour 2"><input type="color" className="color" value={c2} onChange={(e) => save({ colors: [c1.toUpperCase(), e.target.value.toUpperCase()] })} aria-label={`Scene ${index + 1} card colour 2`} /></Field>
      </div>
      {card ? <button type="button" className="btn small ghost" onClick={() => { setName(""); setStat(""); onChange(null); }}>Remove card</button> : <span className="muted small">Type a name to add the card. Use team colours, never logos.</span>}
    </details>
  );
}

function SceneCard({ scene, index, count, project, active, signed, onChange, onPick, onSearch, onUpload, onMove, onDelete, onAdd, onSeek, searching }) {
  const [text, setText] = useState(scene.text);
  const [terms, setTerms] = useState((scene.terms || []).join(", "));
  const [title, setTitle] = useState(scene.title || "");
  const [results, setResults] = useState(null);
  useEffect(() => { setText(scene.text); }, [scene.text]);
  useEffect(() => { setTerms((scene.terms || []).join(", ")); }, [scene.terms]);
  useEffect(() => { setTitle(scene.title || ""); }, [scene.title]);
  const clip = scene.clip || { type: "card" };
  const footage = scene.footage || "video";
  const voiceState = !scene.voice_path ? ["warn", "No voice"] : scene.voice_text !== scene.text ? ["warn", "Voice outdated"] : ["ok", fmtS(scene.voice_duration)];
  const thumb = clip.type === "card" ? null : clip.path ? (clip.type === "image" ? signed.get(clip.path) : null) : clip.thumb || clip.preview;
  const list = results ?? scene.candidates ?? [];
  const fileRef = useRef(null);

  const commitText = () => { if (text.trim() && text.trim() !== scene.text) onChange({ text: text.trim() }); };
  const commitTitle = () => { const t = title.trim().slice(0, 80) || null; if (t !== (scene.title || null)) onChange({ title: t }); };
  const commitTerms = () => {
    const t = terms.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 4);
    if (JSON.stringify(t) !== JSON.stringify(scene.terms || [])) onChange({ terms: t });
    return t;
  };
  const search = async (kind = footage) => {
    const t = commitTerms();
    const q = t[0] || text;
    setResults(await onSearch(q, t.slice(1), kind));
  };
  const credit = (c) => (c.author && c.source !== "pixabay" ? `${c.tags} · ${c.author} · ${c.license}` : c.tags);
  const badge = { wikimedia: "Wiki", youtube: "YT CC" };

  return (
    <article className={`ed-scene${active ? " active" : ""}`} aria-label={`Scene ${index + 1}`}>
      <div className="ed-scene-head">
        <button type="button" className="ed-thumb" onClick={onSeek} aria-label={`Play from scene ${index + 1}`}>
          {thumb ? <img src={thumb} alt="" /> : <span>{clip.type === "card" ? "Text card" : clip.type === "video" ? "Your clip" : ""}</span>}
          <b>{index + 1}</b>
        </button>
        <div className="ed-scene-meta">
          <span className={`pill ${voiceState[0]}`}>{voiceState[1]}</span>
          <span className="muted small">{clip.type === "card" ? "No clip" : clip.source === "youtube" ? "YouTube CC · file needed" : `${clip.type === "video" ? "Video" : "Image"} · ${clip.source === "upload" ? "uploaded" : clip.source || ""}${clip.license || clip.credit?.license ? ` · ${clip.license || clip.credit.license}` : ""}`}</span>
        </div>
        <div className="ed-scene-tools">
          <button type="button" className="btn small ghost" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">↑</button>
          <button type="button" className="btn small ghost" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move down">↓</button>
          <button type="button" className="btn small ghost" onClick={onAdd} aria-label="Add a scene below">＋</button>
          <button type="button" className="btn small ghost" disabled={count <= 1} onClick={onDelete} aria-label="Delete scene">✕</button>
        </div>
      </div>
      <textarea className="field ed-text" rows={2} value={text} dir="auto" onChange={(e) => setText(e.target.value)} onBlur={commitText} aria-label={`Scene ${index + 1} voice-over text`} />
      <input className="field" dir="auto" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} onBlur={commitTitle}
        placeholder="On-screen title (optional), e.g. YAMAL TO MADRID?" aria-label={`Scene ${index + 1} on-screen title`} />
      <div className="ed-search">
        <select className="field ed-kind" value={footage} onChange={(e) => { onChange({ footage: e.target.value }); search(e.target.value); }} aria-label={`Scene ${index + 1} footage type`}>
          {FOOTAGE.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
        <input className="field" value={terms} onChange={(e) => setTerms(e.target.value)} onBlur={commitTerms}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }}
          placeholder={footage === "video" ? "Footage search, e.g. stadium crowd night" : "e.g. Lamine Yamal, Santiago Bernabéu"} aria-label={`Scene ${index + 1} footage search`} />
        <button type="button" className="btn small" onClick={() => search()} disabled={searching}>{searching ? "Searching…" : "Find clips"}</button>
        <button type="button" className="btn small ghost" onClick={() => search("youtube")} disabled={searching} title="Creative Commons videos on YouTube (reuse allowed with credit)">YouTube CC</button>
      </div>
      <span className="muted small">
        {footage === "image" ? "Photos" : footage === "video" ? "Videos" : "Videos and photos"} from Wikimedia Commons (real footage of players, clubs, places; credit needed) and Pixabay.
      </span>
      {clip.source === "youtube" ? (
        <p className="muted small" style={{ margin: 0 }}>
          YouTube doesn’t let apps download other channels’ videos, so this scene shows a text card for now. If you have the file
          (from the creator or their site), upload it below and the credit stays. <a href={clip.page} target="_blank" rel="noopener">Watch on YouTube</a>
        </p>
      ) : null}
      {list.length ? (
        <div className="ed-cands" role="list">
          {list.map((c) => (
            <button type="button" role="listitem" key={`${c.source}-${c.id}`} className={`ed-cand${clip.id === c.id && clip.source === c.source ? " on" : ""}`}
              onClick={() => onPick({ ...c, trim: 0 })} title={credit(c)}>
              <img src={c.thumb || c.preview} alt={c.tags || "clip"} loading="lazy" />
              {badge[c.source] ? <b className="src">{badge[c.source]}</b> : null}
              {c.duration ? <i>{Math.round(c.duration)}s</i> : c.source === "wikimedia" ? <i>{c.license}</i> : null}
            </button>
          ))}
        </div>
      ) : <div className="muted small">No clips found yet. Try another search (English works best).</div>}
      <CardEditor card={scene.card} index={index} onChange={(card) => onChange({ card })} />
      <div className="row">
        <button type="button" className="btn small ghost" onClick={() => fileRef.current?.click()}>Upload image / clip</button>
        <input ref={fileRef} type="file" accept="image/*,video/mp4,video/quicktime,video/webm" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onUpload(f); }} />
        {clip.type !== "card" ? <button type="button" className="btn small ghost" onClick={() => onPick({ type: "card" })}>Use text card</button> : null}
        {clip.type === "video" ? (
          <label className="row small muted" style={{ gap: 6 }}>Start at
            <input className="field ed-trim" type="number" min="0" step="0.5" value={clip.trim || 0}
              onChange={(e) => onPick({ ...clip, trim: Math.max(0, Number(e.target.value) || 0) })} /> s
          </label>
        ) : null}
      </div>
    </article>
  );
}

// ------------------------------------------------------------------
function StylePanel({ project, ctx, onProject, onSettings }) {
  const s = mergeSettings(project.settings);
  const voices = ctx.VOICES[project.language] || ctx.VOICES.en;
  const set = (group, patch) => onSettings({ ...project.settings, [group]: { ...s[group], ...patch } });
  return (
    <div className="ed-panel">
      <h3>Voice</h3>
      <div className="form-grid">
        <Field label="Language">
          <select className="field" value={project.language} onChange={(e) => {
            const lang = e.target.value; const v = (ctx.VOICES[lang] || ctx.VOICES.en)[0][0];
            onProject({ language: lang, voice: v }, true);
          }}>{ctx.LANGS.filter(([v]) => ctx.VOICES[v]).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
        </Field>
        <Field label="Voice">
          <select className="field" value={project.voice} onChange={(e) => onProject({ voice: e.target.value }, true)}>
            {voices.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </Field>
        <Field label="Speed">
          <select className="field" value={String(project.voice_rate)} onChange={(e) => onProject({ voice_rate: Number(e.target.value) }, true)}>
            {[[0.9, "Slower"], [1, "Normal"], [1.1, "Shorts pace"], [1.2, "Fast"]].map(([v, t]) => <option key={v} value={String(v)}>{t}</option>)}
          </select>
        </Field>
        <Field label="Format">
          <select className="field" value={project.aspect} onChange={(e) => onProject({ aspect: e.target.value })}>
            <option value="9:16">Short / Reel (9:16)</option><option value="16:9">Long video (16:9)</option><option value="1:1">Square (1:1)</option>
          </select>
        </Field>
      </div>

      <h3>Captions</h3>
      <label className="row ed-check"><input type="checkbox" checked={s.captions.enabled} onChange={(e) => set("captions", { enabled: e.target.checked })} /> Show captions</label>
      <div className="form-grid">
        <Field label="Position">
          <select className="field" value={s.captions.position} onChange={(e) => set("captions", { position: e.target.value })}>
            <option value="top">Top</option><option value="center">Center</option><option value="bottom">Bottom</option>
          </select>
        </Field>
        <Field label="Size">
          <select className="field" value={String(s.captions.size)} onChange={(e) => set("captions", { size: Number(e.target.value) })}>
            {[[64, "Small"], [84, "Medium"], [104, "Large"], [124, "Huge"]].map(([v, t]) => <option key={v} value={String(v)}>{t}</option>)}
          </select>
        </Field>
        <Field label="Words at a time">
          <select className="field" value={String(s.captions.words)} onChange={(e) => set("captions", { words: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5].map((v) => <option key={v} value={String(v)}>{v}</option>)}
          </select>
        </Field>
        <Field label="Text color"><input type="color" className="color" value={s.captions.color} onChange={(e) => set("captions", { color: e.target.value })} /></Field>
        <Field label="Current word"><input type="color" className="color" value={s.captions.highlight} onChange={(e) => set("captions", { highlight: e.target.value })} /></Field>
      </div>
      <label className="row ed-check"><input type="checkbox" checked={s.captions.uppercase} onChange={(e) => set("captions", { uppercase: e.target.checked })} /> UPPERCASE (Latin scripts)</label>

      <h3>Hook &amp; extras</h3>
      <label className="row ed-check"><input type="checkbox" checked={s.hook.enabled} onChange={(e) => set("hook", { enabled: e.target.checked })} /> Hook text on screen for the first 2 seconds</label>
      <Field label="Hook text" hint="Empty = the video title">
        <input className="field" dir="auto" value={s.hook.text} onChange={(e) => set("hook", { text: e.target.value })} placeholder={project.title} />
      </Field>
      <label className="row ed-check"><input type="checkbox" checked={s.titles.enabled} onChange={(e) => set("titles", { enabled: e.target.checked })} /> Scene titles (big text set per scene, in the current-word colour)</label>
      <label className="row ed-check"><input type="checkbox" checked={s.progress.enabled} onChange={(e) => set("progress", { enabled: e.target.checked })} /> Progress bar</label>
      <label className="row ed-check"><input type="checkbox" checked={s.sfx.enabled} onChange={(e) => set("sfx", { enabled: e.target.checked })} /> Sound effects (whoosh on cuts, hit on the hook)</label>
    </div>
  );
}

function MusicPanel({ project, tracks, signed, sign, onSettings }) {
  const s = mergeSettings(project.settings);
  const moods = [...new Set(tracks.map((t) => t.mood))];
  const inMood = tracks.filter((t) => t.mood === s.music.mood);
  const current = tracks.find((t) => t.id === s.music.track_id);
  const set = (patch) => onSettings({ ...project.settings, music: { ...s.music, ...patch } });
  const pick = (mood) => {
    const pool = tracks.filter((t) => t.mood === mood);
    const t = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    set({ mood, track_id: t?.id || null });
  };
  useEffect(() => { if (current) sign([current.path]); }, [current, sign]);
  return (
    <div className="ed-panel">
      <h3>Background music</h3>
      {!tracks.length ? (
        <p className="muted small">No music yet. Add tracks by mood in <a href="#/settings">Settings → Music library</a> (YouTube Audio Library tracks are the safest for copyright).</p>
      ) : null}
      <Field label="Mood">
        <select className="field" value={s.music.mood} onChange={(e) => (e.target.value === "none" ? set({ mood: "none", track_id: null }) : pick(e.target.value))}>
          <option value="none">No music</option>
          {moods.map((m) => <option key={m} value={m}>{moodName(m)} ({tracks.filter((t) => t.mood === m).length})</option>)}
        </select>
      </Field>
      {s.music.mood !== "none" && inMood.length ? (
        <>
          <Field label="Track">
            <select className="field" value={s.music.track_id || ""} onChange={(e) => set({ track_id: e.target.value || null })}>
              {inMood.map((t) => <option key={t.id} value={t.id}>{t.title}{t.duration ? ` · ${Math.round(t.duration)} s` : ""}</option>)}
            </select>
          </Field>
          <div className="row">
            <button type="button" className="btn small" onClick={() => pick(s.music.mood)}>Shuffle track</button>
            {current && signed.get(current.path) ? <audio controls preload="none" src={signed.get(current.path)} style={{ maxWidth: "100%" }} /> : null}
          </div>
          <Field label={`Volume · ${Math.round(s.music.volume * 100)}%`} hint="Music is lowered automatically while the voice speaks.">
            <input type="range" min="0.05" max="0.6" step="0.01" value={s.music.volume} onChange={(e) => set({ volume: Number(e.target.value) })} />
          </Field>
          <Field label="Start the track at (seconds)" hint="Skip a slow intro, start at the drop.">
            <input className="field ed-trim" type="number" min="0" step="1" value={s.music.start} onChange={(e) => set({ start: Math.max(0, Number(e.target.value) || 0) })} />
          </Field>
        </>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------
async function saveCredits(sb, ideaId, credits) {
  const { data, error } = await sb.from("ideas").select("video_description").eq("id", ideaId).maybeSingle();
  if (error || !data) return error?.message || "idea not found";
  const next = withCredits(data.video_description || "", credits);
  if (next === (data.video_description || "")) return null;
  return (await sb.from("ideas").update({ video_description: next }).eq("id", ideaId)).error?.message || null;
}

function Credits({ sb, project, scenes, toast }) {
  const text = creditsText(scenes);
  if (!text) return null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast("Credits copied"); } catch { toast("Copy failed: select the text and copy it"); }
  };
  const add = async () => { const err = await saveCredits(sb, project.idea_id, text); toast(err ? `Not saved: ${err}` : "Credits are in the description"); };
  return (
    <section className="card">
      <h2>Footage credits</h2>
      <p className="muted small" style={{ margin: 0 }}>
        The licences of these photos and videos ask for a credit line in the video description.
        {project.idea_id ? " They're added to the description automatically when you render." : " Paste them into the description when you upload."}
      </p>
      <pre className="note">{text}</pre>
      <div className="row">
        <button type="button" className="btn small" onClick={copy}>Copy credits</button>
        {project.idea_id ? <button type="button" className="btn small ghost" onClick={add}>Add to description now</button> : null}
      </div>
    </section>
  );
}

function Renders({ sb, jobs, onRetry }) {
  const [urls, setUrls] = useState({});
  if (!jobs.length) return null;
  const cls = { done: "ok", failed: "crit", running: "info", dispatched: "info", queued: "warn" };
  const label = { done: "Ready", failed: "Failed", running: "Rendering…", dispatched: "Starting…", queued: "Queued" };
  const signed = async (j, download) => {
    const { data } = await sb.storage.from("renders").createSignedUrl(j.output_path, 3600, download ? { download: `${(j.params?.title || "video").replace(/[^\w-]+/g, "_").slice(0, 60)}.mp4` } : undefined);
    return data?.signedUrl;
  };
  return (
    <section className="card">
      <h2>Final renders</h2>
      {jobs.map((j) => (
        <div key={j.id} className="listrow" style={{ alignItems: "flex-start" }}>
          <span className={`pill ${cls[j.status]}`}>{label[j.status]}</span>
          <div style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="muted small">{new Date(j.created_at).toLocaleString()}{j.duration_s ? ` · ${Math.round(j.duration_s)} s` : ""}</div>
            {j.error ? <pre className={j.status === "done" ? "note" : "err"}>{j.error}</pre> : null}
            {urls[j.id] ? <video className="player" src={urls[j.id]} controls playsInline /> : null}
          </div>
          <div className="row">
            {j.status === "done" && !j.output_path && j.run_url ? <a className="btn small primary" href={j.run_url} target="_blank" rel="noopener">Download from GitHub</a> : null}
            {j.status === "done" && j.output_path && !urls[j.id] ? <button type="button" className="btn small" onClick={async () => { const u = await signed(j); if (u) setUrls((x) => ({ ...x, [j.id]: u })); }}>Watch</button> : null}
            {j.status === "done" && j.output_path ? <button type="button" className="btn small primary" onClick={async () => { const u = await signed(j, true); if (u) location.href = u; }}>Download</button> : null}
            {j.status === "failed" ? <button type="button" className="btn small" onClick={() => onRetry(j)}>Retry</button> : null}
            {j.run_url ? <a className="btn small ghost" href={j.run_url} target="_blank" rel="noopener">Log</a> : null}
          </div>
        </div>
      ))}
    </section>
  );
}

// ------------------------------------------------------------------
function Editor({ ctx }) {
  const { sb, projectId, toast } = ctx;
  const [project, setProject] = useState(null);
  const [scenes, setScenes] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [tab, setTab] = useState("scenes");
  const [busy, setBusy] = useState("");
  const [searching, setSearching] = useState(null);
  const [check, setCheck] = useState(null);
  const [frame, setFrame] = useState(0);
  const [missing, setMissing] = useState(false);
  const player = useRef(null);
  const [signed, sign] = useSigned(sb);
  const saveTimer = useRef(null);

  const load = useCallback(async () => {
    const [p, sc, tr, jb] = await Promise.all([
      sb.from("video_projects").select("*").eq("id", projectId).maybeSingle(),
      sb.from("project_scenes").select("*").eq("project_id", projectId).order("idx"),
      sb.from("music_tracks").select("*").order("created_at", { ascending: false }),
      sb.from("render_jobs").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).limit(8),
    ]);
    if (!p.data) { setMissing(true); return; }
    setProject(p.data); setScenes(sc.data || []); setTracks(tr.data || []); setJobs(jb.data || []);
    const paths = [...(sc.data || []).map((s) => s.voice_path), ...(sc.data || []).map((s) => s.clip?.path)];
    const track = (tr.data || []).find((t) => t.id === p.data.settings?.music?.track_id);
    if (track) paths.push(track.path);
    await sign(paths.filter(Boolean));
  }, [sb, projectId, sign]);

  useEffect(() => { load(); }, [load]);

  // poll while the voice or a render is running
  const preparing = project?.status === "preparing";
  const rendering = jobs.some((j) => ["queued", "dispatched", "running"].includes(j.status));
  useEffect(() => {
    if (!preparing && !rendering) return undefined;
    const t = setInterval(load, preparing ? 5000 : 10000);
    return () => clearInterval(t);
  }, [preparing, rendering, load]);

  const props = useMemo(() => {
    if (!project) return null;
    const base = new URL("./", location.href).href;
    const voice = Object.fromEntries(scenes.map((s) => [s.id, s.voice_path ? signed.get(s.voice_path) : null]));
    const media = Object.fromEntries(scenes.filter((s) => s.clip?.path).map((s) => [s.clip.path, signed.get(s.clip.path)]));
    const track = tracks.find((t) => t.id === project.settings?.music?.track_id);
    return buildProps(project, scenes, {
      voice, media, music: track && project.settings?.music?.mood !== "none" ? signed.get(track.path) || null : null,
      sfx: { whoosh: base + "sfx/whoosh.mp3", hit: base + "sfx/hit.mp3" }, assetBase: base,
    });
  }, [project, scenes, tracks, signed]);

  useEffect(() => {
    const p = player.current;
    if (!p) return undefined;
    const onFrame = (e) => setFrame(e.detail.frame);
    p.addEventListener("frameupdate", onFrame);
    return () => p.removeEventListener("frameupdate", onFrame);
  }, [props?.totalFrames]);

  if (missing) return <div className="empty">Project not found. <a href="#/studio">Back to Studio</a></div>;
  if (!project || !props) return <div className="loading">Loading editor…</div>;

  // ---------- mutations ----------
  const patchScene = async (id, patch) => {
    setScenes((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    const { error } = await sb.from("project_scenes").update(patch).eq("id", id);
    if (error) toast(`Not saved: ${error.message}`);
  };
  const reindex = async (list) => {
    const rows = list.map((s, i) => ({ ...s, idx: i }));
    setScenes(rows);
    const { error } = await sb.from("project_scenes").upsert(rows.map(({ id, project_id, idx, text }) => ({ id, project_id, idx, text })));
    if (error) toast(`Not saved: ${error.message}`);
  };
  const saveProject = (patch, voiceChanged) => {
    const next = { ...project, ...patch };
    setProject(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const { error } = await sb.from("video_projects").update(patch).eq("id", project.id);
      if (error) toast(`Not saved: ${error.message}`);
    }, 400);
    if (voiceChanged) {
      // a different voice or speed means every line has to be spoken again
      setScenes((list) => list.map((s) => ({ ...s, voice_text: null })));
      sb.from("project_scenes").update({ voice_text: null }).eq("project_id", project.id).then(() => {});
    }
  };
  const searchFor = async (sceneId, q, more, kind) => {
    setSearching(sceneId);
    try {
      let { results, configured } = await invoke(sb, { action: "search", q, kind, aspect: project.aspect });
      // one YouTube search costs 101 of the 10,000 daily quota units: only the first term
      if (kind !== "youtube") for (const m of more) { if (results.length >= 8) break; results = results.concat((await invoke(sb, { action: "search", q: m, kind, aspect: project.aspect })).results); }
      if (!configured && !results.length) toast(kind === "youtube" ? "YouTube search isn't set up: add YOUTUBE_API_KEY in Supabase Edge Function secrets." : "Stock search isn't set up: add PIXABAY_API_KEY in Supabase Edge Function secrets.");
      const uniq = [...new Map(results.map((r) => [`${r.source}-${r.id}`, r])).values()].slice(0, 12);
      if (uniq.length) await patchScene(sceneId, { candidates: uniq });
      else toast("No clips for that search. Try simpler English words.");
      return uniq;
    } catch (e) { toast(e.message); return null; } finally { setSearching(null); }
  };
  const upload = async (scene, file) => {
    if (file.size > 50 * 1024 * 1024) return toast("Files must be under 50 MB");
    const kind = file.type.startsWith("video") ? "video" : "image";
    const path = `projects/${project.id}/media/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
    setBusy("Uploading…");
    const { error } = await sb.storage.from("renders").upload(path, file, { contentType: file.type });
    setBusy("");
    if (error) return toast(`Upload failed: ${error.message}`);
    let duration = null;
    let size = [null, null];   // image size decides between full-frame and blurred-backdrop framing
    if (kind === "video") {
      duration = await new Promise((res) => { const v = document.createElement("video"); v.preload = "metadata"; v.onloadedmetadata = () => res(v.duration || null); v.onerror = () => res(null); v.src = URL.createObjectURL(file); });
    } else {
      size = await new Promise((res) => { const im = new Image(); im.onload = () => res([im.naturalWidth, im.naturalHeight]); im.onerror = () => res([null, null]); im.src = URL.createObjectURL(file); });
    }
    await sign([path]);
    // the file for a YouTube Creative Commons pick: keep who to credit
    const prev = scene.clip || {};
    const credit = prev.source === "youtube" ? { tags: prev.tags, author: prev.author, license: prev.license, page: prev.page, via: "YouTube" } : null;
    await patchScene(scene.id, { clip: { type: kind, source: "upload", id: path, path, duration, width: size[0], height: size[1], trim: 0, credit } });
  };
  const addAfter = async (i) => {
    const { data, error } = await sb.from("project_scenes").insert({ project_id: project.id, idx: i + 1, text: "New line…", terms: [], clip: { type: "card" } }).select().single();
    if (error) return toast(error.message);
    const list = [...scenes]; list.splice(i + 1, 0, data); await reindex(list);
  };
  const remove = async (i) => {
    const s = scenes[i];
    await sb.from("project_scenes").delete().eq("id", s.id);
    await reindex(scenes.filter((x) => x.id !== s.id));
  };
  const move = async (i, d) => {
    const list = [...scenes]; const [s] = list.splice(i, 1); list.splice(i + d, 0, s); await reindex(list);
  };
  const updateVoice = async () => {
    const ids = scenes.filter((s) => !s.voice_path || s.voice_text !== s.text).map((s) => s.id);
    setBusy("Starting voice…");
    try {
      await invoke(sb, { action: "voice", project_id: project.id, scene_ids: ids.length === scenes.length ? [] : ids });
      setProject((p) => ({ ...p, status: "preparing" })); toast("Voice is being generated: about 1–2 minutes");
    } catch (e) { toast(e.message); } finally { setBusy(""); }
  };
  const startRender = async () => {
    setBusy("Starting render…");
    try {
      await invoke(sb, { action: "render", project_id: project.id });
      const credits = creditsText(scenes);
      const err = credits && project.idea_id ? await saveCredits(sb, project.idea_id, credits) : null;
      toast(err ? `Render started, but the photo credits weren't saved to the description: ${err}` : "Final render started: usually 3–6 minutes");
      setCheck(null); await load();
    } catch (e) { toast(e.message); } finally { setBusy(""); }
  };
  const retry = async (j) => {
    const { error } = await sb.functions.invoke("render", { body: { retry: j.id } });
    toast(error ? "Retry failed" : "Render restarted"); load();
  };

  const stale = scenes.filter((s) => !s.voice_path || s.voice_text !== s.text).length;
  const total = props.totalFrames / props.fps;
  const currentScene = props.scenes.findIndex((s) => frame >= s.from && frame < s.from + s.dur);
  const issues = preRenderCheck(project, scenes);
  const blocked = issues.some((i) => i.level === "block");
  const back = project.idea_id ? `#/studio/${project.idea_id}` : "#/studio";

  return (
    <div className="ed">
      <header className="head ed-head">
        <div className="head-text">
          <a href={back} className="small">← Script &amp; settings</a>
          <input className="ed-title" dir="auto" value={project.title} onChange={(e) => saveProject({ title: e.target.value })} aria-label="Video title" />
          <div className="row small muted" style={{ gap: 8 }}>
            <span>{scenes.length} scenes · {fmtS(total)}</span>
            {preparing ? <span className="pill info">Generating voice…</span> : null}
            {project.status === "failed" ? <span className="pill crit">Voice failed</span> : null}
            {project.run_url && (preparing || project.status === "failed") ? <a href={project.run_url} target="_blank" rel="noopener">log</a> : null}
            {busy ? <span className="pill info">{busy}</span> : null}
          </div>
        </div>
        <div className="row">
          {stale && !preparing ? <button type="button" className="btn" onClick={updateVoice} disabled={!!busy}>Update voice ({stale})</button> : null}
          <button type="button" className="btn primary" onClick={() => setCheck(issues)} disabled={!!busy || preparing}>Render final video</button>
        </div>
      </header>

      {project.status === "failed" && project.error ? <pre className="err">{project.error}</pre> : null}

      {check ? (
        <section className="card ed-check-card" role="dialog" aria-label="Before rendering">
          <h2>Before rendering</h2>
          {check.length ? check.map((i, k) => <div key={k} className="row"><span className={`pill ${i.level === "block" ? "crit" : "warn"}`}>{i.level === "block" ? "Fix" : "Note"}</span><span>{i.text}</span></div>)
            : <div className="row"><span className="pill ok">Ready</span><span>Everything looks good.</span></div>}
          <div className="row">
            <button type="button" className="btn primary" disabled={blocked || !!busy} onClick={startRender}>{blocked ? "Fix the items above first" : "Render now"}</button>
            <button type="button" className="btn ghost" onClick={() => setCheck(null)}>Cancel</button>
          </div>
        </section>
      ) : null}

      <div className="ed-grid">
        <section className="ed-preview" aria-label="Preview">
          <div className={`ed-player ar-${project.aspect.replace(":", "x")}`}>
            <Player
              ref={player}
              component={Main}
              inputProps={props}
              durationInFrames={props.totalFrames}
              compositionWidth={props.width}
              compositionHeight={props.height}
              fps={props.fps}
              controls
              clickToPlay
              acknowledgeRemotionLicense
              style={{ width: "100%", height: "100%" }}
            />
          </div>
          <p className="muted small">Preview uses lighter clips; the final render uses full quality. {stale ? "Lines without an up-to-date voice play silent with estimated timing." : ""}</p>
        </section>

        <section className="ed-side">
          <div className="tabs" role="tablist">
            {[["scenes", `Scenes (${scenes.length})`], ["style", "Style"], ["music", "Music"]].map(([k, t]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{t}</button>
            ))}
          </div>
          {tab === "scenes" ? (
            <div className="ed-scenes">
              {scenes.map((s, i) => (
                <SceneCard key={s.id} scene={s} index={i} count={scenes.length} project={project} active={i === currentScene} signed={signed}
                  searching={searching === s.id}
                  onChange={(patch) => patchScene(s.id, patch)}
                  onPick={(clip) => patchScene(s.id, { clip })}
                  onSearch={(q, more, kind) => searchFor(s.id, q, more, kind)}
                  onUpload={(f) => upload(s, f)}
                  onMove={(d) => move(i, d)} onDelete={() => remove(i)} onAdd={() => addAfter(i)}
                  onSeek={() => { const p = props.scenes[i]; if (p && player.current) { player.current.seekTo(p.from); player.current.play(); } }} />
              ))}
            </div>
          ) : null}
          {tab === "style" ? <StylePanel project={project} ctx={ctx} onProject={saveProject} onSettings={(settings) => saveProject({ settings })} /> : null}
          {tab === "music" ? <MusicPanel project={project} tracks={tracks} signed={signed} sign={sign} onSettings={(settings) => saveProject({ settings })} /> : null}
        </section>
      </div>

      <Credits sb={sb} project={project} scenes={scenes} toast={toast} />
      <Renders sb={sb} jobs={jobs} onRetry={retry} />
    </div>
  );
}

// ------------------------------------------------------------------
export function mountEditor(el, ctx) {
  const root = createRoot(el);
  root.render(<Editor ctx={ctx} />);
  return () => root.unmount();
}
export { DEFAULT_SETTINGS, sceneSeconds };
