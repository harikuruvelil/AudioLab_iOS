import Foundation

enum AppFormatters {
    static func time(_ seconds: Double) -> String {
        guard seconds.isFinite else { return "0:00" }
        let safe = max(0, Int(seconds.rounded(.down)))
        let minutes = safe / 60
        let remaining = safe % 60
        return String(format: "%d:%02d", minutes, remaining)
    }

    static func bytes(_ value: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: value, countStyle: .file)
    }

    static func hz(_ value: Double?) -> String {
        guard let value else { return "--" }
        return NumberFormatter.localizedString(from: NSNumber(value: value), number: .decimal)
    }
}

enum AudioMath {
    static func semitoneShift(for rate: Float) -> Double {
        guard rate > 0 else { return 0 }
        return 12.0 * log2(Double(rate))
    }

    static func wetInternal(fromPercent percent: Double) -> Float {
        let clamped = min(max(percent, 0), 100)
        return Float((clamped / 100.0) * 0.60)
    }

    static func wetPercent(fromInternal wet: Float) -> Double {
        let clamped = min(max(Double(wet), 0), 0.60)
        return (clamped / 0.60) * 100.0
    }
}