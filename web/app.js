import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import { slotsBetween } from "./slots.js";
import { PRESETS, playSample, presetFx, sampleUrl, voiceFx } from "./voicefx.js";
import { VOICES } from "./voices.js";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true } });

// ==================================================================
// Helpers (all external text goes through textContent)
// ==================================================================
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "style") el.style.cssText = v;
    else if (k === "value") el.value = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
const svgNS = "http://www.w3.org/2000/svg";
function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k) el.append(k);
  return el;
}
const icon = (name) => svg("svg", { class: "i", "aria-hidden": "true" }, svg("use", { href: `#${name}` }));
const nf = new Intl.NumberFormat("en-US");
const cf = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmt = (n) => (n === null || n === undefined ? "—" : nf.format(Math.round(Number(n))));
const fmtc = (n) => (n === null || n === undefined ? "—" : cf.format(Number(n)));
const pctOf = (a, b) => (b ? Math.max(0, Math.min(100, (Number(a) / Number(b)) * 100)) : 0);
const today = () => new Date().toISOString().slice(0, 10);
function ago(iso) {
  if (!iso) return "—";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const unit = (n, w) => `${n} ${w}${n === 1 ? "" : "s"} ago`;
  if (s < 86400 * 60) return unit(Math.round(s / 86400), "day");
  if (s < 86400 * 730) return unit(Math.round(s / 86400 / 30), "month");
  return unit(Math.round(s / 86400 / 365), "year");
}
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
function delta(cur, prev) {
  if (!prev) return h("span", { class: "flat", text: "no previous data" });
  const p = ((cur - prev) / prev) * 100;
  return h("span", { class: p > 0.5 ? "up" : p < -0.5 ? "down" : "flat", text: `${p > 0 ? "+" : ""}${p.toFixed(0)}% vs previous` });
}
function scorePill(s, big) {
  if (s === null || s === undefined) return h("span", { class: "score lo", text: "—" });
  return h("span", { class: `score ${s >= 70 ? "hi" : s >= 45 ? "mid" : "lo"}${big ? " big" : ""}`, text: String(Math.round(s)) });
}
const volLabel = (v) => (v === null || v === undefined ? "—" : v < 20 ? "Very low" : v < 40 ? "Low" : v < 60 ? "Medium" : v < 80 ? "High" : "Very high");
const diffLabel = (d) => (d === null || d === undefined ? "—" : d < 25 ? "Easy" : d < 50 ? "Medium" : d < 75 ? "Hard" : "Very hard");
const diffColor = (d) => (d < 25 ? "#12985A" : d < 50 ? "#5B6370" : d < 75 ? "#D48A0A" : "#B3261E");
function bar(pct, color, thick) {
  return h("div", { class: thick ? "bar thick" : "bar" }, h("div", { style: `width:${Math.max(pct, 2)}%;${color ? `background:${color}` : ""}` }));
}
function spark(values, w = 84, hgt = 24) {
  const vals = values.filter((v) => v !== null && v !== undefined).map(Number);
  if (vals.length < 2) return null;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * (w - 4) + 2},${hgt - 2 - ((v - min) / span) * (hgt - 4)}`).join(" ");
  return svg("svg", { width: w, height: hgt, viewBox: `0 0 ${w} ${hgt}`, "aria-hidden": "true", class: "spark" },
    svg("polyline", { points: pts, fill: "none", stroke: "#111418", "stroke-width": "1.75", "stroke-linejoin": "round" }));
}
function lineChart(points, label) {
  const w = 640, ht = 200, pl = 40, pr = 10, pt = 14, pb = 28;
  const max = Math.max(...points.map((p) => p.y), 1);
  const X = (i) => pl + (i / Math.max(points.length - 1, 1)) * (w - pl - pr);
  const Y = (v) => pt + (1 - v / max) * (ht - pt - pb);
  const g = svg("svg", { viewBox: `0 0 ${w} ${ht}`, role: "img", "aria-label": label, style: "width:100%;height:auto" });
  [0, 0.5, 1].forEach((f) => {
    g.append(svg("line", { x1: pl, x2: w - pr, y1: Y(max * f), y2: Y(max * f), stroke: f === 0 ? "#C2C9D1" : "#E7EAEE" }));
    const t = svg("text", { x: pl - 6, y: Y(max * f) + 4, "text-anchor": "end", "font-size": "11", fill: "#5B6370" }); t.textContent = Math.round(max * f); g.append(t);
  });
  [0, points.length - 1].forEach((i) => {
    const t = svg("text", { x: X(i), y: ht - 8, "text-anchor": i ? "end" : "start", "font-size": "11", fill: "#5B6370" }); t.textContent = points[i].x; g.append(t);
  });
  g.append(svg("polyline", { fill: "none", stroke: "#111418", "stroke-width": "2.5", "stroke-linejoin": "round", points: points.map((p, i) => `${X(i)},${Y(p.y)}`).join(" ") }));
  const last = points[points.length - 1];
  if (last) g.append(svg("circle", { cx: X(points.length - 1), cy: Y(last.y), r: "4.5", fill: "#E5322C", stroke: "#FBFCFD", "stroke-width": "2" }));
  return g;
}
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 4000);
}
async function q(p) { const { data, error } = await p; if (error) throw error; return data; }
function seg(options, current, onPick, label) {
  return h("div", { class: "seg", role: "group", "aria-label": label },
    options.map(([v, text]) => h("button", { type: "button", "aria-pressed": String(v === current), onclick: () => onPick(v), text })));
}
function selectEl(id, options, current, onChange, label, extra = {}) {
  return h("div", { class: "field-wrap" }, label ? h("label", { for: id, text: label }) : null,
    h("select", { id, class: "field", onchange: (e) => onChange(e.target.value), ...extra },
      options.map(([v, text]) => h("option", { value: v, selected: String(v) === String(current), text }))));
}
const empty = (text, action) => h("div", { class: "empty" }, h("div", { text }), action || null);
const skeleton = () => h("div", { class: "skeleton", "aria-busy": "true", "aria-label": "Loading" },
  h("div", { class: "sk sk-title" }), h("div", { class: "sk-row" }, [1, 2, 3, 4].map(() => h("div", { class: "sk sk-card" }))), h("div", { class: "sk sk-block" }));
// Phones show table rows as cards (see .stack in styles.css): each cell carries its column name.
function labelTables(root) {
  for (const t of root.querySelectorAll("table")) {
    const heads = [...t.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    for (const tr of t.querySelectorAll("tbody tr")) [...tr.children].forEach((td, i) => { if (heads[i]) td.dataset.label = heads[i]; });
    t.classList.add("stack");
  }
}
const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };

// ==================================================================
// Constants
// ==================================================================
const MARKETS = [["GLOBAL", "Global"], ["US", "United States"], ["GB", "United Kingdom"], ["CA", "Canada"], ["AU", "Australia"],
  ["IN", "India"], ["FR", "France"], ["BE", "Belgium"], ["CH", "Switzerland"], ["DE", "Germany"], ["AT", "Austria"], ["ES", "Spain"],
  ["IT", "Italy"], ["NL", "Netherlands"], ["PT", "Portugal"], ["BR", "Brazil"], ["MX", "Mexico"], ["MA", "Morocco"], ["DZ", "Algeria"],
  ["TN", "Tunisia"], ["EG", "Egypt"], ["SA", "Saudi Arabia"], ["AE", "UAE"]];
const LANGS = [["en", "English"], ["fr", "French"], ["ar", "Arabic"], ["es", "Spanish"], ["de", "German"], ["it", "Italian"], ["pt", "Portuguese"], ["nl", "Dutch"]];
const marketName = (m) => (MARKETS.find(([k]) => k === m) || [m, m])[1];
const MOODS = [["epic", "Epic / cinematic"], ["suspense", "Suspense / dark"], ["phonk", "Phonk"], ["trap", "Trap / hip-hop"], ["upbeat", "Upbeat / energetic"],
  ["emotional", "Emotional / piano"], ["lofi", "Lo-fi / chill"], ["oriental", "Oriental / Arabic"], ["latin", "Latin / Spanish guitar"], ["other", "Other"]];
/** The speed menu, with the voice's own speed when a style set one that isn't listed. */
const rateOptions = (current) => {
  const list = [[0.9, "Slower"], [1, "Normal"], [1.1, "Shorts pace"], [1.2, "Fast"]];
  const rate = Number(current);
  return !rate || list.some(([v]) => v === rate) ? list : [...list, [rate, `${rate}×`]].sort((a, b) => a[0] - b[0]);
};
const DEFAULT_STYLE = { language: "en", voice: "en-US-AndrewNeural-Male", voice_rate: 1, aspect: "9:16", source: "pixabay", bgm: "random", bgm_volume: 0.2,
  clip_duration: 4, captions: { enabled: true, mode: "word_by_word", position: "bottom", color: "#FFFFFF", font_size: 70, stroke_color: "#000000", stroke_width: 2, animation: "pop_spring" } };

// ==================================================================
// State, routing, scope
// ==================================================================
const state = { period: 28, channels: [], niches: [], channel: store.get("ytc.channel", "all"), timer: null };
const view = () => document.getElementById("view");

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, "") || "home";
  const [path, qs] = raw.split("?");
  const parts = path.split("/");
  return { name: parts[0] || "home", id: parts[1] ? decodeURIComponent(parts[1]) : undefined, params: new URLSearchParams(qs || "") };
}
const go = (hash) => { location.hash = hash; };
function link(name, params = {}) {
  const p = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== ""));
  return `#/${name}${p.toString() ? "?" + p : ""}`;
}
function setParams(route, changes) {
  const p = new URLSearchParams(route.params);
  for (const [k, v] of Object.entries(changes)) (v === null || v === undefined || v === "" ? p.delete(k) : p.set(k, v));
  go(`#/${route.name}${route.id ? "/" + encodeURIComponent(route.id) : ""}${p.toString() ? "?" + p : ""}`);
}

const realNiches = () => state.niches.filter((n) => !n.is_explore);
const exploreNiche = () => state.niches.find((n) => n.is_explore);
const nicheName = (id) => state.niches.find((n) => n.id === id)?.name || "—";
const channelById = (id) => state.channels.find((c) => c.id === id);

// Research scope: free global exploration, or the selected channel's niche.
function scopeOf(route) {
  const p = route.params.get("scope");
  if (p === "global") return { global: true, niche: exploreNiche() };
  if (p) { const n = realNiches().find((x) => x.id === p); if (n) return { global: false, niche: n }; }
  const ch = channelById(state.channel);
  const n = ch && realNiches().find((x) => x.id === ch.niche_id);
  return n ? { global: false, niche: n, channel: ch } : { global: true, niche: exploreNiche() };
}
const scopeKey = (scope) => (scope.global ? "global" : scope.niche.id);

async function loadShared() {
  const [channels, niches] = await Promise.all([
    q(sb.from("channels").select("*").order("created_at")),
    q(sb.from("niches").select("*").order("created_at")),
  ]);
  // a network's own name wins over its YouTube channel's title, everywhere in the app
  state.channels = channels.map((c) => ({ ...c, youtube_title: c.title, title: c.network_name || c.title }));
  state.niches = niches;
  if (!state.channels.some((c) => c.id === state.channel)) state.channel = "all";
  renderBus();
}

/** Overview rows, under each network's own name. */
const networkOverview = async (days) => (await q(sb.rpc("channel_overview", { p_days: days }))).map((r) => ({ ...r, title: channelById(r.channel_id)?.title || r.title }));

// The network bus in the top bar: the network you're working on lights up. Research, Ideas, Studio, Publish and Calendar follow it.
function renderBus() {
  const item = (id, label, art) => h("button", { type: "button", class: "bus-item", "aria-pressed": String(state.channel === id), title: label, onclick: () => setChannel(id) },
    art, h("span", { class: "bus-name", text: label }));
  const bus = document.getElementById("bus");
  bus.replaceChildren(h("span", { class: "bus-label", text: "Working on" }),
    item("all", "All networks", h("span", { class: "bus-all" }, icon("i-all"))),
    ...state.channels.map((c) => item(c.id, c.title, c.thumbnail_url ? h("img", { src: c.thumbnail_url, alt: "" }) : h("span", { class: "bus-all", text: c.title.slice(0, 1) }))));
  bus.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
}
function setChannel(id) {
  state.channel = id; store.set("ytc.channel", id); renderBus();
  const route = parseRoute();
  if (route.name === "research" || route.name === "keyword") { go("#/research"); return; }
  if (route.name === "channel" && id !== "all") { go(`#/channel/${id}`); return; }
  render();
}

// Live counts from the last refresh: total views (latest channel snapshot, else the sum of tracked videos), likes, uploads in the last 24 h.
function liveCounts(snaps, vids) {
  const live = {};
  const since = Date.now() - 864e5;
  for (const v of vids) {
    const l = (live[v.channel_id] ||= { views: 0, likes: 0, fresh: 0 });
    l.views += Number(v.views || 0); l.likes += Number(v.likes || 0);
    if (v.published_at && new Date(v.published_at).getTime() > since) l.fresh++;
  }
  const seen = new Set();
  for (const s of snaps) if (!seen.has(s.channel_id)) { seen.add(s.channel_id); (live[s.channel_id] ||= { views: 0, likes: 0, fresh: 0 }).views = Number(s.total_views); }
  return live;
}

