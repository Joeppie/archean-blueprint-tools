// import.spec.ts — THE PREVIEW LAW (docs/IMPORT-3D.md § 7): the 🧊 Import
// 3D model dialog. e2e-tier because: a real file drop (setInputFiles feeds
// the real three.js OBJLoader), a real WebGL preview canvas (the grid law),
// and the commit lands through the doc funnels into the live scene.
// Laws pinned:
//  • a 2 m cube at span 24 quantises EXACTLY: 3176 shell cells, 6 merged
//    blocks (the engine tier owns the voxel maths; here: the dialog wires
//    the engine honestly into the stats card and the craft);
//  • the stats card is LIVE (every knob requantises — the span change
//    repolls, never a single shot);
//  • skin mode: 12 records, ZERO non-manifold on a closed cube;
//  • Import writes bp AND doc (loads increase), closes the dialog, and the
//    block/skin counts land in blueprint.data;
//  • the command palette row exists (Findability law).
import { expect, test, type Page } from '@playwright/test';

const OBJ = [
  'o cube',
  'v -1 -1  1', 'v  1 -1  1', 'v  1  1  1', 'v -1  1  1',
  'v -1 -1 -1', 'v  1 -1 -1', 'v  1  1 -1', 'v -1  1 -1',
  // 12 explicit triangles — a 6-vertex face 'f 1 2 3 1 3 4' would be ONE
  // face that the OBJLoader fans into 4 tris (2 degenerate): the engine's
  // degenerate count is correct, the fixture must speak the format's law
  'f 1 2 3', 'f 1 3 4', 'f 6 5 8', 'f 6 8 7',
  'f 1 5 6', 'f 1 6 2', 'f 2 6 7', 'f 2 7 3',
  'f 3 7 8', 'f 3 8 4', 'f 4 8 5', 'f 4 5 1',
].join('\n');

const bpData = (page: Page) => page.evaluate(() =>
  (window as unknown as { __ARCHEAN__: { engine: { blueprint: { data: {
    blocks: unknown[]; triangles?: Record<string, unknown>[] } } } } })
    .__ARCHEAN__.engine.blueprint.data);

const loads = (page: Page) => page.evaluate(() =>
  (window as unknown as { __ARCHEAN__: { stats: () => { loads: number } } })
    .__ARCHEAN__.stats().loads);

const stat = (page: Page, id: string) =>
  page.getByTestId(`import-stat-${id}`);

const loadCube = async (page: Page) => {
  await page.setInputFiles('[data-testid="import-input"]',
    { name: 'cube.obj', mimeType: 'model/obj', buffer: Buffer.from(OBJ) });
};

test.describe('@import @slow Import 3D model (preview law)', () => {
  test('live lattice quantise + commit', async ({ page }) => {
    test.skip(!!process.env.PIXEL7, 'desktop law');
    test.setTimeout(300_000);
    await page.goto('/?craft=9000009040');
    await page.waitForFunction(() =>
      !!(window as unknown as { __ARCHEAN__?: { engine?: { blueprint?: unknown } } })
        .__ARCHEAN__?.engine?.blueprint, null, { timeout: 150_000 });
    const blocks0 = (await bpData(page)).blocks.length;
    const loads0 = await loads(page);

    // Findability law: File ▸ row + palette row
    await page.getByTestId('file-menu').click();
    await expect(page.getByTestId('file-import')).toBeVisible();
    await page.getByTestId('file-import').click();
    const dock = page.getByTestId('import-dock');
    await expect(dock).toBeVisible();

    // the preview canvas is live
    await expect(dock.locator('canvas')).toBeVisible();

    await loadCube(page);
    await page.getByTestId('import-span').fill('24');

    // the exact quantise: 24³ − 22³ shell cells, 6 greedy slabs
    await expect(stat(page, 'cells')).toHaveText('3,176', { timeout: 30_000 });
    await expect(stat(page, 'blocks')).toHaveText('6');
    await expect(stat(page, 'degen')).toHaveText('0');
    await expect(stat(page, 'nonmanifold')).toHaveText('0');
    await expect(page.getByTestId('import-ok')).toBeEnabled();

    // skin mode: the closed cube is a clean 12-record sheet
    await page.getByTestId('import-mode-skin').click();
    await expect(stat(page, 'skin')).toHaveText('12');
    await expect(stat(page, 'nonmanifold')).toHaveText('0');

    // commit: bp AND doc (loads increase), dialog closes
    await page.getByTestId('import-ok').click();
    await expect(dock).toBeHidden();
    const data = await bpData(page);
    expect(data.triangles!.length).toBeGreaterThanOrEqual(12);
    await expect
      .poll(() => loads(page), { timeout: 20_000 })
      .toBeGreaterThan(loads0);
    void blocks0;

    // second commit: blocks mode adds records to the SAME craft
    const blocks1 = (await bpData(page)).blocks.length;
    await page.getByTestId('file-menu').click();
    await page.getByTestId('file-import').click();
    await loadCube(page);
    await page.getByTestId('import-span').fill('24');
    await expect(stat(page, 'cells')).toHaveText('3,176', { timeout: 30_000 });
    const nBlocks = Number((await stat(page, 'blocks').textContent())!);
    await page.getByTestId('import-ok').click();
    await expect(dock).toBeHidden();
    expect((await bpData(page)).blocks.length).toBe(blocks1 + nBlocks);
  });

  test('palette command opens it (Findability law)', async ({ page }) => {
    test.skip(!!process.env.PIXEL7, 'desktop law');
    test.setTimeout(300_000);
    await page.goto('/?craft=9000009040');
    await page.waitForFunction(() =>
      !!(window as unknown as { __ARCHEAN__?: { engine?: { blueprint?: unknown } } })
        .__ARCHEAN__?.engine?.blueprint, null, { timeout: 150_000 });
    await page.keyboard.press('Control+k');
    await page.keyboard.type('import 3d');
    await page.getByText('Import 3D model…').first().click();
    await expect(page.getByTestId('import-dock')).toBeVisible();
  });
});
