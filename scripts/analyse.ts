// Read every saved cell, re-score it with the current scorer and fixtures (so a scorer fix doesn't need
// a rerun), and write runs/<NAME>/results.md, results.json and hand.md (answers to read by hand).
//   npm run analyse            NAME=smoke npm run analyse
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Transcript } from '../src/agent.ts';
import { QUESTIONS, type Check } from '../src/questions.ts';
import { score, type Score } from '../src/score.ts';
import { createServer } from '../src/server.ts';
import { bootstrap, mean, signTest } from '../src/stats.ts';
import { VARIANTS, VARIANT_NAMES } from '../src/variants.ts';

const NAME = process.env.NAME || 'main';
const dir = join('runs', NAME, 'cells');
if (!existsSync(dir)) throw new Error(`No cells in ${dir} yet - run the eval first.`);

interface Cell { variant: string; model: string; run: number; question: string; kind: string; cost: number | null; transcript: Transcript; score: Score }
const cells: Cell[] = [];
for (const v of readdirSync(dir)) for (const m of readdirSync(join(dir, v))) for (const f of readdirSync(join(dir, v, m))) cells.push(JSON.parse(readFileSync(join(dir, v, m, f), 'utf8')));

const server = createServer({ dir: 'fixtures', frozen: true });
const qById = new Map(QUESTIONS.map((q) => [q.id, q]));
const truth = new Map<string, Check[][] | null>();
for (const q of QUESTIONS) truth.set(q.id, q.truth ? await q.truth(server.direct).catch(() => null) : null);
for (const c of cells) c.score = score(qById.get(c.question)!, c.transcript, truth.get(c.question) ?? null);

const variants = VARIANT_NAMES.filter((v) => cells.some((c) => c.variant === v));
const models = [...new Set(cells.map((c) => c.model))].sort();
const qids = [...new Set(cells.map((c) => c.question))].sort();
const short = (m: string) => m.replace(/^claude-/, '');

type Metric = (c: Cell) => number | null;
const METRICS: Record<string, { label: string; f: Metric; pct: boolean }> = {
  answer: { label: 'Right answer', f: (c) => b(c.score.answer), pct: true },
  tools: { label: 'Right tools', f: (c) => b(c.score.tools), pct: true },
  args: { label: 'Right arguments', f: (c) => b(c.score.args), pct: true },
  invalid: { label: 'Rejected calls per question', f: (c) => c.score.invalid, pct: false },
  recovered: { label: 'Recovered after an error', f: (c) => b(c.score.recovered), pct: true },
  calls: { label: 'Tool calls per question', f: (c) => c.score.calls, pct: false },
  cost: { label: 'Cost per question ($)', f: (c) => c.cost, pct: false },
};
function b(x: boolean | null) { return x === null ? null : x ? 1 : 0; }

/** Per-question values (averaged over runs, and over models if `model` is undefined) for one variant. */
function perQuestion(v: string, f: Metric, model?: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const q of qids) {
    const xs = cells.filter((c) => c.variant === v && c.question === q && (!model || c.model === model)).map(f).filter((x): x is number => x !== null);
    if (xs.length) out.set(q, mean(xs));
  }
  return out;
}
function summary(v: string, f: Metric, model?: string) {
  const pq = [...perQuestion(v, f, model).values()];
  return { value: mean(pq), ci: bootstrap(pq), n: pq.length };
}
/** Difference from baseline on the questions both have, with a bootstrap CI and a sign test. */
function vsBaseline(v: string, f: Metric, model?: string) {
  const base = perQuestion('baseline', f, model);
  const other = perQuestion(v, f, model);
  const diffs = [...other].filter(([q]) => base.has(q)).map(([q, x]) => x - base.get(q)!);
  return { diff: mean(diffs), ci: bootstrap(diffs, 2000, 7), p: signTest(diffs.filter((d) => d > 0).length, diffs.filter((d) => d < 0).length), n: diffs.length };
}

const fmt = (x: number, pct: boolean, dp = 2) => (Number.isNaN(x) ? '-' : pct ? `${(x * 100).toFixed(0)}%` : x.toFixed(dp));
const fmtDiff = (d: { diff: number; ci: [number, number]; p: number }, pct: boolean) =>
  Number.isNaN(d.diff) ? '-' : pct
    ? `${d.diff >= 0 ? '+' : ''}${(d.diff * 100).toFixed(0)} pts [${(d.ci[0] * 100).toFixed(0)}, ${(d.ci[1] * 100).toFixed(0)}]${d.p < 0.05 ? ' *' : ''}`
    : `${d.diff >= 0 ? '+' : ''}${d.diff.toFixed(2)} [${d.ci[0].toFixed(2)}, ${d.ci[1].toFixed(2)}]${d.p < 0.05 ? ' *' : ''}`;

const md: string[] = [`# Tool Schema Study - ${NAME}`, '', `${cells.length} cells: ${variants.length} variants x ${models.length} models (${models.map(short).join(', ')}) x ${qids.length} questions, ${[...new Set(cells.map((c) => c.run))].length} run(s). Total cost $${cells.reduce((a, c) => a + (c.cost ?? 0), 0).toFixed(2)}.`, ''];
md.push('Values are averaged per question (over runs and models), then over questions. Brackets are 95% bootstrap intervals over questions. * = sign test p < 0.05 against baseline.', '');

