import { useState } from 'react';
import { encodeFit, fitFileName } from '../sim/fit.ts';
import type { RideStats } from '../sim/stats.ts';
import type { RideRecord } from '../sim/types.ts';
import { Contours } from './Contours.tsx';
import { FtpResult } from './FtpResult.tsx';
import { download } from './download.ts';
import { fmtTime, int, km, ZONE_HEX } from './format.ts';
import { useCanvas } from './hooks.ts';

export interface SummaryData {
  record: RideRecord;
  stats: RideStats;
  summitTime: number | null;
  previousBest: number | null;
  /** Saving failed (disk full, server gone): shown with a retry, the ride's autosaved copy is kept meanwhile. */
  unsaved?: boolean;
  /** A queued ride: the routes before this one, each saved as its own ride. */
  earlier?: string[];
  /** One line on the workout's hard intervals. */
  feedback?: string;
}

export function Summary({
  data,
  backLabel,
  onBack,
  onAgain,
  onDelete,
  weight,
  onApplyFtp,
  onRetrySave,
}: {
  data: SummaryData;
  backLabel: string;
  onBack: () => void;
  onAgain?: () => void;
  onDelete?: () => void;
  weight?: number;
  onApplyFtp?: (ftp: number) => void;
  onRetrySave?: () => Promise<void>;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const { record, stats, summitTime, previousBest } = data;
  const pb = summitTime !== null && (previousBest === null || summitTime < previousBest);
  const chart = useCanvas((c) => drawRideChart(c, record), [record]);
  const zonesTotal = stats.timeInZones.reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="summary">
      <Contours />
      <div className="summary-inner">
        <p className="muted">{new Date(record.start).toLocaleString('de-AT', { weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' })}</p>
        <h1 className="s-title">{record.name}</h1>
        {data.earlier && <p className="muted s-earlier">After {data.earlier.join(', ')}: each route is its own ride in History.</p>}
        {data.unsaved && (
          <div className="s-unsaved" role="alert">
            <span>This ride isn't saved yet. Download the .fit to be safe, or try again.</span>
            {onRetrySave && (
              <button
                className="btn"
                disabled={retrying}
                onClick={() => {
                  setRetrying(true);
                  void onRetrySave().finally(() => setRetrying(false));
                }}
              >
                {retrying ? 'Saving…' : 'Save again'}
              </button>
            )}
          </div>
        )}
        {record.workoutName && <p className="s-workout">{record.workoutName}</p>}
        {data.feedback && <p className="s-feedback">{data.feedback}</p>}
        {summitTime !== null && (
          <p className={`s-summit ${pb ? 'pb' : ''}`}>
            Summit in {fmtTime(summitTime)}
            {pb && previousBest !== null && <span> — new best by {fmtTime(previousBest - summitTime)}</span>}
            {pb && previousBest === null && <span> — your first time to the top</span>}
            {!pb && previousBest !== null && <span> — best is {fmtTime(previousBest)}</span>}
          </p>
        )}
        {record.rampFtp && onApplyFtp && (
          <FtpResult newFtp={record.rampFtp} oldFtp={record.ftp} weight={weight} onApply={() => onApplyFtp(record.rampFtp!)} />
        )}
        <dl className="s-stats">
          <div><dt>Time</dt><dd>{fmtTime(stats.duration)}</dd></div>
          <div><dt>Distance</dt><dd>{km(stats.distance)} <small>km</small></dd></div>
          <div><dt>Climbed</dt><dd>{int(stats.ascent)} <small>hm</small></dd></div>
          <div><dt>Avg power</dt><dd>{Math.round(stats.avgPower)} <small>W</small></dd></div>
          <div><dt>Normalized</dt><dd>{Math.round(stats.np)} <small>W</small></dd></div>
          <div><dt>TSS</dt><dd>{Math.round(stats.tss)}</dd></div>
          <div><dt>Energy</dt><dd>{int(stats.kj)} <small>kJ</small></dd></div>
          <div><dt>Avg heart rate</dt><dd>{stats.avgHr ? Math.round(stats.avgHr) : '–'} <small>bpm</small></dd></div>
        </dl>
        <canvas ref={chart} className="s-chart" />
        <div className="s-row">
          <div className="s-efforts">
            <h2>Best efforts</h2>
            <ul>
              {(['5', '60', '300', '1200'] as const).map((k) => (
                <li key={k}>
                  <span>{k === '5' ? '5 s' : k === '60' ? '1 min' : k === '300' ? '5 min' : '20 min'}</span>
                  <b>{stats.bestEfforts[Number(k) as 5] ? `${Math.round(stats.bestEfforts[Number(k) as 5])} W` : '–'}</b>
                </li>
              ))}
            </ul>
          </div>
          <div className="s-zones">
            <h2>Time in zones</h2>
            <div className="zone-strip">
              {stats.timeInZones.map((t, i) => (
                <span key={i} style={{ flexGrow: t / zonesTotal, background: ZONE_HEX[i] }} title={`Z${i + 1} ${fmtTime(t)}`} />
              ))}
            </div>
            <ul className="zone-legend">
              {stats.timeInZones.map((t, i) => (
                <li key={i}>
                  <i style={{ background: ZONE_HEX[i] }} /> Z{i + 1} {fmtTime(t)}
                </li>
              ))}
            </ul>
          </div>
        </div>
        {record.segments && record.segments.length > 0 && (
          <div className="s-segments">
            <h2>Segments</h2>
            <ul>
              {record.segments.map((e, i) => (
                <li key={i}>
                  <span>{e.name}</span>
                  <b>{fmtTime(e.time)}</b>
                  <span className="muted">{Math.round(e.power)} W</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="s-actions">
          <button className="btn" onClick={() => download(encodeFit(record), fitFileName(record), 'application/vnd.ant.fit')}>
            Download .fit for Strava
          </button>
          {onAgain && (
            <button className="btn ghost" onClick={onAgain}>
              Ride it again
            </button>
          )}
          <button className="btn ghost" onClick={onBack}>
            {backLabel}
          </button>
          {onDelete &&
            (confirmDelete ? (
              <button className="btn danger" onClick={onDelete}>
                Delete for good
              </button>
            ) : (
              <button className="link danger" onClick={() => setConfirmDelete(true)}>
                Delete ride
              </button>
            ))}
        </div>
        <p className="muted small">
          {data.unsaved ? 'Not saved yet. ' : 'Saved in Documents/Serpentine/rides. '}
          Upload the .fit on strava.com/upload or intervals.icu and it shows up as a Virtual Ride.
        </p>
      </div>
    </div>
  );
}

function drawRideChart(c: HTMLCanvasElement, rec: RideRecord) {
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (!w || rec.samples.length < 2) return;
  c.width = w * dpr;
  c.height = h * dpr;
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = rec.samples;
  let minA = Infinity, maxA = -Infinity, maxP = 1;
  for (const x of s) {
    minA = Math.min(minA, x.alt);
    maxA = Math.max(maxA, x.alt);
    maxP = Math.max(maxP, x.power ?? 0);
  }
  const X = (i: number) => (i / (s.length - 1)) * w;
  const A = (a: number) => h - 4 - ((a - minA) / Math.max(maxA - minA, 50)) * (h * 0.7);
  ctx.beginPath();
  ctx.moveTo(0, h);
  s.forEach((x, i) => ctx.lineTo(X(i), A(x.alt)));
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = 'rgba(143,163,173,0.22)';
  ctx.fill();
  // 10 s smoothed power
  ctx.beginPath();
  let acc = 0;
  const win = 10;
  s.forEach((x, i) => {
    acc += x.power ?? 0;
    if (i >= win) acc -= s[i - win].power ?? 0;
    const p = acc / Math.min(i + 1, win);
    const y = h - (p / (maxP * 1.1)) * h;
    if (i === 0) ctx.moveTo(X(i), y);
    else ctx.lineTo(X(i), y);
  });
  ctx.strokeStyle = '#ffc93c';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}
