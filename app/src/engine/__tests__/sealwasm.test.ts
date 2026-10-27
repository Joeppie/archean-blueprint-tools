// sealwasm.test.ts — the WASM sealed-envelope port (wasm/seal.ts) must
// answer EXACTLY like the pure-JS reference twin (atmo.ts sealedEnvelopeJS),
// on real corpus crafts, synthetic seals and skins. The JS twin also stays
// the fallback: every pin here runs the WRAPPER (wasm when loaded) and the
// twin side by side.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { sealedEnvelopeJS, sealedEnvelopeVolume } from '../atmo';
import { initSealWasmBytes, sealWasmReady } from '../sealwasm';
import { sphereSkinTris } from '../latsphere';
import { hullVertex } from '../hullfit';
import type { Block, Blueprint, Triangle } from '../format';

const REPO = new URL('../../../../', import.meta.url).pathname;   // committed corpus
const bp = (id: string): Blueprint =>
  JSON.parse(readFileSync(`${REPO}testdata/${id}/blueprint.json`, 'utf8')) as Blueprint;

beforeAll(() => {
  const ok = initSealWasmBytes(
    readFileSync(new URL('../../../wasm/seal.wasm', import.meta.url)));
  expect(ok, 'wasm/seal.wasm instantiates (npm run build:wasm)').toBe(true);
});

const cell = (x: number, y: number, z: number, s = 0): Block =>
  ({ pos_x: x, pos_y: y, pos_z: z, size_x: s, size_y: s, size_z: s,
    frame_x: 0, frame_y: 0, frame_z: 0, type: 0, colors: [0, 0, 0, 0, 0, 0, 0] });
// a lattice triangle from g-cell corners (world = (g−6)·0.25); g 4..14 sits
// inside one frame-0 record (v slots 0..31, hullVertex's law)
const tri = (a: [number, number, number], b: [number, number, number],
  c: [number, number, number]): Triangle => ({
  frame_x: 0, frame_y: 0, frame_z: 0,
  v0_x: a[0], v0_y: a[1], v0_z: a[2],
  v1_x: b[0], v1_y: b[1], v1_z: b[2],
  v2_x: c[0], v2_y: c[1], v2_z: c[2],
  colors: [0, 0, 0, 0, 0, 0], material: 0,
});
const expectLattice = (t: Triangle) => {
  for (const v of [0, 1, 2] as const) hullVertex(t, v);   // must decode
};

describe('WASM sealed envelope = JS twin', () => {
  it('module loaded synchronously', () => expect(sealWasmReady()).toBe(true));

  it('corpus crafts answer cell-exact', () => {
    for (const id of ['3509975859', '3481322297', '3309955432', '3732302108',
      '3803780241', '3812927875', '3417786605']) {
      const b = bp(id);
      const w = sealedEnvelopeVolume(b.data.triangles ?? [], b.data.blocks ?? []);
      const j = sealedEnvelopeJS(b.data.triangles ?? [], b.data.blocks ?? []);
      expect(w, id).toEqual(j);
    }
  });

  it('synthetic seals: closed shell, open box, triangle tetra', () => {
    const shell: Block[] = [];                       // 3×3×3 hollow cube walls
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++)
      if (x === 0 || x === 2 || y === 0 || y === 2 || z === 0 || z === 2)
        shell.push(cell(2 + x, 2 + y, 2 + z));
    const open: Block[] = shell.filter((_, i) => i !== 13);   // one wall cell out
    const tet = [
      tri([4, 4, 4], [14, 4, 4], [4, 14, 4]),
      tri([4, 4, 4], [14, 4, 4], [4, 4, 14]),
      tri([4, 4, 4], [4, 14, 4], [4, 4, 14]),
      tri([4, 14, 4], [14, 4, 4], [4, 4, 14]),
    ];
    tet.forEach(expectLattice);
    for (const [tris, blocks] of [[[], shell], [[], open], [tet, []], [tet, shell]] as [Triangle[], Block[]][]) {
      const w = sealedEnvelopeVolume(tris, blocks);
      expect(w, JSON.stringify([tris.length, blocks.length])).toEqual(sealedEnvelopeJS(tris, blocks));
    }
    expect(sealedEnvelopeVolume([], shell).cells).toBeGreaterThan(0);
  });

  it('balloon skins (ellipsoid + cylinder) answer cell-exact', () => {
    for (const spec of [
      { rx: 2, ry: 2, rz: 2, profile: 'ellipsoid' as const },
      { rx: 4, ry: 4, rz: 15, profile: 'cylinder' as const, shoulder: 0.55 },
      { rx: 1.5, ry: 3, rz: 8, profile: 'cylinder' as const, noseShoulder: 0.35, tailShoulder: 0.6 },
    ]) {
      const tris = sphereSkinTris(spec, { slot: 51 });
      const w = sealedEnvelopeVolume(tris, []);
      expect(w.cells, JSON.stringify(spec)).toBeGreaterThan(0);
      expect(w).toEqual(sealedEnvelopeJS(tris, []));
    }
  });

  it('empty input seals nothing on both paths', () => {
    expect(sealedEnvelopeVolume([], [])).toEqual({ m3: 0, cells: 0 });
  });

  // The wasm/JS SPEED ratio is NOT pinned anywhere (v1.12.8): it was the
  // v1.11.2 ADOPTION CRITERION for the module — the decision is made, and
  // a ratio between two engines measures the environment, not our code
  // (the v1.12.7 ladder: 1.49×/1.26× flake churn). What stays pinned: the
  // correctness parity above; the absolute speed tripwires and the printed
  // wasm/JS pair live in the quiescent load.perf harness.
});
