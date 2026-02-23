// SharedArrayBuffer (required by @ffmpeg/ffmpeg multi-thread WASM) needs:
//   Cross-Origin-Opener-Policy: same-origin
//   Cross-Origin-Embedder-Policy: require-corp

import { copyFileSync, mkdirSync } from "fs";

const COOP_COEP = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

// ─── Copy static ffmpeg assets into dist/ffmpeg/ ─────────────────────────────
// @ffmpeg/ffmpeg's FFmpeg class spawns a sub-worker whose URL must be served
// by the same origin.  We copy both the worker shim and the core WASM here so
// they are available under /dist/ffmpeg/.
mkdirSync("./dist/ffmpeg", { recursive: true });

const FFMPEG_ESM  = "./node_modules/@ffmpeg/ffmpeg/dist/esm";
const FFMPEG_CORE = "./node_modules/@ffmpeg/core/dist/esm";

copyFileSync(`${FFMPEG_ESM}/worker.js`,            "./dist/ffmpeg/worker.js");
copyFileSync(`${FFMPEG_CORE}/ffmpeg-core.js`,      "./dist/ffmpeg/ffmpeg-core.js");
copyFileSync(`${FFMPEG_CORE}/ffmpeg-core.wasm`,    "./dist/ffmpeg/ffmpeg-core.wasm");

// Some builds also ship a threaded worker shim; copy it if present.
try {
  copyFileSync(`${FFMPEG_CORE}/ffmpeg-core.worker.js`, "./dist/ffmpeg/ffmpeg-core.worker.js");
} catch { /* optional */ }

// ─── Build main app bundle ────────────────────────────────────────────────────
const mainBuild = await Bun.build({
  entrypoints: ["./src/main.tsx"],
  outdir: "./dist",
  target: "browser",
  format: "esm",
  splitting: false,
  sourcemap: "inline",
  define: {
    "process.env.NODE_ENV": JSON.stringify("development"),
  },
});

if (!mainBuild.success) {
  for (const log of mainBuild.logs) console.error(log);
  process.exit(1);
}

// ─── Build worker bundle ──────────────────────────────────────────────────────
const workerBuild = await Bun.build({
  entrypoints: ["./src/workers/seewav.worker.ts"],
  outdir: "./dist/workers",
  target: "browser",
  format: "esm",
  splitting: false,
  sourcemap: "inline",
  define: {
    "process.env.NODE_ENV": JSON.stringify("development"),
  },
});

if (!workerBuild.success) {
  for (const log of workerBuild.logs) console.error(log);
  process.exit(1);
}

// ─── Patch main bundle: fix worker URL ───────────────────────────────────────
const mainJsPath = "./dist/main.js";
let mainJs = await Bun.file(mainJsPath).text();
mainJs = mainJs.replace(
  /new URL\(["']\.\.\/workers\/seewav\.worker\.ts["'],\s*import\.meta\.url\)/g,
  'new URL("/dist/workers/seewav.worker.js", import.meta.url)'
);
await Bun.write(mainJsPath, mainJs);

// ─── Patch worker bundle: fix relative imports inside @ffmpeg/ffmpeg/worker.js─
// The copied worker.js uses relative ESM imports like "./const.js".
// We need to make those absolute so they resolve correctly when served from
// /dist/ffmpeg/worker.js.  The simplest approach: rewrite the worker to use
// importScripts-style or inline the dependencies.  Here we create a wrapper
// that sets up the necessary globals and re-exports.
// Actually @ffmpeg/ffmpeg's worker.js uses bare ESM imports so we need to
// bundle it too.
const ffmpegWorkerBuild = await Bun.build({
  entrypoints: ["./node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js"],
  outdir: "./dist/ffmpeg",
  naming: "worker.js",
  target: "browser",
  format: "esm",
  splitting: false,
  sourcemap: "inline",
  define: {
    "process.env.NODE_ENV": JSON.stringify("development"),
  },
});

if (!ffmpegWorkerBuild.success) {
  for (const log of ffmpegWorkerBuild.logs) console.error(log);
  // Don't exit — the copy above may work if it's self-contained
}

// ─── HTML served for all routes ───────────────────────────────────────────────
const DIST_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>seewav — waveform visualizer</title>
    <link rel="stylesheet" href="/src/style.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/dist/main.js"></script>
  </body>
</html>`;

Bun.serve({
  port: 5173,
  development: false,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/" || !url.pathname.includes(".")) {
      return new Response(DIST_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8", ...COOP_COEP },
      });
    }
    const filePath = "." + url.pathname;
    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file, { headers: COOP_COEP });
    }
    return new Response("Not Found", { status: 404 });
  },
});

console.log("Dev server → http://localhost:5173");
