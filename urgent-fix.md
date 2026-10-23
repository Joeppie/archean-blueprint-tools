# URGENT FIX — tail rudder swings on the wrong axis (+ four tool-desk fixes)

**Status: UNFIXED — documented deliberately at the end of a full session so the
work continues in a fresh prompt (the v1.8.6 face-drop fix below is DONE and
shipped; it stays here as the post-mortem of that bug class).**

Naming/style note for this repo's messages, effective immediately and
permanently: **never refer to us as "the user" — write "we / us / our"** (the
same rule now lives in the shared `~/.config/opencode/AGENTS.md`). Historical
`user:` quotes in older bullets stay as they are.

---

## 1 · THE TAIL RUDDER SWINGS SIDEWAYS LIKE A PROPELLER (the real bug)

**What we see:** after Generate balloon ▸ fins, the **rudder** panel (the vertical
vane on the centreline) turns *sideways about the fore–aft axis — the way a
propeller spins* — instead of swinging **left/right about the vertical**, which
is what a rudder does. It must NOT copy the ailerons' motion (they roll about
the longitudinal axis, and for them that is right). Desired: yaw, left/right,
about the world UP axis through the hinge line.

**Measured (this session, live editor, rx 2 / ry 2 / rz 8, fins on, nothing
rotated — the captured joint lines from `engine.subJrefs`):**

| subgrid | master | captured `axis0` | verdict |
|---|---|---|---|
| rudder Build | SmallHinge | **(0, 1, 0) = world up** | the *stored* axis is already the yaw axis |
| aileron R Build | SmallHinge | (0, 0, 1) = longitudinal | correct for an aileron |
| aileron L Build | SmallHinge | (0, 0, 1) = longitudinal | correct for an aileron |

So the AXIS the file+engine pair carries for the rudder is up, yet the motion we
watch is a prop-like roll. The wrong motion therefore does NOT come from the
axis choice — it comes from **how the pose is composed/applied for this panel**
(or from which handle drives it). Do not "fix" it by flipping an axis sign
before measuring the actual swing.

**Measure the swing first (the arbitration, ~10 min):**
`node app/tools/jointturn.mjs <craft>` traces one joint's angle turn — a point
on the joint line must not move and the panel centre must circle it at a
constant radius. Build a finned balloon (`app/tools/tailshot.mjs` /
`tailview.mjs` drive the same tool), set the rudder master's `data.angle`
through a range and print the panel's world bbox / a vertex path. Expectation
for a correct rudder: the panel's **lateral (|x|) extent grows/shifting while
its vertical extent stays constant** (a yaw), NOT the vertical extent swinging
sideways (a roll).

**Prime suspects, in order:**

1. **The panel subgrid has NO blocks and NO nested parts — only `data.triangles`.**
   `subBlockBBox()` (app/src/engine/subgrid.ts:161) returns **null** for it, so
   `captureJrefs` takes the **parts-only branch** (line 210): `pivot0` = the raw
   `.ini` axle pivot and `axis0` = the `.ini` pin. The panel-bbox clamp AND the
   v0.175-177 kinematic-triad rule NEVER RUN for our fin panels. The whole
   motion is then decided by the authored mount quaternion + the `.ini` pin.
   A triangle-only panel is a case this rule set has never had to serve.
2. **The mount frame written by the tool** —
   `app/src/engine/balloonfin.ts:366-368` authors the rudder pivot with
   `frame = { ax: uHat × tHat, ay: uHat, az: tHat }`, i.e. the part's local ŷ
   (= the SmallHinge barrel axis, `.ini` `axis: "y"`, axle euler 0) lands on
   world up. If instead the *display* composes the master's quat differently
   (`fileToViewQuat`, or the `nested triangles are parent-absolute` rule), the
   hinge's own ring visual and the panel's rotation can disagree — the gold
   ring we drag may sit on the aileron-style axis while the stored axis reads
   up (see the `hinging.mjs` audit tool: "a mirrored clamp line put the handle
   metres away").
3. **The rigid master-pose delta** riding the group
   (`X' = p0 + dq·(p−p0) + (p−p0)`) plus the fact that all three pivots share
   the same authored frame style: if the rudder's `dq` term dominates (pivot
   far from the panel content because there is no block bbox to clamp onto),
   the visible motion is a big roll around a distant axis — which reads exactly
   like a prop.

