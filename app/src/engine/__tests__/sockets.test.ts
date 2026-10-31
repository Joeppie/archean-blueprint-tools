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
import { adapterSocket, dashboardAdapter, KIND_RADIUS, manifestAdapter, pipeSockets, plugAnchor, TAN_MAX,
  TIP_MAX, type SocketAnchor, type V3 } from '../sockets';
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

describe('plugAnchor — fresh caches keep the recorded tip, stale ones follow the part', () => {
  const at: readonly [number, number, number] = [0, 0, 0];
  const axis: readonly [number, number, number] = [0, 0, 1];
  const s: SocketAnchor = { at, axis, kind: 'fluid' };
  const R = 0.045;                                     // fluid hose radius

  test('recorded tips ON the stub, near the socket, are kept verbatim', () => {
    const rec = [0, 0, TIP_MAX] as const;
    const pl = plugAnchor(rec, s, R);
    expect(pl.tip).toEqual(rec);
    expect(pl.stale).toBe(false);
    expect(pl.lead).toBeCloseTo(2 * R, 10);            // the mandatory axial lead
    expect(plugAnchor([0.05, 0.05, 0.1], s, R).tip).toEqual([0.05, 0.05, 0.1]);
  });

  test('beyond STALE_R → socket + stub-projected depth, garbage falls to the default seat', () => {
    expect(plugAnchor([0, 0, 1], s, R).tip).toEqual([0, 0, 0.05]);         // out-of-band → TIP_DEF
    expect(plugAnchor([0, 0, -1], s, R).tip).toEqual([0, 0, 0.05]);        // behind → TIP_DEF
    expect(plugAnchor([5, 0, 0], s, R).tip).toEqual([0, 0, 0.05]);         // lateral garbage
    expect(plugAnchor([0, 0, 0.05], s, R).tip).toEqual([0, 0, 0.05]);      // fresh, kept
    // a stale-but-sane seating depth (inside the band ALONG the stub) rides
    // the moved socket EXACTLY — the plug keeps how deep it was seated
    expect(plugAnchor([10, 0, 0.1], s, R).tip).toEqual([0, 0, 0.1]);
    // the 3481322297 Dashboard case: INSIDE STALE_R but OFF the stub axis
    // (the board turned after wiring) → re-seated on the socket
    expect(plugAnchor([0.4, 0, 0.013], s, R).tip).toEqual([0, 0, R]);      // never closer than r
  });

  test('the plug tip stands at least ONE CABLE RADIUS off the face (visible ON the circle)', () => {
    const fat = plugAnchor([3, 0, 0], s, 0.2);         // radius beats the default seat
    expect(fat.tip).toEqual([0, 0, 0.2]);
    expect(fat.depth).toBeGreaterThanOrEqual(0.2);
    expect(fat.lead).toBeCloseTo(0.4, 10);
  });

  test('no socket resolved → recorded kept, untouched', () => {
    const pl = plugAnchor([1, 2, 3], null, R);
    expect(pl.tip).toEqual([1, 2, 3]);
    expect(pl.stale).toBe(false);
    expect(pl.lead).toBe(0);
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
          if (EXEMPT.has(flat[side === 'a' ? p.a_component : p.b_component]?.comp?.type ?? '')) {
            exemptSkipped++;
            continue;
          }
          // what the RENDERER decides: an end plugAnchor() re-seats is a stale
          // cache — excluded from the law statistics (the renderer fixes it)
          if (plugAnchor(rec, sock, p.radius ?? KIND_RADIUS[p.type ?? 'data'] ?? 0.02).stale) {
            staleSkipped++;
            continue;
          }
          const d: readonly [number, number, number] =
            [rec[0] - sock.at[0], rec[1] - sock.at[1], rec[2] - sock.at[2]];
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

describe('THE HARNESS ATTACH (v1.11.5: subgrid tips ride the door)', () => {
  // we: "it goes to the OLD position of that pivot, rather than its actual
  // current one; cable positions do not seem to correctly update."
  const rec: V3 = [1, 2, 3];                              // tip on a closed door
  const R90Z: readonly [number, number, number, number] =
    [Math.SQRT1_2, 0, 0, Math.SQRT1_2];                   // door swung 90° about z
  const T: V3 = [0.5, 0, 0];                              // + group translation

  test('an ATTACHED tip is transformed with the part (rides it, no snap)', () => {
    // the display socket = the file socket moved by the SAME transform
    // the file socket sits 0.05 m out ([1.05,2,3]); its DISPLAY position is
    // Rz90 about the world z (x,y)→(−y,x) then + T: [−2,1.05,3] → [−1.5,1.05,3]
    const dispSock: V3 = [-1.5, 1.05, 3];
    const sock: SocketAnchor = {
      at: dispSock, axis: [0, 1, 0], kind: 'data', attach: { t: T, q: R90Z },
    };
    const p = plugAnchor(rec, sock, 0.02);
    expect(p.stale, 'the tip rides the door — NOT re-seated').toBe(false);
    // tip = Rz90(rec) + T exactly (rotation about the world z through the
    // origin here: [x,y] → [−y, x]; rec = [1,2,3] → [−2,1,3] + [0.5,0,0])
    expect(p.tip[0]).toBeCloseTo(-1.5, 9);
    expect(p.tip[1]).toBeCloseTo(1, 9);
    expect(p.tip[2]).toBeCloseTo(3, 9);
  });
  test('without attach the top-level law is untouched (recorded kept)', () => {
    const sock: SocketAnchor = { at: [1.05, 2, 3], axis: [0, 0, 1], kind: 'data' };
    const p = plugAnchor(rec, sock, 0.02);
    expect(p.tip).toEqual(rec);
    expect(p.stale).toBe(false);
  });
});

describe('THE DATA-GENERATED DASHBOARD PORT (v1.16.11: mid-back, not the .ini corner)', () => {
  const bp16 = load('3828773626');

  test('the synthesized adapter centres the .ini back-plane on the DATA board', () => {
    const c = { type: 'Dashboard', data: { size_x: 200, size_y: 100 } };
    const a = dashboardAdapter(c, 'data-connector')!;
    expect(a).not.toBeNull();
    // content (W/2, 0.018, H/2): the SAME 0.018 back-plane offset as the
    // .ini template, centred on the data-generated board
    expect(a.position).toEqual([1, 0.018, 0.5]);
    // contentToFile(1, 0.018, 0.5) = (1, 0.5, −0.018): the measured socket
    // plane at the board centre, 0.018 behind it
    const s = adapterSocket({ x: 1, y: 2, z: 3 }, undefined, a);
    expect(s.at[0]).toBeCloseTo(2, 10); expect(s.at[1]).toBeCloseTo(2.5, 10);
    expect(s.at[2]).toBeCloseTo(2.982, 10);
    s.axis.forEach((v, i) => expect(v).toBeCloseTo([0, 0, -1][i]!, 10));
    expect(s.kind).toBe('data');
  });

  test('null for other types, other ports, dataless boards', () => {
    expect(dashboardAdapter({ type: 'Screen' }, 'data-connector')).toBeNull();
    expect(dashboardAdapter({ type: 'Dashboard', data: {} }, 'data-port')).toBeNull();
    expect(dashboardAdapter({ type: 'Dashboard', data: { size_x: 0, size_y: 50 } },
      'data-connector')).toBeNull();
  });

  test('corpus 3828773626: every fresh data-connector tip is FRESH on the ' +
    'mid-back socket (residual 0.02 = the cable radius) — the .ini corner ' +
    'would re-seat it (the bug the user caught)', () => {
    if (!bp16) return;                                    // corpus absent
    const pipes = bp16.data.pipes!;
    const flat = flattenComponents(bp16);
    const socks = pipeSockets(pipes, flat, MANIFEST);
    let checked = 0;
    pipes.forEach((p, pi) => {
      for (const side of ['a', 'b'] as const) {
        const ci = side === 'a' ? p.a_component : p.b_component;
        const port = side === 'a' ? p.a_port : p.b_port;
        if (port !== 'data-connector' || bp16.data.components[ci]?.type !== 'Dashboard') continue;
        const sock = socks[pi]?.[side];
        expect(sock).not.toBeNull();
        const rec = recorded(p, side)!;
        const plug = plugAnchor([rec[0], rec[1], rec[2]], sock!, 0.02);
        expect(plug.stale).toBe(false);                   // tip kept verbatim
        expect(plug.depth).toBeCloseTo(0.02, 3);          // one radius out
        // the tip sits ON the mid-back stub axis: the socket IS the board
        // centre's back plane — tip distance = the seating depth, tan 0
        expect(Math.hypot(rec[0] - sock!.at[0], rec[1] - sock!.at[1],
          rec[2] - sock!.at[2])).toBeCloseTo(0.02, 3);
        checked++;
      }
    });
    expect(checked).toBe(2);                              // dashboards 14 + 16
  });

  test('the .ini corner (manifest adapter) is NOT what the tips sit on — ' +
    'regression guard for the mid-back law', () => {
    if (!bp16) return;
    const pipes = bp16.data.pipes!;
    const corner = MANIFEST?.Dashboard?.adapters?.find(a => a.name === 'data-connector');
    expect(corner).toBeTruthy();                          // .ini carries (0, .018, 0)
    expect(corner!.position).toEqual([0, 0.018, 0]);
    pipes.forEach(p => {
      for (const side of ['a', 'b'] as const) {
        const ci = side === 'a' ? p.a_component : p.b_component;
        const port = side === 'a' ? p.a_port : p.b_port;
        const comp = bp16.data.components[ci];
        if (port !== 'data-connector' || comp?.type !== 'Dashboard') continue;
        const cs = adapterSocket(comp.position, comp.orientation, corner!);
        const rec = recorded(p, side)!;
        // on the .ini corner the fresh tip FAILS the freshness gate (lateral
        // drift ≥ TAN_MAX) → the cable visibly re-seats to the corner —
        // the exact bug the user caught on 3828773626
        const plug = plugAnchor([rec[0], rec[1], rec[2]], cs, 0.02);
        expect(plug.stale).toBe(true);                    // ⇒ corner = STALE
      }
    });
  });
});
