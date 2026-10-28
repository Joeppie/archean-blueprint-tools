# AGENTS.md — development guide

This repo reverse-engineers the **Archean** game's `blueprint.json` format and
provides a zero-build browser viewer/inspector. The React app in `app/` is the
app; `viewer/` is the frozen legacy inspector kept as a port-reference and
Pages artefact. Everything is static: plain ES modules + Three.js from CDN;
`app/` is vite + React + TypeScript (own npm project).

**This file is the LIVING RULES ONLY** — format law, the "never X" list,
workflow, tooling. Every dated session narrative, superseded ruling, pin
history and version story moved to **`docs/HISTORY.md`** (2026-10-28): read a
history section for provenance when you touch its subsystem; never for
orientation. `git log` of AGENTS.md is the other backstop.

## Layout
```
viewer/index.html + view3d.js   the inspector (Three.js core module)
viewer/tests.js                 the headless suites (selftest/proxytest/comptest/
                                uitest/gizmatest/postest), split out of view3d.js
                                in v0.169; driven via the window.HARCHEAN hooks
                                object (live getters+setters). Loaded ONLY for
                                suite URLs (dynamic import in index.html)
viewer/hullfit.js               exact hull-lattice mapping (pure function, no THREE)
viewer/blockshapes.js           block shape+orientation table (type -> geometry/faces)
viewer/palette.js               the game's built-in 256-slot palette + slot resolution
viewer/models/                  real game component models: manifest.json (mass,
                                renderable node tree, joints, adapters, colliders
                                per type) + <Type>.json geometry, lazy-loaded
regtest/regtest.html            format-validation suite over testdata/ (importable)
testdata/<workshop-id>/blueprint.json   regression corpus (25 craft + 9000000001
                                orient fixture, 1 kB..530 kB)
tools/adjust_seat.py            reference example of a safe format edit
tools/find_install.py           discover a local Archean install / blueprint
                                saves / workshop dir (the procedure: LOCATIONS.md)
tools/make_orient_test.py       regenerates the chirality probe craft 9000000001
tools/make_matrix_test.py       regenerates the COMPONENT MATRIX fixtures
                                (90000010NN rest / 90000020NN deflected, 3 types
                                per craft; mass+ingredients vs the Xenon dev
                                viewer — see MATRIX.md)
tools/game_data.py              mass & build-cost model straight from the GAME
                                FILES ([ENTITY] mass, modules/*/config.yaml
                                items+recipes); --selfcheck <blueprint.json>
tools/matrix_verify.py          diffs game-file numbers vs the dev viewer's
                                scraped mass/cost panels (reports/matrix/)
tools/matrix_sheet.py           dev│ours side-by-side PNGs per craft
tools/matrix_iou.py             framing-invariant silhouette IoU screen
                                (render-iou.json = the eyeball queue)
app/tools/devscrape.mjs         Playwright matrix driver: Xenon viewer panels +
                                iso screenshots, our viewer via HARCHEAN hooks
app/tools/sidechir.mjs          chirality probe: our viewer's ±x side + cockpit cameras on the
app/tools/devchir.mjs           airliner; dev side via its XenonViewer capture API (FORMAT
                                §Chirality vs in-game truth — the game's screenshots arbitrate)
app/tools/onebyone.mjs          per-COMPONENT matrix triage: our viewer, one part in frame,
                                nothing selected + node bboxes / label ink / occupancy JSON
tests/matrix.sh                 the whole matrix ritual (see MATRIX.md)
tools/make_landing.py         regenerates the landing gallery + viewer/workshop.json
tools/xenoncode/              XenonCode IN THE BROWSER: the dev's interpreter
                              (batcholi/XenonCode, pinned + rebuilt by build.sh)
                              compiled to WASM + our Archean device shim + the
                              "simulated computer" standalone landing page
                              (hello.xc / plane / cheap-exploration-plane);
                              see tools/xenoncode/README.md + NOTICE §6
tools/add_workshop.py <id>      ingest a locally-subscribed workshop craft
                                (names: tools/ws-names.tsv, fetched slowly — Steam rate-limits)
tools/extract_models.py         regenerates viewer/models/ from an installed game
tools/extract_economy.py        regenerates viewer/models/economy.json — the
                                crafter recipes + catalog ids behind the app's
                                VIEW ▸ Build cost (same game tables as
                                game_data.py); --check fails when stale
tools/make_solo_test.py         SOLO component fixtures (1 type/craft, ids
                                90000030NN) for the vertex-space pair ritual
tools/solo_verify.py            scores reports/solo (IoU + local-box, dev vs app)
app/tools/wheelpair.mjs         REAL-CRAFT root-pose check (the solo ritual's
                                root-blind-spot companion): world bboxes of
                                --types components in BOTH viewers' live scenes
                                (truck leg: killed the droop for LEGACY files;
                                modern-file casters hang per displayQuat — FORMAT)
app/tools/subride.mjs         REAL-craft SUBGRID joint audit: every (subgrid, master) pair's
                                captured joint line (on its panel? near its part? no phantom
                                lever) + the exactness of the panel riding the part's gizmo motion
app/tools/staticinfo.mjs      viewport footprint of the STATIC INFO card (phone vs desktop)
app/tools/hinging.mjs         where each SUBGRID's joint-handle (ring/arrow) lands ON SCREEN vs its
                                master part — a mirrored clamp line put the handle metres away
app/tools/jointturn.mjs       one joint's ANGLE turn traced: a point on the joint line must not
                                move, the panel centre must circle it at a constant radius
tools/asset_space.py            SUPERSEDED collider-census (kept for provenance;
                                its "per-asset vertex space" was a basis artifact)
tools/security-scan.py          checkin gate: secret-shape scan (--staged/--tree/
                                --history) + release-string sync (--versions)
tools/release.sh                THE release ritual: full-suite gate → ff release
                                branch → annotated vX.Y.Z (SEMVER, see
                                § Versioning) tag → push (+ GitHub Release
                                notes via gh, best effort)
tools/install-hooks.sh          ONE-PER-CLONE: installs tests/pre-commit into .git
tests/pre-commit                the mandatory gate hook (see Checkin gate below)
tools/perfprobe.py URL [s]      real-clock headless perf probe (DevTools ws;
                                ?perf titles under --virtual-time-budget are
                                meaningless — clocks/rAF freeze there)
tests/run_tests.sh              headless-Chromium test runner (selftest+regtest+renders)
FORMAT.md                       format documentation (start here)
LOCATIONS.md                    how to find an Archean install, its local
                                blueprint saves (Archean-data/client/blueprints)
                                and workshop downloads (workshop/content/2941660)
                                on ANY machine — Steam appid 2941660,
                                appmanifest + libraryfolders.vdf procedure
PERF.md                         measured perf baseline + harmful-candidate catalogue
                                (run perfprobe before touching render/flow hot paths)
NOTICE.md                       licensing: GPL code, game content belongs to batcholi/FloDKSM
docs/HISTORY.md                 archive of the dated session narratives (moved out of
                                AGENTS.md 2026-10-28 — provenance, never orientation)
docs/TEST-PYRAMID.md            test-pyramid strategy + measured baselines
docs/E2E-INVENTORY.md           e2e spec inventory (tiers, fixtures)
REWRITE.md                      rewrite phase plan (landed phases marked; P8 live)
```

