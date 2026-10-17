// Panel.tsx — the DevTools-style right sidebar (P3): view options, the
// component list (by type / by subgrid tabs, collapsible groups, one search)
// and the inspector (position/rotation sliders, comp.data rows, ⟲ reset) or
// the subgrid panel (Contents + decoded masters + live joint sliders).
// Editing writes flow through the EditApi (bp + doc via edit.ts) and the
// Engine (live scene ride) — the React tree only ever reads file-space data.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Engine, ViewOptions } from '../engine/scene';
import type { EditCtx } from '../engine/edit';
import type { Blueprint, BlueprintComponent, LatticeObj } from '../engine/format';
import { subMasterEntries } from '../engine/subgrid';

export interface EditApi {
  pos(ctx: EditCtx, ci: number, ax: 'x' | 'y' | 'z', v: number): void;
  beginRot(ci: number): void;
  quatDelta(ctx: EditCtx, ci: number, p: number, y: number, r: number): void;
  dataField(ctx: EditCtx, compPath: (string | number)[], key: string, v: number | string | boolean): void;
  reset(ctx: EditCtx, ci: number): void;
}

interface Props {
  engine: Engine | null;
  ctx: EditCtx | null;
  bp: Blueprint;
  sel: { ci: number; sub: number };
  opts: ViewOptions;
  hullOpacity: number;
  realModels: boolean;
  gizmoOn: boolean;
  onGizmo: (v: boolean) => void;
  onOpt: (k: keyof ViewOptions, on: boolean) => void;
  onHullOpacity: (v: number) => void;
  onRealModels: (on: boolean) => void;
  onSelect: (ci: number, fly?: boolean) => void;
  onSelectSub: (bi: number) => void;
  edits: EditApi;
  /** bump to remount the inspector (⟲ reset rebuilds the slider baselines) */
  inspKey: number;
  markDirty: () => void;
}

// ---------------------------------------------------------------- DevTools row
// slider + number + ⟲ exactly like legacy row(): programmatic set() MUST run
// onInput (dead-button bug v0.147) and every edit marks the row modified.
function Row(p: {
  label: string; min: number; max: number; step: number; value: number;
  onInput: (v: number) => void; title?: string;
}) {
  const [v, setV] = useState(p.value);
  const [mod, setMod] = useState(false);
  // ⟲ returns to the row's BUILD-TIME value (legacy row() closure): re-renders
  // after edits would otherwise re-point the reset onto the edited value and
  // make it a no-op (the panel remounts via key on selection/reset instead).
  const base = useRef(p.value);
  const set = (nv: number) => {
    setV(nv); setMod(true); p.onInput(nv);
  };
  return (
    <div title={p.title} className={`flex items-center gap-1.5 py-[3px] ${mod ? 'row-mod' : ''}`}>
      <label className="w-[74px] shrink-0 truncate text-[11px] text-ink-dim">{p.label}</label>
      <input type="range" min={p.min} max={p.max} step={p.step} value={v}
        data-testid={`row-r-${p.label}`}
        onChange={e => set(+e.target.value)} className="min-w-0 flex-1 accent-accent" />
      <input type="number" min={p.min} max={p.max} step={p.step} value={v}
        data-testid={`row-n-${p.label}`}
        onChange={e => { if (e.target.value === '') return; const n = +e.target.value; if (isFinite(n)) set(n); }}
        className="w-[64px] shrink-0 rounded border border-white/10 bg-panel2 px-1 py-[1px] text-[11px] text-ink" />
      <button title="reset" data-testid={`row-x-${p.label}`}
        onClick={() => { setMod(false); setV(base.current); p.onInput(base.current); }}
        className="w-5 shrink-0 text-[11px] text-ink-dim hover:text-accent">⟲</button>
    </div>
  );
}

const Sec = (p: { title: string; children?: React.ReactNode; testid?: string }) => (
  <section className="border-t border-white/10 px-3 py-2" data-testid={p.testid}>
    <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-dim">{p.title}</h3>
    {p.children}
  </section>
);

