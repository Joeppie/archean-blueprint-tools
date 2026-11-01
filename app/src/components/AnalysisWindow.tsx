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
import { GAME_HUD_LAW, GAME_IPC_LAW, GAME_POWER_LAW, groupLabel, type ReportCompute } from '../engine/xcgraph';
import { peekManifest } from '../engine/models';
import { massModel } from '../engine/mass';
import { envelopeVolume, liftKg, sealedEnvelopeVolume } from '../engine/atmo';
import { buildCost, loadEconomy, materialQty, type Economy } from '../engine/economy';
import { flightLab } from '../engine/flightlab';
import { buildAnalysisHtml, codeRundown, craftIsFlyable, svgTextOnly, xcDiagrams,
  type ReportSection, type XcDiagram } from '../engine/xcgraph';
import { flatToTopMap, flatEndpointTop } from '../engine/flat';

const G0 = 9.80665;    // the craft's weight = mass · g (the header card, v1.17.2)

/** A diagram you can actually MOVE (v1.17.1, we: "I cannot navigate or
 *  move through the diagrams properly"): wheel zoom, drag pan, −/+ /
 *  reset buttons and a ⤢ overlay that takes the whole analysis window. */
function DiagramView(p: { svg: string }) {
  const [k, setK] = useState(1);
  const [big, setBig] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: number } | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  // THE GALLERY LAW (v1.17.2, we: "when clicking SVG make full screen
  // like in a photo gallery … hard to get out of pictures now"):
  // a click (without drag) opens the fullscreen gallery; Esc, the
  // backdrop strip and ⤡ all close it; two-finger pinch zooms.
  useEffect(() => {
    if (!big) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setBig(false); } };
    addEventListener('keydown', h, true);
    return () => removeEventListener('keydown', h, true);
  }, [big]);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef(0);
  const pdist = () => {
    const [a, b] = [...ptrs.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  // THE SCROLL-OWNERSHIP LAW (v1.17.2, we: "scrolling down over the
  // diagrams zoom, that is not OK"): the plain wheel scrolls the page;
  // ZOOM is Ctrl/⌘+wheel. IN THE GALLERY (fullscreen, we: "at that point
  // scroll should zoom") the plain wheel zooms — the page behind is not
  // scrolling anyway. Native listener — React's root wheel is passive
  // and cannot preventDefault the browser zoom on ctrl+wheel.
  const bigRef = useRef(false);
  bigRef.current = big;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const h = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) && !bigRef.current) return;   // plain wheel → the page
      e.preventDefault();
      setK(x => Math.min(6, Math.max(0.2, x * (e.deltaY < 0 ? 1.15 : 0.87))));
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);
  // FIT-ON-OPEN: embedded fits to READ (≤ 1:1); THE GALLERY opens FILLED
  // (v1.17.2, we: "the zoomable version for the schematic it should zoom
  // in by default, not remain equally small").
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const svg = el.querySelector('svg');
    if (!svg) return;
    const fit = () => {
      const w = svg.getBoundingClientRect().width / (k || 1), h = svg.getBoundingClientRect().height / (k || 1);
      if (big) {
        const k0 = Math.max(0.5, Math.min(8, (el.clientWidth - 16) / Math.max(1, w),
          (el.clientHeight - 16) / Math.max(1, h)));
        setK(+k0.toFixed(3)); setPan({ x: 0, y: 0 });
        return;
      }
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
      {/* THE EDITOR-NAVY CARD (v1.17.2, we: "the color choice on diagrams
          doesnt work well, it should fit in with the rest of the editor"):
          the white board is GONE — diagrams ride the editor's own navy */}
      {/* THE GALLERY LAW: click (no drag) opens fullscreen; pinch zooms;
          in fullscreen the empty backdrop closes it (photo-gallery exit). */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto rounded border border-[#22314a] bg-[#101a2b]"
        style={{ cursor: big ? 'grab' : 'zoom-in', touchAction: big ? 'none' : 'pan-x pan-y' }}
        onPointerDown={e => {
          ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          if (ptrs.current.size === 2) pinch.current = pdist();
          else drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: 0 };
        }}
        onPointerMove={e => {
          if (!ptrs.current.has(e.pointerId)) return;
          ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (ptrs.current.size === 2) {
            const d = pdist();
            if (pinch.current > 0 && d > 0) setK(x => Math.min(6, Math.max(0.2, x * (d / pinch.current))));
            pinch.current = d;
            return;
          }
          const d = drag.current; if (!d) return;
          d.moved += Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y);
          setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y });
        }}
        onPointerUp={e => {
          ptrs.current.delete(e.pointerId);
          const d = drag.current;
          // CLICK = the gallery door (v1.17.2, we: "click should close
          // zoomed version"): a click (no drag) opens the sheet; in the
          // gallery the same click closes it.
          if (d && d.moved < 8) setBig(x => !x);
          drag.current = null;
        }}
        onPointerLeave={e => { ptrs.current.delete(e.pointerId); drag.current = null; }}
        dangerouslySetInnerHTML={{ __html: `<div style="transform:translate(${pan.x}px,${pan.y}px) scale(${k});transform-origin:0 0;width:max-content">${p.svg}</div>` }} />
    </div>);
  if (!big) return <div className="h-[420px] w-full max-w-[1400px]">{box}</div>;
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-[#050a14]/[.97] p-2"
      onClick={e => { if (e.target === e.currentTarget) setBig(false); }}>
      {box}
    </div>);
}

