# AGENTS.md — development guide

This repo reverse-engineers the **Archean** game's `blueprint.json` format and
provides a zero-build browser viewer/inspector. Everything is static: plain ES
modules + Three.js from CDN. No bundler, no npm.

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

## The rewrite (app/ — React + TypeScript, IN PROGRESS)
Per the user (2026-10-17) the React SPA in `app/` REPLACES `viewer/` as the
working app: ALL new feature work happens there. `viewer/` + `viewer/tests.js`
are FROZEN port-references (the engine semantics they pin — FORMAT.md, the
invariant list — transfer to vitest/Playwright pins as modules port; see
REWRITE.md for the phase plan, the WASM candidate list and the three.js
fork/WebGPU verdict). Do not delete `viewer/` until REWRITE P5 with the
user's explicit say-so (Pages/release still serves it meanwhile).
- App subgrid UX (todo, v0.179): a selected SUBGRID gets no free gizmo (the
  v0.170 rule) BUT a constrained UI AT THE JOINT LINE — a gold ring per angle
  master (drag writes the master's data.angle in DEGREES about the captured
  axis) and an arrow per slide master (data.pos in metres), Shift-snapped,
  twin-unison via propagateJoint. Pinned by app/e2e/hinge.spec.ts (real
  pointer drag on the dolphin fin + re-grip continuity + subgrid-only gating).
