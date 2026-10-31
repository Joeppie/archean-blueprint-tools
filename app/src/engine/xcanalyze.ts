// xcanalyze.ts — THE XENONCODE ANALYZER (v1.16.13, the user: "I want better
// xenoncode analysis. Report missing functions, definitions, missing return
// statements in functions where a result is used, etc. … mark them like VS
// would"). A pure, per-project pass over a disk's .xc files (+ the
// blueprint's device aliases) producing VS-style diagnostics:
//
//  code                  severity  law
//  undeclared-function   error     `@name(` referenced with no
//                                  `function @name` in the project (user
//                                  functions ALWAYS carry `@` — wiki §Basic
//                                  rules; every @-reference site is marked)
//  unknown-include       error     `include "f.xc"` not among the disk's files
//  duplicate-function    warning   `function @name` declared twice (the
//                                  interpreter OVERRIDES by name — the ABI
//                                  screen_w law of v1.14.1)
//  duplicate-var         warning   a global `$name` declared twice
//  unknown-function      warning   a BARE call name outside the interpreter's
//                                  language functions, the shim's device
//                                  functions, keywords and entry points
//  unknown-method        warning   a trailing `.name(` outside the same
//                                  vocabulary (device functions are legal
//                                  trailing calls — the object rides as the
//                                  first argument)
//  missing-return        warning   a function with a declared `: type` whose
//                                  body has no `return`, or one whose result
//                                  is USED (`= @f(`, `return @f(`,
//                                  `if/while @f(`, inside expressions)
//  unused-function       hint      declared @function never referenced
//  unused-var            hint      declared $var never referenced
//  unknown-alias         warning   input_number/input_text/output_number/
//                                  output_text/screen("alias") naming a
//                                  component the craft does not have
//  unused-param          hint      a function parameter never used in the body
//
// VOCABULARY IS THE BINARY, not prose: XC_SHIM_FUNCTIONS are the
// DeclareDeviceFunction names of tools/xenoncode/xc_host.cpp (the device
// shim), XC_LANG_FUNCTIONS the interpreter registrations of
// tools/xenoncode/upstream/XenonCode.hpp, XC_CONSTANTS the shim's
// DeclareGlobalConstant colors/anchors; XC_KEYWORDS the wiki §Valid-usage
// line-initial words (wiki/en/xenoncode/documentation.md, offline).
// xcanalyze.test re-derives the two lists from the C++ (the mass.ts ⇄
// game_data.py cross-pin) and asserts the SHIPPED program disks (ChipOS's
// 52-file OS, the Badger's 57-file disk) answer to ZERO hard-class
// diagnostics — a false positive on working code fails the suite.
import type { XCFile } from './xcproject';

export type XCSeverity = 'error' | 'warning' | 'hint';

export interface XCDiagnostic {
  file: string;
  line: number;                 // 1-based
  from: number;                 // 0-based column on the line
  to: number;
  severity: XCSeverity;
  code: string;                 // 'xc-' + the table above
  message: string;
}

