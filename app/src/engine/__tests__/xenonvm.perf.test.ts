// xenonvm.perf.test.ts — THE SCREEN-WRITE PATH bench (v1.16.8, PERF.md):
// times, on the REAL wasm, what a XenonCode program costs per 25 Hz cycle
// when it WRITES screens (blank/write/draw_rect/draw_line/draw_circle at
// the game's real surface sizes), the idle-cycle floor, and the app-side
// pixel COPY (XenonRun.screenPixels — the pump does exactly this per
// VISIBLE surface per cycle). The numbers drive the optimization landing
// and land in PERF.md as the baseline.
//
// QUIESCENT-ONLY (the v1.12.7 load.perf law): measures ONLY under
// `PERF_HARNESS=1 npx vitest run xenonvm.perf`; SKIP-REPORTS in the gate.
import { describe, expect, test } from 'vitest';
import { bootSynthetic, bootVm } from './vmharness';

const HARNESS = !!process.env.PERF_HARNESS;
const rows: [string, number][] = [];

/** median ms of `fn` over >=3 runs / ~budget ms (the load.perf.time shape). */
function time(fn: () => unknown, budget = 300): number {
  fn(); fn();
  const ts: number[] = [];
  const t0 = performance.now();
  do {
    const a = performance.now();
    fn();
    ts.push(performance.now() - a);
  } while (performance.now() - t0 < budget);
  ts.sort((x, y) => x - y);
  return ts[ts.length >> 1]!;
}

const prog = (body: string) => [
  'var $s = screen("bench", 0)',
  'init',
  '\t$s.blank(color(0,0,40,255))',
  'update',
  body.replace(/^(?!$)/gm, '\t'),      // indent the body into the update block
].join('\n');

/** run n cycles with the pump, return median ms/cycle. */
async function cycleMs(code: string, w: number, h: number, n = 40): Promise<number> {
  const vm = await bootSynthetic(code, w, h).catch((e: Error) => {
    console.log('BOOTFAIL', JSON.stringify(code), '\n', e.message);
    throw e;
  });
  vm.step(5);                                           // warm the JIT + first paint
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    vm.step(n);
    samples.push((performance.now() - t0) / n);
  }
  samples.sort((x, y) => x - y);
  return samples[samples.length >> 1]!;
}

describe.skipIf(!HARNESS)('screen-write path (real wasm)', () => {
  test('the write-op census', async () => {
    const SMALL = [200, 160] as const;                  // the Computer panel
    const DASH = [870, 390] as const;                   // 3381670618's dashboard
    const BIG = [640, 480] as const;                    // the plain default

    rows.push(['idle cycle (no writes)',
      await cycleProg(prog('var $x = 0\n$x += 1'), SMALL)]);
    rows.push(['blank 200x160 opaque',
      await cycleProg(prog('$s.blank(color(10,20,30,255))'), SMALL)]);
    rows.push(['blank 200x160 alpha128',
      await cycleProg(prog('$s.blank(color(10,20,30,128))'), SMALL)]);
    rows.push(['write x20 (text rows)',
      await cycleProg(prog([
        'var $i = 0',
        'while $i < 20',
        '\t$s.write(4, $i * 8, cyan, "Speed 123 km/h  Alt 2450 m")',
        '\t$i += 1',
      ].join('\n')), SMALL)]);
    rows.push(['draw_rect fill 100x',
      await cycleProg(prog([
        'var $i = 0',
        'while $i < 100',
        '\t$s.draw_rect(0, $i * 2, 120, $i * 2 + 8, color(40,90,160,255), 1)',
        '\t$i += 1',
      ].join('\n')), SMALL)]);
    rows.push(['draw_line 50x',
      await cycleProg(prog([
        'var $i = 0',
        'while $i < 50',
        '\t$s.draw_line(0, 0, 120 + $i, 150, cyan)',
        '\t$i += 1',
      ].join('\n')), SMALL)]);
    rows.push(['draw_circle fill 20x',
      await cycleProg(prog([
        'var $i = 0',
        'while $i < 20',
        '\t$s.draw_circle(60 + $i * 3, 80, 30, color(200,120,40,255), 1)',
        '\t$i += 1',
      ].join('\n')), SMALL)]);
    rows.push(['blank 870x390 opaque',
      await cycleProg(prog('$s.blank(color(10,20,30,255))'), DASH)]);
    rows.push(['blank 640x480 alpha128',
      await cycleProg(prog('$s.blank(color(10,20,30,128))'), BIG)]);
    rows.push(['BADGER full firmware cycle', await badgerCycle()]);
    const chg = await badgerChangeRate();
    rows.push(['BADGER surfaces CHANGING per cycle', chg[0]]);
    rows.push(['BADGER surface count (denominator)', chg[1]]);
    const fetchPair = await badgerFetchPair();
    rows.push(['BADGER pump fetch 100 cyc ALWAYS (pre-v1.16.8)', fetchPair[0]]);
    rows.push(['BADGER pump fetch 100 cyc VERSION-SKIP', fetchPair[1]]);

    // the app-side copy the PUMP pays per visible surface per cycle
    const runVm = await bootSynthetic(prog('$s.blank(color(1,2,3,255))'), 870, 390);
    runVm.step(3);
    rows.push(['screenPixels copy 870x390 (1.36 MB)', time(() => runVm.run.screenPixels('bench#0'))]);
    const big = await bootSynthetic(prog('$s.blank(color(1,2,3,255))'), 640, 480);
    big.step(3);
    rows.push(['screenPixels copy 640x480 (1.23 MB)', time(() => big.run.screenPixels('bench#0'))]);

    for (const [k, v] of rows) console.log(`  ${k.padEnd(42)} ${v.toFixed(3)} ms`);
    // anti-regression tripwires (LOOSE ~6x the v1.16.8 measured baseline)
    const m = new Map(rows);
    expect(m.get('idle cycle (no writes)')!, 'idle cycle').toBeLessThan(0.6);
    expect(m.get('blank 200x160 opaque')!, 'blank opaque').toBeLessThan(2.0);
    expect(m.get('write x20 (text rows)')!, 'text rows').toBeLessThan(2.5);
    expect(m.get('blank 870x390 opaque')!, 'blank dash').toBeLessThan(6.0);
    expect(m.get('BADGER full firmware cycle')!, 'badger cycle').toBeLessThan(30);
    expect(m.get('screenPixels copy 870x390 (1.36 MB)')!, 'pixels copy').toBeLessThan(6.0);
  }, 240_000);
});

