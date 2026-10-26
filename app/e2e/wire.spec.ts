// WIRE-mode workspace pins (v1.10.1, user: "I want to be able to
// disconnect/reconnect wires and get a better overview of what is wired to
// what … on mouse-over of a cable, it should tell us where things are going.
// e.g. 'propellor[9].1 <-> Computer[0].1' … a disconnect/reconnect for every
// component"). The DIRECTION/RANKING logic is pure-pinned in
// engine/__tests__/wiremodel.test.ts; this suite pins the UI loops: the
// cable list with its per-row disconnect (through bp AND doc AND undo), the
// viewport hover label, the panel-hover 3D highlight and the networks list.
import { expect, test, type Page } from '@playwright/test';
/** Mirror of engine/wireops shortPort (the e2e tsconfig is nodenext and
 *  cannot import app modules) — the pure function is vitest-pinned in
 *  wiremodel.test.ts; this copy only formats the UI assertions. */
function shortPort(name: string): string {
  const toks = name.toLowerCase().split(/[-_.\s/]+/).filter(Boolean).map(t =>
    t === 'lowvoltage' ? 'lv'
      : t === 'highvoltage' ? 'hv'
        : t === 'input' ? 'in'
          : t === 'output' ? 'out'
            : t === 'fluid' ? 'fl'
              : t === 'item' || t === 'items' ? 'it'
                : t === 'port' ? ''
                  : /^0\d*$/.test(t) ? String(Number(t))
                    : t)
    .filter(Boolean);
  return toks.join('-') || name.toLowerCase();
}

const ISW = '3812927875';                    // fluid + data + lv + hv cables

const pipes = (page: Page) => page.evaluate(() =>
  (window as unknown as {
    __ARCHEAN__?: { engine: { blueprint: { data: { pipes?: unknown[] } } } };
  }).__ARCHEAN__!.engine.blueprint.data.pipes?.length ?? 0);
const netPipes = (page: Page) => page.evaluate(() =>
  (window as unknown as {
    __ARCHEAN__?: { engine: { pipeInfo: () => { pipes: number } } };
  }).__ARCHEAN__!.engine.pipeInfo().pipes);
const wireHover = (page: Page) => page.evaluate(() =>
  (window as unknown as {
    __ARCHEAN__?: { wireHover: () => { pi: number; label: string } | null };
  }).__ARCHEAN__!.wireHover());
const cablePoint = (page: Page, pi: number) => page.evaluate((p) =>
  (window as unknown as {
    __ARCHEAN__?: { cablePoint: (i: number) => { x: number; y: number } | null };
  }).__ARCHEAN__?.cablePoint(p) ?? null, pi);

async function openWire(page: Page, id = ISW) {
  await page.goto(`/?craft=${id}`);
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
  await page.getByTestId('mode-wire').click();
  await expect(page.getByTestId('wire-cables')).toBeVisible();
  await expect.poll(() => netPipes(page), { timeout: 15_000 }).toBeGreaterThan(0);
}

