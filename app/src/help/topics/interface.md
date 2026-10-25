# Interface tour
Tags: interface ui panel topbar modes options settings widgets layout tabs cost raw materials recipe economy shopping list

## Top bar

| Control | What it does |
|---|---|
| ← | back to the gallery (space center) |
| File ▾ | New craft (confirms while unsaved) · Open file… · Save / Save as… · Refresh (redownload) · Close |
| Edit ▾ | Undo / Redo with their live enabled state; the vessel-information rows that are still TODO |
| Tools ▾ | the generated batch tools: Replace all…, Blocks → hull triangles…, Generate balloon… (with the tail rudder + aileron section) |
| Help ▾ | this manual |
| Mode tiles | View · Edit · Wire · Flight · Wind — the workspace split |
| ● Save | download the file; the gold ● means unsaved changes |
| ▤ | collapse / expand the left parts panel (also the ‹ / › bookmark tab on its edge) |
| ⚙ View | the view window: sky backdrop (⊘ none / desert / sky / hangar — everything in the backdrop manifest; **sky** boots by default), orthographic projection, hull, wireframe, labels, gizmo, real models, static info, mesh quality |

## The side panel

The panel is the parts context column (on phones it is a drawer — the ▤
button opens it; the canvas stays usable beside it):

* **Parts list** — two tabs: *by type* and *by subgrid*; one search filters
  both; groups start collapsed and a click on a row expands and reveals it.
  Double-click flies the camera to the part. In the **✚ Place** flavour the
  list becomes the parts **catalog** — tap a part to hold it, then tap a
  surface on the craft.
* **Inspector** — the selection's position/orientation sliders, `data` rows,
  Paint section, Delete. Every field applies LIVE (one model rebuild per
  frame, no scene reload).
* **VesselStats** (View mode) — mass & CoM, census, heaviest classes, the
  collapsible ⚖ Lift row and the **Build cost** row (every part, block, hull
  triangle, cable, frame beam and strut unfolded through the game's crafter
  recipes to raw ores/molecules — the craft-wide shopping list on top, then a
  section per species, each line's own recipe chain one click down).

## The build dock (Edit mode)

The **✎ Edit | ✚ Place** flavour switch lives in this WIDE bottom dock (not
the sidebar): it sets what a canvas click / tap DOES. Beside it: the
▤ Blocks | ▵ Triangles sub-tabs and the **mirror widget** — the **⇄ twin**
arm plus the **⊘ x y z** chips: the lit chip IS the mirror plane (⊘ = no
session mirror). The dock is three columns — the **brush + census**, a
**searchable list** of every block/triangle (hover a row to light it gold
in the 3D view, click to select, ✕ deletes it and its twin — Undo brings
them back), and the **editor of the selected item**.

* **Placing (v1.11: no size to choose)**: pick ✚ Place and **click / tap a
  surface** — one 1×1×1 block lands, is selected, and the mode widget pops
  at it: **✥ move · ⟳ turn · ⤢ stretch**. Stretch drags a face — that face
  moves and the opposite face stays anchored, in whole cells; the dock's
  size rows do the same by number. The brush carries shape, paint and
  material only.
* **Triangles**: pick **▵ Triangles**, then click three spots — each lands
  a **pin** on the lattice, draggable before the third lands; the third
  click commits the prism and the pins + a direction **arrow** stay on it
  (drag a pin to reshape the triangle; a list row puts pins on any
  committed triangle; Esc leaves).
* **Editing**: pick ✎ Edit and tap a part (the inspector opens) or a block
  face (the block editor + the BLOCK widget open).

## Viewport furniture

* **⊘ ✥ ⟳ ⤢ ⇄ 🎨** mode widget — pops at a clicked part or freshly placed
  block: no gizmo / move / rotate / **stretch (blocks only)** / mirror
  indicator / paint window.
* **Static info card** (bottom-left) — mass & CoM; toggle under ⚙, ✕ closes.
* **Camera cluster** (bottom-right) — reframe the vessel / reset the view.
* **Ghost hints** — placement states (held part, brush ghost, skin Build/
  Cancel label) always print a caption at the top.
