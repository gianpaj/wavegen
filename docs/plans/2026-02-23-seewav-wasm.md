# seewav-wasm Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port seewav.py into a browser-only Vue 3 app that generates an animated MP4 waveform from an uploaded audio file using ffmpeg.wasm and (on Chrome) WebCodecs.

**Architecture:** A Bun-served single-page app where all heavy processing runs in a Web Worker. The main thread (Vue 3 + TSX) manages UI state and communicates with the worker via `postMessage`. The worker decodes audio with ffmpeg.wasm, computes the envelope in JS, renders frames on OffscreenCanvas, then encodes to MP4 via WebCodecs (Chrome) or ffmpeg.wasm (Firefox/Safari).

**Tech Stack:** Bun, Vue 3 (TSX, no SFCs), `@ffmpeg/ffmpeg` v0.12, `mp4-muxer`, Playwright (E2E), `bun test` (unit/integration)

> **Note on `ffmpeg["exec"]`:** Throughout this plan, `ffmpeg["exec"](args)` is the `@ffmpeg/ffmpeg` library's own method for running an FFmpeg command inside WASM — it is NOT Node.js `child_process.exec`. No shell is involved; args are passed as a plain string array.

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `index.html`
- Create: `server.ts`

**Step 1: Initialise package.json**

```bash
cd /Users/gianpaj/tmp/seewav-wasm
bun init -y
```

**Step 2: Install runtime dependencies**

```bash
bun add vue @ffmpeg/ffmpeg @ffmpeg/util mp4-muxer
```

**Step 3: Install dev dependencies**

```bash
bun add -d typescript @types/bun playwright @playwright/test
```

**Step 4: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "jsxImportSource": "vue",
    "strict": true,
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "types": ["bun-types"]
  },
  "include": ["src/**/*", "server.ts"]
}
```

**Step 5: Write index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>seewav — waveform visualizer</title>
    <link rel="stylesheet" href="./src/style.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
```

**Step 6: Write server.ts** (Bun dev server with required COOP/COEP headers)

```ts
import index from "./index.html";

Bun.serve({
  routes: {
    "/": index,
  },
  development: {
    hmr: true,
    console: true,
  },
  port: 5173,
});
```

> COOP/COEP header injection is added in Task 13 (requires a `fetch()` middleware wrapper in `Bun.serve`).

**Step 7: Create src directory structure**

```bash
mkdir -p src/components src/composables src/workers src/lib src/types
```

**Step 8: Commit**

```bash
git init
git add .
git commit -m "chore: scaffold Bun + Vue 3 TSX project"
```

---

## Task 2: Type definitions

**Files:**
- Create: `src/types/seewav.ts`

**Step 1: Write types**

```ts
// src/types/seewav.ts

export interface SeewavOptions {
  // Colors — each value is 0..1 RGB
  fgColor: [number, number, number];
  fgColor2: [number, number, number];
  bgColor: [number, number, number];
  // Waveform
  bars: number;       // default 50
  speed: number;      // default 4
  time: number;       // seconds of audio shown per frame, default 0.4
  oversample: number; // default 4
  stereo: boolean;    // default false
  // Video
  width: number;      // default 480
  height: number;     // default 300
  rate: number;       // framerate, default 60
  seek?: number;      // optional start offset in seconds
  duration?: number;  // optional clip length in seconds
  // Export
  includeAudio: boolean; // default true
}

export type WorkerInMessage =
  | { type: "generate"; file: File; options: SeewavOptions }

export type WorkerOutMessage =
  | { type: "progress"; phase: "frames" | "encode"; pct: number }
  | { type: "done"; buffer: ArrayBuffer }
  | { type: "error"; message: string }
```

**Step 2: Commit**

```bash
git add src/types/seewav.ts
git commit -m "chore: add SeewavOptions and worker message types"
```

---

## Task 3: DSP library (unit tested)

**Files:**
- Create: `src/lib/dsp.ts`
- Create: `src/lib/dsp.test.ts`

**Step 1: Write failing tests**

```ts
// src/lib/dsp.test.ts
import { describe, test, expect } from "bun:test";
import { sigmoid, interpole, envelope } from "./dsp";

describe("sigmoid", () => {
  test("sigmoid(0) === 0.5", () => {
    expect(sigmoid(0)).toBeCloseTo(0.5, 5);
  });
  test("sigmoid large positive → ~1", () => {
    expect(sigmoid(100)).toBeCloseTo(1, 5);
  });
  test("sigmoid large negative → ~0", () => {
    expect(sigmoid(-100)).toBeCloseTo(0, 5);
  });
});

describe("interpole", () => {
  test("midpoint", () => {
    expect(interpole(0, 0, 10, 100, 5)).toBeCloseTo(50, 5);
  });
  test("at x1 returns y1", () => {
    expect(interpole(2, 10, 8, 40, 2)).toBeCloseTo(10, 5);
  });
  test("at x2 returns y2", () => {
    expect(interpole(2, 10, 8, 40, 8)).toBeCloseTo(40, 5);
  });
});

describe("envelope", () => {
  test("output length matches stride count", () => {
    const wav = new Float32Array(100).fill(1);
    const out = envelope(wav, 10, 5);
    // floor((100 - 10) / 5) = 18 entries
    expect(out.length).toBe(18);
  });
  test("all-ones input → positive output values in (0, 1)", () => {
    const wav = new Float32Array(200).fill(1);
    const out = envelope(wav, 20, 10);
    for (const v of out) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
  });
  test("all-zeros input → output near 0", () => {
    const wav = new Float32Array(200).fill(0);
    const out = envelope(wav, 20, 10);
    for (const v of out) {
      expect(v).toBeCloseTo(0, 3);
    }
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test src/lib/dsp.test.ts
```
Expected: FAIL — `Cannot find module './dsp'`

