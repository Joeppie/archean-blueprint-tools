// blockplace.spec.ts — the BLOCKS-place constructor parity (v1.4.0): the
// ghost preview follows the hover, the game's SHIFT rule (wiki
// ConstructorTool §Block Modes: "copy the block you're aiming at or
// logically add the next block") turns the ghost into the logical
// CONTINUATION of the aimed block, clicks place brush AND continuation,
// and the ghost docks onto COMPONENT surfaces too — all pinned through the
// __ARCHEAN__.ghost() hook (no pixels).
import { expect, test, type Page } from '@playwright/test';

const ISW = '3812927875';

type Ghost = {
  cell: [number, number, number]; size: [number, number, number];
  type: number; slot: number; valid: boolean; complement: boolean;
} | null;
type Probe = { x: number; y: number };

const ghost = (page: Page) => page.evaluate(() =>
  (window as unknown as { __ARCHEAN__?: { ghost: () => Ghost } }).__ARCHEAN__!.ghost());
const blocksCount = (page: Page) => page.evaluate(() =>
  (window as unknown as { __ARCHEAN__?: { stats: () => { blocks: number } } }).__ARCHEAN__!.stats().blocks);
const lastBlock = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __ARCHEAN__?: { engine: { blueprint: {
    data: { blocks: { type: number; pos_x: number; pos_y: number; pos_z: number;
      frame_x?: number; frame_y?: number; frame_z?: number }[] } } } } };
  const b = w.__ARCHEAN__!.engine.blueprint.data.blocks;
  return b[b.length - 1] ?? null;
});

/** Probe the canvas through engine.pickCell (deterministic — the panels.spec
 *  lesson): every pixel that answers a block face (bi ≥ 0) or a component. */
const probePixels = (page: Page, want: 'block' | 'comp') => page.evaluate((w) => {
  const c = document.querySelector('canvas')!;
  const r = c.getBoundingClientRect();
  const e = (window as unknown as { __ARCHEAN__?: { engine: {
    pendingReal: number;
    pickCell: (x: number, y: number) => { bi: number; kind: string } | null } } }).__ARCHEAN__!;
  if (e.engine.pendingReal > 0) return [];
  const engine = e.engine, out: { x: number; y: number }[] = [];
  for (let fy = 0.3; fy <= 0.85; fy += 0.03)
    for (let fx = 0.2; fx <= 0.8; fx += 0.03) {
      const h = engine.pickCell(r.left + r.width * fx, r.top + r.height * fy);
      if (h && (w === 'block' ? h.bi >= 0 : h.kind === 'comp')) out.push({ x: fx, y: fy });
    }
  return out;
}, want);

async function openBlocksMode(page: Page) {
  await page.goto(`/?craft=${ISW}`);
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
  await page.getByTestId('mode-blocks').click();
  await expect(page.getByTestId('block-brush')).toBeVisible();
}

/** hover a canvas point and wait for the ghost to answer it */
async function hoverGhost(page: Page, px: number, py: number, want: (g: Ghost) => boolean) {
  await page.mouse.move(px, py);
  return page.waitForFunction((w) => {
    const g = (window as unknown as { __ARCHEAN__?: { ghost: () => unknown } }).__ARCHEAN__!.ghost();
    const gg = g as { valid?: boolean; complement?: boolean } | null;
    return gg && w.valid === gg.valid && w.complement === gg.complement ? g : false;
  }, want, { timeout: 3000 }).then(h => h.jsonValue() as Promise<Ghost>).catch(() => null);
}

