// spec_ops.mjs — AST-exact Playwright-spec surgery (v1.12.1).
// The chain-law waves replace/retire test() blocks inside describe()s.
// String-index slicing broke twice on indentation assumptions (a test
// with a multi-line header closes at 4 spaces; rstrip character-sets
// ate trailing '});'); this tool uses the TypeScript parser so statement
// spans are EXACT.
//
// usage:
//   node tools/spec_ops.mjs replace <spec.ts> "<test title>" <replacement.txt>
//   node tools/spec_ops.mjs delete  <spec.ts> "<test title>" "<note text>"
// The replacement file's text is inserted verbatim at the statement's
// start (keep its indentation consistent with the file's 2-space tests).
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'fs';

const [cmd, file, title, extra] = process.argv.slice(2);
if (!cmd || !file || !title || extra === undefined) {
  console.error('usage: spec_ops.mjs replace|delete <file> "<title>" <replacement-file|note>');
  process.exit(2);
}

const src = readFileSync(file, 'utf8');
const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ESNext, true);
const isTestCall = (node) =>
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) && node.expression.text === 'test' &&
  ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === title;

let target = null;
function walk(node) {
  if (!target && isTestCall(node)) { target = node; return; }
  node.forEachChild(walk);
}
for (const st of sf.statements) walk(st);
if (!target) { console.error(`no test() titled: ${title}`); process.exit(1); }

// full span: include the statement's leading comment block? NO — replace
// only the call statement; comments above stay (they describe siblings
// too). Start at the statement's own line start, end after its final
// '});' — target.getStart(sf, true) includes JSDoc; getStart() does not.
const start = src.lastIndexOf('\n', target.getStart(sf) - 1) + 1;
let end = target.getEnd();
if (src[end] === ';') end += 1;
const tail = src.slice(0, start), head = src.slice(end);

const insertion = cmd === 'replace'
  ? readFileSync(extra, 'utf8').replace(/\n+$/, '')
  : extra.split('\n').map((l, i) => (i ? '  // ' : '  // ') + l.replace(/^\s*\/\/\s?/, '')).join('\n');

writeFileSync(file, tail + insertion + head);
console.log(`${cmd}d: ${title} (${(end - start) / src.split('\n').length} % of file)`);
