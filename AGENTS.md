# AGENTS.md — development guide

Repo reverse-engineers the **Archean** game's `blueprint.json` format. The
React app in `app/` is the app; `viewer/` is the frozen legacy inspector kept
as a port-reference and Pages artefact. Everything static: plain ES modules +
Three.js CDN; `app/` is vite + React + TypeScript (own npm project).

**LIVING RULES ONLY, terse.** Dates, origin stories, quotes, superseded
rulings, version narratives live in `docs/HISTORY.md`. Write rules as
imperatives; put the WHY in a satellite, link it.

## Keeping this file clean (mandatory)
- Living rules only. Dated narratives, session reports, closed todos,
  superseded rulings, pin histories → APPEND to docs/HISTORY.md in the same
  commit, never inline here.
- Every bullet must read without its origin story. If a rule needs a story,
  the story is history and the bullet stays one line.
- Satellites own their domain; AGENTS.md links, never copies: FORMAT.md
  (format knowledge base), docs/HISTORY.md (provenance),
  docs/TEST-PYRAMID.md (test strategy + baselines), docs/E2E-INVENTORY.md,
  PERF.md (perf baseline + harmful candidates), LOCATIONS.md (installs,
  paths, URLs), MATRIX.md, GEAR-F-A18F.md (rig-chain audit method),
  REWRITE.md (pending plans, § P8), NOTICE.md (licensing). A new subsystem
  with detail outside this file gets a satellite created/updated and linked
  IN THE SAME COMMIT.
- Budget ~20k tokens: triage history OUT first; never shrink a law to fit.

## Layout
```
viewer/index.html + view3d.js   frozen legacy inspector (Three.js core module)
viewer/tests.js                 frozen viewer's headless suites
                                (selftest/proxytest/comptest/uitest/
                                gizmatest/postest), driven via the
                                window.HARCHEAN accessor (live
                                getters/setters); loaded ONLY for suite URLs
                                (dynamic import in index.html)
viewer/hullfit.js               exact hull-lattice mapping (pure, no THREE)
viewer/blockshapes.js           block shape+orientation table (type -> faces)
viewer/palette.js               the game's built-in 256-slot palette
viewer/models/                  game component models: manifest.json (mass,
                                renderable node tree, joints, adapters,
                                colliders per type) + <Type>.json geometry
regtest/regtest.html            format-validation suite over testdata/
testdata/<workshop-id>/blueprint.json   regression corpus + law fixtures
                                (testdata/900000NNNN, tools/make_*_test.py)
tools/adjust_seat.py            reference example of a safe format edit
tools/find_install.py           discover a local Archean install / saves /
                                workshop dir (procedure: LOCATIONS.md)
tools/config.py                 THE path resolver (blueprints/workshop/game)
tools/make_orient_test.py       chirality probe craft 9000000001
tools/make_matrix_test.py       COMPONENT MATRIX fixtures (see MATRIX.md)
tools/game_data.py              mass & build-cost model from the GAME FILES
                                (mass, items, recipes); --selfcheck <bp>
tools/matrix_verify.py          game-file numbers vs dev-viewer panels
tools/matrix_sheet.py           dev│ours side-by-side PNGs per craft
tools/matrix_iou.py             framing-invariant silhouette IoU screen
tools/make_landing.py           regenerates the landing gallery
tools/bench_census.py           subgrid bench-pair census (run before any
                                subgrid axis code — THE PANEL LAW)
tools/security-scan.py          checkin gate: secret scan (--staged/
                                --tree/--history) + string sync (--versions)
tools/release.sh                THE release ritual (see § Publishing)
tools/deploy_pages.py           builds+force-pushes the `pages` artefact
tools/install-hooks.sh          ONE-PER-CLONE: installs tests/pre-commit
tools/perfprobe.py URL [s]      real-clock headless perf probe
tools/xenoncode/                XenonCode fork submodule + build.sh +
                                patches + demo programs (NOTICE §6)
tools/add_workshop.py <id>      ingest a subscribed workshop craft
tools/extract_models.py         regenerates viewer/models/ from a game dir
tools/extract_economy.py        regenerates viewer/models/economy.json
tools/asset_space.py            SUPERSEDED census (kept for provenance)
tests/pre-commit                the mandatory gate hook
tests/run_tests.sh              headless-Chromium suite (frozen viewer)
FORMAT.md                       format documentation (start here)
LOCATIONS.md                    finding installs/saves/workshop on any machine
PERF.md                         measured perf baseline + harmful candidates
NOTICE.md                       licensing
docs/HISTORY.md                 archive of dated narratives (provenance only)
docs/TEST-PYRAMID.md            test strategy + measured baselines
docs/E2E-INVENTORY.md           e2e spec inventory (tiers, fixtures)
REWRITE.md                      rewrite plan (landed phases marked; P8 live)
```
app/: components/ (React), engine/ (pure logic + scene.ts + xenoncode/),
e2e/ (Playwright), tools/ (node audit drivers — *.mjs, real-browser pairs).

## Blueprint folder (rule — machine-local paths are configurable)
The repo may be cloned ANYWHERE. NEVER hardcode a machine-local absolute path
(Steam install, workshop dir, a home) in a tool, test or script. The blueprint
CORPUS and every outside path resolve through ONE module, `tools/config.py`,
in tiers: env `ARCHEAN_BLUEPRINTS` / `ARCHEAN_WORKSHOP` / `ARCHEAN_GAME` >
gitignored repo-root `blueprints.conf` (KEY = value; see the .example) >
built-in defaults (corpus = `<repo>/testdata`, fresh clone works unchanged).
Print with `python3 tools/config.py`.
- Python tools: `import config` (sys.path include of `tools/`) and use
  `config.blueprints_dir()` / `workshop_content_dir()` / `game_dir()`.
- Browser suites: `regtest/regtest.html?corpus=<url>` overrides;
  `tests/run_tests.sh` resolves via config, serves repo+corpus on one server,
  passes the corpus URL automatically.
- New machine: discover with `python3 tools/find_install.py` (procedure in
  LOCATIONS.md). NEVER commit a resolved machine path — only the gitignored
  `blueprints.conf` may hold one.

## The app (app/ — React + TypeScript — THIS IS THE APP)
All new feature work happens in `app/`. `viewer/` + `viewer/tests.js` are
FROZEN — do not delete them (Pages/release serves them; removal needs the
user's explicit say-so). Provenance: docs/HISTORY.md §1.

### Writes, saves, undo
- EVERY mutation path ends in the DOC: bp is the live model, the doc mirrors
  it, `emitDoc(doc)` is the save AND the undo snapshot. A doc mirror into a
  list the file never carried (`docArrayInsert` on a missing path) fails
  SILENTLY — use the `engine/edit.ts` funnels: `appendTrianglesDoc` (fresh
  records), `mirrorTrisDoc` (records bp carries), `docEnsureObject`/
  `docEnsureArray` for parents. NEVER write bp only.
- Undo = `emitDoc(doc)` snapshot stack; the 450 ms debounce coalesces a drag
  into ONE entry. Pins needing separate undo steps space edits > 450 ms.
- Deleting a component runs `pruneCompRefs` BEFORE the splice: `data.pipes`
  and `composite_builds` index the FLATTENED component array — refs into the
  deleted subtree drop with their entries, later refs renumber in bp AND doc.
- The tool NEVER rewrites an orientation it did not edit. Saves stay
  byte-identical to the game's JS (`doc.ts` keeps raw literals — bare ints
  for int-modelled fields, `"13.0"`/`"1e-08"` style for doubles).
