// viewmenu.spec.ts — v1.9.2 THE VIEW MENU (user: "The ground being solid and
// not se through is unacceptable, it shouldnt be like that, can we instead
// use an equi backdrop from a free site like pixabay, mars and earth and non
// as options, in the cog menu, rename that to view because, under view also
// add a mode for orthogonal"):
//  • the ⚙ popover IS the View menu (section header "View") and carries the
//    sky-backdrop segment (none/mars/earth) + the orthographic row;
//  • the ground pad is SEE-THROUGH — asserted on FRAMEBUFFER PIXELS:
//    Engine.probePixel forces one fresh frame, the raw GL context reads it
//    (pixels, not intent). The band under the craft shows SKY between the
//    grid lines; the OLD opaque green sheet made EVERY band pixel green;
//  • a backdrop really swaps the sky dome (pixels change; 'none' restores);
//  • ORTHOGRAPHIC mode is truly parallel: an off-axis point displaced 1 m
//    along the sight axis projects 0 px apart (perspective moves it
//    clearly), the swap round-trips the framing, key 5 toggles, and BOTH
//    the projection and the backdrop persist across a reload.
import { expect, test, type Page } from '@playwright/test';

const ISW = '3812927875';

type ViewState = { proj: 'perspective' | 'orthographic';
  eye: [number, number, number]; target: [number, number, number]; zoom: number };
type Win = { __ARCHEAN__?: {
  view(): ViewState;
  backdrop(): { current: 'none' | 'mars' | 'earth'; ready: boolean; dome: boolean };
  screen(x: number, y: number, z: number): [number, number] | null;
  pixel(u: number, v: number): [number, number, number] | null;
  grid(): { step: number } | null;
} };

const viewOf = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__ARCHEAN__!.view());
const backdropOf = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__ARCHEAN__!.backdrop());
const pixelOf = (page: Page, u: number, v: number) =>
  page.evaluate(({ u, v }) => (window as unknown as Win).__ARCHEAN__!.pixel(u, v), { u, v });
/** screen-space length of a 1 m step ALONG THE SIGHT AXIS taken 1 m off
 *  the axis (through the orbit target, straight up). Perspective: the step
 *  toward the eye magnifies → several px. Orthographic: exactly 0 — that
 *  IS the definition of a parallel projection. */
const axialPx = (page: Page) => page.evaluate(() => {
  const h = (window as unknown as Win).__ARCHEAN__!, v = h.view();
  const d = [v.eye[0] - v.target[0], v.eye[1] - v.target[1], v.eye[2] - v.target[2]];
  const L = Math.hypot(d[0], d[1], d[2]);
  const A: [number, number, number] = [v.target[0], v.target[1] + 1, v.target[2]];
  const B: [number, number, number] = [A[0] + d[0] / L, A[1] + d[1] / L, A[2] + d[2] / L];
  const sa = h.screen(A[0], A[1], A[2])!, sb = h.screen(B[0], B[1], B[2])!;
  return Math.hypot(sa[0] - sb[0], sa[1] - sb[1]);
});

async function openCraft(page: Page, id: string) {
  await page.goto(`/?craft=${id}`);
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
}
const openMenu = async (page: Page) => {
  await page.getByTestId('toggle-options').click();
  await expect(page.getByTestId('options-win')).toBeVisible();
};
const far = (a: number[], b: number[]) =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

