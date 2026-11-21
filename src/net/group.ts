// A group ride: one WebSocket to the room on the relay (relay/), the other riders' last positions, and the
// relay's clock for a start everyone sees at the same moment. Positions arrive twice a second; between them
// each rider rolls on at their last speed and is eased towards where they really are.

import type { RouteData } from '../geo/route.ts';
import {
  DEFAULT_OPTIONS, MAX_NAME, POS_INTERVAL_MS, PROTOCOL, inviteLink, randomCode,
  type ClientMsg, type ErrorCode, type Member, type MemberInfo, type MemberResult, type Pos, type Result, type RoomOptions,
  type RoomRoute, type ServerMsg,
} from './protocol.ts';

export const DEFAULT_RELAY = 'wss://serpentine-relay.skyline-media.workers.dev';

/** ?relay=ws://127.0.0.1:8787 for a local relay (`npm run dev` in relay/). */
export function relayUrl(): string {
  return new URLSearchParams(location.search).get('relay') ?? DEFAULT_RELAY;
}

export type GroupStatus = 'connecting' | 'live' | 'reconnecting' | 'closed';

/** Seconds without a position before a rider is shown as gone (sleeping Mac, lost Wi-Fi). */
const STALE_S = 10;
/** Dead reckoning stops after this: further than that, wait for the next position. */
const MAX_COAST_S = 2;

export interface Peer {
  info: MemberInfo;
  ready: boolean;
  pos: Pos | null;
  /** performance.now() when `pos` arrived. */
  at: number;
  /** Where we draw them: where they are now (dead reckoning) plus `err`. */
  shown: number;
  /** What the last position corrected, faded out so nobody jumps; easing the position itself would lag a moving rider. */
  err: number;
}

export interface PeerView {
  id: string;
  name: string;
  kit: string;
  accent: string;
  bike: string;
  weight: number;
  /** Metres along the route from the start, as `progress` in sim/session.ts. */
  p: number;
  speed: number;
  power: number;
  cadence: number;
  stale: boolean;
  host: boolean;
  ready: boolean;
}

const ERRORS: Record<ErrorCode, string> = {
  'no-room': 'No group ride with that code. Check the code, or ask for a new one.',
  taken: 'That code is in use.',
  full: 'This group ride is full.',
  version: 'Your Serpentine is older or newer than the others in this group. Everyone needs the same version.',
  bad: 'The group ride server did not understand this app.',
};

export class GroupError extends Error {
  readonly code: ErrorCode | 'network';
  constructor(code: ErrorCode | 'network', message?: string) {
    super(message ?? (code === 'network' ? 'Could not reach the group ride server. Check the internet connection.' : ERRORS[code]));
    this.code = code;
  }
}

export class GroupRide {
  readonly code: string;
  readonly me: MemberInfo;
  readonly url: string;
  route: RoomRoute | null = null;
  options: RoomOptions = DEFAULT_OPTIONS;
  host = '';
  /** Everyone's results so far (ours too), by rider id. */
  results = new Map<string, MemberResult>();
  ready = false;
  /** Relay time (ms) the ride starts for everyone; null until the host starts it. */
  startAt: number | null = null;
  status: GroupStatus = 'connecting';
  peers = new Map<string, Peer>();

  private ws: WebSocket | null = null;
  private listeners = new Set<() => void>();
  private rideOnListeners = new Set<(from: PeerView, toMe: boolean) => void>();
  /** Relay clock minus ours, from the ping with the shortest round trip. */
  private offset = 0;
  private bestRtt = Infinity;
  private lastSent = 0;
  private retries = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private left = false;
  /** In the room at least once: from then on a lost connection is retried. */
  private joined = false;

  private constructor(url: string, code: string, me: MemberInfo) {
    this.url = url;
    this.code = code;
    this.me = me;
  }

  /** A new room on the host's route; a code that happens to be in use gets another one. */
  static async create(me: MemberInfo, route: RoomRoute, options: RoomOptions = DEFAULT_OPTIONS, url = relayUrl()): Promise<GroupRide> {
    for (let i = 0; i < 5; i++) {
      const g = new GroupRide(url, randomCode(), me);
      try {
        await g.connect(route, options);
        return g;
      } catch (e) {
        if (!(e instanceof GroupError && e.code === 'taken')) throw e;
      }
    }
    throw new GroupError('taken');
  }

  static async join(code: string, me: MemberInfo, url = relayUrl()): Promise<GroupRide> {
    const g = new GroupRide(url, code, me);
    await g.connect();
    return g;
  }

  get isHost(): boolean {
    return this.host === this.me.id;
  }

  get race(): boolean {
    return this.options.mode === 'race';
  }

