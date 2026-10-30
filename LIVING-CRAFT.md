# LIVING-CRAFT.md — the craft runs itself (v1.15.6)

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
- `Engine.pressPick(x, y)` raycasts the pressable set → `{kind:'dash'|
  'face'|'comp', ci, ch?, elType?, surfaceKey?, px?, py?}` where px/py are
  the SURFACE's framebuffer pixels (x right, **y DOWN** — the button_rect
  law, wiki dashboard.md).
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
  click cycle). `pressLabel` names: element + channel + the owning
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

## Boundaries (accepted, v1.15.6)
- A device's OWN power draw is not modelled (a hinge consumes LV in-game);
  reachability gates COMPUTERS only.
- `enough_power` in the shim stays a stub (returns 1) — wiring it per
  computer needs a shim/wasm rebuild; the UI warning is the v1.15.6 law.
- Relay gate state, per-joint acceleration shaping, and a standalone
  part's power: follow-ups.
