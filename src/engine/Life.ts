// Things that move: paragliders thermalling over the real Gaisberg take-off sites (OSM
// sport=free_flying), Pinzgauer cattle grazing on OSM meadows, a flock of jackdaws at the
// summit, and road traffic (oncoming cars and motorbikes, the odd car overtaking). On Mallorca:
// goats, sailboats, tour coaches and other cyclists.

import * as THREE from 'three';
import type { OsmWorld } from '../geo/osm.ts';
import { pointAt, type Route, type RouteIndex, type RoutePoint } from '../geo/route.ts';
import { patchMaterial } from './atmosphere.ts';
import { loadModel } from './Landmarks.ts';
import type { Biome } from './biome.ts';
import { Rider } from './Rider.ts';
import { WorldGroup } from './dispose.ts';

const CANOPIES = ['#f5a11a', '#d7263d', '#1b98e0', '#2bb673', '#f4d35e', '#7b2cbf', '#ff6b35', '#e0e0e0'];
const KITS = ['#e63946', '#1d3557', '#2a9d8f', '#f4a261', '#f1f1ee', '#111214', '#ffb703', '#8338ec'];
const CAR_COLOURS = ['#5d6f86', '#b8bcc2', '#1f2329', '#8c1c13', '#f2f2ef', '#2d4a6b', '#4a5d3a', '#c7a25a'];

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Clone a model and give the listed materials their own colour. */
function tinted(src: THREE.Group, names: string[], colour: string): THREE.Group {
  const o = src.clone(true);
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const swap = (mat: THREE.Material) => {
      if (!names.includes(mat.name)) return mat;
      const cl = mat.clone() as THREE.MeshStandardMaterial;
      cl.color.set(colour).convertSRGBToLinear();
      if (/_body$/.test(mat.name)) {
        cl.metalness = 0.12;
        cl.roughness = 0.32;
      }
      patchMaterial(cl, { key: `tint:${mat.name}` });
      return cl;
    };
    m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
    m.castShadow = true;
  });
  return o;
}

interface Glider {
  obj: THREE.Object3D;
  cx: number;
  cz: number;
  base: number;
  r: number;
  w: number; // rad/s, sign = turn direction
  a: number;
  climb: number;
  drift: THREE.Vector2;
}

interface Cow {
  obj: THREE.Object3D;
  yaw: number;
  turn: number;
  t: number;
}

interface Bird {
  obj: THREE.Group;
  wings: THREE.Object3D[];
  a: number;
  r: number;
  h: number;
  w: number;
  flap: number;
}

interface Walker {
  obj: THREE.Object3D;
  pts: Float32Array;
  seg: number;
  t: number;
  dir: 1 | -1;
  speed: number;
  phase: number;
}

interface Vehicle {
  obj: THREE.Object3D;
  s: number;
  dir: 1 | -1;
  speed: number;
  lateral: number;
  targetLateral: number;
  overtaking: boolean;
}

export class Life extends WorldGroup {
  private gliders: Glider[] = [];
  private cows: Cow[] = [];
  private birds: Bird[] = [];
  private vehicles: Vehicle[] = [];
  private walkers: Walker[] = [];
  private boats: { obj: THREE.Object3D; vx: number; vz: number; heel: number }[] = [];
  private groundAt: (x: number, z: number) => number = () => NaN;
  private cars: THREE.Group[] = [];
  private nextOncoming = 6;
  private nextOvertake = 40;
  private rand = rng(99);
  private route: Route | null = null;
  private tmp: Partial<RoutePoint> = {};
  /** Coaches drive slower than cars. */
  private coaches = new Set<THREE.Object3D>();
  private cyclistPool: Rider[] = [];
  private cyclists: { obj: Rider; s: number; dir: 1 | -1; speed: number; lateral: number; climbing: boolean }[] = [];
  private nextDescender = 6;
  private nextClimber = 2;

