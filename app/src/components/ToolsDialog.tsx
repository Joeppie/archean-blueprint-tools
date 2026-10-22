// ToolsDialog.tsx — the TOOLS menu (v1.7 user rule: "a tools menu that lets
// you do general operations… these tools should have a modal dialog that
// opens in the middle of the screen, and that needs to BE OK and run, or
// cancelled; common well-defined ts structure to generate screen … use a
// framework that autoplaces elements from just a definition").
//
// A tool is a DEFINITION: typed fields (select / toggle / note), a live
// `preview` readout computed from the current form over the live blueprint,
// and a `run` that mutates bp AND the doc together (the established batch
// idiom). The Modal below is shared: it auto-lays-out the fields in a label/
// control grid, keeps the OK button DISABLED while the preview says there is
// nothing to do, closes on Esc/backdrop (Cancel), is DRAGGABLE by its title
// bar (2026-10-20), and OK leads to a CONFIRMATION BOX with the live readout —
// Confirm runs and the dialog closes (2026-10-20: no inert second-OK no-op). The
// tool list itself is a registry — adding a tool means adding one ToolDef.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Blueprint, Block, Triangle } from '../engine/format';
import type { EditCtx } from '../engine/edit';
import { writeBlockDoc, writeBlockMaterial, setPaletteSlot } from '../engine/edit';
import { docArrayInsert, docArrayRemoveAt, docEnsureArray, docFromValue } from '../engine/doc';
import { OCCUPANCY_TYPE } from '../engine/blockshapes';
import { shiftBlocks } from '../engine/blocks';
import {
  MATERIALS, blockMaterial, hullifyApply, hullifyPreview, replaceCensus, replaceColorDests,
  replaceSources, replaceAll, parseHexColor, paletteSlotNode, allocateSlot, nearestSlot,
} from '../engine/tools';
import { spheroidBlocks, spheroidStats, spheroidTriangles, encodeTriSkin,
  type SpheroidSpec } from '../engine/spheroid';

export type ToolValue = string | number;
export type ToolForm = Record<string, ToolValue>;

/** A PLACEMENT tool's payload: block records and/or hull triangles at the
 *  stage-time position — the viewport ghosts them, the user moves the
 *  cluster, and Build commits with the final cell offset. Generic. */
export interface PlacePayload { blocks?: Block[]; triangles?: Triangle[] }

export interface ToolFieldDef {
  key: string;
  label: string;
  kind: 'select' | 'note' | 'range' | 'toggle' | 'color';
  /** static options (select) */
  options?: { id: string; label: string }[];
  /** dependent options, e.g. the colour sources follow the chosen target */
  optionsFor?: (f: ToolForm) => { id: string; label: string }[];
  /** hide the field for some form states */
  showIf?: (f: ToolForm) => boolean;
  hint?: string;
  /** range bounds (metres or counts — whatever the tool measures in) */
  min?: number; max?: number; step?: number;
  /** range: suffix for the live readout, e.g. ' m' */
  unit?: string;
}

export interface ToolDef {
  id: string;
  label: string;
  icon: string;
  blurb: string;
  /** true = a heavy, hard-to-eye rewrite: the confirmation box shows a red
   *  warning line (2026-10-20: everything is undoable via the Edit ▾ Undo stack) */
  danger?: boolean;
  fields: ToolFieldDef[];
  initial: ToolForm;
  /** live readout above the buttons; '' = nothing to do (OK disabled) */
  preview: (f: ToolForm, bp: Blueprint) => string;
  /** mutate bp AND the doc; returns the line the dialog shows after running */
  run: (f: ToolForm, ctx: EditCtx) => string;
  /** PLACEMENT tool (v1.6): Confirm does NOT mutate — `stage` builds the
   *  ghost payload, the viewport shows the movable cluster with the
   *  ✕ Cancel / ✔ Build label, and Build calls `commit` with the final
   *  whole-cell offset the user moved it to. (`run` stays unused.) */
  place?: {
    stage: (f: ToolForm, bp: Blueprint) => PlacePayload;
    commit: (f: ToolForm, payload: PlacePayload, offset: [number, number, number], ctx: EditCtx) => string;
  };
}

