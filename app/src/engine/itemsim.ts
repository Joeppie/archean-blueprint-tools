// itemsim.ts — ITEMS ON BELTS (v1.16.10 WP6 "we should be able to flow
// items through a conveyor and simulate the mining of Rock"). SIM IS A
// VIEW like devicesim: items, rates and container contents are a render/
// census overlay — nothing writes the blueprint.
//
// THE GAME LAWS (wiki/en/components):
//  • items/ItemConveyor.md — pulls items at the input, pushes at the
//    output; ch0 ON (no record = the authored ON), flow-gated rates;
//  • items/ItemJunction.md / items/ItemBridge.md — item conduits (1 m
//    parts that route the flow);
//  • mining/MiningDrill.md — pushes ROCKS: 10/s at 10 kW (LV), 100/s at
//    100 kW (HV); the build must be ANCHORED (miscellaneous/GroundAnchor
//    .md: data 0/1, needs no power);
//  • storage/Container.md — 50 slots, accepts Push/Pull, NEVER pushes;
//    its data port publishes the content as a `.item{count}` KV text;
//  • processing/Crusher.md — rock in, crushed output (stylised 1:1,
//    Rock → CrushedRock);
//  • miscellaneous/Crafter.md — accepts items, crafts with the world's
//    recipes (engine/economy.ts carries the game's recipe table); the
//    sim consumes inputs from the linked containers every recipe time
//    and produces the output back into them (the stylised seat of the
//    Crafter installation — the built-in program rides the farm).
//
// LINKING: two item parts are wired when their occupancy AABBs touch
// (gap ≤ 0.8 m — the ItemJunction/ItemBridge span, measured on Jimmy's
// Adventure 3334698274). Flow: each source BFSes the shortest path to
// the nearest sink and pushes along it.
//
// PURE: no THREE, no DOM.

import type { Blueprint, BlueprintComponent } from './format';

const CELL = 0.25;
const LINK_GAP = 0.8;          // metres: conduits span, parts "touch"
const HOP_SPEED = 1.25;        // m/s along a link (conveyor cadence)
const MAX_FLY = 240;           // in-flight cap (editor perf)
const CONTAINER_CAP = 50 * 8;  // 50 slots ≈ 8 items per slot stack

export type ItemRole = 'source' | 'relay' | 'process' | 'sink';
const ROLE: Record<string, ItemRole> = {
  MiningDrill: 'source',
  ItemConveyor: 'relay',
  ItemJunction: 'relay',
  ItemBridge: 'relay',
  Crusher: 'process',
  Furnace: 'process', ChemicalFurnace: 'process',
  Crafter: 'sink',
  Container: 'sink',
  TrashCan: 'sink',
};

export interface ItemNode {
  ci: number; type: string; alias: string; role: ItemRole;
  x: number; y: number; z: number;                     // AABB centre
  box: [number, number][];                            // [[lo,hi] × 3]
  hv: boolean;                                         // drill: HV net licence
}
export interface ItemLink { a: number; b: number; dist: number; ax: number; ay: number; az: number }
export interface FlyingItem { item: string; from: number; to: number; t: number }

/** the census chip/panel read (Editor heartbeat, 1.6 Hz) */
export interface ItemSimCensus {
  containers: { alias: string; ci: number; counts: Record<string, number> }[];
  flying: number;
  mined: number;
  crafted: number;
  linked: number;
  sources: number;
}

interface Container { ci: number; counts: Map<string, number> }

/** occupancy AABB in the craft frame as three [lo, hi] spans (FORMAT
 *  §grid maths; an empty occupancy list falls back to position ± half a
 *  cell) */