## Blueprint folder (rule — machine-local paths are configurable)
The repo may be cloned ANYWHERE: never assume it lives inside the Steam tree,
and NEVER hardcode a machine-local absolute path (Steam install, workshop
content dir, a user's home) in a tool, test or script. The blueprint
CORPUS — the folder of `<workshop-id>/blueprint.json` dirs — and every other
outside-the-repo path resolve through ONE module, `tools/config.py`, in three
tiers: env `ARCHEAN_BLUEPRINTS` / `ARCHEAN_WORKSHOP` / `ARCHEAN_GAME` >
gitignored repo-root `blueprints.conf` (KEY = value; see
`blueprints.conf.example`) > built-in defaults (corpus = `<repo>/testdata`,
so a fresh clone works unchanged). Print the resolved paths with
`python3 tools/config.py`.
- Python tools: `import config` (sys.path include of `tools/`) and use
  `config.blueprints_dir()` / `workshop_content_dir()` / `game_dir()` —
  add_workshop, make_landing (--webroot sets the generated links' URL prefix),
  make_orient_test and extract_models (game_dir now optional) all do.
- Browser suites mirror this: `regtest/regtest.html?corpus=<url>` overrides
  the corpus root (default `../testdata`); `tests/run_tests.sh` resolves the
  corpus via config, serves the repo+corpus common ancestor on one static
  server and passes the corpus URL automatically (regtest + postest `?open=`).
So pointing at a different blueprints folder is pure configuration — no code
or path edits anywhere. On a NEW machine, discover the paths with
`python3 tools/find_install.py` (procedure documented in LOCATIONS.md: Steam
appid 2941660 → libraryfolders.vdf → appmanifest_2941660.acf →
`common/Archean/Archean-game` + `Archean-data/client/blueprints` +
`workshop/content/2941660`); NEVER commit a resolved machine path — the only
config file that may hold one is the gitignored `blueprints.conf`.


## The app (app/ — React + TypeScript — THIS IS THE APP)
`app/` REPLACED `viewer/` (the rewrite landed); ALL new feature work happens
there. `viewer/` + `viewer/tests.js` are FROZEN port-references — do not
delete them (Pages/release still serves them; removal needs the user's
explicit say-so). The per-version build narrative behind every rule below
lives in **docs/HISTORY.md §1** — consult it for provenance, this section is
the law.

### Writes, saves, undo
- EVERY mutation path ends in the DOC: bp is the live model, the doc mirrors
  it, and `emitDoc(doc)` is the save AND the undo snapshot. A doc mirror into
  an array the file never carried (`docArrayInsert` on a missing path) fails
  SILENTLY — use the funnels in `engine/edit.ts`: `appendTrianglesDoc`
  (freshly generated records), `mirrorTrisDoc` (records bp already carries),
  `docEnsureObject`/`docEnsureArray` for parents. NEVER write bp only.
- Undo = `emitDoc(doc)` snapshot stack; the 450 ms debounce coalesces a drag
  into ONE entry. Pins that must undo separately space edits > 450 ms apart.
- Deleting a component runs `pruneCompRefs` BEFORE the splice: `data.pipes`
  (`a_component`/`b_component`) and `composite_builds` index the FLATTENED
  component array — refs into the deleted subtree drop with their entries,
  later refs renumber in bp AND doc.
- The tool NEVER rewrites an orientation it did not edit; saves stay
  byte-identical to the game's JS (`doc.ts` keeps every raw literal — bare
  ints for int-modelled fields, `"13.0"`/`"1e-08"` style for doubles;
  `json.dumps(separators=(',',':'), ensure_ascii=False)`).
- DATA assertions cannot pin a repaint — assert through `stats().loads`
  (load/reload count) or pixels. Block-widget commits route through the
  180 ms debounced `sceneChanged()` reload; live inspector edits route
  through `Engine.liveDataEdit` (one in-place real-model rebuild per frame,
  NO full reload).
- New write paths that generate records into a file that may lack the list
  MUST guarantee the doc array (v1.6.1 class bug: visible in session, gone
  in the save, invisible to redo).

### Geometry and lattice
- Cell = 0.25 m; cell c covers `[(c−6)·CELL, (c−5)·CELL)`; the ⇄ twin of
  `[c,c+e)` is `[12−c−e, 12−c)`. Blocks MAY cross frame borders (the only
  storage rules: `pos_*` ∈ 0..12, sanity size ≤ 24; the corpus has 26 053
  crossings).
- The triangle 32-slot vertex window is FRAME-ALIGNED:
  `v = g − 12·floor(min/12) ∈ 0..31` — `encodeSkinTri` IS the law.
- Any helper mapping stored skin records through a position change treats the
  window as something to CUT, NEVER to filter: encode-else-`splitFace` with
  the source record's colours/material/smooth re-worn. NEVER slice a
  transformed list by pre-transform counts (splitting ADDS records).
- hullify is FACE-EXACT: emitted triangles are block-shape face triangles at
  the block's cell corner; culling is adjacency only. Area equality CANNOT
  prove shape — containment (`straysOf == 0`) is the pin. Defaults: outward
  + flat (the game's authored convention, fixture 9000006001).
- The convex lattice skin (latsphere Quickhull shrinkwrap) refuses ratio ≥ 12
  honestly (no convex lattice-exact skin storable there): the dialog REFUSES
  with a ⚖ fix probe (measure, don't rule — no clean ratio exists); a
  residual `skipped > 0` = refuse, never a silently-holed skin.
- THE PANEL LAW / PLATE LAW / rig chain for subgrid kinematics: run
  `python3 tools/bench_census.py` BEFORE touching ANY subgrid axis code;
  FORMAT §Subgrids is normative. Balloon fin/rudder mounts were adjudicated
  three times — the final ruling + its discriminating pins are in
  docs/HISTORY.md (v1.9.x bullets); read before touching `balloonfin.ts`.

### Rendering
- Display quaternion = the STORED quaternion raw, BOTH generations (v1.5.11;
  FORMAT §Handedness). The conjugate display law is BANNED — do not
  reintroduce per-generation mappers.
- ONE built-in palette table (the dev's: families 40/84/128/172, slots 0..10
  reserved, NULL gaps kept); per-build palette SCOPING for nested Build
  skins; render rig = XenonViewer's (LinearToneMapping exposure 0.9, day-sky
  PMREM, hemi .35 / sun 1.0 / fill .12 / bounce .10 / softbox .14,
  envMapIntensity 1). A MAGENTA face = cleared slot IN THE OWNING BUILD'S
  palette — check the owning build before repairing any file.
- Hull triangles render as closed 0.05 m prisms (all five colours matter,
  centred caps). DO NOT reintroduce cap-normal welding or shared-edge rim
  culling (retracted v1.5.10 — the rims make a prism read solid). The
  coplanar-dashboard burial is a KNOWN, ACCEPTED open problem: attack the
  RENDER pass if ever, NEVER the extrusion direction (v1.5.16;
  docs/HISTORY.md).
- `hull.ts stitchHullSkin` is DISPLAY-ONLY (welded coplanar cell-skin pairs →
  maximal rectangles); the FILE, pick law, pin/selection visuals are
  untouched; boundary rims stay verbatim.
- APPEARANCE = palette slots ONLY (no per-material shading); the `material`
  0..6 field is GAMEPLAY identity (mass/heat/cost).
- Gizmo + mode widget are COMPONENT-ONLY; subgrids have NO gizmo (they ride
  their masters' joints — the free subgrid gizmo is removed, do not
  resurrect). Gizmo settings are SESSION-only: the modebox ⊘ never survives
  a load, the `archean-app-gizmo` storage key is DEAD (engine deletes it on
  attach).
- Cables: the SOCKET LAW (sockets.ts), the axial LEAD rule (2r along the
  stub axis before any bend), the FLEX GATE (ONLY the file's `flexible` flag
  drapes; routed runs draw their cached polyline verbatim), THE DRAPE LAW
  (catenary at rest length hung between plug necks, taut when overstretched),
  THE HARNESS ATTACH (nested parts' sockets + recorded tips ride the rig
  chain). `pipesSoon` is a 250 ms leading+trailing throttle (cables ride a
  live drag at 4 Hz).
- Data cables draw thin+square (`KIND_SECTION`); the file's `radius` stays
  physical truth, `half` is the drawn extent.
- Mass model = the TS twin of the game's server model (`engine/mass.ts` ⇄
  `tools/game_data.py` cross-pinned, subgrid content counted recursively);
  cost model = `GetBlueprintContents` twin (`engine/economy.ts` ⇄
  `extract_economy.py`). `sealedEnvelopeVolume` = lattice flood (sealed
  blocks and/or a skin; walls alone displace no lift; markers NEVER trusted).
- Ground: the plane mesh is `visible=false` (see-through pad; three's
  Raycaster ignores visibility, so picks/placement rules are unchanged);
  grid lines + ±axis marks are zoom-adaptive (grid.ts ladder) on the WORLD
  lattice.
- Sky backdrops are A MANIFEST: `src/assets/backdrops/manifest.json` —
  adding one = a 2:1 JPG + one manifest line, ZERO code; tests are
  manifest-driven. The dome is a BackSide sphere on layer 1 (never
  `scene.background` — it cube-walls panoramas under ortho).

### Interaction and UI
- NO unsolicited viewport overlays: info cards are ⚙ settings (persisted)
  with their own ✕. PHONE EDGE-DOCK LAW: every viewport popup docks to a
  viewport edge < 768 px; the 3-D widget shrinks (0.6); dialogs reserve the
  Brave bottom clear-zone.
- ONE CONCEPT = ONE WORD in the UI; one n-state control beats a 2×2 flip;
  a refusal is never a dead end (`ToolDef.fix` ⚖ repair).
- UNIFORM MIRROR RULE: every edit on a selected item ALWAYS drives its
  mirror twin in mirrored unison (blocks: cells/sizes/shapes/paint/material/
  delete; parts: positions/rotations/paint/joints/delete; prisms: shift =
  negated delta, rotate = mirror-conjugate quat, flip, delete). FAUX-MIRROR =
  flagged, never silent, WITH SEVERITY: geometry conflict = red ⚠,
  appearance-only = gold + BLUE ℹ popup. Session mirror = ONE axis at a time
  (⊘ disables); twin PLACEMENT auto-arms when the craft's data mirrors
  across the lit axis; the sheet draws ONE plane (the session axis).
- Gizmo semantics: translate = WORLD (space stays axis-aligned), rotate =
  LOCAL rings (intrinsic, WYSIWYG), scale = BLOCKS-only and DIRECTIONAL
  (the grabbed face's side moves, the opposite face anchors); triangles get
  pins (camera-facing-plane drag, ⇧ locks the axis most facing the camera) +
  the centroid widget (WORLD translate cell-snap, LOCAL rotate lattice-
  quantised). Shared TGC event chains: EVERY commit guards on its own
  captured gesture base — one unguarded commit resets the proxy for all.
- Tool dialogs: 86 dvh cap, draggable title, smooth `.tool-scroll` body,
  pinned footer, phone clear-zone; heavy previews run DEBOUNCED on the
  worker (`previewAsync`/`place.stageAsync`), OK is DISABLED while planning;
  Esc-close listeners subscribe ONCE with a callback ref (the Editor
  re-renders between keydowns — the resubscribe race), dialogs' Escape is
  capture-phase + `stopImmediatePropagation`.
- Craft cache: every IndexedDB copy carries rev + SHA-256; stale/unknown
  opens pass the gate (Download-latest vs use-cached, both dates shown);
  FRESH opens keep the ZERO-network rule; catalog stamps follow real file
  changes (the watcher invalidates the gallery module).
- Help = plain-markdown topics (`app/src/help/topics/*.md`) +
  dependency-free renderer (escape ALL input first; every parser loop MUST
  advance `i`); fullscreen on phones (`grid-cols-[minmax(0,1fr)]` is what
  makes `w-full` mean the viewport).
- Boot: atlas manifest fetch fires with the Editor chunk import; the e2e
  storageState ships `archean-app-backdrop=none` (BACKDROP-SKIP FIXTURE
  LAW — a spec gaining a panorama law clicks the row explicitly).

### Xenon workspace (computer / debugger / screens)
- THE CADENCE LAW: the VM cycles at 25 Hz (`CYCLE_MS = 40`, shim
  `xc_set_cycle_ms`); React panels coalesce ≤ 10 Hz; canvases blit EVERY
  cycle. THE STEP LAW LIVES IN TWO PLACES: `stepperLaw()` (xenoncode.ts,
  pure, main-thread) ⇄ the EM_JS hook in `xc_host.cpp` (worker) — ANY
  change lands in BOTH + re-pins. The SAB slot map is documented VERBATIM at
  the hook; payload windows must start ABOVE every slot byte (slot n owns
  4n..4n+4); SAB views decode through `bytes.slice()` copies (TextDecoder
  refuses shared views).
- The interpreter is a FORK SUBMODULE (`tools/xenoncode/upstream`, branch
  `archean`): `build.sh` builds ONLY the recorded gitlink and REFUSES a
  diverged checkout; a bump = submodule commit + rebuilt js/wasm in the SAME
  commit; upstream PRs are one commit per PR from that branch. The device
  shim is OURS (Archean law, not interpreter).
- THE SOURCEFILE TRUTH LAW: name→index tables the VM owns are READ from the
  VM (`xc_source_files()`), never re-derived app-side.
- THE WRITEBACK LAW: value injection is legal only at a PAUSED moment,
  validated per type (numbers finite-decimal, text free; storage/array/
  object REFUSE); `{"ok":true}|{"error":…}`.
- Every new device export is typeof-GUARDED and the shim stamps `xc_abi()`
  vs the app's `XC_ABI` — a stale wasm degrades features, never spams; bump
  both with the shim. Compiled wasm artifacts ride git LFS.
- Screen cap = the game's 10000×10000 (a smaller cap TRUNCATES sprite
  atlases); all surfaces list per tick, pixels fetched only for visible
  canvases + 3-D feed keys.
- Buzzers: `data.mode` = the authored tone (0-3 sine/square/triangle/saw;
  wave `'auto'` = per-buzzer), amplitude `min(1, amp·1.8)·0.4` into warm
  baked PERIODICWAVEs + 7.5 kHz lowpass + 16-level quantization; sound
  defaults ON, the AudioContext is created+resumed in a REAL gesture playing
  a 1-frame silent buffer (a context created in the pump loop starts
  suspended and never resumes).
- THE PILOT-KEY LAW: a cabled/aliased PilotSeat pads to ALL 18 documented
  channels; WASD/↑↓/F/E/Q/I/K/J/L/R/digits/SPACE bind by channel word
  (SPACE = Down/Up AND Aux 1); press = ±1, release CENTERS; global editor
  shortcuts yield while cockpit keys are active; keys never leak while
  typing; a bound channel RESTS AT ZERO at bind time.
- `window.__XCDBG__` = the plain-JSON async debug console over the real pump
  (every answer JSON-serialisable, every call bounded) — the agent seam;
  `__XENONTEST__` the headless autotest seam (fixture 9000008001).
- P8 pending: the Xenon workspace moves to a low-coupling module (REWRITE.md
  § P8). Until scheduled: NO new cross-import from the core editor into
  Xenon internals — new surface goes through the four-seam contract.

### Testing (laws; strategy in docs/TEST-PYRAMID.md)
- TEST-SIZE RULE: every test at the SMALLEST tier that can state the law
  (vitest pure → node integration → e2E ONLY for pixels/real pointer/
  IndexedDB/dev-pair, each new e2e carrying a `// e2e-tier because:` line).
  FIXTURES BEAT CORPORA (`tools/make_*_test.py` → `testdata/900000NNNN`);
  a big craft in a test must defend why the fixture CANNOT exhibit the law;
  a slow test is a DESIGN SMELL — the fix is the lower tier, never a longer
  timeout.
- FIXTURE-FIRST BOOT LAW: geometry-like-behaviour laws run on generated law
  fixtures; real-craft DATA laws belong at the node tier.
- CHAIN LAW: tests sharing one boot + compatible state = ONE test of named
  `test.step`s with `expect.soft(.poll)`; each step restores what it
  mutated; spec surgery via `tools/spec_ops.mjs` (TS-AST spans).
- GATE LADDER: per change `npm test` + `npx tsc -b` + the touched e2e tags;
  per landing on main the FAST tier (`test:e2e:fast` inverts
  `@slow|@while-publish`); @slow only for touched subsystems / user-facing
  boundaries; @while-publish (pins sealing a KNOWN-imperfect state) run
  opportunistically in the Pages-Actions wait + before a release TAG.
- A FLAKE is a RE-TIER signal (migrate the pin down a tier in the same
  session) — heal with self-healing probes / sparsification, NEVER with
  longer sleeps. e2e running WHILE files are edited = phantom failures;
  re-run flakes on the final tree before believing them.
- LESSONS PINNED: probe face-INTERIOR pixels for tiny targets and walk
  probes through the engine's own pick law (canvas fractions are NOT
  aspect-stable); camera SETTLE = two identical `camPos()` samples; when an
  identity law changes, RE-AUDIT every pin that sealed its old trigger.
