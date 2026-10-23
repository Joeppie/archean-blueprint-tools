// v1.7 doc-mirror pins: the three NEW write paths must keep bp + doc in
// lockstep and never disturb the byte-identity contract — the block
// `material` key (appended for files that predate it), the custom-RGB
// palette slot (int-styled, array created when absent) and the hullify batch
// (geometry blocks spliced out of BOTH lists, triangles inserted in order).
// v1.6.1 adds the SPHERE-SKIN persistence class: a write whose doc path does
// not exist yet (a file without data.triangles / data.pipes) must CREATE it —
// bp-only edits are invisible to the save (emitDoc(doc)) AND to the doc-text
// undo snapshots, which is exactly how "sphere gone after save, cannot redo"
// shipped in v1.6.0. These pins run the SHIPPED TOOLS registry headless.
import { describe, expect, test } from 'vitest';
import { docArrayInsert, docArrayRemoveAt, docEnsureArray, docFromValue, docGet, emitDoc, parseDoc, docValue } from '../doc';
import { appendTrianglesDoc, makeCtx, openFunnel, serializeSave, setPaletteSlot, writeBlockDoc, writeBlockMaterial } from '../edit';
import { hullifyApply, nearestSlot, paletteSlotNode, PAINT_FINISHES } from '../tools';
import type { FilePalette } from '../palette';
import { TOOLS } from '../../components/ToolsDialog';
import { planBalloonTail, type BalloonAdapters } from '../balloonfin';
import { sphereSkinTris, transformSkinTris } from '../latsphere';
import manifestJson from '../../../../viewer/models/manifest.json';

type Adm = { name: string; type: string; position: [number, number, number]; rotation: [number, number, number] };
const MAN = manifestJson as unknown as Record<string, { adapters: Adm[] }>;
const adapters: BalloonAdapters = {
  pivot: MAN.SmallHinge!.adapters.find(a => a.type === 'lowvoltage')!,
  coupler: MAN.LowVoltageJunction!.adapters
    .filter(a => a.type === 'lowvoltage' && a.name !== 'lowvoltage-input'),
};
import type { Blueprint, Triangle } from '../format';

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
      docArrayInsert(ctx.doc, ['data', 'triangles'], k, docFromValue(t, false));
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
    // v1.5.12 writer-style pins: the DEFAULT matches the game's own fresh
    // triangle authoring (fixture 9000006001) — NO smooth key (flat) — and
    // the numbers stay INT-modelled bare, never the "13.0" double style of
    // world coords.
    expect(out.data.triangles.every(t => !('smooth' in (t as Record<string, unknown>)))).toBe(true);
    expect(emitDoc(doc)).not.toMatch(/"(v0_x|frame_x|smooth)":\d+\.\d/);
  });
});

