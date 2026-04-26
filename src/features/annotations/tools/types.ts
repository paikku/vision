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

/** Result of adding a point to a draft. */
export type AddPointResult = {
  /** When true, the gesture is finished; `shape` is either the committed
   *  shape or null (discarded). When false, drafting continues and `shape`
   *  is the new preview to render. */
  done: boolean;
  shape: Shape | null;
};

/**
 * A shape-in-progress. The stage owns it for the duration of the gesture.
 *
 * The model is point-accumulating: the hook calls `addPoint` on each click.
 * Two-click tools (rect) return `done:true` on the very first `addPoint`.
 * N-click tools (polygon) return `done:false` until their own close condition
 * (e.g. click near the first vertex).
 */
export type ShapeDraft = {
  /** Update with the latest pointer position; return the new preview shape. */
  update: (current: Point) => Shape;
  /** Add a committed vertex or finalize the gesture. */
  addPoint: (p: Point) => AddPointResult;
  /**
   * Optional: called when the user explicitly asks to close the draft
   * (e.g. `Enter` key). Returns the final shape or null when the draft
   * can't be closed yet (e.g. polygon with <3 points). Tools that don't
   * need explicit close (rect) can omit this.
   */
  tryClose?: () => Shape | null;
};
