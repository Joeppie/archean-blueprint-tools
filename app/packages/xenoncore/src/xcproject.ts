// xcproject.ts — the XenonCode PROJECT model (pure, no I/O, vitest-pinned).
//
// Everything the IDE needs to be an IDE over the disk's .xc files:
//  - the function index (`function @name($a:type, ...)` declarations, with
//    file + line + end-of-body estimate) for hover signatures, go-to-definition,
//    the current-function marker in "where am I debugging" and step-over scope,
//  - the include order (the interpreter's SOURCEFILE file-table: entry first,
//    then every `include "f.xc"` in order, BFS, deduped) so (file,line) pairs
//    from XENON-DEBUG v2 map back to a NAME,
//  - the declaration scan (globals, consts, function params) for completion,
//  - call-site discovery for the go-to-definition hit test.
//
// XenonCode syntax law (corpus-verified on 3288012440 + 3326372833):
//   `function @name($a:number, $b:text)` declares; `@name(...)` calls;
//   `include "other.xc"` at global scope pulls a file into the compile.

export interface XCFile { name: string; code: string }

export interface XCFunction {
  name: string;        // WITHOUT the leading '@'
  display: string;     // '@name($a:number, $b:text)' — the signature
  file: string;        // declaring file name
  line: number;        // 1-based declaration line
  end: number;         // last line of the body (next decl - 1, Infinity for the last)
}

export interface XCDecl { name: string; file: string; line: number }  // '$name'

const FN_RE = /^\s*(?:recursive\s+)?function\s+@([\w.]+)\s*\(([^)]*)\)/;
const INCLUDE_RE = /^\s*include\s+"([^"]+)"/;
const DECL_RE = /^\s*(?:(?:storage|global|local)\s+)?(?:var|const|storage|array|init|param|global|local)\s+(@?\$?[\w.]+)\s*(?::\s*\w+|=(?!=))?/;

/** Every function declaration across the disk, in (file, line) order. */
export function projectFunctions(files: XCFile[]): XCFunction[] {
  const out: XCFunction[] = [];
  for (const f of files) {
    const lines = f.code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = FN_RE.exec(lines[i] ?? '');
      if (!m) continue;
      // Body end: the first GLOBAL-scope line after the declaration (column
      // 0, non-empty, not a ';' comment/directive) wins over the next
      // declaration — globals follow functions as often as functions do.
      // No terminator found -> the body runs to the end of the file.
      let end = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j] ?? '';
        if (l.length > 0 && !/^\s/.test(l) && !l.startsWith(';')) { end = j; break; }
      }
      out.push({
        name: m[1]!,
        display: `@${m[1]!}(${m[2]!.trim()})`,
        file: f.name,
        line: i + 1,
        end,                       // 1-based last line of the body
      });
    }
  }
  return out;
}

/** The function whose body encloses (file, line) — the debugger's
 *  `@play_game` answer and step-over's scope (a pair INSIDE [line,end] is
 *  inside the function; stepping over stops at the first pair outside it). */
export function functionAt(funcs: XCFunction[], file: string, line: number): XCFunction | null {
  let best: XCFunction | null = null;
  for (const fn of funcs)
    if (fn.file === file && line >= fn.line && line <= fn.end)
      if (!best || fn.line >= best.line) best = fn;
  return best;
}

/** The declaration of `@name` (first win, corpus-style), for go-to-definition
 *  and hover signatures. Tolerates the '@' being typed or not. */
export function definitionOf(funcs: XCFunction[], name: string): XCFunction | null {
  const n = name.replace(/^@/, '');
  return funcs.find(f => f.name === n) ?? null;
}

/** ── BLOCK frames (v1.13.24, from a real report: a break inside an
 *  `update` block said "top level"): the global-scope blocks the compiler
 *  compiles as named bodies - init/tick (system.init/system.tick),
 *  `timer frequency N` (system.timer), `input N` (system.input),
 *  `screen("alias", ch)` (an entry point) and the declared entry points
 *  (update, shutdown, click, click_hold, scroll). A break inside one of
 *  these has a FRAME with locals - the panel labels it by the block. */
export interface XCBlock {
  label: string;   // 'update', 'tick', 'timer 4', 'screen "TrimsDash"'…
  file: string;
  line: number;    // the block's keyword line (1-based)
  end: number;     // last line of the body (next global-scope line - 1)
}

const BLOCK_RE = /^\s*(init|tick|update|shutdown|click_hold|click|scroll|timer\s+frequency\s+\d+(\.\d+)?|input\s+\d+|screen\s*\([^)]*\))\s*$/;