  /** The link to send: a page on the relay that opens the app on this room. */
  get invite(): string {
    return inviteLink(this.url, this.code);
  }

  /** Relay time now, ms. */
  serverNow(): number {
    return Date.now() + this.offset;
  }

  /** Seconds until the start (negative once started), null before the host starts it. */
  startsIn(): number | null {
    return this.startAt === null ? null : (this.startAt - this.serverNow()) / 1000;
  }

  get started(): boolean {
    const s = this.startsIn();
    return s !== null && s <= 0;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed() {
    for (const fn of this.listeners) fn();
  }

  private connect(create?: RoomRoute, options?: RoomOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (err) reject(err);
        else resolve();
      };
      const timeout = setTimeout(() => {
        done(new GroupError('network'));
        ws.close();
      }, 10_000);
      const ws = new WebSocket(`${this.url}/room/${this.code}`);
      this.ws = ws;
      ws.onopen = () => this.send({ t: 'hello', v: PROTOCOL, me: this.me, create, options }, ws);
      ws.onmessage = (e) => {
        let m: ServerMsg;
        try {
          m = JSON.parse(String(e.data)) as ServerMsg;
        } catch {
          return;
        }
        if (m.t === 'error') return done(new GroupError(m.code));
        this.receive(m);
        if (m.t === 'room') {
          // back after a lost connection: the relay forgot nothing but our ready mark
          if (this.joined && this.ready) this.send({ t: 'ready', ready: true });
          this.joined = true;
          this.retries = 0;
          this.status = 'live';
          this.ping();
          this.changed();
          done();
        }
      };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.ws = null;
        if (!settled) done(new GroupError('network'));
        // the failed attempt's catch (below) runs first and closes the group for good on a real refusal
        if (this.joined && !this.left && this.status !== 'closed') this.reconnect();
      };
    });
  }

  /** Lost the relay mid-ride: keep riding, try again with growing pauses; the room keeps our place. */
  private reconnect() {
    if (this.retryTimer) return;
    this.status = 'reconnecting';
    this.changed();
    const wait = Math.min(15_000, 1000 * 2 ** this.retries++);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.left) return;
      this.connect().catch((e) => {
        // refused (the room is gone after everyone left for 15 minutes, or it filled up): ride on alone;
        // a network failure closes the socket, and that tries again
        if (e instanceof GroupError && e.code !== 'network') this.close();
      });
    }, wait);
  }

  private close() {
    this.status = 'closed';
    this.stopPing();
    this.changed();
  }

  private receive(m: ServerMsg) {
    const now = performance.now();
    switch (m.t) {
      case 'room': {
        this.route = m.route;
        this.options = m.options ?? DEFAULT_OPTIONS;
        this.host = m.host;
        this.startAt = m.startAt;
        const mine = this.results.get(this.me.id);
        for (const r of m.results ?? []) this.results.set(r.id, r);
        // a result sent while the connection was down
        if (mine && !m.results?.some((r) => r.id === this.me.id)) {
          const { id: _id, name: _n, kit: _k, weight: _w, ...result } = mine;
          this.send({ t: 'result', result });
        }
        // a first guess at the relay clock until a ping answers
        if (this.bestRtt === Infinity) this.offset = m.now - Date.now();
        const old = this.peers;
        this.peers = new Map();
        for (const mem of m.members) if (mem.id !== this.me.id) this.peers.set(mem.id, this.peerFrom(mem, old.get(mem.id), now));
        break;
      }
      case 'join':
        if (m.member.id !== this.me.id) this.peers.set(m.member.id, this.peerFrom(m.member, this.peers.get(m.member.id), now));
        break;
      case 'leave':
        this.peers.delete(m.id);
        this.host = m.host;
        break;
      case 'pos': {
        const p = this.peers.get(m.id);
        if (!p) return;
        p.pos = m.pos;
        p.at = now;
        // where we showed them against where they turn out to be; a big jump (joined the group late) is not eased
        const err = p.shown - this.reckon(p, now);
        p.err = Math.abs(err) > 60 ? 0 : err;
        p.shown = this.reckon(p, now) + p.err;
        return;
      }
      case 'start':
        this.startAt = m.startAt;
        break;
      case 'ready': {
        const p = this.peers.get(m.id);
        if (p) p.ready = m.ready;
        break;
      }
      case 'result':
        this.results.set(m.result.id, m.result);
        break;
      case 'rideon': {
        const from = this.view().find((p) => p.id === m.from);
        if (from && (m.to === null || m.to === this.me.id)) for (const fn of this.rideOnListeners) fn(from, m.to === this.me.id);
        return;
      }
      case 'pong': {
        const rtt = Date.now() - m.at;
        if (rtt >= 0 && rtt < this.bestRtt) {
          this.bestRtt = rtt;
          this.offset = m.now - (m.at + rtt / 2);
        }
        return;
      }
    }
    this.changed();
  }

  private peerFrom(m: Member, old: Peer | undefined, now: number): Peer {
    const info: MemberInfo = { id: m.id, name: m.name.slice(0, MAX_NAME), weight: m.weight, kit: m.kit, accent: m.accent, bike: m.bike };
    const pos = m.pos ?? old?.pos ?? null;
    return { info, ready: m.ready ?? old?.ready ?? false, pos, at: m.pos ? now : (old?.at ?? now), shown: old?.shown ?? pos?.p ?? 0, err: 0 };
  }

  private ping() {
    this.stopPing();
    let n = 0;
    const once = () => this.send({ t: 'ping', at: Date.now() });
    once();
    // three quick ones for the start clock, then one every 30 s
    this.pingTimer = setInterval(() => {
      once();
      if (++n === 3 && this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(once, 30_000);
      }
    }, 700);
  }

  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private send(m: ClientMsg, ws = this.ws) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  }

  /** Our position, from every ride tick; sent twice a second. */
  update(pos: Pos) {
    const now = performance.now();
    if (now - this.lastSent < POS_INTERVAL_MS) return;
    this.lastSent = now;
    this.send({ t: 'pos', pos: { p: round(pos.p, 10), v: round(pos.v, 100), w: Math.round(pos.w), c: Math.round(pos.c) } });
  }

  /** Host: everyone starts in `delay` seconds. */
  start(delay = 10) {
    if (this.isHost && this.startAt === null) this.send({ t: 'start', delay });
  }

  setReady(ready: boolean) {
    this.ready = ready;
    this.send({ t: 'ready', ready });
    this.changed();
  }

  /** A thumbs-up: to one rider, or to everyone. */
  rideOn(to: string | null) {
    this.send({ t: 'rideon', to });
  }

  onRideOn(fn: (from: PeerView, toMe: boolean) => void): () => void {
    this.rideOnListeners.add(fn);
    return () => this.rideOnListeners.delete(fn);
  }

  /** Our result (at the finish, and when the ride ends): shared with the room, which keeps it. */
  sendResult(r: Result) {
    this.results.set(this.me.id, { ...r, id: this.me.id, name: this.me.name, kit: this.me.kit, weight: this.me.weight });
    this.send({ t: 'result', result: r });
    this.changed();
  }

  /**
   * Where a rider is now: their last position, rolled on at their speed for the time it took to get here (half a
   * round trip) and since.
   */
  private reckon(p: Peer, now: number): number {
    if (!p.pos) return p.shown;
    const travel = this.bestRtt === Infinity ? 0.05 : this.bestRtt / 2000;
    return p.pos.p + p.pos.v * Math.min(MAX_COAST_S, travel + (now - p.at) / 1000);
  }

  /** Move everyone on; `dt` in seconds. */
  tick(dt: number) {
    const now = performance.now();
    const fade = Math.exp(-dt / 0.6);
    for (const p of this.peers.values()) {
      if (!p.pos) continue;
      p.err *= fade;
      p.shown = this.reckon(p, now) + p.err;
    }
  }

  view(): PeerView[] {
    const now = performance.now();
    return [...this.peers.values()].map((p) => ({
      id: p.info.id,
      name: p.info.name,
      kit: p.info.kit,
      accent: p.info.accent,
      bike: p.info.bike,
      weight: p.info.weight,
      p: Math.max(0, p.shown),
      speed: p.pos?.v ?? 0,
      power: p.pos?.w ?? 0,
      cadence: p.pos?.c ?? 0,
      stale: !p.pos || (now - p.at) / 1000 > STALE_S,
      host: p.info.id === this.host,
      ready: p.ready,
    }));
  }

  /** Who a late rider starts next to: the host, or whoever is furthest along. */
  anchor(): PeerView | null {
    const live = this.view().filter((p) => !p.stale);
    return live.find((p) => p.host) ?? live.reduce<PeerView | null>((a, b) => (!a || b.p > a.p ? b : a), null);
  }

  leave() {
    this.left = true;
    this.status = 'closed';
    this.stopPing();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000, 'bye');
    this.listeners.clear();
    this.rideOnListeners.clear();
  }

  routeData(): RouteData | null {
    return this.route ? (this.route.data as RouteData) : null;
  }
}

function round(x: number, k: number): number {
  return Math.round(x * k) / k;
}

/** A rider id for one ride: random, so the relay never sees anything that identifies the Mac. */
export function newRiderId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}
