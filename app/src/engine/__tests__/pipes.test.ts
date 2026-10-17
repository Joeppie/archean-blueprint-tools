// pipes.ts pins: per-segment anchoring at the segment's OWN start (the v0.99
// chain-drift regression), the +0.01 m joint slack, the 0.022 m cross-section,
// the view z-mirror of positions AND dirs, and the connector endpoints.
import { describe, expect, test } from 'vitest';
import { buildPipes } from '../pipes';
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
