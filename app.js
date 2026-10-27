import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

// PKCE keeps the sign-in callback in ?code= so it doesn't collide with the #/route hash.
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true } });

// ------------------------------------------------------------------
// Small DOM + format helpers (all external text goes through textContent)
// ------------------------------------------------------------------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
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
function ago(iso) {
  if (!iso) return "—";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
function when(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
}
function delta(cur, prev) {
  if (!prev) return h("span", { class: "flat", text: "no previous data" });
  const p = ((cur - prev) / prev) * 100;
  const cls = p > 0.5 ? "up" : p < -0.5 ? "down" : "flat";
  return h("span", { class: cls, text: `${p > 0 ? "+" : ""}${p.toFixed(0)}% vs prev.` });
}
function scorePill(s) {
  if (s === null || s === undefined) return h("span", { class: "score lo", text: "—" });
  const cls = s >= 80 ? "hi" : s >= 60 ? "mid" : "lo";
  return h("span", { class: `score ${cls}`, text: String(Math.round(s)) });
}
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
  // points: [{x: 'YYYY-MM-DD', y: number}]
  const w = 640, ht = 220, pl = 40, pr = 10, pt = 16, pb = 30;
  const ys = points.map((p) => p.y), max = Math.max(...ys, 1);
  const X = (i) => pl + (i / Math.max(points.length - 1, 1)) * (w - pl - pr);
  const Y = (v) => pt + (1 - v / max) * (ht - pt - pb);
  const g = svg("svg", { viewBox: `0 0 ${w} ${ht}`, role: "img", "aria-label": label, style: "width:100%;height:auto" });
  [0, 0.5, 1].forEach((f) => {
    g.append(svg("line", { x1: pl, x2: w - pr, y1: Y(max * f), y2: Y(max * f), stroke: f === 0 ? "#CFCFC8" : "#EFEFEA" }));
    const t = svg("text", { x: pl - 6, y: Y(max * f) + 4, "text-anchor": "end", "font-size": "11", fill: "#5C5F66" });
    t.textContent = Math.round(max * f);
    g.append(t);
  });
  [0, points.length - 1].forEach((i) => {
    const t = svg("text", { x: X(i), y: ht - 8, "text-anchor": i ? "end" : "start", "font-size": "11", fill: "#5C5F66" });
    t.textContent = points[i].x;
    g.append(t);
  });
  g.append(svg("polyline", { fill: "none", stroke: "#0F6B63", "stroke-width": "2.5", points: points.map((p, i) => `${X(i)},${Y(p.y)}`).join(" ") }));
  return g;
}
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 3200);
}
async function q(p) {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}
function seg(options, current, onPick, label) {
  return h("div", { class: "seg", role: "group", "aria-label": label },
    options.map(([v, text]) => h("button", { type: "button", "aria-pressed": String(v === current), onclick: () => onPick(v), text })));
}
function selectEl(id, options, current, onChange, label) {
  return h("div", { class: "field-wrap" },
    label ? h("label", { for: id, text: label }) : null,
    h("select", { id, class: "field", onchange: (e) => onChange(e.target.value) },
      options.map(([v, text]) => h("option", { value: v, selected: v === current, text }))));
}
const empty = (text) => h("div", { class: "empty", text });

// ------------------------------------------------------------------
// State, routing
// ------------------------------------------------------------------
const state = { period: 28, channels: [], niches: [], channel: localStorage.getItem("ytc.channel") || "all" };
const view = () => document.getElementById("view");

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, "") || "portfolio";
  const [path, qs] = raw.split("?");
  const parts = path.split("/");
  return { name: parts[0] || "portfolio", id: parts[1], params: new URLSearchParams(qs || "") };
}
function go(hash) { location.hash = hash; }
function setParams(route, changes) {
  const p = new URLSearchParams(route.params);
  for (const [k, v] of Object.entries(changes)) (v === null || v === undefined || v === "" ? p.delete(k) : p.set(k, v));
  const base = route.id ? `#/${route.name}/${route.id}` : `#/${route.name}`;
  go(`${base}${p.toString() ? "?" + p : ""}`);
}

async function loadShared() {
  [state.channels, state.niches] = await Promise.all([
    q(sb.from("channels").select("*").order("created_at")),
    q(sb.from("niches").select("*").order("created_at")),
  ]);
  const sel = document.getElementById("channel-switch");
  sel.replaceChildren(
    h("option", { value: "all", text: `All channels (${state.channels.length})` }),
    ...state.channels.map((c) => h("option", { value: c.id, text: c.title })));
  sel.value = state.channels.some((c) => c.id === state.channel) ? state.channel : "all";
}

