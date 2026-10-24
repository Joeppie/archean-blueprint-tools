// wiremodel.ts + auto-wire v2 pins (v1.10.1, user: "the auto-wire observed
// patterns is wrong … the rudders should only take input, not deliver into
// the junction, that should be left open, obviously … candidates are
// logically listed by distance and normal association, i.e.
// computer->router->components, or battery->junction->multiple devices").
// The role table is pinned against the GAME's own adapter names (the .ini
// census transcribed below); the compatibility matrix pins the direction
// physics; the ranking pins the logical order; the auto-wire pins are the
// regression guards for the exact failures reported.
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  candidatesFor, compGroup, compatible, hubInputIndex, incompatReason,
  portHint, portRole, type WirePort,
} from '../wiremodel';
import { autoWire, pipeLabel, portCensus, unconnectedPorts, wireNets } from '../wireops';
import type { Blueprint } from '../format';
import type { ModelManifest } from '../models';

const MANIFEST_PATH = '../viewer/models/manifest.json';
const MANIFEST = existsSync(MANIFEST_PATH)
  ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ModelManifest
  : null;

// ------------------------------------------------------- the naming census
describe('port roles from the GAME\'s adapter names', () => {
  const IN = ['lowvoltage-input', 'highvoltage-input', 'fluid-in', 'fluidin', 'item-in',
    'itemin', 'fluid-in-3', 'fluid-in-0'];
  const OUT = ['lowvoltage-output', 'highvoltage-output', 'fluid-out', 'fluidout', 'fluidout2',
    'item-out', 'itemout', 'item_output', 'fluid-out.002', 'item-out.003'];
  const ANY = ['lowvoltage', 'data', 'highvoltage', 'data-port', 'data-connector',
    'connector.000', 'hv1', 'data_port.003', 'data-port-pump', 'lowvoltage-pump',
    'power_connector', 'dock-lowvoltage-port', 'fluidConnector', 'lowvoltage-port.001',
    'port1', 'item2', 'fluid-h2', 'fluid-air', 'hv-connector', 'data-seat', 'fluid-connector'];
  test.each(IN)('%s is an input', n => expect(portRole(n)).toBe('in'));
  test.each(OUT)('%s is an output', n => expect(portRole(n)).toBe('out'));
  test.each(ANY)('%s stays neutral', n => expect(portRole(n)).toBe('any'));
  test('the DataBridge names carry the TOPOLOGY hint', () => {
    expect(portHint('data-computer.1')).toBe('computer');
    expect(portHint('data-device.0')).toBe('device');
    expect(portHint('data_port.003')).toBeNull();
    expect(portHint('lowvoltage')).toBeNull();
  });
});

describe('component groups per kind', () => {
  test('power: batteries/generators produce, junctions route, parts consume', () => {
    expect(compGroup('LowVoltageBattery', 'lowvoltage')).toBe('source');
    expect(compGroup('SolarPanel', 'lowvoltage')).toBe('source');
    expect(compGroup('DieselGenerator', 'highvoltage')).toBe('source');
    expect(compGroup('PowerConverter', 'lowvoltage'), 'the converter FEEDS low voltage').toBe('source');
    expect(compGroup('PowerConverter', 'highvoltage'), 'and DRAINS high voltage').toBe('device');
    expect(compGroup('LowVoltageJunction', 'lowvoltage')).toBe('hub');
    expect(compGroup('LowVoltageBridge', 'lowvoltage')).toBe('hub');
    expect(compGroup('SmallHinge', 'lowvoltage')).toBe('device');
    expect(compGroup('Computer', 'lowvoltage'), 'a computer is a power CONSUMER').toBe('device');
  });
  test('data: routers/computers/switches route, everything else talks', () => {
    expect(compGroup('DataJunction', 'data')).toBe('hub');
    expect(compGroup('Router', 'data')).toBe('hub');
    expect(compGroup('Computer', 'data')).toBe('hub');
    expect(compGroup('MiniRouter', 'data')).toBe('hub');
    expect(compGroup('Lamp', 'data')).toBe('device');
  });
  test('fluid/item: junctions and bridges route', () => {
    expect(compGroup('FluidJunction', 'fluid')).toBe('hub');
    expect(compGroup('FluidPump', 'fluid')).toBe('device');
    expect(compGroup('ItemJunction', 'item')).toBe('hub');
  });
});

// ------------------------------------------------------------------- matrix
const port = (o: Partial<WirePort> & { ci: number; type: string; name: string }): WirePort => ({
  kind: 'lowvoltage', at: [0, 0, 0],
  role: portRole(o.name), group: compGroup(o.type, (o.kind ?? 'lowvoltage')),
  ...o,
} as WirePort);
const hubInOf = (ports: WirePort[]) => hubInputIndex(ports);

