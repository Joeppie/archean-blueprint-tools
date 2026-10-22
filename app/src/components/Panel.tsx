// Panel.tsx — the LEFT-side parts panel (KSP parts-list layout): the
// component list leads (by type / by subgrid tabs = Categories/Subgrids,
// collapsible groups, one search, icon tiles), the context window follows
// (position/rotation sliders, comp.data rows, ⟲ reset) or the subgrid panel
// (Contents + decoded masters + live joint sliders), and the view options
// sit at the bottom. Editing writes flow through the EditApi (bp + doc via
// edit.ts) and the Engine (live scene ride) — the React tree only ever
// reads file-space data. Mass & CoM moved out: the StaticInfo KSP black
// box floats over the viewport (App).
import { useEffect, useMemo, useRef, useState } from 'react';
import { requestThumb, startSpin, stopSpin } from '../engine/thumbs';
import type { Engine, ViewOptions } from '../engine/scene';
import type { EditCtx } from '../engine/edit';
import type { Blueprint, BlueprintComponent, LatticeObj } from '../engine/format';
import { subMasterEntries } from '../engine/subgrid';
import { CompPaint } from './ColorPanel';
import { LiftWidget } from './LiftWidget';
import { CostWidget } from './CostWidget';

export interface EditApi {
  compField(ctx: EditCtx, ci: number, key: 'alias' | 'module' | 'mirrorAxis', v: string | number): void;
  compColor(ctx: EditCtx, ci: number, which: 'color1' | 'color2',
    field: 'r' | 'g' | 'b' | 'opacity' | 'roughness' | 'metallic', v: number): void;
  pos(ctx: EditCtx, ci: number, ax: 'x' | 'y' | 'z', v: number): void;
  beginRot(ci: number): void;
  quatDelta(ctx: EditCtx, ci: number, p: number, y: number, r: number): void;
  dataField(ctx: EditCtx, compPath: (string | number)[], key: string, v: number | string | boolean): void;
  reset(ctx: EditCtx, ci: number): void;
  /** remove the component from bp + doc (index-shifts everything after it) */
  deleteComp(ctx: EditCtx, ci: number): void;
}

interface Props {
  engine: Engine | null;
  /** edit counter: re-renders the live readouts (mass/CoM) */
  rev: number;
  ctx: EditCtx | null;
  bp: Blueprint;
  /** v1 file (no data.colors): the PALETTE applies the legacy family remap */
  legacy: boolean;
  sel: { ci: number; sub: number };
  opts: ViewOptions;
  hullOpacity: number;
  gizmoOn: boolean;
  onGizmo: (v: boolean) => void;
  hiDef: boolean;
  onHiDef: (v: boolean) => void;
  /** the STATIC INFO overlay (mass & CoM) is visible? (its ✕ hides it) */
  staticInfo: boolean;
  onStaticInfo: (v: boolean) => void;
  onOpt: (k: keyof ViewOptions, on: boolean) => void;
  onHullOpacity: (v: number) => void;
  onSelect: (ci: number, fly?: boolean) => void;
  onSelectSub: (bi: number) => void;
  edits: EditApi;
  /** bump to remount the inspector (⟲ reset rebuilds the slider baselines) */
  inspKey: number;
  markDirty: () => void;
  /** view mode: everything read-only */
  readOnly?: boolean;
  /** mode workspaces (Blocks/Wire/Flight) replace the inspector section */
  bottom?: React.ReactNode;
  /** game model manifest (drives the KSP-style parts CATALOG tab) */
  manifest: Record<string, { mass: number; module: string }> | null;
  /** type currently held for placement (KSP "holding a part") */
  placingType: string | null;
  onPlaceType: (t: string | null) => void;
  /** EDIT-mode sub-tabs: PLACE (catalog + mirror) / EDIT (lists + inspector)
   *  — v1.5: the SAME flavor switch also drives the BLOCKS workspace (one
   *  "Edit | Place" panel, two flavors, on top of the pane — user rule) */
  tool?: 'place' | 'edit';
  onTool?: (t: 'place' | 'edit') => void;
  /** ⇄ shared mirrored-placement/edit switch (blocks AND catalog parts) */
  mirrorPlace?: boolean;
  onMirrorPlace?: (v: boolean) => void;
  /** VIEW mode: the side menu shows ONLY the overall vessel stats, in
   *  collapsable sections (user v1.4) — no parts list, no inspector */
  statsOnly?: boolean;
  /** with a mode workspace in `bottom` (BLOCKS), a selected component's
   *  Inspector stacks ABOVE it instead of replacing it (v1.4: entering
   *  blocks mode with a part selected kept its move/rotate/edit panel AND
   *  kept the brush workspace) */
  selOverBottom?: boolean;
}

// ------------------------------------------------------------- mass & CoM
/** KSP "STATIC INFO" black box: uppercase tan labels, right-aligned values.
 *  Lives as a viewport overlay (App), not in the sidebar — like the VAB's
 *  Mass/Modules/Cost readout under the parts list. */
