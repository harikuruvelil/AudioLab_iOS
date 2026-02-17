import AVFoundation
import Foundation
import SwiftData

struct PlaybackURLHandle {
    let url: URL
    let stopAccess: (() -> Void)?

    func release() {
        stopAccess?()
    }
}

final class LibraryStore: ObservableObject {
    @Published private(set) var tracks: [Track] = []
    @Published private(set) var storageUsedBytes: Int64 = 0
    @Published var lastError: String?

    private let modelContext: ModelContext
    private let fileManager = FileManager.default

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
        reload()
    }

    func reload() {
        do {
            var descriptor = FetchDescriptor<Track>(
                sortBy: [SortDescriptor(\Track.addedAt, order: .forward)]
            )
            descriptor.fetchLimit = 10_000
            tracks = try modelContext.fetch(descriptor)
            storageUsedBytes = tracks.reduce(0) { $0 + $1.fileSizeBytes }
        } catch {
            lastError = "Failed to load library: \(error.localizedDescription)"
        }
    }

    func importFiles(from urls: [URL]) {
        guard !urls.isEmpty else { return }

        for url in urls {
            do {
                let track = try makeTrack(from: url)
                modelContext.insert(track)
            } catch {
                lastError = "Import failed for \(url.lastPathComponent): \(error.localizedDescription)"
            }
        }

        do {
            try modelContext.save()
        } catch {
            lastError = "Could not save imported tracks: \(error.localizedDescription)"
        }

        reload()
    }

    func deleteTrack(_ track: Track) {
        if let fallback = track.fallbackRelativePath {
            let fallbackURL = fallbackRootDirectory().appendingPathComponent(fallback, isDirectory: false)
            try? fileManager.removeItem(at: fallbackURL)
        }

        modelContext.delete(track)

        do {
            try modelContext.save()
        } catch {
            lastError = "Could not delete track: \(error.localizedDescription)"
        }

        reload()
    }

    func playbackHandle(for track: Track) throws -> PlaybackURLHandle {
        if let bookmarkData = track.bookmarkData {
            var stale = false
            let resolvedURL = try URL(
                resolvingBookmarkData: bookmarkData,
                options: [.withSecurityScope, .withoutUI],
                relativeTo: nil,
                bookmarkDataIsStale: &stale
            )

            if stale {
                try refreshBookmark(for: track, resolvedURL: resolvedURL)
            }

            let didStart = resolvedURL.startAccessingSecurityScopedResource()
            if didStart {
                return PlaybackURLHandle(url: resolvedURL) {
                    resolvedURL.stopAccessingSecurityScopedResource()
                }
            }
        }

        if let fallback = track.fallbackRelativePath {
            let fallbackURL = fallbackRootDirectory().appendingPathComponent(fallback, isDirectory: false)
            guard fileManager.fileExists(atPath: fallbackURL.path) else {
                throw NSError(domain: "LibraryStore", code: 404, userInfo: [NSLocalizedDescriptionKey: "Fallback file missing on disk."])
            }
            return PlaybackURLHandle(url: fallbackURL, stopAccess: nil)
        }

        throw NSError(domain: "LibraryStore", code: 401, userInfo: [NSLocalizedDescriptionKey: "No readable file location for this track."])
    }

    private func makeTrack(from url: URL) throws -> Track {
        let didStart = url.startAccessingSecurityScopedResource()
        defer {
            if didStart {
                url.stopAccessingSecurityScopedResource()
            }
        }

        let audioFile = try AVAudioFile(forReading: url)
        let duration = Double(audioFile.length) / audioFile.processingFormat.sampleRate

        let resourceValues = try? url.resourceValues(forKeys: [.fileSizeKey, .nameKey])
        let fileSize = Int64(resourceValues?.fileSize ?? 0)
        let displayName = (resourceValues?.name ?? url.deletingPathExtension().lastPathComponent)

        var bookmarkData: Data?
        do {
            bookmarkData = try url.bookmarkData(
                options: [.withSecurityScope, .securityScopeAllowOnlyReadAccess],
                includingResourceValuesForKeys: nil,
                relativeTo: nil
            )

            if let bookmarkData {
                var stale = false
                _ = try URL(
                    resolvingBookmarkData: bookmarkData,
                    options: [.withSecurityScope, .withoutUI],
                    relativeTo: nil,
                    bookmarkDataIsStale: &stale
                )
            }
        } catch {
            bookmarkData = nil
        }

        var fallbackRelativePath: String?
        if bookmarkData == nil {
            fallbackRelativePath = try copyToFallback(from: url)
        }

        return Track(
            displayName: displayName,
            originalFilename: url.lastPathComponent,
            durationSeconds: duration,
            fileSizeBytes: fileSize,
            bookmarkData: bookmarkData,
            fallbackRelativePath: fallbackRelativePath
        )
    }

    private func refreshBookmark(for track: Track, resolvedURL: URL) throws {
        let didStart = resolvedURL.startAccessingSecurityScopedResource()
        defer {
            if didStart {
                resolvedURL.stopAccessingSecurityScopedResource()
            }
        }

        let freshBookmark = try resolvedURL.bookmarkData(
            options: [.withSecurityScope, .securityScopeAllowOnlyReadAccess],
            includingResourceValuesForKeys: nil,
            relativeTo: nil
        )

        track.bookmarkData = freshBookmark
        try modelContext.save()
    }

    private func copyToFallback(from url: URL) throws -> String {
        let folder = fallbackRootDirectory()
        try fileManager.createDirectory(at: folder, withIntermediateDirectories: true, attributes: nil)

        let ext = url.pathExtension
        let filename = ext.isEmpty ? UUID().uuidString : "\(UUID().uuidString).\(ext)"
        let destination = folder.appendingPathComponent(filename, isDirectory: false)

        if fileManager.fileExists(atPath: destination.path) {
            try fileManager.removeItem(at: destination)
        }
        try fileManager.copyItem(at: url, to: destination)

        return filename
    }

    private func fallbackRootDirectory() -> URL {
        let documents = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first!
        return documents.appendingPathComponent("ImportedTracks", isDirectory: true)
    }
}