- DATA assertions cannot pin a repaint — assert through `stats().loads` or
  pixels. Widget/block commits route through the debounced `sceneChanged()`
  reload; inspector edits route through `Engine.liveDataEdit` (one in-place
  rebuild per frame, no full reload).

### Geometry and lattice
- Cell = 0.25 m; cell c covers `[(c−6)·CELL, (c−5)·CELL)`; the ⇄ twin of
  `[c,c+e)` is `[12−c−e, 12−c)`. Blocks MAY cross frame borders: the only
  storage rules are `pos_*` ∈ 0..12 + sanity size ≤ 24.
- The triangle 32-slot vertex window is FRAME-ALIGNED:
  `v = g − 12·floor(min/12) ∈ 0..31` — `encodeSkinTri` IS the law.
- Helpers mapping skin records through a position change CUT on the window,
  NEVER filter: encode-else-`splitFace`, pieces re-wearing the source
  record's colours/material/shading. NEVER slice a transformed list by
  pre-transform counts (splitting ADDS records).
- hullify is FACE-EXACT: emit block-shape face triangles at the block's cell
  corner; cull on adjacency only. Area equality CANNOT prove shape — the pin
  is containment (`straysOf == 0`). Defaults: outward + flat (the game's
  authored convention).
- Convex lattice skins (latsphere Quickhull): refuse ratio ≥ 12 honestly —
  no convex lattice-exact skin is storable there. The dialog REFUSES with a
  ⚖ fix probe (probe sizes, no clean ratio exists); residual `skipped > 0` =
  refuse, never a silently-holed skin.
- Subgrid kinematics: run `python3 tools/bench_census.py` BEFORE touching
  ANY subgrid axis code. FORMAT §Subgrids is normative. Balloon fin/rudder
  mounts were settled by user arbitration with discriminating pins — read
  the docs/HISTORY.md §1 bullets before touching `balloonfin.ts`.

### Rendering
- Display quaternion = the STORED quaternion raw, BOTH generations. The
  conjugate display law is BANNED (FORMAT §Handedness).
- ONE built-in palette table (the dev's: families at 40/84/128/172, slots
  0..10 reserved, NULL gaps kept); per-build palette SCOPING for nested
  Build skins; render rig = XenonViewer's (LinearToneMapping exposure 0.9,
  day-sky PMREM, hemi .35 / sun 1.0 / fill .12 / bounce .10 / softbox .14,
  envMapIntensity 1). A MAGENTA face = cleared slot IN THE OWNING BUILD'S
  palette — check the owning build before repairing any file.
- Hull triangles render as closed 0.05 m prisms (all five colours, centred
  caps). DO NOT reintroduce cap-normal welding or shared-edge rim culling —
  the rims make a prism read solid. Coplanar-dashboard burial is a KNOWN,
  ACCEPTED open problem: attack the RENDER pass if ever, NEVER the extrusion
  direction.
- `hull.ts stitchHullSkin` is DISPLAY-ONLY (welded coplanar cell-skin pairs
  → maximal rectangles); the FILE, pick law and selection visuals are
  untouched; boundary rims stay verbatim.
- APPEARANCE = palette slots ONLY (no per-material shading); the `material`
  0..6 field is GAMEPLAY identity (mass/heat/cost).
- Gizmo + mode widget are COMPONENT-ONLY; subgrids have NO gizmo (they ride
  their masters' joints; do not resurrect a free subgrid gizmo). Gizmo
  settings are SESSION-only: the modebox ⊘ never survives a load; the
  `archean-app-gizmo` storage key is DEAD (engine deletes it on attach).
- Cables: the SOCKET LAW (`sockets.ts`), the axial LEAD rule (2r along the
  stub axis before a bend), the FLEX GATE (ONLY the file's `flexible` flag
  drapes; routed runs draw their cached polyline verbatim), THE DRAPE LAW
  (catenary at rest length between plug necks, taut when overstretched),
  THE HARNESS ATTACH (nested parts' sockets + recorded tips ride the rig
  chain). `pipesSoon` is a 250 ms leading+trailing throttle.
- Data cables draw thin+square (`KIND_SECTION`); the file's `radius` stays
  physical truth, `half` is the drawn extent.
- Mass model = the TS twin of the game's server model (`engine/mass.ts` ⇄
  `tools/game_data.py` cross-pinned; subgrid content counted recursively);
  cost model = the `GetBlueprintContents` twin (`engine/economy.ts` ⇄
  `extract_economy.py`). `sealedEnvelopeVolume` = lattice flood (sealed
  blocks and/or a skin; walls alone displace no lift; Volume markers are
  NEVER trusted for maths).
- Ground: the plane mesh is `visible=false` (see-through pad; three's
  Raycaster ignores visibility so picks/placement are unchanged); grid lines
  + ±axis marks are zoom-adaptive (`grid.ts` ladder) on the WORLD lattice.
- Sky backdrops are A MANIFEST (`src/assets/backdrops/manifest.json`):
  adding one = a 2:1 JPG + one manifest line, ZERO code; tests are
  manifest-driven. The dome is a BackSide sphere on layer 1, never
  `scene.background` (it cube-walls panoramas under ortho).

### Interaction and UI
- NO unsolicited viewport overlays: info cards are persisted ⚙ settings with
  their own ✕. PHONE EDGE-DOCK LAW: every viewport popup docks to a viewport
  edge < 768 px; the 3-D widget shrinks (0.6); dialogs reserve the browser
  bottom clear-zone.
- ONE CONCEPT = ONE WORD in the UI; one n-state control beats a 2×2 flip; a
  refusal is never a dead end (`ToolDef.fix` ⚖ repair).
- UNIFORM MIRROR RULE: every edit on a selected item ALWAYS drives its
  mirror twin in mirrored unison (blocks: cells/sizes/shapes/paint/material/
  delete; parts: positions/rotations/paint/joints/delete; prisms: shift =
  negated delta, rotate = mirror-conjugate quat, flip, delete). FAUX-MIRROR
  = flagged, never silent, WITH SEVERITY: geometry conflict = red ⚠;
  appearance-only = gold + blue ℹ. Session mirror = ONE axis at a time (⊘
  disables); twin PLACEMENT auto-arms when the craft's data mirrors across
  the lit axis; the sheet draws ONE plane (the session axis).
