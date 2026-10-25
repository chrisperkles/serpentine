// Procedural road bike + rider. Model space: +Z forward, +Y up, origin at ground contact
// midway between the wheels. Legs use two-bone IK onto the pedals, cadence-driven.

import * as THREE from 'three';
import { patchMaterial } from './atmosphere.ts';
import { loadModel } from './Landmarks.ts';

const WHEEL_R = 0.34;
const BB = new THREE.Vector3(0, 0.27, -0.09);
const CRANK = 0.1725;
const THIGH = 0.45;
const SHIN = 0.47;
const HIP_Y = 1.0;
const HIP_Z = -0.29;

export interface RiderStyle {
  kit: string; // jersey colour
  accent: string;
  bike: string;
  ghost?: boolean;
}

function std(color: THREE.ColorRepresentation, rough = 0.6, metal = 0) {
  return patchMaterial(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }), { key: 'rider' });
}

function tube(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, 10, 1);
  const m = new THREE.Mesh(g, mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

class Limb {
  mesh: THREE.Mesh;
  readonly len: number;
  constructor(radiusTop: number, radiusBottom: number, len: number, mat: THREE.Material) {
    this.len = len;
    const g = new THREE.CapsuleGeometry((radiusTop + radiusBottom) / 2, len, 4, 10);
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.castShadow = true;
  }
  set(a: THREE.Vector3, b: THREE.Vector3) {
    this.mesh.position.copy(a).add(b).multiplyScalar(0.5);
    const d = b.clone().sub(a);
    this.mesh.scale.set(1, d.length() / this.len, 1);
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  }
}

/** Solve knee/elbow in a plane: returns joint position given root, end, lengths and bend hint. */
function twoBone(root: THREE.Vector3, end: THREE.Vector3, l1: number, l2: number, bend: THREE.Vector3): THREE.Vector3 {
  const d = end.clone().sub(root);
  const dist = Math.min(d.length(), l1 + l2 - 1e-3);
  const dir = d.normalize();
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  const side = bend.clone().sub(dir.clone().multiplyScalar(bend.dot(dir))).normalize();
  return root.clone().add(dir.multiplyScalar(a)).add(side.multiplyScalar(h));
}

export class Rider extends THREE.Group {
  private wheels: THREE.Object3D[] = [];
  private crankArm: THREE.Group;
  private legs: { thigh: Limb; shin: Limb; foot: THREE.Mesh; side: number }[] = [];
  private torso: THREE.Group;
  private arms: { upper: Limb; fore: Limb; side: number }[] = [];
  private crankAngle = 0;
  private wheelAngle = 0;
  private body = new THREE.Group();
  private bike!: THREE.Group;
  /** 0 = seated, 1 = out of the saddle (blended). */
  stand = 0;
  private standing = false;
  private wantFor = 0;
  private sitFor = 0;
  private parts: {
    bike: THREE.Object3D[];
    head: THREE.Group;
    torso: THREE.Mesh[];
    style: RiderStyle;
  } | null = null;

  constructor(style: RiderStyle) {
    super();
    const ghost = !!style.ghost;
    const mk = (c: THREE.ColorRepresentation, rough = 0.6, metal = 0) => {
      if (!ghost) return std(c, rough, metal);
      return new THREE.MeshBasicMaterial({ color: 0x7ff5ff, transparent: true, opacity: 0.28, depthWrite: false });
    };
    const frameMat = mk(style.bike, 0.35, 0.3);
    const black = mk(0x111214, 0.5);
    const kit = mk(style.kit, 0.55);
    const accent = mk(style.accent, 0.5);
    const skin = mk(0xc99a7c, 0.7);
    const helmet = mk(0xf2f2f2, 0.3);
    const tyre = mk(0x18181a, 0.9);
    const rimMat = mk(0x2a2b2e, 0.3, 0.6);

    const bike = new THREE.Group();
    // frame geometry (metres)
    const rearAxle = new THREE.Vector3(0, WHEEL_R, -0.5);
    const frontAxle = new THREE.Vector3(0, WHEEL_R, 0.5);
    const seatTop = new THREE.Vector3(0, 0.79, -0.245);
    const headTop = new THREE.Vector3(0, 0.86, 0.38);
    const headBot = new THREE.Vector3(0, 0.72, 0.42);
    for (const [a, b, r] of [
      [BB, seatTop, 0.017],
      [seatTop, headTop, 0.016],
      [BB, headBot, 0.022],
      [headBot, headTop, 0.02],
      [BB, rearAxle, 0.012],
      [seatTop, rearAxle, 0.011],
      [headBot, frontAxle, 0.013],
    ] as [THREE.Vector3, THREE.Vector3, number][]) {
      for (const side of a === BB && b === rearAxle ? [-0.05, 0.05] : a === seatTop && b === rearAxle ? [-0.05, 0.05] : [0]) {
        const t = tube(a.clone().setX(side), b.clone().setX(side), r, frameMat);
        t.castShadow = true;
        bike.add(t);
      }
    }
    // seatpost, saddle, stem, bars
    const saddle = new THREE.Vector3(0, 0.97, -0.3);
    bike.add(tube(seatTop, saddle.clone().add(new THREE.Vector3(0, -0.02, 0.01)), 0.012, black));
    const saddleMesh = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.04, 0.27), black);
    saddleMesh.position.copy(saddle);
    bike.add(saddleMesh);
    const bar = new THREE.Vector3(0, 0.95, 0.47);
    bike.add(tube(headTop, bar, 0.014, black));
    bike.add(tube(new THREE.Vector3(-0.21, 0.95, 0.47), new THREE.Vector3(0.21, 0.95, 0.47), 0.013, black));
    for (const s of [-1, 1]) {
      const hood = new THREE.Vector3(0.2 * s, 0.97, 0.53);
      bike.add(tube(new THREE.Vector3(0.21 * s, 0.95, 0.47), hood, 0.012, black));
      bike.add(tube(hood, new THREE.Vector3(0.2 * s, 0.86, 0.52), 0.012, black));
    }
    // wheels
    for (const axle of [rearAxle, frontAxle]) {
      const w = new THREE.Group();
      w.position.copy(axle);
      const t = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - 0.012, 0.014, 8, 40), tyre);
      t.rotation.y = Math.PI / 2;
      t.castShadow = true;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - 0.045, 0.022, 6, 40), rimMat);
      rim.rotation.y = Math.PI / 2;
      w.add(t, rim);
      for (let k = 0; k < 6; k++) {
        const spoke = tube(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, WHEEL_R - 0.06, 0), 0.0025, rimMat);
        spoke.position.set(0, 0, 0);
        const holder = new THREE.Group();
        holder.add(spoke);
        spoke.position.y = (WHEEL_R - 0.06) / 2;
        holder.rotation.x = (k / 6) * Math.PI * 2;
        w.add(holder);
      }
      this.wheels.push(w);
      bike.add(w);
    }
    // cranks
    this.crankArm = new THREE.Group();
    this.crankArm.position.copy(BB);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.008, 32), rimMat);
    ring.rotation.z = Math.PI / 2;
    ring.position.x = 0.06;
    this.crankArm.add(ring);
    for (const s of [-1, 1]) {
      const arm = tube(new THREE.Vector3(0.07 * s, 0, 0), new THREE.Vector3(0.07 * s, s * CRANK, 0), 0.01, black);
      this.crankArm.add(arm);
    }
    bike.add(this.crankArm);
    this.add(bike);
    this.bike = bike;
    const bikeProcedural = [...bike.children].filter((c) => !this.wheels.includes(c) && c !== this.crankArm);

    // rider
    this.torso = new THREE.Group();
    const hip = new THREE.Vector3(0, HIP_Y, HIP_Z);
    const shoulder = new THREE.Vector3(0, 1.36, 0.14);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.36, 4, 12), kit);
    torso.scale.set(1.1, 1, 0.75);
    torso.position.copy(hip).add(shoulder).multiplyScalar(0.5);
    torso.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), shoulder.clone().sub(hip).normalize());
    torso.castShadow = true;
    const stripe = new THREE.Mesh(new THREE.CapsuleGeometry(0.152, 0.08, 4, 12), accent);
    stripe.scale.set(1.11, 1, 0.76);
    stripe.position.copy(hip).lerp(shoulder, 0.62);
    stripe.quaternion.copy(torso.quaternion);
    const shorts = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), black);
    shorts.scale.set(1.15, 0.9, 1.1);
    shorts.position.copy(hip);
    const head = new THREE.Group();
    head.position.set(0, 1.5, 0.27);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 12), skin);
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.125, 16, 12, 0, Math.PI * 2, 0, Math.PI / 1.9), helmet);
    lid.scale.set(1, 0.85, 1.3);
    lid.position.set(0, 0.03, -0.02);
    lid.rotation.x = -0.35;
    const glasses = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.035, 0.05), black);
    glasses.position.set(0, 0.0, 0.085);
    head.add(face, lid, glasses);
    face.castShadow = lid.castShadow = true;
    this.torso.add(torso, stripe, shorts, head);
    this.body.add(this.torso);

    for (const s of [-1, 1]) {
      const thigh = new Limb(0.075, 0.06, THIGH, s < 0 ? black : black);
      const shin = new Limb(0.055, 0.045, SHIN, skin);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.24), black);
      foot.castShadow = true;
      this.body.add(thigh.mesh, shin.mesh, foot);
      this.legs.push({ thigh, shin, foot, side: s });
      const upper = new Limb(0.05, 0.045, 0.29, kit);
      const fore = new Limb(0.042, 0.036, 0.29, skin);
      this.body.add(upper.mesh, fore.mesh);
      this.arms.push({ upper, fore, side: s });
    }
    this.add(this.body);
    if (ghost) this.traverse((o) => ((o as THREE.Mesh).castShadow = false));
    this.update(0, 0, 0);
    this.parts = { bike: bikeProcedural, head, torso: [torso, stripe, shorts], style };
    void this.upgrade(bike, ghost).catch((e) => console.warn('rider model unavailable', e));
  }

  /** Swap the primitive shapes for the Blender-built bike and body parts (public/models/rider.glb). */
  private async upgrade(bike: THREE.Group, ghost: boolean) {
    const src = await loadModel('rider.glb');
    const p = this.parts;
    if (!p) return;
    const ghostMat = ghost ? new THREE.MeshBasicMaterial({ color: 0x7ff5ff, transparent: true, opacity: 0.28, depthWrite: false }) : null;
    const tints: Record<string, string> = { jersey: p.style.kit, accent: p.style.accent, bike_frame: p.style.bike };
    const matCache = new Map<THREE.Material, THREE.Material>();
    const mat = (m: THREE.Material): THREE.Material => {
      if (ghostMat) return ghostMat;
      let out = matCache.get(m);
      if (!out) {
        out = m;
        const tint = tints[m.name];
        if (tint) {
          const c = m.clone() as THREE.MeshStandardMaterial;
          c.color.set(tint).convertSRGBToLinear();
          patchMaterial(c, { key: `rider:${m.name}` });
          out = c;
        }
        matCache.set(m, out);
      }
      return out;
    };
    const part = (name: string): THREE.Mesh => {
      const o = src.getObjectByName(name) as THREE.Mesh | undefined;
      if (!o) throw new Error(`rider.glb lacks ${name}`);
      // glTF splits multi-material meshes into a group of primitives
      return o;
    };
    const cloneOf = (name: string): THREE.Object3D => {
      const o = part(name).clone(true);
      o.position.set(0, 0, 0);
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (!m.isMesh) return;
        m.material = Array.isArray(m.material) ? m.material.map(mat) : mat(m.material);
        m.castShadow = !ghost;
        m.receiveShadow = !ghost;
      });
      return o;
    };
    // the primitives the model replaces (materials stay: the remaining parts still use them)
    const drop = (o: THREE.Object3D) => o.traverse((c) => (c as THREE.Mesh).geometry?.dispose());
    for (const o of p.bike) {
      bike.remove(o);
      drop(o);
    }
    bike.add(cloneOf('bike'));
    for (const w of this.wheels) {
      w.children.forEach(drop);
      w.clear();
      w.add(cloneOf('wheel'));
    }
    this.crankArm.children.forEach(drop);
    this.crankArm.clear();
    this.crankArm.add(cloneOf('crank'));
    // torso: oriented hip → shoulder like the capsule it replaces
    const capsule = p.torso[0];
    const t = cloneOf('torso');
    t.position.copy(capsule.position);
    t.quaternion.copy(capsule.quaternion);
    for (const o of p.torso) {
      this.torso.remove(o);
      drop(o);
    }
    this.torso.add(t);
    p.head.children.forEach(drop);
    p.head.clear();
    const hd = cloneOf('head');
    hd.rotation.x = 0.12;
    p.head.add(hd);
    // limbs keep their IK; only the shape changes. Each limb becomes a group holding the model.
    // parts are authored for the +X side (lateral = +X); the -X limb mirrors them
    const swapLimb = (limb: Limb, name: string, side: number) => {
      const g = cloneOf(name);
      const holder = limb.mesh;
      holder.geometry.dispose();
      holder.geometry = new THREE.BufferGeometry();
      holder.add(g);
      g.scale.set(side, 1, 1);
    };
    for (const l of this.legs) {
      swapLimb(l.thigh, 'thigh', l.side);
      swapLimb(l.shin, 'shin', l.side);
      l.foot.geometry.dispose();
      l.foot.geometry = new THREE.BufferGeometry();
      const shoe = cloneOf('shoe');
      shoe.scale.x = l.side;
      l.foot.add(shoe);
    }
    for (const a of this.arms) {
      swapLimb(a.upper, 'upperarm', a.side);
      swapLimb(a.fore, 'forearm', a.side);
    }
  }

  /**
   * Out of the saddle like a real rider: grinding a low cadence at high effort or on a steep
   * ramp, and sprinting. Hysteresis so the rider doesn't bob up and down at the threshold.
   */
  private updateStanding(dt: number, speed: number, cadence: number, effort: number, grade: number) {
    const pedalling = cadence > 20;
    const grind = pedalling && cadence < 68 && effort > 0.85;
    const ramp = pedalling && grade > 8.5 && cadence < 76 && effort > 0.7;
    const sprint = pedalling && effort > 1.6 && cadence > 85 && speed > 8;
    const want = grind || ramp || sprint;
    if (want) {
      this.wantFor += dt;
      this.sitFor = 0;
    } else {
      this.sitFor += dt;
      this.wantFor = 0;
    }
    if (!this.standing && this.wantFor > 1.0) this.standing = true;
    if (this.standing && (this.sitFor > 1.8 || !pedalling)) this.standing = false;
    const target = this.standing ? 1 : 0;
    this.stand += (target - this.stand) * (1 - Math.exp(-dt / 0.35));
  }

  /** Advance animation. speed m/s, cadence rpm, dt s, effort = power / FTP, grade %. */
  update(dt: number, speed: number, cadence: number, effort = 0.5, grade = 0) {
    this.wheelAngle += (speed * dt) / WHEEL_R;
    for (const w of this.wheels) w.rotation.x = this.wheelAngle;
    const rpm = cadence > 5 ? cadence : 0;
    this.crankAngle += (rpm / 60) * Math.PI * 2 * dt;
    this.crankArm.rotation.x = this.crankAngle;
    this.updateStanding(dt, speed, rpm, effort, grade);
    const st = this.stand;
    const push = Math.sin(this.crankAngle); // +1: the +x leg is mid-downstroke

    // the bike rocks under a standing rider, away from the pushing leg
    this.bike.rotation.z = st * 0.11 * push * Math.min(1, rpm / 40);
    this.bike.updateMatrix();
    const bikeM = this.bike.matrix;

    // pelvis: seated on the saddle → up and forward over the bottom bracket when standing;
    // it drops onto each downstroke and swings towards the pushing leg
    const hip = new THREE.Vector3(
      st * 0.035 * push,
      THREE.MathUtils.lerp(HIP_Y, 1.065, st) - st * 0.022 * Math.abs(push),
      THREE.MathUtils.lerp(HIP_Z, -0.11, st),
    );
    const shoulder = new THREE.Vector3(st * 0.02 * push, THREE.MathUtils.lerp(1.36, 1.34, st), THREE.MathUtils.lerp(0.14, 0.29, st));
    // torso group: authored for the seated pose; rotate about the seated hip into the current pose
    const hip0 = new THREE.Vector3(0, HIP_Y, HIP_Z);
    const sh0 = new THREE.Vector3(0, 1.36, 0.14);
    const q = new THREE.Quaternion().setFromUnitVectors(sh0.clone().sub(hip0).normalize(), shoulder.clone().sub(hip).normalize());
    const seatedRock = rpm > 0 ? Math.sin(this.crankAngle) * 0.012 * (0.6 + effort) : 0;
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), seatedRock * (1 - st) - st * 0.05 * push));
    this.torso.quaternion.copy(q);
    this.torso.position.copy(hip).sub(hip0.clone().applyQuaternion(q));

    for (const leg of this.legs) {
      const a = this.crankAngle + (leg.side > 0 ? 0 : Math.PI);
      const pedalB = new THREE.Vector3(0.12 * leg.side, BB.y + Math.cos(a) * CRANK, BB.z + Math.sin(a) * CRANK);
      const pedal = pedalB.clone().applyMatrix4(bikeM);
      const legHip = new THREE.Vector3(0.1 * leg.side, -0.03, 0.02).applyQuaternion(q).add(hip);
      const ankle = pedal.clone().add(new THREE.Vector3(0, 0.07, -0.03));
      const knee = twoBone(legHip, ankle, THIGH, SHIN, new THREE.Vector3(0.04 * leg.side, 0.3, 1));
      leg.thigh.set(legHip, knee);
      leg.shin.set(knee, ankle);
      leg.foot.position.copy(pedal).add(new THREE.Vector3(0, 0.035, 0.02));
      leg.foot.rotation.set(-0.15 + Math.sin(a) * 0.2 - st * 0.12, 0, this.bike.rotation.z);
    }
    for (const arm of this.arms) {
      const sh = new THREE.Vector3(0.19 * arm.side, 1.34, 0.12).sub(hip0).applyQuaternion(q).add(hip);
      // seated: tops/hoods; standing: hands forward on the hoods, gripping the rocking bike
      const handB = new THREE.Vector3(0.2 * arm.side, THREE.MathUtils.lerp(0.99, 0.97, st), THREE.MathUtils.lerp(0.53, 0.545, st));
      const hand = handB.applyMatrix4(bikeM);
      const elbow = twoBone(sh, hand, 0.29, 0.29, new THREE.Vector3(0.6 * arm.side, -0.3 - st * 0.2, -0.6));
      arm.upper.set(sh, elbow);
      arm.fore.set(elbow, hand);
    }
  }
}
