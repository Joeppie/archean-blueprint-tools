# LIVING-CRAFT.md — the craft runs itself (v1.15.6; appkit bus, power flow,
# items and sound v1.16.10)

Satellite of AGENTS § Xenon workspace + § Interaction. Provenance:
docs/HISTORY.md §1 (v1.15.6). We: "computers should start when a craft is
loaded in, and parts need to respond to signals … hinges and buttons and
pivots and ailerons actually move. And if a pivot or hinge moves, so does
its subgrid … button presses onto dashboards and screens should actually
work on the 3d model and propagate … we should have a hand with finger
cursor to indicate it's press able, and it should tell us what channel/ui
element … which xenoncode line … the specific e.g. button_rect and line
number and computer this corresponds to as a popup label … if a computer
is unpowered, according to craft design, show a warning when we interact
with it."

Four laws, four modules; the io bus is the spine.

## 1. THE SIM IS A VIEW (`engine/devicesim.ts`)
The bus carries `(device, channel, value)`; DeviceSim says what they MEAN,
with the GAME's own semantics (wiki `en/components/joints/*.md`,
`lights/Lamp.md`, mirrored in `viewer/models/channels.json`):

| type | channel | law |
|---|---|---|
| SmallHinge | 0 | servo ONLY: v·90° (`.ini` limits [−90,0,90]) |
| SmallPivot | 0 | servo v·360°; `servoMode:false` → v·maxSpeed rot/s |
| LinearTrack | 0 | ABSOLUTE metres, clamped to minPos..maxPos (overrideLimits → manualMin/MaxPos); velocity = v·maxSpeed m/s |
| Lamp/SpotLight/SlopeLight | 0..3 | Off/On + RED/GREEN/BLUE 0..255 |
| Propeller | 0 | speed −1..1 (visual spin) |
| Wheel/BigWheel/SmallWheel | 0,1 | Accelerate (axle spin) / Steer ±30° |
| ToggleButton/PushButton/ArrowButton | 0 | the `.ini` axle lever tips (limits [18,18,−18]) |
| Aileron/Elevator/Rudder | pilot | deflection = PilotSeat Roll/Pitch/Yaw channel · joint limits |

- Rate limits: hinge/pivot `maxSpeed` rot/s ·360; track `maxSpeed` m/s;
  `acceleration` fields are stored for shaping (v1.15.6 first-order).
- SIM IS A VIEW: `step(dt)`/`snapshot()` feed an OVERLAY the scene renders
  (Engine.applyDevicePoses). **Nothing writes the blueprint** — saves stay
  byte-identical, the undo stack never sees a simulation frame. A
  program-driven hinge turns its plate (`applyJointPoses` overlay keyed by
  manifest joint NAME) AND its SUBGRID panel (`syncSubJoints` reads the
  same overlay via `simMasterState`) — THE PANEL RIDES ITS MASTER.

