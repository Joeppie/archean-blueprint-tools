// blockplace.spec.ts — the BLOCKS-place constructor parity (v1.4.0): the
// ghost preview follows the hover, the game's SHIFT rule (wiki
// ConstructorTool §Block Modes: "copy the block you're aiming at or
// logically add the next block") turns the ghost into the logical
// CONTINUATION of the aimed block, clicks place brush AND continuation,
// and the ghost docks onto COMPONENT surfaces too — all pinned through the
// __ARCHEAN__.ghost() hook (no pixels).
import { expect, test, type Page } from '@playwright/test';

// v1.10.6: the host craft is the IAS-418 testframe (9000005001 — the bare
// deck + corner pyramid + dashboards fixture), NOT the ISW-241: the ISW
// blocks ride under its chrome skin, so exposed block faces are 1-px seam
// pixels on the build-dock's shorter canvas (the probe grid found none).
// The testframe's deck is a wide exposed block field — a constructor host.
const ISW = '9000005001';

type Ghost = {
  cell: [number, number, number]; size: [number, number, number];
  type: number; slot: number; valid: boolean; complement: boolean;
} | null;
type Probe = { x: number; y: number };

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
 *  lesson): pixels that answer the wanted kind. v1.10.6: the build-dock
 *  shortens the canvas (faces get thin) — a pixel qualifies only when its
 *  centre AND all four ±2-px offsets answer the SAME block (kind wanted):
 *  face-INTERIOR pixels. Pixels on a block's silhouette rim are face-
 *  unstable (sub-pixel camera-damping drift swaps which face the ray meets
 *  first, and the Shift continuation aims a different face on click). */
const probePixels = (page: Page, want: 'block' | 'comp') => page.evaluate((w) => {
  const c = document.querySelector('canvas')!;
  const r = c.getBoundingClientRect();
  const e = (window as unknown as { __ARCHEAN__?: { engine: {
    pendingReal: number;
    pickCell: (x: number, y: number) => { bi: number; ci: number; kind: string } | null } } }).__ARCHEAN__!;
  if (e.engine.pendingReal > 0) return [];
  const engine = e.engine, out: { x: number; y: number }[] = [];
  const key = (px: number, py: number) => {
    const h = engine.pickCell(px, py);
    if (!h) return null;
    const ok = w === 'block' ? h.bi >= 0 : h.kind === 'comp' && h.ci >= 0;
    return ok ? (w === 'block' ? h.bi : h.ci) : null;
  };
  for (let fy = 0.3; fy <= 0.85; fy += 0.03)
    for (let fx = 0.2; fx <= 0.8; fx += 0.03) {
      const px = r.left + r.width * fx, py = r.top + r.height * fy;
      const k = key(px, py);
      if (k === null) continue;
      const offs = [[-2, 0], [2, 0], [0, -2], [0, 2]] as const;
      if (offs.every(([dx, dy]) => key(px + dx, py + dy) === k)) out.push({ x: fx, y: fy });
    }
  return out;
}, want);

async function openBlocksMode(page: Page) {
  await page.goto(`/?craft=${ISW}`);
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
  await page.getByTestId('mode-edit').click();
  await page.getByTestId('ws-blocks').click();       // v1.5: brush lives in PLACE
  await page.getByTestId('mirw-off').click();               // v1.11: single-cell pins (no auto twin)
  await expect(page.getByTestId('block-brush')).toBeVisible();
}

/** v1.10.6: the load-time camera flight settles for a second after
 *  SCENE PASS — a probe-then-hover sequence straddling that drift picks
 *  DIFFERENT blocks at the same pixel (the Shift family pin raced it).
 *  Gate: two probe snapshots 500 ms apart must agree before hovering. */
async function settledPixels(page: Page): Promise<Probe[]> {
  let prev = await probePixels(page, 'block');
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(400);
    const next = await probePixels(page, 'block');
    if (next.length > 0 && JSON.stringify(next) === JSON.stringify(prev)) return next;
    prev = next;
  }
  return prev;
}

/** hover a canvas point and wait for the ghost to answer it (the want is the
 *  OBJECT passed into waitForFunction as the page arg — not a predicate) */
