// Hand-placed real-world landmarks per route (public/scenes/<route>.json): Blender-built
// glTF models put at their OpenStreetMap coordinates on the terrain.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { lonLatToWorld, type WorldFrame } from '../geo/mercator.ts';
import { patchMaterial } from './atmosphere.ts';
import { markShared, WorldGroup } from './dispose.ts';

export interface Placement {
  model: string; // file in /models
  lon: number;
  lat: number;
  /** Heading in degrees clockwise from north that the model's nose (glTF -Z, Blender +Y) points. */
  rot?: number;
  scale?: number;
  /** Metres above (or below) the ground. */
  lift?: number;
  shadow?: boolean;
  /** Paint colour for the model's body materials (names ending in _body, or moto_tank). */
  tint?: string;
  /** Tilt with the ground slope (parked vehicles). */
  align?: boolean;
}

export interface RouteScene {
  placements?: Placement[];
  [extra: string]: unknown;
}

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();

/** Load a model once; materials get the shared atmosphere patch. */
export function loadModel(name: string): Promise<THREE.Group> {
  let p = cache.get(name);
  if (!p) {
    p = loader.loadAsync(`/models/${name}`).then((gltf) => {
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mat) => patchMaterial(mat, { key: `model:${mat.type}` }));
      });
      // clones share the cached geometry and materials: no ride's unload may free them
      return markShared(gltf.scene);
    });
    cache.set(name, p);
  }
  return p;
}

export async function loadRouteScene(routeId: string): Promise<RouteScene | null> {
  try {
    const res = await fetch(`/scenes/${routeId}.json`);
    if (!res.ok) return null;
    return (await res.json()) as RouteScene;
  } catch {
    return null;
  }
}

export class Landmarks extends WorldGroup {
  /** onRoad: parked vehicles (align) that would stand on the asphalt are left out. */
  async build(
    scene: RouteScene, frame: WorldFrame, groundAt: (x: number, z: number) => number, onRoad?: (x: number, z: number) => boolean,
  ) {
    for (const p of scene.placements ?? []) {
      try {
        const [x, z] = lonLatToWorld(frame, p.lon, p.lat);
        if (p.align && onRoad?.(x, z)) continue;
        const src = await loadModel(p.model);
        const obj = src.clone(true);
        const y = groundAt(x, z);
        obj.position.set(x, (Number.isFinite(y) ? y : 0) + (p.lift ?? 0), z);
        obj.rotation.y = -THREE.MathUtils.degToRad(p.rot ?? 0);
        obj.scale.setScalar(p.scale ?? 1);
        if (p.align) {
          // pitch and roll from the ground 2 m ahead/behind and to the sides
          const yaw = THREE.MathUtils.degToRad(p.rot ?? 0);
          const fx = Math.sin(yaw), fz = -Math.cos(yaw);
          const g = (dx: number, dz: number) => groundAt(x + dx, z + dz);
          const pitch = Math.atan2(g(fx * 2, fz * 2) - g(-fx * 2, -fz * 2), 4);
          const roll = Math.atan2(g(-fz * 1, fx * 1) - g(fz * 1, -fx * 1), 2);
          if (Number.isFinite(pitch) && Number.isFinite(roll)) obj.rotation.set(pitch, -yaw, roll, 'YXZ');
        }
        const painted = new Map<THREE.Material, THREE.Material>();
        obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.castShadow = p.shadow !== false;
          m.receiveShadow = true;
          if (!p.tint) return;
          const paint = (mat: THREE.Material) => {
            if (!/_body$|^moto_tank$/.test(mat.name)) return mat;
            let c = painted.get(mat);
            if (!c) {
              const cl = mat.clone() as THREE.MeshStandardMaterial;
              cl.color.set(p.tint!).convertSRGBToLinear();
              // clear-coated paint: mostly dielectric with a glossy sky reflection
              cl.metalness = 0.12;
              cl.roughness = 0.32;
              c = patchMaterial(cl, { key: `paint:${mat.name}` });
              painted.set(mat, c);
            }
            return c;
          };
          m.material = Array.isArray(m.material) ? m.material.map(paint) : paint(m.material);
        });
        this.add(obj);
      } catch (e) {
        console.warn('landmark failed', p.model, e);
      }
    }
  }
}
