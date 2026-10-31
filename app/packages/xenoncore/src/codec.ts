// codec.ts — THE CRAFT ⇄ WORKSPACE CODEC, the P10-S4 seed (REWRITE § P10).
//
// The COMPILE function's core: decompose a craft blueprint's virtual disks
// into a per-computer workspace (craft manifest + verbatim .xc files), and
// compose edited file sets BACK into disk records — the game's pack-out law
// (FORMAT § Xenon virtual disk, measured 2026-10-31):
//  - a disk record is EXACTLY {name, plain_code}, keys in that order;
//  - `capacity` + `label` are carried VERBATIM (256 on a 747 kB ChipOS
//    disk: the capacity unit is not source bytes — never synthesize);
//  - the entry file follows the entry-selection law (xenonComputers):
//    `<program>.main.xc` → literal `main.xc` → any `*.main.xc` → first;
//  - every `.main.xc` may carry the game's `#NODES` visual-editor header as
//    its FIRST LINE — preservation-only: text edits touch the body, the
//    header rides byte-identical (GENERATION is out of scope);
//  - a blueprint NEVER carries bytecode; the game recompiles on load.
// The runtime world-save dirs (ARCHEAN_computer/HDD-<24hex>/) map to
// programs by CONTENT HASH (the entitystate binary that carries the ids is
// BANNED for tooling) — matchWorldHdds is that pure bridge.
//
// PURE module: no fs, no DOM, no machine paths. fs/CLI layers are consumers.

import type { XCFile } from './xcproject';

/** A disk record exactly as the game stores it (key ORDER is law). */
export interface DiskFile {
  name: string;
  plain_code: string;
}

export type ProgramKind = 'Computer' | 'MiniComputer' | 'Crafter' | 'HudController';

/** Loosely typed blueprint face — the codec reads, never writes, the doc. */
export interface BlueprintLike {
  author?: string;
  datetime?: string;
  workshop_item_id?: string | number;
  data?: {
    alias?: string;
    components?: {
      type?: string;
      alias?: string;
      data?: {
        hdd?: { capacity?: number; label?: string; xc_files?: DiskFile[] };
        xc_files?: DiskFile[];
      };
    }[];
  };
}

export interface ProgramDisk {
  ci: number;              // FLATTENED component index (the app's doc-path key)
  alias: string;           // component alias (may be '')
  kind: ProgramKind;
  entry: string | null;    // per the entry-selection law
  label: string;           // hdd.label verbatim ('' for the HUD container)
  capacity: number;        // hdd.capacity verbatim (0 for the HUD container)
  files: DiskFile[];       // deep copies — the workspace's starting content
}

export interface WorkspaceManifest {
  craft: {
    alias: string;
    author: string;
    workshop_item_id: string;
    datetime: string;
  };
  programs: ProgramDisk[];
}

/** The disk host kinds and their containers (edit.ts XcContainer law). */
export function programKindOf(type: string | undefined): ProgramKind | null {
  if (type === 'Computer' || type === 'MiniComputer' || type === 'Crafter') return type;
  if (type === 'HudController') return 'HudController';
  return null;
}

/** THE ENTRY-SELECTION LAW (xenonComputers, FORMAT § Xenon virtual disk). */
export function pickEntry(names: string[]): string | null {
  for (const n of names)
    if (n.endsWith('.main.xc') && n !== 'main.xc') return n;   // <program>.main.xc
  if (names.includes('main.xc')) return 'main.xc';
  for (const n of names) if (n.endsWith('.main.xc')) return n; // any *.main.xc
  return names[0] ?? null;
}

/** Decompose a blueprint's disks into a workspace manifest. Never mutates bp. */
export function decomposeBlueprint(bp: BlueprintLike): WorkspaceManifest {
  const programs: ProgramDisk[] = [];
  (bp.data?.components ?? []).forEach((c, ci) => {
    const kind = programKindOf(c?.type);
    if (!kind) return;
    const hdd = c.data?.hdd;
    const files: DiskFile[] =
      (kind === 'HudController' ? c.data?.xc_files : hdd?.xc_files) ?? [];
    programs.push({
      ci,
      alias: c.alias ?? '',
      kind,
      entry: pickEntry(files.map(f => f.name)),
      label: hdd?.label ?? '',
      capacity: hdd?.capacity ?? 0,
      files: files.map(f => ({ name: f.name, plain_code: f.plain_code ?? '' })),
    });
  });
  return {
    craft: {
      alias: bp.data?.alias ?? '',
      author: bp.author ?? '',
      workshop_item_id: String(bp.workshop_item_id ?? ''),
      datetime: bp.datetime ?? '',
    },
    programs,
  };
}

