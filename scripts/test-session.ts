// The ride clock and the ride session with a fake trainer: same ride whatever the frame rate.
import assert from 'node:assert/strict';
import type { DeviceHub } from '../src/devices/types.ts';
import { buildRoute } from '../src/geo/route.ts';
import { SimClock } from '../src/sim/clock.ts';
import { RideSession, type RiderSettings } from '../src/sim/session.ts';

let n = 0;
async function t(name: string, fn: () => void | Promise<void>) {
  await fn();
  n++;
  console.log(`ok - ${name}`);
}

function fakeHub(power: number) {
  const modes: unknown[] = [];
  const hub = {
    metrics: { power, cadence: 88 },
    setMode: (m: unknown) => modes.push(m),
    setGearRatio: () => undefined,
    setRiderWeights: () => undefined,
  } as unknown as DeviceHub;
  return { hub, modes };
}

const settings: RiderSettings = {
  ftp: 250, weight: 75, bikeWeight: 8, difficulty: 0.5, drivetrain: 'zwift',
  customDrivetrain: { chainrings: [50, 34], cassette: [11, 12, 13, 14, 15, 17, 19, 21, 24, 28], wheelCircumference: 2.105 },
};

// 5 km due north, climbing 4 %; no DEM in node, so the coordinates' heights are the profile
const coords: number[][] = [];
for (let i = 0; i <= 50; i++) coords.push([13.1, 47.8 + (i * 100) / 111_320, 500 + i * 4]);
const route = await buildRoute({ id: 'test', name: 'Test climb', source: 'gpx', coords });

/** Ride `seconds` of wall-clock time with frames every `frame` seconds; returns the distance ridden. */
function rideAt(frame: number, seconds: number) {
  const { hub } = fakeHub(250);
  const session = new RideSession({ route, workout: null, settings: { ...settings }, ghost: null, erg: false, holdWatts: null, gears: false }, hub);
  session.begin();
  const clock = new SimClock((dt) => session.tick(dt));
  let now = 1000;
  clock.sync(now);
  for (let t = 0; t < seconds; t += frame) {
    now += frame * 1000;
    clock.sync(now);
  }
  return session.state;
}

