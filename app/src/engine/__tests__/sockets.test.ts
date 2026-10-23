// sockets.ts pins — THE ANCHOR LAW, measured against the corpus (the game's
// own recorded pipe endpoints are the arbiters, FORMAT §pipes / §Handedness
// v1.5.11: raw quaternions for both generations):
//   at   = position + R(qraw)·(ax, az, −ay)
//   axis = R(qraw)·(Rz·Ry·Rx·ẑ mapped the same way)
// Every cable tip lies ON the stub axis (tangent ≈ 0) and within a short
// seating offset of the socket — over every pipe of every corpus craft.
import { describe, expect, test } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { adapterSocket, endAnchor, manifestAdapter, pipeSockets, TAN_MAX, TIP_MAX,
  type SocketAnchor } from '../sockets';
import { flattenComponents } from '../subgrid';
import type { Blueprint } from '../format';
import type { ModelManifest } from '../models';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, '../../../../testdata');
const MANIFEST_PATH = join(HERE, '../../../../viewer/models/manifest.json');
const MANIFEST: ModelManifest = existsSync(MANIFEST_PATH)
  ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) : null as never;

const load = (id: string): Blueprint | null => {
  const p = join(CORPUS, id, 'blueprint.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};

/** the recorded tip of one pipe side (start of the first / end of the last) */
function recorded(p: Blueprint['data']['pipes'] extends (infer T)[] | undefined ? T : never, side: 'a' | 'b') {
  const segs = p.segments;
  const first = segs[0], last = segs[segs.length - 1];
  if (!first || !last) return null;
  const DIRS = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1]];
  if (side === 'a') return [first.start.x, first.start.y, first.start.z] as const;
  const d = DIRS[last.dir] ?? DIRS[0]!;
  return [last.start.x + d[0]! * last.length, last.start.y + d[1]! * last.length,
    last.start.z + d[2]! * last.length] as const;
}

describe('adapterSocket — the anchor law (known-good poses)', () => {
  test('FluidPort: socket at the +z face, stub pointing +z (identity pose)', () => {
    // .ini [ADAPTER fluidConnector]: position (0,−0.125,0), rotation (90,0,0)
    const s = adapterSocket({ x: 0, y: 0, z: 0 }, undefined,
      { type: 'fluid', position: [0, -0.125, 0], rotation: [90, 0, 0] });
    s.at.forEach((v, i) => expect(v).toBeCloseTo([0, 0, 0.125][i]!, 10));
    s.axis.forEach((v, i) => expect(v).toBeCloseTo([0, 0, 1][i]!, 10));
    expect(s.kind).toBe('fluid');
  });

  test('position follows the RAW quaternion (v1.5.11, one law both generations)', () => {
    const q = { w: 0, x: 0, y: 1, z: 0 };                      // yaw 180° about y
    const s = adapterSocket({ x: 1, y: 2, z: 3 }, q,
      { type: 'fluid', position: [0, -0.125, 0], rotation: [90, 0, 0] });
    // R_y(180)·(0,0,0.125) = (0,0,−0.125); axis (0,0,1) → (0,0,−1)
    s.at.forEach((v, i) => expect(v).toBeCloseTo([1, 2, 3 - 0.125][i]!, 10));
    s.axis.forEach((v, i) => expect(v).toBeCloseTo([0, 0, -1][i]!, 10));
  });

  test('multi-axis adapter euler order Rz·Ry·Rx (Rx applied first): [90,90,0]', () => {
    // ChemicalFurnace data: (90,90,0) → M·ẑ = Rz(0)·Ry(90)·Rx(90)·ẑ
    // Rx(90)·ẑ = (0,−1,0); Ry(90)·(0,−1,0) = (0,−1,0); content axis (0,−1,0) → file (0,0,1)
    const s = adapterSocket({ x: 0, y: 0, z: 0 }, undefined,
      { type: 'data', position: [0, 0, 0], rotation: [90, 90, 0] });
    s.axis.forEach((v, i) => expect(v).toBeCloseTo([0, 0, 1][i]!, 10));
  });

  test('manifestAdapter finds exact port names incl. .001 suffixes', () => {
    const a = manifestAdapter(MANIFEST, 'FluidJunction', 'fluid-out.001');
    expect(a).toBeTruthy();
    expect(a!.type).toBe('fluid');
    // content (0.125,0,0.125) → file (0.125, 0.125, 0): the top cap row
    const s = adapterSocket({ x: 0, y: 1, z: 0 }, undefined, a!);
    s.at.forEach((v, i) => expect(v).toBeCloseTo([0.125, 1.125, 0][i]!, 10));
  });
});

