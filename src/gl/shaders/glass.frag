// The glass, ray traced per pixel against its exact distance field.
//  - The first hit is sphere traced from the proxy box and anti-aliased from the closest approach.
//  - Exact Fresnel splits it into a reflection of the studio and a refracted ray.
//  - The refracted ray is marched through the inside. At each wall it either leaves or, under total
//    internal reflection, bounces on, tinted by Beer-Lambert absorption along the way. The first
//    exit splits into three wavelengths for dispersion.
//  - Rays leaving toward the backdrop are projected onto it and read from the mipmapped backdrop
//    texture, so the slab really shifts and magnifies what is behind it.
//  - The sand-blasted face roughens those rays (grain and blur) and scatters a little milky light.
//  - Pixels on the curved rims and around the button average four sub-pixel rays.

uniform vec3 cameraPosition;
uniform mat4 uModel;
uniform mat4 uModelInv;
uniform mat4 uViewProj;
uniform float uPixelAngle;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform int uRimSamples;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;

uniform sampler2D uBackdrop;
uniform float uWallZ;

uniform float uIor;
uniform float uCapIor;
uniform float uDispersion;
uniform vec3 uAbsorb;
uniform int uBounces;
uniform int uSteps;

uniform float uPageConeIn;   // cos of the angle within which an exit ray sees the page
uniform float uPageConeOut;  // cos of the angle past which it sees only the studio

uniform float uFrostInset;
uniform float uFrostLod;
uniform float uFrostGloss;
uniform float uGrain;
uniform float uGrainLight;
uniform sampler2D uNoise;
uniform float uNoiseScale;
uniform float uHaze;
uniform vec3 uHazeShade;
uniform vec3 uHazeLight;
uniform float uPillHaze;
uniform vec3 uKeyDir;

uniform sampler2D uLabel;
uniform vec4 uLabelRect;
uniform float uLabelTexels;
uniform float uLabelSpread;
uniform vec3 uInk;

uniform float uFocus;
uniform vec3 uFocusColor;
// 0 off, 1 normals, 2 first exit direction, 3 inside march effort, 4 first wall normal,
// 5 first wall Fresnel, 6 reflection only, 7 transmission only
uniform int uDebugView;

in vec3 vObjPos;
out vec4 outColor;

const float NOISE_SIZE = 256.0;

// Debug bookkeeping (only read when uDebugView is set).
vec3 gFirstExit = vec3(0.0);
float gEffort = 0.0;
vec3 gFirstNormal = vec3(0.0);
float gFirstFresnel = -1.0;

// Set per camera ray in shade(), read deeper in the trace.
// 1 for rays into the slab (0 through the cap and its bore, which keep seeing the page).
float gSlabRay = 1.0;
// 1 where the ray entered near a corner of the slab, whose walls read as dark steel.
float gCorner = 0.0;

vec3 calcNormal(vec3 p) {
  const float h = 0.0005;
  const vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * map(p + k.xyy * h) + k.yyx * map(p + k.yyx * h) +
    k.yxy * map(p + k.yxy * h) + k.xxx * map(p + k.xxx * h)
  );
}

vec2 boxHit(vec3 ro, vec3 rd, vec3 lo, vec3 hi) {
  vec3 r = mix(rd, vec3(1e-6), lessThan(abs(rd), vec3(1e-6)));
  vec3 t0 = (lo - ro) / r;
  vec3 t1 = (hi - ro) / r;
  vec3 tn = min(t0, t1);
  vec3 tf = max(t0, t1);
  return vec2(max(max(tn.x, tn.y), tn.z), min(min(tf.x, tf.y), tf.z));
}

// 1 on the sand-blasted part of the front face; 0 on the polished border, walls, well and cap. The
// frost fades out where the face starts to round over, rather than stopping at a seam.
float frostMask(vec3 p, vec3 n) {
  float inner = sdRoundRect(p.xy, uSlab.xy - uFrostInset, max(uSlab.z - uFrostInset, 0.02));
  float aroundWell = sdRoundRect(p.xy - pillXY(), uWell.xy + 0.012, uWell.y + 0.012);
  return (1.0 - smoothstep(-0.003, 0.003, inner)) * smoothstep(-0.003, 0.003, aroundWell) *
    smoothstep(0.85, 0.97, n.z) * smoothstep(uSlab.w - 0.03, uSlab.w - 0.005, p.z);
}

