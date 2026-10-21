// Compares canvas captures (review/captures/*.png, written by the dev server in ?capture mode) with
// the reference design (dev/reference.jpg). Writes, into review/out/:
//   <name>-side.png   reference | render | ×4 difference heatmap
//   <name>-zoom.png   the glass region of both at 2×, side by side
//   poses.png         contact sheet of every capture (other poses have no reference)
//   metrics.json      OKLab ΔE (×100) at named sample points and over regions
// Usage: node scripts/compare.mjs [captureName=rest]

import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

const root = path.resolve(import.meta.dirname, '..');
const captureDir = path.join(root, 'review/captures');
const outDir = path.join(root, 'review/out');
/** The browser content area inside the 1376×768 reference screenshot. */
const REF = { file: path.join(root, 'dev/reference.jpg'), x: 172, y: 83, w: 1032, h: 639 };
/** Glass region (content coordinates) for the zoomed comparison. */
const GLASS = { x: 300, y: 90, w: 440, h: 470 };
/** Detail regions (content coordinates: x, y, w, h) for 3× close-ups. */
const DETAILS = {
  cap: [430, 225, 200, 120],
  'rim-left': [318, 110, 110, 380],
  'rim-bottom': [400, 410, 330, 90],
  'rim-top-right': [560, 95, 160, 190],
  shadow: [338, 455, 380, 80],
};

// Named sample points, content coordinates (measured on the reference).
const POINTS = {
  face_top_left: [388, 177],
  face_top: [468, 157],
  face_upper_right: [548, 147],
  face_right: [588, 217],
  face_left_mid: [408, 337],
  face_lower_left: [448, 417],
  face_lower_mid: [528, 397],
  face_bottom_right: [588, 437],
  cap_top: [528, 262],
  cap_left: [468, 277],
  cap_bottom: [518, 312],
  cap_right: [578, 297],
  rim_left: [343, 217],
  rim_bottom: [448, 482],
  rim_top: [588, 112],
  rim_right: [673, 387],
  shadow_core: [528, 507],
  shadow_left: [478, 512],
  shadow_edge_left: [408, 517],
  shadow_edge_right: [648, 497],
  bg_top_left: [18, 17],
  bg_left: [78, 317],
  bg_right: [978, 367],
  bg_top_right: [1008, 17],
  bg_bottom_left: [278, 567],
  bg_bottom_right: [1008, 617],
  bg_left_of_glass: [278, 267],
  bg_right_of_glass: [778, 317],
};

// Reference slab outline (virtual corners of the front face) and shadow ellipse, content coordinates.
const SLAB = [
  [340, 130],
  [607, 111],
  [706, 426],
  [421, 469],
];
const SHADOW = { cx: 528, cy: 507, rx: 125, ry: 20 };

// ---- image helpers ---------------------------------------------------------------------------

const readJpeg = (file) => {
  const d = jpeg.decode(fs.readFileSync(file), { useTArray: true });
  return { width: d.width, height: d.height, data: d.data };
};
const readPng = (file) => {
  const p = PNG.sync.read(fs.readFileSync(file));
  return { width: p.width, height: p.height, data: p.data };
};
const writePng = (file, img) => {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  fs.writeFileSync(file, PNG.sync.write(png));
};
const blank = (width, height, rgb = [24, 24, 24]) => {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...rgb, 255], i * 4);
  return { width, height, data };
};
const crop = (img, x, y, w, h) => {
  const out = blank(w, h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const sx = Math.min(Math.max(x + i, 0), img.width - 1);
      const sy = Math.min(Math.max(y + j, 0), img.height - 1);
      out.data.set(img.data.subarray((sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4), (j * w + i) * 4);
    }
  }
  return out;
};
const resize = (img, w, h) => {
  const out = blank(w, h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const fx = ((i + 0.5) * img.width) / w - 0.5;
      const fy = ((j + 0.5) * img.height) / h - 0.5;
      const x0 = Math.max(Math.floor(fx), 0);
      const y0 = Math.max(Math.floor(fy), 0);
      const x1 = Math.min(x0 + 1, img.width - 1);
      const y1 = Math.min(y0 + 1, img.height - 1);
      const tx = Math.min(Math.max(fx - x0, 0), 1);
      const ty = Math.min(Math.max(fy - y0, 0), 1);
      for (let c = 0; c < 4; c++) {
        const a = img.data[(y0 * img.width + x0) * 4 + c];
        const b = img.data[(y0 * img.width + x1) * 4 + c];
        const d = img.data[(y1 * img.width + x0) * 4 + c];
        const e = img.data[(y1 * img.width + x1) * 4 + c];
        out.data[(j * w + i) * 4 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
      }
    }
  }
  return out;
};
const place = (dst, src, x, y) => {
  for (let j = 0; j < src.height; j++) {
    const row = src.data.subarray(j * src.width * 4, (j + 1) * src.width * 4);
    dst.data.set(row, ((y + j) * dst.width + x) * 4);
  }
};
const hstack = (images, gap = 8) => {
  const width = images.reduce((s, i) => s + i.width, 0) + gap * (images.length - 1);
  const height = Math.max(...images.map((i) => i.height));
  const out = blank(width, height);
  let x = 0;
  for (const img of images) {
    place(out, img, x, 0);
    x += img.width + gap;
  }
  return out;
};

