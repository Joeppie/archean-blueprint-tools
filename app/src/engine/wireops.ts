// wireops.ts — the WIRE mode model layer (pure): the port census against
// the manifest adapters, what the file's `data.pipes` already connect, the
// LOGICAL auto-wiring pass and the warnings for unconnected ports.
//
// The WHAT-IS-A-PORT logic lives in wiremodel.ts (roles from the game's
// adapter naming, source/hub/device groups, the compatibility matrix and
// the candidate ranking). This module applies it:
//
//  • pipes reference FLATTENED component indices (readBuild order — the same
//    keying as composite_builds, AGENTS §Subgrids); the census works in
//    TOP-LEVEL indices and maps through the flat list.
//  • cable start points are the VISIBLE sockets: the adapter anchor law
//    (sockets.ts), pinned to tangential residual 0 by the whole-corpus sweep.
//  • OBSERVED auto-wiring v2 (user 2026-10-24: "the auto-wire observed
//    patterns is wrong … the rudders should only take input, not deliver
//    into the junction, that should be left open"): staged per kind through
//    the model's compatibility — power: batteries in parallel, sources into
//    hub INPUTS (the junction input is exactly that slot the rudder may
//    NEVER take), hub inputs cascading, devices onto hub OUTPUT ports, a
//    direct source tap when no hub remains; data: named bridge sides,
//    devices onto routers, routers/switches uplinking to computers, hubs
//    daisy-chaining; fluid/item: named flows and junction ports, direct
//    edges only where both sides are named. A port that finds no compatible
//    partner stays OPEN with a stated reason — the pass never force-pairs
//    leftovers "last resort" any more (that was the "connects every single
//    port" bug).
//  • Existing cables are never touched: user decisions take precedence.
//  • routes are axis-aligned L-runs in x→y→z order, like the game writes.

import { adapterSocket, KIND_RADIUS } from './sockets';
import { flattenComponents } from './subgrid';
import type { Blueprint } from './format';
import type { ModelManifest } from './models';
import {
  candidatesFor, compGroup, hubInputIndex, incompatReason, portHint, portKey, portRole,
  type PortRole, type PortGroup, type WirePort,
} from './wiremodel';
import type { WireKind } from './sockets';

export type { WireKind, PortRole, PortGroup, WirePort };
export { portRole, portHint, compGroup, hubInputIndex, incompatReason, compatible,
  candidatesFor, candidateTier } from './wiremodel';

export const WIRE_KINDS: WireKind[] = ['data', 'lowvoltage', 'highvoltage', 'fluid', 'item'];

export interface PortInfo extends WirePort {}

/** FILE-world socket position of an adapter port (built pose): the v1.8.1
 *  anchor law (sockets.ts) — position + R(qraw)·(ax, az, −ay). */
function portWorld(_bp: Blueprint, ci: number, a: { type: string; position: [number, number, number]; rotation: [number, number, number] }) {
  const c = _bp.data.components[ci]!;
  const s = adapterSocket(c.position, c.orientation, a);
  return [s.at[0], s.at[1], s.at[2]] as [number, number, number];
}

export function portCensus(bp: Blueprint, manifest: ModelManifest | null): PortInfo[] {
  const out: PortInfo[] = [];
  bp.data.components.forEach((c, ci) => {
    if (c.type === 'Build') return;
    for (const a of manifest?.[c.type]?.adapters ?? []) {
      const kind = a.type as WireKind;
      out.push({
        ci, type: c.type, name: a.name, kind,
        at: portWorld(bp, ci, a),
        role: portRole(a.name),                 // wiremodel: the game's naming
        group: compGroup(c.type, kind),         // … and the type's grid role
      });
    }
  });
  return out;
}

/** `ci/port` (TOP-level indices) for every port a pipe already touches. */
export function connectedPorts(bp: Blueprint): Set<string> {
  const flat = flattenComponents(bp);
  const flatToTop = new Map<number, number>();
  flat.forEach((f, i) => { if (f.top >= 0) flatToTop.set(i, f.top); });
  const out = new Set<string>();
  for (const p of bp.data.pipes ?? []) {
    for (const side of ['a', 'b'] as const) {
      const fi = p[`${side}_component` as 'a_component' | 'b_component'];
      const port = p[`${side}_port` as 'a_port' | 'b_port'];
      const top = fi != null ? flatToTop.get(fi) : undefined;
      if (top != null && port) out.add(`${top}/${port}`);
    }
  }
  return out;
}

