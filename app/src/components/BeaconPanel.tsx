// BeaconPanel.tsx — THE BEACONS tab (v1.14.0 P9 slice A; we: "make beacons
// into a seperate tab for computers/hud as well, so the globally known
// scope can be understood when we have 'intercomputer' operations; be they
// HUDs or minicomputers or computers" + "a beacons menu, under xenoncode,
// specific to letting us send and receive from known beacon frequencies").
// One panel rides THREE hosts: the computer IDE's side tab, the HUD IDE's
// side tab, and the BeaconDock window (the XenonCode ▸ 📡 Beacons menu).
// It reads THE global registry (engine/beaconnet.ts) and the AVATARSIM
// sensor rows (worldsim store, avatar_sensor_* keys — FORMAT §Player-
// installed HUDs: a HUD's get("avatar_sensor_speed") reads these).
import { useRef, useSyncExternalStore } from 'react';
import { beaconNet, freqNorm, type BeaconParticipant } from '../engine/beaconnet';
import { wsEnsure, wsSave, evalExpr } from '../engine/worldsim';

const testidKey = (s: string): string => s.replace(/[^a-zA-Z0-9-]/g, '-');

const AVATARSIM: { key: string; label: string; def: string }[] = [
  { key: 'avatar_sensor_speed', label: 'Avatar · speed (m/s)', def: '80' },
  { key: 'avatar_sensor_altitude', label: 'Avatar · terrain altitude (m)', def: '2000' },
  { key: 'avatar_sensor_altitude_absolute', label: 'Avatar · absolute altitude (m)', def: '6205000' },
];

const fmtAt = (ms: number): string =>
  ms ? new Date(ms).toLocaleTimeString([], { hour12: false }) : '—';

