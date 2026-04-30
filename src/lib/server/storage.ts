import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

import type {
  Image,
  ImageFilter,
  ImageSource,
  VideoFrameMeta,
} from "@/features/images/types";
import type {
  LabelSet,
  LabelSetAnnotations,
  LabelSetSummary,
  LabelSetType,
  LabelClass,
} from "@/features/labelsets/types";
import type {
  Resource,
  ResourceSummary,
  ResourceType,
} from "@/features/resources/types";
import type { Project, ProjectSummary } from "@/features/projects/types";

/**
 * Local filesystem storage for the new Resource / Image / LabelSet model.
 *
 * Layout (all under STORAGE_ROOT, no migration from prior schema):
 *
 *   projects.json                         { projects: string[] }
 *   {projectId}/
 *     project.json                        Project
 *     resources.json                      string[] (resource ids)
 *     images.json                         string[] (image ids)
 *     labelsets.json                      string[] (labelset ids)
 *     resources/
 *       {resourceId}/
 *         meta.json                       Resource
 *         source.<ext>                    video resource only
 *         previews/preview-{i}.jpg        video resource only
 *     images/
 *       {imageId}/
 *         meta.json                       Image
 *         bytes.<ext>                     image bytes
 *     labelsets/
 *       {labelsetId}/
 *         meta.json                       LabelSet
 *         annotations.json                LabelSetAnnotations
 *
 * All reads/writes go through this module so a future DB swap is a
 * single-file change.
 */

export const STORAGE_ROOT = path.join(process.cwd(), "storage");
const PROJECTS_INDEX = path.join(STORAGE_ROOT, "projects.json");

// ---------- low-level helpers ----------

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

// Crash-safe write: stage to a sibling tmp file, then rename onto the target.
// A reader that opens the file mid-write will either see the previous contents
// or the new contents — never a partial JSON.
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

// Per-path mutex: serializes RMW on the same file across concurrent requests
// landing in this Next.js node process. Naive concurrent access drops entries
// because two writers can each read the same baseline and clobber each other.
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

// ---------- path builders ----------

function projectDir(id: string): string {
  return path.join(STORAGE_ROOT, safeId(id));
}
function projectFile(id: string): string {
  return path.join(projectDir(id), "project.json");
}
function resourcesIndexPath(projectId: string): string {
  return path.join(projectDir(projectId), "resources.json");
}
function imagesIndexPath(projectId: string): string {
  return path.join(projectDir(projectId), "images.json");
}
function labelsetsIndexPath(projectId: string): string {
  return path.join(projectDir(projectId), "labelsets.json");
}
function resourceDir(projectId: string, resourceId: string): string {
  return path.join(projectDir(projectId), "resources", safeId(resourceId));
}
function imageDir(projectId: string, imageId: string): string {
  return path.join(projectDir(projectId), "images", safeId(imageId));
}
function labelSetDir(projectId: string, labelSetId: string): string {
  return path.join(projectDir(projectId), "labelsets", safeId(labelSetId));
}

// ---------- ext / mime ----------

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

// ============================================================
// Projects
// ============================================================

export async function listProjects(): Promise<ProjectSummary[]> {
  const index = await readJson<{ projects: string[] }>(PROJECTS_INDEX, {
    projects: [],
  });
  const summaries: ProjectSummary[] = [];
  for (const id of index.projects) {
    try {
      summaries.push(await getProjectSummary(id));
    } catch {
      // skip broken entries silently
    }
  }
  summaries.sort((a, b) => b.createdAt - a.createdAt);
  return summaries;
}