async function cycleProg(code: string, [w, h]: readonly [number, number]): Promise<number> {
  return cycleMs(code, w, h);
}

/** Of the Badger's surfaces, how many PIXELS actually change in a cycle
 *  (the change-rate the version-skip blit keys on): djb2 over 64-byte
 *  samples of each surface's pixels, per cycle, over 40 cycles. */
async function badgerChangeRate(): Promise<[number, number]> {  const vm = await bootVm('3326372833');
  for (let c = 0; c < 2000; c += 20) {
    vm.step(20);
    if (vm.events.some(e => e.e === 'print' && String(e.v).includes('Smart Quad is ready'))) break;
  }
  const metas = vm.run.screenMeta();
  const hash = (k: string): number => {
    const px = vm.run.screenPixels(k);
    if (!px) return 0;
    let h = 5381;
    for (let i = 0; i < px.length; i += 64) h = ((h << 5) + h + px[i]!) | 0;
    return h;
  };
  const prev = new Map<string, number>();
  for (const m of metas) prev.set(m.key, hash(m.key));
  let changed = 0;
  const cycles = 40;
  for (let c = 0; c < cycles; c++) {
    vm.step(1);
    for (const m of metas) {
      const h = hash(m.key);
      if (h !== prev.get(m.key)) changed++;
      prev.set(m.key, h);
    }
  }
  return [changed / cycles, metas.length];
}

async function badgerCycle(): Promise<number> {
  const vm = await bootVm('3326372833');
  for (let c = 0; c < 2000; c += 20) {
    vm.step(20);
    if (vm.events.some(e => e.e === 'print' && String(e.v).includes('Smart Quad is ready'))) break;
  }
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    vm.step(40);
    samples.push((performance.now() - t0) / 40);
  }
  samples.sort((x, y) => x - y);
  return samples[samples.length >> 1]!;
}

/** Simulate the pump's per-cycle pixel fetch over the Badger's VISIBLE
 *  surfaces (the dock's 17 Dashboards-tab keys) for 100 cycles, once
 *  ALWAYS (pre-v1.16.8) and once with the ABI-15 version gate: the pair of
 *  totals IS the blit-skip win, on node with the same calls the pump makes. */
async function badgerFetchPair(): Promise<[number, number]> {
  const mk = async () => {
    const vm = await bootVm('3326372833');
    for (let c = 0; c < 2000; c += 20) {
      vm.step(20);
      if (vm.events.some(e => e.e === 'print' && String(e.v).includes('Smart Quad is ready'))) break;
    }
    const keys = vm.run.screenMeta()
      .map(m => m.key)
      .filter(k => !k.startsWith('virtual#') && !k.startsWith('main#'))
      .slice(0, 17);
    return { vm, keys };
  };
  const a = await mk();
  const tA = performance.now();
  for (let c = 0; c < 100; c++) {
    a.vm.step(1);
    for (const k of a.keys) a.vm.run.screenPixels(k);
  }
  const always = performance.now() - tA;
  const b = await mk();
  const seen = new Map<string, number>();
  const tB = performance.now();
  for (let c = 0; c < 100; c++) {
    b.vm.step(1);
    for (const k of b.keys) {
      const v = b.vm.run.screenVersion(k);
      if (v >= 0 && seen.get(k) === v) continue;
      if (b.vm.run.screenPixels(k)) seen.set(k, v);
    }
  }
  return [always, performance.now() - tB];
}