**Step 3: Implement dsp.ts**

```ts
// src/lib/dsp.ts

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function interpole(
  x1: number, y1: number,
  x2: number, y2: number,
  x: number
): number {
  return y1 + (y2 - y1) * (x - x1) / (x2 - x1);
}

/**
 * Port of seewav.py envelope().
 * wav: Float32Array of mono samples
 * window: number of samples per analysis window
 * stride: hop size in samples
 * Returns Float64Array of compressed envelope values.
 */
export function envelope(wav: Float32Array, window: number, stride: number): Float64Array {
  const half = Math.floor(window / 2);
  const padded = new Float32Array(wav.length + 2 * half);
  padded.set(wav, half);

  const out: number[] = [];
  for (let off = 0; off < padded.length - window; off += stride) {
    let sum = 0;
    for (let i = off; i < off + window; i++) {
      sum += Math.max(padded[i], 0);
    }
    out.push(sum / window);
  }

  const result = new Float64Array(out.length);
  for (let i = 0; i < out.length; i++) {
    // audio compressor: 1.9 * (sigmoid(2.5 * x) - 0.5)
    result[i] = 1.9 * (sigmoid(2.5 * out[i]) - 0.5);
  }
  return result;
}
```

**Step 4: Run tests to verify they pass**

```bash
bun test src/lib/dsp.test.ts
```
Expected: PASS — all 8 tests

**Step 5: Commit**

```bash
git add src/lib/dsp.ts src/lib/dsp.test.ts
git commit -m "feat: port DSP functions (sigmoid, interpole, envelope) with tests"
```

---

## Task 4: Draw library (unit tested)

**Files:**
- Create: `src/lib/draw.ts`
- Create: `src/lib/draw.test.ts`

**Step 1: Write failing tests**

```ts
// src/lib/draw.test.ts
import { describe, test, expect } from "bun:test";
import { buildFrameEnvs } from "./draw";
import { envelope } from "./dsp";

describe("buildFrameEnvs", () => {
  test("returns one env per channel", () => {
    const wav = new Float32Array(4410).fill(0.5);
    const env = envelope(wav, 441, 110);
    const padded = buildFrameEnvs([env], 50);
    expect(padded.length).toBe(1);
  });

  test("padded env length is original + bars//2 + 2*bars", () => {
    const wav = new Float32Array(4410).fill(0.5);
    const env = envelope(wav, 441, 110);
    const bars = 50;
    const padded = buildFrameEnvs([env], bars);
    expect(padded[0].length).toBe(env.length + Math.floor(bars / 2) + 2 * bars);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test src/lib/draw.test.ts
```

**Step 3: Implement draw.ts**

```ts
// src/lib/draw.ts

/**
 * Pad each envelope for the scroll animation.
 * Matches seewav.py:  env = np.pad(env, (bars // 2, 2 * bars))
 */
export function buildFrameEnvs(envs: Float64Array[], bars: number): Float64Array[] {
  return envs.map((env) => {
    const pre = Math.floor(bars / 2);
    const post = 2 * bars;
    const result = new Float64Array(env.length + pre + post);
    result.set(env, pre);
    return result;
  });
}

/**
 * Port of seewav.py draw_env().
 * Draws one frame onto an OffscreenCanvas (or regular Canvas in tests).
 */
export function drawEnv(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  envs: Float64Array[],
  fgColors: Array<[number, number, number]>,
  bgColor: [number, number, number],
  width: number,
  height: number
): void {
  ctx.fillStyle = rgbCss(bgColor);
  ctx.fillRect(0, 0, width, height);

  const K = envs.length;
  const T = envs[0].length;
  const padRatio = 0.1;
  const barWidth = width / (T * (1 + 2 * padRatio));
  const pad = padRatio * barWidth;
  const delta = 2 * pad + barWidth;

  ctx.lineWidth = barWidth;

  for (let step = 0; step < T; step++) {
    for (let i = 0; i < K; i++) {
      const half = (0.5 * envs[i][step] / K) * height;
      const midrule = ((1 + 2 * i) / (2 * K)) * height;
      const x = pad + step * delta + barWidth / 2;

      ctx.strokeStyle = rgbCss(fgColors[i]);
      ctx.beginPath();
      ctx.moveTo(x, midrule - half);
      ctx.lineTo(x, midrule);
      ctx.stroke();

      const [r, g, b] = fgColors[i];
      ctx.strokeStyle = `rgba(${r255(r)},${r255(g)},${r255(b)},0.8)`;
      ctx.beginPath();
      ctx.moveTo(x, midrule);
      ctx.lineTo(x, midrule + 0.9 * half);
      ctx.stroke();
    }
  }
}

function rgbCss([r, g, b]: [number, number, number]): string {
  return `rgb(${r255(r)},${r255(g)},${r255(b)})`;
}

function r255(v: number): number {
  return Math.round(v * 255);
}
```

**Step 4: Run tests**

```bash
bun test src/lib/draw.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/draw.ts src/lib/draw.test.ts
git commit -m "feat: port draw_env() to OffscreenCanvas with tests"
```

