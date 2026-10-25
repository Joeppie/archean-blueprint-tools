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
    await page.getByTestId('tooltab-place').click();
    for (const t of ['block-brush', 'block-census', 'block-list', 'block-edit',
      'block-list-search', 'mirror-widget', 'mirror-twin', 'mirw-x', 'mirw-y', 'mirw-z', 'mirw-off'])
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
    await page.getByTestId('tooltab-place').click();
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
    await page.getByTestId('tooltab-edit').click();
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
  });

  test('the MIRROR widget switches the axis live (⊘ x y z)', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await open(page);
    const mir = () => page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { mirAxis: () => string } }).__ARCHEAN__!.mirAxis());
    await expect.poll(mir).toBe('x');                         // default
    await page.getByTestId('mirw-z').click();
    await expect.poll(mir).toBe('z');
    await page.getByTestId('mirw-off').click();
    await expect.poll(mir).toBe('off');
    await page.getByTestId('mirw-x').click();
    await expect.poll(mir).toBe('x');
    // the ⇄ twin arm persists like the old switch (same localStorage key)
    await page.getByTestId('mirror-twin').click();
    await expect(page.getByTestId('mirror-twin')).toContainText('twin ON');
    expect(await page.evaluate(() => localStorage.getItem('archean-app-plsym'))).toBe('1');
  });

  test('SQUARE FIX: a block grows to a 10×10×10 square (frame borders do not cap)', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await open(page);
    await page.getByTestId('tooltab-edit').click();
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
  test('the dock header carries the flavor switch + mirror widget; the drawer is narrow', async ({ page }) => {
    await open(page);
    // the switch is in the dock header — visible with the drawer never opened
    await expect(page.getByTestId('tooltab-place')).toBeVisible();
    await expect(page.getByTestId('tooltab-edit')).toBeVisible();
    // v1.11: no size UI anywhere on phone either
    await expect(page.getByTestId('brush-step-z-p')).toHaveCount(0);
    await expect(page.getByTestId('mirror-widget')).toBeVisible();
    // the drawer (phone): narrow, so the canvas stays usable behind it
    const vp = page.viewportSize()!;
    if (vp.width < 768) {
      await page.getByTestId('toggle-panels').click();
      const w = (await page.getByTestId('panel-aside').boundingBox())!.width;
      expect(w / vp.width, 'the phone drawer leaves real canvas room').toBeLessThanOrEqual(0.72);
      await page.getByTestId('toggle-panels').click();
    }
    // PLACE flavor: the hint tells the touch user what to do (no key names)
    await page.getByTestId('tooltab-place').click();
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
    await page.getByTestId('blocksub-tris').click();
    await page.getByTestId('tooltab-place').click();
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
    await page.getByTestId('blocksub-tris').click();
    const row = page.getByTestId(/^tri-row-\d+/).first();
    await expect(row).toBeVisible();
    const idx = +(await row.getAttribute('data-testid'))!.replace('tri-row-', '');
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
});

test.describe('build-dock: triangle workspace @ui', () => {
  test('tri list selects, ±cell move round-trips, window refusal is honest', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await open(page, '3732302108');                        // the gantry: authored skin
    await page.getByTestId('blocksub-tris').click();
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
