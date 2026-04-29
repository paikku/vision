import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

/**
 * Local filesystem storage for projects/videos/frames.
 *
 * Layout (all under STORAGE_ROOT):
 *   projects.json                           list of ProjectSummary
 *   {projectId}/
 *     project.json                          { id, name, createdAt, members }
 *     videos.json                           VideoSummary[]
 *     {videoId}/
 *       meta.json                           VideoMeta
 *       source.<ext>                        original/normalized video bytes
 *       data.json                           { classes, frames[], annotations[] }
 *       frames/
 *         {frameId}.jpg                     frame image
 *
 * This is a placeholder for DB persistence - all reads/writes go through
 * this module so a future swap is a single-file change.
 */

export const STORAGE_ROOT = path.join(process.cwd(), "storage");
const PROJECTS_INDEX = path.join(STORAGE_ROOT, "projects.json");

async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

async function readJson<T>(p: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(p, "utf-8");
    return JSON.parse(raw) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e;
  }
}

// Crash-safe write: stage to a sibling tmp file, fsync if available, then
// rename onto the target. A reader that opens the file mid-write will either
// see the previous contents or the new contents — never a partial JSON.
async function writeJson(p: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(p));
  const tmp = `${p}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
  try {
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf-8");
    await fs.rename(tmp, p);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

// ---------- per-file mutex ----------
//
// Multiple concurrent requests can land in the same Next.js node process and
// race on the small JSON index files (projects.json, videos.json, data.json,
// meta.json). All of those are read-modify-write, so naive concurrent access
// drops entries: if two writers each read the same baseline and write back
// independently, the second write clobbers the first.
//
// Every RMW path here funnels through `withFileLock(path, fn)`, which
// serializes work per-path through a single shared promise chain. The chain
// entry is replaced atomically and cleared once the tail settles, so an idle
// path doesn't leak a Map entry. This is in-process only; there is one Next
// node process so that is sufficient.
const fileLocks = new Map<string, Promise<unknown>>();

async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = fileLocks.get(filePath) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(() => fn());
  fileLocks.set(filePath, next);
  next
    .catch(() => undefined)
    .finally(() => {
      if (fileLocks.get(filePath) === next) fileLocks.delete(filePath);
    });
  return next;
}

export type ProjectSummary = {
  id: string;
  name: string;
  createdAt: number;
  videoCount: number;
  annotationCount: number;
  frameCount: number;
};

export type ProjectMember = { id: string; name: string; role: string };

export type Project = {
  id: string;
  name: string;
  createdAt: number;
  members: ProjectMember[];
};

export type VideoMeta = {
  id: string;
  name: string;
  kind: "video" | "image";
  width: number;
  height: number;
  duration?: number;
  ingestVia?: "original" | "ffmpeg-wasm" | "server";
  sourceExt: string;
  /** Number of preview thumbnails on disk (preview-0.jpg ... preview-{n-1}.jpg). */
  previewCount?: number;
  createdAt: number;
};

export type VideoSummary = VideoMeta & {
  frameCount: number;
  annotationCount: number;
};

export type StoredFrame = {
  id: string;
  videoId: string;
  width: number;
  height: number;
  timestamp?: number;
  label: string;
  ext: string;
  createdAt: number;
};

export type StoredRectShape = {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
};
export type StoredPolygonShape = {
  kind: "polygon";
  rings: { x: number; y: number }[][];
};
export type StoredShape = StoredRectShape | StoredPolygonShape;

export type StoredAnnotation = {
  id: string;
  frameId: string;
  classId: string;
  shape: StoredShape;
  createdAt: number;
};

export type StoredLabelClass = {
  id: string;
  name: string;
  color: string;
  shortcutKey?: "q" | "w" | "e" | "r";
};

export type VideoData = {
  classes: StoredLabelClass[];
  frames: StoredFrame[];
  annotations: StoredAnnotation[];
};

function projectDir(id: string): string {
  return path.join(STORAGE_ROOT, safeId(id));
}
function videoDir(projectId: string, videoId: string): string {
  return path.join(projectDir(projectId), safeId(videoId));
}
function framesDir(projectId: string, videoId: string): string {
  return path.join(videoDir(projectId, videoId), "frames");
}

/**
 * Defensive filename guard. ids from the client are UUIDs, but we still refuse
 * anything with path separators so a malicious id cannot escape the storage
 * root.
 */
function safeId(id: string): string {
  if (!id || /[\\/]|\.\./.test(id)) {
    throw new Error(`invalid id: ${id}`);
  }
  return id;
}

export function genId(): string {
  return randomUUID();
}

// ---------- projects ----------

/**
 * Self-heal: scan STORAGE_ROOT for any subdirectory that has a `project.json`
 * but isn't listed in `projects.json`, and re-add it. This recovers from
 * pre-fix race conditions where a `createProject` writer clobbered another's
 * append, leaving the project directory on disk but unreferenced. Idempotent
 * and cheap on a clean index.
 */
async function ensureProjectsIndex(): Promise<string[]> {
  return withFileLock(PROJECTS_INDEX, async () => {
    const index = await readJson<{ projects: string[] }>(PROJECTS_INDEX, {
      projects: [],
    });
    const known = new Set(index.projects);
    let entries: string[] = [];
    try {
      const dir = await fs.readdir(STORAGE_ROOT, { withFileTypes: true });
      entries = dir.filter((d) => d.isDirectory()).map((d) => d.name);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    let mutated = false;
    for (const name of entries) {
      if (known.has(name)) continue;
      try {
        await fs.access(path.join(STORAGE_ROOT, name, "project.json"));
        index.projects.push(name);
        mutated = true;
      } catch {
        // not a project dir; skip
      }
    }
    if (mutated) await writeJson(PROJECTS_INDEX, index);
    return index.projects.slice();
  });
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const ids = await ensureProjectsIndex();
  const summaries: ProjectSummary[] = [];
  for (const id of ids) {
    try {
      summaries.push(await getProjectSummary(id));
    } catch {
      // skip broken/missing entries silently
    }
  }
  summaries.sort((a, b) => b.createdAt - a.createdAt);
  return summaries;
}

export async function getProject(id: string): Promise<Project | null> {
  const p = path.join(projectDir(id), "project.json");
  try {
    const raw = await fs.readFile(p, "utf-8");
    return JSON.parse(raw) as Project;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

async function getProjectSummary(id: string): Promise<ProjectSummary> {
  const proj = await getProject(id);
  if (!proj) throw new Error("project not found");
  const videos = await listVideos(id);
  return {
    id: proj.id,
    name: proj.name,
    createdAt: proj.createdAt,
    videoCount: videos.length,
    annotationCount: videos.reduce((n, v) => n + v.annotationCount, 0),
    frameCount: videos.reduce((n, v) => n + v.frameCount, 0),
  };
}

export async function createProject(name: string): Promise<Project> {
  const id = genId();
  const project: Project = {
    id,
    name: name.trim() || "Untitled",
    createdAt: Date.now(),
    members: [],
  };
  await ensureDir(projectDir(id));
  await writeJson(path.join(projectDir(id), "project.json"), project);
  await writeJson(path.join(projectDir(id), "videos.json"), []);
  await withFileLock(PROJECTS_INDEX, async () => {
    const index = await readJson<{ projects: string[] }>(PROJECTS_INDEX, {
      projects: [],
    });
    if (!index.projects.includes(id)) index.projects.push(id);
    await writeJson(PROJECTS_INDEX, index);
  });
  return project;
}

export async function deleteProject(id: string): Promise<void> {
  await withFileLock(PROJECTS_INDEX, async () => {
    const index = await readJson<{ projects: string[] }>(PROJECTS_INDEX, {
      projects: [],
    });
    index.projects = index.projects.filter((x) => x !== id);
    await writeJson(PROJECTS_INDEX, index);
  });
  await fs.rm(projectDir(id), { recursive: true, force: true });
}

// ---------- videos ----------

function videosIndexPath(projectId: string): string {
  return path.join(projectDir(projectId), "videos.json");
}

async function readVideosIndex(projectId: string): Promise<string[]> {
  const raw = await readJson<string[]>(videosIndexPath(projectId), []);
  return raw;
}
async function writeVideosIndex(projectId: string, ids: string[]): Promise<void> {
  await writeJson(videosIndexPath(projectId), ids);
}

/**
 * Self-heal: append any video subdirectory under `{projectId}/` that has a
 * `meta.json` but is missing from `videos.json`. Mirrors `ensureProjectsIndex`
 * — recovers from pre-fix race conditions where `createVideo` lost an append.
 */
async function ensureVideosIndex(projectId: string): Promise<string[]> {
  return withFileLock(videosIndexPath(projectId), async () => {
    const ids = await readVideosIndex(projectId);
    const known = new Set(ids);
    let entries: string[] = [];
    try {
      const dir = await fs.readdir(projectDir(projectId), {
        withFileTypes: true,
      });
      entries = dir.filter((d) => d.isDirectory()).map((d) => d.name);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    let mutated = false;
    for (const name of entries) {
      if (known.has(name)) continue;
      try {
        await fs.access(path.join(videoDir(projectId, name), "meta.json"));
        ids.push(name);
        mutated = true;
      } catch {
        // not a video dir
      }
    }
    if (mutated) await writeVideosIndex(projectId, ids);
    return ids.slice();
  });
}

export async function listVideos(projectId: string): Promise<VideoSummary[]> {
  const ids = await ensureVideosIndex(projectId);
  const out: VideoSummary[] = [];
  for (const id of ids) {
    try {
      const meta = await getVideoMeta(projectId, id);
      if (!meta) continue;
      // Reconcile orphaned frame files into data.json before counting.
      await reconcileVideoFrames(projectId, id, meta);
      const data = await getVideoData(projectId, id);
      out.push({
        ...meta,
        frameCount: data.frames.length,
        annotationCount: data.annotations.length,
      });
    } catch {
      // skip broken entry
    }
  }
  out.sort((a, b) => a.createdAt - b.createdAt);
  return out;
}

/**
 * Self-heal: scan `frames/` for image files that aren't tracked in data.json
 * and append best-effort entries (width/height inherited from the parent
 * video meta — accurate for normal video-extracted frames). Recovers from
 * pre-fix races where a `frames POST` was clobbered by a concurrent `data
 * PUT`, leaving the jpg on disk but absent from data.json. Idempotent.
 */
export async function reconcileVideoFrames(
  projectId: string,
  videoId: string,
  meta?: VideoMeta | null,
): Promise<void> {
  const dir = framesDir(projectId, videoId);
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  if (entries.length === 0) return;

  // Cheap pre-check outside the lock: bail if every disk file already has a
  // matching data.json entry. Avoids taking the lock on the common path.
  const existing = await getVideoData(projectId, videoId);
  const tracked = new Set(existing.frames.map((f) => f.id));
  const candidates: { id: string; ext: string; mtimeMs: number }[] = [];
  for (const name of entries) {
    const m = /^(.+)\.([a-zA-Z0-9]+)$/.exec(name);
    if (!m) continue;
    const id = m[1];
    const ext = m[2].toLowerCase();
    if (tracked.has(id)) continue;
    let mtimeMs = Date.now();
    try {
      const st = await fs.stat(path.join(dir, name));
      mtimeMs = st.mtimeMs;
    } catch {
      // ignore
    }
    candidates.push({ id, ext, mtimeMs });
  }
  if (candidates.length === 0) return;

  const resolvedMeta = meta ?? (await getVideoMeta(projectId, videoId));
  if (!resolvedMeta) return;

  await mutateVideoData(projectId, videoId, (data) => {
    const have = new Set(data.frames.map((f) => f.id));
    let added = 0;
    for (const c of candidates) {
      if (have.has(c.id)) continue;
      data.frames.push({
        id: c.id,
        videoId,
        width: resolvedMeta.width,
        height: resolvedMeta.height,
        timestamp: undefined,
        label: "",
        ext: c.ext,
        createdAt: c.mtimeMs,
      });
      added++;
    }
    if (added === 0) return false; // nothing to write
  });
}

export async function getVideoMeta(
  projectId: string,
  videoId: string,
): Promise<VideoMeta | null> {
  const p = path.join(videoDir(projectId, videoId), "meta.json");
  try {
    return JSON.parse(await fs.readFile(p, "utf-8")) as VideoMeta;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

function videoDataPath(projectId: string, videoId: string): string {
  return path.join(videoDir(projectId, videoId), "data.json");
}

export async function getVideoData(
  projectId: string,
  videoId: string,
): Promise<VideoData> {
  return readJson<VideoData>(videoDataPath(projectId, videoId), {
    classes: [],
    frames: [],
    annotations: [],
  });
}

export async function saveVideoData(
  projectId: string,
  videoId: string,
  data: VideoData,
): Promise<void> {
  await writeJson(videoDataPath(projectId, videoId), data);
}

/**
 * Locked read-modify-write on data.json. Use this for any mutation that
 * depends on the current contents — frame add/remove, annotation overlay, etc.
 * The mutator may modify `data` in place and/or return a value, which is
 * forwarded to the caller. The write is skipped only if the mutator returns
 * the literal value `false` (e.g. nothing to do).
 */
export async function mutateVideoData<T>(
  projectId: string,
  videoId: string,
  mutator: (data: VideoData) => Promise<T> | T,
): Promise<T> {
  const file = videoDataPath(projectId, videoId);
  return withFileLock(file, async () => {
    const data = await getVideoData(projectId, videoId);
    const result = await mutator(data);
    if ((result as unknown) !== false) {
      await writeJson(file, data);
    }
    return result;
  });
}

export async function createVideo(
  projectId: string,
  meta: Omit<VideoMeta, "id" | "createdAt">,
  sourceBuffer: Buffer,
): Promise<VideoMeta> {
  const id = genId();
  const full: VideoMeta = { ...meta, id, createdAt: Date.now() };
  const dir = videoDir(projectId, id);
  await ensureDir(dir);
  await ensureDir(framesDir(projectId, id));
  await fs.writeFile(
    path.join(dir, `source.${full.sourceExt}`),
    new Uint8Array(sourceBuffer),
  );
  await writeJson(path.join(dir, "meta.json"), full);
  await writeJson(path.join(dir, "data.json"), {
    classes: [],
    frames: [],
    annotations: [],
  });
  await withFileLock(videosIndexPath(projectId), async () => {
    const ids = await readVideosIndex(projectId);
    if (!ids.includes(id)) ids.push(id);
    await writeVideosIndex(projectId, ids);
  });
  return full;
}

export async function deleteVideo(
  projectId: string,
  videoId: string,
): Promise<void> {
  await withFileLock(videosIndexPath(projectId), async () => {
    const ids = await readVideosIndex(projectId);
    await writeVideosIndex(
      projectId,
      ids.filter((x) => x !== videoId),
    );
  });
  await fs.rm(videoDir(projectId, videoId), { recursive: true, force: true });
}

export async function readVideoSource(
  projectId: string,
  videoId: string,
): Promise<{ data: Buffer; ext: string } | null> {
  const meta = await getVideoMeta(projectId, videoId);
  if (!meta) return null;
  const p = path.join(videoDir(projectId, videoId), `source.${meta.sourceExt}`);
  try {
    return { data: await fs.readFile(p), ext: meta.sourceExt };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

// ---------- frames ----------

export async function writeFrame(
  projectId: string,
  videoId: string,
  frameId: string,
  buffer: Buffer,
  ext: string,
): Promise<void> {
  const dir = framesDir(projectId, videoId);
  await ensureDir(dir);
  await fs.writeFile(
    path.join(dir, `${safeId(frameId)}.${ext}`),
    new Uint8Array(buffer),
  );
}

export async function readFrame(
  projectId: string,
  videoId: string,
  frameId: string,
  ext: string,
): Promise<Buffer | null> {
  const p = path.join(
    framesDir(projectId, videoId),
    `${safeId(frameId)}.${ext}`,
  );
  try {
    return await fs.readFile(p);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export async function deleteFrame(
  projectId: string,
  videoId: string,
  frameId: string,
  ext: string,
): Promise<void> {
  const p = path.join(
    framesDir(projectId, videoId),
    `${safeId(frameId)}.${ext}`,
  );
  await fs.rm(p, { force: true });
}

// ---------- previews (mini hover-reel thumbnails) ----------

function previewPath(projectId: string, videoId: string, idx: number): string {
  return path.join(videoDir(projectId, videoId), `preview-${idx}.jpg`);
}

export async function writePreviews(
  projectId: string,
  videoId: string,
  buffers: Buffer[],
): Promise<number> {
  const metaFile = path.join(videoDir(projectId, videoId), "meta.json");
  return withFileLock(metaFile, async () => {
    const meta = await getVideoMeta(projectId, videoId);
    if (!meta) throw new Error("video not found");
    // Wipe any older preview set so a re-upload doesn't leave stale frames.
    const oldCount = meta.previewCount ?? 0;
    for (let i = 0; i < Math.max(oldCount, buffers.length); i++) {
      await fs.rm(previewPath(projectId, videoId, i), { force: true });
    }
    for (let i = 0; i < buffers.length; i++) {
      await fs.writeFile(
        previewPath(projectId, videoId, i),
        new Uint8Array(buffers[i]),
      );
    }
    const next: VideoMeta = { ...meta, previewCount: buffers.length };
    await writeJson(metaFile, next);
    return buffers.length;
  });
}

export async function readPreview(
  projectId: string,
  videoId: string,
  idx: number,
): Promise<Buffer | null> {
  if (!Number.isInteger(idx) || idx < 0) return null;
  try {
    return await fs.readFile(previewPath(projectId, videoId, idx));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export function mimeForExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === "mp4" || e === "m4v") return "video/mp4";
  if (e === "webm") return "video/webm";
  if (e === "mov") return "video/quicktime";
  if (e === "mkv") return "video/x-matroska";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "png") return "image/png";
  if (e === "webp") return "image/webp";
  return "application/octet-stream";
}

export function extFromName(name: string, fallback: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(name);
  return (m?.[1] ?? fallback).toLowerCase();
}
