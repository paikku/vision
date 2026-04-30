import type {
  LabelSet,
  LabelSetAnnotations,
  LabelSetSummary,
  LabelSetType,
} from "../types";

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

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
  input: { name: string; type: LabelSetType; imageIds?: string[] },
): Promise<LabelSet> {
  const r = await fetch(`/api/projects/${projectId}/labelsets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const { labelset } = await asJson<{ labelset: LabelSet }>(r);
  return labelset;
}

export async function getLabelSet(
  projectId: string,
  labelSetId: string,
): Promise<LabelSet> {
  const r = await fetch(`/api/projects/${projectId}/labelsets/${labelSetId}`, {
    cache: "no-store",
  });
  const { labelset } = await asJson<{ labelset: LabelSet }>(r);
  return labelset;
}

export async function updateLabelSet(
  projectId: string,
  labelSetId: string,
  patch: { name?: string; classes?: LabelSet["classes"]; imageIds?: string[] },
): Promise<LabelSet> {
  const r = await fetch(`/api/projects/${projectId}/labelsets/${labelSetId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const { labelset } = await asJson<{ labelset: LabelSet }>(r);
  return labelset;
}

export async function deleteLabelSet(
  projectId: string,
  labelSetId: string,
): Promise<void> {
  await fetch(`/api/projects/${projectId}/labelsets/${labelSetId}`, {
    method: "DELETE",
  });
}

export async function getLabelSetAnnotations(
  projectId: string,
  labelSetId: string,
): Promise<LabelSetAnnotations> {
  const r = await fetch(
    `/api/projects/${projectId}/labelsets/${labelSetId}/annotations`,
    { cache: "no-store" },
  );
  return asJson<LabelSetAnnotations>(r);
}

export async function saveLabelSetAnnotations(
  projectId: string,
  labelSetId: string,
  data: LabelSetAnnotations,
): Promise<void> {
  await fetch(`/api/projects/${projectId}/labelsets/${labelSetId}/annotations`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
}
