// hinge.spec.ts — the subgrid JOINT UI (todo item 2: "rotation is constrained
// to and ATTACHED to that hinge; a UI at that place"). The dolphin's tail fin
// is one subgrid driven by a SmallHinge pair; selecting the SUBGRID must show
// a constrained handle ON THE JOINT LINE, and a real pointer drag on that
// handle must write the master's data.angle (degrees) with twin unison —
// turning the hinge, never free-floating the panel.
import { expect, test, type Page } from '@playwright/test';

const DOLPHIN = '3417786605';

type HingeInfo = { bi: number; handles: { ci: number; key: string; value: number }[] } | null;

const hinge = (page: Page) =>
  page.evaluate(() => (window as never as {
    __ARCHEAN__: { hinge: () => HingeInfo };
  }).__ARCHEAN__.hinge());
const hingePoint = (page: Page, i: number) =>
  page.evaluate((idx) => (window as never as {
    __ARCHEAN__: { hingePoint: (n: number) => { x: number; y: number } | null };
  }).__ARCHEAN__.hingePoint(idx), i);
const angles = (page: Page) =>
  page.evaluate(() => {
    const e = (window as never as { __ARCHEAN__: { engine: {
      bp: { data: { components: { data?: Record<string, unknown> }[] } };
      subPose: (b: number) => { p: number[]; quat: number[] } | null;
    } } }).__ARCHEAN__.engine;
    const a = (i: number) => (e.bp.data.components[i]?.data?.['angle'] as number) ?? 0;
    return { a29: a(29), a49: a(49), pose: e.subPose(4) };
  });

async function openDolphin(page: Page) {
  await page.goto(`/?craft=${DOLPHIN}`);
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
  await page.getByTestId('mode-edit').click();
}

test.describe('subgrid hinge UI @subgrid @slow', () => {
  test('a selected subgrid gets its hinge ring; a pointer drag turns the hinge', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await openDolphin(page);
    await page.evaluate(() => {
      (window as never as { __ARCHEAN__: { engine: { selectSub: (b: number) => void } } })
        .__ARCHEAN__.engine.selectSub(4);
    });
    const info = await hinge(page);
    expect(info, 'the selected fin subgrid exposes its joint handles').not.toBeNull();
    expect(info!.bi).toBe(4);
    expect(info!.handles, 'the fin rides its SmallHinge master').toEqual([
      { ci: 29, key: 'angle', value: 0 },
    ]);

    const p0 = await hingePoint(page, 0);
    expect(p0, 'the ring carries a screen-space grab point').not.toBeNull();
    const before = await angles(page);
    expect(before.a29).toBe(0);

    // REAL pointer drag on the ring: press, sweep vertically off the hinge, release
    await page.mouse.move(p0!.x, p0!.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(p0!.x + i * 8, p0!.y - i * 9);
    await page.mouse.up();
    const mid = await angles(page);
    expect(Math.abs(mid.a29), 'dragging the ring turns the HINGE (data.angle, degrees)')
      .toBeGreaterThan(3);
    expect(mid.a49, 'the twin hinge moves in UNISON (v0.176 rule)')
      .toBeCloseTo(mid.a29, 6);
    expect(Math.hypot(...mid.pose!.quat) > 0.99, 'the panel rode the joint').toBe(true);

    // multi-grip continuity: a SECOND grab at the same ring point continues
    // the same way (the gesture base rebases on every pointerdown)
    const p1 = await hingePoint(page, 0);
    expect(Math.hypot(p1!.x - p0!.x, p1!.y - p0!.y), 'the ring stays ATTACHED to the joint line').toBeLessThan(2);
    await page.mouse.move(p1!.x, p1!.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(p1!.x + i * 8, p1!.y - i * 9);
    await page.mouse.up();
    const again = await angles(page);
    expect(Math.sign(again.a29 - mid.a29), 'a re-grip CONTINUES turning the same way (no pop-back)')
      .toBe(Math.sign(mid.a29));
    expect(Math.abs(again.a29 - mid.a29), 'the re-grip adds real travel').toBeGreaterThan(3);
    expect(again.a49, 'twin unison holds across grips').toBeCloseTo(again.a29, 6);
    // tidy: restore the file angles through the engine's own data path
    await page.evaluate(() => {
      const e = (window as never as { __ARCHEAN__: { engine: {
        bp: { data: { components: { data?: Record<string, unknown> }[] } };
        dataEdited: () => void;
      } } }).__ARCHEAN__.engine;
      for (const i of [29, 49]) e.bp.data.components[i]!.data = { ...e.bp.data.components[i]!.data, angle: 0 };
      e.dataEdited();
    });
  });

  test('component selection keeps the TGC gizmo; hinge UI is subgrid-only', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await openDolphin(page);
    await page.evaluate(() => {
      const w = window as never as { __ARCHEAN__: { engine: {
        selectSub: (b: number) => void; select: (c: number) => void;
      } } };
      w.__ARCHEAN__.engine.selectSub(4);
    });
    expect((await hinge(page))?.handles.length).toBe(1);
    await page.evaluate(() => {
      (window as never as { __ARCHEAN__: { engine: { select: (c: number) => void } } })
        .__ARCHEAN__.engine.select(29);
    });
    expect(await hinge(page), 'a COMPONENT selection hides the hinge UI').toBeNull();
    const st = await page.evaluate(() => (window as never as {
      __ARCHEAN__: { engine: { gizmoState: () => { mode: string; ci: number } } };
    }).__ARCHEAN__.engine.gizmoState());
    expect(st.ci).toBe(29);
  });
});
