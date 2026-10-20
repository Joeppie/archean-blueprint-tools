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
import type { Blueprint } from '../engine/format';
import type { EditCtx } from '../engine/edit';
import { writeBlockDoc, writeBlockMaterial } from '../engine/edit';
import { docArrayInsert, docArrayRemoveAt, docEnsureArray, docFromValue } from '../engine/doc';
import { OCCUPANCY_TYPE } from '../engine/blockshapes';
import {
  MATERIALS, blockMaterial, hullifyApply, hullifyPreview, replaceCensus, replaceColorDests,
  replaceSources, replaceAll,
} from '../engine/tools';

export type ToolValue = string | number;
export type ToolForm = Record<string, ToolValue>;

export interface ToolFieldDef {
  key: string;
  label: string;
  kind: 'select' | 'note';
  /** static options (select) */
  options?: { id: string; label: string }[];
  /** dependent options, e.g. the colour sources follow the chosen target */
  optionsFor?: (f: ToolForm) => { id: string; label: string }[];
  /** hide the field for some form states */
  showIf?: (f: ToolForm) => boolean;
  hint?: string;
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
          + 'faces, so both directions render IDENTICALLY here. If the '
          + 'converted hull reads wrong-way/lit-from-behind in the game, pick '
          + 'the other direction. (The in-game BEVEL look is NOT the winding '
          + '— it is the shading option below.)',
      },
      {
        key: 'shade', label: 'shading', kind: 'select',
        options: [
          { id: 'smooth', label: 'smooth skin (smooth:1)' },
          { id: 'flat', label: 'flat (no key)' },
        ],
        hint: 'The game’s Triangle struct carries a per-triangle smooth flag '
          + '(0 = flat/geometric normals, the absent default; 1 = smooth '
          + 'normals). The game’s own hull saves set smooth:1 on their skin '
          + 'triangles, so the sheet shades continuously; a skin without it '
          + 'flat-shades every prism face — the beveled look on converted '
          + 'hulls. Default writes smooth:1 like the game does.',
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
    initial: { wind: 'inward', shade: 'smooth' },
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
];

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
                ✓ Confirm &amp; run
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
 *  select for long ones) or a plain hint note. */
function FieldRow(p: {
  def: ToolFieldDef; value: ToolValue | undefined; form: ToolForm;
  onSet: (k: string, v: ToolValue) => void;
}) {
  const d = p.def;
  if (d.kind === 'note')
    return (
      <div className="col-start-2 text-[10px] leading-snug text-ink-dim">{d.hint}</div>
    );
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
