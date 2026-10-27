import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan',
    '--enable-devtools-experiments', '--trace-lifetime-memory-dump=false'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => { localStorage.setItem('archean-app-debug', '1'); localStorage.setItem('archean-app-backdrop', 'none'); });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const chunks = [];
cdp.on('Tracing.dataCollected', ({ value }) => chunks.push(...value));
await cdp.send('Tracing.start', {
  categories: 'devtools.timeline,v8,blink,cc,benchmark,rail,disabled-by-default-v8.cpu_profiler',
  transferMode: 'ReportEvents',
});
await page.goto(process.argv[2] ?? 'http://127.0.0.1:5188/?craft=9000005001', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 60_000 });
const done = new Promise(r => cdp.once('Tracing.tracingComplete', r));
await cdp.send('Tracing.end');
await done;
writeFileSync('/tmp/opencode/boot-trace.json', JSON.stringify(chunks));
console.log('trace events:', chunks.length);
await browser.close();
