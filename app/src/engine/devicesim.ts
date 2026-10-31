// devicesim.ts — THE CRAFT ACTUATOR SIM (v1.15.6 "bring the craft to life").
//
// The io bus carries (device, channel, value) writes; this module is what
// they MEAN. The semantics are the game's own (wiki components/*, mirrored
// in viewer/models/channels.json — tools/extract_channels.py):
//
//  • SmallHinge — SERVO ONLY. Channel 0 takes −1.0..+1.0 → the panel turns
//    to v·90° (the .ini [JOINT] limits [-90,0,90]). data.maxSpeed (rot/s)
//    rate-limits the swing; the corpus writes data.inputValue = the last
//    channel value (the game stores it verbatim).
//  • SmallPivot — servo: ch0 v → v·360°; VELOCITY mode (data.servoMode
//    false) — v is a signed speed, angle integrates at v·maxSpeed rot/s.
//  • LinearTrack — servo: ch0 is an ABSOLUTE POSITION in metres, clamped to
//    minPos..maxPos (overrideLimits → manualMinPos/manualMaxPos); velocity
//    mode integrates v·maxSpeed m/s. Channel 0 of the wiki is "meters" —
//    no normalisation (the wiki's own row).
//  • Lamp/SpotLight/SlopeLight — ch0 on/off, ch1..3 RED/GREEN/BLUE 0..255.
//  • Propeller — ch0 speed −1..1 (the spin visual), ch1 pitch.
//  • Wheel/BigWheel/SmallWheel — ch1 Steer −1..1 → the steering node yaws
//    to v·30° (.ini limits [30,0,-30]); ch0 Accelerate integrates the axle.
//  • Aileron — the flight-control metaphor: deflection = the PilotSeat
//    ROLL channel · 45° (the .ini joint limits), likewise ELEVATOR→pitch
//    and RUDDER→yaw. In-game the pilot flies the surfaces; here the same
//    seat channels (worldsim rows / pilot keys) drive them.
//
// SIM IS A VIEW: nothing here writes the blueprint. Effective joint pose =
// the sim overlay where one exists, else the file's data.angle/data.pos —
// so saves stay byte-identical and the undo stack never sees a simulation.
// The scene applies the overlay on its own joint nodes (applyJointPoses)
// AND on subgrid groups (syncSubJoints) — a hinge that moves MOVES ITS
// PANEL (the master's joint state is the single kinematic source).
//
// PURE: no THREE, no DOM; `step(dt)` advances the servos, `snapshot()`
// answers what the scene renders. vitest pins the laws.

import type { Blueprint, BlueprintComponent } from './format';
import { flatToTopMap, flatEndpointTop } from './flat';

export interface JointDrive { angle?: number; slide?: number }

/** one component's rendered pose for this frame */
export interface DevicePose {
  /** per .ini joint-node NAME (manifest joints[].name): angle DEGREES /
   *  slide METRES — overlays the file data (absent key = file value) */
  joints?: Record<string, JointDrive>;
  /** lamp family: light colour 0..1 + on/off (the scene glows the model) */
  glow?: { r: number; g: number; b: number };
  /** wheel family: Steer channel (the proxy view yaws the stand-in) */
  steer?: number;
  /** dashboard element state (ci of the Dashboard + element index):
   *  pressed/latched look + LED face value 0..1 */
  led?: number;
  pressed?: boolean;
}

const num = (d: Record<string, unknown> | undefined, k: string, def = 0): number =>
  typeof d?.[k] === 'number' ? (d[k] as number) : def;

interface Servo {
  pos: number;          // deg (joints) / m (track) / deg accumulated (spin)
  vel: number;          // deg/s (rate limiting)
  target: number;
}

/** the actuator types this sim drives */
const SERVO_TYPES = new Set(['SmallHinge', 'SmallPivot', 'LinearTrack']);
/** Standalone button parts (wiki controllers/ToggleButton.md): their .ini
 *  axle lever (limits [18,18,−18]) tips to −18° while the channel reads a
 *  truthy state, rests at +18° — the 3-D press animates the lever. */
