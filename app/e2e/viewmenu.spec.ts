// viewmenu.spec.ts — v1.9.2 THE VIEW MENU (user: "The ground being solid and
// not se through is unacceptable, it shouldnt be like that, can we instead
// use an equi backdrop from a free site like pixabay, mars and earth and non
// as options, in the cog menu, rename that to view because, under view also
// add a mode for orthogonal"):
//  • the ⚙ popover IS the View menu (section header "View") and carries the
//    sky-backdrop segment (none + every name in the backdrop manifest) + the
//    orthographic row;
//  • the ground pad is SEE-THROUGH — asserted on FRAMEBUFFER PIXELS:
//    Engine.probePixel forces one fresh frame, the raw GL context reads it
//    (pixels, not intent). The band under the craft shows SKY between the
//    grid lines; the OLD opaque green sheet made EVERY band pixel green;
//  • a backdrop really swaps the sky dome (pixels change; 'none' restores);
//  • v1.9.4 (we: "keep the images in their own folder, with attribution and
//    a URL … make the code enumerate them automatically"): the rows and the
//    swap list are read FROM THE MANIFEST (src/assets/backdrops/manifest.json
//    + the *.jpg next to it) — a new entry appears in the menu and in THIS
//    pin without touching either;
//  • ORTHOGRAPHIC mode is truly parallel: an off-axis point displaced 1 m
//    along the sight axis projects 0 px apart (perspective moves it
//    clearly), the swap round-trips the framing, key 5 toggles, and BOTH
//    the projection and the backdrop persist across a reload.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const ISW = '3812927875';

/** THE ENUMERATION PIN: the menu builds its rows from the manifest, so the
 *  expectations read the SAME file — add a panorama (jpg + manifest entry)
 *  and every backdrop pin below covers it automatically. */
const MANIFEST = JSON.parse(readFileSync(
  new URL('../src/assets/backdrops/manifest.json', import.meta.url), 'utf8',
)) as { backdrops: { name: string; file: string }[] };
const NAMES = ['none', ...MANIFEST.backdrops.map(b => b.name)];
/** the fresh-profile backdrop from the manifest (v1.9.4 "make sky backdrop
 *  default") — the boot expectation follows the DATA, never a constant */
const DEF = (MANIFEST as { default?: string }).default ?? 'none';
/** a real panorama for the tests that need ONE (no name is hardcoded — the
 *  retired mars/earth were exactly such a pin; the manifest is the source) */
const FIRST = MANIFEST.backdrops[0]!.name;
// every manifest file must actually sit in the folder (vite's build-time
// glob can only enumerate what is there — fail early, not as a silent 404)
for (const b of MANIFEST.backdrops)
  readFileSync(new URL(`../src/assets/backdrops/${b.file}`, import.meta.url));

type ViewState = { proj: 'perspective' | 'orthographic';
  eye: [number, number, number]; target: [number, number, number]; zoom: number };
