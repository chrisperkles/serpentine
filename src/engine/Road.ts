// Asphalt ribbon along the route with procedural markings, plus Alpine roadside posts.

import * as THREE from 'three';
import type { Route } from '../geo/route.ts';
import { patchMaterial } from './atmosphere.ts';
import { ALPINE, type Biome } from './biome.ts';
import { markShared, WorldGroup } from './dispose.ts';

const SHOULDER = 0.55;

const TILE = 2.6; // metres per asphalt texture repeat

let asphalt: { color: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture } | null = null;

/** Loaded once per session (every ride used to load its own six). */
function asphaltTextures() {
  if (asphalt) return asphalt;
  const load = (f: string, srgb: boolean) => {
    const t = new THREE.TextureLoader().load(`/textures/asphalt/${f}`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  asphalt = { color: markShared(load('color.jpg', true)), normal: markShared(load('normal.jpg', false)), rough: markShared(load('rough.jpg', false)) };
  return asphalt;
}

function roadMaterial(halfWidth: number, biome: Biome, turn = false) {
  // CC0 Poly Haven asphalt_02 scan for colour, cracks and micro relief; markings are procedural
  const tex = asphaltTextures();
  const mat = new THREE.MeshStandardMaterial({
    roughness: 1,
    metalness: 0,
    color: 0xffffff,
    normalMap: tex.normal,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughnessMap: tex.rough,
    // asphalt only picks up a little sky
    envMapIntensity: 0.35,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHalf = { value: halfWidth };
    // a zero dash length turns the centre line off (roads without one: scene biomeTweaks "centreLine": false)
    const dash = biome.centreLine === false ? 0 : biome.dash[0];
    shader.uniforms.uDash = { value: new THREE.Vector2(dash, biome.dash[0] + biome.dash[1]) };
    // Mallorca: sun-bleached lighter asphalt, mostly no edge lines, asphalt up to the wall
    shader.uniforms.uMed = { value: biome.id === 'mediterranean' ? 1 : 0 };
    shader.uniforms.uAsphalt = { value: tex.color };
    // Central Park's drives: a solid line splits the lane for people on foot (the inside of the loop) from the wheels
    shader.uniforms.uLane = { value: biome.carFree ? halfWidth - 2.5 : 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 roadUv;\nvarying vec2 vRoad;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = roadUv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uHalf;
uniform vec2 uDash;
uniform float uMed;
uniform float uLane;
uniform sampler2D uAsphalt;
varying vec2 vRoad;
float gPaint;
float rh(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.7); }
float rn(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rh(i), rh(i + vec2(1, 0)), f.x), mix(rh(i + vec2(0, 1)), rh(i + vec2(1, 1)), f.x), f.y);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `{
  float across = vRoad.x; // metres from centre line, signed
  float along = vRoad.y;  // metres along route
  float a = abs(across);
  vec2 p = vec2(across, along);
  vec3 scan = texture2D(uAsphalt, p / ${TILE.toFixed(2)}).rgb;
  vec3 scan2 = texture2D(uAsphalt, p.yx / 7.3 + 0.37).rgb;
  // Ma-2210: resurfaced, lighter grey, few visible cracks (blurred scan = cracks fade out)
  vec3 scanSoft = texture(uAsphalt, p / ${TILE.toFixed(2)}, 2.5).rgb;
  scan = mix(scan, scanSoft, 0.65 * uMed);
  vec3 asphalt = mix(scan, scan2, 0.3) * mix(1.36, 1.5, uMed);
  asphalt = mix(asphalt, vec3(dot(asphalt, vec3(0.33))) * 0.98 + 0.02, 0.4 * uMed);
  // repair patches and darker fresh tar
  float patches = smoothstep(0.58, 0.72, rn(p * vec2(0.35, 0.06) + 3.1));
  asphalt = mix(asphalt, asphalt * vec3(0.7, 0.7, 0.72), patches);
  asphalt *= 0.9 + 0.2 * rn(p * vec2(0.08, 0.02));
  // wheel tracks are polished a bit darker
  float tk = (a - uHalf * 0.5) / 0.45;
  float track = exp(-tk * tk);
  asphalt *= 1.0 - 0.12 * track;
  vec3 paint = vec3(0.86, 0.86, 0.82);
  float wear = 0.75 + 0.25 * rn(p * vec2(4.0, 0.6));
  float edge = step(abs(a - (uHalf - 0.28)), 0.07) * (1.0 - uMed);
  // centre dashes: Austria 6 m / 12 m, Spain (M-1.3) 3.5 m / 9 m
  float dash = step(fract(along / uDash.y), uDash.x / uDash.y);
  float centre = step(a, 0.06) * dash * step(2.6, uHalf) * step(0.01, uDash.x);
  float lane = step(abs(across + uLane), 0.06) * step(0.01, uLane);
  gPaint = max(max(edge, centre), lane) * wear;
  vec3 col = mix(asphalt, paint * wear, max(max(edge, centre), lane));
  // gravel shoulder
  float sh = smoothstep(uHalf - 0.02, uHalf + 0.06, a);
  // a thin dark seam of grit and soil where the asphalt meets the verge
  vec3 gravel = mix(vec3(0.15, 0.14, 0.11), vec3(0.22, 0.2, 0.16), rn(p * 6.0));
  // Mallorca: the asphalt crumbles into the red-brown dusty verge
  gravel = mix(gravel, vec3(0.42, 0.33, 0.25) * (0.8 + 0.3 * rn(p * 9.0)), uMed);
  col = mix(col, gravel, sh);
  diffuseColor.rgb = col;
  // a narrow strip of gravel then the verge (wide soft fades read as a grey smear)
  diffuseColor.a = 1.0 - smoothstep(uHalf + 0.04, uHalf + 0.22, a);
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(clamp(roughnessFactor * 0.95, 0.55, 1.0), 0.5, gPaint);`,
      );
  };
  mat.transparent = true;
  mat.depthWrite = true;
  // turnarounds overlap the route's end: a little more bias so they always draw on top of it
  return patchMaterial(mat, { key: `road${turn ? '-turn' : ''}:${biome.id}`, depthBias: turn ? 0.018 : 0.012 });
}

interface Strip {
  n: number;
  step: number;
  x: ArrayLike<number>;
  z: ArrayLike<number>;
  ele: ArrayLike<number>;
  heading: ArrayLike<number>;
  grade: ArrayLike<number>;
}

export class Road extends WorldGroup {
  constructor(route: Route, halfWidth: number, biome: Biome = ALPINE) {
    super();
    const mat = roadMaterial(halfWidth, biome);
    // point-to-point routes run on one sample (4 m) under their turnarounds: a loop leaves the end
    // point at an angle, and the wedge between the square end of the asphalt and the loop showed the ground
    this.strip(route, halfWidth, mat, 0, !route.loop);
    // turnarounds at both ends of point-to-point routes (the loop part; the rejoin leg is road)
    const turnMat = roadMaterial(halfWidth, biome, true);
    for (const t of [route.turnEnd, route.turnStart]) {
      if (!t) continue;
      const step = t.length / (t.n - 1);
      this.strip({ n: t.loopN, step, x: t.x, z: t.z, ele: t.ele, heading: t.heading, grade: t.grade }, halfWidth, turnMat, 100000);
    }
    // rural delineator posts and guard rails need the terrain: Roadside.ts
    if (route.category === 'city') this.add(biome.parkLamps ? parkLamps(route, halfWidth) : lamps(route, halfWidth));
  }

  /** Asphalt ribbon along a polyline, in chunks so frustum culling works on long routes. */
  private strip(r0: Strip, halfWidth: number, mat: THREE.Material, along0: number, extend = false) {
    if (r0.n < 2) return;
    const r = extend ? extended(r0) : r0;
    if (extend) along0 -= r0.step;
    const n = r.n;
    const cols = [-(halfWidth + SHOULDER), -halfWidth, 0, halfWidth, halfWidth + SHOULDER];
    const drop = [-0.12, 0, 0, 0, -0.12];
    const pos = new Float32Array(n * cols.length * 3);
    const uv = new Float32Array(n * cols.length * 2);
    const nor = new Float32Array(n * cols.length * 3);
    const origin = new THREE.Vector3(r.x[0], r.ele[0], r.z[0]);
    for (let i = 0; i < n; i++) {
      const h = r.heading[i];
      const rx = Math.cos(h);
      const rz = Math.sin(h);
      const slope = Math.atan(r.grade[i] / 100);
      for (let c = 0; c < cols.length; c++) {
        const v = i * cols.length + c;
        pos[v * 3] = r.x[i] + rx * cols[c] - origin.x;
        pos[v * 3 + 1] = r.ele[i] + 0.06 + drop[c] - origin.y;
        pos[v * 3 + 2] = r.z[i] + rz * cols[c] - origin.z;
        uv[v * 2] = cols[c];
        uv[v * 2 + 1] = along0 + i * r.step;
        nor[v * 3] = -Math.sin(h) * Math.sin(slope);
        nor[v * 3 + 1] = Math.cos(slope);
        nor[v * 3 + 2] = Math.cos(h) * Math.sin(slope);
      }
    }
    const tuv = new Float32Array(uv.length);
    for (let k = 0; k < uv.length; k++) tuv[k] = uv[k] / TILE;
    const uvTex = new THREE.BufferAttribute(tuv, 2);
    const CHUNK = 250;
    for (let start = 0; start < n - 1; start += CHUNK) {
      const end = Math.min(n - 1, start + CHUNK);
      const idx: number[] = [];
      for (let i = start; i < end; i++) {
        for (let c = 0; c < cols.length - 1; c++) {
          const a = i * cols.length + c;
          const b = a + 1;
          const d = a + cols.length;
          const e = d + 1;
          idx.push(a, b, d, b, e, d);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('roadUv', new THREE.BufferAttribute(uv, 2));
      geo.setAttribute('uv', uvTex);
      geo.setIndex(idx);
      geo.boundingSphere = chunkSphere(pos, start * cols.length, (end + 1) * cols.length);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(origin);
      mesh.receiveShadow = true;
      mesh.renderOrder = 1;
      this.add(mesh);
    }
  }

}

/**
 * Central Park's lamp post (Henry Bacon's 1907 design, still the park's standard): a slim black cast-iron
 * shaft on a flared base, 3.6 m to the lantern, a round frosted luminaire under a small cap.
 */
function parkLamps(route: Route, halfWidth: number): THREE.Group {
  const iron = new THREE.Color().setRGB(0.05, 0.055, 0.06, THREE.SRGBColorSpace);
  const glass = new THREE.Color().setRGB(0.9, 0.88, 0.8, THREE.SRGBColorSpace);
  return lampRow(route, halfWidth + 1.6, 30, mergeColored([
    [new THREE.CylinderGeometry(0.1, 0.17, 0.7, 10).translate(0, 0.35, 0), iron],
    [new THREE.CylinderGeometry(0.05, 0.075, 2.6, 10).translate(0, 2.0, 0), iron],
    [new THREE.CylinderGeometry(0.11, 0.05, 0.22, 10).translate(0, 3.38, 0), iron],
    [new THREE.SphereGeometry(0.2, 10, 8).scale(1, 1.25, 1).translate(0, 3.7, 0), glass],
    [new THREE.ConeGeometry(0.2, 0.2, 10).translate(0, 4.02, 0), iron],
    [new THREE.SphereGeometry(0.04, 6, 5).translate(0, 4.15, 0), iron],
  ]));
}

/** Street lamps every 32 m, alternating sides (city routes). */
function lamps(route: Route, halfWidth: number): THREE.Group {
  const pole = new THREE.CylinderGeometry(0.06, 0.09, 6, 8).translate(0, 3, 0);
  const arm = new THREE.BoxGeometry(0.08, 0.08, 1.4).translate(0, 5.95, -0.65);
  const head = new THREE.BoxGeometry(0.34, 0.14, 0.6).translate(0, 5.85, -1.3);
  const metal = new THREE.Color().setRGB(0.18, 0.2, 0.22, THREE.SRGBColorSpace);
  return lampRow(route, halfWidth + 1.2, 32, mergeColored([
    [pole, metal],
    [arm, metal],
    [head, new THREE.Color(0.25, 0.26, 0.27)],
  ]));
}

function lampRow(route: Route, off: number, every: number, geo: THREE.BufferGeometry): THREE.Group {
  const g = new THREE.Group();
  const mat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.6 }), { key: 'lamp' });
  const spacing = Math.round(every / route.step);
  const count = Math.ceil(route.n / spacing);
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  let k = 0;
  for (let i = 0; i < route.n && k < count; i += spacing) {
    const h = route.heading[i];
    const side = k % 2 ? 1 : -1;
    // the arm (local -Z) reaches over the road
    q.setFromAxisAngle(up, -h + (side > 0 ? Math.PI / 2 : -Math.PI / 2));
    m.compose(
      new THREE.Vector3(route.x[i] + Math.cos(h) * off * side, route.ele[i] - 0.1, route.z[i] + Math.sin(h) * off * side),
      q,
      new THREE.Vector3(1, 1, 1),
    );
    mesh.setMatrixAt(k++, m);
  }
  mesh.count = k;
  mesh.castShadow = true;
  mesh.computeBoundingSphere();
  g.add(mesh);
  return g;
}

