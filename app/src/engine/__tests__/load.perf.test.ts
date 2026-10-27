// load.perf.test.ts — P4 LOAD-PATH perf baseline (REWRITE.md §WASM candidates).
// Times the ranked hot loops on REAL corpus crafts so a WASM port is adopted
// only where it measures >2× (the REWRITE bar), and so a regression shows up
// as a growing number in the report. Run with:  npx vitest run load.perf
// Assertions are LOOSE upper bounds (anti-regression tripwires at ~4× the
// measured baseline); the fine-grained numbers print to the console and are
// transcribed into PERF.md.
//
// QUIESCENT-ONLY (v1.12.7): a wall-clock tripwire measures LOAD, not code —
// the v1.12.7 ladder flaked 1.49×/1.26× when this harness ran INSIDE the
// parallel default gate (npm test fires every worker at the box). The file
// therefore MEASURES only when invoked explicitly (PERF_HARNESS=1 npx
// vitest run load.perf) and SKIP-REPORTS in the gate, where the
// correctness pins of the same loops live (sealwasm.test.ts parity,
// stitch.test.ts, …).
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, test } from 'vitest';
import { buildFaceGrid, culledBlocksSolids } from '../cull';
import { sealedEnvelopeJS, sealedEnvelopeVolume } from '../atmo';
import { initSealWasmBytes, sealWasmReady } from '../sealwasm';
import { buildTunnel, createSolve, solveStep } from '../aero';
import { blockTwinIssues, twinConflictCensus } from '../blocks';
import { sphereSkinTris } from '../latsphere';
import type { Blueprint, Triangle } from '../format';

const REPO = new URL('../../../../', import.meta.url).pathname;   // committed corpus
const bp = (id: string): Blueprint =>
  JSON.parse(readFileSync(`${REPO}testdata/${id}/blueprint.json`, 'utf8')) as Blueprint;

/** Run `fn` at least 3 times / until `budget` ms, report the MEDIAN ms. */
function time(fn: () => unknown, budget = 350): number {
  fn(); fn();                                            // warm up (JIT)
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

const rows: [string, number][] = [];
const bench = (name: string, fn: () => unknown, budget = 350) => {
  const med = time(fn, budget);
  rows.push([name, med]);
  return med;
};

let giant: Blueprint, truck: Blueprint, gantry: Blueprint, isw: Blueprint;
let zeppelin: Triangle[];

beforeAll(() => {
  giant = bp('3509975859');   // 6.3 MB, 9 656 block records
  truck = bp('3481322297');   // semi-truck
  gantry = bp('3732302108');
  isw = bp('3812927875');
  // a shipped-size zeppelin skin (the balloon tool's envelope): the
  // LiftWidget recomputes sealedEnvelopeVolume on EVERY rev of a skin build
  initSealWasmBytes(readFileSync(new URL('../../../wasm/seal.wasm', import.meta.url)));
  zeppelin = sphereSkinTris(
    { rx: 4, ry: 4, rz: 15, profile: 'cylinder', shoulder: 0.55 },
    { slot: 51 },
  );
});

const QUIESCENT = process.env.PERF_HARNESS === '1';

describe.skipIf(!QUIESCENT)('load-path perf baseline (WASM candidate loops)', () => {
  test('candidate 1 — hull cull + stitch (culledBlocksSolids)', () => {
    const g = bench('culledBlocksSolids giant (9656 block records)',
      () => culledBlocksSolids(giant.data.blocks, null, true));
    const fg = bench('  buildFaceGrid giant (face-census half)',
      () => buildFaceGrid(giant.data.blocks, null, true));
    const t = bench('culledBlocksSolids truck (1033 records)',
      () => culledBlocksSolids(truck.data.blocks, null, true));
    expect(g).toBeLessThan(400);                          // 4× the baseline
    expect(fg).toBeLessThan(g);                           // census < whole
    expect(t).toBeLessThan(80);
  });

  test('candidate 3 — sealed envelope (per-rev LiftWidget recompute)', () => {
    expect(sealWasmReady(), 'wasm/seal.wasm built (npm run build:wasm)').toBe(true);
    // The JS twin is MEASURED for the report (the wasm/JS ratio is what
    // DECIDED the adoption in v1.11.2 — an adoption criterion, not a
    // standing law: a ratio between two engines measures the environment,
    // and the v1.12.7 ladder showed how flaky that is in a suite). The
    // regression tripwire is the ABSOLUTE bound (~4× the wasm baseline,
    // this file's stated philosophy); the wasm/JS pair prints to PERF.
    const gj = bench('sealedEnvelope JS twin giant (9656 blocks)',
      () => sealedEnvelopeJS(giant.data.triangles ?? [], giant.data.blocks));
    const g = bench('sealedEnvelope WASM giant',
      () => sealedEnvelopeVolume(giant.data.triangles ?? [], giant.data.blocks));
    const z = bench(`sealedEnvelope WASM zeppelin skin (${zeppelin.length} tris)`,
      () => sealedEnvelopeVolume(zeppelin, []));
    rows.push([`  (adoption context: wasm is ${(gj / g).toFixed(1)}× the JS twin)`, 0]);
    expect(g).toBeLessThan(400);                            // ~4× the 85-120 ms baseline
    expect(z).toBeLessThan(800);
  });

  test('wind tunnel — buildTunnel + 30 solveSteps', () => {
    bench('buildTunnel giant', () => buildTunnel(giant, [0, 0, -1]));
    const s = bench('buildTunnel ISW + 30 solveSteps', () => {
      const tun = buildTunnel(isw, [0, 0, -1])!;
      const sv = createSolve(tun);
      for (let i = 0; i < 30; i++) solveStep(sv, 4);
      return sv;
    });
    expect(s).toBeLessThan(1200);
  });

  test('build-dock census twin sweep (useBlockCensus, per rev)', () => {
    // the v1.10.6 sweep (blockTwinIssues per non-255 block, O(n²)) vs the
    // v1.11.2 indexed twinConflictCensus — counts equal (pinned in
    // blocks.test), the indexed one must clear the naive by 2×+
    const naive = (b: Blueprint, cap = 800) => {
      const bl = b.data.blocks;
      let conflicts = 0, seen = 0;
      for (let i = 0; i < bl.length && seen < cap; i++) {
        if (bl[i]!.type === 255) continue;
        seen++;
        const t = blockTwinIssues(b, i, 'x');
        if (t?.issues.length && !t.info) conflicts++;
      }
      return conflicts;
    };
    bench('twin sweep NAIVE truck (800-cap slice)', () => { naive(truck); });
    const g = bench('twin census INDEXED gantry (105 records)',
      () => twinConflictCensus(gantry, 'x'));
    const t = bench('twin census INDEXED truck', () => twinConflictCensus(truck, 'x'));
    const gi = bench('twin census INDEXED giant (9656 records)',
      () => twinConflictCensus(giant, 'x'));
    expect(g).toBeLessThan(4);
    expect(t).toBeLessThan(12);
    expect(gi).toBeLessThan(40);
    // (the naive-vs-indexed ratio is printed for context — the v1.11.2
    // adoption criterion, not a standing law; the ABSOLUTE bounds above
    // are the regression tripwire, counts parity is pinned in blocks.test)
  });

  test('report', () => {
    for (const [name, ms] of rows) console.log(`PERF ${name}: ${ms.toFixed(2)} ms`);
    expect(rows.length).toBeGreaterThan(0);
  });
});
