export type NormalizeVideoResult = {
  file: File;
  via: "original" | "ffmpeg-wasm" | "server";
};

export type NormalizeVideoOptions = {
  signal?: AbortSignal;
  onProgress?: (ratio: number) => void;
  onStatus?: (status: NormalizeStatus) => void;
};

export type NormalizeStatus =
  | "analyzing"
  | "ready-original"
  | "transcoding-server"
  | "transcoding-ffmpeg";

export type VideoNormalizeAdapter = {
  name: "ffmpeg-wasm" | "server";
  normalize: (file: File, opts?: NormalizeVideoOptions) => Promise<File | null>;
};

type FfmpegInstance = {
  writeFile: (path: string, data: Uint8Array) => Promise<void>;
  exec: (args: string[]) => Promise<void>;
  readFile: (path: string) => Promise<Uint8Array | ArrayBuffer>;
  load: (config: { coreURL: string; wasmURL: string }) => Promise<void>;
  on?: (event: "progress", cb: (payload: { progress: number }) => void) => void;
  off?: (event: "progress", cb: (payload: { progress: number }) => void) => void;
};

type FfmpegModule = { FFmpeg: new () => FfmpegInstance };
type FfmpegUtilModule = { fetchFile: (file: File) => Promise<Uint8Array> };

class ServerNormalizeAdapter implements VideoNormalizeAdapter {
  name = "server" as const;

  async normalize(file: File, opts?: NormalizeVideoOptions): Promise<File | null> {
    throwIfAborted(opts?.signal);
    const endpoint = process.env.NEXT_PUBLIC_VIDEO_NORMALIZE_ENDPOINT;
    if (!endpoint) return null;

    const body = new FormData();
    body.append("file", file);

    const res = await fetch(endpoint, { method: "POST", body, signal: opts?.signal });
    if (!res.ok) return null;

    const blob = await res.blob();
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

  async normalize(file: File, opts?: NormalizeVideoOptions): Promise<File | null> {
    throwIfAborted(opts?.signal);
    await this.ensureLoaded(opts?.signal);
    if (!this.ffmpeg || !this.fetchFile) return null;

    const inputExt = inferFileExtension(file);
    const inputName = inputExt ? `input.${inputExt}` : "input";
    const outputName = "output.mp4";
    const onProgress = (payload: { progress: number }) => {
      opts?.onProgress?.(clamp(payload.progress, 0, 1));
    };

    this.ffmpeg.on?.("progress", onProgress);

    try {
      await this.ffmpeg.writeFile(inputName, await this.fetchFile(file));
      throwIfAborted(opts?.signal);

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
      throwIfAborted(opts?.signal);
    } finally {
      this.ffmpeg.off?.("progress", onProgress);
    }

    const data = await this.ffmpeg.readFile(outputName);
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);

    const copied = new Uint8Array(bytes.byteLength);
    copied.set(bytes);

    return new File([copied], file.name.replace(/\.[^.]+$/, ".mp4"), {
      type: "video/mp4",
      lastModified: Date.now(),
    });
  }

