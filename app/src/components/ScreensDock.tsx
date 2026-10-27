// ScreensDock.tsx — the ▣ SCREENS bottom tab (v1.13.x: "lets be able to open
// the screens in the bottom tab using a screen button on top (only visible if
// the craft has dashboards) which display the current (raster) graphics/
// values of the dashboards. There should be a tab for normal and virtual
// ones, so that we can understand what is being composed currently").
//
// The dock rides the SHARED XenonPump: the SAME running computer feeds the
// IDE dialog, the 3-D dashboard faces and this panel — one VM, one 10 Hz
// pump, every surface blitted to every registered canvas.
//   · Dashboards tab — every surface that is NOT a virtualscreen: the
//     craft's physical Screen/HdScreen elements (bound by screen(alias,ch))
//     and the program's auto-created surfaces (main#0 = integrated screen).
//   · Virtual tab — the code-created buffers (virtualscreen(w,h)) — the
//     Badger composes its attitude display out of these.
// The canvases are CLICKABLE: a click is delivered to the VM (pixel coords
// of the surface), so button_rect buttons evaluate true exactly as in game.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react';
import { xenonPump, xenonScreenBindings, type XenonComputer } from '../engine/xenoncode';

/** One live surface canvas — registers with the pump (the pump blits), routes
 *  pointer clicks / wheel notches into the VM (computer.md: click entry
 *  point + button "evaluates to true if clicked"). */
export function ScreenCanvas(p: { surfKey: string; w: number; h: number; testid?: string; maxH?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    return cv ? xenonPump.registerCanvas(p.surfKey, cv) : undefined;
  }, [p.surfKey]);
  const toPixels = (e: React.MouseEvent) => {
    const cv = ref.current;
    if (!cv) return null;
    const r = cv.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) * (cv.width / r.width));
    const y = Math.floor((e.clientY - r.top) * (cv.height / r.height));
    return { x, y };
  };
  return <canvas ref={ref} data-testid={p.testid} width={p.w} height={p.h}
    className="rounded-sm border border-[#2b313b] bg-black"
    style={{ imageRendering: 'pixelated', maxHeight: p.maxH ?? 220, width: 'auto', maxWidth: '100%', cursor: 'pointer' }}
    onClick={e => {
      const px = toPixels(e);
      if (px) xenonPump.screenClick(p.surfKey, px.x, px.y);
    }}
    onWheel={e => xenonPump.screenScroll(p.surfKey, e.deltaY < 0 ? 1 : -1)} />;
}

export default function ScreensDock(p: { comp: XenonComputer | null; onClose: () => void }) {
  const [, setTick] = useState(0);
  const [tab, setTab] = useState<'dash' | 'virtual'>('dash');
  useEffect(() => xenonPump.subscribe(() => setTick(t => t + 1)), []);

  const bindings = p.comp ? xenonScreenBindings(p.comp) : new Map<string, string>();
  const all = [...xenonPump.surfaces.values()];
  const virt = all.filter(s => s.key.startsWith('virtual#'));
  const dash = all.filter(s => !s.key.startsWith('virtual#'));
  const list = tab === 'virtual' ? virt : dash;

  return (
    <div data-testid="screens-dock"
      className="pointer-events-auto flex h-[42dvh] flex-col overflow-hidden rounded-t-lg
             border border-b-0 border-[#3a4a6a] bg-[#10141f]/[.97] text-[#d6dbe1] shadow-2xl"
      style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace' }}>
      <div className="flex items-center gap-3 bg-[#1a2436] px-3 py-1.5 text-[12px]">
        <span className="font-bold tracking-wide">▣ Screens
          {p.comp && <span className="ml-2 font-normal text-[#9fb0c8]">— {p.comp.alias || p.comp.program}</span>}
        </span>
        <span data-testid="screens-status"
          className={`text-[10px] font-bold ${xenonPump.status === 'running' ? 'text-[#3ddc55]' : 'text-[#ff5b5b]'}`}>
          {xenonPump.status === 'running' ? 'ON' : xenonPump.status.toUpperCase()}
        </span>
        <span className="text-[10px] text-[#5d6a7d]">cycles {xenonPump.cycles} @ 10 Hz</span>
        <button data-testid="screens-tab-dash"
          onClick={() => setTab('dash')}
          className={`rounded px-2 py-0.5 text-[11px] ${tab === 'dash' ? 'bg-[#243a52] text-[#8fd4ff]' : 'bg-[#1a2233] text-[#7d8aa0]'}`}>
          Dashboards ({dash.length})
        </button>
        <button data-testid="screens-tab-virtual"
          onClick={() => setTab('virtual')}
          className={`rounded px-2 py-0.5 text-[11px] ${tab === 'virtual' ? 'bg-[#243a52] text-[#8fd4ff]' : 'bg-[#1a2233] text-[#7d8aa0]'}`}>
          Virtual ({virt.length})
        </button>
        <button data-testid="screens-close" className="ml-auto text-[#8a93a0] hover:text-white"
          onClick={p.onClose} aria-label="close screens">✕</button>
      </div>
      <div data-testid="screens-grid" className="flex flex-wrap content-start gap-3 overflow-y-auto p-3">
        {!p.comp && (
          <span className="text-[12px] text-[#5d6a7d]">this craft has no computer to run screens.</span>
        )}
        {p.comp && !all.length && (
          <span className="text-[12px] text-[#5d6a7d]">
            {xenonPump.status === 'booting' ? 'booting the computer…' : 'no surfaces painted yet'}
          </span>
        )}
        {list.map(s => (
          <label key={s.key} data-testid={`screens-cell-${s.key}`} className="block text-[10px] text-[#5d6a7d]">
            <ScreenCanvas surfKey={s.key} w={s.w} h={s.h} maxH={260} />
            <div>{bindings.get(s.key) ?? s.key} · {s.w}×{s.h}</div>
          </label>
        ))}
        {p.comp && !!all.length && !list.length && (
          <span className="text-[12px] text-[#5d6a7d]">
            {tab === 'virtual' ? 'no virtualscreen() buffers composed yet' : 'no physical surfaces painted yet'}
          </span>
        )}
      </div>
    </div>
  );
}
