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
import { atlasJsonPaths } from './models';
import { CRAFTER_BUILTIN } from './crafterbuiltin';
import { buzzerAudio, modeToWave } from './buzzer';
import type { XenonSnap } from './xenontest';
import {
  evalExpr, slug, wsChans, wsEnsure, wsKind, wsLoad, wsName, wsSave, worldsimDefault,
  type WorldSimChan,
} from './worldsim';

export interface XCFile { name: string; code: string }
export interface XCScreen {
  alias: string;    // THE registration key = what the program's screen(aliasOrIo, ch) call passes
  label: string;    // human name for the panel (component alias / type)
  channel: number;
  w: number; h: number;
  ci?: number;      // component index of the display component (3-D feed key)
  deviceScreen?: boolean;   // the machine's BUILT-IN screen (fed from main#0)
}

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
  _xc_set_input_a(alias: number, ch: number, v: number): void;
  _xc_worldsim_overrides(): number;
  _xc_worldsim_sync(name: number, v: number): void;
  _xc_abi(): number;
  _xc_set_cycle_ms(ms: number): void;
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
  _xc_screen_index(key: number): number;
  _xc_vars(): number;
  _xc_debug_track(on: number): void;
  _xc_cycle_lines(): number;
  _xc_screen_click(idx: number, x: number, y: number): void;
  _xc_screen_scroll(idx: number, d: number): void;
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
  entryName: string;          // the entry file's NAME in the file (Cede.main.xc)
  builtin?: boolean;          // runs the device's PUBLISHED built-in program
  capacity: number;           // hdd capacity = the game's storage limit
  channels: XenonChannel[];
  screens: XCScreen[];
  devices: XCDevice[];
}

export interface XCDevice {
  io: number;               // the computer io port it is cabled to, -1 = by alias
  id: number;               // stable table id (device_at order)
  alias: string;
  type: string;
  x: number; y: number; z: number;
  /** Buzzer: the component's authored tone (data.mode 0..3, wiki
   *  Buzzer.md) — engine/buzzer.ts plays each buzzer ITS tone in auto. */
  mode?: number;
}

/** The IDE's working list = the virtual disk's files in their ORIGINAL
 *  names (files[0] carries the entry file, which the run-side shows as
 *  main.xc; writeback needs the true name — the v1.13.x editor law). */
export function xcDiskFiles(comp: XenonComputer): XCFile[] {
  return comp.files.map((f, i) => ({ name: i === 0 ? comp.entryName : f.name, code: f.code }));
}

/** Every MiniComputer with at least one .xc file, as an IDE descriptor. */
// Devices that ARE computers: MiniComputer (programs live in its
// data.hdd.xc_files) and the CRAFTER - whose integrated touchscreen runs a
// published built-in program (wiki components/miscellaneous/Crafter.md,
// "Built-in Program"). The program is NOT stored in the blueprint json (it
// lives on the world's server HDD, ide.md Persistency), so a Crafter with no
// own files gets the built-in synthesized (we: "the poor automatic crafter
// doesn't have its computer nor built in screen recognized").
const BUILTIN_PROGRAMS: Record<string, () => string> = {
  Crafter: () => CRAFTER_BUILTIN,
};

