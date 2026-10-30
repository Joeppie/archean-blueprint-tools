# E2E-INVENTORY.md — every browser test, its purpose, its verdict (v1.12.1)

Companion to docs/TEST-PYRAMID.md. This is the per-test census of
`app/e2e/` (29 specs, 254 runs across the 2 projects), each with the GOAL
it exists to defend and the tier that should own it. Verdicts:

- **KEEP-PIXEL** — the goal IS framebuffer content (WebGL; no lower tier can see it)
- **KEEP-POINTER** — the goal is real pointer → TGC/DOM plumbing
- **KEEP-INT** — the goal is the real IndexedDB/network/save path
- **JSDOM→** — DOM/state wiring; moves to the jsdom tier (Viewport-mock harness)
- **HEADLESS→** — engine law the headless Engine answers today (scene.headless.test.ts)
- **PORTED** — already lives at the node tier (the spec is a thin wiring smoke)
- **RETIRED** — deleted this pass; the note stands in the spec naming the replacement

---

## The big five (74 runs) — where their weight goes

### builddock.spec (34 runs) — dock, place-then-transform, pins
| test | goal | verdict |
|---|---|---|
| dock shows brush/census/list/mirror columns | dock DOM shape | JSDOM→ |
| list row selects, ✕ deletes, Ctrl+Z restores | list↔engine↔undo wiring | JSDOM→ (undo law PORTED: history.test.ts) |
| click lands 1×1×1; widget ✥ ⟳ ⤢; ⤢ STRETCHES | place-then-transform | KEEP-POINTER (click) + HEADLESS→ (blockScale law) |
| ⤢ is BLOCK-only | modebox row gating | JSDOM→ |
| ⇄ twin ON lands mirrored drafted triangle | tri twin placement | HEADLESS→ (mirroredTriangle vitest + triShift) |
| widget ▵ block→hull triangles (+Undo) | blockSkinTris pipeline | HEADLESS→ + KEEP (one DOM click) |
| MIRROR widget axis chips live | widget DOM | JSDOM→ |
| SQUARE FIX 10×10×10 | setBlockField law | PORTED (blocks.test.ts) — retire candidate |
| phone: dock header switch + fits phone | phone layout | KEEP-PIXEL (layout) |
| pins: three clicks + arrow | pin ritual | KEEP-POINTER |
| LIST row → pins + CENTROID widget ✥/⟳ | triShift/triRotate commits | HEADLESS→ (engine triShift/triRotate are programmatic) |
| pin drags FREE 3D + ⇧ axis lock | pointer→plane drag | KEEP-POINTER |
| triangle PAINT brush/face rows | paint write paths | JSDOM→ |
| mode law: TRIANGLES drops pins, EDIT selects | pick routing by mode | HEADLESS→ (pickCell) + jsdom |

### panels.spec (32 runs) — the shell
| test | goal | verdict |
|---|---|---|
| view options hull/wire excl, keys g/o/h | option rows + keyboard | JSDOM→ |
| label-scrub fine control | Num component scrub | JSDOM→ |
| list search→select→inspector; move x; SAVE mirror-synced | panel↔engine↔doc | JSDOM→ (+ KEEP-INT for the SAVE bytes: savefidelity owns) |
| subgrid tab → decoded master + joint slider | panel decode | JSDOM→ (kinematics PORTED: subgrid.test + headless audit) |
| ✎ MODIFY opens EMPTY; pick reveals editor | dock flavour | JSDOM→ |
| Info dock cards 3-across/stacked | layout | KEEP-PIXEL (desktop+phone) |
| static-info ✕/⚙ row; mass/CoM/hi-def/workshop link | panel rows | JSDOM→ (mass math PORTED: mass.test) |
| mobile: no static-info default, compact card; dock always visible | device layout | KEEP-PIXEL |
| gallery → New craft starter deck | file flow | JSDOM→ |
| view tab ONLY vessel stats | view-lock | JSDOM→ + pick law PORTED (headless) |
| wire: select part → free port → connect | wiring UI | JSDOM→ (model PORTED: wiremodel.test) |
| triangles submode: 3 clicks + panel edits | tri authoring UI | JSDOM→ + KEEP-POINTER (canvas clicks) |
| component meta alias+paint write-through | doc writes | JSDOM→ (PORTED: todoc/tooldoc.test) |
| shipped UI: clean title, no debug strip | shipped build | KEEP (1 run, shipped-build smoke) |
| ~~wire mode census+auto-wire+file menu~~ | overlap | **RETIRED → wire.spec canonical** |
| ~~blocks mode: click deck face places~~ | overlap | **RETIRED → builddock/blockplace** |

