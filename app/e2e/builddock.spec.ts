// builddock.spec.ts — the v1.10.6 BUILD WORKSPACE DOCK (we: "placing blocks
// isn't fun, and editing triangles also sucks. use the same kind of panel
// like for wires, also when placing we should be able to resize. Blocks
// don't currently let you make them square, just in 2 dimensions can you
// size"). Pins over the REAL editor:
//  • the blocks workspace is a WIDE BOTTOM DOCK (wire-dock twin),
//  • the block LIST selects (hover = gold 3D preview path), ✕ deletes
//    (one Ctrl+Z restores),
//  • the brush RESIZES WHILE PLACING: x/y/z axis pick, [ ] grow/shrink,
//    s squares — the chip + panel fields + the docked GHOST all follow,
//  • a block near a frame edge GROWS TO A SQUARE (the engine clamp fix),
//  • the TRIANGLE dock lists prisms, moves them by cells and REFUSES a
//    corner push out of the 32-slot vertex window with a visible reason.
import { test, expect, type Page } from '@playwright/test';

async function open(page: Page, id = '9000005001') {
  await page.goto(`/?craft=${id}`);
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
  await page.getByTestId('mode-edit').click();
  await expect(page.getByTestId('build-dock')).toBeVisible();
}

const bpBlocks = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __ARCHEAN__?: { engine: { blueprint: {
    data: { blocks: { size_x: number; size_y: number; size_z: number }[] } } } } };
  return w.__ARCHEAN__!.engine.blueprint.data.blocks.map(b => [b.size_x, b.size_y, b.size_z]);
});

test.describe('build-dock: blocks workspace, resize-while-placing, square fix @place @ui', () => {
  test('the dock shows brush, census, list and edit columns', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await open(page);
    await page.getByTestId('tooltab-place').click();
    for (const t of ['block-brush', 'block-census', 'block-list', 'block-edit',
      'block-list-search', 'brush-square', 'brush-axis-x', 'brush-chip'])
      await expect(page.getByTestId(t).first(), t).toBeVisible();
    expect(await page.getByTestId(/^block-row-\d+/).count())
      .toBe(await bpBlocks(page).then(b => b.length));      // every block listed
  });

  test('list row selects, ✕ deletes, one Ctrl+Z restores', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await open(page);
    const n0 = (await bpBlocks(page)).length;
    await page.getByTestId(/^block-row-\d+/).first().hover();
    await page.getByTestId(/^block-row-\d+/).first().click();
    await expect(page.getByTestId('block-edit')).toContainText(/Block\[\d+\]/);
    await page.getByTestId(/^block-cut-\d+/).first().click();
    await expect.poll(() => bpBlocks(page).then(b => b.length),
      { timeout: 5000 }).toBeLessThan(n0);
    await page.keyboard.press('Control+z');
    await expect.poll(() => bpBlocks(page).then(b => b.length),
      { timeout: 5000 }).toBe(n0);
  });

  test('the brush RESIZES WHILE PLACING: x y z axis · [ ] · s square', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await open(page);
    await page.getByTestId('tooltab-place').click();
    await expect(page.getByTestId('brush-chip')).toContainText('1×1×1');
    // grow z (active axis key) four times → 1×1×5 cells
    await page.keyboard.press('z');
    for (let i = 0; i < 4; i++) await page.keyboard.press(']');
    await expect(page.getByTestId('brush-chip')).toContainText('1×1×5');
    // shrink below one cell stays clamped
    await page.keyboard.press('x');
    for (let i = 0; i < 3; i++) await page.keyboard.press('[');
    await expect(page.getByTestId('brush-chip')).toContainText('1×1×5');
    // grow x, then s squares the brush to the largest axis
    for (let i = 0; i < 4; i++) await page.keyboard.press(']');
    await expect(page.getByTestId('brush-chip')).toContainText('5×1×5');
    await page.keyboard.press('s');
    await expect(page.getByTestId('brush-chip')).toContainText('5×5×5');
    // the panel fields follow the keys (sizes are cells − 1)
    await expect(page.getByTestId('num-sx')).toHaveValue('4');
    await expect(page.getByTestId('num-sz')).toHaveValue('4');
    // the GHOST docks with the SQUARE footprint (live preview of the brush):
    // probe canvas points through the ghost hook until one answers
    const box = (await page.getByTestId('canvas').boundingBox())!;
    let ghost: { size?: number[] } | null = null;
    for (let fy = 0.35; fy <= 0.8 && !ghost; fy += 0.1)
      for (let fx = 0.25; fx <= 0.75 && !ghost; fx += 0.1) {
        await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
        ghost = await page.evaluate(() => {
          const w = window as unknown as { __ARCHEAN__?: { ghost: () =>
            { size?: number[] } | null } };
          return w.__ARCHEAN__!.ghost();
        });
      }
    expect(ghost, 'a surface answers the brush ghost').not.toBeNull();
    expect(ghost!.size).toEqual([4, 4, 4]);                  // the SQUARE ghost
    // ▣ square button (panel twin of `s`) + 1×1×1 reset
    await page.getByTestId('brush-reset').click();
    await expect(page.getByTestId('brush-chip')).toContainText('1×1×1');
  });

  test('SQUARE FIX: a block grows to a 10×10×10 square (frame borders do not cap)', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await open(page);
    await page.getByTestId('tooltab-edit').click();
    await page.getByTestId(/^block-row-\d+/).first().click();
    await expect(page.getByTestId('block-edit')).toContainText(/Block\[\d+\]/);
    const sel = () => page.evaluate(() => {
      const w = window as unknown as {
        __ARCHEAN__?: { engine: { blueprint: { data: { blocks: { size_x: number; size_y: number; size_z: number }[] } } } };
      };
      const t = document.querySelector('[data-testid="block-edit"]')?.textContent ?? '';
      const m = t.match(/Block\[(\d+)\]/);
      if (!m) return null;
      const b = w.__ARCHEAN__!.engine.blueprint.data.blocks[+m[1]!];
      return b ? [b.size_x, b.size_y, b.size_z] : null;
    });
    for (const ax of ['x', 'y', 'z'])
      await page.getByTestId(`num-size ${ax}`).fill('9');
    await expect.poll(sel, { timeout: 5000 }).toEqual([9, 9, 9]);   // square
  });
});

