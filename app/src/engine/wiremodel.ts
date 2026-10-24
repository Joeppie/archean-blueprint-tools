// wiremodel.ts — THE LOGICAL WIRING MODEL (pure). One abstraction the whole
// app shares for what a port IS, which two ports may share a cable, and how
// candidates rank. wireops' auto-wire, the WIRE panel's manual candidate
// list, the balloon tail's coupler-port choice and the cable labels all read
// THIS — the logic lives in exactly one place (user 2026-10-24: "the wiring
// is very naive and stupid right now … try to abstract wiring logic so it
// properly is taken into account and candidates are logically listed by
// distance and normal association … ensure that logical wiring decisions are
// possible for users").
//
// THE EVIDENCE (game files, not taste):
//  • Adapter NAMES carry direction. LowVoltageJunction's .ini is
//    `lowvoltage-input` + `lowvoltage-port.001..004`; HighVoltageJunction and
//    HighVoltageRelay carry `-input`/`-output`; FluidJunction is
//    `fluid-in` + `fluid-out.NNN`; ItemJunction `item-in` + `item-out.NNN`;
//    pumps/tanks/furnaces name their sides `fluid-in`/`fluidout`/`item-out`.
//    A whole-game adapter-name census (107 adapter-bearing types) shows the
//    tokens in/input, out/output are the ONLY direction hints — every other
//    port name (`data`, `connector.000`, `hv1`, `data_port.003`) is neutral.
//  • Names also carry TOPOLOGY: DataBridge's ports are literally
//    `data-computer.1` (faces a Computer) and `data-device.0` (faces a
//    device) — the game itself encodes the computer→router→component chain
//    the user described ("computer->router->components, or
//    battery->junction->multiple devices").
//
// THE MODEL:
//  • PortRole 'in' | 'out' | 'any'  — from the NAME (portRole).
//  • PortGroup 'source' | 'hub' | 'device' — from the TYPE per kind
//    (compGroup): batteries/generators/solar panels produce, junctions/
//    bridges/relays/routers/computers distribute, everything else consumes.
//  • compatible(a, b) — the physics of the game's electrical metaphor:
//    never IN↔IN, never OUT↔OUT, a hub's INPUT faces upstream (sources and
//    hubs, never a device), a hub's OUTPUT ports face downstream (never a
//    source), power never runs device-to-device (it goes through a hub or
//    straight from a source), fluid/item devices may link directly ONLY
//    where both sides are explicitly named (pump `fluid-out` → tank
//    `fluid-in`) — neutral ports route through a junction.
//  • candidatesFor(draft, ports) — the ranking behind the manual picker:
//    tier 0 = the canonical logical step (the game's naming/topology says
//    so), tier 1 = a legitimate alternative (direct source tap, hub
//    cascade), tier 2 = everything else that is compatible; WITHIN a tier,
//    nearest first. This is a SUGGESTION ORDER only — every compatible port
//    stays listed and pickable, and auto-wire never overwrites an existing
//    cable: user decisions always take precedence over the heuristic.
//
// FORMAT §pipes carries the prose write-up; wiremodel.test.ts pins the
// naming census, the role table, the compatibility matrix and the ranking.

import type { WireKind } from './sockets';
export type { WireKind };

export type PortRole = 'in' | 'out' | 'any';
export type PortGroup = 'source' | 'hub' | 'device';

/** direction token census of the game's 330 adapter names: split on
 *  [-_.digits], a token equal to / ending in in|input ⇒ IN, out|output ⇒
 *  OUT. 'fluidin'/'itemout2' ride the endsWith arms; 'connector',
 *  'power_connector' and 'lowvoltage-port.001' stay neutral (any). */
export function portRole(name: string): PortRole {
  const toks = name.toLowerCase().split(/[-_.0-9]+/).filter(Boolean);
  for (const t of toks) {
    if (t === 'out' || t === 'output' || t.endsWith('out') || t.endsWith('output')) return 'out';
  }
  for (const t of toks) {
    if (t === 'in' || t === 'input' || t.endsWith('in') || t.endsWith('input')) return 'in';
  }
  return 'any';
}

/** the game's own TOPOLOGY hint (DataBridge: `data-computer.N` /
 *  `data-device.N`): which SIDE of a link the name demands. */
export function portHint(name: string): 'computer' | 'device' | null {
  const n = name.toLowerCase();
  if (/(^|[-_.0-9])computer([-_.0-9]|$)/.test(n)) return 'computer';
  if (/(^|[-_.0-9])device([-_.0-9]|$)/.test(n)) return 'device';
  return null;
}

