// cpuprofile.mjs — CPU-profile the boot window (navStart → SCENE PASS) and
// print the hottest self-time functions. Diagnostic for the bootprobe phases.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const URL = process.argv[2] ?? 'http://127.0.0.1:5188';
const craft = process.argv[3] ?? '9000005001';
const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => { localStorage.setItem('archean-app-debug', '1'); localStorage.setItem('archean-app-backdrop', 'none'); });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
await page.goto(`${URL}/?craft=${craft}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 120_000 });
const { profile } = await cdp.send('Profiler.stop');
writeFileSync('/tmp/opencode/boot.cpuprofile', JSON.stringify(profile));
const byId = new Map(profile.nodes.map(n => [n.id, n]));
const self = new Map();
for (let i = 1; i < profile.samples.length; i++) {
  const dt = profile.timeDeltas[i] ?? 0;
  const n = byId.get(profile.samples[i]);
  if (!n) continue;
  const f = n.callFrame;
  const key = `${f.functionName || '(anon)'}  ${(f.url || '').replace(/^https?:\/\/[^/]+\/(assets\/)?/, '').replace(/(\?|#).*$/, '')}:${f.lineNumber}`;
  self.set(key, (self.get(key) ?? 0) + dt);
}
const total = profile.endTime - profile.startTime;
const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
console.log(`boot profile ${craft}: ${(total / 1e6).toFixed(0)} ms sampled`);
for (const [k, us] of top) console.log(`${String(Math.round(us / 1000)).padStart(5)} ms  ${k}`);
await browser.close();
