import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

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
const diffColor = (d) => (d < 25 ? "#15803D" : d < 50 ? "#0F6B63" : d < 75 ? "#B45309" : "#B42318");
function bar(pct, color, thick) {
  return h("div", { class: thick ? "bar thick" : "bar" }, h("div", { style: `width:${Math.max(pct, 2)}%;${color ? `background:${color}` : ""}` }));
}
function spark(values, w = 84, hgt = 24) {
  const vals = values.filter((v) => v !== null && v !== undefined).map(Number);
  if (vals.length < 2) return null;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * (w - 4) + 2},${hgt - 2 - ((v - min) / span) * (hgt - 4)}`).join(" ");
  return svg("svg", { width: w, height: hgt, viewBox: `0 0 ${w} ${hgt}`, "aria-hidden": "true", class: "spark" },
    svg("polyline", { points: pts, fill: "none", stroke: "#0F6B63", "stroke-width": "1.75" }));
}
function lineChart(points, label) {
  const w = 640, ht = 200, pl = 40, pr = 10, pt = 14, pb = 28;
  const max = Math.max(...points.map((p) => p.y), 1);
  const X = (i) => pl + (i / Math.max(points.length - 1, 1)) * (w - pl - pr);
  const Y = (v) => pt + (1 - v / max) * (ht - pt - pb);
  const g = svg("svg", { viewBox: `0 0 ${w} ${ht}`, role: "img", "aria-label": label, style: "width:100%;height:auto" });
  [0, 0.5, 1].forEach((f) => {
    g.append(svg("line", { x1: pl, x2: w - pr, y1: Y(max * f), y2: Y(max * f), stroke: f === 0 ? "#CFCFC8" : "#EFEFEA" }));
    const t = svg("text", { x: pl - 6, y: Y(max * f) + 4, "text-anchor": "end", "font-size": "11", fill: "#5C5F66" }); t.textContent = Math.round(max * f); g.append(t);
  });
  [0, points.length - 1].forEach((i) => {
    const t = svg("text", { x: X(i), y: ht - 8, "text-anchor": i ? "end" : "start", "font-size": "11", fill: "#5C5F66" }); t.textContent = points[i].x; g.append(t);
  });
  g.append(svg("polyline", { fill: "none", stroke: "#0F6B63", "stroke-width": "2.5", points: points.map((p, i) => `${X(i)},${Y(p.y)}`).join(" ") }));
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
const VOICES = {
  en: [["en-US-AndrewNeural-Male", "Andrew (US, male)"], ["en-US-BrianNeural-Male", "Brian (US, male)"], ["en-US-ChristopherNeural-Male", "Christopher (US, male)"],
       ["en-US-GuyNeural-Male", "Guy (US, male)"], ["en-US-AvaNeural-Female", "Ava (US, female)"], ["en-US-JennyNeural-Female", "Jenny (US, female)"],
       ["en-GB-RyanNeural-Male", "Ryan (UK, male)"], ["en-GB-SoniaNeural-Female", "Sonia (UK, female)"]],
  fr: [["fr-FR-HenriNeural-Male", "Henri (male)"], ["fr-FR-RemyMultilingualNeural-Male", "Rémy (male)"], ["fr-FR-DeniseNeural-Female", "Denise (female)"],
       ["fr-FR-VivienneMultilingualNeural-Female", "Vivienne (female)"]],
  ar: [["ar-MA-JamalNeural-Male", "Jamal (Morocco, male)"], ["ar-MA-MounaNeural-Female", "Mouna (Morocco, female)"], ["ar-SA-HamedNeural-Male", "Hamed (Saudi, male)"],
       ["ar-SA-ZariyahNeural-Female", "Zariyah (Saudi, female)"], ["ar-EG-ShakirNeural-Male", "Shakir (Egypt, male)"], ["ar-EG-SalmaNeural-Female", "Salma (Egypt, female)"]],
  es: [["es-ES-AlvaroNeural-Male", "Álvaro (male)"], ["es-ES-ElviraNeural-Female", "Elvira (female)"]],
  de: [["de-DE-ConradNeural-Male", "Conrad (male)"], ["de-DE-FlorianMultilingualNeural-Male", "Florian (male)"], ["de-DE-KatjaNeural-Female", "Katja (female)"]],
};
const MOODS = [["epic", "Epic / cinematic"], ["suspense", "Suspense / dark"], ["phonk", "Phonk"], ["trap", "Trap / hip-hop"], ["upbeat", "Upbeat / energetic"],
  ["emotional", "Emotional / piano"], ["lofi", "Lo-fi / chill"], ["oriental", "Oriental / Arabic"], ["latin", "Latin / Spanish guitar"], ["other", "Other"]];
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
  [state.channels, state.niches] = await Promise.all([
    q(sb.from("channels").select("*").order("created_at")),
    q(sb.from("niches").select("*").order("created_at")),
  ]);
  const sel = document.getElementById("channel-switch");
  sel.replaceChildren(h("option", { value: "all", text: "All channels" }), ...state.channels.map((c) => h("option", { value: c.id, text: c.title })));
  sel.value = state.channels.some((c) => c.id === state.channel) ? state.channel : "all";
}

const VIEWS = {};
async function render() {
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
  if (state.unmount) { state.unmount(); state.unmount = null; }
  const route = parseRoute();
  const section = { keyword: "research", channel: "channels", edit: "studio" }[route.name] || route.name;
  document.querySelectorAll(".side-links a").forEach((a) =>
    a.dataset.route === section ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  const fn = VIEWS[route.name] || VIEWS.home;
  view().replaceChildren(h("div", { class: "loading", text: "Loading…" }));
  try {
    const nodes = await fn(route);
    if (parseRoute().name === route.name) view().replaceChildren(...[nodes].flat().filter(Boolean));
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
  const [rows, daily, alerts, ideas] = await Promise.all([
    q(sb.rpc("channel_overview", { p_days: days })),
    q(sb.rpc("portfolio_daily", { p_days: days })),
    q(sb.from("alerts").select("*").is("resolved_at", null).order("created_at", { ascending: false }).limit(6)),
    q(sb.from("ideas").select("*").in("stage", ["new", "shortlisted"]).order("score", { ascending: false, nullsFirst: false }).limit(5)),
  ]);
  const sum = (k) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
  const connected = rows.some((r) => r.connected);
  const kpi = (label, value, d, series) => h("div", { class: "kpi" }, h("div", { class: "label", text: label }), h("div", { class: "value", text: value }),
    h("div", { class: "foot" }, d, series ? spark(series) : null));
  const na = h("span", { class: "flat", text: "connect a channel" });

  return [
    pageHead("Home", `${rows.length} channels · last ${days} days`,
      seg([[7, "7d"], [28, "28d"], [90, "90d"]], days, (v) => { state.period = v; render(); }, "Period")),
    h("section", { class: "kpis" },
      kpi("Views", fmt(sum("views")), connected ? delta(sum("views"), sum("views_prev")) : na, daily.map((d) => d.views)),
      kpi("Watch hours", fmt(sum("watch_hours")), connected ? delta(sum("watch_hours"), sum("watch_hours_prev")) : na, daily.map((d) => d.watch_hours)),
      kpi("Net subscribers", (sum("subs_net") >= 0 ? "+" : "") + fmt(sum("subs_net")), connected ? delta(sum("subs_net"), sum("subs_net_prev")) : na),
      kpi("Videos published", fmt(sum("uploads")), h("span", { class: "flat", text: `last ${days} days` }))),
    h("section", { class: "card" },
      h("div", { class: "card-head" }, h("h2", { text: "Channels" }), h("a", { href: "#/channels", class: "small", text: "Manage channels" })),
      rows.length ? h("div", { class: "tablebox" }, h("table", { style: "min-width:680px" },
        h("thead", {}, h("tr", {}, ["Channel", "Subscribers", "Views", "Watch hours", "YPP watch hours (12 mo)", ""].map((t, i) => h("th", { class: [1, 2, 3].includes(i) ? "num" : null, text: t })))),
        h("tbody", {}, rows.map((r) => h("tr", { class: "clickable", tabindex: "0", onclick: () => go(`#/channel/${r.channel_id}`), onkeydown: (e) => e.key === "Enter" && go(`#/channel/${r.channel_id}`) },
          h("td", {}, h("div", { class: "row", style: "gap:10px;flex-wrap:nowrap" }, r.thumbnail_url ? h("img", { class: "avatar sm", src: r.thumbnail_url, alt: "" }) : h("span", { class: "avatar sm" }),
            h("div", {}, h("div", { style: "font-weight:500", text: r.title }), h("div", { class: "muted small", text: r.niche_name || "No niche" })))),
          h("td", { class: "num", text: fmt(r.subscribers) }),
          h("td", { class: "num", text: r.connected ? fmt(r.views) : "—" }),
          h("td", { class: "num", text: r.connected ? fmt(r.watch_hours) : "—" }),
          h("td", { style: "min-width:180px" }, r.connected
            ? [bar(pctOf(r.watch_hours_12m, 8000), null), h("div", { class: "muted small", style: "margin-top:6px", text: `${fmt(r.watch_hours_12m)} / 8,000 h` })]
            : h("span", { class: "muted small", text: "Not connected" })),
          h("td", {}, r.open_critical ? h("span", { class: "pill crit", text: "Needs attention" }) : null))))))
        : empty("No channels yet.", h("a", { class: "btn primary", href: "#/channels", text: "Connect a channel" }))),
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
    h("label", { for: "kw-q", class: "sr", text: "Keyword" }), input, mSel, lSel, sSel, h("button", { class: "btn primary", type: "submit", text: "Analyze" }));
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