**What "fixed" means:** dragging the rudder's hinge ring (or its panel
`data.angle` slider) swings the vane left/right about the vertical hinge line,
the ailerons keep rolling, and the twin pair stays mirror-symmetric. Pin it in
`app/e2e/` (a real drag like `hinge.spec.ts`, or a `subride`-style joint-line
audit on a generated balloon) asserting the SWEEP DIRECTION from world
coordinates — data-only assertions cannot pin a rotation direction (the
standing AGENTS lesson).

---

## 2 · VOLUME: exactly ONE block — a yes/no toggle

We allow **at most one** `Volume` block: it is a **toggle**, not a count.
Today `volumes` is a 0-16 count (`balloonfin.ts` `nVol = clamp(round(opt.volumes),
0, min(16, volFit))`, one Volume per cell stacked up from `c[up] + 0.748`), and
the plan even reports `counts.volumes` with a "(clamped from N — envelope)"
note in the preview. Change it to ONE boolean (off / on → 0 or 1 Volume at the
envelope centre) and drop the clamp note:
- `ToolsDialog.tsx:385` the `volumes` field is `kind: 'range', min 0, max 16` →
  a two-option `select` off/on exactly like `fins` (`ToolsDialog.tsx:350`), and
  `balloonOptions(f)` maps it to `BalloonOptions.volumes` (0/1);
- `balloonfin.ts:351` `nVol = clamp(round(opt.volumes), 0, min(16, volFit))` →
  `opt.volumes ? (volFit >= 1 ? 1 : 0) : 0` (keep the honest "does not fit"
  behaviour), and the `volumes` loop `p[up] = c[up] + 0.748 + i` keeps only i=0;
- re-pin `balloonfin.test.ts` (count expectations), `e2e/sphereskin.spec.ts`
  (the TAIL test's `volumes: 1` assertion + any `tool-range-volumes` testid →
  `tool-opt-volumes-*`), and help `topics/balloon.md`.

## 3 · THE PREVIEW LINE IS TOO LONG AND DOESN'T REFLECT OUR CHOICES

