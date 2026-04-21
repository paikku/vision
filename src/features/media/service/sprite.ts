/** Sprite sheet generated from a video URL. One row of tiles from left→right. */
export type SpriteSheet = {
  url: string;      // blob URL of the composite JPEG
  tileW: number;
  tileH: number;
  count: number;    // total tiles
  duration: number; // video duration these tiles cover
};

export type SpriteGenOptions = {
  /** Max tiles to generate. Capped at 120 for canvas safety. Default 100. */
  maxTiles?: number;
  /** Tile width in px. Height is derived from video aspect ratio. Default 160. */
  tileW?: number;
  /** JPEG quality 0..1. Default 0.72 (thumbnails don't need high quality). */
  quality?: number;
  onProgress?: (done: number, total: number) => void;
};

/**
 * Seeks through the video and composites a single-row sprite sheet.
 * Returns a blob URL owned by the caller (caller must revoke when done).
 *
 * Runs on the main thread but yields to RAF every 8 seeks to keep
 * the UI responsive.
 */
export async function generateSpriteSheet(
  videoUrl: string,
  opts: SpriteGenOptions = {},
): Promise<SpriteSheet> {
  const { maxTiles = 100, tileW: requestedTileW = 160, quality = 0.72, onProgress } =
    opts;

  const video = document.createElement("video");
  video.src = videoUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";

  await waitForEvent(video, "loadeddata");

  const duration = video.duration;
  const ar = video.videoWidth / video.videoHeight || 16 / 9;
  const tileW = requestedTileW;
  const tileH = Math.round(tileW / ar);
  // Cap so the canvas width stays under 16 384 px (browser limit)
  const count = Math.min(maxTiles, Math.floor(16000 / tileW), Math.max(1, Math.ceil(duration)));

  // Single-row canvas: easy to draw tiles linearly
  const canvas = document.createElement("canvas");
  canvas.width = count * tileW;
  canvas.height = tileH;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#0a0c10";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < count; i++) {
    // Spread tiles evenly across the full duration
    const t = count === 1 ? 0 : (i / (count - 1)) * duration;
    seekVideo(video, Math.min(t, duration - 0.05));
    await waitForEvent(video, "seeked");
    ctx.drawImage(video, i * tileW, 0, tileW, tileH);
    onProgress?.(i + 1, count);
    // Yield every 8 frames so the browser can paint
    if (i % 8 === 7) await raf();
  }

  const blob = await canvasToBlob(canvas, "image/jpeg", quality);

  // Let the browser GC the decode buffers
  video.removeAttribute("src");
  video.load();

  return { url: URL.createObjectURL(blob), tileW, tileH, count, duration };
}

/** Given a SpriteSheet and a video time, return the CSS background-* values
 *  to show just that tile at 2× size in a preview box. */
export function spriteTileStyle(
  sprite: SpriteSheet,
  time: number,
  scale = 2,
): React.CSSProperties {
  const idx = Math.round(
    clamp(time / sprite.duration, 0, 1) * (sprite.count - 1),
  );
  return {
    backgroundImage: `url(${sprite.url})`,
    backgroundPosition: `-${idx * sprite.tileW * scale}px 0`,
    backgroundSize: `${sprite.count * sprite.tileW * scale}px ${sprite.tileH * scale}px`,
    backgroundRepeat: "no-repeat",
    width: sprite.tileW * scale,
    height: sprite.tileH * scale,
  };
}

// ─── helpers ────────────────────────────────────────────────────────────────

function seekVideo(video: HTMLVideoElement, t: number) {
  // fastSeek (Firefox/Safari) snaps to nearest keyframe — much faster for thumbnails.
  const v = video as HTMLVideoElement & { fastSeek?: (t: number) => void };
  if (v.fastSeek) v.fastSeek(t);
  else v.currentTime = t;
}

function waitForEvent(el: HTMLElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => { cleanup(); resolve(); };
    const err = () => { cleanup(); reject(new Error(`${event} failed`)); };
    const cleanup = () => {
      el.removeEventListener(event, ok);
      el.removeEventListener("error", err);
    };
    el.addEventListener(event, ok, { once: true });
    el.addEventListener("error", err, { once: true });
  });
}

function raf(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      type,
      quality,
    ),
  );
}

function clamp(v: number, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}
