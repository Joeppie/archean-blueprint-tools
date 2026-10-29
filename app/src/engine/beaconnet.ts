// beaconnet.ts — the GLOBAL beacon-radio scope (v1.14.0 P9 slice A; we:
// "make beacons into a separate tab for computers/huds as well, so the
// globally known scope can be understood when we have 'intercomputer'
// operations; be they HUDs or minicomputers or computers").
//
// THE MODEL (FORMAT §HUD & the Beacon radio, §Player-installed HUDs):
// every radio is a (txFreq, rxFreq) pair of TEXT frequencies; a payload
// posted on a frequency lands in every participant whose rx frequency
// EQUALS it (exact text match — `beacon(5,5664)` numbers normalize to
// their numerals). The registry is the SIM's world radio: seeded from
// the CRAFT (Beacon components' transmit/receiveFrequency, and every
// beacon(...) literal scanned out of computer AND HudController .xc
// programs) plus the USER (the Beacon dock's own send form). Routing the
// real programs' beacons (the HUD/VM runtime) is slice B — the registry
// already speaks the routing so the shim lands onto it unchanged.
import type { Blueprint, BlueprintComponent } from './format';

export interface BeaconRx { at: number; from: string; data: string }

export interface BeaconParticipant {
  /** stable id: `beacon:<ci>` | `hud:<ci>#<n>` | `computer:<ci>#<n>` | `user` */
  id: string;
  kind: 'beacon' | 'hud' | 'computer' | 'user';
  label: string;
  ci: number;                       // owning component (-1 for the user)
  tx: string;                       // the frequency THIS participant transmits on
  rx: string;                       // the frequency THIS participant listens on
  lastTx: string;                   // last payload it sent (dock sends included)
  lastTxAt: number;
  rxLog: BeaconRx[];                // received payloads, newest first (ring)
}

const RX_CAP = 50;
const PENDING_CAP = 32;

export const freqNorm = (v: unknown): string => String(v ?? '').trim();

/** Strip the source quotes off a beacon() literal (numbers ride verbatim). */
const lit = (raw: string): string => freqNorm(raw.replace(/^"|"$/g, ''));

/** beacon(<tx>,<rx>) literals in XenonCode source — quoted text OR numeric
 *  frequencies (both are game-legal; FORMAT §Player-installed HUDs). */
export function beaconCalls(code: string): { tx: string; rx: string }[] {
  const out: { tx: string; rx: string }[] = [];
  for (const m of code.matchAll(
    /beacon\(\s*("[^"]*"|[0-9][0-9A-Za-z._-]*)\s*,\s*("[^"]*"|[0-9][0-9A-Za-z._-]*)\s*\)/g))
    out.push({ tx: lit(m[1]!), rx: lit(m[2]!) });
  return out;
}

const codeOf = (c: BlueprintComponent): string[] => {
  const d = (c.data ?? {}) as Record<string, any>;
  const files = [...(d?.hdd?.xc_files ?? []), ...(d?.xc_files ?? [])] as
    { plain_code?: string }[];
  return files.map(f => f.plain_code ?? '');
};

class BeaconNet {
  private parts = new Map<string, BeaconParticipant>();
  /** slice B/D transport: deliveries queued per participant, drained by
   *  the owning runtime (a Beacon component's io channel via
   *  xc_set_input_t, a program's beacon object via xc_beacon_put).
   *  v1.15.0 slice C: entries carry a GLOBAL sequence — a component
   *  beacon cabled to SEVERAL computers is read by each pump with its
   *  own cursor (pendingSince), so one computer's beacon delivery is
   *  seen by EVERY computer wired to it (takePending drains, for the
   *  single-owner HUD ids). */
  private pending = new Map<string, { seq: number; data: string }[]>();
  private qseq = 0;
  private listeners = new Set<() => void>();
  /** the user's own transcript (dock sends), newest first */
  outbox: BeaconRx[] = [];
  /** bumps on every mutation — the panels poll this like pump.cycles */
  version = 0;

