// Work out the right answer to every question from the data (fetching and saving fixtures as needed),
// and print them so they can be checked by hand before the run. Writes runs/references.md.
//   npm run references            FROZEN=1 to use saved fixtures only
import { mkdirSync, writeFileSync } from 'node:fs';
import { QUESTIONS } from '../src/questions.ts';
import { createServer } from '../src/server.ts';

const server = createServer({ dir: 'fixtures', frozen: !!process.env.FROZEN });
const lines = ['# Reference answers', '', `Worked out ${new Date().toISOString().slice(0, 10)} from the fixtures in fixtures/.`, '', '| id | kind | question | correct answer must contain | read by hand |', '|---|---|---|---|---|'];
let failed = 0;
for (const q of QUESTIONS) {
  let want = '';
  if (q.decline) want = 'says the data isn\'t available';
  else if (q.truth) {
    try {
      const alts = await q.truth(server.direct);
      want = alts.map((alt) => alt.map((c) => `${c.label}: ${c.text ?? c.value}`).join(' AND ')).join(' OR ');
    } catch (e) {
      failed++;
      want = `FAILED: ${e instanceof Error ? e.message : e}`;
    }
  } else want = '(hand only)';
  console.log(`${q.id}  ${want}`);
  lines.push(`| ${q.id} | ${q.kind} | ${q.q} | ${want} | ${q.hand ?? ''} |`);
}
mkdirSync('runs', { recursive: true });
writeFileSync('runs/references.md', lines.join('\n') + '\n');
console.log(`\nWrote runs/references.md${failed ? ` - ${failed} failed, fix before running the eval` : ''}`);
process.exit(failed ? 1 : 0);
