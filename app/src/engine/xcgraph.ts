// xcgraph.ts — THE XENON ANALYSIS GRAMMAR (v1.17.0, we: "can we let our
// editor automatically make a mermaid diagram of the xenoncode … Init
// update and function calls, sequence diagrams, class diagram, considering
// files as classes … treat IO devices, fully resolved names, as SYSTEM
// ACTORS and button presses, cockpit as a USER in sequence diagrams").
//
// PURE static analysis over a computer's program files + the resolved
// device table — it emits MERMAID SOURCE (the dialog lazily runs the
// mermaid runtime; this module never touches the DOM, so the whole law is
// vitest-testable):
//   • flow     — per-file entry points (init/update/click/…) and the
//                @function call graph, cross-file edges via include/call;
//   • sequence — actor USER (the pilot: cockpit key presses) → PilotSeat
//                parts, devices as SYSTEM ACTORS with FULLY RESOLVED names
//                (`alias · Type · io N`), files as participants, input_/
//                output_ traffic as arrows;
//   • class    — one class per FILE ($vars as attributes, @functions as
//                methods) with `..>` call/include relations.
//
// HONEST LIMITS (documented, deliberate): the call graph is a STATIC
// APPROXIMATION — any @call inside a file is attributed to that FILE (a
// per-function CFG would need a parser we do not own here); a device
// token that is a runtime $var resolves through the string literals
// ASSIGNED to that var in the source (the games' own idiom: `var $device
// = "game-fx-blocks"` then re-branches) — ChipOS/Mario style code lands,
// data-driven indirection does not; seat channel WORDS ride the runtime
// labels the caller passes (seatLabels), else `ch N` stands.
import type { XCDevice } from './xenoncode';

export interface XcFile { name: string; code: string }
export interface XcProgram {
  alias: string; ci: number;
  files: XcFile[];
  devices: XCDevice[];
}
export type XcDiagramKind = 'class' | 'flow' | 'seqIn' | 'seqOut';
export interface XcDiagram { kind: XcDiagramKind; title: string; source: string }

const ENTRIES = ['init', 'vars_init', 'update', 'click_hold', 'click', 'scroll', 'shutdown'];

/** cut `;` line-comments (outside strings) but KEEP the strings — the
 *  device tokens and includes ARE strings; deleting them blinds the scan
 *  (the v1.17.0 first-cut catch: stripNoise stripping quote bodies left
 *  every io-token unresolvable). CALL searches use stringsOf/their own
 *  pass; here one law fits all. */
