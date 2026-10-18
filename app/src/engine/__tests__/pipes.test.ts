// pipes.ts pins: per-segment anchoring at the segment's OWN start (the v0.99
// chain-drift regression), the +0.01 m joint slack, the 0.022 m cross-section,
// the view z-mirror of positions AND dirs, and the connector endpoints.
import { describe, expect, test } from 'vitest';
import { buildPipes, surgePaths } from '../pipes';
import type { Pipe } from '../format';

const P: Pipe = {
  a_component: 0, a_port: 'pa', b_component: 1, b_port: 'pb',
  segments: [
    { start: { x: 1, y: 2, z: 3 }, dir: 0, length: 0.5 },        // +x
    // NOT chained: this start is OFF the first segment's end (joint offset)
    { start: { x: 1.6, y: 2, z: 3 }, dir: 1, length: 0.25 },     // +y
    { start: { x: 1.6, y: 2.25, z: 3 }, dir: 2, length: 0.25 },  // file +z → view −z
  ],
};

const vec = (v: readonly number[], e: readonly number[]) =>
  v.forEach((x, i) => expect(x).toBeCloseTo(e[i]!, 10));

describe('buildPipes', () => {
  const net = buildPipes([P]);

  test('every tube anchors at its own start — accumulating drifts the chain', () => {
    expect(net.pipes).toBe(1);
    expect(net.tubes.length).toBe(3);
    const [t0, t1, t2] = net.tubes;
    vec(t0!.center, [1 + 0.51 / 2, 2, -3]);                     // L = len + 0.01 slack
    vec(t1!.center, [1.6, 2 + 0.26 / 2, -3]);                   // anchored at 1.6, NOT 1.5
    vec(t2!.center, [1.6, 2.25, -3 - 0.26 / 2]);                // dir 2: file +z → view −z
  });

  test('tube box: length + 0.01 along the run axis, 0.022 cross-section', () => {
    const [t0, t1, t2] = net.tubes;
    vec(t0!.size, [0.51, 0.022, 0.022]);
    vec(t1!.size, [0.022, 0.26, 0.022]);
    vec(t2!.size, [0.022, 0.022, 0.26]);
  });

  test('endpoints are the FIRST/LAST segment ends — the game-recorded sockets', () => {
    expect(net.ends.length).toBe(1);
    const e = net.ends[0]!;
    vec(e.a, [1, 2, -3]);                                       // seg1 start, no slack
    vec(e.b, [1.6, 2.25, -3.25]);                               // last start + dir·len
  });

  test('no pipes → empty network (never throws on missing data.pipes)', () => {
    expect(buildPipes(undefined).pipes).toBe(0);
    expect(buildPipes([]).tubes).toEqual([]);
  });

  test('degenerate pipe (single segment) still yields one tube + both ends', () => {
    const one = buildPipes([{ ...P, segments: [P.segments[0]!] }]);
    expect(one.tubes.length).toBe(1);
    vec(one.ends[0]!.b, [1.5, 2, -3]);
  });
});

// power-surge paths (legacy startSurges): one run per pipe touching ci,
// walked AWAY from the picked socket over the EXACT drawn polyline.
describe('surgePaths', () => {
  const net = buildPipes([P]);

  test('from a_component: travel starts at the a-socket, ends at b', () => {
    expect(net.polys.length).toBe(1);
    const paths = surgePaths(net, 0);
    expect(paths.length).toBe(1);
    const p = paths[0]!;
    expect(p.to).toBe(1);
    vec(p.pts[0]!, [1, 2, -3]);                    // a-end (view-mirrored)
    expect(p.pts.length).toBe(2 * 3);              // start+end per segment
    // 0.5 + 0.1 joint jump + 0.25 + 0 (seg2 end == seg3 start) + 0.25
    expect(p.total).toBeCloseTo(1.1, 10);
    expect(p.cum.length).toBe(p.pts.length);
    // non-decreasing (welded joints have ZERO-length jumps), strictly up at
    // every real step, and the last cum IS the total
    for (let k = 1; k < p.cum.length; k++) expect(p.cum[k]!).toBeGreaterThanOrEqual(p.cum[k - 1]!);
    expect(p.cum[1]!).toBeGreaterThan(0);
    expect(p.cum[p.cum.length - 1]!).toBeCloseTo(p.total, 10);
  });

  test('from b_component: the polyline REVERSES (bolt leaves the picked socket)', () => {
    const fwd = surgePaths(net, 0)[0]!;
    const back = surgePaths(net, 1)[0]!;
    expect(back.to).toBe(0);
    vec(back.pts[0]!, [1.6, 2.25, -3.25]);         // b-end first
    expect(back.pts.map(v => [...v])).toEqual(fwd.pts.map(v => [...v]).reverse());
    expect(back.total).toBeCloseTo(fwd.total, 10);
  });

  test('a component with no cables never surges; degenerate runs are skipped', () => {
    expect(surgePaths(net, 5)).toEqual([]);
    const zero = buildPipes([{ ...P, segments: [{ start: { x: 0, y: 0, z: 0 }, dir: 0, length: 0 }] }]);
    expect(surgePaths(zero, 0)).toEqual([]);       // total 0 < 0.05 m
  });

  test('links record the component edge of every cable run', () => {
    expect(net.links).toEqual([{ a: 0, b: 1 }]);
  });
});