const VIEWS = {};
async function render() {
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
  if (state.unmount) { state.unmount(); state.unmount = null; }
  const route = parseRoute();
  const section = { keyword: "research", channel: "channels", edit: "studio" }[route.name] || route.name;  // "automation" = Publishing
  document.querySelectorAll(".side-links a").forEach((a) =>
    a.dataset.route === section ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  const fn = VIEWS[route.name] || VIEWS.home;
  view().replaceChildren(skeleton());
  try {
    const nodes = await fn(route);
    if (parseRoute().name === route.name) { view().replaceChildren(...[nodes].flat().filter(Boolean)); labelTables(view()); }
  } catch (e) {
    console.error(e);
    view().replaceChildren(h("div", { class: "card" }, h("h2", { text: "Something went wrong" }), h("p", { class: "muted", text: e.message || String(e) })));
  }
}
function pageHead(title, subtitle, ...right) {
  return h("header", { class: "head" },
    h("div", { class: "head-text" }, h("h1", { text: title }), subtitle ? h("p", { class: "muted", style: "margin:0", text: subtitle }) : null),
    right.length ? h("div", { class: "row" }, right) : null);
}

async function makeIdea({ title, niche_id, score, sources, channel_id }) {
  const row = await q(sb.from("ideas").insert({ title, niche_id: niche_id || null, score, sources, channel_id: channel_id || null }).select().single());
  toast("Saved to Ideas");
  return row;
}

// ==================================================================
// Home
// ==================================================================
VIEWS.home = async () => {
  const days = state.period;
  const [rows, daily, alerts, ideas, snaps, vids] = await Promise.all([
    networkOverview(days),
    q(sb.rpc("portfolio_daily", { p_days: days })),
    q(sb.from("alerts").select("*").is("resolved_at", null).order("created_at", { ascending: false }).limit(6)),
    q(sb.from("ideas").select("*").in("stage", ["new", "shortlisted"]).order("score", { ascending: false, nullsFirst: false }).limit(5)),
    q(sb.from("channel_snapshots").select("channel_id,total_views,captured_at").order("captured_at", { ascending: false }).limit(300)),
    q(sb.from("v_own_video_latest").select("channel_id,views,likes,published_at")),
  ]);
  const live = liveCounts(snaps, vids);
  const sum = (k) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
  const connected = rows.some((r) => r.connected);
  const kpi = (label, value, d, series) => h("div", { class: "kpi" }, h("div", { class: "label", text: label }), h("div", { class: "value", text: value }),
    h("div", { class: "foot" }, d, series ? spark(series) : null));
  const na = h("span", { class: "flat", text: "connect YouTube" });

  return [
    pageHead("Home", `${rows.length} channels · last ${days} days`,
      seg([[7, "7d"], [28, "28d"], [90, "90d"]], days, (v) => { state.period = v; render(); }, "Period")),
    h("section", { class: "kpis" },
      kpi("Views", fmt(sum("views")), connected ? delta(sum("views"), sum("views_prev")) : na, daily.map((d) => d.views)),
      kpi("Watch hours", fmt(sum("watch_hours")), connected ? delta(sum("watch_hours"), sum("watch_hours_prev")) : na, daily.map((d) => d.watch_hours)),
      kpi("Net subscribers", (sum("subs_net") >= 0 ? "+" : "") + fmt(sum("subs_net")), connected ? delta(sum("subs_net"), sum("subs_net_prev")) : na),
      kpi("Videos published", fmt(sum("uploads")), h("span", { class: "flat", text: `last ${days} days` }))),
    h("p", { class: "muted small note-lag", text: "Views, watch hours and subscribers above come from YouTube Analytics, about 2 days behind. Each channel below shows its live counts from the last refresh." }),
    h("div", { class: "card-head" }, h("h2", { text: "Networks" }), h("a", { href: "#/channels", class: "small", text: "Manage channels" })),
    rows.length ? h("section", { class: "monitors", "aria-label": "Networks" }, rows.map((r) => monitor(r, live[r.channel_id], days)))
      : empty("No networks yet.", h("a", { class: "btn primary", href: "#/channels", text: "Create a network" })),
    h("div", { class: "cols" },
      h("section", { class: "card grow3" }, h("div", { class: "card-head" }, h("h2", { text: "Next ideas" }), h("a", { href: "#/ideas", class: "small", text: "All ideas" })),
        ideas.length ? ideas.map((i) => h("a", { class: "listrow link", href: `#/studio/${i.id}` }, scorePill(i.score),
          h("div", { style: "flex:1 1 220px;min-width:0" }, h("div", { style: "font-weight:500", text: i.title }), h("div", { class: "muted small", text: channelById(i.channel_id)?.title || nicheName(i.niche_id) }))))
          : empty("Search keywords in Research and save the good ones as ideas.", h("a", { class: "btn", href: "#/research", text: "Open Research" }))),
      h("section", { class: "card grow2" }, h("h2", { text: "Alerts" }),
        alerts.length ? alerts.map((a) => h("div", { class: "listrow", style: "flex-wrap:nowrap;align-items:flex-start" },
          h("span", { class: `pill ${a.severity === "critical" ? "crit" : a.severity === "warning" ? "warn" : "info"}`, text: a.severity }),
          h("div", { style: "min-width:0" }, h("div", { style: "font-weight:500", text: a.title }), h("div", { class: "muted small", text: `${a.detail || ""} · ${ago(a.created_at)}` }))))
          : empty("All good, nothing needs attention."))),
  ];
};

// One channel on Home: live counts from the last refresh, lagging Analytics views, monetization progress.
// A red "new today" lamp when something went out in the last 24 h; the channel you're working on is framed in red.
function monitor(r, l = {}, days) {
  const c = channelById(r.channel_id);
  return h("a", { class: `monitor${state.channel === r.channel_id ? " on-air" : ""}`, href: `#/channel/${r.channel_id}` },
    h("div", { class: "mon-head" }, r.thumbnail_url ? h("img", { class: "avatar", src: r.thumbnail_url, alt: "" }) : h("span", { class: "avatar" }),
      h("div", {}, h("div", { class: "mon-name", text: r.title }), h("div", { class: "muted small", text: `${r.niche_name || "No niche"} · ${(r.language || "—").toUpperCase()}` })),
      l.fresh ? h("span", { class: "lamp on", text: l.fresh > 1 ? `${l.fresh} new today` : "New today" }) : r.open_critical ? h("span", { class: "lamp cue", text: "Alert" }) : null),
    h("div", { class: "mon-figs" },
      h("div", {}, h("div", { class: "fig", text: fmtc(l.views ?? null) }), h("span", { text: "Total views" })),
      h("div", {}, h("div", { class: "fig", text: fmtc(l.likes ?? null) }), h("span", { text: "Likes" })),
      h("div", {}, h("div", { class: "fig", text: fmt(r.subscribers) }), h("span", { text: "Subscribers" }))),
    h("div", { class: "mon-foot" },
      h("div", { class: "row" }, h("span", { text: `Views, last ${days} d: ${r.connected ? fmt(r.views) : "—"}` }), h("span", { class: "mono", text: `Updated ${ago(c?.stats_synced_at)}` })),
      r.connected ? [bar(pctOf(r.watch_hours_12m, 8000), null), h("span", { text: `${fmt(r.watch_hours_12m)} of 8,000 watch hours (12 months)` })]
        : h("span", { text: "Public stats only. Connect with Google for analytics." })));
}

// ==================================================================
// Research: search first, then a dedicated keyword page
// ==================================================================
function searchBar(route, scope, initial = {}) {
  const market = initial.market || route.params.get("market") || (scope.global ? "GLOBAL" : scope.niche.markets?.[0] || "GLOBAL");
  const lang = initial.lang || route.params.get("lang") || (scope.global ? "en" : scope.niche.languages?.[0] || "en");
  const input = h("input", { id: "kw-q", class: "field search", type: "search", placeholder: "Search a keyword or topic, e.g. “soueast s06 prix maroc”", value: initial.term || "", autocomplete: "off" });
  const mSel = h("select", { class: "field", "aria-label": "Market" }, MARKETS.map(([v, t]) => h("option", { value: v, selected: v === market, text: t })));
  const lSel = h("select", { class: "field", "aria-label": "Language" }, LANGS.map(([v, t]) => h("option", { value: v, selected: v === lang, text: t })));
  const sSel = h("select", { class: "field", "aria-label": "Scope" },
    h("option", { value: "global", selected: scope.global, text: "Global (any topic)" }),
    realNiches().map((n) => h("option", { value: n.id, selected: !scope.global && scope.niche.id === n.id, text: `Niche: ${n.name}` })));
  return h("form", { class: "searchbar", role: "search", onsubmit: (e) => {
    e.preventDefault();
    const term = input.value.trim().toLowerCase();
    if (term) go(link(`keyword/${encodeURIComponent(term)}`, { market: mSel.value, lang: lSel.value, scope: sSel.value }));
  } },
    h("div", { class: "search-main" }, h("label", { for: "kw-q", class: "sr", text: "Keyword" }), input, h("button", { class: "btn primary", type: "submit", text: "Analyze" })),
    h("div", { class: "search-opts" }, mSel, lSel, sSel));
}

VIEWS.research = async (route) => {
  const scope = scopeOf(route);
  if (!scope.niche) return [empty("The Global scope is missing.")];
  const tab = route.params.get("tab") || "keywords";
  const tabs = h("div", { class: "tabs", role: "tablist" },
    [["keywords", "My searches"], ["outliers", "Outlier videos"], ["rising", "Rising"], ["competitors", "Competitors"]].map(([v, t]) =>
      h("button", { role: "tab", type: "button", "aria-selected": String(v === tab), text: t, onclick: () => setParams(route, { tab: v === "keywords" ? null : v }) })));
  const sub = scope.global ? "Global: explore any topic, any country" : `Scoped to ${scope.niche.name}${scope.channel ? ` (${scope.channel.title})` : ""}`;
  const out = [pageHead("Research", sub), searchBar(route, scope), tabs];

  if (tab === "keywords") {
    const sort = route.params.get("sort") || "recent";
    let kq = sb.from("v_keyword_metrics").select("*").eq("niche_id", scope.niche.id).limit(200);
    kq = sort === "score" ? kq.order("kw_score", { ascending: false }) : sort === "volume" ? kq.order("volume_index", { ascending: false })
      : sort === "easy" ? kq.order("difficulty", { ascending: true }) : kq.order("captured_on", { ascending: false });
    const rows = await q(kq);
    out.push(h("section", { class: "card" },
      h("div", { class: "card-head" }, h("h2", { text: "Keywords you analyzed" }),
        seg([["recent", "Recent"], ["score", "Best score"], ["volume", "Volume"], ["easy", "Easiest"]], sort, (v) => setParams(route, { sort: v }), "Sort")),
      rows.length ? h("div", { class: "tablebox" }, h("table", { style: "min-width:640px" },
        h("thead", {}, h("tr", {}, ["Keyword", "Market", "Volume", "Difficulty", "Score", "Analyzed"].map((t, i) => h("th", { class: i >= 2 && i <= 4 ? "num" : null, text: t })))),
        h("tbody", {}, rows.map((r) => {
          const href = link(`keyword/${encodeURIComponent(r.term)}`, { market: r.market, scope: scopeKey(scope) });
          return h("tr", { class: "clickable", tabindex: "0", onclick: () => go(href), onkeydown: (e) => e.key === "Enter" && go(href) },
            h("td", { style: "font-weight:500", text: r.term }), h("td", { class: "muted", text: marketName(r.market) }),
            h("td", { class: "num", text: volLabel(r.volume_index) }),
            h("td", { class: "num" }, h("span", { style: `color:${diffColor(r.difficulty)};font-weight:500`, text: diffLabel(r.difficulty) })),
            h("td", { class: "num" }, scorePill(r.kw_score)), h("td", { class: "muted", text: r.captured_on }));
        }))))
        : empty("Type a keyword above and press Analyze. Every search lands here.")));
    return out;
  }

  if (tab === "rising") {
    const rows = (await q(sb.from("v_keyword_scores").select("term,market,trends_interest,momentum_raw,score").eq("niche_id", scope.niche.id).not("trends_interest", "is", null).limit(300)))
      .sort((a, b) => b.momentum_raw - a.momentum_raw).slice(0, 18);
    out.push(h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", { text: "Rising searches" }), h("span", { class: "muted small", text: "Google Trends, YouTube Search · last 7 vs 30 days" })),
      rows.length ? h("div", { class: "grid-cards" }, rows.map((r) => { const ch = (Number(r.momentum_raw) - 1) * 100;
        return h("a", { class: "tile", href: link(`keyword/${encodeURIComponent(r.term)}`, { market: r.market, scope: scopeKey(scope) }) },
          h("div", { style: "flex:1;min-width:0" }, h("div", { style: "font-weight:500", text: r.term }), h("div", { class: "muted small", text: `Interest ${fmt(r.trends_interest)}` })),
          h("span", { class: ch >= 0 ? "up" : "down", text: `${ch >= 0 ? "+" : ""}${ch.toFixed(0)}%` })); }))
        : empty(scope.global ? "Rising data comes from the daily Trends job, which runs for your niches. Pick a niche in the scope menu." : "Appears after the daily Trends job runs.")));
    return out;
  }

  if (tab === "competitors") {
    let cq = sb.from("v_competitors").select("*").order("outliers_30d", { ascending: false }).limit(100);
    if (!scope.global) cq = cq.eq("niche_id", scope.niche.id);
    const comps = await q(cq);
    out.push(h("section", { class: "card" }, h("p", { class: "muted small", style: "margin:0", text: "Channels with repeated outlier videos are added automatically by the daily research job." }),
      comps.length ? h("div", { class: "tablebox" }, h("table", { style: "min-width:700px" },
        h("thead", {}, h("tr", {}, ["Channel", "Subscribers", "Outliers (30 d)", "Best video seen", "Views"].map((t, i) => h("th", { class: [1, 2, 4].includes(i) ? "num" : null, text: t })))),
        h("tbody", {}, comps.map((c) => h("tr", {},
          h("td", {}, h("a", { href: `https://www.youtube.com/channel/${c.youtube_channel_id}`, target: "_blank", rel: "noopener", style: "font-weight:500;color:inherit", text: c.title || c.youtube_channel_id })),
          h("td", { class: "num", text: fmtc(c.subscribers) }), h("td", { class: "num", text: fmt(c.outliers_30d) }),
          h("td", { text: c.best_title || "—" }), h("td", { class: "num", text: fmtc(c.best_views) }))))))
        : empty("No competitors tracked yet.")));
    return out;
  }

  // outliers
  const fmtF = route.params.get("format") || "all", win = Number(route.params.get("days") || 30), text = (route.params.get("q") || "").trim();
  let vq = sb.from("v_video_latest").select("*").gte("outlier_score", 3).gte("published_at", new Date(Date.now() - win * 864e5).toISOString())
    .lte("subscribers", 100000).order("outlier_score", { ascending: false }).limit(48);
  if (!scope.global) vq = vq.eq("niche_id", scope.niche.id);
  if (fmtF !== "all") vq = vq.eq("is_short", fmtF === "short");
  if (text) vq = vq.ilike("title", `%${text.replace(/[%_,()]/g, " ")}%`);
  const vids = await q(vq);
  out.push(h("div", { class: "row" },
    h("input", { class: "field", placeholder: "Title contains…", value: text, "aria-label": "Title contains", style: "flex:1 1 220px", onchange: (e) => setParams(route, { q: e.target.value.trim() || null }) }),
    seg([["all", "All"], ["short", "Shorts"], ["long", "Long"]], fmtF, (v) => setParams(route, { format: v }), "Format"),
    selectEl("o-days", [["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"]], String(win), (v) => setParams(route, { days: v }))));
  out.push(vids.length ? h("section", { class: "cards" }, vids.map((v) => videoCard(v, scope)))
    : empty("Videos from channels under 100K subs that got at least 3× their subscriber count. They come from your searches and the daily research job."));
  return out;
};

const youtubeLink = (v) => `https://www.youtube.com/${v.is_short ? "shorts/" : "watch?v="}${v.youtube_video_id}`;

function videoCard(v, scope) {
  return h("article", { class: "vcard" },
    h("a", { class: "thumb", href: youtubeLink(v), target: "_blank", rel: "noopener" },
      v.thumbnail_url ? h("img", { src: v.thumbnail_url, alt: "", loading: "lazy" }) : null,
      h("span", { class: `pill tl ${v.is_short ? "short" : "long"}`, text: v.is_short ? "Short" : "Long" }),
      v.outlier_score ? h("span", { class: "tr", text: `${Number(v.outlier_score).toFixed(1)}×` }) : null),
    h("div", { class: "vbody" },
      h("h3", { text: v.title }),
      h("div", { class: "muted small", text: `${v.channel_title || "—"} · ${fmtc(v.subscribers)} subs · ${ago(v.published_at)}` }),
      h("div", { class: "stats3" },
        h("div", {}, h("span", { text: "Views" }), h("span", { class: "mono", text: fmtc(v.views) })),
        h("div", {}, h("span", { text: "Views / day" }), h("span", { class: "mono", text: fmtc(v.views_per_hour * 24) })),
        h("div", {}, h("span", { text: "Engagement" }), h("span", { class: "mono", text: `${v.engagement_pct ?? "—"}%` }))),
      h("button", { class: "btn small", type: "button", style: "margin-top:auto", text: "Save as idea", onclick: async (e) => {
        e.currentTarget.disabled = true; e.currentTarget.textContent = "Saved ✓";
        const idea = await makeIdea({ title: v.title, niche_id: scope?.global ? null : v.niche_id, channel_id: state.channel !== "all" ? state.channel : null,
          score: Math.min(100, Math.round(40 + Number(v.outlier_score || 0) * 3)), sources: [{ type: "outlier", ref: v.youtube_video_id }] });
        // copy the outlier's details now (title, stats, top comments) so the AI can study its format later
        sb.functions.invoke("ai", { body: { action: "capture", idea_id: idea.id } }).catch(() => {});
      } })));
}

VIEWS.keyword = async (route) => {
  const term = (route.id || "").trim().toLowerCase();
  if (!term) { go("#/research"); return []; }
  const scope = scopeOf(route);
  const market = route.params.get("market") || "GLOBAL";
  const lang = route.params.get("lang") || (scope.global ? "en" : scope.niche.languages?.[0] || "en");

  const loadMetrics = async () => {
    const kw = await q(sb.from("keywords").select("id").eq("niche_id", scope.niche.id).eq("market", market).eq("term", term).maybeSingle());
    const m = kw ? await q(sb.from("v_keyword_metrics").select("*").eq("keyword_id", kw.id).maybeSingle()) : null;
    return { kw, m };
  };
  let { kw, m } = await loadMetrics();
  const analyze = async (force) => {
    view().replaceChildren(searchBar(route, scope, { term, market, lang }),
      h("div", { class: "card analyzing" }, h("div", { class: "spinner", "aria-hidden": "true" }), h("div", {},
        h("h2", { text: `Analyzing “${term}”` }), h("p", { class: "muted", style: "margin:0", text: `Reading YouTube page 1 in ${marketName(market)} and collecting related searches. About 5–10 seconds.` }))));
    const { data, error } = await sb.functions.invoke("keyword-lookup", { body: { term, market, language: lang, niche_id: scopeKey(scope), force } });
    if (error) {
      let msg = error.message;
      try { msg = (await error.context.json()).error || msg; } catch { /* keep message */ }
      throw new Error(msg);
    }
    return data;
  };
  if (!m || m.captured_on !== today()) {
    await analyze(false);
    ({ kw, m } = await loadMetrics());
  }
  if (!m) return [searchBar(route, scope, { term, market, lang }), empty("No result for this keyword.")];

  const [related, links, hist] = await Promise.all([
    q(sb.from("keyword_related").select("term,source,rank").eq("keyword_id", kw.id)),
    q(sb.from("video_keywords").select("youtube_video_id,rank").eq("keyword_id", kw.id).order("rank").limit(20)),
    q(sb.from("keyword_snapshots").select("captured_on,trends_avg_7d").eq("keyword_id", kw.id).not("trends_avg_7d", "is", null).order("captured_on")),
  ]);
  const relTerms = [...new Set(related.map((r) => r.term))];
  const known = relTerms.length ? await q(sb.from("v_keyword_metrics").select("term,volume_index,difficulty,kw_score").eq("niche_id", scope.niche.id).eq("market", market).in("term", relTerms.slice(0, 150))) : [];
  const knownMap = Object.fromEntries(known.map((k) => [k.term, k]));
  const vids = links.length ? await q(sb.from("v_video_latest").select("*").in("youtube_video_id", links.map((l) => l.youtube_video_id))) : [];
  const rankOf = Object.fromEntries(links.map((l) => [l.youtube_video_id, l.rank]));
  vids.sort((a, b) => rankOf[a.youtube_video_id] - rankOf[b.youtube_video_id]);

  const stat = (label, valueNode, sub, meter) => h("div", { class: "stat" }, h("div", { class: "label", text: label }), valueNode, meter || null, h("div", { class: "muted small", text: sub }));
  const head = h("header", { class: "head" },
    h("div", { class: "head-text" }, h("a", { href: link("research", { scope: scopeKey(scope) }), class: "small", text: "← Research" }),
      h("h1", { text: term }), h("p", { class: "muted", style: "margin:0", text: `${marketName(market)} · ${scope.global ? "Global" : scope.niche.name} · analyzed ${m.captured_on}` })),
    h("div", { class: "row" },
      h("button", { class: "btn", type: "button", text: "Re-analyze", onclick: async () => { try { await analyze(true); render(); } catch (e) { toast(e.message); render(); } } }),
      h("button", { class: "btn primary", type: "button", text: "Save as idea", onclick: async () => {
        const idea = await makeIdea({ title: term, niche_id: scope.global ? null : scope.niche.id, score: m.kw_score, channel_id: scope.channel?.id,
          sources: [{ type: "keyword", ref: term, market, volume: m.volume_index, difficulty: m.difficulty }] });
        go(`#/studio/${idea.id}`);
      } })));

  const stats = h("section", { class: "stats" },
    stat("Overall score", scorePill(m.kw_score, true), m.kw_score >= 70 ? "Strong opportunity" : m.kw_score >= 45 ? "Worth testing" : "Weak opportunity"),
    stat("Search volume", h("div", { class: "value", text: volLabel(m.volume_index) }), `Page-1 videos get ~${fmtc(m.views_per_day)} views/day`, bar(m.volume_index, null)),
    stat("Difficulty", h("div", { class: "value", style: `color:${diffColor(m.difficulty)}`, text: diffLabel(m.difficulty) }),
      `Typical channel on page 1: ${fmtc(m.median_subs_top)} subs`, bar(m.difficulty, diffColor(m.difficulty))),
    stat("Competition signals", h("div", { class: "value", text: `${Math.round((m.title_match_share || 0) * 10)}/10` }),
      `titles target this exact keyword · ${Math.round((m.big_share || 0) * 10)}/10 from 100K+ channels · ${m.outlier_count} outliers`));

  const tips = [];
  if (m.title_match_share < 0.4) tips.push("Few page-1 titles use this exact phrase: put it at the start of your title.");
  if (m.fresh_share < 0.3) tips.push("Most page-1 videos are older than 6 months: a fresh video can rank.");
  if (m.outlier_count >= 2) tips.push(`${m.outlier_count} small channels beat their size here: the topic itself pulls views.`);
  if (m.difficulty >= 75) tips.push("Page 1 is dominated by big channels: target a longer, more specific version of this keyword.");
  if (m.volume_index < 20) tips.push("Very little demand: use it as a tag, not as the main topic.");

  const groups = [["all", "All"], ["autocomplete", "Autocomplete"], ["question", "Questions"], ["az", "A–Z"], ["tag", "Tags used by top videos"]];
  const relTab = route.params.get("rel") || "all";
  const relRows = related.filter((r) => relTab === "all" || r.source === relTab)
    .sort((a, b) => { const o = { autocomplete: 0, question: 1, az: 2, tag: 3 };
      return o[a.source] - o[b.source] || (a.source === "tag" ? b.rank - a.rank : a.rank - b.rank); });
  const seen = new Set();
  const relList = relRows.filter((r) => (seen.has(r.term) ? false : seen.add(r.term)));
  const relSection = h("section", { class: "card grow3" },
    h("div", { class: "card-head" }, h("h2", { text: `Related keywords (${relTerms.length})` })),
    h("div", { class: "chips-tabs" }, groups.map(([v, t]) => h("button", { type: "button", class: "chip-tab", "aria-pressed": String(v === relTab), text: t, onclick: () => setParams(route, { rel: v === "all" ? null : v }) }))),
    relList.length ? h("div", { class: "tablebox" }, h("table", { style: "min-width:520px" },
      h("thead", {}, h("tr", {}, ["Keyword", "Found in", "Volume", "Difficulty", "Score"].map((t, i) => h("th", { class: i >= 2 ? "num" : null, text: t })))),
      h("tbody", {}, relList.slice(0, 80).map((r) => {
        const k = knownMap[r.term];
        const href = link(`keyword/${encodeURIComponent(r.term)}`, { market, lang, scope: scopeKey(scope) });
        return h("tr", { class: "clickable", tabindex: "0", onclick: () => go(href), onkeydown: (e) => e.key === "Enter" && go(href) },
          h("td", { style: "font-weight:500", text: r.term }),
          h("td", { class: "muted small", text: { autocomplete: "Autocomplete", question: "Question", az: "A–Z", tag: `Tag ×${r.rank}` }[r.source] }),
          k ? h("td", { class: "num", text: volLabel(k.volume_index) }) : h("td", { class: "num plain muted small", text: "click to analyze" }),
          h("td", { class: "num" }, k ? h("span", { style: `color:${diffColor(k.difficulty)}`, text: diffLabel(k.difficulty) }) : ""),
          h("td", { class: "num" }, k ? scorePill(k.kw_score) : ""));
      }))))
      : empty("No related searches found."),
    h("p", { class: "muted small", style: "margin:0", text: "Opening a related keyword analyzes it (about 100 of your 10,000 daily YouTube API units)." }));

  const side = h("div", { class: "grow2", style: "display:flex;flex-direction:column;gap:22px;min-width:0" },
    tips.length ? h("section", { class: "card" }, h("h2", { text: "What this means" }), h("ul", { class: "tips" }, tips.map((t) => h("li", { text: t })))) : null,
    h("section", { class: "card" }, h("h2", { text: "Interest over time" }),
      hist.length > 1 ? lineChart(hist.map((p) => ({ x: p.captured_on, y: Number(p.trends_avg_7d) })), `Interest over time for ${term}`)
        : h("p", { class: "muted small", style: "margin:0", text: "Google Trends history appears for keywords in your niches once the daily Trends job has run a few times." })));

  const page1 = h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", { text: "YouTube page 1" }), h("span", { class: "muted small", text: "What a viewer sees when searching this keyword" })),
    vids.length ? h("div", { class: "tablebox" }, h("table", { style: "min-width:720px" },
      h("thead", {}, h("tr", {}, ["#", "Video", "Channel", "Subs", "Views", "Views/day", "Age"].map((t, i) => h("th", { class: [3, 4, 5].includes(i) ? "num" : null, text: t })))),
      h("tbody", {}, vids.map((v) => {
        const days = Math.max((Date.now() - new Date(v.published_at)) / 864e5, 1);
        return h("tr", {},
          h("td", { class: "muted", text: String(rankOf[v.youtube_video_id]) }),
          h("td", { style: "max-width:360px" }, h("div", { class: "row", style: "gap:10px;flex-wrap:nowrap" },
            v.thumbnail_url ? h("img", { class: "mini-thumb", src: v.thumbnail_url, alt: "", loading: "lazy" }) : null,
            h("a", { href: youtubeLink(v), target: "_blank", rel: "noopener", style: "color:inherit;font-weight:500", text: v.title }))),
          h("td", { class: "muted", text: v.channel_title || "—" }), h("td", { class: "num", text: fmtc(v.subscribers) }),
          h("td", { class: "num", text: fmtc(v.views) }), h("td", { class: "num", text: fmtc(v.views / days) }), h("td", { class: "muted", text: ago(v.published_at) }));
      }))))
      : empty("No videos found on page 1."));

  return [searchBar(route, scope, { term, market, lang }), head, stats, h("div", { class: "cols" }, relSection, side), page1];
};

