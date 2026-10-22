// Scoring one transcript against one question. Four things, each null when it doesn't apply:
//   tools    - called every tool the question needs (in-scope questions only)
//   args     - some successful call to each checked tool had the right arguments
//   answer   - the final answer has the right figures (or, out of scope, says the data isn't there)
//   recovered - after a failed call, a later call to the same tool worked (only when something failed)
// Plus counts: calls, invalid calls (arguments the server rejected), and errors of any kind.
import type { Transcript } from './agent.ts';
import type { Check, Question } from './questions.ts';

export interface Score {
  tools: boolean | null;
  args: boolean | null;
  answer: boolean | null;
  recovered: boolean | null;
  calls: number;
  invalid: number;
  errors: number;
  needsHand: boolean;
}

export function numbersIn(text: string): number[] {
  return [...text.replace(/(\d),(?=\d{3}\b)/g, '$1').matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

/** Does any number in the text match, allowing % vs ratio (0.74 vs 74%) and normal rounding? */
export function hasNumber(text: string, value: number, tol?: number): boolean {
  const t = tol ?? Math.max(0.05, Math.abs(value) * 0.01);
  const candidates = [value, value * 100, value / 100];
  return numbersIn(text).some((n) => candidates.some((c, i) => {
    const allowed = i === 1 ? Math.max(t * 100, 0.5) : i === 2 ? t / 100 : t; // a ratio quoted as a % is usually rounded to whole numbers
    return Math.abs(Math.abs(n) - Math.abs(c)) <= allowed + 1e-9;
  }));
}

export const passes = (answer: string, checks: Check[]) =>
  checks.every((c) => (c.text != null ? (c.lead ? answer.slice(0, 400) : answer).toLowerCase().includes(c.text.toLowerCase()) : hasNumber(answer, c.value!, c.tol)));

// Phrases that say the data isn't there. Out-of-scope answers are also read by hand.
const DECLINE = /\b(not (available|covered|included|in (the|these|my) (data|tools))|isn't (available|covered|included)|aren't (available|covered|included)|don't (have|cover|include)|doesn't (cover|include|have|track)|do not (have|cover)|does not (cover|include|have)|no (data|access|tool)|only (covers?|has|includes?|tracks?)|(can't|cannot|can not) (find|provide|get|access|predict|forecast|tell|answer|give)|there(?:'s| is) no (data|series|rate|figure|tool)|(not|un)able to|outside (the|my|what)|beyond (the|what))/i;
export const declines = (answer: string) => DECLINE.test(answer);

export function score(q: Question, t: Transcript, truth: Check[][] | null): Score {
  const ok = t.calls.filter((c) => !c.isError);
  const called = new Set(t.calls.map((c) => c.name));

  const tools = q.decline ? null : q.tools.every((x) => (Array.isArray(x) ? x.some((y) => called.has(y)) : called.has(x)));

  const args = q.args
    ? Object.entries(q.args).every(([tool, pred]) => ok.some((c) => c.name === tool && c.canonical && safe(() => pred(c.canonical!))))
    : null;

  let answer: boolean | null = null;
  if (q.decline) answer = t.status === 'done' && declines(t.answer);
  else if (truth) answer = t.status === 'done' && truth.some((alt) => passes(t.answer, alt));

  const failed = t.calls.map((c, i) => ({ c, i })).filter(({ c }) => c.isError);
  // Out of scope, a failed call can be the right outcome (there is no peso rate), so recovery isn't scored there
  const recovered = failed.length && !q.decline
    ? [...new Set(failed.map(({ c }) => c.name))].every((name) => {
        const firstFail = failed.find(({ c }) => c.name === name)!.i;
        return t.calls.some((c, i) => i > firstFail && c.name === name && !c.isError);
      })
    : null;

  return {
    tools, args, answer, recovered,
    calls: t.calls.length,
    invalid: t.calls.filter((c) => c.kind === 'invalid' || c.kind === 'unknown-tool').length,
    errors: failed.length,
    needsHand: !!q.hand || !!q.decline,
  };
}

function safe(f: () => boolean): boolean {
  try { return f(); } catch { return false; }
}
