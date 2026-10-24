# Sky backdrops

Equirectangular (2:1) surface panoramas for the **⚙ View ▸ sky backdrop**
rows. The engine enumerates `manifest.json` at build time (`scene.ts` →
`import.meta.glob('…/backdrops/*.jpg')`), so **adding one is a drop-file +
one manifest entry — no code changes**. The View-menu buttons, the tooltips
(author + license) and the e2e enumeration pin all follow the manifest.
The manifest's top-level `"default"` names the backdrop a fresh profile
boots on (an explicit `⊘`/stored pick wins).

## Adding a backdrop

1. Get a **2:1 equirectangular** panorama (sky above the horizon, terrain
   below — e.g. Poly Haven's tone-mapped JPG previews). Keep it small:
   resize to 2048×1024, JPEG q≈70, ≤ ~400 KB (static Pages bundle).
2. Drop it in this folder as `<name>.jpg`.
3. Add one entry to `manifest.json`: `name` (menu label + localStorage
   value), `file`, `source` URL, `author`, `license`, optional `note`.

## Attribution (see NOTICE.md §2 too)

| menu name   | asset | author | license | source |
|-------------|-------|--------|---------|--------|
| `desert`    | Goegap (low-quality tone-mapped 2k variant) | Greg Zaal (Poly Haven) | CC0 1.0 | [polyhaven.com/a/goegap](https://polyhaven.com/a/goegap) |
| `sky`       | Kloofendal 48d Partly Cloudy (Pure Sky) (low-quality tone-mapped 2k variant) | Greg Zaal, Jarod Guest (Poly Haven) | CC0 1.0 | [polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky) |
| `hangar`    | Hangar Interior (interior panorama; roof above, floor below — low-quality tone-mapped 2k variant) | Dimitrios Savva, Jarod Guest (Poly Haven) | CC0 1.0 | [polyhaven.com/a/hangar_interior](https://polyhaven.com/a/hangar_interior) |
