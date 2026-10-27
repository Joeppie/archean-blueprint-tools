# TEST-PYRAMID.md — killing the e2e tier (plan, 2026-10-26)

we asked for the analysis behind one sentence: **unit tests are quick and
specific; e2e tests are slow, flaky and hypersensitive — and they carry far
too much of our guarantee. unit tests should capture virtually everything.**
This document is the measurement, the diagnosis, the laws, and the phased
fix. It supersedes the `Test-load stratification` section in AGENTS.md as
the strategy text (AGENTS keeps the operational short form and points here),
and it turns the planned §P7 in REWRITE.md into an executable ladder.

## 1. The measured state (2026-10-26, this tree)

| tier | what | size | runtime |
|---|---|---|---|
| vitest (plain node) | 32 engine modules, pure laws | **669 tests** | **10.4 s** (≈ 16 ms/test) |
| Playwright fast tier | all specs minus @slow, 2 projects | ≈ 180 tests × 2 = ≈ 360 browser runs | **9.9 min** (≈ 1.6 s/run, measured v1.11.7) |
| Playwright full | 32 specs, 7 709 lines, 1015 `expect()`, 251 `page.evaluate()` | 197 tests × 2 projects = 394 runs | ≫ (the @slow renders: truck census, gearpair, matrix) |
| headless viewer channel | selftest+regtest (tests/run_tests.sh) | — | ≈ 6 s (keep — it is cheap and format-facing) |

A single e2e run costs ≈ **100× a unit test**; a heavy spec (builddock:
1 021 lines, 17 tests, **92 `__ARCHEAN__` hook references**) costs thousands
of unit-test-seconds — for assertions that are, line by line, engine math
executed inside a browser.

**The flake tax, from our own history:** v1.11.0 THE GREEN GATE spent an
entire release session re-pinning 5 specs to UI vocabulary drift; the v1.11
notes carry the timing laws we had to invent to survive our own suite —
600 ms undo-snapshot spacing, face-INTERIOR pixels, the SKY-click-to-close-
modebox ritual, "canvas fractions are NOT aspect-stable", "e2e running
WHILE editing = phantom failures"; v1.5.11: "full parallel run showed 13
load-flakes, all green individually"; the wire:279 raycast census welded to
mouse plumbing + 40 Hz throttles + React layout timing (the truck's 750-row
dock shifting the canvas rect mid-test). Every one of those is a unit-test
law wearing a browser costume.

**The matrix waste:** Playwright runs the full `pixel7` project on every
spec. 16 of 32 specs contain ZERO phone/device-conditional assertions —
their pixel7 leg re-runs identical desktop laws at a smaller canvas, which
is not coverage, it is a canvas-resize flake generator (≈ 59 pure-duplicate
runs).

## 2. Diagnosis — why the pyramid is inverted

1. **No seam under the renderer.** `scene.ts`'s `Engine` (300 KB) creates a
   `WebGLRenderer` + canvas + DOM listeners in its constructor, and it owns
   the scene-graph CONSTRUCTION (buildSolids/buildReal/buildPipesMesh/
   buildSubgrids + rig nesting), the transform stack and the pick/census
   math. THREE's math/objects run fine on plain node — the class does not.
   So every "does it render at the right place" claim is TRAPPED in a
   browser. This is a coupling, not a necessity.
2. **Interaction clocks live in React/DOM.** Viewport.tsx owns the wire
   hover state machine (40 Hz + trailing edge, 120 ms chip dwell, 2 s X-ray
   dwell), the coord/ghost throttles, the Escape-listener race. Their
   contracts are pure timestamp functions, pinned in e2e against WALL CLOCK.
3. **The `__ARCHEAN__` debug channel is an untyped second test API.** Tests
   drive engine internals via `page.evaluate` (251 call sites) — maximum
   flake sensitivity, zero unit speed, and every engine refactor breaks
   dozens of specs through string-keyed hooks (`e2e running WHILE editing =
   phantom failures`).
4. **The device matrix is on by default, not by assertion.** Phone coverage
   should be a property of the LAW (layout, touch plumbing), not a project
   flag on 32 files.
