// Spanish road signs for Mediterranean routes, built procedurally (canvas textures on instanced
// planes): "curva peligrosa" triangles ~80 m before tight bends, R-301 "40" speed limits, the
// blue tunnel sign with a length plate before each portal, and yellow km posts (Ma-2210 style).
// Everything stands on the right of the direction of travel (+s) and faces the oncoming rider.
// Canvases use willReadFrequently (CPU canvas): GPU canvases corrupt WebGL on some machines.

import * as THREE from 'three';
import type { Route } from '../geo/route.ts';
import { patchMaterial } from './atmosphere.ts';
import type { Biome } from './biome.ts';
import { WorldGroup } from './dispose.ts';

const WARN_RADIUS = 40; // bends tighter than this get a warning sign
const WARN_DIST = 80; // m before the bend
const WARN_SPACING = 120; // never two warnings closer than this
const SPEED_EVERY = 3000;

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  return { c, ctx };
}

function texture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Slightly bright so the retroreflective faces stay legible in shade. */
const FACE = new THREE.Color(1.2, 1.2, 1.2);

function faceMaterial(map: THREE.Texture, key: string) {
  const m = new THREE.MeshLambertMaterial({ map, color: FACE, alphaTest: 0.5, side: THREE.DoubleSide });
  return patchMaterial(m, { key });
}

function roundedTriangle(ctx: CanvasRenderingContext2D, pts: [number, number][], r: number) {
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = pts[i], b = pts[(i + 1) % 3], c = pts[(i + 2) % 3];
    const s = [(a[0] - c[0]), (a[1] - c[1])];
    const e = [(b[0] - a[0]), (b[1] - a[1])];
    const ls = Math.hypot(s[0], s[1]), le = Math.hypot(e[0], e[1]);
    const p0: [number, number] = [a[0] - (s[0] / ls) * r, a[1] - (s[1] / ls) * r];
    const p1: [number, number] = [a[0] + (e[0] / le) * r, a[1] + (e[1] / le) * r];
    if (i === 0) ctx.moveTo(p0[0], p0[1]);
    else ctx.lineTo(p0[0], p0[1]);
    ctx.quadraticCurveTo(a[0], a[1], p1[0], p1[1]);
  }
  ctx.closePath();
}

/** P-13a/b "curva peligrosa": white triangle, red border, black bend arrow. */
function warningTexture(right: boolean): THREE.CanvasTexture {
  const S = 256;
  const { c, ctx } = canvas(S, S);
  ctx.clearRect(0, 0, S, S);
  const tri: [number, number][] = [[S / 2, 8], [S - 6, S - 28], [6, S - 28]];
  roundedTriangle(ctx, tri, 14);
  ctx.fillStyle = '#d4141c';
  ctx.fill();
  const inner: [number, number][] = [[S / 2, 62], [S - 52, S - 56], [52, S - 56]];
  roundedTriangle(ctx, inner, 8);
  ctx.fillStyle = '#f6f6f2';
  ctx.fill();
  ctx.save();
  if (!right) {
    ctx.translate(S, 0);
    ctx.scale(-1, 1);
  }
  // arrow: up the lane, then bending to the right
  ctx.strokeStyle = '#111';
  ctx.fillStyle = '#111';
  ctx.lineWidth = 17;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(108, 206);
  ctx.lineTo(108, 168);
  ctx.quadraticCurveTo(108, 128, 144, 114);
  ctx.stroke();
  // head pointing up-right
  const ang = Math.atan2(-14, 36) ;
  const hx = 142, hy = 115;
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(30, 0);
  ctx.lineTo(-6, -24);
  ctx.lineTo(-6, 24);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.restore();
  return texture(c);
}

/** R-301: round, red ring, black number on white. */
function speedTexture(limit: number): THREE.CanvasTexture {
  const S = 256;
  const { c, ctx } = canvas(S, S);
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = '#d4141c';
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f6f6f2';
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 3 - 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.font = 'bold 118px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(limit), S / 2, S / 2 + 6);
  return texture(c);
}