function videoCard(v, scope) {
  return h("article", { class: "vcard" },
    h("a", { class: "thumb", href: `https://www.youtube.com/watch?v=${v.youtube_video_id}`, target: "_blank", rel: "noopener" },
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
      h("button", { class: "btn small", type: "button", style: "margin-top:auto", text: "Save as idea", onclick: () => makeIdea({ title: v.title, niche_id: scope?.global ? null : v.niche_id,
        score: Math.min(100, Math.round(40 + Number(v.outlier_score || 0) * 3)), sources: [{ type: "outlier", ref: v.youtube_video_id }] }) })));
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
            h("a", { href: `https://www.youtube.com/watch?v=${v.youtube_video_id}`, target: "_blank", rel: "noopener", style: "color:inherit;font-weight:500", text: v.title }))),
          h("td", { class: "muted", text: v.channel_title || "—" }), h("td", { class: "num", text: fmtc(v.subscribers) }),
          h("td", { class: "num", text: fmtc(v.views) }), h("td", { class: "num", text: fmtc(v.views / days) }), h("td", { class: "muted", text: ago(v.published_at) }));
      }))))
      : empty("No videos found on page 1."));

  return [searchBar(route, scope, { term, market, lang }), head, stats, h("div", { class: "cols" }, relSection, side), page1];
};

