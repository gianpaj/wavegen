import { describe, test, expect } from "bun:test";
import { sigmoid, interpole, envelope } from "./dsp";

describe("sigmoid", () => {
  test("sigmoid(0) === 0.5", () => { expect(sigmoid(0)).toBeCloseTo(0.5, 5); });
  test("sigmoid large positive → ~1", () => { expect(sigmoid(100)).toBeCloseTo(1, 5); });
  test("sigmoid large negative → ~0", () => { expect(sigmoid(-100)).toBeCloseTo(0, 5); });
});

describe("interpole", () => {
  test("midpoint", () => { expect(interpole(0, 0, 10, 100, 5)).toBeCloseTo(50, 5); });
  test("at x1 returns y1", () => { expect(interpole(2, 10, 8, 40, 2)).toBeCloseTo(10, 5); });
  test("at x2 returns y2", () => { expect(interpole(2, 10, 8, 40, 8)).toBeCloseTo(40, 5); });
});

describe("envelope", () => {
  test("output length matches stride count", () => {
    const wav = new Float32Array(100).fill(1);
    const out = envelope(wav, 10, 5);
    expect(out.length).toBe(18);
  });
  test("all-ones input → positive output values in (0, 1)", () => {
    const wav = new Float32Array(200).fill(1);
    const out = envelope(wav, 20, 10);
    for (const v of out) { expect(v).toBeGreaterThan(0); expect(v).toBeLessThan(1); }
  });
  test("all-zeros input → output near 0", () => {
    const wav = new Float32Array(200).fill(0);
    const out = envelope(wav, 20, 10);
    for (const v of out) { expect(v).toBeCloseTo(0, 3); }
  });
});
