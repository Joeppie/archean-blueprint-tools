// pilotbuzzer.test.ts — v1.13.2 laws, pure tier:
// (1) the PILOT-KEY mapping (we: "WASD, up, down, and F … as inputs into the
//     computer for all cockpit connections it has") — the game's PilotSeat
//     channel words (wiki PilotSeat.md) drive the keys, signs are the
//     stick's, and XenonPump.pilotKey drives every bound row (multi-seat).
// (2) THE BUZZER LAW (wiki Buzzer.md): Amplitude ch 0 / Frequency Hz ch 1,
//     bus keys are the program's RAW target (alias verbatim, io as number),
//     silent-when-unwritten, 440 default, 0..1 / 20000 clamps.
import { describe, expect, it } from 'vitest';
import { PILOT_KEYS, XenonPump } from '../xenoncode';
import { buzzerReadings, voiceGain, BuzzerAudio } from '../buzzer';
import { wsLoad, wsChans } from '../worldsim';

describe('THE PILOT-KEY LAW (WASD/↑↓/F → PilotSeat channels)', () => {
  it('maps the game\'s own PilotSeat channel words, stick-signed', () => {
    expect(PILOT_KEYS['backward/forward']).toEqual({ w: 1, s: -1 });
    expect(PILOT_KEYS['left/right']).toEqual({ d: 1, a: -1 });
    expect(PILOT_KEYS['down/up']).toEqual({ up: 1, down: -1 });
    expect(PILOT_KEYS['roll']).toEqual({ e: 1 });              // E = Mario's FIRE key (ch 5)
    expect(PILOT_KEYS['aux 1']).toEqual({ f: 1, space: 1 });   // F and SPACE, one action button
    expect(PILOT_KEYS['using']).toBeUndefined();          // seat occupancy: no key
    expect(PILOT_KEYS['main thrust']).toBeUndefined();    // W is the stick, not the throttle
  });

  it('pilotKey drives EVERY bound row (all cockpit connections), press ±1, release centers 0', () => {
    // a pump with bindings for TWO seats on the same channel word
    const pump = new XenonPump();
    const rows = wsChans();
    const names = ['pilot.left_backward/forward', 'pilot.right_backward/forward'];
    for (const name of names)
      rows.set(name, { name, label: name, kind: 'control', base: '0', override: '',
        mode: 'auto', manual: 0, value: 0 });
    // bindings are built in buildWorldSim; seed the private map the way it does
    (pump as any).pilotBindings = new Map([
      ['w', names.map(name => ({ name, sign: 1 }))],
      ['s', names.map(name => ({ name, sign: -1 }))],
    ]);
    expect(pump.pilotKeysBound()).toEqual(['w', 's']);

    expect(pump.pilotKey('w', true)).toBe(true);
    for (const n of names) {
      const r = rows.get(n)!;
      expect(r.mode).toBe('manual');
      expect(r.manual).toBe(1);
      expect(r.value).toBe(1);
    }
    pump.pilotKey('w', false);
    expect(rows.get(names[0]!)!.manual).toBe(0);       // the stick CENTERS
    expect(pump.pilotKey('s', true)).toBe(true);
    expect(rows.get(names[0]!)!.manual).toBe(-1);

    // unbound key: refused, touches nothing
    expect(pump.pilotKey('f', true)).toBe(false);
    expect(pump.pilotKeysBound()).not.toContain('f');
  });
});

describe('THE BUZZER LAW (Amplitude ch 0 · Frequency Hz ch 1)', () => {
  const fakePump = (bus: Record<string, number | string>, devs: any[]) => ({
    comp: { devices: devs },
    bus: new Map(Object.entries(bus)),
  } as any);
  const b1 = { type: 'Buzzer', alias: 'b1', io: 8 };

  it('reads alias and io bus keys (the program\'s RAW target verbatim)', () => {
    const alias = buzzerReadings(fakePump({ 'b1:0': 0.5, 'b1:1': 880 }, [b1]));
    expect(alias).toMatchObject([{ name: 'b1', io: 8, amp: 0.5, freq: 880, wave: 'square' }]);
    const io = buzzerReadings(fakePump({ '8:0': 1, '8:1': 220 }, [b1]));
    expect(io[0]!.amp).toBe(1);
    expect(io[0]!.freq).toBe(220);
  });

  it('a buzzer the program never writes is SILENT, not humming at the default', () => {
    const rows = buzzerReadings(fakePump({}, [b1]));
    expect(rows[0]!.amp).toBe(0);
    expect(rows[0]!.freq).toBe(440);                   // the wiki default, silent
  });

  it('clamps to the game ranges: amplitude 0..1, frequency ≤ 20000', () => {
    const rows = buzzerReadings(fakePump({ 'b1:0': 9, 'b1:1': 50000 }, [b1]));
    expect(rows[0]!.amp).toBe(1);
    expect(rows[0]!.freq).toBe(20000);
    const neg = buzzerReadings(fakePump({ 'b1:0': -3 }, [b1]));
    expect(neg[0]!.amp).toBe(0);
  });

  it('string bus values (the shim prints doubles as text) parse; non-buzzers are ignored', () => {
    const rows = buzzerReadings(fakePump({ 'b1:0': '0.75' },
      [b1, { type: 'Lamp', alias: 'l1', io: 2 }]));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amp).toBe(0.75);
  });

  it('alias-only devices (io -1) read on their alias key alone', () => {
    const aliasOnly = { type: 'Buzzer', alias: 'horn', io: -1 };
    const rows = buzzerReadings(fakePump({ 'horn:0': 0.4, 'horn:1': 100 }, [aliasOnly]));
    expect(rows[0]).toMatchObject({ name: 'horn', io: -1, amp: 0.4, freq: 100 });
  });

  void wsLoad;   // (localStorage guard exercised by worldsim.test — silence unused)
});