type Win = { __ARCHEAN__?: {
  view(): ViewState;
  backdrop(): { current: string; ready: boolean; dome: boolean };
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

  test('the VIEW menu: popover rows, see-through pad, backdrop swaps + persistence (one boot)', async ({ page }) => {
    desktopOnly();
    await openCraft(page, ISW);

    await test.step('BOOT DEFAULT (v1.9.4, we: "make sky backdrop default"): a fresh profile starts ON the manifest default panorama', async () => {
      await expect.poll(() => backdropOf(page), { timeout: 15_000 })
        .toEqual({ current: DEF, ready: true, dome: DEF !== 'none' });
    });

    await test.step('the ⚙ popover is the VIEW menu with the new rows', async () => {
      await openMenu(page);
      // renamed by the user rule: the section header says "View"
      expect.soft(page.getByTestId('viewopts').locator('h3')).toHaveText('View');
      for (const b of NAMES)
        expect.soft(page.getByTestId(`backdrop-${b}`), `row backdrop-${b}`).toBeVisible();
      expect.soft(page.getByTestId('opt-ortho')).toBeVisible();
    });

    // The scan's discriminator (sky-blue vs the OLD solid green SHEET) is
    // read in FLAT-SKY mode: since v1.9.4 the default is a panorama, whose
    // terrain seen THROUGH the pad could be green as well. ⊘ first; the
    // swap steps below cover the panoramas themselves.
    await test.step('the ground pad is SEE-THROUGH — the band under the craft shows SKY', async () => {
      await page.getByTestId('backdrop-none').click();
      await expect.poll(() => backdropOf(page), { timeout: 10_000 })
        .toEqual({ current: 'none', ready: true, dome: false });
      // the pad mesh stays (invisible) as the PICK pad — three's Raycaster
      // ignores visibility (views.spec pins the coord chip's ground hit);
      // what must be GONE is the rendered sheet. Sky pixels read b > g
      // (flat sky #8fb4d8); the OLD solid sheet made every band pixel
      // green. ONE evaluate for the whole scan: 75 round-trips blew the
      // poll budget.
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
      const s = await scan();
      expect.soft(s.sky, 'band under the craft is SKY').toBeGreaterThan(0.5);
      expect.soft(s.green, 'the green minority is only the grid lines').toBeLessThan(0.5);
    });

    await test.step('every manifest backdrop swaps the sky dome; none restores', async () => {
      const sky0 = (await pixelOf(page, 0.5, 0.03))!;
      // 'none' = the flat sky colour #8fb4d8
      expect.soft(far(sky0, [143, 180, 216]), 'flat sky colour').toBeLessThan(24);
      for (const b of NAMES.filter(n => n !== 'none')) {
        await page.getByTestId(`backdrop-${b}`).click();
        await expect.poll(() => backdropOf(page), { timeout: 10_000 })
          .toEqual({ current: b, ready: true, dome: true });
        // the dome is LIVE geometry: the sky pixel is a PANORAMA colour
        expect.soft(far((await pixelOf(page, 0.5, 0.03))!, sky0), `backdrop ${b} renders`).toBeGreaterThan(30);
      }
      await page.getByTestId('backdrop-none').click();
      await expect.poll(() => backdropOf(page)).toEqual({ current: 'none', ready: true, dome: false });
      expect.soft(await pixelOf(page, 0.5, 0.03)
        .then((p) => far(p!, sky0)), 'flat sky restored').toBeLessThan(8);
    });

    await test.step('the backdrop choice persists across a reload', async () => {
      await page.getByTestId(`backdrop-${FIRST}`).click();
      await expect.poll(() => backdropOf(page)).toEqual({ current: FIRST, ready: true, dome: true });
      await page.reload();
      await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });   // hard gate
      await expect.poll(() => backdropOf(page), { timeout: 10_000 })
        .toEqual({ current: FIRST, ready: true, dome: true });
    });
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
    await page.getByTestId(`backdrop-${FIRST}`).click();
    await expect.poll(() => backdropOf(page), { timeout: 10_000 })
      .toEqual({ current: FIRST, ready: true, dome: true });
    const band = await page.evaluate(() => {
      const h = (window as unknown as Win).__ARCHEAN__!;
      return [h.pixel(0.05, 0.05)!, h.pixel(0.5, 0.05)!, h.pixel(0.95, 0.05)!];
    });
    // v1.11.0 re-pin: the day-sky rig (LinearToneMapping + PMREM env, the
    // GAME-DAYLIGHT law) lifted the pano's corner↔centre delta to ~68 —
    // the law pinned here is dome-not-cube-wall, and a cube WALL is
    // hundreds apart on the same scan; 60 was the old studio-rig number.
    expect(far(band[0], band[2])).toBeLessThan(90);
    // and the sky is genuinely the panorama, not the flat fallback colour
    expect(far(band[1], [143, 180, 216])).toBeGreaterThan(30);
    await page.getByTestId('backdrop-none').click();
  });

  // RETIRED v1.12.1 (chain law): 'the backdrop choice persists across a
  // reload' is the persistence step of the VIEW-menu chain above — same
  // boot class, same state; one boot now covers four former tests.

  test('phone: the View menu reaches the new rows', async ({ page }) => {
    test.skip(test.info().project.name === 'chromium', 'phone-only');
    await openCraft(page, ISW);
    await openMenu(page);
    for (const b of NAMES)
      await expect(page.getByTestId(`backdrop-${b}`)).toBeVisible();
    await expect(page.getByTestId('opt-ortho')).toBeVisible();
    await page.getByTestId('opt-ortho').check();
    await expect.poll(async () => (await viewOf(page)).proj).toBe('orthographic');
  });
});