// ---------------------------------------------------------- v1.6.1 PINS
// The reported failure (user 2026-10-22): "When I create a sphere, save it,
// then load my craft; the sphere is gone… There seems to also be
// inconsistency where I cannot redo it." Root cause: the sphere commit (and
// the corner-drafted triangle) wrote bp but their docArrayInsert FAILED
// SILENTLY on a file without a data.triangles key — the SAVE is emitDoc(doc)
// and the UNDO/REDO snapshots are doc text, so the skin existed only in the
// live session. Class rule pinned here: EVERY generated-record append must
// guarantee its doc array first (appendTrianglesDoc / docEnsureArray).
describe('v1.6.1 generated records persist into doc + save + history', () => {
  const sphere = TOOLS.find(t => t.id === 'balloon')!;
  const hullify = TOOLS.find(t => t.id === 'hullify')!;

  test('the shipped balloon-skin commit lands in the SAVE of a triangles-less file', () => {
    const { doc, bp, ctx } = openFunnel(SRC);
    expect(docGet(doc, ['data', 'triangles'])).toBeUndefined();   // the trap
    const msg = sphere.place!.commit({ ...sphere.initial }, { triangles: [] }, [0, 0, 0], ctx);
    expect(msg).toContain('balloon SKIN');
    const n = bp.data.triangles!.length;
    expect(n).toBeGreaterThan(0);
    // SAVE = emitDoc(doc): the triangles must be IN the saved text…
    const saved = serializeSave(ctx);
    const out = JSON.parse(saved) as { data: { triangles: Record<string, unknown>[] } };
    expect(out.data.triangles.length).toBe(n);
    expect(out.data.triangles[0]).toHaveProperty('v0_x');
    // …and reload through the SHIPPED open funnel shows the skin (the editor
    // AND the game read the file, not the dead bp)
    expect(openFunnel(saved).bp.data.triangles!.length).toBe(n);
  });

  test('the skin stores game-INT bare numbers, flat default = no smooth key', () => {
    const { ctx } = openFunnel(SRC);
    sphere.place!.commit({ ...sphere.initial }, { triangles: [] }, [2, 0, -1], ctx);
    const saved = serializeSave(ctx);
    expect(saved).not.toMatch(/"(v0_x|v1_y|frame_x|material|smooth)":\d+\.\d/);
    const out = JSON.parse(saved) as { data: { triangles: Record<string, unknown>[] } };
    expect(out.data.triangles.every(t => !('smooth' in t))).toBe(true);
  });

  test('commit APPENDS on a file that already has triangles (authored ones verbatim)', () => {
    const src = SRC.replace('"components":[],', '"components":[],'
      + '"triangles":[{"colors":[51,51,51,51,51,51,51],"frame_x":0,"frame_y":0,"frame_z":0,'
      + '"material":0,"v0_x":6,"v0_y":6,"v0_z":6,"v1_x":7,"v1_y":6,"v1_z":6,"v2_x":6,"v2_y":7,"v2_z":6}],');
    const { bp, ctx } = openFunnel(src);
    sphere.place!.commit({ ...sphere.initial }, { triangles: [] }, [0, 0, 0], ctx);
    const saved = serializeSave(ctx);
    const out = JSON.parse(saved) as { data: { triangles: Record<string, unknown>[] } };
    expect(out.data.triangles.length).toBe(bp.data.triangles!.length);   // doc = bp
    expect(out.data.triangles.length).toBeGreaterThan(1);                // + the skin
    // the authored record is byte-untouched and stays FIRST
    expect(saved).toContain('"triangles":[{"colors":[51,51,51,51,51,51,51],"frame_x":0');
    expect(out.data.triangles[0]).toHaveProperty('v2_y', 7);
  });

  test('HISTORY contract: a built sphere makes a real snapshot AND redo restores it', () => {
    // exact Editor semantics (Editor.tsx commitSnapshot + applyHistory):
    // states are doc TEXT, a snapshot equal to the current one is SKIPPED,
    // and undo/redo re-open a snapshot text through the open funnel.
    const { doc, ctx } = openFunnel(SRC);
    const states = [emitDoc(doc)];                       // openText
    sphere.place!.commit({ ...sphere.initial }, { triangles: [] }, [0, 0, 0], ctx);
    const text = emitDoc(doc);                           // commitSnapshotSoon
    if (text !== states[states.length - 1]) states.push(text);
    // v1.6.0 failure: this pushed NOTHING (doc unchanged) and no redo state
    // EVER contained the skin — the literal "cannot redo it".
    expect(states.length).toBe(2);
    expect(openFunnel(states[0]!).bp.data.triangles ?? []).toHaveLength(0);   // undo
    expect(openFunnel(states[1]!).bp.data.triangles!.length).toBeGreaterThan(0); // redo
  });

  test('appendTrianglesDoc: [] never dirties, creates the array, INT-styled', () => {
    const doc = parseDoc(SRC);
    const ctx = makeCtx(doc, docValue(doc) as Blueprint);
    appendTrianglesDoc(ctx, []);
    expect(emitDoc(doc)).toBe(SRC);                      // untouched file
    expect(docGet(doc, ['data', 'triangles'])).toBeUndefined();
    const t: Triangle = {
      frame_x: 0, frame_y: 0, frame_z: 0, material: 0,
      colors: [51, 51, 51, 51, 51, 51, 51],
      v0_x: 6, v0_y: 6, v0_z: 6, v1_x: 7, v1_y: 6, v1_z: 6, v2_x: 6, v2_y: 6, v2_z: 7,
    };
    appendTrianglesDoc(ctx, [t]);
    const saved = serializeSave(ctx);
    expect(saved).toContain('"v2_z":7');                 // bare int, not "7.0"
    expect((JSON.parse(saved) as { data: { triangles: unknown[] } }).data.triangles).toHaveLength(1);
  });

  test('the shipped hullify run persists through the doc mirror (bp = doc)', () => {
    const { doc, ctx } = openFunnel(SRC);
    const msg = hullify.run({ wind: 'outward', shade: 'flat' }, ctx);
    expect(msg).toContain('hull triangles');
    const out = JSON.parse(serializeSave(ctx)) as { data: { blocks: { type: number }[]; triangles: unknown[] } };
    // the v1.6.1 double-push trap: hullifyApply appends to bp itself, so the
    // tool must only MIRROR — a bp push there doubles bp vs the saved doc
    // (the undo e2e pin caught 88 vs 44). doc must equal bp EXACTLY.
    expect(out.data.triangles.length).toBe(ctx.bp.data.triangles!.length);
    expect(out.data.triangles.length).toBeGreaterThan(0);
    expect(out.data.blocks.map(b => b.type)).toEqual([255]);
    expect(emitDoc(doc)).toContain('"triangles"');
  });

  test('WIRE class guard: docEnsureArray lets the FIRST pipe of a file persist', () => {
    // mirrors Editor.onConnect: a file that never carried data.pipes must
    // still save its first wired cable (same silent-fail class as triangles)
    const doc = parseDoc(SRC);
    const ctx = makeCtx(doc, docValue(doc) as Blueprint);
    expect(docGet(doc, ['data', 'pipes'])).toBeUndefined();
    docArrayInsert(ctx.doc, ['data', 'pipes'], 0, docFromValue({ a_component: 0 }));
    expect(serializeSave(ctx)).not.toContain('"pipes"');   // the bare insert FAILS (the bug)
    docEnsureArray(ctx.doc, ['data', 'pipes']);
    docArrayInsert(ctx.doc, ['data', 'pipes'], 0, docFromValue({ a_component: 0 }));
    const out = JSON.parse(serializeSave(ctx)) as { data: { pipes: unknown[] } };
    expect(out.data.pipes).toHaveLength(1);
  });
});

