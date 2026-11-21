// Small real-world things from OpenStreetMap points and lines, using the Blender-built props in
// public/models: benches, bus stops, guideposts, wayside crosses, info boards, the summit cross,
// power poles with sagging wires, fences and walls, and firewood stacks beside farmhouses.

import * as THREE from 'three';
import type { Building, OsmWorld } from '../geo/osm.ts';
import type { Route, RouteIndex } from '../geo/route.ts';
import { patchMaterial } from './atmosphere.ts';
import { loadModel } from './Landmarks.ts';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mergeColored } from './Road.ts';
import type { Biome } from './biome.ts';
import { markShared, WorldGroup } from './dispose.ts';
import { tramLines, tramTrack } from './Tram.ts';

const POI_MODEL: Record<string, string> = {
  bench: 'prop-bench.glb',
  bus_stop: 'prop-bus_stop.glb',
  guidepost: 'prop-guidepost.glb',
  cross: 'prop-wayside_cross.glb',
  shrine: 'prop-wayside_cross.glb',
  board: 'prop-info_board.glb',
  peak: 'prop-summit_cross.glb',
  'power:pole': 'prop-power_pole.glb',
};

function hash(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export class Props extends WorldGroup {
  /** `models`: where the scene places its own landmark models (an OSM tower there is left to the model). */
  async build(
    route: Route, index: RouteIndex, osm: OsmWorld, groundAt: (x: number, z: number) => number, halfWidth: number, biome?: Biome,
    models: [number, number][] = [],
  ) {
    const place = async (model: string, x: number, z: number, yaw: number, lift = 0) => {
      const y = groundAt(x, z);
      if (!Number.isFinite(y)) return;
      const src = await loadModel(model);
      const o = src.clone(true);
      o.position.set(x, y + lift, z);
      o.rotation.y = yaw;
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      this.add(o);
    };
    const jobs: Promise<void>[] = [];
    const poles: { x: number; z: number }[] = [];
    for (const [k, p] of osm.pois.entries()) {
      const model = POI_MODEL[p.kind];
      if (!model) continue;
      const near = index.nearest(p.x, p.z, 400);
      const reach = p.kind === 'peak' || p.kind === 'power:pole' ? 400 : 70;
      if (near.index < 0 || near.dist > reach) continue;
      let x = p.x, z = p.z;
      const h = route.heading[near.index];
      // face the road; keep things off the asphalt
      const rx = Math.cos(h), rz = Math.sin(h);
      const side = (x - route.x[near.index]) * rx + (z - route.z[near.index]) * rz >= 0 ? 1 : -1;
      if (near.dist < halfWidth + 1.4 && p.kind !== 'peak') {
        x = route.x[near.index] + rx * side * (halfWidth + 1.6);
        z = route.z[near.index] + rz * side * (halfWidth + 1.6);
      }
      let yaw = -h + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
      if (p.kind === 'power:pole') {
        poles.push({ x, z });
        yaw = hash(k) * Math.PI;
      }
      if (p.kind === 'peak') yaw = 0.3;
      jobs.push(place(model, x, z, yaw, p.kind === 'peak' ? -0.3 : 0));
    }
    // firewood stacks against farmhouse walls near the road
    osm.buildings.forEach((b, i) => {
      if (biome?.streets || !['house', 'farm', 'farm_auxiliary', 'barn', 'yes', 'detached'].includes(b.kind)) return;
      if (hash(i * 7) > 0.32) return;
      const spot = besideWall(b, i);
      if (!spot) return;
      const near = index.nearest(spot.x, spot.z, 150);
      if (near.index < 0 || near.dist < halfWidth + 3) return;
      jobs.push(place('prop-firewood.glb', spot.x, spot.z, spot.yaw));
    });
    await Promise.all(jobs);
    this.add(this.wires(osm, poles, groundAt));
    this.add(this.towers(osm, groundAt, models, biome));
    this.add(this.fences(osm, index, groundAt, halfWidth, biome));
    if (biome?.viennaLamps) this.add(viennaLamps(route, index, osm, groundAt, halfWidth));
    if (biome?.streets && osm.trams.length) this.add(tramTrack(tramLines(osm, index, halfWidth + 0.4), groundAt));
    if (biome?.carFree) {
      this.add(parkFurniture(route, index, osm, groundAt, halfWidth));
      await this.outcrops(osm, index, groundAt, halfWidth);
    }
  }

  /**
   * Manhattan schist: the park's lawns are broken by dark grey, low, wide outcrops. OSM maps them as bare_rock
   * polygons; the scanned boulder is squashed flat and tinted dark and dropped in a few times per polygon.
   */
  private async outcrops(osm: OsmWorld, index: RouteIndex, groundAt: (x: number, z: number) => number, halfWidth: number) {
    const src = await loadModel('rock_07.glb');
    src.updateMatrixWorld(true);
    let scan: THREE.Mesh | null = null;
    src.traverse((c) => {
      if (!scan && (c as THREE.Mesh).isMesh) scan = c as THREE.Mesh;
    });
    const sm = scan as THREE.Mesh | null;
    if (!sm) return;
    let geo = sm.geometry.clone().applyMatrix4(sm.matrixWorld);
    // the decimated scan has hard creases: soften so the schist reads as weathered stone
    geo.deleteAttribute('normal');
    geo = mergeVertices(geo, 0.02);
    geo.computeVertexNormals();
    const mat = (sm.material as THREE.MeshStandardMaterial).clone();
    mat.color.setRGB(0.8, 0.8, 0.84);
    const spots: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion(), e = new THREE.Euler();
    let seed = 1;
    for (const c of osm.cover) {
      if (c.cls !== 'rock') continue;
      const o = c.poly.outer, [x0, z0, x1, z1] = c.poly.bbox;
      if (index.nearest((x0 + x1) / 2, (z0 + z1) / 2, 230).index < 0) continue;
      const area = ringAreaXZ(o);
      if (area < 6) continue;
      const n = Math.min(9, Math.max(1, Math.round(area / 70)));
      for (let k = 0, tries = 0; k < n && tries < n * 12; tries++) {
        seed++;
        const x = x0 + hash(seed * 1.3) * (x1 - x0), z = z0 + hash(seed * 2.9) * (z1 - z0);
        if (!inRingXZ(o, x, z)) continue;
        k++;
        if (index.nearest(x, z, halfWidth + 3).index >= 0) continue;
        const y = groundAt(x, z);
        if (!Number.isFinite(y)) continue;
        const big = hash(seed * 4.1);
        const sx = 2.6 + big * 3.6, sy = 2.2 + hash(seed * 5.3) * 2, sz = 2 + hash(seed * 6.7) * 2.6;
        e.set((hash(seed * 7.7) - 0.5) * 0.12, hash(seed * 8.3) * Math.PI * 2, (hash(seed * 9.1) - 0.5) * 0.12);
        q.setFromEuler(e);
        spots.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.18 * sy, z), q, new THREE.Vector3(sx, sy, sz)));
      }
    }
    if (!spots.length) return;
    const mesh = new THREE.InstancedMesh(geo, patchMaterial(mat, { key: 'outcrop' }), spots.length);
    spots.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    this.add(mesh);
  }

  /**
   * OSM communication towers, masts and bell towers: a concrete transmitter (Mont Ventoux, Kitzbüheler Horn) is a
   * shaft with an equipment drum under a banded antenna; small antennas are slim steel masts. Tall
   * ones carry red and white aviation bands.
   */
  private towers(osm: OsmWorld, groundAt: (x: number, z: number) => number, models: [number, number][], biome?: Biome): THREE.Object3D {
    const parts: [THREE.BufferGeometry, THREE.Color][] = [];
    const srgb = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
    const concreteCol = srgb(0.8, 0.8, 0.78), drumCol = srgb(0.64, 0.65, 0.66), steel = srgb(0.56, 0.57, 0.59);
    const red = srgb(0.74, 0.12, 0.09), white = srgb(0.93, 0.93, 0.91), slate = srgb(0.33, 0.34, 0.36);
    const cyl = (r0: number, r1: number, y0: number, y1: number, x: number, z: number, seg = 14) =>
      new THREE.CylinderGeometry(r1, r0, y1 - y0, seg).translate(x, (y0 + y1) / 2, z);
    const bands = (r: number, y0: number, y1: number, x: number, z: number, n: number) => {
      for (let k = 0; k < n; k++) {
        const a = y0 + ((y1 - y0) * k) / n, b = y0 + ((y1 - y0) * (k + 1)) / n;
        parts.push([cyl(r * (1 - (0.3 * k) / n), r * (1 - (0.3 * (k + 1)) / n), a, b, x, z, 8), k % 2 ? white : red]);
      }
    };
    for (const t of osm.towers) {
      if (models.some(([mx, mz]) => Math.hypot(mx - t.x, mz - t.z) < 120)) continue;
      const y = groundAt(t.x, t.z);
      if (!Number.isFinite(y)) continue;
      if (t.bell) {
        // Mallorcan bell towers are stone with tile caps, and Midtown's are church steeples between skyscrapers: left out rather than drawn Alpine
        if (biome?.id === 'mediterranean' || biome?.carFree || biome?.streets) continue;
        // a church tower mapped on its own: white shaft and a slate spire
        const H = t.height || 28;
        const w = Math.min(4, Math.max(2.5, t.r || 3));
        parts.push([new THREE.BoxGeometry(w * 2, H + 1.5, w * 2).translate(t.x, y - 1.5 + (H + 1.5) / 2, t.z), white]);
        parts.push([new THREE.ConeGeometry(w * 1.42, w * 3.8, 4).rotateY(Math.PI / 4).translate(t.x, y + H + w * 1.9, t.z), slate]);
        continue;
      }
      if (t.concrete) {
        const H = t.height || (t.name ? 80 : 40);
        const R = Math.min(6, Math.max(2.5, t.r * 0.55 || 3));
        const top = y + H * 0.62;
        parts.push([cyl(R, R * 0.85, y - 1.5, top, t.x, t.z, 18), concreteCol]);
        parts.push([cyl(R * 1.35, R * 1.35, top, top + H * 0.08, t.x, t.z, 18), drumCol]);
        parts.push([cyl(R * 0.9, R * 0.7, top + H * 0.08, top + H * 0.12, t.x, t.z, 14), concreteCol]);
        bands(Math.max(0.5, R * 0.18), top + H * 0.12, y + H, t.x, t.z, 6);
      } else {
        // unknown small antennas are left out: only mapped heights or named masts
        if (t.height < 8 && !t.name) continue;
        const H = t.height || 30;
        if (H >= 45) bands(0.55, y - 0.5, y + H, t.x, t.z, 7);
        else {
          parts.push([cyl(0.32, 0.22, y - 0.5, y + H, t.x, t.z, 8), steel]);
          // antenna panels near the top
          for (let k = 0; k < 3; k++) {
            const a = (k / 3) * Math.PI * 2;
            parts.push([new THREE.BoxGeometry(0.3, 1.6, 0.12).rotateY(-a).translate(t.x + Math.cos(a) * 0.45, y + H - 1.6, t.z + Math.sin(a) * 0.45), steel]);
          }
        }
      }
    }
    if (!parts.length) return new THREE.Group();
    const mat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1 }), { key: 'tower' });
    const mesh = new THREE.Mesh(mergeColored(parts), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /** Three sagging conductors between consecutive poles of each OSM power line. */
  private wires(osm: OsmWorld, poles: { x: number; z: number }[], groundAt: (x: number, z: number) => number): THREE.Object3D {
    const pos: number[] = [];
    for (const line of osm.barriers) {
      if (!line.kind.startsWith('power:')) continue;
      const pts = line.pts;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
        // only spans whose ends have a pole we placed (inside the corridor)
        const has = (x: number, z: number) => poles.some((p) => Math.abs(p.x - x) < 2 && Math.abs(p.z - z) < 2);
        if (!has(ax, az) || !has(bx, bz)) continue;
        const ya = groundAt(ax, az), yb = groundAt(bx, bz);
        if (!Number.isFinite(ya) || !Number.isFinite(yb)) continue;
        const dx = bx - ax, dz = bz - az;
        const len = Math.hypot(dx, dz) || 1;
        const px = -dz / len, pz = dx / len;
        for (const [o, top] of [[-0.85, 8.75], [0, 9.15], [0.85, 8.75]] as const) {
          const seg = 12;
          const sag = Math.min(2.2, len * 0.012 + 0.3);
          for (let k = 0; k < seg; k++) {
            for (const t of [k / seg, (k + 1) / seg]) {
              const y = ya + (yb - ya) * t + top - sag * 4 * t * (1 - t);
              pos.push(ax + dx * t + px * o, y, az + dz * t + pz * o);
            }
          }
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mat = patchMaterial(new THREE.LineBasicMaterial({ color: 0x2a2c2e, transparent: true, opacity: 0.85 }), { key: 'wire' });
    return new THREE.LineSegments(geo, mat);
  }

  /** OSM fences (posts and two rails) and walls (rough stone) near the road. */
  private fences(
    osm: OsmWorld, index: RouteIndex, groundAt: (x: number, z: number) => number, halfWidth = 3.5, biome?: Biome,
  ): THREE.Object3D {
    const g = new THREE.Group();
    const med = biome?.id === 'mediterranean';
    const mesh = med ? new MedFences() : null;
    const park = biome?.carFree || biome?.streets ? new ParkBarriers(osm) : null;
    const wood = patchMaterial(new THREE.MeshLambertMaterial({ color: 0x5a412b }), { key: 'fence' });
    const stone = patchMaterial(new THREE.MeshLambertMaterial({ color: 0x8e8a82 }), { key: 'wall' });
    const post = new THREE.BoxGeometry(0.1, 1.2, 0.1).translate(0, 0.5, 0);
    const postMats: THREE.Matrix4[] = [];
    const railPos: number[] = [];
    const wallPos: number[] = [];
    const quad = (arr: number[], a: number[], b: number[], c: number[], d: number[]) => arr.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (const bar of osm.barriers) {
      if (bar.kind !== 'fence' && bar.kind !== 'wall' && bar.kind !== 'retaining_wall') continue;
      const p = bar.pts;
      // every vertex is checked (a long barrier may only come near the route far from its first node)
      const nearV: boolean[] = [];
      for (let i = 0; i + 1 < p.length; i += 2) nearV.push(index.nearest(p[i], p[i + 1], 250).index >= 0);
      if (!nearV.some(Boolean)) continue;
      for (let i = 0; i + 3 < p.length; i += 2) {
        if (!nearV[i / 2] && !nearV[i / 2 + 1]) continue;
        const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
        if (park && bar.kind !== 'retaining_wall') {
          // never across the drive (OSM walls end at or run under the road)
          park.add(ax, az, bx, bz, bar, groundAt, (x, z) => index.nearest(x, z, halfWidth + 0.8).index >= 0);
          continue;
        }
        if (mesh && bar.kind === 'fence') {
          mesh.fence(ax, az, bx, bz, groundAt);
          continue;
        }
        if (mesh && bar.kind === 'wall') {
          // walls along the road edge are the road parapets (Roadside); these are field walls
          const mid = index.nearest((ax + bx) / 2, (az + bz) / 2, 60);
          const e0 = index.nearest(ax, az, 60), e1 = index.nearest(bx, bz, 60);
          const d = Math.min(mid.dist, e0.dist, e1.dist);
          if (d < halfWidth + 6.5) continue;
          mesh.wall(ax, az, bx, bz, groundAt);
          continue;
        }
        const len = Math.hypot(bx - ax, bz - az);
        const steps = Math.max(1, Math.round(len / 2.5));
        for (let k = 0; k < steps; k++) {
          const t0 = k / steps, t1 = (k + 1) / steps;
          const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0;
          const x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
          // never across the carriageway (OSM walls and fences end at or run under the road); a
          // retaining wall at the road edge is the road's own and Roadside faces the cut instead
          const keep = bar.kind === 'retaining_wall' ? halfWidth + 3 : halfWidth + 0.8;
          const on = index.nearest((x0 + x1) / 2, (z0 + z1) / 2, keep);
          if (on.index >= 0 && on.dist < keep) continue;
          const y0 = groundAt(x0, z0), y1 = groundAt(x1, z1);
          if (!Number.isFinite(y0) || !Number.isFinite(y1)) continue;
          if (bar.kind === 'fence') {
            postMats.push(new THREE.Matrix4().makeTranslation(x0, y0 - 0.1, z0));
            for (const hgt of [0.45, 0.95]) {
              quad(railPos, [x0, y0 + hgt, z0], [x1, y1 + hgt, z1], [x1, y1 + hgt + 0.1, z1], [x0, y0 + hgt + 0.1, z0]);
            }
          } else {
            const nx = -(z1 - z0), nz = x1 - x0;
            const nl = Math.hypot(nx, nz) || 1;
            const ox = (nx / nl) * 0.25, oz = (nz / nl) * 0.25;
            const top = 0.9;
            quad(wallPos, [x0 + ox, y0 - 0.2, z0 + oz], [x1 + ox, y1 - 0.2, z1 + oz], [x1 + ox, y1 + top, z1 + oz], [x0 + ox, y0 + top, z0 + oz]);
            quad(wallPos, [x0 - ox, y0 - 0.2, z0 - oz], [x1 - ox, y1 - 0.2, z1 - oz], [x1 - ox, y1 + top, z1 - oz], [x0 - ox, y0 + top, z0 - oz]);
            quad(wallPos, [x0 + ox, y0 + top, z0 + oz], [x1 + ox, y1 + top, z1 + oz], [x1 - ox, y1 + top, z1 - oz], [x0 - ox, y0 + top, z0 - oz]);
          }
        }
      }
    }
    if (mesh) g.add(...mesh.build());
    if (park) g.add(...park.build());
    if (postMats.length) {
      const posts = new THREE.InstancedMesh(post, wood, postMats.length);
      postMats.forEach((m, i) => posts.setMatrixAt(i, m));
      posts.castShadow = true;
      posts.computeBoundingSphere();
      g.add(posts);
    }
    for (const [arr, mat] of [[railPos, wood], [wallPos, stone]] as const) {
      if (!arr.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat);
      (m.material as THREE.Material).side = THREE.DoubleSide;
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    return g;
  }
}

/**
 * Mediterranean field boundaries: galvanised wire-mesh fences (thin grey posts every ~2.7 m,
 * 1.5 m diamond mesh) and dry-stone field walls (1.0-1.2 m, scanned limestone texture).
 */
class MedFences {
  private postMats: THREE.Matrix4[] = [];
  private mesh = { pos: [] as number[], uv: [] as number[], idx: [] as number[] };
  private wall_ = { pos: [] as number[], uv: [] as number[], idx: [] as number[] };
  private along = 0;

  fence(ax: number, az: number, bx: number, bz: number, groundAt: (x: number, z: number) => number) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.5) return;
    const steps = Math.max(1, Math.round(len / 2.7));
    const H = 1.5;
    const m = this.mesh;
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion().setFromAxisAngle(up, -Math.atan2(bz - az, bx - ax));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const y = groundAt(x, z);
      if (!Number.isFinite(y)) continue;
      // the last post of a segment is the first of the next one
      if (k < steps) this.postMats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.1, z), q, new THREE.Vector3(1, 1, 1)));
      if (k < steps) {
        const t1 = (k + 1) / steps;
        const x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
        const y1 = groundAt(x1, z1);
        if (!Number.isFinite(y1)) continue;
        const b = m.pos.length / 3;
        const w = len / steps;
        m.pos.push(x, y, z, x1, y1, z1, x1, y1 + H, z1, x, y + H, z);
        m.uv.push(0, 0, w, 0, w, H, 0, H);
        m.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
    }
  }

  wall(ax: number, az: number, bx: number, bz: number, groundAt: (x: number, z: number) => number) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.5) return;
    const steps = Math.max(1, Math.round(len / 2));
    const nx = -(bz - az) / len, nz = (bx - ax) / len;
    const T = 0.27;
    const H = 1.0 + 0.2 * hash(Math.floor(ax * 0.37 + az * 0.91));
    // cross-section: offset, height (negative = buried), v in metres
    const prof: [number, number][] = [[-T, -0.35], [-T * 0.9, H], [0, H + 0.07], [T * 0.9, H], [T, -0.35]];
    const w = this.wall_;
    const base = w.pos.length / 3;
    let ok = 0;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const y = groundAt(x, z);
      if (!Number.isFinite(y)) return;
      ok++;
      const u = this.along + len * t;
      prof.forEach(([o, h], j) => {
        w.pos.push(x + nx * o, y + h, z + nz * o);
        w.uv.push(u / 2, j === 0 || j === 4 ? h / 2 + 0.2 : j === 2 ? H / 2 + 0.5 : h / 2);
      });
    }
    this.along += len;
    const P = prof.length;
    for (let k = 0; k < ok - 1; k++)
      for (let j = 0; j < P - 1; j++) {
        const a = base + k * P + j, b = a + 1, c = a + P, d = c + 1;
        w.idx.push(a, c, b, b, c, d);
      }
  }

  build(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    if (this.postMats.length) {
      const mat = patchMaterial(new THREE.MeshLambertMaterial({ color: 0xa4a8aa }), { key: 'fencepost' });
      const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 1.6, 0.05).translate(0, 0.8, 0), mat, this.postMats.length);
      this.postMats.forEach((m, i) => posts.setMatrixAt(i, m));
      posts.castShadow = true;
      posts.computeBoundingSphere();
      out.push(posts);
    }
    const mk = (d: { pos: number[]; uv: number[]; idx: number[] }, mat: THREE.Material, shadow: boolean) => {
      if (!d.idx.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
      geo.setIndex(d.idx);
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = shadow;
      m.receiveShadow = true;
      out.push(m);
    };
    mk(this.mesh, patchMaterial(wireMaterial(), { key: 'wiremesh' }), false);
    if (this.wall_.idx.length) {
      const t = fieldWallTexture();
      const stone = new THREE.MeshStandardMaterial({ map: t, color: new THREE.Color(1.5, 1.45, 1.35), roughness: 0.95, side: THREE.DoubleSide });
      mk(this.wall_, patchMaterial(stone, { key: 'fieldwall' }), true);
    }
    return out;
  }
}