- Gizmo semantics: translate = WORLD (axis-aligned), rotate = LOCAL rings
  (intrinsic, WYSIWYG), scale = BLOCKS-only and DIRECTIONAL (the grabbed
  face's side moves, the opposite anchors). Triangles get pins
  (camera-facing-plane drag, ⇧ locks the axis most facing the camera) + the
  centroid widget (WORLD translate cell-snap, LOCAL rotate lattice-quantised).
  Shared TransformControls event chains: EVERY commit guards on its own
  captured gesture base — one unguarded commit resets the proxy for all.
- Tool dialogs: 86 dvh cap, draggable title, smooth `.tool-scroll` body,
  pinned footer, phone clear-zone. Heavy previews run DEBOUNCED on the worker
  (`previewAsync`/`place.stageAsync`); OK is DISABLED while planning.
  Esc-close listeners subscribe ONCE with a callback ref; dialog Escape is
  capture-phase + `stopImmediatePropagation`.
- Craft cache: every IndexedDB copy carries rev + SHA-256; stale/unknown
  opens pass the gate (Download-latest vs use-cached, both dates shown);
  FRESH opens keep the ZERO-network rule; catalog stamps follow real file
  changes (the watcher invalidates the gallery module).
- Help = plain-markdown topics (`app/src/help/topics/*.md`) + the
  dependency-free renderer: escape ALL input first; every parser loop MUST
  advance `i`. Fullscreen on phones (`grid-cols-[minmax(0,1fr)]` is what
  makes `w-full` mean the viewport).
- Boot: the atlas manifest fetch fires with the Editor chunk import. The e2e
  storageState ships `archean-app-backdrop=none` (BACKDROP-SKIP FIXTURE LAW:
  a spec gaining a panorama law clicks the row explicitly).

### Xenon workspace (computer / debugger / screens)
- THE CADENCE LAW: the VM cycles at 25 Hz (`CYCLE_MS = 40`, shim
  `xc_set_cycle_ms`); React panels coalesce ≤ 10 Hz; canvases blit EVERY
  cycle.
- IDE RUN/FIND/GOTO/MAXIMIZE KEYS: F5 = RUN (COMMITS the live buffers ⇒
  disk write ⇒ auto-reboot on them, breakpoints surviving; v1.13.27: NO
  edit/view mode — files[] are live buffers, save is the only commit,
  closing discards; autosave shadow-copies the doc as always) ONLY while a
  computer or Screens window is open — else F5 stays the browser refresh.
  F6 = STOP (v1.13.31, same window law): parks the VM on the EXACT
  executing line (PARK LAW below) and marks the run stopped.
  Ctrl+F = CM find panel, Ctrl+G = go-to-line box (Esc closes them, NEVER
  the IDE — popup stopPropagation law). ⛶ / title double-click maximizes
  (FloatingWindow `maximized`).
- IDE CHROME (v1.13.32): the debugger toolbar (▶⏸⟳⏹⇥↓) rides the TITLE
  BAR (the drag law excludes buttons; on phones it IS the debugger — no
  F-keys); the file-tab strip is ONE row at rest and its hover wrap
  OVERLAYS the code (absolute, never a push — a pushed 57-tab strip hid
  the editor; the single-row pin measures the REST box); phones
  (<768 px) get the side panel as a RIGHT-EDGE RAIL + overlay DRAWER so
  the code owns the width (`.cm-scroller` `touch-action: pan-x pan-y`);
  a changed variable row remounts with the `.var-flash` wash (keyed on
  the last value per name).
- HUD BLOCKS + BEACON RADIO (v1.14.0 slice A, runtime v1.14.1 slices B+D):
  HudController components list under the XenonCode menu (HUD IDE — the
  shared CodeEditor editing `data.xc_files` through the xc-file doc
  funnels with the `''` container; save = the doc, F5 = save + re-boot the
  runtime). ▶/⏹ run the HUD program on the ABI-11 shim: `panel(anchor,w,h)`
  surfaces BLIT live under PANELS (clicks route in — `button_rect` evaluates
  THIS cycle), `beacon($tx,$rx)` + `.data`/`.transmit(t)` join the GLOBAL
  beaconNet scope (beaconpair/beacontx events), `get("avatar_sensor_*")`
  reads the AVATARSIM rows. Beacon COMPONENTS are io devices: `output_text`
  on the port TRANSMITS (postDevice), beaconNet deliveries feed ch0
  (`input_text(port,0)` — the RCS500 read law) every cycle. The BEACONS
  side tab (computer IDE + HUD IDE + 📡 dock) renders the registry
  (seeded from components + scanned `beacon()` literals, runtime-merged
  by id; EXACT text-frequency routing; logs survive re-seeds). ONE
  INTERPRETER: `engine/runtimemgr.ts` — a HUD boot CLOSES the computer
  pump and vice versa (the farm in slice C lifts this). The shim twin:
  `xc_host.cpp` ABI 11 ↔ `XC_ABI`; demo `tools/xenoncode/demo/hudradio`.
- THE COMPUTER FARM (v1.15.0 P9 slice C): MULTIPLE MiniComputers co-run —
  every XenonRun carries its OWN wasm instance (`xenonInstantiate`), the
  `xenonFarm` registry (keyed by comp.ci, `MAX_VM` evicts the oldest)
  hosts one pump per open IDE window. THE CABLE LAW: an io channel
  belongs to the DEVICE — `IoBus` records every `output_*` write and
  drives it into EVERY attached pump's inputs (the writer's loopback
  included); `beaconNet` queues carry a global seq and each pump reads
  with its own cursor, so a component beacon wired to two computers
  feeds BOTH. The farm retires runtimemgr's one-interpreter mutual kill
  (the HUD co-runs too). Pilot keys press every pump with the seat
  bound; the dock + `__XCDBG__` + F5-target the ACTIVE pump (last
  window opened); per-window FloatingWindow ids `xenon-<ci>`; the header
  rises to z-[60] ONLY while a menu is open (TRANSITION-only reporting —
  a permanent raise kills maximised title-bar double-clicks, a
  mount-time `false` report sinks the counter); the dialog's `__XENON__`
  override RESTORES the base hook on unmount; `xenonFarm.subscribe`
  drives Editor re-renders on lineup changes. Fixture:
  `tools/make_farm_test.py` → 9000009010 (radio `INTERCOM` + shared
  lamp); pins: farm.test (bus law), beaconnet cursor, xenonfarm.spec
  (two VMs, radio + bus cross, close-one-sister-lives).