// ==================================================================
// AI pipeline (DeepSeek): outlier snapshot -> format blueprint -> new script for the channel
// ==================================================================
async function aiCall(body) {
  const { data, error } = await sb.functions.invoke("ai", { body });
  if (error) { let msg = error.message; try { msg = (await error.context.json()).error || msg; } catch { /* keep */ } throw new Error(msg); }
  if (data?.error) throw new Error(data.error);
  return data;
}
/** Runs the missing steps for an idea. onStep(label) reports progress. Returns the fresh idea row. */
async function generateScript(idea, { channel_id, language, angle, aspect, length, draft } = {}, onStep = () => {}) {
  const isOutlier = (idea.sources || []).some((s) => s.type === "outlier");
  if (isOutlier && !idea.source_video) { onStep("Reading the outlier…"); await aiCall({ action: "capture", idea_id: idea.id }); }
  if (isOutlier && !idea.blueprint) { onStep("Studying its format…"); await aiCall({ action: "blueprint", idea_id: idea.id }); }
  onStep(draft ? "Improving the script…" : "Writing the script…");
  const body = { action: "script", idea_id: idea.id, channel_id: channel_id || idea.channel_id || null, language: language || null, angle: angle || null, aspect: aspect || null, length: length || null, draft: draft || null };
  // the thinking model can outlast one call: then it tries again with less thinking
  try { await aiCall(body); } catch { onStep("Still writing…"); await aiCall({ ...body, effort: "low" }); }
  onStep("Reviewing the script…");
  await aiCall({ action: "review", idea_id: idea.id }).catch(() => null);  // the first draft stands
  return q(sb.from("ideas").select("*").eq("id", idea.id).single());
}

// ==================================================================
// Ideas
// ==================================================================
// One list, one main action per idea, and a lamp saying where each one is: idle, in progress (amber), ready (green), on air (red).
const IDEA_STATES = {
  new: ["To make", "idle"], saved: ["Saved", "cue"], draft: ["Draft", "cue"], failed: ["Needs a retry", "alert"],
  working: ["Working", "cue"], ready: ["Ready", "ready"], check: ["Ready, to check", "cue"], published: ["Published", "on"],
};
const IDEA_TABS = [["all", "All", null], ["make", "To make", ["new", "saved", "draft", "failed"]], ["ready", "Ready", ["ready", "check"]], ["published", "Published", ["published"]]];
const RUN_STEPS = { script: "Writing the script", review: "Reviewing the script", scenes: "Building the scenes", clips: "Choosing the clips", voice: "Recording the voice",
  music: "Finding the music", sounds: "Adding sound effects", thumbnail: "Making the thumbnail", render: "Rendering the video", check: "Final checks" };
const ideasUi = { tab: "all", q: "", sort: "score", selected: new Set(), open: new Set(), fresh: new Set() };
const isActiveRun = (r) => r && ["queued", "running"].includes(r.status);
const runTitle = (r) => r.ideas?.video_title || r.ideas?.title || "Your video";
const isEmptyDraft = (i) => !i.script?.trim() && /^untitled/i.test(i.title || "");

function ideaState(i, run) {
  if (isActiveRun(run)) return "working";
  if (i.stage === "published") return "published";
  if (run?.status === "failed") return "failed";
  if (i.stage === "produced" || i.stage === "scheduled") return run?.status === "review" ? "check" : "ready";
  if (i.stage === "assigned" || i.stage === "scripted") return "draft";
  return i.stage === "shortlisted" ? "saved" : "new";
}

/** Where a run is: a bar, the step it's on and what that step last said. */
function runProgress(run) {
  const steps = (run.steps || []).filter((x) => x.status !== "skipped");
  const done = steps.filter((x) => x.status === "done").length;
  const now = steps.find((x) => x.status === "running");
  const label = run.status === "queued" || !steps.length ? "Starting…" : RUN_STEPS[now?.key] || "Working…";
  return h("div", { class: "run" },
    h("div", { class: "run-bar", role: "progressbar", "aria-label": "Progress", "aria-valuemin": "0", "aria-valuemax": String(steps.length || 10), "aria-valuenow": String(done) }, h("span", { style: `width:${steps.length ? Math.max(4, (done / steps.length) * 100) : 4}%` })),
    h("div", { class: "muted small", role: "status", text: [steps.length ? `Step ${Math.min(done + 1, steps.length)} of ${steps.length}` : "", label, now?.detail].filter(Boolean).join(" · ") }));
}

/** What the creator should look at: the run's warnings, its failed checks and the facts to verify. */
function ideaNotes(i, run) {
  const issues = [...(run?.warnings || []), ...(run?.checks || []).filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`)];
  const facts = i.ai?.verify || [];
  if (!issues.length && !facts.length) return null;
  const count = issues.length + facts.length;
  return h("details", { class: "idea-notes", open: ideasUi.open.has(i.id), ontoggle: (e) => { if (e.target.open) ideasUi.open.add(i.id); else ideasUi.open.delete(i.id); } },
    h("summary", { class: "small", text: `${count} thing${count === 1 ? "" : "s"} to check before publishing` }),
    issues.length ? h("ul", { class: "small" }, issues.map((t) => h("li", { text: t }))) : null,
    facts.length ? h("div", {}, h("div", { class: "eyebrow", text: "Facts to verify" }), h("ul", { class: "small" }, facts.map((t) => h("li", { text: t })))) : null);
}

/** The choices before generating, for one idea or several. Resolves when the runs have started. */
function generateDialog(ideas, onDone) {
  const single = ideas.length === 1 ? ideas[0] : null;
  const start = single?.channel_id || (state.channel !== "all" ? state.channel : ideas.find((i) => i.channel_id)?.channel_id) || "";
  const field = (id, label, el, hint) => h("div", { class: "field-wrap" }, h("label", { for: id, text: label }), el, hint ? h("div", { class: "muted small", text: hint }) : null);
  const f = {};
  f.channel = h("select", { id: "g-channel", class: "field", required: true }, h("option", { value: "", text: "Choose a network" }), state.channels.map((c) => h("option", { value: c.id, selected: c.id === start, text: c.title })));
  f.language = h("select", { id: "g-language", class: "field" }, h("option", { value: "", text: "Network language" }), LANGS.filter(([v]) => VOICES[v]).map(([v, t]) => h("option", { value: v, text: t })));
  f.aspect = h("select", { id: "g-aspect", class: "field" }, [["9:16", "Short / Reel (9:16)"], ["1:1", "Square (1:1)"], ["16:9", "Long video (16:9), not a Short"]].map(([v, t]) => h("option", { value: v, text: t })));
  f.length = h("select", { id: "g-length", class: "field" }, [["short45", "Short, about 45 s"], ["short60", "Short, about 60 s"], ["long3", "Long, about 3 min"]].map(([v, t]) => h("option", { value: v, text: t })));
  f.angle = h("input", { id: "g-angle", class: "field", dir: "auto", placeholder: "Optional: your twist, e.g. make it about what most people get wrong" });
  f.voice = h("select", { id: "g-voice", class: "field" });
  const langNow = () => f.language.value || channelById(f.channel.value)?.video_style?.language || channelById(f.channel.value)?.language || "en";
  const fillVoices = () => f.voice.replaceChildren(h("option", { value: "", text: "Chosen from the subject" }), ...(VOICES[langNow()] || VOICES.en).map(([v, t]) => h("option", { value: v, text: t })));
  fillVoices();
  f.language.addEventListener("change", fillVoices); f.channel.addEventListener("change", fillVoices);
  f.style = h("select", { id: "g-style", class: "field" }, h("option", { value: "", text: "Chosen from the subject" }), Object.entries(PRESETS).map(([k, p]) => h("option", { value: k, text: p.label })));
  f.music = h("input", { type: "checkbox", checked: true }); f.sounds = h("input", { type: "checkbox" });
  f.keep = h("input", { type: "checkbox", checked: true });
  f.next = h("input", { type: "checkbox" });
  const withScript = ideas.filter((i) => i.script?.trim()).length;
  const longNote = h("div", { class: "row", role: "status" }, h("span", { class: "pill warn", text: "Note" }), h("span", { class: "small", text: "A 16:9 video goes to YouTube as a normal video, never as a Short." }));
  const showLong = () => { longNote.style.display = f.aspect.value === "16:9" ? "" : "none"; };
  f.aspect.addEventListener("change", () => { f.length.value = f.aspect.value === "16:9" ? "long3" : "short45"; showLong(); });
  showLong();
  const error = h("p", { class: "small", role: "alert", style: "color:var(--tally);margin:0" });
  const go = h("button", { class: "btn primary", type: "submit", text: single ? "Generate video" : `Generate ${ideas.length} videos` });
  const dialog = h("dialog", { class: "gen-dialog", "aria-labelledby": "gen-title" });
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.append(h("form", { class: "gen-form", onsubmit: async (e) => {
    e.preventDefault();
    if (!f.channel.value) { error.textContent = "Choose a network first."; f.channel.focus(); return; }
    go.disabled = true; go.textContent = "Starting…"; error.textContent = "";
    const options = { language: f.language.value || null, aspect: f.aspect.value, length: f.length.value, angle: single ? f.angle.value.trim() || null : null, voice: f.voice.value || null, voice_style: f.style.value || null,
      music: f.music.checked, sounds: f.sounds.checked, keep_script: f.keep.checked, publish: f.next.checked ? "next" : "ask" };
    const failed = [];
    for (const i of ideas) {
      try {
        // a new idea exists from here on: cancelling the dialog leaves nothing behind
        if (!i.id) i.id = (await q(sb.from("ideas").insert({ title: i.title, channel_id: f.channel.value, sources: [{ type: "manual" }] }).select().single())).id;
        await aiCall({ action: "auto_start", idea_id: i.id, channel_id: f.channel.value, options });
      } catch (err) { failed.push(err.message); }
    }
    if (failed.length) { error.textContent = failed[0]; go.disabled = false; go.textContent = "Try again"; onDone(false); return; }
    toast(single ? "Generating your video" : `Generating ${ideas.length} videos`);
    close(); onDone(true);
  } },
    h("h2", { id: "gen-title", text: single ? "Generate this video" : `Generate ${ideas.length} videos` }),
    h("p", { class: "muted small", style: "margin:0", dir: "auto", text: single ? single.video_title || single.title : "With the same choices for each." }),
    h("div", { class: "form-grid" }, field("g-channel", "Network", f.channel), field("g-language", "Language", f.language), field("g-aspect", "Format", f.aspect), field("g-length", "Length", f.length)),
    longNote,
    single ? field("g-angle", "Angle", f.angle) : null,
    h("div", { class: "form-grid" }, field("g-voice", "Voice", f.voice), field("g-style", "Voice style", f.style)),
    h("div", { class: "gen-checks" },
      h("label", { class: "row ed-check" }, f.music, " Background music that fits the subject"),
      h("label", { class: "row ed-check" }, f.sounds, " Add sound effects where the words call for them"),
      withScript ? h("label", { class: "row ed-check" }, f.keep, single ? " Keep the script I already have" : ` Keep the scripts already written (${withScript})`) : null,
      h("label", { class: "row ed-check" }, f.next, " Schedule it in the next free slot if every check passes")),
    h("p", { class: "muted small", style: "margin:0", text: "It takes a few minutes, and you can leave this page. Unless you tick the last box, it then waits for you to check it." }),
    error,
    h("div", { class: "row gen-actions" }, h("button", { class: "btn ghost", type: "button", text: "Cancel", onclick: close }), go)));
  document.body.append(dialog);
  dialog.addEventListener("cancel", () => dialog.remove());
  dialog.showModal();
}

VIEWS.ideas = async () => {
  const titleIn = h("input", { id: "idea-title", class: "field", dir: "auto", placeholder: "Add an idea, e.g. What if Ronaldo never left Real Madrid?" });
  const list = h("div", { class: "idea-list", "aria-live": "off" });
  const tabs = h("div", { class: "seg idea-tabs", role: "group", "aria-label": "Show" });
  const bulk = h("div", { class: "idea-bulk", role: "toolbar", "aria-label": "Selected ideas" });
  const live = h("section", { class: "idea-live", "aria-label": "Working now" });
  const foot = h("div", { class: "idea-foot" });
  let ideas = [], latest = new Map(), projects = new Map(), active = [];

  const load = async () => {
    let iq = sb.from("ideas").select("*").neq("stage", "archived");
    if (state.channel !== "all") iq = iq.or(`channel_id.eq.${state.channel},channel_id.is.null`);
    const [rows, runs, vids] = await Promise.all([q(iq), q(sb.from("video_runs").select("*, ideas(title, video_title)").order("created_at", { ascending: false }).limit(300)),
      q(sb.from("video_projects").select("id,idea_id,aspect,language").not("idea_id", "is", null).order("created_at", { ascending: false }).limit(500))]);
    ideas = rows;
    latest = new Map(); for (const r of runs) if (!latest.has(r.idea_id)) latest.set(r.idea_id, r);
    // every network's, so a video started for another one can still be followed
    const before = active;
    active = [...latest.values()].filter(isActiveRun);
    for (const old of before) {
      if (active.some((r) => r.id === old.id)) continue;
      const done = runs.find((r) => r.id === old.id);
      if (done?.status === "ready" || done?.status === "review") toast(`Video ready: ${runTitle(done)}`);
      else if (done?.status === "failed") toast(`It stopped: ${runTitle(done)}`);
    }
    projects = new Map(); for (const p of vids) if (!projects.has(p.idea_id)) projects.set(p.idea_id, p);
    for (const id of [...ideasUi.selected]) if (!ideas.some((i) => i.id === id)) ideasUi.selected.delete(id);
  };
  const reload = async () => { await load(); paint(); };
  const update = async (ids, values) => { await q(sb.from("ideas").update(values).in("id", ids)); await reload(); };
  const generate = (group, onStart) => generateDialog(group, (started) => {
    if (started) { ideasUi.selected.clear(); onStart?.(); }
    reload();
  });
  const stopRun = async (run) => { try { await aiCall({ action: "auto_stop", idea_id: run.idea_id, run_id: run.id }); await reload(); } catch (e) { toast(e.message); } };

  const row = (i) => {
    const run = latest.get(i.id);
    const st = ideaState(i, run);
    const [stLabel, lamp] = IDEA_STATES[st];
    const project = projects.get(i.id);
    const ch = channelById(i.channel_id);
    const language = i.ai?.language || project?.language || ch?.video_style?.language || ch?.language;
    const aspect = project?.aspect || i.ai?.aspect;
    const check = h("input", { type: "checkbox", checked: ideasUi.selected.has(i.id), disabled: st === "working", "aria-label": `Select “${i.video_title || i.title}”`, onchange: (e) => { if (e.target.checked) ideasUi.selected.add(i.id); else ideasUi.selected.delete(i.id); paintBulk(); } });
    const studio = h("a", { class: "btn small ghost", href: `#/studio/${i.id}`, text: i.script?.trim() ? "Edit script" : "Write it myself" });
    const genBtn = (text, primary = true) => h("button", { class: `btn small${primary ? " primary" : " ghost"}`, type: "button", text, onclick: () => generate([i]) });
    const archive = h("button", { class: "btn small ghost icon", type: "button", title: "Archive", "aria-label": `Archive “${i.video_title || i.title}”`, onclick: () => update([i.id], { stage: "archived" }) }, icon("i-x"));
    const actions = {
      new: [genBtn("Generate video"), h("button", { class: "btn small ghost", type: "button", text: "Save for later", onclick: () => update([i.id], { stage: "shortlisted" }) }), studio, archive],
      saved: [genBtn("Generate video"), studio, archive], draft: [genBtn("Generate video"), studio, archive],
      failed: [genBtn("Try again"), studio, archive],
      working: [],
      ready: [project ? h("a", { class: "btn small primary", href: `#/edit/${project.id}?tab=publish`, text: "Review video" }) : studio, genBtn("Generate again", false),
        h("button", { class: "btn small ghost", type: "button", text: "Mark published", onclick: () => update([i.id], { stage: "published" }) }), archive],
      published: [project ? h("a", { class: "btn small ghost", href: `#/edit/${project.id}?tab=publish`, text: "Open" }) : studio, archive],
    };
    actions.check = actions.ready;
    return h("article", { class: "idea", "data-state": st },
      h("div", { class: "idea-pick" }, check, scorePill(i.score)),
      h("div", { class: "idea-main" },
        h("a", { class: "title", dir: "auto", href: `#/studio/${i.id}`, text: i.video_title || i.title }),
        h("div", { class: "idea-meta muted small" },
          h("span", { text: ch?.title || "No network yet" }), language ? h("span", { text: language.toUpperCase() }) : null, aspect ? h("span", { text: aspect }) : null,
          (i.sources || []).some((x) => x.type === "outlier") ? h("span", { class: "pill short", title: "Saved from an outlier video", text: "Outlier" }) : null,
          i.source_video?.url ? h("a", { href: i.source_video.url, target: "_blank", rel: "noopener", text: "Source" }) : null,
          h("span", { text: ago(i.created_at) })),
        st === "failed" ? h("p", { class: "small idea-error", role: "alert", text: run.error || "It stopped before the end." }) : null,
        i.ai_status === "failed" && st !== "failed" && st !== "working" ? h("p", { class: "small idea-error", role: "alert", text: i.ai_error || "The AI failed." }) : null,
        ["ready", "check", "published"].includes(st) ? ideaNotes(i, run) : null),
      h("div", { class: "idea-side" },
        h("span", { class: "idea-lamp small", "data-lamp": lamp, text: stLabel }),
        h("div", { class: "idea-acts" }, actions[st])));
  };

  const paintBulk = () => {
    const picked = ideas.filter((i) => ideasUi.selected.has(i.id));
    bulk.hidden = !picked.length;
    bulk.replaceChildren(h("strong", { class: "small", text: `${picked.length} selected` }),
      h("button", { class: "btn small primary", type: "button", text: picked.length === 1 ? "Generate video" : `Generate ${picked.length} videos`, onclick: () => generate(picked) }),
      h("button", { class: "btn small", type: "button", text: "Save for later", onclick: () => update(picked.map((i) => i.id), { stage: "shortlisted" }) }),
      h("button", { class: "btn small", type: "button", text: "Archive", onclick: () => { if (confirm(`Archive ${picked.length} idea${picked.length === 1 ? "" : "s"}?`)) { ideasUi.selected.clear(); update(picked.map((i) => i.id), { stage: "archived" }); } } }),
      h("button", { class: "btn small ghost", type: "button", text: "Clear", onclick: () => { ideasUi.selected.clear(); paint(); } }));
  };
  const paintLive = () => {
    live.hidden = !active.length;
    live.replaceChildren(
      h("div", { class: "idea-live-head" }, h("h2", { text: "Working now" }), h("span", { class: "muted small", text: "You can leave this page: it carries on." })),
      ...active.map((r) => h("div", { class: "idea-live-run" },
        h("div", { class: "idea-live-main" },
          h("a", { class: "title", dir: "auto", href: `#/studio/${r.idea_id}`, text: runTitle(r) }),
          h("div", { class: "muted small", text: channelById(r.channel_id)?.title || "" }),
          runProgress(r)),
        h("button", { class: "btn small ghost", type: "button", text: "Stop", onclick: () => stopRun(r) }))));
  };
  function paint() {
    paintLive();
    const working = (i) => isActiveRun(latest.get(i.id));
    const real = ideas.filter((i) => !isEmptyDraft(i) && !working(i));
    const stateOf = (i) => ideaState(i, latest.get(i.id));
    const count = (states) => (states ? real.filter((i) => states.includes(stateOf(i))).length : real.length);
    tabs.replaceChildren(...IDEA_TABS.map(([k, label, states]) => h("button", { type: "button", "aria-pressed": String(ideasUi.tab === k), onclick: () => { ideasUi.tab = k; paint(); } }, label, " ", h("span", { class: "mono small", text: String(count(states)) }))));
    const states = IDEA_TABS.find(([k]) => k === ideasUi.tab)?.[2];
    const words = ideasUi.q.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = real.filter((i) => (!states || states.includes(stateOf(i))) && words.every((w) => `${i.video_title || ""} ${i.title || ""} ${channelById(i.channel_id)?.title || ""}`.toLowerCase().includes(w)));
    const newest = (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at);
    const order = ideasUi.sort === "newest" ? newest : (a, b) => (b.score ?? -1) - (a.score ?? -1) || newest(a, b);
    // an idea just added stays in sight, whatever its score
    shown.sort((a, b) => Number(ideasUi.fresh.has(b.id)) - Number(ideasUi.fresh.has(a.id)) || order(a, b));
    list.replaceChildren(...(shown.length ? shown.map(row) : [empty(real.length ? "No idea matches." : active.length ? "Everything here is being generated." : "No ideas yet. Add one above, or save one from Research.", real.length || active.length ? null : h("a", { class: "btn", href: "#/research", text: "Go to Research" }))]));
    const drafts = ideas.filter(isEmptyDraft);
    foot.replaceChildren(...(drafts.length ? [h("span", { class: "muted small", text: `${drafts.length} empty draft${drafts.length === 1 ? "" : "s"} hidden` }),
      h("button", { class: "btn small ghost", type: "button", text: "Archive them", onclick: () => update(drafts.map((i) => i.id), { stage: "archived" }) })] : []));
    paintBulk();
    // live while something is working, and quiet otherwise
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    if (active.length) state.timer = setInterval(() => reload().catch(() => {}), 6000);
  }

  const showAll = () => { ideasUi.tab = "all"; ideasUi.q = ""; search.value = ""; };
  const add = async (thenGenerate) => {
    const title = titleIn.value.trim();
    if (!title) { titleIn.focus(); return; }
    // the words stay in the box until the video really starts
    if (thenGenerate) { generate([{ title, channel_id: state.channel !== "all" ? state.channel : null }], () => { titleIn.value = ""; }); return; }
    const made = await makeIdea({ title, channel_id: state.channel !== "all" ? state.channel : null, sources: [{ type: "manual" }] });
    titleIn.value = "";
    ideasUi.fresh.add(made.id);
    showAll();
    await reload();
  };
  const addForm = h("form", { class: "add-idea", onsubmit: (e) => { e.preventDefault(); add(true); } },
    h("label", { for: "idea-title", class: "sr", text: "Idea title" }), titleIn,
    h("button", { class: "btn", type: "button", text: "Add idea", onclick: () => add(false) }),
    h("button", { class: "btn primary", type: "submit", text: "Add and generate" }));
  const search = h("input", { class: "field idea-search", type: "search", "aria-label": "Search ideas", placeholder: "Search ideas", value: ideasUi.q, oninput: (e) => { ideasUi.q = e.target.value; paint(); } });
  const sort = h("select", { class: "field idea-sort", "aria-label": "Sort", onchange: (e) => { ideasUi.sort = e.target.value; paint(); } }, [["score", "Best score"], ["newest", "Newest"]].map(([v, t]) => h("option", { value: v, selected: ideasUi.sort === v, text: t })));

  await load();
  paint();
  return [pageHead("Ideas", state.channel !== "all" ? `For ${channelById(state.channel)?.title} and unassigned ideas` : "All networks"),
    addForm, live, h("div", { class: "idea-tools" }, tabs, h("div", { class: "row idea-filter" }, search, sort)), bulk, list, foot];
};

