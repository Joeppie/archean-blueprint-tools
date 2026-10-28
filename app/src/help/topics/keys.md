# Keyboard and mouse
Tags: keyboard shortcuts keys mouse controls orbit pan zoom delete escape shift snap brush stretch widget pin cockpit wasd dash mario

## Keys (ignored while a text field has focus)

| Key | Action |
|---|---|
| Ctrl+S | save (download the blueprint) |
| Ctrl+Z | undo (a slider/gizmo drag = one step) |
| Ctrl+Shift+Z / Ctrl+Y | redo |
| Delete / Backspace | delete the selection (✎ Modify mode): part ▸ triangle ▸ block, mirror twins included |
| g | grid on/off |
| o | occupancy boxes on/off |
| h | hull solids ⇄ wireframe — in wireframe you CLICK THROUGH the hull to what is behind it ("click what you SEE") |
| w | wireframe OVERLAY on/off (the ⚙ View ▸ wireframe row; a lit wireframe darkens the hull solids — hull ⇄ wireframe stay mutually exclusive, the 'h' law) |
| 5 | projection: perspective ⇄ ORTHOGRAPHIC (parallel) — the same toggle as ⚙ View ▸ orthographic |
| Cockpit keys (dash views only) | while the ▣ Screens dock or the IDE's Screens tab is open, the keys are the COCKPIT's inputs into the PilotSeat: **WASD** = the stick (forward/back, left/right), **↑/↓** = up/down, **Space** = up (the arcade "press SPACE" stick-push) **and** the Aux 1 action button, **F** = Aux 1, **E/Q** = roll, **I/K** = pitch, **J/L** = yaw, **R** = main thrust, **1-9, 0** = Aux 1-9 and Aux 0. Every documented seat channel has a worldsim row, so every key reaches the computer. The g/o/h/w/5 view shortcuts stand down (see Help ▸ Xenon) |
| Shift (held) | snaps: gizmo moves to 0.25 m cells, rotations to 15°, subgrid joint handles snap, block ghost = mirror continuation |
| Esc | close the top window → cancel a placement drag/skin → drop a held part → leave the triangle PINS → deselect |

## Mouse / touch in the viewport

| Gesture | Action |
|---|---|
| left drag | orbit the camera |
| wheel / pinch | zoom |
| right drag | pan |
| click a part (✎ Modify) | select + fly to it + gizmo |
| click a block face (✎ Modify) | select the block + the BLOCK widget |
| click (+ Blocks / + Triangles mode) | land a 1×1×1 cell / drop a pin (a held catalog part lands too) |
| press-drag-release (holding a part) | SMEAR-place it, aimed along the drag |
| double-click a list row | fly the camera to that part |
| drag a gizmo ring | rotate (the ring you grab is the axis you turn) |
| drag a gizmo ⤢ handle (block) | STRETCH that direction — the grabbed face moves, the opposite face stays anchored (whole cells) |
| drag a triangle PIN | place that corner in 3D — it rides the camera-facing plane through the pin (orbit = depth; ⇧ = lock to one axis), hull-lattice snap |
| click the widget's ▵ (block) | turn the selected BLOCK into its hull-triangle skin (block removed; Undo returns it) |
| hover the scene | a black label shows the full snapped x/y/z the ray lands on (y is UP; the pad's red line is x, the blue line z, both ±-labelled) |
| drag a gizmo arrow | move (world axes, always axis-aligned) |

The camera never moves on its own: a fly-to happens only on your click or
list double-click, and **undo keeps the camera** so you can A/B tool options.
