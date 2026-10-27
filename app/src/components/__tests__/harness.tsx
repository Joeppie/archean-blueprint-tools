// THE VIEWPORT-MOCK HARNESS (docs/TEST-PYRAMID.md Phase 3 enabler, v1.12.5):
// mount the REAL Editor — its full state machine (ws modes, the mirror
// widget, the build dock, the panel editors, the doc mirror, the undo stack,
// the pick routing) — in jsdom, with the WebGL surface replaced by a
// props-recording stub. Two mocks make this cheap:
//
//  • ../Viewport — the module Editor imports for its canvas: the stub
//    records EVERY prop the Editor passes (viewportProps) and hands the
//    Editor a FAKE ENGINE through the real onEngine callback. Tests drive
//    the pick routing through the recorded props (onBlockPick) + the fake's
//    settable pickCell answer — the exact seams the browser tests drive
//    with real mouse events over real pixels.
//  • ../../crafts — the IndexedDB/network loader: served from testdata/ on
//    disk through the SAME openFunnel the browser boot runs (openText).
//
// The fake engine is a Proxy: every method the Editor/panels call is
// RECORDED (fake.calls) and answers undefined unless the table below
// defines a real answer (the few the Editor reads back: blueprint,
// backdropState, projection, mirrorAxis, craftMirrorAxes, getOptions,
// pickCell, pipeInfo, twinPairsOf, clusterGhostState, gizmoModeNow).
// Pixels, real pointer plumbing, IndexedDB and CSS-layout laws stay in
// Playwright; rows/clicks/state/repaints live here.
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { useEffect } from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import Editor from '../../Editor';
import { DEFAULT_OPTS, type ViewOptions } from '../../engine/scene';
import type { Blueprint } from '../../engine/format';

export const REPO = resolve(__dirname, '..', '..', '..', '..');
export const testdataText = (id: string): string =>
  readFileSync(resolve(REPO, 'testdata', id, 'blueprint.json'), 'utf8');

/** the props the LAST-rendered stub Viewport received (the test's handle on
 *  the Editor's callbacks: onBlockPick, onPick, onPlace, …) */
export const viewportProps: { current: Record<string, any> } = { current: {} };

export interface FakeEngine {
  calls: Record<string, unknown[][]>;
  /** what pickCell answers next (set per test: null = sky, {kind, bi/ci…}) */
  pick: Record<string, unknown> | null;
  axes: string[];                     // craftMirrorAxes answer (auto-mirror)
  mirrorAxis: string;                 // live session axis (set by setMirrorAxis)
  blueprint: Blueprint | null;
  [k: string]: unknown;               // everything else: recorded no-ops
}

