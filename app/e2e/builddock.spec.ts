// builddock.spec.ts — the BUILD WORKSPACE DOCK, re-pinned for the v1.11
// PLACEMENT REWRITE (we: "Remove the existing functionality and do a total
// rewrite; the bottom bar should be used only. Placing a block, you can
// choose to move/rotate/scale it; scaling means stretching in a direction.
// Ensure mirroring is possible and easily switchable by axis, should be a
// visible widget showing if x/y/z mirrored. Placing triangles is done by
// putting down three points, which you can move around before and after
// placing all three of them, it should look like a pin, and an arrow should
// point down/up for the direction of the triangle. Choosing a block size
// before placing it shouldn't be a thing."). Pins over the REAL editor:
//  • the blocks workspace is a WIDE BOTTOM DOCK (wire-dock twin),
//  • the block LIST selects (hover = gold 3D preview path), ✕ deletes
//    (one Ctrl+Z restores),
//  • the brush carries NO SIZE: every click lands a 1×1×1 block (the size
//    UI is GONE); the ⤢ STRETCH mode of the block widget grows it in whole
//    cells, and the modebox shows ⤢ ONLY on a block-owned widget,
//  • the dock's MIRROR WIDGET (⇄ + ⊘ x y z) is the visible axis switch,
//  • a block near a frame edge GROWS TO A SQUARE (centre-frozen engine law),
//  • the TRIANGLE PIN EDITOR: three clicks drop draggable pins, the third
//    commits the prism, the pins + the direction arrow STAY on the triangle
//    and a pin drag rewrites its corner (before AND after the commit),
//  • the TRIANGLE dock lists prisms, moves them by cells and REFUSES a
//    corner push out of the 32-slot vertex window with a visible reason.
import { test, expect, type Page } from '@playwright/test';

async function open(page: Page, id = '9000005001') {
  await page.goto(`/?craft=${id}`);
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
  await page.getByTestId('mode-edit').click();
  await expect(page.getByTestId('build-dock')).toBeVisible();
}

const bpBlocks = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __ARCHEAN__?: { engine: { blueprint: {
    data: { blocks: { size_x: number; size_y: number; size_z: number }[] } } } } };
  return w.__ARCHEAN__!.engine.blueprint.data.blocks.map(b => [b.size_x, b.size_y, b.size_z]);
});

const blockGiz = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __ARCHEAN__?: { blockGizmo: () => {
    bi: number; mode: string; ext: [number, number, number];
    cell: [number, number, number]; shown: boolean } | null } };
  return w.__ARCHEAN__!.blockGizmo();
});

/** a canvas pixel whose pickCell lands on a block face (face-interior rule) */
async function faceSpot(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const c = document.querySelector('canvas')!;
    const r = c.getBoundingClientRect();
    const e = (window as unknown as { __ARCHEAN__?: { engine: { pendingReal: number;
      pickCell: (x: number, y: number) => { bi: number } | null } } }).__ARCHEAN__!.engine;
    if (e.pendingReal > 0) return null;
    for (let fy = 0.3; fy <= 0.85; fy += 0.04)
      for (let fx = 0.2; fx <= 0.8; fx += 0.04) {
        const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
        if (h && h.bi >= 0) return { x: fx, y: fy };
      }
    return null;
  });
}