float capMask(vec3 p) {
  return 1.0 - smoothstep(0.0, 0.006, sdPill(p));
}

// The bore around the cap (its walls and floor), below the face.
float wellMask(vec3 p) {
  float inside = 1.0 - smoothstep(-0.004, 0.004, sdRoundRect(p.xy - pillXY(), uWell.xy, uWell.y));
  return inside * (1.0 - capMask(p)) * step(p.z, uSlab.w + 0.002);
}

// Printed label on the cap's top. aa is the edge half-width in distance-field units.
float labelInk(vec3 p, vec3 n, float aa) {
  vec2 uv = vec2(
    0.5 + (p.x - uLabelRect.x) / (2.0 * uLabelRect.z),
    0.5 - (p.y - uLabelRect.y) / (2.0 * uLabelRect.w)
  );
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  if (p.z < uPillZ || n.z < 0.35) return 0.0;
  float sd = textureLod(uLabel, uv, 0.0).r;
  return smoothstep(0.5 - aa, 0.5 + aa, sd) * capMask(p);
}

// Milky light scattered in the frosted surface. The colour shades from the side away from the key
// light to the side toward it; in w is the glow, a lobe in the corner facing the light that fades by
// mid-height.
vec4 hazeAt(vec3 p, vec3 n) {
  mat3 rot = mat3(uModel);
  vec2 toKey = normalize((transpose(rot) * uKeyDir).xy + vec2(1e-5));
  float lit = smoothstep(-1.0, 1.0, clamp(dot(p.xy / uSlab.xy, toKey), -1.0, 1.0));
  float facing = saturate(dot(rot * n, uKeyDir) * 0.5 + 0.5);
  const float c8 = 0.98953;  // cos 8.3°
  const float s8 = 0.14436;  // sin 8.3°
  vec2 toGlow = vec2(c8 * toKey.x - s8 * toKey.y, s8 * toKey.x + c8 * toKey.y);
  float glow = 1.0 - smoothstep(0.8, 2.0, length(p.xy / uSlab.xy - 1.8 * toGlow));
  return vec4(mix(uHazeShade, uHazeLight, lit) * mix(0.75, 1.1, facing), glow);
}

// What a ray leaving the glass sees: the backdrop if it heads away from the camera, else the studio.
// The page is a backdrop in the line of sight: rays that the rims bend far off the view direction see
// the studio around it instead, which keeps strongly bent edges silver rather than prism-coloured.
// blur softens the studio lights (rays that have bounced around inside see them spread out).
vec3 sceneColor(vec3 pObj, vec3 dObj, float lod, float blur) {
  vec3 pW = (uModel * vec4(pObj, 1.0)).xyz;
  vec3 dW = normalize(mat3(uModel) * dObj);
  float toWall = 1.0 - smoothstep(-0.25, -0.02, dW.z);
  float inView = smoothstep(uPageConeOut, uPageConeIn, dot(dW, normalize(pW - cameraPosition)));
  toWall *= mix(1.0, inView, gSlabRay);
  vec3 c = vec3(0.0);
  if (toWall > 0.0) {
    vec3 hitW = pW + dW * ((uWallZ - pW.z) / min(dW.z, -1e-4));
    vec4 clip = uViewProj * vec4(hitW, 1.0);
    vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
    c = textureLod(uBackdrop, uv, lod).rgb;
    // Past the page's edge there is studio, not more page.
    vec2 off = max(abs(uv - 0.5) - 0.5, 0.0);
    toWall *= 1.0 - smoothstep(0.0, 0.35, max(off.x, off.y));
  }
  if (toWall < 1.0) c = mix(envColor(dW, blur), c, toWall);
  return c;
}

