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
export interface XcDiagram { kind: 'flow' | 'sequence' | 'class'; title: string; source: string }

interface FnInfo { name: string; sig: string; ret: string }

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

interface IoEvent { file: string; dir: 'in' | 'out'; token: string; ch: string; fn: string }

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

export function xcDiagrams(prog: XcProgram, seatLabels?: Record<number, string>): XcDiagram[] {
  const files = prog.files;
  const decl = new Map<string, string>();              // @fn -> owning file
  const fns = new Map<string, FnInfo[]>();             // file -> declared fns
  const entries = new Map<string, string[]>();         // file -> entry words
  const calls = new Map<string, Set<string>>();        // file -> @fn tokens used
  const includes = new Map<string, Set<string>>();
  const ios: IoEvent[] = [];
  const varStrs = new Map<string, Map<string, string[]>>();

  for (const f of files) {
    varStrs.set(f.name, varLiterals(f));
    for (const raw of f.code.split('\n')) {
      const line = stripNoise(raw);
      const declM = /^\s*(?:recursive\s+)?function\s+@([A-Za-z0-9_]+)/.exec(line);
      if (declM) {
        const name = declM[1]!;
        decl.set('@' + name, f.name);
        const sig = /\(([^)]*)\)\s*(?::\s*(number|text))?/.exec(line.slice(line.indexOf('@' + name)));
        if (!fns.has(f.name)) fns.set(f.name, []);
        fns.get(f.name)!.push({ name, sig: sig?.[1] ?? '', ret: sig?.[2] ?? '' });
        continue;
      }
      const entM = new RegExp('^\\s*(' + ENTRIES.join('|') + ')(?:\\.\\$?[A-Za-z0-9_]+)?\\b').exec(line);
      if (entM) {
        const list = entries.get(f.name) ?? [];
        const qual = /^\s*[a-z_]+\.\$?([A-Za-z0-9_]+)/.exec(line);
        const word = entM[1]! + (qual ? ' · ' + qual[1] : '');
        if (!list.includes(word)) list.push(word);
        entries.set(f.name, list);
      }
      for (const m of line.matchAll(/@([A-Za-z0-9_]+)\s*\(/g)) {
        // strings are inert to the call search (the analyzer's law): an odd
        // quote-count before the match means it lives inside a string
        const quotes = (line.slice(0, m.index ?? 0).match(/"/g) ?? []).length;
        if (quotes % 2) continue;
        if (!calls.has(f.name)) calls.set(f.name, new Set());
        calls.get(f.name)!.add('@' + m[1]!);
      }
      const inc = /^\s*include\s+"([^"]+)"/.exec(line);
      if (inc) {
        if (!includes.has(f.name)) includes.set(f.name, new Set());
        includes.get(f.name)!.add(inc[1]!);
      }
      const io = IO_RE.exec(line);
      if (io) ios.push({ file: f.name, dir: io[1] === 'input' ? 'in' : 'out',
        token: io[3]!, ch: io[4]!.trim(), fn: `${io[1]}_${io[2]}` });
    }
  }
  // cross-file call edges: owner file -> target file (via the @fn's owner)
  const callEdges = new Map<string, Set<string>>();
  for (const [file, toks] of calls)
    for (const tok of toks) {
      const owner = decl.get(tok);
      if (!owner || owner === file) continue;
      if (!callEdges.has(file)) callEdges.set(file, new Set());
      callEdges.get(file)!.add(owner + '\u0000' + tok);
    }

  // ── device actor model (FULLY RESOLVED names) ──────────────────────────
  const devKey = (d: XCDevice) => `${d.alias || 'io ' + d.io} · ${d.type} · io ${d.io}`;
  const touched = new Map<string, { dev: XCDevice; ins: Set<string>; outs: Set<string> }>();
  const dkey = (d: XCDevice) => `${d.alias}|${d.io}`;
  const resolve = (file: string, tok: string): XCDevice[] => {
    const t = tok.trim();
    if (/^\d+$/.test(t)) return prog.devices.filter(d => d.io === +t);
    if (/^".*"$/.test(t)) {
      const a = t.slice(1, -1).toLowerCase();
      return prog.devices.filter(d => d.alias.toLowerCase() === a);
    }
    if (t.startsWith('$')) {
      const lits = varStrs.get(file)?.get(t) ?? [];
      const out: XCDevice[] = [];
      for (const l of lits)
        for (const d of prog.devices)
          if (d.alias.toLowerCase() === l.toLowerCase() && !out.includes(d)) out.push(d);
      return out;
    }
    return [];
  };
  for (const ev of ios)
    for (const d of resolve(ev.file, ev.token)) {
      const k = dkey(d);
      if (!touched.has(k)) touched.set(k, { dev: d, ins: new Set(), outs: new Set() });
      (ev.dir === 'in' ? touched.get(k)!.ins : touched.get(k)!.outs).add(ev.ch);
    }

  // ── FLOW ────────────────────────────────────────────────────────────────
  const flow: string[] = ['flowchart TD'];
  for (const f of files) {
    flow.push(`  subgraph ${nid('f', f.name)}["${label(f.name)}"]`);
    for (const e of entries.get(f.name) ?? [])
      flow.push(`    ${nid('e', f.name + e)}(["${label(e)}"]):::entry`);
    for (const fn of fns.get(f.name) ?? [])
      flow.push(`    ${nid('fn', f.name + fn.name)}["@${label(fn.name)}"]`);
    flow.push('  end');
  }
  flow.push('  classDef entry fill:#123,stroke:#7dffcf,color:#eafff6;');
  for (const f of files) {
    for (const e of entries.get(f.name) ?? [])
      for (const fn of fns.get(f.name) ?? [])
        if (new RegExp('@' + fn.name + '\\s*\\(').test(f.code))
          flow.push(`  ${nid('e', f.name + e)} --> ${nid('fn', f.name + fn.name)}`);
    for (const inc of includes.get(f.name) ?? [])
      if (files.some(x => x.name === inc))
        flow.push(`  ${nid('f', f.name)} -. include .-> ${nid('f', inc)}`);
    for (const edge of callEdges.get(f.name) ?? []) {
      const [tgt, tok] = edge.split('\u0000');
      flow.push(`  ${nid('f', f.name)} -. "calls ${label(tok!)}" .-> ${nid('f', tgt!)}`);
    }
  }

  // ── SEQUENCE (user = the pilot; devices = system actors) ───────────────
  const seq: string[] = ['sequenceDiagram', '  autonumber'];
  seq.push('  actor U as Pilot / user');
  const parts = [...touched.values()].sort((a, b) =>
    (a.dev.type === 'PilotSeat' ? 0 : 1) - (b.dev.type === 'PilotSeat' ? 0 : 1));
  for (const t of parts)
    seq.push(`  participant ${nid('d', dkey(t.dev))} as ${label(devKey(t.dev))}`);
  for (const f of files)
    seq.push(`  participant ${nid('p', f.name)} as ${label(prog.alias + ' · ' + f.name)}`);
  // SOLID arrows: ->> is mermaid's solid message (the dotted -.-> family
  // is for relations — sequence messages read as data flow).
  for (const t of parts) if (t.dev.type === 'PilotSeat')
    for (const ch of [...t.ins].slice(0, 8)) {
      const w = seatLabels?.[+ch] ? ` (${seatLabels[+ch]})` : '';
      seq.push(`  U->>+${nid('d', dkey(t.dev))}: press ch ${label(ch)}${w}`);
    }
  for (const ev of ios) {
    const devs = resolve(ev.file, ev.token);
    if (!devs.length) continue;
    for (const d of devs.slice(0, 3)) {
      const dpart = nid('d', dkey(d)), ppart = nid('p', ev.file);
      if (ev.dir === 'out') seq.push(`  ${ppart}->>+${dpart}: ${ev.fn} ch ${label(ev.ch)}`);
      else {
        const w = d.type === 'PilotSeat' && seatLabels?.[+ev.ch] ? ` (${seatLabels[+ev.ch]})` : '';
        seq.push(`  ${dpart}->>+${ppart}: ${ev.fn} ch ${label(ev.ch)}${w}`);
      }
    }
  }
  for (const [file, edges] of callEdges)
    for (const edge of edges) {
      const [tgt, tok] = edge.split('\u0000');
      seq.push(`  ${nid('p', file)}->>+${nid('p', tgt!)}: ${label(tok!)}()`);
    }
  for (const f of files) {
    const ent = (entries.get(f.name) ?? []).filter(e => !e.includes(' · '));
    if (ent.length) seq.push(`  Note over ${nid('p', f.name)}: ${label('entry: ' + ent.join(', '))}`);
  }

  // ── CLASS (files as classes) ───────────────────────────────────────────
  const cls: string[] = ['classDiagram'];
  for (const f of files) {
    const cname = nid('c', f.name);
    cls.push(`  class ${cname}["${label(f.name)}"] {`);
    const vars = [...f.code.matchAll(/^\s*(?:storage\s+)?var\s+(\$[A-Za-z0-9_]+)\s*(?::\s*(number|text))?/gm)];
    for (const v of vars.slice(0, 40)) cls.push(`    +${v[2] ?? 'var'} ${label(v[1]!)}`);
    for (const fn of fns.get(f.name) ?? []) {
      const args = fn.sig.replace(/\$([A-Za-z0-9_]+)/g, '$1').slice(0, 40);
      cls.push(`    +${label(fn.name)}(${label(args)})${fn.ret ? ' ' + fn.ret : ''}`);
    }
    cls.push('  }');
    for (const inc of includes.get(f.name) ?? [])
      if (files.some(x => x.name === inc)) cls.push(`  ${cname} ..> ${nid('c', inc)} : include`);
    for (const edge of callEdges.get(f.name) ?? []) {
      const [tgt, tok] = edge.split('\u0000');
      cls.push(`  ${cname} ..> ${nid('c', tgt!)} : calls ${label(tok!)}`);
    }
  }

  return [
    { kind: 'flow', title: `${prog.alias} — entry points & call graph`, source: flow.join('\n') },
    { kind: 'sequence', title: `${prog.alias} — the pilot, the devices, the program`, source: seq.join('\n') },
    { kind: 'class', title: `${prog.alias} — files as classes`, source: cls.join('\n') },
  ];
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
export interface ReportSection { compAlias: string; plateTop?: string; plateFront?: string;
  diagrams: XcDiagram[]; svgs: (string | null)[] }
export interface ReportFlight { speed: number; mass: number; stallSpeed: number; ldMax: number;
  staticMarginPct: number; pitchVerdict: string; yawVerdict: string;
  rows: { axis: string; part: string; authority: number; buried?: boolean }[] }

export function buildAnalysisHtml(opts: { craft: string; sections: ReportSection[];
  flight?: ReportFlight | null }): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const parts: string[] = [`<!doctype html><html><head><meta charset="utf-8">
<title>Archean craft analysis — ${esc(opts.craft)}</title><style>
body{font:14px/1.5 ui-sans-serif,system-ui;background:#0b1220;color:#dbe4f0;margin:0;padding:24px}
h1{font-size:20px;color:#7dffcf} h2{font-size:16px;margin-top:28px;color:#9fd0ff}
h3{font-size:13px;margin:18px 0 6px;color:#e8edf4}
.plates{display:flex;gap:12px;flex-wrap:wrap} .plates figure{margin:0}
.plates img{width:420px;max-width:44vw;border:1px solid #22314a;border-radius:6px}
figcaption{font-size:11px;color:#8b93a1;margin-top:4px}
.mm{background:#fff;border-radius:8px;padding:8px;overflow:auto;max-width:1040px}
.mm svg{max-width:100%} details{margin:6px 0} pre{background:#101a2b;color:#b7c6dd;padding:10px;
border-radius:6px;overflow:auto;font-size:11px}
table{border-collapse:collapse}td,th{border:1px solid #22314a;padding:4px 10px;font-size:12px}
.verdict{padding:2px 8px;border-radius:10px;font-size:11px}
.stable{background:#123d2a;color:#7dffcf}.unstable{background:#4a1520;color:#ff9d9d}
.neutral,.unknown{background:#3a3418;color:#ffe08a}
.note{color:#8b93a1;font-size:12px;max-width:820px}</style></head><body>
<h1>Archean craft analysis — ${esc(opts.craft)}</h1>`];
  for (const s of opts.sections) {
    parts.push(`<h2>Computer ${esc(s.compAlias)}</h2>`);
    if (s.plateTop || s.plateFront) parts.push(`<div class="plates">
<figure><img src="${s.plateTop ?? ''}"><figcaption>topside (orthographic; amber = actors,
amber lines = cabled runs with io tags)</figcaption></figure>
<figure><img src="${s.plateFront ?? ''}"><figcaption>front view</figcaption></figure></div>`);
    s.diagrams.forEach((d, i) => {
      parts.push(`<h3>${esc(d.title)}</h3>`);
      if (s.svgs[i]) parts.push(`<div class="mm">${s.svgs[i]}</div>`);
      parts.push(`<details><summary>mermaid source</summary><pre>${esc(d.source)}</pre></details>`);
    });
  }
  if (opts.flight) {
    const f = opts.flight;
    parts.push(`<h2>Flight characteristics</h2>
<p class="note">Closed-form shape-field analysis (the editor's FLIGHT LAB): planform census
over the voxelized hull, lift-curve + stall, fineness/Re drag, CG vs neutral point. This is
NOT CFD — no Navier–Stokes field solve exists in the editor (see docs/CFD-FEASIBILITY.md);
vortex/shedding questions need an external solver.</p>
<table><tr><th>mass</th><td>${f.mass.toFixed(0)} kg</td><th>analysis speed</th>
<td>${f.speed} m/s</td><th>stall speed</th><td>${f.stallSpeed.toFixed(1)} m/s</td>
<th>L/D max</th><td>${f.ldMax.toFixed(1)}</td></tr>
<tr><th>static margin</th><td>${f.staticMarginPct.toFixed(1)} % MAC</th>
<th>pitch</th><td><span class="verdict ${f.pitchVerdict}">${f.pitchVerdict}</span></td>
<th>yaw</th><td><span class="verdict ${f.yawVerdict}">${f.yawVerdict}</span></td></tr></table>
<h3>Control authority per surface</h3><table><tr><th>axis</th><th>part</th>
<th>moment @ q (N·m, ±45°)</th></tr>
${f.rows.map(r => `<tr><td>${esc(r.axis)}</td><td>${r.buried
  ? '⚠ <s>' + esc(r.part) + '</s> <span class=verdict unstable>buried in the collider mass — reads ≈ no authority</span>'
  : esc(r.part)}</td><td>${r.authority.toFixed(0)}</td></tr>`).join('')}</table>`);
  } else {
    parts.push(`<h2>Flight characteristics</h2><p class="note">Not applicable — this craft
carries no flight-control surfaces (rover/cabinet logic); the flight section is gated out.</p>`);
  }
  parts.push('</body></html>');
  return parts.join('\n');
}