/** Galvanised diamond mesh: 1 m x 1.5 m per texture tile, alpha-tested wires. */
function wireMaterial(): THREE.MeshLambertMaterial {
  const W = 128, H = 192; // 1 m x 1.5 m
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = '#c9cdce';
  ctx.lineWidth = 2.2;
  const cell = 32; // ~25 cm diamonds
  ctx.beginPath();
  for (let i = -H; i <= W + H; i += cell) {
    ctx.moveTo(i, 0);
    ctx.lineTo(i + H, H);
    ctx.moveTo(i, 0);
    ctx.lineTo(i - H, H);
  }
  ctx.stroke();
  // taut top and bottom strand
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 2);
  ctx.lineTo(W, 2);
  ctx.moveTo(0, H - 2);
  ctx.lineTo(W, H - 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: false, alphaTest: 0.35, side: THREE.DoubleSide });
  mat.alphaToCoverage = true;
  return mat;
}

/** A spot 0.8 m outside the longest wall of a building, facing along it. */
function besideWall(b: Building, seed: number): { x: number; z: number; yaw: number } | null {
  const r = b.ring;
  const n = r.length / 2;
  if (n < 3) return null;
  let best = -1, bestLen = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const l = Math.hypot(r[j * 2] - r[i * 2], r[j * 2 + 1] - r[i * 2 + 1]);
    if (l > bestLen) {
      bestLen = l;
      best = i;
    }
  }
  if (bestLen < 6) return null;
  const j = (best + 1) % n;
  const ax = r[best * 2], az = r[best * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
  let cx = 0, cz = 0;
  for (let i = 0; i < n; i++) {
    cx += r[i * 2] / n;
    cz += r[i * 2 + 1] / n;
  }
  const t = 0.3 + hash(seed) * 0.4;
  const mx = ax + (bx - ax) * t, mz = az + (bz - az) * t;
  let nx = -(bz - az), nz = bx - ax;
  const nl = Math.hypot(nx, nz);
  nx /= nl;
  nz /= nl;
  if ((mx - cx) * nx + (mz - cz) * nz < 0) {
    nx = -nx;
    nz = -nz;
  }
  return { x: mx + nx * 1.4, z: mz + nz * 1.4, yaw: -Math.atan2(bz - az, bx - ax) };
}

