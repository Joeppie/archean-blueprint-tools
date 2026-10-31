// scannersim.ts — THE SCANNER SIM (v1.16.24, we: "the ore scanner needs to
// return somewhat OK results, so that it doesnt seem completely gibberish
// what it sends"). SIM IS A VIEW like devicesim/itemsim: nothing here ever
// writes the blueprint; the answers are a plausible synthetic terrain.
//
// THE GAME LAWS (wiki/en/components/mining/OreScanner.md +
// navigation/TerrainScanner.md, verbatim):
//  • a NUMBER written to channel ch = a distance in metres scanned
//    horizontally in the sensor direction; the answer lands on the SAME
//    channel ONE TICK later and keeps answering while the distance stands;
//  • OreScanner answers a key-value TEXT of the terrain composition,
//    `.Al{0.1500}.Fe{0.2000}.Si{0.6500}` (mining.md §Rock Composition —
//    the symbols are its element table; fractions sum to 1);
//  • TerrainScanner answers a NUMBER: the altitude (m) at that distance;
//  • the scan is a field measurement, not a reroll: stable distances are
//    asked on purpose ("keep them consistent across ticks") so the same
//    ground must answer identically — hence a deterministic pseudo-noise
//    field, ore compositions quantised to deposit cells (~12 m), altitude
//    continuous in the distance.
// Not modelled (documented boundaries): the LV energy cost (100 W per
// channel per tick — device power is the v1.15.6 backlog), planets-only
// gating (every craft scans in our view — the sim has no celestial), the
// sensor DIRECTION (the answer does not depend on where the part points).

export type ScannerReply = { ci: number; ch: number; value: string | number };

/** xorshift-style deterministic hash — the whole synthetic world rides it */
function h32(seed: number): number {
  let x = (seed >>> 0) || 0x9e3779b9;
  x ^= x << 13; x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5; x >>>= 0;
  return x >>> 0;
}

/** mining.md's element table; the pick weights give a believable crust:
 *  silicates/iron dominate, gold/uranium/cheese are the rare finds. */
const CRUST: [string, number][] = [
  ['Si', 6], ['Fe', 6], ['Al', 4], ['C', 3], ['Ti', 2], ['Ni', 2],
  ['Pb', 2], ['Sn', 2], ['Cu', 2], ['Cr', 1], ['F', 1], ['Ag', 1],
  ['W', 1], ['Au', 1], ['U', 1], ['Ch', 1],       // Ch = Cheese (Ch??? row)
];

/** the ore field: one composition per (scanner ci, ~12 m deposit cell) */
export function compositionAt(ci: number, distance: number): string {
  const cell = Math.floor(distance / 12);
  let s = h32(ci * 0x51ed + cell + 1);
  const pool = CRUST.map(([sym, w]) => ({ sym, w }));
  const n = 2 + (s % 4);                                   // 2..5 elements
  const picks: { sym: string; r: number }[] = [];
  for (let i = 0; i < n && pool.length; i++) {
    const total = pool.reduce((a, p) => a + p.w, 0);
    let roll = (s = h32(s ^ (i * 0x165667b1))) % total;
    let k = 0;
    while (k < pool.length - 1 && (roll -= pool[k]!.w) >= 0) k++;
    picks.push({ sym: pool[k]!.sym, r: 1 + (s % 90) });
    pool.splice(k, 1);
  }
  // fractions sum to EXACTLY 1 at four decimals (mining.md's rock form)
  const sum = picks.reduce((a, p) => a + p.r, 0);
  let acc = 0;
  const parts = picks.map((p, i) => {
    let f = Math.max(1, Math.round((p.r / sum) * 10000));
    if (i === picks.length - 1) f = 10000 - acc;    // the last takes the rest
    else acc += f;
    return `.${p.sym}{${(f / 10000).toFixed(4)}}`;
  });
  return parts.join('');
}

/** the altitude field: smooth pseudo-terrain per scanner (three sine
 *  octaves — continuous in the distance, so a 1 m step moves a little) */
export function altitudeAt(ci: number, distance: number): number {
  const p1 = (h32(ci * 3 + 1) % 6283) / 1000;
  const p2 = (h32(ci * 3 + 2) % 6283) / 1000;
  const p3 = (h32(ci * 3 + 3) % 6283) / 1000;
  const base = ((h32(ci) % 700) - 250) / 10;               // −25 .. +45 m
  const alt = base
    + 38 * Math.sin(distance / 85 + p1)
    + 17 * Math.sin(distance / 23 + p2)
    + 6 * Math.sin(distance / 7 + p3);
  return Math.round(alt * 10) / 10;
}

export class ScannerSim {
  private types = new Map<number, 'OreScanner' | 'TerrainScanner'>();
  /** requested distances per (ci -> ch) — the program's scans */
  private dist = new Map<number, Map<number, number>>();
  /** the distance each channel was last ANSWERED at (emit-on-change) */
  private answered = new Map<number, Map<number, number>>();
  private any = false;

  load(bp: { data: { components: { type: string }[] } }): void {
    this.types = new Map();
    this.dist = new Map();
    this.answered = new Map();
    this.any = false;
    (bp.data.components as { type: string }[]).forEach((c, ci) => {
      if (c.type === 'OreScanner' || c.type === 'TerrainScanner')
        this.types.set(ci, c.type);
    });
  }

  /** the io bus says: THIS scanner's channel took a scan distance */
  write(devCi: number, ch: number, v: number): void {
    const t = this.types.get(devCi);
    if (!t || !Number.isFinite(v)) return;
    let m = this.dist.get(devCi);
    if (!m) this.dist.set(devCi, m = new Map());
    if (v <= 0) m.delete(ch);                        // ≤ 0 = no scan asked
    else m.set(ch, v);
    this.any = true;
  }

  /** one tick: every channel whose distance is unanswered answers NOW
   *  (the wiki's one-tick delay), changed distances re-answer (the pump
   *  inputs are sticky, so an unchanged channel stays silent = cheap). */
  step(): ScannerReply[] {
    if (!this.any) return [];
    this.any = false;
    const out: ScannerReply[] = [];
    for (const [ci, chs] of this.dist) {
      const t = this.types.get(ci)!;
      let done = this.answered.get(ci);
      if (!done) this.answered.set(ci, done = new Map());
      for (const [ch, d] of chs) {
        if (done.get(ch) === d) continue;
        done.set(ch, d);
        out.push({
          ci, ch,
          value: t === 'OreScanner' ? compositionAt(ci, d) : altitudeAt(ci, d),
        });
      }
      for (const ch of [...done.keys()]) if (!chs.has(ch)) done.delete(ch);
    }
    return out;
  }

  clear(): void {
    this.dist = new Map();
    this.answered = new Map();
    this.any = false;
  }
}
