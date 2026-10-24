# Display and view options
Tags: display options hull wireframe labels opacity real models quality static info fog adapters connectors ground coord coordinate readout cursor shift vertical plane measure height axes axis x y z up backdrop sky mars earth desert hangar goegap kloofendal waterbuck attribution credit panorama equirectangular orthographic ortho projection parallel camera

The **⚙ View** window (top right) collects the display state; the same
toggles have keys where it matters.

| Option | What it does |
|---|---|
| Sky backdrop | what you see THROUGH and BEYOND the build pad: **none** (the flat sky colour) plus every panorama the app enumerates (see credits below) — **mars** (the real Perseverance Jezero 360°), **earth** (a savanna trail), **desert** (Goegap's red sand under a big sky) and **sky** (a bright partly-cloudy pure sky) — true surface panoramas, so it's SKY overhead and TERRAIN below with the horizon at eye level, drawn on a dome that follows the camera and looks right in both perspective and orthographic. The ground pad itself is see-through now; the grid lines and ±axis marks are all that render of it |
| Orthographic (5) | parallel projection — no perspective shrink, parallel edges stay parallel: align, measure and square up blueprints like a CAD sheet. The framing survives the swap both ways; wheel zoom scales the ortho sheet |
| Hull (h) | block + triangle solids on/off — OFF means WIREFRAME and click-through |
| Wireframe | the lattice wire overlay (mutually exclusive with hull solids) |
| Hull opacity | fades blocks, skin AND wire together — see through the shell without hiding it |
| World axes | in the file and the viewer: **x** lateral, **y = UP**, **z** longitudinal (the nose is −z) — the FLAT plane is x–z (Blender's own UI is z-up; this format is not). The pad shows it: the x = 0 grid line is RED, the z = 0 line BLUE, both labelled +/− at their ends |
| Grid (g) | the ground grid — it FITS the build and its granularity rides zoom (0.25 m cells → 1.25 → 2.5 → 12.5 m as you pull back; majors every 5); the pad sits just under the craft's lowest geometry and is SEE-THROUGH (an invisible pick surface plus the drawn lines — the backdrop shows through) |
| Occupancy (o) | the type-255 occupancy boxes (reserved cells around parts) |
| Mirror plane(s) | the gold sheets at the 0-plane of every mirrored axis (see the Mirror rule topic) |
| Mirror axis | which axis ⇄ twin placement and block twins ride: X, Y or Z (the game's own `mirrorAxis` field is per-part, 1=x 2=y 3=z) |
| Coord readout | Blender-style: hover the viewport and a small BLACK label follows the cursor with the full snapped position the ray LANDS ON — the visible surface's `x y z` in file metres (blocks, parts, the ground all measure; wireframe stays click-through, you measure what you SEE). A black pin marks the spot on the pad and in the air at its height |
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

## Sky backdrop credits

The View menu's panoramas are free-licensed surface panoramas, committed
under `src/assets/backdrops` next to a `manifest.json` that carries each
file's author, licence and source URL — the menu enumerates that manifest,
so a new panorama needs no code. With thanks to their authors:

- **mars** — *Mastcam-Z's First 360-Degree Panorama* (Perseverance rover,
  Jezero Crater, Sol 3), NASA/JPL-Caltech/ASU/MSSS — public domain,
  [PIA23862](https://www.nasa.gov/multimedia/imagegallery/iotd/piasmall/PIA23862/)
- **earth** — *Waterbuck trail*, Greg Zaal, Poly Haven — CC0 1.0,
  [polyhaven.com/a/waterbuck_trail](https://polyhaven.com/a/waterbuck_trail)
- **desert** — *Goegap*, Greg Zaal, Poly Haven — CC0 1.0,
  [polyhaven.com/a/goegap](https://polyhaven.com/a/goegap)
- **sky** — *Kloofendal 48d Partly Cloudy (Pure Sky)*, Greg Zaal & Jarod
  Guest, Poly Haven — CC0 1.0,
  [polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky)

`desert` and `sky` ship as low-quality (2 k, compressed) tone-mapped
variants to keep the bundle small.
