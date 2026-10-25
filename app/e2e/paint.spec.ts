// paint.spec.ts — the v1.6 PALETTE + block-selection lifecycle:
//  • the swatch grid badges every palette slot with its use COUNT on the
//    vessel (the deck of a NEW craft is 35 slot-4 faces);
//  • painting a selected BLOCK (panel BlockPaint) writes bp colours, and
//    with ⇄ the SIMILAR TWIN is painted through the mirrored FACE mapping
//    (−x face → twin's +x face) — "ensure mirroring is respected when
//    editing a block" (user rule; geometry rows mirror the same way);
//  • the mode widget's 🎨 button opens the paint window for the selection
//    (block ▸ faces, component ▸ color1/color2 snap);
//  • STALE-GHOST pin (the "blocks become translucent and don't return"
//    bug): after a panel cx move the golden overlay must sit on the block's
//    NEW cell — the {bi,twin}-only dedup once kept the OLD geometry alive
//    as a ghost; and a SKY click deselects (the overlay dies with it).
import { expect, test, type Page } from '@playwright/test';

type Blk = { pos_x: number; pos_y: number; pos_z: number; frame_x?: number; frame_y?: number;
  frame_z?: number; size_x: number; size_y: number; size_z: number; type: number; colors: number[] };

const blocks = (page: Page) => page.evaluate(() =>
  (window as unknown as { __ARCHEAN__: { engine: { blueprint: { data: { blocks: Blk[] } } } } })
    .__ARCHEAN__.engine.blueprint.data.blocks);

const cellOf = (b: Blk): [number, number, number] =>
  [(b.frame_x ?? 0) * 12 + b.pos_x, (b.frame_y ?? 0) * 12 + b.pos_y, (b.frame_z ?? 0) * 12 + b.pos_z];

const highlight = (page: Page) => page.evaluate(() =>
  (window as unknown as { __ARCHEAN__: { blockHighlight: () => { bi: number; twin: number } | null } })
    .__ARCHEAN__.blockHighlight());

const hlCentres = (page: Page) => page.evaluate(() =>
  (window as unknown as { __ARCHEAN__: { blockHlBoxes: () => { min: number[]; max: number[] }[] } })
    .__ARCHEAN__.blockHlBoxes().map(b => b.min.map((v, i) => (v + b.max[i]!) / 2)));

const loads = (page: Page) => page.evaluate(() =>
  (window as unknown as { __ARCHEAN__: { stats: () => { loads: number } } }).__ARCHEAN__.stats().loads);

/** the world bbox centre of a block (moff = 0 on a NEW craft) */
const blockCentre = (b: Blk): [number, number, number] => {
  const c = cellOf(b);
  return [0, 1, 2].map(a =>
    (c[a]! + (b[(['size_x', 'size_y', 'size_z'] as const)[a]] + 1) / 2 - 6) * 0.25) as [number, number, number];
};

async function openNew(page: Page) {
  await page.goto('/');
  await page.getByTestId('gallery-new').click();
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
}

async function toBlocks(page: Page, tab: 'place' | 'edit') {
  await page.getByTestId('mode-edit').click();
  await page.getByTestId(`tooltab-${tab}`).click();
  await page.waitForTimeout(250);
}

/** hover-walk the canvas until a DECK-BLOCK face answers pickCell (not the
 *  seat collider — a comp pick would SELECT, not place); return that pixel */
async function ghostPixel(page: Page): Promise<{ x: number; y: number }> {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  for (let fy = 0.45; fy <= 0.85; fy += 0.02)
    for (let fx = 0.2; fx <= 0.8; fx += 0.02) {
      const x = box.x + box.width * fx, y = box.y + box.height * fy;
      await page.mouse.move(x, y);
      await page.waitForTimeout(45);
      const h = await page.evaluate(([px, py]) => {
        const r = (window as unknown as { __ARCHEAN__: {
          engine: { pickCell: (x: number, y: number) => { kind: string; bi: number } | null } } })
            .__ARCHEAN__.engine.pickCell(px, py);
        return r && (r.kind === 'block' || r.kind === 'tri') && r.bi >= 0;
      }, [x, y]);
      if (h) return { x, y };
    }
  throw new Error('no block-face pixel found');
}

