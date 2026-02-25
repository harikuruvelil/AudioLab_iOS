import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EQ_MAX_FREQ,
  EQ_MAX_GAIN_DB,
  EQ_MAX_Q,
  EQ_MIN_FREQ,
  EQ_MIN_GAIN_DB,
  EQ_MIN_Q,
  REVERB_PRESETS,
  bandSupportsGain,
  formatEqFrequency
} from "../audioFxPresets";
import type {
  EqBand,
  EqGraphCurve,
  EqPresetName,
  PlaybackState,
  RepeatMode,
  ReverbPresetId,
  TrackMeta,
  WaveformMode
} from "../types";
import { formatDuration, getAudioFileExtension, semitonesFromRate } from "../utils";

interface PlayerScreenProps {
  playback: PlaybackState;
  currentTrack: TrackMeta | null;
  repeatMode: RepeatMode;
  shuffleEnabled: boolean;
  queueTracks: TrackMeta[];
  waveformEnabled: boolean;
  waveformMode: WaveformMode;
  waveformTargetFps: number;
  waveformColor: string;
  onTogglePlay: () => Promise<void> | void;
  onPrev: () => Promise<void> | void;
  onNext: () => Promise<void> | void;
  onRemoveQueueAt: (index: number) => void;
  onClearQueue: () => void;
  onPlayQueueAt: (index: number) => Promise<void> | void;
  onSeekCommit: (seconds: number) => void;
  onRateChange: (rate: number) => void;
  onReverbEnabledChange: (enabled: boolean) => void;
  onReverbPresetChange: (presetId: ReverbPresetId) => Promise<void> | void;
  onReverbWetChange: (wet: number) => void;
  onNextReverbPreset: () => Promise<void> | void;
  onEqEnabledChange: (enabled: boolean) => void;
  onEqBandConfigChange: (
    bandId: string,
    patch: Partial<Pick<EqBand, "enabled" | "frequency" | "gainDb" | "q">>
  ) => void;
  onEqResetFlat: () => void;
  eqCurveSelection: EqPresetName | "Custom 1" | "Custom 2" | "Custom 3";
  eqCurveOptions: Array<EqPresetName | "Custom 1" | "Custom 2" | "Custom 3">;
  onEqCurveSelectionChange: (
    selection: EqPresetName | "Custom 1" | "Custom 2" | "Custom 3"
  ) => void;
  getEqGraphCurve: () => EqGraphCurve | null;
  appearanceThemeId: string;
  appearanceThemes: Array<{ id: string; label: string; accent: string; accent2: string }>;
  onAppearanceThemeChange: (themeId: string) => void;
  onWaveformEnabledChange: (enabled: boolean) => void;
  onWaveformModeChange: (mode: WaveformMode) => void;
  onWaveformTargetFpsChange: (fps: number) => void;
  onWaveformColorChange: (color: string) => void;
  backgroundMotionEnabled: boolean;
  onBackgroundMotionEnabledChange: (enabled: boolean) => void;
  backgroundBassReactiveEnabled: boolean;
  onBackgroundBassReactiveEnabledChange: (enabled: boolean) => void;
  backgroundBassReaction: number;
  onBackgroundBassReactionChange: (amount: number) => void;
  darkLockActive: boolean;
  onDarkLockActiveChange: (active: boolean) => void;
  getWaveformAnalysers: () => {
    mono: AnalyserNode | null;
    left: AnalyserNode | null;
    right: AnalyserNode | null;
  };
  onToggleShuffle: () => void;
  onCycleRepeatMode: () => void;
  canGoPrev: boolean;
  canGoNext: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeHexColor(raw: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : "#65d4ff";
}

function hexToRgb(color: string): { r: number; g: number; b: number } {
  const safe = normalizeHexColor(color);
  return {
    r: parseInt(safe.slice(1, 3), 16),
    g: parseInt(safe.slice(3, 5), 16),
    b: parseInt(safe.slice(5, 7), 16)
  };
}

function formatHz(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "?";
  return Math.round(value).toLocaleString();
}

function isLosslessFormat(format: string | null): boolean {
  return format === "wav" || format === "flac" || format === "alac";
}

function freqToSliderValue(freq: number): number {
  const clamped = clamp(freq, EQ_MIN_FREQ, EQ_MAX_FREQ);
  return ((Math.log10(clamped) - EQ_LOG_MIN) / (EQ_LOG_MAX - EQ_LOG_MIN)) * 1000;
}

function sliderValueToFreq(value: number): number {
  const normalized = clamp(value, 0, 1000) / 1000;
  return 10 ** (EQ_LOG_MIN + normalized * (EQ_LOG_MAX - EQ_LOG_MIN));
}

function sampleCurveAtFrequency(curve: EqGraphCurve | null, frequency: number): number {
  if (!curve || curve.frequencies.length === 0 || curve.gainsDb.length === 0) return 0;
  let closestIndex = 0;
  let closestDistance = Math.abs(curve.frequencies[0] - frequency);
  for (let i = 1; i < curve.frequencies.length; i += 1) {
    const distance = Math.abs(curve.frequencies[i] - frequency);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = i;
    }
  }
  return curve.gainsDb[closestIndex] ?? 0;
}

function createByteArray(length: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new ArrayBuffer(length));
}

function createFloatArray(length: number): Float32Array<ArrayBuffer> {
  return new Float32Array(new ArrayBuffer(length * Float32Array.BYTES_PER_ELEMENT));
}