/** The strip with one more sample beyond each end, straight on along the end heading. */
function extended(r: Strip): Strip {
  const n = r.n + 2;
  const x = new Float32Array(n), z = new Float32Array(n), ele = new Float32Array(n);
  const heading = new Float32Array(n), grade = new Float32Array(n);
  for (let i = 0; i < r.n; i++) {
    x[i + 1] = r.x[i];
    z[i + 1] = r.z[i];
    ele[i + 1] = r.ele[i];
    heading[i + 1] = r.heading[i];
    grade[i + 1] = r.grade[i];
  }
  for (const [o, a, sgn] of [[0, 0, -1], [n - 1, r.n - 1, 1]] as const) {
    const h = r.heading[a];
    x[o] = r.x[a] + Math.sin(h) * r.step * sgn;
    z[o] = r.z[a] - Math.cos(h) * r.step * sgn;
    ele[o] = r.ele[a];
    heading[o] = h;
    grade[o] = r.grade[a];
  }
  return { n, step: r.step, x, z, ele, heading, grade };
}

function chunkSphere(pos: Float32Array, from: number, to: number): THREE.Sphere {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = from; i < to; i++) box.expandByPoint(v.fromArray(pos, i * 3));
  return box.getBoundingSphere(new THREE.Sphere());
}

export function mergeColored(parts: [THREE.BufferGeometry, THREE.Color][]): THREE.BufferGeometry {
  const geos = parts.map(([g, c]) => {
    const geo = g.index ? g.toNonIndexed() : g;
    const n = geo.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(col, i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.deleteAttribute('uv');
    return geo;
  });
  let total = 0;
  for (const g of geos) total += g.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.getAttribute('position').array as Float32Array, o * 3);
    nor.set(g.getAttribute('normal').array as Float32Array, o * 3);
    col.set(g.getAttribute('color').array as Float32Array, o * 3);
    o += g.getAttribute('position').count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
