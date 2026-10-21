// Steps rendering cost down when frames run long: first the internal bounces, march steps and rim
// samples, then the pixel ratio, since a lower pixel ratio is what makes the glass look soft. The
// limits are uniforms inside fixed loop bounds, so a change never recompiles a shader.
//
// Long frames don't always mean the GPU is struggling: Safari caps pages at 30 fps in Low Power Mode,
// and some displays refresh slower than 60 Hz. So each step down is a trial. If the next second of
// frames isn't clearly faster, the step bought nothing: it is undone and the governor stops there.

export interface QualityTier {
  dpr: number;
  bounces: number;
  steps: number;
  /** Sub-pixel rays averaged on the rounded rims. */
  rimSamples: number;
}

export const QUALITY_TIERS: QualityTier[] = [
  { dpr: 2, bounces: 5, steps: 96, rimSamples: 4 },
  { dpr: 2, bounces: 4, steps: 64, rimSamples: 2 },
  { dpr: 1.5, bounces: 4, steps: 64, rimSamples: 2 },
  { dpr: 1.25, bounces: 4, steps: 48, rimSamples: 1 },
  { dpr: 1, bounces: 3, steps: 32, rimSamples: 1 },
];

const SLOW_MS = 21;
const SLOW_FOR_MS = 900;
const WARMUP_MS = 1500;
/** A single frame counts for at most this long, so one hitch (a GC pause, a tab switch) can't drop a tier. */
const FRAME_CAP_MS = 500;
/** After a step down: frames to let pass (the resize settles), then how long to measure. */
const TRIAL_SETTLE_MS = 300;
const TRIAL_MS = 1000;
/** A step must cut the frame time by at least this share to be kept. */
const TRIAL_MIN_GAIN = 0.1;

interface Trial {
  beforeMs: number;
  settle: number;
  sum: number;
  count: number;
}

export class QualityGovernor {
  tier = 0;
  averageMs = 16.7;
  /** Set once a step down didn't help: frame time is then capped by something other than the GPU. */
  settled = false;
  private elapsed = 0;
  private slowFor = 0;
  private slowSum = 0;
  private slowCount = 0;
  private trial: Trial | null = null;
  private skipNext = false;

  /** Ignores the next frame: the gap after the tab was hidden isn't render time. */
  resume() {
    this.skipNext = true;
  }

  /** Feeds one frame time; returns true when the tier changed. */
  sample(frameMs: number): boolean {
    if (this.skipNext) {
      this.skipNext = false;
      return false;
    }
    this.elapsed += frameMs;
    if (this.elapsed < WARMUP_MS) return false;
    // Long frames still count (capped): a GPU that takes 300 ms a frame is exactly the one to step down.
    const ms = Math.min(frameMs, FRAME_CAP_MS);
    this.averageMs += (ms - this.averageMs) * 0.1;

    if (this.trial) return this.judgeTrial(this.trial, ms);
    if (this.settled) return false;

    if (this.averageMs > SLOW_MS) {
      this.slowFor += ms;
      this.slowSum += ms;
      this.slowCount++;
    } else {
      this.slowFor = this.slowSum = this.slowCount = 0;
    }
    if (this.slowFor > SLOW_FOR_MS && this.tier < QUALITY_TIERS.length - 1) {
      this.trial = { beforeMs: this.slowSum / this.slowCount, settle: 0, sum: 0, count: 0 };
      this.slowFor = this.slowSum = this.slowCount = 0;
      this.tier++;
      return true;
    }
    return false;
  }

  private judgeTrial(trial: Trial, ms: number): boolean {
    if (trial.settle < TRIAL_SETTLE_MS) {
      trial.settle += ms;
      return false;
    }
    trial.sum += ms;
    trial.count++;
    if (trial.sum < TRIAL_MS) return false;
    this.trial = null;
    if (trial.sum / trial.count > trial.beforeMs * (1 - TRIAL_MIN_GAIN)) {
      this.tier--;
      this.settled = true;
      return true;
    }
    return false;
  }
}
