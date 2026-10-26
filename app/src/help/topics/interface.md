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
| Mode tiles | ⌖ View · ℹ Info · ✎ Modify · ∿ Wire · ➤ Flight · ≋ Wind |
| ● Save | download the file; the gold ● means unsaved changes |
| ⚙ View | the view window: sky backdrop (⊘ none / desert / sky / hangar — everything in the backdrop manifest; **sky** boots by default), orthographic projection, hull, wireframe (w), labels, gizmo, real models, static info, mesh quality |

## The Info dock (ℹ Info tile)

ℹ Info opens the vessel-info dock (⌖ View is the same ship with a clean
canvas — clicks select NOTHING there):

* **VesselStats** — mass & CoM, census, heaviest classes, the collapsible
  ⚖ Lift row (the SEALED envelope: enclosed blocks + skin flood-checked
  from outside, per-gas lift, margin, equilibrium and the altitude ladder)
  and the **Build cost** row (every part, block, hull triangle, cable,
  frame beam and strut unfolded through the game's crafter recipes to raw
  ores/molecules — the craft-wide shopping list on top, then a section per
  species, each line's own recipe chain one click down).
* The **parts list** (by type / by subgrid, one search, collapsed groups,
  double-click flies the camera) and the **Inspector** (position/orientation
  via the gizmo, `data` rows, Paint section, Delete — every field applies
  LIVE, one model rebuild per frame, no scene reload) live in the
  **+ Parts** workspace below.

## The build dock (Edit mode)

ONE mode control leads this WIDE bottom dock (v1.11, not the sidebar —
one mode row, no nested flips):

| Mode | A canvas click… | The dock shows |
|---|---|---|
| **+ Blocks** | lands a 1×1×1 block (brush paint/material) | the brush, census, block list, block editor |
| **+ Triangles** | drops a PIN (3 pins = prism) | the pin card, skin census, triangle list, triangle editor |
| **+ Parts** | selects a part (a held catalog part lands) | the catalog, the vessel's parts list, the inspector |
| **✎ Modify** | SELECTS anything (part · block · prism) | NOTHING until you pick — then that kind's editor |

**✎ Modify starts empty on purpose**: click a block, prism, or part on the
vessel and the editor for the kind you picked appears (a part click opens
**+ Parts** by itself, where the inspector lives). Esc or a sky click
clears the selection and the dock returns to its hint.

Beside it: the **Mirror widget** — `⊘ x y z` glyph chips: click a plane to
place mirrored pairs (auto-lit on mirrored crafts), click the lit plane
again to stop, ⊘ for none. The dock is three columns — the **brush + census**, a
**searchable list** of every block/triangle (hover a row to light it gold
in the 3D view, click to select, ✕ deletes it and its twin — Undo brings
them back), and the **editor of the selected item**.

* **Placing (v1.11: no size to choose)**: pick **+ Blocks** and **click /
  tap a surface** — one 1×1×1 block lands, is selected, and the mode widget
  pops at it (on phones the widget docks at the viewport's top edge and the
  GRID PAD is furnishable too — tap the grid beside the craft and the block
  stands on the pad; desktop keeps the pad unfurnishable): **✥ move · ⟳
  turn · ⤢ stretch**. Stretch drags a face — that
  face moves and the opposite face stays anchored, in whole cells; the
  dock's size rows do the same by number. The brush carries shape, paint
  and material only.
* **Triangles**: pick **+ Triangles**, then click three spots — each lands
  a **pin** on the lattice, draggable before the third lands; the third
  click commits the prism and the pins + a direction **arrow** stay on it
  (drag a pin to reshape it; new triangles inherit the BRUSH paint). In
  **✎ Modify** a click on a prism selects it and lands its pins + the
  ✥/⟳ centroid widget (✥ moves all three corners, ⟳ turns it,
  lattice-quantised; Esc leaves).
* **Editing**: pick **✎ Modify** and tap a part (the inspector opens) or a block
  face (the block editor + the BLOCK widget open).

## Viewport furniture

* **⊘ ✥ ⟳ ⤢ ⇄ 🎨** mode widget — pops at a clicked part or freshly placed
  block (desktop; on phones it docks at the viewport's TOP edge so it never
  covers what you just tapped): no gizmo / move / rotate / **stretch (blocks
  only)** / mirror indicator / paint window.
* **Static info card** (bottom-left) — mass & CoM; toggle under ⚙, ✕ closes.
* **Camera cluster** (bottom-right) — reframe the vessel / reset the view.
* **Ghost hints** — placement states (held part, brush ghost, skin Build/
  Cancel label) always caption beside the ghost on desktop, docked at the
  viewport's bottom edge on phones.
