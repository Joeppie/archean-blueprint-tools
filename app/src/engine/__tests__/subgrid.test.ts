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
    } as unknown as ModelManifest, false)!;
    expect(Math.abs(jc.pivot[2] - 0.25)).toBeLessThan(1e-9);
    expect(jc.pivot[2]).toBeGreaterThanOrEqual(b.min[2]);
    expect(jc.pivot[2]).toBeLessThanOrEqual(b.max[2]);
  });

  test('pivot-only subgrid (no blocks): axis stays the .ini key chain', () => {
    const mc = comp({ type: 'SmallPivot', position: { x: 2, y: 1, z: -3 }, data: { angle: 126 } });
    const jref = captureJrefs([{ component: 0, mc, top: 0, mcPath: [] }], null, manifest, false);
    expect(jref).toHaveLength(1);
    expect(jref[0]!.axis0).toEqual(jointChain(mc, manifest, false)!.axis);
    expect(jref[0]!.pivot0).toEqual(jointChain(mc, manifest, false)!.pivot);
  });

  test('static hosts get NO joint term (Lamp angle = light aim, not a hinge)', () => {
    const lamp = comp({ type: 'Lamp', data: { angle: 45 } });
    expect(captureJrefs([{ component: 0, mc: lamp, top: 0 }], null, manifest, false)).toHaveLength(0);
  });

  test('EDGE-mounted hinge keeps the pin; FACE-mounted hinge swings on pin×span', () => {
    // content spans along x (longest dim x̂). Pin ŷ (SmallHinge angular_y):
    // |pin·d| = 0 → face-mounted → axis = ŷ×x̂ = −ẑ (dolphin skin-fin roll).
    const face = comp({ type: 'SmallHinge', position: { x: 0, y: 0.4, z: 0 } });
    const [jf] = captureJrefs([{ component: 0, mc: face, top: 0 }], bbx, manifest, false);
    expect(jf!.axis0[2]).toBeCloseTo(-1, 6);
    expect(jf!.axis0[0]).toBeCloseTo(0, 9);
    // pivot clamped onto the panel bbox: the axle floats at y=0.4+0.15, the
    // CLAMPED line rides the panel's top edge (v0.173 "rotating around the bottom/edge")
    expect(jf!.pivot0[1]).toBeCloseTo(bbx.max[1], 6);
    // edge-mounted: content runs along its pin — a y-span panel |pin·d|≈1 keeps d
    const bbY = { min: [-0.125, 0, -0.25] as [number, number, number], max: [0.125, 1.25, 0.25] as [number, number, number] };
    const edge = comp({ type: 'SmallHinge', position: { x: 0, y: 0.4, z: 0 } });
    const [je] = captureJrefs([{ component: 0, mc: edge, top: 0 }], bbY, manifest, false);
    expect(Math.abs(je!.axis0[1])).toBeCloseTo(1, 6);       // ±ŷ long-edge yaw (XYQ doors)
    // a SmallPIVOT never takes the triad branch — panels keep the longest dim
    const piv = comp({ type: 'SmallPivot', position: { x: 0, y: 0.4, z: 0 } });
    const [jp] = captureJrefs([{ component: 0, mc: piv, top: 0 }], bbx, manifest, false);
    expect(Math.abs(jp!.axis0[0])).toBeCloseTo(1, 6);
  });

  test('joint pose: angle 0 + built master pose ⇒ EXACTLY the base (bit-identical load)', () => {
    const mc = comp({ type: 'SmallPivot', position: { x: 1, y: 0.5, z: 2 }, data: { angle: 0 } });
    const [r] = captureJrefs([{ component: 0, mc, top: 0 }], bbx, manifest, false);
    const st = [masterJointState(mc, false)];
    const base = { p: [0, 0, 0] as [number, number, number], q: { w: 1, x: 0, y: 0, z: 0 } as FileQuat };
    const pose = subJointPose(base, [r!], st);
    expect(pose.p[0]).toBeCloseTo(0, 12); expect(pose.p[1]).toBeCloseTo(0, 12); expect(pose.p[2]).toBeCloseTo(0, 12);
    expect(Math.abs(pose.q.w)).toBeCloseTo(1, 12);
  });

  test('90° spin orbits the group about the CAPTURED line; slide rides slide0', () => {
    const mc = comp({ type: 'SmallHinge', position: { x: 0, y: 0.4, z: 0 }, data: { angle: 0 } });
    const [r] = captureJrefs([{ component: 0, mc, top: 0 }], bbx, manifest, false);
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
    // slide +0.25 along d = x̂ (longest dim)
    const st2 = [{ angle: 0, slide: 0.25, pos: [0, 0.4, 0] as [number, number, number], quat: { w: 1, x: 0, y: 0, z: 0 } }];
    const pose2 = subJointPose(base, [r!], st2);
    expect(pose2.p[0]).toBeCloseTo(0.25, 9);
    expect(pose2.p[1]).toBeCloseTo(0, 9);
  });

  test('rigid riding: the master TRANSLATING +0.5 x moves the subgrid +0.5 x (subfollow)', () => {
    const mc = comp({ type: 'SmallPivot', position: { x: 1, y: 0.5, z: 2 }, data: { angle: 0 } });
    const [r] = captureJrefs([{ component: 0, mc, top: 0 }], bbx, manifest, false);
    const base = { p: [0, 0, 0] as [number, number, number], q: { w: 1, x: 0, y: 0, z: 0 } as FileQuat };
    const moved = { ...masterJointState(mc, false), pos: [1.5, 0.5, 2] as [number, number, number] };   // raw == view (v0.180)
    const pose = subJointPose(base, [r!], [moved]);
    expect(pose.p[0]).toBeCloseTo(0.5, 9);
    expect(pose.p[1]).toBeCloseTo(0, 9);
    expect(pose.p[2]).toBeCloseTo(0, 9);
  });
});