type MermaidLike = { initialize: (o: Record<string, unknown>) => void;
  render: (id: string, text: string) => Promise<{ svg: string }> };

export default function AnalysisWindow(p: { craft: string; bp: Blueprint;
  engine: Engine | null; close: () => void }) {
  const [svgs, setSvgs] = useState<Record<string, string>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [plates, setPlates] = useState<Record<number, { svgs: string[] }>>({});
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
          // THE EDITOR-NAVY DIAGRAM LANGUAGE (v1.17.2, we: "the color choice
          // on diagrams doesnt work well, it should fit in with the rest of
          // the editor"): mermaid rides the editor's own family — #101a2b
          // cards, #16233c node fills, #4b6a9b edges, #7dffcf pilot accents,
          // #e8edf4 text. No grey panels, no white.
          themeVariables: {
            background: '#101a2b', mainBkg: '#16233c', primaryColor: '#16233c',
            primaryTextColor: '#e8edf4', primaryBorderColor: '#4b6a9b',
            secondaryColor: '#13233c', tertiaryColor: '#0f2233',
            lineColor: '#7a93b8', textColor: '#e8edf4', nodeBorder: '#4b6a9b',
            clusterBkg: '#0f1a2e', clusterBorder: '#22314a',
            actorBkg: '#0f2233', actorBorder: '#7dffcf', actorTextColor: '#e8edf4',
            actorLineColor: '#7a93b8', signalColor: '#c8d4e4', signalTextColor: '#c8d4e4',
            labelBoxBkgColor: '#13233c', labelBoxBorderColor: '#4b6a9b', labelTextColor: '#c8d4e4',
            noteBkgColor: '#1c2a44', noteTextColor: '#e8edf4', noteBorderColor: '#4b6a9b',
            activationBkgColor: '#1c2a44', activationBorderColor: '#7dffcf',
            classBkg: '#16233c', classBorder: '#4b6a9b', classText: '#e8edf4',
            fontSize: '13px' } });
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
    // THE WIRING-UNIVERSE LAW (v1.17.2, Jimmy: "many things dont have a
    // label, or incorrectly labelled"): the plate labels every PART on
    // the craft's io wiring (data/item cables), not just the devices
    // THIS program addresses. Unwired parts are unimportant — unlabelled.
    const cableCis = new Set<number>();
    const fmap = p.bp ? flatToTopMap(p.bp) : null;
    for (const pp of ((p.bp?.data as Record<string, unknown>)?.pipes ??
      []) as { a_component?: number; b_component?: number }[]) {
      for (const flat of [pp.a_component, pp.b_component])
        if (typeof flat === 'number' && fmap) {
          const top = flatEndpointTop(fmap, flat);   // FLATTENED-ENDPOINT LAW
          if (top !== undefined) cableCis.add(top);  // nested parts skipped
        }
    }
    const comps = (p.bp?.data.components ?? []) as { type?: string; alias?: string }[];
    const devs = curCpu.devices.filter(d => d.ci !== undefined);
    const seenCi = new Set(devs.map(d => d.ci));
    cableCis.forEach(ci => {
      if (seenCi.has(ci) || ci === curCpu.ci) return;
      seenCi.add(ci);
      const c = comps[ci];
      if (!c || !c.type || c.type === 'Build' || c.type === 'Dashboard') return;
      devs.push({ ci, io: -1, alias: (c.alias ?? '').toLowerCase(), type: c.type } as typeof devs[0]);
    });
    const picked = devs.filter(d => touched.has(d.alias || `io ${d.io}`) || d.io >= 0);
    // THE PICKING ORDER (v1.17.2, we: "pick a single color and then show
    // all connections to that thing with that color, with a certain
    // picking order; Computer most important, then cockpit"): net devices
    // first, the cockpit seat next, the rest by io traffic (the fan-in
    // order already carried in `devs`/filter). The palette is assigned IN
    // THIS order, so the most important device gets the lead colour and
    // every cable/label/actor fill on ALL THREE views wears it.
    const NET = new Set(['Computer', 'MiniComputer', 'Router', 'MiniRouter',
      'DataJunction', 'DataBridge', 'Crafter', 'HudController']);
    const rank = (t: string) => NET.has(t) ? 0 : t === 'PilotSeat' ? 1 : 2;
    // THE PLURAL-LABEL LAW (v1.17.2, Jimmy's adventure, we: "things that
    // repeat and are wired together … label the junction OR the central
    // most component of an identified group and label it as plural"):
    // ≥3 wired same-type parts are ONE labelled group ("Ailerons-Left
    // 1–5" from patterned aliases, "Generators" from types); members
    // share the group colour and lose their individual tags.
    const byType = new Map<string, typeof picked>();
    for (const d of picked) byType.set(d.type, [...(byType.get(d.type) ?? []), d]);
    const groupsWithRank: { cis: number[]; label: string; r: number }[] = [];
    const singles: typeof picked = [];
    for (const [type, ds] of byType) {
      if (ds.length >= 3)
        groupsWithRank.push({
          cis: ds.map(d => d.ci!).filter((c): c is number => c !== undefined),
          label: groupLabel(type, ds.map(d => d.alias)), r: rank(type) });
      else singles.push(...ds);
    }
    groupsWithRank.sort((a, b) => a.r - b.r);
    const groups = groupsWithRank.map(({ cis, label }) => ({ cis, label }));
    const src = singles.length ? singles : devs;
    const actorsSrc = [...src].sort((a, b) => rank(a.type) - rank(b.type)).slice(0, 12);
    const actors = actorsSrc.map(d => ({
      ci: d.ci!, tag: `${d.alias || `${d.type} #${d.ci}`} · io ${d.io}` }));
    // retry while the scene is still building (EMPTY-FLAG, v1.17.1)
    let tries = 0;
    const go = () => {
      eng.analysisShots({ actors, groups })
        .then(ph => {
          if (ph.empty && tries++ < 2) { setTimeout(go, 2500); return; }
          setPlates(x => ({ ...x, [curCpu!.ci]: { svgs: ph.svgs } }));
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
  const mass = p.bp ? massModel(p.bp, peekManifest()) : null;
  // THE INFO RECAP (v1.17.2, we: "Analysis should just contain a recap of
  // what infop tabs tells us"): the ⌖ Info tab's numbers ride the header
  // card — the mass families (Panel's Mass & CoM), the sealed-envelope
  // flood + vacuum lift (LiftWidget), the build cost (CostWidget twin).
  const env = useMemo(() => {
    if (!p.bp) return null;
    const s = sealedEnvelopeVolume(p.bp.data.triangles ?? [], p.bp.data.blocks ?? []);
    return s.m3 > 0
      ? { m3: s.m3, sealed: true }
      : { m3: envelopeVolume(p.bp.data.triangles ?? []).m3, sealed: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.bp, maniTick]);
  const cost = useMemo(() => (econ && p.bp ? buildCost(econ, p.bp) : null),
    [econ, p.bp, maniTick]);
  const summary = mass ? { massKg: mass.total, weightN: mass.total * G0,
    costRaw: cost ? Math.round(materialQty(cost.total)) : undefined,
    costTime: cost?.total.time,
    families: mass.families, declared: mass.declared,
    envelopeM3: env?.m3, envelopeSealed: env?.sealed,
    liftVacuumKg: env && env.m3 > 0 ? liftKg('vacuum', env.m3, 0) : undefined } : null;
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
      plateSvg: isHud ? undefined : plates[cid]?.svgs,
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
      initial={(vw, vh) => { const w = Math.min(1440, vw - 24);
        return { x: Math.max(12, (vw - w) / 2), y: 16, w, h: vh - 32 }; }}
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
        {comps.length + huds.length >= 1 && (
          // THE TAILORED-SCHEMATIC SELECTOR (v1.17.2, we: "selection for
          // computer for tailored schematic is not obvious"): the row is
          // ALWAYS visible and says what it is; the active computer is a
          // solid, lit chip — you always know whose sheets these are.
          <div className="flex flex-wrap items-center gap-2 rounded border
                         border-[#22314a] bg-[#0e1626] px-2 py-1.5">
            <span className="text-[10px] uppercase tracking-widest text-[#8b93a1]">
              Schematic tailored to</span>
            {comps.map(c => (
              <button key={`c${c.ci}`} data-testid={`analysis-comp-${c.ci}`}
                className={`rounded border px-2.5 py-1 text-[12px] transition-colors ${cur?.ci === c.ci && !curIsHud
                  ? 'border-[#7dffcf]/70 bg-[#7dffcf]/15 font-semibold text-[#7dffcf]'
                  : 'border-[#2b3a52] text-[#9fb0c8] hover:bg-[#182236]'}`}
                title={`Show the device table, plates, diagrams and compute budget of ${c.alias || `#${c.ci}`}`}
                onClick={() => setSel({ kind: 'cpu', ci: c.ci })}>
                ⌨ {c.alias || `#${c.ci}`}{cur?.ci === c.ci && !curIsHud ? ' ●' : ''}
              </button>
            ))}
            {huds.map(h => (
              <button key={`h${h.ci}`} data-testid={`analysis-hud-${h.ci}`}
                className={`rounded border px-2.5 py-1 text-[12px] transition-colors ${cur?.ci === h.ci && curIsHud
                  ? 'border-[#ffd479]/70 bg-[#ffd479]/15 font-semibold text-[#ffd479]'
                  : 'border-[#2b3a52] text-[#9fb0c8] hover:bg-[#182236]'}`}
                title="HUD program — client runtime, NO server compute budget (wiki hud.md)"
                onClick={() => setSel({ kind: 'hud', ci: h.ci })}>
                📟 {h.alias || `#${h.ci}`}{cur?.ci === h.ci && curIsHud ? ' ●' : ''}
              </button>
            ))}
          </div>
        )}
        {errs['*'] && <div className="rounded bg-[#3a1420] p-2 text-[11px] text-[#ffb4b4]"
          data-testid="analysis-mermaid-err">{errs['*']}</div>}
        {summary && (
        <section data-testid="analysis-summary" className="max-w-[1160px] rounded border
          border-[#22314a] bg-[#0e1626] p-3 text-[12px] text-[#c8d4e4]">
          {/* THE INFO RECAP FIRST (v1.17.2, we: "Analysis should just
              contain a recap of what infop tabs tells us" + "weight,
              costs and flight characteristics should be higher up"):
              mass families + envelope + lift + cost + flight lead. */}
          <div className="flex flex-wrap gap-x-8 gap-y-1 tabular-nums">
            <span><span className="text-[#8b93a1]">mass</span>{' '}
              <b>{summary.massKg.toFixed(0)} kg</b>
              {summary.families && <span className="text-[#8b93a1]">
                {' '}· hull {summary.families.hull.toFixed(0)} · skin {summary.families.skin.toFixed(0)}
                · parts {summary.families.parts.toFixed(0)}
                {summary.families.struts + summary.families.beams + summary.families.fluids > 0
                  && ` · +${(summary.families.struts + summary.families.beams + summary.families.fluids).toFixed(0)}`}
                {' '}kg</span>}
              {summary.declared > 0 && <span className="text-[#8b93a1]"> · declared {summary.declared.toFixed(0)} kg</span>}</span>
            <span><span className="text-[#8b93a1]">weight</span>{' '}
              <b>{summary.weightN.toFixed(0)} N</b></span>
            <span><span className="text-[#8b93a1]">envelope</span>{' '}
              <b>{summary.envelopeM3 ? `${summary.envelopeM3.toFixed(1)} m³${summary.envelopeSealed ? ' (sealed)' : ' (open)'}` : 'none sealed'}</b>
              {summary.liftVacuumKg !== undefined && <span className="text-[#8b93a1]">
                · vacuum lift {summary.liftVacuumKg.toFixed(0)} kg</span>}</span>
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
        )}
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
              // THE ONE-PAGE-PER-VIEW LAW (v1.17.2, we: "put the next
              // schematic on the next page … default size bigger … when
              // clicking SVG make full screen like in a photo gallery"):
              // each view is its own sheet, filling it at its own scale;
              // DiagramView is the gallery — click opens fullscreen,
              // wheel/pinch/± zoom, Esc / backdrop closes.
              return ph && (
              <div data-testid="analysis-plates" className="flex w-full max-w-[1400px] flex-col gap-3">
                {ph.svgs.map((s, i) => (
                  // THE STATIC-SHEET + ZOOM-AVAILABLE LAW (v1.17.2, we:
                  // "zooming on the schematics shouldnt be a thing" = the
                  // DEFAULT must read at rest; "I cant zoom in on the
                  // schematics anymore now" = keep the gallery for detail.
                  // Sheets sit at full column width (readable as-is);
                  // DiagramView offers zoom/fullscreen on demand.
                  <div key={i} data-testid={`analysis-plate-${i}`}>
                    <DiagramView svg={s} />
                  </div>
                ))}
                <div className="mt-0.5 text-[10px] text-[#8b93a1]">
                  blueprint plates — one view per page, each filling its sheet:
                  hull hairlines, actors as silhouette outlines in their label
                  colour, cabled runs + io tags, leader-line labels.
                  Click a sheet to open the gallery; wheel/pinch/± to zoom,
                  Esc to close.
                </div>
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
