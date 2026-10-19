// devprobe.mjs — minimal debug: open dev viewer, upload one blueprint, log everything
import { chromium } from '@playwright/test';
const file = process.argv[2];
const browser = await chromium.launch({ env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=vulkan', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 400)));
page.on('requestfailed', (r) => console.log('[reqfail]', r.url().slice(0, 120), r.failure()?.errorText));
page.on('response', (r) => { if (r.status() >= 400) console.log('[http', r.status() + ']', r.url().slice(0, 120)); });
await page.goto('https://viewer.xenontools.dev/', { waitUntil: 'networkidle', timeout: 60000 });
console.log('title:', await page.title());
console.log('start visible:', await page.isVisible('#start'));
await page.setInputFiles('#file-input', file);
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(2000);
  const st = await page.textContent('#status-text').catch(() => '?');
  const atelier = await page.$eval('#atelier', (e) => !e.classList.contains('hidden')).catch(() => '?');
  const load = await page.$eval('#loading', (e) => !e.classList.contains('hidden') && document.getElementById('loading-text').textContent).catch(() => '-');
  const toast = await page.$eval('#toast', (e) => (!e.classList.contains('hidden') ? e.textContent : '-')).catch(() => '-');
  console.log(`t+${2 * (i + 1)}s status="${st}" atelier=${atelier} loading="${load}" toast="${toast}"`);
  if (atelier === true && st === 'ready') break;
}
await page.screenshot({ path: '/tmp/opencode/devprobe.png' });
await browser.close();
