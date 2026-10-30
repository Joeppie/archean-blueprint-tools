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
import { blockAt, functionAt, includeOrder, projectBlocks, projectFunctions, type XCBlock } from './xcproject';
import { beaconNet } from './beaconnet';
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
  // ABI 11 (v1.14.1 slices B+D): typed as OPTIONAL — every caller
  // typeof-guards (a stale wasm degrades features, never spams)
  _xc_set_input_t?: (alias: number, ch: number, text: number) => void;
  _xc_beacon_put?: (i: number, payload: number) => void;
  _xc_set_world?: (key: number, value: number) => void;
  _xc_set_view?: (w: number, h: number, mx: number, my: number, fov: number, look: number) => void;
  _xc_screen_anchor?: (idx: number) => number;
  _xc_screen_px?: (idx: number) => number;
  _xc_screen_py?: (idx: number) => number;
  _xc_screen_haspos?: (idx: number) => number;
  _xc_hud_mode?: (on: number) => void;
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
  _xc_screen_version?(i: number): number;
  _xc_vars(): number;
  _xc_locals_json(file: number, line: number): number;
  _xc_source_files(): number;
  _xc_write_var(file: number, line: number, name: number, type: number, value: number): number;
  _xc_debug_track(on: number): void;
  _xc_cycle_lines(): number;
  _xc_cycle_pairs(): number;
  // XENON-DEBUG v3 (ABI 10): call-depth stream (index-aligned with the pair
  // stream), the host-armed hook gate, and the exact-line pause seam
  _xc_cycle_depths?(): number;
  _xc_hook_live?(on: number): void;
  _xc_pause_request?(): void;
  _xc_pause_cancel?(): void;
  _xc_pause_file?(): number;
  _xc_pause_line?(): number;
  _xc_screen_click(idx: number, x: number, y: number): void;
  _xc_screen_scroll(idx: number, d: number): void;
  _xc_parse_line(p: number, n: number): number;
};

// v1.13.17 L4 (we: "Why is xenoncode.js so modular and separate … rather
// than modular but integrated into our code?"): the separation stays
// DELIBERATE (ABI/license/provenance/build-cadence — XENONCODE_UPSTREAM.md)
// but the FORM was accidental: a classic script in app/public/ injected
// into document.head + a createXenonCode GLOBAL. The glue is now an ESM
// build product (build.sh -sEXPORT_ES6=1) imported through the vite module
// graph via ?url (the seal.wasm precedent): fingerprinted with the app,
// and the emitted URL carries the Pages project base for free.
import xcGlueUrl from './xenoncode/xenoncode.js?url';
import xcWasmUrl from './xenoncode/xenoncode.wasm?url';

/** v1.15.0 P9 slice C (COMPUTERFARM): ONE MODULE INSTANCE PER VM. The
 *  shim keeps its whole world (screens, devices, inputs, beacons, events)
 *  in module globals, so co-running computers = co-running emscripten
 *  instances (the glue factory called again; code shared, heap separate).
 *  This replaces the ONE-INTERPRETER mutual-kill of runtimemgr (deleted) —
 *  and the v1.16.6 cleanup the shared xenonReady() singleton with it: the
 *  parse-only helpers (tokenize/#NODES/channels) never touch the module. */
export function xenonInstantiate(): Promise<Mod> {
  return import(/* @vite-ignore */ xcGlueUrl)
    .then((m: { default: (o: Record<string, unknown>) => Promise<Mod> }) =>
      m.default({ locateFile: () => xcWasmUrl }));
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
  /** v1.15.2 ABI 12: the HUD RUNTIME kind — ONLY hudpump.ts sets this (the
   *  XenonRun twin stamps xc_hud_mode). NOT the component type: a craft's
   *  HudController component carries type 'hud' and its VM is a COMPUTER
   *  (the Badger's get(key) worldsim law) — stamping by type made the shim's
   *  two-arg HUD get() override it ("not enough arguments: avatar_sensor_
   *  speed", the v1.15.2 Badger catch). */
  hudRuntime?: boolean;
  capacity: number;           // hdd capacity = the game's storage limit
  channels: XenonChannel[];
  screens: XCScreen[];
  devices: XCDevice[];
}

export interface XCDevice {
  io: number;               // the computer io port it is cabled to, -1 = by alias
  id: number;               // stable table id (device_at order)
  /** the device's COMPONENT index in data.components (v1.13.26 — the IDE's
   *  io-hover Ctrl+Click flies the 3-D view to the device: Engine.flyTo
   *  wants the component index, `id` is the device TABLE order). */
  ci?: number;
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

/** Every programmable computer on the craft, as an IDE descriptor. */
// Devices that ARE computers: MiniComputer + Computer (programs live in
// their data.hdd.xc_files; the Computer adds an integrated screen) and the
// CRAFTER - whose integrated touchscreen runs a published built-in program
// (wiki components/miscellaneous/Crafter.md, "Built-in Program"). The
// program is NOT stored in the blueprint json (it lives on the world's
// server HDD, ide.md Persistency), so a Crafter with no own files gets the
// built-in synthesized (we: "the poor automatic crafter doesn't have its
// computer nor built in screen recognized").
// A FRESH MiniComputer/Computer (no hdd key, empty xc_files) is listed
// TOO: it is programmable the day it is placed — the game's IDE boots on
// an empty disk and authors the first program there. Requiring a file
// before listing hid the Xenon ▾ menu on every newly placed computer, and
// with it the only way to WRITE that first file (we: "when I place a new
// minicomputer, I dont get a xenoncode menu for the computer, and I cannot
// write code for it as a consequence"). The entry-fallback chain below
// synthesizes the blank main.xc tab for an empty disk (the Badger stores
// program='' + a literal main.xc, so the name is corpus-proven); the IDE's
// save routes the tab through insertXcFile, which CREATES the hdd arrays
// in bp AND doc (the v1.6.1 doc-mirror class — xcfiles.test pins it).
const PROGRAMMABLE = /^(MiniComputer|Computer)$/;
const BUILTIN_PROGRAMS: Record<string, () => string> = {
  Crafter: () => CRAFTER_BUILTIN,
};

export function xenonComputers(bp: Blueprint): XenonComputer[] {
  const out: XenonComputer[] = [];
  (bp.data.components as BlueprintComponent[]).forEach((c, ci) => {
    const hdd = (c.data as any)?.hdd;
    const xf: { name: string; plain_code?: string }[] = hdd?.xc_files ?? [];
    const builtin = !xf.length && !PROGRAMMABLE.test(c.type) ? BUILTIN_PROGRAMS[c.type] : undefined;
    if (!xf.length && !builtin && !PROGRAMMABLE.test(c.type)) return;
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
        // THE CRAFTER TOUCHSCREEN IS 200×200 (v1.15.3, game-file proof): the
        // shipped modules/ARCHEAN_machines/components/Crafter/main.xc draws
        // its how-to popup at draw_rect(4,5,196,195) and its scroll bar at
        // (screen_w-16, 0, 15, screen_h/2) — coords that only fit a 200×200
        // panel. (The old 128×72 was a Crafter-era guess.)
        screens: [{ alias, label: `${c.type} · integrated touchscreen`, channel: 0, w: 200, h: 200, ci, deviceScreen: true }],
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
      ci,
      // A diskless device has no program name to borrow — label it with the
      // inspector's type-N convention so TWO fresh computers are distinct
      // menu items (both would otherwise read 'main'); with files, the
      // program name rides on exactly as before.
      alias: c.alias || (xf.length ? program || base : `${c.type.toLowerCase()}-${ci}`),
      program: program || base, files,
      entryName: String(main?.name ?? 'main.xc'),
      capacity: Number((c.data as any)?.hdd?.capacity) || 0,
      channels: detectChannels(files),
      screens: [
        ...xenonScreens(bp, files, ci),
        // the Computer's integrated screen: the plain screen-function
        // target (main#0) mirrored onto the model's 'screen' material face
        // THE COMPUTER'S INTEGRATED SCREEN IS 200×160 (v1.15.3, we: "that is
        // the size it should have, you made it smaller" — YES, documented
        // online: wiki.archean.space/en/components/computers/Computer.html:
        // "The resolution of the integrated screen is 200x160 pixels",
        // confirmed by the game's own BIOS script Computer/main.xc drawing
        // 200-px-wide rows). The MiniComputer has NO built-in screen (wiki:
        // "does not have a built-in screen") — it registers none and its
        // plain screen() calls land on the shim's dev-tool seed, never on a
        // 3-D face. (The old 128×72 was a Crafter-era guess.)
        ...(c.type === 'Computer'
          ? [{ alias: c.alias || `computer-${ci}`, label: 'Computer · integrated screen',
              channel: 0, w: 200, h: 160, ci, deviceScreen: true }]
          : []),
      ],
      devices: xenonDevices(bp, ci),
    });
  });
  return out;
}

/** v1.14.0 P9 slice A (we: "allow us to edit the code for at least HUDs
 *  that are contained within a HUD block"): every HudController on the
 *  craft, with its program files (data.xc_files — the game layout,
 *  FORMAT §HUD). The IDE edits them through the same doc-guaranteed
 *  xc-file writeback the MiniComputer disks use. */
export interface XenonHud {
  ci: number;
  alias: string;
  files: XCFile[];
}

