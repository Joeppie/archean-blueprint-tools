// faceorient.spec.ts — THE BUILT-IN FACE READS FROM THE PILOT SIDE
// (v1.15.4, we: "THE 3D SCREEN OF COMPUTER IS MIRRORED. The normal display
// we have is OK but the screen itself is MIRRORED on the component itself!"
// + an in-game screenshot of the readable front). Fixture 9000009020
// (tools/make_face_test.py): ONE Computer whose program paints an 'L' into
// the RIGHT half of its 200x160 built-in panel. THE LAW (FORMAT §Computer):
// the panel UV is v WITH its v-axis, u 1-MINUS — viewed from the pilot/deck
// side (the side the game renders readable) the projected ink sits RIGHT
// (u ≈ 0.66); a mirrored face puts it LEFT (u ≈ 0.34). The law regressed
// twice before (v1.13.8 ruling → v1.13.11 u-revert), so it is pinned in
// pixels. e2e-tier because: the law is real face pixels through the real
// scene camera (probeRect), not data.
import { expect, test } from '@playwright/test';

const FIX = '9000009020';

test.describe('built-in Computer face orientation @ui', () => {
  test('the 3-D panel reads from the deck side — u 1-minus @slow', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto(`/?craft=${FIX}&dash=main%230`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 120_000 });
    await page.waitForFunction(
      () => (window as any).__ARCHEAN__?.engine?.screenFeedQuads?.().length > 0,
      null, { timeout: 60_000 });
    await page.waitForFunction(
      () => ((window as any).__XENON__?.() ?? { cycles: 0 }).cycles > 150,
      null, { timeout: 90_000 });
    // exit the zoom overlay, close the dock (modebox-shield law)
    await page.getByTestId('screens-cell-main#0-fullexit').click().catch(() => {});
    await page.getByTestId('screens-close').click().catch(() => {});
    // aim from the PILOT side: the lid's winding normal points at the plain
    // BACK panel (measured: the arcade's back panel sits on the normal side
    // and hides the quad); the DISPLAY faces the DECK = the OPPOSITE side —
    // that is the side the in-game screenshots read from
    await page.evaluate(() => {
      const eng = (window as any).__ARCHEAN__.engine;
      const q = eng.screenFeedQuads()[0];
      const n = q.normal, c = q.center;
      eng.auditLookAt([c[0] - n[0] * 1.5, c[1] - n[1] * 1.5 + 0.1, c[2] - n[2] * 1.5], c);
    });
    await page.waitForTimeout(800);
    const face = await page.evaluate(() => {
      const eng = (window as any).__ARCHEAN__.engine;
      const q = eng.screenFeedQuads()[0];
      const f = q.corners.map((c: number[]) => eng.projectCanvas(c[0], c[1], c[2]));
      const us = f.map((p: { u: number }) => p.u), vs = f.map((p: { v: number }) => p.v);
      const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
      const r = eng.probeRect(u0, v0, u1 - u0, v1 - v0);
      let sum = 0, n = 0;
      for (let py = 0; py < r.h; py++)
        for (let px = 0; px < r.w; px++) {
          const i = (((r.h - 1 - py) * r.w) + px) * 4;   // GL: row 0 = bottom
          // YELLOW ink only (the fixture paints a yellow 'L'): the panel
          // bezel and sky are gray/blue and would drag the centroid to 1/2
          if (r.rgba[i] > 180 && r.rgba[i + 1] > 130 && r.rgba[i + 2] < 120) { sum += px; n++; }
        }
      return { key: q.key, u: n > 30 ? sum / n / r.w : null, n };
    });
    expect(face.key, 'the Computer built-in face quad is fed').toMatch(/face#0$/);
    expect(face.u, 'face ink found (the program painted the panel)').not.toBeNull();
    // readable from the pilot side: the 'L' painted at x=120/200 lands on
    // the RIGHT of the projected face; a mirror lands it on the LEFT
    expect(face.u!).toBeGreaterThan(0.55);
    expect(face.u!).toBeLessThan(0.9);
  });
});
