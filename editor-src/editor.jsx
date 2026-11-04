// Video editor: scene list + live preview (Remotion Player) + style + music + final render.
// Bundled with esbuild into web/editor.bundle.js; mounted by app.js on #/edit/<project_id>.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Player } from "@remotion/player";
import { Main } from "../video/Main.jsx";
import { PRESETS, playSample, presetFx, sampleUrl, voiceFx } from "../web/voicefx.js";
import { Thumbnail } from "../video/Thumbnail.jsx";
import { DEFAULT_SETTINGS, MAX_SCENE_SOUNDS, MUSIC_UNDER_VOICE, SOUND_BASE, THUMBNAIL_STYLES, buildProps, creditsText, foundMusic, hasThumbnail, mergeSettings, sceneSounds, thumbnailKey, thumbnailProps, thumbnailSize, preRenderCheck, sceneSeconds, withCredits } from "../video/layout.js";

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
  const [version, bump] = useState(0);
  const sign = useCallback(async (paths) => {
    const missing = [...new Set(paths.filter((p) => p && !cache.current.has(p)))];
    if (!missing.length) return;
    const { data } = await sb.storage.from("renders").createSignedUrls(missing, 6 * 3600);
    for (const item of data || []) if (item.signedUrl) cache.current.set(item.path, item.signedUrl);
    bump((n) => n + 1);
  }, [sb]);
  return [cache.current, sign, version];  // the map stays the same one: version says when it has new links
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
  const badge = { wikimedia: "Wiki", youtube: "YT CC", pexels: "Pexels", unsplash: "Unsplash" };

  return (
    <article className={`ed-scene${active ? " active" : ""}`} aria-label={`Scene ${index + 1}`}>
      <div className="ed-scene-head">
        <button type="button" className="ed-thumb" onClick={onSeek} aria-label={`Play from scene ${index + 1}`}>
          {thumb ? <img src={thumb} alt="" /> : <span>{clip.type === "card" ? "Text card" : clip.type === "video" ? "Your clip" : ""}</span>}
          <b>{index + 1}</b>
        </button>
        <div className="ed-scene-meta">
          <span className={`pill ${voiceState[0]}`}>{voiceState[1]}</span>
          <span className="muted small">{clip.type === "card" ? "No clip" : clip.source === "youtube" ? "YouTube CC · file needed" : `${clip.type === "video" ? "Video" : "Image"} · ${clip.source === "upload" ? "uploaded" : clip.source || ""}${clip.license || clip.credit?.license ? ` · ${clip.license || clip.credit.license}` : ""}`}{sceneSounds(scene).length ? ` · ${sceneSounds(scene).length} sound${sceneSounds(scene).length > 1 ? "s" : ""}` : ""}</span>
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
        {footage === "image" ? "Photos" : footage === "video" ? "Videos" : "Videos and photos"} from Wikimedia Commons (real footage of players, clubs, places; credit needed), <a href="https://www.pexels.com" target="_blank" rel="noopener">Pexels</a>, <a href="https://unsplash.com/?utm_source=youtube_control&utm_medium=referral" target="_blank" rel="noopener">Unsplash</a> (photos) and Pixabay.
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
const FX_SLIDERS = [
  ["pitch", "Pitch", -6, 3, 1, (v) => (v > 0 ? `+${v}` : `${v}`)],
  ["bass", "Bass", 0, 10, 1, (v) => `+${v} dB`],
  ["bright", "Brightness", -8, 4, 1, (v) => `${v > 0 ? "+" : ""}${v} dB`],
  ["echo", "Echo", 0, 100, 5, (v) => `${v}%`],
];

function ListenButton({ language, voice, style, toast }) {
  const [on, setOn] = useState(false);
  const click = async () => {
    try { setOn(await playSample(sampleUrl(language, voice, style))); } catch (e) { setOn(false); if (e.name !== "AbortError") toast("This sample isn't available yet."); }
  };
  useEffect(() => { setOn(false); }, [language, voice, style]);
  return <button type="button" className="btn small" aria-pressed={on} onClick={click}>{on ? "■ Stop" : "▶ Listen"}</button>;
}

/** Style buttons and fine tuning. Sliders apply when let go: each change means speaking every line again. */
function VoiceStyle({ project, onProject, toast }) {
  const fx = voiceFx(project.settings);
  const [draft, setDraft] = useState(null);
  const shown = draft || { ...fx, rate: Number(project.voice_rate) };
  const save = (nextFx, rate) => onProject({ settings: { ...project.settings, voice_fx: nextFx }, ...(rate ? { voice_rate: rate } : {}) }, true);
  const commit = () => {
    if (!draft) return;
    const { rate, ...next } = draft;
    setDraft(null);
    save({ ...next, style: "custom" }, rate);
  };
  const move = (patch) => setDraft({ ...shown, ...patch });
  const slider = (key, label, min, max, step, text) => (
    <Field key={key} label={`${label} · ${text(shown[key])}`}>
      <input type="range" min={min} max={max} step={step} value={shown[key]} aria-label={label} onChange={(e) => move({ [key]: Number(e.target.value) })} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
    </Field>
  );
  return (
    <>
      <span className="ed-label">Voice style</span>
      <div className="ed-voice-styles" role="group" aria-label="Voice style">
        {Object.entries(PRESETS).map(([k, p]) => (
          <button key={k} type="button" className={`btn small${fx.style === k ? " primary" : ""}`} aria-pressed={fx.style === k} onClick={() => { setDraft(null); save(presetFx(k), p.rate); }}>{p.label}</button>
        ))}
        <ListenButton language={project.language} voice={project.voice} style={fx.style} toast={toast} />
      </div>
      <div className="form-grid">
          {FX_SLIDERS.map(([key, label, min, max, step, text]) => slider(key, label, min, max, step, text))}
          <Field label={`Speed · ${shown.rate.toFixed(2)}×`}>
            <input type="range" min="0.7" max="1.3" step="0.01" value={shown.rate} aria-label="Speed" onChange={(e) => move({ rate: Number(e.target.value) })} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
          </Field>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {fx.style === "custom" ? "Listen plays the natural voice. Your settings are heard after you press “Update voice”." : "Press “Update voice” to use this style in the video."}
      </p>
    </>
  );
}

/** New videos in the network start from what's on screen: not this video's words, photo or chosen track. */
const PLATFORMS = { youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram Reels", twitter: "X", facebook: "Facebook Reels" };
const PRIVACY = {
  youtube: [["public", "Public"], ["unlisted", "Unlisted"], ["private", "Private"]],
  tiktok: [["PUBLIC_TO_EVERYONE", "Public"], ["SELF_ONLY", "Only me"], ["MUTUAL_FOLLOW_FRIENDS", "Friends"], ["FOLLOWER_OF_CREATOR", "Followers"]],
};
const POST_STATUS = { queued: ["info", "Queued"], uploading: ["info", "Sending"], scheduled: ["warn", "Scheduled"], published: ["ok", "Published"], failed: ["crit", "Failed"], cancelled: ["short", "Cancelled"] };

async function publishCall(sb, body) {
  const { data, error } = await sb.functions.invoke("publish", { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* keep */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Local value for a datetime-local field. */
const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

/** The last step: which accounts get this video, with what words, and when. Saved on the project, so it holds through the render. */
function PublishPanel({ sb, project, jobs, scenes, stale, onProject, onRender, toast }) {
  const plan = project.settings?.publish || {};
  const [network, setNetwork] = useState({ loading: true, channels: [], schedule: null, idea: null });
  const [posts, setPosts] = useState([]);
  const [earlier, setEarlier] = useState([]);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState("");
  const done = jobs.find((j) => j.status === "done");
  const rendering = jobs.some((j) => ["queued", "dispatched", "running"].includes(j.status));

  const load = useCallback(async () => {
    const [ch, sc, idea, rows] = await Promise.all([
      sb.from("channels").select("id,title,network_name,youtube_channel_id,connected").order("created_at"),
      project.channel_id ? sb.from("publish_schedules").select("*").eq("channel_id", project.channel_id).maybeSingle() : { data: null },
      project.idea_id ? sb.from("ideas").select("video_title,video_description").eq("id", project.idea_id).maybeSingle() : { data: null },
      done ? sb.from("publish_queue").select("*").eq("render_job_id", done.id) : { data: [] },
    ]);
    // what earlier renders of this video already sent
    const others = await sb.from("render_jobs").select("id").eq("project_id", project.id).neq("id", done?.id || "00000000-0000-0000-0000-000000000000");
    const ids = (others.data || []).map((j) => j.id);
    const old = ids.length ? await sb.from("publish_queue").select("*").in("render_job_id", ids).in("status", ["queued", "uploading", "scheduled", "published"]) : { data: [] };
    setNetwork({ loading: false, channels: ch.data || [], schedule: sc.data, idea: idea.data });
    setPosts(rows.data || []);
    setEarlier(old.data || []);
  }, [sb, project.id, project.channel_id, project.idea_id, done?.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!posts.some((r) => ["queued", "uploading"].includes(r.status))) return undefined;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [posts, load]);

  if (network.loading) return <div className="ed-panel"><p className="muted small" role="status">Loading the network…</p></div>;
  const channel = network.channels.find((c) => c.id === project.channel_id);
  const nameOf = (c) => c.network_name || c.title;
  if (!channel) {
    return (
      <div className="ed-panel">
        <h3>Publish</h3>
        <Field label="Which network is this video for?">
          <select className="field" value="" onChange={(e) => e.target.value && onProject({ channel_id: e.target.value })}>
            <option value="">Choose a network</option>
            {network.channels.map((c) => <option key={c.id} value={c.id}>{nameOf(c)}</option>)}
          </select>
        </Field>
      </div>
    );
  }
  const s = network.schedule;
  const targets = Array.isArray(s?.targets) ? s.targets : channel.youtube_channel_id ? [{ platform: "youtube", method: s?.method || "youtube" }] : [];
  const excluded = new Set(plan.exclude || []);
  const included = targets.filter((t) => !excluded.has(t.platform));
  const mode = plan.mode || (s?.enabled ? "next" : "ask");
  const save = (patch) => onProject({ settings: { ...project.settings, publish: { mode, ...plan, ...patch } } });
  const postOf = (platform) => posts.find((r) => r.platform === platform && r.status !== "cancelled");
  const defaults = { title: network.idea?.video_title || project.title || "", description: network.idea?.video_description || "" };
  const text = { ...defaults, ...(plan.text?.all || {}) };
  const textFor = (platform) => ({ ...text, ...(plan.text?.[platform] || {}) });
  const setText = (key, patch) => save({ text: { ...(plan.text || {}), [key]: { ...(plan.text?.[key] || {}), ...patch } } });
  const toggle = (platform, on) => { const next = new Set(excluded); if (on) next.delete(platform); else next.add(platform); save({ exclude: [...next] }); };
  const free = included.filter((t) => !postOf(t.platform) || postOf(t.platform).status === "failed");
  const dateOk = mode !== "date" || Date.parse(plan.at) > Date.now() + 15 * 60e3;

  const warnings = [];
  if (!targets.length) warnings.push("This network posts nowhere yet.");
  if (targets.length && !included.length) warnings.push("Every account is switched off for this video.");
  if (!text.title.trim()) warnings.push("The video has no title.");
  if (included.some((t) => t.platform === "twitter") && textFor("twitter").title.length > 280) warnings.push("X takes 280 characters: the title will be cut.");
  // this render's format: the Studio page may have changed since
  const aspect = done?.params?.aspect || project.aspect;
  if (aspect !== "9:16" && included.some((t) => ["tiktok", "instagram", "facebook"].includes(t.platform))) warnings.push(`This video is ${aspect}. TikTok and Reels are made for 9:16.`);
  if (aspect === "16:9" && included.some((t) => t.platform === "youtube")) warnings.push("This video is 16:9, so YouTube publishes it as a normal video, not a Short. For a Short, choose 9:16 on its Studio page and render again.");
  const earlierOf = (platform) => earlier.filter((r) => r.platform === platform).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (included.some((t) => !postOf(t.platform) && earlierOf(t.platform))) warnings.push("An earlier render of this video already went out, so this one won't go out by itself. Publishing it too makes a duplicate: delete the old post first if this one replaces it.");
  const t = project.settings?.thumbnail;
  if (hasThumbnail(t) && t.file?.key !== thumbnailKey(t, project.aspect)) warnings.push("The thumbnail changed since it was created. It's made again with the next render.");
  if (!hasThumbnail(t)) warnings.push("No thumbnail yet: each app picks a frame from the video.");
  if (mode === "date" && !dateOk) warnings.push("Pick a time at least 15 minutes from now.");
  if (stale) warnings.push(`${stale} scene(s) changed since their voice was made. Update the voice and render again.`);
  const newerEdits = done && Date.parse(project.updated_at) > Date.parse(done.finished_at || done.created_at);

  const publish = async (when) => {
    setBusy("Sending…");
    try {
      // the words and accounts on screen, saved before the job reads them
      const { error } = await sb.from("video_projects").update({ settings: project.settings }).eq("id", project.id);
      if (error) throw error;
      for (const target of free) {
        await publishCall(sb, { action: "queue", render_job_id: done.id, when, platform: target.platform });
      }
      toast(when === "now" ? "Publishing now" : "Scheduled");
      await load();
    } catch (e) { toast(e.message); } finally { setBusy(""); }
  };
  const whenValue = mode === "date" && dateOk ? new Date(plan.at).toISOString() : mode === "now" ? "now" : "next";

  return (
    <div className="ed-panel ed-publish">
      <h3>Publish on {nameOf(channel)}</h3>
      {!targets.length ? <p className="muted small" style={{ margin: 0 }}><a href={`#/channel/${channel.id}`}>Connect this network's accounts</a> first.</p> : null}
      <div className="ed-accounts" role="group" aria-label="Accounts">
        {targets.map((target) => {
          const post = postOf(target.platform);
          const on = !excluded.has(target.platform);
          const options = PRIVACY[target.platform];
          const custom = textFor(target.platform);
          return (
            <div key={target.platform} className={`ed-account${on ? "" : " off"}`}>
              <label className="row ed-check">
                <input type="checkbox" checked={on} disabled={!!post && post.status !== "failed"} onChange={(e) => toggle(target.platform, e.target.checked)} />
                <strong>{PLATFORMS[target.platform] || target.platform}</strong>
              </label>
              <div className="row">
                {post ? <span className={`pill ${POST_STATUS[post.status]?.[0] || "info"}`}>{POST_STATUS[post.status]?.[1] || post.status}</span> : on ? null : <span className="pill short">Skipped</span>}
                {post?.slot_at && post.status === "scheduled" ? <span className="muted small">{new Date(post.slot_at).toLocaleString()}</span> : null}
                {post?.public_url || post?.youtube_video_id ? <a className="small" href={post.public_url || `https://www.youtube.com/shorts/${post.youtube_video_id}`} target="_blank" rel="noopener">View post</a> : null}
                {!post && earlierOf(target.platform) ? <span className="pill warn">{earlierOf(target.platform).status === "scheduled" && earlierOf(target.platform).slot_at ? `Earlier render: ${new Date(earlierOf(target.platform).slot_at).toLocaleDateString()}` : "Earlier render sent"}</span> : null}
                {!post && (earlierOf(target.platform)?.public_url || earlierOf(target.platform)?.youtube_video_id) ? <a className="small" href={earlierOf(target.platform).public_url || `https://www.youtube.com/shorts/${earlierOf(target.platform).youtube_video_id}`} target="_blank" rel="noopener">View it</a> : null}
                {on && !post && options ? (
                  <select className="field ed-privacy" aria-label={`${PLATFORMS[target.platform]} visibility`} value={plan.options?.[target.platform]?.privacy || (target.platform === "tiktok" ? target.privacy || "PUBLIC_TO_EVERYONE" : s?.privacy || "public")}
                    onChange={(e) => save({ options: { ...(plan.options || {}), [target.platform]: { privacy: e.target.value } } })}>
                    {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                  </select>
                ) : null}
                {on && !post ? <button type="button" className="btn small ghost" aria-expanded={open === target.platform} onClick={() => setOpen(open === target.platform ? null : target.platform)}>Edit text</button> : null}
                {post?.status === "failed" ? <button type="button" className="btn small" disabled={!!busy || !done} onClick={async () => { try { await publishCall(sb, { action: "queue", render_job_id: done.id, when: whenValue, platform: target.platform }); await load(); } catch (e) { toast(e.message); } }}>Retry</button> : null}
                {post && ["queued", "failed"].includes(post.status) ? <button type="button" className="btn small ghost" onClick={async () => { try { await publishCall(sb, { action: "cancel", queue_id: post.id }); await load(); } catch (e) { toast(e.message); } }}>Cancel</button> : null}
              </div>
              {post?.error ? <pre className={post.status === "failed" ? "err" : "note"}>{post.error}</pre> : null}
              {open === target.platform ? (
                <div className="ed-account-text">
                  <Field label={target.platform === "twitter" ? `Post text · ${custom.title.length}/280` : "Title"}>
                    <input className="field" dir="auto" maxLength={target.platform === "twitter" ? 280 : 100} value={custom.title} onChange={(e) => setText(target.platform, { title: e.target.value })} />
                  </Field>
                  {target.platform === "twitter" ? null : (
                    <Field label={`Caption · ${custom.description.length} characters`}>
                      <textarea className="field" dir="auto" rows={4} value={custom.description} onChange={(e) => setText(target.platform, { description: e.target.value })} />
                    </Field>
                  )}
                  {plan.text?.[target.platform] ? <button type="button" className="btn small ghost" onClick={() => { const { [target.platform]: _drop, ...rest } = plan.text; save({ text: rest }); }}>Use the common text</button> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <h3>Text for all accounts</h3>
      <Field label="Title"><input className="field" dir="auto" maxLength={100} value={text.title} onChange={(e) => setText("all", { title: e.target.value })} /></Field>
      <Field label="Caption and hashtags" hint="Credits for music and photos stay at the end."><textarea className="field" dir="auto" rows={5} value={text.description} onChange={(e) => setText("all", { description: e.target.value })} /></Field>

      <h3>When</h3>
      <div className="ed-when" role="radiogroup" aria-label="When to publish">
        {[["ask", "I'll choose after the render"], ["next", "Next free slot"], ["now", "As soon as it's ready"], ["date", "On a date"]].map(([v, label]) => (
          <label key={v} className="row ed-check"><input type="radio" name="publish-when" checked={mode === v} onChange={() => save({ mode: v })} /> {label}</label>
        ))}
        {mode === "date" ? <input className="field" type="datetime-local" aria-label="Publish on" value={toLocalInput(plan.at)} onChange={(e) => save({ at: e.target.value ? new Date(e.target.value).toISOString() : null })} /> : null}
      </div>

      {warnings.length ? <div className="ed-warnings">{warnings.map((w) => <div key={w} className="row"><span className="pill warn">Note</span><span className="small">{w}</span></div>)}</div> : null}

      {done && newerEdits ? <div className="row"><span className="pill warn">Note</span><span className="small">You edited this project after the last render. Render again to include those changes.</span></div> : null}

      <div className="row">
        {done ? (
          <>
            <button type="button" className="btn primary" disabled={!!busy || !free.length || !text.title.trim()} onClick={() => publish("now")}>{busy || `Publish now (${free.length})`}</button>
            {mode === "date" ? <button type="button" className="btn" disabled={!!busy || !free.length || !dateOk} onClick={() => publish(new Date(plan.at).toISOString())}>Schedule for that date</button>
              : <button type="button" className="btn" disabled={!!busy || !free.length} onClick={() => publish("next")}>Schedule in next slot</button>}
          </>
        ) : rendering ? <span className="pill info">Rendering… these choices apply when it's ready</span>
          : <button type="button" className="btn primary" onClick={onRender}>Render final video</button>}
        <a className="btn small ghost" href="#/calendar">Calendar</a>
      </div>
    </div>
  );
}

function NetworkDefaults({ sb, project, toast }) {
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const s = mergeSettings(project.settings);
    const { text, image, file, error: lastError, ...thumbnail } = project.settings?.thumbnail || {};
    const { data, error } = await sb.from("channels").select("video_style").eq("id", project.channel_id).maybeSingle();
    const next = error ? null : {
      ...(data?.video_style || {}), language: project.language, voice: project.voice, voice_rate: Number(project.voice_rate), aspect: project.aspect,
      editor: {
        captions: s.captions, hook: { enabled: s.hook.enabled, text: "" }, titles: s.titles, progress: s.progress, sfx: s.sfx,
        music: { mood: "none", track_id: null, volume: s.music.volume, start: 0 }, voice_fx: project.settings?.voice_fx || null, thumbnail,
      },
    };
    const saved = next ? await sb.from("channels").update({ video_style: next }).eq("id", project.channel_id) : { error };
    setSaving(false);
    toast(saved.error ? `Not saved: ${saved.error.message}` : "New videos in this network will start with these settings");
  };
  return <button type="button" className="btn small" disabled={saving} onClick={save}>{saving ? "Saving…" : "Use these settings for this network"}</button>;
}

function StylePanel({ sb, project, ctx, onProject, onSettings, toast }) {
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
        <Field label="Format">
          <select className="field" value={project.aspect} onChange={(e) => onProject({ aspect: e.target.value })}>
            <option value="9:16">Short / Reel (9:16)</option><option value="16:9">Long video (16:9)</option><option value="1:1">Square (1:1)</option>
          </select>
        </Field>
      </div>
      <VoiceStyle project={project} onProject={onProject} toast={toast} />
      {project.channel_id ? <NetworkDefaults sb={sb} project={project} toast={toast} /> : null}

      <h3>Captions</h3>
      <label className="row ed-check"><input type="checkbox" checked={s.captions.enabled} onChange={(e) => set("captions", { enabled: e.target.checked })} /> Show captions</label>
      <div className="form-grid">
        <Field label="Style">
          <select className="field" value={s.captions.style || "classic"} onChange={(e) => set("captions", { style: e.target.value })}>
            <option value="classic">Classic: bold outline</option><option value="box">Box: dark background</option><option value="pill">Pill: colored current word</option><option value="clean">Clean: normal case</option>
          </select>
        </Field>
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

const MUSIC_BUTTONS = [["horror", "Horror"], ["dark", "Dark psycho"], ["love", "Love"], ["funny", "Funny"], ["epic", "Epic"], ["sad", "Sad"], ["happy", "Happy"], ["calm", "Calm"]];
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Only one track plays at a time. */
const playOnlyThis = (e) => {
  for (const a of e.currentTarget.closest(".ed-panel")?.querySelectorAll("audio") || []) if (a !== e.target) a.pause();
};

function MusicSearch({ sb, found, onPick }) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState(null);  // {mood} or {q}
  const [results, setResults] = useState([]);
  const [page, setPage] = useState(1);
  const [state, setState] = useState("idle");  // idle | busy | done
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const run = async (next, nextPage = 1) => {
    setQuery(next); setPage(nextPage); setState("busy"); setError("");
    if (nextPage === 1) setResults([]);
    try {
      const data = await invoke(sb, { action: "music_search", ...next, page: nextPage });
      setResults((old) => {
        const seen = new Set(nextPage === 1 ? [] : old.map((t) => t.id));
        return [...(nextPage === 1 ? [] : old), ...(data.results || []).filter((t) => !seen.has(t.id))];
      });
      setMore((data.results || []).length > 0);
    } catch (e) { setError(e.message); setMore(false); } finally { setState("done"); }
  };
  return (
    <div className="ed-music-search">
      <div className="ed-music-moods">
        {MUSIC_BUTTONS.map(([k, label]) => (
          <button key={k} type="button" className={`btn small${query?.mood === k ? " primary" : ""}`} aria-pressed={query?.mood === k} onClick={() => run({ mood: k })}>{label}</button>
        ))}
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (text.trim()) run({ q: text.trim() }); }}>
        <input className="field ed-music-q" type="search" aria-label="Search music" placeholder="Or type a word in English: ghost, tension, wedding…" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn small">Search</button>
      </form>
      {error ? <p className="muted small" role="alert">{error}</p> : null}
      {state === "busy" && !results.length ? <p className="muted small" role="status">Searching…</p> : null}
      {state === "done" && !results.length && !error ? <p className="muted small" role="status">No music found. Try another word.</p> : null}
      {results.map((t) => (
        <div key={t.id} className={`ed-music-track${found?.id === t.id ? " picked" : ""}`}>
          <div className="ed-music-info">
            <strong>{t.title}</strong>
            <span className="muted small">{t.author} · {mmss(t.duration)} · {t.license}</span>
          </div>
          <audio controls preload="none" src={t.url} onPlay={playOnlyThis} />
          <button type="button" className={`btn small${found?.id === t.id ? "" : " primary"}`} disabled={found?.id === t.id} onClick={() => onPick(t)}>{found?.id === t.id ? "In use" : "Use"}</button>
        </div>
      ))}
      {results.length && more ? <button type="button" className="btn small" disabled={state === "busy"} onClick={() => run(query, page + 1)}>{state === "busy" ? "Loading…" : "More music"}</button> : null}
    </div>
  );
}

function ThumbnailPanel({ sb, project, scenes, signed, sign, onThumbnail, onCreate, creating, toast }) {
  const t = project.settings?.thumbnail || {};
  const style = THUMBNAIL_STYLES[t.style] ? t.style : "dark";
  const set = (patch) => onThumbnail({ ...t, style, ...patch });
  const [results, setResults] = useState([]);
  const [q, setQ] = useState("");
  const [state, setState] = useState("");
  const [ideas, setIdeas] = useState([]);
  useEffect(() => { if (t.image?.path) sign([t.image.path]); }, [t.image?.path, sign]);
  const fromScenes = scenes.map((s) => s.clip).filter((c) => c && c.type !== "card" && (c.url || c.path)).filter((c, i, all) => all.findIndex((x) => (x.url || x.path) === (c.url || c.path)) === i);
  useEffect(() => { sign(fromScenes.map((c) => c.path).filter(Boolean)); }, [scenes, sign]);
  const search = async (e) => {
    e.preventDefault();
    if (!q.trim()) return;
    setState("Searching…");
    try {
      const data = await invoke(sb, { action: "search", q: q.trim(), kind: "image", aspect: project.aspect });
      setResults(data.results || []);
      setState((data.results || []).length ? "" : "No photos found. Try another word.");
    } catch (err) { setState(err.message); }
  };
  const upload = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) return toast("Choose an image under 10 MB.");
    const path = `projects/${project.id}/media/thumb-${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
    setState("Uploading…");
    const { error } = await sb.storage.from("renders").upload(path, file, { contentType: file.type });
    setState(error ? `Upload failed: ${error.message}` : "");
    if (!error) { await sign([path]); set({ image: { type: "image", source: "upload", path } }); }
  };
  const suggest = async () => {
    setState("Writing ideas…");
    try {
      const { data, error } = await sb.functions.invoke("ai", { body: { action: "thumbnail_text", idea_id: project.idea_id, title: project.title, language: project.language } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setIdeas(data.options || []);
      setState("");
    } catch (err) { setState(err.message || "Couldn't write ideas."); }
  };
  const save = async () => {
    try {
      const { url } = await invoke(sb, { action: "thumbnail_link", project_id: project.id });
      window.location.href = url;
    } catch (err) { toast(err.message); }
  };
  const same = (c) => t.image && (c.url ? t.image.url === c.url : t.image.path === c.path);
  const pick = (c) => set({ image: { type: c.type, source: c.source, id: c.id, url: c.url, preview: c.preview, thumb: c.thumb, path: c.path, trim: c.trim || 0, tags: c.tags, author: c.author, license: c.license, page: c.page, credit: c.credit, download_location: c.download_location } });
  const tile = (c, i) => {
    const src = c.path ? signed.get(c.path) : c.thumb || c.preview || c.url;
    return (
      <button key={`${c.source}-${c.id || c.path}-${i}`} type="button" className={`ed-thumb-tile${same(c) ? " picked" : ""}`} aria-pressed={!!same(c)} aria-label={`Use ${c.tags || "this image"}`} onClick={() => pick(c)}>
        {src ? <img src={src} alt="" loading="lazy" /> : null}
      </button>
    );
  };
  const current = t.file?.key === thumbnailKey(t, project.aspect);
  return (
    <div className="ed-panel">
      <h3>Thumbnail</h3>
      <p className="muted small" style={{ margin: 0 }}>{project.aspect === "9:16" ? "Vertical cover for Shorts, TikTok and Reels. Keep the words in the middle: the apps cover the top and bottom." : "Sent to YouTube with the video."}</p>
      <Field label="Text" hint="2 to 5 big words work best. The last word takes the accent colour.">
        <input className="field" dir="auto" maxLength={60} value={t.text || ""} onChange={(e) => set({ text: e.target.value })} placeholder="They never told you" />
      </Field>
      {project.idea_id ? <button type="button" className="btn small" onClick={suggest} disabled={state === "Writing ideas…"}>Suggest text</button> : null}
      {ideas.length ? <div className="ed-thumb-styles">{ideas.map((o) => <button key={o} type="button" className="btn small ghost" onClick={() => set({ text: o })}>{o}</button>)}</div> : null}
      <span className="ed-label">Style</span>
      <div className="ed-thumb-styles" role="group" aria-label="Thumbnail style">
        {Object.entries(THUMBNAIL_STYLES).map(([k, s]) => <button key={k} type="button" className={`btn small${style === k ? " primary" : ""}`} aria-pressed={style === k} onClick={() => set({ style: k, color: null, accent: null })}>{s.label}</button>)}
      </div>
      <div className="form-grid">
        <Field label={`Text size · ${t.size || 110}`}><input type="range" min="60" max="170" step="5" value={t.size || 110} aria-label="Text size" onChange={(e) => set({ size: Number(e.target.value) })} /></Field>
        <Field label="Position">
          <select className="field" value={t.position || (project.aspect === "9:16" ? "center" : "bottom")} onChange={(e) => set({ position: e.target.value })}><option value="top">Top</option><option value="center">Middle</option><option value="bottom">Bottom</option></select>
        </Field>
        <Field label="Text colour"><input type="color" className="ed-thumb-color" value={t.color || THUMBNAIL_STYLES[style].color} onChange={(e) => set({ color: e.target.value })} /></Field>
        <Field label="Accent colour"><input type="color" className="ed-thumb-color" value={t.accent || THUMBNAIL_STYLES[style].accent} onChange={(e) => set({ accent: e.target.value })} /></Field>
      </div>
      <span className="ed-label">Image from your scenes</span>
      {fromScenes.length ? <div className="ed-thumb-grid">{fromScenes.map(tile)}</div> : <p className="muted small" style={{ margin: 0 }}>Your scenes have no clips yet.</p>}
      <form className="row" onSubmit={search}>
        <input className="field ed-music-q" type="search" aria-label="Search photos" placeholder="Search photos: dark corridor, shadow…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn small">Search</button>
      </form>
      {results.length ? <div className="ed-thumb-grid">{results.slice(0, 12).map(tile)}</div> : null}
      <label className="btn small ed-thumb-upload">Upload an image<input type="file" accept="image/*" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} /></label>
      {state ? <p className="muted small" role="status" style={{ margin: 0 }}>{state}</p> : null}
      {t.error ? <pre className="err">{t.error}</pre> : null}
      <label className="row ed-check">
        <input type="checkbox" checked={t.first_frame !== false} onChange={(e) => set({ first_frame: e.target.checked })} />
        <span>Use as the video's first frame, too short to notice. TikTok takes the first frame as the cover, and on a phone you can pick it. Applies at the next final render.</span>
      </label>
      <div className="row">
        <button type="button" className="btn primary" disabled={!hasThumbnail(t) || creating} onClick={onCreate}>{creating ? "Creating… about 2 minutes" : current ? "Create it again" : "Create thumbnail"}</button>
        {t.file?.path ? <button type="button" className="btn small" onClick={save}>Save image</button> : null}
        {hasThumbnail(t) ? <span className={`pill ${current ? "ok" : "warn"}`}>{current ? "Ready" : t.file ? "Changed" : "Not created"}</span> : null}
      </div>
    </div>
  );
}

/** How loud the music is. Under the voice it plays at MUSIC_UNDER_VOICE of this level (video/Main.jsx). */
function MusicLevel({ volume, onChange }) {
  const level = Math.round(volume * 100);
  return (
    <Field label={`Music level · ${level}%`} hint={`Under the voice: ${Math.round(level * MUSIC_UNDER_VOICE)}%. Press play on the preview to hear it.`}>
      <input type="range" min="0" max="1" step="0.01" value={volume} aria-label="Music level" onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  );
}

function MusicPanel({ sb, project, tracks, signed, sign, onSettings }) {
  const s = mergeSettings(project.settings);
  const found = foundMusic(s.music);
  const moods = [...new Set(tracks.map((t) => t.mood))];
  const inMood = tracks.filter((t) => t.mood === s.music.mood);
  const current = tracks.find((t) => t.id === s.music.track_id);
  const set = (patch) => onSettings({ ...project.settings, music: { ...s.music, ...patch } });
  const pick = (mood) => {
    const pool = tracks.filter((t) => t.mood === mood);
    const t = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    set({ mood, track_id: t?.id || null, found: null });
  };
  const startAt = (
    <Field label="Start the track at (seconds)" hint="Skip a slow intro, start at the drop.">
      <input className="field ed-trim" type="number" min="0" step="1" value={s.music.start} onChange={(e) => set({ start: Math.max(0, Number(e.target.value) || 0) })} />
    </Field>
  );
  useEffect(() => { if (current) sign([current.path]); }, [current, sign]);
  return (
    <div className="ed-panel">
      <h3>Background music</h3>
      <MusicLevel volume={s.music.volume} onChange={(volume) => set({ volume })} />
      {found ? (
        <div className="ed-music-track picked">
          <div className="ed-music-info">
            <strong>{found.title}</strong>
            <span className="muted small">{found.author} · {found.license} · credited in the description</span>
          </div>
          <audio controls preload="none" src={found.url} onPlay={playOnlyThis} />
          <button type="button" className="btn small ghost" onClick={() => set({ mood: "none", track_id: null, found: null })}>Remove</button>
        </div>
      ) : null}
      {found ? startAt : null}
      <h3>Find music</h3>
      <MusicSearch sb={sb} found={found} onPick={(t) => set({ mood: "found", track_id: null, found: t })} />
      <h3>Your own tracks</h3>
      {!tracks.length ? (
        <p className="muted small">Add your own in <a href="#/settings">Settings → Music library</a>. YouTube Audio Library tracks are the safest for copyright.</p>
      ) : (
      <Field label="Mood">
        <select className="field" value={found ? "none" : s.music.mood} onChange={(e) => (e.target.value === "none" ? set({ mood: "none", track_id: null, found: null }) : pick(e.target.value))}>
          <option value="none">{found ? "Using the music above" : "No music"}</option>
          {moods.map((m) => <option key={m} value={m}>{moodName(m)} ({tracks.filter((t) => t.mood === m).length})</option>)}
        </select>
      </Field>
      )}
      {!found && s.music.mood !== "none" && inMood.length ? (
        <>
          <Field label="Track">
            <select className="field" value={s.music.track_id || ""} onChange={(e) => set({ track_id: e.target.value || null, found: null })}>
              {inMood.map((t) => <option key={t.id} value={t.id}>{t.title}{t.duration ? ` · ${Math.round(t.duration)} s` : ""}</option>)}
            </select>
          </Field>
          <div className="row">
            <button type="button" className="btn small" onClick={() => pick(s.music.mood)}>Shuffle track</button>
            {current && signed.get(current.path) ? <audio controls preload="none" src={signed.get(current.path)} style={{ maxWidth: "100%" }} /> : null}
          </div>
          {startAt}
        </>
      ) : null}
    </div>
  );
}

const SOUND_PAGE = 30;

/** Sound effects: the library (web/sfx-library.json, files on the VDS) and what each scene plays. */
function SoundsPanel({ scenes, currentScene, onSounds, onSeek }) {
  const [library, setLibrary] = useState(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState(null);  // scene id; follows the preview until one is chosen
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(SOUND_PAGE);
  useEffect(() => {
    fetch("sfx-library.json").then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); }).then(setLibrary)
      .catch((e) => setError(`The sound library didn't load (${e.message}). Reload the page to try again.`));
  }, []);
  const scene = scenes.find((s) => s.id === picked) || scenes[Math.max(currentScene, 0)] || scenes[0];
  const index = scenes.indexOf(scene);
  const placed = sceneSounds(scene);
  const set = (next) => { setPicked(scene.id); onSounds(scene.id, next); };
  const patch = (i, change) => set(placed.map((x, j) => (j === i ? { ...x, ...change } : x)));
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = (library?.sounds || []).filter((x) => (!category || x.category === category) && words.every((w) => `${x.title} ${x.keywords || ""} ${x.category}`.toLowerCase().includes(w)));
  const categories = [...new Set((library?.sounds || []).map((x) => x.category))];
  const full = placed.length >= MAX_SCENE_SOUNDS;
  if (!scene) return <div className="ed-panel"><p className="muted small">Add a scene first.</p></div>;
  return (
    <div className="ed-panel">
      <h3>Sounds on a scene</h3>
      <Field label="Scene">
        <select className="field" value={scene.id} onChange={(e) => setPicked(e.target.value)}>
          {scenes.map((s, i) => <option key={s.id} value={s.id}>{`${i + 1}. ${s.text.slice(0, 50)}${sceneSounds(s).length ? ` (${sceneSounds(s).length} sound${sceneSounds(s).length > 1 ? "s" : ""})` : ""}`}</option>)}
        </select>
      </Field>
      {!placed.length ? <p className="muted small">No sound on scene {index + 1} yet. Pick one below.</p> : null}
      {placed.map((x, i) => (
        <div key={`${x.id}-${i}`} className="ed-music-track picked">
          <div className="ed-music-info">
            <strong>{x.title}</strong>
            <span className="muted small">{fmtS(x.duration)}</span>
          </div>
          <Field label={`Level · ${Math.round(Number(x.volume ?? 0.6) * 100)}%`}>
            <input type="range" min="0" max="1" step="0.05" value={x.volume ?? 0.6} aria-label={`${x.title} level`} onChange={(e) => patch(i, { volume: Number(e.target.value) })} />
          </Field>
          <Field label="Start after (seconds)">
            <input className="field ed-trim" type="number" min="0" step="0.1" value={x.at ?? 0} aria-label={`${x.title} start`} onChange={(e) => patch(i, { at: Math.max(0, Number(e.target.value) || 0) })} />
          </Field>
          <label className="row ed-check"><input type="checkbox" checked={x.cut !== false} onChange={(e) => patch(i, { cut: e.target.checked })} /> Stop when the scene ends</label>
          <button type="button" className="btn small ghost" onClick={() => set(placed.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      {placed.length ? <button type="button" className="btn small" onClick={() => { setPicked(scene.id); onSeek(index); }}>Hear scene {index + 1}</button> : null}
      <h3>Sound library</h3>
      {error ? <p className="muted small" role="alert">{error}</p> : null}
      {!library && !error ? <p className="muted small" role="status">Loading sounds…</p> : null}
      {library ? (
        <div className="ed-music-search">
          <div className="ed-music-moods">
            <button type="button" className={`btn small${!category ? " primary" : ""}`} aria-pressed={!category} onClick={() => { setCategory(""); setShown(SOUND_PAGE); }}>All</button>
            {categories.map((c) => <button key={c} type="button" className={`btn small${category === c ? " primary" : ""}`} aria-pressed={category === c} onClick={() => { setCategory(c); setShown(SOUND_PAGE); }}>{c}</button>)}
          </div>
          <div className="row">
            <input className="field ed-music-q" type="search" aria-label="Search sounds" placeholder="Type a word in English: scream, rain, ghost…" value={q} onChange={(e) => { setQ(e.target.value); setShown(SOUND_PAGE); }} />
          </div>
          <p className="muted small" role="status">{results.length ? `${results.length} sound${results.length > 1 ? "s" : ""}, free to use with no credit (CC0).` : "No sound found. Try another word."}</p>
          {results.slice(0, shown).map((x) => (
            <div key={x.id} className="ed-music-track">
              <div className="ed-music-info">
                <strong>{x.title}</strong>
                <span className="muted small">{x.category} · {fmtS(x.duration)}</span>
              </div>
              <audio controls preload="none" src={`${SOUND_BASE}${x.id}.mp3`} onPlay={playOnlyThis} />
              <button type="button" className="btn small primary" disabled={full} title={full ? `A scene can have ${MAX_SCENE_SOUNDS} sounds` : undefined}
                onClick={() => set([...placed, { id: x.id, title: x.title, url: `${SOUND_BASE}${x.id}.mp3`, duration: x.duration, volume: 0.6, at: 0, cut: true }])}>Add to scene {index + 1}</button>
            </div>
          ))}
          {results.length > shown ? <button type="button" className="btn small" onClick={() => setShown(shown + SOUND_PAGE)}>More sounds</button> : null}
        </div>
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
  const text = creditsText(scenes, project.settings?.music, project.settings?.thumbnail);
  if (!text) return null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast("Credits copied"); } catch { toast("Copy failed: select the text and copy it"); }
  };
  const add = async () => { const err = await saveCredits(sb, project.idea_id, text); toast(err ? `Not saved: ${err}` : "Credits are in the description"); };
  return (
    <section className="card">
      <h2>Credits</h2>
      <p className="muted small" style={{ margin: 0 }}>
        This footage and music get a credit line in the video description.
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

function Renders({ sb, jobs, onRetry, onPublish }) {
  const [urls, setUrls] = useState({});
  if (!jobs.length) return null;
  const cls = { done: "ok", failed: "crit", running: "info", dispatched: "info", queued: "warn" };
  const label = { done: "Ready", failed: "Failed", running: "Rendering…", dispatched: "Starting…", queued: "Queued" };
  const signed = async (j, download) => {
    if (String(j.output_path).startsWith("vds:")) return (await invoke(sb, { action: "video_link", job_id: j.id, download: !!download })).url;
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
            {j.status === "done" && j.output_path ? <button type="button" className="btn small" onClick={async () => { const u = await signed(j, true); if (u) location.href = u; }}>Download</button> : null}
            {j.status === "done" ? <button type="button" className="btn small primary" onClick={onPublish}>Publish</button> : null}
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
  const [tab, setTab] = useState(ctx.initialTab || "scenes");
  const [busy, setBusy] = useState("");
  const [searching, setSearching] = useState(null);
  const [check, setCheck] = useState(null);
  const [frame, setFrame] = useState(0);
  const [missing, setMissing] = useState(false);
  const player = useRef(null);
  const [signed, sign, signedVersion] = useSigned(sb);
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
  const [networkName, setNetworkName] = useState("");
  useEffect(() => {
    if (!project?.channel_id) { setNetworkName(""); return; }
    sb.from("channels").select("title,network_name").eq("id", project.channel_id).maybeSingle().then(({ data }) => setNetworkName(data?.network_name || data?.title || ""));
  }, [sb, project?.channel_id]);
  // a render that just finished leads to the last step
  const wasRendering = useRef(false);
  useEffect(() => {
    if (wasRendering.current && !rendering && jobs.some((j) => j.status === "done")) { setTab("publish"); toast("Your video is ready. Choose where it goes."); }
    wasRendering.current = rendering;
  }, [rendering, jobs, toast]);
  const [creatingThumb, setCreatingThumb] = useState(null);  // when it started
  useEffect(() => {
    if (!preparing && !rendering && !creatingThumb) return undefined;
    const t = setInterval(load, preparing || creatingThumb ? 5000 : 10000);
    return () => clearInterval(t);
  }, [preparing, rendering, creatingThumb, load]);
  useEffect(() => {
    if (!creatingThumb) return;
    const th = project?.settings?.thumbnail;
    if (th?.error) setCreatingThumb(null);
    else if (th?.file?.key === thumbnailKey(th, project.aspect) && Date.parse(th.file.at) >= creatingThumb) { setCreatingThumb(null); toast("Thumbnail ready"); }
    else if (Date.now() - creatingThumb > 6 * 60e3) { setCreatingThumb(null); toast("The thumbnail is taking too long. Try again."); }
  }, [project, creatingThumb, toast]);
  const createThumbnail = async () => {
    const started = Date.now();
    try {
      const settings = { ...project.settings, thumbnail: { ...project.settings.thumbnail, error: null } };
      clearTimeout(saveTimer.current);
      const { error } = await sb.from("video_projects").update({ settings, title: project.title }).eq("id", project.id);
      if (error) throw error;
      setProject((p) => ({ ...p, settings }));
      await invoke(sb, { action: "thumbnail", project_id: project.id });
      setCreatingThumb(started);
      toast("Creating the thumbnail: about 2 minutes");
    } catch (e) { toast(e.message); }
  };

  const props = useMemo(() => {
    if (!project) return null;
    const base = new URL("./", location.href).href;
    const voice = Object.fromEntries(scenes.map((s) => [s.id, s.voice_path ? signed.get(s.voice_path) : null]));
    const media = Object.fromEntries(scenes.filter((s) => s.clip?.path).map((s) => [s.clip.path, signed.get(s.clip.path)]));
    const track = tracks.find((t) => t.id === project.settings?.music?.track_id);
    const found = foundMusic(project.settings?.music);
    const coverPath = project.settings?.thumbnail?.image?.path;
    return buildProps(project, scenes, {
      coverImage: coverPath ? signed.get(coverPath) : null,
      voice, media, music: found ? found.url : track && project.settings?.music?.mood !== "none" ? signed.get(track.path) || null : null,
      sfx: { whoosh: base + "sfx/whoosh.mp3", hit: base + "sfx/hit.mp3" }, assetBase: base,
    });
  }, [project, scenes, tracks, signed, signedVersion]);

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
      const credits = creditsText(scenes, project.settings?.music, project.settings?.thumbnail);
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

  const finished = jobs.some((j) => j.status === "done");
  const step = tab === "publish" ? 4 : check ? 3 : 2;
  return (
    <div className="ed">
      <ol className="flow" aria-label="Steps">
        <li><a href={back}>1. Script</a></li>
        <li aria-current={step === 2 ? "step" : undefined}><button type="button" onClick={() => setTab("scenes")}>2. Scenes &amp; style</button></li>
        <li aria-current={step === 3 ? "step" : undefined} className={finished ? "done" : ""}><button type="button" onClick={() => setCheck(issues)} disabled={!!busy || preparing}>3. Render</button></li>
        <li aria-current={step === 4 ? "step" : undefined}><button type="button" onClick={() => setTab("publish")}>4. Publish</button></li>
      </ol>
      <header className="head ed-head">
        <div className="head-text">
          <a href={back} className="small">← Script &amp; settings</a>
          {networkName ? <span className="pill short ed-network">{networkName}</span> : null}
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
            <button type="button" className="btn ghost" onClick={() => { setCheck(null); setTab("publish"); }}>Publishing choices</button>
            <button type="button" className="btn primary" disabled={blocked || !!busy} onClick={startRender}>{blocked ? "Fix the items above first" : "Render now"}</button>
            <button type="button" className="btn ghost" onClick={() => setCheck(null)}>Cancel</button>
          </div>
        </section>
      ) : null}

      <div className="ed-grid">
        <section className="ed-preview" aria-label="Preview">
          {tab === "thumbnail" ? (
            <div key="thumbnail" className={`ed-player ar-${project.aspect.replace(":", "x")}`}>
              <Player
                component={Thumbnail}
                inputProps={thumbnailProps({ ...project.settings?.thumbnail, image: project.settings?.thumbnail?.image?.path ? { ...project.settings.thumbnail.image, url: signed.get(project.settings.thumbnail.image.path) } : project.settings?.thumbnail?.image }, project.aspect, new URL("./", location.href).href)}
                durationInFrames={1} fps={30} compositionWidth={thumbnailSize(project.aspect)[0]} compositionHeight={thumbnailSize(project.aspect)[1]}
                style={{ width: "100%", height: "100%" }}
              />
            </div>
          ) : (
          <div key="video" className={`ed-player ar-${project.aspect.replace(":", "x")}`}>
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
              numberOfSharedAudioTags={24}
              style={{ width: "100%", height: "100%" }}
            />
          </div>
          )}
          {foundMusic(project.settings?.music) || tracks.some((t) => t.id === project.settings?.music?.track_id) ? (
            <MusicLevel volume={mergeSettings(project.settings).music.volume} onChange={(volume) => saveProject({ settings: { ...project.settings, music: { ...mergeSettings(project.settings).music, volume } } })} />
          ) : null}
          <p className="muted small">Preview uses lighter clips; the final render uses full quality. {stale ? "Lines without an up-to-date voice play silent with estimated timing." : ""}</p>
        </section>

        <section className="ed-side">
          <div className="tabs" role="tablist">
            {[["scenes", `Scenes (${scenes.length})`], ["style", "Style"], ["music", "Music"], ["sounds", "Sounds"], ["thumbnail", "Thumbnail"], ["publish", "Publish"]].map(([k, t]) => (
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
          {tab === "style" ? <StylePanel sb={sb} project={project} ctx={ctx} toast={toast} onProject={saveProject} onSettings={(settings) => saveProject({ settings })} /> : null}
          {tab === "publish" ? <PublishPanel sb={sb} project={project} jobs={jobs} scenes={scenes} stale={stale} toast={toast} onProject={saveProject} onRender={() => setCheck(issues)} /> : null}
          {tab === "thumbnail" ? <ThumbnailPanel sb={sb} project={project} scenes={scenes} signed={signed} sign={sign} toast={toast} creating={!!creatingThumb} onCreate={createThumbnail} onThumbnail={(thumbnail) => saveProject({ settings: { ...project.settings, thumbnail } })} /> : null}
          {tab === "music" ? <MusicPanel sb={sb} project={project} tracks={tracks} signed={signed} sign={sign} onSettings={(settings) => saveProject({ settings })} /> : null}
          {tab === "sounds" ? <SoundsPanel scenes={scenes} currentScene={currentScene} onSounds={(id, sounds) => patchScene(id, { sounds })}
            onSeek={(i) => { const p = props.scenes[i]; if (p && player.current) { player.current.seekTo(p.from); player.current.play(); } }} /> : null}
        </section>
      </div>

      <Credits sb={sb} project={project} scenes={scenes} toast={toast} />
      <Renders onPublish={() => setTab("publish")} sb={sb} jobs={jobs} onRetry={retry} />
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
