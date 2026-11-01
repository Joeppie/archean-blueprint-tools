// outline.ts — THE OUTER-TRACE (v1.17.2, we: "the silhouette idea
// dramatically failed; and I have a square propellor. NOT THE INTENTION.
// … ensure you properly trace the outside lines with the right
// algorithm"). The convex hull is the WRONG algorithm: it swallows
// concavity (a 2-blade prop becomes a square blob). The right one for
// "the outside lines of a component in orthographic projection":
//   rasterize the component's projected triangles into a mask
//   → contour the mask (marching squares → closed loops, outer + holes)
//   → simplify (Ramer–Douglas–Peucker).
// The result is the union boundary of the triangles — the exact
// silhouette outline, concavities and holes included.
//
// Pure + vitest-pinned (an L of two triangles must keep its notch — the
// convex hull would fill it).

const RES = 2;            // grid cells per sheet px (half-pixel grid)

/** Ramer–Douglas–Peucker on a closed ring (returns the ring, endpoints
 *  preserved); ring: [x,y][] in sheet px. */
export function rdpRing(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length < 4) return pts;
  // anchor at the point farthest from the closing edge for a stable split
  const rdp = (a: number, b: number): void => {
    if (b <= a + 1) return;
    const [ax, ay] = pts[a]!; const [bx, by] = pts[b]!;
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let far = -1, fd = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]!;
      const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > fd) { fd = d; far = i; }
    }
    if (fd <= eps) { keep[b] = 1; return; }
    keep[far] = 1;
    rdp(a, far); rdp(far, b);
  };
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  rdp(0, pts.length - 1);
  return pts.filter((_, i) => keep[i]);
}

/** Shoelace area of a ring (abs). */
export function polyArea(p: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length]!;
    a += p[i]![0] * q[1]! - q[0]! * p[i]![1]!;
  }
  return Math.abs(a / 2);
}

/** The traced outline of a set of projected triangles.
 *  trisPx: [x0,y0, x1,y1, x2,y2] in sheet px.
 *  Returns the SVG path data (closed rings, M…L…Z, holes included) and
 *  the traced AREA (outer rings minus nested holes) — the area feeds the
 *  concavity test in the plate (trace when far smaller than the hull's).
 *  Returns null when the shape cannot be traced. */
