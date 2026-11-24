export type VideoSource =
  | { kind: "embed"; src: string }
  | { kind: "file"; src: string }
  /** An HLS stream (`.m3u8`): played by the browser where it can, otherwise through hls.js. */
  | { kind: "hls"; src: string }
  | { kind: "none" };

const YOUTUBE_ID = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/;
const VIMEO_ID = /vimeo\.com\/(?:video\/)?(\d+)/;

export interface Playback {
  autoplay: boolean;
  loop: boolean;
  muted: boolean;
  controls: boolean;
}

/** Whether an address is played through YouTube or Vimeo rather than as a video file. */
export function isEmbeddedVideo(url: string): boolean {
  return YOUTUBE_ID.test(url) || VIMEO_ID.test(url);
}

/**
 * Works out how to play an address: YouTube and Vimeo links become their embeddable players,
 * an address ending in `.m3u8` is an HLS stream, anything else on the site or the web is a video file.
 */
export function videoSource(url: unknown, playback: Playback): VideoSource {
  if (typeof url !== "string" || url.trim() === "") return { kind: "none" };
  const flag = (on: boolean): string => (on ? "1" : "0");

  const youtube = url.match(YOUTUBE_ID)?.[1];
  if (youtube) {
    const query = new URLSearchParams({
      autoplay: flag(playback.autoplay),
      mute: flag(playback.muted),
      controls: flag(playback.controls),
      loop: flag(playback.loop),
      // YouTube only loops a video that is also its own playlist.
      ...(playback.loop && { playlist: youtube }),
    });
    return { kind: "embed", src: `https://www.youtube-nocookie.com/embed/${youtube}?${query}` };
  }

  const vimeo = url.match(VIMEO_ID)?.[1];
  if (vimeo) {
    const query = new URLSearchParams({
      autoplay: flag(playback.autoplay),
      muted: flag(playback.muted),
      controls: flag(playback.controls),
      loop: flag(playback.loop),
    });
    return { kind: "embed", src: `https://player.vimeo.com/video/${vimeo}?${query}` };
  }

  const isFile = /^https?:\/\//i.test(url) || (url.startsWith("/") && !url.startsWith("//"));
  if (!isFile) return { kind: "none" };
  return isHlsAddress(url) ? { kind: "hls", src: url } : { kind: "file", src: url };
}

/** An address whose path ends in `.m3u8`, whatever comes after `?` or `#`. */
export function isHlsAddress(url: string): boolean {
  return /\.m3u8$/i.test(url.trim().split(/[?#]/, 1)[0] ?? "");
}

/**
 * Which quality of an HLS stream to start on: the smallest one at least as tall as the player on this screen
 * (counting at most two device pixels to one CSS pixel), else the tallest. `-1` when the stream lists none.
 */
export function startLevel(heights: number[], playerHeight: number, pixelRatio: number): number {
  if (heights.length === 0) return -1;
  const wanted = playerHeight * Math.min(Math.max(pixelRatio || 1, 1), 2);
  let best = -1;
  heights.forEach((height, index) => {
    if (height >= wanted && (best === -1 || height < (heights[best] ?? Number.POSITIVE_INFINITY))) best = index;
  });
  return best !== -1 ? best : heights.indexOf(Math.max(...heights));
}