test.describe('view menu: see-through ground, sky backdrops, ortho @ui', () => {
  const desktopOnly = () => test.skip(test.info().project.name !== 'chromium', 'desktop-only');

  test('the ⚙ popover is the VIEW menu with the new rows', async ({ page }) => {
    await openCraft(page, ISW);
    await openMenu(page);
    // renamed by the user rule: the section header says "View"
    await expect(page.getByTestId('viewopts').locator('h3')).toHaveText('View');
    for (const b of ['none', 'mars', 'earth'])
      await expect(page.getByTestId(`backdrop-${b}`)).toBeVisible();
    await expect(page.getByTestId('opt-ortho')).toBeVisible();
  });

  test('the ground pad is SEE-THROUGH — the band under the craft shows SKY', async ({ page }) => {
    desktopOnly();
    await openCraft(page, ISW);
    // the pad mesh stays (invisible) as the PICK pad — three's Raycaster
    // ignores visibility, so the coord-readout chip keeps its ground hit
    // (views.spec pins that); what must be GONE is the rendered sheet.
    // A DENSE scan of the band rows (u 0.1..0.9, two rows): sky pixels
    // read b > g (flat sky #8fb4d8 is blue-dominant), the green minority
    // is ONLY the grid lines + their antialiased blends. The OLD solid
    // sheet made every band pixel green (g > b) — both fractions invert.
    // ONE evaluate for the whole scan: 75 separate round-trips blew the
    // poll budget (each probe renders + flushes the GPU).
    const scan = () => page.evaluate(() => {
      const h = (window as unknown as Win).__ARCHEAN__!;
      let sky = 0, green = 0, n = 0;
      for (const v of [0.84, 0.9])
        for (let i = 0; i < 25; i++) {
          const p = h.pixel(0.1 + 0.8 * (i / 24), v);
          if (!p) continue;
          n++;
          if (p[2] > p[1]) sky++; else if (p[1] > p[2]) green++;
        }
      return { sky: sky / n, green: green / n };
    });
    await expect.poll(async () => (await scan()).sky, { timeout: 20_000 })
      .toBeGreaterThan(0.5);
    await expect.poll(async () => (await scan()).green, { timeout: 20_000 })
      .toBeLessThan(0.5);
  });

  test('backdrop mars/earth swap the sky dome; none restores', async ({ page }) => {
    desktopOnly();
    await openCraft(page, ISW);
    await expect.poll(() => backdropOf(page)).toEqual({ current: 'none', ready: true, dome: false });
    const sky0 = (await pixelOf(page, 0.5, 0.03))!;
    // 'none' = the flat sky colour #8fb4d8
    expect(far(sky0, [143, 180, 216])).toBeLessThan(24);
    await openMenu(page);
    for (const b of ['mars', 'earth'] as const) {
      await page.getByTestId(`backdrop-${b}`).click();
      await expect.poll(() => backdropOf(page), { timeout: 10_000 })
        .toEqual({ current: b, ready: true, dome: true });
      // the dome is LIVE geometry: the sky pixel is a PANORAMA colour
      // (real dusk sky / terrain), not the flat one
      const p = (await pixelOf(page, 0.5, 0.03))!;
      expect(far(p, sky0)).toBeGreaterThan(30);
    }
    await page.getByTestId('backdrop-none').click();
    await expect.poll(() => backdropOf(page)).toEqual({ current: 'none', ready: true, dome: false });
    await expect.poll(async () => far((await pixelOf(page, 0.5, 0.03))!, sky0))
      .toBeLessThan(8);
  });

  test('ortho mode: parallel, framed, keyed, persisted', async ({ page }) => {
    desktopOnly();
    await openCraft(page, ISW);
    const before = (await viewOf(page)).eye;
    // baseline: perspective MOVES an axial 1 m step on screen
    await expect.poll(() => axialPx(page)).toBeGreaterThan(3);
    await openMenu(page);
    await page.getByTestId('opt-ortho').check();
    await expect.poll(async () => (await viewOf(page)).proj).toBe('orthographic');
    // THE PARALLEL LAW: along-sight displacement projects NOTHING
    expect(await axialPx(page)).toBeLessThan(0.5);
    // the adaptive grid keeps planning in ortho (px scale rides the frustum)
    const g = await page.evaluate(() => (window as unknown as Win).__ARCHEAN__!.grid());
    expect(g!.step).toBeGreaterThan(0);
    // framing round-trip: back to perspective lands on the SAME eye
    await page.getByTestId('opt-ortho').uncheck();
    await expect.poll(async () => (await viewOf(page)).proj).toBe('perspective');
    const after = (await viewOf(page)).eye;
    for (let i = 0; i < 3; i++) expect(Math.abs(after[i] - before[i])).toBeLessThan(1e-3);
    // the KEY (Blender's numpad-5 habit) flips both ways — first BLUR the
    // checkbox we just clicked, the key handler (like every editor key)
    // stands down while a text INPUT has focus
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('5');
    await expect.poll(async () => (await viewOf(page)).proj).toBe('orthographic');
    // and the CHOICE SURVIVES A RELOAD (persisted, like the mirror axis)
    await page.reload();
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await expect.poll(async () => (await viewOf(page)).proj).toBe('orthographic');
    expect(await axialPx(page)).toBeLessThan(0.5);
    // THE SKY STAYS A DOME IN ORTHO (user: "it shouldnt orthographically
    // project our skybox into being a cube"): the backdrop is a BackSide
    // sphere riding the eye, so the panorama renders in ortho AND its top
    // band stays SMOOTH — a background-texture projection corners the pano
    // into cube walls (measured: dome corner↔centre ≤ 20, walls ≫ 60)
    await openMenu(page);
    await page.getByTestId('backdrop-mars').click();
    await expect.poll(() => backdropOf(page), { timeout: 10_000 })
      .toEqual({ current: 'mars', ready: true, dome: true });
    const band = await page.evaluate(() => {
      const h = (window as unknown as Win).__ARCHEAN__!;
      return [h.pixel(0.05, 0.05)!, h.pixel(0.5, 0.05)!, h.pixel(0.95, 0.05)!];
    });
    expect(far(band[0], band[2])).toBeLessThan(60);
    // and the sky is genuinely the panorama, not the flat fallback colour
    expect(far(band[1], [143, 180, 216])).toBeGreaterThan(30);
    await page.getByTestId('backdrop-none').click();
  });

  test('the backdrop choice persists across a reload', async ({ page }) => {
    desktopOnly();
    await openCraft(page, ISW);
    await openMenu(page);
    await page.getByTestId('backdrop-mars').click();
    await expect.poll(() => backdropOf(page)).toEqual({ current: 'mars', ready: true, dome: true });
    await page.reload();
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await expect.poll(() => backdropOf(page), { timeout: 10_000 })
      .toEqual({ current: 'mars', ready: true, dome: true });
  });

  test('phone: the View menu reaches the new rows', async ({ page }) => {
    test.skip(test.info().project.name === 'chromium', 'phone-only');
    await openCraft(page, ISW);
    await openMenu(page);
    await expect(page.getByTestId('backdrop-earth')).toBeVisible();
    await expect(page.getByTestId('opt-ortho')).toBeVisible();
    await page.getByTestId('opt-ortho').check();
    await expect.poll(async () => (await viewOf(page)).proj).toBe('orthographic');
  });
});