export default function BeaconPanel(p: { wide?: boolean }) {
  // one subscription drives the whole panel (beaconNet.version bumps on
  // seed/post/sendTo — the same ≤10 Hz UI rhythm the panels already keep)
  useSyncExternalStore(cb => beaconNet.subscribe(cb), () => beaconNet.version);
  const t0 = useRef(Date.now());
  const t = (Date.now() - t0.current) / 1000;
  const parts = beaconNet.participants().filter(q => q.kind !== 'user');
  const freqs = beaconNet.freqs();
  const send = () => {
    const f = (document.getElementById('beacon-freq-input') as HTMLInputElement | null)?.value ?? '';
    const d = (document.getElementById('beacon-data-input') as HTMLTextAreaElement | null)?.value ?? '';
    if (!f.trim()) return;
    beaconNet.sendTo(f, d);
  };
  return (
    <div className={`flex min-w-0 flex-col gap-2 overflow-x-hidden text-[11px] ${p.wide ? 'max-w-[900px]' : ''}`}>
      {/* KNOWN FREQUENCIES — the globally visible radio scope */}
      <div data-testid="beacon-freqs" className="flex flex-wrap items-center gap-y-1">
        <span className="mr-1 text-[10px] uppercase tracking-widest text-[#5d6a7d]">
          Known frequencies ({freqs.length})</span>
        {freqs.length === 0 && <span className="text-[#5d6a7d]">none on this craft (beacons + beacon() calls appear here)</span>}
        {freqs.map(f => (
          <button key={f} data-testid={`beacon-freq-${testidKey(f)}`}
            className="mx-1 max-w-[220px] break-all rounded bg-[#1a2233] px-1.5 py-0.5 text-[10px] text-[#8fd4ff] hover:bg-[#243a52]"
            title="use as the send frequency"
            onClick={() => {
              const el = document.getElementById('beacon-freq-input') as HTMLInputElement | null;
              if (el) el.value = f;
            }}>{f}</button>
        ))}
      </div>

      {/* SEND — the user's own transmitter (the dock's form) */}
      <div className="flex flex-wrap items-end gap-1 rounded border border-[#232c3d] bg-[#10182a] p-1.5">
        <label className="flex flex-col text-[9px] uppercase tracking-wide text-[#5d6a7d]">
          frequency
          <input id="beacon-freq-input" data-testid="beacon-freq-form" list="beacon-freq-list"
            className="w-44 rounded border border-[#2b3a52] bg-[#0b0f18] px-1.5 py-1 text-[11px] outline-none"
            placeholder="e.g. RCS-500-HUD-SEND" />
        </label>
        <datalist id="beacon-freq-list">
          {freqs.map(f => <option key={f} value={f} />)}
        </datalist>
        <label className="flex min-w-0 flex-1 flex-col text-[9px] uppercase tracking-wide text-[#5d6a7d]">
          payload (text — the game sends dot-kv objects as text)
          <textarea id="beacon-data-input" data-testid="beacon-data-form" rows={2}
            className="min-w-[160px] flex-1 rounded border border-[#2b3a52] bg-[#0b0f18] px-1.5 py-1 font-mono text-[11px] outline-none"
            placeholder=".use{-40.07}.fl{0}.bat{1}" />
        </label>
        <button data-testid="beacon-send"
          className="shrink-0 rounded bg-[#2b4a2b] px-3 py-1.5 text-[11px] text-[#b7ecb7] hover:bg-[#38603a]"
          onClick={send}>📡 send</button>
        <button data-testid="beacon-clear" title="clear every traffic log"
          className="shrink-0 rounded bg-[#33202a] px-2 py-1.5 text-[11px] text-[#ffb3b3] hover:bg-[#4a2836]"
          onClick={() => beaconNet.clearLogs()}>✕ logs</button>
      </div>

      {/* YOUR TRANSMISSIONS */}
      {beaconNet.outbox.length > 0 && (
        <div data-testid="beacon-outbox" className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-widest text-[#5d6a7d]">Your transmissions</span>
          {beaconNet.outbox.slice(0, 8).map((e, i) => (
            <div key={i} className="flex gap-2 rounded border border-[#232c3d] bg-[#10182a] px-2 py-0.5 text-[10px]">
              <span className="shrink-0 tabular-nums text-[#5d6a7d]">{fmtAt(e.at)}</span>
              <span className="shrink-0 text-[#8fd4ff]">→{e.from}</span>
              <span className="min-w-0 truncate text-[#d6dbe1]" title={e.data}>{e.data}</span>
            </div>
          ))}
        </div>
      )}

      {/* PARTICIPANTS — every radio on the craft + in every program */}
      <span className="text-[10px] uppercase tracking-widest text-[#5d6a7d]">
        Beacon scope ({parts.length})</span>
      {parts.length === 0 && (
        <span className="text-[#5d6a7d]">no beacons/HUD programs on this craft — the XenonCode menu lists HUDs whose .xc files carry beacon() calls</span>
      )}
      {parts.map(pt => <Participant key={pt.id} pt={pt} />)}

      {/* AVATARSIM — the player's own sensors (the HUD's get() pool) */}
      <div className="mt-1 border-t border-[#232c3d] pt-1.5">
        <div data-testid="avatarsim-head" className="text-[10px] uppercase tracking-widest text-[#5d6a7d]">
          Avatarsim · the player&apos;s world (a HUD&apos;s get("avatar_sensor_*"))</div>
        {AVATARSIM.map(a => {
          const c = wsEnsure(a.key, a.label, 'sensor', a.def);
          let v = c.value;
          let err = c.error;
          try { v = evalExpr(c.base, t); err = undefined; } catch (e) { err = String(e); }
          return (
            <div key={a.key} data-testid={`avatarsim-row-${a.key}`}
              className="mt-1 flex items-center gap-2 rounded border border-[#232c3d] bg-[#10182a] px-2 py-1">
              <span className="w-56 shrink-0 truncate text-[#9fb0c8]" title={a.label}>{a.label}</span>
              <span className="w-28 shrink-0 text-right tabular-nums text-[#8fd48f]">{v.toFixed(2)}</span>
              <span className="min-w-0 flex-1 text-[9px] text-[#5d6a7d]">f(t) =</span>
              <input data-testid={`avatarsim-base-${a.key}`} value={c.base}
                className="w-32 rounded border border-[#2b3a52] bg-[#0b0f18] px-1.5 py-0.5 text-[10px] outline-none"
                onChange={e => { c.base = e.target.value; wsSave(); }} />
              {err && <span className="text-[9px] text-[#ff8585]">{err}</span>}
            </div>
          );
        })}
        <div className="mt-1 text-[9px] leading-snug text-[#5d6a7d]">
          absolute altitude is the game&apos;s datum (sea level = 6 203 000 m, FORMAT §Player-installed
          HUDs). The HUD RUNTIME (panel/draw/beacon builtins on the VM) rides the next slice —
          this scope is what it will transmit through.
        </div>
      </div>
    </div>
  );
}

function Participant(p: { pt: BeaconParticipant }) {
  const pt = p.pt;
  const badge = pt.kind === 'beacon' ? 'bg-[#332a1a] text-[#e6c07b]'
    : pt.kind === 'hud' ? 'bg-[#1d2b42] text-[#8fd4ff]' : 'bg-[#1a2b1a] text-[#8fd48f]';
  return (
    <div data-testid={`beacon-part-${testidKey(pt.id)}`}
      className="rounded border border-[#232c3d] bg-[#131a28] px-2 py-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className={`shrink-0 rounded px-1 text-[9px] uppercase ${badge}`}>{pt.kind}</span>
        <span className="min-w-0 flex-1 truncate text-[#d6dbe1]" title={pt.label}>{pt.label}</span>
        <span className="inline-block max-w-[140px] shrink-0 truncate align-bottom text-[10px] text-[#7ea6ff]" title={`transmits on → ${pt.tx || '—'}`}>
          tx→{pt.tx || '—'}</span>
        <span className="inline-block max-w-[140px] shrink-0 truncate align-bottom text-[10px] text-[#8fd48f]" title={`listens on ${pt.rx || '—'}`}>rx←{pt.rx || '—'}</span>
        <span data-testid={`beacon-rx-count-${testidKey(pt.id)}`}
          className="shrink-0 rounded bg-[#1a2233] px-1 text-[9px] tabular-nums text-[#9fb0c8]">
          {pt.rxLog.length ? `${pt.rxLog.length} rx` : ''}</span>
      </div>
      {(pt.lastTx || pt.rxLog.length > 0) && (
        <div className="ml-3 mt-0.5 border-l border-[#232c3d] pl-2">
          {pt.lastTx && (
            <div className="truncate text-[10px] text-[#9fb0c8]" title={pt.lastTx}>
              <span className="text-[#5d6a7d]">last tx {fmtAt(pt.lastTxAt)}: </span>{pt.lastTx}
            </div>
          )}
          {pt.rxLog.slice(0, 6).map((e, i) => (
            <div key={i} className="truncate text-[10px] text-[#d6dbe1]" title={e.data}>
              <span className="text-[#5d6a7d]">{fmtAt(e.at)} ← {e.from}: </span>{e.data}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { freqNorm };