md.push('## Variants, all models together', '', `| Variant | ${Object.values(METRICS).map((m) => m.label).join(' | ')} |`, `|---|${Object.keys(METRICS).map(() => '---').join('|')}|`);
for (const v of variants) md.push(`| ${v} | ${Object.entries(METRICS).map(([k, m]) => fmt(summary(v, m.f).value, m.pct, k === 'cost' ? 4 : 2)).join(' | ')} |`);
md.push('');

md.push('## Change from baseline', '', '| Variant | Right answer | Right arguments | Rejected calls per question | Recovered after an error |', '|---|---|---|---|---|');
for (const v of variants.filter((x) => x !== 'baseline')) md.push(`| ${v} | ${['answer', 'args', 'invalid', 'recovered'].map((k) => fmtDiff(vsBaseline(v, METRICS[k].f), METRICS[k].pct)).join(' | ')} |`);
md.push('');

for (const k of ['answer', 'args', 'invalid', 'recovered'] as const) {
  md.push(`## ${METRICS[k].label}, by model`, '', `| Variant | ${models.map(short).join(' | ')} |`, `|---|${models.map(() => '---').join('|')}|`);
  for (const v of variants) md.push(`| ${v} | ${models.map((m) => fmt(summary(v, METRICS[k].f, m).value, METRICS[k].pct)).join(' | ')} |`);
  md.push('');
}

md.push('## Right answer, by question type', '', `| Variant | vague | out-of-scope | multi |`, '|---|---|---|---|');
for (const v of variants) {
  const by = (kind: string) => {
    const pq = [...perQuestion(v, METRICS.answer.f)].filter(([q]) => qById.get(q)?.kind === kind).map(([, x]) => x);
    return fmt(mean(pq), true);
  };
  md.push(`| ${v} | ${by('vague')} | ${by('out-of-scope')} | ${by('multi')} |`);
}
md.push('', '## What the variants were', '', ...variants.map((v) => `- **${v}**: ${VARIANTS[v as keyof typeof VARIANTS]}`), '');

// Which arguments got rejected most, per variant - the raw material for the write-up
md.push('## Most common rejected arguments', '');
for (const v of variants) {
  const counts = new Map<string, number>();
  for (const c of cells.filter((x) => x.variant === v)) for (const call of c.transcript.calls) for (const p of call.problems ?? []) {
    const k = `${call.name} ${p.path}: ${p.problem.replace(/"[^"]*"/g, '"..."')}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const top = [...counts].sort((a, z) => z[1] - a[1]).slice(0, 6);
  md.push(`**${v}**: ${top.length ? top.map(([k, n]) => `${k} (${n})`).join('; ') : 'none'}`, '');
}

const out = join('runs', NAME);
writeFileSync(join(out, 'results.md'), md.join('\n'));
const json = {
  name: NAME, cells: cells.length, models, variants, questions: qids.length,
  cost: cells.reduce((a, c) => a + (c.cost ?? 0), 0),
  byVariant: Object.fromEntries(variants.map((v) => [v, Object.fromEntries(Object.entries(METRICS).map(([k, m]) => [k, summary(v, m.f)]))])),
  byVariantModel: Object.fromEntries(variants.map((v) => [v, Object.fromEntries(models.map((mo) => [mo, Object.fromEntries(Object.entries(METRICS).map(([k, m]) => [k, summary(v, m.f, mo).value]))]))])),
  vsBaseline: Object.fromEntries(variants.filter((v) => v !== 'baseline').map((v) => [v, Object.fromEntries(Object.entries(METRICS).map(([k, m]) => [k, vsBaseline(v, m.f)]))])),
};
writeFileSync(join(out, 'results.json'), JSON.stringify(json, null, 1));
const expected = VARIANT_NAMES.length * 3 * QUESTIONS.length * 2;
if (NAME === 'main' && cells.length >= expected) writeFileSync('results.json', JSON.stringify(json, null, 1));

// Answers a person needs to read: hand-flagged questions and out-of-scope ones (first run only, to keep it readable)
const hand: string[] = [`# Answers to read by hand - ${NAME}`, ''];
for (const q of QUESTIONS.filter((x) => x.hand || x.decline)) {
  hand.push(`## ${q.id} (${q.kind}): ${q.q}`, '', q.hand ? `Look for: ${q.hand}` : 'Look for: says the data isn\'t available, no invented figure.', '');
  for (const c of cells.filter((x) => x.question === q.id && x.run === 1)) {
    hand.push(`**${c.variant} / ${short(c.model)}** - auto: ${c.score.answer === null ? 'n/a' : c.score.answer ? 'pass' : 'FAIL'}, calls: ${c.transcript.calls.map((x) => x.name + (x.isError ? '!' : '')).join(', ') || 'none'}`, '', '> ' + (c.transcript.answer || '(no answer)').replace(/\n+/g, '\n> '), '');
  }
}
writeFileSync(join(out, 'hand.md'), hand.join('\n'));
console.log(md.slice(0, 20).join('\n'));
console.log(`\nWrote ${out}/results.md, results.json and hand.md`);
