// edit.ts pins: bp + DOC move together; occupancy + type-255 mirror sync at
// save reproduces the legacy serialize() semantics (cells = round(Δ/CELL),
// sequential consume-and-rekey), repeated saves are EXACT (applied-cells
// deltas), and an UNTOUCHED document re-emits byte-for-byte — including a
// zero-move save (occ rewritten to the same value keeps the raw literal).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { emitDoc, parseDoc } from '../doc';
import { makeCtx, resetComponent, serializeSave, setDataField, setPos } from '../edit';
import type { Blueprint } from '../format';
import { corpusDir } from '../../../tools/vite-corpus.ts';

const CORPUS = corpusDir();
const haveCorpus = existsSync(CORPUS);

const SRC = '{"data":{"blocks":[' +
  '{"pos_x":5,"pos_y":5,"pos_z":5,"frame_x":0,"frame_y":0,"frame_z":0,"size_x":1,"size_y":0,"size_z":0,"type":0,"colors":[1,1,1,1,1,1,1]},' +
  '{"pos_x":5,"pos_y":6,"pos_z":5,"frame_x":0,"frame_y":0,"frame_z":0,"size_x":1,"size_y":0,"size_z":0,"type":255}' +
  '],"components":[' +
  '{"type":"LowVoltageBattery","position":{"x":0.0,"y":0.25,"z":0.0},"orientation":{"w":1.0,"x":0.0,"y":0.0,"z":0.0},' +
  '"occupancies":[{"pos_x":5,"pos_y":6,"pos_z":5,"frame_x":0,"frame_y":0,"frame_z":0,"size_x":1,"size_y":0,"size_z":0}],' +
  '"data":{"angle":0.0,"state":true,"alias":"cell"}}]' +
  '}}';

const bpOf = (src: string) => parseDoc(src);

describe('doc-synced edits', () => {
  test('setPos writes bp AND the doc literal (float style kept)', () => {
    const doc = bpOf(SRC);
    const ctx = makeCtx(doc, JSON.parse(emitDoc(doc)) as Blueprint);
    setPos(ctx, 0, 'y', 0.5);
    expect(ctx.bp.data.components[0]!.position.y).toBe(0.5);
    expect(emitDoc(doc)).toContain('"y":0.5');           // was 0.25, float-styled
  });

  test('setDataField: number style, bool and string swap kinds', () => {
    const doc = bpOf(SRC);
    const ctx = makeCtx(doc, JSON.parse(emitDoc(doc)) as Blueprint);
    expect(setDataField(ctx, ['data', 'components', 0], 'angle', 12.5)).toBe(true);
    expect(setDataField(ctx, ['data', 'components', 0], 'state', false)).toBe(true);
    expect(setDataField(ctx, ['data', 'components', 0], 'alias', 'cell-2')).toBe(true);
    const out = emitDoc(doc);
    expect(out).toContain('"angle":12.5');
    expect(out).toContain('"state":false');
    expect(out).toContain('"alias":"cell-2"');
    const d = ctx.bp.data.components[0]!.data as Record<string, unknown>;
    expect(d['angle']).toBe(12.5); expect(d['state']).toBe(false); expect(d['alias']).toBe('cell-2');
  });

  test('move +0.25 ⇒ occ +1 cell AND the type-255 mirror follows in the doc', () => {
    const doc = bpOf(SRC);
    const ctx = makeCtx(doc, JSON.parse(emitDoc(doc)) as Blueprint);
    setPos(ctx, 0, 'y', 0.5);                             // +0.25 = exactly 1 cell
    const out = JSON.parse(serializeSave(ctx)) as { data: { blocks: { type: number; pos_y: number }[]; components: { occupancies: { pos_y: number }[] }[] } };
    expect(out.data.components[0]!.occupancies[0]!.pos_y).toBe(7);
    const mirror = out.data.blocks.find(b => b.type === 255)!;
    expect(mirror.pos_y).toBe(7);
    expect(out.data.blocks[0]!.pos_y).toBe(5);            // normal block untouched
  });

  test('sub-cell moves round to the NEAREST cell (round(0.11/0.25)=0)', () => {
    const doc = bpOf(SRC);
    const ctx = makeCtx(doc, JSON.parse(emitDoc(doc)) as Blueprint);
    setPos(ctx, 0, 'y', 0.36);
    const out = JSON.parse(serializeSave(ctx)) as { data: { components: { occupancies: { pos_y: number }[] }[] } };
    expect(out.data.components[0]!.occupancies[0]!.pos_y).toBe(6);   // stays
  });

  test('move then restore: occ AND mirror return; the re-emit is untouched-clean', () => {
    const doc = bpOf(SRC);
    const ctx = makeCtx(doc, JSON.parse(emitDoc(doc)) as Blueprint);
    setPos(ctx, 0, 'y', 1.0); serializeSave(ctx);        // save #1: +3 cells
    setPos(ctx, 0, 'y', 0.25); serializeSave(ctx);       // save #2: back, deltas ride
    expect(emitDoc(doc)).toBe(SRC);                      // byte-identical again
  });

  test('repeated saves accumulate EXACTLY (no double shift)', () => {
    const doc = bpOf(SRC);
    const ctx = makeCtx(doc, JSON.parse(emitDoc(doc)) as Blueprint);
    setPos(ctx, 0, 'y', 0.5); serializeSave(ctx);        // +1
    setPos(ctx, 0, 'y', 0.75); serializeSave(ctx);       // +1 more (total +2)
    const out = JSON.parse(emitDoc(doc)) as { data: { blocks: { type: number; pos_y: number }[] } };
    expect(out.data.blocks.find(b => b.type === 255)!.pos_y).toBe(8);
  });

  test('⟲ reset rides the cells back to zero', () => {
    const doc = bpOf(SRC);
    const ctx = makeCtx(doc, JSON.parse(emitDoc(doc)) as Blueprint);
    setPos(ctx, 0, 'y', 0.75); serializeSave(ctx);
    resetComponent(ctx, 0);
    serializeSave(ctx);
    expect(emitDoc(doc)).toBe(SRC);
  });
});

