// gallery-catalog.ts — the statically compiled corpus catalog (virtual:gallery,
// see app/tools/vite-corpus.ts). Its own module so the lazy Editor chunk and
// the gallery page can both import it without App ↔ Editor circularity.
import { GALLERY } from 'virtual:gallery';

export { GALLERY };
export type GalleryEntry = (typeof GALLERY)[number];

export const craftName = (id: string) =>
  GALLERY.find(g => g.id === id)?.name ?? `Workshop ${id}`;
