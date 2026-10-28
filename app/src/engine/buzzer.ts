// buzzer.ts — the game's BUZZER component, made audible (v1.13.2, we:
// "buzzers should be implemented, with square/sawtooth, and the frequency").
//
// The game's law (wiki components/miscellaneous/Buzzer.md): the Buzzer
// produces tones of type sine, square, triangle or sawtooth; the data
// channel carries Amplitude (ch 0, 0..1) and Frequency in Hz (ch 1,
// 0..20000, default 440), and the tone TYPE is the component's own config
// choice (the in-game `V` menu). A program drives it with
// output_number(alias|io, ch, v) — the world server's own player programs
// (buzzers.xc) do exactly that. The wiki law also pins the MIX: "to play
// multiple frequencies simultaneously … you must use multiple buzzers", so
// one oscillator per Buzzer component is the faithful model.
//
// Here the io-bus rows (the pump's `bus` map, keyed by the program's RAW
// target — alias verbatim, io as a number string — + ':' + channel) are the
// Amplitude/Frequency values; buzzerAudio renders them as WebAudio. The
// browser blocks sound until a click, so the sound is OFF until the 🔊
// toggle (a user gesture) turns it on.

import type { XenonPump } from './xenoncode';

/** The game's four buzzer tone types, in the V-menu's order — the component
 *  stores its choice as data.mode 0..3 (we: "component buzzer should have
 *  a better setting for its 'mode' so its named modes not just numerical
 *  values"). */
export const BUZZER_MODES = ['sine', 'square', 'triangle', 'sawtooth'] as const;
export type BuzzerWave = (typeof BUZZER_MODES)[number];

/** data.mode (as authored in the blueprint) -> wave; out-of-range clamps. */
export function modeToWave(mode: number): BuzzerWave {
  const i = Math.max(0, Math.min(BUZZER_MODES.length - 1, Math.trunc(mode) || 0));
  return BUZZER_MODES[i] ?? 'square';
}

/** Band-limited harmonic series (sine terms) for one tone type — the
 *  game's buzzers are DARKER and rounder than WebAudio's built-in
 *  oscillators (a Unity path with filtering and 4-bit-ish amplitudes;
 *  in-game Mario "sounds far closer to the real thing"). We bake a
 *  PeriodicWave table capped at 64 harmonics with a gentle rolloff:
 *  a 660 Hz lead keeps ≤ 42 kHz of structure (all of it audible-smooth),
 *  a 110 Hz bass reaches ~7 kHz — warm, not the built-in hard sparkle.
 *  Pure — vitest-pinned. */
export const BUZZER_HARMONICS = 64;
export function buzzerHarmonics(kind: BuzzerWave): Float32Array {
  const b = new Float32Array(BUZZER_HARMONICS + 1);
  for (let n = 1; n <= BUZZER_HARMONICS; n++) {
    let a = 0;
    if (kind === 'sine') a = n === 1 ? 1 : 0;
    else if (kind === 'square') a = (2 / (n * Math.PI)) * Math.sin(Math.PI * n * 0.5);
    else if (kind === 'sawtooth') a = (2 / (n * Math.PI)) * (n % 2 === 0 ? -1 : 1);
    else a = (8 / (Math.PI * Math.PI * n * n)) * Math.sin((Math.PI * n) / 2) * (((n - 1) / 2) % 2 === 0 ? 1 : -1);
    // gentle 1/n^1.1 extra roll-off: tames the saw's edge, keeps bodies
    b[n] = a / Math.pow(n, 0.1);
  }
  return b;
}

const LS_WAVE = 'archean-…wave';
const LS_ON = 'archean-xenon-buzzer-sound';

export interface BuzzerReading {
  /** display name: the component alias, else 'io <n>'. */
  name: string;
  io: number;
  /** ch 0 Amplitude, clamped 0..1 (0 = silent). */
  amp: number;
  /** ch 1 Frequency in Hz; the game's 440 default when the channel is
   *  unset/zero, clamped to the wiki's 20000 ceiling. */
  freq: number;
  /** the component's authored tone (data.mode) — the wave this buzzer
   *  SOUNDS as in auto mode (Mario: melody square, bass TRIANGLE,
   *  effects SAWTOOTH — one global wave made the music "funky"). */
  wave: BuzzerWave;
}

/** Every Buzzer device of the running computer with its live bus reading.
 *  Pure (no audio) — vitest-pinned. The bus key is the program's RAW
 *  target: output_number("b1",0,x) lands as 'b1:0', output_number(8,0,x)
 *  as '8:0' (xc_host stringifies the first arg verbatim). A device the
 *  program never writes is SILENT (amp 0), not humming at the default. */
