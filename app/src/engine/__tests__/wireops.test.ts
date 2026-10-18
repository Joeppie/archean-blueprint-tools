// wireops pins: the FLATTENED-index mapping of existing pipes, and the
// OBSERVED-PATTERN router — batteries go parallel first, fluid edges only
// ever meet FluidJunctions, data devices meet DataJunctions. Corpus fixture:
// the ISW's FluidPorts must all land on junctions after the pass.
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { autoWire, connectedPorts, portCensus, unconnectedPorts } from '../wireops';
import { flattenComponents } from '../subgrid';
import type { Blueprint } from '../format';
import type { ModelManifest } from '../models';
import { corpusDir } from '../../../tools/vite-corpus.ts';

const MANIFEST_PATH = '../viewer/models/manifest.json';
const MANIFEST = existsSync(MANIFEST_PATH)
  ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ModelManifest
  : null;
const ISW = `${corpusDir()}/3812927875/blueprint.json`;

describe('wireops census', () => {
  test.skipIf(!MANIFEST || !existsSync(ISW))('ISW: pipes speak FLATTENED indices; census maps them back', () => {
    const bp = JSON.parse(readFileSync(ISW, 'utf8')) as Blueprint;
    const flat = flattenComponents(bp);
    const pipes = bp.data.pipes ?? [];
    expect(pipes.length).toBeGreaterThan(0);
    const used = connectedPorts(bp);
    expect(used.size).toBeGreaterThan(0);
    // a flattened index beyond the top-level array must still map (the ISW
    // has no subgrids, so here flat === top — and every port name resolves)
    const census = new Set(portCensus(bp, MANIFEST).map(p => `${p.ci}/${p.name}`));
    for (const key of used) expect(census.has(key), key).toBe(true);
    void flat;
  });
});

describe('observed-pattern router', () => {
  test.skipIf(!MANIFEST || !existsSync(ISW))('fluid: every FluidPort intake ends on a FluidJunction', () => {
    const bp = JSON.parse(readFileSync(ISW, 'utf8')) as Blueprint;
    autoWire(bp, MANIFEST, 'observed');
    const flatToTop = new Map<number, number>();
    flattenComponents(bp).forEach((f, i) => { if (f.top >= 0) flatToTop.set(i, f.top); });
    const open = unconnectedPorts(bp, MANIFEST).filter(p => p.type === 'FluidPort' && p.kind === 'fluid');
    expect(open.length, 'no FluidPort port left unconnected').toBe(0);
    for (const p of bp.data.pipes ?? []) {
      if (p.type !== 'fluid') continue;
      const ta = flatToTop.get(p.a_component), tb = flatToTop.get(p.b_component);
      if (ta == null || tb == null) continue;
      const A = bp.data.components[ta]!;
      const B = bp.data.components[tb]!;
      if (A.type === 'FluidPort') expect(B.type, 'FluidPort cable lands on a junction').toBe('FluidJunction');
      if (B.type === 'FluidPort') expect(A.type).toBe('FluidJunction');
    }
  });

  test('data: devices only ever meet DataJunctions (never each other)', () => {
    const bp: Blueprint = {
      box_min: { x: 0, y: 0, z: 0 }, box_max: { x: 1, y: 1, z: 1 },
      data: {
        version: 2, blocks: [], triangles: [], pipes: [], colors: [],
        components: [
          { type: 'Lamp', position: { x: 0.5, y: 1, z: 0 }, orientation: { w: 1, x: 0, y: 0, z: 0 } },
          { type: 'Beacon', position: { x: -0.5, y: 1, z: 0 }, orientation: { w: 1, x: 0, y: 0, z: 0 } },
          { type: 'DataJunction', position: { x: 0, y: 1, z: 0.4 }, orientation: { w: 1, x: 0, y: 0, z: 0 } },
        ],
      },
    } as unknown as Blueprint;
    autoWire(bp, MANIFEST, 'observed');
    const types = (i: number) => bp.data.components[i]!.type;
    for (const p of bp.data.pipes ?? []) {
      if (p.type !== 'data') continue;
      const A = types(p.a_component)!, B = types(p.b_component)!;
      if (A === 'Lamp' || A === 'Beacon') expect(B).toBe('DataJunction');
    }
  });

  test('power: two batteries pair with each other FIRST (parallel), then a lamp joins a hub', () => {
    const bp: Blueprint = {
      box_min: { x: 0, y: 0, z: 0 }, box_max: { x: 1, y: 1, z: 1 },
      data: {
        version: 2, blocks: [], triangles: [], pipes: [], colors: [],
        components: [
          { type: 'LowVoltageBattery', position: { x: 1, y: 0.5, z: 0 }, orientation: { w: 1, x: 0, y: 0, z: 0 } },
          { type: 'LowVoltageBattery', position: { x: 1.2, y: 0.5, z: 0 }, orientation: { w: 1, x: 0, y: 0, z: 0 } },
          { type: 'LowVoltageJunction', position: { x: -0.8, y: 0.5, z: 0 }, orientation: { w: 1, x: 0, y: 0, z: 0 } },
          { type: 'Lamp', position: { x: -1, y: 0.5, z: 0.1 }, orientation: { w: 1, x: 0, y: 0, z: 0 } },
        ],
      },
    } as unknown as Blueprint;
    autoWire(bp, MANIFEST, 'observed');
    const pipes = bp.data.pipes ?? [];
    const batBat = pipes.some(p => p.type === 'lowvoltage'
      && bp.data.components[p.a_component]!.type === 'LowVoltageBattery'
      && bp.data.components[p.b_component]!.type === 'LowVoltageBattery');
    expect(batBat, 'batteries wired in parallel').toBe(true);
    const lamp = pipes.find(p => p.type === 'lowvoltage'
      && (bp.data.components[p.a_component]!.type === 'Lamp' || bp.data.components[p.b_component]!.type === 'Lamp'));
    expect(lamp, 'lamp reached a hub').toBeTruthy();
    const other = bp.data.components[lamp!.a_component]!.type === 'Lamp' ? lamp!.b_component : lamp!.a_component;
    expect(['LowVoltageJunction', 'LowVoltageBattery']).toContain(bp.data.components[other]!.type);
  });
});