---

## Task 5: Encode strategy (unit tested)

**Files:**
- Create: `src/lib/encode.ts`
- Create: `src/lib/encode.test.ts`

**Step 1: Write failing tests**

```ts
// src/lib/encode.test.ts
import { describe, test, expect } from "bun:test";
import { supportsWebCodecs } from "./encode";

describe("supportsWebCodecs", () => {
  test("returns false when VideoEncoder is not defined", () => {
    // Bun test environment has no VideoEncoder
    expect(supportsWebCodecs()).toBe(false);
  });

  test("returns true when VideoEncoder is defined", () => {
    (globalThis as any).VideoEncoder = class {};
    expect(supportsWebCodecs()).toBe(true);
    delete (globalThis as any).VideoEncoder;
  });
});
```

**Step 2: Run to verify fail**

```bash
bun test src/lib/encode.test.ts
```

**Step 3: Implement encode.ts**

```ts
// src/lib/encode.ts

export function supportsWebCodecs(): boolean {
  return typeof VideoEncoder !== "undefined";
}
```

**Step 4: Run to verify pass**

```bash
bun test src/lib/encode.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/encode.ts src/lib/encode.test.ts
git commit -m "feat: encoder strategy detection with tests"
```

---

## Task 6: Web Worker — audio decode + frame pipeline

**Files:**
- Create: `src/workers/seewav.worker.ts`

> `ffmpeg["exec"](args)` below is the `@ffmpeg/ffmpeg` library method — it runs FFmpeg commands inside WASM with args as a string array. No shell is spawned.

**Step 1: Write the worker**