- PER-COMPONENT PINS (`@<ComponentName>` tags): run the tags you touched;
  a full @slow sweep only when a SHARED render-pipeline file changed.
- The Xenon full-game e2e leg is GONE by design — law fixtures +
  `__XENONTEST__` scripts are the tier.

## Legacy viewer (frozen — the suite is the gate)
- `tests/run_tests.sh` (selftest + regtest + proxy + comp + uitest +
  gizmatest + postest + renders) keeps the frozen viewer's semantics green;
  the commit gate runs its `--gate` pair whenever a `viewer/` file is
  staged. The FULL pin-by-pin descriptions moved to docs/HISTORY.md §3.
- `fitHull` stays GENERIC: zero per-craft constants; the per-craft scene
  probes live ONLY in the POSTESTS table (the sanctioned exception).
- `window.HARCHEAN` (accessor of live getters/setters) is the ONLY test
  handle; `viewer/tests.js` loads by DYNAMIC import — a static import with
  the release `?v=` specifier = a SECOND app instance on one DOM.
- DO NOT RESURRECT: explode/assembly (v0.142); the free subgrid gizmo
  (v0.170); the spheroid block-matching hull generator (its dents, its
  green-pinned-topology lesson and the rebuild contract — pin DEVIATION
  against the ideal surface FIRST, judge in-game pixels — are in
  docs/HISTORY.md 'FAILED ATTEMPT' + branch
  `failed/spheroid-hull-dents-lattice-quantization`/SPHEROID-FAILURE.md);
  per-generation quaternion mappers; cap-normal welding / rim culling;
  view3d's site-zoom counteract machinery (Ctrl+0 in the browser is the
  only zoom reset).

