export type NormalizeVideoResult = {
  file: File;
  via: "original" | "ffmpeg-wasm" | "server";
};

export type VideoNormalizeAdapter = {
  name: "ffmpeg-wasm" | "server";
  normalize: (file: File) => Promise<File | null>;
};

type FfmpegInstance = {
  writeFile: (path: string, data: Uint8Array) => Promise<void>;
  exec: (args: string[]) => Promise<void>;
  readFile: (path: string) => Promise<Uint8Array | ArrayBuffer>;
  load: (config: { coreURL: string; wasmURL: string }) => Promise<void>;
};

type FfmpegModule = { FFmpeg: new () => FfmpegInstance };
type FfmpegUtilModule = { fetchFile: (file: File) => Promise<Uint8Array> };

class ServerNormalizeAdapter implements VideoNormalizeAdapter {
  name = "server" as const;

  async normalize(file: File): Promise<File | null> {
    const endpoint = process.env.NEXT_PUBLIC_VIDEO_NORMALIZE_ENDPOINT;
    if (!endpoint) return null;

    const body = new FormData();
    body.append("file", file);

    let res: Response;
    try {
      res = await fetch(endpoint, { method: "POST", body });
    } catch (e) {
      console.warn("[normalize] server unreachable:", e);
      return null;
    }

    if (!res.ok) {
      let detail = `status=${res.status}`;
      try {
        const err = (await res.json()) as { error?: string; message?: string };
        detail = `status=${res.status} code=${err.error ?? "?"} message=${err.message ?? ""}`;
      } catch {
        // body not JSON; keep status-only detail
      }
      console.warn(`[normalize] server rejected: ${detail}`);
      return null;
    }

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

  async normalize(file: File): Promise<File | null> {
    await this.ensureLoaded();
    if (!this.ffmpeg || !this.fetchFile) return null;

    // Preserve the input extension so ffmpeg can auto-detect the demuxer.
    const ext = (file.name.match(/\.([^.]+)$/)?.[1] ?? "bin").toLowerCase();
    const inputName = `input.${ext}`;
    const outputName = "output.mp4";

    await this.ffmpeg.writeFile(inputName, await this.fetchFile(file));
    await this.ffmpeg.exec([
      "-i",
      inputName,
      "-c:v",
      "libx264",
      "-profile:v",
      "main",
      "-pix_fmt",
      "yuv420p",
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-y",
      outputName,
    ]);

    const data = await this.ffmpeg.readFile(outputName);
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);

    const copied = new Uint8Array(bytes.byteLength);
    copied.set(bytes);

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

/**
 * Probe whether the browser can decode this file natively by loading its
 * metadata into a detached <video>. Resolves quickly for playable files and
 * times out for formats like AVI/MKV/WMV/FLV so we can route them through
 * the normalize pipeline.
 */
function canBrowserPlay(file: File, timeoutMs = 1500): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);
  if (file.type) {
    const probe = document.createElement("video");
    if (probe.canPlayType(file.type) === "") return Promise.resolve(false);
  }

  const url = URL.createObjectURL(file);
  return new Promise<boolean>((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;

    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute("src");
      try {
        video.load();
      } catch {}
      URL.revokeObjectURL(url);
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    video.onloadedmetadata = () => {
      clearTimeout(timer);
      cleanup();
      resolve(true);
    };
    video.onerror = () => {
      clearTimeout(timer);
      cleanup();
      resolve(false);
    };
    video.src = url;
  });
}

export async function normalizeVideoFile(file: File): Promise<NormalizeVideoResult> {
  if (await canBrowserPlay(file)) {
    return { file, via: "original" };
  }

  const adapters: VideoNormalizeAdapter[] = [
    new ServerNormalizeAdapter(),
    new FfmpegWasmNormalizeAdapter(),
  ];

  for (const adapter of adapters) {
    try {
      const normalized = await adapter.normalize(file);
      if (!normalized) continue;
      return {
        file: normalized,
        via: adapter.name,
      };
    } catch (e) {
      console.warn(`[normalize] ${adapter.name} threw:`, e);
    }
  }

  return { file, via: "original" };
}
