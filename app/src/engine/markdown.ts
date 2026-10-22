// ---------------------------------------------------------------- markdown
// A MINIMAL markdown → HTML renderer for the built-in Help manual (v1.5.20
// user request: "keep it simple, markdown, generate html table"). The whole
// manual is plain .md text shipped in app/src/help/topics/; this module turns
// one topic into HTML at render time. Deliberately tiny and dependency-free:
//
//  • headings  # .. ####   (get slug ids so search/links can anchor)
//  • paragraphs, **bold**, *italic*, `code`, [text](https-url)
//  • bullet lists (- / *) and ordered lists (1.), one nesting level
//  • blockquotes (>) and thematic breaks (---)
//  • FENCED CODE BLOCKS (``` … ```) — HTML-escaped verbatim
//  • PIPE TABLES: | h | h | with a |---|:-:| separator row (alignment
//    honoured) → a real <table class="md-table"> (the "html table" asked for)
//
// Everything is HTML-escaped FIRST (the only raw span ever emitted is our
// own <a> for links), so a topic can never inject markup. No extensions, no
// setext headings, no images — if the manual needs it, extend this file.
// ---------------------------------------------------------------------------

export interface MdHeading {
  id: string;
  level: number;
  text: string;
}

export interface MdDoc {
  html: string;
  /** every heading, in document order (the manual's mini table-of-contents) */
  headings: MdHeading[];
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** heading anchor id: lowercase words joined with '-', non-alnum dropped */
export const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** inline pass: input is ALREADY escaped; order = code, bold, italic, links */
function inline(src: string): string {
  // code spans first; their content must not see ** or * substitutions —
  // park them behind placeholders (nothing in the escape set can collide)
  const codes: string[] = [];
  let s = src.replace(/`([^`]+)`/g, (_m, c: string) => {
    codes.push(`<code>${c}</code>`);
    return `\x00${codes.length - 1}\x00`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/\*([^*\n]+)\*/g, '<i>$1</i>');
  // links: only http(s) targets — the manual is offline, never javascript:
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s.replace(/\x00(\d+)\x00/g, (_m, i: string) => codes[+i] ?? '');
}

const isTableSep = (line: string) =>
  /^\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');

/** one pipe row → trimmed cells */
const cells = (line: string) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

type Align = '' | 'left' | 'right' | 'center';
const alignsOf = (sep: string[]): Align[] => sep.map(c => {
  const l = c.startsWith(':'), r = c.endsWith(':');
  return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
});

export function renderMarkdown(src: string): MdDoc {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  const headings: MdHeading[] = [];
  let i = 0;

  const listBlock = (ordered: boolean, indent: number): string => {
    const tag = ordered ? 'ol' : 'ul';
    const items: string[] = [];
    const itemRe = ordered ? /^(\s*)(\d+)[.)]\s+(.*)$/ : /^(\s*)[-*]\s+(.*)$/;
    while (i < lines.length) {
      const line = lines[i]!;
      const m = ordered ? itemRe.exec(line) : itemRe.exec(line);
      if (!m) break;
      const lead = (m[1] as string).length;
      if (lead < indent) break;
      if (lead > indent) {                       // nested run → sub-list INSIDE the last item
        const before = i;
        const nested = listBlock(/^\d/.test(line.trim()), indent + 2);
        // GUARD: an odd single-space indent consumes nothing at indent+2 —
        // recursing on the SAME line forever was an OOM crash (the worker
        // aborting mid markdown.test.ts). Treat it as a plain item instead.
        if (i === before) {
          items.push(ordered ? `<li>${inline((m[3] as string))}</li>`
            : `<li>${inline(m[2] as string)}</li>`);
          i++;
          continue;
        }
        if (items.length)
          items[items.length - 1] = (items[items.length - 1] as string).replace(/<\/li>$/, nested + '</li>');
        continue;
      }
      // a differently-ordered marker at the same level ends this block
      if (ordered !== /^\d+[.)]/.test(line.trim())) break;
      items.push(ordered ? `<li>${inline(m[3] as string)}</li>`
        : `<li>${inline(m[2] as string)}</li>`);
      i++;
    }
    return `<${tag} class="md-list">${items.join('')}</${tag}>`;
  };

  while (i < lines.length) {
    const raw = lines[i]!;
    const line = raw.trim();

    if (!line) { i++; continue; }

    if (/^```/.test(line)) {                     // fenced code
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!.trim())) { buf.push(lines[i]!); i++; }
      i++;                                       // closing fence (or EOF)
      out.push(`<pre class="md-pre"><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1]!.length;
      const text = h[2]!.trim();
      const id = slug(text);
      headings.push({ id, level, text });
      out.push(`<h${level} id="${id}">${inline(esc(text))}</h${level}>`);
      i++;
      continue;
    }

    if (/^---+$/.test(line)) { out.push('<hr class="md-hr"/>'); i++; continue; }

    if (/^>\s?/.test(line)) {                    // blockquote run
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!.trim())) {
        buf.push(inline(esc(lines[i]!.trim().replace(/^>\s?/, ''))));
        i++;
      }
      out.push(`<blockquote class="md-quote">${buf.join('<br/>')}</blockquote>`);
      continue;
    }

    // pipe table: header row + |---| separator (+ any number of body rows)
    if (line.startsWith('|') && i + 1 < lines.length && isTableSep(lines[i + 1]!.trim())) {
      const head = cells(line);
      const aligns = alignsOf(cells(lines[i + 1]!));
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('|') &&
             !isTableSep(lines[i]!.trim())) body.push(cells(lines[i]!)), i++;
      const th = head.map((c, k) =>
        `<th${aligns[k] ? ` class="al-${aligns[k]}"` : ''}>${inline(esc(c))}</th>`).join('');
      const trs = body.map(r =>
        `<tr>${head.map((_, k) =>
          `<td${aligns[k] ? ` class="al-${aligns[k]}"` : ''}>${inline(esc(r[k] ?? ''))}</td>`
        ).join('')}</tr>`).join('');
      out.push(`<table class="md-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(raw)) { out.push(listBlock(false, raw.length - raw.trimStart().length)); continue; }
    if (/^\s*\d+[.)]\s+/.test(raw)) { out.push(listBlock(true, raw.length - raw.trimStart().length)); continue; }

    // paragraph: consecutive plain lines
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i]!.trim();
      if (!l || /^(#|>|```|---+\s*$|\|)/.test(l) || /^\s*[-*]\s+/.test(lines[i]!) ||
          /^\s*\d+[.)]\s+/.test(lines[i]!)) break;
      para.push(inline(esc(l)));
      i++;
    }
    out.push(`<p class="md-p">${para.join(' ')}</p>`);
  }

  return { html: out.join('\n'), headings };
}

/** plain search text for a topic: strip markdown punctuation, keep words */
export function plainText(src: string): string {
  return src
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*`|_[\]()]/g, ' ')
    .replace(/https?:\S+/g, ' ')
    .replace(/-/g, ' ');
}