// ==================================================================
// Studio: script -> render -> download (MoneyPrinterTurbo on GitHub Actions)
// ==================================================================
VIEWS.studio = async (route) => {
  if (route.id) return studioEditor(route.id);
  // every video belongs to a network: choose it first
  if (state.channel === "all") {
    return [pageHead("Studio", "Which network are you working on?"),
      state.channels.length ? h("section", { class: "grid-cards wide" }, state.channels.map((c) => h("button", { class: "ch-card net-pick", type: "button", onclick: () => setChannel(c.id) },
        h("div", { class: "row", style: "gap:12px;flex-wrap:nowrap" }, c.thumbnail_url ? h("img", { class: "avatar", src: c.thumbnail_url, alt: "" }) : h("span", { class: "avatar" }),
          h("div", { style: "min-width:0;text-align:left" }, h("div", { style: "font-weight:600", text: c.title }), h("div", { class: "muted small", text: `${state.niches.find((n) => n.id === c.niche_id)?.name || "No niche"} · ${(c.language || "—").toUpperCase()}` }))))))
        : empty("No networks yet.", h("a", { class: "btn primary", href: "#/channels", text: "Create a network" }))];
  }
  let iq = sb.from("ideas").select("*").in("stage", ["shortlisted", "assigned", "scripted", "produced", "scheduled"]).order("updated_at", { ascending: false });
  if (state.channel !== "all") iq = iq.eq("channel_id", state.channel);
  const [ideas, jobs] = await Promise.all([q(iq), q(sb.from("render_jobs").select("*").eq("channel_id", state.channel).order("created_at", { ascending: false }).limit(15))]);
  const newBtn = h("button", { class: "btn primary", type: "button", text: "+ New video", onclick: async () => {
    const idea = await q(sb.from("ideas").insert({ title: "Untitled video", stage: "assigned", channel_id: state.channel !== "all" ? state.channel : null, sources: [{ type: "manual" }] }).select().single());
    go(`#/studio/${idea.id}`);
  } });
  return [
    pageHead("Studio", "Write the script, pick the style, render the video.", newBtn),
    h("section", { class: "card" }, h("h2", { text: "Projects" }),
      ideas.length ? ideas.map((i) => h("a", { class: "listrow link", href: `#/studio/${i.id}` },
        h("span", { class: `pill ${i.stage === "produced" || i.stage === "scheduled" ? "ok" : i.script ? "info" : "warn"}`, text: i.stage === "produced" || i.stage === "scheduled" ? "Rendered" : i.script ? "Scripted" : "No script" }),
        h("div", { style: "flex:1 1 240px;min-width:0" }, h("div", { style: "font-weight:500", text: i.video_title || i.title }), h("div", { class: "muted small", text: channelById(i.channel_id)?.title || "No channel" })),
        h("span", { class: "muted small", text: ago(i.updated_at) })))
        : empty("No projects yet. Shortlist an idea or start a new video.")),
    h("section", { class: "card" }, h("h2", { text: "Recent renders" }), jobs.length ? jobs.map((j) => renderRow(j)) : empty("Nothing rendered yet.")),
  ];
};

function renderRow(j) {
  const cls = { done: "ok", failed: "crit", running: "info", dispatched: "info", queued: "warn" }[j.status];
  const label = { done: "Ready", failed: "Failed", running: "Rendering…", dispatched: "Starting…", queued: "Queued" }[j.status];
  const preview = h("div", {});
  const row = h("div", { class: "listrow", style: "align-items:flex-start" },
    h("span", { class: `pill ${cls}`, text: label }),
    h("div", { style: "flex:1 1 260px;min-width:0;display:flex;flex-direction:column;gap:6px" },
      h("div", { style: "font-weight:500", text: (j.params?.title || "Video") + ` · ${j.params?.aspect || "9:16"}` }),
      h("div", { class: "muted small", text: `${when(j.created_at)}${j.duration_s ? ` · ${Math.round(j.duration_s)} s` : ""}` }),
      j.error ? h("pre", { class: "err", text: j.error }) : null, preview),
    h("div", { class: "row" },
      j.status === "done" ? h("button", { class: "btn small", type: "button", text: "Preview", onclick: async (e) => {
        const button = e.currentTarget;
        const url = await videoLink(j);
        if (url) { preview.replaceChildren(h("video", { class: "player", src: url, controls: true, playsinline: true })); button.remove(); }
      } }) : null,
      j.status === "done" ? h("button", { class: "btn small primary", type: "button", text: "Download", onclick: async () => {
        const url = await videoLink(j, true);
        if (url) location.href = url;
      } }) : null,
      j.status === "done" && j.project_id ? h("a", { class: "btn small", href: `#/edit/${j.project_id}?tab=publish`, text: "Publish" }) : null,
      j.status === "failed" ? h("button", { class: "btn small", type: "button", text: "Retry", onclick: async () => {
        const { error } = await sb.functions.invoke("render", { body: { retry: j.id } }); toast(error ? "Retry failed" : "Render restarted"); render();
      } }) : null,
      j.run_url ? h("a", { class: "btn small ghost", href: j.run_url, target: "_blank", rel: "noopener", text: "Log" }) : null));
  return row;
}

/** A link to a final video: on the VDS ("vds:" paths, signed by the studio function) or in Supabase Storage. */
async function videoLink(j, download) {
  if (String(j.output_path).startsWith("vds:")) {
    const { data, error } = await sb.functions.invoke("studio", { body: { action: "video_link", job_id: j.id, download: !!download } });
    if (error || !data?.url) { toast(data?.error || "Couldn't open the video"); return null; }
    return data.url;
  }
  const { data } = await sb.storage.from("renders").createSignedUrl(j.output_path, 3600, download ? { download: `${(j.params?.title || "video").replace(/[^\w-]+/g, "_").slice(0, 60)}.mp4` } : undefined);
  return data?.signedUrl;
}

// Language, voice, speed and format on screen when an AI run re-renders the script page, so they survive it.
const studioPicks = new Map();
async function studioEditor(ideaId) {
  const idea = await q(sb.from("ideas").select("*").eq("id", ideaId).maybeSingle());
  if (!idea) return [empty("Project not found.", h("a", { class: "btn", href: "#/studio", text: "Back to Studio" }))];
  const [projects, jobs] = await Promise.all([
    q(sb.from("video_projects").select("*").eq("idea_id", ideaId).order("updated_at", { ascending: false }).limit(1)),
    q(sb.from("render_jobs").select("*").eq("idea_id", ideaId).is("project_id", null).order("created_at", { ascending: false }).limit(5)),
  ]);
  const project = projects[0] || null;
  const ch = channelById(idea.channel_id);
  const style = { language: ch?.language || "en", voice: "en-US-AndrewNeural-Male", voice_rate: 1.1, aspect: "9:16", ...(ch?.video_style || {}),
    // an AI script was written for a language and format: the page stays on them
    ...(idea.ai?.language ? { language: idea.ai.language } : {}), ...(idea.ai?.aspect ? { aspect: idea.ai.aspect } : {}),
    ...(project ? { language: project.language, voice: project.voice, voice_rate: Number(project.voice_rate), aspect: project.aspect } : {}),
    ...(studioPicks.get(ideaId) || {}) };

  const f = {};
  const field = (id, label, el, hint) => h("div", { class: "field-wrap" }, h("label", { for: id, text: label }), el, hint ? h("div", { class: "muted small", text: hint }) : null);
  f.title = h("input", { id: "s-title", class: "field", dir: "auto", value: project?.title || idea.video_title || idea.title });
  f.channel = h("select", { id: "s-channel", class: "field" }, h("option", { value: "", text: "No network" }), state.channels.map((c) => h("option", { value: c.id, selected: c.id === (idea.channel_id || (state.channel !== "all" ? state.channel : null)), text: c.title })));
  f.script = h("textarea", { id: "s-script", class: "field script", rows: "14", dir: "auto", value: idea.script || "",
    placeholder: "One line = one scene. First line = the hook.\nAdd footage words in brackets at the end of a line:\n\nWhat if Lamine Yamal signed for Real Madrid? [football stadium night, crowd cheering]\nThe Bernabéu explodes. [stadium fireworks]\n\nOr one block per scene (every line but VO is optional):\n\nTITLE: YAMAL TO MADRID?\nVO: What if Lamine Yamal signed for Real Madrid?\nFOOTAGE: image: Lamine Yamal | video: football stadium night\nCARD: Lamine Yamal | 19 goals | #A50044 #004D98" });
  const counter = h("div", { class: "muted small" });
  const updateCount = () => {
    // voice lines only: VO: lines and plain lines; TITLE / FOOTAGE / CARD lines are not spoken
    const voice = f.script.value.split("\n").map((l) => l.trim()).filter((l) => l && !/^(TITLE|FOOTAGE|CARD)\s*:/i.test(l))
      .map((l) => l.replace(/^(VO|VOICE)\s*:\s*/i, "").replace(/\[[^\]]*\]\s*$/, "")).filter((l) => l.trim());
    const w = voice.join(" ").trim().split(/\s+/).filter(Boolean).length;
    counter.textContent = `${voice.length} scene${voice.length === 1 ? "" : "s"} · ${w} words · about ${Math.round(w / 2.6)} s of voice`;
  };
  f.script.addEventListener("input", updateCount); updateCount();
  f.terms = h("input", { id: "s-terms", class: "field", value: (idea.search_terms || []).join(", "), placeholder: "e.g. football stadium, night city, car showroom" });
  f.language = h("select", { id: "s-lang", class: "field" }, LANGS.filter(([v]) => VOICES[v]).map(([v, t]) => h("option", { value: v, selected: v === style.language, text: t })));
  f.voice = h("select", { id: "s-voice", class: "field" });
  const fillVoices = () => { const list = VOICES[f.language.value] || VOICES.en; f.voice.replaceChildren(...list.map(([v, t]) => h("option", { value: v, selected: v === style.voice, text: t }))); };
  f.language.addEventListener("change", fillVoices); fillVoices();
  f.rate = h("select", { id: "s-rate", class: "field" }, rateOptions(style.voice_rate).map(([v, t]) => h("option", { value: v, selected: Number(style.voice_rate) === v, text: t })));
  const startFx = voiceFx(project ? project.settings : ch?.video_style?.editor);
  const startStyle = studioPicks.get(ideaId)?.voice_style || startFx.style;
  f.voiceStyle = h("select", { id: "s-voice-style", class: "field" },
    Object.entries(PRESETS).map(([k, p]) => h("option", { value: k, selected: k === startStyle, text: p.label })),
    startStyle === "custom" ? h("option", { value: "custom", selected: true, text: "Custom (set in the editor)" }) : null);
  f.voiceStyle.addEventListener("change", () => {
    const rate = PRESETS[f.voiceStyle.value]?.rate;
    if (!rate) return;
    if (![...f.rate.options].some((o) => Number(o.value) === rate)) f.rate.append(h("option", { value: rate, text: `${rate}×` }));
    f.rate.value = String(rate);
  });
  const pickedFx = () => (f.voiceStyle.value === "custom" ? startFx : presetFx(f.voiceStyle.value));
  const listen = h("button", { class: "btn small", type: "button", text: "▶ Listen", onclick: async () => {
    try { listen.textContent = (await playSample(sampleUrl(f.language.value, f.voice.value, f.voiceStyle.value))) ? "■ Stop" : "▶ Listen"; }
    catch (e) { listen.textContent = "▶ Listen"; if (e.name !== "AbortError") toast("This sample isn't available yet."); }
  } });
  for (const el of [f.language, f.voice, f.voiceStyle]) el.addEventListener("change", () => { listen.textContent = "▶ Listen"; });
  f.aspect = h("select", { id: "s-aspect", class: "field" }, [["9:16", "Short / Reel (9:16)"], ["16:9", "Long video (16:9), not a Short"], ["1:1", "Square (1:1)"]].map(([v, t]) => h("option", { value: v, selected: v === style.aspect, text: t })));
  f.desc = h("textarea", { id: "s-desc", class: "field", rows: "3", dir: "auto", value: idea.video_description || "" });
  f.tags = h("input", { id: "s-tags", class: "field", value: (idea.video_tags || []).join(", ") });

  const terms = () => f.terms.value.split(",").map((t) => t.trim()).filter(Boolean);
  // AI suggestions (hook text, music mood) go into the editor settings unless the project already has its own
  const withAi = (settings) => {
    const ai = idea.ai || {};
    const out = JSON.parse(JSON.stringify(settings || {}));
    if (ai.hook_text && !out.hook?.text) out.hook = { enabled: true, ...(out.hook || {}), text: ai.hook_text };
    if (ai.music_mood && ai.music_mood !== "none" && (!out.music || !out.music.mood || out.music.mood === "none")) out.music = { volume: 0.22, start: 0, ...(out.music || {}), mood: ai.music_mood, track_id: null };
    return out;
  };
  const save = async (quiet) => {
    const early = ["new", "shortlisted", "assigned"].includes(idea.stage);
    const stage = early ? (f.script.value.trim() ? "scripted" : "assigned") : idea.stage;
    const title = f.title.value.trim();
    await q(sb.from("ideas").update({ video_title: title, title: idea.title === "Untitled video" ? title : idea.title, channel_id: f.channel.value || null,
      script: f.script.value.trim(), search_terms: terms(), video_description: f.desc.value, video_tags: f.tags.value.split(",").map((t) => t.trim()).filter(Boolean), stage }).eq("id", ideaId));
    idea.stage = stage;
    if (!quiet) toast("Saved");
  };
  const build = async (btn) => {
    if (!f.script.value.trim()) return toast("Write the voice-over first: one line per scene.");
    btn.disabled = true; btn.textContent = "Building scenes…";
    try {
      await save(true);
      const chosen = channelById(f.channel.value);
      const { data, error } = await sb.functions.invoke("studio", { body: {
        action: "build", project_id: project?.id || null, idea_id: ideaId, channel_id: f.channel.value || null,
        title: f.title.value.trim(), script: f.script.value, language: f.language.value, voice: f.voice.value, voice_rate: Number(f.rate.value), aspect: f.aspect.value,
        settings: { ...withAi(project?.settings || chosen?.video_style?.editor || {}), voice_fx: pickedFx() }, default_terms: terms(),
      } });
      if (error) { let msg = error.message; try { msg = (await error.context.json()).error || msg; } catch { /* keep */ } throw new Error(msg); }
      if (data.error) toast(data.error);
      else if (!data.footage) toast("Scenes ready. Stock clip search isn't set up yet (PEXELS_API_KEY or PIXABAY_API_KEY in Supabase).");
      go(`#/edit/${data.project_id}`);
    } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = project ? "Rebuild scenes →" : "Create scenes →"; }
  };
  const buildBtn = h("button", { class: "btn primary", type: "button", text: project ? "Rebuild scenes →" : "Create scenes →", onclick: (e) => build(e.currentTarget) });
  const saveStyle = h("button", { class: "btn small ghost", type: "button", text: "Use as this network’s default voice & format", onclick: async () => {
    if (!f.channel.value) return toast("Pick a network first");
    const cur = channelById(f.channel.value)?.video_style || {};
    await q(sb.from("channels").update({ video_style: { ...cur, language: f.language.value, voice: f.voice.value, voice_rate: Number(f.rate.value), aspect: f.aspect.value, editor: { ...(cur.editor || {}), voice_fx: pickedFx() } } }).eq("id", f.channel.value));
    await loadShared(); toast("Saved as this network's default");
  } });

  const aiPanel = studioAiPanel(idea, f, buildBtn, save);

  const flow = h("ol", { class: "flow", "aria-label": "Steps" },
    h("li", { "aria-current": "step" }, h("span", { text: "1. Script" })),
    h("li", {}, project ? h("a", { href: `#/edit/${project.id}`, text: "2. Scenes & style" }) : h("span", { class: "muted", text: "2. Scenes & style" })),
    h("li", {}, project ? h("a", { href: `#/edit/${project.id}`, text: "3. Render" }) : h("span", { class: "muted", text: "3. Render" })),
    h("li", {}, project ? h("a", { href: `#/edit/${project.id}?tab=publish`, text: "4. Publish" }) : h("span", { class: "muted", text: "4. Publish" })));
  // a new video follows the network it's for, until you change something yourself
  f.channel.addEventListener("change", () => {
    const style = channelById(f.channel.value)?.video_style;
    if (project || !style) return;
    if (style.language) { f.language.value = style.language; fillVoices(); }
    if (style.voice) f.voice.value = style.voice;
    if (style.voice_rate) { if (![...f.rate.options].some((o) => Number(o.value) === Number(style.voice_rate))) f.rate.append(h("option", { value: style.voice_rate, text: `${style.voice_rate}×` })); f.rate.value = String(style.voice_rate); }
    if (style.aspect) { f.aspect.value = style.aspect; f.aspect.dispatchEvent(new Event("change")); }
    const fx = voiceFx(style.editor);
    if (PRESETS[fx.style]) f.voiceStyle.value = fx.style;
  });
  return [flow,
    h("header", { class: "head" }, h("div", { class: "head-text" }, h("a", { href: "#/studio", class: "small", text: "← Studio" }), h("h1", { text: project?.title || idea.video_title || idea.title }))),
    aiPanel,
    h("section", { class: "card" }, h("h2", { text: "Your script" }),
      field("s-title", "Video title", f.title), field("s-script", "Voice-over · one line per scene, or TITLE / VO / FOOTAGE / CARD blocks", f.script), counter,
      h("details", {}, h("summary", { class: "small", text: "Footage and format tips" }),
        h("p", { class: "muted small", text: "FOOTAGE: “image: …” searches real photos (Wikimedia Commons, Pexels, Unsplash, Pixabay), “video: …” searches clips. CARD: name | stat | two colours, shown as an animated card." }),
        field("s-terms", "Default footage searches (used for lines without [brackets])", f.terms, "English visual words work best: “crowd cheering”, “red sports car”."))),
    h("section", { class: "card" }, h("h2", { text: "Voice" }),
      h("div", { class: "form-grid" }, field("s-voice", "Voice", f.voice), field("s-voice-style", "Voice style", f.voiceStyle), field("s-rate", "Voice speed", f.rate)),
      h("div", { class: "row" }, listen, saveStyle),
      h("p", { class: "muted small", style: "margin:0", text: "Captions, hook text, music, sound effects and the thumbnail are set in the next step." })),
    h("details", { class: "card" }, h("summary", { text: "Description and tags" }),
      field("s-desc", "Description", f.desc), field("s-tags", "Tags (comma-separated)", f.tags),
      h("p", { class: "muted small", style: "margin:0", text: "Turn on “Altered or synthetic content” when uploading videos with realistic AI visuals of real people." })),
    h("div", { class: "studio-actions" },
      h("span", { class: "muted small", text: project ? "Rebuilding keeps the voice and clip of every line you didn't change." : "Next: scenes, style, render and publish." }),
      h("div", { class: "row" }, h("button", { class: "btn", type: "button", text: "Save", onclick: () => save(false) }),
        project ? h("a", { class: "btn", href: `#/edit/${project.id}`, text: "Open editor" }) : null, buildBtn)),
    jobs.length ? h("section", { class: "card" }, h("h2", { text: "Earlier quick renders" }), jobs.map((j) => renderRow(j))) : null,
  ];
}

