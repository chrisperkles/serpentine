export interface RideSample {
  t: number; // epoch ms
  lat: number;
  lon: number;
  alt: number; // m
  distance: number; // m, cumulative
  speed: number; // m/s
  power?: number;
  cadence?: number;
  heartRate?: number;
  grade?: number; // percent
}

export interface RideRecord {
  id: string;
  name: string;
  routeId: string;
  workoutId?: string;
  workoutName?: string;
  start: number; // epoch ms
  samples: RideSample[]; // 1 Hz
  /** Sample indices where a new lap begins (index 0 implied). */
  laps: number[];
  ftp: number;
  segments?: { id: string; name: string; time: number; power: number }[];
  rampFtp?: number;
  weight: number;
  /** Metres of easy lead-in ridden before the route proper (src/geo/leadIn.ts). */
  leadIn?: number;
  /** Seconds into the workout at the first sample: a queued route carried on the workout of the route before. */
  workoutFrom?: number;
}
