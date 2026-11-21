// Cast shadows of the real terrain: ridges and neighbouring mountains darken the valleys
// under a low sun. A heightfield around the route (fine) and a wide one for distant
// occluders (coarse) are ray-marched towards the sun on the GPU into a shadow texture
// that every patched material samples (see atmosphere.ts). Recomputed when the sun moves.

import * as THREE from 'three';
import { DEM_MAX_Z, demTopZoom, hasDetailAt, heightAtMerc, preloadDemForBox, preloadDemLocal } from '../geo/elevation.ts';
import type { WorldFrame } from '../geo/mercator.ts';
import { atmo, terrainShadowUniforms, WHITE_TEX } from './atmosphere.ts';

const FIELD = 2048; // heightfield texels per side
const OUT = 4096; // shadow texels per side


interface Field {
  tex: THREE.DataTexture;
  x0: number;
  z0: number;
  size: number;
}

const vertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const fragment = /* glsl */ `
precision highp float;
uniform sampler2D uNear;
uniform sampler2D uFar;
uniform vec3 uNearRect; // x0, z0, size
uniform vec3 uFarRect;
uniform vec3 uSun;
varying vec2 vUv;

float fetchH(sampler2D t, vec2 uv) {
  vec2 g = uv * ${FIELD.toFixed(1)} - 0.5;
  vec2 i = floor(g), f = g - i;
  ivec2 c = ivec2(clamp(i, vec2(0.0), vec2(${(FIELD - 2).toFixed(1)})));
  float a = texelFetch(t, c, 0).r, b = texelFetch(t, c + ivec2(1, 0), 0).r;
  float d = texelFetch(t, c + ivec2(0, 1), 0).r, e = texelFetch(t, c + ivec2(1, 1), 0).r;
  return mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
}
float heightAt(vec2 p) {
  vec2 un = (p - uNearRect.xy) / uNearRect.z;
  if (all(greaterThan(un, vec2(0.002))) && all(lessThan(un, vec2(0.998)))) {
    float h = fetchH(uNear, un);
    if (h > -5000.0) return h;
  }
  vec2 uf = (p - uFarRect.xy) / uFarRect.z;
  if (all(greaterThan(uf, vec2(0.0))) && all(lessThan(uf, vec2(1.0)))) return fetchH(uFar, uf);
  return -1e4;
}
void main() {
  vec2 p = uNearRect.xy + vUv * uNearRect.z;
  float h0 = heightAt(p) + 2.0;
  vec2 dir = normalize(uSun.xz);
  float tanEl = uSun.y / max(length(uSun.xz), 1e-4);
  float vis = 1.0;
  float t = uNearRect.z / ${FIELD.toFixed(1)} * 1.5;
  for (int i = 0; i < 240; i++) {
    vec2 q = p + dir * t;
    float h = heightAt(q);
    float ray = h0 + t * tanEl - t * t / 12742000.0;
    // soft penumbra: the sun disc is ~0.53 deg, widened a little for a pleasant falloff
    vis = min(vis, clamp((ray - h) / (t * 0.016) + 0.5, 0.0, 1.0));
    if (vis <= 0.0 || ray > 4800.0) break;
    t *= 1.035;
    t += 4.0;
  }
  gl_FragColor = vec4(vec3(vis), 1.0);
}`;

export class TerrainShadow {
  private near: Field | null = null;
  private far: Field | null = null;
  private target = new THREE.WebGLRenderTarget(OUT, OUT, {
    type: THREE.UnsignedByteType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
    depthBuffer: false,
  });
  private quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  // a real projection camera: with a reversed depth buffer three updates every camera's projection
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private lastSun = new THREE.Vector3();
  private disposed = false;

