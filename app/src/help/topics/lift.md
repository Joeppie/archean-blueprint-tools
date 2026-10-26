# Lift and altitude
Tags: lift altitude atmosphere helium hydrogen vacuum buoyancy envelope equilibrium zeppelin weight ladder sea level ISA

The **⚖ Lift** row (inside the builder panel, and in the View-mode vessel
stats) scores the craft as a lighter-than-air ship against the REAL
atmosphere — the U.S. Standard Atmosphere 1976 layer table (the barometric
formula with the published lapse rates, clamped at 84.8 km), not a made-up
curve.

## What it shows

* **Envelope volume — the SEALED one** (v1.11). The number is the volume
  the outside cannot reach: the craft's block cells and skin triangles are
  voxelised, the outside world is flood-filled inwards, and everything the
  flood cannot enter is the envelope. A `sealed hull` badge marks it. An
  open structure floods through and honestly reports nothing — walls alone
  displace no lift. (For a skin the flood cannot close, the widget falls
  back to the divergence sum over the triangle mesh on the exact lattice —
  so the Generate balloon preview and this widget always agree.) Build a
  skin with Tools ▸ Generate balloon if the craft has none yet.
* **Lift at sea level** per gas: `lift = V · (ρ_air − ρ_gas)` for
  **vacuum**, **helium** and **hydrogen** (real molar masses), i.e.
  ≈ 1.225 / 1.05 / 1.14 kg per m³ at sea level, falling with altitude as
  the air thins.
* **Margin** — lift minus the vessel's computed mass (the game's own mass
  model — hull SKIN included: a committed balloon skin weighs its area ×
  0.05 m × material density, the same number the Static info card shows).
* **Floats at** — the equilibrium altitude where lift equals weight (or
  *sinks* / *ceiling* when it never crosses).
* **Weight ladder** — the maximum total mass that still floats at
  0 / 2 / 5 / 11 / 20 / 32 km.

## Reading it

The envelope is the SEALED flood volume, so a block hull CAN report lift
(v1.11): a zeppelin walled out of blocks seals the flood and gets its
numbers. Markers (the Volume component) are never trusted for the maths —
they are in-game cargo, not geometry. Skin mass rides the vessel weight
(area × 0.05 m × material density). Sealing matters in game too — the wind
panel's cabin-seal statistics use the same flood/enclosure logic.

> The physics is ideal-gas buoyancy + the ISA table; it deliberately stops
> short of drag or heating. "Archean uses real world data" — so do we here.
