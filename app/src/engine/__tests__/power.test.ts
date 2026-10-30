// power.test.ts — the power NET law (v1.15.6, "if a computer is unpowered,
// according to craft design, show a warning when we interact with it"):
// a computer boots in the game only while its power port rides an energised
// net: SOURCE → (hub)* → DEVICE, per voltage kind. A craft with NO source
// carries no grid — the dev-craft convention leaves every computer powered.
import { describe, expect, test } from 'vitest';
import { craftPowerNet, computerPowered } from '../power';
import type { Blueprint } from '../format';

const comp = (type: string, alias = '') => ({
  type, alias, position: { x: 0, y: 0, z: 0 },
  orientation: { w: 1, x: 0, y: 0, z: 0 }, colors: {}, data: {},
});
const pipe = (a: number, a_port: string, b: number, b_port: string, type: string) =>
  ({ a_component: a, a_port, b_component: b, b_port, type, segments: [] });
const bp = (components: ReturnType<typeof comp>[], pipes: unknown[]): Blueprint =>
  ({ data: { version: 1, blocks: [], components, pipes } } as unknown as Blueprint);


describe('craftPowerNet — source → hub → device', () => {
  test('battery → junction → computer: the computer is on the net', () => {
    const net = craftPowerNet(bp(
      [comp('LowVoltageBattery'), comp('LowVoltageJunction'), comp('MiniComputer'), comp('MiniComputer')],
      [pipe(0, 'connector.000', 1, 'lowvoltage-input', 'lowvoltage'),
        pipe(1, 'lowvoltage-port.001', 2, 'power_connector', 'lowvoltage')]), null);
    expect(net.hasPower).toBe(true);
    expect(computerPowered(net, 2)).toBe(true);
    expect(computerPowered(net, 3)).toBe(false);   // the second computer is bare
    expect(net.sources).toEqual([0]);
  });

  test('a battery may feed a device directly (source → device)', () => {
    const net = craftPowerNet(bp(
      [comp('LowVoltageBattery'), comp('Computer')],
      [pipe(0, 'connector.000', 1, 'power_connector', 'lowvoltage')]), null);
    expect(computerPowered(net, 1)).toBe(true);
  });

  test('hub cascade: junction → junction → device conducts', () => {
    const net = craftPowerNet(bp(
      [comp('LowVoltageBattery'), comp('LowVoltageJunction'), comp('LowVoltageJunction'), comp('MiniComputer')],
      [pipe(0, 'connector.000', 1, 'lowvoltage-input', 'lowvoltage'),
        pipe(1, 'lowvoltage-port.001', 2, 'lowvoltage-input', 'lowvoltage'),
        pipe(2, 'lowvoltage-port.002', 3, 'power_connector', 'lowvoltage')]), null);
    expect(computerPowered(net, 3)).toBe(true);
  });

  test('a junction with no supply powers nothing (a bare hub is dead metal)', () => {
    const net = craftPowerNet(bp(
      [comp('LowVoltageBattery'), comp('LowVoltageJunction'), comp('MiniComputer')],
      [pipe(1, 'lowvoltage-port.001', 2, 'power_connector', 'lowvoltage')]), null);
    expect(computerPowered(net, 2)).toBe(false);
  });

  test('device↔device power runs are junk wiring: they carry nothing', () => {
    const net = craftPowerNet(bp(
      [comp('LowVoltageBattery'), comp('MiniComputer'), comp('MiniComputer')],
      [pipe(0, 'connector.000', 1, 'power_connector', 'lowvoltage'),
        pipe(1, 'power_connector', 2, 'power_connector', 'lowvoltage')]), null);
    expect(computerPowered(net, 1)).toBe(true);
    expect(computerPowered(net, 2)).toBe(false);
  });

  test('low and high voltage are SEPARATE nets', () => {
    const net = craftPowerNet(bp(
      [comp('SteamTurbine'), comp('MiniComputer'), comp('MiniComputer')],
      [pipe(0, 'highvoltage', 1, 'power_connector', 'highvoltage'),
        // a hv cable plugged into a lv port is a wiring bug — kinds decide
        pipe(2, 'power_connector', 0, 'highvoltage', 'highvoltage')]), null);
    expect(computerPowered(net, 1)).toBe(true);
    expect(computerPowered(net, 2)).toBe(true);  // device↔source edge: valid
  });

  test('a craft with NO source is power-unaware: everything is powered', () => {
    const net = craftPowerNet(bp(
      [comp('MiniComputer'), comp('MiniComputer')], []), null);
    expect(net.hasPower).toBe(false);
    expect(computerPowered(net, 0)).toBe(true);
    expect(computerPowered(net, 1)).toBe(true);
  });

  test('the cable kind falls back to the port name (power_connector = lv)', () => {
    // a pipe record with NO type field: power_connector names decide
    const net = craftPowerNet(bp(
      [comp('LowVoltageBattery'), comp('MiniComputer')],
      [pipe(0, 'connector.000', 1, 'power_connector', '')]), null);
    expect(computerPowered(net, 1)).toBe(true);
  });
});
