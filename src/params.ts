// Every tunable in one place. The ?debug panel edits this object live and the stage reads it every
// frame. Colours are sRGB hex, angles are degrees, lengths are scene units (the slab is about 2 wide).

export interface RectLight {
  name: string;
  /** Degrees around the vertical axis: 0 = toward the camera, 90 = to the right. */
  az: number;
  /** Degrees above the horizon. */
  el: number;
  /** Degrees the rectangle is spun about its own axis. */
  roll: number;
  /** Half extents on the light's tangent plane (tan of the half-angle). */
  w: number;
  h: number;
  /** Corner rounding as a fraction of the smaller half extent. */
  round: number;
  /** Edge softness on the tangent plane. */
  soft: number;
  /** Extra softness along the light's height only (a box that fades out one way); 0 = off. */
  softY: number;
  color: string;
  intensity: number;
}

export const params = {
  camera: {
    fov: 28,
    /** Fraction of the half-height the slab's projected radius fills (landscape). */
    fill: 0.637,
    /** Fraction of the half-width it fills on portrait screens. */
    fillPortrait: 0.8,
    /** Where the slab centre sits, as a fraction of the height from the top. */
    centerY: 0.453,
    /** Projected radius of the slab used for framing. */
    extent: 1.32,
  },
  /** The pose of the reference image (fitted to its face outline); the turntable rotates on top of it. */
  rest: { yaw: 20.38, pitch: -23.65, roll: 8.8 },
  slab: { halfW: 1.0, halfH: 1.18, corner: 0.24, halfT: 0.2, edge: 0.05 },
  /** The bore the cap sits in: a tight seam around the cap, deep enough for the cap to sink into. */
  well: { clearance: 0.015, depth: 0.085, lip: 0.008 },
  pill: {
    halfW: 0.54,
    halfH: 0.205,
    /** Offset of the button on the face: a touch left of centre, and a little below. */
    x: -0.03,
    y: -0.065,
    /** Half thickness: at rest the cap reaches down to the bore's floor. */
    halfT: 0.077,
    edge: 0.02,
    dome: 0.04,
    /** Height of the cap's top above the face at rest. */
    rise: 0.065,
    /** How far the cap travels when pressed: its crown ends below the face. */
    travel: 0.125,
    fillet: 0.012,
  },
  glass: {
    ior: 1.5,
    /** The cap's surface is glossier, as if high-index glass. */
    capIor: 1.9,
    dispersion: 0.014,
    /** Colour of white light after one unit of glass, and how strongly it applies. */
    tint: '#b4e2de',
    tintDensity: 0.18,
    bounces: 5,
    steps: 96,
    /** Width of the polished border around the sand-blasted face. */
    frostInset: 0.05,
    frostLod: 2.4,
    frostGloss: 0.003,
    grain: 0.05,
    /** Brightness grain of the sand-blasting (fainter where the face is milky). */
    grainLight: 0.14,
    noiseScale: 1.0,
    haze: 0.38,
    hazeShade: '#a0aee1',
    hazeLight: '#efeff9',
    pillHaze: 0.3,
    /** Where the backdrop sits behind the slab; sets how far refraction shifts it. */
    wallZ: -2.6,
    /**
     * The page is a backdrop in the line of sight: rays leaving the glass within the inner angle of the
     * view direction see it, past the outer angle they see the studio (degrees).
     */
    pageCone: [6, 14] as [number, number],
    keyAz: -40,
    keyEl: 45,
  },
  /** dx, dy offset the label from the cap's centre (it sits a little left and low, under the gloss band). */
  label: { text: 'Press', ink: '#283240', weight: 470, width: 0.49, dx: -0.035, dy: -0.042 },
  env: {
    zenith: '#eef5fb',
    horizon: '#8fa5b8',
    ground: '#26323d',
    lights: [
      // A big window up and to the left, placed by fitting its reflection on the face to the
      // reference: one crisp, steep edge above the button, fading out downward.
      { name: 'window', az: -48.2, el: 42.5, roll: 51.8, w: 2.145, h: 0.42, round: 0.15, soft: 0.004, softY: 0.28, color: '#ffffff', intensity: 1.75 },
      { name: 'top', az: 0, el: 78, roll: 0, w: 1.4, h: 0.14, round: 0.5, soft: 0.08, softY: 0, color: '#ffffff', intensity: 2 },
      // Off: it only caught the slab's top rim where the reference is dark.
      { name: 'spark', az: 75, el: 55, roll: 0, w: 0.06, h: 0.06, round: 1, soft: 0.02, softY: 0, color: '#ffffff', intensity: 0 },
      // A dim strip on the horizon behind the slab: the thin bright lines just inside the silhouette.
      { name: 'horizon', az: 172, el: 2, roll: 0, w: 1.2, h: 0.05, round: 0.5, soft: 0.05, softY: 0, color: '#ffffff', intensity: 0.3 },
    ] as RectLight[],
  },
  /**
   * The floor shadow: the slab's footprint cast along the key light (the window) as an oriented
   * Gaussian, so it tilts, stretches and narrows with every pose, blended toward a deep teal.
   */
  shadow: {
    floorY: -1.41,
    /** The light the shadow is cast along (the window). */
    lightAz: -48.2,
    lightEl: 42.5,
    /** Shift of the shadow's centre on the floor (world x, z). */
    offsetX: 0.19,
    offsetZ: -0.015,
    /** How much of the footprint's spread the shadow keeps, and its blur (sigma, scene units). */
    spread: 0.67,
    blur: 0.2,
    strength: 0.965,
    color: '#006473',
  },
  /** Fitted to the reference's background pixels (mean ΔE 0.48; see scripts/eval-gradient.mjs). */
  backdrop: {
    angle: 127.2,
    stops: [
      { color: '#4f69bf', at: 0 },
      { color: '#5b77b9', at: 0.172 },
      { color: '#82c9c6', at: 0.436 },
      { color: '#89d3cd', at: 0.536 },
      { color: '#99ccdc', at: 0.641 },
      { color: '#acbff6', at: 0.808 },
      { color: '#abbff7', at: 1 },
    ],
  },
  motion: {
    idleFloat: true,
    floatAmp: 0.028,
    floatPeriod: 5.6,
    dragGain: 0.0085,
    pitchLimit: 75,
  },
  quality: { maxDpr: 2, lock: -1 },
  /**
   * 0 = off, 1 = normals, 2 = first exit direction, 3 = inside march effort, 4 = first wall normal,
   * 5 = first wall Fresnel, 6 = reflection only, 7 = transmission only.
   */
  debug: { view: 0 },
};

export type Params = typeof params;
