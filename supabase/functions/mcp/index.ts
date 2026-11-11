// The MCP connection: Claude (Claude Code, claude.ai, Claude Desktop) or any AI app that speaks MCP uses Short Viral
// from outside, with a token made in Settings → AI connection. The protocol and the tools are in server.ts.
// URL: https://<project>.supabase.co/functions/v1/mcp  (or …/mcp/<token> for apps that can't send a header)
// Deployed with verify_jwt off: the token is checked in server.ts before anything else.
import { createClient } from "npm:@supabase/supabase-js@2";
import { makeHandler } from "./server.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
Deno.serve(makeHandler(db));
