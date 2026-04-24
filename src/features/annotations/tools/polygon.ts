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
/**
 * Clicks within this normalized distance of the first vertex snap-close
 * the polygon (requires ≥3 points). Matches the visual radius of the
 * first-vertex affordance (~4px on a default stage) so users only close
 * when they're deliberately clicking the dot.
 */
const CLOSE_ON_FIRST_DIST = 0.005;

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
      addPoint: (p) => {
        // Clicking (or overlapping) the first vertex closes the polygon,
        // as long as we have enough points to form an area.
        if (
          points.length >= MIN_POINTS &&
          dist(p, points[0]) < CLOSE_ON_FIRST_DIST
        ) {
          return { done: true, shape: poly() };
        }
        const last = points[points.length - 1];
        if (dist(p, last) < MIN_STEP) {
          // coalesce duplicates against the last vertex: keep preview,
          // don't commit a micro-segment
          return { done: false, shape: poly(p) };
        }
        points.push({ x: p.x, y: p.y });
        return { done: false, shape: poly() };
      },
      tryClose: () => (points.length >= MIN_POINTS ? poly() : null),
    };
  },
};
