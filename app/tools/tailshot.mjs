// one-shot eyeball: build a tailed balloon through the live UI and shoot it
// (side view + top view). Not a suite — a look. node tools/tailshot.mjs [port]
import { chromium } from 'playwright';

const PORT = process.argv[2] ?? 5175;
const b = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
});
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
// the SCENE PASS title is DEBUG-ONLY (user rule 2026-10-19) — boot with it
ctx.addInitScript(() => localStorage.setItem('archean-app-debug', '1'));
const p = await ctx.newPage();
p.on('console', m => { if (m.type() === 'error') console.log('PAGE-ERR', m.text().slice(0, 160)); });
await p.goto(`http://127.0.0.1:${PORT}/`);
await p.getByTestId('gallery-new').click();
await p.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 40_000 });
await p.getByTestId('tools-menu').click();
await p.getByTestId('tool-balloon').click();
const setR = async (k, v) => p.evaluate(([k2, v2]) => {
  const el = document.querySelector(`[data-testid="tool-range-${k2}"]`);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v2));
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, [k, v]);
await p.getByTestId('tool-opt-profile-cylinder').click();
await p.getByTestId('tool-opt-fins-on').click();
await setR('rx', 2); await setR('ry', 2); await setR('rz', 8);
await p.waitForFunction(() =>
  document.querySelector('[data-testid="tool-preview"]')?.textContent?.includes('rudder'),
  null, { timeout: 40_000 });
console.log('preview:', (await p.locator('[data-testid="tool-preview"]').textContent()).slice(0, 300));
await p.getByTestId('tool-ok').click();
await p.getByTestId('tool-confirm').click();
await p.getByTestId('place-label').waitFor({ timeout: 40_000 });
/** pull the camera back + orbit by driving the real controls */
async function pose(dx = -160, dy = -70, ticks = 14) {
  const cx = 850, cy = 470;
  await p.mouse.move(cx, cy);
  for (let i = 0; i < ticks; i++) { await p.mouse.wheel(0, 120); await p.waitForTimeout(35); }
  if (dx || dy) {
    await p.mouse.down();                       // LEFT = orbit (a drag never picks)
    await p.mouse.move(cx + dx, cy + dy, { steps: 12 });
    await p.mouse.up();
  }
  await p.waitForTimeout(500);
}
await pose(0, 0, 10);                           // wheel only: the widget owns drags now
await p.screenshot({ path: '/tmp/opencode/tail-ghost.png' });
await p.getByTestId('place-build').click();
await p.getByTestId('tool-toast').waitFor({ timeout: 20_000 });
console.log('toast:', await p.locator('[data-testid="tool-toast"]').textContent());
await p.waitForFunction(() => !document.title.includes('BUILDING'), null, { timeout: 30_000 }).catch(() => {});
await p.waitForTimeout(2500);
await pose(-230, -60, 8);
await p.screenshot({ path: '/tmp/opencode/tail-built.png' });
// hide the hull to check the hidden cables + panels from inside
await p.keyboard.press('h');
await p.waitForTimeout(1200);
await pose(140, -30, 3);
await p.screenshot({ path: '/tmp/opencode/tail-wire.png' });
await p.keyboard.press('h');                        // hull back ON
await p.waitForTimeout(800);
// tail zoom from the +x side: pipes ON, then OFF — the pixels answer whether
// any cable is visible outside the skin (it must not be)
await pose(0, 0, 4);                                 // closer
await p.screenshot({ path: '/tmp/opencode/tail-pipes-on.png' });
await p.getByTestId('toggle-options').click();
await p.waitForTimeout(400);
const off = p.getByTestId('opt-pipes');
if (await off.count()) { await off.click(); await p.waitForTimeout(900); }
await p.screenshot({ path: '/tmp/opencode/tail-pipes-off.png' });
await b.close();
console.log('shots: /tmp/opencode/tail-{ghost,built,wire}.png');
