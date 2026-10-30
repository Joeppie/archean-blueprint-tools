// flat.ts — THE FLATTENED-ENDPOINT LAW (v1.16.10, the Jimmy catch):
// `data.pipes` endpoints index the FLATTENED component array — nested
// subgrid content numbers BEFORE its Build (FORMAT §Subgrids). Reading a
// pipe endpoint as a TOP-LEVEL component index is off by the nested count
// for every index past the Build (Jimmy's Adventure: +4 — his computer
// reads as UNPOWERED and the farm leaves it off). Every top-level reader
// of pipe endpoints maps through HERE: power.ts, devicesim, the Xenon
// device tables, energy's drill-voltage check.
//
// Nested endpoints map to null: a nested part is outside the top-level
// sim's registered space (the existing dataNeighbours law: skip).

import type { Blueprint, BlueprintComponent } from './format';

export function flatToTopMap(bp: Blueprint): (number | null)[] {
  const out: (number | null)[] = [];
  (bp.data.components as BlueprintComponent[]).forEach((c, ci) => {
    if (c.type === 'Build') {
      const nested = (c.data as { components?: unknown[] } | undefined)?.components?.length ?? 0;
      for (let i = 0; i < nested; i++) out.push(null);
    }
    out.push(ci);
  });
  return out;
}

/** The endpoint mapper most call sites want: flat index -> top-level ci,
 *  undefined for nested content and out-of-range endpoints. */
export function flatEndpointTop(map: (number | null)[], flat: number): number | undefined {
  const t = map[flat];
  return t === null || t === undefined ? undefined : t;
}
