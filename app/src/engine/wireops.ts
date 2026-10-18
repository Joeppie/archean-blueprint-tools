// wireops.ts — the WIRE mode model layer (pure): the port census against
// the manifest adapters, what the file's `data.pipes` already connect, the
// NAIVE auto-wiring pass, and the warnings for unconnected ports (user's
// example: a rotor without a data input).
//
// Conventions this encodes (all verified against the corpus):
//  • pipes reference FLATTENED component indices (readBuild order — the same
//    keying as composite_builds, AGENTS §Subgrids); the census works in
//    TOP-LEVEL indices and maps through the flat list.
//  • adapter kinds come from the manifest: data / lowvoltage / highvoltage /
//    fluid / item. Auto-wiring covers the ELECTRIC kinds (data, lv, hv);
//    fluid and item ports are only censused for the warnings list.
//  • cable start points are the VISIBLE sockets: the game writes endpoints
//    at position + R(q*)·(a.x, a.y, −a.z)-mirrored — computed here exactly
//    like compparts does for the collider boxes (file world space).
//  • the naive router pairs the GLOBAL nearest free port pair per kind,
//    different components only, until fewer than two free ports remain;
//    routes are axis-aligned L-runs in x→y→z order, like the game writes.

import { fileToViewQuat, qRot } from './compparts';
import { flattenComponents } from './subgrid';
import type { Blueprint, FileQuat } from './format';
import type { ModelManifest } from './models';

export type WireKind = 'data' | 'lowvoltage' | 'highvoltage' | 'fluid' | 'item';
export const WIRE_KINDS: WireKind[] = ['data', 'lowvoltage', 'highvoltage', 'fluid', 'item'];

export interface PortInfo { ci: number; type: string; name: string; kind: WireKind; at: [number, number, number] }

const Q_ID: FileQuat = { w: 1, x: 0, y: 0, z: 0 };

/** FILE-world socket position of an adapter port (built pose): the view
 *  chain origin (x, y, −z) plus R(qv)·(ax, ay, −az), mirrored back. */
function portWorld(bp: Blueprint, ci: number, a: { position: [number, number, number] }, legacy: boolean) {
  const c = bp.data.components[ci]!;
  const qv = fileToViewQuat(c.orientation ?? Q_ID, legacy);
  const v = qRot(qv, [a.position[0], a.position[1], -a.position[2]]);
  return [c.position.x + v[0], c.position.y + v[1], c.position.z - v[2]] as [number, number, number];
}

