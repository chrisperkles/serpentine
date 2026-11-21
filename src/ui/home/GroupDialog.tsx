// Ride together: lead a group ride on the chosen route and get a code, or join a friend's with theirs.

import { useEffect, useRef, useState } from 'react';
import { isCode, normalizeCode, type RoomOptions } from '../../net/protocol.ts';
import { km } from '../format.ts';
import { useRouteStats, type RouteEntry } from './shared.tsx';

export function GroupDialog({
  route, what, blocked, onGroup, onClose, initialCode,
}: {
  route: RouteEntry | undefined;
  /** What you ride: "Free ride", the workout's name, "Holding 200 W". */
  what: string;
  /** A workout is chosen as the mode but none picked. */
  blocked: boolean;
  onGroup: (code: string | null, options: RoomOptions) => Promise<string | null>;
  onClose: () => void;
  /** From an invite link: filled in, and joined at once when nothing is in the way. */
  initialCode?: string;
}) {
  const [code, setCode] = useState(initialCode ? normalizeCode(initialCode) : '');
  const [mode, setMode] = useState<RoomOptions['mode']>('ride');
  const [together, setTogether] = useState(true);
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const stats = useRouteStats(route);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, busy]);

  const go = async (kind: 'create' | 'join') => {
    setBusy(kind);
    setError(null);
    // on success the ride loads and Home goes away
    const err = await onGroup(kind === 'join' ? code : null, { mode, together: mode === 'ride' && together });
    setBusy(null);
    if (err) setError(err);
  };

  // an invite link: straight in
  const autoJoined = useRef(false);
  useEffect(() => {
    if (!initialCode || autoJoined.current || blocked || !isCode(normalizeCode(initialCode))) return;
    autoJoined.current = true;
    void go('join');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode, blocked]);

  return (
    <div className="modal" role="dialog" aria-label="Ride together" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="together-card">
        <header>
          <h2>Ride together</h2>
          <button className="btn ghost small" onClick={onClose} disabled={!!busy}>
            Close
          </button>
        </header>
        <div className="together-body">
          <section>
            <h3>Lead a group ride</h3>
            <p>
              On <b>{route?.data.name ?? 'the chosen route'}</b>
              {stats && `, ${km(stats.length, 1)} km and ${Math.round(stats.gain)} m up`}. You get a link to send to your
              friends. Everyone waits at the start until you start, then all set off together.
            </p>
            <div className="segmented small" role="radiogroup" aria-label="Kind of group ride">
              <button role="radio" aria-checked={mode === 'ride'} className={mode === 'ride' ? 'on' : ''} onClick={() => setMode('ride')}>
                Group ride
              </button>
              <button role="radio" aria-checked={mode === 'race'} className={mode === 'race' ? 'on' : ''} onClick={() => setMode('race')}>
                Race
              </button>
            </div>
            {mode === 'ride' ? (
              <label className="toggle">
                <input type="checkbox" checked={together} onChange={(e) => setTogether(e.target.checked)} />
                <span>Keep everyone together: whoever falls back is pulled along, whoever gets away is held back. The trainer still feels the road.</span>
              </label>
            ) : (
              <p className="small">
                {route?.data.loop ? 'One lap' : 'To the end of the route'}: places live on the screen, results for everyone at the finish. Riders who
                join after the start ride along unranked.
              </p>
            )}
            <button className="btn" disabled={!route || blocked || !!busy} onClick={() => void go('create')}>
              {busy === 'create' ? 'Opening…' : mode === 'race' ? 'Start a race' : 'Start a group ride'}
            </button>
          </section>
          <section>
            <h3>Join a friend</h3>
            <p>Open the link they sent you, or type its code here. The route is theirs; you ride it your way ({what}).</p>
            <form
              className="code-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (isCode(code) && !busy) void go('join');
              }}
            >
              <input
                ref={input}
                autoFocus
                className="code-input"
                aria-label="Group ride code"
                placeholder="ABCDE"
                value={code}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setCode(normalizeCode(e.target.value))}
              />
              <button className="btn" type="submit" disabled={!isCode(code) || blocked || !!busy}>
                {busy === 'join' ? 'Joining…' : 'Join'}
              </button>
            </form>
          </section>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="muted small">
          Everyone needs Serpentine on their own Mac with their own trainer. Names, kit colours and positions go through
          Serpentine's relay while you ride; nothing is kept after the group ends.
        </p>
      </div>
    </div>
  );
}