test.describe('build-dock: blocks workspace, place-then-stretch, mirror widget @place @ui', () => {
  // RETIRED v1.12.5 (L5): dock COLUMN/ABSENCE/row-count DOM law on the REAL Editor
  // state machine (Viewport-mock harness) — components/__tests__/editor.dom.test.tsx
  // 'the dock shows brush, census, list, edit and the MIRROR widget columns' (rows ===
  // bp blocks, the SIZE-UI absence, every column testid).

  // RETIRED v1.12.5 (L5): list select ▸ ✕ delete ▸ ONE Ctrl+Z restore runs on the
  // Editor DOM tier (editor.dom.test.tsx) — same rows, same block-count law.

  test('a click lands a 1×1×1 block; the widget offers ✥ ⟳ ⤢ and ⤢ STRETCHES it', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await open(page);
    await page.getByTestId('ws-blocks').click();
    await page.getByTestId('mirw-off').click();                  // single-cell: no auto twin
    const spot = await faceSpot(page);
    expect(spot, 'a block face answers the place path').not.toBeNull();
    const box = (await page.getByTestId('canvas').boundingBox())!;
    const n0 = (await bpBlocks(page)).length;
    await page.getByTestId('canvas').click({
      position: { x: box.width * spot!.x, y: box.height * spot!.y } });
    // ONE 1×1×1 block lands (no size pre-selection, no twin by default)
    await expect.poll(() => bpBlocks(page).then(b => b.length),
      { timeout: 5000 }).toBe(n0 + 1);
    const sizes = await bpBlocks(page);
    expect(sizes[sizes.length - 1]).toEqual([0, 0, 0]);       // the placed cell
    // the placed block is SELECTED and owns the widget (uniform gizmo law)
    await expect.poll(() => blockGiz(page), { timeout: 5000 }).toMatchObject({
      mode: expect.any(String), shown: true, ext: [1, 1, 1] });
    // the modebox pops at the click: ⊘ ✥ ⟳ and the BLOCK-ONLY ⤢ row
    await expect(page.getByTestId('mode-scale')).toBeVisible();
    await page.getByTestId('mode-scale').click();
    await expect.poll(() => blockGiz(page), { timeout: 5000 }).toMatchObject({ mode: 'scale' });
    // STRETCH = footprint ext in whole cells; the widget commit drives this
    // exact engine path; pins drive it headless.
    await page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { blockScale: (e: [number, number, number]) => boolean }
      }).__ARCHEAN__!.blockScale([3, 1, 1]));
    await expect.poll(() => blockGiz(page), { timeout: 5000 }).toMatchObject({ ext: [3, 1, 1] });
    const s = await bpBlocks(page);
    expect(s[s.length - 1]).toEqual([2, 0, 0]);               // size = ext − 1
    // DIRECTIONAL (we: "if I resize in +z it also stretches in −z — that is
    // undesirable"): a +z stretch grows ONLY toward +z — the cell (the −z
    // face) never moves…
    const g1 = await blockGiz(page);
    await page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { blockScale: (e: [number, number, number], s?: [number, number, number]) => boolean }
      }).__ARCHEAN__!.blockScale([3, 1, 3]));
    await expect.poll(() => blockGiz(page), { timeout: 5000 }).toMatchObject({
      ext: [3, 1, 3], cell: g1!.cell });                     // −z face anchored
    // …and a −z stretch anchors the +z face: cell + ext is invariant.
    await page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { blockScale: (e: [number, number, number], s?: [number, number, number]) => boolean }
      }).__ARCHEAN__!.blockScale([3, 1, 5], [1, 1, -1]));
    const g2 = await blockGiz(page);
    expect(g2!.ext).toEqual([3, 1, 5]);
    expect(g2!.cell[2] + g2!.ext[2]).toBe(g1!.cell[2] + 3);  // +z face anchored
    expect(g2!.cell[0]).toBe(g1!.cell[0]);                   // untouched axes stay
    // Ctrl+Z: the stretches coalesce into ONE undo step — selection clears
    await page.keyboard.press('Control+z');
    await expect.poll(() => blockGiz(page), { timeout: 5000 }).toBeNull();
  });

  test('⤢ is BLOCK-only: a component-owned widget never shows it', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await open(page);
    await page.getByTestId('ws-edit').click();
    // click a part pixel (pickCell kind comp) — the modebox pops for it
    const spot = await page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      const r = c.getBoundingClientRect();
      const e = (window as unknown as { __ARCHEAN__?: { engine: { pendingReal: number;
        pickCell: (x: number, y: number) => { kind: string; ci: number } | null } } })
        .__ARCHEAN__!.engine;
      if (e.pendingReal > 0) return null;
      for (let fy = 0.3; fy <= 0.85; fy += 0.04)
        for (let fx = 0.2; fx <= 0.8; fx += 0.04) {
          const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
          if (h && h.kind === 'comp' && h.ci >= 0) return { x: fx, y: fy };
        }
      return null;
    });
    test.skip(spot === null, 'no component surface answers the probe');
    const box = (await page.getByTestId('canvas').boundingBox())!;
    await page.getByTestId('canvas').click({
      position: { x: box.width * spot!.x, y: box.height * spot!.y } });
    await expect(page.getByTestId('modebox')).toBeVisible();
    await expect(page.getByTestId('mode-rotate')).toBeVisible();
    await expect(page.getByTestId('mode-scale'), 'the game has no part scale')
      .toHaveCount(0);
    await expect(page.getByTestId('mode-tris'), 'parts are not block skins')
      .toHaveCount(0);
  });

  test('⇄ twin ON lands the MIRROR TWIN of a drafted triangle (v1.11)', async ({ page }) => {
    // we: "mirror for triangle is not placed"
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await open(page, '3732302108');                            // the gantry: x-mirrored craft
    await page.getByTestId('ws-tris').click();
    // v1.11: the x chip is AUTO-lit — the gantry's data mirrors across x
    // (21 declared mirrorAxis parts + detected pairs), so the drafted
    // triangle twins WITHOUT arming (we: "I created a triangle but it was
    // not mirrored")
    await expect(page.getByTestId('mirw-x')).toHaveAttribute('aria-pressed', 'true');
    const trisOf = () => page.evaluate(() => {
      const w = window as unknown as {
        __ARCHEAN__?: { engine: { blueprint: { data: { triangles?: Record<string, number>[] } } } };
      };
      return (w.__ARCHEAN__!.engine.blueprint.data.triangles ?? []).map(t =>
        [0, 1, 2].map(vi => [0, 1, 2].map(ai => {
          const name = 'xyz'[ai]!;
          return t[`v${vi}_${name}`]! + 12 * t[`frame_${name}`]!;
        })));
    });
    const n0 = (await trisOf()).length;
    const spots = await page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      const r = c.getBoundingClientRect();
      const e = (window as unknown as { __ARCHEAN__?: { engine: {
        pickCell: (x: number, y: number) => { bi: number } | null } } }).__ARCHEAN__!.engine;
      // (the gantry is LITE tier — real models never stream, no pendingReal gate)
      const pts: { x: number; y: number }[] = [];
      for (let fy = 0.25; fy <= 0.9; fy += 0.03)
        for (let fx = 0.15; fx <= 0.9; fx += 0.03) {
          const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
          if (h && h.bi >= 0) pts.push({ x: r.left + r.width * fx, y: r.top + r.height * fy });
        }
      if (!pts.length) return null;
      const d = (a: { x: number; y: number }, b: { x: number; y: number }) =>
        Math.hypot(a.x - b.x, a.y - b.y);
      const p1 = pts[0]!;
      const p2 = pts.reduce((m, p) => (d(p, p1) > d(m, p1) ? p : m), p1);
      const p3 = pts.reduce((m, p) => (Math.min(d(p, p1), d(p, p2)) >
        Math.min(d(m, p1), d(m, p2)) ? p : m), p1);
      if (d(p1, p2) < 80 || Math.min(d(p3, p1), d(p3, p2)) < 60) return null;
      return [p1, p2, p3];
    });
    expect(spots, 'gantry block faces answer the pin path').not.toBeNull();
    const box = (await page.getByTestId('canvas').boundingBox())!;
    for (const p of spots!) {
      await page.getByTestId('canvas').click({ position: { x: p.x - box.x, y: p.y - box.y } });
    }
    await expect.poll(async () => (await trisOf()).length, { timeout: 5000 }).toBe(n0 + 2);
    const norm = (cs: number[][]) =>
      JSON.stringify([...cs].sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!));
    const all = await trisOf();
    const orig = all[all.length - 2]!, twin = all[all.length - 1]!;
    // the twin's corner SET = the x-reflection (g → 12 − g) of the original's
    expect(norm(twin)).toEqual(norm(orig.map(g => [12 - g[0]!, g[1]!, g[2]!])));
  });

  test('widget ▵ turns the SELECTED BLOCK into hull triangles (+ Undo)', async ({ page }) => {
    // we: "Button should exist to turn block to triangle when selecting a
    // block, on its widget."
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await open(page);
    await page.getByTestId('ws-edit').click();
    await page.getByTestId('mirw-off').click();                  // no twin: one block
    const spot = await faceSpot(page);
    expect(spot, 'a block face answers').not.toBeNull();
    const box = (await page.getByTestId('canvas').boundingBox())!;
    await page.getByTestId('canvas').click({
      position: { x: box.width * spot!.x, y: box.height * spot!.y } });
    await expect(page.getByTestId('mode-tris'), 'the ▵ row shows on a block-owned widget')
      .toBeVisible();
    const counts = () => page.evaluate(() => {
      const w = window as unknown as { __ARCHEAN__?: { engine: { blueprint: {
        data: { blocks: { type: number }[]; triangles?: unknown[] } } } } };
      const b = w.__ARCHEAN__!.engine.blueprint.data.blocks;
      return [b.filter(x => x.type !== 255).length,
        (w.__ARCHEAN__!.engine.blueprint.data.triangles ?? []).length];
    });
    const [b0, t0] = await counts();
    await page.getByTestId('mode-tris').click();
    await expect.poll(async () => (await counts())[0], { timeout: 5000 }).toBe(b0 - 1);
    await expect.poll(async () => (await counts())[1], { timeout: 5000 })
      .toBeGreaterThanOrEqual(t0 + 6);                           // ≥ 3 free faces
    // one Ctrl+Z: the block is back, the skin triangles are gone
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await counts()).join(), { timeout: 5000 })
      .toBe(`${b0},${t0}`);
  });

  // RETIRED v1.12.5 (L5): the MIRROR widget axis/glyph/aria-pressed/localStorage
  // (archean-app-plsym) transitions run on the Editor DOM tier (editor.dom.test.tsx,
  // gantry with craftMirrorAxes ['x'] — auto-lit, ONE LINGO lit-plane toggle).

  // RETIRED v1.12.5 (L5): the num-size rows → [9,9,9] square law runs on the Editor
  // DOM tier (editor.dom.test.tsx); the setBlockField cap itself is vitest-pinned
  // (blocks.test.ts SQUARE-BLOCK FIX).
});

