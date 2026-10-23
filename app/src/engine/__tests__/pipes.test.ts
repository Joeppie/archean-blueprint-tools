// pipes.ts pins (v1.81 game-fidelity pass): per-segment anchoring at the
// segment's OWN start (the v0.99 chain-drift regression), the RAW positions
// AND dirs (de-mirror v0.180: view frame == file frame), the connector
// endpoints, and the game's look ported from XenonViewer scene.js: CYLINDER
// cross-sections (square only under the segment `box` flag — the item
// ducts), per-segment colours + metal/chrome passes, elbow spheres with the
// LAST segment stored reversed, and the flexible two-segment sag chain whose
// `dir` means nothing.
import { describe, expect, test } from 'vitest';
import { buildPipes, checkLeads, surgePaths } from '../pipes';
import type { Pipe } from '../format';
import type { PipeSockets } from '../sockets';

const P: Pipe = {
  a_component: 0, a_port: 'pa', b_component: 1, b_port: 'pb',
  segments: [
    { start: { x: 1, y: 2, z: 3 }, dir: 0, length: 0.5 },        // +x
    // NOT chained: this start is OFF the first segment's end (joint offset)
    { start: { x: 1.6, y: 2, z: 3 }, dir: 1, length: 0.25 },     // +y
    { start: { x: 1.6, y: 2.25, z: 3 }, dir: 2, length: 0.25 },  // +z (raw == view)
  ],
};

const vec = (v: readonly number[] | undefined, e: readonly number[]) => {
  expect(v).toBeDefined();
  v!.forEach((x, i) => expect(x).toBeCloseTo(e[i]!, 10));
};

describe('buildPipes — rigid routed cables', () => {
  const net = buildPipes([P]);

  test('every bar anchors at its own start — accumulating drifts the chain', () => {
    expect(net.pipes).toBe(1);
    expect(net.segs.length).toBe(3);
    const [s0, s1, s2] = net.segs;
    vec(s0!.a, [1, 2, 3]); vec(s0!.b, [1.5, 2, 3]);
    vec(s1!.a, [1.6, 2, 3]); vec(s1!.b, [1.6, 2.25, 3]);      // anchored at 1.6, NOT 1.5
    vec(s2!.a, [1.6, 2.25, 3]); vec(s2!.b, [1.6, 2.25, 3.25]); // dir 2: +z (raw == view)
  });

  test('round by default; `box` flags the square item ducts', () => {
    expect(net.segs.every(s => !s.box)).toBe(true);
    const item = buildPipes([{
      ...P, type: 'item', radius: 0.08,
      segments: P.segments.map(s => ({ ...s, box: true })),
    }]);
    expect(item.segs.every(s => s.box)).toBe(true);
    expect(item.segs[0]!.radius).toBe(0.08);
  });

  test('per-segment colours (LINEAR /255, blueprint.js default 128) and the metal/chrome pass', () => {
    expect(net.segs[0]!.color).toEqual([128 / 255, 128 / 255, 128 / 255]);   // no r/g/b → default
    const styled = buildPipes([{
      ...P, type: 'fluid',
      segments: [
        { ...P.segments[0]!, r: 255, g: 255, b: 255, chrome: true },
        { ...P.segments[1]!, r: 16, g: 24, b: 96 },
        { ...P.segments[2]!, r: 255, g: 64, b: 4 },
      ],
    }]);
    expect(styled.segs[0]!.color).toEqual([1, 1, 1]);
    expect(styled.segs[0]!.metal).toBe(true);                 // chrome → shiny pass
    expect(styled.segs[1]!.color).toEqual([16 / 255, 24 / 255, 96 / 255]);
    expect(styled.segs[1]!.metal).toBe(false);
    expect(styled.segs[2]!.color).toEqual([1, 64 / 255, 4 / 255]);
  });

  test('elbow spheres close every direction change (last segment REVERSED)', () => {
    // +x→+y at (1.5,2,3), +y→+z at (1.6,2.25,3)
    expect(net.joints.length).toBe(2);
    vec(net.joints[0]!.at, [1.5, 2, 3]);
    vec(net.joints[1]!.at, [1.6, 2.25, 3]);
    // straight continuation: NO elbow — the LAST segment is stored REVERSED,
    // so a straight +x run stores dir −x (3) at the tail: useful +x = straight
    const straight = buildPipes([{ ...P, segments: [
      { start: { x: 0, y: 0, z: 0 }, dir: 0, length: 1 },
      { start: { x: 1, y: 0, z: 0 }, dir: 0, length: 1 },
      { start: { x: 2, y: 0, z: 0 }, dir: 3, length: 1 },      // reversed tail: (3+3)%6 = +x
    ] }]);
    expect(straight.joints.length).toBe(0);                   // both pairs straight
    const reversed = buildPipes([{ ...P, segments: [
      { start: { x: 0, y: 0, z: 0 }, dir: 0, length: 1 },
      { start: { x: 1, y: 0, z: 0 }, dir: 2, length: 0 },      // LAST, dir +z → useful −z ≠ +x → elbow
    ] }]);
    expect(reversed.joints.length).toBe(1);
  });

  test('endpoints are the FIRST/LAST segment ends + one plug collar each', () => {
    expect(net.ends.length).toBe(1);
    const e = net.ends[0]!;
    vec(e.a, [1, 2, 3]);                                       // seg1 start
    vec(e.b, [1.6, 2.25, 3.25]);                               // last start + dir·len
    expect(net.plugs.length).toBe(2);
    vec(net.plugs[0]!.at, [1, 2, 3]);
    vec(net.plugs[0]!.axis, [-1, 0, 0]);                       // outward along the stub
    vec(net.plugs[1]!.axis, [0, 0, 1]);
  });

  test('no pipes → empty network (never throws on missing data.pipes)', () => {
    expect(buildPipes(undefined).pipes).toBe(0);
    expect(buildPipes([]).segs).toEqual([]);
  });

  test('degenerate pipe (single segment) still yields one bar + both ends', () => {
    const one = buildPipes([{ ...P, segments: [P.segments[0]!] }]);
    expect(one.segs.length).toBe(1);
    vec(one.ends[0]!.b, [1.5, 2, 3]);
  });
});

