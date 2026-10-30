// energy.ts — THE POWER FLOW (v1.16.10 "warnings only: batteries always
// feed, drain, go NEGATIVE"). engine/power.ts answers IS a part on an
// energised net; this module answers WHO FEEDS WHOM: every source on the
// grid PRODUCEs (wiki watts), every powered consumer DRAWs, and the
// balance flows through the BATTERIES — charge integrates per cycle, the
// deficit deep-discharges (charge may go NEGATIVE) and the grid keeps
// feeding: a flat battery is a WARNING, never a blackout (the editor's
// law the sim upholds; in-game a dead battery does brown out, the editor
// must not fight the builder over it).
//
// SIM IS A VIEW: nothing writes the blueprint. PURE: no THREE, no DOM —
// vitest pins every rate. The numbers come from the shipped wiki
// (wiki/en/components/**):
//   SolarPanel 2700 W (atmosphere, best light) · RTG 12 kW ·
//   DieselGenerator 150 kW (HV; data-port ch0 switches it ON) ·
//   SteamTurbine 27 MW / SmallSteamTurbine 270 kW (steam-fed: they produce
//   only while a heat source — FissionReactor / GeothermalExchanger —
//   rides the craft) · the reactors themselves rate 0 (they make HEAT).
//   Consumers: Computer/MiniComputer 30 W idle · Router/MiniRouter 50 W ·
//   Crafter 500 W idle (10 kW working — idle is the modelled seat) ·
//   Nav 200 W · lamps at their authored maxPower, on when ch0 · propellers
//   & wheels at their class rating when the speed channel is live ·
//   MiningDrill 10 kW (LV) / 100 kW (HV) while anchored and drilling ·
//   ItemConveyor 100 W per running belt (flow-proportional in the game —
//   the base is the modelled seat) · servos 100 W while driving.
// Battery seats: LowVoltageBattery 10 kWh, HighVoltageBattery 120 kWh
// (wiki energy/battery/*), authored charged → start FULL.

import type { Blueprint, BlueprintComponent } from './format';
import type { PowerNet } from './power';
import { flatToTopMap, flatEndpointTop } from './flat';

const num = (d: Record<string, unknown> | undefined, k: string, def = 0): number =>
  typeof d?.[k] === 'number' ? (d[k] as number) : def;

/** rated production W per source type (steam-fed turbines gate on a heat
 *  source riding the craft; reactors are the heat, not the watts) */
const SOURCE_W: Record<string, number> = {
  SolarPanel: 2700,
  RTG: 12_000,
  DieselGenerator: 150_000,
  SteamTurbine: 27_000_000,
  SmallSteamTurbine: 270_000,
  FissionReactor: 0,
  GeothermalExchanger: 0,
  ChemicalReactor: 0,
};
/** steam-fed producers need one of these riding the craft (the fluid loop
 *  is not modelled — presence is the gate, honest to the editor tier) */
const HEAT_SOURCES = new Set(['FissionReactor', 'GeothermalExchanger', 'ChemicalReactor']);
/** data-gated producers: wiki says the data port switches them on */
const DATA_GATED_SOURCES = new Set(['DieselGenerator']);

/** rated draw W per consumer type (lamps read their authored maxPower;
 *  gates below decide when the rating applies) */
const CONSUMER_W: Record<string, number> = {
  Computer: 30, MiniComputer: 30,
  Router: 50, MiniRouter: 50,
  Crafter: 500,
  NavInstrument: 200, MiniNavInstrument: 50,
  Beacon: 100,
  GroundAnchor: 0, Container: 0, TrashCan: 0,
  DataBridge: 0, DataJunction: 0, DataFilter: 0,
  LowVoltageJunction: 0, HighVoltageJunction: 0,
  LowVoltageBridge: 0, HighVoltageBridge: 0,
  LowVoltageRelay: 5, HighVoltageRelay: 5, PowerConverter: 10,
  PilotSeat: 0, Dashboard: 20, Keyboard: 10, Numpad: 10,
  PushButton: 0, ToggleButton: 0, ArrowButton: 0, ThrottleLever: 0,
  Aileron: 50, Elevator: 50, Rudder: 50,
  SmallPivot: 100, SmallHinge: 100, LinearTrack: 100,
  Propeller: 50_000, SmallWheel: 5_000, Wheel: 10_000, BigWheel: 20_000,
  RCS: 2_000, RCS500: 2_000, Thruster: 5_000,
  SmallTurboPump: 1_000, TurboPump: 5_000, FluidValve: 50, SolenoidValve: 50,
  Radiator: 100,
  Crusher: 2_000, Furnace: 10_000, ChemicalFurnace: 5_000,
  Electrolyser: 5_000, SabatierReactor: 5_000, EnrichmentCentrifuge: 5_000,
  ItemConveyor: 100, ItemJunction: 10, ItemBridge: 10,
  SolarSensor: 5, TemperatureSensor: 10, SpeedSensor: 20, DensitySensor: 20,
  AngularVelocitySensor: 20, VehiclePhysicsSensor: 50,
  DockingPort: 50, Hitch: 0, OwnerPad: 0,
  FluidTank: 0, FluidPort: 0,
};
/** the lamp family: on = channel 0 truthy, draw = authored maxPower */
const LAMP_TYPES = new Set(['Lamp', 'SpotLight', 'SlopeLight']);
/** speed/deflection-gated: the rating applies while a channel is live */
const MOTION_TYPES = new Set(['Propeller', 'Wheel', 'BigWheel', 'SmallWheel',
  'RCS', 'RCS500', 'Thruster', 'Aileron', 'Elevator', 'Rudder',
  'SmallPivot', 'SmallHinge', 'LinearTrack']);
