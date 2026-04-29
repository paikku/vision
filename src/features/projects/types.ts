import type {
  Annotation,
  Classification,
  LabelClass,
  TaskType,
} from "@/features/annotations/types";

export type ProjectMember = { id: string; name: string; role: string };

export type Project = {
  id: string;
  name: string;
  createdAt: number;
  members: ProjectMember[];
};

export type ProjectSummary = {
  id: string;
  name: string;
  createdAt: number;
  resourceCount: number;
  imageCount: number;
  labelSetCount: number;
};

export type ResourceKind = "video" | "image_batch";

export type ResourceMeta = {
  id: string;
  kind: ResourceKind;
  name: string;
  createdAt: number;
  // video-only
  width?: number;
  height?: number;
  duration?: number;
  ingestVia?: "original" | "ffmpeg-wasm" | "server";
  sourceExt?: string;
  /** Number of preview thumbnails on disk (preview-0.jpg ... preview-{n-1}.jpg). */
  previewCount?: number;
};

export type ResourceSummary = ResourceMeta & {
  /** Total images this resource has produced (uploaded + extracted frames). */
  imageCount: number;
};

export type ImageSourceKind = "uploaded" | "video_frame";

export type ImageMeta = {
  id: string;
  resourceId: string;
  source: ImageSourceKind;
  name: string;
  ext: string;
  width: number;
  height: number;
  /** Source timestamp (seconds, video frames only). */
  timestamp?: number;
  createdAt: number;
};

export type LabelSetMeta = {
  id: string;
  name: string;
  taskType: TaskType;
  imageIds: string[];
  createdAt: number;
};

export type LabelSetSummary = LabelSetMeta & {
  classCount: number;
  /** Number of shape annotations (bbox/polygon). 0 for classify. */
  annotationCount: number;
  /** Number of distinct images that have at least one classification. */
  classifiedImageCount: number;
};

export type LabelSetData = {
  classes: LabelClass[];
  /** Shape annotations — populated for bbox / polygon task types. */
  annotations: Annotation[];
  /** Image-level class assignments — populated for classify task type. */
  classifications: Classification[];
};
