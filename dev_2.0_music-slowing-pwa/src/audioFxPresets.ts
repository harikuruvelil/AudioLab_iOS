import type { EqBand, EqBandType, EqPresetName, ReverbPresetId } from "./types";

export interface ReverbPresetDefinition {
  id: ReverbPresetId;
  label: string;
  url: string | null;
}

// ─── Base URL for public assets (Vite replaces at build time) ───
// On dev server: "/", on GitHub Pages: "/AudioLab_iOS/"
const BASE = import.meta.env.BASE_URL;

export const REVERB_PRESETS: ReverbPresetDefinition[] = [
  { id: "off", label: "Off", url: null },
  { id: "air_museum_1", label: "Air Museum 1", url: `${BASE}irs/air_museum_1.wav` },
  { id: "air_museum_2", label: "Air Museum 2", url: `${BASE}irs/air_museum_2.wav` },
  { id: "auditorium", label: "Auditorium", url: `${BASE}irs/auditorium.wav` },
  { id: "drum_room_1", label: "Drum Room 1", url: `${BASE}irs/drum_room_1.wav` },
  { id: "drum_room_2", label: "Drum Room 2", url: `${BASE}irs/drum_room_2.wav` },
  { id: "stairwell", label: "Stairwell", url: `${BASE}irs/stairwell.wav` },
  { id: "theatre_1", label: "Theatre 1", url: `${BASE}irs/theatre_1.wav` },
  { id: "theatre_2", label: "Theatre 2", url: `${BASE}irs/theatre_2.wav` },
  {
    id: "university_hall_center_rows",
    label: "University Hall (Center Rows)",
    url: `${BASE}irs/university_hall_center_rows.wav`
  },
  {
    id: "university_hall_front_row",
    label: "University Hall (Front Row)",
    url: `${BASE}irs/university_hall_front_row.wav`
  },
  {
    id: "university_hall_stalls",
    label: "University Hall (Stalls)",
    url: `${BASE}irs/university_hall_stalls.wav`
  }
];

export const REVERB_PRESET_MAP = new Map<ReverbPresetId, ReverbPresetDefinition>(
  REVERB_PRESETS.map((preset) => [preset.id, preset])
);

export const EQ_PRESET_NAMES: EqPresetName[] = [
  "Flat",
  "Bass Boost",
  "Vocal",
  "Treble Boost"
];

export const EQ_MIN_FREQ = 20;
export const EQ_MAX_FREQ = 20000;
export const EQ_MIN_GAIN_DB = -18;
export const EQ_MAX_GAIN_DB = 18;
export const EQ_MIN_Q = 0.1;
export const EQ_MAX_Q = 18;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toSafeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isEqBandType(value: unknown): value is EqBandType {
  return (
    value === "highpass" ||
    value === "lowshelf" ||
    value === "peaking" ||
    value === "highshelf" ||
    value === "lowpass"
  );
}

export function bandSupportsGain(type: EqBandType): boolean {
  return type === "lowshelf" || type === "peaking" || type === "highshelf";
}

function cloneBand(band: EqBand): EqBand {
  return {
    id: band.id,
    label: band.label,
    type: band.type,
    frequency: band.frequency,
    gainDb: band.gainDb,
    q: band.q,
    enabled: band.enabled
  };
}

const DEFAULT_EQ_BANDS: EqBand[] = [
  { id: "hp", label: "HP", type: "highpass", frequency: 30, gainDb: 0, q: 0.707, enabled: false },
  { id: "low", label: "Low", type: "lowshelf", frequency: 90, gainDb: 0, q: 0.9, enabled: true },
  { id: "b1", label: "B1", type: "peaking", frequency: 250, gainDb: 0, q: 1.0, enabled: true },
  { id: "b2", label: "B2", type: "peaking", frequency: 800, gainDb: 0, q: 1.0, enabled: true },
  { id: "b3", label: "B3", type: "peaking", frequency: 2200, gainDb: 0, q: 1.0, enabled: true },
  { id: "b4", label: "B4", type: "peaking", frequency: 6000, gainDb: 0, q: 1.0, enabled: true },
  { id: "high", label: "High", type: "highshelf", frequency: 10000, gainDb: 0, q: 0.9, enabled: true },
  { id: "lp", label: "LP", type: "lowpass", frequency: 19000, gainDb: 0, q: 0.707, enabled: false }
];

export function createDefaultEqBands(): EqBand[] {
  return DEFAULT_EQ_BANDS.map(cloneBand);
}

type EqPresetPatch = {
  id: EqBand["id"];
  enabled?: boolean;
  frequency?: number;
  gainDb?: number;
  q?: number;
};