describe('buildPipes — flexible sag chains', () => {
  // the game's flexible convention: segment[0] carries length+colour (its
  // dir is MEANINGLESS), segment[1] only marks the arrival point (zero len).
  const FLEX: Pipe = {
    a_component: 0, a_port: 'pa', b_component: 1, b_port: 'pb', type: 'data',
    radius: 0.02,
    segments: [
      { start: { x: 0, y: 1, z: 0 }, dir: 4, length: 3.4, flexible: true, r: 16, g: 24, b: 96 },
      { start: { x: 2, y: 1, z: 0 }, dir: 0, length: 0, flexible: true, r: 0, g: 0, b: 0 },
    ],
  };

  test('drawn from socket to arrival, NOT along the meaningless dir', () => {
    const net = buildPipes([FLEX]);
    const e = net.ends[0]!;
    vec(e.a, [0, 1, 0]); vec(e.b, [2, 1, 0]);
    const span = net.segs[net.segs.length - 1]!.b;
    vec(span, [2, 1, 0]);                                      // chain ENDS at the arrival
    expect(net.segs.length).toBeGreaterThan(1);                // slack → chained bars
    for (const s of net.segs) {
      expect(s.b[2]).toBeCloseTo(0, 10);                       // stays in the z=0 plane
      expect(s.b[0]).toBeGreaterThan(s.a[0] - 1e-9);           // travels toward b, never −y
    }
  });

  test('slack sags DOWNWARD (parabola pinned at the ends)', () => {
    const net = buildPipes([FLEX]);
    const midY = net.segs.slice(1, -1).flatMap(s => [s.a[1], s.b[1]]);
    expect(Math.min(...midY)).toBeLessThan(1);                 // 3.4 m over 2 m span → sag
    // taut cable (length == distance) stays straight and high
    const taut = buildPipes([{ ...FLEX, segments: [
      { ...FLEX.segments[0]!, length: 2 }, FLEX.segments[1]!,
    ] }]);
    for (const s of taut.segs) {
      expect(s.a[1]).toBeCloseTo(1, 10);
      expect(s.b[1]).toBeCloseTo(1, 10);
    }
  });
});

