// XenonLibrary.tsx — THE LIBRARY OF DEFINITIONS side-tab body, extracted
// verbatim from the computer IDE (v1.15.5, we: "library of functions is
// missing like it is for the computer in our HUD screen") so the HUD IDE
// carries the SAME index: the disk's declared @functions (click = jump to
// the declaration), the built-in callables (the xcproject table with our
// one-line summaries), the game's global constants (colors/alignment/math,
// swatched) and the screen members. Category chips + one search row filter
// every group.
import { useMemo, useState } from 'react';
import {
  XC_LIB_DOC, XC_LIB_GROUPS, XC_SCREEN_MEMBERS, XC_GLOBAL_CONSTS, libIndex,
} from '../engine/xcproject';

export interface LibFn { file: string; line: number; name: string; display: string }

export default function XenonLibrary(p: {
  funcs: LibFn[];
  onJump: (file: string, line: number) => void;
  ownerLabel: string;            // 'On this computer ·' / 'On this HUD ·'
  testId: string;                // 'xenon' | 'hud' — keeps every testid
  extraMembers?: string[];       // HUD: the panel/beacon member chips
}) {
  const { funcs, onJump, ownerLabel, testId } = p;
  const [q, setQ] = useState('');
  // LIBRARY group tabs (v1.13.26, we: "library function should be in tabs,
  // screen, system, IO should all have their own coloured category")
  const [g, setG] = useState('all');
  const libColor = (k: string) => XC_LIB_GROUPS.find(x => x.key === k)?.color ?? '#5d6a7d';
  const libFuncs = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s
      ? funcs.filter(f => f.display.toLowerCase().includes(s) || f.file.toLowerCase().includes(s))
      : funcs;
  }, [funcs, q]);
  const libDocs = useMemo(
    () => libIndex(q).filter(f => g === 'all' || f.group === g),
    [q, g]);
  // v1.13.27: the game's global constants — Colors/Alignment/Math chips
  // filter them; a function-group chip hides the section, 'All' shows all
  const libConsts = useMemo(() => {
    const s = q.trim().toLowerCase();
    return XC_GLOBAL_CONSTS.filter(c =>
      (g === 'all' || c.kind === g)
      && (!s || c.name.includes(s) || c.desc.toLowerCase().includes(s) || c.kind.includes(s)));
  }, [q, g]);
  const libMembers = useMemo(() => {
    const s = q.trim().toLowerCase();
    const all = XC_SCREEN_MEMBERS.concat(p.extraMembers ?? []);
    return s ? all.filter(m => m.includes(s)) : all;
  }, [q, p.extraMembers]);
  return (<>
    <input data-testid={`${testId}-lib-search`} value={q} placeholder="search functions…"
      onChange={e => setQ(e.target.value)}
      className="w-full rounded border border-[#2b3a52] bg-[#0b0f18] px-2 py-1 text-[11px] outline-none" />
    <div className="text-[10px] uppercase tracking-widest text-[#5d6a7d]">
      {ownerLabel} {libFuncs.length}
    </div>
    {libFuncs.map(f => (
      <button key={`${f.file}:${f.line}:${f.name}`} data-testid={`${testId}-lib-fn-${f.name}`}
        onClick={() => onJump(f.file, f.line)}
        title={`${f.file}:${f.line} — jump to the declaration`}
        className="block w-full rounded border border-[#2b3a52] bg-[#152036] px-2 py-1 text-left text-[11px] hover:bg-[#1d2b42]">
        <span className="text-[#8fd4ff]">{f.display}</span>
        <span className="float-right text-[9px] text-[#5d6a7d]">{f.file}:{f.line}</span>
      </button>
    ))}
    {libFuncs.length === 0 && (
      <span className="text-[11px] text-[#5d6a7d]">
        {funcs.length === 0 ? 'no function @declarations on this disk' : 'no declared function matches'}
      </span>
    )}
    {/* CATEGORY TABS (v1.13.26): one coloured chip per library group; the
        chip dot AND the doc row's left border carry the group colour */}
    <div className="flex flex-wrap items-center gap-1" data-testid={`${testId}-lib-groups`}>
      <button data-testid={`${testId}-lib-g-all`} onClick={() => setG('all')}
        className={`rounded px-1.5 py-0.5 text-[10px] ${g === 'all' ? 'bg-[#1d2b42] text-white' : 'text-[#7d8aa0] hover:bg-[#182236]'}`}>
        All {XC_LIB_DOC.length}
      </button>
      {XC_LIB_GROUPS.map(gr => (
        <button key={gr.key} data-testid={`${testId}-lib-g-${gr.key}`} onClick={() => setG(gr.key)}
          className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] hover:bg-[#182236] ${g === gr.key ? 'bg-[#1d2b42]' : 'text-[#7d8aa0]'}`}
          style={g === gr.key ? { color: gr.color } : undefined}>
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: gr.color }} />
          {gr.label} {XC_LIB_DOC.filter(f => f.group === gr.key).length}
        </button>
      ))}
    </div>
    <div className="text-[10px] uppercase tracking-widest text-[#5d6a7d]">
      XenonCode library · {libDocs.length}
    </div>
    {libDocs.map(f => (
      <div key={f.name} data-testid={`${testId}-lib-doc-${f.name}`}
        className="rounded border border-[#232c3d] border-l-2 bg-[#131a28] px-2 py-1 text-[11px]"
        style={{ borderLeftColor: libColor(f.group) }}>
        <div className="flex items-baseline justify-between gap-2">
          <span style={{ color: libColor(f.group) }}>{f.sig}</span>
          <span className="shrink-0 text-[9px] uppercase tracking-wide text-[#5d6a7d]">{f.group}</span>
        </div>
        <div className="text-[10px] leading-snug text-[#9fb0c8]">{f.desc}</div>
      </div>
    ))}
    {libDocs.length === 0 && libConsts.length === 0 && libMembers.length === 0
      && <span className="text-[11px] text-[#5d6a7d]">no library function matches</span>}
    {/* GLOBAL CONSTANTS (v1.13.27, we: "red, green which seem to be built
        in constants are not recognized. They are colors"): declared by the
        game shim (xc_host.cpp), all NUMBERS — colors hold packed RGBA */}
    {libConsts.length > 0 && (<>
      <div className="text-[10px] uppercase tracking-widest text-[#5d6a7d]">
        Global constants · {libConsts.length}
      </div>
      {libConsts.map(c => (
        <div key={c.name} data-testid={`${testId}-const-${c.name}`} title={`${c.desc} (type: number)`}
          className="flex items-center gap-2 rounded border border-l-2 border-[#232c3d] bg-[#131a28] px-2 py-1 text-[11px]"
          style={{ borderLeftColor: c.hex ?? (c.kind === 'align' ? '#ffd9a0' : '#a0d9ff') }}>
          {c.hex && <span className="inline-block h-3 w-3 shrink-0 rounded-sm border border-[#3a4a6a]"
            style={{ background: c.hex }} />}
          <span className="text-[#8fd4ff]">{c.name}</span>
          <span className="ml-auto shrink-0 text-[9px] uppercase tracking-wide text-[#5d6a7d]">
            {c.kind === 'align' ? 'alignment' : c.kind === 'color' ? 'color · number' : 'number'}
          </span>
        </div>
      ))}
    </>)}
    <div className="text-[10px] uppercase tracking-widest text-[#5d6a7d]">
      Screen & panel members · {libMembers.length}
    </div>
    <div className="text-[10px] leading-relaxed text-[#9fb0c8]">
      {libMembers.join(' · ') || 'no screen member matches'}
    </div>
  </>);
}
