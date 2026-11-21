// Group rides: what the app and the relay (relay/) say to each other over one WebSocket per rider.
// Everyone in a room rides the same route; a position is the distance along it from the start, turnarounds
// and laps included (sim/session.ts `progress`), so it means the same on every Mac.

/** Bumped when old apps can no longer ride with new ones; the relay turns them away with 'version'. */
export const PROTOCOL = 1;

/** Room codes: no 0/O, 1/I, so they can be read out and typed. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;
export const MAX_RIDERS = 16;
/** Positions go out twice a second; the relay drops anything faster than this. */
export const POS_INTERVAL_MS = 500;
export const MIN_POS_INTERVAL_MS = 200;
/** A custom route travels with the room; the largest preset is about 80 KB. */
export const MAX_ROUTE_BYTES = 600_000;
export const MAX_NAME = 24;

export interface MemberInfo {
  /** Random per ride; a rider who reconnects keeps it. */
  id: string;
  name: string;
  /** kg, for W/kg. */
  weight: number;
  kit: string;
  accent: string;
  bike: string;
}

export interface Pos {
  /** Metres along the route from the start, turnarounds and laps included. */
  p: number;
  /** Speed, m/s. */
  v: number;
  /** Power, W. */
  w: number;
  /** Cadence, rpm. */
  c: number;
}

export interface RoomRoute {
  /**
   * The route as the host has it (a geo/route.ts RouteData; only what the relay checks is typed here, so the
   * relay builds without the app's DOM code).
   */
  data: { id: string; name: string; coords: number[][] };
  /** Ride the route's easy lead-in (everyone must, or the distances differ). */
  leadIn: boolean;
}

export interface Member extends MemberInfo {
  pos: Pos | null;
}

export type ClientMsg =
  | { t: 'hello'; v: number; me: MemberInfo; create?: RoomRoute }
  | { t: 'pos'; pos: Pos }
  /** Host only: everyone starts `delay` seconds from now. */
  | { t: 'start'; delay: number }
  | { t: 'ping'; at: number };

export type ErrorCode = 'no-room' | 'taken' | 'full' | 'version' | 'bad';

export type ServerMsg =
  | { t: 'room'; code: string; host: string; route: RoomRoute; startAt: number | null; now: number; members: Member[] }
  | { t: 'join'; member: Member }
  | { t: 'leave'; id: string; host: string }
  | { t: 'pos'; id: string; pos: Pos }
  | { t: 'start'; startAt: number; now: number }
  | { t: 'pong'; at: number; now: number }
  | { t: 'error'; code: ErrorCode };

export function isCode(c: string): boolean {
  if (c.length !== CODE_LENGTH) return false;
  for (const ch of c) if (!CODE_ALPHABET.includes(ch)) return false;
  return true;
}

/** What someone typed, in lower case or with spaces and dashes. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

export function randomCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return s;
}
