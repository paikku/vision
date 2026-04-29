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

/**
 * Shape annotation — used by `bbox` and `polygon` task types. Each annotation
 * binds a shape and class to one image.
 */
export type Annotation = {
  id: string;
  imageId: string;
  classId: string;
  shape: Shape;
  createdAt: number;
};

/**
 * Image-level class assignment — used by `classify` task type. An image may
 * have multiple classifications (multi-label) but at most one per class.
 */
export type Classification = {
  id: string;
  imageId: string;
  classId: string;
  createdAt: number;
};

export type ToolId = "rect" | "polygon" | "mask";

export type TaskType = "bbox" | "polygon" | "classify";

export const TASK_TYPES: ReadonlyArray<{
  id: TaskType;
  label: string;
  description: string;
}> = [
  { id: "bbox", label: "Bounding Box", description: "사각형으로 객체 영역 라벨" },
  { id: "polygon", label: "Polygon", description: "다각형으로 객체 영역 라벨" },
  { id: "classify", label: "Classification", description: "이미지 단위 클래스 분류" },
];