- NAV + DEBUGGER-FOLLOW (v1.13.27; STEP KEYS v1.13.33): every jump
  (library/def/goto/tab) records a navpoint; ◀ ▶ + Alt+←/→ (CAPTURE — CM
  binds Alt+arrows) walk the history. EVERY debugger stop — breakpoint hit
  AND F10/F11 step — moves the editor to the stop site (we: "the
  scroll/focus doesn't change position when I used f11 … not acceptable");
  `data-editor-jump` is the follow observable (asserting only
  `data-paused-jump` proves the pump, not the follow).
- EDITOR KEY LAWS (v1.13.26): defaultKeymap + `indentWithTab` are REQUIRED
  (CM keeps Tab = focus-move by default; without them Tab leaves the
  editor via the browser); Enter auto-indents one unit — a TAB, the game
  scopes block bodies by tabs (a 2-space body parses as global scope) —
  after `opensBlockLine` lines (blocks + function decls), carrying the
  current indent elsewhere; a TYPED '\n' rides the same Enter keymap, so
  keyboard-authored code must not carry manual tabs on top of it;
  io calls (`input_number`/`output_number`/…) hover
  DEVICE + channel MEANING + live reads/bus value + the part's CATALOG
  PREVIEW (engine/thumbs.ts, the placement-menu renderer), Ctrl+Click =
  `engine.flyTo(device.ci)` (XCDevice carries the component index).
  Editor e2e legs carry @codeditor — full @codeditor runs only when
  CodeEditor.tsx/xcproject.ts/CodeMirror touch.
- THE STEP LAW LIVES IN TWO PLACES: `stepperLaw()` (xenoncode.ts, pure,
  main-thread) ⇄ the EM_JS hook in `xc_host.cpp` (worker). ANY change lands
  in BOTH + re-pins (+ rebuilt wasm: `EMSDK=~/emsdk tools/xenoncode/build.sh
  wasm-only`). v1.13.31 XENON-DEBUG v3 CLASSIC STEP-OVER DEEPENED (ABI 10):
  the interpreter records a CALL-DEPTH stream parallel to the pair stream
  (fork: `cycleDepth`; hook seam `xc_debug_hook(file,line,depth)`), and F10
  stops at the first fresh pair OF THE PAUSED FILE at depth ≤ the paused
  depth — in-file callees are stepped OVER (the file-only law read as "F10
  steps into, not over"); the hook keeps the paused depth hook-internal
  (H.pd — NOT a SAB slot: payload windows reach across the slot area, the
  slot law above). `stepperLaw(pairs, depths, …)` degrades to the v1.13.28
  file-only law when the depth stream is absent (older wasm). SAB payload
  windows start ABOVE every slot byte (slot n owns 4n..4n+4); SAB views
  decode through `bytes.slice()` copies (TextDecoder refuses shared views).
- THE TRACKING GATE + PARK LAW (v1.13.31, workpackages.md): the
  interpreter's per-line tracking runs ONLY while the debugger has work —
  a break table, an armed step, an armed park (`pump.syncDebugTrack`; the
  worker also skips the per-cycle pair/depth JSON; `xc_hook_live(on)` gates
  the C++→JS hook CALL — the main-thread pump keeps it disarmed, its
  debugger is the pair+depth stream). An IDE open with none of those costs
  the program NOTHING (pump closed ⇒ the VM is gone: zero impact rule).
  ⏸/⏹/F6 PARK on the EXACT executing line with NO breakpoint: worker mode
  via the hook (cmd 5, mid-cycle, frozen cycle counter); main-thread mode
  via the v3 `xc_pause_request` seam (`xc_cycle` returns 2,
  `xc_pause_file/line` report the site, the Computer survives — the
  interrupted cycle's remainder is discarded, cycle-granular honesty, the
  mode chip says so). At a park the editor's wash + the pill derive from
  `pump.paused` (RESUME CLEARS them), THE WRITEBACK LAW is satisfiable in
  both modes, and a value cell clicked while the worker runs ARMS the park
  and opens the editor on arrival (park-to-edit).
- The interpreter is a FORK SUBMODULE (`tools/xenoncode/upstream`, branch
  `archean`). `build.sh` builds ONLY the recorded gitlink and REFUSES a
  diverged checkout. A bump = submodule commit + rebuilt js/wasm in the SAME
  commit; upstream PRs = one commit per PR from that branch. The device shim
  is OURS (Archean law, not interpreter).
- THE SOURCEFILE TRUTH LAW: name→index tables the VM owns are READ from the
  VM (`xc_source_files()`), never re-derived app-side.
- THE WRITEBACK LAW: value injection is legal only at a PAUSED moment,
  validated per type (numbers finite-decimal, text free; storage/array/
  object REFUSE); answers `{"ok":true}|{"error":…}`.
- Every new device export is typeof-GUARDED and the shim stamps `xc_abi()`
  vs the app's `XC_ABI` — a stale wasm degrades features, never spams. Bump
  both with the shim. Compiled wasm artifacts ride git LFS.
- Screen cap = the game's 10000×10000 (a smaller cap TRUNCATES sprite
  atlases). All surfaces list per tick; pixels fetched only for visible
  canvases + 3-D feed keys.
- Buzzers: `data.mode` = the authored tone (0-3 sine/square/triangle/saw;
  wave `'auto'` = per-buzzer); amplitude `min(1, amp·1.8)·0.4` into warm
  baked PERIODICWAVEs + 7.5 kHz lowpass + 16-level quantization. Sound
  defaults ON; the AudioContext is created+resumed inside a REAL gesture
  playing a 1-frame silent buffer (a context created in the pump loop starts
  suspended and never resumes).
- THE PILOT-KEY LAW: a cabled/aliased PilotSeat pads to ALL 18 documented
  channels; WASD/↑↓/F/E/Q/I/K/J/L/R/digits/SPACE bind by channel word (SPACE
  = Down/Up AND Aux 1); press = ±1, release CENTERS; global editor shortcuts
  yield while cockpit keys are active; keys never leak while typing; a bound
  channel RESTS AT ZERO at bind time.
- `window.__XCDBG__` = the plain-JSON async debug console over the real pump
  (every answer JSON-serialisable, every call bounded) — the agent seam;
  `__XENONTEST__` the headless autotest seam (fixture 9000008001).
- P8 pending (REWRITE.md § P8): the Xenon workspace moves to a low-coupling
  module. Until scheduled: NO new cross-import from the core editor into
  Xenon internals — new surface goes through the four-seam contract.

### Testing (laws; plan in docs/TEST-PYRAMID.md)
- TEST-SIZE RULE: every test at the SMALLEST tier that can state the law
  (vitest pure → node integration → e2e ONLY for pixels / real pointer
  plumbing / IndexedDB / dev-pair). Each new e2e carries a
  `// e2e-tier because:` line.
- FIXTURES BEAT CORPORA (`tools/make_*_test.py` → `testdata/900000NNNN`). A
  big craft in a test must defend why the fixture CANNOT exhibit the law.
  FIXTURE-FIRST BOOT LAW: geometry-behaviour laws run on generated law
  fixtures; real-craft DATA laws belong at the node tier.
- A slow test is a DESIGN SMELL: the fix is the lower tier, never a longer
  timeout.
- CHAIN LAW: tests sharing one boot + compatible state = ONE test of named
  `test.step`s with `expect.soft(.poll)`; each step restores what it
  mutated; spec surgery via `tools/spec_ops.mjs` (TS-AST spans).
- GATE LADDER: per change `npm test` + `npx tsc -b` + the touched e2e tags;
  per landing on main the FAST tier (`test:e2e:fast` inverts
  `@slow|@while-publish`); @slow only for touched subsystems and user-facing
  boundaries; @while-publish (pins sealing a known-imperfect state) run
  opportunistically in the Pages-Actions wait and before a release TAG.
- A FLAKE is a RE-TIER signal (migrate the pin down a tier in the same
  session) — heal with self-healing probes / sparsification, NEVER longer
  sleeps. e2e running WHILE files are edited gives phantom failures: re-run
  flakes on the final tree before believing them.
- LESSONS: probe face-INTERIOR pixels through the engine's own pick law
  (canvas fractions are NOT aspect-stable); camera SETTLE = two identical
  `camPos()` samples; when an identity law changes, RE-AUDIT every pin that
  sealed its old trigger; a CodeMirror `toContainText` rides the VIEWPORT
  only (docs are windowed — assert head text, prove deep literals through a
  registry/chip observable); long game strings (beacon frequencies!) need
  `break-all`/`truncate` + `min-w-0` flex columns — min-content from an
  unbreakable 40-char token makes a side panel OVERLAP the editor (the
  v1.14.0 Badger catch); after a SHIM edit, verify the built wasm binary
  carries the new exports/decl-strings (`grep -ac <name> xenoncode.wasm`)
  before trusting an e2e red — a build that copied a stale wasm cost a
  debug cycle (the v1.14.1 build7 catch; a prod page fetches the CHUNK
  glue, not the raw asset, so probe the wasm bytes, not the loaded URL).
- PER-COMPONENT PINS: solo-fixture tests carry `@<ComponentName>` tags; run
  the tags you touched; a full @slow sweep only when a SHARED render-pipeline
  file changed.
- No full-game e2e legs: law fixtures + `__XENONTEST__` scripts are the tier.

## Legacy viewer (frozen — the suite is the gate)
- `tests/run_tests.sh` (selftest + regtest + proxy + comp + uitest + gizmatest
  + postest + renders) keeps the frozen viewer's semantics green; the commit
  gate runs its `--gate` pair whenever a `viewer/` file is staged. Full pin
  descriptions: docs/HISTORY.md §3.
- `fitHull` stays GENERIC: zero per-craft constants; per-craft scene probes
  live ONLY in the POSTESTS table (the sanctioned exception).
- `window.HARCHEAN` is the ONLY test handle; `viewer/tests.js` loads by
  DYNAMIC import — a static import with the release `?v=` specifier = a
  SECOND app instance on one DOM.
- DO NOT RESURRECT: explode/assembly; the free subgrid gizmo; the spheroid
  block-matching hull generator (rebuild contract: pin DEVIATION against the
  ideal surface FIRST, judge in-game pixels — docs/HISTORY.md §1 + branch
  `failed/spheroid-hull-dents-lattice-quantization` / SPHEROID-FAILURE.md);
  per-generation quaternion mappers; cap-normal welding / rim culling;
  view3d's site-zoom counteract machinery (Ctrl+0 in the browser is the only
  zoom reset).

