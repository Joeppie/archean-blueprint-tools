// subgrid.ts pins: the FLATTENED composite_builds join decode (AGENTS
// §Subgrids, v0.171), the build-captured joint line (bbox clamp + the
// edge/face-mounted hinge triad rule), and the pure joint-pose composition
// (spin about the captured line, slide, rigid master riding — identity at
// the built pose). Dolphin + XYQ corpus fixtures mirror the legacy
// postest pins (dooraxis / subjoint-angle / xyq-dooraxis).
import { readFileSync } from 'node:fs';
import { existsSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  captureJrefs, eulerZYX, jointChain, jointNodeAxis, jointNodeSlide,
  flattenComponents, masterJointState, subBlockBBox,
  subJointPose, subMasterEntries,
} from '../subgrid';
import type { Blueprint, BlueprintComponent, Block, FileQuat } from '../format';
import { qRot } from '../compparts';
import type { ModelManifest } from '../models';
import { corpusDir, craftFile } from '../../../tools/vite-corpus.ts';

const CORPUS = corpusDir();
const haveCorpus = existsSync(CORPUS);
const load = (id: string): Blueprint =>
  JSON.parse(readFileSync(craftFile(id), 'utf8')) as Blueprint;

const comp = (o: Partial<BlueprintComponent> & { type: string }): BlueprintComponent => ({
  position: { x: 0, y: 0, z: 0 }, orientation: { w: 1, x: 0, y: 0, z: 0 }, ...o,
});

describe('flatten + join decode', () => {
  test('nested content numbers BEFORE its Build (readBuild order)', () => {
    const nested = [comp({ type: 'SmallHinge' }), comp({ type: 'Dashboard' })];
    const bp = {
      box_min: { x: 0, y: 0, z: 0 }, box_max: { x: 1, y: 1, z: 1 },
      data: {
        version: 2, blocks: [],
        components: [
          comp({ type: 'PilotSeat' }),
          comp({ type: 'Build', data: { components: nested, blocks: [] } }),
        ],
      },
    } as unknown as Blueprint;
    const flat = flattenComponents(bp);
    expect(flat.map(f => f.comp.type)).toEqual(['PilotSeat', 'SmallHinge', 'Dashboard', 'Build']);
    expect(flat[1]!.path).toEqual(['data', 'components', 1, 'data', 'components', 0]);
    expect(flat[1]!.top).toBe(-1);
    expect(flat[3]!.top).toBe(1);
  });

  test('BOTH composite_builds indices are FLATTENED (nested-master decode)', () => {
    const hinge = comp({ type: 'SmallHinge', data: { angle: 10 } });
    const bp = {
      box_min: { x: 0, y: 0, z: 0 }, box_max: { x: 1, y: 1, z: 1 },
      data: {
        version: 2, blocks: [],
        components: [
          comp({ type: 'SpotLight' }),
          comp({ type: 'Build', data: { components: [hinge], blocks: [] } }),  // flat 2, top 1
        ],
        composite_builds: [{ component: 1, slaveBuildId: 2 }],                 // flattened master 1 = the NESTED hinge
      },
    } as unknown as Blueprint;
    const byB = subMasterEntries(bp);
    const ents = byB.get(1);                       // Build top-level index
    expect(ents).toHaveLength(1);
    expect(ents![0]!.mc?.type).toBe('SmallHinge');
    expect(ents![0]!.top).toBe(-1);                // nested master
    expect(ents![0]!.mcPath).toEqual(['data', 'components', 1, 'data', 'components', 0]);
  });

  test.skipIf(!haveCorpus)('dolphin 3417786605: 5 subgrids ⇔ 3 pivots + 2 hinges (v0.171 pin)', () => {
    const bp = load('3417786605');
    const byB = subMasterEntries(bp);
    const types: string[] = [];
    for (const [, es] of byB) for (const e of es) {
      expect(e.mc, 'every master decodes to a live part').not.toBeNull();
      types.push(e.mc!.type);
    }
    expect(byB.size).toBe(5);
    expect(types.filter(t => t === 'SmallPivot').length).toBe(3);
    expect(types.filter(t => t === 'SmallHinge').length).toBe(2);
  });

  test.skipIf(!haveCorpus)('XYQ 3803780241: Build[5]/Build[41] decode to SmallHinge @24.3°', () => {
    const bp = load('3803780241');
    const byB = subMasterEntries(bp);
    for (const bi of [5, 41]) {
      const e = byB.get(bi)?.[0];
      expect(e?.mc?.type).toBe('SmallHinge');
      expect(e?.top).toBeGreaterThanOrEqual(0);
      expect((e?.mc?.data?.['angle'] as number)).toBeCloseTo(24.3, 1);
    }
  });

  test.skipIf(!haveCorpus)('every corpus craft: masters never decode onto a Build ghost', () => {
    for (const id of readdirSync(CORPUS)) {
      if (!/^\d{6,}$/.test(id) || !existsSync(`${CORPUS}/${id}/blueprint.json`)) continue;
      const bp = load(id);
      if (!bp.data.composite_builds?.length) continue;
      for (const [, es] of subMasterEntries(bp)) for (const e of es)
        if (e.mc) expect(e.mc.type, `${id} master ${e.component}`).not.toBe('Build');
    }
  });
});

