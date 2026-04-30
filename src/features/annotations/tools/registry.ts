import type { ToolId } from "../types";
import { polygonTool } from "./polygon";
import { rectTool } from "./rect";
import type { AnnotationTool } from "./types";

/**
 * Tool harness. Adding a new technique (polygon, mask, ...) is:
 *   1. implement AnnotationTool
 *   2. register it here
 *   3. extend the Shape union in ../types.ts
 */
export const TOOLS: Record<ToolId, AnnotationTool> = {
  rect: rectTool,
  polygon: polygonTool,
  mask: {
    id: "mask",
    name: "Segment",
    shortcut: "S",
    cursor: "crosshair",
    disabled: true,
    begin: () => {
      throw new Error("mask tool not implemented");
    },
  },
  // Classification is not a draw-tool — there is no shape — but it is part
  // of the ToolId union so downstream switches stay exhaustive. The drawing
  // hook (useDrawingTool) is gated off when activeToolId === "classify"; the
  // stage handles classify clicks separately.
  classify: {
    id: "classify",
    name: "Classify",
    shortcut: undefined,
    cursor: "pointer",
    disabled: true,
    begin: () => {
      throw new Error("classify is not a draw tool");
    },
  },
};

export const TOOL_LIST: AnnotationTool[] = Object.values(TOOLS);
