// power.ts — IS THE COMPUTER WIRED TO POWER? (pure, no THREE, no DOM).
//
// THE GAME LAW (wiki Computer.md / energy components; AGENTS §wiremodel):
// electricity leaves a POWER SOURCE (battery/generator/reactor/solar/RTG),
// rides low-voltage or high-voltage cables — straight to a device or through
// HUBS (junctions/bridges/relays) — and every consumer runs only while its
// power port sits on an energised net. A computer with no power cable does
// not boot in the game, and a program's `enough_power` reads false.
//
// THE MODEL: the wiremodel's source/hub/device groups over the recorded
// data.pipes graph, per kind. Power flows SOURCE → hub → DEVICE; a hub
// conducts between every power cable on its body (the junction's `-input`
// is the game's own direction hint, wiremodel's hubInputIndex). device↔device
// power runs are the junk wiring wiremodel refuses, so they carry nothing.
// LOW and HIGH voltage are separate nets (a PowerConverter bridges them and
// is itself a low-voltage source — POWER_SOURCE in wiremodel).
//
// THE DEV-CRAFT CONVENTION: a craft that carries NO power source at all is
// power-UNAWARE (`hasPower` false): the tool has always run every computer
// on such crafts, and the corpus is full of test benches with no grid. The
// moment a craft HAS a grid, the law applies per component and an
// unconnected computer is UNPOWERED — the editor warns on interaction and
// the auto-boot leaves it off (in-game it is dead metal).
//
// relays conduct (their gate state is not stored in the corpus's pipes);
// the device's OWN power draw is not modelled — reachability only.

import type { Blueprint, BlueprintComponent } from './format';
import type { ModelManifest } from './models';
import { compGroup, portRole, type PortRole } from './wiremodel';

export type PowerKind = 'lowvoltage' | 'highvoltage';

const isPowerKind = (k: string | undefined): k is PowerKind =>
  k === 'lowvoltage' || k === 'highvoltage';

/** cable kind of a pipe end: the recorded `type`, then the manifest adapter,
 *  then the port-name prefix (power_connector → lowvoltage, the manifest
 *  truth for Computer/MiniComputer). */
export function pipeKind(p: { type?: string }, a: { type: string; port: string },
  b: { type: string; port: string }, manifest: ModelManifest | null): string | undefined {
  if (isPowerKind(p.type)) return p.type;
  const names = [a.port, b.port];
  for (const n of names) {
    const nl = n.toLowerCase();
    if (nl.startsWith('lowvoltage') || nl === 'power_connector') return 'lowvoltage';
    if (nl.startsWith('highvoltage') || nl.startsWith('hv')) return 'highvoltage';
  }
  // manifest adapter type on either end (types are 'lowvoltage'|'highvoltage'|'data'…)
  for (const s of [a, b]) {
    const ads = manifest?.[s.type]?.adapters;
    const ad = ads?.find(x => x.name === s.port);
    if (ad && isPowerKind(ad.type)) return ad.type;
  }
  return p.type;
}

export interface PowerNet {
  /** the craft carries at least one power source → the power LAW applies */
  hasPower: boolean;
  /** ci of every component an energised power net reaches (hubs included) */
  powered: Set<number>;
  /** ci of the power sources found */
  sources: number[];
}

interface Edge { a: number; b: number; kind: PowerKind; aRole: PortRole; bRole: PortRole }

/** full power-reachability pass over one blueprint */
export function craftPowerNet(bp: Blueprint, manifest: ModelManifest | null): PowerNet {
  const comps = bp.data.components as BlueprintComponent[];
  const sources: number[] = [];
  const groupOf = (ci: number, kind: PowerKind) => compGroup(comps[ci]?.type ?? '', kind);
  for (let ci = 0; ci < comps.length; ci++)
    for (const k of ['lowvoltage', 'highvoltage'] as PowerKind[])
      if (groupOf(ci, k) === 'source') { sources.push(ci); break; }
  const net: PowerNet = { hasPower: sources.length > 0, powered: new Set(), sources };
  if (!net.hasPower) return net;

  const edges: Edge[] = [];
  for (const p of (bp.data.pipes ?? []) as { type?: string; a_component: number; a_port: string;
    b_component: number; b_port: string }[]) {
    const kind = pipeKind(p,
      { type: comps[p.a_component]?.type ?? '', port: p.a_port },
      { type: comps[p.b_component]?.type ?? '', port: p.b_port }, manifest);
    if (!isPowerKind(kind)) continue;
    if (p.a_component === p.b_component) continue;
    if (!comps[p.a_component] || !comps[p.b_component]) continue;
    const ga = groupOf(p.a_component, kind), gb = groupOf(p.b_component, kind);
    const aRole = portRole(p.a_port), bRole = portRole(p.b_port);
    // the wiremodel's physics: power never runs device↔device, never into a
    // hub's INPUT from downstream, never OUT↔OUT / IN↔IN
    if (ga === 'device' && gb === 'device') continue;
    if (aRole === 'in' && bRole === 'in') continue;
    if (aRole === 'out' && bRole === 'out') continue;
    if ((ga === 'hub' && aRole === 'in' && gb === 'device')
      || (gb === 'hub' && bRole === 'in' && ga === 'device')) continue;
    edges.push({ a: p.a_component, b: p.b_component, kind, aRole, bRole });
  }

  // BFS: a source energises its net; a hub conducts to every edge on its
  // body; a device is terminal. A hub OUTPUT facing a source is a no-op
  // (the source is energised anyway — the junction rudder-bug rule).
  const energised = new Set<number>();
  const q: number[] = [...sources];
  for (const s of sources) energised.add(s);
  while (q.length) {
    const ci = q.shift()!;
    for (const e of edges) {
      const other = e.a === ci ? e.b : e.b === ci ? e.a : -1;
      if (other < 0 || energised.has(other)) continue;
      const og = groupOf(other, e.kind);
      if (og === 'hub') { energised.add(other); q.push(other); }
      else if (og === 'device') energised.add(other);
      // hub→hub conduction is symmetric here; relays conduct (see header)
    }
  }
  net.powered = energised;
  return net;
}

/** a programmable component the game would run (power-wise): the craft has
 *  no grid at all → true (dev-craft convention); with a grid → only nets
 *  reaching the component's power port count. */
export function computerPowered(net: PowerNet, ci: number): boolean {
  return !net.hasPower || net.powered.has(ci);
}
