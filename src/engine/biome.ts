// Regional look of a route: which plants grow, how roadsides and houses are built, how the
// ground photo is read. Chosen from the route position, overridable per route scene file.

import * as THREE from 'three';
import type { Route } from '../geo/route.ts';

export type BiomeId = 'alpine' | 'mediterranean';

export interface Biome {
  id: BiomeId;
  /** Foliage atlas (same regions in both, see treeModels.ts REGIONS). */
  atlas: string;
  /** Needle trees: Norway spruce or Aleppo pine. */
  conifer: 'spruce' | 'pine';
  /** Leaf trees keep their leaves all year (holm oak, wild olive). */
  evergreen: boolean;
  /** Grass card colours: lush, dry, pale (high up). */
  grass: [THREE.Color, THREE.Color, THREE.Color];
  /** Tall tussock grass (carritx) instead of meadow tufts. */
  tussocks: boolean;
  /** Share of low shrub cushions (rosemary, mastic) and dwarf fan palms among ground cover. */
  shrubs: number;
  /** Tint of the shrub cushions. */
  shrubTint?: THREE.Color;
  palms: number;
  /** Ferns under the canopy. */
  ferns: boolean;
  /** Rock tint for scanned boulders and how many there are. */
  rock: THREE.Color;
  rockDensity: number;
  /** Boulders on steep slopes (scree below cliffs). */
  steepRocks?: number;
  /** OSM meadows are pushed towards mown green (Alps) or left as photographed. */
  meadowPush: number;
  /** Grey photo pixels are bare limestone (karst) rather than gravel. */
  karst: number;
  /** Karst: slope (1 − normal.y) where the cliff scan takes over; lower makes the banks above cuts rock too. */
  cliffSlope?: [number, number];
  /** Karst: how much of the rock is warm ochre (Formentor's fresh cuts) rather than grey (Tramuntana). */
  rockOchre?: number;
  /** Above this height (m) the ground is bare stone with sparse plants (Mont Ventoux's white top). */
  bareAbove?: number;
  /** Delineator posts and the barrier on drop-offs. */
  posts: 'at' | 'es';
  barrier: 'wbeam' | 'stonewall';
  /** Centre line dash and gap (m). */
  dash: [number, number];
  /** false: no centre line at all (narrow mountain roads painted only at the edges). */
  centreLine?: boolean;
  /** House style (Buildings.ts): Salzburg Flachgau, Mallorca, French ski resort, Provence, Manhattan. */
  buildings: 'flachgau' | 'mallorca' | 'savoie' | 'provence' | 'manhattan' | 'vienna';
  /** A park drive closed to cars (Central Park): no traffic; people on foot and more cyclists instead. */
  carFree?: boolean;
  /** City routes: low cast-iron park lamp posts instead of street lights. */
  parkLamps?: boolean;
  /** Open ground is mown lawn: turf with hardly any tufts. */
  lawn?: boolean;
  /** Park trees: elm, plane and oak shapes with New York autumn colour (Central Park) instead of beech and spruce. */
  parkTrees?: boolean;
  // --- Vienna Ring: a city street between historicist blocks (scenes/vienna-ring.json) ---
  /** Paved city street: ground beside the road is pavement and cobbles, lawn only inside OSM parks; no tufts elsewhere, no cattle. */
  streets?: boolean;
  /** Wrought-iron Viennese street lamps at the OSM lamp positions instead of highway lamps. */
  viennaLamps?: boolean;
  /** Avenue trees (lime, plane): narrower crowns than park trees, so rows read as rows. */
  avenueTrees?: boolean;
  /** People on the pavements and in the parks; traffic stays. */
  streetLife?: boolean;
}

export const ALPINE: Biome = {
  id: 'alpine',
  atlas: '/textures/foliage.png',
  conifer: 'spruce',
  evergreen: false,
  grass: [new THREE.Color(0.98, 1.22, 0.58), new THREE.Color(1.3, 1.2, 0.72), new THREE.Color(1.1, 1.12, 0.86)],
  tussocks: false,
  shrubs: 0,
  palms: 0,
  ferns: true,
  rock: new THREE.Color(0.86, 0.9, 0.95),
  rockDensity: 1,
  meadowPush: 1,
  karst: 0,
  posts: 'at',
  barrier: 'wbeam',
  dash: [6, 12],
  buildings: 'flachgau',
};

export const MEDITERRANEAN: Biome = {
  id: 'mediterranean',
  atlas: '/textures/foliage-med.png',
  conifer: 'pine',
  evergreen: true,
  // carritx: olive green bases, straw tips in autumn
  // carritx in October: tan-gold blades over an olive base
  grass: [new THREE.Color(0.98, 0.92, 0.62), new THREE.Color(1.12, 0.98, 0.64), new THREE.Color(1.0, 0.95, 0.75)],
  tussocks: true,
  shrubs: 0.045,
  shrubTint: new THREE.Color(0.42, 0.55, 0.34),
  palms: 0.035,
  ferns: false,
  rock: new THREE.Color(0.8, 0.77, 0.7),
  rockDensity: 1.6,
  steepRocks: 0.25,
  meadowPush: 0,
  karst: 1,
  posts: 'es',
  barrier: 'stonewall',
  dash: [5, 9],
  buildings: 'mallorca',
};

const BIOMES: Record<BiomeId, Biome> = { alpine: ALPINE, mediterranean: MEDITERRANEAN };

/** Mediterranean climate south of ~43.5° N in Europe and around the basin; Alpine otherwise. */
export function biomeFor(route: Route, override?: string, tweaks?: Partial<Biome>): Biome {
  const base = pickBiome(route, override);
  return tweaks ? { ...base, ...tweaks } : base;
}

function pickBiome(route: Route, override?: string): Biome {
  if (override && override in BIOMES) return BIOMES[override as BiomeId];
  const lat = route.lat[0];
  const lon = route.lon[0];
  const med = lat > 30 && lat < 43.5 && lon > -10 && lon < 37;
  return med ? MEDITERRANEAN : ALPINE;
}
