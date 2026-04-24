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
 * - `local`: ffmpeg.wasm fallback running in the browser. Progress is emitted
 *   by ffmpeg.wasm when available; otherwise indeterminate.
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

type FfmpegLogEvent = { type?: string; message: string };
type FfmpegProgressEvent = { progress: number; time?: number };
type FfmpegInstance = {
  writeFile: (path: string, data: Uint8Array) => Promise<void>;
  exec: (args: string[]) => Promise<number | void>;
  readFile: (path: string) => Promise<Uint8Array | ArrayBuffer>;
  load: (config: {
    classWorkerURL?: string;
    coreURL?: string;
    wasmURL?: string;
    workerURL?: string;
  }) => Promise<boolean | void>;
  terminate?: () => void;
  on?: (event: "progress", cb: (e: FfmpegProgressEvent) => void) => void;
  off?: (event: "progress", cb: (e: FfmpegProgressEvent) => void) => void;
} & {
  on?: (event: "log", cb: (e: FfmpegLogEvent) => void) => void;
  off?: (event: "log", cb: (e: FfmpegLogEvent) => void) => void;
};

type FfmpegModule = { FFmpeg: new () => FfmpegInstance };
type FfmpegUtilModule = {
  fetchFile: (file: File | string) => Promise<Uint8Array>;
};

/**
 * Base path where `scripts/copy-ffmpeg-assets.mjs` drops the three bundled
 * dist trees. Kept as a same-origin absolute path so:
 *
 *   - the bundler can't statically resolve it (we still import at runtime),
 *   - the browser can construct a Worker from it (cross-origin Worker is
 *     rejected — this is why jsDelivr hosting fails in closed networks),
 *   - and `new URL('./worker.js', import.meta.url)` inside the ffmpeg ESM
 *     resolves back to /ffmpeg/ffmpeg/worker.js.
 *
 * Override with NEXT_PUBLIC_FFMPEG_BASE_URL if the app is reverse-proxied
 * under a subpath or the assets are served from a sibling origin that
 * already ships the right CORS headers.
 */
const FFMPEG_BASE_URL =
  process.env.NEXT_PUBLIC_FFMPEG_BASE_URL?.replace(/\/+$/, "") || "/ffmpeg";

class ServerNormalizeAdapter implements VideoNormalizeAdapter {
  name = "server" as const;

