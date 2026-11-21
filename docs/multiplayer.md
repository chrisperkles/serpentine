# Ride together (group rides)

Friends on their own Macs and trainers ride the same route at the same time and see each other: their kit, a
name tag with W/kg, the gap in metres, a dot on the minimap, and the draft (30 % less drag 0.5–7 m behind someone,
the same as behind a pacer).

## Riding

1. **Lead:** on Home pick the route (and the lead-in setting), then **Ride together → Start a group ride**. The ride
   loads and waits at the start with a five-letter code. Send it to your friends.
2. **Join:** **Ride together → Join a friend**, type the code. The route and its lead-in are the leader's; free ride,
   workout or hold watts are each rider's own.
3. In the waiting room everyone can pedal to warm up; the ride doesn't start. The leader presses **Start the ride
   for everyone** (Space, or A on a Zwift Ride) and everyone gets the same 10 s countdown, then sets off together.
4. **Late:** a rider who arrives after the start begins next to the leader (or whoever is furthest along) when they
   pedal, or at the beginning if they choose. Their own ride still counts from zero.
5. Each ride is saved, uploaded and timed as always; the group doesn't change History or Strava. **End ride**
   leaves the group. If the leader leaves, the rider who joined first leads.

A lost connection doesn't stop the ride: the app keeps trying (1, 2, 4 … 15 s) and the room keeps your place. Other
riders without a position for 10 s are hidden until they're back. A room is forgotten 15 minutes after the last
rider leaves. Up to 16 riders per room.

## How it works

- **One position for everyone:** the distance along the route from its start, turnarounds and laps included
  (`RideSession.progress`: `distance` plus an offset for a late start). `positionAt` turns it into a place on each
  rider's own copy of the route, which is identical because the room carries the route itself (`RoomRoute`, presets
  and drawn or imported routes alike) and the lead-in flag.
- **The wire** (`src/net/protocol.ts`): JSON over one WebSocket per rider. `hello` (name, weight, kit colours, a
  random id per ride; the host also sends the route), `pos` twice a second (progress, speed, watts, cadence),
  `start` (host only), `ping`. The relay answers `room` (everyone, the route, the start time, its clock), `join`,
  `leave` (with the new host), `pos`, `start`, `pong`, `error`. `PROTOCOL` is bumped when old apps can no longer ride
  with new ones; the relay then turns them away with a message to update.
- **Between positions** (`src/net/group.ts`): each rider rolls on at their last speed for the time since (plus half
  a round trip), up to 2 s. A new position corrects that, and the correction fades over 0.6 s. Easing the position
  itself instead would show a moving rider `speed × tau` behind (4 m at 30 km/h): the first test saw 12 m one way and
  4 m the other for a real 8 m gap.
- **The start:** the relay's clock decides. Three pings on joining (then one every 30 s) estimate its offset from the
  one with the shortest round trip; the host's `start` becomes `startAt = relay now + 10 s` for everyone.
- **Rendering** (`Engine.updateGroupRiders`): a Rider model per rider in their kit, a name tag (1.5× a pacer's,
  W/kg redrawn at most once a second), lanes 0.8 / 2.5 / 0.05 m right of the centre line (we start at 1.7), a row
  further back from the fourth rider, and anyone level with us steps out of our lane.
- **The relay** (`relay/`): a Cloudflare Worker, one Durable Object per room code (`idFromName`), hibernating
  WebSockets, so a room costs nothing between messages. What it knows lives in the socket attachments (who, last
  position) and in storage (route, host, start time), deleted by an alarm 15 minutes after the room empties. It
  cleans names (no control characters, 24 characters), colours, numbers, and drops positions faster than 5 a
  second. `relay/src/core.ts` is the room without Cloudflare, tested with fake sockets in `scripts/test-relay.ts`.
- **Privacy:** the relay sees the name, weight, kit colours and position of riders in a room, nothing else, and
  keeps nothing once the room is gone. No accounts, no list of rooms: you can only join with a code.

## Running and deploying the relay

```sh
cd relay
npm install
npm run dev                     # local relay on ws://127.0.0.1:8787
npm run typecheck
npx wrangler login              # once
npm run deploy                  # https://serpentine-relay.skyline-media.workers.dev
```

The app uses `DEFAULT_RELAY` in `src/net/group.ts`; `?relay=ws://127.0.0.1:8787` points a dev page at a local one.

## Testing

- `node scripts/test-relay.ts` (in `npm test`): the room's rules with fake sockets.
- `node scripts/relay-smoke.mjs [wss://…]`: two riders against a running relay (create, join, position, start, leave).
- `PORT=5299 node scripts/e2e-group.mjs [ws://…]`: three headless Chromes on the keyboard simulator: host and guest
  in the waiting room, the countdown, both riding (gaps checked against the real distance, within 3 m), a late rider
  starting next to the host, the host leaving. Screenshots in `shots/group-*.png`.
- Test starts: `?ride=<preset>&group=new&sim=1` opens a room, `?group=<CODE>&sim=1` joins one.

## Next

- Races: a finish line and results for everyone (the segment timing is there), and a ready check.
- Keep together for different FTPs (Zwift's meetups): the speed of the group for everyone, watts still yours.
- Group workouts: the leader's workout for everyone, in ERG.
- Ghost files: share a ride, it rides with you (no relay needed).
- On the island: everyone in one world instead of on one route.
