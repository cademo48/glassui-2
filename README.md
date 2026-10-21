# Press: a ray-traced glass slab

A single-page site: a thick slab of frosted glass with a **Press** button floats over a blue-to-lavender
gradient. You can drag it around in 3D. The button latches: one press sets it into the glass, the next
releases it. All of it is drawn live in WebGL 2, with synthesized sound.

```bash
npm install
npm run dev        # http://127.0.0.1:5188
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/ on http://127.0.0.1:5189
```

## How the glass is drawn

The glass is not a mesh with a transmission material. Each pixel ray traces the slab's exact signed
distance field, defined in `src/gl/shaders/sdf.glsl`: a rounded slab with a pill-shaped well and a
domed cap.

1. **First hit.** The ray is sphere-traced from a proxy box. Silhouettes are anti-aliased from the
   closest approach, so no MSAA is needed.
2. **Front surface.** Exact dielectric Fresnel splits the light into a reflection of an analytic
   studio (`env.glsl`) and a refracted ray.
3. **Inside.** The refracted ray is marched through the glass. At every wall it either leaves or, under
   total internal reflection, bounces on, for up to five bounces. Beer–Lambert absorption tints it
   along the way. Across the flat middle the faces are hit exactly as planes; only the rim and the
   button need marching.
4. **Leaving.** The first exit splits into three wavelengths for dispersion. A ray heading away from
   the camera is projected onto the backdrop and read from a mipmapped copy of it, so what is behind
   the slab really shifts, magnifies and blurs through the frosted face. A ray heading back toward the
   camera sees the studio.
5. **Anti-aliasing.** On the rounded rims and around the button, neighbouring rays take very
   different paths, so those pixels average four fully shaded sub-pixel rays. Where the surface turns
   sharply within a pixel, its reflections and inside paths are blurred by the same amount, so thin
   edges don't break up into dots.

Baking the refraction into a texture wouldn't survive free rotation or the button changing the
surface, so only the backdrop's blur pyramid and the label's distance field are precomputed.

The floor shadow is drawn in the backdrop pass (`background.frag`). It's the slab's footprint as an
oriented Gaussian built from the slab's three half-axes, so it turns, stretches and narrows with the
pose. It darkens the page like a teal filter: red is absorbed first, so the core deepens to teal
while the edges keep the page's own hue.

The pose, the window light's reflection and the backdrop gradient were fitted numerically to the
reference design (`src/debug/fit.ts`, `scripts/fit-gradient.mjs`). The rest of the look was tuned
over rounds of multi-agent visual review against the reference.

## Where things live

| Path | What |
| --- | --- |
| `src/params.ts` | Every tunable: pose, framing, dimensions, glass, studio lights, shadow, gradient |
| `src/gl/stage.ts` | Renderer, camera fit, the three passes, pointer picking |
| `src/gl/shaders/` | `glass.frag` (ray tracer), `sdf.glsl`, `env.glsl`, `background.frag`, `blit.frag` |
| `src/scene/sdf.ts` | CPU copy of the distance field, used to tell when the pointer is over the button (keep it in step with `sdf.glsl`) |
| `src/interaction/` | Turntable (drag, flick, springs), the latching button and its keyboard stand-in |
| `src/audio/sfx.ts` | Synthesized sound effects and the mute preference |
| `src/ui/` | The orbit ring and the About card |
| `src/gl/quality.ts` | Steps the pixel ratio, bounces and march steps down when frames run long |

## Controls

- **Drag** anywhere off the button: sideways spins it, up and down tilts it (±75°).
- **The ring:** drag the knob, or focus the ring and use the arrow keys (±15°), Page Up/Down (±45°) or Home.
- **The chevrons** turn it 45° at a time.
- **Press:** push the cap with the pointer, or Tab to the button and use Space or Enter. Letting go over
  the button toggles it: set into the glass, or released. Sliding off before letting go cancels.
- **Home** turns the slab back to its rest pose.
- **Speaker** (top right) turns sound on or off; the choice is remembered.

## Sound

Everything is synthesized with Web Audio in `src/audio/sfx.ts`: oscillators and band-passed noise
through a small synthetic reverb and a limiter, with no sound files.

| Sound | When |
| --- | --- |
| Glassy thock | The cap bottoms out |
| Click-clack and a falling chime | The button sets into the glass |
| Bloop and a rising shimmer | It releases and pops back up |
| Soft tick | Every 15° of rotation, panned with the knob |
| Click | The chevrons |
| Airy whoosh | The About card opens or closes |

The audio graph is built on the first click or key press, as browsers require.

`prefers-reduced-motion` turns off the idle float and the coasting. Without WebGL 2 the page shows a
static CSS version.

## Dev tools (stripped from production builds)

- `?debug` opens a live tuning panel (lil-gui) with a reference overlay, debug views (normals, march
  effort, reflection or transmission only) and "Copy params".
- `?capture` renders at the reference's 1032×639 and exposes `window.__capture(name)`, which saves the
  canvas to `review/captures/<name>.png` through the dev server.
- `npm run compare [name]` compares a capture with `dev/reference.jpg`. It writes side-by-sides, close-ups
  and OKLab ΔE metrics to `review/out/`.
- `node scripts/fit-gradient.mjs` fits the backdrop gradient to the reference.
