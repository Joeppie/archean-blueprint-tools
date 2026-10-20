// ColorPanel.tsx — the PALETTE (v1.6 user rule: "I need to be able to choose
// colors on blocks and components and a color picker should exist; it should
// also offer a preview of existing picked colors on the vessel and the number
// of times its been used"). One swatch grid over the game's 256-slot palette
// (file palette + built-in families, v1 legacy remap applied), every swatch
// badged with how often that slot is painted on THIS vessel (block faces +
// hull-triangle faces + v1 component slot pairs — engine/palette.paletteUsage).
//
// Composed in three places (same rules, three docks):
//  • BlockPanel (BLOCKS workspace): the brush slot + the selected block's
//    per-face paint (⇄ twin rides through paintTwinPair/mirrorFaceOrder);
//  • the Inspector's Paint section: a palette colour SNAPS onto the held
//    component's custom color1/color2 dict (r/g/b/opacity/rough/metal);
//  • the canvas mode widget's 🎨 button — the paint alternative to the
//    move/rotate gizmo for the CURRENT selection (block or component).
//
// Swatches show the slot's LINEAR r/g/b raw (the engine feeds those raw to
// its shaders — cssColor), so a swatch is exactly what the 3D view paints.
import { useMemo, useState } from 'react';
import type { Blueprint, BlueprintComponent } from '../engine/format';
import { cssColor, paletteUsage, resolveColor, slotAlpha, type ResolvedColor } from '../engine/palette';
import { faceSlots } from '../engine/blocks';

/** The palette families worth naming in the picker (empty index ranges in
 *  the built-in table are skipped). Slots 0..10 are engine-reserved. */
const FAMILIES: [string, number, number][] = [
  ['engine', 0, 10], ['matte', 40, 56], ['polished', 84, 100],
  ['metal', 128, 144], ['glass', 172, 188],
];

const Swatch = (p: { color: ResolvedColor; used: number; on?: boolean; title: string; onClick: () => void }) => (
  <button data-testid="palette-swatch" title={p.title} onClick={p.onClick}
    className={`relative grid h-7 w-7 place-items-center rounded-[3px] border text-[8px]
                ${p.on ? 'border-accent ring-1 ring-accent' : 'border-white/15'} hover:border-white/60`}
    style={{
      // two-tone checker behind translucent (glass) slots so they read as glass
      background: p.color.opacity < 15
        ? `linear-gradient(45deg,#3a3f4a 25%,transparent 25%,transparent 75%,#3a3f4a 75%),
           linear-gradient(45deg,#3a3f4a 25%,#23262e 25%,#23262e 75%,#3a3f4a 75%) 3px 3px / 6px 6px,
           ${cssColor(p.color)}`
        : cssColor(p.color),
    }}>
    {p.used > 0 && (
      <span className="pointer-events-none absolute -right-1 -top-1 rounded bg-black/75 px-[3px]
                       text-[8px] leading-[12px] text-gold tabular-nums">{p.used}</span>
    )}
  </button>
);

