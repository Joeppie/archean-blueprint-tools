# Lift and altitude
Tags: lift altitude atmosphere helium hydrogen vacuum buoyancy envelope equilibrium zeppelin weight ladder sea level ISA

The **⚖ Lift** row (inside the builder panel, and in the View-mode vessel
stats) scores the craft as a lighter-than-air ship against the REAL
atmosphere — the U.S. Standard Atmosphere 1976 layer table (the barometric
formula with the published lapse rates, clamped at 84.8 km), not a made-up
curve.

## What it shows

* **Envelope volume** — the m³ enclosed by the craft's CLOSED hull skin
  (the divergence sum over the triangle mesh on the exact lattice — so the
  Generate balloon preview and this widget always agree). Build a skin with
  Tools ▸ Generate balloon if the craft has none yet.
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

The envelope counts the SKIN, not the blocks: a block hull without a skin
reports no volume by design (the gas would leak out of the cell lattice).
Sealing matters in game too — the wind panel's cabin-seal statistics use
the same flood/enclosure logic.

> The physics is ideal-gas buoyancy + the ISA table; it deliberately stops
> short of drag or heating. "Archean uses real world data" — so do we here.
