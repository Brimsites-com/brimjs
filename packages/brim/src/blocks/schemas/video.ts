// Settings of the "video" block: the video and how it plays. Its size, shape, tint and fades are the site's CSS.
import type { BlockDefinition } from "../types.ts";

export const video: BlockDefinition = {
  type: "video",
  label: "Video",
  description: "A video from YouTube, Vimeo, a file or a stream; the site sizes it",
  schema: {
    fieldsets: [
      { id: "video_source", title: "Video", fields: ["url", "posterUrl"] },
      { id: "video_playback", title: "Playback", fields: ["autoplay", "loop", "muted", "controls"] },
    ],
    properties: {
      url: {
        title: "Video",
        type: "string",
        widget: "video",
        posterField: "posterUrl",
        description: "Upload, select from gallery, or paste a video/YouTube URL",
      },
      posterUrl: {
        title: "Video Poster",
        type: "string",
        widget: "image",
        description: "Fallback image shown while video loads. Auto-filled from uploaded videos when empty.",
        showWhen: { isYouTube: false },
      },
      isYouTube: {
        title: "Is YouTube",
        type: "boolean",
        widget: "hidden",
        default: false,
      },
      autoplay: {
        title: "Autoplay",
        type: "boolean",
        widget: "checkbox",
        default: false,
        description: "Plays silently.",
      },
      loop: { title: "Loop", type: "boolean", widget: "checkbox", default: false },
      muted: { title: "Muted", type: "boolean", widget: "checkbox", default: true },
      controls: { title: "Controls", type: "boolean", widget: "checkbox", default: true },
    },
  },
  defaults: {
    "@type": "video",
    presetId: "default-theme",
    url: "",
    posterUrl: "",
    isYouTube: false,
    autoplay: false,
    loop: false,
    muted: true,
    controls: true,
  },
};