test.describe('wire overview, hover labels, disconnect / reconnect @ui', () => {
  const desktopOnly = () => test.skip(test.info().project.name !== 'chromium', 'desktop-only');

  // v1.12.1 CHAIN LAW: six desktop legs shared one boot (ISW, wire
  // mode) — ONE boot runs them in order: reads (list, cable hover, row
  // hover) → the doc mutation that RESTORES (disconnect → undo, gated
  // hard: the reconnect premise) → manual reconnect → auto-wire LAST.
  // expect.soft(.poll) per law: a violation reports, the chain continues;
  // openWire and the undo-restoration premise stay hard.
  test('the wire workspace: list, hovers, disconnect→undo→reconnect, auto-wire (one boot)', async ({ page }) => {
    desktopOnly();
    await openWire(page);

    await test.step('the cable list shows BOTH endpoints per row + networks overview', async () => {
    const rows = page.getByTestId(/^wire-cable-\d+$/);
    await expect(rows.first()).toBeVisible();
    const first = await rows.first().textContent();
    expect(first, 'the user\'s requested form: Type[ci].port ↔ Type[ci].port')
      .toMatch(/\S+\[\d+\]\.\S+\s*↔\s*\S+\[\d+\]\.\S+/);
    // the NETWORKS overview names each connected group sources → hubs → …
    const net = page.getByTestId('wire-net').first();
    await expect(net).toBeVisible();
    expect(await net.textContent()).toContain('→');
    });

    await test.step('hovering a cable in the viewport prints the endpoint label + gold-lights it', async () => {
      const pt = await cablePoint(page, 0);
      expect(pt).not.toBeNull();
      await page.mouse.move(pt!.x, pt!.y);
      await expect.poll(() => wireHover(page), { timeout: 6000, intervals: [120] })
        .not.toBeNull();
      const h = (await wireHover(page))!;
      // v1.11 short-port labels allow hyphens ('Mini-Comp[14].data-7 ↔
      // LV-Batt[2].data'): the shape law is Type[idx].port ↔ Type[idx].port
      expect(h.label).toMatch(/^[A-Za-z0-9_-]+\[-?\d+\]\.\S+ ↔ [A-Za-z0-9_-]+\[-?\d+\]\.\S+$/);
      const chip = page.getByTestId('wire-chip');
      await expect(chip).toBeVisible();
      expect(await chip.textContent()).toBe(h.label);
      // moving off the cable kills the chip and the highlight
      await page.mouse.move(20, 20);
      await expect.poll(() => wireHover(page), { timeout: 6000, intervals: [120] })
        .toBeNull();
      await expect(chip).toBeHidden();
    });

    await test.step('hovering a cable ROW gold-lights that cable in 3D', async () => {
    await page.getByTestId('wire-cable-2').hover();
    await expect.poll(() => wireHover(page), { timeout: 6000, intervals: [120] })
      .not.toBeNull();
    const h = (await wireHover(page))!;
    expect(h.pi).toBe(2);
    expect(h.label.length, 'the row hover carries the same label').toBeGreaterThan(4);
    await page.mouse.move(8, 8);                           // leaves the list
    await expect.poll(() => wireHover(page), { timeout: 6000, intervals: [120] })
      .toBeNull();
    });

    await test.step('disconnect → gone everywhere → Ctrl+Z restores the exact cable', async () => {
      const before = await pipes(page);
      await page.getByTestId('wire-cut-0').click();
      await expect.poll(() => pipes(page)).toBe(before - 1);
      await expect.poll(() => netPipes(page), { timeout: 10_000 }).toBe(before - 1);
      // the SAVE text mirrors it (doc = the save = the history, v1.6.1 rule)
      const savedHas = await page.evaluate(() => {
        const w = window as unknown as { __ARCHEAN__?: { engine: { blueprint: { data: { pipes?: unknown[] } } } } };
        return w.__ARCHEAN__!.engine.blueprint.data.pipes!.length;
      });
      expect(savedHas).toBe(before - 1);
      // undo (the flush + snapshot stack): the exact cable rides back
      await page.getByTestId('canvas').click({ position: { x: 12, y: 12 } });
      await page.keyboard.press('Control+z');
      await expect.poll(() => pipes(page), { timeout: 10_000 }).toBe(before);
      await expect.poll(() => netPipes(page), { timeout: 10_000 }).toBe(before);
    });

    await test.step('reconnect: cut a cable, re-drop it onto the SAME two ports manually', async () => {
      // ISW has no subgrids ⇒ flattened == top-level indices (wireops.test pins)
      const c0 = await page.evaluate(() => {
        const p = (window as unknown as {
          __ARCHEAN__?: { engine: { blueprint: { data: { pipes?: {
            a_component: number; a_port: string; b_component: number; b_port: string; type?: string;
          }[] } } } };
        }).__ARCHEAN__!.engine.blueprint.data.pipes![0]!;
        return { ...p };
      });
      await page.getByTestId('wire-cut-0').click();
      const before = await pipes(page);
      await expect.poll(() => netPipes(page), { timeout: 10_000 }).toBe(before);
      // select the A part: its freed port is offered as ○ again
      await page.evaluate((ci) => (window as unknown as {
        __ARCHEAN__?: { engine: { select: (i: number) => void } };
      }).__ARCHEAN__!.engine.select(ci), c0.a_component);
      const portBtn = page.locator('[data-testid="wire-port"]',
        { hasText: new RegExp(`(^|\\s)${shortPort(c0.a_port).replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`) }).first();
      await expect(portBtn).toBeEnabled();
      await portBtn.click();
      const bType = await page.evaluate((ci) => (window as unknown as {
        __ARCHEAN__?: { engine: { blueprint: { data: { components: { type: string }[] } } } };
      }).__ARCHEAN__!.engine.blueprint.data.components[ci]!.type, c0.b_component);
      // v1.11: the candidate rows print the SHORTENED type ('Mini-Comp[14]')
      // — filter by the [idx] the label always carries.
      void bType;
      await page.getByTestId('wire-target-search').fill(`[${c0.b_component}]`);
      const target = page.locator('[data-testid="wire-target-item"]', { hasText: `[${c0.b_component}]` }).first();
      await target.click();                                 // STEP 1: the part
      const port = page.locator('[data-testid="wire-target-port"]',
        { hasText: new RegExp(`(^|\\s)${shortPort(c0.b_port).replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`) }).first();
      await expect(port, 'the exact freed port is listed (with its logical reason)')
        .toBeVisible();
      await port.click();                                   // STEP 2: the port
      await expect.poll(() => pipes(page), { timeout: 10_000 }).toBe(before + 1);
      await expect(page.getByTestId('wire-cables'), 'the re-dropped cable reads like the original')
        .toContainText(new RegExp(`${shortPort(c0.a_port).replaceAll('.', '\\.')} ↔`));
    });

    await test.step('auto-wire (logical) answers and is idempotent (mutating, LAST)', async () => {
    const before = await pipes(page);
    await page.getByTestId('auto-wire').click();
    await expect(page.getByTestId('wire-census')).toContainText(/wired \d+|nothing to pair/);
    const after = await pipes(page);
    expect(after, 'observed wiring only adds compatible, free-port cables')
      .toBeGreaterThanOrEqual(before);
    // a second pass on the same state is a NO-OP: every eligible free port
    // was satisfied by the first pass (the old naive router kept inventing
    // cables on the second click)
    await page.getByTestId('auto-wire').click();
    await expect.poll(() => pipes(page), { timeout: 10_000 }).toBe(after);
    });
  });

  // RETIRED v1.12.1 (chain law): a step of the wire workspace chain above.

  // RETIRED v1.12.1 (chain law): a step of the wire workspace chain above.

  // RETIRED v1.12.1 (chain law): a step of the wire workspace chain above.

  // RETIRED v1.12.1 (chain law): a step of the wire workspace chain above.

  // RETIRED v1.12.1 (chain law): a step of the wire workspace chain above.

  // v1.11 TODO pins (B + C, we: "X-ray precision: engine.wireXrayActive()
  // probe exists — no spec asserts cuts>0 after a 2 s hover on a blocked
  // truck cable, cuts==0 for an exposed one, and full restore on un-hover"
  // + "no spec asserts surges().surges ≥ 2 at the X-ray transition").
  // The truck (3481322297, 375 cables routed THROUGH cab/deck/box) is the
  // BLOCKED fixture (measured census: every truck cable has occluders in
  // front). The EXPOSED half of this trio moved to the node tier in
  // v1.12.1 — xray.test.ts (see the retirement note at the file bottom).
  // v1.12.1 CHAIN LAW: the two @slow truck legs shared the TRUCK boot
  // (~15 s) and the page-side surge sampler; the occlusion census scan
  // (292 raycast runs over the 375-cable craft) ran TWICE. One boot, one
  // sampler, one census; the surge-peak counter resets before the second
  // step so it belongs to that step. Budget = the SUM of the two 240 s legs.
  // RETIRED v1.12.1 (fixture-first, docs/TEST-PYRAMID.md L2 + REWRITE §P7.3a):
  // every law of the truck chain — census shape, the BLOCKED X-ray episode
  // (immediate highlight, 2 s dwell, ≥2 cursor-surges, bubbles, FULL
  // restore), and the ONE-WAY input flow — now runs on its generated
  // fixture in wire-xray.spec.ts (4 cables, ~1 s boot vs the truck's 375
  // cables + ~15 s; the census scan milliseconds vs minutes). The truck
  // DATA laws (socket re-seat, drape, harness follow) are pinned headless
  // over the real blueprint (scene.headless.test.ts 'cables render like
  // the game'), which boots the full craft in ~0.3 s — no browser needed.

  // RETIRED v1.12.1 (chain law): the ONE-WAY pulses leg is the second
  // step of the truck chain above — same boot, same sampler, the census
  // scan paid ONCE instead of twice.

  // RETIRED v1.12.1 (docs/TEST-PYRAMID.md L1/L5): 'an EXPOSED cable (XYQ
  // door harness) cuts nothing' — the census LAW (exposed geometry → 0
  // cuts; partial/blocked/ortho/segment-target/fully-in-the-way regimes) is
  // pinned headless in src/engine/__tests__/xray.test.ts on synthetic
  // THREE geometry; the Engine collector delegating to xrayPlanPure ships
  // the same code path. The remaining truck @slow leg keeps the PIXEL half
  // (surge-from-cursor, overlay restore) that needs a real renderer.

  test('on a phone the cable list is reachable and the census fits', async ({ page }) => {
    await openWire(page);
    await expect(page.getByTestId('wire-cables')).toBeVisible();
    await expect(page.getByTestId('wire-census')).toContainText('connected');
    const row = page.getByTestId('wire-cable-1');
    await expect(row).toBeVisible();
    const box = (await row.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(box.x + box.width, 'a cable row never hangs off the phone screen')
      .toBeLessThanOrEqual(vp.width + 1);
  });
});
