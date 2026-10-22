// markdown.test.ts — the manual's tiny markdown engine + the help registry.
// The manual is USER-FACING documentation (v1.5.20): its renderer must emit
// real HTML tables ("generate html table"), escape everything a topic file
// contains, and the word search must find topics by title, tag AND body word.
import { describe, expect, it } from 'vitest';
import { renderMarkdown, slug, plainText } from '../markdown';
import { TOPICS, searchTopics } from '../../help/manual';

describe('markdown renderer', () => {
  it('headings get slug ids and are listed for a TOC', () => {
    const d = renderMarkdown('# Big Top\n\n## Sub Point\n\ntext');
    expect(d.html).toContain('<h1 id="big-top">Big Top</h1>');
    expect(d.html).toContain('<h2 id="sub-point">Sub Point</h2>');
    expect(d.headings.map(h => h.id)).toEqual(['big-top', 'sub-point']);
    expect(slug('Sphere skin — the algorithm and its limits!'))
      .toBe('sphere-skin-the-algorithm-and-its-limits');
  });

  it('inline: bold, italic, code spans, https links; html escaped', () => {
    const d = renderMarkdown('a **b** *i* `x < y` [site](https://example.com/x) <script>');
    expect(d.html).toContain('<b>b</b>');
    expect(d.html).toContain('<i>i</i>');
    expect(d.html).toContain('<code>x &lt; y</code>');
    expect(d.html).toContain('<a href="https://example.com/x" target="_blank" rel="noopener">site</a>');
    expect(d.html).not.toContain('<script>');
    expect(d.html).toContain('&lt;script&gt;');
  });

  it('code spans are inert: no bold/italic substitution inside them', () => {
    const d = renderMarkdown('`a **b** *c*`');
    expect(d.html).toContain('<code>a **b** *c*</code>');
  });

  it('pipe tables become real <table> elements with alignment', () => {
    const d = renderMarkdown([
      '| Key | Action |',
      '|---|---|',
      '| Ctrl+Z | undo |',
      '| g | grid |',
    ].join('\n'));
    expect(d.html).toContain('<table class="md-table">');
    expect(d.html).toContain('<th>Key</th><th>Action</th>');
    expect(d.html).toContain('<tr><td>Ctrl+Z</td><td>undo</td></tr>');
    expect(d.html).toContain('<tr><td>g</td><td>grid</td></tr>');
    expect(d.html).toContain('</tbody></table>');
  });

  it('table alignment markers map to classes; inline passes run in cells', () => {
    const d = renderMarkdown('| a | b | c |\n|:--|:-:|--:|\n| **x** | y | `z` |');
    expect(d.html).toContain('<th class="al-left">a</th>');
    expect(d.html).toContain('<th class="al-center">b</th>');
    expect(d.html).toContain('<th class="al-right">c</th>');
    expect(d.html).toContain('<td class="al-left"><b>x</b></td>');
    expect(d.html).toContain('<td class="al-center">y</td>');
    expect(d.html).toContain('<td class="al-right"><code>z</code></td>');
  });

  it('a table row count survives ragged rows (missing cells blank out)', () => {
    const d = renderMarkdown('| a | b |\n|---|---|\n| only-a |');
    expect(d.html).toContain('<td>only-a</td><td></td>');
  });

  it('bullet + ordered lists, one nesting level', () => {
    const d = renderMarkdown('- one\n- two\n  - nested\n\n1. first\n2. second');
    expect(d.html).toContain('<ul class="md-list"><li>one</li><li>two<ul class="md-list"><li>nested</li></ul></li></ul>');
    expect(d.html).toContain('<ol class="md-list"><li>first</li><li>second</li></ol>');
  });

  it('fenced code, blockquotes and rules', () => {
    const d = renderMarkdown('```\nplain <raw> **text**\n```\n\n> quoted **not-bold**\n\n---');
    expect(d.html).toContain('<pre class="md-pre"><code>plain &lt;raw&gt; **text**</code></pre>');
    // blockquotes are VERBATIM-free: inline runs (pre blocks are the raw ones)
    expect(d.html).toContain('<blockquote class="md-quote">quoted <b>not-bold</b></blockquote>');
    expect(d.html).toContain('<hr class="md-hr"/>');
  });

  it('consecutive plain lines merge into one paragraph', () => {
    const d = renderMarkdown('line one\nline two\n\nsecond para');
    expect(d.html).toContain('<p class="md-p">line one line two</p>');
    expect(d.html).toContain('<p class="md-p">second para</p>');
  });
});

describe('manual registry + word search', () => {
  it('every topic file parses: title from the # line, Tags: stripped from the body', () => {
    expect(TOPICS.length).toBeGreaterThanOrEqual(10);
    for (const t of TOPICS) {
      expect(t.title.length).toBeGreaterThan(3);
      expect(t.body).not.toMatch(/^#\s/m);           // the title line is gone
      expect(t.body).not.toMatch(/^tags:/im);        // the tags line is gone
      expect(t.id).toBe(slug(t.id));
    }
    const ids = TOPICS.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);      // unique ids
    expect(ids[0]).toBe('start');                    // reading order starts at Quick start
  });

  it('every shipped topic RENDERS to html (tables + quotes included)', () => {
    // the HelpDialog renders bodies through this engine — a hang or a
    // silently empty article would be the manual shipping broken
    for (const t of TOPICS) {
      const d = renderMarkdown(t.body);
      expect(d.html.length, t.id).toBeGreaterThan(100);
      expect(d.headings.length, t.id).toBeGreaterThan(0);
    }
    // the limits/keys tables must become real HTML tables
    expect(renderMarkdown(TOPICS.find(t => t.id === 'sphere')!.body).html)
      .toContain('<table class="md-table">');
    expect(renderMarkdown(TOPICS.find(t => t.id === 'keys')!.body).html)
      .toContain('<table class="md-table">');
  });

  it('search finds the sphere topic by title, by tag word and by body word', () => {
    expect(searchTopics('sphere')[0]!.topic.id).toBe('sphere');
    expect(searchTopics('zeppelin').some(r => r.topic.id === 'sphere')).toBe(true);   // tag
    // prose-only words must match too ("search for words"): 'certificate'
    // appears ONLY in the sphere topic's algorithm prose, never its tags
    expect(searchTopics('certificate').some(r => r.topic.id === 'sphere')).toBe(true);
  });

  it('multi-word queries AND; an unknown word matches nothing', () => {
    expect(searchTopics('mirror twin').every(r =>
      r.topic.words.includes('mirror') && r.topic.words.includes('twin'))).toBe(true);
    expect(searchTopics('zzqxwordnever')).toEqual([]);
  });

  it('ranking: the title hit outscore a body-word hit', () => {
    const r = searchTopics('lift');
    expect(r[0]!.topic.id).toBe('lift');
    expect(r[0]!.score).toBeGreaterThan(r[r.length - 1]!.score);
  });

  it('plainText drops markdown punctuation but keeps words', () => {
    expect(plainText('# **Hi** `there` | x |')).toContain('Hi');
    expect(plainText('a - b')).not.toContain(' - ');
  });
});
