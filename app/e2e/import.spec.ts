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
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

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

/** a real Collada document (the SketchUp door): a 24-vertex Y-up unit cube
 *  ×2 ([-1,1]³ → span 24 = 48 cells), per-face normals, 12 tris */
const DAE = (() => {
  const F = [
    [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1], [1, 0, 0]],
    [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, 0, 0]],
    [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1], [0, 1, 0]],
    [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], [0, -1, 0]],
    [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1], [0, 0, 1]],
    [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1], [0, 0, -1]],
  ] as const;
  const P: number[] = []; const N: number[] = []; const IDX: number[] = [];
  F.forEach((f, k) => {
    for (let i = 0; i < 4; i++) { P.push(...f[i]!); N.push(...f[4]!); }
    IDX.push(4 * k, 4 * k + 1, 4 * k + 2, 4 * k, 4 * k + 2, 4 * k + 3);
  });
  const arr = (a: number[], id: string) =>
    `<float_array id="${id}-array" count="${a.length}">${a.join(' ')}</float_array>`;
  const src = (id: string, a: number[]) =>
    `<source id="${id}">${arr(a, id)}<technique_common><accessor source="#${id}-array" count="${a.length / 3}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>`;
  const tri = IDX.map((v, i) => `${v} ${i}`).join(' ');
  // ColladaLoader REQUIRES library_effects + library_materials (it returns
  // null without them — the format's includes-file heritage)
  return `<?xml version="1.0"?><COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1"><asset><unit meter="1"/><up_axis>Y_UP</up_axis></asset>` +
    `<library_effects><effect id="fx" name="fx"><profile_COMMON><technique sid="common"><phong><diffuse><color>0.8 0.8 0.8 1</color></diffuse></phong></technique></profile_COMMON></effect></library_effects>` +
    `<library_materials><material id="m" name="m"><instance_effect url="#fx"/></material></library_materials>` +
    `<library_geometries><geometry id="g" name="cube"><mesh>` +
    src('pos', P) + src('nrm', N) +
    `<vertices id="v"><input semantic="POSITION" source="#pos"/><input semantic="NORMAL" source="#nrm"/></vertices>` +
    `<triangles count="12" material="m"><input semantic="VERTEX" source="#v" offset="0"/><input semantic="NORMAL" source="#nrm" offset="1"/><p>${tri}</p></triangles>` +
    `</mesh></geometry></library_geometries>` +
    `<library_visual_scenes><visual_scene id="s"><node id="n1" name="cube"><instance_geometry url="#g"/></node></visual_scene></library_visual_scenes>` +
    `<scene><instance_visual_scene url="#s"/></scene></COLLADA>`;
})();

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

    // THE SKIN-DEFAULT LAW: a model becomes a HULL first (we, the church:
    // "it placed blocks and not triangles … it should be TRIANGLES")
    await expect(page.getByTestId('import-mode-hint')).toContainText('Skin');
    await expect(stat(page, 'skin')).toHaveText('12');
    await expect(stat(page, 'nonmanifold')).toHaveText('0');

    // the exact blocks quantise: 24³ − 22³ shell cells; the greedy merge's
    // big slabs re-split at the 12-cell frame borders into 54 stored
    // records (the stats card counts WHAT THE COMMIT WRITES)
    await page.getByTestId('import-mode-blocks').click();
    await expect(stat(page, 'cells')).toHaveText('3,176', { timeout: 30_000 });
    await expect(stat(page, 'blocks')).toHaveText('54');
    await expect(stat(page, 'degen')).toHaveText('0');
    await expect(stat(page, 'nonmanifold')).toHaveText('0');
    await expect(page.getByTestId('import-ok')).toBeEnabled();

    // back to skin: the closed cube is a clean sheet, the coplanar merge
    // fusing each 2-tri square pair (12 soup tris ▸ 6 quads)
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
    await page.getByTestId('import-mode-blocks').click();   // skin is the default
    await expect(stat(page, 'cells')).toHaveText('3,176', { timeout: 30_000 });
    const nBlocks = Number((await stat(page, 'blocks').textContent())!);
    await page.getByTestId('import-ok').click();
    await expect(dock).toBeHidden();
    expect((await bpData(page)).blocks.length).toBe(blocks1 + nBlocks);
  });

  test('sketchup door: a real Collada (.dae) cube quantises @ui', async ({ page }) => {
    test.skip(!!process.env.PIXEL7, 'desktop law');
    test.setTimeout(300_000);
    // e2e-tier because: the real three.js ColladaLoader (the SketchUp
    // export) feeding the live quantise loop (the engine maths is
    // import.test's; the loader + the DAE XML is the seam here)
    await page.goto('/?craft=9000009040');
    await page.waitForFunction(() =>
      !!(window as unknown as { __ARCHEAN__?: { engine?: { blueprint?: unknown } } })
        .__ARCHEAN__?.engine?.blueprint, null, { timeout: 150_000 });
    await page.getByTestId('file-menu').click();
    await page.getByTestId('file-import').click();
    await expect(page.getByTestId('import-dock')).toBeVisible();
    await page.setInputFiles('[data-testid="import-input"]',
      { name: 'cube.dae', mimeType: 'model/x-collada+xml',
        buffer: Buffer.from(DAE) });
    await page.getByTestId('import-span').fill('24');
    await expect(stat(page, 'skin')).toHaveText('12');
    await expect(stat(page, 'nonmanifold')).toHaveText('0');
  });

  test('game .gltf with sidecars (.bin/.png) loads (the centrifuge crash)', async ({ page }) => {
    test.skip(!!process.env.PIXEL7, 'desktop law');
    test.setTimeout(300_000);
    // e2e-tier because: the real GLTFLoader resolving a .gltf's external
    // .bin/.png through the dropped-file blob URLs (the Float32Array OOB
    // crash: a 404-served index.html parsed as a vertex buffer). Machine-
    // local game install via blueprints.conf (AGENTS blueprint folder law)
    // — the leg SKIPS where no install exists, never a hardcoded path.
    const conf = (() => {
      try {
        const t = readFileSync(new URL('../../blueprints.conf', import.meta.url), 'utf8');
        const m = t.match(/^\s*game_dir\s*=\s*(.+)$/m);
        return m ? m[1]!.trim() : '';
      } catch { return ''; }
    })();
    const dir = conf && resolve(`${conf}/modules/ARCHEAN_chemical/components/EnrichmentCentrifuge`);
    const parts = ['EnrichmentCentrifuge.gltf', 'EnrichmentCentrifuge.bin', 'EnrichmentCentrifuge.png']
      .map(n => dir && resolve(dir, n));
    test.skip(!parts.every(p => p && existsSync(p)), 'needs the Archean game install');
    await page.goto('/?craft=9000009040');
    await page.waitForFunction(() =>
      !!(window as unknown as { __ARCHEAN__?: { engine?: { blueprint?: unknown } } })
        .__ARCHEAN__?.engine?.blueprint, null, { timeout: 150_000 });
    await page.getByTestId('file-menu').click();
    await page.getByTestId('file-import').click();
    await expect(page.getByTestId('import-dock')).toBeVisible();
    await page.setInputFiles('[data-testid="import-input"]',
      parts as string[]);
    // the part is ~1.5 m: a walkable-scale import needs a bigger span
    await page.getByTestId('import-span').fill('300');
    await expect(page.getByTestId('import-loaderr')).toHaveCount(0);
    await expect.poll(async () =>
      Number((await stat(page, 'skin').textContent())!.replace(/\D/g, '')),
    { timeout: 30_000 }).toBeGreaterThan(0);
  });

  test('🎮 game models browser: the installed game, one click, on the lattice @ui', async ({ page }) => {
    test.skip(!!process.env.PIXEL7, 'desktop law');
    test.setTimeout(300_000);
    // e2e-tier because: the dev/preview route serves the REAL game folder
    // (blueprints.conf game_dir) — the whole point (we: "all files CAN be
    // read by the game, so we CAN READ THEM") is the folder-to-lattice path
    const gameDir = (() => {
      try {
        const t = readFileSync(new URL('../../blueprints.conf', import.meta.url), 'utf8');
        const m = t.match(/^\s*game_dir\s*=\s*(.+)$/m);
        return m ? m[1]!.trim() : '';
      } catch { return ''; }
    })();
    test.skip(!gameDir || !existsSync(resolve(gameDir, 'modules')),
      'needs the Archean game install');
    await page.goto('/?craft=9000009040');
    await page.waitForFunction(() =>
      !!(window as unknown as { __ARCHEAN__?: { engine?: { blueprint?: unknown } } })
        .__ARCHEAN__?.engine?.blueprint, null, { timeout: 150_000 });
    await page.getByTestId('file-menu').click();
    await page.getByTestId('file-import').click();
    await expect(page.getByTestId('import-dock')).toBeVisible();
    await expect(page.getByTestId('import-gamemodels')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('import-gamemodels').click();
    await expect(page.getByTestId('import-gamelist')).toBeVisible();
    await page.getByTestId('import-gameq').fill('centrifuge');
    await page.getByTestId('import-game-EnrichmentCentrifuge').click();
    // the game's OWN gltf+bin+png quantise onto the lattice (skin default)
    await expect.poll(async () =>
      Number((await stat(page, 'skin').textContent())!.replace(/\D/g, '')),
    { timeout: 60_000 }).toBeGreaterThan(0);
  });

  test('zeppelin ritual: TOOLS ▸ Import stages a GHOST, ✔ Build lands it @ui', async ({ page }) => {
    test.skip(!!process.env.PIXEL7, 'desktop law');
    test.setTimeout(300_000);
    // e2e-tier because: the real placement widget chain (stage → movable
    // ghost → Build commit through the doc funnels) over a real file drop
    await page.goto('/?craft=9000009040');
    await page.waitForFunction(() =>
      !!(window as unknown as { __ARCHEAN__?: { engine?: { blueprint?: unknown } } })
        .__ARCHEAN__?.engine?.blueprint, null, { timeout: 150_000 });
    const tris0 = (await bpData(page)).triangles?.length ?? 0;
    const loads0 = await loads(page);
    await page.getByTestId('tools-menu').click();
    await page.getByTestId('tool-import3d').click();
    // the workspace window IS the import surface (every door opens it)
    await expect(page.getByTestId('import-dock')).toBeVisible();
    await page.setInputFiles('[data-testid="import-input"]',
      { name: 'cube.obj', mimeType: 'model/obj', buffer: Buffer.from(OBJ) });
    await page.getByTestId('import-span').fill('24');
    await expect(stat(page, 'skin')).toHaveText('12', { timeout: 30_000 });
    await page.getByTestId('import-ghost').click();
    // the GHOST is live; nudge it 4 cells +x (the widget-drag law is the
    // sphereskin spec's; here: the import payload rides it)
    await expect.poll(async () => page.evaluate(() =>
      (window as unknown as { __ARCHEAN__: { placeGhost: () => unknown } })
        .__ARCHEAN__.placeGhost() !== null), { timeout: 15_000 }).toBe(true);
    await page.evaluate(() => (window as unknown as {
      __ARCHEAN__: { placeShift: (s: [number, number, number]) => boolean };
    }).__ARCHEAN__.placeShift([4, 0, 0]));
    await page.getByTestId('place-build').click();
    // the records land AT THE SHIFTED SPOT (the window law may recut faces
    // at the destination: ≥ the 12 of the unshifted cube) and the scene
    // rebuilds (the repaint law)
    await expect.poll(async () =>
      ((await bpData(page)).triangles?.length ?? 0) - tris0,
    { timeout: 20_000 }).toBeGreaterThanOrEqual(12);
    await expect.poll(() => loads(page), { timeout: 20_000 })
      .toBeGreaterThan(loads0);
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
