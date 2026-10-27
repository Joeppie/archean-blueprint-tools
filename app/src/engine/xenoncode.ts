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
  _xc_reset_devices(): void;
  _xc_add_device(id: number, io: number, a: number, t: number, port: number,
    x: number, y: number, z: number, sx: number, sy: number, sz: number, mass: number): void;
  _xc_set_capability(ram: number, storage: number): void;
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
  capacity: number;           // hdd capacity = the game's storage limit
  channels: { io: number; ch: number }[];
  screens: XCScreen[];
  devices: XCDevice[];
}

export interface XCDevice {
  io: number;               // the computer io port it is cabled to, -1 = by alias
  id: number;               // stable table id (device_at order)
  alias: string;
  type: string;
  x: number; y: number; z: number;
}

/** Every MiniComputer with at least one .xc file, as an IDE descriptor. */
export function xenonComputers(bp: Blueprint): XenonComputer[] {
  const out: XenonComputer[] = [];
  (bp.data.components as BlueprintComponent[]).forEach((c, ci) => {
    if (c.type !== 'MiniComputer') return;
    const hdd = (c.data as any)?.hdd;
    const xf: { name: string; plain_code?: string }[] = hdd?.xc_files ?? [];
    if (!xf.length) return;
    const program = String((c.data as any)?.program ?? '');
    // entry file: <program>.main.xc; the Badger stores program='' with a
    // literal main.xc — fall back through any *.main.xc to the first file
    const main = xf.find(f => f.name === `${program}.main.xc`)
      ?? xf.find(f => f.name === 'main.xc')
      ?? xf.find(f => f.name.endsWith('.main.xc')) ?? xf[0];
    const files: XCFile[] = [{ name: 'main.xc', code: main?.plain_code ?? '' }];
    for (const f of xf)
      if (f !== main) files.push({ name: f.name, code: f.plain_code ?? '' });
    const base = String(main?.name ?? 'main').split('.')[0] || 'main';
    out.push({
      ci, alias: c.alias || program || base, program: program || base, files,
      capacity: Number((c.data as any)?.hdd?.capacity) || 0,
      channels: detectChannels(files),
      screens: xenonScreens(bp, files, ci),
      devices: xenonDevices(bp, ci),
    });
  });
  return out;
}

/**
 * The surfaces a program's screen(aliasOrIo, channel) calls bind to, read
 * OUT OF THE PROGRAM (the binding law is the wiki's xenoncode/dashboard.md +
 * computer.md: alias = a Dashboard's name, channel counts ALL its elements
 * in order; alias = any other component's name OVERRIDES its built-in
 * screen; number = the io port of the component cabled to this computer).
 * Unresolvable io references are left to the shim's auto-created surfaces.
 */
