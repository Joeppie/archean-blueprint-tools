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

The panel is one column with a fixed crown: the **✎ Edit | ✚ Place** flavour
switch (in Edit and Wire-free modes), then context:

* **Parts list** — two tabs: *by type* and *by subgrid*; one search filters
  both; groups start collapsed and a click on a row expands and reveals it.
  Double-click flies the camera to the part.
* **Inspector** — the selection's position/orientation sliders, `data` rows,
  Paint section, Delete. Every field applies LIVE (one model rebuild per
  frame, no scene reload).
* **Blocks section** (Edit mode, panel bottom) — the brush (shape ⟲ cycle,
  material chips, paint slot), the Blocks | Triangles sub-tabs and the
  selected-item editor (shape turns, cx/cy/cz, material, face paint).
* **VesselStats** (View mode) — mass & CoM, census, heaviest classes, the
  collapsible ⚖ Lift row and the **Build cost** row (every part, block, hull
  triangle, cable, frame beam and strut unfolded through the game's crafter
  recipes to raw ores/molecules — the craft-wide shopping list on top, then a
  section per species, each line's own recipe chain one click down).

## Viewport furniture

* **⊘ ✥ ⟳ ⇄ ℹ 🎨** mode widget — pops at a clicked part: no gizmo / move /
  rotate / mirror indicator / info / paint window.
* **Static info card** (bottom-left) — mass & CoM; toggle under ⚙, ✕ closes.
* **Camera cluster** (bottom-right) — reframe the vessel / reset the view.
* **Ghost hints** — placement states (held part, brush ghost, skin Build/
  Cancel label) always print a caption at the top.
