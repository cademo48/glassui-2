// Scores gradient definitions against the reference's background pixels (same mask as
// fit-gradient.mjs). Usage: node scripts/eval-gradient.mjs '<json array of {name, angle, stops}>'

import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';

const root = path.resolve(import.meta.dirname, '..');
const REF = { x: 172, y: 83, w: 1032, h: 639 };
const img = jpeg.decode(fs.readFileSync(path.join(root, 'dev/reference.jpg')), { useTArray: true });
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
const hexToRgb = (h) => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const oklab = ([r, g, b]) => {
  const [R, G, B] = [r, g, b].map((v) => toLinear(v / 255));
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const aspect = REF.w / REF.h;
function evaluate({ angle, stops }) {
  const a = (angle * Math.PI) / 180;
  const dir = [Math.sin(a), -Math.cos(a)];
  const len = Math.abs(aspect * Math.sin(a)) + Math.abs(Math.cos(a));
  const cols = stops.map((s) => hexToRgb(s.color));
  let se = 0;
  let de = 0;
  let n = 0;
  for (let y = 0; y < REF.h; y += 2) {
    for (let x = 0; x < REF.w; x += 2) {
      if (excluded(x, y)) continue;
      const px = (x / REF.w - 0.5) * aspect;
      const py = y / REF.h - 0.5;
      const t = 0.5 + (px * dir[0] + py * dir[1]) / len;
      let c = cols[0];
      for (let i = 1; i < stops.length; i++) {
        const f = Math.min(Math.max((t - stops[i - 1].at) / Math.max(stops[i].at - stops[i - 1].at, 1e-5), 0), 1);
        c = c.map((v, k) => v + (cols[i][k] - v) * f);
      }
      const i4 = ((REF.y + y) * img.width + (REF.x + x)) * 4;
      const ref = [img.data[i4], img.data[i4 + 1], img.data[i4 + 2]];
      se += (c[0] - ref[0]) ** 2 + (c[1] - ref[1]) ** 2 + (c[2] - ref[2]) ** 2;
      const [p, q] = [oklab(c), oklab(ref)];
      de += 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      n++;
    }
  }
  return { rms255: +Math.sqrt(se / (3 * n)).toFixed(2), meanDeltaE: +(de / n).toFixed(2) };
}
const input = process.argv[2].endsWith('.json') ? fs.readFileSync(process.argv[2], 'utf8') : process.argv[2];
for (const g of JSON.parse(input)) console.log(g.name.padEnd(12), JSON.stringify(evaluate(g)));
