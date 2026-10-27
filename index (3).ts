// Connect a YouTube channel with Google.
//   POST {action:"start", return_to}  (dashboard user's JWT) -> {url} to Google's consent screen
//   GET  ?code&state                  (Google redirect)       -> stores refresh token in Vault, back to dashboard
// Brand Account channels: Google asks which channel to authorize; repeat once per channel.
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const REDIRECT = `${URL_}/functions/v1/google-oauth`;
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl",
];
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));
async function hmac(data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(SERVICE), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
async function signState(payload: object) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${await hmac(body)}`;
}
async function readState(state: string) {
  const [body, sig] = state.split(".");
  if (!body || !sig || (await hmac(body)) !== sig) throw new Error("bad state");
  const p = JSON.parse(fromB64url(body));
  if (Date.now() > p.exp) throw new Error("state expired");
  return p as { u: string; r: string; exp: number };
}
const back = (returnTo: string, ok: boolean, msg = "") =>
  Response.redirect(`${returnTo}#/settings?${ok ? "connected=1" : "error=" + encodeURIComponent(msg)}`, 302);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!CLIENT_ID || !CLIENT_SECRET) return json({ error: "Google OAuth client is not configured yet" }, 503);

  // 1) Start: build the consent URL for an allow-listed dashboard user
  if (req.method === "POST") {
    const user = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: allowed } = await user.rpc("am_i_allowed");
    const { data: { user: u } } = await user.auth.getUser();
    if (!allowed || !u) return json({ error: "not allowed" }, 403);
    const { return_to } = await req.json();
    if (!/^https:\/\/[^\s]+$/.test(return_to || "")) return json({ error: "return_to must be an https URL" }, 400);
    const state = await signState({ u: u.id, r: return_to, exp: Date.now() + 10 * 60 * 1000 });
    const p = new URLSearchParams({
      client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: "code", scope: SCOPES.join(" "),
      access_type: "offline", prompt: "consent select_account", include_granted_scopes: "true", state,
    });
    return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${p}` });
  }

  // 2) Callback from Google
  const url = new URL(req.url);
  let st;
  try { st = await readState(url.searchParams.get("state") || ""); } catch (e) { return new Response(`Invalid request: ${(e as Error).message}`, { status: 400 }); }
  if (url.searchParams.get("error")) return back(st.r, false, url.searchParams.get("error")!);
  try {
    const tr = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: url.searchParams.get("code") || "", client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT, grant_type: "authorization_code" }),
    });
    const tok = await tr.json();
    if (!tr.ok || !tok.refresh_token) throw new Error(tok.error_description || "no refresh token returned");

    const cr = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { Authorization: `Bearer ${tok.access_token}` } });
    const items = (await cr.json()).items || [];
    if (!items.length) throw new Error("this Google account has no YouTube channel");

    const db = createClient(URL_, SERVICE);
    for (const c of items) {
      const thumbs = c.snippet?.thumbnails || {};
      const { data: row, error } = await db.from("channels").upsert({
        youtube_channel_id: c.id, title: c.snippet?.title, handle: c.snippet?.customUrl ?? null,
        thumbnail_url: (thumbs.medium || thumbs.default)?.url ?? null,
      }, { onConflict: "youtube_channel_id" }).select().single();
      if (error) throw error;
      const { error: e2 } = await db.rpc("store_channel_refresh_token", { p_channel_id: row.id, p_token: tok.refresh_token, p_scopes: (tok.scope || "").split(" ") });
      if (e2) throw e2;
    }
    return back(st.r, true);
  } catch (e) {
    return back(st.r, false, (e as Error).message);
  }
});
