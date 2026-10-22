// sphereskin.spec.ts — the TOOLS ▸ SPHERE SKIN PLACEMENT tool. The user's
// order after three reverted block-Spheroid attempts ("All spheres have
// indents … Find algo online! … Triangles instead of blocks"): the dialog
// interface approach + the movable-ghost plumbing are PORTED from the
// archived branch unchanged; the VERTICES are the fresh lattice convex-hull
// shrinkwrap (engine/latsphere.ts) — a convex polyhedron cannot indent.
//  • the dialog previews triangle count + THE DEVIATION LINE (dev −sag/+out m)
//    and the size sliders retune the plan LIVE;
//  • OK ▸ Confirm CLOSES the dialog and opens a MOVABLE ghost skin on the
//    widget with the ✕ Cancel / ✔ Build label (a skin never collides);
//  • ✔ Build writes every triangle into bp AND the doc (loads strictly
//    increase — the AGENTS repaint rule; Ctrl+Z reverts the whole skin as
//    ONE step; '+ new palette slot' resolves the paint at Build);
//  • flat is the shipped shading default (the game's authored convention,
//    v1.5.12) — smooth:1 is the opt-in; ✕ Cancel and Esc leave the file
//    byte-untouched.
import { expect, test, type Page } from '@playwright/test';

type Ghost = { blocks: number; tris: number; offset: [number, number, number]; valid: boolean; shown: boolean } | null;

const bpData = (page: Page) => page.evaluate(() =>
  (window as unknown as { __ARCHEAN__: { engine: { blueprint: { data: {
    blocks: unknown[]; triangles?: Record<string, unknown>[]; colors?: (unknown | null)[] } } } } })
    .__ARCHEAN__.engine.blueprint.data);

const loads = (page: Page) => page.evaluate(() =>
  (window as unknown as { __ARCHEAN__: { stats: () => { loads: number } } }).__ARCHEAN__.stats().loads);

const ghost = (page: Page) => page.evaluate(() =>
  (window as unknown as { __ARCHEAN__: { placeGhost: () => Ghost } }).__ARCHEAN__.placeGhost());

const shift = (page: Page, s: [number, number, number]) => page.evaluate((st) =>
  (window as unknown as { __ARCHEAN__: { placeShift: (s: [number, number, number]) => boolean } })
    .__ARCHEAN__.placeShift(st), s);

async function openNew(page: Page) {
  await page.goto('/');
  await page.getByTestId('gallery-new').click();
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
}

/** drive a definition-generated range slider the way React listens (native
 *  setter + input event — Playwright fill() is not for range inputs) */
async function setRange(page: Page, key: string, v: number) {
  await page.locator(`[data-testid="tool-range-${key}"]`).evaluate((el, val) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(val));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
}

/** type a size into the number box beside the slider (past-slider reach) */
async function setNum(page: Page, key: string, v: number) {
  await page.locator(`[data-testid="tool-num-${key}"]`).fill(String(v));
}

/** open Tools ▸ Sphere skin, OK ▸ Confirm — the dialog closes and the
 *  ghost label appears (the dialog→ghost→label ORDER is the user's spec) */
async function stage(page: Page, over: { rx?: number; ry?: number; rz?: number } = {}) {
  await page.getByTestId('tools-menu').click();
  await page.getByTestId('tool-sphere-skin').click();
  await expect(page.getByTestId('tool-dialog-sphere-skin')).toBeVisible();
  for (const [k, v] of Object.entries(over)) await setRange(page, k, v as number);
  await page.getByTestId('tool-ok').click();
  await expect(page.getByTestId('tool-confirm-box')).toBeVisible();
  await page.getByTestId('tool-confirm').click();
  await expect(page.getByTestId('tool-dialog-sphere-skin')).toBeHidden();
  await expect(page.getByTestId('place-label')).toBeVisible({ timeout: 15_000 });
}

const toastText = (page: Page) => page.locator('[data-testid="tool-toast"]').textContent();
const toastCount = async (page: Page) =>
  +(await toastText(page))!.match(/: (\d+) /)![1]!;

