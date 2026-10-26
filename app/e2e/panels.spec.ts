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
test.describe('desktop panels @ui', () => {
  const desktopOnly = () => test.skip(test.info().project.name !== 'chromium', 'desktop-only');

  // v1.12.1 CHAIN LAW: four ISW-boot legs (static-info box, mass/CoM/
  // fidelity, Info dock grid, view options keyboard) shared one boot
  // class — ONE boot now runs them in restoration-disciplined order:
  // every step restores the setting it touched; the LAST step is the one
  // that ends polluted (hull OFF via the keyboard). expect.soft(.poll)
  // per law: violations report, the chain continues.
  test('the ISW shell chain: static box, mass + CoM + fidelity, Info grid, view options', async ({ page }) => {
    desktopOnly();
    await openCraft(page, ISW);
    await expect(page.getByTestId('build-dock')).toBeVisible();   // v1.11: Info dock, no sidebar

    await test.step('static info box: its ✕ dismisses it, the ⚙ row brings it back (v1.5 user rule)', async () => {
      await expect(page.getByTestId('massbox'), 'desktop default: the box shows').toBeVisible();
      await expect.soft(page.getByTestId('mass-density'), 'desktop keeps the structural detail').toBeVisible();
      await page.getByTestId('static-close').click();
      await expect.soft(page.getByTestId('massbox')).toHaveCount(0);
      await openOptions(page);
      await expect.soft(page.getByTestId('opt-static'), 'the ✕ flipped the setting off too').not.toBeChecked();
      await page.getByTestId('opt-static').check();
      await expect.soft(page.getByTestId('massbox'), 'the ⚙ row brings it back').toBeVisible();
      await page.getByTestId('opt-static').uncheck();            // the setting hides it too
      await expect.soft(page.getByTestId('massbox')).toHaveCount(0);
      await page.getByTestId('opt-static').check();              // restore for the mass step
      await page.getByTestId('toggle-options').click();          // close the popover
      await expect(page.getByTestId('options-win')).toHaveCount(0);
    });

    await test.step('mass readout, CoM marker toggle, hi-def rebuild, workshop link', async () => {
      const rep = page.getByTestId('mass-report');
      await expect.soft(rep).toContainText('declared');
      await expect.soft(rep).toContainText('CoM');
      const comVisible = () => page.evaluate(() => {
        const w = window as unknown as { __ARCHEAN__?: { engine: { massReport: () => { comVisible: boolean } | null } } };
        return w.__ARCHEAN__!.engine.massReport()!.comVisible;
      });
      expect.soft(await comVisible(), 'CoM marker on by default').toBe(true);
      await openOptions(page);
      await page.getByTestId('opt-com').uncheck();
      expect.soft(await comVisible(), 'the row hides the marker').toBe(false);
      await page.getByTestId('opt-com').check();

      // FULL game meshes are the DEFAULT (v0.182 user rule); the row offers
      // the decimated twins as the opt-in — toggling rebuilds and draws
      expect.soft(await page.getByTestId('opt-hidef').isChecked(), 'full meshes default').toBe(false);
      await page.getByTestId('opt-hidef').check();         // → decimated twins
      await expect.poll(() => page.evaluate(() =>
        (window as unknown as { __ARCHEAN__?: { stats: () => { draws: number } } }).__ARCHEAN__!.stats().draws),
        { timeout: 20_000 }).toBeGreaterThan(0);
      await page.getByTestId('opt-hidef').uncheck();       // → full game meshes (restore)
      const ws = page.getByTestId('wslink');
      await expect.soft(ws).toHaveAttribute('href', new RegExp(`id=${ISW}$`));
      await page.getByTestId('toggle-options').click();    // close the popover
      await expect(page.getByTestId('options-win')).toHaveCount(0);
    });

    await test.step('the Info dock cards sit 3-across (TODO A; the phone column rides the mobile-dock leg)', async () => {
      await page.getByTestId('mode-view').click();         // a craft's ⌖ Info IS the card grid
      const grid = page.getByTestId('vessel-stats');
      await expect.soft(grid).toBeVisible();
      const cols = await grid.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      expect.soft(cols, 'desktop card grid').toBe(3);
    });

    await test.step('view options: hull/wire exclusive, keyboard g/o/h drive the checkboxes (polluted-last: ends hull OFF)', async () => {
      await openOptions(page);
      const hull = page.getByTestId('opt-hull'), wire = page.getByTestId('opt-wire');
      await expect.soft(hull, 'hull on by default (mode-view keeps the hull law)').toBeChecked();
      await wire.check();                                  // wire ON forces hull OFF (legacy excl)
      await expect.soft(wire).toBeChecked();
      await expect.soft(hull).not.toBeChecked();
      await hull.check();
      await expect.soft(wire).not.toBeChecked();
      // 'o' flips occupancy THROUGH the same state as the checkbox (v0.147)
      await page.getByTestId('editor-title').click();      // focus off the inputs (legacy skip rule)
      await page.keyboard.press('o');
      await expect.soft(page.getByTestId('opt-occ')).toBeChecked();
      await page.keyboard.press('o');
      await expect.soft(page.getByTestId('opt-occ')).not.toBeChecked();
      await page.keyboard.press('h');
      await expect.soft(page.getByTestId('opt-hull')).not.toBeChecked();
      expect.soft(await optsOf(page)).toMatchObject({ hull: false, occ: false, grid: true, pipes: true, subs: true });
    });
  });


  test('label-scrub gives fine movement control (the tweaking complaint)', async ({ page }) => {
    desktopOnly();
    test.setTimeout(90_000);
    // v1.11.0 re-pin: the inspector pos/rot ROWS are GONE (the gizmo
    // supersedes them) — the scrub law is the Row component's (fine
    // per-pixel drag on the label, ⟲ restores), shipped on the
    // COMPONENT-DATA rows. The Aileron triple's `angle` row is the seam.
    // (the MATRIX fixture craft posts SCENE ok:false by design — sparse
    // probe craft, liveedit.spec opens it the same way: poll the seam,
    // never the title)
    await page.goto('/?craft=9000001001');
    await page.getByTestId('mode-edit').click();
    await page.getByTestId('ws-parts').click();
    const flt = page.getByTestId('parts-list').getByTestId('filter');
    await flt.waitFor({ state: 'visible', timeout: 30_000 });
    await flt.fill('aileron');
    await page.locator('[data-idx]').first().waitFor({ timeout: 20_000 });
    await page.locator('[data-idx]').first().click();
    const label = page.locator('section', { hasText: 'Component data' })
      .getByTestId('row-s-angle');                 // the scrub handle
    await label.scrollIntoViewIfNeeded();
    await expect(label).toBeInViewport();          // (mouse.move does NOT scroll)
    const bb = (await label.boundingBox())!;
    const angle = () => page.evaluate(() =>
      (window as unknown as { __ARCHEAN__?: { engine: { blueprint: { data: {
        components: { type: string; data?: { angle?: number } }[] } } } } }).__ARCHEAN__!.engine
        .blueprint.data.components.find(c => c.type === 'Aileron')!.data!.angle!);
    const a0 = await angle();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.mouse.down();
    // Row scrub law: perPx = range/400 (Aileron angle ⇒ 0.45°/px); 8 px is
    // a FINE nudge — the assertion pins "not a slider jump", not a value.
    for (let i = 1; i <= 4; i++) await page.mouse.move(bb.x + bb.width / 2 + i * 2, bb.y + bb.height / 2);
    await page.mouse.up();
    const a1 = await angle();
    expect(a1).not.toBe(a0);                       // the scrub moved it
    expect(Math.abs(a1 - a0)).toBeLessThan(12);    // FINE — not a slider jump
    await page.getByTestId('row-x-angle').click(); // ⟲ restore
    await expect.poll(() => angle()).toBeCloseTo(a0, 6);
  });

  test('list search → select → inspector; move x; SAVE downloads a mirror-synced file', async ({ page }) => {
    desktopOnly();
    await openCraft(page, ISW);
    const original = await (await page.request.get(`/corpus/${ISW}/blueprint.json`)).text();
    await page.getByTestId('ws-parts').click();                 // v1.11: + Parts subpanel
    await page.getByTestId('parts-list').getByTestId('filter').fill('smallwheel');
    const row = page.locator('[data-idx]').first();
    const ci = +(await row.getAttribute('data-idx'))!;
    await row.click();
    await expect(page.getByTestId('inspector')).toContainText(`SmallWheel[${ci}]`);
    const x0 = await partX(page, ci);
    const target = x0 + 0.5;                               // exactly 2 cells
    // v1.11: pos/rot slider rows are GONE from the inspector (the canvas
    // gizmo supersedes them) — the test drives the same engine seam
    await page.evaluate((a) => (window as unknown as { __ARCHEAN__?: { engine: {
      setFilePosAxis: (ci: number, ax: 'x' | 'y' | 'z', v: number) => void } } })
      .__ARCHEAN__!.engine.setFilePosAxis(a.ci, 'x', a.v), { ci, v: target });
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
    await page.getByTestId('ws-parts').click();                 // v1.11: subgrid tabs ride + Parts
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

  // v1.11 UNPINNED-TODO pins G + A (AGENTS): "`modify-hint` (Modify opens
  // empty) + per-kind editor reveal — unasserted" and the Info-dock CARD
  // GRID ("desktop 3-col / phone 1-col") the sealed-lift batch shipped.
  test('✎ MODIFY opens EMPTY; a pick reveals the kind’s editor (TODO G)', async ({ page }) => {
    desktopOnly();
    await page.goto('/?craft=9000005001');
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await page.getByTestId('mode-edit').click();
    // a fresh profile is ✎ MODIFY (ws default 'edit'): the dock carries the
    // hint and NO editor rows until you pick something (v1.11 dock law)
    await expect(page.getByTestId('ws-edit')).toHaveAttribute('aria-pressed', 'true');
    const hint = page.getByTestId('modify-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText(/starts empty/i);
    await expect(page.getByTestId('block-edit')).toHaveCount(0);
    await expect(page.getByTestId('tri-edit')).toHaveCount(0);
    // a BLOCK pick → the block editor
    const bpx = await page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      const r = c.getBoundingClientRect();
      const e = (window as unknown as { __ARCHEAN__?: { engine: {
        pickCell: (x: number, y: number) => { kind: string; bi: number } | null } } }).__ARCHEAN__!.engine;
      for (let fy = 0.5; fy <= 0.8; fy += 0.02)
        for (let fx = 0.25; fx <= 0.75; fx += 0.02) {
          const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
          if (h && h.kind === 'block' && h.bi >= 0) return { x: r.left + r.width * fx, y: r.top + r.height * fy };
        }
      return null;
    });
    expect(bpx, 'a deck face answers the merged pick').not.toBeNull();
    await page.mouse.click(bpx!.x, bpx!.y);
    await expect(page.getByTestId('block-edit')).toBeVisible({ timeout: 5000 });
    await expect(hint, 'the editor replaced the hint').toHaveCount(0);
    // a sky pick deselects — the hint returns
    const cbox = (await page.getByTestId('canvas').boundingBox())!;
    await page.mouse.click(cbox.x + 8, cbox.y + 8);
    await expect(page.getByTestId('block-edit')).toHaveCount(0);
    await expect(hint).toBeVisible();
    // a PART pick → the + Parts auto-jump (AGENTS KNOWN ISSUE 10) + inspector
    const cpx = await page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      const r = c.getBoundingClientRect();
      const e = (window as unknown as { __ARCHEAN__?: { engine: {
        pickCell: (x: number, y: number) => { kind: string; ci: number } | null } } }).__ARCHEAN__!.engine;
      for (let fy = 0.3; fy <= 0.8; fy += 0.02)
        for (let fx = 0.25; fx <= 0.75; fx += 0.02) {
          const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
          if (h && h.kind === 'comp' && h.ci >= 0) return { x: r.left + r.width * fx, y: r.top + r.height * fy };
        }
      return null;
    });
    expect(cpx, 'a part surface answers the merged pick').not.toBeNull();
    await page.mouse.click(cpx!.x, cpx!.y);
    await expect(page.getByTestId('ws-parts'),
      'a Modify-mode part click auto-jumps to + Parts').toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('inspector')).toBeVisible();
  });

  // RETIRED v1.12.1 (chain law): the Info dock card grid is a step of
  // the ISW shell chain above; the phone column (1-across) rides the
  // 'mobile: the bottom dock is always visible' leg.
});