## App toolchain (commands from `app/`)
```bash
cd app && npm install           # one-time
npm test                        # vitest — pure engine core (no browser)
npx vitest run load.perf        #   … PERF harness (QUIESCENT-ONLY:
                                #   PERF_HARNESS=1; skip-reports in the gate)
npm run build:wasm              # rebuild wasm/seal.wasm after editing wasm/seal.ts
npm run test:e2e                # Playwright chromium suite (e2e/) — FULL
npm run test:e2e:fast           #   … minus @slow AND @while-publish
npx playwright test --grep '@place|@ui'   # per-area subsets — an unrelated
                                #   change never needs a full run
npx playwright test --grep '@Aileron'     # per-component tags (see Testing)
npm run dev -- --host 0.0.0.0   # NEVER loopback-only; browse via the
                                #   Tailscale IP (see ONE SERVER RULE)
```

## Commands
```bash
bash tools/install-hooks.sh               # after cloning: enables the gate
tests/run_tests.sh                      # full headless suite (python3+chromium)
tools/release.sh                        # cut the STABLE release — ONLY on the
                                        #   user's explicit ask (§ Publishing)
python3 -m http.server 8650             # manual serving (repo root)
# viewer:   http://127.0.0.1:8650/viewer/index.html
# selftest: viewer/index.html?selftest  (tab title: SELFTEST PASS)
# gizmatest: viewer/index.html?gizmatest (GIZMATEST PASS n=19; &shot=1..4)
# regtest:  regtest/regtest.html        (page ends 'REGTEST: PASS')
# other craft: viewer/index.html?open=../testdata/<id>/blueprint.json
# perf probe: viewer/index.html?perf; headless: python3 tools/perfprobe.py <url> 12
python3 tools/extract_models.py <Archean-game-dir> -o viewer/models
```
Headless render shots — use the **AMD iGPU** (~1 s/shot):
```bash
VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/radeon_icd.json \
chromium --headless=new --no-sandbox --disable-dev-shm-usage \
  --use-gl=angle --use-angle=vulkan --window-size=1400,900 \
  --virtual-time-budget=15000 --screenshot=out.png <url>   # --dump-dom for titles
```
VK_ICD_FILENAMES hides the NVIDIA ICD — the discrete GPU runs our AI models
and MUST NOT be contended (check `nvidia-smi`; tests/run_tests.sh pins the
iGPU by default). GPU=0 = SwiftShader: every virtual frame costs 13-300 ms
wall — keep budgets ≤ 8000.
Kill dev servers with `pkill -f "[h]ttp.server 8650"` — the unbracketed
pattern also matches (kills) the calling shell.

## OpenCode session discipline (mandatory — at session START)
- Every OpenCode session works in its OWN git worktree, so two live sessions
  silently fork the commit graph.
- Session START: `git worktree list`. A sibling worktree with commits not on
  main = a fork: STOP, tell the user, reconcile (merge + gates) before new
  work.
- Land finished work on main (ff). Never leave the session's only copy of the
  work in its worktree.
- NEVER symlink node_modules (or state dirs) between checkouts; each checkout
  runs its own `npm install`.
- ONE SERVER RULE: exactly ONE dev/preview server for this repo on the
  machine. ① Sweep first (`ss -tlnp` on 5175 + any E2E_PORT, `pgrep -af
  vite`, resolve cwd via `/proc/<pid>/cwd`) and KILL every repo-vite.
  ② Start exactly one, from the checkout the user browses, bound
  `--host 0.0.0.0`; hand over the Tailscale URL (`tailscale ip -4`).
  ③ VERIFY the served tree (curl a file you just shipped) — a port answering
  200 says nothing about WHICH tree. ④ Restart after checkout switches /
  dependency changes; re-verify. ⑤ Kill it (and strays) before session end.
  Start DETACHED (`nohup setsid … >/tmp/opencode/dev.log 2>&1 & disown`) —
  a harness background shell dies with its session. Playwright's webServer
  starts its own server only when its port is free: always pass a dedicated
  E2E_PORT and sweep first.
- CLEAN STALE WORKTREES (start + end of session): a sibling with no dirty
  files AND no unmerged commits → `git worktree remove --force <it>` +
  `git worktree prune`. A worktree carrying work is NEVER deleted — reconcile
  first.

## Checkin gate (mandatory — the hook enforces)
Every commit passes `tests/pre-commit` (install once:
`bash tools/install-hooks.sh`):
- `tools/security-scan.py --staged` — staged blobs scanned for CREDENTIAL
  SHAPES (private keys, GitHub/AWS/Google/Slack/npm/PyPI/OpenAI tokens,
  JWTs, ssh keys, basic-auth URLs, Steam WebAPI `key=<32hex>`,
  password/token assignments); any hit blocks. Deep scans: `--tree`,
  `--history`. No CI secrets exist (Pages builds from the branch).
  Intentional public data (workshop authors/titles in testdata, ws-names,
  the GitHub-noreply git identity) is audited and licensed — NOTICE.
- `--versions` — when a release-string file (or the viewer) is staged, ALL
  context-anchored version strings (viewer title/header, `view3d.js?v=`,
  README ×2, landing ×2, app title) must agree.
- When ANY `viewer/` file is staged, the hook runs `tests/run_tests.sh
  --gate` (headless SELFTEST+REGTEST pair, iGPU-pinned). Gate PASS is commit
  proof; the FULL suite is the RELEASE gate (`tools/release.sh` refuses on a
  FAIL). A dev snapshot must never wear a released version label (§
  Versioning).

## Versioning (semver)
`vX.Y.Z`. Bump the SMALLEST component that describes the work — never spend a
`Y` on a fix.
- **X — major**: overhaul / change of shape. Requires the user's EXPLICIT
  instruction ("make it vX.0" in those terms). Never self-awarded; when
  unsure, ship a Z.
