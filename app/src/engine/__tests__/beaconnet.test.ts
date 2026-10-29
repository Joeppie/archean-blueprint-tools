// beaconnet.test.ts — the GLOBAL beacon-radio registry (v1.14.0 P9 slice A,
// REWRITE § P9; FORMAT §HUD & the Beacon radio + §Player-installed HUDs).
// Pure tier: the registry is plain TS — no browser, no pump.
import { describe, expect, test } from 'vitest';
import { beaconCalls, beaconNet } from '../beaconnet';
import { xenonHudControllers } from '../xenoncode';
import type { Blueprint } from '../../engine/format';

const bpWith = (components: unknown[]) => ({ data: { components } } as unknown as Blueprint);

describe('beaconCalls — the source scan', () => {
  test('text AND numeric frequencies; quoted strings keep content', () => {
    expect(beaconCalls('var $b = beacon("RCS-500-HUD-RECEIVE","RCS-500-HUD-SEND")'))
      .toEqual([{ tx: 'RCS-500-HUD-RECEIVE', rx: 'RCS-500-HUD-SEND' }]);
    expect(beaconCalls('var $beacon = beacon(5,5664)'))
      .toEqual([{ tx: '5', rx: '5664' }]);
  });
  test('variable arguments are NOT known frequencies (no literals)', () => {
    expect(beaconCalls('beacon($a, "X")')).toEqual([]);
  });
});

