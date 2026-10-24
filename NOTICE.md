NOTICE — licensing, attribution, and reuse terms
================================================

This repository bundles code and third-party content with DIFFERENT owners.
Read this file together with LICENSE (GNU GPL v3).

1. Code (viewer/, tools/, tests/, regtest/)
   -----------------------------------------
   Licensed under the GNU GPL v3 (see LICENSE). The GPL's copyleft and moral
   rationale is deliberately chosen: improvements to this code belong to their
   respective authors and stay under the same terms; the code may not be taken,
   closed, and resold.

2. Game content (testdata/*.json, viewer/models/, FORMAT.md)
   ---------------------------------------------------------
   The blueprint JSON files, the file-format knowledge encoded in FORMAT.md,
   the extracted component models under `viewer/models/` (geometry, masses,
   collider/joint/adapter metadata — generated from the game's own `.gltf`
   and `.ini` files by `tools/extract_models.py`), and everything else
   derived from the game's data belong to the developer of
   Archean — batcholi / FloDKSM
   (https://store.steampowered.com/app/2941660/Archean/).
   **All works included here belong to their respective owners.** Player-made
   workshop blueprints in testdata/ remain the copyright of the workshop
   authors they were copied from (identifiable via the workshop item id used
   as folder name); they are included solely as a short quotation forming a
   format-validation test corpus, for interoperability and education purposes.
   Third-party assets (e.g. Three.js, loaded from CDN) remain under their own
   licenses. If you redistribute this repository, keep these attributions
   intact and review the game's EULA/ToS for what redistribution of
   player-created workshop data permits.

   **Sky backdrop panoramas** — `app/src/assets/backdrops/mars.jpg` is
   "Mastcam-Z's First 360-Degree Panorama" (Perseverance rover, Jezero
   Crater, Sol 3) by **NASA/JPL-Caltech/ASU/MSSS — public domain** (NASA
   image use policy); resampled from the stitched cylinder onto the full
   2:1 dome (the sky/soil edge rows extended to the poles), colour
   unchanged. `earth.jpg` is "Waterbuck trail" by **Greg Zaal / Poly
   Haven (https://polyhaven.com/a/waterbuck_trail), CC0 1.0** — resampled
   16 k → 2 k, colour unchanged. `desert.jpg` is "Goegap" by **Greg Zaal /
   Poly Haven (https://polyhaven.com/a/goegap), CC0 1.0** and `sky.jpg` is
   "Kloofendal 48d Partly Cloudy (Pure Sky)" by **Greg Zaal & Jarod Guest /
   Poly Haven (https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky),
   CC0 1.0** — both the site's tone-mapped preview, reduced to a
   low-quality 2 k variant (8192×4096 → 2048×1024, JPEG q70). All are
   surface panoramas (sky above, terrain below), matching the viewer's dome
   rendering. The set is manifest-enumerated
   (`app/src/assets/backdrops/manifest.json` — name, source URL, author,
   licence per file; see that folder's README.md and the in-app manual's
   Display topic, which credit the authors too).

   **XenonViewer-derived material**: `viewer/blockshapes.js` and
   `viewer/palette.js` (shape/rotation tables and the built-in palette, both
   transcriptions of the game's `BlockShapes.hh`), and the block face-culling,
   colour-management and component-placement algorithms in `viewer/view3d.js`
   are ports/reimplementations of the game developer's own reference viewer
   (XenonViewer, https://viewer.xenontools.dev/, by batcholi/FloDKSM) — same
   rights holder as the game data above; transcribed in good faith for
   interoperability, with attribution, per §4.

3. Content of uncertain or unidentified origin
   -------------------------------------------
   Any file in this repository whose provenance is not clearly documented
   (code snippets, data samples, icons, textures) MUST be investigated before
   it is relied upon, redistributed, or extended: identify the upstream author,
   their license, and compatibility with these terms. Do not "inherit" the GPL
   grant by default for material you do not own. Mark unresolved items in this
   NOTICE until cleared.

4. Reuse assumption & rights-holder contact
   -----------------------------------------
   **No explicit permission has been obtained from any rights holder** for the
   bundled game or player content, and this repository does not claim any. It
   is published in good faith, for interoperability, education and research,
   presuming that reuse of the included third-party IP is acceptable in the
   spirit of Creative Commons attribution (CC-BY-like). That is a presumption
   offered transparently — not a licence grant — and nothing here presumes to
   license anyone else's IP.
   Rights holders who consider any included material out of bounds: open an
   issue on this repository and it will be addressed amicably and promptly —
   takedown, trimming, or relicensing by mutual agreement, without fees or
   legalism. Any agreed outcome is recorded alongside this file.

5. Data test corpus
   -----------------
   testdata/<workshop-id>/blueprint.json are player-created workshop craft
   copies used as a regression corpus (no preview images are included, by the
   repository author's decision). Workshop ids are listed in
   testdata/MANIFEST.md.
