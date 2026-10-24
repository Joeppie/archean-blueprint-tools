// ModePanels.tsx — the merged editor's WORKSPACE panels: the EDIT panel's
// bottom (BlockPanel / TriPanel), the WIRE dock and the FLIGHT / WIND
// bottoms. Every mutation goes through the pure model modules onto bp + doc
// (Editor.tsx provides the funnel), then schedules the debounced scene reload.
import { useMemo, useState, useEffect } from 'react';
import { Sec, Num, SearchList } from './ui';
import type { Engine } from '../engine/scene';
import { FLOWS, type FlowKey } from '../engine/aero';
import { writeBlockDoc, writeBlockMaterial, type EditCtx } from '../engine/edit';
import { docArrayInsert, docFromValue, docSetNumber, docArrayRemoveAt } from '../engine/doc';
import { blockCells, blockFromCell, blockInfo, blockTwinIssues, blockMirrorTwin, cellOverlapSkip, flippedBlock,
  mirroredBlock, mirrorAxisIdx, MIRROR_TYPES, mirrorBlockCell, rotateType, rotatedBlock, setBlockField, setBlockGeom,
  snapBlockType, type MirrorAxis, type MirrorAxisOpt, type PlaceSpec } from '../engine/blocks';
import { shapeName } from '../engine/blockshapes';
import { MATERIALS, MATERIAL_HINT, materialName } from '../engine/tools';
import { cssColor, resolveColor } from '../engine/palette';
import { SwatchGrid, BlockPaint, type CustomPaint } from './ColorPanel';
import { autoWire, portCensus, connectedPorts, unconnectedPorts, WIRE_KINDS,
  hubInputIndex, candidatesFor, pipeLabel, wireNets } from '../engine/wireops';
import { flattenComponents } from '../engine/subgrid';
import { triCentroid } from '../engine/tris';
import type { Triangle } from '../engine/format';
import type { Blueprint } from '../engine/format';

// --------------------------------------------------- EDIT ▸ blocks workspace
export interface Brush { type: number; sx: number; sy: number; sz: number; slot: number; material?: number }

/** The brush as a placement footprint (the Editor fills `cell` from the pick). */
export const brushSpec = (b: Brush): Pick<PlaceSpec, 'size' | 'type' | 'slot' | 'material'> =>
  ({ size: [b.sx, b.sy, b.sz], type: b.type, slot: b.slot, material: b.material ?? 0 });

/** MATERIALS row (v1.7 user rule: "Blocks should let me edit material:
 *  composite, iron, glass, etc; this is NOT part of the color picker, and it
 *  should make it clear glass/metal is appearance"). The chips pick what the
 *  block IS in the game (mass/heat/build cost, FORMAT §blocks); the hint
 *  states the split so nobody hunts for "metal" in the palette. */
export function MaterialChips(p: { value: number; onPick: (m: number) => void; testid: string }) {
  return (
    <div data-testid={p.testid} className="flex flex-wrap items-center gap-1">
      {MATERIALS.map((name, m) => (
        <button key={name} data-testid={`${p.testid}-m${m}`} title={MATERIAL_HINT}
          onClick={() => p.onPick(m)}
          className={`ksp-btn px-1.5 py-[2px] text-[10px] ${p.value === m ? 'on' : ''}`}>
          {name}
        </button>
      ))}
    </div>
  );
}

