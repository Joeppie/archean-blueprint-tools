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
  test('the dock shows brush, census, list, edit and the MIRROR widget columns', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await open(page);
    await page.getByTestId('ws-blocks').click();
    for (const t of ['block-brush', 'block-census', 'block-list', 'block-edit',
      'block-list-search', 'mirror-widget', 'mirw-x', 'mirw-y', 'mirw-z', 'mirw-off'])
      await expect(page.getByTestId(t).first(), t).toBeVisible();
    // v1.11: the pre-placement SIZE UI is GONE (choosing a size before
    // placing shouldn't be a thing)
    for (const t of ['brush-square', 'brush-reset', 'brush-step-z-p', 'brush-axis-x', 'brush-chip'])
      await expect(page.getByTestId(t), t).toHaveCount(0);
    expect(await page.getByTestId(/^block-row-\d+/).count())
      .toBe(await bpBlocks(page).then(b => b.length));      // every block listed
  });

  test('list row selects, ✕ deletes, one Ctrl+Z restores', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await open(page);
    // v1.11 dock law: ✎ Modify opens EMPTY (modify-hint) — the BLOCK LIST
    // rides the + Blocks workspace (blockPanel), where rows are always up.
    await page.getByTestId('ws-blocks').click();
    const n0 = (await bpBlocks(page)).length;
    await page.getByTestId(/^block-row-\d+/).first().hover();
    await page.getByTestId(/^block-row-\d+/).first().click();
    await expect(page.getByTestId('block-edit')).toContainText(/Block\[\d+\]/);
    await page.getByTestId(/^block-cut-\d+/).first().click();
    await expect.poll(() => bpBlocks(page).then(b => b.length),
      { timeout: 5000 }).toBeLessThan(n0);
    await page.keyboard.press('Control+z');
    await expect.poll(() => bpBlocks(page).then(b => b.length),
      { timeout: 5000 }).toBe(n0);
  });

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

  test('the MIRROR widget switches the axis live — GLYPH chips (plane+triangle, strikethrough off)', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await open(page, '3732302108');                            // mirrored: the arm auto-lights
    const mir = () => page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { mirAxis: () => string } }).__ARCHEAN__!.mirAxis());
    await expect.poll(mir).toBe('x');                         // default
    // v1.11 (we: "the mirror option is not understandable, it should be
    // visually understood, add a mirror icon with a strikethrough, and x y z
    // also with mirror behind it"): every chip carries the mirror GLYPH (an
    // SVG plane + solid triangle + reflected ghost); the off chip wears the
    // red strike line; the axis chips wear the glyph behind the letter.
    await expect(page.locator('[data-testid="mirw-off"] [data-g="mirror-off"]')).toBeVisible();
    await expect(page.locator('[data-testid="mirw-off"] [data-g="mirror-strike"]')).toBeVisible();
    for (const a of ['x', 'y', 'z']) {
      await expect(page.locator(`[data-testid="mirw-${a}"] [data-g="mirror"]`), a).toBeVisible();
      await expect(page.getByTestId(`mirw-${a}`)).toContainText(a);
    }
    await page.getByTestId('mirw-z').click();
    await expect.poll(mir).toBe('z');
    await page.getByTestId('mirw-off').click();
    await expect.poll(mir).toBe('off');
    await page.getByTestId('mirw-x').click();
    await expect.poll(mir).toBe('x');
    // v1.11 ONE LINGO: the lit x chip IS the state — clicking the lit plane
    // stops pairing, clicking again re-arms it (explicit, persisted 1)
    await expect(page.getByTestId('mirw-x')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('mirw-x').click();
    await expect(page.getByTestId('mirw-x')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('mirw-x').click();
    await expect(page.getByTestId('mirw-x')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => localStorage.getItem('archean-app-plsym'))).toBe('1');
  });

  test('SQUARE FIX: a block grows to a 10×10×10 square (frame borders do not cap)', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await open(page);
    // v1.11 dock law: the block list + THIS BLOCK rows live in + Blocks
    await page.getByTestId('ws-blocks').click();
    await page.getByTestId(/^block-row-\d+/).first().click();
    await expect(page.getByTestId('block-edit')).toContainText(/Block\[\d+\]/);
    const sel = () => page.evaluate(() => {
      const w = window as unknown as {
        __ARCHEAN__?: { engine: { blueprint: { data: { blocks: { size_x: number; size_y: number; size_z: number }[] } } } };
      };
      const t = document.querySelector('[data-testid="block-edit"]')?.textContent ?? '';
      const m = t.match(/Block\[(\d+)\]/);
      if (!m) return null;
      const b = w.__ARCHEAN__!.engine.blueprint.data.blocks[+m[1]!];
      return b ? [b.size_x, b.size_y, b.size_z] : null;
    });
    for (const ax of ['x', 'y', 'z'])
      await page.getByTestId(`num-size ${ax}`).fill('9');
    await expect.poll(sel, { timeout: 5000 }).toEqual([9, 9, 9]);   // square
  });
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

  test('mode law: TRIANGLES mode only DROPS PINS, EDIT selects the prism (merged pick)', async ({ page }) => {
    // v1.11 (we: "nor does it respect my place/edit mode. This is wrong.")
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await open(page, '3732302108');                        // the gantry: authored skin
    await page.getByTestId('ws-tris').click();
    const px = await page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      const r = c.getBoundingClientRect();
      const w = (window as unknown as { __ARCHEAN__?: {
        triPick: (x: number, y: number) => { t: number } | null } }).__ARCHEAN__!;
      for (let fy = 0.2; fy <= 0.9; fy += 0.02)
        for (let fx = 0.15; fx <= 0.85; fx += 0.02) {
          const t = w.triPick(r.left + r.width * fx, r.top + r.height * fy);
          if (t && t.t >= 0) return { x: r.left + r.width * fx, y: r.top + r.height * fy };
        }
      return null;
    });
    expect(px, 'a prism face answers the probe').not.toBeNull();
    const box = (await page.getByTestId('canvas').boundingBox())!;
    const clickPx = () => page.getByTestId('canvas').click({
      position: { x: px!.x - box.x, y: px!.y - box.y } });
    const pins = () => page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { pins: () => { mode: string; pts: number[][] } | null } }).__ARCHEAN__!.pins());
    const triHl = () => page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { triHl: () => number } }).__ARCHEAN__!.triHl());
    // ▵ TRIANGLES mode: the prism-face click DROPS A PIN — selects NOTHING
    await page.getByTestId('ws-tris').click();
    await clickPx();
    await expect.poll(async () => { const s = await pins(); return s && `${s.mode}:${s.pts.length}`; },
      { timeout: 5000 }).toBe('draft:1');
    expect(await triHl(), 'placement never selects').toBe(-1);
    await page.keyboard.press('Escape');
    await expect.poll(pins, { timeout: 5000 }).toBeNull();
    // ✎ EDIT: the SAME pixel click SELECTS the prism (merged pick) and the
    // pins + centroid widget land on it
    await page.getByTestId('ws-edit').click();
    await clickPx();
    await expect.poll(triHl, { timeout: 5000 }).toBeGreaterThanOrEqual(0);
    await expect.poll(async () => { const s = await pins(); return s?.mode; },
      { timeout: 5000 }).toBe('edit');
    await expect.poll(() => page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { triGizmo: () => { ti: number } | null } }).__ARCHEAN__!.triGizmo()),
    { timeout: 5000 }).not.toBeNull();
  });

  // v1.11 UNPINNED-TODO pins D + E (AGENTS): the UNIFORM MIRROR RULE for
  // prisms, on a craft whose skin auto-twins (the gantry is x-mirrored).
  // Every prism edit drives the corner-SET twin (triTwinIndex — winding-
  // agnostic): the wholesale shift sends the twin the MIRRORED delta, the
  // FLIP flips the pair, the PAINT maps face slots by identity. (The LIST
  // -row test above asserts SELF corners only — that gap was TODO D.)
  const cornersOf = (page: Page, i: number) => page.evaluate((idx) => {
    const t = (window as unknown as { __ARCHEAN__?: { engine: { blueprint: {
      data: { triangles: Record<string, number>[] } } } } }).__ARCHEAN__!.engine
      .blueprint.data.triangles[idx]!;
    return [0, 1, 2].map(vi => [0, 1, 2].map(ai =>
      t[`v${vi}_${'xyz'[ai]}`]! + 12 * t[`frame_${'xyz'[ai]}`]!));
  }, i);
  const normalOf = (page: Page, i: number) => cornersOf(page, i).then(c => {
    const u = [0, 1, 2].map(a => c[1]![a]! - c[0]![a]!);
    const w = [0, 1, 2].map(a => c[2]![a]! - c[0]![a]!);
    return [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!,
      u[0]! * w[1]! - u[1]! * w[0]!];
  });
  /** a canvas pixel whose merged pick SELECTS triangle ti — and the prism
   *  must be the FRONT owner (triPick answers the geometric triAt owner at
   *  the hit point, which sees through parts standing behind them) */
  const triPixel = (page: Page, ti: number) => page.evaluate((t0) => {
    const c = document.querySelector('canvas')!;
    const r = c.getBoundingClientRect();
    const w = (window as unknown as { __ARCHEAN__?: {
      triPick: (x: number, y: number) => { t: number; kind?: string } | null } }).__ARCHEAN__!;
    for (let step = 0.02; step >= 0.008; step -= 0.004)
      for (let fy = 0.2; fy <= 0.9; fy += step)
        for (let fx = 0.15; fx <= 0.85; fx += step) {
          const t = w.triPick(r.left + r.width * fx, r.top + r.height * fy);
          if (t && t.t === t0 && (t.kind === undefined || t.kind === 'tri'))
            return { x: r.left + r.width * fx, y: r.top + r.height * fy };
        }
    return null;
  }, ti);

  test('twin prism pair: the wholesale shift sends the TWIN the MIRRORED delta; the FLIP flips the pair (TODO D)', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    test.setTimeout(120_000);
    // THE FIXTURE: a freshly PLACED mirror pair (the pin flow with the x
    // plane armed lands [tri, twin] as TWO DETACHED prisms on the deck —
    // fat faces, big window headroom, no welds into a skin mesh; the
    // gantry's authored skin is a welded lattice and shifting one record
    // there tears the shared slots — wrong fixture for a delta law).
    await open(page, '9000005001');
    await page.getByTestId('ws-tris').click();
    const chip = page.getByTestId('mirw-x');
    if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click();
    const tris = () => page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { engine: { blueprint: { data: { triangles?: unknown[] } } } } })
      .__ARCHEAN__!.engine.blueprint.data.triangles?.length ?? 0);
    const n0 = await tris();
    // Pin spots hugging the x = 0 mirror plane (|x| ≤ 0.8 m): a pair placed
    // off-centre lands the twin's x-vertices at the window edge (12 − g),
    // and a ±2 push there is REFUSED by the 32-slot window law (silent
    // twin no-op). Centre-hugging pins keep both records' x-headroom ≥ 2.
    const spots = await page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      const r = c.getBoundingClientRect();
      const e = (window as unknown as { __ARCHEAN__?: { engine: {
        pickCell: (x: number, y: number) => { bi: number; point?: [number, number, number] } | null } } }).__ARCHEAN__!.engine;
      const pts: { x: number; y: number }[] = [];
      for (let fy = 0.3; fy <= 0.85; fy += 0.02)
        for (let fx = 0.25; fx <= 0.75; fx += 0.02) {
          const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
          if (h && h.bi >= 0 && h.point && Math.abs(h.point[0]) <= 0.8)
            pts.push({ x: r.left + r.width * fx, y: r.top + r.height * fy });
        }
      if (pts.length < 3) return null;
      const d = (a: { x: number; y: number }, b: { x: number; y: number }) =>
        Math.hypot(a.x - b.x, a.y - b.y);
      const p1 = pts[0]!;
      const p2 = pts.reduce((m, p) => (d(p, p1) > d(m, p1) ? p : m), p1);
      const p3 = pts.reduce((m, p) => (Math.min(d(p, p1), d(p, p2)) >
        Math.min(d(m, p1), d(m, p2)) ? p : m), p1);
      if (d(p1, p2) < 80 || Math.min(d(p3, p1), d(p3, p2)) < 60) return null;
      return [p1, p2, p3];
    });
    expect(spots, 'the deck answers the pin path with three centre-hugging spread spots').not.toBeNull();
    for (const s of spots!) { await page.mouse.click(s.x, s.y); await page.waitForTimeout(120); }
    await expect.poll(tris, { timeout: 5000,
      message: 'the pair lands: self + mirrored twin' }).toBe(n0 + 2);
    const [ti, tw] = [n0, n0 + 1];                  // batch order [tri, twin]
    await page.keyboard.press('Escape');            // live pins down
    await page.getByTestId('ws-edit').click();
    const px = await triPixel(page, ti);
    expect(px, `a pixel answers the placed prism ${ti}`).not.toBeNull();
    await page.mouse.click(px!.x, px!.y);
    await expect.poll(async () => (await page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { triGizmo: () => { ti: number } | null } }).__ARCHEAN__!.triGizmo()))?.ti,
      { timeout: 5000 }).toBe(ti);
    const s0 = await cornersOf(page, ti);
    const t0 = await cornersOf(page, tw);
    await page.waitForTimeout(600);                        // own undo group
    expect(await page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { triShift: (d: [number, number, number]) => boolean } })
      .__ARCHEAN__!.triShift([2, 0, 0])), 'the wholesale move commits').toBe(true);
    const s1 = await cornersOf(page, ti);
    const t1 = await cornersOf(page, tw);
    for (const [vi, c] of s1.entries())
      expect(c, `self corner ${vi}`).toEqual([s0[vi]![0]! + 2, s0[vi]![1]!, s0[vi]![2]!]);
    for (const [vi, c] of t1.entries())
      // THE UNIFORM MIRROR RULE: the delta's MIRROR-NORMAL (x) component
      // FLIPS for the twin (a mirrored pair's x-extents are mirror images,
      // so only an x-fitting delta survives both records' vertex windows —
      // a refused twin shift is a silent no-op by the window law).
      expect(c, `twin corner ${vi}`).toEqual([t0[vi]![0]! - 2, t0[vi]![1]!, t0[vi]![2]!]);
    await page.keyboard.press('Control+z');
    await expect.poll(() => cornersOf(page, ti), { timeout: 5000 }).toEqual(s0);
    await expect.poll(() => cornersOf(page, tw), { timeout: 5000 }).toEqual(t0);
    // THE FLIP is pair-wide (v1.11 (9b)): winding reverses on SELF and the
    // twin — both normals negate — and ONE Ctrl+Z restores BOTH.
    await page.mouse.click(px!.x, px!.y);                  // selection rides the undo
    await expect(page.getByTestId('tri-flip')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(600);                        // separate undo group
    const sn0 = await normalOf(page, ti);
    const tn0 = await normalOf(page, tw);
    await page.getByTestId('tri-flip').click();
    const sn1 = await normalOf(page, ti);
    const tn1 = await normalOf(page, tw);
    for (let k = 0; k < 3; k++) {
      expect(sn1[k]).toBeCloseTo(-sn0[k]!, 9);
      expect(tn1[k], 'the twin FLIPPED with its self').toBeCloseTo(-tn0[k]!, 9);
    }
    await page.keyboard.press('Control+z');
    await expect.poll(() => normalOf(page, ti), { timeout: 5000 }).toEqual(sn0);
    await expect.poll(() => normalOf(page, tw), { timeout: 5000 }).toEqual(tn0);
  });

  test('twin-aware prism PAINT: the twin record wears the SAME face slot (TODO E)', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    test.setTimeout(120_000);
    // Same fixture as TODO D: a freshly placed mirror pair (detached,
    // deck-centre) — the gantry skin's welded records are the wrong body
    // for face-slot arithmetic.
    await open(page, '9000005001');
    await page.getByTestId('ws-tris').click();
    const chip = page.getByTestId('mirw-x');
    if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click();
    const tris = () => page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { engine: { blueprint: { data: { triangles?: unknown[] } } } } })
      .__ARCHEAN__!.engine.blueprint.data.triangles?.length ?? 0);
    const n0 = await tris();
    const spots = await page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      const r = c.getBoundingClientRect();
      const e = (window as unknown as { __ARCHEAN__?: { engine: {
        pickCell: (x: number, y: number) => { bi: number } | null } } }).__ARCHEAN__!.engine;
      const pts: { x: number; y: number }[] = [];
      for (let fy = 0.3; fy <= 0.85; fy += 0.03)
        for (let fx = 0.3; fx <= 0.7; fx += 0.03) {
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
    for (const s of spots!) { await page.mouse.click(s.x, s.y); await page.waitForTimeout(120); }
    await expect.poll(tris, { timeout: 5000 }).toBe(n0 + 2);
    const [ti, tw] = [n0, n0 + 1];
    await page.keyboard.press('Escape');
    await page.getByTestId('ws-edit').click();
    const px = await triPixel(page, ti);
    expect(px, `a pixel answers the placed prism ${ti}`).not.toBeNull();
    await page.mouse.click(px!.x, px!.y);
    const front = page.getByTestId('num-front');
    await expect(front, 'the merged pick revealed THIS TRIANGLE').toBeVisible({ timeout: 5000 });
    const cols = (i: number) => page.evaluate((idx) =>
      [...((window as unknown as { __ARCHEAN__?: { engine: { blueprint: { data: {
        triangles: { colors?: number[] }[] } } } } }).__ARCHEAN__!.engine
        .blueprint.data.triangles[idx]!.colors ?? [])], i);
    await page.waitForTimeout(600);                        // own undo group
    await front.fill('70');
    await expect.poll(() => cols(ti), { timeout: 5000 })
      .toEqual(expect.arrayContaining([70]));
    // THE IDENTITY FACE MAPPING (v1.8.0 uniform rule re-pin on a placed
    // pair): a mirrored prism's face f is its own front/back/wall (the
    // construction colour swap built it so) — the twin wears the slot on
    // the SAME index.
    await expect.poll(async () => (await cols(tw))[0], { timeout: 5000 }).toBe(70);
    expect((await cols(tw))[0]).toBe((await cols(ti))[0]);
  });
});

