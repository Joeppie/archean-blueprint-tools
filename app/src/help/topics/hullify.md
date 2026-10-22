# Hullify — blocks to hull triangles
Tags: hullify triangles convert hull skin blocks inward outward winding smooth flat shading bevel

**Tools ▸ Blocks → hull triangles…** rewrites the craft's geometry blocks
into hull TRIANGLES — the skin the game uses for smooth sheet hulls — and
removes the blocks it converted. It is FACE-EXACT: every emitted triangle
IS one of the block shape's own face triangles at the block's lattice
corner (a square face = 2 triangles, a wedge side = 1). Nothing rasterises
or approximates; interior walls are culled exactly like the block renderer
does, colours ride the OUTSIDE face slot, materials ride along, and
component-occupancy blocks survive as reservations.

## The two options

* **Direction (winding)** — `outward` (default, the game's freshly-authored
  convention: the front normal points away from the solid) or `inward`.
  The two directions are the SAME closed prism with front/back swapped;
  our viewer draws them identically — the winding picks which colour faces
  the outside in the game.
* **Shading** — `flat` (default: no `smooth` key, the game's authored
  default) or `smooth:1` (the convention the game's own hull SAVES use —
  its in-game normal welding may make a big skin read rounder; flat-shaded
  prisms read bevelled in game).

## Before you run it

It is a DANGER tool (a heavy rewrite) — but everything is undoable: the OK
step shows a confirmation box with the exact readout ("N blocks → M
triangles"), Confirm runs, and **Ctrl+Z** takes the whole conversion back
as one step. Build-subgrid blocks are NOT rewritten (the preview reports
them). Existing triangles are left verbatim.

## What triangles are, format-wise

Vertices live on the same lattice as blocks: `world = (v + 12·frame)·0.25 − 1.5`,
so shared slots WELD points; the game renders each triangle as a closed
0.05 m prism — colours[0] front, colours[1] back, colours[2..4] the three
side walls. Selected triangles show a gold overlay; Delete removes them
(pick a prism by clicking its middle — the pick is a geometric inside-test,
not a centroid radius).