function aabbOf(c: BlueprintComponent): [number, number][] {
  const occ = (c as { occupancies?: { frame_x: number; frame_y: number; frame_z: number;
    pos_x: number; pos_y: number; pos_z: number; size_x: number; size_y: number;
    size_z: number }[] }).occupancies ?? [];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const o of occ) {
    const fr = [o.frame_x, o.frame_y, o.frame_z], ps = [o.pos_x, o.pos_y, o.pos_z],
      sz = [o.size_x, o.size_y, o.size_z];
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a]!, fr[a]! * 3 + (ps[a]! - 5.5) * CELL);
      hi[a] = Math.max(hi[a]!, fr[a]! * 3 + (ps[a]! + sz[a]! + 1 - 5.5) * CELL);
    }
  }
  if (!isFinite(lo[0]!)) {
    const p = [c.position.x, c.position.y, c.position.z];
    for (let a = 0; a < 3; a++) { lo[a] = p[a]! - CELL / 2; hi[a] = lo[a]! + CELL / 2; }
  }
  return [[lo[0]!, hi[0]!], [lo[1]!, hi[1]!], [lo[2]!, hi[2]!]];
}
const gapOf = (a: [number, number], b: [number, number]): number =>
  Math.max(0, a[0] - b[1], b[0] - a[1]);

/** the Crafter's stylised craft cycle: the game's own recipe table
 *  (economy.json, engine/economy.ts twin) — the sim picks the FIRST
 *  recipe whose inputs the linked containers can fully pay for. */
export interface RecipeLite { name: string; in: Record<string, number>; time: number }

export class ItemSim {
  nodes: ItemNode[] = [];
  links: ItemLink[] = [];
  flying: FlyingItem[] = [];
  containers = new Map<number, Container>();
  /** per-source throttle accumulators (ci -> seconds until next spawn) */
  private nextSpawn = new Map<number, number>();
  private elapsed = 0;
  mined = 0;
  crafted = 0;
  private chans = new Map<number, Map<number, number>>();
  private anchored = false;
  /** powered census (from the energy/power net): ci set of energised parts;
   *  a grid-UNAWARE craft (net.hasPower false → null census) runs all */
  private powered = new Set<number>();
  private powerAware = false;
  /** the craft's item census, keyed by container alias (the data-port law) */
  private recipes: RecipeLite[] = [];
  private craftNext = 0;

