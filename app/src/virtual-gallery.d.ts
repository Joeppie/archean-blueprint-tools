// statically compiled catalog (see app/tools/vite-corpus.ts § virtual:gallery)
declare module 'virtual:gallery' {
  export interface GalleryEntry {
    id: string;
    name: string;
    author?: string;
    /** URL served from the corpus folder, null when the craft has no preview */
    preview: string | null;
    /** version tag of the served blueprint.json: '<bytes>-<mtimeMs>'. The
     *  IndexedDB craft cache stamps the rev it downloaded at, so a later
     *  catalog rev ≠ stored rev proves "edited since cached" (crafts.ts). */
    rev: string;
    /** hex SHA-256 of the blueprint.json bytes as served — the /corpus route
     *  repeats it as X-Blueprint-Sha; a download verifies the fetched bytes
     *  against it ('' only for an unreadable file). */
    sha: string;
    /** blueprint.json size in bytes */
    bytes: number;
    /** blueprint.json mtime (ms since epoch) — the "file changed" date the
     *  staleness chip / open-gate dialog print */
    mtime: number;
  }
  export const GALLERY: GalleryEntry[];
}
