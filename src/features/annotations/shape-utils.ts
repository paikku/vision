import type { PolygonPoint, Shape } from "./types";

export type Aabb = { x: number; y: number; w: number; h: number };

/** Axis-aligned bounding box of a shape, in normalized [0..1] coords. */
export function shapeAabb(shape: Shape): Aabb {
  if (shape.kind === "rect") {
    return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of shape.rings) {
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Point-in-shape hit test. Both point and shape are in normalized coords. */
export function shapeContains(shape: Shape, px: number, py: number): boolean {
  if (shape.kind === "rect") {
    return (
      px >= shape.x &&
      px <= shape.x + shape.w &&
      py >= shape.y &&
      py <= shape.y + shape.h
    );
  }
  // Even-odd fill: point is inside if it's inside an odd number of rings.
  let inside = false;
  for (const ring of shape.rings) {
    if (pointInRing(ring, px, py)) inside = !inside;
  }
  return inside;
}

function pointInRing(ring: PolygonPoint[], px: number, py: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x;
    const yi = ring[i].y;
    const xj = ring[j].x;
    const yj = ring[j].y;
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Translate a shape by (dx, dy), clamping so the AABB stays inside [0..1]².
 * Returns a new shape; never mutates.
 */
export function translateShape(shape: Shape, dx: number, dy: number): Shape {
  const aabb = shapeAabb(shape);
  const clampedDx = Math.max(-aabb.x, Math.min(1 - aabb.x - aabb.w, dx));
  const clampedDy = Math.max(-aabb.y, Math.min(1 - aabb.y - aabb.h, dy));
  if (shape.kind === "rect") {
    return {
      kind: "rect",
      x: shape.x + clampedDx,
      y: shape.y + clampedDy,
      w: shape.w,
      h: shape.h,
    };
  }
  return {
    kind: "polygon",
    rings: shape.rings.map((ring) =>
      ring.map((p) => ({ x: p.x + clampedDx, y: p.y + clampedDy })),
    ),
  };
}

/** Build an SVG path "d" attribute for a polygon with holes (even-odd). */
export function polygonPath(rings: PolygonPoint[][]): string {
  const parts: string[] = [];
  for (const ring of rings) {
    if (ring.length < 3) continue;
    const [first, ...rest] = ring;
    parts.push(`M ${first.x} ${first.y}`);
    for (const p of rest) parts.push(`L ${p.x} ${p.y}`);
    parts.push("Z");
  }
  return parts.join(" ");
}
