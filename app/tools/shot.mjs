// shot.mjs — one-shot screenshot of the running dev server (dev aid):
//   node tools/shot.mjs <url> <out.png> [w] [h] [wait-ms]
import { chromium } from '@playwright/test';
const [url, out, w = '1280', h = '800', wait = '6000'] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: +w, height: +h } });
await p.addInitScript(() => localStorage.setItem('archean-app-debug', '1'));
await p.goto(url, { waitUntil: 'load' });
await p.waitForTimeout(+wait);
await p.screenshot({ path: out });
console.log('title:', await p.title());
await b.close();
