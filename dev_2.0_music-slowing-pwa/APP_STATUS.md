# Audio Lab — Slowed HQ (PWA)

## Overview
Offline-capable music player PWA with vinyl/tape-style pitch-shifting (speed changes pitch proportionally). Built for iOS Safari (iPhone 15 Pro) via "Add to Home Screen". Stores tracks in IndexedDB for full offline playback.

## Live URL
**https://harikuruvelil.github.io/AudioLab_iOS/**

## Tech Stack
| Layer | Tech |
|---|---|
| UI | React 18 + TypeScript |
| Build | Vite 7 |
| Audio | Web Audio API (`AudioContext`, `AudioBufferSourceNode`, `BiquadFilterNode`, `ConvolverNode`) |
| Storage | IndexedDB via `idb` library |
| Hosting | GitHub Pages (`gh-pages` branch) |

## Architecture

### Source Files
| File | Purpose |
|---|---|
| `src/main.tsx` | React entry point, SW unregistration (reliability mode) |
| `src/App.tsx` | Root component: state management, audio engine lifecycle, iOS resume handling, settings persistence (localStorage), appearance themes |
| `src/audioEngine.ts` | `TapeAudioEngine` class: Web Audio graph (source→EQ→dry/wet split→convolver→master→analyser→destination), playback control, IR loading, clip detection, quality state computation |
| `src/audioFxPresets.ts` | Reverb IR preset definitions (11 impulse responses), 8-band EQ presets (Flat, Bass Boost, Vocal, Treble Boost), EQ band sanitization |
| `src/components/PlayerScreen.tsx` | Player UI: oscilloscope canvas (linear/circular modes), transport controls, speed/pitch display, progress bar, EQ graph, appearance settings sheet, reverb/EQ controls |
| `src/components/LibraryScreen.tsx` | Track library: import from Files picker, delete, play, queue management, storage display |
| `src/components/Toast.tsx` | Toast notification overlay |
| `src/db.ts` | IndexedDB wrapper: `tracks` + `blobs` object stores for track metadata and audio file storage |
| `src/types.ts` | TypeScript interfaces: `TrackMeta`, `PlaybackState`, `QualityState`, `EqBand`, etc. |
| `src/utils.ts` | Helpers: file format detection, duration probing, byte formatting, semitone math |
| `src/styles.css` | Full styling: neon glass design system, dark theme, animated background, transport island |

### Public Assets
| File | Purpose |
|---|---|
| `public/sw.js` | Service worker (currently **disabled** — unregistered at runtime for stability) |
| `public/manifest.json` | PWA manifest for "Add to Home Screen" |
| `public/worklets/peak-meter-worklet.js` | AudioWorklet for real-time peak/clip detection |
| `public/irs/*.wav` | 11 impulse response files for convolution reverb |

### Audio Signal Graph
```
Source (AudioBufferSourceNode)
  → EQ Chain (8× BiquadFilterNode) [when EQ enabled]
  → Split Gain
    → Dry Gain → Master Gain
    → Wet Gain → Convolver (IR) → Master Gain
  → Master Gain → Destination
  → Master Gain → Analyser (mono)
  → Master Gain → ChannelSplitter → L/R Analysers
  → Master Gain → PeakMeter AudioWorklet
```

## Features

### Playback
- [x] Speed control: 0.50x – 1.50x (vinyl/tape-style pitch shift)
- [x] Preset speed buttons (0.70x–1.20x in 0.05x steps + 1.0x reset)
- [x] Seek via progress bar
- [x] Shuffle and repeat (off / one / all) modes
- [x] Queue management (add to queue, reorder, play from queue)
- [x] Previous/Next track navigation
- [x] iOS PWA resume: auto-recovers AudioContext after backgrounding

### Audio Processing
- [x] 8-band parametric EQ (HP, Low Shelf, 4× Peaking, High Shelf, LP)
- [x] 4 EQ presets + 3 custom user slots
- [x] Convolution reverb with 11 real IR presets
- [x] Dry/wet mix control (0–60%)
- [x] Master gain safety limiter (auto-reduces gain when EQ boosts + reverb)
- [x] Clip detection via AudioWorklet peak meter

### Quality Monitoring
- [x] **PCM+**: Lossless file at >44.1kHz, no resampling — highest quality
- [x] **PCM**: Lossless file at ≤44.1kHz, no resampling
- [x] **RESAMPLED**: AudioContext sample rate ≠ track sample rate (browser resampled)
- [x] **CHECKING...**: Track or IR still loading
- [x] **CLIP** warning: peak exceeds 0.999

### Oscilloscope / Waveform
- [x] Linear mode: time-domain waveform with gradient fill, grid overlay
- [x] Circular mode: radial waveform ring
- [x] Mirrored reflection canvas below waveform
- [x] Configurable FPS (24–120Hz), waveform color picker
- [x] Amplitude-reactive glow (desktop only, disabled on mobile for performance)
- [x] DPR-aware canvas: 1.5x on mobile, 2.0–2.5x on desktop

### UI / Design
- [x] Neon glass design system with frosted glass cards
- [x] Multiple color themes (appearance settings)
- [x] Ambient gradient mesh background
- [x] Animated transport ring on play button
- [x] Neon progress bar with shimmer effect
- [x] Dark lock mode (screen remains dark, no touch response)
- [x] Responsive layout for mobile

### Storage
- [x] File import from iOS Files picker (WAV, FLAC, ALAC, MP3, AAC, M4A)
- [x] IndexedDB storage with usage/quota display
- [x] Track metadata: filename, duration, size, format, added date

## Deployment
- **Build**: `$env:GITHUB_PAGES="true"; npx vite build`
- **Base path**: Controlled via `GITHUB_PAGES` env var → `/AudioLab_iOS/`
- **Deploy**: Push `dist/` contents to `gh-pages` branch
- **Asset paths**: All runtime `fetch()` URLs use `import.meta.env.BASE_URL` prefix

## Known Considerations
- **Service Worker disabled**: Unregistered on every load (`main.tsx`) to prevent stale-cache refresh loops. Offline works because tracks are in IndexedDB, not SW cache.
- **iOS AudioContext**: Requires user gesture to resume after backgrounding. The app uses visibility/pagehide/pageshow/focus/pointerdown listeners to auto-resume.
- **Peak meter worklet**: Falls back gracefully if AudioWorklet unsupported — will just not show CLIP warnings.
- **Canvas performance**: Glow effects (shadowBlur) disabled on mobile to prevent lag.
