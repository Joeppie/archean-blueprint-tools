// grid.ts — the ADAPTIVE GROUND GRID plan (v1.5.21, user: "grid needs to fit
// build comfortably. Probably granularity depending on zoom 1x or 5, 10,
// depending"). The old grid was a fixed 28 m GridHelper patch: small crafts
// drowned in it, the giant craft overgrew it, and at every zoom level the
// 0.25 m cell lines were either a moiré smear or invisible.
//
// The law (pure, vitest-pinned — the Engine only draws what this plans):
//  * STEP LADDER rides the blueprint cell lattice (0.25 m): the steps are
//    0.25 × {1, 5, 10, 50, 100, …} with the 2-step between decades — exactly
//    the user's 1× / 5× / 10× granularity, so a step boundary is crossed
//    only every ×2.5 of zoom and lines never re-tessellate constantly.
//  * A step is chosen so one minor cell projects at least MIN_PX pixels on
//    screen (coarsest zoom wins the finest readable step); the ladder is
//    clamped at both ends (never finer than a sub-cell 0.05 m, never
//    coarser than 25 m).
//  * EXTENT fits the build: the grid spans the craft footprint plus a
//    comfortable margin, rounded out to whole MAJOR cells (5 minor steps),
//    with a minimum span so a tiny craft still sits on a sane patch of
//    ground and a line-count cap so a fine step at giant-craft size cannot
//    explode the vertex count (the cap bumps the step, it never holes the
//    grid).
//  * MAJOR lines run every 5 minor steps (the ladder's own rhythm).

/** The step ladder in metres: sub-cell detail up through whole 25 m yards,
 *  always whole multiples of the 0.25 m blueprint cell above 0.05. */
export const GRID_STEPS = [0.05, 0.25, 1.25, 2.5, 12.5, 25] as const;

/** Major = every 5th minor line (the 1→5 rung of the ladder). */
export const GRID_MAJOR_EVERY = 5;

/** A step is fine enough once one minor cell spans this many screen px. */
export const GRID_MIN_PX = 14;

/** Cap of minor lines per axis (the step is bumped rather than the grid
 *  holed — 2× this in the worst axis pair is still trivial for a GPU). */
export const GRID_MAX_LINES = 512;

/** Smallest half-span the grid ever covers (metres) — a new empty craft
 *  still gets a recognisable build pad. */
export const GRID_MIN_HALF = 8;

export interface GridPlan { step: number; major: number; halfX: number; halfZ: number }

/** Screen px per world metre at the orbit distance d for a vertical fov. */
export function pxPerMeter(canvasH: number, fovDeg: number, dist: number): number {
  if (!(dist > 0) || !(canvasH > 0)) return 0;
  return (canvasH * 0.5) / (dist * Math.tan((fovDeg * Math.PI) / 360));
}

/** The finest ladder step whose minor cell still projects ≥ minPx pixels. */
export function pickGridStep(px: number, minPx = GRID_MIN_PX): number {
  for (const s of GRID_STEPS) if (s * px >= minPx) return s;
  return GRID_STEPS[GRID_STEPS.length - 1]!;
}

/** The grid plan for a build of half-extents hx × hz (view-space metres,
 *  grid centred on the build) at the given screen scale. Half-spans are
 *  rounded OUT to whole major cells + GRID_MIN_HALF floor, and the step is
 *  bumped until both axes stay under GRID_MAX_LINES minor lines. */
export function gridPlan(hx: number, hz: number, px: number): GridPlan {
  let step = pickGridStep(px);
  let major = step * GRID_MAJOR_EVERY;
  const fit = (h: number, m: number) =>
    Math.max(GRID_MIN_HALF, Math.ceil((h + m) / m) * m);
  let halfX = fit(hx, major), halfZ = fit(hz, major);
  // line-count safety: bump the ladder (never hole the coverage)
  for (let g = GRID_STEPS.indexOf(step as (typeof GRID_STEPS)[number]) + 1;
    g > 0 && g < GRID_STEPS.length &&
    (halfX / step > GRID_MAX_LINES || halfZ / step > GRID_MAX_LINES); g++) {
    step = GRID_STEPS[g]!; major = step * GRID_MAJOR_EVERY;
    halfX = fit(hx, major); halfZ = fit(hz, major);
  }
  return { step, major, halfX, halfZ };
}
