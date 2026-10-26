// wire-xray.spec.ts — the X-RAY + FLOW law on its FIXTURE (P7.3a, shipped
// 2026-10-26; this spec is the pin list REWRITE §P7.3a promised). The
// fixture (testdata/9000007001, "xray-test", 73 blocks, 9 comps, 4 pipes,
// boot ~1 s vs the truck's ~15 s) exists so these laws leave the
// truck-sized corpus behind (docs/TEST-PYRAMID.md L2: fixtures beat
// corpora — a generated artifact that exhibits the law, and the law ONLY).
//
// Topology (make_xray_test.py, probe-validated on the live page):
//  | pipe | topology                                  | cuts | flowDir |
//  | 0    | FJ out.001 ↔ FJ out.002, BEHIND the wall  | max  | both    |
//  | 1    | Battery → LVJ lowvoltage-INPUT            |  +   | ab      |
//  | 2    | FJ out.001 → FJ fluid-IN, x-clear         |  min | ab      |
//  | 3    | Battery → LVJ port.002 (hub DOWNSTREAM)   |  +   | both    |
// Beyond the pipes: comp 8 is an UNWIRED Beacon — the dock lists exactly
// 4 rows and the Beacon yields no cable under hover.
//
// Laws pinned here (retired from the truck @slow legs, same commit):
//  • census: every wall-crossing cable occludes (cuts ≥ 1), the x-clear
//    one is the min, the argmax is a behind-the-wall pipe (TODO B pick);
//  • the BLOCKED episode: hover arms the highlight immediately, the 2 s
//    dwell opens the X-ray (cuts>0), the transition fires ≥2 cursor
//    surges from the anchor (one EACH way), bubbles (≥2, the run's kind
//    and dir) keep flowing while the episode is open, un-hover restores
//    EVERY cut mesh (on:false cuts:0 overlays:0) (TODO B + C);
//  • the ONE-WAY input: a cable into lowvoltage-INPUT flows a→b — the
//    bubbles never bounce off the junction IN port (v1.11.7);
//  • the fixture negatives: dock rows == 4, the Beacon yields no cable.
import { expect, test, type Page } from '@playwright/test';

const FIXTURE = '9000007001';

const netPipes = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __ARCHEAN__?: { engine: { pipeInfo: () => { pipes: number } } } };
  return w.__ARCHEAN__ ? w.__ARCHEAN__.engine.pipeInfo().pipes : -1;
});
const wireHover = (page: Page) => page.evaluate(() =>
  (window as unknown as {
    __ARCHEAN__?: { wireHover: () => { pi: number; label: string } | null };
  }).__ARCHEAN__!.wireHover());
const cablePoint = (page: Page, pi: number) => page.evaluate((p) =>
  (window as unknown as {
    __ARCHEAN__?: { cablePoint: (i: number) => { x: number; y: number } | null };
  }).__ARCHEAN__?.cablePoint(p) ?? null, pi);
const xray = (page: Page) => page.evaluate(() => {
  const w = window as unknown as {
    __ARCHEAN__?: { engine: { wireXrayActive: () => { on: boolean; cuts: number;
      overlays: number; bubbles: number; dir: string; kind: string; phase: number } } };
  };
  return w.__ARCHEAN__!.engine.wireXrayActive();
});

async function openFixture(page: Page) {
  await page.goto(`/?craft=${FIXTURE}`);
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
  await page.getByTestId('mode-wire').click();
  await expect(page.getByTestId('wire-cables')).toBeVisible();
  await expect.poll(() => netPipes(page), { timeout: 15_000 }).toBe(4);
}

