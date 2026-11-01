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
import { useEffect, useMemo, useRef, useState } from 'react';
import FloatingWindow from './FloatingWindow';
import type { Blueprint } from '../engine/format';
import type { Engine } from '../engine/scene';
import { xenonComputers, xenonFarm, xenonHudControllers, type XenonComputer } from '../engine/xenoncode';
import { hudPump } from '../engine/hudpump';
import { GAME_HUD_LAW, GAME_IPC_LAW, GAME_POWER_LAW, type ReportCompute } from '../engine/xcgraph';
import { peekManifest } from '../engine/models';
import { massModel } from '../engine/mass';
import { buildCost, loadEconomy, materialQty, type Economy } from '../engine/economy';
import { flightLab } from '../engine/flightlab';
import { buildAnalysisHtml, codeRundown, craftIsFlyable, svgTextOnly, xcDiagrams,
  type ReportSection, type XcDiagram } from '../engine/xcgraph';

const G0 = 9.80665;    // the craft's weight = mass · g (the header card, v1.17.2)

/** A diagram you can actually MOVE (v1.17.1, we: "I cannot navigate or
 *  move through the diagrams properly"): wheel zoom, drag pan, −/+ /
 *  reset buttons and a ⤢ overlay that takes the whole analysis window. */
function DiagramView(p: { svg: string }) {
  const [k, setK] = useState(1);
  const [big, setBig] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  // FIT-ON-OPEN (v1.17.1, we: "cannot navigate or move through the diagrams"):
  // a diagram wider/taller than its panel opens FITTED, not cut off.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const svg = el.querySelector('svg');
    if (!svg) return;
    const fit = () => {
      const w = svg.getBoundingClientRect().width / (k || 1), h = svg.getBoundingClientRect().height / (k || 1);
      // never smaller than READABLE (0.45) — a huge map then opens at its
      // top, and the pan/zoom tools walk it; unreadable-fit helps nobody
      const k0 = Math.max(0.45, Math.min(1, (el.clientWidth - 12) / Math.max(1, w),
        (el.clientHeight - 12) / Math.max(1, h)));
      if (k0 < 0.98) { setK(+k0.toFixed(3)); el.scrollTo({ left: 0, top: 0 }); }
    };
    // measure at scale 1 first
    requestAnimationFrame(fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.svg, big]);
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
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto rounded bg-white" style={{ cursor: 'grab' }}
        onWheel={e => setK(x => Math.min(6, Math.max(0.2, x * (e.deltaY < 0 ? 1.15 : 0.87))))}
        onPointerDown={e => { drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; }}
        onPointerMove={e => { const d = drag.current; if (!d) return;
          setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }); }}
        onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; }}
        dangerouslySetInnerHTML={{ __html: `<div style="transform:translate(${pan.x}px,${pan.y}px) scale(${k});transform-origin:0 0;width:max-content">${p.svg}</div>` }} />
    </div>);
  if (!big) return <div className="h-[500px] w-full max-w-[1200px]">{box}</div>;
  return <div className="absolute inset-0 z-20 flex flex-col bg-[#0b1220]/[.97] p-2">{box}</div>;
}

type MermaidLike = { initialize: (o: Record<string, unknown>) => void;
  render: (id: string, text: string) => Promise<{ svg: string }> };