// Distance along an inside ray to where it meets the surface (y = 1 if it got there). Sphere tracing
// alone crawls when a ray runs nearly parallel to the faces (light piping along the slab), so across
// the flat middle the faces are hit exactly as planes whenever neither the rounded rim nor the button
// can be in the way.
vec2 distanceToExit(vec3 p, vec3 dir) {
  float dirXY = max(length(dir.xy), 1e-5);
  float face = abs(dir.z) > 1e-5 ? 1.0 / dir.z : 0.0;
  float s = 0.0;
  for (int i = 0; i < 128; i++) {
    if (i >= uSteps) break;
    gEffort += 1.0;
    vec3 q = p + dir * s;
    float d = -map(q);
    if (d < 3e-4) return vec2(s, 1.0);
    // How far the ray can certainly go before it could reach the rim zone or the button's box.
    float rim = -sdRoundRect(q.xy, uSlab.xy - uSlabEdge, max(uSlab.z - uSlabEdge, 0.0));
    vec3 dq = abs(vec3(q.xy - pillXY(), q.z - uPillBound.w)) - uPillBound.xyz;
    float button = length(max(dq, 0.0)) + min(max(dq.x, max(dq.y, dq.z)), 0.0);
    float clearRun = min(max(rim, 0.0) / dirXY, max(button, 0.0));
    float toFace = face != 0.0 ? (sign(dir.z) * uSlab.w - q.z) * face : 1e9;
    // Only from inside the slab body (inside the cap the ray is already above the face plane).
    if (clearRun > 0.0 && toFace >= 0.0 && toFace <= clearRun) return vec2(s + toFace, 1.0);
    s += max(d, clearRun);
  }
  return vec2(s, 0.0);
}

// The surroundings averaged. Light trapped inside the walls leaves mostly through the faces toward
// the lit studio, so this leans on the studio's neutral light rather than the coloured page.
vec3 averageScene() {
  vec3 studio = 0.5 * (uEnvHorizon + uEnvZenith);
  return mix(textureLod(uBackdrop, vec2(0.5), 12.0).rgb, studio, 0.85);
}

// Follows a refracted ray through the inside of the glass until its light has left. rough starts at
// how fast the entry surface turns across the pixel.
vec3 traceInside(vec3 p, vec3 dir, float lod, float aa, float grainLod, float rough) {
  vec3 acc = vec3(0.0);
  vec3 thr = vec3(1.0);
  // Chaotic paths settle toward the surroundings; near the slab's corners, where light is trapped
  // between walls that face the dim studio, that reads as dark steel rather than the lit studio.
  vec3 settleTo = mix(averageScene(), 0.5 * (uEnvHorizon + uEnvGround), gCorner);
  // rough: how much of the path so far came off curved walls. Paths that have glanced off rims are
  // chaotic from pixel to pixel, so they are read blurrier and leaned toward settleTo.
  for (int b = 0; b < 8; b++) {
    if (b >= uBounces) break;
    vec2 run = distanceToExit(p, dir);
    // The cap is fused to the bore's floor in the distance field, but a real cap rests on a film of
    // air: rays that would be totally internally reflected at the cap's underside bounce there.
    float zf = uPillZ - uPill.z;
    float tf = abs(dir.z) > 1e-4 ? (zf - p.z) / dir.z : -1.0;
    if (tf > 2e-4 && tf < run.x && sdRoundRect((p + dir * tf).xy - pillXY(), uPill.xy, uPill.y) < 0.0 &&
        fresnel(abs(dir.z), uIor, 1.0) >= 1.0) {
      p += dir * tf;
      thr *= exp(-uAbsorb * tf);
      dir.z = -dir.z;
      p.z += sign(dir.z) * 1e-4;
      continue;
    }
    p += dir * run.x;
    thr *= exp(-uAbsorb * run.x);
    // Never found the wall (a ray skimming round the rounded rim): let it go as it is heading.
    if (run.y < 0.5) break;
    vec3 n = calcNormal(p);
    rough += 1.0 - smoothstep(0.9, 0.99, max(abs(n.z), max(abs(n.x), abs(n.y))));

    // The label, seen from inside (mirrored when the slab is turned around): only where the ray first
    // meets the cap, fairly square-on. Bounced or skimming rays would smear ink along the walls.
    if (b == 0) {
      float square = dot(dir, n);
      float ink = labelInk(p, n, aa / max(square, 0.3)) * smoothstep(0.45, 0.65, square);
      acc += thr * ink * uInk;
      thr *= 1.0 - ink;
    }

    // Leaving through the sand-blasted face roughens and blurs the way out.
    float fm = frostMask(p, n);
    vec3 nx = n;
    if (fm > 0.0) {
      vec2 g = textureLod(uNoise, p.xy * uNoiseScale, grainLod + 2.0 + float(b)).xy * 2.0 - 1.0;
      nx = normalize(n + fm * uGrain * vec3(g, 0.0));
      lod = max(lod, fm * uFrostLod);
    }

    float Fe = fresnel(dot(dir, nx), uIor, 1.0);
    if (b == 0) {
      gFirstNormal = nx;
      gFirstFresnel = Fe;
    }
    if (Fe < 1.0) {
      // Each bounce spreads the ray's footprint: read later exits blurrier, and cap them so a stray
      // path can't land on a small bright light and sparkle.
      float bounce = float(b);
      float lodB = lod + bounce * 0.9 + rough * 2.0;
      float blur = lod * 0.04 + bounce * 0.08 + rough * 0.12;
      float settle = saturate(0.3 * (bounce - 1.0) + 0.6 * rough);
      vec3 outG = refract(dir, -nx, uIor);
      if (dot(gFirstExit, gFirstExit) == 0.0) gFirstExit = normalize(mat3(uModel) * outG);
      vec3 c;
      if (b == 0 && uDispersion > 0.0) {
        vec3 outR = refract(dir, -nx, uIor - uDispersion);
        vec3 outB = refract(dir, -nx, uIor + uDispersion);
        if (dot(outB, outB) < 0.5) outB = outG;
        c = vec3(
          sceneColor(p, outR, lodB, blur).r,
          sceneColor(p, outG, lodB, blur).g,
          sceneColor(p, outB, lodB, blur).b
        );
      } else {
        c = min(sceneColor(p, outG, lodB, blur), vec3(1.2));
      }
      // At the corners always settle at least halfway, so the steel tone doesn't flicker on and off
      // from one pixel to the next.
      c = mix(c, settleTo, mix(settle, max(settle, 0.5), gCorner));
      if (fm > 0.0) c = mix(c, hazeAt(p, n).rgb, fm * uHaze * 0.8);
      acc += thr * (1.0 - Fe) * c;
      thr *= Fe;
    }
    dir = reflect(dir, nx);
    p -= n * 1e-3;
    if (max(thr.r, max(thr.g, thr.b)) < 0.015) break;
  }
  // Light still trapped after the last bounce would leave somewhere unpredictable; credit it with the
  // settled surroundings rather than one arbitrary direction.
  return acc + thr * settleTo;
}

