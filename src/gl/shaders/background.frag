// The page behind the glass: the diagonal gradient, plus the slab's shadow on an invisible floor.
// Drawn at half resolution into a mipmapped target that the glass samples (and blurs) through.

uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform mat4 uModelInv;
uniform vec3 uObjPos;
uniform float uAspect;
uniform float uAngle;
uniform vec3 uStops[8];
uniform float uStopAt[8];
uniform int uStopCount;
uniform float uFloorY;
uniform vec2 uShadowShear;   // the key light's horizontal run per unit of height: L.xz / L.y
uniform vec2 uShadowOffset;
uniform float uShadowSpread;
uniform float uShadowBlur;
uniform float uShadowStrength;
uniform vec3 uShadowColor;   // sRGB

in vec2 vUv;
out vec4 outColor;

// CSS-style linear gradient: an angle, stops in sRGB, interpolated in sRGB the way browsers do.
vec3 pageGradient(vec2 uv) {
  vec2 p = vec2((uv.x - 0.5) * uAspect, 0.5 - uv.y);
  vec2 dir = vec2(sin(uAngle), -cos(uAngle));
  float len = abs(uAspect * sin(uAngle)) + abs(cos(uAngle));
  float t = 0.5 + dot(p, dir) / len;
  vec3 c = uStops[0];
  for (int i = 1; i < 8; i++) {
    if (i >= uStopCount) break;
    float span = max(uStopAt[i] - uStopAt[i - 1], 1e-5);
    c = mix(c, uStops[i], clamp((t - uStopAt[i - 1]) / span, 0.0, 1.0));
  }
  return srgbToLinear(c);
}

// How dark the slab's shadow is at a floor point: its footprint as an oriented Gaussian. The slab's
// three half-axes, cast onto the floor along the key light, give the spread, so the ellipse tilts,
// stretches and narrows with every pose; a fixed blur softens it, and rising off the floor softens
// it further.
float floorShadow(vec3 floorHit) {
  mat3 rot = transpose(mat3(uModelInv));
  vec2 a0 = rot[0].xz - uShadowShear * rot[0].y;
  vec2 a1 = rot[1].xz - uShadowShear * rot[1].y;
  vec2 a2 = rot[2].xz - uShadowShear * rot[2].y;
  float lift = max(uObjPos.y, -0.2);
  float blur = uShadowBlur * uShadowBlur + 0.4 * lift;
  mat2 spread = (uShadowSpread / 3.0) * (
    outerProduct(a0, a0) * uSlab.x * uSlab.x +
    outerProduct(a1, a1) * uSlab.y * uSlab.y +
    outerProduct(a2, a2) * uSlab.w * uSlab.w
  ) + mat2(blur);
  vec2 q = floorHit.xz - uObjPos.xz - uShadowOffset;
  return uShadowStrength * (1.0 - 1.5 * lift) * exp(-0.5 * dot(q, inverse(spread) * q));
}

void main() {
  vec3 col = pageGradient(vUv);

  vec4 far = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rd = normalize(far.xyz / far.w - uCamPos);
  if (rd.y < -1e-4) {
    vec3 floorHit = uCamPos + rd * ((uFloorY - uCamPos.y) / rd.y);
    // Blend the page toward one deep teal in sRGB, as the reference's shadow does: the edges keep
    // the page's hue and the core sinks to saturated teal.
    float a = min(floorShadow(floorHit), 1.0);
    col = srgbToLinear(mix(linearToSrgb(col), uShadowColor, a));
  }

  outColor = vec4(col, 1.0);
}
