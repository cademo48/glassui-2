import GUI from 'lil-gui';
import referenceUrl from '../../dev/reference.jpg?url';
import { QUALITY_TIERS, type QualityGovernor } from '../gl/quality';
import type { Stage } from '../gl/stage';
import { Sfx, type SoundName } from '../audio/sfx';
import type { LatchingButton, PressSpring } from '../interaction/press';
import type { Turntable } from '../interaction/turntable';
import { params } from '../params';
import { fitPose } from './fit';

// Dev-only tuning panel (?debug). Everything edits `params` live; "Copy params" puts the current
// values on the clipboard so they can be pasted back into params.ts.

interface DebugDeps {
  stage: Stage;
  governor: QualityGovernor;
  layout: () => void;
  press: PressSpring;
  turntable: Turntable;
  advance: (ms: number) => void;
  button: LatchingButton;
  sfx: Sfx;
}

/** Renders a sound offline and measures it (peak and RMS in dBFS, audible length). */
async function measureSound(name: SoundName) {
  const buffer = await Sfx.render(name);
  let peak = 0;
  let sum = 0;
  let lastLoud = 0;
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  for (let i = 0; i < buffer.length; i++) {
    const v = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    peak = Math.max(peak, v);
    sum += left[i] * left[i] + right[i] * right[i];
    if (v > 0.001) lastLoud = i;
  }
  const db = (x: number) => Number((20 * Math.log10(Math.max(x, 1e-9))).toFixed(1));
  return {
    peakDb: db(peak),
    rmsDb: db(Math.sqrt(sum / (2 * buffer.length))),
    audibleMs: Math.round((lastLoud / buffer.sampleRate) * 1000),
    finite: Number.isFinite(peak),
  };
}

/** The reference image's browser content area, inside the 1376×768 screenshot. */
const REF = { width: 1376, height: 768, x: 172, y: 83, w: 1032, h: 639 };

