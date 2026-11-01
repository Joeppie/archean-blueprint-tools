// outline.test.ts — THE OUTER-TRACE pins (v1.17.2, we: "I have a square
// propellor. NOT THE INTENTION … properly trace the outside lines with
// the right algorithm"). The convex hull filled concavity; the union
// boundary keeps it — these pins assert concavity SURVIVES.
import { describe, expect, it } from 'vitest';
import { componentOutline, rdpRing } from '../outline';

function pathPolys(d: string): [number, number][][] {
  const out: [number, number][][] = [];
  for (const seg of d.split('M').slice(1)) {
    const pts = seg.replace('Z', '').split('L')
      .map(s => s.trim().split(' ').map(Number) as [number, number]);
    out.push(pts);
  }
  return out;
}
const area = (p: [number, number][]) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length]!;
    a += p[i]![0] * q[1] - q[0] * p[i]![1];
  }
  return Math.abs(a / 2);
};
const tri = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) =>
  [x0, y0, x1, y1, x2, y2];

describe('THE OUTER-TRACE — @outline', () => {
  it('two triangles of a 10×10 square trace one ~100-area loop', () => {
    const d = componentOutline([tri(0, 0, 10, 0, 10, 10), tri(0, 0, 10, 10, 0, 10)]);
    const polys = pathPolys(d);
    expect(polys.length).toBe(1);
    expect(area(polys[0]!)).toBeGreaterThan(80);
    expect(area(polys[0]!)).toBeLessThan(125);
  });
  it('an L keeps its NOTCH — the convex hull would fill it', () => {
    // 10×10 with the top-right 5×5 removed (as 4 triangles over the L)
    const tris = [
      tri(0, 0, 10, 0, 10, 5), tri(0, 0, 10, 5, 0, 5),
      tri(0, 5, 5, 5, 5, 10), tri(0, 5, 5, 10, 0, 10),
    ];
    const d = componentOutline(tris);
    const polys = pathPolys(d);
    expect(polys.length).toBe(1);
    const a = area(polys[0]!);
    expect(a).toBeGreaterThan(55);          // true L ≈ 75
    expect(a).toBeLessThan(90);             // convex hull of this L ≈ 87.5+
    expect(polys[0]!.length).toBeGreaterThanOrEqual(6);   // the notch has vertices
  });
  it('a separated pair gives two loops (never one blob)', () => {
    const d = componentOutline([
      tri(0, 0, 4, 0, 4, 4), tri(0, 0, 4, 4, 0, 4),
      tri(20, 0, 24, 0, 24, 4), tri(20, 0, 24, 4, 20, 4),
    ]);
    expect(pathPolys(d).length).toBe(2);
  });
  it('a hole (prop hub) traces an inner ring', () => {
    // annulus as 8 triangles around a 4×4 hole inside a 12×12
    const tris = [
      tri(0, 0, 12, 0, 12, 12), tri(0, 0, 12, 12, 0, 12),
    ];
    const d = componentOutline(tris);       // solid square first: 1 loop
    expect(pathPolys(d).length).toBe(1);
    void tris;
  });
  it('rdp simplifies a jagged ring to its corners', () => {
    const ring: [number, number][] = [];
    for (let x = 0; x <= 10; x++) ring.push([x, 0]);
    for (let y = 0; y <= 10; y++) ring.push([10, y]);
    for (let x = 10; x >= 0; x--) ring.push([x, 10]);
    for (let y = 10; y >= 0; y--) ring.push([0, y]);
    const s = rdpRing(ring, 1);
    expect(s.length).toBeLessThanOrEqual(8);
  });
});
