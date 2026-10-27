// tools.spec.ts — the v1.7 TOOLS menu, BROWSER TIER only.
// The definition-generated modal (field layout, preview-gates-OK, the
// OK ▸ confirm-box ▸ run flow incl. the danger warning, Esc/✕/backdrop),
// the registry menu listing, the Edit-menu history state and every
// blueprint-DATA value of the replace-all/hullify runs live at lower tiers:
//   src/components/__tests__/tooldialog.test.tsx  (jsdom; tools.spec's green
//     values transcribed — 5 blocks change material, 35 faces on 5 blocks
//     repaint, converted 5 blocks ▸ ≥12 triangles, materials 3 / colours
//     [4×7]) and topbar.test.tsx (the menu DOM). The tool→toast→undo
//     integration is undo.spec. (L5, docs/TEST-PYRAMID.md v1.12.4.)
// What only a browser can state stays here:
//  • the merged hull REPAINTS after a run (stats().loads strictly increases
//    — the AGENTS "data assertions cannot pin a repaint" rule);
//  • the dialog never fills the view; its body scrolls and the footer stays
//    pinned (desktop + Pixel 7, the phone bottom clear zone — pixels);
//  • the block MATERIALS row and the RGB picker drive the live engine + dock
//    (selection, brush, the palette grid).
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
  test('replace all MATERIALS repaints the merged hull', async ({ page }) => {
    // e2e-tier because: the merged hull rebuild (stats().loads strictly
    // increases) is a repaint law no lower tier can state (AGENTS: data
    // assertions cannot pin a repaint). The data values (all materials 3,
    // colours [4×7] kept) and the full dialog flow are jsdom's
    // tooldialog.test.tsx (L5-transcribed from this spec's retired leg).
    await openNew(page);
    await openTool(page, 'replace-all');
    const l0 = await loads(page);
    await page.getByTestId('tool-ok').click();                          // ▸ confirm box
    await expect(page.getByTestId('tool-confirm-box')).toBeVisible();
    await page.getByTestId('tool-confirm').click();                     // runs + CLOSES
    await expect(page.getByTestId('tool-dialog-replace-all')).toBeHidden();
    await expect.poll(() => loads(page), { timeout: 15_000 }).toBeGreaterThan(l0);  // hull rebuilt
  });

  test('the dialog never fills the view; its body scrolls and the footer stays pinned', async ({ page }) => {
    // 2026-10-22 user rule: "Fix the tool windows so they don't use 100% of
    // view and that they can scroll smoothly down" — the sphere dialog is the
    // tallest definition in the registry, so it is the probe. Runs on BOTH
    // viewports of the suite (desktop Chrome + Pixel 7).
    await openNew(page);
    await openTool(page, 'balloon');
    const vp = page.viewportSize()!;
    const box = (await page.getByTestId('tool-dialog-balloon').boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(vp.height * 0.95);
    expect(box.width).toBeLessThanOrEqual(vp.width * 0.95);
    // PHONE bottom clear zone (user 2026-10-22: mobile Brave's bottom
    // toolbar paints OVER the page — "impossible to hit ok … there MUST be
    // a margin"): the dialog's lower edge never enters the 48 px band
    if (vp.width < 768) expect(vp.height - (box.y + box.height)).toBeGreaterThanOrEqual(48);
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
    await page.getByTestId('ws-edit').click();
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

  test('RGB picker: a custom colour becomes a NEW palette slot + paints', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'the side panel is a drawer on phones');
    await openNew(page);
    await page.getByTestId('mode-edit').click();
    await page.getByTestId('ws-blocks').click();
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
    await page.getByTestId('ws-blocks').click();
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
