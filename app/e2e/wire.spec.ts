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

  // v1.11 TODO pins (B + C, we: "X-ray precision: engine.wireXrayActive()
  // probe exists — no spec asserts cuts>0 after a 2 s hover on a blocked
  // truck cable, cuts==0 for an exposed one, and full restore on un-hover"
  // + "no spec asserts surges().surges ≥ 2 at the X-ray transition").
  // The truck (3481322297, 375 cables routed THROUGH cab/deck/box) is the
  // BLOCKED fixture (measured census: every truck cable has occluders in
  // front). The EXPOSED half of this trio moved to the node tier in
  // v1.12.1 — xray.test.ts (see the retirement note at the file bottom).
  const TRUCK = '3481322297';

  /** engine-side probe of the X-ray law over the first `cap` cables: the
   *  DRY occlusion plan (engine.xrayCutsFor) — counts, never applies (the
   *  full-episode census was a test-load bomb, v1.11.7). Deterministic
   *  fixture selection so the UI hover pins below aim at KNOWN cables. */
  const xrayCensus = (page: Page, cap = 48) => page.evaluate((CAP) => {
    const e = (window as unknown as {
      __ARCHEAN__?: { engine: { blueprint: { data: { pipes?: unknown[] } };
        pipeNet: { piOf: number[]; polys: { length: number }[] };
        xrayCutsFor: (pi: number) => number } };
    }).__ARCHEAN__!.engine;
    const n = Math.min(e.blueprint.data.pipes?.length ?? 0, CAP);
    const out: { cuts: number; len: number }[] = [];
    for (let pi = 0; pi < n; pi++) {
      // v1.11.7 TEST-LOAD STRATIFICATION: the DRY occlusion probe — the
      // census used to run beginWireXray per pipe (full episode: geometry
      // mutation + pulses), ~300 ms-5 s per cable under parallel load, and
      // the 120-pipe default ate whole test timeouts. The probe plans,
      // never applies.
      const cuts = e.xrayCutsFor(pi);
      // the cable's drawn polyline length: the cursor-surge fires ≥2 only
      // when the hover anchor is STRICTLY INSIDE the run (a 2-point run
      // splits into one ≥2 path + one 1-point path = a single pulse)
      const net = e.pipeNet.piOf.indexOf(pi);
      const poly = net >= 0 ? e.pipeNet.polys[net] : null;
      out.push({ cuts, len: poly?.length ?? 0 });
    }
    return out;
  }, cap);

  const xray = (page: Page) => page.evaluate(() =>
    (window as unknown as {
      __ARCHEAN__?: { engine: { wireXrayActive: () => { on: boolean; cuts: number;
        overlays: number; bubbles: number; dir: string; kind: string; phase: number } } };
    }).__ARCHEAN__!.engine.wireXrayActive());

  /** ONE evaluate: the episode's state AND the live surge count — read in
   *  the same tick, so the ≤1.6 s pulse of the transition can't expire
   *  between two round-trips (the race the first cut of this pin hit). */
  const xrayAndSurges = (page: Page) => page.evaluate(() => {
    const w = window as unknown as {
      __ARCHEAN__?: { engine: { wireXrayActive: () => { on: boolean; cuts: number; overlays: number } };
        surges: () => { surges: unknown[] } };
    };
    const x = w.__ARCHEAN__!.engine.wireXrayActive();
    return { ...x, surges: w.__ARCHEAN__!.surges().surges.length };
  });

  /** A cable whose OWN mid-point pixel hovers back to it (dense crafts
   *  cross: cablePoint(pi) projects pi's mid, but a CLOSER cable can own
   *  that pixel's ray — the hover winner then X-rays and pulses with ITS
   *  geometry). Returns the first candidate that answers the hover and
   *  occludes, so the dwell pins aim at a KNOWN cable with an INTERIOR
   *  anchor (the mid-point hover anchors the pulse strictly inside the
   *  run = the game's both-ways pair). */
  async function pickHoverable(page: Page, census: { cuts: number; len: number }[]) {
    const cand = census
      .map((c, pi) => ({ ...c, pi }))
      .filter(c => c.cuts > 0 && c.len >= 4)
      .slice(0, 14);
    for (const c of cand) {
      const pt = await cablePoint(page, c.pi);
      if (!pt) continue;
      await page.mouse.move(pt.x, pt.y);
      await page.waitForTimeout(90);
      const h = await wireHover(page);
      if (h && h.pi === c.pi) return { pi: c.pi, cuts: c.cuts, pt };
    }
    return null;
  }

  test('a BLOCKED truck cable: 2 s dwell opens the X-ray (cuts>0) firing ≥2 cursor-surges; un-hover fully restores (TODO B+C) @slow', async ({ page }) => {
    desktopOnly();
    // v1.11.8 @slow (AGENTS § Test-size rule): this law is being MIGRATED to
    // the x-ray fixture 9000007001 (one wall, four cables — boot 0.6 s vs
    // 15 s, census milliseconds vs minutes; see REWRITE.md §P7.3 for the
    // exact pin list + the probe that validated the fixture). The truck
    // census (292 runs of occlusion raycasts) + dock layout on the shared
    // iGPU eats multi-minute budgets: @slow lanes only until the fixture
    // spec lands and RETIRES this one.
    test.setTimeout(240_000);
    await openWire(page, TRUCK);
    // The pulses live only 550–1600 ms — a page-side sampler counts the
    // peak through the SAME engine seam the hook exposes (surgeState),
    // ticked every animation frame; the poll round-trips alone (≈150 ms
    // each) can miss the transition window.
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
    const census = await xrayCensus(page);
    const pick = await pickHoverable(page, census);
    expect(pick, 'the truck has an occluded cable that owns its mid-point hover').not.toBeNull();
    // v1.11.7 RE-ANCHOR: the truck's 750-row cable dock finishes its layout
    // LATE (the canvas rect shifts a few px while the dock builds — under
    // parallel-worker CPU load this runs past the census + pick phase), so
    // the mid-point pixel computed moments ago can land between bundled
    // harnesses. Re-project (fresh cablePoint) until the engine's own pick
    // at the pixel answers with OUR cable (engine.pipePickAt = the hover
    // pick law, same ray, same tolerance).
    let pt = pick!.pt;
    for (let k = 0; k < 5; k++) {
      await page.mouse.move(pt.x, pt.y);                   // (re-)arm the dwell
      const hit = await page.evaluate((q) => {
        const e = (window as unknown as {
          __ARCHEAN__?: { engine: { pipePickAt: (x: number, y: number) => number } } }
        ).__ARCHEAN__?.engine;
        return e ? e.pipePickAt(q.x, q.y) : -1;
      }, pt);
      if (hit === pick!.pi) break;
      const fresh = await cablePoint(page, pick!.pi);
      if (fresh) pt = fresh;
      // v1.11.8: under parallel load the Viewport can be mid-RE-MOUNT
      // (scene key change) — the hook is briefly absent; wait and re-jiggle
      // rather than projecting against a canvas that is being rebuilt.
      await page.waitForTimeout(300);
    }
    // v1.11.8 (wire:279 trace forensics): the parallel e2e lane reclaims
    // WebGL contexts (SwiftShader + iGPU pressure) — three fires Context
    // Lost, the app rebuilds, and mid-rebuild the hook is briefly ABSENT.
    // An expect.poll over a frozen pixel then loses a 4 s race against a
    // scene reload. The highlight law (first pointermove hit arms the
    // hover, no dwell on the gold) is asserted against the LIVE projection
    // each round: re-project the mid-point (cablePoint — the engine's own
    // seam, so a rebuilt camera re-anchors the pixel), jiggle, read
    // null-safe; a dead-engine round is a retry, not a throw.
    let hoverOn = false;
    let lastSt: unknown = null;
    let aliveNulls = 0;                       // live engine, hover absent
    for (let k = 0; k < 12 && !hoverOn && aliveNulls < 4; k++) {
      const fresh = await cablePoint(page, pick!.pi);
      if (fresh) pt = fresh;
      await page.mouse.move(pt.x, pt.y + 1);
      await page.mouse.move(pt.x, pt.y);
      await page.waitForTimeout(120);
      const st = await page.evaluate((q) => {
        const e = (window as unknown as { __ARCHEAN__?: { engine: {
          pipeHoverState: () => unknown; opts?: { pipes?: boolean };
          pipePickAt: (x: number, y: number) => number } } }).__ARCHEAN__?.engine;
        if (!e) return { s: null, dead: true };
        return { s: e.pipeHoverState(), pipes: e.opts?.pipes,
          pick: e.pipePickAt(q.x, q.y), dead: false };
      }, pt);
      lastSt = st;
      hoverOn = st.s !== null;
      // a LIVE engine answering null while its own pick law confirms the
      // cable at this pixel = the real violation — fail fast, keep budget
      if (!hoverOn && !st.dead && st.pick === pick!.pi) aliveNulls++;
    }
    expect(hoverOn, `immediate-highlight: hover stayed null — last state ` +
      JSON.stringify(lastSt)).toBe(true);
    // 2 s dwell → beginWireXray: geometry in FRONT of the cable's parts is
    // cut away AND the transition fires the cursor-surge (cablePulse: one
    // travelling pulse EACH way from the interior anchor = ≥ 2).
    await page.waitForTimeout(2_600);
    const at = await xrayAndSurges(page);
    expect(at.on && at.cuts, `cable ${pick!.pi} opened the episode (census ${pick!.cuts})`)
      .toBeTruthy();
    expect(at.cuts, `cable ${pick!.pi} is blocked (census ${pick!.cuts})`)
      .toBeGreaterThan(0);
    const peak = await page.evaluate(() => (window as unknown as { __maxSurges?: number }).__maxSurges ?? 0);
    expect(peak, 'the X-ray transition fired the cursor-surge both ways')
      .toBeGreaterThanOrEqual(2);
    // v1.11.7 (we: "Once the see-through happens, the power-bubbles
    // pulsing back and forth should continue doing so"): canonical icon
    // bubbles run for the WHOLE episode — ≥2 sprites, phase advancing.
    const b1 = await xray(page);
    expect(b1.bubbles, 'the episode carries flowing bubbles').toBeGreaterThanOrEqual(2);
    expect(['ab', 'ba', 'both']).toContain(b1.dir);
    expect(b1.kind, 'the bubbles wear the run\'s canonical kind').toBeTruthy();
    await page.waitForTimeout(700);
    const b2 = await xray(page);
    expect(b2.on, 'the episode is still open (a still mouse keeps the hover)')
      .toBeTruthy();
    expect(Math.abs(b2.phase - b1.phase), 'the bubbles keep travelling')
      .toBeGreaterThan(0.02);
    // un-hover: EVERY cut mesh gets its geometry back, overlays gone
    await page.mouse.move(20, 20);
    await expect.poll(() => xray(page), { timeout: 6_000, intervals: [120] })
      .toMatchObject({ on: false, cuts: 0, overlays: 0 });
  });

  test('v1.11.7 a cable into a ONE-WAY input pulses ONE WAY (no bouncing off the junction) @slow',
    async ({ page }) => {
      // we: "If the input is towards a one-way (e.g. bridge/LV junction)
      // the flow shouldn't bounce between, but one way from in->out"
      // v1.11.8 @slow: migrating to x-ray fixture 9000007001 (pipe 1 is the
      // battery→lowvoltage-INPUT positive, pipes 2/3 the directed/undirected
      // negatives — flowDirs verified ['both','ab','ab','both']; REWRITE §P7.3).
      desktopOnly();
      test.setTimeout(240_000);
      await openWire(page, TRUCK);
      const cands = await page.evaluate(() => {
        const e = (window as unknown as { __ARCHEAN__: { engine: {
          pipeInfo: () => { pipes: number };
          pipeFlowDir: (pi: number) => 'ab' | 'ba' | 'both';
          pipeScreenPoint: (pi: number) => { x: number; y: number } | null;
        } } }).__ARCHEAN__.engine;
        const out: { pi: number; dir: string; pt: { x: number; y: number } }[] = [];
        for (let pi = 0; pi < e.pipeInfo().pipes && out.length < 20; pi++) {
          const dir = e.pipeFlowDir(pi);
          if (dir === 'both') continue;
          const pt = e.pipeScreenPoint(pi);
          if (pt) out.push({ pi, dir, pt });
        }
        return out;
      });
      expect(cands.length, 'the truck wires junction INPUTS (one-way runs exist)')
        .toBeGreaterThan(0);
      // the truck's harnesses bundle pixels: hover the point and VERIFY the
      // engine resolved THAT cable (the pick is the nearest run)
      let pick: { pi: number; dir: string } | null = null;
      for (const c of cands) {
        await page.mouse.move(c.pt.x, c.pt.y);
        await page.waitForTimeout(120);
        const h = await page.evaluate(() => (window as unknown as {
          __ARCHEAN__: { engine: { pipeHoverState: () => { pi: number } | null } } }
        ).__ARCHEAN__.engine.pipeHoverState());
        if (h?.pi === c.pi) { pick = c; break; }
      }
      expect(pick, 'a one-way cable owns its hover point').not.toBeNull();
      await page.waitForTimeout(2_600);
      const st = await xray(page);
      expect(st.on, 'the episode opened').toBeTruthy();
      const dir = await page.evaluate((pi) => (window as unknown as {
        __ARCHEAN__: { engine: { pipeFlowDir: (pi: number) => string } } }
      ).__ARCHEAN__.engine.pipeFlowDir(pi), pick!.pi);
      expect(dir).not.toBe('both');
      expect(st.dir, 'a one-way run pulses a→b or b→a — the bubbles never '
        + 'bounce off the junction IN port').toBe(dir);
      expect(st.bubbles, 'bubbles flow on the one-way run too').toBeGreaterThanOrEqual(2);
      await page.mouse.move(20, 20);
      await expect.poll(() => xray(page), { timeout: 6_000, intervals: [120] })
        .toMatchObject({ on: false, cuts: 0, overlays: 0, bubbles: 0 });
    });

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
