// Editor.tsx — the full-screen KSP-VAB editing workspace (lazy chunk: the
// gallery never loads three.js/the engine). Viewport fills the window, the
// parts panel docks LEFT (mobile: a drawer behind ⚙), STATIC INFO (mass &
// CoM) floats bottom-left, the camera-preset cluster bottom-right. Blueprints
// stream through crafts.ts (IndexedDB cache: a cached craft opens with zero
// network; the KSP "receiving blueprint" overlay shows only on a real
// download). Holds the raw-literal DOC + live bp; see App.tsx for the shell.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// v1.12.2 BOOT COST: the LAZY chunk's eval completed (bootprobe phase mark —
// navStart → here = HTML + index chunk + three.js/engine parse+eval).
performance.mark('boot:editor-eval');
let __firstRenderMarked = false;   // one 'boot:render1' on the FIRST render call
import sealWasmUrl from '../wasm/seal.wasm?url';
import { HistoryStack } from './engine/history';
import { realScheduler } from './engine/clocks';
import { initSealWasmFetch } from './engine/sealwasm';
// v1.11.2 WASM: boot the sealed-envelope module in the background (a few
// KB, off the render path). Every envelope compute BEFORE this resolves —
// and forever in tests without a fetch — runs the pure-JS twin (atmo.ts),
// so there is no boot race; sealwasm.test.ts pins the two answers equal.
void initSealWasmFetch(sealWasmUrl);
import { craftMeta, craftName } from './gallery-catalog';
import { DEFAULT_OPTS, backdropDefault, backdropNames, type Backdrop, type Engine, type PickHit,
  type PressTarget, type ViewOptions } from './engine/scene';
import Viewport from './components/Viewport';
import {
  StaticInfo, ViewOpts, VesselStats, CompList, Inspector, SubPanel,
  type EditApi, type PanelProps,
} from './components/Panel';
import TopBar, { type Mode } from './components/TopBar';
import { BlockPanel, FlightPanel, TriPanel, WirePanel, WindPanel, brushSpec, placeBlock, type Brush } from './components/ModePanels';
import { MirrorGlyph } from './components/ui';
import { BlockPaint, CompPaint, SwatchGrid } from './components/ColorPanel';
// v1.12.2 BOOT COST — chunk diet: the tools desk (registry + dialog + the
// latsphere/balloonfin planners it statically imports) and the help manual
// (markdown renderer + every topic) leave the boot chunk; the Editor
// fetches both module(s) right after mount (a few ms on a local server,
// one small chunk on Pages), long before a menu click can need them.
type ToolsModule = typeof import('./components/ToolsDialog');
import type { PlacePayload, ToolForm } from './components/ToolsDialog';
import { lazy, Suspense } from 'react';
const HelpDialogLazy = lazy(() => import('./components/HelpDialog'));
const XenonDialogLazy = lazy(() => import('./components/XenonDialog'));
const ScreensDockLazy = lazy(() => import('./components/ScreensDock'));
const AutosavesDialogLazy = lazy(() => import('./components/AutosavesDialog'));
const HudDialogLazy = lazy(() => import('./components/HudDialog'));
const BeaconDockLazy = lazy(() => import('./components/BeaconDock'));
import { blockInfo, blockMirrorTwin, blockTwinIssues, cellIndex, cellOverlap,
  complementBlock, mirrorAxisIdx, paintTwinPair, type MirrorAxisOpt } from './engine/blocks';
import { cornerOf, triAt, triangleFromCorners, mirroredTriangle, triTwinIndex, type Corner } from './engine/tris';
import { applyPinEdit, applyPinRotate, applyPinShift, applyTriFlip, applyTriPaint } from './engine/pinedit';
import type { Blueprint, Triangle } from './engine/format';
import { isLegacyFile } from './engine/format';
import { hasDashboards, xenonComputers, xenonHudControllers, xenonFarm, type XCFile,
  type XenonComputer } from './engine/xenoncode';
import { fetchPlayerHuds, fetchPlayerHud, savePlayerHud, playerHudFromFiles,
  PLAYER_HUD_CI, type PlayerHudEntry, type PlayerHudProgram } from './engine/playerhud';
import { DeviceSim, dataNeighbours } from './engine/devicesim';
import { craftPowerNet, computerPowered } from './engine/power';
import { EnergySim, type EnergyStatus } from './engine/energy';
import { ItemSim, type ItemSimCensus } from './engine/itemsim';
import { soundscape } from './engine/soundscape';
import { chanSites, rectSites, rectsAt, type ChanSite, type RectSite } from './engine/xcsites';
import { loadManifest, peekManifest } from './engine/models';
import { beaconNet } from './engine/beaconnet';
import { makeXcdbg } from './engine/xcdbg';
import { buzzerAudio } from './engine/buzzer';
import { pilotKeysActive } from './engine/pilotkeys';
import { autosave, countAutosaves, pruneAfterSave } from './engine/autosave';
import type { ResolvedColor } from './engine/palette';
import { docArrayInsert, docArrayRemoveAt, docEnsureArray, docFromValue, docValue, emitDoc, parseDoc } from './engine/doc';
import { allocateSlot, blockSkinTris, paletteSlotNode, type Rgb255 } from './engine/tools';
import { setPaletteSlot } from './engine/edit';
import { appendTrianglesDoc, insertXcFile, makeCtx, openFunnel, removeXcFile, resetComponent, setDataField,
  setOrientation, setPos, setCompField, pruneCompRefs, setCompColor, setXcFileCode, serializeSave,
  writeBlockDoc, type EditCtx } from './engine/edit';
import { makePipe } from './engine/wireops';
import { normalizeDoc } from './engine/normalize';
import { qAxisAngle } from './engine/compparts';
import { newCraftDoc, newComponent } from './engine/newcraft';
import { craftState, craftInfo, loadCraft, type CacheInfo, type CraftState } from './crafts';
import StaleDialog from './components/StaleDialog';


/** WP4 loop census for the soundscape: which part-loops run right now
 *  (channel law: the drill/belt authored-ON defaults, the pump/prop by
 *  their speed channel — the soundscape remembers every bus write). */
function loopWanted(bp: import('./engine/format').Blueprint | null) {
  if (!bp) return [];
  const out: { ci: number; kind: 'drill' | 'belt' | 'pump' | 'prop'; gain: number }[] = [];
  (bp.data.components as { type: string }[]).forEach((c, ci) => {
    const ch0 = soundscape.chan(ci, 0);
    switch (c.type) {
      case 'MiningDrill': out.push({ ci, kind: 'drill', gain: (ch0 ?? 1) > 0 ? 0.09 : 0 }); break;
      case 'ItemConveyor': out.push({ ci, kind: 'belt', gain: (ch0 ?? 1) > 0 ? 0.05 : 0 }); break;
      case 'SmallTurboPump': case 'TurboPump':
        out.push({ ci, kind: 'pump', gain: (ch0 ?? 0) > 0 ? 0.05 : 0 }); break;
      case 'Propeller': {
        const v = soundscape.chan(ci, 0) ?? 0;
        out.push({ ci, kind: 'prop', gain: Math.min(0.14, Math.abs(v) * 0.14) }); break;
      }
      default: break;
    }
  });
  return out;
}

