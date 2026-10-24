// gallery-catalog.ts — the statically compiled corpus catalog (virtual:gallery,
// see app/tools/vite-corpus.ts). Its own module so the lazy Editor chunk and
// the gallery page can both import it without App ↔ Editor circularity.
import { GALLERY } from 'virtual:gallery';

export { GALLERY };
export type GalleryEntry = (typeof GALLERY)[number];

export const craftName = (id: string) =>
  GALLERY.find(g => g.id === id)?.name ?? `Workshop ${id}`;

/** The catalog's version stamp of a craft (see crafts.ts CraftMeta). This is
 *  the seam through which catalog data reaches the cache layer WITHOUT
 *  crafts.ts importing the virtual module (crafts.ts stays framework-free). */
export interface CraftMeta { rev?: string; sha?: string; bytes?: number; mtime?: number }

export const craftMeta = (id: string): CraftMeta | undefined => {
  const g = GALLERY.find(e => e.id === id);
  return g ? { rev: g.rev, sha: g.sha, bytes: g.bytes, mtime: g.mtime } : undefined;
};
