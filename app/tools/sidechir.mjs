// sidechir.mjs — chirality probe: shoot our viewer of testdata/3309955432
// from the file -x and +x fuselage sides + the cockpit POV, plus the iso pair
// camera. Scratch harness (not part of the matrix ritual).
//   node tools/sidechir.mjs --ours http://HOST:PORT --out /tmp/dir
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  if (!process.argv[i].startsWith('--')) continue;
  const k = process.argv[i].slice(2), n = process.argv[i + 1];
  if (n !== undefined && !n.startsWith('--')) { args[k] = n; i++; } else args[k] = '1';
}
const OURS = args.ours, OUT = args.out || '/tmp/opencode/sidechir';
const ID = args.id || '3309955432';
mkdirSync(OUT, { recursive: true });

// FILE-space camera {pos, target}; our view space mirrors z.
const CAMS = {
  'side-xneg': { pos: [-16, 13.4, -2.6], tgt: [-3.1, 12.8, -2.6] },  // look at x=-3 plates
  'side-xpos': { pos: [16, 13.4, -2.6], tgt: [3.1, 12.8, -2.6] },
  'cockpit':   { pos: [0, 12.55, -10.4], tgt: [0, 11.9, -13.2] },
  'iso-devpair': { pos: [24, 15, 19], tgt: [0, 12, 2] },
};

const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
    '--use-angle=vulkan', '--enable-unsafe-swiftshader'],
});
for (const [name, c] of Object.entries(CAMS)) {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const url = `${OURS}/viewer/index.html?open=../testdata/${ID}/blueprint.json`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!window.HARCHEAN?.camera, null, { timeout: 90000 });
  await page.waitForFunction(() => /\d+ components/.test(
    document.getElementById('filestatus')?.textContent || ''), null, { timeout: 90000 });
  await page.waitForTimeout(3000);
  await page.evaluate((c) => {
    const H = window.HARCHEAN;
    for (const ch of H.scene.children) {
      if (ch.type === 'GridHelper' ||
          (ch.isMesh && ch.geometry?.type === 'PlaneGeometry' &&
           ch.geometry?.parameters?.width === 120)) ch.visible = false;
    }
    const occ = H.viewToggles?.occ;
    if (occ && occ.cb.checked) { occ.cb.checked = false; occ.cb.onchange(); }
    for (const b of document.querySelectorAll('#flight button, .btn')) {
      if (/^CoM\/arrows: on$/.test(b.textContent)) b.click();
      else if (/^thrust: shown$/.test(b.textContent)) b.click();
    }
    if (typeof H.select === 'function') H.select(-1);
    const M = (p) => [p[0], p[1], -p[2]];           // file -> view
    const P = M(c.pos), T = M(c.tgt);
    H.camera.position.set(P[0], P[1], P[2]);
    H.controls.target.set(T[0], T[1], T[2]);
    H.camera.lookAt(T[0], T[1], T[2]);
    H.controls.update();
    H.invalidate();
  }, c);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/ours-${name}.png` });
  console.log(`ours-${name}.png done`);
  await page.context().close();
}
await browser.close();
