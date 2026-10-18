// ModePanels.tsx — the workspace panels for the BLOCKS / WIRE / FLIGHT
// modes. Every mutation goes through the pure model modules onto bp + doc
// (App provides the funnel), then schedules the debounced scene reload.
import { useMemo, useState } from 'react';
import type { Engine } from '../engine/scene';
import type { EditCtx } from '../engine/edit';
import { docArrayInsert, docFromValue, docSetNumber, docArrayRemoveAt } from '../engine/doc';
import { blockFromCell, blockInfo, setBlockField } from '../engine/blocks';
import { autoWire, portCensus, connectedPorts, unconnectedPorts, WIRE_KINDS } from '../engine/wireops';
import type { Blueprint } from '../engine/format';

const Sec = (p: { title: string; children?: React.ReactNode; testid?: string }) => (
  <section className="border-t border-white/10 px-3 py-2" data-testid={p.testid}>
    <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-dim">{p.title}</h3>
    {p.children}
  </section>
);

const Num = (p: { label: string; value: number; min: number; max: number;
  onCommit: (v: number) => void }) => {
  const [v, setV] = useState(String(p.value));
  return (
    <label className="flex items-center gap-1.5 py-[2px] text-[11px]">
      <span className="w-[46px] shrink-0 text-ink-dim">{p.label}</span>
      <input type="number" value={v} min={p.min} max={p.max}
        data-testid={`num-${p.label}`}
        className="w-[64px] rounded border border-white/10 bg-panel2 px-1 py-[1px] text-ink"
        onChange={e => { setV(e.target.value); const n = +e.target.value;
          if (e.target.value !== '' && isFinite(n)) p.onCommit(Math.max(p.min, Math.min(p.max, n))); }} />
    </label>
  );
};

// ------------------------------------------------------------- BLOCKS mode
export interface Brush { type: number; sx: number; sy: number; sz: number; slot: number }

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
              className={`rounded px-1.5 py-[2px] text-[10px] ${p.brush.type === t ? 'bg-accent/30 text-accent' : 'bg-panel2 text-ink-dim hover:text-ink'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Num label="sx" value={p.brush.sx} min={0} max={8} onCommit={v => p.onBrush({ ...p.brush, sx: v })} />
          <Num label="sy" value={p.brush.sy} min={0} max={8} onCommit={v => p.onBrush({ ...p.brush, sy: v })} />
          <Num label="sz" value={p.brush.sz} min={0} max={8} onCommit={v => p.onBrush({ ...p.brush, sz: v })} />
        </div>
        <Num label="slot" value={p.brush.slot} min={0} max={255} onCommit={v => p.onBrush({ ...p.brush, slot: v })} />
        <div className="pt-1 text-[10px] leading-snug text-ink-dim">
          Click a block FACE to place beside it · click empty space to select ·
          Delete removes the selected block.
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

/** App-side: place a block from a picked cell (blocks mode) */
export function placeBlock(ctx: EditCtx, cell: [number, number, number], brush: Brush): number {
  const block = blockFromCell(cell, [brush.sx, brush.sy, brush.sz], brush.type, brush.slot);
  ctx.bp.data.blocks.push(block);
  const at = ctx.bp.data.blocks.length - 1;
  docArrayInsert(ctx.doc, ['data', 'blocks'], at, docFromValue(block));
  return at;
}

// -------------------------------------------------------------- WIRE mode
export function WirePanel(p: {
  engine: Engine | null; ctx: EditCtx | null; bp: Blueprint; rev: number;
  onApplied: () => void; onSelectComp: (ci: number) => void;
}) {
  const manifest = p.engine?.manifest ?? null;
  const census = useMemo(() => portCensus(p.bp, manifest), [p.bp, manifest, p.rev]);
  const used = useMemo(() => connectedPorts(p.bp), [p.bp, p.rev]);
  const open = useMemo(() => unconnectedPorts(p.bp, manifest), [p.bp, manifest, p.rev]);
  const [msg, setMsg] = useState('');
  const perKind = WIRE_KINDS.map(k => ({
    kind: k,
    total: census.filter(c => c.kind === k).length,
    wired: census.filter(c => c.kind === k && used.has(`${c.ci}/${c.name}`)).length,
  })).filter(k => k.total > 0);
  return (
    <>
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
          onClick={() => {
            if (!p.ctx) return;
            const before = p.ctx.bp.data.pipes?.length ?? 0;
            const res = autoWire(p.ctx.bp, manifest);
            for (let i = before; i < (p.ctx.bp.data.pipes ?? []).length; i++)
              docArrayInsert(p.ctx.doc, ['data', 'pipes'], i, docFromValue(p.ctx.bp.data.pipes![i]));
            setMsg(res.created ? `auto-wired ${res.created} cable${res.created === 1 ? '' : 's'} (nearest free pairs)`
              : 'nothing to pair — no two free ports on different components');
            p.onApplied();
          }}>
          Auto-wire (naive nearest pairs)
        </button>
        {msg && <div className="pt-1 text-[10px] text-ink-dim">{msg}</div>}
      </Sec>
      <Sec title={`Warnings — unconnected (${open.length})`} testid="wire-warnings">
        {open.length === 0 && <div className="text-[11px] text-emerald-400">every port is wired ✓</div>}
        <div className="max-h-64 space-y-[2px] overflow-y-auto">
          {open.map(w => (
            <button key={`${w.ci}/${w.name}`} data-testid="wire-warning"
              className="block w-full truncate rounded bg-panel2 px-2 py-[3px] text-left text-[11px] text-ink hover:bg-white/10"
              onClick={() => p.onSelectComp(w.ci)}
              title={`${w.type} ${w.name} — ${w.kind} port not on any cable`}>
              <span className="text-gold">⚠</span> {w.type}[{w.ci}] {w.name} — {w.kind}
            </button>
          ))}
        </div>
      </Sec>
    </>
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