// ------------------------------------------------------------------- TOOLS

export const TOOLS: ToolDef[] = [
  {
    id: 'replace-all',
    label: 'Replace all…',
    icon: '⇄',
    blurb: 'Rewrite every block face colour or every build material in one go '
      + '— e.g. all STEEL blocks to ALUMINIUM, or all metal-look paint to the '
      + 'glass finish. Component paints and the occupancy mirrors are untouched.',
    fields: [
      {
        key: 'target', label: 'replace', kind: 'select',
        options: [
          { id: 'colors', label: 'face colours (appearance)' },
          { id: 'material', label: 'materials (what the block IS)' },
        ],
      },
      {
        key: 'source', label: 'every', kind: 'select', optionsFor: f => replaceSourceOptions(String(f['target'])) },
      {
        key: 'destColor', label: 'becomes', kind: 'select',
        showIf: f => f['target'] === 'colors',
        options: replaceColorDests().map(d => ({ id: d.id, label: d.label })),
      },
      {
        key: 'destMaterial', label: 'becomes', kind: 'select',
        showIf: f => f['target'] === 'material',
        options: MATERIALS.map((label, m) => ({ id: `m${m}`, label })),
      },
      {
        key: 'note', label: '', kind: 'note',
        hint: 'A FAMILY source maps each colour to the SAME colour in the target '
          + 'finish (steel-grey → glass-grey keeps the hue). Materials are the '
          + 'game identity (mass, heat, build cost) — never an appearance.',
      },
    ],
    // the user's own example is the default: all COMPOSITE blocks ▸ ALUMINIUM
    initial: { target: 'material', source: 'm0', destColor: 'glass', destMaterial: 'm3' },
    preview: (f, bp) => {
      const src = replaceSources(f['target'] === 'material' ? 'material' : 'colors')
        .find(s => s.id === f['source']);
      if (!src) return '';
      const c = replaceCensus(bp, src, f['target'] === 'material' ? 'material' : 'colors');
      if (!c.blocks) return 'nothing on this craft matches';
      return f['target'] === 'material'
        ? `${c.blocks} block${c.blocks === 1 ? '' : 's'} change material`
        : `${c.faces} face${c.faces === 1 ? '' : 's'} on ${c.blocks} block${c.blocks === 1 ? '' : 's'} repaint`;
    },
    run: (f, ctx) => {
      const target = f['target'] === 'material' ? 'material' : 'colors';
      const src = replaceSources(target).find(s => s.id === f['source'])!;
      const destSlot = replaceColorDests().find(d => d.id === f['destColor'])?.slot;
      const destMaterial = target === 'material'
        ? +String(f['destMaterial']).slice(1) : undefined;
      const before = ctx.bp.data.blocks.map(b => ({
        colors: (b.colors ?? []).slice(), material: blockMaterial(b),
      }));
      const res = replaceAll(ctx.bp, src, target, destSlot, destMaterial);
      // doc mirror: only the blocks that actually changed
      ctx.bp.data.blocks.forEach((b, i) => {
        if (b.type === OCCUPANCY_TYPE) return;
        if (target === 'colors') {
          const was = before[i]!.colors;
          if ((b.colors ?? []).some((c, k) => c !== was[k])) writeBlockDoc(ctx, i);
        } else if (blockMaterial(b) !== before[i]!.material) {
          writeBlockMaterial(ctx, i, blockMaterial(b));
        }
      });
      return target === 'material'
        ? `re-materialled ${res.blocks} block${res.blocks === 1 ? '' : 's'}`
        : `repainted ${res.faces} faces on ${res.blocks} block${res.blocks === 1 ? '' : 's'}`;
    },
  },
  {
    id: 'hullify',
    label: 'Blocks → hull triangles…',
    icon: '▵',
    danger: true,
    blurb: 'Turn every exposed BLOCK FACE into the hull TRIANGLES that ARE '
      + 'that face: the triangles take the block shape’s own corner '
      + 'coordinates (a square face = 2 triangles, a wedge side = 1). A '
      + 'border two adjacent blocks share precisely and fully emits nothing; '
      + 'everything else keeps its outside face’s colour and its block’s '
      + 'material. Cheaper to build and lighter (a skin, not solid '
      + 'voxels); the game recomputes mass and the bounding box on load.',
    fields: [
      {
        key: 'wind', label: 'direction', kind: 'select',
        options: [
          { id: 'inward', label: 'front faces IN' },
          { id: 'outward', label: 'front faces OUT' },
        ],
        hint: 'Which way the triangle winding faces. The game extrudes each '
          + 'triangle as a prism whose FRONT side takes colours[0] and shades '
          + 'by that normal — so this is a GAME-side property: our viewer '
          + 'draws the closed prism both-sided with one colour on all five '
          + 'faces, so both directions render IDENTICALLY here. The game’s '
          + 'own triangle authoring winds OUT (its own in-game-made '
          + 'triangles all face away from the solid), so OUT is the default; '
          + 'if a converted hull ever reads wrong-way/lit-from-behind in the '
          + 'game, pick the other direction. (The in-game BEVEL look is NOT '
          + 'the winding — it is the shading option below.)',
      },
      {
        key: 'shade', label: 'shading', kind: 'select',
        options: [
          { id: 'smooth', label: 'smooth skin (smooth:1)' },
          { id: 'flat', label: 'flat (no key)' },
        ],
        hint: 'The game’s Triangle struct carries a per-triangle smooth flag '
          + '(0 = flat/geometric normals, the absent default; 1 = smooth '
          + 'normals). The game’s own freshly authored triangles carry NO key '
          + '— flat — and snap to flush neighbours as they are placed; in '
          + 'game a smooth:1 skin gets its shared/flush vertices welded, '
          + 'which bulges a faceted block hull (the in-game verdict on the '
          + 'smooth:1 default, 2026-10-20: “deformed”). Default = flat, like '
          + 'the game’s own authoring; smooth:1 stays for continuous-sheet '
          + 'hulls (the game’s own hull saves use it that way).',
      },
      {
        key: 'note', label: '', kind: 'note',
        hint: 'Existing hull triangles and struts stay; type-255 component '
          + 'occupancy markers STAY (they are reservations, not geometry); '
          + 'blocks inside Build SUBGRIDS (doors/hatches) stay blocks — they '
          + 'live in the nested blueprints. Edit ▸ Undo (Ctrl+Z) takes the '
          + 'whole conversion back afterwards.',
      },
    ],
    initial: { wind: 'outward', shade: 'flat' },
    preview: (f, bp) => {
      const r = hullifyPreview(bp, {
        wind: f['wind'] === 'outward' ? 'outward' : 'inward',
        shade: f['shade'] === 'flat' ? 'flat' : 'smooth',
      });
      if (!r.ok) return r.reason ?? 'nothing to convert';
      return `${r.blocksRemoved} blocks ▸ ${r.trisAdded} triangles · front faces ${f['wind'] === 'outward' ? 'OUT' : 'IN'}`
        + ` · shading ${f['shade'] === 'flat' ? 'flat' : 'smooth:1'}`
        + (r.keptOcc ? ` · ${r.keptOcc} occupancy markers kept` : '')
        + (r.subBlocks ? ` · ${r.subBlocks} SUBGRID blocks stay blocks` : '')
        + ` · mass ≈ ${(r.massRemoved).toFixed(0)} kg ▸ ${r.massAdded.toFixed(0)} kg`
        + (r.skipped ? ` · ${r.skipped} faces skipped (too wide for the format)` : '');
    },
    run: (f, ctx) => {
      const geo = ctx.bp.data.blocks
        .map((b, i) => (b.type === OCCUPANCY_TYPE ? -1 : i))
        .filter(i => i >= 0)
        .sort((a, b) => b - a);
      const trisBefore = ctx.bp.data.triangles?.length ?? 0;
      const res = hullifyApply(ctx.bp, {
        wind: f['wind'] === 'outward' ? 'outward' : 'inward',
        shade: f['shade'] === 'flat' ? 'flat' : 'smooth',
      });
      if (!res.ok) return res.reason ?? 'nothing converted';
      for (const i of geo) docArrayRemoveAt(ctx.doc, ['data', 'blocks'], i);
      docEnsureArray(ctx.doc, ['data', 'triangles']);
      (ctx.bp.data.triangles ?? []).forEach((t, k) => {
        if (k < trisBefore) return;
        // INT style (floaty = false): the game writer stores ALL triangle
        // numbers bare — "frame_x":-1,"material":3,"smooth":1,"v0_x":13
        // (3732302108 raw); a "13.0" is the double-modelled style of WORLD
        // coords, not this record's.
        docArrayInsert(ctx.doc, ['data', 'triangles'], k, docFromValue(t, false));
      });
      return `converted ${res.blocksRemoved} blocks into ${res.trisAdded} hull triangles`;
    },
  },
  {
    // v1.6 PLACEMENT tool: the dialog OK's the SHAPE (stretchable size,
    // material, paint, solid/shell); the spheroid then appears as a movable
    // ghost with its own ✕ Cancel / ✔ Build label (user: "make a tool that
    // can generate a spheroid and make it out of blocks. Like a block it
    // should be movable and its label should have cancel and build buttons,
    // that appears after the tool window where you ok off on material,
    // color, solid, size (…dynamic so you can stretch it)").
    id: 'spheroid',
    label: 'Spheroid…',
    icon: '◍',
    blurb: 'Generate a SPHEROID out of blocks — as round as the shape table '
      + 'gets: corner, slope and inverse-corner blocks round the surface, a '
      + 'SOLID interior is 100 % filled with the fewest square blocks (merged '
      + 'into big boxes). Stretch x/y/z into any ellipsoid; a SHELL keeps '
      + 'only the skin. OK previews it as a ghost you can MOVE — Build '
      + 'writes it into the craft.',
    fields: [
      { key: 'rx', label: 'width x (m)', kind: 'range', min: 0.25, max: 24, step: 0.25, unit: ' m',
        hint: 'stretch the axes freely — equal = a sphere, different = an ellipsoid; '
          + 'up to 24 m (zeppelin) in SKIN mode' },
      { key: 'ry', label: 'height y (m)', kind: 'range', min: 0.25, max: 24, step: 0.25, unit: ' m' },
      { key: 'rz', label: 'length z (m)', kind: 'range', min: 0.25, max: 24, step: 0.25, unit: ' m' },
      { key: 'fill', label: 'shape', kind: 'select',
        options: [
          { id: 'skin', label: 'Skin — hull triangles (smooth, huge)' },
          { id: 'solid', label: 'Solid blocks (100 % filled)' },
          { id: 'shell', label: 'Shell — blocks, hollow' },
        ],
        hint: 'the staircase of blocks is chamfered with wedges, tapers and '
          + 'inverse corners; the SKIN is one watertight smooth triangle hull '
          + '(cheap enough for airship sizes blocks could never afford)' },
      { key: 'shade', label: 'shading', kind: 'select',
        showIf: f => f['fill'] === 'skin',
        options: [
          { id: 'smooth', label: 'smooth (smooth:1, welds normals)' },
          { id: 'flat', label: 'flat (faceted)' },
        ],
        hint: 'smooth:1 is the game’s sheet-hull convention — the in-game '
          + 'welding is what makes a big skin read ROUNDED' },
      { key: 'material', label: 'material', kind: 'select',
        options: MATERIALS.map((label, m) => ({ id: `m${m}`, label })) },
      { key: 'color', label: 'paint', kind: 'color',
        hint: 'the RGB is painted on every face of every block/triangle' },
      { key: 'colorhow', label: 'paint slot', kind: 'select',
        options: [
          { id: 'new', label: '+ new palette slot' },
          { id: 'nearest', label: '≈ nearest existing slot' },
        ] },
      { key: 'note', label: '', kind: 'note',
        hint: 'OK starts a PLACEMENT: the shape appears as a translucent '
          + 'ghost you can drag with the widget (cell-snapped, red = it '
          + 'collides); its label has ✕ Cancel and ✔ Build. Edit ▸ Undo '
          + '(Ctrl+Z) takes a built spheroid back as one step.',
      },
    ],
    initial: { rx: 1, ry: 1, rz: 1, fill: 'skin', shade: 'smooth', material: 'm0', color: '#c9c9c9', colorhow: 'new' },
    preview: (f) => {
      const spec = spheroidForm(f, 51);
      const st = spheroidStats(spec, { shade: f['shade'] === 'flat' ? 'flat' : 'smooth' });
      const mat = MATERIALS[+String(f['material']).slice(1)] ?? '?';
      if (f['fill'] === 'skin')
        return `${st.tris} triangles · skin ${f['shade'] === 'flat' ? 'flat' : 'smooth'} · `
          + `material ${mat} · ≈ ${st.kgSkin.toFixed(0)} kg`;
      const heavy = st.blocks > 3000 ? ' · HEAVY — skin recommended' : '';
      return `${st.blocks} blocks (${st.shellCells} chamfered) · `
        + `${f['fill'] === 'solid' ? 'SOLID' : 'SHELL'} · material ${mat}`
        + ` · ≈ ${st.kgBlocks.toFixed(0)} kg${heavy}`;
    },
    run: () => 'use placement',            // place tools never run()
    place: {
      stage: (f) => {
        const spec = spheroidForm(f, 51);
        return f['fill'] === 'skin'
          ? { triangles: spheroidTriangles(spec, { shade: f['shade'] === 'flat' ? 'flat' : 'smooth' }) }
          : { blocks: spheroidBlocks(spec) };
      },
      commit: (f, _payload, offset, ctx) => {
        // the PAINT resolves at Build (it can GROW the palette — an edit,
        // not a preview): a new free slot or the nearest existing colour
        const rgb = parseHexColor(String(f['color']));
        let slot = 51;
        if (rgb) {
          if (f['colorhow'] === 'nearest') slot = nearestSlot(ctx.bp.data.colors, rgb) ?? 51;
          else {
            const free = allocateSlot(ctx.bp.data.colors);
            if (free === null) slot = nearestSlot(ctx.bp.data.colors, rgb) ?? 51;
            else { setPaletteSlot(ctx, free, paletteSlotNode(rgb)); slot = free; }
          }
        }
        const spec = spheroidForm(f, slot);
        if (f['fill'] === 'skin') {
          const tris = shiftTriangles(
            spheroidTriangles(spec, { shade: f['shade'] === 'flat' ? 'flat' : 'smooth' }), offset);
          for (const t of tris) {
            ctx.bp.data.triangles ??= [];
            ctx.bp.data.triangles.push(t);
            docArrayInsert(ctx.doc, ['data', 'triangles'], ctx.bp.data.triangles.length - 1, docFromValue(t, false));
          }
          return `built a ${f['rx']}×${f['ry']}×${f['rz']} m spheroid SKIN: ${tris.length} `
            + `hull triangles, ${f['shade'] === 'flat' ? 'flat' : 'smooth'} (paint slot ${slot})`;
        }
        const blocks = shiftBlocks(spheroidBlocks(spec), offset);
        for (const b of blocks) {
          ctx.bp.data.blocks.push(b);
          docArrayInsert(ctx.doc, ['data', 'blocks'], ctx.bp.data.blocks.length - 1, docFromValue(b));
        }
        return `built a ${f['rx']}×${f['ry']}×${f['rz']} m spheroid: ${blocks.length} blocks (paint slot ${slot})`;
      },
    },
  },
];