export function makeFakeEngine(axes: string[]): FakeEngine {
  const self: Record<string, unknown> = {
    calls: {} as Record<string, unknown[][]>,
    pick: null,
    axes,
    _ax: 'x',
    get blueprint(): Blueprint | null {
      return (viewportProps.current.bp as Blueprint) ?? null;
    },
    backdropState: () => ({ current: 'none' }),
    projection: () => 'persp',
    get mirrorAxis(): string {
      return (self._ax as string) ?? 'x';
    },
    setMirrorAxis(a: string) {
      self._ax = a;
      localStorage.setItem('archean-app-mirror-axis', a);
    },
    craftMirrorAxes: () => self.axes as string[],
    getOptions: (): ViewOptions => ({ ...DEFAULT_OPTS }),
    // the REAL engine pushes selection changes back through onSelection
    // (the Editor's `sel` state rides it — the Inspector, the gizmo gate,
    // the twin glow all key off it), so the fake mirrors the call.
    select: (ci: number) => {
      ((self.calls as Record<string, unknown[][]>).select ??= []).push([ci]);
      (self.onSelection as ((s: { ci: number; sub: number }) => void) | undefined)
        ?.({ ci, sub: -1 });
    },
    selectSub: (bi: number) => {
      ((self.calls as Record<string, unknown[][]>).selectSub ??= []).push([bi]);
      (self.onSelection as ((s: { ci: number; sub: number }) => void) | undefined)
        ?.({ ci: -1, sub: bi });
    },
    pickCell: () => self.pick,
    pickAt: () => self.pick,
    pipeInfo: () => ({ pipes: 0, reroute: 0, draped: 0, style: {} }),
    twinPairsOf: () => [] as unknown[],
    twinPairsFor: () => new Set<number>(),
    clusterGhostState: () => null,
    clusterGhostData: () => null,
    gizmoModeNow: () => 'rotate',
    gizmoState: () => ({ mode: 'rotate', shown: false, attached: false }),
    blockGizmo: () => null,
    triGizmo: () => null,
    pins: () => null,
    pinState: () => null,
    stats: () => ({}),
    massReport: () => null,
    pendingReal: 0,
    subStats: () => ({ groups: 0, parts: 0 }),
    compViewPos: () => null,
    viewState: () => ({ eye: [0, 0, 5], target: [0, 0, 0] }),
  };
  return new Proxy(self, {
    get(t, p: string | symbol) {
      if (typeof p === 'symbol' || p in t) return (t as Record<string | symbol, unknown>)[p];
      return (...args: unknown[]) => {
        ((t.calls as Record<string, unknown[][]>)[p] ??= []).push(args);
        return undefined;
      };
    },
    set(t, p: string, v) {
      (t as Record<string, unknown>)[p] = v;
      return true;
    },
  }) as unknown as FakeEngine;
}

export const engines: FakeEngine[] = [];

// vi.mock factories are hoisted above module scope — the per-test knobs
// live in a vi.hoisted config the factory may close over.
const cfg = vi.hoisted(() => ({ axes: [] as string[] }));
/** set the fake engine's craftMirrorAxes answer BEFORE mounting (the
 *  gantry auto-lights the x plane: ['x']; solo crafts: []) */
export const setAxes = (a: string[]): void => { cfg.axes = a; };

vi.mock('../Viewport', () => ({
  default: (props: Record<string, any>) => {
    viewportProps.current = props;
    useEffect(() => {
      const fake = makeFakeEngine(cfg.axes);
      engines.push(fake);
      props.onEngine?.(fake);
      return () => props.onEngine?.(null);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  },
}));

vi.mock('../../crafts', () => ({
  craftState: async () => 'fresh',
  craftInfo: async () => null,
  loadCraft: async (id: string) => ({
    text: testdataText(id), fromCache: true, bytes: 0,
  }),
}));

export interface H {
  engine: FakeEngine;
  props: () => Record<string, any>;
  /** drive the shipped pick routing exactly as a canvas click does */
  clickAt: (hit: Record<string, unknown> | null, shift?: boolean) => void;
}

/** mount the Editor over a testdata craft (fresh localStorage per file is
 *  the caller's contract: seed archean-app-* keys BEFORE calling) */
export async function mountEditor(id: string | null): Promise<H> {
  localStorage.setItem('archean-app-backdrop', 'none');
  render(<Editor craft={id} onBack={() => { /* gallery: no-op in jsdom */ }} />);
  await screen.findByTestId('editor-title', {}, { timeout: 10_000 });
  const engine = () => engines[engines.length - 1]!;
  return {
    get engine() {
      return engine();
    },
    props: () => viewportProps.current,
    clickAt: (hit, shift = false) => {
      engine().pick = hit;
      const p = viewportProps.current;
      p.onBlockPick(300, 300, shift, () => { /* modebox: Viewport-internal */ });
    },
  };
}

/** mount the starter deck (the `gallery-new` doc: craft === null) */
export const mountStarter = (): Promise<H> => mountEditor(null);

// jsdom gaps the shipped components touch (v1.12.4 lesson family)
if (typeof Element.prototype.scrollIntoView !== 'function')
  Element.prototype.scrollIntoView = () => { /* layout is out of tier */ };

afterEach(cleanup);

/** settle the debounced engine reload the Editor runs after edits */
export const tick = (ms = 260): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export { waitFor };