test.describe('mass & CoM + fidelity toggles @ui', () => {
  // User 2026-10-19: "Static info shouldn't necessarily show. It's too large
  // on mobile, hide it under settings, x to close panel itself." → the KSP
  // mass/CoM card is a SETTING (⚙ row), it dismisses itself with its own ✕,
  // and on phones it starts hidden and renders as a compact card.
  // RETIRED v1.12.1 (chain law): the static-info ✕/⚙ law runs as a step
  // of the ISW shell chain above (one boot).

  // RETIRED v1.12.1 (chain law): mass/CoM/hi-def/wslink run as a step of
  // the ISW shell chain above (one boot).
});

/** Phones (the pixel7 project): no unsolicited overlay — the static-info card
 *  is OFF by default and, when switched on from ⚙, it is the COMPACT variant
 *  (no structural-detail lines, well under the desktop 250 px card). */
// v1.12.1 CHAIN LAW: the two phone legs share one pixel7 boot: the
// static-info compact-card laws, then the always-visible dock + 1-across
// card grid.
test('mobile chain: no unsolicited static card, compact ⚙ card, always-on dock (one boot)', async ({ page }) => {
  test.skip(test.info().project.name === 'chromium', 'phone project only');
  await page.goto('/?craft=' + ISW);
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });

  await test.step('no static-info box by default; ⚙ shows a COMPACT card; ✕ closes', async () => {
    await expect(page.getByTestId('massbox'), 'phones start WITHOUT the box').toHaveCount(0);
    await page.getByTestId('toggle-options').click();
    await expect(page.getByTestId('options-win')).toBeVisible();
    await page.getByTestId('opt-static').check();
    const box = page.getByTestId('massbox');
    await expect(box).toBeVisible();
    const w = (await box.boundingBox())!.width;
    expect(w, 'the phone card is compact, not the 250 px desktop box').toBeLessThan(200);
    await expect(page.getByTestId('mass-report')).toContainText('declared');
    await expect(page.getByTestId('mass-density'), 'the structural-detail row stays off phones').toBeHidden();
    await expect(page.getByTestId('mass-report')).toContainText('CoM');
    // v1.11: the ⚙ popover (z-30) overlaps the compact box's ✕ on the phone
    // (the Info dock makes the viewport shorter, the popover taller) — close
    // it before the ✕ click
    await page.getByTestId('toggle-options').click();
    await expect(page.getByTestId('options-win')).toHaveCount(0);
    await page.getByTestId('static-close').click();
    await expect(page.getByTestId('massbox')).toHaveCount(0);
  });

  await test.step('the bottom dock is always visible (no drawer, v1.11) + 1-across card grid', async () => {
    await page.getByTestId('mode-view').click();                    // ⌖ Info mode
    await expect(page.getByTestId('build-dock')).toBeVisible();
    await expect(page.getByTestId('vessel-stats')).toBeVisible();
    await expect(page.getByTestId('toggle-panels')).toHaveCount(0); // the ▤ toggle is GONE
    // v1.12.1 (chain law): the RETIRED Info-dock leg's phone column lives
    // here — the vessel grid stacks 1-across on phones (TODO A)
    const cols = await page.getByTestId('vessel-stats')
    .evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(cols, 'phone card grid stacks 1-across').toBe(1);
    await openOptions(page);
    await expect(page.getByTestId('opt-hull')).toBeVisible();
  });
});