const BUTTON_TYPES = new Set(['ToggleButton', 'PushButton', 'ArrowButton']);
const GLOW_TYPES = new Set(['Lamp', 'SpotLight', 'SlopeLight', 'RCS']);
const SPIN_TYPES = new Set(['Propeller', 'Wheel', 'BigWheel', 'SmallWheel']);
const FLIGHT_TYPES = new Set(['Aileron', 'Elevator', 'Rudder']);

/** every joint-state field the sim can produce per type (bus write gates) */
export function drivesType(type: string): boolean {
  return SERVO_TYPES.has(type) || GLOW_TYPES.has(type)
    || SPIN_TYPES.has(type) || FLIGHT_TYPES.has(type) || BUTTON_TYPES.has(type);
}

/** THE DATA-CABLE LAW (pure): the top-level components a pressed device's
 *  data port is cabled to, filtered to the types the sim drives. A button
 *  cabled straight to a hinge (no computer) drives it — the game wires HID
 *  parts to actuator data ports directly. Pipe endpoints index the
 *  FLATTENED component array (nested content numbers BEFORE their Build),
 *  so an index past the top-level array is a SUBGRID part — outside the
 *  sim's registered space — and is skipped. */
export function dataNeighbours(bp: Blueprint, ci: number): { ci: number; type: string; alias: string }[] {
  const comps = bp.data.components as BlueprintComponent[];
  const out: { ci: number; type: string; alias: string }[] = [];
  // THE FLATTENED-ENDPOINT LAW (engine/flat.ts): translate pipe endpoints
  // to top-level ci; nested content (null) stays outside the sim.
  const fmap = flatToTopMap(bp);
  for (const p of (bp.data.pipes ?? []) as { type?: string; a_component: number; b_component: number }[]) {
    if ((p.type ?? 'data') !== 'data') continue;
    const flatOther = p.a_component === ci ? p.b_component : p.b_component === ci ? p.a_component : -1;
    if (flatOther < 0) continue;
    const other = flatEndpointTop(fmap, flatOther);
    if (other === undefined) continue;                     // nested: not simulated
    const oc = comps[other];
    if (oc && drivesType(oc.type) && !out.some(d => d.ci === other))
      out.push({ ci: other, type: oc.type, alias: typeof oc.alias === 'string' ? oc.alias : '' });
  }
  return out;
}

/** Wiki-exact servo mapping: SmallHinge −1.0..+1.0 → −90°..+90°; SmallPivot
 *  −1.0..+1.0 → −360°..+360° (0, −1 and +1 land on the same pose — one
 *  full turn of the .ini limits [−360,·,+360]). */
export function servoLimits(type: string, _limits: [number, number, number] | undefined,
  v: number): number {
  return v * (type === 'SmallPivot' ? 360 : 90);
}

/** LinearTrack servo clamp (the wiki: "reacts accordingly in the range
 *  between min and max" — bigger/smaller values just slam to the limit). */
export function trackTarget(data: Record<string, unknown>, v: number): number {
  const manual = data['overrideLimits'] === true;
  const lo = manual ? num(data, 'manualMinPos', -250) : num(data, 'minPos', -250);
  const hi = manual ? num(data, 'manualMaxPos', 250) : num(data, 'maxPos', 250);
  return Math.min(hi, Math.max(lo, v));
}

/** v1.16.15 SEAT→SURFACE CABLES (we: "im sending to an aileron, but I dont
 *  see effect"): the seats publish their channels on data_port.NN; the game
 *  feeds a cabled control surface straight from the seat. The target's
 *  channel = the digits of ITS port name (data / data_port.003 → 0 / 3). */
/** v1.16.15 SEAT→SURFACE CABLES (we: "im sending to an aileron, but I dont
 *  see effect"): the seats publish their channels on data_port.NN — a
 *  CHANNEL-numbered seat port (data_port.005) carries exactly that seat
 *  channel; a plain seat data-port cable mirrors the whole block by
 *  identity. The target's channel = the digits of ITS port name; a plain
 *  target port takes the CABLE ORDER (the game indexes a port's cables by
 *  drop order — two seat cables into a wheel's data port land on
 *  Accelerate then Steer). src = the seat-side channel, null = mirror. */
