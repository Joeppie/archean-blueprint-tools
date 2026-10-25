// materials.ts — the PBR shading spec resolved from palette slots and
// component paints. PURE (no THREE): every render surface (block buckets,
// hull prisms, pipes, component paints, atlas materials) funnels through
// pbr()/nodeMaterialSpec() into a single PbrSpec, which scene.ts turns into
// MeshStandardMaterial. Keeping the numbers HERE means the metal/env rules
// can never drift between surfaces (and stay unit-testable).
//
// Legacy source of truth: view3d.js pbr()/compColor()/modelMaterial()
// (v0.178). Rules that MUST survive:
//  • palette r/g/b are LINEAR albedo 0..255 — never sRGB-decode them;
//  • metal = metallic ? max(0, 1 − roughness/7) : 0  (the game's tracer
//    lights everything roughness>0 diffusely, so painted metal stays paint);
//  • roughness clamped to ≥0.03, glass alpha (opacity+1)/16 clamped ≥0.02;
//  • envMapIntensity = 1 for EVERY surface (v1.11.0 game-daylight law —
//    XenonViewer applies its PMREM'd sky env to all materials; the old
//    metal-only 1.25 rule was a studio-env artifact);
//  • component paints: color1 default = polished white, color2 = matte grey;
//    v1 files store [color1, color2] as PALETTE SLOT INDEX PAIRS.

import type { BlueprintComponent } from './format';
import type { MatEntry } from './models';
import type { FilePalette, PaletteEntry } from './palette';
import { resolveColor } from './palette';

/** linear-space rgb triple, 0..1 (three setRGB with LinearSRGBColorSpace). */
export type Rgb = readonly [number, number, number];

/** The complete resolved material description of one render surface. */
export interface PbrSpec {
  readonly color: Rgb;
  /** 0..1 metalness */
  readonly metal: number;
  /** 0..1 roughness (clamped ≥0.03) */
  readonly rough: number;
  /** 0..1 alpha; <1 ⇒ transparent */
  readonly opacity: number;
}

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/** v1.11.0: env intensity 1.0 for EVERY PBR surface. XenonViewer's
 *  pbrMaterial (js/scene.js:254-263) never sets envMapIntensity, so its
 *  PMREM'd DAY-SKY environment (js/viewer.js skyEnvironmentTexture) reads
 *  on ALL materials at full strength — "un métal ne s'éclaire pas, il
 *  réfléchit" (viewer.js:235-238): chrome reflects the sky, and painted
 *  surfaces get the same irradiance the game's tracer bounces off them.
 *  The old metal-only 1.25/0 split was a v0.144 studio-env artifact. */
export const envIntensity = (_metal: number): number => 1;

/** Palette/slot-style entry (r/g/b linear 0..255 + the 0..15 / 0..7 / 0|1 scales). */
export type PaintEntry = Pick<PaletteEntry, 'r' | 'g' | 'b'> & Partial<PaletteEntry>;

/** sRGB hex (fallback tints) → LINEAR rgb 0..1, matching THREE.Color(hex). */
export function srgbHexToLinear(hex: number): Rgb {
  const ch = (n: number): number => {
    const u = n / 255;
    return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
  };
  return [ch((hex >> 16) & 255), ch((hex >> 8) & 255), ch(hex & 255)];
}

export function pbr(c: PaintEntry): PbrSpec {
  const roughness = c.roughness ?? 0;
  const rough = clamp(roughness / 7, 0.03, 1);
  const op = c.opacity ?? 15;
  return {
    color: [c.r / 255, c.g / 255, c.b / 255],
    metal: c.metallic ? Math.max(0, 1 - roughness / 7) : 0,
    rough,
    opacity: op >= 15 ? 1 : clamp((op + 1) / 16, 0.02, 1),
  };
}

/** Bucket/material identity key (legacy matKey): equal specs ⇒ one merged mesh. */
export function pbrKey(s: PbrSpec): string {
  return `${s.color[0]!.toFixed(4)},${s.color[1]!.toFixed(4)},${s.color[2]!.toFixed(4)}`
    + `|${s.opacity.toFixed(3)}|${s.metal.toFixed(3)}|${s.rough.toFixed(3)}`;
}

