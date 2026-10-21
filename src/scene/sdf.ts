import type { Shape } from './shape';

// CPU copy of sdf.glsl, used to find out what the pointer is over. Keep the two in step: any change
// to map() in the shader belongs here too.

/** Below this distance from the cap's bounding box the full field is evaluated (matches sdf.glsl). */
const BOUND_MARGIN = 0.04;

function sdRoundRect(px: number, py: number, bx: number, by: number, r: number): number {
  const qx = Math.abs(px) - bx + r;
  const qy = Math.abs(py) - by + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdRoundSlab(
  px: number,
  py: number,
  pz: number,
  bx: number,
  by: number,
  rc: number,
  ht: number,
  re: number,
): number {
  const d = sdRoundRect(px, py, bx - re, by - re, Math.max(rc - re, 0));
  const wx = d;
  const wy = Math.abs(pz) - ht + re;
  return Math.min(Math.max(wx, wy), 0) + Math.hypot(Math.max(wx, 0), Math.max(wy, 0)) - re;
}

function smin(a: number, b: number, k: number): number {
  const h = Math.min(Math.max(0.5 + (0.5 * (b - a)) / k, 0), 1);
  return b + (a - b) * h - k * h * (1 - h);
}

function smax(a: number, b: number, k: number): number {
  const h = Math.min(Math.max(0.5 - (0.5 * (b - a)) / k, 0), 1);
  return b + (a - b) * h + k * h * (1 - h);
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

export function sdPill(s: Shape, x: number, y: number, z: number): number {
  const [hw, hh, ht, re] = s.pill;
  const qx = x - s.pillX;
  const qy = y - s.pillY;
  const qz = z - s.pillZ;
  const d = sdRoundSlab(qx, qy, qz, hw, hh, hh, ht, re);
  const inner = Math.min(Math.max(-sdRoundRect(qx, qy, hw, hh, hh) / hh, 0), 1);
  return d - s.pillDome * inner * (2 - inner) * smoothstep(-0.02, 0.02, qz);
}

function sdWellCutter(s: Shape, x: number, y: number, z: number): number {
  const [hw, hh, depth] = s.well;
  return sdRoundSlab(x - s.pillX, y - s.pillY, z - s.slab[3], hw, hh, hh, depth, Math.min(0.03, hh));
}

export function map(s: Shape, x: number, y: number, z: number): number {
  const [hw, hh, corner, ht] = s.slab;
  const slab = sdRoundSlab(x, y, z, hw, hh, corner, ht, s.slabEdge);
  const [bx, by, bz, bc] = s.pillBound;
  const dx = Math.abs(x - s.pillX) - bx;
  const dy = Math.abs(y - s.pillY) - by;
  const dz = Math.abs(z - bc) - bz;
  const bound = Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dy, dz), 0);
  if (bound > BOUND_MARGIN) return slab >= 0 ? Math.min(slab, bound) : Math.max(slab, -bound);
  const body = smax(slab, -sdWellCutter(s, x, y, z), s.well[3]);
  return smin(body, sdPill(s, x, y, z), s.pillFillet);
}

export interface Ray {
  origin: [number, number, number];
  direction: [number, number, number];
}

/** Sphere-traces an object-space ray; returns the hit point or null. */
export function trace(s: Shape, ray: Ray): [number, number, number] | null {
  const [ox, oy, oz] = ray.origin;
  const [dx, dy, dz] = ray.direction;
  let tNear = -Infinity;
  let tFar = Infinity;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  for (let axis = 0; axis < 3; axis++) {
    const inv = 1 / (Math.abs(d[axis]) < 1e-9 ? 1e-9 : d[axis]);
    let t0 = (s.boxMin[axis] - o[axis]) * inv;
    let t1 = (s.boxMax[axis] - o[axis]) * inv;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tNear = Math.max(tNear, t0);
    tFar = Math.min(tFar, t1);
  }
  if (tFar < Math.max(tNear, 0)) return null;
  let t = Math.max(tNear, 0);
  for (let i = 0; i < 160 && t <= tFar; i++) {
    const x = ox + dx * t;
    const y = oy + dy * t;
    const z = oz + dz * t;
    const dist = map(s, x, y, z);
    if (dist < 2e-4) return [x, y, z];
    t += dist;
  }
  return null;
}

/** True when an object-space surface point belongs to the button: the cap or the well it sits in. */
export function isButton(s: Shape, p: [number, number, number]): boolean {
  const [x, y, z] = p;
  const [ww, wh, depth] = s.well;
  const inWell = sdRoundRect(x - s.pillX, y - s.pillY, ww + 0.01, wh + 0.01, wh + 0.01) < 0;
  return inWell && z > s.face - depth - 0.01;
}
