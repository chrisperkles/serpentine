// Where Sydney's tree species stand: Norfolk Island pines by the sea, Moreton Bay figs and palms in the parks,
// eucalypts and street trees elsewhere. The canopy model only says "broadleaf", so species come from places.

import type { OsmWorld } from '../geo/osm.ts';
import type { Route } from '../geo/route.ts';

const CELL = 24;

export interface SydneyGround {
  /** Metres from the nearest sea cell (ground at or below ~0.6 m), capped at 1000. */
  seaDist(x: number, z: number): number;
  inPark(x: number, z: number): boolean;
}

/** A coarse distance-to-sea field from the ground height, and a park mask from OSM parks, gardens and pitches. */
export function sydneyGround(route: Route, osm: OsmWorld, heightAt: (x: number, z: number) => number, margin: number): SydneyGround {
  const [bx0, bz0, bx1, bz1] = route.bounds;
  const x0 = bx0 - margin, z0 = bz0 - margin;
  const W = Math.ceil((bx1 - bx0 + 2 * margin) / CELL), H = Math.ceil((bz1 - bz0 + 2 * margin) / CELL);
  const dist = new Float32Array(W * H).fill(1000 / CELL);
  const at = (c: number, r: number) => r * W + c;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const y = heightAt(x0 + (c + 0.5) * CELL, z0 + (r + 0.5) * CELL);
      if (Number.isFinite(y) && y < 0.6) dist[at(c, r)] = 0;
    }
  }
  // two-pass chamfer distance transform (in cells)
  const D = Math.SQRT2;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      let d = dist[at(c, r)];
      if (c > 0) d = Math.min(d, dist[at(c - 1, r)] + 1);
      if (r > 0) {
        d = Math.min(d, dist[at(c, r - 1)] + 1);
        if (c > 0) d = Math.min(d, dist[at(c - 1, r - 1)] + D);
        if (c < W - 1) d = Math.min(d, dist[at(c + 1, r - 1)] + D);
      }
      dist[at(c, r)] = d;
    }
  }
  for (let r = H - 1; r >= 0; r--) {
    for (let c = W - 1; c >= 0; c--) {
      let d = dist[at(c, r)];
      if (c < W - 1) d = Math.min(d, dist[at(c + 1, r)] + 1);
      if (r < H - 1) {
        d = Math.min(d, dist[at(c, r + 1)] + 1);
        if (c < W - 1) d = Math.min(d, dist[at(c + 1, r + 1)] + D);
        if (c > 0) d = Math.min(d, dist[at(c - 1, r + 1)] + D);
      }
      dist[at(c, r)] = d;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  const path = new Path2D();
  for (const poly of osm.shore?.parks ?? []) {
    for (const ring of [poly.outer, ...poly.holes]) {
      for (let i = 0; i < ring.length; i += 2) {
        const px = (ring[i] - x0) / CELL, pz = (ring[i + 1] - z0) / CELL;
        if (i === 0) path.moveTo(px, pz);
        else path.lineTo(px, pz);
      }
      path.closePath();
    }
  }
  ctx.fill(path, 'evenodd');
  const park = ctx.getImageData(0, 0, W, H).data;
  const cellOf = (x: number, z: number) => {
    const c = Math.floor((x - x0) / CELL), r = Math.floor((z - z0) / CELL);
    return c < 0 || r < 0 || c >= W || r >= H ? -1 : at(c, r);
  };
  return {
    seaDist: (x, z) => {
      const i = cellOf(x, z);
      return i < 0 ? 1000 : dist[i] * CELL;
    },
    inPark: (x, z) => {
      const i = cellOf(x, z);
      return i >= 0 && park[i * 4] > 128;
    },
  };
}

export type SydneySpecies = 'gum' | 'angophora' | 'coastal' | 'pine' | 'fig' | 'street';

/**
 * Species for one canopy peak. Norfolk pines line the beachfronts (taller trees, within ~250 m of the sea, more
 * of them right at it); figs spread over the parks; small peaks are coastal shrubs (banksia, tea-tree); the rest
 * are tall gums, angophoras and street trees.
 */
export function sydneySpecies(seaDist: number, park: boolean, h: number, rand: number, rand2: number): SydneySpecies {
  if (h >= 8 && seaDist < 200 && rand < 0.7) return 'pine';
  if (h >= 8 && seaDist < 380 && rand < 0.3) return 'pine';
  if (park && h >= 12) return rand2 < 0.3 ? 'fig' : rand2 < 0.6 ? 'gum' : rand2 < 0.82 ? 'angophora' : 'street';
  if (h < 7) return rand2 < (seaDist < 400 ? 0.75 : 0.45) ? 'coastal' : 'street';
  if (seaDist < 300 && rand2 < 0.25) return 'coastal';
  return rand2 < 0.4 ? 'gum' : rand2 < 0.58 ? 'angophora' : 'street';
}
