// soundscape.ts — THE SOUND OF THE CRAFT (v1.16.10 WP4, we: "see if
// things can make the sound that normally they do, including anchors,
// drills, switches etc"). All cues are SYNTHESIZED in WebAudio — the
// game's audio assets stay untouched (NOTICE: game data belongs to the
// developer; a procedural twin of the LAWS is ours). The rules follow
// what the parts DO (the sim channels), not what a program asks:
//
//   ToggleButton / PushButton  the lever CLICK (toggle latches: click +
//     body thump; push: one short click)          — wiki controllers/*
//   LowVoltageRelay            the heavy CLACK on gate change — wiki
//     energy/junctionRelayConverter/LowVoltageRelay.md
//   Lamp / SpotLight           the soft relay blip on the on-edge
//   GroundAnchor               the CHAIN RATTLE + thud on deploy/retract
//     (data 0/1, wiki miscellaneous/GroundAnchor.md)
//   MiningDrill                a rock-drill WHIR loop while it runs
//     (wiki mining/MiningDrill.md — HV drills deeper/louder)
//   ItemConveyor / pumps       a low BELT rumble / pump burble loop while
//     running
//   Propeller / wheels         a speed-proportional hum
//   servos (hinge/pivot/track) a short whine sweep while driving
//   the power warning          a two-tone alarm when the grid enters
//     low/deficit (engine/energy.ts) — warning only, the grid keeps feeding
//   the crafter                a finish DING per crafted item
//
// BROWSER LAW (the buzzer precedent): the AudioContext is created+resumed
// INSIDE the 🔊 toggle click (a real gesture) with the Firefox 1-frame
// unlock; loops built later ride that context. Persisted under
// `archean-app-sound`, default ON-armed (silent until the gesture).

import type { Blueprint, BlueprintComponent } from './format';

const LS_ON = 'archean-app-sound';

type LoopKind = 'drill' | 'belt' | 'pump' | 'prop';
interface Loop { kind: LoopKind; gain: GainNode; nodes: AudioNode[] }

export class Soundscape {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  soundOn = true;
  /** ci -> type (from the loaded blueprint) */
  private types = new Map<number, string>();
  /** ci -> last channel snapshot that drove edges */
  private prev = new Map<number, Map<number, number>>();
  private loops = new Map<string, Loop>();
  private lastAlarm = 0;
  private lastCraft = 0;

  constructor() {
    try { this.soundOn = localStorage.getItem(LS_ON) !== '0'; } catch { /* private mode */ }
  }

  /** (re)derive the type table; edges reset (a new craft = new parts). */
  load(bp: Blueprint): void {
    this.types = new Map();
    (bp.data.components as BlueprintComponent[]).forEach((c, ci) => this.types.set(ci, c.type));
    this.prev = new Map();
    this.stopLoops();
  }

  /** 🔊 toggle — MUST be called inside a real click (gesture law, above). */
  toggleSound(): boolean {
    this.soundOn = !this.soundOn;
    try { localStorage.setItem(LS_ON, this.soundOn ? '1' : '0'); } catch { /* private mode */ }
    if (this.soundOn) {
      try {
        const ctx = this.ensureCtx();
        void ctx.resume();
        const b = ctx.createBuffer(1, 1, ctx.sampleRate);
        const src = ctx.createBufferSource();
        src.buffer = b; src.connect(ctx.destination); src.start(0);
        const unlock = () => { if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume(); };
        addEventListener('pointerdown', unlock, { capture: true, once: true });
      } catch { /* no audio device: silent, never crashes */ }
    } else this.stopLoops();
    return this.soundOn;
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  // ── one-shot cues ────────────────────────────────────────────────────
  private noise(dur = 0.02, lp = 4000): AudioBufferSourceNode | null {
    if (!this.ctx || !this.master) return null;
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = lp;
    src.connect(f);
    return src;
  }
  private blip(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', slideTo?: number) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.value = gain;
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g); g.connect(this.master);
    o.start(); o.stop(ctx.currentTime + dur + 0.01);
  }
  private burst(dur: number, gain: number, lp: number) {
    const n = this.noise(dur, lp);
    if (!n || !this.master) return;
    const g = this.ctx!.createGain();
    g.gain.value = gain;
    n.connect(g); g.connect(this.master);
    n.start();
  }

  private clickSwitch() { this.burst(0.012, 0.22, 6000); this.blip(150, 0.03, 0.1, 'square', 70); }
  private clickRelay() { this.burst(0.008, 0.3, 9000); this.blip(90, 0.05, 0.16, 'triangle', 45); }
  private clickLamp() { this.burst(0.006, 0.1, 3000); }
  private chainRattle() {
    for (const [f, d, g] of [[1200, 0.06, 0.14], [1850, 0.05, 0.1], [2400, 0.04, 0.07]] as const)
      setTimeout(() => this.blip(f, d, g, 'triangle', f * 0.85), d * 320);
    this.blip(60, 0.12, 0.18, 'sine', 40);
  }
  private servoWhine() { this.blip(430, 0.22, 0.05, 'sine', 540); }
  private alarm() {
    const now = performance.now();
    if (now - this.lastAlarm < 20_000) return;          // a reminder, not a siren loop
    this.lastAlarm = now;
    this.blip(880, 0.14, 0.12, 'square');
    setTimeout(() => this.blip(660, 0.18, 0.12, 'square'), 170);
  }
  private ding() {
    const now = performance.now();
    if (now - this.lastCraft < 2_000) return;
    this.lastCraft = now;
    this.blip(1175, 0.35, 0.08, 'sine');
    setTimeout(() => this.blip(1568, 0.5, 0.07, 'sine'), 120);
  }

