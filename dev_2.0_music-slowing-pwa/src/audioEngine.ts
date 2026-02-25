import {
  EQ_MAX_FREQ,
  EQ_MAX_GAIN_DB,
  EQ_MAX_Q,
  EQ_MIN_FREQ,
  EQ_MIN_GAIN_DB,
  EQ_MIN_Q,
  REVERB_PRESET_MAP,
  applyEqPreset,
  bandSupportsGain,
  createDefaultEqBands,
  sanitizeEqBands
} from "./audioFxPresets";
import type {
  EqBand,
  EqGraphCurve,
  EqPresetName,
  PlaybackState,
  QualityState,
  ReverbPresetId
} from "./types";

const MIN_RATE = 0.5;
const MAX_RATE = 1.5;
const MIN_REVERB_WET = 0;
const MAX_REVERB_WET = 0.6;
const CLIP_THRESHOLD = 0.999;
const CLIP_HOLD_MS = 1000;
const HIGHPASS_BYPASS_FREQ = 10;
const LOWPASS_BYPASS_FREQ = 24000;

function createDefaultQualityState(): QualityState {
  return {
    status: "checking",
    contextHz: null,
    trackHz: null,
    irHz: null,
    trackResampled: false,
    irResampled: false,
    reverbActive: false
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampRate(rate: number): number {
  return clamp(rate, MIN_RATE, MAX_RATE);
}

function clampWet(wet: number): number {
  return clamp(wet, MIN_REVERB_WET, MAX_REVERB_WET);
}

function clampEqGain(gainDb: number): number {
  return clamp(gainDb, EQ_MIN_GAIN_DB, EQ_MAX_GAIN_DB);
}

function clampEqFrequency(frequency: number): number {
  return clamp(frequency, EQ_MIN_FREQ, EQ_MAX_FREQ);
}

function clampEqQ(q: number): number {
  return clamp(q, EQ_MIN_Q, EQ_MAX_Q);
}

type StateListener = (state: PlaybackState) => void;
type ErrorListener = (message: string) => void;
type EndedListener = () => void;

export interface WaveformAnalyserNodes {
  mono: AnalyserNode | null;
  left: AnalyserNode | null;
  right: AnalyserNode | null;
}

export class TapeAudioEngine {
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;

  // Graph:
  // source -> (eq chain or bypass) -> splitGain
  // splitGain -> dryGain -> masterGain -> destination
  // splitGain -> wetGain -> convolver -> masterGain -> destination
  private splitGain: GainNode | null = null;
  private dryGain: GainNode | null = null;
  private wetGain: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private masterGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private leftAnalyser: AnalyserNode | null = null;
  private rightAnalyser: AnalyserNode | null = null;
  private stereoSplitter: ChannelSplitterNode | null = null;
  private peakMeterNode: AudioWorkletNode | null = null;
  private peakMeterSink: GainNode | null = null;
  private eqFilters: BiquadFilterNode[] = [];
  private bassSpectrumData: Uint8Array<ArrayBuffer> | null = null;
  private bassTimeDomainData: Uint8Array<ArrayBuffer> | null = null;
  private bassEnvelope = 0;

  private trackId: string | null = null;
  private duration = 0;
  private isPlaying = false;
  private rate = 1;

  private reverbEnabled = false;
  private reverbPresetId: ReverbPresetId = "off";
  private reverbWet = 0.25;

  private eqEnabled = false;
  private eqBands: EqBand[] = createDefaultEqBands();
  private eqPresetName: EqPresetName | null = "Flat";
  private quality: QualityState = createDefaultQualityState();
  private clipWarning = false;

  private anchorContextTime = 0;
  private anchorMediaTime = 0;

  private sourceToken = 0;
  private decodeToken = 0;
  private reverbLoadToken = 0;
  private tickHandle: number | null = null;
  private clipClearHandle: number | null = null;
  private workletSetupPromise: Promise<void> | null = null;
  private peakMeterUnavailableNotified = false;
  private peakMeterDisabled = false;
  private trackLoading = false;
  private irLoading = false;

  private irCache = new Map<ReverbPresetId, AudioBuffer>();

  private stateListeners = new Set<StateListener>();
  private errorListeners = new Set<ErrorListener>();
  private endedListeners = new Set<EndedListener>();

  subscribe(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  onEnded(listener: EndedListener): () => void {
    this.endedListeners.add(listener);
    return () => {
      this.endedListeners.delete(listener);
    };
  }

  getAnalyserNode(): AnalyserNode | null {
    return this.analyser;
  }

  getWaveformAnalyserNodes(): WaveformAnalyserNodes {
    return {
      mono: this.analyser,
      left: this.leftAnalyser,
      right: this.rightAnalyser
    };
  }

  getEqGraphCurve(pointCount = 320): EqGraphCurve | null {
    if (this.eqFilters.length === 0) return null;

    const points = clamp(Math.floor(pointCount), 64, 1024);
    const frequencies = new Float32Array(points);
    const combinedMagnitude = new Float32Array(points);
    combinedMagnitude.fill(1);

    const scratchMagnitude = new Float32Array(points);
    const scratchPhase = new Float32Array(points);

    const minLog = Math.log10(EQ_MIN_FREQ);
    const maxLog = Math.log10(EQ_MAX_FREQ);

    for (let i = 0; i < points; i += 1) {
      const t = i / (points - 1);
      frequencies[i] = 10 ** (minLog + t * (maxLog - minLog));
    }

    for (const node of this.eqFilters) {
      node.getFrequencyResponse(frequencies, scratchMagnitude, scratchPhase);
      for (let i = 0; i < points; i += 1) {
        combinedMagnitude[i] *= Math.max(1e-12, scratchMagnitude[i]);
      }
    }

    const gainsDb = Array.from(combinedMagnitude, (value) => 20 * Math.log10(Math.max(value, 1e-12)));
    return {
      frequencies: Array.from(frequencies),
      gainsDb
    };
  }

  getBassReactiveLevel(lowHz = 70, highHz = 300): number {
    if (!this.context || !this.analyser || !this.isPlaying) {
      this.bassEnvelope *= 0.84;
      if (this.bassEnvelope < 0.001) {
        this.bassEnvelope = 0;
      }
      return this.bassEnvelope;
    }

    const analyser = this.analyser;
    const binCount = analyser.frequencyBinCount;
    if (!this.bassSpectrumData || this.bassSpectrumData.length !== binCount) {
      this.bassSpectrumData = new Uint8Array(new ArrayBuffer(binCount));
    }
    const timeDomainCount = analyser.fftSize;
    if (!this.bassTimeDomainData || this.bassTimeDomainData.length !== timeDomainCount) {
      this.bassTimeDomainData = new Uint8Array(new ArrayBuffer(timeDomainCount));
    }

    analyser.getByteFrequencyData(this.bassSpectrumData);
    analyser.getByteTimeDomainData(this.bassTimeDomainData);

    const nyquist = this.context.sampleRate * 0.5;
    const safeLowHz = Math.max(12, Math.min(lowHz, highHz - 1));
    const safeHighHz = Math.max(safeLowHz + 1, highHz);

    const low = clamp(Math.floor((safeLowHz / nyquist) * binCount), 0, binCount - 1);
    const high = clamp(Math.ceil((safeHighHz / nyquist) * binCount), low + 1, binCount);

    let weightedSum = 0;
    let weightTotal = 0;
    for (let i = low; i < high; i += 1) {
      const normalizedIndex = (i - low) / Math.max(1, high - low - 1);
      const weight = 1.35 - normalizedIndex * 0.65;
      weightedSum += (this.bassSpectrumData[i] / 255) * weight;
      weightTotal += weight;
    }
    const weightedAverage = weightTotal > 0 ? weightedSum / weightTotal : 0;

    const subHighHz = Math.min(safeHighHz, Math.max(safeLowHz + 1, 120));
    const subHigh = clamp(Math.ceil((subHighHz / nyquist) * binCount), low + 1, high);
    let subSum = 0;
    let subCount = 0;
    for (let i = low; i < subHigh; i += 1) {
      subSum += this.bassSpectrumData[i] / 255;
      subCount += 1;
    }
    const subAverage = subCount > 0 ? subSum / subCount : weightedAverage;

    let rmsAccumulator = 0;
    let rmsCount = 0;
    for (let i = 0; i < this.bassTimeDomainData.length; i += 2) {
      const centered = (this.bassTimeDomainData[i] - 128) / 128;
      rmsAccumulator += centered * centered;
      rmsCount += 1;
    }
    const rms = rmsCount > 0 ? Math.sqrt(rmsAccumulator / rmsCount) : 0;
    const transient = clamp((rms - 0.015) * 8.5, 0, 1);

    const combined = clamp(
      weightedAverage * 0.58 + subAverage * 0.27 + transient * 0.35,
      0,
      1
    );
    const attack = combined > this.bassEnvelope ? 0.44 : 0.17;
    this.bassEnvelope += (combined - this.bassEnvelope) * attack;
    return clamp(this.bassEnvelope, 0, 1);
  }

  async ensureContext(): Promise<void> {
    const shouldRecreateContext = !this.context || this.context.state === "closed";
    if (shouldRecreateContext) {
      const wasPlaying = this.isPlaying;
      this.stopSource();
      this.stopTicker();
      this.resetProcessingGraphState();
      this.context = new AudioContext();
      this.setupProcessingGraph(this.context);
      this.anchorContextTime = this.context.currentTime;

      if (wasPlaying) {
        this.isPlaying = false;
        this.anchorMediaTime = clamp(this.anchorMediaTime, 0, this.duration);
        this.emitState();
      }
    } else if (this.isPlaying && !this.source) {
      this.isPlaying = false;
      this.stopTicker();
      if (this.context) {
        this.anchorContextTime = this.context.currentTime;
      }
      this.anchorMediaTime = clamp(this.anchorMediaTime, 0, this.duration);
      this.emitState();
    }

    const ctx = this.context;
    if (!ctx) return;

    await this.setupMonitoringGraph();

    if (ctx.state !== "running") {
      await ctx.resume();
    }

    this.applyEqCurve();
    this.updateMixAndSafety();

    if (this.reverbPresetId === "off") {
      this.irLoading = false;
      if (this.convolver) {
        this.convolver.buffer = null;
      }
    } else {
      const cached = this.irCache.get(this.reverbPresetId);
      if (cached && this.convolver) {
        this.convolver.buffer = cached;
        this.irLoading = false;
      } else {
        void this.loadIrPreset(this.reverbPresetId);
      }
    }
  }

  async loadTrack(trackId: string, blob: Blob): Promise<void> {
    await this.ensureContext();
    const ctx = this.context;
    if (!ctx) return;

    const decodeToken = ++this.decodeToken;
    this.trackLoading = true;
    this.emitState();

    let arrayBuffer: ArrayBuffer;
    try {
      arrayBuffer = await blob.arrayBuffer();
    } catch {
      if (decodeToken === this.decodeToken) {
        this.trackLoading = false;
        this.emitState();
      }
      this.emitError("Could not read this file from storage.");
      throw new Error("read-failed");
    }

    let decoded: AudioBuffer;
    try {
      decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    } catch {
      if (decodeToken === this.decodeToken) {
        this.trackLoading = false;
        this.emitState();
      }
      this.emitError("Could not decode this file on iOS Safari.");
      throw new Error("decode-failed");
    }

    if (decodeToken !== this.decodeToken) return;

    this.stopSource();
    this.stopTicker();

    this.buffer = decoded;
    this.trackId = trackId;
    this.duration = decoded.duration;
    this.isPlaying = false;
    this.anchorMediaTime = 0;
    this.anchorContextTime = ctx.currentTime;
    this.trackLoading = false;

    this.emitState();
  }

  async playTrack(trackId: string, blob: Blob): Promise<void> {
    if (trackId !== this.trackId || !this.buffer) {
      await this.loadTrack(trackId, blob);
    }
    await this.play();
  }

  async play(): Promise<void> {
    await this.ensureContext();

    if (!this.context || !this.masterGain || !this.buffer) {
      this.emitError("Select a track first.");
      return;
    }

    if (this.isPlaying) return;

    const offset = this.anchorMediaTime >= this.duration ? 0 : this.anchorMediaTime;
    this.startSourceAt(clamp(offset, 0, this.duration));
  }

  pause(): void {
    if (!this.context || !this.isPlaying) return;

    this.anchorMediaTime = this.currentMediaTime();
    this.anchorContextTime = this.context.currentTime;
    this.isPlaying = false;
    this.bassEnvelope = 0;
    this.stopSource();
    this.stopTicker();
    this.emitState();
  }

  stop(): void {
    if (this.context) {
      this.anchorContextTime = this.context.currentTime;
    }
    this.anchorMediaTime = 0;
    this.isPlaying = false;
    this.bassEnvelope = 0;
    this.stopSource();
    this.stopTicker();
    this.emitState();
  }

  seek(seconds: number): void {
    if (!this.context || !this.buffer) return;

    const target = clamp(seconds, 0, this.duration);
    const wasPlaying = this.isPlaying;

    this.isPlaying = false;
    this.stopSource();
    this.anchorMediaTime = target;
    this.anchorContextTime = this.context.currentTime;

    if (wasPlaying) {
      this.startSourceAt(target);
    } else {
      this.emitState();
    }
  }

  setRate(rate: number): void {
    const next = clampRate(rate);
    if (next === this.rate) return;

    if (this.context) {
      const now = this.context.currentTime;
      const mediaNow = this.currentMediaTime();
      this.anchorMediaTime = mediaNow;
      this.anchorContextTime = now;

      if (this.source) {
        this.source.playbackRate.cancelScheduledValues(now);
        this.source.playbackRate.setTargetAtTime(next, now, 0.015);
      }
    }

    this.rate = next;
    this.emitState();
  }

  setReverbEnabled(enabled: boolean): void {
    this.reverbEnabled = enabled;

    if (!enabled) {
      this.irLoading = false;
    } else if (enabled && this.reverbPresetId !== "off" && this.context) {
      if (this.irCache.has(this.reverbPresetId) && this.convolver) {
        this.convolver.buffer = this.irCache.get(this.reverbPresetId) ?? null;
        this.irLoading = false;
      } else {
        void this.loadIrPreset(this.reverbPresetId);
      }
    }

    this.updateMixAndSafety();
    this.emitState();
  }

  setReverbWet(wet: number): void {
    this.reverbWet = clampWet(wet);
    this.updateMixAndSafety();
    this.emitState();
  }

  async setReverbPreset(presetId: ReverbPresetId): Promise<void> {
    this.reverbPresetId = presetId;

    if (presetId === "off") {
      this.reverbLoadToken += 1;
      this.irLoading = false;
      if (this.convolver) {
        this.convolver.buffer = null;
      }
      this.updateMixAndSafety();
      this.emitState();
      return;
    }

    if (!this.context) {
      this.irLoading = false;
      this.updateMixAndSafety();
      this.emitState();
      return;
    }

    await this.loadIrPreset(presetId);
  }

  async loadIrPreset(presetId: ReverbPresetId): Promise<void> {
    const ctx = this.context;
    const convolver = this.convolver;

    if (!ctx || !convolver) return;

    if (presetId === "off") {
      this.reverbLoadToken += 1;
      convolver.buffer = null;
      this.irLoading = false;
      this.updateMixAndSafety();
      this.emitState();
      return;
    }

    const preset = REVERB_PRESET_MAP.get(presetId);
    if (!preset?.url) {
      convolver.buffer = null;
      this.irLoading = false;
      this.emitError("Invalid IR preset configuration. Playing dry.");
      this.updateMixAndSafety();
      this.emitState();
      return;
    }

    const cached = this.irCache.get(presetId);
    if (cached) {
      if (this.reverbPresetId === presetId) {
        convolver.buffer = cached;
      }
      this.irLoading = false;
      this.updateMixAndSafety();
      this.emitState();
      return;
    }

    const token = ++this.reverbLoadToken;
    this.irLoading = true;
    this.emitState();

    try {
      const response = await fetch(preset.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      this.irCache.set(presetId, decoded);

      if (token !== this.reverbLoadToken) return;
      if (this.reverbPresetId !== presetId) return;

      convolver.buffer = decoded;
      this.irLoading = false;
    } catch {
      if (token !== this.reverbLoadToken) return;
      if (this.reverbPresetId !== presetId) return;

      convolver.buffer = null;
      this.irLoading = false;
      this.emitError(`Failed to load "${preset.label}" IR. Playing dry.`);
    }

    this.updateMixAndSafety();
    this.emitState();
  }

  setEqEnabled(enabled: boolean): void {
    this.eqEnabled = enabled;
    this.reconnectActiveSourcePath();
    this.applyEqCurve();
    this.updateMixAndSafety();
    this.emitState();
  }

  setEqBandGain(index: number, gainDb: number): void {
    if (index < 0 || index >= this.eqBands.length) return;
    const band = this.eqBands[index];
    if (!bandSupportsGain(band.type)) return;
    this.setEqBandConfig(band.id, { gainDb });
  }

  setEqBandConfig(
    bandId: string,
    patch: Partial<Pick<EqBand, "enabled" | "frequency" | "gainDb" | "q">>
  ): void {
    const index = this.eqBands.findIndex((band) => band.id === bandId);
    if (index < 0) return;

    const current = this.eqBands[index];
    const next: EqBand = {
      ...current,
      enabled: typeof patch.enabled === "boolean" ? patch.enabled : current.enabled,
      frequency:
        typeof patch.frequency === "number"
          ? clampEqFrequency(patch.frequency)
          : current.frequency,
      gainDb:
        typeof patch.gainDb === "number"
          ? clampEqGain(patch.gainDb)
          : current.gainDb,
      q: typeof patch.q === "number" ? clampEqQ(patch.q) : current.q
    };

    const updated = [...this.eqBands];
    updated[index] = next;
    this.eqBands = updated;
    this.eqPresetName = null;

    this.applyEqCurve();
    this.updateMixAndSafety();
    this.emitState();
  }

  setEqBands(bands: readonly EqBand[], presetName: EqPresetName | null = null): void {
    this.eqBands = sanitizeEqBands(bands);
    this.eqPresetName = presetName;
    this.applyEqCurve();
    this.updateMixAndSafety();
    this.emitState();
  }

  setEqBandGains(gains: readonly number[], presetName: EqPresetName | null = null): void {
    const gainBandIds = this.eqBands
      .filter((band) => bandSupportsGain(band.type))
      .map((band) => band.id);

    if (gains.length === 0 || gainBandIds.length === 0) return;

    const nextBands = this.eqBands.map((band) => ({ ...band }));
    let gainIndex = 0;
    for (const bandId of gainBandIds) {
      if (gainIndex >= gains.length) break;
      const band = nextBands.find((item) => item.id === bandId);
      if (!band) continue;
      band.gainDb = clampEqGain(gains[gainIndex]);
      gainIndex += 1;
    }

    this.eqBands = sanitizeEqBands(nextBands);
    this.eqPresetName = presetName;
    this.applyEqCurve();
    this.updateMixAndSafety();
    this.emitState();
  }

  setEqPreset(presetName: EqPresetName): void {
    this.eqBands = applyEqPreset(this.eqBands, presetName);
    this.eqPresetName = presetName;
    this.applyEqCurve();
    this.updateMixAndSafety();
    this.emitState();
  }

  clearTrack(trackId?: string): void {
    if (trackId && this.trackId !== trackId) return;

    this.stop();
    this.buffer = null;
    this.trackId = null;
    this.duration = 0;
    this.anchorMediaTime = 0;
    this.trackLoading = false;
    this.bassEnvelope = 0;
    this.setClipWarning(false);
    this.emitState();
  }

  async dispose(): Promise<void> {
    this.stopTicker();
    this.stopSource();
    this.clearClipHoldTimer();
    this.setClipWarning(false);
    this.buffer = null;
    this.resetProcessingGraphState();

    this.workletSetupPromise = null;
    this.peakMeterDisabled = false;
    this.trackLoading = false;
    this.irLoading = false;
    this.bassSpectrumData = null;
    this.bassTimeDomainData = null;
    this.bassEnvelope = 0;
    this.quality = createDefaultQualityState();

    if (this.context && this.context.state !== "closed") {
      await this.context.close();
    }

    this.context = null;
  }

  private resetProcessingGraphState(): void {
    this.eqFilters = [];
    this.splitGain = null;
    this.dryGain = null;
    this.wetGain = null;
    this.convolver = null;
    this.masterGain = null;
    this.analyser = null;
    this.leftAnalyser = null;
    this.rightAnalyser = null;
    this.stereoSplitter = null;

    if (this.peakMeterNode) {
      this.peakMeterNode.port.onmessage = null;
      this.peakMeterNode.disconnect();
      this.peakMeterNode = null;
    }
    if (this.peakMeterSink) {
      this.peakMeterSink.disconnect();
      this.peakMeterSink = null;
    }

    this.workletSetupPromise = null;
    this.bassSpectrumData = null;
    this.bassTimeDomainData = null;
    this.bassEnvelope = 0;
  }

  private setupProcessingGraph(ctx: AudioContext): void {
    this.splitGain = ctx.createGain();
    this.dryGain = ctx.createGain();
    this.wetGain = ctx.createGain();
    this.convolver = ctx.createConvolver();
    this.masterGain = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.leftAnalyser = ctx.createAnalyser();
    this.rightAnalyser = ctx.createAnalyser();
    this.stereoSplitter = ctx.createChannelSplitter(2);

    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.12;
    this.leftAnalyser.fftSize = 1024;
    this.leftAnalyser.smoothingTimeConstant = 0.02;
    this.rightAnalyser.fftSize = 1024;
    this.rightAnalyser.smoothingTimeConstant = 0.02;

    this.eqFilters = this.eqBands.map((band) => {
      const node = ctx.createBiquadFilter();
      node.type = band.type;
      return node;
    });

    for (let i = 0; i < this.eqFilters.length - 1; i += 1) {
      this.eqFilters[i].connect(this.eqFilters[i + 1]);
    }
    this.eqFilters[this.eqFilters.length - 1].connect(this.splitGain);

    this.splitGain.connect(this.dryGain);
    this.splitGain.connect(this.wetGain);
    this.wetGain.connect(this.convolver);
    this.convolver.connect(this.masterGain);
    this.dryGain.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);
    this.masterGain.connect(this.analyser);
    this.masterGain.connect(this.stereoSplitter);
    this.stereoSplitter.connect(this.leftAnalyser, 0);
    this.stereoSplitter.connect(this.rightAnalyser, 1);

    this.applyEqCurve();
  }

  private async setupMonitoringGraph(): Promise<void> {
    const ctx = this.context;
    const masterGain = this.masterGain;

    if (
      !ctx ||
      !masterGain ||
      this.peakMeterNode ||
      this.workletSetupPromise ||
      this.peakMeterDisabled
    ) {
      return;
    }
    if (!ctx.audioWorklet) return;

    this.workletSetupPromise = (async () => {
      try {
        await ctx.audioWorklet.addModule("/worklets/peak-meter-worklet.js");

        if (!this.context || this.context !== ctx || !this.masterGain) return;

        const node = new AudioWorkletNode(ctx, "peak-meter-processor");
        const sink = ctx.createGain();
        sink.gain.value = 0;

        node.port.onmessage = (event: MessageEvent) => {
          const data = event.data as { peak?: unknown };
          if (typeof data.peak === "number" && data.peak >= CLIP_THRESHOLD) {
            this.raiseClipWarning();
          }
        };

        this.masterGain.connect(node);
        node.connect(sink);
        sink.connect(ctx.destination);

        this.peakMeterNode = node;
        this.peakMeterSink = sink;
      } catch {
        this.peakMeterDisabled = true;
        if (!this.peakMeterUnavailableNotified) {
          this.peakMeterUnavailableNotified = true;
          this.emitError("Clip meter unavailable on this browser build.");
        }
      } finally {
        this.workletSetupPromise = null;
      }
    })();

    await this.workletSetupPromise;
  }

  private recomputeQualityState(): void {
    const contextHz = this.context ? Math.round(this.context.sampleRate) : null;
    const trackHz = this.buffer ? Math.round(this.buffer.sampleRate) : null;
    const irHz = this.convolver?.buffer ? Math.round(this.convolver.buffer.sampleRate) : null;

    const reverbRequested = this.reverbEnabled && this.reverbPresetId !== "off";
    const reverbActive = reverbRequested && irHz !== null;

    const trackResampled = contextHz !== null && trackHz !== null ? trackHz !== contextHz : false;
    const irResampled =
      reverbActive && contextHz !== null && irHz !== null ? irHz !== contextHz : false;

    const checking =
      contextHz === null ||
      trackHz === null ||
      this.trackLoading ||
      (reverbRequested && this.irLoading);

    let status: QualityState["status"] = "checking";
    if (!checking) {
      status = trackResampled || irResampled ? "resampled" : "full_rate_match";
    }

    this.quality = {
      status,
      contextHz,
      trackHz,
      irHz,
      trackResampled,
      irResampled,
      reverbActive
    };
  }

  private connectSourceToGraph(source: AudioBufferSourceNode): void {
    if (!this.splitGain) return;

    source.disconnect();
    if (this.eqEnabled && this.eqFilters.length > 0) {
      source.connect(this.eqFilters[0]);
    } else {
      source.connect(this.splitGain);
    }
  }

  private reconnectActiveSourcePath(): void {
    if (!this.source) return;
    this.connectSourceToGraph(this.source);
  }

  private applyEqCurve(): void {
    if (!this.context || this.eqFilters.length === 0) return;

    const now = this.context.currentTime;
    const lowpassBypassFreq = Math.min(
      LOWPASS_BYPASS_FREQ,
      this.context.sampleRate * 0.49
    );

    for (let i = 0; i < this.eqFilters.length; i += 1) {
      const band = this.eqBands[i];
      const node = this.eqFilters[i];
      if (!band || !node) continue;

      node.type = band.type;

      const isActive = this.eqEnabled && band.enabled;
      let frequency = clampEqFrequency(band.frequency);
      let q = clampEqQ(band.q);
      let gainDb = bandSupportsGain(band.type) ? clampEqGain(band.gainDb) : 0;

      if (!isActive) {
        if (band.type === "highpass") {
          frequency = HIGHPASS_BYPASS_FREQ;
          q = 0.707;
        } else if (band.type === "lowpass") {
          frequency = lowpassBypassFreq;
          q = 0.707;
        } else {
          gainDb = 0;
        }
      }

      node.frequency.setTargetAtTime(frequency, now, 0.015);
      node.Q.setTargetAtTime(q, now, 0.015);
      node.gain.setTargetAtTime(gainDb, now, 0.015);
    }
  }

  private updateMixAndSafety(): void {
    if (!this.context || !this.dryGain || !this.wetGain || !this.masterGain) return;

    const now = this.context.currentTime;
    const effectiveWet = this.effectiveWetAmount();
    const dry = clamp(1 - effectiveWet, 0.4, 1.0);

    const maxEqBoostDb = this.eqEnabled
      ? Math.max(
        0,
        ...this.eqBands.map((band) => {
          if (!band.enabled || !bandSupportsGain(band.type)) return 0;
          return Math.max(0, band.gainDb);
        })
      )
      : 0;

    const safeMaster = clamp(
      0.9 - maxEqBoostDb / 60 - effectiveWet * 0.25,
      0.5,
      0.95
    );

    this.dryGain.gain.setTargetAtTime(dry, now, 0.02);
    this.wetGain.gain.setTargetAtTime(effectiveWet, now, 0.02);
    this.masterGain.gain.setTargetAtTime(safeMaster, now, 0.02);
  }

  private effectiveWetAmount(): number {
    if (!this.reverbEnabled) return 0;
    if (this.reverbPresetId === "off") return 0;
    if (!this.convolver?.buffer) return 0;
    return clampWet(this.reverbWet);
  }

  private startSourceAt(offsetSeconds: number): void {
    if (!this.context || !this.buffer) return;

    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.playbackRate.setValueAtTime(this.rate, now);
    this.connectSourceToGraph(source);

    const token = ++this.sourceToken;
    source.onended = () => {
      this.handleSourceEnded(token);
    };

    source.start(now, offsetSeconds);

    this.source = source;
    this.isPlaying = true;
    this.anchorContextTime = now;
    this.anchorMediaTime = offsetSeconds;
    this.startTicker();
    this.emitState();
  }

  private handleSourceEnded(token: number): void {
    if (token !== this.sourceToken) return;

    this.source?.disconnect();
    this.source = null;

    if (!this.isPlaying) return;

    if (this.context) {
      this.anchorContextTime = this.context.currentTime;
    }
    this.anchorMediaTime = this.duration;
    this.isPlaying = false;
    this.stopTicker();
    this.emitState();

    for (const listener of this.endedListeners) {
      listener();
    }
  }

  private stopSource(): void {
    if (!this.source) return;

    this.sourceToken += 1;
    this.source.onended = null;

    try {
      this.source.stop();
    } catch {
      // Source already stopped.
    }

    this.source.disconnect();
    this.source = null;
  }

  private currentMediaTime(): number {
    if (!this.context) return this.anchorMediaTime;

    if (!this.isPlaying || !this.source) {
      return clamp(this.anchorMediaTime, 0, this.duration);
    }

    const elapsedContext = this.context.currentTime - this.anchorContextTime;
    const elapsedMedia = elapsedContext * this.rate;
    return clamp(this.anchorMediaTime + elapsedMedia, 0, this.duration);
  }

  private snapshot(): PlaybackState {
    this.recomputeQualityState();
    return {
      trackId: this.trackId,
      isReady: Boolean(this.buffer),
      isPlaying: this.isPlaying,
      rate: this.rate,
      currentTime: this.currentMediaTime(),
      duration: this.duration,
      reverbEnabled: this.reverbEnabled,
      reverbPresetId: this.reverbPresetId,
      reverbWet: this.reverbWet,
      eqEnabled: this.eqEnabled,
      eqBands: this.eqBands,
      eqPresetName: this.eqPresetName,
      quality: this.quality,
      clipWarning: this.clipWarning
    };
  }

  private emitState(): void {
    const state = this.snapshot();
    for (const listener of this.stateListeners) {
      listener(state);
    }
  }

  private emitError(message: string): void {
    for (const listener of this.errorListeners) {
      listener(message);
    }
  }

  private raiseClipWarning(): void {
    this.setClipWarning(true);
    this.clearClipHoldTimer();
    this.clipClearHandle = window.setTimeout(() => {
      this.clipClearHandle = null;
      this.setClipWarning(false);
    }, CLIP_HOLD_MS);
  }

  private setClipWarning(next: boolean): void {
    if (this.clipWarning === next) return;
    this.clipWarning = next;
    this.emitState();
  }

  private clearClipHoldTimer(): void {
    if (this.clipClearHandle === null) return;
    window.clearTimeout(this.clipClearHandle);
    this.clipClearHandle = null;
  }

  private startTicker(): void {
    if (this.tickHandle !== null) return;
    this.tickHandle = window.setInterval(() => this.emitState(), 100);
  }

  private stopTicker(): void {
    if (this.tickHandle === null) return;
    window.clearInterval(this.tickHandle);
    this.tickHandle = null;
  }
}
