// blockedit.spec.ts — the BLOCKS EDIT sub-tab (v1.4): clicking a block in
// the EDIT tab SELECTS it with a golden highlight (engine-side state, the
// block analogue of the component outline), ⟲ turns the shape IN PLACE
// (bbox centre frozen), ✧ snap reads the neighbour geometry, and a ⇄-placed
// pair IDENTIFIES as similar twins whose edits propagate together.
import { expect, test, type Page } from '@playwright/test';

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

/** open a NEW craft in BLOCKS mode and return a canvas fraction that
 *  answers a deck block face through engine.pickCell (deterministic probe) */
async function openDeck(page: Page, tab: 'place' | 'edit') {
  await page.goto('/');
  await page.getByTestId('gallery-new').click();
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
  await page.getByTestId('mode-blocks').click();
  await page.getByTestId(`blocktool-${tab}`).click();
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

  test('⇄ placed pair: the block editor identifies the similar twin', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await page.goto('/');
    await page.getByTestId('gallery-new').click();
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await page.getByTestId('mode-blocks').click();
    await page.getByTestId('block-mirror').click();        // twin ON
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
    // the placed block stays selected (place auto-selects) — re-pick it in
    // the EDIT tab: the TOP face now answers the owned block, not the deck
    await page.getByTestId('blocktool-edit').click();
    await page.mouse.click(box.x + box.width * click!.x, box.y + box.height * click!.y);
    const hl = await highlight(page);
    expect(hl, 'the placed block is selected').not.toBeNull();
    const twinRow = page.getByTestId('block-twin');
    await expect(twinRow).toContainText(/similar twin: Block\[\d+\]/);
    if (hl!.twin >= 0) expect(hl!.bi).not.toBe(hl!.twin);
  });
});
