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
