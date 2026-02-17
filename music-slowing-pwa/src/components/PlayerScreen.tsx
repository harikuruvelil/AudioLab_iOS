import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EQ_BAND_LABELS, EQ_PRESET_NAMES, REVERB_PRESETS } from "../audioFxPresets";
import type {
  EqPresetName,
  PlaybackState,
  RepeatMode,
  ReverbPresetId,
  TrackMeta,
  WaveformMode
} from "../types";
import { formatDuration, semitonesFromRate } from "../utils";

interface PlayerScreenProps {
  playback: PlaybackState;
  currentTrack: TrackMeta | null;
  repeatMode: RepeatMode;
  shuffleEnabled: boolean;
  waveformEnabled: boolean;
  waveformMode: WaveformMode;
  onTogglePlay: () => Promise<void> | void;
  onPrev: () => Promise<void> | void;
  onNext: () => Promise<void> | void;
  onSeekCommit: (seconds: number) => void;
  onRateChange: (rate: number) => void;
  onReverbEnabledChange: (enabled: boolean) => void;
  onReverbPresetChange: (presetId: ReverbPresetId) => Promise<void> | void;
  onReverbWetChange: (wet: number) => void;
  onNextReverbPreset: () => Promise<void> | void;
  onEqEnabledChange: (enabled: boolean) => void;
  onEqBandGainChange: (bandIndex: number, gainDb: number) => void;
  onEqPresetChange: (presetName: EqPresetName) => void;
  onWaveformEnabledChange: (enabled: boolean) => void;
  onWaveformModeChange: (mode: WaveformMode) => void;
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

function formatHz(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "?";
  return Math.round(value).toLocaleString();
}

function createByteArray(length: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new ArrayBuffer(length));
}

function createFloatArray(length: number): Float32Array<ArrayBuffer> {
  return new Float32Array(new ArrayBuffer(length * Float32Array.BYTES_PER_ELEMENT));
}

const REVERB_WET_INTERNAL_MAX = 0.6;
const EQ_DISPLAY_BAND_LABELS = ["100", "250", "1k", "4k", "10k"] as const;
const ICON_GEAR = "\u2699";
const ICON_SHUFFLE = "\uD83D\uDD00";
const ICON_REPEAT = "\uD83D\uDD01";
const ICON_PREV = "\u23EE";
const ICON_PLAY = "\u25B6";
const ICON_PAUSE = "\u23F8";
const ICON_NEXT = "\u23ED";
const ICON_CLOSE = "\u2715";

