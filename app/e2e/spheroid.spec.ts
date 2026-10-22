// spheroid.spec.ts — the v1.6 TOOLS ▸ Spheroid PLACEMENT tool (the user's
// feature: "generate a spheroid out of blocks … it should be movable and its
// label should have a cancel and build button, that appears AFTER the tool
// window where you ok off on material, color, solid, size (dynamic, stretch
// it)"), v1.6.1 rework per the same user's verdict ("the outside geometry is
// jagged … can you maybe do it with just triangles instead … size needs much
// larger if we will create zeppelins"):
//  • the dialog offers SKIN (hull triangles, up to 24 m axes) / SOLID blocks
//    / SHELL blocks; the size sliders retune the plan LIVE;
//  • OK ▸ Confirm CLOSES the dialog and opens a MOVABLE ghost (blocks or a
//    watertight triangle skin) on the widget with the ✕ Cancel / ✔ Build label;
//  • ✔ Build writes every block/triangle into bp AND the doc (loads strictly
//    increase — the AGENTS repaint rule; Ctrl+Z reverts the whole shape as
//    one step); SKIN grows data.triangles with smooth:1, blocks grow data.blocks;
//  • ✕ Cancel (and Esc) leave the file untouched; a BLOCK placement that
//    collides turns red and disables Build (a skin never collides).
import { expect, test, type Page } from '@playwright/test';

type Blk = { pos_x: number; size_x: number; type: number };
type Ghost = { blocks: number; tris: number; offset: [number, number, number]; valid: boolean; shown: boolean } | null;

const bpData = (page: Page) => page.evaluate(() =>
  (window as unknown as { __ARCHEAN__: { engine: { blueprint: { data: {
    blocks: Blk[]; triangles?: unknown[]; colors?: (unknown | null)[] } } } } }).__ARCHEAN__.engine.blueprint.data);

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

async function setFill(page: Page, fill: 'solid' | 'shell' | 'skin') {
  await page.selectOption('[data-testid="tool-select-fill"]', fill);
}

/** open Tools ▸ Spheroid, (optionally) pick a mode + stretch the axes,
 *  OK ▸ Confirm — the dialog closes and the ghost label appears */
async function stage(page: Page, over: { fill?: 'solid' | 'shell' | 'skin'; rx?: number; ry?: number; rz?: number } = {}) {
  await page.getByTestId('tools-menu').click();
  await page.getByTestId('tool-spheroid').click();
  await expect(page.getByTestId('tool-dialog-spheroid')).toBeVisible();
  if (over.fill) await setFill(page, over.fill);
  for (const [k, v] of Object.entries(over))
    if (k !== 'fill') await setRange(page, k, v);
  await page.getByTestId('tool-ok').click();
  await expect(page.getByTestId('tool-confirm-box')).toBeVisible();
  await page.getByTestId('tool-confirm').click();
  await expect(page.getByTestId('tool-dialog-spheroid')).toBeHidden();
  await expect(page.getByTestId('place-label')).toBeVisible({ timeout: 5_000 });
}

const toastText = (page: Page) => page.locator('[data-testid="tool-toast"]').textContent();
const toastCount = async (page: Page) =>
  +(await toastText(page))!.match(/: (\d+) /)![1]!;

