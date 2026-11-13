// What a brain can read and do. Reading and remembering happen at once; anything that spends money or reaches the
// outside (making a video) is only proposed: it waits in brain_actions for a person's yes.
import type { ToolDef } from "./llm.ts";
import { PRICES } from "./llm.ts";

export type Ctx = {
  db: any;                    // service client: every query below is limited to the brain's network on purpose
  brain: any;                 // brains row
  channel: any | null;        // the brain's network (null for the general brain)
  channels: any[];            // every network, for the general brain
  proposals: any[];           // filled by propose_video, saved with the reply
};

const clip = (s: unknown, n = 200) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const daysAgo = (d: number) => new Date(Date.now() - d * 864e5).toISOString();
const num = (v: unknown, lo: number, hi: number, dflt: number) => Math.max(lo, Math.min(hi, Math.round(Number(v) || dflt)));

/** The networks a call is about: the brain's own, or (general brain) the one named, or all of them. */
function scope(ctx: Ctx, network?: unknown) {
  if (ctx.channel) return [ctx.channel];
  const q = clip(network, 80).toLowerCase();
  if (!q) return ctx.channels;
  const hit = ctx.channels.filter((c) => String(c.title || "").toLowerCase().includes(q) || c.id === q);
  return hit.length ? hit : ctx.channels;
}
const networkArg = (ctx: Ctx) => (ctx.channel ? {} : { network: { type: "string", description: "Optional: the network's name, to look at one network only." } });

export function toolDefs(ctx: Ctx): ToolDef[] {
  const net = networkArg(ctx);
  const obj = (props: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties: { ...props }, required, additionalProperties: false });
  return [
    { name: "network_overview", description: "Views, watch hours, net subscribers and Shorts views over the last N days and the N days before, current subscribers, and the next scheduled post, per network.",
      parameters: obj({ days: { type: "integer", description: "7 to 90 (default 28)" }, ...net }) },
    { name: "top_videos", description: "The network's videos with the most views over the last N days: title, views, average % watched, Short or not, publish date.",
      parameters: obj({ days: { type: "integer", description: "7 to 90 (default 28)" }, limit: { type: "integer", description: "1 to 20 (default 10)" }, ...net }) },
    { name: "list_ideas", description: "Ideas saved in the app (newest first): id, title, stage (new, shortlisted, scripted, produced, published...), score, where it came from.",
      parameters: obj({ stage: { type: "string", description: "Optional stage filter, or 'any'" }, limit: { type: "integer", description: "1 to 30 (default 15)" }, ...net }) },
    { name: "recent_videos", description: "The videos the app made or is making (newest first): status (running, ready, review, failed), title, style, error.",
      parameters: obj({ limit: { type: "integer", description: "1 to 20 (default 10)" }, ...net }) },
    { name: "calendar", description: "Posts scheduled in the next N days and those published or failed in the last N days, with their time, platform and title.",
      parameters: obj({ days: { type: "integer", description: "1 to 30 (default 7)" }, ...net }) },
    { name: "ai_costs", description: "What the AI cost over the last N days, by task and model (estimates from tokens and list prices).",
      parameters: obj({ days: { type: "integer", description: "1 to 90 (default 30)" } }) },
    { name: "trending_now", description: "What people search on Google right now in a country (Google Trends 'Trending now', last 24 h): title, search volume, related searches.",
      parameters: obj({ country: { type: "string", description: "Two-letter code, e.g. US, FR, MA. Default: the network's first market." } }) },
    { name: "search_memory", description: "Search this brain's memory (facts, rules, preferences, lessons, past events) for words.",
      parameters: obj({ query: { type: "string" } }, ["query"]) },
    { name: "remember", description: "Save something to keep for good: a fact about the network, a rule or preference the user gave, a lesson from results. One short sentence each. Don't save what's already in memory.",
      parameters: obj({ content: { type: "string" }, kind: { type: "string", enum: ["fact", "rule", "preference", "lesson", "profile"] }, pinned: { type: "boolean", description: "Pinned memories are always in view (rules, key preferences)." } }, ["content", "kind"]) },
    { name: "create_ideas", description: "Add video ideas to the app's Ideas list (no cost). Up to 10. Each one: a title the video would have, and the angle.",
      parameters: obj({ ideas: { type: "array", maxItems: 10, items: { type: "object", properties: { title: { type: "string" }, angle: { type: "string" } }, required: ["title", "angle"], additionalProperties: false } }, ...net }, ["ideas"]) },
    { name: "propose_video", description: "Propose making one video. It is NOT made now: the user sees a card and approves or not. kind 'animation' = drawn style made by Claude (look, aspect, length); kind 'clips' = stock clips and photos. Use an existing idea_id, or a title to create the idea.",
      parameters: obj({
        kind: { type: "string", enum: ["animation", "clips"] },
        idea_id: { type: "string" }, title: { type: "string" },
        look: { type: "string", enum: ["glow", "whiteboard", "kinetic", "blueprint", "chalkboard", "neon", "comic", "terminal", "vintage", "clean", "sunset", "badges", "notes", "minimal", "stick", "stickcolor", "stickdoodle"] },
        aspect: { type: "string", enum: ["9:16", "16:9"] },
        length: { type: "string", enum: ["short45", "short60", "short120", "long3", "long5", "long8", "long10"] },
        why: { type: "string", description: "One sentence: why this video now." },
        ...net,
      }, ["kind", "why"]) },
  ];
}

