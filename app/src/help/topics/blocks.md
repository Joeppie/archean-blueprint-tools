# Blocks
Tags: blocks brush place paint material face rotate snap twin mirror cell lattice ghost

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

## Placing

Pick **✚ Place**, choose the brush, then hover:
a ghost docks on ANY surface you aim at — a block face, a hull triangle, a
part. Click places; red ghost = the footprint collides, the click is refused.

* **Resize while placing** — over the canvas: **x / y / z** pick the active
  axis, **[** and **]** shrink / grow it one cell (`−`/`=` work too), and
  **s** squares the brush (every axis to the largest). The chip under the
  top edge shows the live footprint, e.g. `▤ 4×4×2 cells ▸ x`.
* **On a phone** the same sizing is in the dock: the **x / y / z** chips
  pick the active axis and the **− / +** steppers size it by tap; **▣
  square** and **1×1×1** are one tap. Then tap a surface to place.
* **▣ square** / **1×1×1** buttons in the brush do the same with the mouse.
  Blocks grow freely in all three axes — a block near a frame border is no
  longer capped there (the game stores multi-frame blocks itself), so a
  10×10×10 cube lands anywhere.
* **⇧ Shift** over an existing block swaps the ghost to the *continuation*:
  the aimed block's shape/size/paint flush-added across the shared face —
  the game's "logically add the next block" rule.
* **⟲** in the brush cycles the shape family (the game's scroll wheel).
* **⇄** also places the x-mirrored twin when the mirror plane is on.

## Editing a block

In **✎ Edit**, click a block face (or a row in the list): the block
highlights gold and the BLOCK widget (world space) attaches — arrows move
it in **whole-cell snaps**, the rings turn it in **90° steps**; both
propagate to the mirror twin. The dock's block editor offers the same as
rows plus shape turns: ⟲X ⟲Y ⟲Z (turn in place), ⇄ flip, ⟲ cycle, and ✧
**snap** (pick the shape whose cross-section best agrees with the
neighbours).

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