describe('joint line capture + pose', () => {
  const manifest: ModelManifest = {
    SmallHinge: { joints: [{ name: 'axle', position: [0, 0.15, 0], rotation: [0, 0, 0], axis: 'y' }] },
    SmallPivot: { joints: [{ name: 'axle', position: [0, 0.152, 0], rotation: [0, 0, 0], axis: 'y' }] },
    LinearTrack: { joints: [{ name: 'carriage', position: [0, 0, 0], rotation: [0, 0, 0], axis: 'x', slide: 'x' }] },
  } as unknown as ModelManifest;
  const bbx = { min: [-1, 0, -0.125] as [number, number, number], max: [1, 0.25, 0.125] as [number, number, number] };

  test('bbox of nested blocks excludes the 255 mirrors; inclusive size rule', () => {
    const blocks = [
      { pos_x: 6, pos_y: 5, pos_z: 6, frame_x: 0, frame_y: 0, frame_z: 0, type: 0, size_x: 1, size_y: 0, size_z: 0 },
      { pos_x: 6, pos_y: 5, pos_z: 6, frame_x: 0, frame_y: 0, frame_z: 0, type: 255, size_x: 3, size_y: 3, size_z: 3 },
    ] as Block[];
    const b = subBlockBBox(blocks)!;
    expect(b.min[0]).toBeCloseTo(0.125, 6);               // x: pos 6 → (6−5.5)·0.25
    expect(b.max[0]).toBeCloseTo(0.625, 6);               // +size 1 = one extra cell (inclusive)
    expect(b.min[1]).toBeCloseTo(-0.125, 6);              // y: pos 5 size 0 → one cell
    expect(b.max[1]).toBeCloseTo(0.125, 6);
    expect(b.min[2]).toBeCloseTo(0.125, 6);               // z RAW == view (v0.180): (6−5.5)·0.25
    expect(b.max[2]).toBeCloseTo(0.375, 6);              // +size 0 = one extra cell (inclusive)
    // The FRAME is the point: this box CLAMPS the joint line in captureJrefs,
    // so a mirrored z clamps onto the panel's MIRROR IMAGE (Jimmy's Adventure:
    // a 30 m phantom lever, panel swept 11 m by a 35° part spin). A master
    // mounted ON this panel (world z 0.25, .ini pivot at its origin) must have
    // its jointChain pivot INSIDE the box — the clamp is then a no-op. Under
    // the old mirror the box sat at z ∈ [−0.375,−0.125] and the pivot was
    // dragged 0.375 m to the wrong side of the panel.
    const mcOn = comp({ type: 'SmallPivot', position: { x: 0.375, y: 0, z: 0.25 } });
    const jc = jointChain(mcOn, {
      SmallPivot: { joints: [{ name: 'axle', position: [0, 0, 0], rotation: [0, 0, 0], axis: 'y' }] },
    } as unknown as ModelManifest)!;
    expect(Math.abs(jc.pivot[2] - 0.25)).toBeLessThan(1e-9);
    expect(jc.pivot[2]).toBeGreaterThanOrEqual(b.min[2]);
    expect(jc.pivot[2]).toBeLessThanOrEqual(b.max[2]);
  });

  test('pivot-only subgrid (no blocks): axis stays the .ini key chain', () => {
    const mc = comp({ type: 'SmallPivot', position: { x: 2, y: 1, z: -3 }, data: { angle: 126 } });
    const jref = captureJrefs([{ component: 0, mc, top: 0, mcPath: [] }], null, manifest);
    expect(jref).toHaveLength(1);
    expect(jref[0]!.axis0).toEqual(jointChain(mc, manifest)!.axis);
    expect(jref[0]!.pivot0).toEqual(jointChain(mc, manifest)!.pivot);
  });

  test('static hosts get NO joint term (Lamp angle = light aim, not a hinge)', () => {
    const lamp = comp({ type: 'Lamp', data: { angle: 45 } });
    expect(captureJrefs([{ component: 0, mc: lamp, top: 0 }], null, manifest)).toHaveLength(0);
  });

  test('panel axis = THE PANEL LAW line; pivot clamped onto the panel bbox', () => {
    // v1.10.2 replaces the v0.175-177 empirical triad: the spin line is
    // R(q)·C·ê through the clamped axle pivot — bench-exact against the
    // game's own baked transforms (describe BENCH CENSUS below).
    // SmallHinge angular_y at an identity mount: C·ŷ = −ẑ (a standing
    // hinge hinges about the horizontal fore–aft line — the XYQ-615 bench
    // confirms this byte-exactly).
    const mc = comp({ type: 'SmallHinge', position: { x: 0, y: 0.4, z: 0 } });
    const [jf] = captureJrefs([{ component: 0, mc, top: 0 }], bbx, manifest);
    expect(jf!.axis0[2]).toBeCloseTo(-1, 6);
    expect(jf!.axis0[0]).toBeCloseTo(0, 9);
    // pivot clamped onto the panel bbox: the axle floats at y=0.4+0.15, the
    // CLAMPED line rides the panel's top edge (v0.173 "rotating around the bottom/edge")
    expect(jf!.pivot0[1]).toBeCloseTo(bbx.max[1], 6);
    // a rotated mount spins the line WITH the part: Rz(90)·(−ẑ) = −ẑ stays
    // (z is the Rz axis) while Rz(90)·ŷ would have become ∓x̂ — the Badger
    // door bug: SmallPivots mounted Rz(∓90) drawbridged about x̂.
    const rz = comp({
      type: 'SmallPivot', orientation: eulerZYX(0, 0, 90),
      position: { x: 0.375, y: 1.375, z: -0.375 },
    });
    const [jr] = captureJrefs([{ component: 0, mc: rz, top: 0 }], null, manifest);
    expect(jr!.axis0[2]).toBeCloseTo(-1, 6);
    expect(jr!.axis0[0]).toBeCloseTo(0, 9);
    // the slide key maps through the same content basis
    const trk = comp({
      type: 'LinearTrack', orientation: eulerZYX(0, 0, 90),
      position: { x: 0, y: 0, z: 0 }, data: { pos: 0.25 },
    });
    const [jt] = captureJrefs([{ component: 0, mc: trk, top: 0 }], bbx, manifest);
    expect(jt!.axis0[0]).toBeCloseTo(0, 6);              // C·x̂ = x̂, Rz(90)·x̂ = ŷ
    expect(jt!.axis0[1]).toBeCloseTo(1, 6);
  });

  test('joint pose: angle 0 + built master pose ⇒ EXACTLY the base (bit-identical load)', () => {
    const mc = comp({ type: 'SmallPivot', position: { x: 1, y: 0.5, z: 2 }, data: { angle: 0 } });
    const [r] = captureJrefs([{ component: 0, mc, top: 0 }], bbx, manifest);
    const st = [masterJointState(mc)];
    const base = { p: [0, 0, 0] as [number, number, number], q: { w: 1, x: 0, y: 0, z: 0 } as FileQuat };
    const pose = subJointPose(base, [r!], st);
    expect(pose.p[0]).toBeCloseTo(0, 12); expect(pose.p[1]).toBeCloseTo(0, 12); expect(pose.p[2]).toBeCloseTo(0, 12);
    expect(Math.abs(pose.q.w)).toBeCloseTo(1, 12);
  });

  test('90° spin orbits the group about the CAPTURED line; slide rides slide0', () => {
    const mc = comp({ type: 'SmallHinge', position: { x: 0, y: 0.4, z: 0 }, data: { angle: 0 } });
    const [r] = captureJrefs([{ component: 0, mc, top: 0 }], bbx, manifest);
    const base = { p: [0, 0, 0] as [number, number, number], q: { w: 1, x: 0, y: 0, z: 0 } as FileQuat };
    // pivot0 = (0, 0.25, 0) clamped; axis0 = −ẑ → spin 90° about (0,0.25,0)+ẑ⁻
    // (st.pos = the master's OWN capture position: it sits at its built pose,
    // so the rigid-ride term is pure identity and only the joint term acts)
    const st = [{ angle: 90, slide: 0, pos: [0, 0.4, 0] as [number, number, number], quat: { w: 1, x: 0, y: 0, z: 0 } }];
    const pose = subJointPose({ p: [1, 0.25, 0], q: base.q }, [r!], st);
    // 90° about −ẑ maps x̂→+ŷ about the pivot: (1,0.25,0)−pivot=(1,0,0) → R(−ẑ,90°)·(1,0,0) = (0,−1,0)? 
    // R(-ẑ,90) sends x̂→−ŷ ⇒ p = pivot + (0,−1,0)
    expect(pose.p[0]).toBeCloseTo(r!.pivot0[0], 9);
    expect(pose.p[1]).toBeCloseTo(r!.pivot0[1] - 1, 9);
    expect(pose.p[2]).toBeCloseTo(r!.pivot0[2], 9);
    // slide +0.25 along the LAW slide (SmallHinge has no slide key ⇒ the
    // spin key maps through C: ŷ → −ẑ; a LinearTrack's x̂ stays x̂ — next test)
    const st2 = [{ angle: 0, slide: 0.25, pos: [0, 0.4, 0] as [number, number, number], quat: { w: 1, x: 0, y: 0, z: 0 } }];
    const pose2 = subJointPose(base, [r!], st2);
    expect(pose2.p[0]).toBeCloseTo(0, 9);
    expect(pose2.p[1]).toBeCloseTo(0, 9);
    expect(pose2.p[2]).toBeCloseTo(-0.25, 9);
  });

  test('rigid riding: the master TRANSLATING +0.5 x moves the subgrid +0.5 x (subfollow)', () => {
    const mc = comp({ type: 'SmallPivot', position: { x: 1, y: 0.5, z: 2 }, data: { angle: 0 } });
    const [r] = captureJrefs([{ component: 0, mc, top: 0 }], bbx, manifest);
    const base = { p: [0, 0, 0] as [number, number, number], q: { w: 1, x: 0, y: 0, z: 0 } as FileQuat };
    const moved = { ...masterJointState(mc), pos: [1.5, 0.5, 2] as [number, number, number] };   // raw == view (v0.180)
    const pose = subJointPose(base, [r!], [moved]);
    expect(pose.p[0]).toBeCloseTo(0.5, 9);
    expect(pose.p[1]).toBeCloseTo(0, 9);
    expect(pose.p[2]).toBeCloseTo(0, 9);
  });
});

