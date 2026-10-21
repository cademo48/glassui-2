// Signed distance field of the glass: a thick rounded slab with a pill-shaped well cut into its front
// face and a domed cap sitting in the well. Object space, front face toward +z.
// Mirrored on the CPU in src/scene/sdf.ts; keep the two in step.

uniform vec4 uSlab;       // half width, half height, corner radius, half thickness
uniform float uSlabEdge;  // radius of the rounded edges
uniform vec4 uWell;       // half width, half height, depth, lip blend
uniform vec4 uPill;       // half width, half height, half thickness, edge radius
uniform float uPillZ;     // cap centre z; moves when pressed
uniform float uPillX;     // cap and well centre on the face
uniform float uPillY;
uniform float uPillDome;
uniform float uPillFillet;
uniform vec4 uPillBound;  // half extents of the box around well and cap, and its centre z

const float BOUND_MARGIN = 0.04;

// The button's centre on the face.
vec2 pillXY() {
  return vec2(uPillX, uPillY);
}

float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// Rounded rectangle (half size b, corner radius rc) extruded to half thickness ht, with every edge
// rounded to radius re.
float sdRoundSlab(vec3 p, vec2 b, float rc, float ht, float re) {
  float d = sdRoundRect(p.xy, b - re, max(rc - re, 0.0));
  vec2 w = vec2(d, abs(p.z) - ht + re);
  return min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - re;
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float smax(float a, float b, float k) {
  float h = clamp(0.5 - 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) + k * h * (1.0 - h);
}

float sdPill(vec3 p) {
  vec3 q = vec3(p.xy - pillXY(), p.z - uPillZ);
  float d = sdRoundSlab(q, uPill.xy, uPill.y, uPill.z, uPill.w);
  // A gentle dome on top, so the cap catches the overhead light.
  float inner = clamp(-sdRoundRect(q.xy, uPill.xy, uPill.y) / uPill.y, 0.0, 1.0);
  return d - uPillDome * inner * (2.0 - inner) * smoothstep(-0.02, 0.02, q.z);
}

// The bore's floor corners are rounded by a fixed small radius, so a deep bore keeps straight walls
// (a radius tied to the depth would pinch the bore around a pressed cap).
float sdWellCutter(vec3 p) {
  return sdRoundSlab(vec3(p.xy - pillXY(), p.z - uSlab.w), uWell.xy, uWell.y, uWell.z, min(0.03, uWell.y));
}

float map(vec3 p) {
  float slab = sdRoundSlab(p, uSlab.xy, uSlab.z, uSlab.w, uSlabEdge);
  vec3 dq = abs(vec3(p.xy - pillXY(), p.z - uPillBound.w)) - uPillBound.xyz;
  float bound = length(max(dq, 0.0)) + min(max(dq.x, max(dq.y, dq.z)), 0.0);
  // Away from the button only the slab matters; the bound stops a step from skipping into it.
  if (bound > BOUND_MARGIN) return slab >= 0.0 ? min(slab, bound) : max(slab, -bound);
  float body = smax(slab, -sdWellCutter(p), uWell.w);
  return smin(body, sdPill(p), uPillFillet);
}
