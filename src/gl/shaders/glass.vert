// A unit cube stretched over the glass's bounds; the fragment shader ray traces inside it.

in vec3 position;

uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;

out vec3 vObjPos;

void main() {
  vObjPos = mix(uBoxMin, uBoxMax, position + 0.5);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(vObjPos, 1.0);
}