describe('beaconNet — the global scope', () => {
  const bp = bpWith([
    { type: 'Beacon', alias: 'drill-beacon',
      data: { transmitFrequency: 'F-TX', receiveFrequency: 'F-RX', transmitData: '.a{1}' } },
    { type: 'Beacon', alias: 'listener',
      data: { transmitFrequency: '', receiveFrequency: 'F-TX', transmitData: '' } },
    { type: 'HudController', alias: 'pilot-guide',
      data: { version: 1, xc_files: [{ name: 'main.xc', plain_code: 'var $b = beacon("F-TX","HUD-RX")' }] } },
    { type: 'MiniComputer', alias: 'fc',
      data: { program: 'fc', hdd: { xc_files: [{ name: 'fc.main.xc', plain_code: 'var $x = beacon("CMP","F-RX")' }] } } },
  ]);

  test('seed registers beacon components + beacon() literals from HUD and computer programs', () => {
    beaconNet.seed(bp);
    const ids = beaconNet.participants().map(p => p.id).sort();
    expect(ids).toEqual(expect.arrayContaining([
      'beacon:0', 'beacon:1', 'computer:3#0', 'hud:2#0', 'user']));
    expect(beaconNet.freqs()).toEqual(
      ['CMP', 'F-RX', 'F-TX', 'HUD-RX'].sort((a, b) => a.localeCompare(b)));
  });

  test('sendTo delivers to every listener of that frequency, logs both sides', () => {
    beaconNet.seed(bp);
    beaconNet.clearLogs();
    const n = beaconNet.sendTo('F-RX', '.use{-40}');
    expect(n).toBe(2);      // beacon:0 AND the computer's beacon("CMP","F-RX")
    const b0 = beaconNet.participants().find(p => p.id === 'beacon:0')!;
    expect(b0.rxLog[0]).toMatchObject({ from: 'you', data: '.use{-40}' });
    const cmp = beaconNet.participants().find(p => p.id === 'computer:3#0')!;
    expect(cmp.rxLog[0]!.data).toBe('.use{-40}');       // program beacons are LISTENERS too
    expect(beaconNet.outbox[0]!.data).toBe('.use{-40}');
  });

  test('post(fromId) routes on the SENDER tx frequency (slice-B seam)', () => {
    beaconNet.seed(bp);
    beaconNet.clearLogs();
    const n = beaconNet.post('hud:2#0', 'ping');       // hud tx = F-TX
    expect(n).toBe(1);                                // beacon:1 listens on F-TX
    const b1 = beaconNet.participants().find(p => p.id === 'beacon:1')!;
    expect(b1.rxLog[0]!.from).toContain('pilot-guide');
    const hud = beaconNet.participants().find(p => p.id === 'hud:2#0')!;
    expect(hud.lastTx).toBe('ping');
  });

  test('re-seeding replaces the craft scope; the user transcript survives', () => {
    beaconNet.seed(bp);
    beaconNet.sendTo('F-RX', 'kept');
    beaconNet.seed(bpWith([{ type: 'Beacon', alias: 'solo',
      data: { transmitFrequency: '', receiveFrequency: 'ONLY' } }]));
    const ids = beaconNet.participants().map(p => p.id);
    expect(ids.filter(i => i.startsWith('beacon:'))).toEqual(['beacon:0']);
    expect(ids).toContain('user');
    expect(beaconNet.outbox[0]!.data).toBe('kept');
  });

  test('rx ring caps at 50 entries (flood the loop)', () => {
    beaconNet.seed(bp);
    beaconNet.clearLogs();
    for (let i = 0; i < 60; i++) beaconNet.sendTo('F-RX', `m${i}`);
    const b0 = beaconNet.participants().find(p => p.id === 'beacon:0')!;
    expect(b0.rxLog.length).toBe(50);
    expect(b0.rxLog[0]!.data).toBe('m59');              // newest first
  });

  test('a re-seed (every save) re-attaches the radio history by id', () => {
    beaconNet.seed(bp);
    beaconNet.clearLogs();
    beaconNet.sendTo('F-RX', 'before-save');
    beaconNet.seed(bp);                                  // the save tick
    const b0 = beaconNet.participants().find(p => p.id === 'beacon:0')!;
    expect(b0.rxLog[0]!.data).toBe('before-save');
  });

  test('deliveries QUEUE per participant for the runtime to drain (slice D)', () => {
    beaconNet.seed(bp);
    beaconNet.clearLogs();
    beaconNet.sendTo('F-RX', 'q1');
    beaconNet.sendTo('F-RX', 'q2');
    expect(beaconNet.takePending('beacon:0')).toEqual(['q1', 'q2']);
    expect(beaconNet.takePending('beacon:0')).toEqual([]);   // drained
    expect(beaconNet.takePending('beacon:1')).toEqual([]);   // not a listener
  });

  test('postDevice routes a component beacon transmission', () => {
    beaconNet.seed(bp);
    beaconNet.clearLogs();
    const n = beaconNet.postDevice(0, '.pos{1}');           // beacon 0 tx = F-TX
    expect(n).toBe(1);                                      // beacon:1 rx = F-TX
    const b1 = beaconNet.participants().find(p => p.id === 'beacon:1')!;
    expect(b1.rxLog[0]!.data).toBe('.pos{1}');
    const b0 = beaconNet.participants().find(p => p.id === 'beacon:0')!;
    expect(b0.lastTx).toBe('.pos{1}');
  });

  test('pendingSince feeds every pump its own cursor (slice C: a beacon wired to two computers)', () => {
    beaconNet.seed(bp);
    beaconNet.clearLogs();
    beaconNet.sendTo('F-RX', 'a');                      // beacon:0 listens on F-RX
    const r1 = beaconNet.pendingSince('beacon:0', 0);
    expect(r1.items).toEqual(['a']);
    beaconNet.sendTo('F-RX', 'b');
    const r2 = beaconNet.pendingSince('beacon:0', r1.seq);   // this pump: new only
    expect(r2.items).toEqual(['b']);
    const r3 = beaconNet.pendingSince('beacon:0', 0);        // a SISTER pump: all
    expect(r3.items).toEqual(['a', 'b']);
    expect(beaconNet.pendingSince('beacon:99', 0).items).toEqual([]);
  });

  test('registerPair adds runtime-announced radios and MERGES by id', () => {
    beaconNet.seed(bp);
    beaconNet.registerPair('hud:2#0', 'HUD pilot-guide · beacon', 'hud', 2,
      'NEW-TX', 'NEW-RX');
    const h = beaconNet.participants().find(p => p.id === 'hud:2#0')!;
    expect([h.tx, h.rx]).toEqual(['NEW-TX', 'NEW-RX']);     // runtime wins
    beaconNet.registerPair('hud:2#0', 'HUD pilot-guide · beacon', 'hud', 2, '', '');
    expect(h.tx).toBe('NEW-TX');                            // blanks never wipe
  });
});

describe('xenonHudControllers — the HUD blocks', () => {
  test('lists HudControllers with their program files; ignores the rest', () => {
    const huds = xenonHudControllers(bpWith([
      { type: 'HudController', alias: 'pilot-guide',
        data: { version: 1, xc_files: [{ name: 'main.xc', plain_code: 'init' },
          { name: 'parse.xc', plain_code: 'function @p' }] } },
      { type: 'MiniComputer', alias: 'fc', data: { hdd: { xc_files: [] } } },
      { type: 'HudController', data: {} },
    ]));
    expect(huds.map(h => [h.alias, h.files.length])).toEqual([['pilot-guide', 2], ['hud-2', 0]]);
  });
});
