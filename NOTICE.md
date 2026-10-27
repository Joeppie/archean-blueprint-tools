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

   **Sky backdrop panoramas** — the shipped set
   (`app/src/assets/backdrops/`, enumerated by its `manifest.json`):
   `desert.jpg` is "Goegap" by **Greg Zaal / Poly Haven
   (https://polyhaven.com/a/goegap), CC0 1.0**; `sky.jpg` is "Kloofendal
   48d Partly Cloudy (Pure Sky)" by **Greg Zaal & Jarod Guest / Poly Haven
   (https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky), CC0
   1.0**; `hangar.jpg` is "Hangar Interior" (an interior panorama — roof
   overhead, floor below) by **Dimitrios Savva & Jarod Guest / Poly Haven
   (https://polyhaven.com/a/hangar_interior), CC0 1.0**. Each is the
   site's tone-mapped preview, reduced to a low-quality 2 k variant
   (8192×4096 → 2048×1024, JPEG q70). The earlier two (a NASA Jezero
   panorama and Poly Haven's "Waterbuck trail") were retired 2026-10-24
   (we: "they werent vey suitable"). The manifest carries name, source
   URL, author and licence per file; see that folder's README.md and the
   in-app manual's Display topic, which credit the authors too..

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

6. XenonCode interpreter (tools/xenoncode/)
   -----------------------------------------
   `tools/xenoncode/` runs programs on the **dev's own XenonCode code** — the
   parser/compiler/VM (`XenonCode.hpp`) and screen model (`XenonScreen.hpp`)
   from https://github.com/batcholi/XenonCode (by batcholi / FloDKSM), pinned
   to a recorded commit (see `tools/xenoncode/XENONCODE_UPSTREAM.md`).
   `xenoncode.js`/`xenoncode.wasm` (in `tools/xenoncode/` and, serving the
   Inspector app since v1.12.11, `app/public/xenoncode/`) are compiled build
   products of that pinned source, unmodified; only the device shim
   (`xc_host.*`, GPL v3), the app integration (`app/src/engine/xenoncode.ts`,
   `app/src/components/XenonDialog.tsx`, GPL v3) and the demo program
   (`demo/hello/main.xc`, GPL v3, authored for this repo) are ours.
   The upstream repository carries no LICENSE file; this use follows the good-
   faith + attribution posture of section 4 above (the library is published
   openly by the game's developer, who also runs it as WASM at
   xenoncode.com), with the repository owner's ruling of 2026-10-27 that such
   use is intended. Rights-holder objections are handled as in section 4.
