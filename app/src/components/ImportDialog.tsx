// components/ImportDialog.tsx — the 🧊 import WORKSPACE (File ▸ Import 3D
// model…): the live lattice preview (ImportPanel) + the knobs + the honest
// stats, and the Import button at the current offset. The zeppelin-style
// MOVED-GHOST flow lives in TOOLS ▸ Import 3D model (same engine, same
// commitImport). Laws: docs/IMPORT-3D.md § 7 (preview law, skin default,
// opaque slots, coplanar merge, one-tone colour choice).

import { useEffect, useMemo, useState } from 'react';
import FloatingWindow from './FloatingWindow';
import ImportPanel from './ImportPanel';
import type { EditCtx } from '../engine/edit';
import { commitImport, IMPORT_DEFAULTS, runImport } from '../engine/import';
import type { ImportOptions, ImportResult, SrcMesh } from '../engine/import';
import { DEFAULT_PALETTE } from '../engine/palette';

const MAT_NAMES = ['composite', 'steel', 'aluminium', 'force field',
  'timber', 'titanium', 'glass'];

export default function ImportDialog(p: {
  ctx: EditCtx;
  onClose: () => void;
  onApplied: (message: string) => void;
  /** THE GHOST LAW: stage the result as a MOVABLE cluster ghost (the Editor
   *  owns the widget: ⟲ turns, drag, ↩ retune, ✕/✔) — ✔ Build commits via
   *  the same commitImport the ⬇ button uses, at the GHOST's final offset */
  onStage: (payload: { blocks: import('../engine/format').Block[];
    triangles: import('../engine/format').Triangle[] }) => void;
}) {
  const bp = p.ctx.bp;
  const [srcs, setSrcs] = useState<SrcMesh[] | null>(null);
  const [srcName, setSrcName] = useState('');
  const [o, setO] = useState<ImportOptions>({ ...IMPORT_DEFAULTS });
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ImportResult | null>(null);

  const set = <K extends keyof ImportOptions>(k: K, v: ImportOptions[K]) =>
    setO(s => ({ ...s, [k]: v }));

  // live quantise (the preview IS the writer — same module, same options)
  const optsKey = JSON.stringify(o);
  useEffect(() => {
    if (!srcs) return;
    let live = true;
    setBusy(true);
    runImport(srcs, JSON.parse(optsKey) as ImportOptions)
      .then(r => { if (live) { setRes(r); setBusy(false); } })
      .catch(e => {
        if (live) { setRes(null); setBusy(false); void e; }
      });
    return () => { live = false; };
  }, [srcs, optsKey]);

  const s = res?.stats;
  const oneTone = !!s && s.slotCount === 1;
  const slotSwatch = (n: number) => {
    const e = DEFAULT_PALETTE[n];
    return e ? `rgb(${e.r},${e.g},${e.b})` : '#ff00ff';
  };
  const stats = useMemo(() => s && [
    ['source tris', s.srcTris, 'import-stat-src'],
    ['after QEM', s.decTris, 'import-stat-dec'],
    ['coplanar merged', s.merged, 'import-stat-merged'],
    ['collapsed', s.degenerate, 'import-stat-degen'],
    ['cells', s.cells, 'import-stat-cells'],
    ['blocks', s.blocks, 'import-stat-blocks'],
    ['skin tris', s.skinTris, 'import-stat-skin'],
    ['rescued (split)', s.rescued, 'import-stat-rescued'],
    ['skipped', s.skipped, 'import-stat-skipped'],
    ['non-manifold', s.nonManifold, 'import-stat-nonmanifold'],
    ['mass kg', Math.round(s.massKg), 'import-stat-mass'],
  ] as [string, number, string][], [s]);

  const row = 'flex items-center gap-2 text-[11px] leading-5';
  const chk = (label: string, v: boolean, on: (b: boolean) => void, id: string) => (
    <label className={row}>
      <input data-testid={id} type="checkbox" checked={v} onChange={e => on(e.target.checked)} />
      <span className="text-[#9fb4d0]">{label}</span>
    </label>
  );
  const num = (label: string, k: 'span' | 'budget', min: number, max: number, step: number) => (
    <label className={row}>
      <span className="w-24 shrink-0 text-[#9fb4d0]">{label}</span>
      <input data-testid={`import-${k}`} type="range" min={min} max={max} step={step}
        value={o[k]} className="min-w-0 flex-1"
        onChange={e => set(k, Number(e.target.value))} />
      <span className="w-12 text-right tabular-nums">{o[k]}</span>
    </label>
  );

  return (
    <FloatingWindow id="import" testid="import-dock" fullNarrow
      initial={(vw, vh) => {
        const w = Math.min(1180, vw - 24);
        return { x: Math.max(12, (vw - w) / 2), y: 18, w, h: vh - 36 };
      }}
      header={<span data-testid="import-title" className="flex items-center gap-2">
        🧊 Import 3D model
        <span className="text-[10px] text-[#9fb4d0]">
          {srcName || 'drop GLB / glTF (+.bin/.png) / OBJ+MTL / STL / PLY / 3DS / DAE'}
        </span>
      </span>}>
      <div className="flex h-full min-h-0 gap-2 p-2 text-[#e8edf4]">
        <div className="w-72 shrink-0 space-y-2 overflow-y-auto rounded p-2 bg-[#16233c]">
          <div className="flex gap-1 pt-1">
            {(['skin', 'blocks'] as const).map(m => (
              <button key={m} data-testid={`import-mode-${m}`}
                title={m === 'skin'
                  ? 'thin TRIANGLE hull on the lattice — the game\'s own ship-skin style: light, hollow, the faithful shape'
                  : 'solid VOXEL BOXES — every cell the model fills (shell mode: the boundary layer only). Heavier, blockier'}
                className={`ksp-btn flex-1 px-2 py-1 text-[11px] ${o.mode === m ? 'bg-[#2b4368] outline outline-1 outline-[#7dffcf]' : ''}`}
                onClick={() => set('mode', m)}>
                {m === 'skin' ? '🔺 Skin' : '🧱 Blocks'}
              </button>
            ))}
          </div>
          <div data-testid="import-mode-hint" className="px-1 text-[10px] leading-snug text-[#9fb4d0]">
            {o.mode === 'skin'
              ? <>🔺 <b>Skin</b> = the surface as thin hull TRIANGLES — the game's own ship-skin style: light, hollow, faithful. Ships, statues, buildings.</>
              : <>🧱 <b>Blocks</b> = solid voxel boxes (shell mode: only the boundary layer). Chunky, heavy — plinths, terrain props.</>}
          </div>

          {num('span (cells)', 'span', 4, 512, 2)}
          <label className={row}>
            <span className="w-24 shrink-0 text-[#9fb4d0]">source up</span>
            <select data-testid="import-up" className="ksp-btn px-1 text-[11px]"
              value={o.up} onChange={e => set('up', e.target.value as 'y' | 'z')}>
              <option value="y">Y-up (glTF/OBJ)</option>
              <option value="z">Z-up (STL/CAD)</option>
            </select>
            <select data-testid="import-yaw" className="ksp-btn px-1 text-[11px]"
              value={o.yaw}
              onChange={e => set('yaw', Number(e.target.value) as 0 | 90 | 180 | 270)}>
              {[0, 90, 180, 270].map(v => <option key={v} value={v}>{v}°</option>)}
            </select>
          </label>
          {([[0, 'x'], [1, 'y'], [2, 'z']] as const).map(([i, ax]) => (
            <label key={ax} className={row}>
              <span className="w-24 shrink-0 text-[#9fb4d0]">offset {ax}</span>
              <input data-testid={`import-offset-${i}`} type="range" min={-256} max={256}
                value={o.offset[i]} className="min-w-0 flex-1"
                onChange={e => {
                  const n = [...o.offset] as [number, number, number];
                  n[i] = Number(e.target.value);
                  set('offset', n);
                }} />
              <span className="w-12 text-right tabular-nums">{o.offset[i]}</span>
            </label>
          ))}

          <div className="pt-1">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-[#5f7494]">simplify</div>
            <div className="flex gap-1">
              {([['merge', '🧩 Coplanar'], ['qem', '📉 QEM'], ['off', '⛔ Off']] as const).map(([m, lab]) => (
                <button key={m} data-testid={`import-simplify-${m}`}
                  title={m === 'merge'
                    ? 'LOSSLESS: fuse coplanar triangles into their planar polygon (the zeppelin stitch) — silhouette EXACT'
                    : m === 'qem'
                      ? 'LOSSY: quadric collapse to a triangle budget — for absurdly dense scans only'
                      : 'no simplification'}
                  className={`ksp-btn flex-1 px-1 py-1 text-[11px] ${
                    (m === 'merge' && o.merge) || (m === 'qem' && o.decimate) ||
                    (m === 'off' && !o.merge && !o.decimate)
                      ? 'bg-[#2b4368] outline outline-1 outline-[#7dffcf]' : ''}`}
                  onClick={() => setO(sv => ({ ...sv,
                    merge: m === 'merge', decimate: m === 'qem' }))}>
                  {lab}
                </button>
              ))}
            </div>
          </div>
          {o.merge && o.mode === 'skin' &&
            chk('ignore colours in merge', o.mergeIgnoreColor,
              v => set('mergeIgnoreColor', v), 'import-merge-color')}
          {o.decimate && num('triangle budget', 'budget', 100, 20000, 100)}
          {o.mode === 'blocks' &&
            chk('hollow (shell only)', o.shell, v => set('shell', v), 'import-shell')}

          {/* THE ONE-TONE LAW: a source that quantises to ONE slot is a
              colour choice — pick it; a multi-tone source keeps its colours
              (with an explicit override) */}
          {s && s.slotCount > 0 && (
            <div className="rounded bg-[#101a2b] p-2">
              {oneTone ? (
                <>
                  <div className="mb-1 text-[10px] text-[#9fb4d0]">
                    source is ONE colour —
                    <span className="ml-1 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                      style={{ background: slotSwatch(s.commonSlot) }} /> slot {s.commonSlot}.
                    Pick the colour it should build in:
                  </div>
                  <div className="flex items-center gap-2">
                    <input data-testid="import-paint" type="checkbox" checked={o.paint > 0}
                      onChange={e => set('paint', e.target.checked ? s.commonSlot : 0)} />
                    <span className="text-[11px] text-[#9fb4d0]">paint all faces</span>
                    {o.paint > 0 && (
                      <>
                        <input data-testid="import-paintslot" type="range" min={11} max={255}
                          value={o.paint} className="min-w-0 flex-1"
                          onChange={e => set('paint', Number(e.target.value))} />
                        <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-sm"
                          style={{ background: slotSwatch(o.paint) }} />
                        <span className="w-8 text-right tabular-nums">{o.paint}</span>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-1 text-[10px] text-[#9fb4d0]">
                    source keeps its {s.slotCount} colours (quantised to slots)
                  </div>
                  <div className="flex items-center gap-2">
                    <input data-testid="import-paint" type="checkbox" checked={o.paint > 0}
                      onChange={e => set('paint', e.target.checked ? 40 : 0)} />
                    <span className="text-[11px] text-[#9fb4d0]">override to one colour</span>
                    {o.paint > 0 && (
                      <>
                        <input data-testid="import-paintslot" type="range" min={11} max={255}
                          value={o.paint} className="min-w-0 flex-1"
                          onChange={e => set('paint', Number(e.target.value))} />
                        <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-sm"
                          style={{ background: slotSwatch(o.paint) }} />
                        <span className="w-8 text-right tabular-nums">{o.paint}</span>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
          <label className={row}>
            <span className="w-24 shrink-0 text-[#9fb4d0]">material</span>
            <select data-testid="import-material" className="ksp-btn px-1 text-[11px]"
              value={o.material}
              onChange={e => set('material', Number(e.target.value))}>
              {MAT_NAMES.map((n, i) => <option key={n} value={i}>{i} {n}</option>)}
            </select>
          </label>

          <div className="flex gap-1">
            <button data-testid="import-ghost" disabled={!res?.ok || busy ||
              (res.blocks.length === 0 && res.triangles.length === 0)}
              title="stage the result as a MOVABLE GHOST — drag it onto the craft, ⟲-turn, ✔ Build (the zeppelin ritual)"
              className={`ksp-btn flex-1 px-2 py-1 text-[11px] font-bold disabled:opacity-40 ${
                res?.ok && !busy ? 'on' : ''}`}
              onClick={() => {
                if (!res?.ok) return;
                p.onStage({ blocks: res.blocks, triangles: res.triangles });
                p.onClose();
              }}>
              {busy ? 'quantising…' : '👻 Place as ghost…'}
            </button>
            <button data-testid="import-ok" disabled={!res?.ok || busy ||
              (res.blocks.length === 0 && res.triangles.length === 0)}
              title="write at the current OFFSET knobs (metres above)"
              className="ksp-btn flex-1 px-2 py-1 text-[11px] disabled:opacity-40"
              onClick={() => {
                if (!res?.ok) return;
                p.onApplied(commitImport(p.ctx, res, o.offset));
                p.onClose();
              }}>
              ⬇ At offset
            </button>
          </div>
          {!res?.ok && res?.reason && (
            <div className="px-1 text-[10px] text-[#ff9d7d]">{res.reason}</div>
          )}
        </div>

        <ImportPanel bp={bp} res={res} srcName={srcName}
          onSrcs={(sc, nm) => { setSrcs(sc); setSrcName(nm); }} />

        {stats && (
          <div data-testid="import-stats"
            className="absolute right-5 top-12 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 rounded bg-[#101a2b]/85 px-3 py-2 text-[11px] tabular-nums">
            {stats.map(([lab, v, id]) => (
              <div key={id} className="contents">
                <span className="text-[#9fb4d0]">{lab}</span>
                <span data-testid={id}
                  className={`text-right ${id === 'import-stat-nonmanifold' && v ? 'text-[#ff6b6b]' : ''}`}>
                  {v.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </FloatingWindow>
  );
}
