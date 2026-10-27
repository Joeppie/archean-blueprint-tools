import { chromium } from '@playwright/test';
const PORT = 5188, URL = `http://127.0.0.1:${PORT}`;
const browser = await chromium.launch({ env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=vulkan'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 },
  storageState: { cookies: [], origins: [{ origin: URL, localStorage: [
    { name: 'archean-app-debug', value: '1' }, { name: 'archean-app-backdrop', value: 'none' }]}]} });
const page = await ctx.newPage();
await page.goto(URL + '/?craft=3334698274');
await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 60000 });
const out = await page.evaluate(() => {
  const e = window.__ARCHEAN__.engine;
  const moff = [e.moffView.x, e.moffView.y, e.moffView.z];
  const rows = [];
  for (const [bi, jrefs] of e.subJrefs) {
    const c = e.bp.data.components[bi];
    const blocks = (c?.data?.blocks ?? []).filter(x => (x.type ?? 0) !== 255);
    const bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const x of blocks) for (const s of [[0,0,0],[(x.size_x??0)+1,(x.size_y??0)+1,(x.size_z??0)+1]]) {
      const p = [(x.pos_x+s[0]+(x.frame_x??0)*12-5.5)*0.25+moff[0],
                 (x.pos_y+s[1]+(x.frame_y??0)*12-5.5)*0.25+moff[1],
                 (x.pos_z+s[2]+(x.frame_z??0)*12-5.5)*0.25+moff[2]];
      for (let k=0;k<3;k++){ bb.min[k]=Math.min(bb.min[k],p[k]); bb.max[k]=Math.max(bb.max[k],p[k]); }
    }
    for (const j of jrefs) {
      if (j.top < 0) continue;
      const onPanel = bb.min[0] === Infinity ? 0
        : Math.hypot(...[0,1,2].map(k => Math.max(bb.min[k] - j.pivot0[k] - moff[k], 0, j.pivot0[k] + moff[k] - bb.max[k])));
      rows.push({ bi, type: j.mc.type, top: j.top,
        pivot0: j.pivot0.map(v => +v.toFixed(2)),
        bbmin: bb.min.map(v => +(v).toFixed(2)) });
      rows[rows.length-1].bbmin = bb.min.map(v => +v.toFixed(2));
      rows[rows.length-1].bbmax = bb.max.map(v => +v.toFixed(2));
      rows[rows.length-1].onPanel = +onPanel.toFixed(2);
    }
  }
  return { moff: moff.map(v => +v.toFixed(2)), rows };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