function stripNoise(line: string): string {
  let out = '', inStr = false;
  for (const c of line) {
    if (c === '"') inStr = !inStr;
    if (c === ';' && !inStr) break;
    out += c;
  }
  return out;
}
function stringsOf(line: string): string[] {
  return line.match(/"([^"\n]{1,60})"/g)?.map(s => s.slice(1, -1)) ?? [];
}
/** mermaid-safe label text */
function label(s: string): string {
  return s.replace(/["`;#<>{}|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48) || '_';
}
/** ascii-stable node ids */
const nid = (p: string, s: string) =>
  p + '_' + s.replace(/[^A-Za-z0-9_]/g, c => c.charCodeAt(0).toString(36));

/** `var $x = "lit"` / `$x = "lit"` assignments of one file */
function varLiterals(file: XcFile): Map<string, string[]> {
  const m = new Map<string, Set<string>>();
  for (const raw of file.code.split('\n')) {
    const line = stripNoise(raw);
    const m2 = /^\s*(?:var\s+)?(\$[A-Za-z0-9_]+)\s*=\s*(.+)$/.exec(line);
    if (!m2) continue;
    const lits = stringsOf(line);
    if (!lits.length) continue;
    if (!m.has(m2[1]!)) m.set(m2[1]!, new Set());
    for (const l of lits) m.get(m2[1]!)!.add(l);
  }
  return new Map([...m].map(([k, v]) => [k, [...v]]));
}
const IO_RE = /(input|output)_(number|text)\(\s*("[^"\n]{1,60}"|\$[A-Za-z0-9_]+|\d+)\s*,\s*([^,)\n]{1,24})/;

/** ── THE NODE GRAPH (v1.17.1, we: "even a node if it is an node") ──
 *  XenonCode editors save visual programs with a `#NODES {json}` first
 *  line (plomo, Mario, Invaders are ALL node-generated). The blob is the
 *  real program: nodes carry title/type, inputs[] reference source node
 *  ids, InputNode/OutputNode carry ioNumber + channel. Parsing it fixes
 *  what the text scan is blind to: a node program's ENTIRE io surface. */
export interface XcNode { id: string; title: string; type: string; ioNumber?: number;
  channel?: number; inputs: (string | undefined)[]; inputValues: string[] }
export interface XcNodeGraph { nodes: XcNode[] }
export function parseNodeGraph(file: XcFile): XcNodeGraph | null {
  const m = /^\s*;?#NODES (\{.*\})\s*$/m.exec(file.code.slice(0, 200_000));
  if (!m) return null;
  try {
    const g = JSON.parse(m[1]!) as { nodes?: XcNode[] };
    return g?.nodes?.length ? { nodes: g.nodes } : null;
  } catch { return null; }
}

/** size caps (we: "all diagrams are too large … bloated and unusable"):
 *  every diagram is BOUNDED; overflow folds into honest "+N more" members. */
const CAP = { cls: 7, fns: 6, edges: 8, seqDev: 7, seqMsg: 12, nodeCls: 8, flowFiles: 5 };
const ENTRY_MARK: Record<string, string> = {
  // the user asked to SEE the live blocks: init, update(tick), click…
  // v1.17.2: the ⚡ rides the mark — in the class member list the live
  // blocks must not hide among the plain +functions (we: "entry points
  // is hard to read").
  vars_init: '⚡«vars_init»', init: '⚡«init»', update: '⚡«update · tick 25 Hz»',
  click: '⚡«click»', click_hold: '⚡«click_hold»', scroll: '⚡«scroll»', shutdown: '⚡«shutdown»',
};

export function xcDiagrams(prog: XcProgram, seatLabels?: Record<number, string>): XcDiagram[] {
  const files = prog.files;
  const graphs = new Map<string, XcNodeGraph | null>();
  for (const f of files) graphs.set(f.name, parseNodeGraph(f));
  const decl = new Map<string, string>();
  const fns = new Map<string, string[]>();
  const entries = new Map<string, string[]>();
  const includes = new Map<string, string[]>();
  const calls = new Map<string, Set<string>>();
  const io: { file: string; dir: 'in' | 'out'; token: string; ch: string; node?: string }[] = [];
  const varStrs = new Map<string, Map<string, string[]>>();
  for (const f of files) {
    varStrs.set(f.name, varLiterals(f));
    const g = graphs.get(f.name);
    if (g) {
      // node program: the graph IS the structure; io comes from the io nodes
      const byId = new Map(g.nodes.map(n => [n.id, n]));
      for (const n of g.nodes) {
        const t = /"([^"]{1,60})"/.exec(n.title ?? '')?.[1] ?? n.title ?? n.type;
        (fns.get(f.name) ?? fns.set(f.name, []).get(f.name)!).push(t);
        for (const src of n.inputs ?? []) {
          if (src && byId.has(src)) {
            if (!calls.has(f.name)) calls.set(f.name, new Set());
            const s = byId.get(src)!;
            calls.get(f.name)!.add(`${s.title || s.type} → ${n.title || n.type}`);
          }
        }
        if (n.type === 'InputNode' && n.ioNumber !== undefined)
          io.push({ file: f.name, dir: 'in', token: String(n.ioNumber), ch: String(n.channel ?? 0), node: n.title });
        if (n.type === 'OutputNode' && n.ioNumber !== undefined)
          io.push({ file: f.name, dir: 'out', token: String(n.ioNumber), ch: String(n.channel ?? 0), node: n.title });
      }
    }
    for (const raw of f.code.split('\n')) {
      const line = stripNoise(raw);
      const declM = /^\s*(?:recursive\s+)?function\s+@([A-Za-z0-9_]+)/.exec(line);
      if (declM) { decl.set('@' + declM[1]!, f.name);
        if (!fns.has(f.name)) fns.set(f.name, []); fns.get(f.name)!.push('@' + declM[1]!); continue; }
      const entM = new RegExp('^\\s*(' + ENTRIES.join('|') + ')\\b').exec(line);
      if (entM) { const l = entries.get(f.name) ?? [];
        if (!l.includes(entM[1]!)) l.push(entM[1]!); entries.set(f.name, l); }
      const inc = /^\s*include\s+"([^"]+)"/.exec(line);
      if (inc) { if (!includes.has(f.name)) includes.set(f.name, []); includes.get(f.name)!.push(inc[1]!); }
      for (const m of line.matchAll(/@([A-Za-z0-9_]+)\s*\(/g)) {
        const quotes = (line.slice(0, m.index ?? 0).match(/"/g) ?? []).length;
        if (quotes % 2) continue;
        if (!calls.has(f.name)) calls.set(f.name, new Set());
        calls.get(f.name)!.add('@' + m[1]!);
      }
      if (graphs.get(f.name)) continue;    // node programs: io came from the graph
      const ev = IO_RE.exec(line);
      if (ev) io.push({ file: f.name, dir: ev[1] === 'input' ? 'in' : 'out',
        token: ev[3]!, ch: ev[4]!.trim() });
    }
  }
  const resolve = (file: string, tok: string): XCDevice[] => {
    const t = tok.trim();
    if (/^\d+$/.test(t)) return prog.devices.filter(d => d.io === +t);
    if (/^".*"$/.test(t)) { const a = t.slice(1, -1).toLowerCase();
      return prog.devices.filter(d => d.alias.toLowerCase() === a); }
    if (t.startsWith('$')) { const lits = varStrs.get(file)?.get(t) ?? []; const out: XCDevice[] = [];
      for (const l of lits) for (const d of prog.devices)
        if (d.alias.toLowerCase() === l.toLowerCase() && !out.includes(d)) out.push(d);
      return out; }
    return [];
  };
  const short = (d: XCDevice) => (d.alias || `io${d.io}`).replace(/\s+/g, '_');

  const tally = new Map<string, { dev: XCDevice; dir: 'in' | 'out'; chs: Set<string>; n: number }>();
  for (const ev of io)
    for (const d of resolve(ev.file, ev.token)) {
      const k = `${d.alias}|${d.io}|${ev.dir}`;
      if (!tally.has(k)) tally.set(k, { dev: d, dir: ev.dir, chs: new Set(), n: 0 });
      tally.get(k)!.chs.add(ev.ch); tally.get(k)!.n++;
    }

  // ── CLASS & WIRING (the centrepiece, max one per computer; v1.17.1 the
  //    DEVICES join it (we: "Why [not a] class diagram with devices?") —
  //    parts are first-class nodes: io number, who reads/writes them) ────
  const withContent = files.filter(f => (fns.get(f.name)?.length ?? 0) + (entries.get(f.name)?.length ?? 0) > 0);
  const shown = withContent.slice(0, CAP.cls);
  const cls: string[] = ['classDiagram'];
  for (const f of shown) {
    const cname = nid('c', f.name);
    cls.push(`  class ${cname}["${label(f.name)}"] {`);
    for (const e of entries.get(f.name) ?? [])
      cls.push(`    +${ENTRY_MARK[e] ?? '«' + e + '»'}`);
    const own = [...new Set(fns.get(f.name) ?? [])].filter(x => !entries.has(x));
    for (const fn of own.slice(0, CAP.fns)) cls.push(`    +${label(fn)}`);
    if (own.length > CAP.fns) cls.push(`    +… +${own.length - CAP.fns} more`);
    cls.push('  }');
  }
  if (withContent.length > shown.length)
    cls.push(`  class misc["… ${withContent.length - shown.length} more file(s)"]`);
  // ENTRY READABILITY v1.17.2 (we: "the entry points is hard to read …
  // things dont properly align"): a class carrying live blocks gets the
  // teal frame, devices keep amber — the diagram's colour language is
  // THE SAME on both diagram kinds and the plates.
  for (const f of shown)
    if ((entries.get(f.name) ?? []).length)
      cls.push(`  style ${nid('c', f.name)} stroke:#7dffcf,stroke-width:2px`);
  // device nodes + wiring edges (bounded like the sequences)
  const devRanked = [...tally.values()].sort((a, b) => b.n - a.n);
  const devShown = devRanked.slice(0, CAP.seqDev);
  for (const x of devShown)
    cls.push(`  class ${nid('d', short(x.dev))}["≡ ${label(short(x.dev))} : ${label(x.dev.type)}"] {` +
      `\n    +io ${x.dev.io}\n    +${x.dir === 'in' ? 'read' : 'written'} ×${x.n}` +
      `\n    +ch ${label([...x.chs].slice(0, 4).join(','))}\n  }`);
  for (const x of devShown)
    cls.push(`  style ${nid('d', short(x.dev))} stroke:#ffc35e,stroke-width:1.5px`);
  if (devRanked.length > devShown.length)
    cls.push(`  class devmisc["… +${devRanked.length - devShown.length} quieter device(s)"]`);
  let devEdges = 0;
  for (const x of devShown) {
    if (devEdges >= CAP.edges + 4) break;
    const owners = new Set<string>();
    for (const ev of io) for (const d2 of resolve(ev.file, ev.token))
      if (d2 === x.dev) owners.add(ev.file);
    for (const f of owners) {
      if (!shown.some(y => y.name === f)) continue;
      cls.push(x.dir === 'in'
        ? `  ${nid('d', short(x.dev))} ..> ${nid('c', f)} : reads ch ${label([...x.chs][0] ?? '0')}`
        : `  ${nid('c', f)} ..> ${nid('d', short(x.dev))} : writes ch ${label([...x.chs][0] ?? '0')}`);
      devEdges++;
    }
  }
  let edges = 0;
  for (const f of shown) {
    for (const inc of includes.get(f.name) ?? []) {
      if (edges >= CAP.edges) break;
      if (shown.some(x => x.name === inc)) { cls.push(`  ${nid('c', f.name)} ..> ${nid('c', inc)} : include`); edges++; }
    }
  }
  for (const [file, cset] of calls) {
    if (edges >= CAP.edges) break;
    const cross = [...cset].filter(t => !t.includes('→')).map(t => decl.get(t)).filter(o => o && o !== file);
    const uniq = [...new Set(cross)] as string[];
    for (const tgt of uniq) {
      if (edges >= CAP.edges || !shown.some(x => x.name === tgt || x.name === file)) continue;
      cls.push(`  ${nid('c', file)} ..> ${nid('c', tgt)} : calls`); edges++;
    }
  }

  // ── FLOW (entries + structure; node files get their node graph) ───────
  const flow: string[] = ['flowchart LR'];
  let flowEdges = 0;
  // FLOW shows FEWER files than class (we: "for ASuper mario that became WAY
  // too large"): the structure view is a map, not an inventory.
  const flowShown = shown.slice(0, CAP.flowFiles);
  for (const f of flowShown) {
    flow.push(`  subgraph ${nid('f', f.name)}["${label(f.name)}"]`);
    const g = graphs.get(f.name);
    if (g) {
      const nodes = g.nodes.slice(0, CAP.nodeCls);
      for (const n of nodes)
        flow.push(`    ${nid('n', f.name + n.id)}["${label(n.title || n.type)}"]`);
      const byId = new Map(nodes.map(n => [n.id, n]));
      for (const n of nodes) for (const src of n.inputs ?? [])
        if (src && byId.has(src))
          flow.push(`    ${nid('n', f.name + src)} --> ${nid('n', f.name + n.id)}`);
      if (g.nodes.length > nodes.length)
        flow.push(`    more_${nid('n', f.name)}["… +${g.nodes.length - nodes.length} nodes"]`);
      flow.push('  end');
    } else {
      for (const e of entries.get(f.name) ?? [])
        flow.push(`    ${nid('e', f.name + e)}(["${label(ENTRY_MARK[e] ?? e)}"]):::entry`);
      const own = [...new Set(fns.get(f.name) ?? [])];
      for (const fn of own.slice(0, CAP.fns))
        flow.push(`    ${nid('fn', f.name + fn)}["${label(fn)}"]`);
      if (own.length > CAP.fns)
        flow.push(`    morefn_${nid('fn', f.name)}["… +${own.length - CAP.fns} functions"]`);
      for (const e of entries.get(f.name) ?? [])
        for (const fn of own.slice(0, CAP.fns))
          if (flowEdges < 12 && (f.code.includes(`${fn}(`) || f.code.includes(`${fn} (`))) {
            flow.push(`    ${nid('e', f.name + e)} --> ${nid('fn', f.name + fn)}`); flowEdges++;
          }
      flow.push('  end');
    }
  }
  if (shown.length > flowShown.length)
    flow.push(`  moref["… ${shown.length - flowShown.length} more file(s) — see the class diagram"]`);
  // ENTRY READABILITY v1.17.2 (we: "the entry points is hard to read"):
  // the entry nodes get a bright, BOLD, wide-stroked stadium — in the class
  // diagram the carrying class gets the same teal stroke so the eye lands
  // on «update · tick 25 Hz» first; devices stay amber. Mermaid honours
  // `style` in classDiagram, so the pairing needs no theme surgery.
  flow.push('  classDef entry fill:#0d3527,stroke:#7dffcf,stroke-width:2px,'
    + 'color:#eafff6,font-weight:bold');
  for (const f of shown)
    if ((entries.get(f.name) ?? []).length)
      flow.push(`  style ${nid('f', f.name)} stroke:#7dffcf,stroke-width:1.5px`);

  // ── SEQUENCE split in TWO bounded views (we: "doesnt couple input and
  //   output… maybe have two different ones") ────────────────────────────
  const byDir = (dir: 'in' | 'out') => [...tally.values()].filter(t => t.dir === dir)
    .sort((a, b) => b.n - a.n);
  const mkSeq = (dir: 'in' | 'out', title: string): XcDiagram => {
    const ranked = byDir(dir);
    const t = ranked.slice(0, CAP.seqDev);
    const seats = t.filter(x => x.dev.type === 'PilotSeat');
    const lines: string[] = ['sequenceDiagram'];
    if (seats.length) lines.push('  actor U as Pilot / user');
    lines.push('  participant P as ' + label(prog.alias));
    for (const x of t)
      lines.push(`  participant ${nid('d', short(x.dev))} as ${label(short(x.dev) + ' · ' + x.dev.type)}`);
    let msgs = 0;
    for (const x of t) {
      if (msgs >= CAP.seqMsg) break;
      const chs = [...x.chs].slice(0, 4).join(',');
      const txt = `${dir === 'in' ? 'read' : 'write'} ch ${label(chs)} \u00d7${x.n}`;
      if (x.dev.type === 'PilotSeat' && dir === 'in') {
        const first = +[...x.chs][0]!;
        lines.push(`  U->>+${nid('d', short(x.dev))}: press ${label(seatLabels?.[first] ? `(${seatLabels![first]})` : `ch ${[...x.chs][0]}`)}`);
        lines.push(`  ${nid('d', short(x.dev))}->>+P: ${label(txt)}`); msgs += 2;
      } else if (dir === 'in') { lines.push(`  ${nid('d', short(x.dev))}->>+P: ${label(txt)}`); msgs++; }
      else { lines.push(`  P->>+${nid('d', short(x.dev))}: ${label(txt)}`); msgs++; }
    }
    const folded = Math.max(0, t.length - msgs / 2) + Math.max(0, ranked.length - t.length);
    if (folded > 0)
      lines.push(`  Note over P: +${folded} quieter channel group(s) folded \u2014 full census in the rundown`);
    return { kind: dir === 'in' ? 'seqIn' : 'seqOut', title: `${prog.alias} \u2014 ${title}`, source: lines.join('\n') };
  };

  return [
    { kind: 'class', title: `${prog.alias} — class & wiring (files, methods, nodes)`, source: cls.join('\n') },
    { kind: 'flow', title: `${prog.alias} — structure (entries, functions, node graph)`, source: flow.join('\n') },
    mkSeq('in', 'INPUT flow — what the program reads'),
    mkSeq('out', 'OUTPUT flow — what the program writes'),
  ];
}

/** ── THE PURE-SVG LAW (v1.17.1, we: "SVG doesn't rendee images") ──
 *  mermaid renders node labels as <foreignObject><div> HTML (its
 *  htmlLabels:false does NOT stick in v12) — foreignObject content does
 *  not render once the SVG is exported, copied or embedded elsewhere: the
 *  diagrams arrive EMPTY. This post-pass rewrites every foreignObject label
 *  into a real SVG <text> (font-size kept from the inner style, entities
 *  re-escaped, vertical centre approximated), making each diagram pure
 *  vector — renders everywhere, always. Pure + vitest-pinned. */
export function svgTextOnly(svg: string): string {
  let out = svg.replace(/<foreignObject([^>]*)>([\s\S]*?)<\/foreignObject>/g,
    (_all, attrs: string, inner: string) => {
      const num = (k: string) => {
        const m = new RegExp(`${k}="(-?[\\d.]+)`).exec(attrs);
        return m ? parseFloat(m[1]!) : 0;
      };
      const fs = /font-size:\s*([\d.]+)px/.exec(inner);
      const size = fs ? parseFloat(fs[1]!) : 12;
      const text = inner
        .replace(/<br\s*\/?>(<\/p>)?/gi, ' ⏎ ')
        .replace(/<\/p>\s*<p[^>]*>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
      const x = num('x') + 3, y = num('y') + num('height') / 2 + size * 0.35;
      const anchor = /text-align:\s*center/.test(inner) ? ' middle' : '';
      const w = num('width');
      const clipped = text.length > 46 || text.includes('⏎');
      const show = text.length > 46 ? text.slice(0, 44) + '…' : text;
      void w;
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}"${anchor}` +
        ` class="fo2txt${clipped ? ' fo2sm' : ''}">${
          show.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</text>`;
    });
  if (out !== svg && !out.includes('.fo2txt')) {
    out = out.replace(/<svg\b[^>]*>/, m => `${m}<style>.fo2txt{fill:var(--text-color,#e8edf4);
      dominant-baseline:middle}.fo2sm{font-size:10px !important}</style>`);
  }
  return out;
}

/** ── THE CODE RUNDOWN (v1.17.1, we: "analysis doesn't contain more details
 *  on code structure or should give a better rundown") ── a structured
 *  inventory per file plus human-readable summary bullets: entry points,
 *  functions (args/return/LINES/file-local calls), storage vars, and the
 *  io census (every input_/output_ with its RESOLVED devices and the
 *  $var-token it rode). A separate scan from xcDiagrams on purpose: the
 *  diagram grammar stays frozen while the rundown grows. */
export interface RundownFn { name: string; args: string; ret: string; lines: number;
  calls: string[] }
export interface RundownIo { dir: 'in' | 'out'; token: string; resolved: string[];
  ch: string; line: number }
export interface RundownFile { name: string; lines: number; entries: string[];
  functions: RundownFn[]; vars: { name: string; storage: boolean; type: string }[];
  includes: string[]; io: RundownIo[] }
export interface CodeRundown { files: RundownFile[]; fanIn: { device: string; type: string;
  io: number; readers: number; writers: number }[]; summary: string[] }

export function codeRundown(prog: XcProgram): CodeRundown {
  const varStrs = new Map<string, Map<string, string[]>>();
  for (const f of prog.files) varStrs.set(f.name, varLiterals(f));
  const resolveNames = (file: string, tok: string): string[] => {
    const t = tok.trim();
    const hits = (pred: (d: XCDevice) => boolean) =>
      prog.devices.filter(pred).map(d => d.alias || `io ${d.io}`);
    if (/^\d+$/.test(t)) return hits(d => d.io === +t);
    if (/^".*"$/.test(t)) {
      const a = t.slice(1, -1).toLowerCase();
      return hits(d => d.alias.toLowerCase() === a);
    }
    if (t.startsWith('$')) {
      const lits = varStrs.get(file)?.get(t) ?? [];
      const out: string[] = [];
      for (const l of lits)
        for (const d of prog.devices)
          if (d.alias.toLowerCase() === l.toLowerCase() && !out.includes(d.alias)) out.push(d.alias);
      return out;
    }
    return [];
  };

  const files: RundownFile[] = [];
  const fnOwners = new Map<string, string>();          // @fn -> file (for calledBy)
  for (const f of prog.files) {
    let inFn: string | null = null;
    let fnStart = 0;
    const fns: RundownFn[] = [];
    const entries: string[] = [];
    const vars: RundownFile['vars'] = [];
    const includes: string[] = [];
    const io: RundownIo[] = [];
    const lines = f.code.split('\n');
    const bump = (i: number) => {
      if (inFn) { const fn = fns.find(x => x.name === inFn); if (fn) fn.lines = i - fnStart + 1; inFn = null; }
    };
    lines.forEach((raw, i) => {
      const line = stripNoise(raw);
      const declM = /^\s*(?:recursive\s+)?function\s+@([A-Za-z0-9_]+)(?:\(([^)]*)\))?\s*(?::\s*(number|text))?/.exec(line);
      if (declM) {
        bump(i - 1);
        fnOwners.set('@' + declM[1]!, f.name);
        fns.push({ name: declM[1]!, args: declM[2] ?? '', ret: declM[3] ?? '', lines: 1, calls: [] });
        inFn = declM[1]!; fnStart = i;
        return;
      }
      const entM = new RegExp('^\\s*(' + ENTRIES.join('|') + ')\\b').exec(line);
      if (entM) { bump(i - 1); if (!entries.includes(entM[1]!)) entries.push(entM[1]!); }
      const varM = /^\s*(storage\s+)?var\s+(\$[A-Za-z0-9_]+)\s*(?::\s*(\w+))?/.exec(line);
      if (varM) vars.push({ name: varM[2]!, storage: !!varM[1], type: varM[3] ?? 'var' });
      const inc = /^\s*include\s+"([^"]+)"/.exec(line);
      if (inc) includes.push(inc[1]!);
      for (const m of line.matchAll(/@([A-Za-z0-9_]+)\s*\(/g)) {
        const quotes = (line.slice(0, m.index ?? 0).match(/"/g) ?? []).length;
        if (quotes % 2) continue;
        const tok = '@' + m[1]!;
        if (inFn) { const fn = fns.find(x => x.name === inFn);
          if (fn && m[1] !== inFn && !fn.calls.includes(m[1]!)) fn.calls.push(m[1]!); }
        void tok;
      }
      const ioM = IO_RE.exec(line);
      if (ioM) io.push({ dir: ioM[1] === 'input' ? 'in' : 'out', token: ioM[3]!,
        resolved: resolveNames(f.name, ioM[3]!), ch: ioM[4]!.trim(), line: i + 1 });
    });
    bump(lines.length - 1);
    files.push({ name: f.name, lines: lines.length, entries, functions: fns, vars, includes, io });
  }
  void fnOwners;

  // fan-in census over the RESOLVED devices
  const fan = new Map<string, { device: string; type: string; io: number; readers: number; writers: number }>();
  for (const f of files)
    for (const ev of f.io)
      for (const name of ev.resolved) {
        const d = prog.devices.find(x => (x.alias || `io ${x.io}`) === name);
        const k = name + '|' + (d?.io ?? -1);
        if (!fan.has(k)) fan.set(k, { device: name, type: d?.type ?? '?', io: d?.io ?? -1, readers: 0, writers: 0 });
        if (ev.dir === 'in') fan.get(k)!.readers++; else fan.get(k)!.writers++;
      }

  const summary: string[] = [];
  for (const f of files) {
    const storage = f.vars.filter(v => v.storage).length;
    const w = f.io.filter(i => i.dir === 'out').length, r = f.io.filter(i => i.dir === 'in').length;
    summary.push(`${f.name}: ${f.lines} lines · entries ${f.entries.length ? f.entries.join('/') : '—'}` +
      ` · ${f.functions.length} function(s)${storage ? ` · ${storage} storage var(s)` : ''}` +
      ` · reads ${r}, writes ${w}`);
    const varTok = f.io.find(i => i.token.startsWith('$') && i.resolved.length > 1);
    if (varTok) summary.push(`${f.name}: token ${varTok.token} is a SWITCH — resolves to ` +
      `${varTok.resolved.join(', ')} (assigned strings in source)`);
    const heaviest = [...f.functions].sort((a, b) => b.lines - a.lines)[0];
    if (heaviest && heaviest.lines > 15) summary.push(`${f.name}: heaviest @${heaviest.name}` +
      ` (${heaviest.lines} lines${heaviest.calls.length ? `, calls @${heaviest.calls.join(', @')}` : ''})`);
  }
  const topFan = [...fan.values()].sort((a, b) => (b.readers + b.writers) - (a.readers + a.writers))[0];
  if (topFan) summary.push(`bus fan-in top: ${topFan.device} (${topFan.type}) read ${topFan.readers}× written ${topFan.writers}×`);
  return { files, fanIn: [...fan.values()], summary };
}

/** does the craft carry flight surfaces? (the analysis report's flight
 *  gate — we: "flight characteristics … not logical for a rover or for
 *  Mario") */
export function craftIsFlyable(bp: { data: { components: { type: string }[] } }): boolean {
  return bp.data.components.some(c =>
    c.type === 'Aileron' || c.type === 'Elevator' || c.type === 'Rudder' || c.type === 'AerodynamicProfile');
}

/** ── THE ANALYSIS REPORT (we: "essentially mermaid html should read like a
 *  detailed analysis of craft") ── a self-contained HTML document: the
 *  vessel plates (top/front PNG data-URLs), every computer's mermaid SVGs
 *  and sources, and the flight section ONLY when the craft carries flight
 *  surfaces (a rover or a Mario cabinet gets no aero theatre). PURE string
 *  builder — the dialog hands it exactly what it rendered. */
export interface ReportSection { compAlias: string;
  /** v1.17.2 THE VECTORIZATION: the FRONT/SIDE/TOPSIDE trio as ONE inline
   *  SVG sheet (sharp at any zoom; the dialog renders it zoomable). */
  plateSvg?: string;
  diagrams: XcDiagram[]; svgs: (string | null)[]; rundown?: CodeRundown;
  compute?: ReportCompute }
/** the craft header (v1.17.2, we: "weight, costs and flight characteristics
 *  should be higher up in the analysis"): the mass model + the build-cost
 *  twin, rendered FIRST in both dialog and export. */
export interface ReportSummary { massKg: number; weightN: number;
  costRaw?: number; costTime?: number;
  /** THE INFO RECAP (v1.17.2, we: "Analysis should just contain a recap
   *  of what infop tabs tells us"): the ⌖ Info tab's numbers — the mass
   *  families, the sealed envelope and its vacuum lift. */
  families?: { hull: number; skin: number; struts: number; beams: number;
    parts: number; fluids: number };
  declared?: number; envelopeM3?: number; envelopeSealed?: boolean;
  liftVacuumKg?: number }
export interface ReportFlight { speed: number; mass: number; stallSpeed: number; ldMax: number;
  staticMarginPct: number; pitchVerdict: string; yawVerdict: string;
  rows: { axis: string; part: string; authority: number; buried?: boolean }[];
  /* the FULL FLIGHT LAB stat set (v1.17.1, we: "other flight stats can go
     into there too") */
  altitude?: number; rho?: number; q?: number; weight?: number;
  planform?: { S: number; span: number; chord: number; AR: number; zAc: number };
  clAlpha?: number; clMax?: number; cd0?: number; kInd?: number; ldTrim?: number;
  trimAlphaDeg?: number; trimElevatorDeg?: number | null; neutralZ?: number;
  frontal?: number; fin?: { area: number; lever: number };
  curve?: { alphaDeg: number; cl: number; cd: number }[] }

/** ── THE WORK CENSUS LAW (v1.17.1) ── the measured per-cycle work is in
 *  the game's OWN units: XenonCode's IPC penalty counters (builtins cost
 *  their argument count, array ops their size…), zeroed every cycle — the
 *  number the in-game BIOS shows and the server's Max IPC clamps. The
 *  documentation Archean HAS (quoted, verbatim bases):
 *   · wiki Computer.md: "Max IPC: … determined by a configuration file …
 *     the maximum number of instructions per cycle before it 'crashes'
 *     virtually."  → the CAP is a SERVER setting, not blueprint data; the
 *     editor engine runs UNLIMITED (the shim's system_ipc = 0 = POC).
 *   · wiki Computer.md: "consumes 30 watts when idle and … up to 500 watts
 *     depending on the ratio between the number of instructions executed
 *     … and the current MAX IPC" → the energy↔work correspondence below.
 *   · wiki hud.md: "HUDs are entirely managed by the client" → NO server
 *     tick, NO Max IPC budget — HUD numbers are informational only. */
export interface ReportCompute { alias: string; isHud: boolean; workEma: number | null;
  samples: number; live?: boolean }
export const GAME_IPC_LAW = 'Max IPC (wiki Computer.md): max instructions/cycle before the ' +
  'computer "crashes" virtually — a SERVER config value, not blueprint data. The editor ' +
  'engine parity: unlimited (system_ipc = 0).';
export const GAME_POWER_LAW = 'In-game power (wiki Computer.md): 30 W idle, up to 500 W as the ' +
  'instructions-per-cycle / Max IPC ratio rises — work IS energy.';
export const GAME_HUD_LAW = 'HUDs (wiki hud.md): entirely client-managed — no server tick, no ' +
  'Max IPC budget; the editor HUD numbers are informational.';
/** the documented linear ratio (idle 30 W at 0 %, 500 W at 100 % Max IPC) */
export function estWatts(work: number, maxIpc: number): number {
  return 30 + 470 * Math.min(1, Math.max(0, work / Math.max(1, maxIpc)));
}

/** the FLIGHT READING (v1.17.2: hoisted out of the section loop so the
 *  export can place it HIGH — we: "flight characteristics should be
 *  higher up in the analysis"). */
function buildFlightHtml(f: ReportFlight, esc: (s: string) => string): string {
  return `<h2>Flight characteristics</h2>
<p class="note">Closed-form shape-field analysis (the editor's FLIGHT LAB): planform census
over the voxelized hull, lift-curve + stall, fineness/Re drag, CG vs neutral point. This is
NOT CFD — no Navier–Stokes field solve exists in the editor (see docs/CFD-FEASIBILITY.md);
vortex/shedding questions need an external solver.</p>
<table><tr><th>mass</th><td>${f.mass.toFixed(0)} kg</td><th>weight</th>
<td>${(f.weight ?? 0).toFixed(0)} N</td><th>analysis speed</th>
<td>${f.speed} m/s</td><th>stall speed</th><td>${f.stallSpeed.toFixed(1)} m/s</td>
<th>L/D max</th><td>${f.ldMax.toFixed(1)}</td></tr>
${f.planform ? `<tr><th>wing area S</th><td>${f.planform.S.toFixed(2)} m²</td>
<th>span</th><td>${f.planform.span.toFixed(2)} m</th><th>chord c̄</th>
<td>${f.planform.chord.toFixed(2)} m</td><th>AR</th><td>${f.planform.AR.toFixed(2)}</td></tr>
<tr><th>C<sub>Lα</sub></th><td>${(f.clAlpha ?? 0).toFixed(2)} /rad</td>
<th>C<sub>Lmax</sub></th><td>${(f.clMax ?? 0).toFixed(2)}</td>
<th>C<sub>D0</sub></th><td>${(f.cd0 ?? 0).toFixed(4)}</td>
<th>K (induced)</th><td>${(f.kInd ?? 0).toFixed(3)}</td></tr>
<tr><th>L/D trim</th><td>${(f.ldTrim ?? 0).toFixed(1)}</td>
<th>trim AoA</th><td>${(f.trimAlphaDeg ?? 0).toFixed(1)}°</td>
<th>elevator trim</th><td>${f.trimElevatorDeg === null || f.trimElevatorDeg === undefined ? '—' : f.trimElevatorDeg.toFixed(1) + '°'}</td>
<th>frontal</th><td>${(f.frontal ?? 0).toFixed(2)} m²</td></tr>
<tr><th>altitude / ρ / q</th><td>${f.altitude ?? 0} m / ${(f.rho ?? 0).toFixed(3)} / ${(f.q ?? 0).toFixed(0)} Pa</td>
<th>neutral point z</th><td>${(f.neutralZ ?? 0).toFixed(2)} m</td>
<th>fin</th><td>${f.fin ? f.fin.area.toFixed(2) + ' m² @ ' + f.fin.lever.toFixed(1) + ' m' : '—'}</td></tr>` : ''}
${f.curve?.length ? `<details><summary style="cursor:pointer;font-size:12px;color:#9fb0c8">lift/drag polar (α, C<sub>L</sub>, C<sub>D</sub>)</summary>
<table><tr><th>α°</th><th>C<sub>L</sub></th><th>C<sub>D</sub></th></tr>
${f.curve.map(c => `<tr><td>${c.alphaDeg}</td><td>${c.cl.toFixed(3)}</td><td>${c.cd.toFixed(4)}</td></tr>`).join('')}</table></details>` : ''}
<tr><th>static margin</th><td>${f.staticMarginPct.toFixed(1)} % MAC</th>
<th>pitch</th><td><span class="verdict ${f.pitchVerdict}">${f.pitchVerdict}</span></td>
<th>yaw</th><td><span class="verdict ${f.yawVerdict}">${f.yawVerdict}</span></td></tr></table>
<h3>Control authority per surface</h3><table><tr><th>axis</th><th>part</th>
<th>moment @ q (N·m, ±45°)</th></tr>
${f.rows.map(r => `<tr><td>${esc(r.axis)}</td><td>${r.buried
  ? '⚠ <s>' + esc(r.part) + '</s> <span class=verdict unstable>buried in the collider mass — reads ≈ no authority</span>'
  : esc(r.part)}</td><td>${r.authority.toFixed(0)}</td></tr>`).join('')}</table>`;
}

export function buildAnalysisHtml(opts: { craft: string; sections: ReportSection[];
  flight?: ReportFlight | null; summary?: ReportSummary | null }): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // THE CRAFT HEADER FIRST (v1.17.2, we: "weight, costs and flight
  // characteristics should be higher up in the analysis"): mass/weight/
  // cost, then the FLIGHT READING, then the per-computer sections.
  const summaryHtml = opts.summary ? `<table><tr><th>mass</th>
 <td>${opts.summary.massKg.toFixed(0)} kg</td><th>weight</th>
 <td>${opts.summary.weightN.toFixed(0)} N</td>
 <th>build cost</th><td>${opts.summary.costRaw === undefined
    ? '—' : opts.summary.costRaw.toLocaleString('en-US') + ' raw material units'
    + (opts.summary.costTime ? ` · ${Math.round(opts.summary.costTime / 60)} min build time` : '')}</td></tr>
 ${opts.summary.families ? `<tr><th>mass families</th><td>hull ${opts.summary.families.hull.toFixed(0)} · skin ${opts.summary.families.skin.toFixed(0)}`
    + ` · parts ${opts.summary.families.parts.toFixed(0)} · struts ${opts.summary.families.struts.toFixed(0)}`
    + ` · beams ${opts.summary.families.beams.toFixed(0)} · fluids ${opts.summary.families.fluids.toFixed(0)} kg</td>`
    + `<th>declared</th><td>${(opts.summary.declared ?? 0).toFixed(0)} kg</td>`
    + `<th>envelope</th><td>${opts.summary.envelopeM3 ? opts.summary.envelopeM3.toFixed(1) + ' m³ (' + (opts.summary.envelopeSealed ? 'sealed' : 'open') + ')'
      + (opts.summary.liftVacuumKg !== undefined ? ` · vacuum lift ${opts.summary.liftVacuumKg.toFixed(0)} kg` : '') : 'none sealed'}</td></tr>` : ''}</table>` : '';
  const flightHtml = opts.flight ? buildFlightHtml(opts.flight, esc)
    : `<h2>Flight characteristics</h2><p class="note">Not applicable — this craft
carries no flight-control surfaces (rover/cabinet logic); the flight section is gated out.</p>`;
  const parts: string[] = [`<!doctype html><html><head><meta charset="utf-8">
<title>Archean craft analysis — ${esc(opts.craft)}</title><style>
body{font:14px/1.5 ui-sans-serif,system-ui;background:#0b1220;color:#dbe4f0;margin:0;padding:24px}
h1{font-size:20px;color:#7dffcf} h2{font-size:16px;margin-top:28px;color:#9fd0ff}
h3{font-size:13px;margin:18px 0 6px;color:#e8edf4}
.plates{display:flex;gap:12px;flex-wrap:wrap} .plates figure{margin:0}
.plates img{width:320px;max-width:30vw;border:1px solid #22314a;border-radius:6px}
.plate-sheet{margin:12px 0} .plate-sheet svg{width:100%;max-width:1200px;
height:auto;border:1px solid #22314a;border-radius:8px}
figcaption{font-size:11px;color:#8b93a1;margin-top:4px}
.mm{background:#101a2b;border-radius:8px;padding:8px;overflow:auto;max-width:1200px}
.mm svg{max-width:100%} details{margin:6px 0} pre{background:#101a2b;color:#b7c6dd;padding:10px;
border-radius:6px;overflow:auto;font-size:11px}
table{border-collapse:collapse}td,th{border:1px solid #22314a;padding:4px 10px;font-size:12px}
.verdict{padding:2px 8px;border-radius:10px;font-size:11px}
.stable{background:#123d2a;color:#7dffcf}.unstable{background:#4a1520;color:#ff9d9d}
.neutral,.unknown{background:#3a3418;color:#ffe08a}
.note{color:#8b93a1;font-size:12px;max-width:820px}</style></head><body>
<h1>Archean craft analysis — ${esc(opts.craft)}</h1>
<p class="note">Scroll a diagram with the scrollbar, wheel-zoom inside it,
drag with the middle/space key, double-click resets (script at the bottom).</p>
${summaryHtml}${flightHtml}
<nav>${opts.sections.map(s => `<a href="#comp-${esc(s.compAlias)}"
  style="color:#8fd4ff;margin-right:14px;font-size:12px">▸ ${esc(s.compAlias)}</a>`).join('')}</nav>`];
  for (const s of opts.sections) {
    parts.push(`<h2 id="comp-${esc(s.compAlias)}">Computer ${esc(s.compAlias)}</h2>`);
    if (s.plateSvg) parts.push(`<figure class="plate-sheet">${s.plateSvg}
<figcaption>blueprint plate — front · side · topside on a metre grid: hull
hairlines, parts quiet, ONLY the actors inked in their label colour, cabled
runs amber + io tags, leader-line labels</figcaption></figure>`);
    if (s.compute) {
      const c = s.compute;
      parts.push(`<h3>Compute budget</h3><p style="font-size:12px;color:#c8d4e4">
 measured work: <b>${c.workEma === null ? 'n/a (engine predates the census seam)' : c.workEma.toFixed(0) + ' IPC penalty units / cycle'}</b>
 (EMA over ${c.samples} cycles)${c.isHud ? ' — HUD runtime: ' + GAME_HUD_LAW : ' — ' + GAME_IPC_LAW + ' ' + GAME_POWER_LAW}</p>`);
    }
    if (s.rundown) {
      parts.push(`<h3>Code structure</h3><ul style="font-size:12px;color:#c8d4e4">` +
        s.rundown.summary.map(b => `<li>${esc(b)}</li>`).join('') + `</ul>
<table><tr><th>file</th><th>lines</th><th>entries</th><th>functions</th>
<th>storage vars</th><th>io reads / writes</th></tr>` +
        s.rundown.files.map(f => `<tr><td>${esc(f.name)}</td><td>${f.lines}</td>
<td>${esc(f.entries.join(', ') || '—')}</td>
<td>${f.functions.map(fn => esc('@' + fn.name) + (fn.ret ? `: ${fn.ret}` : '')).join('<br>') || '—'}</td>
<td>${esc(f.vars.filter(v => v.storage).map(v => v.name).join(', ') || '—')}</td>
<td>${f.io.filter(i => i.dir === 'in').length} / ${f.io.filter(i => i.dir === 'out').length}</td></tr>`).join('') +
        `</table><h4>Device fan-in</h4><table><tr><th>device</th><th>type</th><th>io</th>
<th>reads</th><th>writes</th></tr>` +
        s.rundown.fanIn.map(x => `<tr><td>${esc(x.device)}</td><td>${esc(x.type)}</td><td>${x.io}</td>
<td>${x.readers}</td><td>${x.writers}</td></tr>`).join('') + '</table>');
      for (const f of s.rundown.files) {
        if (!f.functions.length) continue;
        parts.push(`<details><summary style="cursor:pointer;font-size:12px;color:#9fb0c8">functions of ${esc(f.name)}</summary>
<table><tr><th>function</th><th>args</th><th>returns</th><th>lines</th><th>calls</th></tr>` +
          f.functions.map(fn => `<tr><td>@${esc(fn.name)}</td><td>${esc(fn.args || '—')}</td>
<td>${esc(fn.ret || '—')}</td><td>${fn.lines}</td><td>${fn.calls.map(c => esc('@' + c)).join(', ') || '—'}</td></tr>`).join('') +
          '</table></details>');
      }
    }
    s.diagrams.forEach((d, i) => {
      parts.push(`<h3>${esc(d.title)}</h3>`);
      if (s.svgs[i]) parts.push(`<div class="mm">${s.svgs[i]}</div>`);
      parts.push(`<details><summary>mermaid source</summary><pre>${esc(d.source)}</pre></details>`);
    });
  }
  parts.push(`<script>
for (const box of document.querySelectorAll('.mm')) {
  let k = 1;
  const apply = () => { const svg = box.querySelector('svg'); if (svg) svg.style.transform = 'scale(' + k + ')'; svg.style.transformOrigin = '0 0'; };
  box.addEventListener('wheel', e => { k = Math.min(6, Math.max(0.2, k * (e.deltaY < 0 ? 1.15 : 0.87))); apply(); e.preventDefault(); }, { passive: false });
  box.addEventListener('dblclick', () => { k = 1; apply(); });
  box.style.cursor = 'grab';
}
</script></body></html>`);
  return parts.join('\n');
}