```ts
// src/workers/seewav.worker.ts
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import type { SeewavOptions, WorkerOutMessage } from "../types/seewav";
import { envelope, sigmoid, interpole } from "../lib/dsp";
import { buildFrameEnvs, drawEnv } from "../lib/draw";
import { supportsWebCodecs } from "../lib/encode";

const ffmpeg = new FFmpeg();
let ffmpegLoaded = false;

async function ensureFFmpeg() {
  if (!ffmpegLoaded) {
    await ffmpeg.load();
    ffmpegLoaded = true;
  }
}

self.onmessage = async (e: MessageEvent) => {
  const { type, file, options } = e.data;
  if (type !== "generate") return;
  try {
    await ensureFFmpeg();
    const mp4 = await generate(file as File, options as SeewavOptions);
    self.postMessage({ type: "done", buffer: mp4 } satisfies WorkerOutMessage, [mp4]);
  } catch (err: any) {
    self.postMessage({ type: "error", message: String(err?.message ?? err) } satisfies WorkerOutMessage);
  }
};

async function generate(file: File, opts: SeewavOptions): Promise<ArrayBuffer> {
  // 1. Write input audio to ffmpeg virtual FS
  await ffmpeg.writeFile("input", await fetchFile(file));

  // 2. Decode to 2-channel f32le PCM at original sample rate
  //    ffmpeg["exec"] is the @ffmpeg/ffmpeg library method, NOT child_process
  const decodeArgs = ["-i", "input"];
  if (opts.seek != null) decodeArgs.push("-ss", String(opts.seek));
  if (opts.duration != null) decodeArgs.push("-t", String(opts.duration));
  decodeArgs.push("-ac", "2", "-f", "f32le", "-acodec", "pcm_f32le", "pcm.raw");
  await ffmpeg["exec"](decodeArgs);

  const rawData = await ffmpeg.readFile("pcm.raw") as Uint8Array;
  const pcm = new Float32Array(rawData.buffer);

  // Sample rate: default 44100; proper SR parsing is a known limitation (see plan footer)
  const sr = 44100;
  const numSamples = pcm.length / 2;

  // Deinterleave stereo
  const ch0 = new Float32Array(numSamples);
  const ch1 = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    ch0[i] = pcm[i * 2];
    ch1[i] = pcm[i * 2 + 1];
  }

  // 3. Build waveform arrays
  const wavs: Float32Array[] = opts.stereo ? [ch0, ch1] : [mixDown(ch0, ch1)];
  for (let i = 0; i < wavs.length; i++) {
    const std = stddev(wavs[i]);
    if (std > 0) {
      const w = wavs[i];
      for (let j = 0; j < w.length; j++) w[j] /= std;
    }
  }

  // 4. Compute envelopes
  const windowSamples = Math.floor((sr * opts.time) / opts.bars);
  const stride = Math.floor(windowSamples / opts.oversample);
  const rawEnvs = wavs.map((w) => envelope(w, windowSamples, stride));
  const envs = buildFrameEnvs(rawEnvs, opts.bars);

  const durationSec = numSamples / sr;
  const frames = Math.floor(opts.rate * durationSec);
  const smooth = hanning(opts.bars);
  const fgColors: Array<[number, number, number]> = [opts.fgColor, opts.fgColor2];

  // 5. Render frames onto OffscreenCanvas
  const pngBlobs: Blob[] = [];
  const canvas = new OffscreenCanvas(opts.width, opts.height);
  const ctx = canvas.getContext("2d")!;

  for (let idx = 0; idx < frames; idx++) {
    const pos = ((idx / opts.rate) * sr) / stride / opts.bars;
    const off = Math.floor(pos);
    const loc = pos - off;

    const denvs = envs.map((env) => {
      const env1 = env.slice(off * opts.bars, (off + 1) * opts.bars);
      const env2 = env.slice((off + 1) * opts.bars, (off + 2) * opts.bars);
      const maxvol = 10 * Math.log10(1e-4 + arrayMax(env2));
      const speedup = Math.min(Math.max(interpole(-6, 0.5, 0, 2, maxvol), 0.5), 2);
      const w = sigmoid(opts.speed * speedup * (loc - 0.5));
      const denv = new Float64Array(opts.bars);
      for (let j = 0; j < opts.bars; j++) {
        denv[j] = ((1 - w) * (env1[j] ?? 0) + w * (env2[j] ?? 0)) * smooth[j];
      }
      return denv;
    });

    drawEnv(ctx, denvs, fgColors, opts.bgColor, opts.width, opts.height);
    pngBlobs.push(await canvas.convertToBlob({ type: "image/png" }));

    if (idx % 10 === 0) {
      self.postMessage({
        type: "progress",
        phase: "frames",
        pct: Math.round((idx / frames) * 80),
      } satisfies WorkerOutMessage);
    }
  }

  // 6. Encode
  if (supportsWebCodecs()) {
    return encodeWebCodecs(pngBlobs, opts, sr);
  }
  return encodeWithFFmpeg(pngBlobs, opts, file);
}

async function encodeWithFFmpeg(
  pngBlobs: Blob[],
  opts: SeewavOptions,
  audioFile: File
): Promise<ArrayBuffer> {
  for (let i = 0; i < pngBlobs.length; i++) {
    const buf = await pngBlobs[i].arrayBuffer();
    await ffmpeg.writeFile(`frame${String(i).padStart(6, "0")}.png`, new Uint8Array(buf));
  }
  if (opts.includeAudio) {
    await ffmpeg.writeFile("audio_in", await fetchFile(audioFile));
  }

  const encArgs = ["-y", "-r", String(opts.rate), "-f", "image2", "-i", "frame%06d.png"];
  if (opts.includeAudio) {
    if (opts.seek != null) encArgs.push("-ss", String(opts.seek));
    encArgs.push("-i", "audio_in");
    if (opts.duration != null) encArgs.push("-t", String(opts.duration));
    encArgs.push("-c:a", "aac");
  }
  encArgs.push("-vcodec", "libx264", "-crf", "10", "-pix_fmt", "yuv420p", "out.mp4");

  self.postMessage({ type: "progress", phase: "encode", pct: 85 } satisfies WorkerOutMessage);
  await ffmpeg["exec"](encArgs);

  const outData = await ffmpeg.readFile("out.mp4") as Uint8Array;
  return outData.buffer;
}

async function encodeWebCodecs(
  pngBlobs: Blob[],
  opts: SeewavOptions,
  sr: number
): Promise<ArrayBuffer> {
  const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width: opts.width, height: opts.height },
    fastStart: "in-memory",
  });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { throw e; },
  });
  encoder.configure({
    codec: "avc1.42001f",
    width: opts.width,
    height: opts.height,
    bitrate: 2_000_000,
    framerate: opts.rate,
  });

  for (let i = 0; i < pngBlobs.length; i++) {
    const bitmap = await createImageBitmap(pngBlobs[i]);
    const frame = new VideoFrame(bitmap, {
      timestamp: Math.round((i / opts.rate) * 1_000_000),
      duration: Math.round((1 / opts.rate) * 1_000_000),
    });
    encoder.encode(frame, { keyFrame: i % (opts.rate * 2) === 0 });
    frame.close();
    bitmap.close();

    if (i % 10 === 0) {
      self.postMessage({
        type: "progress",
        phase: "encode",
        pct: 80 + Math.round((i / pngBlobs.length) * 15),
      } satisfies WorkerOutMessage);
    }
  }
  await encoder.flush();
  // NOTE: audio muxing for WebCodecs path is a known gap (see Known Limitations).
  // The ffmpeg.wasm path correctly includes audio.
  muxer.finalize();
  return target.buffer;
}

// Helpers
function mixDown(ch0: Float32Array, ch1: Float32Array): Float32Array {
  const out = new Float32Array(ch0.length);
  for (let i = 0; i < ch0.length; i++) out[i] = (ch0[i] + ch1[i]) / 2;
  return out;
}

function stddev(arr: Float32Array): number {
  let sum = 0, sum2 = 0;
  for (const v of arr) { sum += v; sum2 += v * v; }
  const mean = sum / arr.length;
  return Math.sqrt(sum2 / arr.length - mean * mean);
}

function arrayMax(arr: Float64Array): number {
  let m = -Infinity;
  for (const v of arr) if (v > m) m = v;
  return m;
}

function hanning(n: number): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return out;
}
```

**Step 2: Commit**

```bash
git add src/workers/seewav.worker.ts
git commit -m "feat: web worker pipeline (decode, DSP, render, encode)"
```

---

## Task 7: Worker integration test

**Files:**
- Create: `src/workers/seewav.worker.test.ts`

**Step 1: Write test**

