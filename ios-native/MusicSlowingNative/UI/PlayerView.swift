import SwiftUI

struct PlayerView: View {
    @ObservedObject var libraryStore: LibraryStore
    @ObservedObject var audioManager: AudioEngineManager

    @State private var showingSettings = false
    @State private var isScrubbing = false
    @State private var scrubValue: Double = 0

    private var displayedTime: Double {
        isScrubbing ? scrubValue : audioManager.currentTime
    }

    private var semitones: Double {
        AudioMath.semitoneShift(for: audioManager.rate)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                header

                WaveformView(
                    frame: audioManager.waveformFrame,
                    mode: audioManager.waveformMode,
                    enabled: audioManager.waveformEnabled,
                    isPlaying: audioManager.isPlaying
                )
                .frame(height: 120)
                .padding(.horizontal)

                seekSection
                transportSection
                speedSection

                Spacer(minLength: 0)
            }
            .padding(.top, 8)
            .padding(.bottom, 12)
            .background(Color.black.ignoresSafeArea())
            .navigationTitle("Now Playing")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showingSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel("Open settings")
                }
            }
            .sheet(isPresented: $showingSettings) {
                SettingsSheet(audioManager: audioManager)
            }
            .alert("Audio", isPresented: Binding(get: {
                audioManager.toastMessage != nil
            }, set: { newValue in
                if !newValue {
                    audioManager.toastMessage = nil
                }
            }), presenting: audioManager.toastMessage) { _ in
                Button("OK", role: .cancel) {
                    audioManager.toastMessage = nil
                }
            } message: { message in
                Text(message)
            }
        }
    }

    private var header: some View {
        VStack(spacing: 8) {
            Text(audioManager.currentTrack?.displayName ?? "No Track Selected")
                .font(.title3.weight(.semibold))
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            HStack(spacing: 8) {
                qualityChip
                if audioManager.clipWarning {
                    Label("CLIP", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption.weight(.bold))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Color.red.opacity(0.9), in: Capsule())
                        .foregroundStyle(.white)
                }
            }

            if audioManager.qualityState.status == .resampled {
                VStack(spacing: 2) {
                    if audioManager.qualityState.trackResampled,
                       let from = audioManager.qualityState.trackHz,
                       let to = audioManager.qualityState.contextHz {
                        Text("Track: \(AppFormatters.hz(from)) -> \(AppFormatters.hz(to)) Hz")
                            .font(.caption2)
                            .foregroundStyle(.yellow)
                    }
                    if audioManager.qualityState.irResampled,
                       let from = audioManager.qualityState.irHz,
                       let to = audioManager.qualityState.contextHz {
                        Text("IR: \(AppFormatters.hz(from)) -> \(AppFormatters.hz(to)) Hz")
                            .font(.caption2)
                            .foregroundStyle(.yellow)
                    }
                }
            }
        }
    }

    private var qualityChip: some View {
        let status = audioManager.qualityState.status
        return Group {
            switch status {
            case .checking:
                Text("CHECKING...")
                    .chipStyle(background: Color.gray.opacity(0.5))
            case .fullRateMatch:
                Text("FULL RATE MATCH")
                    .chipStyle(background: Color.green.opacity(0.85))
            case .resampled:
                Text("RESAMPLED")
                    .chipStyle(background: Color.yellow.opacity(0.9), foreground: .black)
            }
        }
    }

    private var seekSection: some View {
        VStack(spacing: 6) {
            Slider(
                value: Binding(
                    get: { isScrubbing ? scrubValue : audioManager.currentTime },
                    set: { newValue in
                        if isScrubbing {
                            scrubValue = newValue
                        }
                    }
                ),
                in: 0...max(audioManager.duration, 0.01),
                onEditingChanged: { editing in
                    if editing {
                        isScrubbing = true
                        scrubValue = audioManager.currentTime
                    } else {
                        isScrubbing = false
                        audioManager.seek(to: scrubValue)
                    }
                }
            )
            .padding(.horizontal)

            HStack {
                Text(AppFormatters.time(displayedTime))
                Spacer()
                Text(AppFormatters.time(audioManager.duration))
            }
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
            .padding(.horizontal)
        }
    }

    private var transportSection: some View {
        HStack(spacing: 18) {
            Button {
                audioManager.toggleShuffle()
            } label: {
                Image(systemName: "shuffle")
                    .font(.title3)
                    .foregroundStyle(audioManager.shuffleEnabled ? .mint : .secondary)
            }
            .accessibilityLabel("Shuffle")

            Button {
                audioManager.previousTrack()
            } label: {
                Image(systemName: "backward.end.fill")
                    .font(.title2)
            }
            .buttonStyle(TransportIconButtonStyle(size: 52))
            .disabled(libraryStore.tracks.isEmpty)
            .accessibilityLabel("Previous")

            Button {
                audioManager.playPause()
            } label: {
                Image(systemName: audioManager.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 28, weight: .bold))
            }
            .buttonStyle(TransportPlayButtonStyle())
            .disabled(libraryStore.tracks.isEmpty)
            .accessibilityLabel(audioManager.isPlaying ? "Pause" : "Play")

            Button {
                audioManager.nextTrack()
            } label: {
                Image(systemName: "forward.end.fill")
                    .font(.title2)
            }
            .buttonStyle(TransportIconButtonStyle(size: 52))
            .disabled(libraryStore.tracks.isEmpty)
            .accessibilityLabel("Next")

            Button {
                audioManager.cycleRepeatMode()
            } label: {
                Image(systemName: repeatSymbol)
                    .font(.title3)
                    .foregroundStyle(audioManager.repeatMode == .off ? .secondary : .mint)
            }
            .accessibilityLabel(audioManager.repeatMode.label)
        }
    }

    private var repeatSymbol: String {
        switch audioManager.repeatMode {
        case .off: return "repeat"
        case .one: return "repeat.1"
        case .all: return "repeat"
        }
    }

    private var speedSection: some View {
        VStack(spacing: 8) {
            Text(String(format: "Speed: %.2fx", audioManager.rate))
                .font(.headline.monospacedDigit())

            Slider(
                value: Binding(
                    get: { Double(audioManager.rate) },
                    set: { audioManager.setRate(Float($0)) }
                ),
                in: 0.5...1.1,
                step: 0.01
            )
            .padding(.horizontal)

            Text(String(format: "Pitch Shift: %+0.2f st", semitones))
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(.secondary)
        }
    }
}

private struct TransportPlayButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(width: 72, height: 72)
            .foregroundStyle(.white)
            .background(
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [Color.cyan.opacity(0.9), Color.blue.opacity(0.9)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
            )
            .overlay(
                Circle()
                    .stroke(Color.white.opacity(0.25), lineWidth: 1)
            )
            .shadow(color: .cyan.opacity(0.35), radius: 14, x: 0, y: 6)
            .scaleEffect(configuration.isPressed ? 0.95 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

private struct TransportIconButtonStyle: ButtonStyle {
    let size: CGFloat

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(width: size, height: size)
            .background(Circle().fill(Color.white.opacity(0.08)))
            .overlay(Circle().stroke(Color.white.opacity(0.16), lineWidth: 1))
            .foregroundStyle(.primary)
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

private extension Text {
    func chipStyle(background: Color, foreground: Color = .white) -> some View {
        self
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(background, in: Capsule())
            .foregroundStyle(foreground)
    }
}
