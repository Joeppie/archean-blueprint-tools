// normalize.ts pins: the v1 → v2 open-time migration (embedded palette at
// the v2-base indices, slot remap, color-pair → entry dicts, orientations
// VERBATIM [v1.5.11 — the conjugate rewrite broke the game round-trip],
// version bump, recursion into subgrids, idempotence).
import { describe, expect, test } from 'vitest';
import { emitDoc, parseDoc, docValue } from '../doc';
import { normalizeDoc } from '../normalize';
import { displayQuat, fileToViewQuat } from '../compparts';
import { isLegacyFile } from '../format';
import type { Blueprint, FileQuat } from '../format';

const V1 = '{"data":{"version":1,"blocks":[{"type":0,"pos_x":5,"pos_y":5,"pos_z":5,' +
  '"frame_x":0,"frame_y":0,"frame_z":0,"size_x":0,"size_y":0,"size_z":0,"colors":[48,48,48,48,48,48,48]}],' +
  '"triangles":[],"components":[{"type":"PilotSeat","position":{"x":0.0,"y":0.0,"z":0.0},' +
  '"orientation":{"w":0.7071,"x":0.0,"y":0.7071,"z":0.0},"colors":[48,172],' +
  '"data":{"components":[{"type":"Lamp","position":{"x":1.0,"y":0.0,"z":0.0},' +
  '"orientation":{"w":1.0,"x":0.0,"y":0.0,"z":0.5}}]}},' +
  '{"type":"FluidJunction","position":{"x":0.0,"y":0.9,"z":1.0},' +
  '"orientation":{"w":0.0,"x":0.7071,"y":0.0,"z":0.7071},"colors":[48,48]}]}}';

const quat = (o: { w: number; x: number; y: number; z: number }): FileQuat =>
  ({ w: o.w, x: o.x, y: o.y, z: o.z });

describe('v1 → v2 open-time normalize', () => {
  const doc = parseDoc(V1);
  const res = normalizeDoc(doc);
  const bp = docValue(doc) as Blueprint;

  test('converts, and a second pass is a no-op (idempotent)', () => {
    expect(res.converted).toBe(true);
    expect(normalizeDoc(doc).converted).toBe(false);
  });

  test('the file reads as v2 after the migration (palette embedded, version 2)', () => {
    expect(Array.isArray(bp.data.colors)).toBe(true);
    expect(bp.data.colors!.length).toBeGreaterThan(52);
    expect(bp.data.version).toBe(2);
  });

  test('matte slots ride their shared base; glass remaps +12; entries embedded', () => {
    expect(bp.data.blocks[0]!.colors![0]).toBe(48);              // matte family: same base v1/v2
    const embedded = bp.data.colors![48]!;
    expect([embedded.r, embedded.g, embedded.b]).toEqual([1, 8, 1]);     // matte dark green
    expect(bp.data.colors![184]).toBeTruthy();                   // v1 glass 172 → v2 base 184
  });

  test('comp color PAIRS become v2 entry dicts (matte green + glass)', () => {
    const cols = bp.data.components[0]!.colors as Record<string, { r: number; g: number; b: number; opacity: number }>;
    expect(typeof cols).toBe('object');
    expect(cols.color1!.r).toBe(1);                   // matte dark green
    expect(cols.color2!.opacity).toBeLessThan(15);                // glass stays translucent
  });

  test('orientations stay VERBATIM; the display rides the raw law (R(q) as stored)', () => {
    // v1.5.11: the rule-4 conjugate rewrite was killed (the game round-trips
    // quaternion bytes, so a rewritten quat = a rotated-different craft in
    // game — user's wheel-on-top / torn-murals exports).
    const q = quat(bp.data.components[0]!.orientation);
    expect(q).toEqual({ w: 0.7071, x: 0, y: 0.7071, z: 0 });
    // the raw law is generation-blind: display = R(STORED quat), unmoved
    const qv = fileToViewQuat(q);
    expect(qv.y).toBeCloseTo(0.7071, 12);
    expect(isLegacyFile(docValue(parseDoc(V1)) as Blueprint)).toBe(true);   // generation, as on disk
  });

  test('recursion: nested subgrid quaternions are VERBATIM too', () => {
    const nested = (bp.data.components[0]!.data!['components'] as { orientation: FileQuat }[])[0]!;
    expect(nested.orientation.z).toBe(0.5);
  });

  test('FluidJunction orientation is trivially untouched (flat comb survives)', () => {
    const fj = bp.data.components[1]!;
    expect(fj.type).toBe('FluidJunction');
    // stored quaternion keeps its v1 raw form (x̂ 90°: (0,.7071,0,.7071))
    expect(quat(fj.orientation)).toEqual({ w: 0, x: 0.7071, y: 0, z: 0.7071 });
    // the builder-FLAT display pose = R(raw file quat) — unchanged
    expect(displayQuat('FluidJunction', fileToViewQuat(quat(fj.orientation)), quat(fj.orientation)))
      .toEqual({ w: 0, x: 0.7071, y: 0, z: 0.7071 });
  });

  test('the converted file still emits compact and re-parses', () => {
    const out = emitDoc(doc);
    expect(out).not.toContain(': ');
    expect(() => JSON.parse(out)).not.toThrow();
  });
});
