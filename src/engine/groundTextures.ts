// Procedurally painted, tiling detail textures (luminance around 1.0) for close-range ground.
// Real mipmaps + anisotropic filtering keep them crisp without the shimmer of per-pixel noise.

import * as THREE from 'three';
import { markShared } from './dispose.ts';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw on a canvas with seamless wrap by repeating each stroke at the 8 neighbour offsets. */
function wrapped(_ctx: CanvasRenderingContext2D, size: number, draw: (ox: number, oy: number) => void, x = -1, y = -1, margin = 24) {
  const xs = x < 0 ? [-size, 0, size] : x < margin ? [0, size] : x > size - margin ? [-size, 0] : [0];
  const ys = y < 0 ? [-size, 0, size] : y < margin ? [0, size] : y > size - margin ? [-size, 0] : [0];
  for (const ox of xs) for (const oy of ys) draw(ox, oy);
}

/** Smooth tiling value noise: a cells×cells random grid, bilinearly upscaled with wrap-around. */
function blurNoise(ctx: CanvasRenderingContext2D, size: number, r: () => number, cells: number, amp: number) {
  const small = document.createElement('canvas');
  small.width = small.height = cells * 3;
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  const img = sctx.createImageData(cells * 3, cells * 3);
  const vals = new Float32Array(cells * cells).map(() => 128 + (r() - 0.5) * amp);
  for (let y = 0; y < cells * 3; y++) {
    for (let x = 0; x < cells * 3; x++) {
      const v = vals[(y % cells) * cells + (x % cells)];
      const i = (y * cells * 3 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  sctx.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // draw the 3×3 tiled grid so interpolation wraps across the tile edges, keep the centre
  ctx.drawImage(small, -size, -size, size * 3, size * 3);
  ctx.restore();
}

function canvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d', { willReadFrequently: true })!] as const;
}

function toTexture(c: HTMLCanvasElement, anisotropy: number) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function grass(size: number) {
  const [c, ctx] = canvas(size);
  const r = rng(7);
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, size, size);
  blurNoise(ctx, size, r, 16, 70);
  // blades: short strokes, mostly upright-ish, light and dark
  ctx.lineCap = 'round';
  for (let i = 0; i < 9000; i++) {
    const x = r() * size;
    const y = r() * size;
    const len = 4 + r() * 12;
    const a = -Math.PI / 2 + (r() - 0.5) * 1.6;
    const v = r() < 0.5 ? 92 + r() * 26 : 150 + r() * 45;
    ctx.strokeStyle = `rgba(${v},${v},${v},${0.22 + r() * 0.3})`;
    ctx.lineWidth = 0.8 + r() * 1.4;
    wrapped(ctx, size, (ox, oy) => {
      ctx.beginPath();
      ctx.moveTo(x + ox, y + oy);
      ctx.quadraticCurveTo(x + ox + Math.cos(a) * len * 0.5 + (r() - 0.5) * 3, y + oy + Math.sin(a) * len * 0.5, x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len);
      ctx.stroke();
    }, x, y);
  }
  return c;
}

function rock(size: number) {
  const [c, ctx] = canvas(size);
  const r = rng(11);
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, size, size);
  blurNoise(ctx, size, r, 10, 90);
  blurNoise(ctx, size, r, 40, 46);
  // cracks
  for (let i = 0; i < 40; i++) {
    let x = r() * size;
    let y = r() * size;
    let a = r() * Math.PI * 2;
    const pts: [number, number][] = [[x, y]];
    const steps = 6 + Math.floor(r() * 14);
    for (let k = 0; k < steps; k++) {
      a += (r() - 0.5) * 0.9;
      const l = 4 + r() * 10;
      x += Math.cos(a) * l;
      y += Math.sin(a) * l;
      pts.push([x, y]);
    }
    ctx.strokeStyle = `rgba(40,40,40,${0.18 + r() * 0.22})`;
    ctx.lineWidth = 0.5 + r() * 1.1;
    wrapped(ctx, size, (ox, oy) => {
      ctx.beginPath();
      pts.forEach(([px, py], k) => (k ? ctx.lineTo(px + ox, py + oy) : ctx.moveTo(px + ox, py + oy)));
      ctx.stroke();
    });
  }
  // lichen speckle
  for (let i = 0; i < 2500; i++) {
    const v = 150 + r() * 80;
    ctx.fillStyle = `rgba(${v},${v},${v},0.25)`;
    const x = r() * size, y = r() * size, s = 0.6 + r() * 1.8;
    ctx.fillRect(x, y, s, s);
  }
  return c;
}

function gravel(size: number) {
  const [c, ctx] = canvas(size);
  const r = rng(23);
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, size, size);
  blurNoise(ctx, size, r, 24, 50);
  for (let i = 0; i < 6000; i++) {
    const x = r() * size, y = r() * size;
    const rad = 0.8 + r() * 2.6;
    const v = 70 + r() * 150;
    ctx.fillStyle = `rgba(${v},${v},${v},0.8)`;
    wrapped(ctx, size, (ox, oy) => {
      ctx.beginPath();
      ctx.ellipse(x + ox, y + oy, rad, rad * (0.6 + r() * 0.4), r() * 3, 0, Math.PI * 2);
      ctx.fill();
    }, x, y);
  }
  return c;
}

let cache: { grass: THREE.Texture; rock: THREE.Texture; gravel: THREE.Texture } | null = null;

export function groundTextures(anisotropy = 16) {
  if (!cache) {
    cache = {
      grass: markShared(toTexture(grass(512), anisotropy)),
      rock: markShared(toTexture(rock(512), anisotropy)),
      gravel: markShared(toTexture(gravel(512), anisotropy)),
    };
  }
  return cache;
}