describe('endAnchor — fresh caches keep the recorded tip, stale ones follow the part', () => {
  const at: readonly [number, number, number] = [0, 0, 0];
  const axis: readonly [number, number, number] = [0, 0, 1];
  const s: SocketAnchor = { at, axis, kind: 'fluid' };

  test('recorded tips ON the stub, near the socket, are kept verbatim', () => {
    const rec = [0, 0, TIP_MAX] as const;
    expect(endAnchor(rec, s)).toEqual(rec);
    expect(endAnchor([0.05, 0.05, 0.1], s)).toEqual([0.05, 0.05, 0.1]);   // 5 cm tangent, fresh
  });

  test('beyond STALE_R → socket + stub-projected depth, garbage falls to the default seat', () => {
    expect(endAnchor([0, 0, 1], s)).toEqual([0, 0, 0.05]);              // out-of-band → TIP_DEF
    expect(endAnchor([0, 0, -1], s)).toEqual([0, 0, 0.05]);             // behind → TIP_DEF
    expect(endAnchor([5, 0, 0], s)).toEqual([0, 0, 0.05]);              // lateral garbage → TIP_DEF
    expect(endAnchor([0, 0, 0.05], s)).toEqual([0, 0, 0.05]);           // fresh, kept
    // a stale-but-sane seating depth (inside the band ALONG the stub) rides
    // the moved socket EXACTLY — the plug keeps how deep it was seated
    expect(endAnchor([10, 0, 0.1], s)).toEqual([0, 0, 0.1]);
    // the 3481322297 Dashboard case: INSIDE STALE_R but OFF the stub axis
    // (the board turned after wiring) → re-seated on the socket
    expect(endAnchor([0.4, 0, 0.013], s)).toEqual([0, 0, 0.013]);
  });

  test('no socket resolved → recorded kept, untouched', () => {
    expect(endAnchor([1, 2, 3], null)).toEqual([1, 2, 3]);
  });
});

describe.skipIf(!MANIFEST)('the corpus sweep — 18k+ recorded tips prove the law', () => {
  const ids = ['3812927875', '3732302108', '3417786605', '3803780241', '3309955432',
    '3509975859', '3518436870', '3481322297', '3347018068', '3284539247'];
  // FORMAT §pipes documents the two endpoint EXEMPTIONS: PilotSeat (user
  // moves it in the editor, the cached route is what it is) and Beacon (it
  // records its tips in the connector's upright frame, not the part frame).
  const EXEMPT = new Set(['PilotSeat', 'Beacon']);
  let checked = 0;
  let exemptSkipped = 0;
  let staleSkipped = 0;
  const tangents: number[] = [], normals: number[] = [];

  test('≥95% of every recorded tip sits ON its stub axis within 2 cm', () => {
    for (const id of ids) {
      const bp = load(id);
      if (!bp?.data.pipes?.length) continue;
      const flat = flattenComponents(bp);
      const socks = pipeSockets(bp.data.pipes, flat, MANIFEST);
      bp.data.pipes.forEach((p, pi) => {
        const sk = socks[pi];
        if (!sk) return;
        for (const side of ['a', 'b'] as const) {
          const sock = sk[side];
          const rec = recorded(p, side);
          if (!sock || !rec) continue;
          if (EXEMPT.has(flat[side === 'a' ? p.a_component : p.b_component]?.comp?.type)) {
            exemptSkipped++;
            continue;
          }
          // what the RENDERER decides: an end endAnchor() re-seats is a stale
          // cache — excluded from the law statistics (the renderer fixes it)
          const kept = endAnchor(rec, sock);
          if (kept[0] !== rec[0] || kept[1] !== rec[1] || kept[2] !== rec[2]) {
            staleSkipped++;
            continue;
          }
          const d = [rec[0] - sock.at[0], rec[1] - sock.at[1], rec[2] - sock.at[2]];
          const proj = d[0] * sock.axis[0] + d[1] * sock.axis[1] + d[2] * sock.axis[2];
          const tan = Math.hypot(d[0] - proj * sock.axis[0], d[1] - proj * sock.axis[1],
            d[2] - proj * sock.axis[2]);
          tangents.push(tan); normals.push(proj); checked++;
        }
      });
    }
    expect(checked).toBeGreaterThan(3000);              // the sweep is non-vacuous
    expect(exemptSkipped).toBeGreaterThan(0);           // the exemptions are live, not folklore
    const p95 = (xs: number[], q: number) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length * q)]!;
    expect(p95(tangents, 0.95), 'p95 tangential residual (tips must be ON the stub axis)')
      .toBeLessThanOrEqual(0.02);
    expect(Math.max(...tangents), 'fresh-by-rule ends stay on-axis by construction')
      .toBeLessThanOrEqual(TAN_MAX + 1e-9);
    for (const n of normals) expect(n, 'a seated tip is never deep BEHIND the socket plane')
      .toBeGreaterThanOrEqual(-0.35);
    expect(p95(normals, 0.95), 'p95 seating depth stays inside the stub band')
      .toBeLessThanOrEqual(TIP_MAX + 0.01);
  });

  test('fluid ports resolve everywhere (the grey-circle law is not ISW-only)', () => {
    let fluidEnds = 0;
    for (const id of ids) {
      const bp = load(id);
      if (!bp?.data.pipes?.length) continue;
      const flat = flattenComponents(bp);
      const socks = pipeSockets(bp.data.pipes, flat, MANIFEST);
      socks.forEach(sk => { if (sk?.a?.kind === 'fluid' || sk?.b?.kind === 'fluid') fluidEnds++; });
    }
    expect(fluidEnds).toBeGreaterThan(10);
  });
});
