// CockpitWindow.tsx — THE COCKPIT (v1.16.14, we: "'sit' in cockpits
// (simultaneously with others) which opens a small control window that
// allow us to send all inputs (and lock sending inputs using a button;
// wasd up down left right qe, r, t; a checkbox sets repeat, pressing a
// button keeps it pressed in that case; short highlight when either using
// keyboard or when pressing; also 1-0 should be on there as these are the
// 'aux' channels). Compact setup so it's easy to understand").
// v1.16.15 (we: "the layout … is stupid, it should be more organic, wasd
// and arrows presumed to be in relatively normal configuration, as they
// are in keyboard, and 1-9 super small buttons that are on a row above
// wasd. q e besides wasd of course, r t also in right place. Arrows
// besides."): the pads are a KEYBOARD — the 1-0 aux ladder in a small row
// above the QWERT line, ASDF below, the space bar wide, the arrow cluster
// beside it and the I/J/K/L inverted-T at the right. A keycap = one
// PilotKey (it drives EVERY seat channel that key feeds — the PILOT_KEYS
// law); keys the corpus does not bind (T, ←, →) sit inert so the shape
// reads like the keyboard. The channel chips under the keys are the live
// seat values.
//
// One window PER seated PilotSeat ("simultaneously with others"); opened
// by the 🕹 button on a seat's mode widget in the 3-D view.
//  • 🔒 LOCK — the global send-lock: keyboard keys are plain typing again
//    (pilot keys answer false); pads press through it (padPress).
//  • ⟳ REPEAT — a keycap click LATCHES (keeps sending) until clicked
//    again; without it keycaps are momentary (release centers the stick).
//  • flash — a keycap lights when its key pulses, keyboard OR pad
//    (pump.pilotPulse).
import { useEffect, useRef, useState } from 'react';
import FloatingWindow from './FloatingWindow';
import {
  xenonFarm, pilotLocked, setPilotLock, type PilotKey,
} from '../engine/xenoncode';

const CAP: Partial<Record<string, string>> = {
  w: 'W', s: 'S', a: 'A', d: 'D', up: '↑', down: '↓', space: '␣',
  f: 'F', e: 'E', q: 'Q', i: 'I', k: 'K', j: 'J', l: 'L', r: 'R',
  digit1: '1', digit2: '2', digit3: '3', digit4: '4', digit5: '5',
  digit6: '6', digit7: '7', digit8: '8', digit9: '9', digit0: '0',
};
type Cell = PilotKey | 'gap' | 'inert' | 'left' | 'right';
interface Row { fn: string; value: number }