// ---- colour ------------------------------------------------------------------------------------

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function oklab([r, g, b]) {
  const [R, G, B] = [r, g, b].map((v) => toLinear(v / 255));
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
const deltaE = (a, b) => {
  const [x, y] = [oklab(a), oklab(b)];
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};
const pixel = (img, x, y) => {
  const i = (Math.round(y) * img.width + Math.round(x)) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
const average = (img, x, y, r = 2) => {
  const acc = [0, 0, 0];
  let n = 0;
  for (let j = -r; j <= r; j++) {
    for (let i = -r; i <= r; i++) {
      const p = pixel(img, Math.min(Math.max(x + i, 0), img.width - 1), Math.min(Math.max(y + j, 0), img.height - 1));
      acc[0] += p[0];
      acc[1] += p[1];
      acc[2] += p[2];
      n++;
    }
  }
  return acc.map((v) => v / n);
};
const hex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

// ---- regions -----------------------------------------------------------------------------------

const insidePolygon = (poly, x, y) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const scalePolygon = (poly, k) => {
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return poly.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
};
const inEllipse = (e, x, y, k = 1) => ((x - e.cx) / (e.rx * k)) ** 2 + ((y - e.cy) / (e.ry * k)) ** 2 < 1;

function regionStats(ref, render) {
  const body = scalePolygon(SLAB, 0.86);
  const outer = scalePolygon(SLAB, 1.18);
  const sums = { glass: [0, 0], shadow: [0, 0], background: [0, 0] };
  for (let y = 0; y < REF.h; y += 2) {
    for (let x = 0; x < REF.w; x += 2) {
      let region = null;
      if (insidePolygon(body, x, y)) region = 'glass';
      else if (inEllipse(SHADOW, x, y)) region = 'shadow';
      else if (!insidePolygon(outer, x, y) && !inEllipse(SHADOW, x, y, 1.6) && y > 50 && !(y > 540 && x > 380 && x < 650)) region = 'background';
      if (!region) continue;
      sums[region][0] += deltaE(pixel(ref, x, y), pixel(render, x, y));
      sums[region][1]++;
    }
  }
  return Object.fromEntries(Object.entries(sums).map(([k, [s, n]]) => [k, +(s / Math.max(n, 1)).toFixed(2)]));
}

// ---- main ----------------------------------------------------------------------------------------

const name = process.argv[2] ?? 'rest';
fs.mkdirSync(outDir, { recursive: true });
const reference = crop(readJpeg(REF.file), REF.x, REF.y, REF.w, REF.h);
writePng(path.join(outDir, 'reference.png'), reference);

const capturePath = path.join(captureDir, `${name}.png`);
if (!fs.existsSync(capturePath)) {
  console.error(`No capture at ${capturePath}`);
  process.exit(1);
}
let render = readPng(capturePath);
if (render.width !== REF.w || render.height !== REF.h) render = resize(render, REF.w, REF.h);

// Difference heatmap: |Δ| per channel, ×4.
const heat = blank(REF.w, REF.h);
for (let i = 0; i < REF.w * REF.h; i++) {
  for (let c = 0; c < 3; c++) heat.data[i * 4 + c] = Math.min(255, Math.abs(reference.data[i * 4 + c] - render.data[i * 4 + c]) * 4);
}
writePng(path.join(outDir, `${name}-side.png`), hstack([reference, render, heat]));

const zoom = (img) => resize(crop(img, GLASS.x, GLASS.y, GLASS.w, GLASS.h), GLASS.w * 2, GLASS.h * 2);
writePng(path.join(outDir, `${name}-zoom.png`), hstack([zoom(reference), zoom(render)]));

// Close-ups of the details that make or break the glass: reference on top, render below, 3×.
const vstack = (images, gap = 8) => {
  const width = Math.max(...images.map((i) => i.width));
  const height = images.reduce((s, i) => s + i.height, 0) + gap * (images.length - 1);
  const out = blank(width, height);
  let y = 0;
  for (const img of images) {
    place(out, img, 0, y);
    y += img.height + gap;
  }
  return out;
};
for (const [region, [x, y, w, h]] of Object.entries(DETAILS)) {
  const close = (img) => resize(crop(img, x, y, w, h), w * 3, h * 3);
  writePng(path.join(outDir, `${name}-detail-${region}.png`), vstack([close(reference), close(render)]));
}

// Contact sheet of every capture at half size.
const captures = fs.readdirSync(captureDir).filter((f) => f.endsWith('.png')).sort();
const thumbs = captures.map((f) => {
  let img = readPng(path.join(captureDir, f));
  if (img.width !== REF.w || img.height !== REF.h) img = resize(img, REF.w, REF.h);
  return resize(img, REF.w / 2, Math.round(REF.h / 2));
});
if (thumbs.length) {
  const columns = Math.min(3, thumbs.length);
  const rows = Math.ceil(thumbs.length / columns);
  const tw = thumbs[0].width;
  const th = thumbs[0].height;
  const sheet = blank(columns * tw + (columns - 1) * 8, rows * th + (rows - 1) * 8);
  thumbs.forEach((t, i) => place(sheet, t, (i % columns) * (tw + 8), Math.floor(i / columns) * (th + 8)));
  writePng(path.join(outDir, 'poses.png'), sheet);
}

const points = {};
for (const [key, [x, y]] of Object.entries(POINTS)) {
  const a = average(reference, x, y);
  const b = average(render, x, y);
  points[key] = { ref: hex(a), render: hex(b), dE: +deltaE(a, b).toFixed(2) };
}
const regions = regionStats(reference, render);
const metrics = { capture: name, captures, regions, points };
fs.writeFileSync(path.join(outDir, `metrics-${name}.json`), JSON.stringify(metrics, null, 2));

console.log(`capture: ${name}   regions ΔE: ${JSON.stringify(regions)}`);
for (const [key, v] of Object.entries(points)) {
  console.log(`${key.padEnd(20)} ref ${v.ref}  render ${v.render}  ΔE ${v.dE.toFixed(1).padStart(5)}`);
}