// ==================================================================
// Ideas
// ==================================================================
const BOARD = [
  ["Ideas", ["new"], "Saved from research"],
  ["Shortlisted", ["shortlisted"], "Worth making"],
  ["In Studio", ["assigned", "scripted"], "Script being written"],
  ["Rendered", ["produced", "scheduled"], "Video ready"],
  ["Published", ["published"], "Live"],
];
VIEWS.ideas = async () => {
  let iq = sb.from("ideas").select("*").neq("stage", "archived").order("score", { ascending: false, nullsFirst: false });
  if (state.channel !== "all") iq = iq.or(`channel_id.eq.${state.channel},channel_id.is.null`);
  const ideas = await q(iq);
  const update = async (id, values) => { await q(sb.from("ideas").update(values).eq("id", id)); render(); };
  const titleIn = h("input", { id: "idea-title", class: "field", placeholder: "Add an idea…", style: "flex:1 1 260px" });
  const add = h("form", { class: "row", onsubmit: async (e) => { e.preventDefault(); if (!titleIn.value.trim()) return;
    await makeIdea({ title: titleIn.value.trim(), channel_id: state.channel !== "all" ? state.channel : null, sources: [{ type: "manual" }] }); render(); } },
    h("label", { for: "idea-title", class: "sr", text: "Idea title" }), titleIn, h("button", { class: "btn", type: "submit", text: "Add" }));

  const board = h("div", { class: "board" }, h("div", { class: "board-inner" }, BOARD.map(([name, stages, hint], ci) => {
    const cards = ideas.filter((i) => stages.includes(i.stage));
    return h("section", { class: "col", "aria-label": name },
      h("div", { class: "col-head" }, h("h3", { style: "font-size:14px", text: name }), h("span", { class: "mono small muted", text: String(cards.length) })),
      h("div", { class: "muted small", style: "padding:0 4px", text: hint }),
      cards.map((i) => h("article", { class: "icard" },
        h("div", { style: "display:flex;justify-content:space-between;align-items:center;gap:8px" }, scorePill(i.score),
          h("span", { class: "muted small", text: channelById(i.channel_id)?.title || "No channel" })),
        h("a", { class: "title", href: `#/studio/${i.id}`, text: i.title }),
        h("div", { class: "acts" },
          ci === 0 ? h("button", { class: "btn small", type: "button", text: "Shortlist", onclick: () => update(i.id, { stage: "shortlisted" }) }) : null,
          ci >= 1 && ci <= 3 ? h("a", { class: "btn small primary", href: `#/studio/${i.id}`, text: "Open in Studio" }) : null,
          ci === 3 ? h("button", { class: "btn small", type: "button", text: "Mark published", onclick: () => update(i.id, { stage: "published" }) }) : null,
          h("button", { class: "btn small ghost", type: "button", text: "Archive", onclick: () => update(i.id, { stage: "archived" }) })))));
  })));
  return [pageHead("Ideas", state.channel !== "all" ? `For ${channelById(state.channel)?.title} and unassigned ideas` : "All channels", add), board];
};