async function hoverGhost(page: Page, px: number, py: number,
  want: { valid: boolean; complement: boolean }) {
  await page.mouse.move(px, py);
  return page.waitForFunction((w: { valid?: boolean; complement?: boolean }) => {
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
    const pixels = await settledPixels(page);
    expect(pixels.length).toBeGreaterThan(0);
    const box = (await page.getByTestId('canvas').boundingBox())!;

    // Shift over a block: the ghost becomes the aimed block's logical
    // continuation at the hit face (family mate, size + paint ride over).
    // v1.10.6: the ghost AND the aimed pick are read in ONE page task —
    // reading aimedType later races the ghost's re-aim (the keyboard.up
    // Shift re-computes it against whatever surface answers then).
    let pair: { aimed: number; ghost: number } | null = null;
    let cpx = 0, cpy = 0;
    for (const p of pixels.slice(0, 40)) {
      cpx = box.x + box.width * p.x; cpy = box.y + box.height * p.y;
      await page.keyboard.down('Shift');
      await page.mouse.move(cpx, cpy);
      // poll the ghost FRESH (the ghost re-aim shares the ~40 Hz hover
      // throttle — an immediate read can still carry the PREVIOUS pixel's
      // complement); pickCell runs in the same rAF tick as the ghost read
      pair = await page.evaluate(({ x, y }) => new Promise<{
        aimed: number; ghost: number } | null>(res => {
        const t0 = performance.now();
        let last = '';
        const tick = () => {
          const w = window as unknown as { __ARCHEAN__?: {
            engine: {
              pickCell: (px: number, py: number) => { bi: number } | null;
              blueprint: { data: { blocks: { type: number; size_x: number; size_y: number; size_z: number }[] } } };
            ghost: () => { type: number; cell: number[]; size: number[]; valid: boolean; complement: boolean } | null;
          } };
          const A = w.__ARCHEAN__!;
          const e = A.engine;
          const g = A.ghost();
          if (g && g.complement && g.valid) {
            const h = e.pickCell(x, y);
            if (h && h.bi >= 0) {
              const b = e.blueprint.data.blocks[h.bi]!;
              // CONSISTENT + STABLE pair only: the continuation rides the
              // aimed block's size, and the ghost must repeat identically on
              // two consecutive frames (the hover throttle's trailing frame
              // is mid-swap otherwise). A pixel exactly on a block's base
              // seam (coplanar faces) is a genuinely ambiguous pick — the
              // size gate rejects it, and we move on.
              const js = JSON.stringify([g.type, g.cell, g.size]);
              if (g.size[0] === b.size_x && g.size[1] === b.size_y && g.size[2] === b.size_z && last === js) {
                res({ aimed: b.type, ghost: g.type }); return;
              }
              last = js;
            }
          }
          if (performance.now() - t0 > 400) { res(null); return; }
          requestAnimationFrame(tick);
        };
        tick();
      }), { x: cpx, y: cpy });
      await page.keyboard.up('Shift');
      if (pair) break;
    }
    expect(pair, 'Shift over a block aims the logical continuation').not.toBeNull();
    // v1.5.2 (user rule): the continuation is the family's FLUSH MATE at the
    // hit face — the same shape only where a copy glues the joint itself
    // (cube walls, a slope's triangular sides); a wedge's flat face gets the
    // INVERTED wedge, never a same-type copy edge-touching across a void.
    const fam = (t: number) => (t === 0 ? 0 : t <= 12 ? 1 : t <= 20 ? 2 : t <= 44 ? 3 : 4);
    expect(fam(pair!.aimed), 'the continuation stays in the aimed block\'s shape family')
      .toBe(fam(pair!.ghost));

    const before = await blocksCount(page);
    await page.keyboard.down('Shift');
    await page.mouse.click(cpx, cpy);        // the exact pair-verified pixel
    await page.keyboard.up('Shift');
    await page.waitForTimeout(600);                            // debounced scene reload
    expect(await blocksCount(page), 'the continuation lands').toBe(before + 1);
    // v1.10.6: the landed type's FAMILY is the pin (the game's rule is a
    // family law). The exact orientation depends on the hit face, and
    // sub-pixel camera-damping drift between the ghost read and the click
    // can flip which face the ray meets first at a block's top-face rim —
    // the click still aims the aimed block's family continuation.
    expect(fam((await lastBlock(page)!)!.type), 'the landed block is a family continuation')
      .toBe(fam(pair!.aimed));

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
