import { chromium } from '@playwright/test';
const b = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 1100, height: 720 } })).newPage();
await p.addInitScript(() => { localStorage.setItem('archean-app-debug','1'); localStorage.setItem('archean-app-backdrop','none'); });
await p.goto('http://127.0.0.1:5272/?craft=3288012440&dash=main%230', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 120000 });
await p.waitForFunction(() => !!document.querySelector('[data-testid="screens-cell-main#0-overlay"]'), null, { timeout: 90000 });
await p.keyboard.press('Space');
await p.waitForTimeout(1500);
const c0 = await p.evaluate(() => window.__XENON__().cycles);
await p.waitForTimeout(10000);
const c1 = await p.evaluate(() => window.__XENON__().cycles);
console.log('pump cadence with zoom OPEN (idle-ish):', ((c1 - c0) / 10).toFixed(1), 'cycles/s (ideal 25)');
for (let i = 0; i < 25; i++) { await p.keyboard.down('KeyD'); await p.waitForTimeout(80); await p.keyboard.up('KeyD'); await p.keyboard.press('Space'); await p.waitForTimeout(80); }
const c2 = await p.evaluate(() => window.__XENON__().cycles);
console.log('during active play keys: cadence held ~', ((c2 - c1) / 4).toFixed(1), 'cycles/s over last ~4s');
await b.close();
