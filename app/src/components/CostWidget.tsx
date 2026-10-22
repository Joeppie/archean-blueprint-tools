// CostWidget.tsx — VIEW ▸ Component cost: what the parts on this craft cost
// in RAW materials (user 2026-10-22: "In the view tab, summarize the total
// cost of all components expressed in raw materials, do a complete breakdown
// per component; e.g. what does the fluidport cost? and what do its
// constituents cost?").
//
// The numbers are the game's own economy (engine/economy.ts): every part is
// unfolded through the crafter recipes down to terminal ores/molecules, so the
// top table is the craft's raw SHOPPING LIST and every component row can be
// opened into its recipe chain — a constituent row shows what IT costs too.
// Quantities keep the game's units: celestial ores are grams (1,000 g = 1 kg),
// crafted items are counts.
import { useEffect, useMemo, useState } from 'react';
import type { Blueprint } from '../engine/format';
import {
  componentCosts, isMassUnit, loadEconomy, materialName,
  type Cost, type CostNode, type Economy,
} from '../engine/economy';

const LS_KEY = 'archean-app-cost-open';

const fmt = (n: number, d = 0) => n.toLocaleString('en', { maximumFractionDigits: d });

/** game units: ores in g below 1 kg, kg above; items/parts as counts */
function qtyText(id: string, q: number): string {
  if (isMassUnit(id)) {
    const whole = Math.abs(q - Math.round(q)) < 1e-9;
    return Math.abs(q) >= 1000
      ? `${fmt(q / 1000, q % 1000 === 0 ? 0 : 3)} kg`
      : `${fmt(q, whole ? 0 : 2)} g`;
  }
  const whole = Math.abs(q - Math.round(q)) < 1e-9;
  return `${fmt(q, whole ? 0 : 2)}`;
}

/** "1,000 g Iron · 250 g Carbon · 250 g Silicon" (top `max` by quantity) */
function rawLine(cost: Cost, max = 4): string {
  const lines: [string, number][] = [
    ...Object.entries(cost.raw), ...Object.entries(cost.unresolved),
  ];
  lines.sort((a, b) => b[1] - a[1]);
  const head = lines.slice(0, max).map(([id, q]) => `${qtyText(id, q)} ${materialName(id)}`);
  if (lines.length > max) head.push(`+${lines.length - max} more`);
  return head.join(' · ') || 'no material';
}

const secs = (s: number) => s >= 3600 ? `${fmt(s / 3600, 1)} h`
  : s >= 60 ? `${fmt(s / 60, 1)} min` : `${fmt(s, s < 10 ? 1 : 0)} s`;

/** ONE row of a component's recipe chain: the item, what it costs, and (when
 *  opened) its own constituents — recursively. */
function TreeNode(p: { node: CostNode; depth: number; open: Set<string>; toggle: (k: string) => void; keyPath: string }) {
  const { node, depth, open, toggle, keyPath } = p;
  const kids = node.children.length > 0;
  const isOpen = open.has(keyPath);
  return (
    <div data-testid={`cost-node-${materialName(node.id)}`}>
      <button
        data-testid={kids ? `cost-expand-${materialName(node.id)}` : undefined}
        onClick={kids ? () => toggle(keyPath) : undefined}
        className={`flex w-full items-start gap-1 py-[1px] text-left ${kids ? 'hover:text-accent' : ''}`}
        style={{ paddingLeft: `${4 + depth * 10}px` }}
        title={node.id}
      >
        <span className="w-2 shrink-0 text-[9px] text-ink-dim">{kids ? (isOpen ? '▾' : '▸') : '·'}</span>
        <span className="shrink-0 whitespace-nowrap">
          {materialName(node.id)}
          <span className="text-ink-dim"> ×{qtyText(node.id, node.qty)}</span>
          {node.stuck && <span className="ml-1 text-[9px] text-gold">no recipe</span>}
        </span>
        <span data-testid="cost-leaf" className="min-w-0 flex-1 truncate text-right text-[10px] tabular-nums text-ink-dim">
          {rawLine(node.cost, depth === 0 ? 4 : 2)}
        </span>
      </button>
      {kids && isOpen && node.children.map((c, i) => (
        <TreeNode key={`${keyPath}/${i}`} node={c} depth={depth + 1}
          open={open} toggle={toggle} keyPath={`${keyPath}/${i}`} />
      ))}
    </div>
  );
}

