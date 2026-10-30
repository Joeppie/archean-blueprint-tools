// @vitest-environment jsdom
// soundscape.test.ts — the STATE half of the soundscape (v1.16.10 WP4):
// in node (no AudioContext) the module must stay SILENT and SAFE — the
// channel ledger (which the loop census reads) and the persisted toggle
// are its pure core; every cue is guarded behind `typeof AudioContext`.
import { describe, expect, test } from 'vitest';
import { Soundscape } from '../soundscape';
import type { Blueprint } from '../format';

const bp = (types: string[]): Blueprint =>
  ({ data: { components: types.map(t => ({ type: t })) } }) as unknown as Blueprint;

describe('the soundscape ledger — @Sound', () => {
  test('writes are remembered per (ci, ch); a new craft resets', () => {
    const s = new Soundscape();
    s.load(bp(['MiningDrill', 'Lamp', 'ToggleButton']));
    s.write(0, 0, 1);
    s.write(1, 0, 1);
    expect(s.chan(0, 0)).toBe(1);
    expect(s.chan(1, 0)).toBe(1);
    expect(s.chan(2, 0)).toBeUndefined();
    s.load(bp(['Lamp']));
    expect(s.chan(0, 0)).toBeUndefined();
  });
  test('node without AudioContext: write/powerStatus/craftTick/syncLoops never throw', () => {
    const s = new Soundscape();
    s.soundOn = true;
    s.load(bp(['MiningDrill', 'ItemConveyor', 'GroundAnchor', 'LowVoltageRelay',
      'PushButton', 'SmallHinge', 'Propeller']));
    s.write(0, 0, 1); s.write(2, 0, 1); s.write(3, 0, 1);
    s.write(4, 0, 1); s.write(4, 0, 0); s.write(5, 0, 0.7);
    s.powerStatus('deficit');
    s.craftTick(1);
    s.syncLoops([{ ci: 0, kind: 'drill', gain: 0.1 }, { ci: 1, kind: 'belt', gain: 0 }]);
    expect(s.chan(0, 0)).toBe(1);
  });
  test('the toggle persists under archean-app-sound', () => {
    const s = new Soundscape();
    const before = s.soundOn;
    const now = s.toggleSound();
    expect(now).toBe(!before);
    expect(localStorage.getItem('archean-app-sound')).toBe(now ? '1' : '0');
    s.toggleSound();
  });
});
