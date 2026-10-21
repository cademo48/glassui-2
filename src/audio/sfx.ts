// Sound effects, synthesized live with Web Audio (no sound files): sine partials for glass, pitch
// sweeps for thocks and bloops, band-passed noise for clicks and air, through a short synthetic
// reverb and a limiter. The audio graph is built on the first user gesture, as browsers require.

export type SoundName = 'press' | 'latch' | 'release' | 'tick' | 'click' | 'open' | 'close';

interface Graph {
  ctx: BaseAudioContext;
  master: GainNode;
  /** Send into the reverb. */
  send: GainNode;
  noise: AudioBuffer;
}

interface Voice {
  /** How much goes to the reverb. */
  wet?: number;
  /** Stereo position, -1 (left) to 1 (right). */
  pan?: number;
}

const PREF_KEY = 'glass:sound';
const MIN_TICK_GAP = 0.03; // seconds

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writePref(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    // Storage unavailable (private mode); the choice just isn't remembered.
  }
}

function buildGraph(ctx: BaseAudioContext): Graph {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -16;
  limiter.knee.value = 10;
  limiter.ratio.value = 6;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.15;
  limiter.connect(ctx.destination);

  const master = ctx.createGain();
  master.gain.value = 0.7;
  master.connect(limiter);

  // A small, bright room: decaying stereo noise as the impulse response.
  const seconds = 1.2;
  const length = Math.floor(ctx.sampleRate * seconds);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
  }
  const reverb = ctx.createConvolver();
  reverb.buffer = impulse;
  const send = ctx.createGain();
  send.gain.value = 0.35;
  send.connect(reverb);
  reverb.connect(master);

  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;

  return { ctx, master, send, noise };
}

function route(g: Graph, node: AudioNode, { wet = 0, pan = 0 }: Voice) {
  let tail = node;
  if (pan !== 0) {
    const panner = g.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(panner);
    tail = panner;
  }
  tail.connect(g.master);
  if (wet > 0) {
    const amount = g.ctx.createGain();
    amount.gain.value = wet;
    tail.connect(amount);
    amount.connect(g.send);
  }
}

/** Fast attack, exponential decay. */
function envelope(g: Graph, at: number, peak: number, decay: number, attack = 0.003): GainNode {
  const env = g.ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(peak, at + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  return env;
}

/** One oscillator partial, optionally gliding in pitch. */
function tone(
  g: Graph,
  at: number,
  freq: number,
  decay: number,
  peak: number,
  { to, glide, type = 'sine', ...voice }: Voice & { to?: number; glide?: number; type?: OscillatorType } = {},
) {
  const osc = g.ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, at + (glide ?? decay * 0.5));
  const env = envelope(g, at, peak, decay);
  osc.connect(env);
  route(g, env, voice);
  osc.start(at);
  osc.stop(at + decay + 0.05);
}

/** A burst of band-passed noise, optionally sweeping its band. */
function hiss(
  g: Graph,
  at: number,
  length: number,
  peak: number,
  freq: number,
  q: number,
  { to, ...voice }: Voice & { to?: number } = {},
) {
  const src = g.ctx.createBufferSource();
  src.buffer = g.noise;
  const band = g.ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = q;
  band.frequency.setValueAtTime(freq, at);
  if (to) band.frequency.exponentialRampToValueAtTime(to, at + length);
  const env = envelope(g, at, peak, length, Math.min(0.004, length * 0.3));
  src.connect(band);
  band.connect(env);
  route(g, env, voice);
  src.start(at, Math.random() * 0.5);
  src.stop(at + length + 0.02);
}

/** An airy sweep for the frosted cards sliding in and out. */
function swoosh(g: Graph, at: number, from: number, to: number) {
  const src = g.ctx.createBufferSource();
  src.buffer = g.noise;
  const band = g.ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 0.9;
  band.frequency.setValueAtTime(from, at);
  band.frequency.exponentialRampToValueAtTime(to, at + 0.26);
  const env = g.ctx.createGain();
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(0.085, at + 0.07);
  env.gain.linearRampToValueAtTime(0, at + 0.28);
  src.connect(band);
  band.connect(env);
  route(g, env, { wet: 0.45 });
  src.start(at, Math.random() * 0.5);
  src.stop(at + 0.3);
}

const D6 = 1174.66;
const G6 = 1567.98;
const D7 = 2349.32;