/** Every block body across the disk, in (file, line) order. */
export function projectBlocks(files: XCFile[]): XCBlock[] {
  const out: XCBlock[] = [];
  for (const f of files) {
    const lines = f.code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = BLOCK_RE.exec(lines[i] ?? '');
      if (!m) continue;
      let end = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j] ?? '';
        if (l.length > 0 && !/^\s/.test(l) && !l.startsWith(';')) { end = j; break; }
      }
      out.push({ label: (lines[i] ?? '').trim(), file: f.name, line: i + 1, end });
    }
  }
  return out;
}

/** The block whose body encloses (file, line) - the debugger's frame label
 *  when no `function @name` does (innermost wins). */
export function blockAt(blocks: XCBlock[], file: string, line: number): XCBlock | null {
  let best: XCBlock | null = null;
  for (const b of blocks)
    if (b.file === file && line >= b.line && line <= b.end)
      if (!best || b.line >= best.line) best = b;
  return best;
}

/** The interpreter's file table: entry first, then every include BFS (in
 *  statement order, deduped, only files that exist on the disk). Index i is
 *  what a SOURCEFILE opcode's `code.value === i` refers to. Names missing
 *  from the disk keep their slot (unresolvable), so indices never shift. */
export function includeOrder(files: XCFile[], entry: string): string[] {
  const byName = new Map(files.map(f => [f.name, f] as const));
  const order: string[] = [];
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);
    order.push(name);
    const f = byName.get(name);
    if (!f) continue;
    for (const line of f.code.split('\n')) {
      const m = INCLUDE_RE.exec(line);
      if (m && m[1] && !seen.has(m[1])) queue.push(m[1]);
    }
  }
  return order;
}

/** Every global-scope declaration name (vars/consts/params) per file, for
 *  completion pools. Params come from the function signature lines. */
export function projectDecls(files: XCFile[]): XCDecl[] {
  const out: XCDecl[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const lines = f.code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const fn = FN_RE.exec(lines[i] ?? '');
      if (fn) {
        for (const p of (fn[2] ?? '').split(',')) {
          const m = /@?\$?([\w.]+)/.exec(p.trim());
          if (m && !seen.has('$' + m[1])) {
            seen.add('$' + m[1]);
            out.push({ name: '$' + m[1], file: f.name, line: i + 1 });
          }
        }
        continue;
      }
      const m = DECL_RE.exec(lines[i] ?? '');
      if (m && m[1]) {
        const name = m[1].startsWith('$') ? m[1] : '$' + m[1];
        if (!seen.has(name)) {
          seen.add(name);
          out.push({ name, file: f.name, line: i + 1 });
        }
      }
    }
  }
  return out;
}

/** Is the caret ON a function call/declaration token (`@name`)? The
 *  go-to-definition + hover hit test, from the source line + column. */
