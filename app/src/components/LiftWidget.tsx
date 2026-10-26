// LiftWidget.tsx — the buoyancy readout BUILT INTO the builder (user
// 2026-10-22: "tell us what lift would be if vacuum at sea level, helium or
// hydrogen, make a collapsible widget part of the builder that allows us to
// see performance/weight limit at altitudes/equilibrium. Archean uses real
// world data for this").
//
// The envelope is the SEALED volume (v1.11, engine/atmo sealedEnvelope-
// Volume): the craft's block cells and voxelised skin triangles are flooded
// from outside, and what the flood cannot reach is the envelope — a block
// hull reports lift too. Only a skin the flood cannot close falls back to
// the divergence sum (engine/atmo envelopeVolume — the exact FORMAT lattice,
// divergence-theorem volume). The mass is the game's own mass model
// (engine/mass.ts — the same number the StaticInfo card shows, hull SKIN
// included since v1.7.1), and the
// air is the real ISA table (the game floats craft on real-world numbers).
// A collapsible row under the panel header: one glance shows which gas at
// which altitude still carries the craft — open it for the per-altitude
// weight-limit table and the equilibrium (zero-net-lift) altitude per gas.
import { useEffect, useRef, useState } from 'react';
import type { Blueprint } from '../engine/format';
import type { Engine } from '../engine/scene';
import { ALT_STEPS, ALT_CEILING, GASES, envelopeVolume, equilibrium, liftKg, sealedEnvelopeVolume } from '../engine/atmo';

const LS_KEY = 'archean-app-lift-open';

const fmt = (n: number, d = 0) => n.toLocaleString('en', { maximumFractionDigits: d });
/** kg below 10 t, tonnes above (the zeppelin numbers are huge) */
const kg = (n: number) => Math.abs(n) >= 10000 ? `${fmt(n / 1000, 1)} t` : `${fmt(n)} kg`;
const alt = (m: number) => m >= 9000 ? `${fmt(m / 1000, 1)} km` : `${fmt(m)} m`;