export function portCensus(bp: Blueprint, manifest: ModelManifest | null): PortInfo[] {
  const legacy = bp.data.colors == null || bp.data.colors.length === 0;
  const out: PortInfo[] = [];
  bp.data.components.forEach((c, ci) => {
    if (c.type === 'Build') return;
    for (const a of manifest?.[c.type]?.adapters ?? []) {
      out.push({ ci, type: c.type, name: a.name, kind: a.type as WireKind, at: portWorld(bp, ci, a, legacy) });
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

// Segment style fields as the game writes them (r/g/b/a/b are the cable
// style scalars; data & lv ride the plain white sheath, hv the grouped one).
const CABLE_STYLE = {
  a: 255, b: 12, box: false, chrome: false, flexible: false, g: 1,
  glossy: false, metal: false, r: 1, rounded_caps: true, striped: false,
};
const HV_STYLE = { ...CABLE_STYLE, g: 2 };

/** Axis-aligned L-run from a to b (x→y→z), zero spans skipped. */
function route(a: [number, number, number], b: [number, number, number], kind: WireKind) {
  const style = kind === 'highvoltage' ? HV_STYLE : CABLE_STYLE;
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

/**
 * OBSERVED-PATTERN wiring (user's rules from the corpus, v-next):
 *  • power (lv/hv): BATTERIES FIRST IN PARALLEL (nearest battery-battery
 *    pair repeatedly), then every other device port to the nearest free
 *    port on a hub (battery or *Junction);
 *  • fluid: pumps/tanks/ports/reactors are EDGES; FluidJunction is the hub
 *    ("intakes to the nearest of the 4 junction ports", "pumps to the
 *    single ports" = the least-loaded junction) — edge ports go to the
 *    nearest junction with capacity, junctions that stay isolated link to
 *    their nearest junction;
 *  • data: devices to the nearest ROUTER (DataJunction/DataBridge) with a
 *    free port; routers then daisy-chain to the nearest other router and
 *    finally to a COMPUTER sink (Computer/MiniComputer).
 * Naive nearest-pair remains available as the fallback strategy.
 * Ports hold ONE cable each; components never self-wire.
 */

const BATTERY = /^(LowVoltage|HighVoltage)Battery$/;
const JUNCTION = /Junction$|Bridge$/;
const COMPUTER = /^(MiniComputer|Computer)$/;
const DATA_ROUTER = /^(DataJunction|DataBridge)$/;
const FLUID_HUB = /^FluidJunction$/;

const isPowerKind = (k: WireKind) => k === 'lowvoltage' || k === 'highvoltage';

export type WireStrategy = 'observed' | 'naive';

export function autoWire(bp: Blueprint, manifest: ModelManifest | null,
  strategy: WireStrategy = 'observed'): AutoWireResult {
  const flat = flattenComponents(bp);
  const topToFlat = new Map<number, number>();
  flat.forEach((f, i) => { if (f.top >= 0) topToFlat.set(f.top, i); });
  bp.data.pipes = bp.data.pipes ?? [];
  const created0 = bp.data.pipes.length;
  const skipped: AutoWireResult['skipped'] = [];
  let free = unconnectedPorts(bp, manifest);

  const link = (A: PortInfo, B: PortInfo) => {
    bp.data.pipes!.push({
      a_component: topToFlat.get(A.ci)!, a_port: A.name,
      b_component: topToFlat.get(B.ci)!, b_port: B.name,
      radius: A.kind === 'fluid' ? 0.045 : 0.02,
      segments: route(A.at, B.at, A.kind) as never,
      type: A.kind,
    } as never);
    free = free.filter(p => p !== A && p !== B);
  };
  const d = (a: PortInfo, b: PortInfo) => Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1], a.at[2] - b.at[2]);
  const other = (p: PortInfo) => free.filter(q => q.kind === p.kind && q.ci !== p.ci);
  const nearest = (p: PortInfo, pool: (q: PortInfo) => boolean,
    load?: Map<number, number>): PortInfo | null => {
    let best: PortInfo | null = null;
    for (const q of other(p)) {
      if (!pool(q)) continue;
      if (!best) { best = q; continue; }
      const lq = load ? (load.get(q.ci) ?? 0) : 0, lb = load ? (load.get(best.ci) ?? 0) : 0;
      if (lq < lb || (lq === lb && d(p, q) < d(p, best))) best = q;
    }
    return best;
  };
  const hubLoad = (kinds: WireKind[], isHub: (t: string) => boolean) => {
    const m = new Map<number, number>();
    const used = connectedPorts(bp);
    for (const c of portCensus(bp, manifest))
      if (c.kind && kinds.includes(c.kind) && isHub(c.type) && used.has(`${c.ci}/${c.name}`))
        m.set(c.ci, (m.get(c.ci) ?? 0) + 1);
    return m;
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
    // ---- observed patterns ----
    if (isPowerKind(kind)) {
      // 1. batteries in parallel: repeatedly the nearest bat-bat pair
      for (;;) {
        const bats = free.filter(p => BATTERY.test(p.type));
        let bi = -1, bj = -1, best = Infinity;
        for (let i = 0; i < bats.length; i++)
          for (let j = i + 1; j < bats.length; j++) {
            if (bats[i]!.ci === bats[j]!.ci) continue;
            const dd = d(bats[i]!, bats[j]!);
            if (dd < best) { best = dd; bi = i; bj = j; }
          }
        if (bi < 0 || bj < 0) break;
        link(bats[bi]!, bats[bj]!);
      }
      // 2. device ports → nearest free hub port, LEAST-LOADED hub first
      const load = hubLoad([kind], t => BATTERY.test(t) || JUNCTION.test(t));
      for (const p of free.filter(q => q.kind === kind && !BATTERY.test(q.type))) {
        const hub = nearest(p, q => BATTERY.test(q.type) || JUNCTION.test(q.type), load);
        if (hub) { link(p, hub); load.set(hub.ci, (load.get(hub.ci) ?? 0) + 1); }
      }
      // batteries still alone (e.g. a lone battery) → nearest hub too
      for (const p of free.filter(q => q.kind === kind)) {
        const hub = nearest(p, q => JUNCTION.test(q.type), load);
        if (hub) link(p, hub);
      }
    } else if (kind === 'fluid') {
      const load = hubLoad(['fluid'], t => FLUID_HUB.test(t));
      // edges (ports/tanks/pumps/reactors…) → nearest junction with capacity
      for (const p of free.filter(q => q.kind === 'fluid' && !FLUID_HUB.test(q.type))) {
        const hub = nearest(p, q => FLUID_HUB.test(q.type), load);
        if (hub) { link(p, hub); load.set(hub.ci, (load.get(hub.ci) ?? 0) + 1); }
      }
      // junctions left isolated → link junction to nearest junction
      for (;;) {
        const js = free.filter(q => q.kind === 'fluid' && FLUID_HUB.test(q.type));
        let bi = -1, bj = -1, best = Infinity;
        for (let i = 0; i < js.length; i++)
          for (let j = i + 1; j < js.length; j++) {
            if (js[i]!.ci === js[j]!.ci) continue;
            const dd = d(js[i]!, js[j]!);
            if (dd < best) { best = dd; bi = i; bj = j; }
          }
        if (bi < 0 || bj < 0) break;
        link(js[bi]!, js[bj]!);
      }
    } else if (kind === 'data') {
      const load = hubLoad(['data'], t => DATA_ROUTER.test(t));
      // devices → nearest router
      for (const p of free.filter(q => q.kind === 'data' && !DATA_ROUTER.test(q.type) && !COMPUTER.test(q.type))) {
        const hub = nearest(p, q => DATA_ROUTER.test(q.type), load);
        if (hub) { link(p, hub); load.set(hub.ci, (load.get(hub.ci) ?? 0) + 1); }
      }
      // routers → another router (prefer least loaded) — daisy chain
      for (;;) {
        const rs = free.filter(q => q.kind === 'data' && DATA_ROUTER.test(q.type));
        let bi = -1, bj = -1, best = Infinity;
        for (let i = 0; i < rs.length; i++)
          for (let j = i + 1; j < rs.length; j++) {
            if (rs[i]!.ci === rs[j]!.ci) continue;
            const dd = d(rs[i]!, rs[j]!);
            if (dd < best) { best = dd; bi = i; bj = j; }
          }
        if (bi < 0 || bj < 0) break;
        link(rs[bi]!, rs[bj]!);
      }
      // anything still free (routers, computers, strays) → nearest
      // router-with-capacity, else computer, else any port: last resort
      for (const p of free.filter(q => q.kind === 'data')) {
        const hub = nearest(p, q => DATA_ROUTER.test(q.type), load)
          ?? nearest(p, q => COMPUTER.test(q.type))
          ?? nearest(p, () => true);
        if (hub) { link(p, hub); if (DATA_ROUTER.test(hub.type)) load.set(hub.ci, (load.get(hub.ci) ?? 0) + 1); }
      }
    } else {
      // item + unknown kinds: naive pairing
      for (;;) {
        const ports = free.filter(p => p.kind === kind);
        if (ports.length < 2) break;
        const A = ports[0]!;
        const B = nearest(A, () => true);
        if (!B) break;
        link(A, B);
      }
    }
    for (const p of free.filter(q => q.kind === kind))
      skipped.push({ port: p, why: 'no compatible free port remained' });
  }
  return { created: bp.data.pipes.length - created0, skipped };
}
