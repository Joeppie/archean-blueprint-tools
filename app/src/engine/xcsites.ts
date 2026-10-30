// xcsites.ts — WHERE a program touches this channel/button (v1.15.6,
// "it should tell us what channel/ui element … which xenoncode line the
// specific e.g. button_rect and line number and computer this corresponds
// to as a popup label").
//
// A cheap TEXT scan of the program files (the same tier as detectChannels —
// the popup names CANDIDATE sites, it is not an AST analysis):
//  • chanSites: every input_number/output_number/input_text/output_text
//    call with a LITERAL (io|alias, ch) — the line a bus channel is read
//    from / written to.
//  • rectSites: every button_rect(x, y, w, h, …) and the legacy
//    button(x, y, color, w, h) with LITERAL coordinates — hit-testing these
//    against a pixel on a 3-D screen face answers "what button is under my
//    cursor, and which line owns it". Draw order = source order, so the
//    LAST rect containing the pixel is the one the click hits (overlaps).
//
// Expressions inside a call (variables, $screen.width) are SKIPPED — only
// literal geometry gets a popup. PURE (no DOM); vitest-pinned.

export interface SiteFile { name: string; code: string }

export interface ChanSite {
  io: number | string;              // number port, or alias string
  ch: number;
  dir: 'in' | 'out';                // the COMPUTER's side: read / write
  fn: string;
  file: string;
  line: number;                     // 1-based
}

const CALL = /(?:(input_number|input_text)|(output_number|output_text))\s*\(\s*(?:(\d+)|"([^"]+)"|'([^']+)')\s*,\s*(\d+)\s*[,)]/g;

export function chanSites(files: SiteFile[]): ChanSite[] {
  const out: ChanSite[] = [];
  for (const f of files)
    for (const m of f.code.matchAll(CALL)) {
      const io = m[3] !== undefined ? +m[3] : (m[4] ?? m[5] ?? '');
      out.push({
        io, ch: +m[6]!,
        dir: m[1] ? 'in' : 'out',
        fn: (m[1] ?? m[2] ?? '') as string,
        file: f.name, line: lineOf(f.code, m.index ?? 0),
      });
    }
  return out;
}

export interface RectSite {
  kind: 'button_rect' | 'button';
  x: number; y: number; w: number; h: number;
  /** the surface this call draws onto: '' = the plain screen (main#0),
   *  else the token of `var $s = screen("alias", 3)` → `alias#3` */
  target: string;
  file: string;
  line: number;
}

/** `var $s = screen("dash", 3)` / `= screen(0,3)` — the member-call binding */
const SCREENVAR = /var\s+(\$\w+)\s*=\s*screen\(\s*(?:"([^"]+)"|'([^']+)'|(\d+))\s*,\s*(\d+)\s*\)/g;
/** button_rect(x, y, w, h, color) — literal geometry */
const RECT = /(?:(\$\w+)\s*\.\s*)?\bbutton_rect\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/g;
/** legacy button(x, y, color, w, h) — the 3rd arg is the colour, w/h are 4th/5th */
const LEGACY = /(?:(\$\w+)\s*\.\s*)?\bbutton\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(?:color\([^)]*\)|\$\w+|\w+)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/g;

function lineOf(code: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx && i < code.length; i++) if (code[i] === '\n') line++;
  return line;
}

/** The surface key ('alias#channel', shim lowercase) a `var $s = screen(...)`
 *  binds, mirroring xenonScreens' key law (alias token lowercased, numeric
 *  io → its digits). */
export function screenVarKey(aliasTok: string, channel: number): string {
  return `${aliasTok.toLowerCase()}#${channel}`;
}

export function rectSites(files: SiteFile[]): RectSite[] {
  const out: RectSite[] = [];
  for (const f of files) {
    // per-file var → surface key map (authored order; a var re-declared
    // later rebinds)
    const vars = new Map<string, string>();
    for (const m of f.code.matchAll(SCREENVAR))
      vars.set(m[1]!, screenVarKey(m[2] ?? m[3] ?? m[4]!, +m[5]!));
    for (const m of f.code.matchAll(RECT))
      out.push(mkRect('button_rect', m[1], +m[2]!, +m[3]!, +m[4]!, +m[5]!, f, m.index ?? 0, vars));
    for (const m of f.code.matchAll(LEGACY))
      out.push(mkRect('button', m[1], +m[2]!, +m[3]!, +m[4]!, +m[5]!, f, m.index ?? 0, vars));
  }
  return out.filter(s => s.w > 0 && s.h > 0);
}

function mkRect(kind: 'button_rect' | 'button', owner: string | undefined,
  x: number, y: number, w: number, h: number,
  f: SiteFile, idx: number, vars: Map<string, string>): RectSite {
  return {
    kind, x, y, w, h,
    target: owner ? vars.get(owner) ?? '?' : '',
    file: f.name, line: lineOf(f.code, idx),
  };
}

/** The rects of one surface containing the pixel, in draw order — the LAST
 *  entry is what a click hits (the game draws top-down, later rects win).
 *  A bare call (no `$s.` owner) draws on the PLAIN screen = surface
 *  `main#0` (the shim's slot for screen-less binding; v1.15.2 built-in
 *  plain target law). */
export function rectsAt(sites: RectSite[], surfaceKey: string, px: number, py: number): RectSite[] {
  const key = surfaceKey.toLowerCase();
  const plain = key === 'main#0';
  return sites.filter(s => (plain ? s.target === '' : s.target === key)
    && px >= s.x && px < s.x + s.w && py >= s.y && py < s.y + s.h);
}
