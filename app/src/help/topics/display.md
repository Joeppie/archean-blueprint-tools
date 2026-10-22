# Display and view options
Tags: display options hull wireframe labels opacity real models quality static info fog adapters connectors ground

The **⚙** window (top right) collects the display state; the same toggles
have keys where it matters.

| Option | What it does |
|---|---|
| Hull (h) | block + triangle solids on/off — OFF means WIREFRAME and click-through |
| Wireframe | the lattice wire overlay (mutually exclusive with hull solids) |
| Hull opacity | fades blocks, skin AND wire together — see through the shell without hiding it |
| Grid (g) | the ground grid; the green ground plane always sits just under the craft's lowest geometry |
| Occupancy (o) | the type-255 occupancy boxes (reserved cells around parts) |
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
