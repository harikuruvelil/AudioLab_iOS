# Music Slowing App PWA

A mobile-first iOS-friendly PWA version of your Swift app.

## What it does

- Import multiple local files from iOS Files picker (`.wav`, `.mp3`, `.flac`)
- Persist library across restarts using IndexedDB (metadata + audio Blob bytes)
- Delete tracks from library
- Show storage usage estimate
- Play selected track with Web Audio API
- Speed control from `0.50x` to `1.10x` in `0.01` steps
- Natural pitch linkage via `playbackRate` (no preserve-pitch stretching)
- Semitone display using exact formula: `12 * log2(rate)`
- Basic transport: Back / Play-Pause / Next
- Offline shell support via Service Worker + Manifest for installability

## Install and run

1. `npm install`
2. `npm run dev`
3. `npm run build`
4. `npm run preview`

## Test on iPhone (same Wi-Fi)

1. Start dev server on LAN:
   - `npm run dev -- --host`
2. Find your computer LAN IP (example `192.168.1.40`).
3. On iPhone Safari, open:
   - `http://<LAN-IP>:5173`
4. Import files in **Library**, open **Player**, play and adjust speed slider.

## Add to Home Screen

1. In iPhone Safari, open the app URL.
2. Tap Share.
3. Tap **Add to Home Screen**.
4. Launch from the Home Screen icon.

## Verify requirements quickly

1. Import several files (`wav/mp3/flac`) in one action.
2. Force close Safari and reopen app from Home Screen.
3. Confirm library entries persist.
4. Play a track and move speed between `0.50` and `1.10`.
5. Confirm pitch shift text follows `12 * log2(rate)`.

## Compatibility Notes

- iOS PWA storage can be evicted by the OS under pressure. IndexedDB persistence is best-effort, not absolute.
- FLAC support varies by iOS/Safari version and encoder/profile. Some FLAC files may import but fail decode/playback.
- Background/lock-screen audio behavior in iOS PWAs is limited versus native apps; playback may suspend when app is backgrounded.

## Notes

- Icons are SVG placeholders in `public/icons`. Replace with PNG assets for best iOS icon fidelity.
- Service worker caches app shell and fetched static assets. Audio files are loaded from IndexedDB, not cache storage.
