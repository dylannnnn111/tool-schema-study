import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ask } from '../src/agent.ts';
import type { Model, Reply, Request } from '../src/llm.ts';
import { QUESTIONS } from '../src/questions.ts';
import { declines, hasNumber, score } from '../src/score.ts';
import { createServer } from '../src/server.ts';
import { bootstrap, signTest } from '../src/stats.ts';
import { TOOLS, toolByName } from '../src/tools.ts';
import { VARIANT_NAMES, canonicalize, toolDefs, validationError } from '../src/variants.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'tss-test-'));
const json = (x: unknown) => JSON.stringify(x);

// ---------- schemas ----------

test('every variant describes all ten tools', () => {
  for (const v of VARIANT_NAMES) assert.equal(toolDefs(v).length, 10, v);
});

test('no-enums removes every enum and changes nothing else', () => {
  const base = json(toolDefs('baseline'));
  const plain = json(toolDefs('no-enums'));
  assert.match(base, /"enum"/);
  assert.doesNotMatch(plain, /"enum"/);
  const stripped = JSON.parse(base, (k, v) => (k === 'enum' ? undefined : v));
  assert.deepEqual(JSON.parse(plain), stripped);
});

test('terse-descriptions keeps the shape but drops parameter descriptions', () => {
  const t = toolDefs('terse-descriptions');
  assert.doesNotMatch(json(t.map((x) => x.input_schema)), /"description"/);
  assert.equal(t.find((x) => x.name === 'get_cpi')!.description, 'ABS consumer price index.');
  const strip = (d: unknown) => JSON.parse(json(d), (k, v) => (k === 'description' ? undefined : v));
  assert.deepEqual(strip(t.map((x) => x.input_schema)), strip(toolDefs('baseline').map((x) => x.input_schema)));
});

test('nested groups arguments and keeps required ids at the top', () => {
  const cpi = toolDefs('nested').find((x) => x.name === 'get_cpi')!.input_schema as { properties: Record<string, { properties: object }> };
  assert.deepEqual(Object.keys(cpi.properties).sort(), ['options', 'period', 'select']);
  assert.deepEqual(Object.keys(cpi.properties.select.properties).sort(), ['cities', 'items']);
  const rba = toolDefs('nested').find((x) => x.name === 'rba_series')!.input_schema as { required: string[]; properties: object };
  assert.deepEqual(rba.required, ['table']);
  assert.ok('table' in rba.properties && 'select' in rba.properties);
});

test('terse-errors only changes error text; the combined variant has no-enums schemas', () => {
  assert.deepEqual(toolDefs('terse-errors'), toolDefs('baseline'));
  assert.deepEqual(toolDefs('no-enums-terse-errors'), toolDefs('no-enums'));
});

// ---------- turning arguments into canonical calls ----------

const cpi = toolByName.get('get_cpi')!;

test('fills defaults and normalises values the same way in every variant', () => {
  const c = canonicalize(cpi, 'baseline', { items: ['rents'], cities: ['Sydney'] });
  assert.deepEqual(c, { ok: true, args: { items: ['rents'], cities: ['sydney'], measure: 'annual_change', adjustment: 'original' } });
  const n = canonicalize(cpi, 'nested', { select: { items: ['rents'], cities: ['sydney'] } });
  assert.deepEqual(n, c);
  const cp = canonicalize(toolByName.get('get_commute_pulse')!, 'no-enums', { centres: ['north sydney'] });
  assert.deepEqual(cp.ok && cp.args.centres, ['North Sydney']);
  const fx = canonicalize(toolByName.get('get_exchange_rates')!, 'baseline', { currencies: ['jpy'] });
  assert.deepEqual(fx.ok && fx.args.currencies, ['JPY']);
});

