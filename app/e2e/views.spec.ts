// views.spec.ts — v1.5.21/23 orientation & ground batch (user: "grid needs
// to fit build comfortably. Probably granularity depending on zoom 1x or 5,
// 10, depending"; "mirror axes should be settable. Game is not hardcoded
// x"; "I thought more like the way blender does it with X and Z being on
// the grid shown … a small black label to indicate grid position on the
// corners of the displayed grid under cursor … for a ad-hoc vertical grid
// also black to be visible only when pressing shift, that is the most
// coplanar for our horizontal grid (either x or z) … get the full x-y-z of
// a chosen location"; "Is x-y the plane that is flat, and Z up, or is that
// Y? please check, and ensure it is right in our viewer" — CHECKED: FORMAT
// §world maths: x lateral, y = UP, z longitudinal (nose −z); the flat plane
// is x–z. The pins below assert the readout follows that law."):
//  • the ground grid COVERS the build footprint and its CELL ADAPTS to zoom
//    (wheel out ⇒ coarser rung of the 0.25/1.25/2.5/12.5 m ladder),
//  • the ⚙ mirror-axis row (X/Y/Z) is live on the engine (⇄ placement, block
//    twins and the overlay sheet ride it — the corpus x-law stays the
//    default, mirror.spec keeps pinning it in pixels).
import { expect, test, type Page } from '@playwright/test';

const ISW = '3812927875';

type Grid = { step: number; major: number; halfX: number; halfZ: number; cx: number; cz: number; y: number };
type Win = { __ARCHEAN__?: {
  engine: {
    blueprint: { box_min: { x: number; y: number; z: number }; box_max: { x: number; y: number; z: number } } | null;
  };
  grid(): Grid | null;
  mirAxis(): 'x' | 'y' | 'z';
  coord(): { x: number; y: number; z: number; step: number; shift: boolean } | null;
} };

const gridOf = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__ARCHEAN__!.grid());
const mirAxis = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__ARCHEAN__!.mirAxis());

async function openCraft(page: Page, id: string) {
  await page.goto(`/?craft=${id}`);
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
}

