import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  EQ_PRESET_NAMES,
  REVERB_PRESET_MAP,
  REVERB_PRESETS,
  createDefaultEqBands,
  sanitizeEqBands
} from "./audioFxPresets";
import { TapeAudioEngine, type WaveformAnalyserNodes } from "./audioEngine";
import {
  deleteTrackById,
  getAllTracks,
  getLibraryStoredBytes,
  getTrackBlob,
  putTrack
} from "./db";
import { LibraryScreen } from "./components/LibraryScreen";
import { PlayerScreen } from "./components/PlayerScreen";
import { Toast } from "./components/Toast";
import type {
  EqBand,
  EqPresetName,
  PlaybackState,
  QualityState,
  RepeatMode,
  ReverbPresetId,
  StorageSummary,
  TrackMeta,
  WaveformMode
} from "./types";
import {
  createTrackId,
  getMimeFromFileName,
  isSupportedAudioFileName,
  probeDurationFromFile,
  stripExtension
} from "./utils";

type Tab = "player" | "library";
type EqCustomSlotName = "Custom 1" | "Custom 2" | "Custom 3";
type EqCurveSelection = EqPresetName | EqCustomSlotName;
type AppearanceThemeId =
  | "arctic"
  | "mint"
  | "sunset"
  | "midnight"
  | "ocean"
  | "ember"
  | "orchid"
  | "aurora";

interface AppearanceThemeDefinition {
  id: AppearanceThemeId;
  label: string;
  accent: string;
  accent2: string;
  bg: string;
  bgDeep: string;
  tint: string;
}

const EQ_CUSTOM_SLOT_NAMES: EqCustomSlotName[] = ["Custom 1", "Custom 2", "Custom 3"];
const EQ_CURVE_OPTIONS: EqCurveSelection[] = [...EQ_PRESET_NAMES, ...EQ_CUSTOM_SLOT_NAMES];

const APPEARANCE_THEMES: Record<AppearanceThemeId, AppearanceThemeDefinition> = {
  arctic: {
    id: "arctic",
    label: "Arctic Glass",
    accent: "#7BE0FF",
    accent2: "#8EAEFF",
    bg: "#0A1220",
    bgDeep: "#060B15",
    tint: "rgba(180, 223, 255, 0.26)"
  },
  mint: {
    id: "mint",
    label: "Mint Frost",
    accent: "#78F1D4",
    accent2: "#4FC3AE",
    bg: "#081A18",
    bgDeep: "#05110F",
    tint: "rgba(143, 255, 218, 0.24)"
  },
  sunset: {
    id: "sunset",
    label: "Sunset Glass",
    accent: "#FFB087",
    accent2: "#FF6EA7",
    bg: "#1A101D",
    bgDeep: "#0D0812",
    tint: "rgba(255, 184, 150, 0.24)"
  },
  midnight: {
    id: "midnight",
    label: "Midnight Frost",
    accent: "#B9C5FF",
    accent2: "#7D8FFF",
    bg: "#090B1A",
    bgDeep: "#04060F",
    tint: "rgba(184, 193, 255, 0.23)"
  },
  ocean: {
    id: "ocean",
    label: "Ocean Prism",
    accent: "#5FE8FF",
    accent2: "#3A9CFF",
    bg: "#071A26",
    bgDeep: "#041019",
    tint: "rgba(109, 228, 255, 0.22)"
  },
  ember: {
    id: "ember",
    label: "Ember Glass",
    accent: "#FFB16F",
    accent2: "#FF5D6C",
    bg: "#1D1110",
    bgDeep: "#0D0708",
    tint: "rgba(255, 170, 120, 0.23)"
  },
  orchid: {
    id: "orchid",
    label: "Orchid Haze",
    accent: "#F3A8FF",
    accent2: "#8F84FF",
    bg: "#160F24",
    bgDeep: "#090612",
    tint: "rgba(222, 170, 255, 0.22)"
  },
  aurora: {
    id: "aurora",
    label: "Aurora Mist",
    accent: "#7BFFC5",
    accent2: "#61C9FF",
    bg: "#0A1C1A",
    bgDeep: "#04100E",
    tint: "rgba(145, 255, 220, 0.22)"
  }
};

const AUDIO_SETTINGS_STORAGE_KEY = "music-slowing-pwa-audio-settings-v1";
const TRANSPORT_SETTINGS_STORAGE_KEY = "music-slowing-pwa-transport-settings-v1";

const EMPTY_PLAYBACK: PlaybackState = {
  trackId: null,
  isReady: false,
  isPlaying: false,
  rate: 1,
  currentTime: 0,
  duration: 0,
  reverbEnabled: false,
  reverbPresetId: "off",
  reverbWet: 0.25,
  eqEnabled: false,
  eqBands: createDefaultEqBands(),
  eqPresetName: "Flat",
  quality: {
    status: "checking",
    contextHz: null,
    trackHz: null,
    irHz: null,
    trackResampled: false,
    irResampled: false,
    reverbActive: false
  },
  clipWarning: false
};

interface PersistedAudioSettings {
  rate: number;
  reverbEnabled: boolean;
  reverbPresetId: ReverbPresetId;
  reverbWet: number;
  eqEnabled: boolean;
  eqBands: EqBand[];
  eqPresetName: EqPresetName | null;
  eqCustomSlots: EqBand[][];
  eqCurveSelection: EqCurveSelection;
  appearanceThemeId: AppearanceThemeId;
  waveformEnabled: boolean;
  waveformMode: WaveformMode;
}