export function xenonHudControllers(bp: Blueprint): XenonHud[] {
  const out: XenonHud[] = [];
  (bp.data.components as BlueprintComponent[]).forEach((c, ci) => {
    if (c.type !== 'HudController') return;
    const xf = ((c.data as any)?.xc_files ?? []) as { name: string; plain_code?: string }[];
    out.push({
      ci,
      alias: c.alias || `hud-${ci}`,
      files: xf.map(f => ({ name: f.name || 'main.xc', code: f.plain_code ?? '' })),
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
      // v1.15.3: component OVERRIDE screens (Computer V ▸ Override Screen)
      // are AUTHORED PER COMPONENT in the game's own scripts
      // (modules/<mod>/components/<Type>/main.xc — the FissionReactor draws
      // 400-px-wide rows). 128×72 is the dev-tool stand-in for components
      // the census below hasn't covered; add per-type sizes from the game
      // files as crafts demand (backlog: the script census).
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
      ci: p.a_component === ci ? p.b_component : p.a_component,
      x: other.position?.x ?? 0, y: other.position?.y ?? 0, z: other.position?.z ?? 0,
      mode: typeof (other.data as any)?.mode === 'number' ? (other.data as any).mode : undefined });
    if (other.alias) byAlias.add(other.alias);
  }
  comps.forEach((c, idx) => {
    if (!c.alias || byAlias.has(c.alias)) return;
    byAlias.add(c.alias);
    out.push({ io: -1, id: 0, alias: c.alias, type: c.type, ci: idx,
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

export interface XenonEvent {
  e: string; io?: string | number; port?: number; v?: number | string; c?: number;
  /** ABI 11 beaconpair: the VM announces a program beacon() (i = creation
   *  order, tx/rx frequencies); beacontx: its transmit(payload). */
  i?: number; tx?: string; rx?: string; d?: string;
}
export class XenonRun {
  private mod: Mod;
  running = false;
  error = '';
  private constructor(mod: Mod) { this.mod = mod; }

  static async open(comp: XenonComputer): Promise<XenonRun> {
    const mod = await xenonInstantiate();   // ONE VM PER INSTANCE (slice C)
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
      if ((comp.builtin || sc.deviceScreen) && sc.channel === 0) {
        // THE BUILT-IN PLAIN TARGET (v1.15.2, we: "the size had been wrong
        // from the inception in our editor"): in the game a MiniComputer's
        // plain screen() draws onto its OWN integrated touchscreen — for
        // EVERY computer, not just built-in programs. Registering the
        // authored panel size (128×72 on the RCS500) BEFORE boot makes it
        // the plain target (xc_addScreen is first-wins over the boot's
        // 640×480 default): the dock cell, the 3-D face texture and the
        // program's screen_w/screen_h all become the panel — the game's
        // layout lands pixel-for-pixel as the in-game screenshot shows it
        // (the Invaders' squadron spans the panel; our 640×480 default
        // made it 40% wide on a 4:3 canvas — the inception size error).
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
      // alias→port mirror of the shim's g_devByAlias (xc_lower key, LAST
      // alias wins, negative io rides 1000+id like xc_set_input_a): lets
      // setInput feed an aliased channel through the NUMERIC fast path —
      // no TextEncoder/malloc/free per write (v1.15.2 clicky-audio fix)
      if (d.alias) run.aliasIo.set(d.alias.toLowerCase(), d.io >= 0 ? d.io : 1000 + d.id);
    }
    // ABI 12 (v1.15.2): stamp the RUNTIME KIND before boot — the HUD pump's
    // programs read screen_w/screen_h as the PLAYER VIEWPORT (xc_set_view
    // feeds them); a computer keeps its plain-screen size. One binary,
    // per-instance stamp (the farm's ONE-VM-PER-INSTANCE makes this safe).
    if (comp.hudRuntime && typeof mod._xc_hud_mode === 'function')
      mod._xc_hud_mode(1);
    mod._xc_pilot_script(0);
    // the shim follows OUR pump cadence (ABI 5; an older wasm keeps its
    // baked 0.1 s dt — the abi() check below warns once, nothing crashes)
    if (typeof mod._xc_set_cycle_ms === 'function') mod._xc_set_cycle_ms(CYCLE_MS);
    // XENON-DEBUG v3 (ABI 10): the MAIN-THREAD host keeps the per-line stop
    // hook DISARMED — its debugger is the pair+depth stream, the EM_JS
    // boundary crossing at every executed line is pure cost here.
    if (typeof mod._xc_hook_live === 'function') mod._xc_hook_live(0);
    if (mod._xc_boot()) { run.error = mod.UTF8ToString(mod._xc_error()); return run; }
    run.running = true;
    return run;
  }

  /** ONE pump cycle. XENON-DEBUG v3 (ABI 10): the VM answers 0 ok / 1 error
   *  / 2 PAUSED — an armed exact-line pause (requestPause) unwinds the
   *  interpreter at the EXECUTING line and the Computer survives; the park
   *  site rides on pausedAt (SOURCEFILE idx + line, mapped via the pump's
   *  fileTable). The events of the truncated cycle are drained as usual. */
  cycle(): { evs: XenonEvent[]; pausedAt: { idx: number; line: number } | null } {
    if (!this.running) return { evs: [], pausedAt: null };
    const m = this.mod;
    const rc = m._xc_cycle();
    if (rc === 1) { this.error = m.UTF8ToString(m._xc_error()); this.running = false; return { evs: [], pausedAt: null }; }
    const evs = JSON.parse(m.UTF8ToString(m._xc_events()));
    if (rc === 2 && typeof m._xc_pause_file === 'function' && typeof m._xc_pause_line === 'function')
      return { evs, pausedAt: { idx: m._xc_pause_file(), line: m._xc_pause_line() } };
    return { evs, pausedAt: null };
  }
  /** XENON-DEBUG v3: arm the exact-line PAUSE (main-thread mode's ⏸/⏹ —
   *  the next executed line throws DebugPause; xc_cycle answers 2). */
  requestPause() {
    if (typeof this.mod._xc_pause_request === 'function') this.mod._xc_pause_request();
  }
  /** Cancel an armed park (▶/F8/re-boot — Start outranks a pending ⏸). */
  pauseCancel() {
    if (typeof this.mod._xc_pause_cancel === 'function') this.mod._xc_pause_cancel();
  }

  setInput(io: number | string, ch: number, v: number) {
    if (typeof io === 'number') { this.mod._xc_set_input(io, ch, v); return; }
    // alias→port: the shim's OWN resolution (g_devByAlias, lowercase, last
    // alias wins; negative io = 1000+id) — once resolved the write rides
    // _xc_set_input, skipping the per-write UTF-8/malloc/free marshal. The
    // farm's Cable Law loopback fires this on EVERY 'out' event, so the
    // marshal was the hot-path cost behind the v1.15.0 clicky-audio report.
    const port = this.aliasIo.get(io.toLowerCase());
    if (port !== undefined) { this.mod._xc_set_input(port, ch, v); return; }
    if (typeof this.mod._xc_set_input_a !== 'function') return;
    const nb = new TextEncoder().encode(io).length + 1;
    const p = this.mod._malloc(nb);
    this.mod.stringToUTF8(io, p, nb);
    this.mod._xc_set_input_a(p, ch, v);
    this.mod._free(p);
  }
  /** alias(lower)→shim port, built in open() (see setInput). */
  private aliasIo = new Map<string, number>();
  // ── ABI 11 (v1.14.1 slices B+D) — every one typeof-guarded: a stale wasm
  // degrades the feature, never spams.
  private putStr(s: string): number {
    const nb = new TextEncoder().encode(s).length + 1;
    const p = this.mod._malloc(nb);
    this.mod.stringToUTF8(s, p, nb);
    return p;
  }
  /** TEXT channel feed (slice D): a beaconNet delivery into a Beacon
   *  component's ch0 (input_text(port,0) reads it). */
  setInputT(alias: string, ch: number, text: string) {
    const m = this.mod;
    if (typeof m._xc_set_input_t !== 'function') return;
    const a = this.putStr(alias), t = this.putStr(text);
    m._xc_set_input_t(a, ch, t);
    m._free(a); m._free(t);
  }
  /** Deliver a received payload to the program's beacon() object #i (.data). */
  beaconPut(i: number, payload: string) {
    const m = this.mod;
    if (typeof m._xc_beacon_put !== 'function') return;
    const p = this.putStr(payload);
    m._xc_beacon_put(i, p);
    m._free(p);
  }
  /** One AVATARSIM/world text for the program's get(key). */
  setWorld(key: string, value: string) {
    const m = this.mod;
    if (typeof m._xc_set_world !== 'function') return;
    const k = this.putStr(key), v = this.putStr(value);
    m._xc_set_world(k, v);
    m._free(k); m._free(v);
  }
  /** The player viewport + pointer for the HUD built-in values. */
  setView(w: number, h: number, mx: number, my: number, fov: number, look: number) {
    if (typeof this.mod._xc_set_view === 'function')
      this.mod._xc_set_view(w, h, mx, my, fov, look);
  }
  /** A surface's panel(anchor,w,h) anchor word-constant (16 = center). */
  screenAnchor(key: string): number {
    const m = this.mod;
    if (typeof m._xc_screen_anchor !== 'function') return 16;
    const p = this.putStr(key);
    const idx = m._xc_screen_index(p);
    m._free(p);
    return idx >= 0 ? m._xc_screen_anchor(idx) : 16;
  }
  /** ABI 14: a panel's set_position px/py and whether it was ever set
   *  (until then the panel rides its anchor layout — the SCREEN window). */
  screenPos(key: string): [number, number, boolean] {
    const m = this.mod;
    if (typeof m._xc_screen_px !== 'function' || typeof m._xc_screen_py !== 'function'
        || typeof m._xc_screen_haspos !== 'function') return [0, 0, false];
    const p = this.putStr(key);
    const idx = m._xc_screen_index(p);
    m._free(p);
    return idx >= 0
      ? [m._xc_screen_px(idx), m._xc_screen_py(idx), m._xc_screen_haspos(idx) > 0]
      : [0, 0, false];
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
  /** XENON-LOCALS: the locals of the body owning (fileIdx, line) — RAM read
   *  LIVE at the call moment (main-thread mode calls this AT the pause).
   *  typeof-guarded: an older shim answers [] (drift guard, never spams). */
  locals(fileIdx: number, line: number): XenonLocal[] {
    return typeof this.mod._xc_locals_json === 'function'
      ? parseLocalsJson(this.mod.UTF8ToString(this.mod._xc_locals_json(fileIdx, line)))
      : [];
  }
  /** XENON-LOCALS (ABI 8): the compiler's runtime SOURCEFILE table. THE
   *  fileTable of record (XENON-SOURCEPATHS made it one index per name, in
   *  the VM's own registration order) — pair streams, hook breakpoints and
   *  DumpLocalsAt all speak these indices. Basenames for the UI; [] on an
   *  older shim (the pump keeps the includeOrder guess). */
  sourceFiles(): string[] {
    if (typeof this.mod._xc_source_files !== 'function') return [];
    try {
      return (JSON.parse(this.mod.UTF8ToString(this.mod._xc_source_files())) as string[])
        .map(f => f.split(/[\\/]/).pop() ?? f);
    } catch { return []; }
  }
  /** XENON-WRITEBACK (ABI 8→9): type-validated write of one variable
   *  visible at (fileIdx, line) straight into the VM's RAM slot. On the
   *  main thread the pump calls this directly (same thread = safe moment). */
  writeVar(fileIdx: number, line: number, name: string, t: number, v: string): WriteAck {
    if (typeof this.mod._xc_write_var !== 'function')
      return { ok: false, error: 'the shipped wasm lacks the writer - rebuild tools/xenoncode' };
    const ne = new TextEncoder().encode(name), ve = new TextEncoder().encode(v);
    const np = this.mod._malloc(ne.length + 1), vp = this.mod._malloc(ve.length + 1);
    this.mod.stringToUTF8(name, np, ne.length + 1);
    this.mod.stringToUTF8(v, vp, ve.length + 1);
    try {
      return parseWriteAck(this.mod.UTF8ToString(this.mod._xc_write_var(fileIdx, line, np, t, vp)));
    } finally {
      this.mod._free(np); this.mod._free(vp);
    }
  }
  /** XENON-DEBUG: record the source lines the VM executes. XENON-DEBUG v3
   *  TRACKING GATE (workpackages WP6): the pump keeps this OFF while no
   *  breakpoints, no armed step and no park request exist — an open IDE
   *  with an idle debugger then runs the VM UNTRACKED (no per-line
   *  recording, no pair JSON): debugging costs nothing when unused. */
  debugTrack(on: boolean) {
    if (typeof this.mod._xc_debug_track === 'function') this.mod._xc_debug_track(on ? 1 : 0);
  }
  cycleLines(): number[] {
    if (typeof this.mod._xc_cycle_lines !== 'function') return [];
    try { return JSON.parse(this.mod.UTF8ToString(this.mod._xc_cycle_lines())) as number[]; }
    catch { return []; }
  }
  /** XENON-DEBUG v2 (ABI 6): EXECUTION-ORDER (file * 1000000 + line) pairs —
   *  the debugger steps lines by walking this stream. Empty on older wasm
   *  (the pump then falls back to v1 cycle-lines semantics). */
  cyclePairs(): number[] {
    if (typeof this.mod._xc_cycle_pairs !== 'function') return [];
    try { return JSON.parse(this.mod.UTF8ToString(this.mod._xc_cycle_pairs())) as number[]; }
    catch { return []; }
  }
  /** XENON-DEBUG v3 (ABI 10): the CALL-DEPTH stream, index-aligned with
   *  cyclePairs (drain both per cycle) — the step-over law stops at
   *  depth <= the paused depth, so in-file callees step OVER. */
  cycleDepths(): number[] {
    if (typeof this.mod._xc_cycle_depths !== 'function') return [];
    try { return JSON.parse(this.mod.UTF8ToString(this.mod._xc_cycle_depths!())) as number[]; }
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

  /** ABI 15 (XENON-SCREEN-VERSION): the surface's write counter, -1 = the
   *  shipped wasm lacks the export (the pump then fetches every cycle — the
   *  pre-v1.16.8 law). The pump blits a surface only when this moves. */
  screenVersion(key: string): number {
    const m = this.mod;
    if (typeof m._xc_screen_version !== 'function' || typeof m._xc_screen_index !== 'function')
      return -1;
    const nb = new TextEncoder().encode(key).length + 1;
    const p = m._malloc(nb);
    m.stringToUTF8(key, p, nb);
    const idx = m._xc_screen_index(p);
    m._free(p);
    return idx >= 0 ? m._xc_screen_version(idx) : -1;
  }

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
  /** Batch form (the worker-mode API; the main thread resolves sync). */
  parseLines(lines: [string, number][]): Promise<string[]> {
    return Promise.resolve(lines.map(([s, n]) => this.parseLine(s, n)));
  }
}

// ---------------------------------------------------------------------------
// XenonWorkerRun — THE VM ON A WORKER THREAD (v1.13.17 TRUE LINE STEPPING,
// we: "Implement the capacity to actually step through lines").
//
// Same surface as XenonRun (running / error / setInput / worldsimSync /
// screenMeta / vars / cyclePairs / parseLines / reboot), the one
// difference: cycle() hands ONE update to xenonworker.ts and resolves with
// its response (events, vars, screens, pixels — pixel buffers arrive as
// transferables, the same per-cycle copy the main-thread fetch did).
//
// THE DEBUGGER rides the SHARED Int32Array (i32 — protocol + step law in
// xc_host.cpp's EM_JS hook): F10/F11/F8/runTo/breakpoints are atomic
// writes; at every executed line the interpreter checks them mid-update
// and on a stop SLEEPS IN PLACE — the worker thread parks inside
// xc_cycle() with its C++ stack (function locals, nested @call frames)
// intact, while the main thread paints, responds to keys and wakes it with
// the next command. Mid-cycle state is REAL: a breakpoint on a line whose
// side effect is `output_number(2,0,...)` pauses with the io 2 bus row
// ABSENT — the line has not run.
//
// XENON-LOCALS handoff (ABI 8): the PARKED worker answers no messages, so
// the hook writes the paused line's locals JSON into the SAB itself before
// signalling PAUSED — slot 19 = UTF-8 length, the bytes at offset 80..
// (plain writes, released by the slot-1 store; XenonWorkerRun.locals()
// reads them after its acquire load). That needs the 8192-byte SAB below;
// the v1.13.17-era 1024-byte array degrades honestly to [] (slot 19 stays
// 0, the hook's i.length > 20 guard keeps writing 0).
//
// XENON-WRITEBACK (ABI 9): editable debug values ride the same SAB —
// slot 18 = payload length, slot 20 = ack flag, and the JSON window lives
// at BYTE 128 (slot 32). THE 128 LAW: slot n owns bytes 4n..4n+4, so a
// payload window must start ABOVE every slot — the first cut shared byte
// 80 with slot 20's bytes and store(i,20,0) zeroed the payload's head
// (the audit probe showed NULs over `{"fi`; the writer answered 'refused').
//
// Gated by sabSupported(): SharedArrayBuffer needs a secure context +
// COOP/COEP (vite.config). Pages and plain-http LAN origins get
// crossOriginIsolated = false and run the v1.13.16 main-thread stepper
// (same step law, cycle-accurate) — zero behaviour change there.
// ---------------------------------------------------------------------------
export interface CycleData {
  evs: XenonEvent[];
  metas: { key: string; w: number; h: number }[];
  vars: string;
  overrides: string;
  pairs: string;
  /** XENON-DEBUG v3: the call-depth stream (audit door only — the worker's
   *  debugger is the hook, which reads the depth natively per line) */
  depths?: string;
  pixels: Record<string, ArrayBuffer>;
  error: string;
}

export function sabSupported(): boolean {
  return typeof SharedArrayBuffer !== 'undefined'
    && typeof self !== 'undefined'
    && (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
}

export class XenonWorkerRun {
  running = false;
  error = '';
  /** The debugger protocol array (xc_host.cpp's EM_JS hook is the other end) */
  readonly i32: Int32Array;
  /** Byte view over the same SAB (XENON-LOCALS: hook writes the paused
   *  frame's JSON at byte offset 80, length in i32 slot 19) */
  readonly bytes: Uint8Array;
  private worker: Worker;
  private abi_ = 0;
  private keys: string[] = [];
  private inputs: [number | string, number, number | string][] = [];
  private bputs: [number, string][] = [];
  private syncQ: [string, number][] = [];
  private lastVars: XenonVar[] = [];
  private lastSourceFiles: string[] = [];
  private lastPairs: number[] = [];
  private lastOverrides: Record<string, number> = {};
  private lastMetas: { key: string; w: number; h: number }[] = [];
  private lastPixels = new Map<string, Uint8ClampedArray>();
  private openSet!: (d: { abi: number; error: string }) => void;
  private readonly opened: Promise<{ abi: number; error: string }>;
  private cycleSet: ((d: CycleData) => void) | null = null;
  private parseSet: ((errs: string[]) => void) | null = null;
  private rebootSet: ((ok: boolean) => void) | null = null;

  private constructor(worker: Worker, sab: SharedArrayBuffer) {
    this.worker = worker;
    this.i32 = new Int32Array(sab);
    this.bytes = new Uint8Array(sab);
    this.opened = new Promise(res => { this.openSet = res; });
    worker.onmessage = (e: MessageEvent) => {
      const d = e.data as CycleData & {
        t: string; abi?: number; ok?: boolean; errs?: string[]; sfiles?: string[];
      };
      if (d.t === 'open') {
        this.abi_ = d.abi ?? 0;
        this.error = d.error ?? '';
        this.lastSourceFiles = (d.sfiles ?? []) as string[];
        this.openSet({ abi: this.abi_, error: this.error });
        return;
      }
      if (d.t === 'reboot') {
        this.running = !!d.ok;
        this.error = d.error ?? '';
        this.rebootSet?.(!!d.ok);
        this.rebootSet = null;
        return;
      }
      if (d.t === 'parse') {
        this.parseSet?.(d.errs ?? []);
        this.parseSet = null;
        return;
      }
      if (d.t === 'cycle') {
        this.error = d.error ?? '';
        if (this.error) this.running = false;
        this.lastVars = parseVarsJson(d.vars ?? '[]');
        try { this.lastPairs = JSON.parse(d.pairs ?? '[]'); } catch { this.lastPairs = []; }
        try { this.lastOverrides = JSON.parse(d.overrides ?? '{}'); } catch { this.lastOverrides = {}; }
        this.lastMetas = d.metas ?? [];
        this.lastPixels = new Map();
        const px = d.pixels ?? {};
        for (const k in px) {
          const b = px[k];
          if (b) this.lastPixels.set(k, new Uint8ClampedArray(b));
        }
        const set = this.cycleSet;
        this.cycleSet = null;
        set?.(d);
      }
    };
  }

  /** Spawn the worker + boot the VM there. Null = NOT supported (no SAB,
   *  no module, older shim ABI < 7) → the pump keeps the VM on the main
   *  thread (v1.13.16 behaviour, byte-identical).
   *  OPEN-TIMEOUT LAW (v1.13.17 L5, workpackage): a worker that never
   *  answers its 'open' (blocked fetch, wedged wasm compile, a CSP that
   *  silently kills module workers) must NEVER wedge the pump in 'booting'
   *  — the race loses at 15 s, the worker is disposed and the byte-identical
   *  main-thread stepper takes over. (The Badger's 36k-line compile boots
   *  its VM in ~3 s, so 15 s is pure dead-air detection.) */
  static async open(comp: XenonComputer): Promise<XenonWorkerRun | null> {
    if (!sabSupported()) return null;
    try {
      // 8192 B (v1.13.21 XENON-LOCALS): slots 0..139 are the v1.13.17 step
      // protocol (12.. + 2×64 breakpoint pairs), byte 80.. carries the hook's
      // locals-JSON handoff (~8 KB of payload room)
      const sab = new SharedArrayBuffer(8192);
      const worker = new Worker(new URL('./xenonworker.ts', import.meta.url), { type: 'module' });
      const r = new XenonWorkerRun(worker, sab);
      // ABSOLUTE URLs: a module worker resolves a RELATIVE dynamic import
      // against its OWN chunk dir — hand it the page-absolute form of the
      // ?url assets (v1.13.17 L4: the assets ride the module graph now)
      worker.postMessage({
        t: 'open',
        xcUrl: new URL(xcGlueUrl, location.href).href,
        xcWasmUrl: new URL(xcWasmUrl, location.href).href,
        sab, comp,
      });
      const d = await Promise.race([
        r.opened,
        new Promise<{ abi: number; error: string }>(res =>
          setTimeout(() => res({ abi: 0, error: 'worker open timeout — the VM worker never answered' }),
            XenonWorkerRun.OPEN_TIMEOUT_MS)),
      ]);
      if (d.abi < 7) {
        console.warn(`[xenon] worker shim ABI ${d.abi} < 7 — main-thread mode: ${d.error}`);
        r.dispose();
        return null;
      }
      r.running = !d.error;
      return r;
    } catch (ex) {
      console.warn('[xenon] worker open failed, main-thread mode:', ex);
      return null;
    }
  }
  private static readonly OPEN_TIMEOUT_MS = 15_000;

  abi() { return this.abi_; }
  setKeys(keys: Iterable<string>) { this.keys = [...keys]; }
  /** Hand ONE update to the worker (draining queued inputs/worldsim feeds). */
  cycle(): Promise<CycleData> {
    return new Promise(res => {
      this.cycleSet = res;
      this.worker.postMessage({ t: 'cycle', keys: this.keys, inputs: this.inputs, sync: this.syncQ, bputs: this.bputs });
      this.inputs = [];
      this.syncQ = [];
      this.bputs = [];
    });
  }
  setInput(io: number | string, ch: number, v: number) { this.inputs.push([io, ch, v]); }
  setInputT(alias: string, ch: number, text: string) { this.inputs.push([alias, ch, text]); }
  beaconPut(i: number, payload: string) { this.bputs.push([i, payload]); }
  worldsimSync(name: string, v: number) { this.syncQ.push([name, v]); }
  worldsimOverrides() { return this.lastOverrides; }
  screenClick(key: string, x: number, y: number) { this.worker.postMessage({ t: 'click', key, x, y }); }
  screenScroll(key: string, d: number) { this.worker.postMessage({ t: 'scroll', key, d }); }
  vars() { return this.lastVars; }
  sourceFiles(): string[] { return this.lastSourceFiles; }
  /** XENON-LOCALS: the paused frame the parked hook encoded on the SAB
   *  (see the handoff law at the top of XenonWorkerRun). Valid while
   *  PAUSED; read it from pollSab's paused-transition edge. */
  locals(): XenonLocal[] {
    const n = Atomics.load(this.i32, 19);
    if (n <= 0 || n > this.bytes.length - 80) return [];
    try {
      // TextDecoder refuses shared views ("must not be shared") — slice()
      // copies the payload into a PLAIN Uint8Array first
      return parseLocalsJson(new TextDecoder().decode(
        new Uint8Array(this.bytes.slice(80, 80 + n))));
    } catch { return []; }
  }
  cyclePairs() { return this.lastPairs; }
  cycleLines(): number[] { return []; }
  screenMeta() { return this.lastMetas; }
  screenPixels(key: string) { return this.lastPixels.get(key) ?? null; }
  parseLines(lines: [string, number][]): Promise<string[]> {
    return new Promise(res => {
      this.parseSet = res;
      this.worker.postMessage({ t: 'parse', lines });
    });
  }
  /** XENON-DEBUG v3 TRACKING GATE (workpackages WP6): the worker toggles the
   *  interpreter's per-line tracking; while OFF it also skips the pair +
   *  depth JSON entirely (the worker debugger is the hook — an untracked
   *  VM ships a bare '[]' per cycle, so an open IDE with no breakpoints
   *  costs the program NOTHING). */
  debugTrack(on: boolean) { this.worker.postMessage({ t: 'track', on }); }
  reboot(): Promise<boolean> {
    return new Promise(res => {
      this.rebootSet = res;
      this.worker.postMessage({ t: 'reboot' });
    });
  }
  stop() { this.running = false; }
  dispose() {
    try { this.worker.postMessage({ t: 'close' }); } catch { /* already gone */ }
    this.worker.terminate();
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

// ── THE STEPPER LAW (v1.13.17 L5): the ONE place the v1.13.16 pair-stream
// walk is expressed as a pure function, vitest-pinned
// (__tests__/xenoncode.test.ts 'THE STEPPER LAW'). THE SAME LAW LIVES IN
// TWO PLACES and must stay in lockstep:
//   • HERE — main-thread mode: applyCycle feeds the per-cycle (file·1e6+
//     line) pair stream (plus the parallel CALL-DEPTH stream, XENON-DEBUG
//     v3) through it after every completed cycle.
//   • tools/xenoncode/xc_host.cpp (the EM_JS xc_debug_hook) — worker mode:
//     evaluated AT EVERY EXECUTED LINE inside xc_cycle, over the SAB
//     protocol (ref pair at [5,6], runTo target at [9,10], bps at [11..],
//     the hook-internal paused-depth twin of st.pausedDepth); slot 19 =
//     the XENON-LOCALS handoff length, JSON bytes at offset 80.
// Any change to the stop conditions MUST be made in BOTH and re-pinned.
export interface StepperState {
  stepMode: 'off' | 'over' | 'into' | 'to';
  /** where the debugger last stopped (a 'fresh' pair is any pair ≠ it) */
  pausedFile: string; pausedLine: number;
  /** XENON-DEBUG v3: the CALL DEPTH at the pause — step-over stops at the
   *  first fresh pair of the paused file at depth <= this (a callee body
   *  sits at depth+1 and is stepped OVER; the return stops) */
  pausedDepth: number;
  /** runTo target (stepMode 'to') */
  toFile: string; toLine: number;
  /** the enclosing function body (legacy v1.13.16 scope-window law; the
   *  v1.13.28 classic law stopped using it — kept for the SAB slot 7/8
   *  protocol documentation) */
  scope: { file: string; line: number; end: number } | null;
}
export interface StepperHit {
  file: string; line: number; stepMode: StepperState['stepMode'];
  /** XENON-DEBUG v3: the pair's call depth (the next pause's reference) */
  depth: number;
}

export function stepperLaw(pairs: number[], depths: number[] | undefined,
  fileTable: string[], breaks: Map<string, Set<number>>, st: StepperState): StepperHit | null {
  if (!pairs.length || (st.stepMode === 'off' && !breaks.size)) return null;
  const dep = depths && depths.length === pairs.length ? depths : null;
  for (let k = 0; k < pairs.length; k++) {
    const p = pairs[k]!;
    const idx = Math.floor(p / 1000000);
    const file = fileTable[idx] ?? `#${idx}`;
    const line = p % 1000000;
    const depth = dep ? dep[k]! : 0;
    // breakpoints pause WITHOUT clearing the step mode (an armed F10
    // survives a breakpoint stop — the v1.13.16 stream walk)
    if (breaks.get(file)?.has(line)) return { file, line, stepMode: st.stepMode, depth };
    if (st.stepMode === 'to' && file === st.toFile && line === st.toLine)
      return { file, line, stepMode: 'off', depth };
    const fresh = !(file === st.pausedFile && line === st.pausedLine);
    if (st.stepMode === 'into' && fresh) return { file, line, stepMode: 'off', depth };
    if (st.stepMode === 'over' && fresh && file === st.pausedFile
        && depth <= (st.pausedDepth | 0)) {
      // v1.13.31 CLASSIC STEP-OVER DEEPENED (we: "When I press f10, it
      // steps into, not over a function"): the v1.13.28 file-only rule
      // landed inside SAME-FILE callees (the pair stream had no call
      // depth). XENON-DEBUG v3 carries the depth: stop at the first fresh
      // pair of the paused file at depth <= the paused depth — a callee
      // (depth+1) is stepped over, the frame's return (depth-1, same
      // file) resumes as a stop. xc_host.cpp's EM_JS hook carries the
      // TWIN (THE STEP LAW LIVES IN TWO PLACES).
      return { file, line, stepMode: 'off', depth };
    }
  }
  return null;
}

export class XenonPump {
  run: XenonRun | XenonWorkerRun | null = null;
  /** v1.13.17 TRUE LINE STEPPING: the VM runs on a worker (mid-cycle hook
   *  pauses); null = the v1.13.16 main-thread pump (no SAB context) */
  wrun: XenonWorkerRun | null = null;
  private inFlight = false;
  comp: XenonComputer | null = null;
  status: 'idle' | 'booting' | 'running' | 'stopped' | 'error' = 'idle';
  error = '';
  cycles = 0;
  bus = new Map<string, number | string>();          // 'io:port' -> last output
  reads = new Map<string, number>();                 // 'io:ch'  -> last input_number READ
  // ── BEACON RADIO (v1.14.1 slice D, FORMAT §HUD): the craft's Beacon
  // components by alias (an 'out' event onto one transmits) and the
  // program-side beacon() indices (beaconpair events). Deliveries from
  // beaconNet ride ch0 (input_text(port,0)) / beaconPut every cycle.
  private beaconDev = new Map<string, number>();
  private beaconCi = new Map<number, string>();
  private progBeacons = new Set<number>();
  // per-participant READ CURSORS into the beaconNet queues (slice C)
  private radioSeq = new Map<string, number>();
    // COALESCED BUS FAN-IN (v1.15.2, we: "the sound is slightly clickier in
  // super mario"): the slice-C loopback ran the alias→malloc→scan→free
  // marshal on EVERY 'out' event (the Cable Law feeds EVERY pump, the
  // writer included). Between cycles only the LAST value per channel can
  // reach the VM, so acceptBusWrite now records into this map (one Map.set)
  // and flushBus() injects it once per (channel, ch) at the next cycle
  // boundary — same values, same timing, ~1 wasm call per DEVICE CHANNEL
  // per cycle instead of per WRITE (the alias→port fast path lives in
  // XenonRun.aliasIo, mirroring the shim's g_devByAlias).
  private busPending = new Map<string, { alias: string | number; ch: number; v: number }>();
  vars = new Map<string, XenonVar>();                // '$name'  -> live global variable
  // XENON-LOCALS: the locals of the function owning the PAUSED line (the
  // Locals tab). Set at every pause: worker mode reads the hook's SAB
  // handoff in pollSab (the parked VM answers no messages — the hook is the
  // ONLY voice of a parked worker, and its read is truly mid-cycle); the
  // main-thread stepper reads the VM directly at pauseAt (cycle-granular,
  // the same honest limit its pair-stream walk has). Kept through resume —
  // the UI labels it 'last stop' while RUNNING.
  locals: XenonLocal[] = [];
  // ── debugger (XENON-DEBUG v2, ABI 6): F9 break · F10 step over · F11 step
  // into · F8 continue, plus Run-to-cursor. The interpreter streams
  // EXECUTION-ORDER (file,line) pairs; the pump walks that stream: a
  // breakpoint pauses AT the first executed pair (not "the cycle that
  // touched it"), F10 stops at the next executed LINE (leaving the current
  // function's body), F11 at the next pair anywhere. Cycle-granular stream
  // advance is the honest limit of the run-to-completion VM; the mid-cycle
  // worker+Atomics host shares the same interpreter seam (xc_debug_hook).
  paused = false;
  pausedLine = 0;                                    // where the debugger stopped
  pausedFile = '';
  /** XENON-DEBUG v3: the CALL DEPTH at the pause — the step-over twin
   *  (stepperLaw's pausedDepth); 0 while never paused in this boot */
  pausedDepth = 0;
  breaks = new Map<string, Set<number>>();           // file name -> 1-based lines
  stepMode: 'off' | 'over' | 'into' | 'to' = 'off';
  /** XENON-DEBUG v3 PARK ARM (workpackages WP7): the user has requested
   *  debugger control (⏸/⏹/F10/F11/run-to) — parks the VM at the EXACT
   *  executing line in BOTH pump modes (worker: the hook sleeps mid-cycle;
   *  main-thread: xc_pause_request + the DebugPause unwind). Sticky until
   *  resume/reboot/open; it is one of the inputs of the TRACKING GATE
   *  (syncDebugTrack), so a park request is always serviced. */
  parkArmed = false;
  /** the last debugTrack state sent to the VM (the gate posts on change) */
  private tracked: boolean | null = null;
  fileTable: string[] = [];                          // SOURCEFILE index -> name
  private projectFuncs: ReturnType<typeof projectFunctions> = [];
  private projectBlk: XCBlock[] = [];
  private toFile = '';
  private toLine = 0;
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

  /** Boot comp (closing any other computer's run). Resolves when the VM is
   *  up (status running/error). */
  async open(comp: XenonComputer): Promise<void> {
    if (this.run && this.comp?.ci === comp.ci
        && (this.status === 'running' || this.status === 'booting')) return;
    const seq = ++this.openSeq;
    this.stopLoop();
    this.sabResume();
    this.wrun?.dispose();
    this.wrun = null;
    this.inFlight = false;
    this.run?.stop();
    this.run = null;
    this.comp = comp;
    // FARM (slice C): co-running pumps share the craft io bus (the HUD
    // runtime co-runs too — every VM is its own module instance now)
    xenonFarm.attach(this);
    this.beaconDev = new Map(); this.beaconCi = new Map(); this.progBeacons = new Set();
    for (const d of comp.devices)
      if (d.type === 'Beacon' && d.alias && d.ci !== undefined) {
        this.beaconDev.set(d.alias.toLowerCase(), d.ci);
        this.beaconCi.set(d.ci, d.alias);
      }
    this.status = 'booting';
    this.error = '';
    this.cycles = 0;
    this.bus = new Map();
    this.reads = new Map();
    this.vars = new Map();
    this.locals = [];
    this.log = [];
    this.prints = [];
    this.surfaces = new Map();
    this.surfVer.clear();
    // v1.13.17: worker mode when SAB-isolated AND the shim carries the live
    // hook (abi >= 7); XenonWorkerRun.open returns null otherwise → the
    // v1.13.16 main-thread pump, byte-identical.
    // THE WASM-LOAD-FAILURE LAW (v1.16.5): a headless jsdom mount has no
    // wasm fetch path — the pump answers status 'error' (the IDE shows the
    // chip), it never leaves the boot's rejection unhandled.
    let wr: XenonWorkerRun | null; let run: XenonRun | XenonWorkerRun;
    try {
      wr = await XenonWorkerRun.open(comp);
      run = wr ?? await XenonRun.open(comp);
    }
    catch (e) {
      this.status = 'error'; this.error = String(e);
      xenonFarm.detach(this); return;
    }
    if (!wr) run = run as XenonRun;
    // SUPERSEDED-STALE-OPEN LAW (v1.13.18): a losing open (React StrictMode
    // fires the dialog's boot effect TWICE in dev → two workers boot
    // concurrently; the cold one answers LAST) must dispose its OWN run and
    // touch NOTHING shared. The old `this.wrun = wr` before the seq check
    // made the stale continuation null the WINNER's wrun: the pump kept the
    // VM running on the live worker while pump.wrun read null — the
    // debugger silently degraded to cycle-granular stepping (F10 = +1
    // cycle/step) and the UI lied about the mode (prod previews never
    // double-fire effects, so the e2e never saw it).
    if (seq !== this.openSeq) { run.stop(); wr?.dispose(); return; }
    this.wrun = wr;
    this.paused = false; this.pausedLine = 0; this.pausedFile = ''; this.stepMode = 'off';
    this.parkArmed = false; this.pausedDepth = 0; this.tracked = null;
    {
      const runFiles = comp.files.map((f, i) =>
        ({ name: i === 0 ? comp.entryName : f.name, code: f.code }));
      this.fileTable = includeOrder(runFiles, comp.entryName);
      this.projectFuncs = projectFunctions(runFiles);
      this.projectBlk = projectBlocks(runFiles);
    }
    this.run = run;
    // XENON-SOURCEPATHS (ABI 8): the VM's own SOURCEFILE table is the file
    // table of record — one index per (basename) name, in registration
    // order, the ONLY indices the pair stream / hook breakpoints /
    // DumpLocalsAt speak. The includeOrder name-list is a v1.13.16-era
    // GUESS and breaks every multi-file breakpoint (the PLANE proof:
    // functions.xc streams under the include, not under its name's guess).
    {
      const sf = run.sourceFiles();
      // The shim compiles the entry as /prog/main.xc (the XC convention),
      // so map that tag back to the disk's entry name — the map the tab
      // strip and the breakpoint state key files by.
      if (sf.length) this.fileTable = sf.map(n => n === 'main.xc' ? comp.entryName : n);
    }
    this.applyBreaks();   // the fresh worker's bp table starts empty (v1.13.27)
    if (run.error) { this.status = 'error'; this.error = run.error; }
    else {
      this.status = 'running';
      for (const c of comp.channels) run.setInput(c.io, c.ch, 0);
      // XENON-DEBUG v3 TRACKING GATE (workpackages WP6): the debugger's
      // per-line feed is armed ONLY while it has work (breakpoints, an
      // armed step, an armed park). An open IDE with none of those runs
      // the VM UNTRACKED — zero per-line cost, zero pair JSON (we: "if
      // the computer is not open and no breakpoints exist, this impact
      // shouldnt be there at all").
      this.syncDebugTrack();
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
    xenonFarm.detach(this);   // FARM (slice C): off the shared bus
    this.sabResume();          // a hooked worker must wake before it dies
    this.wrun?.dispose();
    this.wrun = null;
    this.inFlight = false;
    this.run?.stop();
    this.run = null;
    this.comp = null;
    this.status = 'idle';
    this.cycles = 0;           // v1.13.25: cycles count the CURRENT boot —
                               // a CLOSED pump shows 0, not a frozen ghost
                               // (the F5-run probes read the counter across
                               // sessions and a stale value lies)
    this.surfaces = new Map();
    this.surfVer.clear();
    this.wsBindings = new Map();
    this.wsOverrides = {};
    this.pilotBindings = new Map();
    this.paused = false; this.pausedLine = 0; this.pausedFile = ''; this.stepMode = 'off';
    this.parkArmed = false; this.pausedDepth = 0; this.tracked = null;
    this.breaks = new Map();
    this.locals = [];
    this.notify();
  }

  /** XENON-DEBUG v3 TRACKING GATE (workpackages WP6): the interpreter's
   *  per-line tracking runs ONLY while the debugger has work — a break
   *  table, an armed step mode, or an armed park. Posted on change. */
  private syncDebugTrack() {
    const want = this.breaks.size > 0 || this.stepMode !== 'off' || this.parkArmed;
    if (want === this.tracked) return;
    this.tracked = want;
    this.run?.debugTrack(want);
  }

  stopRunning() {
    // XENON-DEBUG v3 STOP = PARK (workpackages WP7, we: "When I press f6
    // it should mean stop … I want the code to stop on the precise line
    // being executed … and I want to then be able to edit values"): arm
    // the exact-line park (both modes), THEN mark the run stopped. The
    // pump parks at the park site (paused ⇒ the writeback moment); the
    // ON indicator flips OFF with the status. ▶/F8 resumes.
    if (this.status === 'running') this.pause();
    this.status = 'stopped';
    this.notify();
  }
  /** Breakpoints keyed BY FILE (XENON-DEBUG v2): breaks in inactive tabs
   *  fire too — the pair stream is file-qualified. */
  setBreaksMap(map: Record<string, Iterable<number>>) {
    this.breaks = new Map(Object.entries(map)
      .map(([f, s]) => [f, s instanceof Set ? s : new Set(s)] as const)
      .filter(([, s]) => s.size > 0));
    this.applyBreaks();
    this.syncDebugTrack();          // XENON-DEBUG v3: breaks arm tracking
    this.notify();
  }
  /** Mirror the break set into the worker's shared bp table (file idx,
   *  line pairs at i32[12+], count at i32[11]) — the hook checks it per
   *  line. MUST run after every open(): a re-boot (save ⇒ reload ⇒ open)
   *  builds a NEW worker whose table starts empty, and the game rule is
   *  that the re-boot resets the computer's state but KEEPS the
   *  breakpoints (v1.13.27, we: "That should reset the computers state,
   *  but keep breakpoints" — the leg caught the empty-table hole) */
  private applyBreaks() {
    const i = this.i32;
    if (i) {
      let n = 0;
      for (const [f, lines] of this.breaks) {
        const fi = this.fileTable.indexOf(f);
        if (fi < 0) continue;
        for (const l of lines) {
          if (n >= 64) break;
          i[12 + 2 * n] = fi; i[13 + 2 * n] = l;
          n++;
        }
      }
      Atomics.store(i, 11, n);
    }
  }
  breaksOf(file: string): Set<number> { return this.breaks.get(file) ?? new Set(); }

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
  /** THE SHARED BUS FAN-IN (v1.15.0 slice C): a SISTER computer wrote
   *  this device's channel — drive it straight into my VM (the game law:
   *  the channel is the device's, and every computer wired to it reads
   *  the same value). Alias-keyed writes resolve in the shim; devices
   *  this computer is not wired to are ignored there. */
  /** v1.15.6: resolve a program-side io token (number port or alias string)
   *  to THIS computer's device table — the component the channel belongs
   *  to. null = no device (a plain screen channel, an unwired port). */
  deviceFor(io: string | number | undefined): { ci: number; type: string } | null {
    if (io === undefined || !this.comp) return null;
    const s = String(io);
    const n = Number(s);
    for (const d of this.comp.devices)
      if ((Number.isFinite(n) && d.io === n) || (d.alias && d.alias === s))
        return d.ci !== undefined ? { ci: d.ci, type: d.type } : null;
    return null;
  }
  acceptBusWrite(alias: string | number, ch: number, v: number): void {
    // COALESCED v1.15.2 (we: "the sound is slightly clickier in super
    // mario"): between cycles the VM samples inputs ONCE, so only the LAST
    // value per channel is observable — record (one Map.set) and let
    // flushBus() inject it at the next cycle boundary. The slice-C per-
    // event marshal (alias→TextEncoder→malloc→scan→free on EVERY 'out'
    // event, the writer's loopback included) was the farm hot-loop cost.
    this.busPending.set(`${String(alias).toLowerCase()}:${ch}`, { alias, ch, v });
  }
  /** Inject the coalesced bus fan-in into the VM, one setInput per
   *  (channel, ch) — called at every cycle boundary, both pump modes. */
  private flushBus(): void {
    if (!this.busPending.size) return;
    const run = this.run;
    const pend = [...this.busPending.values()];
    this.busPending.clear();
    if (!run) return;
    for (const w of pend) run.setInput(w.alias, w.ch, w.v);
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
  private stepWorldSim(run: XenonRun | XenonWorkerRun) {
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

  /** BEACON RADIO feed (v1.14.1 slice D): drain beaconNet deliveries and
   *  push them into the VM before the cycle — component beacons get the
   *  payload on ch0 (input_text(port,0) — the RCS500's read law), program
   *  beacon() objects get it as .data. Latest delivery wins per cycle. */
  private stepRadio(run: XenonRun | XenonWorkerRun) {
    if (this.beaconCi.size || this.progBeacons.size) {
      for (const [ci, alias] of this.beaconCi) {
        const id = `beacon:${ci}`;
        // CURSOR READ (slice C): a beacon wired to several computers
        // feeds each pump independently — every computer hears it.
        const { items, seq } = beaconNet.pendingSince(id, this.radioSeq.get(id) ?? 0);
        if (items.length) {
          this.radioSeq.set(id, seq);
          run.setInputT(alias, 0, items[items.length - 1]!);
        }
      }
      const pci = this.comp?.ci ?? -1;
      for (const i of this.progBeacons) {
        const id = `computer:${pci}#${i}`;
        const { items, seq } = beaconNet.pendingSince(id, this.radioSeq.get(id) ?? 0);
        if (items.length) {
          this.radioSeq.set(id, seq);
          run.beaconPut(i, items[items.length - 1]!);
        }
      }
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
  // ── THE SHARED PROTOCOL (worker mode, v1.13.17): commands are ATOMIC
  // writes the interpreter's EM_JS hook (xc_host.cpp) checks at every
  // executed line — the SAME laws the pair walk in cycleOnce applies to
  // the stream, evaluated MID-CYCLE. pollSab mirrors the worker's state
  // (paused / file / line) into the fields the UI reads.
  private fileIdx(name: string): number {
    const i = this.fileTable.indexOf(name);
    return i < 0 ? 0 : i;
  }
  private get i32(): Int32Array | null { return this.wrun?.i32 ?? null; }
  private sabCmd(c: number) {
    const i = this.i32;
    if (i) { Atomics.store(i, 0, c); Atomics.notify(i, 0); }
  }
  /** Clear a sleeping hook — ALWAYS before dispose/terminate: a worker
   *  parked in Atomics.wait cannot process its own termination. */
  private sabResume() {
    const i = this.i32;
    if (i) { Atomics.store(i, 0, 4); Atomics.notify(i, 0); }
  }
  private pollSab(): void {
    const i = this.i32;
    if (!i) return;
    const p = Atomics.load(i, 1) === 1;
    if (p === this.paused) return;
    this.paused = p;
    if (p) {
      const f = Atomics.load(i, 2);
      this.pausedFile = this.fileTable[f] ?? `#${f}`;
      this.pausedLine = Atomics.load(i, 3);
      this.stepMode = 'off';
      // XENON-LOCALS: the hook encoded the paused frame BEFORE it signalled
      // PAUSED, so reading AFTER the acquire load of slot 1 sees it complete
      this.locals = this.wrun ? this.wrun.locals().filter(varVisible) : [];
    }
    this.notify();
  }
  /** ⏸ PAUSE (workpackages WP7): park on the EXACT executing line, no
   *  breakpoint needed. Worker mode: cmd 5 — the hook sleeps mid-cycle at
   *  the next executed line, the C++ stack intact. Main-thread mode: the
   *  v3 xc_pause_request seam — the next executed LINENUMBER unwinds
   *  xc_cycle (exact line, Computer alive, values editable). The pump
   *  mirrors the park site (pausedFile/pausedLine) + reads the frame. */
  pause() {
    if (this.status !== 'running') return;
    this.parkArmed = true;
    this.syncDebugTrack();          // a park request arms the tracking gate
    if (this.wrun) { this.sabCmd(5); return; }   // stop at the NEXT line
    if (this.run instanceof XenonRun) this.run.requestPause();
    this.notify();
  }
  resume() {
    if (this.wrun) this.sabResume();
    if (this.run instanceof XenonRun) this.run.pauseCancel();
    this.paused = false;
    this.stepMode = 'off';
    this.parkArmed = false;
    if (this.status === 'stopped') this.status = 'running';   // ▶/F8 from ⏹
    this.syncDebugTrack();
    this.notify();
  }
  /** F10: stop at the next executed LINE at the CURRENT call depth — a
   *  call (in-file or not) is stepped OVER (XENON-DEBUG v3 depth twin). */
  stepOver() {
    if (this.wrun) {
      const i = this.i32;
      if (!i) return;
      const fn = functionAt(this.projectFuncs, this.pausedFile, this.pausedLine);
      i[5] = this.fileIdx(this.pausedFile); i[6] = this.pausedLine;
      if (fn) { i[7] = fn.line; i[8] = fn.end === Infinity ? 1e9 : fn.end; }
      else { i[7] = 1; i[8] = 0; }                    // top level: ANY new line
      this.paused = false;
      this.parkArmed = true;
      this.status = 'running';
      this.syncDebugTrack();
      Atomics.store(i, 0, 1);
      Atomics.notify(i, 0);
      this.notify();
      return;
    }
    this.beginStep('over');
  }
  /** F11: stop at the next executed pair anywhere — steps INTO @calls. */
  stepInto() {
    if (this.wrun) {
      const i = this.i32;
      if (!i) return;
      i[5] = this.fileIdx(this.pausedFile); i[6] = this.pausedLine;
      this.paused = false;
      this.parkArmed = true;
      this.status = 'running';
      this.syncDebugTrack();
      Atomics.store(i, 0, 2);
      Atomics.notify(i, 0);
      this.notify();
      return;
    }
    this.beginStep('into');
  }
  /** Context menu ▸ Run to Cursor: pause when (file,line) executes. */
  runTo(file: string, line: number) {
    this.toFile = file;
    this.toLine = line;
    if (this.wrun) {
      const i = this.i32;
      if (!i) return;
      i[9] = this.fileIdx(file); i[10] = line;
      this.paused = false;
      this.parkArmed = true;
      this.status = 'running';
      this.syncDebugTrack();
      Atomics.store(i, 0, 3);
      Atomics.notify(i, 0);
      this.notify();
      return;
    }
    this.beginStep('to');
  }
  private beginStep(mode: 'over' | 'into' | 'to') {
    if (!this.run || (this.status !== 'running' && this.status !== 'stopped')) return;
    this.stepMode = mode;
    this.paused = false;
    this.parkArmed = true;
    this.syncDebugTrack();          // an armed step keeps tracking on
    this.startRunning();
  }
  private pauseAt(file: string, line: number, depth = 0) {
    this.paused = true; this.pausedFile = file; this.pausedLine = line;
    this.pausedDepth = depth;
    // XENON-LOCALS (main-thread mode): the VM lives on this thread, read it
    // directly — cycle-granular like the pair-stream walk (the worker hook
    // above is the mid-cycle truth)
    this.locals = this.run instanceof XenonRun
      ? this.run.locals(this.fileIdx(file), line).filter(varVisible) : [];
  }
  /** The function whose body owns the paused line (the SAME project-model
   *  functionAt the step-over scope uses — one frame law for the debugger);
   *  a global-scope block (update/tick/timer/input) labels by its keyword
   *  (v1.13.24: a break in an `update` body IS a frame with locals — the
   *  VM compiles it as a named entry-point body);
   *  null = a plain top-level line (its variables are globals: Vars). */
  localsFrame(): string | null {
    const fn = functionAt(this.projectFuncs, this.pausedFile, this.pausedLine);
    if (fn) return `@${fn.name}`;
    const b = blockAt(this.projectBlk, this.pausedFile, this.pausedLine);
    return b ? b.label : null;
  }
  /** '$name' hover value: a LOCAL wins while paused (the frame shadows the
   *  global, the debugger's lookup), globals serve while running. */
  varValue(name: string): XenonVar | XenonLocal | undefined {
    const k = name.replace(/^\$/, '');
    if (this.paused) {
      const l = this.locals.find(v => v.name === k);
      if (l) return l;
    }
    return this.vars.get(k) ?? this.vars.get(name);
  }
  /** XENON-WRITEBACK: edit one variable's value and INJECT it into the
   *  running program's RAM. Locals resolve through the paused frame (a
   *  local shadows a global, the language's own lookup); globals through
   *  the globals table. WORKER MODE: only while PAUSED — a parked VM
   *  accepts writes through the hook thread alone, so the write rides the
   *  SAB as cmd 6 and the ack comes back the same way (the VM stays
   *  parked). Main-thread mode: a direct call (same thread = safe).
   *  Validation is Computer::WriteVarAt's (numbers: finite decimal,
   *  true/false; text: everything; storage/array/object refuse). On
   *  success the displayed row updates at once. */
  async writeVar(name: string, t: number, v: string,
    scope: 'locals' | 'globals'): Promise<WriteAck> {
    if (!this.run) return { ok: false, error: 'no running program' };
    const loc = scope === 'locals';
    const file = loc || this.wrun ? this.pausedFile : '';
    const line = loc || this.wrun ? this.pausedLine : 0;
    const fi = this.fileIdx(file);
    let r: WriteAck;
    if (this.wrun) {
      if (!this.paused)
        return { ok: false, error: 'pause the debugger first (F9 break / ⏸) — a RUNNING worker has no writable moment' };
      r = await this.sabWrite(fi, line, name, t, v);
    } else {
      r = this.run instanceof XenonRun
        ? this.run.writeVar(fi, line, name, t, v)
        : { ok: false, error: 'writer unavailable' };
    }
    if (r.ok) {
      if (loc) {
        const row = this.locals.find(x => x.name === name);
        if (row) row.v = v;
      } else {
        const g = this.vars.get(name);
        if (g) g.v = v;
      }
      this.notify();
    }
    return r;
  }
  /** The cmd-6 round-trip (see writeVar): payload at BYTE 128 (slot 18 =
   *  length), cmd 6 + notify, ack flag slot 20, ack JSON at byte 128.
   *  THE 128 LAW: slot 20 owns bytes 80..83 — a payload window must start
   *  above every slot (the first version queued at byte 80 and the
   *  store(i,20,0) zeroed the payload's head: JSON.parse refused it, the
   *  probe showed NULs over '{"fi'). Byte 128 = slot 32: clean. */
  private sabWrite(fi: number, line: number, name: string, t: number, v: string): Promise<WriteAck> {
    const w = this.wrun;
    if (!w) return Promise.resolve({ ok: false, error: 'no worker' });
    const enc = new TextEncoder().encode(JSON.stringify({ file: fi, line, name, t, v }));
    const i = w.i32, b = w.bytes;
    if (enc.length > b.length - 128) return Promise.resolve({ ok: false, error: 'payload too large' });
    b.set(enc, 128);
    Atomics.store(i, 20, 0);
    Atomics.store(i, 18, enc.length);
    Atomics.store(i, 0, 6);
    Atomics.notify(i, 0);
    return new Promise(res => {
      const t0 = performance.now();
      const poll = () => {
        if (Atomics.load(i, 20) === 1) {
          const n = Atomics.load(i, 18) | 0;
          let ack: WriteAck = { ok: false, error: 'empty writer answer' };
          if (n > 0 && n <= b.length - 128) {
            try {
              ack = parseWriteAck(new TextDecoder().decode(new Uint8Array(b.slice(128, 128 + n))));
            } catch { ack = { ok: false, error: 'bad writer answer' }; }
          }
          Atomics.store(i, 20, 0);
          return res(ack);
        }
        if (performance.now() - t0 > 4000)
          return res({ ok: false, error: 'writer timeout — the worker did not answer' });
        setTimeout(poll, 15);
      };
      poll();
    });
  }
  startRunning() {
    if (!this.run) return;
    // v1.13.31 (workpackages WP7): START cancels a park IN FLIGHT. The
    // toolbar's ▶ reads pump.paused — while a ⏸/⏹ park request is armed
    // but the worker has not reached its stop line yet, paused is still
    // false; without the cancel the park lands AFTER the start and the
    // breakpoint-follow yanks the editor tab mid-typing. Same law in
    // main-thread mode: the xc_pause_request latch is cancelled.
    // v1.13.31 fix2: the worker SAB cancel is CONDITIONAL — an armed
    // run-to/step command (cmd 1/2/3, set by pump.runTo before a
    // startRunning, the debug console's goto) is a deliberate stop and
    // survives the start; only the park request (cmd 5) is cancelled.
    {
      const i = this.i32;
      const cmd = i ? Atomics.load(i, 0) : 0;
      if (!i || cmd === 5 || cmd === 4 || cmd === 0) this.sabResume();
    }
    if (this.run instanceof XenonRun) this.run.pauseCancel();
    this.paused = false;
    this.run.running = true;
    this.status = 'running';
    this.parkArmed = false;
    this.startLoop();
    this.syncDebugTrack();
    this.notify();
  }
  reboot() {
    const r = this.run;
    if (!r) return;
    if (this.wrun) {
      // Files changed on disk → the game auto-reboots. WAKE a sleeping hook
      // first: a reboot message queued behind a parked worker would hang.
      this.sabResume();
      const w = this.wrun;
      void w.reboot().then(ok => {
        if (this.wrun !== w) return;                 // superseded by a new open
        if (ok) {
          this.status = 'running'; this.log = []; this.prints = []; this.bus = new Map();
          this.cycles = 0;      // v1.13.25: cycles count THIS boot (the game's
                                // menu-bar counter restarts on a re-boot — the
                                // F5-RUN law makes the rewind user-visible)
          this.paused = false; this.pausedLine = 0; this.pausedFile = ''; this.stepMode = 'off';
          this.parkArmed = false; this.pausedDepth = 0; this.tracked = null;
          this.syncDebugTrack();   // v3: a boot clears the recorder — re-arm the gate
          this.startLoop();
        } else { this.status = 'error'; this.error = w.error; }
        this.notify();
      });
      this.notify();
      return;
    }
    if (r.reboot()) {
      this.status = 'running'; this.log = []; this.prints = []; this.bus = new Map();
      this.cycles = 0;          // cycles count THIS boot (see the worker branch)
      this.paused = false; this.pausedLine = 0; this.pausedFile = ''; this.stepMode = 'off';
      this.parkArmed = false; this.pausedDepth = 0; this.tracked = null;
      this.syncDebugTrack();    // v3: a boot clears the recorder — re-arm the gate
      this.startLoop();
    }
    else { this.status = 'error'; this.error = r.error; }
    this.notify();
  }
  screenClick(key: string, x: number, y: number) { (this.wrun ?? this.run)?.screenClick(key.toLowerCase(), x, y); }
  screenScroll(key: string, d: number) { (this.wrun ?? this.run)?.screenScroll(key.toLowerCase(), d); }

  /** Which surface keys the 3-D scene is rendering on craft dashboards. */
  setFeedKeys(keys: Iterable<string>) { this.feedKeys = new Set(keys); }
  /** debug channel: the rAF handle (0 = the loop is not running) */
  raf2(): number { return this.timer; }

  /** ABI 15 XENON-SCREEN-VERSION: the last write-counter fetched per surface
   *  key. A surface whose counter has NOT moved keeps its cached pixels
   *  (applyCycle keeps the previous array when the fetch hands it null) —
   *  no heap copy, no ImageData, no canvas upload. The Badger census
   *  (xenonvm.perf.test.ts): 0.2 of 117 surfaces change per cycle. Version
   *  -1 (older wasm, no export) fetches EVERY cycle — the pre-v1.16.8 law,
   *  the typeof-guard degradation rule. Cleared on every open (a new VM's
   *  counters restart at 0; the cache must die with the old one). */
  private surfVer = new Map<string, number>();
  private fetchVersioned(key: string, r: XenonRun): Uint8ClampedArray | null {
    const v = r.screenVersion(key);
    if (v >= 0 && this.surfVer.get(key) === v && this.surfaces.get(key)?.pixels) return null;
    const px = r.screenPixels(key);
    if (px) this.surfVer.set(key, v);
    return px;
  }

  private cycleN = 0;
  registerCanvas(key: string, cv: HTMLCanvasElement, fill = false): () => void {
    const k = key.toLowerCase();
    let s = this.canvases.get(k);
    if (!s) { s = new Set(); this.canvases.set(k, s); }
    s.add(cv);
    (cv as { __fill?: boolean }).__fill = fill;   // fill = a zoom window: full cadence
    const surf = this.surfaces.get(k);
    if (surf?.pixels) this.blit(cv, surf);
    return () => { this.canvases.get(k)?.delete(cv); };
  }
  /** BLIT GATE (v1.13.11): a fullscreen zoom window + every dock thumbnail
   *  blitting 640×480 EVERY 25 Hz cycle saturated the main thread; the pump
   *  timer (which also drives the buzzer mixer) got starved, and Space
   *  Invaders' short beeps fell between the late samples ("doesnt always
   *  play sound unless I minimize its screen"). Hidden canvases are skipped
   *  outright; thumbnails blit at ~8 Hz; a fill (zoom) canvas keeps 25 Hz. */
  private blitTo(key: string, s: XenonSurface): void {
    for (const cv of this.canvases.get(key) ?? []) {
      if (!cv.isConnected || !cv.getClientRects().length) continue;
      if (!(cv as { __fill?: boolean }).__fill && this.cycleN % 3) continue;
      this.blit(cv, s);
    }
  }
  /** WRITE-TIME BUZZER TRIGGER (v1.13.14, we: "THAT DOES NOT PLAY AUDIO
   *  UNTIL I MINIMIZE THE in-editor SCREEN YOU MAXIIMZE"): the instant the
   *  VM writes a Buzzer's Amplitude (ch 0), schedule the beep on the audio
   *  clock (buzzerAudio.beep). Sound then depends on the WRITE — which the
   *  VM produces every cycle no matter how starved the main-thread sample
   *  loop is — not on a SAMPLE catching the amp while it is still up. The
   *  maximized zoom window's canvas load starved exactly that sampling. */
  private buzzerWrite(io: string | number, port: number | undefined, v: number | string | undefined): void {
    const amp = Number(v) || 0;
    if (amp <= 0 || Number(port) !== 0) return;
    const dev = this.comp?.devices.find(d => d.type === 'Buzzer'
      && (String(d.io) === String(io) || (!!d.alias && d.alias === String(io))));
    if (!dev) return;
    const fr = Number(this.bus.get(`${io}:1`)) || 0;
    buzzerAudio.beep(dev.alias || `io ${dev.io}`, amp,
      fr > 0 ? Math.min(20000, fr) : 440,
      modeToWave(typeof dev.mode === 'number' ? dev.mode : 1));
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
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    // the ImageData is REUSED per canvas while the size holds (v1.16.8):
    // the 25 Hz blit path allocated a fresh 1.4 MB ImageData per surface
    // per cycle; putImageData only READS the array, so one per canvas is
    // the whole law. (Blits now arrive only for CHANGED surfaces, ABI 15.)
    let e = this.blitCache.get(cv);
    if (!e || e.img.width !== s.w || e.img.height !== s.h) {
      e = { img: ctx.createImageData(s.w, s.h) };
      this.blitCache.set(cv, e);
    }
    e.img.data.set(s.pixels as Uint8ClampedArray<ArrayBuffer>);
    ctx.putImageData(e.img, 0, 0);
  }
  private blitCache = new WeakMap<HTMLCanvasElement, { img: ImageData }>();
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
   *  MAIN-THREAD MODE runs the VM inline (v1.13.16, the pair-stream
   *  stepper). WORKER MODE (v1.13.17) hands one update to the worker and
   *  returns; the response — which arrives only when the VM cycle has
   *  TRULY finished, i.e. never while the hook sleeps mid-update — drives
   *  applyCycle. Every pump tick while the worker is parked is a no-op
   *  (inFlight stays set), and the UI keeps painting. */
  private cycleOnce(t: number, force = false): void {
    const run = this.run;
    if (!run || !run.running) return;
    this.cycleN++;
    // XenonTest gate: runCycles() owns the VM while a test advances it
    // (force = the test's OWN cycles get through their own gate)
    if (this.testGate && !force) return;
    const wr = this.wrun;
    if (wr) {
      this.pollSab();
      if (this.inFlight || this.paused) return;
      this.inFlight = true;
      this.flushBus();          // coalesced Cable Law fan-in (v1.15.2)
      wr.setKeys([...this.canvases.keys(), ...this.feedKeys]);
      const t0 = typeof performance !== 'undefined' ? performance.now() : t;
      this.stepWorldSim(wr);
      this.stepRadio(wr);
      wr.cycle().then(d => {
        this.inFlight = false;
        if (this.wrun !== wr) return;              // superseded by a newer open
        try { this.wsOverrides = JSON.parse(d.overrides); } catch { /* keep */ }
        this.applyCycle(t0, d.evs, parseVarsJson(d.vars), d.metas,
          k => { const b = d.pixels[k]; return b ? new Uint8ClampedArray(b) : null; },
          undefined, d.error);
        this.pollSab();
      }).catch(() => { this.inFlight = false; });
      return;
    }
    // debugger gate: while PAUSED the pump runs cycles only for a step
    if (this.paused) return;
    const r = run as XenonRun;                  // main-thread mode (wrun null)
    this.flushBus();          // coalesced Cable Law fan-in (v1.15.2)
    this.stepWorldSim(r);
    this.stepRadio(r);
    const step = r.cycle();
    this.applyCycle(t, step.evs, r.vars(), r.screenMeta(),
      k => this.fetchVersioned(k, r), r.cyclePairs(), r.error, r.cycleDepths());
    // XENON-DEBUG v3 EXACT-LINE PARK (workpackages WP7): the armed pause
    // unwound this cycle at its executing line — mirror the park site
    // (beats a stepper bp-hit earlier in the stream: the VM STATE is HERE)
    if (step.pausedAt) {
      const idx = step.pausedAt.idx;
      this.pauseAt(this.fileTable[idx] ?? `#${idx}`, step.pausedAt.line);
      this.notify();
    }
  }

  /** Consume ONE finished update: events → io bus/buzzers → the
   *  XENON-DEBUG pair-stream walk (main-thread mode only — worker mode
   *  passes no pairs: the hook IS the debugger there) → vars → surfaces
   *  and blits → cycle hooks → audio. Shared by both pump modes and by
   *  XenonTest's runCycles. */
  private applyCycle(t: number, evs: XenonEvent[], varsArr: XenonVar[],
    metas: { key: string; w: number; h: number }[],
    pixelsFor: (key: string) => Uint8ClampedArray | null,
    pairs?: number[], runError?: string, depths?: number[]): void {
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
          this.buzzerWrite(e.io ?? '', e.port, e.v);
          // BEACON RADIO (slice D): output_text onto a Beacon component is
          // a TRANSMISSION on its frequency (FORMAT §HUD)
          const bei = this.beaconDev.get(String(e.io ?? '').toLowerCase());
          if (bei !== undefined) beaconNet.postDevice(bei, String(e.v ?? ''));
          // THE SHARED IO BUS (slice C): the channel value is the DEVICE's
          // — drive the same channel into every OTHER pump wired to this
          // device, so sibling computers' input_number sees my output.
          // v1.15.6: resolve the writer's io/alias to its XCDevice — the
          // resolved component identity rides to the actuator tap (the
          // scene animates the actual part this channel belongs to).
          xenonFarm.bus.write(String(e.io ?? ''), Number(e.port ?? 0),
            typeof e.v === 'string' ? e.v : Number(e.v ?? 0), this,
            this.deviceFor(e.io));
        }
        else if (e.e === 'in') this.reads.set(`${e.io}:${e.port}`, Number(e.v) || 0);
        // ABI 11: the VM announces a program beacon() and its transmits —
        // the global BEACONS tab sees the program's radio LIVE (id-merged
        // with the source-scan seed), and its tx reaches every listener.
        else if (e.e === 'beaconpair' && typeof e.i === 'number') {
          const ci = this.comp?.ci ?? -1;
          this.progBeacons.add(e.i);
          beaconNet.registerPair(`computer:${ci}#${e.i}`,
            `Program ${this.comp?.alias || 'computer'} · beacon`, 'computer',
            ci, String(e.tx ?? ''), String(e.rx ?? ''));
        }
        else if (e.e === 'beacontx' && typeof e.i === 'number')
          beaconNet.post(`computer:${this.comp?.ci ?? -1}#${e.i}`, String(e.d ?? ''));
      }
    }
    this.cycles++;
    // XENON-DEBUG v2: walk the EXECUTION-ORDER (file,line) stream through
    // THE STEPPER LAW (see the law's cross-reference note at stepperLaw).
    // XenonTest gate cycles never touch the debugger (deterministic asserts).
    if (!this.testGate && pairs) {
      const scope = this.stepMode === 'over'
        ? functionAt(this.projectFuncs, this.pausedFile, this.pausedLine) : null;
      const hit = stepperLaw(pairs, depths, this.fileTable, this.breaks, {
        stepMode: this.stepMode,
        pausedFile: this.pausedFile, pausedLine: this.pausedLine,
        pausedDepth: this.pausedDepth,
        toFile: this.toFile, toLine: this.toLine,
        scope: scope ? { file: scope.file, line: scope.line, end: scope.end } : null,
      });
      if (hit) { this.stepMode = hit.stepMode; this.pauseAt(hit.file, hit.line, hit.depth); }
    }
    this.vars = new Map(varsArr.filter(varVisible).map(v => [v.name, v]));
    if (runError) {
      this.status = 'error';
      this.error = runError;
      this.notify();
      return;
    }
    // surfaces: ALL keys each tick; pixels only for keys a canvas (this
    // panel) or a 3-D dashboard feed actually shows
    const want = new Set<string>([...this.canvases.keys(), ...this.feedKeys]);
    // THE PLAIN TARGET FEEDS ITS DEVICE SCREEN (v1.16.9, we: "when I open
    // space invaders, the computer's screen never updates unless I open the
    // xenoncode screens at least once before"): a Computer's program draws
    // on the plain target (main#0), while the canvas/3-D face asks under
    // the deviceScreen key — the mirror below can only share what was
    // FETCHED, so the mirror key's demand pulls main#0 into the want-set
    // (ABI-15 version-gated: fetched only when the game repaints).
    for (const sc of this.comp?.screens ?? [])
      if (sc.deviceScreen && want.has(`${slug(sc.alias)}#${sc.channel}`)) want.add('main#0');
    const next = new Map<string, XenonSurface>();
    const fetched = new Set<string>();        // surfaces FETCHED this cycle
    for (const meta of metas) {
      let pixels = this.surfaces.get(meta.key)?.pixels;
      if (want.has(meta.key)) {
        const got = pixelsFor(meta.key);
        if (got) {
          pixels = got;
          fetched.add(meta.key);
          this.blitTo(meta.key, { ...meta, pixels: got });
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
          // ABI 15: the mirror rides main#0's pixels — upload only when
          // main#0 was FETCHED this cycle (unchanged = the canvas already
          // shows exactly these bytes)
          if (mir.pixels && fetched.has('main#0')) this.blitTo(mk, mir);
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
  runCycles(n: number): void | Promise<void> {
    if (!this.run?.running) return;
    const wr = this.wrun;
    if (wr) {
      // worker mode: chain n updates (the pump timer stays testGate'd; the
      // hook is free-run for the batch — asserts see the END state, the
      // deterministic XenonTest phase)
      this.testGate = true;
      const seq = this.openSeq;
      const step = (i: number): Promise<void> =>
        i >= n || this.openSeq !== seq ? Promise.resolve()
          : (this.flushBus(), this.stepWorldSim(wr), this.stepRadio(wr),
             wr.cycle().then(d => {
               if (this.wrun === wr && this.openSeq === seq) {
                 try { this.wsOverrides = JSON.parse(d.overrides); } catch { /* keep */ }
                 this.applyCycle(0, d.evs, parseVarsJson(d.vars), d.metas,
                   k => { const b = d.pixels[k]; return b ? new Uint8ClampedArray(b) : null; },
                   undefined, d.error);
               }
               return step(i + 1);
             }));
      return step(0).then(() => { this.testGate = false; this.notify(); });
    }
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
/** The shim ABI the app expects (xc_host.cpp xc_abi()). Bump with the shim.
 *  12 = xc_hud_mode + the ONE screen_w/screen_h declaration (the v1.14.1
 *  duplicate OVERRODE the computer law — Space Invaders layout clobber). */
/** 15 = xc_screen_version (XENON-SCREEN-VERSION write counter — the pump
 *  fetches + blits a surface only when its pixels MOVED; the Badger census
 *  measures 0.2 changing surfaces per cycle of 117);
 *  14 = xc_screen_px/py/haspos (the composited HUD SCREEN window);
 *  13 = $panel.set_size(w,h) + width/height getters (ABI 13; wiki hud.md law). */
export const XC_ABI = 15;

// ---------------------------------------------------------------------------
// COMPUTERFARM — the craft's co-running pumps + the SHARED io bus
// (v1.15.0 P9 slice C; the ChipOS ground).
// THE GAME LAW: io belongs to the DEVICE, not to the computer — every
// computer wired to the same device shares its channel values. The IoBus
// holds that channel state and fans one pump's 'out' writes into every
// other attached pump (acceptBusWrite). Since slice C every XenonRun
// carries its OWN wasm instance (xenonInstantiate), so pumps co-run —
// replacing runtimemgr's one-interpreter mutual kill (retired). beaconNet
// is global already: a component beacon's per-ci participant feeds EVERY
// wired pump independently (per-pump radioSeq cursors), which is the
// intercomputer radio the RCS500 demo runs on.
export class IoBus {
  private values = new Map<string, number | string>();
  private pumps = new Set<XenonPump>();
  /** v1.15.6 THE ACTUATOR TAP: (device ci, type, ch, value) of every bus
   *  write, for the craft sim (engine/devicesim.ts) — the io bus finally
   *  knows WHICH part a channel belongs to, not just its alias string. */
  private watchers = new Set<(ci: number, type: string, ch: number, v: number) => void>();
  observeDevices(cb: (ci: number, type: string, ch: number, v: number) => void): () => void {
    this.watchers.add(cb);
    return () => { this.watchers.delete(cb); };
  }
  private key(alias: string | number, ch: number): string {
    return `${String(alias).toLowerCase()}:${ch}`;
  }
  attach(p: XenonPump): void { this.pumps.add(p); }
  detach(p: XenonPump): void { this.pumps.delete(p); }
  /** A pump's 'out' event: record the channel, drive it into the SISTERS.
   *  THE CABLE LAW: the device feeds EVERY wire on the channel — the
   *  writing computer's own port included (game loopback: a program reads
   *  back what it just wrote).
   *  v1.15.6: when the writer's pump resolved its io/alias to a component
   *  (XCDevice.ci), the resolved DEVICE identity rides along — the actuator
   *  tap gets (ci, type, ch, v) and the scene can animate the part. */
  write(alias: string | number, ch: number, v: number | string, from: XenonPump,
    dev?: { ci: number; type: string } | null): void {
    this.values.set(this.key(alias, ch), v);
    if (dev) this.notifyDevice(dev, ch, typeof v === 'number' ? v : Number(v) || 0);
    if (typeof v === 'number')
      for (const p of this.pumps) { void from; p.acceptBusWrite(alias, ch, v); }
  }
  /** Fire the actuator tap for one (device, channel, value) (v1.15.6). */
  notifyDevice(dev: { ci: number; type: string }, ch: number, v: number): void {
    for (const w of this.watchers)
      { try { w(dev.ci, dev.type, ch, v); } catch { /* a tap never breaks the cable */ } }
  }
  /** Record a value WITHOUT the pump fan-out — the HUMAN PRESS lands here
   *  (Farm.pressDevice drives the pumps itself, per-computer io numbers);
   *  the bus-tab rows and the probes see the pressed channel like any other. */
  record(alias: string | number, ch: number, v: number): void {
    this.values.set(this.key(alias, ch), v);
  }
  get(alias: string | number, ch: number): number | string | undefined {
    return this.values.get(this.key(alias, ch));
  }
  snapshot(): Record<string, number | string> { return Object.fromEntries(this.values); }
}

class Farm {
  pumps: XenonPump[] = [];
  bus = new IoBus();
  /** VM budget: each pump is its own wasm instance (~64 MB heap); the
   *  OLDEST is evicted when one more computer wants the floor. */
  static readonly MAX_VM = 8;
  private subs = new Set<() => void>();
  /** Editor/dock re-render when the pump lineup changes (attach/detach). */
  subscribe(cb: () => void): () => void { this.subs.add(cb); return () => { this.subs.delete(cb); }; }
  private notify(): void { for (const cb of this.subs) cb(); }
  attach(p: XenonPump): void {
    if (!this.pumps.includes(p)) {
      while (this.pumps.length >= Farm.MAX_VM) this.pumps.shift()!.close();
      this.pumps.push(p);
      this.notify();
    }
    this.bus.attach(p);
  }
  detach(p: XenonPump): void {
    const had = this.pumps.length;
    this.pumps = this.pumps.filter(q => q !== p);
    this.bus.detach(p);
    if (this.pumps.length !== had) this.notify();
  }
  /** The pump running (or owning) this computer's VM — created on demand. */
  pumpFor(comp: XenonComputer): XenonPump {
    let p = this.pumps.find(q => q.comp?.ci === comp.ci);
    if (!p) this.attach(p = new XenonPump());
    return p;
  }
  pumpForCi(ci: number): XenonPump | null {
    return this.pumps.find(p => p.comp?.ci === ci) ?? null;
  }
  /** The most recently attached pump with a live VM (the dock's target). */
  active(): XenonPump | null {
    for (let i = this.pumps.length - 1; i >= 0; i--) {
      const p = this.pumps[i]!;
      if (p.comp) return p;
    }
    return null;
  }
  /** v1.15.6 THE ACTUATOR TAP: every bus write, resolved to the device
   *  component (engine/devicesim.ts drives the physical parts from it). */
  observeDevices(cb: (ci: number, type: string, ch: number, v: number) => void): () => void {
    return this.bus.observeDevices(cb);
  }
  /** v1.15.6 A HUMAN PRESS on a device (a dashboard element, a 3-D
   *  button): drive the channel into EVERY pump that has the device on a
   *  data port — each pump's OWN io number for it (a numeric io is a
   *  per-computer port, so the write goes through pump.setInput, never a
   *  shared alias key that would land on the wrong port of a sister).
   *  The actuator tap fires once for the sim visuals. Returns how many
   *  computers heard the press. */
  pressDevice(devCi: number, ch: number, v: number, type = ''): number {
    let n = 0;
    for (const p of this.pumps) {
      const dev = p.comp?.devices.find(d => d.ci === devCi);
      if (!dev) continue;
      p.setInput(dev.io, ch, v);
      n++;
    }
    this.bus.notifyDevice({ ci: devCi, type }, ch, v);
    return n;
  }
  /** v1.15.6 AUTO-BOOT (we: "computers should start when a craft is loaded
   *  in"): boot every computer that has a program — the game boots a
   *  computer the moment the craft exists (power permitting; the caller
   *  gates on engine/power.ts). Bounded by MAX_VM (the farm evicts the
   *  oldest, and an IDE-opened pump re-attaches at the back). */
  autoboot(comps: XenonComputer[]): XenonComputer[] {
    const booted: XenonComputer[] = [];
    for (const comp of comps) {
      if (this.pumps.some(p => p.comp?.ci === comp.ci)) continue;
      if (!comp.files.some(f => f.code.trim())) continue;
      void this.pumpFor(comp).open(comp);
      booted.push(comp);
    }
    return booted;
  }
  closeAll(): void { for (const p of [...this.pumps]) p.close(); }
}

export const xenonFarm = new Farm();

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

/** XENON-LOCALS: a function-local variable; `s` = the compiler's recursion
 *  copy id (a function compiled for N recursion depths has N slot copies —
 *  rows of the same name with different s are the copies, labelled #s). */
export interface XenonLocal extends XenonVar { s: number }

/** The DumpLocalsAt JSON (names carry NO '$' — the UI prints '$'+name). */
export function parseLocalsJson(json: string): XenonLocal[] {
  try {
    const j = JSON.parse(json) as { name: string; t: number; v: string; s?: number }[];
    return Array.isArray(j)
      ? j.map(e => ({ name: e.name, t: e.t | 0, v: String(e.v ?? ''), s: (e.s ?? 0) | 0 }))
      : [];
  } catch { return []; }
}

/** XENON-WRITEBACK (ABI 9): Computer::WriteVarAt's one-line answer. */
export interface WriteAck { ok: boolean; error?: string }
export function parseWriteAck(json: string): WriteAck {
  try {
    const j = JSON.parse(json) as { ok?: boolean; error?: string };
    return j && j.ok ? { ok: true } : { ok: false, error: String(j?.error ?? 'writer refused') };
  } catch { return { ok: false, error: 'bad writer answer' }; }
}
/** The UI's gate for number cells — mirrors WriteVarAt's law (a finite
 *  decimal, plus the language's true/false words); the C++ side is the
 *  authority, this is the instant feedback in front of it. */
export function validNumInput(s: string): boolean {
  if (s === 'true' || s === 'false') return true;
  return /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(s.trim());
}

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
