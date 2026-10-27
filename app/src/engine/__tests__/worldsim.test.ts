// worldsim.test.ts — the expression engine + the flight-at-2000 m defaults.
import { describe, expect, it } from 'vitest';
import {
  evalExpr, slug, worldsimDefault, wsKind, wsName, wsEnsure, wsChans,
} from '../worldsim';

describe('worldsim expressions', () => {
  it('evaluates t, pi and the whitelisted fns', () => {
    expect(evalExpr('sin(t)', Math.PI / 2)).toBeCloseTo(1);
    expect(evalExpr('2000 + 5*sin(t/20)', 0)).toBeCloseTo(2000);
    expect(evalExpr('(42 + 0.5*t) % 360', 100)).toBeCloseTo(92);
    expect(evalExpr('0.8 - 0.00001*t', 1000)).toBeCloseTo(0.79);
    expect(evalExpr('max(0, min(1, sin(t)))', 4.7)).toBeCloseTo(0);
  });
  it('rejects anything outside the whitelist', () => {
    expect(() => evalExpr('alert(1)', 0)).toThrow(/unknown name/);
    expect(() => evalExpr('window', 0)).toThrow();
    expect(() => evalExpr('', 0)).toThrow(/empty/);
    expect(() => evalExpr('2 ; 3', 0)).toThrow(/illegal/);
  });
  it('clamps wild values', () => {
    expect(evalExpr('pow(10,40)', 0)).toBe(1e9);
  });
  it('applies $val sensor overrides', () => {
    expect(evalExpr('$val + 2', 0, 2000)).toBe(2002);
    expect(evalExpr('$val * (1 + 0.01*sin(t))', 0, 80)).toBeCloseTo(80);
    expect(() => evalExpr('$val', 0)).toThrow(/base value/);
  });
});

describe('sensor vs control grouping', () => {
  it('only OBSERVERS get the sensor kind', () => {
    expect(wsKind('densitysensor')).toBe('sensor');
    expect(wsKind('mininavinstrument')).toBe('sensor');
    expect(wsKind('navinstrument')).toBe('sensor');
    expect(wsKind('pilotseat')).toBe('control');
    expect(wsKind('throttlelever')).toBe('control');
    expect(wsKind('smallwheel')).toBe('control');      // actuator, not observer
    expect(wsKind('togglebutton')).toBe('control');
  });
  it('the global store keeps one channel per name, labels refresh', () => {
    const a = wsEnsure('nav.altitude', 'NavInstrument · Altitude', 'sensor', '2000');
    a.override = '$val + 2';
    const b = wsEnsure('nav.altitude', 'MiniNav · Altitude', 'sensor', 'ignored');
    expect(b).toBe(a);                                  // same global object
    expect(b.label).toBe('MiniNav · Altitude');
    expect(b.override).toBe('$val + 2');                 // user edits persist
    expect(wsChans().get('nav.altitude')).toBe(a);
  });
});

describe('the 2000 m / 80 m/s defaults', () => {
  it('names channels by device + game function', () => {
    expect(wsName('nav', 'Altitude (meters from sea level)', 2)).toBe('nav.altitude_meters_from_sea_level');
    expect(wsName('nav', null, 6)).toBe('nav.ch6');
    expect(slug('Left Anchor')).toBe('left_anchor');
  });
  it('flies the scenario off the game channel words', () => {
    expect(worldsimDefault('altitude (meters from sea level)', 'mininavinstrument'))
      .toContain('2000');
    expect(worldsimDefault('forward airspeed (m/s)', 'mininavinstrument')).toContain('80');
    expect(worldsimDefault('ground speed (m/s)', 'speedsensor')).toContain('80');
    expect(worldsimDefault('heading', 'mininavinstrument')).toContain('42');
    expect(worldsimDefault('charge', 'lowvoltagebattery')).toContain('0.8');
    expect(worldsimDefault('using', 'pilotseat')).toBe('1');
    expect(worldsimDefault('backward/forward', 'pilotseat')).toContain('sin');
    expect(worldsimDefault(null, 'mystery')).toContain('sin');     // oscillates too
  });
});
