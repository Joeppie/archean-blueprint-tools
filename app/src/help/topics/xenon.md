# Xenon — run the craft's computer programs
Tags: xenon worldsim world sim xenoncode window zoom drag resize fullscreen computer code program ide screen hd-screen virtual screen nodes canvas programing programming plomo firstflight badger mario wasm interpreter variables vars local locals disk files edit breakpoint debugger step frame autosave shadow deep link dash filter search cockpit keyboard wasd jump run space buzzer sound sawtooth melody super mario gamer-chair 25 hz tile flush mobile phone touch buttons pad

**Xenon ▾** (top bar, on any craft that carries a `MiniComputer` or
`Computer` — a freshly placed one included, its first program authored
right in the IDE) lists every programmable computer on the vessel. Clicking one
opens the **XenonCode IDE** — the same look as the in-game window: title bar
with the ON indicator, the File/Library/Computer menu row, one tab per `.xc`
file, line-numbered code, and the `Program 'name' loaded / is running…`
status lines at the bottom.

> **Work in progress** — the programs genuinely run on the developer's own
> interpreter, and the io around them is REAL (worldsim channels feed every
> `input_number`, cockpit keys feed the PilotSeat, Buzzer components make
> sound, dashboards paint and are clickable). What is not simulated: power,
> fuel, and the world answering the craft. Treat a game like Mario as fully
> playable; treat autopilot code as honest CODE view.

The computer runs at a **25 Hz** cycle cadence (25 program cycles per second,
`delta_time` ≈ 0.04 s — dt-driven programs like Chip's Mario run in real
time).

## What the IDE gives you

**It really runs.** The interpreter is the game developer's own XenonCode
code, compiled to WASM (pinned upstream, see `tools/xenoncode/` in the repo);
the program from the blueprint is compiled at open, exactly as the game's
computer does at power-on. The files live **in the craft** — the virtual
disk is the blueprint's `data.hdd.xc_files`, so everything you do here saves
with the craft and travels in the file.

* **Editing + the virtual disk** — `✎ edit` opens the file as a text editor
  (every line, no cap — huge 16k-line firmware files scroll fine). `💾 save`
  (or `CTRL+S`) writes the file back into the craft and the computer
  **auto-reboots on the new code**, the game's rule; `save all` is
  `CTRL+SHIFT+S`. **F5 runs the code**: it saves what you are editing (and
  so re-boots on it) — with no draft it just re-boots the computer from
  disk. The page only refreshes on F5 when NO computer or Screens window is
  open. The `File ▾` row shows the disk and **creates** files
  (plain `.xc` includes, or `program` → `name.main.xc`) and **deletes** the
  open tab. Files you create are in the saved blueprint and in the game.
