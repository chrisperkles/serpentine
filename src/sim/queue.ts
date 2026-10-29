// Routes to ride after the current one. At the end of a route (the top, or the line of a loop) the next one
// starts by itself, and a workout that is still running carries on there; each route stays its own ride in History
// and on Strava. Per rider, like the settings.

import { profileKey } from './profiles.ts';

export interface QueuedRoute {
  id: string;
  name: string;
}

const KEY = 'serpentine.queue';

export function loadQueue(): QueuedRoute[] {
  try {
    const q = JSON.parse(localStorage.getItem(profileKey(KEY)) ?? '[]') as unknown;
    return Array.isArray(q) ? q.filter((x): x is QueuedRoute => typeof x?.id === 'string' && typeof x?.name === 'string') : [];
  } catch {
    return [];
  }
}

export function saveQueue(q: QueuedRoute[]) {
  try {
    if (q.length) localStorage.setItem(profileKey(KEY), JSON.stringify(q));
    else localStorage.removeItem(profileKey(KEY));
  } catch {
    /* storage blocked: the queue lasts until the page goes away */
  }
}

/** Seconds between reaching the end and the next route loading: time to say "stay here". */
export const NEXT_COUNTDOWN = 15;
