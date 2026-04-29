/**
 * In-workspace representation of an image. The same shape covers two roles:
 *   - extraction page: frames captured from the loaded video, awaiting upload
 *   - labeling page: images of the active label set, fetched from the server
 *
 * `id` matches the canonical `ImageMeta.id` once the image is registered in
 * the project's image pool.
 */
export type Frame = {
  id: string;
  /** Source resource id when the frame was extracted from a video. */
  resourceId?: string;
  url: string;
  width: number;
  height: number;
  /** Source timestamp in seconds (videos / extracted frames only). */
  timestamp?: number;
  /** Display label, e.g. file name or "Frame 03 · 00:12.40". */
  label: string;
};