export function LiftWidget(p: { engine: Engine | null; bp: Blueprint; rev: number }) {
  const [open, setOpen] = useState(() => localStorage.getItem(LS_KEY) === '1');
  useEffect(() => { localStorage.setItem(LS_KEY, open ? '1' : '0'); }, [open]);

  // the blueprint's triangle array is MUTATED in place on every edit — the
  // rev counter (bumped through the same funnel) is the real dependency
  // v1.11 (we: "lift should calculate from a volume block. Note we only
  // look at enclosed blocks/triangles"): the ENVELOPE is the SEALED volume
  // — block cells + voxelised skin triangles flood-checked from outside;
  // what cannot be reached is the envelope. Markers are never trusted. A
  // skin that seals nothing falls back to the divergence read (an open
  // skin lifts nothing; the row just says so honestly).
  // v1.11.2 PERF (load.perf: the sealed flood costs 219 ms on the giant and
  // ran SYNCHRONOUSLY in a useMemo on EVERY rev — one long main-thread stall
  // per gizmo-drag commit, KNOWN ISSUE 1): the first compute stays
  // synchronous (mount), every later rev re-computes DEBOUNCED 250 ms — a
  // drag burst is ONE recompute at the end, the readout rides one step
  // behind (a readout, not a gate), and the flood never blocks a frame.
  const envOf = (bp: Blueprint) => {
    const s = sealedEnvelopeVolume(bp.data.triangles ?? [], bp.data.blocks ?? []);
    return s.cells > 0
      ? { m3: s.m3, tris: (bp.data.triangles ?? []).length, sealed: true }
      : { ...envelopeVolume(bp.data.triangles ?? []), sealed: false };
  };
  const [env, setEnv] = useState(() => envOf(p.bp));
  const lastRev = useRef(p.rev);
  useEffect(() => {
    if (lastRev.current === p.rev) return;              // mount value is fresh
    lastRev.current = p.rev;
    const t = setTimeout(() => setEnv(envOf(p.bp)), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.rev, p.bp]);
  const mm = p.engine?.massReport();

  const mass = mm?.total ?? 0;
  // v1.11: the rows key off the SEALED ENVELOPE, not a triangle count —
  // a zeppelin built of BLOCKS seals the flood and gets its lift (we: "for
  // the zeppelin in corpus, the lift is not calculated because its not
  // made of triangles. We can still find the hull for it")
  const rows = env.m3 > 0
    ? GASES.map(g => ({ g, sl: liftKg(g.id, env.m3, 0), eq: equilibrium(g.id, env.m3, mass) }))
    : [];

  return (
    <div data-testid="lift-widget" className="border-b border-white/10">
      {/* collapsed one-liner: the headline answer (vacuum lift @ SL vs mass) */}
      <button data-testid="lift-toggle" onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left">
        <span className="w-3 text-[9px] text-ink-dim">{open ? '▾' : '▸'}</span>
        <span className="ksp-label min-w-0 flex-1 truncate text-[11px] font-semibold text-ink-dim">
          Lift &amp; altitude
        </span>
        <span data-testid="lift-head" className="shrink-0 text-[10px] tabular-nums text-ink-dim">
          {env.m3 === 0 ? 'no sealed envelope'
            : `${fmt(env.m3)} m³ · vacuum ${kg(rows[0]!.sl)}`}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-2 text-[11px] leading-snug">
          {env.m3 === 0 ? (
            <div className="text-ink-dim">
              nothing sealed yet — the envelope is the volume the outside
              cannot reach: <b>enclosed blocks</b> and/or a closed hull
              SKIN (wall the volume in, build a skin with Tools ▸ Generate
              balloon, or convert blocks with Tools ▸ Blocks → hull
              triangles). Walls alone displace no lift.
            </div>
          ) : (
            <div data-testid="lift-body" className="space-y-1.5">
              <div className="flex justify-between gap-2 text-ink-dim">
                <span>{(env as { sealed?: boolean }).sealed
                  ? `envelope (sealed blocks + skin, ${env.tris} triangles)`
                  : `envelope (open skin, ${env.tris} triangles)`}</span>
                <b data-testid="lift-volume" className="tabular-nums text-ink">{fmt(env.m3, 1)} m³</b>
                {(env as { sealed?: boolean }).sealed &&
                  <span data-testid="lift-sealed" className="ml-1 text-[9px] uppercase tracking-wide text-emerald-400"
                    title="the volume the outside flood cannot reach — enclosed blocks and skin triangles, not markers">sealed hull</span>}
              </div>
              <div className="flex justify-between gap-2 text-ink-dim">
                <span>craft mass (computed)</span>
                <b className="tabular-nums text-ink">{kg(mass)}</b>
              </div>

              {/* per gas: sea-level lift, spare payload, equilibrium ceiling */}
              <table className="w-full tabular-nums" data-testid="lift-gases">
                <thead>
                  <tr className="text-left text-[9px] uppercase tracking-wider text-ink-dim">
                    <th className="font-normal">gas</th><th className="text-right font-normal">lift @ SL</th>
                    <th className="text-right font-normal">margin</th><th className="text-right font-normal">floats at</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ g, sl, eq }) => (
                    <tr key={g.id} data-testid={`lift-row-${g.id}`}>
                      <td>{g.label}</td>
                      <td className="text-right">{kg(sl)}</td>
                      <td className={`text-right ${sl - mass < 0 ? 'text-red-300' : 'text-gold'}`}>
                        {sl - mass < 0 ? 'sinks' : `+${kg(sl - mass)}`}
                      </td>
                      <td className={`text-right ${eq.sinks ? 'text-red-300' : ''}`}>
                        {eq.sinks ? '—' : eq.atCeiling ? `> ${alt(ALT_CEILING)}` : alt(eq.m)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* the weight-limit ladder: max TOTAL mass still buoyant per altitude */}
              <div className="pt-0.5 text-[9px] uppercase tracking-wider text-ink-dim">
                weight limit by altitude (total kg)
              </div>
              <table className="w-full tabular-nums" data-testid="lift-altitudes">
                <thead>
                  <tr className="text-left text-[9px] uppercase tracking-wider text-ink-dim">
                    <th className="font-normal">alt</th>
                    {GASES.map(g => <th key={g.id} className="text-right font-normal">{g.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {ALT_STEPS.map(h => (
                    <tr key={h}>
                      <td className={h === 0 ? 'text-gold' : ''}>{h === 0 ? 'SL' : alt(h)}</td>
                      {GASES.map(g => {
                        const cap = liftKg(g.id, env.m3, h);
                        return (
                          <td key={g.id} className={`text-right ${cap < mass ? 'text-red-300/70' : ''}`}>
                            {kg(cap)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-[9px] leading-snug text-ink-dim">
                ISA standard atmosphere · lift = envelope × (ρ_air − ρ_gas);
                “floats at” = equilibrium altitude where lift = craft mass.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
