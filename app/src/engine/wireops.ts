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
const AUTO_KINDS: WireKind[] = ['data', 'lowvoltage', 'highvoltage'];

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
 * NAIVE auto-wiring: per electric kind, repeatedly join the globally nearest
 * pair of free ports living on DIFFERENT components. Writes straight into
 * bp.data.pipes (FLATTENED component indices); the caller mirrors each new
 * pipe into the doc (doc.ts value builder) and reloads the scene.
 */
export function autoWire(bp: Blueprint, manifest: ModelManifest | null): AutoWireResult {
  const flat = flattenComponents(bp);
  const topToFlat = new Map<number, number>();
  flat.forEach((f, i) => { if (f.top >= 0) topToFlat.set(f.top, i); });
  bp.data.pipes = bp.data.pipes ?? [];
  let free = unconnectedPorts(bp, manifest).filter(p => AUTO_KINDS.includes(p.kind));
  const created0 = bp.data.pipes.length;
  const skipped: AutoWireResult['skipped'] = [];
  for (const kind of AUTO_KINDS) {
    for (;;) {
      const ports = free.filter(p => p.kind === kind);
      if (ports.length < 2) break;
      let bi = -1, bj = -1, best = Infinity;
      for (let i = 0; i < ports.length; i++)
        for (let j = i + 1; j < ports.length; j++) {
          if (ports[i]!.ci === ports[j]!.ci) continue;
          const d = Math.hypot(ports[i]!.at[0] - ports[j]!.at[0],
            ports[i]!.at[1] - ports[j]!.at[1], ports[i]!.at[2] - ports[j]!.at[2]);
          if (d < best) { best = d; bi = i; bj = j; }
        }
      if (bi < 0) {
        for (const p of ports) skipped.push({ port: p, why: 'no other component has a free port' });
        free = free.filter(p => p.kind !== kind);
        break;
      }
      const A = ports[bi]!, B = ports[bj]!;
      bp.data.pipes.push({
        a_component: topToFlat.get(A.ci)!, a_port: A.name,
        b_component: topToFlat.get(B.ci)!, b_port: B.name,
        radius: 0.02,
        segments: route(A.at, B.at, kind) as never,
        type: kind,
      } as never);
      free = free.filter(p => p !== A && p !== B);
    }
  }
  return { created: bp.data.pipes.length - created0, skipped };
}
