import { defineComponent, computed } from "vue";

export default defineComponent({
  name: "ColorPicker",
  props: {
    label: { type: String, required: true },
    modelValue: {
      type: Array as unknown as () => [number, number, number],
      required: true,
    },
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    const hex = computed(() => {
      const [r, g, b] = props.modelValue;
      return (
        "#" +
        [r, g, b]
          .map((v) => Math.round(v * 255).toString(16).padStart(2, "0"))
          .join("")
      );
    });

    function onInput(e: Event) {
      const val = (e.target as HTMLInputElement).value;
      emit("update:modelValue", [
        parseInt(val.slice(1, 3), 16) / 255,
        parseInt(val.slice(3, 5), 16) / 255,
        parseInt(val.slice(5, 7), 16) / 255,
      ] as [number, number, number]);
    }

    return () => (
      <label class="color-picker">
        <span>{props.label}</span>
        <input type="color" value={hex.value} onInput={onInput} />
      </label>
    );
  },
});
