// views.spec.ts — v1.5.21 orientation & ground batch (user: "We need to see
// directions for XYZ axes, also grid needs to fit build comfortably.
// Probably granularity depending on zoom 1x or 5, 10, depending. Also,
// mirror axes should be settable. Game is not hardcoded x."):
//  • the corner AXIS COMPASS answers and its heads FLY THE CAMERA along the
//    world axes (camPos comparison between the X and Y views),
//  • the ground grid COVERS the build footprint and its CELL ADAPTS to zoom
//    (wheel out ⇒ coarser rung of the 0.25/1.25/2.5/12.5 m ladder),
//  • the ⚙ mirror-axis row (X/Y/Z) is live on the engine (⇄ placement, block
//    twins and the overlay sheet ride it — the corpus x-law stays the
//    default, mirror.spec keeps pinning it in pixels).
import { expect, test, type Page } from '@playwright/test';

const ISW = '3812927875';

type Grid = { step: number; major: number; halfX: number; halfZ: number; cx: number; cz: number; y: number };
type Ax = { k: 'x' | 'y' | 'z'; sx: number; sy: number; toward: number };
type Win = { __ARCHEAN__?: {
  engine: {
    camPos(): [number, number, number];
    blueprint: { box_min: { x: number; y: number; z: number }; box_max: { x: number; y: number; z: number } } | null;
  };
  axis(): Ax[];
  grid(): Grid | null;
  mirAxis(): 'x' | 'y' | 'z';
} };

const camPos = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__ARCHEAN__!.engine.camPos());
const gridOf = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__ARCHEAN__!.grid());
const mirAxis = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__ARCHEAN__!.mirAxis());

async function openCraft(page: Page, id: string) {
  await page.goto(`/?craft=${id}`);
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
}

test.describe('axis compass + adaptive grid + settable mirror axis @ui', () => {
  const desktopOnly = () => test.skip(test.info().project.name !== 'chromium', 'desktop-only');

  test('the compass shows the three world axes', async ({ page }) => {
    await openCraft(page, ISW);
    await expect(page.getByTestId('axis-gizmo')).toBeVisible();
    const av = await page.evaluate(() => (window as unknown as Win).__ARCHEAN__!.axis());
    expect(av.map(x => x.k).sort()).toEqual(['x', 'y', 'z']);
    for (const x of av) {
      expect(Number.isFinite(x.sx)).toBe(true);
      expect(Number.isFinite(x.sy)).toBe(true);
      expect(Math.abs(x.toward)).toBeLessThanOrEqual(1.001);
    }
  });

  test('clicking a compass head flies the camera along that axis', async ({ page }) => {
    desktopOnly();
    await openCraft(page, ISW);
    await page.getByTestId('axis-view-x').click();
    await page.waitForTimeout(250);
    const px = await camPos(page);
    await page.getByTestId('axis-view-y').click();
    await page.waitForTimeout(250);
    const py = await camPos(page);
    // X view: eye at cx+d; Y view: eye at cy+d. d ≥ 3.6 ⇒ the dominant
    // coordinates separate by roughly the framing distance each way.
    expect(px[0] - py[0]).toBeGreaterThan(1);        // X view is +x-ward
    expect(py[1] - px[1]).toBeGreaterThan(1);        // Y view is up
    // the faded TAIL dot views the same axis from the opposite side
    await page.getByTestId('axis-view-x-back').click();
    await page.waitForTimeout(250);
    const pxb = await camPos(page);
    expect(px[0] - pxb[0]).toBeGreaterThan(1);       // opposite sides of the craft
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