- **Y — minor**: a new user-visible FEATURE. PROPOSE it ("suggest vX.Y.0,
  OK?") and WAIT for the user's assent; until then the tree carries the next
  Z.
- **Z — patch**: fixes, tweaks, wording, thresholds, tools, docs.
  Agent-owned: bump WITHOUT asking at session start (the working tree always
  carries the NEXT label — a dev snapshot wearing the last release's string
  is indistinguishable from a pushed one) and for every fix landing; announce
  it in the commit message.
- Multiple stacked changes = ONE bump: the version describes the RELEASE.
- `tools/release.sh` refuses 2-part strings and backward moves (EQUAL = the
  suite-re-run path) and prints the bump kind;
  `tools/security-scan.py --versions` keeps all strings in lockstep.

## Publishing (GitHub Pages — release branch + generated `pages`)
Live site: `https://joeppie.github.io/archean-blueprint-tools/` — the React
app IS the site root; the frozen inspector lives at `/viewer/index.html`
behind a small link at the END of the gallery. Pages serves the GENERATED
`pages` branch; `git push origin main` never moves the live site.
- `main` = development (pre-commit gate only; Pages ignores it).
- `release` = stable, ff-only from main, never rebased/cherry-picked onto.
  Branch-protected (force-push + delete blocked); the
  `allow_force_pushes` flag toggles via the protection API PUT for
  sanctioned history rewrites — restore it after.
- `pages` = PUBLIC artefact: an orphan snapshot built from the release ref by
  `tools/deploy_pages.py` (pure build in a detached worktree, npm ci; the
  compiled gallery pins ARCHEAN_BLUEPRINTS to repo testdata so a
  machine-local Steam corpus can never leak into a public bundle). NEVER
  hand-edited; history disposable; `release` is the truth. Pages source:
  `{"source":{"branch":"pages","path":"/"}}` via `gh api -X PUT
  repos/Joeppie/archean-blueprint-tools/pages`.
- The ritual: `tools/release.sh [vX.Y.Z]` = preflight (clean main, pushed,
  strings agree, 3-part SEMVER moving FORWARD, tag free, origin/release an
  ancestor of main) → COMPLETE suite (a FAIL aborts, release untouched) → ff
  `release` → annotated tag + push → best-effort GitHub Release notes. The
  site moves only via `tools/deploy_pages.py` (rebuild = an Actions job;
  check githubstatus.com before suspecting the push).
- A RELEASE CUT requires the user's EXPLICIT say-so ("release it", "cut the
  release", "ship it"). Finished work, a green suite, commits, pushes do NOT
  imply one. Full-suite RUNS for verification stay encouraged. Hotfixes go
  through main and re-release.
- App data routes are page-relative and LAYOUT-EXACT (`testdata/…`,
  `viewer/models…` at root; `../` fallbacks; legacy link root-exact; vite
  `base './'`) — the repo URL path is never hardcoded.
- Pages cannot send response headers: `app/public/sw.js` (THE ISOLATION
  FORGER, ships at the site root via dist) forges COOP+COEP on navigation
  responses so Pages is cross-origin-isolated and the Xenon SAB gate
  unlocks worker mode (v1.13.29). `/viewer/` stays header-free (the frozen
  inspector's CDN Three.js + require-corp don't mix); registration =
  `app/src/main.tsx` + `engine/isolation.ts`, ONE reload per tab, pure SW
  passthrough (no caching, no cache-bust interplay). Insecure origins
  (plain-http LAN) refuse registration → the main-thread pump unchanged.

## Test strategy (plan in docs/TEST-PYRAMID.md)
- Every law at the SMALLEST tier that can state it: pure logic → vitest;
  scene-graph pose/pick/census → vitest via headless seams; DOM/state wiring
  → jsdom (the VIEWPORT-MOCK harness mounts the real Editor state machine);
  ONLY pixels / real pointer plumbing / IndexedDB / dev-pair stay e2e.
  A flake is a re-tier signal; the pixel7 matrix is OPT-IN (a spec joins only
  with a device law); an e2e leg dies in the SAME commit as its lower-tier
  replacement reproducing the green values.
- Measured baselines live in docs/TEST-PYRAMID.md + PERF.md — never
  re-litigate numbers from memory; re-measure (`app/tools/bootprobe.mjs`,
  `load.perf`).

## Sources of truth (all offline — do NOT web-fetch for format questions)
- **FORMAT.md is the knowledge base.** Everything reverse-engineered lives
  there (grid maths, culling, hull lattice, linear colour/PBR, palette,
  gltf materials, conditional wheels, .ini placement). Read it first.
- Game assets on disk: `game_dir/modules/<module>/components/<Type>/<Type>.{gltf,ini}`
  (resolve via `tools/config.py`; discover via `tools/find_install.py` +
  LOCATIONS.md) = ground truth for models/materials/node trees. Regenerate
  `viewer/models/` after extractor changes.
- The dev's viewer (https://viewer.xenontools.dev/, js under /js/; hub
  https://xenontools.dev/) is the reference for genuinely NEW format
  questions. Transcribe any finding into FORMAT.md + code comments in the
  SAME commit (NOTICE §2 porting terms). The official wiki
  (wiki.archean.space) documents the in-game side; URLs indexed in
  LOCATIONS.md.

## Format facts (verified — do not re-derive)
- 1 grid cell = 0.25 m; `pos_*` ∈ 0..12; `frame_*` in 3 m units;
  `world = (pos − 5.5)·0.25 + frame·3.0`. −z is the nose (this craft).
- ONE RAW QUATERNION LAW, both generations: the game places every component
  as `world = position + R(q)` with the STORED quaternion AS-IS;
  `viewQuat = (w,x,y,z)` for EVERY file (the view space IS the raw file
  frame). `toViewQuat` is the identity seam; the legacy flag keys ONLY
  palette resolution (and the wheel-droop gate). The conjugate display law
  and the open-time raw→conjugate REWRITE are BANNED — they flip
  palette-less exports in game; the game stores quaternion bytes VERBATIM
  across generations. The tool never rewrites an orientation it did not
  edit. Pins: `placement-law.test.ts`, `savefidelity.test.ts`,
  fixtures 9000005001 (8 dashboards flush under raw) + 9000004001;
  `app/tools/flushcheck.mjs <craft>` live-audits. FORMAT §Handedness is
  normative.
- Blocks: `type` = shape+orientation (0 cube, 1-12 slope [4 = thin tilted
  rod], 13-20 corner, 21-44 pyramid, 45-52 inverse corner; table
  `viewer/blockshapes.js`); `colors[7]` = palette slot per face.
  Interior-wall culling: full faces cut cell-by-cell against a full-face
  grid in absolute cell coords, surviving cells stitched to rectangles;
  partial/slant faces die when fully cell-covered; two blocks presenting the
  SAME partial-face footprint (slope glued to slope) = interior partition —
  both copies drop.
- `components[].type === 'Build'` = editor construction-site ghost, far
  outside the bbox — never render it as geometry. NUANCE: a Build entry
  inside subgrid CONTENT is an ASSEMBLY node — renders nothing itself; its
  blocks/skin/parts render RECURSIVELY inside the owning TOP-LEVEL Build
  group; joins whose slave is a nested Build key to the hosting group's
  joint chain (`path[2]`).
- Components' `occupancies` are mirrored by type-255 entries in
  `data.blocks`; ANY save keeps them in sync (round(delta/0.25) cells, both
  places).
- Save format serializes byte-identical to the game's JS:
  `json.dumps(..., separators=(',',':'), ensure_ascii=False)` — no spaces,
  key order preserved, no reformatting.
- `components[].colors` may be a dict (`color1`/`color2`, v2) or a
  `[slot,slot]` index pair (v1) — handle both.
- Hull triangles: vertices live on the SAME lattice as blocks —
  `world_ax = (v_ax + 12·frame_ax)·0.25 − 1.5` EXACTLY (v are cell-slot
  integers; cross-frame weld pairs sit Δv = 12). The per-file pitch fit
  (≈0.23-0.29) is BANNED. Shared slots = welded points; winding order flips
  the normal. The game renders each triangle as a closed 0.05 m prism:
  colours[0] front, [1] back, [2..4] side walls along edges v0-v1, v1-v2,
  v2-v0 (all five colours matter).
- `pipes` segments: `dir` 0..5 = +x,+y,+z,−x,−y,−z; the first/last segment
  ends are world-space connector positions. Pipes are NOT straight chains —
  every segment anchors at its OWN `start` (joint offsets 0.04-0.14 m;
  accumulating dir*len drifts off the cables). Endpoints ARE the connection
  points: cable tips sit at the part's VISIBLE socket, which can differ from
  the `.ini` [ADAPTER] position. Draw paths exactly as recorded —
  adapter-snapping endpoints and taper-shifting paths are BANNED.
  Cable-free adapter nubs > 0.5 m from the part origin are build-time
  flanges — skip them. FluidJunction cables are cached in the builder's FLAT
  frame; the junction's display pose matches that frame (why the comb lies
  flat). See FORMAT §pipes.
