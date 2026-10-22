// views.spec.ts — v1.5.21/22 orientation & ground batch (user: "grid needs
// to fit build comfortably. Probably granularity depending on zoom 1x or 5,
// 10, depending"; "mirror axes should be settable. Game is not hardcoded
// x"; "The indicator for xyz is useless. it must be on the grid, movable
// and where it snaps on the grid for horizontal, I want the coordinate also
// shown e.g. z 10.0 and a single line up and down for z, same segmenting
// for measuring, eyeballing"):
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
    camPos(): [number, number, number];
    blueprint: { box_min: { x: number; y: number; z: number }; box_max: { x: number; y: number; z: number } } | null;
  };
  grid(): Grid | null;
  mirAxis(): 'x' | 'y' | 'z';
  probe(): { x: number; y: number; z: number; step: number; visible: boolean };
  probePoint(w: 'base' | 'cap'): { x: number; y: number } | null;
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

test.describe('measure ruler + adaptive grid + settable mirror axis @ui', () => {
  const desktopOnly = () => test.skip(test.info().project.name !== 'chromium', 'desktop-only');

  const onLadder = (v: number, step: number) =>
    Math.abs(v / step - Math.round(v / step)) < 1e-6;

  test('the measure ruler sits ON the grid and reads z-up coordinates', async ({ page }) => {
    await openCraft(page, ISW);
    const st = await page.evaluate(() => (window as unknown as Win).__ARCHEAN__!.probe());
    expect(st.visible).toBe(true);                    // ⚙ default ON (m toggles)
    expect(st.step).toBeGreaterThan(0);
    expect(onLadder(st.z, st.step)).toBe(true);       // height snapped to the ladder
    expect(onLadder(st.x, st.step)).toBe(true);       // base sits on grid lines
    expect(onLadder(st.y, st.step)).toBe(true);
    // the default spot is just off the SIDE of the build (not the centre —
    // that is where the editor's clicks land), within reach of the pad
    const box = await page.evaluate(() => {
      const b = (window as unknown as Win).__ARCHEAN__!.engine.blueprint!;
      return { mn: [b.box_min.x, b.box_min.z], mx: [b.box_max.x, b.box_max.z] };
    });
    expect(st.x).toBeGreaterThan(box.mn[0]! - 8);
    expect(st.x).toBeLessThan(box.mx[0]! + 8);
  });

  test('dragging the puck moves the ruler along the grid, SNAPPED; orbit yields', async ({ page }) => {
    desktopOnly();
    await openCraft(page, ISW);
    const p0 = await page.evaluate(() => (window as unknown as Win).__ARCHEAN__!.probePoint('base'));
    const s0 = await page.evaluate(() => (window as unknown as Win).__ARCHEAN__!.probe());
    const cam0 = await camPos(page);
    expect(p0).not.toBeNull();
    await page.mouse.move(p0!.x, p0!.y);
    await page.mouse.down();
    await page.mouse.move(p0!.x + 90, p0!.y - 40, { steps: 6 });
    await page.mouse.move(p0!.x + 160, p0!.y - 70, { steps: 6 });
    await page.mouse.up();
    const s1 = await page.evaluate(() => (window as unknown as Win).__ARCHEAN__!.probe());
    const moved = Math.hypot(s1.x - s0.x, s1.y - s0.y);
    expect(moved).toBeGreaterThan(0.5);               // it MOVED (non-vacuous)
    expect(onLadder(s1.x, s1.step)).toBe(true);       // … and SNAPPED onto the grid
    expect(onLadder(s1.y, s1.step)).toBe(true);
    const cam1 = await camPos(page);
    expect(Math.max(...cam0.map((v, i) => Math.abs(v - cam1[i]!)))).toBeLessThan(1e-6);
  });

  test('dragging the cap raises the z line and re-snaps the "z" readout', async ({ page }) => {
    desktopOnly();
    await openCraft(page, ISW);
    const p0 = await page.evaluate(() => (window as unknown as Win).__ARCHEAN__!.probePoint('cap'));
    const s0 = await page.evaluate(() => (window as unknown as Win).__ARCHEAN__!.probe());
    expect(p0).not.toBeNull();
    await page.mouse.move(p0!.x, p0!.y);
    await page.mouse.down();
    await page.mouse.move(p0!.x, p0!.y - 120, { steps: 8 });
    await page.mouse.up();
    const s1 = await page.evaluate(() => (window as unknown as Win).__ARCHEAN__!.probe());
    expect(s1.z).toBeGreaterThan(s0.z);               // screen-up = UP in z
    expect(onLadder(s1.z, s1.step)).toBe(true);       // "z 10.0"-clean rung steps
    // the horizontal spot stayed put under a vertical drag
    expect(s1.x).toBeCloseTo(s0.x, 6);
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
