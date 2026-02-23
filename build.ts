/**
 * Production build script — outputs a self-contained static site to dist/.
 * Used by Cloudflare Pages (and any other static host).
 *
 * Output layout:
 *   dist/
 *     index.html
 *     main.js
 *     style.css
 *     _headers          ← Cloudflare Pages COOP/COEP headers
 *     workers/
 *       seewav.worker.js
 *     ffmpeg/
 *       worker.js
 *       ffmpeg-core.js
 *       (ffmpeg-core.wasm loaded from CDN at runtime — 30.7 MB exceeds CF Pages limit)
 */

import { copyFileSync, mkdirSync } from "fs";

mkdirSync("./dist/ffmpeg", { recursive: true });
mkdirSync("./dist/workers", { recursive: true });

// ── Copy / bundle @ffmpeg/core assets ────────────────────────────────────────
const FFMPEG_ESM  = "./node_modules/@ffmpeg/ffmpeg/dist/esm";
const FFMPEG_CORE = "./node_modules/@ffmpeg/core/dist/esm";

copyFileSync(`${FFMPEG_CORE}/ffmpeg-core.js`,   "./dist/ffmpeg/ffmpeg-core.js");
// ffmpeg-core.wasm (30.7 MB) exceeds Cloudflare Pages' 25 MB file limit.
// It is loaded at runtime from the CDN (see FFMPEG_WASM_URL define below).
try { copyFileSync(`${FFMPEG_CORE}/ffmpeg-core.worker.js`, "./dist/ffmpeg/ffmpeg-core.worker.js"); } catch { /* optional */ }

const ffmpegWorkerBuild = await Bun.build({
  entrypoints: [`${FFMPEG_ESM}/worker.js`],
  outdir: "./dist/ffmpeg",
  naming: "worker.js",
  target: "browser",
  format: "esm",
  splitting: false,
  minify: true,
});
if (!ffmpegWorkerBuild.success) {
  for (const log of ffmpegWorkerBuild.logs) console.error(log);
}

// ── Build main app bundle ─────────────────────────────────────────────────────
const mainBuild = await Bun.build({
  entrypoints: ["./src/main.tsx"],
  outdir: "./dist",
  target: "browser",
  format: "esm",
  splitting: false,
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
});
if (!mainBuild.success) {
  for (const log of mainBuild.logs) console.error(log);
  process.exit(1);
}

// ── Build web worker ──────────────────────────────────────────────────────────
const workerBuild = await Bun.build({
  entrypoints: ["./src/workers/seewav.worker.ts"],
  outdir: "./dist/workers",
  target: "browser",
  format: "esm",
  splitting: false,
  minify: true,
  define: {
    "process.env.NODE_ENV": '"production"',
    "FFMPEG_BASE": '"/ffmpeg/"',
    "FFMPEG_WASM_URL": '"https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm"',
  },
});
if (!workerBuild.success) {
  for (const log of workerBuild.logs) console.error(log);
  process.exit(1);
}

// ── Patch worker URL in main bundle ──────────────────────────────────────────
// In dist/ the root IS the site root, so the worker lives at /workers/…
// (no /dist/ prefix, unlike the dev server).
let mainJs = await Bun.file("./dist/main.js").text();
mainJs = mainJs.replace(
  /new URL\(["']\.\.\/workers\/seewav\.worker\.ts["'],\s*import\.meta\.url\)/g,
  'new URL("/workers/seewav.worker.js", import.meta.url)',
);
await Bun.write("./dist/main.js", mainJs);

// ── Copy stylesheet ───────────────────────────────────────────────────────────
await Bun.write("./dist/style.css", Bun.file("./src/style.css"));

// ── Write index.html ──────────────────────────────────────────────────────────
await Bun.write("./dist/index.html", `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>wavegen — waveform visualizer</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/main.js"></script>
  </body>
</html>`);

// ── Write Cloudflare Pages _headers ───────────────────────────────────────────
// SharedArrayBuffer (used by @ffmpeg/ffmpeg) requires cross-origin isolation.
await Bun.write("./dist/_headers", `/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
`);

console.log("Build complete → dist/");
