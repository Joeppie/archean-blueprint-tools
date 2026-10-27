// cost.spec.ts — VIEW ▸ Build cost, PHONE TIER only.
// The shopping list, the per-component rows and recipe-chain expansion, the
// structural sections (blocks / triangles / cables with their run lengths)
// and the fold law (incl. its localStorage persistence) all retired to the
// jsdom tier — src/components/__tests__/costwidget.test.tsx runs the SAME
// crafts (dolphin 3417786605, gantry 3732302108), the SAME shipped
// economy.json and the SAME green numbers (×4 · 4 kg · 157 cells · 241 tris
// · 150.6 m · ×7,362 · 74.8 m); the math is economy.test.ts (L5,
// docs/TEST-PYRAMID.md v1.12.4). What stays is the DEVICE law the phone
// matrix exists for: in the pixel7 drawer the section is reachable in VIEW
// and the widget never outgrows the panel.
import { expect, test } from '@playwright/test';

const DOLPHIN = '3417786605';

test.describe('VIEW ▸ build cost @ui', () => {
  test('mobile: the section is reachable in VIEW and fits the panel', async ({ page }) => {
    test.skip(test.info().project.name === 'chromium', 'phone project only');
    await page.goto(`/?craft=${DOLPHIN}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    const tab = page.getByTestId('panel-tab');
    if (await tab.isVisible()) await tab.click();
    await expect(page.getByTestId('vessel-stats')).toBeVisible();
    await page.getByTestId('cost-widget').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('cost-toggle')).toBeVisible();
    if (!(await page.getByTestId('cost-total').isVisible().catch(() => false)))
      await page.getByTestId('cost-toggle').click();
    await expect(page.getByTestId('cost-total')).toBeVisible();
    const box = (await page.getByTestId('cost-widget').boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  });
});
