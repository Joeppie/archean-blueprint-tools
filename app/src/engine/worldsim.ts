// worldsim.ts — the WORLD SIM panel behind the Xenon IDE (v1.13.x: "World
// should be under xenoncode, be its own screen and we should have functions
// that we can put in that define values over time, i.e. sin(t) … give
// sensible defaults so that we have a somewhat realistic scenario going on
// for a craft at flight at 2000 metres, going 80 metres per second forward").
//
// Every sensor channel the running program reads (numbered io AND alias-
// addressed) is a worldsim ROW with an expression in `t` (elapsed seconds).
// The pump evaluates every row each cycle and feeds the VM's io input — so
// headings sweep, airspeed breathes, the pilot oscillates. Programs can
// override a named channel from inside XenonCode (setworldsim/getworldsim,
// xc_host) — a program override wins until released (value 9e99); the
// effective values stream back so getworldsim(name) answers the live world.
//
// EXPRESSION LANGUAGE: numbers, t, pi, e, + - * / % ( ) and the whitelisted
// fns sin cos tan asin acos atan atan2 abs sqrt exp log floor ceil sign
// min max pow. Values clamp to ±1e9 (the game io ranges are all sane-small).

export interface WorldSimChan {
  name: string;                       // worldsim name: `${device-slug}.${channel-slug}`
  label: string;                      // 'NavInstrument · Altitude (meters from sea level)'
  kind: 'sensor' | 'control';         // only the WORLD's observers get $val overrides
  base: string;                       // f(t): the global value over time
  override: string;                   // g($val, t): a SENSOR override ('' = none)
  mode: 'auto' | 'manual';            // auto: base drives, manual: the slider does
  manual: number;                     // manual-mode value
  value: number;                      // last effective value
  error?: string;                     // last expression error (shown, not swallowed)
}

/** The GLOBAL worldsim (we: "worldsim should be global, not tied to
 *  individual sensors … a global menu you can edit independently").
 *  Channels are keyed by NAME, shared by every craft, and persisted —
 *  bindings (which computer's io/ch feeds on a name) are per-run. */
const LS_KEY = 'archea…im';
const chans = new Map<string, WorldSimChan>();

export function wsChans(): Map<string, WorldSimChan> { return chans; }

export function wsEnsure(name: string, label: string, kind: WorldSimChan['kind'], defBase: string): WorldSimChan {
  let c = chans.get(name);
  if (!c) {
    c = { name, label, kind, base: defBase, override: '', mode: 'auto', manual: 0, value: 0 };
    chans.set(name, c);
  } else {
    c.label = label;                 // labels refresh from the game tables
    c.kind = kind;
  }
  return c;
}

export function wsLoad(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    for (const c of JSON.parse(raw) as WorldSimChan[])
      if (c && c.name) chans.set(c.name, { ...c, value: 0, error: undefined });
  } catch { /* fresh world */ }
}

export function wsSave(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const rows = [...chans.values()].map(({ value: _v, error: _e, ...c }) => c);
    localStorage.setItem(LS_KEY, JSON.stringify(rows));
  } catch { /* private mode */ }
}

/** SENSOR = an OBSERVER of the world (we: "that option is only available
 *  to ACTUAL sensors that observe the world, e.g. pressure/navinstrument")
 *  — only these get the $val override. Everything else (the pilot's
 *  controls AND the actuators: wheels, props, relays, lamps, hinges) is
 *  CONTROL: toggleable/oscillatable from worldsim, grouped apart, no $val. */
const SENSOR_RE = /sensor$|(^|_)(mini)?navinstrument$|altimeter|transponder|gps/;
export function wsKind(typeLower: string): 'sensor' | 'control' {
  return SENSOR_RE.test(typeLower) ? 'sensor' : 'control';
}

const FNS = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'abs',
  'sqrt', 'exp', 'log', 'floor', 'ceil', 'sign', 'min', 'max', 'pow']);

/** Evaluate a worldsim expression at elapsed seconds t (and, for SENSOR
 *  overrides, the channel's raw value as $val). Throws on anything outside
 *  the whitelist (the panel shows the error on the row). */
