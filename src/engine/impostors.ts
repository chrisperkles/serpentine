// Billboard impostors for distant trees: each near-LOD tree model is rendered once at start-up
// (albedo × baked AO from the foliage atlas) from the side and from above into one atlas.
// Far trees are two crossed side cards plus a horizontal top card, so forests keep their
// texture and silhouette from the road and read as closed canopy from a drone.

import * as THREE from 'three';

const CELL = 512;
// side frame in model units (trees are height 1, crown radius ≤ ~0.4)
const HALF_W = 0.46;
const Y0 = -0.03;
const Y1 = 1.05;
const TOP_Y = 0.62;

/** Crossed cards + top card for impostor cell k of n. */
export function impostorGeometry(k: number, n: number): THREE.BufferGeometry {
  const u0 = k / n, u1 = (k + 1) / n;
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const quad = (p: number[][], t: number[][]) => {
    const b = pos.length / 3;
    for (let i = 0; i < 4; i++) {
      pos.push(...p[i]);
      uv.push(...t[i]);
      // up-facing normals: uniform, soft lighting from either side of the card
      nor.push(0, 1, 0);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const side = [[u0, 0], [u1, 0], [u1, 0.5], [u0, 0.5]];
  quad([[-HALF_W, Y0, 0], [HALF_W, Y0, 0], [HALF_W, Y1, 0], [-HALF_W, Y1, 0]], side);
  quad([[0, Y0, HALF_W], [0, Y0, -HALF_W], [0, Y1, -HALF_W], [0, Y1, HALF_W]], side);
  quad([[-HALF_W, TOP_Y, HALF_W], [HALF_W, TOP_Y, HALF_W], [HALF_W, TOP_Y, -HALF_W], [-HALF_W, TOP_Y, -HALF_W]], [[u0, 0.5], [u1, 0.5], [u1, 1], [u0, 1]]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Render the near models into an impostor atlas (n cells wide, side row below, top row above). */
export function renderImpostorAtlas(renderer: THREE.WebGLRenderer, models: THREE.BufferGeometry[], atlas: THREE.Texture): THREE.Texture {
  const n = models.length;
  const rt = new THREE.WebGLRenderTarget(CELL * n, CELL * 2, {
    type: THREE.UnsignedByteType,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    depthBuffer: true,
  });
  rt.texture.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide });
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(models[0], mat);
  scene.add(mesh);
  const sideCam = new THREE.OrthographicCamera(-HALF_W, HALF_W, Y1, Y0, -5, 5);
  sideCam.position.set(0, 0, 2);
  sideCam.lookAt(0, 0, 0);
  sideCam.position.set(0, 0, 2);
  sideCam.updateMatrixWorld();
  const topCam = new THREE.OrthographicCamera(-HALF_W, HALF_W, HALF_W, -HALF_W, -5, 5);
  topCam.position.set(0, 3, 0);
  topCam.up.set(0, 0, -1);
  topCam.lookAt(0, 0, 0);
  topCam.updateMatrixWorld();

  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevAuto = renderer.autoClear;
  const prevShadow = renderer.shadowMap.enabled;
  renderer.shadowMap.enabled = false;
  renderer.autoClear = false;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, true);
  models.forEach((geo, k) => {
    mesh.geometry = geo;
    for (const [cam, row] of [[sideCam, 0], [topCam, 1]] as const) {
      rt.viewport.set(k * CELL, row * CELL, CELL, CELL);
      rt.scissor.set(k * CELL, row * CELL, CELL, CELL);
      rt.scissorTest = true;
      renderer.setRenderTarget(rt);
      renderer.clear(true, true, true);
      renderer.render(scene, cam);
    }
  });
  rt.scissorTest = false;
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.autoClear = prevAuto;
  renderer.shadowMap.enabled = prevShadow;
  mat.dispose();
  // disposeObject frees the whole target (its depth buffer too) through the texture
  rt.texture.userData.renderTarget = rt;
  return rt.texture;
}