export function CostWidget(p: { bp: Blueprint; rev: number }) {
  const [open, setOpen] = useState(() => localStorage.getItem(LS_KEY) !== '0');
  // undefined = still fetching, null = the table is unavailable (hide the body)
  const [econ, setEcon] = useState<Economy | null | undefined>(undefined);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => { localStorage.setItem(LS_KEY, open ? '1' : '0'); }, [open]);
  useEffect(() => { let live = true; loadEconomy().then(e => { if (live) setEcon(e); }); return () => { live = false; }; }, []);

  // the blueprint arrays MUTATE in place — `rev` is the real dependency
  const cost = useMemo(() => (econ ? componentCosts(econ, p.bp) : null),
    [econ, p.bp, p.rev]);                             // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (k: string) => setExpanded(s => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  const totalRaw = cost ? Object.entries(cost.total.raw)
    .sort((a, b) => b[1] - a[1]) : [];
  const totalStuck = cost ? Object.entries(cost.total.unresolved)
    .sort((a, b) => b[1] - a[1]) : [];
  const parts = cost ? cost.rows.reduce((n, r) => n + r.count, 0) : 0;

  return (
    <div data-testid="cost-widget" className="border-b border-white/10">
      <button data-testid="cost-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left">
        <span className="w-3 text-[9px] text-ink-dim">{open ? '▾' : '▸'}</span>
        <span className="ksp-label min-w-0 flex-1 truncate text-[11px] font-semibold text-ink-dim">
          Component cost
        </span>
        <span data-testid="cost-head" className="shrink-0 text-[10px] tabular-nums text-ink-dim">
          {econ === undefined ? 'loading…'
            : !cost ? 'no economy data'
            : `${parts} parts · ${totalRaw.length} raw materials`}
        </span>
      </button>

      {open && cost && (
        <div className="px-3 pb-2 text-[11px] leading-snug">
          {/* ---- the craft's raw-material shopping list (all parts) ---- */}
          <div className="mb-1 text-[9px] uppercase tracking-wider text-ink-dim">
            raw materials — all {parts} parts
          </div>
          <div data-testid="cost-total" className="space-y-[1px]">
            {!totalRaw.length && !totalStuck.length && <div className="text-ink-dim">no parts</div>}
            {totalRaw.map(([id, q]) => (
              <div key={id} data-testid={`cost-total-${materialName(id)}`} className="flex justify-between gap-2">
                <span className="truncate">{materialName(id)}</span>
                <b className="shrink-0 tabular-nums">{qtyText(id, q)}</b>
              </div>
            ))}
            {totalStuck.map(([id, q]) => (
              <div key={id} className="flex justify-between gap-2 text-gold/90">
                <span className="truncate">{materialName(id)} <span className="text-[9px]">(no recipe)</span></span>
                <b className="shrink-0 tabular-nums">{qtyText(id, q)}</b>
              </div>
            ))}
          </div>
          {cost.total.time > 0 && (
            <div className="mt-1 text-[10px] text-ink-dim">
              crafter time {secs(cost.total.time)} (sum of the unfolded recipes)
            </div>
          )}

          {/* ---- per component: click for its recipe chain + constituents ---- */}
          <div className="mb-1 mt-2 text-[9px] uppercase tracking-wider text-ink-dim">
            per component
          </div>
          <div data-testid="cost-rows" className="space-y-[1px]">
            {cost.rows.map(r => {
              const isOpen = expanded.has(r.id);
              const known = !r.unit.stuck && r.unit.children.length > 0;
              return (
                <div key={r.id} data-testid={`cost-row-${r.type}`}>
                  <button data-testid={known ? `cost-open-${r.type}` : undefined}
                    onClick={known ? () => toggle(r.id) : undefined}
                    className={`flex w-full flex-col gap-0 py-[2px] text-left ${known ? 'hover:text-accent' : ''}`}
                    title={r.id}>
                    <span className="flex w-full items-center gap-1">
                      <span className="w-2 shrink-0 text-[9px] text-ink-dim">{known ? (isOpen ? '▾' : '▸') : '·'}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {r.type}
                        <span className="text-ink-dim"> ×{r.count}</span>
                        {r.nested && <span className="ml-1 text-[9px] text-ink-dim">subgrid</span>}
                        {r.unit.stuck && <span className="ml-1 text-[9px] text-gold">no recipe</span>}
                      </span>
                    </span>
                    <span data-testid={`cost-sum-${r.type}`}
                      className="truncate pl-[13px] text-[10px] tabular-nums text-ink-dim">
                      {rawLine(r.total, 2)}
                    </span>
                  </button>
                  {isOpen && (
                    <div data-testid={`cost-detail-${r.type}`} className="mb-1 border-l border-white/10 pl-1">
                      <div className="pl-1 text-[10px] text-ink-dim">
                        one unit ({r.type}) — {secs(r.unit.cost.time)}
                      </div>
                      {r.unit.children.map((c, i) => (
                        <TreeNode key={`${r.id}/${i}`} node={c} depth={0} open={expanded}
                          toggle={toggle} keyPath={`${r.id}/${i}`} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-1 text-[9px] leading-snug text-ink-dim">
            unfolded through the game's crafter recipes (first recipe per item);
            ores in g/kg, parts in units. Blocks, frames, cables and hull
            triangles are structural — this list is PARTS only.
          </div>
        </div>
      )}
      {open && !cost && (
        <div data-testid="cost-nodata" className="px-3 pb-2 text-[10px] text-ink-dim">
          {econ === undefined ? 'loading the economy table…'
            : 'the economy table (viewer/models/economy.json) is unavailable — run tools/extract_economy.py'}
        </div>
      )}
    </div>
  );
}