describe('THE DIRECTION MATRIX (in/out, source/hub/device)', () => {
  const junctionIn = port({ ci: 0, type: 'LowVoltageJunction', name: 'lowvoltage-input' });
  const junctionOut = port({ ci: 0, type: 'LowVoltageJunction', name: 'lowvoltage-port.001' });
  const battery = port({ ci: 1, type: 'LowVoltageBattery', name: 'connector.000', at: [1, 0, 0] });
  const battery2 = port({ ci: 2, type: 'LowVoltageBattery', name: 'connector.000', at: [2, 0, 0] });
  const hinge = port({ ci: 3, type: 'SmallHinge', name: 'lowvoltage', at: [0, 1, 0] });
  const lamp = port({ ci: 4, type: 'Lamp', name: 'lowvoltage', at: [0, 2, 0] });
  const bridge = port({ ci: 5, type: 'LowVoltageBridge', name: 'port1', at: [3, 3, 0] });
  const hubIn = hubInOf([junctionIn, junctionOut, battery, battery2, hinge, lamp, bridge]);

  test('battery → junction INPUT, hinge → junction OUTPUT', () => {
    expect(compatible(battery, junctionIn, hubIn)).toBe(true);
    expect(compatible(hinge, junctionOut, hubIn)).toBe(true);
  });
  test('THE RUDDER RULE: a device never sits on a hub input', () => {
    expect(incompatReason(hinge, junctionIn, hubIn)).toContain('upstream');
    expect(incompatReason(junctionIn, hinge, hubIn)).toContain('upstream');
  });
  test('a hub output never feeds back into a source', () => {
    expect(incompatReason(junctionOut, battery2, hubIn)).toContain('downstream');
  });
  test('power never runs device-to-device', () => {
    expect(incompatReason(hinge, lamp, hubIn)).toContain('device-to-device');
  });
  test('sources parallel; a bridge port is a two-way link', () => {
    expect(compatible(battery, battery2, hubIn)).toBe(true);
    expect(compatible(bridge, battery, hubIn), 'bridge has no input side').toBe(true);
    expect(compatible(bridge, hinge, hubIn)).toBe(true);
  });
  test('IN↔IN and OUT↔OUT die on the name roles', () => {
    const pumpOut = port({ ci: 6, type: 'FluidPump', name: 'fluid-out', kind: 'fluid' });
    const tankIn = port({ ci: 7, type: 'SmallFluidTank', name: 'fluid-in', kind: 'fluid' });
    const tankIn2 = port({ ci: 8, type: 'SmallFluidTank', name: 'fluid-in', kind: 'fluid' });
    const hubInF = hubInOf([pumpOut, tankIn, tankIn2]);
    expect(compatible(pumpOut, tankIn, hubInF), 'pump→tank is a NAMED direct flow').toBe(true);
    expect(incompatReason(tankIn, tankIn2, hubInF)).toContain('inputs');
    expect(incompatReason(pumpOut, port({ ci: 9, type: 'FluidPort', name: 'fluidout', kind: 'fluid' }), hubInF))
      .toContain('outputs');
  });
  test('neutral fluid edges need a junction (no port↔port spaghetti)', () => {
    const a = port({ ci: 6, type: 'FluidPort', name: 'fluidConnector', kind: 'fluid' });
    const b = port({ ci: 7, type: 'FluidTank', name: 'fluid-connector', kind: 'fluid' });
    expect(incompatReason(a, b, new Set())).toContain('junction');
  });
});