```ts
// src/workers/seewav.worker.test.ts
import { describe, test, expect } from "bun:test";

// Validates that a buffer starts with MP4 'ftyp' box magic bytes
function isMp4(buffer: ArrayBuffer): boolean {
  const view = new Uint8Array(buffer);
  return (
    view[4] === 0x66 && // 'f'
    view[5] === 0x74 && // 't'
    view[6] === 0x79 && // 'y'
    view[7] === 0x70    // 'p'
  );
}

describe("isMp4 magic bytes checker", () => {
  test("correctly identifies ftyp box", () => {
    const buf = new ArrayBuffer(16);
    const view = new Uint8Array(buf);
    view[4] = 0x66; view[5] = 0x74; view[6] = 0x79; view[7] = 0x70;
    expect(isMp4(buf)).toBe(true);
  });

  test("rejects non-MP4 buffer", () => {
    expect(isMp4(new ArrayBuffer(16))).toBe(false);
  });
});

// Full pipeline integration test (worker → real MP4 output) is covered by
// E2E tests in Task 14, which require a browser context for OffscreenCanvas
// and the ffmpeg.wasm WASM binary.
```

**Step 2: Run**

```bash
bun test src/workers/seewav.worker.test.ts
```
Expected: PASS

**Step 3: Commit**

```bash
git add src/workers/seewav.worker.test.ts
git commit -m "test: MP4 magic bytes validator"
```

---

## Task 8: useSeewav composable

**Files:**
- Create: `src/composables/useSeewav.ts`

**Step 1: Implement**

```ts
// src/composables/useSeewav.ts
import { ref, shallowRef } from "vue";
import type { SeewavOptions, WorkerOutMessage } from "../types/seewav";

export function useSeewav() {
  const isGenerating = ref(false);
  const progress = ref(0);
  const progressPhase = ref<"frames" | "encode" | null>(null);
  const resultUrl = shallowRef<string | null>(null);
  const error = ref<string | null>(null);

  let worker: Worker | null = null;

  function generate(file: File, options: SeewavOptions) {
    if (isGenerating.value) return;

    if (resultUrl.value) {
      URL.revokeObjectURL(resultUrl.value);
      resultUrl.value = null;
    }
    error.value = null;
    progress.value = 0;
    progressPhase.value = null;
    isGenerating.value = true;

    worker?.terminate();
    worker = new Worker(
      new URL("../workers/seewav.worker.ts", import.meta.url),
      { type: "module" }
    );

    worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        progress.value = msg.pct;
        progressPhase.value = msg.phase;
      } else if (msg.type === "done") {
        resultUrl.value = URL.createObjectURL(
          new Blob([msg.buffer], { type: "video/mp4" })
        );
        progress.value = 100;
        isGenerating.value = false;
      } else if (msg.type === "error") {
        error.value = msg.message;
        isGenerating.value = false;
      }
    };

    worker.onerror = (e) => {
      error.value = e.message;
      isGenerating.value = false;
    };

    worker.postMessage({ type: "generate", file, options });
  }

  function cancel() {
    worker?.terminate();
    worker = null;
    isGenerating.value = false;
  }

  return { isGenerating, progress, progressPhase, resultUrl, error, generate, cancel };
}
```

**Step 2: Commit**

```bash
git add src/composables/useSeewav.ts
git commit -m "feat: useSeewav composable (worker bridge + reactive state)"
```

---

## Task 9: ColorPicker component

**Files:**
- Create: `src/components/ColorPicker.tsx`

**Step 1: Implement**

```tsx
// src/components/ColorPicker.tsx
import { defineComponent, computed } from "vue";

export default defineComponent({
  name: "ColorPicker",
  props: {
    label: { type: String, required: true },
    modelValue: {
      type: Array as unknown as () => [number, number, number],
      required: true,
    },
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    const hex = computed(() => {
      const [r, g, b] = props.modelValue;
      return (
        "#" +
        [r, g, b]
          .map((v) => Math.round(v * 255).toString(16).padStart(2, "0"))
          .join("")
      );
    });

    function onInput(e: Event) {
      const val = (e.target as HTMLInputElement).value;
      emit("update:modelValue", [
        parseInt(val.slice(1, 3), 16) / 255,
        parseInt(val.slice(3, 5), 16) / 255,
        parseInt(val.slice(5, 7), 16) / 255,
      ] as [number, number, number]);
    }

    return () => (
      <label class="color-picker">
        <span>{props.label}</span>
        <input type="color" value={hex.value} onInput={onInput} />
      </label>
    );
  },
});
```

**Step 2: Commit**

```bash
git add src/components/ColorPicker.tsx
git commit -m "feat: ColorPicker component"
```

---

## Task 10: AudioUpload component

**Files:**
- Create: `src/components/AudioUpload.tsx`

**Step 1: Implement**

```tsx
// src/components/AudioUpload.tsx
import { defineComponent, ref } from "vue";

const ACCEPTED = ".mp3,.wav,.ogg,.flac,.aac,.m4a,audio/*";

export default defineComponent({
  name: "AudioUpload",
  emits: ["file"],
  setup(_, { emit }) {
    const dragging = ref(false);
    const fileName = ref<string | null>(null);

    function handleFile(file: File) {
      fileName.value = file.name;
      emit("file", file);
    }

    return () => (
      <div
        class={["audio-upload", dragging.value && "dragging"]}
        onDragover={(e: DragEvent) => { e.preventDefault(); dragging.value = true; }}
        onDragleave={() => { dragging.value = false; }}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          dragging.value = false;
          const f = e.dataTransfer?.files[0];
          if (f) handleFile(f);
        }}
      >
        <input
          type="file"
          accept={ACCEPTED}
          id="audio-input"
          style="display:none"
          onChange={(e: Event) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (f) handleFile(f);
          }}
        />
        <label for="audio-input">
          {fileName.value ? `✔ ${fileName.value}` : "Drop audio file here or click to browse"}
        </label>
        <p class="accepted-formats">Accepts: MP3, WAV, OGG, FLAC, AAC, M4A</p>
      </div>
    );
  },
});
```

