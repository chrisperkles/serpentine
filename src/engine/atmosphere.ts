// Shared atmosphere: one set of uniforms drives the sky dome and the aerial perspective
// (height fog + sun-tinted in-scattering) and Earth curvature of every world material.

import * as THREE from 'three';
import { markShared } from './dispose.ts';

export interface TimeOfDay {
  id: string;
  label: string;
  sunElevation: number; // degrees
  sunAzimuth: number; // degrees, 0 = north, clockwise
  sun: [number, number, number];
  sunIntensity: number;
  zenith: [number, number, number];
  horizon: [number, number, number];
  ambientSky: [number, number, number];
  ambientGround: [number, number, number];
  ambientIntensity: number;
  haze: number; // fog density at sea level, 1/m
  cloudCover: number; // 0..1
  /** Valley-fog inversion: fog top in metres above the route's lowest point. */
  fogAbove?: number;
}

export const TIMES: TimeOfDay[] = [
  {
    id: 'morning', label: 'Morning', sunElevation: 16, sunAzimuth: 115,
    sun: [1.0, 0.88, 0.72], sunIntensity: 3.2,
    zenith: [0.06, 0.2, 0.55], horizon: [0.62, 0.72, 0.86],
    ambientSky: [0.6, 0.66, 0.76], ambientGround: [0.36, 0.32, 0.26], ambientIntensity: 1.3,
    haze: 4.2e-5, cloudCover: 0.35,
  },
  {
    // Salzburg in mid-October: the sun only reaches ~35° at noon
    id: 'noon', label: 'Midday', sunElevation: 35, sunAzimuth: 185,
    sun: [1.0, 0.96, 0.9], sunIntensity: 3.4,
    zenith: [0.04, 0.17, 0.52], horizon: [0.58, 0.7, 0.86],
    ambientSky: [0.6, 0.67, 0.8], ambientGround: [0.36, 0.33, 0.27], ambientIntensity: 1.3,
    haze: 3.2e-5, cloudCover: 0.45,
  },
  {
    id: 'golden', label: 'Golden hour', sunElevation: 11, sunAzimuth: 242,
    sun: [1.0, 0.74, 0.46], sunIntensity: 3.5,
    zenith: [0.05, 0.19, 0.52], horizon: [0.96, 0.76, 0.54],
    ambientSky: [0.52, 0.56, 0.74], ambientGround: [0.34, 0.26, 0.2], ambientIntensity: 1.25,
    haze: 5.0e-5, cloudCover: 0.4,
  },
  {
    id: 'inversion', label: 'Nebelmeer', sunElevation: 14, sunAzimuth: 135,
    sun: [1.0, 0.9, 0.76], sunIntensity: 3.3,
    zenith: [0.05, 0.19, 0.55], horizon: [0.66, 0.76, 0.9],
    ambientSky: [0.62, 0.68, 0.8], ambientGround: [0.4, 0.38, 0.34], ambientIntensity: 1.3,
    haze: 2.4e-5, cloudCover: 0.12, fogAbove: 250,
  },
  {
    id: 'dusk', label: 'Alpenglühen', sunElevation: 2.5, sunAzimuth: 280,
    sun: [1.0, 0.45, 0.25], sunIntensity: 2.8,
    zenith: [0.05, 0.08, 0.24], horizon: [0.95, 0.46, 0.3],
    ambientSky: [0.4, 0.38, 0.58], ambientGround: [0.22, 0.17, 0.15], ambientIntensity: 1.1,
    haze: 6.0e-5, cloudCover: 0.5,
  },
];

export const EARTH_R = 6371000;

export const WHITE_TEX = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
WHITE_TEX.needsUpdate = true;
markShared(WHITE_TEX);

export const MAX_TUNNEL_PTS = 32;
export const MAX_TUNNELS = 4;

/** Tunnel centre lines for lighting and terrain portals (Tunnel.ts), all tunnels in one point list. */
export const tunnelUniforms = {
  /** x, ele, z, s along the route */
  uTunnelPts: { value: Array.from({ length: MAX_TUNNEL_PTS }, () => new THREE.Vector4()) },
  /** per tunnel: inside from s, inside to s, first point, point count */
  uTunnelSpan: { value: Array.from({ length: MAX_TUNNELS }, () => new THREE.Vector4()) },
  /** per tunnel: ceiling lamps (0/1), metres over which "inside" fades in at the portals */
  uTunnelMeta: { value: Array.from({ length: MAX_TUNNELS }, () => new THREE.Vector4()) },
  /** per tunnel: centre xyz + radius; fragments outside skip it */
  uTunnelBound: { value: Array.from({ length: MAX_TUNNELS }, () => new THREE.Vector4(0, -1e6, 0, 0)) },
  uTunnelCount: { value: 0 },
  uTunnelHalf: { value: 4 },
};

