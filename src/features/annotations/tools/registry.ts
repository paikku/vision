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
};

export const TOOL_LIST: AnnotationTool[] = Object.values(TOOLS);
