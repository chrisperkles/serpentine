// Serpentine's group-ride relay on Cloudflare: GET /room/<CODE> upgrades to a WebSocket held by that room's
// Durable Object. Hibernating sockets: the object sleeps between messages and pays for nothing while it does,
// so everything it needs lives in the socket attachments and in storage (core.ts).

import { DurableObject } from 'cloudflare:workers';
import { isCode, type RoomInfo } from '../../src/net/protocol.ts';
import { invitePage } from './invite.ts';
import { RoomCore, type Conn, type ConnState } from './core.ts';

interface Env {
  ROOMS: DurableObjectNamespace<Room>;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/') return new Response('Serpentine relay: group rides for https://github.com/chrisperkles/serpentine\n');
    // the link a leader sends: a page that opens the app on this room
    const invite = /^\/join\/([A-Za-z0-9]+)$/.exec(url.pathname)?.[1]?.toUpperCase();
    if (invite) {
      if (!isCode(invite)) return new Response('Not found', { status: 404 });
      const res = await env.ROOMS.get(env.ROOMS.idFromName(invite)).fetch(`https://room/room/${invite}/info`);
      const info = res.ok ? ((await res.json()) as RoomInfo | null) : null;
      return new Response(invitePage(invite, info), {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:" },
      });
    }
    const code = /^\/room\/([A-Z0-9]+)$/.exec(url.pathname)?.[1];
    if (!code || !isCode(code)) return new Response('Not found', { status: 404 });
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
  },
} satisfies ExportedHandler<Env>;

export class Room extends DurableObject<Env> {
  private wrapped = new WeakMap<WebSocket, Conn>();
  private core: RoomCore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.core = new RoomCore(
      {
        getMeta: () => this.ctx.storage.get('meta'),
        putMeta: (m) => this.ctx.storage.put('meta', m),
        clear: () => this.ctx.storage.deleteAll(),
        setAlarm: (at) => this.ctx.storage.setAlarm(at),
      },
      () => this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN).map((ws) => this.conn(ws)),
    );
  }

  /** One wrapper per socket, so the core can tell sockets apart by identity. */
  private conn(ws: WebSocket): Conn {
    let c = this.wrapped.get(ws);
    if (!c) {
      c = {
        send: (data) => {
          try {
            ws.send(data);
          } catch {
            /* closing */
          }
        },
        close: (code, reason) => {
          try {
            ws.close(code, reason);
          } catch {
            /* already closed */
          }
        },
        state: () => (ws.deserializeAttachment() as ConnState | null) ?? { code: '', gone: true },
        setState: (s) => ws.serializeAttachment(s),
      };
      this.wrapped.set(ws, c);
    }
    return c;
  }

  async fetch(req: Request): Promise<Response> {
    const parts = new URL(req.url).pathname.split('/');
    const code = parts[2];
    if (parts[3] === 'info') return Response.json(await this.core.info());
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ code } satisfies ConnState);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return this.conn(ws).close(4000, 'bad');
    await this.core.message(this.conn(ws), message);
  }

  async webSocketClose(ws: WebSocket) {
    await this.core.closed(this.conn(ws));
  }

  async webSocketError(ws: WebSocket) {
    await this.core.closed(this.conn(ws));
  }

  async alarm() {
    await this.core.alarm();
  }
}
