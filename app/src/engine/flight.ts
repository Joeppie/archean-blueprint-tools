// flight.ts — the FLIGHT mode analysis (pure, static): the game's
// directional propulsion table (THRUST, .ini TARGET axes — legacy v0.x
// display rules), each engine's thrust axis in VIEW space from its DISPLAY
// quaternion, the weighted net (Propellers excluded — they thrust BOTH ways)
// and the MAIN-drive net (BigThruster only; an RCS-sole craft's backward
// push is its main drive), the cockpit heading, and the control-surface
// states. Stylized bookkeeping — NOT CFD; the wind/flow sim stays a
// separate later subsystem.

import { displayQuat, fileToViewQuat, qRot, type V3 } from './compparts';
import type { Blueprint, FileQuat } from './format';
import { massModel } from './mass';
import type { ModelManifest } from './models';

const Q_ID: FileQuat = { w: 1, x: 0, y: 0, z: 0 };
const DEG = Math.PI / 180;

export const THRUST: Readonly<Record<string, { ax: V3; w: number }>> = {
  BigThruster: { ax: [0, -1, 0], w: 1.0 },
  MiniThruster: { ax: [0, -1, 0], w: 0.4 },
  SmallThruster: { ax: [0, 1, 0], w: 0.15 },
  RCS: { ax: [0, -1, 0], w: 0.25 },          // direction = −heading when sole
  Propeller: { ax: [0, -1, 0], w: 0.6 },     // two-way: excluded from nets
};

export interface EngineRow { ci: number; type: string; w: number; axis: V3; twoWay: boolean }
export interface SurfaceRow { ci: number; type: string; angle: number }

export interface FlightReport {
  engines: EngineRow[];
  net: V3;                       // weighted net of one-way engines (view)
  mainNet: V3;                   // BigThruster (or sole-RCS) direction
  rcsOnly: boolean;
  heading: V3 | null;            // cockpit forward (view); null = no seat
  surfaces: SurfaceRow[];
  mass: { total: number; declared: number; com: V3 };
}

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

export function flightReport(bp: Blueprint, manifest: ModelManifest | null, cellMass: number): FlightReport {
  const legacy = bp.data.colors == null || bp.data.colors.length === 0;
  const comps = bp.data.components;
  const rcsOnly = comps.some(c => c.type === 'RCS')
    && !comps.some(c => c.type in THRUST && c.type !== 'RCS');

  // cockpit heading: first seat's forward. The seat faces its local −z in
  // FILE space = the view chain's +z after mirroring; flatten to x/z.
  let heading: V3 | null = null;
  const seat = comps.findIndex(c => c.type === 'PilotSeat');
  if (seat >= 0) {
    const s = comps[seat]!;
    const qv = fileToViewQuat(s.orientation ?? Q_ID, legacy);
    const f = qRot(qv, [0, 0, 1]);
    const l = Math.hypot(f[0], f[2]);
    heading = l > 0.15 ? norm([f[0]!, 0, f[2]!]) : norm(f);
  }

  const engines: EngineRow[] = [];
  let net: V3 = [0, 0, 0], mainNet: V3 = [0, 0, 0];
  comps.forEach((c, ci) => {
    const th = THRUST[c.type];
    if (!th) return;
    if (c.type === 'RCS' && !rcsOnly) return;            // beside real engines: attitude only
    const qDisp = displayQuat(c.type, fileToViewQuat(c.orientation ?? Q_ID, legacy), c.orientation ?? Q_ID);
    // the .ini TARGET axis lives in the part's raw-LH local frame; the view
    // mirror maps (x, y, z)file-local → (x, y, −z) before the quaternion
    let ax = qRot(qDisp, [th.ax[0], th.ax[1], -th.ax[2]]);
    if (c.type === 'RCS' && heading) ax = [-heading[0], 0, -heading[2]];   // tail-ward push
    ax = norm(ax);
    const twoWay = c.type === 'Propeller';
    engines.push({ ci, type: c.type, w: th.w, axis: ax, twoWay });
    if (!twoWay) net = [net[0] + ax[0]! * th.w, net[1] + ax[1]! * th.w, net[2] + ax[2]! * th.w];
    if (!twoWay && (c.type === 'BigThruster' || (c.type === 'RCS' && rcsOnly)))
      mainNet = [mainNet[0] + ax[0]! * th.w, mainNet[1] + ax[1]! * th.w, mainNet[2] + ax[2]! * th.w];
  });

  const surfaces: SurfaceRow[] = [];
  comps.forEach((c, ci) => {
    if ((c.type === 'Aileron' || c.type === 'Rudder' || c.type === 'Elevator')
      && typeof c.data?.['angle'] === 'number')
      surfaces.push({ ci, type: c.type, angle: c.data['angle'] as number });
  });

  const mm = massModel(bp, manifest, cellMass);
  return { engines, net, mainNet, rcsOnly, heading, surfaces,
    mass: { total: mm.total, declared: mm.declared, com: mm.com } };
}

/** degrees between two view-space directions (0 = aligned) */
export const angleDeg = (a: V3, b: V3) =>
  Math.acos(Math.max(-1, Math.min(1, a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!
    / ((Math.hypot(...a) || 1) * (Math.hypot(...b) || 1))))) / DEG;
