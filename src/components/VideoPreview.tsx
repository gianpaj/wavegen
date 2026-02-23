import { defineComponent } from "vue";

export default defineComponent({
  name: "VideoPreview",
  props: { url: { type: String, default: null } },
  setup(props) {
    function download() {
      if (!props.url) return;
      const a = document.createElement("a");
      a.href = props.url;
      a.download = "seewav-output.mp4";
      a.click();
    }
    return () => (
      <div class="video-preview">
        {props.url && (
          <>
            <video src={props.url} controls playsinline style="max-width:100%" />
            <button class="download-btn" onClick={download}>Download MP4</button>
          </>
        )}
      </div>
    );
  },
});