export function unconnectedPorts(bp: Blueprint, manifest: ModelManifest | null): PortInfo[] {
  const used = connectedPorts(bp);
  return portCensus(bp, manifest).filter(p => !used.has(`${p.ci}/${p.name}`));
}

// ---------------------------------------------------------------- auto-wire

// Segment style fields as the game writes them — every segment carries all
// 14 keys, and the corpus majority per kind (FORMAT §pipes): data navy
// (16,24,96), lowvoltage dark red (96,8,4), highvoltage orange (255,64,4),
// fluid WHITE + chrome, item WHITE + box + metal (the only square species).
// v1.9 EXPORTED: the balloon tail's LV runs are written with this same table
export const KIND_STYLE: Record<string, Record<string, unknown>> = {
  data:        { r: 16, g: 24, b: 96, a: 255, box: false, chrome: false, flexible: false, glossy: false, metal: false, rounded_caps: true, striped: false },
  lowvoltage:  { r: 96, g: 8, b: 4, a: 255, box: false, chrome: false, flexible: false, glossy: false, metal: false, rounded_caps: true, striped: false },
  highvoltage: { r: 255, g: 64, b: 4, a: 255, box: false, chrome: false, flexible: false, glossy: false, metal: false, rounded_caps: true, striped: false },
  fluid:       { r: 255, g: 255, b: 255, a: 255, box: false, chrome: true, flexible: false, glossy: false, metal: false, rounded_caps: true, striped: false },
  item:        { r: 255, g: 255, b: 255, a: 255, box: true, chrome: false, flexible: false, glossy: false, metal: false, rounded_caps: true, striped: false },
};
const styleFor = (kind: WireKind) => KIND_STYLE[kind] ?? KIND_STYLE.data!;

/** Axis-aligned L-run from a to b (x→y→z), zero spans skipped. */
function route(a: [number, number, number], b: [number, number, number], kind: WireKind) {
  const style = styleFor(kind);
  const segs: Record<string, unknown>[] = [];
  const cur = [...a] as [number, number, number];
  for (let ax = 0; ax < 3; ax++) {
    const d = b[ax]! - cur[ax]!;
    if (Math.abs(d) < 1e-6) continue;
    segs.push({ ...style, dir: d > 0 ? ax : ax + 3, length: Math.abs(d),
      start: { x: cur[0]!, y: cur[1]!, z: cur[2]! } });
    cur[ax]! += d;
  }
  if (!segs.length)
    segs.push({ ...style, dir: 0, length: 0.001, start: { x: cur[0], y: cur[1], z: cur[2] } });
  return segs;
}

export interface AutoWireResult {
  created: number;
  skipped: { port: PortInfo; why: string }[];
}

export type WireStrategy = 'observed' | 'naive';

const BATTERY = /^(LowVoltage|HighVoltage)Battery$/;
const COMPUTER = /^(Computer|MiniComputer)$/;

/**
 * LOGICAL auto-wiring (v2 — the wiremodel stages; see the file header and
 * FORMAT §pipes "PORT ROLES"). Naive nearest-pair remains as the explicit
 * fallback strategy. Ports hold ONE cable each; components never self-wire;
 * existing cables are never rewritten.
 */
