// Procedural ride soundscape (wind, tyres, freewheel, drivetrain, nature, city) plus UI one-shots.
// Everything is synthesized with Web Audio; update() only sets AudioParams at ~20 Hz.

export interface RideAudioState {
  /** m/s */
  speed: number;
  power: number;
  cadence: number;
  /** percent */
  grade: number;
  altitude: number;
  /** 0..1 how forested around the rider */
  forest: number;
  /** 0..1 */
  urban: number;
  descending: boolean;
  /** 0..1 open water within ~600 m (Engine.environment().sea) */
  sea?: number;
  /** 'alpine' (default) | 'mediterranean' */
  biome?: string;
}

const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class RideAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private volume = 0.6;
  private disposed = false;

  private white: AudioBuffer | null = null;
  private sources: AudioScheduledSourceNode[] = [];

  // continuous layers
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private tyreGain!: GainNode;
  private tyreFilter!: BiquadFilterNode;
  private tickSrc!: AudioBufferSourceNode;
  private tickGain!: GainNode;
  private chainGain!: GainNode;
  private chainFilter!: BiquadFilterNode;
  private chainLfo!: OscillatorNode;
  private chainLfoGain!: GainNode;
  private airGain!: GainNode;
  private trafficGain!: GainNode;
  private surfGain!: GainNode; // low rolling surf bed (swells with the wave period)
  private washGain!: GainNode; // brighter foam wash, fired in bursts
  private pineGain!: GainNode; // dry wind-in-the-pines hiss
  private bus!: GainNode; // one-shot / event bus (birds, bells, horn)

  // state
  private acc = 0;
  private gust = 0;
  private gustTarget = 0;
  private gustTimer = 0;
  private birdT = 2;
  private cowT = 12;
  private hornT = 25;
  private gullT = 6;
  private goatT = 10;
  private washT = 5;
  private wavePhase = Math.random() * 6.28;
  private wavePeriod = rand(7, 11);

  async resume(): Promise<void> {
    if (this.disposed) return;
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.build(this.ctx);
    }
    if (this.ctx.state !== 'running') {
      await this.ctx.resume().catch(() => undefined);
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.applyMaster();
  }

  setVolume(v: number) {
    this.volume = clamp(v);
    this.applyMaster();
  }

  dispose() {
    this.disposed = true;
    for (const s of this.sources) {
      try { s.stop(); } catch { /* already stopped */ }
    }
    this.sources = [];
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.master = null;
  }

  private applyMaster() {
    if (!this.ctx || !this.master) return;
    const g = this.muted ? 0 : this.volume * this.volume;
    this.master.gain.setTargetAtTime(g, this.ctx.currentTime, 0.05);
  }

  // ---- graph ----

  private noiseBuffer(ctx: AudioContext, kind: 'white' | 'pink', seconds: number): AudioBuffer {
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') {
        d[i] = w;
      } else {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
    // short crossfade so the loop point is inaudible
    const f = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < f; i++) {
      const t = i / f;
      d[n - f + i] = d[n - f + i] * (1 - t) + d[i] * t;
    }
    return buf;
  }

  private loop(ctx: AudioContext, buf: AudioBuffer): AudioBufferSourceNode {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.loopEnd = buf.duration - 0.05;
    s.loopStart = 0;
    this.sources.push(s);
    return s;
  }

  private build(ctx: AudioContext) {
    const master = (this.master = ctx.createGain());
    master.gain.value = this.muted ? 0 : this.volume * this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);

    const pink = this.noiseBuffer(ctx, 'pink', 4);
    this.white = this.noiseBuffer(ctx, 'white', 2);
    const mk = (type: BiquadFilterType, f: number, q = 0.7) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };
    const gain = (v = 0) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };

    // wind
    const wind = this.loop(ctx, pink);
    this.windFilter = mk('bandpass', 400, 0.5);
    this.windGain = gain();
    wind.connect(this.windFilter).connect(this.windGain).connect(master);

    // tyres
    const tyre = this.loop(ctx, pink);
    tyre.playbackRate.value = 0.8;
    this.tyreFilter = mk('lowpass', 300, 0.5);
    this.tyreGain = gain();
    tyre.connect(this.tyreFilter).connect(this.tyreGain).connect(master);

    // freewheel: one second of 20 Hz-spaced clicks, rate set by playbackRate
    const sr = ctx.sampleRate;
    const tb = ctx.createBuffer(1, sr, sr);
    const td = tb.getChannelData(0);
    for (let k = 0; k < 20; k++) {
      const at = Math.floor((k / 20) * sr);
      const amp = 0.6 + Math.random() * 0.4;
      for (let i = 0; i < sr * 0.004; i++) td[at + i] = (Math.random() * 2 - 1) * amp * Math.exp(-i / (sr * 0.0008));
    }
    this.tickSrc = ctx.createBufferSource();
    this.tickSrc.buffer = tb;
    this.tickSrc.loop = true;
    this.sources.push(this.tickSrc);
    this.tickGain = gain();
    this.tickSrc.connect(mk('bandpass', 3200, 1.2)).connect(this.tickGain).connect(master);

    // chain whir, amplitude-wobbled at crank frequency
    const chain = this.loop(ctx, pink);
    chain.playbackRate.value = 1.5;
    this.chainFilter = mk('bandpass', 900, 1.5);
    this.chainGain = gain();
    this.chainLfo = ctx.createOscillator();
    this.chainLfo.frequency.value = 1.4;
    this.chainLfoGain = gain(0);
    this.chainLfo.connect(this.chainLfoGain).connect(this.chainGain.gain);
    this.sources.push(this.chainLfo);
    chain.connect(this.chainFilter).connect(this.chainGain).connect(master);

    // air / stream bed
    const air = this.loop(ctx, pink);
    air.playbackRate.value = 1.2;
    this.airGain = gain();
    air.connect(mk('bandpass', 1600, 0.4)).connect(this.airGain).connect(master);

    // traffic hum
    const traffic = this.loop(ctx, pink);
    traffic.playbackRate.value = 0.5;
    this.trafficGain = gain();
    traffic.connect(mk('lowpass', 220, 0.7)).connect(this.trafficGain).connect(master);

    // surf (Mediterranean): pink noise at half speed, low-passed to a rumble.
    // Gain is swelled by update() with a 7-11 s period; peak ~0.09 (wind peaks at 0.38).
    const surf = this.loop(ctx, pink);
    surf.playbackRate.value = 0.6;
    this.surfGain = gain();
    surf.connect(mk('lowpass', 650, 0.5)).connect(this.surfGain).connect(master);
    // foam wash: band-passed hiss around 1.8 kHz, peak ~0.035, fades in/out over several seconds
    const wash = this.loop(ctx, pink);
    wash.playbackRate.value = 1.1;
    this.washGain = gain();
    wash.connect(mk('bandpass', 1800, 0.5)).connect(this.washGain).connect(master);
    // pines: very quiet 3-6 kHz band, peak ~0.016, gusts modulate it
    const pine = this.loop(ctx, pink);
    pine.playbackRate.value = 1.6;
    this.pineGain = gain();
    pine.connect(mk('bandpass', 4200, 0.6)).connect(this.pineGain).connect(master);

    this.bus = gain(1);
    this.bus.connect(master);

    this.sources = [...new Set(this.sources)];
    for (const s of this.sources) s.start();
  }

  // ---- per frame ----

  update(dt: number, s: RideAudioState) {
    const ctx = this.ctx;
    if (!ctx || this.disposed || ctx.state !== 'running') return;

    // random gusting runs every frame (cheap scalar math)
    this.gustTimer -= dt;
    if (this.gustTimer <= 0) {
      this.gustTimer = rand(1.2, 4);
      this.gustTarget = rand(-1, 1);
    }
    this.gust += (this.gustTarget - this.gust) * Math.min(1, dt * 0.8);

    this.birdT -= dt;
    this.cowT -= dt;
    this.hornT -= dt;
    this.gullT -= dt;
    this.goatT -= dt;
    this.washT -= dt;
    this.wavePhase += (dt * Math.PI * 2) / this.wavePeriod;
    if (this.wavePhase > 6.2832) {
      this.wavePhase -= 6.2832;
      this.wavePeriod = rand(7, 11);
    }
    this.scheduleEvents(ctx, s);

    this.acc += dt;
    if (this.acc < 0.05) return;
    this.acc = 0;
    const t = ctx.currentTime;
    const tc = 0.12;

    const sp = Math.max(0, s.speed);
    const v = smooth(2, 16, sp);
    const gustAmt = 1 + this.gust * 0.25 * v;
    this.windGain.gain.setTargetAtTime(0.38 * v * v * gustAmt * (s.descending ? 1.1 : 1), t, tc);
    this.windFilter.frequency.setTargetAtTime(250 + sp * 85 + this.gust * 80 * v, t, tc);

    this.tyreGain.gain.setTargetAtTime(0.16 * smooth(0.5, 14, sp), t, tc);
    this.tyreFilter.frequency.setTargetAtTime(220 + sp * 28, t, tc);

    const coasting = sp > 2 && (s.cadence < 10 || s.power < 5);
    const rate = clamp(sp * 3.6, 15, 60);
    this.tickSrc.playbackRate.setTargetAtTime(rate / 20, t, 0.08);
    this.tickGain.gain.setTargetAtTime(coasting ? 0.07 * smooth(2, 7, sp) : 0, t, 0.06);

    const pedalling = !coasting && s.cadence >= 10 && s.power >= 5;
    const base = pedalling ? 0.03 * smooth(10, 90, s.cadence) * (0.6 + 0.4 * clamp(s.power / 250)) : 0;
    this.chainGain.gain.setTargetAtTime(base, t, 0.1);
    this.chainFilter.frequency.setTargetAtTime(700 + s.cadence * 7, t, 0.1);
    this.chainLfo.frequency.setTargetAtTime(Math.max(0.5, s.cadence / 60), t, 0.1);
    this.chainLfoGain.gain.setTargetAtTime(base * 0.35, t, 0.1);

    const calm = 1 - 0.6 * v;
    this.airGain.gain.setTargetAtTime((0.012 + 0.03 * s.forest) * calm * (1 - s.urban * 0.7), t, 0.5);
    this.trafficGain.gain.setTargetAtTime(0.14 * smooth(0.5, 1, s.urban) * (1 - 0.5 * v), t, 0.6);

    // Mediterranean layers. Surf is masked by wind at speed (louder when slow).
    const med = s.biome === 'mediterranean';
    const sea = med ? clamp(s.sea ?? 0) : 0;
    const swell = Math.pow(0.5 + 0.5 * Math.sin(this.wavePhase), 2);
    const slow = 1 - 0.8 * v;
    this.surfGain.gain.setTargetAtTime(0.09 * sea * (0.3 + 0.7 * swell) * slow, t, 0.3);
    if (this.washT <= 0) {
      // foam wash on the crest: ~2 s rise, ~4 s fall
      this.washT = rand(7, 16);
      const w = 0.035 * sea * slow * rand(0.6, 1);
      this.washGain.gain.cancelScheduledValues(t);
      this.washGain.gain.setTargetAtTime(w, t, 0.8);
      this.washGain.gain.setTargetAtTime(0, t + 2, 1.3);
    }
    const pines = med ? smooth(0.4, 0.85, s.forest) * (1 - s.urban) : 0;
    this.pineGain.gain.setTargetAtTime(0.016 * pines * (0.6 + 0.4 * (this.gust * 0.5 + 0.5)) * (1 - 0.5 * v), t, 0.6);
  }

  private scheduleEvents(ctx: AudioContext, s: RideAudioState) {
    const v = smooth(2, 16, Math.max(0, s.speed));
    if (this.birdT <= 0) {
      const alt = 1 - smooth(1700, 2800, s.altitude) * 0.9;
      const rate = (0.08 + 0.5 * s.forest) * alt * (1 - 0.8 * smooth(0.3, 0.9, s.urban)) * (1 - 0.6 * v);
      this.birdT = rate > 0.01 ? rand(0.4, 1.6) / rate : 5;
      if (rate > 0.01 && this.birdT < 30) this.chirp(ctx, 0.5 + 0.5 * (1 - v));
      this.birdT = Math.min(this.birdT, 20);
    }
    if (this.cowT <= 0) {
      this.cowT = rand(9, 28);
      const alpine = s.biome !== 'mediterranean' && s.altitude > 900 && s.altitude < 2400 && s.forest < 0.4 && s.urban < 0.3 && v < 0.8;
      if (alpine) this.cowbells(ctx);
    }
    if (this.gullT <= 0) {
      this.gullT = rand(8, 24);
      if (s.biome === 'mediterranean' && (s.sea ?? 0) > 0.12 && v < 0.85) this.gulls(ctx, 0.5 + 0.5 * clamp(s.sea ?? 0));
    }
    if (this.goatT <= 0) {
      this.goatT = rand(10, 26);
      if (s.biome === 'mediterranean' && s.forest < 0.35 && s.urban < 0.25 && v < 0.8) this.goatBells(ctx);
    }
    if (this.hornT <= 0) {
      this.hornT = rand(20, 50);
      if (s.urban > 0.5) this.horn(ctx);
    }
  }

  // ---- events ----

  private chirp(ctx: AudioContext, level: number) {
    const t0 = ctx.currentTime + 0.02;
    const osc = ctx.createOscillator();
    const fm = ctx.createOscillator();
    const fmG = ctx.createGain();
    const g = ctx.createGain();
    const pan = ctx.createStereoPanner();
    pan.pan.value = rand(-0.8, 0.8);
    osc.type = 'sine';
    fm.frequency.value = rand(30, 90);
    fmG.gain.value = rand(40, 160);
    fm.connect(fmG).connect(osc.frequency);
    const notes = 1 + Math.floor(Math.random() * 5);
    const f0 = rand(2200, 5200);
    const up = Math.random() < 0.5;
    let t = t0;
    g.gain.setValueAtTime(0, t0);
    for (let i = 0; i < notes; i++) {
      const d = rand(0.04, 0.1);
      const fa = f0 * (1 + rand(-0.15, 0.15));
      const fb = fa * (up ? rand(1.2, 1.7) : rand(0.6, 0.85));
      osc.frequency.setValueAtTime(fa, t);
      osc.frequency.exponentialRampToValueAtTime(fb, t + d);
      g.gain.setTargetAtTime(0.045 * level, t, 0.006);
      g.gain.setTargetAtTime(0, t + d * 0.8, 0.012);
      t += d + rand(0.03, 0.09);
    }
    osc.connect(g).connect(pan).connect(this.bus);
    this.disposeAfter([osc, fm], t + 0.2);
  }

  private cowbells(ctx: AudioContext) {
    const n = 3 + Math.floor(Math.random() * 5);
    const f = rand(480, 700);
    const pan = ctx.createStereoPanner();
    pan.pan.value = rand(-0.9, 0.9);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    lp.connect(pan).connect(this.bus);
    let t = ctx.currentTime + 0.05;
    for (let i = 0; i < n; i++) {
      const ff = f * (Math.random() < 0.3 ? 1.12 : 1);
      this.partial(ctx, lp, ff, t, 0.5, 0.018, 'square');
      this.partial(ctx, lp, ff * 1.505, t, 0.35, 0.012, 'square');
      t += rand(0.18, 0.55);
    }
  }

  /**
   * Gull series: 1-4 "kyow" calls. Each is a sawtooth (rich harmonics) through a ~2.3 kHz
   * formant band-pass; pitch jumps up ~15% in 40 ms then falls to ~60%, with fast vibrato.
   * A quieter octave-up partial adds the shrill edge. Peak ~0.03 per call.
   */
  private gulls(ctx: AudioContext, level: number) {
    const calls = 1 + Math.floor(Math.random() * 4);
    const pan = ctx.createStereoPanner();
    pan.pan.value = rand(-0.8, 0.8);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = rand(2000, 2600);
    bp.Q.value = 1.5;
    bp.connect(pan).connect(this.bus);
    const f0 = rand(1350, 1800);
    let t = ctx.currentTime + 0.05;
    for (let i = 0; i < calls; i++) {
      const d = rand(0.28, 0.42) * (i === calls - 1 && calls > 2 ? 1.3 : 1);
      const g = ctx.createGain();
      const vib = ctx.createOscillator();
      const vibG = ctx.createGain();
      vib.frequency.value = rand(24, 38);
      vibG.gain.value = 35;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.03 * level, t + 0.03);
      g.gain.setTargetAtTime(0, t + d * 0.45, d * 0.25);
      g.connect(bp);
      const f = f0 * (1 + rand(-0.06, 0.06));
      for (const [mul, amp] of [[1, 1], [2, 0.35]] as const) {
        const o = ctx.createOscillator();
        const og = ctx.createGain();
        o.type = 'sawtooth';
        og.gain.value = amp;
        o.frequency.setValueAtTime(f * 0.85 * mul, t);
        o.frequency.linearRampToValueAtTime(f * mul, t + 0.04);
        o.frequency.exponentialRampToValueAtTime(f * 0.6 * mul, t + d);
        vibG.connect(o.frequency);
        o.connect(og).connect(g);
        o.start(t);
        o.stop(t + d + 0.2);
      }
      vib.connect(vibG);
      vib.start(t);
      vib.stop(t + d + 0.2);
      t += d + rand(0.12, 0.3);
    }
  }

  /**
   * Goat bells: 2-4 small bells, each higher (750-1500 Hz) and thinner than the Alpine cowbells
   * (sine + inharmonic 2.7x partial, short decay) struck near-randomly over 2-6 s. Peak ~0.012.
   */
  private goatBells(ctx: AudioContext) {
    const nb = 2 + Math.floor(Math.random() * 3);
    const pan = ctx.createStereoPanner();
    pan.pan.value = rand(-0.9, 0.9);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    lp.connect(pan).connect(this.bus);
    const freqs = Array.from({ length: nb }, () => rand(750, 1500));
    const t0 = ctx.currentTime + 0.05;
    const span = rand(2, 6);
    const strikes = 4 + Math.floor(Math.random() * 7);
    for (let i = 0; i < strikes; i++) {
      const t = t0 + Math.random() * span;
      const f = freqs[Math.floor(Math.random() * nb)];
      const vel = rand(0.4, 1);
      this.partial(ctx, lp, f, t, 0.45, 0.012 * vel, 'sine', 0.002);
      this.partial(ctx, lp, f * 2.7, t, 0.2, 0.005 * vel, 'sine', 0.002);
      if (Math.random() < 0.3) {
        // double rattle strike
        const t2 = t + rand(0.05, 0.12);
        this.partial(ctx, lp, f, t2, 0.3, 0.007 * vel, 'sine', 0.002);
      }
    }
  }

  private horn(ctx: AudioContext) {
    const t = ctx.currentTime + 0.05;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.connect(this.bus);
    const len = rand(0.25, 0.5);
    for (const f of [rand(380, 440), rand(480, 540)]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.008, t + 0.04);
      g.gain.setTargetAtTime(0, t + len, 0.04);
      o.connect(g).connect(lp);
      o.start(t);
      o.stop(t + len + 0.3);
    }
  }

  private disposeAfter(nodes: OscillatorNode[], endTime: number) {
    for (const n of nodes) {
      n.start(this.ctx!.currentTime);
      n.stop(endTime);
    }
  }

  private partial(
    ctx: AudioContext, dest: AudioNode, freq: number, t: number, dur: number, peak: number,
    type: OscillatorType = 'sine', attack = 0.003,
  ) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setTargetAtTime(0, t + attack, dur / 4);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur * 1.5);
  }

  private burst(ctx: AudioContext, dest: AudioNode, t: number, dur: number, peak: number, freq: number, q: number, type: BiquadFilterType = 'bandpass') {
    if (!this.white) return;
    const s = ctx.createBufferSource();
    s.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.setTargetAtTime(0, t, dur / 4);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur * 2);
  }

  private ready(): AudioContext | null {
    const c = this.ctx;
    return c && !this.disposed && c.state === 'running' ? c : null;
  }

  shift(dir: 1 | -1) {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime + 0.005;
    const up = dir === 1;
    // lever click, chain jump over the sprocket, settle tick
    this.burst(c, this.bus, t, 0.012, 0.5, up ? 4200 : 3400, 2);
    this.partial(c, this.bus, up ? 2300 : 1700, t, 0.03, 0.12, 'triangle', 0.001);
    this.burst(c, this.bus, t + 0.045, 0.02, 0.28, up ? 2600 : 2000, 1.5);
    this.partial(c, this.bus, up ? 1250 : 900, t + 0.06, 0.04, 0.07, 'sine', 0.001);
    this.burst(c, this.bus, t + 0.11, 0.03, 0.12, 900, 1);
  }

  shiftLimit() {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime + 0.005;
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.09);
    g.gain.setValueAtTime(0.35, t);
    g.gain.setTargetAtTime(0, t, 0.025);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.2);
    this.burst(c, this.bus, t, 0.05, 0.25, 500, 0.7, 'lowpass');
  }

  private bell(freq: number, t: number, vel = 1) {
    const c = this.ctx!;
    this.partial(c, this.bus, freq, t, 1.4, 0.16 * vel, 'sine', 0.002);
    this.partial(c, this.bus, freq * 2.76, t, 0.7, 0.05 * vel, 'sine', 0.002);
    this.partial(c, this.bus, freq * 5.4, t, 0.3, 0.02 * vel, 'sine', 0.002);
  }

  summit() {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime + 0.02;
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => this.bell(f, t + i * 0.12, i === 3 ? 1.2 : 1));
  }

  segmentStart() {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime + 0.02;
    this.partial(c, this.bus, 659.3, t, 0.25, 0.14, 'triangle', 0.005);
    this.partial(c, this.bus, 880, t + 0.11, 0.35, 0.16, 'triangle', 0.005);
  }

  segmentEnd(pr: boolean) {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime + 0.02;
    if (pr) {
      [523.3, 659.3, 784, 1046.5].forEach((f, i) => {
        this.partial(c, this.bus, f, t + i * 0.1, 0.5, 0.13, 'triangle', 0.005);
        if (i === 3) this.bell(f * 2, t + i * 0.1, 0.8);
      });
    } else {
      this.partial(c, this.bus, 392, t, 0.3, 0.12, 'triangle', 0.005);
      this.partial(c, this.bus, 523.3, t + 0.12, 0.45, 0.13, 'triangle', 0.005);
    }
  }

  /** Two falling tones, like a phone running low; three and louder when it is nearly empty. */
  batteryLow(critical: boolean) {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime + 0.02;
    const tones = critical ? [988, 784, 587.3] : [880, 659.3];
    tones.forEach((f, i) => this.partial(c, this.bus, f, t + i * 0.22, 0.5, critical ? 0.26 : 0.2, 'triangle', 0.005));
  }

  /** A friend's thumbs-up: two quick rising plucks. */
  rideOn() {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime + 0.02;
    this.partial(c, this.bus, 784, t, 0.18, 0.12, 'triangle', 0.003);
    this.partial(c, this.bus, 1174.7, t + 0.09, 0.3, 0.14, 'triangle', 0.003);
  }

  countdown() {
    const c = this.ready();
    if (!c) return;
    this.partial(c, this.bus, 880, c.currentTime + 0.01, 0.16, 0.18, 'sine', 0.004);
  }
}
