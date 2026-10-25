// Road tunnels (route.tunnels, from OSM tunnel=yes): a rough rock tube with an arched roof
// and a line of ceiling lamps. Underpasses (route.underpasses) are short tunnels whose bore is a
// bridge model. The terrain above stays untouched (Terrain.flatten), the terrain
// shader cuts the portal openings, and every patched material dims its ambient light inside
// the tube and adds the lamps (atmosphere.ts TUNNEL_GLSL).

import * as THREE from 'three';
import { pointAt, type Route, type RoutePoint, type Underpass } from '../geo/route.ts';
import { patchMaterial, tunnelUniforms, MAX_TUNNEL_PTS, MAX_TUNNELS } from './atmosphere.ts';
import { loadModel } from './Landmarks.ts';
import { markShared, WorldGroup } from './dispose.ts';

/** Half width of the bore (beyond the road edge) and roof heights above the road. */
export const BORE = { side: 0.9, wall: 3.4, apex: 5.9 };

/** Underpasses: from the middle of the passage to the bridge's outer faces (0.8 m thick faces at ±3.5 m). */
export const UNDERPASS_HALF = 4.3;
/** Underpasses: from the lower road's centre line to the ends of the bridge's faces. */
export const UNDERPASS_SIDE = 8;

export class Tunnels extends WorldGroup {
  private spans: { a: number; b: number }[] = [];
  private tmp: Partial<RoutePoint> = {};
  private route: Route;
  private hw: number;

  constructor(route: Route, hw: number) {
    super();
    this.route = route;
    this.hw = hw;
    const pts: number[] = [];
    const shader: { s0: number; s1: number; first: number; count: number; lamps: number; ramp: number }[] = [];
    // centre line for the shaders, ~8 m steps, all tunnels in one point list
    const line = (from: number, to: number) => {
      const first = pts.length / 4;
      const n = Math.min(MAX_TUNNEL_PTS - first, Math.ceil((to - from) / 8) + 1);
      if (n < 2) return null;
      for (let i = 0; i < n; i++) {
        const s = from + ((to - from) * i) / (n - 1);
        const p = pointAt(route, s, this.tmp);
        pts.push(p.x, p.ele, p.z, s);
      }
      return { first, count: n };
    };
    for (const [a, b] of route.tunnels) {
      this.spans.push({ a, b });
      this.add(this.tube(a, b));
      this.add(this.portal(a + 4, 1), this.portal(b - 4, -1));
      const l = line(a - 4, b + 4);
      if (l) shader.push({ s0: a, s1: b, ...l, lamps: 1, ramp: 3 });
    }
    // under a bridge: the model is the bore; the shader only cuts the terrain between its faces, no lamps
    for (const u of route.underpasses) {
      this.spans.push({ a: u.s - UNDERPASS_HALF, b: u.s + UNDERPASS_HALF });
      const l = line(u.s - 8, u.s + 8);
      if (l) shader.push({ s0: u.s - UNDERPASS_HALF, s1: u.s + UNDERPASS_HALF, ...l, lamps: 0, ramp: 0.3 });
      if (u.model) void this.bridge(u);
    }
    const un = tunnelUniforms;
    for (let i = 0; i < pts.length / 4; i++) un.uTunnelPts.value[i].set(pts[i * 4], pts[i * 4 + 1], pts[i * 4 + 2], pts[i * 4 + 3]);
    const used = shader.slice(0, MAX_TUNNELS);
    used.forEach((t, k) => {
      un.uTunnelSpan.value[k].set(t.s0, t.s1, t.first, t.count);
      un.uTunnelMeta.value[k].set(t.lamps, t.ramp, 0, 0);
      const c = new THREE.Vector3();
      const v = new THREE.Vector3();
      for (let i = t.first; i < t.first + t.count; i++) c.add(v.set(pts[i * 4], pts[i * 4 + 1], pts[i * 4 + 2]));
      c.multiplyScalar(1 / t.count);
      let r = 0;
      for (let i = t.first; i < t.first + t.count; i++) r = Math.max(r, c.distanceTo(v.set(pts[i * 4], pts[i * 4 + 1], pts[i * 4 + 2])));
      un.uTunnelBound.value[k].set(c.x, c.y, c.z, r + 20);
    });
    un.uTunnelCount.value = used.length;
    un.uTunnelHalf.value = hw + BORE.side;
  }

