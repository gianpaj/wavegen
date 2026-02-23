# seewav-wasm Design

**Date:** 2026-02-23
**Status:** Approved
**Source:** Port of [seewav.py](../../seewav.py) — audio waveform visualizer → MP4

---

## Overview

A browser-based Vue 3 app that replicates `seewav.py` functionality entirely client-side. The user uploads an audio file, configures waveform and video options, and downloads an MP4 of the animated waveform visualization. No server required.

Core WASM dependency: `@ffmpeg/ffmpeg` v0.12+ for audio decoding and video encoding.
Encoder strategy: WebCodecs (`VideoEncoder` + `mp4-muxer`) on Chrome; ffmpeg.wasm on Firefox/Safari.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Vue 3 App (main thread)                                │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │  AudioUpload │  │ ControlPanel │  │ VideoPreview  │ │
│  │  component   │  │ (full opts)  │  │ + Download    │ │
│  └──────────────┘  └──────────────┘  └───────────────┘ │
│              │             │                            │
│         useSeewav() composable                         │
│              │  postMessage / onmessage                │
└──────────────┼─────────────────────────────────────────┘
               │
   ┌───────────▼───────────────────────────────────┐
   │  seewav.worker.ts  (Web Worker)               │
   │                                               │
   │  1. ffmpeg.wasm  → decode audio → raw PCM     │
   │  2. JS signal processing (envelope, sigmoid)  │
   │  3. OffscreenCanvas → PNG frame blobs         │
   │  4a. Chrome: WebCodecs VideoEncoder + mp4-muxer│
   │  4b. Other:  ffmpeg.wasm → encode MP4         │
   │                                               │
   │  progress events → main thread               │
   └───────────────────────────────────────────────┘
```

**Key dependencies:**
- `@ffmpeg/ffmpeg` + `@ffmpeg/util` — WASM FFmpeg (SharedArrayBuffer; requires COOP/COEP headers)
- `mp4-muxer` — mux raw H.264 NAL units into `.mp4` container for WebCodecs path
- `vue` 3 — UI framework
- Bun — build toolchain (per project convention)

---

## Project Structure

```
src/
├── App.vue
├── components/
│   ├── AudioUpload.vue       # drag & drop + file picker
│   ├── ColorPicker.vue       # reusable color input wrapper
│   ├── ControlPanel.vue      # all waveform/video/export controls
│   ├── ProgressBar.vue       # live % feedback
│   └── VideoPreview.vue      # <video> player + download button
├── composables/
│   └── useSeewav.ts          # worker bridge, reactive state, generate()
├── workers/
│   └── seewav.worker.ts      # entire pipeline: decode → DSP → render → encode
├── lib/
│   ├── dsp.ts                # envelope(), sigmoid(), interpole() — pure TS
│   ├── draw.ts               # OffscreenCanvas draw_env() port
│   └── encode.ts             # encoder strategy (WebCodecs vs ffmpeg.wasm)
└── types/
    └── seewav.ts             # SeewavOptions, WorkerProgressEvent, etc.
```

---

## Controls

### Input
| Control | Type | Notes |
|---|---|---|
| Audio file | Drag & drop / file picker | `.mp3`, `.wav`, `.ogg`, `.flac`, `.aac`, `.m4a` |

### Colors
| Control | Param | Default |
|---|---|---|
| Main color | `fg_color` | `(0.03, 0.6, 0.3)` |
| Secondary color | `fg_color2` | `(0.5, 0.3, 0.6)` — stereo channel 2 |
| Background color | `bg_color` | `(0, 0, 0)` — black |

### Waveform
| Control | Param | Default |
|---|---|---|
| Bars | `bars` | 50 |
| Speed | `speed` | 4 |
| Time window (s) | `time` | 0.4 |
| Oversample | `oversample` | 4 |
| Stereo | `stereo` | false |

### Video
| Control | Param | Default |
|---|---|---|
| Width (px) | `width` | 480 |
| Height (px) | `height` | 300 |
| Framerate | `rate` | 60 |
| Seek (s) | `seek` | — |
| Duration (s) | `duration` | — |

### Export
| Control | Notes |
|---|---|
| Include audio | Toggle, default on |
| Generate button | Triggers worker pipeline |
| Progress bar | Live % — frame generation + encoding phases |
| Download MP4 | Appears on completion |

---

## Data Flow / Pipeline

```
User uploads audio file (File object)
        │
        ▼
Worker: ffmpeg.wasm decode
  ffmpeg -i input.[ext] -f f32le -  →  raw Float32 PCM bytes
        │
        ▼
