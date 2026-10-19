// panels.spec.ts — the P3 UI sweep through the REAL controls: view options
// (incl. the hull/wire mutual exclusivity + keyboard g/o/h), the component
// list (search → select → inspector), a full edit→dirty→SAVE lifecycle with
// the occupancy/type-255 mirror verified in the DOWNLOADED file, and the
// subgrid tab + live joint slider riding the dolphin's panel group.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const ISW = '3812927875';
const DOLPHIN = '3417786605';

async function openCraft(page: Page, id: string) {
  await page.goto(`/?craft=${id}`);
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
  await page.getByTestId('mode-edit').click();
}

/** the ⚙ view-options popover (options moved OUT of the left parts panel) */
async function openOptions(page: Page) {
  await page.getByTestId('toggle-options').click();
  await expect(page.getByTestId('options-win')).toBeVisible();
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
    await openOptions(page);
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

  test('label-scrub gives fine movement control (the tweaking complaint)', async ({ page }) => {
    desktopOnly();
    await openCraft(page, ISW);
    await page.getByTestId('filter').fill('smallwheel');
    const row = page.locator('[data-idx]').first();
    const ci = +(await row.getAttribute('data-idx'))!;
    await row.click();
    const label = page.getByTestId('row-s-x');         // the scrub handle
    await label.scrollIntoViewIfNeeded();
    await expect(label).toBeInViewport();              // (mouse.move does NOT scroll)
    const bb = (await label.boundingBox())!;
    const x0 = await partX(page, ci);
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 4; i++) await page.mouse.move(bb.x + bb.width / 2 + i * 10, bb.y + bb.height / 2);
    await page.mouse.up();
    const x1 = await partX(page, ci);
    expect(x1 - x0).toBeGreaterThan(0.1);              // 40 px ≈ 0.4 m @ 0.01/px
    expect(x1 - x0).toBeLessThan(0.8);                 // FINE — not a slider jump
    await page.getByTestId('row-x-x').click();         // ⟲ restore
    expect(await partX(page, ci)).toBeCloseTo(x0, 6);
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
    await openOptions(page);
    await page.getByTestId('opt-com').uncheck();
    expect(await comVisible()).toBe(false);
    await page.getByTestId('opt-com').check();

    // FULL game meshes are the DEFAULT (v0.182 user rule); the row offers the
    // decimated twins as the opt-in — toggling rebuilds and must still draw
    expect(await page.getByTestId('opt-hidef').isChecked()).toBe(false);
    await page.getByTestId('opt-hidef').check();         // → decimated twins
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __ARCHEAN__?: { stats: () => { draws: number } } }).__ARCHEAN__!.stats().draws),
      { timeout: 20_000 }).toBeGreaterThan(0);
    await page.getByTestId('opt-hidef').uncheck();       // → full game meshes

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
  await expect(aside.getByTestId('complist')).toBeVisible();     // the PARTS panel
  await expect(aside.getByTestId('viewopts')).toHaveCount(0);    // options are NOT here anymore
  await page.getByTestId('toggle-panels').click();
  await expect(aside).toHaveCount(0);
  // ...they open in their own ⚙ popover over the viewport
  await openOptions(page);
  await expect(page.getByTestId('opt-hull')).toBeVisible();
});

