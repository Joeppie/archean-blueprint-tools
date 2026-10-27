// xenoncode.ts — the app seam to the DEV's XenonCode interpreter (WASM).
//
// The module under public/xenoncode/ is a build product of the pinned
// upstream library (tools/xenoncode/build.sh; NOTICE §6) — we ship the
// compiled artifact, the pinned source lives in tools/xenoncode. This module
// loads it, wraps one MiniComputer's program (files from the blueprint,
// screens from its craft's Dashboard Screen/HdScreen elements), and exposes
// pure helpers (tokenizer, #NODES graph, channel detection) that the IDE
// dialog renders — the helpers run headless in vitest; only the wasm pump
// needs a browser.
import type { Blueprint, BlueprintComponent } from './format';

export interface XCFile { name: string; code: string }
export interface XCScreen { alias: string; channel: number; w: number; h: number }

// ---------------------------------------------------------------------------
// module loading (browser only; the editor fires this at boot, off the path)

type Mod = {
  _malloc(n: number): number; _free(p: number): void;
  stringToUTF8(s: string, p: number, n: number): void;
  UTF8ToString(p: number): string;
  lengthBytesUTF8(s: string): number;
  HEAPU8: Uint8Array;
  _xc_write_file(a: number, b: number): void;
  _xc_boot(): number;
  _xc_cycle(): number;
  _xc_events(): number;
  _xc_error(): number;
  _xc_set_input(io: number, ch: number, v: number): void;
  _xc_save_storage(): void;
  _xc_pilot_script(on: number): void;
  _xc_reset_screens(): void;
  _xc_add_screen(a: number, ch: number, w: number, h: number): number;
  _xc_screen_count(): number;
  _xc_screen_key(i: number): number;
  _xc_screen_w(i: number): number;
  _xc_screen_h(i: number): number;
  _xc_screen_pixels(i: number): number;
  _xc_parse_line(p: number, n: number): number;
};

let modPromise: Promise<Mod> | null = null;

export function xenonReady(): Promise<Mod> {
  if (modPromise) return modPromise;
  modPromise = new Promise<Mod>((resolve, reject) => {
    const base = (import.meta as any).env?.BASE_URL ?? '/';
    const w = window as any;
    const start = () => w.createXenonCode({
      locateFile: (f: string) => `${base}xenoncode/${f}`,
    }).then((m: Mod) => resolve(m)).catch(reject);
    if (w.createXenonCode) return start();
    const s = document.createElement('script');
    s.src = `${base}xenoncode/xenoncode.js`;
    s.onload = start;
    s.onerror = () => reject(new Error('xenoncode.js failed to load'));
    document.head.appendChild(s);
  });
  modPromise = modPromise.catch(e => { modPromise = null; throw e; });
  return modPromise;
}

// ---------------------------------------------------------------------------
// blueprint extraction

export interface XenonComputer {
  ci: number;                 // component index of the MiniComputer
  alias: string;
  program: string;
  files: XCFile[];            // main.xc = the entry file, then includes
  channels: { io: number; ch: number }[];
  screens: XCScreen[];
}

/** Every MiniComputer with at least one .xc file, as an IDE descriptor. */
export function xenonComputers(bp: Blueprint): XenonComputer[] {
  const out: XenonComputer[] = [];
  (bp.data.components as BlueprintComponent[]).forEach((c, ci) => {
    if (c.type !== 'MiniComputer') return;
    const hdd = (c.data as any)?.hdd;
    const xf: { name: string; plain_code?: string }[] = hdd?.xc_files ?? [];
    if (!xf.length) return;
    const program = String((c.data as any)?.program ?? (xf[0]?.name ?? 'main').split('.')[0]);
    const mainName = `${program}.main.xc`;
    const files: XCFile[] = [];
    const main = xf.find(f => f.name === mainName);
    if (main) files.push({ name: 'main.xc', code: main.plain_code ?? '' });
    for (const f of xf)
      if (f.name !== mainName) files.push({ name: f.name, code: f.plain_code ?? '' });
    out.push({
      ci, alias: c.alias || program, program, files,
      channels: detectChannels(files),
      screens: xenonScreens(bp, c.alias ?? '')
    });
  });
  return out;
}

/** The Screen/HdScreen surfaces a screen("<alias>", ch) call binds to:
 *  a Dashboard with that alias; channelIndex counts ALL its elements in
 *  order (wiki xenoncode/dashboard.md), pixel size = 1 px per element unit
 *  (the XenonDraw convention). */
