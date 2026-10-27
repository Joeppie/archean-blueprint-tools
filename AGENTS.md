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
- App subgrid UX (SHIPPED; the bullet's own pin app/e2e/hinge.spec.ts is in
  the suite): a selected SUBGRID gets no free gizmo (the
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
  `archean-app-mirror-axis`, default x; v1.10.5: plus a ⊘ `mirror-axis-off`
  that disables the SESSION mirror entirely — block twin identity, panel
  geometry/paint mirroring, ghost/brush twin placement and the session sheet
  all stand down; 'off' semantics in blocks.ts, pinned in vitest blocks
  "⊘ off" + views.spec): Engine.mirrorAxis drives the
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
(c) each panel rides a SmallHinge (default) / SmallPivot as a SUBGRID
    [SUPERSEDED v1.9.0: SmallHinges ONLY — the ±360° SmallPivot option was
    removed, unbounded travel makes no sense for a control surface]:
Build record with nested `data.triangles` (parent-absolute, v0.168 law —
the dev readBuild recurses nested triangles, FORMAT §Subgrids) joined via
`composite_builds {component: flatIdx(pivot), slaveBuildId: flatIdx(Build)}`
(flat index = flattenComponents length + append order — new Builds carry no
nested COMPONENTS); scene.ts buildSubgrids renders nested triangles through
buildSolids (same prism buckets as the main skin);
(d) LowVoltageJunction at the envelope centre + `volume blocks` Volume stack
facing UP out of it (first centre +0.187 m, 1-cell pitch, count CLAMPS to
the local envelope) [SUPERSEDED v1.9.0: a yes/no toggle placing exactly
ONE Volume at +0.187 m, ON only where the 1-cell enclosed margin holds];
one LV pipe per pivot, coupler→pivot, waypoints
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
history);
(g) SPLIT-A-FACE, NEVER REFUSE (user 2026-10-23: "segment whatever is
breaking … pass in a single triangle that violates structure; break into
smaller using a simple predictable algo" — implemented+tested by subagent,
verified same session): `latsphere.splitFace(tri, opt)` — already-valid
faces returned UNTOUCHED; else the classic 1→4 MIDPOINT subdivision,
recursed (cap 8 ⇒ spans to ~4600 cells), degenerate subs dropped, colours/
material/shading ride every piece; midpoint .5 ties round AWAY FROM THE
COMPONENTWISE CENTROID in exact integer arithmetic (3·(p+q) vs 2·Σverts)
so mirrored triangles split mirror-identically (pinned). Wired: planAt's
LAST-RESORT rescue (only when the τ-ladder found no clean plan — natural
rungs stay BYTE-IDENTICAL, hash-proven) so the "spherical" balloon stores
smooth at sizes the old hull refused (48×48×1: 688 skipped → 0; needles
0); balloonfin.emit() splits too (a guarantee for future region growth —
today's ≤9-cell strips never trip it). The ⚖ Fix repair now also handles
the only remaining honest refusal (sub-cell 'too small for a hull'): a
raw-values check (NOT the 0.5-clamped probe list!) one-tap lifts to 0.5³.
Pins: `splitface.test.ts` (contract, determinism, mirror equivariance,
area/bbox preservation, termination, integration) + the needle/number-box
e2e re-pinned to STORE. Pins: vitest `balloonfin.test.ts` (9), `tooldoc.test.ts` v1.9
(shipped-tool save/reload + rotated-ghost map), e2e `sphereskin.spec.ts`
"the TAIL section" (@ui desktop+pixel7). In-game arbitration of triangle
panels on hinges is the USER's (no corpus precedent — flagged in the help
topic + FORMAT).
- **v1.9.0 THE PLATE LAW + the tool-desk batch (we: "the tail
 rudder swings like a propeller"; "remove the option for a 360 rotation for
 the rudder/tail, that doesn't make sense")**: MEASURED FIRST (kept audit tools
 `app/tools/rudderprobe.mjs` panel-axis/bbox + `plateprobe.mjs` part-plate box —
 plateprobe RE-RESOLVES the real root per read, liveDataEdit replaces it): the
 fin PANELS were right (rudder group axis (0,1,0) yaw on a fixed pin, ailerons
 (0,0,1) roll) — the hinge PART'S OWN PLATE rolled about the fore–aft axis.
 Root: `applyJointPoses` spun the axle node about the RAW .ini key INSIDE the
 content-basis C group ⇒ world line `R(q)·C·ê`, not the in-game-pinned panel
 law `R(q)·qAxle·ê` (x̂ keys are C-INVARIANT — that's why the Aileron-flap
 origin of the rule never bit; SmallHinge is `angular_y`). SECOND latent
 defect found: `real.userData = {…}` CLOBBERED `userData.jrefs` at all four
 sites, so `applyLiveJointPose` was a silent no-op everywhere. Fix = pure
 `subgrid.jointNodeAxis/Slide` (rotation `v = baseQ⁻¹·C⁻¹·baseQ·ê`, slide
 `d = C⁻¹·baseQ·ê`) feeding `JointPose.axisV/slideV`; userData merges
 (Object.assign) keep jrefs alive. Pins: vitest subgrid "THE PLATE LAW"
 (C·(baseQ·v) ≡ baseQ·ê for 4 eulers × 3 keys, x̂-invariance, rudder ≡ up) +
 e2e sphereskin TAIL SWEEP-DIRECTION pin from WORLD COORDINATES (rudder axis
 ∝ ŷ, panel vertical extent constant + lateral grows; PLATE vertical extent
 > 0.9 and |Δcentre.x| < 0.03 — pre-fix prop roll fails both; aileron twins
 ∥ ẑ). TOOL DESK: volumes = a yes/no toggle (ONE Volume at the coupler, ON
 only where the 1-cell enclosed margin holds; boolean in BalloonOptions);
 the ±360° SmallPivot `pivot part` select is GONE — panels ride SmallHinges
 (±90°) ONLY (vitest-pinned); the preview line is compact + choice-specific
 (`+F+P fin tri · rudder + 2 ailerons on SmallHinges (±90°) · LV×3 hidden ·
 volume 1 enclosed|volume off`, body size + paint-slot added, every pinned
 token kept); the CYLINDER is the shipped DEFAULT body (tail fields visible
 on open — e2e asserts the cycle; the ellipsoid-era suites click round
 EXPLICITLY via `stage()`, deliberate re-pins).
 - **v1.9.1 follow-up (we: "the hinge for the rudder is wrongly pointed …
 it shouldn't be positioned as though it was a pivot")**: the rudder hinge's
 ATTITUDE about its joint line. The SmallHinge's displayed slave hub lies
 ALONG its joint line (bbox-proven; the game's own XYQ door mounts stand it
 up the same way), so hub-up is law-mandatory for a yawing rudder — what
 was wrong was the TWIST about it: {ax: u×t, ay: u, az: t} was a cyclic 120°
 permutation of the aileron mount, lying the master slab flat = a turntable
 silhouette. The mount is now the aileron frame turned ONE −90° about the
 lateral axis — `frame {ax: −tHat, ay: uHat, az: sHat}` — slab upright in
 the fin plane, barrel lateral, the fin hinge stood on end. PANEL
 KINEMATICS UNCHANGED (axis0 = R(q)·ŷ = up either way). Pins: balloonfin
 'the rudder hinge is the FIN hinge turned ONE 90°' (part axes + q_rud ≡
 Rx(−90)·q_ail to 5 dp — 6-dp quat literals cap the precision) and the e2e
 tail plate-pin reframed FRAME-FREE: a spin about a vertical line keeps the
 model's vertical extent and centroid height EXACT (a horizontal-axis roll
 shears both) — holds for any mount attitude.