// ---------------------------------------------------------- v1.7.3 PINS
// "Let me choose whether the paint is metallic/matte etc. as per the other
// controls; ensure that is properly integrated into a single control." The
// FINISHES mirror the game's four palette families (palette.ts LEGACY_GROUPS
// rows); the sphere tool's single paint control writes a NEW slot carrying
// that shading, or snaps ≈ nearest preferring slots that WEAR it.
describe('v1.7.3 paint finishes', () => {
  test('paletteSlotNode carries the FINISH spec; default keeps the old style', () => {
    const metal = PAINT_FINISHES.find(f => f.id === 'metal')!;
    expect(paletteSlotNode({ r: 10, g: 20, b: 30 }, metal.spec))
      .toEqual({ r: 10, g: 20, b: 30, opacity: 15, roughness: 0, metallic: 1 });
    const glass = PAINT_FINISHES.find(f => f.id === 'glass')!;
    expect(paletteSlotNode({ r: 1, g: 2, b: 3 }, glass.spec).opacity).toBeLessThan(8);
    // no finish passed = the v1.7 behaviour, untouched (15 / 4 / 0)
    expect(paletteSlotNode({ r: 1, g: 2, b: 3 }))
      .toEqual({ r: 1, g: 2, b: 3, opacity: 15, roughness: 4, metallic: 0 });
  });

  test('nearestSlot with a finish PREFERS slots wearing it over a nearer colour', () => {
    const palette = new Array(256).fill(null) as FilePalette;
    palette[12] = { r: 10, g: 10, b: 10, opacity: 15, roughness: 7, metallic: 0 };  // matte-ish
    palette[13] = { r: 12, g: 12, b: 12, opacity: 15, roughness: 0, metallic: 0 };  // polished
    const matte = PAINT_FINISHES.find(f => f.id === 'matte')!.spec;
    // plain nearest = the exact-ish 12
    expect(nearestSlot(palette, { r: 12, g: 12, b: 12 })).toBe(13);
    // matte finish = the matte slot, even though its colour is FARTHER
    expect(nearestSlot(palette, { r: 12, g: 12, b: 12 }, matte)).toBe(12);
  });

  test('the shipped sphere commit writes the picked finish into the saved slot', () => {
    const sphere = TOOLS.find(t => t.id === 'balloon')!;
    const { ctx } = openFunnel(SRC);
    const msg = sphere.place!.commit(
      { ...sphere.initial, colorhow: 'new', finish: 'metal' }, { triangles: [] }, [0, 0, 0], ctx);
    expect(msg).toContain('metal paint');
    const out = JSON.parse(serializeSave(ctx)) as {
      data: { triangles: { colors?: number[] }[]; colors: (Record<string, number> | null)[] };
    };
    const slot = out.data.triangles[out.data.triangles.length - 1]!.colors![0]!;
    // #c9c9c9 = 201 + the METAL family shading, straight into the save
    expect(out.data.colors[slot]).toMatchObject({ r: 201, g: 201, b: 201, opacity: 15, roughness: 0, metallic: 1 });
  });

  test('a form carrying NO finish key keeps the historic slot style (compat)', () => {
    const sphere = TOOLS.find(t => t.id === 'balloon')!;
    const { ctx } = openFunnel(SRC);
    const form = { ...sphere.initial, colorhow: 'new' } as Record<string, string | number>;
    delete form['finish'];                          // pre-v1.7.3 stored form
    sphere.place!.commit(form, { triangles: [] }, [0, 0, 0], ctx);
    const out = JSON.parse(serializeSave(ctx)) as {
      data: { triangles: { colors?: number[] }[]; colors: (Record<string, number> | null)[] };
    };
    const slot = out.data.triangles[out.data.triangles.length - 1]!.colors![0]!;
    expect(out.data.colors[slot]).toMatchObject({ roughness: 7, metallic: 0 });  // matte = the default chip
  });
});

