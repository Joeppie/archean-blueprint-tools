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

const MASTER_GAIN = 0.4;    // a full-amplitude buzzer is a solid, not a blast

/** Game buzzers run quiet amplitudes (Chip's Mario writes ~0.05..0.3), so
 *  a linear ·0.25 gain sat at ≈ −33 dB — the "I dont hear the buzzers"
 *  report. Lift the low end (×1.8, capped) and scale to 0.4. Pure —
 *  vitest-pinned. */
export function voiceGain(amp: number): number {
  return Math.min(1, Math.max(0, amp) * 1.8) * MASTER_GAIN;
}

/** WebAudio mixer: one square-wave-capable oscillator per loud Buzzer.
 *  The wave type is the SHARED config choice (the game menus each buzzer
 *  separately; we expose one app-level choice, persisted). */
export class BuzzerAudio {
  /** 'auto' = each buzzer plays the tone its COMPONENT authored
   *  (data.mode) — the game's own law; a named wave here overrides all. */
  wave: BuzzerWave | 'auto' = 'auto';
  soundOn = false;
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
  private voices = new Map<string, { osc: OscillatorNode; gain: GainNode }>();

  private ensureCtx(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 1;
    const comp = ctx.createDynamicsCompressor();
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    master.connect(comp);
    comp.connect(ctx.destination);
    comp.connect(an);
    an.connect(ctx.destination);
    this.ctx = ctx; this.master = master; this.analyser = an;
    this.analyBuf = new Float32Array(an.fftSize);
    return ctx;
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
      this.soundOn = localStorage.getItem(LS_ON) === '1';
    } catch { /* fresh profile */ }
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
      if (r.amp <= 0) continue;
      live.add(r.name);
      let v = this.voices.get(r.name);
      try {
        if (!v) {
          const ctx = this.ensureCtx();
          void ctx.resume();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = (this.wave === 'auto' ? r.wave : this.wave) as OscillatorType;
          gain.gain.value = 0;
          osc.connect(gain);
          gain.connect(this.master!);
          osc.start();
          v = { osc, gain };
          this.voices.set(r.name, v);
        }
        const now = this.ctx!.currentTime;
        // per-voice tone: the component's authored mode in 'auto', the
        // picked wave as an override (we: "do the buzzers correctly do the
        // saw tooth as the game expects? The sound is funky")
        v.osc.type = (this.wave === 'auto' ? r.wave : this.wave) as OscillatorType;
        v.osc.frequency.setTargetAtTime(r.freq, now, 0.01);
        v.gain.gain.setTargetAtTime(voiceGain(r.amp), now, 0.02);
      } catch {
        // no audio device / context refused: stay silent, never break the pump
        this.stopAll();
        return;
      }
    }
    for (const [name, v] of [...this.voices])
      if (!live.has(name)) {
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
