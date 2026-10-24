// livery.mjs — TRIAGE (we: "the united airlines airliner stopped rendering
// text on its side correctly … dashboards roughly coplanar to its hull
// blocks"; then: "It only renders bad in chromium"): loads 3309955432 in the
// LIVE editor, locates every side-facing livery Dashboard (Screen-element
// boards), reports their live scene-graph WORLD positions/normals (pure JS —
// browser-independent if the code is fine) next to the PIXELS actually
// rendered at each board face + what the pick answers there, then
// screenshots the side with the hull ON and OFF.
// usage: node tools/livery.mjs [port] [firefox]   (shots → /tmp/opencode/)
import { chromium, firefox } from '@playwright/test';
const PORT = process.argv[2] ?? '5175';
const FF = process.argv[3] === 'firefox';
const BACKEND = process.argv[4] ?? 'vulkan';        // vulkan | gl | default
const launch = FF
  ? () => firefox.launch()
  : () => chromium.launch({ env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' }, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', `--use-angle=${BACKEND}`] });
const browser = await launch();
const tag = FF ? 'ff' : `cr-${BACKEND}`;
console.log(`browser=${tag}`);
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message.slice(0, 200)));
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE-ERR', m.text().slice(0, 200)); });
await page.goto(`http://127.0.0.1:${PORT}/?craft=3309955432`, { waitUntil: 'domcontentloaded' });
try {
  await page.waitForFunction(() => !!window.__ARCHEAN__?.engine?.blueprint, null, { timeout: 120_000 });
} catch (e) { console.log('ENGINE WAIT TIMED OUT'); }
await page.waitForTimeout(8000);                    // real-model stream-in
console.log('title:', await page.title());
console.log('stats:', JSON.stringify(await page.evaluate(() => window.__ARCHEAN__?.stats?.() ?? null)));

// ── the boards: file facts + live world boxes/normals ─────────────────────
const report = await page.evaluate(() => {
  const e = window.__ARCHEAN__.engine;
  const bp = e.blueprint;
  const moff = e.moff ?? { x: 0, y: 0, z: 0 };
  const roots = new Map();
  e.scene.traverse(o => { if (o.userData?.kind === 'comp' && !roots.has(o.userData.ci)) roots.set(o.userData.ci, o); });
  const wp = (c, ax) => c.position[ax];   // components store DIRECT metres
  const rot = (q, v) => {
    const u = [q.x, q.y, q.z], w = q.w;
    const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const c = cr(u, v), c2 = cr(u, c);
    return [0, 1, 2].map(i => v[i] + 2 * w * c[i] + 2 * c2[i]);
  };
  const out = [];
  bp.data.components.forEach((c, ci) => {
    if (c.type !== 'Dashboard') return;
    const n = rot(c.orientation, [0, 0, 1]);
    if (Math.abs(n[0]) < 0.9) return;                    // side livery tiles only
    const p = [wp(c, 'x'), wp(c, 'y'), wp(c, 'z')];
    const g = roots.get(ci);
    let kids = -1, first = null, q = null;
    if (g) {
      kids = g.children.length;
      const el = g.children[0]?.matrixWorld?.elements;
      if (el) first = [el[12], el[13], el[14]];
      const qq = g.quaternion; q = [+qq.w.toFixed(4), +qq.x.toFixed(4), +qq.y.toFixed(4), +qq.z.toFixed(4)];
    }
    out.push({ color: c.data?.color ? [c.data.color.r, c.data.color.g, c.data.color.b] : null, ci, pos: p.map(v => +v.toFixed(3)), n: n.map(v => +v.toFixed(3)),
      fileQ: [+c.orientation.w.toFixed(4), +c.orientation.x.toFixed(4), +c.orientation.y.toFixed(4), +c.orientation.z.toFixed(4)],
      liveQ: q, size: [c.data.size_x, c.data.size_y], live: !!g, kids,
      firstOrigin: first?.map(v => +v.toFixed(3)) });
  });
  return { boards: out, moff: [moff.x, moff.y, moff.z] };
});
console.log('moff:', report.moff, '· side livery boards:', report.boards.length);
for (const b of report.boards.slice(0, 10))
  console.log(`  ci=${b.ci} ${b.size.join('x')}cm col=${b.color} pos=${b.pos} n=${b.n} fileQ=${b.fileQ} liveQ=${b.liveQ} kids=${b.kids} first=${b.firstOrigin}`);