  // ── the bus tap (wire to observeDevices) ─────────────────────────────
  /** Every bus write: remember the channel, fire the edge cue. */
  write(ci: number, ch: number, v: number): void {
    let m = this.prev.get(ci);
    if (!m) this.prev.set(ci, m = new Map());
    const was = m.get(ch);
    m.set(ch, v);
    if (!this.soundOn || typeof AudioContext === 'undefined') return;
    if (this.ctx?.state === 'suspended') void this.ctx.resume().catch(() => { /* gesture pending */ });
    const type = this.types.get(ci) ?? '';
    const on = v > 0;
    switch (type) {
      case 'ToggleButton':
        if (was !== undefined && on !== (was ?? 0) > 0) this.clickSwitch();
        break;
      case 'PushButton':
      case 'ArrowButton':
        if (on && !((was ?? 0) > 0)) this.clickSwitch();
        break;
      case 'LowVoltageRelay':
      case 'HighVoltageRelay':
        if (ch === 0 && on !== ((was ?? 0) > 0)) this.clickRelay();
        break;
      case 'Lamp': case 'SpotLight': case 'SlopeLight':
        if (ch === 0 && on !== ((was ?? 0) > 0)) this.clickLamp();
        break;
      case 'GroundAnchor':
        if (ch === 0 && on !== ((was ?? 0) > 0)) this.chainRattle();
        break;
      case 'SmallHinge': case 'SmallPivot': case 'LinearTrack':
        if (ch === 0 && was !== undefined && Math.abs(v - (was ?? 0)) > 0.05) this.servoWhine();
        break;
      default: break;
    }
  }

  /** the energy status edge: entering low/deficit alarms once. */
  powerStatus(status: string): void {
    if (!this.soundOn) return;
    if (status === 'low' || status === 'deficit') this.alarm();
  }
  /** the craft counter edge: a finished item dings. */
  craftTick(crafted: number): void {
    if (!this.soundOn) return;
    if (crafted > this.craftSeen) this.ding();
    this.craftSeen = crafted;
  }
  private craftSeen = 0;

  /** the remembered channel value (the loop census reads what the tap saw) */
  chan(ci: number, ch: number): number | undefined { return this.prev.get(ci)?.get(ch); }

  // ── the loops (called from the heartbeat ~1.6 Hz) ────────────────────
  /** wanted loops: ci -> kind at a gain (0 = off) */
  syncLoops(wanted: { ci: number; kind: LoopKind; gain: number }[]): void {
    if (!this.soundOn) { this.stopLoops(); return; }
    const live = new Set<string>();
    for (const w of wanted) {
      const key = `${w.kind}:${w.ci}`;
      if (w.gain <= 0) continue;
      live.add(key);
      let loop = this.loops.get(key);
      if (!loop) loop = this.buildLoop(w.kind, key);
      if (loop) loop.gain.gain.setTargetAtTime(w.gain, this.ctx!.currentTime, 0.15);
    }
    for (const [key, loop] of this.loops) {
      if (live.has(key)) continue;
      loop.gain.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.12);
    }
  }

  private buildLoop(kind: LoopKind, key: string): Loop | undefined {
    if (typeof AudioContext === "undefined") return undefined;
    let ctx: AudioContext;
    try { ctx = this.ensureCtx(); } catch { return undefined; }
    if (!this.master || ctx.state === 'suspended') return undefined;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(this.master);
    const nodes: AudioNode[] = [];
    if (kind === 'drill') {
      // rock drill: two detuned saws through a lowpass, AM-chewed
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1400;
      lp.connect(g);
      for (const f of [78, 117]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = 9;
        o.connect(lp); o.start(); nodes.push(o);
      }
      const n = ctx.createBufferSource();
      const len = Math.floor(ctx.sampleRate * 2);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      n.buffer = buf; n.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.7;
      const ng = ctx.createGain(); ng.gain.value = 0.5;
      n.connect(bp); bp.connect(ng); ng.connect(lp);
      n.start(); nodes.push(n);
    } else if (kind === 'belt') {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 320;
      lp.connect(g);
      const n = ctx.createBufferSource();
      const len = Math.floor(ctx.sampleRate * 2);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      n.buffer = buf; n.loop = true;
      n.connect(lp); n.start(); nodes.push(n);
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = 55;
      const og = ctx.createGain(); og.gain.value = 0.35;
      o.connect(og); og.connect(g); o.start(); nodes.push(o);
    } else if (kind === 'pump') {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 520;
      lp.connect(g);
      const n = ctx.createBufferSource();
      const len = Math.floor(ctx.sampleRate * 2);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      n.buffer = buf; n.loop = true;
      n.connect(lp); n.start(); nodes.push(n);
    } else {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = 64;
      const o2 = ctx.createOscillator();
      o2.type = 'sine'; o2.frequency.value = 96;
      const g2 = ctx.createGain(); g2.gain.value = 0.6;
      o.connect(g); o2.connect(g2); g2.connect(g);
      o.start(); o2.start(); nodes.push(o, o2);
    }
    const loop = { kind, gain: g, nodes };
    this.loops.set(key, loop);
    return loop;
  }

  private stopLoops(): void {
    for (const [, loop] of this.loops) {
      try {
        for (const n of loop.nodes) {
          const s = n as OscillatorNode & { stop?: () => void };
          s.stop?.();
        }
        loop.gain.disconnect();
      } catch { /* already gone */ }
    }
    this.loops = new Map();
  }

  stopAll(): void { this.stopLoops(); }
}

export const soundscape = new Soundscape();
