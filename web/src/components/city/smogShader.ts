import * as THREE from "three";

// Volumetric-ish haze: stacked translucent planes sampling a per-cell data
// texture (R=before, G=after optimistic, B=after conservative, A=uncertainty).
// Linear filtering gives smooth gradients between grid cells for free.

export const smogVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

export const smogFragment = /* glsl */ `
  uniform sampler2D uData;
  uniform float uN;
  uniform float uMix;
  uniform float uTime;
  uniform float uLayer;
  uniform float uOpacity;
  uniform float uHatch;
  uniform float uFocus;
  varying vec3 vWorld;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
  vec3 aqiColor(float a) {
    vec3 c0 = vec3(0.31, 0.70, 0.42);
    vec3 c1 = vec3(0.64, 0.78, 0.33);
    vec3 c2 = vec3(0.91, 0.81, 0.28);
    vec3 c3 = vec3(0.95, 0.61, 0.20);
    vec3 c4 = vec3(0.91, 0.28, 0.23);
    vec3 c5 = vec3(0.62, 0.14, 0.24);
    if (a < 75.0) return mix(c0, c1, a / 75.0);
    if (a < 150.0) return mix(c1, c2, (a - 75.0) / 75.0);
    if (a < 250.0) return mix(c2, c3, (a - 150.0) / 100.0);
    if (a < 350.0) return mix(c3, c4, (a - 250.0) / 100.0);
    return mix(c4, c5, clamp((a - 350.0) / 120.0, 0.0, 1.0));
  }
  void main() {
    vec2 uv = (vWorld.xz + uN * 0.5) / uN;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
    vec4 d = texture2D(uData, uv);
    float before = d.r * 500.0;
    float mid = (d.g + d.b) * 250.0;
    float unc = d.a;
    float v = mix(before, mid, uMix);

    vec2 p = vWorld.xz * 0.32 + vec2(uTime * 0.035, -uTime * 0.02) + uLayer * 3.7;
    float n = fbm(p);
    float density = smoothstep(60.0, 460.0, v);
    float a = density * density * (0.25 + 1.1 * n) * uOpacity;

    // Thin sensor coverage: hatch the haze instead of pretending to know.
    float stripe = smoothstep(0.42, 0.5, fract((vWorld.x - vWorld.z) * 0.9 + uTime * 0.08));
    float h = smoothstep(0.45, 0.95, unc) * uHatch;
    a *= mix(1.0, 0.45 + 0.55 * stripe, h);

    // soft edge fade at diorama border
    vec2 e = min(uv, 1.0 - uv);
    a *= smoothstep(0.0, 0.12, min(e.x, e.y));

    vec3 col = aqiColor(v);
    col = mix(col, vec3(0.56, 0.52, 0.5), 0.45);
    col = mix(col, vec3(1.0), 0.1 * n);
    gl_FragColor = vec4(col, a);
  }
`;

export function makeSmogMaterial(tex: THREE.DataTexture, n: number, layer: number, opacity: number) {
  return new THREE.ShaderMaterial({
    vertexShader: smogVertex,
    fragmentShader: smogFragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uData: { value: tex },
      uN: { value: n },
      uMix: { value: 0 },
      uTime: { value: 0 },
      uLayer: { value: layer },
      uOpacity: { value: opacity },
      uHatch: { value: 1 },
      uFocus: { value: 0 },
    },
  });
}

export function fieldTexture(n: number) {
  const data = new Uint8Array(n * n * 4);
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export function writeField(tex: THREE.DataTexture, before: Float32Array, lo: Float32Array, hi: Float32Array, unc: Float32Array) {
  const d = tex.image.data as Uint8Array;
  for (let i = 0; i < before.length; i++) {
    d[i * 4] = Math.min(255, (before[i] / 500) * 255);
    d[i * 4 + 1] = Math.min(255, (lo[i] / 500) * 255);
    d[i * 4 + 2] = Math.min(255, (hi[i] / 500) * 255);
    d[i * 4 + 3] = Math.min(255, unc[i] * 255);
  }
  tex.needsUpdate = true;
}
