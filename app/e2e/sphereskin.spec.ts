// sphereskin.spec.ts — the TOOLS ▸ GENERATE BALLOON placement tool (the
// renamed Sphere skin, v1.9; the TAIL batch tests live at the file's end).
// The user's
// order after three reverted block-Spheroid attempts ("All spheres have
// indents … Find algo online! … Triangles instead of blocks"): the dialog
// interface approach + the movable-ghost plumbing are PORTED from the
// archived branch unchanged; the VERTICES are the fresh lattice convex-hull
// shrinkwrap (engine/latsphere.ts) — a convex polyhedron cannot indent.
//  • the dialog previews triangle count + THE DEVIATION LINE (dev −sag/+out m)
//    and the size sliders retune the plan — the planning runs DEBOUNCED in a
//    WORKER (2026-10-22: "shouldn't block slider if resizing it"), so the
//    suite READS THE PREVIEW BY POLLING, never as a single shot;
//  • OK ▸ Confirm CLOSES the dialog and opens a MOVABLE ghost skin on the
//    widget with the ✕ Cancel / ✔ Build label (a skin never collides);
//  • ✔ Build writes every triangle into bp AND the doc (loads strictly
//    increase — the AGENTS repaint rule; Ctrl+Z reverts the whole skin as
//    ONE step; '+ new palette slot' resolves the paint at Build);
//  • the built skin feeds the builder's Lift & altitude widget (vacuum /
//    helium / hydrogen envelope readout, engine/atmo.ts);
//  • flat is the shipped shading default (the game's authored convention,
//    v1.5.12) — smooth:1 is the opt-in; ✕ Cancel and Esc leave the file
//    byte-untouched.
import { expect, test, type Page } from '@playwright/test';

type Ghost = {
  blocks: number; tris: number; offset: [number, number, number]; valid: boolean; shown: boolean;
  turns: number; bb: [[number, number, number], [number, number, number]] | null;
} | null;

const bpData = (page: Page) => page.evaluate(() =>
  (window as unknown as { __ARCHEAN__: { engine: { blueprint: { data: {
    blocks: unknown[]; triangles?: Record<string, unknown>[]; colors?: (unknown | null)[] } } } } })
    .__ARCHEAN__.engine.blueprint.data);

const loads = (page: Page) => page.evaluate(() =>
  (window as unknown as { __ARCHEAN__: { stats: () => { loads: number } } }).__ARCHEAN__.stats().loads);

const ghost = (page: Page) => page.evaluate(() =>
  (window as unknown as { __ARCHEAN__: { placeGhost: () => Ghost } }).__ARCHEAN__.placeGhost());

const shift = (page: Page, s: [number, number, number]) => page.evaluate((st) =>
  (window as unknown as { __ARCHEAN__: { placeShift: (s: [number, number, number]) => boolean } })
    .__ARCHEAN__.placeShift(st), s);

/** bbox span per axis (max − min) of the ghost, in lattice cells */
async function spans(page: Page): Promise<number[]> {
  const g = await ghost(page);
  if (!g?.bb) return [];
  return [0, 1, 2].map(i => g.bb![1][i] - g.bb![0][i]);
}

async function openNew(page: Page) {
  await page.goto('/');
  await page.getByTestId('gallery-new').click();
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
}

/** drive a definition-generated range slider the way React listens (native
 *  setter + input event — Playwright fill() is not for range inputs) */
async function setRange(page: Page, key: string, v: number) {
  await page.locator(`[data-testid="tool-range-${key}"]`).evaluate((el, val) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(val));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
}

/** type a size into the number box beside the slider (past-slider reach) */
async function setNum(page: Page, key: string, v: number) {
  await page.locator(`[data-testid="tool-num-${key}"]`).fill(String(v));
}

/** open Tools ▸ Generate balloon, OK ▸ Confirm — the dialog closes and the
 *  ghost label appears (the dialog→ghost→label ORDER is the user's spec).
 *  v1.9.0 (urgent-fix §4) the SHIPPED default body is the CYLINDER; this
 *  helper pins the ELLIPSOID lineage the skin/lift/span suite was written
 *  against — it selects the round hull EXPLICITLY (deliberate re-pin, so
 *  the round-era numbers keep meaning what they meant). */
async function stage(page: Page, over: { rx?: number; ry?: number; rz?: number } = {}) {
  await page.getByTestId('tools-menu').click();
  await page.getByTestId('tool-balloon').click();
  await expect(page.getByTestId('tool-dialog-balloon')).toBeVisible();
  await page.getByTestId('tool-opt-profile-round').click();
  for (const [k, v] of Object.entries(over)) await setRange(page, k, v as number);
  await page.getByTestId('tool-ok').click();
  await expect(page.getByTestId('tool-confirm-box')).toBeVisible();
  await page.getByTestId('tool-confirm').click();
  await expect(page.getByTestId('tool-dialog-balloon')).toBeHidden();
  await expect(page.getByTestId('place-label')).toBeVisible({ timeout: 15_000 });
}

const toastText = (page: Page) => page.locator('[data-testid="tool-toast"]').textContent();
const toastCount = async (page: Page) =>
  +(await toastText(page))!.match(/: (\d+) /)![1]!;

