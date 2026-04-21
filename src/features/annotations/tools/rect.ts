import type { Point } from "@/shared/types";
import type { RectShape } from "../types";
import type { AnnotationTool } from "./types";

const MIN_SIZE = 0.0005; // ~0.05% of frame on either axis

const rectFrom = (a: Point, b: Point): RectShape => ({
  kind: "rect",
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(b.x - a.x),
  h: Math.abs(b.y - a.y),
});

export const rectTool: AnnotationTool = {
  id: "rect",
  name: "Rectangle",
  shortcut: "R",
  cursor: "crosshair",
  begin(start) {
    return {
      update: (current) => rectFrom(start, current),
      commit: (end) => {
        const shape = rectFrom(start, end);
        return shape.w < MIN_SIZE || shape.h < MIN_SIZE ? null : shape;
      },
    };
  },
};
