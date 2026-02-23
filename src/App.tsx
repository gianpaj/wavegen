import { defineComponent, ref } from "vue";
import AudioUpload from "./components/AudioUpload";
import ControlPanel from "./components/ControlPanel";
import ProgressBar from "./components/ProgressBar";
import VideoPreview from "./components/VideoPreview";
import { useSeewav } from "./composables/useSeewav";
import type { SeewavOptions } from "./types/seewav";

const DEFAULT_OPTIONS: SeewavOptions = {
  fgColor: [0.03, 0.6, 0.3],
  fgColor2: [0.5, 0.3, 0.6],
  bgColor: [0, 0, 0],
  bars: 50, speed: 4, time: 0.4, oversample: 4, stereo: false,
  width: 480, height: 300, rate: 60, includeAudio: true,
};

export default defineComponent({
  name: "App",
  setup() {
    const { isGenerating, progress, progressPhase, resultUrl, error, generate } = useSeewav();
    const audioFile = ref<File | null>(null);
    const options = ref<SeewavOptions>({ ...DEFAULT_OPTIONS });

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
              if (audioFile.value) generate(audioFile.value, options.value);
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
