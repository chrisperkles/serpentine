import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { hub } from '../devices/index.ts';
import { CAMERA_MODES, type CameraMode } from '../engine/CameraRig.ts';
import type { RideAudio } from '../audio/RideAudio.ts';
import type { Engine } from '../engine/Engine.ts';
import type { Route } from '../geo/route.ts';
import type { RideSession } from '../sim/session.ts';
import type { AppSettings } from '../sim/storage.ts';
import { fmtTime, gradeColor, int, km, zoneColor } from './format.ts';
import { useCanvas, useHub, useSession } from './hooks.ts';
import { drawProfile } from './profile.ts';
import { WorkoutChart } from './WorkoutChart.tsx';

export function Hud({
  session,
  engine,
  audio,
  settings,
  hairpins,
  ghostLabel,
  onEnd,
  queued,
  upNext,
  onNextNow,
  onStay,
}: {
  session: RideSession;
  engine: Engine;
  audio: RideAudio;
  settings: AppSettings;
  hairpins: number[];
  ghostLabel: string | null;
  onEnd: () => void;
  /** The next route in the queue, ridden after this one. */
  queued: string | null;
  /** Offered at the end of the route: loads when the ride clock reaches `until`. */
  upNext: { name: string; until: number } | null;
  onNextNow: () => void;
  onStay: () => void;
}) {
  const st = useSession(session);
  const { controllable, devices } = useHub();
  const route = session.route;
  // inside a turnaround s runs past the ends of the route
  const clampS = (v: number) => Math.min(route.length, Math.max(0, v));
  const workout = session.workout;
  const [hidden, setHidden] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  // read by the key and button handlers, which are bound once per ride
  const next = useRef({ upNext, onNextNow, onStay });
  next.current = { upNext, onNextNow, onStay };

  const profile = useMemo(() => {
    const dist = new Float32Array(route.n);
    for (let i = 0; i < route.n; i++) dist[i] = i * route.step;
    return { dist, ele: route.ele };
  }, [route]);

  useEffect(() => {
    const setCam = (m: CameraMode) => engine.setCameraMode(m);
    const feedback = (result: 'gear' | 'watts' | 'bias' | 'limit', dir: 1 | -1) => {
      if (result === 'limit') audio.shiftLimit();
      else audio.shift(dir);
      hub.vibrateController();
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const s = session.state;
      if (next.current.upNext && (e.key === 'n' || e.key === 's')) {
        if (e.key === 'n') next.current.onNextNow();
        else next.current.onStay();
        return;
      }
      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (s.status === 'ready') {
            session.begin();
            setCam('chase');
          } else session.togglePause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          engine.steer(-1.3);
          break;
        case 'ArrowRight':
          e.preventDefault();
          engine.steer(1.3);
          break;
        case 'ArrowUp':
        case 'ArrowDown':
          e.preventDefault();
          hub.simulator.nudge((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 50 : 10));
          break;
        case 'e':
          session.toggleErg();
          break;
        case '[':
          feedback(session.shift(-1), -1);
          break;
        case ']':
          feedback(session.shift(1), 1);
          break;
        case '-':
          session.setDifficulty(session.settings.difficulty - 0.1);
          break;
        case '=':
        case '+':
          session.setDifficulty(session.settings.difficulty + 0.1);
          break;
        case 'Tab':
          e.preventDefault();
          session.skipInterval();
          break;
        case 'h':
          setHidden((h) => !h);
          break;
        case 'c': {
          const i = CAMERA_MODES.findIndex((m) => m.id === engine.rig.mode);
          setCam(CAMERA_MODES[(i + 1) % CAMERA_MODES.length].id);
          break;
        }
        case 'Escape':
          setConfirmEnd((c) => !c);
          break;
        default: {
          const m = CAMERA_MODES.find((x) => x.key === e.key);
          if (m) setCam(m.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    const cycleCam = (dir: 1 | -1) => {
      const i = CAMERA_MODES.findIndex((m) => m.id === engine.rig.mode);
      setCam(CAMERA_MODES[(i + dir + CAMERA_MODES.length) % CAMERA_MODES.length].id);
    };
    // Zwift Ride: left hood shifts easier, right hood harder
    const offButton = hub.onButton((b) => {
      const s = session.state;
      // while the next route is offered: A goes now, B stays on this one
      if (next.current.upNext && (b === 'a' || b === 'b')) {
        if (b === 'a') next.current.onNextNow();
        else next.current.onStay();
        return;
      }
      switch (b) {
        case 'shiftUpR': case 'shiftDnR': case 'powerUpR':
          feedback(session.shift(1), 1);
          break;
        case 'shiftUpL': case 'shiftDnL': case 'powerUpL':
          feedback(session.shift(-1), -1);
          break;
        case 'paddleL':
          engine.steer(-1.3);
          break;
        case 'paddleR':
          engine.steer(1.3);
          break;
        case 'up':
          session.setDifficulty(session.settings.difficulty + 0.1);
          break;
        case 'down':
          session.setDifficulty(session.settings.difficulty - 0.1);
          break;
        case 'left':
          cycleCam(-1);
          break;
        case 'right':
          cycleCam(1);
          break;
        case 'a':
          if (s.status === 'ready') {
            session.begin();
            setCam('chase');
          } else session.toggleErg();
          break;
        case 'b':
          if (s.status !== 'ready') session.togglePause();
          break;
        case 'y':
          setHidden((h) => !h);
          break;
        case 'z':
          session.skipInterval();
          break;
      }
    });
    return () => {
      window.removeEventListener('keydown', onKey);
      offButton();
    };
  }, [engine, session, audio]);

  const profileRef = useCanvas(
    (c) => drawProfile(c, profile, { marker: clampS(st.s), ghost: st.ghostS === null ? null : clampS(st.ghostS), progress: st.dir === 1 ? clampS(st.s) : undefined, padTop: 10, minSpan: 200, bins: Math.round(Math.min(140, Math.max(36, route.length / 200))) }),
    [st.s, st.ghostS, profile],
  );
  const mapRef = useCanvas(
    (c) => drawMinimap(c, route, st.s, st.ghostS, st.bots.filter((b) => b.active !== false).map((b) => b.s)),
    [st.s, st.ghostS, st.bots, route],
  );

  const ftp = settings.ftp;
  const wkg = st.power3s / settings.weight;
  const toTop = st.dir === 1 ? Math.max(0, route.length - st.s) : null;
  const hmToTop = st.dir === 1 ? Math.max(0, route.maxEle - st.ele) : null;
  const toClimb = st.dir === 1 && route.leadIn > 0 && st.s < route.leadIn ? route.leadIn - Math.max(0, st.s) : null;
  const passed = hairpins.filter((d) => (st.dir === 1 ? d < st.s : d > st.s)).length;
  const ws = st.workout;
  const message = ws?.message;
  const noTrainer = !controllable && !devices.some((d) => d.capabilities.includes('power'));

  if (hidden) return <div className="hud-hidden-hint">H shows the HUD</div>;

  return (
    <div className="hud">
      <div className="hud-left">
        <div className="hud-power hud-panel" style={{ ['--zone' as string]: zoneColor(st.power3s / ftp) }}>
          <div className="big">
            <span className="value">{Math.round(st.power3s)}</span>
            <span className="unit">W</span>
          </div>
          <div className="zone-bar" />
          <div className="hud-group">
            <Stat value={wkg.toFixed(1)} unit="W/kg" />
            {st.targetPower !== null && (
              <Stat
                value={String(st.targetPower)}
                unit="target W"
                className={`target ${Math.abs(st.power3s - st.targetPower) < st.targetPower * 0.05 ? 'hit' : ''}`}
              />
            )}
            <Stat value={st.cadence ? String(Math.round(st.cadence)) : '–'} unit="rpm" />
            <Stat value={st.heartRate !== null ? String(Math.round(st.heartRate)) : '–'} unit="bpm" />
          </div>
          {st.erg && st.holdWatts !== null && !workout ? (
            <div className="gearbox">
              <span className="g-label">Holding</span>
              <span className="g-val">{st.holdWatts} W</span>
              <span className="g-hint">shifters ±10 W</span>
            </div>
          ) : st.gear !== null && !st.erg ? (
            <div className="gearbox">
              <span className="g-label">Gear</span>
              {session.drivetrain.id === 'zwift' ? (
                <span className="g-val">{st.gear}</span>
              ) : (
                <span className="g-val">
                  {session.gears[st.gear - 1]?.label}
                  <small className="g-num">{st.gear}</small>
                </span>
              )}
              <span className="g-ticks" aria-hidden>
                {session.gears.map((_, i) => (
                  <i key={i} className={i < st.gear! ? 'on' : ''} />
                ))}
              </span>
            </div>
          ) : null}
          {st.erg && workout && st.bias !== 1 && (
            <div className="gearbox">
              <span className="g-label">Intensity</span>
              <span className="g-val">{Math.round(st.bias * 100)} %</span>
            </div>
          )}
          {st.trainerMode === 'sim' && <div className="sub">Difficulty {Math.round(st.difficulty * 100)} %</div>}
        </div>
        {st.segment && (
          <div className="segment">
            <span className="seg-name">{st.segment.name}</span>
            <span className="seg-time">{fmtTime(st.segment.elapsed)}</span>
            <span className="seg-rest">{st.segment.remaining > 999 ? `${km(st.segment.remaining)} km` : `${Math.round(st.segment.remaining)} m`} to go</span>
            {st.segment.strava && (st.segment.kom !== null || st.segment.pr !== null) && (
              <span className="seg-refs">
                {st.segment.kom !== null && <span>KOM {fmtTime(st.segment.kom)}</span>}
                {st.segment.pr !== null && <span>PR {fmtTime(st.segment.pr)}</span>}
                <small>from Strava</small>
              </span>
            )}
            {st.segment.strava && st.segment.komDelta !== null && (
              <span className={`seg-delta ${st.segment.komDelta <= 0 ? 'ahead' : 'behind'}`}>
                {st.segment.komDelta <= 0 ? '−' : '+'}
                {fmtTime(Math.abs(st.segment.komDelta))} vs KOM
              </span>
            )}
            {st.segment.delta !== null && (
              <span className={`seg-delta ${st.segment.delta <= 0 ? 'ahead' : 'behind'}`}>
                {st.segment.delta <= 0 ? '−' : '+'}
                {fmtTime(Math.abs(st.segment.delta))} vs {st.segment.strava ? 'PR' : 'record'}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="hud-map">
        <div className="hud-panel">
          <canvas ref={mapRef} className="minimap" />
          {/* in pairs: the slope now, what is left, where you are */}
          <div className="hud-group climb">
            <Stat value={`${fmtGrade(st.grade)} %`} unit="gradient" className="grade" style={{ ['--grade' as string]: gradeColor(st.grade) }} />
            <Stat value={st.vam !== null && st.vam > 0 ? String(Math.round(st.vam / 10) * 10) : '–'} unit="VAM m/h" />
            {route.category === 'climb' && toTop !== null && hmToTop !== null && (
              <>
                <Stat value={km(toTop)} unit="km to the top" />
                <Stat value={int(hmToTop)} unit="hm to go" />
              </>
            )}
            {route.category !== 'climb' && (
              <Stat value={km(Math.max(0, st.dir === 1 ? route.length - st.s : st.s))} unit={route.loop ? `km to go, lap ${st.lap}` : 'km to go'} />
            )}
            <Stat value={int(st.ele)} unit="m altitude" />
            {hairpins.length >= 3 && st.dir === 1 && (
              <Stat value={`${Math.min(passed + 1, hairpins.length)}/${hairpins.length}`} unit="Kehre" />
            )}
          </div>
          <div className="summit">
            {toClimb !== null && <span className="lead-in">Easy lead-in, climb in {km(toClimb)} km</span>}
            {route.category === 'climb' && st.dir === -1 && <span>Descending</span>}
            {queued && !upNext && <span className="queued">Then {queued}</span>}
          </div>
        </div>
        {st.bots.some((b) => b.active !== false) && (
          <ul className="pacers hud-panel">
            {st.bots.map((b, i) =>
              b.active === false ? null : (
              <li key={i}>
                <i style={{ background: BOT_COLORS[i % BOT_COLORS.length] }} />
                {b.label ?? `${b.wkg.toFixed(1)} W/kg`} <b>{b.gap >= 0 ? `+${Math.round(b.gap)}` : Math.round(b.gap)} m</b>
              </li>
              ),
            )}
          </ul>
        )}
        {st.drafting && <div className="drafting">In the draft</div>}
        {st.ghostGap !== null && ghostLabel && (
          <div className={`ghost-gap ${st.ghostGap >= 0 ? 'ahead' : 'behind'}`}>
            {st.ghostGap >= 0 ? '+' : '−'}
            {fmtTime(Math.abs(st.ghostGap))} <span>vs {ghostLabel}</span>
          </div>
        )}
      </div>

      <div className="hud-bottom">
        <div className="hud-row">
          <div className="hud-stats">
            <Stat value={fmtTime(st.elapsed)} unit="time" />
            <Stat value={km(st.distance, 1)} unit="km ridden" />
            <Stat value={(st.speed * 3.6).toFixed(1)} unit="km/h" />
            <Stat value={int(st.gain)} unit="hm climbed" />
          </div>
          <div className="hud-stats">
            <Stat value={Math.round(st.np) ? String(Math.round(st.np)) : '–'} unit="W normalized" />
            <Stat value={String(Math.round(st.kj))} unit="kJ" />
          </div>
        </div>
        {workout && ws && (
          <div className="hud-workout">
            <div className="interval">
              {ws.done ? (
                <span className="now">Workout complete</span>
              ) : (
                <>
                  <span className="now" style={{ color: ws.targetFraction ? zoneColor(ws.targetFraction) : undefined }}>
                    {ws.target !== null ? `${ws.target} W` : ws.step.kind === 'maxeffort' ? 'All out' : 'Free ride'}
                  </span>
                  <span className="left">{fmtTime(ws.stepRemaining)}</span>
                  {ws.step.cadence && <span className="muted">{ws.step.cadence} rpm</span>}
                  {ws.next && (
                    <span className="next">
                      then {fmtTime(ws.next.duration)} at {Math.round(((ws.next.start + ws.next.end) / 2) * ftp)} W
                    </span>
                  )}
                  <span className="mode">{st.erg ? 'ERG' : 'Slope'}</span>
                </>
              )}
            </div>
            <WorkoutChart workout={workout} elapsed={st.workoutElapsed} height={46} />
          </div>
        )}
        <canvas ref={profileRef} className="hud-profile" />
        <div className="hud-keys">
          <span className="cam">{CAMERA_MODES.find((m) => m.id === engine.rig.mode)?.label}</span>
          <span>1–5 camera</span>
          <span>Space pause</span>
          {workout && <span>E erg</span>}
          {workout && <span>Tab skip interval</span>}
          <span>[ ] gears</span>
          <span>− = difficulty</span>
          <span>← → steer</span>
          <span>↑ ↓ simulator watts</span>
          <span>H hide</span>
          <button className="link" onClick={() => setConfirmEnd(true)}>
            End ride
          </button>
        </div>
      </div>

      {message && <div className="coach">{message}</div>}
      {st.banner && (
        <div className="banner" key={st.banner.text}>
          <span className="b-main">{st.banner.text}</span>
          {st.banner.sub && <span className="b-sub">{st.banner.sub}</span>}
        </div>
      )}

      {upNext && (
        <div className="up-next" role="status">
          <span className="un-label">Next route</span>
          <span className="un-name">{upNext.name}</span>
          <span className="un-time">
            {st.status === 'paused' ? 'when you ride on' : `in ${Math.max(0, Math.ceil(upNext.until - st.elapsed))} s`}
          </span>
          <div className="un-actions">
            <button className="btn" onClick={onNextNow}>
              Go now <kbd>N</kbd>
            </button>
            <button className="btn ghost" onClick={onStay}>
              Stay here <kbd>S</kbd>
            </button>
          </div>
        </div>
      )}

      {st.status === 'ready' && (
        <div className="overlay ready">
          <p className="o-main">{route.name}</p>
          <p className="o-sub">Start pedalling or press Space</p>
          {noTrainer && <p className="warn">No trainer connected. Go back and connect one, or turn on the keyboard simulator.</p>}
        </div>
      )}
      {st.status === 'paused' && (
        <div className="overlay">
          <p className="o-main">Paused</p>
          <p className="o-sub">Space to continue</p>
        </div>
      )}
      {confirmEnd && (
        <div className="overlay end">
          <p className="o-main">End this ride?</p>
          <div className="o-actions">
            <button className="btn" onClick={onEnd}>
              Save and finish
            </button>
            <button className="btn ghost" onClick={() => setConfirmEnd(false)}>
              Keep riding
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

/** Whole percent, with a real minus sign downhill. */
function fmtGrade(g: number): string {
  const r = Math.round(g);
  return r < 0 ? `−${-r}` : String(r);
}

function Stat({ value, unit, className, style }: { value: string; unit: string; className?: string; style?: CSSProperties }) {
  return (
    <div className={`stat${className ? ` ${className}` : ''}`} style={style}>
      <span className="s-val">{value}</span>
      <span className="s-unit">{unit}</span>
    </div>
  );
}

const BOT_COLORS = ['#2f7de1', '#f2c230', '#2fb36d', '#9b5de5', '#f15bb5'];

function drawMinimap(c: HTMLCanvasElement, route: Route, s: number, ghost: number | null, bots: number[] = []) {
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (!w) return;
  c.width = w * dpr;
  c.height = h * dpr;
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const [x0, z0, x1, z1] = route.bounds;
  const span = Math.max(x1 - x0, z1 - z0) || 1;
  const pad = 10;
  const k = (Math.min(w, h) - pad * 2) / span;
  const ox = (w - (x1 - x0) * k) / 2;
  const oz = (h - (z1 - z0) * k) / 2;
  const P = (i: number): [number, number] => [ox + (route.x[i] - x0) * k, oz + (route.z[i] - z0) * k];
  const stride = Math.max(1, Math.floor(route.n / 500));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(13,27,36,0.7)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  for (let i = 0; i < route.n; i += stride) {
    const [x, y] = P(i);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  for (let i = stride; i < route.n; i += stride) {
    const [ax, ay] = P(i - stride);
    const [bx, by] = P(i);
    ctx.strokeStyle = gradeColor(route.grade[i]);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  const dot = (d: number, color: string, r: number) => {
    const i = Math.min(route.n - 1, Math.max(0, Math.round(d / route.step)));
    const [x, y] = P(i);
    ctx.fillStyle = color;
    ctx.strokeStyle = '#0d1b24';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  };
  if (ghost !== null) dot(ghost, '#7ff5ff', 4);
  bots.forEach((b, i) => dot(b, BOT_COLORS[i % BOT_COLORS.length], 3.5));
  dot(s, '#ffc93c', 5.5);
}
