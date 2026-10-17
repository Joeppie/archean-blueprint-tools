// doc.ts — raw-literal-preserving JSON document: the byte-identical save core.
// parse emits a small AST whose number nodes KEEP their source text; emit()
// reproduces the file byte-for-byte, and an edited number reuses the literal's
// own style (float-style raw "1.0" ⇒ new value writes as float, padded
// exponent; bare raw "3" ⇒ int style). See format.ts § byte-identical saves.

export type DocNode =
  | { kind: 'obj'; entries: [string, DocNode][] }
  | { kind: 'arr'; items: DocNode[] }
  | { kind: 'num'; value: number; raw: string }
  | { kind: 'str'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'null' };

export class ParseError extends Error {}

export function parseDoc(text: string): DocNode {
  let i = 0;
  const fail = (msg: string): never => { throw new ParseError(`${msg} at ${i}`); };
  const ws = () => { while (i < text.length && text[i]! <= ' ') i++; };
  function value(): DocNode {
    ws();
    const c = text[i];
    if (c === '{') {
      i++; const entries: [string, DocNode][] = [];
      ws();
      if (text[i] === '}') { i++; return { kind: 'obj', entries }; }
      for (;;) {
        ws();
        if (text[i] !== '"') fail('expected "key"');
        entries.push([string_(), value2()]);
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return { kind: 'obj', entries }; }
        fail('expected , or }');
      }
    }
    if (c === '[') {
      i++; const items: DocNode[] = [];
      ws();
      if (text[i] === ']') { i++; return { kind: 'arr', items }; }
      for (;;) {
        items.push(value());
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return { kind: 'arr', items }; }
        fail('expected , or ]');
      }
    }
    if (c === '"') return string2();
    if (c === 't') { expect('true'); return { kind: 'bool', value: true }; }
    if (c === 'f') { expect('false'); return { kind: 'bool', value: false }; }
    if (c === 'n') { expect('null'); return { kind: 'null' }; }
    return number();
    function value2(): DocNode { ws(); if (text[i] !== ':') fail('expected :'); i++; return value(); }
  }
  function expect(lit: string) { if (text.startsWith(lit, i)) i += lit.length; else fail(`expected ${lit}`); }
  function string_(): string { return (string2() as { value: string }).value; }
  function string2(): DocNode {
    const start = ++i;                                 // skip opening quote
    let out: string | null = null;                     // null = no escapes yet
    let seg = i;                                       // plain segment start
    for (;;) {
      if (i >= text.length) fail('unterminated string');
      const c = text[i]!;
      if (c === '"') { out = (out ?? '') + text.slice(seg, i); i++; break; }
      if (c === '\\') {
        out = (out ?? '') + text.slice(seg, i);
        i++;
        const e = text[i]!; i++;
        if (e === 'u') { out += String.fromCharCode(parseInt(text.slice(i, i + 4), 16)); i += 4; }
        else out += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e === 'b' ? '\b' : e === 'f' ? '\f' : e;
        seg = i;
        continue;
      }
      i++;
    }
    void start;
    return { kind: 'str', value: out };
  }
  function number(): DocNode {
    const start = i;
    if (text[i] === '-') i++;
    while (i < text.length && '0123456789.eE+-'.includes(text[i]!)) {
      // stop a stray +/- that is not part of an exponent
      const c = text[i]!;
      if ((c === '+' || c === '-') && !'eE'.includes(text[i - 1]!)) break;
      i++;
    }
    const raw = text.slice(start, i);
    const v = Number(raw);
    if (!Number.isFinite(v)) fail(`bad number ${raw}`);
    return { kind: 'num', value: v, raw };
  }
  const root = value();
  ws();
  if (i !== text.length) fail('trailing content');
  return root;
}

/** Re-style `v` the way the game's writer would, guided by the old raw form. */
function styleNumber(v: number, like: string): string {
  let s = String(v);
  const floaty = like.includes('.') || /[eE]/.test(like);
  if (floaty) {
    if (!/[.eE]/.test(s)) s += '.0';                       // integral double
    s = s.replace(/e([+-])(\d)(?!\d)/, 'e$10$2');             // two-digit exponent
  }
  return s;
}

/** Emit the document. Unchanged numbers reproduce their raw literal exactly. */
export function emitDoc(node: DocNode): string {
  switch (node.kind) {
    case 'obj': return '{' + node.entries.map(([k, v]) => JSON.stringify(k) + ':' + emitDoc(v)).join(',') + '}';
    case 'arr': return '[' + node.items.map(emitDoc).join(',') + ']';
    case 'num': {
      const canonical = String(node.value);
      if (node.raw === canonical || Number(node.raw) === node.value) return node.raw;
      return styleNumber(node.value, node.raw);
    }
    case 'str': return JSON.stringify(node.value);
    case 'bool': return node.value ? 'true' : 'false';
    case 'null': return 'null';
  }
}

/** Plain-JS view of the document for the engine (numbers = primitives). */
export function docValue(node: DocNode): unknown {
  switch (node.kind) {
    case 'obj': { const o: Record<string, unknown> = {}; for (const [k, v] of node.entries) o[k] = docValue(v); return o; }
    case 'arr': return node.items.map(docValue);
    case 'num': return node.value;
    case 'str': return node.value;
    case 'bool': return node.value;
    case 'null': return null;
  }
}

/** Locate a node by path (object keys / array indices). undefined = absent. */
export function docGet(root: DocNode, path: (string | number)[]): DocNode | undefined {
  let n: DocNode = root;
  for (const p of path) {
    if (typeof p === 'number') {
      if (n.kind !== 'arr' || p < 0 || p >= n.items.length) return undefined;
      n = n.items[p]!;
    } else {
      if (n.kind !== 'obj') return undefined;
      const e = n.entries.find(([k]) => k === p);
      if (!e) return undefined;
      n = e[1];
    }
  }
  return n;
}

/** Set a number at a path, keeping its literal style. True = applied. */
export function docSetNumber(root: DocNode, path: (string | number)[], v: number): boolean {
  const n = docGet(root, path);
  if (!n || n.kind !== 'num') return false;
  n.value = v;
  return true;
}

/** Set a primitive at a path: numbers keep their literal style, booleans and
 *  strings adopt the new value (emitting true/false/"str"). Objects and
 *  type-mismatched targets are refused. True = applied. */
export function docSet(root: DocNode, path: (string | number)[], v: number | string | boolean): boolean {
  const n = docGet(root, path);
  if (!n) return false;
  if (typeof v === 'number') {
    if (n.kind !== 'num') return false;
    n.value = v;
    return true;
  }
  if (n.kind === 'obj' || n.kind === 'arr' || n.kind === 'null') return false;
  const m = n as { kind: 'num' | 'str' | 'bool'; value: number | string | boolean };
  if (typeof v === 'boolean') { m.kind = 'bool'; m.value = v; }
  else { m.kind = 'str'; m.value = v; }
  return true;
}
