# Subgrids and joints
Tags: subgrid build hinge pivot slide joint door hatch fin gantry master angle pos

A **subgrid** is a `Build` component carrying nested blueprint content —
hatches, doors, fins, gantry panels. Subgrids are INFO-SELECT ONLY: they
have no free gizmo (dragging them directly is wrong). They move in exactly
two ways, both through their **master** part:

1. the master's **joint state** (`data.angle` in DEGREES for hinges/pivots,
   `data.pos` in metres for linear tracks),
2. the master's own gizmo move/rotate — the panel rides rigidly.

## Driving a joint

Select the subgrid (click its visible panel, or the *by subgrid* tab row).
The side panel shows its Contents and the decoded **Mount** (the hinge /
pivot / track it belongs to) with joint sliders. There is also a handle ON
SCREEN at the joint line: a **gold ring** per angle master (drag writes the
angle about the captured axis; Shift snaps) and an **arrow** per slide
master (drag writes the pos in metres). Twin subgrids animate in unison —
each about its OWN captured axis, which is what makes symmetric doors fold
mirror-symmetrically.

## How the master is found

`data.composite_builds` entries index the FLATTENED component array (nested
content numbers before its Build). Flattened, every corpus entry resolves to
a real joint part — SmallHinge / SmallPivot spin about the axle's local Ŷ
(Aileron about X̂), LinearTrack slides along X̂, and the animated panel's
axis is derived from the panel's own geometry (a door hinges along its long
edge; a skin fin rolls about its bottom edge line).

> Epistemic note: these motion axes are an empirical fit to in-game motion
> (user-verified on the dolphin, truck, XYQ and gantry crafts), not stored
> format fields — the file only stores the join and the joint state.

## Deleting

Deleting a master part also drops every pipe and subgrid reference that
pointed into its subtree and renumbers the later ones (the Jimmy rule), so
the file stays loadable in the game.