export function BlockPanel(p: {
  engine: Engine | null; ctx: EditCtx | null; bp: Blueprint;
  blockSel: number; brush: Brush;
  /** PLACE docks blocks with the brush; EDIT edits the selected block */
  tab: 'place' | 'edit';
  /** v1 files carry no data.colors — the palette picker applies the remap */
  legacy: boolean;
  /** v1.5.21 SETTABLE mirror axis (⚙ row): the plane block twin identity,
   *  mirrored rows and in-place shape flips ride. Default x.
   *  v1.10.5: 'off' disables the session plane entirely. */
  mirrorAxis?: MirrorAxisOpt;
  onBrush: (b: Brush) => void;
  onSelectBlock: (bi: number) => void;
  onApplied: () => void;                 // schedule reload + dirty
  /** PALETTE paint of the selected block (faces = face-slot indices,
   *  undefined = all 7 uniform): the Editor funnel writes bp + doc for the
   *  block AND its ⇄ twin (paintTwinPair/mirrorFaceOrder). */
  onPaint?: (slot: number, faces?: number[]) => void;
  /** v1.7: the RGB picker plumbing (new palette slot / nearest snap) for the
   *  brush AND the selected block's face paint */
  custom?: CustomPaint;
}) {
  const [snapMsg, setSnapMsg] = useState('');
  const mAx = p.mirrorAxis ?? 'x';               // v1.5.21 settable mirror axis
  const mIdx = mirrorAxisIdx(mAx);
  const info = p.blockSel >= 0 ? blockInfo(p.bp, p.blockSel) : null;
  // SIMILAR BLOCKS ⇄: the block on the mirrored footprint with the same
  // extents and a compatible (identical-or-mirrored) shape — the block twin
  // index. Identified always; since v1.7.1 EVERY edit below drives it too
  // (mirrored), the ⇄ toggle gating only twin PLACEMENT.
  const twin = info ? blockMirrorTwin(p.bp, p.blockSel, mAx) : -1;
  // v1.8.0 UNIFORM MIRROR RULE diagnostic: what (if anything) breaks the
  // mirror on the footprint opposite this block — the RED ⚠ row + popup
  const twDiag = info ? blockTwinIssues(p.bp, p.blockSel, mAx) : null;
  const TYPES: [number, string][] = [
    [0, 'Cube'], [1, 'Ramp A'], [5, 'Ramp B'], [9, 'Ramp C'], [13, 'Corner'], [21, 'Pyramid'],
    [45, 'Inv corner'], [4, 'Thin rod'],
  ];
  /** mirror the live bp block's geometry into the doc — the shared writer
   *  (v1.4 fix: single-key "cx" writes vanished on save), so the gizmo commit
   *  and the panel rows can never drift apart. */
  const writeBlock = (bi: number) => { if (p.ctx) writeBlockDoc(p.ctx, bi); };
  /** v1.6: EVERY field edit (cx/cy/cz/size/type) mirrors — the twin takes
   *  the mirrored cell ON THE MIRROR AXIS (v1.5.21 settable — the corpus
   *  crafts are x), the EQUAL DELTA on the other two, its own clamped size
   *  and the mirrored-type turn (user: "ensure mirroring is respected,
   *  which currently it is not, when editing a block"). v1.7.1 (user: "it
   *  should also do whatever I do to the mirror block"): ALWAYS, not just
   *  while ⇄ is on. A colliding cell move REFUSES the twin's move (the
   *  gizmo's cellOverlapSkip contract — the pair may not interpenetrate);
   *  the self edit already applied stands. */
  const mirrorGeom = (k: 'cx' | 'cy' | 'cz' | 'size_x' | 'size_y' | 'size_z' | 'type', v: number) => {
    if (twin < 0 || !p.ctx) return;
    const bp = p.ctx.bp;
    const tw = bp.data.blocks[twin];
    if (!tw) return;
    if (k === 'cx' || k === 'cy' || k === 'cz') {
      const ax = mirrorAxisIdx(k[1] as MirrorAxis);
      const b = bp.data.blocks[p.blockSel]!;
      const bc = blockCells(b);
      const cv = blockCells(tw);
      const cell: [number, number, number] = [cv.x, cv.y, cv.z];
      const c: [number, number, number] = [cv.x, cv.y, cv.z];
      const bcv: [number, number, number] = [bc.x, bc.y, bc.z];
      if (ax === mIdx) {
        cell[ax] = mirrorBlockCell(Math.round(v), [tw.size_x, tw.size_y, tw.size_z][ax]!);
        if (cellOverlapSkip(bp, cell, [tw.size_x, tw.size_y, tw.size_z], [p.blockSel, twin])) return;
      } else {
        cell[ax] = c[ax]! + (Math.round(v) - bcv[ax]!);
      }
      setBlockField(bp, twin, k, cell[ax]!);
    } else if (k === 'type') {
      // twin >= 0 implies a real plane (off yields twin = -1, the guard above)
      setBlockField(bp, twin, 'type', MIRROR_TYPES[mAx as MirrorAxis][Math.round(v)] ?? Math.round(v));
    } else {
      setBlockField(bp, twin, k, v);            // setBlockField clamps per-twin
    }
    writeBlock(twin);
  };
  const apply = (k: Parameters<typeof setBlockField>[2], v: number) => {
    if (!info || !p.ctx) return;
    if (k === 'slot') { p.onPaint?.(v); return; }   // ⇄ twin + reload ride in onPaint
    setBlockField(p.ctx.bp, p.blockSel, k, v);
    if (k === 'cx' || k === 'cy' || k === 'cz') {
      const ax = k[1];
      const b = p.ctx.bp.data.blocks[p.blockSel]!;
      docSetNumber(p.ctx.doc, ['data', 'blocks', p.blockSel, `pos_${ax}`], b[`pos_${ax}` as 'pos_x']);
      docSetNumber(p.ctx.doc, ['data', 'blocks', p.blockSel, `frame_${ax}`], b[`frame_${ax}` as 'frame_x'] ?? 0);
    } else docSetNumber(p.ctx.doc, ['data', 'blocks', p.blockSel, k], Math.round(v));
    mirrorGeom(k, v);
    p.onApplied();
  };
  /** Run one in-place shape edit on the selected block AND ALWAYS its
   *  similar twin (v1.7.1). fn mutates bp and writes the doc; returns changed. */
  const editBlocks = (fn: (bi: number) => boolean) => {
    if (!p.ctx || p.blockSel < 0) return;
    const tw = blockMirrorTwin(p.bp, p.blockSel, mAx);
    const results = [fn(p.blockSel)];
    if (tw >= 0) results.push(fn(tw));
    if (results.some(Boolean)) p.onApplied();
  };
  const rotateInPlace = (axis: 'x' | 'y' | 'z') => editBlocks(bi => {
    const b = p.ctx!.bp.data.blocks[bi];
    if (!b) return false;
    const nb = rotatedBlock(b, axis, false);
    const c = blockCells(nb);
    setBlockGeom(b, [c.x, c.y, c.z], [nb.size_x, nb.size_y, nb.size_z], nb.type);
    writeBlock(bi);
    return true;
  });
  const flipInPlace = () => editBlocks(bi => {
    const b = p.ctx!.bp.data.blocks[bi];
    if (!b) return false;
    const t = flippedBlock(b, mAx === 'off' ? 'x' : mAx).type;   // self flip is a geometry op; off has no plane, x is the neutral self-mirror
    if (t === b.type) return false;
    b.type = t; writeBlock(bi);
    return true;
  });
  const cycleShape = () => editBlocks(bi => {
    const b = p.ctx!.bp.data.blocks[bi];
    if (!b) return false;
    b.type = rotateType(b.type); writeBlock(bi);
    return true;
  });
  /** ✧ snap: match the neighbours' geometry. Both self and twin snap from
   *  their OWN neighbourhood (computed before either changes), so the pair
   *  stays mirror-consistent. */
  const snap = () => {
    if (!p.ctx || p.blockSel < 0) return;
    const tw = blockMirrorTwin(p.bp, p.blockSel, mAx);
    const rs = snapBlockType(p.bp, p.blockSel);
    const rt = tw >= 0 ? snapBlockType(p.bp, tw) : null;
    if (!rs) { setSnapMsg('no neighbouring blocks to match'); return; }
    const parts: string[] = [];
    if (rs.type !== info?.type) parts.push(`Block[${p.blockSel}] → ${shapeName(rs.type)} ${rs.type}`);
    if (rt && tw >= 0 && rt.type !== p.bp.data.blocks[tw]?.type) parts.push(`twin → ${shapeName(rt.type)} ${rt.type}`);
    if (!parts.length) {
      setSnapMsg(`already flush with ${rs.neighbours} neighbour${rs.neighbours === 1 ? '' : 's'}`);
      return;
    }
    editBlocks(bi => {
      const r = bi === p.blockSel ? rs : rt;
      const b = p.ctx!.bp.data.blocks[bi];
      if (!b || !r || r.type === b.type) return false;
      b.type = r.type; writeBlock(bi);
      return true;
    });
    setSnapMsg(`${rs.converged ? 'converged on' : 'consensus of'} ${rs.neighbours} neighbour${rs.neighbours === 1 ? '' : 's'}: ${parts.join(', ')}`);
  };
  const deleteSel = () => {
    if (!p.ctx) return;
    const tw = blockMirrorTwin(p.bp, p.blockSel, mAx);
    const idx = [p.blockSel, ...(tw >= 0 ? [tw] : [])].sort((a, b) => b - a);
    for (const i of idx) {
      p.ctx.bp.data.blocks.splice(i, 1);
      docArrayRemoveAt(p.ctx.doc, ['data', 'blocks'], i);
    }
    p.onSelectBlock(-1);
    p.onApplied();
  };
  /** MATERIALS (v1.7): write the game material of the selected block (the
   *  similar twin always takes it too — an identity edit under the v1.8.0
   *  uniform mirror rule, no geometry to collide)
   *  into bp AND the doc (writeBlockMaterial adds the key to files that predate
   *  it; the game reader defaults a missing one to composite). */
  const setMaterial = (m: number) => {
    if (!p.ctx || p.blockSel < 0) return;
    const tw = blockMirrorTwin(p.bp, p.blockSel, mAx);
    writeBlockMaterial(p.ctx, p.blockSel, m);
    if (tw >= 0) writeBlockMaterial(p.ctx, tw, m);
    p.onApplied();
  };
  return (
    <>
      {p.tab === 'place' && (
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
          <div className="flex items-center gap-2">
            <Num label="slot" value={p.brush.slot} min={0} max={255} onCommit={v => p.onBrush({ ...p.brush, slot: v })} />
            {/* the brush's live colour (palette picker below) */}
            <span data-testid="brush-swatch" title={`brush slot ${p.brush.slot}`}
              className="inline-block h-5 w-5 rounded-[3px] border border-white/25"
              style={{ background: cssColor(resolveColor(p.bp.data.colors ?? null, p.brush.slot, p.legacy)) }} />
          </div>
          {/* MATERIALS (v1.7): what the placed block IS in the game — NOT a
              colour: glass/metal looks come from the palette slots above. */}
          <div className="flex items-center gap-2 pb-1 pt-1">
            <span className="w-[62px] shrink-0 text-[11px] text-ink-dim">material</span>
            <MaterialChips testid="brush-material" value={p.brush.material ?? 0}
              onPick={m => p.onBrush({ ...p.brush, material: m })} />
          </div>
          <div className="pb-1 text-[9px] leading-snug text-ink-dim">{MATERIAL_HINT}</div>
          {/* PALETTE (v1.6): choose the brush colour, badges = uses on vessel */}
          <div className="pt-1">
            <SwatchGrid bp={p.bp} legacy={p.legacy} current={p.brush.slot}
              onPick={slot => p.onBrush({ ...p.brush, slot })} custom={p.custom} />
          </div>
          <div className="pt-1 text-[10px] leading-snug text-ink-dim">
            Hover a block, part or hull triangle to preview · click to place ·
            <b> Shift</b> over a block copies it / logically continues its shape
            (the game's rule) · ⇄ mirrors the twin · the <b>✎ Edit</b> flavor
            selects a part or block to move, turn and delete.
          </div>
        </Sec>
      )}
      {p.tab === 'edit' && (
        <Sec title={info ? `Block[${p.blockSel}]` : 'Blocks — nothing selected'} testid="block-edit">
          {!info && <div className="text-[11px] text-ink-dim">
            Click an existing block to select and edit it — it gets a golden
            highlight (its ⇄ similar twin a dim one).
          </div>}
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
              {/* MATERIALS (v1.7): the block's game material (mass/heat/build
                  cost). v1.7.1: the SIMILAR TWIN is driven too (identity edits mirror
                  like geometry edits — a symmetric craft is built of one
                  material). The appearance is the Paint section below. */}
              <div className="flex items-center gap-2 pb-1 pt-1">
                <span className="w-[62px] shrink-0 text-[11px] text-ink-dim">
                  material <span data-testid="block-material-name" className="text-gold">{materialName(p.bp.data.blocks[p.blockSel]?.material)}</span>
                </span>
              </div>
              <MaterialChips testid="block-material" value={p.bp.data.blocks[p.blockSel]?.material ?? 0}
                onPick={setMaterial} />
              <div className="pt-1 text-[9px] leading-snug text-ink-dim">{MATERIAL_HINT}</div>
              {/* PALETTE (v1.6): per-face paint of THIS block (⇄ twin rides
                  the mirrored face mapping inside the Editor's onPaint) */}
              <div className="mt-1.5 text-[10px] uppercase tracking-wide text-ink-dim">
                Paint — pick a face, then a colour
              </div>
              <div className="mt-1">
                <BlockPaint bp={p.bp} legacy={p.legacy} bi={p.blockSel}
                  onPaint={(slot, faces) => p.onPaint?.(slot, faces)} custom={p.custom} />
              </div>
              {/* in-place SHAPE tools (the interface components have): every
                  op keeps the bbox centre AND drives the similar twin in
                  unison (editBlocks — the v1.8.0 uniform mirror rule) */}
              <div className="mt-1.5 text-[10px] uppercase tracking-wide text-ink-dim">
                Shape {shapeName(info.type)} {info.type} — in place
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                <button data-testid="block-rot-x" title="rotate the shape 90° about the world X, in place"
                  className="ksp-btn px-1.5 py-[2px] text-[10px]" onClick={() => rotateInPlace('x')}>⟲X</button>
                <button data-testid="block-rot-y" title="rotate the shape 90° about the world Y, in place"
                  className="ksp-btn px-1.5 py-[2px] text-[10px]" onClick={() => rotateInPlace('y')}>⟲Y</button>
                <button data-testid="block-rot-z" title="rotate the shape 90° about the world Z, in place"
                  className="ksp-btn px-1.5 py-[2px] text-[10px]" onClick={() => rotateInPlace('z')}>⟲Z</button>
                <button data-testid="block-flip" title="⇄ mirror the shape across its own plane, in place (fixes a wrongly-faced block)"
                  className="ksp-btn px-1.5 py-[2px] text-[10px]" onClick={flipInPlace}>⇄ flip</button>
                <button data-testid="block-rot" title="⟲ cycle the orientation family (the game's scroll wheel)"
                  className="ksp-btn px-1.5 py-[2px] text-[10px]" onClick={cycleShape}>⟲ cycle</button>
                <button data-testid="block-snap" title="✧ snap: adopt the shape/geometry its neighbours agree on (converged, else consensus)"
                  className="ksp-btn px-1.5 py-[2px] text-[10px]" onClick={snap}>✧ snap</button>
              </div>
              {snapMsg && <div data-testid="snap-msg" className="pt-1 text-[10px] text-ink-dim">{snapMsg}</div>}
              <div data-testid="block-twin" className="pt-1 text-[10px]">
                {twDiag?.issues.length
                  ? <span className={twDiag.info ? 'text-sky-300' : 'text-red-400'}>
                      {twDiag.info ? 'ℹ' : '⚠'} {twDiag.info ? 'differs in appearance' : 'mirror conflict'}
                      {twin >= 0 ? `: Block[${twin}]` : ''}
                      — {twDiag.issues.join(', ')}{twin < 0 ? ' (edits do NOT mirror)' : ''}</span>
                  : twin >= 0
                    ? <span className="text-gold">⇄ similar twin: Block[{twin}] (edits mirror to it)</span>
                    : <span className="text-ink-dim">no similar (mirrored) block</span>}
              </div>
              <div className="mt-1 flex gap-1">
                <button data-testid="block-delete"
                  className="rounded bg-red-900/60 px-2 py-1 text-[11px] text-ink hover:bg-red-800"
                  onClick={deleteSel}>
                  {twin >= 0 ? 'Delete block + twin' : 'Delete block'}
                </button>
                <button data-testid="block-deselect"
                  className="rounded bg-panel2 px-2 py-1 text-[11px] text-ink-dim hover:text-ink"
                  onClick={() => p.onSelectBlock(-1)}>Deselect</button>
              </div>
            </>
          )}
        </Sec>
      )}
    </>
  );
}

