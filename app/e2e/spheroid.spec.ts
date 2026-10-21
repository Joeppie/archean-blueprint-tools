// spheroid.spec.ts — the v1.6 TOOLS ▸ Spheroid PLACEMENT tool (the user's
// feature: "generate a spheroid out of blocks … it should be movable and its
// label should have a cancel and build button, that appears AFTER the tool
// window where you ok off on material, color, solid, size (dynamic, stretch
// it)"). Pins:
//  • the dialog's SLIDERS retune the block plan LIVE (the preview line and
//    the ghost count move with the size fields);
//  • OK ▸ Confirm CLOSES the dialog and opens a MOVABLE cluster ghost on the
//    widget (shown = pixels, not intent) with the ✕ Cancel / ✔ Build label;
//  • ✔ Build writes EVERY block into bp AND the doc — the scene reloads
//    (stats().loads strictly increases, the AGENTS repaint rule), the debug
//    title counts them, a new palette slot carries the chosen RGB — and
//    Ctrl+Z takes the WHOLE spheroid back as one step (doc mirror proof);
//  • ✕ Cancel (and Esc) drop the ghost with the file untouched;
//  • a colliding placement turns the ghost red and DISABLES Build (the
//    constructor-ghost contract) — the refused drop writes nothing.
import { expect, test, type Page } from '@playwright/test';

type Blk = { pos_x: number; size_x: number; type: number };
type Ghost = { blocks: number; offset: [number, number, number]; valid: boolean; shown: boolean } | null;

const bpData = (page: Page) => page.evaluate(() =>
  (window as unknown as { __ARCHEAN__: { engine: { blueprint: { data: {
    blocks: Blk[]; colors?: (Record<string, number> | null)[] } } } } }).__ARCHEAN__.engine.blueprint.data);

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

/** open Tools ▸ Spheroid, (optionally) stretch the axes, OK ▸ Confirm */
async function stage(page: Page, over: { rx?: number; ry?: number; rz?: number } = {}) {
  await page.getByTestId('tools-menu').click();
  await page.getByTestId('tool-spheroid').click();
  await expect(page.getByTestId('tool-dialog-spheroid')).toBeVisible();
  for (const [k, v] of Object.entries(over)) await setRange(page, k, v);
  await page.getByTestId('tool-ok').click();
  await expect(page.getByTestId('tool-confirm-box')).toBeVisible();
  await page.getByTestId('tool-confirm').click();
  await expect(page.getByTestId('tool-dialog-spheroid')).toBeHidden();
  await expect(page.getByTestId('place-label')).toBeVisible({ timeout: 5_000 });
}

const toastText = (page: Page) => page.locator('[data-testid="tool-toast"]').textContent();
const toastCount = async (page: Page) =>
  +(await toastText(page))!.match(/: (\d+) blocks/)![1]!;

test.describe('spheroid tool: dialog → movable ghost → cancel/build @ui', () => {
  test('the size sliders are dynamic (the plan retunes live)', async ({ page }) => {
    await openNew(page);
    await page.getByTestId('tools-menu').click();
    await page.getByTestId('tool-spheroid').click();
    const p1 = await page.locator('[data-testid="tool-preview"]').textContent();
    await setRange(page, 'rx', 2);
    await setRange(page, 'rz', 0.5);
    const p2 = await page.locator('[data-testid="tool-preview"]').textContent();
    expect(p1).not.toBe(p2);                                    // stretched plan
    expect(p2).toContain('blocks');
    const n1 = +(p1!.match(/(\d+) blocks/)![1]!);
    const n2 = +(p2!.match(/(\d+) blocks/)![1]!);
    expect(n2).toBeGreaterThan(0);
    expect(n2).not.toBe(n1);
    await page.getByTestId('tool-cancel').click();
  });

  test('OK opens a movable ghost with a Cancel/Build label; Build writes it, undo reverts it', async ({ page }) => {
    await openNew(page);
    const before = (await bpData(page)).blocks.length;
    expect(before).toBe(5);                                     // the deck plate
    const l0 = await loads(page);
    await stage(page, { rx: 1.5, ry: 1, rz: 1 });

    const g = await ghost(page);
    expect(g).not.toBeNull();
    expect(g!.blocks).toBeGreaterThan(40);                      // a real cluster
    expect(g!.offset).toEqual([0, 0, 0]);
    expect(g!.valid).toBe(true);
    expect(g!.shown).toBe(true);                                // the WIDGET is on it

    // MOVABLE like a block: the whole-cell nudge (the widget commit routes
    // through this exact offset path)
    expect(await shift(page, [4, 0, 0])).toBe(true);
    const g2 = await ghost(page);
    expect(g2!.offset).toEqual([4, 0, 0]);
    expect(g2!.valid).toBe(true);

    await page.getByTestId('place-build').click();
    await expect(page.getByTestId('place-label')).toBeHidden();
    expect(await ghost(page)).toBeNull();
    const built = await toastCount(page);
    expect(built).toBeGreaterThanOrEqual(g!.blocks);            // frame splits only ADD
    expect((await bpData(page)).blocks.length).toBe(before + built);
    // PAINT: '+ new palette slot' wrote the chosen RGB into a NEW slot
    const colors = await page.evaluate(() =>
      (window as unknown as { __ARCHEAN__: { engine: { blueprint: { data: {
        colors?: (unknown | null)[] } } } } }).__ARCHEAN__.engine.blueprint.data.colors ?? []);
    expect(colors.filter(c => c).length).toBeGreaterThanOrEqual(1);
    // the scene REBUILT around the new blocks (AGENTS: assert through loads
    // + the MERGED batch stats — the debug TITLE only re-arms on a bp swap,
    // and this commit rides the same-bp reload path)
    await expect.poll(() => loads(page), { timeout: 10_000 }).toBeGreaterThan(l0);
    await expect.poll(async () => page.evaluate(() =>
      (window as unknown as { __ARCHEAN__: { stats: () => { blocks: number } } }).__ARCHEAN__.stats().blocks),
    { timeout: 15_000 }).toBe(before + built);

    // one Undo = the whole spheroid back (the doc mirrored EVERY insert)
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
    // and the label's ✕ twin: Escape
    await stage(page);
    expect(await ghost(page)).not.toBeNull();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('place-label')).toBeHidden();
    expect(await ghost(page)).toBeNull();
    expect((await bpData(page)).blocks).toEqual(before.blocks);
  });

  test('a placement that collides turns RED and refuses Build', async ({ page }) => {
    await openNew(page);
    const before = (await bpData(page)).blocks.length;
    await stage(page);
    // shove it DOWN into the deck plate (cells y=5) — collides
    expect(await shift(page, [0, -4, 0])).toBe(false);
    const g = await ghost(page);
    expect(g!.valid).toBe(false);
    await expect(page.getByTestId('place-build')).toBeDisabled();
    await expect(page.getByTestId('place-label')).toContainText('collides');
    expect((await bpData(page)).blocks.length).toBe(before);
    // mint again: pull it clear, Build re-arms
    expect(await shift(page, [0, 6, 0])).toBe(true);
    await expect(page.getByTestId('place-build')).toBeEnabled();
    await page.getByTestId('place-cancel').click();
    expect((await bpData(page)).blocks.length).toBe(before);
  });
});
