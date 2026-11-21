// Group ride on the HUD: the waiting room with the code, the countdown, the screen for riders who come late,
// and the list of riders with their gaps while riding.

import { useEffect, useState } from 'react';
import type { GroupRide } from '../net/group.ts';
import type { LiveState, RemoteRider } from '../sim/session.ts';
import { km } from './format.ts';

/** Re-render on every change in the room, and four times a second for the countdown. */
export function useGroup(group: GroupRide | null): number {
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

function Dot({ colour }: { colour: string }) {
  return <i className="kit-dot" style={{ background: colour }} />;
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
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(group.code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => undefined,
    );
  };

  if (late) {
    const a = group.anchor();
    return (
      <div className="overlay ready group-start">
        <p className="o-main">{routeName}</p>
        {a ? (
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
        {noTrainer && <p className="warn">No trainer connected. Go back and connect one, or turn on the keyboard simulator.</p>}
      </div>
    );
  }

  return (
    <div className="overlay ready group-start">
      {startsIn !== null && startsIn > 0 ? (
        <>
          <p className="o-sub">{routeName}: everyone sets off in</p>
          <p className="o-main countdown">{Math.ceil(startsIn)}</p>
        </>
      ) : (
        <>
          <p className="o-sub">Group ride on {routeName}</p>
          <button className="group-code" onClick={copy} title="Copy the code">
            {group.code}
            <small>{copied ? 'Copied' : 'Copy'}</small>
          </button>
          <p className="o-sub small-sub">
            Friends open Serpentine, choose <b>Ride together</b>, then <b>Join</b>, and type this code.
          </p>
        </>
      )}
      <ul className="group-lobby" aria-label="Riders">
        <li>
          <Dot colour={kit} />
          {group.me.name} <small>(you{group.isHost ? ', leading' : ''})</small>
        </li>
        {riders.map((r) => (
          <li key={r.id}>
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
              Start the ride for everyone <kbd>Space</kbd>
            </button>
          </div>
        ) : (
          <p className="o-sub small-sub">Waiting for {host?.name ?? 'the leader'} to start. Pedal to warm up meanwhile.</p>
        ))}
      {group.status === 'reconnecting' && <p className="warn">Lost the connection to the group, trying again…</p>}
      {noTrainer && <p className="warn">No trainer connected. Go back and connect one, or turn on the keyboard simulator.</p>}
    </div>
  );
}

/** While riding: the nearest riders, ahead first, with us in the middle. */
export function GroupPanel({ group, st, myName, kit, weight }: { group: GroupRide; st: LiveState; myName: string; kit: string; weight: number }) {
  useGroup(group);
  const me: RemoteRider & { me: true } = {
    id: 'me', name: myName, kit, accent: '', bike: '', s: st.s, dir: st.dir, speed: st.speed, power: st.power3s, cadence: st.cadence,
    wkg: st.power3s / weight, gap: 0, stale: false, host: group.isHost, me: true,
  };
  const live = st.riders.filter((r) => !r.stale);
  // the eight nearest to us (us included), then in road order
  const rows = [...live, me]
    .sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap))
    .slice(0, 8)
    .sort((a, b) => b.gap - a.gap);
  const gone = st.riders.length - live.length;
  return (
    <div className="group-panel hud-panel">
      <div className="gp-head">
        Group <b>{group.code}</b>
        {group.status === 'reconnecting' && <span className="gp-warn"> reconnecting…</span>}
        {group.status === 'closed' && <span className="gp-warn"> ended</span>}
      </div>
      <ul>
        {rows.map((r) => (
          <li key={r.id} className={'me' in r ? 'me' : undefined}>
            <Dot colour={r.kit} />
            <span className="gp-name">{r.name}</span>
            <span className="gp-wkg">{r.wkg.toFixed(1)}</span>
            <b className="gp-gap">{'me' in r ? '' : fmtGap(r.gap)}</b>
          </li>
        ))}
      </ul>
      {gone > 0 && <div className="gp-foot">{gone === 1 ? '1 rider has no signal' : `${gone} riders have no signal`}</div>}
    </div>
  );
}
