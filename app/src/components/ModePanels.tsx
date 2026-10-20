// ModePanels.tsx — the workspace panels for the BLOCKS / WIRE / FLIGHT
// modes. Every mutation goes through the pure model modules onto bp + doc
// (App provides the funnel), then schedules the debounced scene reload.
import { useMemo, useState, useEffect } from 'react';
import { Sec, Num, SearchList } from './ui';
import type { Engine } from '../engine/scene';
import { FLOWS, type FlowKey } from '../engine/aero';
import type { EditCtx } from '../engine/edit';
import { docArrayInsert, docFromValue, docSetNumber, docArrayRemoveAt } from '../engine/doc';
import { blockFromCell, blockInfo, mirroredBlock, rotateType, setBlockField, type PlaceSpec } from '../engine/blocks';
import { shapeName } from '../engine/blockshapes';
import { autoWire, portCensus, connectedPorts, unconnectedPorts, WIRE_KINDS } from '../engine/wireops';
import { triCentroid } from '../engine/tris';
import type { Triangle } from '../engine/format';
import type { Blueprint } from '../engine/format';

// ------------------------------------------------------------- BLOCKS mode
export interface Brush { type: number; sx: number; sy: number; sz: number; slot: number }

/** The brush as a placement footprint (the Editor fills `cell` from the pick). */
export const brushSpec = (b: Brush): Pick<PlaceSpec, 'size' | 'type' | 'slot'> =>
  ({ size: [b.sx, b.sy, b.sz], type: b.type, slot: b.slot });

