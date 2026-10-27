// blockedit.spec.ts — the BLOCKS ▸ EDIT flavor (v1.4 + v1.5): clicking a
// block SELECTS it with a golden highlight (engine-side state, the block
// analogue of the component outline) AND attaches the BLOCK widget —
// cell-snapped shift arrows + 90°-snap rings (v1.5 user rule: "the gizmo
// doesnt show when selecting blocks … move arrows cell snapped, rotation
// arrows that move in 90° increments"). ⟲ turns the shape IN PLACE (bbox
// centre frozen), ✧ snap reads the neighbour geometry, and a ⇄-placed pair
// IDENTIFIES as similar twins whose edits ALWAYS propagate together
// (mirrored) — v1.7.1: identification AND propagation are unconditional,
// the ⇄ toggle gates only twin PLACEMENT.
import { expect, test, type Page } from '@playwright/test';

/** v1.11 ONE LINGO: the mirror widget's axis chips ARE the toggle — arm
 *  mirrored placement across x deterministically (lit = pairs land). */
async function armMirror(page: Page, want = true) {
  const chip = page.getByTestId('mirw-x');
  const lit = (await chip.getAttribute('aria-pressed')) === 'true';
  if (lit !== want) await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', want ? 'true' : 'false');
}

type Blk = { pos_x: number; pos_y: number; pos_z: number; frame_x?: number; frame_y?: number;
  frame_z?: number; size_x: number; size_y: number; size_z: number; type: number };

const blockAt = (page: Page, bi: number) => page.evaluate((i) => {
  const w = window as unknown as { __ARCHEAN__?: { engine: { blueprint: {
    data: { blocks: Blk[] } } } } };
  const b = w.__ARCHEAN__!.engine.blueprint.data.blocks[i];
  const cell = (p: number, f?: number) => (f ?? 0) * 12 + p;
  return { cx: cell(b.pos_x, b.frame_x), cy: cell(b.pos_y, b.frame_y), cz: cell(b.pos_z, b.frame_z),
    sx: b.size_x, sy: b.size_y, sz: b.size_z, type: b.type };
}, bi);

const highlight = (page: Page) => page.evaluate(() =>
  (window as unknown as { __ARCHEAN__?: { blockHighlight: () => { bi: number; twin: number } | null } }
  ).__ARCHEAN__!.blockHighlight());

/** the live BLOCK-widget state (v1.5): which block owns the gizmo + its cell */
const blockGizmo = (page: Page) => page.evaluate(() =>
  (window as unknown as { __ARCHEAN__?: { blockGizmo: () => {
    bi: number; mode: 'off' | 'translate' | 'rotate'; mirror: boolean;
    cell: [number, number, number]; shown: boolean } | null } }).__ARCHEAN__!.blockGizmo());

/** select a deck block by clicking a block face (EDIT flavor) and return its bi */
async function selectDeckBlock(page: Page, px: { x: number; y: number }): Promise<number> {
  await page.mouse.click(px.x, px.y);
  const hl = await highlight(page);
  expect(hl, 'clicking a deck face selects the block').not.toBeNull();
  return hl!.bi;
}

/** scene rebuild counter — a gizmo commit MUST bump it (v1.5.1: the solid
 *  mesh once kept its old shape because the commit never reloaded the scene) */
const loads = (page: Page) => page.evaluate(() =>
  (window as unknown as { __ARCHEAN__?: { stats: () => { loads: number } } })
    .__ARCHEAN__!.stats().loads);

/** open a NEW craft in BLOCKS mode and return a canvas fraction that
 *  answers a deck block face through engine.pickCell (deterministic probe) */
