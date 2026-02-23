import { defineComponent, ref } from "vue";
import AudioUpload from "./components/AudioUpload";
import ControlPanel from "./components/ControlPanel";
import ProgressBar from "./components/ProgressBar";
import VideoPreview from "./components/VideoPreview";
import { useSeewav } from "./composables/useSeewav";
import type { SeewavOptions } from "./types/seewav";

export default defineComponent({
  name: "App",
  setup() {
    const { isGenerating, progress, progressPhase, resultUrl, error, generate } = useSeewav();
    const audioFile = ref<File | null>(null);
    const options = ref<SeewavOptions | null>(null);

    return () => (
      <div class="app">
        <header>
          <h1>seewav</h1>
          <p>Audio waveform visualizer — runs entirely in your browser</p>
        </header>
        <main>
          <AudioUpload onFile={(f: File) => { audioFile.value = f; }} />
          <ControlPanel onOptions={(o: SeewavOptions) => { options.value = o; }} />
          {error.value && <p class="error">{error.value}</p>}
          {isGenerating.value && (
            <ProgressBar pct={progress.value} phase={progressPhase.value} />
          )}
          <button
            class="generate-btn"
            disabled={!audioFile.value || isGenerating.value}
            onClick={() => {
              if (audioFile.value && options.value) generate(audioFile.value, options.value);
            }}
          >
            {isGenerating.value ? "Generating…" : "Generate"}
          </button>
          <VideoPreview url={resultUrl.value} />
        </main>
      </div>
    );
  },
});
