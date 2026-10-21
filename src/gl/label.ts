import * as THREE from 'three';

// The cap's "Press" label as a signed distance field, so its edges stay crisp at any angle or zoom.
// The text is rasterised once on a canvas and run through a Euclidean distance transform
// (Felzenszwalb & Huttenlocher, the same approach as Mapbox's tiny-sdf).

export const LABEL_WIDTH = 1024;
export const LABEL_HEIGHT = 256;
/** Distance-field spread in texels: the field ramps from 0 to 1 over ±SPREAD around the edge. */
export const LABEL_SPREAD = 18;

const INF = 1e20;

export function createLabelTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    new Uint8Array(LABEL_WIDTH * LABEL_HEIGHT),
    LABEL_WIDTH,
    LABEL_HEIGHT,
    THREE.RedFormat,
    THREE.UnsignedByteType,
  );
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export interface LabelStyle {
  text: string;
  family: string;
  weight: number;
  /** Text width as a fraction of the label rectangle's width. */
  width: number;
}

/** Draws the label into the texture once the web font is available. */
export async function paintLabel(texture: THREE.DataTexture, style: LabelStyle): Promise<void> {
  const fontAt = (px: number) => `${style.weight} ${px}px "${style.family}", system-ui, sans-serif`;
  try {
    await document.fonts.load(fontAt(100), style.text);
  } catch {
    // Fall back to whatever sans-serif is available.
  }

  const canvas = document.createElement('canvas');
  canvas.width = LABEL_WIDTH;
  canvas.height = LABEL_HEIGHT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  ctx.font = fontAt(100);
  const size = (100 * style.width * LABEL_WIDTH) / ctx.measureText(style.text).width;
  ctx.font = fontAt(size);
  const metrics = ctx.measureText(style.text);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // Centre the ink box vertically (cap height, not the em box).
  const baseline = LABEL_HEIGHT / 2 + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
  ctx.fillText(style.text, LABEL_WIDTH / 2, baseline);

  const pixels = ctx.getImageData(0, 0, LABEL_WIDTH, LABEL_HEIGHT).data;
  const area = LABEL_WIDTH * LABEL_HEIGHT;
  const outer = new Float64Array(area);
  const inner = new Float64Array(area);
  for (let i = 0; i < area; i++) {
    const a = pixels[i * 4 + 3] / 255;
    if (a === 1) {
      outer[i] = 0;
      inner[i] = INF;
    } else if (a === 0) {
      outer[i] = INF;
      inner[i] = 0;
    } else {
      // Sub-pixel edge position from the anti-aliased coverage.
      const d = 0.5 - a;
      outer[i] = d > 0 ? d * d : 0;
      inner[i] = d < 0 ? d * d : 0;
    }
  }
  const longest = Math.max(LABEL_WIDTH, LABEL_HEIGHT);
  const f = new Float64Array(longest);
  const v = new Uint16Array(longest);
  const z = new Float64Array(longest + 1);
  edt(outer, LABEL_WIDTH, LABEL_HEIGHT, f, v, z);
  edt(inner, LABEL_WIDTH, LABEL_HEIGHT, f, v, z);

  const data = texture.image.data as Uint8Array;
  for (let i = 0; i < area; i++) {
    const distance = Math.sqrt(outer[i]) - Math.sqrt(inner[i]); // > 0 outside the glyphs
    const value = 0.5 - distance / (2 * LABEL_SPREAD);
    data[i] = Math.round(Math.min(Math.max(value, 0), 1) * 255);
  }
  texture.needsUpdate = true;
}

function edt(grid: Float64Array, width: number, height: number, f: Float64Array, v: Uint16Array, z: Float64Array) {
  for (let x = 0; x < width; x++) edt1d(grid, x, width, height, f, v, z);
  for (let y = 0; y < height; y++) edt1d(grid, y * width, 1, width, f, v, z);
}

function edt1d(
  grid: Float64Array,
  offset: number,
  stride: number,
  length: number,
  f: Float64Array,
  v: Uint16Array,
  z: Float64Array,
) {
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  f[0] = grid[offset];
  for (let q = 1, k = 0, s = 0; q < length; q++) {
    f[q] = grid[offset + q * stride];
    const q2 = q * q;
    do {
      const r = v[k];
      s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2;
    } while (s <= z[k] && --k > -1);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  for (let q = 0, k = 0; q < length; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k];
    const qr = q - r;
    grid[offset + q * stride] = f[r] + qr * qr;
  }
}
