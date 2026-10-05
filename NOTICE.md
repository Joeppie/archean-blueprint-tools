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
