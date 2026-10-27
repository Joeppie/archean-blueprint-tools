// wasm/seal.ts — AssemblyScript port of atmo.ts sealedEnvelopeVolume
// (REWRITE.md §WASM candidate 3, promoted: it runs on EVERY edit rev behind
// the LiftWidget and measures 219 ms on the giant corpus craft — the largest
// per-rev loop in the app, load.perf.test).
//
// The ATMO JS twin (app/src/engine/atmo.ts sealedEnvelopeJS) stays the
// reference: this port is pinned equal to it over the whole corpus
// (sealwasm.test.ts), and sealedEnvelopeVolume() falls back to JS whenever
// the module is not loaded. Keep the two in lockstep.
//
// ABI (linear memory, fixed addresses — the JS serialises inputs straight
// into views over instance.memory, then calls sealed(nB, nT)):
//   byte        0 : i32[nB*6]  blocks  bx, by, bz, sx, sy, sz (absolute cells)
//   byte  1048576 : f64[nT*18] triangles, world metres v0(x,y,z) v1 v2
//   byte 17825792 : i32[2]     OUT: insideFree, wallc (valid when sealed==1)
// The AS heap starts at --memoryBase (18 MiB). Budget law mirrors JS: a grid
// over 24e6 cells answers 0 (the caller falls back / shows the honest 0).
//
// v1.11.2 notes from the landing:
//  · the flood arrays are RAW __alloc pointers, not AS typed arrays: typed
//    array indexing keeps a bounds check per access and the giant's BFS
//    (25 M cells × 6 neighbours) made the port SLOWER than JS (0.44×);
//    raw u8/i32 load+store is checked and fast. Buffers are REUSED globals.
//  · wallPtr()/seenPtr() exports hand the live grid to the parity test —
//    the wall maps are diffed cell-for-cell when the counts disagree.
// v1.12.8 (we: "is that source optimal?"): the per-cell stores became
//  per-RUN memory.fill, the 27-iteration thickening scan an unrolled 7,
//  the barycentric divisions one reciprocal, and the flood a PADDED-grid
//  BFS (a 1-cell seen-ring makes every neighbour a plain ±offset — no
//  div/mod, no bounds test in the hot loop): giant 104 → 57 ms, zeppelin
//  4.3 → 1.6 ms, parity cell-exact. (The exports' wall/seen grids are
//  PADDED since; the counts stay over the inner grid.)

const BLOCKS = 0;
const TRIS = 1048576;
const OUT = 17825792;
const P = 0.25;
const I32MAX = 2147483647;

// Reused flood buffers (raw pointers; gCap = cells)
let gWallP: usize = 0;
let gSeenP: usize = 0;
let gQP: usize = 0;
let gCap: i32 = 0;
let gN: i32 = 0;   // cells of the last run (for the dump exports)

export function wallPtr(): usize { return gWallP; }
export function seenPtr(): usize { return gSeenP; }
export function gridN(): i32 { return gN; }

function ensureCap(n: i32): void {
  if (gCap >= n) return;
  if (gWallP) { __free(gWallP); __free(gSeenP); __free(gQP); }
  gWallP = __alloc(<usize>n);
  gSeenP = __alloc(<usize>n);
  gQP = __alloc(<usize>n * 4);
  gCap = n;
}

// cell index of a world coordinate (JS: Math.floor(v / P + 6))
function cellOf(v: f64): i32 { return <i32>Math.floor(v * 4.0 + 6.0); }

function comp3(a0: f64, a1: f64, a2: f64, i: i32): f64 {
  return i == 0 ? a0 : i == 1 ? a1 : a2;
}

function inTri(px: f64, py: f64, ax: f64, ay: f64, bx: f64, by: f64,
  cx: f64, cy: f64): bool {
  const s1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const s2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  const s3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  return (s1 >= -1e-9 && s2 >= -1e-9 && s3 >= -1e-9)
    || (s1 <= 1e-9 && s2 <= 1e-9 && s3 <= 1e-9);
}