  private async ensureLoaded(signal?: AbortSignal) {
    if (this.ffmpeg && this.fetchFile) return;
    throwIfAborted(signal);

    const importModule = (moduleId: string) =>
      Function("m", "return import(m)")(moduleId) as Promise<unknown>;

    let ffmpegMod: FfmpegModule;
    let utilMod: FfmpegUtilModule;
    try {
      ffmpegMod = (await importModule("@ffmpeg/ffmpeg")) as FfmpegModule;
      utilMod = (await importModule("@ffmpeg/util")) as FfmpegUtilModule;
    } catch {
      const ffmpegModuleUrl =
        process.env.NEXT_PUBLIC_FFMPEG_MODULE_URL ??
        "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm/index.js";
      const ffmpegUtilUrl =
        process.env.NEXT_PUBLIC_FFMPEG_UTIL_URL ??
        "https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/dist/esm/index.js";
      ffmpegMod = (await importModule(ffmpegModuleUrl)) as FfmpegModule;
      utilMod = (await importModule(ffmpegUtilUrl)) as FfmpegUtilModule;
    }
    throwIfAborted(signal);

    const ffmpeg = new ffmpegMod.FFmpeg();
    const coreURL =
      process.env.NEXT_PUBLIC_FFMPEG_CORE_URL ??
      "/vendor/ffmpeg/ffmpeg-core.js";
    const wasmURL =
      process.env.NEXT_PUBLIC_FFMPEG_WASM_URL ??
      "/vendor/ffmpeg/ffmpeg-core.wasm";
    await ffmpeg.load({
      coreURL,
      wasmURL,
    });
    throwIfAborted(signal);

    this.ffmpeg = ffmpeg;
    this.fetchFile = utilMod.fetchFile;
  }
}

export async function normalizeVideoFile(
  file: File,
  opts?: NormalizeVideoOptions,
): Promise<NormalizeVideoResult> {
  opts?.onStatus?.("analyzing");
  const shouldTranscode = await needsVideoTranscode(file, opts?.signal);
  if (!shouldTranscode) {
    opts?.onStatus?.("ready-original");
    return { file, via: "original" };
  }

  const adapters: VideoNormalizeAdapter[] = [
    new ServerNormalizeAdapter(),
    new FfmpegWasmNormalizeAdapter(),
  ];

  for (const adapter of adapters) {
    try {
      opts?.onStatus?.(
        adapter.name === "server" ? "transcoding-server" : "transcoding-ffmpeg",
      );
      const normalized = await adapter.normalize(file, opts);
      if (!normalized) continue;
      return {
        file: normalized,
        via: adapter.name,
      };
    } catch (err) {
      if (isAbortError(err)) throw err;
      // try next adapter
    }
  }

  return { file, via: "original" };
}

async function needsVideoTranscode(file: File, signal?: AbortSignal): Promise<boolean> {
  if (!file.type.startsWith("video/")) return false;
  const ext = inferFileExtension(file);
  const maybeBrowserFriendly = file.type === "video/mp4" || file.type === "video/webm";
  if (maybeBrowserFriendly && (await canBrowserPlay(file, signal))) {
    return false;
  }
  if (ext && NON_TRANSCODE_EXTENSIONS.has(ext) && (await canBrowserPlay(file, signal))) {
    return false;
  }
  return true;
}

const NON_TRANSCODE_EXTENSIONS = new Set(["mp4", "m4v", "webm", "mov", "ogv"]);

function inferFileExtension(file: File): string {
  const parts = file.name.toLowerCase().split(".");
  if (parts.length < 2) return "";
  return parts.at(-1)?.replace(/[^a-z0-9]/g, "") ?? "";
}

async function canBrowserPlay(file: File, signal?: AbortSignal): Promise<boolean> {
  throwIfAborted(signal);

  const quickMimeOk =
    typeof document !== "undefined"
      ? document.createElement("video").canPlayType(file.type).length > 0
      : false;
  if (!quickMimeOk) return false;

  const url = URL.createObjectURL(file);
  try {
    const ok = await new Promise<boolean>((resolve) => {
      const v = document.createElement("video");
      let settled = false;
      const done = (result: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        v.removeAttribute("src");
        v.load();
        resolve(result);
      };
      const timer = setTimeout(() => done(false), 2000);
      v.preload = "metadata";
      v.muted = true;
      v.onloadedmetadata = () => done(true);
      v.onerror = () => done(false);
      if (signal) {
        signal.addEventListener("abort", () => done(false), { once: true });
      }
      v.src = url;
    });
    throwIfAborted(signal);
    return ok;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

function isAbortError(err: unknown) {
  return err instanceof DOMException && err.name === "AbortError";
}

function clamp(value: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, value));
}
