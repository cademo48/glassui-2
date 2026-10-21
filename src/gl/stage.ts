import * as THREE from 'three';
import { linear, srgb } from '../color';
import { params, type RectLight } from '../params';
import { isButton, trace } from '../scene/sdf';
import { deriveShape, type Shape } from '../scene/shape';
import { createLabelTexture, LABEL_HEIGHT, LABEL_SPREAD, paintLabel } from './label';
import { createNoiseTexture } from './noise';
import { QUALITY_TIERS } from './quality';
import commonGlsl from './shaders/common.glsl?raw';
import sdfGlsl from './shaders/sdf.glsl?raw';
import envGlsl from './shaders/env.glsl?raw';
import fullscreenVert from './shaders/fullscreen.vert?raw';
import backgroundFrag from './shaders/background.frag?raw';
import blitFrag from './shaders/blit.frag?raw';
import glassVert from './shaders/glass.vert?raw';
import glassFrag from './shaders/glass.frag?raw';

const HEADER = 'precision highp float;\nprecision highp int;\n';
const DEG = Math.PI / 180;
const MAX_LIGHTS = 4;
const MAX_STOPS = 8;
/** The backdrop is smooth, so the glass reads it from a half-resolution, mipmapped copy. */
const BACKDROP_SCALE = 0.5;

export interface Pose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** 0 = cap at rest, 1 = fully pressed; slightly negative while it springs back. */
  press: number;
  /** 0..1 strength of the keyboard focus ring. */
  focus: number;
}

const v3 = () => new THREE.Vector3();
const v4 = () => new THREE.Vector4();