export function xenonComputers(bp: Blueprint): XenonComputer[] {
  const out: XenonComputer[] = [];
  (bp.data.components as BlueprintComponent[]).forEach((c, ci) => {
    const hdd = (c.data as any)?.hdd;
    const xf: { name: string; plain_code?: string }[] = hdd?.xc_files ?? [];
    const builtin = !xf.length && c.type !== 'MiniComputer' ? BUILTIN_PROGRAMS[c.type] : undefined;
    if (!xf.length && !builtin) return;
    if (builtin) {
      // a built-in-program device: synthesize its one-file disk
      const alias = c.alias || `${c.type.toLowerCase()}-${ci}`;
      out.push({
        ci, alias, program: c.type.toLowerCase(), entryName: 'crafter.main.xc',
        capacity: 8192,
        // the VM boots from main.xc (the run-side entry convention; the
        // disk-side name rides entryName, exactly like the MiniComputer path)
        files: [{ name: 'main.xc', code: builtin() }],
        channels: detectChannels([{ name: 'main.xc', code: builtin() }]),
        screens: [{ alias, label: `${c.type} · integrated touchscreen`, channel: 0, w: 128, h: 72, ci, deviceScreen: true }],
        devices: xenonDevices(bp, ci),
        builtin: true,
      });
      return;
    }
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
      entryName: String(main?.name ?? 'main.xc'),
      capacity: Number((c.data as any)?.hdd?.capacity) || 0,
      channels: detectChannels(files),
      screens: [
        ...xenonScreens(bp, files, ci),
        // the Computer's integrated screen: the plain screen-function
        // target (main#0) mirrored onto the model's 'screen' material face
        ...(c.type === 'Computer'
          ? [{ alias: c.alias || `computer-${ci}`, label: 'Computer · integrated screen',
              channel: 0, w: 128, h: 72, ci, deviceScreen: true }]
          : []),
      ],
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
    // Registration key = the EXACT token the program passes to screen()
    // (the shim keys surfaces by that literal lowercased); label is human.
    const key = r.alias || (r.io >= 0 ? String(r.io) : label);
    const k = `${key}#${r.channel}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (comp.type === 'Dashboard') {
      const el: any[] = ((comp.data as any)?.elements ?? []) as any[];
      const e = el[r.channel];
      if (!e || (e.type !== 'Screen' && e.type !== 'HdScreen')) continue;  // Label: none
      out.push({ alias: key, label, channel: r.channel, ci: idx, w: (e.size_x ?? 0) * 6, h: (e.size_y ?? 0) * 6 });
    } else {
      out.push({ alias: key, label, channel: r.channel, ci: idx, w: 128, h: 72 });  // screen override
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
      x: other.position?.x ?? 0, y: other.position?.y ?? 0, z: other.position?.z ?? 0,
      mode: typeof (other.data as any)?.mode === 'number' ? (other.data as any).mode : undefined });
    if (other.alias) byAlias.add(other.alias);
  }
  comps.forEach((c) => {
    if (!c.alias || byAlias.has(c.alias)) return;
    byAlias.add(c.alias);
    out.push({ io: -1, id: 0, alias: c.alias, type: c.type,
      x: c.position?.x ?? 0, y: c.position?.y ?? 0, z: c.position?.z ?? 0,
      mode: typeof (c.data as any)?.mode === 'number' ? (c.data as any).mode : undefined });
  });
  out.sort((a, b) => a.alias.localeCompare(b.alias) || a.io - b.io);
  out.forEach((d, i) => (d.id = i + 1));
  return out;
}

/** input_number(io|"alias", ch) AND input_text(...) call sites — the external
 *  numerics the panel exposes. Aliased reads (computer.md: aliasOrIoNumber)
 *  ride too: `io` carries the alias STRING for those, and the pump/shim
 *  resolve it. input_text matters for the PilotSeat USER TOKEN channel —
 *  Chip's Mario gates ALL input on `input_text("gamer-chair", 0)` being
 *  seated, and the shim stringifies a fed numeric ("1") for text reads. */
export interface XenonChannel { io: number | string; ch: number }
export function detectChannels(files: XCFile[]): XenonChannel[] {
  const seen = new Set<string>();
  const out: XenonChannel[] = [];
  for (const f of files)
    for (const m of f.code.matchAll(/input_(?:number|text)\(\s*(?:(\d+)|"([^"]+)"|'([^']+)')\s*,\s*(\d+)\s*\)/g)) {
      const io: number | string = m[1] !== undefined ? +m[1] : (m[2] ?? m[3] ?? '');
      const k = `${io}:${m[4]}`;
      if (!seen.has(k)) { seen.add(k); out.push({ io, ch: +m[4]! }); }
    }
  return out.sort((a, b) =>
    (typeof a.io === 'number' ? a.io : 1e9) - (typeof b.io === 'number' ? b.io : 1e9)
    || a.ch - b.ch);
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
      if (comp.builtin && sc.channel === 0) {
        // the integrated touchscreen is the plain screen-function target
        const mb = new TextEncoder().encode('main').length + 1;
        const mp = mod._malloc(mb);
        mod.stringToUTF8('main', mp, mb);
        mod._xc_add_screen(mp, 0, sc.w, sc.h);
        mod._free(mp);
      }
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
    // the shim follows OUR pump cadence (ABI 5; an older wasm keeps its
    // baked 0.1 s dt — the abi() check below warns once, nothing crashes)
    if (typeof mod._xc_set_cycle_ms === 'function') mod._xc_set_cycle_ms(CYCLE_MS);
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

  setInput(io: number | string, ch: number, v: number) {
    if (typeof io === 'number') { this.mod._xc_set_input(io, ch, v); return; }
    if (typeof this.mod._xc_set_input_a !== 'function') return;
    const nb = new TextEncoder().encode(io).length + 1;
    const p = this.mod._malloc(nb);
    this.mod.stringToUTF8(io, p, nb);
    this.mod._xc_set_input_a(p, ch, v);
    this.mod._free(p);
  }
  /** Route a canvas click on one surface (pixel coords of the surface).
   *  button_rect/button evaluate true for it THIS cycle (game law). */
  screenClick(key: string, x: number, y: number) {
    const m = this.mod;
    const p = m._malloc(key.length + 1);
    m.stringToUTF8(key, p, key.length + 1);
    const idx = m._xc_screen_index(p);
    m._free(p);
    if (idx >= 0) m._xc_screen_click(idx, x, y);
  }
  screenScroll(key: string, d: number) {
    const m = this.mod;
    const p = m._malloc(key.length + 1);
    m.stringToUTF8(key, p, key.length + 1);
    const idx = m._xc_screen_index(p);
    m._free(p);
    if (idx >= 0) m._xc_screen_scroll(idx, d);
  }
  /** The program's GLOBAL variables, live (XENON-VARS dump). */
  vars(): XenonVar[] { return parseVarsJson(this.mod.UTF8ToString(this.mod._xc_vars())); }
  /** XENON-DEBUG: record the source lines the VM executes (the pump keeps
   *  this on — one branch per LINENUMBER opcode, gated in the library). */
  debugTrack(on: boolean) {
    if (typeof this.mod._xc_debug_track === 'function') this.mod._xc_debug_track(on ? 1 : 0);
  }
  cycleLines(): number[] {
    if (typeof this.mod._xc_cycle_lines !== 'function') return [];
    try { return JSON.parse(this.mod.UTF8ToString(this.mod._xc_cycle_lines())) as number[]; }
    catch { return []; }
  }
  abi(): number {
    return typeof this.mod._xc_abi === 'function' ? this.mod._xc_abi() : 0;
  }
  /** Active program overrides from setworldsim(name, v), keyed by worldsim name. */
  worldsimOverrides(): Record<string, number> {
    if (typeof this.mod._xc_worldsim_overrides !== 'function') return {};
    try { return JSON.parse(this.mod.UTF8ToString(this.mod._xc_worldsim_overrides())) as Record<string, number>; }
    catch { return {}; }
  }
  /** Stream a channel's effective worldsim value back (getworldsim answers it). */
  worldsimSync(name: string, v: number) {
    if (typeof this.mod._xc_worldsim_sync !== 'function') return;
    const nb = new TextEncoder().encode(name).length + 1;
    const p = this.mod._malloc(nb);
    this.mod.stringToUTF8(name, p, nb);
    this.mod._xc_worldsim_sync(p, v);
    this.mod._free(p);
  }
  saveStorage() { this.mod._xc_save_storage(); }
  /** Legacy in-place re-boot (kept for the native triage runner; the app
   *  reboots by re-opening - see XenonDialog.reboot). */
  reboot() {
    this.mod._xc_save_storage();
    if (this.mod._xc_boot()) { this.error = this.mod.UTF8ToString(this.mod._xc_error()); return false; }
    this.running = true;
    return true;
  }
  stop() { this.running = false; }

  screenCount(): number { return this.mod._xc_screen_count(); }

  /** EVERY surface's key/size (cheap; the Badger carries 118 buffers). */
  screenMeta(): { key: string; w: number; h: number }[] {
    const m = this.mod, out = [];
    for (let i = 0; i < m._xc_screen_count(); i++) {
      const w = m._xc_screen_w(i), h = m._xc_screen_h(i);
      if (!w || !h) continue;
      out.push({ key: m.UTF8ToString(m._xc_screen_key(i)), w, h });
    }
    return out;
  }

  /** One surface's RGBA framebuffer (fetched on demand, by key). */
  screenPixels(key: string): Uint8ClampedArray | null {
    const m = this.mod;
    const nb = new TextEncoder().encode(key).length + 1;
    const p = m._malloc(nb);
    m.stringToUTF8(key, p, nb);
    const idx = typeof m._xc_screen_index === 'function' ? m._xc_screen_index(p) : -1;
    m._free(p);
    if (idx < 0) return null;
    const w = m._xc_screen_w(idx), h = m._xc_screen_h(idx), d = m._xc_screen_pixels(idx);
    if (!w || !h || !d) return null;
    return new Uint8ClampedArray(m.HEAPU8.buffer.slice(d, d + w * h * 4));
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

// ---------------------------------------------------------------------------
// XenonPump — THE single running computer (the wasm module holds ONE global
// VM context, so exactly one MiniComputer runs at a time) and THE single
// 25 Hz cycle pump. The IDE dialog, the bottom Screens dock and the 3-D
// dashboard feeds all share it: they register canvases / subscribe to ticks.
// Game rule (ide.md): the in-game IDEs of several computers can be open at
// once; ours re-boots the VM when you point at a different computer.

/** The pump cadence (v1.13.2, we: "computers should run at 25 hz update
 *  cycles, not 10 hz"). The shipped xenoncode.wasm's system_frequency()
 *  built-in reports the cadence its build was cut on (10.0); the shim source
 *  (tools/xenoncode/xc_host.cpp) carries 25.0 for the next WASM rebuild —
 *  a value-only change, ABI 4 unchanged, so nothing degrades meanwhile. */
export const CYCLE_MS = 40;
export const CYCLE_HZ = 25;

/** PilotSeat channel-function word → the flight keys driving it (v1.13.2,
 *  we: "pressing WASD, up, down, and F should be given as inputs into the
 *  computer for all cockpit connections it has. This will allow us to
 *  simulate that"). The channel meanings are the game's own (wiki
 *  PilotSeat.md outputs): ch 1 Backward/Forward, ch 2 Left/Right and
 *  ch 3 Down/Up form a -1..+1 translation stick, and Aux 1 (ch 8, 0|1)
 *  takes F as the action button. Matching is by the FUNCTION WORD, so the
 *  keys land on every PilotSeat channel with that meaning (a craft with
 *  two seats drives both). */
export type PilotKey = 'w' | 's' | 'a' | 'd' | 'up' | 'down' | 'f' | 'space' | 'e'
  | 'q' | 'i' | 'k' | 'j' | 'l' | 'r'
  | 'digit1' | 'digit2' | 'digit3' | 'digit4' | 'digit5'
  | 'digit6' | 'digit7' | 'digit8' | 'digit9' | 'digit0';
export const PILOT_KEYS: Record<string, Partial<Record<PilotKey, number>>> = {
  'backward/forward': { w: 1, s: -1 },
  'left/right': { d: 1, a: -1 },
  // SPACE joins Down/Up (the seat's +1): arcade crafts prompt "Press SPACE
  // to play" on the stick's Up channel (Space Invaders 3288012440 reads
  // input_number(10,3)) — the pure Aux-1 mapping made Space do nothing
  // there (we: "I can't give input via its computer"; the stick mapping
  // keeps Mario's jump, whose seat reads ch3 AND Aux 1).
  'down/up': { up: 1, down: -1, space: 1 },
  'pitch': { i: 1, k: -1 },
  'roll': { e: 1, q: -1 },   // E = Mario's FIRE (Roll ch 5); Q the counter-roll
  'yaw': { l: 1, j: -1 },
  'main thrust': { r: 1 },
  // F and SPACE are aliases of the same action button (Aux 1 = Mario's
  // jump; we: "we need to emulate space"); the digit row mirrors the Aux
  // ladder (Aux 1..9, 0 = Aux 10) so every cockpit channel is reachable
  // (we: "we need keyboard binds available also for the other keys
  // cockpits can give").
  'aux 1': { f: 1, space: 1, digit1: 1 },
  'aux 2': { digit2: 1 },
  'aux 3': { digit3: 1 },
  'aux 4': { digit4: 1 },
  'aux 5': { digit5: 1 },
  'aux 6': { digit6: 1 },
  'aux 7': { digit7: 1 },
  'aux 8': { digit8: 1 },
  'aux 9': { digit9: 1 },
  'aux 0': { digit0: 1 },
};

/** Every PILOT_KEYS function word the table defines (worldsim binding
 *  filter; pure, vitest-pinned). */
export const pilotKeyWords = (): string[] => Object.keys(PILOT_KEYS);

export interface XenonSurface {
  key: string; w: number; h: number;
  // pixels are fetched only for canvases on screen and 3-D dashboard feeds
  // (the Badger paints 118 buffers; copying all every tick is pure memcpy)
  pixels?: Uint8ClampedArray;
}

export class XenonPump {
  run: XenonRun | null = null;
  comp: XenonComputer | null = null;
  status: 'idle' | 'booting' | 'running' | 'stopped' | 'error' = 'idle';
  error = '';
  cycles = 0;
  bus = new Map<string, number | string>();          // 'io:port' -> last output
  reads = new Map<string, number>();                 // 'io:ch'  -> last input_number READ
  vars = new Map<string, XenonVar>();                // '$name'  -> live global variable
  // ── debugger (F9 break · F10/F11 step · F8 resume, VS-Code-style keys):
  // a step is ONE 25 Hz computer cycle (line-granular suspend/resume does
  // not exist in the library's VM architecture — cycle granularity is what
  // the interpreter honestly supports); a breakpoint PAUSES AT the cycle
  // that TOUCHED its line (executed-line tracking, tools/xenoncode).
  paused = false;
  pausedAt = 0;                                      // the bp line that paused
  breakLines = new Set<number>();                    // line numbers of the ACTIVE code tab
  // ── pilot keys (v1.13.2): the flight keys bound to the RUNNING computer's
  // PilotSeat worldsim rows — built in buildWorldSim, cleared on close.
  private pilotBindings = new Map<PilotKey, { name: string; sign: number }[]>();
  // ── WORLDSIM (engine/worldsim.ts): every input channel of the running
  // computer is a function of t (elapsed seconds) evaluated each cycle —
  // headings sweep, altitude breathes around 2000 m, the stick oscillates.
  // setworldsim(name, v) from the program overrides a row (shown · program,
  // pow(10,40) releases); sliders are the MANUAL mode per row.
  // name -> io/ch bindings of the CURRENT computer (the channels themselves
  // are the GLOBAL store in engine/worldsim.ts — shared, persisted)
  private wsBindings = new Map<string, { io: number | string; ch: number }>();
  private wsT0 = 0;
  private wsOverrides: Record<string, number> = {};
  log: XenonEvent[] = [];
  // PRINTS get their OWN history (v1.13.2): at the 25 Hz cadence a chatty
  // firmware (the Badger: hundreds of output_number events per cycle)
  // buried every boot print out of the 180-event log window within ONE
  // cycle — the Console tab's 'no prints yet' e2e red. Console reads this.
  prints: XenonEvent[] = [];
  surfaces = new Map<string, XenonSurface>();        // screen key -> latest framebuffer
  private canvases = new Map<string, Set<HTMLCanvasElement>>();
  private feedKeys = new Set<string>();   // 3-D dashboard face keys (Engine)
  private subs = new Set<() => void>();
  private timer = 0;
  private openSeq = 0;
  private stepWanted = 0;

  /** Boot comp (closing any other computer's run). Resolves when the VM is
   *  up (status running/error). */
  async open(comp: XenonComputer): Promise<void> {
    if (this.run && this.comp?.ci === comp.ci
        && (this.status === 'running' || this.status === 'booting')) return;
    const seq = ++this.openSeq;
    this.stopLoop();
    this.run?.stop();
    this.run = null;
    this.comp = comp;
    this.status = 'booting';
    this.error = '';
    this.cycles = 0;
    this.bus = new Map();
    this.reads = new Map();
    this.vars = new Map();
    this.log = [];
    this.prints = [];
    this.surfaces = new Map();
    const run = await XenonRun.open(comp);
    if (seq !== this.openSeq) { run.stop(); return; }   // superseded by a newer open
    this.paused = false; this.pausedAt = 0; this.stepWanted = 0;
    this.run = run;
    if (run.error) { this.status = 'error'; this.error = run.error; }
    else {
      this.status = 'running';
      for (const c of comp.channels) run.setInput(c.io, c.ch, 0);
      run.debugTrack(true);                          // XENON-DEBUG: lines feed the debugger
      this.wsT0 = performance.now();
      if (run.abi() !== XC_ABI)
        console.warn(`[xenon] wasm ABI ${run.abi()} != app ${XC_ABI}: the shipped `
          + 'xenoncode.wasm is older than the app - rebuild tools/xenoncode '
          + '(worldsim/debugger features degrade gracefully until then)');
      void this.buildWorldSim(comp);
    }
    this.notify();
    this.startLoop();
  }

  close() {
    this.openSeq++;
    this.stopLoop();
    this.run?.stop();
    this.run = null;
    this.comp = null;
    this.status = 'idle';
    this.surfaces = new Map();
    this.wsBindings = new Map();
    this.wsOverrides = {};
    this.pilotBindings = new Map();
    this.paused = false; this.pausedAt = 0; this.stepWanted = 0; this.breakLines = new Set();
    this.notify();
  }

  stopRunning() { this.run?.stop(); this.status = 'stopped'; this.notify(); }
  /** Breakpoint set for the ACTIVE code tab (v1: line numbers match the
   *  executed-line list, which mixes files — a break line pauses the cycle
   *  that ran it in ANY included file). */
  setBreaks(lines: Iterable<number>) { this.breakLines = new Set(lines); this.notify(); }

  /** The Bus-tab sliders. A channel a worldsim row feeds flips that row to
   *  MANUAL (last touch wins — the slider and the f(t) drive one binding). */
  setInput(io: number | string, ch: number, v: number) {
    for (const [name, b] of this.wsBindings)
      if (b.io === io && b.ch === ch) {
        const r = wsChans().get(name);
        if (r && r.mode !== 'manual') { r.mode = 'manual'; wsSave(); }
        if (r) { r.manual = v; r.value = v; }
        this.notify();
        return;
      }
    this.run?.setInput(io, ch, v);
  }

  /** Name the running computer's input channels and give every one a
   *  time function (the game's channel meanings drive the defaults). */
  private async buildWorldSim(comp: XenonComputer) {
    wsLoad();
    const table = await loadChannelTable();
    const bindings = new Map<string, { io: number | string; ch: number }>();
    const pilot = new Map<PilotKey, { name: string; sign: number }[]>();
    for (const c of comp.channels) {
      const dev = comp.devices.find(d =>
        typeof c.io === 'number' ? d.io === c.io : d.alias === String(c.io));
      const type = dev?.type ?? '';
      const fn = dev ? chanInfo(table, type, 'out', c.ch)?.fn ?? null : null;
      const name = wsName(dev?.alias || type || `io${c.io}`, fn, c.ch);
      wsEnsure(name, `${dev?.alias || type || c.io} · ${fn ?? `ch ${c.ch}`}`,
        wsKind(type.toLowerCase()),
        worldsimDefault(fn?.toLowerCase() ?? null, type.toLowerCase()));
      bindings.set(name, { io: c.io, ch: c.ch });
      if (type === 'PilotSeat' && fn)
        for (const [k, sign] of Object.entries(PILOT_KEYS[fn.toLowerCase()] ?? {}) as [PilotKey, number][])
          (pilot.get(k) ?? pilot.set(k, []).get(k)!).push({ name, sign });
    }
    // FULL COCKPIT SURFACE (v1.13.8, we: "we need keyboard binds available
    // also for the other keys cockpits can give"): every documented PilotSeat
    // output channel gets a worldsim row + key binding, not just the ones
    // the program happens to call input_number on — Pitch/Yaw/Main Thrust/
    // Aux 2..0 had NO row at all, so their keys (I/K, J/L, R, 2..9, 0) had
    // nothing to drive on crafts like the Space Invaders arcade.
    for (const dev of comp.devices.filter(d => d.type === 'PilotSeat')) {
      for (const chS of Object.keys(table?.['PilotSeat']?.out ?? {})) {
        const ch = +chS;
        if ([...bindings.values()].some(b => b.ch === ch
            && (b.io === dev.io || (dev.io < 0 && String(b.io) === dev.alias)))) continue;
        const fn = chanInfo(table, 'PilotSeat', 'out', ch)?.fn ?? null;
        const name = wsName(dev.alias || 'PilotSeat', fn, ch);
        if (bindings.has(name)) continue;
        wsEnsure(name, `${dev.alias || 'PilotSeat'} · ${fn ?? `ch ${ch}`}`,
          wsKind('pilotseat'), worldsimDefault(fn?.toLowerCase() ?? null, 'pilotseat'));
        bindings.set(name, { io: dev.io, ch });
        if (fn)
          for (const [k, sign] of Object.entries(PILOT_KEYS[fn.toLowerCase()] ?? {}) as [PilotKey, number][])
            (pilot.get(k) ?? pilot.set(k, []).get(k)!).push({ name, sign });
      }
    }
    this.wsBindings = bindings;
    this.pilotBindings = pilot;
    // A bound cockpit channel RESTS AT ZERO: an oscillating stick (the
    // telemetry-alive defaults) would make a game craft run on its own —
    // in the game, an un-touched PilotSeat sends 0 (the seat's Using
    // channel keeps its '1' = seated default).
    for (const rows of pilot.values())
      for (const b of rows) {
        const r = wsChans().get(b.name);
        if (r && r.mode === 'auto') { r.mode = 'manual'; r.manual = 0; r.value = 0; }
      }
    wsSave();
    this.notify();
  }

  /** The flight keys the RUNNING computer's cockpit answers (empty when it
   *  has no PilotSeat channels). */
  pilotKeysBound(): PilotKey[] { return [...this.pilotBindings.keys()]; }

  /** One flight-key press/release (v1.13.2): drives every matching PilotSeat
   *  worldsim row MANUAL at the channel's signed value (press = ±1, release
   *  centers to 0 — a stick, not a latch), exactly like the Bus-tab slider
   *  touching the row. The program sees it through input_number on the
   *  seat's channel next cycle. Returns false when no cockpit channel
   *  answers this key (the caller may then let the key through). */
  pilotKey(key: PilotKey, down: boolean): boolean {
    const rows = this.pilotBindings.get(key);
    if (!rows?.length) return false;
    for (const b of rows) {
      const r = wsChans().get(b.name);
      if (!r) continue;
      r.mode = 'manual';
      r.manual = down ? b.sign : 0;
      r.value = r.manual;
    }
    wsSave();
    this.notify();
    return true;
  }

  /** Each cycle: evaluate every auto row at t, honour program overrides,
   *  feed the VM, and stream effective values back for getworldsim. */
  private stepWorldSim(run: XenonRun) {
    if (!this.wsBindings.size) return;
    const t = (performance.now() - this.wsT0) / 1000;
    this.wsOverrides = run.worldsimOverrides();
    for (const [name, bind] of this.wsBindings) {
      const r = wsChans().get(name);
      if (!r) continue;
      let v: number;
      if (r.mode === 'manual') v = r.manual;
      else {
        try {
          v = evalExpr(r.base, t);
          if (r.kind === 'sensor' && r.override.trim()) v = evalExpr(r.override, t, v);
          r.error = undefined;
        } catch (e) { v = 0; r.error = String((e as Error).message ?? e); }
      }
      const ov = this.wsOverrides[name];      // program setworldsim wins
      if (ov !== undefined) v = ov;
      r.value = v;
      run.setInput(bind.io, bind.ch, v);
      run.worldsimSync(name, v);
    }
  }

  /** The GLOBAL worldsim channels (World tab renders them; labels cover
   *  every craft seen this session). */
  wsChannels(): WorldSimChan[] {
    return [...wsChans().values()];
  }
  wsBoundNames(): Set<string> { return new Set(this.wsBindings.keys()); }

  /** Names currently overridden by the program's setworldsim calls. */
  wsOverrideNames(): string[] { return Object.keys(this.wsOverrides); }
  wsSetBase(name: string, base: string) {
    const r = wsChans().get(name);
    if (r) { r.base = base; r.error = undefined; wsSave(); this.notify(); }
  }
  wsSetOverride(name: string, override: string) {
    const r = wsChans().get(name);
    if (r && r.kind === 'sensor') { r.override = override; r.error = undefined; wsSave(); this.notify(); }
  }
  wsSetMode(name: string, mode: 'auto' | 'manual') {
    const r = wsChans().get(name);
    if (r) { r.mode = mode; wsSave(); this.notify(); }
  }
  wsSetManual(name: string, v: number) {
    const r = wsChans().get(name);
    if (r) { r.manual = v; r.value = v; wsSave(); this.notify(); }
  }
  pause() { if (this.status === 'running') { this.paused = true; this.notify(); } }
  resume() { this.paused = false; this.pausedAt = 0; this.stepWanted = 0; this.notify(); }
  /** F10/F11: run exactly one more cycle, then pause again. */
  step() {
    if (this.status !== 'running' && this.status !== 'stopped') return;
    this.stepWanted++;
    this.paused = false;
    this.startRunning();
  }
  startRunning() {
    if (!this.run) return;
    this.run.running = true;
    this.status = 'running';
    this.startLoop();
    this.notify();
  }
  reboot() {
    const r = this.run;
    if (!r) return;
    if (r.reboot()) { this.status = 'running'; this.log = []; this.prints = []; this.bus = new Map(); this.startLoop(); }
    else { this.status = 'error'; this.error = r.error; }
    this.notify();
  }
  screenClick(key: string, x: number, y: number) { this.run?.screenClick(key.toLowerCase(), x, y); }
  screenScroll(key: string, d: number) { this.run?.screenScroll(key.toLowerCase(), d); }

  /** Which surface keys the 3-D scene is rendering on craft dashboards. */
  setFeedKeys(keys: Iterable<string>) { this.feedKeys = new Set(keys); }
  /** debug channel: the rAF handle (0 = the loop is not running) */
  raf2(): number { return this.timer; }

  registerCanvas(key: string, cv: HTMLCanvasElement): () => void {
    const k = key.toLowerCase();
    let s = this.canvases.get(k);
    if (!s) { s = new Set(); this.canvases.set(k, s); }
    s.add(cv);
    const surf = this.surfaces.get(k);
    if (surf?.pixels) this.blit(cv, surf);
    return () => { this.canvases.get(k)?.delete(cv); };
  }
  subscribe(cb: () => void): () => void {
    this.subs.add(cb);
    return () => { this.subs.delete(cb); };
  }

  /** Re-boot the SAME computer after its files changed (the game auto-reboots
   *  on save — ide.md "Running the code"). */
  reload(comp: XenonComputer) {
    this.openSeq++;
    this.stopLoop();
    this.run?.stop();
    this.run = null;
    void this.open(comp);
  }

  private blit(cv: HTMLCanvasElement, s: XenonSurface) {
    if (cv.width !== s.w) cv.width = s.w;
    if (cv.height !== s.h) cv.height = s.h;
    cv.getContext('2d')?.putImageData(
      new ImageData(s.pixels as Uint8ClampedArray<ArrayBuffer>, s.w, s.h), 0, 0);
  }
  private notify() { for (const cb of [...this.subs]) cb(); }

  /** Cycle hooks run SYNCHRONOUSLY every pump cycle, right after the
   *  surfaces update (v1.13.5, we: "the display of visuals in the screens
   *  of the craft feels a bit delayed compared to actual screen
   *  visibility"): the 3-D dashboard faces rode pump.subscribe — the
   *  ≤10 Hz React notify — while the dock canvases blit every cycle, so
   *  the craft's screens lagged the dock's by ~150 ms. */
  private cycleHooks = new Set<() => void>();
  addCycleHook(cb: () => void): () => void {
    this.cycleHooks.add(cb);
    return () => { this.cycleHooks.delete(cb); };
  }

  /** React-facing notify. THE CADENCE LAW (v1.13.2): the VM runs at 25 Hz,
   *  the PANELS re-render at ≤10 Hz — a heavy firmware (the Badger's 118
   *  surfaces, ~100 var rows) re-rendered 25x/s starves the main thread in
   *  headless runs (the suite caught it); panel values lag ≤100 ms, the
   *  canvases blit EVERY cycle. */
  private lastNotify = 0;
  private notifyCoalesced(t: number) {
    if (t - this.lastNotify < 100) return;
    this.lastNotify = t;
    this.notify();
  }

  private startLoop() {
    if (this.timer) return;
    // setInterval, NOT requestAnimationFrame (the Buzzer Bench probe
    // exposed why): rAF only fires while the compositor produces frames —
    // an on-demand scene with nothing animating STOPS producing them,
    // and the VM stalls at cycle ~1 (the same stall hits a real tab
    // idling toward background). A timer keeps the cadence honest;
    // blits/screens ride the cycles.
    this.timer = window.setInterval(() => {
      this.cycleOnce(typeof performance !== 'undefined' ? performance.now() : Date.now());
    }, CYCLE_MS);
  }

  /** ONE computer cycle: worldsim → VM → events → surfaces → hooks → audio.
   *  Shared by the rAF loop and XenonTest's deterministic runCycles. */
  private cycleOnce(t: number, force = false): void {
    const run = this.run;
    if (!run || !run.running) return;
    // XenonTest gate: runCycles() owns the VM while a test advances it
    // (force = the test's OWN cycles get through their own gate)
    if (this.testGate && !force) return;
    // debugger gate: while PAUSED the pump runs cycles only for a step
    if (this.paused && this.stepWanted <= 0) return;
    this.stepWorldSim(run);
    const evs = run.cycle();
    if (evs.length) {
      const prints = evs.filter(e => e.e !== 'cycle');
      if (prints.length) this.log = [...this.log.slice(-180), ...prints];
      const prs = prints.filter(e => e.e === 'print');
      if (prs.length) this.prints = [...this.prints.slice(-240), ...prs];
      for (const e of evs) {
        if (e.e === 'out') {
          // MOST-RECENTLY-ACTIVE order: re-insert so a per-cycle io stays
          // in the visible last-24 window (insertion-only Map order let
          // busy rows get buried — the Badger's mining-drill pin raced)
          const k = `${e.io}:${e.port}`;
          this.bus.delete(k);
          this.bus.set(k, e.v ?? '');
        }
        else if (e.e === 'in') this.reads.set(`${e.io}:${e.port}`, Number(e.v) || 0);
      }
    }
    this.cycles++;
    if (this.stepWanted > 0) { this.stepWanted--; this.paused = true; }
    if (this.breakLines.size) {
      for (const l of run.cycleLines())
        if (this.breakLines.has(l)) { this.paused = true; this.pausedAt = l; break; }
    }
    const vs = run.vars();
    this.vars = new Map(vs.filter(varVisible).map(v => [v.name, v]));
    if (run.error) {
      this.status = 'error';
      this.error = run.error;
      this.notify();
      return;
    }
    // surfaces: ALL keys each tick; pixels only for keys a canvas (this
    // panel) or a 3-D dashboard feed actually shows
    const want = new Set<string>([...this.canvases.keys(), ...this.feedKeys]);
    const next = new Map<string, XenonSurface>();
    for (const meta of run.screenMeta()) {
      let pixels = this.surfaces.get(meta.key)?.pixels;
      if (want.has(meta.key)) {
        const got = run.screenPixels(meta.key);
        if (got) {
          pixels = got;
          for (const cv of this.canvases.get(meta.key) ?? [])
            this.blit(cv, { ...meta, pixels: got });
        }
      }
      next.set(meta.key, { ...meta, pixels });
    }
    // BUILT-IN SCREEN mirror: the integrated touchscreen is the plain
    // screen-function target (main#0) - feed the model-face key with the
    // same pixels (the scene registered it at wsDeviceSlug(c)#0)
    const main0 = next.get('main#0');
    if (main0 && this.comp)
      for (const sc of this.comp.screens)
        if (sc.deviceScreen) {
          const mk = `${slug(sc.alias)}#${sc.channel}`;
          const mir = { ...main0, key: mk };   // the KEY must travel with
          next.set(mk, mir);                   // the pixels (push keys off it)
          if (mir.pixels)
            for (const cv of this.canvases.get(mk) ?? []) this.blit(cv, mir);
        }
    this.surfaces = next;
    for (const h of [...this.cycleHooks]) {
      try { h(); } catch { /* a hook never breaks the pump */ }
    }
    // BUZZERS (engine/buzzer.ts): the game's Buzzer takes Amplitude (ch 0)
    // and Frequency Hz (ch 1) on its data channel — the io bus rows above
    // carry exactly that; turn live ones into real WebAudio sound.
    buzzerAudio.sync(this);
    // debugger-state transitions notify IMMEDIATELY: the coalesced notify
    // runs on a 100 ms gate, and the iteration that SETS paused=true can
    // land on a suppressed tick — after which every tick early-returns
    // (PAUSED) and the UI freezes blind (the F9 pill / F10 cycles-text
    // e2e reds). A paused loop notifies once here and then idles.
    if (this.paused) this.notify();
    else this.notifyCoalesced(t);
  }

  /** XenonTest (engine/xenontest.ts): advance the VM EXACTLY n cycles,
   *  synchronously, with the rAF loop gated out — the deterministic phase
   *  every assert evaluates against. */
  private testGate = false;
  runCycles(n: number): void {
    if (!this.run?.running) return;
    this.testGate = true;
    try {
      for (let i = 0; i < n; i++) {
        if (!this.run?.running) break;
        this.cycleOnce(typeof performance !== "undefined" ? performance.now() : 0, true);
      }
    } finally {
      this.testGate = false;
      this.notify();
    }
  }

  /** The snapshot XenonTest asserts evaluate against. */
  snapshot(): XenonSnap {
    const bus: Record<string, number | string> = {};
    for (const [k, v] of this.bus) bus[k] = v;
    const devices = (this.comp?.devices ?? []).map(d => {
      const g = (ch: number) => {
        const v = this.bus.get(`${d.alias}:${ch}`) ?? (d.io >= 0 ? this.bus.get(`${d.io}:${ch}`) : undefined);
        return Number(v) || 0;
      };
      return {
        alias: d.alias, type: d.type, mode: d.mode,
        amp: g(0), freq: g(1),
        wave: typeof d.mode === 'number' ? modeToWave(d.mode) : 'square',
      };
    });
    return { cycles: this.cycles, prints: this.prints.filter(e => e.e === 'print').length, bus, devices };
  }
  private stopLoop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = 0;
  }
}