// Rolls bright highlights off smoothly instead of clipping them.
vec3 softClip(vec3 c) {
  const float k = 0.8;
  vec3 over = max(c - k, 0.0);
  return min(c, vec3(k)) + (1.0 - k) * (1.0 - exp(-over / (1.0 - k)));
}

// Everything seen where a camera ray meets the glass at p (normal n, distance t). turn is how far the
// normal swings across the pixel: on tight curves and silhouettes the pixel sees a spread of
// reflections, so they are blurred by that much instead of aliasing into dots.
vec3 shade(vec3 rd, vec3 p, vec3 n, float t, float turn) {
  mat3 rot = mat3(uModel);
  float pixel = t * uPixelAngle;

  // Where this ray goes in decides what its exits see: the cap and bore keep reading the page, and
  // rays entering near a corner settle toward the corner's dark steel.
  float cap = capMask(p);
  gSlabRay = 1.0 - max(cap, wellMask(p));
  vec2 k = abs(p.xy) - (uSlab.xy - uSlab.z);
  gCorner = smoothstep(-0.2, 0.1, min(k.x, k.y));

  // Sand-blasted micro-surface: the normal jitters with grain that stays locked to the glass. The
  // grain is filtered by the pixel's footprint, stretched when the face is seen at a glancing angle.
  float fm = frostMask(p, n);
  float grainLod = log2(max(pixel * uNoiseScale * NOISE_SIZE / max(abs(dot(n, rd)), 0.1), 1.0));
  vec4 g = textureLod(uNoise, p.xy * uNoiseScale, grainLod);
  vec3 ns = normalize(n + fm * uGrain * vec3(g.xy * 2.0 - 1.0, 0.0));

  // The cap's top is glossier (high-index), which draws the white band along its domed top. The cap
  // reflects its true surroundings (page included), so its lower rim catches the light under it.
  float capTop = cap * step(uPillZ, p.z);
  float cosV = saturate(dot(ns, -rd));
  float F = fresnel(cosV, 1.0, mix(uIor, uCapIor, capTop));
  // The frosted face blurs its reflection rather than scattering it pixel by pixel.
  vec3 reflection = cap > 0.0
    ? sceneColor(p, reflect(rd, n), 1.0, capTop * 0.015 + turn)
    : envColor(reflect(normalize(rot * rd), normalize(rot * n)), fm * uFrostGloss + turn);

  float aa = 0.5 * pixel * uLabelTexels / (2.0 * uLabelSpread * max(cosV, 0.2));
  vec3 inside = traceInside(p - n * 0.0015, refract(rd, ns, 1.0 / uIor), fm * uFrostLod, aa, grainLod, saturate(turn * 3.0));

  // Milky scatter in the frosted face (strongest in the corner facing the key light), the cap's top
  // and the bore around it.
  vec4 haze = hazeAt(p, n);
  float hazeAmount = fm * uHaze * mix(0.547, 1.408, haze.w) +
    capTop * smoothstep(0.6, 0.9, n.z) * uPillHaze +
    wellMask(p) * uHaze * 0.8;
  vec3 body = mix(inside, haze.rgb, saturate(hazeAmount));
  // The grain shows most where the face is clear, and fades under the milk.
  body *= 1.0 + fm * uGrainLight * (1.0 - 0.9 * saturate(hazeAmount)) * (g.z * 2.0 - 1.0);

  // A soft ghost of the rim inside the face: the frosted face seen via one bounce off the back face,
  // landing on the rounded rim, which leaves toward the studio.
  {
    vec3 rdIn = refract(rd, n, 1.0 / uIor);
    vec2 ghost = p.xy + rdIn.xy * (4.0 * uSlab.w / max(-rdIn.z, 0.25));
    float onRim = exp(-pow((sdRoundRect(ghost, uSlab.xy, uSlab.z) + 0.03) / 0.045, 2.0));
    if (fm * onRim > 0.001) {
      vec2 q = abs(ghost) - (uSlab.xy - uSlab.z);
      vec2 rimDir = sign(ghost) * (q.x > 0.0 && q.y > 0.0 ? normalize(q) : (q.x > q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0)));
      vec3 exitDir = refract(vec3(rdIn.xy, -rdIn.z), -normalize(vec3(rimDir, 1.0)), uIor);
      if (dot(exitDir, exitDir) > 0.5) {
        body += fm * onRim * min(fresnel(-rdIn.z, uIor, 1.0), 0.25) * envColor(normalize(rot * exitDir), 0.3);
      }
    }
  }

  // Below the face, inside the bore, less light gets in: shade the groove, and when the cap is
  // pressed in, vignette it toward its rim and dim its gloss so it reads as sunk into the glass.
  float wellSd = sdRoundRect(p.xy - pillXY(), uWell.xy, uWell.y);
  float below = max(uSlab.w - p.z, 0.0);
  float occ = (1.0 - smoothstep(-0.004, 0.004, wellSd)) * below / (below + 0.5 * max(-wellSd, 0.0) + 0.015);
  reflection *= 1.0 - 0.5 * occ;
  body *= 1.0 - 0.08 * occ;

  // The printed ink is matte: it hides the gloss instead of sitting under it.
  float ink = labelInk(p, n, aa);
  body = mix(body, uInk, ink);
  vec3 col = mix(body, reflection, F * (1.0 - ink));
  if (uDebugView == 6) col = reflection * F;
  if (uDebugView == 7) col = body * (1.0 - F);

  if (uFocus > 0.0) {
    float ring = abs(sdRoundRect(p.xy - pillXY(), uWell.xy + 0.05, uWell.y + 0.05));
    float onFace = step(0.5, n.z) * step(uSlab.w - 0.02, p.z);
    col = mix(col, uFocusColor, uFocus * onFace * (1.0 - smoothstep(0.006, 0.006 + pixel * 1.5, ring)));
  }
  return col;
}

