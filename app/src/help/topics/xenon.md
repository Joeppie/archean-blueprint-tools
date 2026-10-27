# Xenon — run the craft's computer programs
Tags: xenon worldsim world sim xenoncode window zoom drag resize fullscreen computer code program ide screen hd-screen virtual screen nodes canvas programing programming plomo firstflight badger wasm interpreter variables vars disk files edit breakpoint debugger step autosave shadow

**Xenon ▾** (top bar, only on crafts that carry `MiniComputer` components with
`.xc` programs) lists every programmable computer on the vessel. Clicking one
opens the **XenonCode IDE** — the same look as the in-game window: title bar
with the ON indicator, the File/Library/Computer menu row, one tab per `.xc`
file, line-numbered code, and the `Program 'name' loaded / is running…`
status lines at the bottom.

> **Work in progress** — the programs genuinely run on the developer's own
> interpreter, but the simulation around them is not complete and **not yet
> correct**: no power, no live io routing to the craft's real components
> (inputs are numerics you feed, not sensor values), and the world never
> answers the program. Treat what you see as a faithful CODE view, not a
> flight-ready simulation.

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
  `CTRL+SHIFT+S`. The `File ▾` row shows the disk and **creates** files
  (plain `.xc` includes, or `program` → `name.main.xc`) and **deletes** the
  open tab. Files you create are in the saved blueprint and in the game.
* **Screens** — programs call `screen(alias, channel)`: `alias` is a
  Dashboard's name (or its io port number) and `channel` counts its
  elements. The bound `Screen`/`HdScreen` surfaces paint live at their real
  pixel size, the craft's 3-D dashboards display the same raster on their
  panels, and the **▣ Screens** button (top bar, on crafts with dashboards)
  opens the bottom tab with **Dashboards** and **Virtual** sub-tabs — the
  virtual ones are the `virtualscreen(w,h)` buffers a program composes
  (Chip's Badger builds its attitude display out of those). **The screens
  are clickable**: a click lands on the program's `button_rect` buttons,
  which evaluate true exactly as in game.
* **Side panel** (right of the code, tabbed):
  * **Vars** — every global variable of the running program, live: RAM and
    `storage` values, with `storage` tagged. Text values written in the
    language's key-value form (`.on{1}.red{255}`) break open into their
    members. Search filters names AND values (including KV children).
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

Power, fuel and the computer's in-world io wiring are deliberately ignored —
this is the blueprint-side workbench, not a flight simulator. The standalone
workbench page (with our own demo programs) lives at `tools/xenoncode/` in
the repo.