export async function runTool(ctx: Ctx, name: string, a: Record<string, any>): Promise<unknown> {
  const { db } = ctx;
  const nets = scope(ctx, a.network);
  const ids = nets.map((c) => c.id);
  switch (name) {
    case "network_overview": {
      const days = num(a.days, 7, 90, 28);
      const { data: stats } = await db.from("channel_daily_stats").select("channel_id,day,views,watch_minutes,subs_gained,subs_lost,shorts_views").in("channel_id", ids).gte("day", daysAgo(days * 2).slice(0, 10));
      const { data: next } = await db.from("publish_queue").select("channel_id,slot_at,title,platform").in("channel_id", ids).eq("status", "scheduled").gte("slot_at", new Date().toISOString()).order("slot_at").limit(50);
      const out = [];
      for (const c of nets) {
        const { data: snap } = await db.from("channel_snapshots").select("subscribers,total_views,video_count,captured_at").eq("channel_id", c.id).order("captured_at", { ascending: false }).limit(1);
        const rows = (stats || []).filter((r: any) => r.channel_id === c.id);
        const cut = daysAgo(days).slice(0, 10);
        const sum = (list: any[], k: string) => list.reduce((t, r) => t + Number(r[k] || 0), 0);
        const now = rows.filter((r: any) => r.day >= cut), before = rows.filter((r: any) => r.day < cut);
        out.push({ network: c.title, language: c.language, connected: c.connected, subscribers: snap?.[0]?.subscribers ?? null, videos: snap?.[0]?.video_count ?? null,
          [`last_${days}_days`]: { views: sum(now, "views"), watch_hours: Math.round(sum(now, "watch_minutes") / 60), net_subscribers: sum(now, "subs_gained") - sum(now, "subs_lost"), shorts_views: sum(now, "shorts_views") },
          [`previous_${days}_days`]: { views: sum(before, "views"), watch_hours: Math.round(sum(before, "watch_minutes") / 60), net_subscribers: sum(before, "subs_gained") - sum(before, "subs_lost") },
          next_post: (next || []).find((p: any) => p.channel_id === c.id) || null,
          scheduled_count: (next || []).filter((p: any) => p.channel_id === c.id).length });
      }
      return out;
    }
    case "top_videos": {
      const days = num(a.days, 7, 90, 28), limit = num(a.limit, 1, 20, 10);
      const yt = nets.map((c) => c.youtube_channel_id).filter(Boolean);
      if (!yt.length) return { note: "No YouTube channel is connected for this network yet." };
      const { data: vids } = await db.from("videos").select("youtube_video_id,youtube_channel_id,title,published_at,is_short,duration_s").in("youtube_channel_id", yt).order("published_at", { ascending: false }).limit(300);
      if (!vids?.length) return [];
      const { data: daily } = await db.from("own_video_daily").select("youtube_video_id,views,avg_view_pct").in("youtube_video_id", vids.map((v: any) => v.youtube_video_id)).gte("day", daysAgo(days).slice(0, 10));
      const agg = new Map<string, { views: number; pct: number[] }>();
      for (const d of daily || []) { const g = agg.get(d.youtube_video_id) || { views: 0, pct: [] }; g.views += Number(d.views || 0); if (d.avg_view_pct != null) g.pct.push(Number(d.avg_view_pct)); agg.set(d.youtube_video_id, g); }
      return vids.map((v: any) => { const g = agg.get(v.youtube_video_id); return { title: v.title, views: g?.views || 0, avg_watched_pct: g?.pct.length ? Math.round(g.pct.reduce((x, y) => x + y, 0) / g.pct.length) : null, short: v.is_short, published: String(v.published_at || "").slice(0, 10) }; })
        .sort((x: any, y: any) => y.views - x.views).slice(0, limit);
    }
    case "list_ideas": {
      const limit = num(a.limit, 1, 30, 15);
      let q = db.from("ideas").select("id,title,video_title,stage,score,sources,created_at,channel_id").neq("stage", "archived").order("created_at", { ascending: false }).limit(limit);
      q = ctx.channel || a.network ? q.in("channel_id", ids) : q;
      if (a.stage && a.stage !== "any") q = q.eq("stage", clip(a.stage, 20));
      const { data } = await q;
      return (data || []).map((i: any) => ({ id: i.id, title: i.video_title || i.title, stage: i.stage, score: i.score, source: (i.sources || [])[0]?.type || null, created: String(i.created_at).slice(0, 10),
        network: ctx.channel ? undefined : ctx.channels.find((c) => c.id === i.channel_id)?.title || null }));
    }
    case "recent_videos": {
      const limit = num(a.limit, 1, 20, 10);
      const { data } = await db.from("video_runs").select("status,options,error,created_at,channel_id,ideas(title,video_title)").in("channel_id", ids).order("created_at", { ascending: false }).limit(limit);
      return (data || []).map((r: any) => ({ title: r.ideas?.video_title || r.ideas?.title, status: r.status, style: r.options?.video_style === "explainer" ? `animation ${r.options?.look || "glow"} ${r.options?.aspect || "9:16"}` : "clips",
        error: r.error ? clip(r.error, 160) : undefined, started: String(r.created_at).slice(0, 16).replace("T", " ") }));
    }
    case "calendar": {
      const days = num(a.days, 1, 30, 7);
      const { data } = await db.from("publish_queue").select("slot_at,status,platform,title,error,channel_id").in("channel_id", ids)
        .gte("slot_at", daysAgo(days)).lte("slot_at", new Date(Date.now() + days * 864e5).toISOString()).order("slot_at").limit(80);
      return (data || []).map((p: any) => ({ when: String(p.slot_at).slice(0, 16).replace("T", " ") + " UTC", status: p.status, platform: p.platform || "youtube", title: clip(p.title, 90),
        error: p.error ? clip(p.error, 120) : undefined, network: ctx.channel ? undefined : ctx.channels.find((c) => c.id === p.channel_id)?.title }));
    }
    case "ai_costs": {
      const days = num(a.days, 1, 90, 30);
      let q = db.from("ai_runs").select("model,kind,prompt_tokens,completion_tokens,ideas(channel_id)").gte("created_at", daysAgo(days)).limit(10000);
      const { data } = await q;
      const rows = (data || []).filter((r: any) => !ctx.channel || r.ideas?.channel_id === ctx.channel.id || (r.kind === "brain" && !r.ideas));
      const by = new Map<string, { calls: number; cost: number }>();
      let total = 0;
      for (const r of rows) {
        const p = PRICES[r.model] || (/^deepseek/.test(r.model) ? PRICES["deepseek-flash"] : null);
        const c = p ? (Number(r.prompt_tokens || 0) * p[0] + Number(r.completion_tokens || 0) * p[1]) / 1e6 : 0;
        total += c;
        const k = `${r.kind} (${r.model})`;
        const g = by.get(k) || { calls: 0, cost: 0 }; g.calls++; g.cost += c; by.set(k, g);
      }
      return { days, total_usd: Math.round(total * 100) / 100, by_task: [...by.entries()].map(([k, g]) => ({ task: k, calls: g.calls, usd: Math.round(g.cost * 1000) / 1000 })).sort((x, y) => y.usd - x.usd).slice(0, 15),
        note: "Estimates from tokens and list prices; cache discounts not counted." };
    }
    case "trending_now": {
      const geo = (clip(a.country, 2) || String((ctx.channel?.markets || [])[0] || "US")).toUpperCase();
      const { data } = await db.from("trend_cache").select("rows,fetched_at").eq("geo", geo).eq("hours", 24).maybeSingle();
      if (!data) return { note: `Nothing cached for ${geo} yet: open the Trending page for ${geo} once, then ask again.` };
      const rows = (data.rows || []).filter((r: any) => r.active !== false).sort((x: any, y: any) => (y.volume || 0) - (x.volume || 0));
      return { country: geo, as_of: data.fetched_at, trends: rows.slice(0, 25).map((r: any) => ({ title: r.title, searches: r.volume, growth_pct: r.growth, related: (r.related || []).slice(0, 5) })) };
    }
    case "search_memory": {
      const { data } = await db.from("brain_memory").select("kind,content,created_at").eq("brain_id", ctx.brain.id).textSearch("fts", clip(a.query, 120), { type: "websearch", config: "simple" }).order("created_at", { ascending: false }).limit(12);
      return (data || []).map((m: any) => ({ kind: m.kind, content: m.content, date: String(m.created_at).slice(0, 10) }));
    }
    case "remember": {
      const content = clip(a.content, 600);
      if (!content) return { error: "Nothing to remember." };
      const kind = ["fact", "rule", "preference", "lesson", "profile"].includes(a.kind) ? a.kind : "fact";
      await db.from("brain_memory").insert({ brain_id: ctx.brain.id, kind, content, source: "brain", pinned: a.pinned === true || kind === "rule" });
      return { saved: true };
    }
    case "create_ideas": {
      const target = ctx.channel || (a.network ? nets[0] : null);
      const list = (Array.isArray(a.ideas) ? a.ideas : []).slice(0, 10).map((i: any) => ({ title: clip(i.title, 140), angle: clip(i.angle, 300) })).filter((i: any) => i.title);
      if (!list.length) return { error: "No idea to add." };
      const { data, error } = await db.from("ideas").insert(list.map((i: any) => ({ title: i.title, notes: i.angle, channel_id: target?.id || null, niche_id: target?.niche_id || null,
        sources: [{ type: "brain", angle: i.angle }] }))).select("id,title");
      if (error) return { error: error.message };
      await db.from("brain_memory").insert({ brain_id: ctx.brain.id, kind: "event", source: "brain", content: `Added ${data.length} idea${data.length === 1 ? "" : "s"}: ${data.map((d: any) => `"${d.title}"`).join(", ").slice(0, 900)}.` });
      return { added: data };
    }
    case "propose_video": {
      const target = ctx.channel || (a.network ? nets[0] : null);
      if (!target) return { error: "Say which network the video is for (network)." };
      let title = clip(a.title, 140);
      if (a.idea_id) {
        const { data: idea } = await db.from("ideas").select("id,title,video_title,channel_id").eq("id", clip(a.idea_id, 40)).maybeSingle();
        if (!idea) return { error: "That idea_id doesn't exist. Use list_ideas, or give a title." };
        title = idea.video_title || idea.title;
      }
      if (!title) return { error: "Give an idea_id or a title." };
      const args = { kind: a.kind === "clips" ? "clips" : "animation", idea_id: a.idea_id || null, title, channel_id: target.id,
        look: a.look || "glow", aspect: a.aspect === "16:9" ? "16:9" : "9:16", length: a.length || (a.aspect === "16:9" ? "long3" : "short45") };
      const summary = `${args.kind === "animation" ? `Animation (${args.look}, ${args.aspect})` : `Video with clips (${args.aspect})`}: "${title}" for ${target.title}. ${clip(a.why, 200)}`;
      ctx.proposals.push({ kind: "make_video", args, summary });
      return { proposed: true, note: "The user will see a card to approve it. Nothing is made until they do." };
    }
  }
  return { error: `Unknown tool ${name}` };
}