export default function Editor({ craft, onBack }: { craft: string | null; onBack: () => void }) {
  // v1.12.2 BOOT COST: the first render pass began (React tree build).
  if (!__firstRenderMarked) { __firstRenderMarked = true; performance.mark('boot:render1'); }
  const [bp, setBp] = useState<Blueprint | null>(null);
  /** the bp-swaps that are UNDO/REDO (same craft) keep the camera; see the
   *  Viewport keepView prop. openText (a craft swap) always clears it. */
  const [bpKeepView, setBpKeepView] = useState(false);
  const [sel, setSel] = useState<{ ci: number; sub: number }>({ ci: -1, sub: -1 });
  const [hit, setHit] = useState<PickHit | null>(null);
  const [dirty, setDirty] = useState(false);
  const [inspKey, setInspKey] = useState(0);
  const [mode, setMode] = useState<Mode>(() =>
    new URLSearchParams(window.location.search).has('aero') ? 'aero' : 'view');
  const [opts, setOpts] = useState<ViewOptions>(DEFAULT_OPTS);
  const [hullOpacity, setHullOpacityState] = useState(1);
  // v1.5.1: the gizmo master is SESSION-only (default ON) — its old persisted
  // key was poisoned by the view-mode gate, so it is no longer read at all.
  const [gizmoOn, setGizmoOn] = useState(true);
  const [hiDef, setHiDefState] = useState(() => localStorage.getItem('archean-app-hidef') !== '0');
  // the KSP STATIC INFO box (mass & CoM) is OPTIONAL (user 2026-10-19: "static
  // info shouldn't necessarily show. it's too large on mobile, hide it under
  // settings, x to close panel itself"): no unsolicited overlay — the ⚙ view
  // options owns the switch (row static info box) and the box has its own ✕.
  // With no stored choice, phones start WITHOUT it (it covered a third of the
  // viewport); desktop starts with it as before.
  const [staticInfo, setStaticInfo] = useState(() => {
    const s = localStorage.getItem('archean-app-static-info');
    return s === null ? window.innerWidth >= 768 : s === '1';
  });
  useEffect(() => { localStorage.setItem('archean-app-static-info', staticInfo ? '1' : '0'); }, [staticInfo]);
  // v1.11.1 PHONE (we: "placing blocks on phone exclusively works on existing
  // geometry, not on e.g. grid, preventing movement"): the phone canvas is a
  // postage stamp, so a tap far from the tiny craft lands on the GRID PAD —
  // the desktop rule 'ground stays unfurnishable' (v1.11 constructor law)
  // made growth off the deck impossible there. Phones also furnish the pad.
  const [narrow, setNarrow] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const h = () => setNarrow(window.innerWidth < 768);
    addEventListener('resize', h);
    return () => removeEventListener('resize', h);
  }, []);
  const [rev, setRev] = useState(0);
  const [blockSel, setBlockSel] = useState(-1);
  // v1.11 PLACEMENT REWRITE (we: "Choosing a block size before placing it
  // shouldn't be a thing"): the brush carries SHAPE, PAINT and MATERIAL only
  // — every click lands a 1×1×1 block; size comes AFTER via the widget's
  // ⤢ STRETCH mode (Engine.blockGizmoScale) or the dock's size rows.
  const [brush, setBrush] = useState<Brush>({ type: 0, slot: 51, material: 0 });
  // v1.10.6 WIRE-style dock: hovering a block/triangle LIST row previews it
  // gold in 3D (the selection's own highlight returns when the list is left)
  const [blockHover, setBlockHover] = useState(-1);
  const [triHover, setTriHover] = useState(-1);
  // the TOOLS menu ▸ ToolDialog modal (v1.7): one open tool id at a time
  const [toolOpen, setToolOpen] = useState<string | null>(null);
  // v1.12.2 chunk diet: the tools module (registry + dialog) lands right
  // after mount; the Tools menu renders from it, the placement commit
  // reads it through the ref. Menu/dialog actions are user-driven — the
  // module is resolved long before any click.
  const [toolsMod, setToolsMod] = useState<ToolsModule | null>(null);
  const toolsModRef = useRef<ToolsModule | null>(null);
  // Help ▸ Manual… — the built-in markdown manual (v1.5.20)
  const [helpOpen, setHelpOpen] = useState(false);
  // XENON (v1.13): the Xenon IDE of a MiniComputer (XenonDialog.tsx); the
  // descriptors re-derive from bp (the files live IN the blueprint).
  // FARM (v1.15.0 slice C): MULTIPLE IDE windows co-run — one per ci, the
  // last one is the ACTIVE pump (dock/debug-console/▶-F5 target).
  const [xenonCis, setXenonCis] = useState<number[]>([]);
  const activePump = () =>
    xenonFarm.pumpForCi(xenonCis[xenonCis.length - 1] ?? -1) ?? xenonFarm.active();
  // FARM (slice C): re-render when the pump LINEUP changes (the dock's
  // pump prop follows a boot started from its own effect)
  const [farmV, setFarmV] = useState(0);
  useEffect(() => xenonFarm.subscribe(() => setFarmV(v => v + 1)), []);
  void farmV;
  // v1.15.6 THE LIVING CRAFT: the manifest rides a boot-time fetch (the
  // power net + actuator tables re-derive when it lands)
  const [manifestV, setManifestV] = useState(0);
  useEffect(() => { void loadManifest().then(() => setManifestV(v => v + 1)); }, []);
  const powerNet = useMemo(
    () => (bp ? craftPowerNet(bp, peekManifest()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bp, manifestV]);
  const xenonComps = useMemo(
    () => (bp ? xenonComputers(bp, {
      // v1.16.11 ROUTER POWER GATING: an unpowered Mini/Router drops its
      // subtree from the device/screen space (engine/power.ts reachability;
      // a grid-less craft answers true = the power-unaware convention)
      routerPowered: ci => !powerNet?.hasPower || computerPowered(powerNet, ci),
    }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bp, powerNet]);
  // ── v1.15.6 THE LIVING CRAFT (we: "computers should start when a craft is
  //    loaded in, and parts need to respond to signals … hinges and buttons
  //    and pivots and ailerons actually move … if a pivot or hinge moves, so
  //    does its subgrid … button presses onto dashboards and screens should
  //    work on the 3d model and propagate … a hand with finger cursor … tell
  //    us what channel/ui element/which xenoncode line … as a popup label …
  //    if a computer is unpowered, show a warning when we interact with it").
  //    engine/devicesim.ts animates the actuator channels (SIM IS A VIEW —
  //    nothing writes the blueprint, saves stay byte-identical),
  //    engine/power.ts gates the auto-boot and the warnings,
  //    engine/xcsites.ts names the program line behind a press.
  const simRef = useRef(new DeviceSim());
  // v1.16.10 THE POWER FLOW (WP5): the grid balance rides the same 25 Hz
  // heartbeat as the actuator sim; the TopBar chip warns (never blackouts).
  const energyRef = useRef(new EnergySim());
  const [energy, setEnergy] = useState<EnergyStatus | null>(null);
  // v1.16.10 ITEMS ON BELTS (WP6): the drill→belt→container chain rides
  // the same heartbeat; container contents publish on the io bus (the
  // wiki's data-port KV law) so programs READ the inventory.
  const itemRef = useRef(new ItemSim());
  const [items, setItems] = useState<ItemSimCensus | null>(null);
  // v1.16.10 THE SOUND OF THE CRAFT (engine/soundscape.ts): the 🔊 chip
  // is the browser gesture that arms the AudioContext (buzzer law).
  const [soundOn, setSoundOn] = useState(soundscape.soundOn);
  const powerStatusRef = useRef('ok');
  const energyKeyRef = useRef('');
  const itemsKeyRef = useRef('');
  const bpRef = useRef(bp); bpRef.current = bp;
  const latchedRef = useRef(new Map<string, boolean>());
  const sitesRef = useRef(new Map<number, { chan: ChanSite[]; rect: RectSite[] }>());
  /** LIVE CRAFT: the farm auto-boots the craft's programmed, POWERED
   *  computers on load and the VMs keep running when the IDE windows close
   *  (the craft runs while you look at it, like the game). Persisted ⚙. */
  const [live, setLive] = useState(() => localStorage.getItem('archean-app-live') !== 'off');
  useEffect(() => { localStorage.setItem('archean-app-live', live ? 'on' : 'off'); }, [live]);
  // the manifest (joint limits for the sim, adapter kinds for power) lands
  // async — powerNet/sim re-derive once it is here
  const unpowered = useCallback((ci: number) =>
    !!powerNet?.hasPower && !computerPowered(powerNet, ci), [powerNet]);
  const xenonCompsRef = useRef(xenonComps); xenonCompsRef.current = xenonComps;
  // the actuator table from the fresh blueprint + manifest joint geometry
  useEffect(() => {
    if (!bp) return;
    const man = peekManifest();
    simRef.current.load(bp, t => (man?.[t]?.joints ?? []).map(j => ({
      name: j.name, limits: j.limits as [number, number, number] | undefined })));
    energyRef.current.load(bp, powerNet);
    setEnergy(energyRef.current.state());
    itemRef.current.load(bp, powerNet?.hasPower ? powerNet.powered : null);
    setItems(itemRef.current.census());
    soundscape.load(bp);
    latchedRef.current.clear();
    sitesRef.current.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bp, manifestV]);
  // THE ACTUATOR TAP: every bus write, resolved to its device (v1.15.6,
  // IoBus), feeds the sim; a Dashboard's element channels light its LED
  // faces (dashboard.md: one port, channel = element index).
  useEffect(() => xenonFarm.observeDevices((ci, type, ch, v) => {
    simRef.current.write(ci, ch, v);
    energyRef.current.write(ci, ch, v);   // gates: lamps, belts, generators
    itemRef.current.write(ci, ch, v);     // gates: drill, belts
    soundscape.write(ci, ch, v);          // THE SOUND OF THE CRAFT (WP4)
    if (type === 'Dashboard') simRef.current.setLed(ci, ch, v > 1 ? v / 255 : v);
  }), []);
  // AUTO-BOOT (we: "computers should start when a craft is loaded in"):
  // every programmed computer boots with the craft — POWER-GATED: a craft
  // with a power grid leaves its unconnected computers OFF (in-game they
  // are dead metal; interacting with one warns, engine/power.ts). The
  // craft swap re-boots fresh (the v1.13.12 fresh-game law).
  useEffect(() => {
    if (!live || !bp) return;
    xenonFarm.closeAll();
    const net = powerNet;
    const booted = xenonComps.filter(c => !net?.hasPower || computerPowered(net, c.ci));
    xenonFarm.autoboot(booted);
    // v1.16.11 THE 3-D LAW RIDES THE LIVE FARM (the 3828773626 blank
    // screens, second half): a LIVE craft's screens must light the boards
    // with NO IDE window — feed the engine the booted lineup's
    // screen↔dashboard bindings (literal scan + THE NET-SCREEN LAW) so the
    // dashboard faces gain their DataTextures and the pumps' tick hooks
    // have somewhere to push. (Opening an IDE later re-binds to THAT
    // computer — the established XenonDialog law.)
    const seen = new Set<string>();
    engineRef.current?.setScreenFeeds(booted.flatMap(c => c.screens
      .filter(s => s.ci != null)
      .map(s => ({ key: `${s.alias.toLowerCase()}#${s.channel}`, ci: s.ci!, channel: s.channel }))
      .filter(f => !seen.has(`${f.ci}:${f.channel}#${f.key}`) && seen.add(`${f.ci}:${f.channel}#${f.key}`))));
    energyRef.current.clear();
    setEnergy(energyRef.current.state());
    itemRef.current.clear();
    setItems(itemRef.current.census());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bp, live, powerNet]);
  // ── v1.14.0 P9 slice A (we: "allow us to edit the code for at least HUDs
  //    that are contained within a HUD block … make beacons into a seperate
  //    tab for computers/huds … a beacons menu, under xenoncode"): the HUD
  //    blocks (HudController .xc programs), the 📡 Beacon dock, and the
  //    beaconNet registry seeded from every Beacon component + every
  //    beacon() literal in every computer AND HUD program on the craft.
  const xenonHuds = useMemo(
    () => (bp ? xenonHudControllers(bp) : []),
    // re-derive on every save (rev): the HUD IDE's files come FRESH from
    // bp on reopen — the disk is the truth (same law as the menu counts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bp, rev]);
  const [hudCi, setHudCi] = useState<number | null>(null);
  // PLAYER HUDs (v1.17.0, we: "make it possible to load a player HUD file"):
  // the game's hud/<name>/ folders (dev/preview /hud listing; machine-wide,
  // not craft-scoped) + the file-picker path that works in EVERY build.
  // A loaded program opens the SAME HUD IDE with the SYNTHETIC ci — the
  // Library tab, the runtime and the F5 law ride it unchanged; only the
  // save target differs (the route writes the .xc files, never the .bin).
  const [playerHuds, setPlayerHuds] = useState<PlayerHudEntry[]>([]);
  const [playerHud, setPlayerHud] = useState<PlayerHudProgram | null>(null);
  const hudFileRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { void fetchPlayerHuds().then(setPlayerHuds); }, []);
  const openPlayerHud = useCallback((name: string) => {
    void fetchPlayerHud(name)
      .then(p => { setPlayerHud(p); setHudCi(PLAYER_HUD_CI); })
      .catch(e => setToolMsg(`⚠ player HUD '${name}': ${String(e)}`));
  }, []);
  const loadPlayerHudFiles = useCallback(() => hudFileRef.current?.click(), []);
  const onHudFilesPicked = useCallback(async (fl: FileList) => {
    const list = await Promise.all([...fl].map(async f => ({
      name: f.name, rel: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
      text: await f.text(),
    })));
    try {
      const p = playerHudFromFiles(list);
      setPlayerHud(p); setHudCi(PLAYER_HUD_CI);
      setToolMsg(`player HUD '${p.name}' loaded (${p.files.length} files) — edits are in memory until 💾 save`);
    } catch (e) { setToolMsg(`⚠ ${String(e)}`); }
  }, []);
  const [beaconsOpen, setBeaconsOpen] = useState(false);
  useEffect(() => { if (bp) beaconNet.seed(bp); }, [bp, rev]);
  // ▣ SCREENS bottom tab (v1.13.x): the dashboards' live rasters, normal +
  // virtual surfaces, on the SHARED pump (the IDE, the dock and the 3-D
  // dashboard faces all ride ONE running computer).
  const [screensOpen, setScreensOpen] = useState(
    // v1.13.2 deep link (?craft=<id>&dash=<surfaceKey>, e.g. dash=screen%230):
    // the ▣ Screens dock opens booted toward that surface, whose ZOOM WINDOW
    // is raised as soon as it paints — `?craft=3820116990&dash=screen%230`
    // is Mario's TV, directly (we: "a deeplink ability to the specific dash")
    !!new URLSearchParams(window.location.search).get('dash'));
  const hasScreens = useMemo(() => (bp
    ? hasDashboards(bp) || xenonComps.some(c => c.screens.some(s => s.deviceScreen))
    : false),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [bp, xenonComps]);
  // v1.13.x AUTOSAVE shadow copies ("Forget to save? No problem"): the doc
  // text is shadowed every ~20 s while dirty + on every save; File ▸
  // Autosaves lists them per craft with timestamps.
  const [autosavesOpen, setAutosavesOpen] = useState(false);
  const [autosaveCount, setAutosaveCount] = useState(0);
  const autosaveKeyRef = useRef('new');
  const autosaveLabelRef = useRef('Untitled craft');
  const autosaveNow = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || !dirtyRef.current) return;
    void autosave(autosaveKeyRef.current, autosaveLabelRef.current, emitDoc(ctx.doc))
      .then(a => { if (a) void countAutosaves().then(setAutosaveCount); });
  }, []);
  useEffect(() => { void countAutosaves().then(setAutosaveCount); }, []);
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(autosaveNow, 20_000);      // ~20 s after the last edit
    return () => clearTimeout(t);
  }, [dirty, rev, autosaveNow]);
  useEffect(() => {
    // the event fires ON document with bubbles:false — a WINDOW listener
    // never receives it (the shadow silently never ran; the e2e caught it)
    const h = () => { if (document.visibilityState === 'hidden') autosaveNow(); };
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  }, [autosaveNow]);
  useEffect(() => {
    if (!screensOpen) return;
    const comp = xenonFarm.active()?.comp ?? xenonComps[0];
    if (!comp) return;
    void xenonFarm.pumpFor(comp).open(comp);
    engineRef.current?.setScreenFeeds(comp.screens
      .filter(s => s.ci != null)
      .map(s => ({ key: `${s.alias.toLowerCase()}#${s.channel}`, ci: s.ci!, channel: s.channel })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screensOpen, xenonComps.length]);
  // FARM (slice C): release the VMs when the LAST IDE window and the
  // Screens tab are all closed (a craft swap then boots clean). v1.15.6
  // LIVE CRAFT: with the farm auto-booted the VMs OUTLIVE the windows —
  // the craft keeps running (closing the IDE never stops a running craft;
  // the ⚙ Live toggle off is the opt-out that restores the old law).
  useEffect(() => {
    if (!live && xenonCis.length === 0 && !screensOpen) xenonFarm.closeAll();
  }, [xenonCis, screensOpen, live]);
  // LEAVING THE EDITOR (back to the gallery, craft swap, unmount) closes
  // the FARM TOO (we: "going back to the gallery DOESNT properly reset the
  // entire sim, which it must if we can open directly to a screen"): the
  // deep-link UX promises a FRESH game on every entry — without this the
  // VMs keep cycling behind the gallery (audio on!) and open()'s same-ci
  // early return RESUMES the old session, so the arcade never shows its title.
  useEffect(() => () => xenonFarm.closeAll(), []);
  // SCREEN WAKE LOCK while a game screen is up (v1.13.12, we: "did not play
  // any sound until I made the screen smaller"): Chrome throttles an
  // occluded tab's timers (the 25 Hz pump starves, short beeps fall through
  // the sampling gaps). A page holding the screen wake lock is treated as
  // NEVER occluded (Chrome 125+) — the heartbeat keeps its cadence. Denied
  // /unsupported: the silent audio keep-alive (buzzer.ts) still marks the
  // tab media-active, which is the second exemption.
  useEffect(() => {
    if (!(screensOpen || xenonCis.length > 0)) return;
    const wl = (navigator as unknown as {
      wakeLock?: { request: (t: 'screen') => Promise<{ release: () => void; addEventListener: (e: string, f: () => void) => void }> };
    }).wakeLock;
    if (!wl) return;
    let live = true;
    let sentinel: { release: () => void } | null = null;
    const req = () => {
      if (!live) return;
      void wl.request('screen')
        .then(s => { sentinel = s; s.addEventListener('release', () => { sentinel = null; }); })
        .catch(() => { /* denied: the audio keep-alive is the fallback */ });
    };
    req();
    const vis = () => { if (document.visibilityState === 'visible') req(); };
    document.addEventListener('visibilitychange', vis);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', vis);
      sentinel?.release();
    };
  }, [screensOpen, xenonCis]);
  // Debug channel base (the __XENON__ pattern): readable on ANY page — the
  // IDE dialog enriches it further while mounted (surfaceMeta, bus, ...)
  useEffect(() => {
    buzzerAudio.arm();   // sound ON by default; unlocks at the first gesture
    // THE DEBUG CONSOLE (v1.13.24, we: "create a JS interface where we can
    // define breakpoints and then run stuff - an interface that makes using
    // it for AI agents to analyze xenoncode easier"): window.__XCDBG__
    // drives the REAL FARM's ACTIVE pump (slice C resolves it per call) —
    // break(file,lines) / run / step / frame / globals / write(name,value)
    // / bus / prints, all JSON-plain.
    (window as any).__XCDBG__ ??= makeXcdbg(() => xenonFarm.active());
    (window as any).__XENON__ ??= () => {
      const P = xenonFarm.active();
      return {
        cycles: P?.cycles ?? 0, status: P?.status ?? 'idle',
        // FARM (slice C): every VM on the floor, by computer alias
        farm: xenonFarm.pumps.filter(p => p.comp).map(p => ({
          comp: p.comp?.alias ?? '', cycles: p.cycles, status: p.status,
        })),
        // v1.13.26: the camera (the io-hover fly-to pin measures the 3-D
        // view actually moved; null until a scene exists)
        cam: () => engineRef.current?.camPos() ?? null,
        pilotKeys: P?.pilotKeysBound() ?? [],
        surfaceMeta: [...(P?.surfaces.values() ?? [])].map(({ key, w, h }) => ({ key, w, h })),
        // v1.13.8 audit door: a surface's live framebuffer (the invadersaudit
        // orientation probe compares the RENDERED 3-D face against it) and the
        // last input_number READS per io:ch (the input-path probes).
        pixels: (key: string) => {
          const s = P?.surfaces.get(key);
          return s?.pixels ? { w: s.w, h: s.h, data: [...s.pixels!] } : null;
        },
        reads: () => Object.fromEntries(P?.reads ?? []),
        // v1.16.11 audit seam (tools/netscreenprobe.mjs): a pump BY COMPUTER
        // ALIAS — surfaces + pixels for any farm member, not just the active
        pumpPixels: (alias: string, key: string) => {
          const q = xenonFarm.pumps.find(p => p.comp?.alias === alias);
          const s = q?.surfaces.get(key.toLowerCase());
          return s?.pixels ? { w: s.w, h: s.h, data: [...s.pixels!] } : null;
        },
        pumpSurfaces: (alias: string) => {
          const q = xenonFarm.pumps.find(p => p.comp?.alias === alias);
          return [...(q?.surfaces.values() ?? [])].map(({ key, w, h }) => ({ key, w, h }));
        },
        // live program globals (the XENON-VARS patch): the clip recorder gates
        // Mario's SPACE press on the sprite cache completing ($mode/$demo)
        vars: () => Object.fromEntries([...(P?.vars.entries() ?? [])].map(([k, v]) => [k, v.v])),
        buzzer: {
          soundOn: buzzerAudio.soundOn, wave: buzzerAudio.wave, level: buzzerAudio.level,
          outputLevel: buzzerAudio.outputLevel(), voices: buzzerAudio.voiceCount(),
        },
        world: [...(P?.wsBoundNames() ?? [])].map(n => {
          const r = P?.wsChannels().find(c => c.name === n);
          return r ? { name: r.name, mode: r.mode, manual: r.manual, value: r.value } : null;
        }).filter(Boolean),
      };
    };
  }, []);
  // THE 3-D LAW: EVERY pump's tick pushes each of its surfaces'
  // framebuffers onto their dashboard faces (v1.13.5: it rode the
  // ≤10 Hz notify before — the craft's screens visibly lagged the dock's
  // canvases, "delayed compared to actual screen visibility").
  // The pump fetches pixels for exactly the keys the scene feeds (plus the
  // panels' visible canvases) - 118-buffer crafts stay memcpy-cheap.
  useEffect(() => {
    const removers = xenonFarm.pumps.map(p => p.addCycleHook(() => {
      const eng = engineRef.current;
      if (!eng || p.status !== 'running') return;
      p.setFeedKeys(eng.screenFeedKeys());
      for (const s of p.surfaces.values())
        if (s.pixels) eng.pushScreen(s.key, s.w, s.h, s.pixels);
      // v1.15.6 THE LIVING CRAFT: the PilotSeat flight channels feed the
      // control surfaces (the sim STEP itself is on the global heartbeat —
      // it must run on crafts with NO top-level computer, the dolphin).
      for (const r of p.wsChannels()) {
        const fn = r.label.split(' · ').pop();
        if (fn === 'Roll' || fn === 'Pitch' || fn === 'Yaw')
          simRef.current.writePilot(fn, r.value);
      }
    }));
    return () => removers.forEach(r => r());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xenonCis, farmV]);
  // THE FARM-MOUNT LAW (v1.15.2 fix, we: "space invaders doesnt show its
  // main graphic when loading"): the dock-only deep-link load boots its
  // pump from the screensOpen effect AFTER this effect mounted on an EMPTY
  // farm — with [xenonCis] alone the hook NEVER reached that pump and the
  // craft's physical screens stayed gray. farmV (the farm LINEUP version)
  // re-runs this effect on every attach/detach, so every pump gets the
  // 3-D feed hook the moment it exists.
  useEffect(() => {
    let dead = false;
    import('./components/ToolsDialog').then(m => {
      if (dead) return;
      toolsModRef.current = m;
      setToolsMod(m);
    });
    return () => { dead = true; };
  }, []);
  // v1.6 PLACEMENT staging (Spheroid): the dialog confirmed, the engine
  // ghosts the cluster (movable, CELL-snapped) and the viewport label offers
  // ✕ Cancel / ✔ Build; the commit lands at the user's final cell offset.
  const [placeStage, setPlaceStage] = useState<
    { toolId: string; form: ToolForm; payload: PlacePayload } | null>(null);
  /** v1.7.2 ↩: the cell offset the ghost had when the dialog reopened —
   *  re-staging after a parameter change lands where the user dragged it */
  const pendingPlaceOffset = useRef<[number, number, number] | null>(null);
  // the toast line a finished tool printed under the menu (auto-clears below)
  const [toolMsg, setToolMsg] = useState('');
  // ── v1.15.6 THE 3-D PRESS LAW (we: "button presses onto dashboards and
  //    screens should actually work on the 3d model and propagate"). The
  //    Viewport raycasts and captures the gesture; the SEMANTICS live here:
  //    a button press writes the DEVICE's channel into every computer that
  //    owns it on a data port (xenonFarm.pressDevice routes each pump's OWN
  //    io number), the sim latches/animates it, and the program reads it
  //    next cycle. A screen press is a screenClick on the owning computer's
  //    pump (button_rect evaluates THIS cycle). An UNPOWERED owner warns.
  const warnUnpowered = useCallback((c: XenonComputer) => {
    setToolMsg(`⚠ ${c.alias} has no power — its power port is wired to no source; in-game it stays off`);
  }, []);
  // THE SIM HEARTBEAT (v1.16.2, the dolphin catch): the actuator sim steps
  // on its OWN 25 Hz clock — a craft whose only computers are NESTED (the
  // dolphin) has NO pump, and a pump-cycle-hook sim never ticks there.
  // applyDevicePoses is diff-only: an idle sim costs a map swap.
  useEffect(() => {
    let beats = 0;
    const t = window.setInterval(() => {
      simRef.current.step(0.04);
      engineRef.current?.applyDevicePoses(simRef.current.snapshot());
      energyRef.current.step(0.04);
      itemRef.current.step(0.04, (alias, ch, text) => {
        // the container's content as the data-port KV text, into the bus
        xenonFarm.bus.write(alias, ch, text, {} as never, null);
      });
      engineRef.current?.applyItemFlow(itemRef.current.snapshot());
      if (++beats % 15 === 0) {
        // CHANGE-GATED publish (v1.16.10, the @codeditor catch): an
        // unconditional setState every 0.6 s re-renders the whole Editor —
        // the XenonDialog's CodeMirror doc reconfigured under the
        // highlighting leg. An IDLE craft re-renders NOTHING; a running
        // one rides its own census changes.
        const es = energyRef.current.state();
        const esKey = JSON.stringify(es);
        if (esKey !== energyKeyRef.current) {
          energyKeyRef.current = esKey;
          setEnergy(es);
          if (es.status !== powerStatusRef.current) {
            if (es.status === 'low' || es.status === 'deficit') soundscape.powerStatus(es.status);
            powerStatusRef.current = es.status;
          }
        }
        const ic = itemRef.current.census();
        const icKey = JSON.stringify(ic);
        if (icKey !== itemsKeyRef.current) {
          itemsKeyRef.current = icKey;
          setItems(ic);
        }
        soundscape.craftTick(ic.crafted);
        soundscape.syncLoops(loopWanted(bpRef.current));
      }
    }, 40);
    return () => window.clearInterval(t);
  }, []);
  // THE CODE BUTTON LAW (we: "when I press the code button for a HUD or
  // computer, or minicomputer … I want of course to open its xenoncode"):
  // ONE path opens a part's IDE — the XenonCode ▾ menu and the part widget's
  // ⌨ both route here. Computers boot their pump (auto-boot law: an
  // unpowered one opens WARNED, never silently dead); HUD blocks open the
  // HUD IDE.
  const openCodeFor = useCallback((ci: number) => {
    const comp = xenonCompsRef.current.find(c => c.ci === ci);
    if (comp) {
      setXenonCis(c => (c.includes(ci) ? c : [...c, ci]));
      void xenonFarm.pumpFor(comp).open(comp);
      return;
    }
    if (xenonHuds.some(h => h.ci === ci)) setHudCi(ci);
  }, [xenonHuds]);
  // THE SPARE-BUTTON LAW (we, on the dolphin: the door toggles have no
  // computer attached — "they should still be able to toggle and they
  // toggle the hinges that are in that craft"): a pressed button's channel
  // drives the actuator cabled on the other end of its data port; a button
  // with NOTHING running it and nothing cabled broadcasts the toggled
  // state to the craft's servo actuators (hinge/pivot/track) — a spare
  // door button works its own craft.
  const chanReaders = useCallback((t: PressTarget): XenonComputer[] =>
    xenonCompsRef.current.filter(c => {
      const dev = c.devices.find(d => d.ci === t.ci);
      if (!dev) return false;
      let s = sitesRef.current.get(c.ci);
      if (!s) { s = { chan: chanSites(c.files), rect: rectSites(c.files) }; sitesRef.current.set(c.ci, s); }
      const ch = t.ch ?? 0;
      return s.chan.some(x => x.ch === ch && (x.io === dev.io || (!!dev.alias && x.io === dev.alias)));
    }), []);
  const driveFromPress = useCallback((t: PressTarget, elType: string, v: number) => {
    if (!bp) return;
    const nbrs = dataNeighbours(bp, t.ci);
    if (nbrs.length) { for (const d of nbrs) simRef.current.write(d.ci, t.ch ?? 0, v); return; }
    // broadcast the PRESSED STATE (both directions — a latched toggle's
    // OFF press is the closing command) when NO PROGRAM reads the channel;
    // an alias-registration alone (every named part is alias-addressable)
    // is not a reader
    if (/Button/.test(elType) && chanReaders(t).length === 0)
      for (const a of simRef.current.actuators()) simRef.current.write(a.ci, 0, v);
  }, [bp, chanReaders]);
  const onDashPress = useCallback((t: PressTarget, phase: 'down' | 'up') => {
    const eng = engineRef.current;
    const comps = xenonCompsRef.current;
    const owns = (c: XenonComputer) =>
      c.devices.some(d => d.ci === t.ci)
      || (!!t.surfaceKey && c.screens.some(s => `${s.alias.toLowerCase()}#${s.channel}` === t.surfaceKey))
      || (t.kind === 'face' && c.ci === t.ci);
    const owners = comps.filter(owns);
    const owner = owners[0] ?? (t.kind === 'face' ? comps.find(c => c.ci === t.ci) : undefined);
    if (owner && unpowered(owner.ci)) { warnUnpowered(owner); return; }
    if ((t.kind === 'face' || t.surfaceKey) && t.px !== undefined && t.py !== undefined
      && phase === 'down') {
      for (const c of owners) {
        const p = xenonFarm.pumpForCi(c.ci);
        if (t.kind === 'face' && c.ci === t.ci && t.surfaceKey) p?.screenClick(t.surfaceKey, t.px, t.py);
        else if (t.surfaceKey
          && c.screens.some(s => `${s.alias.toLowerCase()}#${s.channel}` === t.surfaceKey))
          p?.screenClick(t.surfaceKey, t.px, t.py);
      }
      return;
    }
    const elType = t.elType ?? '';
    const k = `${t.ci}:${t.ch ?? 0}`;
    if (elType === 'ToggleButton') {           // latch (wiki ToggleButton.md)
      if (phase !== 'down') return;
      const on = !(latchedRef.current.get(k) ?? false);
      latchedRef.current.set(k, on);
      xenonFarm.pressDevice(t.ci, t.ch ?? 0, on ? 1 : 0, 'ToggleButton');
      simRef.current.setElement(t.ci, t.ch ?? 0, on);
      driveFromPress(t, 'ToggleButton', on ? 1 : 0);
      eng?.pressVisual(t.ci, t.ch ?? 0, on);
      return;
    }
    // momentary: Push/Arrow/Led elements + standalone Push/Arrow parts
    xenonFarm.pressDevice(t.ci, t.ch ?? 0, phase === 'down' ? 1 : 0, elType);
    simRef.current.setElement(t.ci, t.ch ?? 0, phase === 'down');
    driveFromPress(t, elType, phase === 'down' ? 1 : 0);
  }, [unpowered, warnUnpowered, driveFromPress]);
  /** THE POPUP LABEL (we: "it should tell us what channel/ui element … which
   *  xenoncode line … the computer this corresponds to"): the element, the
   *  owning computer + io, and the literal program site (chanSites for a
   *  channel element, rectsAt for a screen pixel — the LAST containing
   *  button_rect, the game's draw-order law). */
  const pressLabel = useCallback((t: PressTarget): string | null => {
    const comps = xenonCompsRef.current;
    const scan = (c: XenonComputer) => {
      let s = sitesRef.current.get(c.ci);
      if (!s) { s = { chan: chanSites(c.files), rect: rectSites(c.files) }; sitesRef.current.set(c.ci, s); }
      return s;
    };
    const parts: string[] = [];
    if (t.kind === 'face') {
      const c = comps.find(k => k.ci === t.ci);
      if (!c) return null;
      parts.push(`${c.alias} · integrated panel`);
      const hits = rectsAt(scan(c).rect, 'main#0', t.px ?? 0, t.py ?? 0);
      const h = hits[hits.length - 1];
      if (h) parts.push(`${h.kind}(${h.x}, ${h.y}, ${h.w}, ${h.h}) @ ${h.file}:${h.line}`);
      if (unpowered(c.ci)) parts.push('⚠ unpowered');
      return parts.join(' — ');
    }
    if (t.surfaceKey) {
      parts.push(`Screen · ${t.surfaceKey}`);
      const c = comps.find(k => k.screens.some(
        s => `${s.alias.toLowerCase()}#${s.channel}` === t.surfaceKey));
      if (c) {
        const hits = rectsAt(scan(c).rect, t.surfaceKey, t.px ?? 0, t.py ?? 0);
        const h = hits[hits.length - 1];
        parts.push(h
          ? `'${c.alias}' · ${h.kind}(${h.x}, ${h.y}, ${h.w}, ${h.h}) @ ${h.file}:${h.line}`
          : `'${c.alias}'`);
        if (unpowered(c.ci)) parts.push('⚠ unpowered');
      }
      return parts.join(' — ');
    }
    const owners = comps.filter(c => c.devices.some(d => d.ci === t.ci));
    parts.push(`${t.elType ?? 'Element'} · ch ${t.ch ?? 0}`);
    for (const c of owners.slice(0, 2)) {
      const dev = c.devices.find(d => d.ci === t.ci)!;
      const s = scan(c).chan.find(s => s.ch === (t.ch ?? 0)
        && (s.io === dev.io || (!!dev.alias && s.io === dev.alias)));
      parts.push(`'${c.alias}'${dev.io >= 0 ? ` io ${dev.io}` : ` "${dev.alias}"`}`
        + (s ? ` · ${s.fn}(…, ${t.ch ?? 0}) @ ${s.file}:${s.line}` : ''));
    }
    if (owners.length && owners.every(c => unpowered(c.ci))) parts.push('⚠ unpowered');
    if (t.kind === 'comp') {
      // the popup names what a bare part ACTUALLY drives: its data-cable
      // neighbours, or the craft's actuators (the SPARE-BUTTON LAW —
      // broadcast when NO PROGRAM reads this channel)
      const nbrs = bp ? dataNeighbours(bp, t.ci) : [];
      const acts = simRef.current.actuators().length;
      if (nbrs.length)
        parts.push(`→ drives ${nbrs.map(d => `'${d.alias || `${d.type.toLowerCase()}-${d.ci}`}'`).join(', ')}`);
      else if (!owners.length)
        parts.push(acts && /Button/.test(t.elType ?? '')
          ? `→ toggles the craft's ${acts} actuator${acts === 1 ? '' : 's'} (no computer attached)`
          : 'no computer reads it');
      else if (acts && /Button/.test(t.elType ?? '') && chanReaders(t).length === 0)
        parts.push(`→ toggles the craft's ${acts} actuator${acts === 1 ? '' : 's'} — no program reads it`);
    }
    return parts.join(' — ');
  }, [unpowered, bp, chanReaders]);
  // v1.13.8 (we: "it doesnt register the built-in screen", craft 3288012440):
  // a Computer's / Crafter's INTEGRATED screen is a physical screen too —
  // the ▣ dock gate must not stop at Dashboard components. The dock's
  // cells list the pump's live surfaces (main#0 + the model-face mirror),
  // and opening the dock arms the pilot keys exactly like the IDE.
  // 🎨 PALETTE window over the viewport (v1.6): the paint alternative to the
  // move/rotate gizmo, opened from the canvas mode widget for the CURRENT
  // selection (block ▸ per-face, component ▸ color1/color2, else the brush).
  const [paintOpen, setPaintOpen] = useState(false);
  // v1.11 THE SINGLE MODE CONTROL (we: "We are either in Triangle or block
  // mode, and we have a button to place triangles or blocks or neither,
  // which is a toggle between one of the two or neither, i.e. edit. not 2
  // sets of 2 flips which is insane"): ONE persisted tri-state — ▤ Blocks /
  // ▵ Triangles are the two PLACE modes (a canvas click lands a cell / drops
  // a pin), ✎ Edit is NEITHER (clicks select anything). The derived tool/
  // blockSub shims keep every internal reading its old vocabulary.
  const [ws, setWsState] = useState<'blocks' | 'tris' | 'parts' | 'edit'>(() => {
    const v = localStorage.getItem('archean-app-ws');
    return v === 'blocks' || v === 'tris' || v === 'parts' || v === 'edit' ? v : 'edit';
  });
  const tool: 'place' | 'edit' = ws === 'edit' ? 'edit' : 'place';
  // ⇄ mirrored placement (blocks AND catalog parts): the twin lands at the
  // mirrored cell/position about the SESSION mirror axis's 0-plane — the
  // game editor's mirror tool. v1.11: the dock's MIRROR WIDGET (⇄ + ⊘ x y z)
  // is the one visible switch for this + mirAxis (which axis mirrors).
  // v1.11 AUTO twin arm (we: "I created a triangle but it was not mirrored,
  // but the craft has two mirror axes visible. This isnt how the game
  // should work, nor our editor"): 'auto' (the default) arms mirrored
  // placement on crafts whose DATA is mirrored across the lit axis — the
  // detected twin pairs that used to draw the extra sheets. A mirrored
  // craft therefore places mirrored pairs (blocks, parts AND triangles)
  // out of the box, like the game. ⇄ is the explicit override (on/off).
  const [mirrorPlace, setMirrorPlace] = useState<'auto' | 'on' | 'off'>(() => {
    const v = localStorage.getItem('archean-app-plsym');
    return v === '1' ? 'on' : v === '0' ? 'off' : 'auto';
  });
  useEffect(() => {
    if (mirrorPlace !== 'auto')
      localStorage.setItem('archean-app-plsym', mirrorPlace === 'on' ? '1' : '0');
  }, [mirrorPlace]);
  // v1.5.21 SETTABLE MIRROR AXIS (⚙ row, user: "mirror axes should be
  // settable. Game is not hardcoded x"): the Engine owns the live value
  // (same localStorage key, its own default); the React twin exists so the
  // ⚙ row re-renders. Engine reads are through engineRef for the callbacks.
  const [mirAxis, setMirAxis] = useState<MirrorAxisOpt>(() =>
    (['x', 'y', 'z', 'off'] as string[]).includes(localStorage.getItem('archean-app-mirror-axis') ?? '')
      ? localStorage.getItem('archean-app-mirror-axis') as MirrorAxisOpt : 'x');
  const onMirrorAxis = useCallback((a: MirrorAxisOpt) => {
    setMirAxis(a);
    engineRef.current?.setMirrorAxis(a);
  }, []);
  // v1.9.2 THE VIEW MENU (⚙ renamed, user: "rename that to view … under view
  // also add a mode for orthogonal"): SKY BACKDROP + ORTHOGRAPHIC rows.
  // The Engine owns the live values (localStorage + its own defaults at
  // attach); the React twins exist so the rows re-render — the mirAxis
  // precedent. onEngine re-syncs both from the engine (engine is truth).
  const [backdrop, setBackdrop] = useState<Backdrop>(() =>
    backdropNames().includes(localStorage.getItem('archean-app-backdrop') ?? '')
      ? localStorage.getItem('archean-app-backdrop') as Backdrop : backdropDefault());
  const onBackdrop = useCallback((b: Backdrop) => {
    setBackdrop(b);
    engineRef.current?.setBackdrop(b);
  }, []);
  const [ortho, setOrtho] = useState(() => localStorage.getItem('archean-app-ortho') === '1');
  const onOrtho = useCallback((v: boolean) => {
    setOrtho(v);
    engineRef.current?.setProjection(v);
  }, []);
  // v1.16.3 FLAT-SHEET skin display (we: "render triangles as a flat surface,
  // 2 sided but flat … toggle option on display"): the engine owns the live
  // hull.ts flag + persistence (ortho precedent); the React twin re-renders
  // the ⚙ View row.
  const [flatSkin, setFlatSkin] = useState(() => localStorage.getItem('archean-app-skin-flat') === '1');
  const onFlatSkin = useCallback((v: boolean) => {
    setFlatSkin(v);
    engineRef.current?.setSkinFlat(v);
  }, []);
  /** the axis for callbacks that run outside React render (engine is truth);
   *  v1.10.5: 'off' = the session mirror is disabled entirely */
  const mirAx = useCallback((): MirrorAxisOpt => engineRef.current?.mirrorAxis ?? 'x', []);
  /** v1.11 UNIFORM MIRROR RULE for prisms (we: "when I moved a triangle, it
   *  didn't see it as mirrored"): the triangle's identified twin (corner-set
   *  reflection, triTwinIndex) rides EVERY edit — the twin INDEX, −1 when
   *  mirroring is off / no pair. A drifted pair stops matching (faux-mirror
   *  semantics), exactly like the block twins' 5 cm rule. */
  const triTwinOf = useCallback((ti: number): { tw: number; a: number } => {
    const ax = mirAx();
    const ctx = ctxRef.current;
    if (ax === 'off' || !ctx) return { tw: -1, a: 0 };
    const tw = triTwinIndex(ctx.bp, ti, ax);
    return { tw, a: ax === 'x' ? 0 : ax === 'y' ? 1 : 2 };
  }, [mirAx]);

  /** the EFFECTIVE twin arm at placement time: explicit on/off, or auto =
   *  the craft's detected twin axes include the lit one (⊘ never twins) */
  const twins = useCallback((): boolean => {
    const ax = mirAx();
    if (ax === 'off') return false;
    if (mirrorPlace === 'on') return true;
    if (mirrorPlace === 'off') return false;
    return (engineRef.current?.craftMirrorAxes() ?? []).includes(ax);
  }, [mirrorPlace, mirAx]);
  /** the mode control's button: switch species/mode and retire the pin
   *  draft + pins with it (they belong to the mode being left) */
  const setWs = useCallback((w: 'blocks' | 'tris' | 'parts' | 'edit') => {
    setWsState(w);
    localStorage.setItem('archean-app-ws', w);
    setTriDraft([]); setPinTi(-1);
    // v1.11 (we: "Main modify should not do anything until you select your
    // block or triangle"): entering a mode clears the previous species
    // selection — ✎ Modify opens EMPTY, the editor appears on pick
    setBlockSel(-1); setTriSel(-1);
    engineRef.current?.clearPins();
  }, []);
  const [triDraft, setTriDraft] = useState<Corner[]>([]);
  const [triSel, setTriSel] = useState(-1);
  // v1.11 PIN placement (we: "putting down three points, which you can move
  // around before and after placing all three"): the index of the COMMITTED
  // triangle whose pins are live-draggable in the viewport (the engine owns
  // the drawing + drag, writes corners back through onPinEdit → the doc).
  const [pinTi, setPinTi] = useState(-1);
  // KSP part placement: the catalog type currently HELD (null = nothing)
  const [placing, setPlacing] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Record<string, { mass: number; module: string }> | null>(null);
  // blueprint download state (overlay): null = nothing in flight / cached
  const [dl, setDl] = useState<{ frac: number | null; bytes: number } | null>(null);
  const [dlErr, setDlErr] = useState(false);
  const [retrySeq, setRetrySeq] = useState(0);
  const forceRef = useRef(false);             // File ▾ Refresh: one-shot re-download
  // v1.9.5 VERSIONED CACHE open gate: a cached copy that is not provably the
  // file as served ('stale' rev / 'unknown' legacy-or-unverified) NEVER opens
  // silently — this state raises the [Download latest] / [Open cached copy]
  // choice; askChoice carries the answer back into the load effect (askSeq
  // re-runs it), so the two doors are ONE code path with the download overlay.
  const [staleAsk, setStaleAsk] = useState<{ state: CraftState; info: CacheInfo | null } | null>(null);
  const askChoice = useRef<'download' | 'cached' | null>(null);
  const [askSeq, setAskSeq] = useState(0);
  /** Esc precedence (v1.7.2): while a tool dialog is open, Esc belongs to
   *  the DIALOG — the viewport's Esc-⇒-place-cancel must stand down */
  const toolOpenRef = useRef<string | null>(null);
  toolOpenRef.current = toolOpen;
  const engineRef = useRef<Engine | null>(null);
  const ctxRef = useRef<EditCtx | null>(null);
  /** the rotation STORAGE law of the craft AS ON DISK (raw for palette-less
   *  sources). normalize() embeds data.colors, so the law must outlive the
   *  migration — the game stores quaternion bytes VERBATIM, so an open→save
   *  may never flip a rotation, and undo re-parses ALREADY-converted text
   *  (the law cannot be re-derived from it; v1.5.11, savefidelity pins). */
  const legacyRef = useRef(true);
  const dirtyRef = useRef(false);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // view options live in their own ⚙ popover (NOT the left parts panel —
  // the user: "the full list of options shouldnt be combined into the main
  // left-hand panel/menu")
  const [optsOpen, setOptsOpen] = useState(false);
  useEffect(() => { if (!toolMsg) return; const t = setTimeout(() => setToolMsg(''), 4000); return () => clearTimeout(t); }, [toolMsg]);

  // ------------------------------------------------------------------ HISTORY
  // 2026-10-20 UNDO/REDO (user: "ALL operations should retain a undo/redo history,
  // and be in edit menu"). Snapshot-based (the backlog design): a COMMIT is
  // the doc's FULL literal text via emitDoc — every mutation path already
  // mirrors bp → doc, and the raw literals keep saves byte-exact. Coalescing
  // is time-windowed: sceneChanged/markDirty re-arm one 450 ms timer, so one
  // gizmo/slider DRAG (dozens of writes) lands as ONE history entry while
  // separate clicks stay separate steps. Undo/redo re-parse the snapshot
  // through the SAME open funnel (parse → normalize → makeCtx → setBp), so
  // engine, doc and ctx can never drift apart; Ctrl+Z / Ctrl+Shift+Z /
  // Ctrl+Y and the Edit ▾ menu both call these.
  const histRef = useRef<HistoryStack | null>(null);
  if (!histRef.current) histRef.current = new HistoryStack(realScheduler, 450);
  const hist = histRef.current;
  hist.onPush = () => setHistTick(t => t + 1);   // setState is stable; no re-render mid-drag
  const [histTick, setHistTick] = useState(0);
  /** the doc's FULL literal text at CALL time; null while no doc is open */
  const docText = useCallback((): string | null =>
    ctxRef.current ? emitDoc(ctxRef.current.doc) : null, []);
  const snapshotSoon = useCallback(() => {
    hist.snapshotSoon(() => docText() ?? hist.current);   // no doc = dedups, no-op
  }, [hist, docText]);
  const flushSnapshot = useCallback(() => {
    hist.flush(() => docText() ?? hist.current);
  }, [hist, docText]);
  const applyHistory = useCallback((state: string) => {
    const d = parseDoc(state);
    normalizeDoc(d);                                // idempotent on snapshots
    const bp = docValue(d) as Blueprint;
    bp.__legacyQ = legacyRef.current;               // the session's generation (the
    ctxRef.current = makeCtx(d, bp);                // snapshot text is post-migration)
    const dirtyNow = state !== hist.origin;
    dirtyRef.current = dirtyNow; setDirty(dirtyNow);
    setSel({ ci: -1, sub: -1 }); setBlockSel(-1); setTriSel(-1); setTriDraft([]);
    setPinTi(-1); engineRef.current?.clearPins();     // v1.11: stale pins never haunt undo
    setPlacing(null); setHit(null);
    engineRef.current?.select(-1);
    if (reloadTimer.current) { clearTimeout(reloadTimer.current); reloadTimer.current = null; }
    // undo/redo = the SAME craft's earlier text: the Viewport load must KEEP
    // the camera (user: "ctrl-z resets view" — it killed tool-option A/B).
    setBpKeepView(true);
    setBp(ctxRef.current.bp);                       // the Viewport reloads it
    setHistTick(t => t + 1);
  }, [hist]);
  const undo = useCallback(() => {
    const s = hist.undo(() => docText() ?? hist.current);
    if (s === null) return;
    applyHistory(s);
  }, [hist, docText, applyHistory]);
  const redo = useCallback(() => {
    const s = hist.redo(() => docText() ?? hist.current);
    if (s === null) return;
    applyHistory(s);
  }, [hist, docText, applyHistory]);

  /** parse → v1→v2 NORMALIZE → doc+ctx → live bp. One funnel for download,
   *  file-open, drag-drop and New craft. */
  const openText = useCallback((text: string) => {
    const { doc, ctx, legacy } = openFunnel(text);   // parse → law stamp → normalize
    legacyRef.current = legacy;
    ctxRef.current = ctx;
    dirtyRef.current = false;
    setDirty(false); setSel({ ci: -1, sub: -1 }); setBlockSel(-1); setPlacing(null);
    hist.open(emitDoc(doc));
    setHistTick(t => t + 1);
    setBpKeepView(false);                           // a craft swap re-frames
    engineRef.current?.setClusterGhost(null);       // a pending tool placement dies with the craft
    setPlaceStage(null);
    setBp(ctxRef.current.bp);
  }, [hist]);
  // LATEST-REF (the v1.5.10 keepView lesson again): the craft-open effect
  // below must fire on a CRAFT SWAP only — `openText`'s identity churns with
  // the history state, and listing it in the deps made an autosave RESTORE
  // re-run the craft open, silently replacing the restored doc with the
  // cached original.
  const openTextRef = useRef(openText);
  openTextRef.current = openText;

  useEffect(() => {
    setBp(null);
    setStaleAsk(null);
    if (!craft) { openTextRef.current(emitNew()); return; }    // New craft (craft === null)
    let dead = false;
    const force = forceRef.current; forceRef.current = false;
    const choice = askChoice.current; askChoice.current = null;
    setDlErr(false);
    (async () => {
      const meta = craftMeta(craft);
      // validate the cache against the catalog BEFORE touching the network:
      // absent → download, fresh → open with ZERO requests (the standing user
      // rule), stale/unknown → the open gate asks (nothing used or replaced
      // silently). A forced refresh or an answered dialog skips the gate.
      if (!force && !choice) {
        const st = await craftState(craft, meta);
        if (dead) return;
        if (st === 'stale' || st === 'unknown') {
          setStaleAsk({ state: st, info: await craftInfo(craft) });
          return;
        }
      }
      const r = await loadCraft(craft, (frac, bytes) => { if (!dead) setDl({ frac, bytes }); },
        force || choice === 'download', fetch, meta);
      if (dead) return;
      setDl(null);
      if (!r) { setDlErr(true); return; }           // no cache + network failed
      openTextRef.current(r.text);                             // cache hit: no overlay, no network
    })().catch(console.error);
    return () => { dead = true; };
  }, [craft, retrySeq, askSeq]);

  const emitNew = () => {
    // doc → text round trip through the SAME doc the editor then keeps
    const d = newCraftDoc();
    return JSON.stringify(docValue(d));
  };

  const markDirty = useCallback(() => {
    if (!dirtyRef.current) { dirtyRef.current = true; setDirty(true); }
    snapshotSoon();                               // 2026-10-20 undo (drag-coalesced)
  }, [snapshotSoon]);
  const bumpRev = useCallback(() => setRev(r => r + 1), []);

  /** block/wire mutations rebuild the merged scene — debounced so slider
   *  drags do not rebuild on every tick */
  const sceneChanged = useCallback(() => {
    markDirty(); bumpRev();
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => engineRef.current?.reload(), 180);
  }, [markDirty, bumpRev, snapshotSoon]);
  /** The IDE's virtual-disk writeback: files live IN the blueprint
   *  (data.hdd.xc_files), so edits go through bp + doc (v1.6.1 rule — the
   *  doc is the save AND the history), and the computer auto-reboots on
   *  save, the game's rule (ide.md "Running the code"). */
  const xenonFiles = useCallback((ci: number, files: XCFile[]) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const list = () => (((ctx.bp.data.components[ci] as any)?.data?.hdd?.xc_files
      ?? []) as { name: string; plain_code?: string }[]);
    const want = new Map(files.map(f => [f.name, f.code]));
    for (let i = list().length - 1; i >= 0; i--)
      if (!want.has(list()[i]!.name)) removeXcFile(ctx, ci, i);
    for (const f of files) {
      const i = list().findIndex(e => e.name === f.name);
      if (i >= 0) setXcFileCode(ctx, ci, i, f.code);
      else insertXcFile(ctx, ci, f.name, f.code);
    }
    markDirty(); bumpRev();
    const next = xenonComputers(ctx.bp).find(c => c.ci === ci);
    if (next) xenonFarm.pumpForCi(ci)?.reload(next);   // game rule: save ⇒ reboot
  }, [markDirty, bumpRev]);

  /** The HUD IDE's writeback (v1.14.0): a HudController's files live at
   *  data.xc_files (NO hdd wrapper — FORMAT §HUD); same doc funnels with
   *  the '' container, same markDirty/bumpRev save law. No pump re-boot:
   *  the HUD VM runtime is slice B (the note rides HudDialog). */
  const hudFiles = useCallback((ci: number, files: XCFile[]) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const list = () => (((ctx.bp.data.components[ci] as any)?.data?.xc_files
      ?? []) as { name: string; plain_code?: string }[]);
    const want = new Map(files.map(f => [f.name, f.code]));
    for (let i = list().length - 1; i >= 0; i--)
      if (!want.has(list()[i]!.name)) removeXcFile(ctx, ci, i, '');
    for (const f of files) {
      const i = list().findIndex(e => e.name === f.name);
      if (i >= 0) setXcFileCode(ctx, ci, i, f.code, '');
      else insertXcFile(ctx, ci, f.name, f.code, '');
    }
    markDirty(); bumpRev();
  }, [markDirty, bumpRev]);


  // v1.8.1 CABLES FOLLOW THE PART: data.pipes is the game's cached route, so
  // a moved part leaves the recorded tips behind. The engine re-anchors the
  // ends onto the LIVE sockets (sockets.ts); this only pokes that cheap
  // cable-pass rebuild on the same drag-debounce rhythm as the reload.
  const pipesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pipesLast = useRef(0);
  // v1.11.3 THE DRAPE LAW follow-through (we: "move toward/attach to where
  // they physical connection it"): LEADING + TRAILING throttle at 250 ms —
  // the pure trailing debounce RESET on every pointermove, so during a
  // continuous gizmo drag the cables only snapped into place AFTER release.
  // Now the first edit rebuilds at once and a drag re-drapes the cables at
  // 4 Hz (the drape cost is the cheap cable pass — rebuildPipes merges a
  // few thousand bars), with a trailing rebuild guaranteeing the final
  // pose after the last event.
  const pipesSoon = useCallback(() => {
    if (!engineRef.current?.pipeInfo().pipes) return;   // craft without cables: no-op
    const now = performance.now();
    const since = now - pipesLast.current;
    if (since >= 250) {
      pipesLast.current = now;
      engineRef.current?.rebuildPipes();
    } else if (!pipesTimer.current) {
      pipesTimer.current = setTimeout(() => {
        pipesTimer.current = null;
        pipesLast.current = performance.now();
        engineRef.current?.rebuildPipes();
      }, 250 - since);
    }
  }, []);

  // ---- v1.6 TOOLS ▸ placement flow (Spheroid): dialog OK → movable ghost +
  // ✕ Cancel / ✔ Build label → Build commits at the final cell offset ------
  const onPlaced = useCallback((tool: { id: string }, form: ToolForm, payload: PlacePayload) => {
    engineRef.current?.setBlockGizmo(-1, false);   // free the widget from a block
    engineRef.current?.select(-1);                 // …and from a component
    // the placement widget IS the tool (the user drags the ghost): raise it
    // even when the VIEW-mode gate holds it down — Cancel/Build restore the
    // gated state (the ⚙ SESSION row itself is untouched, v1.5.1 rule)
    engineRef.current?.setGizmoEnabled(true);
    engineRef.current?.setClusterGhost(payload.blocks ?? null, 0x7dffcf,
      payload.triangles ?? null, payload.rides ?? null);
    // v1.7.2 ↩ BACK: re-staging after a parameter change carries the cell
    // offset the user already dragged to (the shape changed, not the spot)
    const po = pendingPlaceOffset.current;
    pendingPlaceOffset.current = null;
    if (po) engineRef.current?.clusterGhostShift(po);
    setPlaceStage({ toolId: tool.id, form, payload });
  }, []);
  /** ↩ on the placement label: reopen the tool dialog with the SAME form
   *  (the ghost waits behind the backdrop — "change parameters without
   *  starting from scratch") */
  const onPlaceBack = useCallback(() => {
    const st = engineRef.current?.clusterGhostState();
    if (st) pendingPlaceOffset.current = st.offset;
    if (placeStage) setToolOpen(placeStage.toolId);
  }, [placeStage]);
  const onPlaceRotate = useCallback((axis: 'x' | 'y' | 'z') => {
    engineRef.current?.clusterGhostRotate(axis);
  }, []);
  const onPlaceCancel = useCallback(() => {
    // Esc ALSO routes here (the viewport's ✕ twin) — while ↩ re-opened the
    // dialog, Esc belongs to the DIALOG, never kills the waiting ghost
    if (toolOpenRef.current) return;
    engineRef.current?.setClusterGhost(null);
    engineRef.current?.setGizmoEnabled(mode === 'edit' && gizmoOn);
    setPlaceStage(null);
  }, [mode, gizmoOn]);
  const onPlaceBuild = useCallback(() => {
    const st = engineRef.current?.clusterGhostState();
    const stage = placeStage, ctx = ctxRef.current;
    if (!st || !stage || !ctx) return;
    if (!st.valid) { setToolMsg('the placement collides with existing blocks — move it first'); return; }
    const tool = toolsModRef.current?.TOOLS.find(t => t.id === stage.toolId);
    if (!tool?.place) return;
    // the LIVE ghost data: ⟲ quarter-turns (and the drag) happened in the
    // engine — the commit must write what is GHOSTED, not a fresh un-rotated
    // plan (the paint still resolves at commit)
    const live = engineRef.current?.clusterGhostData();
    // v1.9: the lattice RIDES (the balloon's probe tetrahedron) come back
    // with the live data, so the tail batch turns + shifts with the skin.
    const msg = tool.place.commit(stage.form, {
      blocks: live?.blocks ?? stage.payload.blocks,
      triangles: live?.triangles ?? stage.payload.triangles,
      rides: live?.rides ?? stage.payload.rides,
      balloon: stage.payload.balloon,
    }, st.offset, ctx);
    engineRef.current?.setClusterGhost(null);
    engineRef.current?.setGizmoEnabled(mode === 'edit' && gizmoOn);
    setPlaceStage(null);
    sceneChanged();
    setToolMsg(msg);
  }, [placeStage, sceneChanged, mode, gizmoOn]);

  const onEngine = useCallback((e: Engine | null) => {
    engineRef.current = e;
    if (e) {
      // the VIEW MENU rows mirror the engine's persisted state (v1.9.2)
      setBackdrop(e.backdropState().current);
      setOrtho(e.projection() === 'orthographic');
      e.onSelection = s => setSel(s);
      // engine-side writes (sliders/gizmo/twins) mirror bp → doc + dirty
      e.onEdit = ci => {
        const ctx = ctxRef.current;
        const c = ctx?.bp.data.components[ci];
        if (!ctx || !c) return;
        setPos(ctx, ci, 'x', c.position.x); setPos(ctx, ci, 'y', c.position.y); setPos(ctx, ci, 'z', c.position.z);
        setOrientation(ctx, ci, c.orientation ?? { w: 1, x: 0, y: 0, z: 0 });
        markDirty(); bumpRev();
        pipesSoon();                                    // cables re-anchor to the moved sockets
      };
      e.onDataEdit = (ci, key) => {
        const ctx = ctxRef.current;
        const v = ctx?.bp.data.components[ci]?.data?.[key];
        if (!ctx || typeof v !== 'number') return;
        setDataField(ctx, ['data', 'components', ci], key, v);
        markDirty(); bumpRev();
      };
      // BLOCK gizmo commits (v1.5): the engine moved/turned the bp blocks —
      // mirror them into the raw doc AND rebuild the merged hull (v1.5.1 fix:
      // the old markDirty+bumpRev left the SOLID mesh at the old shape — the
      // rotation/move updated the data but never repainted; sceneChanged is
      // the same debounced path the BlockPanel rows use via onApplied).
      e.onBlockEdit = (bis) => {
        const ctx = ctxRef.current;
        if (!ctx) return;
        for (const bi of bis) writeBlockDoc(ctx, bi);
        sceneChanged();
      };
      // v1.11 PIN drags (the triangle pin editor): the engine moved corner
      // i of triangle ti to a new lattice corner — write the record (bp was
      // mutated by setTriCornerAll), mirror EXACTLY the changed fields into
      // the doc (v1.6.1: the doc is the save and the undo history) and
      // repaint on the debounced merged-skin reload. A REFUSED move (32-slot
      // window / coincident corners) writes nothing: the reload's
      // refreshPins() re-reads the bp and snaps the pin back honestly.
      // v1.12.5: the twin-pair laws (mirrored corner + σ winding swap,
      // twin lookup BEFORE the self mutation, ATOMIC clone refusals) live in
      // engine/pinedit.ts — pinned at the vitest tier (pinedit.test.ts).
      e.onPinEdit = (ti, i, g) => {
        const ctx = ctxRef.current;
        if (!ctx) return;
        if (applyPinEdit(ctx, triTwinOf, ti, i, g as Corner)) sceneChanged();
      };
      // v1.11: a DRAFT-pin drag (before the third lands) moves the corner in
      // the engine — mirror it into React's triDraft so the COMMIT's third
      // click reads the dragged positions, not the pre-drag ones (the engine
      // owns the drag, React mirrors — one source of truth for the corners).
      e.onPinDraft = (pts) => setTriDraft(pts.map(p => [...p] as Corner));
      // v1.11 CENTROID WIDGET: ✥ moves ALL THREE corners by whole cells
      // (shiftTriCells), ⟳ writes the engine's lattice-quantised rotated
      // corners atomically (setTriCornersAll). Both mirror bp → the changed
      // doc fields (v1.6.1: the doc is the save and the history) and repaint
      // on the debounced merged reload; a refused record (window / coincident)
      // writes nothing → the engine snaps the pins + widget back. Returns
      // success so the engine knows to snap back. v1.12.5: the twin laws
      // (mirrored delta, mirror-conjugate rotation, lookup-before-mutation,
      // ATOMIC clone refusals) live in engine/pinedit.ts.
      e.onPinShift = (ti, d) => {
        const ctx = ctxRef.current;
        if (!ctx) return false;
        const ok = applyPinShift(ctx, triTwinOf, ti, d);
        if (ok) sceneChanged();
        return ok;
      };
      e.onPinRotate = (ti, c, dq) => {
        const ctx = ctxRef.current;
        if (!ctx) return false;
        const ok = applyPinRotate(ctx, triTwinOf, ti, c, dq);
        if (ok) sceneChanged();
        return ok;
      };
    }
    setEngine(e);
  }, [markDirty, bumpRev, sceneChanged, pipesSoon]);
  const [engine, setEngine] = useState<Engine | null>(null);

  // mode gating: the gizmo lives ONLY in the merged Edit mode (v1.4 rule
  // kept: a component picked there selects and must be movable/rotatable);
  // Wire forces cables visible; the wind tunnel runs ONLY in Wind mode (the
  // solve is bounded but never free). Leaving a mode also drops any stale
  // PICK CHIP.
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    setHit(null);
    e.setGizmoEnabled(mode === 'edit' && gizmoOn);
    if (mode === 'wire') e.setOption('pipes', true);
    if (mode !== 'edit') setBlockSel(-1);
    e.setWindTunnel(mode === 'aero');
  }, [mode, gizmoOn, engine]);

  // BLOCK widget (v1.5): a SELECTED block owns the gizmo in the EDIT flavor —
  // cell-snapped arrows + 90°-snap rings; a selected COMPONENT takes it back.
  // v1.7.1: the block's SIMILAR TWIN always moves/turns in unison (mirrored);
  // mirrorPlace (⇄) only rides as the reported placement-twin state.
  // v1.11 (we: "Placing a block, you can choose to move/rotate/scale it"):
  // the gate covers the PLACE flavor too — a freshly PLACED block is
  // selected, so the widget lands on it at once (✥ move · ⟳ turn · ⤢ stretch).
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    const on = mode === 'edit' && blockSel >= 0 &&
      sel.ci < 0 && sel.sub < 0 && gizmoOn;
    e.setBlockGizmo(on ? blockSel : -1, twins());
  }, [mode, tool, blockSel, sel, mirrorPlace, twins, gizmoOn, rev, engine]);
  // v1.11 FLAVOUR GATE for the TRIANGLE CENTROID WIDGET (we: "nor does it
  // respect my place/edit mode"): the widget is an EDIT-flavour tool (select
  // → gizmo); pins show in both flavors (place-then-drag is the ritual).
  useEffect(() => {
    engineRef.current?.setTriWidgetOn(mode === 'edit' && tool === 'edit' && gizmoOn && pinTi >= 0);
  }, [mode, tool, gizmoOn, pinTi, engine]);

  /** Delete a selected component (v1.4): bp splice + doc mirror TOGETHER,
   *  the per-component orig/applied save-sync tables shift with it, the
   *  scene rebuilds on the debounce. v1.5.12 (the Jimmy incident): cables +
   *  subgrid joins reference FLATTENED component indices, so the splice MUST
   *  be preceded by pruneCompRefs — references to the deleted subtree are
   *  dropped (its cables go with it), later references renumber. Leaving
   *  them stale silently re-wires the craft on paper ("computer's power
   *  cable connected to an aileron"), and the game re-saves the mangled
   *  references instead of pruning them. v1.8.0 UNIFORM MIRROR RULE:
   *  whatever the selection does, its twin pair does — deleting a part
   *  deletes its twins too. */
  const deleteComp = useCallback((ctx: EditCtx, ci: number) => {
    const idx = new Set<number>([ci]);
    for (const { j } of engineRef.current?.twinPairsOf(ci) ?? []) idx.add(j);
    pruneCompRefs(ctx, idx);
    for (const k of [...idx].sort((a, b) => b - a)) {
      ctx.bp.data.components.splice(k, 1);
      docArrayRemoveAt(ctx.doc, ['data', 'components'], k);
      ctx.orig.splice(k, 1);
      ctx.applied.splice(k, 1);
    }
    engineRef.current?.select(-1);
    engineRef.current?.setCompGhost(null);
    sceneChanged();
  }, [sceneChanged]);

  /** 2026-10-20 DELETE key paths (the panel buttons and the keyboard share these).
   *  Block: the BlockPanel geometry — self + its SIMILAR TWIN, bp + doc
   *  together (the old "a bare key must never touch bp without the doc
   *  mirror" rule; the key now routes through here, so it is mirrored). */
  const deleteBlock = useCallback((ctx: EditCtx, bi: number) => {
    const tw = blockMirrorTwin(ctx.bp, bi, mirAx());
    for (const i of [bi, ...(tw >= 0 ? [tw] : [])].sort((a, b) => b - a)) {
      ctx.bp.data.blocks.splice(i, 1);
      docArrayRemoveAt(ctx.doc, ['data', 'blocks'], i);
    }
    engineRef.current?.setBlockGizmo(-1, false);
    setBlockSel(-1);
    sceneChanged();
  }, [sceneChanged]);
  /** v1.11 widget ▵ (we: "Button should exist to turn block to triangle when
   *  selecting a block, on its widget"): convert the SELECTED block into the
   *  hull skin of its FREE faces — the scoped hullify law (adjacency culling
   *  sees the whole hull, so walls glued to neighbours emit nothing; the
   *  game's outward + flat authoring convention, v1.5.12). The block goes,
   *  the triangles land through the appendTrianglesDoc funnel (bp AND doc —
   *  v1.6.1: the doc is the save and the history). v1.8.0 uniform mirror
   *  rule: the block's IDENTIFIED similar twin converts with it. */
  /** v1.11: paint the SELECTED triangle (the 🎨 window + the Triangles-mode
   *  brush + the face rows) — bp AND doc (v1.6.1), repaint on the debounce.
   *  v1.8.0 UNIFORM MIRROR RULE (we: "I modified color on a triangle, with
   *  mirroring on and it did not carry over to its twin"): the identified
   *  twin paints the SAME face slots — a mirrored prism's face f is its own
   *  front/back/wall (the construction colour swap made it so), so the paint
   *  mapping is the identity. v1.12.5: engine/pinedit.ts applyTriPaint. */
  const paintTriFaces = useCallback((slot: number, faces: number[]) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    applyTriPaint(ctx, triTwinOf, triSel, slot, faces);
    sceneChanged();
  }, [triSel, sceneChanged, triTwinOf]);
  const paintTri = useCallback((slot: number) => paintTriFaces(slot, [0, 1, 2, 3, 4]),
    [paintTriFaces]);

  /** v1.11 FLIP (we: "it should be possible to flip it just like the in
   *  game triangles, determining whether it goes outside or inside"): the
   *  winding reverses (v1↔v2) so the normal — the FRONT (colours[0]) side —
   *  points the other way; the geometry stays. The face colours follow the
   *  edge relabelling (front↔back, the v0-v1 ↔ v2-v0 walls). The FLIP IS
   *  PAIR-WIDE. v1.12.5: engine/pinedit.ts applyTriFlip. */
  const triFlip = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    applyTriFlip(ctx, triTwinOf, triSel);
    sceneChanged();
  }, [triSel, sceneChanged, triTwinOf]);

  const blockToTriangles = useCallback(() => {
    const ctx = ctxRef.current, e = engineRef.current;
    if (!ctx || blockSel < 0) return;
    const b = ctx.bp.data.blocks[blockSel];
    if (!b || b.type === 255) return;
    const twin = blockMirrorTwin(ctx.bp, blockSel, mirAx());
    const idxs = twin >= 0 ? [blockSel, twin] : [blockSel];
    const tris: Triangle[] = [];
    for (const i of idxs) tris.push(...blockSkinTris(ctx.bp, i));
    if (!tris.length) { setToolMsg('every face of this block is glued to a neighbour — nothing to skin'); return; }
    appendTrianglesDoc(ctx, tris);
    for (const i of [...idxs].sort((a, c) => c - a)) {
      ctx.bp.data.blocks.splice(i, 1);
      docArrayRemoveAt(ctx.doc, ['data', 'blocks'], i);
    }
    setBlockSel(-1);
    e?.setBlockGizmo(-1, false);
    sceneChanged();
    setToolMsg(`▵ Block → ${tris.length} hull triangle${tris.length === 1 ? '' : 's'}${twin >= 0 ? ' (twin included)' : ''} — Ctrl+Z restores the block`);
  }, [blockSel, sceneChanged]);

  const deleteTri = useCallback((ctx: EditCtx, ti: number) => {
    // v1.11 uniform rule: the twin prism deletes with it (v1.8.0 law)
    const { tw } = triTwinOf(ti);
    for (const i of [ti, ...(tw >= 0 ? [tw] : [])].sort((a, b) => b - a)) {
      ctx.bp.data.triangles?.splice(i, 1);
      docArrayRemoveAt(ctx.doc, ['data', 'triangles'], i);
    }
    setTriSel(-1);
    // v1.11: the pin editor indexes triangles by position — a splice shifts
    // them, so the pins are dropped (they would ride the NEIGHBOUR's corners)
    setPinTi(p => { if (p >= 0) engineRef.current?.clearPins(); return -1; });
    sceneChanged();
  }, [sceneChanged, triTwinOf]);

  const edits: EditApi = useMemo(() => ({
    compField: (ctx, ci, key, v) => { setCompField(ctx, ci, key, v); markDirty(); bumpRev(); },
    compColor: (ctx, ci, which, field, v) => {
      // v1.8.0 UNIFORM MIRROR RULE: the twin pair takes the same appearance
      setCompColor(ctx, ci, which, field, v);
      for (const { j } of engineRef.current?.twinPairsOf(ci) ?? [])
        setCompColor(ctx, j, which, field, v);
      sceneChanged();                       // materials rebuild on the debounced reload
    },
    pos: (_ctx, ci, ax, v) => { engineRef.current?.setFilePosAxis(ci, ax, v); },
    beginRot: ci => engineRef.current?.beginRotEdit(ci),
    quatDelta: (ctx, ci, p, y, r) => {
      const q = engineRef.current?.setCompQuatDelta(ci, p, y, r);
      if (q) setOrientation(ctx, ci, q);
    },
    dataField: (ctx, path, k, v) => { setDataField(ctx, path, k, v); bumpRev(); },
    reset: (ctx, ci) => {
      resetComponent(ctx, ci);
      setInspKey(k => k + 1); bumpRev();
    },
    deleteComp,
  }), [bumpRev, markDirty, sceneChanged, deleteComp]);

  const save = useCallback((as?: string) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const text = serializeSave(ctx);
    // 2026-10-20: serializeSave also SYNCS the occupancy/type-255 mirrors (it
    // mutates bp + doc) — commit that as the open history group's text so
    // undo can never resurrect a pre-sync mirror state.
    flushSnapshot();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = as ?? 'blueprint.json'; a.click(); URL.revokeObjectURL(a.href);
    dirtyRef.current = false; setDirty(false);
    // a save is worth a shadow copy too; after one the older shadows matter
    // less — keep the newest few (v1.13.x autosave)
    void autosave(autosaveKeyRef.current, autosaveLabelRef.current, text)
      .then(() => pruneAfterSave(autosaveKeyRef.current))
      .then(() => countAutosaves().then(setAutosaveCount));
  }, [flushSnapshot]);

  const openFile = useCallback(() => fileRef.current?.click(), []);
  const readFile = useCallback((f: File) => {
    f.text().then(openText).catch(console.error);
  }, [openText]);

  // keyboard: g/o/h toggles, Ctrl+S save, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y
  // UNDO/REDO (2026-10-20 — the Edit ▾ menu items call the same pair), Delete /
  // Backspace deletes the selection in the EDIT mode (2026-10-20 user rule: "when
  // I have something selected in edit mode, [delete] key should delete" —
  // component ▸ block (+twin) ▸ triangle precedence; every path mutates bp
  // AND the doc together, the stale NOTE below was the old excuse), and Esc
  // drops the HELD part else deselects (KSP pickup rule). Undo/redo sit
  // BEHIND the input guards so a focused text field keeps native Ctrl+Z.
  const toggleOpt = useCallback((k: keyof ViewOptions, on: boolean) => {
    const e = engineRef.current;
    if (!e) return;
    e.setOption(k, on);
    setOpts(e.getOptions());
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); return; }
      // F5 RUN (v1.13.25, we: "F5 should run the code, so long as a computer
      // or screen window is open, otherwise it does a refresh"): with the ▣
      // Screens dock up and no IDE window, the pump re-boots its computer
      // from disk; with the IDE open its OWN F5 handler owns the key (it can
      // save a draft first); with NEITHER window open the key stays the
      // browser's (page refresh).
      if (e.key === 'F5') {
        if (screensOpen && xenonCis.length === 0) {
          e.preventDefault();
          // v1.15.6 POWER LAW: F5-RUN on an UNPOWERED computer warns first
          // (in-game it cannot run); the dev may still boot it (we are a
          // dev tool) — the warning stays visible while it runs.
          const ac = xenonFarm.active()?.comp;
          if (ac && unpowered(ac.ci)) warnUnpowered(ac);
          xenonFarm.active()?.reboot();
        }
        return;
      }
      // F6 STOP (v1.13.31, we: "f6 should mean stop"): the twin of the F5
      // law — with the ▣ Screens dock up and no IDE window, F6 parks the
      // pump's computer at its EXECUTING line (status stopped, values
      // editable); with the IDE open its OWN F6 handler owns the key;
      // with NEITHER window open the key stays the browser's.
      if (e.key === 'F6') {
        if (screensOpen && xenonCis.length === 0) { e.preventDefault(); xenonFarm.active()?.stopRunning(); }
        return;
      }
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault(); if (e.shiftKey) redo(); else undo(); return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault(); redo(); return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && mode === 'edit') {
        const ctx = ctxRef.current;
        if (!ctx || placing) return;
        if (sel.ci >= 0) { e.preventDefault(); deleteComp(ctx, sel.ci); return; }
        if ((ws === 'tris' || ws === 'edit') && triSel >= 0) { e.preventDefault(); deleteTri(ctx, triSel); return; }
        if (blockSel >= 0) { e.preventDefault(); deleteBlock(ctx, blockSel); return; }
      }
      // v1.11 PLACEMENT REWRITE (we: "Choosing a block size before placing
      // it shouldn't be a thing"): the v1.10.6 brush-resize keys (x/y/z pick
      // axis, [ ] grow, s square) are GONE — every click lands a 1×1×1
      // block and the WIDGET scales it after (✥/⟳/⤢). Size lives in the
      // dock's THIS BLOCK rows and on the ⤢ gizmo, not on the brush.
      const map: Record<string, keyof ViewOptions> = { g: 'grid', o: 'occ', h: 'hull', w: 'wire' };
      // v1.13.2: while a dash view is armed, WASD/↑↓F belong to the COCKPIT
      // (the 'w' run key in Chip's Mario is NOT a wireframe toggle then)
      if (map[e.key] && !pilotKeysActive()) {
        const cur = engineRef.current?.getOptions();
        if (cur) toggleOpt(map[e.key]!, !cur[map[e.key]!]);
      }
      // v1.9.2: '5' flips the PROJECTION (Blender's numpad-5 habit — the
      // user's ortho mode lives in the View menu; the key is the fast path).
      // v1.13.8: the digit row is the cockpit's Aux ladder — the cockpit
      // claims '5' too while pilot keys are bound (same law as 'w').
      if (e.key === '5' && !e.ctrlKey && !e.metaKey && !e.altKey && !pilotKeysActive()) {
        const on = engineRef.current?.projection() !== 'orthographic';
        setOrtho(!!on);
        engineRef.current?.setProjection(!!on);
      }
      if (e.key === 'Escape') {
        setPaintOpen(false);                           // 🎨 palette window first
        engineRef.current?.placeDragEnd();             // smear-drag yields the orbit back
        if (placing) {                              // KSP: drop the HELD part first
          setPlacing(null);
          engineRef.current?.setCompGhost(null);
          return;
        }
        // v1.11 PIN editor: Esc leaves the pin tool (drop the draft / the
        // edited triangle's pins) before it touches the selection
        if ((ws === 'tris' || ws === 'edit') && (triDraft.length || pinTi >= 0)) {
          setTriDraft([]); setPinTi(-1);
          engineRef.current?.clearPins();
          return;
        }
        engineRef.current?.select(-1); setBlockSel(-1);
      }
    };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, [save, toggleOpt, placing, mode, ws, sel, blockSel, triSel,
    triDraft, pinTi, brush, undo, redo, deleteComp, deleteBlock, deleteTri,
    screensOpen, xenonCis, unpowered, warnUnpowered]);

  // blocks-mode canvas handling: place (brush/logical continuation) or
  // select, via engine.pickCell.
  /** the ghost preview under the cursor (BLOCKS-place): brush footprint at
   *  the pick cell, or the game's Shift rule — over an existing block the
   *  ghost becomes the block that LOGICALLY CONTINUES it (complementBlock);
   *  red ghost when the footprint collides (the click is then refused). */
  const ghostRef = useRef<{ x: number; y: number; shift: boolean } | null>(null);
  const computeGhost = useCallback((clientX: number, clientY: number, shift: boolean) => {
    ghostRef.current = { x: clientX, y: clientY, shift };
    const e = engineRef.current, ctx = ctxRef.current;
    if (!e || !ctx) return;
    if (placing && mode === 'edit') {           // HELD part: its ghost
      const p = e.pickPlacePoint(clientX, clientY);
      e.setCompGhost(p ? { type: placing, point: p } : null, twins());
      return;
    }
    // v1.11 (we: "dont show the block when placing a component"): the
    // brush ghost belongs to + Blocks ONLY — + Parts and + Triangles hover clean
    if (mode !== 'edit' || ws !== 'blocks') { e.setPlaceGhost(null); return; }
    const r = e.pickCell(clientX, clientY);
    if (!r || (r.kind === 'ground' && !narrow)) { e.setPlaceGhost(null); return; }
    const info = shift && r.bi >= 0 ? blockInfo(ctx.bp, r.bi) : null;
    // v1.11: the brush lands ONE CELL (size 0) — scale comes after the click
    // (widget ⤢ / dock rows); Shift keeps the game's logical continuation,
    // which copies the aimed block's own size (the game's rule).
    const spec = info
      ? complementBlock(info, [cellIndex(r.point[0]), cellIndex(r.point[1]), cellIndex(r.point[2])], r.nrm)
      : { cell: r.cell, ...brushSpec(brush) };
    e.setPlaceGhost({ ...spec, valid: !cellOverlap(ctx.bp, spec.cell, spec.size), complement: !!info });
  }, [mode, ws, placing, mirrorPlace, twins, brush, narrow]);

  // ghost lifecycle: re-aim when the brush changes (live preview of the
  // panel), drop it when the flavor/mode leaves block-placement
  useEffect(() => {
    const h = ghostRef.current;
    if (!h) return;
    if (mode === 'edit' && ws === 'blocks') computeGhost(h.x, h.y, h.shift);
    else { engineRef.current?.setPlaceGhost(null); ghostRef.current = null; }
  }, [mode, ws, brush, computeGhost]);

  // BLOCKS selection highlight (v1.4 "blocks don't yet highlight"): the
  // picked block gets the golden overlay and its SIMILAR TWIN rides along
  // dimly (blockMirrorTwin — same plane as the component twins). v1.7.1: the
  // twin is IDENTIFIED on EVERY selection, ⇄ or not. v1.8.0 UNIFORM MIRROR
  // RULE: blockTwinIssues flags a mirror-conflicting FAUX-MIRROR (shape,
  // size, material or face-paint mismatch on the mirrored footprint) — the
  // twin overlay then rides RED and the Viewport shows the ⚠ popup.
  // v1.10.6: the dock LIST's hovered row PREEMPTS the selection (wire-mode
  // previewHover law — the selection returns the moment the list is left).
  useEffect(() => {
    const e = engineRef.current, ctx = ctxRef.current;
    if (!e) return;
    const hi = blockHover >= 0 ? blockHover : blockSel;
    if (mode === 'edit' && hi >= 0 && ctx) {
      const tw = blockTwinIssues(ctx.bp, hi, mirAx());
      e.setBlockHighlight(hi, tw?.twin ?? -1, tw?.issues ?? [], tw?.info ?? false);
    } else e.setBlockHighlight(-1);
  }, [mode, blockSel, blockHover, rev, engine]);

  // 2026-10-20: a SELECTED TRIANGLE rides the gold prism highlight — selection used
  // to be invisible in the 3D view (only the panel changed), part of the
  // "triangles refuse to select properly" report. Left with the sub-tab.
  // v1.10.6: the dock list's hovered triangle preempts it (same law).
  useEffect(() => {
    // v1.11: the merged ✎ Edit selects prisms too — the gold prism highlight
    // is NOT gated on the triangles dock anymore (a selected prism that never
    // lit gold read as "selection does nothing")
    engineRef.current?.setTriHighlight(mode === 'edit'
      ? (triHover >= 0 ? triHover : triSel) : -1);
  }, [mode, triSel, triHover, rev, engine]);

  // the CATALOG ghost (v1.4): while a part is HELD, hovering the viewport
  // docks a translucent preview at the surface (⇄ adds the mirrored twin
  // box) — placement now works like the blocks ghost. v1.5: the PLACE flavor
  // holds parts in the Blocks workspace too (one panel, both dockers).
  // v1.5.6: the ghost is the REAL translucent model, and a press-DRAG on a
  // surface SMEARS the part along the hull aiming its back (Viewport drives
  // engine.placeDragStart/Move/End; the release lands it).
  useEffect(() => {
    if (!engine) return;
    if (!placing || mode !== 'edit') { engine.placeDragEnd(); engine.setCompGhost(null); }
  }, [placing, mode, engine]);

  /** v1.11 THE FLAVOUR LAW (we: "nor does it respect my place/edit mode.
   *  This is wrong." + "blocks and triangles … should be merged"):
   *  ✚ PLACE clicks ONLY PLACE (the species tab picks the tool: ▤ block
   *  brush · ▵ triangle pins) and never select; ✎ Edit clicks ONLY SELECT
   *  — the MERGED editor picks WHATEVER you clicked (part · prism · block)
   *  under one widget law (gizmo + pins + modebox). */
  const onBlockPick = useCallback((clientX: number, clientY: number, shift: boolean,
    openWidget: () => void) => {
    const e = engineRef.current, ctx = ctxRef.current;
    if (!e || !ctx) return;
    const r = e.pickCell(clientX, clientY);
    if (!r) {
      // v1.6: clicking EMPTY SPACE (sky) in ✎ Modify clears ALL the
      // selection (block overlay, pins, component) — a stale golden overlay
      // the user believed cleared was the report; place modes keep their ghost.
      if (ws === 'edit') {
        setBlockSel(-1); e.select(-1);
        setTriSel(-1); setTriDraft([]); setPinTi(-1);
        e.setPinDraft(null); e.clearPins();
      }
      return;
    }
    // a COMPONENT hit selects in BOTH flavors (v1.4 law — the inspector +
    // gizmo take the part; PLACE only "places" on surfaces, a part you
    // clicked directly is a selection, and the pin-flow tests pin this)
    if (r.kind === 'comp' && r.ci >= 0) {
      setBlockSel(-1); setTriSel(-1); setPinTi(-1); e.clearPins();
      e.select(r.ci);          // the gizmo rides it
      e.flyTo(r.ci);           // like the old Edit mode: click flies in
      openWidget();            // ⊘/✥/⟳/⇄ at the part
      // v1.11 (we: "switch to that automatically when you click edit for
      // one of those"): selecting a part in ✎ Modify opens the + Parts
      // subpanel — the inspector lives there now
      if (ws === 'edit') setWs('parts');
      return;
    }
    // ── ▵ TRIANGLES: surface clicks drop PINS, never select ────────────
    if (ws === 'tris') {
        // v1.11 PIN PLACEMENT (we: "putting down three points, which you
        // can move around before and after placing all three of them, it
        // should look like a pin, and an arrow should point down/up for the
        // direction of the triangle"): every click drops a PIN on the
        // lattice corner of the aimed surface — a prism face is a placeable
        // surface too, placement mode NEVER selects. Pins are draggable
        // before the third lands; the third click commits the prism and the
        // pins STAY (drag one → engine.onPinEdit rewrites its corner).
        if (pinTi >= 0 && triDraft.length === 0) { setPinTi(-1); e.setPinEdit(-1); }
        const g = cornerOf(r.point);
        const next = [...triDraft, g];
        if (next.length < 3) {
          setTriDraft(next);
          e.setPinDraft(next, brush.slot);
          return;
        }
        // v1.11 (we: "colors dont seem to apply to the triangles when
        // picked"): the triangle inherits the BRUSH — its palette slot on
        // all five faces and its material — one paint story for both
        // species. Per-face colours stay editable on the triangle itself.
        const tri = triangleFromCorners(next[0] as [number,number,number], next[1] as [number,number,number],
          next[2] as [number,number,number],
          [brush.slot, brush.slot, brush.slot, brush.slot, brush.slot]);
        if (tri) (tri as unknown as { material: number }).material = brush.material ?? 0;
        setTriDraft([]);
        if (!tri) { e.setPinDraft(null); return; }
        // v1.11 (we: "mirror for triangle is not placed"): with the twin arm
        // on, the mirrored twin lands too — corners reflected (g → 12 − g),
        // winding flipped so the twin's FRONT faces the mirrored way, side
        // colours relabelled (mirroredTriangle).
        const batch = [tri];
        if (twins()) {   // AUTO on a mirrored craft (v1.11)
          const mt = mirroredTriangle(tri, mirAx() as 'x' | 'y' | 'z');
          if (mt) batch.push(mt);
        }
        // v1.6.1: the shared bp+doc append (files without data.triangles)
        const at = ctx.bp.data.triangles?.length ?? 0;
        appendTrianglesDoc(ctx, batch);
        setTriSel(at);
        setPinTi(at);
      e.setPinEdit(at, brush.slot);   // pins STAY: drag them to fix
        sceneChanged();
      return;
    }    // ── + PARTS: comp picks (above) inspect AND modify; a held part lands
    //    through the place flow; a bare surface click clears species picks
    if (ws === 'parts') {
      setBlockSel(-1); setTriSel(-1);
      return;
    }
    // ── ▤ BLOCKS: surface clicks dock a cell ─────────────────────────────
    if (ws === 'blocks') {
      // v1.11.1 PHONE: the GRID PAD is furnishable too (we: "placing blocks
      // on phone exclusively works on existing geometry, not on e.g. grid,
      // preventing movement") — the pickCell ground hit carries the pad
      // point + the +y normal, so r.cell is the cell that STANDS ON the pad.
      // Desktop keeps the v1.11 constructor law (ground refuses, sky clears).
      if (r.kind === 'ground' && !narrow) { setBlockSel(-1); return; }
      const info = shift && r.bi >= 0 ? blockInfo(ctx.bp, r.bi) : null;
      const spec = info
        ? complementBlock(info, [cellIndex(r.point[0]), cellIndex(r.point[1]), cellIndex(r.point[2])], r.nrm)
        : { cell: r.cell, ...brushSpec(brush) };
      if (cellOverlap(ctx.bp, spec.cell, spec.size)) return;   // the red ghost refuses
      setBlockSel(placeBlock(ctx, spec, twins(), mirAx()));
      sceneChanged();
      // the placed block is SELECTED so the widget (✥ ⟳ ⤢) is one click away
      openWidget();
      // the game keeps the ghost under the cursor after a placement — re-aim
      computeGhost(clientX, clientY, shift);
      return;
    }
    // ── ✎ MODIFY: clicks select — the MERGED species-agnostic pick ──────
    if (r.kind === 'tri') {
      // a prism click SELECTS the triangle: pins + CENTROID widget (a
      // persisted ⤢ mode reads as ✥ here — a triangle has no scale)
      const t = triAt(ctx.bp, r.point);
      if (t >= 0) {
        setTriSel(t); setBlockSel(-1); setTriDraft([]); setPinTi(t);
        e.select(-1);
        if (e.gizmoModeNow() === 'scale') e.setGizmoMode('translate');
        e.setPinEdit(t, brush.slot);
        openWidget();
        return;
      }
    }
    if (r.bi >= 0) {
      // a block click SELECTS the block — golden highlight + the BLOCK
      // widget (cell arrows / 90° rings / ⤢ stretch)
      e.select(-1); setTriSel(-1); setPinTi(-1); e.clearPins();
      setBlockSel(r.bi);
      openWidget();
      return;
    }
    // ground in EDIT clears the selection (nothing valid was clicked)
    setBlockSel(-1); e.select(-1);
  }, [brush, mirrorPlace, twins, triDraft, pinTi, sceneChanged, computeGhost, ws, setWs, narrow]);

  /** CATALOG placement (KSP part pickup): land the HELD type at the picked
   *  surface — bp + doc together, then the debounced scene reload; the part
   *  auto-selects once the fresh roots exist (load() clears the selection,
   *  so the select rides just behind the 180 ms reload). Like KSP, one
   *  click places ONE part and the hand empties. v1.5.6: the click IS the
   *  release of the Viewport's smear-drag — yaw (radians about the world ŷ)
   *  is where the drag pointed the part's BACK (+z, the nose is −z); a plain
   *  click carries yaw 0 (the old identity pose). */
  const onPlacePoint = useCallback((clientX: number, clientY: number, yaw = 0) => {
    const e = engineRef.current, ctx = ctxRef.current;
    if (!e || !ctx || !placing) return;
    const p = e.pickPlacePoint(clientX, clientY);
    if (!p) return;
    setPlacing(null);
    const type = placing;
    const module = e.manifest?.[type]?.module ?? 'ARCHEAN_general';
    // view-space heading → the FILE quaternion VERBATIM (v1.5.11 one raw law:
    // the display frame IS the file frame, so the stored quaternion is the
    // yaw itself — the retired per-generation conjugate would place the part
    // turning the OPPOSITE way from where the drag pointed on palette files)
    const qFile = qAxisAngle([0, 1, 0], yaw);
    const comp = newComponent(type, module, p, qFile);
    ctx.bp.data.components.push(comp as never);
    const at = ctx.bp.data.components.length - 1;
    docArrayInsert(ctx.doc, ['data', 'components'], at, docFromValue(comp));
    if (twins()) {   // AUTO on a mirrored craft (v1.11)
      // ⇄ twin: mirrored POSITION, same orientation — exactly the geometry
      // sym.ts indexes (mask bit 1), so the pair co-selects and every later
      // edit propagates through the established twin path.
      // v1.10.5: with the session plane ⊘ off, no twin lands at all.
      const ma = mirAx();
      const tp = p.map((v, k) => (k === mirrorAxisIdx(ma) ? -v : v)) as [number, number, number];
      const twin = newComponent(type, module, tp, qFile);
      ctx.bp.data.components.push(twin as never);
      docArrayInsert(ctx.doc, ['data', 'components'], ctx.bp.data.components.length - 1, docFromValue(twin));
    }
    sceneChanged();
    setTimeout(() => engineRef.current?.select(at), 350);
  }, [placing, mirrorPlace, twins, sceneChanged]);

  const setGizmo = useCallback((on: boolean) => {
    setGizmoOn(on);
    engineRef.current?.setGizmoEnabled(on && mode === 'edit');
  }, [mode]);
  const setHullOp = useCallback((v: number) => {
    setHullOpacityState(v);
    engineRef.current?.setHullOpacity(v);
  }, []);
  const onHiDef = useCallback((on: boolean) => {
    setHiDefState(on);
    engineRef.current?.setHiDef(on);
  }, []);

  // ------------------------------------------------------------- PAINT 🎨
  /** v1 (2024-25, palette-less) files: the picker shows the legacy-mapped
   *  family colours (palette.legacySlot) so a swatch = what renders. */
  const legacy = bp ? isLegacyFile(bp) : false;
  /** Paint the SELECTED block (faces = face slots, undefined = all 7).
   *  v1.7.1: the SIMILAR TWIN is ALWAYS painted through the mirrored face
   *  mapping (paintTwinPair/mirrorFaceOrder) — every block edit mirrors to
   *  the identified twin. bp + doc together. */
  const paintBlock = useCallback((slot: number, faces?: number[]) => {
    const ctx = ctxRef.current;
    if (!ctx || blockSel < 0) return;
    const twin = blockMirrorTwin(ctx.bp, blockSel, mirAx());
    if (!paintTwinPair(ctx.bp, blockSel, twin, slot, faces, mirAx()).length) return;
    writeBlockDoc(ctx, blockSel);
    if (twin >= 0) writeBlockDoc(ctx, twin);
    sceneChanged();
  }, [blockSel, sceneChanged]);
  /** v1.7 custom RGB: write the picked colour into the next free slot of
   *  THIS craft's palette (bp + doc, int-styled like the game writer) and
   *  return its index; null = the palette is full / the write refused. The
   *  picker then paints with the new slot through the dock's own path. */
  const addPaletteColor = useCallback((c: Rgb255): number | null => {
    const ctx = ctxRef.current;
    if (!ctx) return null;
    const slot = allocateSlot(ctx.bp.data.colors ?? null);
    if (slot == null) return null;
    if (!setPaletteSlot(ctx, slot, paletteSlotNode(c))) return null;
    sceneChanged();                       // swatches + badges see the new slot
    return slot;
  }, [sceneChanged]);

  /** Snap a palette slot's FULL shading spec onto a component's custom
   *  color1/color2 dict (r/g/b/opacity/roughness/metallic). v1.8.0 UNIFORM
   *  MIRROR RULE: the twin pair is painted the SAME appearance together
   *  (colour is identity, not geometry — no mirroring to apply). */
  const paintComp = useCallback((ci: number, which: 'color1' | 'color2', c: ResolvedColor) => {
    const ctx = ctxRef.current;
    if (!ctx || ci < 0) return;
    const targets = [ci, ...(engineRef.current?.twinPairsOf(ci) ?? []).map(({ j }) => j)];
    for (const k of targets)
      for (const [f, v] of [['r', c.r], ['g', c.g], ['b', c.b], ['opacity', c.opacity],
        ['roughness', c.roughness], ['metallic', c.metallic]] as const)
        setCompColor(ctx, k, which, f, v);
    sceneChanged();
  }, [sceneChanged]);

  /** WIRE workspace: a wide BOTTOM DOCK across the viewport (the user: wire
   *  editing needs a larger screen — the 300 px sidebar slot could never
   *  show census + manual pairing + warnings legibly). The left parts panel
   *  and the inspector stay live beside it. */
  const wirePanel = (
    <WirePanel engine={engine} ctx={ctxRef.current} bp={bp!} rev={rev}
      onApplied={sceneChanged}
      onSelectComp={ci => engineRef.current?.select(ci)}
      sel={sel.ci}
      onHoverComp={ci => engineRef.current?.previewHover(ci ?? -1)}
      onConnect={(aCi, aPort, bCi, bPort) => {
        const ctx = ctxRef.current;
        if (!ctx) return false;
        const pipe = makePipe(ctx.bp, engineRef.current?.manifest ?? null, aCi, aPort, bCi, bPort);
        if (!pipe) return false;
        ctx.bp.data.pipes = ctx.bp.data.pipes ?? [];
        docEnsureArray(ctx.doc, ['data', 'pipes']);   // v1.6.1: files that
        ctx.bp.data.pipes.push(pipe as never);        // never wired carry no
        docArrayInsert(ctx.doc, ['data', 'pipes'], ctx.bp.data.pipes.length - 1, docFromValue(pipe)); // pipes key at all
        sceneChanged();
        return true;
      }}
      onDisconnect={pi => {
        // v1.10.1 DISCONNECT: bp AND doc (the doc is the save and the undo
        // history — the v1.6.1 class rule), then the debounced reload makes
        // the picture match (the cable mesh dies with the rebuild).
        const ctx = ctxRef.current;
        const arr = ctx?.bp.data.pipes;
        if (!ctx || !arr || pi < 0 || pi >= arr.length) return false;
        arr.splice(pi, 1);
        docArrayRemoveAt(ctx.doc, ['data', 'pipes'], pi);
        sceneChanged();
        return true;
      }}
      onHoverPipe={pi => engineRef.current?.setPipeHover(pi)} />
  );

  const name = (bp?.data.alias?.trim()) || (craft ? craftName(craft) : 'Untitled craft');
  autosaveKeyRef.current = craft ?? `new:${name}`;
  autosaveLabelRef.current = name;
  // Edit ▾ Undo/Redo enabled state (2026-10-20). histTick is the re-render trigger —
  // the stack itself lives in a ref (commits must never re-render mid-drag).
  void histTick;
  const canUndo = hist.openGesture || hist.canUndo;
  const canRedo = hist.canRedo;
  // v2.0.0 MERGED EDITOR (user: "Merge the block and component edit things,
  // I no longer see a good reason to seperate them. The UI is quite good."):
  // the old BLOCKS workspace is the EDIT mode's panel bottom — brush +
  // Blocks/Triangles sub-tabs + ⇄ row + BlockPanel/TriPanel live beside the
  // parts list; the ✎ Edit | ✚ Place flavor drives select-vs-place for BOTH
  // species. The blocks workspace stays visible even with a component
  // selected — the Inspector stacks ABOVE it (Panel's selOverBottom).
  // v1.10.6 (we: "placing blocks isn't fun, and editing triangles also
  // sucks … use the same kind of panel like for wires"): the blocks/triangles
  // workspace MOVES to a WIDE BOTTOM DOCK (build-dock) exactly like
  // wire-dock — the 300 px sidebar slot was the crux of the complaint. The
  // left panel keeps the parts list + inspector (and gets taller).
  const blockPanel = (
    <BlockPanel engine={engine} ctx={ctxRef.current} bp={bp!} blockSel={blockSel}
      brush={brush} tab={tool} legacy={legacy} mirrorAxis={mirAxis}
      onBrush={setBrush} onApplied={sceneChanged}
      onSelectBlock={bi => {
        setBlockSel(bi);
        setTriSel(-1); setPinTi(-1);          // one selection, one editor
        engineRef.current?.clearPins();
      }}
      onPaint={paintBlock}
      rev={rev} onHoverBlock={setBlockHover}
      onDeleteBlock={bi => ctxRef.current && deleteBlock(ctxRef.current, bi)}
      custom={{ addColor: addPaletteColor, onPickSlot: slot => setBrush(b => ({ ...b, slot })) }} />
  );
  /** v1.11 (we: "I put on mirror X for the craft.. then placed a triangle
   *  … but no matching triangle was made"): picking an AXIS on the widget IS
   *  the intent to mirror — it arms mirrored placement explicitly (the AUTO
   *  state only decides the default before the user speaks; a craft whose
   *  data has no twin pairs must not silently ignore an explicit axis). */
  const onMirrorAxisArm = useCallback((a: MirrorAxisOpt) => {
    onMirrorAxis(a);
    if (a !== 'off') setMirrorPlace('on');
  }, [onMirrorAxis]);
  /** render-side twin lit state (the widget; same rule as twins()) */
  const twinNow = mirAxis !== 'off' && (mirrorPlace === 'on'
    || (mirrorPlace === 'auto'
      && (engine?.craftMirrorAxes() ?? []).includes(mirAxis as 'x' | 'y' | 'z')));
  const triPanel = (
    <TriPanel bp={bp!} ctx={ctxRef.current} draft={triDraft} triSel={triSel}
      pinTi={pinTi} tab={tool}
      brush={brush} onBrush={setBrush} legacy={legacy}
      onFlip={triFlip} onFaceSlot={(i, v) => paintTriFaces(v, [i])}
      custom={{ addColor: addPaletteColor, onPickSlot: slot => setBrush(b => ({ ...b, slot })) }}

      onUndo={() => {
        setTriDraft(d => {
          const next = d.slice(0, -1);
          engineRef.current?.setPinDraft(next.length ? next : null, brush.slot);
          return next;
        });
      }}
      onDeleted={sceneChanged}
      onClearSel={() => {
        setTriSel(-1);
        setPinTi(-1);
        engineRef.current?.clearPins();     // v1.11: pins + centroid widget leave
      }}
      rev={rev}
      onHoverTri={setTriHover}
      onSelectTri={ti => {
        setTriSel(ti); setTriHover(-1); setTriDraft([]);
        setBlockSel(-1);                                  // free the widget chain
        engineRef.current?.select(-1);
        // a persisted ⤢ mode reads as ✥ on a triangle (no part/tri scale)
        if (engineRef.current?.gizmoModeNow() === 'scale')
          engineRef.current.setGizmoMode('translate');
        setPinTi(ti);                                   // v1.11: list row puts the pins on it
        engineRef.current?.setPinEdit(ti, brush.slot);
      }}
      onDeleteTri={ti => { if (ctxRef.current) deleteTri(ctxRef.current, ti); }} />
  );
  const onSelect = (ci: number, fly?: boolean) => {
    engineRef.current?.select(ci);
    if (fly) engineRef.current?.flyTo(ci);
  };
  const mkPanelProps = (): PanelProps => ({
    engine, ctx: ctxRef.current as never, bp: bp as never, sel, rev, legacy,
    opts, hullOpacity, onHullOpacity: setHullOp, gizmoOn: gizmoOn && mode === 'edit', onGizmo: setGizmo,
    hiDef, onHiDef, staticInfo, onStaticInfo: setStaticInfo,
    onOpt: toggleOpt, onSelect, onSelectSub: bi => engineRef.current?.selectSub(bi),
    edits, inspKey, markDirty, readOnly: mode === 'view' || mode === 'clean',
    manifest, placingType: placing,
    onPlaceType: t => { setPlacing(t); if (t && (mode === 'view' || mode === 'clean')) setMode('edit'); },
  });
  /** v1.11 THE CATALOG MOVES TO THE DOCK (we: "Move the sideview catalog to
   *  the bottom part, where it fits better for mobile") — a card under the
   *  place-mode workspace columns; ✎ Modify gets the parts list + inspector
   *  row above the merged block/triangle workspaces. */
  /** v1.11 + PARTS: its own subpanel (we: "Move parts into its own
   *  subpanel… Make it +Parts as well, so you can specifically place a
   *  part") — catalog (place), the vessel list, and the inspector of the
   *  selected part. ✎ Modify part clicks land here automatically. */
  const partsPanel = bp && (
    <div className="grid grid-cols-1 items-start gap-x-4 px-1 pb-2 md:grid-cols-3">
      <div className="min-h-[140px] border-t border-white/10 px-1 pb-2" data-testid="catalog-dock">
        <h3 className="ksp-label px-2 pt-2 text-[11px] font-semibold text-ink-dim">
          Catalog — hold a part, then click a surface</h3>
        <div className="max-h-72 overflow-y-auto px-1">
          <CompList bp={bp} rev={rev} sel={sel} onSelect={onSelect}
            onSelectSub={bi => engineRef.current?.selectSub(bi)} manifest={manifest}
            placingType={placing}
            onPlaceType={t => { setPlacing(t); if (t && (mode === 'view' || mode === 'clean')) setMode('edit'); }}
            listMode="place" />
        </div>
      </div>
      <div className="min-h-[140px] border-t border-white/10 px-1 pb-2" data-testid="parts-list">
        <h3 className="ksp-label px-2 pt-2 text-[11px] font-semibold text-ink-dim">
          Parts on the vessel</h3>
        <div className="max-h-72 overflow-y-auto">
          <CompList bp={bp} rev={rev} sel={sel} onSelect={onSelect}
            onSelectSub={bi => engineRef.current?.selectSub(bi)} manifest={manifest}
            placingType={placing} onPlaceType={t => setPlacing(t)} listMode="edit" />
        </div>
      </div>
      {sel.sub >= 0 ? <SubPanel {...mkPanelProps()} key={`s${sel.sub}`} />
        : sel.ci >= 0 ? <Inspector {...mkPanelProps()} key={`c${sel.ci}k${inspKey}`} />
        : <div className="border-t border-white/10 px-3 py-3 text-[11px] leading-snug text-ink-dim">
            Nothing selected — a canvas click (or a row beside) inspects a part here:
            sliders, data, paint, delete.
          </div>}
    </div>
  );
  const buildWorkspace = (
    <>
      {/* v1.11 THE SINGLE MODE CONTROL (we: "not 2 sets of 2 flips which is
          insane"): ONE tri-state segmented row — ▤ Blocks and ▵ Triangles
          are the two PLACE modes (a canvas click lands a cell / drops a
          pin), ✎ Edit is NEITHER (clicks select anything; both workspaces
          stack below). The mode is persisted (archean-app-ws). */}
      <div className="flex flex-wrap items-center gap-1 px-3 pt-2">
        {([
          ['blocks', '+ Blocks', 'ADD blocks: a canvas click lands a 1×1×1 block (paint + material from the brush below)'],
          ['tris', '+ Triangles', 'ADD hull triangles: canvas clicks drop the three PINS of a hull triangle'],
          ['parts', '+ Parts', 'ADD parts: the catalog — hold a part, click a surface; the vessel list + inspector live here'],
          ['edit', '✎ Modify', 'a canvas click SELECTS anything — part, block or prism — the widget moves/turns/stretches it'],
        ] as const).map(([k, label, tip]) => (
          <button key={k} data-testid={`ws-${k}`} aria-pressed={ws === k} title={tip}
            onClick={() => setWs(k)}
            className={`ksp-btn px-2 py-[3px] text-[11px] ${ws === k ? 'on font-semibold' : 'text-ink-dim'}`}>
            {label}
          </button>
        ))}
        <span className="mx-1 hidden h-4 w-px bg-white/15 md:inline-block" />
        {/* v1.11 THE MIRROR WIDGET (we: "ensure mirroring is possible and
            easily switchable by axis, should be a visible widget showing if
            x/y/z mirrored" + "the mirror option is not understandable, it
            should be visually understood, add a mirror icon with a
            strikethrough, and x y z also with mirror behind it"): every chip
            carries the MIRROR GLYPH (plane + solid triangle + reflected
            ghost, currentColor-lit); the OFF chip wears a red strikethrough,
            the axis chips wear the glyph BEHIND their letter. The lit chip
            IS the plane; the twin arm arms mirrored placement. Same engine
            value (archean-app-mirror-axis) as the ⚙ View rows. */}
        {/* v1.11 ONE LINGO (we: "the twin versus no mirroring is the issue.
            thats duplicate lingo for editing"): the widget IS 'Mirror' — the
            glyph chips pick the plane AND toggle pairing (lit = placements
            land as mirrored pairs; click the lit plane again to stop). No
            separate twin arm. 'auto' badge = the craft's own pairs light it
            before you touch anything. */}
        <span data-testid="mirror-widget" className="flex items-center gap-1"
          title="mirror: pick a plane to place mirrored pairs (blocks, parts, triangles) — click the lit plane again to stop; ⊘ = no mirror">
          <span className="ksp-label text-[9px] uppercase tracking-wider text-ink-dim">mirror</span>
          <button data-testid="mirw-off" title="mirroring OFF — no mirror plane, edits touch ONLY the selected item"
            aria-pressed={mirAxis === 'off'}
            onClick={() => onMirrorAxis('off')}
            className={`ksp-btn grid h-6 w-6 place-items-center px-0 py-[3px] leading-none ${
              mirAxis === 'off' ? 'on font-semibold' : 'text-ink-dim'}`}>
            <MirrorGlyph strike size={14} />
          </button>
          {(['x', 'y', 'z'] as const).map(a => (
            <button key={a} data-testid={`mirw-${a}`}
              title={`mirror across ${a.toUpperCase()} = 0 — placements land mirrored pairs; click the lit plane again to stop`}
              aria-pressed={mirAxis === a && twinNow}
              onClick={() => {
                if (mirAxis !== a) onMirrorAxisArm(a);
                else setMirrorPlace(twinNow ? 'off' : 'on');
              }}
              className={`ksp-btn grid h-6 w-7 place-items-center px-0 py-[3px] leading-none ${
                mirAxis === a && twinNow ? 'on font-semibold' : mirAxis === a ? 'text-ink' : 'text-ink-dim'}`}>
              <span className="relative grid h-5 w-5 place-items-center">
                <span className="absolute grid place-items-center opacity-45"><MirrorGlyph size={15} /></span>
                <span className="relative text-[10px] leading-none">{a}</span>
              </span>
            </button>
          ))}
          {mirrorPlace === 'auto' && twinNow && (
            <span className="text-[9px] text-ink-dim" title="this craft's own twin pairs light the mirror automatically">auto</span>
          )}
        </span>
        <span data-testid="flavor-hint" className="ml-auto pr-2 text-[10px] text-ink-dim">
          {ws === 'blocks' ? (
            <>
              <span className="hidden md:inline">BLOCKS — click lands a 1×1×1 cell (brush paint below) · ⇧ continues a block · ✎ Edit transforms</span>
              <span className="md:hidden">BLOCKS — TAP a surface to land a cell</span>
            </>
          ) : ws === 'tris' ? (
            <>
              <span className="hidden md:inline">TRIANGLES — clicks drop PINS · 3 pins = prism · drag a pin (⇧ = axis lock, orbit = depth)</span>
              <span className="md:hidden">TRIANGLES — TAP to drop pins, 3 make a prism</span>
            </>
          ) : (
            <>
              <span className="hidden md:inline">MODIFY — a click selects ANYTHING (part · block · prism) · ✥ move · ⟳ turn · ⤢ stretch · prisms get pins</span>
              <span className="md:hidden">MODIFY — TAP a part, block or prism, the rows below edit it</span>
            </>
          )}
        </span>
      </div>
      {ws === 'tris' ? triPanel
        : ws === 'blocks' ? blockPanel
        : ws === 'parts' ? partsPanel
        : blockSel >= 0 ? blockPanel
        : triSel >= 0 ? triPanel
        : (
          /* v1.11 (we: "Main modify should not do anything until you select
             your block or triangle (or part, which moves you into the Parts
             category instantly)"): Modify opens EMPTY — the dock shows the
             editor of the kind you picked, nothing before that */
          <div className="px-3 py-3 text-[11px] leading-snug text-ink-dim" data-testid="modify-hint">
            ✎ Modify starts empty — click a block, prism, or part on the vessel:
            the editor for the kind you pick appears here (a part opens + Parts
            instantly). The canvas gizmo works the same everywhere.
          </div>)}
    </>
  );

  return (
    <div className="flex h-dvh w-full flex-col"
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) readFile(f);
      }}>
      <TopBar mode={mode} onMode={setMode} dirty={dirty} title={name} craftId={craft}
        live={live} liveN={xenonFarm.pumps.filter(p => p.comp).length}
        energy={energy}
        items={items}
        soundOn={soundOn}
        onToggleSound={() => setSoundOn(soundscape.toggleSound())}
        onToggleLive={xenonComps.length ? () => {
          if (live) { xenonFarm.closeAll(); setLive(false); }
          else {
            setLive(true);
            const net = powerNet;
            xenonFarm.autoboot(xenonComps.filter(c => !net?.hasPower || computerPowered(net, c.ci)));
          }
        } : undefined}
        canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo}
        onNew={() => {
          // v1.5.10 (user: "new craft should not be a button, but only under
          // file. too dangerous"): a NEW craft throws away the open doc AND
          // its whole undo stack — while anything is unsaved, ask first.
          if (dirtyRef.current &&
              !window.confirm('Start a NEW craft? Unsaved changes to this one are lost (download it first with Save).')) return;
          ctxRef.current = null; setBp(null); openText(emitNew());
        }}
        onOpen={openFile} onSave={save} onClose={onBack} onBack={onBack}
        onRefresh={craft ? () => { forceRef.current = true; setRetrySeq(s => s + 1); } : undefined}
        tools={(toolsMod?.TOOLS ?? []).map(t => ({ id: t.id, label: t.label, icon: t.icon }))}
        onTool={id => setToolOpen(id)}
        onHelp={() => setHelpOpen(true)}
        xenonComps={xenonComps.length ? xenonComps.map(c => ({ ci: c.ci, alias: c.alias, program: c.program, files: c.files.length, builtin: c.builtin })) : undefined}
        xenonHuds={xenonHuds.map(h => ({ ci: h.ci, alias: h.alias, files: h.files.length }))}
        onHud={ci => setHudCi(ci)}
        xenonPlayerHuds={playerHuds.map(h => ({ name: h.name, kind: h.kind, files: h.files.length }))}
        onPlayerHud={openPlayerHud} onPlayerHudFiles={loadPlayerHudFiles}
        onBeacons={() => setBeaconsOpen(o => !o)} beaconsOpen={beaconsOpen}
        onXenon={openCodeFor}
        hasScreens={hasScreens} screensOpen={screensOpen}
        onScreens={() => setScreensOpen(o => !o)}
        autosaveCount={autosaveCount} onAutosaves={() => setAutosavesOpen(true)}>
        <button data-testid="save-btn" onClick={() => save()}
          className={`ksp-btn shrink-0 px-2.5 py-1 text-[12px] ${dirty ? 'on font-semibold' : 'text-ink-dim'}`}>
          {dirty ? '● Save' : 'Save'}
        </button>
        <button data-testid="toggle-options" title="View" aria-pressed={optsOpen}
          onClick={() => setOptsOpen(o => !o)}
          className={`ksp-btn shrink-0 px-2.5 py-1 text-[12px] hover:text-accent ${optsOpen ? 'on' : ''}`}>
          ⚙<span className="hidden sm:inline"> View</span>
        </button>
        <BuzzerButton />
      </TopBar>
      <input ref={fileRef} type="file" accept=".json,application/json" className="hidden"
        data-testid="file-input"
        onChange={e => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ''; }} />
      {/* PLAYER HUD folder picker (v1.17.0): pick the hud/<name>/ folder; the
          browser hands every file, playerHudFromFiles keeps the .xc ones and
          the main.xc-first order. webkitdirectory is nonstandard in TS DOM
          types — set via the attribute (Chromium + Firefox honour it). */}
      <input ref={hudFileRef} type="file" multiple className="hidden"
        data-testid="playerhud-input"
        {...{ webkitdirectory: '', directory: '' } as Record<string, string>}
        onChange={e => { const fl = e.target.files; if (fl?.length) void onHudFilesPicked(fl);
          e.target.value = ''; }} />
      <div className="relative flex min-h-0 flex-1">
        {/* v1.11 NO SIDE PANEL (we: "no more side panel"): catalog, parts list,
            inspector, vessel INFO and the mode workspaces ALL live in the
            bottom dock — the thumb zone mobile wants. */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <Viewport bp={bp} onPick={setHit} onEngine={onEngine}
              mode={mode === 'clean' ? 'view' : mode} tool={tool} onBlockPick={onBlockPick} onBlockHover={computeGhost}
              placing={mode === 'edit' ? placing : null} onPlace={onPlacePoint}
              onPaintOpen={() => setPaintOpen(o => !o)}
              onBlockToTris={blockToTriangles}
              onPlaceCancel={onPlaceCancel} onPlaceBuild={onPlaceBuild}
              onPlaceRotate={onPlaceRotate} onPlaceBack={onPlaceBack}
              keepView={bpKeepView}
              onPress={onDashPress} pressLabel={pressLabel} onCode={openCodeFor}
              onManifest={setManifest} />
            {/* 🎨 PALETTE window (v1.6): the paint alternative to the gizmo
                modes, opened from the mode widget — targets the CURRENT
                selection: the selected BLOCK (per-face, ⇄ twin), a COMPONENT
                (color1/color2 snap), or the block BRUSH in the Place flavor */}
            {paintOpen && bp && ctxRef.current && (
              <div data-testid="palette-win"
                className="ksp-win absolute right-2 top-12 z-30 max-h-[calc(100%-4rem)] w-[320px]
                           overflow-y-auto rounded-lg px-3 py-2">
                <div className="ksp-label mb-1 flex items-center justify-between gap-2 border-b
                               border-white/10 pb-1 text-[10px] text-ink-dim">
                  Paint —{' '}
                  {mode === 'edit' && blockSel >= 0 ? `Block[${blockSel}]${bp.data.blocks[blockSel] && blockMirrorTwin(bp, blockSel, mirAxis) >= 0 ? ' + twin' : ''}`
                    : sel.ci >= 0 ? `${bp.data.components[sel.ci]?.type ?? 'part'}[${sel.ci}]`
                      : triSel >= 0 ? `Triangle[${triSel}]`
                        : 'brush'}
                  <button data-testid="palette-close" onClick={() => setPaintOpen(false)}
                    className="ksp-btn rounded px-1.5 text-[11px] text-ink-dim hover:text-accent">✕</button>
                </div>
                {mode === 'edit' && blockSel >= 0 ? (
                  <BlockPaint bp={bp} legacy={legacy} bi={blockSel} onPaint={paintBlock}
                    custom={{ addColor: addPaletteColor, onPickSlot: slot => paintBlock(slot) }} />
                ) : sel.ci >= 0 && bp.data.components[sel.ci] ? (
                  <CompPaint bp={bp} legacy={legacy} comp={bp.data.components[sel.ci]!}
                    onApply={(which, c) => paintComp(sel.ci, which, c)}
                    custom={{ addColor: addPaletteColor, onPickSlot: () => undefined }} />
                ) : triSel >= 0 ? (
                  // a selected PRISM paints through the funnel (was: the 🎨
                  // window silently painted the brush — "WHEN I PICK A COLOR
                  // FOR A TRIANGLE IT DOES NOT APPLY")
                  <SwatchGrid bp={bp} legacy={legacy}
                    current={bp.data.triangles?.[triSel] ? (bp.data.triangles[triSel] as unknown as { colors?: number[] }).colors?.[0] ?? 51 : 51}
                    onPick={paintTri}
                    custom={{ addColor: addPaletteColor, onPickSlot: slot => paintTri(slot) }} />
                ) : (
                  <SwatchGrid bp={bp} legacy={legacy} current={brush.slot}
                    onPick={slot => setBrush(b => ({ ...b, slot }))}
                    custom={{ addColor: addPaletteColor, onPickSlot: slot => setBrush(b2 => ({ ...b2, slot })) }} />
                )}
              </div>
            )}
            {placing && mode === 'edit' && (
              <div data-testid="place-hint"
                className="ksp-win ksp-label pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2
                           rounded px-3 py-1 text-[11px] text-accent">
                holding <b>{placing}</b> — press-drag on a surface to smear it
                (the drag points its BACK) · release lands it · Esc drops it
              </div>
            )}
            {bp && hit && hit.kind !== 'none' && mode !== 'view' && (
              <PickChip hit={hit} bp={bp} />
            )}
            {/* the ⚙ view-options popover — its own window, not the parts
                panel (moved out of the left sidebar by user request) */}
            {optsOpen && (
              <div data-testid="options-win"
                className="ksp-win absolute right-2 top-2 z-30 max-h-[calc(100%-1rem)] w-[290px]
                           overflow-y-auto rounded-lg">
                <ViewOpts opts={opts} onOpt={toggleOpt} hullOpacity={hullOpacity} onHullOpacity={setHullOp}
                                    gizmoOn={gizmoOn} onGizmo={setGizmo} hiDef={hiDef} onHiDef={onHiDef}
                                    staticInfo={staticInfo} onStaticInfo={setStaticInfo}
                                    flatSkin={flatSkin} onFlatSkin={onFlatSkin}
                                    mirrorAxis={mirAxis} onMirrorAxis={onMirrorAxisArm}
                                    backdrop={backdrop} onBackdrop={onBackdrop}
                                    ortho={ortho} onOrtho={onOrtho} />
              </div>
            )}
            {toolMsg && (
              <div data-testid="tool-toast"
                className="ksp-win ksp-label pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2
                           rounded px-3 py-1 text-[11px] text-gold">
                {toolMsg}
              </div>
            )}
            {/* HELP ▸ the built-in manual (v1.5.20): markdown topics with a
                word search; works with no craft open too */}
{helpOpen && (
              <Suspense fallback={null}>
                <HelpDialogLazy onClose={() => setHelpOpen(false)} />
              </Suspense>
            )}
            {/* XENON ▸ the in-game-style IDE of a MiniComputer (v1.13) */}
            {/* FARM (v1.15.0 slice C): one IDE window per computer — all
                co-running, sharing the craft's io bus (cascade offsets
                live in FloatingWindow's per-id rects) */}
            {xenonCis.flatMap(ci => {
              const comp = xenonComps.find(c => c.ci === ci);
              return comp ? [(
                <Suspense key={`xenon-${ci}`} fallback={null}>
                  <XenonDialogLazy comp={comp} pump={xenonFarm.pumpFor(comp)} engine={engine}
                    unpowered={unpowered(ci)}
                    onClose={() => setXenonCis(c => c.filter(x => x !== ci))} onFiles={xenonFiles} />
                </Suspense>
              )] : [];
            })}
            {/* 🖥 HUD IDE (v1.14.0 P9 slice A): the code of a HUD block;
                v1.17.0: the SAME dialog for a loaded PLAYER HUD (the
                synthetic ci) — detached save writes the .xc files back */}
            {hudCi !== null && (() => {
              const hud = hudCi === PLAYER_HUD_CI
                ? (playerHud
                  ? { ci: PLAYER_HUD_CI, alias: `${playerHud.name} · player HUD`, files: playerHud.files }
                  : null)
                : xenonHuds.find(h => h.ci === hudCi) ?? null;
              return hud ? (
                <Suspense fallback={null}>
                  <HudDialogLazy hud={hud} onClose={() => setHudCi(null)} onFiles={hudFiles}
                    saveHud={hudCi === PLAYER_HUD_CI && playerHud
                      ? async files => {
                        const dir = await savePlayerHud(playerHud.name, files);
                        setPlayerHud(p => (p ? { ...p, files } : p));
                        return dir;
                      }
                      : undefined} />
                </Suspense>
              ) : null;
            })()}
            {/* 📡 BEACONS dock (v1.14.0): the global radio scope */}
            {beaconsOpen && (
              <Suspense fallback={null}>
                <BeaconDockLazy onClose={() => setBeaconsOpen(false)} />
              </Suspense>
            )}
            {/* ▣ SCREENS bottom tab (v1.13.x): live dashboards + virtual
                surfaces of the running computer (top-bar ▣ button) */}
            {screensOpen && (
              /* the dock is a FloatingWindow: it positions, drags and
                 resizes itself (phones get it fullscreen) */
              <Suspense fallback={null}>
                <ScreensDockLazy comp={activePump()?.comp ?? xenonComps[0] ?? null}
                  pump={activePump()}
                  pumps={xenonFarm.pumps}
                  craftId={craft ?? undefined}
                  focus={new URLSearchParams(window.location.search).get('dash')?.toLowerCase() ?? undefined}
                  onClose={() => setScreensOpen(false)} />
              </Suspense>
            )}
            {/* File ▸ Autosaves: the shadow-copy list (v1.13.x) */}
            {autosavesOpen && (
              <Suspense fallback={null}>
                <AutosavesDialogLazy
                  currentKey={craft ?? `new:${name}`}
                  onRestore={a => {
                    if (dirty && !window.confirm(
                      'Restore an autosave? Unsaved changes in the open craft are lost (download it first with Save).')) return;
                    setAutosavesOpen(false);
                    openText(a.text);
                  }}
                  onClose={() => setAutosavesOpen(false)} />
              </Suspense>
            )}
            {/* KSP bottom-left: the STATIC INFO black box (mass & CoM) */}
            {bp && staticInfo && (
              <div className="absolute bottom-2 left-3 z-[5]">
                <StaticInfo engine={engine} rev={rev} onClose={() => setStaticInfo(false)} />
              </div>
            )}
            {/* KSP bottom-right: the camera cluster over the viewport */}
            <CameraCluster engine={engine} />
          </div>
          {/* v1.11 THE BOTTOM DOCK IS THE PANEL (we: "no more side panel"):
              ⌖ Info shows the vessel's amounts here (renamed from View),
              the workspace modes show their dock, flight/aero show theirs. */}
          {mode === 'view' && bp && (
            <div data-testid="build-dock"
              className="h-[38%] max-h-[46%] min-h-[200px] shrink-0 overflow-y-auto border-t
                         border-[rgba(217,212,189,.22)] bg-panel">
              <div className="ksp-label px-3 pt-2 text-[11px] font-semibold text-ink-dim">
                Info — the vessel&apos;s amounts</div>
              <VesselStats engine={engine} bp={bp} rev={rev} />
            </div>
          )}
          {mode === 'edit' && bp && (
            <div data-testid="build-dock"
              className="h-[38%] max-h-[46%] min-h-[200px] shrink-0 overflow-y-auto border-t
                         border-[rgba(217,212,189,.22)] bg-panel">
              {buildWorkspace}
            </div>
          )}
          {mode === 'wire' && bp && (
            <div data-testid="wire-dock"
              className="h-[38%] max-h-[46%] min-h-[200px] shrink-0 overflow-y-auto border-t
                         border-[rgba(217,212,189,.22)] bg-panel">
              {wirePanel}
            </div>
          )}
          {mode === 'flight' && bp && (
            <div data-testid="build-dock"
              className="h-[38%] max-h-[46%] min-h-[200px] shrink-0 overflow-y-auto border-t
                         border-[rgba(217,212,189,.22)] bg-panel">
              <FlightPanel engine={engine} rev={rev} />
            </div>
          )}
          {mode === 'aero' && bp && (
            <div data-testid="build-dock"
              className="h-[38%] max-h-[46%] min-h-[200px] shrink-0 overflow-y-auto border-t
                         border-[rgba(217,212,189,.22)] bg-panel">
              <div className="overflow-y-auto"><WindPanel engine={engine} rev={rev} /></div>
            </div>
          )}
        </main>

        {/* TOOLS ▸ the definition-driven modal dialog (v1.7): opens over
            the viewport, OK-and-run or Cancel. */}
        {toolOpen && toolsMod && bp && ctxRef.current && (
          <toolsMod.ToolDialog key={toolOpen}
            tool={toolsMod.TOOLS.find(t => t.id === toolOpen)!} bp={bp} ctx={ctxRef.current}
            initialForm={placeStage?.toolId === toolOpen ? placeStage.form : undefined}
            onClose={() => setToolOpen(null)}
            onPlaced={(t, f, p) => onPlaced(t, f, p)}
            onApplied={msg => { sceneChanged(); setToolMsg(msg); }} />
        )}        {(dl || dlErr) && (
          <DownloadOverlay name={name} dl={dl} err={dlErr}
            onRetry={() => { forceRef.current = true; setRetrySeq(s => s + 1); }}
            onBack={onBack} />
        )}
        {/* VERSIONED CACHE open gate: the cached copy is not provably current
            — the user picks which copy opens (see StaleDialog.tsx) */}
        {staleAsk && craft && (
          <StaleDialog name={name} state={staleAsk.state} cached={staleAsk.info}
            meta={craftMeta(craft)}
            onDownload={() => { askChoice.current = 'download'; setStaleAsk(null); setAskSeq(s => s + 1); }}
            onCached={() => { askChoice.current = 'cached'; setStaleAsk(null); setAskSeq(s => s + 1); }} />
        )}
      </div>
    </div>
  );
}