export function xenonScreens(bp: Blueprint, alias: string): XCScreen[] {
  const out: XCScreen[] = [];
  if (!alias) return out;
  for (const c of bp.data.components as BlueprintComponent[]) {
    if (c.type !== 'Dashboard' || c.alias !== alias) continue;
    const els: any[] = (c.data as any)?.elements ?? [];
    els.forEach((e, i) => {
      if (e.type === 'Screen' || e.type === 'HdScreen')
        out.push({ alias, channel: i, w: e.size_x + 1, h: e.size_y + 1 });
    });
  }
  return out;
}

/** input_number(io, ch) call sites — the external numerics the panel exposes. */
export function detectChannels(files: XCFile[]): { io: number; ch: number }[] {
  const seen = new Set<string>();
  const out: { io: number; ch: number }[] = [];
  for (const f of files)
    for (const m of f.code.matchAll(/input_number\(\s*(\d+)\s*,\s*(\d+)\s*\)/g)) {
      const k = `${m[1]}:${m[2]}`;
      if (!seen.has(k)) { seen.add(k); out.push({ io: +m[1]!, ch: +m[2]! }); }
    }
  return out.sort((a, b) => a.io - b.io || a.ch - b.ch);
}

// ---------------------------------------------------------------------------
// syntax highlighting — token classes follow the dev's OWN mode definitions
// (XenonCode repo: www/xc_mode.js CodeMirror SimpleMode + the VS-Code
// tmLanguage): keyword / number / comment / operator / variable ($x) /
// variable-2 (@fn) / string (with the {format} spans inside).

export type Tok = { t: 'kw' | 'type' | 'num' | 'com' | 'op' | 'var' | 'fn' | 'str' | 'fmt' | 'txt'; s: string };

const KEYWORDS = new Set(('recursive recurse function storage array var const include return if foreach ' +
  'while else elseif init input timer tick output repeat for frequency interval break continue and or xor ' +
  'number text update shutdown click click_hold scroll').split(' '));

const TOKEN = new RegExp([
  '(;[^]*?|//[^]*?)(?=\\n|$)',                       // 1 comment (to EOL)
  '("(?:[^"\\n]|"")*")',                              // 2 string ("" escapes)
  '(\\$[A-Za-z_][\\w]*)',                             // 3 variable
  '(@[A-Za-z_][\\w]*)',                               // 4 function
  '(\\b\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?\\b)',       // 5 number
  '([+\\-*/=<>!&^%|:]+)',                              // 6 operator
  '([A-Za-z_][\\w]*)',                                // 7 word (keyword?)
].join('|'), 'gi');

export function tokenize(line: string): Tok[] {
  const toks: Tok[] = [];
  let last = 0, m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  const pushTxt = (s: string) => { if (s) toks.push({ t: 'txt', s }); };
  while ((m = TOKEN.exec(line))) {
    pushTxt(line.slice(last, m.index));
    const [, com, str, vr, fn, num, op, word] = m;
    if (com !== undefined) toks.push({ t: 'com', s: com });
    else if (str !== undefined) toks.push(...splitFormat(str));
    else if (vr !== undefined) toks.push({ t: 'var', s: vr });
    else if (fn !== undefined) toks.push({ t: 'fn', s: fn });
    else if (num !== undefined) toks.push({ t: 'num', s: num });
    else if (op !== undefined) toks.push({ t: 'op', s: op });
    else if (word !== undefined) {
      const lw = word.toLowerCase();
      // the dev mode's types (:text / :number) carry the colon INSIDE the
      // keyword token — keep that shape (`: text` reads as op ':' + kw, and
      // a bare `text` word is the type name; the mode lists them as keywords)
      if (KEYWORDS.has(lw)) toks.push({ t: 'kw', s: word });
      else toks.push({ t: 'txt', s: word });
    }
    last = m.index + m[0].length;
  }
  pushTxt(line.slice(last));
  return toks;
}

/** "text{}with{0.00}spans" → str + fmt tokens (tmLanguage: {..} is numeric
 *  constant inside the string). */
export function splitFormat(str: string): Tok[] {
  const out: Tok[] = [];
  const re = /\{[^}]*\}/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(str))) {
    if (m.index > last) out.push({ t: 'str', s: str.slice(last, m.index) });
    out.push({ t: 'fmt', s: m[0] });
    last = m.index + m[0].length;
  }
  if (last < str.length) out.push({ t: 'str', s: str.slice(last) });
  return out;
}

// ---------------------------------------------------------------------------
// #NODES — the visual-program graph stored as the `;#NODES {json}` header
// comment of node-authored programs (FirstFlight, Cheap Exploration Plane,
// the airliner's programs all carry it). links: node.inputs[i] = source id.

