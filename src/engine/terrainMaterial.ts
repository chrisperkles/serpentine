// Terrain shading: orthophoto as base colour, plus close-range material synthesis.
// The photo is classified per pixel (grass / rock / snow) to add high-frequency
// detail and surface relief near the camera; water (OSM mask or sea level) gets
// sky reflections, waves and sun glints.

import * as THREE from 'three';
import { patchMaterial } from './atmosphere.ts';
import { groundTextures, PAVING_GLSL } from './groundTextures.ts';
import type { Biome } from './biome.ts';
import { markShared } from './dispose.ts';

const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
blank.needsUpdate = true;
markShared(blank);

export const terrainUniforms = {
  uWaterMask: { value: blank as THREE.Texture },
  uCanopy: { value: blank as THREE.Texture },
  uGrassTex: { value: blank as THREE.Texture },
  uRockTex: { value: blank as THREE.Texture },
  uGravelTex: { value: blank as THREE.Texture },
  uMaskOrigin: { value: new THREE.Vector2(0, 0) },
  /** Biome: push OSM meadows to mown green (Alps), read grey ground as limestone (karst), photo sea. */
  uMeadowPush: { value: 1 },
  uBareAbove: { value: 1e5 },
  uKarst: { value: 0 },
  uPhotoSea: { value: 0 },
  /** Mediterranean rock faces (Poly Haven marble_cliff_02, CC0), tri-planar near the camera. */
  uCliffTex: { value: blank as THREE.Texture },
  uCliffNor: { value: blank as THREE.Texture },
  /** Slope range where the cliff scan takes over, and the share of warm ochre in it (biome.cliffSlope, rockOchre). */
  uCliffSlope: { value: new THREE.Vector2(0.42, 0.62) },
  uRockOchre: { value: 1 },
  uMaskSize: { value: new THREE.Vector2(1, 1) },
  /** R beach sand, G sandstone (OSM bare rock and cliffs); blank (all zero) on routes without them. */
  uSurface: { value: blank as THREE.Texture },
  uStoneTint: { value: new THREE.Vector3(1.0, 0.98, 0.94) },
  uStoneLum: { value: 0.36 },
  uSandTint: { value: new THREE.Vector3(1, 1, 1) },
  uSandOn: { value: 0 },
  uMeadowTint: { value: new THREE.Vector3(1, 1, 1) },
  /** City street (biome.streets): pavement beside the road, lawn only inside OSM parks (mask G). */
  uStreet: { value: 0 },
  /**
   * City ground (biome.lawn, streets, suburb): a procedural turf, pavement, litter, sand and sandstone within ~100 m
   * of the camera, the photo only for colour and layout beyond. uCityKind: 0 park (Central Park), 1 street (Vienna),
   * 2 suburb (Sydney). Colours are linear albedo.
   */
  uCity: { value: 0 },
  uCityKind: { value: 0 },
  uLawnTex: { value: blank as THREE.Texture },
  /** Vegetated cut banks (biome.banks, Alpine lowland): earth, moss and root detail for steep ground near the road. */
  uBankTex: { value: blank as THREE.Texture },
  uBanks: { value: 0 },
  uGrLawn: { value: new THREE.Vector3(0.16, 0.25, 0.07) },
  uGrLeaf: { value: new THREE.Vector3(0.36, 0.17, 0.04) },
  uGrPave: { value: new THREE.Vector3(0.26, 0.255, 0.24) },
};

/** Beach and sandstone mask over the same area as the water mask (Sydney). */
export function setSurfaceMask(tex: THREE.Texture | null) {
  const old = terrainUniforms.uSurface.value;
  terrainUniforms.uSurface.value = tex ?? blank;
  if (old !== blank && old !== tex) old.dispose();
}

export function setWaterMask(tex: THREE.Texture, x0: number, z0: number, w: number, h: number, canopy?: THREE.Texture) {
  const old = terrainUniforms.uWaterMask.value;
  const oldC = terrainUniforms.uCanopy.value;
  terrainUniforms.uWaterMask.value = tex;
  terrainUniforms.uCanopy.value = canopy ?? blank;
  terrainUniforms.uMaskOrigin.value.set(x0, z0);
  terrainUniforms.uMaskSize.value.set(w, h);
  if (old !== blank && old !== tex) old.dispose();
  if (oldC !== blank && oldC !== canopy) oldC.dispose();
}

let cliffTex: { c: THREE.Texture; n: THREE.Texture } | null = null;

