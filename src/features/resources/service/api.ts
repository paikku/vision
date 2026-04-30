import type { Image } from "@/features/images/types";
import type { Resource, ResourceSummary } from "../types";

export type CreateVideoResourceInput = {
  type: "video";
  name: string;
  tags?: string[];
  file: File;
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

export type AddImageInput = {
  /** Optional preassigned UUID for client-allocated ids. */
  id?: string;
  blob: Blob;
  fileName: string;
  width: number;
  height: number;
  /** video_frame only */
  timestamp?: number;
  frameIndex?: number;
};

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function listResources(projectId: string): Promise<ResourceSummary[]> {
  const r = await fetch(`/api/projects/${projectId}/resources`, {
    cache: "no-store",
  });
  const { resources } = await asJson<{ resources: ResourceSummary[] }>(r);
  return resources;
}

export async function getResource(
  projectId: string,
  resourceId: string,
): Promise<Resource> {
  const r = await fetch(`/api/projects/${projectId}/resources/${resourceId}`, {
    cache: "no-store",
  });
  const { resource } = await asJson<{ resource: Resource }>(r);
  return resource;
}

export async function updateResource(
  projectId: string,
  resourceId: string,
  patch: { name?: string; tags?: string[] },
): Promise<Resource> {
  const r = await fetch(`/api/projects/${projectId}/resources/${resourceId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const { resource } = await asJson<{ resource: Resource }>(r);
  return resource;
}

export async function deleteResource(
  projectId: string,
  resourceId: string,
): Promise<void> {
  await fetch(`/api/projects/${projectId}/resources/${resourceId}`, {
    method: "DELETE",
  });
}

export function resourceSourceUrl(projectId: string, resourceId: string): string {
  return `/api/projects/${projectId}/resources/${resourceId}/source`;
}

export function resourcePreviewUrl(
  projectId: string,
  resourceId: string,
  idx: number,
): string {
  return `/api/projects/${projectId}/resources/${resourceId}/previews/${idx}`;
}

export async function createResource(
  projectId: string,
  input: CreateResourceInput,
): Promise<Resource> {
  const form = new FormData();
  form.append("type", input.type);
  form.append("name", input.name);
  form.append("tags", JSON.stringify(input.tags ?? []));
  if (input.type === "video") {
    form.append("file", input.file, input.file.name);
    form.append("width", String(input.width));
    form.append("height", String(input.height));
    if (input.duration != null) form.append("duration", String(input.duration));
    if (input.ingestVia) form.append("ingestVia", input.ingestVia);
  }
  const r = await fetch(`/api/projects/${projectId}/resources`, {
    method: "POST",
    body: form,
  });
  const { resource } = await asJson<{ resource: Resource }>(r);
  return resource;
}

export async function addImagesToResource(
  projectId: string,
  resourceId: string,
  images: AddImageInput[],
): Promise<Image[]> {
  const form = new FormData();
  const meta = images.map((img) => ({
    id: img.id,
    fileName: img.fileName,
    width: img.width,
    height: img.height,
    timestamp: img.timestamp,
    frameIndex: img.frameIndex,
  }));
  form.append("meta", JSON.stringify(meta));
  images.forEach((img, i) => form.append("files", img.blob, `image-${i}`));
  const r = await fetch(
    `/api/projects/${projectId}/resources/${resourceId}/images`,
    { method: "POST", body: form },
  );
  const { images: out } = await asJson<{ images: Image[] }>(r);
  return out;
}

export async function uploadResourcePreviews(
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