export function functionTokenAt(line: string, col: number): string | null {
  const re = /@([\w.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (col >= m.index && col <= m.index + m[0].length) return m[1] ?? null;
  }
  return null;
}

// Completion vocabulary (v1 lists, moved out of AutocompleteEdit so the
// CodeMirror completion source and the old trigger UI share one truth).
export const XC_LIB_FNS = ['print', 'input_number', 'input_text', 'output_number', 'output_text',
  'screen', 'virtualscreen', 'screen_copy', 'device', 'device_at', 'device_type', 'device_count',
  'text', 'time', 'tick', 'delta_time', 'random', 'color', 'color_r', 'color_g', 'color_b', 'color_a',
  'user', 'owner', 'username', 'system_frequency', 'system_ram', 'system_ipc',
  'programs_count', 'game_mode', 'load_program', 'reboot', 'program_name', 'get_recipe',
  'get_recipes', 'get_recipe_label', 'get_item_value_unit', 'char_w', 'char_h',
  'screen_w', 'screen_h', 'clicked', 'click_x', 'click_y', 'scroll',
  'setworldsim', 'getworldsim'];
export const XC_KEYWORDS = ['if', 'else', 'elseif', 'foreach', 'while', 'repeat', 'for', 'break',
  'continue', 'return', 'and', 'or', 'xor', 'var', 'const', 'storage', 'function', 'init',
  'update', 'input', 'timer', 'frequency', 'interval', 'click', 'click_hold', 'shutdown',
  'include', 'number', 'text'];
export const XC_SCREEN_MEMBERS = ['write', 'blank', 'text_size', 'text_align', 'newline_spacing',
  'draw_point', 'draw_line', 'draw_rect', 'draw_triangle', 'draw_circle', 'draw_poly', 'draw',
  'button', 'button_rect', 'pixel', 'width', 'height', 'char_w', 'char_h', 'clicked',
  'click_x', 'click_y', 'scroll'];

/** ── LIBRARY INDEX (v1.13.25, we: "an index of all known library and
 *  custom-defined functions as a library of definitions, so I can find it
 *  inside the computer"): the built-in callables as DATA — the IDE's Library
 *  side-tab renders and filters this table. One entry per XC_LIB_FNS name
 *  (a vitest pin keeps name sets in lockstep — the table may never grow a
 *  doc for a function the completion pool does not offer, nor go silent on
 *  one it does). `desc` is OUR summary for the panel; FORMAT.md stays the
 *  format truth. */
export interface XCLibFn { name: string; sig: string; desc: string; group: string }

export const XC_LIB_DOC: XCLibFn[] = [
  // — component io
  { name: 'print', sig: 'print(text)', desc: 'write a line to the computer console', group: 'io' },
  { name: 'input_number', sig: 'input_number(aliasOrIo, channel)', desc: 'read a number from a cabled component (alias, io, or "io:channel")', group: 'io' },
  { name: 'input_text', sig: 'input_text(aliasOrIo, channel)', desc: 'read a text value from a cabled component', group: 'io' },
  { name: 'output_number', sig: 'output_number(aliasOrIo, channel, value)', desc: 'send a number to a cabled component', group: 'io' },
  { name: 'output_text', sig: 'output_text(aliasOrIo, channel, text)', desc: 'send a text value to a cabled component', group: 'io' },
  // — screens
  { name: 'screen', sig: 'screen(alias)', desc: 'the screen object of a cabled screen ("alias")', group: 'screen' },
  { name: 'virtualscreen', sig: 'virtualscreen(name, w, h)', desc: 'an off-screen surface (keyed name#N, shows in the Screens tabs)', group: 'screen' },
  { name: 'screen_copy', sig: 'screen_copy(src, dst)', desc: 'copy the pixels of one surface onto another', group: 'screen' },
  { name: 'char_w', sig: 'char_w', desc: 'character cell width (px) on the current screen', group: 'screen' },
  { name: 'char_h', sig: 'char_h', desc: 'character cell height (px) on the current screen', group: 'screen' },
  { name: 'screen_w', sig: 'screen_w', desc: 'width (px) of the current screen', group: 'screen' },
  { name: 'screen_h', sig: 'screen_h', desc: 'height (px) of the current screen', group: 'screen' },
  { name: 'clicked', sig: 'clicked([x, y, w, h])', desc: 'mouse click on the current screen (optionally in a rect)', group: 'screen' },
  { name: 'click_x', sig: 'click_x', desc: 'last click X (px) on the current screen', group: 'screen' },
  { name: 'click_y', sig: 'click_y', desc: 'last click Y (px) on the current screen', group: 'screen' },
  { name: 'scroll', sig: 'scroll', desc: 'scroll-wheel delta on the current screen', group: 'screen' },
  // — devices
  { name: 'device', sig: 'device(alias)', desc: 'the device object with this alias', group: 'device' },
  { name: 'device_at', sig: 'device_at(io)', desc: 'the device cabled to this io port', group: 'device' },
  { name: 'device_type', sig: 'device_type(alias)', desc: 'the component TYPE name of a device', group: 'device' },
  { name: 'device_count', sig: 'device_count(type)', desc: 'how many cabled devices have this type', group: 'device' },
  // — values
  { name: 'text', sig: 'text(value)', desc: 'convert a value to its text form', group: 'value' },
  { name: 'random', sig: 'random()', desc: 'a pseudo-random number in [0, 1)', group: 'value' },
  { name: 'color', sig: 'color(r, g, b, a)', desc: 'pack channels into a color value', group: 'value' },
  { name: 'color_r', sig: 'color_r(color)', desc: 'extract the red channel of a color', group: 'value' },
  { name: 'color_g', sig: 'color_g(color)', desc: 'extract the green channel of a color', group: 'value' },
  { name: 'color_b', sig: 'color_b(color)', desc: 'extract the blue channel of a color', group: 'value' },
  { name: 'color_a', sig: 'color_a(color)', desc: 'extract the alpha channel of a color', group: 'value' },
  // — system
  { name: 'time', sig: 'time()', desc: 'seconds since this computer booted', group: 'system' },
  { name: 'tick', sig: 'tick()', desc: 'the running tick counter', group: 'system' },
  { name: 'delta_time', sig: 'delta_time()', desc: 'seconds elapsed in the last cycle', group: 'system' },
  { name: 'user', sig: 'user()', desc: 'the player name (in-game identity)', group: 'system' },
  { name: 'owner', sig: 'owner()', desc: 'the craft owner\'s name', group: 'system' },
  { name: 'username', sig: 'username()', desc: 'the player name (alias of user)', group: 'system' },
  { name: 'system_frequency', sig: 'system_frequency()', desc: 'this computer\'s rated frequency (Hz)', group: 'system' },
  { name: 'system_ram', sig: 'system_ram()', desc: 'this computer\'s RAM size', group: 'system' },
  { name: 'system_ipc', sig: 'system_ipc()', desc: 'inter-program communication state', group: 'system' },
  { name: 'programs_count', sig: 'programs_count()', desc: 'programs on this computer\'s disk', group: 'system' },
  { name: 'game_mode', sig: 'game_mode()', desc: 'the game mode the server runs', group: 'system' },
  { name: 'load_program', sig: 'load_program(name)', desc: 'load a disk program as the running one', group: 'system' },
  { name: 'reboot', sig: 'reboot()', desc: 'reboot this computer (files from disk)', group: 'system' },
  { name: 'program_name', sig: 'program_name()', desc: 'the running program\'s name', group: 'system' },
  // — recipes
  { name: 'get_recipe', sig: 'get_recipe(...)', desc: 'look up a crafting recipe', group: 'recipe' },
  { name: 'get_recipes', sig: 'get_recipes(...)', desc: 'the crafting recipes available here', group: 'recipe' },
  { name: 'get_recipe_label', sig: 'get_recipe_label(...)', desc: 'a recipe\'s display label', group: 'recipe' },
  { name: 'get_item_value_unit', sig: 'get_item_value_unit(...)', desc: 'an item\'s value unit for crafting maths', group: 'recipe' },
  // — world sim
  { name: 'setworldsim', sig: 'setworldsim(name, value)', desc: 'override a world-sim sensor channel', group: 'worldsim' },
  { name: 'getworldsim', sig: 'getworldsim(name)', desc: 'read a world-sim channel (pitch, altitude, …)', group: 'worldsim' },
];

/** Library docs filtered by a free-text query (name, signature, description
 *  and group all match; empty query = the whole table, in table order). */
export function libIndex(q: string): XCLibFn[] {
  const t = q.trim().toLowerCase();
  if (!t) return XC_LIB_DOC;
  return XC_LIB_DOC.filter(f =>
    f.name.includes(t) || f.sig.toLowerCase().includes(t)
    || f.desc.toLowerCase().includes(t) || f.group.includes(t));
}

/** The Library tab's CATEGORY tabs (v1.13.26, we: "library function should
 *  be in tabs, screen, system, IO should all have their own coloured
 *  category"): one chip per XC_LIB_DOC group, colours ride the chip dot
 *  AND the doc row's left border. A vitest pin keeps the keys == the set
 *  of groups the table uses. */
export interface XCLibGroup { key: string; label: string; color: string }
export const XC_LIB_GROUPS: XCLibGroup[] = [
  { key: 'io', label: 'I/O', color: '#8fd4ff' },
  { key: 'screen', label: 'Screens', color: '#c3e88d' },
  { key: 'device', label: 'Devices', color: '#e6c07b' },
  { key: 'value', label: 'Values', color: '#d6a8ff' },
  { key: 'system', label: 'System', color: '#9fb0c8' },
  { key: 'recipe', label: 'Recipes', color: '#ffb3b3' },
  { key: 'worldsim', label: 'Worldsim', color: '#7dd8c0' },
  { key: 'color', label: 'Colors', color: '#ff8fd0' },
  { key: 'align', label: 'Alignment', color: '#ffd9a0' },
  { key: 'math', label: 'Math', color: '#a0d9ff' },
];

/** ── GLOBAL CONSTANTS (v1.13.27, we: "red, green which seem to be built in
 *  constants are not recognized. They are colors … I dont remember the
 *  precise type"): THE TRUTH IS OUR SHIM (tools/xenoncode/xc_host.cpp
 *  archeanInit) — the game declares these program globals; the interpreter
 *  itself knows no colors. Colors are NUMBERS holding packed RGBA
 *  (XENONCODE_COLOR(r,g,b,255)); alignments are the XENONCODE_* bit
 *  constants; `hex` here is the swatch color the Library tab paints. */
export interface XCConst { name: string; kind: 'color' | 'align' | 'math'; desc: string; hex?: string }
export const XC_GLOBAL_CONSTS: XCConst[] = [
  { name: 'white', kind: 'color', desc: 'packed RGBA color constant', hex: '#ffffff' },
  { name: 'black', kind: 'color', desc: 'packed RGBA color constant', hex: '#000000' },
  { name: 'red', kind: 'color', desc: 'packed RGBA color constant', hex: '#ff0000' },
  { name: 'green', kind: 'color', desc: 'packed RGBA color constant', hex: '#00ff00' },
  { name: 'blue', kind: 'color', desc: 'packed RGBA color constant', hex: '#0000ff' },
  { name: 'yellow', kind: 'color', desc: 'packed RGBA color constant', hex: '#ffff00' },
  { name: 'cyan', kind: 'color', desc: 'packed RGBA color constant', hex: '#00ffff' },
  { name: 'magenta', kind: 'color', desc: 'packed RGBA color constant', hex: '#ff00ff' },
  { name: 'orange', kind: 'color', desc: 'packed RGBA color constant', hex: '#ffa500' },
  { name: 'gray', kind: 'color', desc: 'packed RGBA color constant', hex: '#808080' },
  { name: 'grey', kind: 'color', desc: 'packed RGBA color constant (alias of gray)', hex: '#808080' },
  { name: 'lime', kind: 'color', desc: 'packed RGBA color constant', hex: '#00ff80' },
  { name: 'navy', kind: 'color', desc: 'packed RGBA color constant', hex: '#000080' },
  { name: 'teal', kind: 'color', desc: 'packed RGBA color constant', hex: '#008080' },
  { name: 'purple', kind: 'color', desc: 'packed RGBA color constant', hex: '#a020f0' },
  { name: 'pink', kind: 'color', desc: 'packed RGBA color constant', hex: '#ffc0cb' },
  { name: 'brown', kind: 'color', desc: 'packed RGBA color constant', hex: '#965a28' },
  { name: 'silver', kind: 'color', desc: 'packed RGBA color constant', hex: '#c0c0c0' },
  { name: 'top_left', kind: 'align', desc: 'text alignment bits (top|left)' },
  { name: 'top', kind: 'align', desc: 'text alignment: top' },
  { name: 'top_right', kind: 'align', desc: 'text alignment bits (top|right)' },
  { name: 'left', kind: 'align', desc: 'text alignment: left' },
  { name: 'center', kind: 'align', desc: 'text alignment: center' },
  { name: 'right', kind: 'align', desc: 'text alignment: right' },
  { name: 'bottom_left', kind: 'align', desc: 'text alignment bits (bottom|left)' },
  { name: 'bottom', kind: 'align', desc: 'text alignment: bottom' },
  { name: 'bottom_right', kind: 'align', desc: 'text alignment bits (bottom|right)' },
  { name: 'pi', kind: 'math', desc: '3.14159…' },
  { name: '2pi', kind: 'math', desc: '2 × pi' },
];

/** ── BLOCK-OPEN lines (v1.13.26, we: "after hitting enter on an init,
 *  update etc. block, the next line should automatically indent, same with
 *  a function"; v1.13.28, we: "After if statements the indent should be
 *  one deeper (same for similar constructs)"): the editor's Enter handler
 *  indents ONE unit (a tab) after a global-scope block keyword line
 *  (BLOCK_RE's set), a `function @name` declaration, or a CONTROL-flow
 *  opener (if/elseif/else/while/repeat/for/foreach). Pure so the law is
 *  vitest-pinned. */
const CONTROL_RE = /^\s*(if|elseif|else|while|repeat|for|foreach)\b/;
export function opensBlockLine(line: string): boolean {
  return BLOCK_RE.test(line) || FN_RE.test(line) || CONTROL_RE.test(line);
}

/** ── io-CALL hit test (v1.13.26, we: "when mouseovering a io write/read
 *  to a specific port … resolve what kind of device it is and what its
 *  current values are … what that means, read from the device itself"):
 *  caret at `col` sits ON an input_number/output_number/input_text/
 *  output_text call name → the call's function, its first argument
 *  (alias text WITHOUT quotes, or the io number as text) and its channel
 *  (second number); null off any such call. */
export interface XCIoCall { fn: string; arg: string; channel: number }
const IO_CALL_RE = /(input_number|output_number|input_text|output_text)\s*\(([^)]*)\)/g;
export function ioCallAt(line: string, col: number): XCIoCall | null {
  IO_CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IO_CALL_RE.exec(line))) {
    // the WHOLE call is the target: hovering the alias string ("Engine")
    // is the natural gesture — that string IS the port being read/written
    if (col >= m.index && col <= m.index + m[0].length) {
      const args = m[2] ?? '';
      const a = /"([^"]*)"|(-?\d+)/.exec(args);
      const c = /,\s*(-?\d+)/.exec(args);
      if (!a || !c) return null;
      return { fn: m[1]!, arg: a[1] ?? a[2]!, channel: +c[1]! };
    }
  }
  return null;
}