const Check = (p: { label: string; checked: boolean; onChange: (v: boolean) => void; testid: string }) => (
  <label className="flex items-center gap-2 py-[2px] text-[12px] text-ink">
    <input type="checkbox" checked={p.checked} data-testid={p.testid}
      onChange={e => p.onChange(e.target.checked)} className="accent-accent" />
    {p.label}
  </label>
);

// ------------------------------------------------------------- view options
function ViewOpts(p: Pick<Props, 'opts' | 'onOpt' | 'hullOpacity' | 'onHullOpacity' | 'realModels' | 'onRealModels' | 'gizmoOn' | 'onGizmo'>) {
  return (
    <Sec title="View options" testid="viewopts">
      <Check testid="opt-grid" label="ground grid" checked={p.opts.grid} onChange={v => p.onOpt('grid', v)} />
      <Check testid="opt-occ" label="occupancy boxes (type-255)" checked={p.opts.occ} onChange={v => p.onOpt('occ', v)} />
      <Check testid="opt-hull" label="hull (blocks + triangles)" checked={p.opts.hull} onChange={v => p.onOpt('hull', v)} />
      <Check testid="opt-wire" label="wireframe (hull)" checked={p.opts.wire} onChange={v => p.onOpt('wire', v)} />
      <Check testid="opt-pipes" label="pipes (cables)" checked={p.opts.pipes} onChange={v => p.onOpt('pipes', v)} />
      <Check testid="opt-subs" label="subgrids (doors/hatches)" checked={p.opts.subs} onChange={v => p.onOpt('subs', v)} />
      <Check testid="opt-real" label="real game models (off = low-poly)" checked={p.realModels} onChange={p.onRealModels} />
      <Check testid="opt-gizmo" label="gizmo on selection (Shift snaps)" checked={p.gizmoOn} onChange={p.onGizmo} />
      <Row label="hull opacity" min={0.1} max={1} step={0.05} value={p.hullOpacity}
        onInput={p.onHullOpacity}
        title="dims the whole hull skin: blocks, triangle plates and their wireframes" />
      <div className="mt-1 text-[10px] leading-snug text-ink-dim">
        keys: g grid · o occupancy · h hull · Esc deselect
      </div>
    </Sec>
  );
}

// ----------------------------------------------------------- component list
const ALIAS = (c: BlueprintComponent) => (typeof c.alias === 'string' && c.alias) ||
  (typeof c.name === 'string' && c.name) || '';