describe('buildPipes — socket re-anchoring (stale caches follow the part)', () => {
  const recA: [number, number, number] = [1, 2, 3];
  const recB: [number, number, number] = [1.6, 2.25, 3.25];

  test('a recorded tip still ON its socket is kept verbatim', () => {
    const sockets: PipeSockets[] = [{
      a: { at: [1.05, 2, 3], axis: [1, 0, 0], kind: 'data' },      // 0.05 m off = fresh seating
      b: { at: [1.6, 2.25, 3.3], axis: [0, 0, 1], kind: 'data' },
    }];
    const net = buildPipes([P], sockets);
    vec(net.ends[0]!.a, recA); vec(net.ends[0]!.b, recB);
    expect(net.stale).toBe(0);
  });

  test('a tip dragged off its socket re-anchors onto the live stub', () => {
    const sockets: PipeSockets[] = [{
      a: { at: [5, 2, 3], axis: [-1, 0, 0], kind: 'fluid' },        // part MOVED to x=5
      b: null,                                                      // unresolvable → recorded kept
    }];
    const net = buildPipes([P], sockets);
    vec(net.ends[0]!.a, [5 - 0.05, 2, 3]);                          // TIP_DEF seating depth
    vec(net.ends[0]!.b, recB);                                      // unresolvable → recorded kept
    vec(net.segs[0]!.a, [4.95, 2, 3]);                              // the bar rides along
    expect(net.stale).toBe(1);                                      // exactly the one re-seated end
  });

  test('re-anchoring preserves a sane recorded seating depth, clamped to the game band', () => {
    const sockets: PipeSockets[] = [{
      a: { at: [5, 2, 3], axis: [-1, 0, 0], kind: 'fluid' },
      b: null,
    }];
    // recorded tip was 0.135 m out along the stub → fresh band, kept verbatim
    const deep = buildPipes([{ ...P, segments: [
      { start: { x: 4.865, y: 2, z: 3 }, dir: 0, length: 0.5 }, ...P.segments.slice(1),
    ] }], sockets);
    vec(deep.ends[0]!.a, [4.865, 2, 3]);
    expect(deep.stale).toBe(0);
    // garbage (10 m along the stub) is not a seating depth → default seat
    const junk = buildPipes([{ ...P, segments: [
      { start: { x: -5, y: 2, z: 3 }, dir: 0, length: 0.5 }, ...P.segments.slice(1),
    ] }], sockets);
    vec(junk.ends[0]!.a, [4.95, 2, 3]);
    expect(junk.stale).toBe(1);
  });
});

