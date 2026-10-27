import { chromium } from '@playwright/test';
const PORT = Number(process.env.PORT ?? 5197), URL = `http://127.0.0.1:${PORT}`;
const ISW = '3812927875';
const browser = await chromium.launch({ env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=vulkan'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 },
  storageState: { cookies: [], origins: [{ origin: URL, localStorage: [
    { name: 'archean-app-debug', value: '1' }, { name: 'archean-app-backdrop', value: 'none' }]}]} });
const page = await ctx.newPage();
const reqs = [];
page.on('request', r => { if (r.url().includes(`${ISW}/blueprint.json`)) reqs.push(r.url().replace(URL, '')); });
page.on('console', m => { if (m.type() === 'warn' || m.type() === 'error') console.log('CONSOLE', m.type(), m.text().slice(0, 160)); });
await page.goto(URL + `/?craft=${ISW}`);
await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 30000 });
console.log('first open reqs:', JSON.stringify(reqs));
const st = await page.evaluate(async () => {
  const db = await indexedDB.open('archean-crafts');
  await new Promise(r => { db.onsuccess = r; db.onerror = r; });
  return 'db-ok';
}).catch(e => 'db-err ' + e.message);
const entry = await page.evaluate(async (id) => {
  return await new Promise(res => {
    const req = indexedDB.open('archean-crafts');
    req.onsuccess = () => {
      const db = req.result;
      const store = db.objectStoreNames[0];
      const g = db.transaction(store).objectStore(store).get(id);
      g.onsuccess = () => { const v = g.result; res(v ? { keys: Object.keys(v), rev: v.rev, sha: (v.sha||'').slice(0,10), bytes: v.bytes } : null); };
      g.onerror = () => res('get-err');
    };
    req.onerror = () => res('open-err');
  });
}, ISW);
console.log('cache entry:', JSON.stringify(entry));
await page.reload();
await page.waitForTimeout(6000);
console.log('after reload title:', await page.title(), '· stale dialog:', await page.getByTestId('stale-open-dialog').count());
console.log('reqs after reload:', JSON.stringify(reqs));
if (await page.getByTestId('stale-open-dialog').count()) {
  const txt = await page.getByTestId('stale-open-dialog').innerText();
  console.log('dialog:', txt.replace(/\n/g, ' | ').slice(0, 300));
}
const metaProbe = await page.evaluate(() =>
  window.__GALLERY_META__ ?? 'no-global');
console.log('meta probe:', JSON.stringify(metaProbe));
await browser.close();