  async normalize(file: File, opts?: NormalizeOptions): Promise<File | null> {
    const endpoint = resolveServerEndpoint();
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

/**
 * ffmpeg.wasm fallback. Runs a single-threaded ffmpeg build in a Web Worker.
 *
 * Key design points (all were sources of real-world failures):
 *
 * 1. We load `@ffmpeg/ffmpeg` + `@ffmpeg/util` + `@ffmpeg/core` from our own
 *    origin (`/ffmpeg/...`) via a dynamic `import()` that hides from the
 *    Next.js bundler's static analysis. The assets are copied into
 *    `public/ffmpeg/` by `scripts/copy-ffmpeg-assets.mjs` on
 *    postinstall/predev/prebuild. CDN hosting was tried first but
 *    `new Worker(crossOriginURL)` is rejected by browsers, which breaks
 *    the fallback entirely in closed networks.
 *
 * 2. The coreURL/wasmURL we hand to `ffmpeg.load()` are plain same-origin
 *    paths — no `toBlobURL` dance needed because there is no cross-origin
 *    boundary anymore. Keeping them as real URLs (not blobs) also lets the
 *    ESM core resolve its own `import.meta.url` correctly.
 *
 * 3. We register `ffmpeg.on("progress")` / `ffmpeg.on("log")` so the UI gets
 *    real progress (0..1) and the console gets a diagnostic trail when
 *    ffmpeg reports errors. Previously this phase was indeterminate forever.
 *
 * 4. Errors from `ensureLoaded` / `exec` / `readFile` are rethrown so the
 *    outer `normalizeVideoFile` can report them via `console.warn` instead
 *    of silently swallowing and returning the original (broken) file.
 *
 * 5. `AbortSignal` terminates the ffmpeg worker mid-exec.
 *
 * 6. The module instance is cached across calls (`ensureLoaded` is
 *    idempotent). A failed load clears the cache so a retry can re-attempt.
 */
class FfmpegWasmNormalizeAdapter implements VideoNormalizeAdapter {
  name = "ffmpeg-wasm" as const;
  private ffmpeg: FfmpegInstance | null = null;
  private fetchFile: FfmpegUtilModule["fetchFile"] | null = null;
  private loadPromise: Promise<void> | null = null;

  async normalize(
    file: File,
    opts?: NormalizeOptions,
  ): Promise<File | null> {
    const emit = (phase: NormalizePhase, progress?: number) =>
      opts?.onProgress?.({ phase, progress, via: "ffmpeg-wasm" });
    emit("local");

    await this.ensureLoaded();
    if (!this.ffmpeg || !this.fetchFile) return null;
    if (opts?.signal?.aborted) return null;

    const ff = this.ffmpeg;
    const extMatch = file.name.match(/\.[^./\\]+$/);
    const inputExt = extMatch ? extMatch[0].toLowerCase() : "";
    const inputName = `input${inputExt || ".bin"}`;
    const outputName = "output.mp4";

    const onProgress = ({ progress }: FfmpegProgressEvent) => {
      if (typeof progress !== "number" || !Number.isFinite(progress)) return;
      emit("local", Math.max(0, Math.min(1, progress)));
    };
    const onLog = ({ message }: FfmpegLogEvent) => {
      if (/\b(error|failed|invalid|unable|unsupported|no such)\b/i.test(message)) {
        console.warn("[ffmpeg-wasm]", message);
      }
    };
    const onAbort = () => {
      try {
        ff.terminate?.();
      } catch {
        // terminate may no-op once done
      }
      // Reset instance so the next attempt recreates the worker.
      this.ffmpeg = null;
      this.fetchFile = null;
      this.loadPromise = null;
    };

    ff.on?.("progress", onProgress);
    ff.on?.("log", onLog);
    opts?.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const bytes = await this.fetchFile(file);
      await ff.writeFile(inputName, bytes);

      const exitCode = await ff.exec([
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

      if (typeof exitCode === "number" && exitCode !== 0) {
        throw new Error(`ffmpeg exited with code ${exitCode}`);
      }

      const data = await ff.readFile(outputName);
      const out =
        data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
      // Detach from ffmpeg's internal buffer so File keeps its own memory.
      const copied = new Uint8Array(out.byteLength);
      copied.set(out);

      return new File([copied], file.name.replace(/\.[^.]+$/, ".mp4"), {
        type: "video/mp4",
        lastModified: Date.now(),
      });
    } finally {
      ff.off?.("progress", onProgress);
      ff.off?.("log", onLog);
      opts?.signal?.removeEventListener("abort", onAbort);
    }
  }

  private ensureLoaded(): Promise<void> {
    if (this.ffmpeg && this.fetchFile) return Promise.resolve();
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = this.loadImpl().catch((err) => {
      // Let future calls retry with a fresh attempt.
      this.loadPromise = null;
      this.ffmpeg = null;
      this.fetchFile = null;
      throw err;
    });
    return this.loadPromise;
  }

  private async loadImpl() {
    const base = resolveFfmpegBaseUrl();

    const [ffmpegMod, utilMod] = await Promise.all([
      importFromUrl(`${base}/ffmpeg/index.js`) as Promise<FfmpegModule>,
      importFromUrl(`${base}/util/index.js`) as Promise<FfmpegUtilModule>,
    ]);

    const { FFmpeg } = ffmpegMod;
    const { fetchFile } = utilMod;

    const coreURL = `${base}/core/ffmpeg-core.js`;
    const wasmURL = `${base}/core/ffmpeg-core.wasm`;

    const ffmpeg = new FFmpeg();
    ffmpeg.on?.("log", ({ message }) => {
      // Load-time logs are rare; surface them so "load failed" isn't a mystery.
      if (/\b(error|failed|invalid|abort)\b/i.test(message)) {
        console.warn("[ffmpeg-wasm:load]", message);
      }
    });

    const ok = await ffmpeg.load({ coreURL, wasmURL });
    if (ok === false) {
      throw new Error("ffmpeg.load() returned false");
    }

    this.ffmpeg = ffmpeg;
    this.fetchFile = fetchFile;
  }
}

/**
 * Validate the server normalize endpoint and resolve it against the current
 * origin. XMLHttpRequest.open throws a SyntaxError on any URL it can't parse
 * (malformed percent encodings, bare `http://`, `javascript:` URLs, …),
 * which used to blow up the whole normalize pipeline before the ffmpeg.wasm
 * fallback got a chance to run. Returning `null` here lets the caller skip
 * this adapter cleanly.
 *
 * We only accept http/https results so an accidentally-pasted value like
 * `javascript:void(0)` doesn't silently slip through the WHATWG URL parser
 * and reach xhr.open.
 */
function resolveServerEndpoint(): string | null {
  const raw = process.env.NEXT_PUBLIC_VIDEO_NORMALIZE_ENDPOINT?.trim();
  if (!raw) return null;
  try {
    const base =
      typeof window !== "undefined" ? window.location.href : "http://localhost/";
    const parsed = new URL(raw, base);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function resolveFfmpegBaseUrl(): string {
  // Absolute URLs (http/https) pass through verbatim — lets us point at a
  // sibling host in environments that split static assets from the app.
  if (/^https?:\/\//i.test(FFMPEG_BASE_URL)) return FFMPEG_BASE_URL;
  // Resolve "/ffmpeg" (or custom subpath) against the current page origin.
  if (typeof window !== "undefined") {
    return new URL(FFMPEG_BASE_URL, window.location.href).toString().replace(/\/+$/, "");
  }
  return FFMPEG_BASE_URL;
}

/**
 * Dynamic cross-origin import that the Next.js bundler won't try to resolve
 * at build time. Exported for testing.
 */
export function importFromUrl(url: string): Promise<unknown> {
  return Function("u", "return import(u)")(url) as Promise<unknown>;
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
    } catch (err) {
      // Don't swallow silently — without this trail, a broken ffmpeg.wasm
      // fallback looks identical to "server adapter returned null" and the
      // user ends up with `via: "original"` for no obvious reason.
      console.warn(`[normalize:${adapter.name}] failed:`, err);
    }
  }

  return { file, via: "original" };
}

/**
 * Test-only seam: exposes the adapters so unit tests can exercise the
 * ffmpeg.wasm fallback with a stubbed FFmpeg class.
 */
export const __internals = {
  ServerNormalizeAdapter,
  FfmpegWasmNormalizeAdapter,
};
