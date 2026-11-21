// The group-ride room (relay/src/core.ts) with fake sockets and storage: node scripts/test-relay.ts

import assert from 'node:assert/strict';
import { EMPTY_ROOM_MS, RoomCore, type Conn, type ConnState, type RoomMeta } from '../relay/src/core.ts';
import { MAX_RIDERS, PROTOCOL, normalizeCode, isCode, type ServerMsg } from '../src/net/protocol.ts';

let now = 1_000_000;
let meta: RoomMeta | undefined;
let alarmAt: number | null = null;
const open: FakeConn[] = [];

class FakeConn implements Conn {
  inbox: ServerMsg[] = [];
  closed: string | null = null;
  private st: ConnState;
  constructor(code: string) {
    this.st = { code };
    open.push(this);
  }
  send(data: string) {
    this.inbox.push(JSON.parse(data) as ServerMsg);
  }
  close(_code: number, reason: string) {
    this.closed = reason;
    open.splice(open.indexOf(this), 1);
  }
  state() {
    return this.st;
  }
  setState(s: ConnState) {
    this.st = s;
  }
  last<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }> | undefined {
    return [...this.inbox].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined;
  }
}

const room = new RoomCore(
  {
    getMeta: async () => (meta ? structuredClone(meta) : undefined),
    putMeta: async (m) => void (meta = structuredClone(m)),
    clear: async () => void (meta = undefined),
    setAlarm: async (at) => void (alarmAt = at),
  },
  () => [...open],
  () => now,
);

const route = { data: { id: 'gaisberg', name: 'Gaisberg', coords: [[13.1, 47.8, 500], [13.2, 47.8, 1200]] }, leadIn: true };
const me = (id: string, name = id) => ({ id: `rider-${id}`, name, weight: 75, kit: '#2f7de1', accent: '#ffffff', bike: '#000000' });
const say = (c: FakeConn, m: unknown) => room.message(c, JSON.stringify(m));

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`ok ${name}`);
}

const host = new FakeConn('ABCDE');
const guest = new FakeConn('ABCDE');

await test('codes: typed codes are cleaned, look-alike letters are not codes', async () => {
  assert.equal(normalizeCode(' abc-de '), 'ABCDE');
  assert.ok(isCode('ABCDE'));
  assert.ok(!isCode('ABCD0'));
  assert.ok(!isCode('ABCDI'));
});

await test('a guest cannot join a room nobody made', async () => {
  const c = new FakeConn('ABCDE');
  await say(c, { t: 'hello', v: PROTOCOL, me: me('lost') });
  assert.deepEqual(c.last('error'), { t: 'error', code: 'no-room' });
  assert.equal(c.closed, 'no-room');
});

await test('the host makes the room and gets it back with the route', async () => {
  await say(host, { t: 'hello', v: PROTOCOL, me: me('host', 'Chris'), create: route });
  const r = host.last('room')!;
  assert.equal(r.code, 'ABCDE');
  assert.equal(r.host, 'rider-host');
  assert.equal(r.route.data.id, 'gaisberg');
  assert.equal(r.route.leadIn, true);
  assert.equal(r.startAt, null);
  assert.deepEqual(r.members.map((m) => m.name), ['Chris']);
});

await test('a guest joins, sees the host, and the host hears of it', async () => {
  await say(guest, { t: 'hello', v: PROTOCOL, me: me('guest', 'Max') });
  const r = guest.last('room')!;
  assert.deepEqual(r.members.map((m) => m.name).sort(), ['Chris', 'Max']);
  assert.equal(r.host, 'rider-host');
  assert.equal(host.last('join')!.member.name, 'Max');
});

await test('someone else cannot make a room under a code in use', async () => {
  const c = new FakeConn('ABCDE');
  await say(c, { t: 'hello', v: PROTOCOL, me: me('other'), create: route });
  assert.deepEqual(c.last('error'), { t: 'error', code: 'taken' });
  assert.equal(meta!.host, 'rider-host');
});

await test('an old app is turned away', async () => {
  const c = new FakeConn('ABCDE');
  await say(c, { t: 'hello', v: PROTOCOL + 99, me: me('old') });
  assert.deepEqual(c.last('error'), { t: 'error', code: 'version' });
});

await test('positions go to everyone else, not back, and not faster than 5 a second', async () => {
  now += 1000;
  await say(host, { t: 'pos', pos: { p: 120.5, v: 8.2, w: 250, c: 88 } });
  assert.deepEqual(guest.last('pos'), { t: 'pos', id: 'rider-host', pos: { p: 120.5, v: 8.2, w: 250, c: 88 } });
  assert.equal(host.last('pos'), undefined);
  now += 50;
  await say(host, { t: 'pos', pos: { p: 999, v: 8, w: 250, c: 88 } });
  assert.equal(guest.last('pos')!.pos.p, 120.5);
});