async function openDeck(page: Page, tab: 'place' | 'edit') {
  await page.goto('/');
  await page.getByTestId('gallery-new').click();
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
  await page.getByTestId('mode-edit').click();
  // v1.11 SINGLE MODE CONTROL: the tooltab-* pair became the ws-* row
  // (AGENTS v1.11 (9)) — the EDIT flavor is ✎ Modify, the PLACE flavor + Blocks
  await page.getByTestId(tab === 'edit' ? 'ws-edit' : 'ws-blocks').click();
  let click: { x: number; y: number } | null = null;
  for (let i = 0; i < 40 && !click; i++) {
    click = await page.evaluate((t) => {
      const c = document.querySelector('canvas')!;
      const r = c.getBoundingClientRect();
      const e = (window as unknown as { __ARCHEAN__?: { engine: { pendingReal: number;
        pickCell: (x: number, y: number) => { bi: number } | null } } }).__ARCHEAN__!.engine;
      if (e.pendingReal > 0) return null;
      void t;
      for (let fy = 0.5; fy <= 0.78; fy += 0.02)
        for (let fx = 0.28; fx <= 0.72; fx += 0.02) {
          const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
          if (h && h.bi >= 0) return { x: fx, y: fy };
        }
      return null;
    }, tab);
    if (!click) await page.waitForTimeout(300);
  }
  expect(click, 'a deck block face answers pickCell').not.toBeNull();
  const box = (await page.getByTestId('canvas').boundingBox())!;
  return { x: box.x + box.width * click!.x, y: box.y + box.height * click!.y };
}

