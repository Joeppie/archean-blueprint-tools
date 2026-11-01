// schematicsymbols.ts — THE SYMBOL LAW (v1.17.2, we: "the airplane is very
// nice, the cockpit is too complex … the helicopter rotor is not good. How
// would you approach it? I think a schematic should be more symbolic of
// components; the plane is very geometric, the helicopter is too complex").
//
// An engineering drawing does NOT render parts — it SYMBOLS them: a motor
// is a circle with an M, a valve a glyph. Three layers:
//   1. STRUCTURE (hull blocks / skin / struts) — mesh line census: real
//      geometry, drawn as hairline wire (the plane's planform — the good
//      kind of detail).
//   2. PARTS — collider box (exact placement, the drawing idiom) + a type
//      GLYPH oriented by the part's real axis. A propeller becomes its
//      sweep circle + blade ticks: MORE recognizable than its mesh, at
//      ~20 strokes instead of 20 000.
//   3. CONNECTIONS — device-coloured net runs + io tags (unchanged).
//
// Pure + vitest-pinned: a glyph is (centre px, px-per-metre, axis angle)
// → SVG path strings; no THREE, no DOM.

/** m: metres, s: px per metre, cx/cy: centre px, a: projected axis
 *  angle (radians, screen space — 0 = +u). Returns SVG child markup
 *  (paths/circles/lines, NO fill — the caller's <g> sets stroke). */
export type Glyph = (cx: number, cy: number, s: number, a: number) => string;

const circ = (cx: number, cy: number, r: number) =>
  `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="none"/>`;
const seg = (x1: number, y1: number, x2: number, y2: number) =>
  `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
const dot = (cx: number, cy: number, r = 2) =>
  `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}"/>`;
/** arc from a0 to a1 (radians) at r, screen space */
const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
  const x0 = cx + Math.cos(a0) * r, y0 = cy + Math.sin(a0) * r;
  const x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r;
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  return `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)}A${r.toFixed(1)} ${r.toFixed(1)} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" fill="none"/>`;
};
const nTick = (cx: number, cy: number, r0: number, r1: number, a: number) =>
  seg(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);

/** Propeller / RCS / thruster: the SWEEP CIRCLE + blade ticks + hub.
 *  blades = data.blades (clamped 2..8); blades render as ticks across
 *  the disc at the blade angles (the drawing says "N blades on this
 *  axis"), the axis line shows the disc plane in this view. */
export const glyphProp: Glyph = (cx, cy, s, a) => {
  const r = 0.6 * s;
  const out: string[] = [circ(cx, cy, r), circ(cx, cy, 0.08 * s)];
  for (let k = 0; k < 4; k++) out.push(seg(cx, cy, cx + Math.cos(a + k * Math.PI / 4) * r, cy + Math.sin(a + k * Math.PI / 4) * r));
  out.push(nTick(cx, cy, r * 0.92, r * 1.12, a), nTick(cx, cy, r * 0.92, r * 1.12, a + Math.PI));
  return out.join('');
};

/** Wheels: TREAD circle + pitch circle + spokes (user: "For wheels its OK
 *  to keep as is" — the symbol keeps the wheel look, at 12 strokes). */
export const glyphWheel: Glyph = (cx, cy, s) => {
  const r = 0.45 * s;
  const out = [circ(cx, cy, r), circ(cx, cy, r * 0.72), circ(cx, cy, 0.07 * s)];
  for (let k = 0; k < 6; k++) out.push(nTick(cx, cy, r * 0.72, r, k * Math.PI / 3));
  return out.join('');
};

/** Hinge / Pivot: PIVOT DOT + sweep ARROW (the joint's travel, the
 *  drawing says which way the panel swings). */
export const glyphHinge: Glyph = (cx, cy, s, a) =>
  dot(cx, cy, 2.4) + circ(cx, cy, 0.06 * s)
  + arc(cx, cy, 0.42 * s, a - 1.9, a + 1.1)
  + nTick(cx + Math.cos(a + 1.1) * 0.42 * s, cy + Math.sin(a + 1.1) * 0.42 * s, 0, 0.12 * s, a + 1.1 + 2.4);

/** LinearTrack: rail line + carriage + end stops. */
export const glyphTrack: Glyph = (cx, cy, s, a) =>
  seg(cx - Math.cos(a) * 0.5 * s, cy - Math.sin(a) * 0.5 * s, cx + Math.cos(a) * 0.5 * s, cy + Math.sin(a) * 0.5 * s)
  + nTick(cx, cy, -0.09 * s, 0.09 * s, a + Math.PI / 2)
  + nTick(cx - Math.cos(a) * 0.5 * s, cy - Math.sin(a) * 0.5 * s, -0.09 * s, 0.09 * s, a + Math.PI / 2)
  + nTick(cx + Math.cos(a) * 0.5 * s, cy + Math.sin(a) * 0.5 * s, -0.09 * s, 0.09 * s, a + Math.PI / 2);

