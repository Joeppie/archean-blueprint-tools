// farm.test.ts — the COMPUTER FARM's shared io bus (v1.15.0 P9 slice C,
// REWRITE § P9): THE GAME LAW is that a channel belongs to the DEVICE —
// every computer wired to it reads the same value, the writing computer
// loopback included. The bus records the channel and fans the value into
// EVERY attached pump (acceptBusWrite → the VM's input table).
import { describe, expect, test } from 'vitest';
import { IoBus, type XenonPump } from '../xenoncode';

interface Rec { writes: [string, number, number][] }
const stub = (recs: Rec) =>
  ({ acceptBusWrite: (alias: string | number, ch: number, v: number) =>
      recs.writes.push([`${String(alias).toLowerCase()}:${ch}`, ch, v]) } as unknown as XenonPump);

describe('IoBus — the cable law', () => {
  test('one write reaches EVERY pump, the writer included', () => {
    const bus = new IoBus();
    const recs: Rec = { writes: [] };
    const a = stub(recs);
    const b = stub(recs);
    bus.attach(a); bus.attach(b);
    bus.write('lamp', 0, 1, a);
    expect(recs.writes).toEqual([['lamp:0', 0, 1], ['lamp:0', 0, 1]]);
    expect(bus.get('lamp', 0)).toBe(1);
    expect(bus.get('LAMP', 0)).toBe(1);        // the shim resolves case-insensitively
  });

  test('numbers fan out; text rows record only (beacon text rides beaconNet)', () => {
    const bus = new IoBus();
    const recs: Rec = { writes: [] };
    bus.attach(stub(recs));
    bus.write('lamp', 0, 'hello', stub({ writes: [] }));
    expect(recs.writes).toEqual([]);
    expect(bus.get('lamp', 0)).toBe('hello');  // visible to the bus tab
  });

  test('detach takes a pump off the cable', () => {
    const bus = new IoBus();
    const recs: Rec = { writes: [] };
    const a = stub(recs);
    bus.attach(a);
    bus.detach(a);
    bus.write('lamp', 0, 1, a);
    expect(recs.writes).toEqual([]);
  });

  test('snapshot keys are alias:ch (the bus-tab row shape)', () => {
    const bus = new IoBus();
    bus.write('Router', 3, 7, stub({ writes: [] }));
    expect(bus.snapshot()['router:3']).toBe(7);
  });
});