interface PersistedTransportSettings {
  repeatMode: RepeatMode;
  shuffleEnabled: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isEqCustomSlotName(value: string): value is EqCustomSlotName {
  return EQ_CUSTOM_SLOT_NAMES.includes(value as EqCustomSlotName);
}

function isEqPresetName(value: string): value is EqPresetName {
  return EQ_PRESET_NAMES.includes(value as EqPresetName);
}

function createDefaultEqCustomSlots(): EqBand[][] {
  return EQ_CUSTOM_SLOT_NAMES.map(() => createDefaultEqBands());
}

function cloneEqBands(bands: readonly EqBand[]): EqBand[] {
  return bands.map((band) => ({ ...band }));
}

function eqBandsEqual(a: readonly EqBand[], b: readonly EqBand[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left.id !== right.id ||
      left.label !== right.label ||
      left.type !== right.type ||
      left.frequency !== right.frequency ||
      left.gainDb !== right.gainDb ||
      left.q !== right.q ||
      left.enabled !== right.enabled
    ) {
      return false;
    }
  }
  return true;
}

function qualityStateEqual(a: QualityState, b: QualityState): boolean {
  if (a === b) return true;
  return (
    a.status === b.status &&
    a.contextHz === b.contextHz &&
    a.trackHz === b.trackHz &&
    a.irHz === b.irHz &&
    a.trackResampled === b.trackResampled &&
    a.irResampled === b.irResampled &&
    a.reverbActive === b.reverbActive
  );
}

function shuffleIds(ids: string[]): string[] {
  const next = [...ids];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function parsePersistedSettings(raw: unknown): PersistedAudioSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;

  const rate = typeof value.rate === "number" ? clamp(value.rate, 0.5, 1.5) : 1;
  const reverbEnabled = Boolean(value.reverbEnabled);
  const reverbWet =
    typeof value.reverbWet === "number" ? clamp(value.reverbWet, 0, 0.6) : 0.25;

  const presetCandidate = value.reverbPresetId;
  const reverbPresetId: ReverbPresetId =
    typeof presetCandidate === "string" &&
      REVERB_PRESET_MAP.has(presetCandidate as ReverbPresetId)
      ? (presetCandidate as ReverbPresetId)
      : "off";

  const eqEnabled = Boolean(value.eqEnabled);

  const legacyEqBandGainsRaw = value.eqBandGains;
  const eqBandsRaw = value.eqBands;
  const parsedEqBands = sanitizeEqBands(eqBandsRaw);
  let eqBands = parsedEqBands;

  // Backwards compatibility with older storage shape that only had 5 gains.
  if (!Array.isArray(eqBandsRaw) && Array.isArray(legacyEqBandGainsRaw)) {
    const defaults = createDefaultEqBands();
    const gainBandIds = defaults
      .filter((band) => band.type === "lowshelf" || band.type === "peaking" || band.type === "highshelf")
      .map((band) => band.id);
    const legacyGains = legacyEqBandGainsRaw.filter(
      (gain): gain is number => typeof gain === "number"
    );
    let gainIndex = 0;
    eqBands = defaults.map((band) => {
      if (gainBandIds.includes(band.id) && gainIndex < legacyGains.length) {
        const next = {
          ...band,
          gainDb: clamp(legacyGains[gainIndex], -18, 18)
        };
        gainIndex += 1;
        return next;
      }
      return band;
    });
  }

  const eqPresetNameRaw = value.eqPresetName;
  const eqPresetName: EqPresetName | null =
    typeof eqPresetNameRaw === "string" &&
      isEqPresetName(eqPresetNameRaw)
      ? (eqPresetNameRaw as EqPresetName)
      : null;

  const customSlotsRaw = value.eqCustomSlots;
  const eqCustomSlots: EqBand[][] =
    Array.isArray(customSlotsRaw) && customSlotsRaw.length === EQ_CUSTOM_SLOT_NAMES.length
      ? customSlotsRaw.map((slot) => sanitizeEqBands(slot))
      : createDefaultEqCustomSlots();

  const eqCurveSelectionRaw = value.eqCurveSelection;
  let eqCurveSelection: EqCurveSelection = eqPresetName ?? "Custom 1";
  if (typeof eqCurveSelectionRaw === "string") {
    if (isEqPresetName(eqCurveSelectionRaw) || isEqCustomSlotName(eqCurveSelectionRaw)) {
      eqCurveSelection = eqCurveSelectionRaw;
    }
  }

  const appearanceThemeRaw = value.appearanceThemeId;
  const appearanceThemeId: AppearanceThemeId =
    typeof appearanceThemeRaw === "string" &&
      Object.prototype.hasOwnProperty.call(APPEARANCE_THEMES, appearanceThemeRaw)
      ? (appearanceThemeRaw as AppearanceThemeId)
      : "arctic";

  const waveformEnabled =
    typeof value.waveformEnabled === "boolean" ? value.waveformEnabled : true;
  const waveformModeRaw = value.waveformMode;
  const waveformMode: WaveformMode =
    waveformModeRaw === "linear" ||
      waveformModeRaw === "circular" ||
      waveformModeRaw === "vectorscope"
      ? waveformModeRaw
      : "linear";

  return {
    rate,
    reverbEnabled,
    reverbPresetId,
    reverbWet,
    eqEnabled,
    eqBands,
    eqPresetName,
    eqCustomSlots,
    eqCurveSelection,
    appearanceThemeId,
    waveformEnabled,
    waveformMode
  };
}

function parseTransportSettings(raw: unknown): PersistedTransportSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const repeatModeRaw = value.repeatMode;

  const repeatMode: RepeatMode =
    repeatModeRaw === "off" || repeatModeRaw === "one" || repeatModeRaw === "all"
      ? repeatModeRaw
      : "off";

  const shuffleEnabled = Boolean(value.shuffleEnabled);

  return { repeatMode, shuffleEnabled };
}

function readPersistedSettings(): PersistedAudioSettings | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(AUDIO_SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    return parsePersistedSettings(JSON.parse(raw));
  } catch {
    return null;
  }
}

