export interface SeewavOptions {
  fgColor: [number, number, number];
  fgColor2: [number, number, number];
  bgColor: [number, number, number];
  bars: number;
  speed: number;
  time: number;
  oversample: number;
  stereo: boolean;
  width: number;
  height: number;
  rate: number;
  seek?: number;
  duration?: number;
  includeAudio: boolean;
}

export type WorkerInMessage =
  | { type: "generate"; file: File; options: SeewavOptions }

export type WorkerOutMessage =
  | { type: "progress"; phase: "frames" | "encode"; pct: number }
  | { type: "done"; buffer: ArrayBuffer }
  | { type: "error"; message: string }
