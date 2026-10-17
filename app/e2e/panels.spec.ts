// panels.spec.ts — the P3 UI sweep through the REAL controls: view options
// (incl. the hull/wire mutual exclusivity + keyboard g/o/h), the component
// list (search → select → inspector), a full edit→dirty→SAVE lifecycle with
// the occupancy/type-255 mirror verified in the DOWNLOADED file, and the
// subgrid tab + live joint slider riding the dolphin's panel group.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const ISW = '3812927875';
const DOLPHIN = '3417786605';

async function openCraft(page: Page, id: string) {
  await page.goto(`/?craft=${id}`);
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
}

const optsOf = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __ARCHEAN__?: { engine: { getOptions: () => Record<string, boolean> } } };
  return w.__ARCHEAN__!.engine.getOptions();
});
const partX = (page: Page, ci: number) => page.evaluate(c => {
  const w = window as unknown as { __ARCHEAN__?: { engine: { compViewPos: (i: number) => { x: number } | null } } };
  return w.__ARCHEAN__!.engine.compViewPos(c)!.x;
}, ci);
const subQuat = (page: Page, bi: number) => page.evaluate(b => {
  type Pose = { p: number[]; quat: [number, number, number, number] } | null;
  const w = window as unknown as { __ARCHEAN__?: { engine: { subPose: (i: number) => Pose } } };
  return w.__ARCHEAN__!.engine.subPose(b);
}, bi);

// view options default open on desktop; the drawer test covers mobile
test.describe('desktop panels', () => {
  const desktopOnly = () => test.skip(test.info().project.name !== 'chromium', 'desktop-only');

  test('view options: hull/wire exclusive, keyboard g/o/h drive the checkboxes', async ({ page }) => {
    desktopOnly();
    await openCraft(page, ISW);
    await expect(page.getByTestId('panel-aside')).toBeVisible();
    const hull = page.getByTestId('opt-hull'), wire = page.getByTestId('opt-wire');
    await expect(hull).toBeChecked();
    await wire.check();                                    // wire ON forces hull OFF (legacy excl)
    await expect(wire).toBeChecked();
    await expect(hull).not.toBeChecked();
    await hull.check();
    await expect(wire).not.toBeChecked();
    // 'o' flips occupancy THROUGH the same state as the checkbox (v0.147 rule)
    await page.getByTestId('editor-title').click();       // focus off the inputs (legacy skip rule)
    await page.keyboard.press('o');
    await expect(page.getByTestId('opt-occ')).toBeChecked();
    await page.keyboard.press('o');
    await expect(page.getByTestId('opt-occ')).not.toBeChecked();
    await page.keyboard.press('h');
    await expect(page.getByTestId('opt-hull')).not.toBeChecked();
    expect(await optsOf(page)).toMatchObject({ hull: false, occ: false, grid: true, pipes: true, subs: true });
  });

  test('list search → select → inspector; move x; SAVE downloads a mirror-synced file', async ({ page }) => {
    desktopOnly();
    await openCraft(page, ISW);
    const original = await (await page.request.get(`/corpus/${ISW}/blueprint.json`)).text();
    await page.getByTestId('filter').fill('smallwheel');
    const row = page.locator('[data-idx]').first();
    const ci = +(await row.getAttribute('data-idx'))!;
    await row.click();
    await expect(page.getByTestId('inspector')).toContainText(`SmallWheel[${ci}]`);
    const x0 = await partX(page, ci);
    const target = x0 + 0.5;                               // exactly 2 cells
    await page.getByTestId('row-n-x').fill(String(target));
    await expect.poll(() => partX(page, ci)).toBeCloseTo(target, 6);
    await expect(page.getByTestId('save-btn')).toContainText('●');

    const dl = page.waitForEvent('download');
    await page.getByTestId('save-btn').click();
    const dlEv = await dl;
    const file = (await dlEv.path())!;
    const text = readFileSync(file, 'utf8');
    type Bp = { data: { components: { position: { x: number }; occupancies?: Record<string, number>[] }[]; blocks: unknown[] } };
    const after = JSON.parse(text) as Bp;
    expect(after.data.components[ci]!.position.x).toBeCloseTo(target, 9);
    expect(dlEv.suggestedFilename()).toBe('blueprint.json');
    const before = JSON.parse(original) as Bp;
    const occB = before.data.components[ci]!.occupancies![0]!;
    expect(after.data.components[ci]!.occupancies![0]!['pos_x']).toBe(occB['pos_x']! + 2);   // round(0.5/0.25) = 2 cells
    // the type-255 mirror moved WITH it: a 255 block now sits at the new occ's key
    const mk = (o: Record<string, number | undefined>) =>
      `${o['pos_x']},${o['pos_y']},${o['pos_z']}|${o['size_x']},${o['size_y']},${o['size_z']}|${o['frame_x']},${o['frame_y']},${o['frame_z']}`;
    const movedKey = mk({ ...occB, pos_x: occB['pos_x']! + 2 });
    const count = (s: unknown[], k: string) => s.filter(b => mk(b as Record<string, number>) === k).length;
    expect(count(after.data.blocks, movedKey)).toBeGreaterThan(count(before.data.blocks, movedKey));
  });

  test('subgrid tab: SUBGRID row → panel with decoded master + joint slider rides the group', async ({ page }) => {
    desktopOnly();
    await openCraft(page, DOLPHIN);
    await page.getByTestId('ltab-sub').click();
    const secs = page.locator('[data-testid^="sec-b"]');  // one section per Build
    const n = await secs.count();
    expect(n).toBeGreaterThan(0);
    // groups start COLLAPSED (legacy default): expand each, click its SUBGRID
    // row, and look for a kinematic master (dolphin: 3 pivots + 2 hinges)
    const jointRow = page.getByTestId('row-n-joint angle (°)');
    let bi = -1, found = false;
    for (let i = 0; i < n; i++) {
      await secs.nth(i).click();
      const row = page.locator('[data-b]').first();
      if (!await row.count()) continue;
      bi = +(await row.getAttribute('data-b'))!;
      await row.click();
      if (await jointRow.count()) { found = true; break; }
    }
    expect(found, 'a dolphin subgrid names its hinge/pivot master').toBe(true);
    await expect(page.getByTestId('subpanel')).toContainText(/SmallPivot|SmallHinge/);
    const pose0 = await subQuat(page, bi);
    await jointRow.fill('90');
    const poseA = await subQuat(page, bi);
    expect(poseA).not.toBeNull();
    const dot = Math.abs(pose0!.quat[0]! * poseA!.quat[0]! + pose0!.quat[1]! * poseA!.quat[1]!
      + pose0!.quat[2]! * poseA!.quat[2]! + pose0!.quat[3]! * poseA!.quat[3]!);
    expect(dot).toBeLessThan(0.999);                       // the GROUP swung
    // ⟲ restores the exact pose (the slider baseline IS the file value)
    await page.getByTestId('row-x-joint angle (°)').click();
    await expect.poll(() => subQuat(page, bi)).toEqual(pose0);
  });
});

