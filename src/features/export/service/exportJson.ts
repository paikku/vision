import type { Image } from "@/features/images/types";
import type {
  LabelSet,
  LabelSetAnnotation,
} from "@/features/labelsets/types";
import type { Resource } from "@/features/resources/types";

/**
 * A LabelSet export bundles the LabelSet's classes + the labeled images'
 * metadata + every annotation in a single JSON. Image bytes are not inlined;
 * they remain addressable via `/api/projects/{id}/images/{imageId}/bytes`.
 */
export type LabelSetExport = {
  version: 2;
  labelSet: {
    id: string;
    name: string;
    type: LabelSet["type"];
    classes: LabelSet["classes"];
    createdAt: number;
  };
  images: {
    id: string;
    fileName: string;
    width: number;
    height: number;
    source: Image["source"];
    resource: { id: string; name: string; type: Resource["type"] } | null;
    tags: string[];
    videoFrameMeta?: Image["videoFrameMeta"];
  }[];
  annotations: LabelSetAnnotation[];
};

export type ExportInput = {
  labelSet: LabelSet;
  images: Image[];
  resources: Resource[];
  annotations: LabelSetAnnotation[];
};

export function buildLabelSetExport({
  labelSet,
  images,
  resources,
  annotations,
}: ExportInput): LabelSetExport {
  const resourceById = new Map(resources.map((r) => [r.id, r] as const));
  const order = new Map(labelSet.imageIds.map((id, i) => [id, i] as const));
  const sortedImages = [...images].sort(
    (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
  );
  return {
    version: 2,
    labelSet: {
      id: labelSet.id,
      name: labelSet.name,
      type: labelSet.type,
      classes: labelSet.classes,
      createdAt: labelSet.createdAt,
    },
    images: sortedImages.map((img) => {
      const r = resourceById.get(img.resourceId);
      return {
        id: img.id,
        fileName: img.fileName,
        width: img.width,
        height: img.height,
        source: img.source,
        resource: r ? { id: r.id, name: r.name, type: r.type } : null,
        tags: img.tags,
        videoFrameMeta: img.videoFrameMeta,
      };
    }),
    annotations,
  };
}

export function exportJson(input: ExportInput): string {
  return JSON.stringify(buildLabelSetExport(input), null, 2);
}
