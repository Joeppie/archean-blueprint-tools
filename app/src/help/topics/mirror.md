# The mirror rule
Tags: mirror symmetry twin sym plane flag warning faux propagate unison axis axes off disable ⊘

The mirror plane rides the **mirror axis**. The build dock carries the
visible **Mirror widget**: `⊘ x y z` glyph chips (plane + triangle +
reflection; the off chip wears a strikethrough, the axis chips carry the
glyph behind the letter). **Click a plane to mirror across it** —
placements land as mirrored pairs; **click the lit plane again to stop**.
⊘ = no mirror at all. An `auto` badge shows while the craft's own twin
pairs light the current plane by themselves. One word, one control —
there is no separate “twin” switch (we: "thats duplicate lingo"). The ⚙ ▸
*mirror plane* rows set the same value. Default x, the corpus convention; the game itself is not hardcoded
x: it stores a per-component `mirrorAxis` field, 0 = none, 1=x, 2=y, 3=z.

**Picking an axis IS the intent (v1.11, we: "I put on mirror X for the
craft… then placed a triangle … but no matching triangle was made"):**
clicking a plane chip selects it **and arms mirrored placement** — every
subsequent placement (blocks, parts AND triangles) lands as a mirrored
pair across it, on any craft. Before you touch anything the chip is lit
by `auto` on crafts whose DATA is already mirrored across the current
axis (detected twin pairs, declared `mirrorAxis` parts). With ⊘ there is
NO session mirror — every edit touches only the selected item.

**One plane, always (v1.11):** the 3-D view shows a single gold sheet —
the session axis. The data-detected axes drive the auto-twin state; they
no longer draw extra sheets (two ghost planes on one craft read as a bug).
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