5. **Flake response was survival, not cure.** Self-healing probes and
   sparsify bands add fragility; a suite whose mitigation strategy is
   "re-run flakes on the final tree before believing them" is telling us
   the tier is wrong.

## 3. The laws (adopted; AGENTS.md carries the short form)

- **L1 — Smallest-tier-expresses-the-law.** A law lives at the lowest tier
  that can state it: pure logic → vitest; graph/pose/pick → vitest (after
  P7.1); DOM/state wiring → jsdom component test (Phase 3); pixels, real
  pointer plumbing, IndexedDB/network, dev-pair → e2e. EVERY new e2e test
  carries a one-line `// e2e-tier because:` justification.
- **L2 — Fixtures beat corpora.** Synthesise the minimal artifact
  (`tools/make_*_test.py` → `testdata/900000NNNN`; the P7.3a x-ray fixture
  is the template). No truck/giant in a feature pin.
- **L3 — A flake is a re-tier signal.** A pin that flakes in a landing run
  gets MIGRATED down a tier in the same session — never healed with a
  longer sleep, a jiggle-poll, or a sparsify band.
- **L4 — The device matrix is opt-in.** `pixel7` runs only the specs whose
  laws are device laws. A new phone assert = a `@phone`-tagged test, not a
  matrix default.
