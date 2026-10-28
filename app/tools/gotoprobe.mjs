// gotoprobe.mjs — isolate the __XCDBG__.goto (run-to-cursor) regression
// (v1.13.31): fresh goto vs goto-after-a-step, with the debug state dumped.
import { chromium } from '@playwright/test';
const BASE = process.env.APP_URL ?? 'http://127.0.0.1:5175';
const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--use-gl=angle', '--use-angle=vulkan', '--no-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  storageState: { cookies: [], origins: [{ origin: BASE,
    localStorage: [{ name: 'archean-app-debug', value: '1' },
      { name: 'archean-app-backdrop', value: 'none' }] }] },
});
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 140)); });
await page.goto(`${BASE}/?craft=3294880085`);
await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 180_000 });
await page.getByTestId('xenon-menu').click();
await page.locator('[data-testid^="xenon-comp-"]').first().click();
await page.waitForFunction(() => document.querySelector('[data-testid="xenon-on"]')?.textContent === 'ON',
  null, { timeout: 90_000 });
const X = () => page.evaluate(() => window.__XENON__?.());
console.log('mode worker =', (await X())?.worker);
await page.evaluate(() => window.__XCDBG__.io(11, 3, 1));

// A: fresh goto (no prior step, VM running, breaks empty)
{
  const g = await page.evaluate(() => window.__XCDBG__.goto('functions.xc', 31, 400));
  console.log('A fresh goto(31):', JSON.stringify({ paused: g.paused, at: `${g.file}:${g.line}`,
    reached: g.reached, cycles: g.cycles, frame: g.frame }));
  console.log('A debug:', JSON.stringify((await X()).debug));
  await page.evaluate(() => window.__XCDBG__.resume({ cycles: 30 }));
}

// B: break 31 + run (same LINE, bps path)
{
  await page.evaluate(() => window.__XCDBG__.break('functions.xc', [31]));
  const r = await page.evaluate(() => window.__XCDBG__.run({ cycles: 500 }));
  console.log('B break(31)+run:', JSON.stringify({ paused: r.paused, at: `${r.file}:${r.line}` }));
  await page.evaluate(() => window.__XCDBG__.clear('functions.xc'));
  await page.evaluate(() => window.__XCDBG__.resume({ cycles: 30 }));
}

// C: break 10 + run + step over + clear + goto(31) — the spec's exact chain
{
  await page.evaluate(() => window.__XCDBG__.break('functions.xc', [10]));
  const r = await page.evaluate(() => window.__XCDBG__.run({ cycles: 500 }));
  console.log('C break(10)+run:', JSON.stringify({ paused: r.paused, at: `${r.file}:${r.line}` }));
  const st = await page.evaluate(() => window.__XCDBG__.step('over'));
  console.log('C step over:', JSON.stringify({ paused: st.paused, at: `${st.file}:${st.line}`, moved: st.moved }));
  await page.evaluate(() => window.__XCDBG__.clear('functions.xc'));
  const g = await page.evaluate(() => window.__XCDBG__.goto('functions.xc', 31, 400));
  console.log('C goto(31) after step:', JSON.stringify({ paused: g.paused, at: `${g.file}:${g.line}`,
    reached: g.reached, status: g.status }));
  console.log('C debug:', JSON.stringify((await X()).debug));
}
await browser.close();