const COMPUTER = /^(Computer|MiniComputer)$/;
const DATA_HUB = /^(DataJunction|DataBridge|Router|MiniRouter|Computer|MiniComputer)$/;
const POWER_HUB = /(Junction|Bridge|Relay)$/;
const FLUID_HUB = /^(FluidJunction|FluidBridge)$/;
const ITEM_HUB = /^(ItemJunction|ItemBridge)$/;
/** power PRODUCERS (kind lowvoltage/highvoltage): these feed, never sink.
 *  PowerConverter is a producer of LOW voltage and a consumer of HIGH, so
 *  the table keys per kind. DieselGenerator produces hv AND lv (fuel side
 *  stays a device). Turbines/geothermal/reactors convert; batteries store —
 *  storage is still a source for wiring (a cable leaves a battery). */
const POWER_SOURCE: Record<string, WireKind[]> = {
  LowVoltageBattery: ['lowvoltage'],
  HighVoltageBattery: ['highvoltage'],
  SolarPanel: ['lowvoltage'],
  RTG: ['lowvoltage'],
  DieselGenerator: ['lowvoltage', 'highvoltage'],
  GeothermalExchanger: ['lowvoltage'],
  SteamTurbine: ['highvoltage'],
  SmallSteamTurbine: ['highvoltage'],
  FissionReactor: ['lowvoltage'],
  PowerConverter: ['lowvoltage'],
};
/** kinds where an unnamed device-to-device cable is meaningless wiring
 *  (electricity); fluid/item direct edges exist but only as NAMED flows. */
const isPower = (k: WireKind) => k === 'lowvoltage' || k === 'highvoltage';

/** what a component's ports of kind `kind` DO in the grid: produce, route
 *  or consume. The same type can differ per kind (PowerConverter). */
export function compGroup(type: string, kind: WireKind): PortGroup {
  if ((POWER_SOURCE[type] ?? []).includes(kind)) return 'source';
  if (isPower(kind)) return POWER_HUB.test(type) ? 'hub' : 'device';
  if (kind === 'data') return DATA_HUB.test(type) ? 'hub' : 'device';
  if (kind === 'fluid') return FLUID_HUB.test(type) ? 'hub' : 'device';
  return ITEM_HUB.test(type) ? 'hub' : 'device';
}

/** identity used inside compatibility callbacks: ci+kind of one component */
export const portKey = (ci: number, kind: WireKind) => `${ci}/${kind}`;

/** which (component, kind) pairs OWN an input-role port — the junction vs
 *  bridge distinction: a LowVoltageJunction's neutral `lowvoltage-port.NNN`
 *  ports are DOWNSTREAM outputs precisely because the part also has an
 *  `-input`; a LowVoltageBridge's `port1/port2` have no such anchor, so
 *  they are two-way links. Built from the full port census (wired included).
 *  A device's named `fluid-in` does NOT qualify — only hubs get the split. */
export function hubInputIndex(ports: readonly { ci: number; kind: WireKind; role: PortRole;
  group: PortGroup }[]): Set<string> {
  const out = new Set<string>();
  for (const p of ports)
    if (p.group === 'hub' && p.role === 'in') out.add(portKey(p.ci, p.kind));
  return out;
}

/** why two ports must NOT share a cable (null = compatible). */
export function incompatReason(a: { type: string; kind: WireKind; name: string; ci: number;
  role: PortRole; group: PortGroup },
b: typeof a, hubIn: ReadonlySet<string>): string | null {
  if (a.kind !== b.kind) return 'different cable kinds';
  if (a.role === 'in' && b.role === 'in') return 'both ports are inputs';
  if (a.role === 'out' && b.role === 'out') return 'both ports are outputs';
  // a hub INPUT faces upstream: sources and other hubs, never a device
  if (a.group === 'hub' && a.role === 'in' && b.group === 'device')
    return 'a hub input takes power/network upstream, not from a device';
  if (b.group === 'hub' && b.role === 'in' && a.group === 'device')
    return 'a hub input takes power/network upstream, not from a device';
  // a hub port on a part WITH inputs (junction-style) is downstream: never
  // aimed back at a producer (that is the rudder/junction bug: the junction
  // input stays for the battery, devices only ever take from the outputs)
  if (a.group === 'hub' && a.role !== 'in' && b.group === 'source'
      && hubIn.has(portKey(a.ci, a.kind)))
    return 'a hub output feeds downstream, not back into a source';
  if (b.group === 'hub' && b.role !== 'in' && a.group === 'source'
      && hubIn.has(portKey(b.ci, b.kind)))
    return 'a hub output feeds downstream, not back into a source';
  // power never runs device↔device (hinge→lamp is junk wiring); it either
  // leaves a source or rides a hub's output port
  if (isPower(a.kind) && a.group === 'device' && b.group === 'device')
    return 'power runs source→hub→device, never device-to-device';
  // fluid/item direct edges exist (pump→tank) but ONLY as named flows;
  // neutral-to-neutral goes through a junction
  if ((a.kind === 'fluid' || a.kind === 'item') && a.group === 'device' && b.group === 'device'
      && a.role === 'any' && b.role === 'any')
    return `no ${a.kind} junction between two neutral ports`;
  return null;
}

