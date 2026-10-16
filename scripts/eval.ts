// Run every question through every variant x model x run. Resumable: finished cells are skipped,
// so rerun the same command after an interruption.
//
//   ANTHROPIC_API_KEY=... npm run eval            everything (5 variants x 3 models x 2 runs x 40 questions)
//   npm run eval -- v02 m14                       only these question ids
//
// Options (environment variables):
//   VARIANTS=baseline,nested   default: all five (see src/variants.ts)
//   MODELS=sonnet,haiku        family names (newest on the key) or full ids. Default: sonnet,haiku,opus
//   RUNS=2                     repeats, to see run-to-run noise. Default: 2
//   NAME=main                  folder under runs/. Default: main
//   CONCURRENCY=4              cells at once. Default: 4
//   DRY=1                      count cells and estimate cost (from runs/smoke if it exists), then stop
//   FROZEN=1                   never fetch live data; a call with no fixture fails
//   DATE=2026-10-17            the "today" the models are told. Pinned in the manifest on first run.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ask } from '../src/agent.ts';
import { claude, cost, resolveModel, type Price } from '../src/llm.ts';
import { QUESTIONS, type Check } from '../src/questions.ts';
import { score } from '../src/score.ts';
import { createServer } from '../src/server.ts';
import { VARIANT_NAMES, type Variant } from '../src/variants.ts';

const list = (s: string | undefined, fallback: string) => (s || fallback).split(',').map((x) => x.trim()).filter(Boolean);
const NAME = process.env.NAME || 'main';
const outDir = join('runs', NAME);
const DRY = !!process.env.DRY;
const key = process.env.ANTHROPIC_API_KEY;
const variants = list(process.env.VARIANTS, VARIANT_NAMES.join(',')) as Variant[];
for (const v of variants) if (!VARIANT_NAMES.includes(v)) throw new Error(`Unknown variant ${v}. Pick from: ${VARIANT_NAMES.join(', ')}`);
const RUNS = Number(process.env.RUNS ?? 2);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);
const only = process.argv.slice(2);
const questions = QUESTIONS.filter((q) => !only.length || only.includes(q.id));
if (!questions.length) throw new Error(`No questions match ${only.join(' ')}`);

mkdirSync(outDir, { recursive: true });
const manifestFile = join(outDir, 'manifest.json');
const manifest: { date: string; models: Record<string, string>; created: string } = existsSync(manifestFile)
  ? JSON.parse(readFileSync(manifestFile, 'utf8'))
  : { date: process.env.DATE || new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }), models: {}, created: new Date().toISOString() };

// Pin model ids on first use so a later resume doesn't quietly switch models
const families = list(process.env.MODELS, 'sonnet,haiku,opus');
const models: string[] = [];
for (const f of families) {
  if (manifest.models[f]) models.push(manifest.models[f]);
  else if (!/^(sonnet|haiku|opus)$/.test(f)) models.push((manifest.models[f] = f));
  else if (key) models.push((manifest.models[f] = await resolveModel(key, f)));
  else if (DRY) models.push(f);
  else throw new Error('Set ANTHROPIC_API_KEY (npm run eval:keychain reads it from the macOS Keychain).');
}
if (!DRY) writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

const prices: Record<string, Price> = JSON.parse(readFileSync('prices.json', 'utf8'));
const priceFor = (m: string) => prices[Object.keys(prices).find((k) => m.includes(k)) ?? ''] ?? null;

const cellFile = (v: string, m: string, q: string, r: number) => join(outDir, 'cells', v, m, `${q}-r${r}.json`);
const todo: { v: Variant; m: string; q: (typeof questions)[number]; r: number }[] = [];
let done = 0;
for (const v of variants) for (const m of models) for (const q of questions) for (let r = 1; r <= RUNS; r++) {
  if (existsSync(cellFile(v, m, q.id, r))) done++;
  else todo.push({ v, m, q, r });
}
console.log(`${NAME}: ${variants.length} variants x ${models.length} models x ${questions.length} questions x ${RUNS} runs = ${done + todo.length} cells, ${done} done, ${todo.length} to run. Date given to models: ${manifest.date}`);

if (DRY) {
  // Average cost per question by model family, measured in runs/smoke (npm run smoke)
  const smoke = join('runs', 'smoke', 'cells');
  const per: Record<string, number[]> = {};
  if (existsSync(smoke)) {
    for (const v of readdirSync(smoke)) for (const m of readdirSync(join(smoke, v))) for (const f of readdirSync(join(smoke, v, m))) {
      const c = JSON.parse(readFileSync(join(smoke, v, m, f), 'utf8'));
      const fam = ['sonnet', 'haiku', 'opus'].find((x) => m.includes(x)) ?? m;
      if (c.cost != null) (per[fam] ??= []).push(c.cost);
    }
  }
  let total = 0;
  const missing: string[] = [];
  for (const m of models) {
    const fam = ['sonnet', 'haiku', 'opus'].find((x) => m.includes(x)) ?? m;
    const xs = per[fam];
    const n = todo.filter((t) => t.m === m).length;
    if (!xs?.length) { missing.push(fam); continue; }
    const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
    total += avg * n;
    console.log(`  ${m}: ${n} cells x ~$${avg.toFixed(4)} = ~$${(avg * n).toFixed(2)}`);
  }
  if (missing.length) console.log(`  no smoke measurement for ${missing.join(', ')} - run npm run smoke:keychain first`);
  console.log(`Estimated cost of what's left: ~$${total.toFixed(2)}`);
  process.exit(0);
}

const server = createServer({ dir: 'fixtures', frozen: !!process.env.FROZEN });
const truths = new Map<string, Promise<Check[][] | null>>();
const truthFor = (q: (typeof questions)[number]) => {
  if (!q.truth) return Promise.resolve(null);
  if (!truths.has(q.id)) truths.set(q.id, q.truth(server.direct).catch((e) => { console.error(`  truth for ${q.id} failed: ${e.message}`); return null; }));
  return truths.get(q.id)!;
};

let spent = 0;
let finished = 0;
async function worker() {
  for (let t = todo.shift(); t; t = todo.shift()) {
    const { v, m, q, r } = t;
    const tr = await ask({ model: claude(m, key!), server, variant: v, question: q.q, date: manifest.date });
    const truth = await truthFor(q);
    const s = score(q, tr, truth);
    const c = cost(tr.usage, priceFor(m));
    spent += c ?? 0;
    finished++;
    const file = cellFile(v, m, q.id, r);
    mkdirSync(join(file, '..'), { recursive: true });
    if (tr.status === 'error') {
      console.log(`  ERROR ${v} ${m} ${q.id} r${r}: ${tr.error} (not saved, will retry next run)`);
      continue;
    }
    writeFileSync(file, JSON.stringify({ variant: v, model: m, run: r, question: q.id, kind: q.kind, q: q.q, date: manifest.date, cost: c, score: s, transcript: tr }, null, 1));
    const mark = (x: boolean | null) => (x === null ? '-' : x ? 'ok' : 'NO');
    console.log(`  [${finished}] ${v.padEnd(18)} ${m.padEnd(20)} ${q.id} r${r}  tools ${mark(s.tools)} args ${mark(s.args)} answer ${mark(s.answer)}  calls ${s.calls} invalid ${s.invalid}  $${(c ?? 0).toFixed(4)}  (total $${spent.toFixed(2)})`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`Done. Spent ~$${spent.toFixed(2)} this session. Next: npm run analyse${NAME !== 'main' ? ` (NAME=${NAME})` : ''}`);
