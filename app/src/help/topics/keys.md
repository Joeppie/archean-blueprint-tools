# Keyboard and mouse
Tags: keyboard shortcuts keys mouse controls orbit pan zoom delete escape shift snap brush stretch widget pin

## Keys (ignored while a text field has focus)

| Key | Action |
|---|---|
| Ctrl+S | save (download the blueprint) |
| Ctrl+Z | undo (a slider/gizmo drag = one step) |
| Ctrl+Shift+Z / Ctrl+Y | redo |
| Delete / Backspace | delete the selection (Edit flavour): part ▸ triangle ▸ block, mirror twins included |
| g | grid on/off |
| o | occupancy boxes on/off |
| h | hull solids ⇄ wireframe — in wireframe you CLICK THROUGH the hull to what is behind it ("click what you SEE") |
| 5 | projection: perspective ⇄ ORTHOGRAPHIC (parallel) — the same toggle as ⚙ View ▸ orthographic |
| Shift (held) | snaps: gizmo moves to 0.25 m cells, rotations to 15°, subgrid joint handles snap, block ghost = mirror continuation |
| Esc | close the top window → cancel a placement drag/skin → drop a held part → leave the triangle PINS → deselect |

## Mouse / touch in the viewport

| Gesture | Action |
|---|---|
| left drag | orbit the camera |
| wheel / pinch | zoom |
| right drag | pan |
| click a part (✎ Edit) | select + fly to it + gizmo |
| click a block face (✎ Edit) | select the block + the BLOCK widget |
| click (✚ Place) | place the brush ghost / held part on the hovered surface |
| press-drag-release (holding a part) | SMEAR-place it, aimed along the drag |
| double-click a list row | fly the camera to that part |
| drag a gizmo ring | rotate (the ring you grab is the axis you turn) |
| drag a gizmo ⤢ handle (block) | STRETCH that direction — the grabbed face moves, the opposite face stays anchored (whole cells) |
| drag a triangle PIN | re-drop that corner onto the surface under the cursor (hull-lattice snap) |
| hover the scene | a black label shows the full snapped x/y/z the ray lands on (y is UP; the pad's red line is x, the blue line z, both ±-labelled) |
| drag a gizmo arrow | move (world axes, always axis-aligned) |

The camera never moves on its own: a fly-to happens only on your click or
list double-click, and **undo keeps the camera** so you can A/B tool options.
