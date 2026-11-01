// analysis.spec.ts — THE CRAFT ANALYSIS (v1.17.0, we: "let our editor
// automatically make a mermaid diagram of the xenoncode and display
// that … above each sequence diagram, render a PNG of the vessel …
// considering files as classes … Io devices … as system actors and button
// presses, cockpit as a user … flight characteristics optional of course,
// not logical for a rover or for Mario").
//
// e2e-tier because: the MERMAID RUNTIME renders SVG in the DOM, the vessel
// plate is derived from the live scene graph (compRoots boxes + pipeNet
// runs — the real cable geometry), and ⬇ HTML is a browser download.
// The diagram GRAMMAR itself (sources, actors, resolved devices, burial)
// is vitest-pure in xcgraph.test.ts.
//
// @slow: the mermaid chunk + runtime and the full scene builds behind the
// vector plates.
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

    for (const kind of ['class', 'flow', 'seqin', 'seqout']) {
      await expect(page.getByTestId(`analysis-${kind}`)).toBeVisible();
      // the mermaid RUNTIME produced a real SVG for each
      await expect.poll(async () =>
        page.getByTestId(`analysis-${kind}`).locator('svg').count(),
      { timeout: 120_000, message: `${kind} diagram renders` }).toBe(1);
      expect(await page.getByTestId(`analysis-error-${kind}`).count()).toBe(0);
    }
    // v1.17.2 THE VECTORIZATION (we: "its too small and should be more
    // zoomable … it would be really nice if it was SVG"): the plate is ONE
    // inline SVG sheet (front/side/topside) rendered through the SAME
    // DiagramView as the mermaid diagrams — 3 views in ONE sheet.
    await expect(page.getByTestId('analysis-plates').locator('svg')).toHaveCount(1,
      { timeout: 120_000 });
    // THE PLATE HAS A SHIP ON IT (the "COUNT IS NOT CONTENT" law): the
    // vector plate is the craft's OWN mesh silhouettes — thousands of
    // projected, painter-sorted polygons in the faces' own colours,
    // actors filled in their label colour, cable runs, leader labels.
    // (v1.17.2, we on the bbox first cut: "the chair looks unrecognizable
    // in the SVG. did you just use bounding boxes? That is not OK".)
    const plate = await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="analysis-plates"] svg')!;
      const polys = [...svg.querySelectorAll('polygon')];
      const fills = polys.map(p => p.getAttribute('fill') || '');
      return {
        polys: polys.length,
        actorPolys: fills.filter(f => /#(ffd98a|7dffcf|9fd0ff|ff9ecb|c9ff8a|ffb08a|b7a6ff|8afff0|ffe08a|f0a6ff|a6ffd0|ffa6a6)/.test(f)).length,
        fills: new Set(fills.filter(f => !/#(ffd98a|7dffcf|9fd0ff|ff9ecb|c9ff8a|ffb08a|b7a6ff|8afff0|ffe08a|f0a6ff|a6ffd0|ffa6a6)/.test(f))).size,
        cables: svg.querySelectorAll('polyline').length,
        labels: svg.querySelectorAll('text').length,
        leaders: svg.querySelectorAll('line').length,
        views: [...svg.querySelectorAll('text')].filter(t => /FRONT|SIDE|TOPSIDE/.test(t.textContent || '')).length,
      };
    });
    expect(plate.polys, 'mesh-silhouette polygons').toBeGreaterThan(300);
    expect(plate.actorPolys, 'colour-filled actor faces').toBeGreaterThanOrEqual(20);
    expect(plate.fills, 'faces keep their own material colours').toBeGreaterThan(2);
    expect(plate.labels, 'leader labels').toBeGreaterThan(4);
    expect(plate.views, 'three view captions').toBe(3);

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
    // v1.17.2 THE CRAFT HEADER (we: "weight, costs and flight characteristics
    // should be higher up"): mass/weight/build cost lead the reading, ABOVE
    // the diagrams (DOM order asserts the placement, content the numbers).
    await expect(page.getByTestId('analysis-summary')).toContainText(/kg/);
    await expect(page.getByTestId('analysis-summary')).toContainText(/weight\s[\d,.]+\sN/);
    await expect(page.getByTestId('analysis-summary')).toContainText(/raw material units/);
    const order = await page.evaluate(() => {
      const body = document.querySelector('[data-testid="analysis-body"]')!;
      const idx = (t: string) => [...body.querySelectorAll('[data-testid]')]
        .findIndex(el => (el as HTMLElement).dataset.testid === t);
      return { summary: idx('analysis-summary'), flight: idx('analysis-flight'),
        plates: idx('analysis-plates'), rundown: idx('analysis-rundown') };
    });
    expect(order.summary).toBeLessThan(order.plates);
    expect(order.flight).toBeLessThan(order.plates);
    expect(order.plates).toBeLessThan(order.rundown);
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
      page.getByTestId('analysis-seqin').locator('svg').count(),
    { timeout: 120_000 }).toBe(1);
    // the honest gate: no flight-control surfaces → no flight theatre
    await expect(page.getByTestId('analysis-flight')).toContainText(/Not applicable/i);
    expect(await page.getByTestId('analysis-flight-report').count()).toBe(0);
  });

  test('the WORK CENSUS: compute card per program, HUDs as first-class tabs @ui', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop dialog density (analysis family)');
    test.setTimeout(300_000);
    // the ChipOS devkit-style bench: computers AND a HudController
    await page.goto('/?craft=3326372833');
    await page.waitForFunction(() => !!(window as any).__ARCHEAN__?.engine?.blueprint,
      null, { timeout: 150_000 });
    await page.getByTestId('analysis-btn').click();
    await expect(page.getByTestId('analysis-dock')).toBeVisible();
    // the census card answers with the game-unit work or the honest n/a
    await expect(page.getByTestId('analysis-compute')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('analysis-compute')).toContainText(
      /IPC units\/cycle|n\/a \(engine predates/);
    // the live farm (live=off here) means the card may be at 0 samples —
    // the LAW text must still be quoted (Max IPC = server config, 30→500 W)
    await expect(page.getByTestId('analysis-compute')).toContainText(/Max IPC|wiki Computer/);
    // a HUD joins as a tab and carries the CLIENT law, not the server cap
    const hudTab = page.locator('[data-testid^="analysis-hud-"]').first();
    if (await hudTab.count() > 0) {
      await hudTab.click();
      await expect(page.getByTestId('analysis-compute')).toContainText(/client/i,
        { timeout: 30_000 });
      await expect(page.getByTestId('analysis-seqin')).toBeVisible();
    }
  });
});