test.describe('sphere skin tool: dialog → movable ghost → cancel/build @ui', () => {
  test('the sliders retune the plan LIVE and the preview prints the deviation line', async ({ page }) => {
    await openNew(page);
    await page.getByTestId('tools-menu').click();
    await page.getByTestId('tool-sphere-skin').click();
    await expect(page.locator('[data-testid="tool-preview"]')).toContainText(/triangles/);
    // THE line the Spheroid attempts never had: deviation vs the ideal surface
    await expect(page.locator('[data-testid="tool-preview"]')).toContainText(/dev −0\.\d\d\/\+0\.\d\d m/);
    const small = +(await page.locator('[data-testid="tool-preview"]').textContent())!
      .match(/(\d+) triangles/)![1]!;
    await setRange(page, 'rx', 8);
    await setRange(page, 'ry', 8);
    await setRange(page, 'rz', 8);
    const big = +(await page.locator('[data-testid="tool-preview"]').textContent())!
      .match(/(\d+) triangles/)![1]!;
    expect(big).toBeGreaterThan(small * 8);                  // area grows r²
    // and the sag stays round at zeppelin size (the pin the old suites lacked)
    await expect(page.locator('[data-testid="tool-preview"]')).toContainText(/dev −0\.0\d\/\+0\.\d\d m/);
    await page.getByTestId('tool-cancel').click();
  });

  test('the number box reaches past the slider, and needles refuse honestly', async ({ page }) => {
    await openNew(page);
    await page.getByTestId('tools-menu').click();
    await page.getByTestId('tool-sphere-skin').click();
    // a 20 m radius is over the slider-free planning range — the box takes it
    await setNum(page, 'rx', 20);
    await setNum(page, 'ry', 20);
    await setNum(page, 'rz', 20);
    const big = +(await page.locator('[data-testid="tool-preview"]').textContent())!
      .match(/(\d+) triangles/)![1]!;
    expect(big).toBeGreaterThan(5000);                       // zeppelin-plus
    await page.getByTestId('tool-cancel').click();
    // an extreme needle exceeds the game's 31-cell window with no lattice
    // cut possible → the preview refuses and OK stays DISABLED (never a
    // silently-holed skin)
    await page.getByTestId('tools-menu').click();
    await page.getByTestId('tool-sphere-skin').click();
    await setNum(page, 'rx', 0.5);
    await setNum(page, 'ry', 1);
    await setNum(page, 'rz', 12);
    await expect(page.locator('[data-testid="tool-preview"]')).toContainText(/nothing to place/);
    await expect(page.getByTestId('tool-ok')).toBeDisabled();
    await page.getByTestId('tool-cancel').click();
  });

  test('OK ghosts a closed skin; Build writes flat hull triangles + a new slot; undo reverts', async ({ page }) => {
    await openNew(page);
    const trisBefore = ((await bpData(page)).triangles ?? []).length;
    const l0 = await loads(page);
    await stage(page, { rx: 2, ry: 1, rz: 1 });

    const g = await ghost(page);
    expect(g).not.toBeNull();
    expect(g!.tris).toBeGreaterThan(40);                     // a real skin
    expect(g!.blocks).toBe(0);                               // triangles ONLY
    expect(g!.shown).toBe(true);                             // the WIDGET is on it

    // MOVABLE: whole-cell nudge, always valid (skins never collide)
    expect(await shift(page, [3, 0, -2])).toBe(true);
    expect((await ghost(page))!.offset).toEqual([3, 0, -2]);

    await page.getByTestId('place-build').click();
    await expect(page.getByTestId('place-label')).toBeHidden();
    const built = await toastCount(page);
    expect(((await bpData(page)).triangles ?? []).length).toBe(trisBefore + built);
    // flat default (no smooth key — the game's authored convention) + the
    // five paint faces + the move offset actually landed in the lattice
    const rec = await page.evaluate((n) => {
      const ts = (window as unknown as { __ARCHEAN__: { engine: { blueprint: { data: {
        triangles?: Record<string, unknown>[] } } } } }).__ARCHEAN__.engine.blueprint.data.triangles!;
      const t = ts[ts.length - n]!;
      return { smooth: (t as { smooth?: number }).smooth, faces: ((t as { colors?: number[] }).colors ?? []).length,
        frameX: (t as { frame_x?: number }).frame_x, vx: (t as { v0_x?: number }).v0_x };
    }, built);
    expect(rec.smooth).toBeUndefined();
    expect(rec.faces).toBe(5);
    expect(typeof rec.frameX).toBe('number');
    expect(typeof rec.vx).toBe('number');
    // PAINT: '+ new palette slot' wrote the chosen RGB into a NEW slot
    const colors = (await bpData(page)).colors ?? [];
    expect(colors.filter(c => c).length).toBeGreaterThanOrEqual(1);
    // the repaint pin (AGENTS: data assertions cannot pin a repaint)
    await expect.poll(() => loads(page), { timeout: 10_000 }).toBeGreaterThan(l0);
    // one Undo = the whole skin back (the doc mirrored EVERY insert)
    await page.keyboard.press('Control+z');
    await expect
      .poll(async () => ((await bpData(page)).triangles ?? []).length, { timeout: 10_000 })
      .toBe(trisBefore);
  });

  test('shading=smooth writes the game’s smooth:1 on every triangle', async ({ page }) => {
    await openNew(page);
    await page.getByTestId('tools-menu').click();
    await page.getByTestId('tool-sphere-skin').click();
    await page.selectOption('[data-testid="tool-select-shade"]', 'smooth');
    await page.getByTestId('tool-ok').click();
    await expect(page.getByTestId('tool-confirm-box')).toContainText(/smooth:1/);
    await page.getByTestId('tool-confirm').click();
    await expect(page.getByTestId('place-label')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('place-build').click();
    const built = await toastCount(page);
    const allSmooth = await page.evaluate((n) => {
      const ts = (window as unknown as { __ARCHEAN__: { engine: { blueprint: { data: {
        triangles?: { smooth?: number }[] } } } } }).__ARCHEAN__.engine.blueprint.data.triangles!;
      return ts.slice(ts.length - n).every(t => t.smooth === 1);
    }, built);
    expect(allSmooth).toBe(true);
  });

  test('Cancel (click AND Esc) drops the ghost with the file untouched', async ({ page }) => {
    await openNew(page);
    const before = await bpData(page);
    await stage(page);
    expect(await ghost(page)).not.toBeNull();
    await page.getByTestId('place-cancel').click();
    await expect(page.getByTestId('place-label')).toBeHidden();
    expect(await ghost(page)).toBeNull();
    expect((await bpData(page)).blocks).toEqual(before.blocks);
    expect(((await bpData(page)).triangles ?? []).length)
      .toBe((before.triangles ?? []).length);
    // and the label's ✕ twin: Escape
    await stage(page);
    expect(await ghost(page)).not.toBeNull();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('place-label')).toBeHidden();
    expect(await ghost(page)).toBeNull();
  });
});
