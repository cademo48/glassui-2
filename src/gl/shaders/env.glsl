// The studio the glass sits in, as seen in its reflections: a soft sky-to-floor gradient plus a few
// rectangular softboxes. World space; the lights stay put while the slab turns, so its highlights
// slide across the surface the way they would on a real object.

uniform vec3 uEnvZenith;
uniform vec3 uEnvHorizon;
uniform vec3 uEnvGround;
uniform mat3 uLightFrame[4];  // columns: right, up, toward the light
uniform vec4 uLightRect[4];   // half width, half height, corner radius, edge softness (tangent plane)
uniform float uLightSoftY[4]; // extra softness along the height only; 0 = rounded box
uniform vec3 uLightColor[4];
uniform int uLightCount;

float rectLight(vec3 d, mat3 frame, vec4 rect, float softY, float blur) {
  float z = dot(d, frame[2]);
  if (z <= 0.02) return 0.0;
  vec2 q = vec2(dot(d, frame[0]), dot(d, frame[1])) / z;
  float soft = rect.w + blur;
  if (softY > 0.0) {
    // A box with a crisp side edge that fades out along its height.
    vec2 e = abs(q) - rect.xy;
    return (1.0 - smoothstep(-soft, soft, e.x)) * (1.0 - smoothstep(-soft - softY, soft + softY, e.y));
  }
  return 1.0 - smoothstep(-soft, soft, sdRoundRect(q, rect.xy, rect.z));
}

vec3 envColor(vec3 d, float blur) {
  vec3 c = mix(uEnvHorizon, uEnvZenith, smoothstep(0.0, 0.9, d.y));
  c = mix(c, uEnvGround, 1.0 - smoothstep(-0.5, 0.02, d.y));
  for (int i = 0; i < 4; i++) {
    if (i >= uLightCount) break;
    c += uLightColor[i] * rectLight(d, uLightFrame[i], uLightRect[i], uLightSoftY[i], blur);
  }
  return c;
}