/** Control surfaces: thin PLATE + hinge dashes + deflection arrow. */
export const glyphSurface: Glyph = (cx, cy, s, a) =>
  seg(cx - Math.cos(a) * 0.45 * s, cy - Math.sin(a) * 0.45 * s, cx + Math.cos(a) * 0.45 * s, cy + Math.sin(a) * 0.45 * s)
  + nTick(cx, cy, -0.1 * s, 0.1 * s, a + Math.PI / 2)
  + arc(cx, cy, 0.3 * s, a + 0.2, a + 1.2);

/** Computer family: chip box + pins (2×3) + core square. */
const glyphChip = (cx: number, cy: number, s: number, _a: number, tag = ''): string => {
  const w = 0.42 * s, h = 0.34 * s;
  const out = [
    `<rect x="${(cx - w).toFixed(1)}" y="${(cy - h).toFixed(1)}" width="${(2 * w).toFixed(1)}" height="${(2 * h).toFixed(1)}" fill="none"/>`,
    `<rect x="${(cx - w * 0.42).toFixed(1)}" y="${(cy - h * 0.42).toFixed(1)}" width="${(w * 0.84).toFixed(1)}" height="${(h * 0.84).toFixed(1)}" fill="none"/>`];
  for (let k = -1; k <= 1; k++) {
    out.push(seg(cx + k * w * 0.6, cy - h, cx + k * w * 0.6, cy - h - 0.08 * s));
    out.push(seg(cx + k * w * 0.6, cy + h, cx + k * w * 0.6, cy + h + 0.08 * s));
  }
  return out.join('') + (tag ? `<text x="${cx.toFixed(1)}" y="${(cy + h + 0.2 * s).toFixed(1)}" font-size="${Math.max(7, s * 0.16).toFixed(0)}" text-anchor="middle" stroke-width="0.5">${tag}</text>` : '');
};

/** Lamp / SpotLight: emitter circle + rays. */
export const glyphLamp: Glyph = (cx, cy, s, a) => {
  const out = [circ(cx, cy, 0.16 * s)];
  for (let k = 0; k < 5; k++) {
    const ang = a - 0.6 + k * 0.3;
    out.push(nTick(cx, cy, 0.22 * s, 0.38 * s, ang));
  }
  return out.join('');
};

/** Buzzer: drum + sound arcs. */
export const glyphBuzzer: Glyph = (cx, cy, s, a) =>
  circ(cx, cy, 0.18 * s) + dot(cx, cy, 1.6)
  + arc(cx, cy, 0.3 * s, a - 0.7, a + 0.7)
  + arc(cx, cy, 0.42 * s, a - 0.7, a + 0.7);

/** PilotSeat: seat PROFILE (base + back) + pilot dot — the cockpit
 *  complexity dissolves into nine strokes. */
export const glyphSeat: Glyph = (cx, cy, s, a) => {
  const c = Math.cos(a), si = Math.sin(a);
  const P = (u: number, v: number): [number, number] => [cx + u * c - v * si, cy + u * si + v * c];
  const [x1, y1] = P(-0.3 * s, 0.12 * s), [x2, y2] = P(0.3 * s, 0.12 * s);
  const [x3, y3] = P(-0.3 * s, 0.12 * s), [x4, y4] = P(-0.3 * s, -0.4 * s);
  const [x5, y5] = P(0.34 * s, -0.18 * s), [x6, y6] = P(0.14 * s, -0.18 * s);
  return seg(x1, y1, x2, y2) + seg(x3, y3, x4, y4)
    + `<path d="M${x2.toFixed(1)} ${y2.toFixed(1)}q${(0.1 * s).toFixed(1)} ${(-0.26 * s).toFixed(1)} ${(0.02 * s).toFixed(1)} ${(-0.44 * s).toFixed(1)}" fill="none"/>`
    + circ(x5, y5, 0.09 * s) + seg(x5, y5, x6, y6);
};

/** Battery: cell plates (long/short alternation, the universal symbol). */
export const glyphBattery: Glyph = (cx, cy, s, a) => {
  const out: string[] = [];
  const px = Math.cos(a + Math.PI / 2), py = Math.sin(a + Math.PI / 2);
  for (let k = 0; k < 3; k++) {
    const off = (k - 1) * 0.16 * s;
    const long = k % 2 === 0;
    const hx = cx + Math.cos(a) * off, hy = cy + Math.sin(a) * off;
    const L = long ? 0.3 : 0.16;
    out.push(seg(hx - px * L * s, hy - py * L * s, hx + px * L * s, hy + py * L * s));
  }
  out.push(seg(cx - Math.cos(a) * 0.44 * s, cy - Math.sin(a) * 0.44 * s, cx - Math.cos(a) * 0.16 * s, cy - Math.sin(a) * 0.16 * s));
  out.push(seg(cx + Math.cos(a) * 0.16 * s, cy + Math.sin(a) * 0.16 * s, cx + Math.cos(a) * 0.44 * s, cy + Math.sin(a) * 0.44 * s));
  return out.join('');
};

