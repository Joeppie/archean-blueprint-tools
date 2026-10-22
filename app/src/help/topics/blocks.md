# Blocks
Tags: blocks brush place paint material face rotate snap twin mirror cell lattice ghost

Blocks are the craft's solid hull: shape + orientation (`type`), a palette
slot per face (`colors`), and a **material** (what it IS — see the table).
One cell = 0.25 m; block positions are whole cells.

## Placing

Pick **✚ Place**, choose the brush in the panel's Blocks section, then hover:
a ghost docks on ANY surface you aim at — a block face, a hull triangle, a
part. Click places; red ghost = the footprint collides, the click is refused.

* **⇧ Shift** over an existing block swaps the ghost to the *continuation*:
  the aimed block's shape/size/paint flush-added across the shared face —
  the game's "logically add the next block" rule.
* **⟲** in the brush cycles the shape family (the game's scroll wheel).
* **⇄** also places the x-mirrored twin when the mirror plane is on.

## Editing a block

In **✎ Edit**, click a block face: the block highlights gold and the BLOCK
widget (world space) attaches — arrows move it in **whole-cell snaps**, the
rings turn it in **90° steps**; both propagate to the mirror twin. The panel
editor offers the same as rows plus shape turns: ⟲X ⟲Y ⟲Z (turn in place),
⇄ flip, ⟲ cycle, and ✧ **snap** (pick the shape whose cross-section best
agrees with the neighbours).

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
