export type VideoSourceOptions = {
  readonly autoplay?: boolean;
  readonly createVideo?: () => HTMLVideoElement;
  readonly loop?: boolean;
  readonly muted?: boolean;
  readonly signal?: AbortSignal;
  readonly waitFor?: "metadata" | "frame";
};

export async function loadVideoSource(url: string, options: VideoSourceOptions = {}): Promise<HTMLVideoElement> {
  const video = options.createVideo?.() ?? document.createElement("video");
  const waitFor = options.waitFor ?? "frame";
  video.preload = waitFor === "metadata" ? "metadata" : "auto";
  video.muted = options.muted ?? true;
  video.loop = options.loop ?? false;
  video.playsInline = true;
  video.crossOrigin = "anonymous";

  await new Promise<void>((resolve, reject) => {
    const readyState = waitFor === "metadata" ? 1 : 2;
    const readyEvent = waitFor === "metadata" ? "loadedmetadata" : "loadeddata";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      video.removeEventListener(readyEvent, ready);
      video.removeEventListener("error", failed);
      options.signal?.removeEventListener("abort", aborted);
      if (error) reject(error);
      else resolve();
    };
    const ready = () => finish();
    const failed = () => finish(new Error("The MP4 video could not be decoded by this browser."));
    const aborted = () => finish(new DOMException("Video loading was interrupted.", "AbortError"));

    if (options.signal?.aborted) {
      aborted();
      return;
    }
    video.addEventListener(readyEvent, ready, { once: true });
    video.addEventListener("error", failed, { once: true });
    options.signal?.addEventListener("abort", aborted, { once: true });
    video.src = url;
    video.load();
    if (video.readyState >= readyState) finish();
  }).catch((error) => {
    disposeVideoSource(video);
    throw error;
  });

  if (video.videoWidth <= 0 || video.videoHeight <= 0) {
    disposeVideoSource(video);
    throw new Error("The MP4 video has no readable frame dimensions.");
  }
  if (options.autoplay) void video.play().catch(() => undefined);
  return video;
}

export function disposeVideoSource(video: HTMLVideoElement): void {
  video.pause();
  video.removeAttribute("src");
  video.load();
}

export async function readVideoDimensions(
  blob: Blob,
  options: {
    readonly createObjectUrl?: (blob: Blob) => string;
    readonly createVideo?: () => HTMLVideoElement;
    readonly revokeObjectUrl?: (url: string) => void;
  } = {},
): Promise<{ width: number; height: number }> {
  const createObjectUrl = options.createObjectUrl ?? URL.createObjectURL;
  const revokeObjectUrl = options.revokeObjectUrl ?? URL.revokeObjectURL;
  const url = createObjectUrl(blob);
  let video: HTMLVideoElement | null = null;
  try {
    video = await loadVideoSource(url, { createVideo: options.createVideo, waitFor: "metadata" });
    return { width: video.videoWidth, height: video.videoHeight };
  } finally {
    if (video) disposeVideoSource(video);
    revokeObjectUrl(url);
  }
}
