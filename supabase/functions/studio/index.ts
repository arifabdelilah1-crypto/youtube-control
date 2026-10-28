// Video editor backend.
// POST {action:"build", project_id?, idea_id?, channel_id?, title, script, language, voice, voice_rate, aspect, settings, default_terms?}
//      -> splits the script into scenes (one line = one scene, optional "[term, term]" at the end of a line),
//         finds stock clips per scene, starts the voice job. Returns {project_id}.
// POST {action:"voice", project_id, scene_ids?}   -> regenerate voice for some/all scenes
// POST {action:"search", q, kind?: "video"|"image", aspect?, page?} -> stock footage candidates
// POST {action:"render", project_id}               -> final render job. Returns {job_id}
// Secrets: GITHUB_TOKEN, GITHUB_REPO, PIXABAY_API_KEY
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const GH_TOKEN = Deno.env.get("GITHUB_TOKEN") ?? "";
const GH_REPO = Deno.env.get("GITHUB_REPO") ?? "";
const PIXABAY = Deno.env.get("PIXABAY_API_KEY") ?? "";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f-]{36}$/;
const VOICE = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z]+Neural(-(Male|Female))?$/;

async function dispatch(workflow: string, inputs: Record<string, string>): Promise<string | null> {
  if (!GH_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(GH_REPO)) return "Rendering isn't set up yet: add GITHUB_TOKEN and GITHUB_REPO in Supabase Edge Function secrets.";
  const r = await fetch(`https://api.github.com/repos/${GH_REPO}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "youtube-control" },
    body: JSON.stringify({ ref: "main", inputs }),
  });
  return r.ok ? null : `GitHub dispatch failed (${r.status}): ${(await r.text()).slice(0, 300)}`;
}

// ---------- script -> scenes ----------
type ParsedScene = { text: string; terms: string[] };
export function parseScript(script: string): ParsedScene[] {
  const lines = script.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const out: ParsedScene[] = [];
  for (const line of lines) {
    const m = line.match(/^(.*?)\s*\[([^\]]*)\]\s*$/);
    const text = (m ? m[1] : line).trim();
    const terms = m ? m[2].split(",").map((t) => t.trim()).filter(Boolean).slice(0, 4) : [];
    if (!text) continue;
    const words = text.split(/\s+/).length;
    if (words > 30) {
      // long paragraph: one scene per sentence
      const parts = text.match(/[^.!?…؟]+[.!?…؟]*/g)?.map((p) => p.trim()).filter(Boolean) ?? [text];
      for (const p of parts) out.push({ text: p, terms });
    } else out.push({ text, terms });
  }
  return out.slice(0, 40);
}

const STOP = new Set(("the a an and or but if then of to in on at for with from by is are was were be been it its this that these those he she they we you i his her their our your " +
  "what when where who why how not no yes so very just can will would could should do does did has have had one two now than more most into out up down over after before " +
  "every each all any some him them me my mine about like").split(" "));
function autoTerm(text: string, language: string): string | null {
  if (language !== "en") return null;  // stock sites search best in English; other languages rely on [terms] or defaults
  const words = text.toLowerCase().replace(/[^a-z\s'-]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w));
  return words.length ? words.slice(0, 3).join(" ") : null;
}

// ---------- stock footage ----------
type Candidate = { type: "video" | "image"; source: string; id: string; url: string; preview: string; thumb: string; duration: number | null; width: number; height: number; tags: string; page: string };
async function pixabay(q: string, kind: "video" | "image", aspect: string, page = 1): Promise<Candidate[]> {
  if (!PIXABAY || !q.trim()) return [];
  const params = new URLSearchParams({ key: PIXABAY, q: q.slice(0, 100), safesearch: "true", per_page: "20", page: String(page) });
  if (kind === "image") { params.set("image_type", "photo"); if (aspect === "9:16") params.set("orientation", "vertical"); }
  const r = await fetch(`https://pixabay.com/api/${kind === "video" ? "videos/" : ""}?${params}`);
  if (!r.ok) return [];
  const data = await r.json();
  const vertical = aspect === "9:16";
  const hits: Candidate[] = (data.hits || []).map((h: any) => {
    if (kind === "video") {
      const v = h.videos || {};
      const big = v.large?.url ? v.large : v.medium;
      const small = v.tiny?.url ? v.tiny : v.small;
      if (!big?.url) return null;
      return { type: "video", source: "pixabay", id: String(h.id), url: big.url, preview: small?.url || big.url, thumb: v.medium?.thumbnail || v.small?.thumbnail || big.thumbnail || "",
        duration: h.duration ?? null, width: big.width, height: big.height, tags: h.tags || "", page: h.pageURL || "" };
    }
    return { type: "image", source: "pixabay", id: String(h.id), url: h.largeImageURL, preview: h.webformatURL, thumb: h.previewURL, duration: null,
      width: h.imageWidth, height: h.imageHeight, tags: h.tags || "", page: h.pageURL || "" };
  }).filter(Boolean);
  // orientation that matches the video first
  return hits.sort((a, b) => Number((b.height > b.width) === vertical) - Number((a.height > a.width) === vertical));
}

async function candidatesFor(terms: string[], aspect: string, need: number): Promise<Candidate[]> {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const t of terms) {
    if (out.length >= 8) break;
    for (const c of await pixabay(t, "video", aspect)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id); out.push(c);
      if (out.length >= 8) break;
    }
  }
  // long enough clips first, keep orientation order otherwise
  return out.sort((a, b) => Number((b.duration ?? 0) >= need) - Number((a.duration ?? 0) >= need));
}