/**
 * Compose an edited file set back into disk records. Output order follows
 * the ORIGINAL disk (the game's file-table order rides through); additions
 * append in workspace order; deletions drop. Every record re-emits with
 * key order {name, plain_code}. capacity/label are NOT part of the output:
 * they ride the blueprint untouched.
 */
export function composeFiles(original: DiskFile[], edited: DiskFile[]): DiskFile[] {
  const byName = new Map(edited.map(f => [f.name, f]));
  const out: DiskFile[] = [];
  for (const f of original) {
    const e = byName.get(f.name);
    if (e) { out.push({ name: f.name, plain_code: e.plain_code }); byName.delete(f.name); }
  }
  for (const e of edited)
    if (byName.has(e.name)) out.push({ name: e.name, plain_code: e.plain_code });
  return out;
}

/** The first-line `#NODES` visual-editor header, if any (FORMAT runtime law). */
export function nodesHeader(code: string): string | null {
  const nl = code.indexOf('\n');
  const line = nl < 0 ? code : code.slice(0, nl);
  return line.startsWith('#NODES ') ? line : null;
}

/** Names whose `#NODES` header did NOT survive composition verbatim. */
export function nodesViolations(original: DiskFile[], composed: DiskFile[]): string[] {
  const byName = new Map(composed.map(f => [f.name, f]));
  const bad: string[] = [];
  for (const f of original) {
    const h = nodesHeader(f.plain_code);
    if (h === null) continue;
    if (nodesHeader(byName.get(f.name)?.plain_code ?? '') !== h) bad.push(f.name);
  }
  return bad;
}

// ── the world-save bridge (content hash; entitystate RE is BANNED) ────────

/** FNV-1a 32 + length: a CONTENT ADDRESS for alias↔HDD bridging only.
 *  Explicitly NOT a security hash. */
export function contentHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  h = Math.imul(h ^ (text.length & 0xff), 0x01000193);   // length-sensitivity
  return (h >>> 0).toString(16).padStart(8, '0') + text.length.toString(16);
}

/** One runtime world-save dir: ARCHEAN_computer/HDD-<24hex>/. */
export interface WorldHdd {
  id: string;
  files: XCFile[];   // {name, code} — the loose .xc files, verbatim bytes
}

export interface WorldMatch {
  alias: string;
  hddId: string | null;
  score: number;     // matched source bytes / program bytes (1 = identical)
}

/**
 * Map workspace programs to world HDD dirs by CONTENT HASH: score = the
 * fraction of the program's source bytes found (hash-equal) in the dir.
 * A program maps to its best dir at ≥ threshold (tie → lexicographic id).
 */
export function matchWorldHdds(
  manifest: WorkspaceManifest, hdds: WorldHdd[], threshold = 0.5,
): WorldMatch[] {
  const dirHashes = hdds.map(h => ({
    id: h.id,
    hashes: new Map<string, number>(),  // contentHash → bytes available
  }));
  for (let i = 0; i < hdds.length; i++)
    for (const f of hdds[i]!.files) {
      const k = contentHash(f.code);
      dirHashes[i]!.hashes.set(k, (dirHashes[i]!.hashes.get(k) ?? 0) + f.code.length);
    }
  return manifest.programs.map(p => {
    let best: WorldMatch = { alias: p.alias, hddId: null, score: 0 };
    const total = p.files.reduce((s, f) => s + f.plain_code.length, 0);
    const candidates = dirHashes
      .map(d => {
        let matched = 0;
        const avail = new Map(d.hashes);
        for (const f of p.files) {
          const k = contentHash(f.plain_code);
          const a = avail.get(k) ?? 0;
          if (a > 0) { matched += f.plain_code.length; avail.set(k, a - 1); }
        }
        return { id: d.id, score: total ? matched / total : 0 };
      })
      .filter(c => c.score >= threshold)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const top = candidates[0];
    if (top) best = { alias: p.alias, hddId: top.id, score: top.score };
    return best;
  });
}
