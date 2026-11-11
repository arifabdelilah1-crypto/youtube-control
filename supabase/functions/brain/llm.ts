// One conversation with tools, whatever the provider: Claude (Anthropic SDK), OpenAI or DeepSeek (both speak the OpenAI
// chat-completions format). The brain only sees step() and addResults().
import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";

export type Provider = "deepseek" | "openai" | "anthropic";
export type ToolDef = { name: string; description: string; parameters: Record<string, unknown> };
export type Call = { id: string; name: string; args: Record<string, unknown> };
export type Step = { text: string; calls: Call[]; usage: { input: number; output: number }; stop: string };

export const DEFAULT_MODEL: Record<Provider, string | null> = { deepseek: "deepseek-flash", anthropic: "claude-sonnet-5-5", openai: null };
// $ per million tokens [input, output] when known (OpenAI's list isn't kept here: its calls show tokens only)
export const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20], "claude-fable-5-2": [8, 40], "claude-sonnet-5-5": [2, 10],
  "deepseek-flash": [0.15, 0.6], "deepseek-v4-pro": [0.66, 1.98],
};

const parseArgs = (s: unknown) => { try { return typeof s === "string" ? JSON.parse(s || "{}") : (s as Record<string, unknown>) || {}; } catch { return {}; } };

export class Conversation {
  private anthropic?: Anthropic;
  private msgs: any[];
  constructor(private provider: Provider, private model: string, private key: string, private system: string,
    history: { role: "user" | "assistant"; content: string }[], private tools: ToolDef[], private timeoutMs = 100_000) {
    if (provider === "anthropic") {
      this.anthropic = new Anthropic({ apiKey: key, maxRetries: 1, timeout: timeoutMs });
      this.msgs = history.map((m) => ({ role: m.role, content: m.content }));
    } else {
      this.msgs = [{ role: "system", content: system }, ...history.map((m) => ({ role: m.role, content: m.content }))];
    }
  }

  async step(): Promise<Step> {
    if (this.anthropic) {
      const res = await this.anthropic.messages.create({
        model: this.model, max_tokens: 8000, system: this.system, messages: this.msgs,
        tools: this.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as any })),
      });
      // the whole turn goes back as it came (thinking included) so the next step continues it
      this.msgs.push({ role: "assistant", content: res.content });
      const text = res.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
      const calls = res.content.filter((b: any) => b.type === "tool_use").map((b: any) => ({ id: b.id, name: b.name, args: b.input || {} }));
      return { text, calls, usage: { input: res.usage.input_tokens, output: res.usage.output_tokens }, stop: res.stop_reason || "" };
    }
    const url = this.provider === "deepseek" ? "https://api.deepseek.com/chat/completions" : "https://api.openai.com/v1/chat/completions";
    const r = await fetch(url, {
      method: "POST", signal: AbortSignal.timeout(this.timeoutMs),
      headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model, messages: this.msgs,
        tools: this.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
        ...(this.provider === "deepseek" ? { thinking: { type: "disabled" }, temperature: 0.5 } : {}),
      }),
    });
    if (!r.ok) throw new Error(`${this.provider === "deepseek" ? "DeepSeek" : "OpenAI"} ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const data = await r.json();
    const msg = data.choices?.[0]?.message || {};
    this.msgs.push({ role: "assistant", content: msg.content ?? "", ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) });
    const calls = (msg.tool_calls || []).map((c: any) => ({ id: c.id, name: c.function?.name, args: parseArgs(c.function?.arguments) }));
    return { text: String(msg.content || "").trim(), calls, usage: { input: data.usage?.prompt_tokens || 0, output: data.usage?.completion_tokens || 0 },
      stop: data.choices?.[0]?.finish_reason || "" };
  }

  addResults(results: { id: string; content: string }[]) {
    if (this.anthropic) this.msgs.push({ role: "user", content: results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.content })) });
    else for (const r of results) this.msgs.push({ role: "tool", tool_call_id: r.id, content: r.content });
  }
}

/** The models a key can use, newest names first, for the Brain's settings. */
export async function listModels(provider: Provider, key: string): Promise<string[]> {
  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 20_000 });
    const out: string[] = [];
    for await (const m of client.models.list({ limit: 100 })) out.push(m.id);
    return out;
  }
  const url = provider === "deepseek" ? "https://api.deepseek.com/models" : "https://api.openai.com/v1/models";
  const r = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`${provider} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const ids: string[] = ((await r.json()).data || []).map((m: any) => String(m.id));
  // OpenAI lists every kind of model: keep the ones that chat
  return provider === "openai"
    ? ids.filter((id) => /^(gpt|o\d|chatgpt)/i.test(id) && !/(audio|realtime|tts|transcribe|image|embedding|search|moderation|instruct)/i.test(id)).sort().reverse()
    : ids;
}