/** Whole-cell shift of generated triangles (placement drag): every vertex is
 *  stored back through the frame + 0..31 window at cell + step. */
type TriVerts = [[number, number, number], [number, number, number], [number, number, number]];
function shiftTriangles(tris: Triangle[], step: [number, number, number]): Triangle[] {
  const out: Triangle[] = [];
  for (const t of tris) {
    const g: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++)
      for (let ax = 0; ax < 3; ax++) {
        const name = 'xyz'[ax]!;
        g[i]![ax] = (t[`v${i}_${name}`] as number) + 12 * (t[`frame_${name}`] as number) + step[ax]!;
      }
    const shifted = encodeTriSkin(g as unknown as TriVerts,
      Number(t.colors?.[0] ?? 51), Number(t.material ?? 0), t.smooth === 1);
    if (shifted) out.push(shifted);
  }
  return out;
}

/** The dialog form → a generation spec. The centre sits ABOVE the world
 *  origin so the spheroid lands clear of a fresh craft's deck plate; the
 *  placement offset moves it from there. SLOT is a preview stand-in — the
 *  final paint resolves in commit (it can grow the palette). */
function spheroidForm(f: ToolForm, slot: number): SpheroidSpec {
  const ry = +f['ry']!;
  return {
    center: [0, ry + 0.25, 0],
    radii: [+f['rx']!, ry, +f['rz']!],
    material: +String(f['material']).slice(1),
    slot, solid: f['fill'] !== 'shell',
  };
}

