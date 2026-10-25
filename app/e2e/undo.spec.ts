// undo.spec.ts — 2026-10-20 editor-workflow guarantees:
//  • EVERY operation lands in the undo/redo stack (snapshot funnel: tool
//    runs, block deletes, hullify, triangle deletes all round-trip through
//    Ctrl+Z / Ctrl+Shift+Z); the Edit ▾ menu items follow the stack;
//  • DELETE deletes the selection in edit mode (block + triangle covered
//    here, components via the shared deleteComp path);
//  • TRIANGLES select properly: a click in the middle of a hull prism owns
//    its triangle (geometric triAt), the gold highlight rides it (triHl);
//  • the TOOLS dialog is MOVABLE by its title bar and stays fully usable.
import { expect, test, type Page } from '@playwright/test';

type Blk = { pos_x: number; pos_y: number; pos_z: number; material?: number };
type Tri = Record<string, unknown>;

const bpOf = (page: Page) => page.evaluate(() =>
  (window as unknown as { __ARCHEAN__: { engine: { blueprint: {
    data: { blocks: Blk[]; triangles?: Tri[] } } } } })
    .__ARCHEAN__.engine.blueprint.data);

async function openNew(page: Page) {
  await page.goto('/');
  await page.getByTestId('gallery-new').click();
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
}

/** walk the canvas with the ENGINE's own picker until a block face answers */
async function blockPixel(page: Page): Promise<{ x: number; y: number }> {
  for (let i = 0; i < 40; i++) {
    const px = await page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      const r = c.getBoundingClientRect();
      const e = (window as unknown as { __ARCHEAN__?: { engine: {
        pendingReal: number; pickCell: (x: number, y: number) => { kind: string; bi: number } | null } } })
        .__ARCHEAN__!.engine;
      if (e.pendingReal > 0) return null;
      for (let fy = 0.3; fy <= 0.85; fy += 0.02)
        for (let fx = 0.25; fx <= 0.8; fx += 0.02) {
          const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
          if (h && h.kind === 'block' && h.bi >= 0) return { x: r.left + r.width * fx, y: r.top + r.height * fy };
        }
      return null;
    });
    if (px) return px;
    await page.waitForTimeout(300);
  }
  throw new Error('no block face answered pickCell');
}

/** walk the canvas with pickCell + the geometric triAt owner test until a
 *  pixel SELECTS a hull triangle (kind tri AND t >= 0 — the exact routing
 *  the shipped click path runs) */
async function triPixel(page: Page): Promise<{ x: number; y: number; t: number }> {
  for (let i = 0; i < 60; i++) {
    const px = await page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      const r = c.getBoundingClientRect();
      const a = (window as unknown as { __ARCHEAN__?: { engine: { pendingReal: number };
        triPick: (x: number, y: number) => { kind: string; bi: number; t: number } | null } })
        .__ARCHEAN__!;
      if (a.engine.pendingReal > 0) return null;
      for (let fy = 0.25; fy <= 0.9; fy += 0.02)
        for (let fx = 0.2; fx <= 0.85; fx += 0.02) {
          const x = r.left + r.width * fx, y = r.top + r.height * fy;
          const p = a.triPick(x, y);
          if (p && p.kind === 'tri' && p.t >= 0) return { x, y, t: p.t };
        }
      return null;
    });
    if (px) return px;
    await page.waitForTimeout(300);
  }
  throw new Error('no pixel owned a hull triangle');
}

const openTool = async (page: Page, id: string) => {
  await page.getByTestId('tools-menu').click();
  await page.getByTestId(`tool-${id}`).click();
  await expect(page.getByTestId(`tool-dialog-${id}`)).toBeVisible();
};