/** 1 = computed (read OUT), 0 = nothing to seal / over the cell budget. */
export function sealed(nB: i32, nT: i32): i32 {
  if (nB + nT == 0) return 0;
  let x0 = I32MAX, y0 = I32MAX, z0 = I32MAX;
  let x1 = -I32MAX, y1 = -I32MAX, z1 = -I32MAX;

  // ── bounds over block cell spans (JS acc of the padded corners)
  let b = BLOCKS;
  for (let k = 0; k < nB; k++, b += 24) {
    const bx = i32.load(b), by = i32.load(b + 4), bz = i32.load(b + 8);
    const bsx = i32.load(b + 12), bsy = i32.load(b + 16), bsz = i32.load(b + 20);
    let cx = bx - 1, cy = by - 1, cz = bz - 1;
    if (cx < x0) x0 = cx; if (cx > x1) x1 = cx;
    if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
    if (cz < z0) z0 = cz; if (cz > z1) z1 = cz;
    cx = bx + bsx + 1; cy = by + bsy + 1; cz = bz + bsz + 1;
    if (cx < x0) x0 = cx; if (cx > x1) x1 = cx;
    if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
    if (cz < z0) z0 = cz; if (cz > z1) z1 = cz;
  }
  let t = TRIS;
  for (let k = 0; k < nT; k++, t += 72) {
    for (let v = 0; v < 3; v++) {
      const cx = cellOf(f64.load(t + v * 24));
      const cy = cellOf(f64.load(t + v * 24 + 8));
      const cz = cellOf(f64.load(t + v * 24 + 16));
      if (cx < x0) x0 = cx; if (cx > x1) x1 = cx;
      if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
      if (cz < z0) z0 = cz; if (cz > z1) z1 = cz;
    }
  }
  x0--; y0--; z0--; x1++; y1++; z1++;                   // padded rim
  const sx = x1 - x0 + 1, sy = y1 - y0 + 1, sz = z1 - z0 + 1;
  const n64 = <i64>sx * <i64>sy * <i64>sz;
  if (n64 > 24000000) return 0;                         // honest give-up
  const n = <i32>n64;
  // v1.12.8 PADDED FLOOD GRID: the grid gets a 1-cell ring on every side
  // (the ring is pre-marked seen), so the BFS neighbour steps are plain
  // i±1 / ±sxp / ±sxyp with NO division and NO bounds test in the hot
  // loop. The budget and the COUNTS are the inner grid, exactly as JS.
  const sxp = sx + 2, syp = sy + 2, szp = sz + 2;
  const sxyp = sxp * syp;
  const np = sxyp * szp;
  ensureCap(np);
  memory.fill(gWallP, 0, <usize>np);
  gN = n;

  // ── block cells are walls (per-RUN memory.fill — the cx runs are
  //    contiguous in the padded grid; indices carry the +1 ring offset)
  b = BLOCKS;
  for (let k = 0; k < nB; k++, b += 24) {
    const bx = i32.load(b), by = i32.load(b + 4), bz = i32.load(b + 8);
    const bsx = i32.load(b + 12), bsy = i32.load(b + 16), bsz = i32.load(b + 20);
    for (let cz = bz; cz <= bz + bsz; cz++)
      for (let cy = by; cy <= by + bsy; cy++)
        memory.fill(gWallP + <usize>(((cz - z0 + 1) * syp + (cy - y0 + 1)) * sxp + (bx - x0 + 1)),
          1, <usize>(bsx + 1));
  }

  // ── voxelize the skin triangles (dominant-plane QUARTER-cell sampling +
  //    the 6-neighbour thickening — the JS law this port mirrors verbatim)
  t = TRIS;
  for (let k = 0; k < nT; k++, t += 72) {
    const ax = f64.load(t), ay = f64.load(t + 8), az = f64.load(t + 16);
    const bxx = f64.load(t + 24), byy = f64.load(t + 32), bzz = f64.load(t + 40);
    const cx = f64.load(t + 48), cy = f64.load(t + 56), cz = f64.load(t + 64);
    const ux = bxx - ax, uy = byy - ay, uz = bzz - az;
    const wx = cx - ax, wy = cy - ay, wz = cz - az;
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const anx = Math.abs(nx), any = Math.abs(ny), anz = Math.abs(nz);
    const wAxis: i32 = anx >= any && anx >= anz ? 0 : any >= anz ? 1 : 2;
    const uAxis: i32 = wAxis == 0 ? 1 : 0;
    const vAxis: i32 = wAxis == 2 ? 1 : 2;
    const auA = comp3(ax, ay, az, uAxis), buA = comp3(bxx, byy, bzz, uAxis), cuA = comp3(cx, cy, cz, uAxis);
    const avA = comp3(ax, ay, az, vAxis), bvA = comp3(bxx, byy, bzz, vAxis), cvA = comp3(cx, cy, cz, vAxis);
    const awA = comp3(ax, ay, az, wAxis), bwA = comp3(bxx, byy, bzz, wAxis), cwA = comp3(cx, cy, cz, wAxis);
    let mnU = auA, mxU = auA;
    if (buA < mnU) mnU = buA; if (buA > mxU) mxU = buA;
    if (cuA < mnU) mnU = cuA; if (cuA > mxU) mxU = cuA;
    let mnV = avA, mxV = avA;
    if (bvA < mnV) mnV = bvA; if (bvA > mxV) mxV = bvA;
    if (cvA < mnV) mnV = cvA; if (cvA > mxV) mxV = cvA;
    const dX1 = buA - auA, dY1 = bvA - avA;
    const dX2 = cuA - auA, dY2 = cvA - avA;
    const den = dX1 * dY2 - dY1 * dX2;
    if (Math.abs(den) < 1e-12) continue;                // degenerate sliver
    const invDen = 1.0 / den;                           // v1.12.8: 1 reciprocal, not 2 divs per sample
    const iu0 = <i32>Math.floor(mnU * 16.0), iu1 = <i32>Math.ceil(mxU * 16.0);
    const iv0 = <i32>Math.floor(mnV * 16.0), iv1 = <i32>Math.ceil(mxV * 16.0);
    for (let iu = iu0; iu <= iu1; iu++) {
      const pu = <f64>iu * (P / 4.0);
      const ccu = cellOf(pu);                           // v1.12.8: constant across the iv run
      for (let iv = iv0; iv <= iv1; iv++) {
        const pv = <f64>iv * (P / 4.0);
        if (!inTri(pu, pv, auA, avA, buA, bvA, cuA, cvA)) continue;
        const px = pu - auA, py = pv - avA;
        const s = (px * dY2 - py * dX2) * invDen, q = (dX1 * py - dY1 * px) * invDen;
        const pw = awA + s * (bwA - awA) + q * (cwA - awA);
        let gx: i32, gy: i32, gz: i32;
        const ccv = cellOf(pv), ccw = cellOf(pw);
        if (wAxis == 0) { gx = ccw; gy = ccu; gz = ccv; }
        else if (wAxis == 1) { gx = ccu; gy = ccw; gz = ccv; }
        else { gx = ccu; gy = ccv; gz = ccw; }
        gx -= x0; gy -= y0; gz -= z0;
        // mark the cell AND its six face neighbours (the 6-connectivity
        // pairing the 6-connected flood cannot cross — JS comment carries
        // it). v1.12.8: unrolled, un-bounded — the +1 ring offset makes
        // every neighbour a valid index into the PADDED grid.
        const base = ((gz + 1) * syp + (gy + 1)) * sxp + (gx + 1);
        store<u8>(gWallP + <usize>base, 1);
        store<u8>(gWallP + <usize>(base - 1), 1);
        store<u8>(gWallP + <usize>(base + 1), 1);
        store<u8>(gWallP + <usize>(base - sxp), 1);
        store<u8>(gWallP + <usize>(base + sxp), 1);
        store<u8>(gWallP + <usize>(base - sxyp), 1);
        store<u8>(gWallP + <usize>(base + sxyp), 1);
      }
    }
  }

  // ── flood the outside from the padded rim (v1.12.8 PADDED BFS): the
  //    1-cell ring is pre-marked seen, the flood starts at the inner grid
  //    corner (1,1,1), neighbour steps are plain ±1 / ±sxp / ±sxyp —
  //    NO division, NO bounds test in the hot loop.
  memory.fill(gSeenP, 0, <usize>np);
  memory.fill(gSeenP, 1, <usize>sxyp);                             // z = 0 plane
  memory.fill(gSeenP + <usize>((szp - 1) * sxyp), 1, <usize>sxyp); // z = max plane
  for (let z = 1; z < szp - 1; z++) {
    memory.fill(gSeenP + <usize>(z * sxyp), 1, <usize>sxp);                   // y = 0 row
    memory.fill(gSeenP + <usize>(z * sxyp + (syp - 1) * sxp), 1, <usize>sxp); // y = max row
    for (let y = 1; y < syp - 1; y++) {
      const p = gSeenP + <usize>(z * sxyp + y * sxp);
      store<u8>(p, 1); store<u8>(p + <usize>(sxp - 1), 1);                    // x = 0 / max cols
    }
  }
  let qh = 0, qt = 0;
  const start = sxyp + sxp + 1;
  store<u8>(gSeenP + <usize>start, 1);
  i32.store(gQP, start); qt = 1;
  while (qh < qt) {
    const i = i32.load(gQP + <usize>qh * 4); qh++;
    let j = i - 1;
    if (load<u8>(gSeenP + <usize>j) == 0 && load<u8>(gWallP + <usize>j) == 0) {
      store<u8>(gSeenP + <usize>j, 1); i32.store(gQP + <usize>qt * 4, j); qt++;
    }
    j = i + 1;
    if (load<u8>(gSeenP + <usize>j) == 0 && load<u8>(gWallP + <usize>j) == 0) {
      store<u8>(gSeenP + <usize>j, 1); i32.store(gQP + <usize>qt * 4, j); qt++;
    }
    j = i - sxp;
    if (load<u8>(gSeenP + <usize>j) == 0 && load<u8>(gWallP + <usize>j) == 0) {
      store<u8>(gSeenP + <usize>j, 1); i32.store(gQP + <usize>qt * 4, j); qt++;
    }
    j = i + sxp;
    if (load<u8>(gSeenP + <usize>j) == 0 && load<u8>(gWallP + <usize>j) == 0) {
      store<u8>(gSeenP + <usize>j, 1); i32.store(gQP + <usize>qt * 4, j); qt++;
    }
    j = i - sxyp;
    if (load<u8>(gSeenP + <usize>j) == 0 && load<u8>(gWallP + <usize>j) == 0) {
      store<u8>(gSeenP + <usize>j, 1); i32.store(gQP + <usize>qt * 4, j); qt++;
    }
    j = i + sxyp;
    if (load<u8>(gSeenP + <usize>j) == 0 && load<u8>(gWallP + <usize>j) == 0) {
      store<u8>(gSeenP + <usize>j, 1); i32.store(gQP + <usize>qt * 4, j); qt++;
    }
  }

  // ENVELOPE = sealed interior + enclosing shell (JS law) — COUNTS over
  // the INNER grid (the ring is scaffolding, never counted).
  let insideFree = 0, wallc = 0;
  for (let z = 1; z <= sz; z++) {
    const pz = z * sxyp;
    for (let y = 1; y <= sy; y++) {
      const base = pz + y * sxp + 1;
      for (let x = 0; x < sx; x++) {
        if (load<u8>(gWallP + <usize>(base + x)) != 0) wallc++;
        else if (load<u8>(gSeenP + <usize>(base + x)) == 0) insideFree++;
      }
    }
  }
  i32.store(OUT, insideFree);
  i32.store(OUT + 4, wallc);
  return 1;
}