export function initDebug({ stage, governor, layout, press, turntable, advance, button, sfx }: DebugDeps) {
  const gui = new GUI({ title: 'Glass', width: 310 });

  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '10',
    pointerEvents: 'none',
    opacity: '0',
    backgroundImage: `url(${referenceUrl})`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${(REF.width / REF.w) * 100}vw ${(REF.height / REF.h) * 100}vh`,
    backgroundPosition: `${(-REF.x / REF.w) * 100}vw ${(-REF.y / REF.h) * 100}vh`,
  });
  document.body.append(overlay);

  const view = { reference: 0, difference: false, holdPress: false, fps: 0, tier: 0, dpr: 1 };

  // Console/automation handle for tuning without the panel.
  Object.assign(window, {
    __glass: {
      params,
      stage,
      layout,
      press,
      turntable,
      advance,
      button,
      sfx,
      measureSound,
      overlay(opacity: number, mode: 'normal' | 'difference' = 'normal') {
        overlay.style.opacity = String(opacity);
        overlay.style.mixBlendMode = mode;
      },
      hideGui(hidden = true) {
        gui.domElement.style.display = hidden ? 'none' : '';
      },
      fitPose: (options?: { keepFacing?: boolean }) => fitPose(stage, options),
    },
  });
  const refFolder = gui.addFolder('Reference');
  refFolder.add(view, 'reference', 0, 1, 0.01).name('overlay').onChange((v: number) => (overlay.style.opacity = String(v)));
  refFolder.add(view, 'difference').onChange((on: boolean) => (overlay.style.mixBlendMode = on ? 'difference' : 'normal'));
  refFolder
    .add(params.debug, 'view', {
      off: 0,
      normals: 1,
      'first exit': 2,
      'march effort': 3,
      'first wall normal': 4,
      'first wall fresnel': 5,
      'reflection only': 6,
      'transmission only': 7,
    })
    .name('debug view');
  refFolder.add(view, 'holdPress').name('hold press').onChange((on: boolean) => (press.target = on ? 1 : 0));
  refFolder
    .add(
      {
        copy: () => {
          const json = JSON.stringify(params, null, 2);
          console.log(json);
          void navigator.clipboard?.writeText(json);
        },
      },
      'copy',
    )
    .name('Copy params');

  const stats = gui.addFolder('Stats');
  stats.add(view, 'fps').listen().disable();
  stats.add(view, 'tier').listen().disable();
  stats.add(view, 'dpr').listen().disable();
  window.setInterval(() => {
    view.fps = Math.round(1000 / governor.averageMs);
    view.tier = governor.tier;
    view.dpr = stage.pixelRatio;
  }, 500);
  stats
    .add({ tier: 0 }, 'tier', 0, QUALITY_TIERS.length - 1, 1)
    .name('force tier')
    .onChange((tier: number) => {
      governor.tier = tier;
      stage.qualityTier = tier;
      layout();
    });

  const pose = gui.addFolder('Pose & camera');
  pose.add(params.rest, 'yaw', -90, 90, 0.5);
  pose.add(params.rest, 'pitch', -60, 60, 0.5);
  pose.add(params.rest, 'roll', -45, 45, 0.5);
  pose.add(params.camera, 'fov', 10, 60, 0.5).onChange(layout);
  pose.add(params.camera, 'fill', 0.3, 0.9, 0.005).onChange(layout);
  pose.add(params.camera, 'centerY', 0.3, 0.6, 0.001).onChange(layout);
  pose.add(params.camera, 'extent', 0.8, 2, 0.01).onChange(layout);
  pose.close();

  const shape = gui.addFolder('Shape');
  shape.add(params.slab, 'halfW', 0.6, 1.4, 0.005);
  shape.add(params.slab, 'halfH', 0.6, 1.4, 0.005);
  shape.add(params.slab, 'corner', 0.05, 0.6, 0.005);
  shape.add(params.slab, 'halfT', 0.04, 0.3, 0.002);
  shape.add(params.slab, 'edge', 0.01, 0.2, 0.002);
  shape.add(params.pill, 'halfW', 0.2, 0.8, 0.005).name('cap halfW');
  shape.add(params.pill, 'halfH', 0.08, 0.4, 0.005).name('cap halfH');
  shape.add(params.pill, 'x', -0.6, 0.6, 0.005).name('cap x');
  shape.add(params.pill, 'y', -0.6, 0.6, 0.005).name('cap y');
  shape.add(params.pill, 'halfT', 0.02, 0.12, 0.002).name('cap halfT');
  shape.add(params.pill, 'edge', 0.01, 0.1, 0.002).name('cap edge');
  shape.add(params.pill, 'dome', 0, 0.06, 0.001).name('cap dome');
  shape.add(params.pill, 'rise', 0, 0.15, 0.002).name('cap rise');
  shape.add(params.pill, 'travel', 0, 0.2, 0.002).name('cap travel');
  shape.add(params.well, 'clearance', 0, 0.1, 0.001).name('well clearance');
  shape.add(params.well, 'depth', 0.01, 0.12, 0.001).name('well depth');
  shape.add(params.well, 'lip', 0.001, 0.06, 0.001).name('well lip');
  shape.close();

  const glass = gui.addFolder('Glass');
  glass.add(params.glass, 'ior', 1, 2, 0.005);
  glass.add(params.glass, 'capIor', 1, 2.5, 0.01);
  glass.add(params.glass, 'dispersion', 0, 0.06, 0.001);
  glass.addColor(params.glass, 'tint');
  glass.add(params.glass, 'tintDensity', 0, 2, 0.01);
  glass.add(params.glass, 'bounces', 1, 8, 1);
  glass.add(params.glass, 'steps', 8, 128, 1);
  glass.add(params.glass, 'frostInset', 0, 0.3, 0.001);
  glass.add(params.glass, 'frostLod', 0, 6, 0.05);
  glass.add(params.glass, 'frostGloss', 0, 0.5, 0.005);
  glass.add(params.glass, 'grain', 0, 0.3, 0.002);
  glass.add(params.glass, 'grainLight', 0, 0.3, 0.002);
  glass.add(params.glass, 'noiseScale', 0.1, 4, 0.01);
  glass.add(params.glass, 'haze', 0, 1, 0.01);
  glass.addColor(params.glass, 'hazeShade');
  glass.addColor(params.glass, 'hazeLight');
  glass.add(params.glass, 'pillHaze', 0, 1, 0.01);
  glass.add(params.glass, 'wallZ', -10, -1, 0.05);
  glass.add(params.glass, 'keyAz', -180, 180, 1);
  glass.add(params.glass, 'keyEl', -90, 90, 1);
  glass.addColor(params.label, 'ink').name('label ink');
  glass.add(params.label, 'width', 0.2, 0.95, 0.01).name('label width').onFinishChange(() => void stage.repaintLabel());
  glass.add(params.label, 'weight', 300, 800, 10).name('label weight').onFinishChange(() => void stage.repaintLabel());
  glass.add(params.label, 'dx', -0.2, 0.2, 0.002).name('label dx');
  glass.add(params.label, 'dy', -0.2, 0.2, 0.002).name('label dy');
  glass.add(params.glass.pageCone, '0', 0, 45, 0.5).name('page cone in');
  glass.add(params.glass.pageCone, '1', 0, 60, 0.5).name('page cone out');
  glass.close();

  const env = gui.addFolder('Studio');
  env.addColor(params.env, 'zenith');
  env.addColor(params.env, 'horizon');
  env.addColor(params.env, 'ground');
  for (const light of params.env.lights) {
    const f = env.addFolder(`light: ${light.name}`);
    f.add(light, 'az', -180, 180, 1);
    f.add(light, 'el', -90, 90, 1);
    f.add(light, 'roll', -90, 90, 1);
    f.add(light, 'w', 0.01, 3, 0.005);
    f.add(light, 'h', 0.01, 3, 0.005);
    f.add(light, 'round', 0, 1, 0.01);
    f.add(light, 'soft', 0, 1, 0.005);
    f.add(light, 'softY', 0, 1, 0.005);
    f.addColor(light, 'color');
    f.add(light, 'intensity', 0, 6, 0.05);
    f.close();
  }
  env.close();

  const shadow = gui.addFolder('Shadow');
  shadow.add(params.shadow, 'floorY', -3, -0.8, 0.01).onChange(layout);
  shadow.add(params.shadow, 'lightAz', -180, 180, 0.5);
  shadow.add(params.shadow, 'lightEl', 5, 90, 0.5);
  shadow.add(params.shadow, 'offsetX', -1, 1, 0.01);
  shadow.add(params.shadow, 'offsetZ', -1, 1, 0.01);
  shadow.add(params.shadow, 'spread', 0, 2, 0.01);
  shadow.add(params.shadow, 'blur', 0.02, 1, 0.005);
  shadow.add(params.shadow, 'strength', 0, 2, 0.01);
  shadow.addColor(params.shadow, 'color');
  shadow.close();

  const backdrop = gui.addFolder('Backdrop');
  backdrop.add(params.backdrop, 'angle', 0, 360, 0.5);
  params.backdrop.stops.forEach((stop, i) => {
    backdrop.addColor(stop, 'color').name(`stop ${i}`);
    backdrop.add(stop, 'at', 0, 1, 0.005).name(`stop ${i} at`);
  });
  backdrop.close();

  const motion = gui.addFolder('Motion');
  motion.add(params.motion, 'idleFloat');
  motion.add(params.motion, 'floatAmp', 0, 0.1, 0.001);
  motion.add(params.motion, 'floatPeriod', 1, 12, 0.1);
  motion.add(params.motion, 'dragGain', 0.002, 0.02, 0.0005);
  motion.close();
}
