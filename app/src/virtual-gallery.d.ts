// statically compiled catalog (see app/tools/vite-corpus.ts § virtual:gallery)
declare module 'virtual:gallery' {
  export interface GalleryEntry {
    id: string;
    name: string;
    author?: string;
    /** URL served from the corpus folder, null when the craft has no preview */
    preview: string | null;
  }
  export const GALLERY: GalleryEntry[];
}
