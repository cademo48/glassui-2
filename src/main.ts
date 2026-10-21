import '@fontsource-variable/inter';
import './styles.css';
import * as THREE from 'three';
import { Sfx } from './audio/sfx';
import { QualityGovernor } from './gl/quality';
import { Stage, type Pose } from './gl/stage';
import { bindPointer } from './interaction/pointer';
import { bindPressProxy, LatchingButton, PressSpring } from './interaction/press';
import { Turntable } from './interaction/turntable';
import { params } from './params';
import { bindCards } from './ui/cards';
import { QualityMenu, readQualityPref } from './ui/quality-menu';
import { Ring } from './ui/ring';

const DEG = Math.PI / 180;
const STEP = 45 * DEG;
/** The turntable ticks every this many radians as it turns. */
const DETENT = 15 * DEG;
/** Capture mode renders at the reference's content size, for side-by-side comparison. */
const CAPTURE_SIZE = { width: 1032, height: 639 };
const CAPTURE_POSES: Record<string, [yaw: number, pitch: number]> = {
  rest: [0, 0],
  yaw45: [45, 0],
  back: [180, 0],
  tilt: [0, 55],
  edge: [80, 0],
};

const $ = <T extends Element = HTMLElement>(id: string) => document.getElementById(id) as unknown as T;
const query = new URLSearchParams(location.search);
const captureMode = import.meta.env.DEV && query.has('capture');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const root = document.documentElement;

function showFallback() {
  root.classList.add('no-webgl');
  $('fallback').hidden = false;
}

/** The speaker button: sound on or off, remembered between visits. */
function bindSoundToggle(sfx: Sfx) {
  const toggle = $<HTMLButtonElement>('soundToggle');
  const show = () => {
    toggle.setAttribute('aria-pressed', String(sfx.enabled));
    toggle.title = sfx.enabled ? 'Sound on' : 'Sound off';
  };
  toggle.addEventListener('click', () => {
    sfx.setEnabled(!sfx.enabled);
    show();
    sfx.play('click');
  });
  show();
}