// ------------------------------------------------------- THE PLATE LAW v2 pins
// v1.10.2 THE PANEL LAW (file header of subgrid.ts): the panel spins about
// R(q)·C·ê (C = Rx(−90)), byte-proven on the game's own baked
// Build.orientation transforms (tools/bench_census.py). The part's OWN axle
// node hangs under the same C and must follow the SAME line:
//   node-local v = baseQ⁻¹·ê (world R(q)·C·baseQ·v ≡ R(q)·C·ê), slide d = ê.
describe('THE PLATE LAW v2 — the part plate turns on the panel’s line', () => {
  const CQ: FileQuat = { w: Math.SQRT1_2, x: -Math.SQRT1_2, y: 0, z: 0 };  // Rx(−90)
  const UNIT: Record<'x' | 'y' | 'z', [number, number, number]> = {
    x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1],
  };
  const baseQs: { name: string; q: FileQuat }[] = [
    { name: 'identity (SmallHinge axle)', q: { w: 1, x: 0, y: 0, z: 0 } },
    { name: 'Ry10 (SmallPivot axle)', q: eulerZYX(0, 10, 0) },
    { name: 'Rx30', q: eulerZYX(30, 0, 0) },
    { name: 'ZYX mix', q: eulerZYX(15, -40, 70) },
  ];
  for (const { name, q } of baseQs) {
    for (const k of ['x', 'y', 'z'] as const) {
      test(`rotation line: C·(${name}·v) == C·ê_${k} (panel law)`, () => {
        const v = jointNodeAxis(q, k);
        const plate = qRot(CQ, qRot(q, v));
        const panel = qRot(CQ, UNIT[k]);
        expect(plate[0]).toBeCloseTo(panel[0]!, 9);
        expect(plate[1]).toBeCloseTo(panel[1]!, 9);
        expect(plate[2]).toBeCloseTo(panel[2]!, 9);
      });
      test(`slide line: C·(${name}·d) == C·ê_${k}`, () => {
        const d = jointNodeSlide(q, k);
        const plate = qRot(CQ, d);
        const panel = qRot(CQ, UNIT[k]);
        expect(plate[0]).toBeCloseTo(panel[0]!, 9);
        expect(plate[1]).toBeCloseTo(panel[1]!, 9);
        expect(plate[2]).toBeCloseTo(panel[2]!, 9);
      });
    }
  }
  const near = (v: readonly number[], e: readonly number[]) => {
    expect(v.length).toBe(e.length);
    v.forEach((x, i) => expect(x).toBeCloseTo(e[i]!, 9));
  };
  test('x̂ is C-INVARIANT at identity — the Aileron/LinearTrack look is byte-identical', () => {
    const id: FileQuat = { w: 1, x: 0, y: 0, z: 0 };
    near(jointNodeAxis(id, 'x'), [1, 0, 0]);
    near(jointNodeSlide(id, 'x'), [1, 0, 0]);
  });
  test('the node formula is the statute v = baseQ⁻¹·ê, slide d = ê', () => {
    const id: FileQuat = { w: 1, x: 0, y: 0, z: 0 };
    near(jointNodeAxis(id, 'y'), [0, 1, 0]);               // raw key at identity
    near(jointNodeSlide(id, 'y'), [0, 1, 0]);              // parent space = C space
    const ry = eulerZYX(0, 10, 0);
    const v = jointNodeAxis(ry, 'y');
    near(qRot(ry, v), [0, 1, 0]);                          // baseQ·v ≡ ê
  });
  test('the balloon tail mount end-to-end: plate axis == jointChain axis == the ship longitudinal', () => {
    // v1.10.2 GAME-STATUTE mount: upright hinge, plug axle fore–aft — the
    // file quat is the half-turn about file ŷ (frame x̂→−x̂, ŷ→ŷ, ẑ→−ẑ),
    // so jointChain reads R(180ŷ)·C·ŷ = R·(0,0,−1) = +ẑ = the longitudinal
    // line the v1.9.3 ruling demands (top and keel scissor sideways).
    const qStat: FileQuat = { w: 0, x: 0, y: 1, z: 0 };
    const mc: BlueprintComponent = comp({
      type: 'SmallHinge', orientation: qStat, data: { angle: 25 },
    });
    const manifest = {
      SmallHinge: { joints: [{ name: 'axle', position: [0, 0, 0], rotation: [0, 0, 0], axis: 'y' }] },
    } as unknown as ModelManifest;
    const chain = jointChain(mc, manifest);
    expect(Math.abs(chain!.axis[2]!)).toBeGreaterThan(0.999);   // panel rolls along ẑ
    expect(Math.abs(chain!.axis[1]!)).toBeLessThan(1e-9);       // not vertical
    const v = jointNodeAxis({ w: 1, x: 0, y: 0, z: 0 }, 'y');
    const plateWorld = qRot(qStat, qRot(CQ, v));
    plateWorld.forEach((x, i) => expect(x).toBeCloseTo(chain!.axis[i]!, 9));
  });
});

