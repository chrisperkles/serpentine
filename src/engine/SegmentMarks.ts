// Segments you see coming, the way a race marks them: an inflatable arch with a banner at the start and the finish,
// the start line with the segment's word painted on the asphalt (stretched along the road, as road text is, so it
// reads at a flat angle), a chequered finish line, and on long climbs the flamme rouge 1 km before the top and
// boards at 500 and 200 m. KOM segments wear the climber's white with red dots, sprints green.
// Strava segments only get their lines, except the one the pacers race: a famous climb holds a dozen of them.
// Canvases use willReadFrequently (CPU canvas): GPU canvases corrupt WebGL on some machines (Signs.ts).

import * as THREE from 'three';
import type { Route } from '../geo/route.ts';
import type { Segment } from '../sim/segments.ts';
import { patchMaterial } from './atmosphere.ts';

type Look = 'kom' | 'sprint' | 'flamme';

const ARCH_TOP = 5.4; // m above the road, centre of the tube
const TUBE = 0.42; // tube radius
const CORNER = 1.3;
/** Two arches closer than this read as one: the later one is left out. */
const ARCH_GAP = 40;
/** Countdown boards and the flamme rouge only on segments at least this long. */
const COUNTDOWN_MIN = 1800;
const FONT = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif';
const RED = '#d7322b';
const GREEN = '#1f9d55';
const WHITE = '#f4f3ee';
const INK = '#0d1b24';
/** The flamme rouge's arch: navy, lighter than the banner ink, which read as black on a tube in shade. */
const NAVY = '#1f3f73';

const lookOf = (g: Segment): Look => (g.kind === 'sprint' || (g.kind === 'strava' && g.avgGrade < 2.5) ? 'sprint' : 'kom');

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  return { c, ctx };
}

function texture(c: HTMLCanvasElement, repeat?: [number, number]): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

/**
 * One metre of tube skin: KOM white with red dots, sprint green with a white band. The flamme rouge's arch is navy,
 * so its red triangle stands out (on a red arch it read as a notch).
 */