* **Find in file** — `CTRL+F` opens the editor's find panel from anywhere in
  the IDE (it never triggers the browser's own search). `Esc` closes find
  and leaves the IDE open.
* **Library tab** — the side panel's `Library` index lists every **declared
  function on this computer** (click = jump straight to its declaration,
  across files) and the whole **built-in XenonCode library** with a
  signature and a one-line meaning each, plus the `screen.` drawing
  members. The search row filters all three groups at once.
* **Maximise** — the `⛶` button in the title bar (or a **double-click on
  the title bar**) fills the screen; the same control restores the window
  to its old size and place.
* **Screens** — programs call `screen(alias, channel)`: `alias` is a
  Dashboard's name (or its io port number) and `channel` counts its
  elements. The bound `Screen`/`HdScreen` surfaces paint live at their real
  pixel size, the craft's 3-D dashboards display the same raster on their
  panels, and the **▣ Screens** button (top bar, on crafts with dashboards)
  opens the bottom tab with **Dashboards** and **Virtual** sub-tabs — the
  virtual ones are the `virtualscreen(w,h)` buffers a program composes
  (Chip's Badger builds its attitude display out of those).

## Dash windows — zoom, filter, deep link

We: "640×480 dashboard too small to read, clicking makes it worse, no
zooming, no filter". The dash windows are now the read/write surface:

* **Click a dashboard cell to open it full-screen.** The tiny thumbnail in
  the dock no longer sends its click to the program (so a mis-click cannot
  press a `button_rect` and change the screen under you). A **click on the
  thumbnail opens a dedicated zoom window** for that ONE surface: **fit /
  1:1 px / + / −** buttons, pinch or **Ctrl+wheel** to zoom, scroll/drag to
  pan. The pixels are sharp (`pixelated`), so a 640×480 panel is readable.
* **Clicks in the zoom window ARE the program's** — they land on the
  surface at its exact pixel coordinates, and the game's `button_rect`
  buttons evaluate true exactly as in game. This is where you press the
  dashboard buttons.
* **A search box** (▣ Screens header, and the IDE's Screens tab) filters
  the surfaces by name, so a 118-buffer craft (the Badger) is navigable.
* **▦ Tile** (▣ Screens header): collapses the spacing between dashboards
  to ZERO — gaps, padding, borders and labels off — so multi-panel walls
  (Mario's six HdScreens, a craft's full dashboard row) tile flush and read
  as one continuous surface. Click again to restore; persisted.
* **Play on your phone** — on touch devices the screen itself carries a
  TRANSLUCENT COCKPIT PAD: a W/A/S/D cross at the bottom-left, ▲ ▼ E F ␣
  at the bottom-right. Pressing a button is the key-DOWN (the seat channel
  goes to ±1), letting go is the key-UP (the stick centers); sliding a
  finger off a button releases it too. The pad rides the fullscreen zoom
  window and every tile in ▦ Tile mode — a phone + a deep link is a
  handheld console. Tap a plain thumbnail (no pad in the browse grid) to
  open its zoom window, and the pad is there.
* **Deep link** — `?craft=<id>&dash=<surfaceKey>` (e.g.
  `?craft=3820116990&dash=first-virtual`) opens the app straight into the ▣
  Screens dock **with that one surface's zoom window already raised**, as
  soon as it paints. `#` is `%23`; the surface key is the lowercase
  `alias#channel` shown under each thumbnail — and `first-virtual` focuses
  the FIRST virtualscreen (a game's composition canvas, e.g. Mario's
  900×600, which is where the game actually renders).

## Cockpit keys — fly the craft from the dash

While you are looking at the ▣ Screens dock, the IDE's Screens tab, **or**
a Mario-style deep link, the keys are the cockpit's inputs. Every documented
PilotSeat output channel has a worldsim row, so every key reaches the
computer — the seat is padded to the full 18-channel table, not just the
channels a program happens to read:

| Key | PilotSeat channel | In Chip's Mario | In the Space Invaders arcade |
|---|---|---|---|
| W / S | Backward / Forward (ch 1) | run / walk-back | (name entry) |
| A / D | Left / Right (ch 2) | move | move the cannon |
| ↑ / ↓ | Down / Up (ch 3) | jump / duck | fire / start |
| Space | **Down / Up (ch 3)** + Aux 1 (ch 8) | jump | press-SPACE-to-play |
| F | Aux 1 (ch 8) | jump | — |
| E / Q | Roll (ch 5) | fire | — |
| I / K | Pitch (ch 4) | — | — |
| J / L | Yaw (ch 6) | — | — |
| R | Main Thrust (ch 7) | — | — |
| 1 2 3 … 9 0 | Aux 1 2 3 … 9, Aux 0 (ch 8-17) | — | — |

Every press drives **all** the PilotSeat channels the running computer has
bound (a craft with two seats drives both), feeding `input_number` the
signed value; release centers the stick to 0 (it's a stick, not a latch).
A bound cockpit channel RESTS AT ZERO — an untouched PilotSeat sends 0,
exactly like the game. The app's global `g`/`o`/`h`/`w`/`5` view shortcuts
stand down while the dash is armed — the `w` key is Mario's run key, not
the wireframe toggle. On a craft with no cockpit the keys pass through
untouched.

## Buzzers — the craft makes sound

The game's **Buzzer** component produces tones of type `sine`, `square`,
`triangle` or `sawtooth` (the component's config, the in-game `V` menu),
with **Amplitude** (channel 0) and **Frequency** in Hz (channel 1, default
440) on its data channel. Programs drive them with `output_number`. One
oscillator per Buzzer, so a program using many buzzers (melody + harmony
+ bass + effects, as Chip's Mario does) plays chords.

**Hearing it**: **the sound is ON by default** — the top-bar 🔊 icon
beside ⚙ View starts enabled. Browsers forbid audio before you touch
anything (Firefox the strictest of all), so the game unlocks its audio
by itself at your **first keypress or tap** — for Mario, the very first
jump press starts the music, no settings hunt. **While any buzzer is
playing, the icon throbs**; click it any time to mute (a static 🔇).

**The tone each buzzer plays is its own**: the game stores it in the
component's `mode` setting (the in-game `V` menu) — the inspector now
shows it as **named modes** (0 · sine, 1 · square, 2 · triangle,
3 · sawtooth). In **auto** (the default wave chip) every buzzer plays
the tone its component authored — Chip's Mario: melody and harmony
square, **bass triangle**, **effects sawtooth**; forcing one wave on
all eight is the override, and was the "sound is funky" report.

For a game like Mario: the title screen is Chip's own SILENT attract demo
(his `musicgate=0`); the level themes start when a game does — jump
(␣/F/▲) to start, and the melody/harmony/bass buzzers carry the tune.

## Mario, in the browser

`?craft=3820116990&dash=first-virtual` — Chip Patton's **PKC-385 "Super Mario
Brothers"**, a XenonCode game that reads the `gamer-chair` PilotSeat, drives
eight Buzzer components for its 8-bit music and paints six HdScreen
surfaces. Sit in the seat (worldsim default = occupied, so it reads seated),
open the TV surface, click 🔊, and play with WASD/↑/↓/F.

On a phone the interpreter runs the game at ~14 updates/s; the computer is
fed the REAL time between updates, so Mario moves at true speed (a choppy
14 fps, not slow motion) and the buzzer tunes play at their proper tempo.
* **Side panel** (tabbed, with the tab row on top at the SAME level as the
  tab's search box):
  * **Vars** — ONE panel, two sections, LOCALS ALWAYS ON TOP:
    * **Locals** (top) — the LOCAL variables of the function owning the
      PAUSED line: its arguments and body variables, read LIVE from the
      interpreter at the stop. A frame is born at a debugger STOP (click a
      line's gutter, step with F10/F11) and stays listed as `last stop ·
      stale (running)` after resume — while the program RUNS there is no
      parked frame to read, so only globals tick. Recursion copies badge
      `#1`, `#2`…; a `$var` hover in the code reads the paused frame
      first, globals while running. Top-level lines have no locals.
    * **Globals** (below) — every global variable of the running program,
      live: RAM and `storage` values, with `storage` tagged. Text values
      in the language's key-value form (`.on{1}.red{255}`) break open into
      their members.
  * The type rides beside every name (`number`, `text`, `storage`,
    `array`, `object`). Search filters names AND values in both sections.
  * **Editable values** — while the debugger is PAUSED, number and text
    values are click-to-edit (locals of the frame, and globals): type the
    new value, Enter writes it INTO the running program's memory (Esc
    cancels). A number cell refuses anything but a finite decimal
    (`42`, `-1.5`, `1e3`, `true`/`false`) with an inline message; text
    accepts anything; `storage` (world-save), arrays and objects refuse.
    While a worker RUNS there is no writable moment — break first
    (gutter click / F9). Main-thread mode (non-isolated origin) writes
    anytime — the VM shares the page thread.
  * **Screens** — the same live surfaces, searchable by name.
  * **Bus** — the `input_number` sliders (every io/channel the program
    reads) and the `output_number` stream (target · port · latest value).
  * **Console** — `print(...)` lines.
* **`$var` hover** — in the code, hovering any `$variable` shows a tooltip
  with its CURRENT value; when the value changes, the OLD value floats
  above the current one and fades out.
* **Nodes tab** — programs authored in the game's visual node editor carry a
  `#NODES` block (the Cheap Exploration Plane and Cede's autopilot are two);
  the IDE renders that graph — node cards, ports and wires — with pan (drag)
  and zoom (wheel). **io-addressed nodes show live values**: input cards
  print the value the program ACTUALLY read from that component's channel,
  output cards the io-bus value on each port.
* **Syntax + validation** — code is highlighted with the language's own
  token classes (the dev's editor mode) and every visible line is parsed by
  the real compiler; a line the compiler rejects is marked in red (hover for
  its message).

## Not simulated

Power, fuel and the world's physics are deliberately ignored — this is the
blueprint-side workbench, not a flight simulator: the craft never moves,
sensors report what the World tab's functions say, and the PilotSeat reads
your keyboard. The standalone workbench page (with our own demo programs)
lives at `tools/xenoncode/` in the repo.

## Scripting the debugger

The Help manual topic **“Debugging XenonCode”** (`xenondebug`) documents
the breakpoints/frames/stepping law and the `window.__XCDBG__` console —
a plain-JSON JS API (`break` / `run` / `step` / `frame` / `write` / `io` /
`bus` / `prints`) designed so scripts and AI agents can analyze a program
headlessly.
