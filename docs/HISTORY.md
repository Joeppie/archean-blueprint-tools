# HISTORY.md — archive of dated session narratives (moved out of AGENTS.md 2026-10-28)

AGENTS.md keeps ONLY the living rules — the format law, the "never X" list,
the workflow. This file is the archive: the per-version build narrative,
superseded rulings, pin histories, and session closing reports, copied
**verbatim** from AGENTS.md on 2026-10-28 so every "why" stays greppable.

Read a section here when you touch its subsystem and need provenance —
never for orientation; AGENTS.md is the orientation.

## 1. The app build narrative (v1.4 → v1.13.x)
Per the user (2026-10-17) the React SPA in `app/` REPLACED `viewer/` as the
working app; the rewrite phases have since largely landed. The bullets below
are the session narratives exactly as they were written (each carried the
"## The rewrite (IN PROGRESS)" framing of its time).

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

- **v1.13.2 THE 25 Hz CADENCE + THE COCKPIT + BUZZERS + DASH FOCUS + MARIO
 (we: "dashboard that is 640*480 which is too small to read, when I click it
 becomes worse. No zooming … doesnt let you filter"; "pressing WASD u, down,
 and F should be given as inputs into the computer for all cockpit
 connections it has. This will allow us to simulate that"; "buzzers should be
 implement, with square/sawtooth, and the frequency"; "computers should run
 at 25 hz update cycles, not 10 hz"; "a deeplink ability to the specific
 dash as well as the super mario game by chip imported. That way, we can play
 super mario in our browser")**:
 - **25 Hz pump**: `CYCLE_MS = 40` (xenoncode.ts) is the single cadence; the
   shim gained `xc_set_cycle_ms` (ABI **5**) called at boot, so `delta_time`
   = 0.04 s and `system_frequency()` = 1/xc_dt (dt-driven programs — Chip's
   Mario physics `clamp(delta_time,0,0.12)` — run in REAL time; the baked
   0.1 s dt of the old wasm ran them 2.5× fast). tools/xenoncode/build.sh
   gained `git reset --hard $PIN` before the patches (they edit the checkout
   IN PLACE and are not idempotent — a second run asserted on its own
   anchors). WASM rebuilt with emsdk 4.x (upstream pin unchanged). THE
   CADENCE LAW: the VM cycles at 25 Hz, the REACT PANELS coalesce at ≤10 Hz
   (`notifyCoalesced` in the pump loop) — the Badger's 118 surfaces + ~100
   var rows re-rendered 25x/s starved the main thread (the suite caught it:
   'no prints yet' at 180 s); canvases still blit EVERY cycle.
 - **THE PILOT-KEY LAW** (engine/pilotkeys.ts + pump.pilotKey): while the ▣
   Screens dock or the IDE Screens tab is open, WASD/↑/↓/F drive every
   PilotSeat channel the running computer has, mapped by the GAME's channel
   words (wiki PilotSeat.md): Backward/Forward (W+1 run/S−1), Left/Right
   (D+1/A−1), Down/Up (↑+1 jump/↓−1 crouch) and Aux 1 (F = jump) — signs are
   the stick's, press = ±1, release CENTERS to 0. Pilot bindings are built in
   buildWorldSim (type PilotSeat × channels.json fn word, PILOT_KEYS). Keys
   never leak while typing (input/textarea guards); window-blur releases all.
   THE EDITOR-SHORTCUT YIELD: `pilotKeysActive()` gates the g/o/h/w/5 global
   shortcut map (the 'w' run key is NOT a wireframe toggle in a dash view;
   on a cockpit-less craft the keys pass through untouched). SPACE joins F
   as the same action button (aux 1 = Mario's jump, we: "we need to emulate
   space"). A BOUND cockpit channel RESTS AT ZERO at bind time (the
   telemetry-alive stick defaults would make a game craft run on its own).
   `detectChannels` now also captures **input_text** call sites — Chip's
   Mario gates ALL input on `input_text("gamer-chair", 0)` (the seat USER
   TOKEN); the shim stringifies a fed numeric, and the worldsim PilotSeat
   'Using' default '1' makes the game read SEATED.
 - **BUZZERS** (engine/buzzer.ts): the game's Buzzer (wiki
   components/miscellaneous/Buzzer.md) takes Amplitude ch 0 (0..1) +
   Frequency Hz ch 1 (0..20000, default 440) and plays sine/square/
   triangle/sawtooth (the component's V-menu tone type — one app-level wave
   choice, persisted); the io-bus rows the program writes
   (`output_number(alias|io, ch, v)`, key = RAW target verbatim + ':ch') ARE
   the drive values; one WebAudio oscillator per loud buzzer (the wiki's
   multi-tone law = multiple buzzers → Mario's melody+harmony+bass+effects
   chords work). Autoplay policy: sound starts MUTED, the 🔊 toggle in the
   Bus-tab Buzzers card (buzzer-sound/buzzer-wave-*/buzzer-row-<alias>) is
   the required gesture AND CREATES+RESUMES the AudioContext synchronously
   in the click (a context lazily created in the pump loop starts SUSPENDED
   and never resumes — "I dont hear the buzzers"). Pure law pinned vitest
   (`buzzerReadings`): silent when unwritten, 440 default, 0..1/20000
   clamps, alias AND io bus keys.
 - **THE SHIM SCREEN CAP = THE GAME'S CAP** (xc_host.cpp): virtualscreen()
   clamps at 10000×10000 like computer.md — our old 4096 cap TRUNCATED
   Chip's Mario `virtualscreen(10000, 600)` sprite atlas and every sprite
   past x=4096 smeared on screen (we: "when we get far in a level, things
   get smeared … not all of the graphics are being copied by our screen
   copy?"). Pinned: the Mario e2e asserts a virtual# ≥ 10000 wide is
   registered (__XENON__().surfaceMeta). E key → Roll (ch 5) = Mario's
   FIRE key (we: "we should have forwarded the e key as well" — the probe
   proved Mario reads ch5 = Roll, not Pitch) — nine bound keys total.
 - **v1.13.8 THE SPACE INVADERS ARCADE — a SECOND playable browser game
 (craft 3288012440, Shadoh's cabinet: Computer ci13 + PilotSeat on
 data_port.010 + 3 Buzzer + Lamp; we filed five issues: "can't give input
 via its computer", "it doesnt register the built-in screen", "can't give
 it input", "keyboard binds available also for the other keys cockpits can
 give", "the screen display is upside down")**:
   ① THE FULL-COCKPIT KEY LAW (engine/xenoncode.ts PILOT_KEYS +
   buildWorldSim): a cabled/aliased PilotSeat is now padded to ALL 18
   documented output channels (not just the ones the program calls
   input_number on — the Invaders game reads only ch 1/2/3, so Pitch/Yaw/
   Main Thrust/Aux 2..0 had NO row and their keys reached nothing). Binds:
   WASD stick, ↑/↓ up-down, **SPACE feeds Down/Up(ch 3) AND Aux 1** (the
   arcade "Press SPACE to play" is `input_number(10,3)==1`; Space was wired
   only to Aux 1 which the game never read → the reported dead input; Mario
   keeps F/Space on Aux 1 AND gets Space on ch 3 = jump), F Aux 1, E/Q roll,
   I/K pitch, J/L yaw, R main thrust, digits 1-9/0 = Aux 1..9/0. The global
   `5` ortho shortcut yields to the cockpit (pilotKeysActive, the 'w' law).
   Pure pins: xenoncode.test "THE FULL COCKPIT KEY LAW" (word coverage vs
   channels.json, Space→down/up, stick signs, the Aux ladder) + pilotbuzzer
   re-pin. e2e pin: xenon.spec "the Space Invaders arcade" (@ui: the ▣
   gate, all 19 keys bound, seat rows present, Space→down_up=1→0 on
   press/release, R→main_thrust).
   ② THE BUILT-IN SCREEN GATE (Editor.tsx): `hasScreens` = hasDashboards ||
   a Computer/Crafter deviceScreen — the ▣ Screens dock was ABSENT on this
   craft (the gate only knew Dashboard components; the ▣ dock is also what
   arms the cockpit keys). e2e-pinned (screens-btn visible).
   ③ THE SCREEN-QUAD UV LAW (scene.ts, BUILTIN_SCREEN_TYPES): v1.13.7's
   planar UV was a 180° rotation off for the Computer's baked quad class —
   the shipped `vax===1 ? vv : 1-vv` sat the framebuffer top on the panel's
   BOTTOM edge (upside down) and the plane-u mirrored it (in-browser
   verdicts, the arbiter, uniquely fix the law: shipped (u=uu,v=vv) →
   'upside down'; (u=uu,v=vv with V run WITH) → 'upright, MIRRORED' ⇒ V
   runs WITH its axis (vv) = upright, U runs 1-minus (1-uu) kills the
   mirror. A push that ALSO flipped V (`1-vv`) reproduced 'upside down
   (+mirrored, to the eye)' — the law is **u 1-minus, v WITH the axis**,
   keyed `c.type === 'Computer'` (NOT vax — the two device screens bake to
   different vax classes). The Crafter keeps its shipped mapping untouched
   (lit-pixel-probed only, orientation never judged — do NOT rotate it
   blind). LESSON: the built-in screen orientation is an in-browser pixels
   law — every headless metric (band-energy, ink-lum, canvas colour-split,
   pattern probe) was inconclusive through the three-basis bake; the human
   eye arbitrated. Flip ONE axis per round-trip: a two-axis build made the
   verdicts ambiguous and cost three extra cycles. Audit seam + probe kept: tools/invadersaudit.mjs +
   Engine.screenFeedQuads/projectCanvas/probeRect/screenFeedPixels/
   auditLookAt (counts/aims, never applies).
   PLAYTEST: `?craft=3288012440` → ▣ Screens (upright arcade screen) → WASD
   move the cannon, SPACE start/fire. Two playable browser games now (Mario
   3820116990 + Space Invaders 3288012440).
 - **v1.13.7 THE BUZZER BENCH + AUTOTEST PANEL (we: "I DO NOT WANT an
   integration test that runs the full mario game; instead just write a
   computer that outputs a signal to a single buzzer, and see if it does
   its thing … Future todo to document: a simple interface for automating
   that in the editor, almost like a scripting language … an interface for
   AI agents … Make a decent implementation for that too … so a craft can
   be diagnosed using that. Then document that on the github page")**:
   (a) the Mario full-game e2e leg is GONE — replaced by fixture
   9000008001 'Buzzer Bench' (tools/make_buzzer_test.py: one MiniComputer,
   one Buzzer data.mode 3 = sawtooth, one PilotSeat 'gamer' whose Aux 1
   the program mirrors into the horn amplitude; a virtualscreen(160,120)
   blinks so the first-virtual deep link + aspect law have a canvas;
   phase-free asserts, boots in seconds). (b) THE AUTOTEST: engine/
   xenontest.ts parses the script format (name / program: | / cycles /
   assert: bus("a",0) | amp | freq | wave | cycles | prints with the six
   comparison ops); pump.runCycles(n) advances EXACTLY n cycles with the
   rAF loop gated out (testGate — deterministic phase); pump.snapshot()
   = {cycles, prints, bus, devices[{alias,type,mode,amp,freq,wave}]};
   XenonDialog side tab 'Auto' (xenon-test-src/run/summary/result-i,
   preset for the bench) with program: booting through the SAME disk
   writeback (onFiles → VM auto-reboot); window.__XENONTEST__ =
   {run(text), snapshot()} — the AI-agent/headless door. Pinned: vitest
   xenontest.test.ts (parse + eval x7) + e2e 'buzzer bench' (@ui fast
   tier: deep-link focus, aspect, canvas paint, 5/5 PASS panel,
   programmatic run, cockpit mirror amp==0.8 via F, analyser
   outputLevel > 0.03 audio truth). (c) HELP topic xenontest.md
   ("Testing & Automating XenonCode — the Auto-test panel", SEO tags
   incl. AI-agent/CI/diagnostics, __XENONTEST__ contract) + README
   feature bullet — the GitHub-pages-facing docs.
 - **v1.13.6 SOUND ON BY DEFAULT (we: "it seems sound was off by default
   - at least in firefox, please make it on by default")**: BuzzerAudio
   defaults soundOn TRUE (localStorage 'archean-xenon-buzzer-sound'
   mutes only when explicitly '0'); buzzerAudio.arm() (Editor boot)
   installs capture pointerdown/keydown listeners that, at the FIRST
   real gesture, create + resume the AudioContext and play a 1-frame
   silent buffer (Firefox arms a context only when audio plays in it) —
   Mario's first jump press IS the unlock, no toggle hunt. The TopBar
   🔊 starts lit; the Mario leg pins aria-pressed 'true' on load and
   the outputLevel assertion proves the audio flows through the
   first-gesture unlock. Docs: xenon.md "Hearing it".
 - **v1.13.6 THE WARM VOICE (we: "something isn't right with the
   sawtooth/square sound ... in-game the sound is far closer to the actual
   super-mario")**: WebAudio's built-in square/saw are hard, band-unlimited
   shapes — the in-game buzzer path is dark and coarse (Unity synth,
   4-bit-ish amplitudes; the client binary is il2cpp-stripped, no enum to
   copy, so the fix is physical). buzzerHarmonics() bakes PERIODICWAVE
   tables (sine-series harmonics, 64-harmonic cap, gentle 1/n^1.1 roll-off)
   per tone, set per voice via osc.setPeriodicWave (switching live on
   wave/auto change); the master chain gains a 7.5 kHz lowpass
   (Q 0.7) before the compressor, and voiceGain quantizes amplitudes to
   16 levels (the game's coarse DAC path; MASTER_GAIN 0.4 → 0.5, the
   compressor absorbs chords). Pinned: harmonic-table laws + quantization
   (vitest x2). Also: panels 'panel editors chain' flake family HEALED at
   law level (hover → jiggle-poll → React mouseover fallback; L4
   describe-scoped retries:1) — the full fast tier green again.
 - **v1.13.5 AUTHORED BUZZER MODES + FIREFOX + 3-D SCREEN CADENCE (we:
   "the sound won't turn on in Firefox … the display of visuals in the
   screens of the craft feels a bit delayed compared to actual screen
   visibility … do the buzzers correctly do the saw tooth as the game
   expects? The sound is funky … component buzzer should have a better
   setting for its 'mode' so its named modes not just numerical
   values")**: (a) THE AUTHORED-MODE LAW: the component's data.mode
   (0 sine, 1 square, 2 triangle, 3 sawtooth — wiki Buzzer.md; Mario
   authors melody/harmony/fx square, bass TRIANGLE, effects SAWTOOTH)
   flows xenonDevices → XCDevice.mode → BuzzerReading.wave; buzzerAudio
   wave defaults to **'auto'** = per-buzzer authored tone (a named wave
   chip = global override); the inspector's Buzzer `mode` row is a
   NAMED-MODES select (data-mode, jsdom-pinned; the FILE stays numeric).
   (b) FIREFOX: the toggle plays a 1-frame silent buffer inside the
   gesture (Firefox arms a context only when audio actually plays in it)
   + a once-pointerdown/keydown resume + per-cycle suspended self-heal.
   (c) 3-D SCREEN CADENCE: the dashboard faces rode pump.subscribe (the
   ≤10 Hz notify) while canvases blit every cycle — visibly laggy; the
   pump gained addCycleHook (runs synchronously per cycle after surfaces
   update) and the Editor's 3-D LAW rides it. (d) Mario leg pins the
   tone table (buzzer-tone-game-bass triangle, -game-effects sawtooth,
   auto chip lit).
 - **v1.13.4 MARIO PLAYS RIGHT (we: "for supermario, it should actually
   focus on the first virtualscreen, also, that doesnt properly scale, it
   stretches it sideways when trying to maximise … I dont hear the buzzers
   … place a mute icon/sound icon near the 'view' buttons … which animates
   whenever any buzzer is making sound")**: (a) `?dash=first-virtual`
   sentinel — the dock switches to the Virtual tab and raises the FIRST
   virtualscreen's zoom window (Mario composes on virtual#0#0 900×600; the
   HdScreen panels are its physical mounts). (b) THE ASPECT LAW:
   ScreenCanvas fill mode sets height:'auto' — CSS width 100% with the
   height left at the canvas ATTRIBUTE stretched surfaces SIDEWAYS in the
   zoom window; pinned: the Mario leg measures the fullscreen canvas ratio
   == 900/600 at two zooms. (c) BUZZER AUDIBILITY: the probes proved the
   bus CARRIES the signal (game-melody 0.0675 @ 522 Hz during the level
   theme) — the silence was the old linear ·0.25 gain (Mario's ~0.09
   amplitudes ≈ −33 dB) + a toggle buried in the Bus tab; voiceGain()
   = min(1, amp·1.8)·0.4 (vitest-pinned). (d) THE BUZZERBUTTON (Editor,
   beside ⚙ View, `buzzer-toggle`): 🔇/🔊, shows only while the running
   computer has Buzzers, the click is the autoplay-safe AudioContext
   gesture, and it THROBS (.buzzer-anim CSS pulse) while buzzerAudio.level
   > 0 — the engine tracks `level` = the loudest live Amplitude EVERY
   sync, even on devices with no audio; `data-playing` mirrors it for the
   pins. (e) PHONE SPEED (we: "Mario also runs quite slow on the pixel
   phone … xenoncode might be slow, … might be the draw operations"):
   MEASURED with app/tools/marioperf.mjs (CDP CPU-throttle): the VM cycle
   dominates (20 cycles/s desktop, 11.2 at 6× throttle, canvases closed —
   the JS blit is NOT the bottleneck). Two shim fixes: screen_copy gained
   an INTEGER-BLIT FAST PATH for rot==0 (the bilinear float blend collapses
   to a row copy — 6×-throttled 11.2 → 13.9 cycles/s, +24%) and xc_cycle()
   feeds the interpreter the REAL ms between cycles (clamped to the game's
   own 0.12 s) — at 14 cycles/s the game now runs at 1.0× real time (a
   choppy 14 fps) instead of 0.45× slow motion. Real perf left on the
   table (measured, deferred): the XenonCode interpreter itself is the
   floor; a wasm build of the interpreter with SIMD blits is the next
   lever. No XenonCode emulation of the Buzzer component (deliberate:
   "We dont need to emulate their precise xenoncode for now").
 - **v1.13.3 THE TOUCH COCKPIT (we: "for mobile phone, overlay all keyboard
   binds as buttons that do keydown when pressing and up when letting go,
   so we can play on mobile, also on virtual screens. Make that overlay the
   screen itself, also when fullscreening a screen")**: PilotTouchPad
   (ScreensDock.tsx) — on `(pointer: coarse)` devices and only while the
   running computer has cockpit channels bound, every dash view rides a
   translucent pad: W/A/S/D cross bottom-left, ▲▼ E F ␣ bottom-right;
   onPointerDown = pump.pilotKey(k,true) (the keydown), pointerup/cancel/
   LEAVE = keyup (a finger sliding off releases — no stuck throttle). The
   pad rides the SCREEN: the fullscreen zoom window and every ▦ Tile-mode
   tile (plain thumbnails stay tappable to open the zoom, where the pad
   rides); virtual screens are ScreensCells → same law. useCoarsePointer()
   gates; desktop shows nothing. Editor gained the __XENON__ BASE debug
   hook (cycles/status/pilotKeys/world on ANY page; the IDE enriches it).
   Pinned: the Mario leg's phone context (412×915, hasTouch) — deep link →
   overlay pad, all nine buttons, pointerdown → gamer_chair row manual 1,
   pointerup → 0.
 - **DASH FOCUS + DEEP LINK** (we's 640×480 report): dock cells are
   ScreensCell — clicking a THUMBNAIL opens its OWN fullscreen ZOOM WINDOW
   (fit / 1:1 px / ± / pinch, scroll-pan, pixelated) and no longer fires the
   VM (a mis-click cannot press a button_rect under you; "when I click it
   becomes worse"); VM clicks land in the zoom window at 1:1 pixels. The ▣
   dock gained a FILTER box (screens-search, name+key). `?craft=<id>&dash=<
   alias%23channel>` opens straight into the dock with that surface's zoom
   window raised as soon as it paints (Editor dashFocus → ScreensDock focus
   → ScreensCell autoFull) — ONE-SHOT: consumed on open (a filter round-trip
   remounts cells; a re-armed autoFull raises the overlay and intercepts
   clicks — the Mario leg caught it). **▦ TILE** (`screens-tight`,
   localStorage archean-app-screens-tight): collapses gaps/padding/borders/
   labels to ZERO so multi-panel TV walls tile flush (we: "the spacing
   between dashboards should be collapsable to be zero, so they are
   super-smooth together, with a button"). The IDE screens panel search
   stayed.
 - **MARIO IS IN THE CORPUS**: testdata/3820116990 = Chip Patton's PKC-385
   "Super Mario Brothers [v1.1]" (workshop, imported committed like the
   xray fixture; ws-names.tsv titled): a XenonCode game on a MiniComputer —
   PilotSeat `gamer-chair` (ch1 run, ch2 move, ch3 jump/duck, ch8 jump, ch9
   run, ch5 fire, ch10-13 pause/restart/mute/select), 8 BUZZER components
   (game-melody/harmony/bass/effects/fx-*) driven by audio.xc, 6 HdScreen
   surfaces (`screen("screen",0..5)` → `screen#0..5`), sprite atlas via
   screen_copy + virtualscreen. PLAYTEST: `?craft=3820116990&dash=first-virtual`
   (the game canvas) → 🔊 → WASD/↑↓F. e2e: xenon.spec "dash focus + deep link + cockpit
   keys + buzzers: Mario plays" (@slow) — deep-link overlay, >200 lit title
   pixels, filter, 7 pilot keys bound, gamer_chair row manual 1/0 on press/
   release, buzzer-row-game-melody amplitude > 0. Unit: xenoncode.test pins
   the Mario fixture (seat channels 1/2/3/8 detected, >3 buzzers).
   Re-pins: `cycles N @ 25 Hz` labels/regexes; the 3381670618 button-click
   leg clicks THUMBNAIL → FULLCANVAS (VM clicks live in the zoom window).
 - **NOT SHIPPED (deliberate, we: "do not yet implement all components")**:
   the game ships BUILT-IN component firmware .xc files
   (`Archean-game/modules/ARCHEAN_*/components/<Type>/main.xc`: Keyboard,
   Numpad, Crafter, DockableDoor, Volume, ChemicalFurnace/Reactor,
   FissionReactor, OwnerPad, Computer documentation.xc) — running each
   component's own program on the pump (real switches/drills) is the NEXT
   emulation step; the server-HDD `buzzers.xc` programs prove the
   output_number law the buzzer engine already implements.
- **v1.13.x XENON batch 6: real screen geometry (6 px per unit)**: an
 element's XenonScreen surface is size×6 px (the firmware's own
 'Screen dimensions: 300x300' print on a 50-unit pilot-screen is the proof);
 registering size+1 clips every screen_copy composite (the 'empty main
 screen' report on the Badger - his code DOES composite, our canvas
 clipped). ALL surfaces list per tick (Badger: 118 buffers - the 24-cap hid
 them), pixels fetched only for visible canvases + the 3-D feed keys
 (Engine.screenFeedKeys → pump.setFeedKeys → pushScreen onto the craft's
 dashboard faces). MiniComputers get NO auto main#0 (no integrated screen
 in game). Router-backed devices need no emulation: alias addressing is the
 game's own mechanism (computer.md).
- **v1.13.x XENON batch 7: MOVABLE windows + screen ZOOM**:
 components/FloatingWindow.tsx - shared frame (title-drag, E/S/SE resize,
 session rect registry, off-screen rects REOPEN AT INITIAL via the
 both-ends title probe, clamps keep the title reachable, phones <768px go
 fullscreen). Xenon IDE + Screens dock use it. ScreensCell: ⛶ fullscreen
 with zoom (fit / 1:1-px / ±/pinch, scroll pans) - an 870-px airliner dash
 becomes inspectable. Pure geometry unit-pinned (floatingwindow.test).
 Pin: the reachability probe tests BOTH title ends; the dialog's debug
 useEffect must sit BELOW `const pump = xenonPump` (TDZ crashed the chunk -
 the dev server's unminified stack named it in one line).
- **v1.13.x XENON batch 8: THE CRAFTER IS A COMPUTER WITH A BUILT-IN
 SCREEN**: blueprint json stores NO program for a Crafter (data {}) - it
 lives on the world server HDD (ide.md); the game PUBLISHES the built-in
 program in its wiki (Crafter.md, 247 lines) → engine/crafterbuiltin.ts
 shipped verbatim (NOTICE §2). xenonComputers synthesizes its disk
 (builtin: true; run-side file main.xc per the VM boot convention,
 entryName = disk name), the integrated touchscreen = the plain-function
 target main#0 (128×72, registered beside its alias key). Shim device fns:
 progress, fluid_level, start_craft/cancel_craft (bus events),
 enough_power. Menu: '⌨ crafter-N ·built-in'. Probe-verified live: cycles
 tick, main#0 paints 'Initializing Crafter…' (lit pixels).
- **v1.13.x XENON batch 5: WORLDSIM goes GLOBAL + $val overrides + ABI/LFS
 (we: "worldsim should be global, not tied to individual sensors… buttons
 should still be toggleable from worldsim, but grouped differently… sensors
 should have overrides, so you can add or remove from the value, referred to
 as $val e.g. $val + 2 to an altitude sensor… Uncaught TypeError:
 _xc_worldsim_sync is not a function spams; can the wasm move to a repo /
 git LFS?")**: engine/worldsim.ts owns the GLOBAL channel store (keyed by
 name, localStorage-persisted archean-worldsim, shared by every craft — a
 PLANE's World tab shows the airliner's nav rows as 'other craft'); the pump
 keeps only name→io/ch BINDINGS for the running computer. wsKind: SENSOR =
 observers only (/sensor$/, navinstrument family, altimeter…) and ONLY they
 get the g($val, t) override row ('$val + 2' → the instrument reads high —
 inversion/offset tests); controls AND actuators (pilotseat, throttle,
 wheels, relays…) are the CONTROL group — f(t) + manual toggles, no $val.
 The World tab groups Sensors/Controls, bound-first. WASM/JS DRIFT GUARD:
 every new device export is typeof-guarded (a stale wasm degrades features,
 never spams — the _xc_worldsim_sync TypeError spam was this class) and the
 shim stamps xc_abi()=4 vs the app's XC_ABI — a mismatch warns ONCE at boot;
 bump both with the shim. COMPILED ARTIFACTS ON GIT LFS: git-lfs 3.6.1
 installed per-user (~/.local/bin, no root), .gitattributes tracks
 app/public/xenoncode|tools/xenoncode|app/wasm *.wasm — new blobs go LFS
 (Pages serves the checked-out files; visitor traffic is Pages, not LFS
 quota); history's ~1 MB blobs stay plain (git lfs migrate --everything is
 the optional follow-up). A separate repo was REJECTED: the shim is our
 device law (lenient-index, channels, worldsim API), evolving with the app —
 the stable contained piece is upstream XenonCode, already pinned separately.
 Pins: worldsim.test ($val, wsKind split, global-store identity), xenon
 leg 'the WORLDSIM: sensors fly the craft…' (2000 + $val+2 → 2002.000 live,
 firmware prints input_number(4,2)=2002, setworldsim(…,3000) badges program
 + wins, persistence across crafts).
 - **v1.13.x XENONCODE-P1: the interpreter is a FORK SUBMODULE (we approved
  "Yes, public fork", 2026-10-28)**: `tools/xenoncode/upstream` is the public
  fork https://github.com/Joeppie/XenonCode as a **git submodule**, branch
  `archean` = upstream base `e5d3167…` + our four patches as REAL commits
  (lenient text→number, XENON-VARS, XENON-DEBUG, XENON-LENIENT-INDEX). The
  old flow — clone + `git reset --hard $PIN` + regex-patch the checkout in
  place on every build (non-idempotent patchers that asserted on their own
  anchors) — is retired; `build.sh` builds ONLY the recorded gitlink and
  REFUSES a diverged checkout, so the interpreter can never be built from
  unrecorded sources. The patch scripts stay in `tools/xenoncode/` for
  provenance (they re-derive the commits onto a newer upstream when
  `archean` rebases). Interpreter bump = work in the submodule (branch
  `archean`, push to the fork) + `git add tools/xenoncode/upstream` + the
  rebuilt js/wasm (`tools/xenoncode/build.sh` with emsdk) in the SAME
  commit; upstream PRs = one commit per PR from that branch (the device
  shim stays OURS in this repo, it is Archean law, not interpreter).
  P2 (worker + Atomics true line-stepping, approved) adds the mid-line stop
  hook to the XENON-DEBUG commit. `XENONCODE_UPSTREAM.md` documents every
  commit; NOTICE §6 + .gitattributes follow.
- **v1.13.24 THE ENTRYPOINT-FRAME FIX + THE `__XCDBG__` DEBUG CONSOLE (we:
 "in my autosave ... I cannot see the local variable. It'll say its in top
 level" + "create a text-based/lower level/JS interface where we can define
 breakpoints and then run stuff - a nice interface that makes using it for
 AI agents to analyze xenoncode easier")**: (a) the report's `update` block
 compiles as an ENTRY POINT — the compiler tags its body
 `"entrypoint." + vector-index` while `EntryPoint.name` keeps the human
 word; our frame resolvers claimed `'entrypoint.' + name` → NO frame →
 "top level" with no locals (fork `69802bf` XENON-ENTRYPOINT-FRAME: claim
 by index; native-probed: the reported `$_input_number_11_3` row appears +
 writeback lands in the update frame). App side: `projectBlocks/blockAt`
 (xcproject) label frames for the global-scope blocks (`update`, `init`,
 `tick`, `timer frequency N`, `input N`) — localsFrame(): `@fn` for
 functions, the block label for blocks, null for true top level.
 (b) `window.__XCDBG__` (engine/xcdbg.ts, installed by Editor on any page):
 a plain-JSON async console over the REAL pump — `files/source`,
 `break(file,lines)`, `clear/breakpoints`, `run({cycles})` (resumes from a
 pause, resolves at the next stop/budget), `step('over'|'into')`,
 `goto(file,line)`, `frame/locals/globals` (typed rows: name/type/value/
 copy), `write(name,value,scope)` (XENON-WRITEBACK's validated law — the
 same the row editors use), `io(io,ch,v)` (feed channels so io-guarded
 branches run), `bus/prints`. Design law: every answer is
 JSON-serialisable, every call bounded (cycle budget, timeouts) — an agent
 drives via page.evaluate, no DOM. Pins: vitest xcdgb.test (8, fake-pump
 semantics incl. the goto bug it caught — the first cut never called
 pump.runTo), xcproject BLOCK frames, e2e xenondbg.spec.ts (headless agent
 demo on the worker pump: break @selectcase:10, frame rows, write 42 ok /
 abc refused, step, goto the `timer frequency 4` body → frame label +
 $change, clear+run budget, bus). Docs: help topic xenondebug.md (API
 table + agent session transcript), xenon.md pointer.
- **v1.13.23 THE WRITEBACK LAW — EDITABLE DEBUG VALUES (we: "When debugging
 a variable, I want the capacity to edit its current value (it must be valid
 for its type, type must be shown besides variable name) - it should reject
 invalid values if trying to edit those, and be able to inject those back
 into xenoncode")**: `Computer::WriteVarAt(file,line,name,type,value)`
 (fork `399d852`, shim ABI 9, export `xc_write_var`) resolves the name
 through the paused frame's locals (a local shadows a global, the
 language's lookup) then the globals, validates, and writes the RAM SLOT
 DIRECTLY — the paused program resumes with the injected value. The law:
 numbers demand a fully-parsed finite decimal (+ the language's true/false
 words); text accepts every string; storage/array/object REFUSE (world-save
 persistence / label-only views); answers `{"ok":true}|{"error":…}`. THE
 WRITABLE MOMENT: a worker VM has exactly one — PAUSED (the write rides the
 SAB as cmd 6: payload window at BYTE 128, slot 18 length, slot 20 ack
 flag; the parked hook applies it through its own thread — the parked VM's
 only voice — and stays parked); main-thread mode writes directly anytime.
 THE 128 LAW (the bug the probe caught): a slot n owns bytes 4n..4n+4, so
 payload windows must start ABOVE every slot — the first cut shared byte 80
 with slot 20 and `store(i,20,0)` zeroed the payload head → the writer
 refused; layout rule now documented in shim + engine header. UI: every
 var row shows a type chip beside the name (`number`/`text`/`storage
 number`/…), number+text values become click-to-edit buttons at a pause
 (inline input, Enter writes, Esc cancels — stopPropagation keeps the IDE
 open), refusals answer inline under the row and the editor stays open;
 `validNumInput` mirrors the C++ gate for instant feedback. Pins: vitest
 THE WRITEBACK LAW (ack parse + numeric law), e2e THE LOCALS TAB (edit
 $result: 'abc' inline-refused, 42 lands + row updates, running worker
 shows no edit affordance).
- **v1.13.21 THE LOCALS TAB + THE SOURCEFILE TRUTH LAW (we: "When debugging
 local variables, I cannot see their value. But that is vital when debugging
 locals; add this as a tab, also put the tabs currently vertically labeled as
 top-tabs at the same level as the search names/values")**:
 (a) **XENON-LOCALS (fork `972b99f`, shim ABI 8)**: the compiler exports
 `localVarDecls` (every named declaration inside a named body: function,
 system.init/tick/timer/input, entrypoint.* — with function name, recursion
 copy stackId, RAM slot) and `Computer::DumpLocalsAt(file,line)` resolves
 the owning body by [start, CODE_RETURN) containment (top-level positions
 have no frame — their variables are the Vars globals) and reads the slots
 LIVE, so a debug stop answers the paused line's frame MID-CYCLE. The
 parked worker's handoff: it answers no postMessages, so the EM_JS hook
 dumps the frame at the stop and encodes the JSON onto the SAB (slot 19 =
 UTF-8 length, bytes at offset 80; plain writes released by the slot-1
 store) — the SAB grew 1024→8192 B; an old 1024 B SAB degrades honestly to
 "no locals". THE UI (XenonDialog): the vertical rail is GONE — the side
 tabs are a horizontal row with the tab's search box AT THE SAME LEVEL
 (the Locals tab shares the Vars search law: one query, filter names AND
 values); the Locals panel shows the frame chip (`paused at f:10
 @selectcase · live frame`, `last stop … · stale (running)` after resume),
 recursion copies badge `#s`, KV text breaks open, and `pump.varValue`
 makes the code's `$var` hover read the paused frame first. Pins: vitest
 "THE LOCALS LAW" (JSON shape, SAB reader law, varVisible filter,
 varValue shadowing) + e2e xenon.spec "THE LOCALS TAB" (PLANE: break
 inside functions.xc @selectcase, pause, live frame rows = the ARGUMENTS
 the call passed + tab-row level law).
 (b) **THE SOURCEFILE TRUTH LAW (fork `8dfaa58` XENON-SOURCEPATHS — found
 by THIS e2e, it is the reason the leg first went red)**: the pair stream
 never lied for single-file programs, so v1.13.16-20 shipped blind. Three
 library bugs made per-file (file,line) streams untruthful for EVERY
 multi-file craft: the include-end FileInfo marker returned
 `filedir + "/" + filename` (`./main.xc` ≠ the ctor's normalized
 `main.xc`), registration was a blind push_back (one name, several
 indices), and a body region is ENTERED BY JMP, which skips the
 linearly-emitted SOURCEFILE record — so the PLANE's functions.xc bodies
 streamed under a third, misnamed registration and per-file breakpoints
 by NAME never fired. Fix: normalized marker, dedup-by-name registration,
 openFunction self-tags every body at its start. **The app's fileTable of
 record is now the VM's table** (`xc_source_files()`, basenames, the
 entry's canonical `main.xc` tag mapped back to comp.entryName) —
 `includeOrder` is only a pre-ABI-8 fallback. LESSON: a name→index model
 the VM owns must be READ from the VM, never re-derived.
 (c) **TextDecoder CANNOT decode SharedArrayBuffer views** ("The provided
 ArrayBufferView value must not be shared" — spec). Inside the pump that
 throw killed the locals assignment in pollSab (paused=true, locals=[],
 silent) — the __XENON__ audit handoff probe surfaced it. SAB payloads
 decode through a `bytes.slice()` copy into a plain Uint8Array first.
 **v1.13.22 follow-up (we: "vars and locals should co-habit the same tab,
 with locals always on top")**: the standalone Locals tab is GONE — the
 Vars panel is ONE list with the Locals section (frame chip + rows) ALWAYS
 ABOVE the `Globals · n live` head; the tab badge folds the frame count in
 (`Vars (6) + frame 4`); e2e co-habitation law (loc rows above the globals
 head above the var rows) re-pinned the leg.
- **v1.13.20 THE FRESH COMPUTER IS PROGRAMMABLE (we: "When I place a new
  minicomputer, I dont get a xenoncode menu for the computer, and I cannot
  write code for it as a consequence!")**: two gates hid a placed
  MiniComputer (newcraft.ts record = `data: {}`, NO hdd key): `xenonComputers`
  listed only disks WITH at least one `.xc` file, and TopBar renders
  Xenon ▾ only over a non-empty list — so an empty-disk computer had no
  menu AND no path to write its first file. `xenonComputers` now lists
  every `PROGRAMMABLE = /^(MiniComputer|Computer)$/` part (the Computer
  joins: it is the same device class, integrated screen included, its
  deviceScreen entry already existed for files-carrying ones) + the Crafter
  via built-ins; the existing entry-fallback chain synthesizes the blank
  `main.xc` tab for an empty disk (the Badger stores program='' + a
  literal main.xc = corpus-proven game-valid). Diskless siblings are
  labelled by the inspector's `type-N` law (two fresh computers read
  `minicomputer-0/-1`, not two 'main's). **THE DEEPER DEFECT the new
  round-trip pin caught: `insertXcFile`'s `docEnsureArray` requires the
  PARENT object, and a fresh component's doc has no `hdd` key — the array
  write silently missed the doc = the v1.6.1 class (code lives in bp, the
  SAVE loses it). New doc.ts primitives `docEnsureObject` (creates the
  missing parents alphabetically, refuses BEFORE mutating on a type
  conflict) + `docReplace`; insertXcFile guarantees the parents first, and
  when the DOC never carried a disk it mirrors bp's whole defaulted hdd
  object {capacity,label,xc_files} so the save carries what the IDE sees.**
  IDE save → `xenonFiles` matches by name → insert creates hdd → pump
  reload runs it (the game's save⇒reboot). Pins: vitest xenoncode.test
  "THE FRESH-COMPUTER LISTING GATE" (data {}, empty xc_files, Computer +
  deviceScreen, type-N labels, PilotSeat/Lamp unlisted, Crafter built-in
  unchanged) + xcfiles.test "THE FRESH-COMPUTER AUTHORING ROUND-TRIP"
  (blank tab → insert → code IN THE SAVE → reloads as the entry); fixture
  tools/make_freshcomputer_test.py → testdata/9000009001 (data {}
  verbatim) + e2e xenonfresh.spec.ts @ui (menu lists it, blank main.xc
  BOOTS cycles, authored code saves, the print proves the blueprint-side
  file ran, hint '1 .xc'). Help topic xenon.md retold.

- **v1.13.17 TRUE MID-CYCLE STEPPING — THE VM ON A WORKER (we: "Implement the
  capacity to actually step through lines. Do what needs done.")**:
  the interpreter's XENON-DEBUG hook (fork `0516ccb`) is LIVE: the shim
  (`xc_host.cpp`) defines `xc_debug_hook(file,line)` as an EM_JS that runs
  the STEP LAW at every executed line and on a stop SLEEPS IN PLACE
  (`Atomics.wait`) — the worker parks INSIDE `xc_cycle()` with the C++
  stack intact while the main thread paints; F10/F11/F8/runTo/breakpoints
  are Atomics writes (the SAB Int32Array protocol is documented VERBATIM at
  the hook + XENONCODE_UPSTREAM.md; `XC_ABI` = 7, gate = SAB +
  `crossOriginIsolated`, vite sets COOP/COEP on dev+preview). PROVEN:
  a breakpoint pauses MID-CYCLE (cycles counter frozen) and F10 advances
  the LINE, not the cycle. **THE STEP LAW LIVES IN TWO PLACES**:
  `xenoncode.ts stepperLaw()` (pure, vitest-pinned — the main-thread
  pair-stream walk, the Pages/plain-http fallback) ⇄ the EM_JS in
  `xc_host.cpp` (worker mode, evaluated per line) — ANY change lands in
  BOTH + re-pins; the SAB slots mirror the same law (ref pair [5,6], over
  body-range [7,8] with lo>hi = top-level, runTo [9,10], bps [11..]).
  **MODE SPLIT E2E LAW**: localhost = worker mode (isolated); Pages/plain
  http = main-thread fallback — the fallback is pinned at unit tier only
  (vitest SAB-GATE + THE STEPPER LAW describes; the live path verified by
  probe with COOP/COEP stripped). THE LANDINGS: (1) **worker pixel keys** —
  `XenonWorkerRun.setKeys` piggybacks the wanted surface keys on EVERY
  cycle message and the worker's cycle branch MUST `if (m.keys)
  wantKeys = m.keys;` — the first cut only read a standalone 'keys' message
  that is never posted, so worker mode delivered ZERO screen pixels (four
  `litPixels == 0` e2e reds: metas flow, pixels absent = the exact
  signature; a live probe reading `__XENON__().pixels(key) === null` with
  `cyc` ticking nailed it in minutes). (2) `XenonWorkerRun.open` RACES the
  'open' answer against a 15 s timeout → dispose → main-thread mode: a
  silent worker can never wedge the pump 'booting'. (3) sabResume before
  dispose/terminate is an INVARIANT (a parked Atomics.wait worker cannot
  die). (4) **L4 ESM INTEGRATION** (we: "why is xenoncode.js so modular
  and separate … rather than modular but integrated into our code?" — the
  separation stays deliberate, the FORM was accidental): build.sh gains
  `-sEXPORT_ES6=1`; the glue + wasm moved `app/public/xenoncode/` →
  `app/src/engine/xenoncode/` and load through the module graph via `?url`
  (the seal.wasm precedent, LFS pattern follows); the worker `import(xcUrl)`
  directly (fetch+blob export-shim + the location.href dance GONE — the
  worker gets page-absolute asset URLs, the one kept dance, commented);
  the standalone POC page became a module import. `--js-library` for the
  hook is a MEASURED dead end (emscripten 6.0.13: JS-lib symbols do not
  satisfy undefined C symbols) — EM_JS in the glue is the only form.
  Gates: xenon.spec 15/15 on worker mode, vitest 899 (+8 pins: THE STEPPER
  LAW ×6, SAB GATE ×2), tsc clean; main-thread fallback probed live.
  (5) **staleness.spec re-pinned to the v1.13.11 SHA-ONLY LAW** (found by
  this session's fast tier; RED ON MAIN d0879d6 — pre-existing, xenon-only
  test rounds stayed blind to it): the spec sealed staleness with a FAKE
  `x-blueprint-rev` + correct digest, which the current identity law
  (content sha decides, rev is display metadata) correctly classifies as
  FRESH — the gate never fires, four pins silently dead. The wire seal is
  now a CONTENT swap (body + trailing newline — JSON.parse tolerates it —
  served with the honest sha OF THE SWAPPED BODY so download-verify + the
  store self-check pass), making the catalog sha genuinely differ: 4/4
  green in 11.7s. LESSON: when an identity law changes, re-audit every pin
  that SEALED its old trigger through the wire.
- **v1.13.16 THE REAL DEBUGGER + CODEMIRROR 6 EDITOR (we: "f10 should mean
  step one line and f11 step into, there should be a context menu when I
  right click. And when I edit code, I need syntax highlighting, I should
  have go to definition as a right click menu and hovering over a function
  should tell me its signature and where it lives")**: XENON-DEBUG **v2**
  (fork commit `0516ccb`, shim ABI 6): the interpreter streams
  EXECUTION-ORDER `(file * 1000000 + line)` pairs (SOURCEFILE tracks the
  file per LINENUMBER) + a weak-extern `xc_debug_hook(file,line)` stop-hook
  seam (the future worker+Atomics host sleeps there mid-cycle; the
  interpreter needs no further change). Pump (xenoncode.ts): F10 = STOP AT
  THE NEXT EXECUTED LINE (step-over leaves the enclosing function's body
  via the project index), F11 = next pair anywhere, `runTo(file,line)`,
  breakpoints keyed BY FILE (inactive tabs fire too), pause AT the first
  executed pair, `pausedFile/pausedLine`, `fileTable` = includeOrder(entry
  BFS); XenonTest gate cycles never touch the debugger.
  `engine/xcproject.ts` = the PURE project model (function index with body
  ends, include BFS, declarations, token hit-test) + vitest pins on corpus
  syntax (`function @name($a:type)`, `include "f.xc"`).
  `components/CodeEditor.tsx` replaces the virtualized read-view +
  textarea: CodeMirror 6 + XenonCode StreamLanguage, breakpoint gutter
  (click toggles, ●/▶), right-click menu (Go to Definition · Run to
  Cursor · breakpoints · clipboard · Save), hover (`@name` → 'defined in
  game.xc:83', `$var` → live value), Ctrl+Click go-to-def, completion on
  typing + `$`/`@` triggers (device aliases complete inside
  output_number("...")), oneDark, viewport-virtualized. Dialog: WHERE-AM-I
  pill (`file:line @fn`, data-file/data-line), BREAKPOINTS overview strip
  (jump + ✕), stepping chip, Run-menu F10/F11 items.
  LANDINGS (the installed @codemirror/view is the block-syntax rewrite):
  GutterMarker paints via `elementClass` + `toDOM` (the old `toElement` is
  NOT in the protocol — markers silently vanished);
  `EditorView.domEventHandlers` AND plugin `eventHandlers` bind contentDOM
  ONLY — gutter events need plain listeners on `view.dom`; CM's
  completion-Escape consumes the key WITHOUT stopping propagation, so a
  `Prec.high` binding with `stopPropagation: true` guards the
  Esc-closes-IDE law; Home is column 0 and **XenonCode section bodies are
  TAB-indented (indent-significant)** — e2e code edits type their own
  `\t` and anchor INSIDE visible lines (`/input_number\(4, 2\)/` regex:
  `$`-text locators match raw, hasText ignores the model).
  `pump.vars` keys are '$'-LESS (hover/complete normalize). CEP's disk
  declares ZERO functions (the v1.13.3 '@sel' popup assertion was a latent
  @slow red — the leg now runs on PLANE, and `storage var $x` lines
  parse their NAME, not 'var'). e2e: xenon.spec 15/15 (new debugger leg:
  overview + pause AT plomo.main.xc:17 + F10 data-line ADVANCE + F11 + F8
  + ✕; new editor leg on PLANE: colors, context menu, hover 'defined
  in'). vitest 891, tsc clean.
- **v1.13.x XENON batch 4: WORLDSIM (we: "World should be under xenoncode,
 be its own screen and we should have functions that we can put in that
 define values over time, i.e. sin(t) … sensible defaults … flight at 2000
 metres, going 80 metres per second forward … expose setworldsim(name,value)
 / getworldsim(name) … Rename it to worldsim")**: engine/worldsim.ts is a
 whitelisted expression-in-t engine (numbers, t, pi/e, sin..pow; anything
 else THROWS — no eval surface; clamps ±1e9). Every input channel of the
 running computer becomes a pump row (key io:ch — numbered AND alias-
 addressed), NAMED `${device-slug}.${channel-slug}` from the game's channel
 tables, driven by its f(t) each cycle; defaults = level flight 2000 m
 /80 m/s with gentle oscillation EVERYWHERE (PilotSeat included). The World
 side tab edits f(t), shows live values + program-override badges + per-row
 manual sliders. Program API: device functions setworldsim(name,v) (override
 until pow(10,40) — XenonCode has NO e-notation literals, 9e99 parses as a
 NAME) and getworldsim(name) (pump streams effective values back via
 xc_worldsim_sync) — in the game these are the firmware's own nops; native
 fixture tools/xenoncode/demo/worldsim. xc_seedWorld stays as the pre-tick
 seed only. Fix also landed: File ▸ Save while BROWSING no longer merges the
 (empty) editor draft into the file. Pins: worldsim.test (7), native demo,
 xenon leg 'worldsim'.
- **v1.13.x XENON batch 3: real menus, ONE-row tab strip, autocomplete,
 channel MEANINGS (we: "there is no working menu… should it even nest? No
 man — computer is what we are in, keep it a good menu structure like an
 IDE; File shouldn't show more than one line at a time; I cannot edit code;
 add an autocomplete for variable names, known functions and declared
 functions; the computer STILL does not resolve the component type of the
 input, nor the meaning of the channels per input")**: (a) MenuBar component
 — File (disk: new/save/delete) · Run (execution: start/resume, pause, step,
 stop, F9-breakpoint) · Computer (re-boot) · Help; the flat 'Options ▸ run'
 labels are GONE. (b) The tab strip is `xenon-tabstrip`: ONE row
 flex-nowrap + overflow-x-auto (measured first: the Badger's 57 tabs WRAPPED
 and the ✎ edit button rode BELOW the clip — "cannot edit" was LAYOUT, not
 the editor), edit/save/revert pinned BESIDE the strip, never clipped.
 (c) AutocompleteEdit: `$` completes variable names (running globals + every
 name declared on disk), `@` declared functions, bare words the language/
 library fns + keywords, `.` screen members; caret-mirror popup, Tab/Enter
 accept, Esc closes (stopPropagation — the window's Esc-close owns the key
 otherwise). (d) CHANNELS.json: tools/extract_channels.py packs the game
 wiki's `### List of inputs/outputs` tables (52 types; 2- and 3-column
 rows; types without tables show a bare ch N — NO invented meanings); the
 IDE labels input rows 'PilotSeat · ch 1 Backward/Forward' (the device's
 OUTPUTS are what input_number reads on an io cabled to it), bus rows show
 the WRITE-side meaning, node cards carry the fn (xenon-chan-*). The shim
 resolves ALIAS io args (xc_ioOf: alias → cabled io, alias-only devices →
 synthetic 1000+id; xc_set_input_a wires the sliders); detectChannels
 carries string io for alias-addressed reads. ALIAS-only devices get
 CANNED WORLD SEEDS (xc_seedWorld, from the same tables; alias-only only —
 cabled devices stay slider-driven; sliders override): the alias fix made
 alias reads HONEST (0, not the io-0 leak) and the Badger's nav gate then
 skipped boot — seeded (Celestial='EARTH', heading, lat/lon, dock/anchor
 present, battery 0.8) the firmware reaches 'Smart Quad is ready' natively.
 Pins: xenoncode.test (chan table + alias detect), xenon.spec 'resolves io
 to component TYPES…' + 'IDE menus, single-row tab strip, and $/@/word
 AUTOCOMPLETE'.
- **v1.13.x XENON batch 2: side rail, debugger, autosaves (we: "Screens and
 vars should be to the side of the tabs, the computer screen should take more
 size; set breakpoints and move through with f10/f11; the viewer keeps a
 shadow-copy of the current craft, autosaves show in the file menu with
 timestamp")**: (a) the IDE's side panel is a VERTICAL RAIL (writing-mode
 tab buttons) beside a wider panel; screen canvases render `fill` at maxH
 340. (b) THE DEBUGGER: `patch_xenon_debug.py` (build.sh applies) records
 executed lines per cycle behind a flag (RunCode's LINENUMBER case — one
 branch, off = free) + `xc_cycle_lines()`; the PUMP owns paused/step state —
 gutter click / F9 toggles a breakpoint (per code tab), the cycle that
 TOUCHED a line pauses (`xenon-paused` pill, amber line), F10/F11 step ONE
 10 Hz computer cycle (true line-stepping is impossible in the library's
 run-to-completion VM — say so, don't promise IDE parity), F8 resumes; F5-run
 is intentionally absent (the VM runs continuously; PAUSE/STEP are the
 meaningful controls). Break lines mix included files' line numbers (v1
 caveat, documented). (c) AUTOSAVES (`app/src/engine/autosave.ts` +
 AutosavesDialog + File ▸ file-autosaves): shadow copies of `emitDoc(doc)`
 (save-quality text) keyed by craft id (`new:<title>` unsaved), IndexedDB
 `archean-autosaves` + the crafts.ts memory fallback; the Editor shadows on a
 20 s dirty-idle timer, on visibilitychange-hidden, and on save (then prunes
 to 4; cap 12/craft); ordering key (ts, seq) — Date.now() ties within a ms
 broke the first pin; Restore = window.confirm-then-openText. Pins:
 autosave.test.ts (4), xenon.spec legs 'the debugger…' (F9 pause at
 main.xc:17 which runs every cycle, F10 one-cycle step, F8 resume — cycle
 counts asserted) and 'autosaves…' (disk edit → visibilitychange shadow →
 reload → restore → the marker rides back into the IDE — the code view is
 VIRTUALIZED, so tail-line assertions must SCROLL the fold first). TWO real
 bugs the autosave leg caught (keep as patterns): the visibilitychange
 listener must live on DOCUMENT (the event targets document, bubbles:false —
 a WINDOW listener NEVER fires), and the craft-open effect must not list
 openText in its deps (the history churn made a RESTORE re-run the craft
 open OVER the restored doc — the v1.5.10 latest-ref pattern applies to any
 open/load effect). The Badger reboot crash class: reboot = fresh VM, RAM at
 ZERO, surface registry SURVIVES — shim screen members + screen_copy
 null-guard (unguarded segfault, gdb this=0x0); XENON-LENIENT-INDEX makes
 OOB array/text indexing game-tolerant (reads 0/empty, indexed writes GROW,
 OOB text-char writes skip; repro XC_REBOOT=1 native). Side-note: the
 dev-server tab must RELOAD after scene.ts fixes (no HMR accept → the old
 module kept throwing the fixed m.material array crash).
- **v1.13.x XENON: the editable IDE, the shared pump, live dashboards (we:
 "fix the issue the 3381670618 craft has; make dashboards actually display
 what is given to them; make code editable; make the file dialog able to
 open/save the files on the virtual disk; screens button on top → bottom tab
 with normal + virtual tabs; nodes show the actual values read from their
 components; a variables side-tab that breaks KV open, searchable; $var
 hover shows the current value, old value above it fading out")**:
 (1) THE CRAFT ISSUE was OUR shim, not the craft: `button_rect` was declared
 VOID, and the program writes `if $screen.button_rect(...)` — the game's docs
 (computer.md:143, dashboard.md:84) say it EVALUATES TRUE IF CLICKED. Shim
 now: button_rect/button return the click (per-surface click state, cleared
 per cycle), legacy `button(x,y,color,w,h)` colour-3rd order, `pixel(x,y)` is
 a GETTER, click/scroll entry points run per-screen (ref = the surface Var —
 EntryPointMatches keys on the object address) + plain. The screens registry
 keys surfaces by the program's LITERAL token (`screen(10,0)` → `10#0`) — the
 app registers the io-number key at the Dashboard element's pixel size
 (size+1) AND the alias key (xenonScreens XCScreen {alias=key,label,ci}).
 (2) THE SHARED PUMP: `xenonPump` (engine/xenoncode.ts) owns the ONE wasm VM
 + the 10 Hz loop; the IDE dialog, the ▣ Screens bottom dock (TopBar button,
 visible only when hasDashboards) and the 3-D feeds all subscribe/register
 canvases — no second pump per dialog. (3) DASHBOARDS RENDER WHAT THEY ARE
 GIVEN: scene buildDashboard gives bound Screen/HdScreen faces a DataTexture
 (`Engine.setScreenFeeds({key,ci,channel})` rebuilds those Dashboards,
 `pushScreen` blits rows flipped, 10 Hz from the pump's subscription in
 Editor). (4) THE IDE EDITS THE VIRTUAL DISK: files are the blueprint's
 `data.hdd.xc_files` — edit (full-file textarea; the read view is
 VIRTUALIZED, the 1500-line cap is GONE, `data-lines` pinned), File dialog
 creates (.xc / .main.xc) and deletes, CTRL+S save ⇒ writeback through
 edit.ts setXcFileCode/insertXcFile/removeXcFile (bp+doc, v1.6.1) ⇒
 AUTO-REBOOT the VM (the game's rule). (5) NODE LIVE VALUES: the shim reports
 every input_number read per cycle (`{"e":"in"}`); the #NODES graph is DOM
 cards now (SVG wires) — InputNode cards show `= the value read from the
 component`, OutputNode the bus value per port. (6) THE COMPUTER SIDE PANEL:
 Vars | Screens | Bus | Console tabs with search (names/values incl. KV
 children; screen names); Vars reads the XENON-VARS patch
 (tools/xenoncode/patch_xenon_vars.py — compiler records global decls,
 `Computer::DumpVarsJson` = RAM live + storageCache; CODE_TYPE 50/51 storage,
 70/71 RAM, ≥128 objects, 40/41 constants filtered, `.`/`@` artifacts
 filtered); KV text values (`.on{1}.red{255}`) break open
 (`parseKv`); `$var` tokens in the code show a hover tooltip with the CURRENT
 value and the OLD value fades out above it (`.var-fade`). Pins:
 `xcfiles.test.ts` (doc-mirror disk writes, key order, entry-name mapping,
 craft 3381670618 extraction, KV/kind), e2e xenon.spec (node live values,
 the 3381670618 leg — boots + 146×66 element surface + disp-button click
 flips $var + hover, the ▣ dock dashboards/virtual tabs on the Badger,
 Badger windowed 16k view + Vars tab). Re-pin: xenonScreens alias = the
 program's token (was the label). Version strings v1.13.1.
- **v1.12.12 XENON ON THE BADGER — hook + iterate (we: "Hook it to Chip's
  Badger, iterate over issues that it encounters and try to fix them as they
  crop up, also try to load in the virtual screens, and read components. Also
  in my exploration plane; the nodes dont render with the information they
  should have, specifically the inputs")**: the Xenon IDE pointed at the
  hardest craft in the corpus (3326372833: MiniComputer ci133, 57 files,
  1.8 MB of .xc, 36,232 lines) and the issue list fixed as it cropped up —
  ① `program=''` → entry-file fallback `<prog>.main.xc` → `main.xc` →
  `*.main.xc` → first file (the Badger stores a literal main.xc);
  ② **virtual screens**: `virtualscreen(w,h)` (cap 4096/buffer) +
  `screen_copy(src,dst,sx,sy,dx,dy,w,h[,tint,rotation,bilinear])` (rotation
  + bilinear sampling in the shim — the Badger's attitude-display atlas uses
  both); ③ **component reading**: the wiki's Component Inspection family
  (`device_count/device/device_at/device_type` as KV-text records) over a
  device table JS fills from the blueprint — cabled components via
  `data_port.0NN` computer-side port names (verified: plane io11 = PilotSeat,
  cep io8 = SmallWheel) PLUS every ALIASED component (computer.md: aliases
  address components directly — the Badger drives `mining-drill`,
  `left-cargo`, `nav` with zero data cables to them; io map = 1 cable + 82
  aliases); ④ screen BINDING rewritten to scan the program's
  `screen(aliasOrIo, ch)` calls (the binding law per xenoncode/dashboard.md +
  computer.md Screen Override): alias→Dashboard → element #channel
  (Screen/HdScreen, pixel size = units+1 per XenonDraw; Label = no surface),
  alias→component = its 128×72 override surface, number→component cabled on
  that io of THIS computer; the Badger boots 17 named surfaces
  (pilot-screen#0..5, systems-dashboard#0..1, ore_screen#0,
  left-inside-door-button#0…); ⑤ the Computer-context built-in VALUES
  (`tick`, `system_frequency`, `system_ram/ipc`, `programs_count`,
  `user/owner/username`) + the recipes family (`get_recipe*`/
  `get_item_value_unit` honest empties) + colour extractors + `button/
  button_rect` (draw, no click edge) + `load_program/reboot` no-ops;
  ⑥ **lenient text→number PATCH** (build.sh, documented in
  XENONCODE_UPSTREAM.md): the open library's `stoll` throws where the game
  binary casts junk to 0 — the Badger's first settings read crashed the VM;
  ⑦ Chrome wasm ceiling: `-sINITIAL_MEMORY=64MB -sMAXIMUM_MEMORY=4096MB`
  (headless probe: default 2047MB cap aborts the Badger boot in-browser;
  node peaks ~100 MB); ⑧ **node-graph inputs** (the reported bug):
  InputNode/OutputNode cards now show `io <ioNumber> channel <channel>` /
  `io <n> (write)` (the #NODES JSON carried them, we never drew them) and
  unconnected ports label their constant (`= -40`); ⑨ Badger-scale UI:
  code view + validation capped at 1500 lines (main.xc is 16k) with a
  "view is capped" note, `#`-directive lines skip validation, tabs wrap
  (57), screens panel caps 16 canvases + count, `screenInfo(max)` +
  `screenCount()` stop copying 118 buffers per render, io bus + input rows
  relabelled by DEVICE NAME (mining-drill, PilotSeat).
  Verified: e2e Badger chain boots the firmware in-browser in 2.2 s
  ("Booting Up Smart Quad v4.0T6aW Workshop firmware" → "Smart Quad is
  ready" prints, mining-drill bus row, pilot-screen#0 canvas lit > 20 px,
  57 tabs, capped view) + plane/cep legs stay green; vitest 13 xenoncode
  pins (io-map law on 2 crafts, Badger extraction, binding incl. the
  no-such-alias auto-surface rule); native runner: 150 cycles = 5,422
  outputs + 118 painted surfaces on screen-*.ppm.
- **v1.12.11 XENON ▾ — THE IN-GAME IDE FOR CRAFT COMPUTERS (we: "integrate it
  with our normal tool … in the menu add Xenon, there, list all computers and
  when we click a computer, we get a pop-up screen with its code that looks
  like it does in-game … display using the screen and HD screen … code that
  has nodes should also render")**: the XenonCode POC (tools/xenoncode) became
  an app feature. The dev's interpreter ships as `app/public/xenoncode/`
  (WASM build products of the pinned upstream — `tools/xenoncode/build.sh`
  copies them; rebuild after any host change). Seam `engine/xenoncode.ts`:
  `xenonComputers(bp)` (MiniComputer → files/screens/channels — screens are
  the DASHBOARD's Screen/HdScreen ELEMENTS bound by `screen(alias, channel)`,
  channel counts ALL elements, 1 px per element unit per the dev's XenonDraw),
  `tokenize` (the dev's OWN mode: XenonCode repo www/xc_mode.js + tmLanguage —
  types carry the colon INSIDE the keyword token), `parseNodes` (the
  `;#NODES {json}` header of node-authored programs: cards + ports + wires),
  `XenonRun` (boot/cycle/setInput/screenInfo/parseLine). TopBar `xenon` menu
  (only on crafts with .xc-carrying MiniComputers, items `xenon-comp-<ci>`);
  `components/XenonDialog.tsx` = the in-game-style IDE (title bar + ON,
  File/Library/Computer menu row, file tabs, line-numbered highlighted code,
  "Program 'x' loaded / is running…" status lines, Esc close): Screens panel
  blits each XenonScreen framebuffer at 10 Hz; input_number channels are
  auto-detected sliders feeding the externals-by-number contract; the io bus
  table streams output_number; prints → console; Nodes tab renders the graph
  (pan/zoom canvas); per-line validation runs the REAL compiler
  (`xc_parse_line` — wasm needs -fexceptions -sDISABLE_EXCEPTION_CATCHING=0
  for the VM's exception reporting; red line = the compiler's own message).
  The device shim gained: a screen REGISTRY (`xc_add_screen(alias,ch,w,h)`,
  auto-created default surfaces), the wiki's full draw API (draw_point/line/
  rect/triangle/circle/poly, text_align + the top_left… constants,
  newline_spacing, width/height) and `xc_parse_line`. Device-function
  OVERLOADS = one declaration of the widest prototype + runtime
  `args.size()` dispatch (the library keys by name; call sites are not
  arity-checked) — draw_poly is variadic the same way. Pins: vitest
  `xenoncode.test.ts` (12: extraction on 3294880085/3327182790/3281212435,
  tokenizer shape incl. the lossless-file sweep, #NODES graph resolution,
  channel detection) + e2e `xenon.spec.ts` (@ui @slow: menu→IDE chain — tabs,
  code, zero validation errors on shipped programs, HdScreen canvas LIT
  pixels, bus rows, the pitch slider as an EXTERNAL NUMERIC drives
  PitchControlJunction ≤ −0.3 [React range needs the NATIVE value setter +
  input event], Esc) + the CEP graph leg (lit canvas, `nodes (N)` tab).
  Power/wiring NOT simulated (our ruling: "we can ignore the power
  requirement"); io routing to the craft's real components = the next seam.
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

- **v1.13.25 THE IDE LIBRARY + FIND + MAXIMIZE + F5-RUN (we: "an index of
  all known library and custom-defined functions as a library of
  definitions, so I can find it inside the computer. I also want to be able
  to ctrl-f text within a computer XenonCode IDE. Also, I want to be able
  to easily maximise the IDE itself. also F5 should run the code, so long
  as a computer or screen window is open, otherwise it does a refresh"):**
  (1) LIBRARY TAB — `engine/xcproject.ts` gains `XC_LIB_DOC` (one
  `{name,sig,desc,group}` row per `XC_LIB_FNS` name — the vitest lockstep
  pin forbids a doc the completion pool does not offer and silence on one
  it does) + `libIndex(q)`; the IDE side panel gains a `Library` tab: the
  disk's declared `@functions` (click = `jumpTo` the declaration across
  files) above the built-in table above the `screen.` members, one search
  row filtering all three. (2) CTRL+F — `CodeEditorHandle.openSearch()` +
  a window relay in XenonDialog (dead zones only: text fields keep native
  behaviour, CM's own searchKeymap owns the content). THE FIND-PANEL ESCAPE
  (measured twice before it was right): CM's panel keymap consumes Escape
  WITHOUT stopping propagation AND the panel's input lives outside
  `view.dom`, so the editor-content keymap never sees the key — a
  bubble-phase window guard closes the IDE with the panel JUST closed (the
  state mutates synchronously, so a `searchPanelOpen` check there reads
  "closed"). The law: the dialog's Escape handler is CAPTURE-phase, stops
  the key over `.cm-panel` and closes the find itself; the Prec.high
  binding in CodeEditor (searchPanelOpen → closeSearchPanel,
  stopPropagation) covers Escape from the editor content. LESSON: for
  popup-key ownership the CAPTURE phase is the only vantage that sees a
  keystroke before CM consumes it. TWO SWEEP CATCHES (both red on the full
  run): (a) the menus leg — window CAPTURE listeners run in REGISTRATION
  order, so the dialog's Escape (registered at MOUNT) beat the menu row's
  Escape (registered at OPEN); (b) the ac leg — a capture-phase IDE-close
  fires before EVERY editor keymap (capture precedes bubble; Prec.high is
  a bubble-phase ordering), so Escape over an open COMPLETION popup closed
  the dialog and the completion typing landed on a dead page. THE FINAL
  LAW: the capture listener owns ONLY the find-panel case (stop over
  `.cm-panel`, close find); the IDE-close stays a BUBBLE listener — behind
  the menu row's capture, behind `closeSearch()`, behind CM's Prec.high
  stopPropagation. LESSON: capture is not "earlier everywhere" — a window
  capture listener outranks every bubble-phase owner of the key, so move
  ONE routing to capture, never the whole handler. (3) MAXIMIZE —
  FloatingWindow gains controlled `maximized`/`onToggleMaximize`: viewport
  fill, grips hidden, title drag stopped, title DOUBLE-CLICK toggles; the
  IDE's title bar carries ⛶/🗗 (testids xenon-max). (4) F5 — retires the
  v1.13-era "F5-run not feasible" note: the VM runs continuously, so RUN
  = THE GAME'S run — inside the IDE F5 saves the draft (save ⇒ disk ⇒
  auto-reboot) else `pump.reboot()`s from disk; with ONLY the ▣ Screens
  dock open the Editor's F5 branch re-boots the pump; with NEITHER window
  open F5 stays the browser's refresh. pilotkeys already stand down for
  modifier chords (the ctrl/meta guard), F5 is not a cockpit word. RUN
  rewind made HONEST: `pump.reboot()` cleared log/prints/bus but had
  kept `cycles` counting (it reset only in `open()`), so the menu-bar
  "cycles N" lied about which boot it counted — reboot() zeroes it in
  both branches (worker + main) and close() zeroes it too (a CLOSED
  pump shows 0, not a frozen ghost — the probe showed the ghost letting
  a readiness gate pass on a DEAD session while the new boot sat at
  cycles=1, making every rewind assertion unsatisfiable); the counter
  means cycles of THIS boot (the game's menu-bar semantics; the
  debugger legs read cycles inside one boot only, unaffected). Pin
  lesson: gate F5-rewind on a SETTLED counter (>30 cycles) and compare
  with `< c/2` — on a fresh boot the counter races the poll at 25 Hz.
  Pins:
  vitest xcproject lockstep×4, e2e xenon.spec.ts 'IDE extras' (@slow):
  library filter + @selectcase jump, Ctrl-F panel open + Escape-keeps-IDE,
  ⛶ viewport fill + dbl-click restore, F5 cycles-rewind in the IDE and in
  the dock with no page reload.

- **v1.13.26 THE EDITOR-ERGONOMICS BATCH (we: "ctrl-g needs to go to a
  certain line, library function should be in tabs, screen, system, IO
  should all have their own coloured category, clicking a function should
  go to its definition, autocomplete should suggest them when typing. Tab
  needs to not move the cursor out of the editor… enter on an init,update
  etc. block should automatically indent, same with a function… e2e tests
  have a @codeditor flag… mouseovering a io write/read to a specific port
  should resolve what kind of device it is and what its current values
  are… display the 3d view and the current relevant value")**:
  (1) CTRL+G — a tiny in-editor go-to-line box (`xc-goto`, this CM vintage
  ships no go-to-line; relay from the dialog like Ctrl+F).
  (2) LIBRARY CATEGORY TABS — `XC_LIB_GROUPS` in xcproject (seven groups,
  one colour each; vitest: the keys == the set of groups XC_LIB_DOC uses,
  colours are #rrggbb); the Library tab's chip row filters, chip dot and
  the doc row's left border carry the colour.
  (3) AUTOCOMPLETE — bare-word completion serves XC_LIB_DOC entries with
  `sig — desc` as info; declared functions carry `@sig — declared in
  file:line`. Click-to-definition: Library rows jump (v1.13.25); library
  builtins have NO source (hover/completion carries the doc).
  (4) TAB — THE BUG WAS REAL, THE FIX HAS A TWIST: the editor had NO
  defaultKeymap, so Tab fell through to the BROWSER and focus left the
  editor. Adding defaultKeymap ALONE does NOT fix Tab — CM keeps
  Tab = focus-move by DEFAULT (accessibility) and ships the indent Tab as
  the SEPARATE `indentWithTab` binding; both landed (ours first in the
  keymap list). e2e asserts activeElement stays in .cm-editor after Tab.
  (5) ENTER AUTO-INDENT — an explicit Enter binding (this CM vintage's
  stream `indent(state, textAfter, {unit})` cannot see the PREVIOUS line,
  so the stream indent API is unusable for the law): at the caret's line
  end, `opensBlockLine` (xcproject pure = BLOCK_RE ∪ FN_RE) ⇒ newline at
  indent + one unit, THE UNIT BEING A TAB — XenonCode's compiler scopes
  block bodies by TABS (a 2-space body parses as GLOBAL scope — the fresh
  leg's 'Invalid first word c' boot error, found by probing the pump, not
  the UI); else the line's indent is carried; mid-line Enter is
  a plain newline. CM6 normalizes a TYPED '\n' to the Enter keymap, so
  programs AUTHORED via keyboard.type auto-indent too — the legs that
  typed corpus-style tabs after newlines went 'Invalid scope' (tab +
  auto-indent mix) and now type tab-free, the editor owning the indent;
  bare `dispatch({changes})` keeps the caret at the insert START (the
  next word landed on the previous line) — the binding sets the selection
  to the insert end explicitly (both measured via temp probes). (6) IO HOVER + PREVIEW + FLY — `ioCallAt(line,col)` (pure) hits
  the whole `input_number/output_number/input_text/output_text(…)` call;
  the dialog resolves alias/io → XCDevice, ch → the game's channel table
  (`chanInfo` name + range) and the LIVE value — reads = `pump.reads`
  (what the device SENT the program), writes = `pump.bus` (what the
  program SENT the device) — and the tooltip carries the part's CATALOG
  PREVIEW (we clarified: "I didnt mean a 3d navigation, I meant a view of
  the component's normal appearance like in the menu where its placed
  from"): an `<img>` fed by `requestThumb` from engine/thumbs.ts — the
  placement menu's own live-model renderer, shared GL context and all.
  Ctrl+Click flies the 3-D view via `engine.flyTo(dev.ci)` (kept as the
  bonus it turned out to be) — XCDevice now carries `ci` (the COMPONENT
  index; `id` is the device-table order, flyTo wants the component). The
  `__XENON__` debug hook gained `cam()` (Engine.camPos) so the fly is
  measurable — and the DIALOG's enriched hook must carry it too (it
  REPLACES the base hook while open; the probe read null through the
  shadow until both had it). (7) @codeditor — the CodeEditor legs (extras,
  syntax-colors/def/hover, menus/autocomplete, the new keys/hover leg)
  carry the tag; full runs only when the editor's files touch. Pins:
  vitest xcproject (group-tab lockstep, opensBlockLine ×2, ioCallAt ×3);
  e2e xenon 'editor keys: Tab stays, block auto-indent, Ctrl+G, io hover
  + 3-D fly' (@slow @codeditor, PLANE fixture: innerText indent geometry,
  Tab-focus law, goto land, hover device+write, camera-move poll); the
  extras leg gained the category-chip filter steps.

- **v1.13.27 ALWAYS-LIVE EDITOR + NAV HISTORY + BREAKPOINT-FOLLOW + GAME
  CONSTANTS (we: "I dont want a distinguishment between edit and viewing
  of code, it should be in edit mode always, save should commit it and
  reload the code. That should reset the computers state, but keep
  breakpoints. When hitting a breakpoint in execution, the editor should
  move to the point just being hit. Also, editing a file at a certain
  line or moving to a breakpoint like that should create a navpoint we
  can browser-history to … red, green which seem to be built in constants
  are not recognized. They are colors … I dont remember the precise
  type"):** (1) NO edit/view split — `files[]` ARE the live buffers (the
  CodeMirror onChange writes the tab's buffer + marks ● dirty); `✎ edit`,
  the draft, `↺ revert` and 'Save all' are GONE; SAVE/F5/Ctrl+S all mean
  COMMIT (`p.onFiles` ⇒ the write path re-boots the pump on the files);
  closing the IDE discards unsaved buffers. BREAKPOINTS SURVIVE the
  re-boot — and the leg PROVED the hole: pump.setBreaksMap mirrors the
  break set into the worker's SHARED SAB table, and a save-triggered
  reload builds a NEW worker whose table is empty (the dialog's re-push
  races the async open and lands on the dead run). THE LAW: pump.open()
  itself re-mirrors (new `applyBreaks()`, fileTable freshly mapped, called
  before startLoop) — keep-breakpoints is engine-guaranteed, not
  UI-luck. `bps` is dialog state untouched by save; `pump.open()` never
  clears `breaks` (only `close()` does). (2) BREAKPOINT
  FOLLOW — an effect on [paused, pausedFile, pausedLine] calls jumpTo at
  the hit (the code pane's `data-paused-jump="file:line"` is the
  observable the pin reads). (3) NAV HISTORY — browser model: jumpTo
  records the spot you LEAVE (truncating forward), ◀ ▶ buttons beside the
  tab strip and Alt+← / Alt+→ (CAPTURE — CM binds Alt+arrows to scope
  select in the editor; the window capture outranks it) walk the list;
  breakpoint hits jump THROUGH jumpTo so ◀ returns to the edit.
  (4) GAME CONSTANTS — the ground truth is OUR SHIM (`xc_host.cpp
  archeanInit` declares them; the interpreter itself knows no colors):
  18 colors (white…silver incl. gray/grey), 9 text alignments, pi/2pi —
  ALL are NUMBERS (colors hold packed RGBA `XENONCODE_COLOR(r,g,b,255)`);
  `XC_GLOBAL_CONSTS` (vitest-pinned against the shim source: name set
  equality), completed with kind + hex/meaning, highlighted like the
  library, and shown in the Library tab under Colors/Alignment/Math chips
  with swatch dots (XC_LIB_GROUPS gained the three constant-kind keys,
  pin updated to groups ∪ kinds). e2e: new 'nav history + breakpoint
  follow + save keeps breaks' leg (@slow @codeditor, PLANE: gutter break
  → data-paused-jump, save ⇒ ON + .xc-bp count kept, lib-jump ⇒ ◀ enabled
  ⇒ Alt+← ⇒ ▶ enabled, const-red swatch row, `whi` completes white); all
  legs author code in the always-live editor (xenon-edit/edit-cancel/
  save-all testids retired).

- **v1.13.28 CLASSIC STEP-OVER + IDE FURNITURE (we: "Sometimes when I
  press f10 it doesnt seem to properly move to where I am executing code.
  After if statements the indent should be one deeper. when I type $
  suggestions for locals should show up. If a file is not yet saved …
  red asterisk … Running the code/resetting/stopping should have classical
  style buttons"):** (1) THE STEP LAW CHANGED IN BOTH TWINS (stepperLaw +
  the xc_host.cpp EM_JS hook cmd 1, wasm rebuilt via
  `EMSDK=~/emsdk build.sh wasm-only`): F10 'over' stops at the first fresh
  pair OF THE PAUSED FILE (next executed line at the current frame;
  other-file calls stepped over). The old scope-window law (stop outside
  the enclosing function) is gdb-`next` semantics: from inside a function
  it RAN THE REST OF THE BODY AWAY — a probe walk of PLANE showed the
  linear case was fine (17→18→19→21→24, comments skipped) so the "never
  moves" complaint was frame stepping (functions.xc:6's F10 landed at ~49,
  out of the function). In-file callees land like step-INTO (the pair
  stream carries no call depth; rare corpus pattern, documented).
  (2) CONTROL-FLOW INDENT: opensBlockLine += CONTROL_RE
  (if/elseif/else/while/repeat/for/foreach, `\b`-anchored so `form=` and
  `verified=` stay plain). (3) `$` COMPLETION carries the PAUSED FRAME's
  locals first (pump.locals, detail '· frame'), then globals. (4) DIRTY
  MARKER: the tab ● is RED (#ff5b5b) — VS Code's dot, the most standard.
  (5) CLASSIC RUN TOOLBAR beside the tabs (testids ide-run/pause/restart/
  stop/step-over/step-into): ▶ green (resume-aware), ⏸, ⟳ re-boot (keeps
  breaks), ⏹ red, ⇥/↓. Pins: stepperLaw over-tests rewritten (frame
  continuity, callee-skip, loop-wrap), opensBlockLine control cases +
  `form`/`verified` traps, e2e 'F10 steps line-by-line in the current
  frame' + 'run toolbar + if-indent + dirty dot + frame locals'
  (@slow @codeditor, PLANE).
- **v1.13.29 PAGES WORKER MODE — THE ISOLATION FORGER (we: "make the Xenon
  debugger's WORKER mode (true line-stepping) work on the GitHub Pages
  site"):** Pages cannot send response headers, so there
  crossOriginIsolated is false and the SAB gate (engine/xenoncode.ts
  sabSupported(), pinned in xenoncode.test.ts) degraded Pages to the
  main-thread pump with cycle-granular stepping. THE WHY OF THE GATE:
  shared memory is gated behind cross-origin isolation because Spectre-
  style timing attacks read across co-resident cross-origin documents —
  HTTPS authenticates BYTES, not CO-RESIDENCE; the isolation flags, not
  TLS, are what makes SharedArrayBuffer safe to hand out. The cure is the
  documented self-isolation recipe (web.dev/coop-coep): a service worker
  CAN add headers to navigation responses. `app/public/sw.js` (ships at
  the site root — vite copies public/ into dist, deploy_pages puts dist at
  the root) answers GET navigations with fetch + a re-wrapped Response
  wearing COOP: same-origin + COEP: require-corp; `/viewer/` is
  header-free (the frozen inspector loads Three.js from a CDN —
  require-corp would block it); ZERO caching, pure passthrough, so the
  append-only assets law is untouched. app/src/main.tsx registers it ONLY
  per the pure decision engine/isolation.ts shouldRegisterIsolationSw
  ({isolated, flagged, hasSW}) — vitest-pinned — and reloads ONCE
  (sessionStorage one-shot: a SW that never activates cannot loop the
  tab); the second load is isolated and the EXISTING SAB gate unlocks
  worker mode with zero gate changes — the fallback path is untouched,
  every failure (insecure origin, CSP, offline) degrades to today's pump.
  Pins: isolation.test.ts (the decision), e2e/isolation.spec.ts
  (@slow @ui, the whole Pages-style layout: app/dist + repo testdata/
  viewer/ served plain-header under a /archean-blueprint-tools/-style
  subpath by a spec-local node http server — the suite's vite-preview
  origin always sends the headers, so no existing spec can reach the SW
  path; asserts one-reload via the session flag, crossOriginIsolated,
  SW scope, xenon-mode chip 'worker · true line-stepping', /viewer/ NOT
  isolated + canvas paints). Playwright preview suite unaffected (its
  origin is isolated from load one → the decision never fires; no
  @while-publish leg pinned Pages main-thread mode, nothing to re-pin).
  Verified live after deploy: first visit installs + reloads, the IDE
  chip states worker mode on joeppie.github.io.
- **v1.13.30 HOTFIX (tsc -b):** the isolation spec's widened chip assert
  used `expect(locator, {timeout})` — this Playwright's matcher options
  type carries no `timeout` (vite's webServer build typechecks nothing,
  so only the deploy's `npm run build` caught it). Matcher-level
  `{ timeout }` form; behavior unchanged.

- **v1.13.31 XENON-DEBUG v3 — THE DEBUGGER WORKPACKAGES (we, 2026-10-28,
  the Mario session: "When I have given input to a screen, my breakpoints
  are not hit … I must be moved there … the yellow highlight … not cleared
  … f10 steps into, not over … cannot change variable values … debugging
  mario feels sluggish … f5 should mean run, f6 should mean stop … I want
  the code to stop on the precise line being executed, EVEN IF we do not
  have a breakpoint there! And I want to then be able to edit values"):**
  the session plan is workpackages.md; the shipped laws are AGENTS.md
  §Xenon (STEP LAW v3, TRACKING GATE + PARK LAW, F6 key). The build:
  XENON-DEBUG v3 lands as a FORK commit (cycleDepth stream, per-stream
  caps, the DebugPause seam, hookLive gate) + the xc_host.cpp twin (hook
  depth + H.pd, the new exports, ABI 10) + rebuilt js/wasm in the SAME
  commit. WP1 root cause (main-thread only): the pair recorder shared the
  cycleLines 200k cap and lines are never drained there — Mario's game
  loop (screen input starts the render loop, thousands of lines/cycle)
  pushed the vector over the cap and pair recording DIED GLOBALLY, so
  breakpoints never fired again; per-stream caps fix it (the native probe
  XC_PAUSE_AT + the dbgaudit streamed-cycle pin). WP4: the v1.13.28 law's
  documented "in-file callees land like step-INTO" limit was THE report —
  the depth stream makes classic 'next' real in both modes. WP5 root
  cause: on the user's Tailscale origin (http LAN = not a secure context
  = MAIN-THREAD pump, no SAB) ⏸/⏹ never parked the VM, so the WRITEBACK
  LAW's writable moment was unreachable; the v3 pause seam parks main-mode
  exactly, ⏹ parks + stops, and the value rows park-to-edit. WP6: the
  tracking gate (breaks/step/park only) + worker pair-JSON skip +
  xc_hook_live kill the debug cost when the debugger is idle; the pump
  already closes (VM gone) when both the IDE and the Screens dock close.
  WP3: the editor's wash/pill derived from pausedFile/pausedLine WITHOUT
  pump.paused — resume left the yellow row behind. WP2: jumpTo centers the
  line (EditorView.scrollIntoView y:'center'). Verification tiers: native
  xc_run probes (pause seam exact line + writeback into the parked frame),
  vitest STEPPER LAW depth pins, and the SPARING Playwright budget spent
  ONLY on the debugger legs of xenon.spec.ts/xenondbg.spec.ts + the
  app/tools/dbgaudit.mjs audit run on BOTH origins (localhost = worker,
  Tailscale IP = main-thread — the user's real mode).
- **v1.13.32 IDE CHROME — TITLE-BAR DEBUGGER, WRAPPING TABS, FLASH ROWS,
  PHONE IDE (we, 2026-10-29, batch: "We can't see all files in code,
  perhaps expand the list of file tabs to multiple lines when mouse over,
  debug buttons as part of the title to save space. Modified variables
  should flash a green background as an updated highlight, both locals and
  globals." + "On mobile, opening code I can't read it, scroll through it,
  the bars and such should be collapsible sideways to make room, also
  scrolling should be possible to make it possible to use the coder"):**
  XenonDialog — the CLASSIC RUN TOOLBAR (▶⏸⟳⏹⇥↓) moved from beside the
  tab strip INTO the FloatingWindow title bar (the drag law already
  excludes buttons; on phones, no F-keys, it is the whole debugger); the
  file-tab strip is one scrollable row at rest; the HOVER EXPANSION
  (`hover:flex-wrap`) is an OVERLAY (absolute over the code, z-20 +
  shadow) — a PUSHING expansion hid the editor under a hovered 57-tab
  strip (the Badger catch); the v1.13.24
  single-row pin `bb.height < 46` measures the REST box; the Vars panel
  diffed each row's value string across pump ticks (a ref map of the last
  value per `locals:$name` / `globals:$name` key, an effect per commit)
  and bumped a per-key seq — the row's React key carries the seq, the
  remount restarts the `.var-flash` CSS wash (inset green shadow so the
  row's own dark bg survives). PHONES (<768 px, `narrow` state): the
  COMPUTER SIDE PANEL collapses to a vertical RAIL on the viewport's
  right edge (one chip per tab, writing-mode text); tapping a chip opens
  the panel as an OVERLAY DRAWER (✕ collapses), so the code pane owns
  ≥85 % of the width; the menu-bar status text hides; `.cm-scroller`
  gets `touch-action: pan-x pan-y` + `overscroll-behavior: contain`
  (index.css). Pins: xenon.spec.ts (hover flex-wrap via computed style,
  ide-* inside `div.cursor-move`, .var-flash after F10 in the frame-locals
  leg) + THE NEW e2e/xenonphone.spec.ts (L4 OPT-IN to the pixel7 project:
  fullscreen window, rail→drawer→✕, code-pane width, wheel scroll,
  touch-action, title-bar ⏹/▶ power cycle). Corpus-drift note: a fresh
  worktree has no blueprints.conf, so the corpus-scan vitest files run on
  repo testdata and TIME OUT at the 5 s default (four files, cold cache)
  — copy the machine-local config in and extend --testTimeout before
  believing reds there.
- **v1.13.33 STEP-FOLLOW + HUD/BEACON RESEARCH (we, 2026-10-29, batch:
  "the scroll/focus doesn't change position when I used f11, necessitating
  me to find it manually. That is not acceptable … we need the capacity to
  have multiple systems communicating … vital to test Chip's ChipOS …
  look into coding HUDS for the game … beacons … I have a 'homo' HUD
  inside archean and the RCS500 craft has craft-HUD interoperation … the
  explanation of screen controls in title of computer should live under
  the screens explanation … text about cycles is too big for phone
  display"):** (1) Debugger-follow pinned for the STEP keys: the
  `data-editor-jump` observable records the target jumpTo handed the
  editor; the F11 pin asserts it equals the stop site after every step
  (the v1.13.27 pin only asserted `data-paused-jump` — the pump's truth,
  not the follow). Worker-origin leg green; run on the LAN origin too
  (the user's main-thread mode — the pw.lan runner pattern: a config
  with baseURL on the Tailscale IP). (2) Screen-control/pilot-key text
  moved out of the IDE menu-bar status into the SCREENS tab head
  (`xenon-screens-note`); the menu bar keeps `cycles N @ 25 Hz · CTRL+S
  save+reboot`; phones get a tiny `N cyc @ 25Hz` chip (`rightNarrow`,
  text-[8px] — we: "too big for phone display"). (3) RESEARCH, fully
  transcribed the same commit: FORMAT §HUD & the Beacon radio — Beacon
  component {transmitFrequency, receiveFrequency, transmitData} text
  channels, craft-side access is plain io (`input_text(port,0)` /
  `output_text(port,0)` — the RCS-500 beacon is io port 8), the HUD's
  client-side `beacon($txFreq,$rxFreq)` object (`.data`,
  `.transmit(text)`), the HudController `data.xc_files` HUD programs +
  the drawing builtin set (panel/virtualscreen/screen_copy/draw_*/
  button*/text*/set_resolution_scale — `strings` off
  ARCHEAN_hud.GAME_Mod.so), the dot-kv structured-payload text, and the
  Badger fleet `.schema{…}.nonce{…}.data{hex}.tag{hex}` protocol
  (encrypted — opaque). The user's "RCS500" = workshop 3518436870
  "RCS Infinity" (frequencies `RCS-500-HUD-SEND/RECEIVE`); the "homo"
  HUD craft was NOT found in the corpus (asked). (4) PLAN: REWRITE § P9
  — ComputerFarm (N pumps per craft) + SHARED per-craft io bus +
  Beacon-as-io-device with a frequency-channel registry + HUD
  workspace; ChipOS-critical first (Y-bump candidate, needs assent).
  Follow-up same day — the "homo" HUD FOUND: it is a PLAYER-INSTALLED
  HUD at `Archean-data/client/hud/homo/` (main.xc + parse.xc + the
  client-compiled xc_program.bin + an `active` flag), NOT a craft
  blueprint — transcribed into FORMAT §Player-installed HUDs (numeric
  beacon freqs `beacon(5,5664)`, avatar-sensor `get()`s + the 6 203 000
  m sea-level datum, word anchors + centre-relative panel coords, the
  panel method set, `set_cps`; siblings: `omfg` = the RCS-500 installed
  companion whose header documents the PRESSURE→flight-power HUD→craft
  CONTROL path, `readme` = the game-shipped welcome UI in
  `default_huds/`, `client/hud/HudControllers/ENTT…/` = the per-craft-
  entity deploy cache). P9's HUD workspace covers BOTH sources (craft
  component + installed .xc).
- **v1.14.0 P9 SLICE A — HUD IDE, BEACON RADIO SCOPE, AVATARSIM (we,
  2026-10-29: "Initiate this work, allow us to edit the code for at least
  HUDs that are contained within a HUD block, and establish a familiar
  environment, including the concept of screens and buttons, and worldsim,
  call that avatarsim in the case of the avatar (player). There should also
  be a beacons menu, under xenoncode … make beacons into a seperate tab for
  computers/hud as well, so the globally known scope can be understood when
  we have 'intercomputer' operations; be they HUDs or minicomputers or
  computers"):** the Y-bump of REWRITE § P9's first slice. THE REGISTRY
  (`engine/beaconnet.ts`, pure, vitest-pinned): participants = the craft's
  Beacon components (transmit/receiveFrequency + the authored transmitData
  as last tx) + every `beacon(<tx>,<rx>)` literal scanned out of computer
  hdd AND HudController xc_files (text AND numeric frequencies, FORMAT
  §Player-installed HUDs) + the USER; routing = EXACT text frequency match
  (deliver posts to every listener's ring, cap 50); every save re-seeds and
  the radio history RE-ATTACHES by participant id (the logs are the point
  of the tab). THE SURFACES: a BEACONS side tab in the computer IDE (side
  union + phone rail) and in the new HUD IDE; a 📡 Beacons item in the
  XenonCode menu opening the BeaconDock window; the send form (known-
  frequency chips + datalist + payload) posts as 'you' and keeps YOUR
  TRANSMISSIONS; the AVATARSIM rows = avatar_sensor_speed/altitude/
  altitude_absolute as worldsim sensor channels (evalExpr f(t), sea datum
  6 203 000 m) — the HUD `get()` pool for slice B. THE HUD IDE
  (`components/HudDialog.tsx`): the XenonCode menu lists HUD blocks
  (xenon-hud-<ci>); the SHARED CodeEditor on the HUD files (funcs/decls
  completion pools, find/goto, F5=save); the writeback reuses the xc-file
  doc funnels with a new '' CONTAINER (a HudController carries data
  .xc_files, NO hdd wrapper — xcfiles.test: byte-safe save, no "hdd" key
  introduced, append/remove index-exact); an honest note states the HUD VM
  runtime (panel/draw/beacon builtins → canvas) rides slice B (the device-
  shim twin law applies). The xenonHuds descriptors memo + beaconNet seed
  re-derive on rev (every save) — reopen reads the disk, the pins assert
  it. Pins: beaconnet.test (8), xcfiles HUD trio, xenonhud.spec (2,
  Badger: its 999-line guide HUD + the BGR-D60167… listener receive our
  send). The computer-IDE first-comp leg uses the Badger: 57 files boot
  ~2.5 s — inside budget.

## 2. v1.11 session — KNOWN ISSUES & UNPINNED TODOS (2026-10-25/26 session block)

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
                               #   (QUIESCENT-ONLY: run it as
                               #   PERF_HARNESS=1 npx vitest run load.perf — v1.12.7
                               #   wall-clock tripwires measure LOAD, not code, so
                               #   the file SKIP-REPORTS inside the npm-test gate)
                               #   on corpus crafts (prints the PERF table;
                               #   numbers are transcribed into PERF.md)
npm run build:wasm             # rebuild app/wasm/seal.wasm (AssemblyScript;
                               #   run after editing app/wasm/seal.ts — the
                               #   binary is committed, sealwasm.test.ts
                               #   instantiates it and pins JS parity)
npm run test:e2e               # Playwright chromium UI suite (app/e2e/) — FULL
npm run test:e2e:fast          #   … minus @slow AND @while-publish (the publish-queue law L8)
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


## 3. Invariants that tests enforce — full pin descriptions (legacy viewer suites)

The suites still run (tests/run_tests.sh, commit gate); this is their full
pin-by-pin text as kept in AGENTS.md until 2026-10-28.

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


## 4. Test-load stratification — the v1.11.7→v1.12.5 session notes (rules live in AGENTS.md, strategy in docs/TEST-PYRAMID.md)

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
  - **`@while-publish` — the PUBLISH QUEUE (L8, user 2026-10-28: "tests
    like this; remarking a situation that is already wrong, make them
    lowprio-while-publish … I don't want to pay the price in every
    release").** Pins whose subject is a KNOWN-IMPERFECT state (degraded-mode
    announcements, staleness-gate wire seals, warnings documenting a platform
    gate) are NOT per-release gates: `test:e2e:fast` inverts
    `@slow|@while-publish`, and they run OPPORTUNISTICALLY — in the Pages
    Actions wait of the publish ritual (`npx playwright test --grep
    '@while-publish'` backgrounded while deploy_pages builds), at session
    end, and always before a release TAG cut. Membership needs BOTH: the
    law asserts behaviour/wording around a by-design-imperfect state, AND
    its red costs no shipped function this slice. Core feature laws (a
    boot, a pixel, the stepping law) never qualify; zero-cost asserts
    riding an existing leg stay with it. Members: staleness.spec.
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


## 5. Retired backlog entries (DONE/CLOSED at the time of the move)

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
- **Undo stack: DONE (2026-10-20).** Shipped as the doc-text snapshot
  stack with time-windowed drag coalescing (see the 2026-10-20 bullet above) —
  deeper than the requested ≥10 levels (the stack is unbounded per session)
  and it covers EVERYTHING that flows through the `markDirty`/`sceneChanged`
  funnels, which is every mutation path in the app. The originally-planned
  deep-clone-of-`{doc,bp,orig,applied}` form was superseded: `emitDoc(doc)`
  already carries the complete edit state (doc mirrors are mandatory on
  every write) and re-opening a snapshot re-derives `orig`/`applied`
  exactly like a fresh load.
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

## 6. Viewer component-list UI conventions (viewer is frozen; kept for the port)

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

## 7. Data-source drift forensics (full text; the live ritual is the Known-open-issues line)

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