test.describe('build-dock: phone placement @ui', () => {
  // v1.11: the flavor switch + TAP hints live in the DOCK HEADER, the brush
  // has NO size UI (steppers GONE with the pre-placement sizing), and the
  // drawer stays narrow — a phone TAP lands one cell, the widget stretches.
  test('the dock header carries the mode switch + mirror widget; the dock fits phone', async ({ page }) => {
    await open(page);
    // the switch is in the dock header — visible with the drawer never opened
    await expect(page.getByTestId('ws-blocks')).toBeVisible();
    await expect(page.getByTestId('ws-edit')).toBeVisible();
    // v1.11: no size UI anywhere on phone either
    await expect(page.getByTestId('brush-step-z-p')).toHaveCount(0);
    await expect(page.getByTestId('mirror-widget')).toBeVisible();
    // v1.11 NO DRAWER: the bottom dock spans the viewport and the canvas
    // keeps the full width above it
    const vp = page.viewportSize()!;
    if (vp.width < 768) {
      const dock = page.getByTestId('build-dock');
      await expect(dock).toBeVisible();
      const w = (await dock.boundingBox())!.width;
      expect(w / vp.width, 'the dock spans the phone width (canvas keeps the height above)').toBeLessThanOrEqual(1.02);
    }
    // PLACE flavor: the hint tells the touch user what to do (no key names)
    await page.getByTestId('ws-blocks').click();
    const hint = page.getByTestId('flavor-hint');
    await expect(hint).toBeVisible();
    if (vp.width < 768) await expect(hint).toContainText('TAP');
    // a TAP on a surface places ONE cell (the touch placement path)
    const n0 = await page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { stats: () => { blocks: number } } }).__ARCHEAN__!.stats().blocks);
    const spot = await faceSpot(page);
    expect(spot, 'a block face answers the tap path').not.toBeNull();
    const box = (await page.getByTestId('canvas').boundingBox())!;
    await page.getByTestId('canvas').click({
      position: { x: box.width * spot!.x, y: box.height * spot!.y } });
    await expect.poll(() => page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { stats: () => { blocks: number } } }).__ARCHEAN__!.stats().blocks),
    { timeout: 5000 }).toBeGreaterThan(n0);
  });
});

