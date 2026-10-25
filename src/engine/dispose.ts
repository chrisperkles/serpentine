// Freeing what a ride (and, on the island, a district) built. Everything a ride creates is disposed when it
// ends; what is cached for the whole session (GLB models, the foliage atlas, ground and wall textures, shared
// materials) is marked shared and survives. A new module-level cache marks its geometry, materials and
// textures with markShared, or the next ride's unload frees them under the riders still using them.

import * as THREE from 'three';

type Resource = THREE.BufferGeometry | THREE.Material | THREE.Texture;

const SHARED = new WeakSet<object>();

/** Keep a cached resource (or everything under a cached object) alive across rides. */
export function markShared<T extends Resource | THREE.Object3D>(r: T): T {
  if ((r as THREE.Object3D).isObject3D) {
    (r as THREE.Object3D).traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) SHARED.add(m.geometry);
      for (const mat of materials(m)) {
        SHARED.add(mat);
        for (const t of textures(mat)) SHARED.add(t);
      }
    });
  } else {
    SHARED.add(r);
    if ((r as THREE.Material).isMaterial) for (const t of textures(r as THREE.Material)) SHARED.add(t);
  }
  return r;
}

export function isShared(r: object) {
  return SHARED.has(r);
}

function materials(m: THREE.Mesh): THREE.Material[] {
  const out: THREE.Material[] = [];
  const add = (x: THREE.Material | THREE.Material[] | undefined | null) => {
    if (Array.isArray(x)) out.push(...x);
    else if (x) out.push(x);
  };
  add(m.material as THREE.Material | THREE.Material[] | undefined);
  add(m.customDepthMaterial);
  add(m.customDistanceMaterial);
  return out;
}

function textures(mat: THREE.Material): THREE.Texture[] {
  const out: THREE.Texture[] = [];
  for (const v of Object.values(mat)) if ((v as THREE.Texture | null)?.isTexture) out.push(v as THREE.Texture);
  return out;
}

/** Free the geometry, materials, their textures and instance buffers under `root`, except shared ones. */
export function disposeObject(root: THREE.Object3D) {
  const seen = new Set<object>();
  const free = (r: Resource) => {
    if (seen.has(r) || SHARED.has(r)) return;
    seen.add(r);
    // a render target's texture: the target owns the framebuffer and depth buffer as well
    const target = (r as THREE.Texture).isTexture ? ((r as THREE.Texture).userData.renderTarget as THREE.RenderTarget | undefined) : undefined;
    if (target) target.dispose();
    else r.dispose();
  };
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) free(m.geometry);
    for (const mat of materials(m)) {
      for (const t of textures(mat)) free(t);
      free(mat);
    }
    // instance buffers are freed only on the InstancedMesh's own dispose event
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
  });
}

/**
 * A group a ride fills, partly after awaits (models, OSM). Once disposed, anything a late build still adds is
 * freed at once instead of hanging on a group nobody draws.
 */
export class WorldGroup extends THREE.Group {
  disposed = false;

  add(...objects: THREE.Object3D[]): this {
    if (this.disposed) {
      objects.forEach(disposeObject);
      return this;
    }
    return super.add(...objects);
  }

  dispose() {
    this.disposed = true;
    this.removeFromParent();
    disposeObject(this);
    this.clear();
  }
}
