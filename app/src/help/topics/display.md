# Display and view options
Tags: display options hull wireframe labels opacity real models quality static info fog adapters connectors ground coord coordinate readout cursor shift vertical plane measure height axes axis x y z up

The **⚙** window (top right) collects the display state; the same toggles
have keys where it matters.

| Option | What it does |
|---|---|
| Hull (h) | block + triangle solids on/off — OFF means WIREFRAME and click-through |
| Wireframe | the lattice wire overlay (mutually exclusive with hull solids) |
| Hull opacity | fades blocks, skin AND wire together — see through the shell without hiding it |
| World axes | in the file and the viewer: **x** lateral, **y = UP**, **z** longitudinal (the nose is −z) — the FLAT plane is x–z, so the readout labels height as y (Blender's own UI is z-up; this format is not) |
| Grid (g) | the ground grid — it FITS the build and its granularity rides zoom (0.25 m cells → 1.25 → 2.5 → 12.5 m as you pull back; majors every 5); the green ground plane always sits just under the craft's lowest geometry |
| Occupancy (o) | the type-255 occupancy boxes (reserved cells around parts) |
| Mirror plane(s) | the gold sheets at the 0-plane of every mirrored axis (see the Mirror rule topic) |
| Mirror axis | which axis ⇄ twin placement and block twins ride: X, Y or Z (the game's own `mirrorAxis` field is per-part, 1=x 2=y 3=z) |
| Coord readout | Blender-style: hover the ground grid and a small BLACK label follows the cursor with the GRID CORNER position under it (snapped to the current grid step); hold **Shift** and a black ad-hoc VERTICAL grid plane appears through that corner — the one most facing your camera (x or z) — and the label grows to the full position, so you can eyeball the x/y/z of any spot and measure between them |
| Labels | part name labels in the scene |
| Connectors | adapter port nubs (cables/pipes keep their own toggle) |
| Real game models | full game meshes (default ON); the ⚙ row can switch weak GPUs to the decimated twins |
| Gizmo | the move/rotate widget master (View mode always hides it) |
| Static info | the mass & CoM card (default ON on desktop, OFF on phones; its own ✕ also closes it) |

## Why the picture looks like the game

* Palette slots are LINEAR albedo (the engine uses r/g/b raw) — decoding
  them as sRGB would darken every craft.
* `opacity < 15` makes a slot transparent, `opacity < 8` is glass.
* Metal is shaded as metallic·(1 − roughness/7) — painted rough parts stay
  diffuse, exactly like the game's tracer lights.
* Interior block walls and coplanar faces are culled; merged hull faces
  stitch into big quads, so a 3 m deck draws as 2 quads, not 192.

## Mobile

Everything is touch-first: the mode bar wraps to its own row, menus and
dialogs cap to the phone screen, tool dialogs sit clear of Brave's floating
bottom bar, and the parts panel is a drawer (tap the dimmed viewport or ✕
to dismiss).