## App toolchain (commands from `app/`; the ONE-SERVER + binding rules below apply)
```bash
cd app && npm install           # one-time
npm test                        # vitest — pure engine core (no browser)
npx vitest run load.perf        #   … the PERF harness (QUIESCENT-ONLY:
                                #   PERF_HARNESS=1 npx vitest run load.perf; it
                                #   SKIP-REPORTS inside the npm-test gate)
npm run build:wasm              # rebuild wasm/seal.wasm after editing wasm/seal.ts
                                #   (the binary is committed; sealwasm.test.ts
                                #   pins JS parity cell-exact)
npm run test:e2e                # Playwright chromium UI suite (e2e/) — FULL
npm run test:e2e:fast           #   … minus @slow AND @while-publish (L8)
npx playwright test --grep '@place|@ui'    # per-area subsets — an unrelated
                                #   change does NOT necessitate a full run
npx playwright test --grep '@Aileron'      # PER-COMPONENT pins: each solo-
                                #   fixture test carries @<ComponentName>; run
                                #   the tags you touched — ALL of @models (or
                                #   the full suite) only when a SHARED render
                                #   pipeline file changed (basis C,
                                #   unityBake/bakeGeo, models.ts loader,
                                #   buildReal/standInBox, scene fan-out)
npm run dev -- --host 0.0.0.0   # NEVER loopback-only (dev-server binding rule):
                                #   browse via the Tailscale IP: http://<ip>:5175/
```

## Commands
```bash
bash tools/install-hooks.sh               # after cloning: enables the checkin gate
tests/run_tests.sh                      # full headless suite (python3 + chromium)
tools/release.sh                        # cut the STABLE release (full-suite gate,
                                        # ff release branch, tag, push — see § Publishing)
                                        # ONLY when the user explicitly asks to release
python3 -m http.server 8650             # manual serving (repo root)
# viewer:   http://127.0.0.1:8650/viewer/index.html
# selftest: http://127.0.0.1:8650/viewer/index.html?selftest  (tab title: SELFTEST PASS)
# gizmatest: viewer/index.html?gizmatest (GIZMATEST PASS n=19; &shot=1|2|3|4 = WYSIWYG screenshot states, 4 = fat ring-hover)
# regtest:  http://127.0.0.1:8650/regtest/regtest.html         (page ends 'REGTEST: PASS')
# other craft: viewer/index.html?open=../testdata/<id>/blueprint.json
# perf probe: viewer/index.html?perf → tab title: PERF fps=… draw=<draw-calls> …
#   (live browsers only; headless: python3 tools/perfprobe.py <url> 12)
python3 tools/extract_models.py <Archean-game-dir> -o viewer/models
```
Headless render shots — use the **AMD iGPU** (~1 s/shot, full budgets):
```bash
VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/radeon_icd.json \
chromium --headless=new --no-sandbox --disable-dev-shm-usage \
  --use-gl=angle --use-angle=vulkan --window-size=1400,900 \
  --virtual-time-budget=15000 --screenshot=out.png <url>   # --dump-dom for titles
```
VK_ICD_FILENAMES hides the NVIDIA ICD from chromium entirely — the discrete
GPU usually runs the user's AI models and MUST NOT be contended (quick check:
`nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv`; if busy,
keep the iGPU pin). tests/run_tests.sh does this by default (whole suite ~6 s).
GPU=0 = SwiftShader CPU fallback: every virtual frame costs 13-300 ms wall,
screenshots at virtual budgets ≥10 s never complete (wall-time cliff) — keep
budgets ≤8000 in that mode.
NOTE: to kill a dev server, use `pkill -f "[h]ttp.server 8650"` — plain
`pkill -f "http.server 8650"` also matches (kills) the calling shell.

## OpenCode session discipline (mandatory — read at session START)
Every OpenCode session works in its OWN git worktree (~/.local/share/opencode/
worktree/…). Two live sessions on this repo therefore SILENTLY fork the commit
graph — caught 2026-10-18 when a sibling worktree held three unmerged feature
commits while `main` moved on (painful semantic merge + a botched shared-
node_modules symlink that deleted the real package tree; restored via npm ci).
Rules:
- At session START run `git worktree list`. A sibling worktree carrying
  commits NOT on main = another session forked this repo: STOP, tell the
  user, reconcile (merge + full gates) BEFORE doing new work.
- Land finished work on main (ff-only, see § Publishing — merges/pushes to
  main are routine; only the RELEASE cut needs the user's explicit ask).
  Never leave the session's only copy of the work in its own worktree.
- NEVER symlink node_modules (or other state dirs) between worktrees or into
  the main checkout; each checkout runs its own `npm install`. The gitignore
  says `node_modules` (no trailing slash) exactly so a stray link can never
  be committed.
- One live session per repo: before starting a NEW conversation here, have
  the current one merge to main, then `git worktree remove <it>` (stale
  entries: `git worktree prune`). `git worktree list` is the live map.
- **ONE SERVER RULE (user rule 2026-10-22: "never more than one server"):
  exactly ONE dev/preview server for this repo may run on the machine at
  any time.** Two vite servers from different worktrees (5175 old-tree +
  5199 stray) made the user browse a STALE tree and rightly asked "where is
  the help? no menu?" — the new feature was on main the whole time, served
  by the other port. The ritual:
  ① BEFORE starting any dev server, sweep: `ss -tlnp` the ports (5175 +
  any E2E_PORT) and resolve every listener's cwd (`readlink /proc/<pid>/cwd`)
  + `pgrep -af vite` — KILL every repo-vite you find, whoever started it;
  ② start exactly one, from the checkout the USER browses (normally the
  main checkout), bound `--host 0.0.0.0` (Tailscale rule), and hand over
  THE user's browsing URL — `http://<tailscale-ip>:5175/` (fetch the CURRENT
  ip with `tailscale ip -4`; at the 2026-10-22 ruling it was
  100.117.137.1, machine ark);
  ③ VERIFY the served tree, never assume — e.g.
  `curl -s localhost:5175/src/components/TopBar.tsx | grep -c Manual` must
  match the feature set you just shipped (a port answering 200 says nothing
  about WHICH tree it is);
  ③b AFTER EVERY LANDED CHANGE the server must run the CURRENT tree: vite
  HMR covers ordinary edits automatically, but a checkout switch, a worktree
  move or a dependency change means RESTART it (kill + start + re-verify ③)
  — the user always browses the up-to-date app, never a stale process;
  ④ before ending the session, kill the server you started (and any stray
  repo-vite) and re-run ①. Start it DETACHED — `nohup setsid npm run dev
  … >/tmp/opencode/dev5175.log 2>&1 & disown` — a harness background shell
  dies with its session and silently takes the server with it (the user's
  "dev server not up?" 2026-10-22). Playwright's webServer (app/playwright.config
  .ts) starts its OWN server only when the port is free (`reuseExistingServer
  `!) — a foreign server on the port means the suite silently tests THAT
  tree: always pass a dedicated E2E_PORT and sweep first.
