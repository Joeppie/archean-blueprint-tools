// CostWidget.tsx — VIEW ▸ Build cost: what this craft asks for in RAW
// materials — the parts, the blocks, the hull triangles, the cables, the
// frames and the struts (user 2026-10-22: "In the view tab, summarize the
// total cost of all components expressed in raw materials, do a complete
// breakdown per component … also calculate triangles and blocks … similar
// breakdown as for components, where it does specify what is required";
// "it doesnt calculate the cost of cables. Figure out how the game calculates
// that and how much length the current cables actually take").
//
// The numbers are the game's own economy (engine/economy.ts): every line is
// unfolded through the crafter recipes down to terminal ores/molecules, so the
// top table is the craft's raw SHOPPING LIST and every row can be opened into
// its recipe chain — a constituent row shows what IT costs too. Quantities
// keep the game's units: ores are grams (1,000 g = 1 kg, 1,000 kg = 1 t),
// crafted items are counts; cables are measured in metres of cable run.
import { useEffect, useMemo, useState } from 'react';
import type { Blueprint } from '../engine/format';
import {
  buildCost, isMassUnit, loadEconomy, materialName,
  type BuildSource, type Cost, type CostNode, type Economy, type ItemMeasure, type SourceRow,
} from '../engine/economy';

const LS_KEY = 'archean-app-cost-open';
/** which SECTIONS are folded (persisted; the rows' own trees use `expanded`) */
const LS_SECTIONS = 'archean-app-cost-sections';

const fmt = (n: number, d = 0) => n.toLocaleString('en', { maximumFractionDigits: d });

/** game units: ores in g below 1 kg, kg below 1 t, tonnes above; items/parts
 *  as plain counts */
function qtyText(id: string, q: number): string {
  if (isMassUnit(id)) {
    const whole = Math.abs(q - Math.round(q)) < 1e-9;
    if (Math.abs(q) >= 1e6) return `${fmt(q / 1e6, q % 1e6 === 0 ? 0 : 2)} t`;
    return Math.abs(q) >= 1000
      ? `${fmt(q / 1000, q % 1000 === 0 ? 0 : 3)} kg`
      : `${fmt(q, whole ? 0 : 2)} g`;
  }
  const whole = Math.abs(q - Math.round(q)) < 1e-9;
  return `${fmt(q, whole ? 0 : 2)}`;
}

