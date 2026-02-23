export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function interpole(x1: number, y1: number, x2: number, y2: number, x: number): number {
  return y1 + (y2 - y1) * (x - x1) / (x2 - x1);
}

export function envelope(wav: Float32Array, window: number, stride: number): Float64Array {
  const half = Math.floor(window / 2);
  const padded = new Float32Array(wav.length + 2 * half);
  padded.set(wav, half);
  const out: number[] = [];
  for (let off = 0; off < padded.length - window - 2 * half; off += stride) {
    let sum = 0;
    for (let i = off; i < off + window; i++) sum += Math.max(padded[i], 0);
    out.push(sum / window);
  }
  const result = new Float64Array(out.length);
  for (let i = 0; i < out.length; i++) {
    result[i] = 1.9 * (sigmoid(2.5 * out[i]) - 0.5);
  }
  return result;
}
