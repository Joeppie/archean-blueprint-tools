// Viewport.tsx — thin React host for the headless Engine. React owns mount/
// resize/blueprint-load ONLY; scene graph, pick and render cadence stay in
// the engine (60 fps path never runs through the reconciler).
// Test hooks land on window.__ARCHEAN__ (same philosophy as the legacy
// title/#out reporting): stats/pick are assertable without pixels.
import { useEffect, useRef } from 'react';
import { buildPartBoxes, type Manifest } from '../engine/compparts';
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

let manifestP: Promise<Manifest | null> | null = null;
function getManifest(): Promise<Manifest | null> {
  return manifestP ??= fetch('/models/manifest.json')
    .then(r => r.ok ? r.json() as Promise<Manifest> : null).catch(() => null);
}

export default function Viewport({ bp, onPick }: { bp: Blueprint | null; onPick: (h: PickHit) => void }) {
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
    return () => { ro.disconnect(); engine.dispose(); window.__ARCHEAN__ = undefined; };
  }, []);

  useEffect(() => {
    if (!bp) return;
    let dead = false;
    (async () => {
      const parts = buildPartBoxes(bp, await getManifest());
      if (!dead) engineRef.current?.load(bp, parts);
    })().catch(console.error);
    return () => { dead = true; };
  }, [bp]);

  return (
    <div className="relative h-full w-full" data-testid="viewport">
      <canvas ref={canvasRef} data-testid="canvas" className="block h-full w-full"
        onPointerDown={e => engineRef.current && onPick(engineRef.current.pickAt(e.clientX, e.clientY))} />
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
          ref.current.textContent = `blocks=${s.blocks} tris=${s.tris} hull=${s.hullTris} comps=${s.comps} draws=${s.draws}`;
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
    className="absolute bottom-2 left-3 rounded bg-black/50 px-2 py-1 text-[11px] text-ink-dim" />;
}
