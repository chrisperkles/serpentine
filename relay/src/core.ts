// One group-ride room, without Cloudflare: the Durable Object (index.ts) hands it sockets and storage, the
// tests (scripts/test-relay.ts) hand it fakes. The relay keeps no rides and no history: who is in the room,
// where they are, and the route, gone 15 minutes after the last rider leaves.

import {
  DEFAULT_OPTIONS, MAX_NAME, MAX_RIDERS, MAX_ROUTE_BYTES, MIN_POS_INTERVAL_MS, PROTOCOL,
  type ClientMsg, type ErrorCode, type Member, type MemberInfo, type MemberResult, type Pos, type Result, type RoomInfo,
  type RoomOptions, type RoomRoute, type ServerMsg,
} from '../../src/net/protocol.ts';

/** What the relay keeps on a socket (Cloudflare: its attachment, so it survives hibernation). */
export interface ConnState {
  code: string;
  member?: { info: MemberInfo; pos: Pos | null; joined: number; posAt: number; ready: boolean; rideonAt?: number; resultAt?: number };
  /** Replaced by a newer socket of the same rider, or closed: no longer in the room. */
  gone?: boolean;
}

export interface Conn {
  send(data: string): void;
  close(code: number, reason: string): void;
  state(): ConnState;
  setState(s: ConnState): void;
}

export interface RoomMeta {
  code: string;
  host: string;
  route: RoomRoute;
  options: RoomOptions;
  startAt: number | null;
  created: number;
  /** By rider id; kept when the rider leaves, so a late finisher still sees who was faster. */
  results: Record<string, MemberResult>;
}

export interface RoomStore {
  getMeta(): Promise<RoomMeta | undefined>;
  putMeta(m: RoomMeta): Promise<void>;
  clear(): Promise<void>;
  setAlarm(at: number): Promise<void>;
}

/** An empty room waits this long for someone to come back (a dropped Wi-Fi, a restarted app). */
export const EMPTY_ROOM_MS = 15 * 60_000;

export class RoomCore {
  private store: RoomStore;
  private conns: () => Conn[];
  private now: () => number;

  constructor(store: RoomStore, conns: () => Conn[], now: () => number = Date.now) {
    this.store = store;
    this.conns = conns;
    this.now = now;
  }

  private members(except?: Conn): Conn[] {
    return this.conns().filter((c) => c !== except && !!c.state().member && !c.state().gone);
  }

  private send(c: Conn, m: ServerMsg) {
    c.send(JSON.stringify(m));
  }

  private broadcast(m: ServerMsg, except?: Conn) {
    const data = JSON.stringify(m);
    for (const c of this.members(except)) c.send(data);
  }

  private fail(c: Conn, code: ErrorCode) {
    this.send(c, { t: 'error', code });
    c.setState({ ...c.state(), gone: true });
    c.close(4000, code);
  }

