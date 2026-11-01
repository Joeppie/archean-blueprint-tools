// schematicsymbols.test.ts — THE SYMBOL LAW pins (v1.17.2, we: "the
// cockpit is too complex … the helicopter rotor is not good; a schematic
// should be more symbolic of components"). Every named type gets a
// glyph; unknown types degrade to the generic diamond, never a mesh.
import { describe, expect, it } from 'vitest';
import { symbolFor, glyphProp, glyphWheel, glyphSeat } from '../schematicsymbols';

const at = (g: ReturnType<typeof symbolFor>) => g(100, 100, 60, 0.7);

describe('THE SYMBOL LAW — @symbols', () => {
  it('the corpus-relevant types all have a symbol with markup', () => {
    for (const t of ['Propeller', 'Wheel', 'BigWheel', 'SmallWheel', 'SmallHinge',
      'SmallPivot', 'LinearTrack', 'Aileron', 'Elevator', 'Rudder',
      'Computer', 'MiniComputer', 'MiniRouter', 'Router', 'DataJunction', 'DataBridge',
      'HudController', 'Lamp', 'SpotLight', 'Buzzer', 'Beacon', 'PilotSeat',
      'LowVoltageBattery', 'HighVoltageBattery', 'LowVoltageRelay', 'HighVoltageRelay',
      'SpeedSensor', 'SmallContainer']) {
      const svg = at(symbolFor(t));
      expect(svg, t).toMatch(/<(path|circle|line|rect)/);
      expect(svg, t).not.toContain('NaN');
      expect(svg.length, t).toBeGreaterThan(20);
    }
  });
  it('unknown types get the generic diamond, never nothing', () => {
    const svg = at(symbolFor('NoSuchPart'));
    expect(svg).toContain('path');
    expect(symbolFor('NoSuchPart')).toBe(symbolFor('AlsoMissing'));
  });
  it('the axis angle rotates the glyph (orientation is drawn, not guessed)', () => {
    const a = glyphProp(100, 100, 60, 0);
    const b = glyphProp(100, 100, 60, Math.PI / 2);
    expect(a).not.toBe(b);
    expect(glyphSeat(100, 100, 60, 0)).not.toBe(glyphSeat(100, 100, 60, Math.PI / 2));
    // wheels are axis-free discs
    expect(glyphWheel(100, 100, 60, 0)).toBe(glyphWheel(100, 100, 60, 2));
  });
  it('the propeller symbol is a sweep circle + hub (the rotor reads as a rotor)', () => {
    const svg = glyphProp(100, 100, 60, 0.4);
    const circles = (svg.match(/<circle/g) ?? []).length;
    expect(circles).toBeGreaterThanOrEqual(2);       // disc + hub
    expect((svg.match(/<line/g) ?? []).length).toBeGreaterThanOrEqual(4); // blades
  });
});
