// select.spec.ts — selection-driven scene effects (the REWRITE § Playwright
// plan's select suite, opened with the two v0.14x/v0.15x visual features):
//  • cable power-surges: selecting a component fires ONE travelling pulse per
//    connected pipe, additive + depthTest-off (visible THROUGH the hull),
//    a source blip on the picked part and an arrival blip on the far one,
//    everything cleared on deselect (legacy selftest surges=true);
//  • floating labels: INTERACT/aliased parts carry a chip, OFF by default
//    (the legacy user rule), toggled through the real view-options row.
import { expect, test, type Page } from '@playwright/test';

const ISW = '3812927875';

interface Hook {
  engine: {
    blueprint: {
      data: {
        pipes?: { a_component: number; b_component: number }[];
        components: { type: string; alias?: string; position: { y: number } }[];
      };
    } | null;
    select: (ci: number) => void;
    setFilePosAxis: (ci: number, ax: 'x' | 'y' | 'z', v: number) => void;
  };
  surges: () => { surges: { to: number; total: number; dur: number }[];
    flashes: number; arrivals: number; sourceBlip: boolean;
    additiveNoDepth: boolean; links: number };
  labels: () => { total: number; shown: number; aliased: number; on: boolean };
}

async function openCraft(page: Page, id: string) {
  await page.goto(`/?craft=${id}`);
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
}

test('a component selection fires cable power-surges on every connected pipe', async ({ page }) => {
  await openCraft(page, ISW);
  // pick the component with the MOST cables (battery/data rows on ISW)
  const { ci, deg } = await page.evaluate(() => {
    const h = (window as unknown as { __ARCHEAN__: Hook }).__ARCHEAN__;
    const pipes = h.engine.blueprint?.data.pipes ?? [];
    const cnt: Record<number, number> = {};
    for (const p of pipes) {
      cnt[p.a_component] = (cnt[p.a_component] ?? 0) + 1;
      cnt[p.b_component] = (cnt[p.b_component] ?? 0) + 1;
    }
    let ci = -1, best = 0;
    for (const [k, v] of Object.entries(cnt)) if (v > best) { ci = +k; best = v; }
    h.engine.select(ci);
    return { ci, deg: best };
  });
  expect(ci, 'the corpus craft must carry a cable graph').toBeGreaterThan(0);

  const s = await page.evaluate(() =>
    (window as unknown as { __ARCHEAN__: Hook }).__ARCHEAN__.surges());
  expect(s.links, 'the drawn cable graph exists').toBeGreaterThan(0);
  expect(s.surges.length, 'one pulse per connected pipe').toBe(deg);
  for (const p of s.surges) {
    expect(p.to, 'every pulse has a real far component').toBeGreaterThanOrEqual(0);
    expect(p.total, 'pulses only ride real (>= 5 cm) cable runs').toBeGreaterThan(0.05);
    expect(p.dur).toBeGreaterThanOrEqual(550);
  }
  expect(s.additiveNoDepth, 'pulses render additive with depthTest off').toBe(true);
  expect(s.sourceBlip, 'a source blip marks the picked part').toBe(true);

  // every bolt lands: CUMULATIVE arrival counter (no flash-window race) —
  // exactly one arrival blip per pulse, on the far component
  await page.waitForFunction(w => {
    const s = (window as unknown as { __ARCHEAN__: Hook }).__ARCHEAN__.surges();
    return s.surges.length === 0 && s.arrivals === w.deg;
  }, { deg }, { timeout: 10_000, polling: 200 });

  // deselect (Esc path = engine.select(-1)) clears everything
  await page.evaluate(() =>
    (window as unknown as { __ARCHEAN__: Hook }).__ARCHEAN__.engine.select(-1));
  await page.waitForFunction(() => {
    const s = (window as unknown as { __ARCHEAN__: Hook }).__ARCHEAN__.surges();
    return s.surges.length === 0 && s.flashes === 0 && s.arrivals === 0;
  }, null, { timeout: 10_000, polling: 200 });
});

test('labels ride interactive/aliased parts — opt-in, off by default', async ({ page }) => {
  await openCraft(page, ISW);
  const off = await page.evaluate(() =>
    (window as unknown as { __ARCHEAN__: Hook }).__ARCHEAN__.labels());
  expect(off.total, 'INTERACT types (dash/button/seat/beacon…) or aliases exist')
    .toBeGreaterThan(0);
  expect(off.shown, 'labels OFF by default (legacy user rule)').toBe(0);
  expect(off.on).toBe(false);

  // the REAL control: the view-options row (on phones the panel is a drawer —
  // ⚙ opens it, exactly the mobile path)
  const box = page.getByTestId('opt-labels');
  if (!await box.isVisible()) await page.getByTestId('toggle-panels').click();
  await expect(box).toBeVisible();
  await box.check();
  const on = await page.evaluate(() =>
    (window as unknown as { __ARCHEAN__: Hook }).__ARCHEAN__.labels());
  expect(on.on).toBe(true);
  expect(on.shown, 'every label chip becomes visible').toBe(on.total);

  // moving a labelled part carries its chip along (legacy loop: labels ride
  // the VISIBLE model) — and the alias chip (blue) count stays stable
  const moved = await page.evaluate(() => {
    const h = (window as unknown as { __ARCHEAN__: Hook }).__ARCHEAN__;
    const bp = h.engine.blueprint!;
    const i = bp.data.components.findIndex(c =>
      (c.alias ?? '').trim() || ['PilotSeat', 'Beacon', 'Dashboard'].includes(c.type));
    if (i < 0) return null;
    const y0 = bp.data.components[i]!.position.y;
    h.engine.setFilePosAxis(i, 'y', y0 + 1.0);
    const st = h.labels();
    h.engine.setFilePosAxis(i, 'y', y0);            // restore
    return { ci: i, ok: st.shown === st.total, aliased: st.aliased };
  });
  if (moved) {
    expect(moved.ok, 'labels stay visible while the part moves').toBe(true);
    expect(moved.aliased).toBe(off.aliased);
  }

  await box.uncheck();
  expect(await page.evaluate(() =>
    (window as unknown as { __ARCHEAN__: Hook }).__ARCHEAN__.labels().shown)).toBe(0);
});
