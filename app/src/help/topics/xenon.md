# Xenon — run the craft's computer programs
Tags: xenon xenoncode computer code program ide screen hd-screen nodes canvas programing programming plomo firstflight wasm interpreter

**Xenon ▾** (top bar, only on crafts that carry `MiniComputer` components with
`.xc` programs) lists every programmable computer on the vessel.

> **Work in progress** — the programs genuinely run on the developer's own
> interpreter, but the simulation around them is not complete and **not yet
> correct**: no power, no live io routing to the craft's real components,
> screen pixel sizes are approximations, and the world never answers the
> program (temperatures, fluid levels, sensor values are static). Treat what
> you see as a faithful CODE view, not a flight-ready simulation. Clicking one
opens the **XenonCode IDE** — the same look as the in-game window: title bar
with the ON indicator, the File/Library/Computer menu row, one tab per `.xc`
file, line-numbered code, and the `Program 'name' loaded / is running…`
status lines at the bottom.

## What the IDE gives you

**It really runs.** The interpreter is the game developer's own XenonCode
code, compiled to WASM (pinned upstream, see `tools/xenoncode/` in the repo);
the program from the blueprint is compiled at open, exactly as the game's
computer does at power-on.

* **Screens** — programs call `screen(alias, channel)`; `alias` is a
  Dashboard's name on the craft and `channel` counts its elements, so a
  `Screen`/`HdScreen` element of that dashboard appears in the IDE's Screens
  panel and paints live: text, pixels, lines, rects, circles, polys — the
  game's own screen model. (On-screen click handling and the wiring-graph
  routing are not connected yet; the panel provides inputs as numerics.)
* **Inputs** — every `input_number(io, ch)` channel the program reads is
  detected and shown as a slider; the values go in as plain numerics,
  addressed by io/channel numbers, like the game's io bus.
* **io bus** — every `output_number` the program writes streams into the bus
  table (target · port · latest value).
* **Console** — `print(...)` lines land in the log.
* **Nodes tab** — programs authored in the game's visual node editor carry a
  `#NODES` block (the Cheap Exploration Plane is one); the IDE renders that
  graph — node cards, ports and wires — with pan (drag) and zoom (wheel).
* **Syntax + validation** — code is highlighted with the language's own
  token classes (the dev's editor mode) and every line is parsed by the real
  compiler; a line the compiler rejects is marked in red (hover for its
  message).
* **Re-boot** — `storage` variables survive the re-boot button, as in game.
 
## Not simulated

Power, fuel and the computer's in-world io wiring are deliberately ignored —
this is the blueprint-side workbench, not a flight simulator. The standalone
workbench page (with our own demo programs) lives at `tools/xenoncode/` in
the repo.
