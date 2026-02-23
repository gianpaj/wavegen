# wavegen

Generate animated waveform MP4 videos from audio files — entirely in the browser.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> [!NOTE]  
> Most of the code was written Claude Code.
> See [docs/plans/2026-02-23-seewav-wasm.md](docs/plans/2026-02-23-seewav-wasm.md) for initial plan and design doc [docs/plans/2026-02-23-seewav-wasm-design.md](docs/plans/2026-02-23-seewav-wasm-design.md)


## About

wavegen is a browser-based port of [seewav](https://github.com/adefossez/seewav). Upload an audio file, customize the look, and export a waveform animation video — no server, no installs, no data leaves your machine.

It uses WebCodecs (Chrome/Firefox) for fast H.264 encoding with ffmpeg.wasm as a fallback for Safari and older browsers.

## Features

- Accepts MP3, WAV, OGG, FLAC, AAC, M4A
- Customizable foreground, secondary, and background colors
- Adjustable bar count, speed, video dimensions
- Stereo waveform support
- Seek and duration clipping
- Export with or without audio
- WebCodecs on Chrome/Firefox; ffmpeg.wasm fallback for Safari

## Getting started

```bash
bun install
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Requirements

- [Bun](https://bun.sh) >= 1.0

## Build

```bash
bun run build
```

Output goes to `dist/`. The `dist/_headers` file sets the required `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers needed for `SharedArrayBuffer` (used by ffmpeg.wasm).

## Deployment

### Cloudflare Pages

```toml
# wrangler.toml
pages_build_output_dir = "dist"
```

Deploy with:

```bash
npx wrangler pages deploy dist
```

### GitHub Pages / any static host

The `dist/_headers` file works on Netlify and Cloudflare Pages. For GitHub Pages or nginx, configure COOP/COEP headers at the server level:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## Tests

```bash
# Unit tests
bun test

# E2E tests (requires Playwright browsers)
bun x playwright install
bun x playwright test
```

E2E tests run against Chrome, Firefox, and Safari on desktop and mobile (6 projects).

## Known limitations

- ffmpeg.wasm downloads ~30 MB of WASM on first use
- Safari requires the ffmpeg.wasm path (no WebCodecs H.264 encoder)
- Mobile encoding is slow for long audio files

## Credits

Based on [seewav](https://github.com/adefossez/seewav) by Alexandre Défossez.

Uses [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) and [mp4-muxer](https://github.com/Vanilagy/mp4-muxer).

## License

MIT