**Step 2: Commit**

```bash
git add src/components/AudioUpload.tsx
git commit -m "feat: AudioUpload component with drag-and-drop"
```

---

## Task 11: ProgressBar component

**Files:**
- Create: `src/components/ProgressBar.tsx`

**Step 1: Implement**

```tsx
// src/components/ProgressBar.tsx
import { defineComponent } from "vue";

export default defineComponent({
  name: "ProgressBar",
  props: {
    pct: { type: Number, required: true },
    phase: { type: String as () => "frames" | "encode" | null, default: null },
  },
  setup(props) {
    return () => (
      <div class="progress-bar-wrap" aria-live="polite">
        <div class="progress-bar">
          <div class="progress-bar__fill" style={{ width: `${props.pct}%` }} />
        </div>
        <span class="progress-bar__label">
          {props.phase === "frames" && `Rendering frames… ${props.pct}%`}
          {props.phase === "encode" && `Encoding video… ${props.pct}%`}
          {props.phase === null && props.pct === 100 && "Done!"}
        </span>
      </div>
    );
  },
});
```

**Step 2: Commit**

```bash
git add src/components/ProgressBar.tsx
git commit -m "feat: ProgressBar component"
```

---

## Task 12: ControlPanel + VideoPreview components

**Files:**
- Create: `src/components/ControlPanel.tsx`
- Create: `src/components/VideoPreview.tsx`

**Step 1: ControlPanel**

```tsx
// src/components/ControlPanel.tsx
import { defineComponent, reactive } from "vue";
import ColorPicker from "./ColorPicker";
import type { SeewavOptions } from "../types/seewav";

const DEFAULTS: SeewavOptions = {
  fgColor: [0.03, 0.6, 0.3],
  fgColor2: [0.5, 0.3, 0.6],
  bgColor: [0, 0, 0],
  bars: 50, speed: 4, time: 0.4, oversample: 4, stereo: false,
  width: 480, height: 300, rate: 60, includeAudio: true,
};

export default defineComponent({
  name: "ControlPanel",
  emits: ["options"],
  setup(_, { emit }) {
    const opts = reactive<SeewavOptions>({ ...DEFAULTS });
    const emit_ = () => emit("options", { ...opts });

    return () => (
      <form class="control-panel" onSubmit={(e: Event) => e.preventDefault()}>
        <section>
          <h3>Colors</h3>
          <ColorPicker label="Main color" modelValue={opts.fgColor}
            onUpdate:modelValue={(v: [number,number,number]) => { opts.fgColor = v; emit_(); }} />
          <ColorPicker label="Secondary color" modelValue={opts.fgColor2}
            onUpdate:modelValue={(v: [number,number,number]) => { opts.fgColor2 = v; emit_(); }} />
          <ColorPicker label="Background" modelValue={opts.bgColor}
            onUpdate:modelValue={(v: [number,number,number]) => { opts.bgColor = v; emit_(); }} />
        </section>
        <section>
          <h3>Waveform</h3>
          <label>Bars<input type="number" min="10" max="200" value={opts.bars}
            onInput={(e: Event) => { opts.bars = +(e.target as HTMLInputElement).value; emit_(); }} /></label>
          <label>Speed<input type="range" min="0.5" max="10" step="0.1" value={opts.speed}
            onInput={(e: Event) => { opts.speed = +(e.target as HTMLInputElement).value; emit_(); }} /></label>
          <label>Time window (s)<input type="range" min="0.1" max="2" step="0.05" value={opts.time}
            onInput={(e: Event) => { opts.time = +(e.target as HTMLInputElement).value; emit_(); }} /></label>
          <label>Oversample<input type="range" min="1" max="8" step="0.5" value={opts.oversample}
            onInput={(e: Event) => { opts.oversample = +(e.target as HTMLInputElement).value; emit_(); }} /></label>
          <label>Stereo<input type="checkbox" checked={opts.stereo}
            onChange={(e: Event) => { opts.stereo = (e.target as HTMLInputElement).checked; emit_(); }} /></label>
        </section>
        <section>
          <h3>Video</h3>
          <label>Width<input type="number" min="100" max="3840" value={opts.width}
            onInput={(e: Event) => { opts.width = +(e.target as HTMLInputElement).value; emit_(); }} /></label>
          <label>Height<input type="number" min="100" max="2160" value={opts.height}
            onInput={(e: Event) => { opts.height = +(e.target as HTMLInputElement).value; emit_(); }} /></label>
          <label>Framerate<input type="number" min="10" max="120" value={opts.rate}
            onInput={(e: Event) => { opts.rate = +(e.target as HTMLInputElement).value; emit_(); }} /></label>
          <label>Seek (s)<input type="number" min="0" step="0.1" placeholder="optional"
            onInput={(e: Event) => { const v = (e.target as HTMLInputElement).value; opts.seek = v ? +v : undefined; emit_(); }} /></label>
          <label>Duration (s)<input type="number" min="0.1" step="0.1" placeholder="optional"
            onInput={(e: Event) => { const v = (e.target as HTMLInputElement).value; opts.duration = v ? +v : undefined; emit_(); }} /></label>
        </section>
        <section>
          <h3>Export</h3>
          <label>Include audio<input type="checkbox" checked={opts.includeAudio}
            onChange={(e: Event) => { opts.includeAudio = (e.target as HTMLInputElement).checked; emit_(); }} /></label>
        </section>
      </form>
    );
  },
});
```

