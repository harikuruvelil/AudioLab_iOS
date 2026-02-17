import type { EqBandGains, EqPresetName, ReverbPresetId } from "./types";

export interface ReverbPresetDefinition {
  id: ReverbPresetId;
  label: string;
  url: string | null;
}

export const REVERB_PRESETS: ReverbPresetDefinition[] = [
  { id: "off", label: "Off", url: null },
  { id: "air_museum_1", label: "Air Museum 1", url: "/irs/air_museum_1.wav" },
  { id: "air_museum_2", label: "Air Museum 2", url: "/irs/air_museum_2.wav" },
  { id: "auditorium", label: "Auditorium", url: "/irs/auditorium.wav" },
  { id: "drum_room_1", label: "Drum Room 1", url: "/irs/drum_room_1.wav" },
  { id: "drum_room_2", label: "Drum Room 2", url: "/irs/drum_room_2.wav" },
  { id: "stairwell", label: "Stairwell", url: "/irs/stairwell.wav" },
  { id: "theatre_1", label: "Theatre 1", url: "/irs/theatre_1.wav" },
  { id: "theatre_2", label: "Theatre 2", url: "/irs/theatre_2.wav" },
  {
    id: "university_hall_center_rows",
    label: "University Hall (Center Rows)",
    url: "/irs/university_hall_center_rows.wav"
  },
  {
    id: "university_hall_front_row",
    label: "University Hall (Front Row)",
    url: "/irs/university_hall_front_row.wav"
  },
  {
    id: "university_hall_stalls",
    label: "University Hall (Stalls)",
    url: "/irs/university_hall_stalls.wav"
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

export const EQ_BAND_LABELS = [
  "Low Shelf 100 Hz",
  "Peaking 250 Hz",
  "Peaking 1000 Hz",
  "Peaking 4000 Hz",
  "High Shelf 10000 Hz"
] as const;

export const EQ_PRESETS: Record<EqPresetName, EqBandGains> = {
  Flat: [0, 0, 0, 0, 0],
  "Bass Boost": [6, 3, 0, -1, -2],
  Vocal: [-2, 0, 3, 4, 1],
  "Treble Boost": [-2, -1, 0, 4, 6]
};

