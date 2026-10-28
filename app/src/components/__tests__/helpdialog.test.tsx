// @vitest-environment jsdom
// Phase 3 (docs/TEST-PYRAMID.md): the jsdom component tier, first member.
// The HelpDialog DOM laws (rail, article, HTML tables, word search, the
// honest empty state, Esc/✕/backdrop close) move out of the browser —
// help.spec keeps the TopBar wiring smoke + the viewport-fit pixel law.
// The Esc-subscribe-once law (v1.5.20: the dialog survives the Editor's
// synchronous mid-dispatch re-render) is exercised with REAL dispatched
// KeyboardEvents, not prop calls.
import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import HelpDialog from '../HelpDialog';
import { TOPICS } from '../../help/manual';

// jsdom has no scroll API (HelpDialog scrolls the article on topic select)
beforeAll(() => {
  Element.prototype.scrollTo = () => {};
});

afterEach(cleanup);

const renderHelp = () => {
  let closed = 0;
  render(<HelpDialog onClose={() => { closed++; }} />);
  return { closed: () => closed };
};

describe('HelpDialog — rail + article (the browser legs retired)', () => {
  test('opens on the FIRST topic; the rail lists every topic', () => {
    renderHelp();
    const first = TOPICS[0]!;
    expect(screen.getByTestId('help-article').textContent).toContain(first.title);
    for (const t of TOPICS)
      expect(screen.getByTestId(`help-topic-${t.id}`)).toBeTruthy();
  });
  test('selecting a topic swaps the article', () => {
    renderHelp();
    const t = TOPICS.find(x => x.id === 'balloon') ?? TOPICS[1]!;
    fireEvent.click(screen.getByTestId(`help-topic-${t.id}`));
    expect(screen.getByTestId('help-article').textContent).toContain(t.title);
  });
  test('PIPE TABLES render as real <table> elements (markdown law, in situ)', () => {
    renderHelp();
    const t = TOPICS.find(x => x.id === 'balloon') ?? TOPICS[1]!;
    fireEvent.click(screen.getByTestId(`help-topic-${t.id}`));
    // the balloon topic carries the LIMITS table (help.spec's old assertion)
    expect(screen.getByTestId('help-article').querySelector('table')).toBeTruthy();
  });
});

describe('HelpDialog — word search (ranked, AND, honest empty)', () => {
  test('a title/tag/body word filters the rail to its topic', () => {
    renderHelp();
    fireEvent.change(screen.getByTestId('help-search'), { target: { value: 'zeppelin' } });
    const rail = screen.getByTestId('help-rail');
    expect(rail.querySelector('[data-testid="help-topic-balloon"]')).toBeTruthy();
  });
  test('the full browser-tier sweep (words, ranking, count, restore)', () => {
    renderHelp();
    const search = screen.getByTestId('help-search') as HTMLInputElement;
    // title hit ranks first and the article follows the best match
    fireEvent.change(search, { target: { value: 'balloon' } });
    expect(screen.getByTestId('help-rail').querySelector('button')!.getAttribute('data-testid'))
      .toBe('help-topic-balloon');
    expect(screen.getByTestId('help-article').textContent).toContain('Quickhull');
    // a TAG word (not in the prose) finds the same topic
    fireEvent.change(search, { target: { value: 'zeppelin' } });
    expect(screen.getByTestId('help-topic-balloon')).toBeTruthy();
    // a BODY word from another topic: mirror severity prose
    fireEvent.change(search, { target: { value: 'faux' } });
    expect(screen.getByTestId('help-topic-mirror')).toBeTruthy();
    // the cost topic is findable by its example part (tag word)
    fireEvent.change(search, { target: { value: 'fluidport' } });
    expect(screen.getByTestId('help-topic-cost')).toBeTruthy();
    // gibberish: an honest note, the rail empties, count says 0
    fireEvent.change(search, { target: { value: 'zzqxwordnever' } });
    expect(screen.getByTestId('help-noresults')).toBeTruthy();
    expect(screen.getByTestId('help-matchcount').textContent).toBe(`0/${TOPICS.length}`);  // dynamic — new topics never break this
    // clearing the search restores the full rail
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByTestId('help-topic-start')).toBeTruthy();
  });
  test('an unmatchable query shows help-noresults, never a blank article', () => {
    renderHelp();
    fireEvent.change(screen.getByTestId('help-search'), { target: { value: 'zzqqx' } });
    expect(screen.getByTestId('help-noresults')).toBeTruthy();
    expect(screen.getByTestId('help-article').textContent).toBeTruthy();  // article stays
  });
});

describe('HelpDialog — the close trio (real dispatched events)', () => {
  test('Esc closes (window keydown, the v1.5.20 subscribe-once law)', () => {
    const h = renderHelp();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(h.closed()).toBe(1);
  });
  test('✕ closes', () => {
    const h = renderHelp();
    fireEvent.click(screen.getByTestId('help-close'));
    expect(h.closed()).toBe(1);
  });
  test('a backdrop click closes; a click INSIDE the dialog does not', () => {
    const h = renderHelp();
    fireEvent.mouseDown(screen.getByTestId('help-dialog'));
    expect(h.closed()).toBe(0);
    // the law is onMouseDown with target===currentTarget (the backdrop grid)
    fireEvent.mouseDown(screen.getByTestId('help-backdrop'));
    expect(h.closed()).toBe(1);
  });
});
