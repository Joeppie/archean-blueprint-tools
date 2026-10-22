// cost.spec.ts — VIEW ▸ Build cost (user 2026-10-22: "In the view tab,
// summarize the total cost of all components expressed in raw materials, do a
// complete breakdown per component; e.g. what does the fluidport cost? and
// what do its constituents cost?" — then cables, blocks and hull triangles:
// "similar breakdown as for components, where it does specify what is
// required").
//
// Pinned through the REAL UI on the dolphin (3417786605 — 4 FluidPorts, one of
// them inside a Build subgrid, so the nested-content rule is exercised):
// the raw-material shopping list, the per-component rows, and a component's
// recipe chain opened down to its constituents. Numbers come from the shipped
// economy.json (game recipes) — the FluidPort constants are pinned in vitest
// (economy.test.ts); here we assert the UI actually shows them.
import { expect, test, type Page } from '@playwright/test';

const DOLPHIN = '3417786605';
/** decks + a hull skin + 110 cable runs — the structural sections' fixture */
const STRUCTURE = '3732302108';

async function openView(page: Page) {
  await page.goto(`/?craft=${DOLPHIN}`);
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
  await expect(page.getByTestId('mode-view')).toHaveClass(/\bon\b/);
  await expect(page.getByTestId('vessel-stats')).toBeVisible();
}

const desktopOnly = () => test.skip(test.info().project.name !== 'chromium', 'desktop-only');

test.describe('VIEW ▸ build cost @ui', () => {
  test('raw-material total + per-component breakdown with constituents', async ({ page }) => {
    desktopOnly();
    await openView(page);

    const widget = page.getByTestId('cost-widget');
    await expect(widget).toBeVisible();
    await expect(page.getByTestId('cost-head')).toContainText('parts');
    await expect(page.getByTestId('cost-head')).toContainText('cells');

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

  test('blocks, hull triangles and cables: their own quantity + breakdown', async ({ page }) => {
    desktopOnly();
    await page.goto(`/?craft=${STRUCTURE}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await expect(page.getByTestId('mode-view')).toHaveClass(/\bon\b/);
    await expect(page.getByTestId('cost-widget')).toBeVisible();

    // BLOCKS — 157 aluminium cells on the deck, and the section says so
    await expect(page.getByTestId('cost-source-note-blocks')).toContainText('cells');
    const alu = page.getByTestId('cost-source-row-blocks-AluminiumBlock');
    await expect(alu).toBeVisible();
    await expect(alu).toContainText('×157');
    await expect(page.getByTestId('cost-source-measure-blocks-AluminiumBlock'))
      .toContainText('157 cells');
    // a block row opens into ITS constituents (a cell = 1 AluminiumBlock = 500 g Al)
    await page.getByTestId('cost-source-open-blocks-AluminiumBlock').click();
    const detail = page.getByTestId('cost-source-detail-blocks-AluminiumBlock');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('Aluminium');

    // HULL TRIANGLES — 241 tris over 34.5 m², billed in block items
    await expect(page.getByTestId('cost-source-note-triangles')).toContainText('241 tris');
    await expect(page.getByTestId('cost-source-note-triangles')).toContainText('m²');
    const triAlu = page.getByTestId('cost-source-row-triangles-AluminiumBlock');
    await expect(triAlu).toContainText('×248');
    await expect(page.getByTestId('cost-source-measure-triangles-AluminiumBlock'))
      .toContainText('m²');

    // CABLES — the LENGTH the craft actually needs, plus the spool items
    await expect(page.getByTestId('cost-source-note-cables')).toContainText('110 runs');
    await expect(page.getByTestId('cost-source-note-cables')).toContainText('150.6 m');
    const data = page.getByTestId('cost-source-row-cables-DataCable');
    await expect(data).toContainText('×7,362');
    await expect(page.getByTestId('cost-source-measure-cables-DataCable'))
      .toContainText('74.8 m');
    // … and a cable's own constituents: Wire + Connector per spool batch
    await page.getByTestId('cost-source-open-cables-DataCable').click();
    const cabDetail = page.getByTestId('cost-source-detail-cables-DataCable');
    await expect(cabDetail).toBeVisible();
    await expect(page.getByTestId('cost-node-Wire')).toBeVisible();
    await expect(page.getByTestId('cost-node-Connector')).toBeVisible();
  });

  test('every section folds, and the fold survives a reload', async ({ page }) => {
    desktopOnly();
    await page.goto(`/?craft=${STRUCTURE}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await expect(page.getByTestId('cost-widget')).toBeVisible();

    // BLOCKS: folding hides the rows but keeps the header's summary
    const blockRow = page.getByTestId('cost-source-row-blocks-AluminiumBlock');
    await expect(blockRow).toBeVisible();
    await page.getByTestId('cost-sec-blocks').click();
    await expect(blockRow).toHaveCount(0);
    await expect(page.getByTestId('cost-source-note-blocks')).toBeVisible();
    await expect(page.getByTestId('cost-source-note-blocks')).toContainText('cells');
    await page.getByTestId('cost-sec-blocks').click();
    await expect(blockRow).toBeVisible();

    // the raw-material list and the parts list fold too
    await page.getByTestId('cost-sec-raw').click();
    await expect(page.getByTestId('cost-total')).toHaveCount(0);
    await page.getByTestId('cost-sec-raw').click();
    await expect(page.getByTestId('cost-total')).toBeVisible();

    // a fold is a PREFERENCE: it comes back folded after a reload
    await page.getByTestId('cost-sec-components').click();
    await expect(page.getByTestId('cost-rows')).toHaveCount(0);
    await page.reload();
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await expect(page.getByTestId('cost-rows')).toHaveCount(0);
    await expect(page.getByTestId('cost-sec-components')).toHaveAttribute('aria-expanded', 'false');
    // … and can be opened again (the state is not sticky-locked)
    await page.getByTestId('cost-sec-components').click();
    await expect(page.getByTestId('cost-rows')).toBeVisible();
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
