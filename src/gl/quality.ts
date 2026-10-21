// Steps rendering cost down when frames run long: first the pixel ratio, then the number of internal
// bounces and march steps. The limits are uniforms inside fixed loop bounds, so a change never
// recompiles a shader. It only steps down: a 60 Hz display can't show spare headroom to climb back.

export interface QualityTier {
  dpr: number;
  bounces: number;
  steps: number;
  /** Sub-pixel rays averaged on the rounded rims. */
  rimSamples: number;
}

export const QUALITY_TIERS: QualityTier[] = [
  { dpr: 2, bounces: 5, steps: 96, rimSamples: 4 },
  { dpr: 1.5, bounces: 5, steps: 80, rimSamples: 4 },
  { dpr: 1.25, bounces: 4, steps: 64, rimSamples: 2 },
  { dpr: 1, bounces: 4, steps: 48, rimSamples: 2 },
  { dpr: 1, bounces: 3, steps: 32, rimSamples: 1 },
];

const SLOW_MS = 21;
const SLOW_FOR_MS = 900;
const WARMUP_MS = 1500;

export class QualityGovernor {
  tier = 0;
  averageMs = 16.7;
  private elapsed = 0;
  private slowFor = 0;

  /** Feeds one frame time; returns true when the tier changed. */
  sample(frameMs: number): boolean {
    this.elapsed += frameMs;
    if (this.elapsed < WARMUP_MS || frameMs > 250) return false;
    this.averageMs += (frameMs - this.averageMs) * 0.1;
    this.slowFor = this.averageMs > SLOW_MS ? this.slowFor + frameMs : 0;
    if (this.slowFor > SLOW_FOR_MS && this.tier < QUALITY_TIERS.length - 1) {
      this.tier++;
      this.slowFor = 0;
      this.averageMs = 16.7;
      return true;
    }
    return false;
  }
}