- **v1.9.2 THE VIEW MENU — see-through ground, sky backdrops, ORTHOGRAPHIC
  (user: "The ground being solid and not se through is unacceptable … use an
  equi backdrop from a free site like pixabay, mars and earth and non as
  options, in the cog menu, rename that to view … under view also add a mode
  for orthogonal … gauge relative performance")**: (1) the solid green sheet
  is GONE as geometry: `addGround` keeps the plane mesh but `visible =
  false` — three's Raycaster IGNORES visibility (r186 `intersect()` checks
  only layers), so the coord readout, the pad-plane fallback and the
  ground-kind placement rules behave EXACTLY as before while the pad is a
  see-through PICK surface; the grid lines + ±axis marks stay, the
  ground-height rule is unchanged. (2) `Engine.setBackdrop('none'|'mars'|
  'earth')` (persisted `archean-app-backdrop`, default none = the flat sky
  colour): SURFACE panoramas — real sky above, terrain below (user: "the
  backdrops sohuldnt be the entire planet, but a skybox+ground") — mars =
  the Perseverance Mastcam-Z Jezero 360° (NASA PD, cylindrical pano
  resampled to the full 2:1 dome with sky/soil rows extended to the
  poles), earth = Poly Haven "Waterbuck trail" by Greg Zaal (CC0);
  NOTICE §2. Committed under `src/assets/backdrops/` (offline-first;
  vite-imported, layout-exact on Pages), loaded once into an ENGINE-owned
  texture cache (never disposed by a scene load). THE DOME IS GEOMETRY
  (user: "it shouldnt orthographically project our skybox into being a
  cube"): a BackSide sphere (unit geo + `depthTest:false, depthWrite:false,
  renderOrder -1000`, layer 1, `raycast` noop) riding the eye every frame
  (`rideSkyDome`), NOT `scene.background` — three's orthographic background
  derives view directions from the projection matrix and corners the pano
  into CUBE WALLS; a sphere is projection-honest. `backdropState().dome`
  reports the live dome.
  (3) The ⚙ popover is THE VIEW MENU (Sec title "View", button "⚙ View");
  rows `backdrop-none|mars|earth` + `opt-ortho`; the keys hint row says `5`.
  (4) DUAL PROJECTION: `persp`/`orthoCam`, ONE orbit rig — `setProjection`
  (persisted `archean-app-ortho`, key 5 Blender-style) swaps
  `controls.object` (r186 OrbitControls stores the camera as `object`) and
  `gizmo.camera` (TGC's proper setter); persp→ortho inherits the view
  height `d·tan(PERSP_FOV/2)`, ortho→persp re-derives `d` from the ortho
  zoom — a round-trip is EXACT (pinned). PERSP_FOV is one constant;
  `pxPerM()` feeds the grid ladder from the frustum height/zoom in ortho;
  fit() sizes the ortho sheet from the same framing distance (portrait
  pullback rides `persp.aspect` for BOTH cameras); resize keeps the ortho
  vertical height; `ringScreenPoint` mirrors TGC's ortho handle-scale law.
  (5) Pins `e2e/viewmenu.spec.ts` (@ui): header "View" + rows; SEE-THROUGH
  asserted on FRAMEBUFFER PIXELS (`Engine.probePixel` = one fresh render +
  raw `gl.readPixels` in the same task — `readRenderTargetPixels` refuses
  the null target in r186; a dense scan of the band under the craft must be
  MOSTLY sky b>g, the green share = only the grid lines; the old sheet
  read g>b EVERYWHERE — ONE evaluate per scan, 75 round-trips blew the poll
  budget), backdrop swap/restore pixels + persistence (+ the `dome` state),
  ORTHO keeps the SKY as a dome with a SMOOTH top band (corner↔centre
  ≤ 60 px-sum — the cube-wall artifact fails this), `axialPx`: a 1 m
  step along the sight axis projects 0 px in ortho (>3 px in persp — THE
  parallel law), framing round-trip <1e-3, key 5 (BLUR the checkbox first —
  the key handler stands down while an INPUT has focus), reload persistence
  both ways, phone rows.
  (6) PERF (this batch's audit + `tools/viewperf.mjs`, user: "gauge relative
  performance … hot paths too intensive when rendering … does three work
  nicely with the DOM"): TWO hot paths FOUND and FIXED, both measured on
  the LIVE editor (iGPU, 1280×720, frames closed with a 1-px readPixels).
  (a) `coordHoverMove` (a full recursive pickCell raycast) ran on EVERY
  pointermove event (~120 Hz mice); it now shares the ghost's ~40 Hz cap
  WITH A TRAILING EDGE (Viewport `coordT/coordInfo/coordLast/coordTrail` —
  the position the pointer STOPS at always gets its raycast: the
  views.spec "hovering the CRAFT" pin caught the leading-only variant
  going stale forever; the chip itself follows every move, cheaply).
  (b) THE PICK SCAN RAYCASTED THE DECORATION MESHES: three's Raycaster
  IGNORES visibility, so the merged wire-edges LineSegments, the occupancy
  unit boxes and every cable/pipe mesh + end dot were triangle/segment-
  tested by EVERY pick pass — for hits the pick loops then THREW AWAY
  (only block/ground/comp/sub are legal results). They now render on
  LAYER 1 (both cameras enable that bit; every Raycaster defaults to
  layer 0 only) — `wire/occ/pipe/pipe-end` meshes get `layers.set(1)` at
  creation. MEASURED (viewperf): giant-craft hover raycast 144.8 → 2.5 ms
  median (58×; @120 Hz uncapped that was ~17 cores-worth → ~2), ISW 2.7 ms
  unchanged; frame cost and draw counts unchanged. The View-menu features
  themselves are ~free: a backdrop dome is +1 draw / +0.1 ms per frame,
  ORTHO equals perspective frame-for-frame (giant 10.2 vs 10.3 ms, ISW
  1.9–2.1 ms). Everything else per-rAF early-exits when idle (`stepSurges/
  stepHolo/stepLabels/flushLiveEdits/pulseSelection` gate on state,
  `syncGrid` is arithmetic until the step rung flips, `twinWarnState`
  returns before any matrix work, `StatsStrip`'s rAF stops after the first
  drawn frame) and the DOM pattern is already the cheap one: three.js
  itself only ever touches the canvas, the overlays are imperative
  style/text writes or ≤5 Hz interval syncs, NEVER React state per frame —
  the answer to "three + DOM" is that the reconciler, not three, is where
  the overhead would live.
  Version strings sit at v1.9.2 (patch line; the batch adds user-facing
  functionality → a v1.10.0 MINOR was PROPOSED to the user, not self-applied).
- **v1.9.3 THE RUDDER HINGE LIES DOWN (we: "the TAIL RUDDER hinge … points
  upward so it can bend the tail fin down and up, but the tail should move
  sideways!!! … It should be in a lying position, like the two other
  generated hinges; the hinge should be 'laying down' but, connectors same
  side (near the fuselage) as the other hinges, and of course rotated 90°
  while still laying down")**: the THIRD ruling on this one mount
  (v1.9.0 join → v1.9.1 stance-up "fin attitude" → RETIRED here). The
  rudder pivotDef in `balloonfin.ts` is now THE AILERON MOUNT ROLLED ONE
  +90° ABOUT THE SHIP AXIS: frame `{ ax: −ŝ, ay: t̂, az: û }` (was
  `{−t̂, û, ŝ}`) — the part's tower (local ŷ = the .ini angular_y pin, the
  slave hub the bbox proved lies ALONG the joint line) LIES along the
  longitudinal line like both fin hinges' towers, and the plug face
  (local −ẑ, where the gltf's lv/data connectors live) points DOWN at the
  body — every connector in the tail batch now faces the fuselage. All
  three hinges are then ONE part rolled around the ship: towers aft,
  plugs in toward the hull. Kinematics follow the mount (axis0 = R(q)·ŷ):
  the rudder panel now rolls about the LONGITUDINAL line — the tall
  vane's TOP swings SIDEWAYS (the keel strip the opposite way), and the
  plate spins on its own lying axis, so its world box CENTROID never
  moves. The v1.9.1 claim "hub-up is law-mandatory for a yawing rudder"
  (XYQ-door precedent) is OVERRULED by this pose spec; the PLATE LAW
  itself (R(q)·qAxle·ê) is untouched. Pins re-cut to the new law, each
  DISCRIMINATING (the old mount fails them): vitest `balloonfin.test.ts`
  'the rudder hinge is the FIN hinge rolled ONE 90° about the ship axis'
  (tower ∥ ±ẑ not up, plug face up ⇒ plugs down, qr ≡ qMul(qAxisAngle(ẑ,
  +90°), q_ailR) to 5 dp); `subgrid.test.ts` rudder end-to-end (file quat
  Rx(90): jointChain axis ∥ ẑ, plate ≡ panel law); `tooldoc.test.ts`
  rotated-ghost commit (authored 180° about (û+t̂)/√2 × the ⟲y ⇒ stored
  |w|=|x|=|y|=|z|=½; the stance mount stored a pure |y|=1); e2e
  `sphereskin.spec` TAIL section from WORLD COORDINATES (captured line
  LYING |dot(axis,UP)|<0.05; panel turns ON it; half-centroid SCISSOR:
  top and keel travel OPPOSITE along axis×UP — a yaw moves them alike;
  plate extent ALONG its joint line EXACT under the spin — a C-basis
  roll would shear it; centroid ≤ 0.02 — at rest the static LV plug
  (0.146 m) owns the bbox silhouette, mid-turn the tower corners
  (0.234 m) do, a designed 0.0105 re-centring). Help topic balloon.md
  retold. In-game arbitration of the sideways sweep stays OURS jointly
  (AGENTS: in-game pixels arbitrate). Version strings v1.9.3 (patch).
- **v1.9.4 SKY BACKDROPS ARE A MANIFEST (we: "Add goegap call it desert,
  kloofendal… call it sky … Attribute these in the help … try a low-quality
  version … Keep the images in their own folder, with attribution and a URL
  to them. Make the code enumerate them automatically when doing a build")**
  — `src/assets/backdrops/` is now DATA: every panorama sits next to
  `manifest.json` (name, file, source URL, author, license, note) + a
  human README.md, and `scene.ts` enumerates the folder at BUILD time
  (`import.meta.glob('…/backdrops/*.jpg', eager, ?url)` + the json). The
  `Backdrop` type WIDENED from the 'none'|'mars'|'earth' union to a string
  ('none' or a manifest name); `BACKDROPS`/`backdropNames()` are the single
  source — the View-menu rows (with author+licence+URL tooltips), the
  Editor's localStorage validation and the Engine cache all follow it, so
  ADDING A BACKDROP = drop a 2:1 JPG + one manifest entry, ZERO code. New
  entries (both Poly Haven CC0, low-quality tone-mapped 2 k variants, q70 —
  208/85 KB): **desert** = "Goegap" (Greg Zaal), **sky** = "Kloofendal 48d
  Partly Cloudy (Pure Sky)" (Greg Zaal & Jarod Guest); mars/earth migrated
  in with their NOTICE §2 attributions. Attribution rides THREE places per
  the ask: the folder manifest+README, the NOTICE §2 rewrite, and the in-app
  manual (Display topic ▸ "Sky backdrop credits" — search words added).
  e2e `viewmenu.spec` is manifest-DRIVEN now: it reads the json + checks
  every listed jpg EXISTS (module top, fails before any click) and loops
  rows/phone-rows/swap-pixels over every name — a new entry is pinned the
  moment it lands (proven: desert + sky swap pixels green). Build proof:
  `vite build` emits all four panoramas; 508 vitest + viewmenu @ui green.
  **hangar** (we first re-pasted the sky URL, then: "I meant this one
  https://polyhaven.com/a/hangar_interior") landed as the SAME drop-in —
  one jpg + one manifest line, zero code — proving the design: Poly Haven
  "Hangar Interior" (Dimitrios Savva & Jarod Guest, CC0, interior panorama
  roof-above/floor-below, 341 KB tone-mapped 2k q70). Then **mars + earth
  RETIRED** (we: "Remove the earth and mars they werent vey suitable") —
  `git rm` both jpgs + manifest entries, all credits updated; the manifest
  = desert, sky, hangar, which is all `vite build` emits. The retire also
  re-pinned the LAST hardcoded-name tests to the manifest (viewmenu
  ortho-dome + reload-persistence now use `FIRST = MANIFEST.backdrops[0]`,
  `viewperf.mjs` loops the manifest) — no backdrop NAME survives in test
  or tooling outside the manifest itself. And the off-option is an ICON
  now (we: "reword none option for equi as a simple n/a icon, the one with
  a strike through"): the button reads ⊘ (the mode-widget's off glyph),
  value/testid `none` unchanged, tooltip says it. Fresh profiles finally
  BOOT ON A BACKDROP (we: "make sky backdrop default") — a top-level
  `"default": "sky"` in the manifest (validated by `backdropDefault()`,
  scene.ts; stored picks and an explicit ⊘ always win; the engine's boot
  re-apply at construction loads the dome). Stale stored names from the
  retired mars/earth fall back to the default too. e2e: boot now expects
  `{current: DEF}` from the manifest, and the flat-sky BASELINE + the
  see-through scan switch to ⊘ explicitly first (behind a see-through pad
  a PANORAMA's terrain may read green — the swap pins cover panoramas,
  this pin covers the sheet).
- **v1.9.4 VERSIONED, VALIDATED CRAFT CACHE (user: "use a versioning and store
  a SHA for each file … the user can choose whether or not to [redownload];
  warning label … each corpus item must display whether it is up-to-date or
  workshop was edited afterward"):** the IndexedDB cache (crafts.ts
  `archean-crafts`, DB bumped to v2 ADDITIVELY — v1 data survives but legacy
  entries are `unknown`, never silently trusted) now versions every copy with
  `rev = bytes-mtime` + **SHA-256**. The catalog (`virtual:gallery`,
  vite-corpus.ts) stamps every entry `{rev, sha, bytes, mtime}` (eager sha,
  memoised per path+size+mtime; 244 files/44 MiB measure tens of ms) and the
  blueprint routes answer `X-Blueprint-Sha`/`X-Blueprint-Rev`; downloads verify
  the fetched bytes against the served digest (static Pages: against the
  catalog stamp) — a mismatch is delivered-but-untrusted (`unknown` +
  console.warn). `sha256Hex` uses WebCrypto with a pure-JS fallback, because
  crypto.subtle is absent on the plain-http Tailscale origin. States
  fresh/stale/unknown/absent; FRESH opens keep the ZERO-network rule
  (download.spec contract re-run green); stale/unknown open through
  `components/StaleDialog.tsx` — one-line meaning + both dates + the CHOICE
  (`stale-download` / `stale-usecached`, testids `stale-open-dialog`); never
  auto-replaced. Gallery cards carry a status chip per cached craft
  (`card-status-<state>-<id>`, tooltip = both dates). Catalog stamps follow
  real file changes: the dev watcher now INVALIDATES the compiled gallery
  module (a bare full-reload kept serving old stamps — proven with a canary
  fixture). Pins: `crafts.test.ts` (sha vectors, versioned-cache suite:
  fresh-zero-fetch / stale→redownload→fresh / sha-reject / legacy-unknown),
  `corpus-staleness.test.ts` (temp-corpus chain via ARCHEAN_BLUEPRINTS —
  file edited ⇒ rev AND sha change ⇒ state stale ⇒ Download latest ⇒ fresh),
  `gallery.test.ts` (every entry stamped), e2e `staleness.spec.ts` (@ui, both
  viewports). Tool: `app/tools/stalecheck.mjs <id> [url]` — real-data UI walk
  (persistent /tmp profile; NEVER writes ~/.steam). VALIDATED LIVE on two REAL
  revisions of the airliner (workshop original ba4c07c7… → the game's Oct-20
  hullified save a31ea68e…): gate fired with both dates, [Download latest]
  re-stamped to silent fresh. Bonus rule learned: corpus identity — catalog
  and /corpus route resolve the SAME file (one `craftFile()`), so a staleness
  flag can never describe a different file than the download would fetch.
- **v1.11.2 PERF & CODE PASS + FIRST WASM MODULE (we: "Run an analysis on
  performance and code and refactor. Also look at the possible use of WASM
  … where that makes sense")**: the session's measurement harness is
  `app/src/engine/__tests__/load.perf.test.ts` (`npx vitest run load.perf`
  — times the ranked loops on committed corpus crafts, prints a PERF table,
  carries loose anti-regression tripwires). Landed:
  (1) **THE SEALED-ENVELOPE WASM MODULE** — `sealedEnvelopeVolume` measured
  219 ms on the giant and ran SYNCHRONOUSLY on every edit rev (LiftWidget,
  KNOWN ISSUE 1): the flood + voxelisation is now a 4.4 kB AssemblyScript
  module `app/wasm/seal.ts` (`npm run build:wasm` — assemblyscript is the
  only new devDep, inside app/; the binary is committed), seam
  `engine/sealwasm.ts` (fixed-address ABI: blocks i32 @0, tri verts f64 @1
  MiB, OUT @17 MiB, heap `--memoryBase` 18 MiB; JS serialises through
  zero-copy views, RE-CREATED per call since the buffer grows).
  `sealedEnvelopeVolume` = wasm when booted (Editor background-fetches the
  `?url` asset — `src/vite-env.d.ts` added for the type), the pure-JS twin
  `sealedEnvelopeJS` (the reference, verbatim reference status) otherwise.
  Pins `sealwasm.test.ts`: corpus + synthetic seals + balloon skins answer
  CELL-EXACT on both paths (the diff-debug exports `wallPtr/seenPtr/gridN`
  diff wall maps cell-for-cell — they caught a vertex-stride bug the
  symmetric tetra fixture masked), giant ≥1.5× (measured 1.6–3×).
  (2) **LiftWidget DEBOUNCE 250 ms** — first compute synchronous, every
  later rev recomputes once per edit BURST, the flood never blocks a frame.
  (3) **INDEXED TWIN CENSUS** — the build dock's per-rev ⇄-conflict sweep
  (blockTwinIssues per block = O(n²) + a blockCells alloc per inner
  candidate, 17 ms at the 800 cap) became `blocks.ts twinConflictCensus`
  (single O(n) pass, index keyed by the two TRANSVERSE cells, ascending
  lists so the naive rank-picks/first-max overlaps reproduce EXACTLY —
  pinned per fixture × axis; planted-conflict + info-only pins). **The
  800-block cap is GONE** (giant 9 656 records = 6.6 ms; census.conflicts
  is never −1 '—' again). `twinIssuesOf` is the shared pair-comparison of
  the census and the per-block popup (the count and the popup cannot
  drift). (4) **cull.ts string-diet** (candidate-1 JS half): integer
  quantisation of the face footprints (toFixed(4) float formatting was the
  cost driver), per-slot opacity memo in both passes, lazy vertex clouds
  (fully culled interior blocks never build them) — 162→154 ms; the AS
  port of the cull is DEFERRED with numbers (PERF.md §WASM verdict: it
  must re-implement blockshapes + the face-grid for a load-only loop).
  (5) AssemblyScript landing lessons → PERF.md (raw-pointer flood arrays:
  typed-array bounds checks made the first port SLOWER than JS).
- **v1.11.3 THE DRAPE LAW — CABLE PHYSICS (we: "flexible cables should
  simulate- to some degree- physics, and have a hang/sag depending on how
  tight they are, like it is in game, and move toward/attach to where they
  physical connection it; sag then depends on how overstretched they are
  for their actual length")**: a cable run whose cached ends left their
  sockets (a part moved) and whose BOTH sockets resolve is no longer drawn
  as its stale waypoints — it is RE-DRAPED as the physical hanging curve
  the game re-routes to on save (`pipes.ts drapeChain`: the CATENARY
  y(x)=a·cosh((x−xm)/a)+c solved for the run's REST LENGTH (the file's Σ
  segment lengths; flexible pairs carry theirs in segment[0]):
  2a·sinh(dh/2a)=√(L²−dv²) in the vertical plane between the plug NECKS
  (tips + the v1.8.2 2r axial leads — the connection law is untouched,
  the drape hangs from the necks). Laws pinned (pipes.test 'THE DRAPE
  LAW'): rest length ≤ span ⇒ TAUT straight bar (an overstretched cable
  pulls straight); sag grows monotonically with overstretch L/span; a
  VERTICAL span hangs STRAIGHT (the old XenonViewer chord-offset parabola
  side-bowed — replaced); sampled arc ≈ rest length; the chain lands
  EXACTLY on the plugs. FRESH runs keep the RECORDED polyline verbatim —
  the game's sag is baked into its waypoints (drape there would double
  it). Re-draped runs wear the LONGEST segment's style (segment[0] is
  often the black sheath stub). LIVE FOLLOW: `pipesSoon` became a 250 ms
  leading+trailing THROTTLE (the old pure-trailing debounce reset on every
  pointermove — cables only snapped into place AFTER a drag release; now
  they ride the drag at 4 Hz and settle on the trailing pass).
  `pipeInfo()` gained `reroute` + `polys` (the sag pins measure the chord
  dip); net gained `reroute`. Truck (file carries user-moved parts)
  re-drapes on LOAD, ISW on the +1.5 m Dashboard move — e2e pins, one
  re-pin: the truck's round-vs-square bar AGGREGATE shifted with the
  draped item ducts, the species law is the per-kind majority rows
  (already pinned). FORMAT §pipes 'THE DRAPE LAW' is normative.
- **v1.11.5 THE FLEX GATE + THE HARNESS ATTACH (we: "You drapped cables
  that are NOT flexible, and the ones that should drape, do, but they
  connect to the wrong spot" + "the cable to the small pivot goes to the
  OLD position; it does to the OLD position of that pivot, rather than its
  actual current one"):** (a) THE GATE IS THE FILE'S `flexible` FLAG —
  appearance law (we: "they are either axis aligned pipes OR flexible
  cables in appearance"): only `flexible` runs hang (the corpus law: the
  flag occurs on EXACTLY the 2-segment pairs, 1126/1126); routed runs are
  the rigid conduit — the recorded builder-cache route draws VERBATIM
  (axis-aligned bars) with stale ends re-seated + axial leads. The
  v1.11.4 drape-all is RETRACTED (net.draped = flex runs, net.reroute =
  flex re-hangs; pins: routed runs emit axis-aligned bars only, flex
  chains hang + reach the moved plug). (b) THE HARNESS ATTACH (sockets.ts
  SocketAnchor.attach + plugAnchor): a SUBGRID part's adapter resolves
  through the owning Build group's DISPLAY transform (file-space: pose
  minus moff; buildPipesMesh builds `sockFlat` from subGroups), and the
  anchor carries that rigid transform — plugAnchor transforms the RECORDED
  TIP by it, so a door harness RIDES ITS DOOR continuously (measured
  XYQ-615: the file caches tips at the BUILT pose — the tip sits at the
  adapter offset from the FILE spot, 1.07 m from the display spot with
  the door saved open 24.3° — the 0.45 m re-seat band is top-level cache
  repair, not a harness law). The pipe mesh builds AFTER buildSubgrids
  (load order) and rebuildPipes re-reads live group poses → hinge drags
  follow through pipesSoon. Pins: sockets.test 'THE HARNESS ATTACH', e2e
  pipes 'a DOOR HARNESS hangs from the door's LIVE pose' (XYQ: +40° swing
  moves the end 1.7 m, restore 1e-6, leads clean) — the pin's nested
  detector must use the flat builder's NESTED POSITIONS, not `index ≥
  topCount` (flattening shifts the LAST top-level entries past it).
  FORMAT §pipes carries both laws.
- **v1.11.8 THE RIG CHAIN — nested Builds carry their content's transform
  (we: "there are missing cables, or not rendered and a hinge that seems to
  be in an incorrect position" + "the front-wheel of the F18 seems to be
  rotated wrong" — F/A-18F 3521588534 gear, 2026-10-26):** content nested
  inside a Build is NOT parent-frame absolute (v1.11.6's assumption) — the
  Build carries a rigid transform: raw `position` + RAW quaternion,
  composed down the nesting (dev blueprint.js readBuild is literal:
  `world = parentWorld · compose(position, quaternion, 1)`, the top-level
  readBuild starts at identity = v0.168 re-derived, and scene.js transforms
  blocks/triangles/PIPES/components by `model.builds[b].matrix`). Law:
  `subgrid.ts rigChainOfPath/rigPush/rigApply`; scene.ts: rig Groups in
  `buildSubgrids` (heavy tier bakes the chain into the merged stand-ins),
  chain∘group in the v1.11.5 harness attach (nested sockets AND the
  recorded tips riding them), `subBlockBBoxRigs` pivot clamping. The
  F/A-18 stores its gear legs as rigs 27°∘59.4°∘90°∘29.7° (telescoping
  translations = the saved RETRACTED pose); its steering pivots + gear
  harness routers sit ON the rigs' invariant lines (the chain leaves them
  EXACTLY in place). v1.11.6 identity nesting stranded the nested pivots
  mid-bay and buried the nested harness sockets (pipes 0/7/97/100/102/104/
  269/276) inside the hull — the "missing cables". 13/117 crafts have rigs;
  the 104 identity-bench crafts (XYQ doors, dolphin, Badger, gantry, truck
  …) render byte-identical. AUDIT `app/tools/gearpair.mjs` (live app↔dev
  world AABB centres of the streamed REAL models, paired by flattened
  index): F/A-18 100/100 nested parts ≤ 0.177 (most 0.000–0.07; gear
  wheels 0.000), the other 12 rig crafts 0 mismatches at tol 0.2 (baseline
  3445304576 alone: 172). Two accepted audit classes: the 3481737379
  LinearTrack row = the app shows the catapult carriage at its SAVED
  data.pos (v1.10.2 joint state, game-faithful) where dev renders the
  static construction pose; the giant's 85 rows = heavy-merge tier has no
  per-part boxes (its v1.11.6 census pins cover it). NO top-level law
  change: the v1.10.2 joint pose (master `.ini` axle, clamped pivot,
  baked-angle deltas) stands — dev's raw TOP affine differs (≤ ~1 m) only
  where the master is a control hinge and the bench turns about a builder
  fold beam; in-game pixels arbitrate (GEAR-F-A18F.md). THE NOSE-GEAR FIX:
  `displayQuat`'s caster arm→down roll (v0.134) fired on the F/A-18's big
  `Wheel` pair (w=±0.707, y=∓0.707 — ±90°ŷ steering mounts passed the
  gate) and yawed each wheel 90° about the longitudinal axis — the roll is
  now SmallWheel-ONLY (validated in-game for casters; 'Wheel'/'BigWheel'
  ride the plain view law per v1.11.5); nose wheels then pair with dev at
  0.001 m and wheels.spec's 8 caster pins stay green. Pins: vitest
  `rigchain.test.ts` (8: dev-verified literals (±2.599,−0.938,18.001),
  invariant-axis parts, direct-children identity, corpus rig-craft census
  ≤ 15/117, bbox equivalence) + `compparts.test.ts` wheel-gate (3);
  @subgrid 6/6, @sym 4/4, cables/wire/@gizmo green, wheels.spec 8/8, vitest
  666; version strings v1.11.2.
- **v1.12.2 BOOT COST & SNAPPINESS pass (we: "Boot times should be quicker…
  what can be made quicker, parallelized? … algorithms with unnecessary
  complexity … WASM?"):** the measurement harness is `app/tools/bootprobe.mjs`
  (production-preview boots: phase marks `boot:main/eval/render1/vp/canvas/
  enginedone/renderer/env/attach/atlas/scene-load`, resource routes, long
  tasks) + the per-pass `lpStep` profile exposed through `stats().loadPhases`
  — numbers transcribed into PERF.md §v1.12.2. Landed:
  (1) **CABLES AS INSTANCED MESHES** — every bar/elbow/collar is ONE INSTANCE
  of a unit template (the same `Quaternion.setFromUnitVectors` + `compose`
  matrices the clones got, per-segment LINEAR colour via `instanceColor`,
  one InstancedMesh per template×material); the old clone+mergeGeometries
  fan-out was THE load hot spot: `pipes` phase truck 253→8.9 ms, giant
  **1054→14.4 ms (73×)**, and every `reload()`/`rebuildPipes` re-pays it (the
  interactive win: block edits on the giant ~1.3 s → ~270 ms total build).
  The v1.8.1 RENDER LAW is untouched; the pick/xray/surge/pin paths all speak
  the PURE net (segs/polys/plugs) which `buildPipes` answers unchanged — pipe
  meshes stay layer-1 draw-only. (2) **`symTwinIndex` allocation-free inline
  per-type scan** (the giant's 3.2 M mask tests no longer allocate an array
  pair per call; directed pairs preserved — the off-plane test reads |a|;
  30-seed fuzz pin `sym.test.ts` runs it against the `symMaskAt` reference).
  (3) **Boot parallelization**: the atlas MANIFEST fetch fires with the
  Editor chunk import (App.tsx `lazy` + Viewport attach kick) — it ran
  serially BEHIND the blueprint download (the 6 MB giant lost ~380 ms);
  deep-link boots pre-resolve the chunk (main.tsx `bootEditor` → the editor
  renders in the root's SYNCHRONOUS initial mount, no time-sliced Suspense
  reveal — bootprofile measured the reveal amortized over ~250 ms of slices).
  (4) **Chunk diet**: vite `advancedChunks` three+vendor groups (stable Pages
  cache identity: three 260 gz + vendor 68 gz survive releases) + lazy
  ToolsDialog (registry + latsphere + balloonfin), HelpDialog (markdown +
  topics), LiftWidget/CostWidget (atmo/economy) — Editor chunk 1 369→365 kB.
  (5) **THE ANCHOR-CLASS LAW** (subride fix): a JRef records
  `benchAnchored` — a joint line anchored on the BENCH's fixed line
  (v1.10.2/v1.11.8 law-collinear class, the game's own hinge) is exempt from
  the v0.173 panel-CLAMP contracts (`onPanel<0.6`, `lever<3`): Jimmy's
  gantry SmallPivot hinges on its own 30 m arm's top line, 1.5 m off the
  content box BY DESIGN; the audit keeps the KINEMATIC laws (rideP/rideQ/
  travel — rigid attachment) for BOTH classes and the clamp contracts for
  the clamp class. The audit bbox also mirrors the engine's `blockParts`
  (nested-Build blocks through the v1.11.8 rig chain — the raw-file bbox is
  the Jimmy leg's old P7.1 note). (6) **BACKDROP-SKIP FIXTURE LAW**
  (we: "Make a backdrop Skip part of test fixture"): playwright storageState
  ships `archean-app-backdrop=none` — every boot skips the 86–350 kB pano;
  the fresh-profile DEF panorama pin re-arms it by removing the key in its
  own context (viewmenu). A spec that GAINS a panorama law clicks the row
  explicitly (the swap pins already do).
  FIVE e2e re-pins (all reproduce on baseline b5f93e1 — main's pre-existing
  reds from the v1.12.0 CLEAN-mode tile + the v1.12.1 preview-boot speed-up,
  see the re-pin commit): panels pixel7 dock step transits via + Parts
  (KNOWN ISSUE 13: re-clicking the ACTIVE tile drops to CLEAN); wire port
  rows are HOVERED explicitly after the list re-lays; camera SETTLE = two
  identical `camPos()` samples (damping decays in the render pump after
  mouseup; fixed sleeps under-slept the fast boot); the auto-jump probes
  require two identical probe answers (the part click flies the camera
  380 ms — a mid-flight probe goes stale before the click, KNOWN ISSUE 12
  family); the coplanar mirror-prism pair pins use the record the pick
  ANSWERS as the selected prism (build-order tie, not a law — the delta/flip
  /pair-paint laws are symmetric in (self, twin)).
  NOT shipped (measured, documented): the e2e boot floor is the HEADLESS
  environment (bare `getContext('webgl2')` = 2 ms; the ~330 ms `renderer`
  mark = ANGLE/Vulkan init + ~26 compositor frame round-trips; `--use-angle=gl`
  and shared shader caches change nothing); the hull-cull WASM port stays
  deferred at its v1.11.2 verdict (cull+solids is now the giant's only
  remaining 100 ms-class load phase, load-only, no interactive path).
  Suite: vitest 737, fast tier 204 runs **2.5→1.8 min** 0-red, @slow 11/11.

- **v1.12.7 THE DRAW-ONLY SKIN STITCH (we: "when I convert stratalaunch to
  triangles as a whole, my framerate goes down the drain — do we have the
  bake for triangles that blocks have?")**: the bake (one merged mesh per
  colour) always covered skins — the drain is GEOMETRY VOLUME: hullify
  emits per-cell records and every record renders as a closed 8-face prism
  with coincident seam walls (measured corpus: rendered tris blow up
  15-116×), where blocks enjoy cull.ts's interior cut + rectangle stitch.
  The fix is DISPLAY-ONLY (`hull.ts stitchHullSkin`, build.ts's seam):
  welded coplanar cell-skin pairs (hullify's cellQuad pairs AND emitPoly's
  N×M quad pairs — axis-aligned plane, all five colour slots equal,
  axis-aligned right triangles) merge into MAXIMAL-RECTANGLE prisms; the
  seams that vanish are exactly the zero-volume coincident pairs (and cap
  diagonals); PATCH-BORDER/rim walls are kept verbatim (the v1.5.10 rim-cull
  ban untouched — this removes no boundary rim). Everything ineligible
  (per-face paint, slants, lone half-squares, authored big triangles —
  ISW, the game's corner fixture, balloonfin strips, latsphere skins)
  falls through to the verbatim prism: small authored corpus skins render
  BYTE-IDENTICALLY (pinned). The FILE, the pick law (tris.triAt reads the
  RECORDS, the hit point off a merged cap projects the same), pin/selection
  visuals and the wire overlay are untouched. Engine session A/B seam
  `setSkinStitch(on)` (audit `app/tools/hullifypair.mjs`). Measured:
  hullified airliner faces 425 864 → 92 636 (4.6×), corpus 3.4×; LIVE
  iGPU hover raycast 16.4 → 4.3 ms, frame 26.4 → 22.9 ms (airliner).
  Deferred by our ruling (measured, not taste): the FrontSide split for
  closed prisms, and the writer-side stitch (shrinks the file + in-game
  cost, changes rim layout → in-game pixels must arbitrate).
  Pins `__tests__/stitch.test.ts` (12: law/coverage/outward-winding/
  determinism/corpus-identity; the coverage sweep keys on STRICT caps
  |n|>0.999 — the 0.999 vs 0.9 lesson: a shallow 1:3 slope's prism wall
  normal scores 0.949 on an axis, exactly the interior seam the stitch
  must remove).

- **v1.11.6 A SUBGRID OF A SUBGRID RENDERS (we: "there are wheels that do
  not seem to render where the front wheels of the doritos craft should
  be, is this because they are a subgrid of a subgrid (of a subgrid?)" —
  YES):** the Dorito SSTO nests Builds three deep (c[71].Build[0].Build[0]
  = the two front Wheels; c[17]/c[81] chain to depth 3 too). Two gaps made
  deep content invisible: (a) RENDER — buildSubgrids skipped Build entries
  inside subgrid content (the top-level GHOST rule) and never walked their
  content; (b) KINEMATICS — subMasterEntries DROPPED joins whose slave
  Build is nested ('nested Build: unused host'). A Build inside subgrid
  content is an ASSEMBLY NODE: its blocks/skin render through ITS OWN
  palette (v1.11.0 scoping at every depth) and its parts render
  (stand-ins, heavy-merge, streaming, pick routing) inside the owning
  TOP-LEVEL group (depth guard 8); nested-slave joins key to the hosting
  group via `path[2]`, so a gear subassembly animates with its bay on the
  host's joint chain; the captureJrefs bbox is the union over all depths.
  The v1.11.5 harness attach already resolves deep-nested sockets through
  the host group. Hook Engine.subStats() {groups, parts}; pins: subgrid
  .test 'joins to NESTED Builds key to the hosting top-level group' + e2e
  subride 'a SUBGRID OF A SUBGRID renders' (file-computed nested census ===
  the rendered census). FORMAT §Subgrids + §Format facts carry the
  ASSEMBLY-NODE nuance. THE 'parent-frame absolute at every depth' clause
  is SUPERSEDED by the v1.11.8 rig chain (identity benches make it a
  no-op there; content under a posed nested Build is rig-LOCAL).
- **v1.11.4 THE DRAPE LAW HANGS EVERY CABLE (we: "loading
  ?craft=3308603448, the cables dont seem to hang, the connections are
  mis-identified somehow")**: triage (`app/tools/cabledrape.mjs`,
  committed) — on that craft ALL 276 runs resolve their sockets (median
  tip→socket residual 0.040 m; the FLATTENED index law is right: pipe
  indices reach 234 < flat 238 > top-level 198) and only 25 ends are
  stale ⇒ the v1.11.3 stale-gate draped almost nothing. The file routes
  are the BUILDER'S CACHE (axis-aligned bars tiling the route; cable
  length Σ segment lengths, median 1.73 m, to 30.8 m) — drawn as recorded
  they are STRAIGHT and the slack reads as kinked, mis-wired
  connections. In game cables are LIVE ROPES ⇒ the drape applies to EVERY
  run whose TWO sockets resolve, fresh included: walked length = Σ
  segment lengths + the joint zigzag the drawn path walks (the chained
  starts leave offsets the lengths do not cover — that slack IS cable),
  hung between the plug necks by drapeChain; taut when over-stretched;
  an unresolvable end keeps the recorded polyline. PipeNetwork/pipeInfo
  gained `draped` beside `reroute`. 3308603448: 247 hung runs, 0 NO-DIP
  (ISW 15/0, truck 281/6 — the 6 are vertical spans hanging straight).
  The 12 ends cached 0.14–3.2 m off their sockets (parts rotated after
  building) re-seat, then hang. Pins: pipes.test drape-all + taut +
  unresolved-kept; e2e pipes/wire/select 20/20 (X-ray cut pins hold on
  draped geometry). FORMAT §pipes retold — the v1.11.3 'fresh runs keep
  the recorded route' clause is SUPERSEDED (the cache's corners were
  never the game's sag; the FORMAT stores the cache, the viewport hangs
  the rope).
- **v1.11.1 PHONE WIDGET LAW + FULLSCREEN HELP + THE w KEY (we: "Ui elements
  are in the way on phone when placing blocks, and I see the picked block
  popup and the widget for changing blocks over the block itself which
  prevents effective use, when I tap these elements shouldn't be in the
  middle but off to the side/bottom"; "Help should be fullscreen window on
  phone"; "W should toggle wireframe"; "go through descriptions in the ui
  that might be outdated like the one about lift only mentioning
  triangles")**: (1) THE PHONE EDGE-DOCK LAW — on <768 px every viewport
  popup leaves the tap zone: the modebox (⊘ ✥ ⟳ ⤢ ▵ ⇄ 🎨) docks centred at
  the viewport's TOP edge (desktop keeps its 48-px-above-the-click anchor),
  the TOOLS placement label docks at the bottom edge above the build dock
  (the v1.11 twin-warn precedent), and the 3-D widget SHRINKS:
  `Engine.setGizmoSize(0.6)` (a size-1 TGC gizmo spans ~¼ of a phone screen
  = a shield over the block being edited; desktop stays 1). `ringScreenPoint`
  multiplies by the LIVE `g.size` (TGC's handle scale is factor·size/4), so
  the ring-aim pins follow the shrink. Hook `gizmoSize()`. (2) HELP IS
  FULLSCREEN on phones: `fixed inset-0` backdrop, dialog `h-full w-full
  rounded-none`, safe-area insets, the Brave 7.5rem clear-zone is GONE there
  (✕ lives in the title bar); desktop keeps the 86 dvh cap. LESSON: the
  backdrop grid had NO explicit column — the implicit auto track grew to the
  article's max-content (the keys table measured 2572 px wide on a 412 px
  phone); `grid-cols-[minmax(0,1fr)]` is what makes `w-full` mean the
  viewport. A fullscreen dialog leaves no backdrop to click, so
  help.spec's backdrop-close leg is desktop-only (phones close via ✕/Esc).
  (3) THE w KEY joins `g/o/h/5`: map `w: 'wire'` — it obeys the legacy
  hull⇄wireframe MUTUAL EXCLUSIVITY (lighting the wire darkens the solids,
  selftest excl=true); the ⚙ View row label line and keys.md carry it.
  (4) THE LIFT COPY CAUGHT UP with v1.11: the empty state no longer says
  "no hull triangles yet … Sphere skin" (the tool is Generate balloon now)
  — it speaks the sealed-flood law (enclosed BLOCKS and/or a skin; walls
  alone displace no lift) and the envelope row says `sealed blocks + skin`
  vs `open skin` by the mode it computed in. (5) THE HELP TOPICS CAUGHT UP
  with v1.11: interface.md's "side panel" section is gone (ℹ Info dock +
  the bottom-dock table; the TopBar row lists the real tiles ⌖ ℹ ✎ ∿ ➤ ≋),
  start.md counts SIX tiles, display.md's Mobile section describes the
  edge-dock law and fullscreen help, its Wireframe row names the w key.
  Pins: `e2e/phoneux.spec.ts` (@ui, both viewports: modebox top-dock vs
  desktop anchor through boundingBoxes, gizmoSize 0.6/1, help fullscreen
  fill vs capped desktop box, the w key through the ⚙ popover rows + h's
  law, the lift empty-state text); LESSONS: e2e reading the ⚙ rows must
  OPEN the popover first (`toggle-options` — ViewOpts unmounts when closed),
  and the pixel7 drawer of the v1.10 era is GONE (v1.11 dock-only layout).
  **SAME-DAY FOLLOW-UPS (we: "That still shows on top" — phone screenshot
  of the PICKED chip; "placing blocks on phone exclusively works on existing
  geometry, not on e.g. grid, preventing movement"):** (6) the PICKED-INFO
  chip (PickChip) joined the edge-dock law — its phone `bottom-[132px]` sat
  MID-canvas once the v1.11 dock took 38 % of the height; it is `bottom-2`
  (flush over the dock) on phones, the desktop top-right card unchanged.
  (7) PHONES FURNISH THE GRID PAD (Editor `narrow` state): in + Blocks,
  a ground pickCell hit (pad plane, +y normal → r.cell STANDS ON the pad)
  aims the brush ghost and lands a cell like any surface — the phone canvas
  makes an existing-geometry-only rule un-usable; DESKTOP KEEPS the v1.11
  constructor law (ground unfurnishable, the desktop legs of the pin
  assert it). Pins: phoneux chip-edge + ground-pad legs (phone: ghost on
  the pad, a pad tap lands exactly one block with mirroring ⊘; desktop:
  ghost null, click lands nothing).
  **MIRROR ONE AXIS AT A TIME (we: "The x axis is visible in a craft, but
  this isn't synced with mirroring! For now limit to one axis at a time"):**
  twin PAIR LIVENESS now keys off the SESSION axis alone — `twinPairsFor`
  filters `symAllowed(...)` to pairs whose mask is EXACTLY the session-axis
  bit (⊘ ⇒ none; multi-axis twist/point pairs are DORMANT). Every consumer
  (position/rotation writeback, palette paint, joint unison, selection
  glow, the ⇄ badge, the faux-mirror drift screen) follows automatically;
  setMirrorAxis repaints the selection so the glow/badge flip with the
  sheet. Placement auto-arms only when the craft's data mirrors across the
  CURRENT axis (Editor twins() already `includes(axis)`). The gold sheet
  the user sees and the propagation behaviour are ONE axis. Pin:
  views.spec axis leg (ISW pair live under x, DORMANT under z, WAKES on
  the return); mirror/sym/subride/gizmo gates green on the final tree.
- **v1.11 PLACEMENT REWRITE — place-then-transform + TRIANGLE PINS (we:
  "I am unhappy with how placing blocks work. The same for triangles. Remove
  the existing functionality and do a total rewrite; the bottom bar should be
  used only. Placing a block, you can choose to move/rotate/scale it; scaling
  means stretching in a direction. Also ensure mirroring is possible and
  easily switchable by axis, should be a visible widget for that showing if
  x/y/z mirrored. Placing triangles is done by putting down three points,
  which you can move around before and after placing all three of them, it
  should look like a pin, and an arrow should point down/up for the direction
  of the triangle, just like in-game. Choosing a block size before placing it
  shouldn't be a thing." + "sizing seems to be 'mirrored' if I resize in e.g.
  +z, then it also stretches the block in −z. That is undesirable.")**:
  (1) BLOCKS: the brush carries SHAPE+PAINT+MATERIAL ONLY — the size UI, the
  x/y/z + [ ] + s keys, the brush-chip and the phone steppers are GONE; every
  click lands a 1×1×1 cell, auto-selected, the modebox pops at it (Shift
  continuation + the ghost/red-ghost law kept). (2) The gizmo gained a third
  MODE `scale` (⤢, engine `gizmoMode` domain + the modebox `mode-scale` row,
  BLOCK-only — a component's widget never shows it, TGC reads scale as
  translate there, the game has no part scale): a gesture QUANTISES to whole
  cells and commits through `Engine.blockGizmoScale(ext, signs)` —
  DIRECTIONAL: the face the grabbed handle sits on MOVES, the OPPOSITE face
  stays anchored (the sign comes from which side of the proxy centre the
  press landed on, projected on the camera plane — TGC's axis is signless;
  the centre-frozen first cut was the "mirrored resize" complaint). Twin
  mirrors the sign on the session axis; collision refuses + snaps the widget
  back; live preview rides the placement ghost. (3) The dock's MIRROR WIDGET
  (`mirror-twin` ⇄ arm + `mirw-off|x|y|z` chips, lit chip = the plane, ⊘ =
  off) is the one visible axis switch (same engine value + localStorage keys
  as the ⚙ View rows — the old dock `block-mirror` toggle row is GONE, e2e
  re-pinned to mirror-twin). (4) TRIANGLES: PIN PLACEMENT — clicks drop
  draggable map-PIN meshes on lattice corners (engine pinGroup: needle cone +
  head + v0/v1/v2 chips + mint preview face + GOLD NORMAL ARROW at the
  centroid = the winding normal, the in-game direction tell), pins drag
  BEFORE the third lands (engine `onPinDraft` → React triDraft mirrors — the
  engine owns the drag) and AFTER the commit (`onPinEdit` → `setTriCornerAll`
  → bp + the changed doc fields + debounced merged reload; a refused
  32-slot/coincident move writes nothing and the reload's `refreshPins`
  snaps the pin back), the third click commits + the pins STAY; the tri LIST
  row puts pins on any committed triangle; Esc leaves; deletes drop the pins
  (splice-shift safety); undo clears pins. `cornerOf` snaps every drop.
  (4b) CENTROID WIDGET (we: "the centroid should allow rotating the triangle
  or moving it wholesale for all three pins, again using the sort of widget
  you can grab onto"): a pinned COMMITTED triangle wears the SAME
  TransformControls as a block, attached at its CENTROID with the LOCAL
  frame = the triangle plane (x = edge v0→v1, z = winding normal) — last
  owner in the gizmo chain (component → block → cluster → `syncTriGizmo`,
  entered from syncClusterGizmo's no-cluster branch; setPinEdit/clearPins/
  setPinDraft call syncGizmo so the widget lands/leaves with the pins). ✥ =
  WORLD translate, CELL snap → whole-cell `onPinShift` → shiftTriCells;
  ⟳ = LOCAL rotate → the engine quantises EVERY corner back to the lattice
  per objectChange (WYSIWYG storable pose live) and commits atomically via
  `onPinRotate` → tris.ts `setTriCornersAll` (refused window/coincidence =
  writes nothing, pins + widget snap back). Callbacks return success for
  the snap-back. The canvas tri-face select clears comp/block selection +
  pops the modebox (⊘ ✥ ⟳; no ⤢ — scale never applies to a triangle; in
  scale mode the tri widget detaches). Hooks `triGizmo()`, `triShift(d)`,
  `triRotate(axis, deg)`; pins: e2e builddock (widget shows on list-row
  select, wholesale move keeps per-corner deltas equal, 90° rotate + TWO
  Ctrl+Z steps back through rotate→move, Esc drops pins AND widget) +
  vitest `setTriCornersAll` (atomic write, refusals byte-intact).
  (5) The BLOCK widget now attaches in BOTH flavors (a placed block wears it
  immediately — the old detach-on-flip pin re-cut). Hooks: `pins()`,
  `pinPoint(i)`, `blockScale(ext, signs?)`; `blockGizmo()` carries `ext`.
  (6) SAME-BATCH FOLLOW-UPS (we: "I cannot move the pins in 3 dimenensions,
  nor do I have a gizmo for triangles" + "nor does it respect my place/edit
  mode. This is wrong" + "place/edit should be UNDER triangles… if place,
  triangles under place… blocks and triangles so disparate; merged" + "the
  mirror option is not understandable… add a mirror icon with a
  strikethrough, and x y z with mirror behind it" + "mirror for triangle is
  not placed. Button should exist to turn block to triangle… on its widget"):
  PIN DRAGS are 3D plane drags — the pin rides the CAMERA-FACING plane
  through its corner (screen drag = all three world axes, orbit = depth);
  ⇧ = axis lock on the world axis most facing the camera, plane normal =
  view−(v·A)A (A×view CONTAINS the view direction — edge-on to every ray,
  dead drags; and compute the axis delta BEFORE p.copy() — the aliasing
  zeroed every ⇧ move). THE FLAVOUR LAW in onBlockPick: ✚ PLACE clicks only
  place (species = tool: ▤ brush · ▵ pins; a prism face is just a surface —
  placement NEVER selects), ✎ Edit clicks select ANYTHING (comp ▸ prism ▸
  block, merged pick, modebox pops; sky clears all). Dock header hierarchy:
  flavour FIRST, species behind a ›, hint says "PLACE ▸ BLOCKS…". THE TRI
  WIDGET: `setTriWidgetOn(flavour gate, Editor effect)` + `syncTriGizmo`
  NEVER hides for a persisted 'scale' mode (reads as ✥; the user's stretched
  blocks left localStorage scale = "no gizmo for triangles") — scale-mode
  triangles attach as translate. MIRROR WIDGET = `MirrorGlyph` (ui.tsx SVG:
  dashed plane + solid triangle + reflected ghost, currentColor-lit; red
  strike line data-g="mirror-strike" on the OFF chip; axis chips wear the
  glyph BEHIND the letter; ⚙ rows share the language; testids mirw-* kept —
  text 'twin ON' assertions re-pinned to aria-pressed). TRIANGLE MIRROR
  TWIN: `mirroredTriangle(t, axis)` — corners g→12−g, v1↔v2 winding flip
  (det=−1 mirror flips the winding normal; the swap restores FRONT = the
  mirrored front), colours[2]↔[4] relabel, material/smooth ride; the Place
  commit batches [tri, twin] through appendTrianglesDoc. WIDGET ▵
  (`mode-tris`, block-owned only): `blockSkinTris(bp, bi)` = the hullify
  core with an `only` scope (census/culling global so glued walls stay
  culled; game outward+flat authoring) + `HullifyResult.tris`; the Editor
  appends via the funnel and splices the block (identified twin converts
  too, v1.8.0 rule); fully-glued block → toast, no write. Pins: vitest
  mirroredTriangle (corner-set mirror + numeric mirrored-normal check —
  toEqual distinguishes −0/0!) + blockSkinTris (isolated 12 / glued 10 /
  enclosed 0); e2e builddock (⇄ twin corners = 12−g set, widget ▵
  blocks−1/tris+≥6/one Ctrl+Z, ⤢+▵ absent on parts, FREE-3D drag: screen-
  vertical drag carries world Y, ⇧ moves EXACTLY the camera-facing axis,
  flavour law: Place-click drafts a pin (triHl −1), same Edit-click
  selects + widget). LESSON: e2e running WHILE editing = phantom failures;
  re-run flakes on the final tree before believing them. (7) SHORT WIRE
  LABELS (we: "labels on the wires are too long lowvoltage => lv, similarly
  hv, and ports should be short name. fl for fluid and it for items"):
  wireops `KIND_SHORT` (lv/hv/fl/it/data) + `shortPort(name)` (tokens on
  [-_. /]: lowvoltage→lv, highvoltage→hv, input→in, output→out, fluid→fl,
  item(s)→it, 'port' dropped, 001→1, joined '-'). `pipeLabel` shortens the
  ports (the single funnel → CABLES rows, the 3-D hover chip, the
  disconnect message); WirePanel prints KIND_SHORT/shortPort at its ~8
  display spots (testids + tooltips keep the VERBATIM names — cosmetic
  only, the file is untouched). e2e: wire.spec mirrors shortPort locally
  (the e2e tsconfig is nodenext and cannot import app modules — the
  allowImportingTsExtensions trick drags the whole app graph into node16
  checking); wiremodel.test.ts pins the pure pair (v1.11 describe).
  (8) AUTO-TWIN + ONE PLANE (we: "I created a triangle but it was not
  mirrored, but the craft has two mirror axes visible. This isnt how the
  game should work, nor our editor"): the twin arm is TRI-STATE
  ('auto'|'on'|'off', localStorage archean-app-plsym unset = auto). Auto
  arms mirrored placement (blocks, parts AND triangles) when the craft's
  DATA mirrors across the lit axis — Engine.craftMirrorAxes() =
  craftMirrorMask(components, symIdx) (gantry/airliner/badger: auto-lit;
  testframe 9000005001 + fresh crafts: mask 0 = auto-off, single
  placements). The widget lights `twin ·auto`, a click forces on/off
  (persisted 1/0). buildMirrorPlane draws ONLY the session sheet (the
  mask-union multi-sheet was the "two mirror axes visible" confusion —
  detected axes drive AUTO, they don't draw). The PLACE flavor still
  SELECTS direct component hits (v1.4 law — the pin-flow probe's
  pendingReal gate is a full-tier trick: LITE-tier crafts (gantry) never
  stream, pendingReal never drains → gate must go per-fixture). e2e: twin-
  sensitive specs arm via aria-pressed checks (never blind clicks —
  auto-lit fixtures flip blind-click semantics); twin-placement specs live
  on the gantry (auto-lit, LITE tier, blocks at fx≈0.51 — full-range
  probes only). (9b) PRISM TWIN PROPAGATION + FLIP + WHOLESALE-MOVE FIX
  (we: "when I moved a triangle, it didn't see it as mirrored" + "it should
  be possible to flip it just like the in game triangles, determining
  whether it goes outside or inside"): (a) THE FLIP — tri-edit `tri-flip`
  reverses the winding (v1↔v2 via setTriCornersAll) so the FRONT (colours[0])
  normal points the other way (outward ⇄ inward, the gold pin arrow
  negates); colours swap [c1,c0,c4,c3,c2] (front↔back, the v0-v1 ↔ v2-v0
  walls follow the edge relabelling). (b) THE UNIFORM MIRROR RULE for
  prisms: `triTwinIndex(bp, ti, axis)` (corner-SET reflection key, winding-
  agnostic so flips keep the pair; a drifted pair stops matching = faux-
  mirror) drives EVERY prism edit through `triTwinOf`: centroid shift (twin
  gets the MIRRORED delta: dt[a] = −d[a]), ⟳ rotate (twin gets the MIRROR
  CONJUGATE rotation qM = (w, −Mω): mirror-axis component kept, others
  NEGATED — a +90° y-turn mirrors to −90°; twin corners via rotateCornersQ
  about the twin's own centroid, lattice re-snap; vitest-pinned
  mirror-equivariance), pin drag (twin corner σ(i), σ=[0,2,1] = the
  mirroredTriangle winding swap, gets mirror(g)), flip (pair flips together)
  and DELETE (the twin prism goes too, sorted splice). **v1.11.0 FIX (the
  law above shipped BROKEN): `onPinShift`/`onPinRotate` ran the twin lookup
  AFTER mutating the self record — shifting the self first breaks the
  corner-SET mirror relation, so `triTwinIndex` found no twin and the pair
  silently de-paired (the D/E-era tests never pinned the twin half). The
  lookup now PRECEDES the mutation, and the twin write is precomputed on a
  CLONE — a 32-slot-window refusal on EITHER record refuses the WHOLE
  gesture (no half-moved pair). Pinned by builddock 'twin prism pair …
  (TODO D)' on a freshly PLACED mirror pair — the gantry's authored skin is
  a WELDED lattice and shifting one of its records tears the shared slots:
  welded skins are the wrong fixture for delta laws.** (c) WHOLESALE-MOVE
  BUG: `commitClusterGesture` ran on EVERY drag end (unguarded) and its
  syncClusterGizmo → syncTriGizmo re-centred the proxy BEFORE
  commitTriGesture read the delta → every widget drag committed a ZERO move
  (the pins animated, nothing stored). LESSON: shared TGC event chains
  require EVERY commit to guard on its own captured base — one ungarded
  commit in the chain silently resets the proxy for all later ones.
  (9) SINGLE MODE CONTROL (we: "not 2 sets of 2 flips which
  is insane" + "colors dont seem to apply to the triangles when picked" +
  "the Triangle/block placement and edit should be fit together, I dont
  like the pins X/3 placed, I want it simpler"): the dock's tool+species
  FLAVOUR×SPECIES pair is GONE — ONE persisted tri-state `ws`
  (archean-app-ws: 'blocks'|'tris'|'edit', default edit): the two species
  buttons ARE the place modes, ✎ Edit is "neither". Derived `tool`/
  `blockSub` shims keep every internal reading its old vocabulary (zero
  churn in the routing code); testids ws-blocks/ws-tris/ws-edit replace
  tooltab-*/blocksub-*. In ws-edit the dock STACKS both workspaces (one
  merged scroll) and the canvas selects anything; tri SELECT (canvas or
  list row) is EDIT-mode only (the centroid widget gate is ws==='edit'),
  place-mode pin rituals stay in ws-tris. TRIANGLES INHERIT THE BRUSH:
  commit colours = [brush.slot×5] + brush.material (the hidden 5-slot
  triBrush was the "colours dont apply" trap — its rows in the pin card
  are deleted; per-face colours stay on the triangle's own editor).
  TriPanel takes tab for card voice (place = "click drops pins", edit =
  "select a prism to get its pins + widget"). TRIANGLE PAINT (we: "WHEN I
  PICK A COLOR FOR A TRIANGLE IT DOES NOT APPLY"): the 🎨 window had NO
  prism case — it silently painted the BRUSH; a selected triangle now paints
  through paintTri (all faces, bp + doc, the v1.6.1 funnel) and the
  triangles dock shows the tri-brush paint card (SwatchGrid + material +
  slot) new prisms inherit. ✎ Edit docks STACK selection-first (a selected
  prism's editor leads the scroll; a selected block's leads when no prism
  is picked); block-list rows clear the prism selection (exclusive, one
  editor). Pins: builddock 'triangle PAINT' (tri-brush → slot 60 inherited
  on all five faces, num-front → 70 face edit). LESSON: two orthogonal
  binary controls encoding (mode × species) is a UX smell — one n-state
  control beats 2×2 flips. (10) NAMING + ONE MIRROR LINGO (we: "name it
  +Block and +Triangle, so its obvious its for adding" + "in the top menu
  Make it Modify not Edit" + "the twin versus no mirroring is the issue,
  thats duplicate lingo" + "I put on mirror X … no matching triangle was
  made"): dock modes read **+ Blocks / + Triangles / ✎ Modify** (testids
  ws-* unchanged), the TopBar mode tile is **Modify** (testid mode-edit);
  the mirror widget is ONE control — `Mirror: ⊘ x y z` glyph chips where
  picking a plane ARMS mirrored placement explicitly (an explicit axis on
  an unmirrored craft must twin — the auto state is only the default),
  clicking the LIT plane stops pairing, ⊘ kills the session mirror; the
  separate twin arm (mirror-twin testid) is GONE (specs arm via the
  armMirror helper reading mirw-* aria-pressed), an `auto` badge is
  informational. LESSON: one concept = one word — 'twin' leaked into the
  UI as a second name for mirroring and the user read them as two
  features. (11) SEALED LIFT + VOLUME-BLOCK EVERYWHERE (we: "lift should
  calculate from a volume block. Note we only look at enclosed
  blocks/triangles. Implement that, then use it" + "let the ellipsoid hull
  also have option for volume block; put it in the middle"):
  `atmo.sealedEnvelopeVolume(tris, blocks)` — block cells (occupancy
  mirrors included, a part's body walls the seal) + voxelised skin
  triangles (quarter-cell sampling in the dominant projection plane + a
  6-neighbour THICKENING so diagonal walls are 6-connected — the pairing
  the 6-connected outside flood cannot cross; plain half-cell sampling
  steps (1,0,1) and leaks), flood from the padded bbox rim, ENVELOPE =
  sealed interior + enclosing shell (an open structure floods through and
  yields NOTHING — walls alone displace no lift). LiftWidget uses it with
  the skin-divergence sum as the fallback display; markers (the Volume
  component) are NEVER trusted for the maths. The balloon tool's volume
  toggle is `showIf: () => true` now — every body (ellipsoid included)
  gets the choice; it rides the envelope CENTRE at the coupler facing up,
  gated by the 1-cell-under-skin margin (volFit). Vitest: closed 3³ shell
  = 27 cells, open box = 0, a 2.5 m triangle tetrahedron seals. LESSON
  (voxel sealing): pick your connectivities as a PAIR — 6-connected flood
  needs 6-connected walls; sampled surfaces are only chain-connected in
  26, thicken to fix it.
  Pins: vitest tris `setTriCornerAll` (all-axis move, refusal keeps the
  record byte-intact) + e2e builddock (1×1×1 lands, ⤢ stretch + DIRECTIONAL
  anchors: cell invariant on +z, cell+ext invariant on −z; ⤢ never on a
  part; MIRROR widget live; size UI count 0; pin 3-click + arrow + drag
  rewrites the stored corner, one Ctrl+Z per gesture; list-row pins + Esc)
  and blockedit (widget survives the flavor flip, scale mode answers).
  LESSONS: e2e suites running WHILE scene.ts edits HMR reload = phantom
  failures (the 3 pixel7 flakes re-ran green on the final tree); the pin
  commit + a following drag inside the 450 ms snapshot window coalesce into
  ONE undo group — pins that must undo SEPARATELY wait > 450 ms.
## v1.11 session — KNOWN ISSUES & UNPINNED TODOS (documented at the user's
## request 2026-10-25; the full green suite = the session's closing gate)

KNOWN ISSUES (accepted behaviours, costs, sharp edges):
1. [CLOSED v1.11.2] sealedEnvelopeVolume: WASM module + LiftWidget debounce
   (250 ms) — the giant's flood is ~110 ms once per edit BURST (was 219 ms
   synchronously per rev); over the 24 M-cell budget both paths honestly
   yield 0 (widget shows the divergence caption; lift rows hide).
2. Envelope = interior + enclosing shell ⇒ OVERcounts the true enclosed
   volume by roughly one wall layer; sub-3-cell cavities seal to 0.
3. SUBGRID nested blocks are NOT voxelised (bp.data.blocks is top-level) —
   a cabin walled by subgrid hatches under-seals (lift reads low).
4. Prism twin identification = corner-SET reflection match: duplicate
   identical prisms can cross-pair (first index wins); the key is
   winding-agnostic so a flipped twin keeps pairing (by design).
5. The mirror plane is the WORLD x/y/z 0-plane (game convention): a craft
   authored far off the 0-plane twins its placements far away — ⊘ for those.
6. AUTO twin arms on ANY craft whose part graph carries twin masks (gantry,
   airliner…): every block/part/prism lands as a PAIR until ⇄/⊘ says
   otherwise — asymmetric additions to a symmetric craft need ⊘ first.
7. X-ray ghosting rebuilds index-filtered clones per hover episode; the
   per-mesh reject is the mesh AABB (merged hulls = big AABBs, so the
   triangle test runs over the full mesh) — one-shot ~ms, accepted.
8. X-ray overlays restore on hover-clear/change; a scene reload DURING an
   active X-ray leaves restored geometry on stale mesh objects (the next
   hover-clear cleans the overlays; no corruption observed).
9. Lift/cost readouts live in ⌖ Info ONLY; the + Parts dock is 3 cards in
   a 38 % shell (scrolls on phones).
10. Modify-mode part clicks AUTO-JUMP to + Parts (user rule) — the dock
    switches under the cursor by design; gizmo + modebox work identically.
11. A wire sweep under 120 ms never shows the chip (intended dwell); every
    fresh 2 s dwell re-fires the cursor-surge + X-ray (intended).
12. The MODEBOX floats over its part and SHIELDS the canvas: a block face
    under a fresh placement's widget swallows pointermove (no brush ghost)
    and clicks (mode-rotate gets the press, the block never selects).
    Specs close it with a SKY click first (v1.11.0 lesson).
13. Re-clicking the ACTIVE mode tile drops to ⌖ View (clean canvas-focus
    mode, TopBar law) — helper `mode-edit` clicks must be conditional
    (paint.spec toBlocks checks the `on` class first).

UNPINNED TODOs (shipped this session, lacking e2e/vitest coverage):
ALL SEVEN ANSWERED + THE SWEEP ADJUDICATED (v1.11.0 release session,
2026-10-26 — the pins landed, the drifted 5213-era specs re-pinned to the
shipped dock law, and the release-cut suite ran green; see the
v1.11.0 THE GREEN GATE bullet at the top of the v1.11 bullets):
A. Sealed-lift UI: `lift-sealed` badge + Info-dock card grid (desktop
   3-col / phone 1-col) — pinned in sphereskin (sealed badge on a built
   ellipsoid) + panels (vessel-stats grid columns per viewport).
B. X-ray precision: pinned in wire.spec (truck 2 s dwell: blocked cable
   cuts>0, exposed cuts==0, full restore on un-hover; the engine
   begin/end seam pre-selects the fixture deterministically).
C. Surge-from-cursor: pinned in wire.spec (≥2 surges at the X-ray
   transition — one pulse each way from the cursor's anchor).
D. Prism-pair FLIP propagation + twin MIRRORED-SHIFT delta: pinned in
   builddock (gantry pair: shift sends the twin the x-negated delta, the
   flip negates BOTH winding normals, one Ctrl+Z restores both).
E. Twin-aware prism PAINT: pinned in builddock (gantry pair, num-front
   70 → the twin record's colours[0] = 70, identity face mapping).
F. Ellipsoid body + volume-block toggle: pinned in sphereskin (toggle
   visible on the round hull + ONE Volume lands at the envelope centre —
   the skin-only commit path now honours it, headroom-gated like the
   tail batch).
G. `modify-hint` + per-kind editor reveal: pinned in panels (Modify
   opens EMPTY, block pick reveals the block editor, part pick
   auto-jumps to + Parts with the inspector, sky pick returns the hint).
H. @slow suites: gizmo/sym/subgrid/models gates re-run green on the
   final tree; the matrix/solo DEV-SCRAPE rituals compare against
   viewer.xenontools.dev and are NOT re-run per release (game-side
   drift only — the v1.11.0 palette law came FROM the dev sources).
I. SKIPPED AT SESSION CLOSE (2026-10-25) → ADJUDICATED (v1.11.0 release
   session): the quiet `-j 2` re-run proved the FOUR reds were REAL
   spec drift, not contention — the 5213-era specs predate the shipped
   dock law (`tooltab-*` renamed to `ws-*`; ws-switches RETIRE the
   species selection; block/tri LISTS live in their place-mode panel;
   `row-s-x`/`row-x-x` inspector pos/rot rows are GONE — the gizmo
   supersedes them; the re-click-active-mode-tile drops to ⌖ View).
   Re-pinned across blockedit/builddock/paint/panels/mirror; the
   blockedit:122 `x1−x0 = 0` red was a SPEC bug (`setFilePosAxis(ci, 0,
   v)` with a NUMERIC axis — position is a closed {x,y,z} node, the
   write added a stray "0" key = silent no-move + file corruption): the
   engine now GUARDS it, and three specs pass `'x'`. Two timing laws
   (AGENTS v1.11 (6) LESSON): edits inside the 450 ms snapshot window
   coalesce into ONE undo group — spaced pins with 600 ms waits; and
   tiny face targets need face-INTERIOR pixels (the ±2-px cross answers
   the SAME block) + a SKY click to close the modebox before a pick
   under it (it swallows pointer events).
- **v1.11.0 THE GREEN GATE — 5213-era specs re-pinned to the shipped dock
  law + the ellipsoid VOLUME wired (2026-10-26, the release session)**:
  the release-cut full suite exposed the placement-rewrite drift the
  session-end note suspected (see the UNPINNED list I above): (1) the
  vocab: `tooltab-*` → `ws-*`, the mode row is `+ Blocks/+ Triangles/+
  Parts/✎ Modify`; (2) SETWS RETIRES the species selection — every spec
  that flipped ws-flavors expecting the selection (and its editor) to
  ride now asserts IN the place-mode workspace (the auto-selected
  placement wears the editor there); (3) the LISTS live in their panel —
  ws-edit shows ONLY the picked kind's editor (the tri list rides
  ws-tris/the revealed triPanel; the 241-row gantry list VIRTUALISES,
  filter through `tri-list-search` before aiming at a row); (4) the
  modebox shields the face under it (KNOWN ISSUE 12) and the active-mode
  tile re-click drops to ⌖ View (13) — pick helpers close the widget
  with a SKY click; (5) `setFilePosAxis` takes a STRING axis — three
  specs passed `0`, the write landed as a stray `"0"` key in
  `comp.position` (silent no-move + save corruption); the engine now
  hard-guards it; (6) the label-scrub pin moved from the REMOVED
  inspector pos rows to the block editor's `size x` Num (the scrub law
  is a Num component, not an inspector row). LESSONS PINNED IN CODE:
  face-INTERIOR pixels for tiny targets (±2-px cross answers the SAME
  block — the blockplace law, now in paint.spec's pixelOfBlock), 600 ms
  spacing where each step must undo SEPARATELY (the 450 ms snapshot
  window), the ghost-VALID walk before a brush click (a face exactly on
  a lattice plane degenerates the ghost cell INTO the block — the red
  ghost refuses the click), and the triPick probe for selecting a
  SPECIFIC prism. **THE ELLIPSOID VOLUME (we: "let the ellipsoid hull
  also have option for volume block; put it in the middle")**: the
  toggle's `showIf: () => true` was SHIPPED showing it on every body,
  but the SKIN-ONLY commit path (fins off) silently ignored it — the
  volume block NEVER landed on an ellipsoid. `commitBalloon`'s skin-only
  branch now lands the ONE Volume at the envelope CENTRE (corner-mean of
  the built skin, riding 0.187 m up, headroom-gated `ry/0.25 − 2.25 ≥ 1`
  like the tail batch, through the v1.6.1 doc funnel) and says so in the
  toast.
- **v1.11.0 THE GAME-DAYLIGHT COLOR LAW (we: "the american truck doesn't
  render red properly, it contains all manner of wrong colors. Must be a
  palette issue: also affects Chip's badger doors in his latest version. Use
  XenonViewer of dev to establish proper colors.")**: the XenonViewer sources
  (js/palette.js, js/blueprint.js, js/scene.js, js/viewer.js — fetched
  2026-10-25, NOTICE §2) pinned THREE laws, all landed in BOTH engines:
  (1) **ONE built-in palette table** — the dev's (families 40 matte /
  80 polished / 120 metal / 160 glass, 17 contiguous colours each, slots
  0..10 engine-reserved, every other slot NULL, and
  `resolvePaletteColor` (blueprint.js:85-100) applies NO remap to any
  generation). Ours sat the families at 84/128/172 with the paired
  +4/+8/+12 `legacySlot` (v1.5.11): the shift+shift composition made
  palette-LESS v1 files read RIGHT (the truck's cab = polished 85 =
  [16,1,1] candy red all along — 85→89→[16,1,1]), so the v1 renders were
  never the bug, but every PALETTE-CARRYING file reading built-in slots
  84..96/128..144/172..188 read the family SHIFTED (slot 92: we dark green
  [1,8,1], the game polished yellow [255,255,16]) and our table carried
  entries at 97..100/137..144/177..188 where the dev's is NULL (real
  missing slots lost their marker). Table aligned verbatim;
  `legacySlot()` = IDENTITY (kept as the GENERATION seam for normalize's
  embed + the wheel-droop gate). (2) **PER-BUILD PALETTE SCOPING** — the
  Badger's doors are NESTED Build skins whose OWN palette slot 12 = painted
  deep red [32,2,2]; the app fed the TOP-level palette (slot 12 CLEARED)
  into nested `buildSolids` → magenta doors in our viewer, red doors in
  XenonViewer (`readPalette(buildData.colors)` per build, blueprint.js:172).
  THE v1.10.2 RE-DIAGNOSIS (standing): "the file palette carries 0 at slot
  12 while faces reference it" looked one palette UP — NO top-level face
  references slot 12 (census), so the Oct-24 byte-repair whitened an
  unreferenced slot, Chip's newest file (2026-10-25, in
  workshop/content/2941660/3326372833) carries the same nested paints, and
  the doors stayed pink for the real reason. A magenta face = cleared slot
  IN THE PALETTE THAT FACE'S BUILD RESOLVES THROUGH — check the owning
  build before repairing any file (no repo testdata bytes were touched
  this time). (3) **THE RENDER LAW** — XenonViewer: `LinearToneMapping` @
  exposure 0.9 ("ACES compressait et désaturait tout; un mappage linéaire
  restitue les aplats"), PMREM'd DAY-SKY environment, full-day rig
  hemisphere 0.35 / sun 1.0 / fill 0.12 / bounce 0.10 / build-sized
  RectArea softbox 0.14, `envMapIntensity` 1 on EVERY material
  (pbrMaterial sets none). Ours was a ~2.1× over-lit studio (hemi 1.1 +
  sun 2.2, no tone map, RoomEnvironment env on metal only): the iso-framed
  truck render read 31 % white pixels vs the dev's 1.7 %, deep-red class
  mean (86,55,55) vs the dev's (66,36,26). Aligned: the re-shoot reads
  (65,35,24) — dev-mean. LESSON: palette LINEARITY was pinned since v1,
  the tone map + light intensities + environment were never transcribed —
  a correct albedo table under the wrong rig still reads as "all manner of
  wrong colors". XenonViewer caveat: it DROPS v1 `[slot,slot]` comp colours
  (blueprint.js:322 array→{} → white/grey defaults) — NOT the law: the
  game's own v1→v2 re-save (3812927875 spells ISW's `[51,3]` as color1
  {1,1,12} = slot 51's matte navy verbatim) proves slot pairs are real
  paint; normalize's dict-conversion stays. Pins re-cut: palette.test.ts
  (truck/badger real slots, dev null-gaps, identity legacySlot, per-build
  scoping), normalize.test.ts (embed lands at the file's OWN indices),
  materials.test.ts (env 1), viewer/tests.js ok9. Targeted e2e
  (viewmenu/paint) green — the viewmenu ortho-dome pin was ALREADY RED on
  HEAD (pre-existing flake, verified by stash-baseline run).
- **v1.10.7 PHONE BUILD UX (we: "On phone I've no idea how to place and the
  side panel is still edit/place toggle, which makes no sense. It's also far
  too wide on phone")**: (1) the ✎ Edit | ✚ Place flavor switch MOVED from
  the sidebar crown into the BUILD-DOCK HEADER (it sets what a canvas tap
  DOES — it belongs with the workspace; the phone drawer used to be the
  only place to find it, and its backdrop covering the dock made every
  dock tap a drawer dance). `place-mirror` (panel) is GONE — the dock's
  ⇄ twin row is the one mirror toggle (brush + held parts + edits). The
  Panel keeps `tool` for its Catalog/Parts heading. (2) THE DRAWER is
  `w-[68vw] max-w-[300px] md:w-[300px]` (was 300/85vw — the 412 px phone
  lost 73 % of the screen; now 68 % drawer, 32 % live canvas). (3) TOUCH
  PLACEMENT: the brush axis chips gained −/+ **steppers** (`brush-step-{ax}-m/p`,
  value span `brush-size-{ax}`) — the touch twin of the v1.10.6 keys
  (shared brushAxis/brush state; ▣ square / 1×1×1 by tap); the dock
  `flavor-hint` and the `brush-chip` are DEVICE-HONEST (hidden md:inline
  key text / md:hidden TAP wording — innerText excludes the hidden span,
  pins assert 'TAP' on pixel7). e2e: phone flow re-pinned across
  place/mirror/mirror-mismatch (dock-header clicks happen with the DRAWER
  CLOSED — the backdrop `panel-backdrop` intercepts dock taps on phones;
  assertions through Playwright visibility pass behind the drawer, CLICKS
  do not; FLIGHT/Wind panels live in the sidebar = open the drawer for
  those tiles), builddock gains the phone pin (dock-header switch visible
  without the drawer, drawer ≤ 72 % viewport, stepper taps → chip 1×1×4 →
  square 4×4×4 → reset, a canvas tap lands a block). Lesson: canvas
  FRACTIONS are not aspect-stable — the phone canvas resizes with the
  drawer dock, probe through engine pickers, never hardcode fractions.
- **v1.10.6 THE BUILD DOCK + THE SQUARE-BLOCK FIX (we: "UX is crap. Placing
  blocks isn't fun, and editing triangles also sucks … use the same kind of
  panel like for wires, also when placing we should be able to resize.
  Blocks don't currently let you make them square, just in 2 dimensions can
  you size")**: (1) THE SQUARE FIX — `blocks.ts setBlockField` capped every
  size at `12 − pos-in-frame` (assumed a block may not cross its 12-cell
  frame border). It may: the format's only storage rule is pos_* ∈ 0..12
  and the game's own files carry **26 053 blocks crossing the border**
  (max 16-cell spans; measured over testdata/) — a block at pos (10,6,6)
  grew in y/z but froze at 3 cells in x: the exact "2 dimensions" report.
  Now: sanity cap `BLOCK_SIZE_MAX = 24` (corpus max is 15 cells) on
  setBlockField + blockFromCell, Num fields follow. (2) THE BUILD DOCK: the
  Blocks/Triangles workspace moved out of the 300 px sidebar into a WIDE
  BOTTOM DOCK (`build-dock`, the wire-dock twin) — 3 columns each: brush +
  BLOCK CENSUS (families/materials/cells/⇄ conflicts — v1.11.2: the sweep
  is the O(n) indexed twinConflictCensus, the 800-block cap is GONE) │ the
  searchable BLOCK LIST (hover = gold 3D preview via the
  merged setBlockHighlight effect — a hovered row preempts the selection
  like wire previewHover; click = select; ✕ = the Editor DELETE path, one
  Ctrl+Z restores) │ THIS BLOCK (all edit rows + a shape-type chip row).
  Triangles got the same: SKIN CENSUS (n, Σ m², materials) │ TRIANGLE LIST
  (area · material · centroid, hover/click/✕) │ THIS TRIANGLE with REAL
  editing — the three corners as global lattice cells (`tris.ts triCorners/
  setTriCorner`, writer-style (frame, v) refactor, honest refusals: the
  frame-aligned 32-slot vertex window + corner folds), a ±1-cell MOVE per
  axis (`shiftTriCells`) and the smooth/flat shading row; every write
  mirrors ONLY the changed fields onto the doc (v1.6.1 rule).
  `ui.tsx Num` gained an EXTERNAL-commit sync (a field shows state — the
  keys/undo/twin writes repaint it; the local string survives while it
  carries the same number). (3) RESIZE-WHILE-PLACING: over the canvas in
  the Place flavor, **x/y/z** pick the active brush axis, **[ ]** (− =)
  shrink/grow it, **s** squares the brush; the `brush-chip` shows the live
  footprint and the ghost re-aims through the existing brush-change effect;
  the panel gains ▣ square / 1×1×1 + axis chips. Pins: vitest blocks.test.ts
  "SQUARE-BLOCK FIX" + tris.test.ts "panel vertex editing" (window/fold
  refusals keep the record byte-intact, shift re-anchors the frame, v near
  0); e2e `builddock.spec.ts` (@place @ui: dock columns, list select/✕/undo,
  keys→chip→panel fields→SQUARE ghost, a deck block grows to 10×10×10, tri
  list + ±cell round-trip on global corners + `refused` message). e2e
  re-pins the dock implies (canvas shrinks): blockplace.spec hosts on
  9000005001 (ISW's blocks sit under its skin — 1-px faces on the shorter
  canvas), its probe takes only face-INTERIOR pixels (the ±2-px cross
  answers the SAME block — silhouette-rim pixels are face-unstable), the
  Shift pin pairs ghost+pickCell in ONE rAF poll with a size-consistency +
  two-frame-stability gate, and the family law is pinned per family (a
  sub-pixel camera-damping drift flips which face the click aims);
  panels.spec re-probes the component pixel after the mode flip (the canvas
  resized) through pickCell (the click's picker — a pickAt 'comp' behind a
  skin prism selects nothing); mirror.spec's phone probes widened + the ⇄
  row (now in the dock) is clicked with the drawer closed; gizmo.spec's
  modebox tap PROBEs a pickCell-verified part/block pixel (the fixed
  center ±8% offsets fan wider with the short canvas's aspect and all fell
  on skin prisms/ground — canvas fractions are NOT aspect-stable). Env
  note: asset-space's SOLO fixtures (90000030NN) live in the machine-local
  corpus, not testdata — a worktree needs the gitignored `blueprints.conf`
  copied in (the §Blueprint folder hierarchy working as designed, NOT a
  code failure; 40 s `?craft=` open timeouts + findIndex −2 = corpus miss).
- **v1.10.2 THE PANEL LAW — the subgrid axis statute (we: "only one of the
  two doors rotated wrong … also the color is not right" — craft 3326372833
  Chip's Badger):** the game's OWN baked panel transforms settle the axis
  question the v0.174-177 triad could only approximate: 166 (subgrid,
  master) pairs across the corpus carry a rotated `Build.orientation`, and
  `tools/bench_census.py` proves its rotation part equals
  **`qAxisAngle(R(q)·C·ê, data.angle)` on 157 pairs, collinear 18/18 on
  rotated mounts** (old chain R·qAxle·ê: 9/18; triad-era R·ê: 0/18). So
  `jointChain` axis/slide = **R(q)·CONTENT·ê** (`CONTENT_KEY` = the
  C = Rx(−90) map x̂→x̂, ŷ→−ẑ, ẑ→+ŷ; x̂-invariant ⇒ Aileron/LinearTrack
  pins byte-identical); the .ini axle euler is NOT in the law; the hinge part's
  plug face IS its hinge line (XYQ's upright bench proves it — its old
  "car-door ±ŷ" pin was our artifact). Where a rotated bench exists,
  `captureJrefs.bakedAngle` reads the GAME's display angle off it (XYQ
  door 2: the game's mirror flipped the twin at save — data.angle +24.3
  shows as −24.3; we render the bench) and edits ride as deltas; the bench
  rotation's fixed line anchors parts-only pivots within 1 m (farther =
  construction ghost → raw axle line); THE PLATE LAW v2 node formulas
  `v = baseQ⁻¹·ê`, `d = ê` keep the part's plate on the same line;
  `jointNodeAxis/Slide` consumers unchanged. Balloon tail mounts re-solved
  to the statute (v1.9.x's lying-tower/plug-down design is geometrically
  impossible under it — the plug normal IS the spin line): all three fin
  hinges are now one UPRIGHT half-turn mount {ax:−ŝ, ay:û, az:−t̂}, panel
  kinematics (v1.9.3's lying-axis scissor sweep, plate-on-own-axis)
  re-pinned + green; sphereskin e2e centroid check re-cut to the VERTEX
  MEAN (the union-box centre is plug-dominated, by design). Golden net:
  vitest `BENCH CENSUS` replays every committed testdata bench pair.
  Run the census via `python3 tools/bench_census.py` before touching ANY
  subgrid axis code; FORMAT §Subgrids "THE PANEL LAW" is normative.
  COLOR half of the report: the Badger's file palette carries `0` (CLEARED)
  at custom slot 12 while 41 skin-triangle faces still reference it — the
  app's (and XenonViewer's) magenta missing-slot marker painted the door
  pink; the game shows the engine default (light neutral — verified
  against our in-game screenshot). Fixed IN THE FILE (client/blueprints
  save, byte-safe palette edit, original preserved as
  `blueprint.json.bak-slot12-20261024`): slot 12 := the slot-0 white
  default. Standing rule: a magenta craft face = EMPTY palette slot in the
  file; repair the data (the marker itself stays — it still catches the v1
  family-base class). IndexedDB revalidates the edit via the v1.9.4 stamp
  (chip goes stale → Download latest).
  [v1.11.0 RE-DIAGNOSIS: the diagnosis looked one palette UP. NO top-level
  face references slot 12 — the doors are NESTED Build skins resolving
  through their OWN palette where slot 12 = deep red [32,2,2] all along;
  the app was feeding the top-level palette (slot 12 cleared) into nested
  buildSolids. The file repair whitened an unreferenced slot (harmless,
  kept), and Chip's newest publication showed the pink doors unchanged.
  The fix is per-build palette SCOPING in the engines (see the v1.11.0
  GAME-DAYLIGHT bullet + FORMAT §Subgrids "PER-BUILD PALETTE SCOPING");
  "magenta = cleared slot" still holds — in the OWNING build's palette.]
- **v1.10.1 THE LOGICAL WIRING MODEL + WIRE workspace (we: "the wiring is very
 naive and stupid right now. The auto-wire observed patterns is wrong, and I
 want to be able to disconnect/reconnect wires and get a better overview …
 on mouse-over of a cable it should tell us where things are going … the
 automatic wiring in the zeppelin rudders … connects every single port on the
 LV junction, and it ignores the fact the rudders should only take input, not
 deliver into the junction, that should be left open … candidates logically
 listed by distance and normal association … This shouldn't take precedence
 though — ensure logical wiring decisions are possible for users"):** the
 game's ADAPTER NAMES are the semantics (whole-game .ini census: `in`/`input`
 and `out`/`output` are the ONLY direction tokens; DataBridge literally names
 `data-computer.1`/`data-device.0`). One pure module owns it all:
 `app/src/engine/wiremodel.ts` — `portRole` (in|out|any from the NAME),
 `compGroup` (source|hub|device per KIND — PowerConverter is an lv SOURCE and
 an hv DEVICE), `hubInputIndex` (a hub WITH an input port has downstream
 outputs; a bridge's port1/port2 are two-way), `compatible` (never in↔in /
 out↔out; a hub INPUT never faces a device; a junction output never points at
 a source — THAT is the rudder/junction bug; power never device↔device;
 neutral fluid/item ports need a junction), `candidatesFor` (tier 0 = the
 game-named association, tier 1 = legitimate alternatives, distance ONLY
 WITHIN a tier — an ORDERING, never a filter: every compatible port stays
 pickable and `makePipe` runs no role check, a manual pairing is law).
 Auto-wire v2 (wireops.ts) runs staged phases per kind through that matrix
 and **NEVER force-pairs leftovers — an unsatisfied port stays OPEN with an
 actionable reason in Warnings** (the old "last resort: any port" pass was
 the junk wiring); existing cables are never touched (button-only, idempotent;
 naive nearest-pair stays as the labeled fallback). WIRE workspace: CABLES
 list (`Type[9].port ↔ Type[0].port` rows, hover gold-lights the cable in 3D
 via `Engine.setPipeHover`, ✕ DISCONNECT per row), THIS-PART port rows with
 partner + ✕, reconnect through the ranked candidate flow, NETWORKS overview
 (per kind, connected groups ordered sources→hubs→devices via `wireNets`),
 viewport HOVER chip `wire-chip` ("Propeller[9].lowvoltage ↔
 Computer[0].data_port.001") — `pipes.ts pipeAt()` ray-to-polyline pick with
 per-run `radii` + `piOf` (net index → data.pipes index; degenerate runs
 shift the arrays!), `Engine.pipeHoverMove/pipeScreenPoint`, Viewport reuses
 the coord ~40 Hz throttle, the overlay rides `root` (moff). Disconnect is a
 bp+DOC write (the doc is the save and the undo history — v1.6.1 rule; the
 e2e pins cut → net rebuild → Ctrl+Z restores). The balloon coupler filter
 now asks `portRole(name)!=='in'` (was the hardcoded `lowvoltage-input`
 name). Pins: vitest `wiremodel.test.ts` (naming census, role table, matrix,
 ranking, THE RUDDER REGRESSION: hinge ports only ever meet hub outputs, the
 input only faces battery/hub), `pipes.test.ts` pipeAt group (ray clamps,
 tolerance, piOf), `gallery.test.ts` re-pinned for the hidden trio (hidden ≠
 gone: craftFile still resolves); e2e `wire.spec.ts` (@ui both viewports:
 list format, hover chip = `__ARCHEAN__.wireHover()` label, row-hover 3D
 highlight, disconnect→undo, RECONNECT onto the same two ports, auto-wire
 idempotence, phone fit). Lesson: JSX collapses a newline between `{name}`
 and `<span>` — list labels need an explicit `{' '}` or textContent locators
 glue name+kind together. FORMAT §pipes carries the normative write-up; help
 topic `wire.md` retold (search words disconnect/reconnect).
- **v1.8.6 THE SKIN TRANSFORM CUTS, NEVER DROPS (user: "a valid
 zeppelin suddenly misses a face after rotations … the size doesn't inherently
 change"):** the frame-aligned 31-slot window is a FRAME law, so a face with
 span > 20 cells encodes only while its `min` sits low inside its 12-cell
 frame — a ⟲ quarter-turn or a cell drag keeps the SPAN but re-places `min`,
 and `transformSkinTris` (shared by `Engine.clusterGhostRotate` and
 `shiftSkinTris`, the balloon/sphere commit's offset) used to DROP those
 images: holes in the ghost PERSISTED into the built file and every undo
 snapshot (measured: the 12×8×12 cyl+nose spec has 32 fat faces, a z+2 shift
 or a rotX about pivot 7/11 lost 4–6 of them). Now: encode-else-`splitRec`
 (the shipped midpoint splitter) with a RECORD PAINTER (`reencodeSkinTri`) so
 pieces re-wear the source's colours[5]/material/smooth verbatim — faces that
 already encode stay byte-identical. `balloonfin.mirror()`'s
 `encodeSkinTri(...)!` (same class: x → 2c−x moves `min` too, so the L twin
 could push `undefined`) is encode-else-split `flatMap`. **SECOND DEFECT found
 while pinning (the file-level hole):** `commitBalloon` transformed the whole
 ghost list once then SLICED it by the STAGED group sizes — splitting ADDS
 records, so every later boundary drifted (fin pieces into the skin, panels
 into the wrong Build, the tail off the end: ghost 960 faces → file 942). The
 batch now maps EACH GROUP through the recovered `ghostMap` on its own
 (`paintGroup`), so a split stays GROUP-LOCAL; the `take()` cursor is gone and
 the `balloon.skinCount` count contract is DELETED from `PlacePayload` so it
 cannot be resurrected (tooldoc's payload simplified with it).
 **Standing rule: any helper mapping stored skin records through a POSITION
 change treats the window as something to CUT, never to filter — and never
 slices a transformed list by pre-transform counts.** Pins: vitest
 `splitface.test.ts` "transformSkinTris NEVER DROPS" (non-vacuous fat premise,
 every shift/quarter-turn keeps length ≥ base + every piece encodes + the
 summed signed AREA vector within 1 % + 64 cells² — a split moves it ~6, a
 dropped fat face hundreds, thin crafts vertex-exact, pieces re-wear the
 record's paint, shift round-trip), `balloonfin.test.ts` (big-zeppelin tail
 batch complete, no undefined, every record in its own window), e2e
 `sphereskin.spec.ts` "rotate + drag a big balloon" (⟲Y + a 5-cell drag ⇒ the
 FILE's area, top-level PLUS nested Build triangles, equals the ghost's;
 discriminating — the old count-slicing fails it). `sphereSkinTris` routes its
 plan faces through `splitFace` too (already-valid faces are byte-identical,
 so every pin stands) and the hook `__ARCHEAN__.placeData()` exposes the
 ghost's live records = what ✔ Build writes.
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
  deck pair + side board). Landed as: the file→view quaternion = identity
  (raw), the four scene.ts gizmo/slider writeback branches collapsed to one
  law; the legacy flag now selects ONLY palette resolution (and the
  wheel-droop gate). The per-generation mappers and the `unityConjugate`
  alias were removed in the v1.9.4 cleanup — `toViewQuat` is the single
  raw seam. Fixture `testdata/9000005001` (this exact craft) +
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
npx vitest run load.perf       #   … the PERF harness: ranked load/per-rev loops
                               #   on corpus crafts (prints the PERF table;
                               #   numbers are transcribed into PERF.md)
npm run build:wasm             # rebuild app/wasm/seal.wasm (AssemblyScript;
                               #   run after editing app/wasm/seal.ts — the
                               #   binary is committed, sealwasm.test.ts
                               #   instantiates it and pins JS parity)
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

## Test-load stratification (v1.11.7 user rule; strategy moved to docs/TEST-PYRAMID.md, v1.12.1)

**The pyramid laws (docs/TEST-PYRAMID.md, 2026-10-26 — the plan to kill most
e2e tests; STATUS v1.12.1: Phase 0 + 2 LANDED, Phase 1 slice 1 (xray) +
Phase 3 jsdom tier SEEDED — vitest 717, matrix 277 runs):** L1 every law lives at the SMALLEST tier that can state it
(pure logic → vitest; scene-graph pose/pick/census → vitest once P7.1
lands; DOM/state wiring → jsdom component tests; ONLY pixels, real pointer
plumbing, IndexedDB/network, dev-pair stay e2e — every new e2e test carries
a `// e2e-tier because:` line). L2 fixtures beat corpora. L3 a flake is a
RE-TIER signal: migrate the pin down a tier in the same session, never heal
it with a longer sleep/jiggle-poll. L4 the pixel7 matrix is OPT-IN
(playwright.config `testIgnore` — a spec joins the phone matrix only when
it carries a device law). L5 migrations, not holes: an e2e leg dies in the
SAME commit as its lower-tier replacement reproducing the green values.

The full Playwright matrix (~20 specs × 2 viewports, engine-heavy scene
boots on software GL) is a machine-eater — the v1.11.7 session proved the
failure mode end-to-end: the truck X-ray census ran 24 FULL episodes
(geometry mutation + pulses ≈ 30-60 s of blocked page thread per census)
and a 60 fps bubble ticker saturated SwiftShader, so pins "flaked" only
in full-suite runs. Standing rules:

- **Gate ladder (what runs when):**
  - Per change: `npm test` (vitest pure core) + `npx tsc -b` +
    `npx playwright test --grep '<tags/areas touched>'` — the touched area
    only (the per-area + per-component grep rules above stay).
  - Per landing on main: the FAST tier `npm run test:e2e:fast` (all
    @slow inverted) — the DEFAULT release gate (release.sh's legacy
    selftest+regtest gate is separate and unchanged).
  - @slow (@models/@gizmo/@sym/@subgrid/@aero — the multi-asset renders)
    runs for the subsystems the change touches; a full @slow sweep only
    at user-facing minor/major (Y/X) boundaries, and the release commit
    notes the date of the last full sweep.
- **New e2e probes must be DRY:** the engine seam for a test scan counts,
  never applies (scene.ts `xrayCutsFor` replaced the census's
  begin/end-episode loop; `pipePickAt`, `pipeFlowDir`, `subStats` follow
  the same law). Census budget: < 5 s per page.
- **Animations declare a tick budget:** the flow-bubble ticker runs at
  ~20 Hz — a continuous 60 fps `needRender` during episodes is invisible
  to users on a real GPU and ruinous in headless harnesses.
- **Flake policy:** a pin that flakes under full-suite load gets a
  SELF-HEALING probe (re-anchor the pick through the engine's own pick
  law, jiggle-poll the assertion — see wire.spec's re-anchor loop + the
  BLOCKED-test poll) or gets SPARSIFIED (fewer viewports, capped scans).
  Never "fix" flakes by raising sleeps/timeouts.
- **FIXTURE-FIRST BOOT LAW (v1.12.1, we: "can we make a stripped-down
  truck version so it boots way quicker — as a default for any such
  test?"):** every e2e law states its BOOT CLASS; if the law is about
  GEOMETRY-LIKE-BEHAVIOUR (occlusion, sockets, joints, layout) and not
  about THAT craft's data, it runs on a GENERATED law fixture
  (tools/make_*_test.py → testdata/900000NNNN) exhibiting the law and
  nothing else — first specimen: wire-xray.spec.ts on 9000007001
  (4 cables, ~1 s boot) replacing the 375-cable truck @slow legs (15 s
  boots, 292-scan censuses). Real-craft DATA laws (socket re-seat on
  3481322297, rig chains) belong at the HEADLESS node tier, where the
  full blueprint boots in ~0.3 s (scene.headless.test.ts). A corpus
  craft in a browser test must defend why the fixture CANNOT exhibit
  its law.
- **CHAIN LAW (v1.12.1, we: "fuse tests in logical groups; one test
  asserting many things, without cutting itself short"):** tests sharing
  one boot + compatible state run as ONE test of named `test.step`s
  with `expect.soft(.poll)` — violations accumulate and report, the
  chain never short-circuits on a failed law; hard gates only for
  premise state (boot, episode-open). Each step restores what it
  mutated; the LAST step is the one allowed to leave pollution. Spec
  surgery uses tools/spec_ops.mjs (TypeScript-AST spans — string
  slicing broke twice on closing-indent assumptions).
- **MEASURED (v1.12.1):** fast tier 9.9 min → **2.5 min** — preview
  build boot 1823 → 900 ms (playwright.config webServer = `vite build
  && vite preview`, corpus routes via the plugin's preview hook,
  `E2E_DEV=1` escape hatch) + ANGLE-Vulkan on the iGPU (radeon_icd
  pinned, NVIDIA hidden — the tests/run_tests.sh trick); matrix
  394 → **215 runs** (fusion waves + fixture-first). workers 3 → 4
  (the "3 keeps the run honest" number was SwiftShader-era; on the
  preview+iGPU stack 4 measured −15 % wall, 5 a plateau, same green).
 - **MEASURED (v1.12.4):** vitest 737 → **766** (jsdom tier 2 → 7 specs:
   HelpDialog, StaleDialog, + ToolDialog, TopBar, CostWidget, LiftWidget,
   MirrorGlyph); matrix 215 → **200 runs** — tools.spec/cost.spec dialog
   + data legs retired to jsdom (L5-same-commit), subride.spec.ts
   DELETED (P7.1 slice 2: rig-aware audit bbox + the anchor-class law
   headless) — the **@models and @subgrid e2e tags are now EMPTY**.
   Session line 394 → 200 runs (−49 %).
 - **MEASURED (v1.12.5):** THE VIEWPORT-MOCK HARNESS (jsdom: vi.mock the
   Viewport — a props-recording stub + a Proxy fake engine fed through the
   real onEngine — and crafts.ts — testdata through the real openFunnel):
   the REAL Editor state machine mounts in jsdom. vitest 766 → **807**
   (pinedit.test 12 + editor.dom 13 + balloonskin.dom 4 + scene.headless
   20→29 camera/ghost/surge/label/exclusivity/mirror-axis/live-edit +
   tooldoc/liftwidget +3); matrix 200 → **147 listed runs** (session
   394 → 147, −63 %), fast tier 190 → 137 (wall 1.7 → 1.5 min; the
   "fixed ~40 s build share" first stated here was an INFERENCE —
   v1.12.6 measured 91 s = 23 s webServer ceremony + 68 s browser work,
   the build itself is 7 s, and the webServer now runs `vite build`
   directly). select.spec + liveedit.spec
   DELETED (whole files → headless + jsdom); builddock 34→16, sphereskin
   24→10 (the two 120 s twin legs + the 180 s big-balloon leg retired to
   pinedit/splitface/tooldoc pairs); engine/pinedit.ts = the prism
   uniform-mirror-rule pure seam. The surviving e2e tier = pixels +
   real-pointer rituals + integration + dev-pair (docs/TEST-PYRAMID.md
   v1.12.5).
- **WARM-BOOT FINDING (v1.12.1, we: "can we re-use and clean a headless
  chrome to reduce the per-test ~400 ms?"): measured — context+page
  creation is ~50 ms/test (not 400; +2 tests = +0.1 s), chromium launch
  is once-per-worker ALREADY, so the per-test cost is the ~900 ms app
  boot, which is Playwright's isolation model by design: the built-in
  `page` fixture refuses worker-scope sharing (type-level), and
  describe.serial shares the CONTEXT only — each test still gets a
  fresh page (a warm-page pilot measured exactly zero: the "warm" path
  silently never ran; the in-app card-swap only pays if the page truly
  persists). The sanctioned amortizer is the CHAIN LAW: one boot per
  compatible state group is how Playwright wants boots shared. The
  in-app craft swap (back-to-gallery → card) stays available as the
  scene-reload primitive INSIDE chains (no bundle re-parse within one
  page's life).
- **Sparsify backlog (v1.12.1 Phase 0 LANDED: the 16 zero-device-assert
  specs left the pixel7 matrix — 394 → 283 runs; the ladder continues in
  docs/TEST-PYRAMID.md):** the xrayCensus fixture-selection scan is paid
  once per spec, not per test; views.spec/phoneux.spec/panels.spec pixel
  overlap retires at Phase 3–4 (jsdom + device harness), pipes.spec +
  wire.spec hover-pick seam retires at Phase 1 (keep the node raycast).

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

## Known open issues
- Beacon "point forward" display convention (user): parked — blocked on an asymmetric
  probe craft (180°-quaternion z-sign ambiguity, see FORMAT.md).
- GAME-hullified saves vs our triangle decode (found 2026-10-24): the airliner's
  in-game hullify save (backup: client/blueprints/3309955432/*.bak) carries 53 235
  game-authored skin records whose per-axis `frame_*` (e.g. −11 on a side skin at
  x ≈ −4 m) decode as GIANT stray prisms under FORMAT §Triangles `world=(v+12f)·0.25−1.5`
  — the game evidently anchors hullify skins differently. Arbitrate against the dev
  viewer before supporting hullified saves visually; the coplanar-dashboard burial
  (v1.5.16 open problem) bites these files too.
- Data-source drift is the FIRST check when a craft renders differently in the dev
  server vs Pages: the dev corpus resolves through tools/config.py to the MACHINE-LOCAL
  in-game save dir while the deploy pins repo testdata — diff the two blueprint.json
  first (app/tools/livery.mjs arbitrates live: world boxes, face pixels, hull on/off,
  chromium/firefox, ANGLE vulkan/gl). SECOND check: the app's own IndexedDB craft
  cache (crafts.ts `archean-crafts`) — it serves opens with ZERO network requests,
  so it outlived Ctrl+F5, HTTP no-cache headers and server-side file restores
  alike (the airliner incident). NOW VALIDATED (see the v1.9.4 versioned-cache
  bullet): every copy carries rev+SHA-256, stale/unknown copies warn and the user
  chooses redownload-or-not, gallery chips show the state. Manual paths: File ▸
  'Refresh craft (redownload)' (file-refresh) or any fresh storage partition.
  stats().loads staying 1 with old data = served from IndexedDB, not the network.

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

## Test-size rule — ALWAYS as small as possible (user rule 2026-10-26)

**"Tests MUST ALWAYS BE AS SMALL AS POSSIBLE — unit tests or e2e tests."**
Every test runs at the SMALLEST tier that can express the law, in this
order:

1. **Unit test (vitest, plain node, no I/O)** — the DEFAULT tier. Any law
   about math, data, formats, transforms, state machines, parsing is unit
   testable; if it isn't, the code is too coupled — SPLIT the code (the
   REWRITE.md §P7 plan: SceneGraph/interaction clocks out of the renderer
   and React so they become unit-testable). Unit tests are milliseconds,
   deterministic, and their failures name the law instantly.
2. **Integration test (node, one dependency)** — only when a real
   collaborator is part of the law (fs round-trips, doc serialization).
3. **E2E (browser)** — ONLY for laws that physically cannot exist at any
   lower tier: rendered pixels, WebGL/shader behaviour, real input
   plumbing, and dev-pair audits (the other viewer is an external browser
   app). One e2e per such law, on the SMALLEST fixture that exhibits it.

Corollaries, always:
- **Fixtures beat corpora.** Synthesise the minimal artifact that exhibits
  the law (`tools/make_*_test.py` → `testdata/90000000NN` — e.g. x-ray
  fixture 9000007001: one wall + two cables replaced a 2 200-part truck
  spec). Real data is for the corpus sweeps (regtest, dev-pair audits), not
  for feature pins.
- **Never put a big craft in a test** unless the law IS size/complexity
  (LITE-tier merging, load budgets). Scene boot of the truck/giant costs
  seconds; every per-part scan multiplies it.
- A slow test is a DESIGN SMELL, not a budget problem: the fix is the
  lower tier + the smaller fixture, never a longer timeout.

## Conventions
- **Say "we / us", never "the user"** (2026-10-23) — in replies, commit messages,
  comments and docs alike; quoted history that already reads `user:` stays.
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

- **v1.12.0 BACKLOG — CLOSED at the v1.12.2 cut (2026-10-27):**
  (1) the pages dev-asset 404s — the deployed app index ships 4 asset refs,
  0 `?v=` refs; live probes: root/viewer/testdata all 200 (the landing's
  ?v= refs are gone). (2) the app.spec legacy-link pin passes (the link is
  the gallery's LAST testid) and Pages serves /viewer/index.html (200).
  (3) the release-branch strings rode the v1.12.0 cut (v1.9.11 drift is
  dead). (4) the @slow tiers ran at this cut: 11/11 green (subride's
  Jimmy leg fixed on the way — THE ANCHOR-CLASS LAW bullet). REMAINING:
  (5) the P7 test-pyramid migration (REWRITE.md / docs/TEST-PYRAMID.md
  phases — the ongoing plan, not release-critical).

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
