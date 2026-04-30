/**
 * A LabelSet is a labeling unit. It pins down:
 *   - the labeling task type ("polygon" | "bbox" | "classify"),
 *   - its own private set of label classes,
 *   - the membership list of images being labeled.
 *
 * One image may belong to multiple LabelSets, and each LabelSet's classes are
 * fully independent — class "scratch" in LabelSet A is unrelated to class
 * "scratch" in LabelSet B.
 *
 * The labeling type is fixed at creation time. A polygon LabelSet only
 * accepts polygon annotations, a classify LabelSet only stores per-image
 * single-class labels, and so on.
 */
export type LabelSetType = "polygon" | "bbox" | "classify";

export type LabelClass = {
  id: string;
  name: string;
  color: string;
  shortcutKey?: "q" | "w" | "e" | "r";
};

export type LabelSet = {
  id: string;
  name: string;
  type: LabelSetType;
  classes: LabelClass[];
  imageIds: string[];
  createdAt: number;
};

export type LabelSetSummary = {
  id: string;
  name: string;
  type: LabelSetType;
  imageCount: number;
  annotationCount: number;
  createdAt: number;
};

// ---------- Annotation shapes ----------

export type ShapeRect = {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ShapePolygon = {
  kind: "polygon";
  rings: { x: number; y: number }[][];
};

// ---------- Annotation entries ----------

export type RectAnnotation = {
  id: string;
  imageId: string;
  classId: string;
  kind: "rect";
  shape: ShapeRect;
  createdAt: number;
};

export type PolygonAnnotation = {
  id: string;
  imageId: string;
  classId: string;
  kind: "polygon";
  shape: ShapePolygon;
  createdAt: number;
};

export type ClassifyAnnotation = {
  id: string;
  imageId: string;
  classId: string;
  kind: "classify";
  createdAt: number;
};

export type LabelSetAnnotation =
  | RectAnnotation
  | PolygonAnnotation
  | ClassifyAnnotation;

export type LabelSetAnnotations = {
  annotations: LabelSetAnnotation[];
};
