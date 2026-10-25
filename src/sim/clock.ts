// Ride time from the wall clock. Drawn frames used to drive the ride: below 10 fps it ran in slow motion
// (a frame counted 0.1 s at most) and a hidden tab stopped it. Now the render loop and a fallback timer both
// ask the clock to catch up with real time, and the ride runs in short steps whatever the frame rate.

/** Longest step the physics takes at once. */
const MAX_STEP = 0.05;
/** Longest gap made up at once: a Mac that slept mid-ride shouldn't add an hour of riding. */
const MAX_GAP = 65;

export class SimClock {
  private last: number | null = null;
  private run: (dt: number) => void;

  constructor(run: (dt: number) => void) {
    this.run = run;
  }

  /** When the clock last ran (performance.now() ms), or null before its first call. */
  get lastAt() {
    return this.last;
  }

  /** Run the ride up to `now`: called by the render loop and by the fallback timer while frames don't come. */
  sync(now = performance.now()) {
    if (this.last === null) {
      this.last = now;
      return;
    }
    const dt = Math.min((now - this.last) / 1000, MAX_GAP);
    this.last = now;
    this.steps(dt);
  }

  /** Run an explicit step (a capture script stepping a paused engine); the wall clock starts again from now. */
  step(dt: number) {
    this.steps(dt);
    this.last = performance.now();
  }

  private steps(dt: number) {
    if (!(dt > 0)) return;
    const n = Math.ceil(dt / MAX_STEP);
    for (let i = 0; i < n; i++) this.run(dt / n);
  }
}