export function buzzerReadings(pump: Pick<XenonPump, 'comp' | 'bus'>): BuzzerReading[] {
  const out: BuzzerReading[] = [];
  for (const d of pump.comp?.devices.filter(x => x.type === 'Buzzer') ?? []) {
    const get = (ch: number): number => {
      const keys = [`${d.alias}:${ch}`, `${d.alias.toLowerCase()}:${ch}`];
      if (d.io >= 0) keys.push(`${d.io}:${ch}`);
      for (const k of keys) {
        const v = pump.bus.get(k);
        if (v !== undefined) return typeof v === 'number' ? v : Number(v) || 0;
      }
      return 0;
    };
    const freq = get(1);
    const wave = typeof d.mode === 'number' ? modeToWave(d.mode) : 'square';
    out.push({
      name: d.alias || `io ${d.io}`,
      io: d.io,
      amp: Math.max(0, Math.min(1, get(0))),
      freq: freq > 0 ? Math.min(20000, freq) : 440,
      wave,
    });
  }
  return out;
}

const MASTER_GAIN = 0.5;    // a full-amplitude buzzer is a solid, not a blast

/** Game buzzers run quiet amplitudes (Chip's Mario writes ~0.05..0.3), so
 *  a linear ·0.25 gain sat at ≈ −33 dB — the "I dont hear the buzzers"
 *  report. Lift the low end (×1.8, capped) and scale to 0.4, with a 4-bit
 *  amplitude quantization (round to 16 levels) — the game's channel
 *  amplitudes pass through a coarse DAC path, part of its character.
 *  Pure — vitest-pinned. */
export function voiceGain(amp: number): number {
  const q = Math.round(Math.max(0, Math.min(1, amp)) * 15) / 15;   // 4-bit-ish
  return Math.min(1, q * 1.8) * MASTER_GAIN;
}

/** WebAudio mixer: one square-wave-capable oscillator per loud Buzzer.
 *  The wave type is the SHARED config choice (the game menus each buzzer
 *  separately; we expose one app-level choice, persisted). */
export class BuzzerAudio {
  /** 'auto' = each buzzer plays the tone its COMPONENT authored
   *  (data.mode) — the game's own law; a named wave here overrides all. */
  wave: BuzzerWave | 'auto' = 'auto';
  /** SOUND IS ON BY DEFAULT (we: "sound was off by default - at least in
   *  firefox, please make it on by default"). Browsers only allow audio
   *  after a user gesture, so "on" is armed at startup and the AudioContext
   *  unlocks itself at the first real pointer/key interaction (arm) — for
   *  Mario that is the very first jump press. */
  soundOn = true;
  /** Loudest Amplitude seen in the latest sync (0 = all silent) — drives
   *  the TopBar 🔊 activity animation ("animates whenever any buzzer is
   *  making sound so its evident that is the reason there is sound"). */
  level = 0;
  private ctx: AudioContext | null = null;
  // master chain (v1.13.4): voice gains -> master gain -> compressor ->
  // destination, with an AnalyserNode TAP on the compressor output. The
  // compressor keeps 8-voice square-wave chords from clipping; the
  // analyser answers "do they make sound?" objectively — outputLevel()
  // reads the RMS of the samples actually flowing to the speakers, even
  // in a muted/headless browser.
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analyBuf: Float32Array | null = null;
  private voices = new Map<string, { osc: OscillatorNode; gain: GainNode; kind: string; hold: number; beepUntil: number }>();