export interface XNode {
  id: string; type: string; title: string;
  x: number; y: number; w: number; h: number;
  ioNumber?: number; channel?: number; outputType?: number;
  inputs: string[];          // source node ids ('' = an inputValues literal
  inputValues?: string[];    //   slot, value in inputValues[i])
}
export interface XGraph { nodes: XNode[]; links: { from: string; to: string; port: number }[] }

export function parseNodes(files: XCFile[]): XGraph | null {
  for (const f of files) {
    const m = f.code.match(/#NODES\s+(\{[\s\S]*?\})\s*\n/);
    if (!m) continue;
    try {
      const j = JSON.parse(m[1]!);
      const nodes: XNode[] = (j.nodes ?? []).map((n: any) => ({
        id: n.id, type: n.type ?? '', title: n.title ?? n.type ?? '?',
        x: n.pos?.x ?? 0, y: n.pos?.y ?? 0,
        w: n.size?.x ?? 140, h: n.size?.y ?? 60,
        ioNumber: n.ioNumber, channel: n.channel, outputType: n.outputType,
        inputs: (n.inputs ?? []).map((s: any) => String(s ?? '')),
        inputValues: n.inputValues,
      }));
      if (!nodes.length) return null;
      const links: XGraph['links'] = [];
      for (const n of nodes)
        n.inputs.forEach((src, i) => { if (src) links.push({ from: src, to: n.id, port: i }); });
      return { nodes, links };
    } catch { return null; }
  }
  return null;
}

// ---------------------------------------------------------------------------
// one running computer (browser): boot a computer's program, pump cycles,
// read its screens.

export interface XenonEvent { e: string; io?: string | number; port?: number; v?: number | string; c?: number }

export class XenonRun {
  private mod: Mod;
  running = false;
  error = '';
  private constructor(mod: Mod) { this.mod = mod; }

  static async open(comp: XenonComputer): Promise<XenonRun> {
    const mod = await xenonReady();
    const run = new XenonRun(mod);
    // allocate by UTF-8 BYTE length, not string length (non-ASCII comments
    // truncate the program tail if you use .length — learned the hard way)
    const put = (name: string, code: string) => {
      const nb = new TextEncoder().encode(code).length + 1;
      const cp = mod._malloc(nb); mod.stringToUTF8(code, cp, nb);
      const np = mod._malloc(name.length + 1); mod.stringToUTF8(name, np, name.length + 1);
      mod._xc_write_file(np, cp);
      mod._free(np); mod._free(cp);
    };
    mod._xc_reset_screens();
    for (const f of comp.files) put(f.name, f.code);
    for (const sc of comp.screens) {
      const np = mod._malloc(sc.alias.length + 1);
      mod.stringToUTF8(sc.alias, np, sc.alias.length + 1);
      mod._xc_add_screen(np, sc.channel, sc.w, sc.h);
      mod._free(np);
    }
    mod._xc_pilot_script(0);
    if (mod._xc_boot()) { run.error = mod.UTF8ToString(mod._xc_error()); return run; }
    run.running = true;
    return run;
  }

  cycle(): XenonEvent[] {
    if (!this.running) return [];
    const m = this.mod;
    if (m._xc_cycle()) { this.error = m.UTF8ToString(m._xc_error()); this.running = false; return []; }
    return JSON.parse(m.UTF8ToString(m._xc_events()));
  }

  setInput(io: number, ch: number, v: number) { this.mod._xc_set_input(io, ch, v); }
  saveStorage() { this.mod._xc_save_storage(); }
  reboot() {
    this.mod._xc_save_storage();
    if (this.mod._xc_boot()) { this.error = this.mod.UTF8ToString(this.mod._xc_error()); return false; }
    this.running = true;
    return true;
  }
  stop() { this.running = false; }

  screenInfo(): { key: string; w: number; h: number; pixels: Uint8ClampedArray }[] {
    const m = this.mod, out = [];
    for (let i = 0; i < m._xc_screen_count(); i++) {
      const w = m._xc_screen_w(i), h = m._xc_screen_h(i), p = m._xc_screen_pixels(i);
      if (!w || !h || !p) continue;
      out.push({ key: m.UTF8ToString(m._xc_screen_key(i)), w, h,
        pixels: new Uint8ClampedArray(m.HEAPU8.buffer.slice(p, p + w * h * 4)) });
    }
    return out;
  }

  parseLine(line: string, n: number): string {
    const m = this.mod;
    const p = m._malloc(line.length + 1);
    m.stringToUTF8(line, p, line.length + 1);
    const bad = m._xc_parse_line(p, n);
    const err = bad ? m.UTF8ToString(m._xc_error()) : '';
    m._free(p);
    return err;
  }
}