  async build(
    route: Route,
    index: RouteIndex,
    osm: OsmWorld,
    groundAt: (x: number, z: number) => number,
    coverAt: (x: number, z: number) => number,
    biome?: Biome,
  ) {
    this.route = route;
    this.groundAt = groundAt;
    const r = rng(7);
    // --- paragliders over the take-off sites
    const takeoffs = osm.pois.filter((p) => p.kind === 'takeoff');
    if (takeoffs.length) {
      const glider = await loadModel('paraglider.glb');
      const peak = osm.pois.find((p) => p.kind === 'peak') ?? takeoffs[0];
      for (let i = 0; i < 6; i++) {
        const t = takeoffs[i % takeoffs.length];
        // out over the slope below the take-off, away from the summit
        let dx = t.x - peak.x, dz = t.z - peak.z;
        const dl = Math.hypot(dx, dz) || 1;
        dx /= dl;
        dz /= dl;
        const out = 180 + r() * 380;
        const cx = t.x + dx * out + (r() - 0.5) * 200;
        const cz = t.z + dz * out + (r() - 0.5) * 200;
        const g = groundAt(t.x, t.z);
        const obj = tinted(glider, ['pg_a'], CANOPIES[i % CANOPIES.length]);
        obj.scale.setScalar(1);
        this.add(obj);
        this.gliders.push({
          obj, cx, cz, base: (Number.isFinite(g) ? g : 1250) + 60 + r() * 260, r: 45 + r() * 70,
          w: (r() < 0.5 ? -1 : 1) * (9.5 + r() * 2) / (45 + r() * 70), a: r() * Math.PI * 2, climb: r() * 10,
          drift: new THREE.Vector2(r() - 0.5, r() - 0.5).multiplyScalar(0.6),
        });
      }
    }
    if (biome?.id === 'mediterranean') await this.buildMediterranean(route, index, groundAt, coverAt, r);
    // --- cattle: herds on meadows near the road
    const cow = await loadModel('cow.glb');
    let herds = 0;
    for (let tries = 0; tries < 400 && herds < 6; tries++) {
      const i = Math.floor(r() * route.n);
      const h = route.heading[i];
      const side = r() < 0.5 ? -1 : 1;
      const d = 35 + r() * 160;
      const hx = route.x[i] + Math.cos(h) * d * side;
      const hz = route.z[i] + Math.sin(h) * d * side;
      if (coverAt(hx, hz) !== 1) continue;
      if (index.nearest(hx, hz, 30).index >= 0) continue;
      const count = 3 + Math.floor(r() * 5);
      let placed = 0;
      for (let k = 0; k < count * 3 && placed < count; k++) {
        const x = hx + (r() - 0.5) * 50, z = hz + (r() - 0.5) * 50;
        if (coverAt(x, z) !== 1) continue;
        const y = groundAt(x, z);
        const y2 = groundAt(x + 2, z);
        if (!Number.isFinite(y) || Math.abs(y2 - y) > 1.0) continue;
        const o = cow.clone(true);
        o.position.set(x, y - 0.02, z);
        const yaw = r() * Math.PI * 2;
        o.rotation.y = yaw;
        o.scale.setScalar(0.92 + r() * 0.16);
        o.traverse((c) => ((c as THREE.Mesh).castShadow = true));
        this.add(o);
        this.cows.push({ obj: o, yaw, turn: 0, t: r() * 20 });
        placed++;
      }
      if (placed) herds++;
    }
    // --- jackdaws around the summit
    const peak = osm.pois.find((p) => p.kind === 'peak');
    if (peak) {
      const y0 = groundAt(peak.x, peak.z);
      const black = patchMaterial(new THREE.MeshLambertMaterial({ color: 0x141416, side: THREE.DoubleSide }), { key: 'bird' });
      const body = new THREE.ConeGeometry(0.07, 0.36, 5).rotateX(Math.PI / 2);
      const wingGeo = new THREE.BufferGeometry();
      wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.1, 0.38, 0, -0.02, 0, 0, -0.12], 3));
      wingGeo.computeVertexNormals();
      for (let i = 0; i < 16; i++) {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(body, black));
        const wings: THREE.Object3D[] = [];
        for (const s of [1, -1]) {
          const w = new THREE.Mesh(wingGeo, black);
          w.scale.x = s;
          g.add(w);
          wings.push(w);
        }
        g.scale.setScalar(1.6);
        this.add(g);
        this.birds.push({
          obj: g, wings, a: r() * Math.PI * 2, r: 30 + r() * 60, h: (Number.isFinite(y0) ? y0 : 1280) + 15 + r() * 45,
          w: (0.25 + r() * 0.2) * (r() < 0.8 ? 1 : -1), flap: r() * 10,
        });
        g.userData.cx = peak.x - 60;
        g.userData.cz = peak.z - 40;
      }
    }
    // --- hikers: groups at the summit, viewpoints and take-offs; walkers on the footpaths around it
    if (peak) {
      const [standSrc, walkSrc] = await Promise.all([loadModel('person-stand.glb'), loadModel('person-walk.glb')]);
      const JACKETS = ['#c0392b', '#e67e22', '#2e86de', '#f1c40f', '#27ae60', '#8e44ad', '#7f8c8d', '#16a085', '#d35400', '#34495e'];
      const spots = osm.pois.filter((p) => ['peak', 'viewpoint', 'takeoff', 'cross', 'bench', 'board'].includes(p.kind) && Math.hypot(p.x - peak.x, p.z - peak.z) < 700);
      let k = 0;
      for (const sp of spots) {
        const n = sp.kind === 'peak' || sp.kind === 'viewpoint' ? 3 + Math.floor(r() * 3) : sp.kind === 'takeoff' ? 2 + Math.floor(r() * 2) : r() < 0.5 ? 1 : 0;
        for (let i = 0; i < n; i++) {
          const a = r() * Math.PI * 2, d = 2 + r() * 6;
          const x = sp.x + Math.cos(a) * d, z = sp.z + Math.sin(a) * d;
          const y = groundAt(x, z);
          if (!Number.isFinite(y) || index.nearest(x, z, 6).index >= 0) continue;
          const o = tinted(standSrc, ['person_body'], JACKETS[k++ % JACKETS.length]);
          o.position.set(x, y - 0.03, z);
          // looking out over the view, away from the summit
          o.rotation.y = Math.atan2(x - peak.x, -(z - peak.z)) * -1 + (r() - 0.5) * 0.8;
          o.scale.setScalar(0.92 + r() * 0.14);
          this.add(o);
        }
      }
      const paths = osm.roads.filter(
        (l) => ['path', 'footway', 'track'].includes(l.kind) && l.pts.length >= 4 && Math.hypot(l.pts[0] - peak.x, l.pts[1] - peak.z) < 900,
      );
      for (let i = 0; i < 18 && paths.length; i++) {
        const l = paths[Math.floor(r() * paths.length)];
        const o = tinted(walkSrc, ['person_body'], JACKETS[(k++ * 3) % JACKETS.length]);
        o.scale.setScalar(0.92 + r() * 0.14);
        this.add(o);
        this.walkers.push({
          obj: o, pts: l.pts, seg: Math.floor(r() * (l.pts.length / 2 - 1)), t: r(), dir: r() < 0.5 ? 1 : -1,
          speed: 1.0 + r() * 0.4, phase: r() * 10,
        });
      }
    }
    // --- vehicle models for traffic
    const [hatch, van, moto] = await Promise.all([loadModel('car-hatchback.glb'), loadModel('car-van.glb'), loadModel('motorbike.glb')]);
    for (let i = 0; i < 4; i++) this.cars.push(tinted(hatch, ['car-hatchback_body'], CAR_COLOURS[i * 2 % CAR_COLOURS.length]));
    for (let i = 0; i < 2; i++) this.cars.push(tinted(van, ['car-van_body'], CAR_COLOURS[(i * 3 + 4) % CAR_COLOURS.length]));
    for (let i = 0; i < 3; i++) this.cars.push(tinted(moto, ['moto_tank'], CANOPIES[i + 1]));
    for (const c of this.cars) {
      c.visible = false;
      this.add(c);
    }
  }

  /** Feral goats on the slopes and the road near the cape, sailboats on the bay. */
  private async buildMediterranean(
    route: Route,
    index: RouteIndex,
    groundAt: (x: number, z: number) => number,
    coverAt: (x: number, z: number) => number,
    r: () => number,
  ) {
    const [goat, boat] = await Promise.all([loadModel('goat.glb'), loadModel('sailboat.glb')]);
    const spot = (x: number, z: number) => {
      const y = groundAt(x, z);
      if (!Number.isFinite(y) || y < 1 || coverAt(x, z) === 3) return null;
      return y;
    };
    // groups of 2–6, more of them on the last third (the cape, where they roam the road)
    for (let g = 0; g < 14; g++) {
      const s = route.length * (g < 6 ? 0.66 + r() * 0.34 : r());
      const i = Math.min(route.n - 1, Math.floor(s / route.step));
      const h = route.heading[i];
      const onRoad = g < 3;
      const side = r() < 0.5 ? -1 : 1;
      const d = onRoad ? r() * 2.5 * side : (6 + r() * 60) * side;
      const cx = route.x[i] + Math.cos(h) * d, cz = route.z[i] + Math.sin(h) * d;
      const n = 2 + Math.floor(r() * 5);
      for (let k = 0; k < n; k++) {
        const x = cx + (r() - 0.5) * (onRoad ? 6 : 14), z = cz + (r() - 0.5) * (onRoad ? 6 : 14);
        const y = onRoad ? route.ele[i] + 0.05 : spot(x, z);
        if (y === null || (!onRoad && index.nearest(x, z, 3.5).index >= 0)) continue;
        const o = goat.clone(true);
        o.position.set(x, y - 0.02, z);
        o.rotation.y = r() * Math.PI * 2;
        o.scale.setScalar(0.85 + r() * 0.3);
        o.traverse((c) => ((c as THREE.Mesh).castShadow = true));
        this.add(o);
        this.cows.push({ obj: o, yaw: o.rotation.y, turn: 0, t: r() * 15 });
      }
    }
    // sailboats: open water 150 m+ off the coast, within sight of the road
    let placed = 0;
    for (let tries = 0; tries < 600 && placed < 14; tries++) {
      const i = Math.floor(r() * route.n);
      const a = r() * Math.PI * 2, d = 300 + r() * 3200;
      const x = route.x[i] + Math.cos(a) * d, z = route.z[i] + Math.sin(a) * d;
      const deep = [[0, 0], [150, 0], [-150, 0], [0, 150], [0, -150]].every(([ox, oz]) => {
        const y = groundAt(x + ox, z + oz);
        return !Number.isFinite(y) || y < 0.4;
      });
      if (!deep) continue;
      const o = boat.clone(true);
      const heading = r() * Math.PI * 2;
      o.position.set(x, -0.2, z);
      o.rotation.set(0, -heading, 0, 'YXZ');
      o.scale.setScalar(0.8 + r() * 0.6);
      this.add(o);
      const sp = 1.2 + r() * 2.2;
      this.boats.push({ obj: o, vx: Math.sin(heading) * sp, vz: -Math.cos(heading) * sp, heel: 0.08 + r() * 0.1 });
      placed++;
    }
    // the island's climbs are full of cyclists: descenders coasting past, climbers to catch
    for (let i = 0; i < 6; i++) {
      const c = new Rider({ kit: KITS[i], accent: '#111214', bike: i % 2 ? '#e9e9e4' : '#1a1c1f' });
      c.visible = false;
      this.add(c);
      this.cyclistPool.push(c);
    }
    // and white tour coaches squeezing through the hairpins
    const coach = tinted(await loadModel('bus.glb'), ['bus_body'], '#f2f2ef');
    coach.visible = false;
    this.add(coach);
    this.cars.push(coach);
    this.coaches.add(coach);
  }

  update(dt: number, riderS: number, riderDir: 1 | -1, riderSpeed: number, time: number) {
    for (const b of this.boats) {
      b.obj.position.x += b.vx * dt;
      b.obj.position.z += b.vz * dt;
      b.obj.position.y = -0.2 + Math.sin(time * 0.9 + b.obj.position.x * 0.01) * 0.12;
      b.obj.rotation.z = b.heel + Math.sin(time * 0.7 + b.obj.position.z * 0.01) * 0.03;
    }
    const route = this.route;
    if (!route) return;
    // gliders: circle in thermals, drift with the wind, bank into the turn
    for (const g of this.gliders) {
      g.a += g.w * dt;
      g.cx += g.drift.x * dt;
      g.cz += g.drift.y * dt;
      g.climb += dt;
      const y = g.base + Math.sin(g.climb * 0.05) * 40;
      const x = g.cx + Math.cos(g.a) * g.r;
      const z = g.cz + Math.sin(g.a) * g.r;
      g.obj.position.set(x, y, z);
      // velocity direction is the tangent; model forward is -Z
      const vx = -Math.sin(g.a) * Math.sign(g.w), vz = Math.cos(g.a) * Math.sign(g.w);
      g.obj.rotation.set(0, Math.atan2(-vx, -vz), 0, 'YXZ');
      g.obj.rotateZ(-Math.sign(g.w) * 0.32);
    }
    // cows: graze, now and then turn a little
    for (const c of this.cows) {
      c.t -= dt;
      if (c.t < 0) {
        c.turn = (this.rand() - 0.5) * 0.6;
        c.t = 6 + this.rand() * 18;
      }
      if (c.t > 4) continue;
      c.yaw += c.turn * dt * 0.25;
      c.obj.rotation.y = c.yaw;
    }
    // birds: loose circles with flapping and gliding
    for (const b of this.birds) {
      b.a += b.w * dt;
      b.flap += dt;
      const cx = b.obj.userData.cx as number, cz = b.obj.userData.cz as number;
      b.obj.position.set(cx + Math.cos(b.a) * b.r, b.h + Math.sin(b.a * 2.3) * 6, cz + Math.sin(b.a) * b.r * 0.7);
      b.obj.rotation.set(0, -b.a - (b.w > 0 ? 0 : Math.PI), Math.sign(b.w) * 0.35, 'YXZ');
      const flapping = Math.sin(b.flap * 0.4) > -0.2;
      const ang = flapping ? Math.sin(b.flap * 14) * 0.6 : 0.08;
      b.wings[0].rotation.z = ang;
      b.wings[1].rotation.z = -ang;
    }
    for (const w of this.walkers) {
      const p = w.pts;
      const nseg = p.length / 2 - 1;
      const ax = p[w.seg * 2], az = p[w.seg * 2 + 1], bx = p[w.seg * 2 + 2], bz = p[w.seg * 2 + 3];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      w.t += (w.speed * dt * w.dir) / len;
      if (w.t > 1 || w.t < 0) {
        w.seg += w.dir;
        w.t = w.dir > 0 ? 0 : 1;
        if (w.seg < 0 || w.seg >= nseg) {
          // turn around at the end of the path
          w.dir = (-w.dir) as 1 | -1;
          w.seg = Math.min(Math.max(w.seg, 0), nseg - 1);
        }
        continue;
      }
      const x = ax + (bx - ax) * w.t, z = az + (bz - az) * w.t;
      const y = this.groundAt(x, z);
      w.phase += dt * w.speed * 1.9;
      w.obj.position.set(x, (Number.isFinite(y) ? y : w.obj.position.y) + Math.abs(Math.sin(w.phase * Math.PI)) * 0.04, z);
      const hx = (bx - ax) * w.dir, hz = (bz - az) * w.dir;
      w.obj.rotation.y = Math.atan2(-hx, -hz);
    }
    this.traffic(dt, route, riderS, riderDir, riderSpeed, time);
    this.ride(dt, route, riderS, riderDir);
  }

  private ride(dt: number, route: Route, riderS: number, riderDir: 1 | -1) {
    if (!this.cyclistPool.length) return;
    const free = this.cyclistPool.filter((c) => !c.visible);
    const inRoute = (s: number) => route.loop || (s > 0 && s < route.length);
    this.nextDescender -= dt;
    this.nextClimber -= dt;
    if (this.nextDescender < 0) {
      this.nextDescender = 10 + this.rand() * 25;
      const s = riderS + 450 * riderDir;
      const obj = free.pop();
      if (obj && inRoute(s)) {
        obj.visible = true;
        this.cyclists.push({ obj, s, dir: (-riderDir) as 1 | -1, speed: 9 + this.rand() * 4, lateral: 1.4 + this.rand() * 0.6, climbing: false });
      }
    }
    if (this.nextClimber < 0) {
      this.nextClimber = 20 + this.rand() * 40;
      const s = riderS + (70 + this.rand() * 130) * riderDir;
      const obj = free.pop();
      if (obj && inRoute(s)) {
        obj.visible = true;
        this.cyclists.push({ obj, s, dir: riderDir, speed: 2.8 + this.rand() * 1.0, lateral: 2.3, climbing: true });
      }
    }
    for (let i = this.cyclists.length - 1; i >= 0; i--) {
      const c = this.cyclists[i];
      const p = pointAt(route, c.s, this.tmp);
      const g = p.grade * c.dir;
      // climbers slow on the steep ramps, descenders brake into the hairpins
      const v = c.climbing ? c.speed * Math.max(0.6, 1 - Math.max(0, g) * 0.025) : Math.min(c.speed, 4 + p.radius * 0.35);
      c.s += v * c.dir * dt;
      const rel = (c.s - riderS) * riderDir;
      if (rel < -160 || rel > 900 || !inRoute(c.s)) {
        c.obj.visible = false;
        this.cyclists.splice(i, 1);
        continue;
      }
      const h = p.heading + (c.dir < 0 ? Math.PI : 0);
      c.obj.position.set(p.x + Math.cos(h) * c.lateral, p.ele + 0.02, p.z + Math.sin(h) * c.lateral);
      c.obj.rotation.set(-Math.atan(g / 100), Math.PI - h, 0, 'YXZ');
      c.obj.update(dt, v, c.climbing ? 82 : 0, c.climbing ? 0.7 : 0.15, g);
    }
  }

  private traffic(dt: number, route: Route, riderS: number, riderDir: 1 | -1, riderSpeed: number, _time: number) {
    const free = () => this.cars.filter((c) => !c.visible);
    this.nextOncoming -= dt;
    this.nextOvertake -= dt;
    const ahead = (d: number) => riderS + d * riderDir;
    const inRoute = (s: number) => route.loop || (s > 0 && s < route.length);
    if (this.nextOncoming < 0) {
      this.nextOncoming = 20 + this.rand() * 45;
      const pool = free();
      const s = ahead(650);
      if (pool.length && inRoute(s)) {
        const obj = pool[Math.floor(this.rand() * pool.length)];
        obj.visible = true;
        const speed = this.coaches.has(obj) ? 7 + this.rand() * 2 : 11 + this.rand() * 5;
        this.vehicles.push({ obj, s, dir: (-riderDir) as 1 | -1, speed, lateral: 1.6, targetLateral: 1.6, overtaking: false });
      }
    }
    if (this.nextOvertake < 0) {
      this.nextOvertake = 50 + this.rand() * 70;
      const pool = free();
      const s = ahead(-220);
      const oncomingNear = this.vehicles.some((v) => v.dir !== riderDir && Math.abs(v.s - riderS) < 400);
      if (pool.length && inRoute(s) && !oncomingNear) {
        const obj = pool[Math.floor(this.rand() * pool.length)];
        obj.visible = true;
        this.vehicles.push({ obj, s, dir: riderDir, speed: Math.max(riderSpeed + 7, 12), lateral: 1.6, targetLateral: 1.6, overtaking: true });
      }
    }
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      v.s += v.speed * v.dir * dt;
      if (route.loop) v.s = ((v.s % route.length) + route.length) % route.length;
      const rel = (v.s - riderS) * riderDir;
      if (v.overtaking) {
        // pull out to pass, back in once well clear of the rider
        v.targetLateral = rel > -25 && rel < 20 ? -1.6 : 1.6;
      }
      v.lateral += (v.targetLateral - v.lateral) * (1 - Math.exp(-dt * 1.2));
      const gone = v.dir === riderDir ? rel > 800 : rel < -160;
      if (gone || (!route.loop && (v.s < 0 || v.s > route.length))) {
        v.obj.visible = false;
        this.vehicles.splice(i, 1);
        continue;
      }
      const p = pointAt(route, v.s, this.tmp);
      const h = p.heading + (v.dir < 0 ? Math.PI : 0);
      // keep right: offset to the right of the vehicle's own direction
      v.obj.position.set(p.x + Math.cos(h) * v.lateral, p.ele + 0.04, p.z + Math.sin(h) * v.lateral);
      v.obj.rotation.set(Math.atan((p.grade * v.dir) / 100), -h, 0, 'YXZ');
    }
  }
}
