// pilotkeys.ts — fly the craft from the dash window (v1.13.2, we: "for when
// you are looking at the dash window, or computer's dash window, pressing
// WASD, up, down, and F should be given as inputs into the computer for all
// cockpit connections it has. This will allow us to simulate that").
//
// The hook is armed ONLY while a dash view has your attention: the ▣ Screens
// dock and the IDE's Screens side tab. It maps the cockpit keys onto
// the RUNNING computer's PilotSeat worldsim rows (pump.pilotKey — the
// mapping law lives in engine/xenoncode.ts PILOT_KEYS) and feeds presses
// for EVERY pilot channel the computer has — the stick (WASD, arrows,
// SPACE), Roll Q/E, Pitch I/K, Yaw J/L, Main Thrust R and the Aux ladder
// 1-9/0 (we: "keyboard binds available also for the other keys cockpits
// can give"). Keys never leak while you type (the IDE editor, search boxes)
// and all sticks CENTER on release, key-up,
// view-change and window-blur — a lost keyup must not run the throttle away.

import { useEffect } from 'react';
import { xenonFarm, type PilotKey } from './xenoncode';

// FARM (v1.15.0 slice C): the cockpit keys press EVERY pump with the
// seat bound — one pilot, all co-running computers.
const anyCockpit = () => xenonFarm.pumps.some(p => p.pilotKeysBound().length);
const pressAll = (k: PilotKey, down: boolean) => { for (const p of xenonFarm.pumps) p.pilotKey(k, down); }

const KEYMAP: Record<string, PilotKey> = {
  KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd',
  ArrowUp: 'up', ArrowDown: 'down', KeyF: 'f', Space: 'space', KeyE: 'e',
  // v1.13.8 FULL COCKPIT (we: "keyboard binds available also for the other
  // keys cockpits can give"): Q/E roll, I/K pitch, J/L yaw, R main thrust,
  // digit row = Aux 1..9/0. The global g/o/h/w/5 shortcut map yields while
  // pilotKeysActive() (the cockpit owns its keys, like 'w' since v1.13.2).
  KeyQ: 'q', KeyI: 'i', KeyK: 'k', KeyJ: 'j', KeyL: 'l', KeyR: 'r',
  Digit1: 'digit1', Digit2: 'digit2', Digit3: 'digit3', Digit4: 'digit4',
  Digit5: 'digit5', Digit6: 'digit6', Digit7: 'digit7', Digit8: 'digit8',
  Digit9: 'digit9', Digit0: 'digit0',
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
  return activeCount > 0 && anyCockpit();
}

/** Feed WASD / ↑ / ↓ / F into the running computer's cockpit while active. */
export function usePilotKeys(active: boolean) {
  useEffect(() => {
    if (!active) return;
    activeCount++;
    const pressed = new Set<string>();
    const releaseAll = () => {
      for (const code of pressed) pressAll(KEYMAP[code]!, false);
      pressed.clear();
    };
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (isTyping(e.target)) return;
      const key = KEYMAP[e.code];
      if (!key) return;
      if (!anyCockpit()) return;                            // no cockpit: keys pass through
      e.preventDefault();                       // arrows scroll the page; F feeds Aux 1
      if (pressed.has(e.code)) return;
      pressed.add(e.code);
      pressAll(key, true);
    };
    const up = (e: KeyboardEvent) => {
      const key = KEYMAP[e.code];
      if (!key || !pressed.delete(e.code)) return;
      pressAll(key, false);
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