void main() {
  vec3 ro = (uModelInv * vec4(cameraPosition, 1.0)).xyz;
  vec3 rd = normalize(vObjPos - ro);
  vec2 span = boxHit(ro, rd, uBoxMin, uBoxMax);

  // Sphere trace to the surface, remembering the closest approach (in pixels) for anti-aliasing.
  float t = max(span.x, 0.0);
  float best = 1e9;
  float bestT = t;
  bool hit = false;
  for (int i = 0; i < 160; i++) {
    float d = map(ro + rd * t);
    float pixels = d / (t * uPixelAngle);
    if (pixels < best) {
      best = pixels;
      bestT = t;
    }
    if (pixels < 0.1) {
      hit = true;
      break;
    }
    t += d;
    if (t > span.y) break;
  }
  float coverage = hit ? 1.0 : 1.0 - smoothstep(0.1, 1.1, best);
  if (!hit) t = bestT;

  vec3 p = ro + rd * t;
  vec3 n = calcNormal(p);
  p -= n * map(p);
  float pixel = t * uPixelAngle;
  // How far the normal swings across this pixel (taken before any fragment is discarded, so the
  // screen-space derivatives stay defined).
  float turn = length(fwidth(n));
  if (coverage < 0.004) discard;

  if (uDebugView == 1) {
    outColor = vec4((n * 0.5 + 0.5) * coverage, coverage);
    return;
  }

  // On the rounded rims, through the button's fine edges, and in the band inside the outline where
  // inside rays switch between leaving and reflecting, neighbouring rays take very different paths,
  // which a single ray per pixel turns into speckle and stair-steps. There, average a few sub-pixel
  // rays (rotated-grid pattern), each shaded in full.
  float curved = 1.0 - smoothstep(0.92, 0.99, abs(n.z));
  vec3 buttonLo = vec3(pillXY() - uPillBound.xy, uPillBound.w - uPillBound.z);
  vec3 buttonHi = vec3(pillXY() + uPillBound.xy, uPillBound.w + uPillBound.z);
  vec2 button = boxHit(ro, rd, buttonLo, buttonHi);
  bool overButton = button.y > max(button.x, 0.0);
  bool nearOutline = sdRoundRect(p.xy, uSlab.xy, uSlab.z) > -uSlab.w;
  bool fine = curved > 0.0 || overButton || nearOutline;

  vec3 col = vec3(0.0);
  if (fine && uRimSamples > 1) {
    mat3 rot = mat3(uModel);
    vec3 right = transpose(rot) * uCamRight;
    vec3 up = transpose(rot) * uCamUp;
    float count = 0.0;
    float covered = 0.0;
    for (int k = 0; k < 4; k++) {
      if (k >= uRimSamples) break;
      vec2 o = k == 0 ? vec2(-0.375, -0.125) : k == 1 ? vec2(0.125, -0.375) : k == 2 ? vec2(0.375, 0.125) : vec2(-0.125, 0.375);
      vec3 rdk = normalize(rd + (right * o.x + up * o.y) * uPixelAngle);
      float tk = t - 4.0 * pixel;
      float dk = 1.0;
      float bestK = 1e9;
      for (int i = 0; i < 24; i++) {
        dk = map(ro + rdk * tk);
        bestK = min(bestK, dk / (tk * uPixelAngle));
        if (abs(dk) < 0.05 * pixel) break;
        tk += dk;
      }
      // A sub-ray that misses still says how much of the pixel the glass covers, but adds no colour.
      bool hitK = abs(dk) <= 0.5 * pixel;
      covered += hitK ? 1.0 : 1.0 - smoothstep(0.05, 0.55, bestK);
      if (!hitK) continue;
      vec3 pk = ro + rdk * tk;
      // Each sub-ray covers a quarter of the pixel, so it sees half the swing; over the button the
      // sub-rays already anti-alias, and extra blur would smudge its crisp seam.
      col += shade(rdk, pk, calcNormal(pk), tk, overButton ? 0.0 : 0.5 * turn);
      count += 1.0;
    }
    if (count > 0.0) {
      col /= count;
      coverage = min(coverage, covered / float(uRimSamples));
    } else {
      col = shade(rd, p, n, t, turn);
    }
  } else {
    col = shade(rd, p, n, t, turn);
  }

  if (uDebugView == 2) {
    outColor = vec4((gFirstExit * 0.5 + 0.5) * coverage, coverage);
    return;
  }
  if (uDebugView == 3) {
    float e = gEffort / 128.0;
    outColor = vec4(vec3(e, 1.0 - abs(e * 2.0 - 1.0), 1.0 - e) * coverage, coverage);
    return;
  }
  if (uDebugView == 4) {
    outColor = vec4((gFirstNormal * 0.5 + 0.5) * coverage, coverage);
    return;
  }
  if (uDebugView == 5) {
    outColor = vec4(vec3(gFirstFresnel) * coverage, coverage);
    return;
  }

  vec3 srgb = linearToSrgb(softClip(col)) + (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(srgb * coverage, coverage);
}
