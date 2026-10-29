import * as THREE from 'three';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { DEM_MAX_Z, preloadDemForBox } from '../geo/elevation.ts';
import { lonLatToWorld } from '../geo/mercator.ts';
import { ESRI, sourcesFor } from '../geo/imagery.ts';
import { loadOsmElements, parseOsm, type OsmWorld, type Polygon } from '../geo/osm.ts';
import { pointAt, RouteIndex, type Route, type RoutePoint } from '../geo/route.ts';
import { applyTime, atmo, clearTunnels, TIMES } from './atmosphere.ts';
import { Buildings } from './Buildings.ts';
import { CameraRig, type CameraMode } from './CameraRig.ts';
import { Rider, type RiderStyle } from './Rider.ts';
import { Road } from './Road.ts';
import { Sky } from './Sky.ts';
import { Terrain } from './Terrain.ts';
import { TerrainShadow } from './TerrainShadow.ts';
import { clearWaterMask, setTerrainBiome, setWaterMask } from './terrainMaterial.ts';
import { Vegetation } from './Vegetation.ts';
import { GroundCover } from './GroundCover.ts';
import { Landmarks, loadRouteScene, type Placement } from './Landmarks.ts';
import { ALPINE, biomeFor, type Biome } from './biome.ts';
import { Roadside, type BarrierSpan } from './Roadside.ts';
import { Tunnels } from './Tunnel.ts';
import { Signs } from './Signs.ts';
import { Ocean } from './Ocean.ts';
import { Props } from './Props.ts';
import { Life } from './Life.ts';
import { loadBakedTrees, type BakedTrees } from '../geo/trees.ts';
import type { Segment } from '../sim/segments.ts';
import { loadMarkFonts, SegmentMarks } from './SegmentMarks.ts';

export type Quality = 'low' | 'medium' | 'high';

export interface LoadProgress {
  stage: string;
  detail?: string;
  fraction: number;
}

interface World {
  route: Route;
  index: RouteIndex;
  terrain: Terrain;
  road: Road;
  trees: Vegetation | null;
  buildings: Buildings | null;
  cover: GroundCover | null;
  rider: Rider;
  ghost: Rider;
  halfWidth: number;
  shadow: TerrainShadow;
  landmarks: Landmarks;
  roadside: Roadside | null;
  props: Props;
  life: Life;
  tunnels: Tunnels;
  ocean: Ocean | null;
  signs: Signs | null;
  marks: SegmentMarks | null;
}

const QUALITY = {
  low: { pixelRatio: 1, detail: 1.8, trees: 0.6, shadow: 1024 },
  medium: { pixelRatio: 1.25, detail: 2.4, trees: 0.85, shadow: 2048 },
  high: { pixelRatio: 1.6, detail: 3.0, trees: 1.15, shadow: 4096 },
};

const CORRIDOR = 420;

/** EXT_clip_control (Chrome 120+) lets three.js run a reversed depth buffer. */
function reversedDepthSupported() {
  // ?depth=log: the old buffer, for comparison shots after a three.js or N8AO upgrade
  if (new URLSearchParams(location.search).get('depth') === 'log') return false;
  const gl = document.createElement('canvas').getContext('webgl2');
  const ok = !!gl?.getExtension('EXT_clip_control');
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return ok;
}