  constructor() {
    this.parts.set('user', {
      id: 'user', kind: 'user', label: 'you (the Beacon dock)', ci: -1,
      tx: '', rx: '', lastTx: '', lastTxAt: 0, rxLog: [],
    });
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private notify(): void {
    this.version++;
    for (const cb of this.listeners) cb();
  }

  /** Re-seed the CRAFT-scope participants from the blueprint (every bp
   *  change). The user participant and its transcript SURVIVE. */
  seed(bp: Blueprint): void {
    // traffic logs SURVIVE a re-seed (every save re-seeds; the radio
    // history is the point of the tab): re-attached below by participant id
    const oldLogs = new Map<string, { rxLog: BeaconRx[]; lastTx: string; lastTxAt: number }>();
    for (const [id, p] of this.parts)
      if (p.kind !== 'user') oldLogs.set(id, { rxLog: p.rxLog, lastTx: p.lastTx, lastTxAt: p.lastTxAt });
    for (const id of [...this.parts.keys()]) {
      const p = this.parts.get(id)!;
      if (p.kind !== 'user') this.parts.delete(id);
    }
    const comps = (bp.data.components ?? []) as BlueprintComponent[];
    comps.forEach((c, ci) => {
      const d = (c.data ?? {}) as Record<string, any>;
      const alias = c.alias || `${String(c.type).toLowerCase()}-${ci}`;
      if (c.type === 'Beacon') {
        this.parts.set(`beacon:${ci}`, {
          id: `beacon:${ci}`, kind: 'beacon', label: `Beacon ${alias}`, ci,
          tx: freqNorm(d.transmitFrequency), rx: freqNorm(d.receiveFrequency),
          lastTx: freqNorm(d.transmitData), lastTxAt: 0, rxLog: [],
        });
      }
      // beacon() literals in programs: HUD programs and computer disks
      const kind: BeaconParticipant['kind'] = c.type === 'HudController' ? 'hud' : 'computer';
      if (c.type !== 'HudController' && !d?.hdd) return;
      beaconCalls(codeOf(c).join('\n')).forEach((b, n) => {
        const id = `${kind}:${ci}#${n}`;
        this.parts.set(id, {
          id, kind, label: `${kind === 'hud' ? 'HUD' : 'Program'} ${alias} · beacon`, ci,
          tx: b.tx, rx: b.rx, lastTx: '', lastTxAt: 0, rxLog: [],
        });
      });
    });
    // re-attach the surviving radio history
    for (const [id, p] of this.parts) {
      const old = oldLogs.get(id);
      if (old) { p.rxLog = old.rxLog; p.lastTx = p.lastTx || old.lastTx; p.lastTxAt = p.lastTxAt || old.lastTxAt; }
    }
    this.notify();
  }

  participants(): BeaconParticipant[] {
    return [...this.parts.values()];
  }

  /** Every KNOWN frequency (send targets + listener targets), sorted. */
  freqs(): string[] {
    const s = new Set<string>();
    for (const p of this.parts.values()) {
      if (p.tx) s.add(p.tx);
      if (p.rx) s.add(p.rx);
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }

  /** Deliver `data` to every participant (except the sender) listening on
   *  `freq`. Returns the receivers. */
  private deliver(freq: string, from: string, data: string, fromId: string): number {
    if (!freq) return 0;
    let n = 0;
    for (const p of this.parts.values()) {
      if (p.id === fromId || p.rx !== freq) continue;
      p.rxLog.unshift({ at: Date.now(), from, data });
      if (p.rxLog.length > RX_CAP) p.rxLog.length = RX_CAP;
      const q = this.pending.get(p.id) ?? [];
      q.push({ seq: ++this.qseq, data });
      if (q.length > PENDING_CAP) q.splice(0, q.length - PENDING_CAP);
      this.pending.set(p.id, q);
      n++;
    }
    return n;
  }

  /** Drain what the runtime has not fed into the VM yet (latest wins). */
  takePending(id: string): string[] {
    const q = this.pending.get(id) ?? [];
    this.pending.delete(id);
    return q.map(e => e.data);
  }

  /** READ-PAST-CURSOR view (slice C): everything delivered after `since`
   *  — each pump keeps its own cursor, so a beacon shared by several
   *  computers feeds them ALL. Returns [items, lastSeq]. */
  pendingSince(id: string, since: number): { items: string[]; seq: number } {
    const q = (this.pending.get(id) ?? []).filter(e => e.seq > since);
    return { items: q.map(e => e.data), seq: q.length ? q[q.length - 1]!.seq : since };
  }

  /** Send FROM a participant's tx frequency (the shim's seam). */
  post(fromId: string, data: string): number {
    const p = this.parts.get(fromId);
    if (!p) return 0;
    p.lastTx = data;
    p.lastTxAt = Date.now();
    const n = this.deliver(p.tx, p.label, data, p.id);
    this.notify();
    return n;
  }

  /** A Beacon COMPONENT transmitted (output_text on its io port, ABI 11 —
   *  FORMAT §HUD: the craft-side radio is plain io). */
  postDevice(ci: number, data: string): number {
    return this.post(`beacon:${ci}`, data);
  }

  /** Register/merge a RUNTIME-reported beacon pair (a beaconpair event from
   *  the VM): the source-scan seeds the same ids, so this ANNOTATES the
   *  scanned participant (it proves the radio is LIVE) and adds pairs the
   *  scan could not see (computed frequencies). */
  registerPair(id: string, label: string, kind: BeaconParticipant['kind'],
    ci: number, tx: string, rx: string): void {
    const p = this.parts.get(id);
    if (p) { p.tx = tx || p.tx; p.rx = rx || p.rx; p.label = label; return; }
    this.parts.set(id, {
      id, kind, label, ci, tx: freqNorm(tx), rx: freqNorm(rx),
      lastTx: '', lastTxAt: 0, rxLog: [],
    });
    this.notify();
  }

  /** Send from the Beacon dock (the user) onto a known/typed frequency. */
  sendTo(freq: string, data: string): number {
    const f = freqNorm(freq);
    const me = this.parts.get('user')!;
    me.tx = f;
    me.lastTx = data;
    me.lastTxAt = Date.now();
    this.outbox.unshift({ at: Date.now(), from: f, data });
    if (this.outbox.length > RX_CAP) this.outbox.length = RX_CAP;
    const n = this.deliver(f, 'you', data, 'user');
    this.notify();
    return n;
  }

  clearLogs(): void {
    for (const p of this.parts.values()) p.rxLog = [];
    this.pending.clear();
    this.outbox = [];
    this.notify();
  }
}

/** THE global radio (worldsim-style singleton — every craft's scope seeds
 *  into the one registry, FORMAT §HUD). */
export const beaconNet = new BeaconNet();
