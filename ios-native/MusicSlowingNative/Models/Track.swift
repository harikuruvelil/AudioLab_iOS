import Foundation
import SwiftData

@Model
final class Track {
    @Attribute(.unique) var id: UUID
    var displayName: String
    var originalFilename: String
    var addedAt: Date
    var durationSeconds: Double
    var fileSizeBytes: Int64

    // Preferred persistence path for Files-provider assets.
    var bookmarkData: Data?

    // Fallback persistence when bookmark providers fail.
    // Stored as relative file name under Documents/ImportedTracks.
    var fallbackRelativePath: String?

    init(
        id: UUID = UUID(),
        displayName: String,
        originalFilename: String,
        addedAt: Date = Date(),
        durationSeconds: Double,
        fileSizeBytes: Int64,
        bookmarkData: Data? = nil,
        fallbackRelativePath: String? = nil
    ) {
        self.id = id
        self.displayName = displayName
        self.originalFilename = originalFilename
        self.addedAt = addedAt
        self.durationSeconds = durationSeconds
        self.fileSizeBytes = fileSizeBytes
        self.bookmarkData = bookmarkData
        self.fallbackRelativePath = fallbackRelativePath
    }
}