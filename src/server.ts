// The tool server every variant talks to. It turns the model's arguments into a canonical call,
// then answers from a fixture on disk if that exact call has been made before, or fetches it live
// and saves it. That way every variant, model and run sees identical data, and a run can be
// repeated later without hitting the ABS or RBA again.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalize, runtimeError, specFor, validationError, type ArgProblem, type Variant } from './variants.ts';

export interface CallResult {
  text: string; // what the model sees
  isError: boolean;
  kind: 'ok' | 'invalid' | 'unknown-tool' | 'upstream' | 'missing-fixture';
  canonical?: Record<string, unknown>;
  problems?: ArgProblem[];
  fixture?: 'hit' | 'saved';
}

interface Fixture { tool: string; args: Record<string, unknown>; ok: boolean; result?: unknown; error?: string; fetchedAt: string }

/** JSON with object keys sorted, so the same call always hashes the same. */
export function stable(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stable).join(',')}]`;
  if (x && typeof x === 'object') return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${stable((x as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(x);
}

export const fixtureKey = (tool: string, args: Record<string, unknown>) =>
  createHash('sha1').update(tool + stable(args)).digest('hex').slice(0, 16);

export interface ServerOptions {
  dir: string; // fixtures folder
  frozen?: boolean; // true = never fetch live; a call with no fixture comes back as an error
  run?: (tool: string, args: Record<string, unknown>) => Promise<unknown>; // override for tests
}

export function createServer(opts: ServerOptions) {
  const pending = new Map<string, Promise<Fixture | null>>(); // concurrent identical calls share one fetch

  async function fixture(tool: string, args: Record<string, unknown>): Promise<{ f: Fixture | null; from: 'hit' | 'saved' }> {
    const file = join(opts.dir, tool, `${fixtureKey(tool, args)}.json`);
    try {
      return { f: JSON.parse(await readFile(file, 'utf8')) as Fixture, from: 'hit' };
    } catch { /* not recorded yet */ }
    if (opts.frozen) return { f: null, from: 'hit' };
    const k = file;
    if (!pending.has(k)) {
      pending.set(k, (async () => {
        const spec = specFor(tool)!;
        const run = opts.run ?? ((_: string, a: Record<string, unknown>) => spec.run(a));
        let f: Fixture;
        try {
          f = { tool, args, ok: true, result: await run(tool, args), fetchedAt: new Date().toISOString() };
        } catch (e) {
          f = { tool, args, ok: false, error: e instanceof Error ? e.message : String(e), fetchedAt: new Date().toISOString() };
        }
        await mkdir(join(opts.dir, tool), { recursive: true });
        await writeFile(file, JSON.stringify(f, null, 1));
        return f;
      })());
    }
    return { f: await pending.get(k)!, from: 'saved' };
  }

  /** What a tool call returns to the model, plus everything the scorer needs. */
  async function call(variant: Variant, name: string, input: unknown): Promise<CallResult> {
    const spec = specFor(name);
    if (!spec) {
      return { isError: true, kind: 'unknown-tool', text: variant === 'terse-errors' ? 'Error: request failed.' : `Error: there's no tool called ${name}.` };
    }
    const c = canonicalize(spec, variant, input);
    if (!c.ok) return { isError: true, kind: 'invalid', problems: c.problems, text: validationError(spec, variant, c.problems) };
    const { f, from } = await fixture(name, c.args);
    if (!f) return { isError: true, kind: 'missing-fixture', canonical: c.args, text: runtimeError(variant, 'no recorded data for this call (the run is frozen).') };
    if (!f.ok) return { isError: true, kind: 'upstream', canonical: c.args, fixture: from, text: runtimeError(variant, f.error!) };
    return { isError: false, kind: 'ok', canonical: c.args, fixture: from, text: JSON.stringify(f.result) };
  }

  /** Run a canonical call directly (for working out the right answers). */
  async function direct(name: string, args: Record<string, unknown>): Promise<unknown> {
    const spec = specFor(name);
    if (!spec) throw new Error(`no tool ${name}`);
    const c = canonicalize(spec, 'baseline', args);
    if (!c.ok) throw new Error(validationError(spec, 'baseline', c.problems));
    const { f } = await fixture(name, c.args);
    if (!f) throw new Error(`no fixture for ${name} ${stable(c.args)}`);
    if (!f.ok) throw new Error(f.error);
    return f.result;
  }

  return { call, direct };
}
export type Server = ReturnType<typeof createServer>;
