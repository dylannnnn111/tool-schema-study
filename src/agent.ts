// One question, one variant, one model: the model answers using the tools until it stops calling them.
// Every tool call is logged with the raw input, what the server made of it, and what the model saw.
import type { Block, Message, Model, ToolUse } from './llm.ts';
import type { CallResult, Server } from './server.ts';
import { toolDefs, type Variant } from './variants.ts';

export const system = (date: string) => `Today's date is ${date}. Answer with specific figures and the period they refer to.`;

export interface LoggedCall {
  turn: number;
  name: string;
  input: unknown;
  kind: CallResult['kind'];
  isError: boolean;
  canonical?: Record<string, unknown>;
  problems?: CallResult['problems'];
  seen: string; // what the model was shown (cut to 1,500 characters in the log)
}

export interface Transcript {
  answer: string;
  calls: LoggedCall[];
  turns: number;
  status: 'done' | 'max_turns' | 'error';
  error?: string;
  usage: { input: number; output: number; cacheWrite: number; cacheRead: number };
  ms: number;
}

export async function ask(opts: { model: Model; server: Server; variant: Variant; question: string; date: string; maxTurns?: number }): Promise<Transcript> {
  const t0 = Date.now();
  const tools = toolDefs(opts.variant);
  const messages: Message[] = [{ role: 'user', content: opts.question }];
  const calls: LoggedCall[] = [];
  const usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  const maxTurns = opts.maxTurns ?? 10;
  let answer = '';
  let turn = 0;
  try {
    for (; turn < maxTurns; turn++) {
      const res = await opts.model({ system: system(opts.date), messages, tools });
      usage.input += res.usage.input_tokens;
      usage.output += res.usage.output_tokens;
      usage.cacheWrite += res.usage.cache_creation_input_tokens ?? 0;
      usage.cacheRead += res.usage.cache_read_input_tokens ?? 0;
      messages.push({ role: 'assistant', content: res.content });
      const text = res.content.filter((b) => b.type === 'text').map((b) => b.text as string).join('\n').trim();
      if (text) answer = text;
      const uses = res.content.filter((b): b is Block & ToolUse => b.type === 'tool_use');
      if (!uses.length) return { answer, calls, turns: turn + 1, status: 'done', usage, ms: Date.now() - t0 };
      const results = await Promise.all(uses.map((u) => opts.server.call(opts.variant, u.name, u.input)));
      results.forEach((r, i) => calls.push({ turn, name: uses[i].name, input: uses[i].input, kind: r.kind, isError: r.isError, canonical: r.canonical, problems: r.problems, seen: r.text.slice(0, 1500) }));
      messages.push({ role: 'user', content: results.map((r, i) => ({ type: 'tool_result', tool_use_id: uses[i].id, content: r.text, ...(r.isError ? { is_error: true } : {}) })) });
    }
    return { answer, calls, turns: turn, status: 'max_turns', usage, ms: Date.now() - t0 };
  } catch (e) {
    return { answer, calls, turns: turn, status: 'error', error: e instanceof Error ? e.message : String(e), usage, ms: Date.now() - t0 };
  }
}