export async function getProject(id: string): Promise<Project | null> {
  try {
    return JSON.parse(await fs.readFile(projectFile(id), "utf-8")) as Project;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

async function getProjectSummary(id: string): Promise<ProjectSummary> {
  const proj = await getProject(id);
  if (!proj) throw new Error("project not found");
  const [resources, images, labelsets] = await Promise.all([
    readIndex(resourcesIndexPath(id)),
    readIndex(imagesIndexPath(id)),
    readIndex(labelsetsIndexPath(id)),
  ]);
  return {
    id: proj.id,
    name: proj.name,
    createdAt: proj.createdAt,
    resourceCount: resources.length,
    imageCount: images.length,
    labelSetCount: labelsets.length,
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
  await writeJson(projectFile(id), project);
  await writeJson(resourcesIndexPath(id), []);
  await writeJson(imagesIndexPath(id), []);
  await writeJson(labelsetsIndexPath(id), []);
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

// ============================================================
// Generic id-index helpers
// ============================================================

async function readIndex(p: string): Promise<string[]> {
  return readJson<string[]>(p, []);
}

async function appendToIndex(p: string, id: string): Promise<void> {
  await withFileLock(p, async () => {
    const ids = await readIndex(p);
    if (!ids.includes(id)) ids.push(id);
    await writeJson(p, ids);
  });
}

async function removeFromIndex(p: string, id: string): Promise<void> {
  await withFileLock(p, async () => {
    const ids = await readIndex(p);
    await writeJson(
      p,
      ids.filter((x) => x !== id),
    );
  });
}

// ============================================================
// Resources
// ============================================================

export type CreateVideoResourceInput = {
  type: "video";
  name: string;
  tags?: string[];
  sourceExt: string;
  sourceBuffer: Buffer;
  width: number;
  height: number;
  duration?: number;
  ingestVia?: "original" | "ffmpeg-wasm" | "server";
};

export type CreateImageBatchResourceInput = {
  type: "image_batch";
  name: string;
  tags?: string[];
};

export type CreateResourceInput =
  | CreateVideoResourceInput
  | CreateImageBatchResourceInput;

export async function listResources(
  projectId: string,
): Promise<ResourceSummary[]> {
  const ids = await readIndex(resourcesIndexPath(projectId));
  const allImages = await listImages(projectId);
  const counts = new Map<string, number>();
  for (const img of allImages) {
    counts.set(img.resourceId, (counts.get(img.resourceId) ?? 0) + 1);
  }
  const out: ResourceSummary[] = [];
  for (const id of ids) {
    const r = await getResource(projectId, id);
    if (r) out.push({ ...r, imageCount: counts.get(id) ?? 0 });
  }
  out.sort((a, b) => a.createdAt - b.createdAt);
  return out;
}

export async function getResource(
  projectId: string,
  resourceId: string,
): Promise<Resource | null> {
  const p = path.join(resourceDir(projectId, resourceId), "meta.json");
  try {
    return JSON.parse(await fs.readFile(p, "utf-8")) as Resource;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export async function createResource(
  projectId: string,
  input: CreateResourceInput,
): Promise<Resource> {
  const id = genId();
  const base = {
    id,
    type: input.type as ResourceType,
    name: input.name.trim() || "Untitled",
    tags: input.tags ?? [],
    createdAt: Date.now(),
  };
  const resource: Resource =
    input.type === "video"
      ? {
          ...base,
          sourceExt: input.sourceExt,
          width: input.width,
          height: input.height,
          duration: input.duration,
          ingestVia: input.ingestVia,
          previewCount: 0,
        }
      : { ...base };
  const dir = resourceDir(projectId, id);
  await ensureDir(dir);
  if (input.type === "video") {
    await fs.writeFile(
      path.join(dir, `source.${input.sourceExt}`),
      new Uint8Array(input.sourceBuffer),
    );
  }
  await writeJson(path.join(dir, "meta.json"), resource);
  await appendToIndex(resourcesIndexPath(projectId), id);
  return resource;
}

export async function updateResource(
  projectId: string,
  resourceId: string,
  patch: { name?: string; tags?: string[] },
): Promise<Resource | null> {
  const file = path.join(resourceDir(projectId, resourceId), "meta.json");
  return withFileLock(file, async () => {
    const current = await getResource(projectId, resourceId);
    if (!current) return null;
    const next: Resource = {
      ...current,
      ...(patch.name != null ? { name: patch.name.trim() || current.name } : {}),
      ...(patch.tags ? { tags: patch.tags } : {}),
    };
    await writeJson(file, next);
    return next;
  });
}

export async function deleteResource(
  projectId: string,
  resourceId: string,
): Promise<void> {
  // Cascade: remove images that originated from this resource.
  const images = await listImages(projectId, { resourceId });
  for (const img of images) {
    await deleteImage(projectId, img.id);
  }
  await removeFromIndex(resourcesIndexPath(projectId), resourceId);
  await fs.rm(resourceDir(projectId, resourceId), {
    recursive: true,
    force: true,
  });
}

export async function readResourceSource(
  projectId: string,
  resourceId: string,
): Promise<{ data: Buffer; ext: string } | null> {
  const r = await getResource(projectId, resourceId);
  if (!r || r.type !== "video" || !r.sourceExt) return null;
  const p = path.join(resourceDir(projectId, resourceId), `source.${r.sourceExt}`);
  try {
    return { data: await fs.readFile(p), ext: r.sourceExt };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/**
 * Return the on-disk path + total size + ext for a video Resource's source
 * file. Used by the streaming source endpoint so it can serve HTTP Range
 * requests without reading the entire file into memory. Browsers require
 * Range support to seek inside <video>; without it, clicking the scrubber
 * (or any scripted `currentTime` write) fails silently.
 */
export async function statResourceSource(
  projectId: string,
  resourceId: string,
): Promise<{ path: string; size: number; ext: string } | null> {
  const r = await getResource(projectId, resourceId);
  if (!r || r.type !== "video" || !r.sourceExt) return null;
  const p = path.join(resourceDir(projectId, resourceId), `source.${r.sourceExt}`);
  try {
    const st = await fs.stat(p);
    return { path: p, size: st.size, ext: r.sourceExt };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

// ---------- previews (video resource hover-reel thumbnails) ----------

function previewPath(
  projectId: string,
  resourceId: string,
  idx: number,
): string {
  return path.join(
    resourceDir(projectId, resourceId),
    "previews",
    `preview-${idx}.jpg`,
  );
}

export async function writePreviews(
  projectId: string,
  resourceId: string,
  buffers: Buffer[],
): Promise<number> {
  const metaFile = path.join(resourceDir(projectId, resourceId), "meta.json");
  return withFileLock(metaFile, async () => {
    const r = await getResource(projectId, resourceId);
    if (!r) throw new Error("resource not found");
    if (r.type !== "video") throw new Error("previews only valid on video resources");
    await ensureDir(path.dirname(previewPath(projectId, resourceId, 0)));
    // Wipe older preview set so a re-upload doesn't leave stale frames.
    const oldCount = r.previewCount ?? 0;
    for (let i = 0; i < Math.max(oldCount, buffers.length); i++) {
      await fs.rm(previewPath(projectId, resourceId, i), { force: true });
    }
    for (let i = 0; i < buffers.length; i++) {
      await fs.writeFile(
        previewPath(projectId, resourceId, i),
        new Uint8Array(buffers[i]),
      );
    }
    const next: Resource = { ...r, previewCount: buffers.length };
    await writeJson(metaFile, next);
    return buffers.length;
  });
}

export async function readPreview(
  projectId: string,
  resourceId: string,
  idx: number,
): Promise<Buffer | null> {
  if (!Number.isInteger(idx) || idx < 0) return null;
  try {
    return await fs.readFile(previewPath(projectId, resourceId, idx));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

// ============================================================
// Images
// ============================================================

export type CreateImageInput = {
  resourceId: string;
  source: ImageSource;
  fileName: string;
  ext: string;
  width: number;
  height: number;
  tags?: string[];
  videoFrameMeta?: VideoFrameMeta;
  bytes: Buffer;
  /** Optional preassigned id (for client-allocated ids during extraction). */
  id?: string;
};

export async function listImages(
  projectId: string,
  filter?: ImageFilter,
): Promise<Image[]> {
  const ids = await readIndex(imagesIndexPath(projectId));
  const out: Image[] = [];
  for (const id of ids) {
    const img = await getImage(projectId, id);
    if (!img) continue;
    if (filter?.resourceId && img.resourceId !== filter.resourceId) continue;
    if (filter?.source && img.source !== filter.source) continue;
    if (filter?.tag && !img.tags.includes(filter.tag)) continue;
    out.push(img);
  }
  return out;
}

export async function getImage(
  projectId: string,
  imageId: string,
): Promise<Image | null> {
  const p = path.join(imageDir(projectId, imageId), "meta.json");
  try {
    return JSON.parse(await fs.readFile(p, "utf-8")) as Image;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export async function createImage(
  projectId: string,
  input: CreateImageInput,
): Promise<Image> {
  const id = input.id ?? genId();
  safeId(id);
  const image: Image = {
    id,
    resourceId: input.resourceId,
    source: input.source,
    fileName: input.fileName,
    ext: input.ext,
    width: input.width,
    height: input.height,
    tags: input.tags ?? [],
    videoFrameMeta: input.videoFrameMeta,
    createdAt: Date.now(),
  };
  const dir = imageDir(projectId, id);
  await ensureDir(dir);
  await fs.writeFile(
    path.join(dir, `bytes.${input.ext}`),
    new Uint8Array(input.bytes),
  );
  await writeJson(path.join(dir, "meta.json"), image);
  await appendToIndex(imagesIndexPath(projectId), id);
  return image;
}

export async function updateImage(
  projectId: string,
  imageId: string,
  patch: { tags?: string[] },
): Promise<Image | null> {
  const file = path.join(imageDir(projectId, imageId), "meta.json");
  return withFileLock(file, async () => {
    const current = await getImage(projectId, imageId);
    if (!current) return null;
    const next: Image = {
      ...current,
      ...(patch.tags ? { tags: patch.tags } : {}),
    };
    await writeJson(file, next);
    return next;
  });
}

/**
 * Bulk tag mutation across many images. `mode`:
 *   - `replace` — overwrite tag list with `tags`.
 *   - `add`     — union of current tags and `tags`.
 *   - `remove`  — current tags minus `tags`.
 *
 * Per-image meta files are guarded by the same lock used by single-image
 * updateImage(), so concurrent bulk + single edits cannot clobber each other.
 */
export async function bulkTagImages(
  projectId: string,
  imageIds: string[],
  tags: string[],
  mode: "replace" | "add" | "remove",
): Promise<{ updated: number }> {
  let updated = 0;
  for (const id of imageIds) {
    const file = path.join(imageDir(projectId, id), "meta.json");
    const ok = await withFileLock(file, async () => {
      const current = await getImage(projectId, id);
      if (!current) return false;
      let next: string[];
      if (mode === "replace") {
        next = Array.from(new Set(tags));
      } else if (mode === "add") {
        next = Array.from(new Set([...current.tags, ...tags]));
      } else {
        const drop = new Set(tags);
        next = current.tags.filter((t) => !drop.has(t));
      }
      const updatedImage: Image = { ...current, tags: next };
      await writeJson(file, updatedImage);
      return true;
    });
    if (ok) updated += 1;
  }
  return { updated };
}

export async function deleteImage(
  projectId: string,
  imageId: string,
): Promise<void> {
  // Cascade: drop annotations referencing this image from every LabelSet, and
  // drop the image id from every LabelSet's membership list.
  const labelSetIds = await readIndex(labelsetsIndexPath(projectId));
  for (const lsid of labelSetIds) {
    await mutateLabelSetAnnotations(projectId, lsid, (data) => {
      const before = data.annotations.length;
      data.annotations = data.annotations.filter((a) => a.imageId !== imageId);
      return data.annotations.length !== before;
    });
    await mutateLabelSet(projectId, lsid, (ls) => {
      if (!ls.imageIds.includes(imageId)) return false;
      ls.imageIds = ls.imageIds.filter((i) => i !== imageId);
      return true;
    });
  }
  await removeFromIndex(imagesIndexPath(projectId), imageId);
  await fs.rm(imageDir(projectId, imageId), { recursive: true, force: true });
}

export async function readImageBytes(
  projectId: string,
  imageId: string,
): Promise<{ data: Buffer; ext: string } | null> {
  const img = await getImage(projectId, imageId);
  if (!img) return null;
  const p = path.join(imageDir(projectId, imageId), `bytes.${img.ext}`);
  try {
    return { data: await fs.readFile(p), ext: img.ext };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

// ============================================================
// LabelSets
// ============================================================

export type CreateLabelSetInput = {
  name: string;
  type: LabelSetType;
  classes?: LabelClass[];
  imageIds?: string[];
};

export async function listLabelSets(
  projectId: string,
): Promise<LabelSetSummary[]> {
  const ids = await readIndex(labelsetsIndexPath(projectId));
  const out: LabelSetSummary[] = [];
  for (const id of ids) {
    const ls = await getLabelSet(projectId, id);
    if (!ls) continue;
    const ann = await getLabelSetAnnotations(projectId, id);
    out.push({
      id: ls.id,
      name: ls.name,
      type: ls.type,
      imageCount: ls.imageIds.length,
      annotationCount: ann.annotations.length,
      createdAt: ls.createdAt,
    });
  }
  out.sort((a, b) => a.createdAt - b.createdAt);
  return out;
}

export async function getLabelSet(
  projectId: string,
  labelSetId: string,
): Promise<LabelSet | null> {
  const p = path.join(labelSetDir(projectId, labelSetId), "meta.json");
  try {
    return JSON.parse(await fs.readFile(p, "utf-8")) as LabelSet;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export async function createLabelSet(
  projectId: string,
  input: CreateLabelSetInput,
): Promise<LabelSet> {
  const id = genId();
  const labelset: LabelSet = {
    id,
    name: input.name.trim() || "Untitled",
    type: input.type,
    classes: input.classes ?? [],
    imageIds: input.imageIds ?? [],
    createdAt: Date.now(),
  };
  const dir = labelSetDir(projectId, id);
  await ensureDir(dir);
  await writeJson(path.join(dir, "meta.json"), labelset);
  await writeJson(path.join(dir, "annotations.json"), {
    annotations: [],
  } satisfies LabelSetAnnotations);
  await appendToIndex(labelsetsIndexPath(projectId), id);
  return labelset;
}

export async function mutateLabelSet(
  projectId: string,
  labelSetId: string,
  mutator: (ls: LabelSet) => boolean | void,
): Promise<LabelSet | null> {
  const file = path.join(labelSetDir(projectId, labelSetId), "meta.json");
  return withFileLock(file, async () => {
    const current = await getLabelSet(projectId, labelSetId);
    if (!current) return null;
    const result = mutator(current);
    if (result === false) return current;
    await writeJson(file, current);
    return current;
  });
}

export async function updateLabelSet(
  projectId: string,
  labelSetId: string,
  patch: {
    name?: string;
    classes?: LabelClass[];
    imageIds?: string[];
  },
): Promise<LabelSet | null> {
  return mutateLabelSet(projectId, labelSetId, (ls) => {
    if (patch.name != null) ls.name = patch.name.trim() || ls.name;
    if (patch.classes) ls.classes = patch.classes;
    if (patch.imageIds) ls.imageIds = patch.imageIds;
  });
}

export async function deleteLabelSet(
  projectId: string,
  labelSetId: string,
): Promise<void> {
  await removeFromIndex(labelsetsIndexPath(projectId), labelSetId);
  await fs.rm(labelSetDir(projectId, labelSetId), {
    recursive: true,
    force: true,
  });
}

// ---------- LabelSet annotations ----------

function labelSetAnnotationsPath(
  projectId: string,
  labelSetId: string,
): string {
  return path.join(labelSetDir(projectId, labelSetId), "annotations.json");
}

export async function getLabelSetAnnotations(
  projectId: string,
  labelSetId: string,
): Promise<LabelSetAnnotations> {
  return readJson<LabelSetAnnotations>(
    labelSetAnnotationsPath(projectId, labelSetId),
    { annotations: [] },
  );
}

export async function saveLabelSetAnnotations(
  projectId: string,
  labelSetId: string,
  data: LabelSetAnnotations,
): Promise<void> {
  await writeJson(labelSetAnnotationsPath(projectId, labelSetId), data);
}

/**
 * Locked read-modify-write on a LabelSet's annotations.json. The mutator may
 * modify `data` in place; a return of exactly `false` skips the write.
 */
export async function mutateLabelSetAnnotations<T>(
  projectId: string,
  labelSetId: string,
  mutator: (data: LabelSetAnnotations) => Promise<T> | T,
): Promise<T> {
  const file = labelSetAnnotationsPath(projectId, labelSetId);
  return withFileLock(file, async () => {
    const data = await getLabelSetAnnotations(projectId, labelSetId);
    const result = await mutator(data);
    if ((result as unknown) !== false) {
      await writeJson(file, data);
    }
    return result;
  });
}