// ---------- component paints (components[].colors) ----------

/** The game's painted-material defaults: color1 = polished white, color2 = matte grey. */
export const COMP_PAINT_DEFAULTS: Readonly<Record<'color1' | 'color2', PaintEntry>> = {
  color1: { r: 255, g: 255, b: 255, opacity: 15, roughness: 0, metallic: 0 },
  color2: { r: 204, g: 204, b: 204, opacity: 15, roughness: 7, metallic: 1 },
};

type CompColors = BlueprintComponent['colors'];

/**
 * Resolve one painted surface of a component. `which` is the glTF material
 * name ('color1'/'color2', or e.g. 'Material.003' which no file ever paints).
 * A v2 dict colours entry fills only the fields the file sets; a v1 ARRAY
 * colours entry is a [color1, color2] palette-SLOT pair resolved through the
 * file/built-in palette (legacy remap included). fallbackHex (sRGB) stands in
 * for a completely unpainted named material.
 */
export function componentPaint(
  colors: CompColors,
  which: string,
  palette: FilePalette | null | undefined,
  legacy: boolean,
  fallbackHex?: number,
): PbrSpec {
  let c: Partial<PaletteEntry> | undefined;
  if (!Array.isArray(colors)) c = colors?.[which];
  if (c == null && Array.isArray(colors)) {
    const slot = colors[which === 'color2' ? 1 : 0];
    if (typeof slot === 'number') c = resolveColor(palette, slot, legacy);
  }
  if (c == null) {
    if (fallbackHex == null) {
      const d = COMP_PAINT_DEFAULTS[which as 'color1' | 'color2'] ?? COMP_PAINT_DEFAULTS.color1;
      return pbr(d);
    }
    return { color: srgbHexToLinear(fallbackHex), metal: 0.5, rough: 0.55, opacity: 1 };
  }
  const d = COMP_PAINT_DEFAULTS[which as 'color1' | 'color2'] ?? COMP_PAINT_DEFAULTS.color1;
  return pbr({
    r: c.r ?? d.r, g: c.g ?? d.g, b: c.b ?? d.b,
    opacity: c.opacity ?? d.opacity, roughness: c.roughness ?? d.roughness,
    metallic: c.metallic ?? d.metallic,
  });
}

// ---------- atlas (glTF) materials ----------

/** Fixed-material fallbacks for atlas files predating the materials table
 *  (glTF factors are LINEAR, like the game's own material colours). */
export const MAT_FIX: Readonly<Record<string, MatEntry>> = {
  'data-connector': { color: [0, 0.05, 0.5], metal: 1, rough: 1 },
  'data-connector-m': { color: [0, 0.05, 0.5], metal: 1, rough: 1 },
  glass: { color: [0.75, 0.84, 0.9, 0.4], metal: 0.1, rough: 0.1, alpha: 'BLEND' },
};

/** Unnamed-material stand-in (legacy 0x8d949e). */
const NODE_FALLBACK = srgbHexToLinear(0x8d949e);

/** One glTF node material → spec: painted color1/color2 route through the
 *  component paint (fallbackHex stands in for a fully unpainted surface),
 *  fixed materials use their LINEAR baseColorFactor. */
export function nodeMaterialSpec(
  comp: BlueprintComponent,
  materialName: string,
  mats: Record<string, MatEntry> | undefined,
  palette: FilePalette | null | undefined,
  legacy: boolean,
  fallbackHex?: number,
): PbrSpec {
  if (materialName === 'color1' || materialName === 'color2')
    return componentPaint(comp.colors, materialName, palette, legacy, fallbackHex);
  const m = mats?.[materialName] ?? MAT_FIX[materialName];
  if (m) {
    const col = m.color;
    return {
      color: [col[0] ?? 0.8, col[1] ?? 0.8, col[2] ?? 0.8],   // already linear factors
      metal: m.metal ?? 1,
      rough: clamp(m.rough ?? 1, 0.03, 1),
      opacity: m.alpha === 'BLEND' ? clamp(col[3] ?? 0.5, 0.05, 1) : 1,
    };
  }
  return { color: NODE_FALLBACK, metal: 0.5, rough: 0.55, opacity: 1 };
}
