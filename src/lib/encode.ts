export function supportsWebCodecs(): boolean {
  return typeof VideoEncoder !== "undefined";
}
