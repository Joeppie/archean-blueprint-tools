// propeller.ts — the propeller surface is DATA-GENERATED, not the static
// gltf template (MATRIX.md §Propeller gap, backlog 2026-10-19).
//
// The game client ray-traces the prop from `data.blades/radius/width/twist/
// pitch` (SDF formulas of rt/propeller.common.inc.glsl); its gltf carries
// only a frozen 0.88 m template, so a craft comparing a 0.7 m and a 3 m prop
// would render the SAME blade. This module mirrors those formulas into a
// triangle surface — the dev viewer's `propellerGeometry`
// (viewer.xenontools.dev/js/scene.js, NOTICE §2 porting terms) is the
// reference and this file transcribes it 1:1; the knowledge lives here +
// FORMAT.md §Data-generated component geometry, never only online.
//
// Pure module (no THREE): returns the same flat `v`/`i` prim shape the model
// atlas uses (viewer/models/<Type>.json), so scene.ts swaps it in for the
// template's `prop` renderable node. Axis of rotation = local Y, blades fan
// in X·Z (the .ini `axle` node carries the mount tilt).

export interface PropellerData {
  blades?: unknown;
  radius?: unknown;
  width?: unknown;
  twist?: unknown;
  pitch?: unknown;
}

export interface PropellerSurface {
  /** flat xyz triangle soup */
  v: number[];
  /** sequential indices 0..count-1 (non-indexed soup) */
  i: number[];
  /** client-fixed hub base radius (NOT in the blueprint) */
  hubRadius: number;
}

const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** GLSL smoothstep(edge0, edge1, x) — works with inverted edges too. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clampN((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

const RADIAL = 56;                              // radial stations per blade
const CHORD = 12;                               // chordwise stations
const HUB_SEG = 20;

/** Propeller SDF parameters resolved exactly like the client/dev:
 *  clamped blades, `||`-fallbacks (a 0 reads as unset), base 0.1 hub floor. */
export function propellerParams(d: PropellerData) {
  const blades = clampN(Number(d.blades ?? 3) || 3, 1, 12);
  const radius = Math.max(0.05, Number(d.radius) || 0.7);
  const width = Math.max(0.01, Number(d.width) || 0.3);
  const twist = Number(d.twist) || 0;
  const pitch = Number(d.pitch) || 0;
  const base = 0.1;                             // client-fixed, absent from files
  return { blades, radius, width, twist, pitch, hubRadius: Math.max(base, width / 4) };
}

/** Half-chord along the blade (the SDF's chord envelope). */
export function halfChord(x: number, radius: number, width: number, blades: number): number {
  return (width / 8) * blades
    * (Math.sqrt(smoothstep(0, 0.5, x / radius)) + Math.sqrt(smoothstep(1.25, 0.5, x / radius)));
}

/** Half thickness at (x, z along chord). */
export function halfThickness(x: number, z: number, chord: number, radius: number, width: number): number {
  return (width / 20)
    * (0.1 + (1 - Math.min(Math.abs(z) / Math.max(chord, 1e-6), 1) ** 2) * smoothstep(1, 0.5, x / radius));
}

export function propellerSurface(d: PropellerData): PropellerSurface {
  const { blades, radius, width, twist, pitch, hubRadius } = propellerParams(d);

  // ---- one blade as a top/bottom surface strip, then copied around Y ----
  type Pt = [number, number, number];
  const blade: { top: Pt; bottom: Pt }[][] = [];
  const tipChord = halfChord(radius, radius, width, blades);
  const tipStart = radius - tipChord;
  const angle = (pitch * Math.PI) / 4;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  for (let i = 0; i <= RADIAL; i++) {
    const x = (i / RADIAL) * radius;
    let chord = halfChord(x, radius, width, blades);
    // rounded tip: the SDF ends the blade in a half-disc of the chord radius
    if (x > tipStart && tipChord > 1e-6) {
      const k = (x - tipStart) / tipChord;
      chord *= Math.sqrt(Math.max(0, 1 - k * k));
    }
    const ring: { top: Pt; bottom: Pt }[] = [];
    for (let j = 0; j <= CHORD; j++) {
      const z = (-1 + (2 * j) / CHORD) * chord;
      const t = halfThickness(x, z, chord, radius, width);
      // twist: the SDF shears y along the blade; pitch: rotate the section in Y·Z
      const shear = (x / radius) * z * twist * 2 / blades;
      const place = (y: number): Pt => {
        const yy = y + shear;
        return [x, yy * cos - z * sin, yy * sin + z * cos];
      };
      ring.push({ top: place(t), bottom: place(-t) });
    }
    blade.push(ring);
  }

  const v: number[] = [];
  const tri = (a: Pt, b: Pt, c: Pt) => { v.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); };
  for (let b = 0; b < blades; b++) {
    const th = (b * 2 * Math.PI) / blades;
    const ct = Math.cos(th), st = Math.sin(th);
    // Y rotation by th (dev: Matrix4.makeRotationY) — bake into the soup
    const rot = (p: Pt): Pt => [p[0] * ct + p[2] * st, p[1], -p[0] * st + p[2] * ct];
    const rt = (p: { top: Pt; bottom: Pt }) => ({ top: rot(p.top), bottom: rot(p.bottom) });
    for (let i = 0; i < RADIAL; i++) {
      for (let j = 0; j < CHORD; j++) {
        const a = rt(blade[i]![j]!), bb = rt(blade[i + 1]![j]!);
        const c = rt(blade[i + 1]![j + 1]!), dd = rt(blade[i]![j + 1]!);
        tri(a.top, bb.top, c.top); tri(a.top, c.top, dd.top);
        tri(a.bottom, c.bottom, bb.bottom); tri(a.bottom, dd.bottom, c.bottom);
      }
      // leading & trailing edges close the section
      const a = rt(blade[i]![0]!), bb = rt(blade[i + 1]![0]!);
      tri(a.top, a.bottom, bb.bottom); tri(a.top, bb.bottom, bb.top);
      const c = rt(blade[i]![CHORD]!), dd = rt(blade[i + 1]![CHORD]!);
      tri(c.top, dd.top, dd.bottom); tri(c.top, dd.bottom, c.bottom);
    }
  }

  // ---- hub cylinder (axis Y, centred): 20 segments + both caps ----
  const h = width / 2, hh = h / 2;
  for (let s = 0; s < HUB_SEG; s++) {
    const t0 = (s / HUB_SEG) * Math.PI * 2, t1 = ((s + 1) / HUB_SEG) * Math.PI * 2;
    const p = (t: number, y: number): Pt => [hubRadius * Math.sin(t), y, hubRadius * Math.cos(t)];
    const v0 = p(t0, -hh), v1 = p(t1, -hh), v2 = p(t1, hh), v3 = p(t0, hh);
    tri(v0, v1, v2); tri(v0, v2, v3);                       // outward walls
    tri([0, hh, 0], p(t0, hh), p(t1, hh));                  // top cap (+y)
    tri([0, -hh, 0], p(t1, -hh), p(t0, -hh));               // bottom cap (−y)
  }

  const i = new Array<number>(v.length / 3);
  for (let k = 0; k < i.length; k++) i[k] = k;
  return { v, i, hubRadius };
}