test.describe('blocks-place: ghost, docks & Shift continuation @place', () => {
  test('hover previews the brush ghost; it docks on block faces AND components', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await openBlocksMode(page);
    let pixels: Probe[] = [];
    for (let i = 0; i < 40 && pixels.length === 0; i++) {
      pixels = await probePixels(page, 'block');
      if (pixels.length === 0) await page.waitForTimeout(300);
    }
    expect(pixels.length, 'deck block faces answer pickCell').toBeGreaterThan(0);
    const box = (await page.getByTestId('canvas').boundingBox())!;
    let g: Ghost = null;
    const order = pixels.slice(pixels.length >> 1).concat(pixels.slice(0, pixels.length >> 1));
    for (const p of order) {
      g = await hoverGhost(page, box.x + box.width * p.x, box.y + box.height * p.y,
        { valid: true, complement: false });
      if (g) break;
    }
    expect(g, 'hovering a block face previews the brush ghost').not.toBeNull();
    expect(g!.cell.every(Number.isInteger)).toBe(true);        // grid-exact cell
    expect(g!.size).toEqual([0, 0, 0]);                        // default cube brush
    expect(g!.complement).toBe(false);

    // the ghost also DOCKS on a component surface (the game aims "a block
    // or beam"; the app adds parts + hull triangles)
    let compPixels: Probe[] = [];
    for (let i = 0; i < 20 && compPixels.length === 0; i++) {
      compPixels = await probePixels(page, 'comp');
      if (compPixels.length === 0) await page.waitForTimeout(300);
    }
    expect(compPixels.length, 'a component surface answers pickCell').toBeGreaterThan(0);
    let g3: Ghost = null;
    for (const cp of compPixels) {
      g3 = await hoverGhost(page, box.x + box.width * cp.x, box.y + box.height * cp.y,
        { valid: true, complement: false });
      if (g3) break;
    }
    expect(g3, 'hovering a part docks the ghost too').not.toBeNull();
  });

  test('Shift complements the aimed block; brush + continuation clicks both place', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await openBlocksMode(page);
    let pixels: Probe[] = [];
    for (let i = 0; i < 40 && pixels.length === 0; i++) {
      pixels = await probePixels(page, 'block');
      if (pixels.length === 0) await page.waitForTimeout(300);
    }
    expect(pixels.length).toBeGreaterThan(0);
    const box = (await page.getByTestId('canvas').boundingBox())!;

    // Shift over a block: the ghost becomes the aimed block's continuation
    // (same shape + size + paint), landing adjacent/coplanar.
    let cg: Ghost = null; let cpx = 0, cpy = 0;
    for (const p of pixels) {
      cpx = box.x + box.width * p.x; cpy = box.y + box.height * p.y;
      await page.keyboard.down('Shift');
      cg = await hoverGhost(page, cpx + 1, cpy, { valid: true, complement: true });
      await page.keyboard.up('Shift');
      if (cg) break;
    }
    expect(cg, 'Shift over a block aims the logical continuation').not.toBeNull();
    const aimedType = await page.evaluate(({ x, y }) => {
      const w = window as unknown as { __ARCHEAN__?: { engine: {
        pickCell: (x: number, y: number) => { bi: number } | null;
        blueprint: { data: { blocks: { type: number }[] } } } } };
      const e = w.__ARCHEAN__!.engine;
      const h = e.pickCell(x, y)!;
      return e.blueprint.data.blocks[h.bi].type;
    }, { x: cpx, y: cpy });
    expect(cg!.type, 'the continuation copies the aimed block\'s shape+orientation').toBe(aimedType);

    const before = await blocksCount(page);
    await page.keyboard.down('Shift');
    await page.mouse.click(cpx + 2, cpy);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(600);                            // debounced scene reload
    expect(await blocksCount(page), 'the continuation lands').toBe(before + 1);
    expect((await lastBlock(page)!)!.type).toBe(cg!.type);

    // the brush (a PYRAMID, so its type cannot be confused with a cube
    // continuation) still places at the same hover
    await page.getByTestId('btype-21').click();
    let bg: Ghost = null;
    for (const p of pixels.slice().reverse()) {
      bg = await hoverGhost(page, box.x + box.width * p.x, box.y + box.height * p.y,
        { valid: true, complement: false });
      if (bg?.type === 21) { cpx = box.x + box.width * p.x; cpy = box.y + box.height * p.y; break; }
      bg = null;
    }
    expect(bg, 'the pyramid brush previews somewhere legal').not.toBeNull();
    await page.mouse.click(cpx, cpy);
    await page.waitForTimeout(600);
    expect(await blocksCount(page)).toBe(before + 2);
    expect((await lastBlock(page)!)!.type).toBe(21);
    await expect(page.getByTestId('save-btn')).toContainText('●');   // dirty through the doc mirror
  });
});