// RETIRED v1.12.1 (chain law): a step of the mobile chain above.

test.describe('modes, new craft, file menu @ui', () => {
  const desktopOnly = () => test.skip(test.info().project.name !== 'chromium', 'desktop-only');

  // v1.12.1 CHAIN LAW: the New-craft leg and the triangles leg BOTH boot
  // via the gallery → starter deck; one boot, asserted in order (the
  // starter deck's 5 blocks ARE the surface the triangle picks probe).
  test('the starter-craft chain: gallery → New craft deck, then triangles 3-click', async ({ page }) => {
    desktopOnly();
    await page.goto('/');

    await test.step('New craft: untitled doc with the starter deck (v1.5.10: File-menu only, no toolbar button)', async () => {
    await page.getByTestId('gallery-new').click();
    await expect(page.getByTestId('editor-title')).toContainText('New craft');
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    const blocks = await page.evaluate(() =>
      (window as unknown as { __ARCHEAN__?: { stats: () => { blocks: number } } }).__ARCHEAN__!.stats().blocks);
    expect(blocks).toBe(5);
    await expect(page.getByTestId('wslink')).toHaveCount(0);        // not a workshop item
    await expect(page.getByTestId('save-btn')).toBeVisible();
    // v1.5.10 user rule ("new craft should not be a button, but only under
    // file. too dangerous"): the editor toolbar carries NO + New craft button
    // — the one cheap assertion; File ▸ New craft (dirty-guarded) is the only path.
    await expect(page.getByTestId('new-craft')).toHaveCount(0);
    });

    await test.step('triangles submode: three lattice clicks add a prism, panel edits it', async () => {
    await page.getByTestId('mode-edit').click();
    await page.getByTestId('ws-tris').click();
    const canvas = page.getByTestId('canvas');
    const box = (await canvas.boundingBox())!;
    // v1.11: PROBE three spread deck faces (fixed fractions land on ground /
    // a part on the tiny starter craft — a part click selects, clearing the
    // draft — the app is right, the fractions were not)
    const spots = await page.evaluate(() => {
      const c = document.querySelector('canvas')!, r = c.getBoundingClientRect();
      const e = (window as unknown as { __ARCHEAN__?: { engine: {
        pickCell: (x: number, y: number) => { bi: number; point: number[] } | null } } })
        .__ARCHEAN__!.engine;
      const pts: { x: number; y: number }[] = [];
      for (let fy = 0.3; fy <= 0.9; fy += 0.04)
        for (let fx = 0.2; fx <= 0.85; fx += 0.04) {
          const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
          if (h && h.bi >= 0) pts.push({ x: fx, y: fy });
        }
      const d = (a: { x: number; y: number }, b: { x: number; y: number }) =>
        Math.hypot(a.x - b.x, a.y - b.y);
      const a1 = pts[0]!;
      const a2 = pts.reduce((m, p) => (d(p, a1) > d(m, a1) ? p : m), a1);
      const a3 = pts.reduce((m, p) => (Math.min(d(p, a1), d(p, a2)) >
        Math.min(d(m, a1), d(m, a2)) ? p : m), a1);
      return [a1, a2, a3];
    });
    for (const p of spots) {
      await canvas.click({ position: { x: box.width * p.x, y: box.height * p.y } });
      await page.waitForTimeout(250);
    }
    await expect.poll(async () => page.evaluate(() => {
      const w = window as unknown as { __ARCHEAN__?: { engine: { blueprint: { data: { triangles?: unknown[] } } } } };
      return w.__ARCHEAN__!.engine.blueprint.data.triangles?.length ?? 0;
    // the starter craft has NO twin masks (solo PilotSeat) → auto-mirroring
    // stays OFF → exactly one prism lands (v1.11 semantics, pin 3-clicks)
    }), { timeout: 8000 }).toBe(1);
    await expect(page.getByTestId('tri-edit')).toContainText('Triangle[0]');
    });
  });


  // v1.12.1 CHAIN LAW: three ISW-boot legs share ONE boot. In-app mode
  // switches cost ~nothing; boots cost ~1 s each. View-lock laws first
  // (craft lands in View), then the Edit-mode meta write-through, then the
  // wire-mode connect UI LAST (the only doc mutation).
  test('the panel editors chain: view-lock, component meta, wire-mode connect (one boot)', async ({ page }) => {
    desktopOnly();
    await page.goto('/?craft=' + ISW);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });   // hard gate: lands in View

    await test.step('view tab shows ONLY vessel stats; the VIEW LOCK; Edit carries lists + inspector', async () => {
    // v1.4 user rule: the view tab's side menu is ONLY the overall vessel
    // stats, in collapsable sections — no parts list, no inspector.
    await expect(page.getByTestId('vessel-stats')).toBeVisible();
    await expect(page.getByTestId('vessel-mass')).toBeVisible();
    await expect(page.getByTestId('filter')).toHaveCount(0);
    await expect(page.getByTestId('ws-blocks')).toHaveCount(0);
    await page.getByTestId('vsec-census').click();                   // collapse…
    await expect(page.getByTestId('vessel-census')).toHaveCount(0);
    await page.getByTestId('vsec-census').click();                   // …and expand
    await expect(page.getByTestId('vessel-census')).toBeVisible();
    // v1.5 VIEW LOCK (user rule: "selecting components shouldnt be possible
    // in view"): a click on a proven-comp pixel selects NOTHING in view —
    // while the SAME pixel selects in the Edit mode. (Probe via pickAt so
    // the pin is non-vacuous: the pixel really answers a component.)
    const selState = () => page.evaluate(() =>
      (window as unknown as { __ARCHEAN__?: { sel: () => { ci: number; sub: number } } })
        .__ARCHEAN__!.sel());
    // v1.10.6: the probe runs against the LIVE canvas — entering Edit docks
    // the build-dock, which SHRINKS the canvas and reframes the projection,
    // so the Edit-mode click re-probes (the old shared pixel maps elsewhere
    // once the dock lands). It uses pickCell — the SAME surface pick the
    // Edit click routes through (onBlockPick): a pickAt 'comp' whose
    // pickCell is a hull 'tri' (the part sits behind a skin prism) selects
    // nothing on click, so it is not a valid target.
    const probeComp = () => page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      const r = c.getBoundingClientRect();
      const e = (window as unknown as { __ARCHEAN__?: { engine: { pendingReal: number;
        pickCell: (x: number, y: number) => { kind: string; ci: number } | null } } }).__ARCHEAN__!.engine;
      if (e.pendingReal > 0) return null;
      for (let fy = 0.3; fy <= 0.75; fy += 0.03)
        for (let fx = 0.25; fx <= 0.75; fx += 0.03) {
          const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
          if (h && h.kind === 'comp' && h.ci >= 0) return { x: fx, y: fy };
        }
      return null;
    });
    let px = await probeComp();
    for (let i = 0; i < 20 && !px; i++) { await page.waitForTimeout(300); px = await probeComp(); }
    expect(px, 'a component surface is clickable').not.toBeNull();
    let cbox = (await page.getByTestId('canvas').boundingBox())!;
    await page.mouse.click(cbox.x + cbox.width * px!.x, cbox.y + cbox.height * px!.y);
    expect((await selState()).ci, 'a VIEW click selects nothing').toBe(-1);
    // edit mode brings the PLACE/EDIT sub-tabs and the editable inspector
    await page.getByTestId('mode-edit').click();
    await expect(page.getByTestId('build-dock')).toBeVisible();
    px = await probeComp();
    for (let i = 0; i < 20 && !px; i++) { await page.waitForTimeout(300); px = await probeComp(); }
    expect(px, 'a component surface is clickable in the Edit canvas too').not.toBeNull();
    cbox = (await page.getByTestId('canvas').boundingBox())!;
    await page.mouse.click(cbox.x + cbox.width * px!.x, cbox.y + cbox.height * px!.y);
    expect((await selState()).ci, 'the component surface selects in the Edit mode')
      .toBeGreaterThanOrEqual(0);
    // v1.11: the canvas part pick AUTO-JUMPS the dock to + Parts (KNOWN
    // ISSUE 10) — the ws row is visible, no ws-blocks/ws-edit pair to check
    // edit mode + the v1.11 dock law: a canvas part pick AUTO-JUMPS the
    // dock to + Parts (KNOWN ISSUE 10) — the parts list rides there
    await page.getByTestId('ws-parts').click();
    await page.getByTestId('parts-list').getByTestId('filter').fill('aileron');
    await page.locator('[data-idx]').first().click();
    await expect(page.getByTestId('comp-alias')).toBeVisible();  // v1.11: meta fields (pos/rot = gizmo)
    await expect(page.getByTestId('comp-delete')).toBeVisible();     // selectable ⇒ deletable
    });

    await test.step('component meta: alias + paint fields write through to the doc', async () => {
    await page.getByTestId('ws-parts').click();                 // v1.11: + Parts subpanel
    await page.getByTestId('parts-list').getByTestId('filter').fill('beacon');
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

    await test.step('wire mode: select a part, pick a free port, connect via the search list', async () => {
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
  });


  // RETIRED v1.12.1 (L5, overlap): deck-face click-to-place is canonical
  // in builddock.spec ('a click lands a 1×1×1 block…') and blockplace.spec;
  // the placement MATH is vitest-pinned (blocks.test.ts) and the pickCell
  // face answers headless (scene.headless.test.ts 'pick routing').

  // RETIRED v1.12.1 (L1/L5, overlap): the wire-mode census + auto-wire +
  // file-menu legs duplicate wire.spec (canonical: 'auto-wire (logical)
  /// answers and is idempotent', the cable list) and app.spec (?craft= deep
  // link). The auto-wire MODEL is vitest-pinned (wiremodel/wireops.test.ts).
});