  /** WRITE-TIME SCHEDULING (v1.13.14, we: "THAT DOES NOT PLAY AUDIO UNTIL I
   *  MINIMIZE THE in-editor SCREEN YOU MAXIIMZE"): every sound is scheduled
   *  on the AUDIO clock the instant the game writes its amplitude — a
   *  sample-accurate envelope the audio thread plays fully no matter how
   *  starved the main thread's heartbeat becomes (a maximized zoom window
   *  loads the pump with canvas blits, and a beep that ends before the next
   *  bus SAMPLE was never voiced at all). This is the sound path; sync()'s
   *  per-cycle steering only keeps long-held tones in tune. */
  beep(name: string, amp: number, freq: number, wave: BuzzerWave): void {
    if (!this.soundOn || typeof AudioContext === 'undefined') return;
    try {
      const ctx = this.ensureCtx();
      void ctx.resume();
      const now = ctx.currentTime;
      const kind = (this.wave === 'auto' ? wave : this.wave) as BuzzerWave;
      let v = this.voices.get(name);
      if (!v) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.setPeriodicWave(this.waveFor(kind, ctx));
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(this.master!);
        osc.start();
        v = { osc, gain, kind, hold: 0, beepUntil: 0 };
        this.voices.set(name, v);
      }
      if (v.kind !== kind) { v.osc.setPeriodicWave(this.waveFor(kind, ctx)); v.kind = kind; }
      const g = voiceGain(amp);
      const p = v.gain.gain;
      p.cancelScheduledValues(now);
      p.setValueAtTime(Math.max(0, p.value), now);
      p.linearRampToValueAtTime(g, now + 0.005);          // 5 ms attack
      p.setValueAtTime(g, now + 0.10);                    // tone body
      p.linearRampToValueAtTime(0, now + 0.14);           // 40 ms release
      v.osc.frequency.setValueAtTime(Math.min(20000, Math.max(1, freq)), now);
      v.beepUntil = now + 0.15;
      v.hold = now + 0.15;
    } catch { /* no audio device: the pump must never break */ }
  }
  /** PEAK-HOLD (v1.13.11, we: "space invaders doesnt play sound unless I
   *  minimize its screen"): a short beep written between two samples of a
   *  canvas-load-starved pump (~11 Hz with the Invaders zoom open) was
   *  already silent when sync ran, so the oscillator never ramped up. Keep
   *  a voice at its last loud level for this long after it is last seen
   *  loud, so a beep that lands in a sampling gap still SOUNDS. */
  private static readonly HOLD = 0.12;

  /** SILENT KEEP-ALIVE (v1.13.12, we: "did not play any sound until I made
   *  the screen smaller"): Chrome throttles an OCCLUDED/hidden tab's timers
   *  (the 25 Hz pump -> ~1 Hz), and a silent game tab is "audible" by
   *  definition never — so the heartbeat starves and every short beep is
   *  sampled after it already ended. A gain-0 oscillator pinned to the
   *  destination marks the tab media-active: audible tabs are EXEMPT from
   *  background throttling, the heartbeat keeps its cadence, and the tone
   *  is mathematically inaudible (gain 0). */
  private keepAlive: OscillatorNode | null = null;
  private startKeepAlive(ctx: AudioContext, dest: AudioNode): void {
    if (this.keepAlive) return;   // one per context (outlives mute: throttling doesn't care)
    try {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(g);
      g.connect(dest);
      osc.start();
      this.keepAlive = osc;
    } catch { /* no audio device: no keepalive, nothing breaks */ }
  }

  private ensureCtx(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 1;
    // game-ish voice: a gentle lowpass tames the digital edge (the in-game
    // buzzer path is dark; we: "in-game the sound is far closer to the
    // actual super-mario")
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7500;
    lp.Q.value = 0.7;
    const comp = ctx.createDynamicsCompressor();
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    master.connect(lp);
    lp.connect(comp);
    comp.connect(ctx.destination);
    comp.connect(an);
    an.connect(ctx.destination);
    this.ctx = ctx; this.master = master; this.analyser = an;
    this.analyBuf = new Float32Array(an.fftSize);
    this.startKeepAlive(ctx, ctx.destination);   // media-active: no tab throttling
    return ctx;
  }

  /** Band-limited tone tables (buzzerHarmonics) as PeriodicWaves — the
   *  built-in square/saw are hard, band-unlimited shapes; these roll off
   *  at 64 harmonics for the game's rounder voice. */
  private waveCache = new Map<BuzzerWave, PeriodicWave>();
  private waveFor(kind: BuzzerWave, ctx: BaseAudioContext): PeriodicWave {
    let w = this.waveCache.get(kind);
    if (!w) {
      const b = buzzerHarmonics(kind);
      w = ctx.createPeriodicWave(new Float32Array(b.length), b, { disableNormalization: false });
      this.waveCache.set(kind, w);
    }
    return w;
  }

  /** RMS (0..~1) of the audio actually flowing to the speakers right now.
   *  > 0.003 with soundOn == TRUE is objective proof the buzzers are
   *  generating audible samples. */
  outputLevel(): number {
    const a = this.analyser, b = this.analyBuf;
    if (!a || !b) return 0;
    a.getFloatTimeDomainData(b as Float32Array<ArrayBuffer>);
    let s = 0;
    for (let i = 0; i < b.length; i++) { const v = b[i] ?? 0; s += v * v; }
    return Math.sqrt(s / b.length);
  }
  voiceCount(): number { return this.voices.size; }

  constructor() {
    try {
      const w = localStorage.getItem(LS_WAVE);
      if (w && (w === 'auto' || (BUZZER_MODES as readonly string[]).includes(w))) this.wave = w as BuzzerWave | 'auto';
      this.soundOn = localStorage.getItem(LS_ON) !== '0';   // on unless explicitly muted
    } catch { /* fresh profile / no storage: ON, auto */ }
  }

  /** Arm the autoplay unlock (call once at app start): the first real
   *  pointer/key gesture creates + resumes the context and plays a silent
   *  buffer — Firefox arms a context only when audio actually plays in it.
   *  Keeps the listeners: a later unmute is then gesture-armed too. */
  private armed = false;
  arm(): void {
    if (this.armed || typeof addEventListener === 'undefined') return;
    this.armed = true;
    const unlock = () => {
      if (!this.soundOn) return;
      try {
        const ctx = this.ensureCtx();
        void ctx.resume();
        const b = ctx.createBuffer(1, 1, ctx.sampleRate);
        const src = ctx.createBufferSource();
        src.buffer = b;
        src.connect(ctx.destination);
        src.start(0);
      } catch { /* no audio device: silent game, never crashes */ }
    };
    addEventListener('pointerdown', unlock, { capture: true });
    addEventListener('keydown', unlock, { capture: true });
  }

  setWave(w: BuzzerWave | 'auto') {
    this.wave = w;
    try { localStorage.setItem(LS_WAVE, w); } catch { /* private mode */ }
  }

  /** 🔊 toggle. Creates AND resumes the AudioContext synchronously inside
   *  the click (user gesture): a context lazily created later (in sync(),
   *  from the rAF loop) starts SUSPENDED and browsers refuse to resume it
   *  outside a gesture — that silent path was the "I dont hear the
   *  buzzers" report. Returns the new state. */
  toggleSound(): boolean {
    this.soundOn = !this.soundOn;
    try { localStorage.setItem(LS_ON, this.soundOn ? '1' : '0'); } catch { /* private mode */ }
    if (this.soundOn) {
      try {
        const ctx = this.ensureCtx();
        void ctx.resume();
        // FIREFOX UNLOCK (we: "the sound won't turn on in Firefox"):
        // Firefox arms a context from a gesture only when audio ACTUALLY
        // plays in it — play a 1-frame silent buffer inside the click, and
        // self-heal on any later pointer/key gesture.
        const b = ctx.createBuffer(1, 1, ctx.sampleRate);
        const src = ctx.createBufferSource();
        src.buffer = b;
        src.connect(ctx.destination);
        src.start(0);
        const unlock = () => { if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume(); };
        addEventListener('pointerdown', unlock, { capture: true, once: true });
        addEventListener('keydown', unlock, { capture: true, once: true });
      } catch { /* no audio device: stays silent, never crashes */ }
    } else this.stopAll();
    return this.soundOn;
  }

  /** Called once per pump cycle. */
  sync(pump: XenonPump) {
    if (!this.soundOn || !pump.run?.running) { this.level = 0; this.stopAll(); return; }
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();  // self-heal (Firefox)
    const rows = buzzerReadings(pump);
    // activity level: even with audio unavailable (headless, no audio
    // device) the TopBar animation reflects what the program is SENDING
    this.level = rows.reduce((m, r) => Math.max(m, r.amp), 0);
    if (typeof AudioContext === 'undefined') return;
    const live = new Set<string>();
    for (const r of rows) {
      if (r.amp <= 0) continue;      // silent readings never enter `live`
      live.add(r.name);
      let v = this.voices.get(r.name);
      try {
        const wantKind = (this.wave === 'auto' ? r.wave : this.wave) as BuzzerWave;
        if (!v) {
          const ctx = this.ensureCtx();
          void ctx.resume();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.setPeriodicWave(this.waveFor(wantKind, ctx));
          gain.gain.value = 0;
          osc.connect(gain);
          gain.connect(this.master!);
          osc.start();
          v = { osc, gain, kind: wantKind, hold: 0, beepUntil: 0 };
          this.voices.set(r.name, v);
        }
        const now = this.ctx!.currentTime;
        if (v.kind !== wantKind) {
          // per-voice tone: the component's authored mode in 'auto', the
          // picked wave as an override (we: "do the buzzers correctly do the
          // saw tooth as the game expects? The sound is funky")
          v.osc.setPeriodicWave(this.waveFor(wantKind, this.ctx!));
          v.kind = wantKind;
        }
        v.osc.frequency.setTargetAtTime(r.freq, now, 0.01);
        if (now >= v.beepUntil) {
          // gain steering only while no write-time envelope owns the voice
          v.gain.gain.setTargetAtTime(voiceGain(r.amp), now, 0.02);
          v.hold = now + BuzzerAudio.HOLD;   // peak-hold the last loud sample
        }
      } catch {
        // no audio device / context refused: stay silent, never break the pump
        this.stopAll();
        return;
      }
    }
    const stopNow = this.ctx?.currentTime ?? 0;
    for (const [name, v] of [...this.voices])
      if (!live.has(name) && stopNow >= v.hold) {
        try { v.osc.stop(); v.osc.disconnect(); v.gain.disconnect(); } catch { /* already gone */ }
        this.voices.delete(name);
      }
  }

  stopAll() {
    for (const v of this.voices.values()) {
      try { v.osc.stop(); v.osc.disconnect(); v.gain.disconnect(); } catch { /* already gone */ }
    }
    this.voices.clear();
  }
}

export const buzzerAudio = new BuzzerAudio();
