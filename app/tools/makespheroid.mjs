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
const { spheroidBlocks, spheroidStats, spheroidTriangles } = mod;

const blocks = [];
const parts = [
  // chamfered solid sphere (blocks: wedges, tapers, inverse corners)
  { kind: 'blocks', center: [-2.0, 1.0, 0], radii: [1, 1, 1], solid: true, slot: 51 },
  // chamfered hollow shell (blocks)
  { kind: 'blocks', center: [1.5, 1.0, 0], radii: [0.75, 0.75, 0.75], solid: false, slot: 48 },
  // a zeppelin-scale SMOOTH SKIN out of hull triangles (smooth:1)
  { kind: 'skin', center: [0, 1.75, -4.0], radii: [4, 1, 1], solid: true, slot: 53 },
];
const triangles = [];
const onlyArg = process.argv.indexOf('--only');
const only = onlyArg >= 0 ? +process.argv[onlyArg + 1] : -1;   // dev aid: one part
const stats = [];
for (const [i, p] of parts.entries()) {
  if (only >= 0 && i !== only) continue;
  const spec = { material: 0, slot: 51, solid: true, ...p };
  if (p.kind === 'skin') {
    triangles.push(...spheroidTriangles(spec));
    stats.push(spheroidStats(spec));
  } else {
    blocks.push(...spheroidBlocks(spec));
    stats.push(spheroidStats(spec));
  }
}

const bp = {
  author: 'harchean-app',
  box_max: { x: 4.5, y: 3.0, z: 1.25 },
  box_min: { x: -4.5, y: -0.5, z: -5.5 },
  box_size: { x: 9.0, y: 3.5, z: 6.75 },
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
    triangles,
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
console.log('blocks:', blocks.length, '| triangles:', triangles.length, '| parts:',
  stats.map(s => `${s.blocks}b/${s.tris}t`).join(' '));
