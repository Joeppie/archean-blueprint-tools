// phoneux.spec.ts — the v1.11.1 PHONE UI batch (we: "Ui elements are in the
// way on phone when placing blocks, and I see the picked block popup and the
// widget for changing blocks over the block itself which prevents effective
// use … when I tap these elements shouldn't be in the middle but off to the
// side/bottom"; "Help should be fullscreen window on phone"; "W should
// toggle wireframe"; "go through descriptions in the ui that might be
// outdated like the one about lift only mentioning triangles"). Pins:
//  • the modebox docks at the viewport's TOP edge on phones (NOT 48 px above
//    the tapped block — the popup used to sit over the craft), and stays
//    anchored to the click on desktop;
//  • the 3-D widget's LIVE size is 0.6 on phones (a size-1 TGC gizmo spans
//    ~¼ of a phone screen = a shield over the block) and 1 on desktop;
//  • the Help manual FILLS the phone viewport (desktop keeps the 86 dvh cap);
//  • the w key flips the wireframe option (the opt-wire row) — h keeps hull;
//  • the empty Lift readout speaks enclosed BLOCKS + skin, not triangles
//    alone (the sealed-envelope law of v1.11).
import { expect, test, type Page } from '@playwright/test';

const isPhone = () => test.info().project.name === 'pixel7';

async function openNew(page: Page) {
  await page.goto('/');
  await page.getByTestId('gallery-new').click();
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
}

/** open a NEW craft in ✎ Modify and probe a canvas pixel that answers a
 *  deck block face through engine.pickCell (the blockedit probe, widened for
 *  the phone canvas — canvas fractions are NOT aspect-stable, AGENTS) */
async function deckBlockPixel(page: Page): Promise<{ x: number; y: number }> {
  await page.getByTestId('mode-edit').click();
  let px: { x: number; y: number } | null = null;
  for (let i = 0; i < 40 && !px; i++) {
    px = await page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      const r = c.getBoundingClientRect();
      const e = (window as unknown as { __ARCHEAN__?: { engine: {
        pendingReal: number;
        pickCell: (x: number, y: number) => { bi: number } | null } } }).__ARCHEAN__!.engine;
      if (e.pendingReal > 0) return null;
      for (let fy = 0.4; fy <= 0.85; fy += 0.02)
        for (let fx = 0.2; fx <= 0.8; fx += 0.02) {
          const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
          if (h && h.bi >= 0) return { x: r.left + r.width * fx, y: r.top + r.height * fy };
        }
      return null;
    });
    if (!px) await page.waitForTimeout(300);
  }
  expect(px, 'a deck block face answers pickCell').not.toBeNull();
  return px!;
}