/** The shim ABI the app expects (xc_host.cpp xc_abi()). Bump with the shim. */
export const XC_ABI = 5;

export const xenonPump = new XenonPump();

/** A craft has PHYSICAL screens: a Dashboard carrying Screen/HdScreen
 *  elements (the gate for the Screens button — "only visible if the craft
 *  has dashboards"). */
export function hasDashboards(bp: Blueprint): boolean {
  return (bp.data.components as BlueprintComponent[]).some(c =>
    c.type === 'Dashboard'
    && ((c.data as any)?.elements ?? []).some(
      (e: any) => e && (e.type === 'Screen' || e.type === 'HdScreen')));
}

/** surface key ('alias#channel') -> human label, for the screens panel. */
export function xenonScreenBindings(comp: XenonComputer): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of comp.screens) m.set(`${s.alias.toLowerCase()}#${s.channel}`, s.label);
  return m;
}

// ---------------------------------------------------------------------------
// Variable introspection (the IDE's Vars panel + the $var hover). The wasm
// DumpVarsJson (tools/xenoncode/patch_xenon_vars.py) reports the program's
// GLOBAL-scope variables live: RAM slots and the storage cache. CODE_TYPE
// (XenonCode.hpp enum): 50/51 storage, 70/71 RAM, 60/61+80/81 arrays,
// 128+ objects, 40/41 ROM constants.
export interface XenonVar { name: string; t: number; v: string }

