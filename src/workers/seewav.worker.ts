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
    // Use locally hosted core files and the ffmpeg worker script so the app
    // works offline and doesn't depend on unpkg.com.  The server copies these
    // files into /dist/ffmpeg/ at startup.
    const base = new URL("/dist/ffmpeg/", self.location.href).href;
    await ffmpeg.load({
      classWorkerURL: base + "worker.js",
      coreURL: base + "ffmpeg-core.js",
      wasmURL: base + "ffmpeg-core.wasm",
    });
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
  await ffmpeg.writeFile("input", await fetchFile(file));

  // ffmpeg["exec"] is @ffmpeg/ffmpeg library method, NOT child_process
  const decodeArgs = ["-i", "input"];
  if (opts.seek != null) decodeArgs.push("-ss", String(opts.seek));
  if (opts.duration != null) decodeArgs.push("-t", String(opts.duration));
  decodeArgs.push("-ac", "2", "-f", "f32le", "-acodec", "pcm_f32le", "pcm.raw");
  await ffmpeg["exec"](decodeArgs);

  const rawData = await ffmpeg.readFile("pcm.raw") as Uint8Array;
  const pcm = new Float32Array(rawData.buffer);

  const sr = 44100;
  const numSamples = pcm.length / 2;

  const ch0 = new Float32Array(numSamples);
  const ch1 = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    ch0[i] = pcm[i * 2];
    ch1[i] = pcm[i * 2 + 1];
  }

  const wavs: Float32Array[] = opts.stereo ? [ch0, ch1] : [mixDown(ch0, ch1)];
  for (let i = 0; i < wavs.length; i++) {
    const std = stddev(wavs[i]);
    if (std > 0) {
      const w = wavs[i];
      for (let j = 0; j < w.length; j++) w[j] /= std;
    }
  }

  const windowSamples = Math.floor((sr * opts.time) / opts.bars);
  const stride = Math.floor(windowSamples / opts.oversample);
  const rawEnvs = wavs.map((w) => envelope(w, windowSamples, stride));
  const envs = buildFrameEnvs(rawEnvs, opts.bars);

  const durationSec = numSamples / sr;
  const frames = Math.floor(opts.rate * durationSec);
  const smooth = hanning(opts.bars);
  const fgColors: Array<[number, number, number]> = [opts.fgColor, opts.fgColor2];

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
      self.postMessage({ type: "progress", phase: "frames", pct: Math.round((idx / frames) * 80) } satisfies WorkerOutMessage);
    }
  }

  if (supportsWebCodecs()) {
    return encodeWebCodecs(pngBlobs, opts, file);
  }
  return encodeWithFFmpeg(pngBlobs, opts, file);
}

async function encodeWithFFmpeg(pngBlobs: Blob[], opts: SeewavOptions, audioFile: File): Promise<ArrayBuffer> {
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

async function encodeWebCodecs(pngBlobs: Blob[], opts: SeewavOptions, audioFile: File): Promise<ArrayBuffer> {
  // Step 1: encode video frames with WebCodecs into a video-only MP4
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
      self.postMessage({ type: "progress", phase: "encode", pct: 80 + Math.round((i / pngBlobs.length) * 15) } satisfies WorkerOutMessage);
    }
  }
  await encoder.flush();
  muxer.finalize();

  if (!opts.includeAudio) return target.buffer;

  // Step 2: mux audio into the video-only MP4 using ffmpeg.wasm (already loaded).
  // -c:v copy avoids re-encoding the video track.
  self.postMessage({ type: "progress", phase: "encode", pct: 96 } satisfies WorkerOutMessage);
  await ffmpeg.writeFile("video_only.mp4", new Uint8Array(target.buffer));
  await ffmpeg.writeFile("audio_in", await fetchFile(audioFile));

  const muxArgs = ["-y", "-i", "video_only.mp4", "-i", "audio_in"];
  if (opts.seek != null) muxArgs.push("-ss", String(opts.seek));
  if (opts.duration != null) muxArgs.push("-t", String(opts.duration));
  muxArgs.push("-c:v", "copy", "-c:a", "aac", "-shortest", "out_final.mp4");

  await ffmpeg["exec"](muxArgs);

  const outData = await ffmpeg.readFile("out_final.mp4") as Uint8Array;
  return outData.buffer;
}

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
  for (let i = 0; i < n; i++) out[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return out;
}
