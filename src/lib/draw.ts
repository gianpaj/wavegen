export function buildFrameEnvs(envs: Float64Array[], bars: number): Float64Array[] {
  return envs.map((env) => {
    const pre = Math.floor(bars / 2);
    const post = 2 * bars;
    const result = new Float64Array(env.length + pre + post);
    result.set(env, pre);
    return result;
  });
}

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
      ctx.beginPath(); ctx.moveTo(x, midrule - half); ctx.lineTo(x, midrule); ctx.stroke();
      const [r, g, b] = fgColors[i];
      ctx.strokeStyle = `rgba(${r255(r)},${r255(g)},${r255(b)},0.8)`;
      ctx.beginPath(); ctx.moveTo(x, midrule); ctx.lineTo(x, midrule + 0.9 * half); ctx.stroke();
    }
  }
}

function rgbCss([r, g, b]: [number, number, number]): string {
  return `rgb(${r255(r)},${r255(g)},${r255(b)})`;
}
function r255(v: number): number { return Math.round(v * 255); }