export function seatCableTargets(bp: Blueprint, seatCi: number):
  { ci: number; ch: number; src: number | null }[] {
  const portCh = (name: unknown): number | null => {
    const m = /(?:data_port|port)\.?(\d+)/i.exec(String(name ?? ''));
    return m ? +m[1]! : null;
  };
  const out: { ci: number; ch: number; src: number | null; plain: number }[] = [];
  const fmap = flatToTopMap(bp);
  for (const p of (bp.data.pipes ?? []) as { type?: string; a_component: number;
    a_port?: string; b_component: number; b_port?: string }[]) {
    if ((p.type ?? 'data') !== 'data') continue;
    const aTop = flatEndpointTop(fmap, p.a_component);
    const bTop = flatEndpointTop(fmap, p.b_component);
    let t: number | undefined, tPort: unknown, sPort: unknown;
    if (aTop === seatCi && bTop !== undefined) { t = bTop; tPort = p.b_port; sPort = p.a_port; }
    else if (bTop === seatCi && aTop !== undefined) { t = aTop; tPort = p.a_port; sPort = p.b_port; }
    else continue;
    out.push({ ci: t, ch: portCh(tPort) ?? 0, src: portCh(sPort),
      plain: portCh(tPort) === null ? 1 : 0 });
  }
  // plain target ports take their cable order (per target)
  const order = new Map<number, number>();
  return out.map(t => {
    if (t.plain) {
      const k = t.ci, n = order.get(k) ?? 0;
      order.set(k, n + 1);
      return { ci: t.ci, ch: n, src: t.src };
    }
    return { ci: t.ci, ch: t.ch, src: t.src };
  });
}

export class DeviceSim {
  /** ci -> component type (only drivable types registered) */
  private types = new Map<number, string>();
  private data = new Map<number, Record<string, unknown>>();
  private jointNames = new Map<number, string[]>();     // ci -> joint node names (manifest order)
  private limits = new Map<number, [number, number, number] | undefined>();
  private servos = new Map<number, Servo>();
  /** raw channel writes (devCi -> ch -> value) — the "inputValue" record */
  private chans = new Map<number, Map<number, number>>();
  private pilot = new Map<string, number>();            // 'Roll'|'Pitch'|'Yaw' -> -1..1
  /** per-field current angles not owned by a servo (glow/led/steer) */
  private spins = new Map<number, number>();            // propeller/wheel accumulated deg
  private ledVal = new Map<number, number>();           // ci*1000+ch -> 0..1
  private pressedEl = new Set<number>();                // ci*1000+ch latched/pressed

  /** (re)build the drivable table from a blueprint (top-level + subgrid
   *  parts share the flattened ci space of the scene, top-level here). */
  load(bp: Blueprint, jointNames: (type: string) => { name: string; limits: [number, number, number] | undefined }[]) {
    this.types = new Map(); this.data = new Map();
    this.jointNames = new Map(); this.limits = new Map();
    (bp.data.components as BlueprintComponent[]).forEach((c, ci) => {
      const jn = jointNames(c.type);
      if (SERVO_TYPES.has(c.type)) {
        this.types.set(ci, c.type);
        this.data.set(ci, (c.data ?? {}) as Record<string, unknown>);
        this.jointNames.set(ci, jn.map(j => j.name));
        this.limits.set(ci, jn[0]?.limits);
      } else if (GLOW_TYPES.has(c.type) || SPIN_TYPES.has(c.type) || FLIGHT_TYPES.has(c.type)
        || BUTTON_TYPES.has(c.type)) {
        this.types.set(ci, c.type);
        this.data.set(ci, (c.data ?? {}) as Record<string, unknown>);
        this.jointNames.set(ci, jn.map(j => j.name));
        this.limits.set(ci, jn[0]?.limits);
      }
    });
  }