// ---------- handlers ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(URL_, SERVICE);
    const userDb = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    if (!(await userDb.rpc("am_i_allowed")).data) return json({ error: "not allowed" }, 403);
    const { data: { user } } = await userDb.auth.getUser();
    const body = await req.json();

    if (body.action === "search") {
      const kind = body.kind === "image" ? "image" : "video";
      const results = await pixabay(String(body.q || ""), kind, String(body.aspect || "9:16"), Math.min(Math.max(Number(body.page) || 1, 1), 10));
      return json({ results, configured: !!PIXABAY });
    }

    if (body.action === "build") {
      const script = String(body.script || "");
      const parsed = parseScript(script);
      if (!parsed.length) return json({ error: "Write the voice-over first: one line per scene." }, 400);
      const aspect = ["9:16", "16:9", "1:1"].includes(body.aspect) ? body.aspect : "9:16";
      const language = /^[a-z]{2}$/.test(body.language) ? body.language : "en";
      const voice = VOICE.test(body.voice) ? body.voice : "en-US-AndrewNeural-Male";
      const rate = Math.min(Math.max(Number(body.voice_rate) || 1.1, 0.5), 2);
      const fields = {
        title: String(body.title || "Untitled video").slice(0, 200), language, voice, voice_rate: rate, aspect,
        settings: body.settings && typeof body.settings === "object" ? body.settings : {},
        idea_id: UUID.test(body.idea_id || "") ? body.idea_id : null,
        channel_id: UUID.test(body.channel_id || "") ? body.channel_id : null,
        status: "preparing", error: null,
      };
      let projectId = UUID.test(body.project_id || "") ? body.project_id : null;
      let old: any[] = [];
      let oldProject: any = null;
      if (projectId) {
        const { data } = await db.from("video_projects").select("*").eq("id", projectId).single();
        oldProject = data;
        if (!data) projectId = null;
      }
      if (projectId) {
        old = (await db.from("project_scenes").select("*").eq("project_id", projectId)).data || [];
        const { error } = await db.from("video_projects").update(fields).eq("id", projectId);
        if (error) throw error;
      } else {
        const { data, error } = await db.from("video_projects").insert({ ...fields, owner_id: user?.id ?? null }).select().single();
        if (error) throw error;
        projectId = data.id;
      }

      // keep voice + clip of lines that did not change (same voice settings)
      const sameVoice = oldProject && oldProject.voice === voice && Number(oldProject.voice_rate) === rate;
      const byText = new Map(old.map((s) => [s.text, s]));
      const defaults: string[] = (Array.isArray(body.default_terms) ? body.default_terms : []).map(String).filter(Boolean).slice(0, 8);
      const rows = await Promise.all(parsed.map(async (p, idx) => {
        const prev = byText.get(p.text);
        const terms = p.terms.length ? p.terms : (prev?.terms?.length ? prev.terms : [autoTerm(p.text, language)].filter(Boolean) as string[]);
        const searchTerms = [...terms, ...defaults.slice(idx % Math.max(defaults.length, 1)), ...defaults].filter(Boolean);
        const need = p.text.split(/\s+/).length / 2.6;
        const keepClip = prev?.clip && (!p.terms.length || JSON.stringify(p.terms) === JSON.stringify(prev.terms));
        const candidates = keepClip ? (prev.candidates || []) : await candidatesFor([...new Set(searchTerms)], aspect, need);
        const clip = keepClip ? prev.clip : (candidates[0] ? { ...candidates[0], trim: 0 } : { type: "card" });
        const keepVoice = sameVoice && prev?.voice_path && prev.voice_text === p.text;
        return {
          project_id: projectId, idx, text: p.text, terms, clip, candidates,
          voice_path: keepVoice ? prev.voice_path : null, voice_text: keepVoice ? prev.voice_text : null,
          voice_duration: keepVoice ? prev.voice_duration : null, words: keepVoice ? prev.words : null,
        };
      }));
      await db.from("project_scenes").delete().eq("project_id", projectId);
      const { data: inserted, error: insErr } = await db.from("project_scenes").insert(rows).select("id,voice_path");
      if (insErr) throw insErr;
      const needVoice = (inserted || []).filter((s) => !s.voice_path).map((s) => s.id);
      if (!needVoice.length) {
        await db.from("video_projects").update({ status: "ready" }).eq("id", projectId);
        return json({ project_id: projectId, status: "ready", footage: !!PIXABAY });
      }
      const err = await dispatch("prepare.yml", { project_id: projectId!, scene_ids: needVoice.length === rows.length ? "" : needVoice.join(",") });
      if (err) await db.from("video_projects").update({ status: "failed", error: err }).eq("id", projectId);
      return json({ project_id: projectId, status: err ? "failed" : "preparing", error: err, footage: !!PIXABAY });
    }

    if (body.action === "voice") {
      if (!UUID.test(body.project_id || "")) return json({ error: "project_id required" }, 400);
      const ids: string[] = (Array.isArray(body.scene_ids) ? body.scene_ids : []).filter((s: string) => UUID.test(s)).slice(0, 40);
      await db.from("video_projects").update({ status: "preparing", error: null }).eq("id", body.project_id);
      const err = await dispatch("prepare.yml", { project_id: body.project_id, scene_ids: ids.join(",") });
      if (err) await db.from("video_projects").update({ status: "failed", error: err }).eq("id", body.project_id);
      return json({ status: err ? "failed" : "preparing", error: err }, err ? 503 : 200);
    }

    if (body.action === "render") {
      if (!UUID.test(body.project_id || "")) return json({ error: "project_id required" }, 400);
      const { data: project } = await db.from("video_projects").select("*").eq("id", body.project_id).single();
      if (!project) return json({ error: "project not found" }, 404);
      const { data: scenes } = await db.from("project_scenes").select("id,text,voice_path,voice_text").eq("project_id", body.project_id);
      const stale = (scenes || []).filter((s) => !s.voice_path || s.voice_text !== s.text).length;
      if (!scenes?.length || stale) return json({ error: stale ? `${stale} scene(s) need their voice updated first.` : "No scenes." }, 400);
      const { data: job, error } = await db.from("render_jobs").insert({
        project_id: project.id, idea_id: project.idea_id, channel_id: project.channel_id,
        params: { engine: "editor", project_id: project.id, title: project.title, aspect: project.aspect },
      }).select().single();
      if (error) throw error;
      const err = await dispatch("video.yml", { job_id: job.id });
      await db.from("render_jobs").update(err ? { status: "failed", error: err } : { status: "dispatched" }).eq("id", job.id);
      return json({ job_id: job.id, status: err ? "failed" : "dispatched", error: err }, err ? 503 : 200);
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