test.describe('spheroid tool: dialog → movable ghost → cancel/build @ui', () => {
  test('the size sliders are dynamic and the mode changes the unit', async ({ page }) => {
    await openNew(page);
    await page.getByTestId('tools-menu').click();
    await page.getByTestId('tool-spheroid').click();
    // the shipped default is the SKIN: the readout counts triangles
    await expect(page.locator('[data-testid="tool-preview"]')).toContainText(/triangles/);
    await setRange(page, 'rx', 8);
    const big = await page.locator('[data-testid="tool-preview"]').textContent();
    const bigN = +(big!.match(/(\d+) triangles/)![1]!);
    expect(bigN).toBeGreaterThan(200);                       // zeppelin scale
    await setFill(page, 'solid');
    await setRange(page, 'rx', 1);
    await expect(page.locator('[data-testid="tool-preview"]')).toContainText(/blocks/);
    await page.getByTestId('tool-cancel').click();
  });

  test('SKIN: OK ghosts a watertight skin; Build writes smooth hull triangles; undo reverts', async ({ page }) => {
    await openNew(page);
    const trisBefore = ((await bpData(page)).triangles ?? []).length;
    const l0 = await loads(page);
    await stage(page, { rx: 2, ry: 1, rz: 1 });

    const g = await ghost(page);
    expect(g).not.toBeNull();
    expect(g!.tris).toBeGreaterThan(150);                   // a real skin
    expect(g!.shown).toBe(true);                            // the WIDGET is on it

    // MOVABLE: whole-cell nudge, always valid (skins never collide)
    expect(await shift(page, [3, 0, -2])).toBe(true);
    expect((await ghost(page))!.offset).toEqual([3, 0, -2]);

    await page.getByTestId('place-build').click();
    await expect(page.getByTestId('place-label')).toBeHidden();
    const built = await toastCount(page);
    expect(((await bpData(page)).triangles ?? []).length).toBe(trisBefore + built);
    // smooth:1 (the sheet-hull shading) + five paint faces on every triangle
    const painted = await page.evaluate((n) => {
      const ts = (window as unknown as { __ARCHEAN__: { engine: { blueprint: { data: {
        triangles?: { smooth?: number; colors?: number[] }[] } } } } }).__ARCHEAN__.engine.blueprint.data.triangles!;
      const t = ts[ts.length - n]!;
      return { smooth: t.smooth, faces: t.colors?.length ?? 0 };
    }, built);
    expect(painted.smooth).toBe(1);
    expect(painted.faces).toBe(5);
    await expect.poll(() => loads(page), { timeout: 10_000 }).toBeGreaterThan(l0);
    // one Undo = the whole skin back (the doc mirrored EVERY insert)
    await page.keyboard.press('Control+z');
    await expect
      .poll(async () => ((await bpData(page)).triangles ?? []).length, { timeout: 10_000 })
      .toBe(trisBefore);
  });

  test('SOLID blocks: ghost count matches the Build write; undo reverts', async ({ page }) => {
    await openNew(page);
    const before = (await bpData(page)).blocks.length;
    expect(before).toBe(5);                                 // the deck plate
    await stage(page, { fill: 'solid', rx: 1.5, ry: 1, rz: 1 });
    const g = await ghost(page);
    expect(g!.blocks).toBeGreaterThan(40);
    expect(await shift(page, [4, 0, 0])).toBe(true);
    await page.getByTestId('place-build').click();
    const built = await toastCount(page);
    expect((await bpData(page)).blocks.length).toBe(before + built);
    // PAINT: '+ new palette slot' wrote the chosen RGB into a NEW slot
    const colors = await page.evaluate(() =>
      (window as unknown as { __ARCHEAN__: { engine: { blueprint: { data: {
        colors?: (unknown | null)[] } } } } }).__ARCHEAN__.engine.blueprint.data.colors ?? []);
    expect(colors.filter(c => c).length).toBeGreaterThanOrEqual(1);
    await page.keyboard.press('Control+z');
    await expect
      .poll(async () => (await bpData(page)).blocks.length, { timeout: 10_000 })
      .toBe(before);
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

  test('a BLOCK placement that collides turns RED and refuses Build', async ({ page }) => {
    await openNew(page);
    const before = (await bpData(page)).blocks.length;
    await stage(page, { fill: 'solid' });
    // shove it DOWN into the deck plate (cells y=5) — collides
    expect(await shift(page, [0, -4, 0])).toBe(false);
    expect((await ghost(page))!.valid).toBe(false);
    await expect(page.getByTestId('place-build')).toBeDisabled();
    await expect(page.getByTestId('place-label')).toContainText('collides');
    // mint again: pull it clear, Build re-arms
    expect(await shift(page, [0, 6, 0])).toBe(true);
    await expect(page.getByTestId('place-build')).toBeEnabled();
    await page.getByTestId('place-cancel').click();
    expect((await bpData(page)).blocks.length).toBe(before);
  });
});