  async message(c: Conn, raw: string) {
    const st = c.state();
    if (st.gone) return;
    if (raw.length > (st.member ? 2048 : MAX_ROUTE_BYTES + 4096)) return this.fail(c, 'bad');
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw) as ClientMsg;
    } catch {
      return this.fail(c, 'bad');
    }
    if (!msg || typeof msg !== 'object') return this.fail(c, 'bad');
    if (msg.t === 'ping') return this.send(c, { t: 'pong', at: num(msg.at, 0, Number.MAX_SAFE_INTEGER), now: this.now() });
    if (msg.t === 'hello') return this.hello(c, msg);
    const m = st.member;
    if (!m) return this.fail(c, 'bad');
    if (msg.t === 'ready') {
      c.setState({ ...st, member: { ...m, ready: !!msg.ready } });
      this.broadcast({ t: 'ready', id: m.info.id, ready: !!msg.ready }, c);
    } else if (msg.t === 'rideon') {
      const now = this.now();
      if (now - (m.rideonAt ?? 0) < 1500) return;
      c.setState({ ...st, member: { ...m, rideonAt: now } });
      const to = typeof msg.to === 'string' ? msg.to.slice(0, 40) : null;
      this.broadcast({ t: 'rideon', from: m.info.id, to }, c);
    } else if (msg.t === 'result') {
      const now = this.now();
      if (now - (m.resultAt ?? 0) < 1000) return;
      const r = cleanResult(msg.result);
      const meta = await this.store.getMeta();
      if (!r || !meta) return;
      c.setState({ ...st, member: { ...m, resultAt: now } });
      const result: MemberResult = { ...r, id: m.info.id, name: m.info.name, kit: m.info.kit, weight: m.info.weight };
      meta.results = { ...meta.results, [m.info.id]: result };
      await this.store.putMeta(meta);
      this.broadcast({ t: 'result', result }, c);
    } else if (msg.t === 'pos') {
      const now = this.now();
      if (now - m.posAt < MIN_POS_INTERVAL_MS) return;
      const pos = cleanPos(msg.pos);
      if (!pos) return;
      c.setState({ ...st, member: { ...m, pos, posAt: now } });
      this.broadcast({ t: 'pos', id: m.info.id, pos }, c);
    } else if (msg.t === 'start') {
      const meta = await this.store.getMeta();
      if (!meta || meta.host !== m.info.id) return;
      if (meta.startAt === null) {
        meta.startAt = this.now() + num(msg.delay, 3, 30) * 1000;
        await this.store.putMeta(meta);
      }
      this.broadcast({ t: 'start', startAt: meta.startAt, now: this.now() });
    }
  }

  private async hello(c: Conn, msg: Extract<ClientMsg, { t: 'hello' }>) {
    const st = c.state();
    if (st.member) return;
    if (msg.v !== PROTOCOL) return this.fail(c, 'version');
    const info = cleanInfo(msg.me);
    if (!info) return this.fail(c, 'bad');
    let meta = await this.store.getMeta();
    const now = this.now();
    // the same rider on a new socket (a reconnect) replaces the old one and keeps their place
    const old = this.members(c).filter((o) => o.state().member!.info.id === info.id);
    const others = this.members(c).filter((o) => !old.includes(o));
    if (msg.create) {
      if (meta && others.length) return this.fail(c, 'taken');
      const route = cleanRoute(msg.create);
      if (!route) return this.fail(c, 'bad');
      meta = { code: st.code, host: info.id, route, options: cleanOptions(msg.options), startAt: null, created: now, results: {} };
      await this.store.putMeta(meta);
    } else if (!meta) return this.fail(c, 'no-room');
    if (others.length >= MAX_RIDERS) return this.fail(c, 'full');
    for (const o of old) {
      o.setState({ ...o.state(), gone: true });
      o.close(4000, 'replaced');
    }
    // the room was empty (everyone dropped): whoever comes back first leads it
    if (!others.some((o) => o.state().member!.info.id === meta.host) && meta.host !== info.id) {
      meta.host = info.id;
      await this.store.putMeta(meta);
    }
    const prev = old[0]?.state().member;
    const member = { info, pos: null, joined: prev?.joined ?? now, posAt: 0, ready: prev?.ready ?? false };
    c.setState({ ...st, member });
    const members: Member[] = [...others, c].map((o) => {
      const x = o.state().member!;
      return { ...x.info, pos: x.pos, ready: x.ready };
    });
    this.send(c, {
      t: 'room', code: meta.code, host: meta.host, route: meta.route, options: meta.options ?? DEFAULT_OPTIONS, startAt: meta.startAt, now,
      members, results: Object.values(meta.results ?? {}),
    });
    this.broadcast({ t: 'join', member: { ...info, pos: null, ready: member.ready } }, c);
  }

  async closed(c: Conn) {
    const st = c.state();
    if (st.gone || !st.member) return;
    c.setState({ ...st, gone: true });
    const id = st.member.info.id;
    const left = this.members(c);
    // replaced by a newer socket that is already in
    if (left.some((o) => o.state().member!.info.id === id)) return;
    const meta = await this.store.getMeta();
    if (!meta) return;
    if (meta.host === id && left.length) {
      const next = left.reduce((a, b) => (b.state().member!.joined < a.state().member!.joined ? b : a));
      meta.host = next.state().member!.info.id;
      await this.store.putMeta(meta);
    }
    this.broadcast({ t: 'leave', id, host: meta.host });
    if (!left.length) await this.store.setAlarm(this.now() + EMPTY_ROOM_MS);
  }

  /** For the invite page: what the room is, without anyone's position. */
  async info(): Promise<RoomInfo | null> {
    const meta = await this.store.getMeta();
    if (!meta) return null;
    const riders = this.members();
    const host = riders.find((c) => c.state().member!.info.id === meta.host)?.state().member!.info.name ?? '';
    return {
      code: meta.code, route: meta.route.data.name, host, riders: riders.length,
      started: meta.startAt !== null && meta.startAt <= this.now(), mode: (meta.options ?? DEFAULT_OPTIONS).mode,
    };
  }

  /** The empty-room timer: forget the room unless someone came back. */
  async alarm() {
    if (!this.members().length) await this.store.clear();
  }
}

function num(v: unknown, lo: number, hi: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : lo;
  return Math.min(hi, Math.max(lo, n));
}

function str(v: unknown, max: number): string {
  // no control characters: names end up on canvases and in the HUD
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';
}

function colour(v: unknown, fallback: string): string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
}

function cleanInfo(v: unknown): MemberInfo | null {
  if (!v || typeof v !== 'object') return null;
  const m = v as Partial<MemberInfo>;
  const id = str(m.id, 40);
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) return null;
  return {
    id,
    name: str(m.name, MAX_NAME) || 'Rider',
    weight: num(m.weight, 30, 200),
    kit: colour(m.kit, '#e8442e'),
    accent: colour(m.accent, '#f4efe6'),
    bike: colour(m.bike, '#16181c'),
  };
}

function cleanPos(v: unknown): Pos | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Partial<Pos>;
  if (typeof p.p !== 'number' || !Number.isFinite(p.p)) return null;
  return { p: num(p.p, 0, 10_000_000), v: num(p.v, 0, 40), w: Math.round(num(p.w, 0, 3000)), c: Math.round(num(p.c, 0, 250)) };
}

function cleanOptions(v: unknown): RoomOptions {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<RoomOptions>;
  const mode = o.mode === 'race' ? 'race' : 'ride';
  // a race is everyone's own watts
  return { mode, together: mode === 'ride' && !!o.together };
}

function cleanResult(v: unknown): Result | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Partial<Result>;
  const finish = typeof r.finish === 'number' && Number.isFinite(r.finish) ? num(r.finish, 0, 86_400) : null;
  return {
    finish, time: num(r.time, 0, 86_400), distance: num(r.distance, 0, 1_000_000), gain: num(r.gain, 0, 50_000),
    avgPower: num(r.avgPower, 0, 3000), done: !!r.done, late: !!r.late,
  };
}

function cleanRoute(v: unknown): RoomRoute | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Partial<RoomRoute>;
  const d = r.data;
  if (!d || typeof d !== 'object' || typeof d.id !== 'string' || typeof d.name !== 'string' || !Array.isArray(d.coords) || d.coords.length < 2) return null;
  if (!d.coords.every((c) => Array.isArray(c) && c.length >= 2 && c.every((x) => typeof x === 'number' && Number.isFinite(x)))) return null;
  return { data: d, leadIn: !!r.leadIn };
}
