// Connect Facebook Pages (and their Instagram accounts) directly with Meta, without Blotato.
//   POST {action:"start", return_to, channel_id?}  (dashboard user's JWT) -> {url} to Facebook's login dialog
//   GET  ?code&state                                (Facebook redirect)  -> every Page the profile manages is saved with a
//        long-lived Page token in Vault (public.meta_pages), then back to the dashboard (#/channel/<id> or #/settings)
// The app stays in Development mode: it works for the app's own admins and their Pages without Meta's review.
// Secrets: META_APP_ID, META_APP_SECRET, optional META_CONFIG_ID (a "Facebook Login for Business" configuration;
// without it the dialog asks for the scopes below).
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const APP_ID = (Deno.env.get("META_APP_ID") ?? "").trim();
const APP_SECRET = (Deno.env.get("META_APP_SECRET") ?? "").trim();
const CONFIG_ID = (Deno.env.get("META_CONFIG_ID") ?? "").trim();
const GRAPH = "https://graph.facebook.com/v27.0";
const REDIRECT = `${URL_}/functions/v1/meta-oauth`;
const SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "pages_manage_metadata", "business_management",
  "instagram_basic", "instagram_content_publish"];
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
  return p as { u: string; r: string; exp: number; n?: string };
}
const back = (returnTo: string, ok: boolean, msg = "", network?: string, count = 0) =>
  Response.redirect(`${returnTo}#/${network ? `channel/${network}` : "settings"}?${ok ? `fb_connected=${count}` : "fb_error=" + encodeURIComponent(msg)}`, 302);

async function graph(path: string, params: Record<string, string>) {
  const r = await fetch(`${GRAPH}/${path}?${new URLSearchParams(params)}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(data.error?.message || `Facebook ${r.status}`);
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!APP_ID || !APP_SECRET) return json({ error: "Facebook isn't set up yet: add META_APP_ID and META_APP_SECRET in Supabase Edge Function secrets." }, 503);

  // 1) Start: the login dialog URL, for an allow-listed dashboard user
  if (req.method === "POST") {
    const user = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: allowed } = await user.rpc("am_i_allowed");
    const { data: { user: u } } = await user.auth.getUser();
    if (!allowed || !u) return json({ error: "not allowed" }, 403);
    const { return_to, channel_id } = await req.json();
    if (!/^https:\/\/[^\s]+$/.test(return_to || "")) return json({ error: "return_to must be an https URL" }, 400);
    const state = await signState({ u: u.id, r: return_to, n: /^[0-9a-f-]{36}$/.test(channel_id || "") ? channel_id : undefined, exp: Date.now() + 15 * 60e3 });
    const p = new URLSearchParams({ client_id: APP_ID, redirect_uri: REDIRECT, response_type: "code", state,
      ...(CONFIG_ID ? { config_id: CONFIG_ID } : { scope: SCOPES.join(","), auth_type: "rerequest" }) });
    return json({ url: `https://www.facebook.com/v27.0/dialog/oauth?${p}` });
  }

  // 2) Callback from Facebook
  const url = new URL(req.url);
  let st;
  try { st = await readState(url.searchParams.get("state") || ""); } catch (e) { return new Response(`Invalid request: ${(e as Error).message}`, { status: 400 }); }
  if (url.searchParams.get("error")) return back(st.r, false, url.searchParams.get("error_description") || url.searchParams.get("error")!, st.n);
  try {
    // code -> short-lived user token -> long-lived user token (about 60 days); Page tokens taken from it don't expire
    const short = await graph("oauth/access_token", { client_id: APP_ID, client_secret: APP_SECRET, redirect_uri: REDIRECT, code: url.searchParams.get("code") || "" });
    const long = await graph("oauth/access_token", { grant_type: "fb_exchange_token", client_id: APP_ID, client_secret: APP_SECRET, fb_exchange_token: short.access_token });
    const pages: any[] = [];
    let next: string | null = `${GRAPH}/me/accounts?${new URLSearchParams({ fields: "id,name,category,access_token,picture{url},instagram_business_account{id,username}", limit: "100", access_token: long.access_token })}`;
    while (next && pages.length < 500) {
      const r = await fetch(next);
      const data = await r.json();
      if (data.error) throw new Error(data.error.message);
      pages.push(...(data.data || []));
      next = data.paging?.next || null;
    }
    if (!pages.length) throw new Error("no Facebook Page came back. In the Facebook window, choose \"Opt in to all current and future Pages\" (or tick each Page), then try again.");
    const db = createClient(URL_, SERVICE);
    for (const p of pages) {
      if (!p.access_token) continue;
      const { error } = await db.rpc("store_meta_page", {
        p_page_id: String(p.id), p_name: String(p.name || p.id).slice(0, 200), p_picture: p.picture?.data?.url ?? null, p_category: p.category ?? null,
        p_ig_user_id: p.instagram_business_account?.id ?? null, p_ig_username: p.instagram_business_account?.username ?? null,
        p_token: p.access_token, p_user: st.u,
      });
      if (error) throw error;
    }
    return back(st.r, true, "", st.n, pages.length);
  } catch (e) {
    return back(st.r, false, (e as Error).message, st.n);
  }
});