**Step 2: VideoPreview**

```tsx
// src/components/VideoPreview.tsx
import { defineComponent } from "vue";

export default defineComponent({
  name: "VideoPreview",
  props: { url: { type: String, default: null } },
  setup(props) {
    function download() {
      if (!props.url) return;
      const a = document.createElement("a");
      a.href = props.url;
      a.download = "seewav-output.mp4";
      a.click();
    }
    return () => (
      <div class="video-preview">
        {props.url && (
          <>
            <video src={props.url} controls playsinline style="max-width:100%" />
            <button class="download-btn" onClick={download}>Download MP4</button>
          </>
        )}
      </div>
    );
  },
});
```

**Step 3: Commit**

```bash
git add src/components/ControlPanel.tsx src/components/VideoPreview.tsx
git commit -m "feat: ControlPanel and VideoPreview components"
```

---

## Task 13: App root + styles + COOP/COEP server

**Files:**
- Create: `src/App.tsx`
- Create: `src/main.tsx`
- Create: `src/style.css`
- Modify: `server.ts`

**Step 1: App.tsx**

```tsx
// src/App.tsx
import { defineComponent, ref } from "vue";
import AudioUpload from "./components/AudioUpload";
import ControlPanel from "./components/ControlPanel";
import ProgressBar from "./components/ProgressBar";
import VideoPreview from "./components/VideoPreview";
import { useSeewav } from "./composables/useSeewav";
import type { SeewavOptions } from "./types/seewav";

export default defineComponent({
  name: "App",
  setup() {
    const { isGenerating, progress, progressPhase, resultUrl, error, generate } = useSeewav();
    const audioFile = ref<File | null>(null);
    const options = ref<SeewavOptions | null>(null);

    return () => (
      <div class="app">
        <header>
          <h1>seewav</h1>
          <p>Audio waveform visualizer — runs entirely in your browser</p>
        </header>
        <main>
          <AudioUpload onFile={(f: File) => { audioFile.value = f; }} />
          <ControlPanel onOptions={(o: SeewavOptions) => { options.value = o; }} />
          {error.value && <p class="error">{error.value}</p>}
          {isGenerating.value && (
            <ProgressBar pct={progress.value} phase={progressPhase.value} />
          )}
          <button
            class="generate-btn"
            disabled={!audioFile.value || isGenerating.value}
            onClick={() => {
              if (audioFile.value && options.value) generate(audioFile.value, options.value);
            }}
          >
            {isGenerating.value ? "Generating…" : "Generate"}
          </button>
          <VideoPreview url={resultUrl.value} />
        </main>
      </div>
    );
  },
});
```

**Step 2: main.tsx**

```tsx
// src/main.tsx
import { createApp } from "vue";
import App from "./App";
createApp(App).mount("#app");
```

**Step 3: Update server.ts with COOP/COEP middleware**

```ts
// server.ts
// SharedArrayBuffer (required by @ffmpeg/ffmpeg multi-thread WASM) needs:
//   Cross-Origin-Opener-Policy: same-origin
//   Cross-Origin-Embedder-Policy: require-corp

const COOP_COEP = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

Bun.serve({
  port: 5173,
  development: { hmr: true, console: true },
  async fetch(req) {
    const url = new URL(req.url);
    // Serve index.html with security headers for root and SPA routes
    if (url.pathname === "/" || !url.pathname.includes(".")) {
      return new Response(await Bun.file("index.html").text(), {
        headers: { "Content-Type": "text/html; charset=utf-8", ...COOP_COEP },
      });
    }
    // Serve static assets from the project root
    const filePath = "." + url.pathname;
    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file, { headers: COOP_COEP });
    }
    return new Response("Not Found", { status: 404 });
  },
});

console.log("Dev server → http://localhost:5173");
```

**Step 4: style.css**

```css
/* src/style.css */
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; background: #111; color: #eee; }
.app { max-width: 720px; margin: 0 auto; padding: 1rem; }
header h1 { font-size: 2rem; margin-bottom: 0.25rem; }
.audio-upload { border: 2px dashed #444; border-radius: 8px; padding: 2rem; text-align: center; cursor: pointer; margin-bottom: 1rem; }
.audio-upload.dragging { border-color: #0af; background: #001820; }
.accepted-formats { font-size: 0.8rem; color: #888; margin: 0.5rem 0 0; }
.control-panel section { margin-bottom: 1.25rem; }
.control-panel h3 { margin: 0 0 0.5rem; font-size: 0.9rem; text-transform: uppercase; color: #aaa; }
.control-panel label { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.4rem; font-size: 0.9rem; }
.control-panel input[type="number"], .control-panel input[type="range"] { flex: 1; }
.color-picker { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.4rem; }
.generate-btn { display: block; width: 100%; padding: 0.75rem; font-size: 1rem; background: #0af; color: #000; border: none; border-radius: 6px; cursor: pointer; margin: 1rem 0; font-weight: 600; }
.generate-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.download-btn { display: block; width: 100%; margin-top: 0.75rem; padding: 0.6rem 1.5rem; background: #0c6; color: #000; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; }
.progress-bar-wrap { margin: 0.75rem 0; }
.progress-bar { height: 8px; background: #333; border-radius: 4px; overflow: hidden; }
.progress-bar__fill { height: 100%; background: #0af; transition: width 0.25s ease; }
.progress-bar__label { font-size: 0.85rem; color: #aaa; display: block; margin-top: 0.25rem; }
.error { color: #f55; background: #200; padding: 0.5rem 0.75rem; border-radius: 4px; }
.video-preview { margin-top: 1rem; }
.video-preview video { width: 100%; border-radius: 6px; }
```