export function xenonScreens(bp: Blueprint, files: XCFile[], ci = -1): XCScreen[] {
  const refs = new Map<string, { alias: string; io: number; channel: number }>();
  for (const f of files)
    for (const m of f.code.matchAll(/screen\(\s*(?:"([^"]+)"|(\d+))\s*,\s*(\d+)\s*\)/g)) {
      const alias = m[1] ?? '', io = m[2] !== undefined ? +m[2] : -1, channel = +m[3]!;
      refs.set(`${alias.toLowerCase()}#${io}#${channel}`, { alias, io, channel });
    }
  const comps = bp.data.components as BlueprintComponent[];
  const out: XCScreen[] = [];
  const seen = new Set<string>();
  for (const r of refs.values()) {
    let comp: BlueprintComponent | undefined;
    if (r.alias) comp = comps.find(c => (c.alias ?? '') === r.alias);
    if (!comp && r.io >= 0) comp = compOnIo(bp, ci, r.io);
    if (!comp) continue;
    const idx = comps.indexOf(comp);
    const label = r.alias || comp.alias || `${comp.type.toLowerCase()}-${idx}`;
    const k = `${label}#${r.channel}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (comp.type === 'Dashboard') {
      const el: any[] = ((comp.data as any)?.elements ?? []) as any[];
      const e = el[r.channel];
      if (!e || (e.type !== 'Screen' && e.type !== 'HdScreen')) continue;  // Label: none
      out.push({ alias: label, channel: r.channel, w: (e.size_x ?? 0) + 1, h: (e.size_y ?? 0) + 1 });
    } else {
      out.push({ alias: label, channel: r.channel, w: 128, h: 72 });       // screen override
    }
  }
  return out.sort((a, b) => a.alias.localeCompare(b.alias) || a.channel - b.channel);
}

function compOnIo(bp: Blueprint, ci: number, io: number): BlueprintComponent | undefined {
  const comps = bp.data.components as BlueprintComponent[];
  if (ci < 0) return undefined;
  const pipes: any[] = (bp.data as any).pipes ?? [];
  for (const p of pipes) {
    if (p.a_component !== ci && p.b_component !== ci) continue;
    const mine = p.a_component === ci ? p.a_port : p.b_port;
    const m = /^(?:data_port\.(\d+)|data)$/.exec(String(mine));
    if (!m) continue;                     // power_connector etc
    if ((m[1] ? +m[1] : 0) === io) return comps[p.a_component === ci ? p.b_component : p.a_component];
  }
  return undefined;
}

/** The component table for device()/device_type()/device_count(): the
 *  components cabled to this computer's data_port.0NN ports, plus every
 *  aliased component (computer.md: aliases address components directly,
 *  no Router needed). */
export function xenonDevices(bp: Blueprint, ci: number): XCDevice[] {
  const comps = bp.data.components as BlueprintComponent[];
  const out: XCDevice[] = [];
  const byAlias = new Set<string>();
  const pipes: any[] = (bp.data as any).pipes ?? [];
  for (const p of pipes) {
    if (p.a_component !== ci && p.b_component !== ci) continue;
    const mine = p.a_component === ci ? p.a_port : p.b_port;
    const m = /^(?:data_port\.(\d+)|data)$/.exec(String(mine));
    if (!m) continue;
    const other = comps[p.a_component === ci ? p.b_component : p.a_component];
    if (!other) continue;
    out.push({ io: m[1] ? +m[1] : 0, id: 0, alias: other.alias ?? '', type: other.type,
      x: other.position?.x ?? 0, y: other.position?.y ?? 0, z: other.position?.z ?? 0 });
    if (other.alias) byAlias.add(other.alias);
  }
  comps.forEach((c) => {
    if (!c.alias || byAlias.has(c.alias)) return;
    byAlias.add(c.alias);
    out.push({ io: -1, id: 0, alias: c.alias, type: c.type,
      x: c.position?.x ?? 0, y: c.position?.y ?? 0, z: c.position?.z ?? 0 });
  });
  out.sort((a, b) => a.alias.localeCompare(b.alias) || a.io - b.io);
  out.forEach((d, i) => (d.id = i + 1));
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
    mod._xc_reset_devices();
    mod._xc_set_capability(0, comp.capacity);
    for (const f of comp.files) put(f.name, f.code);
    for (const sc of comp.screens) {
      const nb = new TextEncoder().encode(sc.alias).length + 1;
      const np = mod._malloc(nb);
      mod.stringToUTF8(sc.alias, np, nb);
      mod._xc_add_screen(np, sc.channel, sc.w, sc.h);
      mod._free(np);
    }
    for (const d of comp.devices) {
      const ab = new TextEncoder().encode(d.alias).length + 1;
      const tb = new TextEncoder().encode(d.type).length + 1;
      const ap = mod._malloc(ab), tp = mod._malloc(tb);
      mod.stringToUTF8(d.alias, ap, ab);
      mod.stringToUTF8(d.type, tp, tb);
      mod._xc_add_device(d.id, d.io, ap, tp, d.io, d.x, d.y, d.z, 0, 0, 0, 0);
      mod._free(ap); mod._free(tp);
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

  screenCount(): number { return this.mod._xc_screen_count(); }

  screenInfo(max = 16): { key: string; w: number; h: number; pixels: Uint8ClampedArray }[] {
    const m = this.mod, out = [];
    for (let i = 0; i < Math.min(m._xc_screen_count(), max); i++) {
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