/** KSP-style "receiving blueprint" download overlay: shown ONLY while an
 *  actual download runs (cached crafts open instantly, no overlay, no
 *  network) — bevelled window, progress bar, percent + KiB; error state
 *  offers Retry / Gallery. */
function DownloadOverlay(p: { name: string; dl: { frac: number | null; bytes: number } | null;
  err: boolean; onRetry: () => void; onBack: () => void }) {
  const pct = p.dl?.frac != null ? Math.round(p.dl.frac * 100) : null;
  return (
    <div data-testid="load-overlay" className="absolute inset-0 z-40 grid place-items-center bg-black/50">
      <div className="ksp-win w-[340px] max-w-[85vw] rounded-lg px-4 py-4 text-center">
        <div className="ksp-label mb-1 text-[12px] text-accent">
          {p.err ? 'Blueprint download failed' : 'Receiving blueprint'}</div>
        <div className="truncate text-[13px] font-semibold text-ink">{p.name}</div>
        {p.err ? (
          <>
            <div className="mt-2 text-[11px] leading-snug text-ink-dim">
              This craft is not in the local cache and could not be downloaded.</div>
            <div className="mt-3 flex justify-center gap-2">
              <button data-testid="load-retry" className="ksp-btn on px-3 py-1 text-[12px]" onClick={p.onRetry}>Retry</button>
              <button data-testid="load-back" className="ksp-btn px-3 py-1 text-[12px]" onClick={p.onBack}>Gallery</button>
            </div>
          </>
        ) : (
          <>
            <div className="mt-3 h-3 overflow-hidden rounded border border-white/20 bg-black/50">
              <div data-testid="load-bar"
                className={`h-full bg-accent/80 ${p.dl && pct === null ? 'w-1/3 animate-pulse' : 'transition-[width] duration-150'}`}
                style={p.dl && pct !== null ? { width: `${pct}%` } : undefined} />
            </div>
            <div data-testid="load-pct" className="mt-1.5 text-[11px] tabular-nums text-ink-dim">
              {!p.dl ? 'checking cache…'
                : p.dl.bytes === 0 ? 'receiving…'
                : pct !== null ? `${pct}% · ${(p.dl.bytes / 1024).toFixed(0)} KiB`
                : `${(p.dl.bytes / 1024).toFixed(0)} KiB \u2026`}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** KSP-style camera presets (the square-button cluster bottom-right) */
const CAMS: ['fit' | 'top' | 'front' | 'side', string, string][] = [
  ['fit', '⌂', 'frame craft'], ['top', '⊞', 'top view'],
  ['front', '⊏', 'front (nose) view'], ['side', '⊐', 'side view'],
];
function CameraCluster({ engine }: { engine: Engine | null }) {
  return (
    <div data-testid="cam-cluster"
      className="absolute bottom-2 right-2 z-[5] flex flex-col gap-1">
      {CAMS.map(([k, ic, t]) => (
        <button key={k} data-testid={`cam-${k}`} title={t}
          className="ksp-btn grid h-8 w-9 place-items-center text-[14px] leading-none"
          onClick={() => engine?.viewPreset(k)}>
          {ic}
        </button>
      ))}
    </div>
  );
}

/** picked-part chip: bottom sheet on phones (above the static-info box),
 *  KSP part-tooltip card on desktop */
function PickChip({ hit, bp }: { hit: PickHit; bp: Blueprint }) {
  const comp = hit.kind === 'comp' && hit.ci != null ? bp.data.components[hit.ci] : null;
  return (
    // v1.11.1 (we: "That still shows on top" — the picked-info chip sat
    // 132 px above the canvas bottom = MID-canvas over the 38 % phone dock
    // layout): phones dock it flush at the viewport's bottom edge (the
    // edge-dock law); desktop keeps the top-right card.
    <div data-testid="pick-info"
      className="ksp-win pointer-events-none absolute inset-x-2 bottom-2 rounded px-3 py-2 text-[12px]
                 text-ink md:inset-x-auto md:bottom-auto md:right-3 md:top-3 md:max-w-[320px]">
      <span className="ksp-label text-[10px] text-ink-dim">picked</span>{' '}
      <span className="text-gold">{hit.kind}</span>
      {comp && <> · <span className="ksp-label font-semibold text-accent">{comp.type}</span>
        {typeof comp.name === 'string' && comp.name ? <span className="text-ink-dim"> "{comp.name}"</span> : null}</>}
      {hit.point && <div className="tabular-nums text-[10px] text-ink-dim">@ {hit.point.map(n => n.toFixed(2)).join(', ')}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BuzzerButton — the sound icon beside ⚙ View (we 2026-10-28: "place a mute
// icon/sound icon near the 'view' buttons … which animates whenever any
// buzzer is making sound so its evident that is the reason there is
// sound"). Shows only while the RUNNING computer carries Buzzer components;
// the click is the autoplay-safe gesture that starts/resumes the AudioContext
// (engine/buzzer.ts); while any buzzer's Amplitude is live the icon pulses
// (.buzzer-anim), so "sound on + buzzing" is visible, and muted/silent is
// static. data-playing mirrors the live state for the pins.
function BuzzerButton() {
  const [, setTick] = useState(0);
  // FARM (slice C): watch EVERY pump (any co-running computer may buzz).
  // FARM-MOUNT LAW (v1.15.2): the lineup is EMPTY at gallery boot — the
  // farm version in the deps re-attaches the subs to pumps booted later,
  // exactly like the 3-D cycle-hook effect.
  const [farmV, setFarmV] = useState(0);
  useEffect(() => xenonFarm.subscribe(() => setFarmV(v => v + 1)), []);
  useEffect(() => {
    const unsubs = xenonFarm.pumps.map(p => p.subscribe(() => setTick(t => t + 1)));
    return () => unsubs.forEach(u => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farmV]);
  if (!(xenonFarm.pumps.some(p => (p.comp?.devices ?? []).some(d => d.type === 'Buzzer')))) return null;
  const playing = buzzerAudio.soundOn && buzzerAudio.level > 0.001;
  return (
    <button data-testid="buzzer-toggle" aria-pressed={buzzerAudio.soundOn}
      data-playing={playing ? '1' : '0'}
      title={buzzerAudio.soundOn
        ? 'Buzzer sound ON (the browser unlocks it at your first key/tap) — click to mute'
        : 'Buzzer sound MUTED — click to enable'}
      onClick={() => buzzerAudio.toggleSound()}
      className={`ksp-btn shrink-0 px-2.5 py-1 text-[12px] hover:text-accent ${
        buzzerAudio.soundOn ? 'text-accent' : 'text-ink-dim'} ${playing ? 'buzzer-anim' : ''}`}>
      {buzzerAudio.soundOn ? '🔊' : '🔇'}
    </button>
  );
}
