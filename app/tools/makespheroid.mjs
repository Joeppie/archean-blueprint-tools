// makespheroid.mjs — regenerate the spheroid FIXTURE craft
// testdata/9000007001/blueprint.json from the SHIPPED generator
// (src/engine/spheroid.ts — bundled with esbuild, so the fixture can never
// drift from the engine). The classic eyeball layout: solid sphere, stretched
// ellipsoid, hollow shell — each clear of the others' cells.
//
//   node tools/makespheroid.mjs [--out <testdata-dir>]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const outArg = process.argv.indexOf('--out');
const corpus = outArg >= 0 ? process.argv[outArg + 1] : join(repo, 'testdata');

// load the SHIPPED engine module through vite (same TS the app runs)
const server = await createServer({ root: join(here, '..'), server: { middlewareMode: true }, logLevel: 'error' });
const mod = await server.ssrLoadModule('/src/engine/spheroid.ts');
await server.close();
const { spheroidBlocks, spheroidStats } = mod;

const blocks = [];
const parts = [
  { center: [-2.0, 1.0, 0], radii: [1, 1, 1], solid: true, slot: 51 },
  { center: [1.5, 1.0, 0], radii: [1.5, 0.75, 0.75], solid: true, slot: 48 },
  { center: [0, 1.0, -2.75], radii: [0.75, 0.75, 0.75], solid: false, slot: 53 },
];
const onlyArg = process.argv.indexOf('--only');
const only = onlyArg >= 0 ? +process.argv[onlyArg + 1] : -1;   // dev aid: one part
const stats = [];
for (const [i, p] of parts.entries()) {
  if (only >= 0 && i !== only) continue;
  const spec = { material: 0, slot: 51, solid: true, ...p };
  blocks.push(...spheroidBlocks(spec));
  stats.push(spheroidStats(spec));
}

const bp = {
  author: 'harchean-app',
  box_max: { x: 3.0, y: 2.0, z: 1.0 },
  box_min: { x: -3.0, y: 0.0, z: -3.5 },
  box_size: { x: 6.0, y: 2.0, z: 4.5 },
  data: {
    alias: 'spheroid fixture',
    blocks,
    colors: new Array(256).fill(null),
    components: [],
    composite_builds: [],
    doors: [],
    frames: [],
    indestructible: false,
    labels: [],
    pipes: [],
    struts: [],
    symmetry_axis: 0,
    symmetry_axis_offset: { x: 0, y: 0, z: 0 },
    triangles: [],
    version: 2,
  },
  datetime: '2026-10-21 12:00:00',
  mass: 0.0,
  type: 'Archean Build Blueprint',
  version: 1,
  workshop_item_id: 0,
};

const dir = join(corpus, '9000007001');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'blueprint.json'), JSON.stringify(bp));
console.log('blocks:', blocks.length, '| parts:',
  stats.map(s => `${s.blocks}b/${s.kg.toFixed(0)}kg`).join(' '));