// ---- vocabulary (XC_SHIM_FUNCTIONS ⇄ xc_host.cpp, XC_LANG_FUNCTIONS ⇄
// ---- XenonCode.hpp — xcanalyze.test re-derives both and asserts every
// ---- declared name is listed here) ---------------------------------------
export const XC_SHIM_FUNCTIONS: ReadonlySet<string> = new Set([
  'beacon', 'blank', 'button', 'button_circle', 'button_rect', 'cancel_craft',
  'char_h', 'char_w',
  'clicked', 'click_x', 'click_y', 'color', 'color_a', 'color_b', 'color_g',
  'color_r', 'delta_time', 'device', 'device_at', 'device_count', 'device_type',
  'draw', 'draw_circle', 'draw_line', 'draw_point', 'draw_poly', 'draw_rect',
  'draw_triangle', 'enough_power', 'fluid_level', 'fov', 'game_mode', 'get',
  'get_item_value_unit', 'get_recipe', 'get_recipe_label', 'get_recipes',
  'get_recipes_categories', 'getworldsim', 'input_number', 'input_text', 'ipc',
  'load_program', 'mouse_look', 'mouse_x', 'mouse_y', 'newline_spacing',
  'output_number', 'output_text', 'owner', 'panel', 'pixel', 'print',
  'program_name', 'programs_count', 'progress', 'random', 'reboot', 'screen',
  'screen_copy', 'screen_h', 'screen_w', 'set', 'set_cps',
  'set_resolution_scale', 'setworldsim', 'start_craft', 'system_frequency',
  'system_ipc', 'system_ram', 'text_align', 'text_size', 'tick', 'time',
  'transmit', 'user', 'username', 'virtualscreen', 'write',
  // panel()/beacon() OBJECT members (the shim's panelMembers map, v1.14.1
  // slice B — the readme HUD's $helpButton.set_position(…) is what fired
  // the audit): legal trailing calls on panel objects
  'height', 'set_position', 'set_size', 'width', 'x', 'y',
]);
export const XC_LANG_FUNCTIONS: ReadonlySet<string> = new Set([
  'abs', 'acos', 'add', 'angle', 'append', 'asin', 'atan', 'avg', 'ceil',
  'clamp', 'clear', 'contains', 'cos', 'cross', 'determinant', 'distance',
  'div', 'dot', 'erase', 'fill', 'find', 'floor', 'fract', 'from', 'hash',
  'if', 'insert', 'inverse', 'isnumeric', 'last', 'length', 'lerp', 'log',
  'lower', 'max',
  'med', 'min', 'mod', 'mul', 'normalize', 'pop', 'pow', 'replace', 'round',
  'sign', 'sin', 'size', 'smoothstep', 'sort', 'sortd', 'sqrt', 'step', 'sub',
  'substring', 'sum', 'tan', 'text', 'transpose', 'upper',
]);
const XC_CONSTANTS: ReadonlySet<string> = new Set([
  'pi', '2pi', 'white', 'black', 'red', 'green', 'blue', 'yellow', 'cyan',
  'magenta', 'gray', 'grey', 'lime', 'orange', 'pink', 'purple', 'silver',
  'teal', 'navy', 'brown', 'top', 'bottom', 'left', 'right', 'center',
  'top_left', 'top_right', 'bottom_left', 'bottom_right',
]);
// line-initial keywords + entry-point/section words (wiki §Valid usage;
// click_hold/scroll are the per-screen entry points the shim declares)
const XC_KEYWORDS: ReadonlySet<string> = new Set([
  'include', 'const', 'var', 'array', 'storage', 'global', 'local', 'param',
  'function', 'recursive', 'init', 'tick', 'update', 'click', 'click_hold',
  'scroll', 'timer', 'input',
  'output', 'if', 'elseif', 'else', 'for', 'foreach', 'while', 'repeat',
  'break', 'continue', 'return', 'and', 'or', 'not', 'true', 'false', 'null',
  'self', 'this', '_this',
]);

export interface XCAnalyzeOpts {
  /** the craft's addressable component aliases (lowercased —
   *  xenonDevices(comps).devices.map(d => d.alias)). undefined = skip the
   *  alias checks (a computerless analysis, e.g. a bare file dump). */
  aliases?: string[];
}

/** blank `;` comments and string BODIES (length-preserving, so columns
 *  stay exact). Call/method scanning runs on the mask; the alias pass reads
 *  the ORIGINAL lines (it needs the string content). v1.16.13: prose inside
 *  ChipOS's player-facing text ("{} radiators) found (…)") matched call
 *  shapes on the first pass — string bodies are inert to the call scan. */
function maskLine(line: string): string {
  let out = '';
  let inStr: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inStr) {
      out += c === inStr ? c : ' ';
      if (c === inStr && line[i - 1] !== '\\') inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; out += c; continue; }
    if (c === ';') { out += ' '.repeat(line.length - i); break; }
    out += c;
  }
  return out;
}