const recipes: Record<SoundName, (g: Graph, at: number, pan: number) => void> = {
  /** The cap bottoming out in the glass: a soft thock, a knock, and the ring of struck glass. */
  press(g, t) {
    tone(g, t, 150, 0.16, 0.5, { to: 68, glide: 0.06 });
    tone(g, t, 420, 0.05, 0.12, { to: 300, type: 'triangle' });
    hiss(g, t, 0.025, 0.32, 2600, 0.8);
    tone(g, t + 0.004, 2380, 0.32, 0.06, { wet: 0.6 });
    tone(g, t + 0.004, 3610, 0.22, 0.035, { wet: 0.6 });
    tone(g, t + 0.004, 5950, 0.12, 0.015, { wet: 0.4 });
  },
  /** Setting into the latch: a click-clack, then a falling glass chime. */
  latch(g, t) {
    hiss(g, t, 0.012, 0.26, 5200, 2.5);
    hiss(g, t + 0.048, 0.016, 0.3, 3900, 2);
    tone(g, t + 0.048, 125, 0.1, 0.3, { to: 95 });
    tone(g, t + 0.06, G6, 0.55, 0.05, { wet: 0.8 });
    tone(g, t + 0.06, G6 * 2.76, 0.25, 0.01, { wet: 0.8 });
    tone(g, t + 0.12, D6, 0.85, 0.055, { wet: 0.9 });
    tone(g, t + 0.12, D6 * 2.76, 0.35, 0.012, { wet: 0.9 });
  },
  /** Releasing: the cap pops back up with a bloop and a rising shimmer. */
  release(g, t) {
    tone(g, t, 240, 0.14, 0.36, { to: 760, glide: 0.08 });
    hiss(g, t, 0.07, 0.07, 1500, 0.7, { to: 4200 });
    tone(g, t + 0.035, D6, 0.5, 0.04, { wet: 0.8 });
    tone(g, t + 0.075, G6, 0.5, 0.04, { wet: 0.8 });
    tone(g, t + 0.115, D7, 0.75, 0.035, { wet: 0.9 });
  },
  /** A detent on the turntable. */
  tick(g, t, pan) {
    hiss(g, t, 0.006, 0.16, 4800, 3, { pan });
    tone(g, t, 3100, 0.03, 0.035, { pan });
  },
  /** A small UI button. */
  click(g, t) {
    hiss(g, t, 0.012, 0.2, 3200, 1.2);
    tone(g, t, 1300, 0.05, 0.04);
  },
  open(g, t) {
    swoosh(g, t, 600, 2400);
    tone(g, t + 0.08, 2637, 0.4, 0.012, { wet: 0.9 });
  },
  close(g, t) {
    swoosh(g, t, 2400, 600);
  },
};

export class Sfx {
  enabled = readPref();
  private graph: Graph | null = null;
  private lastTick = -Infinity;

  /** Builds or resumes the audio graph. Call from inside a user gesture. */
  unlock() {
    if (!this.enabled) return;
    try {
      if (!this.graph) this.graph = buildGraph(new AudioContext({ latencyHint: 'interactive' }));
      const ctx = this.graph.ctx as AudioContext;
      if (ctx.state === 'suspended') void ctx.resume();
    } catch {
      // No Web Audio here; stay silent.
    }
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    writePref(on);
    if (on) this.unlock();
    else if (this.graph) void (this.graph.ctx as AudioContext).suspend().catch(() => {});
  }

  play(name: SoundName, pan = 0) {
    const g = this.graph;
    if (!this.enabled || !g) return;
    try {
      recipes[name](g, g.ctx.currentTime + 0.005, pan);
    } catch {
      // A sound failing to schedule must never break the interaction.
    }
  }

  /** A turntable detent, rate-limited so fast spins don't turn into a buzz. */
  tick(pan: number) {
    const g = this.graph;
    if (!g || g.ctx.currentTime - this.lastTick < MIN_TICK_GAP) return;
    this.lastTick = g.ctx.currentTime;
    this.play('tick', pan);
  }

  /** Renders one sound offline (for testing levels without speakers). */
  static async render(name: SoundName, seconds = 1.5): Promise<AudioBuffer> {
    const ctx = new OfflineAudioContext(2, Math.ceil(44100 * seconds), 44100);
    recipes[name](buildGraph(ctx), 0.02, 0);
    return ctx.startRendering();
  }
}