The dialog's live readout runs to several sentences
(`ToolsDialog.tsx` `tailNote()` appends "· tail (cone untouched): fillets N tri
+ hung rudder/aileron panels N tri on SmallHinge pivots, LV×3 hidden inside ·
volume N (clamped from M — envelope) enclosed" to the base stats line), and it
reads the same whatever we pick. Make it **short and choice-specific**: say what
the current settings actually produce (body + size, fins on/off and which pivot
type, shading, paint finish/slot), one compact line, numbers only where they
change with a control. Keep the deviation line (`dev −x/+y m`) and the honest
"nothing to place…" refusal wording — pins read those
(`e2e/sphereskin.spec.ts` polls `/rudder/`, `/triangles/`, `/nothing to place/`,
`/90% nose/`; the TAIL test polls for `rudder` and `enclosed`), so re-pin the
tests to the new short phrasing rather than leaving both.

## 4 · CYLINDER (zeppelin-style) IS THE DEFAULT BODY

`ToolsDialog.tsx:413` opens with `initial: { …, profile: 'round', … }` →
**`profile: 'cylinder'`**, so the tool opens on the zeppelin shape we actually
use (and the tail section is then visible immediately instead of hidden).
Check the dialogs that inherit/restore a previous form (the ↩ back path keeps
the form, `initialForm`) and any test that stages a ROUND body without setting
the body select explicitly (`e2e/sphereskin.spec.ts` `stage()` uses ranges only
— those tests currently ride the round default and will switch to the
cylinder; re-pin deliberately, don't let them pass by accident). Help
`topics/balloon.md` + `topics/tools.md` follow.

## 5 · LANGUAGE: write "we / us", never "the user"

Applies to replies, commit messages, code comments and docs written from now on
(existing quoted history untouched). Recorded in the shared AGENTS.md so every
session picks it up; keep it consistent in the bullets above.

---

# DONE · v1.8.6 — the skin transform CUTS, never drops (post-mortem, shipped in `b13e6a5`)

Kept as the post-mortem — the bug class (frame-alignment, not sizing) is subtle
and the second defect found there was invisible from the original report.

**Symptom:** Generate-balloon, cyl + nose, rx 12 / ry 8 / rz 12 m, fins on: the
ghost showed a large rectangular hole in the body side, and "a valid zeppelin
suddenly misses a face after rotations … depending on where it is rotated,
possibly moved … the size doesn't inherently change" — a frame-level drop, not
a sizing problem.

**Root cause 1 — the transforms dropped instead of cutting.** The game's
31-slot triangle window is FRAME-ALIGNED: with `f = floor(min/12)`, every
`v = g − 12f` must be in 0..31, so a face whose per-axis span exceeds 20
encodes ONLY while `min` sits low enough inside its 12-cell frame (the spec
above has 32 such faces, all valid where staged). `transformSkinTris()`
(the engine of BOTH `Engine.clusterGhostRotate` and the commit's `shiftSkinTris`)
re-encoded through that law and DROPPED any face whose image no longer fit; a
quarter-turn keeps the SPAN but re-places `min`, so fat faces fell out and the
hole was persisted into the built file. Fix: the ruling that shipped
`splitFace` — "segment whatever is breaking" — encode-else-split with a RECORD
PAINTER (`reencodeSkinTri`) so pieces re-wear the source's colours[5]/material/
smooth verbatim; already-valid faces stay byte-identical. `balloonfin.mirror()`'s
`encodeSkinTri(...)!` (the x-mirror moves `min` too, so it could push
`undefined`) became encode-else-split `flatMap`.

**Root cause 2 — the TAIL COMMIT sliced by staged counts** (found while pinning):
after fix 1 the ghost kept everything (942 staged → 960 after ⟲Y) but ✔ Build
wrote 942 — and not the right 942. `commitBalloon` transformed the whole ghost
list once, then sliced it by the STAGED group sizes; splitting ADDS records, so
every boundary after the first split drifted: fin pieces into the main skin,
panels into the wrong Build, the tail off the end. Fix: each GROUP travels
through the recovered `ghostMap(plan.probes, payload.rides[0], offset)` on its
own (`paintGroup`), so a split stays GROUP-LOCAL; the `take()` cursor and the
`balloon.skinCount` count contract are deleted so they cannot come back.

**Pins (all verified discriminating — reverting each fix fails them):**
`splitface.test.ts` "transformSkinTris NEVER DROPS" (non-vacuous fat-face
premise, every shift/quarter-turn keeps `length >= base`, every piece passes
`encodeSkinTri`, the summed signed AREA vector within 1 % + 64 cells² — a split
moves it ~6, a dropped fat face hundreds — thin crafts vertex-exact, pieces
re-wear the record's paint, shift round-trips), `balloonfin.test.ts` (the big
tail batch is COMPLETE: no undefined, every record inside its own window),
e2e `sphereskin.spec.ts` "rotate + drag a big balloon" (⟲Y + a 5-cell drag ⇒
the FILE's area, top-level PLUS nested Build triangles, equals the ghost's).

**Standing rule:** any helper that maps stored skin records through a POSITION
change treats the frame-aligned window as something to CUT, never to filter —
and never slices a transformed list by pre-transform counts.