const tmp: Partial<RoutePoint> = {};

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(58, 1, 0.25, 220000);
  readonly rig = new CameraRig();
  private composer: EffectComposer;
  private ao: N8AOPostPass;
  private sun = new THREE.DirectionalLight(0xffffff, 2.5);
  private hemi = new THREE.HemisphereLight(0xbcd0ff, 0x4a4030, 1.2);
  private sky = new Sky();
  private world: World | null = null;
  private clock = new THREE.Timer();
  private raf = 0;
  private resizeObs: ResizeObserver;
  private quality: Quality;
  private onFrame?: (dt: number) => void;
  private biome: Biome = ALPINE;
  private fpsAcc = 0;
  private tmpV = new THREE.Vector3();
  private fpsFrames = 0;

  // rider state, written by the ride session each frame
  riderS = 0;
  riderDir: 1 | -1 = 1;
  riderSpeed = 0;
  riderCadence = 0;
  riderEffort = 0.5;
  ghostS: number | null = null;
  ghostDir: 1 | -1 = 1;
  bots: { s: number; dir: 1 | -1; speed: number }[] = [];
  private botRiders: Rider[] = [];
  lateral = 1.7;
  /** Where the rider steers to; `lateral` eases towards it. */
  targetLateral = 1.7;
  fps = 0;
  /** Skip rendering while no 3D view is on screen. */
  paused = false;
  /** Frames per second at most. Without a cap a 120 Hz ProMotion display renders (and drains) twice as often. */
  private fpsCap = 60;
  /** Battery saver: at most 30 fps, Beautiful drops to Balanced. */
  private saving = false;
  private lastFrame = -Infinity;
  /** Scripted camera (flyover capture): replaces the rig's camera each frame. */
  cameraOverride: ((cam: THREE.PerspectiveCamera) => void) | null = null;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, quality: Quality = 'high') {
    this.canvas = canvas;
    this.quality = quality;
    const reversed = reversedDepthSupported();
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      // 0.25 m to the horizon needs more than a plain depth buffer. A logarithmic one writes depth in every
      // fragment shader, which switches off the GPU's hidden-surface removal: on Apple GPUs that halved the
      // frame rate in the forest. A reversed float depth buffer keeps the precision without that cost.
      logarithmicDepthBuffer: !reversed,
      reversedDepthBuffer: reversed,
      stencil: false,
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.12;

    this.composer = new EffectComposer(this.renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: 4,
    });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // ground contact and crevice darkening: grass in grass, trees on the forest floor, the rider on the road
    this.ao = new N8AOPostPass(this.scene, this.camera, 1, 1);
    Object.assign(this.ao.configuration, {
      aoRadius: 2.5,
      distanceFalloff: 1.2,
      intensity: 2.2,
      gammaCorrection: false,
      halfRes: true,
      depthAwareUpsampling: true,
    });
    this.ao.setQualityMode('Medium');
    // Two fixes for N8AO 2.0.1 with a reversed depth buffer. Its full-screen quads keep depth testing on and
    // fail it (black frame), and the post pass builds its half-res depth shader without REVERSEDEPTH (wrong
    // normals: every slope darkens itself). N8AO swaps materials when it reconfigures, so this runs per frame.
    const aoRender = this.ao.render.bind(this.ao);
    this.ao.render = (...args) => {
      const passes = this.ao as unknown as Record<string, { _mesh?: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> } | null>;
      for (const v of Object.values(passes)) {
        const mat = v?._mesh?.material;
        if (mat) mat.depthTest = false;
      }
      const downsample = passes.depthDownsampleQuad?._mesh?.material;
      if (this.renderer.capabilities.reversedDepthBuffer && downsample && !downsample.fragmentShader.startsWith('#define REVERSEDEPTH')) {
        downsample.fragmentShader = `#define REVERSEDEPTH\n${downsample.fragmentShader}`;
        downsample.needsUpdate = true;
      }
      aoRender(...args);
    };
    this.composer.addPass(this.ao);
    this.composer.addPass(
      new EffectPass(
        this.camera,
        new BloomEffect({ intensity: 0.55, luminanceThreshold: 0.92, luminanceSmoothing: 0.25, mipmapBlur: true }),
        new VignetteEffect({ offset: 0.32, darkness: 0.42 }),
        new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
      ),
    );

    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -32;
    sc.right = sc.top = 32;
    sc.near = 1;
    sc.far = 700;
    // three 0.186's PCF shadow lookup adds the bias without flipping it for a reversed depth buffer (its other
    // shadow types do), so the sign flips here or lit walls shadow themselves
    this.sun.shadow.bias = this.renderer.capabilities.reversedDepthBuffer ? 0.0004 : -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target, this.hemi, this.sky);
    this.setQuality(quality);
    this.setTime('golden');

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.loop();
  }

  /** Current render scale; adapts between 1 and the quality cap to hold ~60 fps. */
  private scale = 1;
  private slowFor = 0;
  private fastFor = 0;

  setFrameCap(fps: number) {
    this.fpsCap = fps;
  }

  /**
   * Unplugged. Half the frames is most of the saving; Balanced takes a little more off (GPU busy 42 % → 36 %
   * at 30 fps on the forest climb). Fast without MSAA saved only 2 points more and loses the soft tree edges.
   */
  setBatterySaver(on: boolean) {
    if (on === this.saving) return;
    this.saving = on;
    this.setQuality(this.quality);
  }

  private get maxFps() {
    return this.saving ? Math.min(30, this.fpsCap) : this.fpsCap;
  }

  /** The quality preset in use: the chosen one, Beautiful dropping to Balanced while saving battery. */
  private get preset() {
    return QUALITY[this.saving && this.quality === 'high' ? 'medium' : this.quality];
  }

  private get maxScale() {
    return Math.min(window.devicePixelRatio, this.preset.pixelRatio);
  }

  setQuality(q: Quality) {
    this.quality = q;
    const cfg = this.preset;
    this.scale = this.maxScale;
    this.renderer.setPixelRatio(this.scale);
    this.sun.shadow.mapSize.set(cfg.shadow, cfg.shadow);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.world?.terrain.setDetail(cfg.detail);
    this.resize();
  }

  private timeId = 'golden';
  private pendingFog = false;

  private pmrem: THREE.PMREMGenerator | null = null;
  private envScene: THREE.Scene | null = null;

  /** Image-based light from the current sky for PBR materials (bike, cars, rails, props). */
  private updateEnvironment() {
    if (!this.pmrem) {
      this.pmrem = new THREE.PMREMGenerator(this.renderer);
      this.envScene = new THREE.Scene();
      const sky = new Sky();
      sky.position.set(0, 0, 0);
      this.envScene.add(sky);
      // a dark ground disc so reflections below the horizon aren't sky-coloured
      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(900, 32).rotateX(-Math.PI / 2).translate(0, -40, 0),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.11, 0.13, 0.08) }),
      );
      this.envScene.add(ground);
    }
    const old = this.scene.environment;
    this.scene.environment = this.pmrem.fromScene(this.envScene!, 0.04, 0.5, 3000).texture;
    this.scene.environmentIntensity = 0.55;
    old?.dispose();
  }

  setTime(id: string) {
    this.timeId = id;
    const t = TIMES.find((x) => x.id === id) ?? TIMES[0];
    applyTime(t);
    this.updateEnvironment();
    // valley-fog inversions sit a fixed height above the valley floor of the route
    atmo.uFogTop.value = t.fogAbove !== undefined && this.world ? this.world.route.minEle + t.fogAbove : -1e4;
    this.sun.color.setRGB(...t.sun);
    this.sun.intensity = t.sunIntensity;
    this.hemi.color.setRGB(...t.ambientSky);
    this.hemi.groundColor.setRGB(...t.ambientGround);
    this.hemi.intensity = t.ambientIntensity;
  }

  setCameraMode(mode: CameraMode) {
    this.rig.mode = mode;
    this.rig.snap();
  }

  setOnFrame(cb?: (dt: number) => void) {
    this.onFrame = cb;
  }

  get stats() {
    return {
      fps: this.fps,
      tiles: this.world?.terrain.visibleTiles ?? 0,
      pending: this.world?.terrain.pendingNear ?? 0,
      trees: this.world?.trees?.count ?? 0,
      buildings: this.world?.buildings?.count ?? 0,
      calls: this.renderer.info.render.calls,
    };
  }

  async loadWorld(route: Route, style: RiderStyle, onProgress: (p: LoadProgress) => void, halfWidth = 3.1) {
    this.unloadWorld();
    const sceneDef = await loadRouteScene(route.id);
    // scenes/<id>.json "biomeTweaks" adjust the regional look for one route (Sa Calobra's grey rock)
    const biome = biomeFor(route, sceneDef?.biome as string | undefined, sceneDef?.biomeTweaks as Partial<Biome> | undefined);
    this.biome = biome;
    setTerrainBiome(biome);
    const index = new RouteIndex(route);
    const { frame } = route;

    const p0 = pointAt(route, 0);
    const terrain = new Terrain({
      frame,
      route,
      routeIndex: index,
      roadHalfWidth: halfWidth,
      // scenes/<id>.json "imagery": "esri" picks Esri where the national photo is the wrong season or cast
      sources: sceneDef?.imagery === 'esri' ? [ESRI] : sourcesFor(p0.lon, p0.lat),
      anisotropy: this.renderer.capabilities.getMaxAnisotropy(),
      detail: this.preset.detail,
      cutWidth: biome.id === 'mediterranean' ? 3.2 : 14,
    });
    const road = new Road(route, halfWidth, biome);
    const rider = new Rider(style);
    const ghost = new Rider({ ...style, ghost: true });
    ghost.visible = false;
    this.scene.add(terrain, road, rider, ghost);
    if (this.timeId) this.pendingFog = true;
    const shadow = new TerrainShadow();
    const landmarks = new Landmarks();
    this.scene.add(landmarks);
    const world: World = {
      route, index, terrain, road, trees: null, buildings: null, cover: null, rider, ghost, halfWidth, shadow, landmarks, roadside: null, props: new Props(), life: new Life(), tunnels: new Tunnels(route, halfWidth),
      // coastal routes: open sea to the horizon beyond the streamed terrain
      ocean: route.minEle < 40 ? new Ocean() : null,
      signs: null,
      marks: null,
    };
    this.scene.add(world.tunnels);
    if (world.ocean) this.scene.add(world.ocean);
    this.scene.add(world.props, world.life);
    this.world = world;
    if (this.pendingFog) this.setTime(this.timeId);
    shadow.build(frame, route.bounds).catch((e) => console.warn('terrain shadows unavailable', e));
    this.rig.snap();

    // forests + villages load in the background; the ride can start without them
    let decorStage = 'Loading forests and villages';
    const decor = (async () => {
      const chunk = Math.round(1500 / route.step);
      const jobs: Promise<void>[] = [];
      for (let a = 0; a < route.n - 1; a += chunk) {
        const b = Math.min(route.n - 1, a + chunk);
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (let i = a; i <= b; i++) {
          x0 = Math.min(x0, route.x[i]); x1 = Math.max(x1, route.x[i]);
          z0 = Math.min(z0, route.z[i]); z1 = Math.max(z1, route.z[i]);
        }
        const m = CORRIDOR + 60;
        jobs.push(
          preloadDemForBox(
            (x0 - m) / frame.k + frame.mx0, -(z1 + m) / frame.k + frame.my0,
            (x1 + m) / frame.k + frame.mx0, -(z0 - m) / frame.k + frame.my0, DEM_MAX_Z,
          ),
        );
      }
      // the rendered ground (road cuts and fills included): trees and houses must stand on it
      const heightAt = (x: number, z: number) => terrain.groundHeight(x, z);
      const [elements, baked] = await Promise.all([
        loadOsmElements(route, CORRIDOR, (done, total) => (decorStage = `OpenStreetMap ${done + 1} of ${total}`)),
        loadBakedTrees(route.id, frame),
        Promise.all(jobs),
      ]);
      if (this.world !== world) return;
      if (sceneDef && this.world === world) {
        await landmarks.build(sceneDef, frame, (x, z) => terrain.groundHeight(x, z), (x, z) => index.nearest(x, z, halfWidth + 3.8).index >= 0);
      }
      if (this.world !== world) return;
      // per-route fixes for what OSM lacks or gets wrong (scenes/<id>.json "osmTags": { "<element id>": { tag: value } })
      const fixes = (sceneDef?.osmTags ?? {}) as Record<string, Record<string, string>>;
      for (const e of elements) if (fixes[e.id]) e.tags = { ...e.tags, ...fixes[e.id] };
      const osm: OsmWorld = parseOsm(route, elements);
      if (route.category !== 'city') {
        world.roadside = new Roadside(
          route, halfWidth, (x, z) => terrain.groundHeight(x, z), biome,
          (sceneDef?.barriers as BarrierSpan[] | undefined) ?? [], osm.barriers,
          (sceneDef?.cutWalls as [number, number][] | undefined) ?? [],
        );
        this.scene.add(world.roadside);
        world.signs = new Signs(route, halfWidth, (x, z) => terrain.groundHeight(x, z), biome);
        this.scene.add(world.signs);
      }
      this.buildWaterMask(route, osm, baked);
      if (this.world !== world) return;
      this.addCover(world, osm);
      decorStage = 'Growing forests';
      await new Promise((r) => setTimeout(r, 0));
      const trees = new Vegetation(route, index, osm, {
        corridor: baked ? 550 : CORRIDOR, spacing: 6.5, roadHalfWidth: halfWidth, heightAt, baked, renderer: this.renderer, biome,
        rawHeightAt: (x, z) => terrain.heightAt(x, z),
      });
      if (this.world !== world) return;
      world.trees = trees;
      this.scene.add(trees);
      void world.props
        .build(
          route, index, osm, (x, z) => terrain.groundHeight(x, z), halfWidth, biome,
          ((sceneDef?.placements ?? []) as Placement[]).map((p) => lonLatToWorld(frame, p.lon, p.lat)),
        )
        .catch((e) => console.warn('props failed', e));
      void world.life
        .build(route, index, osm, (x, z) => terrain.groundHeight(x, z), (x, z) => this.coverAt(x, z), biome)
        .catch((e) => console.warn('life failed', e));
      decorStage = 'Building villages';
      await new Promise((r) => setTimeout(r, 0));
      const buildings = new Buildings(osm, index, heightAt, 320, biome, halfWidth + 0.4);
      if (this.world !== world) return;
      world.buildings = buildings;
      this.scene.add(buildings);
      decorStage = 'done';
    })().catch((e) => {
      decorStage = 'done';
      console.warn('OSM unavailable, riding without trees/buildings', e);
      if (this.world === world && !world.cover) this.addCover(world, null);
    });

    // stream terrain around the start before handing over
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const check = () => {
        const pending = terrain.pendingNear;
        const waited = (performance.now() - t0) / 1000;
        onProgress({
          stage: 'Streaming terrain',
          detail: decorStage === 'done' ? `${terrain.visibleTiles} tiles` : decorStage,
          fraction: Math.min(0.97, 0.1 + waited / 20),
        });
        const terrainReady = (pending === 0 && terrain.visibleTiles > 8 && waited > 1) || waited > 30;
        if (terrainReady) resolve();
        else setTimeout(check, 200);
      };
      setTimeout(check, 300);
    });
    // presets have baked OSM data and finish quickly; don't hold the start for slow Overpass servers
    await Promise.race([decor, new Promise((r) => setTimeout(r, 5000))]);
    onProgress({ stage: 'Ready', fraction: 1 });
  }

  private waterMask: { data: Uint8ClampedArray; x0: number; z0: number; res: number; w: number; h: number } | null = null;

  private addCover(world: World, osm: OsmWorld | null) {
    const mask = this.waterMask;
    const cover = new GroundCover({
      biome: this.biome,
      route: world.route,
      index: world.index,
      halfWidth: world.halfWidth,
      groundHeight: (x, z) => world.terrain.groundHeight(x, z),
      roads: osm?.roads,
      isWater: mask
        ? (x, z) => {
            const px = Math.floor((x - mask.x0) / mask.res);
            const pz = Math.floor((z - mask.z0) / mask.res);
            if (px < 0 || pz < 0 || px >= mask.w || pz >= mask.h) return false;
            return mask.data[(pz * mask.w + px) * 4] > 110;
          }
        : undefined,
      density: this.preset.trees,
      coverAt: (x, z) => this.coverAt(x, z),
      canopyAt: (x, z) => this.canopyAt(x, z),
      screeAt: (x, z) => this.screeAt(x, z),
    });
    world.cover = cover;
    this.scene.add(cover);
  }

  /** Land mask over the corridor: R water, G meadow/grass, B built-up (terrain shading + ground cover). */
  private buildWaterMask(route: Route, osm: OsmWorld, baked: BakedTrees | null) {
    this.waterMask = null;
    this.canopyMask = null;
    if (!osm.water.length && !osm.cover.length && !osm.forests.length && !baked) return;
    const [bx0, bz0, bx1, bz1] = route.bounds;
    const m = CORRIDOR + 600;
    const x0 = bx0 - m, z0 = bz0 - m;
    const w = bx1 - bx0 + 2 * m, h = bz1 - bz0 + 2 * m;
    const res = Math.max(3, Math.max(w, h) / 4096);
    const cw = Math.ceil(w / res), ch = Math.ceil(h / res);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    const pathOf = (polys: Polygon[]) => {
      const path = new Path2D();
      const ring = (r: Float32Array) => {
        for (let i = 0; i < r.length; i += 2) {
          const px = (r[i] - x0) / res, pz = (r[i + 1] - z0) / res;
          if (i === 0) path.moveTo(px, pz);
          else path.lineTo(px, pz);
        }
        path.closePath();
      };
      for (const poly of polys) {
        ring(poly.outer);
        poly.holes.forEach(ring);
      }
      return path;
    };
    // additive channels so classes can overlap without erasing each other
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#00ff00';
    ctx.fill(pathOf(osm.cover.filter((c) => c.cls === 'meadow').map((c) => c.poly)), 'evenodd');
    ctx.fillStyle = '#0000ff';
    ctx.fill(pathOf(osm.cover.filter((c) => c.cls === 'built').map((c) => c.poly)), 'evenodd');
    ctx.globalCompositeOperation = 'source-over';
    // water wins over everything
    ctx.fillStyle = '#ff0000';
    ctx.fill(pathOf(osm.water), 'evenodd');
    this.waterMask = { data: ctx.getImageData(0, 0, cw, ch).data, x0, z0, res, w: cw, h: ch };
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;

    // canopy: real tree crowns where baked, else OSM forest polygons (forest floor shading, ground cover)
    const cc = document.createElement('canvas');
    cc.width = cw;
    cc.height = ch;
    const cx = cc.getContext('2d', { willReadFrequently: true })!;
    cx.fillStyle = '#000';
    cx.fillRect(0, 0, cw, ch);
    if (baked) {
      cx.fillStyle = '#f00';
      for (let i = 0; i < baked.n; i++) {
        const r = Math.max(baked.crown[i] * 1.05, 1.5) / res;
        cx.beginPath();
        cx.arc((baked.x[i] - x0) / res, (baked.z[i] - z0) / res, r, 0, Math.PI * 2);
        cx.fill();
      }
    } else {
      cx.fillStyle = '#d00000';
      cx.fill(pathOf(osm.forests), 'evenodd');
    }
    // G: the road corridor (verge ground; the orthophoto's grey asphalt must not read as rock there)
    cx.globalCompositeOperation = 'lighter';
    cx.strokeStyle = '#00ff00';
    cx.lineJoin = cx.lineCap = 'round';
    cx.lineWidth = (2 * (this.world?.halfWidth ?? 3.1) + 9) / res;
    cx.beginPath();
    for (let i = 0; i < route.n; i += 2) {
      const px = (route.x[i] - x0) / res, pz = (route.z[i] - z0) / res;
      if (i === 0) cx.moveTo(px, pz);
      else cx.lineTo(px, pz);
    }
    cx.stroke();
    // B: OSM scree and bare rock (Ventoux's white top, the Stelvio and Glockner screes): bare ground
    cx.fillStyle = '#0000ff';
    cx.fill(pathOf(osm.cover.filter((c) => c.cls === 'rock').map((c) => c.poly)), 'evenodd');
    cx.globalCompositeOperation = 'source-over';
    this.canopyMask = { data: cx.getImageData(0, 0, cw, ch).data, x0, z0, res, w: cw, h: ch };
    const ctex = new THREE.CanvasTexture(cc);
    ctex.flipY = false;
    ctex.wrapS = ctex.wrapT = THREE.ClampToEdgeWrapping;
    ctex.minFilter = THREE.LinearFilter;
    ctex.generateMipmaps = false;
    setWaterMask(tex, x0, z0, cw * res, ch * res, ctex);
  }

  private canopyMask: { data: Uint8ClampedArray; x0: number; z0: number; res: number; w: number; h: number } | null = null;

  /** Tree canopy cover 0..1 at a world point. */
  /** OSM scree or bare rock at a world point (0..1). */
  screeAt(x: number, z: number): number {
    const m = this.canopyMask;
    if (!m) return 0;
    const px = Math.floor((x - m.x0) / m.res);
    const pz = Math.floor((z - m.z0) / m.res);
    if (px < 0 || pz < 0 || px >= m.w || pz >= m.h) return 0;
    return m.data[(pz * m.w + px) * 4 + 2] / 255;
  }

  canopyAt(x: number, z: number): number {
    const m = this.canopyMask;
    if (!m) return 0;
    const px = Math.floor((x - m.x0) / m.res);
    const pz = Math.floor((z - m.z0) / m.res);
    if (px < 0 || pz < 0 || px >= m.w || pz >= m.h) return 0;
    return m.data[(pz * m.w + px) * 4] / 255;
  }

  /** Land-cover class at a world point from the mask: 0 none, 1 meadow, 2 built, 3 water. */
  coverAt(x: number, z: number): number {
    const mask = this.waterMask;
    if (!mask) return 0;
    const px = Math.floor((x - mask.x0) / mask.res);
    const pz = Math.floor((z - mask.z0) / mask.res);
    if (px < 0 || pz < 0 || px >= mask.w || pz >= mask.h) return 0;
    const i = (pz * mask.w + px) * 4;
    if (mask.data[i] > 110) return 3;
    if (mask.data[i + 2] > 110) return 2;
    if (mask.data[i + 1] > 110) return 1;
    return 0;
  }

  unloadWorld() {
    clearWaterMask();
    this.setBots([]);
    this.bots = [];
    const w = this.world;
    if (!w) return;
    this.scene.remove(w.terrain, w.road, w.rider, w.ghost, w.landmarks);
    if (w.trees) this.scene.remove(w.trees);
    if (w.buildings) this.scene.remove(w.buildings);
    if (w.cover) {
      this.scene.remove(w.cover);
      w.cover.dispose();
    }
    w.terrain.dispose();
    w.shadow.dispose();
    const dispose = (o: THREE.Object3D) =>
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
    if (w.roadside) this.scene.remove(w.roadside);
    if (w.signs) this.scene.remove(w.signs);
    if (w.marks) {
      this.scene.remove(w.marks);
      w.marks.dispose();
    }
    this.scene.remove(w.props, w.life, w.tunnels);
    if (w.ocean) {
      this.scene.remove(w.ocean);
      w.ocean.geometry.dispose();
      w.ocean.material.dispose();
    }
    clearTunnels();
    w.props.clear();
    w.life.clear();
    [w.road, w.rider, w.ghost, w.trees, w.buildings, w.roadside, w.signs].forEach((o) => o && dispose(o));
    w.landmarks.clear();
    this.world = null;
  }

  /** Arches, road paint and countdown boards for the ride's segments; `featured` is the Strava segment the pacers race. */
  async setSegments(segments: Segment[], featured: string | null = null) {
    const w = this.world;
    if (!w) return;
    await loadMarkFonts();
    if (this.world !== w) return;
    if (w.marks) {
      this.scene.remove(w.marks);
      w.marks.dispose();
    }
    w.marks = new SegmentMarks(w.route, segments, featured, w.halfWidth, (x, z) => w.terrain.groundHeight(x, z));
    this.scene.add(w.marks);
  }

  /** Pacer riders with name tags, one per W/kg value; `labels` overrides a tag's text (e.g. "KOM 17:52"). */
  setBots(wkgs: number[], labels?: (string | undefined)[]) {
    for (const r of this.botRiders) {
      this.scene.remove(r);
      r.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
      });
    }
    this.botRiders = [];
    const kits = ['#2f7de1', '#f2c230', '#2fb36d', '#9b5de5', '#f15bb5'];
    wkgs.forEach((w, i) => {
      const rider = new Rider({ kit: kits[i % kits.length], accent: '#111214', bike: '#e9e9e4' });
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 64;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.fillStyle = 'rgba(13,27,36,0.78)';
      ctx.beginPath();
      ctx.roundRect(8, 8, 240, 48, 10);
      ctx.fill();
      ctx.fillStyle = kits[i % kits.length];
      ctx.fillRect(20, 22, 20, 20);
      ctx.fillStyle = '#eef3f4';
      ctx.font = '600 30px "Barlow Condensed", sans-serif';
      ctx.fillText(labels?.[i] ?? `Pacer ${w.toFixed(1)} W/kg`, 50, 42);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true, sizeAttenuation: false }));
      tag.scale.set(0.11, 0.0275, 1);
      tag.position.set(0, 2.15, 0);
      rider.add(tag);
      this.botRiders.push(rider);
      this.scene.add(rider);
    });
  }

  /** Move across the lane (Ride levers / arrow keys). */
  steer(delta: number) {
    const half = this.world?.halfWidth ?? 3;
    this.targetLateral = Math.min(half - 0.6, Math.max(-(half - 0.6), this.targetLateral + delta));
  }

  /** How wooded / built-up the surroundings are, for ambience. */
  environment(): { forest: number; urban: number; sea: number; biome: 'alpine' | 'mediterranean' } {
    const w = this.world;
    const biome = this.biome.id === 'mediterranean' ? 'mediterranean' : 'alpine';
    if (!w) return { forest: 0, urban: 0, sea: 0, biome };
    const p = w.rider.position;
    // open water within ~600 m: ring of 16 points at 150 m and 400 m (ground < 0.6 m or water cover)
    let wet = 0;
    for (const r of [150, 400]) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const x = p.x + Math.cos(a) * r;
        const z = p.z + Math.sin(a) * r;
        if (w.terrain.groundHeight(x, z) < 0.6 || this.coverAt(x, z) === 3) wet++;
      }
    }
    return { forest: w.trees?.densityAt(p.x, p.z) ?? 0, urban: w.buildings?.densityAt(p.x, p.z) ?? 0, sea: wet / 32, biome };
  }

  private placeRider(r: Rider, s: number, dir: 1 | -1, route: Route, lateral = this.lateral) {
    const p = pointAt(route, s, tmp);
    const h = p.heading + (dir < 0 ? Math.PI : 0);
    r.position.set(p.x + Math.cos(h) * lateral, p.ele + 0.02, p.z + Math.sin(h) * lateral);
    r.rotation.set(-Math.atan((p.grade * dir) / 100), Math.PI - h, 0, 'YXZ');
  }

  private loop = (now = performance.now()) => {
    this.raf = requestAnimationFrame(this.loop);
    // 2 ms of slack so a 60 fps cap on a 120 Hz display renders every second frame, not every third
    if (now - this.lastFrame < 1000 / this.maxFps - 2) return;
    this.lastFrame = now;
    this.clock.update();
    if (this.paused) return;
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc > 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
      this.adaptScale();
    }
    this.frame(dt);
  };

  /** Advance the world by dt seconds and render once (the RAF loop, or a capture script while paused). */
  frame(dt: number) {
    atmo.uTime.value += dt;
    this.onFrame?.(dt);
    this.lateral += (this.targetLateral - this.lateral) * (1 - Math.exp(-dt * 2.5));
    const w = this.world;
    if (w) {
      const { route } = w;
      this.placeRider(w.rider, this.riderS, this.riderDir, route);
      w.rider.update(dt, this.riderSpeed, this.riderCadence, this.riderEffort, pointAt(route, this.riderS, tmp).grade * this.riderDir);
      if (this.ghostS !== null) {
        w.ghost.visible = true;
        this.placeRider(w.ghost, this.ghostS, this.ghostDir, route);
        w.ghost.update(dt, this.riderSpeed, 85);
      } else w.ghost.visible = false;
      this.botRiders.forEach((rider, i) => {
        const b = this.bots[i];
        rider.visible = !!b;
        if (!b) return;
        this.placeRider(rider, b.s, b.dir, route, this.lateral - 1.1 - (i % 2) * 0.9);
        // pacers stand up on the steep ramps too
        const g = pointAt(route, b.s, tmp).grade * b.dir;
        rider.update(dt, b.speed, b.speed > 0.5 ? (g > 9 ? 66 : 88) : 0, g > 9 ? 1.0 : 0.6, g);
      });
      const inTunnel = w.tunnels.contains(this.riderS);
      this.rig.update(this.camera, dt, route, this.riderS, this.riderDir, this.lateral, (x, z) => (inTunnel ? NaN : w.terrain.heightAt(x, z)), inTunnel);
      this.cameraOverride?.(this.camera);
      w.terrain.update(this.camera);
      w.trees?.update(this.camera.position, this.preset.trees);
      w.cover?.update(this.riderS);
      w.life.update(dt, this.riderS, this.riderDir, this.riderSpeed, atmo.uTime.value);
      w.shadow.update(this.renderer);
      // sun shadows follow the rider, or what a scripted camera looks at
      const focus = this.cameraOverride
        ? this.camera.getWorldDirection(this.tmpV).multiplyScalar(70).add(this.camera.position)
        : w.rider.position;
      this.sun.target.position.copy(focus);
      this.sun.position.copy(focus).addScaledVector(atmo.uSunDir.value, 300);
      // shadow area grows with the camera's distance so its edge stays out of view
      const want = Math.min(140, Math.max(32, this.camera.position.distanceTo(focus) * 1.3));
      const sc = this.sun.shadow.camera;
      if (Math.abs(sc.right - want) > want * 0.15) {
        sc.left = sc.bottom = -want;
        sc.right = sc.top = want;
        sc.updateProjectionMatrix();
      }
    }
    this.sky.follow(this.camera);
    this.world?.ocean?.follow(this.camera);
    this.composer.render(dt);
  }

  private adaptScale() {
    if (!this.world) return;
    const cap = this.maxScale;
    const target = Math.min(this.maxFps, 60);
    if (this.fps < target * 0.87) {
      this.slowFor++;
      this.fastFor = 0;
    } else if (this.fps > target * 0.97) {
      this.fastFor++;
      this.slowFor = 0;
    }
    let next = this.scale;
    if (this.slowFor >= 3) next = Math.max(1, this.scale - 0.15);
    if (this.fastFor >= 10) next = Math.min(cap, this.scale + 0.1);
    if (Math.abs(next - this.scale) > 0.01) {
      this.scale = next;
      this.slowFor = this.fastFor = 0;
      this.renderer.setPixelRatio(next);
      this.resize();
    }
  }

  private resize() {
    const el = this.canvas.parentElement ?? this.canvas;
    const w = el.clientWidth || window.innerWidth;
    const h = el.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.unloadWorld();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