export default function CockpitWindow(p: { ci: number; alias: string; onClose: () => void }) {
  const [tick, setTick] = useState(0);
  const [lock, setLock] = useState(pilotLocked());
  const [repeat, setRepeat] = useState(false);
  const latched = useRef<Set<string>>(new Set());
  const [down, setDown] = useState<Set<string>>(new Set());
  const repeatRef = useRef(repeat); repeatRef.current = repeat;

  useEffect(() => {
    const h = setInterval(() => setTick(t => t + 1), 100);
    const un = xenonFarm.subscribe(() => setTick(t => t + 1));
    return () => { clearInterval(h); un(); };
  }, []);
  useEffect(() => () => {
    for (const k of latched.current) xenonFarm.pressPilot(k as PilotKey, false);
    latched.current.clear();
  }, []);

  // the seat's channel rows across every running pump (`alias · fn`) —
  // recomputed EVERY render (the 10 Hz tick carries the live values; a
  // useMemo keyed only on alias froze the bars at mount-time zeros)
  const rows = (() => {
    const by = new Map<string, Row>();
    const pre = `${p.alias} · `;
    for (const q of xenonFarm.pumps)
      for (const r of q.wsChannels()) {
        if (!r.label.startsWith(pre)) continue;
        const fn = r.label.slice(pre.length);
        const cur = by.get(fn);
        by.set(fn, { fn, value: Math.abs(r.value) >= Math.abs(cur?.value ?? 0)
          ? r.value : (cur?.value ?? 0) });
      }
    return [...by.values()].sort((x, y) => x.fn.localeCompare(y.fn));
  })();
  void tick;
  const bound = xenonFarm.pumps.some(q => q.wsChannels()
    .some(r => r.label.startsWith(`${p.alias} · `)));

  const press = (k: string, on: boolean) => {
    xenonFarm.pressPilot(k as PilotKey, on);
    setDown(prev => {
      const n = new Set(prev);
      if (on) n.add(k); else n.delete(k);
      return n;
    });
  };
  const padDown = (k: string) => {
    if (repeat) {
      if (latched.current.has(k)) { latched.current.delete(k); press(k, false); }
      else { latched.current.add(k); press(k, true); }
      return;
    }
    press(k, true);
  };
  const padUp = (k: string) => {
    if (repeatRef.current && latched.current.has(k)) return;
    press(k, false);
  };
  const live = (k: string) => {
    const now = performance.now();
    for (const q of xenonFarm.pumps) {
      const t = q.pilotPulse.get(k as PilotKey);
      if (t !== undefined && now - t < 260) return true;
    }
    return false;
  };

  const key = (k: PilotKey, small = false) => (
    <button key={k}
      data-testid={`cockpit-pad-${p.alias.toLowerCase().replace(/[^a-z0-9]+/g, '')}-${k}`}
      aria-pressed={down.has(k)}
      title={`send ${CAP[k] ?? k}`}
      onPointerDown={e => { e.preventDefault(); padDown(k); }}
      onPointerUp={() => padUp(k)}
      onPointerLeave={() => down.has(k) && padUp(k)}
      onPointerCancel={() => padUp(k)}

      className={`select-none touch-none rounded border text-center leading-none
        ${small ? 'h-[16px] w-[16px] text-[8px]' : 'h-[26px] w-[26px] text-[10px]'}
        ${k === 'space' ? '!w-[92px]' : ''}
        ${down.has(k) ? 'border-[#8fd4ff] bg-[#2b4a6b] text-white'
          : live(k) ? 'border-[#3ddc55]/70 bg-[#20401f] text-[#b7ecb7]'
            : 'border-[#3a4a6a] bg-[#1d2b42] text-[#cfe1ff] hover:bg-[#27395c]'}`}>
      {CAP[k] ?? '?'}
    </button>
  );
  const gap = () => <span key={`g${Math.random()}`} className="w-[6px]" />;
  const inert = (cap: string, why: string) => (
    <span key={`i${cap}`} title={why}
      className="grid h-[26px] w-[26px] place-items-center rounded border border-[#242e42]
                 bg-[#131b2a] text-[10px] text-[#3d4c66]">{cap}</span>
  );

  const grid: Cell[][] = [
    ['digit1', 'digit2', 'digit3', 'digit4', 'digit5',
      'digit6', 'digit7', 'digit8', 'digit9', 'digit0'],
    ['q', 'w', 'e', 'r', 'inert'],
    ['gap', 'a', 's', 'd', 'f'],
    ['gap', 'gap', 'space'],
  ];
  const side: Cell[][] = [
    ['gap', 'up', 'gap'],
    ['left', 'down', 'right'],
  ];
  const ijl: Cell[][] = [
    ['gap', 'i', 'gap'],
    ['j', 'k', 'l'],
  ];
  const cell = (c: Cell) => {
    if (c === 'gap') return gap();
    if (c === 'inert') return inert('T', 'no cockpit channel binds T in the game');
    if (c === 'left' || c === 'right')
      return inert(c === 'left' ? '←' : '→', 'left/right ride the A/D keys');
    return key(c as PilotKey, rows.length > 0 && String(c).startsWith('digit'));
  };

  return (
    <FloatingWindow
      id={`cockpit-${p.ci}`} testid={`cockpit-window-${p.ci}`}
      minW={280} minH={200}
      initial={(vw, vh) => ({
        x: Math.max(12, vw * 0.60 + (p.ci % 4) * 24),
        y: Math.min(vh - 330, 90 + (p.ci % 5) * 22),
        w: 316, h: 260,
      })}
      header={
        <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
          <span className="shrink-0 font-semibold">🕹 {p.alias}</span>
          <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-1"
            title="lock input sending — the keyboard is plain typing again (the pads press through)">
            <input type="checkbox" data-testid={`cockpit-lock-${p.ci}`} checked={lock}
              onChange={e => { setLock(e.target.checked); setPilotLock(e.target.checked); }} />
            🔒
          </label>
          <label className="flex shrink-0 cursor-pointer items-center gap-1"
            title="repeat — clicking a keycap keeps it pressed until clicked again">
            <input type="checkbox" data-testid={`cockpit-repeat-${p.ci}`} checked={repeat}
              onChange={e => {
                setRepeat(e.target.checked);
                if (!e.target.checked)
                  for (const k of latched.current) { latched.current.delete(k); press(k, false); }
              }} />
            ⟳
          </label>
          <button className="shrink-0 text-[#8a93a0] hover:text-white"
            onClick={p.onClose} aria-label="stand up">✕</button>
        </div>
      }
    >
      {!bound && (
        <div className="px-1 py-2 text-[10px] leading-snug text-[#5d6a7d]">
          no running computer reads this seat — boot its computer (⌨), the
          seat channels appear here.
        </div>
      )}
      {/* THE KEYBOARD (organic layout, v1.16.15) */}
      <div className="flex items-start gap-3 pl-1 pt-1" data-testid={`cockpit-keys-${p.ci}`}>
        <div className="flex flex-col gap-[3px]">
          {grid.map((r, ri) => (
            <div key={ri} className="flex gap-[3px]">
              {r.map((c, i) => c === 'gap' ? <span key={i} className="w-[16px]" /> : cell(c))}
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-[3px] pt-[38px]">
          {side.map((r, ri) => (
            <div key={ri} className="flex gap-[3px]">
              {r.map((c, i) => c === 'gap' ? <span key={i} className="w-[26px]" /> : cell(c))}
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-[3px] pt-[38px]">
          {ijl.map((r, ri) => (
            <div key={ri} className="flex gap-[3px]">
              {r.map((c, i) => c === 'gap' ? <span key={i} className="w-[26px]" /> : cell(c))}
            </div>
          ))}
        </div>
      </div>
      {/* the live seat channels */}
      <div className="flex flex-wrap gap-x-2 gap-y-[2px] border-t border-white/10 px-1 pt-1"
        data-testid={`cockpit-rows-${p.ci}`}>
        {rows.map(row => {
          const v = Math.max(-1, Math.min(1, row.value));
          return (
            <span key={row.fn} className="flex items-center gap-1 text-[9px]">
              <span className="text-[#9fb0c8]" title={row.fn}>{row.fn}</span>
              <span className="relative h-[7px] w-[26px] rounded-sm bg-[#1a2436]">
                <span data-testid={`cockpit-val-${row.fn.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                  className={`absolute top-0 bottom-0 rounded-sm ${v >= 0
                    ? 'left-1/2 bg-[#3ddc55]' : 'right-1/2 bg-[#e6c07b]'}`}
                  style={{ width: `${Math.abs(v) * 50}%` }} />
                <span className="absolute top-0 bottom-0 left-1/2 w-px bg-[#3a4a6a]" />
              </span>
            </span>
          );
        })}
      </div>
    </FloatingWindow>
  );
}