// ------------------------------------------------- THE BENCH LAW (v1.10.2)
// Build.orientation is the game's OWN saved panel transform. Where it is a
// rotation, captureJrefs reads the display angle off it (bakedAngle) and
// edits ride as deltas — so a load lands on the game's pose even when the
// file's data.angle has the mirrored-twin sign the game's physics wrote.
describe('THE BENCH LAW — baked display pose + edit deltas', () => {
  const manifest: ModelManifest = {
    SmallPivot: { joints: [{ name: 'axle', position: [0, 0, 0], rotation: [0, 0, 0], axis: 'y' }] },
  } as unknown as ModelManifest;
  const base = { p: [0, 0, 0] as [number, number, number], q: { w: 1, x: 0, y: 0, z: 0 } as FileQuat };
  // Badger door 6 verbatim: SmallPivot at Rz(−90), angle 306, bench +54°
  // about the ẑ law line (the game's own transform, 3326372833).
  const door = comp({
    type: 'SmallPivot',
    orientation: { w: Math.SQRT1_2, x: 0, y: 0, z: -Math.SQRT1_2 },
    position: { x: 1.125, y: 3.375, z: 0.875 }, data: { angle: 306 },
  });
  const bench: FileQuat = { w: 0.8910064767442805, x: 0, y: 0, z: 0.4539905928537991 };

  test('bench rotation wins the load pose (306 authored ⇒ game shows +54)', () => {
    const [r] = captureJrefs([{ component: 0, mc: door, top: 0 }], null, manifest, bench);
    expect(r!.axis0[2]).toBeCloseTo(-1, 6);                      // law line Rz(−90)·C·ŷ = −ẑ
    // the bench is +54° about ẑ ⇒ −54° about the law line −ẑ (same spin);
    // data.angle 306 about the law line is the SAME rotation (306 ≡ −54).
    expect(r!.bakedAngle).toBeCloseTo(-54, 4);  // file floats carry 54.000012
    expect(r!.authoredAngle).toBeCloseTo(306, 6);
    const st = [{ angle: 306, slide: 0, pos: [1.125, 3.375, 0.875] as [number, number, number],
      quat: { w: Math.SQRT1_2, x: 0, y: 0, z: -Math.SQRT1_2 } }];
    const pose = subJointPose(base, [r!], st);
    // the load rotation EQUALS the game's bench rotation: the relative
    // rotation pose·bench⁻¹ is the identity (double cover absorbed by |w|)
    const inv: FileQuat = { w: bench.w, x: -bench.x, y: -bench.y, z: -bench.z };
    const a = pose.q, b = inv;
    const rel = {
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    };
    expect(Math.abs(rel.w)).toBeCloseTo(1, 9);
  });
  test('edits ride as DELTAS from the authored angle (slider to 0 closes the door)', () => {
    const [r] = captureJrefs([{ component: 0, mc: door, top: 0 }], null, manifest, bench);
    const st = (a: number) => [{ angle: a, slide: 0, pos: [1.125, 3.375, 0.875] as [number, number, number],
      quat: { w: Math.SQRT1_2, x: 0, y: 0, z: -Math.SQRT1_2 } }];
    const closed = subJointPose(base, [r!], st(0));
    expect(Math.abs(closed.q.w)).toBeCloseTo(1, 9);              // identity ⇒ shut
    expect(Math.abs(closed.q.x) + Math.abs(closed.q.y) + Math.abs(closed.q.z)).toBeLessThan(1e-5);
    // a −10° edit (306→296) turns the LOAD pose by exactly −10° about the
    // law line, whatever the wrap: pose·bench⁻¹ = qAxisAngle(−ẑ, −10°)
    const open = subJointPose(base, [r!], st(296));
    const inv: FileQuat = { w: bench.w, x: -bench.x, y: -bench.y, z: -bench.z };
    const a = open.q, b = inv;
    const rel = {
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    };
    expect(2 * Math.atan2(Math.hypot(rel.x, rel.y, rel.z), Math.abs(rel.w)) / (Math.PI / 180))
      .toBeCloseTo(10, 6);
    expect(rel.z / Math.hypot(rel.x, rel.y, rel.z)).toBeCloseTo(1, 6);    // −10° about −ẑ = +10° about ẑ
  });
  test('identity bench ⇒ baked == authored (historic no-bench behaviour untouched)', () => {
    const mc = comp({ type: 'SmallPivot', position: { x: 1, y: 0, z: 0 }, data: { angle: 126 } });
    const [r] = captureJrefs([{ component: 0, mc, top: 0 }], null, manifest, { w: 1, x: 0, y: 0, z: 0 });
    expect(r!.bakedAngle).toBeCloseTo(126, 12);
    const [r2] = captureJrefs([{ component: 0, mc, top: 0 }], null, manifest, null);
    expect(r2!.bakedAngle).toBeCloseTo(126, 12);
  });
});