test.describe('coord readout + adaptive grid + settable mirror axis @ui', () => {
  const desktopOnly = () => test.skip(test.info().project.name !== 'chromium', 'desktop-only');

  const onLadder = (v: number, step: number) =>
    Math.abs(v / step - Math.round(v / step)) < 1e-6;
  const coordOf = (page: Page) =>
    page.evaluate(() => (window as unknown as Win).__ARCHEAN__!.coord());
  /** a pad pixel well below the framed craft (the default eye looks down,
   *  so the lower canvas band is ground) */
  const padPixel = async (page: Page, fy = 0.78) => {
    const r = await page.getByTestId('canvas').boundingBox();
    return { x: r!.x + r!.width * 0.5, y: r!.y + r!.height * fy };
  };

  test('hovering the pad shows a BLACK chip SNAPPED to grid corners (x–z, y up)', async ({ page }) => {
    desktopOnly();
    await openCraft(page, ISW);
    const p = await padPixel(page);
    await page.mouse.move(p.x, p.y);
    await expect.poll(() => coordOf(page), { timeout: 5_000 }).not.toBeNull();
    const st = (await coordOf(page))!;
    const chip = page.getByTestId('coord-chip');
    await expect(chip).toBeVisible();
    // snapped onto the visible ladder (the same rung the ground grid draws)
    expect(onLadder(st.x, st.step)).toBe(true);
    expect(onLadder(st.z, st.step)).toBe(true);
    expect(st.shift).toBe(false);
    // WITHOUT Shift only the flat-grid (x–z) corner is readable — no y yet
    const text = (await chip.textContent())!;
    expect(text).toContain('x');
    expect(text).toContain('z');
    expect(text).not.toContain('y');
  });

  test('Shift adds the vertical plane: full x/y/z, and y is the UP axis', async ({ page }) => {
    desktopOnly();
    await openCraft(page, ISW);
    const p = await padPixel(page);
    await page.mouse.move(p.x, p.y);
    await expect.poll(() => coordOf(page), { timeout: 5_000 }).not.toBeNull();
    await page.keyboard.down('Shift');
    await page.mouse.move(p.x, p.y - 4, { steps: 2 });    // re-run under Shift
    await expect.poll(() => coordOf(page)?.then(c => c?.shift), { timeout: 5_000 }).toBe(true);
    const s1 = (await coordOf(page))!;
    const chip = page.getByTestId('coord-chip');
    const text = (await chip.textContent())!;
    expect(text).toContain('y');                          // full x/y/z now
    expect(onLadder(s1.y, s1.step)).toBe(true);
    // THE CONVENTION PIN (user: "Is x-y the plane that is flat, and Z up,
    // or is that Y?"): raising the pointer on screen RAISES y (never z) —
    // y is the vertical coordinate of the file/viewer (FORMAT §world maths)
    await page.mouse.move(p.x, p.y - 150, { steps: 6 });
    await expect.poll(async () => {
      const s2 = await coordOf(page);
      return !!s2 && s2.y > s1.y;
    }, { timeout: 5_000 }).toBe(true);
    const s2 = (await coordOf(page))!;
    expect(onLadder(s2.y, s2.step)).toBe(true);
    await page.keyboard.up('Shift');
    await page.mouse.move(p.x, p.y - 148, { steps: 1 });
    await expect.poll(() => coordOf(page)?.then(c => c?.shift), { timeout: 5_000 }).toBe(false);
  });

  test('the grid fits the build footprint', async ({ page }) => {
    await openCraft(page, ISW);
    await expect.poll(() => gridOf(page), { timeout: 10_000 }).not.toBeNull();
    const g = (await gridOf(page))!;
    const box = await page.evaluate(() => {
      const b = (window as unknown as Win).__ARCHEAN__!.engine.blueprint!;
      return { mn: [b.box_min.x, b.box_min.y, b.box_min.z] as number[],
        mx: [b.box_max.x, b.box_max.y, b.box_max.z] as number[] };
    });
    expect(g.halfX).toBeGreaterThanOrEqual((box.mx[0]! - box.mn[0]!) / 2);
    expect(g.halfZ).toBeGreaterThanOrEqual((box.mx[2]! - box.mn[2]!) / 2);
    expect(g.cx - g.halfX).toBeLessThanOrEqual(box.mn[0]);
    expect(g.cx + g.halfX).toBeGreaterThanOrEqual(box.mx[0]);
    expect(g.cz - g.halfZ).toBeLessThanOrEqual(box.mn[2]);
    expect(g.cz + g.halfZ).toBeGreaterThanOrEqual(box.mx[2]);
  });

  test('the grid cell adapts to zoom on the 1/5/10 ladder', async ({ page }) => {
    desktopOnly();
    await openCraft(page, ISW);
    await expect.poll(() => gridOf(page), { timeout: 10_000 }).not.toBeNull();
    const s0 = (await gridOf(page))!.step;
    expect([0.05, 0.25, 1.25, 2.5, 12.5, 25]).toContain(s0);
    const canvas = page.getByTestId('canvas');
    await canvas.hover();
    const dir = s0 < 25 ? 1 : -1;                  // zoom out ⇒ coarser rung
    for (let i = 0; i < 8; i++) await page.mouse.wheel(0, dir * 400);
    await expect.poll(() => gridOf(page).then(g => g?.step), { timeout: 15_000 }).not.toBe(s0);
    const s = (await gridOf(page))!.step;
    if (dir > 0) expect(s).toBeGreaterThan(s0);    // wheel-out: bigger cell
    else expect(s).toBeLessThan(s0);               // wheel-in: finer cell
  });

  test('⚙ mirror axis is settable (X/Y/Z) and live on the engine', async ({ page }) => {
    await openCraft(page, ISW);
    expect(await mirAxis(page)).toBe('x');         // corpus default
    await page.getByTestId('toggle-options').click();
    await page.getByTestId('mirror-axis-z').click();
    await expect.poll(() => mirAxis(page)).toBe('z');
    expect(await page.evaluate(() => localStorage.getItem('archean-app-mirror-axis'))).toBe('z');
    await page.getByTestId('mirror-axis-y').click();
    await expect.poll(() => mirAxis(page)).toBe('y');
  });
});