await test('nonsense positions and names are cleaned or dropped', async () => {
  now += 1000;
  await say(host, { t: 'pos', pos: { p: 'x', v: 1, w: 1, c: 1 } });
  assert.equal(guest.last('pos')!.pos.p, 120.5);
  await say(host, { t: 'pos', pos: { p: 130, v: 900, w: -5, c: 80.6 } });
  assert.deepEqual(guest.last('pos')!.pos, { p: 130, v: 40, w: 0, c: 81 });
  const c = new FakeConn('ABCDE');
  await say(c, { t: 'hello', v: PROTOCOL, me: { ...me('weird'), name: 'Evil\u0007Name that is far too long for a tag', kit: 'red;}' } });
  const j = host.last('join')!.member;
  assert.equal(j.name, 'EvilName that is far too');
  assert.equal(j.kit, '#e8442e');
  await room.closed(c);
  open.splice(open.indexOf(c), 1);
});

await test('a late joiner gets where everyone is', async () => {
  const c = new FakeConn('ABCDE');
  await say(c, { t: 'hello', v: PROTOCOL, me: me('late', 'Late') });
  const h = c.last('room')!.members.find((m) => m.id === 'rider-host')!;
  assert.equal(h.pos!.p, 130);
  await room.closed(c);
  open.splice(open.indexOf(c), 1);
});

await test('only the host starts, and everyone gets the same start time', async () => {
  await say(guest, { t: 'start', delay: 10 });
  assert.equal(meta!.startAt, null);
  await say(host, { t: 'start', delay: 10 });
  assert.equal(meta!.startAt, now + 10_000);
  assert.equal(guest.last('start')!.startAt, now + 10_000);
  assert.equal(host.last('start')!.startAt, now + 10_000);
  // a second press does not move it
  now += 3000;
  await say(host, { t: 'start', delay: 10 });
  assert.equal(meta!.startAt, now - 3000 + 10_000);
});

await test('ping answers with the relay clock', async () => {
  await say(guest, { t: 'ping', at: 42 });
  assert.deepEqual(guest.last('pong'), { t: 'pong', at: 42, now });
});

await test('a rider who reconnects replaces the old socket without leaving', async () => {
  const again = new FakeConn('ABCDE');
  host.inbox = [];
  await say(again, { t: 'hello', v: PROTOCOL, me: me('guest', 'Max') });
  assert.equal(again.last('room')!.members.length, 2);
  assert.equal(open.filter((c) => c.state().member?.info.id === 'rider-guest' && !c.state().gone).length, 1);
  assert.equal(guest.closed, 'replaced');
  await room.closed(guest);
  assert.equal(host.last('leave'), undefined);
  guest.inbox = again.inbox;
  Object.assign(guest, { st: again.state() });
  open.splice(open.indexOf(again), 1, guest);
  guest.closed = null;
});

await test('when the host leaves, the next rider leads', async () => {
  await room.closed(host);
  open.splice(open.indexOf(host), 1);
  assert.deepEqual(guest.last('leave'), { t: 'leave', id: 'rider-host', host: 'rider-guest' });
  assert.equal(meta!.host, 'rider-guest');
  assert.equal(alarmAt, null);
});

await test('an empty room waits 15 minutes, then is forgotten', async () => {
  await room.closed(guest);
  open.splice(open.indexOf(guest), 1);
  assert.equal(alarmAt, now + EMPTY_ROOM_MS);
  // someone comes back in time: the room is still there, and they lead it
  const back = new FakeConn('ABCDE');
  await say(back, { t: 'hello', v: PROTOCOL, me: me('host', 'Chris') });
  assert.equal(back.last('room')!.host, 'rider-host');
  await room.alarm();
  assert.ok(meta);
  await room.closed(back);
  open.splice(open.indexOf(back), 1);
  await room.alarm();
  assert.equal(meta, undefined);
});

await test(`a room takes ${MAX_RIDERS} riders`, async () => {
  const h = new FakeConn('FGHJK');
  await say(h, { t: 'hello', v: PROTOCOL, me: me('h0'), create: route });
  for (let i = 1; i < MAX_RIDERS; i++) await say(new FakeConn('FGHJK'), { t: 'hello', v: PROTOCOL, me: me(`h${i}`) });
  const extra = new FakeConn('FGHJK');
  await say(extra, { t: 'hello', v: PROTOCOL, me: me('extra') });
  assert.deepEqual(extra.last('error'), { t: 'error', code: 'full' });
});

await test('a broken route or message is refused', async () => {
  meta = undefined;
  open.length = 0;
  const c = new FakeConn('LMNPQ');
  await say(c, { t: 'hello', v: PROTOCOL, me: me('x'), create: { data: { id: 'x', name: 'x', coords: [[1, 'a']] }, leadIn: false } });
  assert.deepEqual(c.last('error'), { t: 'error', code: 'bad' });
  const d = new FakeConn('LMNPQ');
  await room.message(d, '{not json');
  assert.deepEqual(d.last('error'), { t: 'error', code: 'bad' });
});

console.log(`${passed} relay tests passed`);