// ------------------------------------------------- BENCH CENSUS (the statute)
// The golden corpus net: for EVERY (subgrid, master) pair whose Build carries
// a baked rotation, the law line R(q)·C·ê must be that rotation's axis, and
// the baked angle must equal data.angle — or, for the game's mirrored mirror-
// twins, exactly −data.angle (the physics mirrored one twin's travel at
// save). tools/bench_census.py established 157/166 exact + 9 mirrored; this
// pin keeps the statute green on the whole corpus, forever.
describe('BENCH CENSUS — the game’s baked transforms obey the law on the whole corpus', () => {
  const manifestPath = new URL('../../../../viewer/models/manifest.json', import.meta.url);
  const MAN = JSON.parse(readFileSync(manifestPath, 'utf8')) as ModelManifest;
  const qeq = (a: FileQuat, b: FileQuat) =>
    [0, 1, 2, 3].every(i => Math.abs((a as any)[i] - (b as any)[i]) < 1e-3)
    || [0, 1, 2, 3].every(i => Math.abs((a as any)[i] + (b as any)[i]) < 1e-3);
  const KEYS = ['w', 'x', 'y', 'z'] as const;
  const asArr = (q: FileQuat) => ({ 0: q.w, 1: q.x, 2: q.y, 3: q.z } as Record<number, number>);
  const qSame = (a: FileQuat, b: FileQuat) => {
    const A = asArr(a), B = asArr(b);
    return [0, 1, 2, 3].every(i => Math.abs(A[i]! - B[i]!) < 1e-3)
      || [0, 1, 2, 3].every(i => Math.abs(A[i]! + B[i]!) < 1e-3);
  };
  test('every baked bench is a law-axis rotation of ±data.angle', () => {
    // the COMMITTED testdata corpus (148 baked pairs, 2026-10-24) — the
    // machine-local save corpus may differ, so the statute is pinned here.
    const TESTDATA = new URL('../../../../testdata/', import.meta.url);
    const ids = readdirSync(TESTDATA).filter(d =>
      existsSync(new URL(`${d}/blueprint.json`, TESTDATA)));
    expect(ids.length).toBeGreaterThan(20);
    let baked = 0, exact = 0, mirrored = 0, drifted = 0;
    for (const id of ids) {
      let bp: Blueprint;
      try { bp = JSON.parse(readFileSync(new URL(`${id}/blueprint.json`, TESTDATA), 'utf8')) as Blueprint; } catch { continue; }
      const byBuild = subMasterEntries(bp);
      for (const [bi, entries] of byBuild) {
        const bench = bp.data.components[bi]?.orientation ?? null;
        if (!bench) continue;
        let { w, x, y, z } = bench;
        if (w < 0) { w = -w; x = -x; y = -y; z = -z; }
        const s = Math.hypot(x, y, z);
        if (s < 1e-6) continue;                                  // no baked rotation
        const jref = captureJrefs(entries, null, MAN, bench)[0];
        if (!jref) continue;
        baked += 1;
        const axisDot = Math.abs(jref.axis0[0]! * x / s + jref.axis0[1]! * y / s + jref.axis0[2]! * z / s);
        expect(axisDot, `${id} build ${bi}: bench axis not the law line ${jref.axis0}`).toBeGreaterThan(0.999);
        const pred = (sign: number): FileQuat => {
          const a = sign * jref.authoredAngle * (Math.PI / 180);
          const hh = a / 2, sh = Math.sin(hh);
          return {
            w: Math.cos(hh), x: jref.axis0[0]! * sh,
            y: jref.axis0[1]! * sh, z: jref.axis0[2]! * sh,
          };
        };
        const bq = { w, x, y, z };
        if (qSame(pred(1), bq)) exact += 1;
        else if (qSame(pred(-1), bq)) mirrored += 1;
        else drifted += 1;
      }
    }
    void KEYS; void qeq;
    // The census measurement of 2026-10-24: ≥ 85 % exact, the rest mirror-
    // twin flips or ≤1.5° authoring drift — NO pair may point off the line
    // (asserted above), and the law must keep the exact share.
    expect(baked).toBeGreaterThanOrEqual(140);
    expect(exact / baked).toBeGreaterThan(0.85);
    expect(exact + mirrored + drifted).toBe(baked);
  });
});
