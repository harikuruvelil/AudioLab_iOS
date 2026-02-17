import SwiftData
import SwiftUI

struct RootView: View {
    @Environment(\.modelContext) private var modelContext

    @StateObject private var audioManager = AudioEngineManager()
    @State private var libraryStore: LibraryStore?
    @State private var selectedTab = 1

    var body: some View {
        Group {
            if let libraryStore {
                TabView(selection: $selectedTab) {
                    LibraryView(libraryStore: libraryStore, audioManager: audioManager)
                        .tabItem {
                            Label("Library", systemImage: "music.note.list")
                        }
                        .tag(0)

                    PlayerView(libraryStore: libraryStore, audioManager: audioManager)
                        .tabItem {
                            Label("Player", systemImage: "play.circle")
                        }
                        .tag(1)
                }
            } else {
                ProgressView("Preparing Library...")
                    .task {
                        let store = LibraryStore(modelContext: modelContext)
                        libraryStore = store
                        audioManager.attachLibraryStore(store)
                    }
            }
        }
    }
}