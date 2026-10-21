// Fits the page gradient (CSS-style angle + sRGB stops) to the reference's background pixels.
// For each candidate angle, pixels are binned by their position along the gradient line; the bin
// means are the best profile for that angle and the spread within bins is the error. The best angle's
// profile is then reduced to a handful of stops by greedy line simplification.
// Usage: node scripts/fit-gradient.mjs

import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';

const root = path.resolve(import.meta.dirname, '..');
const REF = { x: 172, y: 83, w: 1032, h: 639 };
const img = jpeg.decode(fs.readFileSync(path.join(root, 'dev/reference.jpg')), { useTArray: true });

// Exclude the slab (with margin), its shadow, the nav and the ring/caption.
const SLAB = [
  [300, 85],
  [650, 70],
  [760, 450],
  [400, 515],
];
const inside = (poly, x, y) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
const excluded = (x, y) =>
  inside(SLAB, x, y) ||
  ((x - 528) / 190) ** 2 + ((y - 507) / 40) ** 2 < 1 ||
  (y < 48 && x > 400 && x < 640) ||
  (y > 535 && x > 400 && x < 640);

const samples = [];
for (let y = 0; y < REF.h; y += 3) {
  for (let x = 0; x < REF.w; x += 3) {
    if (excluded(x, y)) continue;
    const i = ((REF.y + y) * img.width + (REF.x + x)) * 4;
    samples.push([x, y, img.data[i] / 255, img.data[i + 1] / 255, img.data[i + 2] / 255]);
  }
}

const aspect = REF.w / REF.h;
const BINS = 80;
function profile(angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  const dir = [Math.sin(a), -Math.cos(a)];
  const len = Math.abs(aspect * Math.sin(a)) + Math.abs(Math.cos(a));
  const sum = Array.from({ length: BINS }, () => [0, 0, 0, 0, 0, 0, 0]);
  const ts = samples.map(([x, y, r, g, b]) => {
    const px = (x / REF.w - 0.5) * aspect;
    const py = y / REF.h - 0.5;
    const t = Math.min(Math.max(0.5 + (px * dir[0] + py * dir[1]) / len, 0), 0.9999);
    const k = Math.floor(t * BINS);
    const s = sum[k];
    s[0] += r;
    s[1] += g;
    s[2] += b;
    s[3] += r * r + g * g + b * b;
    s[4]++;
    s[5] += t;
    return t;
  });
  let error = 0;
  const means = sum.map((s) => {
    if (!s[4]) return null;
    const m = [s[0] / s[4], s[1] / s[4], s[2] / s[4]];
    error += s[3] - s[4] * (m[0] ** 2 + m[1] ** 2 + m[2] ** 2);
    return { t: s[5] / s[4], c: m, n: s[4] };
  });
  return { error: error / ts.length, means: means.filter(Boolean) };
}

let best = null;
for (let angle = 100; angle <= 150; angle += 0.5) {
  const p = profile(angle);
  if (!best || p.error < best.error) best = { angle, ...p };
}

// Reduce the binned profile to stops: keep endpoints, then repeatedly add the bin farthest from the
// current piecewise-linear interpolation until within tolerance.
const pts = best.means;
const keep = new Set([0, pts.length - 1]);
const lerpAt = (i) => {
  const ks = [...keep].sort((a, b) => a - b);
  let lo = ks[0];
  let hi = ks[ks.length - 1];
  for (const k of ks) {
    if (k <= i) lo = k;
    if (k >= i) {
      hi = k;
      break;
    }
  }
  if (lo === hi) return pts[lo].c;
  const f = (pts[i].t - pts[lo].t) / (pts[hi].t - pts[lo].t);
  return pts[lo].c.map((v, c) => v + (pts[hi].c[c] - v) * f);
};
for (let round = 0; round < 6; round++) {
  let worst = -1;
  let worstErr = 0;
  pts.forEach((p, i) => {
    const e = Math.hypot(...p.c.map((v, c) => v - lerpAt(i)[c]));
    if (e > worstErr) {
      worstErr = e;
      worst = i;
    }
  });
  if (worstErr < 0.008) break;
  keep.add(worst);
}
const hex = (c) => '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
const stops = [...keep]
  .sort((a, b) => a - b)
  .map((i) => ({ color: hex(pts[i].c), at: Number(pts[i].t.toFixed(3)) }));
stops[0].at = 0;
stops[stops.length - 1].at = 1;
console.log(JSON.stringify({ angle: best.angle, rmsWithinBins: Math.sqrt(best.error).toFixed(4), stops }, null, 2));