  constructor() {
    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          uNear: { value: null },
          uFar: { value: null },
          uNearRect: { value: new THREE.Vector3() },
          uFarRect: { value: new THREE.Vector3() },
          uSun: { value: new THREE.Vector3() },
        },
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.quad.frustumCulled = false;
  }

  /** Sample the DEM around the route. bounds = world [minX, minZ, maxX, maxZ]. */
  async build(frame: WorldFrame, bounds: [number, number, number, number]) {
    const cx = (bounds[0] + bounds[2]) / 2;
    const cz = (bounds[1] + bounds[3]) / 2;
    const extent = Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]);
    // near field: the route plus ~2 km (a few metres per texel); far field catches distant ridges
    const nearSize = extent + 4000;
    const farSize = Math.max(64000, nearSize * 3);
    // far first: near-field gaps (failed tiles) fall back to the coarse heights
    const far = await this.field(frame, cx, cz, farSize, 11);
    const near = await this.field(frame, cx, cz, nearSize, 13);
    if (this.disposed) {
      near.tex.dispose();
      far.tex.dispose();
      return;
    }
    this.near = near;
    this.far = far;
    const u = this.quad.material.uniforms;
    u.uNear.value = near.tex;
    u.uFar.value = far.tex;
    u.uNearRect.value.set(near.x0, near.z0, near.size);
    u.uFarRect.value.set(far.x0, far.z0, far.size);
    this.lastSun.set(0, 0, 0);
  }

  private async field(frame: WorldFrame, cx: number, cz: number, size: number, z: number): Promise<Field> {
    const x0 = cx - size / 2;
    const z0 = cz - size / 2;
    const toMerc = (wx: number, wz: number) => [wx / frame.k + frame.mx0, -wz / frame.k + frame.my0] as const;
    const [mx0, my1] = toMerc(x0, z0);
    const [mx1, my0] = toMerc(x0 + size, z0 + size);
    await preloadDemForBox(mx0, my0, mx1, my1, z);
    // where the ground is built from fine tiles (1 m lidar) the shadow field must see the same ground: a field from the
    // coarse DEM stands metres above a hillside that the lidar cut away, and the road's own slope lay in its shadow
    await preloadDemLocal(mx0, my0, mx1, my1);
    const data = new Float32Array(FIELD * FIELD);
    const cell = size / FIELD;
    for (let j = 0; j < FIELD; j++) {
      const wz = z0 + (j + 0.5) * cell;
      for (let i = 0; i < FIELD; i++) {
        const [mx, my] = toMerc(x0 + (i + 0.5) * cell, wz);
        const h = heightAtMerc(mx, my, hasDetailAt(mx, my) ? demTopZoom() : Math.min(z, DEM_MAX_Z));
        data[j * FIELD + i] = h === h ? h : -1e4;
      }
      // keep the page responsive while sampling
      if ((j & 127) === 127) await new Promise((r) => setTimeout(r, 0));
    }
    const tex = new THREE.DataTexture(data, FIELD, FIELD, THREE.RedFormat, THREE.FloatType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return { tex, x0, z0, size };
  }

  /** Re-render the shadow texture if the sun moved noticeably. */
  update(renderer: THREE.WebGLRenderer) {
    if (!this.near) return;
    const sun = atmo.uSunDir.value;
    if (sun.distanceToSquared(this.lastSun) < 1e-7) return;
    this.lastSun.copy(sun);
    const u = this.quad.material.uniforms;
    u.uSun.value.copy(sun);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(this.quad, this.cam);
    renderer.setRenderTarget(prev);
    terrainShadowUniforms.uTShadow.value = this.target.texture;
    terrainShadowUniforms.uTShadowRect.value.set(this.near.x0, this.near.z0, this.near.size, sun.y > 0.0 ? 1 : 0);
  }

  dispose() {
    this.disposed = true;
    terrainShadowUniforms.uTShadow.value = WHITE_TEX;
    terrainShadowUniforms.uTShadowRect.value.set(0, 0, 1, 0);
    this.near?.tex.dispose();
    this.far?.tex.dispose();
    this.target.dispose();
    this.quad.geometry.dispose();
    this.quad.material.dispose();
  }
}