## 2. THE ACTUATOR TAP (`engine/xenoncode.ts` IoBus / Farm)
`IoBus.write(alias, ch, v, from, dev)` — the writer's pump resolves its
io/alias to the `XCDevice` (component ci + type); `observeDevices(cb)` is
the tap the Editor wires to DeviceSim. THE CABLE LAW unchanged (the
channel is the device's, every pump wired to it reads it).
`Farm.pressDevice(devCi, ch, v)` = a HUMAN press: drives **each pump's OWN
io number** for the device (a numeric io is a per-computer port — it goes
through `pump.setInput`, never a shared alias key that would land on a
sister's wrong port), fires the tap once, and records the bus value.
`Farm.autoboot(comps)` boots every programmed computer (power-gated by
the caller).

## 3. THE POWER LAW (`engine/power.ts`)
Reachability over `data.pipes` with the wiremodel's source→hub→device
physics, per voltage kind (low/high are SEPARATE nets; a computer's
`power_connector` is low-voltage). **The dev-craft convention**: a craft
with NO power source is power-UNAWARE (every computer powered — the corpus
is full of benches with no grid); the moment a craft HAS a grid, a
computer not on the net is UNPOWERED — the game would never boot it
(`enough_power` reads false). Effects:
- **Auto-boot** (the LIVE chip ▶/⏸, persisted `archean-app-live`, default
  on): every programmed, POWERED computer boots with the craft; the farm
  auto-boot skips unpowered ones; the VMs OUTLIVE the IDE windows (the
  craft keeps running while you look at it); a craft swap re-boots fresh.
- **Warnings** on interaction: a ⚠ chip in the IDE title
  (`[data-testid="xenon-unpowered"]`), a toast on F5-RUN, and a ⚠ suffix
  on the press popup. The dev may still RUN an unpowered computer (a dev
  bench is a dev bench) — it is never silently dead.

## 4. THE 3-D PRESS LAW (`engine/scene.ts` + Viewport + Editor)
- `buildDashboard` tags every element box `userData.dash = {ci, ch, type,
  surfaceKey?}`; `buildReal` tags standalone Toggle/Push/Arrow parts.
- `Engine.pressPick(x, y)` raycasts the WHOLE scene → `{kind:'dash'|
  'face'|'comp', ci, ch?, elType?, surfaceKey?, px?, py?}` where px/py are
  the SURFACE's framebuffer pixels (x right, **y DOWN** — the button_rect
  law, wiki dashboard.md). Three laws ride the pick:
  **OCCLUSION** — the FIRST solid hit must BE the pressable (a ray that
  grazes a part and lands on the dashboard behind it is a click on the
  part, never a press through it); a part's **STAND-IN BOX** (userData
  kind 'comp') IS the part (lite crafts have nothing else); **LABELS are
  print, not controls** (wiki DashboardTool.md: Toggle/Push/Arrow/Led/
  Screen/HdScreen press, a Label occludes — the finger cursor is a
  promise, not a decoration).
- Viewport rides the 40 Hz hover cap: a **pointer cursor** on a pressable
  + a mono **press-chip** (`[data-testid="press-chip"]`) carrying the
  label; pointerdown/up own the gesture (`setPressCapture` disables orbit
  — a press is a CLICK, never a camera drag; the element SINKS 4 mm, a
  latched Toggle stays sunk). Presses work in EVERY mode (a press is an
  INTERACTION, not a selection — the VIEW-is-inspect law stays whole).
