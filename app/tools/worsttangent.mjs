// worsttangent.mjs — triage the SOCKET LAW (sockets.ts): rank the worst
// tangential residuals of recorded pipe tips over their resolved adapters,
// per component kind. Answers "which part's cached route left its socket
// stub axis?" without eyeballing renders (FORMAT §pipes). Run:
//   cd app && npx vite-node tools/worsttangent.mjs [ids...]
// (plain JS — app/tools holds typecheck-free driver scripts, AGENTS)
import { readFileSync } from 'node:fs';
import { pipeSockets, STALE_R } from '../src/engine/sockets.ts';
import { flattenComponents } from '../src/engine/subgrid.ts';

const MANIFEST = JSON.parse(readFileSync('../viewer/models/manifest.json', 'utf8'));
const DEFAULT = ['3812927875', '3732302108', '3417786605', '3803780241', '3309955432',
  '3509975859', '3518436870', '3481322297', '3347018068', '3284539247'];
const ids = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;
const DIRS = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1]];

const worst = new Map();
for (const id of ids) {
  let bp;
  try { bp = JSON.parse(readFileSync(`../testdata/${id}/blueprint.json`, 'utf8')); }
  catch { continue; }
  if (!bp.data.pipes?.length) continue;
  const flat = flattenComponents(bp);
  const socks = pipeSockets(bp.data.pipes, flat, MANIFEST);
  bp.data.pipes.forEach((p, pi) => {
    const sk = socks[pi];
    if (!sk) return;
    for (const side of ['a', 'b']) {
      const sock = sk[side];
      const segs = p.segments;
      if (!sock || !segs.length) continue;
      let rec;
      if (side === 'a') {
        const f = segs[0];
        rec = [f.start.x, f.start.y, f.start.z];
      } else {
        const l = segs[segs.length - 1];
        const d = DIRS[l.dir] ?? DIRS[0];
        rec = [l.start.x + d[0] * l.length, l.start.y + d[1] * l.length,
          l.start.z + d[2] * l.length];
      }
      const ci = side === 'a' ? p.a_component : p.b_component;
      const type = flat[ci]?.comp?.type ?? '?';
      if (type === 'PilotSeat' || type === 'Beacon') continue;   // documented exemptions
      const dd = [rec[0] - sock.at[0], rec[1] - sock.at[1], rec[2] - sock.at[2]];
      const dist = Math.hypot(dd[0], dd[1], dd[2]);
      if (dist > STALE_R) continue;                    // stale: the renderer re-seats it
      const proj = dd[0] * sock.axis[0] + dd[1] * sock.axis[1] + dd[2] * sock.axis[2];
      const tan = Math.hypot(dd[0] - proj * sock.axis[0], dd[1] - proj * sock.axis[1],
        dd[2] - proj * sock.axis[2]);
      const k = `${type}/${p.type}`;
      const prev = worst.get(k);
      if (!prev || tan > prev[0]) worst.set(k, [tan, id, side, proj.toFixed(3), dist.toFixed(3)]);
    }
  });
}
[...worst.entries()].sort((a, b) => b[1][0] - a[1][0]).slice(0, 12)
  .forEach(([k, v]) => console.log(k, v.map(x => (typeof x === 'number' ? x.toFixed(4) : x)).join(' ')));