export default function AnalysisWindow(p: { craft: string; bp: Blueprint;
  engine: Engine | null; close: () => void }) {
  const [svgs, setSvgs] = useState<Record<string, string>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [plates, setPlates] = useState<Record<number,
    { top: string; front: string; side: string }>>({});
  const [busy, setBusy] = useState(false);
  // mermaid lives in STATE (a ref never re-fires the render effect — the
  // first-cut catch: the diagram effect ran once before the runtime loaded
  // and never again).
  const [mm, setMm] = useState<MermaidLike | null>(null);
  const [shotErr, setShotErr] = useState('');
  const comps: XenonComputer[] = p.bp ? xenonComputers(p.bp) : [];
  // v1.17.1: HUDs join the analysis — same grammar, DIFFERENT limits law
  // (client runtime, no server budget — wiki hud.md; we: "huds run on
  // client and have virtually no limitations").
  const huds = p.bp ? xenonHudControllers(p.bp) : [];
  type Sel = { kind: 'cpu' | 'hud'; ci: number };
  const [sel, setSel] = useState<Sel>({ kind: 'cpu', ci: -1 });
  const curKey = sel.ci >= 0 ? sel : { kind: 'cpu' as const, ci: comps[0]?.ci ?? huds[0]?.ci ?? -1 };
  const curCpu = curKey.kind === 'cpu' ? comps.find(c => c.ci === curKey.ci) ?? comps[0] ?? null : null;
  const curHud = curKey.kind === 'hud' ? huds.find(h => h.ci === curKey.ci) ?? null
    : curKey.kind === 'cpu' && !curCpu ? huds[0] ?? null : null;
  const cur = curCpu ?? curHud;
  const curIsHud = !curCpu && !!curHud;
  const diagrams: XcDiagram[] = cur
    ? xcDiagrams({ alias: cur.alias || `#${cur.ci}`, ci: cur.ci,
      files: cur.files.map(f => ({ name: f.name, code: f.code })), devices: curIsHud ? [] : curCpu!.devices })
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
    if (!eng || !curCpu || plates[curCpu.ci]) return;
    // THE PLATE SHOWS THE DIAGRAM'S OWN WORLD (v1.17.1, we: "Nothing
    // visible in vesel overviews"): the actors are the devices THIS program
    // actually cables (the rundown's fan-in), NOT only aliased ones — most
    // craft address parts by raw io port and have no aliases at all.
    const rd = codeRundown({ alias: curCpu.alias || `#${curCpu.ci}`, ci: curCpu.ci,
      files: curCpu.files.map(f => ({ name: f.name, code: f.code })), devices: curCpu.devices });
    const touched = new Set(rd.fanIn.map(x => x.device));
    const devs = curCpu.devices.filter(d => d.ci !== undefined);
    const picked = devs.filter(d => touched.has(d.alias || `io ${d.io}`));
    const actorsSrc = (picked.length ? picked : devs).slice(0, 12);
    const actors = actorsSrc.map(d => ({
      ci: d.ci!, tag: `${d.alias || `${d.type} #${d.ci}`} · io ${d.io}` }));
    // retry while the scene is still building (EMPTY-FLAG, v1.17.1)
    let tries = 0;
    const go = () => {
      eng.analysisShots({ actors })
        .then(ph => {
          if (ph.empty && tries++ < 2) { setTimeout(go, 2500); return; }
          setPlates(x => ({ ...x, [curCpu!.ci]: ph }));
        })
        .catch(e => setShotErr(String(e).slice(0, 120)));
    };
    go();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.engine, curCpu?.ci]);

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
  // THE CRAFT HEADER (v1.17.2, we: "weight, costs and flight characteristics
  // should be higher up in the analysis"): the mass model + the build-cost
  // twin ride the SAME twins the Info/Build-cost widgets use, computed at
  // the TOP of the reading — both are whole-craft censuses, so memo them
  // on (bp, manifest, economy) and share them between dialog and export.
  const [econ, setEcon] = useState<Economy | null>(null);
  useEffect(() => { let dead = false; loadEconomy().then(e => { if (!dead) setEcon(e); });
    return () => { dead = true; }; }, []);
  const massKg = p.bp ? massModel(p.bp, peekManifest()).total : 0;
  const cost = useMemo(() => (econ && p.bp ? buildCost(econ, p.bp) : null),
    [econ, p.bp, maniTick]);
  const summary = { massKg, weightN: massKg * G0,
    costRaw: cost ? Math.round(materialQty(cost.total)) : undefined,
    costTime: cost?.total.time };
  const reportSections: ReportSection[] = [
    ...comps.map(c => reportSectionFor(c.ci, false, c.alias || `#${c.ci}`,
      c.files.map(f => ({ name: f.name, code: f.code })), c.devices)),
    ...huds.map(h => reportSectionFor(h.ci, true, h.alias || `#${h.ci}`,
      h.files.map(f => ({ name: f.name, code: f.code })), [])),
  ];
  function reportSectionFor(cid: number, isHud: boolean, alias: string,
    files: { name: string; code: string }[], devices: XenonComputer['devices']): ReportSection {
    const ds = xcDiagrams({ alias, ci: cid, files, devices });
    const pump = isHud ? null : xenonFarm.pumps.find(q => q.comp?.ci === cid);
    return {
      compAlias: (isHud ? '📟 ' : '') + alias,
      plateTop: isHud ? undefined : plates[cid]?.top,
      plateFront: isHud ? undefined : plates[cid]?.front,
      plateSide: isHud ? undefined : plates[cid]?.side,
      diagrams: ds,
      svgs: ds.map(d => svgs[`${cid}|${d.kind}`] ?? null),
      rundown: codeRundown({ alias, ci: cid, files, devices }),
      compute: isHud
        ? { alias, isHud: true, workEma: hudPump.workEma, samples: hudPump.workSamples, live: hudPump.running }
        : { alias, isHud: false, workEma: pump?.workEma ?? null, samples: pump?.workSamples ?? 0,
            live: pump?.status === 'running' },
    };
  }


  const exportHtml = () => {
    const html = buildAnalysisHtml({
      craft: p.craft, sections: reportSections, summary,
      flight: flight ? {
        speed: flight.speed, mass: flight.mass, stallSpeed: flight.stallSpeed,
        ldMax: flight.ldMax, staticMarginPct: flight.staticMarginPct,
        pitchVerdict: flight.pitchVerdict, yawVerdict: flight.yawVerdict,
        rows: flight.authority.rows.map(r => ({ axis: r.axis, part: `${r.type} #${r.ci}`,
          authority: r.nm, buried: r.buried })),
        altitude: flight.altitude, rho: flight.rho, q: flight.q, weight: flight.weight,
        planform: { S: flight.planform.S, span: flight.planform.span, chord: flight.planform.chord,
          AR: flight.planform.AR, zAc: flight.planform.zAc },
        clAlpha: flight.clAlpha, clMax: flight.clMax, cd0: flight.cd0, kInd: flight.kInd,
        ldTrim: flight.ldTrim, trimAlphaDeg: flight.trimAlphaDeg,
        trimElevatorDeg: flight.trimElevatorDeg, neutralZ: flight.neutralZ,
        frontal: flight.frontal, fin: { area: flight.finArea, lever: flight.finLever },
        curve: flight.curve.map(c => ({ alphaDeg: c.alphaDeg, cl: c.cl, cd: c.cd })),
      } : null,
    });
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const a = document.createElement('a');
    a.href = url; a.download = `craft-${p.craft}-analysis.html`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  return (
    <FloatingWindow id="analysis" testid="analysis-dock" fullNarrow
      initial={(vw, vh) => { const w = Math.min(1280, vw - 40);
        return { x: Math.max(20, (vw - w) / 2), y: 30, w, h: vh - 60 }; }}
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
        {(comps.length + huds.length) > 1 && (
          <div className="flex flex-wrap gap-1">
            {comps.map(c => (
              <button key={`c${c.ci}`} data-testid={`analysis-comp-${c.ci}`}
                className={`ksp-btn px-2 py-1 text-[11px] ${cur?.ci === c.ci && !curIsHud
                  ? 'text-[#7dffcf] border-[#7dffcf]/50' : ''}`}
                onClick={() => setSel({ kind: 'cpu', ci: c.ci })}>{c.alias || `#${c.ci}`}</button>
            ))}
            {huds.map(h => (
              <button key={`h${h.ci}`} data-testid={`analysis-hud-${h.ci}`}
                className={`ksp-btn px-2 py-1 text-[11px] ${cur?.ci === h.ci && curIsHud
                  ? 'text-[#ffd479] border-[#ffd479]/50' : ''}`}
                title="HUD program — client runtime, NO server compute budget (wiki hud.md)"
                onClick={() => setSel({ kind: 'hud', ci: h.ci })}>📟 {h.alias || `#${h.ci}`}</button>
            ))}
          </div>
        )}
        {errs['*'] && <div className="rounded bg-[#3a1420] p-2 text-[11px] text-[#ffb4b4]"
          data-testid="analysis-mermaid-err">{errs['*']}</div>}
        <section data-testid="analysis-summary" className="max-w-[1160px] rounded border
          border-[#22314a] bg-[#0e1626] p-3 text-[12px] text-[#c8d4e4]">
          {/* THE CRAFT HEADER FIRST (v1.17.2, we: "weight, costs and flight
              characteristics should be higher up in the analysis") */}
          <div className="flex flex-wrap gap-x-8 gap-y-1 tabular-nums">
            <span><span className="text-[#8b93a1]">mass</span>{' '}
              <b>{massKg.toFixed(0)} kg</b></span>
            <span><span className="text-[#8b93a1]">weight</span>{' '}
              <b>{summary.weightN.toFixed(0)} N</b></span>
            <span><span className="text-[#8b93a1]">build cost</span>{' '}
              <b>{summary.costRaw === undefined ? '…'
                : `${summary.costRaw.toLocaleString('en-US')} raw material units`}</b>
              {summary.costTime
                ? <span className="text-[#8b93a1]"> · build {Math.round(summary.costTime / 60)} min</span>
                : null}</span>
            {flight && <span><span className="text-[#8b93a1]">stall</span>{' '}
              <b>{flight.stallSpeed.toFixed(1)} m/s</b></span>}
            {flight && <span><span className="text-[#8b93a1]">L/D max</span>{' '}
              <b>{flight.ldMax.toFixed(1)}</b></span>}
            {flight && <span><span className="text-[#8b93a1]">static margin</span>{' '}
              <b>{flight.staticMarginPct.toFixed(1)} % MAC</b> → pitch{' '}
              <b>{flight.pitchVerdict}</b>, yaw <b>{flight.yawVerdict}</b></span>}
          </div>
        </section>
        <section data-testid="analysis-flight" className="max-w-[1160px]">
          <h3 className="m-0 mb-1 text-[12px] font-medium text-[#e8edf4]">Flight characteristics</h3>
          {flight ? (
            <div className="text-[12px] text-[#c8d4e4]" data-testid="analysis-flight-report">
              mass {flight.mass.toFixed(0)} kg · weight {flight.weight.toFixed(0)} N ·
              stall {flight.stallSpeed.toFixed(1)} m/s ·
              L/D max {flight.ldMax.toFixed(1)} · static margin {flight.staticMarginPct.toFixed(1)}
              % MAC → pitch <b>{flight.pitchVerdict}</b>, yaw <b>{flight.yawVerdict}</b>.
              <div className="mt-0.5 text-[#a7b6c9]">
                S {flight.planform.S.toFixed(2)} m² · span {flight.planform.span.toFixed(2)} m ·
                c̄ {flight.planform.chord.toFixed(2)} m · AR {flight.planform.AR.toFixed(2)} ·
                C<sub>Lα</sub> {flight.clAlpha.toFixed(2)}/rad · C<sub>Lmax</sub> {flight.clMax.toFixed(2)} ·
                C<sub>D0</sub> {flight.cd0.toFixed(4)} · K {flight.kInd.toFixed(3)} ·
                trim {(flight.trimAlphaDeg ?? 0).toFixed(1)}° AoA
                {flight.trimElevatorDeg !== null ? `, elevator ${flight.trimElevatorDeg.toFixed(1)}°` : ''} ·
                q {flight.q.toFixed(0)} Pa @ {flight.altitude} m
              </div>
              {flight.authority.rows.length > 0 && (
                <div className="mt-1 text-[11px] text-[#a7b6c9]" data-testid="analysis-authority">
                  {flight.authority.rows.map(r => (
                    <span key={r.ci} className="mr-4 inline-block whitespace-nowrap">
                      <span className="text-[#8b93a1]">{r.axis}</span> {r.type} #{r.ci}
                      {' '}<b className="tabular-nums">{r.nm.toFixed(0)} N·m</b>
                      {r.buried && ' ⚠'}
                    </span>))}
                </div>)}
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
        {cur && (
          <>
            {(() => {
              const ph = plates[cur.ci];
              // v1.17.2 (we: "the diagrams should have a front/side/top
              // diagram"): the plate pair became the THREE-VIEW trio —
              // front, side, topside at one isotropic scale, actors solid,
              // their cables lit, colour-rotated leader labels.
              return ph && (
              <div data-testid="analysis-plates" className="flex max-w-[1160px] flex-wrap gap-2">
                {([['front (nose −z)', ph.front], ['side (starboard)', ph.side], ['topside', ph.top]] as const)
                  .map(([k, src]) => (
                    <figure key={k} className="m-0">
                      <img src={src} width={380}
                        className="max-w-[32vw] rounded-md border border-[#22314a]"
                        alt={`vessel ${k}`} />
                      <figcaption className="text-[10px] text-[#8b93a1]">{k} · wireframe,
                        actors solid, cabled runs amber + io tags,
                        leader-line labels</figcaption>
                    </figure>
                  ))}
              </div>
            ); })()}
            {(() => {
              const pump = curIsHud ? null : xenonFarm.pumps.find(q => q.comp?.ci === cur.ci);
              const compute: ReportCompute = curIsHud
                ? { alias: cur.alias || `#${cur.ci}`, isHud: true,
                    workEma: hudPump.workEma, samples: hudPump.workSamples, live: hudPump.running }
                : { alias: cur.alias || `#${cur.ci}`, isHud: false,
                    workEma: pump?.workEma ?? null, samples: pump?.workSamples ?? 0,
                    live: pump?.status === 'running' };
              return (
                <section data-testid="analysis-compute" className="max-w-[1160px] rounded border
                  border-[#22314a] bg-[#0e1626] p-2 text-[11px] leading-relaxed text-[#c8d4e4]">
                  <span className="font-medium text-[#e8edf4]">Compute budget</span> — measured
                  work{' '}
                  <b className="tabular-nums">{compute.workEma === null
                    ? 'n/a (engine predates the census seam)'
                    : `${compute.workEma.toFixed(0)} IPC units/cycle`}
                  </b>{compute.workEma !== null && ` (EMA over ${compute.samples} cycles${compute.live ? ', running' : ''})`}
                  <div className="mt-1 text-[#8b93a1]">
                    {curIsHud ? GAME_HUD_LAW : `${GAME_IPC_LAW} · ${GAME_POWER_LAW}`}
                  </div>
                </section>);
            })()}
            {(() => { const rd = codeRundown({ alias: cur.alias || `#${cur.ci}`, ci: cur.ci,
              files: cur.files.map(f => ({ name: f.name, code: f.code })), devices: curIsHud ? [] : curCpu!.devices });
              return (
                <section data-testid="analysis-rundown" className="max-w-[1160px]">
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
                <section key={d.kind}
                  data-testid={`analysis-${d.kind === 'seqIn' ? 'seqin' : d.kind === 'seqOut' ? 'seqout' : d.kind}`}>
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
          </>
        )}
      </div>
    </FloatingWindow>
  );
}
