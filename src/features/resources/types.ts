/**
 * A Resource is a single upload unit in the Media Library.
 *
 *   video        — one video file
 *   image_batch  — a group of image files uploaded together
 *
 * Resources own the original bytes and the upload-level tags, but they do not
 * own the labeling work. The actual labeling targets are {@link Image} entries
 * derived from a Resource (a video resource is later expanded into N frames,
 * an image_batch resource is expanded directly into its files).
 */
export type ResourceType = "video" | "image_batch";

export type Resource = {
  id: string;
  type: ResourceType;
  name: string;
  tags: string[];
  createdAt: number;
  // video-only metadata
  sourceExt?: string;
  duration?: number;
  width?: number;
  height?: number;
  ingestVia?: "original" | "ffmpeg-wasm" | "server";
  previewCount?: number;
};

export type ResourceSummary = Resource & {
  imageCount: number;
};
