/**
 * Plays HLS streams (`.m3u8`) in the video block through hls.js, fetched only when such a video is on the page.
 * A browser's own HLS player starts on the first quality the stream lists, often the smallest, so its first
 * seconds are blurry; hls.js starts on the quality that fits the player as it is drawn, and never fetches one
 * larger than it. Where hls.js cannot play (an iPhone has no MediaSource), the `src` already on the element plays
 * by itself. Autoplay, loop, muted, controls and the poster stay the element's own attributes.
 */
import { startLevel } from "./video-source.ts";

const HLS_TYPE = "application/vnd.apple.mpegurl";

async function attach(video: HTMLVideoElement): Promise<void> {
  const source = video.dataset.brimHls;
  if (!source || video.dataset.brimHlsReady !== undefined) return;
  video.dataset.brimHlsReady = "";
  const native = video.canPlayType(HLS_TYPE) !== "";
  if (native && typeof MediaSource === "undefined") return;

  const { default: Hls } = await import("hls.js");
  if (!Hls.isSupported()) return;
  if (native) {
    // The browser's own player has started on the stream, from its smallest quality: hls.js takes over.
    video.removeAttribute("src");
    video.load();
  }
  const player = new Hls({ capLevelToPlayerSize: true });
  player.once(Hls.Events.MANIFEST_PARSED, (_event, data) => {
    const heights = data.levels.map((level) => level.height);
    const level = startLevel(heights, video.getBoundingClientRect().height || 720, window.devicePixelRatio);
    if (level !== -1) player.startLevel = level;
    if (video.autoplay) void video.play().catch(() => undefined);
  });
  player.loadSource(new URL(source, location.href).href);
  player.attachMedia(video);
}

function attachAll(): void {
  for (const video of document.querySelectorAll<HTMLVideoElement>("video[data-brim-hls]")) void attach(video);
}

attachAll();
// Pages swapped in by Astro's view transitions bring new videos without running this file again.
document.addEventListener("astro:page-load", attachAll);
