// direct renderer harness: run EVERY topic body through renderMarkdown with
// a watchdog, to find any input that makes the parser spin (node 24 strips
// the types). Usage: node --experimental-strip-types tools/mdcheck.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { renderMarkdown, plainText } from '../src/engine/markdown.ts';

const dir = join(import.meta.dirname, '../src/help/topics');
let bad = 0;
for (const f of readdirSync(dir).filter(f => f.endsWith('.md'))) {
  const src = readFileSync(join(dir, f), 'utf8');
  const body = src.split('\n').slice(1).join('\n');
  plainText(body);
  const t0 = Date.now();
  const d = renderMarkdown(body);
  const ms = Date.now() - t0;
  if (ms > 500) { console.log(`SLOW ${basename(f)} ${ms}ms`); bad++; }
  if (!d.html.includes('<h2') && !d.html.includes('<p')) { console.log(`EMPTY ${basename(f)}`); bad++; }
  console.log(`ok ${basename(f)} ${ms}ms ${d.html.length}b heads=${d.headings.length}`);
}
// fuzz: a few adversarial fragments
const fuzz = ['- a\n - weird-one-space\n- b', '```\nunclosed fence', '| a |\n|---|\n| 1 |\ntext',
  '* lone\n---\n1.) ord', 'a *unclosed ** bold\n\n> q\n> q2'];
for (const f of fuzz) {
  const t0 = Date.now();
  renderMarkdown(f);
  if (Date.now() - t0 > 200) { console.log('FUZZ SLOW', JSON.stringify(f)); bad++; }
}
console.log(bad ? `MD-CHECK: ${bad} PROBLEMS` : 'MD-CHECK PASS');