/** S-5 tunnel: blue square, white border, tunnel mouth pictogram. */
function tunnelTexture(): THREE.CanvasTexture {
  const S = 256;
  const { c, ctx } = canvas(S, S);
  ctx.clearRect(0, 0, S, S);
  const rr = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };
  rr(2, 2, S - 4, S - 4, 22);
  ctx.fillStyle = '#f6f6f2';
  ctx.fill();
  rr(14, 14, S - 28, S - 28, 14);
  ctx.fillStyle = '#0a4ea3';
  ctx.fill();
  // tunnel mouth: white arch block with a dark opening and a road going in
  ctx.fillStyle = '#f6f6f2';
  ctx.beginPath();
  ctx.moveTo(52, 200);
  ctx.lineTo(52, 118);
  ctx.arc(128, 118, 76, Math.PI, 0);
  ctx.lineTo(204, 200);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#0a4ea3';
  ctx.beginPath();
  ctx.moveTo(86, 200);
  ctx.lineTo(86, 126);
  ctx.arc(128, 126, 42, Math.PI, 0);
  ctx.lineTo(170, 200);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f6f6f2';
  ctx.beginPath();
  ctx.moveTo(116, 200);
  ctx.lineTo(124, 148);
  ctx.lineTo(132, 148);
  ctx.lineTo(140, 200);
  ctx.closePath();
  ctx.fill();
  return texture(c);
}

interface Plate {
  x: number;
  y: number;
  z: number;
  yaw: number;
  w: number;
  h: number;
  kind: 'km' | 'len';
  a: string;
  b: string;
}