- SUBGRIDS: Build components carrying nested blueprints (doors/hatches)
  live as ONE Group per Build (`userData.sub`); the group BASE is the
  IDENTITY and nested content sits at PARENT-frame absolute coords —
  content under a posed nested Build is rig-LOCAL (rig chain:
  `subgrid.ts rigChainOfPath`, raw `position` + RAW quaternion composed
  down the nesting; the top level starts at identity).
  Build.position/orientation = the construction-site BENCH pose, applied as
  a DISPLAY offset, NEVER an origin. `composite_builds[]` indices (master
  `component` AND `slaveBuildId`) are FLATTENED component-array indices
  (nested content numbers BEFORE its Build). Masters are exactly
  SmallHinge/SmallPivot/LinearTrack with a manifest `joints[0]` (NOT
  Lamp/SpotLight — `angle` there is the light aim); joint-state fields:
  `data.angle` DEGREES / `data.pos` metres.
  Kinematics: axis = `R(q)·C·ê`, slide likewise (THE PANEL LAW,
  C = the content-basis map; run `tools/bench_census.py` first); pivot =
  viewPos + R(q)·axle.position, RAW local (the mirrored-bbox clamp law is
  retired); pivot₀ CLAMPED onto the subgrid's non-255-block bbox edge;
  group pose `p' = pivot₀ + R(axis₀,angle)·(base.p−pivot₀) (+slide₀·pos)`,
  then the master's RIGID POSE DELTA rides on top
  (`dq = q·q0⁻¹`; a master at its built pose composes to identity);
  `syncSubJoints()` runs from buildSubgrids + every markDirty. A joint edit
  propagates the SAME delta to live symmetry twins; each twin swings about
  its OWN captured axis. Display pose lives in `userData.base`.
  EPISTEMIC STATUS: the axis rules are an EMPIRICAL FIT to confirmed
  in-game motions, not format semantics — every corpus `composite_builds`
  entry carries only {component, slaveBuildId}; the .ini graph fixes only
  the PART's pin. The PLATE LAW (node-axis formulas) and the fin-mount
  rulings: docs/HISTORY.md §1 + FORMAT §Subgrids (normative). Subgrids have
  NO gizmo; the only path is master joint state.
- Palette slots: `data.colors[256]`, entry = {r,g,b 0-255, opacity 0-15,
  roughness 0-7, metallic 0|1}. r/g/b are LINEAR albedo (decoding as sRGB
  darkens ~^2.2 — BANNED). `opacity < 15` ⇒ transparent, alpha =
  (opacity+1)/16; `opacity < 8` = glass. The engine re-imposes slots 0..10.
  Metal shades as metallic·(1 − roughness/7); color1's default is metallic 0,
  roughness 0. See `viewer/palette.js`.
- v1 files (the corpus majority) carry NO `data.colors`: block slots and v1
  component slot-PAIRS reference the built-in legacy palette — four
  17-colour families, v2 bases matte 40..56 / polished 84..100 / metal
  128..144 / glass 172..188; V1 family bases are 4 slots LOWER
  (80..96/120..136/160..176). `legacySlot()` remaps +4/+8/+12 for
  palette-less files only. An all-purple craft = missing built-in groups
  (magenta = missing-slot marker), not a broken file.
- Dashboard geometry is GENERATED from `data` (glTF = editor template):
  board = box origin→(size_x/100, size_y/100, 0.01) — CENTIMETRES, corner
  pivot, plane X·Y normal +z; elements at pos/100 z 0.01..0.02; dataport
  re-centred at (w/2,h/2,0); colours 0-255 LINEAR, metal/rough off 0..255.
  Hull UI: blocks + triangles share ONE "hull" toggle; the hull-opacity
  slider fades blocks, skin AND wireframe together.
- Component models: `.gltf` materials named `color1`/`color2` = painted
  surfaces ⇄ `components[].colors`; fixed materials'
  `pbrMetallicRoughness` factors are the real colours (glTF defaults when
  absent: 0.8 grey / metal 1 / rough 1) and `.ini` = mass, `[RENDERABLE]`
  node tree, `[JOINT]` limits, `[TARGET]` frame nodes, `[ADAPTER]` port
  positions, collider box. Placement truth is the `.ini` tree (euler order
  ZYX); gltf node translations are Blender authoring offsets — NEVER bake
  them into geometry; build the whole node map first, then link (parents may
  reference each other in any order). Some renderables are CONDITIONAL:
  Wheel/BigWheel carry both tire toruses (`data.reverse` picks one) + an
  optional mudguard (`data.mudguard === false` removes) — showing all
  stacks a double tire. The viewer shows proxies by default, real geometry
  via the checkbox / `?real` (localStorage `archean-real-models-v2`).
  `Build` type has no model. Component sub-parts place on the engine
  content basis C·chain·C⁻¹·v, C = (x,z,−y) — uniform, no per-asset table
  (FORMAT §Component VERTEX SPACE).

## Performance rules (iGPU-targeted — keep them)
- Static geometry is MERGED: blocks → one mesh per distinct palette colour
  (full faces stitched to rectangles), block+wire edges → 1 LineSegments,
  occupancy boxes → 1 line mesh, pipes → instanced meshes, streamlines → 1
  LineSegments, adapter nubs → 1 mesh per port type.
- Per-frame and per-edit queries go through HASH INDEXES, never linear
  scans. Aero plates: uniform-grid SUPERSET index (3×3×3 probe of 1.5 m
  cells ≥ max influence) above 200 plates; below that the allocation-free
  scan wins (adaptive). All per-frame cell keys are INTEGERS (string keys
  regress). The type-255 mirror sync and adapter index follow the same law.
