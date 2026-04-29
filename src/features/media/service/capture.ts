import type { Frame } from "@/features/frames/types";
import type { MediaSource } from "../types";
import { normalizeVideoFile, type NormalizeOptions } from "./normalize";

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

export type VideoSprite = {
  url: string;
  width: number;
  height: number;
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  timestamps: number[];
};

export function inferMediaKind(file: File): "image" | "video" | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

export async function readMedia(
  file: File,
  opts?: NormalizeOptions,
): Promise<MediaSource> {
  const kind = inferMediaKind(file);
  if (!kind) throw new Error(`Unsupported file type: ${file.type || "unknown"}`);

  if (kind === "image") {
    const url = URL.createObjectURL(file);
    const img = await loadImage(url);
    return {
      id: uid(),
      kind,
      name: file.name,
      url,
      width: img.naturalWidth,
      height: img.naturalHeight,
      file,
      originalFile: file,
      ingestVia: "original",
    };
  }

  const normalized = await normalizeVideoFile(file, opts);
  const sourceFile = normalized.file;
  const url = URL.createObjectURL(sourceFile);

  try {
    const meta = await loadVideoMeta(url);
    return {
      id: uid(),
      kind,
      name: file.name,
      url,
      width: meta.width,
      height: meta.height,
      duration: meta.duration,
      file: sourceFile,
      originalFile: file,
      ingestVia: normalized.via,
    };
  } catch {
    URL.revokeObjectURL(url);
    const typeHint = file.type || "unknown";
    throw new Error(`video metadata load failed (${typeHint})` + (normalized.via !== "original" ? ` after ${normalized.via}` : ""));
  }
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

export async function buildVideoSprite(
  media: MediaSource,
  opts?: {
    maxFrames?: number;
    thumbWidth?: number;
    quality?: number;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<VideoSprite> {
  if (media.kind !== "video") throw new Error("buildVideoSprite expects a video");
  const maxFrames = Math.max(8, opts?.maxFrames ?? 60);
  const thumbWidth = Math.max(80, opts?.thumbWidth ?? 160);
  const quality = opts?.quality ?? 0.82;

  const video = document.createElement("video");
  video.src = media.url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  await once(video, "loadeddata");

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const duration = media.duration ?? video.duration;
  const thumbHeight = Math.round((thumbWidth * vh) / vw);

  const rawTimes =
    (await getKeyframeTimesByWorker(media.file, duration, maxFrames)) ??
    evenlySpacedTimes(duration, maxFrames);
  const timestamps = dedupeAndClampTimes(rawTimes, duration, maxFrames);

  const columns = Math.max(1, Math.ceil(Math.sqrt(timestamps.length)));
  const rows = Math.max(1, Math.ceil(timestamps.length / columns));

  const canvas = document.createElement("canvas");
  canvas.width = columns * thumbWidth;
  canvas.height = rows * thumbHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");

  for (let i = 0; i < timestamps.length; i++) {
    const t = clamp(timestamps[i], 0, duration - 0.001);
    video.currentTime = t;
    await once(video, "seeked");
    const col = i % columns;
    const row = Math.floor(i / columns);
    ctx.drawImage(video, col * thumbWidth, row * thumbHeight, thumbWidth, thumbHeight);
    opts?.onProgress?.(i + 1, timestamps.length);
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) throw new Error("sprite encode failed");

  video.removeAttribute("src");
  video.load();

  return {
    url: URL.createObjectURL(blob),
    width: canvas.width,
    height: canvas.height,
    columns,
    rows,
    cellWidth: thumbWidth,
    cellHeight: thumbHeight,
    timestamps,
  };
}

export async function captureFrameFromVideoElement(
  media: MediaSource,
  video: HTMLVideoElement,
  quality = 0.92,
): Promise<Frame | null> {
  if (media.kind !== "video") return null;

  await waitForRenderedFrame(video);

  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, w, h);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) return null;

  const t = clamp(video.currentTime, 0, Math.max(0, (media.duration ?? Infinity) - 0.001));
  return {
    id: uid(),
    mediaId: media.id,
    url: URL.createObjectURL(blob),
    width: w,
    height: h,
    timestamp: t,
    label: `${formatTime(t)}`,
  };
}

/**
 * Estimate the playback fps of a loaded video element via
 * `requestVideoFrameCallback`. Samples a handful of frames (driving a brief
 * mute play→pause to keep the decoder producing) then returns the median
 * inverse-mediaTime delta, snapped to a common standard rate within ±2%.
 *
 * Resolves to null when the API is unavailable or the sample times out.
 */
export async function estimateVideoFps(
  video: HTMLVideoElement,
  opts: { samples?: number; timeoutMs?: number } = {},
): Promise<number | null> {
  type RVFCMeta = { mediaTime: number };
  type RVFC = (cb: (now: number, meta: RVFCMeta) => void) => number;
  const rvfc = (video as unknown as { requestVideoFrameCallback?: RVFC })
    .requestVideoFrameCallback;
  if (typeof rvfc !== "function") return null;

  const samples = opts.samples ?? 12;
  const timeoutMs = opts.timeoutMs ?? 1500;

  const wasPaused = video.paused;
  const startTime = video.currentTime;
  const times: number[] = [];

  const collected = await new Promise<number[]>((resolve) => {
    let done = false;
    const finish = (out: number[]) => {
      if (done) return;
      done = true;
      resolve(out);
    };
    const timer = window.setTimeout(() => finish(times.slice()), timeoutMs);

    const tick = (_now: number, meta: RVFCMeta) => {
      if (done) return;
      times.push(meta.mediaTime);
      if (times.length >= samples) {
        window.clearTimeout(timer);
        finish(times.slice());
        return;
      }
      rvfc.call(video, tick);
    };
    rvfc.call(video, tick);
    void video.play().catch(() => {});
  });

  if (!wasPaused) {
    // Caller had it playing; leave it playing.
  } else {
    video.pause();
    try {
      video.currentTime = startTime;
    } catch {
      /* ignore */
    }
  }

  if (collected.length < 4) return null;
  const deltas: number[] = [];
  for (let i = 1; i < collected.length; i++) {
    const d = collected[i] - collected[i - 1];
    if (d > 0 && d < 1) deltas.push(d);
  }
  if (deltas.length === 0) return null;
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)];
  const raw = 1 / median;

  for (const cand of [23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 120]) {
    if (Math.abs(raw - cand) / cand < 0.02) return cand;
  }
  return Math.round(raw * 1000) / 1000;
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