test.describe('modes, new craft, file menu', () => {
  const desktopOnly = () => test.skip(test.info().project.name !== 'chromium', 'desktop-only');

  test('gallery → New craft: untitled doc with the starter deck', async ({ page }) => {
    desktopOnly();
    await page.goto('/');
    await page.getByTestId('gallery-new').click();
    await expect(page.getByTestId('editor-title')).toContainText('New craft');
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    const blocks = await page.evaluate(() =>
      (window as unknown as { __ARCHEAN__?: { stats: () => { blocks: number } } }).__ARCHEAN__!.stats().blocks);
    expect(blocks).toBe(5);
    await expect(page.getByTestId('wslink')).toHaveCount(0);        // not a workshop item
    await expect(page.getByTestId('save-btn')).toBeVisible();
  });

  test('view mode is read-only, edit mode unlocks the inspector', async ({ page }) => {
    desktopOnly();
    await page.goto('/?craft=' + ISW);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });   // lands in View
    await page.getByTestId('filter').fill('aileron');
    await page.locator('[data-idx]').first().click();
    await expect(page.getByTestId('row-n-x')).toBeDisabled();
    await page.getByTestId('mode-edit').click();
    await expect(page.getByTestId('row-n-x')).toBeEnabled();
  });

  test('blocks mode: click a deck face to place a block', async ({ page }) => {
    desktopOnly();
    await page.goto('/');
    await page.getByTestId('gallery-new').click();
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await page.getByTestId('mode-blocks').click();
    // v0.183: deterministic scene state — wait for the atlas fan-out (the
    // PilotSeat's REAL model shown, its stand-in retired), then PROBE the
    // canvas through engine.pickCell for a pixel that answers a block face.
    // The old seven hardcoded fractions only "passed" while the seat mesh
    // was still loading — a timing lottery, not a pin.
    const probeDeckFace = () => page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      const r = c.getBoundingClientRect();
      const e = (window as unknown as { __ARCHEAN__?: { engine: { pendingReal: number; pickCell: (x: number, y: number) => { bi: number } | null } } }).__ARCHEAN__!.engine;
      if (e.pendingReal > 0) return null;
      for (let fy = 0.5; fy <= 0.78; fy += 0.02)
        for (let fx = 0.28; fx <= 0.72; fx += 0.02) {
          const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
          if (h && h.bi >= 0) return { x: fx, y: fy };
        }
      return null;
    });
    let click: { x: number; y: number } | null = null;
    for (let i = 0; i < 40 && !click; i++) {
      click = await probeDeckFace();
      if (!click) await page.waitForTimeout(300);
    }
    expect(click, 'a deck block face is clickable once real models land').not.toBeNull();
    const canvas = page.getByTestId('canvas');
    const box = (await canvas.boundingBox())!;
    const before = await page.evaluate(() =>
      (window as unknown as { __ARCHEAN__?: { stats: () => { blocks: number } } }).__ARCHEAN__!.stats().blocks);
    await canvas.click({ position: { x: box.width * click!.x, y: box.height * click!.y } });
    await page.waitForTimeout(600);                       // debounced scene reload
    const after = await page.evaluate(() =>
      (window as unknown as { __ARCHEAN__?: { stats: () => { blocks: number } } }).__ARCHEAN__!.stats().blocks);
    expect(after, 'a block was placed on the deck').toBe(before + 1);
    await expect(page.getByTestId('block-edit')).toContainText(/Block\[\d+\]/);
  });

  test('wire mode: census + auto-wire answers, file menu opens a blueprint', async ({ page }) => {
    desktopOnly();
    await page.goto('/?craft=' + ISW);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await page.getByTestId('mode-wire').click();
    await expect(page.getByTestId('wire-census')).toContainText('connected');
    await page.getByTestId('auto-wire').click();
    await expect(page.getByTestId('wire-census')).toContainText(/wired|nothing to pair/);
    // File ▾ → Open file… loads a local blueprint (and normalizes v1 → v2)
    await page.getByTestId('file-menu').click();
    await page.getByTestId('file-open').click();
    await page.getByTestId('file-input').setInputFiles(
      path.resolve(process.cwd(), '..', 'testdata', DOLPHIN, 'blueprint.json'));
    await expect(page.getByTestId('editor-title')).toContainText(/GNG-574|Dolphin|New craft|\S/, { timeout: 15_000 });
    await expect(page).toHaveTitle(/SCENE PASS/);
    const legacyChip = await page.evaluate(() => {
      const w = window as unknown as { __ARCHEAN__?: { engine: { blueprint: { data: { colors?: unknown[] } } } } };
      return Array.isArray(w.__ARCHEAN__!.engine.blueprint.data.colors);
    });
    expect(legacyChip, 'v1 file was NORMALIZED: it now carries a palette').toBe(true);
  });
});

