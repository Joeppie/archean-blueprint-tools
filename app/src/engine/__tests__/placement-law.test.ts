// placement-law.test.ts — the v1.5.11 ONE RAW quaternion law, pinned on the
// game-built pyramid craft IAS-418 (testdata/9000005001, the user's
// testframe.json: palette-bearing 2026 file).
//
// The craft is a law probe: the game writes 8 Dashboard components onto the
// deck and onto the slant faces of a corner block, and loads PERFECT in game.
// Each board's plane normal is its local +z (FORMAT §Dashboard: board = box
// origin→(size_x/100,size_y/100,0.01), plane X·Y, normal +z). Under the RAW
// law (the file quaternion as-is) every board lands FLUSH on a block face
// (|dot| = 1.000, ≤ 0.13 m to the plane). Under the retired CONJUGATE law
// (w,−x,−y,−z) the same boards skew off every face (dot ≤ 0.94, planes
// crossed) — the exact "dashboards floating askew" the user screenshotted
// 2026-10-21. Corroborating corpus proof (see FORMAT §Handedness):
//  • 9000004001 (game-written L/R dashboards): raw meets corner-to-corner.
//  • ISW-241's two saves (2025 no-palette + 2026 re-save) carry BYTE-IDENTICAL
//    orientations — the game converts nothing across generations.
import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { emitDoc, parseDoc } from '../doc';
import { openFunnel, serializeSave } from '../edit';
import type { Blueprint, BlueprintComponent, FileQuat } from '../format';
import { toViewQuatLegacy, toViewQuatModern } from '../format';
import { getBlockFaces, getBlockPoints } from '../blockshapes';

const FIXTURE = new URL('../../../../testdata/9000005001/blueprint.json', import.meta.url).pathname;
const have = existsSync(FIXTURE);

const CELL = 0.25;
type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const qRotV = (q: FileQuat, v: V3): V3 => {
  const { w, x, y, z } = q;
  return [
    (1 - 2 * (y * y + z * z)) * v[0] + 2 * (x * y - w * z) * v[1] + 2 * (x * z + w * y) * v[2],
    2 * (x * y + w * z) * v[0] + (1 - 2 * (x * x + z * z)) * v[1] + 2 * (y * z - w * x) * v[2],
    2 * (x * z - w * y) * v[0] + 2 * (y * z + w * x) * v[1] + (1 - 2 * (x * x + y * y)) * v[2],
  ];
};

// Every block's face PLANES (world n·p = c) straight from the SHIPPED shape
// table — the same geometry the scene renders.
function fixtureFaces(bp: Blueprint): { n: V3; c: number }[] {
  const out: { n: V3; c: number }[] = [];
  for (const b of bp.data.blocks) {
    if (b.type === 255) continue;
    const lo: V3 = ['x', 'y', 'z'].map(a => (b[`pos_${a}`] - 5.5) * CELL + (b[`frame_${a}`] ?? 0) * 3) as V3;
    const sz: V3 = ['x', 'y', 'z'].map(a => (b[`size_${a}`] + 1) * CELL) as V3;
    const pts = getBlockPoints(b.type, lo, sz);
    for (const idx of getBlockFaces(b.type)) {
      const uniq = [...new Set(idx)];
      if (uniq.length < 3) continue;
      const [a, q, r] = uniq.map(k => pts[k] as V3);
      const u: V3 = [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
      const v: V3 = [r[0] - a[0], r[1] - a[1], r[2] - a[2]];
      const n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const L = Math.hypot(n[0], n[1], n[2]);
      if (L < 1e-9) continue;
      const nn: V3 = [n[0] / L, n[1] / L, n[2] / L];
      out.push({ n: nn, c: dot(nn, a) });
    }
  }
  return out;
}

describe.skipIf(!have)('IAS-418 pyramid probe (testdata/9000005001): ONE RAW law', () => {
  const bp = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Blueprint;
  const faces = fixtureFaces(bp);
  const dashboards = bp.data.components.filter(c => c.type === 'Dashboard');

  test('the fixture is the game-built palette craft (8 dashboards)', () => {
    expect(bp.data.colors?.length).toBe(256);
    expect(dashboards.length).toBe(8);
  });

  test('every dashboard board normal lands EXACTLY on a block face under R(q raw)', () => {
    for (const c of dashboards) {
      const qv = toViewQuatModern(c.orientation);          // raw AS-IS since v1.5.11
      expect(qv).toEqual(c.orientation);                    // the law IS the identity
      const n = qRotV(qv, [0, 0, 1]);
      const p: V3 = [c.position.x, c.position.y, c.position.z];
      // best = max |dot|, ties broken by NEAREST plane (many faces share a normal)
      let best = { align: -1, dist: 1e9 };
      for (const f of faces) {
        const align = Math.abs(dot(n, f.n));
        const dist = Math.abs(dot(n, p) - f.c);
        if (align > best.align + 1e-9 || (Math.abs(align - best.align) <= 1e-9 && dist < best.dist))
          best = { align, dist };
      }
      expect(best.align, `align ${best.align}`).toBeGreaterThan(0.999);
      expect(best.dist, `plane dist ${best.dist}`).toBeLessThan(0.14);
    }
  });

  test('the RETIRED conjugate law skews the same boards (law is discriminated)', () => {
    const skew = dashboards.map(c => {
      const qc: FileQuat = { w: c.orientation.w, x: -c.orientation.x, y: -c.orientation.y, z: -c.orientation.z };
      const n = qRotV(qc, [0, 0, 1]);
      return faces.reduce((m, f) => Math.max(m, Math.abs(dot(n, f.n))), 0);
    });
    // the five tilted boards (non-axis quats) must MISfit under conjugation
    expect(skew.filter(a => a < 0.99).length).toBeGreaterThanOrEqual(5);
  });

  test('open→save keeps every orientation byte-verbatim (never re-encodes)', () => {
    const { ctx } = openFunnel(readFileSync(FIXTURE, 'utf8'));
    const out = JSON.parse(serializeSave(ctx)) as Blueprint;
    out.data.components.forEach((c: BlueprintComponent, i: number) => {
      expect(c.orientation).toEqual(bp.data.components[i]!.orientation);
    });
    expect(emitDoc(parseDoc(serializeSave(ctx))) !== '').toBe(true);
  });

  test('the law is generation-blind: legacy mapper is the same identity', () => {
    const q: FileQuat = { w: 0.6246950143, x: -0.2676769936, y: -0.2567870021, z: -0.1108429972 };
    expect(toViewQuatLegacy(q)).toEqual(q);
    expect(toViewQuatModern(q)).toEqual(q);
  });
});