function readTransportSettings(): PersistedTransportSettings {
  if (typeof window === "undefined") {
    return { repeatMode: "off", shuffleEnabled: false };
  }
  try {
    const raw = window.localStorage.getItem(TRANSPORT_SETTINGS_STORAGE_KEY);
    if (!raw) return { repeatMode: "off", shuffleEnabled: false };
    return parseTransportSettings(JSON.parse(raw)) ?? { repeatMode: "off", shuffleEnabled: false };
  } catch {
    return { repeatMode: "off", shuffleEnabled: false };
  }
}

interface PlayTrackOptions {
  registerShuffleSelection?: boolean;
}

export default function App() {
  const initialAudioSettings = useMemo(readPersistedSettings, []);
  const initialTransport = useMemo(readTransportSettings, []);

  const [activeTab, setActiveTab] = useState<Tab>("player");
  const [tracks, setTracks] = useState<TrackMeta[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [playback, setPlayback] = useState<PlaybackState>(EMPTY_PLAYBACK);
  const [storage, setStorage] = useState<StorageSummary>({
    appBytes: 0,
    usageBytes: null,
    quotaBytes: null
  });
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(initialTransport.repeatMode);
  const [shuffleEnabled, setShuffleEnabled] = useState<boolean>(
    initialTransport.shuffleEnabled
  );
  const [waveformEnabled, setWaveformEnabled] = useState<boolean>(
    initialAudioSettings?.waveformEnabled ?? true
  );
  const [waveformMode, setWaveformMode] = useState<WaveformMode>(
    initialAudioSettings?.waveformMode ?? "linear"
  );
  const [appearanceThemeId, setAppearanceThemeId] = useState<AppearanceThemeId>(
    initialAudioSettings?.appearanceThemeId ?? "arctic"
  );
  const [eqCurveSelection, setEqCurveSelection] = useState<EqCurveSelection>(
    initialAudioSettings?.eqCurveSelection ??
    (initialAudioSettings?.eqPresetName ?? "Custom 1")
  );
  const [eqCustomSlots, setEqCustomSlots] = useState<EqBand[][]>(
    initialAudioSettings?.eqCustomSlots ?? createDefaultEqCustomSlots()
  );
  const [queueTrackIds, setQueueTrackIds] = useState<string[]>([]);

  const engineRef = useRef<TapeAudioEngine | null>(null);
  const onTrackEndedRef = useRef<() => Promise<void> | void>(() => { });
  const queueRef = useRef<string[]>([]);
  const appRootRef = useRef<HTMLDivElement | null>(null);
  const bgPhaseRef = useRef(0);
  const bgSmoothedRef = useRef(0);
  const bgTargetRef = useRef(0);

  // Shuffle queue state that persists while app is running.
  const shuffleHistoryRef = useRef<string[]>([]);
  const shuffleCursorRef = useRef<number>(-1);
  const shufflePoolRef = useRef<string[]>([]);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
  }, []);

  const trackIds = useMemo(() => tracks.map((track) => track.id), [tracks]);
  const setQueue = useCallback((nextQueue: string[]) => {
    queueRef.current = nextQueue;
    setQueueTrackIds(nextQueue);
  }, []);

  const effectiveTrackId = selectedTrackId ?? playback.trackId;

  const buildShuffledPool = useCallback(
    (currentId: string | null, existingHistory: readonly string[] = []) => {
      const used = new Set(existingHistory);
      const candidates = trackIds.filter((id) => id !== currentId && !used.has(id));
      return shuffleIds(candidates);
    },
    [trackIds]
  );

  const seedShuffleState = useCallback(
    (currentId: string | null) => {
      if (!currentId || !trackIds.includes(currentId)) {
        shuffleHistoryRef.current = [];
        shuffleCursorRef.current = -1;
        shufflePoolRef.current = buildShuffledPool(null);
        return;
      }

      shuffleHistoryRef.current = [currentId];
      shuffleCursorRef.current = 0;
      shufflePoolRef.current = buildShuffledPool(currentId, [currentId]);
    },
    [buildShuffledPool, trackIds]
  );

  const registerShuffleSelection = useCallback(
    (trackId: string) => {
      if (!shuffleEnabled || !trackIds.includes(trackId)) return;

      const cursor = Math.max(shuffleCursorRef.current, -1);
      const history = shuffleHistoryRef.current.slice(0, cursor + 1);
      const last = history[history.length - 1];

      if (last !== trackId) {
        history.push(trackId);
      }

      shuffleHistoryRef.current = history;
      shuffleCursorRef.current = history.length - 1;
      shufflePoolRef.current = buildShuffledPool(trackId, history);
    },
    [buildShuffledPool, shuffleEnabled, trackIds]
  );

  const playTrackById = useCallback(
    async (trackId: string, options: PlayTrackOptions = {}) => {
      const engine = engineRef.current;
      if (!engine) return;

      if (shuffleEnabled && options.registerShuffleSelection !== false) {
        registerShuffleSelection(trackId);
      }

      const blob = await getTrackBlob(trackId);
      if (!blob) {
        showToast("Audio bytes for this track are missing. Re-import it.");
        return;
      }

      try {
        await engine.playTrack(trackId, blob);
        setSelectedTrackId(trackId);
        setActiveTab("player");
      } catch {
        showToast("Could not decode or play this file on iOS Safari.");
      }
    },
    [registerShuffleSelection, showToast, shuffleEnabled]
  );

  const enqueueTrackById = useCallback(
    (trackId: string) => {
      if (!trackIds.includes(trackId)) return;
      const nextQueue = [...queueRef.current, trackId];
      setQueue(nextQueue);

      const queuedTrack = tracks.find((track) => track.id === trackId);
      if (queuedTrack) {
        showToast(`Queued "${queuedTrack.displayName}".`);
      }
    },
    [setQueue, showToast, trackIds, tracks]
  );

  const dequeueNextQueuedTrackId = useCallback((): string | null => {
    const validQueue = queueRef.current.filter((id) => trackIds.includes(id));
    if (validQueue.length !== queueRef.current.length) {
      setQueue(validQueue);
    }

    if (validQueue.length === 0) return null;

    const [nextTrackId, ...remaining] = validQueue;
    setQueue(remaining);
    return nextTrackId;
  }, [setQueue, trackIds]);

  const removeQueueItemAt = useCallback(
    (index: number) => {
      if (index < 0 || index >= queueRef.current.length) return;
      const nextQueue = queueRef.current.filter((_, itemIndex) => itemIndex !== index);
      setQueue(nextQueue);
    },
    [setQueue]
  );

  const clearQueue = useCallback(() => {
    if (queueRef.current.length === 0) return;
    setQueue([]);
  }, [setQueue]);

  const playQueuedTrackAt = useCallback(
    async (index: number) => {
      if (index < 0 || index >= queueRef.current.length) return;
      const queueCopy = [...queueRef.current];
      const [trackId] = queueCopy.splice(index, 1);
      setQueue(queueCopy);
      await playTrackById(trackId, { registerShuffleSelection: true });
    },
    [playTrackById, setQueue]
  );

  const getSequentialNextTrackId = useCallback(
    (currentId: string): string | null => {
      if (trackIds.length === 0) return null;
      const currentIndex = trackIds.indexOf(currentId);
      if (currentIndex < 0) return trackIds[0] ?? null;
      if (currentIndex < trackIds.length - 1) return trackIds[currentIndex + 1];
      if (repeatMode === "all") return trackIds[0] ?? null;
      return null;
    },
    [repeatMode, trackIds]
  );

  const getSequentialPrevTrackId = useCallback(
    (currentId: string): string | null => {
      if (trackIds.length === 0) return null;
      const currentIndex = trackIds.indexOf(currentId);
      if (currentIndex < 0) return trackIds[0] ?? null;
      if (currentIndex > 0) return trackIds[currentIndex - 1];
      if (repeatMode === "all") return trackIds[trackIds.length - 1] ?? null;
      return null;
    },
    [repeatMode, trackIds]
  );

  const getShuffleNextTrackId = useCallback(
    (currentId: string): string | null => {
      if (trackIds.length === 0) return null;
      if (trackIds.length === 1) {
        if (repeatMode === "all") return currentId;
        return null;
      }

      let history = shuffleHistoryRef.current.filter((id) => trackIds.includes(id));
      let cursor = Math.min(shuffleCursorRef.current, history.length - 1);

      if (cursor < 0 || history[cursor] !== currentId) {
        const existingIndex = history.lastIndexOf(currentId);
        if (existingIndex >= 0) {
          cursor = existingIndex;
        } else {
          history = history.slice(0, cursor + 1);
          history.push(currentId);
          cursor = history.length - 1;
        }
      }

      if (cursor < history.length - 1) {
        shuffleHistoryRef.current = history;
        shuffleCursorRef.current = cursor + 1;
        return history[cursor + 1];
      }

      let pool = shufflePoolRef.current.filter(
        (id) => trackIds.includes(id) && id !== currentId && !history.includes(id)
      );

      if (pool.length === 0) {
        if (repeatMode !== "all") {
          shuffleHistoryRef.current = history;
          shuffleCursorRef.current = cursor;
          shufflePoolRef.current = [];
          return null;
        }
        pool = buildShuffledPool(currentId);
      }

      let nextId = pool.shift() ?? null;
      if (!nextId) {
        shuffleHistoryRef.current = history;
        shuffleCursorRef.current = cursor;
        shufflePoolRef.current = pool;
        return null;
      }

      if (nextId === currentId && trackIds.length > 1) {
        const alt = pool.shift();
        if (alt) {
          pool.push(nextId);
          nextId = alt;
        }
      }

      history = history.slice(0, cursor + 1);
      history.push(nextId);

      shuffleHistoryRef.current = history;
      shuffleCursorRef.current = history.length - 1;
      shufflePoolRef.current = pool;

      return nextId;
    },
    [buildShuffledPool, repeatMode, trackIds]
  );

  const getShufflePrevTrackId = useCallback(
    (currentId: string): string | null => {
      if (trackIds.length === 0) return null;

      const history = shuffleHistoryRef.current.filter((id) => trackIds.includes(id));
      let cursor = Math.min(shuffleCursorRef.current, history.length - 1);

      if (cursor < 0) return null;

      if (history[cursor] !== currentId) {
        const existingIndex = history.lastIndexOf(currentId);
        if (existingIndex >= 0) {
          cursor = existingIndex;
        } else {
          return null;
        }
      }

      if (cursor <= 0) return null;

      shuffleHistoryRef.current = history;
      shuffleCursorRef.current = cursor - 1;

      return history[cursor - 1];
    },
    [trackIds]
  );

  const handleTrackEnded = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;

    const currentId = selectedTrackId ?? playback.trackId;
    if (!currentId) return;

    if (repeatMode === "one") {
      await engine.play();
      return;
    }

    const queuedNextId = dequeueNextQueuedTrackId();
    if (queuedNextId) {
      await playTrackById(queuedNextId, { registerShuffleSelection: true });
      return;
    }

    const nextId = shuffleEnabled
      ? getShuffleNextTrackId(currentId)
      : getSequentialNextTrackId(currentId);

    if (!nextId) {
      return;
    }

    await playTrackById(nextId, { registerShuffleSelection: false });
  }, [
    dequeueNextQueuedTrackId,
    getSequentialNextTrackId,
    getShuffleNextTrackId,
    playback.trackId,
    playTrackById,
    repeatMode,
    selectedTrackId,
    shuffleEnabled
  ]);

  useEffect(() => {
    onTrackEndedRef.current = handleTrackEnded;
  }, [handleTrackEnded]);

  useEffect(() => {
    if (!toastMessage) return;
    const timeoutId = window.setTimeout(() => setToastMessage(null), 3500);
    return () => window.clearTimeout(timeoutId);
  }, [toastMessage]);

  const refreshStorage = useCallback(async () => {
    const appBytes = await getLibraryStoredBytes();

    let usageBytes: number | null = null;
    let quotaBytes: number | null = null;

    if (navigator.storage?.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        usageBytes = typeof estimate.usage === "number" ? estimate.usage : null;
        quotaBytes = typeof estimate.quota === "number" ? estimate.quota : null;
      } catch {
        usageBytes = null;
        quotaBytes = null;
      }
    }

    setStorage({ appBytes, usageBytes, quotaBytes });
  }, []);

  const refreshLibrary = useCallback(async () => {
    const allTracks = await getAllTracks();
    setTracks(allTracks);

    setSelectedTrackId((previous) => {
      if (previous && allTracks.some((track) => track.id === previous)) {
        return previous;
      }
      return allTracks[0]?.id ?? null;
    });

    await refreshStorage();
  }, [refreshStorage]);

  useEffect(() => {
    const engine = new TapeAudioEngine();
    engineRef.current = engine;

    const unsubscribeState = engine.subscribe((state) => {
      setPlayback((previous) => {
        const eqBands = eqBandsEqual(previous.eqBands, state.eqBands)
          ? previous.eqBands
          : state.eqBands;
        const quality = qualityStateEqual(previous.quality, state.quality)
          ? previous.quality
          : state.quality;

        const next: PlaybackState = {
          ...state,
          eqBands,
          quality
        };

        if (
          previous.trackId === next.trackId &&
          previous.isReady === next.isReady &&
          previous.isPlaying === next.isPlaying &&
          previous.rate === next.rate &&
          Math.abs(previous.currentTime - next.currentTime) < 0.0005 &&
          previous.duration === next.duration &&
          previous.reverbEnabled === next.reverbEnabled &&
          previous.reverbPresetId === next.reverbPresetId &&
          previous.reverbWet === next.reverbWet &&
          previous.eqEnabled === next.eqEnabled &&
          previous.eqPresetName === next.eqPresetName &&
          previous.clipWarning === next.clipWarning &&
          previous.eqBands === next.eqBands &&
          previous.quality === next.quality
        ) {
          return previous;
        }

        return next;
      });
    });
    const unsubscribeError = engine.onError(showToast);
    const unsubscribeEnded = engine.onEnded(() => {
      void Promise.resolve(onTrackEndedRef.current()).catch(() => {
        showToast("Playback transition error.");
      });
    });

    const restored = initialAudioSettings;
    if (restored) {
      engine.setRate(restored.rate);
      engine.setReverbEnabled(restored.reverbEnabled);
      engine.setReverbWet(restored.reverbWet);
      void engine.setReverbPreset(restored.reverbPresetId);
      engine.setEqEnabled(restored.eqEnabled);
      if (isEqPresetName(restored.eqCurveSelection)) {
        engine.setEqPreset(restored.eqCurveSelection);
      } else {
        const slotIndex = EQ_CUSTOM_SLOT_NAMES.indexOf(restored.eqCurveSelection);
        const slotBands = restored.eqCustomSlots[slotIndex] ?? restored.eqBands;
        engine.setEqBands(slotBands, null);
      }
    }

    void refreshLibrary();

    return () => {
      unsubscribeState();
      unsubscribeError();
      unsubscribeEnded();
      void engine.dispose();
      engineRef.current = null;
    };
  }, [initialAudioSettings, refreshLibrary, showToast]);

  useEffect(() => {
    if (!shuffleEnabled) {
      shuffleHistoryRef.current = [];
      shuffleCursorRef.current = -1;
      shufflePoolRef.current = [];
      return;
    }

    const idsSet = new Set(trackIds);
    const currentId = selectedTrackId ?? playback.trackId;

    let history = shuffleHistoryRef.current.filter((id) => idsSet.has(id));
    let cursor = Math.min(shuffleCursorRef.current, history.length - 1);

    if (currentId && idsSet.has(currentId)) {
      if (cursor < 0 || history[cursor] !== currentId) {
        history = history.slice(0, Math.max(cursor + 1, 0));
        history.push(currentId);
        cursor = history.length - 1;
      }
    }

    let pool = shufflePoolRef.current.filter(
      (id) => idsSet.has(id) && !history.includes(id)
    );
    if (pool.length === 0) {
      pool = buildShuffledPool(currentId ?? null, history);
    }

    shuffleHistoryRef.current = history;
    shuffleCursorRef.current = cursor;
    shufflePoolRef.current = pool;
  }, [buildShuffledPool, playback.trackId, selectedTrackId, shuffleEnabled, trackIds]);

  useEffect(() => {
    const filteredQueue = queueRef.current.filter((id) => trackIds.includes(id));
    if (filteredQueue.length !== queueRef.current.length) {
      setQueue(filteredQueue);
    }
  }, [setQueue, trackIds]);

  useEffect(() => {
    if (!isEqCustomSlotName(eqCurveSelection)) return;
    const slotIndex = EQ_CUSTOM_SLOT_NAMES.indexOf(eqCurveSelection);
    setEqCustomSlots((previous) => {
      const currentSlot = previous[slotIndex] ?? [];
      if (eqBandsEqual(currentSlot, playback.eqBands)) {
        return previous;
      }
      const next = [...previous];
      next[slotIndex] = cloneEqBands(playback.eqBands);
      return next;
    });
  }, [eqCurveSelection, playback.eqBands]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const payload: PersistedAudioSettings = {
      rate: playback.rate,
      reverbEnabled: playback.reverbEnabled,
      reverbPresetId: playback.reverbPresetId,
      reverbWet: playback.reverbWet,
      eqEnabled: playback.eqEnabled,
      eqBands: playback.eqBands,
      eqPresetName: playback.eqPresetName,
      eqCustomSlots,
      eqCurveSelection,
      appearanceThemeId,
      waveformEnabled,
      waveformMode
    };

    try {
      window.localStorage.setItem(AUDIO_SETTINGS_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage write failures.
    }
  }, [
    playback.rate,
    playback.reverbEnabled,
    playback.reverbPresetId,
    playback.reverbWet,
    playback.eqEnabled,
    playback.eqBands,
    playback.eqPresetName,
    eqCustomSlots,
    eqCurveSelection,
    appearanceThemeId,
    waveformEnabled,
    waveformMode
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const payload: PersistedTransportSettings = {
      repeatMode,
      shuffleEnabled
    };

    try {
      window.localStorage.setItem(
        TRANSPORT_SETTINGS_STORAGE_KEY,
        JSON.stringify(payload)
      );
    } catch {
      // Ignore storage write failures.
    }
  }, [repeatMode, shuffleEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let rafId = 0;
    let smoothed = bgSmoothedRef.current;
    let targetEnergy = bgTargetRef.current;
    let phase = bgPhaseRef.current;
    let lastFrameTimestamp = 0;
    let lastBassSampleTimestamp = 0;
    const heavyVisualMode = activeTab === "player" && playback.isPlaying;
    const frameIntervalMs = heavyVisualMode ? 1000 / 30 : 1000 / 18;
    const bassSampleIntervalMs = heavyVisualMode ? 1000 / 24 : 1000 / 14;

    const tick = (now: number) => {
      if (document.hidden) {
        rafId = window.requestAnimationFrame(tick);
        return;
      }

      if (lastFrameTimestamp <= 0) {
        lastFrameTimestamp = now;
      }
      const elapsed = now - lastFrameTimestamp;
      if (elapsed < frameIntervalMs) {
        rafId = window.requestAnimationFrame(tick);
        return;
      }
      lastFrameTimestamp = now;

      const deltaMs = Math.min(80, Math.max(0, elapsed));
      const deltaNorm = deltaMs / (1000 / 60);

      if (
        lastBassSampleTimestamp === 0 ||
        now - lastBassSampleTimestamp >= bassSampleIntervalMs
      ) {
        lastBassSampleTimestamp = now;
        const rawBass = engineRef.current?.getBassReactiveLevel(40, 280) ?? 0;
        // Raise sensitivity in musical bass range while keeping a stable ceiling.
        targetEnergy = clamp(Math.pow(rawBass, 0.66) * 1.62, 0, 1);
      }

      const smoothAlpha = clamp(0.11 * deltaNorm, 0.04, 0.24);
      smoothed = smoothed * (1 - smoothAlpha) + targetEnergy * smoothAlpha;
      phase += deltaMs * (heavyVisualMode ? 0.0012 : 0.0008);
      bgSmoothedRef.current = smoothed;
      bgTargetRef.current = targetEnergy;
      bgPhaseRef.current = phase;

      const root = appRootRef.current;
      if (root) {
        const visualEnergy = clamp(heavyVisualMode ? smoothed * 0.88 : smoothed * 0.62, 0, 1);
        const shiftX = Math.sin(phase) * (1.9 + visualEnergy * 4.6);
        const shiftY = Math.cos(phase * 0.83) * (1.2 + visualEnergy * 3.8);
        const angleOffset = Math.sin(phase * 0.57) * (2.4 + visualEnergy * 4.8);

        root.style.setProperty("--bg-energy", visualEnergy.toFixed(4));
        root.style.setProperty("--bg-flow-shift-x", `${shiftX.toFixed(3)}%`);
        root.style.setProperty("--bg-flow-shift-y", `${shiftY.toFixed(3)}%`);
        root.style.setProperty("--bg-flow-angle-offset", `${angleOffset.toFixed(3)}deg`);
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [activeTab, playback.isPlaying]);

  const appearanceTheme = APPEARANCE_THEMES[appearanceThemeId];
  const appStyle = useMemo(
    () =>
      ({
        "--accent": appearanceTheme.accent,
        "--accent-2": appearanceTheme.accent2,
        "--bg": appearanceTheme.bg,
        "--bg-deep": appearanceTheme.bgDeep,
        "--theme-tint": appearanceTheme.tint,
        "--bg-energy": 0,
        "--bg-orb-x": "52%",
        "--bg-orb-y": "24%",
        "--bg-orb2-x": "68%",
        "--bg-orb2-y": "70%",
        "--bg-flow-angle": "152deg",
        "--bg-flow-shift-x": "0%",
        "--bg-flow-shift-y": "0%",
        "--bg-flow-angle-offset": "0deg",
        "--bg-morph": 0.2
      }) as CSSProperties,
    [appearanceTheme]
  );

  const selectedTrack = useMemo(() => {
    if (!effectiveTrackId) return null;
    return tracks.find((track) => track.id === effectiveTrackId) ?? null;
  }, [tracks, effectiveTrackId]);

  const queueTracks = useMemo(
    () =>
      queueTrackIds
        .map((id) => tracks.find((track) => track.id === id) ?? null)
        .filter((track): track is TrackMeta => track !== null),
    [queueTrackIds, tracks]
  );

  const currentIndex = useMemo(() => {
    if (!effectiveTrackId) return -1;
    return tracks.findIndex((track) => track.id === effectiveTrackId);
  }, [tracks, effectiveTrackId]);

  const canGoPrev =
    tracks.length > 0 &&
    (playback.currentTime > 3 ||
      (shuffleEnabled
        ? shuffleCursorRef.current > 0
        : currentIndex > 0 || repeatMode === "all"));
  const canGoNext =
    tracks.length > 0 &&
    (queueTrackIds.length > 0 ||
      (shuffleEnabled
        ? trackIds.length > 1 || repeatMode === "all"
        : currentIndex < tracks.length - 1 || repeatMode !== "off"));

  const handleTogglePlay = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;

    if (playback.isPlaying) {
      engine.pause();
      return;
    }

    const targetId = effectiveTrackId ?? tracks[0]?.id;
    if (!targetId) {
      showToast("Import a track from Library first.");
      setActiveTab("library");
      return;
    }

    if (playback.trackId === targetId && playback.isReady) {
      await engine.play();
      return;
    }

    await playTrackById(targetId, { registerShuffleSelection: true });
  }, [
    effectiveTrackId,
    playback.isPlaying,
    playback.isReady,
    playback.trackId,
    playTrackById,
    showToast,
    tracks
  ]);

  const handleRateChange = useCallback((nextRate: number) => {
    engineRef.current?.setRate(nextRate);
  }, []);

  const handleSeekCommit = useCallback((targetSeconds: number) => {
    engineRef.current?.seek(targetSeconds);
  }, []);

  const handleReverbEnabledChange = useCallback((enabled: boolean) => {
    engineRef.current?.setReverbEnabled(enabled);
  }, []);

  const handleReverbPresetChange = useCallback(async (presetId: ReverbPresetId) => {
    const engine = engineRef.current;
    if (!engine) return;
    await engine.setReverbPreset(presetId);
  }, []);

  const handleReverbWetChange = useCallback((wet: number) => {
    engineRef.current?.setReverbWet(wet);
  }, []);

  const handleNextReverbPreset = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;

    const index = REVERB_PRESETS.findIndex((preset) => preset.id === playback.reverbPresetId);
    const nextIndex = index >= 0 ? (index + 1) % REVERB_PRESETS.length : 0;
    await engine.setReverbPreset(REVERB_PRESETS[nextIndex].id);
  }, [playback.reverbPresetId]);

  const handleEqEnabledChange = useCallback((enabled: boolean) => {
    engineRef.current?.setEqEnabled(enabled);
  }, []);

  const handleEqBandConfigChange = useCallback(
    (
      bandId: string,
      patch: Partial<Pick<EqBand, "enabled" | "frequency" | "gainDb" | "q">>
    ) => {
      engineRef.current?.setEqBandConfig(bandId, patch);
      setEqCurveSelection((previous) => (isEqPresetName(previous) ? "Custom 1" : previous));
    },
    []
  );

  const handleEqResetFlat = useCallback(() => {
    if (isEqCustomSlotName(eqCurveSelection)) {
      const flatBands = createDefaultEqBands();
      const slotIndex = EQ_CUSTOM_SLOT_NAMES.indexOf(eqCurveSelection);
      setEqCustomSlots((previous) => {
        const next = [...previous];
        next[slotIndex] = cloneEqBands(flatBands);
        return next;
      });
      engineRef.current?.setEqBands(flatBands, null);
      return;
    }
    engineRef.current?.setEqPreset("Flat");
    setEqCurveSelection("Flat");
  }, [eqCurveSelection]);

  const handleEqCurveSelectionChange = useCallback(
    (selection: EqCurveSelection) => {
      const engine = engineRef.current;
      if (!engine) return;

      setEqCurveSelection(selection);
      if (isEqPresetName(selection)) {
        engine.setEqPreset(selection);
        return;
      }

      const slotIndex = EQ_CUSTOM_SLOT_NAMES.indexOf(selection);
      const slotBands = eqCustomSlots[slotIndex] ?? createDefaultEqBands();
      engine.setEqBands(slotBands, null);
    },
    [eqCustomSlots]
  );

  const handleWaveformEnabledChange = useCallback((enabled: boolean) => {
    setWaveformEnabled(enabled);
  }, []);

  const handleWaveformModeChange = useCallback((mode: WaveformMode) => {
    setWaveformMode(mode);
  }, []);

  const handleAppearanceThemeChange = useCallback((themeId: string) => {
    if (!Object.prototype.hasOwnProperty.call(APPEARANCE_THEMES, themeId)) return;
    setAppearanceThemeId(themeId as AppearanceThemeId);
  }, []);

  const getWaveformAnalysers = useCallback((): WaveformAnalyserNodes => {
    return (
      engineRef.current?.getWaveformAnalyserNodes() ?? {
        mono: null,
        left: null,
        right: null
      }
    );
  }, []);

  const getEqGraphCurve = useCallback(() => {
    return engineRef.current?.getEqGraphCurve() ?? null;
  }, []);

  const handleToggleShuffle = useCallback(() => {
    const nextEnabled = !shuffleEnabled;
    setShuffleEnabled(nextEnabled);

    if (nextEnabled) {
      seedShuffleState(effectiveTrackId);
    } else {
      shuffleHistoryRef.current = [];
      shuffleCursorRef.current = -1;
      shufflePoolRef.current = [];
    }
  }, [effectiveTrackId, seedShuffleState, shuffleEnabled]);

  const handleCycleRepeatMode = useCallback(() => {
    setRepeatMode((previous) => {
      if (previous === "off") return "one";
      if (previous === "one") return "all";
      return "off";
    });
  }, []);

  const handlePrev = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || tracks.length === 0) return;

    if (playback.currentTime > 3 && playback.isReady) {
      engine.seek(0);
      return;
    }

    const currentId = effectiveTrackId;
    if (!currentId) return;

    const prevId = shuffleEnabled
      ? getShufflePrevTrackId(currentId)
      : getSequentialPrevTrackId(currentId);

    if (!prevId) return;

    await playTrackById(prevId, { registerShuffleSelection: false });
  }, [
    effectiveTrackId,
    getSequentialPrevTrackId,
    getShufflePrevTrackId,
    playback.currentTime,
    playback.isReady,
    playTrackById,
    shuffleEnabled,
    tracks.length
  ]);

  const handleNext = useCallback(async () => {
    if (tracks.length === 0) return;

    const queuedNextId = dequeueNextQueuedTrackId();
    if (queuedNextId) {
      await playTrackById(queuedNextId, { registerShuffleSelection: true });
      return;
    }

    const currentId = effectiveTrackId ?? tracks[0].id;

    const nextId = shuffleEnabled
      ? getShuffleNextTrackId(currentId)
      : getSequentialNextTrackId(currentId);

    if (!nextId) return;

    await playTrackById(nextId, { registerShuffleSelection: false });
  }, [
    dequeueNextQueuedTrackId,
    effectiveTrackId,
    getSequentialNextTrackId,
    getShuffleNextTrackId,
    playTrackById,
    shuffleEnabled,
    tracks
  ]);

  const handleImportFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;

      setIsImporting(true);

      for (const file of Array.from(fileList)) {
        if (!isSupportedAudioFileName(file.name)) {
          showToast(
            `Skipped "${file.name}" (supported: .wav .flac .alac .mp3 .aac .m4a).`
          );
          continue;
        }

        let durationSeconds = 0;
        try {
          durationSeconds = await probeDurationFromFile(file);
        } catch {
          durationSeconds = 0;
          showToast(`Imported "${file.name}" with unknown duration.`);
        }

        const track: TrackMeta = {
          id: createTrackId(),
          filename: file.name,
          displayName: stripExtension(file.name),
          addedAt: Date.now(),
          durationSeconds,
          mimeType: file.type || getMimeFromFileName(file.name),
          sizeBytes: file.size
        };

        try {
          await putTrack(track, file);
        } catch {
          showToast(`Failed to import "${file.name}".`);
        }
      }

      setIsImporting(false);
      await refreshLibrary();
    },
    [refreshLibrary, showToast]
  );

  const handleDeleteTrack = useCallback(
    async (trackId: string) => {
      const engine = engineRef.current;
      if (engine) {
        engine.clearTrack(trackId);
      }

      if (queueRef.current.includes(trackId)) {
        setQueue(queueRef.current.filter((id) => id !== trackId));
      }

      await deleteTrackById(trackId);
      await refreshLibrary();
    },
    [refreshLibrary, setQueue]
  );

  return (
    <div className="app-root" ref={appRootRef} style={appStyle}>
      <header className="app-header">
        <p className="app-kicker">PWA Web App</p>
        <h1>Slowed HQ</h1>
      </header>

      <main className="app-main">
        {activeTab === "library" ? (
          <LibraryScreen
            tracks={tracks}
            selectedTrackId={effectiveTrackId}
            onImportFiles={handleImportFiles}
            onDeleteTrack={handleDeleteTrack}
            onPlayTrack={(trackId) => playTrackById(trackId, { registerShuffleSelection: true })}
            onQueueTrack={enqueueTrackById}
            storage={storage}
            importing={isImporting}
          />
        ) : (
          <PlayerScreen
            playback={playback}
            currentTrack={selectedTrack}
            repeatMode={repeatMode}
            shuffleEnabled={shuffleEnabled}
            queueTracks={queueTracks}
            onTogglePlay={handleTogglePlay}
            onPrev={handlePrev}
            onNext={handleNext}
            onRemoveQueueAt={removeQueueItemAt}
            onClearQueue={clearQueue}
            onPlayQueueAt={playQueuedTrackAt}
            onSeekCommit={handleSeekCommit}
            onRateChange={handleRateChange}
            onReverbEnabledChange={handleReverbEnabledChange}
            onReverbPresetChange={handleReverbPresetChange}
            onReverbWetChange={handleReverbWetChange}
            onNextReverbPreset={handleNextReverbPreset}
            onEqEnabledChange={handleEqEnabledChange}
            onEqBandConfigChange={handleEqBandConfigChange}
            onEqResetFlat={handleEqResetFlat}
            eqCurveSelection={eqCurveSelection}
            eqCurveOptions={EQ_CURVE_OPTIONS}
            onEqCurveSelectionChange={handleEqCurveSelectionChange}
            getEqGraphCurve={getEqGraphCurve}
            appearanceThemeId={appearanceThemeId}
            appearanceThemes={Object.values(APPEARANCE_THEMES).map((theme) => ({
              id: theme.id,
              label: theme.label,
              accent: theme.accent,
              accent2: theme.accent2
            }))}
            onAppearanceThemeChange={handleAppearanceThemeChange}
            waveformEnabled={waveformEnabled}
            waveformMode={waveformMode}
            onWaveformEnabledChange={handleWaveformEnabledChange}
            onWaveformModeChange={handleWaveformModeChange}
            getWaveformAnalysers={getWaveformAnalysers}
            onToggleShuffle={handleToggleShuffle}
            onCycleRepeatMode={handleCycleRepeatMode}
            canGoPrev={canGoPrev}
            canGoNext={canGoNext}
          />
        )}
      </main>

      <nav className="tabbar">
        <button
          type="button"
          className={`tabbar-button ${activeTab === "player" ? "is-active" : ""}`}
          onClick={() => setActiveTab("player")}
        >
          Player
        </button>

        <button
          type="button"
          className={`tabbar-button ${activeTab === "library" ? "is-active" : ""}`}
          onClick={() => setActiveTab("library")}
        >
          Library
        </button>
      </nav>

      <Toast message={toastMessage} />
    </div>
  );
}
