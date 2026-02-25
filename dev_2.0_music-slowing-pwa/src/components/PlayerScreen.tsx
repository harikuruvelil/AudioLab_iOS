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
  onBackgroundBassReactionChange: (v: number) => void;
  bgBassLow: number;
  onBgBassLowChange: (v: number) => void;
  bgBassHigh: number;
  onBgBassHighChange: (v: number) => void;
  bgBassThreshold: number;
  onBgBassThresholdChange: (v: number) => void;
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

// ─── SVG Icon Components ───
const ICON_GEAR = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>;
const ICON_QUEUE = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>;
const ICON_APPEAR = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="4" /></svg>;
const ICON_SHUFFLE = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="4" y1="4" x2="9" y2="9" /></svg>;
const ICON_REPEAT = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 014-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 01-4 4H3" /></svg>;
const ICON_PREV = <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>;
const ICON_PLAY = <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>;
const ICON_PAUSE = <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>;
const ICON_NEXT = <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>;
const ICON_CLOSE = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;
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
  bgBassLow,
  onBgBassLowChange,
  bgBassHigh,
  onBgBassHighChange,
  bgBassThreshold,
  onBgBassThresholdChange,
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

  const [selectedEqBandId, setSelectedEqBandId] = useState<string | null>(null);

  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const eqGraphCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const monoBytesRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const leftBytesRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const rightBytesRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const leftFloatRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const rightFloatRef = useRef<Float32Array<ArrayBuffer> | null>(null);


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
    const hasOverlayOpen = isSettingsOpen || isQueueOpen || isAppearanceOpen;
    if (!hasOverlayOpen) return;

    const htmlEl = document.documentElement;
    const bodyEl = document.body;
    const previousHtmlOverscroll = htmlEl.style.overscrollBehavior;
    const previousBodyOverflow = bodyEl.style.overflow;
    const previousBodyOverscroll = bodyEl.style.overscrollBehavior;

    htmlEl.style.overscrollBehavior = "none";
    bodyEl.style.overflow = "hidden";
    bodyEl.style.overscrollBehavior = "none";

    return () => {
      htmlEl.style.overscrollBehavior = previousHtmlOverscroll;
      bodyEl.style.overflow = previousBodyOverflow;
      bodyEl.style.overscrollBehavior = previousBodyOverscroll;
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
    const canvas = waveformCanvasRef.current;
    if (!canvas) return;

    const context2d =
      canvas.getContext("2d", {
        alpha: false,
        desynchronized: true
      }) ?? canvas.getContext("2d");
    if (!context2d) return;
    context2d.imageSmoothingEnabled = false;

    const uiOverlayOpen = isSettingsOpen || isQueueOpen || isAppearanceOpen;
    const requestedFps = clamp(Math.round(waveformTargetFps), 24, 120);

    // On coarse-pointer (mobile/touch) devices, always cap at 30fps.
    // shadowBlur on canvas is extremely GPU-expensive on iOS — at 120fps it
    // saturates the GPU and blocks all touch event processing.
    const isMobile = typeof window.matchMedia === "function"
      && window.matchMedia("(pointer: coarse)").matches;
    const targetFps = isMobile
      ? Math.min(30, requestedFps)
      : (uiOverlayOpen ? Math.max(24, Math.min(requestedFps, 72)) : requestedFps);
    const highRefreshMode = !isMobile && targetFps >= 96;
    const ultraRefreshMode = !isMobile && targetFps >= 115;
    // Disable glow passes on mobile — they're the #1 GPU cost on iOS
    const glowEnabled = !isMobile;
    const dpr = isMobile
      ? Math.min(window.devicePixelRatio || 1, 1.0)
      : highRefreshMode
        ? Math.min(window.devicePixelRatio || 1, 1.35)
        : Math.min(window.devicePixelRatio || 1, 2);
    const rgb = hexToRgb(waveformColor);
    const lineColorStrong = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.92)`;
    const lineColorMedium = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.85)`;
    const lineColorSoft = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`;
    const lineColorGlow = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.18)`;
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
      context2d.fillStyle = "rgba(8, 12, 22, 0.95)";
      context2d.fillRect(0, 0, width, height);

      const y = height / 2;
      context2d.beginPath();
      context2d.moveTo(0, y);
      context2d.lineTo(width, y);
      context2d.strokeStyle = lineColorSoft;
      context2d.lineWidth = Math.max(1.1, dpr);
      context2d.stroke();

      // Subtle center glow
      context2d.shadowColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`;
      context2d.shadowBlur = 12 * dpr;
      context2d.beginPath();
      context2d.moveTo(0, y);
      context2d.lineTo(width, y);
      context2d.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.08)`;
      context2d.stroke();
      context2d.shadowBlur = 0;
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
      // Use more points for higher fidelity at 120Hz
      const maxPoints = isMobile
        ? Math.max(200, Math.min(300, Math.floor(width / Math.max(1.2, dpr * 1.2))))
        : highRefreshMode
          ? Math.max(320, Math.min(920, Math.floor(width / Math.max(0.9, dpr * 0.9))))
          : Math.max(600, Math.min(2048, Math.floor(width / Math.max(0.4, dpr * 0.45))));
      const stride = Math.max(1, Math.floor(waveform.length / maxPoints));
      const totalPoints = Math.floor(waveform.length / stride);

      // Build path with Catmull-Rom interpolation for smoothness
      context2d.beginPath();
      const getY = (idx: number) => {
        const cIdx = clamp(idx * stride, 0, waveform.length - 1);
        const normalized = (waveform[cIdx] - 128) / 128;
        return height * 0.5 + normalized * height * 0.38;
      };

      for (let i = 0; i < totalPoints; i++) {
        const x = (i / (totalPoints - 1)) * width;
        const y = getY(i);
        if (i === 0) {
          context2d.moveTo(x, y);
        } else if (i < totalPoints - 1) {
          // Use quadratic bezier for smoothness
          const prevX = ((i - 1) / (totalPoints - 1)) * width;
          const prevY = getY(i - 1);
          const cpx = (prevX + x) / 2;
          const cpy = (prevY + y) / 2;
          context2d.quadraticCurveTo(prevX, prevY, cpx, cpy);
        } else {
          context2d.lineTo(x, y);
        }
      }

      if (glowEnabled && !highRefreshMode) {
        context2d.shadowColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.55)`;
        context2d.shadowBlur = 22 * dpr;
        context2d.lineWidth = Math.max(3.5, dpr * 2.5);
        context2d.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.18)`;
        context2d.stroke();
      }

      if (glowEnabled && !ultraRefreshMode) {
        context2d.shadowColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.70)`;
        context2d.shadowBlur = highRefreshMode ? 5 * dpr : 8 * dpr;
        context2d.lineWidth = Math.max(2.2, dpr * 1.5);
        context2d.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.40)`;
        context2d.stroke();
      }
      context2d.shadowBlur = 0;

      // ─── Crisp foreground pass ───
      context2d.lineWidth = Math.max(1.4, dpr);
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
      const amplitudeScale = Math.min(width, height) * 0.14;
      const maxPoints = highRefreshMode
        ? Math.max(180, Math.min(520, Math.floor(width / Math.max(1.0, dpr * 1.1))))
        : Math.max(260, Math.min(760, Math.floor(width / Math.max(0.75, dpr))));
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

      if (glowEnabled && !ultraRefreshMode) {
        context2d.shadowColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.50)`;
        context2d.shadowBlur = highRefreshMode ? 8 * dpr : 14 * dpr;
        context2d.lineWidth = Math.max(2, dpr * 1.4);
        context2d.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`;
        context2d.stroke();
      }
      context2d.shadowBlur = 0;

      // Crisp foreground
      context2d.lineWidth = Math.max(1.3, dpr);
      context2d.strokeStyle = lineColorMedium;
      context2d.stroke();
    };


    let rafHandle = 0;
    let cachedAnalysers = getWaveformAnalysers();
    let analyserRefreshCounter = 0;
    let lastRenderedAt = 0;
    const minFrameMs = 1000 / targetFps;
    const analyserRefreshFrames = highRefreshMode ? 36 : Math.max(30, Math.floor(targetFps));

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
        context2d.fillStyle = "rgba(8, 12, 22, 0.95)";
        context2d.fillRect(0, 0, width, height);

        analyserRefreshCounter += 1;
        if (
          analyserRefreshCounter >= analyserRefreshFrames ||
          (!cachedAnalysers.mono && !cachedAnalysers.left && !cachedAnalysers.right)
        ) {
          cachedAnalysers = getWaveformAnalysers();
          analyserRefreshCounter = 0;
        }

        if (waveformMode === "circular" && cachedAnalysers.mono) {
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

              <label className="field-label">
                Bass Low Cutoff: {bgBassLow} Hz
              </label>
              <input
                className="speed-slider"
                type="range"
                min={20}
                max={400}
                step={5}
                value={bgBassLow}
                disabled={!backgroundMotionEnabled || !backgroundBassReactiveEnabled}
                onChange={(event) =>
                  onBgBassLowChange(Number(event.currentTarget.value))
                }
              />

              <label className="field-label">
                Bass High Cutoff: {bgBassHigh} Hz
              </label>
              <input
                className="speed-slider"
                type="range"
                min={60}
                max={800}
                step={10}
                value={bgBassHigh}
                disabled={!backgroundMotionEnabled || !backgroundBassReactiveEnabled}
                onChange={(event) =>
                  onBgBassHighChange(Number(event.currentTarget.value))
                }
              />

              <label className="field-label">
                Bass Threshold: {(bgBassThreshold * 100).toFixed(1)}%
              </label>
              <input
                className="speed-slider"
                type="range"
                min={0.5}
                max={20}
                step={0.5}
                value={bgBassThreshold * 100}
                disabled={!backgroundMotionEnabled || !backgroundBassReactiveEnabled}
                onChange={(event) =>
                  onBgBassThresholdChange(Number(event.currentTarget.value) / 100)
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