test.describe('generate balloon tool: dialog → movable ghost → cancel/build @ui', () => {
  test('the sliders retune the plan (worker) and the preview prints the deviation line', async ({ page }) => {
    await openNew(page);
    await page.getByTestId('tools-menu').click();
    await page.getByTestId('tool-balloon').click();
    // v1.9.0 re-pin (urgent-fix §4): the shipped default is now the CYLINDER
    // whose loft sag is legitimately coarser; THIS suite pins the ELLIPSOID
    // deviation lineage ("the sag stays round at zeppelin size"), so the
    // round hull is selected EXPLICITLY.
    await page.getByTestId('tool-opt-profile-round').click();
    const prev = page.locator('[data-testid="tool-preview"]');
    await expect(prev).toContainText(/triangles/);
    // THE line the Spheroid attempts never had: deviation vs the ideal surface
    await expect(prev).toContainText(/dev −0\.\d\d\/\+0\.\d\d m/);
    // the gas readout (user 2026-10-22): vacuum / helium / hydrogen at SL
    await expect(prev).toContainText(/lift@SL vacuum .* · He .* · H₂ /);
    const small = +(await prev.textContent())!.match(/(\d+) triangles/)![1]!;
    await setRange(page, 'rx', 8);
    await setRange(page, 'ry', 8);
    await setRange(page, 'rz', 8);
    // the planner is ASYNC (worker + debounce): poll the readout, never a
    // single shot — the stale line lags on purpose so the slider keeps sliding
    await expect.poll(async () => {
      const m = ((await prev.textContent()) ?? '').match(/(\d+) triangles/);
      return m ? +m[1]! : 0;
    }, { timeout: 15_000 }).toBeGreaterThan(small * 8);
    // and the sag stays round at zeppelin size (the pin the old suites lacked)
    await expect(prev).toContainText(/dev −0\.0\d\/\+0\.\d\d m/);
    await page.getByTestId('tool-cancel').click();
  });

  test('the number box reaches past the slider, and needles refuse honestly', async ({ page }) => {
    test.setTimeout(120_000);   // a 20 m ellipsoid + a splitFace needle + a repair probe
    await openNew(page);
    await page.getByTestId('tools-menu').click();
    await page.getByTestId('tool-balloon').click();
    // v1.9.0 re-pin (urgent-fix §4): the shipped DEFAULT body is now the
    // cylinder (zeppelin); this suite pins the ELLIPSOID needle/refusal/repair
    // lineage, so the round hull is selected EXPLICITLY.
    await page.getByTestId('tool-opt-profile-round').click();
    const prev = page.locator('[data-testid="tool-preview"]');
    // a 20 m radius is over the slider-free planning range — the box takes it
    await setNum(page, 'rx', 20);
    await setNum(page, 'ry', 20);
    await setNum(page, 'rz', 20);
    await expect.poll(async () => {
      const m = ((await prev.textContent()) ?? '').match(/(\d+) triangles/);
      return m ? +m[1]! : 0;
    }, { timeout: 30_000 }).toBeGreaterThan(5000);              // zeppelin-plus
    await page.getByTestId('tool-cancel').click();
    // v1.9 splitFace (user: "segment whatever is breaking"): an extreme
    // needle whose convex-hull faces blow the 31-cell window no longer
    // REFUSES — the faces subdivide and the spheroid stores smooth
    await page.getByTestId('tools-menu').click();
    await page.getByTestId('tool-balloon').click();
    await setNum(page, 'rx', 0.5);
    await setNum(page, 'ry', 1);
    await setNum(page, 'rz', 12);
    await expect.poll(async () => {
      const t = (await prev.textContent()) ?? '';
      return /\d+ triangles/.test(t) && !/nothing to place/.test(t);
    }, { timeout: 20_000 }).toBe(true);
    // an honest refusal still exists for the genuinely impossible: under a
    // lattice cell there is NO hull to build → refused, OK DISABLED
    await page.getByTestId('tool-cancel').click();
    await page.getByTestId('tools-menu').click();
    await page.getByTestId('tool-balloon').click();
    await setNum(page, 'rx', 0.05);
    await setNum(page, 'ry', 0.05);
    await setNum(page, 'rz', 0.05);
    await expect(prev).toContainText(/nothing to place/, { timeout: 15_000 });
    await expect(page.getByTestId('tool-ok')).toBeDisabled();
    // THE REPAIR (user 2026-10-22: "I also cannot place it, fix the error")
    // still applies: ⚖ Fix probes a nearest placeable shape, OK enables.
    await page.getByTestId('tool-fix').click();
    await expect.poll(async () => {
      const t = (await prev.textContent()) ?? '';
      return /\d+ triangles/.test(t) && !/nothing to place/.test(t);
    }, { timeout: 60_000 }).toBe(true);
    await expect(prev).toContainText(/triangles/, { timeout: 60_000 });
    await expect(page.getByTestId('tool-ok')).toBeEnabled();
    await page.getByTestId('tool-cancel').click();
  });

  /** the engine's LIVE mass report (the StaticInfo card's source) */
  const massReport = (page: Page) => page.evaluate(() =>
    (window as unknown as { __ARCHEAN__: { engine: { massReport: () =>
      { total: number; families: { skin: number } } | null } } })
      .__ARCHEAN__.engine.massReport());

  test('OK ghosts a closed skin; Build writes flat hull triangles + a new slot; undo reverts', async ({ page }) => {
    await openNew(page);
    const trisBefore = ((await bpData(page)).triangles ?? []).length;
    const m0 = await massReport(page);               // skin family empty before
    expect(m0!.families.skin).toBe(0);
    const l0 = await loads(page);
    await stage(page, { rx: 2, ry: 1, rz: 1 });

    const g = await ghost(page);
    expect(g).not.toBeNull();
    expect(g!.tris).toBeGreaterThan(40);                     // a real skin
    expect(g!.blocks).toBe(0);                               // triangles ONLY
    expect(g!.shown).toBe(true);                             // the WIDGET is on it

    // MOVABLE: whole-cell nudge, always valid (skins never collide)
    expect(await shift(page, [3, 0, -2])).toBe(true);
    expect((await ghost(page))!.offset).toEqual([3, 0, -2]);

    await page.getByTestId('place-build').click();
    await expect(page.getByTestId('place-label')).toBeHidden();
    const built = await toastCount(page);
    expect(((await bpData(page)).triangles ?? []).length).toBe(trisBefore + built);
    // flat default (no smooth key — the game's authored convention) + the
    // five paint faces + the move offset actually landed in the lattice
    const rec = await page.evaluate((n) => {
      const ts = (window as unknown as { __ARCHEAN__: { engine: { blueprint: { data: {
        triangles?: Record<string, unknown>[] } } } } }).__ARCHEAN__.engine.blueprint.data.triangles!;
      const t = ts[ts.length - n]!;
      return { smooth: (t as { smooth?: number }).smooth, faces: ((t as { colors?: number[] }).colors ?? []).length,
        frameX: (t as { frame_x?: number }).frame_x, vx: (t as { v0_x?: number }).v0_x };
    }, built);
    expect(rec.smooth).toBeUndefined();
    expect(rec.faces).toBe(5);
    expect(typeof rec.frameX).toBe('number');
    expect(typeof rec.vx).toBe('number');
    // PAINT: '+ new palette slot' wrote the chosen RGB (#c9c9c9 = 201) INTO
    // a NEW slot — v1.7.3: with the picked FINISH (default matte: the game
    // family's roughness 7), the slot read straight off the built triangles
    const colors = (await bpData(page)).colors ?? [];
    const painted = await page.evaluate((n) => {
      const d = (window as unknown as { __ARCHEAN__: { engine: { blueprint: { data: {
        triangles?: Record<string, unknown>[]; colors?: (Record<string, number> | null)[] } } } } })
        .__ARCHEAN__.engine.blueprint.data;
      const t = d.triangles![d.triangles!.length - n]! as { colors?: number[] };
      return (d.colors ?? [])[t.colors![0]!] ?? null;
    }, built);
    expect(painted).toMatchObject({ r: 201, g: 201, b: 201, opacity: 15, roughness: 7, metallic: 0 });
    expect(colors.filter(c => c).length).toBeGreaterThanOrEqual(1);
    // THE BUILDER'S LIFT WIDGET (user 2026-10-22): the built skin IS the
    // envelope — the collapsible row now reads its volume and the vacuum
    // lift at sea level, and the opened body lists all three gases.
    // (On a PHONE the side panel opens collapsed: ‹ tab first.)
    if (await page.getByTestId('lift-widget').count() === 0)
      await page.getByTestId('panel-tab').click();
    await expect(page.getByTestId('lift-widget')).toBeVisible();
    await expect(page.getByTestId('lift-toggle')).toContainText(/vacuum \d+/);
    await page.getByTestId('lift-toggle').click();
    const vol = +((await page.getByTestId('lift-volume').textContent())!.match(/([\d.,]+)/)![1]!
      .replace(/,/g, ''));
    expect(vol).toBeGreaterThan(7);        // the 2×1×1 m ellipsoid ≈ 8.4 m³
    for (const gas of ['vacuum', 'helium', 'hydrogen'])
      await expect(page.getByTestId(`lift-row-${gas}`)).toContainText(/lift|kg|t|—/);
    // vacuum lift ≈ 1.225 kg/m³ · volume (±1 kg of display rounding)
    const vacKg = Math.round(vol * 1.225);
    await expect(page.getByTestId('lift-row-vacuum')).toContainText(
      new RegExp(`${vacKg - 1}|${vacKg}|${vacKg + 1} kg`));
    await page.getByTestId('lift-toggle').click();   // collapse again (persisted)
    // THE WEIGHT MOVES (user 2026-10-22: a big sphere inserted, "the weight
    // did not change"): the game mass model (v1.7.1) charges the committed
    // skin its area·0.05 m × material density — the STATIC INFO card's
    // source reports the skin family now, and the total is strictly higher.
    const m1 = await massReport(page);
    expect(m1!.families.skin).toBeGreaterThan(0);
    expect(m1!.total).toBeGreaterThan(m0!.total);
    // and the StaticInfo card itself prints the skin family (desktop card;
    // the phone card is the compact variant without the family line)
    if (await page.getByTestId('mass-families').count() > 0
        && await page.getByTestId('mass-families').isVisible())
      await expect(page.getByTestId('mass-families')).toContainText(/skin [1-9]/);
    // the repaint pin (AGENTS: data assertions cannot pin a repaint)
    await expect.poll(() => loads(page), { timeout: 10_000 }).toBeGreaterThan(l0);
    // one Undo = the whole skin back (the doc mirrored EVERY insert)
    await page.keyboard.press('Control+z');
    await expect
      .poll(async () => ((await bpData(page)).triangles ?? []).length, { timeout: 10_000 })
      .toBe(trisBefore);
    // the weight drops back with it (the mass report follows the doc live)
    await expect.poll(async () => (await massReport(page))!.families.skin).toBe(0);
  });

  test('shading=smooth writes the game’s smooth:1 on every triangle', async ({ page }) => {
    await openNew(page);
    await page.getByTestId('tools-menu').click();
    await page.getByTestId('tool-balloon').click();
    await page.selectOption('[data-testid="tool-select-shade"]', 'smooth');
    await page.getByTestId('tool-ok').click();
    await expect(page.getByTestId('tool-confirm-box')).toContainText(/smooth:1/);
    await page.getByTestId('tool-confirm').click();
    await expect(page.getByTestId('place-label')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('place-build').click();
    const built = await toastCount(page);
    const allSmooth = await page.evaluate((n) => {
      const ts = (window as unknown as { __ARCHEAN__: { engine: { blueprint: { data: {
        triangles?: { smooth?: number }[] } } } } }).__ARCHEAN__.engine.blueprint.data.triangles!;
      return ts.slice(ts.length - n).every(t => t.smooth === 1);
    }, built);
    expect(allSmooth).toBe(true);
  });

  test('Cancel (click AND Esc) drops the ghost with the file untouched', async ({ page }) => {
    await openNew(page);
    const before = await bpData(page);
    await stage(page);
    expect(await ghost(page)).not.toBeNull();
    await page.getByTestId('place-cancel').click();
    await expect(page.getByTestId('place-label')).toBeHidden();
    expect(await ghost(page)).toBeNull();
    expect((await bpData(page)).blocks).toEqual(before.blocks);
    expect(((await bpData(page)).triangles ?? []).length)
      .toBe((before.triangles ?? []).length);
    // and the label's ✕ twin: Escape
    await stage(page);
    expect(await ghost(page)).not.toBeNull();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('place-label')).toBeHidden();
    expect(await ghost(page)).toBeNull();
  });

  // ------------------------------------------------------------ v1.7.2 ---
  // "Geometry for sphere can be too complex imo … I want it to be simplified,
  // so a cylinder on the sides and slightly pointier nose might be nice. Add
  // options and a rotation option for the ghost preview as well as a back
  // button to go back to tool window where we can change parameters without
  // starting from scratch."

  test('⟲ quarter-turns rotate the ghost (lattice law) and survive Build', async ({ page }) => {
    await openNew(page);
    await stage(page, { rx: 2, ry: 1, rz: 1 });
    const s0 = await spans(page);
    expect(s0[0]).toBeGreaterThan(s0[2]);                 // long along x
    await page.getByTestId('place-rot-y').click();        // world-Y: x ↔ z
    await expect.poll(() => spans(page), { timeout: 5_000 }).toEqual([s0[2], s0[1], s0[0]]);
    expect((await ghost(page))!.turns).toBe(1);
    // Build the ROTATED ghost: the file must carry what was ghosted (the
    // commit writes the live ghost data, not a fresh un-rotated plan)
    await page.getByTestId('place-build').click();
    const built = await page.evaluate(() => {
      const ts = (window as unknown as { __ARCHEAN__: { engine: { blueprint: { data: {
        triangles?: Record<string, number>[] } } } } }).__ARCHEAN__.engine.blueprint.data.triangles!;
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (const t of ts) for (let i = 0; i < 3; i++)
        for (const ax of ['x', 'y', 'z'] as const) {
          const g = (t[`v0_${ax}`.replace('0', String(i))] as number)
            + 12 * ((t[`frame_${ax}`] as number) ?? 0);
          const k = ax === 'x' ? 0 : ax === 'y' ? 1 : 2;
          mn[k] = Math.min(mn[k]!, g); mx[k] = Math.max(mx[k]!, g);
        }
      return [mx[0]! - mn[0]!, mx[1]! - mn[1]!, mx[2]! - mn[2]!];
    });
    expect(built).toEqual([s0[2], s0[1], s0[0]]);
  });

  test('BOTH bodies store the needle — splitFace keeps the spheroid smooth', async ({ page }) => {
    await openNew(page);
    await page.getByTestId('tools-menu').click();
    await page.getByTestId('tool-balloon').click();
    // v1.9.0 re-pin: the shipped default is the cylinder now — this suite's
    // FIRST phase is the ELLIPSOID (the round hull then the cylinder body).
    await page.getByTestId('tool-opt-profile-round').click();
    await setNum(page, 'rx', 0.5);
    await setNum(page, 'ry', 1);
    await setNum(page, 'rz', 12);
    const prev = page.locator('[data-testid="tool-preview"]');
    // v1.9 splitFace: the ellipsoid path stores this blend now (window
    // faces SUBDIVIDE instead of refusing — "a completely smooth spheroid")
    await expect.poll(async () => {
      const t = (await prev.textContent()) ?? '';
      return /\d+ triangles/.test(t) && !/nothing to place/.test(t);
    }, { timeout: 20_000 }).toBe(true);
    // the simple body takes it: flat cylinder flanks + tapered nose/tail
    await page.getByTestId('tool-opt-profile-cylinder').click();
    await expect.poll(async () => {
      const t = (await prev.textContent()) ?? '';
      return /triangles/.test(t) && !/nothing to place/.test(t);
    }, { timeout: 20_000 }).toBe(true);
    // v1.7.3: the two ends print SEPARATELY (nose = −axis, tail = +axis)
    await expect(prev).toContainText(/cylinder \+ \d+% nose \/ \d+% tail/);
    await expect(page.getByTestId('tool-ok')).toBeEnabled();
    await expect(page.getByTestId('tool-field-nose')).toBeVisible();
    await expect(page.getByTestId('tool-field-tail')).toBeVisible();
    await expect(page.getByTestId('tool-field-facets')).toBeVisible();
    // the nose slider reaches PAST the old 70 cap now (user: "pointiness
    // isn't high enough") and the tail retunes INDEPENDENTLY — both still
    // store (poll the async preview line, never a single shot)
    await setRange(page, 'nose', 90);
    await expect.poll(async () => {
      const t = (await prev.textContent()) ?? '';
      return /90% nose/.test(t) && /triangles/.test(t) && !/nothing to place/.test(t);
    }, { timeout: 20_000 }).toBe(true);
    await setRange(page, 'tail', 15);
    await expect.poll(async () => {
      const t = (await prev.textContent()) ?? '';
      return /15% tail/.test(t) && /triangles/.test(t) && !/nothing to place/.test(t);
    }, { timeout: 20_000 }).toBe(true);
    await page.getByTestId('tool-cancel').click();
  });

  // ------------------------------------------------------------ v1.7.3 ---
  // "Let me choose whether the paint is metallic/matte etc. as per the other
  // controls; ensure that is properly integrated into a single control."

  test('paint is ONE control: the finish rides the committed palette slot', async ({ page }) => {
    await openNew(page);
    await page.getByTestId('tools-menu').click();
    await page.getByTestId('tool-balloon').click();
    const prev = page.locator('[data-testid="tool-preview"]');
    // one row carries swatch + hex + FINISH chips + the slot mode (the old
    // separate 'paint slot' select field is gone from the definition)
    await expect(page.getByTestId('tool-field-color')).toBeVisible();
    await expect(page.getByTestId('paint-finish-matte')).toBeVisible();
    await expect(page.getByTestId('paint-finish-metal')).toBeVisible();
    await expect(page.getByTestId('paint-finish-glass')).toBeVisible();
    await expect(page.getByTestId('paint-how-new')).toBeVisible();
    await expect(page.getByTestId('paint-how-nearest')).toBeVisible();
    await expect(page.getByTestId('tool-opt-colorhow-new')).toHaveCount(0);
    // the preview line reports the finish (matte is the default)
    await expect(prev).toContainText(/matte paint/);
    await page.getByTestId('paint-finish-metal').click();
    await expect(prev).toContainText(/metal paint/);
    // Build: the NEW slot must carry the METAL shading spec (metallic 1,
    // roughness 0) together with the picked RGB — the finish is not cosmetic
    await page.getByTestId('tool-ok').click();
    await expect(page.getByTestId('tool-confirm-box')).toBeVisible();
    await page.getByTestId('tool-confirm').click();
    await expect(page.getByTestId('place-label')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('place-build').click();
    await expect(page.getByTestId('place-label')).toBeHidden();
    const painted = await page.evaluate(() => {
      const d = (window as unknown as { __ARCHEAN__: { engine: { blueprint: { data: {
        triangles?: Record<string, unknown>[]; colors?: (Record<string, number> | null)[] } } } } })
        .__ARCHEAN__.engine.blueprint.data;
      const t = d.triangles![d.triangles!.length - 1]! as { colors?: number[] };
      return (d.colors ?? [])[t.colors![0]!] ?? null;
    });
    expect(painted).toMatchObject({ r: 201, g: 201, b: 201, opacity: 15, roughness: 0, metallic: 1 });
    // the toast names the finish too (the result the user gets after Build)
    await expect(page.locator('[data-testid="tool-toast"]')).toContainText(/metal paint/);
  });

  test('the label ↩ reopens the dialog with the parameters AND the dragged spot', async ({ page }) => {
    await openNew(page);
    await stage(page, { rx: 2, ry: 1, rz: 1 });
    expect(await shift(page, [4, 0, 0])).toBe(true);
    const s0 = await spans(page);
    await page.getByTestId('place-back').click();
    await expect(page.getByTestId('tool-dialog-balloon')).toBeVisible();
    await expect(page.getByTestId('tool-num-rx')).toHaveValue('2');
    // retune without starting from scratch: rz grows → the bbox reaches longer
    await setRange(page, 'rz', 3);
    await page.getByTestId('tool-ok').click();
    await expect(page.getByTestId('tool-confirm-box')).toBeVisible();
    await page.getByTestId('tool-confirm').click();
    await expect(page.getByTestId('tool-dialog-balloon')).toBeHidden({ timeout: 15_000 });
    // the ghost label NEVER hid (back only reopened the dialog) — polling
    // is the only honest read while the worker re-stages (AGENTS: poll the
    // async readout, never a single shot)
    await expect.poll(async () => {
      const s = await spans(page);
      return s[2] > s0[2] && s[0] === s0[0];
    }, { timeout: 15_000 }).toBe(true);
    const g = await ghost(page);
    expect(g!.offset).toEqual([4, 0, 0]);          // the dragged spot survived
    await page.getByTestId('place-build').click();
    await expect(page.getByTestId('tool-toast')).toContainText('2×1×3 m balloon SKIN');
    // Esc with the dialog open over a ghost: closes the DIALOG only (the
    // waiting ghost survives — Esc belongs to the topmost window)
    await stage(page);
    await page.getByTestId('place-back').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tool-dialog-balloon')).toBeHidden();
    expect(await ghost(page)).not.toBeNull();
    await page.getByTestId('place-cancel').click();
  });

  // ------------------------------------------------------ v1.9 TAIL batch
  test('the TAIL section: fin fields, ghost, build writes panels + pivots + '
    + 'coupler + hidden LV cables, ONE undo reverts the batch', async ({ page }) => {
    await openNew(page);
    await page.getByTestId('tools-menu').click();
    await page.getByTestId('tool-balloon').click();
    // v1.9.0 (urgent-fix §4): the CYLINDER (zeppelin) is the SHIPPED default
    // body — the TAIL section is visible the moment the dialog opens, and
    // the section stays CYLINDER-ONLY (user: "only applicable to the
    // cylindrical craft").
    const prev = page.locator('[data-testid="tool-preview"]');
    await expect(page.getByTestId('tool-field-fins')).toBeVisible();
    await expect(prev).toContainText(/cylinder \+ \d+% nose \/ \d+% tail/);
    await page.getByTestId('tool-opt-profile-round').click();
    await expect(page.getByTestId('tool-field-fins')).toBeHidden();
    await page.getByTestId('tool-opt-profile-cylinder').click();
    await expect(page.getByTestId('tool-field-fins')).toBeVisible();
    await page.getByTestId('tool-opt-fins-on').click();
    // v1.9.0 (we: "remove the option for a 360 rotation for the rudder/tail,
    // that doesn't make sense"): the ±360° SmallPivot field is GONE — the
    // panels ride SmallHinges (±90°), and the volume is a yes/no TOGGLE.
    await expect(page.getByTestId('tool-field-pivot')).toHaveCount(0);
    await expect(page.getByTestId('tool-opt-volumes-on')).toBeVisible();
    await expect(page.getByTestId('tool-field-oversize')).toBeVisible();
    // a stubby tail refuses honestly (tail zone ≥ 3 m)
    await setRange(page, 'rx', 3);
    await setRange(page, 'ry', 3);
    await setRange(page, 'rz', 4);
    await expect.poll(async () => ((await prev.textContent()) ?? ''),
      { timeout: 15_000 }).toMatch(/nothing to place/);
    await expect(page.getByTestId('tool-ok')).toBeDisabled();
    // the preview line is CHOICE-SPECIFIC (urgent-fix §3): OFF reads 'volume
    // off', ON reads 'volume 1 enclosed' — poll the async readout.
    await setRange(page, 'rx', 2);
    await setRange(page, 'ry', 2);
    await setRange(page, 'rz', 8);
    await expect.poll(async () => ((await prev.textContent()) ?? '').includes('rudder'),
      { timeout: 30_000 }).toBe(true);
    await expect(prev).toContainText('volume 1 enclosed');
    await page.getByTestId('tool-opt-volumes-off').click();
    await expect.poll(async () => ((await prev.textContent()) ?? '').includes('volume off'),
      { timeout: 15_000 }).toBe(true);
    await page.getByTestId('tool-opt-volumes-on').click();
    await expect.poll(async () => ((await prev.textContent()) ?? '').includes('volume 1 enclosed'),
      { timeout: 15_000 }).toBe(true);
    await page.getByTestId('tool-ok').click();
    await expect(page.getByTestId('tool-confirm-box')).toBeVisible();
    await page.getByTestId('tool-confirm').click();
    await expect(page.getByTestId('place-label')).toBeVisible({ timeout: 30_000 });
    // the ghost carries skin + sleeve/cap + fin panels as ONE shape
    const g = await ghost(page);
    expect(g!.tris).toBeGreaterThan(150);
    // turn the ghost: the commit maps every tail record with it (verified
    // headless in tooldoc — here just that the ghost itself turns)
    await page.getByTestId('place-rot-y').click();
    expect((await ghost(page))!.turns).toBe(1);
    const s0 = await loads(page);
    await page.getByTestId('place-build').click();
    await expect(page.getByTestId('tool-toast')).toContainText('BALLOON');
    const craft = await page.evaluate(() => {
      const d = (window as unknown as { __ARCHEAN__: { engine: {
        blueprint: { data: Record<string, unknown> } } } }).__ARCHEAN__.engine.blueprint.data;
      const comps = (d.components ?? []) as { type: string; data?: Record<string, unknown> }[];
      const kinds = comps.map(c => c.type);
      const pipes = (d.pipes ?? []) as { type?: string; segments: unknown[] }[];
      return {
        junction: kinds.filter(t => t === 'LowVoltageJunction').length,
        hinges: kinds.filter(t => t === 'SmallHinge').length,
        builds: kinds.filter(t => t === 'Build').length,
        volumes: kinds.filter(t => t === 'Volume').length,
        joins: ((d.composite_builds ?? []) as unknown[]).length,
        pipes: pipes.length,
        lv: pipes.filter(p => p.type === 'lowvoltage').length,
        segsMin: Math.min(...pipes.map(p => p.segments.length)),
        nested: comps.filter(c => c.type === 'Build')
          .map(c => ((c.data?.['triangles'] as unknown[] | undefined) ?? []).length),
      };
    });
    expect(craft).toMatchObject({ junction: 1, hinges: 3, builds: 3, volumes: 1,
      joins: 3, pipes: 3, lv: 3 });
    expect(craft.segsMin).toBeGreaterThanOrEqual(2);   // the game writer's rule
    expect(Math.min(...craft.nested)).toBeGreaterThan(0);
    // the three TRIANGLE PANELS render as subgrid groups (scene nested-skin
    // pass) and the batch REPAINTS: loads strictly increase (AGENTS rule)
    await expect.poll(async () => (await page.evaluate(() =>
      (window as unknown as { __ARCHEAN__: { stats: () => { subs: number } } })
        .__ARCHEAN__.stats())).subs, { timeout: 20_000 }).toBe(3);
    expect(await loads(page)).toBeGreaterThan(s0);
    // the v1.8.2 DIRECTION RULE holds on the cables this tool WRITES: every
    // bar touching a connector leaves along its stub axis (checkLeads audit)
    const leads = await page.evaluate(() => (window as unknown as {
      __ARCHEAN__: { engine: { pipeInfo: () => { leads: { checked: number; bad: number } } } }
    }).__ARCHEAN__.engine.pipeInfo().leads);
    expect(leads.checked).toBeGreaterThanOrEqual(6);   // 3 cables × 2 ends
    expect(leads.bad, 'no wire leaves its plug sideways').toBe(0);
    // ---------------------------------------------------------------
    // v1.9.3 THE RUDDER HINGE LIES DOWN (we: "points upward … It should
    // be in a lying position, like the two other generated hinges;
    // connectors same side (near the fuselage) … rotated 90° while still
    // laying down"). The mount is now the aileron mount rolled +90° about
    // the ship axis, so the SWEEP DIRECTION re-pins (world coordinates —
    // the standing lesson: data-only assertions cannot pin a rotation):
    //  • rudder joint line LYING (horizontal) — the v1.9.0/9.1 up-line
    //    pin is RETIRED; the group quaternion turns ON that line;
    //  • the vane's TOP and BOTTOM halves SCISSOR SIDEWAYS along
    //    axis×UP — the tall top swings to one side, the keel strip to
    //    the other (a yaw about UP would move them the SAME way);
    //  • rudder PART PLATE spins about its OWN long (lying) axis: its
    //    world centroid never shifts;
    //  • ailerons: keep ROLLING about the horizontal joint line — both
    //    twins on the SAME line.
    const swing = await page.evaluate(async () => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const e = (window as any).__ARCHEAN__.engine;
      const d = e.blueprint.data;
      const frames = () => new Promise<void>(r =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const worldBox = (obj: any) => {
        e.scene.updateMatrixWorld(true);
        const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
        obj.traverse((o: any) => {
          if (!o.isMesh || !o.visible) return;
          const pos = o.geometry?.attributes?.position;
          if (!pos) return;
          const m = o.matrixWorld.elements;
          for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
            const q = [m[0] * x + m[4] * y + m[8] * z + m[12],
              m[1] * x + m[5] * y + m[9] * z + m[13],
              m[2] * x + m[6] * y + m[10] * z + m[14]];
            for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], q[k]); mx[k] = Math.max(mx[k], q[k]); }
          }
        });
        return { span: mn.map((v: number, i: number) => mx[i] - v), c: mn.map((v: number, i: number) => (v + mx[i]) / 2), mn, mx };
      };
      const out: any[] = [];
      // THE JOIN ORDER IS THE COMMIT'S CONTRACT (commitBalloon appends in
      // the fixed order rudder, aileronL, aileronR) — the ⟲Y this test put
      // on the ghost moved the rudder off x = 0, so geometry can NOT name
      // the role here; the order can.
      let joinIx = 0;
      for (const j of (d.composite_builds ?? [])) {
        const role = joinIx++ === 0 ? 'rudder' : 'aileron';
        const master = d.components[j.component];
        if (!master || master.type !== 'SmallHinge') continue;
        const grp = e.subGroups.get(j.slaveBuildId);
        if (!grp) continue;
        // the CAPTURED joint line (the law that drives the panel) — the
        // ⟲Y on the ghost keeps world UP but carries the aileron roll line
        // ẑ → x̂, so the assertions below go against THIS, not constants
        const jr = (e.subJrefs.get(j.slaveBuildId) ?? [])[0];
        // liveDataEdit REBUILDS the real root in place — re-resolve it on
        // every read (a stale handle would measure a disposed tree)
        const plateBox = () => {
          const real = (e.compRoots.get(j.component) ?? []).find((o: any) => o.userData?.real);
          return real ? worldBox(real) : null;
        };
        const set = (a: number) => {
          master.data = { ...(master.data ?? {}), angle: a };
          e.dataEdited();
          if (plateBox() !== null) e.liveDataEdit(j.component);   // the part model re-poses
        };
        // half-body CENTROIDS split by the joint line's height (pivot0 +
        // moff): the vane's top and keel halves, for the SCISSOR test
        const mo = [e.moffView.x, e.moffView.y, e.moffView.z];
        const halves = (obj: any, midY: number) => {
          e.scene.updateMatrixWorld(true);
          const acc = { t: [0, 0, 0, 0], b: [0, 0, 0, 0] };
          obj.traverse((o: any) => {
            if (!o.isMesh || !o.visible) return;
            const pos = o.geometry?.attributes?.position;
            if (!pos) return;
            const m2 = o.matrixWorld.elements;
            for (let i = 0; i < pos.count; i++) {
              const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
              const q = [m2[0] * x + m2[4] * y + m2[8] * z + m2[12],
                m2[1] * x + m2[5] * y + m2[9] * z + m2[13],
                m2[2] * x + m2[6] * y + m2[10] * z + m2[14]];
              const s = q[1]! > midY + 0.05 ? acc.t : q[1]! < midY - 0.05 ? acc.b : null;
              if (s) { s[0] += q[0]; s[1] += q[1]; s[2] += q[2]; s[3]++; }
            }
          });
          const c = (s: number[]) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : null);
          return { top: c(acc.t), bot: c(acc.b) };
        };
        set(0); await frames();
        const p0 = worldBox(grp), t0 = plateBox();
        const midY = jr ? jr.pivot0[1] + mo[1] : p0.c[1];
        const h0 = halves(grp, midY);
        // the plate's extent ALONG its own joint axis: a spin on that axis
        // leaves it EXACT; a prop-style roll shears it
        const along = (t: ReturnType<typeof worldBox> | null) => {
          if (!t || !jr) return null;
          let lo = Infinity, hi = -Infinity;
          for (let i = 0; i < 8; i++) {
            const v = [(i & 1 ? t.mx[0] : t.mn[0]), (i & 2 ? t.mx[1] : t.mn[1]), (i & 4 ? t.mx[2] : t.mn[2])];
            const d = jr.axis0[0] * v[0] + jr.axis0[1] * v[1] + jr.axis0[2] * v[2];
            lo = Math.min(lo, d); hi = Math.max(hi, d);
          }
          return hi - lo;
        };
        set(30); await frames();
        const q = grp.quaternion, n = Math.hypot(q.x, q.y, q.z) || 1;
        const axis = [q.x / n, q.y / n, q.z / n];
        const t1 = plateBox();
        const h1 = halves(grp, midY);
        set(0); await frames();
        out.push({
          role,
          axis,
          jrefAxis: jr ? [jr.axis0[0], jr.axis0[1], jr.axis0[2]] : null,
          topC0: h0.top, topC1: h1.top, botC0: h0.bot, botC1: h1.bot,
          plateC0: t0 ? t0.c : null, plateC1: t1 ? t1.c : null,
          plateAx0: along(t0), plateAx1: along(t1),
        });
      }
      return out;
    });
    expect(swing).toHaveLength(3);
    const rud = swing.filter(s => s.role === 'rudder');
    const ail = swing.filter(s => s.role === 'aileron');
    expect(rud).toHaveLength(1);
    expect(ail).toHaveLength(2);
    const dot3 = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    const UP = [0, 1, 0];
    // the rudder: a LYING joint line — horizontal (the ⟲Y on the ghost
    // keeps horizontal lines horizontal); the v1.9.0/9.1 UP-line pin is
    // RETIRED, and the sky-pointing mount fails THIS assertion. The
    // group turns exactly ON that line.
    const r = rud[0]!;
    expect(Math.abs(dot3(r.jrefAxis!, UP)), `rudder joint line ${JSON.stringify(r.jrefAxis)} must LIE DOWN`)
      .toBeLessThan(0.05);
    expect(Math.abs(dot3(r.axis, r.jrefAxis!)), 'the panel turns ON its captured line')
      .toBeGreaterThan(0.999);
    // the SIDESWAYS scissor: perpendicular to the lying joint line (the
    // frame-free phrasing — via the axis, not a constant). The vane's top
    // half travels to one side, its keel strip to the OTHER; a yaw about
    // UP would carry both halves the same way (product ≥ 0).
    const nn = Math.hypot(r.jrefAxis![2], r.jrefAxis![0]) || 1;
    const m = [-r.jrefAxis![2]! / nn, 0, r.jrefAxis![0]! / nn];
    const dTop = r.topC1!.map((v: number, i: number) => v - r.topC0![i]!);
    const dBot = r.botC1!.map((v: number, i: number) => v - r.botC0![i]!);
    const sTop = dot3(dTop, m), sBot = dot3(dBot, m);
    expect(Math.abs(sTop), `rudder top sweeps SIDEWAYS (${sTop.toFixed(3)} m)`)
      .toBeGreaterThan(0.05);
    expect(Math.abs(sBot), `the keel strip sweeps too (${sBot.toFixed(3)} m)`)
      .toBeGreaterThan(0.05);
    expect(Math.sign(sTop) * Math.sign(sBot),
      'top and keel SCISSOR opposite (a yaw about UP moves them alike)')
      .toBeLessThan(0);
    // the PART PLATE spins about its OWN lying long axis (its tower IS the
    // joint line): its extent ALONG that line is EXACT (a reintroduced
    // C-basis roll would shear it — the tower would tilt OFF the line).
    // The union-box CENTROID may drift ≤ ~0.011 by design: at rest the
    // static LV plug (0.146 m) owns the silhouette, mid-turn the rotating
    // tower corners (0.234 m) do, which centres the box on the axis.
    expect(r.plateC0, 'plate model loaded').toBeTruthy();
    expect(Math.abs(r.plateAx1! - r.plateAx0!),
      'plate extent along its joint line is EXACT — it spins on its own axis')
      .toBeLessThan(0.005);
    r.plateC1!.forEach((v: number, i: number) =>
      expect(Math.abs(v - r.plateC0![i]!),
        'plate centroid stays on its own axis')
        .toBeLessThan(0.02));
    // the ailerons: ROLL about a HORIZONTAL line (the ⟲Y-carried
    // longitudinal), both twins on the SAME line
    for (const a of ail) {
      expect(Math.abs(dot3(a.jrefAxis!, UP)), `aileron joint line ${JSON.stringify(a.jrefAxis)} must be horizontal`)
        .toBeLessThan(0.05);
      expect(Math.abs(dot3(a.axis, a.jrefAxis!)), 'the aileron panel turns ON its captured line')
        .toBeGreaterThan(0.999);
    }
    expect(dot3(ail[0]!.jrefAxis!, ail[1]!.jrefAxis!)).toBeGreaterThan(0.999);
    // Ctrl+Z = ONE step for the WHOLE batch (skin, tail, parts, joins, cables)
    await page.keyboard.press('Control+z');
    await expect.poll(async () => {
      const c2 = await page.evaluate(() => {
        const d = (window as unknown as { __ARCHEAN__: { engine: {
          blueprint: { data: Record<string, unknown> } } } }).__ARCHEAN__.engine.blueprint.data;
        return [(d.components ?? []) as unknown[], (d.pipes ?? []) as unknown[],
          (d.triangles ?? []) as unknown[], (d.composite_builds ?? []) as unknown[]];
      });
      return c2[0].length === 1 && c2[1].length === 0 && c2[2].length === 0
        && c2[3].length === 0 ? 'clean'
        : `${c2[0].length}/${c2[1].length}/${c2[2].length}/${c2[3].length}`;
    }, { timeout: 20_000 }).toBe('clean');
  });
  // ------------------------------------------------------------- v1.8.6 ---
  // urgent-fix.md: "a valid zeppelin suddenly misses a face after rotations
  // … depending on where it is rotated, possibly moved". The ghost's ⟲ and
  // drag transforms used to DROP every fat face whose image left the frame-
  // aligned window — and the hole was PERSISTED into the built file. The
  // law: split, never drop. This pin ghosts the user's 12×8×12 cyl+nose
  // balloon WITH fins, ⟲Y + a 5-cell drag, ✔ Builds, and asserts the FILE's
  // skin area equals the ghost's (the pre-fix tree lost ~2.5 % of it).
  test('rotate + drag a big balloon: the FILE keeps the ghost’s whole skin @ui', async ({ page }) => {
    test.setTimeout(180_000);      // a 24 m zeppelin's fin batch plans on the worker
    await openNew(page);
    await page.getByTestId('tools-menu').click();
    await page.getByTestId('tool-balloon').click();
    await page.getByTestId('tool-opt-profile-cylinder').click();
    await page.getByTestId('tool-opt-fins-on').click();
    await setRange(page, 'rx', 12);
    await setRange(page, 'ry', 8);
    await setRange(page, 'rz', 12);
    const prev = page.locator('[data-testid="tool-preview"]');
    await expect.poll(async () => ((await prev.textContent()) ?? '').includes('rudder'),
      { timeout: 60_000 }).toBe(true);
    await page.getByTestId('tool-ok').click();
    await expect(page.getByTestId('tool-confirm-box')).toBeVisible();
    await page.getByTestId('tool-confirm').click();
    await expect(page.getByTestId('place-label')).toBeVisible({ timeout: 60_000 });

    // the transforms that used to bite: ONE quarter-turn, ONE whole-cell drag
    // (evaluate-click: on the 412 px viewport the label's turn row overflows
    // the viewport, and a real pointer click waits for visibility forever)
    await page.getByTestId('place-rot-y').evaluate(el => (el as HTMLElement).click());
    expect((await ghost(page))!.turns).toBe(1);
    expect(await shift(page, [0, 0, 5])).toBe(true);

    const ghostArea = await page.evaluate(() => {
      const d = (window as unknown as { __ARCHEAN__: { placeData: () => {
        triangles: Record<string, number>[] } } }).__ARCHEAN__.placeData();
      const g = (t: Record<string, number>, i: number, ax: string) =>
        t[`v${i}_${ax}`]! + 12 * (t[`frame_${ax}`] ?? 0);
      let a = 0;
      for (const t of d.triangles) {
        const u = [0, 1, 2].map(k => g(t, 1, ['x', 'y', 'z'][k]!) - g(t, 0, ['x', 'y', 'z'][k]!));
        const w = [0, 1, 2].map(k => g(t, 2, ['x', 'y', 'z'][k]!) - g(t, 0, ['x', 'y', 'z'][k]!));
        a += Math.hypot(u[1]! * w[2]! - u[2]! * w[1]!,
          u[2]! * w[0]! - u[0]! * w[2]!,
          u[0]! * w[1]! - u[1]! * w[0]!) / 2;
      }
      return a;
    });
    expect(ghostArea).toBeGreaterThan(1000);          // premise: a fat-face skin

    await page.getByTestId('place-build').click();
    await expect(page.getByTestId('tool-toast')).toContainText('BALLOON');
    const built = await page.evaluate(() => {
      const ts0 = ((window as unknown as { __ARCHEAN__: { engine: { blueprint: { data: {
        triangles?: Record<string, number>[] } } } } }).__ARCHEAN__.engine.blueprint.data.triangles) ?? [];
      // the ghost payload is skin + fillets + the three PANELS; the commit
      // nests the panels into their Build subgrids (data.triangles there),
      // so the file-side total = the top skin PLUS every nested list
      const comps = ((window as unknown as { __ARCHEAN__: { engine: { blueprint: { data: {
        components?: { type: string; data?: Record<string, unknown> }[] } } } } })
        .__ARCHEAN__.engine.blueprint.data.components) ?? [];
      const ts = [...ts0];
      for (const c of comps)
        for (const t of ((c.data?.['triangles'] as Record<string, number>[] | undefined) ?? [])) ts.push(t);
      const g = (t: Record<string, number>, i: number, ax: string) =>
        t[`v${i}_${ax}`]! + 12 * (t[`frame_${ax}`] ?? 0);
      let a = 0, bad = 0;
      for (const t of ts) {
        // every stored record must decode inside its own 32-slot window
        for (const ax of ['x', 'y', 'z'])
          for (let i = 0; i < 3; i++) {
            const wv = t[`v${i}_${ax}`]!;
            if (wv < 0 || wv > 31) bad++;
          }
        const u = [0, 1, 2].map(k => g(t, 1, ['x', 'y', 'z'][k]!) - g(t, 0, ['x', 'y', 'z'][k]!));
        const w = [0, 1, 2].map(k => g(t, 2, ['x', 'y', 'z'][k]!) - g(t, 0, ['x', 'y', 'z'][k]!));
        a += Math.hypot(u[1]! * w[2]! - u[2]! * w[1]!,
          u[2]! * w[0]! - u[0]! * w[2]!,
          u[0]! * w[1]! - u[1]! * w[0]!) / 2;
      }
      return { area: a, bad };
    });
    expect(built.bad, 'every stored record is window-legal').toBe(0);
    // the hole was ~2.5 % of the skin — a 1 % band catches it with room
    expect(Math.abs(built.area - ghostArea), 'file area vs ghost area')
      .toBeLessThan(ghostArea * 0.01);
  });
});