  /** The bridge over an underpass, on the lower road and facing along it. */
  private async bridge(u: Underpass) {
    try {
      const obj = (await loadModel(u.model!)).clone(true);
      const p = pointAt(this.route, u.s, this.tmp);
      obj.position.set(p.x, p.ele, p.z);
      obj.rotation.y = -p.heading;
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
      });
      this.add(obj);
    } catch (e) {
      console.warn('bridge model failed', u.model, e);
    }
  }

  /** Is world point (x, z) over a tunnel bore (for camera ground clamping)? */
  contains(s: number): boolean {
    return this.spans.some(({ a, b }) => s > a - 6 && s < b + 6);
  }

  private profile(): [number, number][] {
    const W = this.hw + BORE.side;
    const out: [number, number][] = [[-W, -0.3], [-W, BORE.wall]];
    const steps = 10;
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      const ang = Math.PI * (1 - t);
      out.push([Math.cos(ang) * W, BORE.wall + Math.sin(ang) * (BORE.apex - BORE.wall)]);
    }
    // close the bore with a floor under the road (else the sky shows beside the asphalt)
    out.push([W, BORE.wall], [W, -0.3], [-W, -0.3]);
    return out;
  }

  private tube(a: number, b: number): THREE.Object3D {
    const prof = this.profile();
    const P = prof.length;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const step = 1.5;
    const n = Math.ceil((b - a + 2) / step) + 1;
    const lamps: THREE.Matrix4[] = [];
    for (let i = 0; i < n; i++) {
      const s = a - 1 + i * step;
      const p = pointAt(this.route, s, this.tmp);
      const rx = Math.cos(p.heading), rz = Math.sin(p.heading);
      for (let j = 0; j < P; j++) {
        const [across, up] = prof[j];
        // rough-hewn rock: the bore wanders by a few decimetres
        const rough = j > 0 && j < P - 1 ? (Math.sin(s * 1.7 + j * 2.1) * 0.12 + Math.sin(s * 0.53 + j * 0.7) * 0.18) : 0;
        const nx = j < P / 2 ? -1 : 1;
        pos.push(p.x + rx * (across + rough * nx), p.ele + up + rough * 0.5, p.z + rz * (across + rough * nx));
        uv.push(s, j / (P - 1));
      }
      if (i % 6 === 3) {
        lamps.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(p.x, p.ele + BORE.apex - 0.08, p.z),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -p.heading),
            new THREE.Vector3(1, 1, 1),
          ),
        );
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < P - 1; j++) {
        const q = i * P + j;
        idx.push(q, q + P, q + 1, q + 1, q + P, q + P + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const g = new THREE.Group();
    const rock = new THREE.Mesh(geo, rockMaterial());
    rock.material.side = THREE.DoubleSide;
    rock.receiveShadow = true;
    g.add(rock);
    const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.35, 2.2) });
    const lampMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.25, 0.08, 1.2), lampMat, lamps.length);
    lamps.forEach((m, i) => lampMesh.setMatrixAt(i, m));
    lampMesh.computeBoundingSphere();
    g.add(lampMesh);
    // amber reflectors on both walls every 12 m (as photographed)
    const refl: THREE.Matrix4[] = [];
    for (let s = a + 2; s < b; s += 12) {
      const p = pointAt(this.route, s, this.tmp);
      for (const side of [-1, 1]) {
        const off = this.hw + BORE.side - 0.05;
        refl.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(p.x + Math.cos(p.heading) * off * side, p.ele + 0.9, p.z + Math.sin(p.heading) * off * side),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -p.heading),
            new THREE.Vector3(1, 1, 1),
          ),
        );
      }
    }
    const reflMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.08, 0.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 0.9, 0.1) }), refl.length);
    refl.forEach((m, i) => reflMesh.setMatrixAt(i, m));
    reflMesh.computeBoundingSphere();
    g.add(reflMesh);
    return g;
  }

  /** Rough rock collar around the opening, hiding where the bore meets the terrain. */
  private portal(s: number, dir: 1 | -1): THREE.Mesh {
    const inner = this.profile();
    const p = pointAt(this.route, s, this.tmp);
    const rx = Math.cos(p.heading), rz = Math.sin(p.heading);
    const fx = Math.sin(p.heading) * dir, fz = -Math.cos(p.heading) * dir;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const P = inner.length;
    for (let j = 0; j < P; j++) {
      const [x, y] = inner[j];
      // outer ring: 2.5–4 m of rock around the bore, leaning back into the hill
      const k = 1.0 + (2.8 + Math.sin(j * 1.9) * 0.8) / Math.max(4, Math.hypot(x, y - 2));
      for (const [scale, back] of [[1, 0], [k, 1.6]] as const) {
        pos.push(p.x + rx * x * scale - fx * back, p.ele + (y < 0 ? y : y * scale), p.z + rz * x * scale - fz * back);
        uv.push(s + back, j / (P - 1));
      }
    }
    for (let j = 0; j < P - 1; j++) {
      const q = j * 2;
      idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, rockMaterial());
    m.material.side = THREE.DoubleSide;
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

let rockMat: THREE.MeshStandardMaterial | null = null;

/** Rough-hewn limestone: the CC0 cliff scan, tri-planar in world metres, with its normal map. */
function rockMaterial(): THREE.MeshStandardMaterial {
  if (rockMat) return rockMat;
  const load = (f: string, srgb: boolean) => {
    const t = new THREE.TextureLoader().load(f);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const col = load('/textures/med/cliff.jpg', true);
  const nor = load('/textures/med/cliff_nor.jpg', false);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRkCol = { value: col };
    shader.uniforms.uRkNor = { value: nor };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRkW;\nvarying vec3 vRkN;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvRkW = (modelMatrix * vec4(position, 1.0)).xyz;\nvRkN = normalize(mat3(modelMatrix) * normal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uRkCol;\nuniform sampler2D uRkNor;\nvarying vec3 vRkW;\nvarying vec3 vRkN;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec3 rkw = pow(abs(normalize(vRkN)), vec3(4.0));
rkw /= rkw.x + rkw.y + rkw.z;
float rks = 1.0 / 3.5;
vec3 rkc = texture2D(uRkCol, vRkW.zy * rks).rgb * rkw.x + texture2D(uRkCol, vRkW.xz * rks).rgb * rkw.y + texture2D(uRkCol, vRkW.xy * rks).rgb * rkw.z;
float rkl = dot(rkc, vec3(0.3, 0.55, 0.15));
// bored rock is greyer and darker than the sunlit cuts outside, a little damp near the floor
diffuseColor.rgb = mix(vec3(rkl), rkc, 0.35) * vec3(0.95, 0.93, 0.88) * 0.85;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec3 tn = (texture2D(uRkNor, vRkW.zy * rks).xyz * rkw.x + texture2D(uRkNor, vRkW.xz * rks).xyz * rkw.y + texture2D(uRkNor, vRkW.xy * rks).xyz * rkw.z) * 2.0 - 1.0;
  normal = normalize(normal + (viewMatrix * vec4(tn.x, tn.y, 0.0, 0.0)).xyz * 1.2);
}`,
      );
  };
  rockMat = markShared(patchMaterial(mat, { key: 'tunnelrock2' }));
  return rockMat;
}
