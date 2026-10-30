// anatomy.mjs — find the ToggleButton roots in the live scene graph and
// inspect userData + a manual raycast (three via engine import map).
const BASE = process.argv[2] ?? 'http://127.0.0.1:5176';
const { chromium } = await import('@playwright/test');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=vulkan'],
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' } });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.addInitScript(() => { localStorage.setItem('archean-app-live', 'on');
  localStorage.setItem('archean-app-debug', '1'); localStorage.setItem('archean-app-backdrop', 'none'); });
await page.goto(`${BASE}/?craft=9000009040`);
await page.waitForFunction(() => !!window.__ARCHEAN__ && !!window.__XENON__);
await page.waitForFunction(() => window.__XENON__().farm.some(f => f.comp === 'cpu' && f.cycles > 10), null, { timeout: 60000 });
await page.evaluate(() => {
  const A = window.__ARCHEAN__; const m = A.engine.moffView;
  A.engine.auditLookAt([1.0 + m.x, 1.1 + m.y, -1.0 + m.z + 1.8], [1.0 + m.x, 1.1 + m.y, -1.0 + m.z]);
});
await page.waitForTimeout(1500);
const out = await page.evaluate(() => {
  const e = window.__ARCHEAN__.engine;
  const found = [];
  e.scene.traverse(o => {
    if (o.userData && o.userData.pressComp)
      found.push({ type: o.userData.pressComp, name: o.name, parentKind: o.parent?.userData?.kind ?? null,
        children: o.children.length, visible: o.visible, layer: o.layers.mask });
  });
  // meshes under the doorbtn root + their userData + raycast flags
  const root = (() => { let r = null; e.scene.traverse(o => { if (o.userData?.pressComp === 'ToggleButton') r = o; }); return r; })();
  const meshes = [];
  if (root) root.traverse(o => { if (o.isMesh) meshes.push({ name: o.name, rc: typeof o.raycast === 'function',
    vis: o.visible, geo: !!o.geometry, scale: o.scale.x }); });
  return { found, meshes };
});
console.log('pressComp roots:', JSON.stringify(out.found));
console.log('doorbtn meshes:', out.meshes.length);
const rays = await page.evaluate(async () => {
  const T = await import('/node_modules/.vite/deps/three.js');
  const e = window.__ARCHEAN__.engine;
  const m = e.moffView;
  const b = e.compRealBox(10);
  const c = window.__ARCHEAN__.screen((b.min[0]+b.max[0])/2 - m.x, (b.min[1]+b.max[1])/2 - m.y, (b.min[2]+b.max[2])/2 - m.z);
  const cv = document.querySelector('[data-testid="canvas"]').getBoundingClientRect();
  const ndc = new T.Vector2(((c[0]-cv.left)/cv.width)*2-1, -((c[1]-cv.top)/cv.height)*2+1);
  const ray = new T.Raycaster();
  ray.setFromCamera(ndc, e.camera);
  e.scene.updateMatrixWorld(true);
  const hits = ray.intersectObjects([e.scene], true);
  return hits.slice(0, 6).map(h => {
    const chain = [];
    let o = h.object;
    while (o) { chain.push({ n: o.name || o.type, dash: !!o.userData?.dash, pc: o.userData?.pressComp ?? null, kind: o.userData?.kind ?? null }); o = o.parent; }
    return { d: +h.distance.toFixed(2), chain: chain.slice(0, 6) };
  });
});
console.log('manual ray hits:', JSON.stringify(rays, null, 1));
await browser.close();
