// views.spec.ts — v1.5.21/23 orientation & ground batch (user: "grid needs
// to fit build comfortably. Probably granularity depending on zoom 1x or 5,
// 10, depending"; "mirror axes should be settable. Game is not hardcoded
// x"; "a small black label to indicate grid position on the corners of the
// displayed grid under cursor … get the full x-y-z of a chosen location";
// "Is x-y the plane that is flat, and Z up, or is that Y? please check" —
// CHECKED: FORMAT §world maths: x lateral, y = UP, z longitudinal (nose
// −z); the flat plane is x–z. The pins below assert the readout follows
// that law."):
//  • the ground grid COVERS the build footprint,
//  • the coord chip reads the full SNAPPED x/y/z on the visible ladder,
//  • hovering the CRAFT raytraces the SURFACE (y rises — the y=UP law),
//  • the pad carries ±X/±Z axis markers,
//  • the ⚙ mirror-axis row (X/Y/Z ⊕ ⊘) is live on the engine, ONE AXIS AT
//    A TIME (v1.11: twin pairs are live only on the session axis).
//
// v1.12.1 CHAIN LAW (we: "string tests together so one test asserts many
// things, without cutting itself short"): the six former tests shared one
// boot and one mode, so they run as TWO chained tests over TWO boots —
// probe laws (no state mutation) then the settings round-trip (mutates
// localStorage). Every law is an expect.soft() inside a named test.step:
// a violation is REPORTED AND THE CHAIN CONTINUES — the report names
// every law that broke, never just the first. Only the boot gate and
// steps that truly invalidate later state stay hard.
import { expect, test, type Page } from '@playwright/test';

const ISW = '3812927875';

type Grid = { step: number; major: number; halfX: number; halfZ: number; cx: number; cz: number; y: number };
type Win = { __ARCHEAN__?: {
  engine: {
    blueprint: { box_min: { x: number; y: number; z: number }; box_max: { x: number; y: number; z: number } } | null;
    twinPairsOf: (ci: number) => unknown[];
  };
  grid(): Grid | null;
  mirAxis(): 'x' | 'y' | 'z' | 'off';
  coord(): { x: number; y: number; z: number; step: number } | null;
  axis(): string[];
} };

const gridOf = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__ARCHEAN__!.grid());
const mirAxis = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__ARCHEAN__!.mirAxis());
const coordOf = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__ARCHEAN__!.coord());
const onLadder = (v: number, step: number) =>
  Math.abs(v / step - Math.round(v / step)) < 1e-6;

async function openCraft(page: Page, id: string) {
  await page.goto(`/?craft=${id}`);
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });   // hard gate
}

/** a pad pixel well below the framed craft (the default eye looks down,
 *  so the lower canvas band is ground) */
const padPixel = async (page: Page, fy = 0.78) => {
  const r = await page.getByTestId('canvas').boundingBox();
  return { x: r!.x + r!.width * 0.5, y: r!.y + r!.height * fy };
};

