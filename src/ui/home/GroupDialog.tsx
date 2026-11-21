// Ride together: lead a group ride on the chosen route and get a code, or join a friend's with theirs.

import { useEffect, useRef, useState } from 'react';
import { CODE_LENGTH, isCode, normalizeCode } from '../../net/protocol.ts';
import { km } from '../format.ts';
import { useRouteStats, type RouteEntry } from './shared.tsx';

export function GroupDialog({
  route, what, blocked, onGroup, onClose,
}: {
  route: RouteEntry | undefined;
  /** What you ride: "Free ride", the workout's name, "Holding 200 W". */
  what: string;
  /** A workout is chosen as the mode but none picked. */
  blocked: boolean;
  onGroup: (code: string | null) => Promise<string | null>;
  onClose: () => void;
}) {
  const [code, setCode] = useState('');
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
    const err = await onGroup(kind === 'join' ? code : null);
    setBusy(null);
    if (err) setError(err);
  };

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
              {stats && `, ${km(stats.length, 1)} km and ${Math.round(stats.gain)} m up`}. You get a code to send to your friends. Everyone waits at the start
              until you start the ride, then all set off together.
            </p>
            <button className="btn" disabled={!route || blocked || !!busy} onClick={() => void go('create')}>
              {busy === 'create' ? 'Opening the group…' : 'Start a group ride'}
            </button>
          </section>
          <section>
            <h3>Join a friend</h3>
            <p>Type the code they sent you. The route is theirs; you ride it your way ({what}).</p>
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
                maxLength={CODE_LENGTH + 2}
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
