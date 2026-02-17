# Music Slowing App

This repository contains two implementations of the same music-slowing concept: an installable web app (PWA) and a native iOS app.

## Repo Structure
- `music-slowing-pwa/`: Vite-based PWA version (Web Audio + IndexedDB).
- `ios-native/`: Native SwiftUI iOS version (AVAudioEngine/AudioKit).
- `MusicSlowingApp/`: Legacy/earlier native project snapshot kept for reference.

## How to run the PWA
```bash
cd music-slowing-pwa
npm install
npm run dev -- --host
npm run build
```

## How to build the iOS app
See the native build guide:
- `ios-native/README_XCODE_BUILD.md`

## Playback note (PWA vs Native on iPhone)
iOS PWAs often stop or have limitations when the screen locks/backgrounding occurs. The native iOS app is the recommended path when reliable background audio playback is required.