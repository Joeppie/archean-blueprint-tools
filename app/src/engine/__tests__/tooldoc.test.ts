// v1.7 doc-mirror pins: the three NEW write paths must keep bp + doc in
// lockstep and never disturb the byte-identity contract — the block
// `material` key (appended for files that predate it), the custom-RGB
// palette slot (int-styled, array created when absent) and the hullify batch
// (geometry blocks spliced out of BOTH lists, triangles inserted in order).
import { describe, expect, test } from 'vitest';
import { docArrayInsert, docArrayRemoveAt, docEnsureArray, docFromValue, emitDoc, parseDoc, docValue } from '../doc';
import { makeCtx, serializeSave, setPaletteSlot, writeBlockDoc, writeBlockMaterial } from '../edit';
import { hullifyApply } from '../tools';
import type { Blueprint } from '../format';

const SRC = '{"author":"jo","data":{"blocks":['
  + '{"colors":[51,51,51,51,51,51,51],"frame_x":0,"frame_y":0,"frame_z":0,"pos_x":5,"pos_y":5,"pos_z":5,"size_x":0,"size_y":0,"size_z":0,"type":0},'
  + '{"colors":[51,51,51,51,51,51,51],"frame_x":0,"frame_y":0,"frame_z":0,"pos_x":6,"pos_y":5,"pos_z":5,"size_x":0,"size_y":0,"size_z":0,"type":0},'
  + '{"colors":[0,0,0,0,0,0,0],"frame_x":0,"frame_y":0,"frame_z":0,"pos_x":7,"pos_y":5,"pos_z":5,"size_x":0,"size_y":0,"size_z":0,"type":255}'
  + '],"components":[],"version":2}}';

describe('v1.7 write paths keep bp + doc', () => {
  test('an UNTOUCHED file still re-emits byte-identically', () => {
    const doc = parseDoc(SRC);
    expect(emitDoc(doc)).toBe(SRC);
  });

  test('writeBlockMaterial appends the missing `material` key and saves it', () => {
    const ctx = makeCtx(parseDoc(SRC), docValue(parseDoc(SRC)) as Blueprint);
    // (makeCtx needs one parse shared between doc and bp)
    const doc = parseDoc(SRC);
    const c = makeCtx(doc, docValue(doc) as Blueprint);
    expect(writeBlockMaterial(c, 0, 4)).toBe(true);
    expect(c.bp.data.blocks[0]!.material).toBe(4);
    const out = JSON.parse(serializeSave(c)) as { data: { blocks: { material?: number }[] } };
    expect(out.data.blocks[0]!.material).toBe(4);
    expect(out.data.blocks[1]!.material).toBeUndefined();   // only the touched block
    void ctx;
  });

  test('writeBlockDoc keeps an EXISTING material literal stable (no drift)', () => {
    const src = '{"data":{"blocks":[{"colors":[1,1,1,1,1,1,1],"frame_x":0,"frame_y":0,"frame_z":0,'
      + '"material":2,"pos_x":5,"pos_y":5,"pos_z":5,"size_x":0,"size_y":0,"size_z":0,"type":0}],'
      + '"components":[],"version":2}}';
    const doc = parseDoc(src);
    const ctx = makeCtx(doc, docValue(doc) as Blueprint);
    ctx.bp.data.blocks[0]!.pos_x = 6;
    writeBlockDoc(ctx, 0);
    const out = serializeSave(ctx);
    expect(out).toContain('"material":2');
    expect((JSON.parse(out) as { data: { blocks: { pos_x: number }[] } }).data.blocks[0]!.pos_x).toBe(6);
  });

  test('setPaletteSlot writes an INT-styled entry and creates the array', () => {
    const doc = parseDoc(SRC);
    const ctx = makeCtx(doc, docValue(doc) as Blueprint);
    expect(setPaletteSlot(ctx, 200, { r: 12, g: 34, b: 56, opacity: 15, roughness: 4, metallic: 0 })).toBe(true);
    expect(setPaletteSlot(ctx, 5, { r: 1, g: 1, b: 1, opacity: 15, roughness: 0, metallic: 0 })).toBe(false);
    const out = serializeSave(ctx);
    // the entry is INT-styled (no ".0" — the game's palette scale is int) and
    // lands AT ITS INDEX in the (sparse, null-padded) palette array
    expect(out).toContain('{"r":12,"g":34,"b":56,"opacity":15,"roughness":4,"metallic":0}]');
    const back = JSON.parse(out) as { data: { colors: (Record<string, number> | null)[] } };
    expect(back.data.colors[200]!.r).toBe(12);
    expect(back.data.colors[199]).toBeNull();
    expect(back.data.colors.length).toBe(201);
  });

  test('hullify: doc loses exactly the geometry blocks, gains the triangles in order', () => {
    const doc = parseDoc(SRC);
    const ctx = makeCtx(doc, docValue(doc) as Blueprint);
    const trisBefore = ctx.bp.data.triangles?.length ?? 0;
    const geo = ctx.bp.data.blocks
      .map((b, i) => (b.type === 255 ? -1 : i)).filter(i => i >= 0).sort((a, b) => b - a);
    const res = hullifyApply(ctx.bp);
    expect(res.ok).toBe(true);
    for (const i of geo) docArrayRemoveAt(ctx.doc, ['data', 'blocks'], i);
    docEnsureArray(ctx.doc, ['data', 'triangles']);
    (ctx.bp.data.triangles ?? []).forEach((t, k) => {
      if (k < trisBefore) return;
      docArrayInsert(ctx.doc, ['data', 'triangles'], k, docFromValue(t, true));
    });
    const out = JSON.parse(serializeSave(ctx)) as {
      data: { blocks: { type: number }[]; triangles: Record<string, number>[] };
    };
    // the occupancy mirror survived; every geometry block became a triangle
    expect(out.data.blocks.map(b => b.type)).toEqual([255]);
    expect(out.data.triangles.length).toBe(res.trisAdded);
    expect(out.data.triangles[0]).toHaveProperty('v0_x');
    expect(out.data.triangles[0]).toHaveProperty('frame_y');
    expect(emitDoc(doc)).toContain('"triangles"');
  });
});
