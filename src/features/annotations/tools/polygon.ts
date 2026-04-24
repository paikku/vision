import type { Point } from "@/shared/types";
import type { PolygonShape } from "../types";
import type { AnnotationTool } from "./types";

/** Minimum vertices for a closable polygon. */
const MIN_POINTS = 3;
/**
 * Reject a new point if it's closer than this to the previous vertex —
 * filters out accidental double-clicks and micro-segments that users
 * can't see or move later.
 */
const MIN_STEP = 0.001;

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export const polygonTool: AnnotationTool = {
  id: "polygon",
  name: "Polygon",
  shortcut: "P",
  cursor: "crosshair",
  begin(start) {
    const points: Point[] = [{ x: start.x, y: start.y }];

    const poly = (preview?: Point): PolygonShape => {
      const ring = preview ? [...points, preview] : [...points];
      return { kind: "polygon", rings: [ring.map((p) => ({ x: p.x, y: p.y }))] };
    };

    return {
      update: (cur) => poly(cur),
      // Click always appends a vertex — closing is Enter-only. Clicking
      // near the first vertex used to close but was error-prone (users
      // placed points near their start and closed by accident).
      addPoint: (p) => {
        const last = points[points.length - 1];
        if (dist(p, last) < MIN_STEP) {
          // coalesce duplicates: return the current preview without committing
          return { done: false, shape: poly(p) };
        }
        points.push({ x: p.x, y: p.y });
        return { done: false, shape: poly() };
      },
      tryClose: () => (points.length >= MIN_POINTS ? poly() : null),
    };
  },
};
