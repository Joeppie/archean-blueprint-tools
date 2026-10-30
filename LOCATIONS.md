# Finding an Archean install and its blueprints (any machine)

The tools in this repo need three machine-local paths:

| key (`blueprints.conf` / env var)          | what it is                                             |
|---|---|
| `game_dir` / `ARCHEAN_GAME`                | the **game install** (`Archean-game/modules/…` = asset ground truth for `tools/extract_models.py`) |
| `hud_dir` / `ARCHEAN_HUD`                  | the client's **PLAYER HUD folder** (`Archean-data/client/hud`) — one subfolder per installed player HUD (main.xc + includes); the app's `/hud` route + `Xenon ▸ Player HUDs` read/write it (v1.17.0). Default: the `hud` folder beside the blueprints dir — no gate, a machine without one simply lists no HUDs (the repo `testdata/hud` fixture floor stays) |
| `blueprints` / `ARCHEAN_BLUEPRINTS`        | a **blueprint corpus** — a folder of `<workshop-id>/blueprint.json` dirs (regtest/tools read it; the repo default is `testdata/`) |
| `workshop_content` / `ARCHEAN_WORKSHOP`    | the **Steam Workshop download dir** for Archean (input of `tools/add_workshop.py`) |

Never hardcode one of these in a tool or test — resolve through `tools/config.py`
(env > `blueprints.conf` > default; `python3 tools/config.py` prints what each
key currently resolves to). This file documents how to *discover* the paths
reliably on a fresh machine. `python3 tools/find_install.py` runs the whole
procedure for you (`--conf` prints ready-to-paste `blueprints.conf` lines).

## The stable facts

- **Steam app id: `2941660`** (the only Archean id you need; also the workshop
  content subfolder name and `tools/config.py`'s `APPID`).
- Archean keeps its mutable client data in an **`Archean-data/` folder next to
  the `Archean-game/` install folder** (verified on the Linux build; the official
  wiki calls it the “(Client Settings) / blueprints” folder —
  <https://wiki.archean.space/en/tools/BlueprintTool.html>). So one install
  lookup yields both the assets and the local blueprint saves.

## The reliable discovery procedure

1. **Enumerate Steam library roots** — Steam itself tracks them in
   `config/libraryfolders.vdf` under its root; each `"path"` entry is a
   library. Plausible Steam roots:
   - Linux: `~/.steam/steam` (symlink), `~/.steam/root`,
     `~/.local/share/Steam`; Flatpak Steam:
     `~/.var/app/com.valvesoftware.Steam/.local/share/Steam`.
   - Windows: `%ProgramFiles(x86)%\Steam` (registry
     `HKLM\SOFTWARE\WOW6432Node\Valve\Steam` → `InstallPath` is authoritative),
     and per-library `libraryfolders.vdf` inside each.
   ```bash
   grep -oP '"path"\s+"\K[^"]+' "<steam-root>/config/libraryfolders.vdf"
   ```
2. **Find the install per library** — an installed app always has an
   appmanifest; its `installdir` names the folder under `common/`:
   ```bash
   cat "<library>/steamapps/appmanifest_2941660.acf"   # "installdir" "Archean"
   # install = <library>/steamapps/common/<installdir>
   ```
3. **Verify the install** — the asset tree marker is
   `Archean-game/modules/` (component `.gltf`/`.ini` under
   `modules/<module>/components/<Type>/`).
4. **Local blueprint saves** live in
   `Archean-data/client/blueprints/` inside the install folder:
   - loose `<name>.json` / `<timestamp>.json` files = local saves
     (named saves carry the in-game blueprint name; unnamed saves are
     timestamped at save time);
   - `<workshop-id>/blueprint.json` (+ `preview.png`) = saves bound to a
     Workshop item — first Publish (or an Update that preserves the id, per the
     wiki) writes the folder; an `old/` archive dir may also appear;
   - `*_copy` dirs = in-game duplicate operations.
   This whole tree is also a *corpus* per our format (`<id>/blueprint.json`).
5. **Workshop subscriptions** live per library at
   `<library>/steamapps/workshop/content/2941660/<published-file-id>/`
   — each holds exactly `blueprint.json` + `preview.png`. (Subscribing
   downloads there; the file id is the `workshop_item_id` stored *inside* the
   blueprint, so ingested names match.)
6. **Fallback probe** if manifests are missing/mislead (multi-library, moved
   folders):
   ```bash
   # game assets + local saves anywhere under a library's common/:
   ls "<library>"/steamapps/common/*/Archean-{game/modules,data/client/blueprints} -d
   # workshop downloads across all libraries:
   ls "<library>"/steamapps/workshop/content/2941660/ | head
   ```

## Wiring the results into this repo

Three tiers (highest first), never code (AGENTS.md § Blueprint folder):

```bash
# 1) env, per-shell:
export ARCHEAN_GAME=/path/to/<library>/steamapps/common/Archean/Archean-game
export ARCHEAN_BLUEPRINTS=/path/to/blueprint-corpus     # e.g. the local saves dir
export ARCHEAN_WORKSHOP=/path/to/<library>/steamapps/workshop/content/2941660

# 2) repo-root blueprints.conf (gitignored — machine-local, keep it that way):
python3 tools/find_install.py --conf >> blueprints.conf

# 3) defaults: corpus = repo testdata/; Steam-layout guesses otherwise
python3 tools/config.py        # print the resolved paths + which tier won
```

The browser suites mirror this: `regtest/regtest.html?corpus=<url>` overrides
the corpus root; `tests/run_tests.sh` resolves it through the same config.

## Upstream / reference viewer documentation

- **XenonTools hub** (by FloDKSM, the game developer): <https://xenontools.dev/>
  — links **XenonViewer** (<https://viewer.xenontools.dev/>, the dev's own
  reference blueprint viewer used as this repo's porting reference — see
  NOTICE §2 for the port terms) and XenonDraw (<https://draw.xenontools.dev/>).
- XenonViewer's readable reference sources:
  <https://viewer.xenontools.dev/js/scene.js>, `blueprint.js`, `palette.js`,
  `blockshapes.js` — the format's *de facto* spec; findings there must be
  transcribed into FORMAT.md + code comments (offline rule, FORMAT.md § Local
  sources of truth).
- Official Archean wiki — Blueprint Tool (in-game save/publish/workshop flow,
  client settings folder): <https://wiki.archean.space/en/tools/BlueprintTool.html>
- Community ecosystem: `archean-cookbook` on GitHub (e.g. `archbelt`, another
  blueprint CLI) — independent projects, not affiliated with this repo.
