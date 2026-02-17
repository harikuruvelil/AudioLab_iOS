export interface TrackMeta {
  id: string;
  filename: string;
  displayName: string;
  addedAt: number;
  durationSeconds: number;
  mimeType: string;
  sizeBytes: number;
}

export interface StorageSummary {
  appBytes: number;
  usageBytes: number | null;
  quotaBytes: number | null;
}

export type ReverbPresetId =
  | "off"
  | "air_museum_1"
  | "air_museum_2"
  | "auditorium"
  | "drum_room_1"
  | "drum_room_2"
  | "stairwell"
  | "theatre_1"
  | "theatre_2"
  | "university_hall_center_rows"
  | "university_hall_front_row"
  | "university_hall_stalls";

export type EqPresetName = "Flat" | "Bass Boost" | "Vocal" | "Treble Boost";

export type EqBandGains = [number, number, number, number, number];

export type RepeatMode = "off" | "one" | "all";
export type WaveformMode = "linear" | "circular" | "vectorscope";

export interface QualityState {
  status: "checking" | "full_rate_match" | "resampled";
  contextHz: number | null;
  trackHz: number | null;
  irHz: number | null;
  trackResampled: boolean;
  irResampled: boolean;
  reverbActive: boolean;
}

export interface PlaybackState {
  trackId: string | null;
  isReady: boolean;
  isPlaying: boolean;
  rate: number;
  currentTime: number;
  duration: number;
  reverbEnabled: boolean;
  reverbPresetId: ReverbPresetId;
  reverbWet: number;
  eqEnabled: boolean;
  eqBandGains: EqBandGains;
  eqPresetName: EqPresetName | null;
  quality: QualityState;
  clipWarning: boolean;
}