// "AI script" card on the script page: the outlier it copies the format of, its blueprint, and the generator.
function studioAiPanel(idea, f, buildBtn, save) {
  const src = idea.source_video;
  const bp = idea.blueprint;
  const ai = idea.ai;
  const isOutlier = (idea.sources || []).some((x) => x.type === "outlier");
  const angle = h("input", { id: "ai-angle", class: "field", dir: "auto", placeholder: "Optional: your twist, e.g. “make it about Real Madrid instead of Barça”" });
  const transcript = h("textarea", { id: "ai-transcript", class: "field", rows: "4", dir: "auto", value: idea.transcript || "",
    placeholder: "Optional: on YouTube open the video → ··· → Show transcript, copy it and paste it here. The AI then copies the structure more precisely.",
    onchange: async (e) => { await q(sb.from("ideas").update({ transcript: e.target.value.trim() || null, blueprint: null }).eq("id", idea.id)); idea.transcript = e.target.value; idea.blueprint = null; toast("Transcript saved"); } });
  const aspectNote = h("div", { class: "row", role: "status" }, h("span", { class: "pill warn", text: "Note" }), h("span", { class: "small", text: "A 16:9 video goes to YouTube as a normal video, never as a Short. For a Short, choose 9:16." }));
  const showAspectNote = () => { aspectNote.style.display = f.aspect.value === "16:9" ? "" : "none"; };
  f.aspect.addEventListener("change", showAspectNote);
  showAspectNote();
  const lengthFor = () => (f.aspect.value === "16:9" ? "long3" : "short45");
  const length = h("select", { id: "ai-length", class: "field", onchange: (e) => { e.currentTarget.dataset.picked = "1"; } },
    [["short45", "Short, about 45 s"], ["short60", "Short, about 60 s"], ["long3", "Long, about 3 min"]].map(([v, t]) => h("option", { value: v, selected: v === (ai?.length || lengthFor()), text: t })));
  f.aspect.addEventListener("change", () => { if (!length.dataset.picked) length.value = lengthFor(); });
  const status = h("span", { class: "muted small", role: "status" });
  const busy = (on) => [genBtn, goBtn, improveBtn, restoreBtn].forEach((b) => { if (b) b.disabled = on; });
  const run = async ({ thenBuild = false, improve = false } = {}) => {
    if (!f.channel.value) return toast("Pick the network first: the script is written for its audience.");
    busy(true);
    try {
      // saved first, so Improve and Restore work from exactly what is on screen now
      if (f.script.value.trim()) await save(true);
      await q(sb.from("ideas").update({ channel_id: f.channel.value }).eq("id", idea.id));
      const fresh = await generateScript({ ...idea, channel_id: f.channel.value }, { channel_id: f.channel.value, language: f.language.value, angle: angle.value.trim(), aspect: f.aspect.value, length: length.value, draft: improve ? f.script.value.trim() : "" }, (t) => { status.textContent = t; });
      Object.assign(idea, fresh);
      f.title.value = fresh.video_title || f.title.value;
      f.script.value = fresh.script || ""; f.script.dispatchEvent(new Event("input"));
      f.desc.value = fresh.video_description || ""; f.tags.value = (fresh.video_tags || []).join(", ");
      f.terms.value = (fresh.search_terms || []).join(", ");
      status.textContent = "";
      if (thenBuild) { busy(false); buildBtn.click(); return; }
      studioPicks.set(idea.id, { language: f.language.value, voice: f.voice.value, voice_rate: Number(f.rate.value), aspect: f.aspect.value, voice_style: f.voiceStyle.value });
      toast(improve ? "Script improved: check it, then continue at the bottom" : "Script ready: check it, then continue at the bottom"); render();
    } catch (e) { status.textContent = ""; toast(e.message); busy(false); }
  };
  const genBtn = h("button", { class: `btn ${idea.script ? "" : "primary"}`, type: "button", text: idea.script ? "Regenerate script" : "✨ Generate script", onclick: () => run() });
  const goBtn = h("button", { class: "btn primary", type: "button", text: "✨ Generate & build video", onclick: () => run({ thenBuild: true }) });
  const improveBtn = h("button", { class: "btn", type: "button", text: "Improve current", title: "Keeps what works in the script below and fixes weak hooks and pacing", hidden: !f.script.value.trim(), onclick: () => run({ improve: true }) });
  f.script.addEventListener("input", () => { improveBtn.hidden = !f.script.value.trim(); });
  // ideas.ai.previous: the version the last AI run replaced
  const restoreBtn = ai?.previous ? h("button", { class: "btn ghost", type: "button", text: "Restore previous script", title: "Go back to the script from before the last AI run", onclick: async () => {
    if (!confirm("Go back to the script from before the last AI run? The current script will be replaced.")) return;
    const { script, video_title, video_description, video_tags, search_terms, ai: before } = ai.previous;
    busy(true);
    try { await q(sb.from("ideas").update({ script, video_title, video_description, video_tags, search_terms, ai: before }).eq("id", idea.id)); studioPicks.set(idea.id, { language: before?.language || f.language.value, voice: f.voice.value, voice_rate: Number(f.rate.value), aspect: before?.aspect || f.aspect.value, voice_style: f.voiceStyle.value }); toast("Previous script restored"); render(); }
    catch (e) { toast(e.message); busy(false); }
  } }) : null;

  const field = (id, label, el) => h("div", { class: "field-wrap" }, h("label", { for: id, text: label }), el);
  return h("section", { class: "card ai-card" },
    h("div", { class: "card-head" }, h("h2", { text: "Write with AI" }), h("span", { class: "muted small", text: "Choose these first, then generate" })),
    h("div", { class: "form-grid" }, field("s-channel", "Network", f.channel), field("s-lang", "Language", f.language), field("s-aspect", "Format", f.aspect), field("ai-length", "Length", length)),
    aspectNote,
    field("ai-angle", "Angle (optional)", angle),
    src ? h("div", { class: "ai-src" },
      src.thumbnail ? h("a", { href: src.url, target: "_blank", rel: "noopener", class: "ai-thumb" }, h("img", { src: src.thumbnail, alt: "" })) : null,
      h("div", { style: "min-width:0;display:flex;flex-direction:column;gap:4px" },
        h("a", { href: src.url, target: "_blank", rel: "noopener", style: "font-weight:600;color:inherit", text: src.title }),
        h("div", { class: "muted small", text: `${src.channel_title || ""} · ${fmtc(src.channel_subscribers)} subs · ${fmtc(src.views)} views · ${fmtc(src.views_per_day)}/day${src.outlier_score ? ` · ${Number(src.outlier_score).toFixed(1)}× outlier` : ""}${src.duration_s ? ` · ${src.duration_s} s` : ""}` }),
        src.keyword ? h("div", { class: "muted small", text: `Ranks for “${src.keyword}”` }) : null))
      : isOutlier ? h("p", { class: "muted small", style: "margin:0", text: "The outlier's details are copied when you generate." })
      : h("p", { class: "muted small", style: "margin:0", text: "Not saved from an outlier: the AI picks a proven format for the title and your keywords." }),
    bp ? h("details", { class: "ai-bp" }, h("summary", { text: `Format: ${bp.format || "—"} · ${bp.length_seconds ? Math.round(bp.length_seconds) + " s" : ""} · hook: ${bp.hook?.type || "—"}` }),
      h("div", { class: "small", style: "display:flex;flex-direction:column;gap:6px" },
        bp.hook?.pattern ? h("div", {}, h("b", { text: "Hook pattern: " }), bp.hook.pattern) : null,
        bp.beats?.length ? h("div", {}, h("b", { text: "Beats: " }), bp.beats.map((b) => b.role).join(" → ")) : null,
        bp.title_pattern ? h("div", {}, h("b", { text: "Title pattern: " }), bp.title_pattern) : null,
        bp.why_it_worked?.length ? h("div", {}, h("b", { text: "Why it worked" }), h("ul", { style: "margin:4px 0 0;padding-left:18px" }, bp.why_it_worked.map((w) => h("li", { text: w })))) : null)) : null,
    isOutlier ? h("details", {}, h("summary", { text: idea.transcript ? "Transcript (pasted)" : "Paste the transcript (optional, better copy of the structure)" }), transcript) : null,
    h("div", { class: "row" }, genBtn, idea.script ? null : goBtn, improveBtn, restoreBtn, status),
    idea.ai_status === "failed" && idea.ai_error ? h("pre", { class: "err", text: idea.ai_error }) : null,
    ai?.title_options?.length ? h("div", { class: "field-wrap" }, h("span", { class: "muted small", text: "Title options (click to use)" }),
      h("div", { class: "chips-tabs" }, ai.title_options.map((t) => h("button", { type: "button", class: "chip-tab", "aria-pressed": String(f.title.value === t), text: t,
        onclick: (e) => { f.title.value = t; e.currentTarget.parentElement.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); } })))) : null,
    ai ? h("div", { class: "muted small", text: [ai.hook_text ? `Hook text: “${ai.hook_text}”` : "", ai.music_mood ? `Music: ${ai.music_mood}` : "", ai.notes || ""].filter(Boolean).join(" · ") }) : null,
    ai?.verify?.length ? h("div", { class: "ai-verify" }, h("div", { class: "row", style: "gap:8px" }, h("span", { class: "pill warn", text: "Check before publishing" })),
      h("ul", { style: "margin:6px 0 0;padding-left:18px" }, ai.verify.map((v) => h("li", { class: "small", text: v })))) : null);
}

// Video editor (React bundle, loaded on demand)
const EDITOR_VERSION = "17";  // bump when editor.bundle.js changes
VIEWS.edit = async (route) => {
  const mod = await import(`./editor.bundle.js?v=${EDITOR_VERSION}`);
  const el = h("div", { class: "ed-root" });
  state.unmount = mod.mountEditor(el, { sb, projectId: route.id, toast, VOICES, LANGS, initialTab: route.params.get("tab") });
  return el;
};

// ==================================================================
// Publishing: one posting schedule per channel + the upload queue
// ==================================================================
const WEEKDAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"]];
const TIMEZONES = [["Europe/Madrid", "Spain (Madrid)"], ["Europe/London", "UK (London)"], ["Europe/Berlin", "Germany (Berlin)"], ["Europe/Paris", "France (Paris)"],
  ["Africa/Casablanca", "Morocco (Casablanca)"], ["America/New_York", "US East (New York)"], ["America/Los_Angeles", "US West (Los Angeles)"], ["UTC", "UTC"]];
const CATEGORIES = [["22", "People & Blogs"], ["24", "Entertainment"], ["17", "Sports"], ["2", "Autos & Vehicles"], ["27", "Education"], ["28", "Science & Technology"], ["25", "News & Politics"], ["26", "Howto & Style"]];
const DEFAULT_SCHED = { enabled: false, method: "youtube", blotato_account_id: "", days: [1, 2, 3, 4, 5, 6, 0], times: ["18:00"], timezone: "Europe/Madrid",
  privacy: "public", notify_subscribers: true, synthetic_media: false, category_id: "22" };