const REVERB_WET_INTERNAL_MAX = 0.6;
const ICON_GEAR = "\u2699";
const ICON_QUEUE = "\u2630";
const ICON_APPEAR = "\u25C8";
const ICON_SHUFFLE = "\uD83D\uDD00";
const ICON_REPEAT = "\uD83D\uDD01";
const ICON_PREV = "\u23EE";
const ICON_PLAY = "\u25B6";
const ICON_PAUSE = "\u23F8";
const ICON_NEXT = "\u23ED";
const ICON_CLOSE = "\u2715";
const EQ_GRAPH_RANGE_DB = 18;
const EQ_LOG_MIN = Math.log10(EQ_MIN_FREQ);
const EQ_LOG_MAX = Math.log10(EQ_MAX_FREQ);

export function PlayerScreen({
  playback,
  currentTrack,
  repeatMode,
  shuffleEnabled,
  queueTracks,
  waveformEnabled,
  waveformMode,
  waveformTargetFps,
  waveformColor,
  onTogglePlay,
  onPrev,
  onNext,
  onRemoveQueueAt,
  onClearQueue,
  onPlayQueueAt,
  onSeekCommit,
  onRateChange,
  onReverbEnabledChange,
  onReverbPresetChange,
  onReverbWetChange,
  onNextReverbPreset,
  onEqEnabledChange,
  onEqBandConfigChange,
  onEqResetFlat,
  eqCurveSelection,
  eqCurveOptions,
  onEqCurveSelectionChange,
  getEqGraphCurve,
  appearanceThemeId,
  appearanceThemes,
  onAppearanceThemeChange,
  onWaveformEnabledChange,
  onWaveformModeChange,
  onWaveformTargetFpsChange,
  onWaveformColorChange,
  backgroundMotionEnabled,
  onBackgroundMotionEnabledChange,
  backgroundBassReactiveEnabled,
  onBackgroundBassReactiveEnabledChange,
  backgroundBassReaction,
  onBackgroundBassReactionChange,
  darkLockActive,
  onDarkLockActiveChange,
  getWaveformAnalysers,
  onToggleShuffle,
  onCycleRepeatMode,
  canGoPrev,
  canGoNext
}: PlayerScreenProps) {
  const pitchSemitones = semitonesFromRate(playback.rate);

  const [isScrubbing, setIsScrubbing] = useState(false);
  const [previewTime, setPreviewTime] = useState(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isAppearanceOpen, setIsAppearanceOpen] = useState(false);
  const [showQualityDetails, setShowQualityDetails] = useState(false);
  const [vectorscopeMono, setVectorscopeMono] = useState(false);
  const [selectedEqBandId, setSelectedEqBandId] = useState<string | null>(null);

  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const eqGraphCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const monoBytesRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const leftBytesRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const rightBytesRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const leftFloatRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const rightFloatRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const vectorscopeMonoRef = useRef(false);
  const vectorscopeDiffRef = useRef(0);
  const vectorscopeSingleChannelRef = useRef(0);

  useEffect(() => {
    if (!isScrubbing) {
      setPreviewTime(playback.currentTime);
    }
  }, [isScrubbing, playback.currentTime]);

  useEffect(() => {
    if (!isSettingsOpen && !isQueueOpen && !isAppearanceOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSettingsOpen(false);
        setIsQueueOpen(false);
        setIsAppearanceOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAppearanceOpen, isQueueOpen, isSettingsOpen]);

  useEffect(() => {
    if (playback.eqBands.length === 0) {
      setSelectedEqBandId(null);
      return;
    }

    const hasCurrent = selectedEqBandId
      ? playback.eqBands.some((band) => band.id === selectedEqBandId)
      : false;

    if (!hasCurrent) {
      const preferredBand =
        playback.eqBands.find((band) => bandSupportsGain(band.type)) ?? playback.eqBands[0];
      setSelectedEqBandId(preferredBand.id);
    }
  }, [playback.eqBands, selectedEqBandId]);

  const seekMax = Math.max(playback.duration, 0.001);
  const displayedTime = isScrubbing ? previewTime : playback.currentTime;
  const seekValue = clamp(displayedTime, 0, seekMax);
  const progress = playback.duration > 0 ? Math.min((seekValue / playback.duration) * 100, 100) : 0;
  const reverbWetPercent = Math.round(
    clamp((playback.reverbWet / REVERB_WET_INTERNAL_MAX) * 100, 0, 100)
  );

  const trackFormat = currentTrack ? getAudioFileExtension(currentTrack.filename) : null;
  const formatLabel = trackFormat ?? "unknown";
  const formatLabelUpper = formatLabel.toUpperCase();
  const isLossless = isLosslessFormat(trackFormat);
  const isQualityChecking = playback.quality.status === "checking";
  const hasResampled = playback.quality.status === "resampled";
  const qualityLabel = isQualityChecking
    ? "CHECKING..."
    : hasResampled
      ? "RESAMPLED"
      : isLossless
        ? (playback.quality.trackHz ?? 0) > 44100
          ? "PCM+"
          : "PCM"
        : formatLabelUpper;

  const qualityFormatLine = isQualityChecking
    ? "Format: loading..."
    : `Format: ${formatLabelUpper}`;

  const qualityDetails = useMemo(() => {
    const rows: string[] = [];
    const contextHz = playback.quality.contextHz;
    if (playback.quality.trackResampled) {
      rows.push(
        `Track: ${formatHz(playback.quality.trackHz)} -> ${formatHz(contextHz)} Hz`
      );
    }
    if (playback.quality.irResampled && playback.quality.reverbActive) {
      rows.push(`IR: ${formatHz(playback.quality.irHz)} -> ${formatHz(contextHz)} Hz`);
    }
    return rows;
  }, [playback.quality]);

  const selectedEqBand = useMemo(() => {
    if (playback.eqBands.length === 0) return null;
    const byId = selectedEqBandId
      ? playback.eqBands.find((band) => band.id === selectedEqBandId)
      : null;
    return byId ?? playback.eqBands[0];
  }, [playback.eqBands, selectedEqBandId]);

  const eqGraphCurve = useMemo(
    () => (isSettingsOpen ? getEqGraphCurve() : null),
    [getEqGraphCurve, isSettingsOpen, playback.eqBands, playback.eqEnabled]
  );

  const commitSeek = useCallback(() => {
    if (!isScrubbing) return;
    const target = clamp(previewTime, 0, playback.duration);
    setIsScrubbing(false);
    onSeekCommit(target);
  }, [isScrubbing, onSeekCommit, playback.duration, previewTime]);

  useEffect(() => {
    if (!isScrubbing) return;
    const handlePointerUp = () => {
      commitSeek();
    };

    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("mouseup", handlePointerUp);
    window.addEventListener("touchend", handlePointerUp);
    window.addEventListener("touchcancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("mouseup", handlePointerUp);
      window.removeEventListener("touchend", handlePointerUp);
      window.removeEventListener("touchcancel", handlePointerUp);
    };
  }, [commitSeek, isScrubbing]);

  useEffect(() => {
    if (waveformMode !== "vectorscope" || !waveformEnabled || !playback.isPlaying) {
      vectorscopeMonoRef.current = false;
      vectorscopeDiffRef.current = 0;
      vectorscopeSingleChannelRef.current = 0;
      setVectorscopeMono(false);
    }
  }, [playback.isPlaying, waveformEnabled, waveformMode]);

  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas) return;

    const context2d =
      canvas.getContext("2d", {
        alpha: false,
        desynchronized: true
      }) ?? canvas.getContext("2d");
    if (!context2d) return;
    context2d.imageSmoothingEnabled = false;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rgb = hexToRgb(waveformColor);
    const lineColorStrong = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.95)`;
    const lineColorMedium = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.9)`;
    const lineColorSoft = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.34)`;
    const lineColorGlow = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.24)`;
    let frameWidth = 1;
    let frameHeight = 1;

    const resizeCanvas = () => {
      const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      frameWidth = width;
      frameHeight = height;
    };

    const drawIdle = () => {
      resizeCanvas();
      const width = frameWidth;
      const height = frameHeight;
      context2d.fillStyle = "rgba(12, 16, 28, 0.92)";
      context2d.fillRect(0, 0, width, height);

      const y = height / 2;
      context2d.beginPath();
      context2d.moveTo(0, y);
      context2d.lineTo(width, y);
      context2d.strokeStyle = lineColorSoft;
      context2d.lineWidth = Math.max(1.1, dpr);
      context2d.stroke();
    };

    const drawLinear = (analyser: AnalyserNode) => {
      const sampleCount = analyser.fftSize;
      if (!monoBytesRef.current || monoBytesRef.current.length !== sampleCount) {
        monoBytesRef.current = createByteArray(sampleCount);
      }
      const waveform = monoBytesRef.current;
      analyser.getByteTimeDomainData(waveform);

      const width = frameWidth;
      const height = frameHeight;
      const maxPoints = Math.max(280, Math.min(920, Math.floor(width / Math.max(0.6, dpr * 0.7))));
      const stride = Math.max(1, Math.floor(waveform.length / maxPoints));
      context2d.beginPath();
      for (let i = 0; i < waveform.length; i += stride) {
        const x = (i / (waveform.length - 1)) * width;
        const normalized = (waveform[i] - 128) / 128;
        const y = height * 0.5 + normalized * height * 0.36;
        if (i === 0) {
          context2d.moveTo(x, y);
        } else {
          context2d.lineTo(x, y);
        }
      }
      context2d.lineWidth = Math.max(1.35, dpr);
      context2d.strokeStyle = lineColorStrong;
      context2d.stroke();
    };

    const drawCircular = (analyser: AnalyserNode) => {
      const sampleCount = analyser.fftSize;
      if (!monoBytesRef.current || monoBytesRef.current.length !== sampleCount) {
        monoBytesRef.current = createByteArray(sampleCount);
      }
      const waveform = monoBytesRef.current;
      analyser.getByteTimeDomainData(waveform);

      const width = frameWidth;
      const height = frameHeight;
      const cx = width * 0.5;
      const cy = height * 0.5;
      const baseRadius = Math.min(width, height) * 0.28;
      const amplitudeScale = Math.min(width, height) * 0.12;
      const maxPoints = Math.max(260, Math.min(760, Math.floor(width / Math.max(0.75, dpr))));
      const stride = Math.max(1, Math.floor(waveform.length / maxPoints));

      context2d.beginPath();
      for (let i = 0; i < waveform.length; i += stride) {
        const angle = (i / waveform.length) * Math.PI * 2;
        const normalized = (waveform[i] - 128) / 128;
        const radius = baseRadius + normalized * amplitudeScale;
        const x = cx + radius * Math.cos(angle);
        const y = cy + radius * Math.sin(angle);
        if (i === 0) {
          context2d.moveTo(x, y);
        } else {
          context2d.lineTo(x, y);
        }
      }
      context2d.closePath();
      context2d.lineWidth = Math.max(1.2, dpr);
      context2d.strokeStyle = lineColorMedium;
      context2d.stroke();
    };

    const drawVectorscope = (left: AnalyserNode, right: AnalyserNode) => {
      const sampleCount = Math.min(left.fftSize, right.fftSize);
      if (!leftFloatRef.current || leftFloatRef.current.length !== sampleCount) {
        leftFloatRef.current = createFloatArray(sampleCount);
      }
      if (!rightFloatRef.current || rightFloatRef.current.length !== sampleCount) {
        rightFloatRef.current = createFloatArray(sampleCount);
      }
      const leftFloat = leftFloatRef.current;
      const rightFloat = rightFloatRef.current;

      if ("getFloatTimeDomainData" in left && "getFloatTimeDomainData" in right) {
        left.getFloatTimeDomainData(leftFloat);
        right.getFloatTimeDomainData(rightFloat);
      } else {
        if (!leftBytesRef.current || leftBytesRef.current.length !== sampleCount) {
          leftBytesRef.current = createByteArray(sampleCount);
        }
        if (!rightBytesRef.current || rightBytesRef.current.length !== sampleCount) {
          rightBytesRef.current = createByteArray(sampleCount);
        }
        left.getByteTimeDomainData(leftBytesRef.current);
        right.getByteTimeDomainData(rightBytesRef.current);

        for (let i = 0; i < sampleCount; i += 1) {
          leftFloat[i] = (leftBytesRef.current[i] - 128) / 128;
          rightFloat[i] = (rightBytesRef.current[i] - 128) / 128;
        }
      }

      const pointBudget = Math.max(280, Math.min(900, Math.floor(frameWidth / dpr)));
      const stride = Math.max(1, Math.floor(sampleCount / pointBudget));
      let diffSum = 0;
      let diffCount = 0;
      let leftAbsSum = 0;
      let rightAbsSum = 0;
      for (let i = 0; i < sampleCount; i += 16) {
        const leftValue = leftFloat[i];
        const rightValue = rightFloat[i];
        diffSum += Math.abs(leftValue - rightValue);
        leftAbsSum += Math.abs(leftValue);
        rightAbsSum += Math.abs(rightValue);
        diffCount += 1;
      }
      const diffAvg = diffCount > 0 ? diffSum / diffCount : 0;
      const leftAvg = diffCount > 0 ? leftAbsSum / diffCount : 0;
      const rightAvg = diffCount > 0 ? rightAbsSum / diffCount : 0;
      const singleChannelRatio = Math.min(leftAvg, rightAvg) / Math.max(0.00001, Math.max(leftAvg, rightAvg));
      vectorscopeDiffRef.current = vectorscopeDiffRef.current * 0.82 + diffAvg * 0.18;
      vectorscopeSingleChannelRef.current =
        vectorscopeSingleChannelRef.current * 0.82 + singleChannelRatio * 0.18;
      const monoLikeFromDiff = vectorscopeDiffRef.current < 0.008;
      const stereoEnoughFromDiff = vectorscopeDiffRef.current > 0.014;
      const monoLikeFromSingleChannel = vectorscopeSingleChannelRef.current < 0.15;
      const stereoEnoughFromSingleChannel = vectorscopeSingleChannelRef.current > 0.3;
      const monoDetected = vectorscopeMonoRef.current
        ? !(stereoEnoughFromDiff && stereoEnoughFromSingleChannel)
        : monoLikeFromDiff || monoLikeFromSingleChannel;
      const monoUseRight = rightAvg > leftAvg;
      if (monoDetected !== vectorscopeMonoRef.current) {
        vectorscopeMonoRef.current = monoDetected;
        setVectorscopeMono(monoDetected);
      }

      const width = frameWidth;
      const height = frameHeight;
      const cx = width * 0.5;
      const cy = height * 0.5;
      const scale = Math.min(width, height) * 0.42;

      context2d.beginPath();
      context2d.moveTo(0, cy);
      context2d.lineTo(width, cy);
      context2d.moveTo(cx, 0);
      context2d.lineTo(cx, height);
      context2d.lineWidth = Math.max(1, dpr);
      context2d.strokeStyle = "rgba(255, 255, 255, 0.1)";
      context2d.stroke();

      context2d.beginPath();
      for (let i = 0; i < sampleCount; i += stride) {
        const monoSample = monoUseRight ? rightFloat[i] : leftFloat[i];
        const leftSample = monoDetected ? monoSample : leftFloat[i];
        const rightSample = monoDetected ? monoSample : rightFloat[i];
        const x = cx + leftSample * scale;
        const y = cy - rightSample * scale;
        if (i === 0) {
          context2d.moveTo(x, y);
        } else {
          context2d.lineTo(x, y);
        }
      }
      context2d.lineJoin = "round";
      context2d.lineCap = "round";
      context2d.lineWidth = Math.max(2.1, dpr * 1.4);
      context2d.strokeStyle = lineColorGlow;
      context2d.stroke();
      context2d.lineWidth = Math.max(1.05, dpr);
      context2d.strokeStyle = lineColorStrong;
      context2d.stroke();
    };

    let rafHandle = 0;
    let cachedAnalysers = getWaveformAnalysers();
    let analyserRefreshCounter = 0;
    let lastRenderedAt = 0;
    const uiOverlayOpen = isSettingsOpen || isQueueOpen || isAppearanceOpen;
    const requestedFps = clamp(Math.round(waveformTargetFps), 24, 120);
    const targetFps = uiOverlayOpen ? Math.max(24, Math.min(requestedFps, 72)) : requestedFps;
    const minFrameMs = 1000 / targetFps;

    const drawFrame = (timestamp: number) => {
      if (document.hidden) {
        rafHandle = window.requestAnimationFrame(drawFrame);
        return;
      }
      if (lastRenderedAt > 0 && timestamp - lastRenderedAt < minFrameMs) {
        rafHandle = window.requestAnimationFrame(drawFrame);
        return;
      }
      lastRenderedAt = timestamp;

      const width = frameWidth;
      const height = frameHeight;

      try {
        context2d.fillStyle =
          waveformMode === "vectorscope" ? "rgba(12, 16, 28, 0.4)" : "rgba(12, 16, 28, 0.92)";
        context2d.fillRect(0, 0, width, height);

        analyserRefreshCounter += 1;
        if (
          analyserRefreshCounter >= Math.max(30, Math.floor(targetFps)) ||
          (!cachedAnalysers.mono && !cachedAnalysers.left && !cachedAnalysers.right)
        ) {
          cachedAnalysers = getWaveformAnalysers();
          analyserRefreshCounter = 0;
        }

        if (waveformMode === "vectorscope" && cachedAnalysers.left && cachedAnalysers.right) {
          drawVectorscope(cachedAnalysers.left, cachedAnalysers.right);
        } else if (waveformMode === "circular" && cachedAnalysers.mono) {
          drawCircular(cachedAnalysers.mono);
        } else if (cachedAnalysers.mono) {
          drawLinear(cachedAnalysers.mono);
        } else {
          drawIdle();
        }
      } catch {
        drawIdle();
      }

      rafHandle = window.requestAnimationFrame(drawFrame);
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    if (!waveformEnabled || !playback.isPlaying) {
      drawIdle();
      return () => {
        window.removeEventListener("resize", resizeCanvas);
      };
    }

    rafHandle = window.requestAnimationFrame(drawFrame);
    return () => {
      window.removeEventListener("resize", resizeCanvas);
      window.cancelAnimationFrame(rafHandle);
    };
  }, [
    getWaveformAnalysers,
    isAppearanceOpen,
    isQueueOpen,
    isSettingsOpen,
    playback.isPlaying,
    waveformColor,
    waveformEnabled,
    waveformMode,
    waveformTargetFps
  ]);

  useEffect(() => {
    if (!isSettingsOpen) return;
    const canvas = eqGraphCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const freqToX = (frequency: number): number => {
      const normalized =
        (Math.log10(clamp(frequency, EQ_MIN_FREQ, EQ_MAX_FREQ)) - EQ_LOG_MIN) /
        (EQ_LOG_MAX - EQ_LOG_MIN);
      return normalized * width;
    };

    const gainToY = (gainDb: number): number => {
      const normalized = (clamp(gainDb, -EQ_GRAPH_RANGE_DB, EQ_GRAPH_RANGE_DB) + EQ_GRAPH_RANGE_DB) /
        (2 * EQ_GRAPH_RANGE_DB);
      return (1 - normalized) * height;
    };

    ctx.fillStyle = "rgba(12, 16, 28, 0.95)";
    ctx.fillRect(0, 0, width, height);

    const gridFrequencies = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = Math.max(1, dpr * 0.7);
    for (const frequency of gridFrequencies) {
      const x = freqToX(frequency);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    const dbLines = [-18, -12, -6, 0, 6, 12, 18];
    for (const db of dbLines) {
      const y = gainToY(db);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.strokeStyle = db === 0 ? "rgba(101,212,255,0.38)" : "rgba(255,255,255,0.08)";
      ctx.stroke();
    }

    const curveToRender = eqGraphCurve;
    if (curveToRender && curveToRender.frequencies.length > 1) {
      ctx.beginPath();
      for (let i = 0; i < curveToRender.frequencies.length; i += 1) {
        const x = freqToX(curveToRender.frequencies[i]);
        const y = gainToY(curveToRender.gainsDb[i] ?? 0);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = playback.eqEnabled
        ? "rgba(110, 224, 255, 0.95)"
        : "rgba(110, 224, 255, 0.5)";
      ctx.lineWidth = Math.max(1.6, dpr);
      ctx.stroke();
    }

    for (const band of playback.eqBands) {
      const markerGain = bandSupportsGain(band.type)
        ? sampleCurveAtFrequency(curveToRender, band.frequency)
        : 0;
      const x = freqToX(band.frequency);
      const y = gainToY(markerGain);
      const isSelected = selectedEqBandId === band.id;

      ctx.beginPath();
      ctx.arc(x, y, isSelected ? 4.2 * dpr : 3.2 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = band.enabled ? "rgba(101,212,255,0.9)" : "rgba(130,150,190,0.7)";
      ctx.fill();
      ctx.strokeStyle = isSelected ? "rgba(255,255,255,0.95)" : "rgba(18,24,40,0.9)";
      ctx.lineWidth = Math.max(1, dpr * 0.7);
      ctx.stroke();
    }
  }, [eqGraphCurve, isSettingsOpen, playback.eqBands, playback.eqEnabled, selectedEqBandId]);

  const repeatLabel = useMemo(() => {
    if (repeatMode === "one") return "One";
    if (repeatMode === "all") return "All";
    return "Off";
  }, [repeatMode]);

  const beginScrub = useCallback(() => {
    setIsScrubbing(true);
    setPreviewTime(playback.currentTime);
  }, [playback.currentTime]);

  return (
    <section className="screen">
      <div className="section-header">
        <div className="player-header-main">
          <h2 className="section-title">Player</h2>
          <div className="status-chip-row">
            <button
              type="button"
              className={`status-chip ${isQualityChecking
                  ? "status-chip-neutral"
                  : hasResampled
                    ? "status-chip-warn"
                    : "status-chip-ok"
                }`}
              disabled={!hasResampled}
              onClick={() => {
                if (hasResampled) {
                  setShowQualityDetails((previous) => !previous);
                }
              }}
              aria-label={
                hasResampled ? "Show resampling details" : "No sample-rate resampling mismatch"
              }
            >
              {qualityLabel}
            </button>
            {playback.clipWarning ? (
              <span
                className="status-chip status-chip-clip"
                title="Reduce EQ gain / Reverb mix / Master level."
              >
                CLIP
              </span>
              ) : null}
          </div>
          <p className="quality-format">{qualityFormatLine}</p>
          {hasResampled && showQualityDetails && qualityDetails.length > 0 ? (
            <p className="quality-details">{qualityDetails.join(" | ")}</p>
          ) : null}
        </div>
        <div className="player-header-actions">
          <button
            type="button"
            className="icon-button settings-trigger"
            aria-label="Open queue"
            onClick={() => {
              setIsSettingsOpen(false);
              setIsAppearanceOpen(false);
              setIsQueueOpen(true);
            }}
          >
            {ICON_QUEUE}
            {queueTracks.length > 0 ? (
              <span className="header-button-badge" aria-hidden="true">
                {queueTracks.length}
              </span>
            ) : null}
          </button>

          <button
            type="button"
            className="icon-button settings-trigger"
            aria-label="Customize settings"
            onClick={() => {
              setIsSettingsOpen(false);
              setIsQueueOpen(false);
              setIsAppearanceOpen(true);
            }}
          >
            {ICON_APPEAR}
          </button>

          <button
            type="button"
            className="icon-button settings-trigger"
            aria-label="Open settings"
            onClick={() => {
              setIsAppearanceOpen(false);
              setIsQueueOpen(false);
              setIsSettingsOpen(true);
            }}
          >
            {ICON_GEAR}
          </button>
        </div>
      </div>

      <div className="player-card">
        <p className="player-label">Now Playing</p>
        <h3 className="player-title">
          {currentTrack?.displayName ?? "No track selected"}
        </h3>
        <p className="player-subtitle">
          {currentTrack?.filename ?? "Import tracks in Library to start playback."}
        </p>
      </div>

      <div className="waveform-card" aria-label="Waveform display">
        <canvas className="waveform-canvas" ref={waveformCanvasRef} />
        {waveformMode === "vectorscope" && vectorscopeMono ? (
          <p className="waveform-note">Mono (vectorscope limited)</p>
        ) : null}
      </div>

      <div className="progress-rail" aria-hidden="true">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <input
        className="seek-slider"
        type="range"
        min={0}
        max={seekMax}
        step={0.01}
        value={seekValue}
        onPointerDown={beginScrub}
        onMouseDown={beginScrub}
        onTouchStart={beginScrub}
        onChange={(event) => {
          setPreviewTime(Number(event.currentTarget.value));
        }}
      />

      <div className="time-row">
        <span>{formatDuration(displayedTime)}</span>
        <span>{formatDuration(playback.duration)}</span>
      </div>

      <div className="mode-row">
        <button
          type="button"
          className={`transport-button mode-button ${shuffleEnabled ? "mode-active" : ""}`}
          onClick={onToggleShuffle}
          aria-label={`Shuffle ${shuffleEnabled ? "on" : "off"}`}
          aria-pressed={shuffleEnabled}
        >
          <span className="mode-icon" aria-hidden="true">
            {ICON_SHUFFLE}
          </span>
          <span>{shuffleEnabled ? "On" : "Off"}</span>
        </button>
        <button
          type="button"
          className={`transport-button mode-button ${repeatMode !== "off" ? "mode-active" : ""}`}
          onClick={onCycleRepeatMode}
          aria-label={`Repeat ${repeatLabel}`}
        >
          <span className="mode-icon" aria-hidden="true">
            {ICON_REPEAT}
          </span>
          <span>{repeatLabel}</span>
          {repeatMode === "one" ? (
            <span className="repeat-one-badge" aria-hidden="true">
              1
            </span>
          ) : null}
        </button>
      </div>

      <div className="speed-card">
        <div className="speed-row">
          <span>Speed</span>
          <strong>{playback.rate.toFixed(2)}x</strong>
        </div>

        <input
          className="speed-slider"
          type="range"
          min={0.5}
          max={1.5}
          step={0.01}
          value={playback.rate}
          onChange={(event) => onRateChange(Number(event.currentTarget.value))}
        />

        <p className="player-subtitle">
          Pitch Shift: {pitchSemitones.toFixed(2)} semitones
        </p>

        <div className="speed-preset-row">
          <select
            className="fx-select speed-preset-select"
            value={
              [0.70, 0.75, 0.80, 0.85, 0.90, 0.95, 1.05, 1.10, 1.15, 1.20].some(
                (p) => Math.abs(playback.rate - p) < 0.005
              )
                ? playback.rate.toFixed(2)
                : "custom"
            }
            onChange={(event) => {
              const v = event.currentTarget.value;
              if (v !== "custom") onRateChange(Number(v));
            }}
            aria-label="Speed preset"
          >
            <option value="custom" disabled>Preset...</option>
            <option value="0.70">0.70x</option>
            <option value="0.75">0.75x</option>
            <option value="0.80">0.80x</option>
            <option value="0.85">0.85x</option>
            <option value="0.90">0.90x</option>
            <option value="0.95">0.95x</option>
            <option value="1.05">1.05x</option>
            <option value="1.10">1.10x</option>
            <option value="1.15">1.15x</option>
            <option value="1.20">1.20x</option>
          </select>

          <button
            type="button"
            className="transport-button unity-button"
            onClick={() => onRateChange(1.0)}
            aria-label="Reset speed to 1.0x"
          >
            1.0x Unity
          </button>
        </div>
      </div>

      <div className="transport-row transport-row-upgraded">
        <button
          type="button"
          className="transport-button transport-circle transport-circle-side"
          disabled={!canGoPrev}
          onClick={() => {
            void onPrev();
          }}
          aria-label="Previous track"
        >
          <span aria-hidden="true">{ICON_PREV}</span>
        </button>

        <button
          type="button"
          className="transport-button transport-circle transport-circle-main"
          disabled={!currentTrack}
          onClick={() => {
            void onTogglePlay();
          }}
          aria-label={playback.isPlaying ? "Pause playback" : "Play track"}
        >
          <span aria-hidden="true">{playback.isPlaying ? ICON_PAUSE : ICON_PLAY}</span>
        </button>

        <button
          type="button"
          className="transport-button transport-circle transport-circle-side"
          disabled={!canGoNext}
          onClick={() => {
            void onNext();
          }}
          aria-label="Next track"
        >
          <span aria-hidden="true">{ICON_NEXT}</span>
        </button>
      </div>

      {isQueueOpen ? (
        <div
          className="settings-overlay"
          onClick={() => setIsQueueOpen(false)}
          role="presentation"
        >
          <section
            className="settings-sheet queue-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Playback queue"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="settings-sheet-header">
              <h3>Queue ({queueTracks.length})</h3>
              <button
                type="button"
                className="icon-button settings-close"
                onClick={() => setIsQueueOpen(false)}
                aria-label="Close queue"
              >
                {ICON_CLOSE}
              </button>
            </header>

            {queueTracks.length === 0 ? (
              <p className="empty-state">Queue is empty. Add tracks from Library with Queue.</p>
            ) : (
              <>
                <button
                  type="button"
                  className="transport-button queue-clear-button"
                  onClick={onClearQueue}
                >
                  Clear Queue
                </button>

                <ul className="queue-list">
                  {queueTracks.map((track, index) => (
                    <li key={`${track.id}-${index}`} className="queue-row">
                      <button
                        type="button"
                        className="queue-main"
                        onClick={() => {
                          void onPlayQueueAt(index);
                          setIsQueueOpen(false);
                        }}
                      >
                        <span className="queue-index">{index + 1}.</span>
                        <span className="queue-title">{track.displayName}</span>
                      </button>
                      <button
                        type="button"
                        className="danger-button queue-remove"
                        onClick={() => onRemoveQueueAt(index)}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      ) : null}

      {isAppearanceOpen ? (
        <div
          className="settings-overlay"
          onClick={() => setIsAppearanceOpen(false)}
          role="presentation"
        >
          <section
            className="settings-sheet appearance-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Customize settings"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="settings-sheet-header">
              <h3>Customize Settings</h3>
              <button
                type="button"
                className="icon-button settings-close"
                onClick={() => setIsAppearanceOpen(false)}
                aria-label="Close customize settings"
              >
                {ICON_CLOSE}
              </button>
            </header>

            <div className="fx-card">
              <label className="field-label">Dark Lock Screen</label>
              <button
                type="button"
                className="transport-button dark-lock-button"
                onClick={() => {
                  onDarkLockActiveChange(true);
                  setIsAppearanceOpen(false);
                  setIsSettingsOpen(false);
                  setIsQueueOpen(false);
                }}
              >
                {darkLockActive ? "Dark Lock Active" : "Activate Dark Lock Screen"}
              </button>
            </div>

            <div className="fx-card">
              <div className="toggle-row settings-inline-toggle">
                <span>Waveform</span>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={waveformEnabled}
                    onChange={(event) => onWaveformEnabledChange(event.currentTarget.checked)}
                  />
                  <span>{waveformEnabled ? "On" : "Off"}</span>
                </label>
              </div>
              <label className="field-label" htmlFor="waveform-mode-select">
                Mode
              </label>
              <select
                id="waveform-mode-select"
                className="fx-select"
                value={waveformMode}
                onChange={(event) => onWaveformModeChange(event.currentTarget.value as WaveformMode)}
              >
                <option value="linear">Linear</option>
                <option value="circular">Circular</option>
                <option value="vectorscope">Vectorscope</option>
              </select>

              <label className="field-label">
                Oscilloscope Frame Rate: {clamp(Math.round(waveformTargetFps), 24, 120)} Hz
              </label>
              <input
                className="speed-slider"
                type="range"
                min={24}
                max={120}
                step={1}
                value={clamp(Math.round(waveformTargetFps), 24, 120)}
                onChange={(event) => onWaveformTargetFpsChange(Number(event.currentTarget.value))}
              />

              <label className="field-label" htmlFor="waveform-color-input">
                Waveform Color
              </label>
              <input
                id="waveform-color-input"
                className="waveform-color-input"
                type="color"
                value={normalizeHexColor(waveformColor)}
                onChange={(event) => onWaveformColorChange(event.currentTarget.value)}
              />
            </div>

            <div className="fx-card">
              <div className="toggle-row">
                <span>Background Motion</span>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={backgroundMotionEnabled}
                    onChange={(event) => onBackgroundMotionEnabledChange(event.currentTarget.checked)}
                  />
                  <span>{backgroundMotionEnabled ? "On" : "Off"}</span>
                </label>
              </div>

              <div className="toggle-row">
                <span>Bass-Reactive Motion</span>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={backgroundBassReactiveEnabled}
                    disabled={!backgroundMotionEnabled}
                    onChange={(event) =>
                      onBackgroundBassReactiveEnabledChange(event.currentTarget.checked)
                    }
                  />
                  <span>{backgroundBassReactiveEnabled ? "On" : "Off"}</span>
                </label>
              </div>

              <label className="field-label">
                Bass Reaction Strength: {Math.round(clamp(backgroundBassReaction, 0, 3) * 100)}%
              </label>
              <input
                className="speed-slider"
                type="range"
                min={0}
                max={300}
                step={1}
                value={Math.round(clamp(backgroundBassReaction, 0, 3) * 100)}
                disabled={!backgroundMotionEnabled || !backgroundBassReactiveEnabled}
                onChange={(event) =>
                  onBackgroundBassReactionChange(Number(event.currentTarget.value) / 100)
                }
              />
            </div>

            <div className="fx-card">
              <label className="field-label">Theme</label>
              <div className="appearance-grid">
                {appearanceThemes.map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    className={`appearance-option ${appearanceThemeId === theme.id ? "is-selected" : ""}`}
                    onClick={() => onAppearanceThemeChange(theme.id)}
                  >
                    <span
                      className="appearance-swatch"
                      style={{
                        background: `linear-gradient(120deg, ${theme.accent} 0%, ${theme.accent2} 100%)`
                      }}
                      aria-hidden="true"
                    />
                    <span className="appearance-option-title">{theme.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {isSettingsOpen ? (
        <div
          className="settings-overlay"
          onClick={() => setIsSettingsOpen(false)}
          role="presentation"
        >
          <section
            className="settings-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Audio settings"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="settings-sheet-header">
              <h3>Settings</h3>
              <button
                type="button"
                className="icon-button settings-close"
                onClick={() => setIsSettingsOpen(false)}
                aria-label="Close settings"
              >
                {ICON_CLOSE}
              </button>
            </header>

            <div className="fx-card">
              <div className="toggle-row">
                <span>Reverb</span>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={playback.reverbEnabled}
                    onChange={(event) => onReverbEnabledChange(event.currentTarget.checked)}
                  />
                  <span>{playback.reverbEnabled ? "On" : "Off"}</span>
                </label>
              </div>

              <label className="field-label" htmlFor="reverb-preset-select">
                Preset
              </label>
              <select
                id="reverb-preset-select"
                className="fx-select"
                value={playback.reverbPresetId}
                onChange={(event) => {
                  void onReverbPresetChange(event.currentTarget.value as ReverbPresetId);
                }}
              >
                {REVERB_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>

              <div className="speed-row">
                <span>Wet: {reverbWetPercent}%</span>
              </div>
              <input
                className="speed-slider"
                type="range"
                min={0}
                max={100}
                step={1}
                value={reverbWetPercent}
                onChange={(event) => {
                  const percent = clamp(Number(event.currentTarget.value), 0, 100);
                  onReverbWetChange((percent / 100) * REVERB_WET_INTERNAL_MAX);
                }}
              />

              <button
                type="button"
                className="transport-button fx-next-button"
                onClick={() => {
                  void onNextReverbPreset();
                }}
              >
                Next Preset
              </button>
            </div>

            <div className="fx-card">
              <div className="toggle-row">
                <span>Parametric EQ</span>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={playback.eqEnabled}
                    onChange={(event) => onEqEnabledChange(event.currentTarget.checked)}
                  />
                  <span>{playback.eqEnabled ? "On" : "Off"}</span>
                </label>
              </div>

              <label className="field-label" htmlFor="eq-preset-select">
                Preset
              </label>
              <div className="eq-preset-row">
                <select
                  id="eq-preset-select"
                  className="fx-select eq-preset-select"
                  value={eqCurveSelection}
                  onChange={(event) => {
                    onEqCurveSelectionChange(
                      event.currentTarget.value as EqPresetName | "Custom 1" | "Custom 2" | "Custom 3"
                    );
                  }}
                >
                  {eqCurveOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="transport-button eq-flat-button"
                  onClick={onEqResetFlat}
                >
                  Flat Reset
                </button>
              </div>

              <div className="eq-graph-wrap">
                <canvas className="eq-graph-canvas" ref={eqGraphCanvasRef} />
                {!playback.eqEnabled ? (
                  <p className="eq-graph-note">EQ bypassed (curve shown for editing).</p>
                ) : null}
              </div>

              <div className="eq-band-strip">
                {playback.eqBands.map((band) => (
                  <button
                    key={band.id}
                    type="button"
                    className={`eq-band-chip ${selectedEqBand?.id === band.id ? "is-selected" : ""} ${band.enabled ? "" : "is-disabled"
                      }`}
                    onClick={() => setSelectedEqBandId(band.id)}
                  >
                    <span>{band.label}</span>
                    <small>{formatEqFrequency(band.frequency)}</small>
                  </button>
                ))}
              </div>

              {selectedEqBand ? (
                <div className="eq-editor">
                  <div className="eq-editor-header">
                    <strong>
                      {selectedEqBand.label} | {selectedEqBand.type}
                    </strong>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={selectedEqBand.enabled}
                        onChange={(event) =>
                          onEqBandConfigChange(selectedEqBand.id, {
                            enabled: event.currentTarget.checked
                          })
                        }
                      />
                      <span>{selectedEqBand.enabled ? "Enabled" : "Bypassed"}</span>
                    </label>
                  </div>

                  <label className="field-label">
                    Frequency: {formatEqFrequency(selectedEqBand.frequency)}
                  </label>
                  <input
                    className="speed-slider"
                    type="range"
                    min={0}
                    max={1000}
                    step={1}
                    value={freqToSliderValue(selectedEqBand.frequency)}
                    onChange={(event) =>
                      onEqBandConfigChange(selectedEqBand.id, {
                        frequency: sliderValueToFreq(Number(event.currentTarget.value))
                      })
                    }
                  />

                  <label className="field-label">
                    Level (attenuate / boost): {selectedEqBand.gainDb >= 0 ? "+" : ""}
                    {selectedEqBand.gainDb.toFixed(1)} dB
                  </label>
                  <input
                    className="speed-slider"
                    type="range"
                    min={EQ_MIN_GAIN_DB}
                    max={EQ_MAX_GAIN_DB}
                    step={0.5}
                    value={selectedEqBand.gainDb}
                    disabled={!bandSupportsGain(selectedEqBand.type)}
                    onChange={(event) =>
                      onEqBandConfigChange(selectedEqBand.id, {
                        gainDb: Number(event.currentTarget.value)
                      })
                    }
                  />
                  {!bandSupportsGain(selectedEqBand.type) ? (
                    <p className="eq-editor-note">
                      Level is fixed for this filter type. Select Low/B1/B2/B3/B4/High to boost or cut.
                    </p>
                  ) : null}

                  <label className="field-label">
                    Q / Resonance: {selectedEqBand.q.toFixed(2)}
                  </label>
                  <input
                    className="speed-slider"
                    type="range"
                    min={EQ_MIN_Q}
                    max={EQ_MAX_Q}
                    step={0.05}
                    value={selectedEqBand.q}
                    onChange={(event) =>
                      onEqBandConfigChange(selectedEqBand.id, {
                        q: Number(event.currentTarget.value)
                      })
                    }
                  />
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