/** a cable/strut length: metres up to 1 km, then kilometres */
function mText(m: number): string {
  if (Math.abs(m) >= 1000) return `${fmt(m / 1000, 2)} km`;
  return `${fmt(m, 1)} m`;
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

/** the physical measure behind a structural row (what the quantity MEANS) */
function measureText(id: BuildSource['id'], m: ItemMeasure): string {
  switch (id) {
    case 'blocks': {
      const n = m.cells ?? 0;
      return `${fmt(n)} cell${n === 1 ? '' : 's'}`;
    }
    case 'triangles':
      return `${fmt(m.tris ?? 0)} tris · ${fmt(m.area ?? 0, 1)} m²`;
    case 'cables':
      return `${mText(m.metres ?? 0)} · ${fmt(m.runs ?? 0)} runs`;
    case 'struts': return `${mText(m.metres ?? 0)} of rod`;
    default: return '';
  }
}

const secs = (s: number) => s >= 3600 ? `${fmt(s / 3600, 1)} h`
  : s >= 60 ? `${fmt(s / 60, 1)} min` : `${fmt(s, s < 10 ? 1 : 0)} s`;

/** ONE row of a recipe chain: the item, what it costs, and (when opened) its
 *  own constituents — recursively. */
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

/** a structural section row: `SteelBlock ×2,058  2,058 cells` + its raw
 *  summary, openable into the SAME recipe-chain tree as a component. */
function SourceRowView(p: {
  source: BuildSource; row: SourceRow; open: Set<string>; toggle: (k: string) => void;
}) {
  const { source, row, open, toggle } = p;
  const name = materialName(row.item);
  const key = `${source.id}:${row.item}`;
  const isOpen = open.has(key);
  const known = row.node.children.length > 0;
  const measure = measureText(source.id, row.measure);
  return (
    <div data-testid={`cost-source-row-${source.id}-${name}`}>
      <button
        data-testid={known ? `cost-source-open-${source.id}-${name}` : undefined}
        onClick={known ? () => toggle(key) : undefined}
        className={`flex w-full flex-col gap-0 py-[2px] text-left ${known ? 'hover:text-accent' : ''}`}
        title={row.item}
      >
        <span className="flex w-full items-center gap-1">
          <span className="w-2 shrink-0 text-[9px] text-ink-dim">{known ? (isOpen ? '▾' : '▸') : '·'}</span>
          <span className="shrink-0 whitespace-nowrap">
            {name}
            <span className="text-ink-dim"> ×{qtyText(row.item, row.qty)}</span>
            {row.node.stuck && <span className="ml-1 text-[9px] text-gold">no recipe</span>}
          </span>
          <span data-testid={`cost-source-measure-${source.id}-${name}`}
            className="min-w-0 flex-1 truncate text-right text-[10px] tabular-nums text-ink-dim">
            {measure}
          </span>
        </span>
        <span className="truncate pl-[13px] text-[10px] tabular-nums text-ink-dim">
          {rawLine(row.total, 2)}
        </span>
      </button>
      {known && isOpen && (
        <div data-testid={`cost-source-detail-${source.id}-${name}`} className="mb-1 border-l border-white/10 pl-1">
          <div className="pl-1 text-[10px] text-ink-dim">
            {fmt(row.qty)} {name} — {secs(row.total.time)}
          </div>
          {row.node.children.map((c, i) => (
            <TreeNode key={`${key}/${i}`} node={c} depth={0} open={open}
              toggle={toggle} keyPath={`${key}/${i}`} />
          ))}
        </div>
      )}
    </div>
  );
}

/** a foldable section header: title + a one-line note that stays visible when
 *  the section is collapsed (so a folded group still says what it holds). */
function SectionHeader(p: {
  id: string; title: string; note: string;
  noteTestId?: string; collapsed: boolean; toggle: (id: string) => void;
}) {
  const { id, title, note, noteTestId, collapsed, toggle } = p;
  return (
    <button data-testid={`cost-sec-${id}`} onClick={() => toggle(id)} aria-expanded={!collapsed}
      className="mb-1 mt-2 flex w-full items-baseline gap-1 text-left text-[9px] uppercase tracking-wider text-ink-dim hover:text-accent">
      <span className="w-2 shrink-0" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
      <span className="shrink-0">{title}</span>
      <span data-testid={noteTestId ?? `cost-sec-note-${id}`}
        className="min-w-0 flex-1 truncate text-right normal-case tracking-normal opacity-70">
        {note}
      </span>
    </button>
  );
}

export function CostWidget(p: { bp: Blueprint; rev: number }) {
  const [open, setOpen] = useState(() => localStorage.getItem(LS_KEY) !== '0');
  // undefined = still fetching, null = the table is unavailable (hide the body)
  const [econ, setEcon] = useState<Economy | null | undefined>(undefined);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // FOLDED sections (persisted, like the widget's own open state)
  const [closed, setClosed] = useState<Set<string>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_SECTIONS) ?? '[]');
      return new Set(Array.isArray(raw) ? raw as string[] : []);
    } catch { return new Set(); }
  });

  useEffect(() => { localStorage.setItem(LS_KEY, open ? '1' : '0'); }, [open]);
  useEffect(() => { localStorage.setItem(LS_SECTIONS, JSON.stringify([...closed])); }, [closed]);
  useEffect(() => { let live = true; loadEconomy().then(e => { if (live) setEcon(e); }); return () => { live = false; }; }, []);

  // the blueprint arrays MUTATE in place — `rev` is the real dependency
  const cost = useMemo(() => (econ ? buildCost(econ, p.bp) : null),
    [econ, p.bp, p.rev]);                             // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (k: string) => setExpanded(s => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  const toggleSection = (id: string) => setClosed(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const isClosed = (id: string) => closed.has(id);

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
          Build cost
        </span>
        <span data-testid="cost-head" className="shrink-0 text-[10px] tabular-nums text-ink-dim">
          {econ === undefined ? 'loading…'
            : !cost ? 'no economy data'
            : `${parts} parts · ${fmt(cost.blocks.cells)} cells`}
        </span>
      </button>

      {open && cost && (
        <div className="px-3 pb-2 text-[11px] leading-snug">
          {/* ---- the craft's raw-material shopping list (EVERYTHING) ---- */}
          <SectionHeader id="raw" title="raw materials — whole craft"
            note={`${totalRaw.length} materials`} collapsed={isClosed('raw')} toggle={toggleSection} />
          {!isClosed('raw') && (
            <>
              <div data-testid="cost-total" className="space-y-[1px]">
                {!totalRaw.length && !totalStuck.length && <div className="text-ink-dim">no material</div>}
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
            </>
          )}

          {/* ---- per component: click for its recipe chain + constituents ---- */}
          <SectionHeader id="components" title="per component"
            note={`${parts} parts`} collapsed={isClosed('components')} toggle={toggleSection} />
          {!isClosed('components') && (
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
                        {r.viaTool && <span className="ml-1 text-[9px] text-ink-dim">via tool</span>}
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
          )}

          {/* ---- the structural species: blocks / hull triangles / cables /
                  frames / struts, each row openable to its constituents ---- */}
          {cost.sources.map(src => (
            <div key={src.id} data-testid={`cost-source-${src.id}`}>
              <SectionHeader id={src.id} title={src.title} note={src.note}
                noteTestId={`cost-source-note-${src.id}`}
                collapsed={isClosed(src.id)} toggle={toggleSection} />
              {!isClosed(src.id) && (
                <div className="space-y-[1px]">
                  {!src.rows.length && (
                    <div className="pl-[13px] text-[10px] text-ink-dim">
                      no unit charged — each segment truncates below 1 cm
                    </div>
                  )}
                  {src.rows.map(row => (
                    <SourceRowView key={row.item} source={src} row={row}
                      open={expanded} toggle={toggle} />
                  ))}
                </div>
              )}
            </div>
          ))}

          <div className="mt-1 text-[9px] leading-snug text-ink-dim">
            unfolded through the game's crafter recipes (first recipe per item);
            blocks bill their full cell rect, hull triangles area×0.05 m at one
            block minimum, cables their per-segment truncated length in cm
            (1 spool unit = 1 cm). Ores in g/kg/t, parts in units.
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
