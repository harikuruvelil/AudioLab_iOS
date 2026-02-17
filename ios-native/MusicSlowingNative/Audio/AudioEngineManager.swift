import AudioKit
import AVFoundation
import Combine
import Foundation
import SoundpipeAudioKit

private final class EngineNodeAdapter: Node {
    var connections: [Node] { [] }
    let avAudioNode: AVAudioNode

    init(_ avAudioNode: AVAudioNode) {
        self.avAudioNode = avAudioNode
    }
}

private struct ResolvedIRURL {
    let url: URL
    let stopAccess: (() -> Void)?
}

final class AudioEngineManager: ObservableObject {
    @Published var currentTrack: Track?
    @Published var isPlaying = false
    @Published var currentTime: Double = 0
    @Published var duration: Double = 0

    @Published var rate: Float = 1.0
    @Published var repeatMode: RepeatMode = .off
    @Published var shuffleEnabled = false

    @Published var reverbEnabled = false
    @Published var selectedIRPresetId = IRPreset.off.id
    @Published var reverbWetPercent: Double = 0
    @Published private(set) var irPresets: [IRPreset] = IRPreset.builtInPresets

    @Published var eqEnabled = false
    @Published var eqBandGains: [Float] = [0, 0, 0, 0, 0]
    @Published var eqPresetName: EQPresetName = .flat

    @Published var waveformEnabled = true
    @Published var waveformMode: WaveformMode = .linear
    @Published var waveformFrame: WaveformFrame = .empty

    @Published var qualityState = QualityState()
    @Published var clipWarning = false
    @Published var toastMessage: String?

    private let engine = AVAudioEngine()
    private let playerNode = AVAudioPlayerNode()
    private let varispeedNode = AVAudioUnitVarispeed()
    private let eqNode = AVAudioUnitEQ(numberOfBands: 5)
    private let dryGainNode = AVAudioMixerNode()
    private let wetGainNode = AVAudioMixerNode()
    private let masterGainNode = AVAudioMixerNode()

    private var activeConvolution: Convolution?
    private var attachedConvolverNode: AVAudioNode?
    private var convolverCache: [String: Convolution] = [:]
    private var irSampleRateCache: [String: Double] = [:]

    private weak var libraryStore: LibraryStore?
    private var libraryCancellable: AnyCancellable?

    private var currentFile: AVAudioFile?
    private var currentPlaybackHandle: PlaybackURLHandle?
    private var currentTrackSampleRate: Double?
    private var currentIRSampleRate: Double?
    private var contextSampleRate: Double?

    private var scheduledStartTime: Double = 0
    private var pausedTime: Double = 0
    private var scheduleGeneration = 0
    private var clipHoldUntil = Date.distantPast

    private var shuffleQueue: [UUID] = []
    private var shuffleCursor = 0
    private var shuffleHistory: [UUID] = []

    private var positionTimer: Timer?
    private var interruptionObserver: NSObjectProtocol?
    private var routeObserver: NSObjectProtocol?
    private var wasInterruptedWhilePlaying = false

    private var settings = PersistedSettings.default
    private let clipThreshold: Float = 0.999

    init() {
        loadSettings()
        configureAudioSession()
        configureNodes()
        configureEQBands()
        rebuildIRPresetList()
        applySettingsToEngine()
        rebuildAudioGraph(preservePlayback: false)
        installObservers()
        startTicker()
    }

    deinit {
        positionTimer?.invalidate()
        if let interruptionObserver {
            NotificationCenter.default.removeObserver(interruptionObserver)
        }
        if let routeObserver {
            NotificationCenter.default.removeObserver(routeObserver)
        }
        currentPlaybackHandle?.release()
        removeMasterTap()
    }