// ── frame the −x livery band, screenshot FIRST, then a SMALL guarded probe ─
const frame = await page.evaluate(() => {
  const e = window.__ARCHEAN__.engine;
  const bp = e.blueprint;
  const rot = (q, v) => {
    const u = [q.x, q.y, q.z], w = q.w;
    const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const c = cr(u, v), c2 = cr(u, c);
    return [0, 1, 2].map(i => v[i] + 2 * w * c[i] + 2 * c2[i]);
  };
  const boards = [];
  bp.data.components.forEach((c, ci) => {
    if (c.type !== 'Dashboard') return;
    const n = rot(c.orientation, [0, 0, 1]);
    if (Math.abs(n[0]) < 0.9) return;
    boards.push({ ci, pc: [c.position.x, c.position.y, c.position.z], n,
      w: c.data.size_x / 100, h: c.data.size_y / 100, q: c.orientation,
      col: c.data.color ? [c.data.color.r, c.data.color.g, c.data.color.b] : null });
  });
  const neg = boards.filter(b => b.pc[0] < 0), pos = boards.filter(b => b.pc[0] >= 0);
  const side = neg.length >= pos.length ? -1 : 1;          // stand off the fuller side... face the OTHER wall
  const wall = boards.filter(b => Math.sign(b.pc[0]) === -side);
  const c0 = wall.reduce((s, b) => s.map((v, i) => v + b.pc[i] / wall.length), [0, 0, 0]);
  e.camera.position.set(c0[0] - side * 7, c0[1] + 1.0, c0[2]);
  e.controls.target.set(c0[0], c0[1], c0[2]);
  e.controls.update(); e.invalidate();
  const ctxLost = e.renderer?.getContext?.()?.isContextLost?.() ?? null;
  return { count: boards.length, wallN: wall.length, c0: c0.map(v => +v.toFixed(2)), ctxLost,
    picks: wall.slice(0, 6).map(b => ({ ci: b.ci, col: b.col,
      face: rot(b.q, [b.w / 2, b.h / 2, 0.0101]).map((v, i) => +(v + b.pc[i]).toFixed(3)) })) };
});
console.log(`wall boards=${frame.wallN}/${frame.count} centroid=${frame.c0} ctxLost=${frame.ctxLost}`);
await page.waitForTimeout(1200);
const shot = async (name) => { await page.waitForTimeout(300); await page.screenshot({ path: `/tmp/opencode/${name}` }); console.log('shot:', name); };
await shot(`livery-${tag}-hull-on.png`);
const probe = await page.evaluate(async (picks) => {
  const e = window.__ARCHEAN__.engine;
  const cv = document.querySelector('canvas').getBoundingClientRect();
  const out = [];
  for (const b of picks) {
    const pt = window.__ARCHEAN__.screen(b.face[0], b.face[1], b.face[2]);   // [x,y] client px
    if (!pt) { out.push({ ci: b.ci, off: 'null' }); continue; }
    const [sx, sy] = pt;
    const lx = sx - cv.left, ly = sy - cv.top;
    if (lx < 2 || ly < 2 || lx > cv.width - 2 || ly > cv.height - 2) { out.push({ ci: b.ci, off: [lx | 0, ly | 0] }); continue; }
    let px = null; try { px = window.__ARCHEAN__.pixel(lx / cv.width, 1 - ly / cv.height); } catch { }
    out.push({ ci: b.ci, px: [lx | 0, ly | 0], rgb: px ? Array.from(px).slice(0, 3) : null, want: b.col });
    await new Promise(r => setTimeout(r, 150));
  }
  return out;
}, frame.picks);
let okn = 0, badn = 0;
for (const r of probe) {
  let verdict = 'off';
  if (r.rgb && r.want) {
    const lin = (v) => { const c = v / 255; return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 2.4) - 0.055; };
    const want = r.want.map(v => Math.round(255 * Math.min(1, Math.pow(v / 255, 1 / 2.2))));
    const d = Math.abs(r.rgb[0] - want[0]) + Math.abs(r.rgb[1] - want[1]) + Math.abs(r.rgb[2] - want[2]);
    verdict = d < 90 ? `MATCH (want sRGB~${want})` : `MISMATCH want~${want}`;
    d < 90 ? okn++ : badn++;
  }
  console.log(`  face ci=${r.ci} @${r.px ?? 'off'} rgb=${r.rgb} boardCol=${r.want} ${verdict}`);
}
console.log(`FACE-PIXEL VERDICT ${tag}: match=${okn} mismatch=${badn}`);
await page.evaluate(() => { const e = window.__ARCHEAN__.engine; e.setOption('hull', false); e.invalidate(); });
await shot(`livery-${tag}-hull-off.png`);
await browser.close();