### sphereskin.spec (24 runs) — the balloon ritual
| test | goal | verdict |
|---|---|---|
| dialog→ghost→cancel/build full ritual | tool pipeline end-to-end | KEEP-POINTER (the ONE ritual) |
| preview lines, sliders, number boxes | dialog wiring | JSDOM→ (plan math PORTED: latsphere.test) |
| tail section + TAIL SWEEP-DIRECTION | panel kinematics from world coords | HEADLESS→ (jointChain pinned; scene-level = headless Engine subGroups probe) |
| rotate+drag big balloon: FILE area == ghost | splitFace/transformSkinTris commit | HEADLESS→ (latsphere.test covers the math; ghost→file equality portable) |
| sealed badge, volume land, paint finishes | law PORTED (atmo/tooldoc.test) | JSDOM→ |

### wire.spec (18 runs) — cable workspace
| test | goal | verdict |
|---|---|---|
| cable list BOTH endpoints per row | WirePanel DOM | JSDOM→ |
| hover cable → label + gold-light | dwell pipeline | KEEP-POINTER (the thin seam leg; dwells PORTED: clocks.test) |
| hover ROW gold-lights cable | previewHover | JSDOM→ + headless setPipeHover |
| disconnect → gone → Ctrl+Z | doc write + undo | JSDOM→ (undo PORTED) |
| reconnect onto SAME ports | candidate flow | JSDOM→ (model PORTED) |
| auto-wire idempotent | engine + doc | PORTED (wireops.test) — keep 1 UI leg |
| BLOCKED truck: cuts>0 + ≥2 surges + restore | PIXEL episode | KEEP-PIXEL (@slow; census PORTED: xray.test+fixture) |
| ONE-WAY pulses one way | flow pixels | KEEP-PIXEL (@slow; dir law PORTED: fixture flowDir) |
| phone cable list fits | layout | KEEP-PIXEL |

### tools.spec (16 runs) — ToolDialog framework
menu lists registry / Cancel no-op / replace-all / hullify confirm box /
dialog cap + scroll / MATERIALS row / colour replace-all / RGB new-slot /
RGB nearest — all dialog DOM + tool math **PORTED** (tools.test.ts,
tooldoc.test.ts) → **JSDOM→** en masse; KEEP 1 desktop pixel leg (dialog
≤ viewport) + KEEP 1 phone clear-zone leg.

## Mid specs

