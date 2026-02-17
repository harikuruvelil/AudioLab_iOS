import Foundation

struct IRPreset: Identifiable, Hashable, Codable {
    enum Source: String, Codable {
        case bundled
        case custom
    }

    let id: String
    var name: String
    var source: Source

    // Bundled preset filename under Resources/IRs.
    var bundledFilename: String?

    // Optional bookmark/fallback for custom IR imports.
    var bookmarkData: Data?
    var fallbackRelativePath: String?

    static let off = IRPreset(
        id: "off",
        name: "Off",
        source: .bundled,
        bundledFilename: nil,
        bookmarkData: nil,
        fallbackRelativePath: nil
    )

    static let builtInPresets: [IRPreset] = [
        .off,
        IRPreset(id: "air_museum_1", name: "Air Museum 1", source: .bundled, bundledFilename: "air_museum_1.wav"),
        IRPreset(id: "air_museum_2", name: "Air Museum 2", source: .bundled, bundledFilename: "air_museum_2.wav"),
        IRPreset(id: "auditorium", name: "Auditorium", source: .bundled, bundledFilename: "auditorium.wav"),
        IRPreset(id: "drum_room_1", name: "Drum Room 1", source: .bundled, bundledFilename: "drum_room_1.wav"),
        IRPreset(id: "drum_room_2", name: "Drum Room 2", source: .bundled, bundledFilename: "drum_room_2.wav"),
        IRPreset(id: "stairwell", name: "Stairwell", source: .bundled, bundledFilename: "stairwell.wav"),
        IRPreset(id: "theatre_1", name: "Theatre 1", source: .bundled, bundledFilename: "theatre_1.wav"),
        IRPreset(id: "theatre_2", name: "Theatre 2", source: .bundled, bundledFilename: "theatre_2.wav"),
        IRPreset(id: "university_hall_center_rows", name: "University Hall (Center Rows)", source: .bundled, bundledFilename: "university_hall_center_rows.wav"),
        IRPreset(id: "university_hall_front_row", name: "University Hall (Front Row)", source: .bundled, bundledFilename: "university_hall_front_row.wav"),
        IRPreset(id: "university_hall_stalls", name: "University Hall (Stalls)", source: .bundled, bundledFilename: "university_hall_stalls.wav")
    ]

    static func custom(name: String, bookmarkData: Data?, fallbackRelativePath: String?) -> IRPreset {
        IRPreset(
            id: "custom-\(UUID().uuidString)",
            name: name,
            source: .custom,
            bundledFilename: nil,
            bookmarkData: bookmarkData,
            fallbackRelativePath: fallbackRelativePath
        )
    }

    init(
        id: String,
        name: String,
        source: Source,
        bundledFilename: String? = nil,
        bookmarkData: Data? = nil,
        fallbackRelativePath: String? = nil
    ) {
        self.id = id
        self.name = name
        self.source = source
        self.bundledFilename = bundledFilename
        self.bookmarkData = bookmarkData
        self.fallbackRelativePath = fallbackRelativePath
    }
}