// ------------------------------------------------------- THE PLATE LAW pins
// v1.9.0 urgent-fix.md §1: the balloon's rudder plate rolled about the
// fore–aft axis (a PROPELLER) while its panel yawed about the vertical —
// applyJointPoses spun the axle node about the raw .ini key INSIDE the
// content basis C = Rx(−90), so the plate's world line was R(q)·C·ê while
// the in-game-pinned panel law is R(q)·ê. jointNodeAxis/jointNodeSlide
// conjugate C out; these pins hold the plate EXACTLY on the panel's line.
describe('THE PLATE LAW — the part plate turns on the panel’s line', () => {
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
      test(`rotation line: C·(${name}·v) == ${name}·ê_${k} (panel law)`, () => {
        const v = jointNodeAxis(q, k);
        const plate = qRot(CQ, qRot(q, v));
        const panel = qRot(q, UNIT[k]);
        expect(plate[0]).toBeCloseTo(panel[0]!, 9);
        expect(plate[1]).toBeCloseTo(panel[1]!, 9);
        expect(plate[2]).toBeCloseTo(panel[2]!, 9);
      });
      test(`slide line: C·(${name}·d) == ${name}·ê_${k}`, () => {
        const d = jointNodeSlide(q, k);
        const plate = qRot(CQ, d);
        const panel = qRot(q, UNIT[k]);
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
  test('SmallHinge ê_y lands the plate on CONTENT ẑ (world up at the rudder mount)', () => {
    const id: FileQuat = { w: 1, x: 0, y: 0, z: 0 };
    near(jointNodeAxis(id, 'y'), [0, 0, 1]);
    near(jointNodeAxis(id, 'z'), [0, -1, 0]);
  });
  test('the rudder case end-to-end: plate axis == jointChain axis == world up', () => {
    // the balloon rudder mount at stage (balloonfin frameQuat = identity):
    // the authored frame maps part ŷ → world up, so the file quat is plain I
    // and the in-game-pinned panel law gives UP…
    const mc: BlueprintComponent = comp({
      type: 'SmallHinge', orientation: { w: 1, x: 0, y: 0, z: 0 },
      data: { angle: 25 },
    });
    const manifest = {
      SmallHinge: { joints: [{ name: 'axle', position: [0, 0, 0], rotation: [0, 0, 0], axis: 'y' }] },
    } as unknown as ModelManifest;
    const chain = jointChain(mc, manifest, false);
    expect(chain!.axis).toEqual([0, 1, 0]);               // the panel yaws about UP
    const v = jointNodeAxis({ w: 1, x: 0, y: 0, z: 0 }, 'y');
    const plateWorld = qRot({ w: Math.SQRT1_2, x: -Math.SQRT1_2, y: 0, z: 0 }, v);
    expect(plateWorld[1]!).toBeCloseTo(1, 9);             // the plate turns about UP too
  });
});
