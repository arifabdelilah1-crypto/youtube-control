// The AI safety cap: how many AI calls may run in 24 h, all functions together (table ai_runs). Arif sets it in
// Settings → AI safety cap (app_settings.ai_daily_runs, default 400; migration 0037_ai_cap.sql).
// Every function checks it before an AI call; the "Generate video" job (render/autovideo.mjs) recognises the
// "Daily AI limit reached" message and waits for room instead of failing.
export const DEFAULT_AI_CAP = 400;

export async function aiRunsStatus(db: any): Promise<{ used: number; cap: number }> {
  const { data, error } = await db.rpc("ai_runs_status");
  const row = Array.isArray(data) ? data[0] : data;
  if (!error && row) return { used: Number(row.used) || 0, cap: Number(row.cap) || DEFAULT_AI_CAP };
  // a database without the setting yet: count the runs against the default cap
  const { count } = await db.from("ai_runs").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 864e5).toISOString());
  return { used: count ?? 0, cap: DEFAULT_AI_CAP };
}

export const capMessage = (cap: number) => `Daily AI limit reached (${cap} runs in 24 h). Raise it in Settings → AI safety cap, or wait.`;