let wallTex: THREE.Texture | null = null;

function fieldWallTexture() {
  if (wallTex) return wallTex;
  const t = new THREE.TextureLoader().load('/textures/med/wall.jpg');
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return (wallTex = markShared(t));
}


function ringAreaXZ(r: Float32Array): number {
  let a = 0;
  for (let i = 0, n = r.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1];
  }
  return Math.abs(a) / 2;
}

function inRingXZ(r: Float32Array, x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2], zi = r[i * 2 + 1], xj = r[j * 2], zj = r[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distToRing(r: Float32Array, x: number, z: number): number {
  let best = Infinity;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const ax = r[j * 2], az = r[j * 2 + 1], bx = r[i * 2], bz = r[i * 2 + 1];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  return best;
}

let parkStoneTex: THREE.Texture | null = null;
let steelTex: THREE.Texture | null = null;

/** Rough Manhattan schist, laid in courses: dark grey-brown blocks, pale lichen, black mortar. 2 m x 1 m per tile. */
function schistTexture(): THREE.Texture {
  if (parkStoneTex) return parkStoneTex;
  const W = 256, H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#34322f';
  ctx.fillRect(0, 0, W, H);
  let seed = 11;
  const rnd = () => hash(seed++);
  for (let y = 0, row = 0; y < H; row++) {
    const h = 20 + Math.floor(rnd() * 14);
    const rh = Math.min(h, H - y);
    for (let x = -rnd() * 40; x < W; ) {
      const w = 34 + rnd() * 58;
      const l = 0.9 + rnd() * 0.5;
      const warm = rnd() < 0.3;
      ctx.fillStyle = `rgb(${Math.round((warm ? 150 : 132) * l)},${Math.round((warm ? 138 : 129) * l)},${Math.round((warm ? 122 : 124) * l)})`;
      ctx.beginPath();
      ctx.roundRect(x + 1.5, y + 1.5, w - 3, rh - 3, 4);
      ctx.fill();
      // mica glint and pale lichen on some blocks
      if (rnd() < 0.5) {
        ctx.fillStyle = 'rgba(190,190,180,0.16)';
        ctx.fillRect(x + 4 + rnd() * (w - 20), y + 4 + rnd() * (rh - 12), 6 + rnd() * 12, 2);
      }
      x += w;
    }
    y += h;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return (parkStoneTex = markShared(t));
}

/** Black steel railing: vertical pickets between a top and a bottom rail on a transparent 1 m x 1.2 m tile. */
function railTexture(): THREE.Texture {
  if (steelTex) return steelTex;
  const W = 128, H = 154;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0c0d0e';
  for (let x = 4; x < W; x += 11) ctx.fillRect(x, 10, 4, H - 22);
  ctx.fillRect(0, 6, W, 8);
  ctx.fillRect(0, H - 24, W, 7);
  // spear tips
  for (let x = 4; x < W; x += 11) {
    ctx.beginPath();
    ctx.moveTo(x - 1, 10);
    ctx.lineTo(x + 2, 0);
    ctx.lineTo(x + 5, 10);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return (steelTex = markShared(t));
}

/**
 * Central Park's boundaries. Walls (OSM barrier=wall) are the waist-high rough schist wall with a flat capstone
 * that rings the park; the same OSM kind runs along the Reservoir too, where the real thing is a low black steel
 * railing, so a barrier within a few metres of that big water becomes the railing instead.
 */
class ParkBarriers {
  private wall = { pos: [] as number[], uv: [] as number[], col: [] as number[], idx: [] as number[] };
  private rail = { pos: [] as number[], uv: [] as number[], idx: [] as number[] };
  private posts: THREE.Matrix4[] = [];
  private along = 0;
  private reservoirs: Float32Array[];

  constructor(osm: OsmWorld) {
    this.reservoirs = osm.water.filter((w) => ringAreaXZ(w.outer) > 250_000).map((w) => w.outer);
  }

  private nearReservoir(x: number, z: number) {
    return this.reservoirs.some((r) => distToRing(r, x, z) < 16);
  }

  add(
    ax: number, az: number, bx: number, bz: number, bar: { kind: string; height?: number },
    groundAt: (x: number, z: number) => number, blocked: (x: number, z: number) => boolean,
  ) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.4) return;
    const steel = bar.kind === 'fence' || this.nearReservoir((ax + bx) / 2, (az + bz) / 2);
    const steps = Math.max(1, Math.round(len / (steel ? 2.5 : 2)));
    const nx = -(bz - az) / len, nz = (bx - ax) / len;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(bz - az, bx - ax));
    const H = steel ? 1.2 : Math.min(2.2, bar.height ?? 1.05);
    const T = 0.25;
    for (let k = 0; k < steps; k++) {
      const t0 = k / steps, t1 = (k + 1) / steps;
      const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
      if (blocked((x0 + x1) / 2, (z0 + z1) / 2)) continue;
      const y0 = groundAt(x0, z0), y1 = groundAt(x1, z1);
      if (!Number.isFinite(y0) || !Number.isFinite(y1)) continue;
      const seg = Math.hypot(x1 - x0, z1 - z0);
      if (steel) {
        const r = this.rail, b = r.pos.length / 3;
        r.pos.push(x0, y0, z0, x1, y1, z1, x1, y1 + H, z1, x0, y0 + H, z0);
        r.uv.push(0, 0, seg, 0, seg, H / 1.2, 0, H / 1.2);
        r.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
        this.posts.push(new THREE.Matrix4().compose(new THREE.Vector3(x0, y0 - 0.1, z0), q, new THREE.Vector3(1, 1, 1)));
        continue;
      }
      // cross-section: offset, height (negative = buried), colour tone; the capstone overhangs and is paler
      const prof: [number, number, number][] = [
        [-T, -0.3, 0.8], [-T * 0.92, H, 0.8], [-T - 0.05, H, 0.8], [-T - 0.05, H + 0.07, 1.25],
        [T + 0.05, H + 0.07, 1.25], [T + 0.05, H, 0.8], [T * 0.92, H, 0.8], [T, -0.3, 0.8],
      ];
      const w = this.wall;
      const u0 = (this.along + len * t0) / 2, u1 = (this.along + len * t1) / 2;
      const base = w.pos.length / 3;
      for (const [x, z, y, u] of [[x0, z0, y0, u0], [x1, z1, y1, u1]] as const) {
        for (const [o, h, tone] of prof) {
          w.pos.push(x + nx * o, y + h, z + nz * o);
          w.uv.push(u, h >= H ? 0.95 : (h + 0.3) / 1.4 * 0.9);
          w.col.push(tone, tone, tone);
        }
      }
      const P = prof.length;
      for (let j = 0; j < P - 1; j++) {
        const a = base + j, b = a + 1, c = a + P, d = c + 1;
        w.idx.push(a, c, b, b, c, d);
      }
    }
    this.along += len;
  }

  build(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    const geo = (d: { pos: number[]; uv: number[]; idx: number[]; col?: number[] }, normals: boolean) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
      if (d.col) g.setAttribute('color', new THREE.Float32BufferAttribute(d.col, 3));
      g.setIndex(d.idx);
      if (normals) g.computeVertexNormals();
      g.computeBoundingSphere();
      return g;
    };
    if (this.wall.idx.length) {
      const mat = patchMaterial(
        new THREE.MeshStandardMaterial({ map: schistTexture(), vertexColors: true, roughness: 0.96, side: THREE.DoubleSide }),
        { key: 'parkwall' },
      );
      const m = new THREE.Mesh(geo(this.wall, true), mat);
      m.castShadow = true;
      m.receiveShadow = true;
      out.push(m);
    }
    if (this.rail.idx.length) {
      const mat = new THREE.MeshLambertMaterial({ map: railTexture(), alphaTest: 0.4, side: THREE.DoubleSide });
      mat.alphaToCoverage = true;
      const g = geo(this.rail, false);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, patchMaterial(mat, { key: 'parkrail' }));
      m.receiveShadow = true;
      out.push(m);
      const posts = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.07, 1.3, 0.07).translate(0, 0.6, 0),
        patchMaterial(new THREE.MeshLambertMaterial({ color: 0x0c0d0e }), { key: 'parkpost' }),
        this.posts.length,
      );
      this.posts.forEach((p, i) => posts.setMatrixAt(i, p));
      posts.castShadow = true;
      posts.computeBoundingSphere();
      out.push(posts);
    }
    return out;
  }
}