function CompList(p: { bp: Blueprint; sel: Props['sel']; onSelect: Props['onSelect']; onSelectSub: Props['onSelectSub'] }) {
  const [tab, setTab] = useState(() => localStorage.getItem('archean-app-list-tab') || 'type');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const query = q.trim().toLowerCase();

  const switchTab = (t: string) => { setTab(t); localStorage.setItem('archean-app-list-tab', t); };
  const toggle = (k: string) => setOpen(s => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  // sections: {key, title, rows:[{idx?, comp, sub?:bi, kind:'comp'|'sub'|'nest'}]}
  const sections = useMemo(() => {
    const comps = p.bp.data.components;
    const hits = (c: BlueprintComponent) => !query
      || c.type.toLowerCase().includes(query) || ALIAS(c).toLowerCase().includes(query);
    const secs: { key: string; title: string; count: number;
      rows: { kind: 'comp' | 'sub'; idx: number; label?: string; dim?: boolean }[] }[] = [];
    if (tab === 'type') {
      const byT = new Map<string, number[]>();
      comps.forEach((c, i) => { const l = byT.get(c.type) ?? []; l.push(i); byT.set(c.type, l); });
      for (const type of [...byT.keys()].sort()) {
        const idxs = byT.get(type)!.filter(i => hits(comps[i]!));
        if (!idxs.length && !(query && type.toLowerCase().includes(query))) continue;
        secs.push({ key: 't:' + type, title: type, count: byT.get(type)!.length,
          rows: idxs.map(i => ({ kind: 'comp', idx: i })) });
      }
    } else {
      const masters = subMasterEntries(p.bp);
      const builds = comps.map((c, i) => c.type === 'Build' ? i : -1).filter(i => i >= 0);
      for (const bi of builds) {
        const bc = comps[bi]!;
        const nested = ((bc.data?.['components'] as BlueprintComponent[] | undefined) ?? []).filter(c => c.type !== 'Build');
        const ms = (masters.get(bi) ?? []).map(e => e.top).filter(t => t >= 0 && comps[t]);
        const nN = nested.map((c, k) => hits(c) ? k : -1).filter(k => k >= 0);
        const nM = ms.filter(i => hits(comps[i]!));
        const title = `⬓ Build[${bi}]` + (ALIAS(bc) ? ` “${ALIAS(bc)}”` : '');
        if (query && !nN.length && !nM.length && !title.toLowerCase().includes(query)
          && !'subgrid'.includes(query)) continue;
        const nb = (bc.data?.['blocks'] as unknown[] | undefined)?.length ?? 0;
        secs.push({
          key: 'b' + bi,
          title: title + (ms.length ? ` ← ${ms.map(m => comps[m]!.type).join(', ')}` : ' (floating)'),
          count: nested.length,
          rows: [
            { kind: 'sub', idx: bi, label: `SUBGRID · ${nb} blocks${nested.length ? `, ${nested.length} parts` : ''}` },
            ...nM.map(m => ({ kind: 'comp' as const, idx: m })),
            ...nN.map(k => ({ kind: 'sub' as const, idx: bi, label: `· nested ${nested[k]!.type}`, dim: true })),
          ],
        });
      }
      const inSub = new Set<number>([...builds]);
      for (const es of masters.values()) for (const e of es) if (e.top >= 0) inSub.add(e.top);
      const rest = comps.map((_, i) => i).filter(i => !inSub.has(i) && hits(comps[i]!));
      if (rest.length || !query)
        secs.push({ key: 'rest', title: 'Hull & parts (no subgrid)',
          count: comps.filter((_, i) => !inSub.has(i)).length,
          rows: rest.map(i => ({ kind: 'comp' as const, idx: i })) });
    }
    return secs;
  }, [p.bp, tab, query]);

  // selection → open its group once, scroll it into view (legacy reveal)
  const revealed = useRef('');
  useEffect(() => {
    const key = p.sel.ci >= 0 ? `[data-idx="${p.sel.ci}"]`
      : p.sel.sub >= 0 ? `[data-b="${p.sel.sub}"]` : '';
    if (!key || revealed.current === key + tab) return;
    const el = listRef.current?.querySelector(key);
    const grp = el?.closest('[data-sec]');
    if (grp) {
      const k = grp.getAttribute('data-sec')!;
      setOpen(s => (s.has(k) ? s : new Set(s).add(k)));
      el?.scrollIntoView({ block: 'nearest' });
      revealed.current = key + tab;
    }
  }, [p.sel, tab, sections]);

  const rowCls = (sel: boolean) =>
    `flex cursor-pointer gap-2 whitespace-nowrap rounded px-2 py-[1px] text-[12px] ${
      sel ? 'bg-accent/25 text-accent' : 'text-ink hover:bg-white/5'}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-3 pt-2">
        {(['type', 'sub'] as const).map(t => (
          <button key={t} data-testid={`ltab-${t}`} onClick={() => switchTab(t)}
            className={`rounded px-2 py-[3px] text-[11px] ${tab === t ? 'bg-accent/25 text-accent' : 'bg-panel2 text-ink-dim hover:text-ink'}`}>
            {t === 'type' ? 'by type' : 'by subgrid'}
          </button>
        ))}
      </div>
      <input value={q} data-testid="filter" placeholder="filter type or name…"
        onChange={e => setQ(e.target.value)}
        className="mx-3 mt-1.5 rounded border border-white/10 bg-panel2 px-2 py-1 text-[12px] text-ink placeholder:text-ink-dim/60" />
      <div ref={listRef} data-testid="complist" className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
        {sections.map(s => {
          const isOpen = query ? true : open.has(s.key);       // search force-opens
          return (
            <div key={s.key}>
              <button data-testid={`sec-${s.key}`} onClick={() => toggle(s.key)}
                className="flex w-full items-center gap-1 px-2 py-[3px] text-left text-[12px] text-ink hover:bg-white/5">
                <span className="w-3 text-[9px] text-ink-dim">{isOpen ? '▾' : '▸'}</span>
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
                <span className="text-[10px] text-ink-dim">· {s.count}</span>
              </button>
              {isOpen && (
                <div data-sec={s.key}>
                  {s.rows.map((r, i) => (
                    <div key={i} data-idx={r.kind === 'comp' ? r.idx : undefined}
                      data-b={r.kind === 'sub' ? r.idx : undefined}
                      className={rowCls(
                        (r.kind === 'comp' && r.idx === p.sel.ci)
                        || (r.kind === 'sub' && r.idx === p.sel.sub))}
                      onClick={() => r.kind === 'comp' ? p.onSelect(r.idx) : p.onSelectSub(r.idx)}
                      onDoubleClick={() => r.kind === 'comp' ? p.onSelect(r.idx, true) : p.onSelectSub(r.idx)}>
                      <span className="w-5 shrink-0 text-right text-[10px] text-ink-dim">{String(r.idx).padStart(2, '0')}</span>
                      <span className={`truncate ${r.dim ? 'text-ink-dim italic' : ''}`}>
                        {r.label ?? p.bp.data.components[r.idx]?.type}
                        {r.kind === 'comp' && ALIAS(p.bp.data.components[r.idx]!) ? ` “${ALIAS(p.bp.data.components[r.idx]!)}”` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- inspector
function Inspector(p: Props) {
  const { engine, ctx, bp, sel, edits, markDirty } = p;
  const ci = sel.ci;
  const comp = ci >= 0 ? bp.data.components[ci] : null;

  // rotation edit session (legacy q0 = live pose when the panel opens)
  useEffect(() => { if (engine && ci >= 0) engine.beginRotEdit(ci); }, [engine, ci, p.inspKey]);
  const [rot, setRot] = useState({ p: 0, y: 0, r: 0 });
  useEffect(() => { setRot({ p: 0, y: 0, r: 0 }); }, [ci, p.inspKey]);

  if (!comp) return null;
  const pos0 = comp.position;
  const livePos = (ax: 'x' | 'y' | 'z', v: number) => {
    if (ctx) edits.pos(ctx, ci, ax, v);
    markDirty();
  };
  const liveRot = (kind: 'p' | 'y' | 'r', deg: number) => {
    const next = { ...rot, [kind]: deg };
    setRot(next);
    if (ctx) edits.quatDelta(ctx, ci, next.p, next.y, next.r);
    markDirty();
  };

  return (
    <div className="overflow-y-auto" data-testid="inspector">
      <div className="px-3 py-2 text-[12px]">
        <b className="text-accent">{comp.type}</b>
        <span className="text-ink-dim">[{ci}] · {String(comp.module ?? '')}</span>
      </div>
      <Sec title="Position (m)">
        <Row label="x" min={pos0.x - 2} max={pos0.x + 2} step={0.005} value={pos0.x}
          onInput={v => livePos('x', v)} />
        <Row label="y" min={pos0.y - 1.5} max={pos0.y + 1.5} step={0.005} value={pos0.y}
          onInput={v => livePos('y', v)} />
        <Row label="z" min={pos0.z - 2} max={pos0.z + 2} step={0.005} value={pos0.z}
          onInput={v => livePos('z', v)} />
      </Sec>
      <Sec title="Rotation (° deltas, world axes)">
        <Row label="pitch" min={-180} max={180} step={0.5} value={0}
          title="world-axis pitch delta; orientation stays an exact file quaternion"
          onInput={v => liveRot('p', v)} />
        <Row label="yaw" min={-180} max={180} step={0.5} value={0} onInput={v => liveRot('y', v)} />
        <Row label="roll" min={-180} max={180} step={0.5} value={0} onInput={v => liveRot('r', v)} />
        {comp.type === 'PilotSeat' && (
          <div className="mt-1 flex flex-wrap gap-1">
            {([['lean fwd 12°', 12], ['20°', 20], ['30°', 30], ['45°', 45], ['upright', 0]] as const).map(([t, v]) => (
              <button key={t} className="rounded bg-panel2 px-1.5 py-[2px] text-[10px] text-ink hover:bg-white/10"
                onClick={() => { setRot(r => ({ ...r, p: -v })); if (ctx) edits.quatDelta(ctx, ci, -v, rot.y, rot.r); markDirty(); }}>
                {t}
              </button>
            ))}
            <div className="w-full text-[10px] text-ink-dim">negative pitch = lean toward nose (view +z)</div>
          </div>
        )}
      </Sec>
      <Sec title="Component data">
        <DataRows comp={comp} compPath={['data', 'components', ci]} edits={edits} ctx={ctx} markDirty={markDirty} />
      </Sec>
      <Sec title="Actions">
        <button data-testid="comp-reset"
          className="rounded bg-panel2 px-2 py-1 text-[11px] text-ink hover:bg-white/10"
          onClick={() => {
            if (!ctx) return;
            edits.reset(ctx, ci);                       // restores bp+doc
            engine?.refreshComp(ci);                    // proxy + real siblings ride it (v0.152)
            markDirty();
          }}>
          ⟲ reset this component
        </button>
      </Sec>
    </div>
  );
}

function DataRows(p: {
  comp: BlueprintComponent; compPath: (string | number)[];
  edits: EditApi; ctx: EditCtx | null; markDirty: () => void;
}) {
  const entries = Object.entries(p.comp.data ?? {});
  const editable = entries.filter(([, v]) =>
    typeof v === 'boolean' || typeof v === 'number' || (typeof v === 'string' && v.length <= 80));
  let out = null as React.ReactNode;
  if (!editable.length) out = <span className="text-[11px] text-ink-dim">no editable fields</span>;
  return (
    <>
      {out}
      {entries.map(([k, v]) => {
        if (typeof v === 'boolean')
          return <Check key={k} testid={`data-${k}`} label={k} checked={v}
            onChange={nv => { p.edits.dataField(p.ctx!, p.compPath, k, nv); p.markDirty(); }} />;
        if (typeof v === 'number')
          return <Row key={k} label={k} min={Math.min(v - 10, -100)} max={Math.max(v + 10, 100)}
            step={0.1} value={v}
            onInput={nv => { p.edits.dataField(p.ctx!, p.compPath, k, nv); p.markDirty(); }} />;
        if (typeof v === 'string' && v.length <= 80)
          return (
            <label key={k} className="flex items-center gap-2 py-[2px]">
              <span className="w-[74px] shrink-0 truncate font-mono text-[10px] text-ink-dim">{k}</span>
              <input type="text" defaultValue={v} data-testid={`data-${k}`}
                onChange={e => { p.edits.dataField(p.ctx!, p.compPath, k, e.target.value); p.markDirty(); }}
                className="min-w-0 flex-1 rounded border border-white/10 bg-panel2 px-1 py-[1px] text-[11px] text-ink" />
            </label>
          );
        if (v && typeof v === 'object')
          return (
            <div key={k} className="py-[1px] text-[11px] text-ink-dim">
              {k} — {Array.isArray(v) ? `${v.length} items` : 'object'} (not editable here)
            </div>
          );
        return null;
      })}
    </>
  );
}

// ------------------------------------------------------------- subgrid panel
const isOcc = (b: LatticeObj & { type?: number }) => (b.type ?? 0) === 255;

function SubPanel(p: Props) {
  const { engine, ctx, bp, sel, edits, markDirty } = p;
  const bi = sel.sub;
  const bc = bp.data.components[bi];
  if (!bc) return <div className="px-3 py-2 text-[12px] text-ink-dim">subgrid gone — reselect</div>;
  const subn = engine?.subInfo(bi)?.subn ?? bi;
  const blocks = (bc.data?.['blocks'] as (LatticeObj & { type?: number })[] | undefined) ?? [];
  const nested = ((bc.data?.['components'] as BlueprintComponent[] | undefined) ?? []).filter(c => c.type !== 'Build');
  const ents = subMasterEntries(bp).get(bi) ?? [];

  return (
    <div className="overflow-y-auto" data-testid="subpanel">
      <div className="px-3 py-2 text-[12px]">
        <b className="text-accent">Subgrid</b>
        <span className="text-ink-dim"> #{subn} · Build[{bi}]</span>
        {ALIAS(bc) && <span className="text-ink-dim"> · {ALIAS(bc)}</span>}
      </div>
      <Sec title="Contents">
        <div className="text-[11px] text-ink-dim">
          {blocks.filter(b => !isOcc(b)).length} blocks · {nested.length} parts
          {nested.length ? ` (${[...new Set(nested.map(s => s.type))].slice(0, 6).join(', ')})` : ''}
        </div>
      </Sec>
      <Sec title="Mount (master part)">
        {ents.length === 0 && (
          <div className="text-[11px] text-ink-dim">no composite_builds entry names this subgrid</div>
        )}
        {ents.map((e, i) => {
          const mc = e.mc;
          if (!mc) return (
            <div key={i} className="text-[11px] text-ink-dim">
              master = component[{e.component}] — not in file (deleted editor reference)
            </div>
          );
          const jd = mc.data ?? {};
          const zc = (v: number) => Math.abs(v) < 1e-4 ? 0 : v;
          const joint = typeof jd['angle'] === 'number' ? ` · angle ${(jd['angle'] as number).toFixed(1)}°`
            : typeof jd['pos'] === 'number' ? ` · offset ${(jd['pos'] as number).toFixed(3)} m` : '';
          // the joint sliders write the MASTER's data verbatim and drive the
          // subgrid live (v0.157) — same fields its own inspector shows
          const kinematic = engine?.manifest?.[mc.type]?.joints?.length
            && (typeof jd['angle'] === 'number' || typeof jd['pos'] === 'number');
          const path = e.mcPath;
          return (
            <div key={i} className="mb-1">
              <div className="text-[11px]">
                <b className="text-ink">{mc.type}</b>
                <span className="text-ink-dim">{e.top >= 0 ? `[${e.top}]` : ' (nested)'}{joint}</span>
              </div>
              {kinematic && typeof jd['angle'] === 'number' && path && ctx && (
                <Row label="joint angle (°)" min={-180} max={180} step={0.5} value={zc(jd['angle'] as number)}
                  onInput={v => { edits.dataField(ctx, path, 'angle', v); engine?.dataEdited(); markDirty(); }} />
              )}
              {kinematic && typeof jd['pos'] === 'number' && path && ctx && (
                <Row label="joint slide (m)" min={-1} max={1} step={0.005} value={zc(jd['pos'] as number)}
                  onInput={v => { edits.dataField(ctx, path, 'pos', v); engine?.dataEdited(); markDirty(); }} />
              )}
            </div>
          );
        })}
      </Sec>
    </div>
  );
}

// --------------------------------------------------------------------- shell
export default function Panel(p: Props) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-panel text-ink" data-testid="panels">
      <ViewOpts opts={p.opts} onOpt={p.onOpt} hullOpacity={p.hullOpacity} onHullOpacity={p.onHullOpacity}
        realModels={p.realModels} onRealModels={p.onRealModels} gizmoOn={p.gizmoOn} onGizmo={p.onGizmo} />
      <div className="flex min-h-0 flex-[2] flex-col border-t border-white/10">
        <h3 className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-dim">Components</h3>
        <CompList bp={p.bp} sel={p.sel} onSelect={p.onSelect} onSelectSub={p.onSelectSub} />
      </div>
      <div className="min-h-0 flex-[2] border-t border-white/10 overflow-y-auto">
        {p.sel.sub >= 0
          ? <SubPanel {...p} key={`s${p.sel.sub}`} />
          : p.sel.ci >= 0
            ? <Inspector {...p} key={`c${p.sel.ci}k${p.inspKey}`} />
            : <div className="px-3 py-2 text-[12px] text-ink-dim">nothing selected — click a component</div>}
      </div>
    </div>
  );
}