test.describe('build-dock: triangle workspace @ui', () => {
  test('tri list selects, ±cell move round-trips, window refusal is honest', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await open(page, '3732302108');                        // the gantry: authored skin
    await page.getByTestId('blocksub-tris').click();
    await expect(page.getByTestId('tri-list')).toBeVisible();
    const row = page.getByTestId(/^tri-row-\d+/).first();
    await expect(row).toBeVisible();
    const idx = (await row.getAttribute('data-testid'))!.replace('tri-row-', '');
    await row.click();
    await expect(page.getByTestId('tri-edit')).toContainText(`Triangle[${idx}]`);
    // GEOMETRY round-trip (the (frame, v) split re-normalises writer-style
    // after a move — v near 0, like triangleFromCorners — so the raw bytes
    // may differ while the global corners g = v + 12·frame are exact)
    const corners = () => page.evaluate((i) => {
      const w = window as unknown as {
        __ARCHEAN__?: { engine: { blueprint: { data: { triangles: Record<string, number>[] } } } };
      };
      const t = w.__ARCHEAN__!.engine.blueprint.data.triangles[+i]!;
      return [0, 1, 2].map(vi => [0, 1, 2].map(ai => {
        const name = 'xyz'[ai]!;
        return t[`v${vi}_${name}`]! + 12 * t[`frame_${name}`]!;
      }));
    }, idx);
    const before = await corners();
    await page.getByTestId('tri-move-x-p').click();
    await expect.poll(corners, { timeout: 5000 }).not.toEqual(before);
    await page.getByTestId('tri-move-x-m').click();
    await expect.poll(corners, { timeout: 5000 }).toEqual(before);
    // a corner push out of the frame-aligned vertex window: REFUSED visibly
    const v = page.getByTestId('tri-v0-x');
    await v.fill('-500');
    await expect(page.getByTestId('tri-msg')).toContainText('refused');
  });
});
