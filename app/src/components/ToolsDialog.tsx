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
// nothing to do, closes on Esc/backdrop (Cancel), and runs on Enter/OK. The
// tool list itself is a registry — adding a tool means adding one ToolDef.
import { useEffect, useMemo, useState } from 'react';
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
  /** true = the operation cannot be undone yet (no undo stack, see the Edit
   *  menu TODO): the dialog shows a red warning and OK asks for the confirm */
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
          + 'by that normal — if the converted hull shows a beveled/wrong-way '
          + 'look in the game, pick the other direction here. (v1.5.7 user '
          + 'report: the block face’s own winding read wrong-way in-game; '
          + 'front-IN is the default, front-OUT is the v1.5.6 behaviour.)',
      },
      {
        key: 'note', label: '', kind: 'note',
        hint: 'Existing hull triangles and struts stay; type-255 component '
          + 'occupancy markers STAY (they are reservations, not geometry); '
          + 'blocks inside Build SUBGRIDS (doors/hatches) stay blocks — they '
          + 'live in the nested blueprints. There is NO undo yet — Save first '
          + 'if you want the block version back.',
      },
    ],
    initial: { wind: 'inward' },
    preview: (f, bp) => {
      const r = hullifyPreview(bp, { wind: f['wind'] === 'outward' ? 'outward' : 'inward' });
      if (!r.ok) return r.reason ?? 'nothing to convert';
      return `${r.blocksRemoved} blocks ▸ ${r.trisAdded} triangles · front faces ${f['wind'] === 'outward' ? 'OUT' : 'IN'}`
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
      const res = hullifyApply(ctx.bp, { wind: f['wind'] === 'outward' ? 'outward' : 'inward' });
      if (!res.ok) return res.reason ?? 'nothing converted';
      for (const i of geo) docArrayRemoveAt(ctx.doc, ['data', 'blocks'], i);
      docEnsureArray(ctx.doc, ['data', 'triangles']);
      (ctx.bp.data.triangles ?? []).forEach((t, k) => {
        if (k < trisBefore) return;
        docArrayInsert(ctx.doc, ['data', 'triangles'], k, docFromValue(t, true));
      });
      return `converted ${res.blocksRemoved} blocks into ${res.trisAdded} hull triangles`;
    },
  },
];

const replaceSourceOptions = (target: string) =>
  replaceSources(target === 'material' ? 'material' : 'colors').map(s => ({ id: s.id, label: s.label }));

// ------------------------------------------------------------------ DIALOG

/** The centered modal: Esc or Cancel dismisses, backdrop click cancels, OK
 *  (Enter) runs. Field controls are generated from the ToolDef. */
export function ToolDialog(p: {
  tool: ToolDef; bp: Blueprint; ctx: EditCtx;
  onClose: () => void;
  /** after a successful run: dirty + bumpRev + debounced scene reload */
  onApplied: (message: string) => void;
}) {
  const [form, setForm] = useState<ToolForm>({ ...p.tool.initial });
  const [armed, setArmed] = useState(false);           // danger tools: OK twice
  const [done, setDone] = useState<string | null>(null);
  const { onClose } = p;
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, [onClose]);

  const preview = useMemo(() => p.tool.preview(form, p.bp), [p.tool, form, p.bp]);
  const runnable = preview !== '' && !preview.startsWith('nothing');
  const set = (k: string, v: ToolValue) => { setForm(f => ({ ...f, [k]: v })); setArmed(false); };

  const ok = () => {
    if (!runnable) return;
    if (p.tool.danger && !armed) { setArmed(true); return; }
    const msg = p.tool.run(form, p.ctx);
    setDone(msg);
    p.onApplied(msg);
  };

  return (
    <div data-testid={`tool-backdrop-${p.tool.id}`}
      className="absolute inset-0 z-40 grid place-items-center bg-black/60 p-3"
      onMouseDown={e => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div data-testid={`tool-dialog-${p.tool.id}`} role="dialog" aria-label={p.tool.label}
        className="ksp-win w-[440px] max-w-[92vw] rounded-lg px-4 py-3"
        onKeyDown={e => { if (e.key === 'Enter') ok(); }}>
        <div className="ksp-label flex items-center gap-2 border-b border-white/10 pb-1.5 text-[12px] text-accent">
          <span className="text-[14px]">{p.tool.icon}</span> Tools — {p.tool.label}
          <button data-testid="tool-close" onClick={p.onClose} aria-label="close"
            className="ksp-btn ml-auto rounded px-1.5 text-[11px] text-ink-dim hover:text-accent">✕</button>
        </div>
        <p className="pt-1.5 text-[11px] leading-snug text-ink-dim">{p.tool.blurb}</p>

        {/* the generated field grid: label ▸ control, one row per definition */}
        <div className="grid grid-cols-[92px_1fr] items-start gap-x-2 gap-y-1.5 pt-2.5">
          {p.tool.fields.filter(f => !f.showIf || f.showIf(form)).map(f => (
            <FieldRow key={f.key} def={f} value={form[f.key]} form={form} onSet={set} />
          ))}
        </div>

        {p.tool.danger && (
          <div data-testid="tool-warning" className="mt-2 rounded border border-red-700/60 bg-red-950/40
                                                     px-2 py-1 text-[10px] text-red-200">
            No undo yet — this rewrite is immediate.{' '}
            {armed ? 'Press OK AGAIN to confirm.' : 'OK arms the confirmation.'}
          </div>
        )}
        <div data-testid="tool-preview"
          className={`mt-2.5 border-t border-white/10 pt-2 text-[11px] tabular-nums
                      ${runnable ? 'text-gold' : 'text-ink-dim'}`}>
          {done ?? preview}
        </div>
        <div className="mt-2.5 flex justify-end gap-2">
          <button data-testid="tool-cancel" className="ksp-btn px-3 py-1 text-[12px]" onClick={p.onClose}>
            Cancel
          </button>
          <button data-testid="tool-ok" disabled={!runnable}
            className={`ksp-btn px-3 py-1 text-[12px] ${runnable && (!p.tool.danger || armed) ? 'on' : ''}`}
            onClick={ok}>
            {p.tool.danger && !armed ? 'OK — confirm' : 'OK'}
          </button>
        </div>
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
