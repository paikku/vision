import type { Resource, ResourceSummary } from "../types";

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
