// xenontest.ts — the XenonTest script format + evaluator (v1.13.7, we:
// "make it so that you have a simple interface for automating that in the
// editor, almost like a scripting language, so we can have an interface for
// AI agents in the future that want to test/run xenoncode … so a craft can
// be diagnosed using that").
//
// A XenonTest script is a tiny line format (no new parser machinery, safe
// to expose):
//
//   name: buzzer-bench
//   program: |
//     var $t = 0
//     update
//       $t += 1
//       output_number("horn", 0, 0.8)
//   cycles: 20
//   assert:
//     - bus("horn", 0) == 0.8
//     - bus("horn", 1) >= 440
//     - amp("horn") > 0.5
//     - wave("horn") == "sawtooth"
//     - prints == 0
//     - cycles >= 20
//
// `program:` is OPTIONAL (omit it to run the craft's own disk — the
// diagnostic case). The runner (pump.runCycles) re-boots the VM, advances
// EXACTLY N cycles with the rAF loop gated out (deterministic phase), and
// every assert is evaluated against the resulting snapshot — pure,
// vitest-pinned, and exposed programmatically as __XENONTEST__.run() for
// automation (AI agents, headless probes, CI).

export interface XenonSnapDevice {
  alias: string; type: string; mode?: number;
  amp: number; freq: number; wave: string;
}

/** The snapshot the asserts evaluate against. */
export interface XenonSnap {
  cycles: number;
  prints: number;
  bus: Record<string, number | string>;
  devices: XenonSnapDevice[];
}

export interface XenonTestScript {
  name: string;
  program: string | null;
  cycles: number;
  asserts: string[];
  error?: string;
}

export interface XenonAssertResult {
  expr: string;
  ok: boolean;
  actual: string;
}

/** Parse the line format. Indentation is fixed at two spaces; the program
 *  block is raw XenonCode until the next top-level key. */
export function parseXenonTest(text: string): XenonTestScript {
  const t: XenonTestScript = { name: 'xentest', program: null, cycles: 0, asserts: [] };
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i] ?? '';
    if (!ln.trim() || ln.trim().startsWith('#')) { i++; continue; }
    const m = /^([a-z]+):\s*(.*)$/.exec(ln);
    if (!m) { t.error = `line ${i + 1}: expected 'key:'`; return t; }
    const [, key, val] = m as unknown as [string, string, string];
    if (key === 'program') {
      if (val.trim() !== '|') { t.error = `line ${i + 1}: program must be 'program: |'`; return t; }
      i++;
      const body: string[] = [];
      while (i < lines.length && (/^\s/.test(lines[i] ?? '') || !(lines[i] ?? '').trim())) {
        body.push((lines[i] ?? '').replace(/^ {2}/, ''));
        i++;
      }
      t.program = body.join('\n').replace(/\s+$/, '');
      continue;
    }
    if (key === 'assert') {
      if (val.trim()) { t.asserts.push(val.trim()); }
      i++;
      while (i < lines.length && /^\s*-\s+\S/.test(lines[i] ?? '')) {
        t.asserts.push((lines[i] ?? '').replace(/^\s*-\s+/, '').trim());
        i++;
      }
      continue;
    }
    if (key === 'name') t.name = val.trim() || t.name;
    else if (key === 'cycles') t.cycles = Number(val);
    else { t.error = `line ${i + 1}: unknown key '${key}'`; return t; }
    i++;
  }
  if (!Number.isFinite(t.cycles) || t.cycles < 0) t.error = 'cycles: needs a number';
  return t;
}

const EXPR = /^(?:([a-zA-Z]+)\(\s*(?:"([^"]*)"|(-?\d+))\s*(?:,\s*(-?\d+)\s*)?\)|([a-zA-Z_]+))\s*(==|!=|>=|<=|>|<)\s*(.+)$/;

/** Evaluate one assert against a snapshot. */
export function evalAssert(expr: string, snap: XenonSnap): XenonAssertResult {
  const m = EXPR.exec(expr.trim());
  if (!m) return { expr, ok: false, actual: 'parse error' };
  const [, fn, sArg, nArg, chArg, bare, op, rhs] = m as unknown as
    [string, string | undefined, string | undefined, string | undefined,
     string | undefined, string | undefined, string, string];
  const left = readValue(fn, sArg, nArg, chArg, bare, snap);
  const rightRaw = rhs.trim();
  const rightStr = /^"([^"]*)"$/.exec(rightRaw)?.[1];
  const rightNum = Number(rightRaw);
  let ok = false;
  if (left === undefined) ok = false;
  else if (typeof left === 'string') {
    const r = rightStr ?? rightRaw;
    ok = op === '==' ? left === r : op === '!=' ? left !== r : false;
  } else {
    const r = rightStr !== undefined ? NaN : rightNum;
    switch (op) {
      case '==': ok = left === r; break;
      case '!=': ok = left !== r; break;
      case '>=': ok = left >= r; break;
      case '<=': ok = left <= r; break;
      case '>': ok = left > r; break;
      case '<': ok = left < r; break;
      default: ok = false;
    }
  }
  return { expr, ok, actual: String(left) };
}

function readValue(fn: string | undefined, sArg: string | undefined, nArg: string | undefined,
  chArg: string | undefined, bare: string | undefined, snap: XenonSnap): string | number | undefined {
  const name = sArg ?? nArg ?? '';
  const ch = chArg !== undefined ? Number(chArg) : 0;
  switch (fn ?? bare) {
    case 'cycles': return snap.cycles;
    case 'prints': return snap.prints;
    case 'bus': {
      const v = snap.bus[`${name}:${ch}`];
      return v === undefined ? 0 : (typeof v === 'number' ? v : v);
    }
    case 'amp': case 'freq': case 'wave': {
      const d = snap.devices.find(x => x.alias === name);
      if (!d) return 0;
      return fn === 'freq' ? d.freq : fn === 'wave' ? d.wave : d.amp;
    }
    default: return undefined;
  }
}
