import SwiftUI
import UniformTypeIdentifiers

struct LibraryView: View {
    @ObservedObject var libraryStore: LibraryStore
    @ObservedObject var audioManager: AudioEngineManager

    @State private var showingImporter = false
    @State private var showingError = false

    private var supportedAudioTypes: [UTType] {
        [
            .audio,
            UTType(filenameExtension: "wav") ?? .audio,
            UTType(filenameExtension: "mp3") ?? .audio,
            UTType(filenameExtension: "flac") ?? .audio
        ]
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Tracks: \(libraryStore.tracks.count)")
                            .font(.headline)
                        Text("Storage Used: \(AppFormatters.bytes(libraryStore.storageUsedBytes))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button {
                        showingImporter = true
                    } label: {
                        Label("Import", systemImage: "square.and.arrow.down")
                            .fontWeight(.semibold)
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityLabel("Import audio files")
                }
                .padding(.horizontal)

                if libraryStore.tracks.isEmpty {
                    ContentUnavailableView(
                        "No Music Yet",
                        systemImage: "waveform",
                        description: Text("Import WAV, FLAC, or MP3 files from the Files app.")
                    )
                } else {
                    List {
                        ForEach(libraryStore.tracks) { track in
                            Button {
                                audioManager.playTrack(track)
                            } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: "music.note")
                                        .foregroundStyle(.mint)

                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(track.displayName)
                                            .font(.body)
                                            .lineLimit(1)
                                        Text(AppFormatters.time(track.durationSeconds))
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }

                                    Spacer()

                                    if audioManager.currentTrack?.id == track.id {
                                        Image(systemName: audioManager.isPlaying ? "speaker.wave.2.fill" : "pause.circle")
                                            .foregroundStyle(.yellow)
                                    }
                                }
                            }
                            .buttonStyle(.plain)
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button(role: .destructive) {
                                    libraryStore.deleteTrack(track)
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Library")
            .fileImporter(
                isPresented: $showingImporter,
                allowedContentTypes: supportedAudioTypes,
                allowsMultipleSelection: true
            ) { result in
                switch result {
                case .success(let urls):
                    libraryStore.importFiles(from: urls)
                    showingError = libraryStore.lastError != nil
                case .failure(let error):
                    libraryStore.lastError = "Import canceled: \(error.localizedDescription)"
                    showingError = true
                }
            }
            .onChange(of: libraryStore.lastError) { _, newValue in
                showingError = newValue != nil
            }
            .alert("Library Error", isPresented: $showingError, presenting: libraryStore.lastError) { _ in
                Button("OK") {
                    libraryStore.lastError = nil
                }
            } message: { message in
                Text(message)
            }
        }
    }
}