/** Text plates (km faces, tunnel length) merged into one mesh with a small canvas atlas. */
function plateMesh(plates: Plate[]): THREE.Mesh | null {
  if (!plates.length) return null;
  const CW = 256, CH = 192, cols = 4;
  const rows = Math.ceil(plates.length / cols);
  const { c, ctx } = canvas(CW * cols, CH * rows);
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  plates.forEach((p, k) => {
    const cx = (k % cols) * CW, cy = Math.floor(k / cols) * CH;
    if (p.kind === 'km') {
      ctx.fillStyle = '#f2f0e6';
      ctx.fillRect(cx, cy, CW, CH);
      ctx.fillStyle = '#d99a00';
      ctx.fillRect(cx, cy, CW, 50);
      ctx.fillStyle = '#222';
      ctx.font = 'bold 26px Arial, Helvetica, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.a, cx + CW / 2, cy + 27);
      ctx.fillStyle = '#111';
      ctx.font = 'bold 80px Arial, Helvetica, sans-serif';
      ctx.fillText(p.b, cx + CW / 2, cy + 125);
    } else {
      ctx.fillStyle = '#0a4ea3';
      ctx.fillRect(cx, cy, CW, CH);
      ctx.strokeStyle = '#f6f6f2';
      ctx.lineWidth = 7;
      ctx.strokeRect(cx + 5, cy + 5, CW - 10, CH - 10);
      // the cell is squeezed 4:3 -> 2:1 on the plate, so stretch the text vertically by 1.5
      ctx.save();
      ctx.translate(cx + CW / 2, cy + CH / 2);
      ctx.scale(1, 1.5);
      ctx.fillStyle = '#f6f6f2';
      ctx.font = 'bold 60px Arial, Helvetica, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.a, 0, 2);
      ctx.restore();
    }
    const u0 = cx / (CW * cols), u1 = (cx + CW) / (CW * cols);
    const v1 = 1 - cy / (CH * rows), v0 = 1 - (cy + CH) / (CH * rows);
    const sx = Math.cos(p.yaw), sz = -Math.sin(p.yaw); // local +x in world
    const hw = p.w / 2;
    const b = pos.length / 3;
    for (const [dx, dy] of [[-hw, -p.h / 2], [hw, -p.h / 2], [hw, p.h / 2], [-hw, p.h / 2]] as const) {
      pos.push(p.x + sx * dx, p.y + dy, p.z + sz * dx);
    }
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mat = faceMaterial(texture(c), 'signplate');
  const m = new THREE.Mesh(geo, mat);
  return m;
}

export class Signs extends WorldGroup {
  constructor(
    route: Route,
    halfWidth: number,
    groundAt: (x: number, z: number) => number,
    biome: Biome,
  ) {
    super();
    if (biome.id !== 'mediterranean') return;
    const step = route.step;
    const at = (s: number) => Math.min(route.n - 1, Math.max(0, Math.round(s / step)));
    const inTunnel = (s: number, pad = 25) => route.tunnels.some(([a, b]) => s > a - pad && s < b + pad);

    // road number for the km plates ("Ma-2210"), from the route name when it carries one
    const roadNo = /\b([A-Z]{1,2}-\d{2,4})\b/.exec(`${route.name} ${route.id}`)?.[1] ?? 'Ma-2210';

    /** Foot of a sign on the right-hand verge. */
    const spot = (s: number, off: number) => {
      const i = at(s);
      const h = route.heading[i];
      const x = route.x[i] + Math.cos(h) * off;
      const z = route.z[i] + Math.sin(h) * off;
      const g = groundAt(x, z);
      const y = Number.isFinite(g) ? Math.min(g, route.ele[i]) : route.ele[i];
      // face the oncoming rider, turned a few degrees towards the road axis
      return { x, y, z, yaw: -h + 0.12 };
    };

    const poleGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 6).translate(0, 0.5, 0);
    const poleMat = patchMaterial(new THREE.MeshLambertMaterial({ color: 0x9a9da0 }), { key: 'signpole' });
    const poles: THREE.Matrix4[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    const quat = (yaw: number) => new THREE.Quaternion().setFromAxisAngle(up, yaw);
    const addPole = (p: { x: number; y: number; z: number }, height: number) =>
      poles.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y - 0.15, p.z), new THREE.Quaternion(), new THREE.Vector3(1, height + 0.15, 1)));

    const sets = new Map<string, { tex: THREE.Texture; w: number; h: number; mats: THREE.Matrix4[] }>();
    const face = (key: string, mk: () => THREE.Texture, w: number, h: number, p: { x: number; y: number; z: number; yaw: number }, centre: number) => {
      let set = sets.get(key);
      if (!set) sets.set(key, (set = { tex: mk(), w, h, mats: [] }));
      set.mats.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y + centre, p.z), quat(p.yaw), new THREE.Vector3(1, 1, 1)));
    };

    const off = halfWidth + 1.3;
    const taken: number[] = []; // s positions of placed signs, to keep them apart
    const free = (s: number, gap: number) => taken.every((t) => Math.abs(t - s) > gap);

    // (a) bend warnings
    let lastWarn = -1e9;
    for (let i = 1; i < route.n; i++) {
      if (route.radius[i] >= WARN_RADIUS) continue;
      // start of a tight run; swallow the run and any tight bends within 150 m of it
      let j = i, end = i;
      while (j < route.n && j - end < Math.round(150 / step)) {
        if (route.radius[j] < WARN_RADIUS) end = j;
        j++;
      }
      let turn = 0;
      for (let k = Math.max(1, i); k <= end; k++) {
        const d = route.heading[k] - route.heading[k - 1];
        turn += Math.atan2(Math.sin(d), Math.cos(d));
      }
      const s = i * step - WARN_DIST;
      if (s > 5 && s - lastWarn >= WARN_SPACING && !inTunnel(s) && !inTunnel(i * step, 0)) {
        const right = turn > 0;
        const p = spot(s, off);
        face(right ? 'warnR' : 'warnL', () => warningTexture(right), 0.9, 0.9, p, 1.75);
        addPole(p, 2.2);
        taken.push(s);
        lastWarn = s;
      }
      i = end + 1;
    }

    // (b) speed limit: at the start and then every ~3 km
    for (let s = 40; s < route.length - 50; s += SPEED_EVERY) {
      let ss = s;
      while (!free(ss, 30) || inTunnel(ss, 60)) ss += 40;
      const p = spot(ss, off);
      face('speed40', () => speedTexture(40), 0.6, 0.6, p, 1.7);
      addPole(p, 2.0);
      taken.push(ss);
    }

    // (c) tunnel sign and length plate
    const plates: Plate[] = [];
    for (const [a, b] of route.tunnels) {
      const s = a - 120;
      if (s < 5) continue;
      const p = spot(s, off + 0.2);
      face('tunnel', tunnelTexture, 0.7, 0.7, p, 2.2);
      addPole(p, 2.6);
      plates.push({ x: p.x + Math.sin(p.yaw) * 0.03, y: p.y + 1.55, z: p.z + Math.cos(p.yaw) * 0.03, yaw: p.yaw, w: 0.7, h: 0.35, kind: 'len', a: `${Math.round((b - a) / 10) * 10} m`, b: '' });
      taken.push(s);
    }

    // (d) km posts every km on the right
    const kmBody = new THREE.Group();
    const bodyMats: THREE.Matrix4[] = [];
    for (let km = 1; km * 1000 < route.length; km++) {
      const s = km * 1000;
      if (inTunnel(s, 10)) continue;
      const p = spot(s, halfWidth + 0.9);
      bodyMats.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y - 0.1, p.z), quat(p.yaw), new THREE.Vector3(1, 1, 1)));
      plates.push({
        x: p.x + Math.sin(p.yaw) * 0.095, y: p.y + 0.6, z: p.z + Math.cos(p.yaw) * 0.095, yaw: p.yaw, w: 0.26, h: 0.195,
        kind: 'km', a: roadNo, b: String(km),
      });
    }
    if (bodyMats.length) {
      // rounded yellow stone: box body with a half-cylinder top
      const body = new THREE.BoxGeometry(0.26, 0.8, 0.18).translate(0, 0.4, 0);
      const shape = new THREE.Shape().moveTo(-0.13, 0).absarc(0, 0, 0.13, Math.PI, 0, true).lineTo(-0.13, 0);
      const cap = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false, curveSegments: 10 }).translate(0, 0.8, -0.09);
      const parts = [body, cap].map((g) => (g.index ? g.toNonIndexed() : g));
      const merged = new THREE.BufferGeometry();
      const pp: number[] = [], nn: number[] = [];
      for (const g of parts) {
        pp.push(...(g.getAttribute('position').array as Float32Array));
        nn.push(...(g.getAttribute('normal').array as Float32Array));
      }
      merged.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3));
      merged.setAttribute('normal', new THREE.Float32BufferAttribute(nn, 3));
      const mat = patchMaterial(new THREE.MeshLambertMaterial({ color: 0xe8b21c, side: THREE.DoubleSide }), { key: 'kmpost' });
      const mesh = new THREE.InstancedMesh(merged, mat, bodyMats.length);
      bodyMats.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.castShadow = true;
      mesh.computeBoundingSphere();
      kmBody.add(mesh);
      this.add(kmBody);
    }

    // build the instanced faces and poles
    for (const [key, set] of sets) {
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(set.w, set.h), faceMaterial(set.tex, `sign-${key}`), set.mats.length);
      set.mats.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.castShadow = true;
      mesh.computeBoundingSphere();
      this.add(mesh);
    }
    if (poles.length) {
      const pm = new THREE.InstancedMesh(poleGeo, poleMat, poles.length);
      poles.forEach((m, i) => pm.setMatrixAt(i, m));
      pm.castShadow = true;
      pm.computeBoundingSphere();
      this.add(pm);
    }
    const pl = plateMesh(plates);
    if (pl) this.add(pl);
  }
}
