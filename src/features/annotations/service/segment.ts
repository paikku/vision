import type { RectShape, Shape } from "../types";

/**
 * Segmentation service — refines an annotation region into a tighter
 * object boundary using a server-side model.
 *
 * The response schema is intentionally polymorphic so that today's
 * rect-only shape union can be upgraded to polygon/mask without
 * changing the network contract:
 *
 *   - `polygon` : array of rings (outer + optional holes), normalized [0..1]
 *   - `rect`    : tight axis-aligned bbox, normalized [0..1]
 *
 * Callers that only support rect should call `toRectShape(result)`,
 * which picks the rect when present and otherwise collapses the
 * polygon to its AABB. Once a polygon `Shape` variant is added, the
 * caller can branch on `result.polygon` directly.
 */

export type NormalizedPoint = { x: number; y: number };

/** One closed ring of normalized points. First ring is outer, rest are holes. */
export type NormalizedRing = NormalizedPoint[];

export type SegmentRegionHint = {
  /** Source annotation rect in normalized [0..1] — the region to focus on. */
  bbox: { x: number; y: number; w: number; h: number };
  /** Optional hint classes (e.g. class name) for models that accept it. */
  classHint?: string;
};

export type SegmentResult = {
  /**
   * Preferred shape. `polygon` is richer than `rect` and should be used
   * as soon as the Shape union supports it. Today, callers ignore it
   * and fall back to `rect`.
   */
  polygon?: NormalizedRing[];
  /** Tight AABB of the segmented object in normalized coords. */
  rect: { x: number; y: number; w: number; h: number };
  /** Optional model confidence in [0..1]. */
  score?: number;
};

export type SegmentOptions = {
  signal?: AbortSignal;
};

/** Raw server response shape — kept permissive so the server can evolve. */
type ServerResponse = {
  polygon?: Array<Array<[number, number] | { x: number; y: number }>>;
  rect?: { x: number; y: number; w: number; h: number };
  bbox?: { x: number; y: number; w: number; h: number };
  score?: number;
};

/**
 * Returns the segmentation endpoint URL, or null when segmentation is
 * not configured. Resolution order:
 *   1. `NEXT_PUBLIC_IMAGE_SEGMENT_ENDPOINT` — explicit override
 *   2. Derived from `NEXT_PUBLIC_VIDEO_NORMALIZE_ENDPOINT` by replacing
 *      the last path segment with `segment` (same host/port/scheme).
 */
export function getSegmentEndpoint(): string | null {
  const explicit = process.env.NEXT_PUBLIC_IMAGE_SEGMENT_ENDPOINT;
  if (explicit) return explicit;

  const normalize = process.env.NEXT_PUBLIC_VIDEO_NORMALIZE_ENDPOINT;
  if (!normalize) return null;
  try {
    const url = new URL(normalize);
    const trimmed = url.pathname.replace(/\/+$/, "");
    const parts = trimmed.split("/");
    if (parts.length <= 1 || parts[parts.length - 1] === "") {
      url.pathname = "/segment";
    } else {
      parts[parts.length - 1] = "segment";
      url.pathname = parts.join("/");
    }
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Requests a segmentation refinement for a region inside `frameImageUrl`.
 * Returns `null` if segmentation is not configured or the request fails —
 * callers are expected to surface that as a no-op (the annotation stays
 * untouched) rather than a hard error.
 */
export async function segmentRegion(
  frameImageUrl: string,
  hint: SegmentRegionHint,
  opts?: SegmentOptions,
): Promise<SegmentResult | null> {
  const endpoint = getSegmentEndpoint();
  if (!endpoint) return null;

  let imageBlob: Blob;
  try {
    const imgResp = await fetch(frameImageUrl, { signal: opts?.signal });
    if (!imgResp.ok) return null;
    imageBlob = await imgResp.blob();
  } catch {
    return null;
  }

  const form = new FormData();
  form.append("file", imageBlob, "frame.jpg");
  form.append("region", JSON.stringify(hint.bbox));
  if (hint.classHint) form.append("classHint", hint.classHint);

  let resp: Response;
  try {
    resp = await fetch(endpoint, {
      method: "POST",
      body: form,
      signal: opts?.signal,
    });
  } catch {
    return null;
  }
  if (!resp.ok) return null;

  let data: ServerResponse;
  try {
    data = (await resp.json()) as ServerResponse;
  } catch {
    return null;
  }

  return parseServerResponse(data, hint.bbox);
}

function parseServerResponse(
  data: ServerResponse,
  fallbackBbox: { x: number; y: number; w: number; h: number },
): SegmentResult | null {
  const rings = parseRings(data.polygon);
  const rect =
    sanitizeRect(data.rect) ??
    sanitizeRect(data.bbox) ??
    ringsAabb(rings) ??
    null;

  if (!rect && !rings) return null;

  return {
    polygon: rings ?? undefined,
    rect: rect ?? fallbackBbox,
    score: typeof data.score === "number" ? data.score : undefined,
  };
}

function parseRings(
  raw: ServerResponse["polygon"],
): NormalizedRing[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const rings: NormalizedRing[] = [];
  for (const ring of raw) {
    if (!Array.isArray(ring) || ring.length < 3) continue;
    const points: NormalizedPoint[] = [];
    for (const p of ring) {
      const pt = toPoint(p);
      if (pt) points.push(pt);
    }
    if (points.length >= 3) rings.push(points);
  }
  return rings.length > 0 ? rings : null;
}

function toPoint(p: unknown): NormalizedPoint | null {
  if (Array.isArray(p) && p.length >= 2) {
    const [x, y] = p as [unknown, unknown];
    if (typeof x === "number" && typeof y === "number") {
      return clampPoint({ x, y });
    }
    return null;
  }
  if (p && typeof p === "object") {
    const { x, y } = p as { x?: unknown; y?: unknown };
    if (typeof x === "number" && typeof y === "number") {
      return clampPoint({ x, y });
    }
  }
  return null;
}

function clampPoint({ x, y }: NormalizedPoint): NormalizedPoint {
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
  };
}

function sanitizeRect(
  r: { x: number; y: number; w: number; h: number } | undefined,
): { x: number; y: number; w: number; h: number } | null {
  if (!r) return null;
  const { x, y, w, h } = r;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof w !== "number" ||
    typeof h !== "number"
  ) {
    return null;
  }
  if (w <= 0 || h <= 0) return null;
  const cx = Math.max(0, Math.min(1, x));
  const cy = Math.max(0, Math.min(1, y));
  const cw = Math.max(0, Math.min(1 - cx, w));
  const ch = Math.max(0, Math.min(1 - cy, h));
  if (cw <= 0 || ch <= 0) return null;
  return { x: cx, y: cy, w: cw, h: ch };
}

function ringsAabb(
  rings: NormalizedRing[] | null,
): { x: number; y: number; w: number; h: number } | null {
  if (!rings || rings.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  const w = maxX - minX;
  const h = maxY - minY;
  if (w <= 0 || h <= 0) return null;
  return { x: minX, y: minY, w, h };
}

/**
 * Collapse a segment result into today's rect-only Shape union.
 *
 * When a polygon variant is added to `Shape`, prefer a dedicated
 * converter (e.g. `toPolygonShape`) and branch on `result.polygon`
 * before falling through to this helper.
 */
export function toRectShape(result: SegmentResult): RectShape {
  return { kind: "rect", ...result.rect };
}

/** Convenience: picks the best representable shape for today's union. */
export function toShape(result: SegmentResult): Shape {
  return toRectShape(result);
}