// ----------------------------------------------------------------- ranking
describe('candidates are ranked by logical association, then distance', () => {
  const draft = port({ ci: 0, type: 'Lamp', name: 'lowvoltage', at: [0, 0, 0] });
  const farJunction = port({ ci: 1, type: 'LowVoltageJunction', name: 'lowvoltage-port.001', at: [9, 0, 0] });
  const nearBattery = port({ ci: 2, type: 'LowVoltageBattery', name: 'connector.000', at: [0.5, 0, 0] });
  const wrongInput = port({ ci: 3, type: 'LowVoltageJunction', name: 'lowvoltage-input', at: [0.1, 0, 0] });
  const hubIn = hubInOf([draft, farJunction, nearBattery, wrongInput]);

  test('the HUB beats the nearer battery, and the hub INPUT is skipped', () => {
    const c = candidatesFor(draft, [nearBattery, farJunction, wrongInput], hubIn);
    expect(c.map(x => x.port.ci), 'junction first, battery second, input never')
      .toEqual([1, 2]);
    expect(c[0]!.why).toContain('hub');
  });
  test('distance orders WITHIN a tier', () => {
    const b0 = port({ ci: 0, type: 'LowVoltageBattery', name: 'connector.000', at: [0, 0, 0] });
    const b1 = port({ ci: 1, type: 'LowVoltageBattery', name: 'connector.000', at: [1, 0, 0] });
    const b2 = port({ ci: 2, type: 'LowVoltageBattery', name: 'connector.001', at: [4, 0, 0] });
    const lamp = port({ ci: 3, type: 'Lamp', name: 'lowvoltage', at: [0.2, 0, 0] });
    const c = candidatesFor(b0, [b2, b1, lamp], hubInOf([b0, b1, b2, lamp]));
    expect(c.map(x => x.tier), 'parallel + direct tap share tier 1 (no hub in sight)').toEqual([1, 1, 1]);
    expect(c.map(x => x.port.ci), '…so nearest first').toEqual([3, 1, 2]);
  });
  test('the game-named computer side ranks above everything else', () => {
    const bd = port({ ci: 0, type: 'DataBridge', name: 'data-computer.1', kind: 'data', at: [0, 0, 0] });
    const comp = port({ ci: 1, type: 'Computer', name: 'data_port.000', kind: 'data', at: [8, 0, 0] });
    const lampD = port({ ci: 2, type: 'Lamp', name: 'data', kind: 'data', at: [0.2, 0, 0] });
    const c = candidatesFor(bd, [lampD, comp], hubInOf([bd, comp, lampD]));
    expect(c[0]!.port.type).toBe('Computer');
    expect(c[0]!.why).toContain('computer side');
  });
});

// ---------------------------------------------------------------- autoWire
const craft = (types: [string, [number, number, number]][]): Blueprint => ({
  box_min: { x: -4, y: -4, z: -4 }, box_max: { x: 4, y: 4, z: 4 },
  data: {
    version: 2, blocks: [], triangles: [], pipes: [], colors: [],
    components: types.map(([type, position]) => ({
      type, position: { x: position[0], y: position[1], z: position[2] },
      orientation: { w: 1, x: 0, y: 0, z: 0 },
    })),
  },
}) as unknown as Blueprint;
const typeAt = (bp: Blueprint, flat: number) => {
  const t = bp.data.components[flat];
  return t ? t.type : `#${flat}`;
};

describe('auto-wire v2 — the reported failures stay fixed', () => {
  test.skipIf(!MANIFEST)('the RUDDER regression: hinges only take hub OUTPUTS, the input waits for the battery', () => {
    const bp = craft([
      ['LowVoltageBattery', [4, 0, 0]],
      ['LowVoltageJunction', [0, 0, 0]],
      ['SmallHinge', [-2, 0, 1]],
      ['SmallHinge', [-2, 0, -1]],
    ]);
    const res = autoWire(bp, MANIFEST, 'observed');
    expect(res.created).toBeGreaterThan(0);
    const inputCables = (bp.data.pipes ?? []).filter(p =>
      p.a_port === 'lowvoltage-input' || p.b_port === 'lowvoltage-input');
    for (const p of inputCables) {
      const other = p.a_port === 'lowvoltage-input' ? p.b_component : p.a_component;
      expect(['LowVoltageBattery', 'HighVoltageBattery', 'LowVoltageJunction'],
        'the junction input only ever faces upstream')
        .toContain(typeAt(bp, other));
    }
    // every hinge got powered…
    const hingeCis = bp.data.components.flatMap((c, ci) => c.type === 'SmallHinge' ? [ci] : []);
    for (const ci of hingeCis) {
      const mine = (bp.data.pipes ?? []).filter(p => p.a_component === ci || p.b_component === ci);
      expect(mine.length, `SmallHinge[${ci}] powered`).toBeGreaterThan(0);
      for (const p of mine)
        expect(p.a_port === 'lowvoltage-input' && p.a_component === ci ? 'x'
          : p.b_port === 'lowvoltage-input' && p.b_component === ci ? 'x'
            : p.a_port === 'lowvoltage-input' || p.b_port === 'lowvoltage-input' ? 'BAD' : 'ok')
          .toBe('ok');
    }
  });

  test.skipIf(!MANIFEST)('no router on the craft ⇒ data ports STAY OPEN (never random pairs)', () => {
    const bp = craft([['Lamp', [0, 0, 0]], ['Beacon', [1, 0, 0]], ['PushButton', [2, 0, 0]]]);
    const res = autoWire(bp, MANIFEST, 'observed');
    const dataPipes = (bp.data.pipes ?? []).filter(p => p.type === 'data');
    expect(dataPipes.length, 'no data spaghetti invented').toBe(0);
    expect(res.skipped.filter(s => s.port.kind === 'data').length).toBeGreaterThan(0);
    expect(res.skipped.find(s => s.port.kind === 'data')!.why.length).toBeGreaterThan(0);
  });

  test.skipIf(!MANIFEST)('battery → junction → devices; computer uplinks through the router', () => {
    const bp = craft([
      ['LowVoltageBattery', [5, 0, 0]],
      ['LowVoltageJunction', [0, 0, 0]],
      ['Lamp', [-2, 0, 0]],
      ['SlopeLight', [-2, 0, 2]],
      ['Router', [0, 0, 3]],
      ['Computer', [0, 0, 6]],
      ['AltitudeSensor', [-2, 0, 4]],
    ]);
    autoWire(bp, MANIFEST, 'observed');
    const pipes = bp.data.pipes ?? [];
    const wire = (typeA: string, typeB: string) => pipes.some(p =>
      (typeAt(bp, p.a_component) === typeA && typeAt(bp, p.b_component) === typeB)
      || (typeAt(bp, p.a_component) === typeB && typeAt(bp, p.b_component) === typeA));
    expect(wire('Lamp', 'LowVoltageJunction'), 'lamp ← hub').toBe(true);
    expect(wire('SlopeLight', 'LowVoltageJunction'), 'second device ← hub').toBe(true);
    expect(wire('LowVoltageBattery', 'LowVoltageJunction'), 'battery → hub input').toBe(true);
    expect(wire('AltitudeSensor', 'Router'), 'data device → router').toBe(true);
    expect(wire('Router', 'Computer'), 'router → computer uplink').toBe(true);
    expect(wire('Lamp', 'SlopeLight'), 'devices never pair with each other').toBe(false);
  });

  test.skipIf(!MANIFEST)('existing cables are the user\'s decisions — never rewritten', () => {
    const bp = craft([['LowVoltageBattery', [0, 0, 0]], ['LowVoltageJunction', [1, 0, 0]],
      ['LowVoltageBridge', [2, 0, 0]]]);
    autoWire(bp, MANIFEST, 'observed');
    const before = JSON.stringify(bp.data.pipes);
    const res = autoWire(bp, MANIFEST, 'observed');
    void res;
    expect(JSON.stringify(bp.data.pipes), 'a second pass adds nothing to satisfied ports or rewires').toBe(before);
  });

  test.skipIf(!MANIFEST)('naive stays the anything-goes fallback', () => {
    const bp = craft([['Lamp', [0, 0, 0]], ['Beacon', [1, 0, 0]]]);
    // Lamp and Beacon share TWO kinds (data + lowvoltage) — naive pairs both,
    // observed wires NEITHER (two devices never pair without a hub).
    expect(autoWire(bp, MANIFEST, 'naive').created).toBe(2);
    expect(autoWire(bp, MANIFEST, 'observed').created, 'observed refuses these pairings').toBe(0);
  });
});

