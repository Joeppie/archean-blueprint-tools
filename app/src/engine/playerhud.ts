// playerhud.ts — PLAYER HUDs as an editable program source (v1.17.0, we:
// "Player huds should also be able to be loaded in and edited; make it
// possible to load a player HUD file … Ensure that the Library function
// from computer also works there").
//
// The game keeps a player HUD as a FOLDER of raw XenonCode
// (Archean-data/client/hud/<name>/main.xc + its includes — the 'Homo Hud'
// and the subscribed speed item are exactly this shape). A loaded player
// HUD is a XenonHud with the SYNTHETIC ci below: the HUD IDE (HudDialog),
// the hudPump runtime (panel() surfaces, beacon() radios, the AVATARSIM
// get() pool that answers avatar_sensor_speed — the speed-HUD read) and the
// Library side tab (projectFunctions over the LOADED files + the built-in
// index) all ride that shape UNCHANGED; only the save path differs (the
// /hud route writes the .xc files back; never the xc_program.bin — the
// game recompiles it).
import type { XCFile } from './xenoncode';

export const PLAYER_HUD_CI = -7;

export interface PlayerHudEntry { name: string; kind: 'hud' | 'workshop' | 'fixture'; files: string[] }
export interface PlayerHudProgram { name: string; kind: string; files: XCFile[] }

/** the dev/preview listing (page-relative route — AGENTS § Publishing:
 *  data routes never hardcode the repo URL path). 404 (Pages, fresh
 *  server) = [] — the file-picker path works in EVERY build. */
export async function fetchPlayerHuds(): Promise<PlayerHudEntry[]> {
  try {
    const r = await fetch('hud/');
    if (!r.ok) return [];
    const j = await r.json() as { huds?: PlayerHudEntry[] };
    return j.huds ?? [];
  } catch { return []; }
}

export async function fetchPlayerHud(name: string): Promise<PlayerHudProgram> {
  const r = await fetch(`hud/${encodeURIComponent(name)}`);
  if (!r.ok) throw new Error(`player HUD '${name}' not found`);
  return await r.json() as PlayerHudProgram;
}

/** Save law: .xc files back to the route (installed HUDs land IN PLACE —
 *  the game recompiles its .bin on the next load; subscribed workshop
 *  items are never touched, the save lands as a hud_dir/<name> copy). */
export async function savePlayerHud(name: string, files: XCFile[]): Promise<string> {
  const r = await fetch(`hud/${encodeURIComponent(name)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ files }),
  });
  const j = await r.json().catch(() => ({})) as { ok?: boolean; dir?: string; stack?: string };
  if (!r.ok || !j.ok) throw new Error(j.stack ?? `save failed (${r.status})`);
  return j.dir ?? '';
}

/** THE FILE-PICKER PATH (works in every build, incl. Pages): the browser
 *  hands .xc files (a folder pick carries webkitRelativePath); entry =
 *  main.xc FIRST, the folder name becomes the HUD name. Non-.xc siblings
 *  (xc_program.bin, storage/) are the game's — dropped. */
/** THE DISPLAY-NAME LAW (v1.16.13, we: "the Homo Hud shouldnt be shown,
 *  rename it to human rather than Homo.. that name might be a bit offensive
 *  to some"): the game's hud/<name> folder keys stay EXACT for fetch/save
 *  (byte-safe round trips, the game's own directories are never touched) —
 *  only our UI labels soften. 'homo' (Latin for human) reads as Human HUD. */
export function playerHudDisplayName(name: string): string {
  return /^homo(\s*hud)?$/i.test(name.trim()) ? 'Human HUD' : name;
}

export function playerHudFromFiles(
  list: { name: string; rel?: string; text: string }[],
): PlayerHudProgram {
  const xc = list.filter(f => /\.xc$/i.test(f.name));
  if (!xc.some(f => f.name === 'main.xc'))
    throw new Error('a player HUD folder needs a main.xc');
  const folderOf = (f: { name: string; rel?: string }) => {
    const parts = (f.rel ?? f.name).split('/');
    return parts.length > 1 ? parts[parts.length - 2]! : 'player-hud';
  };
  const name = folderOf(xc[0]!);
  const files = [xc.find(f => f.name === 'main.xc')!,
    ...xc.filter(f => f.name !== 'main.xc')
      .sort((a, b) => a.name.localeCompare(b.name))]
    .map(f => ({ name: f.name, code: f.text }));
  return { name, kind: 'disk', files };
}
