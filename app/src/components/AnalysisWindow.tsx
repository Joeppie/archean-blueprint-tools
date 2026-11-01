// AnalysisWindow.tsx — THE CRAFT ANALYSIS (v1.17.0, we: "let our editor
// automatically make a mermaid diagram of the xenoncode and display that
// … above each sequence diagram render a PNG of the vessel, topside, from
// front, orthographic, the labels … for only relevant actors … highlighted,
// wireframe on, view zoomed, also wire highlighted between, Io number
// … essentially mermaid html should read like a detailed analysis of
// craft. Flight characteristics … optional of course, not logical for a
// rover or for Mario").
//
// A lazy chunk: the MERMAID RUNTIME is imported on open (never in the boot
// path). Per programmable computer: the vessel plate pair (engine.analysis-
// Shots — actors amber, cables between them amber with io tags) above the
// sequence diagram, then flow and class (sources from engine/xcgraph). The
// ⬇ HTML button exports the whole reading as one self-contained document
// (engine/xcgraph buildAnalysisHtml). The FLIGHT section appears only when
// the craft carries flight surfaces (craftIsFlyable) — Mario cabinets and
// rovers get an honest 'not applicable' line instead of theatre.
import { useEffect, useRef, useState } from 'react';
import FloatingWindow from './FloatingWindow';
import type { Blueprint } from '../engine/format';
import type { Engine } from '../engine/scene';
import { xenonComputers, type XenonComputer } from '../engine/xenoncode';
import { peekManifest } from '../engine/models';
import { flightLab } from '../engine/flightlab';
import { buildAnalysisHtml, codeRundown, craftIsFlyable, svgTextOnly, xcDiagrams,
  type ReportSection, type XcDiagram } from '../engine/xcgraph';

/** A diagram you can actually MOVE (v1.17.1, we: "I cannot navigate or
 *  move through the diagrams properly"): wheel zoom, drag pan, −/+ /
 *  reset buttons and a ⤢ overlay that takes the whole analysis window. */
function DiagramView(p: { svg: string }) {
  const [k, setK] = useState(1);
  const [big, setBig] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const box = (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 pb-1 text-[10px]">
        <button className="ksp-btn px-1.5" data-testid="analysis-zoom-out"
          onClick={() => setK(x => Math.max(0.2, x * 0.8))}>−</button>
        <span className="w-11 text-center tabular-nums text-[#8b93a1]"
          data-testid="analysis-zoom-k">{Math.round(k * 100)}%</span>
        <button className="ksp-btn px-1.5" data-testid="analysis-zoom-in"
          onClick={() => setK(x => Math.min(6, x * 1.25))}>+</button>
        <button className="ksp-btn px-1.5" data-testid="analysis-zoom-reset"
          onClick={() => { setK(1); setPan({ x: 0, y: 0 }); }}>reset</button>
        <button className="ksp-btn px-1.5 ml-auto" data-testid="analysis-zoom-max"
          onClick={() => setBig(x => !x)}
          title="use the whole analysis window">{big ? '⤡' : '⤢'}</button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded bg-white" style={{ cursor: 'grab' }}
        onWheel={e => setK(x => Math.min(6, Math.max(0.2, x * (e.deltaY < 0 ? 1.15 : 0.87))))}
        onPointerDown={e => { drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; }}
        onPointerMove={e => { const d = drag.current; if (!d) return;
          setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }); }}
        onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; }}
        dangerouslySetInnerHTML={{ __html: `<div style="transform:translate(${pan.x}px,${pan.y}px) scale(${k});transform-origin:0 0;width:max-content">${p.svg}</div>` }} />
    </div>);
  if (!big) return <div className="h-[340px] max-w-[980px]">{box}</div>;
  return <div className="absolute inset-0 z-20 flex flex-col bg-[#0b1220]/[.97] p-2">{box}</div>;
}

type MermaidLike = { initialize: (o: Record<string, unknown>) => void;
  render: (id: string, text: string) => Promise<{ svg: string }> };

