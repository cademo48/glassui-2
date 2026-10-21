export type RGB = [number, number, number];

/** '#rrggbb' → sRGB components in 0..1. */
export function srgb(hex: string): RGB {
  const value = parseInt(hex.replace('#', ''), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** '#rrggbb' → linear-light components. */
export function linear(hex: string): RGB {
  const [r, g, b] = srgb(hex);
  return [toLinear(r), toLinear(g), toLinear(b)];
}