- No unsolicited viewport overlays (user 2026-10-19: "Static info shouldn't
  necessarily show. It's too large on mobile, hide it under settings, x to
  close panel itself"): the KSP STATIC INFO card (mass & CoM) is a SETTING —
  ⚙ row opt-static (localStorage archean-app-static-info; default ON only at
  ≥768 px, OFF on phones), the card carries its own ✕ (static-close) that
  flips the same setting, and on phones it renders COMPACT (164 px card, the
  structural-density detail lines are md-only; measured 3.5 % of a 412×915
  viewport vs 8.6 % for the old always-on 250 px card). Pinned by
  app/e2e/panels.spec.ts (desktop ✕ ⇄ ⚙ row; pixel7 no-box default + compact
  card) and auditable with node app/tools/staticinfo.mjs.
- Mesh fidelity defaults (v0.182 user rule): the app renders the FULL game
  meshes (atlas prim.v) by DEFAULT — the ⚙ row offers the decimated twins
  (lv/li) as the opt-in for weak GPUs (localStorage archean-app-hidef '0').
  The legacy default (decimated twins always) read as "low poly" next to the
  old viewer's full meshes (user report 2026-10-19); heavy-craft LITE tier
  (>800 comps, PERF.md) is unchanged.
- LIVE data edits (v0.182): every inspector data-field write (number/bool/
  string rows, subgrid joint sliders, canvas hinge handles) routes through
  Engine.liveDataEdit(ci), which rebuilds that ONE component's real model
  in place at most once per frame (propeller soup, dashboard, conditionals,
  generated surfaces) + applyJointPoses rides the part's own .ini joint node
  (data.angle DEGREES about the .ini angular axis, data.pos m along the
  linear axis — generalized from Aileron-only to every joints[0].axis type;
  angle-less types like Lamp aim untouched). NO full-scene reload, selection/
  gizmo re-bind after the swap. Pinned by app/e2e/liveedit.spec.ts (panel-
  routed Propeller twist + Aileron angle: liveDataEdit counter, reload
  counter 0, real-model bbox follows the data).
- **Gizmo persistence = SESSION-only (v1.5.1 traps):** NEITHER gizmo setting
  persists. (a) the modebox ⊘ ('off') never survives a load (gizmoMode heals
  to rotate; setGizmoMode only WRITES translate/rotate); (b) the ⚙ row
  `archean-app-gizmo` key is dead — the engine deletes it on attach and
  setGizmoEnabled never writes it, because the VIEW-MODE GATE calls
  setGizmoEnabled(false) and used to poison the user's storage ("closing a
  tab in View = no gizmo ever again", user report 2026-10-20). `gizmoState()`
  / `blockGizmoState()` carry `shown` = helper actually enabled+visible (block
  variant: also attached to the proxy) — pins assert PIXELS, not intent;
  gizmo.spec pins the seeded-poisoned-storage fresh-load-shows guarantee.
- **Block gizmo commits RELOAD the merged hull (v1.5.1 fix):** user: "Rotating
  blocks doesnt update them.." — `onBlockEdit` first did markDirty+bumpRev only,
  so the DATA moved but the merged block MESH kept its old shape (the golden
  overlay + panel rows updated, the solid didn't). It now routes through
  `sceneChanged()` (the same 180 ms debounced reload the BlockPanel's
  `onApplied` uses). Anti-blanket pin: `stats().loads` = load()/reload()
  count — the blockedit BLOCK-widget test polls it STRICTLY INCREASES after an
  accepted shift and after a 90° turn (a refused shift must NOT bump it).
  Engine reload safety: `load()` ends in `select(-1)` → `syncGizmo` →
  `syncBlockGizmo`, so the widget re-attaches + re-centres on the rebuilt
  scene. (The lesson: blueprint-data assertions alone cannot pin a repaint —
  assert through loads/pixels.)
- **Panel flavors + view-lock + BLOCK widget (v1.5 user rules):** (1) ONE
  `✎ Edit | ✚ Place` switch crowns the side panel in BOTH the Edit and Blocks
  modes (testids `tooltab-edit`/`tooltab-place`, hint row `flavor-hint`) —
  the two FLAVORS of the same panel (state `tool`, persisted
  `archean-app-panel-tool`; it REPLACES the old v1.4 compSub/blockTool
  sub-tabs). Edit flavor = click SELECTS (gizmo + inspector + Delete); Place
  flavor = the ghost dockers (block brush + held catalog part — parts can be
  placed in the Blocks workspace too). (2) VIEW is inspect-only: a canvas
  click selects NOTHING (no select/fly/chip), the panel shows ONLY the
  vessel amounts (VesselStats); pinned by panels.spec view-lock phase (probe
  a comp pixel via `pickAt`, click in View ⇒ `sel().ci === -1`, same pixel in
  Edit ⇒ selects) + scene.spec (chip test runs in Edit). (3) SELECTED BLOCKS
  get the gizmo (user: "the gizmo doesnt show when selecting blocks … move
  arrows cell snapped, rotation arrows that move in 90° increments"):
  `Engine.setBlockGizmo(bi, mirror)` re-attaches the SAME TransformControls —
  WORLD space, CELL translation snap + QUARTER-TURN rotation snap ALWAYS; a
  gesture commits as `blockGizmoShift(whole-cell step)` (colliding footprints
  REFUSE, widget snaps back — `cellOverlapSkip` ignores mover + twin) or
  `blockGizmoRotate(axis, n×90°)` (= the panel's rotatedBlock geometry, ⇄
  twin in unison); during drag the golden highlight group rides the widget
  (merged solid catches up at the debounced rebuild); writes flow
  engine→doc through `onBlockEdit` → `writeBlockDoc` (shared with BlockPanel).
  Edit-flavor ONLY, component selection takes the widget back; hook
  `__ARCHEAN__.blockGizmo()`, pinned in blockedit.spec. (4) The side panel's
  expand/collapse is the ▤ button + the ‹/› bookmark tab ONLY — re-clicking
  the active VIEW tile does NOT toggle it anymore (panels.spec shipped-UI
  test); the open-state ‹ tab anchors to the PANEL edge (`md:relative` on
  the aside — it used to anchor to the viewport edge = the "missing
  expand-collapse" report).
- **Constructor-parity block placement (v1.4.0):** BLOCKS-place docks a
  ghost preview on ANY hovered surface — block face, hull-triangle prism,
  component or subgrid content (`Engine.pickCell` returns the world face
  normal + kind; ground stays unfurnishable). The ghost (yellow brush /
  mint ⇧-continuation / red = footprint collides, click refused) is
  `Engine.setPlaceGhost`, re-aimed on hover (~40 Hz cap) and instantly on
  Shift press/release (the game's rule, wiki ConstructorTool §Block Modes:
  "copy the aimed block or logically add the next block"). ⇧ over a block
  swaps the ghost to `complementBlock` (engine/blocks.ts): the aimed block's
  shape+orientation+size+paint, flush across the hit AXIS face or the
  COPLANAR lattice step along a SLANT face (Σ mᵢdᵢ/eᵢ = 0 — unit slope =
  the diagonal cell past the high/low edge). Brush ⟲ cycles the orientation
  family (the game's scroll wheel). THE CELL LATTICE was arbitrated here:
  cell c covers [(c−6)·CELL, (c−5)·CELL) (point→cell floor(p/CELL+6)), the
  ⇄ block twin of [c,c+e) is [12−c−e,12−c) (corpus twin census — the old
  10−c−size, pickCell's −pz mirror and +5.5 floors were pre-v0.180 leftovers,
  FORMAT §blocks). Pinned by vitest blocks.test.ts (continuation coplanarity,
  overlap guard, rotateType, lattice) + app/e2e/blockplace.spec.ts (ghost on
  block + part hover via `__ARCHEAN__.ghost()`, Shift continuation, brush +
  continuation clicks place through the doc mirror).
- **Block EDIT + mirror + snap + component ghost (v1.4):** BLOCKS PLACE/EDIT
  sub-tabs and components-view PLACE/EDIT sub-tabs (v1.5: unified into the
  panel-top Edit|Place flavor switch, see the Panel-flavors bullet; PLACE =
  brush/catalog + ⇄, EDIT = selected-item editor; clicking an existing
  COMPONENT in ANY sub-tab or mode selects it and the inspector offers Delete
  (`comp-delete`, bp splice + doc mirror + orig/applied shift)). A selected
  block gets the golden ENGINE highlight (`engine.setBlockHighlight`, hook
  `__ARCHEAN__.blockHighlight()`) plus a dim one on its SIMILAR TWIN
  (`blockMirrorTwin`: mirrored footprint + same extents + identical-or-
  MIRROR_TYPE shape; while ⇄ is on, shape edits AND deletes propagate to
  it). The inspector of a component selected in blocks mode STACKS ABOVE
  the blocks workspace (`selOverBottom` — v1.4 regression fix: it first
  REPLACED the workspace, which read as "lost the capacity to rotate and
  move components"), and the gizmo + ⊘/✥/⟳/⇄ mode widget are enabled in
  BLOCKS mode as well as Edit (`setGizmoEnabled(mode==='edit'||mode===
  'blocks')`), so a part picked there is immediately movable/rotatable. EDIT shape tools keep the bbox CENTRE frozen: ⟲X/Y/Z
  (`rotateTypeAbout` cloud-table 90° turn + perpendicular footprint
  exchange), ⇄ flip (`flippedBlock` = in-place MIRROR_TYPE), ⟲ cycle
  (`rotateType`) and ✧ snap (`snapBlockType`: 4×4 cross-section agreement
  over the flush neighbours' shared faces, argmax over the table, converged
  at 1.0 else consensus; ties keep the current type — stabilise the
  heuristic later, user 1.4 scope). Catalog parts place like blocks now:
  hovering while holding docks a translucent collider ghost
  (`engine.setCompGhost`, hook `__ARCHEAN__.compGhost()`, ⇄ twin box) and
  `pickPlacePoint` returns RAW file z (its −pz was a pre-v0.180 leftover =
  the "cannot place new components" misfire). VIEW mode's side menu is ONLY
  the collapsable VesselStats (mass & CoM / census / heaviest classes).
  Pinned by vitest blocks.test.ts (4-cycle rotations, in-place centre/
  footprint, twin identity, snap convergence/consensus) +
  app/e2e/blockedit.spec.ts, place.spec.ts (comp ghost + delete),
  mirror.spec.ts, panels.spec.ts (view-stats-only, deck-place EDIT).
- **MERGED EDITOR + wireframe click-through (v2.0 change of shape, user:
  "Merge the block and component edit things, I no longer see a good reason
  to seperate them. The UI is quite good. If wireframe is on (toggle in
  edit) then you click through blocks"): the BLOCKS mode TILE IS GONE —
  modes are now `view | edit | wire | flight | aero`. The old blocks
  workspace is the EDIT panel's bottom (brush + Blocks/Triangles sub-tabs +
  ⇄ row + BlockPanel/TriPanel) beside the parts list; the ✎ Edit | ✚ Place
  flavor drives select-vs-place for BOTH species (component click selects +
  flies + gizmo; block face in EDIT selects the block + BLOCK widget, in
  PLACE docks the brush ghost). All former `mode === 'blocks'` gates became
  `mode === 'edit'`. Panel: a selected SUBGRID now ALSO stacks over the
  workspace bottom (SubPanel was silently swallowed by the blocks section).
  **WIREFRAME CLICK-THROUGH:** with the hull solids hidden (the ⊙ hull⇄wire
  toggle or keyboard h — `!opts.hull`) the block/triangle meshes are NOT
  pickable: pickNdc/pickCell/pickPlacePoint skip them, so you click through
  to the parts/surfaces BEHIND an invisible hull ("click what you SEE").
- **UNIFORM MIRROR RULE + FAUX-MIRROR screen (v1.8 user rules: "It should
  also do whatever I do to the mirror block (mirrored of course)"; "This rule
  is uniform and it also applies to color, material, rotation, and to
  components"): EVERY edit on a SELECTED item ALWAYS drives its mirror twin in
  mirrored unison — BLOCKS (cell shifts via gizmo/panel cx/cy/cz, sizes, shape
  turns ⟲X/Y/Z/cycle/flip/snap, face PAINT via mirrorFaceOrder, MATERIAL,
  delete) AND COMPONENTS (position deltas, MIRROR-TWIN-MOTION rotations,
  palette paint of color1/color2, joint data, delete). NO toggle gates
  propagation: the ⇄ widget button is an INDICATOR (lit = live twin pair,
  struck = none/drifted), `archean-app-plsym` ⇄ gates only twin PLACEMENT of
  NEW brush/catalog ghosts, and the engine's twinPairsFor passes `true` where
  symOn used to gate (symAllowed keeps its arg for the pure pins). Twin
  identification = `blockMirrorTwin` (blocks: mirrored footprint, same
  extents, identical-or-MIRROR_TYPE shape) / the `sym.ts` mask index (parts:
  alignment stays within 5 cm; drift = a broken pair = flagged, not chased).
  **FAUX-MIRROR = flagged, never silent:** a mirror-position partner that
  DIFFERS in a regarded property is flagged — with SEVERITY (v1.8.1 user
  rule: "face paint mismatch should not be a red warning but just
  informational, blue colored, just its popup will do"): a GEOMETRY/GAMEPLAY
  conflict (blocks: shape, size/position, material; components: pair drift)
  renders the twin overlay/box RED (scene warnHl, setBlockHighlight issues)
  + a ⚠ popup; an APPEARANCE-only difference (blocks: per-face paint via
  the mirrored mapping; components: colour1/colour2) is INFORMATIONAL —
  twin overlay/box stays GOLD, only a BLUE ℹ popup notes it (the info flag
  rides blockTwinIssues().info / twinWarnState().info). Popups: the Viewport
  `twin-warn` card; engine `twinWarnState()` text anchored at the twin by
  projection). Pure screens: `blocks.ts blockTwinIssues()` + `sym.ts
  compPaintDiff()` (vitest-pinned); UI pinned by
  app/e2e/mirror-mismatch.spec.ts (@place). v1.8.1 also: dragging a block
  with the BLOCK widget shows the WHOLE hull as wireframe for the gesture's
  duration (showHullWireframe: merged wire on, hull solids off, the user's
  hull/wire choice restored at the commit) — user: "when moving blocks,
  wireframe must be visible for all blocks".

- **v1.7 MATERIALS / appearance split (user rule: "Blocks should let me edit
  material: composite, iron, glass, etc; this is not part of the color picker,
  and it should make it clear glass/metal is appearance"): the blueprint's
  `material` 0..6 (Composite, Concrete, Steel, Aluminium, Glass, Lead,
  Titanium — FORMAT §blocks; game `MaterialProperties.hh` DENSITY per cell
  cube in `engine/tools.ts`) is the block's GAMEPLAY identity (mass, heat,
  build cost). APPEARANCE is palette slots ONLY — no per-material shading
  anywhere (measured: the game's palette carries no material field, the
  `iconRaster.frag.glsl` mat index is editor-icon cosmetics). UI: the
  `MaterialChips` row in the BLOCKS brush (`brush-material-mN`) and the block
  EDIT tab (`block-material-mN` + `block-material-name` + the MATERIAL_HINT
  line); ⇄ on, the similar twin takes the material too (identity edits mirror).
  Writes go through `edit.writeBlockMaterial` (bp + doc; APPENDS the
  `material` key for files that predate it — the game reader defaults a
  missing one to 0) and `edit.writeBlockDoc` now mirrors material too.
- **v1.7 custom RGB:** the swatch docks gained a common `<input type=color>`
  + hex row (`rgb-input`/`rgb-hex`/`rgb-preview`) with two apply paths:
  `+ new slot` writes the picked RGB into the NEXT FREE slot of THIS craft's
  palette (`tools.allocateSlot` skips the engine-reserved 0..10;
  `edit.setPaletteSlot` writes bp + an INT-styled doc node, creating
  `data.colors` via the new `doc.docEnsureArray` when absent) and paints with
  it; `≈ nearest slot` (`tools.nearestSlot`, reserved slots INCLUDED because
  they are paintable, just not redefinable) never grows the palette. A v1
  file's palette is already embedded at open by `normalize`, so both paths
  work on every craft.
- **v1.7 TOOLS menu:** `components/ToolsDialog.tsx` = the framework (a
  `ToolDef` DEFINITION: typed `fields` (select/note, with `optionsFor`
  dependent options and `showIf`), a live `preview(form, bp)` readout that
  DISABLES OK while it says "nothing…", and `run(form, ctx)` mutating bp AND
  doc) + the centered modal that auto-lays those fields out (Esc/backdrop/
  Cancel close, Enter/OK run; `danger` tools arm a confirm on the first OK).
  The registry `TOOLS` currently holds `replace-all` and `hullify`; TopBar's
  Tools ▾ renders the list from it (adding a tool = adding one ToolDef, no
  new UI code). Pinned by `e2e/tools.spec.ts`.
- **v1.7 hullify (blocks ▸ hull triangles) — FACE-EXACT rewrite (v1.5.1,
  user: "it should literally take the coordinates of the edges … the current
  one butchered the geometry of the ISW-241 craft wing shame")** lives in
  `engine/tools.ts` and is PURE. Every emitted triangle IS a block-shape
  face triangle: corners are `blockshapes` face vertices scaled by the
  block's cell corner (`blkCell` coords ARE the triangle lattice g:
  world = (g−6)·CELL) — a square face = 2 triangles, a wedge side = 1.
  NOTHING merges or rasterises any more: the retired planeBasis/
  stitchRects pass approximated slope-profile diagonals into staircase
  rectangles whose compensating errors kept the TOTAL AREA exact (its only
  guard) while ~⅓ of the ISW-241 hull (79 of 187 tris, 27 m²) sat OFF the
  real faces — area equality cannot prove shape (lesson now pinned). The
  ONLY culling is adjacency, sharing cull.ts's interior-wall rules (now
  exported: blkCell/blkSpan/cellM/faceKey/buildFaceGrid/forEachFaceCell/
  faceCovered/faceFootprint/cellQuad): a FULL face is cut cell-by-cell
  against the face grid — a cell whose border is shared precisely and fully
  with a neighbour's face cell (opaque vs opaque only, the translucency
  asymmetry kept) emits NOTHING, a fully free face emits its whole
  block-shape polygon, a partly covered one emits the FREE cells' own quads
  (= "triangles that cover the non-overlapping area"); a PARTIAL
  (slant/profile) face dies when an identical footprint appears twice
  (glued slope-to-slope = interior partition). Block sizes ≤ 15 cells
  (corpus) ⇒ every raw face fits the per-axis 5-bit window (encodeTri
  rejects none; `skipped` is only ever a report). Colours = the OUTSIDE
  face slot, MATERIAL rides along, occupancy type-255 blocks SURVIVE
  (reservations, not geometry); Build-subgrid blocks are NOT rewritten (the
  preview reports them). The tool derives the cull's palette GENERATION
  from the blueprint (`colors == null` ⇒ legacy slots). Invariants
  (`__tests__/tools.test.ts`, corpus-wide): the triangle area EQUALS the
  culled surface area AND **containment** (`straysOf` = 0: every triangle's
  centroid + all three corners lie ON the culled surface in its plane,
  plane-bucketed point-in-tri) — together they pin the union exactly;
  plus the literal-rule pins (glued-cube pair: shared border emits nothing,
  20 face quads' worth of tris; lone wedge: profile planes hold ONE tri
  each, square sides TWO; slant-glued wedge pair behaves like one cube).
  The dialog is a `danger` tool (undoable since 2026-10-20 via the Edit ▸ Undo
  stack). **v1.5.7 DIRECTION option**
(user: "all triangles are precisely the wrong way around … keep it as an
option for their directionality"): the tool's `direction` select sets the
generated winding — `inward` (DEFAULT: the v1↔v2 reversal of the block face's
own winding; the user's in-game check says this is the direction the game
wants, the outward one rendered the "weird beveled" hull) or `outward`
(= the v1.5.6 behaviour, front = the RH cross away from the solid, what the
block-shape table and the corpus census of AUTHORED files read as). Pure pin
(`__tests__/tools.test.ts` DIRECTION test): both directions emit the SAME
triangles/area, normals exactly antiparallel, the lone cube's +x face normal
+x/−x per option. `hullifyApply(bp, { wind })`. **v1.5.9 SHADE option**
(user: "the triangles really different in versus out? … I see the bevel
occurring either way, which as I remember should not happen"): the winding is
NOT the bevel — inward/outward are the SAME closed prism (hull.ts extrudes
along the winding normal, so the two directions swap front/back, never shape;
our viewer renders them IDENTICALLY, and `Triangle.inc.glsl` GetNormal() = the
winding cross only picks the colours[0]-front side). The in-game bevel on EVERY
conversion is the per-triangle FLAT-normal default: the game's 16-byte Triangle
has a `smooth` bit (JSON `smooth` key) — 0 flat, 1 smooth — its own hull saves
set smooth:1 (3732302108: 174/241), so the skin shades continuously; a flat skin
flat-shades every prism face = the bevel. The tool's new `shading` select writes
`smooth:1` on every NEW triangle by DEFAULT (the game's convention; existing
triangles stay verbatim) or, on `flat`, omits the key. The writer spells the
generated record in the game's INT style (`docFromValue(t, false)` — all triangle
numbers bare, never "13.0"). Pins: `__tests__/tools.test.ts` SHADE test (smooth:1
on all, flat none, other fields identical, existing kept); `tooldoc.test.ts`
writer-style pin; `e2e/tools.spec.ts` preview reads "shading smooth:1".
SUPERSEDED v1.5.12: the DEFAULT is now flat + outward (the game's own
freshly-authored triangles, fixture 9000006001 — see the v1.5.12 bullet).
- **v1.5.17 SPHERE SKIN tool — the spheroid RETRY that fixed the dents
  (user: "find online algo … coordinates snapped to a grid that does NOT
  result in indentations. Get the coords, then build a triangle mesh into
  that. For UI extract but do NOT reuse the logic from our branch with the
  failed logic — just its tools-window interface approach and the movable
  ghost logic. Vertices logic MUST be fresh"):** the generator is
  `app/src/engine/latsphere.ts` — a LATTICE CONVEX-HULL SHRINKWRAP, a class
  the failure post-mortem itself named and the online literature documents
  (Quickhull: Barber, Dobkin & Huhdanpaa, ACM TOMS 22(4) 1996; Beneath-Beyond
  horizon cones; CGAL convex_hull_3). Procedure: ① enumerate every lattice
  point whose RADIAL excess over the implicit ellipsoid lies in [0, τ=0.75
  cells] — a thin mirror-symmetric shell sitting just OUTSIDE the ideal
  surface (the test is a function of q² only); ② Quickhull with per-face
  CONFLICT LISTS (a point stays with EVERY face it sees — first-match-only
  assignment LOSES points at redistribution) and horizon = visible-cap edges
  with a SURVIVING neighbour, cone face (u,v,p) keeping the half-edge
  direction; ③ the hull faces ARE the skin — a convex polyhedron is convex
  from EVERY direction, so INDENTATIONS ARE IMPOSSIBLE BY CONSTRUCTION, not
  by hoping a heuristic lands evenly. Measured (vitest `latsphere.test.ts`,
  38 pins — the FIRST suite property is the DEVIATION the post-mortem
  demanded, never the topology): face-plane sag INTO the ideal surface is
  EXACTLY 0 m at every size from r=0.4 m to the 24 m zeppelin, outward
  bulge ≤ τ·CELL ≤ 0.19 m, volume ≥ ideal, closed manifold + outward winding
  + integer vertices + 5-bit windows + determinism + shift round-trip;
  zeppelin plans in 127 ms (the outside-set distribution is O(n log h) — a
  full-scan certificate loop stalls at that size). THE TOOL: TOOLS ▸
  'Sphere skin…' (`sphere-skin`, triangles ONLY) — the placement PLUMBING is
  the archived branch's, ported back VERBATIM per the user's carve-out
  (ToolDef.place stage → movable ghost on the block widget, CELL snap,
  ✕ Cancel / ✔ Build label, Esc twin, `range`/`color` dialog field kinds;
  a skin never collides); the PREVIEW prints the deviation line
  ("dev −0.00/+0.18 m") BEFORE Build; shading default FLAT (the game's
  authored default, v1.5.12), smooth:1 opt-in; paint resolves at commit
  (+ new slot / ≈ nearest); commit = `shiftSkinTris` + the doc-insert idiom
  (one Undo step). Pins: vitest `latsphere.test.ts` + `e2e/sphereskin.spec.ts`
  (@ui: dialog→ghost→label order, shown widget, live sliders, flat/smooth,
  new-slot paint, loads-INCREASE repaint, Ctrl+Z one step, Cancel/Esc).
  **Size reach + the game's REAL triangle law (same session):** the sliders
  go to 48 m and every `range` field carries a NUMBER BOX past the slider
  (user: "people will want larger shapes for larger blimps … Slider+size
  input boxes will do"; `tool-num-<key>`, frames are unbounded integers —
  verified the corpus stores negative ones). The real storage law is
  STRICTER than span ≤ 31: the game's 32-slot vertex window is
  FRAME-ALIGNED (v = g − 12·floor(min/12) ∈ 0..31 — a 29-cell span across a
  misaligned frame border stores NOTHING; `encodeSkinTri` IS the law and
  the audit proved plan ≡ encodable). Two lattice-legal repairs, both pinned:
  ① a CENTRE LADDER (0/+0.5/+0.25/… cells — still exactly mirror-symmetric)
  breaks the exact coplanarity of flat lattice patches that the strict hull
  otherwise triangulates as ONE oversized face (Qhull's coplanar degeneracy:
  coplanar points are NEVER vertices, so adding coplanar support and
  re-hulling is a NO-OP — measured, don't retry it); ② a τ LADDER (0.75→1.5→3
  cells) shortens the long facets of low-curvature flanks (a 30×8×8 m
  ZEPPELIN NOSE needs τ=3: bulge +0.75 m, printed in the preview; sag stays
  0). A residual `skipped > 0` = a surface patch EMPTY of lattice (long
  axes ≥ 12× the short one) — NO convex lattice-exact skin is storable there
  (the game skins those with non-convex staircases, a different feature) —
  and the dialog REFUSES (preview starts 'nothing to place', OK disabled)
  rather than build a silently-holed skin; a micro-SPLIT escape hatch
  (split a bad face at a shell point ≤ 0.5 cells under its plane) exists in
  `repairSplit` for dense-patch alignments (strict-interior points only —
  boundary-collinear points re-split forever, measured). Verified by the
  'the game's triangle limits' vitest group: 216-blend slider sweep (only
  ratio ≥ 12 refuses), the frame law on decoded records, plan≡encode
  equality, and FORMAT-lattice placement — corpus-record agreement: our
  decode matches FORMAT §Triangles `world = (v + 12·f)·0.25 − 1.5` on 60
  authored records of 3732302108, and `shiftSkinTris` lands whole-cell
  world offsets exactly.
  EYEBALL: `node app/tools/sphereshot.mjs <rx> <ry> <rz> <out> [port]`
  builds in the LIVE editor through the real UI and measures the RENDERED
  SILHOUETTE from screenshot pixels (largest blob, scanline-filled area ÷
  its convex hull): 0.99–1.00 at every size — the picture itself has no
  bite. In-game judgment stays the user's (AGENTS: in-game pixels arbitrate).
- **v1.6.1 DOC-MIRROR CLASS FIX — generated records must guarantee their doc
  array (user: "I create a sphere, save it, then load my craft; the sphere is
  gone… in either the editor or game… also inconsistency where I cannot redo
  it"):** the sphere-skin commit, the corner-drafted triangle (Editor) and
  the FIRST wire connection all wrote the live bp and then `docArrayInsert`
  into a list the FILE may never have carried (`data.triangles` / `data.pipes`
  are ABSENT on most real crafts) — `docArrayInsert` fails SILENTLY on a
  missing path, so the saved text (save = `emitDoc(doc)`, and every undo/redo
  snapshot is that same text) NEVER contained the new records: visible in the
  session, gone after reload AND in game, and commitSnapshot's text-dedup
  meant the build not even made an undo step (redo had nothing to restore —
  the reported "cannot redo"). THE RULE now lives in TWO funnels in
  `engine/edit.ts`: `appendTrianglesDoc(ctx, tris)` for FRESHLY GENERATED
  records (sphere-skin commit, corner-drafted triangle — pushes bp AND
  mirrors doc) and `mirrorTrisDoc(ctx, startLen)` for records bp ALREADY
  carries (hullify's run appends to bp inside hullifyApply, so the tool only
  mirrors — routing it through the appending funnel DOUBLED bp vs the doc,
  88 vs 44, and the e2e undo pin caught it; vitest pin now asserts doc = bp
  EXACTLY). `onConnect` ensures `['data','pipes']`. The lesson generalises:
  ANY new write path must end in the DOC, not only in bp — the doc is the
  save AND the history.
  Regression pins (pure vitest, no e2e, `tooldoc.test.ts` "v1.6.1" describe):
  the SHIPPED TOOLS registry runs headless — save of a triangles-less file
  contains the skin and RELOADS through the open funnel, bare-INT/no-smooth
  style, authored triangles stay verbatim-first, the undo/redo snapshot
  sequence is REAL (2 states) and replay restores the skin, `[]` never dirties
  the file, and the bare-pipes-insert pin documents the silent failure it
  guards. Verified discriminating: reverting the fix fails 5 of them.
- **v1.5.24 COORD READOUT v2 (user: "your implementation of letting the
  corner be measured just by raytracing what lands on is excellent … But we
  need full 3d coordinates then, ANd I still need an indicator IN THE GRID
  for the major axis lines to get an understanding for X and Z, + and
  −"):** `coordHoverMove` now RAYTRACES WHAT LANDS ON — `pickCell`'s first
  VISIBLE surface (block/part/sub/ground, wireframe click-through included)
  in raw-file metres, pad-plane fallback off-craft — and the black chip +
  pin read the FULL snapped `x y z` (y = UP law, FORMAT line 30; every coord
  on the visible grid rung). coordGroup draws the pad-corner crosshair PLUS
  a black 3-D cross at the point with a thin connector down to the pad.
  PAD AXIS MARKERS: syncGrid adds the WORLD x = 0 line in RED and the z = 0
  line in BLUE across the full visible span (part of the grid LineSegments,
  same rebuild), with makeAxisLabel black-chip sprites '+x' '−x' '+z' '−z'
  at the ends (rebuilt with the grid, live in groundGroup so g toggles
  them); pin hook `axis()`. Shift-grid and coordLock are GONE. Pins:
  views.spec (chip full x/y/z snapped; hovering the CRAFT raises y — the
  y-UP convention + raytrace proof; axis labels present). v1.5.24 (Z).
- **v1.5.23 COORD READOUT (user 2026-10-22: "a small black label to indicate
  grid position on the corners of the displayed grid under cursor … for a
  ad-hoc vertical grid also black to be visible only when pressing shift,
  that is the most coplanar for our horizontal grid (either x or z) … get
  the full x-y-z of a chosen location … Is x-y the plane that is flat, and Z
  up, or is that Y? please check"):** the CONVENTION IS CHECKED AND PINNED —
  FORMAT §world maths / line 30: **x lateral, y = UP, z longitudinal (nose =
  −z)**; the FLAT plane is x–z (Blender's own UI is z-up, this format is
  NOT); the readout, chips and help all say so, and an e2e pin asserts that
  raising the pointer RAISES y. ENGINE (`coordHoverMove/State/Clear/Shift`):
  ray ∩ PAD plane → snap x/z onto the visible grid rung; on Shift the
  camera-facing vertical plane (normal = x̂ or ẑ by the larger |camera view
  component| — "most coplanar") through that corner yields the third coord
  (all three snapped to the ladder, lines on the WORLD lattice like the
  ground grid). `coordGroup` (scene child, rides moff) draws BLACK marks
  only: pad-corner crosshair, the plane's minor/major grid lines, and a 3-D
  cross at the chosen point; rebuilt only when a snap value changes; syncGrid
  re-snaps a live readout when zoom changes the rung. VIEWPORT: the chip is
  a BLACK div `coord-chip` following the cursor, text set imperatively (no
  React state per pointermove) — `x 3.00  z -2.50`, growing to
  `… y …` on Shift; a window keydown/keyup listener toggles the plane even
  without pointer motion; pointerleave clears. Hooks `coord()`. Pins:
  views.spec @ui (chip visible, snapped to the ladder, no y without Shift,
  full triple with it, THE Y-UP CONVENTION PIN). No new option row — the
  readout is always on while the cursor is over the viewport.
  **THE SHIFT PLANE WAS REMOVED THE SAME DAY (v1.5.24, user: "Just remove
  this shift-grid. I dont want it for now") — after one iteration where it
  also had to be PINNED to the press-corner for measurement ("the other
  grid … should not move against the ground plane, or no measurement is
  possible"); do not resurrect without the user asking.**
- **v1.5.22 MEASURE RULER — REPLACED SAME DAY by the v1.5.23 COORD
  READOUT (user: "that is not what I thought. I thought more like the way
  blender does it"): the ruler, `probeState()/probePointScreen()/
  probeDrag*()`, ⚙ opt-probe and the m key are REMOVED; see v1.5.23.
  Original brief: "The indicator for xyz is
  useless. it must be on the grid, movable and where it snaps on the grid for
  horizontal, I want the coordinate also shown e.g. z 10.0 and a single line
  up and down for z, same segmenting for measuring, eyeballing"):** the
  orientation indicator lives IN THE WORLD on the pad: `Engine` probe state
  {x, z, h} (raw-file coords, group rides moff like ghostGroup) draws ONE
  blue line up-and-down at the snapped spot with tick pairs EVERY ladder
  step, longer every 5th, the pad-level zero tick WHITE (the SAME grid.ts
  segmentation as the ground grid — re-snapped when syncGrid changes the
  rung, pixel7 pin caught the missing re-snap), red +x / green −z base arms,
  a draggable CAP sphere (height, camera-facing vertical plane, snapped to
  the rung) and a white PUCK (horizontal travel on the pad plane, SNAPPED
  ONTO THE GRID LINES), labels via makeLabel in the USER'S z-UP COORDINATE
  LAW: `z 10.0` at the cap, `x 3.0 · y -2.0` under the puck,
  x = file x, y = −file z, decimals follow the rung. Drag plumbing twins
  placeDrag (`probeDragStart/Move/End`, 18 px handle grab, orbit yields;
  Viewport grabs it BEFORE the placement/orbit paths, any mode). Default ON
  (⚙ `opt-probe`, key `m`, ViewOptions.probe); DEFAULT SPOT off the SIDE of
  the build (cx−hx−2) — NOT the centre, which is where editor clicks/pick-
  walks land; position survives scene reloads (probeInit), clamped to the
  pad. Hooks `probe()` (z-up law) + `probePoint('base'|'cap')` (client px
  for the drag pins); e2e views.spec: snap-to-ladder asserts (onLadder),
  puck drag moves+snaps AND the camera stays put (orbit-yield), cap drag
  raises z cleanly.
- **v1.5.21 ORIENTATION & GROUND batch (user 2026-10-22: "We need to see
  directions for XYZ axes, also grid needs to fit build comfortably. Probably
  granularity depending on zoom 1x or 5, 10, depending. Also, mirror axes
  should be settable. Game is not hardcoded x"):**
  (1) AXIS COMPASS — **REPLACED SAME DAY by the v1.5.22 MEASURE RULER**
  (user verdict: "The indicator for xyz is useless. it must be on the
  grid…"): the corner gizmo, `Engine.axisView()/viewAxis()/onView()` and the
  `axis()/viewAxis()` hooks are REMOVED; see the v1.5.22 bullet.
  (2) ADAPTIVE GRID (`engine/grid.ts` pure + `scene syncGrid()`): the fixed
  28 m GridHelper is GONE — the green sheet and grid FIT THE BUILD FOOTPRINT
  (bp box UNION part boxes, rounded out to whole MAJOR cells, majors every 5
  minor lines) and the cell rides zoom on the CELL ladder 0.25*{1,5,10,50,
  100} UNION 0.05 (the user's 1x/5x/10x rhythm; the step flips when one
  minor cell stops projecting >=14 px), lines ride the WORLD lattice
  (k*step — at the finest rung the grid IS the block cell). Rebuilds only on
  step change, inside the frame that renders (no timers); a line-count cap
  BUMPS the step, never holes the coverage. The ground-pin rule (y = lowest
  geometry − 0.05) is UNCHANGED; `gridInfo()` hook `grid()`. Options row
  relabeled "ground grid (zoom-adaptive)".
  (3) SETTABLE MIRROR AXIS (options row `mirror-axis-x|y|z`, localStorage
  `archean-app-mirror-axis`, default x): Engine.mirrorAxis drives the
  twin PLACEMENT (components mirror that coord; block twins via the now
  axis-PARAMETERIZED blocks.ts: per-axis cloud-derived `MIRROR_TYPES[x|y|z]`
  tables, `mirroredBlock/flippedBlock/blockMirrorTwin/blockTwinIssues/
  mirrorFaceOrder/paintTwinPair (…, axis='x')` — every existing x pin stays
  green through the default) and the block-gizmo twin-cell/rotate paths.
  The overlay `buildMirrorPlane` draws ONE sheet per axis of
  `sym.ts craftMirrorMask` = twin-pair masks UNION the GAME's per-component
  `mirrorAxis` field (0=none,1=x,2=y,3=z — the inspector row now offers the
  real 0..3 range, it used to stop at 2). Component PROPAGATION stays
  mask-per-pair (sym.ts, unchanged). Pins: vitest `grid.test.ts` (ladder/
  coverage/cap), `blocks.test.ts` v1.5.21 group (per-axis tables involutive
  + cloud-exact 13->16/14, y/z twins non-vacuous, issues + face-order
  involutive per axis), `sym.test.ts` craftMirrorMask, e2e `views.spec.ts`
  (@ui: compass + camera flights, grid covers the bbox + wheel-zoom step
  change, options-row round-trip). Help topics mirror/display updated.
- **v1.5.20 HELP MANUAL (user: "document other things … add documentation in
  a help menu, with search for words for topics, keep it simple, markdown,
  generate html table, make it a manual so people can learn how to use it
  effectively"):** the manual is PLAIN MARKDOWN in `app/src/help/topics/*.md`
  (13 topics: start, interface, keys, parts, blocks, mirror, subgrids,
  display, tools, hullify, sphere [the algorithm + its game-validity
  limits], lift, wire, save). Conventions: file starts with `# Title` and an
  optional `Tags:` line (extra SEARCH words the prose lacks — 'zeppelin'
  must find the sphere topic); the registry `app/src/help/manual.ts`
  (vite ?raw glob) strips those lines into metadata and scores a query over
  title(8) + tag(4) + body(1×) — EVERY word must match (AND); a search never
  blanks the article, it shows `help-noresults` honestly. Renderer
  `app/src/engine/markdown.ts` is a deliberate ~150-line dependency-free
  md→HTML (headings+slug ids, **bold**/*it*/`code`/https links, lists one
  level deep, fenced code, blockquotes, and PIPE TABLES → real
  `<table class="md-table">` with alignment — "generate html table"; ALL
  input is escaped first, so a topic can never inject markup). UI:
  TopBar `Help ▾ ▸ Manual…` → `components/HelpDialog.tsx` reuses the
  approved tool-dialog chrome (86 dvh cap, draggable title, phone-safe
  bottom zone, tool-scroll) with a search box + topic rail + rendered
  article; the Help menu is prop-gated (`onHelp`) so older callers are
  unaffected. ESC CLOSE LESSON (now pinned in HelpDialog AND retrofitted to
  ToolDialog): a `useEffect(..., [onClose])` window-keydown subscription
  MISSES real presses because the Editor re-renders during scene load and
  the resubscription lands between keydown dispatches — subscribe ONCE with
  a callback ref. Two parser bugs the unit suite caught the hard way (an
  unbounded blockquote/nested-list loop OOM-killed the vitest worker):
  every parser loop MUST advance `i`; `tools/mdcheck.mjs` renders every
  shipped topic directly (node --experimental-strip-types) as the fast
  watchdog. Pins: vitest `__tests__/markdown.test.ts` (escape-safety, table
  alignment, topic-render sweep, search ranking/AND/empty) + e2e
  `help.spec.ts` (@ui, desktop+pixel7: menu→dialog, h1, sphere LIMITS table
  as a real <table>, search by title/tag/body word, Esc/✕/backdrop close,
  dialog never outgrows the viewport).
- **v1.8.3 CABLE CROSS-SECTION TIERS (user 2026-10-23: "Data cables should be
  thinner. And less round, item cables square."):** `pipes.ts KIND_SECTION` —
  the per-kind DISPLAY override, the one place the viewport departs from the
  file's cylinder: `data → { box: true, scale: 0.6 }` (thin square bus, drawn
  half-extent 0.012; the user's earlier "square is fine" for data), every
  other kind unchanged (round; square only under the segment `box` flag —
  the item ducts keep their full 0.08 section). `CableSeg/PipePlug.half` is
  the DRAWN half-extent (bars, elbow spheres and plug collars size from it;
  `radius` stays the file/physical truth); `pipeInfo().style[kind].half`
  exposes it. Pins: `pipes.test.ts` "cross-sections" (data square+thin, item
  full section, lv round) + e2e ISW/truck (square data with `half < 0.015`,
  round+square partition, item half 0.08).
- **v1.8.2 CABLE DIRECTION RULE (user 2026-10-23: "the wire must always
  connect in the right direction ONTO/FROM the connector and the radius of
  the wire is the minimum distance it must continue in the same direction as
  the connector, for it to make sense" — screenshot: a re-seated fluid tube
  stabbing into the junction cap at an angle):** the bar touching a connector
  now runs ALONG the connector's stub axis and continues straight for a LEAD
  of 2× the cable radius (clamped to the first hop) before the route may bend
  (elbow sphere at the bend), and `plugAnchor` (sockets.ts — replaces
  endAnchor) seats a re-anchored tip at least ONE radius off the face, so
  the plug stands visibly ON the grey circle. Measured first (arbitration,
  not taste): over 17 815 FRESH corpus ends the game's first recorded hop
  leaves along the stub axis, median dot +0.97..+1.000 per kind — so for
  fresh files the lead bar is collinear (the rule costs nothing); it bites
  exactly where the cache came loose. GUARD: the lead is laid only while the
  route leaves outward/sideways (dot ≥ −0.25 of the axis) — a stale route
  diving back INTO the part through the socket gets an honest straight
  lead-in, never a folded wire. The surge polyline starts at the plug tip
  and leaves along the axis; flexible chains sag BETWEEN the necks. Audit:
  `checkLeads(net)` (pure) exposed as `__ARCHEAN__.engine.pipeInfo().leads`
  — e2e asserts `bad === 0` on ISW, the truck (incl. its live stale re-seats)
  and after a part move. Pins: `pipes.test.ts` "THE DIRECTION RULE" describe
  (axis leaves/enters, lead = 2r, neck elbows, no-lead-on-dive, surge pts,
  checkLeads) + `sockets.test.ts` plugAnchor group; FORMAT §pipes bullet
  "THE DIRECTION RULE".
- **v1.8.1 CABLES LIKE THE GAME + SOCKET SEATING (user 2026-10-23: "the
  cables for the fluid look quite different in game … the gray circles on
  components that take fluid are the ones that it should connect to … round,
  not square … but for data and small power cables square is fine … (item is
  square indeed)"):** the game's cable truth, transcribed from XenonViewer
  scene.js + a whole-corpus endpoint sweep (18 407 tips, 57 files, tangent
  p95 0.000 m — FORMAT §pipes v1.8.1): ① new pure module `engine/sockets.ts` —
  THE SOCKET LAW: an `.ini [ADAPTER]`'s file-frame socket is
  `position + R(qraw)·(ax, az, −ay)`, stub axis `R(qraw)·(Rz·Ry·Rx·ẑ` same map`;
  every recorded cable tip lies ON that stub axis, so a tip that left it (part
  moved/turned after wiring — 3481322297's Dashboard tip sits 0.40 m LATERAL)
  is a STALE CACHE and `endAnchor` re-seats it on the live socket (fresh ⇔
  ≤0.45 m from socket AND ≤0.15 m off the axis; sane [0,0.135] recorded depth
  rides along, garbage → 0.05 default). ② `pipes.ts` draws what the file says
  (dev port): CYLINDER bars of `pipe.radius` (data/lv 0.02, hv 0.04, fluid
  0.045, item 0.08) — square ONLY under the segment `box` flag (corpus: only
  item ducts set it) — per-segment vertex COLOURS (linear /255, default 128;
  kinds: navy/red/orange/white-chrome/white-metal, older saves near-black),
  metal/chrome → shiny pass, elbow SPHERES at direction changes (the LAST
  segment is stored REVERSED: useful dir `(d+3)%6`), FLEXIBLE 2-segment pairs
  drawn as the game's sagging parabolic chain (segment[0].dir is MEANINGLESS —
  drawing along it is what made wires fly everywhere), black plug COLLARS at
  every end. ③ `Engine.rebuildPipes()` + Editor `pipesSoon` (250 ms debounce on
  `onEdit`): moving a part with the gizmo/sliders makes its cable ends FOLLOW
  the sockets (the game re-routes at save; the display stays plugged in).
  ④ wireops portWorld FIXED from the pre-v0.180 (x,y,−z)-double-mirror to the
  socket law (auto-created cables start at TRUE sockets) + route() writes the
  game's per-kind segment style table. Pins: vitest `sockets.test.ts` (law,
  exemptions PilotSeat/Beacon, corpus sweep), `pipes.test.ts` (shapes/colours/
  elbows/chains/re-anchor + stale counter), e2e `pipes.spec.ts` (ISW round+
  chrome, truck five species incl. square item + live stale re-seats, moved
  part drags its ends ±1.5 m + exact restore); triage `app/tools/worsttangent.mjs`.
- **v1.7.4 LOFT MESH MADE MIRROR-SYMMETRIC (user 2026-10-23: "the
  cylindrical zeppelin seems not fully symmetrical and it has some
  indentations — is that correct? Is that fixable?"):** measured before
  touching anything. Truth: the SILHOUETTE was always mirror-symmetric
  (ring scans/ellipse profiles are exact mirrors; the rendered fill vs
  convex hull is 1.002 at a fair mask threshold — the 0.972 the dev metric
  printed is the MATTE PAINT's sky-coloured rim reflection reading as
  background in the #8fb4d8-sky classifier), and the surface is CONVEX
  (every manifold edge measured: zero concave folds ⇒ no geometric dent
  exists). What WAS asymmetric: two tie-break bugs in the loft. (1) The
  ring-slot monotone WALK broke plateau ties to the LAST maximizer — a
  walk-order choice a mirrored ring resolves to the FIRST, so the two
  sides picked different plateau endpoints. (2) The ≤9-cell chain
  subdivision used Math.round, whose .5 bias is not odd-symmetric, so the
  mirrored chain's interior points were off by a cell. Both fixed:
  ringSlots is now a per-direction argmax over the LATTICE SCAN with a
  mirror-EQUIVARIANT tie chain (distance to the continuous ideal-ellipse
  support point, then the mirror-INVARIANT |u−c|,|v−c| — which lands on
  the plateau MIDPOINT for self-mirror directions), and chainsOf rounds
  exact .5 ties AWAY from the chain midpoint (proved equivariant). The
  scan-argmax also collapsed degenerate coarse modes honestly (a 3×2 m
  section has ≤ 8 natural corners: fine/simple/blocky equalize there —
  the decimation pin now runs on the zeppelin 12 m section where 48/12/8
  really differ 1728/1176/1120). The ring table is cached per profile
  SCALE f (the flanks share f=1 — the argmax runs once per distinct
  section, zeppelin plans stay ~ms). Remaining, provably invisible
  residue: the merged-strip fan DIAGONALS are chiral (every triangulation
  of a quad band is) — they lie in flat plateau chords (coplanar, zero
  crease) or taper quads at sub-cell creases; a pin documents that fan
  corners may sit asymmetrically INSIDE a flat plateau without moving any
  level's extremes. Pins (vitest 'symmetric, dent-free loft mesh'): every
  level's transverse extremes mirror exactly (4 blends incl. asymmetric
  nose/tail + blocky), zero concave fold over EVERY edge, exact vertex
  mirror for small bodies, and the v1.7.3 radial-band/determinism pins
  stay green. If the user still READS dents after this: it is the coarse
  flat-shaded faceting (the simplification trade) — levers are facets,
  the ellipsoid hull body, or smooth:1 for the game's in-engine welding;
  the app itself must NOT weld normals (the v1.5.10 retract stands).
- **v1.7.3 SPHERE NOSE ≠ TAIL + THE FINISH-IN-PAINT CONTROL (user
  2026-10-23: "Nose pointiness isn't high enough; needs a slider as well,
  default should probably be longer. Also, nose and tail are two different
  things imo, the current value is good for tail. Also let me choose whether
  the paint is metallic/matte etc. as per the other controls; ensure that is
  properly integrated into a single control"):** (1) The loft's ends taper
  INDEPENDENTLY: `SphereSpec.noseShoulder/tailShoulder` (nose = the
  −longest-axis end — the aircraft −z nose, aim it with the ghost's ⟲;
  tail = +), each falling back to `shoulder` (so the symmetric v1.7.2 spec
  plans BYTE-IDENTICAL — pinned). `SimpleBody.s → sN/sT`; `bodyRadius`
  picks the shoulder/nose of the ray's OWN side, `profileScale` the end of
  dz's sign, `bodyVolume` the asymmetric π·r1·r2·((sN+sT)L + ⅔(nlN+nlT)),
  the level split and the tip-ring GROW both go per-end. Dialog: `nose %`
  reaches 90 (was 70-capped — "pointiness isn't high enough") and DEFAULTS
  nose 65 / tail 40 ("current value is good for tail"). Preview prints
  `+ N% nose / M% tail`. (2) PAINT IS ONE CONTROL: the tool field kind
  `paint` renders swatch + hex + as-drawn preview tile + FINISH chips +
  the +new/≈nearest choice in ONE row driving form keys color/finish/
  colorhow (the separate 'paint slot' select field is GONE). `PAINT_
  FINISHES` (tools.ts) mirror the game's four palette families' shading
  EXACTLY (palette.ts LEGACY_GROUPS: matte 15/7/0, polished 15/0/0,
  metal 15/0/1, glass 2/0/0 opacity/roughness/metallic); `paletteSlotNode
  (c, shade?)` writes the picked finish onto the NEW slot (no-arg keeps
  the historic 15/4/0 — ColorPanel untouched), `nearestSlot(p, c, shade?)`
  PREFERS slots wearing that finish (same metallic + roughness + the
  opacity<8 glass class), falling back to plain colour distance; commit
  passes it through and the toast/preview name the finish. Pins: vitest
  latsphere 'asymmetric nose/tail' group (4 blends closed/integer/outward/
  skipped-0/apex-per-tip, the radial-band test that the pointed end tapers
  6 where the blunt end stays 8 AND its mirror flip, equal-ends ≡ legacy
  shoulder) + tooldoc 'v1.7.3 paint finishes' (finish spec on the new
  slot via the SHIPPED commit, matte default, nearestSlot finish-over-
  colour, no-finish-key form compat) + e2e sphereskin (paint-finish-*/
  paint-how-* one control, metal rides the committed slot metallic:1/
  roughness:0, nose 90 + tail 15 re-plan still stores, preview regexes).
- **v1.7.2 SPHERE SIMPLIFIED BODY + GHOST ROTATION + BACK BUTTON (user
  2026-10-23: "Geometry for sphere can be too complex… when making sphere
  pointy, I want it to be simplified, so a cylinder on the sides and slightly
  pointier nose might be nice. Add options and a rotation option for the ghost
  preview as well as a back button to go back to tool window where we can
  change parameters without starting from scratch"):** THREE things landed.
  (1) The Sphere tool gains a **body** choice (`sphereForm`→`SphereSpec`): the
  existing ellipsoid hull, or **cyl + nose** — a LOFT (`latsphere.ts planLoft`)
  of integer cross-section RINGS along the LONGEST axis (a `nose %` slider sets
  the tapered fraction ⇒ shoulder = 1−nose/100; a `facets` select picks 48/12/8
  support directions), single lattice APEXes at the tips, merge-walked triangle
  strips. CONVEX by construction (concave ρ(profile)) and every strip edge is
  lattice-subdivided to ≤ 9 cells so EACH face fits the frame-aligned 31-cell
  window BY CONSTRUCTION — pointy/needle blends the ellipsoid hull must REFUSE
  become its SIMPLEST skins (two arbitrated traps: the digital-ellipse
  AXIS-ALIGNED PLATEAU edges ~2√(2r) cells wide break the window TRANSVERSELY,
  which NO axial slicing fixes — hence the ≤9-cell chain subdivision + merge
  strip; and a single-vertex apex cone spans the ring it TOUCHES, so a fitting
  tip ring is GROWN at dz = sL + nl·√(1−(19/r)²) — PRUNING fat rings instead
  ate whole noses to tris=0). Vitest `latsphere.test.ts` "simple body" group:
  closed manifold, integer verts, outward winding, skipped 0, one apex per
  tip, the needle stores where the hull refuses, fewer facets = fewer tris.
  (2) `Engine.clusterGhostRotate(axis)` turns the ghost +90° about a WORLD
  axis through the bbox pivot (the LATTICE only stores exact quarter-turns of
  integer vertices; `transformSkinTris` = shiftSkinTris generalized, frames
  re-floor, colours ride; ghost BLOCKS rotate footprint+type per the panel ⟲
  law). The ghost label gained ⟲x/⟲y/⟲z + ↩ edit and `clusterGhostState()`
  carries `turns`/`bb` for pins; **✔ Build writes the LIVE ghost data**
  (`clusterGhostData()`, quarter-turns included) RE-COLOURED, never a fresh
  un-rotated plan (empty payload ⇒ re-plan fallback keeps headless callers).
  (3) **↩** reopens the dialog with the SAME form (`ToolDialog initialForm`)
  AND the dragged cell offset (`pendingPlaceOffset` re-applied in `onPlaced`).
  ESC/LISTENER LESSON (a real race the e2e caught, worth remembering): React
  18 flushes the dialog's `setToolOpen(null)` SYNCHRONOUSLY between same-phase
  window keydown listeners, so a `toolOpenRef` guard alone read null and the
  viewport's "Esc cancels the placement ghost" twin killed the ghost ↩
  deliberately left waiting — the dialog's Escape is now CAPTURE-phase +
  `stopImmediatePropagation` AND the viewport's Escape branches are
  KEYDOWN-only (the shared keydown/keyup handler let the same keystroke's
  keyup fall through and cancel). `set()` forces `planning=true` synchronously
  so a fast OK can never confirm off the STALE preview line. Pinned by
  `e2e/sphereskin.spec.ts` (⟲ survives Build, needle stores, ↩ keeps
  params+spot, Esc-over-dialog spares the ghost).
- **v1.7.1 THE GAME MASS MODEL (user 2026-10-22: "I put a large x,y=8,z=16
  sphere above, and the weight did not change, but that weights over 1500 KG,
  but provides 5000 KG lift if vacuum"):** the old display model (cellMass
  CALIBRATED so total ≡ declared, components + blocks only) could never move:
  hull triangles (and struts/beams/tank fluids/subgrid content) contributed
  0 kg, and the calibration re-absorbed every edit into the hull, so a
  committed sphere skin of >1 t left the card and the LiftWidget's margin
  EXACTLY as they were. `engine/mass.ts` is now the TS twin of the game's
  server model (`tools/game_data.py compute_mass`, FORMAT §Mass model):
  blocks rect × per-material density (non-cube HALF), skin
  `area·0.05 m ÷ cell³ × density`, struts 1 kg/m, beams 10 kg, parts the .ini
  mass, tank contents fraction × capacity × the crude Chemistry.cpp density —
  and subgrid `Build` content counted RECURSIVELY through `c.data` (the
  nested data is parent-frame ABSOLUTE, so it sums straight in; this is what
  lands the giant at 151 189.5 vs the game's declared 151 195.5 kg).
  `massModel(bp, manifest)` (no cellMass arg — `calibrateCellMass` is
  deleted); `MassModel.families {hull,skin,struts,beams,parts,fluids}` +
  total/com/cells/skinTris/skinAreaM2; `maximumLiquidDensity` ported. Static
  info + VesselStats print computed/Δ-vs-declared + the family line
  (`mass-families`); the CoM marker rides skin/strut/fluid centroids; the
  LiftWidget margin now sinks when you build the envelope. `MATERIAL_DENSITY`
  moved to mass.ts (tools.ts re-exports). Pins: vitest `mass.test.ts` numbers
  are THAT python tool's output (sphere-probe 1131.0 kg skin / 1185.0 total;
  corpus ISW 329.0, dolphin 1619.9 subgrid-aware, gantry skin 55.3 + fluids
  152.9), the corpus pins read the committed testdata + atlas manifest;
  e2e `sphereskin.spec` pins skin 0 → > 0 and total strictly up on Build,
  back to 0 after one Ctrl+Z. NOTE the two tools stay complementary: COST
  (`economy.ts structuralItems`, game `GetBlueprintContents`) charges each
  triangle `max(ceil(cells),1)` ITEMS — its per-triangle minimum inflates a
  3532-tri skin to 6098 blocks vs the 4524 physical cells the MASS model
  weighs; both sides cross-pin against the python reference.
- **v1.7.0 VIEW ▸ BUILD COST (user 2026-10-22: "In the view tab,
  summarize the total cost of all components expressed in raw materials, do a
  complete breakdown per component; e.g. what does the fluidport cost? and
  what do its constituents cost?" — then "it doesnt calculate the cost of
  cables. Figure out how the game calculates that and how much length the
  current cables actually take" and "also calculate triangles and blocks …
  similar breakdown as for components, where it does specify what is
  required"):** the VIEW side panel (VesselStats) gains a collapsible **Build
  cost** row beside the ⚖ Lift row (`components/CostWidget.tsx`): the
  craft-wide RAW-MATERIAL SHOPPING LIST of the WHOLE BUILD on top, then one
  row per component TYPE (`×count`, raw summary), then per species —
  BLOCKS (per block material + cell count), HULL TRIANGLES (per material +
  tris/m²), CABLES (per class + the physical RUN LENGTH and the spool items
  it costs), FRAMES and STRUTS. Each SECTION folds (its header keeps the
  summary line; the fold is persisted in `archean-app-cost-sections`, and a
  folded section still renders its note). Every row OPENS its recipe chain: each
  constituent carries its own raw cost and expands further, so
  "FluidPort = 1 Casing + 1 Connector" and "Casing = 1 000 g Iron" are one
  click apart — the structural rows use the same tree.
  The math is `engine/economy.ts`, a faithful port of the game's
  `GetBlueprintContents` (`tools/game_data.py required_items` — the two are
  cross-pinned): blocks bill their FULL rect `(sx+1)(sy+1)(sz+1)` cells of
  the material's block item (type-255 reservations free), triangles
  `max(ceil(area·0.05 m ÷ 0.25³), 1)` block items, cables `trunc(len·100)`
  PER SEGMENT of the class's spool item (1 unit = 1 cm; the 10 000-unit
  batch = the 100 m spool), frames ONE SteelBeam per LIT `beams` flag of a
  frame record, struts `ceil(len·100)` SteelRod, parts 1 each with SUBGRID
  CONTENT COUNTED (`subgrid` mark) and Build ghosts dropped; a Dashboard is
  billed as its authoring tool (DashboardTool ×1, `via tool`). Unfold is
  game_data's (first CRAFTER recipe per item wins; no recipe = terminal raw,
  or `no recipe` for a catalog part); units are the game's (ores/molecules
  GRAMS shown g/kg/t, parts counts) plus the metres of cable/strut run.
  FORMAT findings this batch fixed in BOTH the TS and the python:
  `data.struts[]` stores `v0_*/v1_*` in METRES from the frame corner
  (legacy files: lattice cells, the dev probe `Number.isInteger(v0_x) &&
  |v0_x| < 32` → ×0.25) — the old `a`/`b` assumption crashed on every strut
  craft; frame records bill per lit beam, not per record; and triangles have
  always been FLAT `v0_x…v2_z` (the old nested `v` read crashed on every
  hull-skin craft). DATA: `viewer/models/economy.json` (23 kB), generated by
  `tools/extract_economy.py` (same `modules/*/config.yaml` tables as
  game_data.py — re-run after a game update; `--check` fails when stale) and
  fetched through `models.atlasJsonPaths()` so it follows the SAME
  layout-exact bases as the model atlas; a missing table hides the body,
  never breaks the panel. Pins: vitest `economy.test.ts` (batch arithmetic,
  cycle guard, raw-vs-`stuck`, nested Builds, the SHIPPED table's FluidPort
  constants, per-segment cable truncation, the triangle ceil/min-1 rule,
  block rect vs type-255, beam flags + modern/legacy struts, and the corpus
  numbers 3732302108 / 3417786605 / 3284539247 / 3803780241 against the
  python reference) + e2e `cost.spec.ts` (@ui desktop: total list, FluidPort
  row ×4 + `subgrid`, 4 kg Iron summary, expansion → Casing/Connector →
  Wire/Plastic; blocks/triangles/cables sections with their cell / m² / run
  length measures and a cable's Wire+Connector chain; every section folds +
  the fold survives a reload; phone: reachable in VIEW and never wider than
  the viewport). Help: `topics/cost.md`.
- **v1.5.18 SMOOTH TOOLS + THE LIFT & ALTITUDE WIDGET (user 2026-10-22:
  "shouldn't block slider if resizing it, delay it's calculation or do it
  background"; "tell us what lift would be if vacuum at sea level, helium or
  hydrogen, make a collapsible widget part of the builder … performance/
  weight limit at altitudes/equilibrium. Archean uses real world data";
  "Fix the tool windows so they don't use 100% of view and that they can
  scroll smoothly down"):**
  (1) `ToolDef.previewAsync` — a HEAVY live readout the dialog runs DEBOUNCED
  (140 ms) and AWAITED OFF-THREAD (`engine/latsphere-async.ts` → a module
  worker running the pure `sphereStats`; request-id correlated, sequence-
  guarded, sync fallback when no Worker). The sphere-skin sliders never
  stall; while pending the footer keeps the last line + 'planning…' and OK
  is DISABLED (`runnable = !planning && …`). The confirm box shows the
  RESOLVED line (e2e reads previews by POLLING now, never a single shot).
  `place.stageAsync` puts the CONFIRM staging on the SAME worker (job kind
  'tris', button reads '… placing') — a zeppelin skin planning seconds on
  the UI thread was the literal "Nothing happens when I press review and
  confirm" freeze. `latsphere-async` DEGRADES, NEVER DEADLOCKS: Worker
  construction try/catch'd (a throw previously left OK disabled forever),
  a 6 s watchdog answers silent requests synchronously (2 misses retire
  the worker), onerror releases every open request.
  (2) `engine/atmo.ts` — the U.S. Standard Atmosphere 1976 layer table
  (barometric formula per layer, real lapse rates; clamps to 84 852 m) +
  ideal-gas buoyancy: lift(V,h) = V·(ρ_air − ρ_gas) for vacuum/helium/
  hydrogen (real molar masses), the equilibrium ("floats at") altitude by
  monotone bisection (sinks/ceiling branches explicit), and
  `envelopeVolume(triangles)` — the closed-skin divergence sum on the EXACT
  FORMAT lattice (hullVertex), winding-agnostic. The SPHERE preview prints
  the volume + lift@SL per gas. THE WIDGET: `components/LiftWidget.tsx`, a
  collapsible ▾/▸ row (persisted `archean-app-lift-open`) inside the builder
  panel AND the VIEW VesselStats (a fresh craft opens in VIEW): envelope
  from the hull skin, per-gas lift@SL / margin / equilibrium, and the
  weight-limit ladder (max floatable total mass at SL/2/5/11/20/32 km;
  engine mass = the same calibrated massReport as StaticInfo). NOTE the
  triangle array MUTATES IN PLACE — useMemo on its REFERENCE is a stale-
  forever trap; key the memo on `rev` (the widget's first bug, caught by
  the pixel7 pin). Pins: vitest `atmo.test.ts` (17: ISA published values
  per layer, handbook SL lifts 1.225/1.056/1.140 kg·m⁻³, solver branches,
  tetra/cube/sphere-skin volumes vs the planner's own) + `e2e/sphereskin.
  spec.ts` (async preview polling + the built-skin widget) + `e2e/tools.
  spec.ts` (dialog ≤95 % of the viewport on desktop AND Pixel 7, `.tool-scroll`
  middle scrolls, footer pinned).
  (3) THE DIALOG WINDOW: capped `max-h-[min(86dvh,100%)]` flex column —
  pinned title bar / smooth-scrolling body (`overflow-y-auto
  overscroll-contain`, `.tool-scroll` slim themed bar, no scroll-chaining) /
  pinned preview+ buttons footer; the confirm box rides the same body.
  **PHONE BOTTOM CLEAR ZONE** (user's Brave screenshot: "impossible to hit
  ok … there MUST be a margin"): mobile Brave floats its action row AND nav
  OVER the web content ~100 px up, so the backdrop reserves
  `pb-[max(.75rem,calc(env(safe-area-inset-bottom)+7.5rem))]` on <768 px
  (md:pb-3 on desktop) — and grid padding alone does NOT clip an auto-sized
  row (measured: the dialog sat INTO the padding): the backdrop is
  `grid-rows-[minmax(0,1fr)]`, which makes the dialog's `100%` cap = the
  padding box. Pinned: dialog bottom ≥48 px above the viewport on Pixel 7.
  (4) ⚖ FIX — a refusal is never a dead end (`ToolDef.fix`,
  `applyAsync`-capable): the sphere tool's NEEDLE message prints the actual
  axes and the button PROBES the worker for the nearest FULLY-storable
  blend (shorten the long axis 0.9…0.2, then thicken the short ones; the
  sphere always stores). WHY probing, not a rule — measured with the
  shipped ladder: (1.5,1.5,12) r=8 OK but (2,2,20) r=10 REFUSED and even
  (19.75,19.75,48) r=2.4 REFUSED (24 faces) while (32,32,48) stores — the
  frame-aligned 31-cell window limit is size-dependent, NO clean ratio
  exists (the old "~12×" claim in v1.5.17's note is hereby FALSIFIED).
  Pinned e2e: refusal → ⚖ → preview resolves to a triangle line + OK
  ENABLES (a probe storm of worker plans, 60 s budget).
- **v1.9 GENERATE BALLOON + TAIL SECTION (user 2026-10-23: "rename it to
generate balloon, add a section to its tool to generate a tail rudder and
two ailerons (not the components) but based on a symmetrically placed
(mirrored) fins … contiguous area … flush with the end of the 'tail'
section of the cone … wired in to a low power couple near the center … a
volume block facing up, guaranteed enclosed … LV cables into the pivots …
after connecting, immediately run into the body … fins scale to the
proportion + extra oversize slider"):** the tool is TOOLS ▸ 'Generate
balloon…' (id `balloon`, was `sphere-skin` — the e2e testids and help topic
followed; the topic's Tags keep 'sphere' findable). Cylinder profile only,
and the fin section must fit the tail zone (≥ 3 m) or the preview refuses.
The pure planner is `app/src/engine/balloonfin.ts`. SHAPE LAW after TWO
user arbitrations (sketches 2026-10-23, colours = spec):
(a) the tail cone STAYS UNTOUCHED — no truncation/post/cap. The first
build truncated the cone at 80 % and closed it with a straight sleeve+cap;
the user's BLUE sketch circle called that "an undesirable break in the
tail's pattern … visually jarring" and it is GONE (pinned: with fins on
`sphereSkinTris(spec)` == the plain plan — balloonfin.test 'the tail cone
is UNTOUCHED'); `SphereSpec.tailCutG` + the `loftZLevels`/`loftRingTable`
exports REMAIN in latsphere (flag-guarded, byte-identical when unset);
(b) ONE STRAIGHT top line (sketch #3: "the moving part should continue
the beginning … that too should be straight … the modest fin would
probably continue horizontal, flush with the top"): the line runs from
the SHOULDER point on the hull, rising aft with a slope that IS the fin
size (finScale 0.25 ⇒ nearly flush), through the hinge line just before
the apex and CONTINUING over the hung fin to its trailing edge — no
curvature anywhere (the earlier rule rode the cone and curved back IN —
wrong for stability surfaces). A FIXED FILLET fills hull→line from
shoulder to hinge; the MOVABLE panel hangs to a horizontal KEEL line
(= the hull-underside level at the shoulder): under the hull its upper
edge FOLLOWS THE UNDERSIDE CONTOUR (the hinge side is contour-following,
"not entirely square"), aft of the hinge it spans keel→the continued
line to a vertical trailing edge; the ailerons are the side-plane twin
(fillet contour→line, panel inner edge a flat stepped plane past the hinge);
`aileronL` mirror-derived from R triangle-for-triangle; regions are
`region(wAxis, …, lo(z), hi(z))` strips subdivided ≤9 cells BOTH ways
(window-safe at oversize 4); SKETCH #4 fixes: the hinge line sits AT THE
APEX (blue — the rudder's full-height part starts BEHIND the cone, its
keel strip follows the last section's contour; the hinge was "barely too
far inward"), and the hung aileron's inner edge is a FLAT plane 2 cells
out from the root, constant aft (red/green — "the movable part strikes
the tail … the radius where the tail goes should not strike the rudders
… rather than a simple out-out … not reach all the way … a bit more
jagged": stepped against the fillet, never touching the cone radius);
the LV dive HOPS 2 cells up the tail first, THEN marches inboard (from a
plug at the closed apex a straight inward march never crosses the hull);
straight-line/keel/contour/flush/gap pins in balloonfin.test.ts;
(c) each panel rides a SmallHinge (default) / SmallPivot as a SUBGRID:
Build record with nested `data.triangles` (parent-absolute, v0.168 law —
the dev readBuild recurses nested triangles, FORMAT §Subgrids) joined via
`composite_builds {component: flatIdx(pivot), slaveBuildId: flatIdx(Build)}`
(flat index = flattenComponents length + append order — new Builds carry no
nested COMPONENTS); scene.ts buildSubgrids renders nested triangles through
buildSolids (same prism buckets as the main skin);
(d) LowVoltageJunction at the envelope centre + `volume blocks` Volume stack
facing UP out of it (first centre +0.187 m, 1-cell pitch, count CLAMPS to
the local envelope); one LV pipe per pivot, coupler→pivot, waypoints
lead(2r stub) → DIVE one cell through the skin → long INSIDE-envelope run
→ port lead (≥2 axis-aligned segments per the game writer rule; every
interior waypoint asserted with `insideBalloon`);
(e) the GHOST carries everything: `PlacePayload.rides` = a lattice probe
tetrahedron the engine quarter-turns WITH the triangles (scene
clusterGhost{Rides,Data}); the commit recovers the turn matrix + cell
offset via `ghostMap` and maps component positions, quaternions (qA ⊗ q,
LEFT compose) and cable waypoints — the triangles themselves come from the
LIVE ghost slice in the staged order SKIN|fillet rud|L|R|panel rud|L|R
(order is the contract between `balloonPayload` and `commitBalloon` —
fillets join the main skin, panels nest into the Builds);
(f) commit = ONE undo step: `appendTrianglesDoc` (skin+fillets) +
newComponent/docArrayInsert components + `docEnsureArray` joins + LV pipes
(the v1.6.1 class rule — everything lands in the DOC = the save = the
history). Pins: vitest `balloonfin.test.ts` (9), `tooldoc.test.ts` v1.9
(shipped-tool save/reload + rotated-ghost map), e2e `sphereskin.spec.ts`
"the TAIL section" (@ui desktop+pixel7). In-game arbitration of triangle
panels on hinges is the USER's (no corpus precedent — flagged in the help
topic + FORMAT).
- **FAILED ATTEMPT — DO NOT RESURRECT blind: the Spheroid generator
  (2026-10-21/22).** (SUCCESSOR SHIPPED ABOVE — v1.5.17.) Three iterations (block-matching → staircase chamfers →
  additive bevels + a watertight triangle SKIN) were all reverted from main:
  **every version showed visible indentations in the hull** — the user's
  final verdict: "All spheres have indents… Triangles instead of blocks",
  then "scrap the entire approach". Root cause (documented in full on branch
  **`failed/spheroid-hull-dents-lattice-quantization`**, `SPHEROID-FAILURE.md`
  there): quantizing a curved hull onto the 0.25 m integer lattice with
  per-position heuristics (corner masks, cuts, nearest/outward vertex snaps)
  always leaves uneven facets = dents; a proper error-diffusing lattice
  quantization algorithm (Bresenham-style, lattice convex-hull wrap,
  sub-lattice marching cubes) was never implemented, and the green test
  suites pinned topology (sealed/watertight/symmetric) — NEVER "no visible
  indentations", which is the actual spec ("indentations damage volume and
  aerodynamics"). If rebuilt: study existing algorithms first, pin hull
  deviation against the ideal surface BEFORE building UI, and judge in the
  real editor / in-game pixels, not our viewer. The reverted code + its
  working placement-ghost plumbing live on that branch.
- **v1.5.16 REVERT of the v1.5.13–15 hull-prism experiments (user ruling
  2026-10-21: "lots of geometry problems now with blocks sticking through,
  indicating it got way worse … undo publication of this version and
  publish last known [good] week working version, even though dashboards
  problematic")**: the three-day experiment line — v1.5.13 hullify
  `avoid:'parts'` (keep-clear, user: "poison"), v1.5.14 backward
  (winding-relative) prism extrusion, v1.5.15 solid-side extrusion with
  shell-parity/block probes — is PUBLISHED NO MORE. The fatal flaw of any
  flush-behind cap: on crafts where authored skin RIDES the block hull
  (ISW-241, airliner, Jimmy), block faces bulge slightly proud of the
  skin plane; the old CENTRED prism (±0.025) enclosed the block face, so
  bulges up to 2.5 cm stayed inside the prism — a flush cap lets them
  stick THROUGH the skin everywhere, far worse than the dashboard problem
  it fixed. main now carries the v1.5.12 tree again (centred prism,
  face-exact hullify, pruneCompRefs wiring fix) under strings v1.5.16;
  the experiment + its pins live on branch `experimental/skin-solid-side`
  (tag v1.5.15 = its tip ancestor). MEASURED FACTS THAT STAND (do not
  re-litigate): the game authors skin EXACTLY coplanar over its
  dashboards (fixture 9000006001; Jimmy murals at offset 0.0000, inward-
  wound) and keeps them visible in game; the game NEVER moves stored
  anchors (byte-diffed re-saves); XenonViewer centres the prism too. The
  OPEN PROBLEM those facts pin: in game BOTH no-poke-through AND flush-
  mount visibility hold, so the game's builder does something BEYOND a
  per-triangle extrusion law (component draw priority / seam handling in
  the compiled builder) — a future attempt must attack the RENDER pass
  (e.g. components never occluded by coplanar skin), NOT the extrusion
  direction, and must keep the prism enclosing block faces where both
  coexist. The centred prism's dashboard burial stays a KNOWN, ACCEPTED
  defect until then (user: "even though dashboards problematic").
- **v1.5.12 HULLIFY DEFAULTS = THE GAME'S OWN AUTHORING + DELETE RENUMBERS
  FLATTENED REFS (user's in-game A/B + the Jimmy wiring incident):** (1) The
  user's craft `Triangle_Trial.json` (in-game-TRI-AUTHORED: the game's own
  tool snapped three triangles onto the very corner block of testframe =
  corpus fixture **9000006001**) looked right in game while OUR hullify
  default of the same craft ("corneronia") read "deformed / melted-burnt
  normals" — and it was generated by US, not the game (user-confirmed). The
  geometry was never the difference: our face-exact corner triangles are
  VERTEX-FOR-VERTEX the game's three faces (flush bottom culled both ways);
  the game authors **OUTWARD winding + NO `smooth` key**, and the game welds
  /adjusts normals where smooth:1 asks it to match neighbours — on a faceted
  block hull that bulges every prism. `HULLIFY_WIND_DEFAULT` is now
  `'outward'` and `HULLIFY_SHADE_DEFAULT` `'flat'` (both options stay; the
  v1.5.7 inward / v1.5.9 smooth:1 defaults are SUPERSEDED — the fixture, not
  a viewer, arbitrates). Pinned by vitest `tools.test.ts` GAME-CONVENTION
  (fixture 9000006001: no key, winding normals away from the corner solid;
  hullify of 9000005001 defaults = flat, outward, the game's 3 vertex sets)
  + flipped DIRECTION/SHADE default pins + `tooldoc.test.ts` writer style +
  `e2e/tools.spec.ts` preview text. (2) **THE JIMMY RULE: deleting a
  component MUST renumber the FLATTENED references.** `data.pipes`
  (a_component/b_component) and `data.composite_builds`
  (component/slaveBuildId) index the FLATTENED component array (nested Build
  content before its Build — §Subgrids). The old `deleteComp` spliced
  `data.components` and left those indices stale (its comment assumed "the
  game prunes them on load" — FALSE: Jimmy's re-save kept all 132 cables and
  31 endpoints landed on components that don't even own the port, e.g. a
  computer's power cable "connected to an aileron" while the cable sits
  elsewhere). New `edit.ts pruneCompRefs(ctx, removedTop)` runs BEFORE the
  splice: references into the deleted subtree (incl. a Build's whole nested
  subtree) DROP with their entries (cables go with their part), later
  references renumber in bp AND doc (int style). Pinned by `edit.test.ts`
  "pruneCompRefs — flattened references follow a delete (Jimmy)".
  Auto-wiring is NOT the culprit and never runs on save — `autoWire` fires
  ONLY from the WirePanel's explicit buttons.
- **v1.5.11 ONE RAW QUATERNION LAW (2026-10-21, user's in-game arbitration):**
  the palette-keyed V2-CONJUGATE display law was a pre-v0.180 mirrored-chain
  artifact — the game places EVERY component (both generations) with the
  STORED quaternion AS-IS. The user's fresh in-game craft `testframe.json`
  (IAS-418: deck + corner pyramid + 8 dashboards drawn onto the faces, loads
  PERFECT in game) rendered with its dashboards skewing through the deck in
  the editor: under the conjugate read no board touches any face; under the
  raw read all eight land EXACTLY flush (|dot| 1.000, the 5-board asterisk +
  deck pair + side board). Landed as: `toViewQuatModern` = identity (raw),
  the four scene.ts gizmo/slider writeback branches collapsed to one law,
  `unityConjugate` retired to an alias; the legacy flag now selects ONLY
  palette resolution. Fixture `testdata/9000005001` (this exact craft) +
  `placement-law.test.ts` (flush pins, raw-vs-conj discrimination,
  open→save verbatim) + `app/tools/flushcheck.mjs <craft>` (live-scene
  FLUSH/FLUSHCHECK audit over the shipped blockshapes table). The wheel
  droop/toggle/junction special cases in `displayQuat` are UNCHANGED (their
  e2e verdicts re-ran green under the raw input). The old "pipes 0.000 m
  under R(q*)" proof is retracted — a whole-corpus re-measure (6309 port
  pairs, full .ini chain composition) lands NEITHER law at 0.06 m and raw
  scores strictly better; the mirror-chain era cannot arbitrate. FORMAT
  §Handedness carries the NORMATIVE ruling.
- **v1.5.10 UNDO KEEPS THE CAMERA** (user: "I really cannot tell the
  difference between various options, but thats also because ctrl-z resets
  view"): undo/redo (`applyHistory` → `setBp`) ran through the Viewport's
  load effect with `load()`'s DEFAULT `keepView=false` — every Ctrl+Z/redo
  RE-FRAMED the camera (all live edits already ride `engine.reload()` =
  keepView TRUE), which made tool-option A/B comparison impossible.
  Viewport gains a `keepView` prop (Editor state set true in applyHistory,
  false in openText — read via a ref so the load effect never re-fires on
  the flag alone); a CRAFT SWAP still re-frames. Pinned by
  `e2e/undo.spec.ts` "Ctrl+Z keeps the camera": orbit-drag the camera
  (>0.5 m, non-vacuous), run replace-all, Ctrl+Z ⇒ camera drift <0.05 m.
  **RETRACTED the same session (user ruling + the ISW-241 wingtip
  artifact):** two renderer "mirrors of the game" landed alongside it —
  (a) cap-normal WELDING for `smooth:1` triangles and (b) SHARED-EDGE WALL
  CULLING (skip a prism's side wall where another triangle shares the
  absolute-lattice edge, read from the struct's `MakeEdge` comment as a
  "flush seam" mechanic). The user ruled the flush-seam adjacency mechanic
  does not exist in the game, and the ISW-241 wingtips showed culling the
  rims is what makes chrome tips read as hollow sails — the rims ARE what
  makes a prism read solid (measured: ISW merged faces 196 → 136 with the
  cull). BOTH reverted in `hull.ts`/`build.ts` (renderer back to drawing
  every prism's full 8 faces) and their pins removed. DO NOT reintroduce
  either mirror from the struct comments alone — the game's seam behaviour
  lives in its compiled builder and is UNDOCUMENTED until an in-game probe
  (a game-re-saved craft byte-diffed) proves it. The `smooth` flag itself
  is REAL data (Triangle.inc.glsl + the 3732302108 census) and hullify's
  `shading` select still writes `smooth:1` into the FILE — that is format,
  not render.
- **v1.5.10 NEW CRAFT = FILE MENU ONLY (user: "new craft should not be a
  button, but only under file. too dangerous"):** the editor toolbar's
  standalone `+ New craft` button is REMOVED (a misfire silently replaced
  the open doc AND reset the undo stack); `File ▸ New craft` is the only
  in-editor path and it CONFIRMS first while the doc is dirty (a new craft
  also wipes the history stack). The gallery's entry (no open doc, nothing
  to lose) stays. Pin: the starter-deck test in `e2e/panels.spec.ts`
  asserts the toolbar button count 0.
- **2026-10-20 UNDO/REDO + DELETE + TRIANGLE PICK + DIALOG UX (user: "ALL
  operations should retain a undo/redo history, and be in edit menu"; "when
  I have something selected in edit mode, [delete] key should delete";
  "Triangles refuse to select properly"; "the window for tools should be
  movable"; "a more understandable OK and Confirm … rather than remaining
  open and not doing anything anymore when clicking OK a second time";
  "Menus dont look good in mobile, they take too much place"):**
  (1) UNDO = the backlog design SHIPPED, but the snapshot is the doc's FULL
  literal text (`emitDoc(doc)` — every mutation path already mirrors bp→doc
  and raw literals keep saves exact), stacked in `Editor.tsx` `histRef`;
  `markDirty`/`sceneChanged` (the two funnels EVERY edit already passes)
  re-arm one 450 ms debounce, so a gizmo/slider DRAG = one entry and separate
  clicks = separate steps; `undo`/`redo` FLUSH the open group first, then
  re-parse the snapshot through the SAME open funnel (parse → normalize
  (idempotent) → makeCtx → setBp), so engine/doc/ctx can never drift;
  `save()` flushes AFTER serializeSave (the occupancy-mirror sync is part of
  the group text); `openText` resets the stack to the opened file. Keys:
  Ctrl/Cmd+Z, Ctrl+Shift+Z, Ctrl+Y — all BEHIND the input guards (a focused
  text field keeps native Ctrl+Z); Edit ▾ `edit-undo`/`edit-redo` carry the
  enabled state (histTick state re-renders, the stack itself is a ref).
  (2) DELETE/Backspace in edit mode deletes the selection with precedence
  component (`deleteComp`, twins included) ▸ triangle ▸ block (+similar twin)
  — every path mutates bp AND doc together (the retired NOTE "a bare key
  must never touch bp without the doc mirror" is obsolete: the key routes
  through the same delete helpers as the panel buttons). (3) TRIANGLE
  SELECTION: `tris.ts triAt()` is a geometric CLICK-OWNER test (hit point
  within 0.08 m of the prism mid-plane AND inside the outline with ≥ 0.06 m
  edge clearance) — the old 0.45 m CENTROID radius could never reach a big
  prism's middle (that was "refuse to select") and a block click near a
  centroid stole the pick; the Triangles subtab now selects ONLY when the
  pick itself is a hull prism (`pickCell` kind 'tri'; triAt ≥ 0), edge/corner
  clicks still draft lattice corners. Feedback: `Engine.setTriHighlight`
  gold prism caps + outline (depthTest off, staled against the LIVE file so
  an undo can't leave a gold ghost); hook `__ARCHEAN__.triHl()`, routing
  probe `triPick(x,y)`. (4) ToolDialog is DRAGGABLE by its title bar
  (`tool-drag`, pointer-captured, clamped INSIDE the backdrop — a dialog
  dragged off a phone is one you cannot finish) and OK opens a CONFIRMATION
  BOX (`tool-confirm-box`) carrying the live preview readout + danger note +
  "take it back with Undo" line; `tool-confirm` runs and CLOSES the dialog
  (result rides the toast; the old second-OK no-op is gone). (5) TopBar
  dropdowns: `max-h-[68dvh] max-w-[min(15rem,80vw)] overflow-y-auto` +
  tighter mobile rows (menus never hang off the screen). Pinned by
  `e2e/undo.spec.ts` (@ui: tool round-trip Ctrl+Z/redo + menu state, Delete
  block + undo, hullify→middle-click SELECT (triHl index)→Delete→undo,
  dialog drag + clamp), vitest `tris.test.ts` (big-prism middle selects;
  corner/off-plane/off-outline miss; nearest of coplanar prisms) + updated
  `e2e/tools.spec.ts` confirm-flow pins.
- **v1.7 declared TODOs, visible in the Edit ▾ menu** (user: "we need a stack
  to be able to undo at least the last 10 operations, for each and every
  thing; make this a todo, visible from the Edit Menu") — SHIPPED in 2026-10-20
  (see the bullet above). The ONLY remaining declared TODO is the
  vessel-info section: `edit-vessel-name|author|code` render DISABLED with
  "todo" hints; planned section edits the file's real top-level `author` +
  `data.alias` fields (byte-safe `docSet` string writes) — a
  license-plate/abbreviation field has NO format backing yet (see Backlog).
- **v1.5.6 ATLAS ROUTES + REAL-MODEL GHOST + SMEAR PLACE + LIVE CATALOG
  ICONS (user 2026-10-20):** (1) "a lot of errors loading the zeppelin model
  on github" = the root-absolute `/models` + `/atlas` candidates in
  `engine/models.ts` BASES (vite-corpus DEV aliases) escape the Pages PROJECT
  prefix (joeppie.github.io/atlas/… 404), so every model + the manifest
  walked 8–16 failed requests before the relative route hit — BASES is now
  layout-exact (`viewer/models`, `../viewer/models` first; the dev server
  already serves `/viewer/models/…` through the retired-viewer route, so the
  FIRST candidate hits in every layout); `geoFor` goes straight through the
  base the manifest resolved through (`atlasBase()`), and the numeric
  `/atlas/<n>.json` adblock-dodge alias is tried only under the dev aliases
  (Pages has no such tree — KNOWN CAVEAT: a filter-list substring on a type
  name still needs an alias tree generated at deploy to fix there). Pinned:
  place.spec "atlas loads with ZERO 404 noise". (2) The held-catalog
  placement ghost is the REAL component model translucent
  (`Engine.setCompGhost` + `thumbs.ts buildAtlasPreview`, the collider box
  stays as the stream-in stand-in and re-issues when the geometry lands;
  `__ARCHEAN__.compGhostReal()`), (3) and a press-drag-release SMEAR drag
  places it: `placeDragStart/Move/End` capture the gesture (orbit OFF during
  it), the ghost rides the crossed surfaces and aims its BACK (+z) along the
  file-plane travel, the RELEASE places (a still click = yaw 0 = old
  behaviour) through `newComponent(type, module, pos, quat)` with
  `qAxisAngle(ŷ,yaw)` mapped to the file generation. Pinned by the
  pure-yaw quat pin in place.spec. (4) The PLACE catalog rows render LIVE 3D
  previews (`PartThumb` + `engine/thumbs.ts`: ONE hidden WebGLRenderer,
  decimated twins via `models.geoLiteFor` — the full twin is dropped at parse
  so the 106-type preload can't retain hundreds of MB; jobs run one-per-idle-
  slice and ONLY for rows scrolled into view — an eager queue starved the
  main thread and broke the blockplace timing pins; tiles are `<img>` —
  catalog `<canvas>`es stole the viewport's "first canvas" identity the
  scene probes use), hovering a tile spins it.
- Toolchain lives ONLY under `app/` (own npm project); repo-root `tools/`,
  `tests/` and the zero-build regtest stay as they are until cutover.
- **PALETTE / color picker (v1.6):** `app/src/components/ColorPanel.tsx` —
  the 256-slot swatch grid (file palette + built-in families, v1 legacy
  remap), every swatch badged with its USE COUNT on the vessel
  (`engine/palette.paletteUsage`: block faces + triangle prism faces + v1
  component slot pairs; v2 custom-dict comps counted separately). Docks:
  the BLOCKS brush + a `BlockPaint` per-face editor in the block EDIT tab,
  the Inspector's Paint section (`CompPaint` snaps a slot's full shading
  spec onto color1/color2), and the canvas mode widget's 🎨 button (the
  paint alternative to ⊘/✥/⟳ — opens a floating palette window for the
  CURRENT selection). ⇄ MIRRORING IS RESPECTED EVERYWHERE a block is
  edited (user: "ensure mirroring is respected … when editing a block"):
  `engine/blocks.mirrorFaceOrder` maps a twin's face slots through the
  WORLD face directions (x is the mirrored axis; slants pair by face
  position), `paintTwinPair` paints self+twin, and the BlockPanel geometry
  rows (cx/cy/cz/size/type) drive the twin's mirrored cell/turn
  (`mirrorGeom`, collision-guarded); `mirroredBlock` now carries the
  DIRECTION-MAPPED paint, not a raw slot copy. Fixes bundled: the golden
  block-selection overlay dedups on a GEOMETRY/PAINT FINGERPRINT now (the
  old {bi,twin}-only guard left a stale gold ghost of a moved block on the
  deck — the "blocks become translucent and don't return" report), a SKY
  click (nothing picked) deselects the block, and the default brush slot
  moved 4→51 (slot 4 is the built-in CLEAR GLASS: the old default placed
  6 %-alpha ghost blocks). Pinned by vitest `facepaint.test.ts` (cube ±x
  swap, involutive slope mapping, twin paint, census counts/skips 255) +
  e2e `paint.spec.ts` (@place: deck badge 35×, face paint ↔ twin, widget 🎨
  block + comp, stale-ghost overlay-centre + sky-deselect).
- app/ obeys the same rules: no hardcoded machine paths (corpus resolves via
  `app/tools/vite-corpus.ts` mirroring tools/config.py), byte-identical saves
  (`app/src/engine/doc.ts` keeps each number's raw literal — the game writer
  distinguishes int-modelled fields, bare, from double-modelled, "1.0"/"1e-08"),
  and never releases without the user asking.
```bash
cd app && npm install          # one-time
npm test                       # vitest — pure engine core (no browser)
npm run test:e2e               # Playwright chromium UI suite (app/e2e/) — FULL
npm run test:e2e:fast          #   … minus the @slow suites (the pricey ones)
npx playwright test --grep '@place|@ui'    # per-area subsets (user rule: an
                               # unrelated change does NOT necessiate a full
                               # run — pick the tags it touches; @slow = the
                               # heavy multi-asset renders: @models (the
                               # solo-fixture content-basis pair-checks),
                               # @gizmo, @sym, @subgrid, @aero; tags live in
                               # the describe titles of app/e2e/*.spec.ts)
npx playwright test --grep '@Aileron'  # PER-COMPONENT pins (user rule
                               # 2026-10-19): a test that pins ONE component
                               # rendering correctly is a standing guarantee —
                               # it must NEVER break unless the change's
                               # EXPECTED outcome was altering that render;
                               # but running all components' pins for one
                               # component's change is overkill. So each
                               # solo-fixture test carries @<ComponentName>
                               # (@ActiveRadiator @Aileron @TrashCan
                               # @ToggleButton @Propeller): run the tag(s)
                               # you touched; re-run ALL of @models (or the
                               # full suite / solo-pair ritual) only when a
                               # SHARED render pipeline file changed (basis
                               # C, unityBake/bakeGeo, models.ts loader,
                               # buildReal/standInBox, scene fan-out).
npm run dev -- --host 0.0.0.0  # NEVER loopback-only (dev-server binding rule):
                               # browse via the Tailscale IP (tailscale ip -4):
                               # http://<ip>:5175/  — loopback still answers there
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

`vX.Y.Z` (the pre-rule tags v1.0 … v1.3 were 2-part; read them as `X.Y.0`).
Bump the smallest component that describes the work — **do NOT spend a `Y` on
a fix** (the rule was written after v1.2 = a z-flip bugfix and v1.3 = a
settings/✕ tweak both consumed `Y` bumps):

- **X — major**: an overhaul or a change of shape. A UI overhaul, a framework
  step (the React app replacing the legacy viewer = v1.0), an entire scope
  change (the app becoming the Pages site root).

  **X bumps require the user's EXPLICIT instruction (user rule 2026-10-20:
  "You do NOT have authority to increase full versions. you MUST get explicit
  instruction for that").** An agent NEVER cuts itself onto a new major on
  judgement — even for a genuine change of shape (the merged editor was
  labelled v2.0.0 unilaterally and the user overruled it back onto the v1.5
  line: everything since the last TAG is ONE release, numbered by the user).
  When unsure, ship a Z; use Y for a user-visible feature; X only when the
  user says "make it vX.0" in those terms.
- **Y — minor**: a new FEATURE/capability the user can point at — the subgrid
  hinge UI, a new editor mode, a new analysis, a new panel/tool surface.
- **Z — patch**: FIXES and small tweaks — a wrong pivot or mis-framed camera
  (that was v1.2-sized = a Z job), a control moved, wording, a threshold,
  a tool added, docs. If it only makes an existing thing correct or nicer,
  it is a Z.

Multiple stacked changes still take ONE bump: the version describes the
RELEASE, not the commits inside it (v1.3 = one tweak; had it carried a fix AND
a feature, it would be the feature's `Y`, still a single tag).

Enforcement: `tools/release.sh` refuses a 2-part string on a new cut, refuses a
version strictly BACKWARD of the newest tag on origin (EQUAL stays legal — it
is the suite-re-run path), and prints
`semver bump: v1.3 → v1.3.1 (patch …)` so a fix-onto-Y misfire is visible at
the moment of the cut. `tools/security-scan.py --versions` keeps all nine
context-anchored strings in lockstep. The bump itself still happens at SESSION
START (the v0.161 rule below): onto the next **Z (patch) the agent bumps
AUTONOMOUSLY — it is expected, not permitted-with-apology** — but a **Y
(new user-facing FEATURE) or X (overhaul) needs the user's explicit OK: the
agent SUGGESTS the number ("this batch includes <feature> — suggest
vX.Y.0, OK?") and until the user assents, the tree carries the next Z, never
a self-chosen Y/X** (user 2026-10-20: "You are allowed and SHOULD bump patch
versions unless you get an OK for a new release/functionality (you can
suggest that!). but no user-unacknowledged bumps").

## Publishing (GitHub Pages — release-branch + generated `pages` scheme)
The live site is `https://joeppie.github.io/archean-blueprint-tools/` —
**the React Inspector app IS the site root** (craft gallery + editor); the
retired legacy inspector lives at `/viewer/index.html` behind a small link
at the end of the app gallery. **Pages serves the GENERATED `pages` branch
(source: pages / root); `git push origin main` never moves the live site,
and the `release` branch is the STABLE line the `pages` site is built
from.**
- `main` = development. Commits pass the pre-commit gate (selftest+regtest);
  Pages ignores main entirely — an in-progress main can never wear the stable
  build's clothes (branch-level fix of the 2026-10-09 "dev snapshot under the
  pushed label" failure mode).
- `release` = stable, **ff-only**. A release is an EXACT main commit that
  passed the COMPLETE suite (`tests/run_tests.sh`: selftest + regtest +
  proxy + comp + ui + gizmo + position fixtures + renders), fast-forwarded
  onto release and stamped with an annotated tag `vX.Y.Z` (SEMVER — see
  § Versioning; the `v1.0` milestone 2026-10-19 replaced the old `v0.NN`
  line, whose 2-part successors v1.0…v1.3 stay as they are). Hotfixes go through
  main and re-release — release is never rebased or cherry-picked onto.
- `pages` = the PUBLIC artifact, since the v1.0 app deploy: an orphan
  snapshot of the release tree where **the vite-built app IS the site ROOT**
  (2026-10-19 user rule: the new app is the front door; the retired legacy
  viewer keeps `/viewer/index.html` and is reachable only through a SMALL
  link at the END of the app gallery — pinned by app.spec's legacy-link
  test), plus an `/app/index.html` redirect stub for old deep links.
  FORCE-PUSHED by **`tools/deploy_pages.py`** (pure build inside a
  detached worktree of origin/release with its own npm ci; the compiled
  gallery catalog pins ARCHEAN_BLUEPRINTS to the repo testdata so a
  machine-local Steam corpus can never leak into the public bundle). It is
  NEVER hand-edited; its history is disposable; release is the truth.
  The app's data routes are page-relative and LAYOUT-EXACT (`testdata/…`,
  `viewer/models…` at the root; `../testdata/…` + `../viewer/models…` and
  the CardPreview `../` flip are deeper-copy fallbacks; the legacy link is
  root-exact because `../` would ESCAPE the Pages prefix; vite `base './'`),
  so the repo URL path is never hardcoded.
- The ritual is **`tools/release.sh [vX.Y.Z]`**: preflight (clean tree on main,
  main pushed, release strings agree via `security-scan --versions`, the string
  is 3-part SEMVER and moves FORWARD past the newest remote tag (the bump kind
  major/minor/patch is printed), tag free,
  origin/release an ancestor of main) → COMPLETE suite (a FAIL aborts — the
  release branch is never touched) → ff `release` to HEAD → annotated tag +
  push → best-effort GitHub Release with commit-range notes (needs an authed
  gh CLI; absence only skips the notes page). THEN the public site moves only
  when **`tools/deploy_pages.py`** runs (builds the app from the release ref
  and force-pushes `pages`; the Pages rebuild is an Actions job: during
  GitHub Actions runner incidents it typically queues "waiting for a hosted
  runner" — check githubstatus.com before suspecting the push).
- **A new release requires the user's EXPLICIT say-so** (2026-10-17 rule).
  Never run `tools/release.sh` — or otherwise move/tag/push `release` — on
  your own initiative: finishing work, a green suite, a commit, or a push to
  main do NOT imply a release. The stable line only ever moves when the user
  asks for it in those terms ("release it", "cut the release", "ship it").
  Full-suite RUNS for verification are still fine and encouraged — only the
  release CUT is gated on the user.
- `release` is branch-PROTECTED (done 2026-10-17): classic protection on
  (force-push/delete blocked for non-admins; admins bypass, which is what
  `release.sh` uses for its ff push). If a push to release is ever refused
  as a force push, someone rebased the branch — recover with
  `git push origin $(git rev-parse main):release` after reconciling via main.
- One-time setup (done 2026-10-17): Pages source flipped to release via
  `echo '{"source":{"branch":"release","path":"/"}}' | gh api -X PUT
  repos/Joeppie/archean-blueprint-tools/pages --input -` (branch-source mode
  is called `legacy` in the API — sending build_type "branch" 422s);
  verify with `gh api repos/Joeppie/archean-blueprint-tools/pages` (or the
  Settings → Pages page when the gh CLI is unavailable).
  v1.0 (done 2026-10-19): source flipped to the GENERATED `pages` branch the
  same way (`{"source":{"branch":"pages","path":"/"}}`). ROLLBACK of the app
  deploy = flip it back to `release` (the pure-static site keeps working
  either way; `pages` is rebuilt from release by `tools/deploy_pages.py`).
(README viewer link is versioned; bump the version in index.html title/header,
landing page and README together when the viewer changes). v0.161 rule +
§ Versioning for WHAT to bump:
**bump the version strings at SESSION START, not at release** — the dev
server (:8650) serves the working tree, so an in-progress tree must carry
the NEXT version label; a dev snapshot wearing the last release's string is
indistinguishable from a pushed one (2026-10-09 user report). `release.sh`
refuses to cut a tag when the strings disagree.
**2026-10-20 BUMP POLICY (user's wording, refines both the v0.161 ritual and
the same-day first correction): "You are allowed and SHOULD bump patch
versions unless you get an OK (you can suggest that!) for a new
release/functionality. but no user-unackowledged bumps."** Concretely:
- **PATCH (Z) — agent-owned, DO IT:** session start (v0.161 dev-label rule)
  and any fix landing bumps the strings to the next Z without asking;
  announce it in the commit message. A never-asked patch is policy-compliant.
- **MINOR/MAJOR (Y/X) — user-owned: SUGGEST, then WAIT.** A batch that adds
  user-facing functionality (or an overhaul) gets a PROPOSAL — "suggest
  vX.Y.0, OK?" — and only after the user assents may the strings carry it;
  until then the tree keeps the next Z. The same-day v1.5.7 → v1.9.0 edit
  was reverted NOT because bumping was forbidden but because it was a
  Y-sized jump the user never acknowledged (and an invented number line).
- The X/Y/Z SEMVER guidance below describes how to NUMBER a release; the
  authority to apply it is split exactly as above.

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
  the old 0.000 m proof cannot hold in the file frame. `toViewQuatModern` /
  `toViewQuatLegacy` are the same identity; `fileToViewQuat(q, legacy)`
  keeps its signature (the legacy flag still keys PALETTE resolution).
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
  the bbox — never render it as geometry.
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

## Known open issues (v0.146 state)
- **CHIRALITY: RESOLVED — DE-MIRRORED v0.180 (2026-10-19).** The viewer/app
  now render the game's own view (raw positions, standard RH camera, V2 q* /
  V1 raw q); the z-mirror chain, its text pre-mirrors and the matrix mask
  compensation are retired. Normative write-up + landing notes:
  FORMAT §"Chirality vs in-game truth" (mirror-proof pins: selftest
  `dashtext`/`orienttext`/`liver`). Chirality claims must still cite
  in-game pixels, never a viewer's.
- **v0.143/v0.145 were REVERTED** (user-confirmed regressions on Pages: beacon mast +
  aileron real models rotated wrong). v0.144 (IBL) was re-landed as the PMREM commit.
  RESOLVED 2026-10-19 IN APP ONLY, final form: the engine content basis C=(x,z,−y)
  over C⁻¹-baked atlas verts (uniform, XenonViewer-arbitrated — FORMAT §Component
  VERTEX SPACE; solo-pair routine tools/make_solo_test.py + app/tools/solopair.mjs +
  tools/solo_verify.py). The LEGACY viewer still draws the old raw-chain look (its
  Oct-6 pin numbers were derived there); porting C there needs the user's call +
  those pins re-derived.
- Beacon "point forward" display convention (user): parked — blocked on an asymmetric
  probe craft (180°-quaternion z-sign ambiguity, see FORMAT.md).

## Invariants that tests enforce (keep them green)
1. `?selftest`: edit→serialize round-trip preserves bytes except intended fields;
   occupancy + type-255 mirror stay synced after position edits; the ISW beacon
   mast must point nose-ward (nose = raw −z = view space, v0.180; pins the
   Unity handedness fix); the
   ISW front caster wheel must hang below its pivot (suspension droop, display-only),
   the FluidJunction outlet (its local +z) must face +y with the inlet toward
   −y (flat builder-cache display pose = the RAW file quat R(q), v0.180 —
   the cables are authored in that frame; see FORMAT.md), the ISW front aileron
   (saved `data.angle` in DEGREES = −4.609°) must droop a few degrees below its
   hinge (view tip y ≈ −0.08; the joint limit is ±45°),
   raycast picking must work through the mirrored component transforms; the
   v1 built-in palette must resolve WITHOUT a file palette (slot 48 = matte
   dark green, slot 53 cyan; v1 comp colours are slot-index
    pairs); the real Beacon model must carry the emissive red lens the game
    draws procedurally (user: "beacon no longer looks like a beacon");
     dashboard canvas text is RAW on the board's +z face (`dashtext=true`: a
     left-aligned label lands on the canvas LEFT half; `orienttext=true`:
     the orient fixture's plate rebuilt through the shipped chain has its
     text face at local +z with an un-mirrored canvas — the game authors
     text readable from the plate's +normal side and the v0.180 display
     frame IS the file frame, so NO pre-mirrors remain; the old
     dashmirror/textx counter-mirror pair was a property of the removed
     world mirror — FORMAT §Chirality), plus the mirror-proof `liver=true`
     gate (airliner 3309955432 livery plate raster reads U-N-I-T-E-D from
     the file −x side, screen-right = +z; fails loudly as DETINUD under any
     mirror).
     legacy (no-palette) files must use RAW quaternions: the mosaic
     dashboard-mural plate normal must be parallel to its fitted wall plane
     (`mural=true`; conj quaternions tilt it ~45° out of the wall).
     the green ground plane + grid must sit just under the lowest rendered
     geometry — nothing of a craft renders below ground, ever (the
     3481322297 "Classic American Semi Truck" builds down to y=−1.5;
     `ground=true`).
     selecting a component must fire cable power-surges: one travelling
     pulse per connected pipe (data.pipes graph), the far component blips
     on arrival; pulses/blips/selection glow render additive with
     depthTest off — visible THROUGH the hull (`surges=true`).
     the windsock HUD is a camera child and its tail aims along flowDir()
     in camera space (`sock=true`, dot > 0.93 after an explicit updateWindHud);
     hull solids and wireframe are mutually exclusive checkboxes (`excl=true`);
     the wind particle budget tiers with scene cost, normal crafts full 4000
     (v0.156 "more wind particles, from further away": spawn box inflated
     4 m, kill margin 9 m; `windpts=true`); canvas picking = deliberate
     press only (`click=true`),
     and a subgrid hit on its VISIBLE content CLOSER than any component
     routes the click to the subgrid info panel (v0.153; v0.169 re-scoped:
     the invisible collider proxy groups of NESTED parts — flagged
     !visible when their real model loads, box mesh inside stays visible —
     count as WORLD-INVISIBLE (parent-chain walk) and only route when the
     ray hit NO component, so a part you look at never loses to a box you
     cannot see; pinned in the dolphin postest, ISW has no subgrids);
     streamlines are UNDISTURBED upstream of the body mid-plane (`inflow=true`)
     while the wake deficit behind it slows the flow >25% (`wake=true`);
     pitching the PilotSeat must NOT steer/slow the wind (heading-only,
     `seatpitch=true`); display anchoring is a no-op on frame-(0,0,0) crafts
     like ISW (`anchor=true`). The rotate gizmo (Blender-style rings,
     v0.151) drags INTRINSIC (space='local'): each drag spins the axis
     the ring is CURRENTLY DRAWN along, so pitch-then-roll composes exactly
     as seen (user WYSIWYG rule); scene-root proxy, writeback qv = P verbatim
     (v0.180: the old P·Ry(π) decompose-compensation existed only for the
     removed scale.z=−1 mirror root). `gizmo=
     true` pins the writeback round-trip; `?gizmatest` (synthetic single-
     seat blueprint, camera facing the pilot, n=19 + &shot=1|2|3|4 visual
     states) pins the order algebra, the LIVE pose, and v0.156 KNOB
     CONTINUITY (`gizmoUnwrap`): TransformControls reports ring drags as a
     raw atan2 angle, so a knob sweep past 180° POPS back toward the start
     (user report) — the objectChange writeback unwraps per-event wrapped
     deltas into a continuous spin, both directions. Rings are thickened
     annuli at full opacity — v0.160: r169 builds them as HAIRLINE
     TorusGeometry (the v0.156 RingGeometry filter never matched), so the
     FAT tube instead of TGC's yellow flash (gizmostyle pin). v0.161 REVERT
     of v0.160's overreach: the swap thickened the REST state too (user: "a
     gizmo to rotate the gizmo and its always thick") — rings KEEP TGC's
     geometry at rest; ONLY the hovered/active ring fattens. v0.162 root
     cause of the residual "the WRONG axis rotater becomes yellow and thick,
     KEEP THE COLOR": TransformControls' highlight writes the MATERIAL of
     the raycast-hit mesh, and the pick meshes (helper's unnamed children;
     shared matInvisible at opacity 0.15 — NOT 0 as assumed) share one
     material across all axes, so a hover flashed every pick torus yellow
     at opacity 1 — fat yellow ghosts, positioned by the RAYCAST pick (at
     ring crossings the nearest torus is a different ring's visual). fix:
     styleGizmo restores _color/_opacity over the WHOLE helper subtree
     every rendered frame (paintHighlights) and fat-swaps only the active
     axis's VISIBLE rings (thickable = opacity ≥ 0.2; fattening the 0.15
     pick toruses would shrink the raycast area); NO opacity forcing — the
     active ring's colours stay theirs. The gizmostyle pin simulates TGC's
     exact shared-material write and asserts the restore. v0.163 FULL
     ROOT CAUSE (user: "the WRONG axis rotater becomes yellow and thick
     KEEP THE COLOR … large yellow circle, dont know which angle … then I
     select it is in a different spot"): (a) the trackball PICK torus
     (r 0.75 tube 0.1) is the nearest raycast hit for every screen point
     within 0.85 of the gizmo → EVERY ring hover set axis='E' → the yellow
     E ring blazed at opacity 1 + fattened, the intended rings never did;
     the restore ran in paintHighlights BEFORE the render, but Transform-
     Controls re-applies its flash inside the GIZMO'S OWN updateMatrixWorld
     (every rendered frame) — so styleGizmo is CHAINED onto the gizmo's
     updateMatrixWorld (original first, restore+fat-swap after, in the same
     pass, before anything draws). (b) the axis-less visible trackball
     rings E (yellow 25%) + XYZE (grey) are hidden (trackHide, material-
     guarded on opacity ≥ 0.2 so matInvisible's lazy _opacity cache is not
     poisoned). (c) the ring PICKERS (r0.5 tube0.1 → band 0.40..0.60) sit
     OUTSIDE the visible rings (r 0.40 = the band's grazing inner edge):
     reshaped to hug them (r 0.42 tube 0.07) so the fat ring lands ON the
     hovered ring ("does not show up where the actual one is"); E pick
     shrunk to a 0.16 sphere (trackball = centre drag only). (d) the gizmo
     ATTACHES AT THE PART'S VISIBLE CENTRE (bbox centre — the anchor of
     the mode widget/selection box/click; _gizOff centre→origin subtracted
     in applyGizmoPosition; v0.167: the quaternion writeback is NOT
     pivot-agnostic — a gizmo spin ORBITS the gizmo centre, p' = c +
     R(dq)·(p−c), c = bbox centre of the VISIBLE geometry (proxy ∪ real
     siblings, gizmoCentre; captured once per gesture at mouseDown) so
     off-origin real geometry (beacon mast, MiniComputer 3 m off) spins
     IN PLACE at the rings instead of lever-swings about the file origin
     (user: "the pivot locations dont seem to be properly positioned,
     causing parts to rotate/orbit around the wrong position"); mirror
     twins orbit their OWN centres (symRotPiv, captured at the same
     mouseDown — the mirrored self-centre IS the twin centre); sliders
     keep the game's pivot semantics (orientation about the part origin,
     no orbit); v0.170: subgrids have NO gizmo at all — they ride their
     masters' joints). The
     gizmohover pin drives the REAL pointer path (synthetic canvas
     pointermove): ring hover picks its own ring (axis='Z'), TGC's RAW
     update flashes yellow, the SHIPPED chain clears it in-frame, the
     aimed ring fattens, E/XYZE stay hidden, proxy at centre. v0.164 (user:
     "they dont light up for the entire thing; make the thicker selected
     version match location of the normal handles"): EVERY visible handle
     mesh of EVERY mode (arrow shafts/tips, drag planes, centre octahedron,
     scale cubes, rings) gets a fat variant ⇒ the fattened hover state
     covers the WHOLE handle. v0.165 ROOT CAUSE of "the thicker selection
     handle for rotation STILL DOES NOT MATCH": r169's setupGizmo BAKES
     every per-mesh position/rotation/scale INTO the geometry, and
     updateGizmoResolution zeroes the PICKER meshes' rotations every frame
     — the three raw-torus ring pickers collapse into ONE coincident
     XY-plane torus, so TGC's first-surface picker raycast answers a
     DIFFERENT axis than the ring under the cursor, and raw-reconstructed
     fat handles land at the raw canonical pose (arrows h/2 low, rings in
     a neighbour plane). Fixes: fat variants CLONE-and-fatten the BAKED
     geometry IN PLACE (toruses scale the tube in its own plane about the
     ring CIRCLE — fanning about a semicircle's bbox centre shifts it;
     cylinders radial about the longest bbox axis; boxes/octahedra uniform
     about centre); hover picking replaces the picker raycast with
     ringPickerRaycast = a true ray↔ring-CIRCLE distance on the VISIBLE
     semicircle (RING_PLANE baked-plane basis, camera-side wins at
     crossings, scale-aware since TGC rescales handles per frame); the
     XYZE trackball PICK shrinks to E's 0.16 so ring hovers pick rings.
     styleGizmo fattens the active axis's meshes across the translate/
     rotate/scale groups (gizmofat pin: fat-vs-thin bbox CENTRES coincide
     + strictly fatter on every 'X' translate mesh, restores at rest);
     gizmohover aims via rayRingVis.Z.localToWorld (a proxy-local r0.5
     aim lands at 1.9× the shrunken ring TGC rescales per frame).
     The selection is boxed by a FAT 3.5px GOLDEN LineSegments2 outline,
     EXPANDED 0.07 m off the part, PULSING with the x-ray glow (outline=
     true: 12 segments on select, hidden on none; Box3Helper's 1px lines
     vanished on HiDPI — user "selection should be more clear"; v0.157
     "bigger highlight"; v0.160 gold + slimmer "slightly less thick"). Connectors
     (adapter nubs) default HIDDEN on their own View-Options toggle
     (conndef=true), pipes/cables keep theirs. The v0.153 MODE
     WIDGET: a canvas click on a part pops ⊘/✥/⟳/ℹ TIED TO THE PART
     (v0.156: projected bbox centre, re-projected every rendered frame
     while open — no/move/rotate/info; last choice persists,
     `archean-gizmo-mode`; v0.157: enlarged, v0.160: 26 px buttons
     "2-3 times bigger for better ux");
     v0.161 FIFTH BUTTON ⇄ = mirror-move switch (persisted `archean-sym`):
     twin propagation is ON only while symOn AND the selected part's pair is
     still mirrored — twins are filtered by symAllowed() at PRE-MOVE file
     positions in ALL position writebacks: both gizmo paths AND the
     inspector position sliders (livePos, v0.162 user: "mirror is not
     respected; I edited one wheel, it didnt do the other" — sliders were
     the manual path by design, the user corrected that: every position
     edit mirrors while the pair is aligned; computing the filter after the
     self-write makes every move drift its own pair and self-disable —
     caught by the XYQ pin). A pair a builder moved apart by >5 cm
     AUTO-DISABLES; the button shows the effective state with a
     strikethrough (CSS .off), so the user can also purposely disable.
     v0.164 CO-SELECTION (user: "I dont see the mirror-component being
     identified and co-selected"): while ⇄ is live and the pair aligned,
     the TWINS glow with the selection (shared pulsing x-ray overlay,
     rebuildSelXray; twinKey staleness ⇒ ⇄ flips/drifts repaint) and the
     first twin gets its own golden box (selBox2, synced in
     paintHighlights) — component twins AND subgrid (Build) twins alike
     (selectSub path included); twin SUBGRID groups also ride the mirrored
     delta in 3D (v0.172: their twin masters move, and syncSubJoints'
     rigid master-delta term rides the twin groups — the old symPropagate
     base writes are REMOVED, they would DOUBLE-move; before v0.164 twin
     Builds moved in the file only). Pins:
     ISW symselect, XYQ symselect-sub.
     v0.166 MASK GENERALISATION + RED-AXIS FIX (user: "rotate two wheels
     that are symmetry linked, all axes behave correctly, exact the one
     that is red. If I move my wheel back, the mirrored wheel moves
     forward. Can you define robust logic … x, y or z symmetry?"): pairs
     are indexed with a MIRROR MASK (symMaskAt: every axis mirrored
     |a+b|≈0 & off-plane ∈ mask, every other axis must be equal; x/y/z,
     two-axis twists and point symmetry all compose; on-plane axes are
     EQUAL — the centreline rule per axis). Drift auto-disable = the live
     5 cm mask must EQUAL the indexed mask. Position deltas flip the mask
     axes; rotation deltas take the MIRROR-TWIN MOTION conjugation: the
     spin component along a mirror NORMAL is PRESERVED (both wheels roll
     backwards together), tangential spins flip (a steered pair yaws
     mirror-symmetrically) — md = det(S)·S·dq. v0.165 SHIPPED THE FULL
     quaternion conjugate (w,−x,−y,−z) — flipping the mirror-normal
     component too: exactly the red-axis wheel bug; its pins only tested
     ŷ/ẑ, so x̂ was never asserted (now: ISW symrot-x SmallWheel pair
     Rx(+0.2)→Rx(+0.2), uitest symrot pitch
     phase — all sign-sensitive). The mirror-plane overlay draws one
     plane per mirror axis present (twin masks ∪ mirrorAxis parts); the
     y-plane arrow pair straddles UPWARD so the down-tip lands ON the
     plane (selftest ground=true scans mirrorGroup).
     move = translate gizmo on the same proxy, writeback lands the proxy
     position DIRECTLY in file coords (v0.180: view == file frame; the old
     mirror involution / view z-flip is gone) minus the compGroup display
     anchor, occ +
     type-255 mirror cells follow via serialize()'s round(delta/CELL) shift
     exactly like the position sliders — the gizmo never touches blueprint
     math. Shift snaps 15° AND 0.25 m cells. v0.158: SPACE IS PER-MODE —
     translate = WORLD (the arrows stay axis-aligned; user: "the move
     gizmo rotates and becomes non axis aligned, thats bad"), rotate =
     LOCAL rings (the pinned intrinsic model). movecfg pin asserts the
     space flip toggles with the mode. v0.170: THE GIZMO IS COMPONENT-ONLY
     — the v0.159/v0.168 subgrid gizmo (proxy riding the subgrid's content
     centre, local-space arrows, joint-inverse writeback + subSpin spin
     about the content centre) is REMOVED (user: "i can select and move or
     rotate a subgrid. that is WRONG"): subgrids are INFO-SELECT ONLY and
     move kinematically via their masters' joints.
     Pins: gizmatest movespace (MEASURED
     widget nodes: translate arrows proxy-INVARIANT, rings proxy-FOLLOWING)
     + dolphin subwidget (component select attaches gizmo + widget;
     subgrid select detaches + hides). The explode/assembly
     feature (v0.140/141) was
     REMOVED in v0.142 (user: "a catastrophe") — do not resurrect.
     thrust display + wind model: every DIRECTIONAL propulsor (THRUST
     table = .ini TARGET axes; Propeller double-headed + excluded from
     the net) feeds a normalized net-thrust vector, while the
     directionless RCS blob (5-way in the game, nothing stored in the
     file) renders/counts as a tail-ward push along −cockpit heading
     ONLY when it is the sole propulsion class — ISW net+main pin to
     view (0,0,−1), never the old straight-down TARGET-axis arrow
     (`thrust=true`); sealStats (blocks+occup+hatch blocks+triangle
     raster on cell = pos+12f−5.5, z-view) flood+ray-enclosure seals
     BionicDolphin's cabin (>100 cells) while ISW stays wind-swept;
     sampleVel is zero inside sealed cells (`seal=true cabin=…`). The
     selection is an incandescent X-ray overlay (shared-geometry meshes,
     matrix-synced every rendered frame so it tracks live edits), GOLDEN
     and PULSING (v0.160: x-ray opacity, emissive intensity and outline
     breathe together; the on-demand loop wakes only while a selection
     lives). Camera
     fly-in is MANUAL-only: canvas click, component-list double-click
     (never list single-click, ?sel= deep links, or selftest).
2. `regtest`: every testdata blueprint parses; blocks/components within bbox
   margins; the hull lattice map (when triangles exist) puts every vertex
   inside the bbox.
2b. `?comptest`: connector-alignment sweep over ISW-241 — every `data.pipes`
   endpoint (the game's own record of its port positions) must have an adapter
   nub ≤0.06 m, a cable tube ≤0.06 m, and the owning component's model surface
   ≤0.35 m. 60/60 PASS, PilotSeat (editor-moved) + Beacon (connector-frame
   endpoint quirk) exempt from the model check. Catches: tube chaining (pipes are
   NOT straight chains — anchor every segment at its own `start`), component
   pose/orientation, nub placement.
2c-b. `?uitest` (v0.147): headless UI sweep — drives EVERY panel control
   through its real handler (checkboxes, buttons, sliders, ⟲ resets) plus the
   paths state-pins miss: filter, LIST TABS (listtabs: by type / by subgrid,
   v0.156 — every flat part listed in both tabs, one search filters both,
   the pick persists), COLLAPSIBLE GROUPS (listcollapse: v0.157 groups start
   collapsed, header toggles; listclick also pins that a row-click AUTO-
   EXPANDS the containing group = the reveal path), list-click select,
   keyboard g/o/h (which
   must move groups AND stay synced with their checkboxes; h = blocks +
   triangles together), preset buttons (must actually MOVE the part — the
   row.set()/onInput dead-button bug), comp.data write-through, real-model
   toggle + localStorage persistence, wind-mode/flow-src/CoM/thrust buttons,
   hull-opacity slider (fades blocks + skin + wire together),
   hull-list flash row, Steam wslink, dirty→Save
   lifecycle, calibrated-mass report, ⟲ RE-PAINT pin (invalSeq), component-
   level ⟲ pin (compreset: proxy + real siblings move, repaints, and writes a
   PLAIN numeric file quaternion — spreading a THREE.Quaternion copies its
   _x/_y accessor BACKING = NaN quats at the next rebuild), rotate-gizmo
   attach/toggle pins, mode-widget pins (modebox: a synthetic canvas click
   pops the widget at the part, ⊘/✥/⟳ buttons drive tctl mode + attach state
   + localStorage; movemode: proxy drag writes comp.position RAW, moves mesh
   AND real siblings, undo through the same path; symwidget: the ⇄ button
   toggles twin propagation + persisted strikethrough state; symslider:
   inspector x-slider edits propagate the mirrored delta to the twin and
   the reverse edit restores the pair, v0.162; symrot: the inspector
   YAW slider (ŷ spin — spins TANGENTIAL to the mirror plane flip; the
   component along the mirror normal x̂ is PRESERVED) spins the twin
   aileron MESH by the MIRRORED delta Ry(−15°) (sign-sensitive) and the
   reverse edit restores the pair; v0.166 adds the PITCH phase (x̂ = the
   mirror normal: the twin takes Rx(+15°) PRESERVED — the red-axis wheel
   bug, slider-side), v0.165); pivotreal (v0.167, user: "the pivot
   locations dont seem to be properly positioned, causing parts to
   rotate/orbit around the wrong position"): real models ON, real Beacon
   geometry loaded (off-origin > 0.15 m asserted), a gizmo spin about
   x̂ keeps the part origin at a CONSTANT distance from the visible
   geometry's centre (proxy ∪ real bbox = the gizmo pivot) with the
   file position following, and the counter-spin restores exactly.
   Title: `UITEST PASS n=<pins> ctrls=N`
   (n counts ok() live, nothing hardcoded) /
   `UITEST FAIL <pins>`, captured errors in #out.
2c-c. `?gizmatest` (v0.151): rotate-gizmo ROTATION-ORDER suite on a
   synthetic single-PilotSeat blueprint, camera focused in front of the seat
   (user-suggested isolation). Asserts the PURE gizmoSpinRing/gizmoSpinEye
   contract (UI-free algebra: ring drag = intrinsic spin about the ring's
   drawn axis; trackball = eye-axis extrinsic; pitch90→roll90 order matters
   and uses the MOVED axis) + the shipped config (rotate/local) + the LIVE
   writeback through applyGizmoOrientation (file decode, mesh pose, ring
   tracking, visible nose swing) + v0.153 move-mode pins (movecfg: the mode
   switch toggles tctl translate↔rotate and persists; moveinv: the
   position writeback is the raw/mirror involution). v0.159 MOVESPACE pin
   MEASURES the rendered widget nodes: swinging the proxy 40° about z must
   move the translate ARROWS 0° (world space) and the rotate RINGS exactly
   40° (local space) — the empirical proof of the per-mode space split.
   `&shot=1|2|3|4` leaves
   the scene at
   before/+pitch90/+pitch90+roll90/RING-HOVER-FAT for headless eyeball
   (runner saves gizmo1..4.png; shot 4 aims the real pointer path at the
   visible Z ring and leaves it fattened — the v0.165 WYSIWYG proof that
   the fat ring COINCIDES with the thin one). Title: `GIZMATEST PASS n=19`.
2c. `?postest`: placement fixtures keyed per craft (the POSTESTS table in
   view3d.js — the sanctioned exception to "no per-craft constants": fixtures
   probe the RENDERED scene where generic checks cannot see a pose bug).
   ISW-241 + RCS-infinity (3518436870) FluidJunction rows: comb flat
   (world bbox y ≤ 0.40 m), one-height row at file y, cable endpoints on the
   −y side, ports ≤ 0.20 m of the model bbox (cable tips sit on visible
   sockets = 0.14 m off the proxy box). Guards the convention-independent
   junction display pose (v0.180: the RAW file quat R(q) for BOTH
   generations, never derived from the mapped view quat). Giant (3509975859) AERO-GRID pins (only
   grid-path craft, 1024 plates): grid ON, the 3×3×3 query is a SUPERSET of
   the influencing plates at 250 golden-ratio box points, freestream
   upstream, wake deficit >0.25 anchored on the first inserted solid cells
   (bbox-face probes fly through its sparse skin). Craft without fixtures
   report POSTEST SKIP.
   A GENERIC btn-* suite runs on every postest craft: ToggleButton renders
   exactly ONE lever (state picks axle/switch vs axle2/switch2), the lever
   centre matches the .ini derivation pivot+qV·mirror(Rz(0|−π)·Rx(18°)·
   (0,−0.16,−0.018)) within 0.07 m, and single-sided buttons show no base2.
   Catches state-ghost stacking (dolphin door buttons) in both rotations.
   v0.146: lever/plate expectations include the game's mount bake (local
   yaw-180, plate front on the mount face pilot-side — raw file quat leaves
   the plate 0.68 m behind the pivot = dolphin/Cede gap defect).
   v0.153 dolphin (3417786605) SUBGRID fixtures: one THREE.Group per Build
   subgrid (userData.sub), a ray from OUTSIDE the craft toward a door must
   route to the SUBGRID (front priority — the hull behind it loses; v0.169:
   the pin now also drives the SHIPPED pickRay routing — a world-visible
   first hit must reach the subgrid),
   selectSub opens the info panel (Contents + Mount rows — v0.173: the
   Pivot offset/rotation slider rows REMOVED, user: "should not be a
   separate interface"; sub-info pins their ABSENCE) showing the
   DECODED master (sub-masters pin: v0.171 flattened join — the dolphin's
   5 subgrids pair 1:1 with 3 SmallPivots + 2 SmallHinges: Build[22]/[12]/
   [6]←pivot, Build[4]/[27]←hinge),
   `subjoint-angle` spins that pivot's master to
   90°: the group must rotate EXACTLY 90° about the decoded axle axis
   (sign-sensitive dot>0.9999), swing about the CAPTURED joint line, and
   return; v0.173 doorpivot: the hinge-driven fin's joint line must be
   clamped onto its panel bbox (pivot0 on the panel plane at the bottom
   edge y, axle0 0.25 m inboard — "collapsing outward or inward, rotating
   around the bottom"), and v0.175-177 pins the fin's axis = world ẑ (the
   face-mount swivel axis pin×span: the fin deploys out to its own side,
   the axle key's ŷ maps to x̂ at that mount quat = the "rolls in and
   out" drawbridge, the v0.174 longest-dim ŷ yaw = "opens like a door,
   incorrectly" — "one of the doors opens correctly, like a hatch folding
   down, but the other opens like a door"); the TWIN Build[27] must roll
   on ẑ with the MIRROR-OPPOSITE sign (equal angles = symmetric twin
   deploy); flukeaxis: the fluke panel's
   axis = x̂ (its longest dimension, elevon deflection); gantry railaxis:
   the panel LinearTrack slides along its length; XYQ xyq-dooraxis:
   edge-mounted hinge doors keep the ±ŷ long-edge yaw (the face-mount
   branch must not fire on them);
   v0.172 subfollow: translating the hinge master +0.5 m in x and
   spinning it +30° about view ŷ must ride the subgrid group rigidly in
   UNISON (pure +x ride; constant origin-distance orbit with the sign
   of the cross product pinned; exact restore on both), because the
   master-pose delta composes on top of the joint chain).
   v0.176 subtwin-angle: a joint-angle edit on the Build[4] hinge master
   must propagate the same +90° delta to the Build[27] TWIN master
   (symAllowed pair) and swing BOTH subgrid groups +90° about their OWN
   captured axis (the twin fins are built asymmetric — skin-fin roll ẑ
   vs deep-fin yaw ŷ — equal angles are the mirror-symmetric fold),
   exact restore of data + poses.
   v0.169 subgrid-UX pins: `sublist` (the by-subgrid tab lists EVERY
   subgrid as its own SUBGRID row — blocks-only ones included; the old
   nested filter returned component OBJECTS that then indexed the array
   (buildList THREW, the tab died at the first subgrid with nested parts)
   — and the row click selects the subgrid); `subwidget` (v0.170 INVERTED:
   component select attaches the gizmo + an open widget stays anchored to
   the part, subgrid select DETACHES the gizmo and HIDES the widget — the
   v0.169 re-anchor is gone with the subgrid gizmo); `subglow` (subgrid
   selection glows
   the WHOLE content tree via selPairs and gets the golden outline box —
   compare the box geometry's EXTENT centre: a start-points-only mean is
   corner-unbalanced; re-paint after updateMatrixWorld, matrixWorld may be
   stale between pins); `compglow` (v0.170: the REAL game models of a
   selected component get the x-ray glow too — a selPairs overlay must
   live under the realMap roots of the selection, not only the proxy
   boxes, so real-model paints highlight the part's true shape). Generic
   `comp-pick` (every postest craft): a ray
   through an invisible nested-proxy group (world-invisible) must NOT route
   to its subgrid when a component is hit behind it (the gantry's nested
   SpotLight/Dashboard proxies prove the non-vacuous path); a VISIBLE
   subgrid block in front of the component (the giant's decks) keeps the
   subgrid win.
   XYQ-615 (3803780241) decodes Build[41]/Build[5] ← a SmallHinge pair at
   24.3° (v0.171 flattened master decode);
   its Build[5]/[41] ±0.635 TWIN SUBGRID PAIR proves symselect-sub (twins
   co-select + glow; dolphin's symmove pin keeps the COMPONENT twin
   propagation for SmallHinge masters, sign-sensitive in x — the subgrid
   gizmo drag pins were REMOVED with the feature in v0.170).
   v0.165 `symrot` (ISW): spinning the
   selected aileron via the gizmo writeback path (view Rz(+0.2)) must spin
   the twin's MESH by the MIRRORED delta Rz(−0.2) (sign-sensitive: spins
   tangential to the mirror plane flip) and follow its FILE quaternion,
   exact restore. ISW v0.166 `symrot-x`: rolling
   the SmallWheel pair (x=±3.125) about the red axis, self Rx(+0.2) ⇒
   twin Rx(+0.2) — same direction, sign-sensitive (user: "move my wheel
   back, the mirrored wheel moves forward"); its v0.167 phase captures
   the mouseDown pivots (self gizmo centre, twin its own centre) and
   pins the twin's orbit: constant twin-origin distance to its centre
   plus exact restore. dolphin `mirrorplane`: the striped
   sheet + frame + ⇄ arrows build on a symmetric craft, REST on the ground
   plane, and the View-Options checkbox toggles it — selftest ground=true
   now ALSO scans mirrorGroup ("nothing renders below ground" covers
   overlays; v0.160-era WIP plane pierced it, suite was blind).
   v0.157 gantry (3732302108) `subjoint-pos`: the LinearTrack-mastered
   subgrid slides +0.25 m along its decoded axle axis, and returns.
   Dev-shot hooks leave final states for headless screenshots: uitest
   `&wbshot` (mode widget + move gizmo on a part), postest `&subshot`
   (subgrid panel open, camera flown to the master part — v0.170: no
   widget on subgrids).
3. `fitHull` must stay **generic**: zero per-craft constants. The exact lattice
   (W=12, pitch=CELL, C=−FRAME/2) passes on all 24 corpus files, not just ISW-241.

## Conventions
- view3d.js is one flat file with `// ---------- sections ----------`; follow it.
- UI = DevTools-style rows built by `row()`; new tunables get sliders, not prompts.
- Component list (v0.156 tabs, v0.157 collapsible): two tabs (`#ltabs`,
  persisted `archean-list-tab`) — `by type` (alphabetical sections) and
  `by subgrid` (one section per Build: its own SUBGRID row (v0.169 — the
  subgrids are mostly BLOCKS, a parts-only listing made them invisible and
  unselectable) + decoded masters + indented nested rows whose click =
  selectSub; then 'Hull & parts (no subgrid)'), ONE
  search (`#filter`, position unchanged) filters both; rows carry the `.i`
  index badge, section headers are `.sec` (count spans must NOT use class
  `i` — uitest counts rows by it). Rows live inside a `.grp` container per
  section; groups are COLLAPSED by default (chevron on the header toggles;
  `listOpen` map keyed `tab|section`), a non-empty filter force-opens, and
  `select()`/`selectSub()` pass `{reveal:true}` which opens the containing
  group and scrolls the row into view (nested rows carry `data-b` = their
  Build index for the subgrid-tab reveal). The nose/tail/up nudge presets
  were REMOVED (user: meaningless — sliders + gizmo cover nudging); the
  PilotSeat lean presets stay (seatpreset pin).
- `row().set()` MUST repaint (it calls `invalidate()`): programmatic
  `.value` assignment fires no 'input' event, and the global input→invalidate
  listener is what keeps sliders live — without it ⟲/presets moved the UI but
  froze the picture (v0.149 user report).
- `markDirty()` MUST repaint (it calls `invalidate()`): BUTTON handlers mutate
  data too but fire no 'input' event, so the global input→invalidate listener
  cannot cover them — v0.152: "⟲ reset this component" updated data+sliders
  while the 3D view sat still (its real-model siblings + nubs must be synced
  there as well, mirroring livePos/liveRot).
- Keep headless testability: no top-level awaits on user input, report results in
  `document.title` / `#out` for `--dump-dom`. The suites live in
  `viewer/tests.js` (v0.169) and reach the core through `window.HARCHEAN`
  (accessor object of live getters/setters, exported at the bottom of
  view3d.js) — a global handle on purpose: tests.js is loaded by a dynamic
  import in index.html, so a static `import` with the release `?v=` specifier
  would be a SECOND app instance on one DOM (the v0.169 lesson: the split
  'worked' — every suite bound to the invisible twin).

## Backlog
- **WIRE-mode claims vs physical truth (user 2026-10-20, Jimmy incident):**
  the root cause of the scrambled wiring — deletes leaving STALE flattened
  pipe/join indices — is FIXED (v1.5.12 `pruneCompRefs`, see the app bullet;
  auto-wire never runs on save, it is WirePanel-button-only). REMAINING todo:
  files ALREADY mangled by an older build (e.g. `jimminey.json`: 31 pipe
  endpoints referencing components that do not own the named port) are not
  auto-repaired — the WIRE census will keep reporting the broken claims as
  real connections. Worth adding: a wire "integrity" check that flags a pipe
  whose endpoint component does not own the port name, or whose physical
  cable tip sits > ~1 m from every port of the referenced component (the
  game's visible sockets legitimately sit ≈0.5 m off the `[ADAPTER]`
  position — FORMAT §pipes — so the threshold is per-kind, not zero); plus
  a repair action ("re-drop this cable onto the components its ends touch").
- **Undo stack: DONE (2026-10-20).** Shipped as the doc-text snapshot
  stack with time-windowed drag coalescing (see the 2026-10-20 bullet above) —
  deeper than the requested ≥10 levels (the stack is unbounded per session)
  and it covers EVERYTHING that flows through the `markDirty`/`sceneChanged`
  funnels, which is every mutation path in the app. The originally-planned
  deep-clone-of-`{doc,bp,orig,applied}` form was superseded: `emitDoc(doc)`
  already carries the complete edit state (doc mirrors are mandatory on
  every write) and re-opening a snapshot re-derives `orig`/`applied`
  exactly like a fresh load.
- **Vessel information editor (user 2026-10-20, v1.7 TODO, Edit ▾ menu):**
  author, name and the abbreviation/"license-plate" code. Real format fields
  exist for two of them — top-level `author` and `data.alias` (the app's
  title already reads `data.alias`) — so the first step is a small labelled
  form writing both through `docSet` (string writes keep byte-identity for
  untouched keys) plus the gallery title. The abbreviation/plate has NO
  format backing anywhere in the corpus (`grep` finds no name/code field
  beyond `author`/`alias`) — either it IS `alias` (the workshop title) or it
  needs a new key + the game's tolerance verified before we ship one.
- **Slider discipline (user 2026-10-20, v1.6 TODO):** component `data` rows
  must respect INTEGER-valued fields and sensible min/max (the DataRows Row
  today gives every number `min=v−10, max=v+10, step=0.1` — the game's own
  `modules/*/config.yaml` ranges are the source), with LOGICAL slider
  increments per field; the block cx/cy/cz rows and component position rows
  should move in FIXED increments — the cell lattice is 0.25 m (blocks are
  whole cells, so the ±/slider step is 1 cell = 0.25 m — the user guessed
  "0.5 or 0.25"; it is 0.25), and keyboard ±/arrows nudge by exactly one
  increment. Decide per-field steps from the game data, not one global 0.1.
- **Component sub-parts placed on the engine content basis — RESOLVED IN APP
  (2026-10-19, XenonViewer-arbitrated):** the dev viewer (user-confirmed = the
  game) places EVERY component as C·chain·C⁻¹·v, C(file→content)=(x,z,−y) —
  uniform, no per-asset table (the earlier collider "census" split was a basis
  artifact: colliders live in the baked-FILE frame; FORMAT §Component VERTEX
  SPACE). app implements it as basis group C + raw .ini chain + `unityBake`
  (C⁻¹) atlas verts (scene.ts buildReal / models.ts bakeGeo); pinned by vitest
  `asset-space.test.ts` + e2e `asset-space.spec.ts` (solo-fixture spans) + the
  solo-pair ritual (make_solo_test.py → solopair.mjs → solo_verify.py, re-run
  after game updates). STILL OPEN: legacy viewer/Pages keeps the old raw-chain
  look (port needs the user's call + its Oct-6 pins re-derived).
- **Propeller data-generated geometry: DONE 2026-10-19 (app).** The game
  client generates the prop surface from `data.blades/radius/width/twist/
  pitch` (dev `propellerGeometry` mirrors it); `app/src/engine/propeller.ts`
  transcribes it and `scene.ts` swaps it in for the frozen gltf template's
  `prop` node. Pinned by vitest `propeller.test.ts` + e2e `propeller.spec.ts`
  (rest 4-blade r1.2 disc; deflected twist/pitch spread the surface
  OUT OF PLANE beyond the rest twin, radius span equal on both). The viewer/
  still draws the static gltf template.
- **Ring-drag rotation continuity: DONE 2026-10-19 (app).** The REAL-pointer
  multi-grip sweep is pinned in app/e2e/gizmo.spec.ts: Engine.ringScreenPoint
  computes a grab point on the DRAWN ring from the CURRENT proxy pose + TGC's
  own handle scale, so grip 2 aims where the ring ACTUALLY IS after grip 1 —
  re-grip still picks axis 'Y' (the handle plane follows the live pose), each
  grip keeps spinning in the same direction from wherever the part is, the
  per-event file-quaternion steps never pop (<0.6 rad), and the saved quat
  stays unit-normalised (folded equivalent pose, no multi-rotation noise).
  TGC's local ring is displacement-cumulative from press (no atan2 wrap);
  mouseDown rebases the gesture (captureGesture) exactly like the legacy
  knobQ0 contract.
- **Git attribution: DONE 2026-10-10 (v0.165).** Repo identity is
  `Joeppie <3845457+Joeppie@users.noreply.github.com>` (GitHub noreply:
  links to the account without publishing the real mailbox); all 98
  historic commits + both annotated tags were rewritten with
  `git-filter-repo --mailmap` (verified metadata-only: every tree+message
  byte-identical pre/post) and force-pushed. API check: every published
  commit links to login Joeppie.
- **view3d.js is monolithic** (~5k lines, core): the headless test suites
  were split into `viewer/tests.js` in v0.169 (zero-build ES module, driven
  through the `window.HARCHEAN` hooks accessor — a GLOBAL handle on purpose:
  the page loads view3d.js with a per-release `?v=` cache-bust, and a static
  import from tests.js would resolve a SECOND module instance = two apps on one
  DOM). Remaining split (deferred): scene/render, gizmo, UI panels, subgrids,
  keeping the importmap/CDN, no-bundler constraint.
- Dashboard BUTTON elements (Toggle/Push/Arrow/Led) as real glTF models with
  the game's base transform + state animation (dev-viewer parity, transcribed
  in FORMAT.md §Handedness); today we draw plate+text approximations.
- Better flight-characteristics / stability analysis (beyond the stylized
  thin-plate model: full 360° velocity vector — nose may be ±X/±Z, automatic
  search of stable flight direction at low/high speed + ambiguity warning,
  trim/drag polar). User-requested, deliberately deferred.
- Aero model is stylized thin-plate (Cn = 2π·sinα·cosα), not CFD — label keeps.
- Joint animation is static (ailerons hinged at fixed droop from preview);
  in-game deflection state is not stored in the blueprint file.
- Optional before wider publishing: trim `testdata/` to the author's own craft
  (the other 23 files are other players' workshop copies — see NOTICE §2).

## Licensing notes (see NOTICE.md)
- Code is GPL-3.0; game data belongs to the game developer (batcholi/FloDKSM).
- Investigate provenance of anything of uncertain origin before extending it.
- No rights-holder permissions are claimed; reuse is presumed in good faith,
  CC-attribution spirit. Rights-holder objections are handled amicably via
  issues (NOTICE §4) — keep that transparency in any licensing-related change.
