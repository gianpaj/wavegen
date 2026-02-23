import { describe, test, expect } from "bun:test";
import { supportsWebCodecs } from "./encode";

describe("supportsWebCodecs", () => {
  test("returns false when VideoEncoder is not defined", () => {
    expect(supportsWebCodecs()).toBe(false);
  });
  test("returns true when VideoEncoder is defined", () => {
    (globalThis as any).VideoEncoder = class {};
    expect(supportsWebCodecs()).toBe(true);
    delete (globalThis as any).VideoEncoder;
  });
});
