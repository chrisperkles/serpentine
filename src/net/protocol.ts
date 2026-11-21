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

/** How the leader set the room up. */
export interface RoomOptions {
  /** 'race': a finish at the end of the route (the top, or one lap), places and results; 'ride': together. */
  mode: 'ride' | 'race';
  /** Group ride only: everyone is held to the group's pace, the watts stay each rider's own. */
  together: boolean;
}

export const DEFAULT_OPTIONS: RoomOptions = { mode: 'ride', together: false };

/** A rider's result, sent at the finish (or the top) and when they end their ride. */
export interface Result {
  /** Seconds from the group's start to the finish line (the end of the route); null = not there. */
  finish: number | null;
  /** The rider's own ride so far: moving time, metres, metres up, average watts. */
  time: number;
  distance: number;
  gain: number;
  avgPower: number;
  /** Ended their ride. */
  done: boolean;
  /** Started after the group: a race doesn't rank them. */
  late: boolean;
}

export interface MemberResult extends Result {
  id: string;
  name: string;
  kit: string;
  weight: number;
}

export interface Member extends MemberInfo {
  pos: Pos | null;
  ready: boolean;
}

/** What the invite page shows about a room (GET /room/<CODE>/info). */
export interface RoomInfo {
  code: string;
  route: string;
  host: string;
  riders: number;
  started: boolean;
  mode: RoomOptions['mode'];
}

export type ClientMsg =
  | { t: 'hello'; v: number; me: MemberInfo; create?: RoomRoute; options?: RoomOptions }
  | { t: 'pos'; pos: Pos }
  /** Host only: everyone starts `delay` seconds from now. */
  | { t: 'start'; delay: number }
  | { t: 'ready'; ready: boolean }
  /** A thumbs-up to one rider, or to everyone (null). */
  | { t: 'rideon'; to: string | null }
  | { t: 'result'; result: Result }
  | { t: 'ping'; at: number };

export type ErrorCode = 'no-room' | 'taken' | 'full' | 'version' | 'bad';

export type ServerMsg =
  | {
    t: 'room'; code: string; host: string; route: RoomRoute; options: RoomOptions; startAt: number | null; now: number;
    members: Member[]; results: MemberResult[];
  }
  | { t: 'join'; member: Member }
  | { t: 'ready'; id: string; ready: boolean }
  | { t: 'rideon'; from: string; to: string | null }
  | { t: 'result'; result: MemberResult }
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

/** What someone typed or pasted: the code, in lower case or with spaces and dashes, or an invite link with it. */
export function normalizeCode(input: string): string {
  const link = /\/join\/([A-Za-z0-9]{5})/.exec(input);
  return (link ? link[1] : input).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

/** The link a leader sends: a page on the relay that opens the app (serpentine://join/<CODE>). */
export function inviteLink(relayWs: string, code: string): string {
  return `${relayWs.replace(/^ws/, 'http')}/join/${code}`;
}

export function randomCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return s;
}