### phoneux.spec (14) — device law matrix — KEEP-PIXEL (CSS layout needs a layout engine); gizmoSize + edge-dock VALUES portable to P7.4 device harness (vitest); the w/h keys JSDOM→
### viewmenu.spec (12) — KEEP-PIXEL en bloc (see-through ground, backdrop swap, ortho dome, persistence) — the MODEL of what the e2e tier is for
### undo.spec (10) — stack PORTED (history.test.ts); tool round-trip KEEP (wiring); **Ctrl+Z camera-keep → HEADLESS→** (viewState() public); Delete key JSDOM→; hullify+tri-select (triAt PORTED, gold-highlight pixels KEEP); dialog drag KEEP-POINTER
### scene.spec (10) — boot smoke KEEP; KSP camera presets HEADLESS→ (viewState); real canvas tap→chip KEEP-POINTER; craft-switch rebuild KEEP (1); giant phone budget KEEP (@slow size law)
### cost.spec (10) — tree math PORTED (economy.test); rows/expand/fold JSDOM→; mobile fit KEEP-PIXEL (1)
### place.spec (8) — catalog place click KEEP-POINTER; atlas ZERO-404 KEEP-INT (network); real-model ghost + smear KEEP-POINTER; live thumbs KEEP-PIXEL (WebGL thumbs)
### app.spec (7) — gallery/editor nav + endpoints: KEEP-INT (routing, serving)
### views.spec (6) — coord chip DOM + y-rise: engine half PORTED (coordChipText + coordHoverMove headless-capable), chip visibility KEEP (1); axis markers DOM; grid footprint HEADLESS→ (gridInfo public); mirror-axis rows JSDOM→ (axis math PORTED: blocks.test)
### gizmo.spec (6, @slow) — KEEP-POINTER core (multi-grip ring continuity, poisoned-prefs recovery); writeback algebra PORTED (viewer gizmatest + headless gizmoRotateViewDeg drives in the joint audit)
### paint.spec (5) — badges/face rows JSDOM→ (census PORTED: palette.test); twin face paint lands on TWIN — HEADLESS→ (mirrorFaceOrder pinned; scene-level paintTwinPair portable); overlay pixels KEEP (1)
### staleness.spec (4) KEEP-INT (IndexedDB + gate + zero-network)
### select.spec (4) — surge pixels KEEP-PIXEL; labels opt-in HEADLESS→ (labelState)
### mirror.spec (4) / mirror-mismatch.spec (4) — twin math PORTED (blocks/sym.test); placement twins + ⚠ popup: jsdom (DOM) + 1 pixel overlay leg; mirror-plane option round-trip HEADLESS→
### help.spec (4) — wiring + viewport fit; behaviour PORTED (helpdialog.test.tsx)
### blockedit.spec (4, @place) — widget law: attach/refuse/cell/turn/⤢ — HEADLESS→ (blockGizmoShift/Rotate/Scale are programmatic, block cells pinned blocks.test); keep 1 real-drag leg
### sym.spec (3, @slow) — slider mirrored-delta (math PORTED sym.test; UI JSDOM→); XYQ UNISON HEADLESS→ (jointChain + propagate pinned; scene-level = joint-audit pattern); plane option HEADLESS→
### savefidelity.spec (3) KEEP-INT (bytes through the real save path)
### download.spec (3) KEEP-INT
### liveedit.spec (2, @live) — data→geometry live: HEADLESS→ (liveDataEdit + compRealBox); panel scrub KEEP-POINTER (1)
### hinge.spec (2, @slow) KEEP-POINTER (canvas hinge drag); hinge math PORTED (subgrid.test)
### blockplace.spec (2, @place) — ghost aims (pickCell HEADLESS→), Shift continuation (PORTED blocks.test), click lands KEEP-POINTER (1)
### aero.spec (2, @slow) KEEP-PIXEL (live tunnel; physics PORTED aero.test)
### subride.spec (1, @slow) — Jimmy rig-chain pivot → P7.1 slice 2 retires (truck audit PORTED headless)
### xenonphone.spec (1, @slow, pixel7 OPT-IN, v1.13.32) KEEP-POINTER (phone IDE: rail→drawer, code-pane width, code scroll, title-bar ⏹/▶; chromium leg skips via isMobile) — the v1.13 xenon/xenondbg/xenonfresh IDE batches predate this census; their v1.13.32 legs (tab-strip hover-wrap, ide-* in the title bar, .var-flash) ride xenon.spec's tiers.
### xenonhud.spec (3, @slow, v1.14.0+v1.14.1) KEEP-INT + KEEP-PIXEL (the HUD IDE saves into the blueprint-baked data.xc_files; the beacon scope lists the craft's REAL frequencies, a send lands in a listener's log; the RUNTIME leg: guide HUD ▶ → panel canvas pixels lit + the guide's beacon transmits land in Beacon ci 114's rx log) — registry + owner semantics PORTED (beaconnet/runtimemgr tests); the pixel/loop legs stay e2e.
### xenonfarm.spec (1, @slow, v1.15.0) KEEP-INT (TWO real VMs co-running on one page: the INTERCOM bench's radio-led + mirror bus rows appear only via the cross-computer beacon/io paths; closing one window leaves the sister ON) — IoBus cable law PORTED (farm.test); the two-VM leg stays e2e.
### living.spec (1, @living @xenon, v1.15.6) KEEP-INT (the LIVING CRAFT chain over the LIVE BENCH 9000009040: auto-boot cadence + the hinge plate AND its subgrid swing ~90° in the live scene + a REAL pointer press on a 3-D dashboard element → the program's input_number READS 1 + the live-screen chip names `button_rect(20, 20, 80, 24) @ main.xc` → the click's print lands + the unpowered IDE ⚠ chip). Power/devicesim/xcsites/scene.headless carry the laws; the real-pointer-press-into-the-VM + auto-boot cadence stay e2e. Excluded from the pixel7 matrix (pointer/hover laws).