test.describe('blocks EDIT: highlight, in-place rotate, snap, twin @place', () => {
  test('selecting a block highlights it; snap sees the flush row; ⟲Y turns it in place', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    const p = await openDeck(page, 'edit');
    await page.mouse.click(p.x, p.y);
    const hl = await highlight(page);
    expect(hl, 'a selected block gets the golden highlight').not.toBeNull();
    await expect(page.getByTestId('block-edit')).toBeVisible();
    const before = await blockAt(page, hl!.bi);

    // ✧ snap BEFORE the rotation: the deck slabs form a flush cube row, so
    // the block already matches its neighbours
    await page.getByTestId('block-snap').scrollIntoViewIfNeeded();
    await page.getByTestId('block-snap').click();
    await expect(page.getByTestId('snap-msg')).toContainText(/already flush with \d+ neighbour/);

    // ⟲Y: the footprint exchanges x↔z about the SAME bbox centre
    await page.getByTestId('block-rot-y').click();
    await page.waitForTimeout(600);                        // debounced scene rebuild
    const after = await blockAt(page, hl!.bi);
    expect([after.sx, after.sz]).toEqual([before.sz, before.sx]);   // extents exchange
    expect(after.cx + (after.sx + 1) / 2).toBeCloseTo(before.cx + (before.sx + 1) / 2, 9);
    expect(after.cz + (after.sz + 1) / 2).toBeCloseTo(before.cz + (before.sz + 1) / 2, 9);
    expect(after.cy).toBe(before.cy);                               // y untouched by a y-spin
    expect(after.type).toBe(0);                                     // cube stays a cube

    // Deselect clears the highlight
    await page.getByTestId('block-deselect').click();
    expect(await highlight(page)).toBeNull();
  });

  test('a component picked in blocks mode gets the gizmo + widget + inspector (v1.4 regression: move/rotate)', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await page.goto('/');
    await page.getByTestId('gallery-new').click();
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await page.getByTestId('mode-edit').click();
    await page.getByTestId('ws-blocks').click();       // v1.5: the PLACE flavor
    let px: { x: number; y: number } | null = null;
    for (let i = 0; i < 40 && !px; i++) {
      px = await page.evaluate(() => {
        const c = document.querySelector('canvas')!;
        const r = c.getBoundingClientRect();
        const e = (window as unknown as { __ARCHEAN__?: { engine: { pendingReal: number;
          pickCell: (x: number, y: number) => { kind: string } | null } } }).__ARCHEAN__!.engine;
        if (e.pendingReal > 0) return null;
        for (let fy = 0.3; fy <= 0.8; fy += 0.02)
          for (let fx = 0.25; fx <= 0.8; fx += 0.02) {
            const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
            if (h && h.kind === 'comp') return { x: r.left + r.width * fx, y: r.top + r.height * fy };
          }
        return null;
      });
      if (!px) await page.waitForTimeout(300);
    }
    expect(px, 'the PilotSeat surface answers pickCell').not.toBeNull();
    await page.mouse.click(px!.x, px!.y);
    await expect(page.getByTestId('modebox')).toBeVisible();          // ⊘/✥/⟳/⇄ pops
    const st = await page.evaluate(() =>
      (window as unknown as { __ARCHEAN__?: { engine: { gizmoState: () => { ci: number; mode: string } } } }
      ).__ARCHEAN__!.engine.gizmoState());
    expect(st.ci, 'the gizmo attaches in blocks mode too').toBeGreaterThanOrEqual(0);
    await expect(page.getByTestId('block-brush'), 'the brush workspace stays').toBeVisible();
    // v1.11 dock law re-pin (we: "the dock switches under the cursor by
    // design" — AGENTS KNOWN ISSUE 10): a + Blocks pick selects the part
    // (v1.4 law) but the dock KEEPS the brush workspace — the part's
    // INSPECTOR lives in + Parts, which a MODIFY-mode part click opens by
    // itself. Pick the same pixel in ✎ Modify: the auto-jump lands ws-parts
    // and the inspector appears there.
    await page.getByTestId('ws-edit').click();
    // v1.12.2 RE-PIN: the first click FLEW the camera to the part (380 ms
    // tween) — a probe taken mid-flight goes stale before the second click
    // lands (the pick at that pixel is then sky, and the auto-jump law never
    // fires; the fast preview boot exposed this, KNOWN ISSUE 12 family).
    // Probe is valid only on a SETTLED view: two identical answers win.
    const compPixel = () => page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      const r = c.getBoundingClientRect();
      const e = (window as unknown as { __ARCHEAN__?: { engine: { pendingReal: number;
        pickCell: (x: number, y: number) => { kind: string } | null } } }).__ARCHEAN__!.engine;
      for (let fy = 0.3; fy <= 0.8; fy += 0.02)
        for (let fx = 0.25; fx <= 0.8; fx += 0.02) {
          const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
          if (h && h.kind === 'comp') return { x: r.left + r.width * fx, y: r.top + r.height * fy };
        }
      return null;
    });
    let px2 = await compPixel();
    for (let i = 0; i < 30 && px2; i++) {
      await page.waitForTimeout(250);
      const again = await compPixel();
      if (again && Math.hypot(again.x - px2.x, again.y - px2.y) < 6) { px2 = again; break; }
      px2 = again;
    }
    expect(px2, 'a component pixel answers in Modify too').not.toBeNull();
    await page.mouse.click(px2!.x, px2!.y);
    await expect(page.getByTestId('ws-parts'),
      'a Modify-mode part click auto-jumps to + Parts').toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('inspector'), 'the inspector lives in + Parts').toBeVisible();
    // and the part MOVES from there (inspector slider — the gizmo path is
    // pinned mode-independently by gizmo.spec)
    const x0 = await page.evaluate(() => {
      const a = (window as unknown as { __ARCHEAN__?: { engine: {
        compViewPos: (ci: number) => { x: number } | null; gizmoState: () => { ci: number } } } })
        .__ARCHEAN__!;
      return a.engine.compViewPos(a.engine.gizmoState().ci)!.x;
    });
    // v1.11: the inspector pos/rot rows are GONE (the gizmo supersedes them) —
    // drive the same engine seam the slider used to
    await page.evaluate(() => {
      const a = (window as unknown as { __ARCHEAN__?: { engine: {
        setFilePosAxis: (ci: number, ax: 'x' | 'y' | 'z', v: number) => void;
        gizmoState: () => { ci: number } } } }).__ARCHEAN__!;
      a.engine.setFilePosAxis(a.engine.gizmoState().ci, 'x', (a.engine as never as {
        compViewPos: (ci: number) => { x: number } }).compViewPos(a.engine.gizmoState().ci).x + 0.5);
    });
    await page.waitForTimeout(300);
    const x1 = await page.evaluate(() => {
      const a = (window as unknown as { __ARCHEAN__?: { engine: {
        compViewPos: (ci: number) => { x: number } | null; gizmoState: () => { ci: number } } } })
        .__ARCHEAN__!;
      return a.engine.compViewPos(a.engine.gizmoState().ci)!.x;
    });
    expect(x1 - x0).toBeCloseTo(0.5, 3);
  });

  test('⇄ placed pair: the block editor identifies the similar twin', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await page.goto('/');
    await page.getByTestId('gallery-new').click();
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await page.getByTestId('mode-edit').click();
    await page.getByTestId('ws-blocks').click();       // v1.5: place with the brush
    await armMirror(page, true);
    let click: { x: number; y: number } | null = null;
    for (let i = 0; i < 40 && !click; i++) {
      click = await page.evaluate(() => {
        const c = document.querySelector('canvas')!;
        const r = c.getBoundingClientRect();
        const e = (window as unknown as { __ARCHEAN__?: { engine: { pendingReal: number;
          pickCell: (x: number, y: number) => { bi: number } | null } } }).__ARCHEAN__!.engine;
        if (e.pendingReal > 0) return null;
        for (let fy = 0.5; fy <= 0.78; fy += 0.02)
          for (let fx = 0.28; fx <= 0.72; fx += 0.02) {
            const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
            if (h && h.bi >= 0) return { x: fx, y: fy };
          }
        return null;
      });
      if (!click) await page.waitForTimeout(300);
    }
    expect(click).not.toBeNull();
    const box = (await page.getByTestId('canvas').boundingBox())!;
    const before = await page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { engine: { blueprint: { data: { blocks: unknown[] } } } } }
    ).__ARCHEAN__!.engine.blueprint.data.blocks.length);
    await page.mouse.click(box.x + box.width * click!.x, box.y + box.height * click!.y);
    await page.waitForTimeout(600);                        // block + twin land
    expect(await page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { engine: { blueprint: { data: { blocks: unknown[] } } } } }
    ).__ARCHEAN__!.engine.blueprint.data.blocks.length)).toBe(before + 2);
    // v1.7.1 (user: "Selecting blocks does NOT SELECT MIRROR SYMMETRY"):
    // turn ⇄ OFF BEFORE selecting — the twin must still be identified as the
    // co-selection (⇄ gates only edit PROPAGATION, never identification).
    await armMirror(page, false);
    // the placed block stays selected (place auto-selects) — re-pick it in
    // the EDIT tab: the TOP face now answers the owned block, not the deck
    await page.getByTestId('ws-edit').click();
    await page.mouse.click(box.x + box.width * click!.x, box.y + box.height * click!.y);
    const hl = await highlight(page);
    expect(hl, 'the placed block is selected').not.toBeNull();
    expect(hl!.twin, 'the mirror twin is co-selected with ⇄ OFF').toBeGreaterThanOrEqual(0);
    expect(hl!.bi).not.toBe(hl!.twin);
    const twinRow = page.getByTestId('block-twin');
    await expect(twinRow).toContainText(/similar twin: Block\[\d+\]/);
    await expect(twinRow).toContainText(/\(edits mirror to it\)/);
    // v1.7.1 (user: "It should also do whatever I do to the mirror block,
    // mirrored of course"): with ⇄ still OFF, a gizmo cell-shift moves the
    // SELF one cell up AND the TWIN one cell up (y mirrors to itself) —
    // propagation is unconditional; ⇄ gates only twin PLACEMENT.
    const t0 = await blockAt(page, hl!.twin);
    const s0 = await blockAt(page, hl!.bi);
    const moved = await page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { engine: { blockGizmoShift: (s: [number, number, number]) => boolean } } }
    ).__ARCHEAN__!.engine.blockGizmoShift([0, 1, 0]));
    expect(moved, 'a shift into empty space is accepted').toBe(true);
    expect(await blockAt(page, hl!.bi), 'the self block moved one cell up')
      .toMatchObject({ cy: s0.cy + 1 });
    expect(await blockAt(page, hl!.twin!), 'the twin moved WITH it (mirrored), ⇄ OFF')
      .toMatchObject({ cy: t0.cy + 1 });
  });

  test('BLOCK widget (v1.5/1.11): attach, refuse a colliding shift, cell-move, 90° turn, ⤢ STRETCH mode', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    test.setTimeout(90_000);              // the + Blocks ghost hover-walk is a grid sweep
    const px = await openDeck(page, 'edit');
    const bi = await selectDeckBlock(page, px);

    // the gizmo ATTACHES to the selected block: its cell = the block's start
    await expect.poll(() => blockGizmo(page), { timeout: 4000 }).not.toBeNull();
    const gz = await blockGizmo(page);
    expect(gz!.bi).toBe(bi);
    expect(gz!.shown, 'the BLOCK widget is ACTUALLY on-screen (not just attached)').toBe(true);
    const b0 = await blockAt(page, bi);
    expect(gz!.cell).toEqual([b0.cx, b0.cy, b0.cz]);

    // REFUSE a shift into an occupied NEIGHBOUR cell (the contiguous deck z-row):
    // false return, the block does not move (the widget will snap back).
    const dz = await page.evaluate((i) => {
      const w = window as unknown as { __ARCHEAN__?: { engine: { blueprint: {
        data: { blocks: { type: number; pos_z: number; frame_z?: number; pos_y: number;
          frame_y?: number; pos_x: number; frame_x?: number }[] } } } } };
      const bl = w.__ARCHEAN__!.engine.blueprint.data.blocks;
      const cell = (p: number, f?: number) => (f ?? 0) * 12 + p;
      const me = bl[i]!;
      const mcz = cell(me.pos_z, me.frame_z), mcy = cell(me.pos_y, me.frame_y),
        mcx = cell(me.pos_x, me.frame_x);
      for (let j = 0; j < bl.length; j++) {
        if (j === i || bl[j]!.type === 255) continue;
        if (cell(bl[j]!.pos_x, bl[j]!.frame_x) === mcx && cell(bl[j]!.pos_y, bl[j]!.frame_y) === mcy) {
          const jz = cell(bl[j]!.pos_z, bl[j]!.frame_z);
          if (jz === mcz + 1) return 1;
          if (jz === mcz - 1) return -1;
        }
      }
      return 0;
    }, bi);
    if (dz !== 0) {
      const bad = await page.evaluate((d) => (window as unknown as {
        __ARCHEAN__?: { engine: { blockGizmoShift: (s: [number, number, number]) => boolean } } }
      ).__ARCHEAN__!.engine.blockGizmoShift([0, 0, d]), dz);
      expect(bad, 'a shift into an occupied cell is refused').toBe(false);
      expect((await blockGizmo(page))!.cell, 'the refused shift left the block put')
        .toEqual([b0.cx, b0.cy, b0.cz]);
    }

    // cell MOVE +1 in y (empty above the deck): the block lands one cell up
    // AND the merged hull REBUILDS (stats().loads bumps — the solid mesh is
    // repainted, not just the data). v1.5.1: it used to stay frozen.
    const l0 = await loads(page);
    const moved = await page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { engine: { blockGizmoShift: (s: [number, number, number]) => boolean } } }
    ).__ARCHEAN__!.engine.blockGizmoShift([0, 1, 0]));
    expect(moved, 'a shift into empty space is accepted').toBe(true);
    const b1 = await blockAt(page, bi);
    expect([b1.cx, b1.cy, b1.cz]).toEqual([b0.cx, b0.cy + 1, b0.cz]);
    await expect.poll(() => loads(page), { timeout: 4000,
      message: 'the accepted shift rebuilt the merged hull (mesh repaints)' })
      .toBeGreaterThan(l0);

    // 90° TURN about z: the 9×1 deck bar exchanges x↔y extents (rotatedBlock)
    // and again the SOLID repaints, not just the blueprint (v1.5.1).
    const l1 = await loads(page);
    const rot = await page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { engine: { blockGizmoRotate: (a: 'x' | 'y' | 'z', n: number) => boolean } } }
    ).__ARCHEAN__!.engine.blockGizmoRotate('z', 1));
    expect(rot, 'a 90° turn commits').toBe(true);
    const b2 = await blockAt(page, bi);
    expect([b2.sx, b2.sy], 'a z-spin exchanges the x and y footprints').toEqual([b0.sy, b0.sx]);
    await expect.poll(() => loads(page), { timeout: 4000,
      message: 'the 90° turn rebuilt the merged hull (mesh repaints)' })
      .toBeGreaterThan(l1);

    // v1.11 PLACEMENT REWRITE (we: "you can choose to move/rotate/scale it")
    // + the modify-hint law: setWs RETIRES the species selection on every
    // mode switch ("✎ Modify opens EMPTY — the editor appears on pick"), so
    // the widget rides a PICK, not the flip. What the + Blocks flavor keeps
    // is the place-then-transform ritual: a cell PLACED there wears the
    // widget (with move/turn/⤢ stretch) at once.
    await page.getByTestId('ws-blocks').click();
    expect(await blockGizmo(page), 'a mode switch retires the previous selection')
      .toBeNull();
    // the modebox from the Modify-mode pick floats over the deck — it
    // shields the canvas from pointermove (no ghost hover gets through)
    // AND swallows clicks. A SKY click picks nothing and closes it.
    {
      const cbox = (await page.getByTestId('canvas').boundingBox())!;
      await page.mouse.click(cbox.x + 8, cbox.y + 8);
      await page.waitForTimeout(150);
    }
    // The brush ghost must be VALID at the click pixel: a face exactly on a
    // lattice plane degenerates the ghost cell INTO the block (cellOverlap
    // refuses, red ghost), so hover-walk until a docked VALID ghost answers
    // (the paint.spec ghostPixel idiom).
    let gpt: { x: number; y: number } | null = null;
    const cbox = (await page.getByTestId('canvas').boundingBox())!;
    for (let fy = 0.45; fy <= 0.8 && !gpt; fy += 0.02)
      for (let fx = 0.25; fx <= 0.75 && !gpt; fx += 0.02) {
        const x = cbox.x + cbox.width * fx;
        const y = cbox.y + cbox.height * fy;
        await page.mouse.move(x, y);
        await page.waitForTimeout(45);
        const g = await page.evaluate(([px, py]) => {
          const w = window as unknown as { __ARCHEAN__?: { ghost: () =>
            { valid: boolean } | null; engine: {
              pickCell: (x: number, y: number) => { kind: string; bi: number } | null } } };
          const r = w.__ARCHEAN__!.engine.pickCell(px, py);
          const gh = w.__ARCHEAN__!.ghost();
          return !!r && (r.kind === 'block' || r.kind === 'tri') && r.bi >= 0 && !!gh && gh.valid;
        }, [x, y]);
        if (g) gpt = { x, y };
      }
    expect(gpt, 'a surface docks a VALID brush ghost').not.toBeNull();
    await page.mouse.click(gpt!.x, gpt!.y);                 // ONE cell lands
    await page.waitForTimeout(600);                         // debounced rebuild
    const gz2 = await blockGizmo(page);
    expect(gz2, 'a placed cell wears the widget (place-then-transform)').not.toBeNull();
    expect(gz2!.shown, 'the widget is ACTUALLY on-screen on the placed cell').toBe(true);
    // the STRETCH mode is a first-class widget mode (uniform with ✥/⟳)
    const scaled = await page.evaluate(() => {
      const w = window as unknown as { __ARCHEAN__?: {
        engine: { setGizmoMode: (m: string) => void; blockGizmoScale:
          (e: [number, number, number]) => boolean };
        blockGizmo: () => { mode: string; ext: [number, number, number]; bi: number } | null } };
      w.__ARCHEAN__!.engine.setGizmoMode('scale');
      const gz = w.__ARCHEAN__!.blockGizmo()!;
      // the placed cell is 1×1×1 — scale to its OWN ext is the no-op
      // (the engine commits centre-frozen stretches)
      return { mode: gz.mode, bi: gz.bi,
        same: w.__ARCHEAN__!.engine.blockGizmoScale(gz.ext) };
    });
    expect(scaled.mode, 'the widget answers the ⤢ STRETCH mode').toBe('scale');
    expect(scaled.same, 'a no-op stretch is accepted').toBe(true);
    const b3 = await blockAt(page, scaled.bi);
    expect([b3.sx, b3.sy, b3.sz], 'the no-op stretch changed no extents (size_* are 0-based)')
      .toEqual([0, 0, 0]);
    await page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { engine: { setGizmoMode: (m: string) => void } } })
      .__ARCHEAN__!.engine.setGizmoMode('rotate'));
  });
});
