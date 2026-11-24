import { useCallback, useEffect, useRef, useState } from "react";
import { type UploadedVideo, type VideoStatus, api, loadSiteInfo } from "./api.ts";
import { tusUpload } from "./tus.ts";

type Stage =
  | { name: "idle" }
  | { name: "uploading"; file: string; percent: number }
  | { name: "processing"; file: string; percent: number };

const POLL_MS = 2500;
/** A status that cannot be read is asked for again this many times before giving up. */
const POLL_FAILURES = 5;

/** Whether the site has a video host. Asked once per editor session. */
function useVideoUploads(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let current = true;
    void loadSiteInfo().then((info) => current && setEnabled((info.capabilities ?? []).includes("video-uploads")));
    return () => {
      current = false;
    };
  }, []);
  return enabled;
}

/** A file's size as people read it: "3.4 MB". */
function readableSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${unit === 0 || value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });

/**
 * Uploads a video file to the site's video host and hands back where it plays. The file goes from the browser
 * straight to the host, piece by piece; the site only asks the host where to send it and when it is ready.
 * Renders nothing on a site without a video host: there the address is pasted.
 */
/**
 * Uploads a video to the site's video host and waits until it can be played: the one way the editor uploads videos
 * (a video block's settings). `onStage` tells the upload's progress, then the processing's.
 */
export async function uploadVideo(
  file: File,
  onStage: (stage: "uploading" | "processing", percent: number) => void,
  signal: AbortSignal,
): Promise<{ url: string; posterUrl: string | null } | undefined> {
  const ticket = await api.createVideo({ name: file.name, size: file.size, type: file.type });
  if (ticket.upload.protocol !== "tus")
    throw new Error("This site's video host uses an upload method Brim does not know.");
  await tusUpload(file, ticket.upload, {
    signal,
    onProgress: (sent, total) => onStage("uploading", Math.floor((sent / total) * 100)),
  });
  let failures = 0;
  let asked = false;
  let status: VideoStatus | undefined;
  while (status?.status !== "ready") {
    onStage("processing", Math.round(status?.progress ?? 0));
    await sleep(asked ? POLL_MS : 0, signal);
    asked = true;
    try {
      status = await api.videoStatus(ticket.id);
      failures = 0;
    } catch (failure) {
      if (++failures > POLL_FAILURES) throw failure;
    }
    if (signal.aborted) return undefined;
    if (status?.status === "failed") throw new Error("The video could not be processed. Try another file.");
  }
  return { url: status.url || ticket.url, posterUrl: status.posterUrl ?? ticket.posterUrl ?? null };
}

export function VideoUpload({ onUploaded }: { onUploaded: (url: string, posterUrl: string | null) => void }) {
  const enabled = useVideoUploads();
  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const running = useRef<AbortController | null>(null);
  const [videos, setVideos] = useState<UploadedVideo[]>([]);
  const [deleting, setDeleting] = useState("");
  const mounted = useRef(true);

  // The videos already on the host. A host that does not list them, or a list that cannot be read, shows nothing:
  // uploading works without it.
  const refresh = useCallback(async (): Promise<void> => {
    const list = await api.listVideos().catch(() => undefined);
    if (mounted.current) setVideos(list?.supported ? list.videos : []);
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (enabled) void refresh();
    return () => {
      mounted.current = false;
    };
  }, [enabled, refresh]);

  // Leaving the block's settings stops an upload that is still going.
  useEffect(() => () => running.current?.abort(), []);

  if (!enabled) return null;

  async function start(file: File | undefined): Promise<void> {
    if (!file || running.current) return;
    if (!file.type.startsWith("video/")) return setError("Choose a video file.");
    const controller = new AbortController();
    running.current = controller;
    setError("");
    setStage({ name: "uploading", file: file.name, percent: 0 });
    try {
      const video = await uploadVideo(
        file,
        (name, percent) =>
          setStage(name === "uploading" ? { name, file: file.name, percent } : { name, file: file.name, percent }),
        controller.signal,
      );
      if (video) onUploaded(video.url, video.posterUrl);
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure instanceof Error && failure.message ? failure.message : "Could not upload the video.");
      }
    } finally {
      if (running.current === controller) running.current = null;
      if (mounted.current) setStage({ name: "idle" });
      // Also after a failure or a cancel: the host may already hold the video, and the list is where it can be deleted.
      void refresh();
    }
  }

  async function remove(video: UploadedVideo): Promise<void> {
    if (deleting || !window.confirm("Delete this video? Pages that show it will stop playing it.")) return;
    setError("");
    setDeleting(video.id);
    try {
      await api.deleteVideo(video.id);
    } catch (failure) {
      if (mounted.current) {
        setError(failure instanceof Error && failure.message ? failure.message : "Could not delete the video.");
      }
    }
    if (mounted.current) setDeleting("");
    await refresh();
  }

  const busy = stage.name !== "idle";

  return (
    <div className="field-group">
      <div
        className="video-upload"
        data-over={over}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          void start(event.dataTransfer.files[0]);
        }}
      >
        {busy ? (
          <>
            <p className="video-upload__status" role="status">
              {stage.name === "uploading" ? `Uploading… ${stage.percent}%` : `Processing… ${stage.percent}%`}
              <small>{stage.file}</small>
            </p>
            <progress className="video-upload__bar" max={100} value={stage.percent} />
            <p className="field-description">Keep these settings open until the video is ready.</p>
            <button type="button" className="btn-remove" onClick={() => running.current?.abort()}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn-upload" onClick={() => fileInput.current?.click()}>
              Upload video
            </button>
            <p className="field-description">Or drop a video file here.</p>
          </>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="video/*"
          hidden
          onChange={(event) => {
            void start(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {videos.length > 0 && (
        <div className="video-list">
          <p className="video-list__title">Uploaded videos</p>
          <ul>
            {videos.map((video) => (
              <li key={video.id}>
                <span className="video-list__name" title={video.name}>
                  {video.name || "Untitled video"}
                  <small>
                    {readableSize(video.size)}
                    {video.status === "processing" && " · Processing…"}
                    {video.status === "failed" && " · Could not be processed"}
                  </small>
                </span>
                <button
                  type="button"
                  disabled={video.status !== "ready"}
                  onClick={() => onUploaded(video.url, video.posterUrl)}
                >
                  Use
                </button>
                <button
                  type="button"
                  className="btn-remove"
                  disabled={deleting !== ""}
                  onClick={() => void remove(video)}
                >
                  {deleting === video.id ? "Deleting…" : "Delete"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