JS Signal Processing  (lib/dsp.ts — ported from seewav.py)
  • normalize per channel: wav / wav.std()
  • envelope(): windowed average pool + sigmoid compressor
    - pad wav by window//2
    - stride through windows, take mean of max(frame, 0)
    - apply: 1.9 * (sigmoid(2.5 * out) - 0.5)
  • pad envelope arrays for scroll animation
        │
        ▼
Frame Rendering loop  (lib/draw.ts — OffscreenCanvas, replaces pycairo)
  for each frame idx 0..frames-1:
    • compute scroll position: pos = (idx/rate * sr) / stride / bars
    • interpolate env1 and env2 windows via sigmoid speedup
    • apply hanning window smoothing
    • draw_env() on OffscreenCanvas
      - fill bg_color rectangle
      - for each bar step, for each channel K:
          draw upper bar (fg_color, full opacity)
          draw lower bar (fg_color, 0.8 opacity)
    • canvas.convertToBlob("image/png") → PNG blob
    • postMessage({ type: "progress", phase: "frames", pct })
        │
        ▼
  ┌──────────────────────────────────┐
  │ Chrome (typeof VideoEncoder ≠ undefined) │
  │  WebCodecs VideoEncoder (H.264)  │
  │  + mp4-muxer                     │
  │  + audio track from ffmpeg.wasm  │
  └──────────────────────────────────┘
        OR
  ┌──────────────────────────────────┐
  │ Firefox / Safari                 │
  │  ffmpeg.wasm                     │
  │  image2 pipe → libx264 → AAC → MP4 │
  └──────────────────────────────────┘
        │
        ▼
ArrayBuffer (MP4) → Blob URL
postMessage({ type: "done", url })
→ VideoPreview shows <video> + Download button
```

---

## Encoding Strategy (`lib/encode.ts`)

```ts
export function supportsWebCodecs(): boolean {
  return typeof VideoEncoder !== "undefined";
}
```

The worker imports this and branches at encode time. Both paths run inside the worker to keep the main thread free.

**WebCodecs path (Chrome):**
1. `VideoEncoder` encodes each PNG frame as `VideoFrame` → H.264 chunks
2. `mp4-muxer` accumulates chunks into an MP4 container
3. If include-audio: extract AAC from source via ffmpeg.wasm, mux into same container

**ffmpeg.wasm path (Firefox/Safari):**
1. Write all PNG frames to ffmpeg virtual FS
2. Write original audio file to virtual FS
3. Run: `ffmpeg -r {rate} -f image2 -i %06d.png -i audio -c:a aac -vcodec libx264 -crf 10 -pix_fmt yuv420p out.mp4`
4. Read `out.mp4` from virtual FS → ArrayBuffer

---

## COOP/COEP Headers

`@ffmpeg/ffmpeg` multi-thread build requires `SharedArrayBuffer`, which needs:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

The dev server (Bun) must set these headers. A `bunServe` config in `index.ts` handles this for local dev; deployment needs same headers (e.g. Cloudflare Pages `_headers` file).

---

## Testing

### Unit tests (`bun test`)
- `dsp.ts` — `envelope()`, `sigmoid()`, `interpole()` against known values from the Python original
- `draw.ts` — frame render produces correct pixel values for a synthetic envelope
- `encode.ts` — `supportsWebCodecs()` returns correct value; strategy selector branches correctly

### Integration tests
- Worker pipeline: feed a short synthetic WAV (generated in test) → assert output ArrayBuffer starts with MP4 magic bytes (`\x00\x00\x00..ftyp`)

### E2E (Playwright)

Matrix: **Chrome, Firefox, Safari** × **desktop, mobile** (6 configurations via Playwright projects).

Core flow tested on each:
- Upload a short MP3 → click Generate → progress bar reaches 100% → Download button appears → downloaded file is a valid non-empty MP4

Browser-specific assertions:
- **Chrome desktop/mobile** — WebCodecs path used (assert `VideoEncoder` available in page context)
- **Firefox desktop/mobile** — ffmpeg.wasm path used (assert `VideoEncoder` unavailable)
- **Safari desktop/mobile** — ffmpeg.wasm path used (assert `VideoEncoder` unavailable)

Mobile viewports: use Playwright's built-in `devices` (`iPhone 15`, `Pixel 7`) for touch/responsive layout checks.

---

## Out of Scope

- Server-side processing
- Batch processing of multiple files
- Real-time preview during generation
- Custom font/text overlay
