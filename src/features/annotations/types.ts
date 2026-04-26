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

/** Single normalized point in image-space. */
export type PolygonPoint = { x: number; y: number };

/**
 * Closed polygon in normalized image-space. Ring 0 is the outer boundary,
 * rings 1..n are holes (even-odd fill). Rings are NOT explicitly closed —
 * the last point implicitly connects to the first. Each ring must have
 * at least 3 points.
 */
export type PolygonShape = {
  kind: "polygon";
  rings: PolygonPoint[][];
};

export type Shape = RectShape | PolygonShape;

export type Annotation = {
  id: string;
  frameId: string;
  classId: string;
  shape: Shape;
  createdAt: number;
};

export type ToolId = "rect" | "polygon" | "mask";