export default function AnalysisWindow(p: { craft: string; bp: Blueprint;
  engine: Engine | null; close: () => void }) {
  const [ci, setCi] = useState<number | null>(null);
  const [svgs, setSvgs] = useState<Record<string, string>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [plates, setPlates] = useState<Record<number, { top: string; front: string }>>({});
  const [busy, setBusy] = useState(false);
  // mermaid lives in STATE (a ref never re-fires the render effect — the
  // first-cut catch: the diagram effect ran once before the runtime loaded
  // and never again).
  const [mm, setMm] = useState<MermaidLike | null>(null);
  const [shotErr, setShotErr] = useState('');
  const comps: XenonComputer[] = p.bp ? xenonComputers(p.bp) : [];
  const cur = comps.find(c => c.ci === (ci ?? comps[0]?.ci)) ?? comps[0] ?? null;
  const diagrams: XcDiagram[] = cur
    ? xcDiagrams({ alias: cur.alias || `#${cur.ci}`, ci: cur.ci,
      files: cur.files.map(f => ({ name: f.name, code: f.code })), devices: cur.devices })
    : [];

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const m = (await import('mermaid')).default as unknown as MermaidLike;
        // v1.17.1 (we: "SVG doesn't render images"): htmlLabels OFF —
        // mermaid's default HTML labels are <foreignObject>, which renders
        // nothing once the SVG is exported/copied; useMaxWidth=false stops
        // the width-collapse that made big diagrams unusable. Pure SVG
        // text renders everywhere, always.
        m.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'dark',
          flowchart: { htmlLabels: false, useMaxWidth: false },
          class: { useMaxWidth: false },
          sequence: { showSequenceNumbers: false, actorMargin: 42, useMaxWidth: false },
          themeVariables: { fontSize: '13px' } });
        if (!dead) setMm(m);
      } catch { if (!dead) setErrs({ '*': 'mermaid runtime failed to load' }); }
    })();
    return () => { dead = true; };
  }, []);

  // render the CURRENT computer's diagrams through the mermaid runtime
  useEffect(() => {
    if (!mm || !cur) return;
    let dead = false;
    setBusy(true);
    (async () => {
      for (const d of diagrams) {
        const id = `${cur.ci}|${d.kind}`;
        try {
          const { svg } = await mm.render(`xmm-${cur.ci}-${d.kind}-${Math.floor(performance.now())}`,
            d.source);
          // the svg cache is ADDITIVE: a valid render stays valid no
          // matter which effect run completed (a `dead` gate here lost
          // every svg to the mount-time StrictMode double-run — the
          // v1.17.0 catch: diagrams rendered but never appeared).
          // PURE SVG before it enters state: the dialog, the export and
          // every copied file share one pure-vector truth (§ Pure-SVG law).
          const pure = svgTextOnly(svg);
          setSvgs(s2 => (s2[id] ? s2 : { ...s2, [id]: pure }));
        } catch (e) {
          setErrs(x => ({ ...x, [id]: String(e).slice(0, 160) }));
        }
      }
      if (!dead) setBusy(false);
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mm, cur?.ci, diagrams.length]);

  // the vessel plate for the CURRENT computer: actors = its cabled devices
  useEffect(() => {
    const eng = p.engine;
    if (!eng || !cur || plates[cur.ci]) return;
    const actors = cur.devices
      .filter(d => d.ci !== undefined && d.alias)
      .map(d => ({ ci: d.ci!, tag: `${d.alias} · io ${d.io}` }));
    eng.analysisShots({ actors }).then(ph => setPlates(x => ({ ...x, [cur.ci]: ph })))
      .catch(e => setShotErr(String(e).slice(0, 120)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.engine, cur?.ci]);

  // THE MANIFEST TIMING (models load async): the flight section recomputes
  // until the manifest lands, then freezes.
  const flyable = craftIsFlyable(p.bp);
  const [maniTick, setManiTick] = useState(0);
  useEffect(() => {
    if (!flyable || peekManifest()) return;
    const t = setInterval(() => setManiTick(x => x + 1), 700);
    return () => clearInterval(t);
  }, [flyable, maniTick]);
  const flight = flyable ? flightLab(p.bp, peekManifest()) : null;
  const buriedNames = (flight?.authority.rows ?? []).filter(r => r.buried)
    .map(r => `${r.type} #${r.ci}`);
  const reportSections: ReportSection[] = comps.map(c => {
    const ds = xcDiagrams({ alias: c.alias || `#${c.ci}`, ci: c.ci,
      files: c.files.map(f => ({ name: f.name, code: f.code })), devices: c.devices });
    return {
      compAlias: c.alias || `#${c.ci}`,
      plateTop: plates[c.ci]?.top, plateFront: plates[c.ci]?.front,
      diagrams: ds,
      svgs: ds.map(d => svgs[`${c.ci}|${d.kind}`] ?? null),
      rundown: codeRundown({ alias: c.alias || `#${c.ci}`, ci: c.ci,
        files: c.files.map(f => ({ name: f.name, code: f.code })), devices: c.devices }),
    };
  });

  const exportHtml = () => {
    const html = buildAnalysisHtml({
      craft: p.craft, sections: reportSections,
      flight: flight ? {
        speed: flight.speed, mass: flight.mass, stallSpeed: flight.stallSpeed,
        ldMax: flight.ldMax, staticMarginPct: flight.staticMarginPct,
        pitchVerdict: flight.pitchVerdict, yawVerdict: flight.yawVerdict,
        rows: flight.authority.rows.map(r => ({ axis: r.axis, part: `${r.type} #${r.ci}`,
          authority: r.nm, buried: r.buried })),
      } : null,
    });
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const a = document.createElement('a');
    a.href = url; a.download = `craft-${p.craft}-analysis.html`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  return (
    <FloatingWindow id="analysis" testid="analysis-dock" fullNarrow
      initial={(vw, vh) => ({ x: Math.max(20, vw / 2 - 520), y: 40, w: Math.min(1040, vw - 80), h: vh - 90 })}
      header={
        <span className="flex items-center gap-2">
          <span data-testid="analysis-title">⚗ Analysis — {p.craft}</span>
          <button data-testid="analysis-export" className="ksp-btn px-2 py-0.5 text-[11px]"
            onClick={exportHtml} title="download the whole reading as one HTML document">
            ⬇ HTML
          </button>
          <button data-testid="analysis-close" className="ksp-btn px-2 py-0.5 text-[11px] ml-auto"
            onClick={p.close}>✕</button>
        </span>
      }>
      <div className="tool-scroll flex h-[calc(100%-42px)] flex-col gap-3 overflow-auto p-3"
        data-testid="analysis-body">
        {comps.length === 0 && <div className="text-[#8b93a1] text-[12px]">
          No programmable computer on this craft — nothing to diagram.</div>}
        {comps.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {comps.map(c => (
              <button key={c.ci} data-testid={`analysis-comp-${c.ci}`}
                className={`ksp-btn px-2 py-1 text-[11px] ${cur?.ci === c.ci
                  ? 'text-[#7dffcf] border-[#7dffcf]/50' : ''}`}
                onClick={() => setCi(c.ci)}>{c.alias || `#${c.ci}`}</button>
            ))}
          </div>
        )}
        {errs['*'] && <div className="rounded bg-[#3a1420] p-2 text-[11px] text-[#ffb4b4]"
          data-testid="analysis-mermaid-err">{errs['*']}</div>}
        {cur && (
          <>
            {(() => { const ph = plates[cur.ci]; return ph && (
              <div data-testid="analysis-plates" className="flex flex-wrap gap-3">
                {([['topside', ph.top], ['front', ph.front]] as const)
                  .map(([k, src]) => (
                    <figure key={k} className="m-0">
                      <img src={src} width={430}
                        className="max-w-[44vw] rounded-md border border-[#22314a]"
                        alt={`vessel ${k}`} />
                      <figcaption className="text-[10px] text-[#8b93a1]">{k} · wireframe,
                        actors amber, cabled runs amber + io tags</figcaption>
                    </figure>
                  ))}
              </div>
            ); })()}
            {(() => { const rd = codeRundown({ alias: cur.alias || `#${cur.ci}`, ci: cur.ci,
              files: cur.files.map(f => ({ name: f.name, code: f.code })), devices: cur.devices });
              return (
                <section data-testid="analysis-rundown" className="max-w-[900px]">
                  <h3 className="m-0 mb-1 text-[12px] font-medium text-[#e8edf4]">Code structure</h3>
                  <ul className="m-0 list-disc pl-5 text-[11px] leading-relaxed text-[#c8d4e4]">
                    {rd.summary.map((b, i) => <li key={i}>{b}</li>)}
                  </ul>
                  {rd.fanIn.length > 0 && (
                    <table className="mt-2 text-[11px]">
                      <thead><tr className="text-[#8b93a1]"><th className="pr-4 text-left">device</th>
                        <th className="pr-4 text-left">type</th><th className="pr-4">reads</th>
                        <th className="pr-4">writes</th></tr></thead>
                      <tbody>{rd.fanIn.map((x, i) => (
                        <tr key={i} className="text-[#c8d4e4]"><td className="pr-4">{x.device}</td>
                          <td className="pr-4 text-[#8b93a1]">{x.type}</td>
                          <td className="pr-4 text-center">{x.readers || ''}</td>
                          <td className="pr-4 text-center">{x.writers || ''}</td></tr>))}
                      </tbody></table>)}
                  {rd.files.map(f => f.functions.length > 0 && (
                    <details key={f.name} className="mt-1 text-[11px]">
                      <summary className="cursor-pointer text-[#9fb0c8]">functions of {f.name}</summary>
                      <div className="pl-3 text-[#c8d4e4]">
                        {f.functions.map(fn => (
                          <div key={fn.name} className="font-mono">@{fn.name}({fn.args})
                            {fn.ret ? `: ${fn.ret}` : ''} <span className="text-[#8b93a1]">
                            · {fn.lines} lines{fn.calls.length ? ` · calls @${fn.calls.join(', @')}` : ''}</span></div>))}
                      </div></details>))}
                </section>); })()}
            {busy && <div className="text-[11px] text-[#8b93a1]">rendering diagrams…</div>}
            {shotErr && <div className="text-[11px] text-[#ffb4b4]" data-testid="analysis-shot-err">
              plate: {shotErr}</div>}
            {diagrams.map(d => {
              const id = `${cur.ci}|${d.kind}`;
              return (
                <section key={d.kind} data-testid={`analysis-${d.kind}`}>
                  <h3 className="m-0 mb-1 text-[12px] font-medium text-[#e8edf4]">{d.title}</h3>
                  {errs[id]
                    ? <div className="rounded bg-[#3a1420] p-2 text-[11px] text-[#ffb4b4]"
                        data-testid={`analysis-error-${d.kind}`}>mermaid: {errs[id]}</div>
                    : svgs[id]
                      ? <DiagramView svg={svgs[id]!} />
                      : <div className="text-[11px] text-[#8b93a1]">…</div>}
                  <details className="mt-1"><summary className="cursor-pointer text-[11px] text-[#8b93a1]">
                    mermaid source</summary>
                    <pre className="max-h-52 overflow-auto rounded bg-[#101a2b] p-2 text-[10px]
                      text-[#b7c6dd]">{d.source}</pre></details>
                </section>
              );
            })}
            <section data-testid="analysis-flight">
              <h3 className="m-0 mb-1 text-[12px] font-medium text-[#e8edf4]">Flight characteristics</h3>
              {flight ? (
                <div className="text-[12px] text-[#c8d4e4]" data-testid="analysis-flight-report">
                  mass {flight.mass.toFixed(0)} kg · stall {flight.stallSpeed.toFixed(1)} m/s ·
                  L/D max {flight.ldMax.toFixed(1)} · static margin {flight.staticMarginPct.toFixed(1)}
                  % MAC → pitch <b>{flight.pitchVerdict}</b>, yaw <b>{flight.yawVerdict}</b>.
                  <div className="mt-1 text-[11px] text-[#8b93a1]">Closed-form shape-field analysis —
                    NOT CFD: no Navier–Stokes field solve runs in the editor (docs/CFD-FEASIBILITY.md);
                    vortex/shedding needs an external solver.</div>
                  {buriedNames.length > 0 && (
                    <div className="mt-1 rounded bg-[#3a2415] p-2 text-[11px] text-[#ffcf9d]">
                      ⚠ buried control surface: {buriedNames.join(', ')} — inside the collider
                      mass, it reads ≈ no authority (drag/interference suspect).</div>
                  )}
                </div>
              ) : (
                <div className="text-[11px] text-[#8b93a1]">Not applicable — no flight-control
                  surfaces on this craft (rover/cabinet logic).</div>
              )}
            </section>
          </>
        )}
      </div>
    </FloatingWindow>
  );
}