export function autoWire(bp: Blueprint, manifest: ModelManifest | null,
  strategy: WireStrategy = 'observed'): AutoWireResult {
  const flat = flattenComponents(bp);
  const topToFlat = new Map<number, number>();
  flat.forEach((f, i) => { if (f.top >= 0) topToFlat.set(f.top, i); });
  bp.data.pipes = bp.data.pipes ?? [];
  const created0 = bp.data.pipes.length;
  const skipped: AutoWireResult['skipped'] = [];
  const census = portCensus(bp, manifest);
  const hubIn = hubInputIndex(census);
  const byKey = new Map(census.map(p => [`${p.ci}/${p.name}`, p]));
  let free = unconnectedPorts(bp, manifest);
  /** how many cables each (component, kind) already carries — hub ports
   *  spread their load before distance decides (the least-loaded hub wins) */
  const load = new Map<string, number>();
  for (const p of connectedPorts(bp)) {                       // seed from the file
    const [ci, name] = p.split('/') as [string, string];
    const port = byKey.get(`${ci}/${name}`);
    if (port) load.set(portKey(port.ci, port.kind), (load.get(portKey(port.ci, port.kind)) ?? 0) + 1);
  }

  const link = (A: WirePort, B: WirePort) => {
    bp.data.pipes!.push({
      a_component: topToFlat.get(A.ci)!, a_port: A.name,
      b_component: topToFlat.get(B.ci)!, b_port: B.name,
      radius: A.kind === 'fluid' ? 0.045 : KIND_RADIUS[A.kind] ?? 0.02,
      segments: route(A.at, B.at, A.kind) as never,
      type: A.kind,
    } as never);
    free = free.filter(p => p !== A && p !== B);
    for (const p of [A, B])
      load.set(portKey(p.ci, p.kind), (load.get(portKey(p.ci, p.kind)) ?? 0) + 1);
  };
  const d = (a: WirePort, b: WirePort) =>
    Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1], a.at[2] - b.at[2]);

  /** one wiring stage: repeatedly join the BEST compatible (feeder,
   *  receiver) pair until none remains. 'best' = lowest logical tier, then
   *  least-loaded receiver hub, then nearest. */
  const stage = (kind: WireKind,
    feeder: (p: WirePort) => boolean, receiver: (p: WirePort) => boolean) => {
    for (;;) {
      let best: { a: WirePort; b: WirePort; cost: number[] } | null = null;
      for (const a of free) {
        if (a.kind !== kind || !feeder(a)) continue;
        for (const b of free) {
          if (b === a || b.ci === a.ci || b.kind !== kind || !receiver(b)) continue;
          if (incompatReason(a, b, hubIn)) continue;
          const { tier } = candidateTierOf(a, b);
          const cost = [tier, load.get(portKey(b.ci, kind)) ?? 0, load.get(portKey(a.ci, kind)) ?? 0, d(a, b)];
          if (!best || cmp(cost, best.cost) < 0) best = { a, b, cost };
        }
      }
      if (!best) return;
      link(best.a, best.b);
    }
  };
  const candidateTierOf = (a: WirePort, b: WirePort) =>
    candidatesFor(a, [b], hubIn, load)[0] ?? { tier: 2, why: '' };
  const cmp = (x: number[], y: number[]) => {
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
  };

  for (const kind of WIRE_KINDS) {
    if (!free.some(p => p.kind === kind)) continue;
    if (strategy === 'naive') {                      // plain nearest pair
      for (;;) {
        const ports = free.filter(p => p.kind === kind);
        let bi = -1, bj = -1, best = Infinity;
        for (let i = 0; i < ports.length; i++)
          for (let j = i + 1; j < ports.length; j++) {
            if (ports[i]!.ci === ports[j]!.ci) continue;
            const dd = d(ports[i]!, ports[j]!);
            if (dd < best) { best = dd; bi = i; bj = j; }
          }
        if (bi < 0 || bj < 0) break;
        link(ports[bi]!, ports[bj]!);
      }
      continue;
    }
    // ---- logical stages (wiremodel tiers enforce direction) ----
    if (kind === 'data') {
      // ① the game-named sides first: DataBridge data-computer ↔ Computer
      stage(kind, p => portHint(p.name) != null, p => !portHint(p.name));
      // ② devices onto routers/switches/junctions (never onto a named
      //    computer side, which ① reserved)
      stage(kind, p => p.group === 'device', p => p.group === 'hub' && portHint(p.name) !== 'computer');
      // ③ routers/switches uplink to a computer (named side first)
      stage(kind, p => p.group === 'hub' && !COMPUTER.test(p.type) && portHint(p.name) !== 'device',
        p => COMPUTER.test(p.type));
      // ④ hubs daisy-chain among themselves
      stage(kind, p => p.group === 'hub', p => p.group === 'hub');
      // ⑤ a computer still without a data uplink may pair with any device
      stage(kind, p => COMPUTER.test(p.type), p => p.group === 'device');
      // NO last resort: a device with no router/computer on the craft stays
      // open with its reason printed (old v1 wired them pairwise — junk).
    } else if (kind === 'lowvoltage' || kind === 'highvoltage') {
      // ① storage in parallel: batteries join batteries first
      stage(kind, p => BATTERY.test(p.type), p => BATTERY.test(p.type));
      // ② every producer into a hub INPUT (the junction input slot — the
      //    rudder bug: a device may never sit here, the model says so)
      stage(kind, p => p.group === 'source', p => p.group === 'hub' && p.role === 'in');
      // ③ hub inputs still dark: cascade from another hub's output/any port
      stage(kind, p => p.group === 'hub' && p.role !== 'in', p => p.group === 'hub' && p.role === 'in');
      // ④ devices onto hub OUTPUT / neutral ports, least-loaded hub first
      stage(kind, p => p.group === 'device',
        p => p.group === 'hub' && p.role !== 'in'
          && (hubIn.has(portKey(p.ci, kind)) || p.type.endsWith('Bridge')));
      // ⑤ direct tap: a device straight off a producer (no hub left)
      stage(kind, p => p.group === 'source', p => p.group === 'device');
    } else {
      // fluid / item: named flows first, then junction ports, direct edges
      // only where BOTH sides are named (the model's compatibility rule)
      stage(kind, p => p.group === 'device' && p.role === 'out', p => p.group === 'hub' && p.role === 'in');
      stage(kind, p => p.group === 'device' && p.role !== 'in', p => p.group === 'hub' && p.role === 'in');
      stage(kind, p => p.group === 'device', p => p.group === 'hub' && p.role !== 'in');
      stage(kind, p => p.group === 'hub' && p.role !== 'in', p => p.group === 'device' && p.role === 'in');
      stage(kind, p => p.group === 'hub', p => p.group === 'hub');
      stage(kind, p => p.role === 'out', p => p.role === 'in' && p.group === 'device');
    }
    for (const p of free.filter(q => q.kind === kind))
      skipped.push({ port: p, why: skipReason(p, kind, free) });
  }
  return { created: bp.data.pipes.length - created0, skipped };
}