export interface BenchSpot {
  x: number;
  z: number;
  /** Yaw that points the bench's front (-Z) at the drive. */
  yaw: number;
  /** Arc length of the nearest route point (m). */
  s: number;
}

/**
 * Park benches in short rows along the drive, facing it, set back past the lamp line. Deterministic (hash, no
 * state) so Life can seat people on exactly the benches Props drew.
 */
export function parkBenches(route: Route, halfWidth: number): BenchSpot[] {
  const out: BenchSpot[] = [];
  const off = halfWidth + 3.8;
  for (let s = 25 + hash(1) * 30, st = 1; s < route.length - 10; st++, s += 24 + hash(st * 3.7) * 48) {
    const side = hash(st * 1.9) < 0.5 ? -1 : 1;
    const n = 1 + Math.floor(hash(st * 5.3) * 3.2);
    for (let j = 0; j < n; j++) {
      const ss = s + (j - (n - 1) / 2) * 2.3;
      const i = Math.max(0, Math.min(route.n - 1, Math.round(ss / route.step)));
      const h = route.heading[i];
      const fx = -side * Math.cos(h), fz = -side * Math.sin(h);
      out.push({
        x: route.x[i] + Math.cos(h) * off * side, z: route.z[i] + Math.sin(h) * off * side, yaw: Math.atan2(-fx, -fz), s: i * route.step,
      });
    }
  }
  return out;
}