  /** The io bus says: THIS device's channel changed. */
  write(devCi: number, ch: number, v: number): void {
    if (!this.types.has(devCi)) return;
    let m = this.chans.get(devCi);
    if (!m) this.chans.set(devCi, m = new Map());
    m.set(ch, v);
  }

  /** PilotSeat flight channels (worldsim row values) for the control
   *  surfaces: keys 'Roll' | 'Pitch' | 'Yaw' (the channels.json fn words). */
  writePilot(fn: 'Roll' | 'Pitch' | 'Yaw', v: number): void { this.pilot.set(fn, v); }

  /** dashboard element / standalone button press state (the 3-D press path) */
  setElement(devCi: number, ch: number, pressed: boolean): void {
    const k = devCi * 1000 + ch;
    if (pressed) this.pressedEl.add(k); else this.pressedEl.delete(k);
    this.write(devCi, ch, pressed ? 1 : 0);
  }

  /** Advance the servos. `dt` seconds (the 25 Hz pump cadence). */
  step(dt: number): void {
    for (const [ci, type] of this.types) {
      const ch = this.chans.get(ci);
      const d = this.data.get(ci) ?? {};
      if (SERVO_TYPES.has(type)) {
        const v = ch?.get(0);
        if (v === undefined) continue;
        const maxSpeed = Math.max(0.01, num(d, 'maxSpeed', 1)) * 360;   // deg/s
        const servo = this.servos.get(ci) ?? this.initServo(ci, type, d);
        const velMode = type !== 'SmallHinge' && d['servoMode'] === false;
        if (velMode) servo.pos += v * maxSpeed * dt;
        else {
          servo.target = type === 'LinearTrack'
            ? trackTarget(d, v)
            : servoLimits(type, this.limits.get(ci), Math.max(-1, Math.min(1, v)));
          // slew toward the target at ≤ maxSpeed (the game's Max Rotation
          // Speed; acceleration shaping is left as the data field for later)
          const err = servo.target - servo.pos;
          const cap = Math.min(Math.abs(err), maxSpeed * dt);
          servo.pos += Math.sign(err) * cap;
        }
        this.servos.set(ci, servo);
      } else if (SPIN_TYPES.has(type)) {
        const rate = type === 'Propeller'
          ? (ch?.get(0) ?? 0) * 720                      // visual: 2 rot/s at full
          : (ch?.get(0) ?? 0) * 360;                     // wheels: accelerate
        this.spins.set(ci, (this.spins.get(ci) ?? 0) + rate * dt);
      }
    }
  }

  private initServo(_ci: number, type: string, d: Record<string, unknown>): Servo {
    const pos = type === 'LinearTrack' ? num(d, 'pos') : num(d, 'angle');
    return { pos, vel: 0, target: pos };
  }

