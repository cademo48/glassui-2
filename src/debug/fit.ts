import * as THREE from 'three';
import type { Stage } from '../gl/stage';
import { params } from '../params';

// Dev-only: fits the rest pose and framing to the reference image, so shape changes (thickness,
// proportions) don't drift the composition. Targets are measured on the reference's content area.

/**
 * Virtual (sharp) corners of the reference's front face outline (where the front face meets the side
 * walls), TL, TR, BR, BL, in content pixels. Measured by the review from 35 edge profiles.
 */
const FACE_CORNERS: [number, number][] = [
  [331, 130],
  [608, 104],
  [721, 422],
  [428, 485],
];
/** Where the shadow's centre sits on the reference. */
const SHADOW_Y = 507;
const DEG = Math.PI / 180;

function nelderMead(f: (x: number[]) => number, x0: number[], steps: number[], iterations = 1500) {
  const n = x0.length;
  let points = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const p = x0.slice();
    p[i] += steps[i];
    points.push(p);
  }
  let values = points.map(f);
  for (let it = 0; it < iterations; it++) {
    const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
    points = order.map((i) => points[i]);
    values = order.map((i) => values[i]);
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += points[i][j] / n;
    const reflect = c.map((v, j) => v + (v - points[n][j]));
    const fr = f(reflect);
    if (fr < values[0]) {
      const expand = c.map((v, j) => v + 2 * (v - points[n][j]));
      const fe = f(expand);
      [points[n], values[n]] = fe < fr ? [expand, fe] : [reflect, fr];
    } else if (fr < values[n - 1]) {
      [points[n], values[n]] = [reflect, fr];
    } else {
      const contract = c.map((v, j) => v + 0.5 * (points[n][j] - v));
      const fc = f(contract);
      if (fc < values[n]) {
        [points[n], values[n]] = [contract, fc];
      } else {
        for (let i = 1; i <= n; i++) {
          points[i] = points[i].map((v, j) => points[0][j] + 0.5 * (v - points[0][j]));
          values[i] = f(points[i]);
        }
      }
    }
  }
  return { x: points[0], error: values[0] };
}

/**
 * Fits rest yaw/pitch/roll, camera fill and centreY to the reference corners, then the floor height.
 * With keepFacing, yaw and pitch stay put (they set the face's normal, which the window light was
 * fitted against); only roll and framing move.
 */
export function fitPose(stage: Stage, { keepFacing = false } = {}) {
  const { halfW, halfH, halfT } = params.slab;
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const corner = new THREE.Vector3();
  const facing = { yaw: params.rest.yaw, pitch: params.rest.pitch };
  const apply = ([yaw, pitch, roll, fill, centerY]: number[]) => {
    if (keepFacing) [yaw, pitch] = [facing.yaw, facing.pitch];
    params.camera.fill = fill;
    params.camera.centerY = centerY;
    stage.fitCamera();
    q.setFromEuler(e.set(pitch * DEG, yaw * DEG, roll * DEG, 'YXZ'));
  };
  const error = (x: number[]) => {
    apply(x);
    let sum = 0;
    const corners: [number, number][] = [
      [-halfW, halfH],
      [halfW, halfH],
      [halfW, -halfH],
      [-halfW, -halfH],
    ];
    corners.forEach(([cx, cy], i) => {
      const p = stage.project(corner.set(cx, cy, halfT).applyQuaternion(q));
      sum += (p.x - FACE_CORNERS[i][0]) ** 2 + (p.y - FACE_CORNERS[i][1]) ** 2;
    });
    return sum;
  };
  const r = params.rest;
  const c = params.camera;
  const best = nelderMead(error, [r.yaw, r.pitch, r.roll, c.fill, c.centerY], [5, 5, 4, 0.03, 0.02]);
  apply(best.x);
  if (!keepFacing) [r.yaw, r.pitch] = best.x;
  r.roll = best.x[2];

  // Floor height that puts the shadow's centre where the reference has it.
  let lo = -4;
  let hi = -0.5;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (stage.project(corner.set(0, mid, 0)).y > SHADOW_Y) lo = mid;
    else hi = mid;
  }
  params.shadow.floorY = (lo + hi) / 2;

  const round = (v: number, d = 3) => Number(v.toFixed(d));
  return {
    rest: { yaw: round(r.yaw, 2), pitch: round(r.pitch, 2), roll: round(r.roll, 2) },
    camera: { fill: round(c.fill), centerY: round(c.centerY) },
    floorY: round(params.shadow.floorY),
    rmsPx: round(Math.sqrt(best.error / 4), 2),
  };
}