const inTz = (iso, tz) => new Date(iso).toLocaleString("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

async function publishCall(body) {
  const { data, error } = await sb.functions.invoke("publish", { body });
  if (error) { let msg = error.message; try { msg = (await error.context.json()).error || msg; } catch { /* keep */ } throw new Error(msg); }
  if (data?.error) throw new Error(data.error);
  return data;
}

const PLATFORM_NAMES = { youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", twitter: "X", facebook: "Facebook" };
const PLATFORM_TAGS = { youtube: "YT", tiktok: "TT", instagram: "IG", twitter: "X", facebook: "FB" };
/** Where a network posts. A schedule from before networks existed posts to YouTube with its one method. */
const targetsOfSchedule = (sc) => (Array.isArray(sc?.targets) ? sc.targets : sc?.channel_id ? [{ platform: "youtube", method: sc.method, account_id: sc.blotato_account_id }] : []);

VIEWS.automation = async () => {
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const [scheds, queue, jobs, tokens] = await Promise.all([
    q(sb.from("publish_schedules").select("*")),
    q(sb.from("publish_queue").select("*").neq("status", "cancelled").order("slot_at", { ascending: true, nullsFirst: true }).limit(200)),
    q(sb.from("render_jobs").select("id,status,channel_id,project_id,idea_id,params,output_path,run_url,duration_s,finished_at,created_at").eq("status", "done").gte("created_at", since).order("created_at", { ascending: false })),
    q(sb.from("channel_tokens").select("channel_id")),
  ]);
  const connected = new Set(tokens.map((t) => t.channel_id));
  const schedOf = (id) => ({ ...DEFAULT_SCHED, ...(scheds.find((x) => x.channel_id === id) || {}) });
  const channels = state.channel === "all" ? state.channels : state.channels.filter((c) => c.id === state.channel);
  const active = (r) => ["queued", "uploading", "scheduled"].includes(r.status);
  const now = Date.now();

  // ----- consistency: empty slots in the next 7 days
  const week = channels.map((c) => {
    const sc = schedOf(c.id);
    const slots = slotsBetween(sc, now, 7);
    const taken = queue.filter((r) => r.channel_id === c.id && (active(r) || r.status === "published") && r.slot_at).map((r) => Date.parse(r.slot_at));
    const empty = slots.filter((t) => !taken.some((x) => Math.abs(x - t) < 30 * 60e3));
    return { c, sc, slots, empty };
  });
  const weekBox = h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h2", { text: "Next 7 days" }), h("span", { class: "muted small", text: "Empty slots = days you'd miss. Render more videos to fill them." })),
    h("div", { class: "pub-week" }, week.map(({ c, sc, slots, empty }) => h("div", { class: "pub-week-row" },
      h("div", { style: "font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", text: c.title }),
      sc.enabled ? h("div", { class: "pub-dots", "aria-label": `${slots.length - empty.length} of ${slots.length} slots filled` },
        slots.map((t) => h("span", { class: `pub-dot${empty.includes(t) ? "" : " on"}`, title: `${inTz(new Date(t).toISOString(), sc.timezone)}${empty.includes(t) ? " · empty" : " · filled"}` })))
        : h("span", { class: "muted small", text: "Automation off" }),
      sc.enabled ? h("span", { class: `pill ${empty.length ? (empty[0] - now < 2 * 864e5 ? "crit" : "warn") : "ok"}`, text: empty.length ? `${empty.length} empty` : "All filled" }) : null))));

  // ----- schedule per channel
  const schedCard = (c) => {
    const sc = schedOf(c.id);
    const days = new Set(sc.days);
    const en = h("input", { type: "checkbox", checked: sc.enabled, id: `en-${c.id}` });
    const targets = targetsOfSchedule(sc.channel_id ? sc : { ...sc, channel_id: connected.has(c.id) ? c.id : null });
    const dayBtns = h("div", { class: "chips-tabs", role: "group", "aria-label": "Posting days" }, WEEKDAYS.map(([d, t]) => h("button", { type: "button", class: "chip-tab", "aria-pressed": String(days.has(d)), text: t,
      onclick: (e) => { days.has(d) ? days.delete(d) : days.add(d); e.currentTarget.setAttribute("aria-pressed", String(days.has(d))); } })));
    const times = h("input", { class: "field", id: `t-${c.id}`, value: sc.times.join(", "), placeholder: "18:00, 21:00" });
    const tz = h("select", { class: "field", id: `tz-${c.id}` }, TIMEZONES.map(([v, t]) => h("option", { value: v, selected: sc.timezone === v, text: t })));
    const privacy = h("select", { class: "field", id: `p-${c.id}` }, [["public", "Public"], ["unlisted", "Unlisted"], ["private", "Private"]].map(([v, t]) => h("option", { value: v, selected: sc.privacy === v, text: t })));
    const cat = h("select", { class: "field", id: `c-${c.id}` }, CATEGORIES.map(([v, t]) => h("option", { value: v, selected: sc.category_id === v, text: t })));
    const notify = h("input", { type: "checkbox", checked: sc.notify_subscribers });
    const synth = h("input", { type: "checkbox", checked: sc.synthetic_media });
    const fld = (id, label, el) => h("div", { class: "field-wrap" }, h("label", { for: id, text: label }), el);
    const save = h("button", { class: "btn primary small", type: "button", text: "Save schedule", onclick: async () => {
      const tlist = times.value.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
      if (tlist.some((x) => !/^([01]?\d|2[0-3]):[0-5]\d$/.test(x))) return toast("Times look like 18:00, 21:30");
      if (!days.size || !tlist.length) return toast("Pick at least one day and one time");
      if (en.checked && !targets.length) return toast("Pick this network's accounts on its page first");
      await q(sb.from("publish_schedules").upsert({ channel_id: c.id, enabled: en.checked,
        days: [...days], times: tlist.map((x) => x.padStart(5, "0")), timezone: tz.value, privacy: privacy.value, category_id: cat.value,
        notify_subscribers: notify.checked, synthetic_media: synth.checked }, { onConflict: "channel_id" }));
      toast("Schedule saved"); render();
    } });
    return h("article", { class: "card pub-sched" },
      h("div", { class: "card-head" }, h("h3", { text: c.title }),
        targets.some((x) => x.platform === "youtube" && x.method !== "blotato") && !connected.has(c.id) ? h("span", { class: "pill warn", title: "YouTube direct publishing needs the channel connected on the network's page", text: "YouTube not connected" }) : null),
      h("label", { class: "pub-check", style: "font-weight:600" }, en, "Auto-publish finished renders"),
      h("div", { class: "row", style: "justify-content:space-between" },
        h("div", { class: "net-chips", "aria-label": "Where it posts" }, targets.length ? targets.map((x) => h("span", { class: "pill short", text: PLATFORM_NAMES[x.platform] || x.platform })) : h("span", { class: "muted small", text: "Posts nowhere yet" })),
        h("a", { class: "small", href: `#/channel/${c.id}`, text: "Change accounts" })),
      h("div", { class: "field-wrap" }, h("span", { class: "ed-label", text: "Posting days" }), dayBtns),
      h("div", { class: "form-grid" }, fld(`t-${c.id}`, "Times (local)", times), fld(`tz-${c.id}`, "Time zone", tz), fld(`p-${c.id}`, "YouTube visibility", privacy), fld(`c-${c.id}`, "Category", cat)),
      h("label", { class: "pub-check small" }, notify, "Notify subscribers"),
      h("label", { class: "pub-check small" }, synth, "Label as altered/synthetic content (realistic AI people or events)"),
      h("div", { class: "row" }, save));
  };

  // ----- renders not queued yet
  const queuedJobs = new Set(queue.map((r) => r.render_job_id));
  const ready = jobs.filter((j) => !queuedJobs.has(j.id) && (state.channel === "all" || j.channel_id === state.channel));
  const pickTime = (j) => {
    const inp = h("input", { type: "datetime-local", class: "field", style: "min-height:36px", "aria-label": "Publish at" });
    const go2 = h("button", { class: "btn small", type: "button", text: "Schedule", onclick: async () => {
      if (!inp.value) return toast("Pick a date and time");
      try { await publishCall({ action: "queue", render_job_id: j.id, when: new Date(inp.value).toISOString() }); toast("Scheduled"); render(); } catch (e) { toast(e.message); }
    } });
    return h("span", { class: "row", style: "gap:6px" }, inp, go2);
  };
  const readyBox = h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h2", { text: "Rendered, not scheduled" }), h("span", { class: "muted small", text: "Last 14 days" })),
    ready.length ? ready.map((j) => h("div", { class: "listrow" },
      h("div", { style: "flex:1 1 240px;min-width:0" }, h("div", { style: "font-weight:500", text: j.params?.title || "Video" }),
        h("div", { class: "muted small", text: [channelById(j.channel_id)?.title || "No network", j.params?.aspect, j.duration_s ? Math.round(j.duration_s) + " s" : "", `rendered ${ago(j.finished_at || j.created_at)}`].filter(Boolean).join(" · ") })),
      h("div", { class: "row" },
        h("button", { class: "btn small primary", type: "button", text: "Next free slot", onclick: async (e) => { e.currentTarget.disabled = true;
          try { const r = await publishCall({ action: "queue", render_job_id: j.id, when: "next" }); toast(r.row?.slot_at ? `Queued for ${inTz(r.row.slot_at, schedOf(j.channel_id).timezone)}` : "Queued"); render(); } catch (err) { toast(err.message); render(); } } }),
        h("button", { class: "btn small", type: "button", text: "Publish now", onclick: async (e) => { e.currentTarget.disabled = true;
          try { await publishCall({ action: "queue", render_job_id: j.id, when: "now" }); toast("Uploading now: live in a few minutes"); render(); } catch (err) { toast(err.message); render(); } } }),
        pickTime(j))))
      : empty("Nothing waiting. Videos you render show up here, or go straight to the queue when auto-publish is on."));

  // ----- queue
  const label = { queued: ["info", "Queued"], uploading: ["info", "Uploading"], scheduled: ["ok", "Scheduled"], published: ["ok", "Published"], failed: ["crit", "Failed"] };
  const rows = queue.filter((r) => state.channel === "all" || r.channel_id === state.channel);
  const queueBox = h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h2", { text: "Queue" }), h("span", { class: "muted small", text: "Scheduled videos stay private on YouTube until their time, then go live automatically." })),
    rows.length ? rows.map((r) => {
      const sc = schedOf(r.channel_id);
      return h("div", { class: "listrow", style: "align-items:flex-start" },
        h("span", { class: `pill ${label[r.status]?.[0] || "info"}`, text: label[r.status]?.[1] || r.status }),
        h("div", { style: "flex:1 1 240px;min-width:0;display:flex;flex-direction:column;gap:4px" },
          h("div", { style: "font-weight:500", text: r.title }),
          h("div", { class: "muted small", text: `${channelById(r.channel_id)?.title || ""} · ${PLATFORM_NAMES[r.platform] || "YouTube"} · ${r.slot_at ? inTz(r.slot_at, sc.timezone) : "as soon as uploaded"} · ${r.method === "blotato" ? "Blotato" : "YouTube"}` }),
          r.error ? h("pre", { class: "err", text: r.error }) : null),
        h("div", { class: "row" },
          r.public_url ? h("a", { class: "btn small", href: r.public_url, target: "_blank", rel: "noopener", text: "View post" }) : null,
          r.youtube_video_id ? h("a", { class: "btn small", href: `https://studio.youtube.com/video/${r.youtube_video_id}/edit`, target: "_blank", rel: "noopener", text: "YouTube Studio" }) : null,
          r.status === "failed" ? h("button", { class: "btn small primary", type: "button", text: "Retry", onclick: async () => {
            try { await publishCall({ action: "queue", render_job_id: r.render_job_id, platform: r.platform, when: r.slot_at && Date.parse(r.slot_at) > Date.now() + 20 * 60e3 ? r.slot_at : "next" }); toast("Retrying"); } catch (e) { toast(e.message); } render();
          } }) : null,
          ["queued", "failed"].includes(r.status) ? h("button", { class: "btn small ghost", type: "button", text: "Cancel", onclick: async () => {
            try { await publishCall({ action: "cancel", queue_id: r.id }); toast("Cancelled"); } catch (e) { toast(e.message); } render();
          } }) : null,
          r.run_url ? h("a", { class: "btn small ghost", href: r.run_url, target: "_blank", rel: "noopener", text: "Log" }) : null));
    }) : empty("The queue is empty."));

  if (queue.some((r) => ["queued", "uploading"].includes(r.status))) state.timer = setInterval(() => render(), 20000);
  return [pageHead("Publishing", "Each channel posts on its own days and times. Render a video and it lands in the next free slot."),
    weekBox, readyBox, queueBox,
    h("h2", { style: "margin:8px 0 0", text: "Schedules" }),
    channels.length ? h("div", { class: "grid-cards wide pub-grid" }, channels.map(schedCard)) : empty("No networks yet.")];
};

// ==================================================================
// Channels
// ==================================================================
// ==================================================================
// Calendar: every post by day, like Blotato's
// ==================================================================
const calendar = { anchor: null, mode: "month", platform: "all", status: "all", open: null };
const POST_STATUS = { queued: ["info", "Queued"], uploading: ["info", "Uploading"], scheduled: ["warn", "Scheduled"], published: ["ok", "Published"], failed: ["crit", "Failed"] };
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const postTime = (r) => new Date(r.slot_at || r.created_at);
// YouTube makes a scheduled video public by itself, without telling the app
const postStatus = (r) => (r.status === "scheduled" && r.method !== "blotato" && r.slot_at && Date.parse(r.slot_at) <= Date.now() ? "published" : r.status);
// YouTube sends a video that isn't a Short from /shorts/ on to its normal page
const postLink = (r) => r.public_url || (r.youtube_video_id ? `https://www.youtube.com/shorts/${r.youtube_video_id}` : null);
/** Monday of the week d is in. */
const weekStart = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };

VIEWS.calendar = async () => {
  await publishCall({ action: "blotato_sync" }).catch(() => {});  // a calendar without it still shows what the app knows
  const rows = await q(sb.from("publish_queue").select("*").neq("status", "cancelled").order("slot_at", { ascending: true, nullsFirst: false }).limit(1000));
  if (!calendar.anchor) calendar.anchor = new Date();
  const posts = rows.filter((r) => (state.channel === "all" || r.channel_id === state.channel)
    && (calendar.platform === "all" || (r.platform || "youtube") === calendar.platform)
    && (calendar.status === "all" || postStatus(r) === calendar.status));
  const byDay = new Map();
  for (const r of posts) { const k = dayKey(postTime(r)); byDay.set(k, [...(byDay.get(k) || []), r]); }
  for (const list of byDay.values()) list.sort((a, b) => postTime(a) - postTime(b));

  const a = calendar.anchor;
  const first = calendar.mode === "week" ? weekStart(a) : weekStart(new Date(a.getFullYear(), a.getMonth(), 1));
  const lastOfMonth = new Date(a.getFullYear(), a.getMonth() + 1, 0);
  const count = calendar.mode === "week" ? 7 : Math.ceil(((lastOfMonth - first) / 864e5 + 1) / 7) * 7;
  const days = Array.from({ length: count }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i));
  const title = calendar.mode === "week"
    ? `${days[0].toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${days[6].toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
    : a.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const move = (step) => {
    calendar.anchor = calendar.mode === "week" ? new Date(a.getFullYear(), a.getMonth(), a.getDate() + step * 7) : new Date(a.getFullYear(), a.getMonth() + step, 1);
    calendar.open = null; render();
  };
  const today = dayKey(new Date());

  const chip = (r) => {
    const status = postStatus(r);
    const platform = r.platform || "youtube";
    return h("button", { class: `cal-post ${POST_STATUS[status]?.[0] || "info"}`, type: "button", "aria-expanded": calendar.open === r.id,
      "aria-label": `${POST_STATUS[status]?.[1] || status}, ${PLATFORM_NAMES[platform]}, ${r.title}`,
      onclick: () => { calendar.open = calendar.open === r.id ? null : r.id; render(); } },
      h("span", { class: "cal-tag", text: PLATFORM_TAGS[platform] }),
      h("span", { class: "cal-time", text: postTime(r).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) }),
      h("span", { class: "cal-title", dir: "auto", text: r.title }));
  };
  const grid = h("div", { class: `cal-grid cal-${calendar.mode}` },
    days.slice(0, 7).map((d) => h("div", { class: "cal-head", "aria-hidden": "true", text: d.toLocaleDateString(undefined, { weekday: "short" }) })),
    days.map((d) => {
      const k = dayKey(d);
      const list = byDay.get(k) || [];
      return h("div", { class: `cal-day${d.getMonth() !== a.getMonth() && calendar.mode === "month" ? " other" : ""}${k === today ? " today" : ""}${list.length ? "" : " no-posts"}`, role: "group", "aria-label": d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }) },
        h("div", { class: "cal-date" }, h("span", { class: "cal-long", text: d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }) }), h("span", { class: "cal-short", text: String(d.getDate()) })),
        list.map(chip));
    }));

  const openPost = rows.find((r) => r.id === calendar.open);
  const detail = () => {
    const r = openPost;
    const status = postStatus(r);
    const link = postLink(r);
    return h("section", { class: "card cal-detail", "aria-label": "Post details" },
      h("div", { class: "card-head" }, h("h2", { dir: "auto", text: r.title }), h("span", { class: `pill ${POST_STATUS[status]?.[0] || "info"}`, text: POST_STATUS[status]?.[1] || status })),
      h("div", { class: "muted small", text: [PLATFORM_NAMES[r.platform || "youtube"], channelById(r.channel_id)?.title, postTime(r).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" }), r.method === "blotato" ? "through Blotato" : "direct"].filter(Boolean).join(" · ") }),
      r.description ? h("p", { class: "small cal-text", dir: "auto", text: r.description }) : null,
      r.error ? h("pre", { class: "err", text: r.error }) : null,
      h("div", { class: "row" },
        link ? h("a", { class: "btn small primary", href: link, target: "_blank", rel: "noopener", text: "View post" }) : null,
        r.youtube_video_id ? h("a", { class: "btn small", href: `https://studio.youtube.com/video/${r.youtube_video_id}/edit`, target: "_blank", rel: "noopener", text: "YouTube Studio" }) : null,
        r.method === "blotato" && status === "scheduled" ? h("a", { class: "btn small", href: "https://my.blotato.com/calendar", target: "_blank", rel: "noopener", text: "Open in Blotato" }) : null,
        r.status === "failed" ? h("button", { class: "btn small primary", type: "button", text: "Retry", onclick: async () => {
          try { await publishCall({ action: "queue", render_job_id: r.render_job_id, platform: r.platform, when: r.slot_at && Date.parse(r.slot_at) > Date.now() + 20 * 60e3 ? r.slot_at : "next" }); toast("Queued again"); } catch (e) { toast(e.message); } render();
        } }) : null,
        ["queued", "failed"].includes(r.status) ? h("button", { class: "btn small ghost", type: "button", text: "Cancel post", onclick: async () => {
          try { await publishCall({ action: "cancel", queue_id: r.id }); toast("Cancelled"); calendar.open = null; } catch (e) { toast(e.message); } render();
        } }) : null,
        r.run_url ? h("a", { class: "btn small ghost", href: r.run_url, target: "_blank", rel: "noopener", text: "Log" }) : null));
  };

  const menu = (label, value, options, onchange) => h("label", { class: "cal-filter" }, h("span", { class: "muted small", text: label }),
    h("select", { class: "field", onchange: (e) => onchange(e.target.value) }, options.map(([v, t]) => h("option", { value: v, selected: v === value, text: t }))));
  const toolbar = h("div", { class: "cal-bar" },
    h("div", { class: "row" },
      h("button", { class: "btn small", type: "button", "aria-label": calendar.mode === "week" ? "Previous week" : "Previous month", text: "‹", onclick: () => move(-1) }),
      h("button", { class: "btn small", type: "button", text: "Today", onclick: () => { calendar.anchor = new Date(); calendar.open = null; render(); } }),
      h("button", { class: "btn small", type: "button", "aria-label": calendar.mode === "week" ? "Next week" : "Next month", text: "›", onclick: () => move(1) }),
      h("h2", { class: "cal-month", "aria-live": "polite", text: title })),
    h("div", { class: "row" },
      h("div", { class: "chips-tabs", role: "group", "aria-label": "View" }, [["month", "Month"], ["week", "Week"]].map(([v, t]) => h("button", { class: "chip-tab", type: "button", "aria-pressed": calendar.mode === v, text: t, onclick: () => { calendar.mode = v; render(); } }))),
      menu("Platform", calendar.platform, [["all", "All"], ...Object.entries(PLATFORM_NAMES)], (v) => { calendar.platform = v; calendar.open = null; render(); }),
      menu("Status", calendar.status, [["all", "All"], ...Object.entries(POST_STATUS).map(([k, [, t]]) => [k, t])], (v) => { calendar.status = v; calendar.open = null; render(); })));

  const shown = days.reduce((n, d) => n + (byDay.get(dayKey(d))?.length || 0), 0);
  if (rows.some((r) => ["queued", "uploading"].includes(r.status))) state.timer = setInterval(() => render(), 30000);
  return [pageHead("Calendar", "Every post in one place: scheduled, published or failed."),
    h("section", { class: "card" }, toolbar, grid, shown ? null : h("p", { class: "muted small cal-none", text: "No posts here. Finished videos appear once you schedule them in Publish." })),
    openPost ? detail() : null];
};

