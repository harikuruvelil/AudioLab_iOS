import Foundation

enum RepeatMode: String, Codable, CaseIterable {
    case off
    case one
    case all

    mutating func cycle() {
        switch self {
        case .off: self = .one
        case .one: self = .all
        case .all: self = .off
        }
    }

    var label: String {
        switch self {
        case .off: return "Repeat Off"
        case .one: return "Repeat One"
        case .all: return "Repeat All"
        }
    }
}

enum WaveformMode: String, Codable, CaseIterable {
    case linear
    case circular
    case vectorscope

    var label: String {
        rawValue.capitalized
    }
}

enum EQPresetName: String, Codable, CaseIterable {
    case flat = "Flat"
    case bassBoost = "Bass Boost"
    case vocal = "Vocal"
    case trebleBoost = "Treble Boost"
}

struct PersistedSettings: Codable {
    var rate: Float = 1.0

    var reverbEnabled: Bool = false
    var reverbPresetId: String = IRPreset.off.id

    // UI percent (0...100). Audio engine maps this to internal 0...0.60.
    var reverbWetPercent: Double = 0

    var eqEnabled: Bool = false
    var eqBandGains: [Float] = [0, 0, 0, 0, 0]
    var eqPresetName: EQPresetName = .flat

    var repeatMode: RepeatMode = .off
    var shuffleEnabled: Bool = false

    var waveformEnabled: Bool = true
    var waveformMode: WaveformMode = .linear

    // User-imported IRs persisted as bookmark/copy metadata.
    var customIRPresets: [IRPreset] = []

    static let `default` = PersistedSettings()
}

enum SettingsStorage {
    static let key = "MusicSlowingNative.PersistedSettings"

    static func load() -> PersistedSettings {
        guard
            let data = UserDefaults.standard.data(forKey: key),
            let decoded = try? JSONDecoder().decode(PersistedSettings.self, from: data)
        else {
            return .default
        }
        return decoded
    }

    static func save(_ settings: PersistedSettings) {
        guard let data = try? JSONEncoder().encode(settings) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }
}

struct QualityState {
    enum Status: Equatable {
        case checking
        case fullRateMatch
        case resampled
    }

    var status: Status = .checking
    var contextHz: Double?
    var trackHz: Double?
    var irHz: Double?
    var trackResampled: Bool = false
    var irResampled: Bool = false
}

struct WaveformFrame {
    var left: [Float] = []
    var right: [Float] = []
    var isMono: Bool = true

    static let empty = WaveformFrame(left: Array(repeating: 0, count: 256), right: Array(repeating: 0, count: 256), isMono: true)
}
