// normalize.ts — convert the OLD (v1, 2024-25) file format to the NEW (v2)
// representation AT OPEN TIME, so the rest of the app speaks exactly one
// dialect (user's design call: "convert first, done when opening — reduces
// complexity"). The engine keeps its LEGACY_Q handling for byte-faithful
// READING of v1 docs, but everything downstream of normalize() is v2:
//
//  1. data.colors is embedded: every USED legacy slot is written at its
//     v2-base index (legacySlot +4/+8/+12) with the built-in entry, so the
//     file carries its own palette and the +4-shift class of bugs dies.
//  2. block/triangle color slots are remapped through legacySlot() in place.
//  3. components[].colors ARRAY pairs ([c1,c2] slot indices, v1 legacy
//     editor) become v2 {color1:{...}, color2:{...}} entry objects.
//  4. orientations: v1 stores the Unity-LH quaternion RAW, v2 stores the
//     CONJUGATE — q' = {w, −x, −y, −z} keeps the same displayed rotation
//     under the modern law R(q*): display = R(q) under BOTH the old and the
//     de-mirrored (v0.180) chains. FluidJunction orientations are EXEMPT —
//     the builder-flat comb pose is R(as-written) for both generations.
//  5. data.version 1 → 2.
// All rules apply RECURSIVELY into Build subgrids. Saving a converted file
// writes the v2 form (intentional: the converter is the migration).

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
    // 4. raw quaternion → conjugate. FluidJunction EXEMPT (de-mirror v0.180):
    // the builder-FLAT comb pose is R(q) of the AS-WRITTEN quaternion for
    // BOTH generations (displayQuat reads the raw file quat), so conjugating
    // a junction's orientation would flip the legacy comb on its end — the
    // RCS-infinity regression class. The stored quat keeps its v1 raw form.
    const isJunction = get('type')?.kind === 'str' && get('type')!.value === 'FluidJunction';
    const q = isJunction ? undefined : get('orientation');
    if (q?.kind === 'obj') {
      for (const [k, n] of q.entries)
        if (n.kind === 'num' && (k === 'x' || k === 'y' || k === 'z')) {
          n.value = -n.value;
          n.raw = n.raw.startsWith('-') ? n.raw.slice(1) : '-' + n.raw;
        }
    }
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