const FN_RE = /^\s*(?:recursive\s+)?function\s+@([\w.]+)\s*\(([^)]*)\)\s*(?::\s*([a-z_]+))?/;
const INCLUDE_RE = /^\s*include\s+"([^"]+)"/;
const VAR_DECL_RE = /^\s*(var|const|storage|array|global|local|param)\s+(\$[A-Za-z_][\w.]*)/;
const FN_REF_RE = /@([A-Za-z_][\w.]*)/g;
const BARE_CALL_RE = /([a-z_][\w]*)\s*\(/g;
const METHOD_RE = /\.\s*([a-z_][\w]*)\s*\(/g;
const VAR_REF_RE = /\$([A-Za-z_][\w.]*)/g;
const ALIAS_ARG_RE = /(?:input_number|input_text|output_number|output_text|screen)\(\s*"([^"]+)"\s*[,)]/g;
/** value positions: `= @f(`, `return @f(`, `if/while @f(`, operator/paren/comma before */
const VALUE_USE_RE = /(?:[=+\-*/(<,]\s*|return\s+|if\s+|while\s+|and\s+|or\s+)@([A-Za-z_][\w.]*)\s*\(/g;

interface FnDecl {
  name: string; fileIdx: number; line: number; from: number; to: number;
  params: string[]; retType: string | null; body: string[]; bodyStart: number;
}
interface Pos { file: string; line: number; from: number; to: number }

function at(line: string, needle: string, start = 0): { from: number; to: number } {
  const i = line.indexOf(needle, start);
  const at0 = i < 0 ? start : i;
  return { from: at0, to: at0 + needle.length };
}

export function analyzeProject(files: XCFile[], opts: XCAnalyzeOpts = {}): XCDiagnostic[] {
  const out: XCDiagnostic[] = [];
  const fileNames = new Set(files.map(f => f.name.toLowerCase()));
  const aliases = opts.aliases?.map(a => a.toLowerCase());
  const masked = files.map(f => f.code.split('\n').map(maskLine));

  // ---- pass 1: function declarations + bodies (xcproject's body law: the
  // body runs to the next column-0 statement) ------------------------------
  const fns: FnDecl[] = [];
  files.forEach((_f, fi) => {
    const mm = masked[fi]!;
    for (let i = 0; i < mm.length; i++) {
      const m = FN_RE.exec(mm[i]!);
      if (!m) continue;
      const p = m[0]!.indexOf(`@${m[1]!}`);
      const params = (m[2] ?? '').split(',').map(x => /^\s*\$([A-Za-z_][\w.]*)/.exec(x)?.[1])
        .filter((x): x is string => !!x);
      fns.push({ name: m[1]!, fileIdx: fi, line: i + 1,
        from: p, to: p + m[1]!.length + 1,
        params, retType: m[3] ?? null, body: [], bodyStart: i + 1 });
    }
  });
  for (const fn of fns) {
    const mm = masked[fn.fileIdx]!;
    for (let i = fn.bodyStart; i < mm.length; i++) {
      const l = mm[i]!;
      if (l.trim() === '' || /^\s/.test(l) || l.trimStart().startsWith(';')) { fn.body.push(l); continue; }
      break;
    }
  }
  const declared = new Map<string, FnDecl[]>();
  for (const fn of fns) {
    const list = declared.get(fn.name) ?? [];
    if (list.length)
      out.push({ file: files[fn.fileIdx]!.name, line: fn.line, from: fn.from, to: fn.to,
        severity: 'warning', code: 'xc-duplicate-function',
        message: `@${fn.name} is already declared (the interpreter OVERRIDES by name — one declaration per name)` });
    list.push(fn);
    declared.set(fn.name, list);
  }

  // ---- pass 2: references --------------------------------------------------
  const fnRefSites = new Map<string, Pos[]>();
  const varRefs = new Map<string, number>();
  const varDecls = new Map<string, (Pos & { global: boolean })[]>();
  const includes: (Pos & { target: string })[] = [];
  const seenInFile: (Map<string, number>)[] = files.map(() => new Map());

  files.forEach((f, fi) => {
    const mm = masked[fi]!;
    for (let i = 0; i < mm.length; i++) {
      const l = mm[i]!;
      if (l.trim() === '') continue;

      const inc = INCLUDE_RE.exec(lines_of(f)[i] ?? '');
      if (inc) includes.push({ file: f.name, line: i + 1,
        ...at(lines_of(f)[i] ?? '', `"${inc[1]!}"`, 0), target: inc[1]! });

      const vd = VAR_DECL_RE.exec(l);
      if (vd) {
        const name = vd[2]!;
        seenInFile[fi]!.set(name, i + 1);
        const isGlobal = !/^\s/.test(l);
        const list = varDecls.get(name) ?? [];
        list.push({ file: f.name, line: i + 1, ...at(l, name), global: isGlobal });
        varDecls.set(name, list);
      }

      for (const m of l.matchAll(FN_REF_RE)) {
        const sites = fnRefSites.get(m[1]!) ?? [];
        sites.push({ file: f.name, line: i + 1, from: (m.index ?? 0) + 1,
          to: (m.index ?? 0) + 1 + m[1]!.length });
        fnRefSites.set(m[1]!, sites);
      }
      for (const m of l.matchAll(VAR_REF_RE)) {
        const n = `$${m[1]!}`;
        if (seenInFile[fi]!.get(n) === i + 1) continue;   // the declaring line
        varRefs.set(n, (varRefs.get(n) ?? 0) + 1);
      }
      if (aliases) {
        for (const m of (lines_of(f)[i] ?? '').matchAll(ALIAS_ARG_RE)) {
          const a = m[1]!.toLowerCase();
          if (a.includes('$')) continue;                  // computed alias (a variable)
          if (!aliases.includes(a))
            out.push({ file: f.name, line: i + 1, ...at(lines_of(f)[i] ?? '', `"${m[1]!}"`),
              severity: 'warning', code: 'xc-unknown-alias',
              message: `no component named "${m[1]!}" on this craft` });
        }
      }
      for (const m of l.matchAll(BARE_CALL_RE)) {
        const n = m[1]!;
        const pre = (m.index ?? 0) > 0 ? l[(m.index ?? 0) - 1]! : '';
        // trailing `.name(` is the METHOD pass; `@name(` is user-level; a
        // quote-prefixed name is string content
        if (pre && /[\w.$@"]/.test(pre)) continue;
        if (XC_KEYWORDS.has(n) || XC_CONSTANTS.has(n)) continue;
        if (XC_LANG_FUNCTIONS.has(n) || XC_SHIM_FUNCTIONS.has(n)) continue;
        // calls to PROJECT functions are legal bare in expressions (the wiki
        // ties the @ to the statement-leading call form) — a declared name
        // is vocabulary
        if (declared.has(n)) continue;
        out.push({ file: f.name, line: i + 1, ...at(l, n, m.index ?? 0),
          severity: 'warning', code: 'xc-unknown-function',
          message: `'${n}(' is not a XenonCode function (the interpreter and the device shim declare none)` });
      }
      for (const m of l.matchAll(METHOD_RE)) {
        const n = m[1]!;
        if (XC_KEYWORDS.has(n) || XC_LANG_FUNCTIONS.has(n)
          || XC_SHIM_FUNCTIONS.has(n) || XC_CONSTANTS.has(n)) continue;
        out.push({ file: f.name, line: i + 1, ...at(l, n, (m.index ?? 0) + 1),
          severity: 'warning', code: 'xc-unknown-method', message: `.${n}() is not a known XenonCode method` });
      }
    }
  });

  // ---- undeclared-function: every @-reference with no declaration ---------
  for (const [name, sites] of fnRefSites) {
    if (declared.has(name)) continue;
    for (const s of sites)
      out.push({ ...s, severity: 'error', code: 'xc-undeclared-function',
        message: `@${name} is called but no 'function @${name}' is declared in this project` });
  }

  // ---- function-level diagnostics ----------------------------------------
  const usedValues = new Set<string>();
  for (const mm of masked)
    for (const l of mm)
      for (const m of l.matchAll(VALUE_USE_RE)) usedValues.add(m[1]!);
  for (const [name, list] of declared) {
    const refs = fnRefSites.get(name)?.length ?? 0;
    const declaredSites = list.length;
    const calls = refs - declaredSites;              // declarations carry @name too
    for (const fn of list) {
      if (calls <= 0)
        out.push({ file: files[fn.fileIdx]!.name, line: fn.line, from: fn.from, to: fn.to,
          severity: 'hint', code: 'xc-unused-function', message: `@${fn.name} is declared but never called` });
      const hasReturn = fn.body.some(b => /^\s*return\b/.test(b));
      if (!hasReturn && (fn.retType || usedValues.has(name)))
        out.push({ file: files[fn.fileIdx]!.name, line: fn.line, from: fn.from, to: fn.to,
          severity: 'warning', code: 'xc-missing-return',
          message: fn.retType
            ? `@${fn.name} declares : ${fn.retType} but its body has no return`
            : `@${fn.name}'s result is used but its body has no return` });
      for (const p of fn.params) {
        if (!fn.body.some(b => b.includes(`$${p}`))) {
          const l = masked[fn.fileIdx]![fn.line - 1]!;
          out.push({ file: files[fn.fileIdx]!.name, line: fn.line, ...at(l, `$${p}`, fn.to),
            severity: 'hint', code: 'xc-unused-param',
            message: `parameter $${p} of @${fn.name} is never used` });
        }
      }
    }
  }

  // ---- includes ------------------------------------------------------------
  for (const inc of includes)
    if (!fileNames.has(inc.target.toLowerCase()))
      out.push({ file: inc.file, line: inc.line, from: inc.from, to: inc.to,
        severity: 'error', code: 'xc-unknown-include',
        message: `include "${inc.target}" is not a file on this disk` });

  // ---- duplicate globals + unused vars --------------------------------------
  for (const [name, decls] of varDecls) {
    const globals = decls.filter(d => d.global);
    const byFile = new Map<string, number>();
    for (const g of globals) {
      const k = g.file;
      byFile.set(k, (byFile.get(k) ?? 0) + 1);
      if ((byFile.get(k) ?? 0) > 1)
        out.push({ file: g.file, line: g.line, from: g.from, to: g.to,
          severity: 'warning', code: 'xc-duplicate-var',
          message: `${name} is already declared in this file` });
    }
    if ((varRefs.get(name) ?? 0) === 0)
      for (const d of decls)
        out.push({ file: d.file, line: d.line, from: d.from, to: d.to,
          severity: 'hint', code: 'xc-unused-var',
          message: `${name} is declared but never referenced` });
  }

  out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.from - b.from);
  return out;
}

let _linesCache = new WeakMap<XCFile, string[]>();
function lines_of(f: XCFile): string[] {
  let l = _linesCache.get(f);
  if (!l) { l = f.code.split('\n'); _linesCache.set(f, l); }
  return l;
}