VIEWS.channels = async () => {
  const [rows, snaps, vids, scheds] = await Promise.all([
    networkOverview(28),
    q(sb.from("channel_snapshots").select("channel_id,total_views,captured_at").order("captured_at", { ascending: false }).limit(300)),
    q(sb.from("v_own_video_latest").select("channel_id,views,likes,published_at")),
    q(sb.from("publish_schedules").select("*")),
  ]);
  const live = liveCounts(snaps, vids);
  const scheduleOf = (id) => scheds.find((x) => x.channel_id === id);
  const name = h("input", { id: "net-name", class: "field", required: true, maxlength: 60, placeholder: "Dark Psychology" });
  const niche = h("select", { id: "net-niche", class: "field" }, h("option", { value: "", text: "No niche" }), realNiches().map((n) => h("option", { value: n.id, text: n.name })));
  const language = h("select", { id: "net-lang", class: "field" }, LANGS.map(([v, t]) => h("option", { value: v, text: t })));
  const form = h("form", { class: "card net-new", hidden: true, onsubmit: async (e) => {
    e.preventDefault();
    const title = name.value.trim();
    if (!title) return;
    try {
      const created = await q(sb.from("channels").insert({ title, network_name: title, niche_id: niche.value || null, language: language.value, video_style: { language: language.value } }).select().single());
      await q(sb.from("publish_schedules").upsert({ channel_id: created.id, enabled: false, targets: [] }, { onConflict: "channel_id" }));
      await loadShared();
      state.channel = created.id; store.set("ytc.channel", created.id); renderBus();
      toast("Network created. Now connect its accounts.");
      go(`#/channel/${created.id}`);
    } catch (err) { toast(err.message); }
  } },
    h("h2", { text: "New network" }),
    h("div", { class: "form-grid" },
      h("div", { class: "field-wrap" }, h("label", { for: "net-name", text: "Name" }), name),
      h("div", { class: "field-wrap" }, h("label", { for: "net-niche", text: "Niche" }), niche),
      h("div", { class: "field-wrap" }, h("label", { for: "net-lang", text: "Language" }), language)),
    h("div", { class: "row" }, h("button", { class: "btn primary", type: "submit", text: "Create network" }), h("button", { class: "btn ghost", type: "button", text: "Cancel", onclick: () => { form.hidden = true; } })));
  const openForm = () => { form.hidden = false; name.focus(); };
  return [
    pageHead("Networks", "One brand, all its accounts: YouTube, TikTok, Instagram, X and Facebook.",
      h("button", { class: "btn", type: "button", text: "Refresh stats", onclick: (e) => refreshChannel(null, e.currentTarget) }),
      h("button", { class: "btn primary", type: "button", text: "+ New network", onclick: openForm })),
    form,
    rows.length ? h("section", { class: "grid-cards wide" }, rows.map((r) => {
      const c = channelById(r.channel_id);
      const targets = targetsOfSchedule(scheduleOf(r.channel_id) || (c?.youtube_channel_id ? { channel_id: r.channel_id, method: "youtube" } : null));
      return h("a", { class: "ch-card", href: `#/channel/${r.channel_id}` },
        h("div", { class: "row", style: "gap:12px;flex-wrap:nowrap" }, r.thumbnail_url ? h("img", { class: "avatar", src: r.thumbnail_url, alt: "" }) : h("span", { class: "avatar" }),
          h("div", { style: "min-width:0" }, h("div", { style: "font-weight:600", text: r.title }), h("div", { class: "muted small", text: `${r.niche_name || "No niche"} · ${(r.language || "—").toUpperCase()}` }))),
        h("div", { class: "net-chips", "aria-label": "Accounts" }, Object.entries(PLATFORM_NAMES).map(([k, label]) => {
          const on = targets.some((x) => x.platform === k);
          return h("span", { class: `pill ${on ? "ok" : "short"}`, text: on ? label : `${label} off` });
        })),
        c?.youtube_channel_id ? h("div", { class: "stats3" },
          h("div", {}, h("span", { text: "Subscribers" }), h("span", { class: "mono", text: fmt(r.subscribers) })),
          h("div", {}, h("span", { text: "Total views" }), h("span", { class: "mono", text: fmt(live[r.channel_id]?.views) })),
          h("div", {}, h("span", { text: "Likes" }), h("span", { class: "mono", text: fmt(live[r.channel_id]?.likes) }))) : h("div", { class: "muted small", text: "No YouTube channel yet" }),
        c?.youtube_channel_id ? h("div", { class: "muted small", text: `Updated ${ago(c.stats_synced_at)}` }) : null);
    })) : empty("No networks yet.", h("button", { class: "btn primary", type: "button", text: "Create a network", onclick: openForm })),
  ];
};

/** The accounts of one network, and where its videos start from. */
function networkPanels(chRow, sc, blotato) {
  const id = chRow.id;
  const hasYoutube = !!chRow.youtube_channel_id;
  const saved = targetsOfSchedule(sc || (hasYoutube ? { channel_id: id, method: "youtube" } : null));
  const savedOf = (platform) => saved.find((x) => x.platform === platform);
  const accountsFor = (platform) => (blotato.accounts || []).filter((a) => a.platform === platform);
  const keyOf = (a) => (a.page_id ? `${a.id}:${a.page_id}` : a.id);
  const menu = (platform, off) => {
    const t = savedOf(platform);
    const current = t?.account_id ? (t.page_id ? `${t.account_id}:${t.page_id}` : String(t.account_id)) : "";
    const list = accountsFor(platform);
    return h("select", { class: "field", "aria-label": `${PLATFORM_NAMES[platform]} account` }, h("option", { value: "", text: off }),
      list.map((a) => h("option", { value: keyOf(a), selected: keyOf(a) === current, text: a.name })),
      current && !list.some((a) => keyOf(a) === current) ? h("option", { value: current, selected: true, text: `Account ${current} (not found in Blotato)` }) : null);
  };
  const status = (platform, select) => {
    const label = () => {
      if (!select.value) return ["short", "Off"];
      if (blotato.error) return ["warn", "Can't check"];
      return accountsFor(platform).some((a) => keyOf(a) === select.value) ? ["ok", "Connected"] : ["crit", "Not found"];
    };
    const pill = h("span", {});
    const show = () => { const [cls, text] = label(); pill.className = `pill ${cls}`; pill.textContent = text; };
    select.addEventListener("change", show); show();
    return pill;
  };
  const yt = savedOf("youtube");
  const ytMethod = h("select", { class: "field", "aria-label": "How YouTube posts" }, [["youtube", "Direct"], ["blotato", "Through Blotato"], ["off", "Don't post"]].map(([v, t]) => h("option", { value: v, selected: (yt ? yt.method || "youtube" : "off") === v, text: t })));
  const ytBlotato = menu("youtube", "Choose an account");
  const ytWrap = h("div", {}, ytBlotato);
  const showYt = () => { ytWrap.hidden = ytMethod.value !== "blotato"; };
  ytMethod.addEventListener("change", showYt); showYt();
  const ytPill = h("span", { class: `pill ${chRow.connected ? "ok" : hasYoutube ? "warn" : "short"}`, text: chRow.connected ? "Connected" : hasYoutube ? "Public stats only" : "Not connected" });
  const tiktok = menu("tiktok", "Don't post");
  const ttPrivacy = h("select", { class: "field", "aria-label": "TikTok visibility" }, [["PUBLIC_TO_EVERYONE", "Public"], ["SELF_ONLY", "Only me"], ["MUTUAL_FOLLOW_FRIENDS", "Friends"], ["FOLLOWER_OF_CREATOR", "Followers"]].map(([v, t]) => h("option", { value: v, selected: (savedOf("tiktok")?.privacy || "PUBLIC_TO_EVERYONE") === v, text: t })));
  const ttAi = h("input", { type: "checkbox", checked: savedOf("tiktok")?.ai !== false });
  const instagram = menu("instagram", "Don't post");
  const x = menu("twitter", "Don't post");
  const facebook = menu("facebook", "Don't post");
  const row = (platform, pill, ...controls) => h("div", { class: "net-row" }, h("strong", { text: PLATFORM_NAMES[platform] }), pill, h("div", { class: "net-controls" }, controls));
  const name = h("input", { id: `net-name-${id}`, class: "field", maxlength: 60, value: chRow.title });
  const save = h("button", { class: "btn primary", type: "button", text: "Save accounts", onclick: async () => {
    if (ytMethod.value === "blotato" && !ytBlotato.value) return toast("Choose the YouTube account in Blotato");
    const blotatoTarget = (platform, select, extra = {}) => { if (!select.value) return []; const [account_id, page_id] = select.value.split(":"); return [{ platform, method: "blotato", account_id, ...(page_id ? { page_id } : {}), ...extra }]; };
    const targets = [
      ...(ytMethod.value === "off" ? [] : [{ platform: "youtube", method: ytMethod.value, account_id: ytMethod.value === "blotato" ? ytBlotato.value : null }]),
      ...blotatoTarget("tiktok", tiktok, { privacy: ttPrivacy.value, ai: ttAi.checked }), ...blotatoTarget("instagram", instagram), ...blotatoTarget("twitter", x), ...blotatoTarget("facebook", facebook),
    ];
    try {
      await q(sb.from("publish_schedules").upsert({ channel_id: id, targets, method: ytMethod.value === "blotato" ? "blotato" : "youtube", blotato_account_id: ytMethod.value === "blotato" ? ytBlotato.value : null }, { onConflict: "channel_id" }));
      const newName = name.value.trim();
      if (newName && newName !== chRow.title) { await q(sb.from("channels").update({ network_name: newName }).eq("id", id)); await loadShared(); }
      toast("Accounts saved"); render();
    } catch (e) { toast(e.message); }
  } });
  const noAccounts = !blotato.error && !(blotato.accounts || []).some((a) => a.platform !== "youtube");
  const accounts = h("section", { class: "card net-accounts" },
    h("div", { class: "card-head" }, h("h2", { text: "Accounts" }), h("a", { class: "small", href: "https://my.blotato.com/accounts", target: "_blank", rel: "noopener", text: "Connect accounts in Blotato" })),
    h("div", { class: "field-wrap" }, h("label", { for: `net-name-${id}`, text: "Network name" }), name),
    blotato.error ? h("p", { class: "muted small", style: "margin:0", text: `Blotato's accounts couldn't load: ${blotato.error}` }) : null,
    noAccounts ? h("p", { class: "muted small", style: "margin:0", text: "No TikTok, Instagram, X or Facebook account in Blotato yet. Connect them there, then reload this page." }) : null,
    row("youtube", ytPill, ytMethod, ytWrap, chRow.connected ? null : h("button", { class: "btn small primary", type: "button", text: "Connect with Google", onclick: () => startOAuth(id) })),
    row("tiktok", status("tiktok", tiktok), tiktok, ttPrivacy, h("label", { class: "pub-check small" }, ttAi, "Mark as AI-generated")),
    row("instagram", status("instagram", instagram), instagram),
    row("twitter", status("twitter", x), x, h("span", { class: "muted small", text: "Posts the title, 280 characters at most." })),
    row("facebook", status("facebook", facebook), facebook, h("span", { class: "muted small", text: "Pages only, not personal profiles." })),
    h("div", { class: "row" }, save));

  const style = chRow.video_style || {};
  const editor = style.editor || {};
  const voiceName = Object.values(VOICES).flat().find(([v]) => v === style.voice)?.[1];
  const line = (label, value) => h("div", { class: "net-default" }, h("span", { class: "muted small", text: label }), h("span", { text: value }));
  const defaults = h("section", { class: "card" },
    h("h2", { text: "New videos start with" }),
    h("div", { class: "net-defaults" },
      line("Voice", voiceName || "App default"), line("Voice style", PRESETS[editor.voice_fx?.style]?.label || (editor.voice_fx?.style === "custom" ? "Custom" : "Natural")),
      line("Voice speed", style.voice_rate ? `${style.voice_rate}×` : "App default"), line("Format", style.aspect || "9:16"),
      line("Music level", editor.music ? `${Math.round(editor.music.volume * 100)}%` : "App default"), line("Thumbnail style", editor.thumbnail?.style ? editor.thumbnail.style[0].toUpperCase() + editor.thumbnail.style.slice(1) : "Dark psycho")),
    h("p", { class: "muted small", style: "margin:0", text: "To change these, set up a video the way you like, then press “Use these settings for this network” in the editor's Style tab." }));
  return [accounts, defaults];
}

