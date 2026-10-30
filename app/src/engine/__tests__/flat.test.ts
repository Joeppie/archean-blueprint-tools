// flat.test.ts — THE FLATTENED-ENDPOINT LAW (v1.16.10, the Jimmy catch):
// data.pipes endpoints index the FLATTENED component array (nested
// content numbers BEFORE their Build — FORMAT §Subgrids). Jimmy's
// Adventure carries one Build (top index 6) with 4 nested parts: every
// endpoint past it is +4 off the top-level array. Un-mapped, his
// GIANTPLANE computer reads as UNPOWERED (its LV cable lands on the
// wrong parts) and the auto-boot leaves it off.
import { describe, expect, test } from 'vitest';
import { flatToTopMap, flatEndpointTop } from '../flat';
import { craftPowerNet, computerPowered } from '../power';
import { testdataText } from './harness';
import type { Blueprint } from '../format';

const jimmy = () => JSON.parse(testdataText('3334698274')!) as Blueprint;

describe('flatToTopMap — @Flat', () => {
  test("Jimmy's one Build shifts every endpoint past it by 4", () => {
    const m = flatToTopMap(jimmy());
    expect(m.length).toBe(263);                      // 259 top + 4 nested
    for (let i = 0; i < 6; i++) expect(m[i]).toBe(i);
    expect(m.slice(6, 10)).toEqual([null, null, null, null]);   // the nested 4
    expect(m[10]).toBe(6);                           // the Build itself
    expect(m[231]).toBe(227);                        // the shifted majority
    expect(flatEndpointTop(m, 7)).toBeUndefined();   // nested: not a top part
  });
  test('a Build-less craft maps identity', () => {
    const m = flatToTopMap(JSON.parse(testdataText('9000009040')!) as Blueprint);
    m.forEach((v, i) => expect(v).toBe(i));
  });
  test("Jimmy's computer sits on the RTG grid (the auto-boot gate)", () => {
    const bp = jimmy();
    const net = craftPowerNet(bp, null);
    expect(net.hasPower).toBe(true);
    const ci = (bp.data.components as { type: string }[]).findIndex(c => c.type === 'MiniComputer');
    expect(ci).toBe(96);
    expect(computerPowered(net, ci),
      'the LV chain 96→227→…→RTG reaches the grid (mapped; un-mapped it reads UNPOWERED)')
      .toBe(true);
    // Jimmy's drill IS cabled — on the HIGH-voltage net (HighVoltageJunction
    // → drill.highvoltage): the sim's drill RUNS at 100 kW / 100 rocks/s
    const drill = (bp.data.components as { type: string }[]).findIndex(c => c.type === 'MiningDrill');
    expect(computerPowered(net, drill)).toBe(true);
  });
});