export function BlockPanel(p: {
  engine: Engine | null; ctx: EditCtx | null; bp: Blueprint;
  blockSel: number; brush: Brush;
  onBrush: (b: Brush) => void;
  onSelectBlock: (bi: number) => void;
  onApplied: () => void;                 // schedule reload + dirty
}) {
  const info = p.blockSel >= 0 ? blockInfo(p.bp, p.blockSel) : null;
  const TYPES: [number, string][] = [
    [0, 'Cube'], [1, 'Ramp A'], [5, 'Ramp B'], [9, 'Ramp C'], [13, 'Corner'], [21, 'Pyramid'],
    [45, 'Inv corner'], [4, 'Thin rod'],
  ];
  const apply = (k: Parameters<typeof setBlockField>[2], v: number) => {
    if (!info || !p.ctx) return;
    setBlockField(p.ctx.bp, p.blockSel, k, v);
    const d = p.ctx.doc; const path = ['data', 'blocks', p.blockSel];
    if (k === 'slot') for (let i = 0; i < 7; i++) docSetNumber(d, [...path, 'colors', i], Math.round(v));
    else docSetNumber(d, [...path, k], Math.round(v));
    p.onApplied();
  };
  return (
    <>
      <Sec title="Blocks — brush" testid="block-brush">
        <div className="flex flex-wrap gap-1 pb-1">
          {TYPES.map(([t, label]) => (
            <button key={t} data-testid={`btype-${t}`} onClick={() => p.onBrush({ ...p.brush, type: t })}
              className={`ksp-btn px-1.5 py-[2px] text-[10px] ${p.brush.type === t ? 'on' : ''}`}>
              {label}
            </button>
          ))}
          <button data-testid="btype-rot" title="⟲ rotate the shape's orientation (the game's scroll wheel)"
            onClick={() => p.onBrush({ ...p.brush, type: rotateType(p.brush.type) })}
            className="ksp-btn px-1.5 py-[2px] text-[10px]">
            ⟲ {shapeName(p.brush.type)} {p.brush.type === 0 ? '' : p.brush.type}
          </button>
        </div>
        <div className="flex gap-2">
          <Num label="sx" value={p.brush.sx} min={0} max={8} onCommit={v => p.onBrush({ ...p.brush, sx: v })} />
          <Num label="sy" value={p.brush.sy} min={0} max={8} onCommit={v => p.onBrush({ ...p.brush, sy: v })} />
          <Num label="sz" value={p.brush.sz} min={0} max={8} onCommit={v => p.onBrush({ ...p.brush, sz: v })} />
        </div>
        <Num label="slot" value={p.brush.slot} min={0} max={255} onCommit={v => p.onBrush({ ...p.brush, slot: v })} />
        <div className="pt-1 text-[10px] leading-snug text-ink-dim">
          Hover a block, part or hull triangle to preview · click to place ·
          <b> Shift</b> over a block copies it / logically continues its shape
          (the game's rule) · ⇄ mirrors the twin · Delete removes the selected block.
        </div>
      </Sec>
      <Sec title={info ? `Block[${p.blockSel}]` : 'Blocks — nothing selected'} testid="block-edit">
        {!info && <div className="text-[11px] text-ink-dim">Click an existing block to edit it.</div>}
        {info && (
          <>
            <div className="flex gap-2">
              <Num label="cx" value={info.cell[0]} min={-2048} max={2048} onCommit={v => apply('cx', v)} />
              <Num label="cy" value={info.cell[1]} min={-2048} max={2048} onCommit={v => apply('cy', v)} />
              <Num label="cz" value={info.cell[2]} min={-2048} max={2048} onCommit={v => apply('cz', v)} />
            </div>
            <div className="flex gap-2">
              <Num label="size x" value={info.size[0]} min={0} max={12} onCommit={v => apply('size_x', v)} />
              <Num label="size y" value={info.size[1]} min={0} max={12} onCommit={v => apply('size_y', v)} />
              <Num label="size z" value={info.size[2]} min={0} max={12} onCommit={v => apply('size_z', v)} />
            </div>
            <div className="flex gap-2">
              <Num label="type" value={info.type} min={0} max={254} onCommit={v => apply('type', v)} />
              <Num label="slot" value={info.slot} min={0} max={255} onCommit={v => apply('slot', v)} />
            </div>
            <div className="mt-1 flex gap-1">
              <button data-testid="block-delete"
                className="rounded bg-red-900/60 px-2 py-1 text-[11px] text-ink hover:bg-red-800"
                onClick={() => {
                  if (!p.ctx) return;
                  p.ctx.bp.data.blocks.splice(p.blockSel, 1);
                  docArrayRemoveAt(p.ctx.doc, ['data', 'blocks'], p.blockSel);
                  p.onSelectBlock(-1);
                  p.onApplied();
                }}>
                Delete block
              </button>
              <button className="rounded bg-panel2 px-2 py-1 text-[11px] text-ink-dim hover:text-ink"
                onClick={() => p.onSelectBlock(-1)}>Deselect</button>
            </div>
          </>
        )}
      </Sec>
    </>
  );
}

/** App-side: place a block from a placement spec (blocks mode): the brush at
 *  the picked cell, or the Shift continuation block complementBlock computed.
 *  With `mirror` the ⇄ twin lands at the x-mirrored cell too (type mirrored;
 *  same-face colour slots kept — single-slot brush paints are the exact case). */
export function placeBlock(ctx: EditCtx, spec: PlaceSpec, mirror = false): number {
  const block = blockFromCell(spec.cell, spec.size, spec.type, spec.slot);
  ctx.bp.data.blocks.push(block);
  const at = ctx.bp.data.blocks.length - 1;
  docArrayInsert(ctx.doc, ['data', 'blocks'], at, docFromValue(block));
  if (mirror) {
    const twin = mirroredBlock(block);
    ctx.bp.data.blocks.push(twin);
    docArrayInsert(ctx.doc, ['data', 'blocks'], ctx.bp.data.blocks.length - 1, docFromValue(twin));
  }
  return at;
}

// -------------------------------------------------------------- WIRE mode
export function WirePanel(p: {
  engine: Engine | null; ctx: EditCtx | null; bp: Blueprint; rev: number;
  onApplied: () => void; onSelectComp: (ci: number) => void;
  /** currently selected component (drives the manual port list) */
  sel: number;
  /** manual connect: returns success (the App writes bp + doc + reload) */
  onConnect: (aCi: number, aPort: string, bCi: number, bPort: string) => boolean;
  /** list-hover 3D preview of a candidate (null restores the selection-only
   *  glow — the part being edited is never replaced, only supplemented) */
  onHoverComp: (ci: number | null) => void;
}) {
  const [draft, setDraft] = useState<{ ci: number; name: string; kind: string; at: number[] } | null>(null);
  // two-step manual wiring: candidate COMPONENT first, then explicitly one
  // of ITS free ports (the user: "let me select target ports on compatible
  // elements manually, so that this can be evaluated")
  const [tPart, setTPart] = useState<number | null>(null);
  const [connectMsg, setConnectMsg] = useState('');
  const manifest = p.engine?.manifest ?? null;
  const census = useMemo(() => portCensus(p.bp, manifest), [p.bp, manifest, p.rev]);
  const used = useMemo(() => connectedPorts(p.bp), [p.bp, p.rev]);
  const open = useMemo(() => unconnectedPorts(p.bp, manifest), [p.bp, manifest, p.rev]);
  const [msg, setMsg] = useState('');
  const run = (strategy: 'observed' | 'naive') => {
    if (!p.ctx) return;
    const before = p.ctx.bp.data.pipes?.length ?? 0;
    const res = autoWire(p.ctx.bp, manifest, strategy);
    for (let i = before; i < (p.ctx.bp.data.pipes ?? []).length; i++)
      docArrayInsert(p.ctx.doc, ['data', 'pipes'], i, docFromValue(p.ctx.bp.data.pipes![i]));
    setMsg(res.created
      ? `wired ${res.created} cable${res.created === 1 ? '' : 's'} \u2014 ${strategy === 'observed' ? 'batteries ∥, edges→hubs, routers→computer' : 'nearest free pairs'}`
      : 'nothing to pair — no compatible free ports remained');
    p.onApplied();
  };
  const perKind = WIRE_KINDS.map(k => ({
    kind: k,
    total: census.filter(c => c.kind === k).length,
    wired: census.filter(c => c.kind === k && used.has(`${c.ci}/${c.name}`)).length,
  })).filter(k => k.total > 0);
  return (
    <div className="grid items-start gap-x-4 px-1 pb-2 md:grid-cols-3">
      <Sec title="Ports" testid="wire-census">
        {perKind.map(k => (
          <div key={k.kind} className="flex justify-between text-[11px]">
            <span className="text-ink">{k.kind}</span>
            <span className={k.wired < k.total ? 'text-gold' : 'text-emerald-400'}>
              {k.wired}/{k.total} connected
            </span>
          </div>
        ))}
        {perKind.length === 0 && <div className="text-[11px] text-ink-dim">no ports on this craft</div>}
        <button data-testid="auto-wire"
          className="mt-2 w-full rounded bg-accent px-2 py-1 text-[12px] font-semibold text-black hover:brightness-110"
          onClick={() => run('observed')}
          title="batteries in parallel · pumps & intakes to the nearest junction · data to the nearest router, routers on to the computer">
          Auto-wire (observed patterns)
        </button>
        <button data-testid="auto-wire-naive"
          className="mt-1 w-full rounded bg-panel2 px-2 py-1 text-[11px] text-ink-dim hover:text-ink"
          onClick={() => run('naive')}>
          fallback: naive nearest pairs
        </button>
        {msg && <div className="pt-1 text-[10px] text-ink-dim">{msg}</div>}
      </Sec>
      <Sec title="Manual wiring" testid="wire-manual">
        {p.sel < 0 && <div className="text-[11px] text-ink-dim">Select a component (list or viewport) to see its ports.</div>}
        {p.sel >= 0 && (
          <>
            <div className="pb-1 text-[11px] text-ink">
              {p.bp.data.components[p.sel]?.type}[{p.sel}] ports:
            </div>
            {census.filter(c => c.ci === p.sel).map(c => {
              const wired = used.has(`${c.ci}/${c.name}`);
              return (
                <button key={c.name} data-testid="wire-port" disabled={wired}
                  className={`block w-full truncate rounded px-2 py-[2px] text-left text-[11px] ${
                    draft?.name === c.name && draft?.ci === c.ci ? 'bg-accent/30 text-accent'
                      : wired ? 'text-ink-dim' : 'bg-panel2 text-ink hover:bg-white/10'}`}
                  onClick={() => setDraft({ ci: c.ci, name: c.name, kind: c.kind, at: c.at })}>
                  {wired ? '✓' : '○'} {c.name}
                  <span className="ml-2 text-[10px] text-ink-dim">{c.kind}</span>
                </button>
              );
            })}
            {draft && (
              <div className="pt-2">
                <div className="flex items-center justify-between pb-1">
                  <span className="text-[10px] uppercase tracking-wide text-ink-dim">
                    {draft.kind} from {draft.name} →
                  </span>
                  <button className="text-[10px] text-ink-dim hover:text-ink"
                    onClick={() => { setDraft(null); setTPart(null); p.onHoverComp(null); }}>cancel</button>
                </div>
                <SearchList testid="wire-target" placeholder="choose a compatible part (hover previews it)…"
                  onHover={id => p.onHoverComp(id ? +id.split('/')[0]! : null)}
                  entries={(() => {
                    const byCi = new Map<number, { type: string; n: number; d: number; port: string }>();
                    for (const q of open) {
                      if (q.ci === draft.ci || q.kind !== draft.kind) continue;
                      const dd = Math.hypot(q.at[0]! - draft.at[0]!, q.at[1]! - draft.at[1]!, q.at[2]! - draft.at[2]!);
                      const cur = byCi.get(q.ci);
                      if (!cur || dd < cur.d)
                        byCi.set(q.ci, { type: q.type, n: (cur?.n ?? 0) + 1, d: dd, port: q.name });
                      else cur.n += 1;
                    }
                    return [...byCi.entries()]
                      .sort((a, b) => a[1].d - b[1].d)
                      .map(([ci, v]) => ({
                        id: `${ci}/${v.port}`,
                        label: `${v.type}[${ci}]${tPart === ci ? '  ◂' : ''}`,
                        sub: `${v.n} free · ${v.d.toFixed(1)} m`,
                      }));
                  })()}
                  onPick={id => { setTPart(+id.split('/')[0]!); setConnectMsg(''); }} />
                {tPart !== null && (
                  <div className="pt-2">
                    <div className="pb-1 text-[10px] uppercase tracking-wide text-ink-dim">
                      free {draft.kind} ports on {p.bp.data.components[tPart]?.type}[{tPart}]:
                    </div>
                    {open.filter(q => q.ci === tPart && q.kind === draft.kind).map(q => (
                      <button key={q.name} data-testid="wire-target-port"
                        className="mt-[2px] block w-full truncate rounded bg-panel2 px-2 py-[2px] text-left text-[11px] text-ink hover:bg-white/10"
                        onMouseEnter={() => p.onHoverComp(tPart)}
                        onClick={() => {
                          const ok = p.onConnect(draft.ci, draft.name, tPart, q.name);
                          setConnectMsg(ok ? `wired ${draft.name} → ${p.bp.data.components[tPart]?.type}[${tPart}]/${q.name}`
                            : 'invalid pairing (port busy or incompatible)');
                          if (ok) { setDraft(null); setTPart(null); }
                          p.onHoverComp(null);
                        }}>
                        ○ {q.name} <span className="text-[10px] text-ink-dim">{q.kind}</span>
                      </button>
                    ))}
                  </div>
                )}
                {connectMsg && <div className="pt-1 text-[10px] text-ink-dim">{connectMsg}</div>}
              </div>
            )}
          </>
        )}
      </Sec>
      <Sec title={`Warnings — unconnected (${open.length})`} testid="wire-warnings">
        {open.length === 0 && <div className="text-[11px] text-emerald-400">every port is wired ✓</div>}
        <div className="max-h-64 space-y-[2px] overflow-y-auto" onMouseLeave={() => p.onHoverComp(null)}>
          {open.map(w => (
            <button key={`${w.ci}/${w.name}`} data-testid="wire-warning"
              className="block w-full truncate rounded bg-panel2 px-2 py-[3px] text-left text-[11px] text-ink hover:bg-white/10"
              onMouseEnter={() => p.onHoverComp(w.ci)}
              onClick={() => p.onSelectComp(w.ci)}
              title={`${w.type} ${w.name} — ${w.kind} port not on any cable`}>
              <span className="text-gold">⚠</span> {w.type}[{w.ci}] {w.name} — {w.kind}
            </button>
          ))}
        </div>
      </Sec>
    </div>
  );
}

// ------------------------------------------------------------ FLIGHT mode
const v3 = (v: readonly number[]) => `(${v[0]!.toFixed(2)}, ${v[1]!.toFixed(2)}, ${v[2]!.toFixed(2)})`;

export function FlightPanel(p: { engine: Engine | null; rev: number }) {
  const r = p.engine?.flightReportData();
  p.rev;
  if (!r) return null;
  const byType = new Map<string, number>();
  for (const e of r.engines) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
  const netMag = Math.hypot(...r.net);
  const aligned = r.heading && netMag > 1e-6
    ? ((r.net[0]! * -r.heading[0]! + r.net[2]! * -r.heading[2]!) / netMag) : null;
  return (
    <>
      <Sec title="Flight analysis — propulsion" testid="flight-prop">
        <div className="text-[11px] text-ink">
          {byType.size === 0 && <span className="text-ink-dim">no directional thrusters / props</span>}
          {[...byType].map(([t, n]) => <div key={t}>{t} ×{n}</div>)}
        </div>
        <div className="mt-1 space-y-[2px] text-[11px] text-ink-dim">
          <div>net thrust (view) {v3(r.net)} · |net| {netMag.toFixed(2)}</div>
          <div>main drive {v3(r.mainNet)}{r.rcsOnly && ' · RCS is the sole class'}</div>
          <div>heading {r.heading ? v3(r.heading) : <span className="text-gold">no cockpit</span>}</div>
          {aligned !== null && (
            <div className={aligned > 0.5 ? 'text-emerald-400' : aligned < -0.5 ? 'text-red-400' : 'text-gold'}>
              {aligned > 0.5 ? 'thrust drives the nose forward'
                : aligned < -0.5 ? 'thrust pushes TAIL-FIRST against the cockpit axis'
                  : 'thrust is off the flight axis — trim/attitude only'}
            </div>
          )}
        </div>
      </Sec>
      <Sec title={`Control surfaces (${r.surfaces.length})`} testid="flight-surfaces">
        {r.surfaces.length === 0 && <div className="text-[11px] text-ink-dim">none</div>}
        {r.surfaces.slice(0, 24).map(s => (
          <div key={s.ci} className="text-[11px] text-ink">
            {s.type}[{s.ci}] — <span className="text-ink-dim">{s.angle.toFixed(1)}° saved</span>
          </div>
        ))}
      </Sec>
      <Sec title="Mass" testid="flight-mass">
        <div className="text-[11px] text-ink-dim">
          declared {r.mass.declared.toFixed(0)} kg · computed {r.mass.total.toFixed(0)} kg<br />
          CoM {v3(r.mass.com)} (raw file space)
        </div>
      </Sec>
    </>
  );
}

// -------------------------------------------------------------- WIND mode
const FLOW_KEYS: [FlowKey, string][] = [
  ['nose', '← nose'], ['tail', 'tail →'], ['left', 'left'], ['right', 'right'],
  ['up', 'up'], ['down', 'down'],
];

/** The WIND TUNNEL panel (engine/aero.ts): the Archean shape-field model
 *  (wiki.archean.space §Aerodynamics — see FORMAT.md): flow direction, the
 *  live multigrid solve status, and the cross-section analysis (frontal
 *  area, fineness-weighted form drag, thin-wing classification). */
export function WindPanel(p: { engine: Engine | null; rev: number }) {
  const [now, setNow] = useState(0);
  p.rev;
  const st = p.engine?.windState();
  // keep the status live: poll while mounted (the solve usually lands in
  // the first second — a running-gated interval could clear before the
  // final state ever rendered)
  useEffect(() => {
    const t = setInterval(() => setNow(n => n + 1), 400);
    return () => clearInterval(t);
  }, []);
  void now;
  const flowKey = st ? (FLOW_KEYS.map(([k]) => k).find(k =>
    FLOWS[k][0] === st.flow[0] && FLOWS[k][1] === st.flow[1] && FLOWS[k][2] === st.flow[2]) ?? 'nose') : 'nose';
  const r = st?.report;
  return (
    <>
      <Sec title="Wind tunnel — flow direction" testid="wind-flows">
        <div className="flex flex-wrap gap-1 pb-1">
          {FLOW_KEYS.map(([k, label]) => (
            <button key={k} data-testid={`wind-flow-${k}`}
              className={`ksp-btn px-1.5 py-[3px] text-[11px] ${flowKey === k ? 'on' : ''}`}
              onClick={() => p.engine?.setWindTunnel(true, FLOWS[k]!)}>
              {label}
            </button>
          ))}
        </div>
        <div data-testid="wind-status" className="text-[11px] text-ink-dim">
          {!st?.on && <span>idle — pick a direction</span>}
          {!!st?.solid && <>body {st.solid} voxels · {(st.voxel * 100).toFixed(0)} cm/voxel<br /></>}
          {st?.running && <span className="text-gold">solving… {st.iters} V-cycles (res {st.res.toExponential(1)})</span>}
          {st?.converged && <span className="text-emerald-400">flow converged · {st.lines} streamlines</span>}
        </div>
        <div className="pt-1 text-[10px] leading-snug text-ink-dim">
          Potential flow through the collider shape field, with the game's
          fineness law: slender profiles keep the flow attached, bluff faces
          shed a slow wake. Lines: warm glow = fast, blue = slow/stagnation,
          uniform stream faded out.
        </div>
      </Sec>
      {r && (
        <Sec title="Shape-field analysis" testid="wind-report">
          <div className="space-y-[2px] text-[11px] text-ink-dim">
            <div>frontal area <span className="text-ink">{r.frontalArea.toFixed(2)} m²</span></div>
            <div>form drag (fineness-weighted){' '}
              <span className={r.dragCd < 0.4 ? 'text-emerald-400' : r.dragCd < 0.75 ? 'text-gold' : 'text-red-400'}>
                {(r.dragCd * 100).toFixed(0)} % of bluff
              </span>
            </div>
            <div>thin lifting cross-sections{' '}
              <span className={r.liftArea > 0.5 ? 'text-emerald-400' : 'text-ink'}>{r.liftArea.toFixed(2)} m²</span>
              <span className="text-ink-dim"> · {r.thinColumns}/{r.columns} columns</span>
            </div>
            <div className="pt-1 text-[10px]">
              Lift needs ANGLE OF ATTACK — this is the geometric wing
              criterion (wiki: thin cross-section normal to the flow).
              Trim the craft nose-up with the seat axis for the force model.
            </div>
          </div>
        </Sec>
      )}
    </>
  );
}

// ------------------------------------------------------------ TRIANGLES
const TRI_SLOTS = ['front', 'back', 'side v0-v1', 'side v1-v2', 'side v2-v0'];

export function TriPanel(p: {
  bp: Blueprint; ctx: EditCtx | null; draft: number[][]; triSel: number;
  onSlot: (i: number, v: number) => void; brush: number[];
  onUndo: () => void; onDeleted: () => void; onClearSel: () => void;
}) {
  const t: Triangle | undefined = p.triSel >= 0
    ? (p.bp.data.triangles ?? [])[p.triSel] : undefined;
  const o = t as unknown as Record<string, unknown> | undefined;
  const tn = (v: unknown) => Number(v ?? 0);
  return (
    <>
      <Sec title={`Triangles — draft ${p.draft.length}/3 corners`} testid="tri-draft">
        <div className="text-[10px] leading-snug text-ink-dim">
          Click lattice corners on any surface; the third click commits the
          prism. Click an existing triangle's middle to select it.
          Snapping is to the 0.25 m hull lattice.
        </div>
        {p.draft.length > 0 && (
          <button data-testid="tri-undo" onClick={p.onUndo}
            className="mt-1 rounded bg-panel2 px-2 py-[3px] text-[11px] text-ink hover:bg-white/10">
            ↩ undo corner ({p.draft.length}/3)
          </button>
        )}
        <div className="pt-1 text-[10px] text-ink-dim">brush colours (palette slots):</div>
        {TRI_SLOTS.map((label, i) => (
          <Num key={i} label={label.slice(0, 9)} value={p.brush[i] ?? 51} min={0} max={255}
            onCommit={v => p.onSlot(i, v)} />
        ))}
      </Sec>
      <Sec title={p.triSel >= 0 ? `Triangle[${p.triSel}]` : 'Triangles — none selected'} testid="tri-edit">
        {!o && <div className="text-[11px] text-ink-dim">Click near a prism's centre to edit it.</div>}
        {o && (
          <>
            <div className="pb-1 font-mono text-[10px] text-ink-dim">
              frame ({tn(o.frame_x)}, {tn(o.frame_y)}, {tn(o.frame_z)}) · centroid
              ({triCentroid(t!).map(n => n.toFixed(2)).join(', ')})
            </div>
            {TRI_SLOTS.map((label, i) => (
              <Num key={i} label={label.slice(0, 9)} value={tn((o.colors as number[] | undefined)?.[i])} min={0} max={255}
                onCommit={v => {
                  const arr = [...(((t as unknown as { colors?: number[] }).colors) ?? [])]; arr[i] = v;
                  (t as unknown as { colors: number[] }).colors = arr;
                  if (p.ctx) docSetNumber(p.ctx.doc, ['data', 'triangles', p.triSel, 'colors', i], v);
                  p.onDeleted();                      // reuse: mark dirty + reload
                }} />
            ))}
            <div className="mt-1 flex gap-1">
              <button data-testid="tri-delete"
                className="rounded bg-red-900/60 px-2 py-1 text-[11px] text-ink hover:bg-red-800"
                onClick={() => {
                  if (!p.ctx) return;
                  p.ctx.bp.data.triangles!.splice(p.triSel, 1);
                  docArrayRemoveAt(p.ctx.doc, ['data', 'triangles'], p.triSel);
                  p.onDeleted();
                }}>
                Delete triangle
              </button>
              <button className="rounded bg-panel2 px-2 py-1 text-[11px] text-ink-dim hover:text-ink"
                onClick={p.onClearSel}>Deselect</button>
            </div>
          </>
        )}
      </Sec>
    </>
  );
}
