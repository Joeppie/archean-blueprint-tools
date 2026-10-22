// manual.ts — the built-in HELP MANUAL registry (v1.5.20 user request:
// "add documentation in a help menu, with search for words for topics, keep
// it simple, markdown … make it a manual so people can learn to use it
// effectively").
//
// The manual is PLAIN MARKDOWN files in ./topics/. Each file starts with one
// `# Title` heading and may carry `Tags:` line(s) — extra search words the
// prose happens not to use (a user searching "blimp" should land on the
// sphere topic). Everything else is the topic body, rendered by
// engine/markdown.ts. Vite's ?raw glob compiles the text into the bundle, so
// the manual is offline like the rest of the app.
// ---------------------------------------------------------------------------
import { plainText } from '../engine/markdown';

export interface HelpTopic {
  id: string;                 // filename stem — stable, used in testids
  title: string;              // the `# ` heading
  tags: string[];
  body: string;               // markdown WITHOUT the title/tags lines
  words: string;              // lowercase haystack (title + tags + plain body)
}

/** reading order of the manual (new topic files not listed land at the end) */
const ORDER = [
  'start', 'interface', 'keys', 'parts', 'blocks', 'mirror', 'subgrids',
  'display', 'tools', 'hullify', 'sphere', 'lift', 'wire', 'save',
];

function parse(id: string, src: string): HelpTopic {
  const lines = src.split('\n');
  let title = id;
  const tags: string[] = [];
  // header block: the `# ` title + any `Tags:` lines (both drop from body)
  let i = 0;
  for (; i < lines.length; i++) {
    const l = lines[i]!.trim();
    if (!l) continue;
    if (/^#\s+/.test(l)) { title = l.replace(/^#\s+/, ''); continue; }
    if (/^tags:/i.test(l)) {
      tags.push(...l.replace(/^tags:/i, '').split(/[\s,]+/).filter(Boolean));
      continue;
    }
    break;
  }
  const body = lines.slice(i).join('\n');
  const words = `${title} ${tags.join(' ')} ${plainText(body)}`.toLowerCase();
  return { id, title, tags: tags.map(t => t.toLowerCase()), body, words };
}

const files = import.meta.glob('./topics/*.md',
  { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const TOPICS: HelpTopic[] = Object.entries(files)
  .map(([path, src]) => parse(path.replace(/^.*\//, '').replace(/\.md$/, ''), src!))
  .sort((a, b) => {
    const ai = ORDER.indexOf(a.id), bi = ORDER.indexOf(b.id);
    return (ai < 0 ? ORDER.length : ai) - (bi < 0 ? ORDER.length : bi)
      || a.id.localeCompare(b.id);
  });

/** A topic whose text contains EVERY word of the query, scored: title hit
 *  8×, tag hit 4×, body hits 1× each (capped) — so "sphere" ranks the
 *  Sphere skin topic first while "colour" still finds the paint passages. */
export function searchTopics(query: string): { topic: HelpTopic; score: number }[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return TOPICS.map(topic => ({ topic, score: 0 }));
  const hits = (hay: string, w: string) => {
    let n = 0, i = hay.indexOf(w);
    while (i >= 0 && n < 8) { n++; i = hay.indexOf(w, i + w.length); }
    return n;
  };
  const out: { topic: HelpTopic; score: number }[] = [];
  for (const topic of TOPICS) {
    let score = 0;
    let ok = true;
    for (const w of words) {
      const inTitle = topic.title.toLowerCase().includes(w) ? 8 : 0;
      const inTags = topic.tags.some(t => t.includes(w)) ? 4 : 0;
      const n = hits(topic.words, w);
      if (!inTitle && !inTags && !n) { ok = false; break; }
      score += inTitle + inTags + Math.min(n, 4);
    }
    if (ok) out.push({ topic, score });
  }
  return out.sort((a, b) => b.score - a.score || ORDER.indexOf(a.topic.id) - ORDER.indexOf(b.topic.id));
}