export function PlayerScreen({
  playback,
  currentTrack,
  repeatMode,
  shuffleEnabled,
  waveformEnabled,
  waveformMode,
  onTogglePlay,
  onPrev,
  onNext,
  onSeekCommit,
  onRateChange,
  onReverbEnabledChange,
  onReverbPresetChange,
  onReverbWetChange,
  onNextReverbPreset,
  onEqEnabledChange,
  onEqBandGainChange,
  onEqPresetChange,
  onWaveformEnabledChange,
  onWaveformModeChange,
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
  const [showQualityDetails, setShowQualityDetails] = useState(false);
  const [vectorscopeMono, setVectorscopeMono] = useState(false);

  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const monoBytesRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const leftBytesRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const rightBytesRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const leftFloatRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const rightFloatRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const vectorscopeMonoRef = useRef(false);

  useEffect(() => {
    if (!isScrubbing) {
      setPreviewTime(playback.currentTime);
    }
  }, [isScrubbing, playback.currentTime]);

  useEffect(() => {
    if (!isSettingsOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSettingsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSettingsOpen]);

  const seekMax = Math.max(playback.duration, 0.001);
  const displayedTime = isScrubbing ? previewTime : playback.currentTime;
  const seekValue = clamp(displayedTime, 0, seekMax);
  const progress = playback.duration > 0 ? Math.min((seekValue / playback.duration) * 100, 100) : 0;
  const reverbWetPercent = Math.round(
    clamp((playback.reverbWet / REVERB_WET_INTERNAL_MAX) * 100, 0, 100)
  );

  const isQualityChecking = playback.quality.status === "checking";
  const hasResampled = playback.quality.status === "resampled";
  const qualityLabel = isQualityChecking
    ? "CHECKING..."
    : hasResampled
      ? "RESAMPLED"
      : "FULL RATE MATCH";

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
      setVectorscopeMono(false);
    }
  }, [playback.isPlaying, waveformEnabled, waveformMode]);

  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas) return;

    const context2d = canvas.getContext("2d");
    if (!context2d) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resizeCanvas = () => {
      const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };

    const drawIdle = () => {
      resizeCanvas();
      const { width, height } = canvas;
      context2d.fillStyle = "rgba(12, 16, 28, 0.92)";
      context2d.fillRect(0, 0, width, height);

      const y = height / 2;
      context2d.beginPath();
      context2d.moveTo(0, y);
      context2d.lineTo(width, y);
      context2d.strokeStyle = "rgba(101, 212, 255, 0.34)";
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

      const { width, height } = canvas;
      context2d.beginPath();
      for (let i = 0; i < waveform.length; i += 1) {
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
      context2d.strokeStyle = "rgba(101, 212, 255, 0.95)";
      context2d.stroke();
    };

    const drawCircular = (analyser: AnalyserNode) => {
      const sampleCount = analyser.fftSize;
      if (!monoBytesRef.current || monoBytesRef.current.length !== sampleCount) {
        monoBytesRef.current = createByteArray(sampleCount);
      }
      const waveform = monoBytesRef.current;
      analyser.getByteTimeDomainData(waveform);

      const { width, height } = canvas;
      const cx = width * 0.5;
      const cy = height * 0.5;
      const baseRadius = Math.min(width, height) * 0.28;
      const amplitudeScale = Math.min(width, height) * 0.12;

      context2d.beginPath();
      for (let i = 0; i < waveform.length; i += 1) {
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
      context2d.strokeStyle = "rgba(101, 212, 255, 0.9)";
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

      const stride = 2;
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
      const monoLikeFromDiff = diffCount > 0 && diffSum / diffCount < 0.01;
      const leftAvg = diffCount > 0 ? leftAbsSum / diffCount : 0;
      const rightAvg = diffCount > 0 ? rightAbsSum / diffCount : 0;
      const monoLikeFromSingleChannel = Math.min(leftAvg, rightAvg) < 0.005 && Math.max(leftAvg, rightAvg) > 0.02;
      const monoDetected = monoLikeFromDiff || monoLikeFromSingleChannel;
      const monoUseRight = rightAvg > leftAvg;
      if (monoDetected !== vectorscopeMonoRef.current) {
        vectorscopeMonoRef.current = monoDetected;
        setVectorscopeMono(monoDetected);
      }

      const { width, height } = canvas;
      const cx = width * 0.5;
      const cy = height * 0.5;
      const scale = Math.min(width, height) * 0.42;

      context2d.beginPath();
      context2d.moveTo(0, cy);
      context2d.lineTo(width, cy);
      context2d.moveTo(cx, 0);
      context2d.lineTo(cx, height);
      context2d.lineWidth = Math.max(1, dpr);
      context2d.strokeStyle = "rgba(255, 255, 255, 0.08)";
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
      context2d.lineWidth = Math.max(1.1, dpr);
      context2d.strokeStyle = "rgba(101, 212, 255, 0.85)";
      context2d.stroke();
    };

    let rafHandle = 0;
    const drawFrame = () => {
      resizeCanvas();
      const { width, height } = canvas;

      context2d.fillStyle = "rgba(12, 16, 28, 0.92)";
      context2d.fillRect(0, 0, width, height);

      const analysers = getWaveformAnalysers();

      if (waveformMode === "vectorscope" && analysers.left && analysers.right) {
        drawVectorscope(analysers.left, analysers.right);
      } else if (waveformMode === "circular" && analysers.mono) {
        drawCircular(analysers.mono);
      } else if (analysers.mono) {
        drawLinear(analysers.mono);
      } else {
        drawIdle();
      }

      rafHandle = window.requestAnimationFrame(drawFrame);
    };

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
  }, [getWaveformAnalysers, playback.isPlaying, waveformEnabled, waveformMode]);

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
              className={`status-chip ${
                isQualityChecking
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
          {hasResampled && showQualityDetails && qualityDetails.length > 0 ? (
            <p className="quality-details">{qualityDetails.join(" | ")}</p>
          ) : null}
        </div>
        <button
          type="button"
          className="icon-button settings-trigger"
          aria-label="Open settings"
          onClick={() => setIsSettingsOpen(true)}
        >
          {ICON_GEAR}
        </button>
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
          max={1.1}
          step={0.01}
          value={playback.rate}
          onChange={(event) => onRateChange(Number(event.currentTarget.value))}
        />

        <p className="player-subtitle">
          Pitch Shift: {pitchSemitones.toFixed(2)} semitones
        </p>
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
            </div>

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
                <span>EQ</span>
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
              <select
                id="eq-preset-select"
                className="fx-select"
                value={playback.eqPresetName ?? "Custom"}
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  if (next !== "Custom") {
                    onEqPresetChange(next as EqPresetName);
                  }
                }}
              >
                {EQ_PRESET_NAMES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                <option value="Custom">Custom</option>
              </select>

              <div className="eq-faders">
                {playback.eqBandGains.map((gainDb, index) => (
                  <label className="eq-fader" key={EQ_BAND_LABELS[index]}>
                    <span className="eq-fader-value">
                      {gainDb >= 0 ? "+" : ""}
                      {gainDb.toFixed(1)} dB
                    </span>
                    <span className="eq-fader-track">
                      <input
                        className="eq-slider-vertical"
                        type="range"
                        min={-12}
                        max={12}
                        step={0.5}
                        value={gainDb}
                        onChange={(event) =>
                          onEqBandGainChange(index, Number(event.currentTarget.value))
                        }
                      />
                    </span>
                    <span className="eq-fader-label">{EQ_DISPLAY_BAND_LABELS[index]}</span>
                  </label>
                ))}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
