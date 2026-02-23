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
