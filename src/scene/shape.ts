import { params } from '../params';

/**
 * Everything the signed distance field needs, derived from params and the current press amount.
 * The GLSL `map()` (sdf.glsl) and the CPU copy (sdf.ts) both read exactly these numbers.
 */
export interface Shape {
  /** Half width, half height, corner radius, half thickness. */
  slab: [number, number, number, number];
  slabEdge: number;
  /** Half width, half height, depth, lip blend. */
  well: [number, number, number, number];
  /** Half width, half height, half thickness, edge radius. */
  pill: [number, number, number, number];
  pillZ: number;
  /** Offset of the cap and well on the face. */
  pillX: number;
  pillY: number;
  pillDome: number;
  pillFillet: number;
  /** Half extents (xyz) and centre z of the box around the well and cap (centred on pillX, pillY). */
  pillBound: [number, number, number, number];
  /** Proxy box the glass is ray traced inside. */
  boxMin: [number, number, number];
  boxMax: [number, number, number];
  /** Label rectangle on the cap: centre xy, half size xy (4:1, matching the label texture). */
  label: [number, number, number, number];
  /** z of the front face. */
  face: number;
}

/** Room above the cap for the spring's overshoot when it pops back up. */
const OVERSHOOT = 0.35;
const BOX_MARGIN = 0.03;

export function deriveShape(press: number, out?: Shape): Shape {
  const s = params.slab;
  const p = params.pill;
  const w = params.well;
  const face = s.halfT;
  const wellW = p.halfW + w.clearance;
  const wellH = p.halfH + w.clearance;
  const restZ = face + p.rise - p.halfT;
  const pillZ = restZ - press * p.travel;

  const top = face + p.rise + p.dome + OVERSHOOT * p.travel;
  const bottom = Math.max(Math.min(face - w.depth, restZ - p.halfT - p.travel) - 0.04, -s.halfT - 0.05);
  const zHi = top + 0.05;

  const labelHalfW = p.halfW * 0.92;
  const shape: Shape = out ?? ({} as Shape);
  shape.slab = [s.halfW, s.halfH, s.corner, s.halfT];
  shape.slabEdge = s.edge;
  shape.well = [wellW, wellH, w.depth, w.lip];
  shape.pill = [p.halfW, p.halfH, p.halfT, p.edge];
  shape.pillZ = pillZ;
  shape.pillX = p.x;
  shape.pillY = p.y;
  shape.pillDome = p.dome;
  shape.pillFillet = p.fillet;
  shape.pillBound = [wellW + 0.05, wellH + 0.05, (zHi - bottom) / 2, (zHi + bottom) / 2];
  shape.boxMin = [-s.halfW - BOX_MARGIN, -s.halfH - BOX_MARGIN, -s.halfT - BOX_MARGIN];
  shape.boxMax = [s.halfW + BOX_MARGIN, s.halfH + BOX_MARGIN, Math.max(top, s.halfT) + BOX_MARGIN];
  shape.label = [p.x + params.label.dx, p.y + params.label.dy, labelHalfW, labelHalfW / 4];
  shape.face = face;
  return shape;
}