- **L6 — The fixture owns the boot environment (v1.12.2).** The
  storageState ships the boot-cheap settings the device matrix does not
  exercise: `archean-app-debug=1` (the assertion channel) AND
  `archean-app-backdrop=none` (every boot skips the 86–350 kB panorama —
  we: "Make a backdrop Skip part of test fixture"). A spec whose law IS the
  panorama (viewmenu's swap pins) clicks the row explicitly; the ONE
  fresh-profile DEF-panorama pin removes the seeded key in its own context.
- **L7 — Settle, don't sleep (v1.12.2).** The preview-boot speed-up moved
  interactions earlier relative to the app's own animations. Camera/probe
  reads settle on EVIDENCE: two identical `camPos()` samples (damping decays
  in the render pump after mouseup), two identical pick-probe answers (the
  part click flies the camera for 380 ms — KNOWN ISSUE 12 family). Fixed
  `waitForTimeout`s are premise gates only (boot, episode-open).

- **L5 — Migrations, not holes.** An e2e leg is deleted in the SAME commit
  that lands its lower-tier replacement, which reproduces the CURRENT green
  values before any behaviour moves (the P7 gate, kept).

## 4. The ladder (phases, each independently landable)

### Phase 0 — matrix sparsify + laws (THIS landing, no refactor)
- `playwright.config.ts`: the `pixel7` project `testIgnore`s the 16 specs
  with zero device-conditional asserts (app, asset-space, blockedit,
  blockplace, download, gizmo, hinge, liveedit, paint, pipes, propeller,
  savefidelity, subride, sym, views, wheels). −59 runs (−15 % of the
  matrix; the fast tier sheds its @slow-free share: app, blockedit,
  blockplace, download, liveedit, paint, pipes, savefidelity, views =
  37 runs).
- The L1–L5 laws land in AGENTS.md.
- Nothing else changes: no assertion moves yet, so no coverage risk.

### Phase 1 — P7.1 `SceneGraph` split (the enabler) — IN PROGRESS (slices 1–2 ✅)
- **Slice 1 LANDED (v1.12.1, `engine/xray.ts`):** the screen-space
  occlusion census lifted out of `Engine` (165 lines → a pure function +
  a thin collector), 11 node pins the census law, wire.spec's EXPOSED leg
  retired. The remaining slices follow below.
- Extract `engine/graph.ts` from `Engine`: the builders
  (`buildSolids`/`buildCompProxies`/`buildReal`/`buildPipesMesh`/
  `buildSubgrids` + rig nesting), the transform stack (moff, joint poses,
  rig chains, displayQuat) and the pick/census math (`pickCell`, `pipePickAt`,
  `xrayCutsFor`, triAt, blockPick, ring/pin geometry). THREE
  Group/Matrix4/Box3/Raycaster need no GL; `Engine` keeps renderer +
  camera + controls + events and DELEGATES construction.
- The audit numbers become node tests: gearpair world-AABB censuses, the
  rigchain literals, occupancy/substats, x-ray cuts, pipe pick hits.
- Retire-the-browser for the whole "renders at the right place" class:
  asset-space, wheels, subride censuses, sym writebacks, blockplace ghost
  geometry, builddock geometry asserts, liveedit bboxes, select, scene
  boxes (see §5 map).
- Gate: the headless census reproduces the CURRENT green values (the
  committed gearpair/rigchain numbers) BEFORE `Engine` delegates anything.

### Phase 2 — P7.2 clocks out of React — LANDED ✅ (v1.12.1, commit 8373a7d)
- `engine/clocks.ts` (RateCap + WireHover + coordChipText) + 14 synthetic-
  clock pins; Viewport.tsx forwards events only. `engine/history.ts`
  (HistoryStack) + 9 pins; Editor keeps applyHistory. e2e keeps the ONE
  thin "pointermove reaches the seam" legs (wire.spec hover leg, views
  chip legs) — the dwell/convergence/coalescing contracts are node laws.
- (Original brief:) Pure timestamp-driven seams: `move(x,y,now) / leave(now) / tick(now)`
  with an INJECTED pick for the wire hover state machine, the coord
  throttle, the ghost re-aim, the pin-draft drag, the gizmo gesture clock.
  Viewport forwards events only.
- Vitest pins dwell/restore/leading-trailing contracts on a SYNTHETIC
  clock (this deletes every 120 ms/2 s/450 ms wall-clock law from e2e).
- e2e keeps ONE thin "pointermove reaches the seam" test per input family.

### Phase 3 — jsdom component tier — SEEDED ✅ + dialogs/widgets LANDED ✅ (v1.12.4) + VIEWPORT-MOCK HARNESS / panels+dock LANDED ✅ (v1.12.5)
- vitest + @testing-library/react: the panels, the build dock, ToolsDialog,
  HelpDialog, StaleDialog, CostWidget, LiftWidget, MirrorGlyph — testids,
  click → state → row repaint, dialog flows, the Escape-subscribe-once
  lesson. The Viewport sits behind a mocked `EngineLike` seam (the P7.1/P7.2
  split is what makes this cheap — jsdom has no WebGL).
- This retires the DOM half of panels/tools/help/cost/mirror-mismatch/
  builddock-list/phoneux-chip/undo-menu claims.
- **LANDED (v1.12.1):** the env (`?vitest-environment jsdom` pragma +
  @testing-library/react, tests colocated in `src/components/__tests__/*.
  test.tsx`, `Element.prototype.scrollTo` stub) + HelpDialog (9 pins; the
  search + close-trio browser legs retired) + StaleDialog (4 pins; the
  IndexedDB chain stays the e2e integration tier). The panels/dock/cost
  family needs the Viewport-mock harness (Editor mounts the Engine →
  WebGL) — the next Phase 3 slice.

### Phase 4 — P7.4 device harness + the shrunken e2e tier
- staticInfo/modebox dock position/gizmo size = pure functions of
  (mode, viewport w/h, dpr) → vitest; phoneux keeps pixel7 boot smoke +
  the edge-dock bounding boxes.
- The surviving e2e tier = **pixels + input plumbing + integration +
  dev-pair only** (the model is viewmenu.spec: 6 focused pixel laws, no
  engine poking): daylight/palette render reads, see-through ground,
  ortho dome, surge-from-cursor, the real-pointer multi-grip gizmo sweep,
  one balloon dialog→ghost→build ritual, save byte-fidelity through the
  real save path, download/staleness (IndexedDB + network), app boot
  smoke, the dev-pair audits.
- Target: **fast tier ≤ ~60 browser runs (≈ 2–3 min)**; @slow only at
  user-facing Y/X boundaries (the existing gate ladder).

### Phase 5 — channel diet
- With the migrations done, `__ARCHEAN__` shrinks to the surviving e2e
  tier's real needs; the debug-hook surface documented as a TEST API
  (typed, in one module), not a 92-reference string-keyed wilderness.

## 5. Per-spec retirement map (where each spec's claims go)

| spec | today | destination |
|---|---|---|
| app, download, staleness | boot / network / IndexedDB | **keep e2e** (integration tier) |
| viewmenu | pixel probes (see-through, backdrop, ortho) | **keep e2e** — the model for the tier |
| savefidelity | byte-exact save via real app save | vitest covers emit purity; keep ONE real-save leg, retire per-fixture dupes |
| propeller, asset-space, wheels (@models) | geometry/matrix pair | geometry → vitest (propeller.test exists; P7.1 AABBs); dev-pair stays in `app/tools/*.mjs` rituals — **e2e retires** |
| aero, gizmo, hinge, subride, sym (@slow) | scene censuses + joint chains | census/kinematics → vitest (P7.1); ONE real-pointer leg each (hinge drag, gizmo multi-grip, subfollow) |
| wire | 11 tests: clocks, censuses, list UI, pixels | clocks → Phase 2; censuses → P7.1 (the P7.3a fixture); list/disconnect → jsdom; **keep** surge-from-cursor pixels + one 2 s dwell end-to-end |
| pipes | render shape + hover pick (wire's same seam) | vitest (pipes.test is the reference); hover-pick seam **retires** (wire keeps one); keep ONE round-vs-square pixel law |
| panels, tools, help, cost | DOM panels, dialogs, menus, rows | jsdom (Phase 3); keep phone-fullscreen + Brave-clear-zone pixel legs |
| phoneux | device layout | P7.4 pure fns + ONE pixel7 boot smoke + edge-dock boxes |
| builddock (17), sphereskin (18), blockedit, blockplace, paint, mirror, mirror-mismatch, place, select, scene, views, liveedit, undo | engine math via hooks + DOM + a few pixels | engine → P7.1/P7.2 vitest; DOM → jsdom; **keep per spec 1–3**: real input ritual (pin 3-click, brush click-lands-block, smear place), pixel overlay law (twin glow red-vs-gold, coord chip, pins+arrow), and the balloon full ritual |

Net: **≈ 394 runs today → ≈ 60** (fast tier ≈ 2–3 min), vitest from 669 to
~900+, and the flake surface collapses with the browser tier it lives in.

## 6. Order of work + exit criteria

**PROGRESS LOG (each landing reports vitest ↑ / e2e runs ↓ / fast-tier
wall clock):**

- **v1.12.1 Phase 0 ✅** — matrix sparsify: 394 → 283 runs (−28 %).
- **v1.12.1 Phase 2 ✅ + Phase 1 (slice 1) ✅ + Phase 3 (seeded) ✅**
  (commit `8373a7d` + this landing):
  - `engine/clocks.ts` + 14 pins — the coord ~40 Hz throttle (trailing
    edge), the ghost cap, the cable 120 ms dwell + 2 s X-ray machine, the
    chip text. Viewport.tsx forwards events only.
  - `engine/history.ts` + 9 pins — the whole undo-stack design (coalescing
    window with fire-time text read, dedup, redo-drop, flush-before-step,
    openGesture) on a synthetic clock; Editor keeps applyHistory.
  - `engine/xray.ts` `xrayPlanPure` — 165 lines of occlusion census out of
    `Engine`; + 11 pins the BLOCKED/EXPOSED/depth/segment-target/fully-
    in-the-way/ortho laws on synthetic THREE geometry. Retired the same
    session (L5): wire.spec 'an EXPOSED cable (XYQ)' (−2 runs).
  - **jsdom component tier EXISTS** (vitest `?vitest-environment jsdom` +
    @testing-library/react): HelpDialog 9 pins (rail/article/tables/
    search-rank-AND-empty/Esc-✕-backdrop), StaleDialog 4 pins. Retired
    (L5): help.spec 'word search' + 'closes via Esc ✕ backdrop' (−6 runs,
    the Esc law survives e2e as a one-line smoke in the menu leg).
  - Numbers: vitest 669 → **717**; scene.ts −165 lines; e2e matrix
    283 → **275**; verified: views+blockplace+undo+wire+phoneux+help green.
  - LESSON: writing the node pins immediately caught THREE degenerate
    fixtures of mine (fully-covering quads where 'LEFT, not cut' is the
    law; interval-boundary leading edges) — the tier is a DESIGN TOOL,
    not just a speed win.

- **v1.12.1 Phase 1 keystone ✅ — THE HEADLESS ENGINE** (commits
  `bbc1c6f`..subride): `Engine.setVirtualViewport` + the `viewRect()` seam
  give EVERY pick/projection probe a canvas rect with no renderer
  (attached = byte-identical browser behaviour). `__tests__/harness.ts` =
  the real open funnel + corpus-tier resolution + diskAtlas (the real
  game-model atlas, baked through the browser's own bakeGeo) +
  manifestOnly(). Retired the same session (L5): **wheels.spec (whole
  suite), asset-space.spec (whole suite), propeller.spec (whole suite),
  subride truck audit (14 pairs), the nested-subgrid census, the x-ray
  fixture census + flowDir, the pick-routing probes** — the @models tier
  is now ENTIRELY node. scene.headless.test.ts: 16 pins over real
  blueprints in seconds. Discovered by the tier (all documented):
  stale-camera-matrix first probes, the census counting the graph
  mid-stream, three's lazily-expanded geometry boxes, select() refusing
  the gizmo attach without TGC (drive captureGesture→writeback directly),
  and Jimmy's rig-chain pivot (P7.1 slice 2).
- Session line: **394 → 267 matrix runs (−32 %), vitest 669 → 732,
  @models = 0 specs, @slow shed 6 legs.** Next: P7.1 slice 2 (rig-aware
  audit bbox — retires Jimmy's last @subgrid leg; then the builders),
  Phase 3 panels (Viewport-mock harness), gizmo/builddock engine legs
  onto the headless probes.

- **v1.12.4 Phase 3 (dialogs + widgets) ✅ + Phase 1 (slice 2) ✅**
  (commits `655d3f3` + `5f9c862`):
  - **jsdom tier 2 → 7 specs (13 → 41 pins).** `tooldialog.test.tsx` —
    the ToolDialog laws on the SHIPPED TOOLS registry through the REAL
    open funnel over the gallery-new starter deck: field grid generated
    from the ToolDef (showIf pair gating, optionsFor source switching,
    range slider + number box, the ONE paint control), preview-gates-OK
    (incl. the empty-craft refusal), Cancel/Esc/✕/backdrop (the
    v1.5.20 subscribe-once law on real dispatched events), and the
    OK ▸ confirm-box ▸ run flow with the danger warning — green values
    transcribed from tools.spec BEFORE retiring (L5): 5 blocks change
    material ▸ all material 3 with colours [4×7] + the doc mirror,
    35 faces on 5 blocks repaint ▸ slot 51, hullify 5 blocks ▸ ≥12 tris,
    confirm step mutates nothing, closes on Confirm. `topbar.test.tsx` —
    Tools ▾ renders the registry, Edit ▾ Undo/Redo carry the history
    state, the vessel TODO rows stay disabled, the mode-tile
    re-click→⌖ contract (KNOWN ISSUE 13 at the component tier).
    `costwidget.test.tsx` — all FOUR cost.spec desktop legs verbatim
    (dolphin + gantry, shipped economy.json through the fetch seam):
    ×4 subgrid · 4 kg Iron · Casing 1 kg Iron · Connector→Wire+Plastic ·
    157 cells · 241 tris · 150.6 m · ×7,362 · 74.8 m · the fold law +
    its reload persistence (fresh mount from localStorage). Seeds with
    no leg retired: `liftwidget.test.tsx` (engine-null seam: the sealed
    5³-shell envelope, per-gas rows, the ladder, the fold) and
    `mirrorglyph.test.tsx` (the data-g glyph + strike contract).
  - e2e retired (L5, same commits): tools.spec 'the menu lists the
    registry' + 'blocks → hull triangles' + 'a COLOUR replace-all' and
    the DATA half of 'replace all MATERIALS' (the leg keeps ONLY the
    stats().loads repaint law — AGENTS: data asserts cannot pin a
    repaint; the tool→toast→undo integration is undo.spec's);
    cost.spec keeps ONLY the phone fit leg.
  - **P7.1 slice 2:** the headless joint-ride audit mirrors the engine's
    blockParts collection (nested Build blocks through their rig pose —
    the e2e audit's rigApplyA/rigPushA verbatim) and carries the
    benchAnchored ANCHOR-CLASS LAW; Jimmy's Adventure audits headless
    and **subride.spec.ts is deleted** — after @models (v1.12.1) the
    **@subgrid tag is now EMPTY** too.
  - Numbers: vitest 737 → **766**; matrix 215 → **200 runs** (session
    394 → 200, −49 %); fast tier wall clock (see the progress commit).
  - LESSONS the tier exposed: (a) **jsdom `getByTestId` THROWS** — the
    tier's first-red family was getBy + toBeFalsy absence probes
    (queryBy/toBeNull only); (b) a **template-literal `new URL()`**
    (`../testdata/${id}/…`) inside a vitest file is GLOBBED by vite and
    fs-DENIED — node-tier file reads go through `resolve(__dirname, …)`
    like harness.ts, never asset-URL templates; (c) React 18's
    testing-library adapter exports NO `afterEach` — importing the
    vitest hook from the adapter kills the suite at import time.
  - Next: Phase 3 panels/build-dock (the Viewport-mock harness — Editor
    mounts the Engine → WebGL), gizmo/builddock engine legs onto the
    headless probes, Phase 4 device harness (modebox/gizmoSize as pure
    fns — NO clean seam exists today; needs a refactor the phase must
    own), Phase 5 hook-channel diet.

- **v1.12.5 THE VIEWPORT-MOCK HARNESS ✅ + pinedit/presets/keys/live-edit
  migrations ✅** (four commits; the session's target — "there has to be a
  lot of functionality that doesn't require an e2e test"):
  - **Phase 3 enabler: `__tests__/harness.tsx`** — `vi.mock` the Viewport
    module (a props-recording stub + a Proxy FAKE ENGINE handed through
    the real `onEngine`; selection pushes back via `onSelection`; the
    engine's hull⇄wire setOption EXCLUSIVITY mirrored so ⚙ rows read
    truthfully) and `vi.mock` crafts.ts (testdata on disk through the
    real `openFunnel`). THE REAL EDITOR MOUNTS in jsdom — ws modes, the
    mirror widget, the build dock, panel editors, doc mirror, undo stack,
    pick routing (driven through the shipped `onBlockPick` callback + a
    settable `pickCell` answer). New tier file `editor.dom.test.tsx`
    (13 pins): dock columns + SIZE-UI absence + row counts, list
    select ▸ ✕ ▸ Ctrl+Z, SQUARE FIX [9,9,9], the MIRROR widget
    axis/glyph/aria/plsym transitions, TRI LIST ±cell + honest 'refused',
    the FLAVOUR law (triangles DRAFT / Modify SELECTS — triAt-owned
    centroid), Modify-opens-EMPTY + pick reveal + part auto-jump
    (TODO G), opt-labels row, w/h keys + exclusivity, MATERIALS row,
    both RGB-picker legs, the twist-row ▸ liveDataEdit routing.
    `balloonskin.dom.test.tsx` (4): the balloon preview laws (dev
    −0.xx/+0.xx m + lift@SL, r=20 number box > 5000 tris, sub-cell
    refusal + ⚖ Fix re-enabling OK, nose/tail tokens + ONE paint
    control finish line). liftwidget (+1): the empty-state copy law.
  - **THE HEADLESS ENGINE grew 20 → 29 pins**: KSP camera-cluster
    eye-snaps + fit() = the load framing (new `virtualControls` harness
    seam — a passive OrbitControls stand-in for attach()); load(keepView)
    camera-carry (undo.spec's Ctrl+Z law); the placement-ghost lattice
    law (⟲ span-swap + whole-cell drag); selection SURGES pumped to every
    arrival with synthetic time (`stepSurges(now)` — no render pump, no
    wall-clock race); label-chip census; setOption exclusivity; MIRROR
    ONE AXIS twin liveness; the v1.12.5 live-edit pair (Propeller twist
    grows the generated blades with the load counter standing still;
    Aileron +27° deflects the flap, MW-NaN/GEO-NaN sweep empty — await
    the `liveEdits` promise chain).
  - **`engine/pinedit.ts`** — the v1.11 UNIFORM MIRROR RULE for prisms
    extracted from the Editor's callbacks (behaviour-neutral): the
    mirrored delta, the mirror-conjugate rotate, the pair-wide flip, the
    identity face-slot paint, the v1.11.0 lookup-before-mutation +
    ATOMIC-clone fixes. `pinedit.test.ts` (12) reproduces the builddock
    TODO D/E values (self +2 x / twin −2 x, pair SURVIVES, normals
    EXACTLY negate, twin wears the slot on the SAME index, refusals write
    NOTHING to bp AND doc). tooldoc +2 (shading=smooth commit; the
    commit writes the LIVE GHOST payload).
  - **e2e retired (L5, same commits, −53 listed runs)**: builddock 9
    (dock columns, list/✕/Ctrl+Z, SQUARE FIX, MIRROR widget, tri list
    ±cell, mode law, TODO D, TODO E — the two 120 s legs; the
    rotate+drag-big-balloon 180 s leg paired to splitface NEVER-DROPS +
    tooldoc rotated-ghost mapping + the headless ghost pin), panels
    TODO G, scene camera presets, undo Ctrl+Z-keeps-camera, sphereskin 7
    (sliders/dev-line, number-box/needles, shading=smooth, ⟲
    quarter-turns, BOTH-bodies-needle, paint-ONE-control), select.spec
    **whole file**, liveedit.spec **whole file**, phoneux ×2 (w-key,
    empty-Lift copy), tools ×3 (MATERIALS, RGB ×2), views ⚙ mirror axis.
    Kept per § 5 everywhere: pixels (viewmenu model, paints, grids,
    dialog fit), real-pointer rituals (pin 3-click + drags, brush click,
    smear place, gizmo multi-grip, hinge drag, TAIL build-to-file, the
    balloon OK ▸ ghost ▸ Build ritual), integration (download, staleness,
    save byte-fidelity, zero-404 atlas, IndexedDB).
  - Numbers: vitest 766 → **807**; matrix 200 → **147 listed runs**
    (session 394 → 147, **−63 %**); fast tier 190 → 137 runs, wall clock
    **1.7 min → 1.5 min** (91 s measured at the cut — the fixed
    `vite build` + preview boot (~35 s) is now ~40 % of the tier; the
    remaining lever is the pixel/ritual count, which § 5 protects);
    @slow unchanged (10).
  - LESSONS the tier exposed: (a) the Viewport-mock harness mounts the
    FULL Editor for ~1 s in jsdom — the fake engine must be a Proxy that
    RECORDS everything and answers only the read-backs (getOptions with
    the exclusivity rule, mirrorAxis, craftMirrorAxes, pickCell,
    onSelection push-back); a fake that drops a read-back (getOptions
    before the setOption-stick fix) presents as a phantom UI bug —
    the fake mirrors scene.ts, it does not invent; (b) the harness's
    `vi.hoisted` config is the only legal per-test knob for vi.mock
    factories (axes for craftMirrorAxes); (c) e2e scrub comments lie —
    the Aileron scrub's "≈ +6° (0.05/px)" was range/400 (0.225°/px) =
    +27°: port the LAW (the measured end state), not the comment;
    (d) the perf tripwire (load.perf candidate 1) goes red under
    CPU-contention with playwright --list — re-run ALONE before
    believing it (measured: 964 ms vs 154 ms solo).

- Phase 1 remaining slices: the transform stack + builders
  (subride/gizmo/wheels/asset-space classes). Phase 3: **the Viewport-mock
  harness LANDED (v1.12.5)** — the panels/dock/keys/materials family is
  now a standing jsdom tier (`__tests__/harness.tsx`); the remaining e2e
  specs are the § 5 "keep" sets (pixels, real-pointer rituals,
  integration, dev-pair). Phase 4: device harness (modebox/gizmoSize as
  pure fns — the cheap half, keys + exclusivity + lift copy, landed with
  v1.12.5; the gizmo-SEAM refactor stays OUT until owned). Phase 5:
  hook-channel diet.
- Phase 1 is the enabler: no e2e geometry leg retires before its node census
  reproduces the green values (L5).
- Metrics per landing (report in the commit message): vitest count, e2e
  run count, fast-tier wall clock, specs retired. Success = the L3 flake
  budget: zero sleep-patches, every flake ends as a migration.