test.describe('x-ray + flow laws on the fixture @ui', () => {
  const desktopOnly = () => test.skip(test.info().project.name !== 'chromium', 'desktop-only');

  test('census shape, the BLOCKED episode, ONE-WAY flow, the fixture negatives (one boot)', async ({ page }) => {
    desktopOnly();
    await openFixture(page);

    // page-side surge sampler: pulses live 550–1600 ms; a rAF tick counts
    // the peak through the SAME seam the hook exposes (the poll round-trips
    // alone can miss the transition window).
    await page.evaluate(() => {
      const w = window as unknown as { __maxSurges?: number; __ARCHEAN__: { engine: { surgeState: () => { surges: unknown[] } } } };
      w.__maxSurges = 0;
      const e = w.__ARCHEAN__.engine;
      const tick = () => {
        const n = e.surgeState().surges.length;
        if (n > (w.__maxSurges ?? 0)) w.__maxSurges = n;
        requestAnimationFrame(tick);
      };
      tick();
    });

    await test.step('census: every wall-crossing cable occludes; x-clear is the min; positives own the argmax', async () => {
      const cuts = await page.evaluate(() =>
        [0, 1, 2, 3].map((pi) => (window as unknown as {
          __ARCHEAN__: { engine: { xrayCutsFor: (i: number) => number } } }
        ).__ARCHEAN__.engine.xrayCutsFor(pi)));
      for (const [pi, c] of cuts.entries())
        expect.soft(c, `pipe ${pi} crosses the wall (cuts >= 1)`).toBeGreaterThanOrEqual(1);
      const min = Math.min(...cuts);
      expect.soft(cuts[2], 'the x-clear floating pipe is the census min').toBe(min);
      const max = Math.max(...cuts);
      expect.soft([0, 1].includes(cuts.indexOf(max)),
        `the max-cuts pipe is a behind-the-wall pipe (cuts ${cuts.join(',')})`).toBe(true);
    });

    await test.step('the BLOCKED episode: immediate highlight, 2 s dwell opens it, ≥2 cursor-surges, bubbles, FULL restore (TODO B+C)', async () => {
      // the census's max-cuts pipe, with the mid-point-owns-the-hover check
      const pick = await page.evaluate(() => {
        const e = (window as unknown as { __ARCHEAN__: { engine: {
          xrayCutsFor: (i: number) => number; pipeScreenPoint: (i: number) => { x: number; y: number } | null;
          pipeInfo: () => { polys: number[][][] } } } }).__ARCHEAN__.engine;
        let best = -1, cuts = -1;
        for (let pi = 0; pi < 4; pi++) {
          const c = e.xrayCutsFor(pi);
          const poly = e.pipeInfo().polys[pi];
          if (c > cuts && (poly?.length ?? 0) >= 4) { best = pi; cuts = c; }
        }
        return best >= 0 ? { pi: best, cuts, pt: e.pipeScreenPoint(best) } : null;
      });
      expect(pick, 'the fixture has a wall-blocked run with a drawable mid').not.toBeNull();
      const pt = pick!.pt!;
      await page.mouse.move(pt.x, pt.y);
      // the highlight law: the FIRST pointermove arms the hover — NO dwell
      await expect.poll(() => wireHover(page), { timeout: 6_000, intervals: [120] })
        .toMatchObject({ pi: pick!.pi });
      // 2 s of SOLID highlight opens the X-ray
      await page.waitForTimeout(2_400);
      const at = await xray(page);
      expect(at.on, `pipe ${pick!.pi} opened the episode`).toBeTruthy();
      expect.soft(at.cuts, `the episode cuts (census ${pick!.cuts})`).toBeGreaterThan(0);
      const peak = await page.evaluate(() => (window as unknown as { __maxSurges?: number }).__maxSurges ?? 0);
      expect.soft(peak, 'the X-ray transition fired the cursor-surge BOTH ways')
        .toBeGreaterThanOrEqual(2);
      const b1 = await xray(page);
      expect.soft(b1.bubbles, 'the episode carries flowing bubbles').toBeGreaterThanOrEqual(2);
      expect.soft(b1.kind, 'the bubbles wear the run\'s canonical kind').toBeTruthy();
      await page.waitForTimeout(700);
      const b2 = await xray(page);
      expect.soft(b2.on, 'a still mouse keeps the episode open').toBeTruthy();
      expect.soft(Math.abs(b2.phase - b1.phase), 'the bubbles keep travelling').toBeGreaterThan(0.02);
      // un-hover: EVERY cut mesh gets its geometry back
      await page.mouse.move(20, 20);
      await expect.poll(() => xray(page), { timeout: 6_000, intervals: [120] })
        .toMatchObject({ on: false, cuts: 0, overlays: 0, bubbles: 0 });
    });

    await test.step('the ONE-WAY input: bubbles run a→b, never bouncing off the junction IN port (v1.11.7)', async () => {
      await page.evaluate(() => {
        (window as unknown as { __maxSurges?: number }).__maxSurges = 0;
      });
      // pipe 1 is Battery → lowvoltage-INPUT; the fixture pins the law's
      // truth table: an INPUT-fed run is directed, the hub-DOWNSTREAM pair
      // is not
      const dirs = await page.evaluate(() =>
        [0, 1, 3].map((pi) => (window as unknown as {
          __ARCHEAN__: { engine: { pipeFlowDir: (pi: number) => string } } }
        ).__ARCHEAN__.engine.pipeFlowDir(pi)));
      expect.soft(dirs[1], 'the INPUT-fed run is directed a→b').toBe('ab');
      expect.soft(dirs[0], 'junction-out ↔ junction-out is undirected').toBe('both');
      expect.soft(dirs[2], 'a hub DOWNSTREAM output pair is undirected').toBe('both');
      // the episode's bubbles carry the direction (no bouncing)
      const pt = await cablePoint(page, 1);
      expect(pt, 'pipe 1 has a drawable mid-point').not.toBeNull();
      await page.mouse.move(pt!.x, pt!.y);
      await page.waitForTimeout(2_400);
      const st = await xray(page);
      expect(st.on, 'pipe 1 opened its episode').toBeTruthy();
      expect.soft(st.dir, 'one-way: the flow reads ab, never both').toBe('ab');
      expect.soft(st.bubbles, 'bubbles flow on the one-way run too').toBeGreaterThanOrEqual(2);
      await page.mouse.move(20, 20);
      await expect.poll(() => xray(page), { timeout: 6_000, intervals: [120] })
        .toMatchObject({ on: false, cuts: 0, overlays: 0, bubbles: 0 });
    });

    await test.step('fixture negatives: the dock lists exactly 4 cables; the UNWIRED Beacon yields none', async () => {
      await expect.soft(page.getByTestId(/^wire-cable-\d+$/)).toHaveCount(4);
      // the Beacon (comp 8) has no cable: its projected origin answers NO
      // pipe to the hover pick (the drawn net holds only the 4 runs)
      const spot = await page.evaluate(() => {
        const w = window as unknown as { __ARCHEAN__?: { screen: (x: number, y: number, z: number) => [number, number] | null } };
        const a = (window as unknown as { __ARCHEAN__?: { engine: { blueprint: { data: { components: { type: string; position: { x: number; y: number; z: number } }[] } } } } }).__ARCHEAN__;
        const i = a!.engine.blueprint.data.components.findIndex((c) => c.type === 'Beacon');
        const p = a!.engine.blueprint.data.components[i]!.position;
        return w.__ARCHEAN__!.screen(p.x, p.y, p.z);
      });
      expect(spot, 'the Beacon projects into the viewport').not.toBeNull();
      await page.mouse.move(spot![0], spot![1]);
      await page.waitForTimeout(300);
      expect.soft(await wireHover(page), 'no cable answers the Beacon\'s pixel').toBeNull();
    });
  });
});
