// energy.test.ts — THE POWER FLOW (v1.16.10 WP5, workpackages batch
// 2026-10-30/31): sources PRODUCE (wiki watts), consumers DRAW, the
// balance flows through BATTERIES which ALWAYS feed — charge integrates,
// drains, goes NEGATIVE (deep discharge) and keeps feeding: the deficit is
// a warning, never a blackout. Rates + gates: wiki/en/components/**.
// Fixture 9000009060 (tools/make_energy_test.py) = the ENERGY BENCH;
// Jimmy's Adventure (3334698274) = the real-craft census (a fixture
// cannot state "62 RTGs on one grid is absurd power" — data law, corpus).
import { describe, expect, test } from 'vitest';
import { EnergySim, fmtW } from '../energy';
import { craftPowerNet } from '../power';
import { testdataText } from './harness';
import type { Blueprint } from '../format';

const bench = () => JSON.parse(testdataText('9000009060')!) as unknown as Blueprint;

const simOf = (bp: Blueprint): EnergySim => {
  const e = new EnergySim();
  e.load(bp, craftPowerNet(bp, null));
  return e;
};

describe('the ENERGY BENCH census — @Energy', () => {
  test('wiki rates: solar 2700 + RTG 12 kW; the steam turbine rates 0 (no heat source)', () => {
    const s = simOf(bench()).state();
    expect(s.hasGrid).toBe(true);
    const src = (t: string) => s.sources.find(x => x.type === t)?.watts ?? 0;
    expect(src('SolarPanel')).toBe(2700);
    expect(src('RTG')).toBe(12_000);
    expect(src('DieselGenerator')).toBe(0);           // data-gated, OFF
    expect(src('SteamTurbine')).toBe(0);              // 27 MW gated on heat
    expect(s.productionW).toBe(14_700);
  });
  test('batteries: 10 kWh + 120 kWh seats, authored charged = FULL', () => {
    const s = simOf(bench()).state();
    expect(s.batteryCapacityWh).toBe(130_000);
    expect(s.batteryMinPct).toBe(100);
    expect(s.status).toBe('ok');
  });
  test('consumers: cpu 30 W; the lamp is OFF until its channel is; the HV-cabled drill rates 100 kW', () => {
    const e = simOf(bench());
    let s = e.state();
    const con = (t: string) => s.consumers.find(x => x.type === t)?.watts ?? 0;
    expect(con('MiniComputer')).toBe(30);
    expect(con('Lamp')).toBe(0);                      // ch0 unwritten = off
    expect(con('MiningDrill')).toBe(100_000);         // HV net licence (wiki)
    // anchors draw nothing (not in the consumer census at all)
    expect(s.consumers.find(x => x.type === 'GroundAnchor')).toBeUndefined();
    e.write(7, 0, 1);                                 // lamp on
    s = e.state();
    expect(s.consumers.find(x => x.type === 'Lamp')?.watts).toBe(1000);  // authored maxPower
  });
});

describe('the battery flow — @Energy', () => {
  test('a deficit drains the pack, cell by cell, and the grid KEEPS FEEDING', () => {
    const e = simOf(bench());
    // 100 kW of demand against 14.7 kW of sun: −85.3 kW. Step 3600 s.
    e.write(7, 0, 1);                                 // lamp joins the bill
    for (let i = 0; i < 25 * 3600; i++) e.step(0.04);
    const s = e.state();
    // 85.3 kW · 1 h = 85.3 Wh… from 130 kWh the pack sits ~34.5% low
    expect(s.surplusW).toBeLessThan(-80_000);
    expect(s.batteryWh).toBeLessThan(130_000 - 80_000);
    expect(s.status).toBe('ok');                      // deep pack: still fine
    // the WARNING law: reachability (power.ts) never changed — a
    // flat battery does not un-power the cpu: the law is the chip.
  });
  test('deep discharge goes NEGATIVE and warns — never a blackout', () => {
    const e = simOf(bench());
    // run the pack to death: 130 kWh @ ~86 kW ≈ 1.5 h; push 4 h
    e.write(7, 0, 1);
    for (let i = 0; i < 25 * 4 * 3600; i++) e.step(0.04);
    const s = e.state();
    expect(s.drained).toBeGreaterThan(0);             // cells below zero
    expect(s.batteryWh).toBe(0);                      // no readable charge
    expect(s.status).toBe('deficit');                 // the red warning
    // …and the demand keeps counting (the sim never blacked out parts):
    expect(s.demandW).toBeGreaterThan(100_000);
  });
  test('firing the diesel generator (data ch0) flips the flow to CHARGING', () => {
    const e = simOf(bench());
    e.write(7, 0, 1);
    for (let i = 0; i < 25 * 3600; i++) e.step(0.04);  // 1 h of deficit
    expect(e.state().batteryMinPct).toBeLessThan(60);
    e.write(2, 0, 1);                                 // generator ON: +150 kW
    for (let i = 0; i < 25 * 14_400; i++) e.step(0.04);
    const s = e.state();
    expect(s.batteryMinPct).toBeGreaterThan(90);      // recovery (cap FULL)
    expect(s.batteryWh).toBeLessThanOrEqual(s.batteryCapacityWh);
  });
  test('charge caps at capacity — no perpetual overcharge', () => {
    const bp = bench();
    // sun + RTG + pack only: strip the heavy consumers (the drill runs
    // while anchored, its 100 kW would eat the sun for breakfast)
    (bp.data as { components: { type: string }[] }).components =
      (bp.data as { components: { type: string }[] }).components.filter(c =>
        !['MiningDrill', 'GroundAnchor', 'Lamp'].includes(c.type));
    const e = simOf(bp);
    for (let i = 0; i < 25 * 86_400; i++) e.step(0.04);   // a day of sun
    expect(e.state().batteryWh).toBe(e.state().batteryCapacityWh);
  });
  test('a grid-less craft is energy-UNAWARE (the dev-craft convention)', () => {
    const bp = bench();
    const data = bp.data as { components: { type: string }[]; pipes: unknown[] };
    const keep = data.components.filter(c =>
      !['SolarPanel', 'RTG', 'DieselGenerator', 'SteamTurbine',
        'LowVoltageBattery', 'HighVoltageBattery'].includes(c.type));
    data.components = keep;
    const e = simOf(bp);
    expect(e.state().hasGrid).toBe(false);
  });
});

describe('Jimmy’s Adventure rides the grid — @slow', () => {
  test('62 RTGs, 5 HV batteries, the anchored drill: the census is sane', () => {
    const bp = JSON.parse(testdataText('3334698274')!) as unknown as Blueprint;
    const e = simOf(bp);
    const s = e.state();
    expect(s.hasGrid).toBe(true);
    const rtg = s.sources.find(x => x.type === 'RTG');
    expect(rtg?.count).toBe(62);
    expect(rtg?.watts).toBe(62 * 12_000);
    expect(s.batteryCapacityWh).toBe(5 * 120_000);
    // the mosaic: 130 dashboards × 20 W, buttons/lamps off-cycles included —
    // the 744 kW of RTGs keeps Jimmy in the green with the drill RUNNING
    expect(s.productionW).toBeGreaterThanOrEqual(62 * 12_000);
    expect(s.status === 'ok' || s.status === 'charging').toBe(true);
  });
});

describe('fmtW', () => {
  test('human wattage', () => {
    expect(fmtW(940)).toBe('940 W');
    expect(fmtW(12_000)).toBe('12.0 kW');
    expect(fmtW(150_000)).toBe('150 kW');
    expect(fmtW(27_000_000)).toBe('27.0 MW');
  });
});
