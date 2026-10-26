// cabledrape.mjs — triage THE DRAPE LAW on a craft: how many runs resolve
// their sockets, how many are stale (=> re-drape), how many actually HANG
// (sag>0) vs TAUT, and the socket-resolution census per kind. Usage:
//   cd app && npx vite-node tools/cabledrape.mjs <id> [id...]
import { readFileSync } from 'node:fs';
import { pipeSockets, plugAnchor, STALE_R } from '../src/engine/sockets.ts';
import { buildPipes, restLength } from '../src/engine/pipes.ts';
import { flattenComponents } from '../src/engine/subgrid.ts';

const MANIFEST = JSON.parse(readFileSync('../viewer/models/manifest.json', 'utf8'));
const DIRS = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1]];
for (const id of process.argv.slice(2)) {
  const bp = JSON.parse(readFileSync(`../testdata/${id}/blueprint.json`, 'utf8'));
  const pipes = bp.data.pipes ?? [];
  const flat = flattenComponents(bp);
  const socks = pipeSockets(pipes, flat, MANIFEST);
  const net = buildPipes(pipes, socks);
  let both = 0, one = 0, none = 0, staleEnds = 0, hang = 0, taut = 0, flex = 0;
  const noSock = new Map();
  pipes.forEach((p, pi) => {
    const sk = socks[pi] ?? { a: null, b: null };
    if (sk.a && sk.b) both++; else if (sk.a || sk.b) one++; else {
      none++;
      const k = `${p.type}`;
      noSock.set(k, (noSock.get(k) ?? 0) + 1);
    }
    const isFlex = p.segments.length === 2 && p.segments[0].flexible && p.segments[1].flexible;
    if (isFlex) flex++;
    const f = p.segments[0], l = p.segments[p.segments.length - 1];
    const recA = [f.start.x, f.start.y, f.start.z];
    const d = DIRS[l.dir] ?? DIRS[0];
    const recB = [l.start.x + d[0] * l.length, l.start.y + d[1] * l.length, l.start.z + d[2] * l.length];
    const plA = plugAnchor(recA, sk.a, p.radius ?? 0.02);
    const plB = plugAnchor(recB, sk.b, p.radius ?? 0.02);
    if (plA.stale) staleEnds++;
    if (plB.stale) staleEnds++;
    // the drape span: tips (leads short vs sag) — classify hung vs taut
    const A = plA.tip, B = plB.tip;
    const dist = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
    const L = restLength(p);
    if (L > dist * 1.001) hang++; else taut++;
  });
  console.log(`\n${id}: pipes ${pipes.length} (flex ${flex})`);
  console.log(` sockets: both ${both}  one ${one}  NEITHER ${none}` +
    (none ? `  (noSock kinds: ${[...noSock].map(([k, n]) => k + '×' + n).join(' ')})` : ''));
  console.log(` stale ends ${staleEnds}  net.reroute ${net.reroute}  net.stale ${net.stale}`);
  console.log(` drape verdict: HANG ${hang}  TAUT ${taut}`);
  // hung runs whose net chain has no sag (the bug probe): measure the
  // drawn chain's chord dip per net run that SHOULD hang
  let noDip = 0, dipped = 0;
  net.polys.forEach((poly, i) => {
    const pi = net.piOf[i];
    const p = pipes[pi];
    if (!p) return;
    const A = poly[0], B = poly[poly.length - 1];
    const dx = B[0] - A[0], dz = B[2] - A[2];
    let worst = 0;
    for (let k = 1; k < poly.length - 1; k++) {
      const t = ((poly[k][0] - A[0]) * dx + (poly[k][2] - A[2]) * dz) / (dx * dx + dz * dz || 1);
      worst = Math.max(worst, A[1] + t * (B[1] - A[1]) - poly[k][1]);
    }
    const L = restLength(p);
    const dist = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
    if (L > dist * 1.15) { if (worst < 0.05) { noDip++; if (noDip < 4) console.log(`  NO-DIP pipe ${pi} kind ${p.type} L ${L.toFixed(2)} dist ${dist.toFixed(2)} segs ${p.segments.length} flex ${!!p.segments[0].flexible}`); } else dipped++; }
  });
  console.log(` drawn: hung runs dipped ${dipped}  NO-DIP ${noDip}`);
}
