NOTICE — licensing, attribution, and relicensing terms
======================================================

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

3. Content of uncertain or unidentified origin
   -------------------------------------------
   Any file in this repository whose provenance is not clearly documented
   (code snippets, data samples, icons, textures) MUST be investigated before
   it is relied upon, redistributed, or extended: identify the upstream author,
   their license, and compatibility with these terms. Do not "inherit" the GPL
   grant by default for material you do not own. Mark unresolved items in this
   NOTICE until cleared.

4. Relicensing clause
   -------------------
   Code in this repository may be relicensed (in whole or in part), without any
   fee, when a good argument is given and agreed to by the respective rights
   holders (each contributor's improvements stay theirs, per GPL). This clause
   exists because standard licenses ignore the practical case of mutually
   agreed relicensing, and that omission is undesirable and contrary to the
   spirit in which this work was made. Record any such agreement alongside this
   file (date, parties, scope, new terms).

5. Data test corpus
   -----------------
   testdata/<workshop-id>/blueprint.json are player-created workshop craft
   copies used as a regression corpus (no preview images are included, by the
   repository author's decision). Workshop ids are listed in
   testdata/MANIFEST.md.