test.describe('mass & CoM + fidelity toggles', () => {
  const desktopOnly = () => test.skip(test.info().project.name !== 'chromium', 'desktop-only');

  test('mass readout, CoM marker toggle, hi-def rebuild, workshop link', async ({ page }) => {
    desktopOnly();
    await openCraft(page, ISW);
    const rep = page.getByTestId('mass-report');
    await expect(rep).toContainText('declared');
    await expect(rep).toContainText('CoM');
    const comVisible = () => page.evaluate(() => {
      const w = window as unknown as { __ARCHEAN__?: { engine: { massReport: () => { comVisible: boolean } | null } } };
      return w.__ARCHEAN__!.engine.massReport()!.comVisible;
    });
    expect(await comVisible()).toBe(true);
    await page.getByTestId('opt-com').uncheck();
    expect(await comVisible()).toBe(false);
    await page.getByTestId('opt-com').check();

    // hi-def rebuilds with the full game meshes and must still draw
    await page.getByTestId('opt-hidef').check();
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __ARCHEAN__?: { stats: () => { draws: number } } }).__ARCHEAN__!.stats().draws),
      { timeout: 20_000 }).toBeGreaterThan(0);
    await page.getByTestId('opt-hidef').uncheck();

    const ws = page.getByTestId('wslink');
    await expect(ws).toHaveAttribute('href', new RegExp(`id=${ISW}$`));
  });
});

test('mobile: the panels are a drawer behind the ⚙ toggle', async ({ page }) => {
  await openCraft(page, ISW);
  const aside = page.getByTestId('panel-aside');
  if (await aside.isVisible().catch(() => false)) {        // desktop keeps it open
    await expect(aside).toBeVisible();
    return;
  }
  await page.getByTestId('toggle-panels').click();
  await expect(aside).toBeVisible();
  await expect(aside.getByTestId('viewopts')).toBeVisible();
  await page.getByTestId('toggle-panels').click();
  await expect(aside).toHaveCount(0);
});