export function outlineOf(trisPx: number[][]): { d: string; area: number } | null {
  const d = componentOutline(trisPx);
  if (!d) return null;
  const rings: [number, number][][] = [];
  for (const seg of d.split('M').slice(1))
    rings.push(seg.replace(/Z$/, '').split('L')
      .map(s => s.trim().split(' ').map(Number) as [number, number]));
  let area = 0;
  for (const r of rings) {
    let depth = 0;
    const probe = r[0]!;
    for (const o of rings) {
      if (o === r) continue;
      let inside = false;
      for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
        const [xi, yi] = o[i]!, [xj, yj] = o[j]!;
        if ((yi > probe[1]!) !== (yj > probe[1]!) &&
          probe[0]! < ((xj - xi) * (probe[1]! - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) depth++;
    }
    area += (depth % 2 === 0 ? 1 : -1) * polyArea(r);
  }
  return { d, area };
}

export function componentOutline(trisPx: number[][], maxLoop = 24_000): string {
  if (!trisPx.length) return '';
  let u0 = 1e12, u1 = -1e12, v0 = 1e12, v1 = -1e12;
  for (const t of trisPx)
    for (let k = 0; k < 3; k++) {
      const x = t[k * 2]!, y = t[k * 2 + 1]!;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return '';
      if (x < u0) u0 = x; if (x > u1) u1 = x;
      if (y < v0) v0 = y; if (y > v1) v1 = y;
    }
  const gw = Math.min(2600, Math.ceil((u1 - u0) * RES) + 2);
  const gh = Math.min(2600, Math.ceil((v1 - v0) * RES) + 2);
  if (gw < 3 || gh < 3) return '';
  if (gw * gh > 6_000_000) return '';        // a runaway part: skip traces
  const g = new Uint8Array(gw * gh);
  const stamp = () => {
    // marching squares on the CURRENT mask (segments + chaining + rings)
    // — called per connected island so parts never merge: a beacon's mast
    // and its base are each outlined, not fused into an obelisk (we: "its
    // become a washington monument and its square base merges to the
    // pointy dome").
    const segs: number[][] = [];            // [x0,y0,x1,y1] grid coords
    const G = (x: number, y: number) => g[y * gw + x] ?? 0;
    for (let y = 0; y < gh - 1; y++) for (let x = 0; x < gw - 1; x++) {
      const c = G(x, y) | G(x + 1, y) << 1 | G(x + 1, y + 1) << 2 | G(x, y + 1) << 3;
      if (c === 0 || c === 15) continue;
      const T = [x + 0.5, y], R = [x + 1, y + 0.5], B = [x + 0.5, y + 1], L = [x, y + 0.5];
      const push = (a: number[], b: number[]) => segs.push([a[0]!, a[1]!, b[0]!, b[1]!]);
      switch (c) {
        case 1: case 14: push(L, T); break;
        case 2: case 13: push(T, R); break;
        case 3: case 12: push(L, R); break;
        case 4: case 11: push(R, B); break;
        case 6: case 9: push(T, B); break;
        case 7: case 8: push(L, B); break;
        case 5: push(L, T); push(R, B); break;
        case 10: push(T, R); push(L, B); break;
      }
    }
    // chain segments into closed loops
    const key = (x: number, y: number) => `${x}|${y}`;
    const at = new Map<string, number[]>();
    segs.forEach((s, i) => {
      for (const end of [[s[0], s[1]], [s[2], s[3]]]) {
        const k = key(end[0]!, end[1]!);
        let l = at.get(k);
        if (!l) { l = []; at.set(k, l); }
        l.push(i);
      }
    });
    const used = new Uint8Array(segs.length);
    const loops: [number, number][][] = [];
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      const s0 = segs[i]!;
      const ring: [number, number][] = [[s0[0]!, s0[1]!], [s0[2]!, s0[3]!]];
      let guard = 0;
      while (guard++ < maxLoop) {
        const tail = ring[ring.length - 1]!;
        const cand = (at.get(key(tail[0], tail[1])) ?? []).find(j => !used[j]);
        if (cand === undefined) break;
        used[cand] = 1;
        const s = segs[cand]!;
        const nextPt = (s[0] === tail[0] && s[1] === tail[1]) ? [s[2], s[3]] : [s[0], s[1]];
        if (nextPt[0] === ring[0]![0] && nextPt[1] === ring[0]![1]) break;
        ring.push([nextPt[0]!, nextPt[1]!]);
      }
      if (ring.length >= 4) loops.push(ring);
    }
    if (!loops.length) return;
    // grid → sheet px, simplify, path
    const back = ([x, y]: [number, number]): [number, number] =>
      [u0 + (x - 1) / RES, v0 + (y - 1) / RES];
    for (const loop of loops) {
      const pts = loop.map(p => back([p[0], p[1]] as [number, number]));
      const simp = rdpRing(pts, 1.6);
      if (simp.length < 3) continue;
      outD += `M${simp.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z`;
    }
  };
  let outD = '';
  // rasterize: scanline fill every triangle into the mask
  const sx = (x: number) => Math.round((x - u0) * RES) + 1;
  const sy = (y: number) => Math.round((y - v0) * RES) + 1;
  for (const t of trisPx) {
    const p = [
      [sx(t[0]!), sy(t[1]!)], [sx(t[2]!), sy(t[3]!)], [sx(t[4]!), sy(t[5]!)],
    ] as [number, number][];
    const ys = p.map(q => q[1]);
    const ylo = Math.max(0, Math.min(...ys)), yhi = Math.min(gh - 1, Math.max(...ys));
    for (let y = ylo; y <= yhi; y++) {
      const xs: number[] = [];
      for (let i = 0; i < 3; i++) {
        const a = p[i]!, b = p[(i + 1) % 3]!;
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y))
          xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      if (xs.length < 2) continue;
      xs.sort((m, n) => m - n);
      for (let i = 0; i + 1 < xs.length; i += 2)
        for (let x = Math.ceil(xs[i]! - 0.5); x <= Math.floor(xs[i + 1]! - 0.5); x++)
          if (x >= 0 && x < gw) g[y * gw + x] = 1;
    }
    // an ISLAND ENDED (this scanline has no ink and the mask is hot):
    // marching squares emits every island as its own loop set.
  }
  stamp();
  return outD;
}
