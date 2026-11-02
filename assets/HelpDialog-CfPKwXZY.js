import{r as e,t}from"./vendor-EJppy_mZ.js";var n=e(),r=e=>e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`),i=e=>e.toLowerCase().replace(/[^a-z0-9]+/g,`-`).replace(/^-+|-+$/g,``);function a(e){let t=[],n=e.replace(/`([^`]+)`/g,(e,n)=>(t.push(`<code>${n}</code>`),`\x00${t.length-1}\x00`));return n=n.replace(/\*\*([^*]+)\*\*/g,`<b>$1</b>`),n=n.replace(/\*([^*\n]+)\*/g,`<i>$1</i>`),n=n.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,`<a href="$2" target="_blank" rel="noopener">$1</a>`),n.replace(/\x00(\d+)\x00/g,(e,n)=>t[+n]??``)}var o=e=>/^\|?[\s:|-]+\|[\s:|-]*$/.test(e)&&e.includes(`-`),s=e=>e.trim().replace(/^\|/,``).replace(/\|$/,``).split(`|`).map(e=>e.trim()),c=e=>e.map(e=>{let t=e.startsWith(`:`),n=e.endsWith(`:`);return t&&n?`center`:n?`right`:t?`left`:``});function l(e){let t=e.replace(/\r\n?/g,`
`).split(`
`),n=[],l=[],u=0,d=(e,n)=>{let r=e?`ol`:`ul`,i=[],o=e?/^(\s*)(\d+)[.)]\s+(.*)$/:/^(\s*)[-*]\s+(.*)$/;for(;u<t.length;){let r=t[u],s=o.exec(r);if(!s)break;let c=s[1].length;if(c<n)break;if(c>n){let t=u,o=d(/^\d/.test(r.trim()),n+2);if(u===t){i.push(e?`<li>${a(s[3])}</li>`:`<li>${a(s[2])}</li>`),u++;continue}i.length&&(i[i.length-1]=i[i.length-1].replace(/<\/li>$/,o+`</li>`))}else{if(e!==/^\d+[.)]/.test(r.trim()))break;i.push(e?`<li>${a(s[3])}</li>`:`<li>${a(s[2])}</li>`),u++}}return`<${r} class="md-list">${i.join(``)}</${r}>`};for(;u<t.length;){let e=t[u],f=e.trim();if(!f){u++;continue}if(/^```/.test(f)){let e=[];for(u++;u<t.length&&!/^```/.test(t[u].trim());)e.push(t[u]),u++;u++,n.push(`<pre class="md-pre"><code>${r(e.join(`
`))}</code></pre>`);continue}let p=/^(#{1,4})\s+(.*)$/.exec(f);if(p){let e=p[1].length,t=p[2].trim(),o=i(t);l.push({id:o,level:e,text:t}),n.push(`<h${e} id="${o}">${a(r(t))}</h${e}>`),u++;continue}if(/^---+$/.test(f)){n.push(`<hr class="md-hr"/>`),u++;continue}if(/^>\s?/.test(f)){let e=[];for(;u<t.length&&/^>\s?/.test(t[u].trim());)e.push(a(r(t[u].trim().replace(/^>\s?/,``)))),u++;n.push(`<blockquote class="md-quote">${e.join(`<br/>`)}</blockquote>`);continue}if(f.startsWith(`|`)&&u+1<t.length&&o(t[u+1].trim())){let e=s(f),i=c(s(t[u+1]));u+=2;let l=[];for(;u<t.length&&t[u].trim().startsWith(`|`)&&!o(t[u].trim());)l.push(s(t[u])),u++;let d=e.map((e,t)=>`<th${i[t]?` class="al-${i[t]}"`:``}>${a(r(e))}</th>`).join(``),p=l.map(t=>`<tr>${e.map((e,n)=>`<td${i[n]?` class="al-${i[n]}"`:``}>${a(r(t[n]??``))}</td>`).join(``)}</tr>`).join(``);n.push(`<table class="md-table"><thead><tr>${d}</tr></thead><tbody>${p}</tbody></table>`);continue}if(/^\s*[-*]\s+/.test(e)){n.push(d(!1,e.length-e.trimStart().length));continue}if(/^\s*\d+[.)]\s+/.test(e)){n.push(d(!0,e.length-e.trimStart().length));continue}let m=[];for(;u<t.length;){let e=t[u].trim();if(!e||/^(#|>|```|---+\s*$|\|)/.test(e)||/^\s*[-*]\s+/.test(t[u])||/^\s*\d+[.)]\s+/.test(t[u]))break;m.push(a(r(e))),u++}n.push(`<p class="md-p">${m.join(` `)}</p>`)}return{html:n.join(`
`),headings:l}}function u(e){return e.replace(/```[\s\S]*?```/g,` `).replace(/[#>*`|_[\]()]/g,` `).replace(/https?:\S+/g,` `).replace(/-/g,` `)}var d=`# Generate balloon — the algorithm and its limits
Tags: sphere ellipsoid spheroid skin hull triangles algorithm convex hull lattice limitations dents bulge sag quickhull zeppelin blimp aspect ratio window tau cylinder rocket nose tail paint finish metallic matte polished glass rotate quarter-turn facets balloon balloon fins rudder aileron pivot hinge coupler junction volume wire LV tail post cap

**Tools ▸ Generate balloon…** grows an ellipsoid out of hull triangles — a closed
convex SKIN whose vertices are integer lattice points (the same 0.25 m grid
the blocks and the game's own hull triangles share). Slider to 48 m radii
(96 m across); the number boxes take any size beyond. The **cyl + nose**
body (the shipped default, v1.9.0) gains a **tail section** (v1.9) —
rudder + aileron fins on hinge subgrids, a coupler and one enclosed
Volume block, all described below.

## Two bodies (v1.7.2, ends independent since v1.7.3)

| Body | Shape | When |
|---|---|---|
| **ellipsoid hull** | the convex hull of every lattice point hugging the ideal ellipsoid — maximum roundness | spheres and gentle blends |
| **cyl + nose** *(the shipped default, v1.9.0)* | FLAT CYLINDER SIDES along the longest axis + tapered, POINTIER ends (\`nose %\` and \`tail %\` sliders set how much of EACH half tapers — the nose is the − end of the longest axis, the aircraft's −z nose; \`facets\` picks 48/12/8 sides around the section) | zeppelins — and the body the TAIL section builds on; also stores sizes where the pure hull hits the game's triangle-window limit and must refuse |

The two ends taper INDEPENDENTLY (v1.7.3): the defaults (nose 65 %, tail
40 %, both sliders 10…90) give a rocket/airship profile — a long pointy
nose, a blunt tail. Aim the nose with the ghost's ⟲ quarter-turns.

The simple body is built as a LOFT: integer cross-section rings at ≤ 20-cell
axial slices (shoulder rings kept), a single lattice APEX at each tip, and
merge-walked triangle strips whose every edge is subdivided to ≤ 9 cells —
closed manifold, no dents (the profile is concave), and the 31-cell window
holds BY CONSTRUCTION, so long needles store too. The live preview prints
the deviation: a coarse \`blocky\` body is simpler but the sag it prints
grows — the trade is honest.

## Tail section (v1.9 — cyl + nose bodies)

With **tail fins ▸ rudder+2 ailerons**, the balloon grows a classical
airship tail ON THE UNTOUCHED CONE — the tail's triangle pattern keeps
flowing (an early build added a straight fin POST; it broke the tail's
line and was retired: the fins now ride the natural cone).

- **ONE straight top line** rules the whole tail (sketch #3: the moving
  part must CONTINUE the beginning, and the line "should be straight" —
  no curvature): it starts at the SHOULDERS where the cone begins to
  yield and rises aft at a slope that IS the fin size, through a hinge
  line just before the apex and CONTINUING over the hung fin to its
  trailing edge. A modest fin keeps the line nearly horizontal — flush
  with the top of the ship; a big one steepens the taper.
- **A fixed fillet** fills between the hull and that line (root clinging
  tight to the cone — the orange of the sketch), shoulder to hinge.
  **The MOVABLE rudder/ailerons hang to a horizontal keel line** like
  stern-post rudders (the green shape) hanging BEHIND the tail: under
  the hull the panel's upper edge FOLLOWS THE HULL CONTOUR onto the tail
  end (its hinge side is contour-following, not square, and it never
  cuts into the ship), and aft of the hinge the vane spans keel-to-line
  to a vertical trailing edge. The side fins' hung panels keep a clear
  gap to the cone — their inner edge is a flat, slightly stepped plane,
  so nothing strikes the tail's radius. The TOP rudder rolls about the
  LONGITUDINAL hinge line — its tall vane swings SIDEWAYS at the top;
  the MIRRORED port/starboard pair rolls about the same longitudinal
  axis. Panels are hull TRIANGLES, never parts; the pair is
  one plate reflected in the mirror plane, triangle for triangle.
- \`fin size %\` sets the line's slope (half the girth above the shoulder
  at the hinge line for the normal setting); \`oversize\` multiplies past
  it — clamped to what the game's triangle window stores, the preview
  refuses before a silently-holed fin.
- **Panels rotate on SmallHinges.** Each hung panel rides a SmallHinge
  (±90°) part joined as a SUBGRID (\`composite_builds\` → the hinge's
  joint, nested \`triangles\` in parent-absolute coordinates — the same
  door/hatch mechanics the editor itself builds). In the pilot, turning
  the hinge turns its panel. A free-turning ±360° SmallPivot was offered
  early on and REMOVED (v1.9.0 — a control surface that spins full circle
  steers nothing; the hinge's limited travel IS the control law). Since
  v1.9.0 the hinge's own visible plate turns about the SAME world line as
  its panel (it used to roll the plate like a propeller). And since
  v1.9.3 all three hinges are ONE part rolled around the ship's axis: the
  two fin hinges lie with their tower pointing AFT and their connectors
  facing the hull side, and the rudder hinge is that mount quarter-turned
  90° — still lying down, connector pointing DOWN toward the body — so
  its panel rolls about the longitudinal line and the tall vane's top
  swings sideways. (A stance-up attitude with the tower pointing skyward
  was tried and retired the same day: "the hinge should be laying down
  … connectors same side (near the fuselage) … rotated 90° while still
  laying down".)
  This
  triangle-panel-in-a-subgrid combo is what the game's READER carries
  (the dev reader recurses nested \`triangles\`); the corpus has no
  authored precedent, so the final in-game look of the rotating panels is
  YOUR arbitration — report it if it reads wrong.
- **LV wiring, hidden.** A LowVoltageJunction (the low-power COUPLER) sits
  at the envelope centre; every pivot gets one LV cable that leads off its
  socket, dives into the body IMMEDIATELY behind the plug, then runs the
  body's long axis INSIDE the envelope to a coupler port — visible only if
  you open the hull.
- **ONE Volume block, on/off.** \`volume block\` is a yes/no toggle
  (v1.9.0, shown for EVERY body since v1.11 — the plain ellipsoid gets it
  too): ON places exactly ONE Volume straight UP out of the envelope
  centre, riding 0.187 m above it (facing up, 1 kg displacement), where a
  1-cell skin margin is guaranteed — OFF places none. (The old 0…16 count
  stack made no sense: one block is what the game's airtight volume
  mechanic wants.)
- **Everything rides the ghost.** ⟲ quarter-turns and the cell drag carry
  the fillets, panels, pivots, coupler, volumes AND cables with the skin
  (a probe tetrahedron round-trips the exact turn matrix), and ✔ Build is
  ONE undo step for the whole batch. Tail bodies need a tail zone of at
  least 3 m — the preview says so instead of failing.

## The algorithm (ellipsoid hull): a lattice convex-hull shrinkwrap

1. **Shell** — every lattice point whose radial excess over the ideal
   ellipsoid lies in [0, τ] (default 0.75 cells): a thin skin of points just
   OUTSIDE the surface. The test depends only on position-squared, so the
   point set is EXACTLY mirror-symmetric.
2. **Convex hull** — an incremental beneath-beyond hull (the Quickhull
   family: Barber–Dobkin–Huhdanpaa 1996; CGAL's convex_hull_3 is the same
   class) with conflict lists. Every predicate runs on INTEGER coordinates,
   decided exactly in doubles — zero epsilon heuristics.
3. **Optimality certificate** — Qhull's postcondition loop: each face plane
   is support-tested against the full shell; any point beyond a face joins
   the candidates and the hull rebuilds until nothing is missed. The result
   is provably EXACTLY hull(shell).
4. The hull faces ARE the skin, emitted as game Triangle records (outward
   winding, flat shading by default = the game's own authoring convention).

**Why it cannot dent:** a convex polyhedron is convex from EVERY viewing
direction — a concavity nowhere exists to see. Earlier attempts quantized
the surface with per-vertex heuristics; independent per-vertex errors read
as dents. Here smoothness is a THEOREM, not a hope.

## Deviation you can read before building

The dialog's live preview prints it: \`dev −0.00/+0.18 m\` — the worst face
sag INTO the ideal surface (measured EXACTLY 0 at every size) and the worst
vertex bulge OUT (≤ τ·0.25 m ≤ 0.19 m), plus triangles, skin mass, enclosed
volume and sea-level lift per gas (vacuum / helium / hydrogen).

## Limits — what the game can store

| Limit | Value | What it means for you |
|---|---|---|
| lattice | 0.25 m cells, integers | radii snap to 0.25 m steps; placement moves in whole cells |
| triangle window | 32 slots, FRAME-ALIGNED | every face must fit one 31-cell aligned window (v = g − 12·floor(min/12)); faces that outgrow it are **subdivided by splitFace** (midpoint 1→4, mirror-symmetric) instead of refused — smooth spheroids at any size. The same cut applies when you ⟲-turn or drag the ghost: a big face can fit its window where it was planned and not after the move, so the transform re-cuts it — a balloon never loses a panel to a rotation |
| convexity | strict | no dents, hollows or tori — a skin is a convex blob |
| smallest radius | ≥ 0.25 m | below a cell there is no lattice to hull |
| shading | flat │ smooth:1 | flat = the game's authored default; smooth:1 asks the game to weld normals |

The storable size/shape limit of the ellipsoid hull is **not a clean ratio**
(measured: an 8:1 needle of length 12 m stores, a 2:1 ellipsoid 20 m long at
r=10 does not, while a 32×32×48 one does). The **cyl + nose** body sidesteps
it entirely (the flank is sliced, so no face spans more than two slices —
pointy blends that the hull refuses become the SIMPLEST skins on the craft).
Since v1.9 window-blown faces SPLIT instead of refusing, so the ellipsoid
path really always stores. The one honest refusal left is a shape below a
lattice cell (no hull to build) — **⚖ Fix the shape** one-tap lifts it to
the smallest storable sphere; for near-limit blends it still PROBES the
worker for the nearest fully-storable blend (first shortening the long
axis — a zeppelin keeps its girth — then thickening the short ones).

## Workflow

OK previews a **movable ghost** on the block widget (cell-snapped). Its
label carries the whole placement kit (v1.7.2):

- **⟲x ⟲y ⟲z** — turn the ghost a QUARTER turn about that world axis. The
  lattice only stores exact 90° rotations of integer vertices, so the snap
  is the FORMAT law, not a taste; ✔ Build writes exactly what is ghosted.
- **↩ edit** — back to the dialog with every parameter kept (and the spot
  you dragged to). Retune, OK again, done — nothing starts from scratch.
- **✕ Cancel** (or Esc while the ghost is up) drops it — but Esc while the
  ↩-reopened dialog is up closes the DIALOG only.
- **✔ Build** writes the triangles into the craft (your chosen material +
  ONE palette slot for all five faces of every triangle). The **paint is a
  single control** (v1.7.3): the RGB swatch/hex, the **finish** — \`matte\`,
  \`polished\`, \`metal\` or \`glass\`, exactly the shading the game's palette
  families carry — and where it lands: **+ new palette slot** writes a new
  slot WITH that finish, **≈ nearest** snaps to the closest existing slot
  that WEARS it (falling back to the nearest colour when none does).
  Ctrl+Z removes the whole skin as ONE undo step.
`,f=`# Blocks
Tags: blocks brush place paint material face rotate snap twin mirror cell lattice ghost stretch scale widget pin arrow triangle

Blocks are the craft's solid hull: shape + orientation (\`type\`), a palette
slot per face (\`colors\`), and a **material** (what it IS — see the table).
One cell = 0.25 m; block positions are whole cells.

## The Blocks workspace (bottom dock)

The **+ Blocks** tile opens the blocks workspace as a wide dock under the
viewport (like the WIRE dock): the brush on the left, the **block census**
(counts per shape family, materials, total cells, ⇄ mirror-conflict count),
a **searchable list of every block** (hover a row to light it gold in 3D,
click to select, ✕ deletes it and its twin — Undo brings them back), and
the editor of the selected block on the right.

## Placing — a click lands one cell, the widget sizes it

v1.11 (we: *"choosing a block size before placing it shouldn't be a
thing"*): the brush carries **shape, paint and material ONLY** — there is
no size to pick first. Pick **+ Blocks** and click (or tap) ANY surface —
a block face, a hull triangle, a part — and a **1×1×1 cell** lands, is
auto-selected, and the mode widget pops at it so you can immediately:

* **✥ move** — cell-snapped arrows (whole-cell steps, the twin mirrors),
* **⟳ turn** — 90° rings,
* **⤢ stretch** — grab a face's handle and pull: **that face moves, the
  opposite face stays anchored** (a +z stretch grows only toward +z — it
  never touches the −z side). The footprint grows/shrinks in **whole cells**;
  a block near a frame border grows freely on every axis — a 10×10×10 cube
  is one stretch away, and the dock's **size x/y/z** rows do the same by
  number.

Every one of those is ONE undo step. Other placement rules:

* **⇧ Shift** over an existing block swaps the ghost to the *continuation*:
  the aimed block's shape/size/paint flush-added across the shared face —
  the game's "logically add the next block" rule.
* **⟲** in the brush cycles the shape family (the game's scroll wheel).
* **⇄ twin ON** (the dock's mirror widget) also lands the mirrored twin,
  across the axis the **⊘ x y z** chips light.
* A red ghost over an occupied cell = the click is refused.

## Editing a block

In **✎ Modify**, click a block face (or a row in the list): the block
highlights gold and the SAME BLOCK widget (world space) attaches — **✥**
arrows move it in **whole-cell snaps**, **⟳** rings turn it in **90°
steps**, **⤢** handles stretch it in **whole cells** (grab a face, that
face moves, the opposite one stays anchored); all
propagate to the mirror twin. The widget also carries **▵** — turn this
block into hull triangles: its free faces become the hull skin (faces
glued to neighbours stay walls, the game's outward+flat authoring), the
block is removed, one Ctrl+Z brings it back. The dock's block editor offers the same as
rows plus shape turns: ⟲X ⟲Y ⟲Z (turn in place), ⇄ flip, ⟲ cycle, and ✧
**snap** (pick the shape whose cross-section best agrees with the
neighbours).

## Placing triangles — pins (v1.11)

In **+ Triangles mode**, a click drops a **pin** on the lattice corner
of the surface you aim at. Three pins = one hull triangle: the third click
commits the prism (brush colours, material 0). The pins are the point:

* **Drag any pin in 3D** — before and after the commit. The pin rides the
  plane facing the camera through its corner: a screen drag places it on
  all three world axes (orbit to change the depth), snapped to the 0.25 m
  hull lattice, and the stored corner follows (the 32-slot vertex window
  is enforced honestly: a refused move snaps the pin back). Hold **⇧** to
  LOCK to one axis — the world axis the camera most faces — for clean
  vertical/straight slides.
* With the dock's ⇄ twin arm on, the commit lands the **mirror twin** too:
  corners reflected across the lit axis (g → 12 − g) with the winding
  flipped, so the twin's FRONT faces the mirrored way — blocks and
  triangles mirror by the same law.
* The gold **arrow** at the face centre points along the winding normal —
  which way the triangle faces (its FRONT colour side). Moving a pin across
  the opposite side flips it, exactly like the game's direction tell.
* **Paint**: the triangles dock carries the **brush paint** card — the
  palette slot + material NEW prisms inherit (one paint story for both
  species). A SELECTED prism paints via the 🎨 window (all faces) or the
  five **face colour** rows (front / back / three side walls) on its own
  editor.
* **The mode law**: in + Triangles a canvas click ONLY places (a prism face
  is just another placeable surface — placement never selects). In
  **✎ Modify** a canvas click selects ANYTHING you aim at — part, block **or
  prism** — blocks and triangles are one merged workspace.
* In **✎ Modify**, click a prism's middle (or a row in the triangle list) to
  put that triangle's pins on the surface — and its **centroid widget** on
  the gizmo: the SAME grab-onto widget a block wears. **✥** moves the WHOLE
  triangle (all three corners, whole-cell snaps), **⟳** turns it about its
  own plane (the ring on the normal spins it in-plane) — and because the
  hull is an integer lattice every pose is QUANTISED: corners re-snap to
  the nearest lattice corner live, so you always see the storable shape.
  A refused turn (vertex window) snaps the pins back. **Esc** leaves the
  pins; the list dock keeps the number rows (corners, ±cell moves,
  colours, shading).

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
(\`material\` row) never change the colour.

## Paint

Every block face has its own palette slot (the **face paint** editor in the
block tab). With ⇄ mirror on, face colours map through the mirrored face
directions automatically. The 🎨 window on the canvas paints the current
selection too. Custom RGB: the swatch dock's colour input → **+ new slot**
(grows this craft's palette) or **≈ nearest slot**.

> Interior walls are culled: two blocks glued face-to-face render no wall
> between them. That is why a sealed sandwich shows no internal faces.
`,p=`# Build cost in raw materials
Tags: cost price raw materials ores resources ingredients recipe economy shopping list crafting fluidport budget build cost cables wire blocks triangles struts frames hull steel beam rod spool

**View mode** ▸ side panel ▸ **Build cost** answers "what does this craft
actually cost to build?" — every part, block, hull triangle, cable, frame beam
and strut unfolded through the game's own **crafter recipes** down to terminal
raw materials.

## What the numbers are

| Part of the readout | Meaning |
|---|---|
| Raw materials — whole craft | the craft-wide shopping list: every raw material and the TOTAL quantity the whole build consumes |
| Per component | one row per component TYPE, with the count on the craft (\`×4\`) and the raw cost of all of them |
| Blocks | per block MATERIAL: the cell count the craft asks for, as \`<Material>Block\` items |
| Hull triangles | per material: triangle count and surface area, billed as block items |
| Cables | per cable class: the LENGTH of the runs on the craft and the spool items that length costs |
| Frames / Struts | frame beams (\`SteelBeam\`) and rods (\`SteelRod\`) |
| ▾ section header | every group (raw materials, per component, blocks, hull triangles, cables, frames, struts) folds — the folded header keeps its summary line, and the fold is remembered for the next visit |
| ▸ row | opens that line's recipe chain — its DIRECT constituents, each with its own raw cost, expandable further |
| one unit (…) | a component row's per-part cost and crafter time (\`×4\` multiplies that by the count) |
| no recipe | a part the game never sells as a recipe (sensors …): it stays in the list, it just cannot be unfolded |
| subgrid | the part lives inside a subgrid (Build) — it is still material you have to craft |
| via tool | a Dashboard board: the game bills the **DashboardTool** once, however many boards the craft carries |

Units are the game's own: raw **ores/molecules are grams** (\`g\` below 1 kg,
\`kg\` below 1 t, then \`t\`), crafted items and parts are counts. Cable and strut
rows also print the physical metres they stand for.

## How the structural items are counted

The game's own Blueprint-tool content list (\`GetBlueprintContents\`, ported by
the dev viewer's cost panel and by \`tools/game_data.py\`):

* **Blocks** cost their FULL cell rectangle \`(sizeX+1)(sizeY+1)(sizeZ+1)\` —
  the shape/orientation is free; occupancy reservations (type 255) cost
  nothing. One cell = one \`<Material>Block\` item (Composite, Concrete, Steel,
  Aluminium, Glass, Lead, Titanium).
* **Hull triangles** cost \`max(ceil(area · 0.05 m ÷ 0.25³), 1)\` block items —
  the prism's volume in cell cubes, rounded UP, and never less than one item.
* **Cables** cost the length of every pipe, in centimetres, so **1 spool unit
  = 1 cm**. The game truncates **per SEGMENT**, not per run: two 1.5 cm
  segments cost 2 cm, not 3. The recipe pays out a 100 m spool (10 000 units)
  per batch. Sub-centimetre plug stubs therefore charge nothing — the section
  still shows the real run length.
* **Frames** cost one \`SteelBeam\` per LIT beam flag (a 3 m frame cube carries
  up to 12 beams), not one per frame record.
* **Struts** cost \`ceil(length · 100)\` \`SteelRod\` (one rod = 1 cm of strut).
* Subgrid (Build) content is counted; the Build construction ghosts are not.

## Example — FluidPort

One FluidPort is crafted from **1 Casing + 1 Connector**:

* Casing = 1 000 g Iron
* Connector = Wire + Plastic → 1 g Copper + 125 g Carbon + 125 g Silicon each
* Plastic = 125 g Carbon + 125 g Silicon

so a FluidPort costs **1 000 g Iron · 1 g Copper · 250 g Carbon · 250 g
Silicon** — open the row and each constituent shows this same breakdown for
itself.

## Where the data comes from

\`viewer/models/economy.json\`, generated from the installed game by
\`tools/extract_economy.py\` (items + crafter recipes of
\`modules/*/config.yaml\`) — the same tables the game's own content list uses:
first crafter recipe per item wins, an item without one is terminal. Re-run
the extractor after a game update.
`,m=`# Display and view options
Tags: display options hull wireframe labels opacity real models quality static info fog adapters connectors ground coord coordinate readout cursor shift vertical plane measure height axes axis x y z up backdrop sky desert hangar goegap kloofendal hangar_interior attribution credit panorama equirectangular orthographic ortho projection parallel camera phone mobile fullscreen help manual popup dock compact gizmo widget

The **⚙ View** window (top right) collects the display state; the same
toggles have keys where it matters.

| Option | What it does |
|---|---|
| Sky backdrop | what you see THROUGH and BEYOND the build pad: **⊘** (the struck-through button = no panorama, the flat sky colour) plus every panorama the app enumerates (see credits below) — **desert** (Goegap's red sand under a big sky), **sky** (a bright partly-cloudy pure sky) and **hangar** (inside an aircraft hangar — roof overhead, floor below; **sky** is what a fresh session starts on) — surface panoramas, so it's SKY overhead and TERRAIN below with the horizon at eye level, drawn on a dome that follows the camera and looks right in both perspective and orthographic. The ground pad itself is see-through now; the grid lines and ±axis marks are all that render of it |
| Orthographic (5) | parallel projection — no perspective shrink, parallel edges stay parallel: align, measure and square up blueprints like a CAD sheet. The framing survives the swap both ways; wheel zoom scales the ortho sheet |
| Hull (h) | block + triangle solids on/off — OFF means WIREFRAME and click-through |
| Wireframe (w) | the lattice wire overlay (mutually exclusive with hull solids — lighting the wire darkens the solids) |
| Hull opacity | fades blocks, skin AND wire together — see through the shell without hiding it |
| World axes | in the file and the viewer: **x** lateral, **y = UP**, **z** longitudinal (the nose is −z) — the FLAT plane is x–z (Blender's own UI is z-up; this format is not). The pad shows it: the x = 0 grid line is RED, the z = 0 line BLUE, both labelled +/− at their ends |
| Grid (g) | the ground grid — it FITS the build and its granularity rides zoom (0.25 m cells → 1.25 → 2.5 → 12.5 m as you pull back; majors every 5); the pad sits just under the craft's lowest geometry and is SEE-THROUGH (an invisible pick surface plus the drawn lines — the backdrop shows through) |
| Occupancy (o) | the type-255 occupancy boxes (reserved cells around parts) |
| Mirror plane(s) | the gold sheets at the 0-plane of every mirrored axis (see the Mirror rule topic) |
| Mirror axis | which axis ⇄ twin placement and block twins ride: X, Y or Z (the game's own \`mirrorAxis\` field is per-part, 1=x 2=y 3=z) |
| Coord readout | Blender-style: hover the viewport and a small BLACK label follows the cursor with the full snapped position the ray LANDS ON — the visible surface's \`x y z\` in file metres (blocks, parts, the ground all measure; wireframe stays click-through, you measure what you SEE). A black pin marks the spot on the pad and in the air at its height |
| Labels | part name labels in the scene |
| Connectors | adapter port nubs (cables/pipes keep their own toggle) |
| Real game models | full game meshes (default ON); the ⚙ row can switch weak GPUs to the decimated twins |
| Gizmo | the move/rotate widget master (View mode always hides it) |
| Static info | the mass & CoM card (default ON on desktop, OFF on phones; its own ✕ also closes it) |

## Why the picture looks like the game

* Palette slots are LINEAR albedo (the engine uses r/g/b raw) — decoding
  them as sRGB would darken every craft.
* \`opacity < 15\` makes a slot transparent, \`opacity < 8\` is glass.
* Metal is shaded as metallic·(1 − roughness/7) — painted rough parts stay
  diffuse, exactly like the game's tracer lights.
* Interior block walls and coplanar faces are culled; merged hull faces
  stitch into big quads, so a 3 m deck draws as 2 quads, not 192.

## Mobile

Everything is touch-first: the mode bar wraps to its own row, menus and
dialogs cap to the phone screen, tool dialogs sit clear of Brave's floating
bottom bar. Since v1.11 the catalog, parts list, inspector and the mode
workspaces ALL live in the wide bottom dock (no side drawer), and the tap
popups stay OUT of the way (v1.11.1): the mode widget (⊘ ✥ ⟳ ⤢) docks at the
viewport's TOP edge instead of over the part you just tapped, the picked-info
chip, the placement label and the ⚠/ℹ twin popups dock at its bottom edge
over the dock, the 3-D gizmo is drawn compact, and the Help manual is a
FULLSCREEN window. Phones also furnish the GRID PAD: a + Blocks tap on the
grid lands a block STANDING ON the pad (the phone canvas is a postage stamp
— demanding an existing-geometry hit first made growing off the deck
impossible); desktop keeps the pad unfurnishable.

## Sky backdrop credits

The View menu's panoramas are free-licensed surface panoramas, committed
under \`src/assets/backdrops\` next to a \`manifest.json\` that carries each
file's author, licence and source URL — the menu enumerates that manifest,
so a new panorama needs no code. With thanks to their authors:

- **desert** — *Goegap*, Greg Zaal, Poly Haven — CC0 1.0,
  [polyhaven.com/a/goegap](https://polyhaven.com/a/goegap)
- **sky** — *Kloofendal 48d Partly Cloudy (Pure Sky)*, Greg Zaal & Jarod
  Guest, Poly Haven — CC0 1.0,
  [polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky)
- **hangar** — *Hangar Interior* (an interior panorama: roof overhead,
  floor below), Dimitrios Savva & Jarod Guest, Poly Haven — CC0 1.0,
  [polyhaven.com/a/hangar_interior](https://polyhaven.com/a/hangar_interior)

\`desert\`, \`sky\` and \`hangar\` ship as low-quality (2 k, compressed)
tone-mapped variants to keep the bundle small.
`,h=`# Hullify — blocks to hull triangles
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

* **Direction (winding)** — \`outward\` (default, the game's freshly-authored
  convention: the front normal points away from the solid) or \`inward\`.
  The two directions are the SAME closed prism with front/back swapped;
  our viewer draws them identically — the winding picks which colour faces
  the outside in the game.
* **Shading** — \`flat\` (default: no \`smooth\` key, the game's authored
  default) or \`smooth:1\` (the convention the game's own hull SAVES use —
  its in-game normal welding may make a big skin read rounder; flat-shaded
  prisms read bevelled in game).

## Before you run it

It is a DANGER tool (a heavy rewrite) — but everything is undoable: the OK
step shows a confirmation box with the exact readout ("N blocks → M
triangles"), Confirm runs, and **Ctrl+Z** takes the whole conversion back
as one step. Build-subgrid blocks are NOT rewritten (the preview reports
them). Existing triangles are left verbatim.

## What triangles are, format-wise

Vertices live on the same lattice as blocks: \`world = (v + 12·frame)·0.25 − 1.5\`,
so shared slots WELD points; the game renders each triangle as a closed
0.05 m prism — colours[0] front, colours[1] back, colours[2..4] the three
side walls. Selected triangles show a gold overlay; Delete removes them
(pick a prism by clicking its middle — the pick is a geometric inside-test,
not a centroid radius).
`,g=`# Interface tour
Tags: interface ui panel topbar modes options settings widgets layout tabs cost raw materials recipe economy shopping list

## Top bar

| Control | What it does |
|---|---|
| ← | back to the gallery (space center) |
| File ▾ | New craft (confirms while unsaved) · Open file… · Save / Save as… · Refresh (redownload) · Close |
| Edit ▾ | Undo / Redo with their live enabled state; the vessel-information rows that are still TODO |
| Tools ▾ | the generated batch tools: Replace all…, Blocks → hull triangles…, Generate balloon… (with the tail rudder + aileron section) |
| Help ▾ | this manual |
| Mode tiles | ⌖ View · ℹ Info · ✎ Modify · ∿ Wire · ➤ Flight · ≋ Wind |
| ● Save | download the file; the gold ● means unsaved changes |
| ⚙ View | the view window: sky backdrop (⊘ none / desert / sky / hangar — everything in the backdrop manifest; **sky** boots by default), orthographic projection, hull, wireframe (w), labels, gizmo, real models, static info, mesh quality |

## The Info dock (ℹ Info tile)

ℹ Info opens the vessel-info dock (⌖ View is the same ship with a clean
canvas — clicks select NOTHING there):

* **VesselStats** — mass & CoM, census, heaviest classes, the collapsible
  ⚖ Lift row (the SEALED envelope: enclosed blocks + skin flood-checked
  from outside, per-gas lift, margin, equilibrium and the altitude ladder)
  and the **Build cost** row (every part, block, hull triangle, cable,
  frame beam and strut unfolded through the game's crafter recipes to raw
  ores/molecules — the craft-wide shopping list on top, then a section per
  species, each line's own recipe chain one click down).
* The **parts list** (by type / by subgrid, one search, collapsed groups,
  double-click flies the camera) and the **Inspector** (position/orientation
  via the gizmo, \`data\` rows, Paint section, Delete — every field applies
  LIVE, one model rebuild per frame, no scene reload) live in the
  **+ Parts** workspace below.

## The build dock (Edit mode)

ONE mode control leads this WIDE bottom dock (v1.11, not the sidebar —
one mode row, no nested flips):

| Mode | A canvas click… | The dock shows |
|---|---|---|
| **+ Blocks** | lands a 1×1×1 block (brush paint/material) | the brush, census, block list, block editor |
| **+ Triangles** | drops a PIN (3 pins = prism) | the pin card, skin census, triangle list, triangle editor |
| **+ Parts** | selects a part (a held catalog part lands) | the catalog, the vessel's parts list, the inspector |
| **✎ Modify** | SELECTS anything (part · block · prism) | NOTHING until you pick — then that kind's editor |

**✎ Modify starts empty on purpose**: click a block, prism, or part on the
vessel and the editor for the kind you picked appears (a part click opens
**+ Parts** by itself, where the inspector lives). Esc or a sky click
clears the selection and the dock returns to its hint.

Beside it: the **Mirror widget** — \`⊘ x y z\` glyph chips: click a plane to
place mirrored pairs (auto-lit on mirrored crafts), click the lit plane
again to stop, ⊘ for none. The dock is three columns — the **brush + census**, a
**searchable list** of every block/triangle (hover a row to light it gold
in the 3D view, click to select, ✕ deletes it and its twin — Undo brings
them back), and the **editor of the selected item**.

* **Placing (v1.11: no size to choose)**: pick **+ Blocks** and **click /
  tap a surface** — one 1×1×1 block lands, is selected, and the mode widget
  pops at it (on phones the widget docks at the viewport's top edge and the
  GRID PAD is furnishable too — tap the grid beside the craft and the block
  stands on the pad; desktop keeps the pad unfurnishable): **✥ move · ⟳
  turn · ⤢ stretch**. Stretch drags a face — that
  face moves and the opposite face stays anchored, in whole cells; the
  dock's size rows do the same by number. The brush carries shape, paint
  and material only.
* **Triangles**: pick **+ Triangles**, then click three spots — each lands
  a **pin** on the lattice, draggable before the third lands; the third
  click commits the prism and the pins + a direction **arrow** stay on it
  (drag a pin to reshape it; new triangles inherit the BRUSH paint). In
  **✎ Modify** a click on a prism selects it and lands its pins + the
  ✥/⟳ centroid widget (✥ moves all three corners, ⟳ turns it,
  lattice-quantised; Esc leaves).
* **Editing**: pick **✎ Modify** and tap a part (the inspector opens) or a block
  face (the block editor + the BLOCK widget open).

## Viewport furniture

* **⊘ ✥ ⟳ ⤢ ⇄ 🎨** mode widget — pops at a clicked part or freshly placed
  block (desktop; on phones it docks at the viewport's TOP edge so it never
  covers what you just tapped): no gizmo / move / rotate / **stretch (blocks
  only)** / mirror indicator / paint window.
* **Static info card** (bottom-left) — mass & CoM; toggle under ⚙, ✕ closes.
* **Camera cluster** (bottom-right) — reframe the vessel / reset the view.
* **Ghost hints** — placement states (held part, brush ghost, skin Build/
  Cancel label) always caption beside the ghost on desktop, docked at the
  viewport's bottom edge on phones.
`,_=`# Keyboard and mouse
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
`,v=`# Lift and altitude
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
  flood cannot enter is the envelope. A \`sealed hull\` badge marks it. An
  open structure floods through and honestly reports nothing — walls alone
  displace no lift. (For a skin the flood cannot close, the widget falls
  back to the divergence sum over the triangle mesh on the exact lattice —
  so the Generate balloon preview and this widget always agree.) Build a
  skin with Tools ▸ Generate balloon if the craft has none yet.
* **Lift at sea level** per gas: \`lift = V · (ρ_air − ρ_gas)\` for
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
`,y=`# The mirror rule
Tags: mirror symmetry twin sym plane flag warning faux propagate unison axis axes off disable ⊘

The mirror plane rides the **mirror axis**. The build dock carries the
visible **Mirror widget**: \`⊘ x y z\` glyph chips (plane + triangle +
reflection; the off chip wears a strikethrough, the axis chips carry the
glyph behind the letter). **Click a plane to mirror across it** —
placements land as mirrored pairs; **click the lit plane again to stop**.
⊘ = no mirror at all. An \`auto\` badge shows while the craft's own twin
pairs light the current plane by themselves. One word, one control —
there is no separate “twin” switch (we: "thats duplicate lingo"). The ⚙ ▸
*mirror plane* rows set the same value. Default x, the corpus convention; the game itself is not hardcoded
x: it stores a per-component \`mirrorAxis\` field, 0 = none, 1=x, 2=y, 3=z.

**Picking an axis IS the intent (v1.11, we: "I put on mirror X for the
craft… then placed a triangle … but no matching triangle was made"):**
clicking a plane chip selects it **and arms mirrored placement** — every
subsequent placement (blocks, parts AND triangles) lands as a mirrored
pair across it, on any craft. Before you touch anything the chip is lit
by \`auto\` on crafts whose DATA is already mirrored across the current
axis (detected twin pairs, declared \`mirrorAxis\` parts). With ⊘ there is
NO session mirror — every edit touches only the selected item.

**One plane, always (v1.11):** the 3-D view shows a single gold sheet —
the session axis. The data-detected axes drive the auto-twin state; they
no longer draw extra sheets (two ghost planes on one craft read as a bug).

**ONE axis at a time (v1.11.1, we: "The x axis is visible in a craft, but
this isn't synced with mirroring! For now limit to one axis at a time"):**
the session plane is the ONLY axis twin pairs are LIVE on. A craft whose
part pairs mirror across y (or z) propagates nothing while your plane is x
— the sheet you SEE and the propagation behaviour are the same one axis;
switch the plane to y/z and that pair wakes. Multi-axis (twist/point)
pairs and ⊘ keep every pair dormant. Blocks, parts, triangles, ghost
placement and the auto badge all ride this single axis.

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
`,b=`# Parts (components)
Tags: parts components catalog place gizmo move rotate delete selection real models proxy smear

Everything that is not a block or a hull triangle is a **component**: wings,
wheels, propellers, cockpits, lamps, dashboards…

## Placing

In Edit mode, open the parts catalog (the rows show live 3D previews; hover
spins them) → hold a part. A translucent real-model ghost docks on whatever
surface you hover. Two ways to land it:

* a **click** places it facing the file's +x;
* a **press-drag-release smear** aims its BACK along the drag and places on
  release. **Esc** drops the held part.

With ⇄ on, a mirrored twin is placed too when the plane is on.

## Selecting and moving

**✎ Modify** → click a part: it selects, the camera flies to it, the gizmo
attaches at its VISIBLE centre (so off-origin geometry spins in place, not
orbiting). Rings rotate (Shift = 15° snap), arrows translate (Shift = cell
snap). The inspector carries x/y/z + orientation sliders and the part's own
\`data\` rows — every edit applies LIVE, one rebuild per frame max.

**Delete** (or Backspace) removes the selected part and its mirror twin, and
renumbers every file reference that pointed into it (the game's flattened
\`pipes\`/\`composite_builds\` indices stay valid — the "Jimmy rule").

## Twins

A symmetric pair (mirrored across x within 5 cm) is a live twin pair:
EVERY edit — move, rotation (as mirror-twin motion), palette paint, joint
data, delete — propagates to the twin in mirrored unison. The ⇄ button on
the mode widget lights while the pair is live; a pair you dragged apart is
auto-flagged and stops propagating.

## Real models vs proxies

Parts render as their FULL game meshes by default; ⚙ can switch weak GPUs to
the decimated twins. A selected part glows gold (x-ray overlay + outline box)
through the hull. Cable pulses ride the real \`data.pipes\` graph when a
connected part is selected.
`,x=`# Saving, palettes and file fidelity
Tags: save file json palette colour color slot rgb v1 v2 legacy byte occupancy fidelity workshop cache stale staleness chip sha download validated cached

## Saving is byte-conservative

The app keeps the file's ORIGINAL literal text for everything you do not
touch — number styles ("13" vs "13.0" vs "1e-08"), key order, all of it.
Only edited fields are rewritten, in the game's own writer style (int-
modelled fields bare, double-modelled with a decimal). So a saved craft
re-opens in the game exactly as authored, plus your change. **Save**
(Ctrl+S) downloads the file; there is no upload.

* **Occupancy mirrors stay synced**: a part's \`occupancies\` and the
  matching type-255 \`data.blocks\` entries move together on every position
  edit and on every save.
* Orientations are NEVER rewritten — stored quaternion bytes ride along
  verbatim (the game keeps them across generations; rewriting them made
  old exports load flipped).

## Palettes: v1 vs v2

* v2 files embed their own 256-slot \`data.colors\` (r/g/b 0-255 linear,
  opacity 0-15, roughness 0-7, metallic 0|1).
* v1 files carry NO palette: slots resolve through the game's built-in
  legacy families (matte/polished/metal/glass). An all-purple craft is a
  missing built-in group, not a broken file — the app remaps v1 indices
  automatically. On open, a v1 palette is embedded, so custom colours work
  on every craft.

## Custom RGB

Any swatch dock's colour input → **+ new slot** writes your RGB into the
next free slot of THIS craft's palette (slots 0..10 stay engine-reserved);
**≈ nearest slot** reuses the closest existing colour instead of growing
the palette. Slot use-counts show on every swatch in the palette panel.

## Getting crafts in

Gallery cards load the cached corpus; **File ▸ Open file…** (or drag-drop
anywhere) loads a local \`blueprint.json\`; **File ▸ Refresh** redownloads a
workshop craft. A v1 export from the game opens directly — normalization
adds what the format expects but rewrites nothing you can see.

Every cached copy is validated: the gallery stamps each craft with its
revision + SHA-256, a card you cached BEFORE the workshop author edited the
craft carries an amber *edited since cached* chip, and opening a stale or
unverifiable copy asks first — **[Download latest]** or **[Open cached
copy]** — it is never silently replaced.
`,S=`# Quick start
Tags: start gallery open new craft place save first steps begin

The Inspector opens on the **gallery** — every craft in the corpus as a card.
Click a card to inspect it; **New craft** (gallery only) starts an empty one.
Inside a craft, the top bar holds *File · Edit · Tools · Help* plus six mode
tiles: **View · Info · Modify · Wire · Flight · Wind**.

## The thirty-second tour

1. **View** (⌖) — inspect only. Orbit with the left mouse drag, zoom with the
   wheel, pan with the right drag. Clicks select *nothing* here — that is
   deliberate. **Info** (ℹ) opens the vessel's amounts beside the same clean
   canvas: mass, centre of mass, part census, the ⚖ Lift widget, Build cost.
2. **Edit** (✎) — the editing mode, with ONE mode control in its bottom
   dock (v1.11 — one tri-state row, not nested flips):
   * **✎ Modify** — clicking the craft *selects anything*: a part gets the
     gizmo + inspector, a block face selects the block, a hull prism
     selects the triangle (pins + centroid widget). \`Delete\` removes.
   * **+ Blocks** — clicking a surface *places* a 1×1×1 block (the brush's
     paint + material; **⇧ Shift** continues the aimed block's shape).
   * **+ Triangles** — clicking *drops a pin*; three pins become a hull
     triangle inheriting the brush paint.
3. **Wire** (∿) — the cable graph: which \`data.pipes\` connect what, with
   warnings for references that point at nothing.
4. **Flight** (➤) — mass/CoM, thrust nets and control-surface analysis.
5. **Wind** (≋) — the stylized airflow: streamlines around the hull.

## Edit something

* Rotate a part: **✎ Modify** → click it → drag a gizmo ring (hold **Shift**
  for 15° snaps). Move: drag an arrow (Shift snaps to the 0.25 m cells).
* Place a block: mode row ▸ **+ Blocks**, pick a shape and paint in the
  dock's brush, then click a surface — the block lands, the widget (✥ ⟳ ⤢)
  transforms it.
* Everything is undoable: **Ctrl+Z** / **Ctrl+Y**, or Edit ▾ Undo/Redo. A
  whole slider drag is one undo step.

## Get it out again

**Save** (or Ctrl+S) downloads the blueprint file — byte-identical for
everything you did not touch, so the game re-opens it exactly. *File ▸ Save
as…* lets you rename it.

> Nothing ever uploads. The app reads and writes only local files; the
> gallery crafts are cached downloads.
`,C=`# Subgrids and joints
Tags: subgrid build hinge pivot slide joint door hatch fin gantry master angle pos

A **subgrid** is a \`Build\` component carrying nested blueprint content —
hatches, doors, fins, gantry panels. Subgrids are INFO-SELECT ONLY: they
have no free gizmo (dragging them directly is wrong). They move in exactly
two ways, both through their **master** part:

1. the master's **joint state** (\`data.angle\` in DEGREES for hinges/pivots,
   \`data.pos\` in metres for linear tracks),
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

\`data.composite_builds\` entries index the FLATTENED component array (nested
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
`,w=`# Tools menu and dialogs
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
> (\`app/src/components/ToolsDialog.tsx\`): fields, preview, run (or a
> placement stage/commit pair + an optional ⚖ fix). The dialog UI, confirm
> flow and worker plumbing are shared.
`,T=`# Wire mode
Tags: wire pipes cables wiring auto-wire junction ports endpoints census disconnect reconnect unplug cable label hover overview network router battery hub input output direction candidate

**Wire** (∿) is the cable workspace — the craft's \`data.pipes\` graph as a
dock under the viewport, with a live **3-D hover label**: rest the cursor on
any cable and a gold chip prints where it goes —
\`Propeller[9].lv ↔ Computer[0].data-1\` while the cable itself gold-lights
through the hull. Labels are SHORT (v1.11, we: "we cant have names that are
too long"): kinds read **lv · hv · fl · it · data**, and port names
abbreviate their recurring words (\`lowvoltage-input\` → \`lv-in\`,
\`data_port.001\` → \`data-1\`). The verbatim file name is always in the row's
tooltip — the FILE keeps the full names everywhere.

## Hovering a cable (v1.11)

Rest the cursor on a cable (or its row in Cables): after a ~120 ms dwell
the gold label chip prints the pair (\`HV-Batt[288].hv3 ↔
HV-Bridge[216].port2\` — types and ports abbreviated, verbatim names in
the tooltip), the cable gold-lights through the hull, and **both parts at
its ends mint up**. Keep the cursor on it for **2 seconds**: a power surge
departs the point under your cursor and races along the cable to both
parts, and the geometry standing between the camera and those endpoints
turns into a ghost — every occluding face is cut out of its mesh and
re-laid at 16 % opacity, so you see exactly what the cable connects.
Un-hover and everything restores. The X-ray is screen-precise: the two
endpoint boxes and the cable's pixel extents (with depth) define what
counts as "in the way".

## What is wired to what

The dock has three columns (they stack on a phone):

| column | what it is |
| --- | --- |
| **Ports** | per-kind census: \`data 20/27 connected\` … plus the Auto-wire buttons |
| **Networks** | every CONNECTED group per kind, ordered \`sources → hubs → devices\`: \`MiniComputer[14] → Aileron[4], Beacon[26], …\` — click any chip to select that part |
| **Cables** | every cable as one row \`Type[9].port ↔ Type[0].port\`; hovering a row gold-lights that cable in the scene |

## Disconnect / reconnect (every component)

- **Cables list**: each row ends in a ✕ — that disconnects the cable.
  **Ctrl+Z** brings it back exactly.
- **This part**: select a component (list, viewport or a Networks chip) and
  its ports list shows each wired port with its partner (\`⇄ data-port ↔
  MiniComputer[14].data_port.010\`) and its own ✕; free ports are \`○\`.
- To reconnect: click the freed \`○\` port, pick a candidate part from the
  ranked list, then pick the exact port. The pairing writes the blueprint
  AND the save text — the game sees the same cables the editor draws.

## How cables hang (v1.11)

Cables come in two kinds, exactly as in the game, and the file says which
is which: **rigid conduit** (axis-aligned pipes — the recorded route
draws verbatim) and **flexible cables** (the file's \`flexible\` flag) —
those are drawn as live ropes: they hang as a proper hanging-curve with
sag set by how much cable there is for the gap (loose fit = deep sag;
plugs farther apart than the cable = pulled straight and taut). Drag a
part and its cables ride with it and re-hang; a cable bolted to a DOOR or
hatch (a subgrid) follows the door as it swings — the harness plugs into
the connector's LIVE position, not its closed-door spot. A cable always
leaves and enters its connector along the connector's stub axis (a short
straight lead in the cable's radius before any bend). The search words:
sag, hang, drape, catenary, taut, physics, door harness.

## Logical candidates — the ranking, and why it never overrules you

The game's own adapter names say what each port IS: \`lowvoltage-input\`
(the junction's single upstream socket), \`lowvoltage-port.NNN\` (its
downstream outputs), \`fluid-in\`/\`fluid-out\`, and on a DataBridge literally
\`data-computer.1\` / \`data-device.0\`. The editor derives from that:

- **direction** — an input never pairs with an input, an output never with
  an output; a hub's INPUT faces batteries/other hubs, never a device; a
  junction output never feeds back into a source.
- **topology** — sources (batteries, generators, solar panels) feed hubs
  (*Junction, *Bridge, routers, computers); hubs feed devices; power never
  runs device-to-device; a plain pump→tank fluid edge is fine only when
  both sides are named for it.

When you arm a port, candidates sort by that logic FIRST (the canonical
partner type, then distance within each class — each row states its reason,
e.g. \`device ← hub · 1.4 m\`). The ranking only ORDERS the list: every
compatible port stays listed and pickable, and a pairing you choose by hand
is never rejected or "corrected" by the heuristic.

## Auto-wiring is button-only — and honest

Auto-wire runs ONLY when you press its button; it never fires on open, edit
or save, and it NEVER touches an existing cable (your decisions win). It
fills free ports through the stages above. A port with no compatible
partner **stays open and says why** in the Warnings list — it no longer
force-pairs leftovers. (That old "last resort" pass is what wired control
surfaces into a junction's battery-side input — the junction input is
upstream and now provably stays free for the power source.) The naive
nearest-pair button stays as a fallback escape hatch.

## What the census checks

A cable's first/last segment ends ARE its connection points: the game
writes the cable tips at the part's VISIBLE socket. The panel flags a pipe
whose named endpoint component does not own that port (a stale reference),
so you can see broken wiring instead of guessing.

## Deleting keeps the graph honest

Deleting a component prunes every pipe entry and composite-build reference
pointing into its subtree and RENUMBERS the later ones (the files index the
FLATTENED component array). This is the fix for the classic corruption:
delete a part → the game says a computer's power cable "connects to an
aileron". If a file was already mangled by an old build, the census keeps
reporting those claims — repair them by disconnecting the stale cable rows.

> Cables draw exactly as recorded: every segment anchors at its own \`start\`
> (joints carry real offsets), so tube paths are never assumed straight.

## Where a cable plugs in (v1.8.1)

The round grey sockets you see on tanks, ports and machines in the game ARE
the parts' \`.ini\` adapter ports — the editor computes each one's live pose
(\`position + R(q)·adapter\`, the same raw-quat law the models use) and the
cable ends follow it: a recorded tip that still sits on its socket stub is
kept verbatim (it encodes how deep the plug was seated), a tip left behind by
a moved or turned part re-seats onto the socket. Move a part and its cables
ride with it — the game re-routes the paths at save; the editor keeps them
plugged in while you work.

And the wire always connects **in the connector's direction**: the cable bar
touching a socket runs along the socket's axis and continues straight for a
short lead (twice the cable's radius) before the route may bend, so plugs
enter the round sockets head-on with a visible neck, never stab in at an
angle. (A cached route that dives straight back into the part gets a plain
lead-in instead of a folded wire.)

Cables also draw like the game: ROUND hoses (fluid and HV are cylinders),
each segment in its own recorded colour (dark-red low voltage, orange high
voltage, white chrome fluid — older saves write near-black sheaths), with
elbow spheres at direction changes, sagging chains for flexible data runs,
and a black collar at every plug seat. The two flat species: the ITEM ducts
are square exactly as the file flags them, and DATA runs draw as a THIN
square bus (the file keeps its real radius — this is the viewport read).
`,E=`# Xenon — run the craft's computer programs
Tags: xenon worldsim world sim xenoncode window zoom drag resize fullscreen computer code program ide screen hd-screen virtual screen nodes canvas programing programming plomo firstflight badger mario wasm interpreter variables vars local locals disk files edit breakpoint debugger step frame autosave shadow deep link dash filter search cockpit keyboard wasd jump run space buzzer sound sawtooth melody super mario gamer-chair 25 hz tile flush mobile phone touch buttons pad

**Xenon ▾** (top bar, on any craft that carries a \`MiniComputer\` or
\`Computer\` — a freshly placed one included, its first program authored
right in the IDE) lists every programmable computer on the vessel. Clicking one
opens the **XenonCode IDE** — the same look as the in-game window: title bar
with the ON indicator, the File/Library/Computer menu row, one tab per \`.xc\`
file, line-numbered code, and the \`Program 'name' loaded / is running…\`
status lines at the bottom.

> **Work in progress** — the programs genuinely run on the developer's own
> interpreter, and the io around them is REAL (worldsim channels feed every
> \`input_number\`, cockpit keys feed the PilotSeat, Buzzer components make
> sound, dashboards paint and are clickable). What is not simulated: power,
> fuel, and the world answering the craft. Treat a game like Mario as fully
> playable; treat autopilot code as honest CODE view.

The computer runs at a **25 Hz** cycle cadence (25 program cycles per second,
\`delta_time\` ≈ 0.04 s — dt-driven programs like Chip's Mario run in real
time).

## What the IDE gives you

**It really runs.** The interpreter is the game developer's own XenonCode
code, compiled to WASM (pinned upstream, see \`tools/xenoncode/\` in the repo);
the program from the blueprint is compiled at open, exactly as the game's
computer does at power-on. The files live **in the craft** — the virtual
disk is the blueprint's \`data.hdd.xc_files\`, so everything you do here saves
with the craft and travels in the file.

* **Always editing + the virtual disk** — the code pane is a live text
  editor from the first glance (every line, no cap — huge 16k-line firmware
  files scroll fine); there is NO edit/view switch. \`💾 save\` (or \`CTRL+S\`,
  or **F5**) COMMITS the files to the craft — the tab shows a ● per changed
  file — and the computer **re-boots on the new code** (the game's rule),
  **breakpoints included**: your red dots survive the re-boot and stop it
  again. Closing the IDE without saving discards the unsaved buffers. The
  craft's routine autosave keeps shadow-copying the blueprint as always.
  The \`File ▾\` row shows the disk and **creates** files
  (plain \`.xc\` includes, or \`program\` → \`name.main.xc\`) and **deletes** the
  open tab. Files you create are in the saved blueprint and in the game.
* **Nav history** — every jump (library click, go-to-definition, Ctrl+G,
  a breakpoint hit, tab switch) records a navpoint: \`◀ ▶\` beside the tabs
  (and \`ALT+←\` / \`ALT+→\`) walk back and forth through where you'd been.
* **Breakpoint follow** — when the run stops on your breakpoint, the
  editor moves to the hit (file + line), so you land exactly where the
  program parked; \`◀\` takes you back to what you were editing.
* **Debugger** — click a line's gutter for a red breakpoint; **F10** steps
  ONE executed line at the current level (a call is stepped over),
  **F11** steps into the call, **F8** resumes. The run toolbar beside the
  tabs carries the same as classic buttons: **▶ run/resume, ⏸ pause,
  ⟳ re-boot, ⏹ stop, ⇥ step-over, ↓ step-into**. When a break (or a step)
  stops the program, the editor jumps to the line that just executed —
  \`Alt+←\` walks the nav history back to where you were.
* **$ knows your frame** — typing \`$\` completes globals AND, while the
  debugger is paused, the live LOCALS of the frame you stopped in (marked
  \`· frame\`). A file with unsaved changes wears a **red dot** on its tab.
* **Find, goto, indent** — \`CTRL+F\` opens the editor's find panel from
  anywhere in the IDE (it never triggers the browser's own search).
  \`CTRL+G\` jumps to a line number. \`TAB\` always indents inside the code
  (the cursor never escapes to the page). Pressing **Enter** after
  \`init\`/\`update\`/\`tick\`/\`timer\`/\`input\`/\`screen(...)\`, a
  \`function @name(…)\` line, or a control-flow line (\`if\`, \`elseif\`,
  \`else\`, \`while\`, \`repeat\`, \`for\`, \`foreach\`) lands **one indent
  deeper**; plain lines keep their indent. \`Esc\` closes find/goto and
  leaves the IDE open.
* **Library tab** — the side panel's \`Library\` index lists every **declared
  function on this computer** (click = jump straight to the declaration,
  across files) and the whole **built-in XenonCode library** with a
  signature and a one-line meaning each, split into **coloured category
  tabs** (I/O, Screens, Devices, Values, System, Recipes, Worldsim — the
  tab colour is the row colour). The search row filters all groups.
  Typing completes library functions WITH their signature and meaning.
* **io ports know their device** — hover an \`input_number("Engine", 0)\`
  (or \`output_number\`/\`input_text\`/\`output_text\`) and the tooltip shows
  the part's **live 3-D preview** (the same animated model render the
  placement menu uses), names the DEVICE (alias, type), what that io's
  channel MEANS in the game (with its range) and the LIVE value — reads
  show what the device sent the program, writes what the program sent
  it. **Ctrl+Click** flies the 3-D view to that device.
* **Maximise** — the \`⛶\` button in the title bar (or a **double-click on
  the title bar**) fills the screen; the same control restores the window
  to its old size and place.
* **Screens** — programs call \`screen(alias, channel)\`: \`alias\` is a
  Dashboard's name (or its io port number) and \`channel\` counts its
  elements. The bound \`Screen\`/\`HdScreen\` surfaces paint live at their real
  pixel size, the craft's 3-D dashboards display the same raster on their
  panels, and the **▣ Screens** button (top bar, on crafts with dashboards)
  opens the bottom tab with **Dashboards** and **Virtual** sub-tabs — the
  virtual ones are the \`virtualscreen(w,h)\` buffers a program composes
  (Chip's Badger builds its attitude display out of those).

## Dash windows — zoom, filter, deep link

We: "640×480 dashboard too small to read, clicking makes it worse, no
zooming, no filter". The dash windows are now the read/write surface:

* **Click a dashboard cell to open it full-screen.** The tiny thumbnail in
  the dock no longer sends its click to the program (so a mis-click cannot
  press a \`button_rect\` and change the screen under you). A **click on the
  thumbnail opens a dedicated zoom window** for that ONE surface: **fit /
  1:1 px / + / −** buttons, pinch or **Ctrl+wheel** to zoom, scroll/drag to
  pan. The pixels are sharp (\`pixelated\`), so a 640×480 panel is readable.
* **Clicks in the zoom window ARE the program's** — they land on the
  surface at its exact pixel coordinates, and the game's \`button_rect\`
  buttons evaluate true exactly as in game. This is where you press the
  dashboard buttons.
* **A search box** (▣ Screens header, and the IDE's Screens tab) filters
  the surfaces by name, so a 118-buffer craft (the Badger) is navigable.
* **▦ Tile** (▣ Screens header): collapses the spacing between dashboards
  to ZERO — gaps, padding, borders and labels off — so multi-panel walls
  (Mario's six HdScreens, a craft's full dashboard row) tile flush and read
  as one continuous surface. Click again to restore; persisted.
* **Play on your phone** — on touch devices the screen itself carries a
  TRANSLUCENT COCKPIT PAD: a W/A/S/D cross at the bottom-left, ▲ ▼ E F ␣
  at the bottom-right. Pressing a button is the key-DOWN (the seat channel
  goes to ±1), letting go is the key-UP (the stick centers); sliding a
  finger off a button releases it too. The pad rides the fullscreen zoom
  window and every tile in ▦ Tile mode — a phone + a deep link is a
  handheld console. Tap a plain thumbnail (no pad in the browse grid) to
  open its zoom window, and the pad is there.
* **Deep link** — \`?craft=<id>&dash=<surfaceKey>\` (e.g.
  \`?craft=3820116990&dash=first-virtual\`) opens the app straight into the ▣
  Screens dock **with that one surface's zoom window already raised**, as
  soon as it paints. \`#\` is \`%23\`; the surface key is the lowercase
  \`alias#channel\` shown under each thumbnail — and \`first-virtual\` focuses
  the FIRST virtualscreen (a game's composition canvas, e.g. Mario's
  900×600, which is where the game actually renders).

## Cockpit keys — fly the craft from the dash

While you are looking at the ▣ Screens dock, the IDE's Screens tab, **or**
a Mario-style deep link, the keys are the cockpit's inputs. Every documented
PilotSeat output channel has a worldsim row, so every key reaches the
computer — the seat is padded to the full 18-channel table, not just the
channels a program happens to read:

| Key | PilotSeat channel | In Chip's Mario | In the Space Invaders arcade |
|---|---|---|---|
| W / S | Backward / Forward (ch 1) | run / walk-back | (name entry) |
| A / D | Left / Right (ch 2) | move | move the cannon |
| ↑ / ↓ | Down / Up (ch 3) | jump / duck | fire / start |
| Space | **Down / Up (ch 3)** + Aux 1 (ch 8) | jump | press-SPACE-to-play |
| F | Aux 1 (ch 8) | jump | — |
| E / Q | Roll (ch 5) | fire | — |
| I / K | Pitch (ch 4) | — | — |
| J / L | Yaw (ch 6) | — | — |
| R | Main Thrust (ch 7) | — | — |
| 1 2 3 … 9 0 | Aux 1 2 3 … 9, Aux 0 (ch 8-17) | — | — |

Every press drives **all** the PilotSeat channels the running computer has
bound (a craft with two seats drives both), feeding \`input_number\` the
signed value; release centers the stick to 0 (it's a stick, not a latch).
A bound cockpit channel RESTS AT ZERO — an untouched PilotSeat sends 0,
exactly like the game. The app's global \`g\`/\`o\`/\`h\`/\`w\`/\`5\` view shortcuts
stand down while the dash is armed — the \`w\` key is Mario's run key, not
the wireframe toggle. On a craft with no cockpit the keys pass through
untouched.

## Buzzers — the craft makes sound

The game's **Buzzer** component produces tones of type \`sine\`, \`square\`,
\`triangle\` or \`sawtooth\` (the component's config, the in-game \`V\` menu),
with **Amplitude** (channel 0) and **Frequency** in Hz (channel 1, default
440) on its data channel. Programs drive them with \`output_number\`. One
oscillator per Buzzer, so a program using many buzzers (melody + harmony
+ bass + effects, as Chip's Mario does) plays chords.

**Hearing it**: **the sound is ON by default** — the top-bar 🔊 icon
beside ⚙ View starts enabled. Browsers forbid audio before you touch
anything (Firefox the strictest of all), so the game unlocks its audio
by itself at your **first keypress or tap** — for Mario, the very first
jump press starts the music, no settings hunt. **While any buzzer is
playing, the icon throbs**; click it any time to mute (a static 🔇).

**The tone each buzzer plays is its own**: the game stores it in the
component's \`mode\` setting (the in-game \`V\` menu) — the inspector now
shows it as **named modes** (0 · sine, 1 · square, 2 · triangle,
3 · sawtooth). In **auto** (the default wave chip) every buzzer plays
the tone its component authored — Chip's Mario: melody and harmony
square, **bass triangle**, **effects sawtooth**; forcing one wave on
all eight is the override, and was the "sound is funky" report.

For a game like Mario: the title screen is Chip's own SILENT attract demo
(his \`musicgate=0\`); the level themes start when a game does — jump
(␣/F/▲) to start, and the melody/harmony/bass buzzers carry the tune.

## Mario, in the browser

\`?craft=3820116990&dash=first-virtual\` — Chip Patton's **PKC-385 "Super Mario
Brothers"**, a XenonCode game that reads the \`gamer-chair\` PilotSeat, drives
eight Buzzer components for its 8-bit music and paints six HdScreen
surfaces. Sit in the seat (worldsim default = occupied, so it reads seated),
open the TV surface, click 🔊, and play with WASD/↑/↓/F.

On a phone the interpreter runs the game at ~14 updates/s; the computer is
fed the REAL time between updates, so Mario moves at true speed (a choppy
14 fps, not slow motion) and the buzzer tunes play at their proper tempo.
* **Side panel** (tabbed, with the tab row on top at the SAME level as the
  tab's search box):
  * **Vars** — ONE panel, two sections, LOCALS ALWAYS ON TOP:
    * **Locals** (top) — the LOCAL variables of the function owning the
      PAUSED line: its arguments and body variables, read LIVE from the
      interpreter at the stop. A frame is born at a debugger STOP (click a
      line's gutter, step with F10/F11) and stays listed as \`last stop ·
      stale (running)\` after resume — while the program RUNS there is no
      parked frame to read, so only globals tick. Recursion copies badge
      \`#1\`, \`#2\`…; a \`$var\` hover in the code reads the paused frame
      first, globals while running. Top-level lines have no locals.
    * **Globals** (below) — every global variable of the running program,
      live: RAM and \`storage\` values, with \`storage\` tagged. Text values
      in the language's key-value form (\`.on{1}.red{255}\`) break open into
      their members.
  * The type rides beside every name (\`number\`, \`text\`, \`storage\`,
    \`array\`, \`object\`). Search filters names AND values in both sections.
  * **Editable values** — while the debugger is PAUSED, number and text
    values are click-to-edit (locals of the frame, and globals): type the
    new value, Enter writes it INTO the running program's memory (Esc
    cancels). A number cell refuses anything but a finite decimal
    (\`42\`, \`-1.5\`, \`1e3\`, \`true\`/\`false\`) with an inline message; text
    accepts anything; \`storage\` (world-save), arrays and objects refuse.
    While a worker RUNS there is no writable moment — break first
    (gutter click / F9). Main-thread mode (non-isolated origin) writes
    anytime — the VM shares the page thread.
  * **Screens** — the same live surfaces, searchable by name.
  * **Bus** — the \`input_number\` sliders (every io/channel the program
    reads) and the \`output_number\` stream (target · port · latest value).
  * **Console** — \`print(...)\` lines.
* **\`$var\` hover** — in the code, hovering any \`$variable\` shows a tooltip
  with its CURRENT value; when the value changes, the OLD value floats
  above the current one and fades out.
* **Nodes tab** — programs authored in the game's visual node editor carry a
  \`#NODES\` block (the Cheap Exploration Plane and Cede's autopilot are two);
  the IDE renders that graph — node cards, ports and wires — with pan (drag)
  and zoom (wheel). **io-addressed nodes show live values**: input cards
  print the value the program ACTUALLY read from that component's channel,
  output cards the io-bus value on each port.
* **Syntax + validation** — code is highlighted with the language's own
  token classes (the dev's editor mode) and every visible line is parsed by
  the real compiler; a line the compiler rejects is marked in red (hover for
  its message).

## Not simulated

Power, fuel and the world's physics are deliberately ignored — this is the
blueprint-side workbench, not a flight simulator: the craft never moves,
sensors report what the World tab's functions say, and the PilotSeat reads
your keyboard. The standalone workbench page (with our own demo programs)
lives at \`tools/xenoncode/\` in the repo.

## Scripting the debugger

The Help manual topic **“Debugging XenonCode”** (\`xenondebug\`) documents
the breakpoints/frames/stepping law and the \`window.__XCDBG__\` console —
a plain-JSON JS API (\`break\` / \`run\` / \`step\` / \`frame\` / \`write\` / \`io\` /
\`bus\` / \`prints\`) designed so scripts and AI agents can analyze a program
headlessly.
`,D="# Debugging XenonCode — breakpoints, frames, the console\n\nTags: debugger debug breakpoint breakpoints locals frame step stepping console xcdbg ai agent script headless automation api run to cursor write value inject timer update block console log analysis analyze xenoncode program counter plomo\n\n## The debugger in the IDE\n\nOpen a computer's XenonCode IDE, pick a code tab, and click a line's\n**gutter** — a red ● marks a breakpoint (the BREAKPOINTS strip lists them\nall with their enclosing function). The program runs normally and PARKS\nmid-cycle at the breakpoint: the pause pill shows `file:line`, the Vars\npanel's top section shows the **Locals** of the frame you stopped in (its\narguments and block variables, with types), the globals tick below. Step\nwith **F10** (over) / **F11** (into), resume with **F8** or the Run menu.\n**F5** runs the program fresh: it COMMITS the files (a commit re-boots the\ncomputer on them, breakpoints included — the editor is always live, saving\nis the commit).\n\nA frame exists for `function @name` bodies **and** for the global-scope\nblocks: `update`, `init`, `tick`, `timer frequency N`, `input N` — they\ncompile as named bodies with their own variables (v1.13.24: a break in an\n`update` body is a frame labeled `update`, not \"top level\"). Plain\ntop-level lines have no locals — those variables are the globals.\n\nClick a number/text value while paused to **edit** it: Enter writes it\ninto the program (validated by type), Esc cancels.\n\n## The debug console — `window.__XCDBG__` (for scripts and AI agents)\n\nEvery debugger law is also a plain JS API on any page where a computer is\nopen — no DOM needed. Everything answers plain JSON-serialisable data, so\nan agent driving the page (Playwright `page.evaluate`, the browser\nconsole, a userscript) gets a text protocol:\n\n| call | meaning |\n|---|---|\n| `__XCDBG__.status()` | `{status, cycles, paused, file, line, frame, worker}` |\n| `__XCDBG__.files()` / `source(name)` | the disk: names + line counts / full text |\n| `__XCDBG__.break(file, [lines])` | set breakpoints for a file (answers the live list) |\n| `__XCDBG__.clear(file?)` / `breakpoints()` | remove / list |\n| `__XCDBG__.run({cycles})` | resume (from a pause) until the next break / budget |\n| `__XCDBG__.step('over'|'into')` | F10/F11 as a call: answers the new site + frame |\n| `__XCDBG__.goto(file, line)` | run until that line executes, pause there |\n| `__XCDBG__.frame()` | `{file, line, frame, locals:[{name, type, value, copy?}]}` |\n| `__XCDBG__.locals()` / `globals()` | typed rows |\n| `__XCDBG__.write(name, value, scope?)` | validated writeback into the VM (same law as the row editors); answers `{ok}` / `{ok:false, error}` |\n| `__XCDBG__.io(io, ch, value)` | feed an input channel (the Bus-tab slider law) |\n| `__XCDBG__.bus()` / `prints()` | the io-bus rows / the program's prints |\n\nTypical agent session (the `e2e/xenondbg.spec.ts` spec is exactly this,\nheadless):\n\n```js\n__XCDBG__.io(11, 3, 1)                      // open the throttle-key channel\n__XCDBG__.break('functions.xc', [10])       // $result += $increment\nawait __XCDBG__.run({ cycles: 500 })        // -> {paused:true, file:'functions.xc', line:10, frame:'@selectcase'}\nconst f = __XCDBG__.frame()                 // locals: [{name:'increment', type:'number', value:'5'}, …]\nawait __XCDBG__.write('$result', '42')      // inject -> the paused program resumes with 42\nawait __XCDBG__.step('over')                // one line forward, still parked\nawait __XCDBG__.goto('functions.xc', 31)    // frame: 'timer frequency 4', locals include $change\n__XCDBG__.clear(); await __XCDBG__.run({ cycles: 30 })   // stream freely\n```\n\nNotes: on a localhost (isolated) origin the VM runs on a worker thread, so\npauses are **mid-cycle** — locals and writes are the parked VM's own state;\nwrites are accepted only while PAUSED there. `break()` answers an\n`{error}` when the file is not on the disk (the answer lists the names).\nThe cycle budget bounds every call: a run never hangs a caller forever.\n",O=`# Testing & Automating XenonCode — the Auto-test panel
Tags: testing test automation xenoncode automate automated headless AI agent scripting script diagnose diagnostics CI asserts bench buzzer bus snapshot programmatic xenontest craft diagnosis computer debug probe

**Want to automatically test a XenonCode program, run a probe on a craft's
computer, or let an AI agent diagnose a machine?** The IDE's **Auto ▸
test panel** (Xenon ▸ pick a computer → side tab **Auto**) is a tiny
scripting interface built for exactly that — no game engine, no hardware,
just the computer, its io bus, and assertions.

## The script format

A XenonTest script is a handful of plain lines:

\`\`\`
name: buzzer-bench
program: |
  var $t = 0
  update
    $t += 1
    output_number("horn", 0, 0.8)
    output_number("horn", 1, 440)
cycles: 20
assert:
  - bus("horn", 0) == 0.8
  - bus("horn", 1) == 440
  - wave("horn") == "sawtooth"
  - prints == 0
  - cycles >= 20
\`\`\`

* **\`program:\`** *(optional)* — XenonCode booted onto this computer for
  the test (it uses the same write-back as the disk editor, so it lands
  in the craft and the VM auto-reboots, exactly like editing a file).
  Omit it to test the craft's **own** programs — the diagnostic case.
* **\`cycles:\`** — the VM is advanced EXACTLY this many cycles,
  deterministically (the live loop is gated out during the run), so
  asserts see a known phase.
* **\`assert:\`** — expressions over the computer's live snapshot:
  \`bus("alias", ch)\` (last value written to that io channel),
  \`amp("alias")\` / \`freq("alias")\` / \`wave("alias")\` (per-device census —
  buzzers, lamps, anything on the bus), \`cycles\`, \`prints\`.
  Operators: \`== != >= <= > <\`.

Click **▶ run test** — every assert lists green ✓ or red with the actual
value, and the header reads e.g. \`buzzer-bench: 5/5 PASS\`.

## The programmatic door (for automation and AI agents)

The same runner is on the page as a plain function:

\`\`\`js
await window.__XENONTEST__.run(\`name: check
cycles: 20
assert:
  - bus("horn", 0) > 0.5\`)
// -> [{ expr: 'bus("horn", 0) > 0.5', ok: true, actual: '0.8' }, ...]

window.__XENONTEST__.snapshot()
// -> { cycles, prints, bus: {"horn:0": 0.8, ...},
//      devices: [{ alias, type, mode, amp, freq, wave }, ...] }
\`\`\`

\`run()\` returns JSON — point Playwright, a browser extension, or an
**AI agent** at it, read the asserts, and you can drive and diagnose any
craft's computer from the browser console: write probe programs, watch
the io bus, prove a hinge's angle changed, prove a buzzer sings
(the app exposes the WebAudio analyser level too, so “does it make
sound?” is a measurable assert). The fixture craft **Buzzer Bench**
(id \`9000008001\`) ships with the panel preset: one computer, one sawtooth
buzzer, one pilot seat — the smallest machine that proves the whole
signal chain.

## Diagnosing a craft

A quick check-up script for a craft you inherited:

\`\`\`
name: checkup
cycles: 60
assert:
  - cycles >= 60          # the VM runs at all
  - prints == 0           # nothing crash-printing
  - amp("game-melody") >= 0   # the bus census answers per device
\`\`\`

Run it against each computer in the Xenon ▾ menu: a computer that boots
but writes nothing, a channel that never moves, a buzzer wired to no
program — the asserts name the one that lies.
`,k=[`start`,`interface`,`keys`,`parts`,`blocks`,`mirror`,`subgrids`,`display`,`tools`,`hullify`,`balloon`,`lift`,`wire`,`save`];function A(e,t){let n=t.split(`
`),r=e,i=[],a=0;for(;a<n.length;a++){let e=n[a].trim();if(e){if(/^#\s+/.test(e))r=e.replace(/^#\s+/,``);else if(/^tags:/i.test(e))i.push(...e.replace(/^tags:/i,``).split(/[\s,]+/).filter(Boolean));else break}}let o=n.slice(a).join(`
`),s=`${r} ${i.join(` `)} ${u(o)}`.toLowerCase();return{id:e,title:r,tags:i.map(e=>e.toLowerCase()),body:o,words:s}}var j=Object.entries(Object.assign({"./topics/balloon.md":d,"./topics/blocks.md":f,"./topics/cost.md":p,"./topics/display.md":m,"./topics/hullify.md":h,"./topics/interface.md":g,"./topics/keys.md":_,"./topics/lift.md":v,"./topics/mirror.md":y,"./topics/parts.md":b,"./topics/save.md":x,"./topics/start.md":S,"./topics/subgrids.md":C,"./topics/tools.md":w,"./topics/wire.md":T,"./topics/xenon.md":E,"./topics/xenondebug.md":D,"./topics/xenontest.md":O})).map(([e,t])=>A(e.replace(/^.*\//,``).replace(/\.md$/,``),t)).sort((e,t)=>{let n=k.indexOf(e.id),r=k.indexOf(t.id);return(n<0?k.length:n)-(r<0?k.length:r)||e.id.localeCompare(t.id)});function M(e){let t=e.toLowerCase().split(/\s+/).filter(Boolean);if(!t.length)return j.map(e=>({topic:e,score:0}));let n=(e,t)=>{let n=0,r=e.indexOf(t);for(;r>=0&&n<8;)n++,r=e.indexOf(t,r+t.length);return n},r=[];for(let e of j){let i=0,a=!0;for(let r of t){let t=e.title.toLowerCase().includes(r)?8:0,o=e.tags.some(e=>e.includes(r))?4:0,s=n(e.words,r);if(!t&&!o&&!s){a=!1;break}i+=t+o+Math.min(s,4)}a&&r.push({topic:e,score:i})}return r.sort((e,t)=>t.score-e.score||k.indexOf(e.topic.id)-k.indexOf(t.topic.id))}var N=t();function P(e){let[t,r]=(0,n.useState)(``),[i,a]=(0,n.useState)(j[0]?.id??`start`),[o,s]=(0,n.useState)(null),c=(0,n.useRef)(null),u=(0,n.useRef)(null),d=(0,n.useRef)(null),f=(0,n.useRef)(e.onClose);f.current=e.onClose,(0,n.useEffect)(()=>{let e=e=>{e.key===`Escape`&&f.current()};return addEventListener(`keydown`,e),()=>removeEventListener(`keydown`,e)},[]);let p=(0,n.useMemo)(()=>M(t),[t]),m=t.trim().length>0,h=(0,n.useMemo)(()=>m&&p.length?p[0].topic:j.find(e=>e.id===i)??j[0],[m,p,i]),g=(0,n.useMemo)(()=>h?l(`# ${h.title}\n\n${h.body}`):null,[h]);(0,n.useEffect)(()=>{d.current?.scrollTo({top:0})},[h?.id]);let _=e=>{if(e.target.closest(`button,input`))return;let t=o??{x:0,y:0};c.current={sx:e.clientX,sy:e.clientY,bx:t.x,by:t.y},e.currentTarget.setPointerCapture(e.pointerId)},v=e=>{let t=c.current;if(!t)return;let n=u.current,r=n?.parentElement,i=t.bx+e.clientX-t.sx,a=t.by+e.clientY-t.sy;if(n&&r){let e=r.getBoundingClientRect(),t=n.getBoundingClientRect(),o=Math.max(0,e.width/2-t.width/2),s=Math.max(0,e.height/2-t.height/2);i=Math.min(o,Math.max(-o,i)),a=Math.min(s,Math.max(-s,a))}s({x:i,y:a})},y=()=>{c.current=null};return(0,N.jsx)(`div`,{"data-testid":`help-backdrop`,className:`fixed inset-0 z-40 grid grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]
                 place-items-center bg-black/60
                 p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:p-3 md:pt-3 md:pb-3`,onMouseDown:t=>{t.target===t.currentTarget&&e.onClose()},children:(0,N.jsxs)(`div`,{ref:u,"data-testid":`help-dialog`,role:`dialog`,"aria-label":`Manual`,className:`ksp-win flex h-full w-full max-h-full max-w-none flex-col rounded-none px-3 py-2
                   md:h-auto md:max-h-[min(86dvh,100%)] md:w-[860px] md:max-w-[95vw] md:rounded-lg md:px-4 md:py-3`,style:o?{transform:`translate(${o.x}px, ${o.y}px)`}:void 0,children:[(0,N.jsxs)(`div`,{"data-testid":`help-drag`,className:`ksp-label flex shrink-0 cursor-move touch-none select-none items-center gap-2
                     border-b border-white/10 pb-1.5 text-[12px] text-accent`,onPointerDown:_,onPointerMove:v,onPointerUp:y,onPointerCancel:y,children:[(0,N.jsx)(`span`,{className:`text-[14px]`,children:`ⓘ`}),` Manual — Archean Blueprint Inspector`,(0,N.jsx)(`button`,{"data-testid":`help-close`,onClick:e.onClose,"aria-label":`close`,className:`ksp-btn ml-auto rounded px-1.5 text-[11px] text-ink-dim hover:text-accent`,children:`✕`})]}),(0,N.jsxs)(`div`,{className:`flex shrink-0 items-center gap-2 pt-2`,children:[(0,N.jsx)(`input`,{"data-testid":`help-search`,value:t,onChange:e=>r(e.target.value),placeholder:`search topics — try: sphere, mirror, undo, lift, palette…`,className:`ksp-btn w-full rounded px-2 py-1 text-[12px] normal-case tracking-normal
                       text-ink placeholder:text-ink-dim/70 focus:outline-none`}),(0,N.jsx)(`span`,{"data-testid":`help-matchcount`,className:`shrink-0 text-[10px] tabular-nums text-ink-dim`,children:m?`${p.length}/${j.length}`:`${j.length} topics`})]}),(0,N.jsxs)(`div`,{className:`flex min-h-0 flex-1 flex-col gap-2 pt-2 md:flex-row`,children:[(0,N.jsxs)(`nav`,{"data-testid":`help-rail`,className:`tool-scroll flex shrink-0 gap-1 overflow-x-auto md:w-40 md:flex-col md:overflow-y-auto md:pr-1`,children:[p.length===0&&m&&(0,N.jsxs)(`div`,{"data-testid":`help-noresults`,className:`px-2 py-1 text-[11px] italic text-ink-dim`,children:[`no topic matches “`,t.trim(),`”`]}),p.map(({topic:e})=>(0,N.jsx)(`button`,{"data-testid":`help-topic-${e.id}`,onClick:()=>{r(``),a(e.id)},className:`ksp-btn shrink-0 whitespace-nowrap rounded px-2 py-1 text-left text-[11px]
                            md:whitespace-normal ${!m&&e.id===h?.id?`on`:``}`,children:e.title},e.id))]}),(0,N.jsx)(`div`,{ref:d,"data-testid":`help-article`,className:`tool-scroll manual min-h-0 flex-1 overflow-y-auto overscroll-contain rounded
                       border border-white/10 bg-black/25 px-3 py-2 md:px-4`,style:{scrollBehavior:`smooth`},dangerouslySetInnerHTML:{__html:g?.html??``}})]})]})})}export{P as default};