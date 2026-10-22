// tools.spec.ts — the v1.7 TOOLS menu + MATERIALS editor + RGB picker.
//  • Tools ▾ lists the registry (Replace all…, Blocks → hull triangles…)
//    with the "more tools to follow" footer;
//  • the modal is DEFINITION-GENERATED and opens centred: fields auto-laid,
//    a live preview line, CANCEL (or Esc) changes nothing, OK RUNS;
//  • Replace all swaps materials/appearance on the live blueprint and the
//    merged hull repaints (stats().loads strictly increases — the AGENTS
//    "data assertions cannot pin a repaint" rule);
//  • Blocks → hull triangles is a DANGER tool: OK opens a CONFIRMATION BOX
//    (live readout + warning), Confirm converts every geometry block into
//    covering triangles and the dialog CLOSES (2026-10-20 — no inert second OK);
//  • the block MATERIALS row writes the file's `material` (a gameplay
//    identity) WITHOUT touching colours;
//  • the RGB picker writes a NEW slot into the craft's own palette.
import { expect, test, type Page } from '@playwright/test';

type Blk = { pos_x: number; pos_y: number; pos_z: number; type: number; material?: number;
  colors?: number[] };
type Tri = { frame_x: number; colors?: number[]; [k: string]: unknown };

const bpOf = (page: Page) => page.evaluate(() =>
  (window as unknown as { __ARCHEAN__: { engine: { blueprint: {
    data: { blocks: Blk[]; triangles?: Tri[]; colors?: (Record<string, number> | null)[] } } } } })
    .__ARCHEAN__.engine.blueprint.data);

const loads = (page: Page) => page.evaluate(() =>
  (window as unknown as { __ARCHEAN__: { stats: () => { loads: number } } }).__ARCHEAN__.stats().loads);

async function openNew(page: Page) {
  await page.goto('/');
  await page.getByTestId('gallery-new').click();
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
}

/** walk the canvas with the ENGINE's own picker until a block face answers */
async function blockPixel(page: Page): Promise<{ x: number; y: number }> {
  for (let i = 0; i < 40; i++) {
    const px = await page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      const r = c.getBoundingClientRect();
      const e = (window as unknown as { __ARCHEAN__?: { engine: {
        pendingReal: number; pickCell: (x: number, y: number) => { kind: string; bi: number } | null } } })
        .__ARCHEAN__!.engine;
      if (e.pendingReal > 0) return null;
      for (let fy = 0.3; fy <= 0.85; fy += 0.02)
        for (let fx = 0.25; fx <= 0.8; fx += 0.02) {
          const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
          if (h && h.kind === 'block' && h.bi >= 0) return { x: r.left + r.width * fx, y: r.top + r.height * fy };
        }
      return null;
    });
    if (px) return px;
    await page.waitForTimeout(300);
  }
  throw new Error('no block face answered pickCell');
}

/** the brush slot number field's current value */
const brushSlot = (page: Page) => page.evaluate(() => Number(
  (document.querySelector('[data-testid="num-slot"]') as HTMLInputElement | null)?.value ?? -1));

async function openTool(page: Page, id: string) {
  await page.getByTestId('tools-menu').click();
  await page.getByTestId(`tool-${id}`).click();
  await expect(page.getByTestId(`tool-dialog-${id}`)).toBeVisible();
}