async function waitForRenderedFrame(video: HTMLVideoElement): Promise<void> {
  if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) {
    await new Promise<void>((resolve) => {
      const id = video.requestVideoFrameCallback(() => resolve());
      setTimeout(() => {
        video.cancelVideoFrameCallback(id);
        resolve();
      }, 120);
    });
    return;
  }
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function getKeyframeTimesByWorker(
  file: File | undefined,
  duration: number,
  maxFrames: number,
): Promise<number[] | null> {
  if (!file || typeof Worker === "undefined") return Promise.resolve(null);

  return new Promise((resolve) => {
    const worker = new Worker("/workers/sprite-worker.js");
    let settled = false;

    const done = (result: number[] | null) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      resolve(result);
    };

    worker.onmessage = (e: MessageEvent<{ ok: boolean; times?: number[] }>) => {
      if (!e.data?.ok || !Array.isArray(e.data.times)) {
        done(null);
        return;
      }
      done(e.data.times);
    };

    worker.onerror = () => done(null);
    worker.postMessage({ file, duration, maxFrames });
    setTimeout(() => done(null), 5000);
  });
}

function dedupeAndClampTimes(times: number[], duration: number, maxFrames: number) {
  const unique = Array.from(
    new Set(
      times
        .map((t) => clamp(Number(t), 0, Math.max(0, duration - 0.001)))
        .filter((t) => Number.isFinite(t)),
    ),
  ).sort((a, b) => a - b);

  if (unique.length === 0) return evenlySpacedTimes(duration, maxFrames);
  if (unique.length <= maxFrames) return unique;

  const step = unique.length / maxFrames;
  return Array.from({ length: maxFrames }, (_, i) => unique[Math.floor(i * step)]);
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