test.describe('manual wiring + triangles + component meta', () => {
  const desktopOnly = () => test.skip(test.info().project.name !== 'chromium', 'desktop-only');

  test('wire mode: select a part, pick a free port, connect via the search list', async ({ page }) => {
    desktopOnly();
    await page.goto('/?craft=' + ISW);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await page.getByTestId('mode-wire').click();
    const pipesBefore = await page.evaluate(() => {
      const w = window as unknown as { __ARCHEAN__?: { engine: { blueprint: { data: { pipes?: unknown[] } } } } };
      return w.__ARCHEAN__!.engine.blueprint.data.pipes?.length ?? 0;
    });
    // pick an OPEN warning (guaranteed free port) -> that component is selected
    await page.getByTestId('wire-warning').first().click();
    await expect(page.getByTestId('wire-manual')).toContainText('ports:');
    // the wire workspace is a WIDE bottom dock (the user: bigger screen for
    // wires) — tall enough to evaluate the graph, not a sidebar sliver
    const dock = page.getByTestId('wire-dock');
    await expect(dock).toBeVisible();
    expect((await dock.boundingBox())!.height).toBeGreaterThan(200);
    // start from a free port, then pick a compatible part, THEN its port
    await page.locator('[data-testid="wire-port"]:not([disabled])').first().click();
    await expect(page.getByTestId('wire-target-search')).toBeVisible();
    await page.getByTestId('wire-target-search').fill('');
    const target = page.getByTestId('wire-target-item').first();
    await expect(target).toBeVisible();
    // hover a candidate: the 3D PREVIEW glows the candidate while the
    // selection stays; leaving restores (hover state -1)
    const hoverState = () => page.evaluate(() =>
      (window as unknown as { __ARCHEAN__?: { hoverState: () => number } }).__ARCHEAN__!.hoverState());
    await target.hover();
    expect(await hoverState()).toBeGreaterThanOrEqual(0);
    await target.click();                                  // STEP 1: the part
    const port = page.getByTestId('wire-target-port').first();
    await expect(port).toBeVisible();                      // STEP 2: explicit port
    await expect.poll(hoverState).toBeGreaterThanOrEqual(0);
    await port.click();
    await expect.poll(async () => page.evaluate(() => {
      const w = window as unknown as { __ARCHEAN__?: { engine: { blueprint: { data: { pipes?: unknown[] } } } } };
      return w.__ARCHEAN__!.engine.blueprint.data.pipes?.length ?? 0;
    }), { timeout: 8000 }).toBeGreaterThan(pipesBefore);
    // warnings hover: PREVIEW the flagged part, leaving restores the plain
    // selection state (the user: "highlight the relevant component when
    // mousing over the list, but then move back to what we are editing")
    const warn = page.getByTestId('wire-warning').first();
    await warn.hover();
    await expect.poll(hoverState, { timeout: 4000 }).toBeGreaterThanOrEqual(0);
    await page.mouse.move(5, 5);            // onto the canvas, off the list
    await expect.poll(hoverState, { timeout: 4000 }).toBe(-1);
  });

  test('triangles submode: three lattice clicks add a prism, panel edits it', async ({ page }) => {
    desktopOnly();
    await page.goto('/');
    await page.getByTestId('gallery-new').click();
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await page.getByTestId('mode-blocks').click();
    await page.getByTestId('blocksub-tris').click();
    const canvas = page.getByTestId('canvas');
    const box = (await canvas.boundingBox())!;
    for (const [fx, fy] of [[0.42, 0.6], [0.58, 0.6], [0.5, 0.68]]) {
      await canvas.click({ position: { x: box.width * fx, y: box.height * fy } });
      await page.waitForTimeout(250);
    }
    await expect.poll(async () => page.evaluate(() => {
      const w = window as unknown as { __ARCHEAN__?: { engine: { blueprint: { data: { triangles?: unknown[] } } } } };
      return w.__ARCHEAN__!.engine.blueprint.data.triangles?.length ?? 0;
    }), { timeout: 8000 }).toBe(1);
    await expect(page.getByTestId('tri-edit')).toContainText('Triangle[0]');
  });

  test('component meta: alias + paint fields write through to the doc', async ({ page }) => {
    desktopOnly();
    await page.goto('/?craft=' + ISW);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await page.getByTestId('mode-edit').click();
    await page.getByTestId('filter').fill('beacon');
    await page.locator('[data-idx]').first().click();
    await page.getByTestId('comp-alias').fill('lighthouse');
    const opField = page.getByTestId('paint-color1-opacity');
    await opField.fill('9');
    const vals = await page.evaluate(() => {
      const w = window as unknown as { __ARCHEAN__?: { engine: { blueprint: { data: {
        components: { alias?: string; colors?: Record<string, { opacity: number }> }[] } } } } };
      const c = w.__ARCHEAN__!.engine.blueprint.data.components.find(x => x.alias === 'lighthouse');
      return { alias: c?.alias, op: c?.colors?.color1?.opacity };
    });
    expect(vals.alias).toBe('lighthouse');
    expect(vals.op).toBe(9);
  });
});
