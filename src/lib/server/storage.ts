import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

/**
 * Local filesystem storage for projects, resources, images, and label sets.
 *
 * Layout (all under STORAGE_ROOT):
 *   projects.json                                  list of project ids
 *   {projectId}/
 *     project.json                                 { id, name, createdAt, members }
 *     resources.json                               ResourceMeta[]
 *     resources/{resourceId}/
 *       meta.json                                  ResourceMeta
 *       source.<ext>                               video bytes (video resources only)
 *       preview-{0..N}.jpg                         hover-reel previews (video only)
 *     images.json                                  ImageMeta[]  (project-level pool)
 *     images/{imageId}.<ext>                       image bytes
 *     labelsets.json                               LabelSetMeta[]
 *     labelsets/{labelsetId}/
 *       meta.json                                  LabelSetMeta
 *       data.json                                  LabelSetData
 *
 * All RMW paths funnel through `withFileLock` for in-process serialization
 * and `writeJson` writes via tmp+rename for crash safety. A future swap to a
 * real database is a single-file change here.
 */

import type {
  ImageMeta,
  ImageSourceKind,
  LabelSetData,
  LabelSetMeta,
  LabelSetSummary,
  Project,
  ProjectSummary,
  ResourceMeta,
  ResourceSummary,
} from "@/features/projects/types";

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

// In-process per-path mutex. See REFACTOR_RULES / CLAUDE.md §11.8 for why.
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

function safeId(id: string): string {
  if (!id || /[\\/]|\.\./.test(id)) {
    throw new Error(`invalid id: ${id}`);
  }
  return id;
}

export function genId(): string {
  return randomUUID();
}

