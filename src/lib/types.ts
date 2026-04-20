export type MediaKind = "image" | "video";

export type MediaSource = {
  id: string;
  kind: MediaKind;
  name: string;
  url: string; // object URL for the original upload
  width: number;
  height: number;
  duration?: number; // seconds, for video
  file?: File; // normalized file used by the current session
  originalFile?: File; // original upload file (before normalization)
  ingestVia?: "original" | "ffmpeg-wasm" | "server";
};

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

export type ClassShortcutKey = "q" | "w" | "e" | "r";

export type LabelClass = {
  id: string;
  name: string;
  color: string;
  /** Q/W/E/R key bound to this class. At most one class holds each key. */
  shortcutKey?: ClassShortcutKey;
};

/** Normalized rectangle in image-space (0..1 on both axes). */
export type RectShape = {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Future shape types live next to RectShape and the union expands. */
export type Shape = RectShape;

export type Annotation = {
  id: string;
  frameId: string;
  classId: string;
  shape: Shape;
  createdAt: number;
};

export type ToolId = "rect" | "polygon" | "mask";

export type Point = { x: number; y: number };