  /** The rendered pose per drivable component (absent = the file values). */
  snapshot(): Map<number, DevicePose> {
    const out = new Map<number, DevicePose>();
    for (const [ci, type] of this.types) {
      const pose: DevicePose = {};
      const names = this.jointNames.get(ci) ?? [];
      if (SERVO_TYPES.has(type) && this.servos.has(ci)) {
        const key = type === 'LinearTrack' ? 'slide' : 'angle';
        const v = this.servos.get(ci)!.pos;
        if (names[0]) pose.joints = { [names[0]]: { [key]: v } };
      } else if (FLIGHT_TYPES.has(type)) {
        const fn = type === 'Aileron' ? 'Roll' : type === 'Elevator' ? 'Pitch' : 'Yaw';
        const v = this.pilot.get(fn);
        if (v !== undefined && names[0]) {
          const lim = this.limits.get(ci);
          const span = lim ? Math.max(Math.abs(lim[0]), Math.abs(lim[2])) : 45;
          pose.joints = { [names[0]]: { angle: v * span } };
        }
      } else if (type === 'Propeller' && names[0]) {
        pose.joints = { [names[0]]: { angle: this.spins.get(ci) ?? 0 } };
      } else if ((type === 'Wheel' || type === 'BigWheel' || type === 'SmallWheel')
        && names.length) {
        pose.joints = {};
        const steer = this.chans.get(ci)?.get(1);
        const spin = this.spins.get(ci) ?? 0;
        pose.steer = steer ?? 0;   // proxy visual (the scene yaws the stand-in)
        for (const n of names) {
          // v1.16.15 (we: "nor qe on its nosewheel"): the SmallWheel's
          // steer node is the y-axis 'pivot' (the big wheels' is
          // 'steering') — the nose gear steers off channel 1 either way
          if ((n === 'steering' || n === 'pivot') && steer !== undefined)
            pose.joints[n] = { angle: steer * 30 };
          else if (n === 'axle') pose.joints[n] = { angle: spin };
        }
        if (!Object.keys(pose.joints).length) delete pose.joints;
      } else if (BUTTON_TYPES.has(type) && names[0]) {
        // the .ini axle lever (limits [18,18,−18]): pressed tips to the
        // lower limit, resting state stands at the upper one
        const lim = this.limits.get(ci);
        const on = (this.chans.get(ci)?.get(0) ?? 0) > 0;
        pose.joints = { [names[0]]: { angle: on ? (lim?.[2] ?? -18) : (lim?.[0] ?? 18) } };
      } else if (type === 'RCS') {
        // v1.16.15 (we: "RCS and aileron inputs … dont visually result in
        // actions"): a thruster FIRES — any nozzle channel over ~0 lights
        // the part (pale plume blue) on the proxy and the real model
        const ch = this.chans.get(ci);
        const fire = ch
          ? Math.max(0, ...[0, 1, 2, 3, 4].map(k => ch.get(k) ?? 0)) : 0;
        pose.glow = fire > 0.05
          ? { r: 0.55 * Math.min(1, fire), g: 0.75 * Math.min(1, fire), b: Math.min(1, fire) }
          : { r: 0, g: 0, b: 0 };
      } else if (GLOW_TYPES.has(type)) {
        const ch = this.chans.get(ci);
        if (ch) {
          const on = ch.has(0) ? ch.get(0)! > 0 : ((ch.get(1) ?? 0) + (ch.get(2) ?? 0) + (ch.get(3) ?? 0)) > 0;
          const rgb = { r: (ch.get(1) ?? 255) / 255, g: (ch.get(2) ?? 255) / 255, b: (ch.get(3) ?? 255) / 255 };
          pose.glow = on ? rgb : { r: 0, g: 0, b: 0 };
        }
      }
      for (const [k, v] of this.ledVal)
        if (Math.floor(k / 1000) === ci) {
          pose.led = v;
          pose.pressed = this.pressedEl.has(k);
        }
      if (pose.joints || pose.glow || pose.led !== undefined || pose.steer)
          out.set(ci, pose);
    }
    return out;
  }

  /** A dashboard/LED element's face value: 0..1 (bus channel, latched by a
   *  toggle). devCi*1000+ch. */
  setLed(devCi: number, ch: number, v01: number): void {
    this.ledVal.set(devCi * 1000 + ch, Math.max(0, Math.min(1, v01)));
  }

  clear(): void {
    this.servos = new Map(); this.chans = new Map(); this.pilot = new Map();
    this.spins = new Map(); this.ledVal = new Map();
    this.pressedEl = new Set();
  }

  /** The registered SERVO actuator components (hinge/pivot/track) — the
   *  SPARE-BUTTON BROADCAST targets (we: the dolphin's door toggles have no
   *  computer, "they should still be able to toggle and they toggle the
   *  hinges that are in that craft"). */
  actuators(): { ci: number; type: string }[] {
    const out: { ci: number; type: string }[] = [];
    for (const [ci, type] of this.types) if (SERVO_TYPES.has(type)) out.push({ ci, type });
    return out;
  }

  /** the io channel record for one device (the popup chip's "value" line) */
  channelValue(devCi: number, ch: number): number | undefined {
    return this.chans.get(devCi)?.get(ch);
  }
}