export function evalExpr(expr: string, t: number, val?: number): number {
  const src = expr.trim();
  if (!src) throw new Error('empty');
  const hasVal = /\$val\b/.test(src);
  if (hasVal && val === undefined) throw new Error('$val needs a base value');
  const pre = src.replace(/\$val\b/g, 'WSVAL');
  let js = pre.replace(/[A-Za-z_][A-Za-z_0-9]*/g, m => {
    const lm = m.toLowerCase();
    if (lm === 't') return 't';
    if (lm === 'wsval') return 'WSVAL';
    if (lm === 'pi') return 'Math.PI';
    if (lm === 'e') return 'Math.E';
    if (FNS.has(lm)) return 'Math.' + lm;
    throw new Error(`unknown name '${m}'`);
  });
  if (/[^A-Za-z0-9_.+\-*/%(), ]/.test(js)) throw new Error('illegal character');
  if (/[A-Za-z]+/.test(js.replace(/Math\.[A-Za-z0-9]+/g, '').replace(/\bt\b/g, '').replace(/\bWSVAL\b/g, '')))
    throw new Error('unknown name');
  // eslint-disable-next-line no-new-func
  const v = new Function('t', 'WSVAL', `'use strict';return (${js});`)(
    t, val ?? 0) as unknown;
  if (typeof v !== 'number' || Number.isNaN(v)) throw new Error('not a number');
  if (!Number.isFinite(v)) return v > 0 ? 1e9 : -1e9;
  return Math.max(-1e9, Math.min(1e9, v));
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** The worldsim NAME of a channel (predefined, program-addressable): the
 *  device's alias (or type) slugged + the channel function slugged. */
export function wsName(aliasOrType: string, chanFn: string | null, ch: number): string {
  return `${slug(aliasOrType)}.${chanFn ? slug(chanFn) : 'ch' + ch}`;
}

/** Sensible defaults: a craft in level flight at 2000 m, 80 m/s (we:
 *  "sensible defaults … at flight at 2000 metres, going 80 metres per
 *  second forward"). Matched on the GAME's own channel-function words
 *  (channels.json), oscillating gently so telemetry is visibly alive. */
export function worldsimDefault(fnLower: string | null, typeLower: string): string {
  const f = fnLower ?? '';
  const hit = (re: RegExp) => re.test(f);
  if (typeLower === 'pilotseat') {
    if (hit(/using/)) return '1';                                   // seat occupied
    if (hit(/backward|forward/)) return '0.6 + 0.2*sin(t/11)';      // throttle-ish
    if (hit(/left\/right|left\/|right/)) return '0.25*sin(t/9)';    // roll stick
    if (hit(/down|up/)) return '0.15*sin(t/7)';
    if (hit(/pitch/)) return '0.12*sin(t/13)';
    if (hit(/roll/)) return '0.10*sin(t/17)';
    if (hit(/yaw/)) return '0.06*sin(t/23)';
    if (hit(/thrust/)) return '0.72 + 0.05*sin(t/15)';
    if (hit(/aux/)) return '0';
  }
  if (hit(/above terrain/)) return '1940 + 4*sin(t/17)';
  if (hit(/altitude/)) return '2000 + 5*sin(t/20)';
  if (hit(/airspeed/)) return '80 + 2*sin(t/13)';
  if (hit(/ground speed forward/)) return '80 + 2*sin(t/13)';
  if (hit(/ground speed right/)) return '0.4*sin(t/11)';
  if (hit(/ground speed/)) return '80 + 2*sin(t/13)';
  if (hit(/vertical speed/)) return '0.8*sin(t/9)';
  if (hit(/orbital speed/)) return '0';
  if (hit(/heading/)) return '(42 + 0.5*t) % 360';
  if (hit(/course/)) return '(42 + 0.5*t) % 360';
  if (hit(/latitude/)) return '51.5 + 0.00003*t';
  if (hit(/longitude/)) return '-0.1 + 0.000012*t';
  if (hit(/periapsis/)) return '6.6e6';
  if (hit(/apoapsis/)) return '6.7e6';
  if (hit(/inclination/)) return '0.4';
  if (hit(/horizon pitch/)) return '0.03*sin(t/6)';
  if (hit(/horizon roll/)) return '0.02*sin(t/8)';
  if (hit(/prograde|retrograde|locator/)) return '0.1*sin(t/12)';
  if (hit(/temperature/)) return '281.5 + 0.5*sin(t/30)';           // ISA at 2 km
  if (hit(/density/)) return '1.006 + 0.002*sin(t/25)';             // ~2 km
  if (hit(/solar|irradiance/)) return '0.9 + 0.05*sin(t/40)';
  if (hit(/angular velocity|gyro/)) return '0.02*sin(t/3)';
  if (hit(/charge/)) return '0.8 - 0.00001*t';
  if (hit(/speed/)) return '80 + 2*sin(t/13)';
  if (hit(/throttle|thrust/)) return '0.7 + 0.05*sin(t/15)';
  if (hit(/depth/)) return '0.5 + 0.2*sin(t/12)';
  if (hit(/efficiency|mining|drilling/)) return '0.75 + 0.1*sin(t/9)';
  if (hit(/distance/)) return '1000 + 50*sin(t/19)';
  if (hit(/latch|present|dock|anchor|extension|deploy/)) return '1';
  if (hit(/pitch/)) return '0.1*sin(t/13)';
  if (hit(/roll/)) return '0.08*sin(t/17)';
  if (hit(/yaw/)) return '0.05*sin(t/23)';
  return '0.5 + 0.5*sin(t/7)';
}