/** an honest, actionable reason for a port the pass left open */
function skipReason(p: WirePort, kind: WireKind, free: readonly WirePort[]): string {
  if (p.group === 'hub' && p.role === 'in') {
    const upstream = free.some(q => q.kind === kind && (q.group === 'source'
      || (q.group === 'hub' && q.role !== 'in')));
    return upstream ? 'no compatible upstream port remained'
      : `no ${kind} source or upstream hub on this craft`;
  }
  const hubLeft = free.some(q => q.kind === kind && q.group === 'hub' && q.role !== 'in');
  if (p.group === 'device')
    return hubLeft ? 'no compatible hub port remained'
      : `no ${kind} hub with a free output port — wire it to a hub or a source manually`;
  return hubLeft ? 'no compatible device downstream'
    : `no compatible free ${kind} port remained`;
}

// ------------------------------------------------------- labelling + nets

/** `Type[9].lowvoltage ↔ Computer[0].data_port.001` — the label the hover
 *  chip and the cable list print (user's requested form). Nested content
 *  labels through its owning Build: `SmallHinge[B12].lowvoltage`. */
export function pipeLabel(bp: Blueprint, pi: number,
  flat = flattenComponents(bp)): string | null {
  const p = bp.data.pipes?.[pi];
  if (!p) return null;
  const side = (fi: number, port: string) => {
    const e = flat[fi];
    if (!e) return `#${fi}.${port}`;
    return e.top >= 0 ? `${e.comp.type}[${e.top}].${port}`
      : `${e.comp.type}[B${e.path[2]}].${port}`;
  };
  return `${side(p.a_component, p.a_port)} ↔ ${side(p.b_component, p.b_port)}`;
}

/** what the cable graph actually connects, per kind: every CONNECTED
 *  component group (a "net") as an overview row — sources first, then
 *  hubs, then the devices riding them (the "what is wired to what" list). */
