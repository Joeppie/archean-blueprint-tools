// pilotkeys.ts — fly the craft from the dash window (v1.13.2, we: "for when
// you are looking at the dash window, or computer's dash window, pressing
// WASD, up, down, and F should be given as inputs into the computer for all
// cockpit connections it has. This will allow us to simulate that").
//
// The hook is armed ONLY while a dash view has your attention: the ▣ Screens
// dock and the IDE's Screens side tab. It maps the seven flight keys onto
// the RUNNING computer's PilotSeat worldsim rows (pump.pilotKey — the
// mapping law lives in engine/xenoncode.ts PILOT_KEYS) and feeds presses
// for EVERY pilot channel the computer has. Keys never leak while you type
// (the IDE editor, search boxes) and all sticks CENTER on release, key-up,
// view-change and window-blur — a lost keyup must not run the throttle away.

import { useEffect } from 'react';
import { xenonPump, type PilotKey } from './xenoncode';

const KEYMAP: Record<string, PilotKey> = {
  KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd',
  ArrowUp: 'up', ArrowDown: 'down', KeyF: 'f', Space: 'space', KeyE: 'e',
};

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
    || el.tagName === 'SELECT' || el.isContentEditable === true);
};

// While a dash view is armed, the flight keys belong to the COCKPIT — the
// app's global single-key shortcuts (g/o/h/w/5) must stand down: 'w' is the
// run key in Chip's Mario AND the wireframe toggle (we 2026-10-27). Only a
// computer WITH cockpit channels claims them; on a cockpit-less craft the
// keys pass through untouched.
let activeCount = 0;
export function pilotKeysActive(): boolean {
  return activeCount > 0 && xenonPump.pilotKeysBound().length > 0;
}

/** Feed WASD / ↑ / ↓ / F into the running computer's cockpit while active. */
export function usePilotKeys(active: boolean) {
  useEffect(() => {
    if (!active) return;
    activeCount++;
    const pressed = new Set<string>();
    const releaseAll = () => {
      for (const code of pressed) xenonPump.pilotKey(KEYMAP[code]!, false);
      pressed.clear();
    };
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (isTyping(e.target)) return;
      const key = KEYMAP[e.code];
      if (!key) return;
      if (!xenonPump.pilotKeysBound().length) return;   // no cockpit: keys pass through
      e.preventDefault();                       // arrows scroll the page; F feeds Aux 1
      if (pressed.has(e.code)) return;
      pressed.add(e.code);
      xenonPump.pilotKey(key, true);
    };
    const up = (e: KeyboardEvent) => {
      const key = KEYMAP[e.code];
      if (!key || !pressed.delete(e.code)) return;
      xenonPump.pilotKey(key, false);
    };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    addEventListener('blur', releaseAll);
    return () => {
      activeCount--;
      releaseAll();
      removeEventListener('keydown', down);
      removeEventListener('keyup', up);
      removeEventListener('blur', releaseAll);
    };
  }, [active]);
}