// ==================================================================
// Studio: script -> render -> download (MoneyPrinterTurbo on GitHub Actions)
// ==================================================================
VIEWS.studio = async (route) => {
  if (route.id) return studioEditor(route.id);
  let iq = sb.from("ideas").select("*").in("stage", ["shortlisted", "assigned", "scripted", "produced", "scheduled"]).order("updated_at", { ascending: false });
  if (state.channel !== "all") iq = iq.eq("channel_id", state.channel);
  const [ideas, jobs] = await Promise.all([q(iq), q(sb.from("render_jobs").select("*").order("created_at", { ascending: false }).limit(15))]);
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
        const { data } = await sb.storage.from("renders").createSignedUrl(j.output_path, 3600);
        if (data?.signedUrl) preview.replaceChildren(h("video", { class: "player", src: data.signedUrl, controls: true, playsinline: true }));
        e.currentTarget.remove();
      } }) : null,
      j.status === "done" ? h("button", { class: "btn small primary", type: "button", text: "Download", onclick: async () => {
        const { data } = await sb.storage.from("renders").createSignedUrl(j.output_path, 3600, { download: `${(j.params?.title || "video").replace(/[^\w-]+/g, "_").slice(0, 60)}.mp4` });
        if (data?.signedUrl) location.href = data.signedUrl;
      } }) : null,
      j.status === "failed" ? h("button", { class: "btn small", type: "button", text: "Retry", onclick: async () => {
        const { error } = await sb.functions.invoke("render", { body: { retry: j.id } }); toast(error ? "Retry failed" : "Render restarted"); render();
      } }) : null,
      j.run_url ? h("a", { class: "btn small ghost", href: j.run_url, target: "_blank", rel: "noopener", text: "Log" }) : null));
  return row;
}

