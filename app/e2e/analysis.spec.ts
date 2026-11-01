// analysis.spec.ts — THE CRAFT ANALYSIS (v1.17.0, we: "let our editor
// automatically make a mermaid diagram of the xenoncode and display
// that … above each sequence diagram, render a PNG of the vessel …
// considering files as classes … Io devices … as system actors and button
// presses, cockpit as a user … flight characteristics optional of course,
// not logical for a rover or for Mario").
//
// e2e-tier because: the MERMAID RUNTIME renders SVG in the DOM, the vessel
// plate is a real WebGL offscreen pass, and ⬇ HTML is a browser download.
// The diagram GRAMMAR itself (sources, actors, resolved devices, burial)
// is vitest-pure in xcgraph.test.ts.
//
// @slow: the mermaid chunk + runtime and the WebGL plates on the iGPU.
import { expect, test } from '@playwright/test';

test.describe('@analysis @slow THE CRAFT ANALYSIS', () => {
  test('a FLYING craft: three rendered diagrams, vessel plates, the flight section @ui', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop dialog density (analysis family)');
    test.setTimeout(300_000);
    // the aileroned craft from the surface-cable law (3327182790)
    await page.goto('/?craft=3327182790');
    await page.waitForFunction(() => !!(window as any).__ARCHEAN__?.engine?.blueprint,
      null, { timeout: 150_000 });
    await page.getByTestId('analysis-btn').click();
    await expect(page.getByTestId('analysis-dock')).toBeVisible();

    for (const kind of ['flow', 'sequence', 'class']) {
      await expect(page.getByTestId(`analysis-${kind}`)).toBeVisible();
      // the mermaid RUNTIME produced a real SVG for each
      await expect.poll(async () =>
        page.getByTestId(`analysis-${kind}`).locator('svg').count(),
      { timeout: 120_000, message: `${kind} diagram renders` }).toBe(1);
      expect(await page.getByTestId(`analysis-error-${kind}`).count()).toBe(0);
    }
    // the vessel plate pair above/with the reading: topside + front PNGs
    await expect(page.getByTestId('analysis-plates').locator('img')).toHaveCount(2,
      { timeout: 120_000 });

    // v1.17.1 THE PURE-SVG LAW (we: "SVG doesn't rendee images"): every
    // rendered diagram is foreignObject-free — real <text>, renders in the
    // dialog, in the export and in any copied file alike.
    expect(await page.evaluate(() => document
      .querySelectorAll('[data-testid^="analysis-"] svg foreignObject').length)).toBe(0);
    // (counts are program-shaped — a node-generated program has few nodes;
    // the LAW is: zero foreignObject, real text labels present)
    await expect.poll(async () => page.evaluate(() => document
      .querySelectorAll('[data-testid="analysis-flow"] svg text').length)).toBeGreaterThan(0);

    // v1.17.1 NAVIGATION (we: "I cannot navigate or move through the
    // diagrams properly"): zoom controls drive the diagram transform.
    const k0 = await page.getByTestId('analysis-zoom-k').first().textContent();
    await page.getByTestId('analysis-zoom-in').first().click();
    await page.getByTestId('analysis-zoom-in').first().click();
    await expect.poll(async () =>
      page.getByTestId('analysis-zoom-k').first().textContent(),
    { timeout: 10_000 }).not.toBe(k0);
    await page.getByTestId('analysis-zoom-max').first().click();   // ⤢ overlay
    await page.getByTestId('analysis-zoom-reset').first().click();
    await page.getByTestId('analysis-zoom-max').first().click();   // ⤡ back

    // v1.17.1 THE CODE RUNDOWN (we: "should give a better rundown")
    await expect(page.getByTestId('analysis-rundown')).toBeVisible();
    await expect(page.getByTestId('analysis-rundown')).toContainText(/lines|entries/);
    // flight: the plane gets the FLIGHT LAB reading (it carries surfaces)
    await expect(page.getByTestId('analysis-flight-report')).toBeVisible({ timeout: 60_000 });

    // ⬇ HTML: the whole reading exports as ONE download
    const dl = page.waitForEvent('download', { timeout: 30_000 });
    await page.getByTestId('analysis-export').click();
    const file = await dl;
    expect(file.suggestedFilename()).toBe('craft-3327182790-analysis.html');
  });

  test('a NON-flying craft (the Mario cabinet): diagrams yes, aero theatre no @ui', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop dialog density (analysis family)');
    test.setTimeout(300_000);
    await page.goto('/?craft=3820116990');
    await page.waitForFunction(() => !!(window as any).__ARCHEAN__?.engine?.blueprint,
      null, { timeout: 150_000 });
    await page.getByTestId('analysis-btn').click();
    await expect(page.getByTestId('analysis-dock')).toBeVisible();
    await expect.poll(async () =>
      page.getByTestId('analysis-sequence').locator('svg').count(),
    { timeout: 120_000 }).toBe(1);
    // the honest gate: no flight-control surfaces → no flight theatre
    await expect(page.getByTestId('analysis-flight')).toContainText(/Not applicable/i);
    expect(await page.getByTestId('analysis-flight-report').count()).toBe(0);
  });
});
