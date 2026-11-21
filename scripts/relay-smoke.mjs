// Two riders against a running relay: node scripts/relay-smoke.mjs [wss://…]
const base = process.argv[2] ?? 'wss://serpentine-relay.skyline-media.workers.dev';
const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join('');
const route = { data: { id: 'smoke', name: 'Smoke', coords: [[13, 47, 500], [13.01, 47, 520]] }, leadIn: false };
const rider = (id, name) => ({ id: `smoke-${id}-${Date.now()}`, name, weight: 70, kit: '#2f7de1', accent: '#ffffff', bike: '#000000' });
function open(hello) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`${base}/room/${code}`);
    const inbox = [];
    ws.onmessage = (e) => inbox.push(JSON.parse(e.data));
    ws.onopen = () => { ws.send(JSON.stringify(hello)); res({ ws, inbox }); };
    ws.onerror = rej;
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const h = await open({ t: 'hello', v: 1, me: rider('h', 'Host'), create: route });
await wait(600);
const g = await open({ t: 'hello', v: 1, me: rider('g', 'Guest') });
await wait(600);
h.ws.send(JSON.stringify({ t: 'pos', pos: { p: 42, v: 7, w: 220, c: 90 } }));
g.ws.send(JSON.stringify({ t: 'ping', at: Date.now() }));
h.ws.send(JSON.stringify({ t: 'start', delay: 5 }));
await wait(800);
console.log('code', code);
console.log('host got', h.inbox.map((m) => m.t).join(','));
console.log('guest got', g.inbox.map((m) => m.t).join(','));
const pong = g.inbox.find((m) => m.t === 'pong');
console.log('guest sees host pos', JSON.stringify(g.inbox.find((m) => m.t === 'pos')?.pos), 'rtt ms', pong ? Date.now() - pong.at : null);
const st = g.inbox.find((m) => m.t === 'start');
console.log('start in', st ? st.startAt - st.now : null, 'ms');
h.ws.close();
await wait(800);
console.log('guest after host left', JSON.stringify(g.inbox.at(-1)));
g.ws.close();
console.log('total', Date.now() - t0, 'ms');
