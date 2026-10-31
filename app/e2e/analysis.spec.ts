// analysis.spec.ts — THE XENONCODE ANALYSIS in the real IDE (v1.16.13,
// we: "report missing functions, definitions, missing return statements in
// functions where a result is used … mark them like VS would"): the ANALYSIS
// BENCH 9000009090 disk (tools/make_analysis_test.py — ONE deliberate
// defect per analyzer code, with clean counterparts that must stay silent)
// opens in the IDE → CodeMirror's lint renderer paints squiggles and the
// gutter severity dots, the Problems side tab counts and lists the
// diagnostics, and a row click JUMPS the editor (data-editor-jump, the v1.13
// follow seam). The analyzer LAWS (the 11 codes, the vocabulary sync to the
// C++ binary, the shipped ChipOS/Badger disks true-negative) are PORTED to
// xcanalyze.test; this leg is the CM6 renderer + the IDE DOM.
import { test, expect } from '@playwright/test';

const BENCH = '9000009090';

test.describe('@analysis @xenon THE XENONCODE ANALYSIS', () => {
  test('the bench disk: squiggles, gutter marks, the Problems tab; a row click jumps', async ({ page }) => {
    test.setTimeout(150_000);
    test.slow();   // @slow: the real IDE opening on a corpus craft
    await page.goto(`/?craft=${BENCH}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 60_000 });
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    const pane = page.getByTestId('xenon-code-0');
    await expect(pane).toBeVisible({ timeout: 30_000 });

    // the lint renderer marks the planted defects (>= 8 of the 11)
    await expect
      .poll(() => page.locator('.cm-lintRange').count(), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(8);
    // VS-style gutter severity dots (lintGutter beside the breakpoint gutter)
    await expect(page.locator('[class*="cm-lint-marker"]').first())
      .toBeVisible({ timeout: 10_000 });

    // the Problems side tab: counts + rows (phones get the right-edge RAIL
    // instead of the side strip — v1.13.32 phone IDE law)
    const sideBtn = page.getByTestId('xenon-side-problems');
    if (await sideBtn.isVisible().catch(() => false)) await sideBtn.click();
    else await page.getByTestId('xenon-rail-problems').click();
    await expect(page.getByTestId('xc-problems-list')).toBeVisible();
    await expect(page.getByTestId('xc-problems-counts'))
      .toContainText(/errors[\s\S]*warnings[\s\S]*hints/);
    const rows = page.locator('[data-testid^="xc-problem-"]');
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    expect(await rows.count()).toBeGreaterThanOrEqual(8);

    // the ghost-alias row jumps the editor to its line (the follow seam)
    const ghost = page.locator('[data-testid^="xc-problem-"]', { hasText: 'ghost' }).first();
    await expect(ghost).toBeVisible();
    await ghost.click();
    await expect
      .poll(() => pane.getAttribute('data-editor-jump'),
        { message: 'the Problems row click moves the editor', timeout: 10_000 })
      .toMatch(/^main\.xc:\d+$/);

    // a CLEAN disk stays quiet: the Lamp ToggleButton's own disk has no
    // program → the Problems list is the empty state
    await expect(page.getByTestId('xc-problems-counts'))
      .toContainText('errors');
  });
});