await t('the clock makes up a long gap in short steps', () => {
  const steps: number[] = [];
  const c = new SimClock((dt) => steps.push(dt));
  c.sync(0);
  c.sync(1000);
  assert.equal(steps.length, 20);
  assert.ok(Math.abs(steps.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(steps.every((dt) => dt <= 0.05 + 1e-12));
});

await t('a Mac that slept for an hour adds at most 65 s', () => {
  let total = 0;
  const c = new SimClock((dt) => (total += dt));
  c.sync(0);
  c.sync(3_600_000);
  assert.ok(Math.abs(total - 65) < 1e-9);
});

await t('explicit steps restart the wall clock', () => {
  let total = 0;
  const c = new SimClock((dt) => (total += dt));
  c.step(1 / 30);
  assert.ok(Math.abs(total - 1 / 30) < 1e-12);
  assert.ok(c.lastAt !== null && Math.abs(c.lastAt - performance.now()) < 100);
});

await t('4 fps rides as far as 60 fps (no slow motion)', () => {
  const smooth = rideAt(1 / 60, 120);
  const choppy = rideAt(0.25, 120);
  assert.ok(smooth.distance > 300, `only ${smooth.distance.toFixed(0)} m in 2 min at 250 W`);
  assert.ok(Math.abs(choppy.distance - smooth.distance) / smooth.distance < 0.01, `${choppy.distance} vs ${smooth.distance}`);
  assert.ok(Math.abs(choppy.elapsed - smooth.elapsed) < 0.3);
});

await t('a hidden tab (1 Hz timer) still rides', () => {
  const hidden = rideAt(1, 120);
  const smooth = rideAt(1 / 60, 120);
  assert.ok(Math.abs(hidden.distance - smooth.distance) / smooth.distance < 0.01);
});

await t('the trainer gets the gradient of the climb', () => {
  const { hub, modes } = fakeHub(200);
  const session = new RideSession({ route, workout: null, settings: { ...settings }, ghost: null, erg: false, holdWatts: null, gears: false }, hub);
  session.begin();
  for (let i = 0; i < 600; i++) session.tick(0.05);
  const last = modes[modes.length - 1] as { kind: string; params: { grade: number } };
  assert.equal(last.kind, 'sim');
  // difficulty 50 % of a 4 % climb, eased in over a few seconds
  assert.ok(Math.abs(last.params.grade - 2) < 0.3, `grade ${last.params.grade}`);
});

/** Two riders, simulated side by side as each other's peers: `a` at 300 W, `b` at 180 W. */
function groupRide(together: boolean, seconds: number) {
  const a = new RideSession({ route, workout: null, settings: { ...settings }, ghost: null, erg: false, holdWatts: null, gears: false }, fakeHub(300).hub);
  const b = new RideSession({ route, workout: null, settings: { ...settings }, ghost: null, erg: false, holdWatts: null, gears: false }, fakeHub(180).hub);
  const peer = (x: RideSession, id: string) => () => [
    { id, name: id, kit: '#ffffff', accent: '#ffffff', bike: '#000000', weight: 75, p: x.progress, speed: x.moveSpeed, power: x.state.power, cadence: 88, stale: false, host: false, ready: true },
  ];
  a.setPeers(peer(b, 'b'), together);
  b.setPeers(peer(a, 'a'), together);
  a.begin();
  b.begin();
  for (let i = 0; i < seconds * 20; i++) {
    a.tick(0.05);
    b.tick(0.05);
  }
  return { a: a.state, b: b.state, gap: a.progress - b.progress };
}

await t('apart without keep-together: 300 W rides away from 180 W', () => {
  const { gap } = groupRide(false, 600);
  assert.ok(gap > 300, `gap ${gap}`);
});

await t('keep-together holds 300 W and 180 W in the draft; the watts are still each rider\'s', () => {
  const { a, b, gap } = groupRide(true, 600);
  assert.ok(Math.abs(gap) < 7, `gap ${gap}`);
  assert.ok(a.groupPull < 0 && b.groupPull > 0, `pulls ${a.groupPull} ${b.groupPull}`);
  assert.equal(a.power, 300);
  assert.equal(b.power, 180);
});

await t('nobody is towed who does not pedal', () => {
  const a = new RideSession({ route, workout: null, settings: { ...settings }, ghost: null, erg: false, holdWatts: null, gears: false }, fakeHub(0).hub);
  a.setPeers(() => [{ id: 'x', name: 'x', kit: '#ffffff', accent: '#ffffff', bike: '#000000', weight: 75, p: 400, speed: 8, power: 250, cadence: 88, stale: false, host: false, ready: true }], true);
  a.begin();
  for (let i = 0; i < 200; i++) a.tick(0.05);
  assert.equal(a.state.groupPull, 0);
  assert.ok(a.state.distance < 1);
});

await t('a trainer drop-out pauses the ride and leaves no zeros in it; it carries on when power is back', () => {
  const metrics: { power?: number; cadence?: number } = { power: 250, cadence: 88 };
  const modes: { kind: string }[] = [];
  const hub = { metrics, setMode: (m: { kind: string }) => modes.push(m), setGearRatio: () => undefined, setRiderWeights: () => undefined } as unknown as DeviceHub;
  const session = new RideSession({ route, workout: null, settings: { ...settings }, ghost: null, erg: false, holdWatts: null, gears: false }, hub);
  session.begin();
  const run = (sec: number) => {
    for (let i = 0; i < sec * 20; i++) session.tick(0.05);
  };
  run(60);
  // a hiccup: the last watts carry on, nothing pauses
  delete metrics.power;
  run(2);
  assert.equal(session.state.status, 'riding');
  assert.equal(session.state.power, 250);
  // gone for good: paused after 3 s, the trainer told to let go
  run(20);
  assert.equal(session.state.status, 'paused');
  assert.ok(session.state.dropout !== null && session.state.dropout > 20, `dropout ${session.state.dropout}`);
  assert.equal(modes.at(-1)!.kind, 'idle');
  const elapsed = session.state.elapsed;
  // back
  metrics.power = 250;
  run(1);
  assert.equal(session.state.status, 'riding');
  assert.equal(session.state.dropout, null);
  assert.equal(session.state.banner?.text, 'Power is back');
  run(10);
  const rec = session.record();
  // 60 s, 3 s on held watts, 11 s after: all of it at 250 W, the 20 s without data are not in the ride
  assert.ok(Math.abs(session.state.elapsed - elapsed - 11) < 0.2, `elapsed ${session.state.elapsed - elapsed}`);
  assert.ok(rec.samples.length >= 71 && rec.samples.length <= 74, `samples ${rec.samples.length}`);
  assert.ok(rec.samples.every((x) => x.power === 250), 'a zero crept in');
});

await t('a ride without any power source is not a drop-out', () => {
  const hub = { metrics: {}, setMode: () => undefined, setGearRatio: () => undefined, setRiderWeights: () => undefined } as unknown as DeviceHub;
  const session = new RideSession({ route, workout: null, settings: { ...settings }, ghost: null, erg: false, holdWatts: null, gears: false }, hub);
  session.begin();
  for (let i = 0; i < 200; i++) session.tick(0.05);
  assert.equal(session.state.status, 'riding');
  assert.equal(session.state.dropout, null);
});

console.log(`${n} session tests passed`);
