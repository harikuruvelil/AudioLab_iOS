# MusicSlowingNative iOS Build Guide

This folder contains the native SwiftUI port. The PWA folder (`music-slowing-pwa/`) is unchanged.

## Release-Readiness Notes
- There is currently **no committed `.xcodeproj`** under `ios-native/`.
- Build is still reproducible by creating a new iOS App host project in Xcode and adding the provided Swift files/resources.
- Deployment target must be **iOS 17.0+** because this code uses SwiftData.

## Prerequisites
- macOS + Xcode 15.4 or newer (Xcode 16.x recommended)
- iPhone running iOS 17+
- Apple ID configured in Xcode (free personal team works for direct install)

## 1) Create Host Xcode Project
1. Open Xcode.
2. Create a new project: `File -> New -> Project...`.
3. Template: `iOS -> App`.
4. Product Name: `MusicSlowingNative`.
5. Interface: `SwiftUI`.
6. Language: `Swift`.
7. Check `Use SwiftData`.
8. Save the project anywhere inside your cloned repo (recommended: `ios-native/`).

## 2) Add Source Files From This Repo
1. In Finder, locate `ios-native/MusicSlowingNative/`.
2. In Xcode, delete generated starter files from the app target (for example `ContentView.swift` and the generated `App` file).
3. Use `File -> Add Files to "MusicSlowingNative"...`.
4. Select the folder `ios-native/MusicSlowingNative/`.
5. In add dialog:
- Uncheck `Copy items if needed` if the folder is already inside your repo clone.
- Choose `Create groups`.
- Ensure `Add to targets: MusicSlowingNative` is checked.

Required groups/files to include in target membership:
- `MusicSlowingNativeApp.swift`
- `Models/Track.swift`
- `Models/IRPreset.swift`
- `Models/Settings.swift`
- `Persistence/LibraryStore.swift`
- `Audio/AudioEngineManager.swift`
- `UI/RootView.swift`
- `UI/LibraryView.swift`
- `UI/PlayerView.swift`
- `UI/SettingsSheet.swift`
- `UI/EQView.swift`
- `UI/ReverbView.swift`
- `UI/WaveformView.swift`
- `Utilities/Formatters.swift`

## 3) Set Build Settings / Signing
1. Target -> `General` -> Deployment Info -> iOS Deployment Target = `17.0` or newer.
2. Target -> `Signing & Capabilities`:
- Select your Team.
- Bundle Identifier must be unique for your machine.

## 4) Add Swift Package Dependencies (Pinned)
In Xcode: `Project -> Package Dependencies`.

Add:
1. `https://github.com/AudioKit/AudioKit.git`
- Dependency Rule: **Exact Version**
- Version: **5.6.5**

2. `https://github.com/AudioKit/SoundpipeAudioKit.git`
- Dependency Rule: **Exact Version**
- Version: **5.6.5**

Add package products to app target:
- `AudioKit`
- `SoundpipeAudioKit`

The audio engine imports:
- `import AudioKit`
- `import SoundpipeAudioKit`
and uses `Convolution` from SoundpipeAudioKit.

## 5) Add IR Resources
The code expects bundled IR WAV files under app resources.

From repo root on macOS, copy existing IRs from the PWA assets:

```bash
cp music-slowing-pwa/public/irs/*.wav ios-native/MusicSlowingNative/Resources/IRs/
```

Then in Xcode:
1. Add files from `ios-native/MusicSlowingNative/Resources/IRs/` to target.
2. Ensure target membership is checked for all WAV files.

Expected filenames:
- `air_museum_1.wav`
- `air_museum_2.wav`
- `auditorium.wav`
- `drum_room_1.wav`
- `drum_room_2.wav`
- `stairwell.wav`
- `theatre_1.wav`
- `theatre_2.wav`
- `university_hall_center_rows.wav`
- `university_hall_front_row.wav`
- `university_hall_stalls.wav`

If these files are missing, app still builds, but bundled reverb presets will stay dry and show load errors.

## 6) Enable Background Audio
Target -> `Signing & Capabilities` -> add capability `Background Modes`.
Enable:
- `Audio, AirPlay, and Picture in Picture`

The app configures:
- `AVAudioSession.category = .playback`
- `AVAudioSession.mode = .default`

## 7) Run On Device
1. Connect iPhone (USB or wireless debugging).
2. Select iPhone run destination.
3. Build and run.
4. Import tracks from Files.

## Persistence / File Access Notes
- Track metadata persists in SwiftData.
- External file references use security-scoped bookmarks.
- If bookmark persistence fails for a provider, app falls back to sandbox copy (`Documents/ImportedTracks`).
- Imported custom IRs use the same bookmark-first + sandbox fallback approach (`Documents/ImportedIRs`).

## Parity Checklist (PWA -> Native)
- [x] Persistent library metadata
- [x] Import `.wav`, `.mp3`, `.flac`
- [x] Delete tracks
- [x] Tape-style speed (0.50-1.10), pitch-linked (no preserve-pitch time stretch)
- [x] Semitone display `12 * log2(rate)`
- [x] Seek/scrub
- [x] Prev/Play/Pause/Next
- [x] Shuffle + repeat modes + history-aware back
- [x] Auto next on end
- [x] 5-band EQ with presets
- [x] Convolution reverb presets + custom IR import
- [x] Quality chip (`CHECKING...` / `FULL RATE MATCH` / `RESAMPLED`)
- [x] Clip chip warning-only (no limiter)
- [x] Waveform modes: linear / circular / vectorscope
- [x] Settings bottom sheet

## Known Constraints
- `.flac` decode support depends on iOS codec behavior and specific files.
- Files-provider permissions can be revoked externally; bookmark refresh/fallback mitigates this.
- iOS can reclaim app storage under severe low-storage pressure.