/** 256-slot swatch grid (family rows + a "used" strip first). Click = pick. */
export function SwatchGrid(p: { bp: Blueprint; legacy: boolean; current: number | null; onPick: (slot: number) => void }) {
  const usage = useMemo(() => paletteUsage(p.bp, p.legacy), [p.bp, p.legacy]);
  const count = new Map(usage.slots.map(s => [s.slot, s.total]));
  const [fam, setFam] = useState<string>('used');
  const usedFirst = usage.slots.slice().sort((a, b) => b.total - a.total).slice(0, 32);
  const range = FAMILIES.find(f => f[0] === fam);
  return (
    <div data-testid="palette-grid">
      <div className="flex flex-wrap gap-1 pb-1">
        <button data-testid="palette-tab-used" onClick={() => setFam('used')}
          className={`ksp-btn px-1.5 py-[2px] text-[10px] ${fam === 'used' ? 'on' : ''}`}>
          on vessel ({usage.distinct})
        </button>
        {FAMILIES.map(([n]) => (
          <button key={n} data-testid={`palette-tab-${n}`} onClick={() => setFam(n)}
            className={`ksp-btn px-1.5 py-[2px] text-[10px] ${fam === n ? 'on' : ''}`}>{n}</button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {(fam === 'used'
          ? usedFirst.map(s => s.slot)
          : range ? Array.from({ length: range[2] - range[1] + 1 }, (_, i) => range[1] + i) : [])
          .map(slot => {
            const c = resolveColor(p.bp.data.colors ?? null, slot, p.legacy);
            const u = count.get(slot) ?? 0;
            return <Swatch key={slot} color={c} used={u} on={p.current === slot}
              title={`slot ${slot} · ${u}× on vessel (blocks+tris+parts)`}
              onClick={() => p.onPick(slot)} />;
          })}
        {fam === 'used' && !usedFirst.length &&
          <div className="text-[10px] text-ink-dim">nothing painted with a palette slot yet</div>}
      </div>
      <div className="pt-1 text-[9px] text-ink-dim">
        badge = times used on the vessel · swatch = the exact linear albedo the engine draws
      </div>
    </div>
  );
}

const FACE_LABELS = ['top', 'bottom', '+x', '−x', '−z', '+z', 'slant'];

/** Per-face paint editor of the SELECTED BLOCK: face chips pick WHAT gets
 *  painted (ALL = the 7-slot uniform paint), the grid picks the colour.
 *  onPaint writes bp + doc + reload through the Editor funnel; ⇄ twin
 *  mapping is the caller's paintTwinPair. */
export function BlockPaint(p: {
  bp: Blueprint; legacy: boolean; bi: number;
  onPaint: (slot: number, faces: number[] | undefined) => void;
}) {
  const b = p.bp.data.blocks[p.bi];
  const [face, setFace] = useState<number | null>(null);   // null = ALL faces
  if (!b) return <div className="text-[11px] text-ink-dim">no block selected</div>;
  const slots = faceSlots(b);
  return (
    <div data-testid="block-paint">
      <div className="flex flex-wrap items-center gap-1 pb-1">
        <button data-testid="paint-face-all" onClick={() => setFace(null)}
          className={`ksp-btn px-1.5 py-[2px] text-[10px] ${face === null ? 'on' : ''}`}>ALL</button>
        {slots.map((s, i) => {
          const c = resolveColor(p.bp.data.colors ?? null, s, p.legacy);
          return (
            <button key={i} data-testid={`paint-face-${i}`} title={`${FACE_LABELS[i] ?? i} — slot ${s}`}
              onClick={() => setFace(face === i ? null : i)}
              className={`ksp-btn flex items-center gap-1 px-1 py-[2px] text-[9px] ${face === i ? 'on' : ''}`}>
              <span className="inline-block h-2.5 w-2.5 rounded-[2px] border border-white/25"
                style={{ background: cssColor(c) }} />
              {FACE_LABELS[i] ?? i}
            </button>
          );
        })}
      </div>
      <SwatchGrid bp={p.bp} legacy={p.legacy}
        current={face === null ? (slots.every(s => s === slots[0]) ? slots[0]! : null) : slots[face] ?? null}
        onPick={slot => p.onPaint(slot, face === null ? undefined : [face])} />
    </div>
  );
}

/** The component analogue: a palette colour SNAPS its full shading spec
 *  (r/g/b + opacity + roughness + metallic) onto color1/color2 of the held
 *  part — the same six fields the numeric Paint rows expose. */
export function CompPaint(p: {
  bp: Blueprint; legacy: boolean; comp: BlueprintComponent;
  onApply: (which: 'color1' | 'color2', c: ResolvedColor) => void;
}) {
  const [which, setWhich] = useState<'color1' | 'color2'>('color1');
  const cols = p.comp.colors as Record<string, Record<string, number>> | undefined;
  const cur = cols?.[which];
  const alpha = cur ? ((cur.opacity ?? 15) < 15 ? ((cur.opacity ?? 15) + 1) / 16 : 1) : 1;
  return (
    <div data-testid="comp-paint">
      <div className="flex items-center gap-1 pb-1">
        {(['color1', 'color2'] as const).map(w => (
          <button key={w} data-testid={`comp-paint-${w}`} onClick={() => setWhich(w)}
            className={`ksp-btn flex items-center gap-1 px-1.5 py-[2px] text-[10px] ${which === w ? 'on' : ''}`}>
            <span className="inline-block h-2.5 w-2.5 rounded-[2px] border border-white/25"
              style={{ background: cur && `rgba(${Math.round(cur.r ?? 0)},${Math.round(cur.g ?? 0)},${Math.round(cur.b ?? 0)},${alpha.toFixed(3)})` }} />
            {w}
          </button>
        ))}
        {cur && (
          <span className="text-[9px] text-ink-dim">
            current ({Math.round(cur.r ?? 0)},{Math.round(cur.g ?? 0)},{Math.round(cur.b ?? 0)})
            {alpha < 1 ? ` α${slotAlpha({ r: cur.r ?? 255, g: cur.g ?? 255, b: cur.b ?? 255,
              opacity: cur.opacity ?? 15, roughness: cur.roughness ?? 0, metallic: cur.metallic ?? 0 }).toFixed(2)}` : ''} — custom
          </span>
        )}
      </div>
      <SwatchGrid bp={p.bp} legacy={p.legacy} current={null}
        onPick={slot => p.onApply(which, resolveColor(p.bp.data.colors ?? null, slot, p.legacy))} />
    </div>
  );
}