/** conveyors run when ON (ch0) — no record = the authored default ON */
const BELT_TYPES = new Set(['ItemConveyor']);

const BATTERY_WH: Record<string, number> = {
  LowVoltageBattery: 10_000,
  HighVoltageBattery: 120_000,
};

export interface EnergyStatus {
  /** the craft carries power sources at all (the dev-craft convention:
   *  a grid-less craft is power-UNAWARE — the chip hides) */
  hasGrid: boolean;
  productionW: number;
  demandW: number;
  /** production − demand (negative = draining the batteries) */
  surplusW: number;
  batteryWh: number;
  batteryCapacityWh: number;
  /** min across batteries — one empty cell warns (never blackouts) */
  batteryMinPct: number;
  /** deep-discharged cells (charge < 0) */
  drained: number;
  status: 'ok' | 'charging' | 'low' | 'deficit';
  /** per-source rated W (census for the readout) */
  sources: { type: string; count: number; watts: number }[];
  consumers: { type: string; count: number; watts: number }[];
}

interface Battery { ci: number; capacityWh: number; chargeWh: number }

export class EnergySim {
  private sources: { ci: number; type: string; watts: number }[] = [];
  private consumers: { ci: number; type: string; watts: number }[] = [];
  private batteries: Battery[] = [];
  /** bus gates: devCi -> ch -> value (the devicesim tap feeds this) */
  private chans = new Map<number, Map<number, number>>();
  private anchored = false;
  private hasHeat = false;
  private hasGrid = false;
  private powered = new Set<number>();

  /** (re)derive the census from a blueprint + the reachability net. */
  load(bp: Blueprint, net: PowerNet | null): void {
    const comps = bp.data.components as BlueprintComponent[];
    this.sources = []; this.consumers = []; this.batteries = [];
    this.anchored = false; this.hasHeat = false; this.drillMap = null;
    for (const c of comps) {
      if (c.type === 'GroundAnchor') this.anchored = true;
      if (HEAT_SOURCES.has(c.type)) this.hasHeat = true;
    }
    comps.forEach((c, ci) => {
      const energised = !net || !net.hasPower || net.powered.has(ci);
      const src = SOURCE_W[c.type];
      if (src !== undefined) {
        const steam = c.type === 'SteamTurbine' || c.type === 'SmallSteamTurbine';
        this.sources.push({ ci, type: c.type, watts: steam && !this.hasHeat ? 0 : src });
        return;
      }
      const wh = BATTERY_WH[c.type];
      if (wh !== undefined) {
        // the game authors `charged: true` on a fresh battery → start full
        const charged = (c.data as Record<string, unknown> | undefined)?.charged !== false;
        this.batteries.push({ ci, capacityWh: wh, chargeWh: charged ? wh : 0 });
        return;
      }
      let watts = CONSUMER_W[c.type];
      if (watts === undefined) watts = 50;           // unlisted part: a fair 50 W
      if (LAMP_TYPES.has(c.type))
        watts = num(c.data as Record<string, unknown>, 'maxPower', watts);
      if (c.type === 'MiningDrill') {
        // the net VOLTAGE rates the drill: 10 kW on LV, 100 kW on HV
        // (pipe endpoints are FLATTENED — engine/flat.ts)
        const fmap = this.drillMap ?? (this.drillMap = flatToTopMap(bp));
        const hv = ((bp.data as Record<string, unknown>).pipes as { a_component: number;
          b_component: number; type?: string }[] ?? []).some(p => {
          const a = flatEndpointTop(fmap, p.a_component), b = flatEndpointTop(fmap, p.b_component);
          return (a === ci || b === ci) && p.type === 'highvoltage';
        });
        watts = hv ? 100_000 : 10_000;
      }
      this.consumers.push({ ci, type: c.type, watts });
      if (energised) this.powered.add(ci);
    });
    this.hasGrid = this.sources.length > 0 || this.batteries.length > 0;
  }
  private drillMap: (number | null)[] | null = null;

