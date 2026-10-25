// normalize.ts — convert the OLD (v1, 2024-25) file format to the NEW (v2)
// representation AT OPEN TIME, so the rest of the app speaks exactly one
// dialect (user's design call: "convert first, done when opening — reduces
// complexity"). The engine keeps reading the file's GENERATION
// (`__legacyQ`) for byte-faithful palette handling of v1 docs, but
// everything downstream of normalize() is v2:
//
//  1. data.colors is embedded: every USED slot is written at ITS OWN index
//     with the built-in entry (v1.11.0: the built-in table sits at the v1
//     bases, so the legacySlot() below is the identity and the embed is a
//     plain copy), so the file carries its own palette and the +4-shift
//     class of bugs dies.
//  2. block/triangle color slots are remapped through legacySlot() in place
//     (identity since v1.11.0 — kept as the GENERATION seam).
//  3. components[].colors ARRAY pairs ([c1,c2] slot indices, v1 legacy
//     editor) become v2 {color1:{...}, color2:{...}} entry objects.
//  4. orientations: UNTOUCHED (v1.5.11). The earlier raw→conjugate rewrite
//     was WRONG: the GAME stores and reads quaternion values VERBATIM
//     (proof: ISW-241's workshop file 3518436870, 2025-07 no-palette, and
//     the game's own 2026 re-save 3812927875 with an embedded palette carry
//     BYTE-IDENTICAL orientation values for the same scene), so a migration
//     that flips the vector parts makes the game place the flipped rotation
//     — the 2026-10-20 report: ISW caster wheel on TOP of its strut, Jimmy's
//     two-axis dashboard murals torn apart, while single-axis/180° parts
//     (whose conjugate is the same rotation) stayed fine. The engine keeps
//     carrying the palette-less source's GENERATION on the live bp
//     (`__legacyQ`, Editor) for palette/wheel-droop handling; the display
//     never depended on it, only the byte rewrite died.
//  5. data.version 1 → 2.
// All rules apply RECURSIVELY into Build subgrids. Saving a converted file
// writes the v2 form (intentional: the converter is the migration — the
// palette embedding is what the game itself does on its own re-saves).

import { docFromValue, docGet, docSet, docSetArrayItem, type DocNode } from './doc';
import { DEFAULT_PALETTE, legacySlot } from './palette';
import type { PaletteEntry } from './palette';

const entryNode = (e: PaletteEntry): DocNode => docFromValue({
  r: e.r, g: e.g, b: e.b, opacity: e.opacity, roughness: e.roughness, metallic: e.metallic,
});

export interface NormalizeResult { converted: boolean; slots: number[] }

function isLegacyDoc(data: DocNode): boolean {
  const c = docGet(data, ['colors']);
  return c === undefined || (c.kind === 'arr' && c.items.length === 0);
}

/** The GENERATION of the file AS ON DISK (pre-migration): palette-less v1
 *  sources resolve colours through the built-in legacy table (legacySlot)
 *  and keep the wheel-droop display gate. normalize() embeds data.colors,
 *  so the generation must be read BEFORE it and carried on the live bp
 *  (`__legacyQ`) — it selects NO rotation law (since v1.5.11 there is only
 *  the raw one, FORMAT §Handedness). */
export function docLegacyGeneration(doc: DocNode): boolean {
  const data = docGet(doc, ['data']);
  return !!data && data.kind === 'obj' && isLegacyDoc(data);
}

function remapSlotArray(arr: DocNode, used: Set<number>): void {
  if (arr.kind !== 'arr') return;
  for (const item of arr.items) {
    if (item.kind !== 'num') continue;
    const s2 = legacySlot(item.value);
    item.value = s2; item.raw = String(s2);
    used.add(s2);
  }
}

function entryAt(slot: number): PaletteEntry | null {
  return DEFAULT_PALETTE[legacySlot(slot)] ?? null;
}

function normalizeComponents(list: DocNode, used: Set<number>): void {
  if (list.kind !== 'arr') return;
  for (const comp of list.items) {
    if (comp.kind !== 'obj') continue;
    const get = (k: string) => comp.entries.find(([kk]) => kk === k)?.[1];
    // 4. orientation: VERBATIM — never rewritten (see the file header: the
    //    game stores and re-reads quaternion bytes unchanged, so flipping
    //    the vector parts here exported mirror-rotated placements).
    // 3. colors [a,b] slot pairs → {color1:{...}, color2:{...}}
    const cols = get('colors');
    if (cols?.kind === 'arr' && cols.items.length >= 2
      && cols.items[0]!.kind === 'num' && cols.items[1]!.kind === 'num') {
      const c1 = entryAt(cols.items[0]!.value) ?? entryAt(0)!;
      const c2 = entryAt(cols.items[1]!.value) ?? entryAt(1)!;
      used.add(legacySlot(cols.items[0]!.value)).add(legacySlot(cols.items[1]!.value));
      comp.entries[comp.entries.findIndex(([k]) => k === 'colors')] =
        ['colors', docFromValue({ color1: c1, color2: c2 })];
    }
    // 1/2 + recursion: subgrid data
    const data = get('data');
    if (data?.kind === 'obj') {
      const blocks = data.entries.find(([k]) => k === 'blocks')?.[1];
      if (blocks) remapSlotArray(blocks, used);
      if (blocks?.kind === 'arr') for (const b of blocks.items)
        if (b.kind === 'obj') { const cc = b.entries.find(([k]) => k === 'colors')?.[1]; if (cc) remapSlotArray(cc, used); }
      const sub = data.entries.find(([k]) => k === 'components')?.[1];
      if (sub) normalizeComponents(sub, used);
    }
  }
}

/** Mutate the DOC in place to the v2 dialect. Returns what happened. */
export function normalizeDoc(doc: DocNode): NormalizeResult {
  const data = docGet(doc, ['data']);
  if (!data || data.kind !== 'obj' || !isLegacyDoc(data)) return { converted: false, slots: [] };
  const used = new Set<number>();
  const get = (k: string) => data.entries.find(([kk]) => kk === k)?.[1];

  // 2. top-level block + triangle colour slots
  const blocks = get('blocks');
  if (blocks?.kind === 'arr') for (const b of blocks.items)
    if (b.kind === 'obj') { const cc = b.entries.find(([k]) => k === 'colors')?.[1]; if (cc) remapSlotArray(cc, used); }
  const tris = get('triangles');
  if (tris?.kind === 'arr') for (const t of tris.items)
    if (t.kind === 'obj') { const cc = t.entries.find(([k]) => k === 'colors')?.[1]; if (cc) remapSlotArray(cc, used); }

  // 3/4 + nesting
  const comps = get('components');
  if (comps) normalizeComponents(comps, used);

  // 1. embed the used palette entries at their v2-base indices
  const slots = [...used].sort((a, b) => a - b);
  const paletteArr: DocNode = get('colors')?.kind === 'arr' ? get('colors')! : { kind: 'arr', items: [] };
  if (!get('colors')) data.entries.push(['colors', paletteArr]);
  for (const s of slots) {
    const e = DEFAULT_PALETTE[s];
    if (e) docSetArrayItem(paletteArr, [], s, entryNode(e));
  }

  // 5. version bump (keep the literal int style)
  docSet(data, ['version'], 2);
  return { converted: true, slots };
}