describe('THE BUZZER AUDIO LAWS (v1.13.4)', () => {
  it('voiceGain lifts game amplitudes into audibility', () => {
    // Mario's melody writes ~0.09: the old linear ·0.25 gain sat at 0.0225
    // (≈ −33 dB — "I dont hear the buzzers"); the lifted law must be ≥ 0.05
    expect(voiceGain(0)).toBe(0);
    expect(voiceGain(0.09)).toBeGreaterThanOrEqual(0.05);
    expect(voiceGain(1)).toBeCloseTo(0.4);
    expect(voiceGain(5)).toBeCloseTo(0.4);            // capped
  });
  it('sync() tracks the activity LEVEL from the bus, no AudioContext needed', () => {
    // (node has no AudioContext — the TopBar animation must reflect what
    // the program SENDS even when the device has no audio output)
    const audio = new BuzzerAudio();
    audio.soundOn = true;
    const pump: any = {
      run: { running: true },
      comp: { devices: [{ type: 'Buzzer', alias: 'game-melody', io: -1 }] },
      bus: new Map([['game-melody:0', 0.09], ['game-melody:1', 522]]),
    };
    audio.sync(pump);
    expect(audio.level).toBeCloseTo(0.09);
    pump.bus = new Map([['game-melody:0', 0]]);
    audio.sync(pump);
    expect(audio.level).toBe(0);
    audio.soundOn = false;
    audio.level = 0.5;
    audio.sync(pump);
    expect(audio.level).toBe(0);                      // muted: level 0
  });
});

describe('THE AUTHORED-MODE LAW (v1.13.5)', () => {
  it('modeToWave maps data.mode in the V-menu order', async () => {
    const { modeToWave, BUZZER_MODES } = await import('../buzzer');
    expect(BUZZER_MODES).toEqual(['sine', 'square', 'triangle', 'sawtooth']);
    expect(modeToWave(0)).toBe('sine');
    expect(modeToWave(1)).toBe('square');
    expect(modeToWave(2)).toBe('triangle');
    expect(modeToWave(3)).toBe('sawtooth');
    expect(modeToWave(9)).toBe('sawtooth');           // clamps
    expect(modeToWave(-2)).toBe('sine');
  });
  it('buzzerReadings carry each component’s authored tone (Mario’s mix)', async () => {
    const { buzzerReadings } = await import('../buzzer');
    // Mario's authored table: melody square (1), bass TRIANGLE (2),
    // effects SAWTOOTH (3) — the "sound is funky" fix: one wave for all
    // eight is NOT the game's law.
    const pump: any = {
      comp: { devices: [
        { type: 'Buzzer', alias: 'game-melody', io: -1, mode: 1 },
        { type: 'Buzzer', alias: 'game-bass', io: -1, mode: 2 },
        { type: 'Buzzer', alias: 'game-effects', io: -1, mode: 3 },
        { type: 'Buzzer', alias: 'no-mode', io: -1 },
      ] },
      bus: new Map<string, number | string>([
        ['game-melody:0', 0.09], ['game-bass:0', 0.09], ['game-effects:0', 0.2],
      ]),
    };
    const rows = buzzerReadings(pump);
    expect(rows.find(r => r.name === 'game-melody')!.wave).toBe('square');
    expect(rows.find(r => r.name === 'game-bass')!.wave).toBe('triangle');
    expect(rows.find(r => r.name === 'game-effects')!.wave).toBe('sawtooth');
    expect(rows.find(r => r.name === 'no-mode')!.wave).toBe('square');  // game default
  });
});

describe('SOUND ON BY DEFAULT (v1.13.6)', () => {
  it('a fresh profile starts with sound ON (Firefox "sound was off" fix)', async () => {
    const { BuzzerAudio } = await import('../buzzer');
    expect(new BuzzerAudio().soundOn).toBe(true);
    // the TopBar icon renders 🔊 from the first paint; the browser's
    // autoplay gate is met by arm()'s first-gesture unlock, not by a
    // toggle the player has to find.
  });
});
