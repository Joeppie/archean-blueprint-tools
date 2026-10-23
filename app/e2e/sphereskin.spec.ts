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

/** open Tools ▸ Sphere skin, OK ▸ Confirm — the dialog closes and the
 *  ghost label appears (the dialog→ghost→label ORDER is the user's spec) */
async function stage(page: Page, over: { rx?: number; ry?: number; rz?: number } = {}) {
  await page.getByTestId('tools-menu').click();
  await page.getByTestId('tool-balloon').click();
  await expect(page.getByTestId('tool-dialog-balloon')).toBeVisible();
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
    // the section is CYLINDER-ONLY (user: "only applicable to the cylindrical craft")
    await expect(page.getByTestId('tool-field-fins')).toBeHidden();
    await page.getByTestId('tool-opt-profile-cylinder').click();
    await expect(page.getByTestId('tool-field-fins')).toBeVisible();
    await page.getByTestId('tool-opt-fins-on').click();
    await expect(page.getByTestId('tool-field-pivot')).toBeVisible();
    await expect(page.getByTestId('tool-field-oversize')).toBeVisible();
    // a stubby tail refuses honestly (tail zone ≥ 3 m)
    await setRange(page, 'rx', 3);
    await setRange(page, 'ry', 3);
    await setRange(page, 'rz', 4);
    const prev = page.locator('[data-testid="tool-preview"]');
    await expect.poll(async () => ((await prev.textContent()) ?? ''),
      { timeout: 15_000 }).toMatch(/nothing to place/);
    await expect(page.getByTestId('tool-ok')).toBeDisabled();
    // a proper zeppelin plans the whole batch
    await setRange(page, 'rx', 2);
    await setRange(page, 'ry', 2);
    await setRange(page, 'rz', 8);
    await expect.poll(async () => ((await prev.textContent()) ?? '').includes('rudder'),
      { timeout: 30_000 }).toBe(true);
    await expect(prev).toContainText('enclosed');
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
});
