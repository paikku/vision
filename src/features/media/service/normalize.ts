export type NormalizeVideoResult = {
  file: File;
  via: "original" | "ffmpeg-wasm" | "server";
};

/**
 * Phases reported while normalizing a video.
 *
 * - `uploading`: bytes are being sent to the normalize endpoint (client → server).
 * - `decoding`: server has received the upload and is transcoding. No progress
 *   number unless the backend supports it (see BACKEND_REQUIREMENTS.md).
 * - `downloading`: server is streaming the normalized MP4 back to the client.
 * - `local`: ffmpeg.wasm fallback running in the browser; indeterminate.
 */
export type NormalizePhase =
  | "uploading"
  | "decoding"
  | "downloading"
  | "local";

export type NormalizeProgress = {
  phase: NormalizePhase;
  /** 0..1 when known; `undefined` for indeterminate phases. */
  progress?: number;
  /** Which adapter is producing the progress events. */
  via: "server" | "ffmpeg-wasm";
};

export type NormalizeOptions = {
  onProgress?: (p: NormalizeProgress) => void;
  signal?: AbortSignal;
};

export type VideoNormalizeAdapter = {
  name: "ffmpeg-wasm" | "server";
  normalize: (file: File, opts?: NormalizeOptions) => Promise<File | null>;
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

  async normalize(file: File, opts?: NormalizeOptions): Promise<File | null> {
    const endpoint = process.env.NEXT_PUBLIC_VIDEO_NORMALIZE_ENDPOINT;
    if (!endpoint) return null;

    return new Promise<File | null>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", endpoint);
      xhr.responseType = "blob";

      const emit = (phase: NormalizePhase, progress?: number) =>
        opts?.onProgress?.({ phase, progress, via: "server" });

      emit("uploading", 0);

      xhr.upload.onprogress = (e) => {
        emit(
          "uploading",
          e.lengthComputable ? e.loaded / e.total : undefined,
        );
      };
      // Upload finished; server is now working. Without backend-side
      // progress reporting we can't know how long this takes — show an
      // indeterminate "decoding" phase until the response body starts.
      xhr.upload.onload = () => emit("decoding");

      xhr.onprogress = (e) => {
        emit(
          "downloading",
          e.lengthComputable ? e.loaded / e.total : undefined,
        );
      };

      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          resolve(null);
          return;
        }
        const blob = xhr.response as Blob | null;
        if (!blob) {
          resolve(null);
          return;
        }
        resolve(
          new File([blob], file.name.replace(/\.[^.]+$/, ".mp4"), {
            type: "video/mp4",
            lastModified: Date.now(),
          }),
        );
      };
      xhr.onerror = () => resolve(null);
      xhr.onabort = () => resolve(null);
      xhr.ontimeout = () => resolve(null);

      opts?.signal?.addEventListener("abort", () => xhr.abort(), {
        once: true,
      });

      const body = new FormData();
      body.append("file", file);
      xhr.send(body);
    });
  }
}

class FfmpegWasmNormalizeAdapter implements VideoNormalizeAdapter {
  name = "ffmpeg-wasm" as const;
  private ffmpeg: FfmpegInstance | null = null;
  private fetchFile: ((file: File) => Promise<Uint8Array>) | null = null;

  async normalize(
    file: File,
    opts?: NormalizeOptions,
  ): Promise<File | null> {
    opts?.onProgress?.({ phase: "local", via: "ffmpeg-wasm" });
    await this.ensureLoaded();
    if (!this.ffmpeg || !this.fetchFile) return null;

    const inputName = "input";
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

export async function normalizeVideoFile(
  file: File,
  opts?: NormalizeOptions,
): Promise<NormalizeVideoResult> {
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