const EQ_PRESET_PATCHES: Record<EqPresetName, EqPresetPatch[]> = {
  Flat: [
    { id: "hp", enabled: false, frequency: 30, q: 0.707 },
    { id: "low", gainDb: 0, q: 0.9 },
    { id: "b1", gainDb: 0, q: 1.0 },
    { id: "b2", gainDb: 0, q: 1.0 },
    { id: "b3", gainDb: 0, q: 1.0 },
    { id: "b4", gainDb: 0, q: 1.0 },
    { id: "high", gainDb: 0, q: 0.9 },
    { id: "lp", enabled: false, frequency: 19000, q: 0.707 }
  ],
  "Bass Boost": [
    { id: "hp", enabled: false },
    { id: "low", gainDb: 7, frequency: 95, q: 0.8 },
    { id: "b1", gainDb: 4, frequency: 180, q: 1.1 },
    { id: "b2", gainDb: 1.5, frequency: 550, q: 1.0 },
    { id: "b3", gainDb: -1.5, frequency: 2300, q: 1.2 },
    { id: "b4", gainDb: -1, frequency: 5200, q: 1.1 },
    { id: "high", gainDb: -2, frequency: 9500, q: 0.9 },
    { id: "lp", enabled: false }
  ],
  Vocal: [
    { id: "hp", enabled: true, frequency: 75, q: 0.707 },
    { id: "low", gainDb: -2.5, frequency: 150, q: 0.85 },
    { id: "b1", gainDb: -1, frequency: 320, q: 1.0 },
    { id: "b2", gainDb: 2.5, frequency: 1200, q: 1.15 },
    { id: "b3", gainDb: 3.5, frequency: 3000, q: 1.25 },
    { id: "b4", gainDb: 1, frequency: 6500, q: 1.1 },
    { id: "high", gainDb: 1.5, frequency: 12000, q: 0.9 },
    { id: "lp", enabled: false }
  ],
  "Treble Boost": [
    { id: "hp", enabled: false },
    { id: "low", gainDb: -2, frequency: 120, q: 0.9 },
    { id: "b1", gainDb: -1, frequency: 280, q: 1.0 },
    { id: "b2", gainDb: 0.5, frequency: 1400, q: 1.0 },
    { id: "b3", gainDb: 2.5, frequency: 4200, q: 1.1 },
    { id: "b4", gainDb: 3.5, frequency: 7800, q: 1.05 },
    { id: "high", gainDb: 6, frequency: 11000, q: 0.85 },
    { id: "lp", enabled: false }
  ]
};

export function applyEqPreset(baseBands: readonly EqBand[], presetName: EqPresetName): EqBand[] {
  const normalized = sanitizeEqBands(baseBands);
  const byId = new Map(normalized.map((band) => [band.id, cloneBand(band)]));
  for (const patch of EQ_PRESET_PATCHES[presetName]) {
    const target = byId.get(patch.id);
    if (!target) continue;

    if (typeof patch.enabled === "boolean") target.enabled = patch.enabled;
    if (typeof patch.frequency === "number") target.frequency = patch.frequency;
    if (typeof patch.gainDb === "number") target.gainDb = patch.gainDb;
    if (typeof patch.q === "number") target.q = patch.q;
  }

  return sanitizeEqBands(Array.from(byId.values()));
}

export function sanitizeEqBands(input: unknown): EqBand[] {
  const defaults = createDefaultEqBands();
  if (!Array.isArray(input)) return defaults;

  const rawItems = input as unknown[];

  return defaults.map((fallbackBand, index) => {
    const byId = rawItems.find((candidate) => {
      if (!candidate || typeof candidate !== "object") return false;
      const record = candidate as Record<string, unknown>;
      return record.id === fallbackBand.id;
    });

    const byIndex = rawItems[index];
    const sourceRaw = byId ?? byIndex;
    if (!sourceRaw || typeof sourceRaw !== "object") {
      return fallbackBand;
    }

    const source = sourceRaw as Record<string, unknown>;
    const type = isEqBandType(source.type) ? source.type : fallbackBand.type;

    const frequency = clamp(
      toSafeNumber(source.frequency, fallbackBand.frequency),
      EQ_MIN_FREQ,
      EQ_MAX_FREQ
    );

    const gainDb = clamp(
      toSafeNumber(source.gainDb, fallbackBand.gainDb),
      EQ_MIN_GAIN_DB,
      EQ_MAX_GAIN_DB
    );

    const q = clamp(toSafeNumber(source.q, fallbackBand.q), EQ_MIN_Q, EQ_MAX_Q);

    return {
      id: fallbackBand.id,
      label: typeof source.label === "string" ? source.label : fallbackBand.label,
      type,
      frequency,
      gainDb,
      q,
      enabled:
        typeof source.enabled === "boolean"
          ? source.enabled
          : fallbackBand.enabled
    };
  });
}

export function formatEqFrequency(value: number): string {
  if (!Number.isFinite(value)) return "0 Hz";
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} kHz`;
  }
  return `${Math.round(value)} Hz`;
}