const replaceSourceOptions = (target: string) =>
  replaceSources(target === 'material' ? 'material' : 'colors').map(s => ({ id: s.id, label: s.label }));

// ------------------------------------------------------------------ DIALOG

/** The modal: opens CENTRED but is DRAGGABLE by its title bar (2026-10-20 user
 *  rule: "the window for tools should be movable") — pointer-captured, so
 *  it works with mouse and touch alike. Esc or Cancel dismisses, backdrop
 *  click cancels. 2026-10-20 CONFIRM FLOW (user: "a more understandable OK and
 *  Confirm and then have a confirmation box with information, rather than
 *  remaining open and not doing anything anymore when clicking OK a second
 *  time"): OK opens a CONFIRMATION BOX carrying the exact live readout of
 *  what the run will change; Confirm performs the run and CLOSES the dialog
 *  (the result rides the editor toast) — a second OK can never be a no-op
 *  because the form is behind the confirm step, which only ever has
 *  Back / Confirm. Field controls are generated from the ToolDef. */
export function ToolDialog(p: {
  tool: ToolDef; bp: Blueprint; ctx: EditCtx;
  onClose: () => void;
  /** after a successful run: dirty + bumpRev + debounced scene reload */
  onApplied: (message: string) => void;
  /** PLACEMENT tool: the confirmed payload goes to the viewport ghost
   *  (movable cluster + Cancel/Build label) instead of mutating */
  onPlaced?: (tool: ToolDef, form: ToolForm, payload: PlacePayload) => void;
}) {
  const [form, setForm] = useState<ToolForm>({ ...p.tool.initial });
  const [confirmStep, setConfirmStep] = useState(false);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; bx: number; by: number } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const { onClose } = p;
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, [onClose]);

  const preview = useMemo(() => p.tool.preview(form, p.bp), [p.tool, form, p.bp]);
  const runnable = preview !== '' && !preview.startsWith('nothing');
  const set = (k: string, v: ToolValue) => { setForm(f => ({ ...f, [k]: v })); setConfirmStep(false); };

  const confirmRun = () => {
    if (!runnable) { setConfirmStep(false); return; }
    if (p.tool.place && p.onPlaced) {
      // PLACEMENT: stage the ghost payload, close — the viewport label's
      // ✔ Build performs the commit at the position the user moved it to
      p.onPlaced(p.tool, { ...form }, p.tool.place.stage(form, p.bp));
      p.onClose();
      return;
    }
    const msg = p.tool.run(form, p.ctx);
    p.onApplied(msg);
    p.onClose();                       // the toast prints the result — no
  };                                    // inert "OK again" second act

  const headDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;      // ✕ stays ✕
    const cur = drag ?? { x: 0, y: 0 };
    dragRef.current = { sx: e.clientX, sy: e.clientY, bx: cur.x, by: cur.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const headMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const el = boxRef.current, host = el?.parentElement as HTMLElement | null;
    let nx = d.bx + e.clientX - d.sx, ny = d.by + e.clientY - d.sy;
    if (el && host) {
      // clamp so the window NEVER leaves the backdrop (a dialog dragged off
      // a phone screen is a dialog you cannot finish — its buttons stop hit-
      // testing), while on a desktop it roams nearly the whole viewport.
      const hb = host.getBoundingClientRect(), db = el.getBoundingClientRect();
      const limX = Math.max(0, hb.width / 2 - db.width / 2);
      const limY = Math.max(0, hb.height / 2 - db.height / 2);
      nx = Math.min(limX, Math.max(-limX, nx));
      ny = Math.min(limY, Math.max(-limY, ny));
    }
    setDrag({ x: nx, y: ny });
  };
  const headUp = () => { dragRef.current = null; };

  return (
    <div data-testid={`tool-backdrop-${p.tool.id}`}
      className="absolute inset-0 z-40 grid place-items-center bg-black/60 p-3"
      onMouseDown={e => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div ref={boxRef} data-testid={`tool-dialog-${p.tool.id}`} role="dialog" aria-label={p.tool.label}
        className="ksp-win w-[440px] max-w-[92vw] rounded-lg px-4 py-3"
        style={drag ? { transform: `translate(${drag.x}px, ${drag.y}px)` } : undefined}
        onKeyDown={e => { if (e.key === 'Enter') (confirmStep ? confirmRun() : runnable && setConfirmStep(true)); }}>
        {/* title bar = the drag handle (cursor-move, touch-safe) */}
        <div data-testid="tool-drag"
          className="ksp-label flex cursor-move touch-none select-none items-center gap-2
                     border-b border-white/10 pb-1.5 text-[12px] text-accent"
          onPointerDown={headDown} onPointerMove={headMove} onPointerUp={headUp}
          onPointerCancel={headUp}>
          <span className="text-[14px]">{p.tool.icon}</span> Tools — {p.tool.label}
          <button data-testid="tool-close" onClick={p.onClose} aria-label="close"
            className="ksp-btn ml-auto rounded px-1.5 text-[11px] text-ink-dim hover:text-accent">✕</button>
        </div>

        {confirmStep ? (
          /* THE CONFIRMATION BOX: exactly what the run will change, then
             Back / Confirm — nothing else (no inert OK) */
          <div data-testid="tool-confirm-box" className="pt-2">
            <div className={`rounded border px-3 py-2 text-[11px] leading-snug
                             ${p.tool.danger ? 'border-red-700/60 bg-red-950/40 text-red-100'
                               : 'border-gold/40 bg-black/30 text-ink'}`}>
              <div className="ksp-label pb-1 text-[11px] font-semibold text-gold">
                {p.tool.icon} {p.tool.label} — this will
              </div>
              <div data-testid="tool-preview" className="tabular-nums">{preview}</div>
              {p.tool.danger && (
                <div data-testid="tool-warning" className="pt-1.5 text-[10px] text-red-200">
                  This rewrites hull geometry in one go.
                </div>
              )}
              <div className="pt-1.5 text-[10px] text-ink-dim">
                You can take it back afterwards with Edit ▸ Undo (Ctrl+Z).
              </div>
            </div>
            <div className="mt-2.5 flex justify-end gap-2">
              <button data-testid="tool-back" className="ksp-btn px-3 py-1 text-[12px]"
                onClick={() => setConfirmStep(false)}>
                ← Back
              </button>
              <button data-testid="tool-confirm" onClick={confirmRun}
                className={`ksp-btn px-3 py-1 text-[12px] on ${p.tool.danger ? 'text-red-200' : ''}`}>
                {p.tool.place ? '✓ Confirm & place' : <>✓ Confirm &amp; run</>}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="pt-1.5 text-[11px] leading-snug text-ink-dim">{p.tool.blurb}</p>

            {/* the generated field grid: label ▸ control, one row per definition */}
            <div className="grid grid-cols-[92px_1fr] items-start gap-x-2 gap-y-1.5 pt-2.5">
              {p.tool.fields.filter(f => !f.showIf || f.showIf(form)).map(f => (
                <FieldRow key={f.key} def={f} value={form[f.key]} form={form} onSet={set} />
              ))}
            </div>

            <div data-testid="tool-preview"
              className={`mt-2.5 border-t border-white/10 pt-2 text-[11px] tabular-nums
                          ${runnable ? 'text-gold' : 'text-ink-dim'}`}>
              {preview || 'nothing to do'}
            </div>
            <div className="mt-2.5 flex justify-end gap-2">
              <button data-testid="tool-cancel" className="ksp-btn px-3 py-1 text-[12px]" onClick={p.onClose}>
                Cancel
              </button>
              <button data-testid="tool-ok" disabled={!runnable}
                className={`ksp-btn px-3 py-1 text-[12px] ${runnable ? 'on' : ''}`}
                onClick={() => setConfirmStep(true)}>
                OK — review &amp; confirm
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** One definition row: a select (ksp-btn chips for short lists, a native
 *  select for long ones), a live RANGE slider, a two-state TOGGLE, a colour
 *  PICKER (swatch + hex) or a plain hint note. */
function FieldRow(p: {
  def: ToolFieldDef; value: ToolValue | undefined; form: ToolForm;
  onSet: (k: string, v: ToolValue) => void;
}) {
  const d = p.def;
  if (d.kind === 'note')
    return (
      <div className="col-start-2 text-[10px] leading-snug text-ink-dim">{d.hint}</div>
    );
  if (d.kind === 'range') {
    const v = typeof p.value === 'number' ? p.value : +(p.value ?? d.min ?? 0);
    return (
      <>
        <span className="pt-1 text-[11px] text-ink-dim">{d.label}</span>
        <div data-testid={`tool-field-${d.key}`}>
          <div className="flex items-center gap-2">
            <input data-testid={`tool-range-${d.key}`} type="range"
              min={d.min} max={d.max} step={d.step} value={v}
              onChange={e => p.onSet(d.key, +e.target.value)}
              className="h-1 flex-1 accent-[#ffc94d]" />
            <span data-testid={`tool-range-val-${d.key}`}
              className="w-14 text-right text-[11px] tabular-nums text-gold">
              {v}{d.unit ?? ''}
            </span>
          </div>
          {d.hint && <div className="pt-1 text-[9px] text-ink-dim">{d.hint}</div>}
        </div>
      </>
    );
  }
  if (d.kind === 'toggle') {
    const on = !!p.value;
    return (
      <>
        <span className="pt-1 text-[11px] text-ink-dim">{d.label}</span>
        <div data-testid={`tool-field-${d.key}`} className="flex items-center gap-2">
          <button data-testid={`tool-toggle-${d.key}`} role="switch" aria-checked={on}
            onClick={() => p.onSet(d.key, on ? 0 : 1)}
            className={`ksp-btn px-2 py-[3px] text-[10px] ${on ? 'on' : ''}`}>
            {on ? '● solid' : '○ shell'}
          </button>
          {d.hint && <span className="text-[9px] leading-snug text-ink-dim">{d.hint}</span>}
        </div>
      </>
    );
  }
  if (d.kind === 'color') {
    const v = String(p.value ?? '#ffffff');
    return (
      <>
        <span className="pt-1 text-[11px] text-ink-dim">{d.label}</span>
        <div data-testid={`tool-field-${d.key}`} className="flex items-center gap-2">
          <input data-testid={`tool-color-${d.key}`} type="color" value={v}
            onChange={e => p.onSet(d.key, e.target.value)}
            className="h-6 w-9 cursor-pointer rounded border border-white/10 bg-transparent p-0" />
          <input data-testid={`tool-hex-${d.key}`} type="text" value={v} spellCheck={false}
            onChange={e => p.onSet(d.key, e.target.value)}
            className="w-24 rounded border border-white/10 bg-panel2 px-1.5 py-[3px] text-[11px] tabular-nums text-ink" />
        </div>
      </>
    );
  }
  const opts = (d.optionsFor ? d.optionsFor(p.form) : d.options) ?? [];
  const short = opts.length <= 8 && opts.every(o => o.label.length <= 18);
  return (
    <>
      <span className="pt-1 text-[11px] text-ink-dim">{d.label}</span>
      <div data-testid={`tool-field-${d.key}`}>
        {short ? (
          <div className="flex flex-wrap gap-1">
            {opts.map(o => (
              <button key={o.id} data-testid={`tool-opt-${d.key}-${o.id}`}
                onClick={() => p.onSet(d.key, o.id)}
                className={`ksp-btn px-1.5 py-[3px] text-[10px] ${p.value === o.id ? 'on' : ''}`}>
                {o.label}
              </button>
            ))}
          </div>
        ) : (
          <select data-testid={`tool-select-${d.key}`} value={String(p.value ?? '')}
            onChange={e => p.onSet(d.key, e.target.value)}
            className="w-full rounded border border-white/10 bg-panel2 px-1.5 py-1 text-[11px] text-ink">
            {opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        )}
        {d.hint && <div className="pt-1 text-[9px] text-ink-dim">{d.hint}</div>}
      </div>
    </>
  );
}
