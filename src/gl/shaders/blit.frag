uniform sampler2D uBackdrop;

in vec2 vUv;
out vec4 outColor;

void main() {
  vec3 c = texture(uBackdrop, vUv).rgb;
  // Dither so the long, shallow gradient doesn't band.
  vec3 s = linearToSrgb(c) + (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(s, 1.0);
}