export function compatible(a: Parameters<typeof incompatReason>[0],
  b: Parameters<typeof incompatReason>[0], hubIn: ReadonlySet<string>): boolean {
  return incompatReason(a, b, hubIn) == null;
}

/** A port as the model sees it: the census record + its role and group. */
export interface WirePort {
  ci: number; type: string; name: string; kind: WireKind;
  at: readonly [number, number, number];
  role: PortRole;
  group: PortGroup;
}

/** the logical rank of pairing draft d with candidate q.
 *  tier 0 = the game's own association says so (named hints, device→hub,
 *  source→hub input, hub output→device); tier 1 = legitimate alternatives
 *  (direct source tap, hub↔hub cascade, named direct fluid edge);
 *  tier 2 = any other compatible pairing. */
export function candidateTier(d: WirePort, q: WirePort, hubIn: ReadonlySet<string>):
  { tier: number; why: string } {
  const hint = pairHint(d, q);
  if (hint) return { tier: 0, why: hint };
  if (d.group === 'device' && q.group === 'hub' && q.role !== 'in')
    return { tier: 0, why: 'device ← hub' };
  if (d.group === 'source' && q.group === 'hub'
      && (q.role === 'in' || !hubIn.has(portKey(q.ci, q.kind))))
    return { tier: 0, why: 'feeds a hub input' };
  if (d.group === 'hub' && d.role === 'in'
      && (q.group === 'source' || (q.group === 'hub' && q.role !== 'in')))
    return { tier: 0, why: 'hub input ← upstream' };
  if (d.group === 'hub' && d.role !== 'in' && hubIn.has(portKey(d.ci, d.kind))
      && q.group === 'device')
    return { tier: 0, why: 'hub output → device' };
  if (d.group === 'source' && q.group === 'device')
    return { tier: 1, why: 'direct from a source' };
  if (d.group === 'hub' && q.group === 'hub')
    return { tier: 1, why: 'hub ↔ hub link' };
  if (d.group === 'source' && q.group === 'source')
    return { tier: 1, why: 'sources in parallel' };
  return { tier: 2, why: 'compatible link' };
}

const isComputerType = (t: string) => COMPUTER.test(t);
/** the game-named side match: DataBridge `data-computer.N` ↔ a Computer,
 *  `data-device.N` ↔ anything that is not a computer hub of that kind. */
function pairHint(d: WirePort, q: WirePort): string | null {
  const hd = portHint(d.name), hq = portHint(q.name);
  if (hd === 'computer' && isComputerType(q.type)) return 'named computer side';
  if (hq === 'computer' && isComputerType(d.type)) return 'named computer side';
  if (hd === 'device' && !isComputerType(q.type) && q.group !== 'hub') return 'named device side';
  if (hq === 'device' && !isComputerType(d.type) && d.group !== 'hub') return 'named device side';
  return null;
}

export interface RankedCandidate { port: WirePort; tier: number; why: string; dist: number }

/** ranked candidates for a manual pairing: every COMPATIBLE free port,
 *  ordered by logical tier, then by load (hubs spread), then by distance.
 *  The ranking orders the list; it never removes pickable options. */
export function candidatesFor(d: WirePort, free: readonly WirePort[],
  hubIn: ReadonlySet<string>,
  load?: Map<string, number>): RankedCandidate[] {
  const out: RankedCandidate[] = [];
  for (const q of free) {
    if (q.ci === d.ci) continue;
    if (incompatReason(d, q, hubIn)) continue;
    const { tier, why } = candidateTier(d, q, hubIn);
    const dist = Math.hypot(d.at[0] - q.at[0], d.at[1] - q.at[1], d.at[2] - q.at[2]);
    out.push({ port: q, tier, why, dist });
  }
  const ld = (p: WirePort) => (load?.get(portKey(p.ci, p.kind)) ?? 0);
  out.sort((a, b) => a.tier - b.tier
    || (a.tier === 0 && (ld(a.port) - ld(b.port)))
    || a.dist - b.dist);
  return out;
}
