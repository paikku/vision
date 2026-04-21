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
