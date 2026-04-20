import type { Frame, MediaSource } from "./types";

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

export function inferMediaKind(file: File): "image" | "video" | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

export async function readMedia(file: File): Promise<MediaSource> {
  const kind = inferMediaKind(file);
  if (!kind) throw new Error(`Unsupported file type: ${file.type || "unknown"}`);
  const url = URL.createObjectURL(file);
  if (kind === "image") {
    const img = await loadImage(url);
    return {
      id: uid(),
      kind,
      name: file.name,
      url,
      width: img.naturalWidth,
      height: img.naturalHeight,
    };
  }
  const meta = await loadVideoMeta(url);
  return {
    id: uid(),
    kind,
    name: file.name,
    url,
    width: meta.width,
    height: meta.height,
    duration: meta.duration,
  };
}

/** Image becomes a single frame so the rest of the pipeline is unified. */
export async function frameFromImage(media: MediaSource): Promise<Frame> {
  if (media.kind !== "image") throw new Error("frameFromImage expects an image");
  const img = await loadImage(media.url);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  ctx.drawImage(img, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("failed to encode image frame");
  return {
    id: uid(),
    mediaId: media.id,
    url: URL.createObjectURL(blob),
    width: img.naturalWidth,
    height: img.naturalHeight,
    label: media.name,
  };
}

export type ExtractOptions = {
  /** Timestamps in seconds. */
  times: number[];
  /** Output JPEG quality 0..1. */
  quality?: number;
  onProgress?: (done: number, total: number) => void;
};

/**
 * Decode the video once and walk to each requested timestamp, emitting a
 * Frame per seek. Object URLs returned here are owned by the caller.
 */
export async function extractFrames(
  media: MediaSource,
  opts: ExtractOptions,
): Promise<Frame[]> {
  if (media.kind !== "video") throw new Error("extractFrames expects a video");
  const { times, quality = 0.92, onProgress } = opts;
  const video = document.createElement("video");
  video.src = media.url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";

  await once(video, "loadeddata");

  const w = video.videoWidth;
  const h = video.videoHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");

  const frames: Frame[] = [];
  for (let i = 0; i < times.length; i++) {
    const t = clamp(times[i], 0, (media.duration ?? video.duration) - 0.001);
    video.currentTime = t;
    await once(video, "seeked");
    ctx.drawImage(video, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (!blob) continue;
    frames.push({
      id: uid(),
      mediaId: media.id,
      url: URL.createObjectURL(blob),
      width: w,
      height: h,
      timestamp: t,
      label: `${formatTime(t)}`,
    });
    onProgress?.(i + 1, times.length);
  }

  video.removeAttribute("src");
  video.load();
  return frames;
}

export function evenlySpacedTimes(duration: number, count: number): number[] {
  if (count <= 0 || duration <= 0) return [];
  if (count === 1) return [duration / 2];
  const step = duration / (count + 1);
  return Array.from({ length: count }, (_, i) => step * (i + 1));
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = url;
  });
}

function loadVideoMeta(
  url: string,
): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () =>
      resolve({
        width: v.videoWidth,
        height: v.videoHeight,
        duration: v.duration,
      });
    v.onerror = () => reject(new Error("video metadata load failed"));
    v.src = url;
  });
}

function once(el: HTMLElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => {
      el.removeEventListener(event, ok);
      el.removeEventListener("error", err);
      resolve();
    };
    const err = () => {
      el.removeEventListener(event, ok);
      el.removeEventListener("error", err);
      reject(new Error(`${event} failed`));
    };
    el.addEventListener(event, ok, { once: true });
    el.addEventListener("error", err, { once: true });
  });
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
