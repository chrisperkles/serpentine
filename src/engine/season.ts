// Phenology: foliage colour for the real date. Beech colours from late September at the
// tree line down to late October in the valleys (Salzburg Prealps, ~3 days per 100 m).

import * as THREE from 'three';

export function dayOfYear(d = new Date()): number {
  const start = Date.UTC(d.getFullYear(), 0, 0);
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - start) / 86400000);
}

const GREEN = new THREE.Color(0.36, 0.55, 0.24);
const LATE = new THREE.Color(0.55, 0.62, 0.25);
const YELLOW = new THREE.Color(0.95, 0.74, 0.26);
const ORANGE = new THREE.Color(0.93, 0.5, 0.17);
const RUST = new THREE.Color(0.62, 0.33, 0.14);
const SPRING = new THREE.Color(0.5, 0.72, 0.28);
const RED = new THREE.Color(0.78, 0.24, 0.12);

/** 0 = summer green … 1 = fully coloured … >1 = leaves falling. */
export function autumnProgress(day: number, elevation: number, rand: number): number {
  const onset = 293 - ((elevation - 500) / 100) * 2.6 + (rand - 0.5) * 16;
  return (day - onset) / 24;
}

export function broadleafTint(day: number, elevation: number, rand: number, out: THREE.Color): THREE.Color {
  if (day < 150) {
    // fresh spring green after leaf-out (~early May in the valleys)
    return out.copy(SPRING).multiplyScalar(0.9 + rand * 0.2);
  }
  const p = autumnProgress(day, elevation, rand);
  if (p <= 0) out.copy(GREEN).lerp(LATE, Math.max(0, Math.min(1, (day - 230) / 60)) * 0.5);
  else if (p < 0.33) out.copy(GREEN).lerp(LATE, p / 0.33);
  else if (p < 0.66) out.copy(LATE).lerp(YELLOW, (p - 0.33) / 0.33);
  else if (p < 1) out.copy(YELLOW).lerp(ORANGE, (p - 0.66) / 0.34);
  else out.copy(ORANGE).lerp(RUST, Math.min(1, p - 1));
  // about one tree in seven is a maple, cherry or rowan: those turn red instead of gold
  const red = (rand * 7.31) % 1 < 0.15;
  if (red && p > 0.4) out.lerp(RED, Math.min(1, (p - 0.4) * 1.6));
  return out.multiplyScalar(0.86 + rand * 0.24);
}

/** Spruce stays dark green; larch (some of the conifers) turns gold in October. */
export function coniferTint(day: number, elevation: number, rand: number, larch: boolean, out: THREE.Color): THREE.Color {
  if (larch) {
    const p = autumnProgress(day + 6, elevation, rand);
    out.setRGB(0.42, 0.56, 0.28);
    if (p > 0) out.lerp(new THREE.Color(0.95, 0.72, 0.3), Math.min(1, p * 1.4));
    return out;
  }
  return out.setRGB(0.36, 0.5, 0.33).multiplyScalar(0.85 + rand * 0.3);
}

/** Mediterranean evergreens: holm oak dark olive, wild olive and mastic silvery grey-green. */
export function evergreenBroadTint(rand: number, out: THREE.Color): THREE.Color {
  const olive = (rand * 5.17) % 1 < 0.3;
  return olive
    ? out.setRGB(0.62, 0.68, 0.52).multiplyScalar(0.88 + rand * 0.2)
    : out.setRGB(0.36, 0.46, 0.27).multiplyScalar(0.82 + rand * 0.28);
}

/** Aleppo pine: light grey-green needles. */
export function pineTint(rand: number, out: THREE.Color): THREE.Color {
  return out.setRGB(0.3, 0.37, 0.25).multiplyScalar(0.85 + rand * 0.25);
}

