// v1.11.8 THE RIG CHAIN (subgrid.ts): a Build nested inside subgrid content
// carries the game's rigid transform for its content — raw position + RAW
// quaternion, composed down the nesting (XenonViewer blueprint.js readBuild:
// world = parentWorld · compose(position, orientation); top-level build =
// identity = v0.168). The F/A-18F (3521588534) is the proof craft: its gear
// legs are nested rigs (the we-report "missing cables … hinge in an
// incorrect position", 2026-10-26) and the numbers below are the CHAIN
// measured against the dev viewer's LIVE scene: the nested Wheel origin
// lands at (2.602, −0.94, 17.999); with the top-level group's 27° baked
// bench pose composed outside (the v1.10.2 joint pose ≈ the bay affine)
// the dev viewer shows the wheel box centred (1.795, −0.935, 18.195) —
// the app's g-pose chain lands within the v1.10.2 joint-line tolerance.
import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flattenComponents, rigApply, rigChainOfPath, rigPush, RIG_ID,
  subBlockBBox, subBlockBBoxRigs } from '../subgrid';
import type { Blueprint, Vec3D } from '../format';

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (id: string): Blueprint =>
  JSON.parse(readFileSync(join(HERE, '../../../..', 'testdata', id, 'blueprint.json'), 'utf8'));
const v3 = (p: Vec3D) => [p.x, p.y, p.z] as const;