  /** the actuator/bus tap (the Editor wires observeDevices here). */
  write(devCi: number, ch: number, v: number): void {
    let m = this.chans.get(devCi);
    if (!m) this.chans.set(devCi, m = new Map());
    m.set(ch, v);
  }
  clear(): void {
    this.chans = new Map();
    for (const b of this.batteries) b.chargeWh = b.capacityWh;
  }

  /** live draw of one consumer given the gates (0 = idle/off) */
  private demandOf(ci: number, type: string, watts: number): number {
    const ch = this.chans.get(ci);
    if (LAMP_TYPES.has(type)) return (ch?.get(0) ?? 0) > 0 ? watts : 0;
    if (BELT_TYPES.has(type)) {
      const on = ch?.get(0);
      return (on === undefined ? 1 : on > 0) ? watts : 0;   // authored ON default
    }
    if (MOTION_TYPES.has(type)) return (ch?.get(0) ?? 0) !== 0 ? watts : 0;
    if (type === 'MiningDrill') return this.anchored ? watts : 0;
    return watts;                                            // powered = draws
  }
  private sourceOn(type: string, ci: number): boolean {
    if (DATA_GATED_SOURCES.has(type)) return (this.chans.get(ci)?.get(0) ?? 0) > 0;
    if ((type === 'SteamTurbine' || type === 'SmallSteamTurbine') && !this.hasHeat) return false;
    return true;
  }

  /** one 25 Hz step: integrate the battery flow. dt SECONDS. */
  step(dt: number): void {
    if (!this.hasGrid || !this.batteries.length) return;
    const s = this.state();
    const wh = (s.surplusW * dt) / 3600;
    if (!wh) return;
    // share the flow by capacity (parallel pack, the game's own wiring)
    const cap = this.batteries.reduce((a, b) => a + b.capacityWh, 0) || 1;
    for (const b of this.batteries) {
      b.chargeWh += wh * (b.capacityWh / cap);
      // ALWAYS feeds: charge may go NEGATIVE (deep discharge) — the floor
      // is one full capacity below zero, the warning is the law.
      if (b.chargeWh > b.capacityWh) b.chargeWh = b.capacityWh;
      if (b.chargeWh < -b.capacityWh) b.chargeWh = -b.capacityWh;
    }
  }

  state(): EnergyStatus {
    let productionW = 0, demandW = 0;
    const bySrc = new Map<string, { count: number; watts: number }>();
    const byCon = new Map<string, { count: number; watts: number }>();
    for (const s of this.sources) {
      if (!this.sourceOn(s.type, s.ci)) continue;
      productionW += s.watts;
      const r = bySrc.get(s.type) ?? { count: 0, watts: 0 };
      r.count++; r.watts += s.watts; bySrc.set(s.type, r);
    }
    for (const c of this.consumers) {
      const w = this.demandOf(c.ci, c.type, c.watts);
      if (w <= 0) continue;
      demandW += w;
      const r = byCon.get(c.type) ?? { count: 0, watts: 0 };
      r.count++; r.watts += w; byCon.set(c.type, r);
    }
    const batteryCapacityWh = this.batteries.reduce((a, b) => a + b.capacityWh, 0);
    const batteryWh = this.batteries.reduce((a, b) => a + Math.max(0, b.chargeWh), 0);
    const minPct = this.batteries.length
      ? Math.min(...this.batteries.map(b => b.chargeWh / b.capacityWh)) * 100
      : (productionW >= demandW ? 100 : 0);
    const surplusW = productionW - demandW;
    const drained = this.batteries.filter(b => b.chargeWh < 0).length;
    let status: EnergyStatus['status'] = 'ok';
    if (this.batteries.length && minPct <= 0 && surplusW < 0) status = 'deficit';
    else if (minPct < 10 && surplusW <= 0) status = 'low';
    else if (surplusW > 0 && minPct < 100) status = 'charging';
    return {
      hasGrid: this.hasGrid, productionW, demandW, surplusW,
      batteryWh, batteryCapacityWh, batteryMinPct: minPct, drained, status,
      sources: [...bySrc.entries()].map(([type, r]) => ({ type, ...r }))
        .sort((a, b) => b.watts - a.watts),
      consumers: [...byCon.entries()].map(([type, r]) => ({ type, ...r }))
        .sort((a, b) => b.watts - a.watts),
    };
  }
}

/** "12.4 kW" / "340 W" / "27.0 MW" for the chip and panels */
export function fmtW(w: number): string {
  const a = Math.abs(w);
  if (a >= 1e6) return `${(w / 1e6).toFixed(1)} MW`;
  if (a >= 1e3) return `${(w / 1e3).toFixed(a >= 1e5 ? 0 : 1)} kW`;
  return `${Math.round(w)} W`;
}
