# Blocks
Tags: blocks brush place paint material face rotate snap twin mirror cell lattice ghost stretch scale widget pin arrow triangle

Blocks are the craft's solid hull: shape + orientation (`type`), a palette
slot per face (`colors`), and a **material** (what it IS — see the table).
One cell = 0.25 m; block positions are whole cells.

## The Blocks workspace (bottom dock)

The **▤ Blocks** tile opens the blocks workspace as a wide dock under the
viewport (like the WIRE dock): the brush on the left, the **block census**
(counts per shape family, materials, total cells, ⇄ mirror-conflict count),
a **searchable list of every block** (hover a row to light it gold in 3D,
click to select, ✕ deletes it and its twin — Undo brings them back), and
the editor of the selected block on the right.

## Placing — a click lands one cell, the widget sizes it

v1.11 (we: *"choosing a block size before placing it shouldn't be a
thing"*): the brush carries **shape, paint and material ONLY** — there is
no size to pick first. Pick **✚ Place** and click (or tap) ANY surface —
a block face, a hull triangle, a part — and a **1×1×1 cell** lands, is
auto-selected, and the mode widget pops at it so you can immediately:

* **✥ move** — cell-snapped arrows (whole-cell steps, the twin mirrors),
* **⟳ turn** — 90° rings,
* **⤢ stretch** — grab a face's handle and pull: **that face moves, the
  opposite face stays anchored** (a +z stretch grows only toward +z — it
  never touches the −z side). The footprint grows/shrinks in **whole cells**;
  a block near a frame border grows freely on every axis — a 10×10×10 cube
  is one stretch away, and the dock's **size x/y/z** rows do the same by
  number.

Every one of those is ONE undo step. Other placement rules:

* **⇧ Shift** over an existing block swaps the ghost to the *continuation*:
  the aimed block's shape/size/paint flush-added across the shared face —
  the game's "logically add the next block" rule.
* **⟲** in the brush cycles the shape family (the game's scroll wheel).
* **⇄ twin ON** (the dock's mirror widget) also lands the mirrored twin,
  across the axis the **⊘ x y z** chips light.
* A red ghost over an occupied cell = the click is refused.

## Editing a block

In **✎ Edit**, click a block face (or a row in the list): the block
highlights gold and the SAME BLOCK widget (world space) attaches — **✥**
arrows move it in **whole-cell snaps**, **⟳** rings turn it in **90°
steps**, **⤢** handles stretch it in **whole cells** (grab a face, that
face moves, the opposite one stays anchored); all
propagate to the mirror twin. The dock's block editor offers the same as
rows plus shape turns: ⟲X ⟲Y ⟲Z (turn in place), ⇄ flip, ⟲ cycle, and ✧
**snap** (pick the shape whose cross-section best agrees with the
neighbours).

## Placing triangles — pins (v1.11)

In **▵ Triangles**, a click drops a **pin** on the lattice corner of the
surface you aim at. Three pins = one hull triangle: the third click commits
the prism (brush colours, material 0). The pins are the point:

* **Drag any pin** — before and after the commit. A pin re-drops onto the
  surface under the cursor, snapped to the 0.25 m hull lattice, and the
  stored corner follows (the 32-slot vertex window is enforced honestly:
  a refused move snaps the pin back).
* The gold **arrow** at the face centre points along the winding normal —
  which way the triangle faces (its FRONT colour side). Moving a pin across
  the opposite side flips it, exactly like the game's direction tell.
* Click an existing prism's middle, or a row in the triangle list, to put
  that triangle's pins on the surface. **Esc** leaves the pins; the list
  dock keeps the number rows (corners, ±cell moves, colours, shading).

## Materials — the block's gameplay identity

| # | Material | kg per cell | note |
|---|---|---:|---|
| 0 | Composite | 0.25 | default, light |
| 1 | Concrete | 10 | heavy ballast |
| 2 | Steel | 1 | the structural default |
| 3 | Aluminium | 0.5 | light structure |
| 4 | Glass | 1 | |
| 5 | Lead | 150 | dense — radiation/ballast |
| 6 | Titanium | 0.6 | light and strong |

Material is NOT appearance: the glass/metal LOOK comes from the palette slot
you paint with. Repainting never changes the material; the material chips
(`material` row) never change the colour.

## Paint

Every block face has its own palette slot (the **face paint** editor in the
block tab). With ⇄ mirror on, face colours map through the mirrored face
directions automatically. The 🎨 window on the canvas paints the current
selection too. Custom RGB: the swatch dock's colour input → **+ new slot**
(grows this craft's palette) or **≈ nearest slot**.

> Interior walls are culled: two blocks glued face-to-face render no wall
> between them. That is why a sealed sandwich shows no internal faces.