// RETIRED v1.12.1 (chain law): manual wiring, triangles 3-click and
// component meta now run as steps of the panel editors chain and the
// starter-craft chain above (in-app mode switches; no extra boots).

// The SHIPPED UI (no debug flag): the SCENE PASS tab-title and the stats
// strip are a DEBUG channel only (user 2026-10-19: "the text in the top
// should not show, not unless in debug mode"; "the title is incorrectly
// changed after loading containing SCENE PASS"). v1.5: the side panel's
// expand/collapse belongs to the ▤ button and the ‹/› bookmark tab ONLY —
// re-clicking the active View tile no longer toggles it (user: the panel
// "shouldnt tie to view incorrectly").
test.describe('shipped UI (no debug flag) @ui', () => {
  test.use({ storageState: { cookies: [], origins: [] } });     // no archean-app-debug
  test('clean title, no stats strip, no sidebar toggles — every mode keeps its dock', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await page.goto('/?craft=' + ISW);
    await expect.poll(async () => (await page.evaluate(() =>
      (window as unknown as { __ARCHEAN__?: { stats: () => { draws: number } } }).__ARCHEAN__?.stats().draws ?? -1)),
      { timeout: 30_000 }).toBeGreaterThan(0);
    await expect(page).not.toHaveTitle(/SCENE PASS/);
    await expect(page.getByTestId('scene-stats')).toHaveCount(0);
    // v1.11 NO SIDE PANEL: every mode keeps its bottom dock; the ▤ toggle
    // and the bookmark tab are GONE; the Info tile is a MODE, not a toggle
    const dock = page.getByTestId('build-dock');
    await expect(dock).toBeVisible();                           // view opens WITH the Info dock
    // v1.11 TopBar law: re-clicking the ACTIVE mode tile drops to ⌖ View
    // (clean canvas-focus mode) — no redundant mode-view click here.
    await expect(page.getByTestId('toggle-panels')).toHaveCount(0);
    await expect(page.getByTestId('panel-tab')).toHaveCount(0);
    await page.getByTestId('mode-edit').click();
    await expect(dock).toBeVisible();                           // edit keeps its workspace dock
    await page.getByTestId('mode-wire').click();
    await expect(page.getByTestId('wire-dock')).toBeVisible();  // wire keeps its own
  });
});