describe('buildPipes — THE DIRECTION RULE (v1.8.2: wire onto the connector axis)', () => {
  // The user's screenshot case: a stale cached route runs HORIZONTAL while
  // the moved port's socket points +z. The bar touching the connector must
  // leave/enter ALONG that axis, straight for the lead (2× radius) before
  // the route may bend.
  const UP: Pipe = {
    a_component: 0, a_port: 'pa', b_component: 1, b_port: 'pb',
    type: 'fluid', radius: 0.045,
    segments: [
      { start: { x: 1, y: 2, z: 3 }, dir: 0, length: 0.5 },         // +x
      { start: { x: 1.6, y: 2, z: 3 }, dir: 1, length: 0.25 },      // +y
      { start: { x: 1.6, y: 2.25, z: 3.5 }, dir: 5, length: 0.5 },  // reversed tail: tip at (1.6,2.25,3)
    ],
  };
  const socks: PipeSockets[] = [{
    a: { at: [5, 2, 3], axis: [0, 0, 1], kind: 'fluid' },              // part moved here
    b: { at: [1.6, 2.25, 2.9], axis: [0, 0, 1], kind: 'fluid' },       // fresh, cap faces +z
  }];
  const net = buildPipes([UP], socks);

  test('the bar touching the a-connector leaves ALONG the stub axis', () => {
    const bar0 = net.segs[0]!;
    vec(bar0.a, [5, 2, 3.05]);                                   // re-seated tip, one seat out
    const d = [bar0.b[0] - bar0.a[0]!, bar0.b[1] - bar0.a[1]!, bar0.b[2] - bar0.a[2]!];
    expect(d[2]! / Math.hypot(...d)).toBeCloseTo(1, 6);          // +z = the connector direction
    expect(Math.hypot(...d)).toBeCloseTo(0.09, 6);               // lead = 2× radius
  });

  test('the wire enters the b-connector AGAINST its outward axis (onto the circle)', () => {
    const last = net.segs[net.segs.length - 1]!;
    vec(last.b, [1.6, 2.25, 3]);                                 // tip kept (fresh)
    const d = [last.b[0] - last.a[0]!, last.b[1] - last.a[1]!, last.b[2] - last.a[2]!];
    expect(d[2]! / Math.hypot(...d)).toBeCloseTo(-1, 6);         // −z into the +z-facing cap
  });

  test('the bends at the necks close with elbow spheres', () => {
    const neckA = net.joints.find(j => Math.abs(j.at[0]! - 5) < 1e-9
      && Math.abs(j.at[1]! - 2) < 1e-9);
    expect(neckA, 'elbow where the lead leaves the axis').toBeTruthy();
    expect(neckA!.radius).toBeCloseTo(0.045, 10);
    expect(net.joints.some(j => Math.abs(j.at[0]! - 1.6) < 1e-9
      && Math.abs(j.at[1]! - 2.25) < 1e-9
      && Math.abs(j.at[2]! - 3.09) < 1e-6), 'b-neck elbow').toBeTruthy();
  });

  test('a route diving THROUGH the socket gets NO lead (honest direct line)', () => {
    const plunge = buildPipes([UP], [{
      a: null,
      b: { at: [1.6, 2.25, 3.9], axis: [0, 0, 1], kind: 'fluid' },   // the cached tail below would fold the wire
    }]);
    // 3 recorded bars only — no neck bar added at b
    expect(plunge.segs.length).toBe(3);
    const last = plunge.segs[plunge.segs.length - 1]!;
    vec(last.b, [1.6, 2.25, 3.95]);                                // tip still re-seats on the socket
    const d = [last.b[0] - last.a[0]!, last.b[1] - last.a[1]!, last.b[2] - last.a[2]!];
    expect(Math.hypot(d[0]!, d[1]!), 'straight lead-in, no sideways jog').toBeLessThan(1e-9);
  });

  test('the surge polyline starts at the plug tip and leaves along the axis', () => {
    const p = surgePaths(net, 0)[0]!;
    vec(p.pts[0], [5, 2, 3.05]);
    vec(p.pts[1], [5, 2, 3.14]);                                  // the neck point
  });

  test('checkLeads audits the rule: clean here, dirty when the lead is stripped', () => {
    expect(checkLeads(net)).toEqual({ checked: 2, bad: 0 });
    const stripped = buildPipes([UP]);                            // no sockets → no leads
    expect(checkLeads(stripped)).toEqual({ checked: 0, bad: 0 });
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
    vec(p.pts[0], [1, 2, 3]);                        // a-end (raw == view)
    expect(p.pts.length).toBe(2 * 3);                // start+end per segment
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
    vec(back.pts[0], [1.6, 2.25, 3.25]);             // b-end first
    expect(back.pts.map(v => [...v])).toEqual(fwd.pts.map(v => [...v]).reverse());
    expect(back.total).toBeCloseTo(fwd.total, 10);
  });

  test('a component with no cables never surges; degenerate runs are skipped', () => {
    expect(surgePaths(net, 5)).toEqual([]);
    const zero = buildPipes([{ ...P, segments: [{ start: { x: 0, y: 0, z: 0 }, dir: 0, length: 0 }] }]);
    expect(surgePaths(zero, 0)).toEqual([]);         // total 0 < 0.05 m
  });

  test('links record the component edge of every cable run', () => {
    expect(net.links).toEqual([{ a: 0, b: 1 }]);
  });
});
