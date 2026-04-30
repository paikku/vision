import type { Image, ImageFilter } from "../types";

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

function buildQuery(filter?: ImageFilter): string {
  if (!filter) return "";
  const params = new URLSearchParams();
  if (filter.resourceId) params.set("resourceId", filter.resourceId);
  if (filter.source) params.set("source", filter.source);
  if (filter.tag) params.set("tag", filter.tag);
  const q = params.toString();
  return q ? `?${q}` : "";
}

export async function listImages(
  projectId: string,
  filter?: ImageFilter,
): Promise<Image[]> {
  const r = await fetch(
    `/api/projects/${projectId}/images${buildQuery(filter)}`,
    { cache: "no-store" },
  );
  const { images } = await asJson<{ images: Image[] }>(r);
  return images;
}

export async function getImage(
  projectId: string,
  imageId: string,
): Promise<Image> {
  const r = await fetch(`/api/projects/${projectId}/images/${imageId}`, {
    cache: "no-store",
  });
  const { image } = await asJson<{ image: Image }>(r);
  return image;
}

export async function updateImage(
  projectId: string,
  imageId: string,
  patch: { tags?: string[] },
): Promise<Image> {
  const r = await fetch(`/api/projects/${projectId}/images/${imageId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const { image } = await asJson<{ image: Image }>(r);
  return image;
}

export async function deleteImage(
  projectId: string,
  imageId: string,
): Promise<void> {
  await fetch(`/api/projects/${projectId}/images/${imageId}`, {
    method: "DELETE",
  });
}

export async function bulkTagImages(
  projectId: string,
  imageIds: string[],
  tags: string[],
  mode: "replace" | "add" | "remove",
): Promise<{ updated: number }> {
  const r = await fetch(`/api/projects/${projectId}/images/tags`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ imageIds, tags, mode }),
  });
  return asJson<{ updated: number }>(r);
}

export function imageBytesUrl(projectId: string, imageId: string): string {
  return `/api/projects/${projectId}/images/${imageId}/bytes`;
}
