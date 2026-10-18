// Viewport.tsx — thin React host for the headless Engine. React owns mount/
// resize/blueprint-load ONLY; scene graph, pick, selection and render cadence
// stay in the engine (the 60 fps path never runs through the reconciler).
// Test hooks land on window.__ARCHEAN__ (same philosophy as the legacy
// title/#out reporting): stats/pick/pose are assertable without pixels.
import { useEffect, useRef, useState } from 'react';
import { openAtlas, type ModelAtlas } from '../engine/models';
import type { Blueprint } from '../engine/format';
import { Engine, type PickHit, type SceneStats } from '../engine/scene';

declare global {
  interface Window { __ARCHEAN__?: {
    engine: Engine;
    stats: () => SceneStats;
    pickProbe: () => PickHit;
    lastPick: () => PickHit;
  } }
}

let atlasP: Promise<ModelAtlas | null> | null = null;
const getAtlas = (): Promise<ModelAtlas | null> => (atlasP ??= openAtlas());

export default function Viewport({ bp, onPick, onEngine, mode = 'edit', onBlockPick }: {
  bp: Blueprint | null;
  onPick: (h: PickHit) => void;
  onEngine?: (e: Engine | null) => void;
  /** workspace mode: blocks clicks route to onBlockPick; the mode widget
   *  only belongs to Edit */
  mode?: 'view' | 'edit' | 'blocks' | 'wire' | 'flight';
  onBlockPick?: (clientX: number, clientY: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);

  useEffect(() => {
    const engine = new Engine();
    engine.attach(canvasRef.current!);
    engineRef.current = engine;
    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(canvasRef.current!);
    window.__ARCHEAN__ = {
      engine,
      stats: () => engine.stats(),
      pickProbe: () => engine.pickProbe(),
      lastPick: () => engine.lastPick,
    };
    onEngine?.(engine);
    return () => {
      ro.disconnect(); engine.dispose(); window.__ARCHEAN__ = undefined; onEngine?.(null);
    };
  }, []);                                    // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!bp) return;
    let dead = false;
    (async () => {
      const atlas = await getAtlas();
      if (!dead) engineRef.current?.load(bp, atlas);
    })().catch(console.error);
    return () => { dead = true; };
  }, [bp]);

  // DELIBERATE press picks (PERF.md: one raycast per click, none during
  // orbit): pointerdown records, pointerup <4px moves select-and-fly,
  // exactly like the legacy pick-on-click rule. A comp pick also pops the
  // MODE widget at the click point (⊘/✥/⟳, legacy v0.153; ⇄ comes with the
  // symmetry port) — the choice persists and drives the gizmo.
  const down = useRef({ x: 0, y: 0 });
  const hostRef = useRef<HTMLDivElement>(null);
  const [widget, setWidget] = useState<{ x: number; y: number } | null>(null);
  const [gmode, setGmode] = useState<'off' | 'translate' | 'rotate'>(
    () => (localStorage.getItem('archean-app-gizmo-mode') as 'off' | 'translate' | 'rotate') || 'rotate');
  const [, setSymTick] = useState(0);
  useEffect(() => {
    const sh = (e: KeyboardEvent, on: boolean) => { if (e.key === 'Shift') engineRef.current?.setGizmoSnap(on); };
    const dn = (e: KeyboardEvent) => sh(e, true), up = (e: KeyboardEvent) => sh(e, false);
    addEventListener('keydown', dn); addEventListener('keyup', up);
    return () => { removeEventListener('keydown', dn); removeEventListener('keyup', up); };
  }, []);
  const setMode = (m: 'off' | 'translate' | 'rotate') => {
    setGmode(m);
    engineRef.current?.setGizmoMode(m);
  };
  const pickClick = (e: React.PointerEvent) => {
    const engine = engineRef.current;
    if (!engine) return;
    if (mode === 'blocks') { onBlockPick?.(e.clientX, e.clientY); return; }
    const hit = engine.pickAt(e.clientX, e.clientY);
    onPick(hit);
    if (hit.kind === 'comp' && hit.ci != null) {
      engine.select(hit.ci); engine.flyTo(hit.ci);
      const box = hostRef.current?.getBoundingClientRect();
      if (box && mode === 'edit') setWidget({ x: e.clientX - box.left, y: e.clientY - box.top });
    } else {
      if (hit.kind === 'sub' && hit.sub != null) engine.selectSub(hit.sub);
      else engine.select(-1);
      setWidget(null);
    }
  };

  return (
    <div ref={hostRef} className="relative h-full w-full" data-testid="viewport">
      <canvas ref={canvasRef} data-testid="canvas" className="block h-full w-full touch-none"
        onPointerDown={e => { down.current = { x: e.clientX, y: e.clientY }; }}
        onPointerUp={e => {
          if (Math.abs(e.clientX - down.current.x) < 4 && Math.abs(e.clientY - down.current.y) < 4)
            pickClick(e);
        }} />
      {widget && (
        <div data-testid="modebox"
          className="ksp-win absolute z-20 flex -translate-x-1/2 gap-1 rounded p-1"
          style={{ left: widget.x, top: widget.y - 44 }}>
          {([['off', '⊘', 'hide gizmo'], ['translate', '✥', 'move'], ['rotate', '⟳', 'rotate']] as const).map(([m, ic, t]) => (
            <button key={m} title={t} data-testid={`mode-${m}`} onClick={() => setMode(m)}
              className={`ksp-btn grid h-8 w-9 place-items-center text-[15px] leading-none ${gmode === m ? 'on' : ''}`}>
              {ic}
            </button>
          ))}
          {/* ⇄ mirror-twin switch (v0.161): effective state with strikethrough when
              off OR the selected pair drifted apart (the >5 cm auto-disable) */}
          <button title="move mirrored twins (⇄)" data-testid="mode-sym"
            onClick={() => { const e = engineRef.current; if (e) e.setSymOn(!e.symState().on); setSymTick(t => t + 1); }}
            className={`ksp-btn grid h-8 w-9 place-items-center text-[15px] leading-none ${
              engineRef.current?.symState().active ? 'on' : 'line-through opacity-60'}`}>
            ⇄
          </button>
        </div>
      )}
      <StatsStrip engine={engineRef} bp={bp} />
    </div>
  );
}

/** live scene-stats strip; also the headless assertion point */
function StatsStrip({ engine, bp }: { engine: { current: Engine | null }; bp: Blueprint | null }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!bp) return;
    let raf = 0, frames = 0;
    const tick = () => {                                   // poll after first drawn frame
      const e = engine.current;
      if (e && ref.current) {
        const s = e.stats();
        if (s.draws > 0 || frames++ > 120) {
          ref.current.textContent =
            `blocks=${s.blocks} tris=${s.tris} hull=${s.hullTris} comps=${s.comps} subs=${s.subs} draws=${s.draws} tier=${s.tier}`;
          document.title = s.ok && s.draws > 0 ? `SCENE PASS ${ref.current.textContent}` : `SCENE ${JSON.stringify(s)}`;
          if (s.ok && s.draws > 0) return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [bp, engine]);
  return <p data-testid="scene-stats" ref={ref}
    className="absolute left-3 top-2 rounded bg-black/50 px-2 py-1 text-[11px] text-ink-dim" />;
}