**Step 5: Verify dev server starts**

```bash
bun server.ts
```
Expected: `Dev server → http://localhost:5173` printed, no errors.

**Step 6: Commit**

```bash
git add src/App.tsx src/main.tsx src/style.css server.ts
git commit -m "feat: App root, entry point, styles, COOP/COEP dev server"
```

---

## Task 14: Playwright E2E tests

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/seewav.spec.ts`
- Create: `e2e/fixtures/` *(generate short test tone below)*

**Step 1: Generate a 3-second test MP3 (requires local ffmpeg)**

```bash
mkdir -p e2e/fixtures
ffmpeg -f lavfi -i "sine=frequency=440:duration=3" -ar 44100 e2e/fixtures/short.mp3
```

**Step 2: playwright.config.ts**

```ts
// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  timeout: 120_000,
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chrome-desktop",  use: { ...devices["Desktop Chrome"] } },
    { name: "firefox-desktop", use: { ...devices["Desktop Firefox"] } },
    { name: "safari-desktop",  use: { ...devices["Desktop Safari"] } },
    { name: "chrome-mobile",   use: { ...devices["Pixel 7"] } },
    { name: "firefox-mobile",  use: { ...devices["Moto G4"] } },
    { name: "safari-mobile",   use: { ...devices["iPhone 15"] } },
  ],
  webServer: {
    command: "bun server.ts",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
  },
});
```

**Step 3: e2e/seewav.spec.ts**

```ts
// e2e/seewav.spec.ts
import { test, expect } from "@playwright/test";
import path from "path";
import { statSync } from "fs";

const FIXTURE = path.join(__dirname, "fixtures/short.mp3");

test.describe("seewav waveform generator", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("page loads — generate button disabled without file", async ({ page }) => {
    await expect(page.getByRole("button", { name: /generate/i })).toBeDisabled();
  });

  test("uploading audio enables generate button", async ({ page }) => {
    await page.locator('input[type="file"]').setInputFiles(FIXTURE);
    await expect(page.getByRole("button", { name: /generate/i })).toBeEnabled();
  });

  test("full pipeline: upload → generate → download MP4", async ({ page }) => {
    await page.locator('input[type="file"]').setInputFiles(FIXTURE);
    await page.getByRole("button", { name: /generate/i }).click();

    await expect(page.locator(".progress-bar-wrap")).toBeVisible({ timeout: 5_000 });

    await expect(
      page.getByRole("button", { name: /download mp4/i })
    ).toBeVisible({ timeout: 120_000 });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /download mp4/i }).click(),
    ]);

    expect(download.suggestedFilename()).toBe("seewav-output.mp4");
    const savedPath = await download.path();
    expect(savedPath).not.toBeNull();
    expect(statSync(savedPath!).size).toBeGreaterThan(1_000);
  });

  test("WebCodecs on Chrome, ffmpeg.wasm on Firefox/Safari", async ({ page, browserName }) => {
    const hasWebCodecs = await page.evaluate(
      () => typeof (globalThis as any).VideoEncoder !== "undefined"
    );
    if (browserName === "chromium") {
      expect(hasWebCodecs).toBe(true);
    } else {
      expect(hasWebCodecs).toBe(false);
    }
  });
});
```

**Step 4: Install Playwright browsers**

```bash
bunx playwright install --with-deps
```

**Step 5: Run E2E tests**

```bash
bunx playwright test
```
Expected: 24 tests (4 tests × 6 projects) pass.

**Step 6: Commit**

```bash
git add playwright.config.ts e2e/
git commit -m "test: E2E for Chrome/Firefox/Safari × desktop/mobile (6 Playwright projects)"
```

---

## Task 15: Final verification

**Step 1: Run all unit tests**

```bash
bun test
```
Expected: all unit tests pass (dsp, draw, encode, worker magic bytes)

**Step 2: Run E2E suite**

```bash
bunx playwright test
```
Expected: 24/24 pass

**Step 3: Final commit**

```bash
git add -A
git commit -m "chore: all tests passing — seewav-wasm complete"
```

---

## Quick Reference

| Command | Purpose |
|---|---|
| `bun server.ts` | Start dev server (port 5173, COOP/COEP headers) |
| `bun test` | Run unit + integration tests |
| `bunx playwright test` | Full E2E suite (all 6 browser/device configs) |
| `bunx playwright test --project=chrome-desktop` | Single project |
| `bunx playwright show-report` | View last E2E HTML report |

## Known Limitations

1. **Sample rate hard-coded to 44100 Hz** — parse actual SR from ffmpeg.wasm log events for correct support of 48 kHz / 22 050 Hz files.
2. **WebCodecs path has no audio track** — Chrome builds produce silent MP4. The ffmpeg.wasm path correctly muxes audio. Audio muxing for WebCodecs requires extracting AAC from ffmpeg.wasm and passing it to `mp4-muxer`.
3. **COOP/COEP for production** — Cloudflare Pages: add a `public/_headers` file. Netlify: `netlify.toml` with `[[headers]]`. Vercel: `vercel.json` `headers` array.
