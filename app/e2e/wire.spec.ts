// WIRE-mode workspace pins (v1.10.1, user: "I want to be able to
// disconnect/reconnect wires and get a better overview of what is wired to
// what … on mouse-over of a cable, it should tell us where things are going.
// e.g. 'propellor[9].1 <-> Computer[0].1' … a disconnect/reconnect for every
// component"). The DIRECTION/RANKING logic is pure-pinned in
// engine/__tests__/wiremodel.test.ts; this suite pins the UI loops: the
// cable list with its per-row disconnect (through bp AND doc AND undo), the
// viewport hover label, the panel-hover 3D highlight and the networks list.
import { expect, test, type Page } from '@playwright/test';

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
  }).__ARCHEAN__!.cablePoint(p), pi);

async function openWire(page: Page, id = ISW) {
  await page.goto(`/?craft=${id}`);
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
  await page.getByTestId('mode-wire').click();
  await expect(page.getByTestId('wire-cables')).toBeVisible();
  await expect.poll(() => netPipes(page), { timeout: 15_000 }).toBeGreaterThan(0);
}

test.describe('wire overview, hover labels, disconnect / reconnect @ui', () => {
  const desktopOnly = () => test.skip(test.info().project.name !== 'chromium', 'desktop-only');

  test('the cable list shows BOTH endpoints per row', async ({ page }) => {
    desktopOnly();
    await openWire(page);
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

  test('hovering a cable in the viewport prints the endpoint label + gold-lights it',
    async ({ page }) => {
      desktopOnly();
      await openWire(page);
      const pt = await cablePoint(page, 0);
      expect(pt).not.toBeNull();
      await page.mouse.move(pt!.x, pt!.y);
      await expect.poll(() => wireHover(page), { timeout: 6000, intervals: [120] })
        .not.toBeNull();
      const h = (await wireHover(page))!;
      expect(h.label).toMatch(/^[A-Za-z0-9_]+\[-?\d+\]\.\S+ ↔ [A-Za-z0-9_]+\[-?\d+\]\.\S+$/);
      const chip = page.getByTestId('wire-chip');
      await expect(chip).toBeVisible();
      expect(await chip.textContent()).toBe(h.label);
      // moving off the cable kills the chip and the highlight
      await page.mouse.move(20, 20);
      await expect.poll(() => wireHover(page), { timeout: 6000, intervals: [120] })
        .toBeNull();
      await expect(chip).toBeHidden();
    });

  test('hovering a cable ROW gold-lights that cable in 3D', async ({ page }) => {
    desktopOnly();
    await openWire(page);
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

  test('disconnect → the cable is gone everywhere → Ctrl+Z brings it back',
    async ({ page }) => {
      desktopOnly();
      await openWire(page);
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

  test('reconnect: cut a cable, re-drop it onto the SAME two ports manually',
    async ({ page }) => {
      desktopOnly();
      await openWire(page);
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
        { hasText: new RegExp(`(^|\\s)${c0.a_port.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`) }).first();
      await expect(portBtn).toBeEnabled();
      await portBtn.click();
      const bType = await page.evaluate((ci) => (window as unknown as {
        __ARCHEAN__?: { engine: { blueprint: { data: { components: { type: string }[] } } } };
      }).__ARCHEAN__!.engine.blueprint.data.components[ci]!.type, c0.b_component);
      await page.getByTestId('wire-target-search').fill(bType);
      const target = page.getByTestId('wire-target-item', { hasText: `[${c0.b_component}]` }).first();
      await target.click();                                 // STEP 1: the part
      const port = page.locator('[data-testid="wire-target-port"]',
        { hasText: new RegExp(`(^|\\s)${c0.b_port.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`) }).first();
      await expect(port, 'the exact freed port is listed (with its logical reason)')
        .toBeVisible();
      await port.click();                                   // STEP 2: the port
      await expect.poll(() => pipes(page), { timeout: 10_000 }).toBe(before + 1);
      await expect(page.getByTestId('wire-cables'), 'the re-dropped cable reads like the original')
        .toContainText(new RegExp(`${c0.a_port.replaceAll('.', '\\.')} ↔`));
    });

  test('auto-wire (logical) answers and is idempotent', async ({ page }) => {
    desktopOnly();
    await openWire(page);
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
