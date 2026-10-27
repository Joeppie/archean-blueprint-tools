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
  const qMulA = (a, b) => [a[0]*b[0]-a[1]*b[1]-a[2]*b[2]-a[3]*b[3], a[0]*b[1]+a[1]*b[0]+a[2]*b[3]-a[3]*b[2],
    a[0]*b[2]-a[1]*b[3]+a[2]*b[0]+a[3]*b[1], a[0]*b[3]+a[1]*b[2]-a[2]*b[1]+a[3]*b[0]];
  const qRotA = (q, v) => {
    const t = [2*(q[1]*v[2]-q[2]*v[1]), 2*(q[2]*v[0]-q[0]*v[2]), 2*(q[0]*v[1]-q[1]*v[0])];
    return [v[0]+q[0]*t[0]+(q[1]*t[2]-q[2]*t[1]), v[1]+q[0]*t[1]+(q[2]*t[0]-q[0]*t[2]), v[2]+q[0]*t[2]+(q[1]*t[0]-q[2]*t[1])];
  };
  const rigApplyA = (ch, v) => { const r = qRotA(ch.q, v); return [ch.t[0]+r[0], ch.t[1]+r[1], ch.t[2]+r[2]]; };
  const rigPushA = (ch, pos, quat) => { const r = qRotA(ch.q, [pos.x, pos.y, pos.z]);
    return { t: [ch.t[0]+r[0], ch.t[1]+r[1], ch.t[2]+r[2]], q: qMulA(ch.q, quat) }; };
  const bb = { min: [Infinity,Infinity,Infinity], max: [-Infinity,-Infinity,-Infinity] };
  const growBB = (p) => { for (let k=0;k<3;k++){ bb.min[k]=Math.min(bb.min[k],p[k]); bb.max[k]=Math.max(bb.max[k],p[k]); } };
  const growBlocks = (bl, chain) => {
    for (const x of bl) for (const s of [[0,0,0],[(x.size_x??0)+1,(x.size_y??0)+1,(x.size_z??0)+1]])
      growBB(rigApplyA(chain, [(x.pos_x+s[0]+(x.frame_x??0)*12-5.5)*0.25,
        (x.pos_y+s[1]+(x.frame_y??0)*12-5.5)*0.25, (x.pos_z+s[2]+(x.frame_z??0)*12-5.5)*0.25]).map((v,i)=>v+moff[i]));
  };
  const collectRigs = (list, depth, chain) => {
    for (const sc of list) if (sc.type === 'Build' && depth < 8) {
      const scChain = rigPushA(chain, sc.position, [sc.orientation?.w??1, sc.orientation?.x??0, sc.orientation?.y??0, sc.orientation?.z??0]);
      growBlocks(((sc.data?.blocks) ?? []).filter(x => (x.type ?? 0) !== 255), scChain);
      collectRigs((sc.data?.components) ?? [], depth + 1, scChain);
    }
  };
  const rows = [];
  for (const [bi, jrefs] of e.subJrefs) {
    bb.min = [Infinity,Infinity,Infinity]; bb.max = [-Infinity,-Infinity,-Infinity];
    growBlocks(((e.bp.data.components[bi]?.data?.blocks) ?? []).filter(x => (x.type ?? 0) !== 255), { t:[0,0,0], q:[1,0,0,0] });
    collectRigs((e.bp.data.components[bi]?.data?.components) ?? [], 0, { t:[0,0,0], q:[1,0,0,0] });
    for (const j of jrefs) {
      if (j.top < 0) continue;
      const onPanel = bb.min[0] === Infinity ? 0
        : Math.hypot(...[0,1,2].map(k => Math.max(bb.min[k]-j.pivot0[k]-moff[k], 0, j.pivot0[k]+moff[k]-bb.max[k])));
      rows.push({ bi, type: j.mc.type, top: j.top, onPanel: +onPanel.toFixed(2),
        pivot0: j.pivot0.map(v => +v.toFixed(2)),
        bbmin: bb.min.map(v => +v.toFixed(2)), bbmax: bb.max.map(v => +v.toFixed(2)) });
    }
  }
  return rows;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