describe.skipIf(!haveCorpus)('corpus', () => {
  test('an untouched save re-emits EVERY corpus file byte-identically', () => {
    let n = 0;
    for (const id of readdirSync(CORPUS)) {
      const file = `${CORPUS}/${id}/blueprint.json`;
      if (!/^\d{6,}$/.test(id) || !existsSync(file)) continue;
      const text = readFileSync(file, 'utf8');
      const doc = parseDoc(text);
      const ctx = makeCtx(doc, JSON.parse(text) as Blueprint);
      expect(serializeSave(ctx), id).toBe(text);          // zero-move: occ re-written, raw kept
      n++;
    }
    expect(n).toBeGreaterThan(20);
  });

  test('ISW: moving a wheel 0.25 m in x shifts its occ + mirror together', () => {
    const text = readFileSync(`${CORPUS}/3812927875/blueprint.json`, 'utf8');
    const bp = JSON.parse(text) as Blueprint;
    const doc = parseDoc(text);
    const ctx = makeCtx(doc, bp);
    const ci = bp.data.components.findIndex(c => c.type === 'SmallWheel');
    const occ0x = bp.data.components[ci]!.occupancies![0]!.pos_x;      // capture BEFORE the save (live-synced)
    const occ0 = bp.data.components[ci]!.occupancies![0]!;
    setPos(ctx, ci, 'x', bp.data.components[ci]!.position.x + 0.25);
    serializeSave(ctx);
    const after = JSON.parse(emitDoc(doc)) as Blueprint;
    expect(after.data.components[ci]!.occupancies![0]!.pos_x).toBe(occ0x + 1);
    const key = (o: { pos_x: number; pos_y: number; pos_z: number; size_x?: number; size_y?: number; size_z?: number;
      frame_x?: number; frame_y?: number; frame_z?: number }) =>
      `${o.pos_x},${o.pos_y},${o.pos_z}|${o.size_x},${o.size_y},${o.size_z}|${o.frame_x},${o.frame_y},${o.frame_z}`;
    const mirror = (after.data.blocks as { type: number; pos_x: number }[])
      .find(b => b.type === 255 && key(b as never) === key({ ...occ0, pos_x: occ0x + 1 } as never));
    expect(mirror, 'a type-255 block now sits one cell +x of its twin occ').toBeTruthy();
  });
});