export function clearTunnels() {
  tunnelUniforms.uTunnelCount.value = 0;
}

/** Terrain cast-shadow texture (TerrainShadow.ts) over a world rect. */
export const terrainShadowUniforms = {
  uTShadow: { value: WHITE_TEX as THREE.Texture },
  /** x0, z0, size, enabled */
  uTShadowRect: { value: new THREE.Vector4(0, 0, 1, 0) },
};

export const atmo = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color() },
  uZenith: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uFogDensity: { value: 4e-5 },
  uFogHeight: { value: 2600 },
  uFogBase: { value: 0 },
  uCurv: { value: 1 / (2 * EARTH_R) },
  uTime: { value: 0 },
  uCloudCover: { value: 0.4 },
  uHorizonY: { value: 0 },
  /** Valley-fog layer top (m above sea level); far below the terrain when off. */
  uFogTop: { value: -1e4 },
  /** Extinction inside the fog layer, 1/m. */
  uFogLayer: { value: 1 / 170 },
};

export function sunDirection(t: TimeOfDay): THREE.Vector3 {
  const el = THREE.MathUtils.degToRad(t.sunElevation);
  const az = THREE.MathUtils.degToRad(t.sunAzimuth);
  // azimuth 0 = north (-Z), 90 = east (+X)
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}

export function applyTime(t: TimeOfDay) {
  atmo.uSunDir.value.copy(sunDirection(t));
  atmo.uSunColor.value.setRGB(...t.sun);
  atmo.uZenith.value.setRGB(...t.zenith);
  atmo.uHorizon.value.setRGB(...t.horizon);
  atmo.uFogDensity.value = t.haze;
  atmo.uCloudCover.value = t.cloudCover;
}

export const ATMO_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uFogDensity;
uniform float uFogHeight;
uniform float uFogBase;
uniform float uTime;
uniform float uFogTop;
uniform float uFogLayer;

float atmoHash(vec2 p) { return fract(sin(dot(p, vec2(41.7, 289.3))) * 43758.5453); }
float atmoNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(atmoHash(i), atmoHash(i + vec2(1, 0)), u.x), mix(atmoHash(i + vec2(0, 1)), atmoHash(i + vec2(1, 1)), u.x), u.y);
}
/** Billowy top of the valley-fog sea, drifting slowly. */
float atmoFogTop(vec2 xz) {
  vec2 q = xz / 700.0 + vec2(uTime * 0.0018, uTime * 0.0011);
  return uFogTop + (atmoNoise(q) - 0.5) * 50.0 + (atmoNoise(q * 4.3 + 7.1) - 0.5) * 16.0;
}
/** Colour of the fog: sunlit white on top, dim grey-blue deep inside. */
vec3 atmoFogColour(float depth) {
  vec3 lit = uSunColor * (0.55 + 0.45 * clamp(uSunDir.y * 3.0, 0.0, 1.0)) * 1.05 + uZenith * 0.18;
  vec3 inside = mix(uHorizon, vec3(0.62, 0.66, 0.7), 0.6) * 0.82;
  return mix(lit, inside, clamp(depth / 160.0, 0.0, 1.0));
}

vec3 atmoSky(vec3 rd) {
  float h = clamp(rd.y, 0.0, 1.0);
  // horizon is warm towards the sun and cool/blue away from it
  vec2 fl = rd.xz / max(length(rd.xz), 1e-4);
  vec2 sl = uSunDir.xz / max(length(uSunDir.xz), 1e-4);
  float sunSide = pow(clamp(0.5 + 0.5 * dot(fl, sl), 0.0, 1.0), 2.2);
  vec3 coolHorizon = mix(uZenith, vec3(0.82, 0.88, 0.96), 0.62);
  vec3 horizon = mix(coolHorizon, uHorizon, sunSide * (1.0 - smoothstep(0.35, 0.9, uSunDir.y)) + smoothstep(0.35, 0.9, uSunDir.y) * 0.5);
  vec3 col = mix(horizon, uZenith, 1.0 - exp(-h * 5.5));
  float sd = max(dot(rd, uSunDir), 0.0);
  col += uSunColor * (0.16 * pow(sd, 5.0) + 0.5 * pow(sd, 42.0));
  col += horizon * 0.1 * (1.0 - smoothstep(0.0, 0.1, abs(rd.y)));
  return col;
}

