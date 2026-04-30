/**
 * An Image is an individual labeling target — the unit a LabelSet refers to.
 *
 *   uploaded     — file uploaded directly by the user
 *   video_frame  — frame extracted from a video resource
 *
 * Image tags are editable for `uploaded` images. For `video_frame` images
 * the UI keeps `tags` editing disabled by default and surfaces the parent
 * Resource tags + frame metadata instead, but the field exists on the model
 * so an explicit override path can be added later if needed.
 */
export type ImageSource = "uploaded" | "video_frame";

export type VideoFrameMeta = {
  /** Position of the frame in the source video, in seconds. */
  timestamp: number;
  /** Optional integer index for stable ordering when timestamps clash. */
  frameIndex?: number;
};

export type Image = {
  id: string;
  resourceId: string;
  source: ImageSource;
  fileName: string;
  ext: string;
  width: number;
  height: number;
  tags: string[];
  videoFrameMeta?: VideoFrameMeta;
  createdAt: number;
};

export type ImageFilter = {
  resourceId?: string;
  source?: ImageSource;
  tag?: string;
};