async function render() {
  const route = parseRoute();
  const active = route.name === "keywords" && route.params.get("tab") === "trends" ? "trends"
    : route.name === "outliers" && route.params.get("tab") === "competitors" ? "competitors" : route.name;
  document.querySelectorAll(".side-links a").forEach((a) =>
    a.dataset.route === active ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  const views = { portfolio: viewPortfolio, channel: viewChannel, keywords: viewKeywords, outliers: viewOutliers, ideas: viewIdeas, settings: viewSettings };
  const fn = views[route.name] || viewPortfolio;
  view().replaceChildren(h("div", { class: "loading", text: "Loading…" }));
  try {
    const nodes = await fn(route);
    view().replaceChildren(...[nodes].flat());
  } catch (e) {
    console.error(e);
    view().replaceChildren(h("div", { class: "card" }, h("h2", { text: "Something went wrong" }), h("p", { class: "muted", text: e.message || String(e) })));
  }
}

const nicheName = (id) => state.niches.find((n) => n.id === id)?.name || "—";
const channelTitle = (id) => state.channels.find((c) => c.id === id)?.title || "—";

async function makeIdea({ title, niche_id, score, sources, channel_id }) {
  await q(sb.from("ideas").insert({ title, niche_id, score, sources, channel_id: channel_id || null }));
  toast("Saved to the idea pipeline");
}

// ------------------------------------------------------------------
// Portfolio
// ------------------------------------------------------------------
async function viewPortfolio() {
  const days = state.period;
  const now = new Date(), in7 = new Date(Date.now() + 7 * 864e5);
  const [rows, daily, alerts, ideas, posts, kws] = await Promise.all([
    q(sb.rpc("channel_overview", { p_days: days })),
    q(sb.rpc("portfolio_daily", { p_days: days })),
    q(sb.from("alerts").select("*").is("resolved_at", null).order("created_at", { ascending: false }).limit(8)),
    q(sb.from("ideas").select("*").in("stage", ["new", "shortlisted"]).order("score", { ascending: false, nullsFirst: false }).limit(5)),
    q(sb.from("blotato_posts").select("channel_id,scheduled_at").eq("status", "scheduled").gte("scheduled_at", now.toISOString()).lte("scheduled_at", in7.toISOString())),
    q(sb.from("v_keyword_scores").select("keyword_id,niche_id,term,market,score,momentum_raw,outlier_count").order("score", { ascending: false }).limit(5)),
  ]);
  const sum = (k) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
  const anyConnected = rows.some((r) => r.connected);
  const nichesCount = new Set(rows.map((r) => r.niche_id).filter(Boolean)).size;

  const kpi = (label, value, d, series) => h("div", { class: "kpi" },
    h("div", { class: "label", text: label }), h("div", { class: "value", text: value }),
    h("div", { class: "foot" }, d, series ? spark(series) : null));
  const analyticsNote = anyConnected ? null : h("span", { class: "flat", text: "connect channels for analytics" });

  const head = h("header", { class: "head" },
    h("div", { class: "head-text" }, h("h1", { text: "Portfolio" }),
      h("p", { class: "muted", style: "margin:0", text: `${rows.length} channels · ${nichesCount} niches · last ${days} days` })),
    h("div", { class: "row" },
      seg([[7, "7d"], [28, "28d"], [90, "90d"]], days, (v) => { state.period = v; render(); }, "Period"),
      h("a", { class: "btn primary", href: "#/settings", text: "+ Connect channel" })));

  const kpis = h("section", { class: "kpis", "aria-label": "Totals" },
    kpi("Views", fmt(sum("views")), anyConnected ? delta(sum("views"), sum("views_prev")) : analyticsNote, daily.map((d) => d.views)),
    kpi("Watch hours", fmt(sum("watch_hours")), anyConnected ? delta(sum("watch_hours"), sum("watch_hours_prev")) : analyticsNote, daily.map((d) => d.watch_hours)),
    kpi("Subscribers gained", (sum("subs_net") >= 0 ? "+" : "") + fmt(sum("subs_net")), anyConnected ? delta(sum("subs_net"), sum("subs_net_prev")) : analyticsNote, daily.map((d) => d.subs_net)),
    kpi("Videos published", fmt(sum("uploads")), h("span", { class: "flat", text: `last ${days} days` })),
    kpi("Open alerts", fmt(alerts.length), h("span", { class: alerts.some((a) => a.severity === "critical") ? "down" : "flat",
      text: `${alerts.filter((a) => a.severity === "critical").length} critical` })));

  const table = h("section", { class: "card", "aria-labelledby": "ch-t" },
    h("div", { class: "card-head" }, h("h2", { id: "ch-t", text: "Channels" }),
      h("span", { class: "muted small", text: "YPP target: 1,000 subs + 8,000 watch hours (new applicants from 1 Feb 2027)" })),
    rows.length ? h("div", { class: "tablebox" }, h("table", { style: "min-width:980px" },
      h("thead", {}, h("tr", {}, ["Channel", "Niche · lang", "Subs", "Views", "Watch h", "Uploads", "YPP watch hours", "Next on Blotato", "Alerts", ""]
        .map((t, i) => h("th", { class: [2, 3, 4, 5].includes(i) ? "num" : null }, t || h("span", { class: "sr", text: "Open" }))))),
      h("tbody", {}, rows.map((r) => h("tr", {},
        h("td", {}, h("div", { class: "row", style: "gap:10px;flex-wrap:nowrap" },
          r.thumbnail_url ? h("img", { class: "avatar sm", src: r.thumbnail_url, alt: "" }) : null,
          h("span", { style: "font-weight:500", text: r.title }))),
        h("td", { class: "muted", text: `${r.niche_name || "No niche"} · ${(r.language || "—").toUpperCase()}` }),
        h("td", { class: "num", text: fmt(r.subscribers) }),
        h("td", { class: "num", text: r.connected ? fmt(r.views) : "—" }),
        h("td", { class: "num", text: r.connected ? fmt(r.watch_hours) : "—" }),
        h("td", { class: "num", text: fmt(r.uploads) }),
        h("td", { style: "min-width:180px" }, r.connected
          ? [bar(pctOf(r.watch_hours_12m, 8000), pctOf(r.watch_hours_12m, 8000) >= 75 ? "#15803D" : null),
             h("div", { class: "muted small", style: "margin-top:6px", text: `${fmt(r.watch_hours_12m)} / 8,000 h · ${Math.round(pctOf(r.watch_hours_12m, 8000))}%` })]
          : h("span", { class: "muted small", text: "Not connected" })),
        h("td", { text: r.next_post_at ? when(r.next_post_at) : "Nothing scheduled" }),
        h("td", {}, r.open_critical ? h("span", { class: "pill crit", text: `${r.open_critical} critical` })
          : r.open_warning ? h("span", { class: "pill warn", text: `${r.open_warning} warning` }) : h("span", { class: "muted", text: "None" })),
        h("td", {}, h("a", { href: `#/channel/${r.channel_id}`, style: "font-weight:500", text: "Open" })))))))
      : empty("No channels yet. Add one in Settings."));

  const opps = h("section", { class: "card grow3", "aria-labelledby": "opp-t" },
    h("div", { class: "card-head" }, h("h2", { id: "opp-t", text: "Top opportunities" }), h("a", { href: "#/ideas", class: "small", text: "Open idea pipeline" })),
    ideas.length ? ideas.map((i) => h("div", { class: "listrow" }, scorePill(i.score),
      h("div", { style: "flex:1 1 240px;min-width:0" }, h("div", { style: "font-weight:500", text: i.title }),
        h("div", { class: "muted small", text: `${nicheName(i.niche_id)} · ${i.stage}` })),
      h("a", { class: "btn small", href: "#/ideas", text: "Open" })))
      : kws.length ? kws.map((k) => h("div", { class: "listrow" }, scorePill(k.score),
        h("div", { style: "flex:1 1 240px;min-width:0" }, h("div", { style: "font-weight:500", text: k.term }),
          h("div", { class: "muted small", text: `${nicheName(k.niche_id)} · ${k.market} · ${k.outlier_count || 0} outliers` })),
        h("button", { class: "btn small", type: "button", text: "Make idea",
          onclick: () => makeIdea({ title: k.term, niche_id: k.niche_id, score: k.score, sources: [{ type: "keyword", ref: k.term }] }) })))
      : empty("Ideas appear here after the first research run."));

  const alertBox = h("section", { class: "card grow2", "aria-labelledby": "al-t" }, h("h2", { id: "al-t", text: "Alerts" }),
    alerts.length ? alerts.map((a) => h("div", { class: "listrow", style: "flex-wrap:nowrap;align-items:flex-start" },
      h("span", { class: `pill ${a.severity === "critical" ? "crit" : a.severity === "warning" ? "warn" : "info"}`, text: a.severity[0].toUpperCase() + a.severity.slice(1) }),
      h("div", { style: "min-width:0" }, h("div", { style: "font-weight:500", text: a.title }), h("div", { class: "muted small", text: `${a.detail || ""} · ${ago(a.created_at)}` }))))
      : empty("No open alerts."));

  // Publishing strip: posts per channel per day, next 7 days
  const days7 = [...Array(7)].map((_, i) => new Date(Date.now() + i * 864e5));
  const key = (d) => d.toISOString().slice(0, 10);
  const counts = {};
  for (const p of posts) counts[`${p.channel_id}|${p.scheduled_at.slice(0, 10)}`] = (counts[`${p.channel_id}|${p.scheduled_at.slice(0, 10)}`] || 0) + 1;
  const strip = h("section", { class: "card", "aria-labelledby": "pub-t" },
    h("div", { class: "card-head" }, h("h2", { id: "pub-t", text: "Publishing, next 7 days" }), h("span", { class: "muted small", text: "Synced from Blotato" })),
    h("div", { class: "tablebox" }, h("div", { style: "display:flex;flex-direction:column;gap:8px" },
      h("div", { class: "strip muted small" }, h("span"), days7.map((d) => h("span", { style: "text-align:center", text: d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" }) }))),
      rows.map((r) => h("div", { class: "strip" }, h("span", { style: "font-weight:500", text: r.title }),
        days7.map((d) => { const n = counts[`${r.channel_id}|${key(d)}`] || 0; return h("div", { class: `cell ${n === 1 ? "one" : n > 1 ? "many" : ""}`, text: n ? String(n) : "–" }); }))))));

  return [head, kpis, table, h("div", { class: "cols" }, opps, alertBox), strip];
}

// ------------------------------------------------------------------
// Channel workspace
// ------------------------------------------------------------------
async function viewChannel(route) {
  const id = route.id || (state.channel !== "all" ? state.channel : state.channels[0]?.id);
  if (!id) return [h("h1", { text: "Channel workspace" }), empty("No channels yet. Add one in Settings.")];
  if (!route.id) { go(`#/channel/${id}`); return []; }
  const tab = route.params.get("tab") || "overview";
  const [overview, daily] = await Promise.all([q(sb.rpc("channel_overview", { p_days: 28 })), q(sb.rpc("portfolio_daily", { p_days: 28, p_channel: id }))]);
  const ch = overview.find((r) => r.channel_id === id);
  if (!ch) return [empty("Channel not found.")];
  const chRow = state.channels.find((c) => c.id === id);

  const header = h("header", { class: "head" },
    h("div", { class: "row", style: "gap:16px" },
      ch.thumbnail_url ? h("img", { class: "avatar", src: ch.thumbnail_url, alt: "" }) : h("div", { class: "avatar" }),
      h("div", { class: "head-text" }, h("h1", { style: "font-size:26px", text: ch.title }),
        h("div", { class: "muted small" }, `${ch.handle || ""} · ${ch.niche_name || "No niche"} · ${(ch.language || "—").toUpperCase()} · `,
          ch.connected ? h("span", { class: "up", text: "Google connected" }) : h("span", { class: "flat", text: "Not connected" })))),
    h("div", { class: "row" },
      chRow?.youtube_channel_id ? h("a", { class: "btn", href: `https://studio.youtube.com/channel/${chRow.youtube_channel_id}`, target: "_blank", rel: "noopener", text: "Open YouTube Studio" }) : null,
      ch.connected ? null : h("button", { class: "btn primary", type: "button", text: "Connect with Google", onclick: startOAuth })));

  const tabs = [["overview", "Overview"], ["videos", "Videos"], ["search", "Search terms"], ["traffic", "Traffic and audience"], ["ideas", "Ideas"]];
  const tabBar = h("div", { class: "tabs", role: "tablist", "aria-label": "Channel sections" },
    tabs.map(([v, t]) => h("button", { role: "tab", type: "button", "aria-selected": String(v === tab), text: t, onclick: () => setParams(route, { tab: v }) })));

  let body;
  if (tab === "overview") {
    const vids = await q(sb.from("v_own_video_latest").select("*").eq("channel_id", id).order("published_at", { ascending: false }).limit(6));
    const k = (label, value, d) => h("div", { class: "kpi" }, h("div", { class: "label", text: label }), h("div", { class: "value", style: "font-size:24px", text: value }), d);
    body = [
      h("section", { class: "kpis" },
        k("Subscribers", fmt(ch.subscribers), null),
        k("Views (28 d)", ch.connected ? fmt(ch.views) : "—", ch.connected ? delta(ch.views, ch.views_prev) : null),
        k("Watch hours (28 d)", ch.connected ? fmt(ch.watch_hours) : "—", ch.connected ? delta(ch.watch_hours, ch.watch_hours_prev) : null),
        k("Net subscribers (28 d)", ch.connected ? fmt(ch.subs_net) : "—", ch.connected ? delta(ch.subs_net, ch.subs_net_prev) : null),
        k("Uploads (28 d)", fmt(ch.uploads), null)),
      h("div", { class: "cols" },
        h("section", { class: "card grow2" }, h("h2", { text: "Monetization progress" }),
          yppRow("Subscribers", ch.subscribers, 1000, ""),
          ch.connected ? yppRow("Watch hours, 12 months", ch.watch_hours_12m, 8000, " h") : h("p", { class: "muted small", text: "Connect with Google to track watch hours and Shorts views." }),
          ch.connected ? yppRow("Shorts views, 90 days", ch.shorts_views_90d, 20000000, "") : null,
          daily.length > 1 ? h("div", {}, h("div", { class: "muted small", text: "Daily views, 28 days" }), spark(daily.map((d) => d.views), 300, 48)) : null),
        h("section", { class: "card grow3" }, h("h2", { text: "Recent videos vs channel baseline" }),
          vids.length ? vids.map((v) => h("div", { class: "listrow" },
            h("span", { class: `pill ${v.is_short ? "short" : "long"}`, text: v.is_short ? "Short" : "Long" }),
            h("a", { href: `https://www.youtube.com/watch?v=${v.youtube_video_id}`, target: "_blank", rel: "noopener", style: "flex:1 1 220px;min-width:0;font-weight:500;color:inherit", text: v.title }),
            h("span", { class: "mono small", text: fmt(v.views) }),
            multPill(v.vs_baseline))) : empty("Videos appear after the first channel stats run."))),
    ];
  } else if (tab === "videos") {
    const vids = await q(sb.from("v_own_video_latest").select("*").eq("channel_id", id).order("published_at", { ascending: false }).limit(100));
    body = h("section", { class: "card" },
      h("p", { class: "muted small", style: "margin:0", text: "Baseline = median views of this channel’s videos of the same format. Editing titles, tags and thumbnails from here comes with the write-access build." }),
      vids.length ? h("div", { class: "tablebox" }, h("table", { style: "min-width:720px" },
        h("thead", {}, h("tr", {}, ["Video", "Type", "Published", "Views", "Likes", "Comments", "vs baseline"].map((t, i) => h("th", { class: i > 2 ? "num" : null, text: t })))),
        h("tbody", {}, vids.map((v) => h("tr", {},
          h("td", {}, h("a", { href: `https://www.youtube.com/watch?v=${v.youtube_video_id}`, target: "_blank", rel: "noopener", style: "font-weight:500;color:inherit", text: v.title })),
          h("td", {}, h("span", { class: `pill ${v.is_short ? "short" : "long"}`, text: v.is_short ? "Short" : "Long" })),
          h("td", { class: "muted", text: v.published_at ? new Date(v.published_at).toLocaleDateString("en-GB") : "—" }),
          h("td", { class: "num", text: fmt(v.views) }), h("td", { class: "num", text: fmt(v.likes) }), h("td", { class: "num", text: fmt(v.comments) }),
          h("td", { class: "num" }, multPill(v.vs_baseline)))))))
        : empty("Videos appear after the first channel stats run."));
  } else if (tab === "search") {
    const terms = await q(sb.from("channel_search_terms").select("*").eq("channel_id", id).order("period_end", { ascending: false }).order("views", { ascending: false }).limit(60));
    const latest = terms[0]?.period_end;
    const cur = terms.filter((t) => t.period_end === latest);
    const scores = chRow?.niche_id ? await q(sb.from("v_keyword_scores").select("term,score").eq("niche_id", chRow.niche_id).in("term", cur.map((t) => t.term.toLowerCase()).slice(0, 100))) : [];
    const sMap = Object.fromEntries(scores.map((s) => [s.term, s.score]));
    body = h("section", { class: "card" },
      h("div", { class: "card-head" }, h("h2", { text: "YouTube searches that brought viewers" }), h("span", { class: "muted small", text: latest ? `28 days to ${latest}` : "" })),
      cur.length ? h("div", { class: "tablebox" }, h("table", { style: "min-width:560px" },
        h("thead", {}, h("tr", {}, h("th", { text: "Search term" }), h("th", { class: "num", text: "Views" }), h("th", { class: "num", text: "Keyword score" }), h("th", {}, h("span", { class: "sr", text: "Explore" })))),
        h("tbody", {}, cur.map((t) => h("tr", {},
          h("td", { style: "font-weight:500", text: t.term }), h("td", { class: "num", text: fmt(t.views) }),
          h("td", { class: "num" }, scorePill(sMap[t.term.toLowerCase()])),
          h("td", {}, h("a", { href: `#/keywords?niche=${chRow?.niche_id || ""}&kw=${encodeURIComponent(t.term.toLowerCase())}`, text: "Explore" })))))))
        : empty(ch.connected ? "No search data yet for this channel." : "Connect with Google to see the searches that bring viewers."));
  } else if (tab === "traffic") {
    const rows = await q(sb.from("channel_breakdowns").select("*").eq("channel_id", id).order("period_end", { ascending: false }).limit(60));
    const latest = rows[0]?.period_end;
    const part = (kind, title) => {
      const items = rows.filter((r) => r.period_end === latest && r.kind === kind).sort((a, b) => b.views - a.views).slice(0, 8);
      const total = items.reduce((a, r) => a + Number(r.views), 0) || 1;
      return h("section", { class: "card grow1" }, h("h2", { text: title }),
        items.length ? items.map((r) => h("div", { style: "display:grid;grid-template-columns:150px minmax(0,1fr) 52px;gap:12px;align-items:center" },
          h("span", { text: prettySource(r.key) }), bar(pctOf(r.views, total), null, true), h("span", { class: "num mono", text: `${Math.round(pctOf(r.views, total))}%` })))
          : empty(ch.connected ? "No data yet." : "Connect with Google to see this."));
    };
    body = h("div", { class: "cols" }, part("traffic_source", "Traffic sources"), part("country", "Top countries"));
  } else {
    const ideas = await q(sb.from("ideas").select("*").eq("channel_id", id).neq("stage", "archived").order("score", { ascending: false }));
    body = h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", { text: "Ideas assigned to this channel" }), h("a", { href: "#/ideas", class: "small", text: "Open idea pipeline" })),
      ideas.length ? ideas.map((i) => h("div", { class: "listrow" }, scorePill(i.score), h("span", { style: "flex:1 1 260px;font-weight:500", text: i.title }), h("span", { class: "pill info", text: i.stage })))
        : empty("No ideas assigned yet."));
  }
  return [header, tabBar, body].flat();
}
function yppRow(label, val, target, unit) {
  const p = pctOf(val, target);
  return h("div", { style: "display:flex;flex-direction:column;gap:6px" },
    h("div", { style: "display:flex;justify-content:space-between;font-size:13.5px" }, h("span", { style: "font-weight:500", text: label }),
      h("span", { class: "mono", text: `${fmtc(val)} / ${fmtc(target)}${unit}` })),
    bar(p, p >= 100 ? "#15803D" : null, true));
}
function multPill(m) {
  if (m === null || m === undefined) return h("span", { class: "flat", text: "—" });
  const cls = m >= 1.5 ? "up" : m < 0.6 ? "down" : "flat";
  return h("span", { class: cls, text: `${Number(m).toFixed(1)}×` });
}
function prettySource(k) {
  const map = { SHORTS: "Shorts feed", YT_SEARCH: "YouTube search", RELATED_VIDEO: "Suggested videos", SUBSCRIBER: "Browse / subscriptions",
    YT_CHANNEL: "Channel pages", EXT_URL: "External", PLAYLIST: "Playlists", NO_LINK_OTHER: "Direct / unknown", NOTIFICATION: "Notifications", END_SCREEN: "End screens" };
  return map[k] || k;
}

// ------------------------------------------------------------------
// Keyword explorer + trends
// ------------------------------------------------------------------
async function viewKeywords(route) {
  if (!state.niches.length) return [h("h1", { text: "Keyword explorer" }), empty("Add a niche in Settings first.")];
  const nicheId = route.params.get("niche") || state.niches[0].id;
  const niche = state.niches.find((n) => n.id === nicheId) || state.niches[0];
  const markets = niche.markets?.length ? niche.markets : ["GLOBAL"];
  const market = route.params.get("market") || markets[0];
  const sort = route.params.get("sort") || "score";
  const tab = route.params.get("tab") || "keywords";
  const filter = (route.params.get("f") || "").toLowerCase();
  const selected = route.params.get("kw");

  const rows = await q(sb.from("v_keyword_scores").select("*").eq("niche_id", niche.id).eq("market", market).order("score", { ascending: false }).limit(500));

  const lookupInput = h("input", { id: "kw-new", class: "field", placeholder: "Analyze a new keyword…", style: "flex:1 1 240px" });
  const analyze = h("button", { class: "btn primary", type: "button", text: "Analyze now", onclick: async () => {
    const term = lookupInput.value.trim().toLowerCase();
    if (!term) return;
    analyze.disabled = true; analyze.textContent = "Analyzing… (~100 units)";
    try {
      const { data, error } = await sb.functions.invoke("keyword-lookup", { body: { niche_id: niche.id, market, term } });
      if (error) throw error;
      toast(`Analyzed “${term}”: ${data?.videos ?? 0} videos, ${data?.outliers ?? 0} outliers`);
      setParams(route, { kw: term, f: null });
    } catch (e) { toast(`Lookup failed: ${e.message || e}`); analyze.disabled = false; analyze.textContent = "Analyze now"; }
  } });

  const head = h("header", { class: "head" },
    h("div", { class: "head-text" }, h("h1", { text: tab === "trends" ? "Trends" : "Keyword explorer" }),
      h("p", { class: "muted", style: "margin:0", text: `${rows.length} keywords tracked in ${niche.name} · ${market}` })),
    h("div", { class: "row", style: "align-items:flex-end" },
      selectEl("kw-niche", state.niches.map((n) => [n.id, n.name]), niche.id, (v) => setParams(route, { niche: v, market: null, kw: null }), "Niche"),
      selectEl("kw-market", markets.map((m) => [m, m === "GLOBAL" ? "Global" : m]), market, (v) => setParams(route, { market: v, kw: null }), "Market")));

  const tabBar = h("div", { class: "tabs", role: "tablist" },
    [["keywords", "Keywords"], ["trends", "Rising"]].map(([v, t]) => h("button", { role: "tab", type: "button", "aria-selected": String(v === tab), text: t, onclick: () => setParams(route, { tab: v === "keywords" ? null : v }) })));

  if (tab === "trends") {
    const rising = rows.filter((r) => r.trends_interest !== null && r.momentum_raw !== null).sort((a, b) => b.momentum_raw - a.momentum_raw).slice(0, 18);
    return [head, tabBar, h("section", { class: "card" },
      h("div", { class: "card-head" }, h("h2", { text: `Rising in ${niche.name}` }), h("span", { class: "muted small", text: "Google Trends, YouTube Search · last 7 days vs last 30 days" })),
      rising.length ? h("div", { style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px" },
        rising.map((r) => { const ch = (Number(r.momentum_raw) - 1) * 100;
          return h("a", { href: `#/keywords?niche=${niche.id}&market=${market}&kw=${encodeURIComponent(r.term)}`, style: "display:flex;align-items:center;gap:12px;border:1px solid var(--line-soft);border-radius:10px;padding:12px 14px;color:inherit;text-decoration:none" },
            h("div", { style: "flex:1 1 auto;min-width:0" }, h("div", { style: "font-weight:500", text: r.term }), h("div", { class: "muted small", text: `Interest ${fmt(r.trends_interest)} · score ${fmt(r.score)}` })),
            h("span", { class: ch >= 0 ? "up" : "down", style: "font-size:13px", text: `${ch >= 0 ? "+" : ""}${ch.toFixed(0)}%` })); }))
        : empty("Trends data appears after the daily Trends job runs."))];
  }

  let list = rows.filter((r) => !filter || r.term.includes(filter));
  const sorters = { score: (a, b) => b.score - a.score, momentum: (a, b) => b.momentum - a.momentum, easiest: (a, b) => a.competition - b.competition };
  list = list.sort(sorters[sort] || sorters.score);
  const sel = rows.find((r) => r.term === selected) || null;

  const filterInput = h("input", { class: "field", placeholder: "Filter tracked keywords", value: filter, "aria-label": "Filter keywords", style: "flex:1 1 200px",
    onchange: (e) => setParams(route, { f: e.target.value.trim().toLowerCase() || null }) });

  const table = h("section", { class: "card grow3" },
    h("div", { class: "card-head" }, h("h2", { text: "Keywords" }),
      seg([["score", "Score"], ["momentum", "Momentum"], ["easiest", "Easiest"]], sort, (v) => setParams(route, { sort: v }), "Sort by")),
    h("div", { class: "row" }, filterInput),
    list.length ? h("div", { class: "tablebox" }, h("table", { style: "min-width:620px" },
      h("thead", {}, h("tr", {}, ["Keyword", "Demand", "Momentum", "Competition", "Outliers", "Score"].map((t, i) => h("th", { class: i ? "num" : null, text: t })))),
      h("tbody", {}, list.slice(0, 200).map((r) => h("tr", { class: `clickable ${sel?.keyword_id === r.keyword_id ? "selected" : ""}`, tabindex: "0",
        onclick: () => setParams(route, { kw: r.term }), onkeydown: (e) => e.key === "Enter" && setParams(route, { kw: r.term }) },
        h("td", { style: "font-weight:500", text: r.term }),
        h("td", { class: "num", text: fmt(r.demand) }), h("td", { class: "num", text: fmt(r.momentum) }), h("td", { class: "num", text: fmt(r.competition) }),
        h("td", { class: "num", text: fmt(r.outlier_count) }), h("td", { class: "num" }, scorePill(r.score)))))))
      : empty(rows.length ? "No keyword matches the filter." : "No keywords yet. They appear after the first research run, or analyze one above."),
    h("p", { class: "muted small", style: "margin:0", text: "Scores are percentiles inside this niche and market (0–100). Competition: lower is easier for a small channel." }));

  let detail;
  if (sel) {
    const [hist, kids] = await Promise.all([
      q(sb.from("keyword_snapshots").select("captured_on,trends_avg_7d,trends_interest").eq("keyword_id", sel.keyword_id).order("captured_on")),
      Promise.resolve(rows.filter((r) => r.term.startsWith(sel.term + " ") && r.yt_autocomplete_rank).sort((a, b) => a.yt_autocomplete_rank - b.yt_autocomplete_rank).slice(0, 10)),
    ]);
    const part = (label, v, inputs, color) => h("div", { style: "display:flex;flex-direction:column;gap:6px" },
      h("div", { style: "display:flex;justify-content:space-between;font-size:13.5px" }, h("span", { style: "font-weight:500", text: label }), h("span", { class: "mono", text: fmt(v) })),
      bar(Number(v) || 0, color), h("div", { class: "muted small", text: inputs }));
    const pts = hist.filter((p) => p.trends_avg_7d !== null).map((p) => ({ x: p.captured_on, y: Number(p.trends_avg_7d) }));
    detail = h("section", { class: "card grow2" },
      h("div", { class: "card-head" }, h("div", {}, h("h2", { text: `“${sel.term}”` }), h("div", { class: "muted small", text: `${niche.name} · ${market}` })),
        h("div", { style: "text-align:right" }, h("div", { class: "mono", style: "font-size:34px;color:var(--accent)", text: fmt(sel.score) }), h("div", { class: "muted small", text: "Keyword score" }))),
      part("Demand", sel.demand, `Trends ${fmt(sel.trends_interest)} · YouTube autocomplete #${sel.yt_autocomplete_rank ?? "–"} · ${fmt(sel.outlier_count)} outliers`),
      part("Momentum", sel.momentum, sel.momentum_raw !== null && sel.trends_interest !== null ? `Last 7 d vs last 30 d: ${((sel.momentum_raw - 1) * 100).toFixed(0)}%` : "Waiting for Trends data"),
      part("Competition", sel.competition, `${fmt(sel.big_channel_uploads)} uploads from channels over 100k · ${fmt(sel.recent_uploads)} recent uploads found`, "#B45309"),
      pts.length > 1 ? lineChart(pts, `Trends interest history for ${sel.term}`) : h("p", { class: "muted small", text: "History builds up day by day." }),
      kids.length ? h("div", {}, h("h3", { text: "What people type next", style: "margin-bottom:6px" }),
        kids.map((k) => h("div", { class: "listrow", style: "padding:8px 0" }, h("span", { class: "mono small", style: "width:28px", text: `#${k.yt_autocomplete_rank}` }),
          h("a", { href: `#/keywords?niche=${niche.id}&market=${market}&kw=${encodeURIComponent(k.term)}`, style: "flex:1;color:inherit", text: k.term }), scorePill(k.score)))) : null,
      h("div", { class: "row" },
        h("button", { class: "btn primary", type: "button", text: "Make idea", onclick: () => makeIdea({ title: sel.term, niche_id: niche.id, score: sel.score, sources: [{ type: "keyword", ref: sel.term, market }] }) }),
        h("a", { class: "btn", href: `#/outliers?niche=${niche.id}`, text: "See outliers" })));
  } else {
    detail = h("section", { class: "card grow2" }, h("h2", { text: "Pick a keyword" }), h("p", { class: "muted", text: "Select a row to see its score breakdown, history and what people type next." }));
  }

  return [head, tabBar, h("section", { class: "card" }, h("h2", { text: "Analyze a keyword now" }), h("div", { class: "row" }, h("label", { for: "kw-new", class: "sr", text: "Keyword" }), lookupInput, analyze),
    h("p", { class: "muted small", style: "margin:0", text: "Runs a live YouTube search and autocomplete check, costs about 100 of the 10,000 daily API units." })),
    h("div", { class: "cols" }, table, detail)];
}

// ------------------------------------------------------------------
// Outliers + competitors
// ------------------------------------------------------------------
async function viewOutliers(route) {
  if (!state.niches.length) return [h("h1", { text: "Outliers" }), empty("Add a niche in Settings first.")];
  const nicheId = route.params.get("niche") || state.niches[0].id;
  const niche = state.niches.find((n) => n.id === nicheId) || state.niches[0];
  const tab = route.params.get("tab") || "videos";
  const fmtF = route.params.get("format") || "all";
  const win = Number(route.params.get("days") || 14);
  const size = route.params.get("size") || "100000";

  const head = h("header", { class: "head" },
    h("div", { class: "head-text" }, h("h1", { text: tab === "competitors" ? "Competitors" : "Outliers" }),
      h("p", { class: "muted", style: "margin:0", text: tab === "competitors" ? "Channels that keep producing outliers in this niche." : "Videos beating their channel’s normal reach: proven topics, not big-channel reach." })),
    selectEl("o-niche", state.niches.map((n) => [n.id, n.name]), niche.id, (v) => setParams(route, { niche: v }), "Niche"));
  const tabBar = h("div", { class: "tabs", role: "tablist" },
    [["videos", "Outlier videos"], ["competitors", "Competitor watchlist"]].map(([v, t]) => h("button", { role: "tab", type: "button", "aria-selected": String(v === tab), text: t, onclick: () => setParams(route, { tab: v === "videos" ? null : v }) })));

  if (tab === "competitors") {
    const comps = await q(sb.from("v_competitors").select("*").eq("niche_id", niche.id).order("outliers_30d", { ascending: false }).limit(100));
    return [head, tabBar, h("section", { class: "card" },
      comps.length ? h("div", { class: "tablebox" }, h("table", { style: "min-width:760px" },
        h("thead", {}, h("tr", {}, ["Channel", "Subs", "Uploads seen 30 d", "Outliers 30 d", "Best video seen", "Best views", "Added"].map((t, i) => h("th", { class: [1, 2, 3, 5].includes(i) ? "num" : null, text: t })))),
        h("tbody", {}, comps.map((c) => h("tr", {},
          h("td", {}, h("a", { href: `https://www.youtube.com/channel/${c.youtube_channel_id}`, target: "_blank", rel: "noopener", style: "font-weight:500;color:inherit", text: c.title || c.youtube_channel_id })),
          h("td", { class: "num", text: fmtc(c.subscribers) }), h("td", { class: "num", text: fmt(c.uploads_30d_seen) }), h("td", { class: "num", text: fmt(c.outliers_30d) }),
          h("td", { text: c.best_title || "—" }), h("td", { class: "num", text: fmtc(c.best_views) }),
          h("td", {}, h("span", { class: `pill ${c.source === "manual" ? "dark" : "info"}`, text: c.source })))))))
        : empty("Channels with 2+ outliers in a research run are added here automatically."))];
  }

  let query = sb.from("v_video_latest").select("*").eq("niche_id", niche.id).gte("outlier_score", 3)
    .gte("published_at", new Date(Date.now() - win * 864e5).toISOString()).order("outlier_score", { ascending: false }).limit(60);
  if (fmtF !== "all") query = query.eq("is_short", fmtF === "short");
  if (size !== "all") query = query.lte("subscribers", Number(size));
  const vids = await q(query);

  const filters = h("div", { class: "row" },
    seg([["all", "All"], ["short", "Shorts"], ["long", "Long-form"]], fmtF, (v) => setParams(route, { format: v }), "Format"),
    selectEl("o-days", [["7", "Uploaded: last 7 days"], ["14", "Uploaded: last 14 days"], ["30", "Uploaded: last 30 days"]], String(win), (v) => setParams(route, { days: v })),
    selectEl("o-size", [["10000", "Channels under 10k subs"], ["100000", "Channels under 100k subs"], ["all", "All channel sizes"]], size, (v) => setParams(route, { size: v })));

  const grid = vids.length ? h("section", { class: "cards", "aria-label": "Outlier videos" }, vids.map((v) => h("article", { class: "vcard" },
    h("div", { class: "thumb" }, v.thumbnail_url ? h("img", { src: v.thumbnail_url, alt: "", loading: "lazy" }) : null,
      h("span", { class: `pill tl ${v.is_short ? "short" : "long"}`, text: v.is_short ? "Short" : "Long" }),
      h("span", { class: "tr", text: `${Number(v.outlier_score).toFixed(1)}×` })),
    h("div", { class: "vbody" },
      h("h3", {}, h("a", { href: `https://www.youtube.com/watch?v=${v.youtube_video_id}`, target: "_blank", rel: "noopener", style: "color:inherit;text-decoration:none", text: v.title })),
      h("div", { class: "muted small", text: `${v.channel_title || "—"} · ${fmtc(v.subscribers)} subs · ${ago(v.published_at)}` }),
      h("div", { class: "stats3" },
        h("div", {}, h("span", { text: "Views" }), h("span", { class: "mono", text: fmtc(v.views) })),
        h("div", {}, h("span", { text: "Views / hour" }), h("span", { class: "mono", text: fmtc(v.views_per_hour) })),
        h("div", {}, h("span", { text: "Engagement" }), h("span", { class: "mono", text: `${v.engagement_pct ?? "—"}%` }))),
      h("div", { class: "row", style: "margin-top:auto" },
        h("button", { class: "btn primary small", type: "button", text: "Save as idea",
          onclick: () => makeIdea({ title: v.title, niche_id: niche.id, score: Math.min(100, Math.round(50 + Number(v.outlier_score) * 2)), sources: [{ type: "outlier", ref: v.youtube_video_id, multiple: v.outlier_score }] }) }))))))
    : empty("No outliers match these filters yet. They appear after the research job runs.");

  return [head, tabBar, filters, grid];
}

// ------------------------------------------------------------------
// Idea pipeline
// ------------------------------------------------------------------
const STAGES = [
  ["new", "New", "Auto-added or saved from research", "Shortlist"],
  ["shortlisted", "Shortlisted", "Worth making", "Assign"],
  ["assigned", "Assigned", "Channel picked", "Mark scripted"],
  ["scripted", "Scripted", "Script, titles, prompts ready", "Mark produced"],
  ["produced", "Produced", "Videos rendered", "Mark scheduled"],
  ["scheduled", "Scheduled", "Queued in Blotato", "Mark published"],
  ["published", "Published", "Live, results tracked", null],
];
async function viewIdeas() {
  const ideas = await q(sb.from("ideas").select("*").neq("stage", "archived").order("score", { ascending: false, nullsFirst: false }));
  const update = async (id, values) => { await q(sb.from("ideas").update(values).eq("id", id)); render(); };

  const titleIn = h("input", { id: "idea-title", class: "field", placeholder: "New idea title", style: "flex:1 1 260px" });
  const nicheSel = h("select", { class: "field", "aria-label": "Niche" }, state.niches.map((n) => h("option", { value: n.id, text: n.name })));
  const add = h("form", { class: "row", onsubmit: async (e) => {
    e.preventDefault();
    if (!titleIn.value.trim()) return;
    await makeIdea({ title: titleIn.value.trim(), niche_id: nicheSel.value || null, score: null, sources: [{ type: "manual" }] });
    render();
  } }, h("label", { for: "idea-title", class: "sr", text: "Idea title" }), titleIn, nicheSel, h("button", { class: "btn", type: "submit", text: "+ Add idea" }));

  const board = h("div", { class: "board" }, h("div", { class: "board-inner" }, STAGES.map(([stage, name, hint, action], si) => {
    const cards = ideas.filter((i) => i.stage === stage);
    return h("section", { class: "col", "aria-label": name },
      h("div", { class: "col-head" }, h("h3", { style: "font-size:14px", text: name }), h("span", { class: "mono small muted", text: String(cards.length) })),
      h("div", { class: "muted small", style: "padding:0 4px", text: hint }),
      cards.map((i) => {
        const chSel = h("select", { class: "field", style: "min-height:36px;font-size:13px", "aria-label": "Channel",
          onchange: (e) => update(i.id, { channel_id: e.target.value || null }) },
          h("option", { value: "", text: "No channel" }), state.channels.map((c) => h("option", { value: c.id, selected: c.id === i.channel_id, text: c.title })));
        return h("article", { class: "icard" },
          h("div", { style: "display:flex;justify-content:space-between;align-items:center;gap:8px" }, scorePill(i.score), h("span", { class: "muted small", text: nicheName(i.niche_id) })),
          h("div", { class: "title", text: i.title }),
          h("div", { class: "muted small", text: (i.sources || []).map((s) => s.type).join(", ") || "manual" }),
          si >= 1 ? chSel : null,
          h("div", { class: "acts" },
            si > 0 ? h("button", { class: "btn small", type: "button", "aria-label": "Move back", text: "◀", onclick: () => update(i.id, { stage: STAGES[si - 1][0] }) }) : null,
            action ? h("button", { class: "btn small", type: "button", text: action, onclick: () => {
              if (STAGES[si + 1][0] === "assigned" && !i.channel_id) return toast("Pick a channel first");
              update(i.id, { stage: STAGES[si + 1][0] });
            } }) : null,
            h("button", { class: "btn small", type: "button", text: "Archive", onclick: () => update(i.id, { stage: "archived" }) })));
      }));
  })));
  return [h("header", { class: "head" }, h("div", { class: "head-text" }, h("h1", { text: "Idea pipeline" }),
    h("p", { class: "muted", style: "margin:0", text: "From research to published: every idea keeps its score, sources and channel." })), add), board];
}

// ------------------------------------------------------------------
// Settings: niches, channels, jobs, quota
// ------------------------------------------------------------------
async function viewSettings(route) {
  if (route.params.get("connected")) toast("Channel connected");
  if (route.params.get("error")) toast(`Google connection failed: ${route.params.get("error")}`);
  const today = new Date().toISOString().slice(0, 10);
  const [seeds, runs, quota] = await Promise.all([
    q(sb.from("seed_terms").select("*").order("created_at")),
    q(sb.from("job_runs").select("*").order("started_at", { ascending: false }).limit(150)),
    q(sb.from("api_quota_daily").select("*").eq("day", today)),
  ]);

  const nicheCard = (n) => {
    const w = n.weights || {};
    const f = (id, label, value, type = "text") => h("div", { class: "field-wrap", style: "flex:1 1 120px" },
      h("label", { for: `${id}-${n.id}`, text: label }), h("input", { id: `${id}-${n.id}`, class: "field", type, value: value ?? "" }));
    const fields = {
      langs: f("langs", "Languages (comma)", (n.languages || []).join(", ")),
      markets: f("markets", "Markets (comma, GLOBAL or US, GB, MA…)", (n.markets || []).join(", ")),
      d: f("wd", "Demand %", Math.round((w.demand ?? 0.4) * 100), "number"),
      m: f("wm", "Momentum %", Math.round((w.momentum ?? 0.35) * 100), "number"),
      c: f("wc", "Competition %", Math.round((w.competition ?? 0.25) * 100), "number"),
      budget: f("budget", "Daily API units", n.daily_unit_budget, "number"),
      anchor: f("anchor", "Trends anchor term", n.trends_anchor || n.name.toLowerCase()),
    };
    const val = (k) => fields[k].querySelector("input").value;
    const nSeeds = seeds.filter((s) => s.niche_id === n.id);
    const seedIn = h("input", { class: "field", placeholder: "Add seed term", "aria-label": "Seed term", style: "flex:1 1 180px" });
    const kindSel = h("select", { class: "field", "aria-label": "Seed type" }, [["entity", "Entity"], ["format", "Format"], ["topic", "Topic"]].map(([v, t]) => h("option", { value: v, text: t })));
    return h("div", { class: "card", style: "padding:16px" },
      h("div", { class: "card-head" }, h("h3", { text: n.name }), h("span", { class: "muted small", text: `${state.channels.filter((c) => c.niche_id === n.id).map((c) => c.title).join(", ") || "No channels"}` })),
      h("div", { class: "row", style: "align-items:flex-end" }, fields.langs, fields.markets),
      h("div", { class: "row", style: "align-items:flex-end" }, fields.d, fields.m, fields.c),
      h("div", { class: "row", style: "align-items:flex-end" }, fields.budget, fields.anchor),
      h("div", { class: "row", style: "gap:6px" }, nSeeds.map((s) => h("span", { class: "chip" }, s.term, h("span", { class: "muted", text: `· ${s.kind}` }),
        h("button", { type: "button", "aria-label": `Remove ${s.term}`, text: "×", onclick: async () => { await q(sb.from("seed_terms").delete().eq("id", s.id)); render(); } })))),
      h("form", { class: "row", onsubmit: async (e) => { e.preventDefault(); const t = seedIn.value.trim().toLowerCase(); if (!t) return;
        await q(sb.from("seed_terms").insert({ niche_id: n.id, term: t, kind: kindSel.value })); render(); } }, seedIn, kindSel, h("button", { class: "btn small", type: "submit", text: "Add" })),
      h("div", { class: "row" }, h("button", { class: "btn primary small", type: "button", text: "Save niche", onclick: async () => {
        const d = Number(val("d")), m = Number(val("m")), c = Number(val("c"));
        if (Math.round(d + m + c) !== 100) return toast("Weights must add up to 100");
        const list = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
        await q(sb.from("niches").update({
          languages: list(val("langs")), markets: list(val("markets")).map((x) => x.toUpperCase()),
          weights: { demand: d / 100, momentum: m / 100, competition: c / 100 },
          daily_unit_budget: Number(val("budget")) || 2500, trends_anchor: val("anchor").trim() || null,
        }).eq("id", n.id));
        await loadShared(); toast("Niche saved");
      } })));
  };

  const newNiche = h("input", { id: "new-niche", class: "field", placeholder: "Niche name, e.g. Recipes DE", style: "flex:1 1 220px" });
  const niches = h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h2", { text: "Niches" }),
      h("form", { class: "row", onsubmit: async (e) => { e.preventDefault(); const name = newNiche.value.trim(); if (!name) return;
        const slug = name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        await q(sb.from("niches").insert({ name, slug, languages: ["en"], markets: ["GLOBAL"] })); await loadShared(); render(); } },
        h("label", { for: "new-niche", class: "sr", text: "New niche" }), newNiche, h("button", { class: "btn", type: "submit", text: "+ Add niche" }))),
    h("div", { style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:14px" }, state.niches.map(nicheCard)));

  const channels = h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h2", { text: "Channels" }), h("button", { class: "btn primary", type: "button", text: "+ Connect channel with Google", onclick: startOAuth })),
    h("p", { class: "muted small", style: "margin:0", text: "Brand Account channels need one connection each: pick the channel in Google’s chooser, then repeat for the next one." }),
    state.channels.length ? h("div", { class: "tablebox" }, h("table", { style: "min-width:640px" },
      h("thead", {}, h("tr", {}, ["Channel", "Niche", "Language", "Markets", "Google"].map((t) => h("th", { text: t })))),
      h("tbody", {}, state.channels.map((c) => h("tr", {},
        h("td", { style: "font-weight:500", text: c.title }),
        h("td", {}, h("select", { class: "field", style: "min-height:36px", "aria-label": `Niche for ${c.title}`,
          onchange: async (e) => { await q(sb.from("channels").update({ niche_id: e.target.value || null }).eq("id", c.id)); await loadShared(); toast("Saved"); } },
          h("option", { value: "", text: "No niche" }), state.niches.map((n) => h("option", { value: n.id, selected: n.id === c.niche_id, text: n.name })))),
        h("td", {}, h("input", { class: "field", style: "min-height:36px;width:70px", value: c.language || "", "aria-label": `Language for ${c.title}`,
          onchange: async (e) => { await q(sb.from("channels").update({ language: e.target.value.trim() || null }).eq("id", c.id)); toast("Saved"); } })),
        h("td", {}, h("input", { class: "field", style: "min-height:36px;width:160px", value: (c.markets || []).join(", "), "aria-label": `Markets for ${c.title}`,
          onchange: async (e) => { await q(sb.from("channels").update({ markets: e.target.value.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean) }).eq("id", c.id)); toast("Saved"); } })),
        h("td", {}, c.connected ? h("span", { class: "pill ok", text: "Connected" }) : h("span", { class: "pill warn", text: "Public stats only" })))))))
      : empty("No channels yet."));

  const latest = {};
  for (const r of runs) if (!latest[r.job]) latest[r.job] = r;
  const pill = (s) => h("span", { class: `pill ${s === "ok" ? "ok" : s === "failed" ? "crit" : s === "running" ? "info" : "warn"}`, text: s });
  const jobs = h("section", { class: "card grow3" }, h("h2", { text: "Scheduled jobs" }),
    Object.keys(latest).length ? h("div", { class: "tablebox" }, h("table", { style: "min-width:560px" },
      h("thead", {}, h("tr", {}, ["Job", "Last run", "Duration", "Units", "Status"].map((t, i) => h("th", { class: i === 3 ? "num" : null, text: t })))),
      h("tbody", {}, Object.values(latest).map((r) => h("tr", {},
        h("td", { style: "font-weight:500", text: r.job }), h("td", { class: "muted", text: ago(r.started_at) }),
        h("td", { class: "muted", text: r.finished_at ? `${Math.max(1, Math.round((new Date(r.finished_at) - new Date(r.started_at)) / 1000))} s` : "—" }),
        h("td", { class: "num", text: fmt(r.units_used) }), h("td", {}, pill(r.status)))))))
      : empty("No job has run yet. Jobs start once the GitHub repo and its secrets are set."),
    h("p", { class: "muted small", style: "margin:0", text: "Schedule (UTC): research 06:00 daily · Trends 07:30 daily · channel stats every 6 h · Blotato sync and alerts hourly." }));

  const used = quota.filter((r) => r.api === "youtube_data");
  const total = used.reduce((a, r) => a + r.units, 0);
  const byBucket = {};
  for (const r of used) byBucket[r.bucket] = (byBucket[r.bucket] || 0) + r.units;
  const quotaCard = h("section", { class: "card grow2" }, h("h2", { text: "YouTube API quota today" }),
    h("div", { style: "display:flex;justify-content:space-between" }, h("span", { text: `${fmt(total)} of 10,000 units` }), h("span", { class: "mono", text: `${Math.round(total / 100)}%` })),
    bar(total / 100, total > 9000 ? "#B42318" : null, true),
    Object.entries(byBucket).map(([b, u]) => h("div", { style: "display:flex;justify-content:space-between;font-size:13px" }, h("span", { text: b }), h("span", { class: "mono", text: fmt(u) }))),
    h("p", { class: "muted small", style: "margin:0", text: "Resets at midnight Pacific time. Each niche has its own daily budget above." }));

  return [h("header", { class: "head" }, h("div", { class: "head-text" }, h("h1", { text: "Settings" }), h("p", { class: "muted", style: "margin:0", text: "Niches, channels, scheduled jobs and API quota." }))),
    niches, channels, h("div", { class: "cols" }, jobs, quotaCard)];
}

async function startOAuth() {
  try {
    const { data, error } = await sb.functions.invoke("google-oauth", { body: { action: "start", return_to: location.origin + location.pathname } });
    if (error) throw error;
    location.href = data.url;
  } catch (e) {
    toast(`Google connection isn’t ready yet: ${e.message || e}`);
  }
}

// ------------------------------------------------------------------
// Boot
// ------------------------------------------------------------------
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  const app = document.getElementById("app"), login = document.getElementById("login");
  if (!session) { app.hidden = true; login.hidden = false; return; }
  const allowed = await q(sb.rpc("am_i_allowed"));
  if (!allowed) {
    app.hidden = true; login.hidden = false;
    document.getElementById("login-msg").textContent = `${session.user.email} is not on the allow-list.`;
    await sb.auth.signOut();
    return;
  }
  login.hidden = true; app.hidden = false;
  await loadShared();
  render();
}

// Email + password. "Create your password" is used once; after that you just sign in.
let creating = false;
function setLoginMode(create) {
  creating = create;
  document.getElementById("login-title").textContent = create ? "Create your password" : "Sign in";
  document.getElementById("login-intro").textContent = create
    ? "One-time setup. Use the email that is on the allow-list, and a password of at least 8 characters."
    : "Only allow-listed accounts can see data.";
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
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const msg = document.getElementById("login-msg");
  const btn = document.getElementById("login-submit");
  if (creating && password !== document.getElementById("login-password2").value) {
    msg.textContent = "The two passwords don’t match.";
    return;
  }
  btn.disabled = true;
  msg.textContent = creating ? "Creating your account…" : "Signing in…";
  const { data, error } = creating
    ? await sb.auth.signUp({ email, password })
    : await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false;
  if (error) {
    msg.textContent = /invalid login/i.test(error.message) ? "Wrong email or password." : error.message;
    return;
  }
  if (creating && !data.session) {
    msg.textContent = "Account created, but Supabase is waiting for email confirmation. Turn off “Confirm email” in Supabase (see setup), then sign in.";
    setLoginMode(false);
    return;
  }
  boot();
});
document.getElementById("sign-out").addEventListener("click", async () => { await sb.auth.signOut(); location.hash = ""; boot(); });
document.getElementById("channel-switch").addEventListener("change", (e) => {
  state.channel = e.target.value;
  localStorage.setItem("ytc.channel", state.channel);
  go(state.channel === "all" ? "#/portfolio" : `#/channel/${state.channel}`);
});
window.addEventListener("hashchange", () => { if (!document.getElementById("app").hidden) render(); });
sb.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") boot(); });
boot();
