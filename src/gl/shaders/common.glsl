float saturate(float x) {
  return clamp(x, 0.0, 1.0);
}

// Dave Hoskins' hash without sine.
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

vec3 linearToSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

// Unpolarised Fresnel reflectance of a dielectric interface; 1 under total internal reflection.
float fresnel(float cosI, float etaI, float etaT) {
  cosI = saturate(cosI);
  float sinT = etaI / etaT * sqrt(max(0.0, 1.0 - cosI * cosI));
  if (sinT >= 1.0) return 1.0;
  float cosT = sqrt(max(0.0, 1.0 - sinT * sinT));
  float rs = (etaT * cosI - etaI * cosT) / (etaT * cosI + etaI * cosT);
  float rp = (etaI * cosI - etaT * cosT) / (etaI * cosI + etaT * cosT);
  return 0.5 * (rs * rs + rp * rp);
}