export function extFromName(name: string, fallback: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(name);
  return (m?.[1] ?? fallback).toLowerCase();
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

// ---------- paths ----------

function projectDir(id: string): string {
  return path.join(STORAGE_ROOT, safeId(id));
}
function resourcesIndexPath(projectId: string): string {
  return path.join(projectDir(projectId), "resources.json");
}
function resourceDir(projectId: string, resourceId: string): string {
  return path.join(projectDir(projectId), "resources", safeId(resourceId));
}
function imagesIndexPath(projectId: string): string {
  return path.join(projectDir(projectId), "images.json");
}
function imagesDir(projectId: string): string {
  return path.join(projectDir(projectId), "images");
}
function labelsetsIndexPath(projectId: string): string {
  return path.join(projectDir(projectId), "labelsets.json");
}
function labelsetDir(projectId: string, labelsetId: string): string {
  return path.join(projectDir(projectId), "labelsets", safeId(labelsetId));
}

// ---------- projects ----------

export async function listProjects(): Promise<ProjectSummary[]> {
  const index = await readJson<{ projects: string[] }>(PROJECTS_INDEX, {
    projects: [],
  });
  const out: ProjectSummary[] = [];
  for (const id of index.projects) {
    try {
      out.push(await getProjectSummary(id));
    } catch {
      // skip broken entries
    }
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

async function getProjectSummary(id: string): Promise<ProjectSummary> {
  const proj = await getProject(id);
  if (!proj) throw new Error("project not found");
  const [resources, images, labelsets] = await Promise.all([
    listResources(id),
    readImagesIndex(id),
    listLabelSets(id),
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

export async function getProject(id: string): Promise<Project | null> {
  const p = path.join(projectDir(id), "project.json");
  try {
    return JSON.parse(await fs.readFile(p, "utf-8")) as Project;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
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
  await writeJson(resourcesIndexPath(id), [] as ResourceMeta[]);
  await writeJson(imagesIndexPath(id), [] as ImageMeta[]);
  await writeJson(labelsetsIndexPath(id), [] as LabelSetMeta[]);
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

// ---------- resources ----------

async function readResourcesIndex(projectId: string): Promise<ResourceMeta[]> {
  return readJson<ResourceMeta[]>(resourcesIndexPath(projectId), []);
}
async function writeResourcesIndex(
  projectId: string,
  list: ResourceMeta[],
): Promise<void> {
  await writeJson(resourcesIndexPath(projectId), list);
}

export async function listResources(
  projectId: string,
): Promise<ResourceSummary[]> {
  const list = await readResourcesIndex(projectId);
  const images = await readImagesIndex(projectId);
  const counts = new Map<string, number>();
  for (const im of images) {
    counts.set(im.resourceId, (counts.get(im.resourceId) ?? 0) + 1);
  }
  const summaries: ResourceSummary[] = list.map((r) => ({
    ...r,
    imageCount: counts.get(r.id) ?? 0,
  }));
  summaries.sort((a, b) => a.createdAt - b.createdAt);
  return summaries;
}

export async function getResourceMeta(
  projectId: string,
  resourceId: string,
): Promise<ResourceMeta | null> {
  const p = path.join(resourceDir(projectId, resourceId), "meta.json");
  try {
    return JSON.parse(await fs.readFile(p, "utf-8")) as ResourceMeta;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export async function createResource(
  projectId: string,
  meta: Omit<ResourceMeta, "id" | "createdAt">,
  /** Source bytes for `video` kind only. */
  sourceBuffer?: Buffer,
): Promise<ResourceMeta> {
  const id = genId();
  const full: ResourceMeta = { ...meta, id, createdAt: Date.now() };
  const dir = resourceDir(projectId, id);
  await ensureDir(dir);
  if (full.kind === "video") {
    if (!sourceBuffer || !full.sourceExt) {
      throw new Error("video resource requires sourceBuffer + sourceExt");
    }
    await fs.writeFile(
      path.join(dir, `source.${full.sourceExt}`),
      new Uint8Array(sourceBuffer),
    );
  }
  await writeJson(path.join(dir, "meta.json"), full);
  await withFileLock(resourcesIndexPath(projectId), async () => {
    const list = await readResourcesIndex(projectId);
    list.push(full);
    await writeResourcesIndex(projectId, list);
  });
  return full;
}

export async function deleteResource(
  projectId: string,
  resourceId: string,
): Promise<void> {
  // Remove all images that came from this resource (cascades through label sets too).
  const images = await readImagesIndex(projectId);
  const orphaned = images.filter((im) => im.resourceId === resourceId);
  for (const im of orphaned) {
    await deleteImage(projectId, im.id);
  }
  await withFileLock(resourcesIndexPath(projectId), async () => {
    const list = await readResourcesIndex(projectId);
    await writeResourcesIndex(
      projectId,
      list.filter((r) => r.id !== resourceId),
    );
  });
  await fs.rm(resourceDir(projectId, resourceId), {
    recursive: true,
    force: true,
  });
}

export async function readResourceSource(
  projectId: string,
  resourceId: string,
): Promise<{ data: Buffer; ext: string } | null> {
  const meta = await getResourceMeta(projectId, resourceId);
  if (!meta || meta.kind !== "video" || !meta.sourceExt) return null;
  const p = path.join(
    resourceDir(projectId, resourceId),
    `source.${meta.sourceExt}`,
  );
  try {
    return { data: await fs.readFile(p), ext: meta.sourceExt };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

// ---------- previews ----------

function previewPath(
  projectId: string,
  resourceId: string,
  idx: number,
): string {
  return path.join(resourceDir(projectId, resourceId), `preview-${idx}.jpg`);
}

export async function writePreviews(
  projectId: string,
  resourceId: string,
  buffers: Buffer[],
): Promise<number> {
  const metaFile = path.join(resourceDir(projectId, resourceId), "meta.json");
  return withFileLock(metaFile, async () => {
    const meta = await getResourceMeta(projectId, resourceId);
    if (!meta) throw new Error("resource not found");
    const oldCount = meta.previewCount ?? 0;
    for (let i = 0; i < Math.max(oldCount, buffers.length); i++) {
      await fs.rm(previewPath(projectId, resourceId, i), { force: true });
    }
    for (let i = 0; i < buffers.length; i++) {
      await fs.writeFile(
        previewPath(projectId, resourceId, i),
        new Uint8Array(buffers[i]),
      );
    }
    const next: ResourceMeta = { ...meta, previewCount: buffers.length };
    await writeJson(metaFile, next);
    // Mirror previewCount into the resources.json index entry.
    await withFileLock(resourcesIndexPath(projectId), async () => {
      const list = await readResourcesIndex(projectId);
      await writeResourcesIndex(
        projectId,
        list.map((r) => (r.id === resourceId ? next : r)),
      );
    });
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

// ---------- images (project-level pool) ----------

async function readImagesIndex(projectId: string): Promise<ImageMeta[]> {
  return readJson<ImageMeta[]>(imagesIndexPath(projectId), []);
}
async function writeImagesIndex(
  projectId: string,
  list: ImageMeta[],
): Promise<void> {
  await writeJson(imagesIndexPath(projectId), list);
}

export async function listImages(projectId: string): Promise<ImageMeta[]> {
  const list = await readImagesIndex(projectId);
  list.sort((a, b) => a.createdAt - b.createdAt);
  return list;
}

export async function getImageMeta(
  projectId: string,
  imageId: string,
): Promise<ImageMeta | null> {
  const list = await readImagesIndex(projectId);
  return list.find((im) => im.id === imageId) ?? null;
}

export type CreateImageInput = {
  id?: string;
  resourceId: string;
  source: ImageSourceKind;
  name: string;
  ext: string;
  width: number;
  height: number;
  timestamp?: number;
  bytes: Buffer;
};

export async function createImages(
  projectId: string,
  inputs: CreateImageInput[],
): Promise<ImageMeta[]> {
  if (inputs.length === 0) return [];
  await ensureDir(imagesDir(projectId));
  const now = Date.now();
  const created: ImageMeta[] = [];
  for (const inp of inputs) {
    const id = inp.id ?? genId();
    const meta: ImageMeta = {
      id,
      resourceId: inp.resourceId,
      source: inp.source,
      name: inp.name,
      ext: inp.ext,
      width: inp.width,
      height: inp.height,
      timestamp: inp.timestamp,
      createdAt: now,
    };
    await fs.writeFile(
      path.join(imagesDir(projectId), `${safeId(id)}.${inp.ext}`),
      new Uint8Array(inp.bytes),
    );
    created.push(meta);
  }
  await withFileLock(imagesIndexPath(projectId), async () => {
    const list = await readImagesIndex(projectId);
    list.push(...created);
    await writeImagesIndex(projectId, list);
  });
  return created;
}

export async function readImageBytes(
  projectId: string,
  imageId: string,
): Promise<{ data: Buffer; ext: string } | null> {
  const meta = await getImageMeta(projectId, imageId);
  if (!meta) return null;
  const p = path.join(imagesDir(projectId), `${safeId(imageId)}.${meta.ext}`);
  try {
    return { data: await fs.readFile(p), ext: meta.ext };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export async function deleteImage(
  projectId: string,
  imageId: string,
): Promise<void> {
  // Remove from the index + delete bytes.
  let removed: ImageMeta | undefined;
  await withFileLock(imagesIndexPath(projectId), async () => {
    const list = await readImagesIndex(projectId);
    removed = list.find((im) => im.id === imageId);
    await writeImagesIndex(
      projectId,
      list.filter((im) => im.id !== imageId),
    );
  });
  if (removed) {
    const p = path.join(
      imagesDir(projectId),
      `${safeId(imageId)}.${removed.ext}`,
    );
    await fs.rm(p, { force: true });
  }
  // Cascade through label sets: drop the image from imageIds, drop annotations
  // and classifications referencing it.
  const sets = await readLabelSetsIndex(projectId);
  for (const ls of sets) {
    if (!ls.imageIds.includes(imageId)) continue;
    await mutateLabelSetMeta(projectId, ls.id, (m) => {
      m.imageIds = m.imageIds.filter((x) => x !== imageId);
    });
    await mutateLabelSetData(projectId, ls.id, (d) => {
      d.annotations = d.annotations.filter((a) => a.imageId !== imageId);
      d.classifications = d.classifications.filter(
        (c) => c.imageId !== imageId,
      );
    });
  }
}

// ---------- label sets ----------

async function readLabelSetsIndex(projectId: string): Promise<LabelSetMeta[]> {
  return readJson<LabelSetMeta[]>(labelsetsIndexPath(projectId), []);
}
async function writeLabelSetsIndex(
  projectId: string,
  list: LabelSetMeta[],
): Promise<void> {
  await writeJson(labelsetsIndexPath(projectId), list);
}

export async function listLabelSets(
  projectId: string,
): Promise<LabelSetSummary[]> {
  const list = await readLabelSetsIndex(projectId);
  const out: LabelSetSummary[] = [];
  for (const ls of list) {
    const data = await getLabelSetData(projectId, ls.id);
    const classifiedImages = new Set(
      data.classifications.map((c) => c.imageId),
    );
    out.push({
      ...ls,
      classCount: data.classes.length,
      annotationCount: data.annotations.length,
      classifiedImageCount: classifiedImages.size,
    });
  }
  out.sort((a, b) => a.createdAt - b.createdAt);
  return out;
}

export async function getLabelSetMeta(
  projectId: string,
  labelsetId: string,
): Promise<LabelSetMeta | null> {
  const p = path.join(labelsetDir(projectId, labelsetId), "meta.json");
  try {
    return JSON.parse(await fs.readFile(p, "utf-8")) as LabelSetMeta;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

function labelsetDataPath(projectId: string, labelsetId: string): string {
  return path.join(labelsetDir(projectId, labelsetId), "data.json");
}

export async function getLabelSetData(
  projectId: string,
  labelsetId: string,
): Promise<LabelSetData> {
  return readJson<LabelSetData>(labelsetDataPath(projectId, labelsetId), {
    classes: [],
    annotations: [],
    classifications: [],
  });
}

export async function createLabelSet(
  projectId: string,
  meta: Omit<LabelSetMeta, "id" | "createdAt">,
): Promise<LabelSetMeta> {
  const id = genId();
  const full: LabelSetMeta = { ...meta, id, createdAt: Date.now() };
  const dir = labelsetDir(projectId, id);
  await ensureDir(dir);
  await writeJson(path.join(dir, "meta.json"), full);
  await writeJson(labelsetDataPath(projectId, id), {
    classes: [],
    annotations: [],
    classifications: [],
  } as LabelSetData);
  await withFileLock(labelsetsIndexPath(projectId), async () => {
    const list = await readLabelSetsIndex(projectId);
    list.push(full);
    await writeLabelSetsIndex(projectId, list);
  });
  return full;
}

export async function deleteLabelSet(
  projectId: string,
  labelsetId: string,
): Promise<void> {
  await withFileLock(labelsetsIndexPath(projectId), async () => {
    const list = await readLabelSetsIndex(projectId);
    await writeLabelSetsIndex(
      projectId,
      list.filter((ls) => ls.id !== labelsetId),
    );
  });
  await fs.rm(labelsetDir(projectId, labelsetId), {
    recursive: true,
    force: true,
  });
}

export async function mutateLabelSetMeta(
  projectId: string,
  labelsetId: string,
  mutator: (meta: LabelSetMeta) => void | LabelSetMeta,
): Promise<LabelSetMeta | null> {
  const file = path.join(labelsetDir(projectId, labelsetId), "meta.json");
  return withFileLock(file, async () => {
    const meta = await getLabelSetMeta(projectId, labelsetId);
    if (!meta) return null;
    const result = mutator(meta);
    const next = result ?? meta;
    await writeJson(file, next);
    // Mirror to the labelsets.json index entry.
    await withFileLock(labelsetsIndexPath(projectId), async () => {
      const list = await readLabelSetsIndex(projectId);
      await writeLabelSetsIndex(
        projectId,
        list.map((ls) => (ls.id === labelsetId ? next : ls)),
      );
    });
    return next;
  });
}

export async function mutateLabelSetData<T>(
  projectId: string,
  labelsetId: string,
  mutator: (data: LabelSetData) => Promise<T> | T,
): Promise<T> {
  const file = labelsetDataPath(projectId, labelsetId);
  return withFileLock(file, async () => {
    const data = await getLabelSetData(projectId, labelsetId);
    const result = await mutator(data);
    if ((result as unknown) !== false) {
      await writeJson(file, data);
    }
    return result;
  });
}

export async function saveLabelSetData(
  projectId: string,
  labelsetId: string,
  data: LabelSetData,
): Promise<void> {
  await writeJson(labelsetDataPath(projectId, labelsetId), data);
}
