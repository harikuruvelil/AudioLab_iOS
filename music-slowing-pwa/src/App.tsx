import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EQ_PRESET_NAMES, REVERB_PRESET_MAP, REVERB_PRESETS } from "./audioFxPresets";
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
  EqBandGains,
  EqPresetName,
  PlaybackState,
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
  eqBandGains: [0, 0, 0, 0, 0],
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
  eqBandGains: EqBandGains;
  eqPresetName: EqPresetName | null;
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

  const rate = typeof value.rate === "number" ? clamp(value.rate, 0.5, 1.1) : 1;
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

  const eqBandGainsRaw = value.eqBandGains;
  const eqBandGains: EqBandGains =
    Array.isArray(eqBandGainsRaw) && eqBandGainsRaw.length === 5
      ? (eqBandGainsRaw
          .map((gain) => (typeof gain === "number" ? clamp(gain, -12, 12) : 0))
          .slice(0, 5) as EqBandGains)
      : [0, 0, 0, 0, 0];

  const eqPresetNameRaw = value.eqPresetName;
  const eqPresetName: EqPresetName | null =
    typeof eqPresetNameRaw === "string" &&
    EQ_PRESET_NAMES.includes(eqPresetNameRaw as EqPresetName)
      ? (eqPresetNameRaw as EqPresetName)
      : null;
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
    eqBandGains,
    eqPresetName,
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

  const engineRef = useRef<TapeAudioEngine | null>(null);
  const onTrackEndedRef = useRef<() => Promise<void> | void>(() => {});

  // Shuffle queue state that persists while app is running.
  const shuffleHistoryRef = useRef<string[]>([]);
  const shuffleCursorRef = useRef<number>(-1);
  const shufflePoolRef = useRef<string[]>([]);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
  }, []);

  const trackIds = useMemo(() => tracks.map((track) => track.id), [tracks]);

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

    const nextId = shuffleEnabled
      ? getShuffleNextTrackId(currentId)
      : getSequentialNextTrackId(currentId);

    if (!nextId) {
      return;
    }

    await playTrackById(nextId, { registerShuffleSelection: false });
  }, [
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
      setPlayback(state);
    });
    const unsubscribeError = engine.onError(showToast);
    const unsubscribeEnded = engine.onEnded(() => {
      void onTrackEndedRef.current();
    });

    const restored = initialAudioSettings;
    if (restored) {
      engine.setRate(restored.rate);
      engine.setReverbEnabled(restored.reverbEnabled);
      engine.setReverbWet(restored.reverbWet);
      void engine.setReverbPreset(restored.reverbPresetId);
      engine.setEqEnabled(restored.eqEnabled);
      if (restored.eqPresetName) {
        engine.setEqPreset(restored.eqPresetName);
      } else {
        engine.setEqBandGains(restored.eqBandGains, null);
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
    if (typeof window === "undefined") return;

    const payload: PersistedAudioSettings = {
      rate: playback.rate,
      reverbEnabled: playback.reverbEnabled,
      reverbPresetId: playback.reverbPresetId,
      reverbWet: playback.reverbWet,
      eqEnabled: playback.eqEnabled,
      eqBandGains: playback.eqBandGains,
      eqPresetName: playback.eqPresetName,
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
    playback.eqBandGains,
    playback.eqPresetName,
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

  const selectedTrack = useMemo(() => {
    if (!effectiveTrackId) return null;
    return tracks.find((track) => track.id === effectiveTrackId) ?? null;
  }, [tracks, effectiveTrackId]);

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
    (shuffleEnabled
      ? trackIds.length > 1 || repeatMode === "all"
      : currentIndex < tracks.length - 1 || repeatMode !== "off");

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

  const handleEqBandGainChange = useCallback((bandIndex: number, gainDb: number) => {
    engineRef.current?.setEqBandGain(bandIndex, gainDb);
  }, []);

  const handleEqPresetChange = useCallback((presetName: EqPresetName) => {
    engineRef.current?.setEqPreset(presetName);
  }, []);

  const handleWaveformEnabledChange = useCallback((enabled: boolean) => {
    setWaveformEnabled(enabled);
  }, []);

  const handleWaveformModeChange = useCallback((mode: WaveformMode) => {
    setWaveformMode(mode);
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

    const currentId = effectiveTrackId ?? tracks[0].id;

    const nextId = shuffleEnabled
      ? getShuffleNextTrackId(currentId)
      : getSequentialNextTrackId(currentId);

    if (!nextId) return;

    await playTrackById(nextId, { registerShuffleSelection: false });
  }, [
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
          showToast(`Skipped "${file.name}" (supported: .wav .mp3 .flac).`);
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

      await deleteTrackById(trackId);
      await refreshLibrary();
    },
    [refreshLibrary]
  );

  return (
    <div className="app-root">
      <header className="app-header">
        <p className="app-kicker">PWA</p>
        <h1>Music Slowing App</h1>
      </header>

      <main className="app-main">
        {activeTab === "library" ? (
          <LibraryScreen
            tracks={tracks}
            selectedTrackId={effectiveTrackId}
            onImportFiles={handleImportFiles}
            onDeleteTrack={handleDeleteTrack}
            onPlayTrack={(trackId) => playTrackById(trackId, { registerShuffleSelection: true })}
            storage={storage}
            importing={isImporting}
          />
        ) : (
          <PlayerScreen
            playback={playback}
            currentTrack={selectedTrack}
            repeatMode={repeatMode}
            shuffleEnabled={shuffleEnabled}
            onTogglePlay={handleTogglePlay}
            onPrev={handlePrev}
            onNext={handleNext}
            onSeekCommit={handleSeekCommit}
            onRateChange={handleRateChange}
            onReverbEnabledChange={handleReverbEnabledChange}
            onReverbPresetChange={handleReverbPresetChange}
            onReverbWetChange={handleReverbWetChange}
            onNextReverbPreset={handleNextReverbPreset}
            onEqEnabledChange={handleEqEnabledChange}
            onEqBandGainChange={handleEqBandGainChange}
            onEqPresetChange={handleEqPresetChange}
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