async function studioEditor(ideaId) {
  const idea = await q(sb.from("ideas").select("*").eq("id", ideaId).maybeSingle());
  if (!idea) return [empty("Project not found.", h("a", { class: "btn", href: "#/studio", text: "Back to Studio" }))];
  const [projects, jobs] = await Promise.all([
    q(sb.from("video_projects").select("*").eq("idea_id", ideaId).order("updated_at", { ascending: false }).limit(1)),
    q(sb.from("render_jobs").select("*").eq("idea_id", ideaId).is("project_id", null).order("created_at", { ascending: false }).limit(5)),
  ]);
  const project = projects[0] || null;
  const ch = channelById(idea.channel_id);
  const style = { language: "en", voice: "en-US-AndrewNeural-Male", voice_rate: 1.1, aspect: "9:16", ...(ch?.video_style || {}), ...(project ? { language: project.language, voice: project.voice, voice_rate: Number(project.voice_rate), aspect: project.aspect } : {}) };

  const f = {};
  const field = (id, label, el, hint) => h("div", { class: "field-wrap" }, h("label", { for: id, text: label }), el, hint ? h("div", { class: "muted small", text: hint }) : null);
  f.title = h("input", { id: "s-title", class: "field", dir: "auto", value: project?.title || idea.video_title || idea.title });
  f.channel = h("select", { id: "s-channel", class: "field" }, h("option", { value: "", text: "No channel" }), state.channels.map((c) => h("option", { value: c.id, selected: c.id === idea.channel_id, text: c.title })));
  f.script = h("textarea", { id: "s-script", class: "field script", rows: "14", dir: "auto", value: idea.script || "",
    placeholder: "One line = one scene. First line = the hook.\nAdd footage words in brackets at the end of a line:\n\nWhat if Lamine Yamal signed for Real Madrid? [football stadium night, crowd cheering]\nThe Bernabéu explodes. [stadium fireworks]" });
  const counter = h("div", { class: "muted small" });
  const updateCount = () => {
    const lines = f.script.value.split("\n").filter((l) => l.trim()).length;
    const w = f.script.value.replace(/\[[^\]]*\]/g, " ").trim().split(/\s+/).filter(Boolean).length;
    counter.textContent = `${lines} scene${lines === 1 ? "" : "s"} · ${w} words · about ${Math.round(w / 2.6)} s of voice`;
  };
  f.script.addEventListener("input", updateCount); updateCount();
  f.terms = h("input", { id: "s-terms", class: "field", value: (idea.search_terms || []).join(", "), placeholder: "e.g. football stadium, night city, car showroom" });
  f.language = h("select", { id: "s-lang", class: "field" }, LANGS.filter(([v]) => VOICES[v]).map(([v, t]) => h("option", { value: v, selected: v === style.language, text: t })));
  f.voice = h("select", { id: "s-voice", class: "field" });
  const fillVoices = () => { const list = VOICES[f.language.value] || VOICES.en; f.voice.replaceChildren(...list.map(([v, t]) => h("option", { value: v, selected: v === style.voice, text: t }))); };
  f.language.addEventListener("change", fillVoices); fillVoices();
  f.rate = h("select", { id: "s-rate", class: "field" }, [[0.9, "Slower"], [1, "Normal"], [1.1, "Shorts pace"], [1.2, "Fast"]].map(([v, t]) => h("option", { value: v, selected: Number(style.voice_rate) === v, text: t })));
  f.aspect = h("select", { id: "s-aspect", class: "field" }, [["9:16", "Short / Reel (9:16)"], ["16:9", "Long video (16:9)"], ["1:1", "Square (1:1)"]].map(([v, t]) => h("option", { value: v, selected: v === style.aspect, text: t })));
  f.desc = h("textarea", { id: "s-desc", class: "field", rows: "3", dir: "auto", value: idea.video_description || "" });
  f.tags = h("input", { id: "s-tags", class: "field", value: (idea.video_tags || []).join(", ") });

  const terms = () => f.terms.value.split(",").map((t) => t.trim()).filter(Boolean);
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
        settings: project?.settings || chosen?.video_style?.editor || {}, default_terms: terms(),
      } });
      if (error) { let msg = error.message; try { msg = (await error.context.json()).error || msg; } catch { /* keep */ } throw new Error(msg); }
      if (data.error) toast(data.error);
      else if (!data.footage) toast("Scenes ready. Stock clip search isn't set up yet (PIXABAY_API_KEY in Supabase).");
      go(`#/edit/${data.project_id}`);
    } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = project ? "Rebuild scenes from script" : "Create scenes →"; }
  };
  const buildBtn = h("button", { class: `btn ${project ? "" : "primary"}`, type: "button", text: project ? "Rebuild scenes from script" : "Create scenes →", onclick: (e) => build(e.currentTarget) });
  const saveStyle = h("button", { class: "btn small ghost", type: "button", text: "Use as this channel’s default voice & format", onclick: async () => {
    if (!f.channel.value) return toast("Pick a channel first");
    const cur = channelById(f.channel.value)?.video_style || {};
    await q(sb.from("channels").update({ video_style: { ...cur, language: f.language.value, voice: f.voice.value, voice_rate: Number(f.rate.value), aspect: f.aspect.value } }).eq("id", f.channel.value));
    await loadShared(); toast("Saved as channel default");
  } });

  return [
    h("header", { class: "head" }, h("div", { class: "head-text" }, h("a", { href: "#/studio", class: "small", text: "← Studio" }), h("h1", { text: project?.title || idea.video_title || idea.title })),
      h("div", { class: "row" }, h("button", { class: "btn", type: "button", text: "Save", onclick: () => save(false) }), buildBtn,
        project ? h("a", { class: "btn primary", href: `#/edit/${project.id}`, text: "Open editor →" }) : null)),
    project ? h("p", { class: "muted small", style: "margin:0", text: "Rebuilding keeps the voice and clip of every line you didn't change." }) : null,
    h("div", { class: "cols" },
      h("section", { class: "card grow3" }, h("h2", { text: "Script" }),
        field("s-title", "Video title", f.title), field("s-script", "Voice-over · one line per scene", f.script), counter,
        field("s-terms", "Default footage searches (used for lines without [brackets])", f.terms, "English visual words work best: “crowd cheering”, “red sports car”.")),
      h("section", { class: "card grow2" }, h("h2", { text: "Voice & format" }),
        field("s-channel", "Channel", f.channel),
        h("div", { class: "form-grid" }, field("s-lang", "Language", f.language), field("s-voice", "Voice", f.voice), field("s-rate", "Voice speed", f.rate), field("s-aspect", "Format", f.aspect)),
        saveStyle,
        h("p", { class: "muted small", style: "margin:0", text: "Captions, hook text, music and sound effects are set in the editor." }))),
    h("details", { class: "card" }, h("summary", { text: "Publishing details (description, tags)" }),
      field("s-desc", "Description", f.desc), field("s-tags", "Tags (comma-separated)", f.tags),
      h("p", { class: "muted small", style: "margin:0", text: "Turn on “Altered or synthetic content” when uploading videos with realistic AI visuals of real people." })),
    jobs.length ? h("section", { class: "card" }, h("h2", { text: "Earlier quick renders" }), jobs.map((j) => renderRow(j))) : null,
  ];
}

