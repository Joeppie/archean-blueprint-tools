// palette.js — the game's built-in 256-slot block palette + colour resolution.
// Transcribed from the game's BlockShapes.hh (same source the developer's
// XenonViewer generates its palette.js from — see NOTICE.md §2).
//
// Entry layout: {r,g,b, opacity 0..15, roughness 0..7, metallic 0|1}.
// The game's shaders use vec3(r,g,b)/255 DIRECTLY as linear albedo (no sRGB
// decode — only textures get ReverseGamma), so colours resolve to linear.
// Slots 0..10 are engine-reserved: the blueprint file cannot redefine them.

export const DEFAULT_PALETTE = [
  { r: 255, g: 255, b: 255, opacity: 15, roughness: 0, metallic: 0 },
  { r: 64, g: 64, b: 64, opacity: 15, roughness: 7, metallic: 0 },
  { r: 128, g: 140, b: 170, opacity: 15, roughness: 5, metallic: 1 },
  { r: 204, g: 204, b: 204, opacity: 15, roughness: 7, metallic: 1 },
  { r: 255, g: 255, b: 255, opacity: 0, roughness: 0, metallic: 0 },      // clear glass
  { r: 200, g: 200, b: 200, opacity: 15, roughness: 1, metallic: 1 },
  { r: 200, g: 180, b: 155, opacity: 15, roughness: 5, metallic: 1 },
  { r: 200, g: 80, b: 16, opacity: 15, roughness: 0, metallic: 1 },
  { r: 0, g: 0, b: 0, opacity: 15, roughness: 7, metallic: 0 },
  { r: 100, g: 24, b: 8, opacity: 15, roughness: 1, metallic: 1 },
  { r: 255, g: 255, b: 255, opacity: 15, roughness: 0, metallic: 1 },
];
for (let i = DEFAULT_PALETTE.length; i < 256; i++) DEFAULT_PALETTE.push(null);

/**
 * Resolve a palette slot to {r,g,b,opacity,roughness,metallic}.
 * Slots 0..10 always use the built-in entries (the game's reader re-imposes
 * them); file entries fall back to the built-in, and a magenta marker flags
 * a fully missing slot.
 */
export function resolveColor(palette, index) {
  const i = index | 0;
  const c = (i <= 10 ? null : palette?.[i]) || DEFAULT_PALETTE[i] || palette?.[i];
  if (!c || typeof c !== 'object') return { r: 255, g: 0, b: 255, opacity: 15, roughness: 4, metallic: 0 };
  return {
    r: c.r ?? 255, g: c.g ?? 255, b: c.b ?? 255,
    opacity: c.opacity ?? 15, roughness: c.roughness ?? 0, metallic: c.metallic ?? 0,
  };
}
