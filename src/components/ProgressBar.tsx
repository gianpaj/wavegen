import { defineComponent } from "vue";

export default defineComponent({
  name: "ProgressBar",
  props: {
    pct: { type: Number, required: true },
    phase: { type: String as () => "frames" | "encode" | null, default: null },
  },
  setup(props) {
    return () => (
      <div class="progress-bar-wrap" aria-live="polite">
        <div class="progress-bar">
          <div class="progress-bar__fill" style={{ width: `${props.pct}%` }} />
        </div>
        <span class="progress-bar__label">
          {props.phase === "frames" && `Rendering frames… ${props.pct}%`}
          {props.phase === "encode" && `Encoding video… ${props.pct}%`}
          {props.phase === null && props.pct === 100 && "Done!"}
        </span>
      </div>
    );
  },
});