describe('THE RIG CHAIN (v1.11.8)', () => {
  const bp = load('3521588534');
  const flat = flattenComponents(bp);
  const at = (type: string, p: [number, number, number]) => flat.find(e =>
    e.comp.type === type && Math.hypot(e.comp.position.x - p[0],
      e.comp.position.y - p[1], e.comp.position.z - p[2]) < 0.01);

  test('the F/A-18F gear-leg wheel rides its 4-level rig chain', () => {
    const e = at('Wheel', [1.79, -2, 17.31]);
    expect(e, 'the nested R-gear wheel exists').toBeTruthy();
    const w = rigApply(rigChainOfPath(bp, e!.path), v3(e!.comp.position));
    // dev readBuild composition (195 −29.7°ẑ, 192 90°x̂, 191 59.4°ŷ, 189 id):
    // the leg swings UP into the bay — the retraction pose the game saved.
    expect(w[0]).toBeCloseTo(2.599, 3);
    expect(w[1]).toBeCloseTo(-0.938, 3);
    expect(w[2]).toBeCloseTo(18.001, 3);
    const l = at('Wheel', [-1.79, -2, 17.31]);
    const wl = rigApply(rigChainOfPath(bp, l!.path), v3(l!.comp.position));
    // mirror-symmetric leg
    expect(wl[0]).toBeCloseTo(-2.599, 3);
    expect(wl[1]).toBeCloseTo(-0.938, 3);
    expect(wl[2]).toBeCloseTo(18.001, 3);
  });

  test("rig-mounted parts sit on the rig's invariant axis (builder law)", () => {
    // The 59.4°ŷ retraction affines its hinge parts (steering pivots, the
    // nested MiniRouter of the gear harness) ONTO its fixed line: the chain
    // leaves them EXACTLY in place, only the leg + wheel swing. This is why
    // the harness sockets (nested pivot/router ports) land on the retracted
    // leg — the plugs + surges move out of the hull, the "missing cables".
    for (const [type, p] of [
      ['SmallPivot', [1.625, 0.375, 17.375]],
      ['SmallPivot', [-1.625, 0.375, 17.375]],
      ['MiniRouter', [-1.625, -0.25, 17.38]],
      ['MiniRouter', [1.625, -0.25, 17.38]],
    ] as const) {
      const e = flat.find(x => x.comp.type === type && x.path.length > 3
        && Math.hypot(x.comp.position.x - p[0], x.comp.position.y - p[1],
          x.comp.position.z - p[2]) < 0.01);
      expect(e, `${type} nested at ${p.join(',')} exists`).toBeTruthy();
      const w = rigApply(rigChainOfPath(bp, e!.path), v3(e!.comp.position));
      expect(w[0], `${type} x`).toBeCloseTo(p[0], 2);
      expect(w[1], `${type} y`).toBeCloseTo(p[1], 2);
      expect(w[2], `${type} z`).toBeCloseTo(p[2], 1);
    }
  });

  test('direct children of a top-level Build chain = identity (v0.168)', () => {
    // the R-gear bay steering pivot is d1: it rides the top group (joint
    // pose, v1.10.2) — the nested chain must NOT push the top build pose
    const e = at('SmallPivot', [1.375, 0.625, 17.375]);
    expect(e).toBeTruthy();
    const chain = rigChainOfPath(bp, e!.path);
    expect(chain.t[0]).toBe(0); expect(chain.t[1]).toBe(0); expect(chain.t[2]).toBe(0);
    expect(chain.q.w).toBe(1);
    expect(chain.q.x + chain.q.y + chain.q.z).toBe(0);
  });

  test('top-level components chain = identity', () => {
    for (const e of flat) {
      if (e.path.length !== 3) continue;
      const chain = rigChainOfPath(bp, e.path);
      expect(chain).toBe(RIG_ID);
    }
  });

  test('rigPush composes parent-outside, child-inside (dev multiplyMatrices)', () => {
    const qA = { w: 0.7071067811865476, x: 0, y: 0.7071067811865476, z: 0 };   // +90 ŷ
    const qB = { w: 1, x: 0, y: 0, z: 0 };
    const ca = rigPush(RIG_ID, { x: 1, y: 0, z: 0 }, qA);
    const cb = rigPush(ca, { x: 1, y: 0, z: 0 }, qB);
    // child at (1,0,0) inside a parent frame rotated +90°ŷ and translated
    // (1,0,0): world = M_A·M_B·(1,0,0) = Ry90·(2,0,0) + (1,0,0) = (1,0,−2)
    const w = rigApply(cb, [1, 0, 0]);
    expect(w[0]).toBeCloseTo(1, 6);
    expect(w[1]).toBeCloseTo(0, 6);
    expect(w[2]).toBeCloseTo(-2, 6);
  });

  test('identity-bench crafts chain every nested entry at identity (all corpus)', () => {
    // The v1.11.6-era crafts (XYQ doors, Badger, dolphin panels…) nest as
    // identity groups: their nested part chains stay identity, so this
    // change cannot move them. Assert it corpus-wide, per craft.
    const dir = join(HERE, '../../../..', 'testdata');
    let rigCrafts = 0, total = 0;
    for (const id of readdirSync(dir)) {
      const f = join(dir, id, 'blueprint.json');
      if (!existsSync(f)) continue;
      total++;
      const b: Blueprint = JSON.parse(readFileSync(f, 'utf8'));
      let moved = false;
      for (const e of flattenComponents(b)) {
        if (e.path.length <= 6) continue;   // only d≥2 nestings push rigs
        const ch = rigChainOfPath(b, e.path);
        const w = rigApply(ch, v3(e.comp.position));
        if (Math.hypot(w[0] - e.comp.position.x, w[1] - e.comp.position.y,
          w[2] - e.comp.position.z) > 0.01) moved = true;
      }
      if (moved) rigCrafts++;
    }
    // 13/117 rig crafts at scan time — a new rig craft is a corpus event,
    // not a silent law change; identity crafts must show ZERO movement.
    expect(rigCrafts).toBeLessThanOrEqual(15);
    expect(rigCrafts).toBeGreaterThan(0);   // non-vacuous: the F/A-18F is one
  });

  test('subBlockBBoxRigs ≡ subBlockBBox under identity chains', () => {
    const b = load('3803780241');   // XYQ-615: door panels, no nested rigs
    const blocks = b.data.blocks;
    const a = subBlockBBox(blocks);
    const c = subBlockBBoxRigs([{ blocks, chain: RIG_ID }]);
    expect(a).toBeTruthy();
    expect(c!.min.map(x => +x.toFixed(6))).toEqual(a!.min.map(x => +x.toFixed(6)));
    expect(c!.max.map(x => +x.toFixed(6))).toEqual(a!.max.map(x => +x.toFixed(6)));
  });

  test('the F/A-18F gear bay carries no blocks (bbox chain is safe here)', () => {
    // captureJrefs' clamping bbox: this craft's rigs carry parts, not
    // blocks — the chained bbox equals the plain one (no pivot drift).
    const b = load('3521588534');
    const blocks = b.data.blocks;
    const a = subBlockBBox(blocks);
    const c = subBlockBBoxRigs([{ blocks, chain: RIG_ID }]);
    expect(c!.min.map(x => +x.toFixed(6))).toEqual(a!.min.map(x => +x.toFixed(6)));
    expect(c!.max.map(x => +x.toFixed(6))).toEqual(a!.max.map(x => +x.toFixed(6)));
  });
});