function boot() {
  const canvas = $<HTMLCanvasElement>('stage');
  const sfx = new Sfx();
  // Browsers only allow audio to start inside a user gesture: build it on the first one.
  for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, () => sfx.unlock(), true);
  bindSoundToggle(sfx);

  // The nav cards work with or without the live glass; Home also turns the slab back once it exists.
  let home = () => {};
  bindCards(
    () => home(),
    (open) => sfx.play(open ? 'open' : 'close'),
  );

  let stage: Stage;
  try {
    if (import.meta.env.DEV && query.has('nowebgl')) throw new Error('WebGL disabled for testing (?nowebgl)');
    stage = new Stage(canvas, { preserveDrawingBuffer: captureMode });
  } catch (error) {
    console.error(error);
    showFallback();
    return;
  }

  const turntable = new Turntable(params.motion.pitchLimit * DEG);
  const press = new PressSpring();
  const governor = new QualityGovernor();
  const qualityPref = readQualityPref();
  if (qualityPref !== null) {
    governor.choose(qualityPref);
    stage.qualityTier = governor.tier;
  }
  const restQuaternion = new THREE.Quaternion();
  const restEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const pose: Pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), press: 0, focus: 0 };
  let focusVisible = false;

  if (captureMode) {
    const setPose = (name: string, pressed = 0) => {
      const [yaw, pitch] = CAPTURE_POSES[name] ?? CAPTURE_POSES.rest;
      turntable.yaw = yaw * DEG;
      turntable.pitch = pitch * DEG;
      press.target = press.value = pressed;
    };
    setPose(query.get('pose') ?? 'rest', Number(query.get('press') ?? 0));
    Object.assign(window, { __setPose: setPose, __poses: Object.keys(CAPTURE_POSES) });
  }

  // ---- Layout --------------------------------------------------------------------------------

  const controls = $('controls');
  const floorPoint = new THREE.Vector3();
  function layout() {
    if (captureMode) {
      canvas.style.width = `${CAPTURE_SIZE.width}px`;
      canvas.style.height = `${CAPTURE_SIZE.height}px`;
      stage.setSize(CAPTURE_SIZE.width, CAPTURE_SIZE.height, 1);
    } else {
      stage.setSize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
    }
    // Seat the ring just under the slab's shadow.
    const shadow = stage.project(floorPoint.set(0, params.shadow.floorY, 0));
    const top = Math.min(shadow.y + 33, stage.cssHeight - 96);
    controls.style.setProperty('--controls-top', `${Math.round(top)}px`);
  }
  layout();
  window.addEventListener('resize', layout);

  // ---- Input ---------------------------------------------------------------------------------

  // The button latches: each press sets it into the glass or releases it.
  const proxy = $<HTMLButtonElement>('pressProxy');
  const button = new LatchingButton(press, {
    onPress: () => sfx.play('press'),
    onToggle: (latched) => {
      sfx.play(latched ? 'latch' : 'release');
      proxy.setAttribute('aria-pressed', String(latched));
    },
  });
  bindPointer({
    canvas,
    stage,
    turntable,
    button,
    reduceMotion,
    dragGain: () => params.motion.dragGain,
  });
  bindPressProxy(proxy, button, (visible) => (focusVisible = visible));

  const stepTurn = (direction: 1 | -1) => {
    const steps = turntable.aimYaw / STEP;
    const next = direction > 0 ? Math.floor(steps + 1e-3) + 1 : Math.ceil(steps - 1e-3) - 1;
    turntable.turnTo(next * STEP, turntable.aimPitch, 70);
  };
  const ring = new Ring($('ring'), $<SVGPathElement>('ringPath'), $<SVGCircleElement>('ringKnob'), {
    scrub: (angle) => turntable.turnTo(turntable.nearestYaw(angle), turntable.aimPitch, 260),
    nudge: (delta) => turntable.turnTo(turntable.aimYaw + delta, turntable.aimPitch, 90),
    step: stepTurn,
    home: () => turntable.home(),
  });
  for (const [id, direction] of [['turnLeft', -1], ['turnRight', 1]] as const) {
    $(id).addEventListener('click', () => {
      sfx.play('click');
      stepTurn(direction);
    });
  }
  home = () => turntable.home();

  const qualityMenu = new QualityMenu(
    $('quality'),
    $<HTMLButtonElement>('qualityButton'),
    $('qualityValue'),
    $<HTMLUListElement>('qualityList'),
    {
      choose: (choice) => {
        sfx.play('click');
        governor.choose(choice);
        stage.qualityTier = governor.tier;
        layout();
      },
      current: () => governor.tier,
    },
    qualityPref,
  );
  $('quality').hidden = captureMode;

  // ---- Frame loop ----------------------------------------------------------------------------

  let last = performance.now();
  // Fade the stage in once the label has its web font (or after a short wait if the font is slow),
  // so the cap never shows up blank and then gains its text.
  let ready = false;
  let labelDrawn = false;
  void stage.labelReady.then(() => (labelDrawn = true));
  window.setTimeout(() => (labelDrawn = true), 1500);
  let detent = Math.floor(turntable.yaw / DETENT);
  const frame = (now: number) => {
    const frameMs = now - last;
    const dt = Math.min(frameMs / 1000, 1 / 20);
    last = now;
    const instant = reduceMotion.matches;

    turntable.pitchLimit = params.motion.pitchLimit * DEG;
    turntable.update(dt, instant);
    press.update(dt, instant);

    // A soft tick at every detent the turntable passes, panned with the knob around the ring.
    const nextDetent = Math.floor(turntable.yaw / DETENT);
    if (nextDetent !== detent) {
      detent = nextDetent;
      sfx.tick(Math.sin(turntable.yaw) * 0.6);
    }

    const rest = params.rest;
    restQuaternion.setFromEuler(restEuler.set(rest.pitch * DEG, rest.yaw * DEG, rest.roll * DEG, 'YXZ'));
    const motion = params.motion;
    const floating = motion.idleFloat && !instant && !captureMode;
    const bob = floating ? Math.sin(((now / 1000) * 2 * Math.PI) / motion.floatPeriod) * motion.floatAmp : 0;
    pose.position.set(0, bob, 0);
    turntable.orientation(restQuaternion, pose.quaternion);
    pose.press = press.value;
    pose.focus += ((focusVisible ? 1 : 0) - pose.focus) * Math.min(dt * 12, 1);

    stage.render(pose);
    ring.update(turntable.yaw);

    if (!captureMode && governor.sample(frameMs)) {
      stage.qualityTier = governor.tier;
      layout();
      qualityMenu.update();
    }
    if (!ready && labelDrawn) {
      ready = true;
      root.setAttribute('data-ready', '');
    }
  };
  const start = () => {
    last = performance.now();
    stage.renderer.setAnimationLoop(frame);
  };
  // Start drawing once the shaders are built, so the first frame doesn't stall the page on compiling them.
  stage.compile().then(start, (error) => {
    console.error(error);
    start();
  });
  document.addEventListener('visibilitychange', () => governor.resume());

  if (query.has('stats')) {
    const stats = document.createElement('p');
    stats.setAttribute('aria-hidden', 'true');
    stats.className = 'stats';
    document.body.append(stats);
    window.setInterval(() => {
      const fps = Math.round(1000 / governor.averageMs);
      const settled = governor.settled ? ' · capped by display' : '';
      stats.textContent = `${fps} fps · tier ${governor.tier} · ${stage.pixelRatio}× pixels${settled}`;
    }, 500);
  }

  if (import.meta.env.DEV && query.has('debug')) {
    // Steps the frame loop by hand (for testing while the page isn't being painted).
    const advance = (ms: number) => {
      for (let i = 0; i < Math.ceil(ms / 16.67); i++) frame(last + 16.67);
    };
    void import('./debug/gui').then(({ initDebug }) =>
      initDebug({ stage, governor, layout, press, turntable, advance, button, sfx }),
    );
  }
  if (import.meta.env.DEV && captureMode) {
    // Captures render synchronously, so they work even while the page isn't being painted.
    void import('./debug/capture').then(({ initCapture }) => initCapture(stage, canvas, () => frame(performance.now())));
  }
}

boot();
