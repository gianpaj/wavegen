import { ref, shallowRef } from "vue";
import type { SeewavOptions, WorkerOutMessage } from "../types/seewav";

export function useSeewav() {
  const isGenerating = ref(false);
  const progress = ref(0);
  const progressPhase = ref<"frames" | "encode" | null>(null);
  const resultUrl = shallowRef<string | null>(null);
  const error = ref<string | null>(null);

  let worker: Worker | null = null;

  function generate(file: File, options: SeewavOptions) {
    if (isGenerating.value) return;

    if (resultUrl.value) {
      URL.revokeObjectURL(resultUrl.value);
      resultUrl.value = null;
    }
    error.value = null;
    progress.value = 0;
    progressPhase.value = null;
    isGenerating.value = true;

    worker?.terminate();
    worker = new Worker(
      new URL("../workers/seewav.worker.ts", import.meta.url),
      { type: "module" }
    );

    worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        progress.value = msg.pct;
        progressPhase.value = msg.phase;
      } else if (msg.type === "done") {
        resultUrl.value = URL.createObjectURL(
          new Blob([msg.buffer], { type: "video/mp4" })
        );
        progress.value = 100;
        isGenerating.value = false;
      } else if (msg.type === "error") {
        error.value = msg.message;
        isGenerating.value = false;
      }
    };

    worker.onerror = (e) => {
      error.value = e.message;
      isGenerating.value = false;
    };

    worker.postMessage({ type: "generate", file, options });
  }

  function cancel() {
    worker?.terminate();
    worker = null;
    isGenerating.value = false;
  }

  return { isGenerating, progress, progressPhase, resultUrl, error, generate, cancel };
}