// Impressions come from YouTube's daily reports: say why they're missing instead of showing an empty number.
function reachNotice(c) {
  if (!c?.connected || !c.reach_error) return null;
  const url = c.reach_error.match(/https:\/\/console\.(?:developers|cloud)\.google\.com\/[^\s"]+/)?.[0]?.replace(/[.,)]+$/, "");
  const disabled = /has not been used|is disabled|SERVICE_DISABLED/i.test(c.reach_error);
  return h("section", { class: "card", style: "border-color:#E8C27A" },
    h("h2", { text: disabled ? "Impressions need one setting in Google Cloud" : "Impressions couldn't be imported" }),
    h("p", { class: "muted small", style: "margin:0", text: disabled
      ? "Enable the “YouTube Reporting API” in the Google Cloud project used for sign-in, then press Refresh now. YouTube then takes about 2 days to prepare the first impressions file."
      : c.reach_error }),
    url ? h("div", {}, h("a", { class: "btn small", href: url, target: "_blank", rel: "noopener", text: "Open Google Cloud" })) : null);
}
const ctrText = (c) => (c === null || c === undefined ? "—" : `${(Number(c) * 100).toFixed(1)}%`);

VIEWS.channel = async (route) => {
  const id = route.id;
  const tab = route.params.get("tab") || "overview";
  const [overview, daily] = await Promise.all([networkOverview(28), q(sb.rpc("portfolio_daily", { p_days: 28, p_channel: id }))]);
  const ch = overview.find((r) => r.channel_id === id);
  if (!ch) return [empty("Network not found.")];
  const chRow = channelById(id);
  const [scheds, blotato] = await Promise.all([
    q(sb.from("publish_schedules").select("*").eq("channel_id", id)),
    publishCall({ action: "blotato_accounts" }).catch((e) => ({ accounts: [], error: e.message })),
  ]);
  const panels = networkPanels(chRow, scheds[0], blotato);
  const header = h("header", { class: "head" },
    h("div", { class: "row", style: "gap:16px;flex-wrap:nowrap" }, ch.thumbnail_url ? h("img", { class: "avatar", src: ch.thumbnail_url, alt: "" }) : h("span", { class: "avatar" }),
      h("div", { class: "head-text" }, h("a", { href: "#/channels", class: "small", text: "← Networks" }), h("h1", { style: "font-size:26px", text: ch.title }),
        h("div", { class: "muted small" }, `${ch.niche_name || "No niche"} · `, chRow?.youtube_channel_id ? (ch.connected ? h("span", { class: "up", text: "YouTube connected" }) : h("span", { class: "flat", text: "Public stats only" })) : h("span", { class: "flat", text: "No YouTube channel yet" })))),
    h("div", { class: "row" },
      chRow?.youtube_channel_id ? h("span", { class: "muted small", title: chRow?.stats_synced_at ? when(chRow.stats_synced_at) : "", text: `Updated ${chRow?.stats_synced_at ? ago(chRow.stats_synced_at) : "—"}` }) : null,
      chRow?.youtube_channel_id ? h("button", { class: "btn", type: "button", text: "Refresh now", onclick: (e) => refreshChannel(id, e.currentTarget) }) : null,
      h("a", { class: "btn", href: link("research", { scope: chRow?.niche_id || "global" }), text: "Research for this network" })));
  if (!chRow?.youtube_channel_id) return [header, ...panels];
  const statLine = (v) => [`${fmtc(v.views)} views`, `${fmtc(v.likes)} likes`, v.impressions_28d !== null && v.impressions_28d !== undefined ? `${fmtc(v.impressions_28d)} impr.` : null].filter(Boolean).join(" · ");
  const tabs = h("div", { class: "tabs", role: "tablist" },
    [["overview", "Overview"], ["videos", "Videos"], ["search", "Search terms"], ["audience", "Audience"]].map(([v, t]) =>
      h("button", { role: "tab", type: "button", "aria-selected": String(v === tab), text: t, onclick: () => setParams(route, { tab: v }) })));
  let body;
  if (tab === "overview") {
    const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const [vids, reach] = await Promise.all([
      q(sb.from("v_own_video_latest").select("*").eq("channel_id", id).order("published_at", { ascending: false }).limit(6)),
      q(sb.from("channel_daily_stats").select("day,impressions,impressions_ctr").eq("channel_id", id).gt("day", since).not("impressions", "is", null)),
    ]);
    const impressions = reach.reduce((a, r) => a + Number(r.impressions), 0);
    const clicked = reach.filter((r) => r.impressions_ctr !== null);
    const ctr = clicked.length ? clicked.reduce((a, r) => a + Number(r.impressions) * Number(r.impressions_ctr), 0) / (clicked.reduce((a, r) => a + Number(r.impressions), 0) || 1) : null;
    const lastReach = reach.map((r) => r.day).sort().pop();
    const k = (label, value, d) => h("div", { class: "kpi" }, h("div", { class: "label", text: label }), h("div", { class: "value", style: "font-size:24px", text: value }), d);
    body = [
      h("section", { class: "kpis" }, k("Subscribers", fmt(ch.subscribers)),
        k("Views (28 d)", ch.connected ? fmt(ch.views) : "—", ch.connected ? delta(ch.views, ch.views_prev) : null),
        k("Impressions (28 d)", reach.length ? fmt(impressions) : "—",
          h("span", { class: "flat", text: reach.length ? `CTR ${ctrText(ctr)} · to ${lastReach}` : !ch.connected ? "Connect with Google to see this" : chRow?.reach_error ? "Needs setup, see below" : "First numbers about 2 days after the first refresh" })),
        k("Watch hours (28 d)", ch.connected ? fmt(ch.watch_hours) : "—", ch.connected ? delta(ch.watch_hours, ch.watch_hours_prev) : null),
        k("Uploads (28 d)", fmt(ch.uploads))),
      reachNotice(chRow),
      h("div", { class: "cols" },
        h("section", { class: "card grow2" }, h("h2", { text: "Monetization" }), yppRow("Subscribers", ch.subscribers, 1000, ""),
          ch.connected ? yppRow("Watch hours, 12 months", ch.watch_hours_12m, 8000, " h") : h("p", { class: "muted small", text: "Connect with Google to track watch hours." }),
          daily.length > 1 ? h("div", {}, h("div", { class: "muted small", text: "Daily views, 28 days" }), spark(daily.map((d) => d.views), 300, 48)) : null),
        h("section", { class: "card grow3" }, h("h2", { text: "Latest videos vs channel average" }),
          vids.length ? vids.map((v) => h("div", { class: "listrow" }, h("span", { class: `pill ${v.is_short ? "short" : "long"}`, text: v.is_short ? "Short" : "Long" }),
            h("a", { href: youtubeLink(v), target: "_blank", rel: "noopener", style: "flex:1 1 220px;min-width:0;font-weight:500;color:inherit", text: v.title }),
            h("span", { class: "mono small", text: statLine(v) }), multPill(v.vs_baseline))) : empty("No videos yet."))),
    ];
  } else if (tab === "videos") {
    const vids = await q(sb.from("v_own_video_latest").select("*").eq("channel_id", id).order("published_at", { ascending: false }).limit(100));
    body = [reachNotice(chRow), h("section", { class: "card" },
      h("p", { class: "muted small", style: "margin:0", text: "Views, likes and comments are YouTube’s live counts at the last refresh. Impressions and CTR cover the last 28 days of YouTube’s daily reports, about 2 days behind; Shorts swiped in the Shorts feed don’t count as thumbnail impressions." }),
      vids.length ? h("div", { class: "tablebox" }, h("table", { style: "min-width:860px" },
      h("thead", {}, h("tr", {}, ["Video", "Type", "Published", "Views", "Likes", "Comments", "Impressions", "CTR", "vs average"].map((t, i) => h("th", { class: i > 2 ? "num" : null, text: t })))),
      h("tbody", {}, vids.map((v) => h("tr", {},
        h("td", {}, h("a", { href: youtubeLink(v), target: "_blank", rel: "noopener", style: "font-weight:500;color:inherit", text: v.title })),
        h("td", {}, h("span", { class: `pill ${v.is_short ? "short" : "long"}`, text: v.is_short ? "Short" : "Long" })),
        h("td", { class: "muted", text: v.published_at ? new Date(v.published_at).toLocaleDateString("en-GB") : "—" }),
        h("td", { class: "num", text: fmt(v.views) }), h("td", { class: "num", text: fmt(v.likes) }), h("td", { class: "num", text: fmt(v.comments) }),
        h("td", { class: "num", text: fmt(v.impressions_28d) }), h("td", { class: "num", text: ctrText(v.ctr_28d) }),
        h("td", { class: "num" }, multPill(v.vs_baseline)))))))
      : empty("No videos yet."))];
  } else if (tab === "search") {
    const terms = await q(sb.from("channel_search_terms").select("*").eq("channel_id", id).order("period_end", { ascending: false }).order("views", { ascending: false }).limit(60));
    const latest = terms[0]?.period_end, cur = terms.filter((t) => t.period_end === latest);
    body = h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", { text: "Searches that brought viewers" }), h("span", { class: "muted small", text: latest ? `28 days to ${latest}` : "" })),
      cur.length ? h("div", { class: "tablebox" }, h("table", { style: "min-width:420px" },
        h("thead", {}, h("tr", {}, h("th", { text: "Search term" }), h("th", { class: "num", text: "Views" }))),
        h("tbody", {}, cur.map((t) => { const href = link(`keyword/${encodeURIComponent(t.term.toLowerCase())}`, { scope: chRow?.niche_id || "global", market: chRow?.markets?.[0] || "GLOBAL" });
          return h("tr", { class: "clickable", tabindex: "0", onclick: () => go(href), onkeydown: (e) => e.key === "Enter" && go(href) },
            h("td", { style: "font-weight:500", text: t.term }), h("td", { class: "num", text: fmt(t.views) })); }))))
        : empty(ch.connected ? "YouTube shows search terms once the channel gets search traffic." : "Connect with Google to see this."));
  } else {
    const rows = await q(sb.from("channel_breakdowns").select("*").eq("channel_id", id).order("period_end", { ascending: false }).limit(60));
    const latest = rows[0]?.period_end;
    const part = (kind, title) => {
      const items = rows.filter((r) => r.period_end === latest && r.kind === kind).sort((a, b) => b.views - a.views).slice(0, 8);
      const total = items.reduce((a, r) => a + Number(r.views), 0) || 1;
      return h("section", { class: "card grow1" }, h("h2", { text: title }),
        items.length ? items.map((r) => h("div", { style: "display:grid;grid-template-columns:150px minmax(0,1fr) 52px;gap:12px;align-items:center" },
          h("span", { text: prettySource(r.key) }), bar(pctOf(r.views, total), null, true), h("span", { class: "num mono", text: `${Math.round(pctOf(r.views, total))}%` })))
          : empty(ch.connected ? "Appears once the channel has enough views." : "Connect with Google to see this."));
    };
    body = h("div", { class: "cols" }, part("traffic_source", "Where views come from"), part("country", "Top countries"));
  }
  return [header, ...panels, tabs, body].flat();
};
function yppRow(label, val, target, unit) {
  const p = pctOf(val, target);
  return h("div", { style: "display:flex;flex-direction:column;gap:6px" },
    h("div", { style: "display:flex;justify-content:space-between;font-size:13.5px" }, h("span", { style: "font-weight:500", text: label }), h("span", { class: "mono", text: `${fmtc(val)} / ${fmtc(target)}${unit}` })),
    bar(p, p >= 100 ? "#12985A" : null, true));
}
function multPill(m) {
  if (m === null || m === undefined) return h("span", { class: "flat", text: "—" });
  return h("span", { class: m >= 1.5 ? "up" : m < 0.6 ? "down" : "flat", text: `${Number(m).toFixed(1)}×` });
}
function prettySource(k) {
  return { SHORTS: "Shorts feed", YT_SEARCH: "YouTube search", RELATED_VIDEO: "Suggested videos", SUBSCRIBER: "Browse / subscriptions", YT_CHANNEL: "Channel page",
    EXT_URL: "External sites", PLAYLIST: "Playlists", NO_LINK_OTHER: "Direct / unknown", NOTIFICATION: "Notifications", END_SCREEN: "End screens" }[k] || k;
}

// ==================================================================
// Settings
// ==================================================================
VIEWS.settings = async (route) => {
  if (route.params.get("connected")) toast("YouTube connected. Stats are loading.");
  if (route.params.get("error")) toast(`Google connection failed: ${route.params.get("error")}`);
  const [seeds, runs, quota, tracks] = await Promise.all([
    q(sb.from("seed_terms").select("*").order("created_at")),
    q(sb.from("job_runs").select("*").order("started_at", { ascending: false }).limit(150)),
    q(sb.from("api_quota_daily").select("*").eq("day", today())),
    q(sb.from("music_tracks").select("*").order("created_at", { ascending: false })),
  ]);

  const nicheCard = (n) => {
    const w = n.weights || {};
    const inp = (id, label, value, type = "text") => { const el = h("input", { id: `${id}-${n.id}`, class: "field", type, value: value ?? "" }); return [el, h("div", { class: "field-wrap", style: "flex:1 1 130px" }, h("label", { for: el.id, text: label }), el)]; };
    const [langs, langsW] = inp("langs", "Languages", (n.languages || []).join(", "));
    const [mk, mkW] = inp("markets", "Countries (e.g. GLOBAL, US, MA)", (n.markets || []).join(", "));
    const [budget, budgetW] = inp("budget", "Daily API units", n.daily_unit_budget, "number");
    const nSeeds = seeds.filter((s) => s.niche_id === n.id);
    const seedIn = h("input", { class: "field", placeholder: "Add a seed keyword", "aria-label": "Seed keyword", style: "flex:1 1 180px" });
    return h("div", { class: "card", style: "padding:16px" },
      h("div", { class: "card-head" }, h("h3", { text: n.name }), h("span", { class: "muted small", text: state.channels.filter((c) => c.niche_id === n.id).map((c) => c.title).join(", ") || "No channels" })),
      h("div", { class: "row", style: "align-items:flex-end" }, langsW, mkW, budgetW),
      h("div", { class: "muted small", text: "Seed keywords: the daily research job searches these every day." }),
      h("div", { class: "row", style: "gap:6px" }, nSeeds.map((s) => h("span", { class: "chip" }, s.term,
        h("button", { type: "button", "aria-label": `Remove ${s.term}`, text: "×", onclick: async () => { await q(sb.from("seed_terms").delete().eq("id", s.id)); render(); } })))),
      h("form", { class: "row", onsubmit: async (e) => { e.preventDefault(); const t = seedIn.value.trim().toLowerCase(); if (!t) return;
        await q(sb.from("seed_terms").insert({ niche_id: n.id, term: t, kind: "topic" })); render(); } }, seedIn, h("button", { class: "btn small", type: "submit", text: "Add" })),
      h("div", { class: "row" }, h("button", { class: "btn primary small", type: "button", text: "Save", onclick: async () => {
        const list = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
        await q(sb.from("niches").update({ languages: list(langs.value), markets: list(mk.value).map((x) => x.toUpperCase()), daily_unit_budget: Number(budget.value) || 2500, weights: w }).eq("id", n.id));
        await loadShared(); toast("Saved");
      } })));
  };
  const newNiche = h("input", { id: "new-niche", class: "field", placeholder: "New niche, e.g. Cars Morocco", style: "flex:1 1 220px" });
  const nichesBox = h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h2", { text: "Niches" }),
      h("form", { class: "row", onsubmit: async (e) => { e.preventDefault(); const name = newNiche.value.trim(); if (!name) return;
        const slug = name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        await q(sb.from("niches").insert({ name, slug, languages: ["en"], markets: ["GLOBAL"] })); await loadShared(); render(); } },
        h("label", { for: "new-niche", class: "sr", text: "New niche" }), newNiche, h("button", { class: "btn", type: "submit", text: "Add niche" }))),
    realNiches().length ? h("div", { class: "grid-cards wide" }, realNiches().map(nicheCard)) : empty("No niches yet."));

  const channelsBox = h("section", { class: "card" }, h("h2", { text: "Network settings" }),
    state.channels.length ? h("div", { class: "tablebox" }, h("table", { style: "min-width:600px" },
      h("thead", {}, h("tr", {}, ["Network", "Niche", "Language", "Countries"].map((t) => h("th", { text: t })))),
      h("tbody", {}, state.channels.map((c) => h("tr", {},
        h("td", { style: "font-weight:500", text: c.title }),
        h("td", {}, h("select", { class: "field", style: "min-height:36px", "aria-label": `Niche for ${c.title}`, onchange: async (e) => { await q(sb.from("channels").update({ niche_id: e.target.value || null }).eq("id", c.id)); await loadShared(); toast("Saved"); } },
          h("option", { value: "", text: "No niche" }), realNiches().map((n) => h("option", { value: n.id, selected: n.id === c.niche_id, text: n.name })))),
        h("td", {}, h("input", { class: "field", style: "min-height:36px;width:70px", value: c.language || "", "aria-label": `Language for ${c.title}`,
          onchange: async (e) => { await q(sb.from("channels").update({ language: e.target.value.trim() || null }).eq("id", c.id)); toast("Saved"); } })),
        h("td", {}, h("input", { class: "field", style: "min-height:36px;width:160px", value: (c.markets || []).join(", "), "aria-label": `Countries for ${c.title}`,
          onchange: async (e) => { await q(sb.from("channels").update({ markets: e.target.value.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean) }).eq("id", c.id)); toast("Saved"); } })))))))
      : empty("No networks yet."));

  const latest = {};
  for (const r of runs) if (!latest[r.job.split(":")[0]]) latest[r.job.split(":")[0]] = r;
  const pill = (s) => h("span", { class: `pill ${s === "ok" ? "ok" : s === "failed" ? "crit" : s === "running" ? "info" : "warn"}`, text: s });
  const jobs = h("section", { class: "card grow3" }, h("h2", { text: "Background jobs" }),
    Object.keys(latest).length ? h("div", { class: "tablebox" }, h("table", { style: "min-width:460px" },
      h("thead", {}, h("tr", {}, ["Job", "Last run", "API units", "Status"].map((t, i) => h("th", { class: i === 2 ? "num" : null, text: t })))),
      h("tbody", {}, Object.entries(latest).map(([name, r]) => h("tr", {}, h("td", { style: "font-weight:500", text: name.replace("_", " ") }), h("td", { class: "muted", text: ago(r.started_at) }),
        h("td", { class: "num", text: fmt(r.units_used) }), h("td", {}, pill(r.status)))))))
      : empty("No job has run yet."),
    h("p", { class: "muted small", style: "margin:0", text: "Channel stats: on the server every 6 h. Research (06:00 UTC), Trends (07:30 UTC) and renders run on GitHub Actions." }));
  const used = quota.filter((r) => r.api === "youtube_data"), total = used.reduce((a, r) => a + r.units, 0);
  const quotaBox = h("section", { class: "card grow2" }, h("h2", { text: "YouTube API today" }),
    h("div", { style: "display:flex;justify-content:space-between" }, h("span", { text: `${fmt(total)} of 10,000 units` }), h("span", { class: "mono", text: `${Math.round(total / 100)}%` })),
    bar(total / 100, total > 9000 ? "#B3261E" : null, true),
    h("p", { class: "muted small", style: "margin:0", text: `About ${Math.max(0, Math.floor((9500 - total) / 102))} keyword analyses left today. Resets at midnight Pacific time.` }));

  // --- Music library
  const moodSel = h("select", { id: "m-mood", class: "field" }, MOODS.map(([v, t]) => h("option", { value: v, text: t })));
  const fileIn = h("input", { id: "m-file", class: "field", type: "file", accept: "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/ogg", multiple: true });
  const upBtn = h("button", { class: "btn primary", type: "button", text: "Upload", onclick: async () => {
    const files = [...fileIn.files];
    if (!files.length) return toast("Choose one or more audio files");
    upBtn.disabled = true; upBtn.textContent = "Uploading…";
    for (const file of files) {
      if (file.size > 50 * 1024 * 1024) { toast(`${file.name} is over 50 MB`); continue; }
      const path = `music/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
      const { error } = await sb.storage.from("renders").upload(path, file, { contentType: file.type || "audio/mpeg" });
      if (error) { toast(`Upload failed: ${error.message}`); continue; }
      const duration = await new Promise((res) => { const a = new Audio(); a.preload = "metadata"; a.onloadedmetadata = () => res(a.duration || null); a.onerror = () => res(null); a.src = URL.createObjectURL(file); });
      await q(sb.from("music_tracks").insert({ mood: moodSel.value, title: file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 120), path, duration }));
    }
    toast("Music added"); render();
  } });
  const byMood = MOODS.map(([m, name]) => [name, tracks.filter((t) => t.mood === m)]).filter(([, list]) => list.length);
  const musicBox = h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h2", { text: "Music library" }), h("span", { class: "muted small", text: `${tracks.length} track${tracks.length === 1 ? "" : "s"}` })),
    h("p", { class: "muted small", style: "margin:0", text: "Upload tracks by mood; the editor picks from them. Safest source: YouTube Studio → Audio Library (no copyright claims). Some Pixabay tracks get Content ID claims." }),
    h("div", { class: "row", style: "align-items:flex-end" },
      h("div", { class: "field-wrap", style: "flex:1 1 180px" }, h("label", { for: "m-mood", text: "Mood" }), moodSel),
      h("div", { class: "field-wrap", style: "flex:2 1 260px" }, h("label", { for: "m-file", text: "Audio files (MP3)" }), fileIn), upBtn),
    byMood.length ? byMood.map(([name, list]) => h("div", { style: "display:flex;flex-direction:column;gap:6px" }, h("h3", { text: `${name} (${list.length})` }),
      list.map((t) => {
        const slot = h("span", {});
        return h("div", { class: "listrow" },
          h("div", { style: "flex:1 1 200px;min-width:0" }, h("div", { style: "font-weight:500", text: t.title }), h("div", { class: "muted small", text: t.duration ? `${Math.floor(t.duration / 60)}:${String(Math.round(t.duration % 60)).padStart(2, "0")}` : "" })),
          slot,
          h("button", { class: "btn small", type: "button", text: "Play", onclick: async (e) => {
            const { data } = await sb.storage.from("renders").createSignedUrl(t.path, 3600);
            if (data?.signedUrl) { slot.replaceChildren(h("audio", { src: data.signedUrl, controls: true, autoplay: true, style: "max-width:240px" })); e.currentTarget.remove(); }
          } }),
          h("button", { class: "btn small ghost", type: "button", text: "Delete", onclick: async () => {
            await sb.storage.from("renders").remove([t.path]); await q(sb.from("music_tracks").delete().eq("id", t.id)); toast("Deleted"); render();
          } }));
      }))) : empty("No music yet. Upload a few tracks per mood (epic, phonk, oriental…)."));

  return [pageHead("Settings", "Niches, channels, music and background jobs."), nichesBox, channelsBox, musicBox, h("div", { class: "cols" }, jobs, quotaBox)];
};

// ==================================================================
// Actions
// ==================================================================
async function refreshChannel(channelId, btn) {
  if (btn) { btn.disabled = true; btn.textContent = "Refreshing…"; }
  try {
    const { data, error } = await sb.functions.invoke("channel-sync", { body: channelId ? { channel_id: channelId } : {} });
    if (error) throw error;
    const errs = Object.values(data?.details || {}).filter((d) => d.error).map((d) => d.error);
    toast(errs.length ? `Refreshed with issues: ${errs[0]}` : "Stats refreshed");
    await loadShared(); render();
  } catch (e) { toast(`Refresh failed: ${e.message || e}`); if (btn) { btn.disabled = false; btn.textContent = channelId ? "Refresh now" : "Refresh stats"; } }
}
async function startOAuth(networkId) {
  try {
    const { data, error } = await sb.functions.invoke("google-oauth", { body: { action: "start", return_to: location.origin + location.pathname, channel_id: typeof networkId === "string" ? networkId : undefined } });
    if (error) throw error;
    location.href = data.url;
  } catch (e) { toast(`Google connection isn’t ready: ${e.message || e}`); }
}

// ==================================================================
// Boot + sign-in (Google, or email + password; password created once)
// ==================================================================
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  const app = document.getElementById("app"), login = document.getElementById("login");
  if (!session) { app.hidden = true; login.hidden = false; return; }
  if (!(await q(sb.rpc("am_i_allowed")))) {
    app.hidden = true; login.hidden = false;
    document.getElementById("login-msg").textContent = `${session.user.email} is not on the allow-list.`;
    await sb.auth.signOut(); return;
  }
  login.hidden = true; app.hidden = false;
  await loadShared();
  render();
}
let creating = false;
function setLoginMode(create) {
  creating = create;
  document.getElementById("login-title").textContent = create ? "Create your password" : "Sign in";
  document.getElementById("login-intro").textContent = create ? "One-time setup. Use the allow-listed email and a password of at least 8 characters." : "Only allow-listed accounts can see data.";
  document.getElementById("confirm-wrap").hidden = !create;
  document.getElementById("login-password2").required = create;
  document.getElementById("login-password").autocomplete = create ? "new-password" : "current-password";
  document.getElementById("login-submit").textContent = create ? "Create account" : "Sign in";
  document.getElementById("login-toggle").textContent = create ? "I already have a password" : "First time? Create your password";
  document.getElementById("login-msg").textContent = "";
}
document.getElementById("login-toggle").addEventListener("click", () => setLoginMode(!creating));
document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim(), password = document.getElementById("login-password").value;
  const msg = document.getElementById("login-msg"), btn = document.getElementById("login-submit");
  if (creating && password !== document.getElementById("login-password2").value) { msg.textContent = "The two passwords don’t match."; return; }
  btn.disabled = true; msg.textContent = creating ? "Creating your account…" : "Signing in…";
  const { data, error } = creating ? await sb.auth.signUp({ email, password }) : await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false;
  if (error) { msg.textContent = /invalid login/i.test(error.message) ? "Wrong email or password." : error.message; return; }
  if (creating && !data.session) { msg.textContent = "Account created but waiting for email confirmation. Turn off “Confirm email” in Supabase, then sign in."; setLoginMode(false); return; }
  boot();
});
document.getElementById("login-google").addEventListener("click", async () => {
  const msg = document.getElementById("login-msg");
  msg.textContent = "Opening Google…";
  const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: "select_account" } } });
  if (error) msg.textContent = error.message;
});
/** The Google button shows only once Google is switched on in Supabase; a sign-in Google refused comes back in the URL. */
async function setUpGoogleSignIn() {
  const params = new URLSearchParams(location.search);
  if (params.get("error")) {
    document.getElementById("login-msg").textContent = `Google sign-in failed: ${params.get("error_description") || params.get("error")}`;
    history.replaceState(null, "", location.pathname + location.hash);
  }
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } });
    document.getElementById("google-wrap").hidden = !(await r.json()).external?.google;
  } catch { /* the password form still works */ }
}
setUpGoogleSignIn();
document.getElementById("sign-out").addEventListener("click", async () => { await sb.auth.signOut(); location.hash = ""; boot(); });
window.addEventListener("hashchange", () => { if (!document.getElementById("app").hidden) render(); });
sb.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") boot(); });
boot();