export function varKind(t: number): 'num' | 'text' | 'array' | 'object' | 'const' {
  if (t === 70 || t === 50) return 'num';
  if (t === 71 || t === 51) return 'text';
  if (t === 60 || t === 61 || t === 80 || t === 81) return 'array';
  if (t >= 128) return 'object';
  return 'const';
}
/** Panel hygiene: function/argument/const artifacts (`.init`, `@fn.1`,
 *  ROM constants) are not user variables. */
export function varVisible(v: XenonVar): boolean {
  return varKind(v.t) !== 'const' && !v.name.includes('.') && !v.name.startsWith('@');
}

/** The KV-serialization format the language uses for text objects
 *  (README: `var $o = ".a{5}.b{8}"`, members read as `$o.a`): break a value
 *  open into its members, null when it is plain text. Nested braces do not
 *  exist in the format ({...} values are flat). */
export function parseKv(v: string): { k: string; v: string }[] | null {
  if (!v.startsWith('.')) return null;
  const out: { k: string; v: string }[] = [];
  for (const m of v.matchAll(/\.([^{}.]+)\{([^{}]*)\}/g)) out.push({ k: m[1]!, v: m[2]! });
  const len = out.reduce((n, e) => n + e.k.length + e.v.length + 3, 0);
  return out.length && len >= v.length - 2 ? out : null;   // not a KV string
}