test('rejects bad values, unknown and missing arguments', () => {
  const bad = canonicalize(cpi, 'no-enums', { cities: ['NSW'] });
  assert.equal(bad.ok, false);
  const msg = validationError(cpi, 'no-enums', (bad as { problems: never }).problems);
  assert.match(msg, /cities: "NSW" isn't a valid value\. Use one of: australia, sydney/);
  assert.equal(validationError(cpi, 'terse-errors', (bad as { problems: never }).problems), 'Error: invalid arguments.');
  assert.equal(validationError(cpi, 'no-enums-terse-errors', (bad as { problems: never }).problems), 'Error: invalid arguments.');
  // flat arguments sent to the nested schema
  const flat = canonicalize(cpi, 'nested', { items: ['rents'] });
  assert.equal(flat.ok, false);
  assert.match(json(flat), /unknown argument/);
  const missing = canonicalize(toolByName.get('rba_series')!, 'baseline', {});
  assert.match(json(missing), /table.*is required/);
  assert.equal(canonicalize(cpi, 'baseline', { start: '2022/01' }).ok, false);
  assert.equal(canonicalize(cpi, 'baseline', { cities: 'sydney' }).ok, false); // a string where a list goes
});

// ---------- the fixture-backed server ----------

test('records a call once and replays it; concurrent identical calls share one fetch', async () => {
  const dir = tmp();
  let runs = 0;
  const s = createServer({ dir, run: async () => { runs++; return { series: [{ name: 'x', latest: { period: '2026-09', value: 3.1 }, points: [] }] }; } });
  const [a, b] = await Promise.all([s.call('baseline', 'get_cash_rate', {}), s.call('nested', 'get_cash_rate', {})]);
  assert.equal(runs, 1);
  assert.equal(a.text, b.text);
  const c = await s.call('baseline', 'get_cash_rate', {});
  assert.equal(c.fixture, 'hit');
  assert.equal(runs, 1);
  const frozen = createServer({ dir, frozen: true });
  assert.equal((await frozen.call('baseline', 'get_cash_rate', { start: '2020-01' })).kind, 'missing-fixture');
  assert.equal((await frozen.call('baseline', 'get_cash_rate', {})).kind, 'ok');
  rmSync(dir, { recursive: true });
});

test('upstream failures are saved too, and worded per variant', async () => {
  const dir = tmp();
  const s = createServer({ dir, run: async () => { throw new Error('ABS rejected the query'); } });
  const a = await s.call('baseline', 'abs_get_data', { dataflow: 'WPI', key: 'x' });
  assert.equal(a.kind, 'upstream');
  assert.equal(a.text, 'Error: ABS rejected the query');
  const b = await s.call('terse-errors', 'abs_get_data', { dataflow: 'WPI', key: 'x' });
  assert.equal(b.text, 'Error: request failed.');
  assert.equal((await s.call('baseline', 'nope', {})).kind, 'unknown-tool');
  rmSync(dir, { recursive: true });
});

// ---------- the agent loop, with a scripted fake model ----------

function scripted(turns: Reply['content'][], seen: Request[] = []): Model {
  let i = 0;
  return async (req) => {
    seen.push(structuredClone(req));
    const content = turns[Math.min(i++, turns.length - 1)];
    return { content, stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 50 } };
  };
}
const use = (name: string, input: unknown, id = `t${Math.random()}`) => ({ type: 'tool_use', id, name, input });
const say = (text: string) => ({ type: 'text', text });

test('logs a rejected call, the retry, and the answer', async () => {
  const dir = tmp();
  const server = createServer({ dir, run: async () => ({ series: [{ name: 'Rents - Sydney', latest: { period: '2026-08', value: 5.4 }, points: [] }] }) });
  const seen: Request[] = [];
  const model = scripted([
    [{ type: 'thinking', thinking: 'hmm', signature: 's' }, use('get_cpi', { items: ['rents'], cities: ['NSW'] }, 'a')],
    [use('get_cpi', { items: ['rents'], cities: ['sydney'] }, 'b')],
    [say('Sydney rents are up 5.4% over the year to August 2026.')],
  ], seen);
  const t = await ask({ model, server, variant: 'baseline', question: 'rents?', date: '2026-10-17' });
  assert.equal(t.status, 'done');
  assert.equal(t.calls.length, 2);
  assert.equal(t.calls[0].kind, 'invalid');
  assert.equal(t.usage.input, 300);
  assert.equal(t.usage.cacheRead, 150);
  // the thinking block goes back unchanged, and the error is marked as an error
  assert.equal((seen[1].messages[1].content as { type: string }[])[0].type, 'thinking');
  assert.equal((seen[1].messages[2].content as { is_error?: boolean }[])[0].is_error, true);
  const q = QUESTIONS.find((x) => x.id === 'v02')!;
  const s = score(q, t, [[{ label: 'rents', value: 5.4 }]]);
  assert.deepEqual([s.tools, s.args, s.answer, s.recovered, s.invalid], [true, true, true, true, 1]);
  rmSync(dir, { recursive: true });
});