/** Editor-side: place a block from a placement spec (the Edit mode's PLACE
 *  flavor): the brush at
 *  the picked cell, or the Shift continuation block complementBlock computed.
 *  With `mirror` the ⇄ twin lands at the mirrored cell too (v1.5.21: on the
 *  SETTABLE mirror axis, default x; type mirrored; same-face colour slots
 *  kept — single-slot brush paints are the exact case). */
export function placeBlock(ctx: EditCtx, spec: PlaceSpec, mirror = false,
  axis: MirrorAxisOpt = 'x'): number {
  const block = blockFromCell(spec.cell, spec.size, spec.type, spec.slot, spec.material ?? 0);
  ctx.bp.data.blocks.push(block);
  const at = ctx.bp.data.blocks.length - 1;
  docArrayInsert(ctx.doc, ['data', 'blocks'], at, docFromValue(block));
  if (mirror && axis !== 'off') {
    const twin = mirroredBlock(block, axis);
    ctx.bp.data.blocks.push(twin);
    docArrayInsert(ctx.doc, ['data', 'blocks'], ctx.bp.data.blocks.length - 1, docFromValue(twin));
  }
  return at;
}

// -------------------------------------------------------------- WIRE mode
/**
 * WIRE workspace (v1.10.1 redesign, user: "I want to be able to
 * disconnect/reconnect wires and get a better overview of what is wired to
 * what … a disconnect/reconnect for every component … ensure that logical
 * wiring decisions are possible"):
 *  • CABLES — every cable as `Type[9].port ↔ Computer[0].port` with a ✕
 *    DISCONNECT per row; hovering a row gold-lights that cable in 3D.
 *  • THIS PART — the selected component's ports: wired ones show their
 *    partner + a ✕, free ones arm the manual Connect flow.
 *  • Connect candidates are ranked by the wiremodel (logical association
 *    first, then distance) — but the list shows EVERY compatible port:
 *    the ranking orders the choices, the user makes them.
 *  • NETWORKS — per kind, each connected group of parts (sources → hubs →
 *    devices): the "what is wired to what" overview.
 *  • Auto-wire stays button-only and only ever fills FREE ports (existing
 *    cables are the user's decisions; the heuristic never overrides them).
 */
