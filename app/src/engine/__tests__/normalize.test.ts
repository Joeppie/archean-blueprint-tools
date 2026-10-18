// normalize.ts pins: the v1 → v2 open-time migration (embedded palette at
// the v2-base indices, slot remap, color-pair → entry dicts, raw quaternion
// → conjugate keeping the SAME displayed rotation, version bump, recursion
// into subgrids, idempotence).
import { describe, expect, test } from 'vitest';
import { emitDoc, parseDoc, docValue } from '../doc';
import { normalizeDoc } from '../normalize';
import { fileToViewQuat } from '../compparts';
import type { Blueprint, FileQuat } from '../format';

const V1 = '{"data":{"version":1,"blocks":[{"type":0,"pos_x":5,"pos_y":5,"pos_z":5,' +
  '"frame_x":0,"frame_y":0,"frame_z":0,"size_x":0,"size_y":0,"size_z":0,"colors":[48,48,48,48,48,48,48]}],' +
  '"triangles":[],"components":[{"type":"PilotSeat","position":{"x":0.0,"y":0.0,"z":0.0},' +
  '"orientation":{"w":0.7071,"x":0.0,"y":0.7071,"z":0.0},"colors":[48,172],' +
  '"data":{"components":[{"type":"Lamp","position":{"x":1.0,"y":0.0,"z":0.0},' +
  '"orientation":{"w":1.0,"x":0.0,"y":0.0,"z":0.5}}]}}]}}';

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

  test('the file now READS as modern: colors present → no LEGACY_Q path', () => {
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

  test('raw quaternion → conjugate keeps the EXACT displayed rotation', () => {
    const qvOld = fileToViewQuat(quat({ w: 0.7071, x: 0, y: 0.7071, z: 0 }), true);   // legacy chain
    const qvNew = fileToViewQuat(quat(bp.data.components[0]!.orientation), false);    // modern chain
    for (const k of ['w', 'x', 'y', 'z'] as const)
      expect(qvNew[k]).toBeCloseTo(qvOld[k], 12);
  });

  test('recursion: nested subgrid quaternions are conjugated too', () => {
    const nested = (bp.data.components[0]!.data!['components'] as { orientation: FileQuat }[])[0]!;
    expect(nested.orientation.z).toBe(-0.5);
  });

  test('the converted file still emits compact and re-parses', () => {
    const out = emitDoc(doc);
    expect(out).not.toContain(': ');
    expect(() => JSON.parse(out)).not.toThrow();
  });
});