/** Benches, litter bins and OSM street lamps on the footpaths: black cast iron and dark green, instanced. */
function parkFurniture(
  route: Route, index: RouteIndex, osm: OsmWorld, groundAt: (x: number, z: number) => number, halfWidth: number,
): THREE.Object3D {
  const g = new THREE.Group();
  const srgb = (r: number, gg: number, b: number) => new THREE.Color().setRGB(r, gg, b, THREE.SRGBColorSpace);
  const iron = srgb(0.07, 0.07, 0.08), green = srgb(0.1, 0.27, 0.15);
  const mat = (key: string) => patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.35 }), { key });
  const inst = (geo: THREE.BufferGeometry, key: string, ms: THREE.Matrix4[]) => {
    if (!ms.length) return;
    const m = new THREE.InstancedMesh(geo, mat(key), ms.length);
    ms.forEach((x, i) => m.setMatrixAt(i, x));
    m.castShadow = true;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    g.add(m);
  };
  // bench: seven green slats (three seat, four back), cast-iron end frames with scrolled arms. Front is -Z.
  const slat = (y: number, z: number, tilt: number) => new THREE.BoxGeometry(1.85, 0.05, 0.1).rotateX(tilt).translate(0, y, z);
  const frame = (x: number) => [
    [new THREE.BoxGeometry(0.05, 0.44, 0.05).translate(x, 0.22, -0.2), iron],
    [new THREE.BoxGeometry(0.05, 0.44, 0.05).translate(x, 0.22, 0.2), iron],
    [new THREE.BoxGeometry(0.05, 0.05, 0.5).translate(x, 0.46, 0), iron],
    [new THREE.BoxGeometry(0.05, 0.5, 0.05).rotateX(0.2).translate(x, 0.72, 0.24), iron],
    [new THREE.BoxGeometry(0.05, 0.05, 0.42).translate(x, 0.62, -0.02), iron],
  ] as [THREE.BufferGeometry, THREE.Color][];
  const bench = mergeColored([
    ...([-0.15, 0, 0.15] as const).map((z) => [slat(0.47, z, 0), green] as [THREE.BufferGeometry, THREE.Color]),
    ...([0.58, 0.68, 0.78, 0.88] as const).map((y, k) => [slat(y, 0.25 + k * 0.045, 0.2), green] as [THREE.BufferGeometry, THREE.Color]),
    ...frame(-0.85), ...frame(0.85),
  ]);
  const spots = parkBenches(route, halfWidth);
  const benches: THREE.Matrix4[] = [], bins: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  spots.forEach((b, i) => {
    const y = groundAt(b.x, b.z);
    if (!Number.isFinite(y)) return;
    q.setFromAxisAngle(up, b.yaw);
    benches.push(new THREE.Matrix4().compose(new THREE.Vector3(b.x, y - 0.02, b.z), q, one));
    // a wire litter bin at the end of every third row
    if (i % 3 === 0) {
      const bx = b.x + Math.cos(b.yaw) * 1.7, bz = b.z - Math.sin(b.yaw) * 1.7;
      const by = groundAt(bx, bz);
      if (Number.isFinite(by)) bins.push(new THREE.Matrix4().makeTranslation(bx, by, bz));
    }
  });
  inst(bench, 'parkbench', benches);
  inst(mergeColored([
    [new THREE.CylinderGeometry(0.27, 0.23, 0.82, 12, 1, true).translate(0, 0.45, 0), green],
    [new THREE.CylinderGeometry(0.28, 0.28, 0.05, 12).translate(0, 0.88, 0), iron],
    [new THREE.CylinderGeometry(0.23, 0.23, 0.05, 12).translate(0, 0.05, 0), iron],
    [new THREE.CylinderGeometry(0.03, 0.03, 0.82, 6).translate(0.2, 0.45, 0), iron],
    [new THREE.CylinderGeometry(0.03, 0.03, 0.82, 6).translate(-0.2, 0.45, 0), iron],
  ]), 'parkbin', bins);
  // the park's cast-iron lamp posts that OSM maps on the footpaths (the drive's own are set by Road)
  const lampGeo = mergeColored([
    [new THREE.CylinderGeometry(0.1, 0.17, 0.7, 10).translate(0, 0.35, 0), iron],
    [new THREE.CylinderGeometry(0.05, 0.075, 2.6, 10).translate(0, 2.0, 0), iron],
    [new THREE.CylinderGeometry(0.11, 0.05, 0.22, 10).translate(0, 3.38, 0), iron],
    [new THREE.SphereGeometry(0.2, 10, 8).scale(1, 1.25, 1).translate(0, 3.7, 0), srgb(0.95, 0.93, 0.8)],
    [new THREE.ConeGeometry(0.2, 0.2, 10).translate(0, 4.02, 0), iron],
    [new THREE.SphereGeometry(0.04, 6, 5).translate(0, 4.15, 0), iron],
  ]);
  const lamps: THREE.Matrix4[] = [];
  const seen = new Set<string>();
  for (const p of osm.pois) {
    if (p.kind !== 'street_lamp') continue;
    const near = index.nearest(p.x, p.z, 70);
    if (near.index < 0 || near.dist < halfWidth + 3) continue;
    const key = `${Math.round(p.x / 3)},${Math.round(p.z / 3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const y = groundAt(p.x, p.z);
    if (Number.isFinite(y)) lamps.push(new THREE.Matrix4().makeTranslation(p.x, y - 0.1, p.z));
  }
  inst(lampGeo, 'parklamp', lamps);
  return g;
}

/**
 * Street lamps of the Ring at the places OSM maps them: a slim dark mast on a fluted base, a curved arm over the
 * carriageway and a cream glass lantern. The arm points at the nearest bit of road; lamps on the asphalt are dropped.
 */
function viennaLamps(
  route: Route, index: RouteIndex, osm: OsmWorld, groundAt: (x: number, z: number) => number, halfWidth: number,
): THREE.Object3D {
  const srgb = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
  const iron = srgb(0.1, 0.11, 0.11), glass = srgb(0.93, 0.9, 0.78);
  const geo = mergeColored([
    [new THREE.CylinderGeometry(0.17, 0.24, 0.95, 10).translate(0, 0.47, 0), iron],
    [new THREE.CylinderGeometry(0.2, 0.2, 0.1, 10).translate(0, 0.98, 0), iron],
    [new THREE.CylinderGeometry(0.06, 0.1, 6.0, 8).translate(0, 4.0, 0), iron],
    [new THREE.CylinderGeometry(0.11, 0.07, 0.25, 8).translate(0, 6.9, 0), iron],
    [new THREE.BoxGeometry(0.06, 0.06, 1.7).translate(0, 7.05, -0.8), iron],
    [new THREE.BoxGeometry(0.05, 0.05, 0.5).rotateX(0.6).translate(0, 6.85, -0.25), iron],
    [new THREE.CylinderGeometry(0.2, 0.3, 0.2, 10).translate(0, 7.0, -1.55), iron],
    [new THREE.CylinderGeometry(0.28, 0.2, 0.34, 10).translate(0, 6.75, -1.55), glass],
  ]);
  const ms: THREE.Matrix4[] = [];
  const seen = new Set<string>();
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  for (const p of osm.pois) {
    if (p.kind !== 'street_lamp') continue;
    const near = index.nearest(p.x, p.z, 60);
    if (near.index < 0 || near.dist < halfWidth + 1.0) continue;
    const key = `${Math.round(p.x / 3)},${Math.round(p.z / 3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const y = groundAt(p.x, p.z);
    if (!Number.isFinite(y)) continue;
    const dx = route.x[near.index] - p.x, dz = route.z[near.index] - p.z;
    q.setFromAxisAngle(up, Math.atan2(-dx, -dz));
    ms.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, y - 0.05, p.z), q, one));
  }
  const g = new THREE.Group();
  if (!ms.length) return g;
  const m = new THREE.InstancedMesh(geo, patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.5 }), { key: 'viennalamp' }), ms.length);
  ms.forEach((x, i) => m.setMatrixAt(i, x));
  m.castShadow = true;
  m.computeBoundingSphere();
  g.add(m);
  return g;
}