test.describe('phone UI batch @ui', () => {
  test('the modebox docks at the viewport top edge on phones (desktop: anchored to the click)', async ({ page }) => {
    await openNew(page);
    const p = await deckBlockPixel(page);
    await page.mouse.click(p.x, p.y);
    const box = page.getByTestId('modebox');
    await expect(box).toBeVisible();
    const mb = (await box.boundingBox())!;
    const cv = (await page.getByTestId('canvas').boundingBox())!;
    if (isPhone()) {
      // OFF to the side: the strip hugs the canvas' TOP edge, centred — it
      // used to sit at click−48 (mid-canvas, over the tapped block). The
      // phone canvas deck sits at fy ≈ 0.5-0.8, so the OLD position lands
      // far below 10 % of the canvas height: this pin discriminates.
      expect(mb.y - cv.y, 'modebox docked at the canvas top (phone)').toBeLessThan(cv.height * 0.1);
      expect(Math.abs(mb.x + mb.width / 2 - (cv.x + cv.width / 2)), 'centred horizontally')
        .toBeLessThanOrEqual(2);
    } else {
      // desktop keeps the legacy anchor: 48 px above the click
      expect(Math.abs(mb.y - (p.y - 48)), 'modebox anchored above the click (desktop)').toBeLessThanOrEqual(2);
    }
  });

  test('the 3-D widget runs small on phones, full size on desktop', async ({ page }) => {
    await openNew(page);
    const size = await page.evaluate(() =>
      (window as unknown as { __ARCHEAN__?: { gizmoSize: () => number } }).__ARCHEAN__!.gizmoSize());
    expect(size).toBe(isPhone() ? 0.6 : 1);
  });

  test('the Help manual fills the phone viewport (desktop keeps the capped window)', async ({ page }) => {
    await openNew(page);
    await page.getByTestId('help-menu').click();
    await page.getByTestId('help-manual').click();
    const box = (await page.getByTestId('help-dialog').boundingBox())!;
    const vp = page.viewportSize()!;
    expect(box).not.toBeNull();
    if (isPhone()) {
      // FULLSCREEN: the dialog spans the viewport edge to edge (the 86 dvh
      // cap + the 7.5rem Brave reserve shrank the manual to a letterbox)
      expect(box.width).toBeGreaterThanOrEqual(vp.width - 1);
      expect(box.height).toBeGreaterThanOrEqual(vp.height - 1);
      // and the article scrolls inside it (the manual stays fully reachable)
      const art = page.getByTestId('help-article');
      await expect(art).toBeVisible();
    } else {
      // desktop discipline UNCHANGED: capped, centred, never fullscreen-wide
      expect(box.width).toBeLessThan(vp.width - 1);
      expect(box.height).toBeLessThanOrEqual(vp.height * 0.86 + 2);
    }
    await page.getByTestId('help-close').click();
    await expect(page.getByTestId('help-dialog')).toHaveCount(0);
  });

  test('the w key toggles the wireframe option; h keeps toggling the hull', async ({ page }) => {
    await openNew(page);
    await page.getByTestId('toggle-options').click();          // the ⚙ View popover carries the rows
    const wire = page.getByTestId('opt-wire');
    const hull = page.getByTestId('opt-hull');
    const w0 = await wire.isChecked();
    await page.keyboard.press('w');
    await expect(wire).toBeChecked({ checked: !w0 });
    // the legacy EXCLUSIVITY law (selftest excl=true) rides the w key too:
    // a lit wireframe darkens the hull solids (the 'h' hull ⇄ wire law).
    if (!w0) await expect(hull).toBeChecked({ checked: false });
    await page.keyboard.press('w');
    await expect(wire).toBeChecked({ checked: w0 });
    // h's hull law UNTOUCHED by the new key
    const h1 = await hull.isChecked();
    await page.keyboard.press('h');
    await expect(hull).toBeChecked({ checked: !h1 });
    await page.keyboard.press('h');
    await expect(hull).toBeChecked({ checked: h1 });
  });

  test('the empty Lift readout speaks enclosed blocks + skin, not triangles alone', async ({ page }) => {
    await openNew(page);                                        // opens in VIEW (VesselStats)
    const widget = page.getByTestId('lift-widget');
    await expect(widget).toBeVisible();
    await page.getByTestId('lift-toggle').click();
    // the starter deck seals nothing, so the empty-state prose shows:
    await expect(widget).toContainText('enclosed blocks');
    await expect(widget).toContainText('Generate balloon');
    await expect(widget, 'the outdated triangles-only wording is gone').not.toContainText('no hull triangles yet');
  });

  test('the picked-info chip docks at the viewport bottom edge on phones (desktop: top-right card)', async ({ page }) => {
    await openNew(page);
    await page.getByTestId('mode-wire').click();                // pickAt path (mode !== view)
    let px: { x: number; y: number } | null = null;
    for (let i = 0; i < 40 && !px; i++) {
      px = await page.evaluate(() => {
        const c = document.querySelector('canvas')!;
        const r = c.getBoundingClientRect();
        const e = (window as unknown as { __ARCHEAN__?: { engine: {
          pendingReal: number;
          pickCell: (x: number, y: number) => { kind: string } | null } } }).__ARCHEAN__!.engine;
        if (e.pendingReal > 0) return null;
        for (let fy = 0.3; fy <= 0.8; fy += 0.02)
          for (let fx = 0.25; fx <= 0.8; fx += 0.02) {
            const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
            if (h && h.kind === 'comp') return { x: r.left + r.width * fx, y: r.top + r.height * fy };
          }
        return null;
      });
      if (!px) await page.waitForTimeout(300);
    }
    expect(px, 'a part surface answers pickCell').not.toBeNull();
    await page.mouse.click(px!.x, px!.y);
    const chip = page.getByTestId('pick-info');
    await expect(chip).toBeVisible();
    const box = (await chip.boundingBox())!;
    const cv = (await page.getByTestId('canvas').boundingBox())!;
    if (isPhone()) {
      // flush at the canvas bottom edge, over the dock (bottom-2 = 8 px):
      // the v1.11.0 fixed 132 px sat MID-canvas on the phone layout.
      expect(cv.y + cv.height - (box.y + box.height), 'chip docked at the bottom edge (phone)')
        .toBeLessThanOrEqual(14);
    } else {
      // desktop keeps the top-right card (top-3 = 12 px)
      expect(box.y - cv.y, 'chip anchored top-right (desktop)').toBeLessThanOrEqual(14);
      expect(cv.x + cv.width - (box.x + box.width)).toBeLessThanOrEqual(16);
    }
  });

  test('phones furnish the GRID PAD; desktop keeps ground unfurnishable', async ({ page }) => {
    await openNew(page);
    await page.getByTestId('mode-edit').click();
    await page.getByTestId('ws-blocks').click();
    // arm ⊘ mirroring so one tap lands exactly ONE block (counting is exact)
    const chip = page.getByTestId('mirw-off');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    let px: { x: number; y: number } | null = null;
    for (let i = 0; i < 40 && !px; i++) {
      px = await page.evaluate(() => {
        const c = document.querySelector('canvas')!;
        const r = c.getBoundingClientRect();
        const e = (window as unknown as { __ARCHEAN__?: { engine: {
          pendingReal: number;
          pickCell: (x: number, y: number) => { kind: string; bi: number } | null } } }).__ARCHEAN__!.engine;
        if (e.pendingReal > 0) return null;
        for (let fy = 0.88; fy >= 0.5; fy -= 0.02)          // bottom-up: the PAD band
          for (let fx = 0.25; fx <= 0.8; fx += 0.02) {
            const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
            if (h && h.kind === 'ground') return { x: r.left + r.width * fx, y: r.top + r.height * fy };
          }
        return null;
      });
      if (!px) await page.waitForTimeout(300);
    }
    expect(px, 'the grid pad answers pickCell as ground').not.toBeNull();
    await page.mouse.move(px!.x, px!.y);                     // hover: the ghost aims
    await page.waitForTimeout(200);
    const ghost = () => page.evaluate(() =>
      (window as unknown as { __ARCHEAN__?: { ghost: () => unknown } }).__ARCHEAN__!.ghost());
    const blocks = () => page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { engine: { blueprint: { data: { blocks: unknown[] } } } } }
    ).__ARCHEAN__!.engine.blueprint.data.blocks.length);
    if (!isPhone()) {
      // the v1.11 constructor law STAYS on desktop: ground is unfurnishable
      expect(await ghost(), 'desktop: no ghost over the pad').toBeNull();
      const before = await blocks();
      await page.mouse.click(px!.x, px!.y);
      await page.waitForTimeout(400);
      expect(await blocks(), 'desktop: the pad click lands nothing').toBe(before);
      return;
    }
    // PHONE (we: "placing blocks on phone exclusively works on existing
    // geometry, not on e.g. grid, preventing movement"): the brush ghost
    // docks on the pad and the tap lands a cell STANDING ON it.
    expect(await ghost(), 'phone: the brush ghost docks on the pad').not.toBeNull();
    const before = await blocks();
    await page.mouse.click(px!.x, px!.y);
    for (let i = 0; i < 20 && (await blocks()) === before; i++) await page.waitForTimeout(250);
    expect(await blocks(), 'phone: the pad tap lands a block').toBe(before + 1);
  });
});
