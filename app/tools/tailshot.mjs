// one-shot eyeball: build a tailed balloon through the live UI and shoot it
// (side view + top view). Not a suite — a look. node tools/tailshot.mjs [port]
import { chromium } from 'playwright';

const PORT = process.argv[2] ?? 5175;
const b = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
});
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
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
await p.screenshot({ path: '/tmp/opencode/tail-ghost.png' });
await p.getByTestId('place-build').click();
await p.getByTestId('tool-toast').waitFor({ timeout: 20_000 });
console.log('toast:', await p.locator('[data-testid="tool-toast"]').textContent());
await p.waitForFunction(() => !document.title.includes('BUILDING'), null, { timeout: 30_000 }).catch(() => {});
await p.waitForTimeout(2500);
await p.screenshot({ path: '/tmp/opencode/tail-built.png' });
// hide the hull to check the hidden cables + panels from inside
await p.keyboard.press('h');
await p.waitForTimeout(1200);
await p.screenshot({ path: '/tmp/opencode/tail-wire.png' });
await b.close();
console.log('shots: /tmp/opencode/tail-{ghost,built,wire}.png');
