import { chromium, devices } from '@playwright/test';
const PORT = 5188, URL = `http://127.0.0.1:${PORT}`;
const ISW = '3812927875';
const browser = await chromium.launch({ env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=vulkan'] });
const ctx = await browser.newContext({ ...devices['Pixel 7'],
  storageState: { cookies: [], origins: [{ origin: URL, localStorage: [
    { name: 'archean-app-debug', value: '1' }, { name: 'archean-app-backdrop', value: 'none' }]}]} });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 200)));
await page.goto(URL + '/?craft=' + ISW);
await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 30000 });
console.log('dock right after boot:', await page.getByTestId('build-dock').count());
await page.getByTestId('toggle-options').click();
await page.getByTestId('opt-static').check();
await page.getByTestId('toggle-options').click();
await page.getByTestId('static-close').click();
console.log('dock before mode-view:', await page.getByTestId('build-dock').count());
await page.getByTestId('mode-view').click();
await page.waitForTimeout(500);
const ids = await page.evaluate(() => [...document.querySelectorAll('[data-testid]')].map(e => e.dataset.testid).join(','));
console.log('mode tiles:', await page.evaluate(() => [...document.querySelectorAll('[data-testid^=mode-]')].map(b => b.dataset.testid + ':' + (b.getAttribute('aria-pressed') ?? '?')).join(' ')));
console.log('testids:', ids.slice(0, 400));
console.log('dock after mode-view:', await page.getByTestId('build-dock').count());
await browser.close();
