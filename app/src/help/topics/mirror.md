# The mirror rule
Tags: mirror symmetry twin sym plane flag warning faux propagate unison axis axes

The mirror plane rides the **mirror axis** — ⚙ ▸ *mirror axis* picks X, Y or
Z (default x, the corpus convention; the game itself is not hardcoded x: it
stores a per-component `mirrorAxis` field, 0 = none, 1=x, 2=y, 3=z). Every
axis the craft genuinely mirrors on gets a gold sheet at that coordinate's
0-plane: geometrically detected twin pairs, parts that declare `mirrorAxis`,
and your session choice (the solid sheet is the plane ⇄ places against).
The rule is UNIFORM — it always applies while a live twin pair exists:

> Every edit on a selected item drives its mirror twin in mirrored unison.

* **Blocks** — cell shifts (widget or panel rows, mirrored on the chosen
  axis), shape turns, size, flip, material, delete, and per-face paint
  (mapped through the mirrored face directions).
* **Parts** — position deltas, rotations as MIRROR-TWIN MOTION (a spin about
  the mirror normal is preserved — both wheels roll together; tangential
  spins flip — a steered pair yaws symmetrically), palette paint, joint
  data, delete.
* **Subgrids** — the twins' masters move and the panels ride along.

## What ⇄ does and does not gate

The ⇄ button/row is an **indicator**: lit = a live twin pair is being
propagated, struck = none found (or drifted). The ⇄ *placement* switch only
decides whether NEW brush/catalog ghosts place a twin too — that twin lands
mirrored on the ⚙ *mirror axis* you set. Propagation itself is never
switched off.

## Faux-mirror: flagged, never silent

A partner at the mirrored position that DISAGREES in a regarded property is
a faux-mirror — the app keeps your edit but tells you about the partner:

| Severity | When | You see |
|---|---|---|
| ⚠ red | geometry/gameplay conflict: shape, size, position, material; part pair drift | red twin overlay + popup |
| ℹ blue | appearance-only: per-face paint, colour1/colour2 differences | gold twin + blue info popup |

Pairs identified as twins must align within 5 cm; drift beyond that marks
the pair broken (struck ⇄) rather than chasing a partner you moved apart on
purpose.
