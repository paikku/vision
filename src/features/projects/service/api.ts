import type {
  ImageMeta,
  LabelSetData,
  LabelSetMeta,
  LabelSetSummary,
  Project,
  ProjectSummary,
  ResourceMeta,
  ResourceSummary,
} from "../types";

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// ---------- projects ----------

export async function listProjects(): Promise<ProjectSummary[]> {
  const r = await fetch("/api/projects", { cache: "no-store" });
  const { projects } = await asJson<{ projects: ProjectSummary[] }>(r);
  return projects;
}

export async function createProject(name: string): Promise<Project> {
  const r = await fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const { project } = await asJson<{ project: Project }>(r);
  return project;
}

export async function deleteProject(id: string): Promise<void> {
  await fetch(`/api/projects/${id}`, { method: "DELETE" });
}

export async function getProjectDetail(id: string): Promise<{
  project: Project;
  resources: ResourceSummary[];
  images: ImageMeta[];
  labelsets: LabelSetSummary[];
}> {
  const r = await fetch(`/api/projects/${id}`, { cache: "no-store" });
  return asJson<{
    project: Project;
    resources: ResourceSummary[];
    images: ImageMeta[];
    labelsets: LabelSetSummary[];
  }>(r);
}

// ---------- resources ----------

export async function listResources(
  projectId: string,
): Promise<ResourceSummary[]> {
  const r = await fetch(`/api/projects/${projectId}/resources`, {
    cache: "no-store",
  });
  const { resources } = await asJson<{ resources: ResourceSummary[] }>(r);
  return resources;
}

export type UploadVideoResourceInput = {
  file: File;
  name: string;
  width: number;
  height: number;
  duration?: number;
  ingestVia?: "original" | "ffmpeg-wasm" | "server";
};

export async function uploadVideoResource(
  projectId: string,
  input: UploadVideoResourceInput,
): Promise<ResourceMeta> {
  const form = new FormData();
  form.append("kind", "video");
  form.append("file", input.file, input.file.name);
  form.append("name", input.name);
  form.append("width", String(input.width));
  form.append("height", String(input.height));
  if (input.duration != null) form.append("duration", String(input.duration));
  if (input.ingestVia) form.append("ingestVia", input.ingestVia);
  const r = await fetch(`/api/projects/${projectId}/resources`, {
    method: "POST",
    body: form,
  });
  const { resource } = await asJson<{ resource: ResourceMeta }>(r);
  return resource;
}

export type UploadImageBatchEntry = {
  file: File;
  width: number;
  height: number;
};

export async function uploadImageBatchResource(
  projectId: string,
  name: string,
  entries: UploadImageBatchEntry[],
): Promise<{ resource: ResourceMeta; images: ImageMeta[] }> {
  const form = new FormData();
  form.append("kind", "image_batch");
  form.append("name", name);
  form.append(
    "meta",
    JSON.stringify(
      entries.map((e) => ({
        name: e.file.name,
        width: e.width,
        height: e.height,
      })),
    ),
  );
  for (const e of entries) form.append("files", e.file, e.file.name);
  const r = await fetch(`/api/projects/${projectId}/resources`, {
    method: "POST",
    body: form,
  });
  return asJson<{ resource: ResourceMeta; images: ImageMeta[] }>(r);
}

export async function deleteResource(
  projectId: string,
  resourceId: string,
): Promise<void> {
  await fetch(`/api/projects/${projectId}/resources/${resourceId}`, {
    method: "DELETE",
  });
}

export async function getResource(
  projectId: string,
  resourceId: string,
): Promise<{ resource: ResourceMeta; images: ImageMeta[] }> {
  const r = await fetch(`/api/projects/${projectId}/resources/${resourceId}`, {
    cache: "no-store",
  });
  return asJson<{ resource: ResourceMeta; images: ImageMeta[] }>(r);
}

export function resourceSourceUrl(
  projectId: string,
  resourceId: string,
): string {
  return `/api/projects/${projectId}/resources/${resourceId}/source`;
}

export function previewUrl(
  projectId: string,
  resourceId: string,
  idx: number,
): string {
  return `/api/projects/${projectId}/resources/${resourceId}/previews/${idx}`;
}

