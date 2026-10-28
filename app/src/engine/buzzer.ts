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

export type BuzzerWave = 'sine' | 'square' | 'triangle' | 'sawtooth';
export const BUZZER_WAVES: BuzzerWave[] = ['sine', 'square', 'triangle', 'sawtooth'];

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
    out.push({
      name: d.alias || `io ${d.io}`,
      io: d.io,
      amp: Math.max(0, Math.min(1, get(0))),
      freq: freq > 0 ? Math.min(20000, freq) : 440,
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
  wave: BuzzerWave = 'square';
  soundOn = false;
  /** Loudest Amplitude seen in the latest sync (0 = all silent) — drives
   *  the TopBar 🔊 activity animation ("animates whenever any buzzer is
   *  making sound so its evident that is the reason there is sound"). */
  level = 0;
  private ctx: AudioContext | null = null;
  private voices = new Map<string, { osc: OscillatorNode; gain: GainNode }>();

  constructor() {
    try {
      const w = localStorage.getItem(LS_WAVE);
      if (w && (BUZZER_WAVES as string[]).includes(w)) this.wave = w as BuzzerWave;
      this.soundOn = localStorage.getItem(LS_ON) === '1';
    } catch { /* fresh profile */ }
  }

  setWave(w: BuzzerWave) {
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
        this.ctx ??= new AudioContext();
        void this.ctx.resume();
      } catch { /* no audio device: stays silent, never crashes */ }
    } else this.stopAll();
    return this.soundOn;
  }

  /** Called once per pump cycle. */
  sync(pump: XenonPump) {
    if (!this.soundOn || !pump.run?.running) { this.level = 0; this.stopAll(); return; }
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
          this.ctx ??= new AudioContext();
          void this.ctx.resume();
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = this.wave;
          gain.gain.value = 0;
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start();
          v = { osc, gain };
          this.voices.set(r.name, v);
        }
        const now = this.ctx!.currentTime;
        v.osc.type = this.wave;
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
