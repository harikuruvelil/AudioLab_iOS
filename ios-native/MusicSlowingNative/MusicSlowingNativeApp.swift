import SwiftData
import SwiftUI

@main
struct MusicSlowingNativeApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .preferredColorScheme(.dark)
        }
        .modelContainer(for: [Track.self])
    }
}