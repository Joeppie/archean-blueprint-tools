// BeaconDock.tsx — the 📡 BEACONS window under the XenonCode menu
// (v1.14.0 P9 slice A; we: "There should also be a beacons menu, under
// xenoncode, specific to letting us send and receive from known beacon
// frequencies that beacons are listening or sending to"). The global radio
// scope, craft-independent of any one IDE: the known frequencies, the
// craft's Beacon components, every beacon() participant in computer AND
// HUD programs, the user's send form, and the avatarsim sensors.
import { useState } from 'react';
import FloatingWindow from './FloatingWindow';
import BeaconPanel from './BeaconPanel';

export default function BeaconDock(p: { onClose: () => void }) {
  const [max, setMax] = useState(false);
  return (
    <FloatingWindow
      id="beacons" testid="beacon-dock" minW={520} minH={360}
      maximized={max} onToggleMaximize={() => setMax(m => !m)}
      initial={(vw, vh) => {
        const w = Math.min(880, vw * 0.8), h = Math.min(720, vh * 0.86);
        return { x: (vw - w) / 2 - 30, y: (vh - h) / 2 - 10, w, h };
      }}
      className="font-mono"
      header={
        <div className="flex items-center justify-between gap-2 bg-[#1a2436] px-3 py-1.5 text-[13px]">
          <span className="min-w-0 flex-1 truncate font-bold tracking-wide">
            📡 Beacon radio — the global scope</span>
          <div className="flex shrink-0 items-center gap-3">
            <button data-testid="beacon-max" className="text-[#8a93a0] hover:text-white"
              title={max ? 'restore' : 'maximise'}
              onClick={() => setMax(m => !m)} aria-label="maximise">{max ? '🗗' : '⛶'}</button>
            <button data-testid="beacon-close" className="text-[#8a93a0] hover:text-white"
              onClick={p.onClose} aria-label="close">✕</button>
          </div>
        </div>
      }>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <BeaconPanel wide />
      </div>
    </FloatingWindow>
  );
}