    func attachLibraryStore(_ store: LibraryStore) {
        libraryStore = store
        libraryCancellable = store.$tracks
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                self?.sanitizeQueueState()
            }
    }

    // MARK: - Transport

    func playTrack(_ track: Track) {
        prepareTrack(track, autoplay: true, seekTime: 0, recordHistory: true)
    }

    func playPause() {
        isPlaying ? pause() : play()
    }

    func play() {
        if currentTrack == nil, let first = libraryStore?.tracks.first {
            prepareTrack(first, autoplay: true, seekTime: 0, recordHistory: false)
            return
        }

        guard currentFile != nil else { return }
        scheduleCurrentFile(from: pausedTime, autoplay: true)
    }

    func pause() {
        guard isPlaying else { return }
        let position = playbackPositionFromNode()
        pausedTime = position
        currentTime = position
        scheduleGeneration += 1
        playerNode.stop()
        isPlaying = false
    }

    func stop() {
        scheduleGeneration += 1
        playerNode.stop()
        isPlaying = false
        pausedTime = 0
        currentTime = 0
    }

    func nextTrack() {
        guard let target = nextTrackCandidate(autoAdvance: false) else {
            stop()
            return
        }
        prepareTrack(target, autoplay: true, seekTime: 0, recordHistory: true)
    }

    func previousTrack() {
        if currentTime > 3 {
            seek(to: 0)
            return
        }

        guard let currentTrack else { return }
        let tracks = orderedTracks()
        guard !tracks.isEmpty else { return }

        if shuffleEnabled {
            if let previousID = shuffleHistory.popLast(), let previous = track(with: previousID) {
                prepareTrack(previous, autoplay: true, seekTime: 0, recordHistory: false)
                return
            }
        }

        guard let index = tracks.firstIndex(where: { $0.id == currentTrack.id }) else {
            seek(to: 0)
            return
        }

        if index > 0 {
            prepareTrack(tracks[index - 1], autoplay: true, seekTime: 0, recordHistory: false)
            return
        }

        if repeatMode == .all, let last = tracks.last {
            prepareTrack(last, autoplay: true, seekTime: 0, recordHistory: false)
            return
        }

        seek(to: 0)
    }

    func seek(to seconds: Double) {
        let clamped = min(max(seconds, 0), duration)
        pausedTime = clamped
        currentTime = clamped

        guard isPlaying else { return }
        scheduleCurrentFile(from: clamped, autoplay: true)
    }

    // MARK: - Playback Modes

    func toggleShuffle() {
        shuffleEnabled.toggle()
        if shuffleEnabled {
            rebuildShuffleQueue(anchor: currentTrack?.id)
        } else {
            shuffleQueue.removeAll()
            shuffleCursor = 0
            shuffleHistory.removeAll()
        }
        persistSettings()
    }

    func cycleRepeatMode() {
        repeatMode.cycle()
        persistSettings()
    }

    // MARK: - Varispeed

    func setRate(_ value: Float) {
        let clamped = min(max(value, 0.5), 1.1)
        rate = clamped
        varispeedNode.rate = clamped
        persistSettings()
    }

    // MARK: - Reverb

    func setReverbEnabled(_ enabled: Bool) {
        reverbEnabled = enabled
        persistSettings()
        applyReverbSelection(preservePlayback: true)
    }

    func setIRPreset(id: String) {
        selectedIRPresetId = id
        persistSettings()
        applyReverbSelection(preservePlayback: true)
    }

    func nextIRPreset() {
        guard let index = irPresets.firstIndex(where: { $0.id == selectedIRPresetId }) else { return }
        let nextIndex = (index + 1) % irPresets.count
        setIRPreset(id: irPresets[nextIndex].id)
    }

    func setReverbWetPercent(_ percent: Double) {
        reverbWetPercent = min(max(percent, 0), 100)
        updateWetMixAndMasterGain()
        persistSettings()
    }

    func importCustomIR(from url: URL) {
        let didStart = url.startAccessingSecurityScopedResource()
        defer {
            if didStart {
                url.stopAccessingSecurityScopedResource()
            }
        }

        do {
            _ = try AVAudioFile(forReading: url)

            var bookmarkData: Data?
            do {
                bookmarkData = try url.bookmarkData(
                    options: [.withSecurityScope, .securityScopeAllowOnlyReadAccess],
                    includingResourceValuesForKeys: nil,
                    relativeTo: nil
                )
            } catch {
                bookmarkData = nil
            }

            var fallbackRelativePath: String?
            if bookmarkData == nil {
                fallbackRelativePath = try copyCustomIRToFallback(from: url)
            }

            let preset = IRPreset.custom(
                name: url.deletingPathExtension().lastPathComponent,
                bookmarkData: bookmarkData,
                fallbackRelativePath: fallbackRelativePath
            )

            settings.customIRPresets.append(preset)
            rebuildIRPresetList()
            selectedIRPresetId = preset.id
            reverbEnabled = true
            persistSettings()
            applyReverbSelection(preservePlayback: true)
        } catch {
            toastMessage = "IR import failed: \(error.localizedDescription)"
        }
    }

    // MARK: - EQ

    func setEQEnabled(_ enabled: Bool) {
        eqEnabled = enabled
        applyEQToNode()
        updateWetMixAndMasterGain()
        persistSettings()
    }

    func setEQBandGain(index: Int, gain: Float) {
        guard eqBandGains.indices.contains(index) else { return }
        let clamped = min(max(gain, -12), 12)
        eqBandGains[index] = clamped
        applyEQToNode()
        updateWetMixAndMasterGain()
        persistSettings()
    }

    func applyEQPreset(_ preset: EQPresetName) {
        eqPresetName = preset

        switch preset {
        case .flat:
            eqBandGains = [0, 0, 0, 0, 0]
        case .bassBoost:
            eqBandGains = [5, 3, 1, -1, -2]
        case .vocal:
            eqBandGains = [-2, 1, 3.5, 2.5, -1]
        case .trebleBoost:
            eqBandGains = [-2, -1, 0, 3, 5]
        }

        applyEQToNode()
        updateWetMixAndMasterGain()
        persistSettings()
    }

    // MARK: - Waveform

    func setWaveformEnabled(_ enabled: Bool) {
        waveformEnabled = enabled
        persistSettings()
    }

    func setWaveformMode(_ mode: WaveformMode) {
        waveformMode = mode
        persistSettings()
    }
    // MARK: - Setup

    private func loadSettings() {
        settings = SettingsStorage.load()

        settings.rate = min(max(settings.rate, 0.5), 1.1)
        settings.reverbWetPercent = min(max(settings.reverbWetPercent, 0), 100)
        settings.eqBandGains = normalizedEQGains(settings.eqBandGains)

        rate = settings.rate
        reverbEnabled = settings.reverbEnabled
        selectedIRPresetId = settings.reverbPresetId
        reverbWetPercent = settings.reverbWetPercent
        eqEnabled = settings.eqEnabled
        eqBandGains = settings.eqBandGains
        eqPresetName = settings.eqPresetName
        repeatMode = settings.repeatMode
        shuffleEnabled = settings.shuffleEnabled
        waveformEnabled = settings.waveformEnabled
        waveformMode = settings.waveformMode
    }

    private func normalizedEQGains(_ gains: [Float]) -> [Float] {
        if gains.count == 5 {
            return gains.map { min(max($0, -12), 12) }
        }

        var normalized = gains.prefix(5).map { min(max($0, -12), 12) }
        while normalized.count < 5 {
            normalized.append(0)
        }
        return normalized
    }

    private func applySettingsToEngine() {
        setRate(rate)
        applyEQToNode()
        updateWetMixAndMasterGain()
        applyReverbSelection(preservePlayback: false)
    }

    private func persistSettings() {
        settings.rate = rate
        settings.reverbEnabled = reverbEnabled
        settings.reverbPresetId = selectedIRPresetId
        settings.reverbWetPercent = reverbWetPercent
        settings.eqEnabled = eqEnabled
        settings.eqBandGains = eqBandGains
        settings.eqPresetName = eqPresetName
        settings.repeatMode = repeatMode
        settings.shuffleEnabled = shuffleEnabled
        settings.waveformEnabled = waveformEnabled
        settings.waveformMode = waveformMode
        SettingsStorage.save(settings)
    }

    private func rebuildIRPresetList() {
        irPresets = IRPreset.builtInPresets + settings.customIRPresets
        if !irPresets.contains(where: { $0.id == selectedIRPresetId }) {
            selectedIRPresetId = IRPreset.off.id
        }
    }

    private func configureAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [.allowAirPlay, .allowBluetoothA2DP])
            try session.setActive(true)
            contextSampleRate = session.sampleRate
        } catch {
            toastMessage = "Audio session error: \(error.localizedDescription)"
        }
    }

    private func configureNodes() {
        attachIfNeeded(playerNode)
        attachIfNeeded(varispeedNode)
        attachIfNeeded(eqNode)
        attachIfNeeded(dryGainNode)
        attachIfNeeded(wetGainNode)
        attachIfNeeded(masterGainNode)
    }

    private func configureEQBands() {
        let bands = eqNode.bands
        guard bands.count == 5 else { return }

        bands[0].filterType = .lowShelf
        bands[0].frequency = 100
        bands[0].bandwidth = 1.0

        bands[1].filterType = .parametric
        bands[1].frequency = 250
        bands[1].bandwidth = 1.0

        bands[2].filterType = .parametric
        bands[2].frequency = 1_000
        bands[2].bandwidth = 1.0

        bands[3].filterType = .parametric
        bands[3].frequency = 4_000
        bands[3].bandwidth = 1.0

        bands[4].filterType = .highShelf
        bands[4].frequency = 10_000
        bands[4].bandwidth = 1.0
    }

    private func applyEQToNode() {
        for index in 0..<min(eqNode.bands.count, eqBandGains.count) {
            eqNode.bands[index].gain = eqEnabled ? eqBandGains[index] : 0
            eqNode.bands[index].bypass = !eqEnabled
        }
        eqNode.bypass = !eqEnabled
    }

    private func attachIfNeeded(_ node: AVAudioNode) {
        if !engine.attachedNodes.contains(where: { $0 === node }) {
            engine.attach(node)
        }
    }

    private func rebuildAudioGraph(preservePlayback: Bool) {
        let resumePosition = preservePlayback ? playbackPositionFromNode() : pausedTime
        let shouldResume = preservePlayback && isPlaying

        scheduleGeneration += 1
        playerNode.stop()
        removeMasterTap()

        engine.pause()
        engine.disconnectNodeOutput(playerNode)
        engine.disconnectNodeOutput(varispeedNode)
        engine.disconnectNodeOutput(eqNode)
        engine.disconnectNodeOutput(dryGainNode)
        engine.disconnectNodeOutput(wetGainNode)
        engine.disconnectNodeOutput(masterGainNode)

        if let attachedConvolverNode {
            engine.disconnectNodeInput(attachedConvolverNode)
            engine.disconnectNodeOutput(attachedConvolverNode)
            if attachedConvolverNode !== activeConvolution?.avAudioNode {
                engine.detach(attachedConvolverNode)
            }
        }
        attachedConvolverNode = nil

        if let convolverNode = activeConvolution?.avAudioNode, shouldUseConvolver {
            attachIfNeeded(convolverNode)
            attachedConvolverNode = convolverNode
        }

        let format = currentFile?.processingFormat

        engine.connect(playerNode, to: varispeedNode, format: format)
        engine.connect(varispeedNode, to: eqNode, format: format)

        if let convolverNode = attachedConvolverNode {
            let splitTargets = [
                AVAudioConnectionPoint(node: dryGainNode, bus: 0),
                AVAudioConnectionPoint(node: convolverNode, bus: 0)
            ]
            engine.connect(eqNode, to: splitTargets, fromBus: 0, format: format)
            engine.connect(convolverNode, to: wetGainNode, format: format)
        } else {
            engine.connect(eqNode, to: dryGainNode, format: format)
        }

        engine.connect(dryGainNode, to: masterGainNode, format: format)
        engine.connect(wetGainNode, to: masterGainNode, format: format)
        engine.connect(masterGainNode, to: engine.mainMixerNode, format: format)

        do {
            if !engine.isRunning {
                try engine.start()
            }
            contextSampleRate = AVAudioSession.sharedInstance().sampleRate
        } catch {
            toastMessage = "Engine start failed: \(error.localizedDescription)"
        }

        updateWetMixAndMasterGain()
        installMasterTap()
        recomputeQualityState()

        if preservePlayback, currentFile != nil {
            scheduleCurrentFile(from: resumePosition, autoplay: shouldResume)
        }
    }

    private var shouldUseConvolver: Bool {
        reverbEnabled && selectedIRPresetId != IRPreset.off.id
    }

    private func applyReverbSelection(preservePlayback: Bool) {
        guard shouldUseConvolver else {
            currentIRSampleRate = nil
            activeConvolution = nil
            rebuildAudioGraph(preservePlayback: preservePlayback)
            recomputeQualityState()
            return
        }

        guard let preset = irPresets.first(where: { $0.id == selectedIRPresetId }) else {
            toastMessage = "IR preset not found."
            currentIRSampleRate = nil
            activeConvolution = nil
            rebuildAudioGraph(preservePlayback: preservePlayback)
            return
        }

        if let cached = convolverCache[preset.id] {
            activeConvolution = cached
            currentIRSampleRate = irSampleRateCache[preset.id]
            rebuildAudioGraph(preservePlayback: preservePlayback)
            recomputeQualityState()
            return
        }

        do {
            let resolved = try resolveIRURL(for: preset)
            guard let resolved else {
                activeConvolution = nil
                currentIRSampleRate = nil
                rebuildAudioGraph(preservePlayback: preservePlayback)
                recomputeQualityState()
                return
            }

            defer {
                resolved.stopAccess?()
            }

            let irFile = try AVAudioFile(forReading: resolved.url)
            let adapter = EngineNodeAdapter(eqNode)
            let convolution = Convolution(adapter, impulseResponseFileURL: resolved.url)

            convolverCache[preset.id] = convolution
            irSampleRateCache[preset.id] = irFile.processingFormat.sampleRate

            activeConvolution = convolution
            currentIRSampleRate = irFile.processingFormat.sampleRate

            rebuildAudioGraph(preservePlayback: preservePlayback)
            recomputeQualityState()
        } catch {
            toastMessage = "IR load failed: \(error.localizedDescription)"
            activeConvolution = nil
            currentIRSampleRate = nil
            rebuildAudioGraph(preservePlayback: preservePlayback)
            recomputeQualityState()
        }
    }

    private func updateWetMixAndMasterGain() {
        let wet = shouldUseConvolver ? AudioMath.wetInternal(fromPercent: reverbWetPercent) : 0
        let dry = max(0, 1 - wet)

        dryGainNode.outputVolume = dry
        wetGainNode.outputVolume = wet

        let maxBoost = eqEnabled ? max(0, eqBandGains.max() ?? 0) : 0
        var master = 0.9 - (Double(maxBoost) / 60.0) - (Double(wet) * 0.25)
        master = min(max(master, 0.5), 0.95)
        masterGainNode.outputVolume = Float(master)

        recomputeQualityState()
    }
    private func prepareTrack(_ track: Track, autoplay: Bool, seekTime: Double, recordHistory: Bool) {
        guard let libraryStore else {
            toastMessage = "Library not attached."
            return
        }

        do {
            let handle = try libraryStore.playbackHandle(for: track)
            let file = try AVAudioFile(forReading: handle.url)

            if recordHistory, shuffleEnabled, let existing = currentTrack?.id, existing != track.id {
                if shuffleHistory.last != existing {
                    shuffleHistory.append(existing)
                }
            }

            currentPlaybackHandle?.release()
            currentPlaybackHandle = handle
            currentFile = file
            currentTrack = track

            duration = Double(file.length) / file.processingFormat.sampleRate
            currentTrackSampleRate = file.processingFormat.sampleRate

            let safeStart = min(max(seekTime, 0), duration)
            pausedTime = safeStart
            currentTime = safeStart

            if shuffleEnabled {
                if shuffleQueue.isEmpty || !shuffleQueue.contains(track.id) {
                    rebuildShuffleQueue(anchor: track.id)
                } else {
                    shuffleCursor = max(0, shuffleQueue.firstIndex(of: track.id) ?? 0)
                }
            }

            recomputeQualityState()
            rebuildAudioGraph(preservePlayback: false)
            scheduleCurrentFile(from: safeStart, autoplay: autoplay)
        } catch {
            toastMessage = "Playback load failed: \(error.localizedDescription)"
            currentPlaybackHandle?.release()
            currentPlaybackHandle = nil
            currentFile = nil
            currentTrack = nil
            duration = 0
            currentTime = 0
            pausedTime = 0
            currentTrackSampleRate = nil
            recomputeQualityState()
        }
    }

    private func scheduleCurrentFile(from seconds: Double, autoplay: Bool) {
        guard let file = currentFile else { return }
        let clamped = min(max(seconds, 0), duration)
        let sampleRate = file.processingFormat.sampleRate
        let startFrame = AVAudioFramePosition(clamped * sampleRate)

        guard startFrame < file.length else {
            currentTime = duration
            pausedTime = duration
            isPlaying = false
            return
        }

        let remaining = file.length - startFrame
        let frameCount = AVAudioFrameCount(remaining)

        scheduleGeneration += 1
        let generation = scheduleGeneration

        playerNode.stop()
        playerNode.scheduleSegment(file, startingFrame: startFrame, frameCount: frameCount, at: nil) { [weak self] in
            DispatchQueue.main.async {
                self?.handleSegmentCompletion(for: generation)
            }
        }

        scheduledStartTime = clamped
        pausedTime = clamped
        currentTime = clamped

        if autoplay {
            do {
                if !engine.isRunning {
                    try engine.start()
                }
                playerNode.play()
                isPlaying = true
            } catch {
                toastMessage = "Engine resume failed: \(error.localizedDescription)"
                isPlaying = false
            }
        } else {
            isPlaying = false
        }
    }

    private func handleSegmentCompletion(for generation: Int) {
        guard generation == scheduleGeneration else { return }

        isPlaying = false
        pausedTime = duration
        currentTime = duration

        if repeatMode == .one {
            scheduleCurrentFile(from: 0, autoplay: true)
            return
        }

        guard let next = nextTrackCandidate(autoAdvance: true) else {
            return
        }
        prepareTrack(next, autoplay: true, seekTime: 0, recordHistory: true)
    }

    private func nextTrackCandidate(autoAdvance: Bool) -> Track? {
        let tracks = orderedTracks()
        guard !tracks.isEmpty else { return nil }

        if let currentTrack {
            if shuffleEnabled {
                guard let nextID = shuffledNextID() else { return nil }
                return track(with: nextID)
            }

            guard let index = tracks.firstIndex(where: { $0.id == currentTrack.id }) else {
                return tracks.first
            }

            let nextIndex = index + 1
            if nextIndex < tracks.count {
                return tracks[nextIndex]
            }

            if repeatMode == .all {
                return tracks.first
            }

            if autoAdvance {
                return nil
            }
            return tracks.first
        }

        return tracks.first
    }

    private func shuffledNextID() -> UUID? {
        let ids = orderedTracks().map(\.id)
        guard !ids.isEmpty else { return nil }

        if shuffleQueue.count != ids.count || Set(shuffleQueue) != Set(ids) {
            rebuildShuffleQueue(anchor: currentTrack?.id)
        }

        if shuffleCursor + 1 < shuffleQueue.count {
            shuffleCursor += 1
            return shuffleQueue[shuffleCursor]
        }

        if repeatMode == .all {
            rebuildShuffleQueue(anchor: currentTrack?.id)
            if shuffleQueue.count > 1 {
                shuffleCursor = 1
                return shuffleQueue[shuffleCursor]
            }
            return shuffleQueue.first
        }

        return nil
    }

    private func rebuildShuffleQueue(anchor: UUID?) {
        var ids = orderedTracks().map(\.id)
        guard !ids.isEmpty else {
            shuffleQueue.removeAll()
            shuffleCursor = 0
            shuffleHistory.removeAll()
            return
        }

        if let anchor, let idx = ids.firstIndex(of: anchor) {
            ids.remove(at: idx)
            ids.shuffle()
            shuffleQueue = [anchor] + ids
            shuffleCursor = 0
        } else {
            ids.shuffle()
            shuffleQueue = ids
            shuffleCursor = 0
        }
    }

    private func orderedTracks() -> [Track] {
        libraryStore?.tracks ?? []
    }

    private func track(with id: UUID) -> Track? {
        orderedTracks().first(where: { $0.id == id })
    }

    private func sanitizeQueueState() {
        let validIDs = Set(orderedTracks().map(\.id))
        shuffleQueue.removeAll(where: { !validIDs.contains($0) })
        shuffleHistory.removeAll(where: { !validIDs.contains($0) })

        if let currentTrack, !validIDs.contains(currentTrack.id) {
            stop()
            self.currentTrack = nil
            currentFile = nil
            currentPlaybackHandle?.release()
            currentPlaybackHandle = nil
            duration = 0
            currentTime = 0
            pausedTime = 0
            currentTrackSampleRate = nil
            recomputeQualityState()
        }
    }

    // MARK: - Metering / Waveform

    private func installMasterTap() {
        removeMasterTap()
        guard engine.isRunning else { return }
        let format = masterGainNode.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { return }

        masterGainNode.installTap(onBus: 0, bufferSize: 2_048, format: format) { [weak self] buffer, _ in
            guard let self else { return }
            guard let channels = buffer.floatChannelData else { return }
            let frameCount = Int(buffer.frameLength)
            guard frameCount > 0 else { return }

            let channelCount = Int(buffer.format.channelCount)
            let left = channels[0]
            let right = channelCount > 1 ? channels[1] : channels[0]

            var peak: Float = 0
            for i in 0..<frameCount {
                peak = max(peak, abs(left[i]))
                peak = max(peak, abs(right[i]))
            }

            let pointCount = 256
            let stride = max(1, frameCount / pointCount)
            var leftSamples = Array(repeating: Float(0), count: pointCount)
            var rightSamples = Array(repeating: Float(0), count: pointCount)

            var writeIndex = 0
            var readIndex = 0
            while writeIndex < pointCount && readIndex < frameCount {
                leftSamples[writeIndex] = left[readIndex]
                rightSamples[writeIndex] = right[readIndex]
                writeIndex += 1
                readIndex += stride
            }

            DispatchQueue.main.async {
                let now = Date()
                if peak >= self.clipThreshold {
                    self.clipHoldUntil = now.addingTimeInterval(1.0)
                }
                self.clipWarning = now < self.clipHoldUntil

                if self.waveformEnabled {
                    self.waveformFrame = WaveformFrame(left: leftSamples, right: rightSamples, isMono: channelCount < 2)
                }
            }
        }
    }

    private func removeMasterTap() {
        masterGainNode.removeTap(onBus: 0)
    }

    private func startTicker() {
        positionTimer?.invalidate()
        positionTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            self?.tick()
        }
    }

    private func tick() {
        if isPlaying {
            currentTime = playbackPositionFromNode()
            if currentTime >= duration {
                currentTime = duration
            }
        } else {
            currentTime = pausedTime
        }

        if Date() >= clipHoldUntil {
            clipWarning = false
        }
    }

    private func playbackPositionFromNode() -> Double {
        guard isPlaying else { return pausedTime }
        guard
            let nodeTime = playerNode.lastRenderTime,
            let playerTime = playerNode.playerTime(forNodeTime: nodeTime)
        else {
            return pausedTime
        }

        let elapsed = Double(playerTime.sampleTime) / playerTime.sampleRate
        let position = scheduledStartTime + elapsed
        return min(max(0, position), duration)
    }
    // MARK: - Quality

    private func recomputeQualityState() {
        var state = QualityState()
        state.contextHz = contextSampleRate
        state.trackHz = currentTrackSampleRate
        state.irHz = currentIRSampleRate

        guard let contextHz = contextSampleRate, let trackHz = currentTrackSampleRate else {
            state.status = .checking
            qualityState = state
            return
        }

        let trackMismatch = abs(trackHz - contextHz) > 0.5
        state.trackResampled = trackMismatch

        if shouldUseConvolver {
            guard let irHz = currentIRSampleRate else {
                state.status = .checking
                qualityState = state
                return
            }

            let irMismatch = abs(irHz - contextHz) > 0.5
            state.irResampled = irMismatch
            state.status = (trackMismatch || irMismatch) ? .resampled : .fullRateMatch
        } else {
            state.irResampled = false
            state.status = trackMismatch ? .resampled : .fullRateMatch
        }

        qualityState = state
    }

    // MARK: - Notifications

    private func installObservers() {
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let self else { return }
            self.handleInterruption(note)
        }

        routeObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            self.contextSampleRate = AVAudioSession.sharedInstance().sampleRate
            self.recomputeQualityState()
        }
    }

    private func handleInterruption(_ note: Notification) {
        guard
            let userInfo = note.userInfo,
            let rawType = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: rawType)
        else {
            return
        }

        switch type {
        case .began:
            if isPlaying {
                wasInterruptedWhilePlaying = true
                pause()
            }
        case .ended:
            let optionsRaw = userInfo[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            let options = AVAudioSession.InterruptionOptions(rawValue: optionsRaw)
            if options.contains(.shouldResume), wasInterruptedWhilePlaying {
                wasInterruptedWhilePlaying = false
                play()
            } else {
                wasInterruptedWhilePlaying = false
            }
        @unknown default:
            break
        }
    }

    // MARK: - IR Resolution

    private func resolveIRURL(for preset: IRPreset) throws -> ResolvedIRURL? {
        if preset.id == IRPreset.off.id {
            return nil
        }

        switch preset.source {
        case .bundled:
            guard let filename = preset.bundledFilename else {
                throw NSError(domain: "AudioEngineManager", code: 700, userInfo: [NSLocalizedDescriptionKey: "Bundled IR filename is missing."])
            }

            let filenameURL = URL(fileURLWithPath: filename)
            let base = filenameURL.deletingPathExtension().lastPathComponent
            let ext = filenameURL.pathExtension.isEmpty ? "wav" : filenameURL.pathExtension

            if let url = Bundle.main.url(forResource: base, withExtension: ext, subdirectory: "IRs") {
                return ResolvedIRURL(url: url, stopAccess: nil)
            }
            if let url = Bundle.main.url(forResource: base, withExtension: ext) {
                return ResolvedIRURL(url: url, stopAccess: nil)
            }
            throw NSError(domain: "AudioEngineManager", code: 701, userInfo: [NSLocalizedDescriptionKey: "Bundled IR \(filename) not found."])

        case .custom:
            if let data = preset.bookmarkData {
                var stale = false
                let resolvedURL = try URL(
                    resolvingBookmarkData: data,
                    options: [.withSecurityScope, .withoutUI],
                    relativeTo: nil,
                    bookmarkDataIsStale: &stale
                )
                let didStart = resolvedURL.startAccessingSecurityScopedResource()
                if didStart {
                    if stale {
                        refreshCustomIRBookmark(presetID: preset.id, resolvedURL: resolvedURL)
                    }
                    return ResolvedIRURL(url: resolvedURL) {
                        resolvedURL.stopAccessingSecurityScopedResource()
                    }
                }
            }

            if let fallback = preset.fallbackRelativePath {
                let fallbackURL = customIRFallbackRoot().appendingPathComponent(fallback, isDirectory: false)
                if FileManager.default.fileExists(atPath: fallbackURL.path) {
                    return ResolvedIRURL(url: fallbackURL, stopAccess: nil)
                }
            }

            throw NSError(domain: "AudioEngineManager", code: 702, userInfo: [NSLocalizedDescriptionKey: "Custom IR file is unavailable."])
        }
    }

    private func copyCustomIRToFallback(from url: URL) throws -> String {
        let root = customIRFallbackRoot()
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: nil)

        let ext = url.pathExtension
        let name = ext.isEmpty ? UUID().uuidString : "\(UUID().uuidString).\(ext)"
        let destination = root.appendingPathComponent(name, isDirectory: false)

        if FileManager.default.fileExists(atPath: destination.path) {
            try FileManager.default.removeItem(at: destination)
        }
        try FileManager.default.copyItem(at: url, to: destination)
        return name
    }

    private func customIRFallbackRoot() -> URL {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        return documents.appendingPathComponent("ImportedIRs", isDirectory: true)
    }

    private func refreshCustomIRBookmark(presetID: String, resolvedURL: URL) {
        guard let index = settings.customIRPresets.firstIndex(where: { $0.id == presetID }) else { return }
        guard settings.customIRPresets[index].bookmarkData != nil else { return }

        do {
            let refreshed = try resolvedURL.bookmarkData(
                options: [.withSecurityScope, .securityScopeAllowOnlyReadAccess],
                includingResourceValuesForKeys: nil,
                relativeTo: nil
            )
            settings.customIRPresets[index].bookmarkData = refreshed
            rebuildIRPresetList()
            persistSettings()
        } catch {
            // Best effort refresh. Keep existing bookmark or fallback behavior.
        }
    }
}