export function parseVarsJson(json: string): XenonVar[] {
  try {
    const j = JSON.parse(json) as { name: string; t: number; v: string }[];
    return Array.isArray(j) ? j.map(e => ({ name: e.name, t: e.t | 0, v: String(e.v ?? '') })) : [];
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// Channel meanings — the game's OWN per-type io semantics (viewer/models/
// channels.json, tools/extract_channels.py from the bundled wiki's
// "List of inputs/outputs" tables). A type's `out` is what it SENDS on its
// data port (the meaning of input_number on an io cabled to it); `in` is
// what output_number writes to it. The IDE resolves io → component (the
// xenonDevices table) → type → channel row, so a slider reads
// "io 4 · NavInstrument — ch 6 Heading (0..360)" and not a bare "ch 6".
export interface ChanInfo { fn: string; rng: string }
export type ChannelTable = Record<string, { in?: Record<string, ChanInfo>; out?: Record<string, ChanInfo> }>;

let chanP: Promise<ChannelTable | null> | null = null;
export function loadChannelTable(): Promise<ChannelTable | null> {
  chanP ??= (async () => {
    for (const path of atlasJsonPaths('channels.json')) {
      try {
        const r = await fetch(path);
        if (!r.ok) continue;
        const j = await r.json() as ChannelTable;
        if (j && Object.keys(j).length) return j;
      } catch { /* next candidate */ }
    }
    return null;
  })().then(c => { if (!c) chanP = null; return c; });
  return chanP;
}

/** The channel row for (device type, direction, channel), if documented. */
export function chanInfo(t: ChannelTable | null | undefined, type: string,
  dir: 'in' | 'out', ch: number): ChanInfo | null {
  return t?.[type]?.[dir]?.[String(ch)] ?? null;
}