test.describe('coord readout + grid + axis markers + mirror axis @ui', () => {
  const desktopOnly = () => test.skip(test.info().project.name !== 'chromium', 'desktop-only');

  test('the pad readout, the surface raytrace, the axis markers and the grid footprint (one boot)', async ({ page }) => {
    desktopOnly();
    await openCraft(page, ISW);

    await test.step('pad chip: full SNAPPED x/y/z on the visible ladder, y = ground', async () => {
      const p = await padPixel(page);
      await page.mouse.move(p.x, p.y);
      await expect.poll(() => coordOf(page), { timeout: 5_000 }).not.toBeNull();   // hard gate: feeds the next steps
      const st = (await coordOf(page))!;
      const chip = page.getByTestId('coord-chip');
      await expect.soft(chip).toBeVisible();
      for (const k of ['x', 'y', 'z'] as const)
        expect.soft(onLadder(st[k], st.step), `${k} snapped onto the rung the grid draws`).toBe(true);
      const text = (await chip.textContent())!;
      for (const k of ['x', 'y', 'z']) expect.soft(text).toContain(k);
      // THE CONVENTION (FORMAT line 30): flat plane x–z, y UP — on the pad
      // y reads the (snapped) ground height, a clean rung value
      expect.soft(st.y, 'y reads the ground, not a horizontal axis').toBeLessThanOrEqual(0.5);
    });

    await test.step('hovering the CRAFT raytraces the SURFACE: y rises with it', async () => {
      const ground = (await coordOf(page))!;
      const r = await page.getByTestId('canvas').boundingBox();
      await page.mouse.move(r!.x + r!.width * 0.5, r!.y + r!.height * 0.45);
      await expect.poll(async () => {
        const c = await coordOf(page);
        return !!c && c.y > ground.y;               // y = UP (never z here)
      }, { timeout: 5_000 }).toBe(true);
      const surf = (await coordOf(page))!;
      expect.soft(onLadder(surf.y, surf.step), 'the surface y is snapped too').toBe(true);
    });

    await test.step('the pad carries ±X / ±Z axis markers (red x-line, blue z-line)', async () => {
      const labels = await page.evaluate(() =>
        (window as unknown as Win).__ARCHEAN__!.axis());
      expect.soft(labels, 'four axis labels').toEqual(
        expect.arrayContaining(['+x', '\u2212x', '+z', '\u2212z']));
    });

    await test.step('the grid covers the build footprint', async () => {
      await expect.poll(() => gridOf(page), { timeout: 10_000 }).not.toBeNull();
      const g = (await gridOf(page))!;
      const box = await page.evaluate(() => {
        const b = (window as unknown as Win).__ARCHEAN__!.engine.blueprint!;
        return { mn: [b.box_min.x, b.box_min.y, b.box_min.z] as number[],
          mx: [b.box_max.x, b.box_max.y, b.box_max.z] as number[] };
      });
      expect.soft(g.halfX, 'span x').toBeGreaterThanOrEqual((box.mx[0]! - box.mn[0]!) / 2);
      expect.soft(g.halfZ, 'span z').toBeGreaterThanOrEqual((box.mx[2]! - box.mn[2]!) / 2);
      expect.soft(g.cx - g.halfX).toBeLessThanOrEqual(box.mn[0]);
      expect.soft(g.cx + g.halfX).toBeGreaterThanOrEqual(box.mx[0]);
      expect.soft(g.cz - g.halfZ).toBeLessThanOrEqual(box.mn[2]);
      expect.soft(g.cz + g.halfZ).toBeGreaterThanOrEqual(box.mx[2]);
    });
  });

  // The settings chain: one boot, the FULL x→z→x→y→⊘→x round-trip in
  // order (the two former legs shared exactly this sequence split across
  // two boots). localStorage + twin-pair dormancy ride every flip.
  test('⚙ mirror axis: settable, twins live on the session axis, ⊘ OFF (one boot)', async ({ page }) => {
    desktopOnly();
    await openCraft(page, ISW);
    expect(await mirAxis(page)).toBe('x');         // hard gate: corpus default

    // v1.11.1 ONE AXIS AT A TIME (we: "The x axis is visible in a craft,
    // but this isn't synced with mirroring!"): twin PAIRS are live only on
    // the session axis — ISW's pairs (x) propagate under x and go DORMANT
    // the moment the axis flips.
    const pairCi = await page.evaluate(() => {
      const e = (window as unknown as { __ARCHEAN__?: { engine: {
        blueprint: { data: { components: unknown[] } };
        twinPairsOf: (ci: number) => unknown[] } } }).__ARCHEAN__!.engine;
      for (let i = 0; i < e.blueprint.data.components.length; i++)
        if (e.twinPairsOf(i).length) return i;
      return -1;
    });
    expect(pairCi, 'ISW carries a live twin pair under the default x axis').toBeGreaterThanOrEqual(0);
    const pairCount = (ci: number) =>
      page.evaluate((c) => (window as unknown as Win).__ARCHEAN__!.engine.twinPairsOf(c).length, ci);

    await page.getByTestId('toggle-options').click();

    await test.step('z: pair DORMANT, storage follows', async () => {
      await page.getByTestId('mirror-axis-z').click();
      await expect.poll(() => mirAxis(page)).toBe('z');
      expect.soft(await page.evaluate(() => localStorage.getItem('archean-app-mirror-axis'))).toBe('z');
      expect.soft(await pairCount(pairCi), 'the x pair is DORMANT under session z').toBe(0);
    });

    await test.step('back to x: pair WAKES', async () => {
      await page.getByTestId('mirror-axis-x').click();
      await expect.poll(() => mirAxis(page)).toBe('x');
      expect.soft(await pairCount(pairCi), 'switching the axis back WAKES the pair').toBeGreaterThanOrEqual(1);
    });

    await test.step('y is settable too', async () => {
      await page.getByTestId('mirror-axis-y').click();
      await expect.poll(() => mirAxis(page)).toBe('y');
    });

    await test.step('⊘ OFF disables the session plane (v1.10.5); x is the full round-trip home', async () => {
      await page.getByTestId('mirror-axis-off').click();
      await expect.poll(() => mirAxis(page)).toBe('off');
      expect.soft(await page.evaluate(() => localStorage.getItem('archean-app-mirror-axis'))).toBe('off');
      // and it goes back on: the session axis is a FULL round-trip, x/y/z ⊕ off
      await page.getByTestId('mirror-axis-x').click();
      await expect.poll(() => mirAxis(page)).toBe('x');   // hard: clean exit state
    });
  });

  // RETIRED v1.12.1 (L1): the step LADDER (0.25·{1,5,10,50,100} ∪ 0.05,
  // the 14-px flip) is fully pinned by grid.test.ts on plain node.
});
