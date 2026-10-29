// debugshot.mjs — README screenshots of the LIVE Xenon debugger (v1.15.1).
//
// Why: the debugger's face (title-bar run/stop buttons, the ⏸ file:line
// pill, gutter breakpoints + the BREAKPOINTS strip, the paused-line wash,
// the worker-mode chip) is a UI story pixels tell best. This drives the
// REAL app on the dev server (COOP/COEP ⇒ worker mode) exactly the way
// xenon.spec's debugger leg does — open the CEP fixture, open the IDE, set
// the line-17 break, wait for the real pause — then shoots the elements.
//
// Usage (dev server on 5175 must serve THIS tree):
//   node tools/debugshot.mjs [BASE]      BASE default http://127.0.0.1:5175
// Writes ../assets/xenon-menu.png + ../assets/xenon-debug-paused.png.
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5175';
const CEP = '3327182790'; // Cheap Exploration Plane — the debugger fixture
const OUT = new URL('../../assets/', import.meta.url).pathname;

const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
});
const page = await browser.newPage({
  viewport: { width: 1680, height: 1050 },
  deviceScaleFactor: 2,
});

await page.goto(`${BASE}/?craft=${CEP}`);
await page.getByTestId('xenon-menu').waitFor({ timeout: 120_000 });

// SHOT 1 — the Xenon ▾ menu as of v1.15.1: the WIP warning + the computer
// list; NO debugger announcement (the healthy origin says nothing).
await page.getByTestId('xenon-menu').click();
await page.getByTestId('xenon-wip').waitFor({ timeout: 15_000 });
const menuBox = await page.locator('div:has(> [data-testid="xenon-wip"])').boundingBox();
await page.screenshot({
  path: `${OUT}xenon-menu.png`,
  clip: {
    x: Math.max(0, menuBox.x - 10),
    y: Math.max(0, menuBox.y - 44),
    width: menuBox.width + 20,
    height: menuBox.height + 54,
  },
});

// SHOT 2 — the IDE paused at a real breakpoint on the worker: title-bar
// debugger buttons + ⏸ pill, gutter break + BREAKPOINTS strip, the paused
// line wash, the live chip "debugger: worker · true line-stepping".
await page.locator('[data-testid^="xenon-comp-"]').first().click();
await page.getByTestId('xenon-on').waitFor({ timeout: 90_000 });
await page.getByTestId('xenon-mode').filter({ hasText: 'worker · true line-stepping' })
  .waitFor({ timeout: 60_000 });
const gutter = page.locator('.xc-break-gutter .cm-gutterElement').nth(16);
await gutter.waitFor({ timeout: 30_000 });
await gutter.click();
const pill = page.getByTestId('xenon-paused');
await pill.waitFor({ timeout: 30_000 });
await page.getByTestId('bp-overview').waitFor({ timeout: 10_000 });
await page.getByTestId('xenon-dialog').screenshot({ path: `${OUT}xenon-debug-paused.png` });

console.log(`paused at ${await pill.getAttribute('data-file')}:${await pill.getAttribute('data-line')}`);
console.log(`wrote ${OUT}xenon-menu.png, ${OUT}xenon-debug-paused.png`);
await browser.close();