export function setTerrainBiome(b: Biome) {
  terrainUniforms.uMeadowPush.value = b.meadowPush;
  terrainUniforms.uKarst.value = b.karst;
  terrainUniforms.uPhotoSea.value = b.id === 'mediterranean' ? 1 : 0;
  terrainUniforms.uCliffSlope.value.set(...(b.cliffSlope ?? [0.42, 0.62]));
  terrainUniforms.uRockOchre.value = b.rockOchre ?? 1;
  terrainUniforms.uBareAbove.value = b.bareAbove ?? 1e5;
  terrainUniforms.uStoneTint.value.set(...(b.stone?.tint ?? [1.0, 0.98, 0.94]));
  terrainUniforms.uStoneLum.value = b.stone?.lum ?? 0.36;
  terrainUniforms.uSandTint.value.set(...(b.sand ?? [1, 1, 1]));
  terrainUniforms.uSandOn.value = b.sand ? 1 : 0;
  terrainUniforms.uMeadowTint.value.set(...(b.lawnTint ?? [1, 1, 1]));
  terrainUniforms.uStreet.value = b.streets ? 1 : 0;
  const city = !!(b.lawn || b.streets || b.suburb);
  terrainUniforms.uCity.value = city ? 1 : 0;
  terrainUniforms.uBanks.value = b.banks && !city && b.karst === 0 ? 1 : 0;
  terrainUniforms.uCityKind.value = b.suburb ? 2 : b.streets ? 1 : 0;
  // mown October turf in Central Park, pale cool granite in Vienna, light yellow-green kikuyu and concrete in Sydney
  const gr = b.suburb
    ? { lawn: [0.2, 0.235, 0.07], leaf: [0.3, 0.21, 0.08], pave: [0.4, 0.385, 0.35] }
    : b.streets
      ? { lawn: [0.12, 0.18, 0.06], leaf: [0.38, 0.19, 0.05], pave: [0.33, 0.29, 0.23] }
      : { lawn: [0.125, 0.18, 0.058], leaf: [0.38, 0.17, 0.04], pave: [0.2, 0.2, 0.19] };
  terrainUniforms.uGrLawn.value.set(...(gr.lawn as [number, number, number]));
  terrainUniforms.uGrLeaf.value.set(...(gr.leaf as [number, number, number]));
  terrainUniforms.uGrPave.value.set(...(gr.pave as [number, number, number]));
  if (b.karst > 0 && !cliffTex) {
    const load = (f: string, srgb: boolean) => {
      const t = new THREE.TextureLoader().load(f);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    cliffTex = { c: markShared(load('/textures/med/cliff.jpg', true)), n: markShared(load('/textures/med/cliff_nor.jpg', false)) };
  }
  terrainUniforms.uCliffTex.value = b.karst > 0 && cliffTex ? cliffTex.c : blank;
  terrainUniforms.uCliffNor.value = b.karst > 0 && cliffTex ? cliffTex.n : blank;
}

export function clearWaterMask() {
  setSurfaceMask(null);
  setWaterMask(blank, 0, 0, 1, 1);
}

const NOISE = /* glsl */ `
float tHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float tNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1, 0)), u.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), u.x), u.y);
}
float tRidge(vec2 p) { return 1.0 - abs(tNoise(p) * 2.0 - 1.0); }
`;

export function terrainMaterial(map: THREE.Texture) {
  if (terrainUniforms.uGrassTex.value === blank) {
    const g = groundTextures();
    terrainUniforms.uGrassTex.value = g.grass;
    terrainUniforms.uRockTex.value = g.rock;
    terrainUniforms.uGravelTex.value = g.gravel;
    terrainUniforms.uLawnTex.value = g.lawn;
    terrainUniforms.uBankTex.value = g.bank;
  }
  const mat = new THREE.MeshLambertMaterial({ map });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, terrainUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTWNormal;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvTWNormal = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <map_pars_fragment>',
        `#include <map_pars_fragment>
uniform sampler2D uWaterMask;
uniform sampler2D uCanopy;
uniform sampler2D uGrassTex;
uniform sampler2D uRockTex;
uniform sampler2D uGravelTex;
uniform vec2 uMaskOrigin;
uniform float uMeadowPush;
uniform float uBareAbove;
uniform float uKarst;
uniform float uStreet;
uniform vec2 uCliffSlope;
uniform float uRockOchre;
uniform float uPhotoSea;
uniform sampler2D uCliffTex;
uniform sampler2D uCliffNor;
uniform vec2 uMaskSize;
uniform sampler2D uSurface;
uniform vec3 uStoneTint;
uniform float uStoneLum;
uniform vec3 uSandTint;
uniform float uSandOn;
uniform vec3 uMeadowTint;
uniform float uCity;
uniform float uCityKind;
uniform sampler2D uLawnTex;
uniform sampler2D uBankTex;
uniform float uBanks;
uniform vec3 uGrLawn;
uniform vec3 uGrLeaf;
uniform vec3 uGrPave;
varying vec3 vTWNormal;
${NOISE}
${PAVING_GLSL}`,
      )
      .replace(
        '#include <map_fragment>',
        `// tunnel portals: no terrain inside the bore
if (atmoTunnel(vAtmoWorld).x > 0.5) discard;
// coastal routes: the open-sea plane takes over far out (no tile edges or skirts on the horizon)
if (uPhotoSea > 0.5 && vAtmoWorld.y < 0.6 && length(vAtmoWorld.xz - cameraPosition.xz) > 8000.0) discard;
vec3 tPert = vec3(0.0);
float tWater = 0.0;
float tDetail = 1.0;
float tBump = 0.0;
#ifdef USE_MAP
{
  // PNOA orthophotos are cool and bluish compared with the ground seen from the road
  vec3 photoFix = mix(vec3(1.0), vec3(1.0, 0.97, 0.9), uKarst);
  vec3 img = texture2D(map, vMapUv).rgb * photoFix;
  vec3 imgB = texture(map, vMapUv, 2.5).rgb * photoFix;
  vec3 s = sqrt(max(imgB, vec3(0.0)));
  float mx = max(s.r, max(s.g, s.b));
  float mn = min(s.r, min(s.g, s.b));
  float sat = (mx - mn) / max(mx, 1e-3);
  float L = (s.r + s.g + s.b) / 3.0;
  vec3 wn = normalize(vTWNormal);
  float slope = 1.0 - clamp(wn.y, 0.0, 1.0);
  vec2 p = vAtmoWorld.xz;
  vec3 q = vAtmoWorld;
  float camD = length(vAtmoWorld - cameraPosition);
  float near = 1.0 - smoothstep(40.0, 320.0, camD);
  // Alpine lowland (biome.banks): steep ground beside the road is a vegetated earth bank, not rock; the treeline
  // (about 1450 to 1900 m) hands the old steep-slope rock treatment back, where real cliffs and screes are
  float lowland = uBanks * (1.0 - smoothstep(1450.0, 1900.0, vAtmoWorld.y));

  // OSM land cover (G meadow, B built-up) keeps mown meadows from reading as gravel
  vec2 lmuv = (vAtmoWorld.xz - uMaskOrigin) / uMaskSize;
  bool inMask = lmuv.x > 0.0 && lmuv.y > 0.0 && lmuv.x < 1.0 && lmuv.y < 1.0;
  vec3 land = inMask ? texture2D(uWaterMask, lmuv).rgb : vec3(0.0);
  vec3 canTex = inMask ? texture2D(uCanopy, lmuv).rgb : vec3(0.0);
  float canopy = smoothstep(0.15, 0.85, canTex.r);
  // (cut faces and banks are rock, not verge)
  float verge = smoothstep(0.2, 0.7, canTex.g) * (1.0 - smoothstep(0.18, 0.36, 1.0 - clamp(normalize(vTWNormal).y, 0.0, 1.0)));
  // OSM scree and bare rock: pale stones, never pushed to meadow green
  float scree = smoothstep(0.3, 0.8, canTex.b) * (1.0 - verge);
  // beach sand (R) and sandstone outcrops (G) from OSM, where a route has them (Sydney)
  vec3 sfc = inMask ? texture2D(uSurface, lmuv).rgb : vec3(0.0);
  scree = max(scree, smoothstep(0.3, 0.8, sfc.g) * (1.0 - verge));
  // a route's bare top (scene biomeTweaks.bareAbove): pale ground up there is stone, not meadow
  scree = max(scree, smoothstep(uBareAbove - 60.0, uBareAbove + 80.0, vAtmoWorld.y) * smoothstep(0.34, 0.5, L) * (1.0 - canopy) * (1.0 - verge));
  float meadow = smoothstep(0.3, 0.8, land.g) * (1.0 - smoothstep(0.3, 0.8, land.b)) * (1.0 - canopy) * uMeadowPush * (1.0 - scree);
  float wGrass = max(smoothstep(0.0, 0.07, s.g - max(s.r, s.b) * 0.93), meadow * 0.9) * (1.0 - canopy * 0.85);
  // bright, unsaturated photo pixels are snow only up high: on the Prealps they are mown or dry grass.
  // Pale scree and dry grass on the high passes (Stelvio, Esri) reach L 0.75; snow sits above 0.85
  float wSnow = smoothstep(0.8, 0.9, L) * (1.0 - smoothstep(0.1, 0.22, sat)) * smoothstep(1500.0, 1950.0, vAtmoWorld.y);
  // (slope is 1 - cos: 0.26 is 42 degrees, 0.42 is 55, 0.6 is 66; lowland banks turn to rock only on the steepest faces)
  float steep = smoothstep(mix(0.26, 0.42, lowland), mix(0.52, 0.6, lowland), slope);
  float wRock = clamp((1.0 - wGrass) * (1.0 - wSnow) * smoothstep(0.24, 0.1, sat) * smoothstep(mix(0.08, 0.2, lowland), mix(0.3, 0.5, lowland), slope), 0.0, 1.0);
  wRock = max(wRock, steep * (1.0 - wSnow));
  wGrass *= 1.0 - wRock;
  // open ground with any colour is grass (mown meadows photograph pale); only grey, bright,
  // unsaturated ground stays gravel
  // gravel needs a truly grey photo pixel, or a built-up area (car parks, yards)
  // (very bright photo pixels below the snow line are old snow patches in the orthophoto: grass)
  float greyish = max(
    smoothstep(0.07, 0.025, sat) * smoothstep(0.42, 0.6, L) * (1.0 - smoothstep(0.62, 0.74, L)),
    smoothstep(0.3, 0.8, land.b) * smoothstep(0.12, 0.05, sat));
  // karst: pale grey, unsaturated ground is bare limestone pavement, not gravel
  float limestone = uKarst * smoothstep(0.16, 0.07, sat) * smoothstep(0.3, 0.5, L) * (1.0 - canopy) * (1.0 - verge);
  wRock = max(wRock, max(limestone, scree * 0.85));
  wGrass *= 1.0 - max(limestone, scree);
  wGrass = max(wGrass, (1.0 - wRock) * (1.0 - wSnow) * (1.0 - greyish) * 0.92 * (1.0 - canopy * 0.85) * mix(1.0, 0.55, uKarst) * (1.0 - uStreet));
  // city streets: ground is pavement, cobbles and tram bed unless it is a park lawn (mask G) or photographed green
  float lawn = uStreet * smoothstep(0.3, 0.8, land.g) * (1.0 - wRock);
  wGrass = mix(wGrass, max(lawn * 0.95, smoothstep(0.04, 0.13, s.g - max(s.r, s.b) * 0.93) * (1.0 - wRock) * (1.0 - canopy)), uStreet);
  float wGravel = (1.0 - wGrass) * (1.0 - wRock) * (1.0 - wSnow);

  // photo grading
  float tl = dot(img, vec3(0.2126, 0.7152, 0.0722));
  // PNOA is exposed brighter than basemap.at: grade the Mediterranean photo gently
  float gGain = mix(1.32, 0.9, uKarst);
  float gSat = mix(1.28, 1.18, uKarst);
  vec3 tc = pow(max(mix(vec3(tl), img, gSat), vec3(0.0)), vec3(mix(1.06, 1.12, uKarst))) * gGain;
  vec3 area = texture(map, vMapUv, 5.0).rgb * photoFix;
  float la = dot(area, vec3(0.2126, 0.7152, 0.0722));
  area = pow(max(mix(vec3(la), area, gSat), vec3(0.0)), vec3(mix(1.06, 1.12, uKarst))) * gGain;
  vec3 wide = texture(map, vMapUv, 7.5).rgb * photoFix;
  float lw = dot(wide, vec3(0.2126, 0.7152, 0.0722));
  wide = pow(max(mix(vec3(lw), wide, 1.2), vec3(0.0)), vec3(1.06)) * 1.32;

  // detail textures (mean ~1): two scales against tiling
  float gd = texture2D(uGrassTex, p * 0.6).r * 2.0 * (0.55 + 0.9 * texture2D(uGrassTex, p * 0.063 + 0.31).r);
  gd = 1.0 + (gd - 1.0) * mix(0.5, 0.3, smoothstep(30.0, 160.0, camD));
  vec3 bw = pow(abs(wn), vec3(4.0));
  bw /= (bw.x + bw.y + bw.z);
  float rd = (texture2D(uRockTex, q.zy * vec2(0.13, 0.21)).r * bw.x + texture2D(uRockTex, q.xz * 0.13).r * bw.y + texture2D(uRockTex, q.xy * vec2(0.13, 0.21)).r * bw.z) * 2.0;
  float rd2 = (texture2D(uRockTex, q.zy * 0.037 + 0.5).r * bw.x + texture2D(uRockTex, q.xz * 0.037 + 0.5).r * bw.y + texture2D(uRockTex, q.xy * 0.037 + 0.5).r * bw.z) * 2.0;
  rd = mix(rd, rd * rd2, 0.6);
  rd *= 0.7 + 0.6 * (texture2D(uRockTex, q.xz * 0.021 + q.y * 0.01).r);
  // karst pavement is smooth, rounded limestone: much less crackle than Alpine rock
  rd = 1.0 + (rd - 1.0) * mix(1.0, 0.35, uKarst) * mix(1.0, 0.5, lowland);
  float gv = texture2D(uGravelTex, p * 0.9).r * 2.0;
  float d = 1.0;
  d = mix(d, gd, wGrass);
  d = mix(d, rd, wRock);
  d = mix(d, 1.0 + (gv - 1.0) * 0.55, wGravel * 0.7 * (1.0 - 0.85 * uStreet));
  d = mix(d, 0.97 + 0.06 * gv, wSnow);
  tDetail = mix(1.0, d, near);
  tBump = (d - 1.0) * near * mix(0.6, mix(2.2, 1.2, lowland), wRock) * mix(1.0, 0.45, uKarst) * mix(1.0, 0.35, uStreet);

  // close to the camera the photo blurs and smears at grazing angles: keep its colour, not its texels
  float soft = (1.0 - smoothstep(30.0, 180.0, camD));
  vec3 base = mix(tc, area, soft * 0.9);
  // meadows: pull bleached summer-photo grass back to a living green-gold
  float bl = dot(base, vec3(0.3, 0.55, 0.15));
  float grassy = max(max(meadow, wGrass * 0.6 * uMeadowPush), wGrass * 0.9 * uStreet) * (1.0 - steep) * (1.0 - canopy * (1.0 - uStreet));
  // two tones: living green and dry straw patches, like mown autumn meadows
  float straw = smoothstep(0.55, 0.8, tNoise(p * 0.035) * 0.7 + tNoise(p * 0.21) * 0.3);
  // mown grass has a fairly constant albedo: clamp bright (snowy or bleached) photo texels
  float blc = min(bl, 0.3 + 0.06 * straw);
  vec3 meadowCol = mix(blc * vec3(0.8, 1.06, 0.5), blc * vec3(1.05, 1.0, 0.62), straw * 0.6) * 1.05 * uMeadowTint;
  float bright = smoothstep(0.5, 0.75, L) * (1.0 - smoothstep(1500.0, 1950.0, vAtmoWorld.y)) * uMeadowPush * (1.0 - scree);
  base = mix(base, meadowCol, clamp(grassy * 0.6 + bright * 0.9 * (1.0 - canopy), 0.0, 1.0));
  // city streets: pavement is warm grey stone, not the photo's teal or the bleached white of its sunlit squares
  {
    float pl = dot(base, vec3(0.3, 0.55, 0.15));
    vec3 paving = vec3(mix(0.2, min(pl * 0.9, 0.3), 0.55)) * vec3(1.03, 1.0, 0.94);
    base = mix(base, paving, uStreet * (1.0 - clamp(wGrass * 1.2, 0.0, 1.0)));
  }
  // under the canopy: shaded forest floor, leaf litter close up
  vec3 litter = vec3(0.3, 0.22, 0.14) * (0.7 + 0.6 * tNoise(p * 0.7));
  base = mix(base, base * vec3(0.66, 0.64, 0.6), canopy * 0.75 * (1.0 - uKarst) * (1.0 - 0.6 * uStreet));
  base = mix(base, litter * (0.6 + 0.4 * dot(base, vec3(0.33))), canopy * near * 0.55 * (1.0 - uKarst) * (1.0 - uStreet));
  // steep faces: the photo smears vertically, tint rock from the wide average instead
  vec3 rockTint = mix(wide, vec3(dot(wide, vec3(0.33))) * vec3(1.03, 1.0, 0.95), 0.5);
  // karst coasts: the blurred photo mixes in the sea; cliffs and cuts are grey limestone
  rockTint = mix(rockTint, vec3(0.5, 0.48, 0.44) * (0.85 + 0.3 * tNoise(q.xz * 0.08 + q.y * 0.05)), uKarst);
  // lowland faces too steep for plants: layered grey-brown Flysch and marl in beds, mossy stains lower down
  {
    float bedY = q.y * 2.3 + tNoise(q.xz * 0.14) * 2.8 + tNoise(q.xz * 0.7) * 0.5;
    float bedA = smoothstep(0.25, 0.75, 0.5 + 0.5 * sin(bedY * 6.2832));
    float thinB = 0.5 + 0.5 * sin(bedY * 19.0 + tNoise(q.xz * 0.35) * 3.0);
    vec3 flysch = mix(vec3(0.2, 0.19, 0.165), vec3(0.34, 0.315, 0.265), bedA) * (0.88 + 0.2 * thinB) * (0.8 + 0.4 * tNoise(q.xz * 0.5 + q.y * 0.8));
    flysch = mix(flysch, vec3(0.1, 0.13, 0.06), 0.25 * smoothstep(0.55, 0.8, tNoise(q.xz * 0.9 + q.y * 0.12)));
    rockTint = mix(rockTint, flysch * clamp(dot(wide, vec3(0.33)) / 0.2, 0.8, 1.2), lowland * 0.85);
  }
  base = mix(base, rockTint, steep);
  // limestone weathers warm grey with ochre stains (fresh cuts are orange-ochre)
  float ochre = smoothstep(0.45, 0.8, tNoise(q.xz * 0.05 + q.y * 0.03)) * uRockOchre;
  vec3 limeTint = mix(vec3(1.0, 0.95, 0.86), vec3(1.08, 0.88, 0.66), ochre * steep);
  base *= mix(vec3(1.0), limeTint, uKarst * max(limestone, steep));
  // bare limestone reads beige-grey, never snow-white
  float bL = dot(base, vec3(0.3, 0.55, 0.15));
  base = mix(base, base * min(1.0, 0.62 / max(bL, 1e-3)) * vec3(1.0, 0.97, 0.88), uKarst * limestone);
  // the photo was lit by the flight's sun (summer, around midday, from the south-south-east): slopes
  // facing away from it photographed dark and we shade them again, so north-facing valley sides
  // went near-black. Divide that light back out (flat ground unchanged, at most ~2x)
  {
    vec3 Lp = vec3(0.166, 0.766, 0.621); // azimuth ~165°, elevation ~50°
    float flatLit = 0.35 + 0.65 * Lp.y;
    float photoLit = 0.35 + 0.65 * max(dot(wn, Lp), 0.0);
    base *= min(flatLit / photoLit, 1.9);
  }
  // de-light: aerial photos carry the cast shadows of the flight's sun, and we light the ground
  // again; lift near-black photo shadows towards a floor, keeping their hue
  {
    float dl = dot(base, vec3(0.3, 0.55, 0.15));
    float lifted = sqrt(dl * dl + mix(0.085, 0.105, lowland) * mix(0.085, 0.105, lowland));
    // photo shadows are blue (skylight only): lift them towards a vegetation hue, not their own
    vec3 vegHue = mix(mix(vec3(0.82, 1.0, 0.68), vec3(1.0, 0.98, 0.8), uKarst), vec3(0.98, 0.97, 0.94), uStreet * (1.0 - wGrass));
    float darkW = smoothstep(0.12, 0.02, dl);
    base = mix(base * (lifted / max(dl, 1e-3)), vegHue * lifted, darkW * 0.8);
  }
  // vegetated cut banks: grass, moss, crumbling soil and roots that follow the face (tri-planar, no streaks);
  // under the crowns the bank is forest floor, litter and roots
  float bankW = lowland * smoothstep(0.1, 0.18, slope) * (1.0 - steep) * (1.0 - wSnow) * (1.0 - scree) * (1.0 - smoothstep(90.0, 320.0, camD));
  if (bankW > 0.001) {
    vec3 bq = pow(abs(wn), vec3(3.0));
    bq /= (bq.x + bq.y + bq.z);
    vec3 bt = texture2D(uBankTex, q.zy * 0.34).rgb * bq.x + texture2D(uBankTex, q.xz * 0.34).rgb * bq.y + texture2D(uBankTex, q.xy * 0.34).rgb * bq.z;
    // the same tile at 0.55 m per repeat: the grain you see from the saddle
    vec3 bf = texture2D(uBankTex, q.zy * 1.9 + 0.37).rgb * bq.x + texture2D(uBankTex, q.xz * 1.9 + 0.37).rgb * bq.y + texture2D(uBankTex, q.xy * 1.9 + 0.37).rgb * bq.z;
    float lowN = tNoise(q.xz * 0.09 + q.y * 0.06);
    float midN = tNoise(q.xz * 0.45 + q.y * 0.3 + 3.0);
    float bsteep = smoothstep(0.16, 0.46, slope);
    // bare soil where it is steep, and in patches where the cover broke
    float bare = smoothstep(0.52, 0.8, lowN * 0.55 + midN * 0.25 + (bt.r - 0.5) * 0.5 + bsteep * 0.25 - 0.17);
    float mossW = smoothstep(0.42, 0.7, bt.g);
    float bLum = clamp(dot(base, vec3(0.3, 0.55, 0.15)) / 0.16, 0.65, 1.35);
    vec3 veg = mix(mix(vec3(0.13, 0.185, 0.06), vec3(0.21, 0.235, 0.09), midN), vec3(0.065, 0.125, 0.045), mossW * 0.8) * bLum * (0.82 + 0.36 * bt.r);
    veg *= 0.88 + 0.3 * smoothstep(0.55, 0.85, bt.b);
    // fine tufts and clumps, broad tone patches, and dry straw where the grass has cured
    veg *= (0.76 + 0.48 * bf.r) * (0.9 + 0.2 * smoothstep(0.5, 0.85, bf.b)) * (0.82 + 0.36 * tNoise(q.xz * 0.23 + q.y * 0.15));
    veg = mix(veg, vec3(0.2, 0.18, 0.09) * bLum, smoothstep(0.58, 0.8, tNoise(q.xz * 0.17 + q.y * 0.1 + 9.0)) * 0.55);
    vec3 soil = mix(vec3(0.1, 0.072, 0.047), vec3(0.19, 0.14, 0.09), bt.r) * (0.85 + 0.3 * midN);
    soil = mix(soil, vec3(0.2, 0.185, 0.155) * (0.8 + 0.4 * bt.r), smoothstep(0.3, 0.5, slope) * smoothstep(0.5, 0.8, lowN) * 0.6);
    vec3 bcol = mix(veg, soil, bare);
    vec3 litter = mix(vec3(0.2, 0.135, 0.075), vec3(0.28, 0.2, 0.11), bt.r) * (0.7 + 0.5 * midN);
    bcol = mix(bcol, litter, canopy * 0.6 * (1.0 - mossW * 0.4));
    bcol = mix(bcol, vec3(0.085, 0.062, 0.04), (1.0 - smoothstep(0.2, 0.4, bt.b)) * mix(0.0, 0.5, canopy));
    base = mix(base, bcol, bankW * 0.92);
    tDetail = mix(tDetail, 1.0, bankW);
    tBump = mix(tBump, ((bt.r - 0.5) * 0.4 + (bf.r - 0.5) * 0.35) * (1.0 - smoothstep(30.0, 120.0, camD)), bankW);
  }
  // shaded lowland ground never goes black-green: dark photo shadow under the crowns is lifted to a warm forest floor
  {
    float fl = dot(base, vec3(0.3, 0.55, 0.15));
    base = mix(base, vec3(0.105, 0.1, 0.055) * (0.8 + 0.4 * tNoise(p * 0.6)), lowland * smoothstep(0.085, 0.04, fl) * 0.8);
  }
  // rock faces and cuts near the road: photographed fractured limestone, ochre to grey
  float cliffNear = 1.0 - smoothstep(35.0, 110.0, camD);
  // rock only on steep faces; ~50° banks above road cuts stay garrigue
  float cliffW = uKarst * smoothstep(uCliffSlope.x, uCliffSlope.y, slope) * (1.0 - smoothstep(900.0, 1600.0, camD)) * mix(0.75, 1.0, cliffNear);
  if (cliffW > 0.001) {
    vec3 cw = pow(abs(wn), vec3(5.0));
    cw /= cw.x + cw.y + cw.z;
    // near: rock detail at 5.5 m per repeat; far: the same scan as cliff banding at 40 m
    float sc = mix(1.0 / 40.0, 1.0 / 5.5, cliffNear);
    vec3 cc = texture2D(uCliffTex, q.zy * sc).rgb * cw.x + texture2D(uCliffTex, q.xz * sc).rgb * cw.y + texture2D(uCliffTex, q.xy * sc).rgb * cw.z;
    float cl = dot(cc, vec3(0.3, 0.55, 0.15));
    // mostly grey limestone; ochre where the noise says the face is freshly broken. Grey Tramuntana
    // rock (low uRockOchre) is paler and calmer than the scan: lift it and flatten its streaks
    float clg = mix(cl, 0.55, 0.35 * (1.0 - uRockOchre));
    vec3 greyRock = vec3(clg) * vec3(1.04, 1.0, 0.94) * 1.15 * mix(1.45, 1.0, uRockOchre);
    // fresh road cuts: warm ochre limestone in horizontal beds
    float bed = 0.86 + 0.14 * sin(q.y * 4.2 + tNoise(q.xz * 0.3) * 3.0) + 0.06 * sin(q.y * 11.0);
    vec3 rockC = mix(greyRock, cc * 1.12, 0.15 + (0.4 + 0.4 * ochre) * uRockOchre) * bed;
    base = mix(base, rockC, cliffW);
    tBump = mix(tBump, (cl - 0.45) * 4.0 * cliffNear, cliffW);
    tDetail = mix(tDetail, 1.0, cliffW); // the scan carries its own detail
  }
  // under pines the Mediterranean floor is dry needle litter, not dark mould
  base = mix(base, mix(base * 0.7, vec3(0.36, 0.29, 0.22) * (0.8 + 0.4 * tNoise(p * 0.5)), 0.65), canopy * uKarst);
  // Mediterranean soil is mid grey-brown (terra rossa, needle litter); the orthophoto's
  // sun-bleached open ground photographs far brighter than it looks from the road
  float soilL = dot(base, vec3(0.3, 0.55, 0.15));
  float soilCap = mix(0.2, 0.38, max(limestone, steep));
  base = mix(base, base * min(1.0, soilCap / max(soilL, 1e-3)) * vec3(1.0, 0.95, 0.88), uKarst);
  // the orthophoto's real road is often wider than or offset from our asphalt ribbon: grey,
  // unsaturated photo pixels in the road corridor become verge (grass in the Alps)
  float photoRoad = verge * smoothstep(0.14, 0.06, sat) * (1.0 - uKarst) * (1.0 - steep) * (1.0 - uStreet);
  vec3 vergeGrass = vec3(0.13, 0.18, 0.08) * (0.85 + 0.3 * tNoise(p * 0.8)) * (0.9 + 0.2 * gd);
  // Alpine lowland: the verge carries the bank's own clumps and straw so it does not read as a flat painted strip
  if (lowland > 0.001) {
    float vb = texture2D(uBankTex, p * 0.34).r;
    float vf = texture2D(uBankTex, p * 1.9 + 0.37).r;
    vergeGrass *= mix(1.0, (0.78 + 0.44 * vb) * (0.84 + 0.32 * vf), lowland);
    vergeGrass = mix(vergeGrass, vec3(0.2, 0.18, 0.09), lowland * smoothstep(0.6, 0.8, tNoise(p * 0.3 + 4.0)) * 0.4);
  }
  base = mix(base, vergeGrass, photoRoad * 0.9);
  // a patchy gravel seam where the asphalt meets the ground (verge corridor, any slope): grit washed out of the road, not a ditch line
  {
    float gv2 = texture2D(uGravelTex, p * 1.1).r * 2.0;
    float seam = lowland * smoothstep(0.55, 0.9, canTex.g) * smoothstep(0.58, 0.78, tNoise(p * 0.8) * 0.6 + tNoise(p * 3.1) * 0.4) * (1.0 - canopy * 0.5);
    base = mix(base, vec3(0.25, 0.23, 0.19) * (0.7 + 0.3 * gv2), seam * 0.4);
  }
  // road verges: grey-brown dirt with pale rubble (not the orthophoto's grey asphalt)
  float rubble = smoothstep(0.72, 0.8, tNoise(p * 2.3)) * 0.5 + smoothstep(0.78, 0.86, tNoise(p * 6.1 + 3.0)) * 0.5;
  vec3 dirt = mix(vec3(0.34, 0.29, 0.24), vec3(0.46, 0.44, 0.39), rubble * 0.6) * (0.82 + 0.3 * tNoise(p * 0.9));
  base = mix(base, dirt, uKarst * verge * (1.0 - steep * 0.6) * 0.85);
  // scree is pale grey stone, never snow-white or smooth: cap its value, mottle it with stones and
  // the odd plant (Mont Ventoux's top)
  {
    float sL = dot(base, vec3(0.3, 0.55, 0.15));
    vec3 stone = base * min(1.0, uStoneLum / max(sL, 1e-3)) * uStoneTint;
    stone *= 0.78 + 0.3 * tNoise(p * 0.09) + 0.14 * (tNoise(p * 0.7) - 0.5);
    base = mix(base, stone, scree * (1.0 - uKarst));
  }
  // suburbs: the photo of built-up land is a patchwork of roofs, shadows and tarmac in odd pastels; calm it to
  // a warm olive-grey that reads as nature strip and garden from the road
  {
    float bltS = smoothstep(0.3, 0.8, land.b) * uSandOn * (1.0 - scree);
    float bl2 = dot(base, vec3(0.3, 0.55, 0.15));
    base = mix(base, vec3(bl2) * vec3(0.98, 1.02, 0.78), 0.65 * bltS);
  }
  // beach sand: pale warm, nearly flat, wind-rippled a little
  {
    float sandW = smoothstep(0.3, 0.8, sfc.r) * uSandOn * (1.0 - scree);
    vec3 sandC = vec3(0.78, 0.67, 0.47) * uSandTint * (0.92 + 0.16 * tNoise(p * 0.5) + 0.06 * (tNoise(p * 3.1) - 0.5));
    base = mix(base, sandC, sandW * 0.9);
    tDetail = mix(tDetail, 1.0, sandW);
  }

  // ---- city ground: parks, streets and suburbs get a real surface up close (turf, litter, slabs, sand, sandstone);
  // the photo only carries colour and layout. Everything below is gated on uCity: the other routes skip it
  if (uCity > 0.5) {
    float bl0 = dot(base, vec3(0.3, 0.55, 0.15));
    float gpix = gPix(p);
    float ypix = fwidth(q.y);
    float cwgt = 1.0 - smoothstep(200.0, 900.0, camD);
    float greenPh = smoothstep(0.05, 0.12, s.g - max(s.r, s.b) * 0.93);
    bool vienna = uCityKind > 0.5 && uCityKind < 1.5;
    bool suburbK = uCityKind > 1.5;
    // lawn or paved: Vienna lawns only inside OSM parks (crisp border) or where the photo is clearly green
    // OSM carriageways (surface mask B) are asphalt; Vienna's wider real lanes also show as dark photo
    // (edges crisp at any distance: the mask is 3 m per texel, its 0.5 contour is the carriageway edge)
    float fwb = fwidth(sfc.b) * 0.7 + 0.02;
    float roadM = smoothstep(0.5 - fwb, 0.5 + fwb, sfc.b);
    float fwg = fwidth(land.g) * 0.7 + 0.02;
    float wlaw = vienna ? max(smoothstep(0.5 - fwg, 0.5 + fwg, land.g), greenPh * 0.8 * (1.0 - smoothstep(0.1, 0.3, land.b))) : (suburbK ? 1.0 : 1.0 - greyish * (1.0 - greenPh * 0.5));
    // the photo's road wider than our ribbon: grass beside the kerb in parks and suburbs
    if (!vienna) wlaw = max(wlaw, verge * (1.0 - steep));
    wlaw *= 1.0 - roadM;
    // sandstone (Sydney): OSM outcrops and cliffs, and slopes steeper than ~40 degrees
    float fwsg = fwidth(sfc.g) * 0.7 + 0.02;
    float fwsr = fwidth(sfc.r) * 0.7 + 0.02;
    float sstW = uSandOn * max(smoothstep(0.5 - fwsg, 0.5 + fwsg, sfc.g), smoothstep(0.38, 0.6, slope));
    float rk = mix(wRock, sstW, uSandOn);
    float cw2 = cwgt * (1.0 - rk);
    if (cw2 > 0.001 || sstW > 0.001) {
      vec2 pr = vec2(p.x * 0.8 - p.y * 0.6, p.x * 0.6 + p.y * 0.8);
      float m1 = tNoise(pr * 0.16);
      float m2 = tNoise(pr * 0.8 + 7.3);
      float m3 = tNoise(pr * 0.045 + 11.0);
      float gv = texture2D(uGravelTex, p * 1.3).r * 2.0;
      // turf: fine grain over soft mottling, a few dry yellow patches; the colour follows the photo's brightness
      float gt1 = texture2D(uLawnTex, p * 0.42).r * 2.0;
      float gt2 = texture2D(uLawnTex, vec2(p.y, -p.x) * 0.29 + 0.37).r * 2.0;
      float gt3 = texture2D(uLawnTex, p * 1.9 + 0.17).r * 2.0;
      float grain = mix(1.0, gt1 * (0.8 + 0.2 * gt2) * (0.7 + 0.3 * gt3), 0.95);
      float dry = smoothstep(0.5, 0.8, m3 * 0.6 + m1 * 0.4);
      dry = max(dry, smoothstep(0.2, 0.4, slope) * 0.7);
      vec3 lc = uGrLawn * (0.8 + 0.4 * m1) * (0.93 + 0.14 * m2);
      lc = mix(lc, lc * vec3(1.25, 1.08, 0.6), dry * 0.65);
      lc *= clamp(bl0 / max(dot(uGrLawn, vec3(0.3, 0.55, 0.15)), 1e-3), 0.9, 1.12) * grain;
      // under the crowns the turf thins to bare earth and leaf litter
      // (the noise is turned off the grid axes: value-noise cells read as square tiles under a crown)
      float soilW = smoothstep(0.4, 0.85, canopy * 1.0 + (m2 - 0.5) * 0.7 + (tNoise(pr * 0.31) - 0.5) * 0.6) * wlaw * 0.9;
      vec3 lit = mix(vec3(0.15, 0.105, 0.06), vec3(0.23, 0.15, 0.07), tNoise(pr * 1.3)) * (0.75 + 0.5 * tNoise(pr * 4.1));
      float lf = smoothstep(0.62, 0.72, tNoise(pr * 11.0 + 2.0)) * (1.0 - smoothstep(8.0, 40.0, camD));
      lit = mix(lit, uGrLeaf * (0.8 + 0.4 * tNoise(pr * 23.0)), lf * 0.5);
      lc = mix(lc, lit, soilW);
      // paved: dark asphalt where the photo is dark; slabs (Vienna) or pale concrete and pavers elsewhere
      vec2 sid = vec2(0.0);
      float jt = vienna ? gJoint(p, vec2(0.62, 0.92), 0.014, gpix, sid) : 0.0;
      float slabTone = vienna ? mix(1.0, 0.9 + 0.2 * gHash(sid), 1.0 - smoothstep(0.1, 0.45, gpix / 0.62)) : 1.0;
      vec3 pc = uGrPave * slabTone * (0.92 + 0.16 * gv) * (0.95 + 0.1 * m2);
      pc = mix(pc, pc * 0.45, jt);
      float asph = max(roadM, vienna ? smoothstep(0.17, 0.09, la) : 0.0);
      vec3 asphC = vec3(0.098, 0.1, 0.105) * (0.82 + 0.3 * gv) * (0.85 + 0.3 * m1) * mix(1.0, 0.8, smoothstep(0.62, 0.72, tNoise(p * 0.3 + 5.0)));
      pc = mix(pc, asphC, asph);
      vec3 cityCol = mix(pc, lc, wlaw);
      // a pale edge stone where a park's lawn meets the pavement (Vienna)
      if (vienna) {
        float sd = (land.g - 0.5) * 3.0;
        float es = (1.0 - smoothstep(0.05, 0.1, abs(sd))) * (1.0 - smoothstep(30.0, 70.0, camD)) * (1.0 - asph);
        cityCol = mix(cityCol, vec3(0.33, 0.32, 0.3) * (0.9 + 0.2 * gv), es * 0.9);
      }
      // beach sand: pale, wind-rippled, darker and smoother in the wet band at the water line
      if (uSandOn > 0.5) {
        // (crisp edge; sand does not lie on a 30 degree slope or on a headland ten metres up)
        float sandW = smoothstep(0.5 - fwsr, 0.5 + fwsr, sfc.r) * (1.0 - scree) * (1.0 - smoothstep(0.3, 0.5, slope)) * (1.0 - smoothstep(5.0, 10.0, vAtmoWorld.y));
        float wet = 1.0 - smoothstep(0.25, 1.0, vAtmoWorld.y + (tNoise(p * 0.6) - 0.5) * 0.4);
        vec3 sandC = vec3(0.74, 0.65, 0.47) * mix(vec3(1.0), uSandTint, 0.5) * (0.93 + 0.14 * tNoise(p * vec2(0.5, 2.4)) + 0.1 * (gv - 1.0));
        sandC *= mix(1.0, 0.62, wet * sandW);
        cityCol = mix(cityCol, sandC, sandW);
      }
      float tb = (m2 - 0.5) * 0.02 * wlaw;
      base = mix(base, cityCol, cw2);
      tDetail = mix(tDetail, 1.0, cw2);
      tBump = mix(tBump, tb, cw2);
      // sandstone: golden-brown beds, thin bedding lines, dark weathering streaks, over a larger range
      if (sstW > 0.001) {
        float cws = 1.0 - smoothstep(150.0, 600.0, camD);
        float bedY = q.y * 1.1 + 2.0 * tNoise(q.xz * 0.09) + 0.6 * tNoise(q.xz * 0.5);
        float thick = smoothstep(0.35, 0.65, 0.5 + 0.5 * sin(bedY * 6.2832));
        float thinW = 1.0 - smoothstep(0.08, 0.35, ypix * 4.5);
        float thin = (0.5 + 0.5 * sin((bedY * 4.3 + tNoise(q.xz * 0.3) * 2.0) * 6.2832)) * thinW;
        float streak = tNoise(vec2(q.x * 0.7 + q.z * 0.7, q.y * 0.07));
        vec3 sst = mix(vec3(0.34, 0.215, 0.105), vec3(0.55, 0.385, 0.2), thick) * (1.0 - 0.28 * thin) * (0.78 + 0.34 * streak);
        sst *= mix(1.0, clamp(rd, 0.45, 1.7), 0.5);
        base = mix(base, sst, sstW * cws);
        tDetail = mix(tDetail, 1.0, sstW * cws);
      }
    }
  }
  tc = base * tDetail;

  // water: OSM mask, or sea level
  vec2 muv = (p - uMaskOrigin) / uMaskSize;
  float mask = (muv.x > 0.0 && muv.y > 0.0 && muv.x < 1.0 && muv.y < 1.0) ? texture2D(uWaterMask, muv).r : 0.0;
  // DEM sea level (national DEMs store the sea as 0); coastal flats a metre up are land
  float sea = (1.0 - smoothstep(mix(0.4, 0.08, uPhotoSea), mix(1.6, 0.35, uPhotoSea), vAtmoWorld.y)) * (1.0 - smoothstep(0.01, 0.04, slope)) * (1.0 - canopy) * (1.0 - verge);
  tWater = clamp(max(smoothstep(0.35, 0.75, mask), sea), 0.0, 1.0);
  diffuseColor.rgb *= tc;
}
#endif`,
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
{
  // light bounced off the sunlit slopes around: in the mountains a face turned away from the sun
  // still sees the lit valley side opposite, so shade is never skylight alone (it was near-black)
  vec3 bn = normalize(vTWNormal);
  // skylight on grass in shade: the photo's own shadows are already blue, and the blue sky fill on
  // top turned shaded meadow teal (blue above green); shade should be a darker ground colour
  reflectedLight.indirectDiffuse *= mix(vec3(1.04, 1.0, 0.8), vec3(1.1, 1.0, 0.7), uBanks);
  // city grass in shade stays a darker version of its own green, never black-green
  reflectedLight.indirectDiffuse += diffuseColor.rgb * (uCity * 0.1 + uBanks * 0.17) * vec3(0.95, 1.0, 0.85);
  float away = (1.0 - smoothstep(-0.15, 0.25, dot(bn, uSunDir))) * smoothstep(0.0, 0.2, uSunDir.y);
  reflectedLight.indirectDiffuse += diffuseColor.rgb * uSunColor * vec3(0.92, 1.0, 0.84) * (0.16 * away);
}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec3 wn = normalize(vTWNormal);
  vec3 dpx = dFdx(vAtmoWorld);
  vec3 dpy = dFdy(vAtmoWorld);
  float dhx = dFdx(tBump);
  float dhy = dFdy(tBump);
  vec3 r1 = cross(dpy, wn);
  vec3 r2 = cross(wn, dpx);
  float det = dot(dpx, r1);
  if (abs(det) > 1e-10) {
    vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
    vec3 b = abs(det) * wn - grad * 0.35;
    if (dot(b, b) > 1e-20) wn = normalize(b);
  }
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}`,
      )
      .replace(
        '#include <fog_fragment>',
        `if (tWater > 0.001) {
  vec2 wp = vAtmoWorld.xz;
  float t = uTime;
  float n1 = tNoise(wp * 0.35 + vec2(t * 0.11, t * 0.07));
  float n2 = tNoise(wp * 1.3 - vec2(t * 0.23, -t * 0.17));
  float n3 = tNoise(wp * 4.1 + vec2(t * 0.5, t * 0.31));
  float chop = mix(1.0, 2.2, uPhotoSea); // open sea: bigger waves, reflections sample higher sky
  float wd = length(vAtmoWorld - cameraPosition);
  float a1 = 1.0 - smoothstep(1500.0, 5000.0, wd);
  float a2 = 1.0 - smoothstep(250.0, 1000.0, wd);
  float a3 = 1.0 - smoothstep(60.0, 260.0, wd);
  vec3 wnrm = normalize(vec3(((n1 - 0.5) * 0.12 * a1 + (n2 - 0.5) * 0.08 * a2 + (n3 - 0.5) * 0.05 * a3) * chop, 1.0,
    ((n2 - 0.5) * 0.12 * a2 + (n3 - 0.5) * 0.06 * a3) * chop));
  vec3 v = normalize(vAtmoWorld - cameraPosition);
  vec3 r = reflect(v, wnrm);
  r.y = abs(r.y);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(-v, wnrm), 0.0), 5.0);
  vec3 deep = vec3(0.012, 0.035, 0.045) + gl_FragColor.rgb * 0.18;
  // Mediterranean: the orthophoto already shows the water body (turquoise over sand, dark over
  // seagrass and depth); use it as the refracted colour under the reflections
  deep = mix(deep, gl_FragColor.rgb * vec3(0.62, 0.78, 0.88), uPhotoSea);
  vec3 refl = atmoSky(r) * mix(1.0, 0.82, uPhotoSea);
  // lakes lie between mountains: low reflected rays hit the far shore's forest and rock (hazed with
  // distance), only steeper ones the sky; a pale horizon sky alone read as a white sheet
  vec3 shore = mix(vec3(0.045, 0.075, 0.07), atmoSky(normalize(vec3(r.x, 0.03, r.z))), 0.3);
  refl = mix(mix(shore, refl, smoothstep(0.1, 0.5, r.y)), refl, uPhotoSea);
  float glint = pow(max(dot(r, uSunDir), 0.0), 380.0) * mix(18.0, 9.0, uPhotoSea) + pow(max(dot(r, uSunDir), 0.0), 40.0) * mix(0.4, 0.15, uPhotoSea);
  vec3 water = mix(deep, refl, fres) + uSunColor * glint;
  if (uPhotoSea > 0.5) {
    // far out: converge to the open-sea plane's shading (Ocean.ts) so the hand-over is invisible
    float o1 = tNoise(wp * 0.05 + vec2(t * 0.03, t * 0.02));
    float o2 = tNoise(wp * 0.21 - vec2(t * 0.07, -t * 0.05));
    float f2 = 1.0 - smoothstep(900.0, 3500.0, wd);
    float f1 = 1.0 - smoothstep(2000.0, 6000.0, wd);
    vec3 on = normalize(vec3((o1 - 0.5) * 0.22 * f1 + (o2 - 0.5) * 0.16 * f2, 1.0, (o2 - 0.5) * 0.22 * f2));
    vec3 orf = reflect(v, on);
    orf.y = abs(orf.y);
    float ofr = 0.02 + 0.98 * pow(1.0 - max(dot(-v, on), 0.0), 5.0);
    vec3 odeep = vec3(0.012, 0.05, 0.11) * (0.6 + 0.6 * max(uSunDir.y, 0.1));
    float og = pow(max(dot(orf, uSunDir), 0.0), 420.0) * 16.0 + pow(max(dot(orf, uSunDir), 0.0), 45.0) * 0.35;
    vec3 ocean = mix(odeep, atmoSky(orf) * 0.82, ofr) + uSunColor * og;
    water = mix(water, ocean, smoothstep(700.0, 2600.0, wd));
  }
  gl_FragColor.rgb = mix(gl_FragColor.rgb, water, tWater);
}
#include <fog_fragment>`,
      );
  };
  return patchMaterial(mat, { key: 'terrain5' });
}