// Video editor (React bundle, loaded on demand)
const EDITOR_VERSION = "2";
VIEWS.edit = async (route) => {
  const mod = await import(`./editor.bundle.js?v=${EDITOR_VERSION}`);
  const el = h("div", { class: "ed-root" });
  state.unmount = mod.mountEditor(el, { sb, projectId: route.id, toast, VOICES, LANGS });
  return el;
};

// ==================================================================
// Channels
// ==================================================================
VIEWS.channels = async () => {
  const rows = await q(sb.rpc("channel_overview", { p_days: 28 }));
  return [
    pageHead("Channels", "Connect each channel once with Google. Brand-account channels are connected one at a time.",
      h("button", { class: "btn", type: "button", text: "Refresh stats", onclick: (e) => refreshChannel(null, e.currentTarget) }),
      h("button", { class: "btn primary", type: "button", text: "+ Connect channel", onclick: startOAuth })),
    rows.length ? h("section", { class: "grid-cards wide" }, rows.map((r) => h("a", { class: "ch-card", href: `#/channel/${r.channel_id}` },
      h("div", { class: "row", style: "gap:12px;flex-wrap:nowrap" }, r.thumbnail_url ? h("img", { class: "avatar", src: r.thumbnail_url, alt: "" }) : h("span", { class: "avatar" }),
        h("div", { style: "min-width:0" }, h("div", { style: "font-weight:600", text: r.title }), h("div", { class: "muted small", text: `${r.niche_name || "No niche"} · ${(r.language || "—").toUpperCase()}` }))),
      h("div", { class: "stats3" },
        h("div", {}, h("span", { text: "Subscribers" }), h("span", { class: "mono", text: fmt(r.subscribers) })),
        h("div", {}, h("span", { text: "Views 28 d" }), h("span", { class: "mono", text: r.connected ? fmtc(r.views) : "—" })),
        h("div", {}, h("span", { text: "Uploads 28 d" }), h("span", { class: "mono", text: fmt(r.uploads) }))),
      h("span", { class: `pill ${r.connected ? "ok" : "warn"}`, text: r.connected ? "Connected" : "Public stats only" }))))
      : empty("No channels yet.", h("button", { class: "btn primary", type: "button", text: "Connect a channel", onclick: startOAuth })),
  ];
};