export async function uploadPreviews(
  projectId: string,
  resourceId: string,
  blobs: Blob[],
): Promise<number> {
  const form = new FormData();
  blobs.forEach((b, i) => form.append("files", b, `preview-${i}.jpg`));
  const r = await fetch(
    `/api/projects/${projectId}/resources/${resourceId}/previews`,
    { method: "POST", body: form },
  );
  const { previewCount } = await asJson<{ previewCount: number }>(r);
  return previewCount;
}

// ---------- video → image extraction ----------

export type UploadFrameInput = {
  id?: string;
  blob: Blob;
  width: number;
  height: number;
  timestamp?: number;
  name: string;
};

export async function uploadExtractedFrames(
  projectId: string,
  resourceId: string,
  frames: UploadFrameInput[],
): Promise<ImageMeta[]> {
  const form = new FormData();
  const meta = frames.map((f) => ({
    id: f.id,
    width: f.width,
    height: f.height,
    timestamp: f.timestamp,
    name: f.name,
  }));
  form.append("meta", JSON.stringify(meta));
  frames.forEach((f, i) => form.append("files", f.blob, `frame-${i}.jpg`));
  const r = await fetch(
    `/api/projects/${projectId}/resources/${resourceId}/frames`,
    { method: "POST", body: form },
  );
  const { images } = await asJson<{ images: ImageMeta[] }>(r);
  return images;
}

// ---------- images (project-level pool) ----------

export async function listImages(projectId: string): Promise<ImageMeta[]> {
  const r = await fetch(`/api/projects/${projectId}/images`, {
    cache: "no-store",
  });
  const { images } = await asJson<{ images: ImageMeta[] }>(r);
  return images;
}

export function imageUrl(projectId: string, imageId: string): string {
  return `/api/projects/${projectId}/images/${imageId}`;
}

export async function deleteImage(
  projectId: string,
  imageId: string,
): Promise<void> {
  await fetch(`/api/projects/${projectId}/images/${imageId}`, {
    method: "DELETE",
  });
}

// ---------- label sets ----------

export async function listLabelSets(
  projectId: string,
): Promise<LabelSetSummary[]> {
  const r = await fetch(`/api/projects/${projectId}/labelsets`, {
    cache: "no-store",
  });
  const { labelsets } = await asJson<{ labelsets: LabelSetSummary[] }>(r);
  return labelsets;
}

export async function createLabelSet(
  projectId: string,
  input: { name: string; taskType: LabelSetMeta["taskType"]; imageIds: string[] },
): Promise<LabelSetMeta> {
  const r = await fetch(`/api/projects/${projectId}/labelsets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const { labelset } = await asJson<{ labelset: LabelSetMeta }>(r);
  return labelset;
}

export async function deleteLabelSet(
  projectId: string,
  labelsetId: string,
): Promise<void> {
  await fetch(`/api/projects/${projectId}/labelsets/${labelsetId}`, {
    method: "DELETE",
  });
}

export async function getLabelSet(
  projectId: string,
  labelsetId: string,
): Promise<{ meta: LabelSetMeta; data: LabelSetData; images: ImageMeta[] }> {
  const r = await fetch(
    `/api/projects/${projectId}/labelsets/${labelsetId}`,
    { cache: "no-store" },
  );
  return asJson<{
    meta: LabelSetMeta;
    data: LabelSetData;
    images: ImageMeta[];
  }>(r);
}

export async function updateLabelSet(
  projectId: string,
  labelsetId: string,
  patch: Partial<Pick<LabelSetMeta, "name" | "imageIds">>,
): Promise<LabelSetMeta> {
  const r = await fetch(
    `/api/projects/${projectId}/labelsets/${labelsetId}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  const { labelset } = await asJson<{ labelset: LabelSetMeta }>(r);
  return labelset;
}

export async function saveLabelSetData(
  projectId: string,
  labelsetId: string,
  data: LabelSetData,
): Promise<void> {
  await fetch(`/api/projects/${projectId}/labelsets/${labelsetId}/data`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
}

// ---------- export ----------

export function exportUrl(
  projectId: string,
  selection?: { labelsetIds?: string[] },
): string {
  const base = `/api/projects/${projectId}/export`;
  if (selection?.labelsetIds && selection.labelsetIds.length > 0) {
    const params = new URLSearchParams();
    params.set("labelsets", selection.labelsetIds.join(","));
    return `${base}?${params.toString()}`;
  }
  return base;
}