## Overlap groups (the audit this pass resolved)

1. **cable render law** — pipes.spec ⊂ wire.spec+headless → **RETIRED pipes.spec** (4 tests → scene.headless 'cables render like the game', verbatim, 4/4 green).
2. **auto-wire / census / file-open in panels** ⊂ wire.spec + app.spec → **RETIRED 2 legs**.
3. **deck-face click-to-place** in panels ⊂ builddock+blockplace → **RETIRED**.
4. **mode-tiles workspace display** in place ⊂ panels → **RETIRED**.
5. **grid zoom ladder** in views = grid.test.ts → **RETIRED** (footprint leg kept).
6. **frame-centre pick** in scene ⊂ headless pick routing → **RETIRED**.
7. **⤢-stretch law** appears in blockedit + builddock → keep blockedit's widget leg as canonical; builddock's is the *auto-attach on fresh placement* law — retitle-only (kept).
8. **boot+render** (scene.spec 'scene loads', app.spec 'card click renders', '?craft= deep link', every spec's SCENE PASS poll) — accepted: one smoke each, the SCENE PASS gate is the suite-wide health probe.
9. **twin glow pixels** (sym, mirror-mismatch, paint, blockedit) each boot a gantry — merge candidates for one `twin.spec` when the jsdom tier absorbs the DOM halves; the pixel half stays 1 leg.
10. **surge pixels** (select.spec + wire BLOCKED) — same engine path; select.spec keeps the selection-surge law, wire's is the X-ray-transition law: distinct triggers, keep both.

## Result + target

Landed this pass: **matrix 267 → 254** (pipes −8, overlap legs −6);
pipes law now 4/4 green in vitest. The JSDOM→ wave (panels/tools/cost/
builddock/builddock-list/undo-keys/wire-UI ≈ 90 runs) needs the
Viewport-mock harness; the HEADLESS→ column (≈ 35 runs) needs only probes
the headless Engine already answers. Target steady state: ~110 runs
(pixel + pointer + integration + one smoke per boot class), vitest
absorbing the rest.

## CHAIN LAW wave (v1.12.1, same day) — 254 → 213 runs

Tests that share ONE boot + compatible state now run as single chained
tests: named `test.step`s, `expect.soft` for laws (violations accumulate,
the chain NEVER short-circuits on a failed assert), hard gates only where
the state premise breaks (boot, episode-open). Discipline: each step
restores what it mutated; the LAST step is the one allowed to leave
pollution. Boots saved: views 4, viewmenu 6, gizmo 6, wire 8 (the two
@slow truck legs share the truck boot, the surge sampler AND the 375-cable
census scan — it ran TWICE), panels 14 (shell chain, editors chain,
starter-craft chain, mobile chain).

## BOOT COST (v1.12.1) — 1823 ms → 900 ms per test boot

- **Production preview**: Playwright now drives `vite build && vite
  preview` (the corpus plugin's `configurePreviewServer` serves the same
  /corpus, /models, /atlas, /viewer, /testdata routes as dev — the Pages
  layout). The dev server's per-boot 300-module transform waterfall
  collapses to a few hashed chunks; the suite also exercises the SHIPPED
  bundle. `E2E_DEV=1` falls back to dev for single-spec iteration.
- **iGPU GL**: launch args `--use-gl=angle --use-angle=vulkan` +
  `VK_ICD_FILENAMES=radeon_icd.json` (the same pin tests/run_tests.sh
  uses; the NVIDIA ICD stays hidden from chromium — the 5090 is never
  contended). Headless SwiftShader was costing ~575 ms per boot in
  software-rendered first frames; pixel-probe suites (viewmenu, scene)
  verified green on real GL.
