import type { Point } from "@/shared/types";
import type { Shape, ToolId } from "../types";

/** Pluggable annotation tools. New tools (polygon, mask, ...) implement this. */
export type AnnotationTool = {
  id: ToolId;
  name: string;
  shortcut?: string;
  /** CSS cursor used while the tool is active over the canvas. */
  cursor: string;
  /** Marked unavailable until the tool ships. */
  disabled?: boolean;
  /** Begin a new shape draft from the first pointer position. */
  begin: (start: Point) => ShapeDraft;
};

/** A shape-in-progress. The stage owns it for the duration of the gesture. */
export type ShapeDraft = {
  /** Update with the latest pointer position; return the new preview shape. */
  update: (current: Point) => Shape;
  /**
   * Commit the gesture. Return null to discard (e.g. zero-area rectangle),
   * otherwise return the final shape that becomes an annotation.
   */
  commit: (end: Point) => Shape | null;
};