vec3 atmoApply(vec3 col, vec3 worldPos) {
  vec3 ro = cameraPosition;
  vec3 d = worldPos - ro;
  float dist = max(length(d), 1e-3);
  vec3 rd = d / dist;
  float b = 1.0 / uFogHeight;
  float a = uFogDensity * exp(-(ro.y - uFogBase) * b);
  float k = rd.y * b;
  float amount = abs(k) < 1e-5 ? a * dist : a * (1.0 - exp(-k * dist)) / k;
  float T = exp(-amount);
  vec3 scatter = atmoSky(vec3(rd.x, max(rd.y, 0.0) * 0.5, rd.z));
  col = col * T + scatter * (1.0 - T);
  if (uFogTop > -1000.0) {
    // length of the view ray inside the fog layer
    float top = atmoFogTop(worldPos.xz);
    float y0 = ro.y, y1 = worldPos.y;
    float lo = min(y0, y1), hi = max(y0, y1);
    float inside = hi <= top ? 1.0 : lo >= top ? 0.0 : (top - lo) / max(hi - lo, 1e-3);
    float Tf = exp(-uFogLayer * dist * inside);
    float depth = max(top - worldPos.y, 0.0);
    vec3 fc = atmoFogColour(depth) * (0.93 + 0.12 * atmoNoise(worldPos.xz / 260.0 + uTime * 0.004));
    col = col * Tf + fc * (1.0 - Tf);
  }
  return col;
}
`;

/**
 * How much direct sun reaches a world point: terrain cast shadows times cloud shadows.
 * The cloud field matches the sky dome's layer (5 km above the camera, Sky.ts).
 */
const SUNVIS_GLSL = /* glsl */ `
uniform sampler2D uTShadow;
uniform vec4 uTShadowRect;
uniform float uCloudCover;
float svHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float svNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(svHash(i), svHash(i + vec2(1, 0)), u.x), mix(svHash(i + vec2(0, 1)), svHash(i + vec2(1, 1)), u.x), u.y);
}
float atmoCloudShadow(vec3 wp) {
  if (uSunDir.y < 0.01 || uCloudCover < 0.01) return 1.0;
  float s = (cameraPosition.y + 5000.0 - wp.y) / uSunDir.y;
  vec2 p = (wp.xz + uSunDir.xz * s) / 9000.0 + vec2(uTime * 0.004, uTime * 0.0015);
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 4; i++) { v += a * svNoise(p); p = m * p; a *= 0.5; }
  float cover = 1.0 - uCloudCover;
  float dens = smoothstep(cover - 0.05, cover + 0.3, v + 0.03);
  return 1.0 - 0.82 * dens;
}
float atmoShadowFade(vec4 c) {
  vec2 q = c.xy / c.w;
  float e = min(min(q.x, q.y), min(1.0 - q.x, 1.0 - q.y));
  return smoothstep(0.0, 0.15, e);
}
float atmoSunVisibility(vec3 wp) {
  float v = 1.0;
  if (uTShadowRect.w > 0.5) {
    vec2 uv = (wp.xz - uTShadowRect.xy) / uTShadowRect.z;
    if (all(greaterThan(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0)))) v = texture2D(uTShadow, uv).r;
  }
  if (uFogTop > -1000.0) {
    float below = max(atmoFogTop(wp.xz) - wp.y, 0.0);
    v *= exp(-uFogLayer * 0.7 * below / max(uSunDir.y, 0.15));
  }
  // inside a tunnel bore the sun never reaches (the shadow texture describes the mountain surface)
  v *= 1.0 - atmoTunnel(wp).x;
  return v * atmoCloudShadow(wp);
}
`;

/**
 * Inside a road tunnel: x = 0..1 inside the bore, y = lamp light. Ceiling lamps every 12 m at
 * 5.8 m above the road, white LED.
 */
export const TUNNEL_GLSL = /* glsl */ `
uniform vec4 uTunnelPts[${MAX_TUNNEL_PTS}];
uniform vec4 uTunnelSpan[${MAX_TUNNELS}];
uniform vec4 uTunnelMeta[${MAX_TUNNELS}];
uniform vec4 uTunnelBound[${MAX_TUNNELS}];
uniform int uTunnelCount;
uniform float uTunnelHalf;
// x: inside a tunnel bore (0..1), y: ceiling lamp light
vec2 atmoTunnel(vec3 wp) {
  for (int k = 0; k < ${MAX_TUNNELS}; k++) {
    if (k >= uTunnelCount) break;
    vec4 bd = uTunnelBound[k];
    if (distance(wp, bd.xyz) > bd.w) continue;
    vec4 sp = uTunnelSpan[k];
    int i0 = int(sp.z);
    int cnt = int(sp.w);
    float best = 1e9; float bs = 0.0; float by = 0.0;
    for (int i = 0; i < ${MAX_TUNNEL_PTS - 1}; i++) {
      if (i + 1 >= cnt) break;
      vec4 a = uTunnelPts[i0 + i]; vec4 b = uTunnelPts[i0 + i + 1];
      vec2 ab = b.xz - a.xz;
      float t = clamp(dot(wp.xz - a.xz, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
      float d = length(wp.xz - a.xz - ab * t);
      if (d < best) { best = d; bs = mix(a.w, b.w, t); by = mix(a.y, b.y, t); }
    }
    float r = uTunnelMeta[k].y;
    float along = smoothstep(sp.x - r, sp.x + 2.0 * r, bs) * (1.0 - smoothstep(sp.y - 2.0 * r, sp.y + r, bs));
    float inside = along * (1.0 - smoothstep(uTunnelHalf - 0.2, uTunnelHalf + 0.6, best)) * (1.0 - smoothstep(by + 6.2, by + 7.0, wp.y)) * step(by - 1.5, wp.y);
    if (inside <= 0.0) continue;
    float sl = (floor((bs - sp.x) / 9.0) + 0.5) * 9.0 + sp.x;
    float ds = bs - sl;
    float dy = by + 5.8 - wp.y;
    float lamp = 0.0;
    for (int j = -1; j <= 1; j++) {
      float dd = ds - float(j) * 9.0;
      lamp += 1.0 / (1.0 + (dd * dd + dy * dy + best * best) * 0.09);
    }
    return vec2(inside, lamp * inside * uTunnelMeta[k].x);
  }
  return vec2(0.0);
}
`;

const LIGHTS_WITH_SUNVIS =
  'float atmoSunVis = atmoSunVisibility(vAtmoWorld);\n' +
  THREE.ShaderChunk.lights_fragment_begin
    .replace(
      'getDirectionalLightInfo( directionalLight, directLight );',
      'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= atmoSunVis;',
    )
    // the sun's shadow map covers a box around the rider: fade shadows out towards its edge
    // so they never end in a straight line
    .replace(
      'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;',
      'directLight.color *= ( directLight.visible && receiveShadow ) ? mix( 1.0, getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ), atmoShadowFade( vDirectionalShadowCoord[ i ] ) ) : 1.0;',
    );

/**
 * Inject curvature + aerial perspective into a built-in material.
 * Works for Lambert/Standard/Basic incl. instancing.
 */
export function patchMaterial<T extends THREE.Material>(
  mat: T,
  opts: { wind?: boolean; key?: string; depthBias?: number } = {},
): T {
  // idempotent: a material (or a clone that copied the hook) must not be patched twice
  if ((mat.onBeforeCompile as { atmo?: boolean }).atmo) return mat;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, atmo, terrainShadowUniforms, tunnelUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uCurv;
uniform float uTime;
varying vec3 vAtmoWorld;`,
      )
      .replace(
        '#include <project_vertex>',
        `vec4 atmoWp = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
atmoWp = instanceMatrix * atmoWp;
#endif
atmoWp = modelMatrix * atmoWp;
${
  opts.wind
    ? `float sway = max(position.y, 0.0);
atmoWp.x += sin(uTime * 1.3 + atmoWp.x * 0.05 + atmoWp.z * 0.03) * 0.22 * sway;
atmoWp.z += cos(uTime * 1.1 + atmoWp.z * 0.05) * 0.16 * sway;`
    : ''
}
vec2 atmoDxz = atmoWp.xz - cameraPosition.xz;
atmoWp.y -= dot(atmoDxz, atmoDxz) * uCurv;
vAtmoWorld = atmoWp.xyz;
${
  opts.depthBias
    ? `vec3 atmoToCam = cameraPosition - atmoWp.xyz;
float atmoDc = max(length(atmoToCam), 1e-3);
atmoWp.xyz += atmoToCam / atmoDc * min(atmoDc * ${opts.depthBias.toFixed(5)}, 8.0);`
    : ''
}
vec4 mvPosition = viewMatrix * atmoWp;
gl_Position = projectionMatrix * mvPosition;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vAtmoWorld;
${ATMO_GLSL}
${TUNNEL_GLSL}
${SUNVIS_GLSL}`,
      )
      .replace('#include <lights_fragment_begin>', LIGHTS_WITH_SUNVIS)
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
{
  // tunnels: almost no skylight inside, white ceiling lamps instead
  vec2 tun = atmoTunnel(vAtmoWorld);
  if (tun.x > 0.0) {
    reflectedLight.indirectDiffuse *= 1.0 - 0.93 * tun.x;
    reflectedLight.indirectSpecular *= 1.0 - 0.9 * tun.x;
    reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(1.0, 0.95, 0.86) * tun.y * 0.6;
  }
}`,
      )
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = atmoApply(gl_FragColor.rgb, vAtmoWorld);');
  };
  (mat.onBeforeCompile as { atmo?: boolean }).atmo = true;
  mat.customProgramCacheKey = () => `atmo:${opts.key ?? ''}:${opts.wind ? 'w' : ''}:${mat.type}`;
  return mat;
}