const PARK_GREEN = new THREE.Color(0.3, 0.5, 0.2);
const PARK_YG = new THREE.Color(0.95, 0.8, 0.2);
// late-autumn targets per species: elm clear yellow to yellow-brown, plane duller tan-brown, oak russet to red-brown
const PARK_END: Record<'elm' | 'plane' | 'oak', [THREE.Color, THREE.Color]> = {
  elm: [new THREE.Color(1.5, 1.0, 0.22), new THREE.Color(1.15, 0.7, 0.16)],
  plane: [new THREE.Color(1.35, 0.88, 0.25), new THREE.Color(0.98, 0.6, 0.18)],
  oak: [new THREE.Color(1.15, 0.5, 0.14), new THREE.Color(0.9, 0.34, 0.12)],
};
const PARK_MAPLE = new THREE.Color(1.1, 0.3, 0.12);

/** New York park trees: some hold green into late autumn, a few oaks are maples and turn scarlet. */
export function parkTint(species: 'elm' | 'plane' | 'oak', day: number, elevation: number, rand: number, out: THREE.Color): THREE.Color {
  if (day < 150) return out.copy(SPRING).multiplyScalar(0.9 + rand * 0.2);
  let p = autumnProgress(day, elevation, rand);
  // about one tree in six is late and still mostly green
  if ((rand * 6.13) % 1 < 0.14) p *= 0.4;
  const [mid, end] = PARK_END[species];
  if (p <= 0) out.copy(PARK_GREEN);
  else if (p < 0.35) out.copy(PARK_GREEN).lerp(PARK_YG, p / 0.35);
  else if (p < 0.8) out.copy(PARK_YG).lerp(mid, (p - 0.35) / 0.45);
  else out.copy(mid).lerp(end, Math.min(1, (p - 0.8) / 0.5));
  if (species === 'oak' && (rand * 9.7) % 1 < 0.22 && p > 0.4) out.lerp(PARK_MAPLE, Math.min(1, (p - 0.4) * 1.5));
  return out.multiplyScalar(0.86 + rand * 0.26);
}

const SYD_GUM = [[0.5, 0.62, 0.52], [0.54, 0.6, 0.42], [0.5, 0.58, 0.46], [0.6, 0.66, 0.5], [0.45, 0.55, 0.46]];
const SYD_COASTAL = [[0.3, 0.4, 0.25], [0.5, 0.58, 0.48], [0.38, 0.5, 0.3], [0.58, 0.62, 0.42]];
const SYD_STREET = [[0.34, 0.5, 0.24], [0.42, 0.54, 0.3], [0.46, 0.56, 0.26], [0.3, 0.44, 0.28]];

/** A colour between neighbouring entries of a palette, picked by rand (0..1). */
function palette(p: number[][], rand: number, out: THREE.Color): THREE.Color {
  const f = rand * (p.length - 1), i = Math.min(p.length - 2, Math.floor(f)), t = f - i;
  return out.setRGB(p[i][0] + (p[i + 1][0] - p[i][0]) * t, p[i][1] + (p[i + 1][1] - p[i][1]) * t, p[i][2] + (p[i + 1][2] - p[i][2]) * t);
}

/**
 * Sydney in early summer, all evergreen: gums grey-green to olive and lemon (tone differs tree to tree, `rand` picks
 * the hue and `rand2` the brightness), angophoras a yellower olive, coastal banksia and tea-tree from dark to silvery,
 * Norfolk pines dark, Moreton Bay figs the darkest and glossiest, street and garden trees (camphor laurel, brush
 * box, jacaranda in leaf) a fresher mid green.
 */
export function sydneyTint(species: 'gum' | 'angophora' | 'coastal' | 'pine' | 'fig' | 'street', rand: number, out: THREE.Color, rand2 = rand): THREE.Color {
  const light = 0.95 + rand2 * 0.4;
  switch (species) {
    case 'gum': return palette(SYD_GUM, rand, out).multiplyScalar(light * 1.05);
    case 'angophora': return palette(SYD_GUM, 0.25 + rand * 0.5, out).multiplyScalar(light);
    case 'coastal': return palette(SYD_COASTAL, rand, out).multiplyScalar(light);
    case 'pine': return out.setRGB(0.3, 0.42, 0.28).multiplyScalar(0.8 + rand * 0.25);
    case 'fig': return out.setRGB(0.2, 0.36, 0.17).multiplyScalar(0.82 + rand * 0.25);
    default: return palette(SYD_STREET, rand, out).multiplyScalar(0.8 + rand2 * 0.4);
  }
}
