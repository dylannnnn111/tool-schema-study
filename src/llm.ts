// Talking to Claude: plain fetch against the Messages API, no SDK (same approach as tiny-agent).
import type { ToolDef } from './variants.ts';

// The 5.5 models think by default, so replies can carry thinking blocks. They're passed back unchanged.
export type Block = { type: string; [k: string]: unknown };
export type ToolUse = { type: 'tool_use'; id: string; name: string; input: unknown };
export type Message = { role: 'user' | 'assistant'; content: string | Block[] };
export type Request = { system: string; messages: Message[]; tools: ToolDef[] };
export type Usage = { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
export type Reply = { content: Block[]; stop_reason: string; usage: Usage };

/** Anything that turns a request into a reply. The real one is Claude; tests use a scripted fake. */
export type Model = (req: Request) => Promise<Reply>;

const API = `${process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'}/v1`;
const headers = (key: string) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' });
const CACHE = { cache_control: { type: 'ephemeral' } };

/** Cache the tool list and system prompt (identical for every question in a variant) and the conversation so far. */
function cached({ system, messages, tools }: Request) {
  const last = messages[messages.length - 1];
  const content = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content;
  return {
    tools: tools.map((t, i) => (i === tools.length - 1 ? { ...t, ...CACHE } : t)),
    system: [{ type: 'text', text: system, ...CACHE }],
    messages: [...messages.slice(0, -1), { role: last.role, content: content.map((b, i) => (i === content.length - 1 ? { ...b, ...CACHE } : b)) }],
  };
}

// Thinking counts toward max_tokens, so leave plenty of room (Judge's first smoke run had Opus hit a small limit).
export function claude(model: string, apiKey: string, maxTokens = 8000): Model {
  return async (req) => {
    for (let attempt = 0; ; attempt++) {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      let res: Response;
      try {
        res = await fetch(`${API}/messages`, { method: 'POST', headers: headers(apiKey), body: JSON.stringify({ model, max_tokens: maxTokens, ...cached(req) }) });
      } catch (e) {
        if (attempt >= 5) throw e;
        await wait(2000 * 2 ** attempt);
        continue;
      }
      if (res.ok) return (await res.json()) as Reply;
      const retry = res.status === 429 || res.status === 529 || res.status >= 500;
      if (!retry || attempt >= 5) throw new Error(`API ${res.status}: ${await res.text()}`);
      await wait(Number(res.headers.get('retry-after')) * 1000 || 2000 * 2 ** attempt);
    }
  };
}

/** "sonnet" -> the newest Sonnet on this key; full ids are left alone. */
export async function resolveModel(apiKey: string, name: string): Promise<string> {
  if (!/^(sonnet|haiku|opus)$/.test(name)) return name;
  const res = await fetch(`${API}/models?limit=100`, { headers: headers(apiKey) });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const { data } = (await res.json()) as { data: { id: string }[] };
  const hit = data.find((m) => m.id.includes(name));
  if (!hit) throw new Error(`No ${name} model on this key. Pick one of: ${data.map((m) => m.id).join(', ')}`);
  return hit.id;
}

/** $ per million tokens, matched by substring of the model id. */
export type Price = { input: number; output: number; cacheWrite?: number; cacheRead?: number };
export function cost(u: { input: number; output: number; cacheWrite: number; cacheRead: number }, p: Price | null): number | null {
  if (!p) return null;
  const usd = (u.input * p.input + u.cacheWrite * (p.cacheWrite ?? 1.25 * p.input) + u.cacheRead * (p.cacheRead ?? 0.1 * p.input) + u.output * p.output) / 1e6;
  return Math.round(usd * 1e5) / 1e5;
}
