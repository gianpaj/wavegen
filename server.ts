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
    if (url.pathname === "/" || !url.pathname.includes(".")) {
      return new Response(await Bun.file("index.html").text(), {
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