/**
 *  OPTIONAL (user 2026-10-19: "Static info shouldn't necessarily show. It's
 *  too large on mobile, hide it under settings, x to close panel itself"):
 *  the Editor only renders it while its `staticInfo` setting is on (⚙ view
 *  options carries the checkbox; default OFF on phones, ON on desktop), the
 *  box itself carries an ✕ that dismisses it, and on phones it is a COMPACT
 *  one-glance card — declared/computed/CoM only, the structural-detail lines
 *  stay on md+ where there is room for them. */
export function StaticInfo(p: { engine: Engine | null; rev: number; onClose: () => void }) {
  const mm = p.engine?.massReport();
  if (!mm) return null;
  const fmt = (n: number, d = 2) => n.toLocaleString('en', { maximumFractionDigits: d });
  return (
    <div data-testid="massbox"
      className="ksp-win pointer-events-none w-[164px] rounded px-1.5 py-1 text-[10px] leading-snug
                 text-ink md:w-[250px] md:px-2.5 md:py-1.5 md:text-[11px]">
      <div className="ksp-label mb-1 flex items-center justify-between gap-2 border-b border-white/10
                     pb-[2px] text-[9px] text-ink-dim md:text-[10px]">
        Static info
        <button data-testid="static-close" onClick={p.onClose} title="hide the static info box"
          aria-label="hide the static info box"
          className="ksp-btn pointer-events-auto -my-0.5 rounded px-1.5 py-0 text-[11px] leading-tight
                     text-ink-dim hover:text-accent">
          ✕
        </button>
      </div>
      <div data-testid="mass-report" className="space-y-[1px] leading-snug">
        <div>computed <b className="float-right tabular-nums">{fmt(mm.total, 0)} kg</b></div>
        <div className="text-ink-dim">
          {mm.declared > 0
            ? `game-declared ${fmt(mm.declared, 0)} kg · Δ ${fmt((mm.total - mm.declared) / mm.declared * 100, 1)} %`
            : 'no declared mass (never built in game)'}
        </div>
        <div data-testid="mass-families" className="hidden text-ink-dim md:block">
          hull {fmt(mm.families.hull, 0)} · skin {fmt(mm.families.skin, 0)} · parts {fmt(mm.families.parts, 0)} kg
          {mm.families.fluids + mm.families.struts + mm.families.beams > 0 &&
            ` + fluids ${fmt(mm.families.fluids, 0)} · struts ${fmt(mm.families.struts, 0)}`}</div>
        <div data-testid="mass-density" className="hidden text-ink-dim md:block">hull {fmt(mm.cells, 0)} cells · skin {fmt(mm.skinTris, 0)} tris
          {' · '}{fmt(mm.skinAreaM2, 1)} m²</div>
        <div>CoM <span className="float-right tabular-nums">({fmt(mm.com[0])}, {fmt(mm.com[1])}, {fmt(mm.com[2])}) m</span></div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ vessel stats
/** VIEW mode's side menu (v1.4 user rule): "the view tab should only show
 *  overall vessel stats in the collapsable side menu" — no parts list, no
 *  inspector. Collapsible sections (▾/▸ like the list groups): the mass &
 *  CoM readout, the hull/parts census, and the heaviest part classes. */
export function VesselStats(p: { engine: Engine | null; bp: Blueprint; rev: number }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(['mass', 'census']));
  const toggle = (k: string) => setOpen(s => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  const mm = p.engine?.massReport();
  const fmt = (n: number, d = 2) => n.toLocaleString('en', { maximumFractionDigits: d });
  const comps = p.bp.data.components;
  const parts = comps.filter(c => c.type !== 'Build');
  const nBuild = comps.length - parts.length;
  const blocks = p.bp.data.blocks;
  const nBl = blocks.filter(b => (b.type ?? 0) !== 255).length;
  const secs: { id: string; title: string; body: React.ReactNode }[] = [];
  // (the buoyancy planner rides this panel as its OWN collapsible row — see
  // the LiftWidget return below — a fresh craft opens in VIEW, so the
  // builder's lift readout must be reachable here too, user 2026-10-22)
  secs.push({
    id: 'mass', title: `Mass & CoM${mm ? ` · ${fmt(mm.total, 0)} kg` : ''}`,
    body: mm && (
      <div data-testid="vessel-mass" className="space-y-[2px] text-[11px]">
        <div>computed <b className="float-right tabular-nums">{fmt(mm.total, 0)} kg</b></div>
        <div className="text-ink-dim">
          {mm.declared > 0
            ? `game-declared ${fmt(mm.declared, 0)} kg · Δ ${fmt((mm.total - mm.declared) / mm.declared * 100, 1)} %`
            : 'no declared mass (never built in game)'}
        </div>
        <div className="text-ink-dim">hull {fmt(mm.families.hull, 0)} · skin {fmt(mm.families.skin, 0)} ·
          parts {fmt(mm.families.parts, 0)} kg
          {mm.families.fluids + mm.families.struts + mm.families.beams > 0 &&
            ` + fluids ${fmt(mm.families.fluids, 0)} · struts ${fmt(mm.families.struts, 0)}`}</div>
        <div className="text-ink-dim">hull {fmt(mm.cells, 0)} cells · skin {fmt(mm.skinTris, 0)} tris
          {' · '}{fmt(mm.skinAreaM2, 1)} m²</div>
        <div>CoM <span className="float-right tabular-nums">
          ({fmt(mm.com[0])}, {fmt(mm.com[1])}, {fmt(mm.com[2])}) m</span></div>
      </div>
    ),
  });
  secs.push({
    id: 'census', title: `Census · ${parts.length} parts · ${nBl} blocks`,
    body: (
      <div data-testid="vessel-census" className="space-y-[2px] text-[11px]">
        <div>components <b className="float-right tabular-nums">{parts.length}</b></div>
        <div>subgrids (Build) <b className="float-right tabular-nums">{nBuild}</b></div>
        <div>blocks <b className="float-right tabular-nums">{nBl}</b>
          <span className="text-ink-dim"> · occupancy {blocks.length - nBl}</span></div>
        <div>hull triangles <b className="float-right tabular-nums">{p.bp.data.triangles?.length ?? 0}</b></div>
        <div>cables (pipes) <b className="float-right tabular-nums">{p.bp.data.pipes?.length ?? 0}</b></div>
      </div>
    ),
  });
  const byType = new Map<string, { n: number; mass: number }>();
  for (const c of parts) {
    const e = byType.get(c.type) ?? { n: 0, mass: 0 };
    e.n++; e.mass += p.engine?.manifest?.[c.type]?.mass ?? 0;
    byType.set(c.type, e);
  }
  const top = [...byType.entries()].sort((a, b) => b[1].mass - a[1].mass || b[1].n - a[1].n).slice(0, 8);
  secs.push({
    id: 'types', title: `Heaviest part classes (${byType.size})`,
    body: (
      <div data-testid="vessel-types" className="space-y-[2px] text-[11px]">
        {!top.length && <div className="text-ink-dim">no parts</div>}
        {top.map(([t, e]) => (
          <div key={t} className="flex justify-between gap-2">
            <span className="truncate">{t} <span className="text-ink-dim">×{e.n}</span></span>
            <span className="shrink-0 tabular-nums text-ink-dim">{e.mass ? `${fmt(e.mass, 1)} kg` : ''}</span>
          </div>
        ))}
      </div>
    ),
  });
  p.rev;                                        // re-render on every edit
  return (
    <div data-testid="vessel-stats" className="divide-y divide-white/10">
      {/* the builder's buoyancy planner (user 2026-10-22): a fresh craft
          opens in VIEW, so the lift widget rides this side menu too — its
          own collapsible row (localStorage-persisted), above the sections */}
      <LiftWidget engine={p.engine} bp={p.bp} rev={p.rev} />
      {/* raw-material cost of every part (user 2026-10-22): the shopping
          list on top, each component's recipe chain on demand */}
      <CostWidget bp={p.bp} rev={p.rev} />
      {secs.map(s => (
        <div key={s.id}>
          <button data-testid={`vsec-${s.id}`} onClick={() => toggle(s.id)}
            className="flex w-full items-center gap-1.5 px-3 py-2 text-left">
            <span className="w-3 text-[9px] text-ink-dim">{open.has(s.id) ? '▾' : '▸'}</span>
            <span className="ksp-label min-w-0 flex-1 truncate text-[11px] font-semibold text-ink-dim">{s.title}</span>
          </button>
          {open.has(s.id) && <div className="px-3 pb-2">{s.body}</div>}
        </div>
      ))}
    </div>
  );
}

function MetaNum(p: { testid: string; label: string; value: number; min: number; max: number;  disabled?: boolean; onCommit: (v: number) => void }) {
  const [v, setV] = useState(String(p.value));
  useEffect(() => setV(String(p.value)), [p.value]);
  return (
    <label className="flex items-center gap-1 py-[2px] text-[10px]">
      <span className="text-ink-dim">{p.label}</span>
      <input type="number" value={v} min={p.min} max={p.max} disabled={p.disabled}
        data-testid={p.testid}
        className="w-[52px] rounded border border-white/10 bg-panel2 px-1 text-[10px] text-ink"
        onChange={e => { setV(e.target.value); const n = +e.target.value;
          if (e.target.value !== '' && isFinite(n)) p.onCommit(Math.max(p.min, Math.min(p.max, n))); }} />
    </label>
  );
}

// ---------------------------------------------------------------- DevTools row
// slider + number + ⟲ exactly like legacy row(): programmatic set() MUST run
// onInput (dead-button bug v0.147) and every edit marks the row modified.
function Row(p: {
  label: string; min: number; max: number; step: number; value: number;
  onInput: (v: number) => void; title?: string; disabled?: boolean;
  /** scrub sensitivity: value units per CSS pixel while dragging the label
   *  (default the full range over 400 px); Shift drags 5× coarser */
  perPx?: number;
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
  // BLENDER-STYLE SCRUB: grab the label and drag horizontally for fine,
  // continuous control — the ±2 m slider over ~150 px is 2.6 cm per pixel,
  // impossible to tweak with (the user's "trouble tweaking movement and
  // rotation"). Shift = 5× coarser; the value snaps to the row step.
  const vRef = useRef(v);
  vRef.current = v;
  const scrub = (e: React.PointerEvent) => {
    if (p.disabled) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX, from = vRef.current;
    const perPx = p.perPx ?? (p.max - p.min) / 400;
    const move = (ev: PointerEvent) => {
      const raw = from + (ev.clientX - x0) * perPx * (ev.shiftKey ? 5 : 1);
      const q = Math.round(raw / p.step) * p.step;
      const cl = Math.min(p.max, Math.max(p.min, q));
      set(+cl.toFixed(6));
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  return (
    <div title={p.title ?? 'drag the label to scrub · Shift = coarse'}
      className={`flex items-center gap-1.5 py-[3px] ${mod ? 'row-mod' : ''}`}>
      <label data-testid={`row-s-${p.label}`}
        onPointerDown={scrub}
        className="w-[74px] shrink-0 cursor-ew-resize select-none truncate text-[11px] text-ink-dim hover:text-ink"
        style={{ touchAction: 'none' }}>{p.label}</label>
      <input type="range" min={p.min} max={p.max} step={p.step} value={v} disabled={p.disabled}
        data-testid={`row-r-${p.label}`}
        onChange={e => set(+e.target.value)} className="min-w-0 flex-1 accent-accent disabled:opacity-40" />
      <input type="number" min={p.min} max={p.max} step={p.step} value={v} disabled={p.disabled}
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
    <h3 className="ksp-label mb-1 text-[11px] font-semibold text-ink-dim">{p.title}</h3>
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
/** MOVED OUT of the left parts panel (the user: "the full list of options
 *  shouldnt be combined into the main left-hand panel"): rendered in a
 *  floating ⚙ popover window over the viewport by the Editor. */
export function ViewOpts(p: Pick<Props, 'opts' | 'onOpt' | 'hullOpacity' | 'onHullOpacity' | 'gizmoOn' | 'onGizmo' | 'hiDef' | 'onHiDef' | 'staticInfo' | 'onStaticInfo'> & {
  /** v1.5.21 SETTABLE MIRROR AXIS (user: "mirror axes should be settable.
   *  Game is not hardcoded x"): the SESSION plane for ⇄ twin placement,
   *  block twin identity and the overlay's solid sheet. Detected mirror
   *  axes (twin pairs, per-component mirrorAxis) always get their sheet. */
  mirrorAxis: 'x' | 'y' | 'z';
  onMirrorAxis: (a: 'x' | 'y' | 'z') => void;
}) {
  return (
    <Sec title="View options" testid="viewopts">
      <Check testid="opt-grid" label="ground grid (zoom-adaptive)" checked={p.opts.grid} onChange={v => p.onOpt('grid', v)} />
      <Check testid="opt-occ" label="occupancy boxes (type-255)" checked={p.opts.occ} onChange={v => p.onOpt('occ', v)} />
      <Check testid="opt-hull" label="hull (blocks + triangles)" checked={p.opts.hull} onChange={v => p.onOpt('hull', v)} />
      <Check testid="opt-wire" label="wireframe (hull)" checked={p.opts.wire} onChange={v => p.onOpt('wire', v)} />
      <Check testid="opt-pipes" label="pipes (cables)" checked={p.opts.pipes} onChange={v => p.onOpt('pipes', v)} />
      <Check testid="opt-subs" label="subgrids (doors/hatches)" checked={p.opts.subs} onChange={v => p.onOpt('subs', v)} />
      <Check testid="opt-mirror" label="mirror plane(s)" checked={p.opts.mirror} onChange={v => p.onOpt('mirror', v)} />
      {/* v1.5.21: the game stores a per-component mirrorAxis (0=none,
          1=x, 2=y, 3=z) and non-x twin pairs are indexed by sym.ts — the
          editor's OWN plane (⇄ placement, block twins) is settable too */}
      <div className="flex items-center gap-2 py-[2px] text-[12px] text-ink">
        <span className="flex-1">mirror axis</span>
        {(['x', 'y', 'z'] as const).map(a => (
          <button key={a} data-testid={`mirror-axis-${a}`} title={`mirror plane ${a} = 0 (twins + ⇄ placement)`}
            onClick={() => p.onMirrorAxis(a)}
            className={`ksp-btn px-2 py-[1px] text-[11px] uppercase ${p.mirrorAxis === a ? 'on' : ''}`}>
            {a}
          </button>
        ))}
      </div>
      <Check testid="opt-labels" label="labels on interactive/aliased parts" checked={p.opts.labels} onChange={v => p.onOpt('labels', v)} />
      <Check testid="opt-gizmo" label="gizmo on selection (this session · Shift snaps)" checked={p.gizmoOn} onChange={p.onGizmo} />
      {/* the FULL game meshes are the DEFAULT (v0.182 user rule) — the row
          offers the decimated twins as the opt-in for weak GPUs */}
      <Check testid="opt-hidef" label="decimated low-poly meshes (weak GPUs)" checked={!p.hiDef}
        onChange={v => p.onHiDef(!v)} />
      <Check testid="opt-com" label="center-of-mass marker" checked={p.opts.com} onChange={v => p.onOpt('com', v)} />
      {/* the KSP STATIC INFO overlay (mass & CoM) is optional: on phones it is
          OFF by default (it ate a third of the viewport — user 2026-10-19);
          its own ✕ hides it and this row brings it back */}
      <Check testid="opt-static" label="static info box (mass & CoM)" checked={p.staticInfo}
        onChange={p.onStaticInfo} />
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

/** KSP parts-list flavour: every type gets a little icon tile — CamelCase
 *  initials on a stable muted hue (hash of the type name). */
const partCode = (t: string) =>
  ((t.match(/[A-Z]/g) ?? []).slice(0, 2).join('') || t.slice(0, 1)).toUpperCase();
const tileHue = (t: string) => {
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 360;
  return h;
};

/** v1.5.6 LIVE catalog icon (user: "a preview render of each icon … an
 *  animated 3D version … generate these one-by-one when opening the place
 *  component page"): the real game model rendered through the shared hidden
 *  thumb renderer (engine/thumbs.ts). The job is enqueued only once the row
 *  SCROLLS INTO VIEW (the catalog is 100+ rows; parsing every atlas file the
 *  moment the tab opens starved the main thread — caught by the blockplace
 *  timing pins), and thumbs.ts runs the visible jobs STRICTLY one per idle
 *  slice in row order. Until the still lands, the initials tile shows
 *  through the transparent canvas; hovering a row SPINS the part. */
function PartThumb({ type }: { type: string }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancel: (() => void) | null = null;
    const io = new IntersectionObserver(es => {
      if (es.some(e => e.isIntersecting) && !cancel)
        cancel = requestThumb(el, type);
    });
    io.observe(el);
    return () => { io.disconnect(); cancel?.(); };
  }, [type]);
  return (
    <span
      className="relative grid h-[22px] w-[22px] shrink-0 place-items-center overflow-hidden rounded-[3px] border"
      style={{ background: `hsl(${tileHue(type)} 20% 22%)`, borderColor: `hsl(${tileHue(type)} 24% 44%)` }}
      onPointerEnter={() => ref.current && startSpin(ref.current, type)}
      onPointerLeave={() => ref.current && stopSpin(ref.current)}>
      <span className="pointer-events-none absolute text-[8px] font-bold text-ink/70">{partCode(type)}</span>
      <img ref={ref} alt="" data-testid={`thumb-${type}`}
        className="pointer-events-none absolute inset-0 h-[22px] w-[22px]" />
    </span>
  );
}

function CompList(p: { bp: Blueprint; rev: number; sel: Props['sel'];
  onSelect: Props['onSelect']; onSelectSub: Props['onSelectSub'];
  manifest: Props['manifest']; placingType: Props['placingType'];
  onPlaceType: Props['onPlaceType'];
  /** PLACE sub-tab: the catalog (hold a part, click the craft). EDIT: the
   *  ship's own parts (by type / by subgrid) — v1.4 sub-tab split */
  listMode: 'place' | 'edit' }) {
  const [tab, setTab] = useState(() => {
    const t = localStorage.getItem('archean-app-list-tab') || 'type';
    return t === 'catalog' ? 'type' : t;      // the catalog moved to the PLACE sub-tab
  });
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
    // p.rev is DELIBERATE: bp is mutated in place (edits keep the object
    // identity), the rev counter is what invalidates this view of it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.bp, p.rev, tab, query]);

  // CATALOG tab rows: every type the game ships (manifest), KSP parts-list
  // style — click to HOLD the part, then click the craft to place it.
  const catRows = useMemo(() => {
    if (!p.manifest) return [];
    return Object.keys(p.manifest)
      .filter(t => t !== 'Build' && (!query
        || t.toLowerCase().includes(query) || p.manifest![t]!.module.toLowerCase().includes(query)))
      .sort();
  }, [p.manifest, query]);

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
    `flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded px-2 py-[1px] text-[12px] ${
      sel ? 'bg-accent/20 text-accent shadow-[inset_0_0_0_1px_rgba(169,215,240,.5)]' : 'text-ink hover:bg-white/5'}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* EDIT mode: parts grouped by type / by subgrid. PLACE mode IS the
          catalog (v1.4 sub-tab split — the old Catalog list-tab moved into
          the PLACE sub-tab beside EDIT) */}
      {p.listMode === 'edit' && (
        <div className="flex items-center gap-[3px] px-3 pt-2">
          {(['type', 'sub'] as const).map(t => (
            <button key={t} data-testid={`ltab-${t}`} onClick={() => switchTab(t)}
              title={t === 'type' ? 'parts grouped by type' : 'parts grouped by subgrid (Build)'}
              className={`ksp-btn px-2 py-[3px] text-[10px] ${tab === t ? 'on' : ''}`}>
              {t === 'type' ? 'Categories' : 'Subgrids'}
            </button>
          ))}
        </div>
      )}
      {p.listMode === 'place' && (
        <div className="px-3 pt-2 text-[10px] text-ink-dim">
          click a part to HOLD it, then click a surface on the craft ·
          ⇄ also places the mirrored twin
        </div>
      )}
      <input value={q} data-testid="filter" placeholder="Search parts…"
        onChange={e => setQ(e.target.value)}
        className="mx-3 mt-1.5 rounded border border-white/15 bg-black/40 px-2 py-1 text-[12px] text-ink
                   placeholder:text-ink-dim/60 focus:border-accent/60 focus:outline-none" />
      {p.listMode === 'place' ? (
        <div data-testid="catalog-list" className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
          {!p.manifest && <div className="px-2 py-1 text-[11px] text-ink-dim">catalogue loading…</div>}
          {catRows.map(t => (
            <div key={t} data-testid="catalog-item" title={`hold a ${t} — then click a surface on the craft`}
              className={rowCls(p.placingType === t)}
              onClick={() => p.onPlaceType(p.placingType === t ? null : t)}>
              <PartThumb type={t} />
              <span className="min-w-0 flex-1 truncate">{t}</span>
              <span className="shrink-0 text-[10px] tabular-nums text-ink-dim">
                {p.manifest![t]!.mass ? `${+p.manifest![t]!.mass.toFixed(1)} kg` : ''}</span>
            </div>
          ))}
          {!!p.manifest && !catRows.length && <div className="px-2 py-1 text-[11px] text-ink-dim">no matches</div>}
        </div>
      ) : (
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
                      {(() => {
                        const t = r.kind === 'comp' ? p.bp.data.components[r.idx]?.type ?? '?' : 'Subgrid';
                        return <span
                          className="grid h-[16px] w-[16px] shrink-0 place-items-center rounded-[3px] border text-[8px] font-bold text-ink"
                          style={{ background: `hsl(${tileHue(t)} 20% 22%)`, borderColor: `hsl(${tileHue(t)} 24% 44%)` }}>
                          {r.kind === 'comp' ? partCode(t) : '⬓'}
                        </span>;
                      })()}
                      <span className="w-4 shrink-0 text-right text-[9px] text-ink-dim">{String(r.idx).padStart(2, '0')}</span>
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
      )}
    </div>
  );
}

// ----------------------------------------------------------------- inspector
function Inspector(p: Props) {
  const { engine, ctx, bp, sel, edits, markDirty, readOnly } = p;
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
      <Sec title="Component">
        <label className="flex items-center gap-2 py-[2px]">
          <span className="w-[74px] shrink-0 text-[11px] text-ink-dim">alias</span>
          <input type="text" defaultValue={String(comp.alias ?? '')} disabled={readOnly}
            data-testid="comp-alias"
            className="min-w-0 flex-1 rounded border border-white/10 bg-panel2 px-1 py-[1px] text-[11px] text-ink"
            onChange={e => { if (ctx) edits.compField(ctx, ci, 'alias', e.target.value); markDirty(); }} />
        </label>
        <label className="flex items-center gap-2 py-[2px]">
          <span className="w-[74px] shrink-0 text-[11px] text-ink-dim">module</span>
          <input type="text" defaultValue={String(comp.module ?? '')} disabled={readOnly}
            data-testid="comp-module"
            className="min-w-0 flex-1 rounded border border-white/10 bg-panel2 px-1 py-[1px] text-[11px] font-mono text-ink"
            onChange={e => { if (ctx) edits.compField(ctx, ci, 'module', e.target.value); markDirty(); }} />
        </label>
        {/* the GAME's own mirror field (FORMAT §components): 0 = none,
            axis indices 1=x, 2=y, 3=z (the dev viewer mirrors the part with
            scale[mirrorAxis−1] = −1 about its origin). The row used to stop
            at 2 — off by one against the format law (v1.5.21 fix). */}
        <Row label="mirrorAxis" min={0} max={3} step={1} value={Number(comp.mirrorAxis ?? 0)} disabled={readOnly}
          title="0 = none · 1 = x · 2 = y · 3 = z (the game's mirror-axis field)"
          onInput={v => { if (ctx) edits.compField(ctx, ci, 'mirrorAxis', Math.round(v)); markDirty(); }} />
      </Sec>
      <Sec title="Paint (linear 0-255)">
        {/* v1.6 PALETTE: pick a vessel colour and it SNAPS its full shading
            spec onto color1/color2 (the numeric rows stay for fine edits) */}
        <CompPaint bp={bp} legacy={p.legacy} comp={comp}
          onApply={(which, c) => {
            if (!ctx) return;
            for (const [f, v] of [['r', c.r], ['g', c.g], ['b', c.b], ['opacity', c.opacity],
              ['roughness', c.roughness], ['metallic', c.metallic]] as const)
              edits.compColor(ctx, ci, which, f, v);
            markDirty();
          }} />
        {(['color1', 'color2'] as const).map(which => (
          <div key={which} className="mb-1">
            <div className="text-[10px] uppercase tracking-wide text-ink-dim">{which}</div>
            <div className="flex flex-wrap gap-x-3">
              {([['r', 0, 255], ['g', 0, 255], ['b', 0, 255], ['opacity', 0, 15],
                 ['roughness', 0, 7], ['metallic', 0, 1]] as const).map(([f, lo, hi]) => (
                <MetaNum key={f} testid={`paint-${which}-${f}`} label={f}
                  value={Number((comp.colors as Record<string, Record<string, number>> | undefined)?.[which]?.[f] ?? 0)}
                  min={lo} max={hi} disabled={readOnly}
                  onCommit={v => { if (ctx) edits.compColor(ctx, ci, which, f, v); markDirty(); }} />
              ))}
            </div>
          </div>
        ))}
      </Sec>
      <Sec title="Position (m)">
        <Row label="x" min={pos0.x - 2} max={pos0.x + 2} step={0.005} value={pos0.x} disabled={readOnly}
          onInput={v => livePos('x', v)} />
        <Row label="y" min={pos0.y - 1.5} max={pos0.y + 1.5} step={0.005} value={pos0.y} disabled={readOnly}
          onInput={v => livePos('y', v)} />
        <Row label="z" min={pos0.z - 2} max={pos0.z + 2} step={0.005} value={pos0.z} disabled={readOnly}
          onInput={v => livePos('z', v)} />
      </Sec>
      <Sec title="Rotation (° deltas, world axes)">
        <Row label="pitch" min={-180} max={180} step={0.1} value={0} disabled={readOnly} perPx={0.25}
          title="world-axis pitch delta; orientation stays an exact file quaternion. Drag the LABEL to scrub: 4 px = 1° (Shift 5×)."
          onInput={v => liveRot('p', v)} />
        <Row label="yaw" min={-180} max={180} step={0.1} value={0} disabled={readOnly} perPx={0.25} onInput={v => liveRot('y', v)} />
        <Row label="roll" min={-180} max={180} step={0.1} value={0} disabled={readOnly} perPx={0.25} onInput={v => liveRot('r', v)} />
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
        <DataRows comp={comp} compPath={['data', 'components', ci]} edits={edits} ctx={ctx} markDirty={markDirty}
          liveEdit={() => engine?.liveDataEdit(Number(ci))}
          symJoint={(k, d) => engine?.propagateJoint(ci, k, d)} readOnly={readOnly} />
      </Sec>
      {!readOnly && <Sec title="Actions">
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
        {/* v1.4: parts are DELETABLE from the inspector (the user: clicking
            an existing component selects it AND allows deletion). bp splice
            + doc mirror together; later indices shift everywhere at once. */}
        <button data-testid="comp-delete"
          className="ml-2 rounded bg-red-900/60 px-2 py-1 text-[11px] text-ink hover:bg-red-800"
          onClick={() => { if (ctx) edits.deleteComp(ctx, ci); }}>
          Delete component
        </button>
      </Sec>}
    </div>
  );
}

function DataRows(p: {
  comp: BlueprintComponent; compPath: (string | number)[];
  edits: EditApi; ctx: EditCtx | null; markDirty: () => void;
  /** ci into data.components — every write re-renders the part's live model
   *  (Engine.liveDataEdit): propeller soup, dashboard, joints, conditionals */
  liveEdit?: () => void;
  symJoint?: (key: string, delta: number) => void; readOnly?: boolean;
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
            onChange={nv => { p.edits.dataField(p.ctx!, p.compPath, k, nv); p.markDirty(); p.liveEdit?.(); }} />;
        if (typeof v === 'number')
          return <Row key={k} label={k} min={Math.min(v - 10, -100)} max={Math.max(v + 10, 100)}
            step={0.1} value={v} disabled={p.readOnly}
            onInput={nv => {
              // angle/pos on a kinematic master move the twins in unison (v0.176)
              if ((k === 'angle' || k === 'pos') && p.symJoint) {
                const old = typeof p.comp.data?.[k] === 'number' ? (p.comp.data[k] as number) : 0;
                p.symJoint(k, nv - old);
              }
              p.edits.dataField(p.ctx!, p.compPath, k, nv); p.markDirty(); p.liveEdit?.();
            }} />;
        if (typeof v === 'string' && v.length <= 80)
          return (
            <label key={k} className="flex items-center gap-2 py-[2px]">
              <span className="w-[74px] shrink-0 truncate font-mono text-[10px] text-ink-dim">{k}</span>
              <input type="text" defaultValue={v} data-testid={`data-${k}`}
                onChange={e => { p.edits.dataField(p.ctx!, p.compPath, k, e.target.value); p.markDirty(); p.liveEdit?.(); }}
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
                  onInput={v => {
                    if (!ctx) return;
                    const old = typeof mc.data?.['angle'] === 'number' ? (mc.data['angle'] as number) : 0;
                    if (e.top >= 0) engine?.propagateJoint(e.top, 'angle', v - old);   // twins move in UNISON (v0.176)
                    edits.dataField(ctx, path, 'angle', v); engine?.dataEdited(); markDirty();
                    if (e.top >= 0) engine?.liveDataEdit(e.top);   // master's own joint node rides live
                  }} />
              )}
              {kinematic && typeof jd['pos'] === 'number' && path && ctx && (
                <Row label="joint slide (m)" min={-1} max={1} step={0.005} value={zc(jd['pos'] as number)}
                  onInput={v => {
                    if (!ctx) return;
                    const old = typeof mc.data?.['pos'] === 'number' ? (mc.data['pos'] as number) : 0;
                    if (e.top >= 0) engine?.propagateJoint(e.top, 'pos', v - old);
                    edits.dataField(ctx, path, 'pos', v); engine?.dataEdited(); markDirty();
                    if (e.top >= 0) engine?.liveDataEdit(e.top);   // master's own slide node rides live
                  }} />
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
  // VIEW mode (v1.4 user rule): ONLY the overall vessel stats, collapsable.
  if (p.statsOnly)
    return (
      <div className="flex h-full w-full flex-col overflow-y-auto bg-panel text-ink" data-testid="panels">
        <VesselStats engine={p.engine} bp={p.bp} rev={p.rev} />
      </div>
    );
  const place = p.tool === 'place';
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-panel text-ink" data-testid="panels">
      {/* THE TWO FLAVORS of this panel (v1.5 user rule: "the UI is not clear
          about how to select and edit — it should be on top of the pane in
          two flavors of the same panel"): ONE Edit|Place switch crowns the
          side panel in BOTH the Edit and Blocks modes. EDIT = click to
          SELECT (gizmo + inspector + Delete); PLACE = dock blocks/parts with
          a ghost. */}
      {p.onTool && p.tool && (
        <div className="shrink-0 border-b border-white/10 px-3 pb-2 pt-2">
          <div className="flex items-center gap-1">
            {([['edit', '✎ Edit'], ['place', '✚ Place']] as const).map(([t, l]) => (
              <button key={t} data-testid={`tooltab-${t}`} aria-pressed={p.tool === t}
                onClick={() => p.onTool!(t)}
                className={`ksp-btn flex-1 px-2 py-[5px] text-[11px] ${p.tool === t ? 'on font-semibold' : 'text-ink-dim'}`}>
                {l}
              </button>
            ))}
            {place && p.onMirrorPlace && (
              <button data-testid="place-mirror" title="⇄ also place the x-mirrored twin"
                aria-pressed={!!p.mirrorPlace} onClick={() => p.onMirrorPlace!(!p.mirrorPlace)}
                className={`ksp-btn px-2 py-[3px] text-[10px] ${p.mirrorPlace ? 'on' : ''}`}>
                ⇄ {p.mirrorPlace ? 'twin ON' : 'twin off'}
              </button>
            )}
          </div>
          <div data-testid="flavor-hint" className="pt-1 text-[10px] leading-snug text-ink-dim">
            {place ? 'hover a surface → ghost · click to DOCK · Shift continues the aimed block'
              : 'click a part or block to SELECT it — gizmo move/turn · inspector · Delete'}
          </div>
        </div>
      )}
      {/* the buoyancy planner (user 2026-10-22): a collapsible widget PART OF
          THE BUILDER — envelope volume from the hull skin, vacuum/helium/
          hydrogen lift at sea level, the per-altitude weight limit and the
          equilibrium ("floats at") altitude per gas. Collapsed = one row. */}
      <LiftWidget engine={p.engine} bp={p.bp} rev={p.rev} />
      {/* KSP order: the PARTS list leads, the context window follows, the
          camera/view settings sit at the bottom. Min-heights are load-
          bearing: when fixed content once exceeded the window the flex
          engine silently crushed the list to 8 px (rows rendered clipped,
          clicks intercepted) — caught by sym.spec at 1280×720. */}
      <div className="flex min-h-[160px] flex-[3] flex-col border-t border-white/10">
        <h3 className="ksp-label px-3 pt-2 text-[11px] font-semibold text-ink-dim">{place ? 'Catalog' : 'Parts'}</h3>
        <CompList bp={p.bp} rev={p.rev} sel={p.sel} onSelect={p.onSelect} onSelectSub={p.onSelectSub}
          manifest={p.manifest} placingType={p.placingType} onPlaceType={p.onPlaceType}
          listMode={place ? 'place' : 'edit'} />
      </div>
      <div className="min-h-0 flex-[3] border-t border-white/10 overflow-y-auto">
        {p.bottom !== undefined ? (
          <>
            {/* v2.0.0 merged editor: a selected SUBGRID stacks over the
                workspace too (its SubPanel + joint sliders used to vanish
                behind the blocks section — the panels.spec subgrid pin) */}
            {p.selOverBottom && p.sel.sub >= 0
              && <SubPanel {...p} key={`s${p.sel.sub}`} />}
            {p.selOverBottom && p.sel.sub < 0 && p.sel.ci >= 0
              && <Inspector {...p} key={`c${p.sel.ci}k${p.inspKey}`} />}
            {p.bottom ?? null}
          </>
        ) : p.sel.sub >= 0
          ? <SubPanel {...p} key={`s${p.sel.sub}`} />
          : p.sel.ci >= 0
            ? <Inspector {...p} key={`c${p.sel.ci}k${p.inspKey}`} />
            : <div className="px-3 py-2 text-[12px] text-ink-dim">nothing selected — click a part</div>}
      </div>
    </div>
  );
}