- **CLEAN UP STALE WORKTREES (user rule 2026-10-22: "always clean up stale
  worktrees that have no work!!"):** at session START and again before
  session END, `git worktree list`; for every sibling worktree check
  `git -C <it> status --short` + `git -C <it> log main..HEAD` — no dirty
  files AND no unmerged commits = no work: remove it
  (`git worktree remove --force <it>` — the force covers the gitignored
  node_modules), then `git worktree prune`. A worktree carrying work is
  NEVER deleted — reconcile (merge) first. The shared stash lives in the
  COMMON repo (`refs/stash`), so it survives worktree removal untouched.
  Rationale: every live worktree is another session (or another zombie dev
  server) that can fork the graph or squat the user's ports.


## Checkin gate (mandatory — the hook is the enforcement)
Every commit passes `tests/pre-commit` (install once: `bash
tools/install-hooks.sh`): (1) `tools/security-scan.py --staged` — the staged
blobs are scanned for CREDENTIAL SHAPES (private keys, GitHub/AWS/Google/
Slack/npm/PyPI/OpenAI tokens, JWTs, ssh keys, basic-auth URLs, Steam WebAPI
`key=<32hex>`, password/token assignments) — any hit blocks the commit;
(2) `--versions` — when a release-string file (or the viewer) is staged, ALL
context-anchored version strings (viewer title/header, `view3d.js?v=N`,
README ×2, landing ×2, app title) must agree, so the release ritual can never
ship a mismatched build. Deep scans: `--tree` and `--history` (every blob of every
revision). Baseline audit 2026-10-09: tree (250 files) + history (1211 blobs)
= ZERO secret hits; no emails/IPs/tokens in the tree. INTENTIONAL, audited,
public data: testdata blueprints carry workshop authors + timestamps
(NOTICE §2), ws-names.tsv the public craft titles; the git identity
(GitHub noreply, public by design) is author metadata, not repo content. No CI
secrets exist (Pages builds from the branch; no workflow files).
(3) v0.161: when ANY `viewer/` file is staged, the hook runs
`tests/run_tests.sh --gate` — the headless SELFTEST + REGTEST smoke pair
over the tree (~5 s, iGPU-pinned; chromium present required). Gate PASS is
commit proof; the full suite (uitest/gizmatest/postest/renders) is the
RELEASE gate — `tools/release.sh` runs it and refuses to cut a release on a
FAIL. (2026-10-09 remediation: the user F5'd the dev server
mid-session, saw a selftest FAIL under the SAME v0.160 label as the pushed
release, and reasonably concluded the release was broken.)


## Versioning (semver — user rule 2026-10-20)

`vX.Y.Z` (pre-rule 2-part tags v1.0…v1.3 read as `X.Y.0`). Bump the SMALLEST
component that describes the work — do NOT spend a `Y` on a fix.

- **X — major**: an overhaul / change of shape. Requires the user's EXPLICIT
  instruction ("make it vX.0" in those terms). An agent NEVER cuts itself
  onto a new major on judgement; when unsure, ship a Z.
- **Y — minor**: a new user-visible FEATURE (a new mode, panel, tool,
  analysis).
- **Z — patch**: fixes, tweaks, wording, thresholds, tools, docs.

Bump AUTHORITY (user 2026-10-20: "You are allowed and SHOULD bump patch
versions unless you get an OK for a new release/functionality (you can
suggest that!). but no user-unackowledged bumps."):
- PATCH: agent-owned — bump the strings at SESSION START (the dev-label rule:
  an in-progress tree must carry the NEXT label, a dev snapshot wearing the
  last release's string is indistinguishable from a pushed one) and for any
  fix landing; announce it in the commit message. No asking needed.
- MINOR/MAJOR: user-owned — PROPOSE ("this batch adds <feature> — suggest
  vX.Y.0, OK?") and WAIT; until assent the tree carries the next Z.
- Multiple stacked changes = ONE bump: the version describes the RELEASE,
  not the commits inside it.

Enforcement: `tools/release.sh` refuses 2-part strings, refuses moving
BACKWARD of the newest remote tag (EQUAL = the suite-re-run path), prints
`semver bump: …` so a fix-onto-Y misfire is visible;
`tools/security-scan.py --versions` keeps every context-anchored version
string (viewer title/header, `view3d.js?v=`, README ×2, landing ×2, app
title) in lockstep.

## Publishing (GitHub Pages — release-branch + generated `pages` scheme)
Live site: `https://joeppie.github.io/archean-blueprint-tools/` — the React
app IS the site root; the frozen legacy inspector lives at `/viewer/index.html`
behind a small link at the END of the gallery. Pages serves the GENERATED
`pages` branch; `git push origin main` never moves the live site.
- `main` = development (pre-commit gate only; Pages ignores it).
- `release` = stable, ff-only from main, never rebased/cherry-picked onto.
  It is branch-protected (force-push + delete blocked; the `allow_force_pushes`
  flag toggles via the protection API PUT for sanctioned history rewrites,
  restore it after).
- `pages` = PUBLIC artefact: an orphan snapshot built from the release ref by
  **`tools/deploy_pages.py`** (pure build in a detached worktree, npm ci; the
  compiled gallery pins ARCHEAN_BLUEPRINTS to repo testdata so a machine-local
  Steam corpus can never leak into a public bundle). NEVER hand-edited; its
  history is disposable; `release` is the truth. Pages source:
  `{"source":{"branch":"pages","path":"/"}}` via `gh api -X PUT
  repos/Joeppie/archean-blueprint-tools/pages`.
- The ritual: **`tools/release.sh [vX.Y.Z]`** = preflight (clean main, pushed,
  strings agree, 3-part SEMVER moving FORWARD, tag free, origin/release an
  ancestor of main) → COMPLETE suite (`tests/run_tests.sh`; a FAIL aborts,
  release untouched) → ff `release` → annotated tag + push → best-effort
  GitHub Release notes (gh, absence only skips). THEN the site moves only via
  `tools/deploy_pages.py` (Pages rebuild = an Actions job; check
  githubstatus.com before suspecting the push).
- **A RELEASE CUT requires the user's EXPLICIT say-so** ("release it", "cut
  the release", "ship it"). Finishing work, a green suite, a commit, or a
  push to main do NOT imply one. Full-suite RUNS for verification stay
  encouraged — only the CUT is gated. Hotfixes go through main and re-release.
- App data routes are page-relative and LAYOUT-EXACT (`testdata/…`,
  `viewer/models…` at root; `../` fallbacks; legacy link root-exact because
  `../` would escape the Pages prefix; vite `base './'`) — the repo URL path
  is never hardcoded.

## Test strategy (laws above, plan in docs/TEST-PYRAMID.md)
- The pyramid (docs/TEST-PYRAMID.md): every law at the SMALLEST tier that can
  state it; L1 pure logic → vitest, scene-graph pose/pick/census → vitest
  (headless seams), DOM/state wiring → jsdom component tests (the
  VIEWPORT-MOCK harness mounts the real Editor state machine in jsdom),
  ONLY pixels / real pointer plumbing / IndexedDB / dev-pair stay e2e.
  L3 a flake is a re-tier signal. L4 the pixel7 matrix is OPT-IN (a spec
  joins only when it carries a device law). L5 an e2e leg dies in the SAME
  commit as its lower-tier replacement reproducing the green values.
- Measured baselines live in docs/TEST-PYRAMID.md + PERF.md — never re-litigate
  numbers from memory; re-measure (app/tools/bootprobe.mjs, load.perf).

## Sources of truth (all offline — do NOT web-fetch to answer format questions)
- **FORMAT.md is the knowledge base.** Everything reverse-engineered lives
  there (grid maths, block culling rules, hull triangle exact lattice, linear
  colour/PBR semantics, palette defaults, gltf material factors, conditional
  wheel parts, .ini placement rules). Read it before investigating anything.
- Game assets on disk: `~/.local/share/Steam/steamapps/common/Archean/Archean-game/modules/<module>/components/<Type>/<Type>.{gltf,ini}`
  (= the tools/config.py `game_dir` DEFAULT — override via ARCHEAN_GAME or
  blueprints.conf; resolve every machine-local path through config, see
  § Blueprint folder; discover on any machine via tools/find_install.py +
  LOCATIONS.md)
  = ground truth for models/materials/node trees (read the `.gltf` materials +
  `.ini` directly; regenerate `viewer/models/` after extractor changes).
- The dev's own viewer (https://viewer.xenontools.dev/, js modules under /js/ —
  hub page with docs/links: https://xenontools.dev/)
  is the reference implementation for genuinely NEW format questions. When
  used, transcribe the finding into FORMAT.md + code comments in the SAME
  commit so the knowledge stays offline (see FORMAT.md § Local sources of
  truth, and NOTICE.md §2 for its GPL-adjacent porting terms). The official
  Archean wiki (https://wiki.archean.space/en/tools/BlueprintTool.html and the
  rest of wiki.archean.space) documents the in-game side; all reference URLs
  are indexed in LOCATIONS.md § Upstream / reference viewer documentation.

## Format facts (verified — do not re-derive)
- 1 grid cell = 0.25 m; `pos_*` ∈ 0..12; `frame_*` in 3 m units;
  `world = (pos − 5.5)·0.25 + frame·3.0`. −z is the nose (this craft).
- **ONE RAW quaternion law for BOTH generations (v1.5.11, 2026-10-21 —
  supersedes the "two conventions keyed on data.colors" and the "pipes
  0.000 m under R(q*)" claims, which were pre-v0.180 mirrored-chain
  artifacts):** the game places every component as `world = position + R(q)`
  with the STORED quaternion AS-IS; a right-handed renderer plotting raw
  positions with standard RH camera math (the v0.180 de-mirrored view space
  = the raw file frame, matching the game's mirrored screen, FORMAT
  §"Chirality vs in-game truth") uses `viewQuat = (w,x,y,z)` for EVERY file.
  Arbitration (in-game pixels, the only sanctioned arbiter): the game-built
  palette craft IAS-418 `testdata/9000005001` seats all 8 dashboards flush
  (|dot| 1.000, ≤ 0.13 m to their faces) ONLY under raw — the conjugate
  skews the boards through the deck (the user's 2026-10-21 screenshot);
  fixture `9000004001` L/R boards meet corner-to-corner only under raw;
  ISW-241's V1 + V2 saves keep BYTE-IDENTICAL orientations (identical bytes
  ⇒ identical display — the split law made our own corpus render one craft
  two ways); a whole-corpus re-measure of the `data.pipes` endpoints (6309
  port pairs) found NEITHER law near 0.06 m with RAW ≥ conj everywhere, so
  the old 0.000 m proof cannot hold in the file frame. `toViewQuat` (the
  single raw seam; the per-generation mappers were removed in the v1.9.4
  cleanup) is the identity for BOTH generations; the legacy flag keys only
  PALETTE resolution (and the wheel-droop gate).
  Pins: `app/src/engine/__tests__/placement-law.test.ts` +
  `app/tools/flushcheck.mjs <craft>` (live-scene audit, PASS on 9000005001).
  See FORMAT.md § Handedness (v1.5.11 ruling, NORMATIVE).
- **v1.5.10 HARD RULE (stands): the tool NEVER rewrites an orientation it
  did not edit.** The game stores quaternion bytes VERBATIM across
  generations (ISW-241's 2025 workshop file and the game's 2026 palette
  re-save share byte-identical orientations), so the old normalize rule 4
  (open-time raw→conjugate rewrite) made palette-less exports load FLIPPED
  in game — user's wheel-on-top + torn dashboard murals, 2026-10-20. Rule 4
  deleted; `bp.__legacyQ` still rides the file's palette flavour (colour
  resolution ONLY since v1.5.11 — it no longer selects a rotation law).
  Pins: `app/src/engine/__tests__/savefidelity.test.ts` +
  `app/e2e/savefidelity.spec.ts`; two-axis probe fixture
  `testdata/9000004001` (game-written L/R dashboards).
- Blocks: `type` = shape+orientation (0 cube, 1-12 slope [4 = thin tilted
  rod], 13-20 corner, 21-44 pyramid, 45-52 inverse corner — table in
  `viewer/blockshapes.js`, transcribed from the game's BlockShapes.hh via the
  dev's XenonViewer); `colors[7]` = palette slot per face (face order in
  blockshapes.js). Interior-wall culling (ported from XenonViewer): full faces
  cut cell-by-cell against a full-face grid in absolute cell coords, surviving
  cells stitched back into rectangles; partial/slant faces die when fully
  cell-covered, and two blocks presenting the SAME partial-face footprint
  (slope glued to slope) form an interior partition — both copies drop.
  Subgrids: `Build` components carry nested blueprint data
  (hatches/doors), stored CLOSED at grid coords.
- Components' `occupancies` are mirrored by type-255 entries in `data.blocks`.
  **Any save must keep them in sync** (round(delta/0.25) cells, both places).
- Save format must serialize byte-identical to the game's JS:
  `json.dumps(..., separators=(',',':'), ensure_ascii=False)` — no spaces,
  key order preserved, no reformatting.
- `components[].colors` may be a dict (`color1`/`color2`) in v2 files — handle both.
- Hull triangles: vertices live on the SAME lattice as blocks —
  `world_ax = (v_ax + W·frame_ax)·pitch_ax + C_ax` with **W=12, pitch=0.25,
  C=−1.5** exactly (v are cell-slot integers, cross-frame weld pairs sit
  Δv = 12). The old per-file pitch fit (≈0.23-0.29) was an approximation that
  left the skin 3-15 % off the block hull — do not reintroduce it. Shared
  slots = welded points; winding order flips the normal. The game renders
  each triangle as a closed 0.05 m prism: colours[0] front, colours[1] back,
  colours[2..4] the side walls along edges v0-v1, v1-v2, v2-v0 (all five
  colours matter; ISW-241 uses slots 0, 4, 51 = hull, glass, chrome).
- `pipes` segments: `dir` 0..5 = +x,+y,+z,−x,−y,−z; the first/last segment ends
  are world-space connector positions (trace pipes to place ports). Pipes are
  NOT straight chains — every segment anchors at its OWN `start` (joints have
  0.04-0.14 m offsets; accumulating dir*len drifts tubes off the cables).
  Endpoints ARE the connection points: the game writes cable tips at the
  part's VISIBLE socket, which can differ from the `.ini` [ADAPTER] position
  (battery socket on the front face; adapters = bottom terminal grid). Draw
  paths exactly as recorded — adapter-snapping endpoints + taper-shifting
  paths is the v0.99 regression (broken lines, nubs off the model): do not
  reintroduce. Cable-free adapter nubs >0.5 m from the part origin are
  build-time flanges (SolarPanel's spare ports sit 1.0 m below the pivot =
  "red & blue spheres on the ground under the panel") — skip them.
  FluidJunction cables are cached in the builder's FLAT frame (outlets up,
  row along fuselage) — the junction's display pose matches that frame
  (mirror-conjugate file quat), which is why the comb lies flat along its
  pipes. See FORMAT.md.
- `components[].type === 'Build'` = editor construction-site ghost, far outside
  the bbox — never render it as geometry. THE NUANCE (v1.11.6): a Build
  entry inside subgrid CONTENT is an ASSEMBLY node, not a ghost — the
  entry itself renders nothing, but its blocks/skin/parts render
  RECURSIVELY inside the owning top-level Build group (the Dorito SSTO's
  front wheels are Wheels two Builds deep), and composite_builds joins
  whose slave is a nested Build key to the HOSTING top-level group's
  joint chain (`path[2]`). Pins: subgrid.test 'joins to NESTED Builds',
  e2e subride 'a SUBGRID OF A SUBGRID renders' (engine.subStats() census).
- **Subgrids** (v0.153, join decoded v0.154; placement model corrected v0.168):
  Build components carrying nested blueprints (doors/hatches) live as ONE
  Group per Build (`userData.sub`); the group BASE is the IDENTITY and nested
  content sits at its PARENT-frame absolute coords. Build.position/
  orientation = the builder's construction-site GHOST/bench pose (like the
  top-level Build ghost, far outside the bbox), applied on top as a DISPLAY
  offset — NOT an origin. (The old "BuildMatrix∘local" attach model
  double-offsets absolute content: SU-57 gear doors rendered x=±39 =
  "exploded out", and the subgrid gizmo parked at the group origin = the
  Build bench pose, metres from its doors = "rotation on the dolphin doesn't
  work".) The Mount is DECODED, not
  guessed: BOTH `composite_builds[]` indices (master `component` AND
  `slaveBuildId`) are FLATTENED component-array indices (nested content
  numbers BEFORE its Build, recursive subtree sizes — dev readBuild order);
  the master index read top-level is a systematic off-by-(nested-prefix)
  shift that lands on static junk and fakes 69 "deleted editor references"
  (v0.171, user: "jimmy and dorito dont properly id hinge or pivot for
  subgrids"). Flattened, EVERY corpus entry resolves to a joint part with
  live state on the MASTER (`angle` DEGREES / `pos` metres; dolphin doors
  ride real pivots 0/126/180°, XYQ doors hinges 24.3°, Jimmy's gantry
  pivot 54.0° = the ghost pitch — via the master angle, NOT the Build
  pose). **v0.157 joint drive:**
  masters with a
  manifest `joints[0]` (SmallHinge/SmallPivot/Aileron/LinearTrack — NOT
  Lamp/SpotLight, whose joints = [] and whose `angle` is the light aim)
  ANIMATE their subgrid. The spin/slide axes ARE the .ini joint keys
  (extract_models stores axis=angular_x/y/z, slide=linear_x/y/z; v0.171:
  the old uniform x̂ swung the pivot-mounted dolphin doors down-and-out
  like barn doors, user: "doors swing down and out, unlike car doors" —
  SmallHinge/SmallPivot/Propeller spin about the axle's local Ŷ, Aileron
  about X̂, Gyroscope/Drill about Ẑ, LinearTrack slides along X̂):
  axis = viewQuat(master)·axleEuler(ZYX)·e(axis), pivot =
  viewPos(master) + viewQuat·axle.position (RAW local since the v0.180
  de-mirror — the old mirror_z of the axle local, AND the z-negated panel
  bbox that CLAMPS it, are the retired mirrored law; the app port kept the
  mirrored bbox and paid: Jimmy's gantry clamped 30 m off its own pivot, so
  spinning the part swept the panel 11 m — “subgrid rotation is way off …
  rotation isnt properly relative … towards the joints themselves”;
  pinned by app/e2e/subride.spec.ts, audited by app/tools/subride.mjs +
  app/tools/jointturn.mjs); group pose
  p' = pivot₀ + R(axis₀,angle)·(base.p−pivot₀) (+slide₀·pos), q' = R·base.q
  about the BUILD-CAPTURED joint line (g.userData.jref: pivot₀ = the axle
  pivot CLAMPED onto the subgrid's non-255-block bbox = the content's edge
  line nearest the master — v0.173; and axis₀/slide₀ = v0.174-177: for a
  PANEL subgrid (non-empty bbox) the content's OWN longest bbox dimension
  — a door hinges along its long edge: the XYQ doors (longest ŷ) are car
  doors, Jimmy's gantry (longest x̂) folds like "a back door would on a
  car", the truck's 3 m doors hinge vertically while the 0.75 m rear
  flaps tailgate laterally, the flukes deflect as elevons. HINGES use
  their own kinematic TRIAD (v0.175/177, user: "looking at the rotation
  of the hinge or pivot we can determine the precise way that it should
  rotate"): pin = the .ini barrel axis (chain), span d = the longest
  dimension; EDGE-mounted (content runs along its pin, |pin·d|≈1: XYQ
  doors, truck flaps) swings ON THE PIN (= longest, unchanged);
  FACE-mounted (content welded laterally — BOTH dolphin fins: the
  0.25 m skin-fin with the axle off its plane AND the 2-cell-deep fin
  with the axle inside its bbox, which v0.176 yawed "like a door,
  incorrectly") swings on the THIRD axis pin×span — world ẑ at the
  clamped bottom edge, the top edge sweeping in x·y ("collapsing outward
  or inward", "staying close to the frame on its bottom part"); the
  cross's sign is mirror-antisymmetric (Build[4] −ẑ, Build[27] +ẑ under the
  old chain — the pair's signs swap together under the v0.180 de-mirror, the
  ANTI relation is unchanged), so
  equal angles deploy the twin fins mirror-symmetrically, each to its own
  side (bbox-verified); the .ini axle key is the PART's pin,
  NOT the content's animation axis (the v0.171 uniform ŷ key flipped the
  fins into x̂ drawbridges, "wrong in every single tested vehicle"; the
  v0.174 longest-dim yaw kept them "wrong for dolphin still");
  PARTS-ONLY subgrids (empty bbox:
  nested parts riding the axle) keep the .ini key chain. EPISTEMIC
  STATUS (v0.177 audit): the axis rules are an EMPIRICAL FIT to
  user-confirmed in-game motions (dolphin/XYQ/truck/gantry pins), not
  format semantics — all 342 corpus composite_builds entries carry
  exactly {component, slaveBuildId} (no kinematic fields; dev
  blueprint.js ignores the join; masters are exactly SmallHinge/
  SmallPivot/LinearTrack), and the .ini graph fixes only the PART's
  pin (hinge slave slot local +ẑ, pin angular_y). See FORMAT.md
  §Subgrids.
  A master MOUNTED on
  its content keeps pivot₀ = the axle point exactly), then the
  master's
  RIGID POSE DELTA rides the whole thing: p'' = p₀ + dq·(p'−p₀) + (p−p₀),
  q'' = dq·q', dq = q·q₀⁻¹ (v0.172, user: "i move the hinger, the subgrid
  should immediately move in unison with it" — the game composes the
  nested subtree under the master's joint node; a master at its built pose
  composes to identity, so the load display is bit-identical)
  (`syncSubJoints()`, runs from buildSubgrids + every markDirty; the panel
  Mount row exposes editable joint-angle/slide sliders that write the
  master's data verbatim; every kinematic part's OWN inspector shows the
  same fields via Component data; v0.176 `symPropagateJoint`: a joint
  edit propagates the SAME delta to the live symmetry twins — a
  symmetric pair animates in unison, as authored (XYQ doors
  24.3°/24.3°); each twin swings about its OWN captured axis, which
  encodes its side's geometry, so equal angles fold the (asymmetrically
  built!) dolphin fin pair mirror-symmetrically). Subgrid display pose lives in
  `g.userData.base` {p,q} (identity at load, v0.173: the panel's pivot
  offset/rotation rows are REMOVED — user: the six sliders "should not be
  a separate interface" — so base is no longer viewer-written). v0.170
  (user: "i can select and move or rotate a subgrid.
  that is WRONG"): the gizmo and the mode widget are COMPONENT-ONLY —
  subgrids have NO gizmo (selectSub detaches + hides the widget), so the
  ONLY manipulation path is their masters' joint state (the master parts'
  gizmo/sliders, the panel's Mount joint sliders). The free subgrid gizmo
  (v0.159-168: applySubGizmo/subSpin writeback, proxy at the content
  centre, local-space arrows) is REMOVED — do not resurrect. Pins: selftest
  `subjoin`, dolphin/XYQ postest sub-master fixtures (flattened pairs),
  dolphin `subjoint-angle` (sign-sensitive 90° spin about the decoded axis,
  orbit about the CAPTURED joint line),
  dolphin `dooraxis` (parts-riding SmallPivot spin axis ≈ vertical =
  car-door, .ini angular_y)
  + `doorpivot` (hinge fin: joint line clamped to the panel's bottom edge
  AND axis = world ẑ = the face-mount pin×span swivel roll, AND twin
  Build[27] rolls on ẑ with the MIRROR-OPPOSITE sign — equal angles
  deploy both fins out to their own sides; non-vacuous axle offset)
  + `flukeaxis` (fluke panel subgrid axis = x̂ = its longest dimension)
  + `subfollow` (+0.5 m translate and +30° yaw spin of the hinge ride the
  subgrid in unison, sign-sensitive, exact restore)
  + `subtwin-angle` (v0.176: a hinge-angle edit on Build[4]'s master
  propagates +90° to Build[27]'s twin master AND both subgrid groups
  swing +90° about their OWN captured axis — asymmetric twins, unison),
  dolphin `subwidget` (inverted v0.170: component select attaches gizmo +
  widget, subgrid select detaches + hides), 3732302108 `subjoint-pos`
  (LinearTrack slide ∥ its CAPTURED axis) + `railaxis` (panel rail slides
  along its length, not the axle key), XYQ `xyq-dooraxis` (edge-mounted
  hinge doors stay ±ŷ — the face-mount branch must not fire). See
  FORMAT.md §Subgrids.
- Palette slots: `data.colors[256]`, entry = {r,g,b 0-255, opacity 0-15,
  roughness 0-7, metallic 0|1}. **r/g/b are LINEAR albedo** — the engine's
  shaders use them raw; decoding as sRGB darkens the craft ~^2.2 (the ISW-241
  navy read as black). `opacity < 15` ⇒ transparent, alpha = (opacity+1)/16
  (`opacity < 8` = glass). The engine re-imposes slots 0..10 over the file.
  Metal is shaded as metallic·(1 − roughness/7): the game's tracer lights all
  roughness>0 surfaces diffusely, so metalness=1 would wrongly darken painted
  parts (color1's default is metallic 0, roughness 0). See `viewer/palette.js`.
- **v1 files (23 of the 24 corpus!) carry NO `data.colors` at all**: block
  slots and v1 `components[].colors` (a `[slot,slot]` **index pair**, not a
  dict) reference the built-in legacy palette — four 17-colour finish
  families: matte 40..56, polished 84..100, metal 128..144, glass 172..188
  (full table in `viewer/palette.js`, ported from the dev viewer, NOTICE §2).
  **v1 family bases are 4 slots below these v2 bases** (polished 80..96, metal
  120..136, glass 160..176) — the v2 built-in table leaves those v1 indices in
  the empty gaps = the purple blocks (26/61 files). `legacySlot()` remaps
  +4/+8/+12 for palette-less (v1) files only. An all-purple craft = missing
  built-in groups (magenta = missing-slot marker), not a broken file. See FORMAT.md.
- **Dashboard geometry is GENERATED from `data` (glTF = editor template):**
  board = box origin→(size_x/100, size_y/100, 0.01) — CENTIMETRES, corner
  pivot, plane X·Y normal +z; elements at pos/100 z 0.01..0.02; dataport
  re-centred at (w/2,h/2,0); colours 0-255 LINEAR with metal/rough off
  0..255. Viewer `buildDashboard()` (dev-viewer port). Hull UI: blocks +
  triangles share ONE "hull" toggle; the hull-opacity slider fades blocks,
  triangle skin AND the wireframe overlay (v0.149 — lattice pitch/offset
  sliders + auto-fit button REMOVED: the exact fit applies silently).
- Component models: game ships per component a `.gltf` (materials named
  `color1`/`color2` = player-painted surfaces ⇄ `components[].colors`, plus
  fixed materials whose `pbrMetallicRoughness` baseColorFactor/metallic/
  roughness factors are the real colours — tire 0.013 black, body 0.01-0.03
  black, pin/chrome rough 0, connectors (0,.05,.5)/(0.5,0,0)/(0.5,.15,0)
  LINEAR — factors are glTF defaults when absent: color 0.8 grey, metal 1,
  rough 1) and an `.ini` (mass, `[RENDERABLE]` node tree, `[JOINT]` with
  angular limits, `[TARGET]` frame nodes, `[ADAPTER]` port positions, collider
  box). `extract_models.py` packs these into `viewer/models/`. **Placement
  truth is the `.ini` tree** (renderable/joint/target parents, euler order
  **ZYX** like the game engine); gltf node translations are Blender authoring
  offsets (MiniComputer's geometry sits 3 m from its origin, Beacon's base
  node +0.339 z vs the .ini −0.339 y) and must NOT be baked into geometry —
  node parents may reference each other in ANY order, so build the whole node
  map first, then link. Some renderables are CONDITIONAL: a Wheel/BigWheel
  gltf carries both tire toruses (`data.reverse` picks one) and an optional
  mudguard (`data.mudguard === false` removes it) — showing all stacks a
  double tire. Real models are dense (raytracing-grade): the viewer shows
  low-poly proxies by default (boxes + hexagon cylinders) and swaps in real
  geometry only via the “real game models” checkbox / `?real` (persisted in
  localStorage key `archean-real-models-v2` — v0.139 bumped the key so fresh
  opens honour the user-set defaults: hull on, wireframe off, labels off,
  real models off). `Build` type has no model (skipped).

## Performance rules (iGPU-targeted — keep them)
- Static geometry is MERGED: blocks → one mesh per distinct palette colour
  (crafts use a handful; materials are real PBR per colour, full faces are
  stitched to rectangles so a 3 m deck = 2 quads), block+wire edges →
  1 LineSegments (vertex-coloured), occupancy
  boxes → 1 line mesh, pipes → 1 mesh, streamlines → 1 LineSegments, all
  adapter nubs → 1 mesh per port type (world-merged, rebuilt on edit).
- Data structures (v0.155 audit): per-frame and per-edit queries go through
  hash indexes, never linear scans — aero plates get a uniform-grid SUPERSET
  index (3×3×3 probe of 1.5 m cells ≥ max influence 1.48 m; exact slab/r2
  tests run on the result = bit-identical streamlines) above 200 plates;
  below that the ~6 ns allocation-free scan beats 27 hash probes (adaptive,
  `aeroUseGrid`; giant craft 1024 plates 6.5→5.0 ms, airliner 92 plates must
  KEEP the scan — grid measured 2.4→5.0 regression). All per-frame cell keys
  are INTEGERS (`cellKeyV` base-8192 encoding; string keys regressed the
  giant 6.5→7.5, PERF.md #8). serialize()'s type-255 mirror sync (live
  Map index, sequential semantics preserved) and syncAdapters (Map by comp
  index, invalidated at the setModel queue rebuild) index likewise.
- Rendering is ON-DEMAND: call `invalidate()` after anything changes; the
  loop only draws on invalidation, controls movement, or while flow is on.
  Never reintroduce unconditional per-frame `renderer.render`.
- Material sharing is intentionally NOT done for component materials:
  selection highlight writes `material.emissive` per mesh (shared materials
  would light up every component of that colour).
- `renderer.setPixelRatio` is floored at 1 (capped at 2.5, re-applied in
  onResize): browser zoom-out drops `devicePixelRatio` below 1, and
  feeding that through renders the canvas BELOW CSS resolution — upscaled
  = the user's "zoomed in and grainy" on fresh opens. NOTE: Chrome PERSISTS
  per-site zoom across reloads (Ctrl-F5 keeps it; only Ctrl+0 resets), so
  HiDPI+zoom gives dpr 3 — the cap is 2.5, not 2, to keep those sharp.
  v0.179 REMOVED view3d's site-zoom counteract machinery (the localStorage
  dpr-baseline heuristic + inverse CSS zoom + the "reset page zoom" button +
  ?nozoom — todo cleanup: the "stuck zoomed viewer" saga was a Chrome/Linux
  persisted-site-zoom misfire that cured less than it caused). Ctrl+0 in the
  browser is now the only zoom reset; the app was built without any of it.
  `fitCameraToModel` frames at `max(1.85r, 3.6m)` — a 1 m craft framed at
  1.1 m felt like "stuck zoom, tiny FOV, low res" (the user's report;
  fly-to never runs on load — canvas click / list dblclick only).
- `?perf` writes `draw=<renderer.info.render.calls>` into the title; the
  ISW-241 scene is ≈150 draws. SwiftShader fps numbers are meaningless —
  compare draw-call counts only.

## Known sharp edges (accepted behaviours — full origins in docs/HISTORY.md)
- GAME-hullified saves vs our triangle decode: in-game hullify saves (e.g.
  the airliner's, backup in client/blueprints/3309955432/*.bak) anchor
  53 235 skin records so our decode shows GIANT stray prisms (per-axis
  `frame_*` like −11). Arbitrate against the dev viewer before supporting
  them visually; the coplanar-dashboard burial bites these files too.
- Data-source drift is the FIRST check when a craft renders differently in
  the dev server vs Pages: dev corpus resolves through tools/config.py to
  the MACHINE-LOCAL in-game saves, the deploy pins repo testdata — diff the
  two blueprint.json first (`app/tools/livery.mjs` arbitrates live). SECOND:
  the IndexedDB craft cache (`stats().loads` staying 1 with old data = served
  from IndexedDB); it is SHA-versioned now — stale/unknown fires the gate.
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
- **Say "we / us", never "the user"** (2026-10-23) — in replies, commit
  messages, comments and docs alike; quoted history that already reads
  `user:` stays as written.
- view3d.js is one flat file with `// ---------- sections ----------`;
  follow it. UI = DevTools-style rows built by `row()`; new tunables get
  sliders, not prompts.
- `row().set()` MUST repaint (calls `invalidate()`): programmatic `.value`
  assignment fires no 'input' event. `markDirty()` MUST repaint: BUTTON
  handlers mutate data too (sync real-model siblings + nubs there, mirroring
  livePos/liveRot).
- Keep headless testability: no top-level awaits on user input; report
  results in `document.title` / `#out` for `--dump-dom`.
- app/ obeys the same rules as the tools: no hardcoded machine paths (the
  corpus resolves via `app/tools/vite-corpus.ts` mirroring tools/config.py),
  byte-identical saves, and never a release without the user asking.

## Backlog (live items)
- **P8 — Xenon workspace (debugging / computer / screens) as a STANDALONE,
  lower-coupling module** (user direction 2026-10-28). Shape + coupling
  inventory + the four seams (write-path, screen-feed, key-bus,
  shell-descriptors) in **REWRITE.md § P8**; P3 (project tree) + P4
  (upstream PRs) land inside the module boundary. Until scheduled: the
  no-cross-import rule under §Xenon above.
- **WIRE integrity check + repair**: files mangled by pre-v1.5.12 builds
  (e.g. `jimminey.json`: 31 pipe endpoints referencing components that do not
  own the named port) are not auto-repaired; the WIRE census reports broken
  claims as real. Wanted: flag a pipe whose endpoint component does not own
  the port, or whose cable tip sits > ~1 m from every port of the referenced
  component (thresholds per kind — visible sockets legitimately sit ≈0.5 m
  off `[ADAPTER]`), plus a "re-drop this cable onto the components its ends
  touch" repair.
- **Vessel information editor** (Edit ▾ renders it DISABLED): write top-level
  `author` + `data.alias` through `docSet` (byte-safe string writes) + the
  gallery title. The abbreviation/"license-plate" code has NO format backing
  in the corpus — it is either `alias` or needs a new key + verified game
  tolerance first.
- **Slider discipline**: per-field steps from the game's `modules/*/config.yaml`
  ranges, not one global 0.1; integer fields respect ints; block cx/cy/cz and
  component position rows move in FIXED 0.25 m cell increments (keyboard ±
  nudges exactly one increment).
- Dashboard BUTTON elements (Toggle/Push/Arrow/Led) as real glTF models with
  the game's base transform + state animation (dev-viewer parity; FORMAT
  §Handedness); today plate+text approximations.
- Better flight-characteristics / stability analysis (full 360° velocity
  vector, stable-flight search at low/high speed + ambiguity warning,
  trim/drag polar). User-requested, deliberately deferred.
- Aero model is stylized thin-plate (Cn = 2π·sinα·cosα), not CFD — the label
  keeps. Joint animation is static (in-game deflection state is not stored).
- Legacy viewer PORT decisions (viewer is frozen; needs the user's call +
  its Oct-6 pins re-derived): content-basis sub-part placement, propeller
  data-generated geometry, the app's raw-quat gizmo look.
- Optional before wider publishing: trim `testdata/` to the author's own
  craft (the others are workshop copies — NOTICE §2).

## Licensing notes (see NOTICE.md)
- Code is GPL-3.0; game data belongs to the game developer (batcholi/FloDKSM).
- Investigate provenance of anything of uncertain origin before extending it.
- No rights-holder permissions are claimed; reuse is presumed in good faith,
  CC-attribution spirit. Rights-holder objections are handled amicably via
  issues (NOTICE §4) — keep that transparency in any licensing-related change.