// ---------------------------------------------------------- v1.9 PINS
// The BALLOON TAIL batch (user 2026-10-23): the SHIPPED balloon tool with
// fins ON must land SKIN + SLEEVE + PANELS + components + composite joins +
// LV pipes into the SAVE through the same doc funnels (the v1.6.1 class
// rule), including a rotated + moved ghost: the ride probes carry the map
// to every component, cable and nested panel.
describe('v1.9 balloon tail persists through the SHIPPED commit', () => {
  const balloon = TOOLS.find(t => t.id === 'balloon')!;
  const spec = {
    rx: 2, ry: 2, rz: 8, profile: 'cylinder' as const, noseShoulder: 0.35, tailShoulder: 0.6,
  };
  const plan = planBalloonTail(
    spec, { finScale: 1, oversize: 1, volumes: true }, adapters);
  expect(plan.ok).toBe(true);
  const skinTris = sphereSkinTris(
    spec, { slot: 51, material: 0, smooth: false });
  const form = {
    ...balloon.initial, rx: 2, ry: 2, rz: 8, profile: 'cylinder',
    fins: 'on', finsize: 100, oversize: 100, volumes: 'on',
  };
  // GHOST order (the commit's slice contract): SKIN | fillets | panels
  const payload = {
    triangles: [...skinTris,
      ...plan.fillets.rudder, ...plan.fillets.aileronL, ...plan.fillets.aileronR,
      ...plan.panels.rudder, ...plan.panels.aileronL, ...plan.panels.aileronR],
    rides: [plan.probes],
    balloon: { plan },
  };
  type Saved = {
    data: {
      triangles: Record<string, number>[];
      components: {
        type: string; position: { x: number; y: number; z: number };
        orientation: { w: number; x: number; y: number; z: number };
        data?: Record<string, unknown>;
      }[];
      composite_builds: { component: number; slaveBuildId: number }[];
      pipes: { type: string; a_component: number; b_component: number; segments: { start: { x: number } }[] }[];
    };
  };

  test('fins ON: one commit writes skin+tail+components+joins+pipes into the SAVE', () => {
    const { ctx } = openFunnel(SRC);
    const msg = balloon.place!.commit(form as never, payload as never, [0, 0, 0], ctx);
    expect(msg).toContain('BALLOON');
    const saved = JSON.parse(serializeSave(ctx)) as Saved;
    // the MAIN skin stays UNTOUCHED and gains only the FIXED fillets
    expect(saved.data.triangles.length).toBe(skinTris.length + plan.counts.fillets);
    const kinds = saved.data.components.map(c => c.type);
    expect(kinds.filter(t => t === 'SmallHinge')).toHaveLength(3);
    expect(kinds.filter(t => t === 'Volume')).toHaveLength(1);   // ONE — the toggle
    expect(kinds.filter(t => t === 'Build')).toHaveLength(3);
    expect(kinds).toContain('LowVoltageJunction');
    // joins point at (hinge, build) — the flat list here equals the top list
    const joins = saved.data.composite_builds;
    expect(joins).toHaveLength(3);
    for (const j of joins) {
      expect(saved.data.components[j.component]!.type).toBe('SmallHinge');
      expect(saved.data.components[j.slaveBuildId]!.type).toBe('Build');
    }
    // LV runs from the coupler, ≥ 2 segments each (the game writer's rule)
    expect(saved.data.pipes).toHaveLength(3);
    for (const p of saved.data.pipes) {
      expect(p.type).toBe('lowvoltage');
      expect(saved.data.components[p.a_component]!.type).toBe('LowVoltageJunction');
      expect(saved.data.components[p.b_component]!.type).toBe('SmallHinge');
      expect(p.segments.length).toBeGreaterThanOrEqual(2);
    }
    // the panels ride INSIDE the Build records (nested triangles)
    for (const b of saved.data.components.filter(c => c.type === 'Build'))
      expect((b.data?.['triangles'] as unknown[] | undefined)?.length ?? 0).toBeGreaterThan(0);
    // …and survive a reload through the SHIPPED open funnel
    const again = openFunnel(serializeSave(ctx));
    expect(again.bp.data.pipes!.length).toBe(3);
    expect(again.bp.data.composite_builds!.length).toBe(3);
    expect(again.bp.data.components.filter(c => c.type === 'Build').length).toBe(3);
  });

  test('a rotated + moved ghost maps EVERY tail record with the skin', () => {
    const { ctx } = openFunnel(SRC);
    // the engine's law for ⟲y about the bbox pivot c: x′ = cₓ+(g_z−c_z), z′ = c_z−(g_x−c_x)
    const c = plan.probes[0]!;
    const rot = (g: readonly [number, number, number]): [number, number, number] =>
      [c[0] + (g[2] - c[2]), g[1], c[2] - (g[0] - c[0])];
    const rides = [plan.probes.map(g => rot(g))];
    // the engine turns the GHOST triangles with the very same lattice map
    const turned = (ts: typeof skinTris) => transformSkinTris(ts, rot);
    balloon.place!.commit(form as never, {
      ...payload,
      triangles: [
        ...turned(skinTris),
        ...turned(plan.fillets.rudder), ...turned(plan.fillets.aileronL), ...turned(plan.fillets.aileronR),
        ...turned(plan.panels.rudder), ...turned(plan.panels.aileronL), ...turned(plan.panels.aileronR),
      ],
      rides,
    } as never, [3, 1, -2], ctx);
    const saved = JSON.parse(serializeSave(ctx)) as Saved;
    // the coupler sits at the pivot → the cell offset alone: (0.75, 0.25, −0.5)
    const coupler = saved.data.components.find(c2 => c2.type === 'LowVoltageJunction')!;
    expect(coupler.position.x).toBeCloseTo(0.75, 3);
    expect(coupler.position.y).toBeCloseTo(0.25, 3);
    expect(coupler.position.z).toBeCloseTo(-0.5, 3);
    // the rudder hinge turned from identity into a pure ±90° about y
    const rudder = saved.data.components.find(c2 => c2.type === 'SmallHinge')!;
    expect(Math.abs(rudder.orientation.y)).toBeCloseTo(Math.SQRT1_2, 4);
    expect(Math.abs(rudder.orientation.w)).toBeCloseTo(Math.SQRT1_2, 4);
    expect(rudder.orientation.x).toBeCloseTo(0, 4);
    expect(rudder.orientation.z).toBeCloseTo(0, 4);
    // the rudder panel turned WITH the map: its centre plane x=6 became z=6−2=4
    const rudderBuild = saved.data.components.filter(c2 => c2.type === 'Build')[0]!;
    const tris = rudderBuild.data?.['triangles'] as Record<string, number>[];
    const gOf = (t: Record<string, number>, i: 0 | 1 | 2) =>
      t[`v${i}_z`]! + 12 * (t[`frame_z`] ?? 0);
    expect(tris.length).toBeGreaterThan(0);
    for (const t of tris) for (const i of [0, 1, 2] as const) expect(gOf(t, i)).toBe(4);
  });
});