function directionFrom(azDeg: number, elDeg: number, out: THREE.Vector3): THREE.Vector3 {
  const az = azDeg * DEG;
  const el = elDeg * DEG;
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

function setLinear(target: THREE.Vector3, hex: string): THREE.Vector3 {
  const [r, g, b] = linear(hex);
  return target.set(r, g, b);
}

function fullscreenTriangle(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  return geometry;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(params.camera.fov, 1, 0.1, 100);
  readonly shape: Shape = deriveShape(0);
  readonly glass: THREE.Mesh;
  /** Resolves once the label has been drawn with the web font. */
  readonly labelReady: Promise<void>;

  cssWidth = 1;
  cssHeight = 1;
  pixelRatio = 1;
  qualityTier = 0;

  private readonly screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly backdropScene = new THREE.Scene();
  private readonly screenScene = new THREE.Scene();
  private readonly backdropTarget: THREE.WebGLRenderTarget;
  private readonly backdropMaterial: THREE.RawShaderMaterial;
  private readonly glassMaterial: THREE.RawShaderMaterial;
  private readonly modelInverse = new THREE.Matrix4();
  private readonly viewProjection = new THREE.Matrix4();
  private readonly raycaster = new THREE.Raycaster();
  private readonly lightFrames = Array.from({ length: MAX_LIGHTS }, () => new THREE.Matrix3());
  private readonly lightRects = Array.from({ length: MAX_LIGHTS }, v4);
  private readonly lightSoftY = new Array<number>(MAX_LIGHTS).fill(0);
  private readonly lightColors = Array.from({ length: MAX_LIGHTS }, v3);
  private readonly stops = Array.from({ length: MAX_STOPS }, v3);
  private readonly stopAt = new Array<number>(MAX_STOPS).fill(1);

  private readonly shapeUniforms = {
    uSlab: { value: v4() },
    uSlabEdge: { value: 0 },
    uWell: { value: v4() },
    uPill: { value: v4() },
    uPillZ: { value: 0 },
    uPillX: { value: 0 },
    uPillY: { value: 0 },
    uPillDome: { value: 0 },
    uPillFillet: { value: 0 },
    uPillBound: { value: v4() },
  };

  private readonly envUniforms = {
    uEnvZenith: { value: v3() },
    uEnvHorizon: { value: v3() },
    uEnvGround: { value: v3() },
    uLightFrame: { value: this.lightFrames },
    uLightRect: { value: this.lightRects },
    uLightSoftY: { value: this.lightSoftY },
    uLightColor: { value: this.lightColors },
    uLightCount: { value: 0 },
  };

  constructor(canvas: HTMLCanvasElement, options: { preserveDrawingBuffer?: boolean } = {}) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    });
    this.renderer.autoClear = false;

    this.backdropTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.UnsignedByteType,
      colorSpace: THREE.SRGBColorSpace,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });

    const triangle = fullscreenTriangle();

    this.backdropMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: HEADER + fullscreenVert,
      fragmentShader: HEADER + [commonGlsl, sdfGlsl, backgroundFrag].join('\n'),
      uniforms: {
        ...this.shapeUniforms,
        uInvViewProj: { value: new THREE.Matrix4() },
        uCamPos: { value: v3() },
        uModelInv: { value: this.modelInverse },
        uObjPos: { value: v3() },
        uAspect: { value: 1 },
        uAngle: { value: 0 },
        uStops: { value: this.stops },
        uStopAt: { value: this.stopAt },
        uStopCount: { value: 0 },
        uFloorY: { value: 0 },
        uShadowShear: { value: new THREE.Vector2() },
        uShadowOffset: { value: new THREE.Vector2() },
        uShadowSpread: { value: 0 },
        uShadowBlur: { value: 0 },
        uShadowStrength: { value: 0 },
        uShadowColor: { value: v3() },
      },
      depthTest: false,
      depthWrite: false,
    });
    const backdrop = new THREE.Mesh(triangle, this.backdropMaterial);
    backdrop.frustumCulled = false;
    this.backdropScene.add(backdrop);

    const blitMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: HEADER + fullscreenVert,
      fragmentShader: HEADER + [commonGlsl, blitFrag].join('\n'),
      uniforms: { uBackdrop: { value: this.backdropTarget.texture } },
      depthTest: false,
      depthWrite: false,
    });
    const blit = new THREE.Mesh(triangle, blitMaterial);
    blit.frustumCulled = false;
    blit.renderOrder = 0;

    const label = createLabelTexture();
    this.glassMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: HEADER + glassVert,
      fragmentShader: HEADER + [commonGlsl, sdfGlsl, envGlsl, glassFrag].join('\n'),
      uniforms: {
        ...this.shapeUniforms,
        ...this.envUniforms,
        uModel: { value: new THREE.Matrix4() },
        uModelInv: { value: this.modelInverse },
        uViewProj: { value: this.viewProjection },
        uPixelAngle: { value: 0.001 },
        uCamRight: { value: v3() },
        uCamUp: { value: v3() },
        uRimSamples: { value: 4 },
        uBoxMin: { value: v3() },
        uBoxMax: { value: v3() },
        uBackdrop: { value: this.backdropTarget.texture },
        uWallZ: { value: -2.6 },
        uPageConeIn: { value: 1 },
        uPageConeOut: { value: 0.9 },
        uIor: { value: 1.5 },
        uCapIor: { value: 1.9 },
        uDispersion: { value: 0 },
        uAbsorb: { value: v3() },
        uBounces: { value: 4 },
        uSteps: { value: 48 },
        uFrostInset: { value: 0 },
        uFrostLod: { value: 0 },
        uFrostGloss: { value: 0 },
        uGrain: { value: 0 },
        uGrainLight: { value: 0 },
        uNoise: { value: createNoiseTexture() },
        uNoiseScale: { value: 1 },
        uHaze: { value: 0 },
        uHazeShade: { value: v3() },
        uHazeLight: { value: v3() },
        uPillHaze: { value: 0 },
        uKeyDir: { value: v3() },
        uLabel: { value: label },
        uLabelRect: { value: v4() },
        uLabelTexels: { value: 1 },
        uLabelSpread: { value: LABEL_SPREAD },
        uInk: { value: v3() },
        uFocus: { value: 0 },
        uFocusColor: { value: v3() },
        uDebugView: { value: 0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.glass = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.glassMaterial);
    this.glass.frustumCulled = false;
    this.glass.renderOrder = 1;

    this.screenScene.add(blit);
    this.screenScene.add(this.glass);

    this.labelReady = this.repaintLabel();
  }

  /** Redraws the cap's label from params.label (once the web font is in). */
  repaintLabel(): Promise<void> {
    const { text, weight, width } = params.label;
    const texture = this.glassMaterial.uniforms.uLabel.value as THREE.DataTexture;
    return paintLabel(texture, { text, weight, width, family: 'Inter Variable' });
  }

  /**
   * Compiles every shader ahead of the first frame. Where the browser supports
   * KHR_parallel_shader_compile this happens off the main thread, so the page stays responsive while
   * the (large) glass shader builds instead of stalling on the first draw.
   */
  async compile(): Promise<void> {
    await Promise.all([
      this.renderer.compileAsync(this.backdropScene, this.screenCamera),
      this.renderer.compileAsync(this.screenScene, this.camera),
    ]);
  }

  /** Sizes the canvas and its targets, and reframes the camera. */
  setSize(cssWidth: number, cssHeight: number, devicePixelRatio: number) {
    this.cssWidth = Math.max(1, cssWidth);
    this.cssHeight = Math.max(1, cssHeight);
    const tier = QUALITY_TIERS[this.qualityTier];
    this.pixelRatio = Math.min(devicePixelRatio, tier.dpr, params.quality.maxDpr);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.cssWidth, this.cssHeight, false);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.backdropTarget.setSize(
      Math.max(1, Math.round(size.x * BACKDROP_SCALE)),
      Math.max(1, Math.round(size.y * BACKDROP_SCALE)),
    );
    this.fitCamera();
  }

  /** Frames the slab: it fills a set share of the height (or the width on portrait screens). */
  fitCamera() {
    const { fov, fill, fillPortrait, centerY, extent } = params.camera;
    const width = this.cssWidth;
    const height = this.cssHeight;
    const aspect = width / height;
    const tanHalf = Math.tan((fov / 2) * DEG);
    const distance = Math.max(extent / (fill * tanHalf), extent / (fillPortrait * tanHalf * aspect));
    this.camera.fov = fov;
    this.camera.aspect = aspect;
    this.camera.position.set(0, 0, distance);
    this.camera.lookAt(0, 0, 0);
    // Shift the lens (not the view direction) so the slab sits a little above the middle.
    this.camera.setViewOffset(width, height, 0, (0.5 - centerY) * height, width, height);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /** Where a world-space point lands on the page, in CSS pixels. */
  project(point: THREE.Vector3): { x: number; y: number } {
    const p = point.clone().project(this.camera);
    return { x: ((p.x + 1) / 2) * this.cssWidth, y: ((1 - p.y) / 2) * this.cssHeight };
  }

  /** True when the page point is over the button (the cap or its well), seen from the front. */
  buttonAt(clientX: number, clientY: number, canvas: HTMLCanvasElement): boolean {
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const origin = this.raycaster.ray.origin.clone().applyMatrix4(this.modelInverse);
    const direction = this.raycaster.ray.direction.clone().transformDirection(this.modelInverse);
    const hit = trace(this.shape, {
      origin: [origin.x, origin.y, origin.z],
      direction: [direction.x, direction.y, direction.z],
    });
    return hit !== null && isButton(this.shape, hit);
  }

  render(pose: Pose) {
    deriveShape(pose.press, this.shape);
    this.glass.position.copy(pose.position);
    this.glass.quaternion.copy(pose.quaternion);
    this.glass.updateMatrixWorld();
    this.modelInverse.copy(this.glass.matrixWorld).invert();
    this.viewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);

    this.updateShapeUniforms();
    this.updateEnvUniforms();
    this.updateBackdropUniforms();
    this.updateGlassUniforms(pose);

    const renderer = this.renderer;
    renderer.setRenderTarget(this.backdropTarget);
    renderer.render(this.backdropScene, this.screenCamera);
    renderer.setRenderTarget(null);
    renderer.render(this.screenScene, this.camera);
  }

  private updateShapeUniforms() {
    const s = this.shape;
    const u = this.shapeUniforms;
    u.uSlab.value.fromArray(s.slab);
    u.uSlabEdge.value = s.slabEdge;
    u.uWell.value.fromArray(s.well);
    u.uPill.value.fromArray(s.pill);
    u.uPillZ.value = s.pillZ;
    u.uPillX.value = s.pillX;
    u.uPillY.value = s.pillY;
    u.uPillDome.value = s.pillDome;
    u.uPillFillet.value = s.pillFillet;
    u.uPillBound.value.fromArray(s.pillBound);
  }

  private updateEnvUniforms() {
    const env = params.env;
    const u = this.envUniforms;
    setLinear(u.uEnvZenith.value, env.zenith);
    setLinear(u.uEnvHorizon.value, env.horizon);
    setLinear(u.uEnvGround.value, env.ground);
    const lights = env.lights.slice(0, MAX_LIGHTS);
    lights.forEach((light, i) => this.setLight(i, light));
    u.uLightCount.value = lights.length;
  }

  private setLight(i: number, light: RectLight) {
    const forward = directionFrom(light.az, light.el, new THREE.Vector3());
    const up0 = Math.abs(forward.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const right0 = new THREE.Vector3().crossVectors(up0, forward).normalize();
    const upright = new THREE.Vector3().crossVectors(forward, right0);
    const roll = light.roll * DEG;
    const right = right0.clone().multiplyScalar(Math.cos(roll)).addScaledVector(upright, Math.sin(roll));
    const up = upright.clone().multiplyScalar(Math.cos(roll)).addScaledVector(right0, -Math.sin(roll));
    this.lightFrames[i].set(right.x, up.x, forward.x, right.y, up.y, forward.y, right.z, up.z, forward.z);
    this.lightRects[i].set(light.w, light.h, light.round * Math.min(light.w, light.h), light.soft);
    this.lightSoftY[i] = light.softY;
    setLinear(this.lightColors[i], light.color).multiplyScalar(light.intensity);
  }

  private updateBackdropUniforms() {
    const u = this.backdropMaterial.uniforms;
    const b = params.backdrop;
    const sh = params.shadow;
    (u.uInvViewProj.value as THREE.Matrix4).copy(this.viewProjection).invert();
    (u.uCamPos.value as THREE.Vector3).copy(this.camera.position);
    (u.uObjPos.value as THREE.Vector3).copy(this.glass.position);
    u.uAspect.value = this.cssWidth / this.cssHeight;
    u.uAngle.value = b.angle * DEG;
    const stops = b.stops.slice(0, MAX_STOPS);
    stops.forEach((stop, i) => {
      this.stops[i].fromArray(srgb(stop.color));
      this.stopAt[i] = stop.at;
    });
    u.uStopCount.value = stops.length;
    u.uFloorY.value = sh.floorY;
    const key = directionFrom(sh.lightAz, sh.lightEl, new THREE.Vector3());
    (u.uShadowShear.value as THREE.Vector2).set(key.x / key.y, key.z / key.y);
    (u.uShadowOffset.value as THREE.Vector2).set(sh.offsetX, sh.offsetZ);
    u.uShadowSpread.value = sh.spread;
    u.uShadowBlur.value = sh.blur;
    u.uShadowStrength.value = sh.strength;
    (u.uShadowColor.value as THREE.Vector3).fromArray(srgb(sh.color));
  }

  private updateGlassUniforms(pose: Pose) {
    const u = this.glassMaterial.uniforms;
    const g = params.glass;
    const tier = QUALITY_TIERS[this.qualityTier];
    (u.uModel.value as THREE.Matrix4).copy(this.glass.matrixWorld);
    const drawingHeight = this.cssHeight * this.pixelRatio;
    u.uPixelAngle.value = (2 * Math.tan((this.camera.fov / 2) * DEG)) / drawingHeight;
    (u.uCamRight.value as THREE.Vector3).setFromMatrixColumn(this.camera.matrixWorld, 0);
    (u.uCamUp.value as THREE.Vector3).setFromMatrixColumn(this.camera.matrixWorld, 1);
    u.uRimSamples.value = tier.rimSamples;
    (u.uBoxMin.value as THREE.Vector3).fromArray(this.shape.boxMin);
    (u.uBoxMax.value as THREE.Vector3).fromArray(this.shape.boxMax);
    u.uWallZ.value = g.wallZ;
    u.uPageConeIn.value = Math.cos(g.pageCone[0] * DEG);
    u.uPageConeOut.value = Math.cos(g.pageCone[1] * DEG);
    u.uIor.value = g.ior;
    u.uCapIor.value = g.capIor;
    u.uDispersion.value = g.dispersion;
    const tint = linear(g.tint);
    (u.uAbsorb.value as THREE.Vector3).set(
      -Math.log(Math.max(tint[0], 1e-4)) * g.tintDensity,
      -Math.log(Math.max(tint[1], 1e-4)) * g.tintDensity,
      -Math.log(Math.max(tint[2], 1e-4)) * g.tintDensity,
    );
    u.uBounces.value = Math.min(g.bounces, tier.bounces);
    u.uSteps.value = Math.min(g.steps, tier.steps);
    u.uFrostInset.value = g.frostInset;
    u.uFrostLod.value = g.frostLod;
    u.uFrostGloss.value = g.frostGloss;
    u.uGrain.value = g.grain;
    u.uGrainLight.value = g.grainLight;
    u.uNoiseScale.value = g.noiseScale;
    u.uHaze.value = g.haze;
    setLinear(u.uHazeShade.value as THREE.Vector3, g.hazeShade);
    setLinear(u.uHazeLight.value as THREE.Vector3, g.hazeLight);
    u.uPillHaze.value = g.pillHaze;
    directionFrom(g.keyAz, g.keyEl, u.uKeyDir.value as THREE.Vector3);
    (u.uLabelRect.value as THREE.Vector4).fromArray(this.shape.label);
    u.uLabelTexels.value = LABEL_HEIGHT / (2 * this.shape.label[3]);
    setLinear(u.uInk.value as THREE.Vector3, params.label.ink);
    u.uFocus.value = pose.focus;
    setLinear(u.uFocusColor.value as THREE.Vector3, '#1d2834');
    u.uDebugView.value = params.debug.view;
  }
}
