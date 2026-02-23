import { describe, test, expect } from "bun:test";

function isMp4(buffer: ArrayBuffer): boolean {
  const view = new Uint8Array(buffer);
  return view[4] === 0x66 && view[5] === 0x74 && view[6] === 0x79 && view[7] === 0x70;
}

describe("isMp4 magic bytes checker", () => {
  test("correctly identifies ftyp box", () => {
    const buf = new ArrayBuffer(16);
    const view = new Uint8Array(buf);
    view[4] = 0x66; view[5] = 0x74; view[6] = 0x79; view[7] = 0x70;
    expect(isMp4(buf)).toBe(true);
  });
  test("rejects non-MP4 buffer", () => {
    expect(isMp4(new ArrayBuffer(16))).toBe(false);
  });
});