test.describe('undo/redo + delete key + triangle select @ui', () => {
  test('a tool run round-trips through Ctrl+Z / redo; the Edit menu follows', async ({ page }) => {
    await openNew(page);
    await openTool(page, 'replace-all');                       // default: m0 ▸ m3
    await page.getByTestId('tool-ok').click();
    await page.getByTestId('tool-confirm').click();
    await expect.poll(async () => (await bpOf(page)).blocks.every(b => b.material === 3),
      { timeout: 15_000 }).toBe(true);
    await page.getByTestId('edit-menu').click();
    await expect(page.getByTestId('edit-undo')).toBeEnabled();
    await expect(page.getByTestId('edit-redo')).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await bpOf(page)).blocks.every(b => (b.material ?? 0) === 0),
      { timeout: 15_000 }).toBe(true);
    expect((await bpOf(page)).blocks.length).toBe(5);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(async () => (await bpOf(page)).blocks.every(b => b.material === 3),
      { timeout: 15_000 }).toBe(true);
  });

  test('Ctrl+Z keeps the camera (v1.5.10 user: "ctrl-z resets view")', async ({ page }) => {
    await openNew(page);
    const cam = () => page.evaluate(() =>
      (window as unknown as { __ARCHEAN__: { engine: { camPos: () => number[] } } })
        .__ARCHEAN__.engine.camPos());
    const c0 = await cam();
    // ORBIT the camera off the framing pose (a >4px canvas drag is an orbit,
    // never a pick): the pin is only meaningful from a NON-default view.
    const box = await page.locator('canvas').boundingBox();
    await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++)
      await page.mouse.move(box!.x + box!.width * (0.5 + 0.02 * i),
        box!.y + box!.height * (0.5 + 0.01 * i));
    await page.mouse.up();
    await page.waitForTimeout(400);                            // damping settles
    const c1 = await cam();
    const moved = Math.hypot(c1[0]! - c0[0]!, c1[1]! - c0[1]!, c1[2]! - c0[2]!);
    expect(moved, 'the orbit must actually move the camera (non-vacuous)')
      .toBeGreaterThan(0.5);
    // a tool run + an UNDO of it: the view must not be re-framed back
    await openTool(page, 'replace-all');
    await page.getByTestId('tool-ok').click();
    await page.getByTestId('tool-confirm').click();
    await expect.poll(async () => (await bpOf(page)).blocks.every(b => b.material === 3),
      { timeout: 15_000 }).toBe(true);
    const c2 = await cam();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await bpOf(page)).blocks.every(b => (b.material ?? 0) === 0),
      { timeout: 15_000 }).toBe(true);
    await page.waitForTimeout(400);
    const c3 = await cam();
    const drift = Math.hypot(c3[0]! - c2[0]!, c3[1]! - c2[1]!, c3[2]! - c2[2]!);
    expect(drift, 'undo must not move the camera').toBeLessThan(0.05);
  });

  test('Delete deletes the selected block; Ctrl+Z brings it back', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'the side panel is a drawer on phones');
    await openNew(page);
    await page.getByTestId('mode-edit').click();
    await page.getByTestId('ws-edit').click();
    const px = await blockPixel(page);
    await page.mouse.click(px.x, px.y);
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __ARCHEAN__: { blockGizmo: () => { bi: number } | null } })
        .__ARCHEAN__.blockGizmo()?.bi ?? -1), { timeout: 10_000 }).toBeGreaterThanOrEqual(0);
    const n0 = (await bpOf(page)).blocks.length;
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await bpOf(page)).blocks.length, { timeout: 10_000 })
      .toBe(n0 - 1);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await bpOf(page)).blocks.length, { timeout: 15_000 })
      .toBe(n0);
  });

  test('hullify + triangle middle-click SELECTS (gold highlight), Delete removes, undo restores', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'the side panel is a drawer on phones');
    await openNew(page);
    await openTool(page, 'hullify');
    await page.getByTestId('tool-ok').click();
    await page.getByTestId('tool-confirm').click();
    await expect.poll(async () => (await bpOf(page)).blocks.length, { timeout: 15_000 }).toBe(0);
    const triN0 = (await bpOf(page)).triangles!.length;
    await page.getByTestId('mode-edit').click();
    await page.getByTestId('ws-edit').click();   // v1.11: tri-select is EDIT mode
    const px = await triPixel(page);
    await page.mouse.click(px.x, px.y);
    await expect(page.getByTestId('tri-edit')).toContainText(`Triangle[${px.t}]`, { timeout: 10_000 });
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __ARCHEAN__: { triHl: () => number } }).__ARCHEAN__.triHl()),
    ).toBe(px.t);
    await page.keyboard.press('Delete');
    // v1.11 uniform mirror rule: the hullified ISW skin is x-symmetric —
    // deleting a prism takes its identified twin with it (a PAIR leaves),
    // and ONE Ctrl+Z restores the exact file
    await expect.poll(async () => (await bpOf(page)).triangles!.length, { timeout: 10_000 })
      .toBeLessThan(triN0);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await bpOf(page)).triangles!.length, { timeout: 15_000 })
      .toBe(triN0);
    expect((await bpOf(page)).blocks.length).toBe(0);       // undo lands ON the hullified state
  });

  test('the tools dialog moves with its title bar and stays usable', async ({ page }) => {
    await openNew(page);
    await openTool(page, 'replace-all');
    const box0 = (await page.getByTestId('tool-dialog-replace-all').boundingBox())!;
    const handle = (await page.getByTestId('tool-drag').boundingBox())!;
    const sx = handle.x + handle.width / 2, sy = handle.y + handle.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 140, sy + 110, { steps: 6 });
    await page.mouse.up();
    const box1 = (await page.getByTestId('tool-dialog-replace-all').boundingBox())!;
    if (test.info().project.name === 'chromium') {
      expect(box1.x).toBeGreaterThan(box0.x + 100);   // desktop: roams free
      expect(box1.y).toBeGreaterThan(box0.y + 60);
    } else {
      // phone: the clamp lets it move as far as the viewport allows but
      // NEVER off it (an off-screen dialog is an unfinished tool)
      expect(Math.abs(box1.x - box0.x) + Math.abs(box1.y - box0.y)).toBeGreaterThan(40);
    }
    const vs = page.viewportSize()!;
    const okBox = (await page.getByTestId('tool-ok').boundingBox())!;
    expect(okBox.x + okBox.width).toBeLessThanOrEqual(vs.width + 1);
    expect(okBox.y + okBox.height).toBeLessThanOrEqual(vs.height + 1);
    // …and it still functions at the moved position
    await page.getByTestId('tool-ok').click();
    await expect(page.getByTestId('tool-confirm-box')).toBeVisible();
  });
});
