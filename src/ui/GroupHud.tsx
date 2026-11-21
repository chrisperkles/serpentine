// Group ride on the HUD: the waiting room with the code and invite link, the countdown, the screen for riders
// who come late, the riders (places in a race) while riding, ride-ons, and the results on the summary.

import { useEffect, useState } from 'react';
import type { GroupRide, PeerView } from '../net/group.ts';
import type { MemberResult } from '../net/protocol.ts';
import type { LiveState, RemoteRider } from '../sim/session.ts';
import { fmtTime, km } from './format.ts';

/** Re-render on every change in the room, and four times a second for the countdown. */
export function useGroup(group: GroupRide | null | undefined): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!group) return;
    const bump = () => setN((x) => x + 1);
    const off = group.subscribe(bump);
    const timer = setInterval(bump, 250);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [group]);
  return n;
}

function fmtGap(gap: number): string {
  const a = Math.abs(gap);
  const sign = gap >= 0 ? '+' : '−';
  return a >= 1000 ? `${sign}${km(a, 1)} km` : `${sign}${Math.round(a)} m`;
}

function ordinal(n: number): string {
  return `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
}

function Dot({ colour }: { colour: string }) {
  return <i className="kit-dot" style={{ background: colour }} />;
}

/** The nearest live rider within 200 m gets a ride-on; nobody near, everyone does. */
export function rideOnTarget(riders: RemoteRider[]): RemoteRider | null {
  const near = riders.filter((r) => !r.stale && Math.abs(r.gap) < 200).sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap));
  return near[0] ?? null;
}

function useCopy(): [string | null, (what: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (what: string, text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(what);
        setTimeout(() => setCopied(null), 2000);
      },
      () => undefined,
    );
  };
  return [copied, copy];
}

/** The overlay before we ride: waiting for the host, the countdown, or "the group is already out there". */
export function GroupStartOverlay({
  group, late, nearGroup, onNearGroup, onBegin, routeName, noTrainer, kit,
}: {
  group: GroupRide;
  late: boolean;
  nearGroup: boolean;
  onNearGroup: (v: boolean) => void;
  onBegin: () => void;
  routeName: string;
  noTrainer: boolean;
  kit: string;
}) {
  useGroup(group);
  const riders = group.view().filter((p) => !p.stale || !late);
  const host = group.isHost ? null : riders.find((p) => p.host);
  const startsIn = group.startsIn();
  const [copied, copy] = useCopy();
  const kind = group.race ? 'Race' : 'Group ride';
  const trainerWarn = noTrainer && <p className="warn">No trainer connected. Go back and connect one, or turn on the keyboard simulator.</p>;

  if (late) {
    const a = group.anchor();
    return (
      <div className="overlay ready group-start">
        <p className="o-main">{routeName}</p>
        {group.race ? (
          <p className="o-sub">The race has started. Start pedalling to ride along from the start; you won't be ranked.</p>
        ) : a ? (
          <>
            <p className="o-sub">
              The group is riding. {nearGroup ? `Start pedalling to join them next to ${a.name}, ${km(a.p, 1)} km in.` : 'Start pedalling to ride from the start.'}
            </p>
            <div className="o-actions">
              <button className="btn ghost" onClick={() => onNearGroup(!nearGroup)}>
                {nearGroup ? 'Start at the beginning instead' : `Start next to ${a.name} instead`}
              </button>
            </div>
          </>
        ) : (
          <p className="o-sub">Nobody else is riding right now. Start pedalling to ride from the start.</p>
        )}
        {trainerWarn}
      </div>
    );
  }

  // the leader counts as ready
  const ready = riders.filter((r) => r.ready).length + 1;
  const sub = group.race
    ? `Race on ${routeName}: first ${group.route?.data && (group.route.data as { loop?: boolean }).loop ? 'round the lap' : 'to the end'} wins`
    : `Group ride on ${routeName}${group.options.together ? ', kept together' : ''}`;
  return (
    <div className="overlay ready group-start">
      {startsIn !== null && startsIn > 0 ? (
        <>
          <p className="o-sub">{routeName}: everyone sets off in</p>
          <p className="o-main countdown">{Math.ceil(startsIn)}</p>
        </>
      ) : (
        <>
          <p className="o-sub">{sub}</p>
          <button className="group-code" onClick={() => copy('code', group.code)} title="Copy the code">
            {group.code}
            <small>{copied === 'code' ? 'Copied' : 'Copy'}</small>
          </button>
          <p className="o-sub small-sub">
            Send the link: it opens Serpentine and joins.{' '}
            <button className="link" onClick={() => copy('link', `Ride ${routeName} with me in Serpentine: ${group.invite}`)}>
              {copied === 'link' ? 'Link copied' : 'Copy invite link'}
            </button>
          </p>
        </>
      )}
      <ul className="group-lobby" aria-label="Riders">
        <li className={group.ready || group.isHost ? 'is-ready' : undefined}>
          <Dot colour={kit} />
          {group.me.name} <small>(you{group.isHost ? ', leading' : ''})</small>
        </li>
        {riders.map((r) => (
          <li key={r.id} className={r.ready || r.host ? 'is-ready' : undefined}>
            <Dot colour={r.kit} />
            {r.name}
            {r.host && <small> (leading)</small>}
          </li>
        ))}
      </ul>
      {startsIn === null &&
        (group.isHost ? (
          <div className="o-actions">
            <button className="btn" onClick={onBegin}>
              {group.race ? 'Start the race' : 'Start the ride for everyone'} <kbd>Space</kbd>
            </button>
            {riders.length > 0 && <span className="ready-count">{ready} of {riders.length + 1} ready</span>}
          </div>
        ) : (
          <div className="o-actions">
            <button className={`btn ${group.ready ? 'ghost' : ''}`} onClick={() => group.setReady(!group.ready)}>
              {group.ready ? 'Not ready yet' : "I'm ready"} <kbd>A</kbd>
            </button>
            <span className="ready-count">
              {kind} starts when {host?.name ?? 'the leader'} says go. Pedal to warm up meanwhile.
            </span>
          </div>
        ))}
      {group.status === 'reconnecting' && <p className="warn">Lost the connection to the group, trying again…</p>}
      {trainerWarn}
    </div>
  );
}

type Row = RemoteRider & { me?: true; finish: number | null };

/** While riding: the nearest riders, ahead first, with us among them; places in a race. */
export function GroupPanel({
  group, st, myName, kit, weight, onRideOn,
}: { group: GroupRide; st: LiveState; myName: string; kit: string; weight: number; onRideOn: () => void }) {
  useGroup(group);
  const finishOf = (id: string) => group.results.get(id)?.finish ?? null;
  const me: Row = {
    id: group.me.id, name: myName, kit, accent: '', bike: '', s: st.s, dir: st.dir, speed: st.speed, power: st.power3s, cadence: st.cadence,
    wkg: st.power3s / weight, gap: 0, stale: false, host: group.isHost, me: true, finish: finishOf(group.me.id),
  };
  const live: Row[] = st.riders.filter((r) => !r.stale).map((r) => ({ ...r, finish: finishOf(r.id) }));
  // a race: finished riders by time, then the rest by how far along they are
  const order = [...live, me].sort((a, b) =>
    a.finish !== null || b.finish !== null ? (a.finish ?? Infinity) - (b.finish ?? Infinity) : b.gap - a.gap,
  );
  const place = new Map(order.map((r, i) => [r.id, i + 1]));
  const rows = [...live, me]
    .sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap))
    .slice(0, 8)
    .sort((a, b) => (group.race ? place.get(a.id)! - place.get(b.id)! : b.gap - a.gap));
  const gone = st.riders.length - live.length;
  return (
    <div className="group-panel hud-panel">
      <div className="gp-head">
        {group.race ? (
          <>
            Race <b>{ordinal(place.get(me.id)!)}</b> of {order.length}
          </>
        ) : (
          <>
            Group <b>{group.code}</b>
            {group.options.together && <span className="gp-note"> together</span>}
          </>
        )}
        {group.status === 'reconnecting' && <span className="gp-warn"> reconnecting…</span>}
        {group.status === 'closed' && <span className="gp-warn"> ended</span>}
        {live.length > 0 && (
          <button className="gp-rideon" onClick={onRideOn} title="Ride on: a thumbs-up to the nearest rider (R)">
            {'\u{1F44D}'} <kbd>R</kbd>
          </button>
        )}
      </div>
      <ul>
        {rows.map((r) => (
          <li key={r.id} className={r.me ? 'me' : undefined}>
            {group.race ? <span className="gp-place">{place.get(r.id)}</span> : <Dot colour={r.kit} />}
            <span className="gp-name">{r.name}</span>
            <span className="gp-wkg">{r.wkg.toFixed(1)}</span>
            <b className="gp-gap">{r.finish !== null ? fmtTime(r.finish) : r.me ? '' : fmtGap(r.gap)}</b>
          </li>
        ))}
      </ul>
      {st.groupPull > 0.3 && <div className="gp-foot pull">The group pulls you along</div>}
      {st.groupPull < -0.3 && <div className="gp-foot pull">Ahead of the group: easy, they're coming</div>}
      {gone > 0 && <div className="gp-foot">{gone === 1 ? '1 rider has no signal' : `${gone} riders have no signal`}</div>}
    </div>
  );
}

/** Thumbs-ups from the group, for a few seconds each. */
export function RideOnToasts({ group, sent }: { group: GroupRide; sent: { to: string; at: number } | null }) {
  const [list, setList] = useState<{ key: number; from: PeerView; toMe: boolean }[]>([]);
  useEffect(() => {
    let key = 0;
    return group.onRideOn((from, toMe) => {
      const k = ++key;
      setList((l) => [...l.slice(-3), { key: k, from, toMe }]);
      setTimeout(() => setList((l) => l.filter((x) => x.key !== k)), 4500);
    });
  }, [group]);
  const showSent = sent && performance.now() - sent.at < 2500;
  if (!list.length && !showSent) return null;
  return (
    <div className="rideons" role="status">
      {list.map((x) => (
        <div key={x.key} className="rideon">
          <span className="ro-thumb">{'\u{1F44D}'}</span>
          <Dot colour={x.from.kit} />
          <b>{x.from.name}</b> {x.toMe ? 'gave you a ride on' : 'gave everyone a ride on'}
        </div>
      ))}
      {showSent && <div className="rideon sent">Ride on sent to {sent.to}</div>}
    </div>
  );
}

/** The summary: everyone's result, kept current while the others still ride. */
export function GroupResults({ group }: { group: GroupRide }) {
  useGroup(group);
  const results = [...group.results.values()];
  const have = new Set(results.map((r) => r.id));
  // in the room, no result yet: still on the way
  const riding = group.view().filter((p) => !have.has(p.id) && !p.stale);
  const ranked = results.filter((r) => r.finish !== null && !(group.race && r.late)).sort((a, b) => a.finish! - b.finish!);
  const rest = results.filter((r) => !ranked.includes(r)).sort((a, b) => b.distance - a.distance);
  const best = ranked[0]?.finish ?? null;
  const status = (r: MemberResult) =>
    r.finish !== null ? (group.race && r.late ? `${fmtTime(r.finish)}, joined late` : fmtTime(r.finish)) : r.done ? (group.race ? 'did not finish' : 'ended early') : 'still riding';
  return (
    <section className="s-group">
      <h2>{group.race ? 'Race results' : 'The group'}</h2>
      <table>
        <thead>
          <tr>
            <th aria-label="Place" />
            <th>Rider</th>
            <th>{group.race ? 'Finish' : (group.route?.data as { loop?: boolean } | undefined)?.loop ? 'Lap' : 'To the top'}</th>
            {group.race && <th>Gap</th>}
            <th>Avg</th>
            <th>W/kg</th>
            <th>Distance</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((r, i) => (
            <tr key={r.id} className={r.id === group.me.id ? 'me' : undefined}>
              <td className={`place p${i + 1}`}>{group.race ? i + 1 : ''}</td>
              <td>
                <Dot colour={r.kit} />
                {r.name}
              </td>
              <td>{status(r)}</td>
              {group.race && <td>{i === 0 || best === null ? '' : `+${fmtTime(r.finish! - best)}`}</td>}
              <td>{Math.round(r.avgPower)} W</td>
              <td>{(r.avgPower / r.weight).toFixed(1)}</td>
              <td>{km(r.distance, 1)} km</td>
            </tr>
          ))}
          {rest.map((r) => (
            <tr key={r.id} className={r.id === group.me.id ? 'me' : undefined}>
              <td />
              <td>
                <Dot colour={r.kit} />
                {r.name}
              </td>
              <td className="muted">{status(r)}</td>
              {group.race && <td />}
              <td>{Math.round(r.avgPower)} W</td>
              <td>{(r.avgPower / r.weight).toFixed(1)}</td>
              <td>{km(r.distance, 1)} km</td>
            </tr>
          ))}
          {riding.map((p) => (
            <tr key={p.id}>
              <td />
              <td>
                <Dot colour={p.kit} />
                {p.name}
              </td>
              <td className="muted">still riding, {km(p.p, 1)} km</td>
              {group.race && <td />}
              <td />
              <td />
              <td />
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