/** scan for a pixel whose pickCell answers block `bi`, and return it */
async function pixelOfBlock(page: Page, bi: number): Promise<{ x: number; y: number }> {
  const hit = await page.evaluate((i) => {
    const c = document.querySelector('canvas')!; const r = c.getBoundingClientRect();
    const e = (window as unknown as { __ARCHEAN__: {
      engine: { pickCell: (x: number, y: number) => { bi: number } | null } } }).__ARCHEAN__.engine;
    for (let fy = 0.4; fy <= 0.85; fy += 0.015)
      for (let fx = 0.2; fx <= 0.8; fx += 0.015) {
        const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
        if (h && h.bi === i) return { x: r.left + r.width * fx, y: r.top + r.height * fy };
      }
    return null;
  }, bi);
  expect(hit, `a screen pixel answers block ${bi}`).not.toBeNull();
  return hit!;
}

test.describe('palette: census, block paint, ⇄ twin, widget 🎨 @place', () => {
  // openNew (gallery ▸ SCENE PASS) + the 45 ms hover-walk pixel scans + the
  // placement's debounced scene RELOAD together legitimately exceed the
  // default 30 s on the iGPU box (the two block-paint pins timed out in
  // toBlocks('edit') at the budget cliff — same on v1.5.12, not a
  // behaviour change; the paint assertions themselves never failed).
  test.setTimeout(90_000);
  test('the swatch grid badges the deck with 35 uses (5 blocks × 7 faces)', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await openNew(page);
    await toBlocks(page, 'place');
    await expect(page.getByTitle(/^slot 4 · 35× on vessel/).first()).toBeVisible();
    await expect(page.getByTestId('palette-tab-used')).toContainText('on vessel (1)');
  });

  test('painting the −x FACE lands the colour on the twin’s +x face (⇄)', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await openNew(page);
    await toBlocks(page, 'place');
    await page.getByTestId('mirror-twin').click();               // ⇄ twin ON (place + edits)
    await page.getByTestId('num-slot').fill('0');
    const pt = await ghostPixel(page);
    await page.mouse.click(pt.x, pt.y);                           // mirrored PAIR placed
    await page.waitForTimeout(500);
    expect((await blocks(page)).length).toBe(7);                  // deck 5 + pair
    await toBlocks(page, 'edit');
    const px = await pixelOfBlock(page, 5);
    await page.mouse.click(px.x, px.y);
    await expect(page.getByTestId('block-twin')).toContainText('twin: Block[6]');
    // paint the −x FACE only, colour from the matte family tab
    await page.getByTestId('block-paint').getByTestId('paint-face-3').click();
    await page.getByTestId('block-paint').getByTestId('palette-tab-matte').click();
    await page.getByTestId('block-paint').getByTitle(/^slot 40 ·/).click();
    await page.waitForTimeout(500);
    const [a, b] = (await blocks(page)).slice(5);
    expect(a!.colors).toEqual([0, 0, 0, 40, 0, 0, 0]);
    expect(b!.colors).toEqual([0, 0, 40, 0, 0, 0, 0]);
  });

  test('the widget 🎨 paints the selected block through the palette window', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await openNew(page);
    await toBlocks(page, 'place');
    await page.getByTestId('num-slot').fill('0');
    const pt = await ghostPixel(page);
    await page.mouse.click(pt.x, pt.y);                           // one block (⇄ off)
    await page.waitForTimeout(500);
    await toBlocks(page, 'edit');
    const px = await pixelOfBlock(page, 5);
    await page.mouse.click(px.x, px.y);
    await page.getByTestId('mode-paint').click();
    await expect(page.getByTestId('palette-win')).toContainText('Block[5]');
    await page.getByTestId('palette-win').getByTestId('palette-tab-matte').click();
    await page.getByTestId('palette-win').getByTitle(/^slot 44 ·/).click();
    await page.waitForTimeout(500);
    expect((await blocks(page))[5]!.colors).toEqual([44, 44, 44, 44, 44, 44, 44]);
  });

  test('the widget 🎨 snaps a palette colour onto a component color2', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await openNew(page);
    await page.getByTestId('mode-edit').click();
    await page.getByTestId('tooltab-edit').click();
    // find a pixel whose pickCell answers the PilotSeat (kind comp, ci 0)
    const seat = await page.evaluate(() => {
      const c = document.querySelector('canvas')!; const r = c.getBoundingClientRect();
      const e = (window as unknown as { __ARCHEAN__: { engine: {
        pickCell: (x: number, y: number) => { kind: string; ci: number } | null } } }).__ARCHEAN__.engine;
      for (let fy = 0.35; fy <= 0.8; fy += 0.015)
        for (let fx = 0.25; fx <= 0.75; fx += 0.015) {
          const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
          if (h && h.kind === 'comp' && h.ci === 0) return { x: r.left + r.width * fx, y: r.top + r.height * fy };
        }
      return null;
    });
    expect(seat, 'the PilotSeat answers a canvas pixel').not.toBeNull();
    await page.mouse.click(seat!.x, seat!.y);
    await page.getByTestId('mode-paint').click();
    await expect(page.getByTestId('palette-win')).toContainText('PilotSeat[0]');
    await page.getByTestId('palette-win').getByTestId('comp-paint-color2').click();
    await page.getByTestId('palette-win').getByTestId('palette-tab-matte').click();
    await page.getByTestId('palette-win').getByTitle(/^slot 43 ·/).click();   // matte red
    await page.waitForTimeout(500);
    const c2 = await page.evaluate(() => (window as unknown as { __ARCHEAN__: {
      engine: { blueprint: { data: { components: { colors: Record<string, Record<string, number>> }[] } } } },
    }).__ARCHEAN__.engine.blueprint.data.components[0]!.colors.color2);
    expect(c2).toMatchObject({ r: 96, g: 16, b: 16 });
  });
});

