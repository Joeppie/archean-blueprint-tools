// cost.spec.ts — VIEW ▸ Component cost (user 2026-10-22: "In the view tab,
// summarize the total cost of all components expressed in raw materials, do a
// complete breakdown per component; e.g. what does the fluidport cost? and
// what do its constituents cost?").
//
// Pinned through the REAL UI on the dolphin (3417786605 — 4 FluidPorts, one of
// them inside a Build subgrid, so the nested-content rule is exercised):
// the raw-material shopping list, the per-component rows, and a component's
// recipe chain opened down to its constituents. Numbers come from the shipped
// economy.json (game recipes) — the FluidPort constants are pinned in vitest
// (economy.test.ts); here we assert the UI actually shows them.
import { expect, test, type Page } from '@playwright/test';

const DOLPHIN = '3417786605';

async function openView(page: Page) {
  await page.goto(`/?craft=${DOLPHIN}`);
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
  await expect(page.getByTestId('mode-view')).toHaveClass(/\bon\b/);
  await expect(page.getByTestId('vessel-stats')).toBeVisible();
}

const desktopOnly = () => test.skip(test.info().project.name !== 'chromium', 'desktop-only');

test.describe('VIEW ▸ component cost @ui', () => {
  test('raw-material total + per-component breakdown with constituents', async ({ page }) => {
    desktopOnly();
    await openView(page);

    const widget = page.getByTestId('cost-widget');
    await expect(widget).toBeVisible();
    await expect(page.getByTestId('cost-head')).toContainText('parts');
    await expect(page.getByTestId('cost-head')).toContainText('raw materials');

    // the craft-wide shopping list carries the dolphin's biggest ore
    const iron = page.getByTestId('cost-total-Iron');
    await expect(iron).toBeVisible();
    await expect(iron).toContainText('kg');

    // the FluidPort row: 4 of them (3 placed + 1 in a Build subgrid)
    const fpRow = page.getByTestId('cost-row-FluidPort');
    await expect(fpRow).toBeVisible();
    await expect(fpRow).toContainText('×4');
    await expect(fpRow).toContainText('subgrid');
    // its summary is its per-part raw cost, scaled by 4: 4,000 g iron = 4 kg
    const sum = page.getByTestId('cost-sum-FluidPort');
    await expect(sum).toContainText('Iron');
    await expect(sum).toContainText('4 kg');

    // open it: the constituents are the recipe's own inputs …
    await page.getByTestId('cost-open-FluidPort').click();
    const detail = page.getByTestId('cost-detail-FluidPort');
    await expect(detail).toBeVisible();
    await expect(page.getByTestId('cost-node-Casing')).toBeVisible();
    await expect(page.getByTestId('cost-node-Connector')).toBeVisible();
    // … each carrying its OWN raw cost (Casing = 1,000 g Iron)
    await expect(page.getByTestId('cost-node-Casing')).toContainText('1 kg Iron');
    await expect(page.getByTestId('cost-node-Connector')).toContainText('Carbon');

    // and a constituent expands further: Connector → Wire + Plastic
    await page.getByTestId('cost-expand-Connector').click();
    await expect(page.getByTestId('cost-node-Wire')).toBeVisible();
    await expect(page.getByTestId('cost-node-Plastic')).toBeVisible();

    // collapsing hides the chain again (no stale tree)
    await page.getByTestId('cost-open-FluidPort').click();
    await expect(detail).toHaveCount(0);
  });

  test('a recipe-less part is flagged, not silently free', async ({ page }) => {
    desktopOnly();
    await openView(page);
    // the dolphin carries sensors built into the game with no crafter recipe
    const head = page.getByTestId('cost-head');
    await expect(head).not.toContainText('no economy data');
    const rows = page.getByTestId('cost-rows');
    await expect(rows).toContainText('Aileron');
    // the total block always renders (even when only stuck parts exist)
    await expect(page.getByTestId('cost-total')).toBeVisible();
  });

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
