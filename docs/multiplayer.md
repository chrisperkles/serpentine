# Ride together (group rides)

Friends on their own Macs and trainers ride the same route at the same time and see each other: their kit, a
name tag with W/kg, the gap in metres, a dot on the minimap, and the draft (30 % less drag 0.5–7 m behind someone,
the same as behind a pacer). A group ride can keep everyone together; a race has places, a finish and results.

## Riding

1. **Lead:** on Home pick the route (and the lead-in setting), then **Ride together**, choose **Group ride** (with or
   without **Keep everyone together**) or **Race**, and start it. The ride loads and waits at the start with a
   five-letter code and **Copy invite link**. Send the link (WhatsApp makes it clickable): it opens a page on the relay
   that opens Serpentine (`serpentine://join/<CODE>`) and joins by itself. The code works too.
2. **Join:** the link, or **Ride together → Join a friend** and the code (a pasted link works there too). The route
   and its lead-in are the leader's; free ride, workout or hold watts are each rider's own.
3. In the waiting room everyone can pedal to warm up; the ride doesn't start. Riders say **I'm ready** (Space or A);
   the leader sees "3 of 4 ready" and presses **Start** (Space or A), and everyone gets the same 10 s countdown.
4. **Late:** in a group ride, a rider who arrives after the start begins next to the leader (or whoever is furthest
   along) when they pedal, or at the beginning if they choose. In a race they start at the beginning, unranked.
5. **Ride-ons:** R, the 👍 in the group list, or Z on a Zwift Ride outside a workout sends a thumbs-up to the
   nearest rider (within 200 m; nobody near, to everyone). It pops up on their screen with a sound, and on your name tag.
6. Each ride is saved, uploaded and timed as always; the group doesn't change History or Strava. **End ride** shows
   the summary with the group's results, which keep coming in while the others still ride; leaving the summary leaves
   the group. If the leader leaves, the rider who joined first leads.

### Keep together

Like Zwift's meetups: everyone is held to the group's pace, the watts stay their own and the trainer still feels the
road. The group's middle is the median of everyone pedalling within 500 m; within 1.5 m of it nothing happens,
further away you are pulled along (behind) or held back (ahead) at 0.6 m/s per metre, at most a third of your speed.
300 W and 180 W on a 4 % climb end up about 6 m apart, inside the draft. Not pedalling, nobody tows you. The HUD says
when the group pulls you; your ride's distance and speed include the pull (`RideSession.groupPull`, `moveSpeed`).

### Races

The finish is the end of the route: the top on a climb, one lap on a loop. Places are live in the group list (finished
riders by time, the rest by how far along they are); at the finish a banner says the place and the gap to the winner.
Times run on the relay's clock from the start, so a pause costs time. Riders who joined after the start are not ranked.

A lost connection doesn't stop the ride: the app keeps trying (1, 2, 4 … 15 s) and the room keeps your place. Other
riders without a position for 10 s are hidden until they're back. A room is forgotten 15 minutes after the last
rider leaves. Up to 16 riders per room.

## How it works

- **One position for everyone:** the distance along the route from its start, turnarounds and laps included
  (`RideSession.progress`: `distance` plus an offset for a late start). `positionAt` turns it into a place on each
  rider's own copy of the route, which is identical because the room carries the route itself (`RoomRoute`, presets
  and drawn or imported routes alike) and the lead-in flag.
- **The wire** (`src/net/protocol.ts`): JSON over one WebSocket per rider. `hello` (name, weight, kit colours, a
  random id per ride; the host also sends the route and the options), `pos` twice a second (progress, speed, watts,
  cadence), `start` (host only), `ready`, `rideon`, `result` (at the finish and at the end of the ride), `ping`. The
  relay answers `room` (everyone with their ready marks, the route, the options, the start time, the results so far,
  its clock), `join`, `leave` (with the new host), `pos`, `start`, `ready`, `rideon`, `result`, `pong`, `error`. `PROTOCOL` is bumped when old apps can no longer ride
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
- **Invites:** `GET /join/<CODE>` on the relay is a small page (`relay/src/invite.ts`: who leads, the route, how many
  ride, with an Open button, a download link and the code) that opens `serpentine://join/<CODE>`. The Mac app claims
  the scheme (`protocols` in `electron-builder.yml`; a dev run never registers it), takes a link that started it with
  `invite:take` and later ones as `invite` events; Home opens Ride together with the code and joins. `?join=<CODE>`
  does the same in Chrome.
- **Privacy:** the relay sees the name, weight, kit colours, position and ride totals (time, distance, metres up,
  average watts) of riders in a room, nothing else, and keeps nothing once the room is gone. No accounts, no list of
  rooms: you can only join with a code. The invite page shows the leader's name and the route to whoever has the link.

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
- `PORT=5299 node scripts/e2e-race.mjs [ws://…]`: a race 150 m below the top of Gaisberg (`placeAt` before the start)
  with the guest joining through `?join=`, ready marks, a ride-on, both finish banners, the results on the summary;
  then keep-together at 320 W and 150 W (within 10 m after 45 s). `scripts/test-session.ts` checks keep-together
  without a browser. Screenshots in `shots/race-*.png`, `shots/together-*.png`.
- Test starts: `?ride=<preset>&group=new&sim=1` opens a room (`&race=1`, `&together=1`), `?group=<CODE>&sim=1` joins
  one, `?join=<CODE>` opens Ride together with it.

## Next

- Group workouts: the leader's workout for everyone, in ERG (pairs with keep-together).
- Quick messages from the D-pad ("Easy!", "Wait up"), and following a friend with the camera.
- Ghost files: share a ride, it rides with you (no relay needed).
- On the island: everyone in one world instead of on one route.