test.describe('selection lifecycle: no stale ghost, sky deselects @place', () => {
  test('a panel cx move moves the golden overlay WITH the block; a sky click clears it', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await openNew(page);
    await toBlocks(page, 'edit');
    const px = await pixelOfBlock(page, 0);
    await page.mouse.click(px.x, px.y);
    await expect.poll(() => highlight(page), { timeout: 5_000 })
      .toEqual({ bi: 0, twin: -1, issues: [], info: false });
    let c0 = blockCentre((await blocks(page))[0]!);
    let boxes = await hlCentres(page);
    expect(boxes.length).toBe(1);
    boxes[0]!.forEach((v, i) => expect(Math.abs(v - c0[i]!)).toBeLessThan(1e-3));
    // move it one cell up in x through the panel row
    const cx0 = cellOf((await blocks(page))[0]!)[0];
    const l0 = await loads(page);
    await page.getByTestId('num-cx').fill(String(cx0 + 1));
    await expect.poll(() => loads(page), { timeout: 10_000 }).toBeGreaterThan(l0);
    await page.waitForTimeout(250);
    c0 = blockCentre((await blocks(page))[0]!);
    boxes = await hlCentres(page);
    expect(boxes.length).toBe(1);
    // THE stale-ghost pin: the overlay sits on the NEW cell, not the old one
    boxes[0]!.forEach((v, i) => expect(Math.abs(v - c0[i]!)).toBeLessThan(1e-3));
    // a sky click deselects — no highlight, no overlay left behind
    const box = (await page.getByTestId('canvas').boundingBox())!;
    await page.mouse.click(box.x + 6, box.y + 6);
    await expect.poll(() => highlight(page), { timeout: 5_000 }).toBeNull();
    expect(await hlCentres(page)).toHaveLength(0);
  });
});
