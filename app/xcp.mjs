import { chromium } from '@playwright/test';
const b = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
const errs = [];
p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
p.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0, 400)));
await p.goto('http://127.0.0.1:5294/?craft=3327182790', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 120000 });
await p.getByTestId('xenon-menu').click();
await p.locator('[data-testid^="xenon-comp-"]').first().click();
await p.waitForFunction(() => !!(window).__XENON__ && (window).__XENON__().status === 'running' || /ON/.test(document.body.innerText), null, { timeout: 60000 });
await p.waitForTimeout(3000);
const info = await p.evaluate(() => ({
  cm: !!document.querySelector('.cm-editor'),
  gutters: [...document.querySelectorAll('.cm-gutter')].map(e => e.className),
  gutterEls: document.querySelectorAll('.cm-gutterElement').length,
  breakGutter: document.querySelectorAll('.xc-break-gutter').length,
}));
console.log(JSON.stringify(info));
console.log('ERRORS:', errs.slice(0, 6).join('\n---\n'));
await b.close();