test.describe('build-dock: triangle PIN placement @ui', () => {
  // v1.11 (we: "putting down three points … move them around before and
  // after placing all three … look like a pin, and an arrow … for the
  // direction of the triangle, just like in-game"): the canvas drops pins
  // on lattice corners, the third click commits, the pins + arrow STAY.
  test('three clicks land a triangle; the pins + direction arrow stay on it', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await open(page);
    await page.getByTestId('ws-tris').click();
    await page.getByTestId('mirw-off').click();                  // single-triangle pins
    const tris = () => page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { engine: { blueprint: { data: { triangles?: unknown[] } } } } })
      .__ARCHEAN__!.engine.blueprint.data.triangles?.length ?? 0);
    const n0 = await tris();
    // drop three pins on well-SPREAD deck points (>= 0.5 m apart so the
    // snapped corners are distinct; the third click commits)
    const spots = await page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      const r = c.getBoundingClientRect();
      const e = (window as unknown as { __ARCHEAN__?: { engine: { pendingReal: number;
        pickCell: (x: number, y: number) => { bi: number } | null } } }).__ARCHEAN__!.engine;
      if (e.pendingReal > 0) return null;
      const pts: { x: number; y: number }[] = [];
      for (let fy = 0.25; fy <= 0.9; fy += 0.03)
        for (let fx = 0.15; fx <= 0.85; fx += 0.03) {
          const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
          if (h && h.bi >= 0) pts.push({ x: r.left + r.width * fx, y: r.top + r.height * fy });
        }
      if (!pts.length) return null;
      const d = (a: { x: number; y: number }, b: { x: number; y: number }) =>
        Math.hypot(a.x - b.x, a.y - b.y);
      const p1 = pts[0]!;
      const p2 = pts.reduce((m, p) => (d(p, p1) > d(m, p1) ? p : m), p1);
      const p3 = pts.reduce((m, p) => (Math.min(d(p, p1), d(p, p2)) >
        Math.min(d(m, p1), d(m, p2)) ? p : m), p1);
      if (d(p1, p2) < 80 || Math.min(d(p3, p1), d(p3, p2)) < 60) return null;
      return [p1, p2, p3];
    });
    expect(spots, 'the deck answers the pin path with three spread spots').not.toBeNull();
    const box = (await page.getByTestId('canvas').boundingBox())!;
    for (const p of spots!) {
      await page.getByTestId('canvas').click({ position: { x: p.x - box.x, y: p.y - box.y } });
    }
    await expect.poll(tris, { timeout: 5000 }).toBe(n0 + 1);
    // the pins are EDITING the committed triangle, with a direction arrow
    const pins = () => page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { pins: () => { mode: string; pts: number[][]; ti: number;
        arrow: [number, number, number] | null } | null } }).__ARCHEAN__!.pins());
    await expect.poll(pins, { timeout: 5000 }).toMatchObject({
      mode: 'edit', ti: n0,
    });
    const st = (await pins())!;
    expect(st.pts.length).toBe(3);
    expect(st.arrow).not.toBeNull();               // the up/down direction tell
    // a pin DRAG rewrites its corner (the "after placing" path): aim the
    // pin head, pull it to a new deck spot, the stored corner follows.
    // Let the COMMIT's 450 ms snapshot group close first, so the drag is
    // its OWN undo step (the ritual's one-drag-one-step law).
    await page.waitForTimeout(600);
    const corners = () => page.evaluate((i) => {
      const w = window as unknown as {
        __ARCHEAN__?: { engine: { blueprint: { data: { triangles?: Record<string, number>[] } } } };
      };
      const arr = w.__ARCHEAN__!.engine.blueprint.data.triangles ?? [];
      const t = arr[+i];
      if (!t) return null;
      return [0, 1, 2].map(vi => [0, 1, 2].map(ai => {
        const name = 'xyz'[ai]!;
        return t[`v${vi}_${name}`]! + 12 * t[`frame_${name}`]!;
      }));
    }, n0);
    const before = await corners();
    expect(before).not.toBeNull();
    const head = await page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { pinPoint: (i: number) => { x: number; y: number } | null }
      }).__ARCHEAN__!.pinPoint(0));
    expect(head).not.toBeNull();
    const target = await page.evaluate((h: { x: number; y: number }) => {
      const c = document.querySelector('canvas')!;
      const r = c.getBoundingClientRect();
      const e = (window as unknown as { __ARCHEAN__?: { engine: {
        pickCell: (x: number, y: number) => { bi: number } | null } } }).__ARCHEAN__!.engine;
      for (let fy = 0.25; fy <= 0.9; fy += 0.03)
        for (let fx = 0.15; fx <= 0.85; fx += 0.03) {
          const h0 = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
          if (h0 && h0.bi >= 0) {
            const p = { x: r.left + r.width * fx, y: r.top + r.height * fy };
            if (Math.hypot(p.x - h.x, p.y - h.y) > 40) return p;
          }
        }
      return null;
    }, head!);
    expect(target, 'a spot ≥ 40 px from the pin head answers the drag').not.toBeNull();
    await page.mouse.move(head!.x, head!.y);
    await page.mouse.down();
    await page.mouse.move(target!.x, target!.y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(corners, { timeout: 5000 }).not.toEqual(before);
    // one Ctrl+Z: the whole drag is ONE history step
    await page.keyboard.press('Control+z');
    await expect.poll(corners, { timeout: 5000 }).toEqual(before);
  });

  test('a LIST row puts the pins + the CENTROID widget on a triangle; ✥ moves it wholesale, ⟳ rotates', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await open(page, '3732302108');                        // the gantry: authored skin
    await page.getByTestId('ws-edit').click();             // the widget is an EDIT-mode tool
    // v1.11 dock law: Modify opens EMPTY — the TRI LIST rides the triangle
    // panel, which a canvas prism click reveals. Select through the shipped
    // triPick-probed canvas click, THEN the list row (the pin ritual).
    const sel = await page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      const r = c.getBoundingClientRect();
      const w = (window as unknown as { __ARCHEAN__?: {
        triPick: (x: number, y: number) => { t: number } | null } }).__ARCHEAN__!;
      for (let fy = 0.2; fy <= 0.9; fy += 0.02)
        for (let fx = 0.15; fx <= 0.85; fx += 0.02) {
          const t = w.triPick(r.left + r.width * fx, r.top + r.height * fy);
          if (t && t.t >= 0) return { x: r.left + r.width * fx, y: r.top + r.height * fy, t: t.t };
        }
      return null;
    });
    expect(sel, 'a prism face answers the merged pick').not.toBeNull();
    await page.mouse.click(sel!.x, sel!.y);
    // the merged pick SELECTS the prism — the TRI panel + its list ride in
    // the dock. The 241-row gantry list VIRTUALISES (~150 rows mounted):
    // filter to the picked index through the shipped search box first.
    await expect(page.getByTestId('tri-edit')).toContainText(`Triangle[${sel!.t}]`,
      { timeout: 5000 });
    await page.getByTestId('tri-list-search').fill(String(sel!.t));
    const row = page.getByTestId(`tri-row-${sel!.t}`);
    await expect(row).toBeVisible();
    const idx = sel!.t;
    await row.click();
    const pins = () => page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { pins: () => { mode: string; ti: number; pts: number[][] } | null } }).__ARCHEAN__!.pins());
    await expect.poll(pins, { timeout: 5000 }).toMatchObject({ mode: 'edit', ti: idx });
    expect(((await pins())!).pts.length).toBe(3);
    // the CENTROID widget: the same grab-onto TransformControls a block wears
    const giz = () => page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { triGizmo: () => { ti: number; mode: string; shown: boolean } | null } })
      .__ARCHEAN__!.triGizmo());
    await expect.poll(giz, { timeout: 5000 }).toMatchObject({ ti: idx, shown: true });
    const corners = () => page.evaluate((i) => {
      const w = window as unknown as {
        __ARCHEAN__?: { engine: { blueprint: { data: { triangles: Record<string, number>[] } } } };
      };
      const t = w.__ARCHEAN__!.engine.blueprint.data.triangles[+i]!;
      return [0, 1, 2].map(vi => [0, 1, 2].map(ai => {
        const name = 'xyz'[ai]!;
        return t[`v${vi}_${name}`]! + 12 * t[`frame_${name}`]!;
      }));
    }, idx);
    const before = await corners();
    // ✥ MOVE WHOLESALE: all three corners ride the same whole-cell delta…
    const moved = await page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { triShift: (d: [number, number, number]) => boolean } })
      .__ARCHEAN__!.triShift([2, 0, -2]));
    expect(moved, 'a whole-cell move commits').toBe(true);
    const mid = await corners();
    for (const [vi, c] of mid.entries())
      expect(c).toEqual([before[vi]![0] + 2, before[vi]![1], before[vi]![2] - 2]);
    // …and a no-op move is accepted trivially
    expect(await page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { triShift: (d: [number, number, number]) => boolean } })
      .__ARCHEAN__!.triShift([0, 0, 0]))).toBe(true);
    // ⟳ ROTATE about the triangle's centroid, lattice-quantised: corners
    // move, one Ctrl+Z brings the record back (one history step)
    await page.waitForTimeout(600);                        // separate undo group
    const rotated = await page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { triRotate: (a: 'x' | 'y' | 'z', d: number) => boolean } })
      .__ARCHEAN__!.triRotate('y', 90));
    expect(rotated, 'a 90° turn commits').toBe(true);
    await expect.poll(corners, { timeout: 5000 }).not.toEqual(mid);
    await page.keyboard.press('Control+z');
    await expect.poll(corners, { timeout: 5000 }).toEqual(mid);
    await page.keyboard.press('Control+z');
    await expect.poll(corners, { timeout: 5000 }).toEqual(before);
    // Esc leaves the pins — and the centroid widget leaves WITH them
    await page.keyboard.press('Escape');
    await expect.poll(pins, { timeout: 5000 }).toBeNull();
    await expect.poll(giz, { timeout: 5000 }).toBeNull();
  });

  test('pin drags are FREE 3D — screen-plane drag moves world Y, ⇧ locks one axis', async ({ page }) => {
    // v1.11 (we: "I cannot move the pins in 3 dimenensions"): the old drag
    // raycast at scene surfaces, so a pin could only slide over geometry.
    // The plane drag rides the CAMERA-FACING plane through the pin (screen
    // drag = 3D placement; orbit changes depth), ⇧ locks to the world axis
    // most facing the camera.
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await open(page);
    await page.getByTestId('ws-tris').click();
    await page.getByTestId('mirw-off').click();                  // single-triangle pins
    const spots = await page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      const r = c.getBoundingClientRect();
      const e = (window as unknown as { __ARCHEAN__?: { engine: { pendingReal: number;
        pickCell: (x: number, y: number) => { bi: number } | null } } }).__ARCHEAN__!.engine;
      if (e.pendingReal > 0) return null;
      const pts: { x: number; y: number }[] = [];
      for (let fy = 0.25; fy <= 0.9; fy += 0.03)
        for (let fx = 0.15; fx <= 0.85; fx += 0.03) {
          const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
          if (h && h.bi >= 0) pts.push({ x: r.left + r.width * fx, y: r.top + r.height * fy });
        }
      if (!pts.length) return null;
      const d = (a: { x: number; y: number }, b: { x: number; y: number }) =>
        Math.hypot(a.x - b.x, a.y - b.y);
      const p1 = pts[0]!;
      const p2 = pts.reduce((m, p) => (d(p, p1) > d(m, p1) ? p : m), p1);
      const p3 = pts.reduce((m, p) => (Math.min(d(p, p1), d(p, p2)) >
        Math.min(d(m, p1), d(m, p2)) ? p : m), p1);
      if (d(p1, p2) < 80 || Math.min(d(p3, p1), d(p3, p2)) < 60) return null;
      return [p1, p2, p3];
    });
    expect(spots, 'the deck answers the pin path').not.toBeNull();
    const box = (await page.getByTestId('canvas').boundingBox())!;
    for (const p of spots!) {
      await page.getByTestId('canvas').click({ position: { x: p.x - box.x, y: p.y - box.y } });
    }
    const corners = () => page.evaluate(() => {
      const w = window as unknown as {
        __ARCHEAN__?: { engine: { blueprint: { data: { triangles?: Record<string, number>[] } } } };
      };
      const arr = w.__ARCHEAN__!.engine.blueprint.data.triangles ?? [];
      const t = arr[arr.length - 1];
      if (!t) return null;
      return [0, 1, 2].map(vi => [0, 1, 2].map(ai => {
        const name = 'xyz'[ai]!;
        return t[`v${vi}_${name}`]! + 12 * t[`frame_${name}`]!;
      }));
    });
    await expect.poll(corners, { timeout: 5000 }).not.toBeNull();
    await page.waitForTimeout(600);
    // A straight screen-UP drag (camera-facing plane) moves the corner's
    // world Y — the drag is NOT surface-bound.
    const b1 = (await corners())!;
    const head = await page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { pinPoint: (i: number) => { x: number; y: number } | null } })
      .__ARCHEAN__!.pinPoint(1));
    expect(head).not.toBeNull();
    await page.mouse.move(head!.x, head!.y);
    await page.mouse.down();
    await page.mouse.move(head!.x, head!.y - 150, { steps: 6 });
    await page.mouse.up();
    await expect.poll(corners, { timeout: 5000 }).not.toEqual(b1);
    const m1 = (await corners())!;
    expect(m1[1]![1], 'a screen-vertical drag carries world Y (3D, not surface-bound)')
      .not.toBe(b1[1]![1]);
    await page.waitForTimeout(600);
    // ⇧ AXIS LOCK: dragging along the on-screen projection of the axis the
    // camera most faces moves EXACTLY that axis.
    const lock = await page.evaluate(() => {
      const w = (window as unknown as { __ARCHEAN__?: {
        engine: { viewState: () => { eye: [number, number, number]; target: [number, number, number] };
          screenPoint: (x: number, y: number, z: number) => [number, number] | null };
        pins: () => { pts: number[][] } | null } }).__ARCHEAN__!;
      const v = w.engine.viewState();
      const d = [v.target[0] - v.eye[0], v.target[1] - v.eye[1], v.target[2] - v.eye[2]];
      let ai = 0;
      for (let k = 1; k < 3; k++) if (Math.abs(d[k]!) > Math.abs(d[ai]!)) ai = k;
      const A = [[1, 0, 0], [0, 1, 0], [0, 0, 1]][ai]!;
      const g = w.pins()!.pts[1]!;
      const f = g.map(x => (x - 6) * 0.25) as [number, number, number];
      const s1 = w.engine.screenPoint(f[0], f[1], f[2]);
      const s2 = w.engine.screenPoint(f[0] + A[0] * 2, f[1] + A[1] * 2, f[2] + A[2] * 2);
      if (!s1 || !s2) return null;
      const dx = s2[0] - s1[0], dy = s2[1] - s1[1];
      const l = Math.hypot(dx, dy) || 1;
      return { ai, ux: dx / l, uy: dy / l };
    });
    expect(lock).not.toBeNull();
    const head2 = await page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { pinPoint: (i: number) => { x: number; y: number } | null } })
      .__ARCHEAN__!.pinPoint(1));
    await page.mouse.move(head2!.x, head2!.y);
    await page.mouse.down();
    await page.keyboard.down('Shift');
    await page.mouse.move(head2!.x + lock!.ux * 200, head2!.y + lock!.uy * 200, { steps: 6 });
    await page.keyboard.up('Shift');
    await page.mouse.up();
    await expect.poll(corners, { timeout: 5000 }).not.toEqual(m1);
    const m2 = (await corners())!;
    for (let ax = 0; ax < 3; ax++)
      if (ax !== lock!.ai)
        expect(m2[1]![ax], `axis ${ax} stays locked (only ${'xyz'[lock!.ai]} moves)`).toBe(m1[1]![ax]);
    expect(m2[1]![lock!.ai]).not.toBe(m1[1]![lock!.ai]);
  });

  test('triangle PAINT: the brush card colours NEW prisms, the face rows recolour a selected one', async ({ page }) => {
    // we: "WHEN I PICK A COLOR FOR A TRIANGLE IT DOES NOT APPLY"
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await open(page);
    await page.getByTestId('ws-tris').click();
    await page.getByTestId('mirw-off').click();
    // the picker is VISIBLE in triangles mode and drives new prisms
    await expect(page.getByTestId('tri-brush'), 'the paint card lives in the triangles dock')
      .toBeVisible();
    await page.getByTestId('num-slot').fill('60');
    const spots = await page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      const r = c.getBoundingClientRect();
      const e = (window as unknown as { __ARCHEAN__?: { engine: {
        pickCell: (x: number, y: number) => { bi: number } | null } } }).__ARCHEAN__!.engine;
      const pts: { x: number; y: number }[] = [];
      for (let fy = 0.25; fy <= 0.9; fy += 0.03)
        for (let fx = 0.15; fx <= 0.9; fx += 0.03) {
          const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
          if (h && h.bi >= 0) pts.push({ x: r.left + r.width * fx, y: r.top + r.height * fy });
        }
      if (!pts.length) return null;
      const d = (a: { x: number; y: number }, b: { x: number; y: number }) =>
        Math.hypot(a.x - b.x, a.y - b.y);
      const p1 = pts[0]!;
      const p2 = pts.reduce((m, p) => (d(p, p1) > d(m, p1) ? p : m), p1);
      const p3 = pts.reduce((m, p) => (Math.min(d(p, p1), d(p, p2)) >
        Math.min(d(m, p1), d(m, p2)) ? p : m), p1);
      if (d(p1, p2) < 80 || Math.min(d(p3, p1), d(p3, p2)) < 60) return null;
      return [p1, p2, p3];
    });
    expect(spots).not.toBeNull();
    const box = (await page.getByTestId('canvas').boundingBox())!;
    for (const p of spots!) {
      await page.getByTestId('canvas').click({ position: { x: p.x - box.x, y: p.y - box.y } });
    }
    const lastCols = () => page.evaluate(() => {
      const t = (window as unknown as { __ARCHEAN__?: { engine: { blueprint: {
        data: { triangles?: { colors?: number[] }[] } } } } }).__ARCHEAN__!.engine.blueprint.data.triangles!;
      return [...(t[t.length - 1]?.colors ?? [])];
    });
    await expect.poll(lastCols, { timeout: 5000,
      message: 'the new prism wears the BRUSH slot on all five faces' })
      .toEqual([60, 60, 60, 60, 60]);
    // select it through the shipped panel path: the TRI LIST rides the
    // triangles dock (ws-tris), and a row click selects (onSelectTri →
    // THIS TRIANGLE rows). A canvas pick is NOT used here: this fixture's
    // prism is authored at deck-face level, so the merged pick answers the
    // BLOCK under it (a coplanar skin prism is a gantry-style case).
    await page.keyboard.press('Escape');                    // live pins down
    await expect.poll(async () => (await page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { pins: () => unknown } }).__ARCHEAN__!.pins())))
      .toBeNull();
    const rows = page.getByTestId(/^tri-row-\d+/);
    await expect(rows.first()).toBeVisible();
    await rows.last().click();
    await expect(page.getByTestId('num-front')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('num-front')).toHaveValue('60');
    // THE RITUAL (AGENTS v1.11): edits inside the 450 ms snapshot window
    // coalesce into ONE undo group — every step below must undo SEPARATELY,
    // so the groups are spaced.
    await page.waitForTimeout(600);
    await page.getByTestId('num-front').fill('70');
    await expect.poll(lastCols, { timeout: 5000 })
      .toEqual([70, 60, 60, 60, 60]);
    // ⇄ FLIP (we: "it should be possible to flip it just like the in game
    // triangles, determining whether it goes outside or inside"): the
    // winding reverses — the normal EXACTLY negates, front/back colours swap
    const nrm = () => page.evaluate(() => {
      const arr = (window as unknown as { __ARCHEAN__?: { engine: { blueprint: {
        data: { triangles: Record<string, number>[] } } } } }).__ARCHEAN__!.engine.blueprint.data.triangles;
      const t = arr[arr.length - 1]!;
      const g = (i: number, ai: number) =>
        t[`v${i}_${'xyz'[ai]}`]! + 12 * t[`frame_${'xyz'[ai]}`]!;
      const u = [0, 1, 2].map(ai => g(1, ai) - g(0, ai));
      const w = [0, 1, 2].map(ai => g(2, ai) - g(0, ai));
      return [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    });
    const n0 = await nrm();
    await page.waitForTimeout(600);                        // separate undo group
    await page.getByTestId('tri-flip').click();
    await expect.poll(nrm, { timeout: 5000 }).not.toEqual(n0);
    const n1 = await nrm();
    for (let k = 0; k < 3; k++) expect(n1[k]).toBeCloseTo(-n0[k]!, 9);
    await expect.poll(lastCols, { timeout: 5000 })
      .toEqual([60, 70, 60, 60, 60]);            // front ↔ back followed
    // one Ctrl+Z: the flip (corners + colours) is ONE history step
    await page.keyboard.press('Control+z');
    await expect.poll(lastCols, { timeout: 5000 })
      .toEqual([70, 60, 60, 60, 60]);
    await expect.poll(nrm, { timeout: 5000 }).toEqual(n0);
  });

  // RETIRED v1.12.5 (L5): the FLAVOUR routing (a prism-face click drafts a pin in
  // + Triangles / selects the prism in ✎ Modify — merged pick, triAt-owned centroid)
  // runs on the Editor DOM tier (editor.dom.test.tsx) through the shipped
  // onBlockPick callback. The pin 3-click RITUAL (three clicks land a triangle)
  // above keeps the real-input + engine-pin overlay law.

  // RETIRED v1.12.5 (L5): the twin-pair laws (TODO D mirrored delta + pair
  // flip, TODO E identity face-slot paint, the mirror-conjugate rotate, the
  // v1.11.0 lookup-before-mutation and ATOMIC-clone fixes) are pure record
  // math — engine/pinedit.ts + __tests__/pinedit.test.ts reproduce these
  // exact values (self +2 x / twin −2 x, pair SURVIVES the shift, normals
  // EXACTLY negate, twin wears the slot on the SAME index, refusals write
  // NOTHING to bp AND doc) at the vitest tier.
});

test.describe('build-dock: triangle workspace @ui', () => {
  // RETIRED v1.12.5 (L5): the TRI LIST row select, the ±cell move round-trip on the
  // GLOBAL corners (writer-style (frame, v) re-normalisation) and the honest
  // 'refused' window message run on the Editor DOM tier (editor.dom.test.tsx); the
  // underlying setTriCorner/shiftTriCells refusals are vitest-pinned (tris.test.ts).
});