  /** (re)build the graph from a blueprint. `powered` gates sources;
   *  `recipes` (engine/economy.ts census) enable the Crafter cycle. */
  load(bp: Blueprint, powered: Set<number> | null, recipes: RecipeLite[] = []): void {
    const comps = bp.data.components as BlueprintComponent[];
    this.nodes = [];
    comps.forEach((c, ci) => {
      const role = ROLE[c.type];
      if (!role) return;
      const box = aabbOf(c);
      this.nodes.push({
        ci, type: c.type, alias: c.alias ?? '', role,
        box,
        x: (box[0]![0] + box[0]![1]) / 2, y: (box[1]![0] + box[1]![1]) / 2,
        z: (box[2]![0] + box[2]![1]) / 2,
        hv: c.type === 'MiningDrill' && ((bp.data as Record<string, unknown>).pipes as
          { a_component: number; b_component: number; type?: string }[] ?? [])
          .some(p => (p.a_component === ci || p.b_component === ci) && p.type === 'highvoltage'),
      });
    });
    this.links = [];
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i]!, b = this.nodes[j]!;
        const g = Math.max(gapOf(a.box[0]!, b.box[0]!), gapOf(a.box[1]!, b.box[1]!),
          gapOf(a.box[2]!, b.box[2]!));
        if (g > LINK_GAP) continue;
        const dist = Math.max(0.25, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
        this.links.push({ a: i, b: j, dist, ax: 0, ay: 0, az: 0 });
      }
    }
    this.containers = new Map();
    for (const n of this.nodes)
      if (n.role === 'sink' && n.type === 'Container')
        this.containers.set(n.ci, { ci: n.ci, counts: new Map() });
    this.powerAware = powered !== null;
    this.powered = powered ?? new Set(this.nodes.map(n => n.ci));
    this.anchored = comps.some(c => c.type === 'GroundAnchor');
    this.recipes = [...recipes].sort((x, y) => x.time - y.time);
    this.flying = [];
    this.nextSpawn = new Map();
  }

  write(devCi: number, ch: number, v: number): void {
    let m = this.chans.get(devCi);
    if (!m) this.chans.set(devCi, m = new Map());
    m.set(ch, v);
  }
  clear(): void {
    this.flying = []; this.containers = new Map(); this.mined = 0; this.crafted = 0;
    this.chans = new Map(); this.nextSpawn = new Map();
  }

  private chan(ci: number, ch: number): number | undefined {
    return this.chans.get(ci)?.get(ch);
  }
  private nodeCi(i: number): number { return this.nodes[i]!.ci; }
  private nodeOf(ci: number): ItemNode | undefined { return this.nodes.find(n => n.ci === ci); }

  /** a source's push chain: BFS to the nearest sink, returns node CI path */
  private route(fromCi: number): number[] | null {
    const from = this.nodes.findIndex(n => n.ci === fromCi);
    if (from < 0) return null;
    const prev = new Map<number, number>(); prev.set(from, -1);
    const q = [from];
    while (q.length) {
      const cur = q.shift()!;
      const curNode = this.nodes[cur]!;
      if (cur !== from && (curNode.role === 'sink' || curNode.role === 'process'))
        // walk the chain back
      {
        const path: number[] = [];
        let k = cur;
        while (k >= 0) { path.unshift(this.nodeCi(k)); k = prev.get(k)!; }
        return path;
      }
      // gates: a relay belt with ch0 explicitly 0 blocks the chain
      if (curNode.type === 'ItemConveyor' && (this.chan(curNode.ci, 0) ?? 1) <= 0
        && cur !== from) continue;
      for (const l of this.links) {
        const other = l.a === cur ? l.b : l.b === cur ? l.a : -1;
        if (other < 0 || prev.has(other)) continue;
        prev.set(other, cur);
        q.push(other);
      }
    }
    return null;
  }

  /** one step (dt seconds). `busCb(alias, ch, text)` publishes container
   *  contents (the wiki's data-port KV law) so computer programs — the
   *  Crafter built-in, ChipOS's mining page — READ the inventory. */
  step(dt: number, busCb?: (alias: string, ch: number, text: string) => void): void {
    this.elapsed += dt;
    // ① sources spawn
    for (const n of this.nodes) {
      if (n.role !== 'source') continue;
      const gated = this.chan(n.ci, 0);
      if (gated !== undefined && gated <= 0) continue;      // data gate off
      if (this.powerAware && !this.powered.has(n.ci)) continue;
      if (n.type === 'MiningDrill' && !this.anchored) continue;
      const rate = n.type === 'MiningDrill' ? (n.hv ? 100 : 10) : 10;
      const due = this.nextSpawn.get(n.ci) ?? 0;
      if (this.elapsed < due) continue;
      this.nextSpawn.set(n.ci, this.elapsed + 1 / rate);
      if (this.flying.length >= MAX_FLY) continue;
      const path = this.route(n.ci);
      if (!path || path.length < 2) continue;
      this.flying.push({ item: 'Rock', from: n.ci, to: path[1]!, t: 0 });
      this.mined++;
    }
    // ② in-flight hops
    const arrived: { node: ItemNode; item: string }[] = [];
    this.flying = this.flying.filter(f => {
      const a = this.nodeOf(f.from), b = this.nodeOf(f.to);
      if (!a || !b) return false;
      const link = this.links.find(l =>
        (l.a === this.nodes.indexOf(a) && l.b === this.nodes.indexOf(b))
        || (l.b === this.nodes.indexOf(a) && l.a === this.nodes.indexOf(b)));
      f.t += (dt * HOP_SPEED) / Math.max(0.25, link?.dist ?? 1);
      if (f.t < 1) return true;
      if (b.role === 'process') { f.item = f.item === 'Rock' ? 'CrushedRock' : f.item; }
      if (b.role === 'sink') { arrived.push({ node: b, item: f.item }); return false; }
      // relay: push to the next hop
      const path = this.route(b.ci);
      const nxt = path?.find(ci => ci !== b.ci && ci !== a.ci);
      if (!nxt && nxt !== 0) return false;               // dead end: item gone
      f.from = b.ci; f.to = nxt; f.t = 0;
      return true;
    });
    for (const { node, item } of arrived) {
      const cont = this.containers.get(node.ci);
      if (cont) {
        const tot = [...cont.counts.values()].reduce((a, b) => a + b, 0);
        if (tot < CONTAINER_CAP) cont.counts.set(item, (cont.counts.get(item) ?? 0) + 1);
      }
      // TrashCan swallows silently
    }
    // ③ the stylised Crafter cycle: consume a payable recipe, produce after
    const due = this.craftNext;
    if (this.recipes.length && this.elapsed >= due) {
      const conts = [...this.containers.values()]
        .filter(c => [...c.counts.values()].reduce((a, b) => a + b, 0) > 0);
      for (const r of this.recipes) {
        const need = Object.entries(r.in);
        const pool = new Map<string, number>();
        for (const c of conts) for (const [k, v] of c.counts)
          pool.set(k, (pool.get(k) ?? 0) + v);
        // the sim's items are ROCKS — only pay with generic resources named
        // like the mined outputs (stylisation, honestly capped)
        const payable = need.every(([item, n]) => (pool.get(item) ?? 0) >= n);
        if (!payable) continue;
        for (const [item, n] of need) {
          let left = n;
          for (const c of conts) {
            const have = c.counts.get(item) ?? 0;
            const take = Math.min(have, left);
            if (take) {
              if (have - take <= 0) c.counts.delete(item); else c.counts.set(item, have - take);
              left -= take;
            }
          }
        }
        const target = conts[0];
        target?.counts.set(r.name.split('.').pop() ?? r.name,
          (target?.counts.get(r.name.split('.').pop() ?? r.name) ?? 0) + 1);
        this.craftNext = this.elapsed + Math.min(r.time, 30);
        this.crafted++;
        break;
      }
    }
    // ④ publish container contents on the io bus (wiki Container: the data
    //    port answers the content as a key-value text)
    if (busCb) {
      for (const n of this.nodes) {
        if (n.role !== 'sink' || !n.alias) continue;
        const cont = this.containers.get(n.ci);
        const kv = [...(cont?.counts ?? [])]
          .map(([k, v]) => `.${k}{${v}}`).join('');
        busCb(n.alias, 0, kv);
      }
    }
  }

  /** render state: where the flying items sit right now (positions lerp
   *  the node centres — the scene draws instanced cubes on them) */
  snapshot(): { item: string; x: number; y: number; z: number }[] {
    const out: { item: string; x: number; y: number; z: number }[] = [];
    for (const f of this.flying) {
      const a = this.nodeOf(f.from), b = this.nodeOf(f.to);
      if (!a || !b) continue;
      out.push({
        item: f.item,
        x: a.x + (b.x - a.x) * f.t, y: a.y + (b.y - a.y) * f.t,
        z: a.z + (b.z - a.z) * f.t,
      });
    }
    return out;
  }

  census(): ItemSimCensus {
    return {
      containers: [...this.containers.values()]
        .map(c => ({ alias: this.nodeOf(c.ci)?.alias ?? `container-${c.ci}`, ci: c.ci,
          counts: Object.fromEntries(c.counts) }))
        .filter(c => Object.keys(c.counts).length),
      flying: this.flying.length, mined: this.mined, crafted: this.crafted,
      linked: this.links.length,
      sources: this.nodes.filter(n => n.role === 'source').length,
    };
  }
}
