export type Frame = {
  id: string;
  mediaId: string;
  url: string; // object URL for the rendered frame image
  width: number;
  height: number;
  /** Source timestamp in seconds (videos only). */
  timestamp?: number;
  /** Display label, e.g. "Frame 03 · 00:12.40". */
  label: string;
};