- Editor `onDashPress`: a button writes the device channel via
  `pressDevice` (every owning computer's pump, its own io) + latches a
  Toggle (wiki ToggleButton.md), momentary for Push/Arrow/Led; a screen
  press is a `screenClick` (the game's `button_rect`/`click` evaluate the
  click cycle).
- THE SPARE-BUTTON LAW (we, on the dolphin's door toggles: "they should
  still be able to toggle and they toggle the hinges that are in that
  craft"): the pressed channel drives the actuator CABLED on the other
  end of its data port (`dataNeighbours`, pure — FLATTENED pipe indices
  skip nested parts, which the top-level sim cannot run); with nothing
  running the button (NO PROGRAM reads its channel — alias registration
  alone is not a reader) and nothing cabled, the latched state
  BROADCASTS to the craft's servo actuators (hinge/pivot/track, both
  directions — OFF is the closing press). The popup names what a bare
  part drives: `→ drives <neighbour>` / `→ toggles the craft's N
  actuators (no computer attached)`; `no computer reads it` only for a
  truly dead part.
- THE CODE BUTTON (we: "when I press the code button for a HUD or
  computer, or minicomputer … I want of course to open its xenoncode"):
  a programmable part's mode widget carries ⌨ — `openCodeFor(ci)` opens
  THAT computer's XenonCode IDE (HudController → the HUD IDE); the
  XenonCode ▾ menu routes through the same one path. `pressLabel` names: element + channel + the owning
  computer + io + the literal PROGRAM LINE (`xcsites.ts`: `chanSites` for
  a channel, `rectsAt` for a screen pixel — the LAST containing
  button_rect wins, draw order).
- `xcsites.ts` is a TEXT scan (like `detectChannels`) — only LITERAL
  geometry gets a popup; the popup names CANDIDATE lines, it is not an
  AST.

## Fixtures + pins (smallest tier that states the law)
- `tools/make_live_test.py` → `testdata/9000009040` (LIVE BENCH): battery
  → junction → cpu power_connector (cpu ON the net, boots; ghost has a
  program + NO power cable → the ⚠ law); hinge/pivot/lamp cabled to cpu
  data ports; the hinge masters a one-panel subgrid; a Dashboard with
  Toggle/Push/Screen, the program drawing a LITERAL
  `button_rect(20, 20, 80, 24)`.
- vitest: `power.test` (net laws + the fixture census), `devicesim.test`
  (every actuator law), `xcsites.test` (the popup scanner).
- scene.headless: the sim pose swings the plate AND the subgrid group,
  `data.angle` stays verbatim; the dashboard registers its pressables.
- e2e `living.spec.ts` (excluded from the pixel7 matrix — pointer laws):
  auto-boot cycles, hinge+panel ~90°, finger cursor + popup naming
  'cpu', press → the program READS 1, the live screen chip names
  `button_rect(20, 20, 80, 24) @ main.xc`, the click's `print` lands, the
  unpowered IDE carries the ⚠ chip.
- `app/tools/livingprobe.mjs` — the node probe that drove the geometry.

## 5. THE APPKIT BUS (v1.16.10, WP1 — the third-party ecosystem runs)
Chip Patton's ChipOS + App Kit apps are REAL programs (fixture 9000009050
embeds the OS + Tetris + HELLO + EarthNAV verbatim). The farm's law:
- THE ROUTER NET: xenonDevices walks Router/MiniRouter/DataBridge/
  DataJunction chains — every net device carries the computer's LOCAL
  port (device_at().port, alias→io, input.N routing). Direct plugs keep
  their own ports.
- SHIM ABI 16 (XENON-DEVCHANS): alias-addressed io is PER-DEVICE (a
  router net hangs many devices on ONE wire; the appkit channels must
  not alias each other); alias writes mirror onto the port's wire; every
  port whose channels receive a value FIRES its input.N handler
  (RunInput — the appkit's event delivery). xc_set_input_ti feeds text
  by device key; xc_set_virtual_dt(ms) fixes dt for deterministic
  headless cycles (the browser pump never sets it — the real-dt law
  stands).
- IoBus fans TEXT (the manifest/frame/event transport) and publishes
  every computer's transmission UNDER ITS OWN ALIAS (ChipOS polls
  input_text(appAlias,0); a computer's alias row is what IT transmits —
  game-faithful, no one reads a computer's alias row as an input).
- Pins: chipos.test (8, real wasm): the device tables, the boot census
  print, the relay assert, the TETRIS/HELLO/EarthNAV manifests, THE
  REGISTRY (xa_alias joins the apps), the synthetic appkit pair
  (full-duplex RunInput). e2e chipos.spec: the manifests cross pumps on
  one page and the IDE bus rows show them.

## 6. THE FLATTENED-ENDPOINT LAW (v1.16.10, the Jimmy catch)
`data.pipes` endpoints index the FLATTENED component array (nested
content numbers BEFORE their Build). EVERY top-level reader maps through
engine/flat.ts (flatToTopMap/flatEndpointTop): power.ts, xenonDevices,
devicesim, energy, itemsim. Off-by-nested-count wiring read Jimmy's
computer as UNPOWERED (the farm stayed off) and his HV drill as LV.

## 7. THE POWER FLOW (v1.16.10, WP5 — engine/energy.ts)
Sources PRODUCE (wiki watts: solar 2700, RTG 12 kW, diesel 150 kW data-
gated, steam turbines gated on a heat source riding the craft);
consumers DRAW (lamps at authored maxPower gated by ch0, belts 100 W,
the drill 10 kW LV / 100 kW HV by the cable it rides, motion classes by
their live channel). Batteries STORE (LV 10 kWh, HV 120 kWh, authored-
charged start FULL); the balance integrates shared by capacity; charge
MAY GO NEGATIVE (deep discharge, floored at −capacity) and the grid
ALWAYS KEEPS FEEDING — power.ts reachability is untouched: the deficit
is a WARNING (the ⚡/🔋 TopBar chip: ok/charging/low⚠/deficit⚠ + the
census panel). Pins energy.test (10) incl. the Jimmy census.

## 8. ITEMS ON BELTS (v1.16.10, WP6 — engine/itemsim.ts)
SIM IS A VIEW. Links: ① the game's own `item`-type CABLES — port names
give the direction (item_output/item-out push, item-in receives, hub
pairs bidirectional); ② touching occupancy AABBs (gap ≤ 0.8 m) as the
cable-less fallback. The drill mines while ANCHORED + powered +
data-gated-open (10/s LV, 100/s HV); items hop links at belt cadence;
the Crusher processes Rock→CrushedRock; Containers store (50-slot
stacks) and PUBLISH their content as the wiki data-port KV text ONTO
THE IO BUS (input_text('container',0) reads '.Rock{12}…' — the Crafter
built-in and ChipOS's mining page READ the inventory); the stylised
Crafter cycle consumes a payable economy.json recipe and produces back.
scene.ts: ONE InstancedMesh of tumbling cubes; TopBar ⛏📦🔨 chip.
Pins items.test (8) + the Jimmy cable census. clear() zeroes counts and
KEEPS the container nodes (the React reboot path calls it right after
load — the browser probe caught the emptied-map variant).

## 9. THE SOUND OF THE CRAFT (v1.16.10, WP4 — engine/soundscape.ts)
All cues SYNTHESIZED (the game's audio assets stay untouched — NOTICE).
The bus tap fires edges: switch CLICK, relay CLACK, lamp blip, anchor
CHAIN RATTLE, servo whine; the loop census runs the drill WHIR, belt
rumble, pump burble, propeller hum; the grid alarm is a 20 s-spaced
two-tone on entering low/deficit; the crafter DINGS. The 🔊 chip is the
gesture that arms the AudioContext (the buzzer law: create+resume inside
the click, Firefox 1-frame unlock); `archean-app-sound` default on.

## 10. THE GLOW LAW (v1.16.10, WP3)
A sim-lit lamp is a LIT FACE (MeshBasic lens / emissive LED), NEVER a
THREE PointLight/SpotLight: casting per lamp is too heavy for an editor
(we, 2026-10-31: "light should just show as being on, not actually cast
a light"). Pinned by the scene GLOW LAW test (castLightCount stays 0).

## THE JIMMY PROBE (app/tools/jimmyprobe.mjs — WP7)
The living-craft census over 3334698274: FARM (crafter-28 + GIANTPLANE
co-run), ENERGY (744 kW of RTGs vs a 107 kW load, the drill at 100 kW,
600 kWh full), ITEMS (drill→cables→container, mined/in-transit counters),
PRESS registry, ZERO console errors. Re-run it after ANY engine change
that touches power/devices/items/the bus.

## 11. THE NET-SCREEN LAW (v1.16.11 — the 3828773626 blank screens)
ChipOS's display.xc binds dashboards to surfaces with RUNTIME variables
(`screen($dd_a,$dd_c)` for an aliased board, `screen($dd_p,$dd_c)` for a
bare one) — NO static scan of the program sees them. `xenonNetScreens`
pre-registers every Screen/HdScreen element of every Dashboard on the
computer's ROUTER NET, keyed by the lowercased alias (aliased) or the
io-number token (bare) at the 6 px/unit element size, registered before
boot (xc_addScreen first-wins beats the 640×480 seed). `setScreenFeeds`
binds ALL keys of a board to ONE DataTexture; the LIVE farm's auto-boot
feeds the 3-D boards with NO IDE open. Pins: xenoncode.test (net-screen
law, alias + io tokens), e2e netscreens.spec (auto-boot → ink on the
faces). The dev kit 3828773626 is the standing audit; netscreenprobe.mjs
reports the feed registry + push counts + ink.

THE NEVER-PAINTED GATE (v1.16.12 — the user's flicker + black-window
report): the net law registers EVERY board on EVERY router-net computer,
so the idle app-1/app-2 pumps hold the SAME keys ChipOS paints. The shim's
screen write-counter counts the constructor's bg fill as #1 — a surface at
seq ≤ 1 has NEVER been painted by that program, and NEITHER pump mode
(main-thread fetchVersioned, worker pixelsFor) ships pixels for it.
Without the gate every pump pushed the same key every cycle: black buffers
fighting the painter frame-by-frame (visible flicker on the 3-D boards)
and the ▣ SCREENS dock — which shows the ACTIVE pump, the last-booted
app-2 that paints nothing — a wall of black windows. The dock now merges
the farm's PAINTED surfaces per key (the painting pump owns the cell); the
ACTIVE pump contributes its surfaces WHOLESALE — a dock cell's canvas is
what puts a surface into the pump's want-set, so the dock IS the bootstrap
for auto-created + virtual surfaces (painted-only listing deadlocks them:
no cell → no canvas → no want → no pixels). Net-PROBE artifacts (a program
addressing screen($alias, ch) beyond a board's element count — ChipOS's
span scan seeds #8..31 at 640×480) stay out: registered alias base +
channel beyond the registered ones = probe, not surface. Pins:
xenonvm net-screen legs (idle app-1 seq ≤ 1 / chipos paints), e2e
netscreens dock leg (farm-merged cell visible + press-to-repaint push),
xenon.spec Screens-tab leg (the virtual bootstrap).

## 12. ROUTER POWER GATING (v1.16.11 — the deferred v1.16.10 design)
Mini/Router carry a `[ADAPTER lowvoltage]` and ARE the alias resolvers, so
an UNPOWERED router drops its whole subtree from every computer's
device/screen/bus space (walk it gated AND ungated; a component whose only
net path crosses a dead router loses its alias entry too).
DataJunction/DataBridge carry NO power port — passive conductors, never
gated (Jimmy's DataJunction nets are untouched). The Editor feeds
`computerPowered(powerNet, ci)` (a grid-less craft answers true, the
power-unaware convention). Pins: xenoncode.test (dev-kit census: router 6
fed keeps the boards, router 11 unfed drops its sensors; cutting router 6's
feed drops the net-screen registry).

## 13. THE FLIGHT LAB (v1.16.11 — forces on the shape field)
`engine/flightlab.ts` turns the aero shape census into the game's forces:
thin-broad planform (broad-planform filter per thickness-axis scan),
Diederich lift curve, STALL ≈ 15° with a flat-plate shed, fineness form-drag
+ Re skin-friction + induced, the EMERGENT pitch static margin (mass CG vs
neutral point, % MAC) and a fin yaw margin, and control authority per
Aileron (q·A·lever) with a buried-plate census. The WindPanel FLIGHT
ANALYSIS section renders verdicts + a lift curve; the fixture pair 9000009080
(stable: CG ahead) vs 9000009081 (identical airframe, ballast moved aft →
divergent) pins that stability lives in the CG, and 9000009082 the flying
brick. Stylised closed-form, not CFD (AGENTS). See FORMAT §Aerodynamics.

## Boundaries (accepted; v1.15.6 base)
- A device's OWN power draw is not modelled (a hinge consumes LV in-game);
  reachability gates COMPUTERS only.
- `enough_power` in the shim stays a stub (returns 1) — wiring it per
  computer needs a shim/wasm rebuild; the UI warning is the v1.15.6 law.
- Relay gate state, per-joint acceleration shaping, and a standalone
  part's power: follow-ups.
- v1.16.10: `enough_power` in the shim stays a stub (the UI/energy warning
  is the law); steam turbines gate on a heat source PRESENT, not on the
  fluid loop; the Crafter cycle is stylised (economy.json recipes, the
  built-in program rides the farm and reads the container KV); nested
  (subgrid) parts stay outside the top-level sim's registered space.
- ChipOS's wizard: the e2e/VM tiers read the registry via the storage
  row + the bus; the click-through wizard + app-tile pixels are the
  Pages-tier UX journey (the wizard gates the home screen).