- Rendering is ON-DEMAND: call `invalidate()` after anything changes; the
  loop draws only on invalidation, control movement, or active flow. Never
  reintroduce unconditional per-frame `renderer.render`.
- Component materials are intentionally NOT shared: selection writes
  `material.emissive` per mesh (shared materials light every same-coloured
  part).
- `renderer.setPixelRatio` floored at 1, capped at 2.5, re-applied on
  resize (dpr < 1 renders below CSS resolution = grainy; Chrome persists
  per-site zoom, Ctrl+0 is the only reset).
- `fitCameraToModel` frames at `max(1.85r, 3.6m)` (a 1 m craft framed at
  1.1 m = stuck-zoom feel; fly-to is manual: canvas click / list dblclick).
- `?perf` writes `draw=<renderer.info.render.calls>` into the title.
  SwiftShader fps numbers are meaningless — compare draw-call counts only.
  Run `tools/perfprobe.py` before touching render/flow hot paths (PERF.md).

## Known sharp edges (accepted — full origins in docs/HISTORY.md)
- GAME-hullified saves: in-game hullify saves (e.g. the airliner's, backup
  in client/blueprints/3309955432/*.bak) anchor their skin records so our
  decode shows GIANT stray prisms (per-axis `frame_*` like −11). Arbitrate
  against the dev viewer before supporting them visually; the
  coplanar-dashboard burial bites these files too.
- Data-source drift is the FIRST check when a craft renders differently in
  the dev server vs Pages: dev corpus resolves to the MACHINE-LOCAL in-game
  saves, the deploy pins repo testdata — diff the two blueprint.json first
  (`app/tools/livery.mjs` arbitrates live). SECOND: the IndexedDB craft
  cache (`stats().loads` staying 1 with old data = served from IndexedDB);
  it is SHA-versioned — stale/unknown fires the gate.
- Envelope lift OVERcounts by ~one wall layer (interior + enclosing shell);
  sub-3-cell cavities seal to 0; SUBGRID nested blocks are NOT voxelised
  (a cabin walled by subgrid hatches under-seals).
- Prism twin identification = corner-SET reflection match (duplicate
  identical prisms can cross-pair; winding-agnostic so a flip keeps pairing).
- The mirror plane is the WORLD x/y/z 0-plane (game convention): a craft
  authored far off 0 twins its placements far away — ⊘ for those. AUTO twin
  arms on ANY craft whose part graph carries twin masks — asymmetric
  additions to a symmetric craft need ⊘ first.
- X-ray ghosting rebuilds index-filtered clones per hover episode (per-mesh
  reject is the AABB); an active-X-ray scene reload leaves overlays on stale
  meshes until the next hover-clear. One-shot ~ms, accepted.
- Lift/cost readouts live in ⌖ Info ONLY (the + Parts dock is 3 cards).
  Modify-mode part clicks AUTO-JUMP to + Parts by design.
- THE MODEBOX floats over its part and SHIELDS the canvas (swallows
  pointermove/clicks under it) — specs close it with a SKY click first.
  Re-clicking the ACTIVE mode tile drops to ⌖ View — click mode tiles
  conditionally.
- A wire sweep under 120 ms never shows the chip (intended dwell).
- Beacon "point forward" display convention: parked (180°-quaternion
  z-sign ambiguity, needs an asymmetric probe craft — FORMAT.md).

## Conventions
- NO CO-AUTHORING IN COMMITS: no `Co-Authored-By` / "Generated with" /
  AI-tool trailers — not model initiative, not tool defaults — unless we
  ask explicitly. A tool with trailer defaults (Claude Code:
  `includeCoAuthoredBy`) gets them disabled BEFORE committing here; commit
  as the repo identity only.
- Say "we / us", never "the user" — replies, commit messages, comments,
  docs. Quoted history that already reads `user:` stays as written.
- view3d.js is one flat file with `// ---------- sections ----------`.
  UI = DevTools-style rows built by `row()`; new tunables get sliders, not
  prompts.
- `row().set()` and `markDirty()` MUST repaint (call `invalidate()`):
  programmatic `.value` writes and BUTTON handlers fire no 'input' event.
- Keep headless testability: no top-level awaits on user input; report
  results in `document.title` / `#out` for `--dump-dom`.
- app/ obeys the tool rules: no machine paths (`vite-corpus.ts` mirrors
  config.py), byte-identical saves, no releases without the user asking.

## Backlog (live items)
- **P9 — CLOSED (v1.15.0):** multi-computer farm + HUD/beacon radio all
  landed (REWRITE.md § P9; laws in § Xenon above; narrative
  docs/HISTORY.md). ChipOS groundwork = the farm + IoBus + beaconNet.
- **P8 — Xenon workspace as a STANDALONE, low-coupling module**: shape,
  coupling inventory and the four seams (write-path, screen-feed, key-bus,
  shell-descriptors) in REWRITE.md § P8; P3 (project tree) + P4 (upstream
  PRs) land inside the module. Until scheduled: the no-cross-import rule in
  § Xenon.
- **WIRE integrity check + repair**: files written by older builds carry
  pipe endpoints referencing components that do not own the named port, and
  the census reports those as real connections. Wanted: flag a pipe whose
  endpoint component lacks the port, or whose cable tip sits > ~1 m from
  every port of the referenced component (thresholds per kind — visible
  sockets legitimately sit ≈0.5 m off `[ADAPTER]`); add a "re-drop this
  cable onto the components its ends touch" repair.
- **Vessel information editor** (Edit ▾ renders it DISABLED): write
  top-level `author` + `data.alias` through `docSet` (byte-safe string
  writes) + the gallery title. The abbreviation/"license-plate" code has NO
  format backing in the corpus — it is either `alias` or needs a new key +
  verified game tolerance first.
- **Slider discipline**: per-field steps from the game's
  `modules/*/config.yaml` ranges, not one global 0.1; integer fields respect
  ints; block cx/cy/cz and component position rows move in FIXED 0.25 m
  cell increments (keyboard ± nudges exactly one increment).
- Dashboard BUTTON elements (Toggle/Push/Arrow/Led) as real glTF models
  with the game's base transform + state animation (dev-viewer parity;
  FORMAT §Handedness); today plate+text approximations.
- Better flight-characteristics / stability analysis (full 360° velocity
  vector, stable-flight search at low/high speed + ambiguity warning,
  trim/drag polar). User-requested, deliberately deferred.
- Aero model is stylized thin-plate (Cn = 2π·sinα·cosα), not CFD — the
  label keeps. Joint animation is static (in-game deflection state is not
  stored in the blueprint file).
- Legacy viewer PORT decisions (viewer frozen; needs the user's call + its
  pins re-derived): content-basis sub-part placement, propeller
  data-generated geometry, the app's raw-quat gizmo look.
- Optional before wider publishing: trim `testdata/` to the author's own
  craft (the others are workshop copies — NOTICE §2).

## Licensing notes (see NOTICE.md)
- Code is GPL-3.0; game data belongs to the game developer
  (batcholi/FloDKSM).
- Investigate provenance of anything of uncertain origin before extending
  it.
- No rights-holder permissions are claimed; reuse is presumed in good
  faith, CC-attribution spirit. Rights-holder objections are handled
  amicably via issues (NOTICE §4) — keep that transparency in any
  licensing-related change.