VIEWS.channel = async (route) => {
  const id = route.id;
  const tab = route.params.get("tab") || "overview";
  const [overview, daily] = await Promise.all([q(sb.rpc("channel_overview", { p_days: 28 })), q(sb.rpc("portfolio_daily", { p_days: 28, p_channel: id }))]);
  const ch = overview.find((r) => r.channel_id === id);
  if (!ch) return [empty("Channel not found.")];
  const chRow = channelById(id);
  const header = h("header", { class: "head" },
    h("div", { class: "row", style: "gap:16px;flex-wrap:nowrap" }, ch.thumbnail_url ? h("img", { class: "avatar", src: ch.thumbnail_url, alt: "" }) : h("span", { class: "avatar" }),
      h("div", { class: "head-text" }, h("a", { href: "#/channels", class: "small", text: "← Channels" }), h("h1", { style: "font-size:26px", text: ch.title }),
        h("div", { class: "muted small" }, `${ch.niche_name || "No niche"} · `, ch.connected ? h("span", { class: "up", text: "Connected" }) : h("span", { class: "flat", text: "Public stats only" })))),
    h("div", { class: "row" },
      h("a", { class: "btn", href: link("research", { scope: chRow?.niche_id || "global" }), text: "Research for this channel" }),
      h("button", { class: "btn", type: "button", text: "Refresh", onclick: (e) => refreshChannel(id, e.currentTarget) }),
      ch.connected ? null : h("button", { class: "btn primary", type: "button", text: "Connect with Google", onclick: startOAuth })));
  const tabs = h("div", { class: "tabs", role: "tablist" },
    [["overview", "Overview"], ["videos", "Videos"], ["search", "Search terms"], ["audience", "Audience"]].map(([v, t]) =>
      h("button", { role: "tab", type: "button", "aria-selected": String(v === tab), text: t, onclick: () => setParams(route, { tab: v }) })));
  let body;
  if (tab === "overview") {
    const vids = await q(sb.from("v_own_video_latest").select("*").eq("channel_id", id).order("published_at", { ascending: false }).limit(6));
    const k = (label, value, d) => h("div", { class: "kpi" }, h("div", { class: "label", text: label }), h("div", { class: "value", style: "font-size:24px", text: value }), d);
    body = [
      h("section", { class: "kpis" }, k("Subscribers", fmt(ch.subscribers)),
        k("Views (28 d)", ch.connected ? fmt(ch.views) : "—", ch.connected ? delta(ch.views, ch.views_prev) : null),
        k("Watch hours (28 d)", ch.connected ? fmt(ch.watch_hours) : "—", ch.connected ? delta(ch.watch_hours, ch.watch_hours_prev) : null),
        k("Uploads (28 d)", fmt(ch.uploads))),
      h("div", { class: "cols" },
        h("section", { class: "card grow2" }, h("h2", { text: "Monetization" }), yppRow("Subscribers", ch.subscribers, 1000, ""),
          ch.connected ? yppRow("Watch hours, 12 months", ch.watch_hours_12m, 8000, " h") : h("p", { class: "muted small", text: "Connect with Google to track watch hours." }),
          daily.length > 1 ? h("div", {}, h("div", { class: "muted small", text: "Daily views, 28 days" }), spark(daily.map((d) => d.views), 300, 48)) : null),
        h("section", { class: "card grow3" }, h("h2", { text: "Latest videos vs channel average" }),
          vids.length ? vids.map((v) => h("div", { class: "listrow" }, h("span", { class: `pill ${v.is_short ? "short" : "long"}`, text: v.is_short ? "Short" : "Long" }),
            h("a", { href: `https://www.youtube.com/watch?v=${v.youtube_video_id}`, target: "_blank", rel: "noopener", style: "flex:1 1 220px;min-width:0;font-weight:500;color:inherit", text: v.title }),
            h("span", { class: "mono small", text: fmt(v.views) }), multPill(v.vs_baseline))) : empty("No videos yet."))),
    ];
  } else if (tab === "videos") {
    const vids = await q(sb.from("v_own_video_latest").select("*").eq("channel_id", id).order("published_at", { ascending: false }).limit(100));
    body = h("section", { class: "card" }, vids.length ? h("div", { class: "tablebox" }, h("table", { style: "min-width:640px" },
      h("thead", {}, h("tr", {}, ["Video", "Type", "Published", "Views", "Likes", "vs average"].map((t, i) => h("th", { class: i > 2 ? "num" : null, text: t })))),
      h("tbody", {}, vids.map((v) => h("tr", {},
        h("td", {}, h("a", { href: `https://www.youtube.com/watch?v=${v.youtube_video_id}`, target: "_blank", rel: "noopener", style: "font-weight:500;color:inherit", text: v.title })),
        h("td", {}, h("span", { class: `pill ${v.is_short ? "short" : "long"}`, text: v.is_short ? "Short" : "Long" })),
        h("td", { class: "muted", text: v.published_at ? new Date(v.published_at).toLocaleDateString("en-GB") : "—" }),
        h("td", { class: "num", text: fmt(v.views) }), h("td", { class: "num", text: fmt(v.likes) }), h("td", { class: "num" }, multPill(v.vs_baseline)))))))
      : empty("No videos yet."));
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
  return [header, tabs, body].flat();
};
function yppRow(label, val, target, unit) {
  const p = pctOf(val, target);
  return h("div", { style: "display:flex;flex-direction:column;gap:6px" },
    h("div", { style: "display:flex;justify-content:space-between;font-size:13.5px" }, h("span", { style: "font-weight:500", text: label }), h("span", { class: "mono", text: `${fmtc(val)} / ${fmtc(target)}${unit}` })),
    bar(p, p >= 100 ? "#15803D" : null, true));
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
  if (route.params.get("connected")) toast("Channel connected. Stats are loading.");
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

  const channelsBox = h("section", { class: "card" }, h("h2", { text: "Channel settings" }),
    state.channels.length ? h("div", { class: "tablebox" }, h("table", { style: "min-width:600px" },
      h("thead", {}, h("tr", {}, ["Channel", "Niche", "Language", "Countries"].map((t) => h("th", { text: t })))),
      h("tbody", {}, state.channels.map((c) => h("tr", {},
        h("td", { style: "font-weight:500", text: c.title }),
        h("td", {}, h("select", { class: "field", style: "min-height:36px", "aria-label": `Niche for ${c.title}`, onchange: async (e) => { await q(sb.from("channels").update({ niche_id: e.target.value || null }).eq("id", c.id)); await loadShared(); toast("Saved"); } },
          h("option", { value: "", text: "No niche" }), realNiches().map((n) => h("option", { value: n.id, selected: n.id === c.niche_id, text: n.name })))),
        h("td", {}, h("input", { class: "field", style: "min-height:36px;width:70px", value: c.language || "", "aria-label": `Language for ${c.title}`,
          onchange: async (e) => { await q(sb.from("channels").update({ language: e.target.value.trim() || null }).eq("id", c.id)); toast("Saved"); } })),
        h("td", {}, h("input", { class: "field", style: "min-height:36px;width:160px", value: (c.markets || []).join(", "), "aria-label": `Countries for ${c.title}`,
          onchange: async (e) => { await q(sb.from("channels").update({ markets: e.target.value.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean) }).eq("id", c.id)); toast("Saved"); } })))))))
      : empty("No channels yet."));

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
    bar(total / 100, total > 9000 ? "#B42318" : null, true),
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
  } catch (e) { toast(`Refresh failed: ${e.message || e}`); if (btn) { btn.disabled = false; btn.textContent = "Refresh"; } }
}
async function startOAuth() {
  try {
    const { data, error } = await sb.functions.invoke("google-oauth", { body: { action: "start", return_to: location.origin + location.pathname } });
    if (error) throw error;
    location.href = data.url;
  } catch (e) { toast(`Google connection isn’t ready: ${e.message || e}`); }
}

// ==================================================================
// Boot + sign-in (email + password; password created once)
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
document.getElementById("sign-out").addEventListener("click", async () => { await sb.auth.signOut(); location.hash = ""; boot(); });
document.getElementById("channel-switch").addEventListener("change", (e) => {
  state.channel = e.target.value; store.set("ytc.channel", state.channel);
  const route = parseRoute();
  if (route.name === "research" || route.name === "keyword") { go("#/research"); return; }
  if (route.name === "channel" && state.channel !== "all") { go(`#/channel/${state.channel}`); return; }
  render();
});
window.addEventListener("hashchange", () => { if (!document.getElementById("app").hidden) render(); });
sb.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") boot(); });
boot();
