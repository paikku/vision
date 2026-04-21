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
      let completed = false;
      const resolveOnce = (value: File | null) => {
        if (completed) return;
        completed = true;
        resolve(value);
      };
      const xhr = new XMLHttpRequest();
      xhr.open("POST", endpoint);
      xhr.responseType = "arraybuffer";

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
        const contentType = xhr.getResponseHeader("Content-Type") ?? "";
        const isJson = contentType.includes("application/json");

        // New async mode:
        // POST /normalize/jobs => 202 { statusUrl, resultUrl }
        // Keep legacy 200(video/mp4) path below.
        if (xhr.status === 202 && isJson) {
          void this.handleJobMode({
            endpoint,
            file,
            xhr,
            emit,
            resolve: resolveOnce,
            signal: opts?.signal,
          });
          return;
        }

        if (xhr.status < 200 || xhr.status >= 300) {
          resolveOnce(null);
          return;
        }
        const body = xhr.response as ArrayBuffer | null;
        if (!body) {
          resolveOnce(null);
          return;
        }
        resolveOnce(
          new File([body], file.name.replace(/\.[^.]+$/, ".mp4"), {
            type: "video/mp4",
            lastModified: Date.now(),
          }),
        );
      };
      xhr.onerror = () => resolveOnce(null);
      xhr.onabort = () => resolveOnce(null);
      xhr.ontimeout = () => resolveOnce(null);

      opts?.signal?.addEventListener("abort", () => xhr.abort(), {
        once: true,
      });

      const body = new FormData();
      body.append("file", file);
      xhr.send(body);
    });
  }

  private async handleJobMode({
    endpoint,
    file,
    xhr,
    emit,
    resolve,
    signal,
  }: {
    endpoint: string;
    file: File;
    xhr: XMLHttpRequest;
    emit: (phase: NormalizePhase, progress?: number) => void;
    resolve: (value: File | null) => void;
    signal?: AbortSignal;
  }) {
    type JobCreateResponse = {
      jobId?: string;
      statusUrl?: string;
      resultUrl?: string;
    };

    const decodeJson = <T,>(value: ArrayBuffer | null): T | null => {
      if (!value) return null;
      try {
        const text = new TextDecoder().decode(value);
        return JSON.parse(text) as T;
      } catch {
        return null;
      }
    };

    const payload = decodeJson<JobCreateResponse>(xhr.response as ArrayBuffer | null);
    const statusUrl = payload?.statusUrl
      ? new URL(payload.statusUrl, endpoint).toString()
      : null;
    const resultUrl = payload?.resultUrl
      ? new URL(payload.resultUrl, endpoint).toString()
      : null;
    const jobId = payload?.jobId;

    if (!statusUrl || !resultUrl) {
      resolve(null);
      return;
    }

    let canceled = false;
    const onAbort = () => {
      canceled = true;
      if (jobId && statusUrl) {
        void fetch(statusUrl, {
          method: "DELETE",
        }).catch(() => {
          // best effort cancel
        });
      }
      resolve(null);
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      while (!canceled) {
        const statusResp = await fetch(statusUrl, { signal });
        if (!statusResp.ok) {
          resolve(null);
          return;
        }
        const statusData = (await statusResp.json()) as {
          status?: "queued" | "processing" | "decoding" | "done" | "ready" | "failed";
          state?: "queued" | "processing" | "decoding" | "done" | "ready" | "failed";
          progress?: number;
        };
        const rawState = statusData.status ?? statusData.state;
        const state =
          rawState === "processing"
            ? "decoding"
            : rawState === "done"
              ? "ready"
              : rawState;
        if (state === "failed") {
          resolve(null);
          return;
        }
        if (state === "ready") break;

        const normalizedProgress =
          typeof statusData.progress === "number"
            ? Math.max(0, Math.min(1, statusData.progress > 1 ? statusData.progress / 100 : statusData.progress))
            : undefined;
        emit("decoding", normalizedProgress);
        await new Promise<void>((r) => setTimeout(r, 1000));
      }

      if (canceled) return;

      const downloadXhr = new XMLHttpRequest();
      downloadXhr.open("GET", resultUrl);
      downloadXhr.responseType = "blob";
      downloadXhr.onprogress = (e) => {
        emit(
          "downloading",
          e.lengthComputable ? e.loaded / e.total : undefined,
        );
      };
      downloadXhr.onload = () => {
        if (downloadXhr.status < 200 || downloadXhr.status >= 300) {
          resolve(null);
          return;
        }
        const blob = downloadXhr.response as Blob | null;
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
      downloadXhr.onerror = () => resolve(null);
      downloadXhr.onabort = () => resolve(null);
      downloadXhr.ontimeout = () => resolve(null);

      signal?.addEventListener("abort", () => downloadXhr.abort(), { once: true });
      downloadXhr.send();
    } catch {
      resolve(null);
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
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