test('stops after max turns', async () => {
  const server = createServer({ dir: tmp(), run: async () => ({ series: [] }) });
  const t = await ask({ model: scripted([[use('get_cash_rate', {})]]), server, variant: 'baseline', question: 'x', date: '2026-10-17', maxTurns: 3 });
  assert.equal(t.status, 'max_turns');
  assert.equal(t.calls.length, 3);
});

// ---------- scoring ----------

test('number matching allows rounding and ratio vs percent', () => {
  assert.ok(hasNumber('about 74% of midweek', 0.741));
  assert.ok(hasNumber('the cash rate is 3.60%', 3.6));
  assert.ok(hasNumber('unemployment was 4.3 per cent', 4.27, 0.1));
  assert.ok(!hasNumber('unemployment was 4.5 per cent', 4.27, 0.1));
  assert.ok(hasNumber('A$1 buys 1,040.5 pesos', 1040.5));
  assert.ok(!hasNumber('no figures here', 3));
});

test('decline phrases', () => {
  assert.ok(declines("The Commute Pulse data only covers Sydney centres, so I can't give a Melbourne figure."));
  assert.ok(declines("I don't have access to Federal Reserve data with these tools."));
  assert.ok(!declines('The Melbourne Friday gap is 0.81.'));
});

test('out-of-scope questions do not score tool choice or recovery', () => {
  const q = QUESTIONS.find((x) => x.id === 'o07')!;
  const t = { answer: "There's no peso rate in the RBA's exchange rate data, so I can't answer that.", calls: [{ turn: 0, name: 'get_exchange_rates', input: {}, kind: 'invalid' as const, isError: true, seen: '' }], turns: 2, status: 'done' as const, usage: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }, ms: 0 };
  const s = score(q, t, null);
  assert.deepEqual([s.tools, s.answer, s.recovered], [null, true, null]);
});

// ---------- stats ----------

test('sign test and bootstrap', () => {
  assert.equal(signTest(0, 0), 1);
  assert.equal(signTest(5, 0), 0.0625);
  assert.ok(Math.abs(signTest(9, 1) - 0.021484375) < 1e-12);
  const [lo, hi] = bootstrap([0, 1, 1, 0, 1, 1, 1, 0]);
  assert.ok(lo < 0.625 && hi > 0.625);
  assert.deepEqual(bootstrap([0, 1, 1]), bootstrap([0, 1, 1]));
});

// ---------- the question set ----------

test('40 questions: 14 vague, 10 out of scope, 16 multi; ids unique; checks point at real tools', () => {
  assert.equal(QUESTIONS.length, 40);
  assert.equal(new Set(QUESTIONS.map((q) => q.id)).size, 40);
  const count = (k: string) => QUESTIONS.filter((q) => q.kind === k).length;
  assert.deepEqual([count('vague'), count('out-of-scope'), count('multi')], [14, 10, 16]);
  const names = new Set(TOOLS.map((t) => t.name));
  for (const q of QUESTIONS) {
    for (const t of q.tools.flat()) assert.ok(names.has(t), `${q.id}: ${t}`);
    for (const t of Object.keys(q.args ?? {})) assert.ok(q.tools.flat().includes(t), `${q.id}: args for ${t} but it isn't required`);
    assert.ok(q.decline || q.truth || q.hand, `${q.id} has no way to be scored`);
    if (q.decline) assert.equal(q.tools.length, 0, q.id);
  }
});