test.describe('build-dock: triangle workspace @ui', () => {
  test('tri list selects, ±cell move round-trips, window refusal is honest', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await open(page, '3732302108');                        // the gantry: authored skin
    await page.getByTestId('ws-tris').click();
    await expect(page.getByTestId('tri-list')).toBeVisible();
    const row = page.getByTestId(/^tri-row-\d+/).first();
    await expect(row).toBeVisible();
    const idx = (await row.getAttribute('data-testid'))!.replace('tri-row-', '');
    await row.click();
    await expect(page.getByTestId('tri-edit')).toContainText(`Triangle[${idx}]`);
    // GEOMETRY round-trip (the (frame, v) split re-normalises writer-style
    // after a move — v near 0, like triangleFromCorners — so the raw bytes
    // may differ while the global corners g = v + 12·frame are exact)
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
    await page.getByTestId('tri-move-x-p').click();
    await expect.poll(corners, { timeout: 5000 }).not.toEqual(before);
    await page.getByTestId('tri-move-x-m').click();
    await expect.poll(corners, { timeout: 5000 }).toEqual(before);
    // a corner push out of the frame-aligned vertex window: REFUSED visibly
    const v = page.getByTestId('tri-v0-x');
    await v.fill('-500');
    await expect(page.getByTestId('tri-msg')).toContainText('refused');
  });
});
