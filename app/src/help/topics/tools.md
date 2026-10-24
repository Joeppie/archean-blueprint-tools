# Tools menu and dialogs
Tags: tools dialog replace replace-all material colour paint movable confirm undo danger

**Tools ▾** holds the batch operations. Every tool is a DEFINITION (typed
fields + a live preview readout + the operation), so every dialog looks and
behaves the same:

* the window opens centred and is **movable** — drag its title bar (it stays
  inside the screen); on phones it sits above the browser's bottom bar;
* the **preview line** always says exactly what will change — while it says
  *nothing to…*, OK stays disabled;
* **OK** opens a confirmation box repeating that readout; **Confirm** runs
  and closes (the result rides a toast). Esc / Cancel / backdrop = no-op;
* heavy previews (the balloon planner) run in a background WORKER — sliders
  stay smooth and the footer says *planning…*;
* anything a tool did is one **Ctrl+Z** undo step.

## Replace all…

Rewrites every block **face colour** or every **material** in one go — e.g.
all Concrete → Steel, or all of one paint slot → another. The preview
counts affected faces/blocks first. Component paints and the occupancy
mirrors are untouched.

## Blocks → hull triangles…

Converts geometry blocks into a hull-triangle skin — see the *Hullify*
topic for what it guarantees and its Direction/Shading options.

## Generate balloon…

Generates a convex ellipsoid or cyl + nose skin of hull triangles, with the
optional airship TAIL section (rudder + aileron panels on SmallHinge
subgrids, hidden LV wiring, one enclosed Volume) — see the *Generate balloon*
topic for the algorithm, the ghost workflow and the storage limits.

> Adding a tool is one entry in the TOOLS registry
> (`app/src/components/ToolsDialog.tsx`): fields, preview, run (or a
> placement stage/commit pair + an optional ⚖ fix). The dialog UI, confirm
> flow and worker plumbing are shared.
