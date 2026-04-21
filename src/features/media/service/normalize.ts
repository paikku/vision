export type NormalizeVideoResult = {
  file: File;
  via: "original" | "ffmpeg-wasm" | "server";
};

export type NormalizeVideoOptions = {
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
};

type NormalizeContext = NormalizeVideoOptions;

export type VideoNormalizeAdapter = {
  name: "ffmpeg-wasm" | "server";
  normalize: (file: File, ctx: NormalizeContext) => Promise<File | null>;
};

type FfmpegInstance = {
  writeFile: (path: string, data: Uint8Array) => Promise<void>;
  exec: (args: string[]) => Promise<void>;
  readFile: (path: string) => Promise<Uint8Array | ArrayBuffer>;
  load: (config: { coreURL: string; wasmURL: string }) => Promise<void>;
  on?: (event: "progress", cb: (p: { progress?: number }) => void) => void;
};

type FfmpegModule = { FFmpeg: new () => FfmpegInstance };
type FfmpegUtilModule = { fetchFile: (file: File) => Promise<Uint8Array> };

class ServerNormalizeAdapter implements VideoNormalizeAdapter {
  name = "server" as const;

  async normalize(file: File, ctx: NormalizeContext): Promise<File | null> {
    throwIfAborted(ctx.signal);
    const endpoint = process.env.NEXT_PUBLIC_VIDEO_NORMALIZE_ENDPOINT;
    if (!endpoint) return null;

    const body = new FormData();
    body.append("file", file);

    const res = await fetch(endpoint, { method: "POST", body, signal: ctx.signal });
    if (!res.ok) return null;

    const blob = await res.blob();
    throwIfAborted(ctx.signal);
    ctx.onProgress?.(1);
    return new File([blob], file.name.replace(/\.[^.]+$/, ".mp4"), {
      type: "video/mp4",
      lastModified: Date.now(),
    });
  }
}

class FfmpegWasmNormalizeAdapter implements VideoNormalizeAdapter {
  name = "ffmpeg-wasm" as const;
  private ffmpeg: FfmpegInstance | null = null;
  private fetchFile: ((file: File) => Promise<Uint8Array>) | null = null;

  async normalize(file: File, ctx: NormalizeContext): Promise<File | null> {
    throwIfAborted(ctx.signal);
    await this.ensureLoaded();
    throwIfAborted(ctx.signal);
    if (!this.ffmpeg || !this.fetchFile) return null;

    const ext = inferInputExtension(file);
    const inputName = `input.${ext}`;
    const outputName = "output.mp4";

    ctx.onProgress?.(0.05);
    this.ffmpeg.on?.("progress", ({ progress }) => {
      if (typeof progress !== "number") return;
      const bounded = Math.max(0, Math.min(1, progress));
      ctx.onProgress?.(0.1 + bounded * 0.85);
    });

    await this.ffmpeg.writeFile(inputName, await this.fetchFile(file));
    throwIfAborted(ctx.signal);
    await this.ffmpeg.exec([
      "-i",
      inputName,
      "-c:v",
      "libx264",
      "-profile:v",
      "main",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-y",
      outputName,
    ]);
    throwIfAborted(ctx.signal);

    const data = await this.ffmpeg.readFile(outputName);
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);

    const copied = new Uint8Array(bytes.byteLength);
    copied.set(bytes);
    ctx.onProgress?.(1);

    return new File([copied], file.name.replace(/\.[^.]+$/, ".mp4"), {
      type: "video/mp4",
      lastModified: Date.now(),
    });
  }

  private async ensureLoaded() {
    if (this.ffmpeg && this.fetchFile) return;
    const importFromUrl = (url: string) =>
      Function("u", "return import(u)")(url) as Promise<unknown>;

    const ffmpegMod = (await importFromUrl(
      "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm/index.js",
    )) as FfmpegModule;
    const utilMod = (await importFromUrl(
      "https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/dist/esm/index.js",
    )) as FfmpegUtilModule;

    const ffmpeg = new ffmpegMod.FFmpeg();
    await ffmpeg.load({
      coreURL: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js",
      wasmURL: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm",
    });

    this.ffmpeg = ffmpeg;
    this.fetchFile = utilMod.fetchFile;
  }
}

export async function normalizeVideoFile(file: File): Promise<NormalizeVideoResult> {
  return normalizeVideoFileWithOptions(file, {});
}

export async function normalizeVideoFileWithOptions(
  file: File,
  opts: NormalizeVideoOptions,
): Promise<NormalizeVideoResult> {
  throwIfAborted(opts.signal);
  const needsNormalize = await shouldNormalize(file, opts.signal);
  if (!needsNormalize) {
    return { file, via: "original" };
  }

  const adapters: VideoNormalizeAdapter[] = [
    new ServerNormalizeAdapter(),
    new FfmpegWasmNormalizeAdapter(),
  ];

  for (const adapter of adapters) {
    try {
      const normalized = await adapter.normalize(file, opts);
      if (!normalized) continue;
      return {
        file: normalized,
        via: adapter.name,
      };
    } catch {
      // try next adapter
    }
  }

  return { file, via: "original" };
}

async function shouldNormalize(file: File, signal?: AbortSignal): Promise<boolean> {
  if (!file.type.startsWith("video/")) return false;
  const ext = inferInputExtension(file);
  const transcodeFirstExt = new Set([
    "avi",
    "mkv",
    "wmv",
    "flv",
    "mpg",
    "mpeg",
    "ts",
    "m2ts",
    "3gp",
  ]);
  if (transcodeFirstExt.has(ext)) return true;
  if (!canLikelyPlayType(file.type)) return true;
  const canPlay = await canBrowserPlayFile(file, signal);
  return !canPlay;
}

function canLikelyPlayType(type: string): boolean {
  if (!type) return false;
  const v = document.createElement("video");
  return v.canPlayType(type) !== "";
}

function canBrowserPlayFile(file: File, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }

    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const url = URL.createObjectURL(file);
    let done = false;

    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
      resolve(ok);
    };

    video.onloadedmetadata = () => finish(true);
    video.onerror = () => finish(false);
    const timer = setTimeout(() => finish(false), 2200);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        finish(false);
      },
      { once: true },
    );
    video.src = url;
  });
}

function inferInputExtension(file: File): string {
  const byName = file.name.split(".").pop()?.toLowerCase() ?? "";
  const cleaned = byName.replace(/[^a-z0-9]/g, "");
  if (cleaned) return cleaned;
  if (file.type === "video/quicktime") return "mov";
  if (file.type === "video/webm") return "webm";
  if (file.type === "video/mp4") return "mp4";
  return "bin";
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw new DOMException("Aborted", "AbortError");
}