/** Relay / switch: two contacts + hinged blade. */
export const glyphRelay: Glyph = (cx, cy, s, a) =>
  dot(cx - 0.22 * s, cy, 2) + dot(cx + 0.22 * s, cy, 2)
  + seg(cx - 0.22 * s, cy, cx + 0.16 * s, cy - 0.26 * s)
  + arc(cx, cy, 0.1 * s, a, a + 4.5);

/** Beacon: mast + waves (the COMMS glyph). */
export const glyphBeacon: Glyph = (cx, cy, s, a) =>
  seg(cx, cy + 0.3 * s, cx, cy - 0.2 * s)
  + dot(cx, cy - 0.26 * s, 2)
  + arc(cx, cy - 0.26 * s, 0.16 * s, a - 2.6, a - 0.6)
  + arc(cx, cy - 0.26 * s, 0.28 * s, a - 2.6, a - 0.6);

/** Sensor family: DIAMOND + crosshair (instrument idiom). */
export const glyphSensor: Glyph = (cx, cy, s) =>
  `<path d="M${cx.toFixed(1)} ${(cy - 0.3 * s).toFixed(1)}L${(cx + 0.3 * s).toFixed(1)} ${cy.toFixed(1)}L${cx.toFixed(1)} ${(cy + 0.3 * s).toFixed(1)}L${(cx - 0.3 * s).toFixed(1)} ${cy.toFixed(1)}Z" fill="none"/>`
  + seg(cx - 0.12 * s, cy, cx + 0.12 * s, cy) + seg(cx, cy - 0.12 * s, cx, cy + 0.12 * s);

/** Tank / container: drum outline + fill line. */
export const glyphTank: Glyph = (cx, cy, s) =>
  `<rect x="${(cx - 0.34 * s).toFixed(1)}" y="${(cy - 0.3 * s).toFixed(1)}" width="${(0.68 * s).toFixed(1)}" height="${(0.6 * s).toFixed(1)}" rx="${(0.08 * s).toFixed(1)}" fill="none"/>`
  + seg(cx - 0.34 * s, cy + 0.1 * s, cx + 0.34 * s, cy + 0.1 * s);

/** Fallback: diamond + dot (generic device). */
export const glyphGeneric: Glyph = (cx, cy, s) =>
  `<path d="M${cx.toFixed(1)} ${(cy - 0.26 * s).toFixed(1)}L${(cx + 0.26 * s).toFixed(1)} ${cy.toFixed(1)}L${cx.toFixed(1)} ${(cy + 0.26 * s).toFixed(1)}L${(cx - 0.26 * s).toFixed(1)} ${cy.toFixed(1)}Z" fill="none"/>` + dot(cx, cy, 1.6);

const chip = (tag: string): Glyph => (cx, cy, s, a) => glyphChip(cx, cy, s, a, tag);

/** type → symbol. Keys are component types; the pattern list catches
 *  families. Unknown types get glyphGeneric (never a mesh flood). */
const SYMBOLS: Record<string, Glyph> = {
  Propeller: glyphProp,
  Wheel: glyphWheel, BigWheel: glyphWheel, SmallWheel: glyphWheel,
  SmallHinge: glyphHinge, SmallPivot: glyphHinge,
  LinearTrack: glyphTrack,
  Aileron: glyphSurface, Elevator: glyphSurface, Rudder: glyphSurface, AerodynamicProfile: glyphSurface,
  Computer: chip('CMP'), MiniComputer: chip('MCU'), Crafter: chip('CRF'),
  MiniRouter: chip('RTR'), Router: chip('RTR'), DataJunction: chip('JCT'), DataBridge: chip('BRG'),
  HudController: chip('HUD'),
  Lamp: glyphLamp, SpotLight: glyphLamp, SlopeLight: glyphLamp,
  Buzzer: glyphBuzzer, Beacon: glyphBeacon,
  PilotSeat: glyphSeat,
  LowVoltageBattery: glyphBattery, HighVoltageBattery: glyphBattery,
  LowVoltageRelay: glyphRelay, HighVoltageRelay: glyphRelay,
  AngularVelocitySensor: glyphSensor, SpeedSensor: glyphSensor, DensitySensor: glyphSensor,
  SolarSensor: glyphSensor, TemperatureSensor: glyphSensor, VehiclePhysicsSensor: glyphSensor,
  MiniNavInstrument: glyphSensor,
  SmallContainer: glyphTank, BigFluidTank: glyphTank,
};

/** The symbol for a component type (generic diamond for unlisted types).
 *  DASHBOARD is special: the caller draws the authored board + element
 *  grids directly (the board IS already schematic geometry). */
export function symbolFor(type: string): Glyph {
  return SYMBOLS[type] ?? glyphGeneric;
}
