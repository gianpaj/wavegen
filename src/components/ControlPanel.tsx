import { defineComponent, reactive } from "vue";
import ColorPicker from "./ColorPicker";
import type { SeewavOptions } from "../types/seewav";

const DEFAULTS: SeewavOptions = {
  fgColor: [0.03, 0.6, 0.3],
  fgColor2: [0.5, 0.3, 0.6],
  bgColor: [0, 0, 0],
  bars: 50, speed: 4, time: 0.4, oversample: 4, stereo: false,
  width: 480, height: 300, rate: 60, includeAudio: true,
};

export default defineComponent({
  name: "ControlPanel",
  emits: ["options"],
  setup(_, { emit }) {
    const opts = reactive<SeewavOptions>({ ...DEFAULTS });
    const emit_ = () => emit("options", { ...opts });

    return () => (
      <form class="control-panel" onSubmit={(e: Event) => e.preventDefault()}>
        <section>
          <h3>Colors</h3>
          <ColorPicker label="Main color" modelValue={opts.fgColor}
            onUpdate:modelValue={(v: [number,number,number]) => { opts.fgColor = v; emit_(); }} />
          <ColorPicker label="Secondary color" modelValue={opts.fgColor2}
            onUpdate:modelValue={(v: [number,number,number]) => { opts.fgColor2 = v; emit_(); }} />
          <ColorPicker label="Background" modelValue={opts.bgColor}
            onUpdate:modelValue={(v: [number,number,number]) => { opts.bgColor = v; emit_(); }} />
        </section>
        <section>
          <h3>Waveform</h3>
          <label>Bars<input type="number" min="10" max="200" value={opts.bars}
            onInput={(e: Event) => { opts.bars = +(e.target as HTMLInputElement).value; emit_(); }} /></label>
          <label>Speed<input type="range" min="0.5" max="10" step="0.1" value={opts.speed}
            onInput={(e: Event) => { opts.speed = +(e.target as HTMLInputElement).value; emit_(); }} /></label>
          <label>Time window (s)<input type="range" min="0.1" max="2" step="0.05" value={opts.time}
            onInput={(e: Event) => { opts.time = +(e.target as HTMLInputElement).value; emit_(); }} /></label>
          <label>Oversample<input type="range" min="1" max="8" step="0.5" value={opts.oversample}
            onInput={(e: Event) => { opts.oversample = +(e.target as HTMLInputElement).value; emit_(); }} /></label>
          <label>Stereo<input type="checkbox" checked={opts.stereo}
            onChange={(e: Event) => { opts.stereo = (e.target as HTMLInputElement).checked; emit_(); }} /></label>
        </section>
        <section>
          <h3>Video</h3>
          <label>Width<input type="number" min="100" max="3840" value={opts.width}
            onInput={(e: Event) => { opts.width = +(e.target as HTMLInputElement).value; emit_(); }} /></label>
          <label>Height<input type="number" min="100" max="2160" value={opts.height}
            onInput={(e: Event) => { opts.height = +(e.target as HTMLInputElement).value; emit_(); }} /></label>
          <label>Framerate<input type="number" min="10" max="120" value={opts.rate}
            onInput={(e: Event) => { opts.rate = +(e.target as HTMLInputElement).value; emit_(); }} /></label>
          <label>Seek (s)<input type="number" min="0" step="0.1" placeholder="optional"
            onInput={(e: Event) => { const v = (e.target as HTMLInputElement).value; opts.seek = v ? +v : undefined; emit_(); }} /></label>
          <label>Duration (s)<input type="number" min="0.1" step="0.1" placeholder="optional"
            onInput={(e: Event) => { const v = (e.target as HTMLInputElement).value; opts.duration = v ? +v : undefined; emit_(); }} /></label>
        </section>
        <section>
          <h3>Export</h3>
          <label>Include audio<input type="checkbox" checked={opts.includeAudio}
            onChange={(e: Event) => { opts.includeAudio = (e.target as HTMLInputElement).checked; emit_(); }} /></label>
        </section>
      </form>
    );
  },
});
