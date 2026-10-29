// farm.test.ts — the COMPUTER FARM's shared io bus (v1.15.0 P9 slice C,
// REWRITE § P9): THE GAME LAW is that a channel belongs to the DEVICE —
// every computer wired to it reads the same value, the writing computer
// loopback included. The bus records the channel and fans the value into
// EVERY attached pump (acceptBusWrite → the VM's input table).
import { describe, expect, test } from 'vitest';
import { IoBus, XenonPump } from '../xenoncode';

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

// v1.15.2 (we: "the sound is slightly clickier in super mario"): the pump-
// side fan-in is COALESCED — the Cable Law's per-event delivery reaches the
// VM as one setInput per (channel, ch) at the next cycle boundary (between
// cycles the VM samples inputs once, so only the last value per channel is
// observable; the per-event alias marshal was the farm hot-loop cost).
describe('XenonPump — the coalesced fan-in (v1.15.1)', () => {
  const pumpWithSpy = () => {
    const p = new XenonPump();
    const writes: [string | number, number, number][] = [];
    (p as unknown as { run: unknown }).run = {
      setInput: (io: string | number, ch: number, v: number) => writes.push([io, ch, v]),
    };
    return { p, writes };
  };
  const flush = (p: XenonPump) =>
    (p as unknown as { flushBus: () => void }).flushBus();

  test('last value per channel wins; one VM write per (channel, ch)', () => {
    const { p, writes } = pumpWithSpy();
    p.acceptBusWrite('Lamp', 0, 1);
    p.acceptBusWrite('lamp', 0, 2);
    p.acceptBusWrite('lamp', 1, 500);
    p.acceptBusWrite(7, 0, 3);
    flush(p);
    expect(writes).toEqual([['lamp', 0, 2], ['lamp', 1, 500], [7, 0, 3]]);
  });

  test('flush drains the pending map — the next cycle starts clean', () => {
    const { p, writes } = pumpWithSpy();
    p.acceptBusWrite('lamp', 0, 1);
    flush(p);
    flush(p);
    expect(writes.length).toBe(1);
  });

  test('IoBus fan-out per write is UNCHANGED (coalescing lives pump-side)', () => {
    const bus = new IoBus();
    const recs: Rec = { writes: [] };
    const a = stub(recs);
    bus.attach(a);
    bus.write('lamp', 0, 1, a);
    bus.write('lamp', 0, 2, a);
    expect(recs.writes.length).toBe(2);   // per-event law intact
  });
});