// --------------------------------------------------------- labels + nets
describe('cable labels and the networks overview', () => {
  test.skipIf(!MANIFEST)('pipeLabel reads "Type[ci].port ↔ Type[ci].port"', () => {
    const bp = craft([['Lamp', [0, 0, 0]], ['Beacon', [1, 0, 0]]]);
    autoWire(bp, MANIFEST, 'naive');
    expect(pipeLabel(bp, 0)).toBe('Lamp[0].data ↔ Beacon[1].data-connector');
  });
  test.skipIf(!MANIFEST)('wireNets groups connected parts, sources → hubs → devices', () => {
    const bp = craft([
      ['LowVoltageBattery', [5, 0, 0]], ['LowVoltageJunction', [0, 0, 0]],
      ['Lamp', [-2, 0, 0]], ['SlopeLight', [-2, 0, 2]],
      ['Router', [0, 0, 3]], ['Computer', [0, 0, 6]], ['AltitudeSensor', [-2, 0, 4]],
    ]);
    autoWire(bp, MANIFEST, 'observed');
    const nets = wireNets(bp, MANIFEST);
    const lv = nets.find(n => n.kind === 'lowvoltage')!;
    expect(lv.members.map(m => m.group),
      'the LV net: source, hub, then EVERY consumer (the Router and Computer draw LV too)')
      .toEqual(['source', 'hub', 'device', 'device', 'device', 'device']);
    const dn = nets.find(n => n.kind === 'data')!;
    expect(dn.members.some(m => m.type === 'Computer'), 'router+computer+sensor ride one data net').toBe(true);
  });
  test('census ports carry role + group straight from the model', () => {
    const bp = craft([['LowVoltageJunction', [0, 0, 0]]]);
    const cs = portCensus(bp, MANIFEST);
    const inputs = cs.filter(c => c.role === 'in');
    expect(inputs.length, 'lowvoltage-input reads as an input').toBe(1);
    expect(cs.filter(c => c.role === 'any' && c.group === 'hub').length, 'the four ports stay downstream-any')
      .toBe(4);
    expect(unconnectedPorts(bp, MANIFEST).length).toBe(cs.length);
  });
});