export function WirePanel(p: {
  engine: Engine | null; ctx: EditCtx | null; bp: Blueprint; rev: number;
  onApplied: () => void; onSelectComp: (ci: number) => void;
  /** currently selected component (drives the manual port list) */
  sel: number;
  /** manual connect: returns success (the App writes bp + doc + reload) */
  onConnect: (aCi: number, aPort: string, bCi: number, bPort: string) => boolean;
  /** v1.10.1 disconnect one cable by data.pipes index (Editor writes bp +
   *  doc); returns success */
  onDisconnect: (pi: number) => boolean;
  /** list-hover 3D preview of a candidate (null restores the selection-only
   *  glow — the part being edited is never replaced, only supplemented) */
  onHoverComp: (ci: number | null) => void;
  /** list-hover gold-lights ONE CABLE in the viewport (null clears) */
  onHoverPipe?: (pi: number | null) => void;
}) {
  const [draft, setDraft] = useState<{ ci: number; name: string; kind: string; at: readonly [number, number, number] } | null>(null);
  // two-step manual wiring: candidate COMPONENT first, then explicitly one
  // of ITS free ports (the user: "let me select target ports on compatible
  // elements manually, so that this can be evaluated")
  const [tPart, setTPart] = useState<number | null>(null);
  const [connectMsg, setConnectMsg] = useState('');
  const manifest = p.engine?.manifest ?? null;
  const census = useMemo(() => portCensus(p.bp, manifest), [p.bp, manifest, p.rev]);
  const used = useMemo(() => connectedPorts(p.bp), [p.bp, p.rev]);
  const open = useMemo(() => unconnectedPorts(p.bp, manifest), [p.bp, manifest, p.rev]);
  const hubIn = useMemo(() => hubInputIndex(census), [census, p.rev]);
  const flat = useMemo(() => flattenComponents(p.bp), [p.bp, p.rev]);
  const pipes = p.bp.data.pipes ?? [];
  const nets = useMemo(() => wireNets(p.bp, manifest), [p.bp, manifest, p.rev]);
  const [msg, setMsg] = useState('');
  const run = (strategy: 'observed' | 'naive') => {
    if (!p.ctx) return;
    const before = p.ctx.bp.data.pipes?.length ?? 0;
    const res = autoWire(p.ctx.bp, manifest, strategy);
    for (let i = before; i < (p.ctx.bp.data.pipes ?? []).length; i++)
      docArrayInsert(p.ctx.doc, ['data', 'pipes'], i, docFromValue(p.ctx.bp.data.pipes![i]));
    setMsg(res.created
      ? `wired ${res.created} cable${res.created === 1 ? '' : 's'} \u2014 ` +
        (strategy === 'observed' ? 'sources→hub inputs, devices←hub outputs, devices→routers→computer; '
          + `${res.skipped.length} port${res.skipped.length === 1 ? '' : 's'} left open (reasons in Warnings)`
          : 'nearest free pairs')
      : 'nothing to pair — no compatible free ports remained');
    p.onApplied();
  };
  const perKind = WIRE_KINDS.map(k => ({
    kind: k,
    total: census.filter(c => c.kind === k).length,
    wired: census.filter(c => c.kind === k && used.has(`${c.ci}/${c.name}`)).length,
  })).filter(k => k.total > 0);
  const roleBadge = (r: string) => r === 'in' ? '▼' : r === 'out' ? '▲' : '±';
  const roleTip = (r: string) => r === 'in' ? 'input (the game names it in/input)'
    : r === 'out' ? 'output (the game names it out/output)' : 'neutral port';
  /** partner label for a wired port of ci (top indices), else null */
  const flatIdxOf = (top: number) => flat.findIndex(f => f.top === top);
  const partnerOf = (topCi: number, name: string): { pi: number; label: string } | null => {
    const fi = flatIdxOf(topCi);
    if (fi < 0) return null;
    const pi = pipes.findIndex(q => (q.a_component === fi && q.a_port === name)
      || (q.b_component === fi && q.b_port === name));
    if (pi < 0) return null;
    const q = pipes[pi]!;
    const other = q.a_component === fi && q.a_port === name ? 'b' : 'a';
    const oi = q[`${other}_component` as 'a_component' | 'b_component'];
    const op = q[`${other}_port` as 'a_port' | 'b_port'];
    const e = flat[oi];
    const label = e ? (e.top >= 0 ? `${e.comp.type}[${e.top}].${op}` : `${e.comp.type}[B${e.path[2]}].${op}`)
      : `#${oi}.${op}`;
    return { pi, label };
  };
  const cut = (pi: number) => {
    if (p.onDisconnect(pi)) setMsg(`disconnected ${pipeLabel(p.bp, pi, flat) ?? `cable ${pi}`} — the ports are free again`);
  };
  /** the selected part's own cable list (the "disconnect for every
   *  component" path): every pipe touching the selection */
  const selPipes = (() => {
    if (p.sel < 0) return [] as number[];
    const fi = flatIdxOf(p.sel);
    if (fi < 0) return [];
    return pipes.map((_q, i) => i)
      .filter(i => { const q = pipes[i]!; return q.a_component === fi || q.b_component === fi; });
  })();
  /** ranked candidates for the draft port (wiremodel order; ALL kept) */
  const cands = useMemo(() => {
    if (!draft) return [] as ReturnType<typeof candidatesFor>;
    const d = open.find(q => q.ci === draft.ci && q.name === draft.name)
      ?? census.find(q => q.ci === draft.ci && q.name === draft.name);
    if (!d) return [];
    return candidatesFor(d as never, open.filter(q => q.kind === draft.kind), hubIn);
  }, [draft, open, hubIn, census, p.rev]);
  const candParts = (() => {
    const byCi = new Map<number, { type: string; n: number; d: number; why: string; tier: number }>();
    for (const c of cands) {
      const cur = byCi.get(c.port.ci);
      if (!cur) byCi.set(c.port.ci, { type: c.port.type, n: 1, d: c.dist, why: c.why, tier: c.tier });
      else { cur.n += 1; if (c.tier < cur.tier || (c.tier === cur.tier && c.dist < cur.d)) { cur.d = c.dist; cur.why = c.why; cur.tier = c.tier; } }
    }
    return [...byCi.entries()];      // candidatesFor already sorted
  })();
  return (
    <div className="grid grid-cols-1 items-start gap-x-4 px-1 pb-2 md:grid-cols-3">
      <div className="space-y-3">
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
            title="logical stages: batteries ∥ · sources into hub INPUTS · devices onto hub OUTPUTS · devices→routers→computer · named fluid/item flows — incompatible ports stay OPEN with a reason; existing cables are never touched">
            Auto-wire (logical wiring)
          </button>
          <button data-testid="auto-wire-naive"
            className="mt-1 w-full rounded bg-panel2 px-2 py-1 text-[11px] text-ink-dim hover:text-ink"
            onClick={() => run('naive')}>
            fallback: naive nearest pairs
          </button>
          {msg && <div className="pt-1 text-[10px] text-ink-dim">{msg}</div>}
        </Sec>
        <Sec title={`Networks — what is wired to what (${nets.length})`} testid="wire-nets">
          {nets.length === 0 && <div className="text-[11px] text-ink-dim">no cables yet</div>}
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {nets.map((n, i) => {
              const by = { source: [] as string[], hub: [] as string[], device: [] as string[] };
              for (const m of n.members) by[m.group].push(`${m.type}[${m.ci}]`);
              const chain = (arr: string[], cap = 5) =>
                arr.length <= cap ? arr.join(', ') : `${arr.slice(0, cap).join(', ')} +${arr.length - cap}`;
              const segs = [by.source, by.hub, by.device].filter(a => a.length)
                .map(a => chain(a));
              return (
                <div key={i} data-testid="wire-net" className="rounded bg-panel2 px-2 py-[3px]">
                  <div className="flex justify-between text-[10px] uppercase tracking-wide text-ink-dim">
                    <span>{n.kind}</span><span>{n.pipes.length} cables · {n.members.length} parts</span>
                  </div>
                  <div className="text-[11px] text-ink">{segs.join(' → ')}</div>
                  <div className="flex flex-wrap gap-1 pt-[2px]">
                    {n.members.slice(0, 12).map(m => (
                      <button key={m.ci} data-testid="wire-net-part"
                        className="rounded bg-black/25 px-1 text-[10px] text-ink hover:text-accent"
                        onMouseEnter={() => p.onHoverComp(m.ci)} onMouseLeave={() => p.onHoverComp(null)}
                        onClick={() => p.onSelectComp(m.ci)}>
                        {m.type}[{m.ci}]
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Sec>
      </div>
      <Sec title={`Cables (${pipes.length})`} testid="wire-cables"
        >
        <div className="max-h-[22rem] space-y-[2px] overflow-y-auto" onMouseLeave={() => p.onHoverPipe?.(null)}>
          {pipes.length === 0 && <div className="text-[11px] text-ink-dim">no cables — wire manually or auto-wire</div>}
          {pipes.map((q, pi) => {
            const label = pipeLabel(p.bp, pi, flat) ?? `#${pi}`;
            return (
              <div key={pi} className="flex items-center gap-1">
                <button data-testid={`wire-cable-${pi}`}
                  className="min-w-0 flex-1 truncate rounded bg-panel2 px-2 py-[3px] text-left text-[11px] text-ink hover:bg-white/10"
                  onMouseEnter={() => p.onHoverPipe?.(pi)}
                  onClick={() => {
                    const e = flat[q.a_component];
                    if (e?.top != null && e.top >= 0) p.onSelectComp(e.top);
                  }}
                  title={`${q.type ?? 'data'} cable — click selects the A part; ✕ disconnects`}>
                  {label}
                  <span className="ml-1 text-[9px] uppercase text-ink-dim">{q.type ?? 'data'}</span>
                </button>
                <button data-testid={`wire-cut-${pi}`}
                  className="rounded bg-panel2 px-1.5 py-[3px] text-[11px] text-red-300 hover:bg-red-500/25"
                  title="Disconnect this cable (Undo brings it back)"
                  onClick={() => cut(pi)}>✕</button>
              </div>
            );
          })}
        </div>
      </Sec>
      <div className="space-y-3">
        <Sec title={p.sel >= 0 ? `This part — ${p.bp.data.components[p.sel]?.type}[${p.sel}]` : 'Manual wiring'}
          testid="wire-manual">
          {p.sel < 0 && <div className="text-[11px] text-ink-dim">Select a component (list or viewport) to see its ports.</div>}
          {p.sel >= 0 && (
            <>
              <div className="pb-1 text-[11px] text-ink">
                {p.bp.data.components[p.sel]?.type}[{p.sel}] ports:
              </div>
              {census.filter(c => c.ci === p.sel).map(c => {
                const part = partnerOf(p.sel, c.name);
                return (
                  <div key={c.name} className="flex items-center gap-1">
                    <button data-testid="wire-port" disabled={!!part}
                      className={`min-w-0 flex-1 truncate rounded px-2 py-[2px] text-left text-[11px] ${
                        draft?.name === c.name && draft?.ci === c.ci ? 'bg-accent/30 text-accent'
                          : part ? 'text-ink-dim' : 'bg-panel2 text-ink hover:bg-white/10'}`}
                      title={`${roleTip(c.role)} · ${c.kind}${part ? ` — on: ${part.label}` : ' — click to wire'}`}
                      onClick={() => setDraft({ ci: c.ci, name: c.name, kind: c.kind, at: c.at })}>
                      {part ? '⇄' : '○'} {c.name}{' '}
                      <span className="ml-1 text-[9px] uppercase text-ink-dim">{c.kind}</span>
                      <span className="ml-1 text-[9px] text-ink-dim" title={roleTip(c.role)}>{roleBadge(c.role)}</span>
                      {part && <span className="ml-1 text-[10px] text-ink-dim">↔ {part.label}</span>}
                    </button>
                    {part && (
                      <button data-testid={`wire-cut-part-${c.name}`}
                        className="rounded bg-panel2 px-1.5 py-[2px] text-[11px] text-red-300 hover:bg-red-500/25"
                        title="Disconnect" onClick={() => cut(part.pi)}>✕</button>
                    )}
                  </div>
                );
              })}
              {selPipes.length > 0 && (
                <div className="pt-1 text-[10px] text-ink-dim">{selPipes.length} cable{selPipes.length === 1 ? '' : 's'} on this part</div>
              )}
              {draft && (
                <div className="pt-2">
                  <div className="flex items-center justify-between pb-1">
                    <span className="text-[10px] uppercase tracking-wide text-ink-dim">
                      {draft.kind} from {draft.name} →
                    </span>
                    <button className="text-[10px] text-ink-dim hover:text-ink"
                      onClick={() => { setDraft(null); setTPart(null); p.onHoverComp(null); }}>cancel</button>
                  </div>
                  <SearchList testid="wire-target" placeholder="logical candidates (hover previews the part)…"
                    onHover={id => p.onHoverComp(id ? +id.split('/')[0]! : null)}
                    entries={candParts.map(([ci, v]) => ({
                      id: `${ci}/0`,
                      label: `${v.type}[${ci}]${tPart === ci ? '  ◂' : ''}`,
                      sub: `${v.n} free · ${v.why} · ${v.d.toFixed(1)} m`,
                    }))}
                    onPick={id => { setTPart(+id.split('/')[0]!); setConnectMsg(''); }} />
                  {tPart !== null && (
                    <div className="pt-2">
                      <div className="pb-1 text-[10px] uppercase tracking-wide text-ink-dim">
                        free {draft.kind} ports on {p.bp.data.components[tPart]?.type}[{tPart}]:
                      </div>
                      {candidatesFor(
                        (open.find(q => q.ci === draft.ci && q.name === draft.name) ?? draft) as never,
                        open.filter(q => q.ci === tPart && q.kind === draft.kind), hubIn)
                        .map(c => (
                          <button key={c.port.name} data-testid="wire-target-port"
                            className="mt-[2px] block w-full truncate rounded bg-panel2 px-2 py-[2px] text-left text-[11px] text-ink hover:bg-white/10"
                            onMouseEnter={() => p.onHoverComp(tPart)}
                            onClick={() => {
                              const ok = p.onConnect(draft.ci, draft.name, tPart, c.port.name);
                              setConnectMsg(ok ? `wired ${draft.name} → ${p.bp.data.components[tPart]?.type}[${tPart}]/${c.port.name}`
                                : 'invalid pairing (port busy or incompatible)');
                              if (ok) { setDraft(null); setTPart(null); }
                              p.onHoverComp(null);
                            }}>
                            ○ {c.port.name}{' '}
                            <span className="text-[10px] text-ink-dim">{c.why} · {c.dist.toFixed(1)} m</span>
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
                title={`${w.type} ${w.name} — ${w.kind} ${roleTip(w.role)} (${w.group}${
                  w.group === 'hub' ? (hubIn.has(`${w.ci}/${w.kind}`) ? ', has inputs: this side is downstream' : '') : ''})`}>
                <span className="text-gold">⚠</span> {w.type}[{w.ci}] {w.name} — {w.kind} {roleBadge(w.role)}
              </button>
            ))}
          </div>
        </Sec>
      </div>
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