function skinCanvas(look: Look): HTMLCanvasElement {
  const S = 128;
  const { c, ctx } = canvas(S, S);
  ctx.fillStyle = look === 'kom' ? WHITE : look === 'sprint' ? GREEN : NAVY;
  ctx.fillRect(0, 0, S, S);
  if (look === 'kom') {
    ctx.fillStyle = RED;
    // offset rows, like the jersey; a dot on the tile's edge is drawn on both sides so it wraps whole
    for (const [x, y] of [[0.25, 0.25], [0.75, 0.25], [0.5, 0.75], [0, 0.75], [1, 0.75]] as const) {
      ctx.beginPath();
      ctx.arc(x * S, y * S, S * 0.11, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (look === 'sprint') {
    ctx.fillStyle = WHITE;
    ctx.fillRect(0, S * 0.44, S, S * 0.12);
  }
  // the welded seams of an inflatable, one per metre
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(0, 0, 3, S);
  return c;
}

/** The arch's centre line: legs at ±half (a little into the ground), rounded corners, the top at ARCH_TOP. */
function archCurve(half: number): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = [];
  const leg = (x: number, up: boolean) => {
    for (let k = 0; k <= 6; k++) {
      const t = up ? k / 6 : 1 - k / 6;
      pts.push(new THREE.Vector3(x, -1.2 + (ARCH_TOP - CORNER + 1.2) * t, 0));
    }
  };
  const arc = (cx: number, a0: number, a1: number) => {
    for (let k = 1; k < 8; k++) {
      const a = a0 + ((a1 - a0) * k) / 8;
      pts.push(new THREE.Vector3(cx + Math.cos(a) * CORNER, ARCH_TOP - CORNER + Math.sin(a) * CORNER, 0));
    }
  };
  leg(-half, true);
  arc(-half + CORNER, Math.PI, Math.PI / 2);
  for (let k = 0; k <= 8; k++) pts.push(new THREE.Vector3(-half + CORNER + ((2 * (half - CORNER)) * k) / 8, ARCH_TOP, 0));
  arc(half - CORNER, Math.PI / 2, 0);
  leg(half, false);
  // drop points that landed on top of each other where the pieces meet
  const out = pts.filter((p, i) => i === 0 || p.distanceTo(pts[i - 1]) > 0.05);
  return new THREE.CatmullRomCurve3(out, false, 'centripetal');
}

/** Fit `text` into `maxW` px, starting from `size` px. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, size: number, maxW: number, weight = 'italic 800'): number {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (s > 20 && ctx.measureText(text).width > maxW) {
    s -= 4;
    ctx.font = `${weight} ${s}px ${FONT}`;
  }
  return s;
}

/** The banner on the front of the arch: the look's pattern on the left, the words on navy. */
function bannerCanvas(look: Look, main: string, tag: string): HTMLCanvasElement {
  const W = 1024, H = 216;
  const { c, ctx } = canvas(W, H);
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);
  const skin = skinCanvas(look);
  const block = 170;
  for (let y = 0; y < H; y += 64) for (let x = 0; x < block; x += 64) ctx.drawImage(skin, x, y, 64, 64);
  ctx.fillStyle = look === 'sprint' ? GREEN : RED;
  ctx.fillRect(block, 0, 8, H);
  ctx.fillStyle = WHITE;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `600 50px ${FONT}`;
  const tagW = ctx.measureText(tag).width;
  ctx.globalAlpha = 0.8;
  ctx.fillText(tag, W - 36 - tagW, H / 2 + 4);
  ctx.globalAlpha = 1;
  fitFont(ctx, main, 132, W - block - 80 - tagW - 60);
  ctx.fillText(main, block + 44, H / 2 + 6);
  return c;
}

/**
 * Paint on the road from `from` to `to` (m along the route), drawn by `draw` on a canvas `h` px tall whose bottom
 * edge is the near end and whose left edge is the rider's left. Across the whole road, or between `lane` offsets
 * (m right of the centre line).
 */
function paintStrip(
  route: Route, halfWidth: number, from: number, to: number, h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  lane?: [number, number],
): THREE.Mesh | null {
  const step = route.step;
  const s0 = Math.max(0, from), s1 = Math.min(route.length, to);
  if (s1 - s0 < 0.1) return null;
  const i0 = Math.max(0, Math.floor(s0 / step));
  const i1 = Math.min(route.n - 1, Math.ceil(s1 / step));
  if (i1 <= i0) return null;
  const W = 512;
  const { c, ctx } = canvas(W, h);
  draw(ctx, W, h);
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const [l0, l1] = lane ?? [-(halfWidth - 0.02), halfWidth - 0.02];
  // samples at s0, the route points in between and s1, so the paint ends exactly where it should
  const ss = [s0, ...Array.from({ length: i1 - i0 + 1 }, (_, k) => (i0 + k) * step).filter((s) => s > s0 && s < s1), s1];
  for (const s of ss) {
    const f = Math.min(route.n - 1, Math.max(0, s / step));
    const i = Math.floor(f), j = Math.min(route.n - 1, i + 1), t = f - i;
    const x = route.x[i] + (route.x[j] - route.x[i]) * t;
    const z = route.z[i] + (route.z[j] - route.z[i]) * t;
    const y = route.ele[i] + (route.ele[j] - route.ele[i]) * t + 0.075;
    const hd = route.heading[t < 0.5 ? i : j];
    const rx = Math.cos(hd), rz = Math.sin(hd);
    const v = (s - s0) / (s1 - s0);
    const b = pos.length / 3;
    pos.push(x + rx * l0, y, z + rz * l0, x + rx * l1, y, z + rz * l1);
    uv.push(0, v, 1, v);
    if (b > 0) idx.push(b - 2, b - 1, b, b - 1, b + 1, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const tex = texture(c);
  // paint is a little glossier than asphalt and lies on it: more depth bias than the road (0.012)
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.04, roughness: 0.7, depthWrite: false });
  const mesh = new THREE.Mesh(geo, patchMaterial(mat, { key: 'segment-paint', depthBias: 0.022 }));
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  return mesh;
}

/** Worn road paint: white with a little texture so it isn't a sticker. */
function wear(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < (w * h) / 900; k++) {
    ctx.globalAlpha = 0.15 + Math.random() * 0.35;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/** The faces the canvases draw with (fontsource loads a face only once the page uses it). */
export function loadMarkFonts(): Promise<unknown> {
  return Promise.all(
    ['italic 800 64px', '700 64px', '600 32px'].map((f) => document.fonts.load(`${f} "Barlow Condensed"`)),
  ).catch(() => undefined);
}

export class SegmentMarks extends THREE.Group {
  private textures: THREE.Texture[] = [];

  constructor(
    route: Route,
    segments: Segment[],
    /** The Strava segment the pacers race: it gets arches like the built-in ones. */
    featured: string | null,
    halfWidth: number,
    groundAt: (x: number, z: number) => number,
  ) {
    super();
    const step = route.step;
    const at = (s: number) => Math.min(route.n - 1, Math.max(0, Math.round(s / step)));
    const inTunnel = (s: number, pad: number) => route.tunnels.some(([a, b]) => s > a - pad && s < b + pad);
    const legs = halfWidth + 0.55;
    const curve = archCurve(legs);
    const tubeGeo = new THREE.TubeGeometry(curve, 120, TUBE, 14, false);
    const length = curve.getLength();
    const skins = new Map<Look, THREE.Material>();
    const skin = (look: Look) => {
      let m = skins.get(look);
      if (!m) {
        const tex = texture(skinCanvas(look), [length / 1.0, (2 * Math.PI * TUBE) / 1.0]);
        this.textures.push(tex);
        // nylon: a soft sheen, never mirror-like
        m = patchMaterial(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0 }), { key: `arch-${look}` });
        skins.set(look, m);
      }
      return m;
    };
    // ballast at the feet, as on a real inflatable: deep enough that on a sloping verge the tube never shows below it
    const footGeo = new THREE.BoxGeometry(1.4, 0.75, 1.4).translate(0, -0.17, 0);
    const footMat = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x23272a, roughness: 0.9 }), { key: 'arch-foot' });

    const arches: { s: number; look: Look; main: string; tag: string }[] = [];
    const wantArch = (s: number, look: Look, main: string, tag: string) => {
      if (s < 0 || s > route.length || inTunnel(s, 30)) return;
      if (arches.some((a) => Math.abs(a.s - s) < ARCH_GAP)) return;
      arches.push({ s, look, main, tag });
    };

    // the built-in segments first: where arches compete for a spot the full climb wins over a Strava segment
    const ordered = [...segments].sort((a, b) => Number(!!a.strava) - Number(!!b.strava) || a.start - b.start);
    for (const g of ordered) {
      const look = lookOf(g);
      const big = !g.strava || g.id === featured;
      // start: the line, the word before it, an arch on the main segments
      this.addPaint(paintStrip(route, halfWidth, g.start - 0.25, g.start + 0.25, 32, (ctx, w, h) => {
        ctx.fillStyle = WHITE;
        if (big) ctx.fillRect(0, 0, w, h);
        else for (let x = 0; x < w; x += 48) ctx.fillRect(x, 0, 28, h);
        wear(ctx, w, h);
      }));
      if (big) {
        const word = look === 'kom' ? 'KOM' : 'SPRINT';
        if (g.start >= 9) {
          // in the rider's lane, as road text is: across the centre line its dashes cut through the letters.
          // The lane is ~2.3 m wide and the strip 7 m long on a square canvas, so the letters already come out
          // about three times as long as wide, as painted road text is, to read at a glancing angle
          this.addPaint(paintStrip(route, halfWidth, g.start - 8.5, g.start - 1.5, 512, (ctx, w, h) => {
            ctx.fillStyle = WHITE;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.save();
            ctx.translate(w / 2, h / 2);
            ctx.scale(1, 0.85);
            fitFont(ctx, word, 330, w * 0.86, '700');
            ctx.fillText(word, 0, 10);
            ctx.restore();
            wear(ctx, w, h);
          }, [0.3, halfWidth - 0.45]));
        }
        wantArch(g.start, look, g.name.toUpperCase(), 'START');
        wantArch(g.end, look, look === 'kom' ? 'KOM' : 'SPRINT', 'FINISH');
      }
      // finish: chequered on the main segments, a plain line on the others
      // two rows of 0.8 m squares: thinner ones vanish into a stripe from 20 m at a rider's eye height. At the end
      // of the route (a summit) the band ends on the line instead of straddling it, or the road cuts it in half.
      const fh = big ? 0.8 : 0.25;
      const fc = Math.min(g.end, route.length - fh);
      this.addPaint(paintStrip(route, halfWidth, fc - fh, fc + fh, big ? 64 : 32, (ctx, w, h) => {
        ctx.fillStyle = WHITE;
        if (big) {
          const sq = w / 8;
          for (let r = 0; r < 2; r++) for (let k = 0; k < 8; k++) if ((k + r) % 2 === 0) ctx.fillRect(k * sq, (r * h) / 2, sq, h / 2);
        } else ctx.fillRect(0, 0, w, h);
        wear(ctx, w, h);
      }));
      // the last kilometre of a long climb
      if (big && look === 'kom' && g.end - g.start >= COUNTDOWN_MIN) {
        wantArch(g.end - 1000, 'flamme', '', '');
        for (const d of [500, 200]) this.board(route, at(g.end - d), halfWidth, groundAt, `${d} m`, inTunnel(g.end - d, 15));
      }
    }

    for (const a of arches) this.arch(route, at(a.s), a, legs, groundAt, tubeGeo, skin(a.look), footGeo, footMat);
  }

  private addPaint(m: THREE.Mesh | null) {
    if (!m) return;
    this.textures.push((m.material as THREE.MeshStandardMaterial).map!);
    this.add(m);
  }

  private arch(
    route: Route, i: number, a: { look: Look; main: string; tag: string }, legs: number,
    groundAt: (x: number, z: number) => number, tubeGeo: THREE.BufferGeometry, mat: THREE.Material, footGeo: THREE.BufferGeometry, footMat: THREE.Material,
  ) {
    const g = new THREE.Group();
    // local +x is the rider's right, +z faces the oncoming rider
    g.position.set(route.x[i], route.ele[i] + 0.06, route.z[i]);
    g.rotation.y = -route.heading[i];
    const tube = new THREE.Mesh(tubeGeo, mat);
    tube.castShadow = true;
    g.add(tube);
    const h = route.heading[i];
    for (const x of [-legs, legs]) {
      // the verge falls away or rises beside the road: the ballast sits on the ground, the tube runs into it
      const gy = groundAt(route.x[i] + Math.cos(h) * x, route.z[i] + Math.sin(h) * x);
      const f = new THREE.Mesh(footGeo, footMat);
      f.position.set(x, Number.isFinite(gy) ? Math.max(-1.1, Math.min(0.6, gy - g.position.y)) : 0, 0);
      f.castShadow = true;
      g.add(f);
    }
    const span = 2 * (legs - CORNER);
    if (a.look === 'flamme') {
      // the red triangle hanging from the middle of the top
      const shape = new THREE.Shape().moveTo(-1.95, 0).lineTo(1.95, 0).lineTo(0, -2.7).closePath();
      const tri = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        patchMaterial(new THREE.MeshStandardMaterial({ color: RED, roughness: 0.7, side: THREE.DoubleSide }), { key: 'flamme' }),
      );
      tri.position.set(0, ARCH_TOP - TUBE * 0.6, 0);
      tri.castShadow = true;
      g.add(tri);
    } else {
      const tex = texture(bannerCanvas(a.look, a.main, a.tag));
      this.textures.push(tex);
      const bm = patchMaterial(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }), { key: 'arch-banner' });
      const geo = new THREE.PlaneGeometry(span, span / (1024 / 216));
      for (const side of [1, -1]) {
        const b = new THREE.Mesh(geo, bm);
        b.position.set(0, ARCH_TOP - 0.05, side * (TUBE + 0.03));
        if (side < 0) b.rotation.y = Math.PI;
        b.castShadow = side > 0;
        g.add(b);
      }
    }
    this.add(g);
  }

  /** A countdown board on the right verge, facing the rider: white, red border, black distance. */
  private board(route: Route, i: number, halfWidth: number, groundAt: (x: number, z: number) => number, text: string, skip: boolean) {
    if (skip) return;
    const h = route.heading[i];
    const off = halfWidth + 1.4;
    const x = route.x[i] + Math.cos(h) * off;
    const z = route.z[i] + Math.sin(h) * off;
    const gy = groundAt(x, z);
    const y = Number.isFinite(gy) ? Math.min(gy, route.ele[i]) : route.ele[i];
    const { c, ctx } = canvas(256, 160);
    ctx.fillStyle = RED;
    ctx.fillRect(0, 0, 256, 160);
    ctx.fillStyle = WHITE;
    ctx.fillRect(12, 12, 232, 136);
    ctx.fillStyle = '#111';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitFont(ctx, text, 96, 200, '700');
    ctx.fillText(text, 128, 84);
    const tex = texture(c);
    this.textures.push(tex);
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = -h + 0.12;
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 0.75),
      patchMaterial(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide }), { key: 'count-board' }),
    );
    face.position.y = 1.55;
    face.castShadow = true;
    g.add(face);
    const post = new THREE.CylinderGeometry(0.05, 0.05, 1.9, 8).translate(0, 0.8, -0.03);
    const pm = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x9a9da0, roughness: 0.6, metalness: 0.4 }), { key: 'count-post' });
    for (const px of [-0.5, 0.5]) {
      const p = new THREE.Mesh(post, pm);
      p.position.x = px;
      p.castShadow = true;
      g.add(p);
    }
    this.add(g);
  }

  dispose() {
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    this.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      geos.add(m.geometry);
      mats.add(m.material as THREE.Material);
    });
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    this.clear();
  }
}