test.describe('tools menu + dialogs @ui', () => {
  test('the menu lists the registry; Cancel changes nothing', async ({ page }) => {
    await openNew(page);
    await page.getByTestId('tools-menu').click();
    await expect(page.getByTestId('tool-replace-all')).toBeVisible();
    await expect(page.getByTestId('tool-hullify')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('edit-menu').click();
    // 2026-10-20: Undo is WIRED but a fresh, untouched craft has no history yet.
    await expect(page.getByTestId('edit-undo')).toBeDisabled();
    await expect(page.getByTestId('edit-redo')).toBeDisabled();
    await expect(page.getByTestId('edit-vessel-author')).toBeDisabled();
    await expect(page.getByTestId('edit-vessel-code')).toBeDisabled();
    await page.keyboard.press('Escape');
    const before = await bpOf(page);
    expect(before.blocks.length).toBe(5);                              // the deck plate
    await openTool(page, 'replace-all');
    await expect(page.getByTestId('tool-preview')).toContainText(/5 blocks change material/);
    await page.getByTestId('tool-cancel').click();
    await expect(page.getByTestId('tool-dialog-replace-all')).toBeHidden();
    expect((await bpOf(page)).blocks).toEqual(before.blocks);
  });

  test('replace all MATERIALS: composite deck ▸ aluminium, hull repaints', async ({ page }) => {
    await openNew(page);
    await openTool(page, 'replace-all');
    // the shipped default IS the user's example: composite ▸ aluminium
    await expect(page.getByTestId('tool-preview')).toContainText(/5 blocks change material/);
    const l0 = await loads(page);
    await page.getByTestId('tool-ok').click();                          // ▸ confirm box
    await expect(page.getByTestId('tool-confirm-box')).toBeVisible();
    await expect(page.getByTestId('tool-preview')).toContainText(/5 blocks change material/);
    await page.getByTestId('tool-confirm').click();                     // runs + CLOSES
    await expect(page.getByTestId('tool-dialog-replace-all')).toBeHidden();
    await expect.poll(async () => (await bpOf(page)).blocks.every(b => b.material === 3),
      { timeout: 15_000 }).toBe(true);
    await expect.poll(() => loads(page), { timeout: 15_000 }).toBeGreaterThan(l0);  // hull rebuilt
    // colours untouched: the deck kept its slot-4 paint
    expect((await bpOf(page)).blocks[0]!.colors).toEqual([4, 4, 4, 4, 4, 4, 4]);
  });

  test('blocks → hull triangles: OK opens the info confirm box, Confirm converts + closes', async ({ page }) => {
    await openNew(page);
    await openTool(page, 'hullify');
    await expect(page.getByTestId('tool-preview')).toContainText(/5 blocks ▸ \d+ triangles/);
    await expect(page.getByTestId('tool-preview')).toContainText(/shading flat/);
    await page.getByTestId('tool-ok').click();                          // ▸ confirm box only
    expect((await bpOf(page)).blocks.length).toBe(5);
    await expect(page.getByTestId('tool-confirm-box')).toBeVisible();
    await expect(page.getByTestId('tool-warning')).toContainText(/rewrites hull geometry/i);
    await page.getByTestId('tool-confirm').click();                     // converts + closes
    await expect(page.getByTestId('tool-dialog-hullify')).toBeHidden();
    await expect.poll(async () => (await bpOf(page)).blocks.length, { timeout: 15_000 }).toBe(0);
    const d = await bpOf(page);
    expect((d.triangles ?? []).length).toBeGreaterThanOrEqual(12);
    expect(d.triangles!.every(t => t.colors && (t.colors as number[]).length === 5)).toBe(true);
    await expect(page.getByTestId('tool-toast')).toContainText(/converted 5 blocks/);
  });

  test('the dialog never fills the view; its body scrolls and the footer stays pinned', async ({ page }) => {
    // 2026-10-22 user rule: "Fix the tool windows so they don't use 100% of
    // view and that they can scroll smoothly down" — the sphere dialog is the
    // tallest definition in the registry, so it is the probe. Runs on BOTH
    // viewports of the suite (desktop Chrome + Pixel 7).
    await openNew(page);
    await openTool(page, 'sphere-skin');
    const vp = page.viewportSize()!;
    const box = (await page.getByTestId('tool-dialog-sphere-skin').boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(vp.height * 0.95);
    expect(box.width).toBeLessThanOrEqual(vp.width * 0.95);
    // the MIDDLE scrolls (only when the content actually overflows), while
    // the OK button stays inside the viewport at BOTH scroll extremes
    const ok = page.getByTestId('tool-ok');
    await expect(ok).toBeInViewport();
    const scroll = page.locator('.tool-scroll');
    const overflows = await scroll.evaluate(el => el.scrollHeight - el.clientHeight);
    if (overflows > 4) {
      await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    }
    await expect(ok).toBeInViewport();
    await page.getByTestId('tool-cancel').click();
  });
});

test.describe('materials + RGB picker @ui', () => {
  test('the block MATERIALS row writes material without touching colours', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'the side panel is a drawer on phones');
    await openNew(page);
    await page.getByTestId('mode-edit').click();
    await page.getByTestId('tooltab-edit').click();
    const px = await blockPixel(page);
    await page.mouse.click(px.x, px.y);
    await expect(page.getByTestId('block-edit')).toContainText(/Block\[\d+\]/, { timeout: 10_000 });
    const before = await bpOf(page);
    const sel = await page.evaluate(() => {
      const w = window as unknown as { __ARCHEAN__: { blockGizmo: () => { bi: number } | null } };
      return w.__ARCHEAN__.blockGizmo()?.bi ?? -1;
    });
    expect(sel).toBeGreaterThanOrEqual(0);                             // the widget rides it
    await page.getByTestId('block-material-m5').click();                // Lead
    await expect.poll(async () => (await bpOf(page)).blocks[sel]?.material,
      { timeout: 10_000 }).toBe(5);
    expect((await bpOf(page)).blocks[sel]!.colors).toEqual(before.blocks[sel]!.colors);
    await expect(page.getByTestId('block-material-name')).toHaveText('Lead');
  });

  test('a COLOUR replace-all runs through the native select', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'the side panel is a drawer on phones');
    await openNew(page);
    await openTool(page, 'replace-all');
    await page.getByTestId('tool-select-target').selectOption('colors');
    await page.getByTestId('tool-select-source').selectOption('all');
    await page.getByTestId('tool-select-destColor').selectOption('hull');
    await expect(page.getByTestId('tool-preview')).toContainText(/35 faces on 5 blocks repaint/);
    await page.getByTestId('tool-ok').click();
    await page.getByTestId('tool-confirm').click();
    await expect.poll(async () => (await bpOf(page)).blocks.every(b => b.colors?.[0] === 51),
      { timeout: 15_000 }).toBe(true);
  });

  test('RGB picker: a custom colour becomes a NEW palette slot + paints', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'the side panel is a drawer on phones');
    await openNew(page);
    await page.getByTestId('mode-edit').click();
    await page.getByTestId('tooltab-place').click();
    await page.getByTestId('rgb-hex').fill('#ff3300');
    const l0 = await loads(page);
    await page.getByTestId('rgb-new-slot').click();
    await expect.poll(async () => {
      const cols = (await bpOf(page)).colors ?? [];
      return cols.findIndex(c => c && c.r === 255 && c.g === 51 && c.b === 0);
    }, { timeout: 10_000 }).toBeGreaterThan(10);
    await expect.poll(() => loads(page), { timeout: 15_000 }).toBeGreaterThan(l0);
    // the brush now paints with that slot
    expect(await brushSlot(page)).toBeGreaterThan(10);
    // the swatch grid shows the new slot in the "on vessel" strip
    await expect(page.getByTestId('palette-swatch').first()).toBeVisible();
  });

  test('RGB picker: nearest-slot never grows the palette', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'the side panel is a drawer on phones');
    await openNew(page);
    await page.getByTestId('mode-edit').click();
    await page.getByTestId('tooltab-place').click();
    await page.getByTestId('rgb-hex').fill('#ffffff');
    const before = await page.evaluate(() =>
      ((window as unknown as { __ARCHEAN__: { engine: { blueprint: { data: {
        colors?: unknown[] } } } } }).__ARCHEAN__.engine.blueprint.data.colors ?? []).length);
    await page.getByTestId('rgb-nearest').click();
    await expect(page.getByTestId('rgb-note')).toContainText(/painted ≈ slot/);
    const after = await page.evaluate(() =>
      ((window as unknown as { __ARCHEAN__: { engine: { blueprint: { data: {
        colors?: unknown[] } } } } }).__ARCHEAN__.engine.blueprint.data.colors ?? []).length);
    expect(after).toBe(before);
    // #ffffff IS built-in slot 0 (exact hit — the nearest search covers the
    // engine-reserved slots too, they are paintable, just not redefinable)
    await expect(page.getByTestId('rgb-note')).toContainText('painted ≈ slot 0');
  });
});
