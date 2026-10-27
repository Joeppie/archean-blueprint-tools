// tools.spec.ts — the v1.7 TOOLS menu, BROWSER TIER only.
// The definition-generated modal (field layout, preview-gates-OK, the
// OK ▸ confirm-box ▸ run flow incl. the danger warning, Esc/✕/backdrop),
// the registry menu listing, the Edit-menu history state and every
// blueprint-DATA value of the replace-all/hullify runs live at lower tiers:
//   src/components/__tests__/tooldialog.test.tsx  (jsdom; tools.spec's green
//     values transcribed — 5 blocks change material, 35 faces on 5 blocks
//     repaint, converted 5 blocks ▸ ≥12 triangles, materials 3 / colours
//     [4×7]) and topbar.test.tsx (the menu DOM). The tool→toast→undo
//     integration is undo.spec. (L5, docs/TEST-PYRAMID.md v1.12.4.)
// What only a browser can state stays here:
//  • the merged hull REPAINTS after a run (stats().loads strictly increases
//    — the AGENTS "data assertions cannot pin a repaint" rule);
//  • the dialog never fills the view; its body scrolls and the footer stays
//    pinned (desktop + Pixel 7, the phone bottom clear zone — pixels).
// (v1.12.5 L5: the MATERIALS row + both RGB-picker legs migrated to
//  editor.dom.test.tsx — DOM wiring on the real Editor; the write/persist
//  laws were already vitest-pinned.)
import { expect, test, type Page } from '@playwright/test';

const loads = (page: Page) => page.evaluate(() =>
  (window as unknown as { __ARCHEAN__: { stats: () => { loads: number } } }).__ARCHEAN__.stats().loads);

async function openNew(page: Page) {
  await page.goto('/');
  await page.getByTestId('gallery-new').click();
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
}

async function openTool(page: Page, id: string) {
  await page.getByTestId('tools-menu').click();
  await page.getByTestId(`tool-${id}`).click();
  await expect(page.getByTestId(`tool-dialog-${id}`)).toBeVisible();
}

test.describe('tools menu + dialogs @ui', () => {
  test('replace all MATERIALS repaints the merged hull', async ({ page }) => {
    // e2e-tier because: the merged hull rebuild (stats().loads strictly
    // increases) is a repaint law no lower tier can state (AGENTS: data
    // assertions cannot pin a repaint). The data values (all materials 3,
    // colours [4×7] kept) and the full dialog flow are jsdom's
    // tooldialog.test.tsx (L5-transcribed from this spec's retired leg).
    await openNew(page);
    await openTool(page, 'replace-all');
    const l0 = await loads(page);
    await page.getByTestId('tool-ok').click();                          // ▸ confirm box
    await expect(page.getByTestId('tool-confirm-box')).toBeVisible();
    await page.getByTestId('tool-confirm').click();                     // runs + CLOSES
    await expect(page.getByTestId('tool-dialog-replace-all')).toBeHidden();
    await expect.poll(() => loads(page), { timeout: 15_000 }).toBeGreaterThan(l0);  // hull rebuilt
  });

  test('the dialog never fills the view; its body scrolls and the footer stays pinned', async ({ page }) => {
    // 2026-10-22 user rule: "Fix the tool windows so they don't use 100% of
    // view and that they can scroll smoothly down" — the sphere dialog is the
    // tallest definition in the registry, so it is the probe. Runs on BOTH
    // viewports of the suite (desktop Chrome + Pixel 7).
    await openNew(page);
    await openTool(page, 'balloon');
    const vp = page.viewportSize()!;
    const box = (await page.getByTestId('tool-dialog-balloon').boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(vp.height * 0.95);
    expect(box.width).toBeLessThanOrEqual(vp.width * 0.95);
    // PHONE bottom clear zone (user 2026-10-22: mobile Brave's bottom
    // toolbar paints OVER the page — "impossible to hit ok … there MUST be
    // a margin"): the dialog's lower edge never enters the 48 px band
    if (vp.width < 768) expect(vp.height - (box.y + box.height)).toBeGreaterThanOrEqual(48);
    // the MIDDLE scrolls (only when the content actually overflows), while
    // the OK button stays inside the viewport at BOTH scroll extremes
    const ok = page.getByTestId('tool-ok');
    await expect(ok).toBeInViewport();
    const scroll = page.locator('.tool-scroll');
    const overflows = await scroll.evaluate(el => el.scrollHeight - el.clientHeight);
    if (overflows > 4) {
      await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    }
    await expect(ok).toBeInViewport();
    await page.getByTestId('tool-cancel').click();
  });
});

test.describe('materials + RGB picker @ui', () => {
  // RETIRED v1.12.5 (L5): the MATERIALS-row DOM law (write material, colours
  // untouched, MATERIAL chip reads Lead, the block widget rides the selection)
  // runs in editor.dom.test.tsx on the real Editor + the shipped writeBlockMaterial
  // (its append-the-missing-key law stays in tooldoc).

  // RETIRED v1.12.5 (L5): rgb-hex ▸ + new slot → #ff3300 lands a NEW palette
  // slot past the reserved 0..10 + the dock reload fires — editor.dom.test.tsx
  // (allocateSlot/nearestSlot/setPaletteSlot laws stay vitest-pinned in
  // tools.test/edit.test).

  // RETIRED v1.12.5 (L5): rgb-nearest "painted ≈ slot" + the palette never
  // grows — editor.dom.test.tsx (the reserved-slots-are-paintable law is
  // nearestSlot’s own vitest pin).
});