export interface WireNet {
  kind: WireKind;
  pipes: number[];                             // data.pipes indices in this net
  members: { ci: number; type: string; group: PortGroup }[];
}
export function wireNets(bp: Blueprint, manifest: ModelManifest | null): WireNet[] {
  const pipes = bp.data.pipes ?? [];
  const flat = flattenComponents(bp);
  const flatToTop = new Map<number, number>();
  flat.forEach((f, i) => { if (f.top >= 0) flatToTop.set(i, f.top); });
  const census = portCensus(bp, manifest);
  const groupOf = new Map<number, Map<WireKind, PortGroup>>();
  for (const c of census) {
    let m = groupOf.get(c.ci); if (!m) groupOf.set(c.ci, m = new Map());
    m.set(c.kind, c.group);
  }
  const out: WireNet[] = [];
  for (const kind of WIRE_KINDS) {
    const idx = pipes.map((p, i) => ({ p, i })).filter(x => (x.p.type ?? 'data') === kind);
    if (!idx.length) continue;
    // union-find over top-level component indices of this kind's edges
    const parent = new Map<number, number>();
    const find = (x: number): number => {
      let r = x;
      while (parent.get(r) != null && parent.get(r) !== r) r = parent.get(r)!;
      parent.set(x, r);
      return r;
    };
    const unions: [number, number][] = [];
    for (const { p } of idx) {
      const a = flatToTop.get(p.a_component), b = flatToTop.get(p.b_component);
      if (a == null || b == null) continue;
      if (!parent.has(a)) parent.set(a, a);
      if (!parent.has(b)) parent.set(b, b);
      unions.push([a, b]);
    }
    for (const [a, b] of unions) {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    }
    const byRoot = new Map<number, { ci: number; type: string; group: PortGroup }[]>();
    for (const ci of parent.keys()) {
      const comp = bp.data.components[ci];
      if (!comp) continue;
      const g = groupOf.get(ci)?.get(kind) ?? 'device';
      const r = find(ci);
      let arr = byRoot.get(r); if (!arr) byRoot.set(r, arr = []);
      arr.push({ ci, type: comp.type, group: g });
    }
    const rank = { source: 0, hub: 1, device: 2 };
    for (const [r, members] of byRoot) {
      members.sort((x, y) => rank[x.group] - rank[y.group] || x.type.localeCompare(y.type) || x.ci - y.ci);
      out.push({
        kind,
        pipes: idx.filter(({ p, i }) => {
          const a = flatToTop.get(p.a_component);
          return a != null && find(a) === r;
        }).map(({ i }) => i),
        members,
      });
    }
  }
  return out.sort((a, b) => WIRE_KINDS.indexOf(a.kind) - WIRE_KINDS.indexOf(b.kind)
    || b.pipes.length - a.pipes.length);
}

/**
 * MANUAL wiring primitive (GUI-independent): build a cable between two
 * named ports, or null when invalid (same component, port already used,
 * port unknown, or mixed cable kinds). This is the USER's explicit choice —
 * the model ranks candidates but a deliberate manual pairing is never
 * second-guessed, so no role check runs here. The caller (Editor) pushes
 * the pipe into bp AND the doc.
 */
export function makePipe(bp: Blueprint, manifest: ModelManifest | null,
  aCi: number, aPort: string, bCi: number, bPort: string) {
  if (aCi === bCi || !manifest) return null;
  const open = unconnectedPorts(bp, manifest);
  const A = open.find(p => p.ci === aCi && p.name === aPort);
  const B = open.find(p => p.ci === bCi && p.name === bPort);
  if (!A || !B || A.kind !== B.kind) return null;
  const flat = flattenComponents(bp);
  const topToFlat = new Map<number, number>();
  flat.forEach((f, i) => { if (f.top >= 0) topToFlat.set(f.top, i); });
  return {
    a_component: topToFlat.get(aCi)!, a_port: aPort,
    b_component: topToFlat.get(bCi)!, b_port: bPort,
    radius: KIND_RADIUS[A.kind],
    segments: route(A.at, B.at, A.kind) as never,
    type: A.kind,
  };
}
