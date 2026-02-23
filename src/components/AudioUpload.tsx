import { defineComponent, ref } from "vue";

const ACCEPTED = ".mp3,.wav,.ogg,.flac,.aac,.m4a,audio/*";

export default defineComponent({
  name: "AudioUpload",
  emits: ["file"],
  setup(_, { emit }) {
    const dragging = ref(false);
    const fileName = ref<string | null>(null);

    function handleFile(file: File) {
      fileName.value = file.name;
      emit("file", file);
    }

    return () => (
      <div
        class={["audio-upload", dragging.value && "dragging"]}
        onDragover={(e: DragEvent) => { e.preventDefault(); dragging.value = true; }}
        onDragleave={() => { dragging.value = false; }}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          dragging.value = false;
          const f = e.dataTransfer?.files[0];
          if (f) handleFile(f);
        }}
      >
        <input
          type="file"
          accept={ACCEPTED}
          id="audio-input"
          style="display:none"
          onChange={(e: Event) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (f) handleFile(f);
          }}
        />
        <label for="audio-input">
          {fileName.value ? `✔ ${fileName.value}` : "Drop audio file here or click to browse"}
        </label>
        <p class="accepted-formats">Accepts: MP3, WAV, OGG, FLAC, AAC, M4A</p>
      </div>
    );
  },
});
